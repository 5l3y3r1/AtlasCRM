/**
 * routes/import.js — fetch a myhome/ss.ge listing by URL, download its photos,
 * and stage it as a draft in listing_imports. Posting itself stays in the
 * user's browser via a bookmarklet served by GET /bookmarklet/:id.
 */
const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { nanoid } = require('nanoid');
const { db, SCHEMA_CACHE } = require('../db');
const auth = require('../auth');
const { fail } = require('./_errors');

router.use(express.json({ limit: '1mb' }));

const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(__dirname, '..', 'uploads');
const IMPORTS_DIR = path.join(UPLOADS_DIR, 'imports');
try { fs.mkdirSync(IMPORTS_DIR, { recursive: true }); } catch {}

const HEADERS = {
  'Accept': '*/*',
  'Accept-Language': 'ka',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  'x-nextjs-data': '1',
  'Referer': 'https://www.myhome.ge/',
};

async function getMyhomeBuildId() {
  const res = await fetch('https://www.myhome.ge/', { headers: HEADERS });
  const html = await res.text();
  const m = html.match(/"buildId":"([^"]+)"/);
  if (!m) throw new Error('myhome build id not found');
  return m[1];
}

// myhome detail URL → product id + slug
function parseMyhomeUrl(url) {
  // /pr/{id}/{slug}
  const m = url.match(/myhome\.ge\/pr\/(\d+)\/([^/?#]+)/);
  if (!m) return null;
  return { id: m[1], slug: m[2] };
}

async function fetchMyhomeListing(url) {
  const parsed = parseMyhomeUrl(url);
  if (!parsed) throw new Error('Not a recognized myhome.ge listing URL');
  const build = await getMyhomeBuildId();
  const jsonUrl = `https://www.myhome.ge/_next/data/${build}/ka/pr/${parsed.id}/${parsed.slug}.json?productId=${parsed.id}&slug=${parsed.slug}`;
  const res = await fetch(jsonUrl, { headers: HEADERS });
  if (!res.ok) throw new Error(`myhome HTTP ${res.status}`);
  const payload = await res.json();

  // Deep search the JSON for any object that "looks like a listing" — must
  // contain enough listing fields to be the real one (not a related/recommended).
  // myhome has nested wrappers like pageProps.statement.data.statement etc.
  const looksLikeListing = (o) => {
    if (!o || typeof o !== 'object' || Array.isArray(o)) return false;
    const has = (k) => k in o;
    let score = 0;
    if (has('real_estate_type_id') || has('deal_type_id')) score += 2;
    if (has('price') && typeof o.price === 'object') score += 2;
    if (has('dynamic_title') || has('title')) score += 1;
    if (has('area') || has('total_area')) score += 1;
    if (has('address') || has('street_address')) score += 1;
    if (has('user_type') || has('user_id')) score += 1;
    if (has('images')) score += 1;
    return score >= 4; // needs several listing-like fields
  };

  let best = null;
  const visit = (node, depth = 0) => {
    if (depth > 8 || !node) return;
    if (looksLikeListing(node)) {
      if (!best || Object.keys(node).length > Object.keys(best).length) best = node;
      return;
    }
    if (Array.isArray(node)) { for (const v of node) visit(v, depth + 1); return; }
    if (typeof node === 'object') { for (const v of Object.values(node)) visit(v, depth + 1); }
  };
  visit(payload);

  if (!best) {
    // Save the response so we can inspect structure and tune the matcher.
    const dumpPath = path.join(IMPORTS_DIR, `_debug_${Date.now()}.json`);
    try { fs.writeFileSync(dumpPath, JSON.stringify(payload, null, 2)); } catch {}
    const topKeys = Object.keys(payload?.pageProps || payload || {}).slice(0, 15).join(', ');
    throw new Error(`Listing data not found. Saved debug dump to ${dumpPath}. Top keys: ${topKeys}`);
  }
  return best;
}

function mapMyhomeToDraft(it) {
  const dealMap = { 1: 'SALE', 2: 'RENT', 7: 'DAILY', '1': 'SALE', '2': 'RENT', '7': 'DAILY' };
  const reMap = { 1: 'APARTMENT', 2: 'HOUSE', 3: 'COTTAGE', 4: 'LAND', 5: 'COMMERCIAL', 7: 'HOTEL',
                  '1': 'APARTMENT', '2': 'HOUSE', '3': 'COTTAGE', '4': 'LAND', '5': 'COMMERCIAL', '7': 'HOTEL' };
  // Price: myhome's `price` is keyed by currency id ("1"=GEL, "2"=USD, "3"=EUR);
  // there's also a top-level total_price + currency_id. Prefer USD total.
  let priceUSD = null, pricePerSqm = null;
  const p = it.price;
  if (p && typeof p === 'object') {
    if (p['2']?.price_total) { priceUSD = Math.round(Number(p['2'].price_total)); pricePerSqm = p['2'].price_square ? Math.round(Number(p['2'].price_square)) : null; }
    else if (p['1']?.price_total) { priceUSD = Math.round(Number(p['1'].price_total) / 2.7); }
  }
  if (priceUSD == null && it.total_price) {
    priceUSD = (Number(it.currency_id) === 2) ? Math.round(Number(it.total_price)) : Math.round(Number(it.total_price) / 2.7);
  }
  const photos = Array.isArray(it.images) ? it.images.map(im =>
    im?.large || im?.thumb || im?.url || im
  ).filter(u => typeof u === 'string') : [];
  // myhome stores room counts as *_type_id (the id equals the count for small
  // values, with the top bucket meaning "N+"). Good enough to surface the count.
  const roomCount = it.room_type_id != null ? Number(it.room_type_id) : null;
  const bedCount  = it.bedroom_type_id != null ? Number(it.bedroom_type_id) : null;
  const bathCount = it.bathroom_type_id != null ? Number(it.bathroom_type_id) : null;
  return {
    title: it.dynamic_title || it.title || null,
    description: it.comment || it.additional_information || it.description || null,
    list_price: priceUSD,
    price_per_sqm: pricePerSqm,
    currency: 'USD',
    deal_type: dealMap[it.deal_type_id] || null,
    property_type: reMap[it.real_estate_type_id] || null,
    area_sqm: it.area != null ? Number(it.area) : null,
    rooms: roomCount,
    bedrooms: bedCount,
    bathrooms: bathCount,
    floor: it.floor != null ? Number(it.floor) : null,
    total_floors: it.total_floors != null ? Number(it.total_floors) : null,
    year_built: it.build_year != null ? Number(it.build_year) : null,
    cadastral_code: it.rs_code || null,
    // Pass raw coords; geoFix() in createListing validates and fixes order.
    latitude:  it.lat != null ? Number(it.lat) : null,
    longitude: it.lng != null ? Number(it.lng) : null,
    city: it.city_name || null,
    district: it.urban_name || it.district_name || null,
    address: it.address || null,
    owner_phone: it.user_phone_number || it.additional_phone_number || it.telephone || null,
    owner_phone2: (it.user_phone_number && it.additional_phone_number && it.additional_phone_number !== it.user_phone_number) ? it.additional_phone_number : null,
    owner_name: it.owner_name || it.user_title || null,
    photos_remote: photos,
  };
}

async function downloadPhotos(remoteUrls, importId) {
  const dir = path.join(IMPORTS_DIR, importId);
  fs.mkdirSync(dir, { recursive: true });
  const saved = [];
  for (let i = 0; i < remoteUrls.length; i++) {
    const url = remoteUrls[i];
    try {
      const r = await fetch(url);
      if (!r.ok) continue;
      const buf = Buffer.from(await r.arrayBuffer());
      const ext = (url.match(/\.(jpe?g|png|webp)(?:\?|$)/i) || [, 'jpg'])[1].toLowerCase();
      const filename = `${String(i + 1).padStart(2, '0')}.${ext}`;
      fs.writeFileSync(path.join(dir, filename), buf);
      saved.push(`/uploads/imports/${importId}/${filename}`);
    } catch { /* skip broken images */ }
  }
  return saved;
}

/* ── POST /api/import/url   body: { url } ───────────────────────────── */
router.post('/url', auth.requireAuth, async (req, res) => {
  const url = String(req.body?.url || '').trim();
  if (!url) return res.status(400).json({ error: 'url required' });

  try {
    let draft, source;
    if (/myhome\.ge\/pr\//.test(url)) {
      source = 'myhome.ge';
      const it = await fetchMyhomeListing(url);
      draft = mapMyhomeToDraft(it);
      draft._raw = it;
    } else if (/ss\.ge/.test(url)) {
      return res.status(400).json({ error: 'ss.ge imports need a session token; use myhome for now or paste the data manually' });
    } else {
      return res.status(400).json({ error: 'Unsupported URL (myhome.ge supported)' });
    }

    const id = nanoid();
    const photoPaths = await downloadPhotos(draft.photos_remote || [], id);

    db.prepare(`INSERT INTO listing_imports
      (id, company_id, user_id, source, source_url, title, description, list_price, currency,
       deal_type, property_type, area_sqm, rooms, bedrooms, floor, total_floors,
       city, district, address, owner_phone, photos_json, raw_data, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT')`)
      .run(id, req.user.company_id, req.user.id, source, url,
           draft.title, draft.description, draft.list_price, draft.currency,
           draft.deal_type, draft.property_type, draft.area_sqm, draft.rooms, draft.bedrooms,
           draft.floor, draft.total_floors, draft.city, draft.district, draft.address, draft.owner_phone,
           JSON.stringify(photoPaths), JSON.stringify(draft._raw));

    res.json({ data: { id, photos: photoPaths.length, ...draft, _raw: undefined }, error: null });
  } catch (e) {
    console.error('import error:', e.message);
    fail(res, e, { status: 500, context: 'import:POST /url' });
  }
});

/* ── GET /api/import/:id/card ─────────────────────────────────────────
 * Returns a self-contained HTML page with all the staged data and
 * per-field copy buttons. Opened in a small floating window the user
 * keeps next to the myhome create tab — paste each field manually.
 * Reliable forever because it doesn't touch myhome's DOM at all.
 */
router.get('/:id/card', auth.requireAuth, (req, res) => {
  const row = db.prepare('SELECT * FROM listing_imports WHERE id = ? AND company_id = ?')
    .get(req.params.id, req.user.company_id);
  if (!row) return res.status(404).send('Not found');
  const photos = (() => { try { return JSON.parse(row.photos_json || '[]'); } catch { return []; } })();
  const propNames = { APARTMENT: 'ბინა', HOUSE: 'სახლი', LAND: 'მიწა', COMMERCIAL: 'კომერციული', COTTAGE: 'აგარაკი', HOTEL: 'სასტუმრო' };
  const dealNames = { SALE: 'იყიდება', RENT: 'ქირავდება', DAILY: 'დღიურად' };
  const safe = (v) => v == null || v === '' ? '' : String(v);
  // Fields shown in order; each is a label + value with a copy button.
  const fields = [
    ['სათაური',      row.title],
    ['აღწერა',        row.description],
    ['ფასი ($)',      row.list_price],
    ['ფართი (მ²)',    row.area_sqm],
    ['ოთახები',       row.rooms],
    ['საძინებლები',   row.bedrooms],
    ['სართული',       row.floor],
    ['სართულიანობა',  row.total_floors],
    ['ქალაქი',        row.city],
    ['უბანი',         row.district],
    ['მისამართი',     row.address],
    ['ტელეფონი',      row.owner_phone],
    ['გარიგების ტიპი', dealNames[row.deal_type] || row.deal_type],
    ['ობიექტის ტიპი',  propNames[row.property_type] || row.property_type],
  ];
  const rowsHtml = fields
    .filter(([_, v]) => v != null && v !== '')
    .map(([label, value]) => {
      const v = safe(value).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
      const longVal = String(value).length > 50;
      return `<tr>
        <td class="lbl">${label}</td>
        <td class="val ${longVal ? 'long' : ''}">${String(value).replace(/</g,'&lt;')}</td>
        <td class="act"><button data-v="${v}" title="დააკოპირე">📋</button></td>
      </tr>`;
    }).join('');
  const photosHtml = photos.length ? `
    <h3>ფოტოები (${photos.length})</h3>
    <p class="note">გადააწევით myhome-ის ფოტო ფანჯარაში, ან ჩამოტვირთეთ</p>
    <div class="photos">
      ${photos.map((p, i) => `<a href="${p}" download target="_blank" draggable="true"><img src="${p}" alt="${i+1}"></a>`).join('')}
    </div>` : '<p class="note">ფოტო არ არის</p>';
  const html = `<!DOCTYPE html>
<html lang="ka"><head><meta charset="utf-8">
<title>${safe(row.title) || 'Listing data'}</title>
<style>
:root { --bg:#fff; --fg:#222; --muted:#666; --line:#e5e5e7; --brand:#e8412e; --soft:#fef2f1; }
* { box-sizing: border-box; }
body { margin:0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; color: var(--fg); background: var(--bg); font-size: 13px; }
header { padding: 12px 14px; border-bottom: 1px solid var(--line); background: var(--soft); position: sticky; top: 0; z-index: 10; }
header h1 { margin: 0; font-size: 14px; color: var(--brand); }
header p { margin: 4px 0 0; font-size: 11px; color: var(--muted); }
.body { padding: 12px 14px 24px; }
table { width: 100%; border-collapse: collapse; margin-bottom: 18px; }
td { padding: 8px 6px; border-bottom: 1px solid var(--line); vertical-align: top; }
td.lbl { width: 38%; color: var(--muted); font-size: 12px; }
td.val { font-weight: 600; word-break: break-word; }
td.val.long { font-weight: 400; font-size: 12px; white-space: pre-wrap; }
td.act { width: 36px; text-align: right; }
td.act button { background: var(--soft); border: 1px solid var(--line); padding: 4px 8px; border-radius: 6px; cursor: pointer; font-size: 13px; }
td.act button:hover { background: var(--brand); color: #fff; }
td.act button.done { background: #1a7f43; color: #fff; border-color: #1a7f43; }
h3 { margin: 0 0 10px; font-size: 13px; }
.note { color: var(--muted); font-size: 12px; margin: 0 0 12px; }
.photos { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; }
.photos a { display: block; border-radius: 6px; overflow: hidden; border: 1px solid var(--line); cursor: grab; }
.photos a:active { cursor: grabbing; }
.photos img { width: 100%; height: 80px; object-fit: cover; display: block; }
.btn-all { width: 100%; padding: 8px; margin-bottom: 12px; background: var(--brand); color: #fff; border: none; border-radius: 6px; cursor: pointer; font-weight: 600; font-size: 12px; }
.btn-all:hover { opacity: 0.9; }
</style></head><body>
<header>
  <h1>📋 ${safe(row.title) || 'Listing'}</h1>
  <p>დააჭირე ღილაკს თითო ველთან → ჩასვი myhome-ის ფორმაში (Ctrl+V)</p>
</header>
<div class="body">
  <button class="btn-all" id="copyAll">📋 ყველაფერი ერთად დააკოპირე</button>
  <table>${rowsHtml}</table>
  ${photosHtml}
</div>
<script>
  // Per-field copy buttons. Click → clipboard → green check briefly.
  document.querySelectorAll('td.act button').forEach(btn => {
    btn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(btn.dataset.v);
        const t = btn.textContent;
        btn.textContent = '✓'; btn.classList.add('done');
        setTimeout(() => { btn.textContent = t; btn.classList.remove('done'); }, 900);
      } catch (e) { alert('Copy failed: ' + e.message); }
    });
  });
  // "Copy all" — text dump of every label: value
  document.getElementById('copyAll').addEventListener('click', async () => {
    const lines = [];
    document.querySelectorAll('table tr').forEach(tr => {
      const lbl = tr.querySelector('.lbl')?.textContent;
      const val = tr.querySelector('.val')?.textContent;
      if (lbl && val) lines.push(lbl + ': ' + val);
    });
    await navigator.clipboard.writeText(lines.join('\\n'));
    const b = document.getElementById('copyAll');
    const t = b.textContent;
    b.textContent = '✓ დაკოპირდა'; setTimeout(() => b.textContent = t, 1200);
  });
</script>
</body></html>`;
  res.type('html').send(html);
});


router.get('/:id/bookmarklet', auth.requireAuth, (req, res) => {
  const row = db.prepare('SELECT * FROM listing_imports WHERE id = ? AND company_id = ?')
    .get(req.params.id, req.user.company_id);
  if (!row) return res.status(404).json({ error: 'not found' });
  // Build a simple field map. myhome's create form selectors change, so the
  // Real autofill: label-based field matching + React's native setter trick.
  // Each entry: list of Georgian label keywords → CRM data key.
  // Add/edit keywords here when myhome renames a label or adds a field.
  const data = {
    district: row.district, address: row.address,
    price: row.list_price, area: row.area_sqm,
    floor: row.floor, total_floors: row.total_floors,
    description: row.description,
  };
  const snippet = `(() => {
  const D = ${JSON.stringify(data)};
  const log = [];
  const filled = [], skipped = [];

  // --- React's hidden native setter: setting .value directly doesn't trigger
  // React's onChange handler, so React's internal state stays empty. We grab
  // the native HTMLInputElement.prototype.value setter and call it directly,
  // then dispatch an 'input' event React's listener catches.
  const nativeInputSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  const nativeTextareaSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
  const reactSet = (el, value) => {
    const setter = el.tagName === 'TEXTAREA' ? nativeTextareaSetter : nativeInputSetter;
    setter.call(el, value == null ? '' : String(value));
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
  };

  // --- Walk up from \`el\` collecting text from siblings; check if any of the
  // \`keywords\` appears in that nearby text. Used to identify what each input is.
  const getNearbyText = (el, depth = 5) => {
    const texts = [];
    let n = el;
    for (let d = 0; d < depth; d++) {
      n = n.parentElement;
      if (!n) break;
      n.querySelectorAll('label, span, p, div').forEach(x => {
        if (x.contains(el)) return;
        const t = x.textContent.trim();
        if (t && t.length < 50) texts.push(t);
      });
      if (texts.length >= 3) break;
    }
    return texts.join(' | ');
  };

  const matchLabel = (el, keywords) => {
    const near = getNearbyText(el);
    return keywords.some(k => near.includes(k));
  };

  // --- Visual outline helper. Green=filled, red=skipped, so you see at a
  // glance what worked. Outline auto-fades after 10s.
  const outline = (el, color) => {
    if (!el || !el.style) return;
    el.style.outline = '3px solid ' + color;
    el.style.outlineOffset = '2px';
    setTimeout(() => { try { el.style.outline = ''; } catch {} }, 10000);
  };

  // --- Map each field we have to label keywords, then find + fill.
  const FIELDS = [
    // [crm data key, [Georgian label keywords], excluded labels (avoid false matches)]
    ['district',     ['მდებარეობა'],         []],
    ['address',      ['ქუჩა'],                ['ქუჩის ნომერი', 'ქართულად','რუსულად','ინგლისურად']],
    ['price',        ['სრული ფასი'],          ['კვ']],
    ['area',         ['ფართი'],               []],
    ['floor',        ['სართული'],             ['სართულები სულ']],
    ['total_floors', ['სართულები სულ'],       []],
    ['description',  ['დაწერეთ დამატებითი აღწერა'], ['ინგლისურად','რუსულად']],
  ];

  const inputs = [...document.querySelectorAll('input[type="text"], textarea, input[type="number"]')];
  for (const [key, includes, excludes] of FIELDS) {
    const value = D[key];
    if (value == null || value === '') { skipped.push(\`\${key}: no data\`); continue; }
    // Find: includes-match AND not excludes-match. First hit wins.
    const target = inputs.find(el => {
      const near = getNearbyText(el);
      const hasInclude = includes.some(k => near.includes(k));
      const hasExclude = excludes.some(k => near.includes(k));
      return hasInclude && !hasExclude;
    });
    if (!target) {
      skipped.push(\`\${key}: NO INPUT FOUND for labels \${JSON.stringify(includes)}\`);
      continue;
    }
    try {
      target.focus();
      reactSet(target, value);
      filled.push(\`\${key} → "\${String(value).slice(0, 40)}"\`);
      outline(target, '#1a7f43');
    } catch (e) {
      skipped.push(\`\${key}: ERROR \${e.message}\`);
      outline(target, '#e8412e');
    }
  }

  console.log('%c=== AtlasCRM autofill v1 ===', 'font-weight:bold;color:#e8412e;font-size:14px');
  console.log('%c✓ Filled (' + filled.length + '):', 'color:#1a7f43;font-weight:bold');
  filled.forEach(f => console.log('  ' + f));
  console.log('%c⚠ Skipped (' + skipped.length + '):', 'color:#e8412e;font-weight:bold');
  skipped.forEach(s => console.log('  ' + s));
  console.log('%cℹ Remaining fields (property type, rooms/bedrooms, amenities, photos) need manual selection. Green outline = filled, red = error.', 'color:#666');
  alert(\`AtlasCRM autofill: \${filled.length} filled, \${skipped.length} skipped. Check console for details.\`);
})();`;
  res.type('text/javascript').send(snippet);
});

/* ───────────────────────────────────────────────────────────────────────
 * EXTENSION INGEST  —  POST /api/import/ingest
 *
 * The AtlasCRM browser extension already scrapes the raw listing object
 * straight off the open myhome/ss.ge tab (the __NEXT_DATA__ payload), so it
 * can push it here directly. This unlocks ss.ge too, which /url can't fetch
 * server-side because it needs a logged-in session token.
 *
 *   Auth:  X-CRM-Key: <the agent's own key, from Settings → Extension Key>
 *          ...or X-CRM-Key: <CRM_INGEST_KEY>  (shared/legacy — maps every
 *              request to one fixed account, see resolveActor below)
 *          ...or a normal logged-in CRM session (cookie / Bearer).
 *   Body:  { source: 'myhome'|'ss', url?, raw: <scraped object> }
 *   Does:  map → download photos → stage in listing_imports as DRAFT.
 *   Returns: { id, photos, ...draft }
 * ─────────────────────────────────────────────────────────────────────── */

// Valid ingest keys. Includes any set via CRM_INGEST_KEY (comma-separated) plus
// the baked keys the distributed extension uses — so ingest works even without
// extra Railway configuration. Rotate by editing this list / the env var.
// Keys that ship in this file are PUBLIC — anyone who can read the source (or
// the repository) has them. A valid key resolves to a real company and one of
// its owners, so accepting them in production lets a stranger write listings
// into whichever agency signed up first. They are therefore development-only.
const BAKED_INGEST_KEYS = [
  '015fec0b3e41da3bcc4f84a4821cf6ac',
  'a86f8872af9f44b7e8f0bf85a80fe486',
  'f31af4ecaac0217f5b8546b5fe058c77',
  '583a37ee2cde601a1e9cac9b5b01a10b',
  'bed0aac65b547878f309ae06b1d3bf92',
  'warm-crm-ingest-dev-key',
];
const CONFIGURED_INGEST_KEYS = String(process.env.CRM_INGEST_KEY || '')
  .split(',').map(s => s.trim()).filter(Boolean);
const IS_PROD = process.env.NODE_ENV === 'production';

const INGEST_KEYS = new Set(
  IS_PROD ? CONFIGURED_INGEST_KEYS : [...CONFIGURED_INGEST_KEYS, ...BAKED_INGEST_KEYS]
);

if (IS_PROD && !CONFIGURED_INGEST_KEYS.length) {
  // Not fatal — the CRM works fine without the browser extension — but the
  // extension will get 401s until a key is set, and that should not be a
  // silent mystery.
  console.warn(
    '[import] CRM_INGEST_KEY is not set. Extension ingest is DISABLED in production;\n' +
    '         the keys baked into routes/import.js are public and are not accepted here.'
  );
}

// Resolve who the staged draft belongs to.
//
//   1. A logged-in session wins outright.
//   2. A per-user X-CRM-Key (Settings → Extension Key, see db.js
//      genExtensionKey) resolves to the exact account it was issued to.
//      This is the path the shipped extension actually uses — each agent
//      pastes their own key once, so their imports land in their own
//      account even when the session cookie doesn't make it across (some
//      browsers block a third-party SameSite=None cookie on an extension's
//      cross-origin fetch, which used to make every request silently fall
//      through to case 3 below).
//   3. A shared/legacy key (CRM_INGEST_KEY, or one of the dev keys baked
//      into this file outside production) maps to a company and its most
//      senior active user. Every request using the same shared key lands
//      on that SAME one account — fine for a single-operator setup or
//      local dev, wrong for a team, which is exactly why (2) exists.
function resolveActor(req) {
  if (req.user) {
    return { company_id: req.user.company_id, user_id: req.user.id, via: 'session' };
  }
  const key = req.headers['x-crm-key'];
  if (key) {
    const owner = db.prepare(
      'SELECT id, company_id FROM users WHERE extension_key = ? AND is_active = 1'
    ).get(key);
    if (owner) return { company_id: owner.company_id, user_id: owner.id, via: 'personal-key' };
  }
  if (key && INGEST_KEYS.has(key)) {
    const companyId = process.env.CRM_INGEST_COMPANY_ID
      || db.prepare('SELECT id FROM companies ORDER BY created_at LIMIT 1').get()?.id;
    if (!companyId) return null;
    const owner =
      db.prepare(`SELECT id FROM users WHERE company_id = ? AND is_active = 1
                    AND role IN ('OWNER','FOUNDER','ADMIN','MANAGER')
                  ORDER BY created_at LIMIT 1`).get(companyId)
      || db.prepare(`SELECT id FROM users WHERE company_id = ? AND is_active = 1
                     ORDER BY created_at LIMIT 1`).get(companyId);
    return { company_id: companyId, user_id: owner?.id || null, via: 'shared-key' };
  }
  return null;
}

const numOrNull = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
const intOrNull = (v) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : null; };
// Validate/repair coordinates against Georgia's bounding box. Returns the
// correctly-ordered pair, swaps if the source had lat/lng reversed, or nulls
// both when neither orientation is valid (so the map geocodes it instead of
// dropping the pin in another country).
function geoFix(lat, lng) {
  const inGeo = (a, b) => a != null && b != null && a >= 41 && a <= 43.8 && b >= 40 && b <= 46.8;
  if (lat == null || lng == null) return { lat: null, lng: null };
  if (inGeo(lat, lng)) return { lat, lng };
  if (inGeo(lng, lat)) return { lat: lng, lng: lat };
  return { lat: null, lng: null };
}
// node:sqlite can only bind null / number / bigint / string / Uint8Array.
// Booleans, objects, arrays, undefined and NaN throw "cannot be bound" — ss.ge's
// scraped fields can be any of those, so coerce every value before binding.
function bindable(v) {
  if (v === undefined || v === null) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'bigint' || typeof v === 'string') return v;
  if (v instanceof Uint8Array) return v;
  try { const s = JSON.stringify(v); return s === undefined ? null : s; } catch { return null; }
}

// Best-effort map for ss.ge's applicationData. ss uses less predictable keys
// than myhome and the heavy normalization normally happens server-side in the
// extension's worker, so we probe a list of candidate keys and keep the full
// object in raw_data for anything we miss. The agent reviews the DRAFT anyway.
function mapSsToDraft(a) {
  const first = (...vals) => vals.find(v => v !== undefined && v !== null && v !== '' && typeof v !== 'object' && typeof v !== 'boolean') ?? null;
  // ss provides Georgian labels directly; map them to CRM enums.
  const RE_LABEL = { 'ბინა': 'APARTMENT', 'კერძო სახლი': 'HOUSE', 'აგარაკი': 'COTTAGE', 'მიწის ნაკვეთი': 'LAND', 'კომერციული ფართი': 'COMMERCIAL', 'კომერციული': 'COMMERCIAL', 'სასტუმრო': 'HOTEL' };
  const DEAL_LABEL = { 'იყიდება': 'SALE', 'ქირავდება': 'RENT', 'ქირავდება დღიურად': 'DAILY', 'გირავდება': 'MORTGAGE' };
  const dealById = { 1: 'SALE', 2: 'RENT', 3: 'DAILY', 7: 'DAILY' };

  function deep(keyRe, valOk) {
    let best = null, bestDepth = Infinity;
    (function walk(node, depth) {
      if (!node || typeof node !== 'object' || depth > 6) return;
      for (const [k, v] of Object.entries(node)) {
        if (v && typeof v === 'object') { walk(v, depth + 1); continue; }
        if (keyRe.test(k) && (!valOk || valOk(v)) && depth < bestDepth && v !== null && v !== '') { best = v; bestDepth = depth; }
      }
    })(a, 0);
    return best;
  }
  const isNum = (v) => v != null && v !== '' && Number.isFinite(Number(v));
  let price = deep(/price.*usd|usd.*price/i, isNum);
  if (price == null) price = deep(/^price$|price.*total|total.*price/i, isNum);

  // Amenity booleans -> Georgian labels (kept in amenities for reference)
  const imgs = Object.values(a.appImages || {})
    .map(im => (im && typeof im === 'object') ? (im.fileName || im.fileNameThumb) : im)
    .filter(u => typeof u === 'string');
  const photos = imgs.map(u => /^https?:\/\//.test(u) ? u : `https://static.ss.ge/things/${u}`);

  return {
    title:        first(a.title, a.dynamicTitle, a.metaTitle),
    description:  first(a.description, a.comment, a.metaDescription),
    list_price:   price != null ? (Math.round(numOrNull(price) ?? 0) || null) : null,
    currency:     'USD',
    deal_type:    DEAL_LABEL[a.realEstateDealType] || dealById[a.realEstateDealTypeId] || null,
    property_type: RE_LABEL[a.realEstateType] || null,
    area_sqm:     numOrNull(first(a.totalArea, a.area, a.areaOfHouse)),
    rooms:        first(a.rooms),
    bedrooms:     first(a.bedrooms),
    bathrooms:    first(a.toilet, a.bathrooms),
    floor:        numOrNull(first(a.floor)),
    total_floors: numOrNull(first(a.floors, a.totalFloors)),
    year_built:   numOrNull(first(a.buildYear, a.yearBuilt)),
    latitude:     numOrNull(first(a.locationLatitude, a.lat)),
    longitude:    numOrNull(first(a.locationLongitude, a.lng)),
    city:         first(a.cityName, a.cityTitle, a.city, deep(/city.*name|city.*title|^city$/i, v => typeof v === 'string')),
    district:     first(a.districtName, a.urbanName, a.subdistrictName, a.district),
    address:      first(a.address, a.streetAddress, deep(/street.*address|^address$/i, v => typeof v === 'string')),
    owner_phone:  first(a.phoneNumber, a.phone, a.userPhone, deep(/phone.*number|mobile/i, v => typeof v === 'string' && /\d{5,}/.test(v))),
    owner_name:   first(a.contactPerson, a.contactName, a.userName, a.ownerName),
    photos_remote: photos,
  };
}

// Pull a human-readable amenities list out of the raw scraped object so the
// listing carries it through. myhome exposes parameters[].display_name; ss uses
// boolean feature flags. Returns a JSON string (or null) for listings.amenities.
const SS_AMENITIES = {
  airConditioning: 'კონდიციონერი', balcony: 'აივანი', basement: 'სარდაფი', elevator: 'ლიფტი',
  fridge: 'მაცივარი', furniture: 'ავეჯი', garage: 'გარაჟი', heating: 'ცენტ. გათბობა',
  hotWater: 'ცხელი წყალი', internet: 'ინტერნეტი', naturalGas: 'ბუნებრივი აირი', tv: 'ტელევიზორი',
  washingMachine: 'სარეცხი მანქანა', drinkingWater: 'სასმელი წყალი', withPool: 'აუზი',
  electricity: 'ელ. ენერგია', sewage: 'კანალიზაცია', water: 'წყალი', wiFi: 'Wi-Fi',
  withBuiltInKitchen: 'ჩაშენებული სამზარეულო', cableTelevision: 'საკაბელო ტელევიზია',
  glazedWindows: 'მინა-პაკეტი', ironDoor: 'რკინის კარი', securityAlarm: 'სიგნალიზაცია',
  storage: 'სათავსო', telephone: 'ტელეფონი',
};
function extractAmenities(raw, isSS) {
  if (!raw || typeof raw !== 'object') return null;
  let list = [];
  if (isSS) {
    for (const [k, label] of Object.entries(SS_AMENITIES)) if (raw[k] === true) list.push(label);
  } else if (raw.parameters) {
    list = Object.values(raw.parameters).map(p => p?.display_name).filter(Boolean);
  }
  return list.length ? JSON.stringify(list) : null;
}

// Mirror the L-0001 numbering that routes/data.js applies to manual inserts.
// Guarded: only returns a value if the migrated column actually exists.
function nextListingNumber(companyId) {
  if (!SCHEMA_CACHE.listings?.includes('listing_number')) return null;
  const last = db.prepare(
    `SELECT listing_number FROM listings WHERE company_id = ? AND listing_number IS NOT NULL
     ORDER BY rowid DESC LIMIT 1`).get(companyId);
  let n = 1;
  if (last?.listing_number) { const m = last.listing_number.match(/(\d+)$/); if (m) n = parseInt(m[1], 10) + 1; }
  return 'L-' + String(n).padStart(4, '0');
}

// Create a real listing in the Properties table (+ property_images) from a
// mapped draft. Photos are downloaded into uploads/imports/<listingId>/.
async function createListing({ actor, source, url, draft, raw, isSS }) {
  const listingId = nanoid();
  const totalArea = numOrNull(draft.area_sqm);
  const price = draft.list_price != null ? numOrNull(draft.list_price) : null;
  const pricePerSqm = numOrNull(draft.price_per_sqm) ?? ((price && totalArea) ? Math.round(price / totalArea) : null);
  // The Properties UI / PDF treat bedrooms_total as the room count, so prefer
  // the total room count and fall back to bedrooms.
  const roomCount = intOrNull(draft.rooms) ?? intOrNull(draft.bedrooms);
  const geo = geoFix(numOrNull(draft.latitude), numOrNull(draft.longitude));

  const row = {
    id:            listingId,
    company_id:    actor.company_id,
    agent_id:      actor.user_id,
    created_by_id: actor.user_id,
    title:         draft.title || draft.address || 'Imported listing',
    description:   draft.description || null,
    listing_type:  draft.deal_type || 'SALE',        // SALE | RENT | DAILY
    property_type: draft.property_type || 'APARTMENT',
    status:        'ACTIVE',
    list_price:    price,
    price_per_sqm: pricePerSqm,
    currency:      draft.currency || 'USD',
    bedrooms_total: roomCount,
    bathrooms:     intOrNull(draft.bathrooms),
    total_area:    totalArea,
    living_area:   totalArea,                        // so the PDF's "ფართი" isn't blank
    floor:         intOrNull(draft.floor),
    total_floors:  intOrNull(draft.total_floors),
    year_built:    intOrNull(draft.year_built),
    cadastral_code: draft.cadastral_code || null,
    latitude:      numOrNull(geo.lat),
    longitude:     numOrNull(geo.lng),
    city:          draft.city || null,
    district:      draft.district || null,
    address:       draft.address || null,
    amenities:     extractAmenities(raw, isSS),
    source:        source,
    source_data:   raw ? JSON.stringify(raw) : null,   // full scrape — nothing lost
    source_url:    url || null,
  };
  const num = nextListingNumber(actor.company_id);
  if (num) row.listing_number = num;

  // Only persist columns that exist in the current schema.
  const cols = SCHEMA_CACHE.listings || Object.keys(row);
  const keys = Object.keys(row).filter(k => cols.includes(k));
  db.prepare(
    `INSERT INTO listings (${keys.map(k => `"${k}"`).join(',')})
     VALUES (${keys.map(() => '?').join(',')})`
  ).run(...keys.map(k => bindable(row[k])));

  // Photos → property_images
  const photoPaths = await downloadPhotos(draft.photos_remote || [], listingId);
  photoPaths.forEach((imgUrl, i) => {
    db.prepare(
      `INSERT INTO property_images (id, listing_id, image_url, is_primary, sort_order)
       VALUES (?, ?, ?, ?, ?)`
    ).run(nanoid(), listingId, imgUrl, i === 0 ? 1 : 0, i);
  });

  // Owner → Lead. The scraped listing carries the property owner's phone; turn
  // that into a Lead owned by (assigned to) the importing agent so the owner
  // actually shows up on the Leads page. This is what "extension owner info"
  // refers to — previously owner_phone was dropped and never surfaced.
  const ownerLeadId = ensureOwnerLead(actor, draft, source, url);
  if (ownerLeadId) {
    try { db.prepare(`UPDATE listings SET owner_lead_id = ? WHERE id = ?`).run(ownerLeadId, listingId); }
    catch (e) { console.error('[import] could not link owner lead to listing', listingId, '-', e.message); }
    // Requirement: the Lead ID must match its associated Property ID. Sync the
    // owner lead's number to this listing's number so they line up everywhere.
    if (num) {
      try { db.prepare(`UPDATE leads SET lead_number = ? WHERE id = ?`).run(num, ownerLeadId); }
      catch (e) { console.error('[import] could not sync lead_number for', ownerLeadId, '-', e.message); }
    }
  }

  return { id: listingId, listing_number: num, photos: photoPaths.length, owner_lead_id: ownerLeadId };
}

// Generate the next LD-#### lead number for a company (mirrors routes/data.js).
function nextLeadNumber(companyId) {
  if (!SCHEMA_CACHE.leads?.includes('lead_number')) return null;
  const last = db.prepare(
    `SELECT lead_number FROM leads WHERE company_id = ? AND lead_number IS NOT NULL ORDER BY rowid DESC LIMIT 1`
  ).get(companyId);
  let n = 1;
  if (last?.lead_number) { const m = last.lead_number.match(/(\d+)$/); if (m) n = parseInt(m[1], 10) + 1; }
  return 'LD-' + String(n).padStart(4, '0');
}

// Find-or-create a Lead for the property owner. Dedupes by phone within the
// company so re-importing the same owner reuses their lead. Assigns the lead to
// the importing agent (agent_id + created_by_id) so agent visibility scoping
// shows it. Returns the lead id, or null when there's no owner contact.
function ensureOwnerLead(actor, draft, source, url) {
  const phone = (draft.owner_phone || '').toString().trim();
  const name = (draft.owner_name || '').toString().trim() || null;
  if (!phone && !name) return null;

  const srcLabel = source && source.includes('ss') ? 'SSGE' : 'MYHOME';

  if (phone) {
    const existing = db.prepare(
      `SELECT id, agent_id FROM leads WHERE company_id = ? AND phone = ? LIMIT 1`
    ).get(actor.company_id, phone);
    if (existing) {
      // Backfill assignment if the existing lead is unowned.
      if (!existing.agent_id && actor.user_id) {
        try { db.prepare(`UPDATE leads SET agent_id = ?, created_by_id = COALESCE(created_by_id, ?) WHERE id = ?`)
          .run(actor.user_id, actor.user_id, existing.id); }
        catch (e) { console.error('[import] could not backfill lead owner for', existing.id, '-', e.message); }
      }
      return existing.id;
    }
  }

  const cols = SCHEMA_CACHE.leads || [];
  const _urlId = (u) => { const m = String(u || '').match(/(\d{5,})/); return m ? m[1] : null; };
  const lead = {
    id: nanoid(),
    company_id: actor.company_id,
    agent_id: actor.user_id || null,
    created_by_id: actor.user_id || null,
    source: srcLabel,
    full_name: name,
    phone: phone || null,
    phone2: (draft.owner_phone2 || '').toString().trim() || null,
    myhome_id: srcLabel === 'myhome.ge' ? (draft.myhome_id || _urlId(url)) : (draft.myhome_id || null),
    ssge_id: srcLabel === 'ss.ge' ? (draft.ssge_id || _urlId(url)) : (draft.ssge_id || null),
    inquiry_message: url ? ('Imported owner from ' + url) : 'Imported from extension',
    temperature: 'WARM',
    status: 'NEW',
  };
  const num = nextLeadNumber(actor.company_id);
  if (num) lead.lead_number = num;

  const keys = Object.keys(lead).filter(k => cols.includes(k));
  try {
    db.prepare(
      `INSERT INTO leads (${keys.map(k => `"${k}"`).join(',')}) VALUES (${keys.map(() => '?').join(',')})`
    ).run(...keys.map(k => bindable(lead[k])));
    return lead.id;
  } catch (e) {
    console.error('ensureOwnerLead failed:', e.message);
    return null;
  }
}

// Optional fallback: stage as a DRAFT in listing_imports (the old AI-Hunter
// behavior). Only used when the request explicitly asks for target=import.
async function stageDraft({ actor, source, url, draft, raw }) {
  const id = nanoid();
  const photoPaths = await downloadPhotos(draft.photos_remote || [], id);
  db.prepare(`INSERT INTO listing_imports
    (id, company_id, user_id, source, source_url, title, description, list_price, currency,
     deal_type, property_type, area_sqm, rooms, bedrooms, floor, total_floors,
     city, district, address, owner_phone, photos_json, raw_data, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT')`)
    .run(id, actor.company_id, actor.user_id, source, url || null,
         draft.title, draft.description, draft.list_price, draft.currency,
         draft.deal_type, draft.property_type, draft.area_sqm, draft.rooms, draft.bedrooms,
         draft.floor, draft.total_floors, draft.city, draft.district, draft.address, draft.owner_phone,
         JSON.stringify(photoPaths), JSON.stringify(raw ?? null));
  return { id, photos: photoPaths.length };
}

router.post('/ingest', async (req, res) => {
  const actor = resolveActor(req);
  if (!actor) {
    const key = req.headers['x-crm-key'];
    console.warn('[import:ingest] rejected —',
      key ? `key received (len ${key.length}, starts "${key.slice(0, 5)}…") but no user matched it` : 'no X-CRM-Key header and no session cookie came through');
    return res.status(401).json({ error: 'Invalid CRM key or not authenticated' });
  }
  if (!actor.user_id) return res.status(400).json({ error: 'No user found for target company' });

  const rawIn = req.body?.raw;
  let source = String(req.body?.source || '').toLowerCase();
  const url = req.body?.url ? String(req.body.url) : null;
  // Default lands the listing in Properties; pass target:'import' to stage it
  // in the AI-Hunter import queue instead.
  const target = String(req.body?.target || 'listing').toLowerCase();
  if (!rawIn || typeof rawIn !== 'object') {
    return res.status(400).json({ error: 'raw listing object required' });
  }
  const isSS = source.includes('ss');
  source = isSS ? 'ss.ge' : 'myhome.ge';

  try {
    const draft = isSS ? mapSsToDraft(rawIn) : mapMyhomeToDraft(rawIn);
    if (!draft.title && !draft.list_price && !(draft.photos_remote || []).length) {
      return res.status(422).json({ error: 'Could not extract listing fields from payload' });
    }

    if (target === 'import') {
      const { id, photos } = await stageDraft({ actor, source, url, draft, raw: rawIn });
      return res.json({ data: { id, photos, target: 'import', source, ...draft, photos_remote: undefined }, error: null });
    }

    const { id, listing_number, photos, owner_lead_id } = await createListing({ actor, source, url, draft, raw: rawIn, isSS });
    res.json({ data: { id, listing_number, photos, owner_lead_id, target: 'listing', source, ...draft, photos_remote: undefined }, error: null });
  } catch (e) {
    console.error('ingest error:', e.message);
    fail(res, e, { status: 500, context: 'import:POST /ingest' });
  }
});

// Public probe — open this URL in a browser to confirm what's deployed.
// If you get 404, server.js / this file isn't live yet.
router.get('/version', (req, res) => {
  res.json({
    ok: true,
    endpoint: 'ingest',
    target_default: 'listing',          // 'listing' = saves to Properties
    saves_to: 'listings + property_images',
    build: '2026-06-29-properties',
  });
});

module.exports = router;
