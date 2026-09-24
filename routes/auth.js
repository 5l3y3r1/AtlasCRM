'use strict';
/**
 * routes/auth.js — Signup, login, logout, "who am I"
 */
const express = require('express');
const crypto = require('crypto');
const { nanoid } = require('nanoid');
const { db, genExtensionKey } = require('../db');
const auth = require('../auth');
const mailer = require('../mailer');
const billing = require('../billing');
const { fail } = require('./_errors');

const router = express.Router();
router.use(express.json({ limit: '1mb' }));

// Roles allowed to manage other people in the company.
const MANAGER_ROLES = new Set(['MANAGER', 'OWNER', 'FOUNDER', 'ADMIN']);
const MIN_PASSWORD_LENGTH = 8;

// Cookie options resolved per-request. Over HTTPS (e.g. Railway, which sets
// x-forwarded-proto=https) we use SameSite=None; Secure so the browser
// extension can send the session cookie on its cross-origin fetch — this is
// what lets each agent's imports be attributed to *their own* logged-in
// account. On plain HTTP (local dev) we fall back to Lax so login still works.
function cookieOptsFor(req) {
  const https = req.secure ||
    (req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
  return {
    httpOnly: true,
    sameSite: https ? 'none' : 'lax',
    secure: https,
    maxAge: 1000 * 60 * 60 * 24 * 30,
    path: '/',
  };
}

/* ─── POST /api/auth/signup ─────────────────────────────────────────────
 * Creates a company + founder user atomically. The frontend (warm_login)
 * registers a user this way.
 * ─────────────────────────────────────────────────────────────────────── */
router.post('/signup', (req, res) => {
  const { email, password, first_name, last_name, company_name, phone } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  if (password.length < MIN_PASSWORD_LENGTH) {
    return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} chars` });
  }

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) return res.status(409).json({ error: 'User with this email already exists' });

  const companyId = nanoid();
  const userId    = nanoid();
  const password_hash = auth.hashPassword(password);

  try {
    db.exec('BEGIN');
    db.prepare(
      `INSERT INTO companies (id, name, email, phone)
       VALUES (?, ?, ?, ?)`
    ).run(companyId, company_name || `${first_name || 'My'} Agency`, email, phone || null);

    db.prepare(
      `INSERT INTO users
       (id, auth_user_id, company_id, first_name, last_name, email, password_hash, phone, role, extension_key)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'FOUNDER', ?)`
    ).run(userId, userId, companyId, first_name || 'User', last_name || null,
          email, password_hash, phone || null, genExtensionKey());
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    return fail(res, e, { status: 500, context: 'auth:POST /signup' });
  }

  // Start the trial clock. Doing it here (rather than leaving it null) is what
  // gives the expiry sweep and the billing page a real countdown to show.
  try { billing.startTrial(companyId); }
  catch (e) { console.error('[signup] trial start failed:', e.message); }

  const { token } = auth.issueToken(userId);
  res.cookie('atlas_session', token, cookieOptsFor(req));
  const user = auth.userFromToken(token);
  res.json({
    data: { user, session: { access_token: token, user } },
    error: null,
  });
});

/* ─── Login throttle ───────────────────────────────────────────────────
 * In-memory sliding window, keyed by IP *and* by email, so neither a single
 * host spraying many accounts nor many hosts targeting one account gets an
 * unlimited number of guesses. In-memory is the right scope here: the app runs
 * as a single process against a single SQLite file (see DEPLOY.md). If it ever
 * runs multi-process, move this to a shared store.
 * ─────────────────────────────────────────────────────────────────────── */
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
// Per-IP is the tight limit — that's where real guessing comes from. The
// per-email limit is deliberately looser: it exists to catch a distributed
// spray against one account, but a tight one would let anybody lock a real
// user out of their own account just by submitting bad passwords for them.
const LOGIN_MAX_PER_IP = 10;
const LOGIN_MAX_PER_EMAIL = 30;
const loginAttempts = new Map(); // key -> number[] (timestamps of failures)

// `scope` keeps counters for different actions separate. Without it, password
// reset requests would accumulate against the login counter and a stranger
// could lock a user out of signing in just by requesting resets for them.
function throttleKeys(req, email, scope = 'login') {
  const ip = req.ip || 'unknown';
  return [
    { key: `${scope}:ip:${ip}`, max: LOGIN_MAX_PER_IP },
    { key: `${scope}:email:${String(email || '').toLowerCase()}`, max: LOGIN_MAX_PER_EMAIL },
  ];
}

function isThrottled(keys) {
  const cutoff = Date.now() - LOGIN_WINDOW_MS;
  for (const { key, max } of keys) {
    const hits = (loginAttempts.get(key) || []).filter(t => t > cutoff);
    if (hits.length) loginAttempts.set(key, hits); else loginAttempts.delete(key);
    if (hits.length >= max) return true;
  }
  return false;
}

function recordFailure(keys) {
  const cutoff = Date.now() - LOGIN_WINDOW_MS;
  for (const { key } of keys) {
    const hits = (loginAttempts.get(key) || []).filter(t => t > cutoff);
    hits.push(Date.now());
    loginAttempts.set(key, hits);
  }
}

function clearFailures(keys) {
  for (const { key } of keys) loginAttempts.delete(key);
}

// Keep the map from growing without bound on a long-lived process.
setInterval(() => {
  const cutoff = Date.now() - LOGIN_WINDOW_MS;
  for (const [key, hits] of loginAttempts) {
    const live = hits.filter(t => t > cutoff);
    if (live.length) loginAttempts.set(key, live); else loginAttempts.delete(key);
  }
}, LOGIN_WINDOW_MS).unref();

/* ─── POST /api/auth/login ──────────────────────────────────────────── */
router.post('/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

  const keys = throttleKeys(req, email);
  if (isThrottled(keys)) {
    return res.status(429).json({ error: 'Too many failed attempts. Try again in 15 minutes.' });
  }

  const row = db.prepare(
    'SELECT id, password_hash FROM users WHERE email = ? AND is_active = 1'
  ).get(email);
  if (!row) { recordFailure(keys); return res.status(401).json({ error: 'Invalid email or password' }); }
  if (!auth.verifyPassword(password, row.password_hash)) {
    recordFailure(keys);
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  clearFailures(keys);

  // Subscription gate (super-admins exempt).
  const acct = db.prepare('SELECT company_id, is_super_admin FROM users WHERE id = ?').get(row.id);
  if (acct && !acct.is_super_admin && acct.company_id && !auth.isCompanyActive(acct.company_id)) {
    return res.status(403).json({ error: 'თქვენი გამოწერა არააქტიურია. დაუკავშირდით მომსახურების მიმწოდებელს.' });
  }

  const { token } = auth.issueToken(row.id);
  res.cookie('atlas_session', token, cookieOptsFor(req));
  const user = auth.userFromToken(token);
  res.json({
    data: { user, session: { access_token: token, user } },
    error: null,
  });
});

/* ─── POST /api/auth/logout ─────────────────────────────────────────── */
router.post('/logout', auth.authMiddleware, (req, res) => {
  auth.revokeToken(req.token);
  res.clearCookie('atlas_session', { path: '/' });
  res.json({ data: null, error: null });
});

/* ─── GET /api/auth/session ─────────────────────────────────────────── */
router.get('/session', auth.authMiddleware, (req, res) => {
  if (!req.user) return res.json({ data: { session: null }, error: null });
  res.json({
    data: { session: { access_token: req.token, user: req.user } },
    error: null,
  });
});

/* ─── GET /api/auth/me ─────────────────────────────────────────────── */
router.get('/me', auth.authMiddleware, (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
  res.json({ data: req.user, error: null });
});

/* ─── POST /api/auth/create-agent ───────────────────────────────────────
 * The logged-in user creates a teammate (agent) inside their own company.
 * Does NOT change the caller's session.
 * ─────────────────────────────────────────────────────────────────────── */
router.post('/create-agent', auth.authMiddleware, (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
  // Hiring is a manager action. Without this gate any AGENT could mint
  // themselves a second account with role FOUNDER and take over the company.
  if (!MANAGER_ROLES.has(req.user.role)) {
    return res.status(403).json({ error: 'Only managers may add team members' });
  }
  // Seat limit — the plan's, or a per-company override. Checked before any
  // validation work so the upgrade prompt is the first thing they see.
  const seat = billing.checkLimit(req.user.company_id, 'seats');
  if (!seat.ok) return res.status(402).json({ error: seat.error, limit: seat.limit, used: seat.used });

  const { email, password, first_name, last_name, phone, role } = req.body || {};
  if (!email || !password || !first_name) return res.status(400).json({ error: 'Name, email and password required' });
  if (password.length < MIN_PASSWORD_LENGTH) return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} chars` });

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) return res.status(409).json({ error: 'User with this email already exists' });

  const userId = nanoid();
  const password_hash = auth.hashPassword(password);
  const safeRole = ['FOUNDER', 'MANAGER', 'AGENT'].includes(role) ? role : 'AGENT';

  try {
    db.prepare(
      `INSERT INTO users
       (id, auth_user_id, company_id, first_name, last_name, email, password_hash, phone, role, is_active, extension_key)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`
    ).run(userId, userId, req.user.company_id, first_name, last_name || null,
          email, password_hash, phone || null, safeRole, genExtensionKey());
  } catch (e) {
    return fail(res, e, { status: 500, context: 'auth:POST /create-agent' });
  }

  res.json({ data: { id: userId, email, role: safeRole }, error: null });
});

/* ─── POST /api/auth/change-password ────────────────────────────────────
 * The only supported way to change your own password. `password_hash` is not
 * writable through /api/data, so hashing lives here on the server — the old
 * settings page asked the server to hash a password and then wrote the hash
 * back through the generic data API, which is what made every user's hash
 * client-writable (and, because neither endpoint it called existed, meant
 * password changes silently failed).
 * ─────────────────────────────────────────────────────────────────────── */
router.post('/change-password', auth.authMiddleware, (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
  const { current_password, password } = req.body || {};
  if (!password || password.length < MIN_PASSWORD_LENGTH) {
    return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} chars` });
  }
  const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
  if (!row) return res.status(404).json({ error: 'User not found' });
  // Require the current password so a borrowed or stolen session can't lock the
  // real owner out of their own account.
  if (!auth.verifyPassword(current_password || '', row.password_hash)) {
    return res.status(403).json({ error: 'Current password is incorrect' });
  }

  db.prepare("UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?")
    .run(auth.hashPassword(password), req.user.id);
  // Changing a password signs out every other device, then re-issues a session
  // for this one so the caller isn't logged out of the tab they're using.
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(req.user.id);
  const { token } = auth.issueToken(req.user.id);
  res.cookie('atlas_session', token, cookieOptsFor(req));
  res.json({ data: { ok: true }, error: null });
});

/* ─── POST /api/auth/regenerate-extension-key ───────────────────────────
 * Issues a new browser-extension key for the caller's own account and
 * invalidates the old one immediately (anyone who had it — an old computer,
 * a copied clipboard, a screenshot — loses access on their very next
 * request). The current key is already visible in GET /me, so this is only
 * needed for rotation, not for the initial reveal.
 * ─────────────────────────────────────────────────────────────────────── */
router.post('/regenerate-extension-key', auth.authMiddleware, (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
  const key = genExtensionKey();
  db.prepare("UPDATE users SET extension_key = ?, updated_at = datetime('now') WHERE id = ?")
    .run(key, req.user.id);
  res.json({ data: { extension_key: key }, error: null });
});

/* ─── POST /api/auth/set-user-password ──────────────────────────────────
 * Manager resets a teammate's password (there is no email delivery yet, so
 * this is how a locked-out agent gets back in). Scoped to the caller's own
 * company, and it signs the target out everywhere.
 * ─────────────────────────────────────────────────────────────────────── */
router.post('/set-user-password', auth.authMiddleware, (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
  if (!MANAGER_ROLES.has(req.user.role)) {
    return res.status(403).json({ error: 'Only managers may reset passwords' });
  }
  const { user_id, password } = req.body || {};
  if (!user_id) return res.status(400).json({ error: 'user_id required' });
  if (!password || password.length < MIN_PASSWORD_LENGTH) {
    return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} chars` });
  }
  const target = db.prepare('SELECT id, is_super_admin FROM users WHERE id = ? AND company_id = ?')
    .get(user_id, req.user.company_id);
  if (!target) return res.status(404).json({ error: 'User not found in your company' });
  // A company manager must not be able to seize a platform-owner account that
  // happens to sit in their company.
  if (target.is_super_admin && !req.user.is_super_admin) {
    return res.status(403).json({ error: 'Cannot reset this account' });
  }

  db.prepare("UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?")
    .run(auth.hashPassword(password), target.id);
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(target.id);
  res.json({ data: { ok: true }, error: null });
});

/* ─────────────────────────────────────────────────────────────────────────
 * Password reset + email verification
 *
 * Tokens are 32 random bytes, handed out once in an email and stored only as a
 * SHA-256 hash. Read access to the database (or to a backup) therefore doesn't
 * let anyone reset an account — the usable secret exists only in the mail.
 * ───────────────────────────────────────────────────────────────────────── */
const RESET_TTL_MS  = 60 * 60 * 1000;          // 1 hour
const VERIFY_TTL_MS = 24 * 60 * 60 * 1000;     // 24 hours

function hashToken(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function issueAuthToken(userId, kind, ttlMs) {
  const raw = crypto.randomBytes(32).toString('base64url');
  // One live token per purpose: requesting a new reset link invalidates the old.
  db.prepare('DELETE FROM auth_tokens WHERE user_id = ? AND kind = ?').run(userId, kind);
  db.prepare(
    'INSERT INTO auth_tokens (id, user_id, kind, token_hash, expires_at) VALUES (?, ?, ?, ?, ?)'
  ).run(nanoid(), userId, kind, hashToken(raw), new Date(Date.now() + ttlMs).toISOString());
  return raw;
}

// Returns the token row if it is valid and unused, else null.
function consumeAuthToken(raw, kind) {
  if (!raw) return null;
  const row = db.prepare(
    'SELECT * FROM auth_tokens WHERE token_hash = ? AND kind = ?'
  ).get(hashToken(raw), kind);
  if (!row || row.used_at) return null;
  if (new Date(row.expires_at) < new Date()) return null;
  db.prepare("UPDATE auth_tokens SET used_at = datetime('now') WHERE id = ?").run(row.id);
  return row;
}

/* ─── POST /api/auth/forgot-password ────────────────────────────────────
 * Always answers the same way. Telling an anonymous caller whether an address
 * has an account turns this into an account-enumeration oracle.
 * ─────────────────────────────────────────────────────────────────────── */
router.post('/forgot-password', async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const generic = { data: { ok: true }, error: null };
  if (!email) return res.status(400).json({ error: 'Email required' });

  // Rate-limited on its own counter so this can't be used to spray reset mail
  // at a list of addresses — or to lock someone out of logging in.
  const keys = throttleKeys(req, email, 'reset');
  if (isThrottled(keys)) {
    return res.status(429).json({ error: 'Too many requests. Try again in 15 minutes.' });
  }
  recordFailure(keys);

  const user = db.prepare(
    'SELECT id, email, first_name FROM users WHERE lower(email) = ? AND is_active = 1'
  ).get(email);
  if (!user) return res.json(generic);

  const raw = issueAuthToken(user.id, 'password_reset', RESET_TTL_MS);
  await mailer.sendPasswordReset(user.email, raw, { name: user.first_name });
  res.json(generic);
});

/* ─── POST /api/auth/reset-password ─────────────────────────────────────── */
router.post('/reset-password', (req, res) => {
  const { token, password } = req.body || {};
  if (!password || password.length < MIN_PASSWORD_LENGTH) {
    return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} chars` });
  }
  const row = consumeAuthToken(token, 'password_reset');
  if (!row) return res.status(400).json({ error: 'This link is invalid or has expired' });

  db.prepare("UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?")
    .run(auth.hashPassword(password), row.user_id);
  // A reset is the response to a possible compromise: drop every session.
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(row.user_id);
  res.json({ data: { ok: true }, error: null });
});

/* ─── POST /api/auth/send-verification ──────────────────────────────────── */
router.post('/send-verification', auth.authMiddleware, async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
  if (req.user.email_verified_at) {
    return res.json({ data: { ok: true, already_verified: true }, error: null });
  }
  const raw = issueAuthToken(req.user.id, 'email_verify', VERIFY_TTL_MS);
  const result = await mailer.sendEmailVerification(req.user.email, raw, { name: req.user.first_name });
  res.json({ data: { ok: true, delivered: result.sent, mail_configured: mailer.isConfigured() }, error: null });
});

/* ─── POST /api/auth/verify-email ───────────────────────────────────────── */
router.post('/verify-email', (req, res) => {
  const row = consumeAuthToken(req.body?.token, 'email_verify');
  if (!row) return res.status(400).json({ error: 'This link is invalid or has expired' });
  db.prepare("UPDATE users SET email_verified_at = datetime('now') WHERE id = ?").run(row.user_id);
  res.json({ data: { ok: true }, error: null });
});

module.exports = router;
