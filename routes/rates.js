'use strict';
/**
 * routes/rates.js — live GEL/USD exchange rate from the National Bank of Georgia.
 *
 *   GET /api/rates/usd  ->  { data: { gel_per_usd, source, date }, error: null }
 *
 * Caches the rate for 6 hours (NBG updates once per business day). Falls back to
 * a sane default if NBG is unreachable, so the CRM never breaks on a network blip.
 */
const express = require('express');
const router = express.Router();

const FALLBACK_RATE = 2.70;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
const NBG_URL = 'https://nbg.gov.ge/gw/api/ct/monetarypolicy/currencies/en/json/?currencies=USD';

let cache = { rate: null, date: null, fetchedAt: 0, source: 'fallback' };

async function fetchNbgRate() {
  const res = await fetch(NBG_URL, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error('NBG HTTP ' + res.status);
  const json = await res.json();
  // NBG shape: [ { date, currencies: [ { code:'USD', rate: 2.71, quantity: 1, ... } ] } ]
  const day = Array.isArray(json) ? json[0] : json;
  const list = day && (day.currencies || day.Currencies);
  const usd = list && list.find(c => (c.code || c.Code) === 'USD');
  if (!usd) throw new Error('USD not found in NBG response');
  const rate = Number(usd.rate ?? usd.Rate);
  const qty = Number(usd.quantity ?? usd.Quantity ?? 1) || 1;
  const perUsd = rate / qty; // GEL per 1 USD
  if (!perUsd || !isFinite(perUsd)) throw new Error('Invalid rate value');
  return { rate: perUsd, date: (day.date || day.Date || '').slice(0, 10) };
}

router.get('/usd', async (req, res) => {
  const now = Date.now();
  if (cache.rate && now - cache.fetchedAt < CACHE_TTL_MS) {
    return res.json({ data: { gel_per_usd: cache.rate, source: cache.source, date: cache.date }, error: null });
  }
  try {
    const { rate, date } = await fetchNbgRate();
    cache = { rate, date, fetchedAt: now, source: 'nbg' };
    res.json({ data: { gel_per_usd: rate, source: 'nbg', date }, error: null });
  } catch (e) {
    // Serve last good cached value if we have one, else fallback constant.
    // Logged because the failure is otherwise invisible: prices would quietly
    // convert at a hardcoded 2.70 for as long as NBG stayed unreachable.
    console.error('[rates] NBG fetch failed, serving', cache.rate ? 'cached rate' : 'fallback', '-', e.message);
    const rate = cache.rate || FALLBACK_RATE;
    res.json({ data: { gel_per_usd: rate, source: cache.rate ? 'cache' : 'fallback', date: cache.date }, error: null });
  }
});

module.exports = router;
