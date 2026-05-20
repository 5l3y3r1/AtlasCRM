'use strict';
/**
 * auth.js — Password hashing, JWT issuance, and the auth middleware.
 */
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const { nanoid } = require('nanoid');
const { db }   = require('./db');

const JWT_SECRET = process.env.JWT_SECRET || 'warm-ge-dev-secret-change-me-in-prod';
const SESSION_DAYS = 30;

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
  else if (req.cookies && req.cookies.warm_session) token = req.cookies.warm_session;

  req.user = userFromToken(token);
  req.token = token;
  next();
}

// Use after authMiddleware; rejects if there's no logged-in user
function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
  next();
}

module.exports = {
  hashPassword, verifyPassword, issueToken, revokeToken,
  userFromToken, authMiddleware, requireAuth,
};
