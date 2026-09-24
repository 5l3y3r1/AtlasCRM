'use strict';
/**
 * routes/scraper.js — Ingestion endpoint for external listings.
 *
 * A real scraper (Python/cron/etc.) POSTs scraped rows here. This decouples
 * the scraping infrastructure from the CRM: the scraper can run anywhere and
 * just push normalized rows in.
 *
 *   POST /api/scraper/ingest
 *     Header:  X-Scraper-Key: <SCRAPER_KEY env>   (falls back to logged-in user)
 *     Body:    { listings: [ { source, external_id, external_url, title,
 *                              description, list_price, bedrooms, area_sqm,
 *                              region, city, district, owner_phone, is_owner } ] }
 *     Returns: { inserted, updated }
 *
 *   POST /api/scraper/sample   (auth required) — seeds demo external listings
 */
const express = require('express');
const { nanoid } = require('nanoid');
const { db } = require('../db');
const auth = require('../auth');
const { fail } = require('./_errors');

const router = express.Router();
router.use(express.json({ limit: '5mb' }));

// Same reasoning as the ingest keys: this default is in the source, so in
// production only an explicitly configured key is accepted.
const DEV_SCRAPER_KEY = 'warm-scraper-dev-key';
const SCRAPER_KEY = process.env.SCRAPER_KEY
  || (process.env.NODE_ENV === 'production' ? null : DEV_SCRAPER_KEY);

if (process.env.NODE_ENV === 'production' && !process.env.SCRAPER_KEY) {
  console.warn('[scraper] SCRAPER_KEY is not set. /api/scraper/ingest is DISABLED in production.');
}

function upsertListing(l) {
  const existing = (l.source && l.external_id)
    ? db.prepare('SELECT id FROM external_listings WHERE source = ? AND external_id = ?')
        .get(l.source, l.external_id)
    : null;

  const fields = {
    source:       l.source || 'unknown',
    external_id:  l.external_id || null,
    external_url: l.external_url || null,
    title:        l.title || null,
    description:  l.description || null,
    list_price:   l.list_price != null ? Number(l.list_price) : null,
    bedrooms:     l.bedrooms != null ? parseInt(l.bedrooms, 10) : null,
    area_sqm:     l.area_sqm != null ? Number(l.area_sqm) : null,
    region:       l.region || null,
    city:         l.city || null,
    district:     l.district || null,
    address:      l.address || null,
    deal_type:    l.deal_type || null,
    property_type: l.property_type || null,
    owner_phone:  l.owner_phone || null,
    is_owner:     l.is_owner ? 1 : 0,
    raw_data:     l.raw_data ? JSON.stringify(l.raw_data) : null,
  };

  if (existing) {
    const cols = Object.keys(fields);
    const setSql = cols.map(c => `"${c}" = ?`).join(',');
    db.prepare(`UPDATE external_listings SET ${setSql}, scraped_at = datetime('now') WHERE id = ?`)
      .run(...cols.map(c => fields[c]), existing.id);
    return { status: 'updated', id: existing.id };
  } else {
    const id = nanoid();
    const cols = ['id', ...Object.keys(fields)];
    const placeholders = cols.map(() => '?').join(',');
    db.prepare(`INSERT INTO external_listings (${cols.map(c => `"${c}"`).join(',')}) VALUES (${placeholders})`)
      .run(id, ...Object.keys(fields).map(c => fields[c]));
    return { status: 'inserted', id };
  }
}

// Scraper machines authenticate with a shared key; humans can use their session.
function scraperAuth(req, res, next) {
  const key = req.headers['x-scraper-key'];
  if (SCRAPER_KEY && key && key === SCRAPER_KEY) return next();
  // fall back to normal session auth
  if (req.user) return next();
  return res.status(401).json({ error: 'Invalid scraper key or not authenticated' });
}

router.post('/ingest', scraperAuth, (req, res) => {
  const listings = Array.isArray(req.body?.listings) ? req.body.listings : [];
  if (!listings.length) return res.status(400).json({ error: 'No listings provided' });

  let inserted = 0, updated = 0, alerts = 0;
  db.exec('BEGIN');
  try {
    for (const l of listings) {
      const r = upsertListing(l);
      if (r.status === 'inserted') inserted++; else updated++;
      // Match this listing against active hunting profiles → create alerts.
      alerts += matchListingToProfiles(r.id);
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    return fail(res, e, { status: 500, context: 'scraper:POST /ingest' });
  }
  res.json({ data: { inserted, updated, alerts }, error: null });
});

// Check one external listing against all active profiles; create a property_alert
// for each match that doesn't already exist. Returns number of new alerts.
function matchListingToProfiles(listingId) {
  const L = db.prepare('SELECT * FROM external_listings WHERE id = ?').get(listingId);
  if (!L) return 0;
  const profiles = db.prepare('SELECT * FROM agent_hunting_profiles WHERE is_active = 1').all();
  let created = 0;
  for (const p of profiles) {
    if (!profileMatches(p, L)) continue;
    // Skip if an alert already links this profile + listing.
    const exists = db.prepare(
      'SELECT id FROM property_alerts WHERE profile_id = ? AND external_listing_id = ?'
    ).get(p.id, listingId);
    if (exists) continue;
    db.prepare(
      `INSERT INTO property_alerts (id, profile_id, external_listing_id, match_score, status, is_read, company_id, agent_id)
       VALUES (?, ?, ?, ?, 'NEW', 0, ?, ?)`
    ).run(nanoid(), p.id, listingId, 1.0, p.company_id || null, p.agent_id || null);
    db.prepare('UPDATE agent_hunting_profiles SET match_count = COALESCE(match_count,0) + 1 WHERE id = ?').run(p.id);
    created++;
  }
  return created;
}

function profileMatches(p, L) {
  // Price range
  if (p.price_min != null && (L.list_price == null || L.list_price < p.price_min)) return false;
  if (p.price_max != null && (L.list_price == null || L.list_price > p.price_max)) return false;
  // Area range
  if (p.area_min != null && (L.area_sqm == null || L.area_sqm < p.area_min)) return false;
  if (p.area_max != null && (L.area_sqm == null || L.area_sqm > p.area_max)) return false;
  // Bedrooms range (bedrooms stored as text on listings)
  const lb = L.bedrooms != null && L.bedrooms !== '' ? parseInt(L.bedrooms, 10) : null;
  if (p.bedrooms_min != null && (lb == null || lb < p.bedrooms_min)) return false;
  if (p.bedrooms_max != null && (lb == null || lb > p.bedrooms_max)) return false;
  // Deal type (SALE/RENT/DAILY) — if profile specifies one, the listing must
  // have a deal_type and it must match (NULL deal_type fails a specific profile).
  if (p.deal_type) {
    if (!L.deal_type || p.deal_type !== L.deal_type) return false;
  }
  // Property type — if profile specifies one, the listing must have a matching
  // type. A listing with NO property_type (e.g. older un-tagged rows) does NOT
  // match a type-specific profile, so a COMMERCIAL profile never shows flats.
  const wantType = p.property_type || p.property_types;
  if (wantType) {
    const types = String(wantType).split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
    if (types.length) {
      if (!L.property_type) return false;
      if (!types.includes(String(L.property_type).toUpperCase())) return false;
    }
  }
  // Districts: profile.districts is JSON array of names; match if listing district is one of them
  if (p.districts) {
    let wanted = [];
    try { wanted = JSON.parse(p.districts); } catch { wanted = String(p.districts).split(','); }
    wanted = (wanted || []).map(s => String(s).trim()).filter(Boolean);
    if (wanted.length) {
      const d = (L.district || '').trim();
      const hit = wanted.some(w => d.includes(w) || w.includes(d));
      if (!hit) return false;
    }
  }
  // Owner/agency filter
  if (p.source_type_filter === 'OWNER' && !L.is_owner) return false;
  if (p.source_type_filter === 'AGENCY' && L.is_owner) return false;
  return true;
}

// Seed a handful of realistic demo rows so the AI Hunter page is usable.
router.post('/sample', auth.requireAuth, (req, res) => {
  const samples = [
    { source: 'myhome.ge', external_id: 'mh-100231', external_url: 'https://www.myhome.ge/pr/100231', title: '3 ოთახიანი ბინა ვაკეში, ჭავჭავაძის გამზ.', list_price: 165000, bedrooms: 3, area_sqm: 92, region: 'თბილისი', city: 'თბილისი', district: 'ვაკე', owner_phone: '+995 599 100 231', is_owner: 1 },
    { source: 'myhome.ge', external_id: 'mh-100544', external_url: 'https://www.myhome.ge/pr/100544', title: '2 ოთახიანი ბინა საბურთალოზე', list_price: 98000, bedrooms: 2, area_sqm: 64, region: 'თბილისი', city: 'თბილისი', district: 'საბურთალო', owner_phone: '+995 577 200 544', is_owner: 0 },
    { source: 'ss.ge', external_id: 'ss-77812', external_url: 'https://ss.ge/ka/real-estate/77812', title: '4 ოთახიანი ბინა ვერაზე, ეზოთი', list_price: 240000, bedrooms: 4, area_sqm: 130, region: 'თბილისი', city: 'თბილისი', district: 'ვერა', owner_phone: '+995 591 778 122', is_owner: 1 },
    { source: 'ss.ge', external_id: 'ss-78001', external_url: 'https://ss.ge/ka/real-estate/78001', title: 'სტუდიო ბინა ძველ თბილისში', list_price: 72000, bedrooms: 1, area_sqm: 38, region: 'თბილისი', city: 'თბილისი', district: 'ძველი თბილისი', owner_phone: '+995 555 780 010', is_owner: 0 },
    { source: 'myhome.ge', external_id: 'mh-101900', external_url: 'https://www.myhome.ge/pr/101900', title: '3 ოთახიანი ბინა ისანში, ახალი რემონტი', list_price: 110000, bedrooms: 3, area_sqm: 85, region: 'თბილისი', city: 'თბილისი', district: 'ისანი', owner_phone: '+995 598 119 000', is_owner: 1 },
  ];
  let inserted = 0, updated = 0;
  db.exec('BEGIN');
  try {
    for (const s of samples) { const r = upsertListing(s); if (r.status === 'inserted') inserted++; else updated++; }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); return fail(res, e, { status: 500, context: 'scraper:POST /sample' }); }
  res.json({ data: { inserted, updated }, error: null });
});

// Clear all external listings (e.g. to remove old demo/dummy rows).
// Optional ?source=myhome.ge to clear just one source.
router.delete('/external', auth.requireAuth, (req, res) => {
  try {
    if (req.query.source) {
      const r = db.prepare('DELETE FROM external_listings WHERE source = ?').run(req.query.source);
      return res.json({ data: { deleted: r.changes }, error: null });
    }
    const r = db.prepare('DELETE FROM external_listings').run();
    res.json({ data: { deleted: r.changes }, error: null });
  } catch (e) {
    fail(res, e, { status: 500, context: 'scraper:DELETE /external' });
  }
});

// Re-scan all existing external listings against active profiles.
// Called after a profile is created/edited so it picks up listings already stored.
router.post('/rematch', scraperAuth, (req, res) => {
  try {
    let alerts = 0, removed = 0;
    db.exec('BEGIN');
    // 1. Remove stale alerts whose listing no longer matches its profile
    //    (e.g. wrong-type alerts created before stricter matching).
    const existing = db.prepare(`
      SELECT pa.id AS alert_id, pa.profile_id, pa.external_listing_id
      FROM property_alerts pa`).all();
    for (const a of existing) {
      const p = db.prepare('SELECT * FROM agent_hunting_profiles WHERE id = ?').get(a.profile_id);
      const L = db.prepare('SELECT * FROM external_listings WHERE id = ?').get(a.external_listing_id);
      if (!p || !L || !profileMatches(p, L)) {
        db.prepare('DELETE FROM property_alerts WHERE id = ?').run(a.alert_id);
        removed++;
      }
    }
    // 2. Re-scan all listings to create any now-valid matches.
    const ids = db.prepare('SELECT id FROM external_listings').all().map(r => r.id);
    for (const id of ids) alerts += matchListingToProfiles(id);
    db.exec('COMMIT');
    res.json({ data: { scanned: ids.length, alerts, removed }, error: null });
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch {}
    fail(res, e, { status: 500, context: 'scraper:POST /rematch' });
  }
});

module.exports = router;
