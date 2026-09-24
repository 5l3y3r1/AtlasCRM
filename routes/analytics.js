'use strict';
/**
 * routes/analytics.js — Company statistics, scoped to the caller's company.
 *
 * GET /api/analytics?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * When a range is supplied, the same-length window immediately before it is
 * measured too and returned as `prev`, so the UI can show movement rather than
 * a bare number. A number with no baseline tells an agency owner very little:
 * "14 deals" only means something next to "11 last month".
 */
const express = require('express');
const router = express.Router();
const { db } = require('../db');
const auth = require('../auth');
router.use(express.json());

const q1 = (sql, ...p) => { try { return db.prepare(sql).get(...p) || {}; } catch (e) { return {}; } };
const qa = (sql, ...p) => { try { return db.prepare(sql).all(...p); } catch (e) { return []; } };

const DAY = 86400000;
const iso = (d) => d.toISOString().slice(0, 10);

/** The equal-length window ending the day before `from`. */
function previousWindow(from, to) {
  const f = Date.parse(from + 'T00:00:00Z');
  const t = Date.parse(to + 'T00:00:00Z');
  if (isNaN(f) || isNaN(t) || t < f) return null;
  const span = t - f + DAY;
  return { from: iso(new Date(f - span)), to: iso(new Date(f - DAY)) };
}

router.get('/', auth.requireAuth, (req, res) => {
  const cid = req.user.company_id;
  const from = (req.query.from || '').toString().trim();
  const to = (req.query.to || '').toString().trim();

  // Builds the " AND col BETWEEN ? AND ?" fragment for a given window.
  const rangeFor = (col, f, t) => {
    let s = '', p = [];
    if (f) { s += ` AND ${col} >= ?`; p.push(f); }
    if (t) { s += ` AND ${col} <= ?`; p.push(t + ' 23:59:59'); }
    return { s, p };
  };

  /** Every figure that is meaningful "within a window", for any window. */
  function metricsFor(f, t) {
    const d = rangeFor('created_at', f, t);
    // Deals are dated by when they closed, falling back to creation for rows
    // that never got a closed_at — otherwise a closed deal can sit outside
    // every window and vanish from the totals.
    const c = rangeFor("COALESCE(closed_at, created_at)", f, t);

    const dealsClosed = q1(`SELECT COUNT(*) n FROM deals WHERE company_id=? AND current_stage='CLOSED_WON'${c.s}`, cid, ...c.p).n || 0;
    const dealsLost   = q1(`SELECT COUNT(*) n FROM deals WHERE company_id=? AND current_stage='CLOSED_LOST'${c.s}`, cid, ...c.p).n || 0;
    const dealsOpen   = q1(`SELECT COUNT(*) n FROM deals WHERE company_id=? AND current_stage NOT IN ('CLOSED_WON','CLOSED_LOST')${d.s}`, cid, ...d.p).n || 0;
    const revenue     = q1(`SELECT COALESCE(SUM(final_price),0) v FROM deals WHERE company_id=? AND current_stage='CLOSED_WON'${c.s}`, cid, ...c.p).v || 0;
    const commission  = q1(`SELECT COALESCE(SUM(commission_amount),0) v FROM deals WHERE company_id=? AND current_stage='CLOSED_WON'${c.s}`, cid, ...c.p).v || 0;

    const newClients = q1(`SELECT COUNT(*) n FROM clients WHERE company_id=?${d.s}`, cid, ...d.p).n || 0;
    const newLeads   = q1(`SELECT COUNT(*) n FROM leads WHERE company_id=?${d.s}`, cid, ...d.p).n || 0;

    const settled = dealsClosed + dealsLost;
    return {
      dealsClosed, dealsLost, dealsOpen, revenue, commission, newClients, newLeads,
      avgDealSize: dealsClosed ? Math.round(revenue / dealsClosed) : 0,
      // Share of concluded deals that were won. Open deals are excluded —
      // counting them as losses would make a healthy pipeline look like failure.
      winRate: settled ? Math.round((dealsClosed / settled) * 100) : 0,
    };
  }

  const current = metricsFor(from, to);

  // Deltas need two comparable windows, so they only exist when a range is set.
  let prev = null, prevRange = null;
  if (from && to) {
    prevRange = previousWindow(from, to);
    if (prevRange) prev = metricsFor(prevRange.from, prevRange.to);
  }

  // ── Time to close: how long a won deal takes, in days ──
  const daysToClose = q1(
    `SELECT AVG(julianday(closed_at) - julianday(created_at)) v
       FROM deals
      WHERE company_id=? AND current_stage='CLOSED_WON'
        AND closed_at IS NOT NULL AND created_at IS NOT NULL
        -- Rows where closed_at predates created_at are bad data (back-dated
        -- imports, mostly). Averaging them in produces a negative "days to
        -- close", which is worse than showing nothing.
        AND julianday(closed_at) >= julianday(created_at)`, cid).v;

  // ── Monthly series (always the trailing 12 months, independent of filter) ──
  const monthly = qa(
    `SELECT substr(COALESCE(closed_at,created_at),1,7) ym,
            COALESCE(SUM(final_price),0) v, COUNT(*) n
       FROM deals
      WHERE company_id=? AND current_stage='CLOSED_WON'
        AND COALESCE(closed_at,created_at) IS NOT NULL
      GROUP BY ym ORDER BY ym DESC LIMIT 12`, cid).reverse();

  const monthlyClients = qa(
    `SELECT substr(created_at,1,7) ym, COUNT(*) n FROM clients
      WHERE company_id=? GROUP BY ym ORDER BY ym DESC LIMIT 12`, cid).reverse();

  // ── Clients ──
  const activeClients = q1(`SELECT COUNT(*) n FROM clients WHERE company_id=? AND (status='ACTIVE' OR status IS NULL)`, cid).n || 0;
  const totalClients  = q1(`SELECT COUNT(*) n FROM clients WHERE company_id=?`, cid).n || 0;

  // ── Leads ──
  const dl = rangeFor('created_at', from, to);
  const totalLeads = q1(`SELECT COUNT(*) n FROM leads WHERE company_id=?`, cid).n || 0;
  const convertedLeads = q1(`SELECT COUNT(*) n FROM leads WHERE company_id=? AND status='CONVERTED'${dl.s}`, cid, ...dl.p).n || 0;
  const leadsBySource = qa(
    `SELECT COALESCE(NULLIF(source,''),'OTHER') k, COUNT(*) n FROM leads
      WHERE company_id=?${dl.s} GROUP BY k ORDER BY n DESC LIMIT 8`, cid, ...dl.p);
  const leadsByTemp = qa(
    `SELECT COALESCE(NULLIF(temperature,''),'COLD') k, COUNT(*) n FROM leads
      WHERE company_id=?${dl.s} GROUP BY k ORDER BY n DESC`, cid, ...dl.p);
  // Of the leads created in the window, how many became clients.
  const leadConversion = current.newLeads ? Math.round((convertedLeads / current.newLeads) * 100) : 0;

  // ── Properties ──
  const totalProps  = q1(`SELECT COUNT(*) n FROM listings WHERE company_id=?`, cid).n || 0;
  const activeProps = q1(`SELECT COUNT(*) n FROM listings WHERE company_id=? AND status='ACTIVE'`, cid).n || 0;
  const soldProps   = q1(`SELECT COUNT(*) n FROM listings WHERE company_id=? AND status IN ('SOLD','CLOSED')`, cid).n || 0;
  const rentedProps = q1(`SELECT COUNT(*) n FROM listings WHERE company_id=? AND status='RENTED'`, cid).n || 0;
  const avgPrice    = q1(`SELECT COALESCE(AVG(NULLIF(list_price,0)),0) v FROM listings WHERE company_id=? AND status='ACTIVE'`, cid).v || 0;
  // Grouped on property_type. The previous version grouped on `deal_type`,
  // which does not exist on listings, so every row fell into "other".
  const propTypes = qa(
    `SELECT COALESCE(NULLIF(property_type,''),'OTHER') k, COUNT(*) n FROM listings
      WHERE company_id=? GROUP BY k ORDER BY n DESC LIMIT 8`, cid);
  const propByDistrict = qa(
    `SELECT COALESCE(NULLIF(district,''),'—') k, COUNT(*) n FROM listings
      WHERE company_id=? GROUP BY k ORDER BY n DESC LIMIT 6`, cid);

  // ── Agent performance ──
  // Founders are included: in a small agency the founder is usually the top
  // seller, and excluding them made the leaderboard misrepresent the business.
  const dealWin = rangeFor("COALESCE(d.closed_at, d.created_at)", from, to);
  const agents = qa(
    `SELECT u.id, u.first_name, u.last_name, u.role, u.avatar_url,
       (SELECT COUNT(*) FROM deals d WHERE d.company_id=? AND (d.buyer_agent_id=u.id OR d.seller_agent_id=u.id) AND d.current_stage='CLOSED_WON'${dealWin.s}) closed,
       (SELECT COALESCE(SUM(d.final_price),0) FROM deals d WHERE d.company_id=? AND (d.buyer_agent_id=u.id OR d.seller_agent_id=u.id) AND d.current_stage='CLOSED_WON'${dealWin.s}) revenue,
       (SELECT COALESCE(SUM(d.commission_amount),0) FROM deals d WHERE d.company_id=? AND (d.buyer_agent_id=u.id OR d.seller_agent_id=u.id) AND d.current_stage='CLOSED_WON'${dealWin.s}) commission,
       (SELECT COUNT(*) FROM listings l WHERE l.company_id=? AND l.agent_id=u.id) listings
     FROM users u
     WHERE u.company_id=? AND u.is_active=1
     ORDER BY revenue DESC, closed DESC`,
    cid, ...dealWin.p, cid, ...dealWin.p, cid, ...dealWin.p, cid, cid);

  res.json({
    data: {
      range: { from: from || null, to: to || null, previous: prevRange },
      sales: {
        ...current,
        avgDaysToClose: daysToClose ? Math.round(daysToClose) : null,
        monthly,
      },
      prev,
      clients: {
        newClients: current.newClients, activeClients, totalClients,
        // Deals closed per client on the books — a crude but honest read on
        // how much business each relationship produces.
        conversionRate: totalClients ? Math.round((current.dealsClosed / totalClients) * 100) : 0,
        monthly: monthlyClients,
      },
      leads: {
        total: totalLeads, newLeads: current.newLeads,
        converted: convertedLeads, conversionRate: leadConversion,
        bySource: leadsBySource, byTemperature: leadsByTemp,
      },
      properties: {
        total: totalProps, active: activeProps, sold: soldProps, rented: rentedProps,
        avgPrice: Math.round(avgPrice), types: propTypes, byDistrict: propByDistrict,
      },
      agents,
    },
    error: null,
  });
});

module.exports = router;
