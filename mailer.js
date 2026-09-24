'use strict';
/**
 * mailer.js — Transactional email for the platform itself.
 *
 * This is deliberately separate from routes/messaging.js: that sends mail as a
 * *company*, using each agency's own SMTP credentials, to their clients. This
 * one sends mail as *AtlasCRM* — password resets, address verification — and uses
 * platform-level credentials.
 *
 * With no SMTP configured the mailer does not throw: it logs the message (and,
 * for a reset, the link) to the server console so local development and a
 * not-yet-configured deploy both keep working. `isConfigured()` lets callers
 * tell the user which of the two happened.
 *
 * Configuration:
 *   MAIL_SMTP_HOST, MAIL_SMTP_PORT (default 587), MAIL_SMTP_USER, MAIL_SMTP_PASS
 *   MAIL_FROM        e.g. "AtlasCRM <no-reply@yourdomain.ge>"
 *   MAIL_SECURE=1    force TLS-on-connect (port 465); otherwise STARTTLS
 *   APP_URL          public base URL used to build links in emails
 */
const HOST = process.env.MAIL_SMTP_HOST || '';
const PORT = parseInt(process.env.MAIL_SMTP_PORT || '587', 10);
const USER = process.env.MAIL_SMTP_USER || '';
const PASS = process.env.MAIL_SMTP_PASS || '';
const FROM = process.env.MAIL_FROM || 'AtlasCRM <no-reply@atlascrm.ge>';
const SECURE = process.env.MAIL_SECURE === '1' || PORT === 465;

const APP_URL = (process.env.APP_URL || 'https://atlascrm.ge').replace(/\/+$/, '');

let _transport;
function transport() {
  if (_transport !== undefined) return _transport;
  if (!HOST || !USER || !PASS) { _transport = null; return _transport; }
  const nodemailer = require('nodemailer');
  _transport = nodemailer.createTransport({
    host: HOST, port: PORT, secure: SECURE, auth: { user: USER, pass: PASS },
  });
  return _transport;
}

function isConfigured() {
  return Boolean(HOST && USER && PASS);
}

/**
 * Send one message. Always resolves — email must never be the reason a
 * password reset request 500s. Returns { sent, logged, error }.
 */
async function send({ to, subject, text, html }) {
  const t = transport();
  if (!t) {
    console.log(
      `\n[mail:not-configured] would send to ${to}\n` +
      `  subject: ${subject}\n` +
      `  ${String(text || '').replace(/\n/g, '\n  ')}\n`
    );
    return { sent: false, logged: true, error: null };
  }
  try {
    await t.sendMail({ from: FROM, to, subject, text, html });
    return { sent: true, logged: false, error: null };
  } catch (e) {
    console.error('[mail] send failed:', e.message);
    return { sent: false, logged: false, error: e.message };
  }
}

/* ─── Templates ─────────────────────────────────────────────────────────
 * Plain text plus a minimal HTML part. Kept deliberately simple: transactional
 * mail with heavy markup is what gets filtered as spam, and these carry one
 * link each.
 * ───────────────────────────────────────────────────────────────────── */

function layout(title, bodyHtml) {
  return `<!doctype html><html><body style="margin:0;padding:24px;background:#f6f7f9;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#1a1d23">
  <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;padding:32px">
    <div style="font-size:18px;font-weight:700;color:#c2410c;margin-bottom:20px">AtlasCRM</div>
    <h1 style="font-size:20px;margin:0 0 16px">${title}</h1>
    ${bodyHtml}
    <p style="margin-top:28px;font-size:12px;color:#6b7280">
      თუ ეს თქვენ არ მოგითხოვიათ, უბრალოდ იგნორირება გაუკეთეთ ამ წერილს.<br>
      If you did not request this, you can safely ignore this email.
    </p>
  </div></body></html>`;
}

function button(url, label) {
  return `<p style="margin:24px 0"><a href="${url}" style="background:#c2410c;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;display:inline-block;font-weight:600">${label}</a></p>
  <p style="font-size:12px;color:#6b7280;word-break:break-all">${url}</p>`;
}

async function sendPasswordReset(to, token, { name } = {}) {
  const url = `${APP_URL}/reset-password?token=${encodeURIComponent(token)}`;
  return send({
    to,
    subject: 'პაროლის აღდგენა — AtlasCRM',
    text: `გამარჯობა${name ? ' ' + name : ''},\n\n`
        + `პაროლის აღსადგენად გადადით ბმულზე (ვადა — 1 საათი):\n${url}\n\n`
        + `თუ ეს თქვენ არ მოგითხოვიათ, იგნორირება გაუკეთეთ.\n`,
    html: layout('პაროლის აღდგენა',
      `<p>პაროლის შესაცვლელად დააჭირეთ ღილაკს. ბმული ვადაგასულია <strong>1 საათში</strong>.</p>`
      + button(url, 'პაროლის შეცვლა')),
  });
}

async function sendEmailVerification(to, token, { name } = {}) {
  const url = `${APP_URL}/verify-email?token=${encodeURIComponent(token)}`;
  return send({
    to,
    subject: 'დაადასტურეთ თქვენი ელფოსტა — AtlasCRM',
    text: `გამარჯობა${name ? ' ' + name : ''},\n\n`
        + `ელფოსტის დასადასტურებლად გადადით ბმულზე (ვადა — 24 საათი):\n${url}\n`,
    html: layout('დაადასტურეთ ელფოსტა',
      `<p>ანგარიშის გასააქტიურებლად დაადასტურეთ ეს ელფოსტა. ბმული ვადაგასულია <strong>24 საათში</strong>.</p>`
      + button(url, 'ელფოსტის დადასტურება')),
  });
}

module.exports = {
  APP_URL, isConfigured, send, sendPasswordReset, sendEmailVerification,
};
