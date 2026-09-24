'use strict';
/**
 * routes/messaging.js
 * POST /api/messaging/send        — send whatsapp or email
 * GET  /api/messaging/history     — get message history for a contact
 * GET  /api/messaging/integrations — get company integration settings
 * POST /api/messaging/integrations — save integration settings
 */
const express  = require('express');
const { nanoid } = require('nanoid');
const { db }   = require('../db'); // db is the better-sqlite3 instance
const { requireAuth } = require('../auth');

const router = express.Router();

// Every route here reads req.user.company_id and handles a company's own SMTP
// and API credentials. Without this the router only failed by accident — by
// throwing on a null req.user — which is not a guarantee, just a coincidence.
router.use(requireAuth);

// ── helpers ──────────────────────────────────────────────────────────────
function getIntegrations(companyId) {
  return db.prepare('SELECT * FROM company_integrations WHERE company_id = ?').get(companyId);
}

// ── GET integrations ─────────────────────────────────────────────────────
router.get('/integrations', (req, res) => {
  const row = getIntegrations(req.user.company_id);
  // Never expose raw credentials — mask them
  if (!row) return res.json({ data: null });
  const safe = { ...row };
  if (safe.twilio_token)  safe.twilio_token  = safe.twilio_token.replace(/.(?=.{4})/g, '•');
  if (safe.smtp_pass)     safe.smtp_pass     = safe.smtp_pass.replace(/.(?=.{4})/g, '•');
  if (safe.meta_access_token)   safe.meta_access_token   = safe.meta_access_token.replace(/.(?=.{4})/g, '•');
  if (safe.tiktok_access_token) safe.tiktok_access_token = safe.tiktok_access_token.replace(/.(?=.{4})/g, '•');
  res.json({ data: safe });
});

// ── POST save integrations ───────────────────────────────────────────────
router.post('/integrations', express.json(), (req, res) => {
  const cid = req.user.company_id;
  const {
    whatsapp_number, whatsapp_template,
    smtp_host, smtp_port, smtp_user, smtp_pass, smtp_from, smtp_from_name,
    meta_access_token, meta_ad_account_id, tiktok_access_token, tiktok_advertiser_id
  } = req.body;

  const existing = db.prepare('SELECT id FROM company_integrations WHERE company_id = ?').get(cid);

  // Don't overwrite masked values (if user didn't change them)
  const isMasked = v => v && v.includes('•');

  if (existing) {
    const current = db.prepare('SELECT * FROM company_integrations WHERE company_id = ?').get(cid);
    db.prepare(`UPDATE company_integrations SET
      whatsapp_number = ?, whatsapp_template = ?,
      smtp_host = ?, smtp_port = ?, smtp_user = ?, smtp_pass = ?,
      smtp_from = ?, smtp_from_name = ?,
      meta_access_token = ?, meta_ad_account_id = ?,
      tiktok_access_token = ?, tiktok_advertiser_id = ?,
      updated_at = datetime('now')
      WHERE company_id = ?`).run(
      whatsapp_number       || current.whatsapp_number,
      whatsapp_template     || current.whatsapp_template,
      smtp_host         || current.smtp_host,
      smtp_port         || current.smtp_port,
      smtp_user         || current.smtp_user,
      isMasked(smtp_pass) ? current.smtp_pass : (smtp_pass || current.smtp_pass),
      smtp_from         || current.smtp_from,
      smtp_from_name    || current.smtp_from_name,
      isMasked(meta_access_token) ? current.meta_access_token : (meta_access_token || current.meta_access_token),
      meta_ad_account_id    || current.meta_ad_account_id,
      isMasked(tiktok_access_token) ? current.tiktok_access_token : (tiktok_access_token || current.tiktok_access_token),
      tiktok_advertiser_id  || current.tiktok_advertiser_id,
      cid
    );
  } else {
    // Coerce undefined → null: node:sqlite can only bind null/string/number/buffer,
    // and any field the caller didn't send (e.g. saving just the WhatsApp fields on
    // a brand-new company) arrives here as undefined, which throws otherwise.
    const nz = (v) => v === undefined ? null : v;
    db.prepare(`INSERT INTO company_integrations
      (id, company_id, whatsapp_number, whatsapp_template,
       smtp_host, smtp_port, smtp_user, smtp_pass, smtp_from, smtp_from_name,
       meta_access_token, meta_ad_account_id, tiktok_access_token, tiktok_advertiser_id)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      nanoid(), cid,
      nz(whatsapp_number), nz(whatsapp_template),
      nz(smtp_host), smtp_port || 587, nz(smtp_user), nz(smtp_pass), nz(smtp_from), nz(smtp_from_name),
      nz(meta_access_token), nz(meta_ad_account_id), nz(tiktok_access_token), nz(tiktok_advertiser_id)
    );
  }
  res.json({ data: { ok: true } });
});

// ── POST send ─────────────────────────────────────────────────────────────
router.post('/send', express.json({ limit: '2mb' }), async (req, res) => {
  const { channel, to_phone, to_email, subject, body, contact_type, contact_id } = req.body;

  if (!channel || !body) return res.status(400).json({ error: 'channel and body required' });

  const integrations = getIntegrations(req.user.company_id);
  if (!integrations) return res.status(400).json({ error: 'Integrations not configured. Go to Settings → Integrations.' });

  const msgId = nanoid();
  let status = 'sent';
  let provider_id = null;
  let errorMsg = null;

  // ── WhatsApp Web (Personal) ──────────────────────────────────────────────
  if (channel === 'whatsapp') {
    if (!to_phone) return res.status(400).json({ error: 'to_phone required for WhatsApp.' });
    
    // Get template if configured
    let finalMessage = body;
    if (!finalMessage && integrations.whatsapp_template) {
      finalMessage = integrations.whatsapp_template
        .replace('{NAME}', 'Contact')
        .replace('{PHONE}', to_phone)
        .replace('{LISTING}', 'Property');
    }
    
    // Clean phone number for wa.me link
    const cleanPhone = to_phone.replace(/[^0-9]/g, '');
    
    // Generate wa.me URL with pre-filled message
    const waLink = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(finalMessage || 'Hello!')}`;
    
    // Log the message and wa.me link
    status = 'sent';
    provider_id = `wa:personal:${cleanPhone}`;
  }

  // ── Email via SMTP (Nodemailer) ──────────────────────────────────────
  if (channel === 'email') {
    if (!integrations.smtp_host || !integrations.smtp_user || !integrations.smtp_pass) {
      return res.status(400).json({ error: 'SMTP credentials not configured.' });
    }
    if (!to_email) return res.status(400).json({ error: 'to_email required for Email.' });

    try {
      // Lazy-require nodemailer
      let nodemailer;
      try { nodemailer = require('nodemailer'); }
      catch(e) { return res.status(500).json({ error: 'nodemailer not installed. Run: npm install nodemailer' }); }

      const transporter = nodemailer.createTransport({
        host:   integrations.smtp_host,
        port:   integrations.smtp_port || 587,
        secure: (integrations.smtp_port || 587) === 465,
        auth: { user: integrations.smtp_user, pass: integrations.smtp_pass }
      });

      const info = await transporter.sendMail({
        from:    `"${integrations.smtp_from_name || 'AtlasCRM'}" <${integrations.smtp_from || integrations.smtp_user}>`,
        to:      to_email,
        subject: subject || '(no subject)',
        html:    body.includes('<') ? body : body.replace(/\n/g, '<br>'),
        text:    body.replace(/<[^>]*>/g, '')
      });

      provider_id = info.messageId;
      status      = 'sent';
    } catch (e) {
      status   = 'failed';
      errorMsg = e.message;
    }
  }

  // ── Log to DB ─────────────────────────────────────────────────────────
  db.prepare(`INSERT INTO messages
    (id, company_id, sent_by, channel, direction, contact_type, contact_id,
     to_phone, to_email, subject, body, status, provider_id)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    msgId, req.user.company_id, req.user.id,
    channel, 'outbound', contact_type || null, contact_id || null,
    to_phone || null, to_email || null,
    subject  || null, body, status, provider_id || null
  );

  if (status === 'failed') {
    return res.status(500).json({ error: errorMsg || 'Failed to send', msg_id: msgId });
  }

  res.json({ data: { id: msgId, status, provider_id } });
});

// ── GET message history for a contact ────────────────────────────────────
router.get('/history', (req, res) => {
  const { contact_id, contact_type, limit = 50 } = req.query;
  let query = `SELECT m.*, u.first_name || ' ' || COALESCE(u.last_name,'') as sender_name
               FROM messages m
               LEFT JOIN users u ON u.id = m.sent_by
               WHERE m.company_id = ?`;
  const params = [req.user.company_id];

  if (contact_id) { query += ' AND m.contact_id = ?'; params.push(contact_id); }
  if (contact_type) { query += ' AND m.contact_type = ?'; params.push(contact_type); }
  query += ` ORDER BY m.created_at DESC LIMIT ${parseInt(limit)}`;

  const rows = db.prepare(query).all(...params);
  res.json({ data: rows });
});

module.exports = router;
