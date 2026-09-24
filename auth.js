'use strict';
/**
 * auth.js — Password hashing, JWT issuance, and the auth middleware.
 */
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const { nanoid } = require('nanoid');
const { db }   = require('./db');

const DEV_JWT_SECRET = 'warm-ge-dev-secret-change-me-in-prod';
const JWT_SECRET = process.env.JWT_SECRET || DEV_JWT_SECRET;
const SESSION_DAYS = 30;

// A publicly known signing key means anyone can mint a session for any account.
// Refuse to start rather than run a production deploy on the dev default.
if (process.env.NODE_ENV === 'production' && JWT_SECRET === DEV_JWT_SECRET) {
  console.error(
    '\n  FATAL: JWT_SECRET is unset in production.\n' +
    '  Generate one with:  node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"\n' +
    '  and set it as the JWT_SECRET environment variable.\n'
  );
  process.exit(1);
}

// A company is active unless it's suspended/cancelled or past its expiry.
function isCompanyActive(companyId) {
  try {
    const c = db.prepare('SELECT subscription_status, subscription_expires_at FROM companies WHERE id = ?').get(companyId);
    if (!c) return true; // no company row → don't lock out
    const status = c.subscription_status || 'active';
    if (status === 'suspended' || status === 'cancelled' || status === 'expired') return false;
    if (c.subscription_expires_at && new Date(c.subscription_expires_at) < new Date()) return false;
    return true;
  } catch (e) { return true; }
}

function hashPassword(pw) {
  return bcrypt.hashSync(pw, 10);
}

function verifyPassword(pw, hash) {
  if (!hash) return false;
  return bcrypt.compareSync(pw, hash);
}

function issueToken(userId) {
  const token = jwt.sign({ sub: userId, jti: nanoid() }, JWT_SECRET, {
    expiresIn: `${SESSION_DAYS}d`
  });
  const expires = new Date(Date.now() + SESSION_DAYS * 24 * 3600 * 1000).toISOString();
  db.prepare(
    'INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)'
  ).run(token, userId, expires);
  return { token, expires_at: expires };
}

function revokeToken(token) {
  if (!token) return;
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

function userFromToken(token) {
  if (!token) return null;
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    // Verify session still exists in DB (so logout actually invalidates)
    const session = db.prepare(
      'SELECT user_id, expires_at FROM sessions WHERE token = ?'
    ).get(token);
    if (!session) return null;
    if (new Date(session.expires_at) < new Date()) {
      revokeToken(token);
      return null;
    }
    const user = db.prepare(
      `SELECT u.*, c.name AS company_name
         FROM users u
         LEFT JOIN companies c ON c.id = u.company_id
        WHERE u.id = ? AND u.is_active = 1`
    ).get(payload.sub);
    if (!user) return null;
    // Enforce company subscription — a suspended/expired company locks out its
    // users on their next request. Super-admins (platform owners) are exempt.
    if (!user.is_super_admin && user.company_id && !isCompanyActive(user.company_id)) return null;
    delete user.password_hash;
    return user;
  } catch {
    return null;
  }
}

// Express middleware — populates req.user when an Authorization header
// or session cookie holds a valid token.
function authMiddleware(req, res, next) {
  let token = null;
  const auth = req.headers.authorization || '';
  if (auth.startsWith('Bearer ')) token = auth.slice(7);
  else if (req.cookies && req.cookies.atlas_session) token = req.cookies.atlas_session;

  req.user = userFromToken(token);
  req.token = token;
  // Presence (#2): mark the user seen, at most once per ~45s to avoid a write per request.
  if (req.user) {
    try {
      const last = req.user.last_seen_at ? Date.parse(req.user.last_seen_at) : 0;
      if (Date.now() - last > 45000) {
        db.prepare('UPDATE users SET last_seen_at = ? WHERE id = ?').run(new Date().toISOString(), req.user.id);
      }
    } catch (e) {}
  }
  next();
}

// Use after authMiddleware; rejects if there's no logged-in user
function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
  next();
}

module.exports = {
  hashPassword, verifyPassword, issueToken, revokeToken,
  userFromToken, authMiddleware, requireAuth, isCompanyActive,
};
