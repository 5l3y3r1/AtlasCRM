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

const router = express.Router();
router.use(express.json({ limit: '5mb' }));

const SCRAPER_KEY = process.env.SCRAPER_KEY || 'warm-scraper-dev-key';

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
    owner_phone:  l.owner_phone || null,
    is_owner:     l.is_owner ? 1 : 0,
    raw_data:     l.raw_data ? JSON.stringify(l.raw_data) : null,
  };

  if (existing) {
    const cols = Object.keys(fields);
    const setSql = cols.map(c => `"${c}" = ?`).join(',');
    db.prepare(`UPDATE external_listings SET ${setSql}, scraped_at = datetime('now') WHERE id = ?`)
      .run(...cols.map(c => fields[c]), existing.id);
    return 'updated';
  } else {
    const id = nanoid();
    const cols = ['id', ...Object.keys(fields)];
    const placeholders = cols.map(() => '?').join(',');
    db.prepare(`INSERT INTO external_listings (${cols.map(c => `"${c}"`).join(',')}) VALUES (${placeholders})`)
      .run(id, ...Object.keys(fields).map(c => fields[c]));
    return 'inserted';
  }
}

// Scraper machines authenticate with a shared key; humans can use their session.
function scraperAuth(req, res, next) {
  const key = req.headers['x-scraper-key'];
  if (key && key === SCRAPER_KEY) return next();
  // fall back to normal session auth
  if (req.user) return next();
  return res.status(401).json({ error: 'Invalid scraper key or not authenticated' });
}

router.post('/ingest', scraperAuth, (req, res) => {
  const listings = Array.isArray(req.body?.listings) ? req.body.listings : [];
  if (!listings.length) return res.status(400).json({ error: 'No listings provided' });

  let inserted = 0, updated = 0;
  db.exec('BEGIN');
  try {
    for (const l of listings) {
      const r = upsertListing(l);
      if (r === 'inserted') inserted++; else updated++;
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    return res.status(500).json({ error: e.message });
  }
  res.json({ data: { inserted, updated }, error: null });
});

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
    for (const s of samples) { const r = upsertListing(s); if (r === 'inserted') inserted++; else updated++; }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); return res.status(500).json({ error: e.message }); }
  res.json({ data: { inserted, updated }, error: null });
});

module.exports = router;
