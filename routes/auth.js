'use strict';
/**
 * routes/auth.js — Signup, login, logout, "who am I"
 */
const express = require('express');
const { nanoid } = require('nanoid');
const { db } = require('../db');
const auth = require('../auth');

const router = express.Router();
router.use(express.json({ limit: '1mb' }));

const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: 'lax',
  secure: false,         // would be `true` behind HTTPS in real prod
  maxAge: 1000 * 60 * 60 * 24 * 30,
  path: '/',
};

/* ─── POST /api/auth/signup ─────────────────────────────────────────────
 * Creates a company + founder user atomically. The frontend (warm_login)
 * registers a user this way.
 * ─────────────────────────────────────────────────────────────────────── */
router.post('/signup', (req, res) => {
  const { email, password, first_name, last_name, company_name, phone } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 chars' });

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
       (id, auth_user_id, company_id, first_name, last_name, email, password_hash, phone, role)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'FOUNDER')`
    ).run(userId, userId, companyId, first_name || 'User', last_name || null,
          email, password_hash, phone || null);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    return res.status(500).json({ error: e.message });
  }

  const { token } = auth.issueToken(userId);
  res.cookie('warm_session', token, COOKIE_OPTS);
  const user = auth.userFromToken(token);
  res.json({
    data: { user, session: { access_token: token, user } },
    error: null,
  });
});

/* ─── POST /api/auth/login ──────────────────────────────────────────── */
router.post('/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

  const row = db.prepare(
    'SELECT id, password_hash FROM users WHERE email = ? AND is_active = 1'
  ).get(email);
  if (!row) return res.status(401).json({ error: 'Invalid email or password' });
  if (!auth.verifyPassword(password, row.password_hash))
    return res.status(401).json({ error: 'Invalid email or password' });

  const { token } = auth.issueToken(row.id);
  res.cookie('warm_session', token, COOKIE_OPTS);
  const user = auth.userFromToken(token);
  res.json({
    data: { user, session: { access_token: token, user } },
    error: null,
  });
});

/* ─── POST /api/auth/logout ─────────────────────────────────────────── */
router.post('/logout', auth.authMiddleware, (req, res) => {
  auth.revokeToken(req.token);
  res.clearCookie('warm_session', { path: '/' });
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

module.exports = router;
