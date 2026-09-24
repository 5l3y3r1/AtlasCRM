'use strict';
// Public contact form → stored for the super-admin dashboard. No auth.
const express = require('express');
const router = express.Router();
const { nanoid } = require('nanoid');
const { db } = require('../db');

router.use(express.json({ limit: '64kb' }));

// Simple in-memory per-IP rate limit (best-effort; real limiting belongs at the
// edge/Redis once scaled).
const hits = new Map();
const WINDOW_MS = 60 * 60 * 1000, MAX_PER_WINDOW = 8;
function rateLimited(ip) {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter(t => now - t < WINDOW_MS);
  arr.push(now);
  hits.set(ip, arr);
  // Evict what has aged out rather than wiping the table: clearing everything
  // handed a flooder a way to reset their own counter by filling the map.
  if (hits.size > 5000) {
    for (const [k, v] of hits) {
      if (!v.length || now - v[v.length - 1] >= WINDOW_MS) hits.delete(k);
    }
  }
  return arr.length > MAX_PER_WINDOW;
}

router.post('/', (req, res) => {
  const b = req.body || {};
  // Honeypot: bots fill hidden fields. Pretend success, store nothing.
  if (b.website || b.company_url) return res.json({ data: { ok: true }, error: null });

  const message = (b.message || '').toString().trim();
  const name = (b.name || '').toString().trim();
  const email = (b.email || '').toString().trim();
  if (!name || !message) return res.status(400).json({ error: 'Name and message are required' });
  if (message.length > 4000 || name.length > 200) return res.status(400).json({ error: 'Input too long' });
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Invalid email' });

  // req.ip, not the raw X-Forwarded-For header: server.js sets `trust proxy`, so
  // Express already resolves the real client address through the hosting proxy.
  // Reading the header directly let anyone send a different value on every
  // request and walk straight past the rate limit.
  const ip = req.ip || '';
  if (rateLimited(ip)) return res.status(429).json({ error: 'Too many messages, please try later' });

  db.prepare(
    `INSERT INTO contact_messages (id, name, email, phone, company, message, ip)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(nanoid(), name, email || null, (b.phone || '').toString().trim() || null,
        (b.company || '').toString().trim() || null, message, ip);

  res.json({ data: { ok: true }, error: null });
});

module.exports = router;
