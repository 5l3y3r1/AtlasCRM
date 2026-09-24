'use strict';
/**
 * routes/marketing.js — marketing analytics engine + ad-spend sync
 *
 *   GET  /api/marketing/rollup   per-campaign metrics DERIVED live from leads + deals
 *   POST /api/marketing/sync     pull spend from Meta / TikTok using the company's OWN
 *                                (user-entered) tokens in company_integrations
 *
 * Design note: spend is the only campaign number that lives outside the CRM, so it is
 * the only thing that needs an external API. Leads-generated, revenue, ROI and
 * conversion are computed live from the leads/deals the CRM already owns — they are
 * always accurate and need no integration to work.
 */
const express = require('express');
const { db } = require('../db');
const { requireAuth } = require('../auth');
const { fail, safeMessage } = require('./_errors');

const router = express.Router();
router.use(requireAuth);

// Meta Graph API version — keep current: developers.facebook.com/docs/graph-api/changelog
const META_API_VERSION = 'v21.0';

// Pipeline stages that count as won / revenue-bearing. Tweak to match your deals.
const WON_STAGES = ['CLOSED', 'CLOSED_WON', 'WON'];

/* ════════════════════════════════════════════════════════════════════════
   GET /rollup — every campaign with metrics derived from attributed data
   ════════════════════════════════════════════════════════════════════════ */
router.get('/rollup', (req, res) => {
  const cid = req.user.company_id;
  try {
    const campaigns = db.prepare(
      'SELECT * FROM marketing_campaigns WHERE company_id = ? ORDER BY created_at DESC'
    ).all(cid);

    const wonPlaceholders = WON_STAGES.map(() => '?').join(',');

    // leads attributed to each campaign
    const leadRows = db.prepare(
      `SELECT campaign_id AS cid, COUNT(*) AS n
         FROM leads
        WHERE company_id = ? AND campaign_id IS NOT NULL
        GROUP BY campaign_id`
    ).all(cid);

    // deals attributed to each campaign (totals + won + revenue from commission)
    const dealRows = db.prepare(
      `SELECT campaign_id AS cid,
              COUNT(*) AS deals_total,
              SUM(CASE WHEN current_stage IN (${wonPlaceholders}) THEN 1 ELSE 0 END) AS deals_won,
              SUM(CASE WHEN current_stage IN (${wonPlaceholders})
                       THEN COALESCE(commission_amount, 0) ELSE 0 END) AS revenue
         FROM deals
        WHERE company_id = ? AND campaign_id IS NOT NULL
        GROUP BY campaign_id`
    ).all(...WON_STAGES, ...WON_STAGES, cid);

    const leadsBy = Object.fromEntries(leadRows.map(r => [r.cid, r.n]));
    const dealsBy = Object.fromEntries(dealRows.map(r => [r.cid, r]));

    const rows = campaigns.map(c => {
      const leads = leadsBy[c.id] || 0;
      const d = dealsBy[c.id] || { deals_total: 0, deals_won: 0, revenue: 0 };
      const spent = Number(c.spent || 0);
      const revenue = Number(d.revenue || 0);
      return {
        ...c,
        leads_generated: leads,
        deals_total: d.deals_total || 0,
        deals_won: d.deals_won || 0,
        revenue,
        spent,
        // ROI as a percent; null when no spend is recorded yet
        roi: spent > 0 ? Math.round(((revenue - spent) / spent) * 100) : null,
        conversion_rate: leads > 0 ? Math.round((d.deals_won / leads) * 100) : null,
        cost_per_lead: leads > 0 && spent > 0 ? +(spent / leads).toFixed(2) : null,
      };
    });

    const totals = rows.reduce((a, r) => {
      a.spent += r.spent;
      a.revenue += r.revenue;
      a.leads += r.leads_generated;
      if (r.status === 'ACTIVE') a.active += 1;
      return a;
    }, { spent: 0, revenue: 0, leads: 0, active: 0 });
    totals.roi = totals.spent > 0
      ? Math.round(((totals.revenue - totals.spent) / totals.spent) * 100)
      : null;

    res.json({ data: { campaigns: rows, totals } });
  } catch (e) {
    fail(res, e, { status: 500, context: 'marketing:GET /rollup' });
  }
});

/* ════════════════════════════════════════════════════════════════════════
   Ad-platform adapters — each returns { externalCampaignId: spendNumber }
   using the company's OWN token. No token configured → never called.
   ════════════════════════════════════════════════════════════════════════ */

async function fetchMetaSpend({ token, adAccountId }) {
  const acct = String(adAccountId).startsWith('act_') ? adAccountId : `act_${adAccountId}`;
  let next =
    `https://graph.facebook.com/${META_API_VERSION}/${acct}/insights` +
    `?level=campaign&fields=campaign_id,spend&date_preset=maximum&limit=500` +
    `&access_token=${encodeURIComponent(token)}`;
  const out = {};
  let guard = 0;
  while (next && guard++ < 20) {
    const r = await fetch(next);
    const j = await r.json();
    if (j.error) throw new Error(j.error.message || 'Meta API error');
    for (const row of (j.data || [])) {
      if (row.campaign_id) out[String(row.campaign_id)] = Number(row.spend || 0);
    }
    next = j.paging && j.paging.next ? j.paging.next : null;
  }
  return out;
}

async function fetchTiktokSpend({ token, advertiserId }) {
  // Verify endpoint/version against current TikTok Business API docs when you wire a token.
  const params = new URLSearchParams({
    advertiser_id: advertiserId,
    report_type: 'BASIC',
    data_level: 'AUCTION_CAMPAIGN',
    dimensions: JSON.stringify(['campaign_id']),
    metrics: JSON.stringify(['spend']),
    lifetime: 'true',
  });
  const r = await fetch(
    `https://business-api.tiktok.com/open_api/v1.3/report/integrated/get/?${params.toString()}`,
    { headers: { 'Access-Token': token } }
  );
  const j = await r.json();
  if (j.code !== 0) throw new Error(j.message || 'TikTok API error');
  const out = {};
  for (const row of (j.data && j.data.list ? j.data.list : [])) {
    const id = row.dimensions && row.dimensions.campaign_id;
    if (id) out[String(id)] = Number((row.metrics && row.metrics.spend) || 0);
  }
  return out;
}

/* ════════════════════════════════════════════════════════════════════════
   POST /sync — refresh `spent` for every campaign that has an external mapping
   ════════════════════════════════════════════════════════════════════════ */
router.post('/sync', express.json(), async (req, res) => {
  const cid = req.user.company_id;
  const integ = db.prepare('SELECT * FROM company_integrations WHERE company_id = ?').get(cid);

  const result = { meta: 'skipped', tiktok: 'skipped', updated: 0, errors: [] };
  if (!integ) return res.json({ data: { ...result, configured: false } });

  const campaigns = db.prepare(
    `SELECT id, external_platform, external_campaign_id
       FROM marketing_campaigns
      WHERE company_id = ? AND external_campaign_id IS NOT NULL`
  ).all(cid);

  const update = db.prepare(
    `UPDATE marketing_campaigns
        SET spent = ?, spent_synced_at = datetime('now')
      WHERE id = ? AND company_id = ?`
  );

  const applySpend = (platform, spendMap) => {
    let n = 0;
    for (const c of campaigns) {
      if ((c.external_platform || '').toUpperCase() !== platform) continue;
      const s = spendMap[String(c.external_campaign_id)];
      if (s != null) { update.run(s, c.id, cid); n++; }
    }
    return n;
  };

  if (integ.meta_access_token && integ.meta_ad_account_id) {
    try {
      const map = await fetchMetaSpend({ token: integ.meta_access_token, adAccountId: integ.meta_ad_account_id });
      result.updated += applySpend('META', map);
      result.meta = 'ok';
    } catch (e) { result.meta = 'error'; result.errors.push('Meta: ' + safeMessage(e, 'request failed')); }
  }

  if (integ.tiktok_access_token && integ.tiktok_advertiser_id) {
    try {
      const map = await fetchTiktokSpend({ token: integ.tiktok_access_token, advertiserId: integ.tiktok_advertiser_id });
      result.updated += applySpend('TIKTOK', map);
      result.tiktok = 'ok';
    } catch (e) { result.tiktok = 'error'; result.errors.push('TikTok: ' + safeMessage(e, 'request failed')); }
  }

  try {
    db.prepare("UPDATE company_integrations SET ads_synced_at = datetime('now') WHERE company_id = ?").run(cid);
  } catch (e) { /* non-fatal */ }

  const configured = !!(integ.meta_access_token || integ.tiktok_access_token);
  res.json({ data: { ...result, configured } });
});

module.exports = router;
