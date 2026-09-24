'use strict';
// ─────────────────────────────────────────────────────────────────────────
// Platform super-admin API (mounted at /api/admin).
// Lets a platform owner register companies, manage their subscriptions, and
// see every detail. Guarded by requireSuperAdmin — only users with
// is_super_admin = 1 (set via SUPER_ADMIN_EMAILS on boot) may use it.
// ─────────────────────────────────────────────────────────────────────────
const express = require('express');
const router = express.Router();
const { nanoid } = require('nanoid');
const { db } = require('../db');
const auth = require('../auth');
const { fail } = require('./_errors');
const deletion = require('./_deletion');

router.use(express.json({ limit: '2mb' }));

function requireSuperAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
  if (!req.user.is_super_admin) return res.status(403).json({ error: 'Super-admin only' });
  next();
}

const PLANS = ['trial', 'basic', 'pro', 'enterprise'];
const STATUSES = ['active', 'suspended', 'expired', 'cancelled'];

function companyStats(id) {
  const users = db.prepare('SELECT COUNT(*) n FROM users WHERE company_id = ?').get(id).n;
  // Counts are decoration on an admin list — one failing must not take the
  // whole page down, but it should not vanish either.
  let listings = 0, leads = 0;
  try { listings = db.prepare('SELECT COUNT(*) n FROM listings WHERE company_id = ?').get(id).n; }
  catch (e) { console.error('[admin] listings count failed for', id, e.message); }
  try { leads = db.prepare('SELECT COUNT(*) n FROM leads WHERE company_id = ?').get(id).n; }
  catch (e) { console.error('[admin] leads count failed for', id, e.message); }
  return { users, listings, leads };
}

function computedStatus(c) {
  if (c.subscription_status && c.subscription_status !== 'active') return c.subscription_status;
  if (c.subscription_expires_at && new Date(c.subscription_expires_at) < new Date()) return 'expired';
  return 'active';
}

// ─── list companies ───────────────────────────────────────────────────────
router.get('/companies', auth.requireAuth, requireSuperAdmin, (req, res) => {
  const rows = db.prepare('SELECT * FROM companies ORDER BY created_at DESC').all();
  const data = rows.map(c => {
    const founder = db.prepare(
      "SELECT first_name, last_name, email FROM users WHERE company_id = ? AND role = 'FOUNDER' ORDER BY created_at ASC LIMIT 1"
    ).get(c.id);
    return { ...c, status: computedStatus(c), founder: founder || null, stats: companyStats(c.id) };
  });
  res.json({ data, error: null });
});

// ─── one company, full detail ───────────────────────────────────────────────
router.get('/companies/:id', auth.requireAuth, requireSuperAdmin, (req, res) => {
  const c = db.prepare('SELECT * FROM companies WHERE id = ?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Company not found' });
  const users = db.prepare(
    'SELECT id, first_name, last_name, email, role, is_active, last_seen_at, created_at FROM users WHERE company_id = ? ORDER BY created_at ASC'
  ).all(c.id);
  res.json({ data: { ...c, status: computedStatus(c), users, stats: companyStats(c.id) }, error: null });
});

// ─── register a company (+ its founder account) ─────────────────────────────
router.post('/companies', auth.requireAuth, requireSuperAdmin, (req, res) => {
  const b = req.body || {};
  const name = (b.name || '').trim();
  const founder = b.founder || {};
  const fEmail = (founder.email || '').trim().toLowerCase();
  const fPass = (founder.password || '').trim();
  if (!name) return res.status(400).json({ error: 'Company name is required' });
  if (!fEmail || !fPass) return res.status(400).json({ error: 'Founder email and password are required' });
  if (fPass.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  if (db.prepare('SELECT 1 FROM users WHERE lower(email) = ?').get(fEmail))
    return res.status(409).json({ error: 'A user with that email already exists' });

  const plan = PLANS.includes(b.plan) ? b.plan : 'trial';
  const companyId = nanoid();
  db.prepare(
    `INSERT INTO companies (id, name, email, phone, logo_url, address, plan, subscription_status, subscription_expires_at, admin_notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`
  ).run(companyId, name, (b.email || fEmail) || null, b.phone || null, b.logo_url || null,
        b.address || null, plan, b.subscription_expires_at || null, b.admin_notes || null);

  const userId = nanoid();
  db.prepare(
    `INSERT INTO users (id, company_id, first_name, last_name, email, password_hash, phone, role, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'FOUNDER', 1)`
  ).run(userId, companyId, (founder.first_name || name).trim(), (founder.last_name || '').trim(),
        fEmail, auth.hashPassword(fPass), founder.phone || null);

  // Role permissions are seeded lazily from DEFAULT_PERMS the first time the
  // company opens the settings page, so there is nothing to write here.

  const base = (req.headers['x-forwarded-proto'] ? req.headers['x-forwarded-proto'].split(',')[0].trim() : req.protocol)
    + '://' + req.get('host');
  const c = db.prepare('SELECT * FROM companies WHERE id = ?').get(companyId);
  res.json({
    data: {
      ...c, status: computedStatus(c),
      loginUrl: base + '/login',
      credentials: { email: fEmail, password: fPass },
    },
    error: null,
  });
});

// ─── update a company / its subscription ────────────────────────────────────
router.patch('/companies/:id', auth.requireAuth, requireSuperAdmin, (req, res) => {
  const c = db.prepare('SELECT * FROM companies WHERE id = ?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Company not found' });
  const b = req.body || {};
  const sets = [], vals = [];
  const setField = (col, val) => { sets.push(`${col} = ?`); vals.push(val); };

  if (b.name !== undefined) setField('name', String(b.name).trim());
  if (b.email !== undefined) setField('email', b.email || null);
  if (b.phone !== undefined) setField('phone', b.phone || null);
  if (b.address !== undefined) setField('address', b.address || null);
  if (b.logo_url !== undefined) setField('logo_url', b.logo_url || null);
  if (b.admin_notes !== undefined) setField('admin_notes', b.admin_notes || null);
  if (b.plan !== undefined && PLANS.includes(b.plan)) setField('plan', b.plan);
  if (b.subscription_status !== undefined && STATUSES.includes(b.subscription_status)) setField('subscription_status', b.subscription_status);
  if (b.subscription_expires_at !== undefined) setField('subscription_expires_at', b.subscription_expires_at || null);
  if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });

  setField('updated_at', new Date().toISOString());
  vals.push(req.params.id);
  db.prepare(`UPDATE companies SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  const updated = db.prepare('SELECT * FROM companies WHERE id = ?').get(req.params.id);
  res.json({ data: { ...updated, status: computedStatus(updated), stats: companyStats(updated.id) }, error: null });
});

// ─── quick suspend / activate ───────────────────────────────────────────────
router.post('/companies/:id/:action(suspend|activate)', auth.requireAuth, requireSuperAdmin, (req, res) => {
  const status = req.params.action === 'suspend' ? 'suspended' : 'active';
  const r = db.prepare('UPDATE companies SET subscription_status = ?, updated_at = ? WHERE id = ?')
    .run(status, new Date().toISOString(), req.params.id);
  if (!r.changes) return res.status(404).json({ error: 'Company not found' });
  res.json({ data: { id: req.params.id, subscription_status: status }, error: null });
});

// ─── reset a founder's password (to re-send access) ─────────────────────────
router.post('/companies/:id/reset-password', auth.requireAuth, requireSuperAdmin, (req, res) => {
  const pass = (req.body && req.body.password || '').trim();
  if (pass.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  const founder = db.prepare("SELECT id, email FROM users WHERE company_id = ? AND role = 'FOUNDER' ORDER BY created_at ASC LIMIT 1").get(req.params.id);
  if (!founder) return res.status(404).json({ error: 'Founder not found' });
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(auth.hashPassword(pass), founder.id);
  res.json({ data: { email: founder.email, password: pass }, error: null });
});

// ─── contact messages (from the public landing page) ────────────────────────
router.get('/messages', auth.requireAuth, requireSuperAdmin, (req, res) => {
  const rows = db.prepare('SELECT * FROM contact_messages ORDER BY created_at DESC LIMIT 500').all();
  const unread = db.prepare('SELECT COUNT(*) n FROM contact_messages WHERE is_read = 0').get().n;
  res.json({ data: { messages: rows, unread }, error: null });
});

router.patch('/messages/:id', auth.requireAuth, requireSuperAdmin, (req, res) => {
  const isRead = (req.body && req.body.is_read) ? 1 : 0;
  const r = db.prepare('UPDATE contact_messages SET is_read = ? WHERE id = ?').run(isRead, req.params.id);
  if (!r.changes) return res.status(404).json({ error: 'Message not found' });
  res.json({ data: { id: req.params.id, is_read: isRead }, error: null });
});

router.delete('/messages/:id', auth.requireAuth, requireSuperAdmin, (req, res) => {
  db.prepare('DELETE FROM contact_messages WHERE id = ?').run(req.params.id);
  res.json({ data: { id: req.params.id, deleted: true }, error: null });
});

// ── delete a user account (super-admin, any company) ──
// The cascade itself lives in routes/_deletion.js so that this and the
// company-facing route in team.js cannot drift apart again.
router.delete('/users/:id', auth.requireAuth, requireSuperAdmin, (req, res) => {
  const u = db.prepare('SELECT id, company_id, role, email FROM users WHERE id = ?').get(req.params.id);
  if (!u) return res.status(404).json({ error: 'User not found' });
  const hard = req.query.hard === '1';

  if (u.role === 'FOUNDER') {
    const founders = db.prepare("SELECT COUNT(*) n FROM users WHERE company_id = ? AND role = 'FOUNDER' AND is_active = 1").get(u.company_id).n || 0;
    if (founders <= 1) return res.status(400).json({ error: 'Cannot remove the only founder — delete the company instead.' });
  }

  if (!hard) {
    try {
      return res.json({ data: deletion.deactivateUser(u.id), error: null });
    } catch (e) {
      return fail(res, e, { context: 'admin:DELETE /users/:id (deactivate)', message: 'Could not deactivate this account.' });
    }
  }

  // Open work may be handed to a colleague, but only a real one inside the same
  // company — otherwise a typo in the query string would either dangle every
  // reassigned row or quietly move a tenant's records into another tenant.
  let reassignTo = null;
  if (req.query.reassign_to) {
    const rt = db.prepare('SELECT id FROM users WHERE id = ? AND company_id = ?').get(req.query.reassign_to, u.company_id);
    if (!rt) return res.status(400).json({ error: 'reassign_to must be a user in the same company.' });
    reassignTo = rt.id;
  }

  let result;
  try {
    result = deletion.hardDeleteUser(u.id, { reassignTo });
  } catch (e) {
    return fail(res, e, { context: 'admin:DELETE /users/:id', message: 'Could not delete this account. Nothing was removed.' });
  }

  console.warn(`[admin] user hard-deleted: ${u.email} (${u.id}) by ${req.user.email}`);
  res.json({ data: { id: u.id, deleted: true, ...result }, error: null });
});

// ── delete an entire company and ALL of its data (super-admin) ──
router.delete('/companies/:id', auth.requireAuth, requireSuperAdmin, (req, res) => {
  const cid = req.params.id;
  const c = db.prepare('SELECT id, name FROM companies WHERE id = ?').get(cid);
  if (!c) return res.status(404).json({ error: 'Company not found' });

  let removed;
  try {
    removed = deletion.deleteCompany(cid);
  } catch (e) {
    return fail(res, e, { context: 'admin:DELETE /companies/:id', message: 'Could not delete the company. Nothing was removed.' });
  }

  console.warn(`[admin] company deleted: ${c.name} (${cid}) by ${req.user.email}`, removed);
  res.json({ data: { id: cid, deleted: true, removed }, error: null });
});

/* ─── Invoicing (super-admin) ─────────────────────────────────────────────
 * Issuing an invoice and confirming payment are platform-owner actions. The
 * tenant-facing /api/billing is read-only by design — a company must never be
 * able to mark its own invoice paid and extend its own access.
 * ───────────────────────────────────────────────────────────────────────── */
const billing = require('../billing');

router.get('/invoices', auth.requireAuth, requireSuperAdmin, (req, res) => {
  const { company_id, status } = req.query;
  const where = [];
  const params = [];
  if (company_id) { where.push('i.company_id = ?'); params.push(company_id); }
  if (status)     { where.push('i.status = ?');     params.push(String(status).toUpperCase()); }
  const rows = db.prepare(
    `SELECT i.*, c.name AS company_name FROM invoices i
       LEFT JOIN companies c ON c.id = i.company_id
       ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY i.created_at DESC LIMIT 500`
  ).all(...params);
  res.json({ data: rows, error: null });
});

router.post('/invoices', auth.requireAuth, requireSuperAdmin, (req, res) => {
  const { company_id, amount, plan, period_start, period_end, due_at, notes } = req.body || {};
  if (!company_id) return res.status(400).json({ error: 'company_id required' });
  if (plan && !billing.PLAN_KEYS.includes(plan)) {
    return res.status(400).json({ error: `Unknown plan: ${plan}` });
  }
  try {
    res.status(201).json({
      data: billing.createInvoice(company_id, { amount, plan, period_start, period_end, due_at, notes }),
      error: null,
    });
  } catch (e) {
    fail(res, e, { status: 400, context: 'admin:POST /invoices' });
  }
});

// Confirming payment is what actually extends access — see billing.markInvoicePaid.
router.post('/invoices/:id/pay', auth.requireAuth, requireSuperAdmin, (req, res) => {
  try {
    const inv = billing.markInvoicePaid(req.params.id, {
      method: req.body?.method || 'bank_transfer',
      reference: req.body?.reference || null,
    });
    res.json({ data: inv, error: null });
  } catch (e) {
    fail(res, e, { status: 400, context: 'admin:POST /invoices/:id/pay' });
  }
});

router.post('/invoices/:id/void', auth.requireAuth, requireSuperAdmin, (req, res) => {
  const r = db.prepare(
    "UPDATE invoices SET status = 'VOID', updated_at = datetime('now') WHERE id = ? AND status != 'PAID'"
  ).run(req.params.id);
  if (!r.changes) return res.status(400).json({ error: 'Invoice not found, or already paid' });
  res.json({ data: { id: req.params.id, status: 'VOID' }, error: null });
});

// Per-company limit overrides, for a negotiated deal that doesn't fit a plan.
router.patch('/companies/:id/limits', auth.requireAuth, requireSuperAdmin, (req, res) => {
  const { seats, max_listings } = req.body || {};
  const norm = v => (v === null || v === '' || v === undefined ? null : parseInt(v, 10));
  db.prepare("UPDATE companies SET seats = ?, max_listings = ?, updated_at = datetime('now') WHERE id = ?")
    .run(norm(seats), norm(max_listings), req.params.id);
  const c = db.prepare('SELECT id, seats, max_listings FROM companies WHERE id = ?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Company not found' });
  res.json({ data: c, error: null });
});

/* ─── Database snapshots (super-admin) ─────────────────────────────────────
 * Automatic snapshots run on a schedule (see backup.js). These endpoints let a
 * platform owner check that they're actually happening, take one on demand
 * before a risky migration, and pull one off the volume.
 * ───────────────────────────────────────────────────────────────────────── */
const backup = require('../backup');

router.get('/backups', auth.requireAuth, requireSuperAdmin, (req, res) => {
  try {
    res.json({ data: { dir: backup.BACKUP_DIR, backups: backup.listBackups() }, error: null });
  } catch (e) {
    fail(res, e, { status: 500, context: 'admin:GET /backups' });
  }
});

router.post('/backups', auth.requireAuth, requireSuperAdmin, (req, res) => {
  try {
    const made = backup.createBackup();
    backup.pruneBackups();
    res.status(201).json({ data: made, error: null });
  } catch (e) {
    fail(res, e, { status: 500, context: 'admin:POST /backups' });
  }
});

// Download one. `resolveBackup` only accepts names matching the snapshot
// pattern, so a traversal attempt resolves to null rather than an arbitrary file.
router.get('/backups/:file', auth.requireAuth, requireSuperAdmin, (req, res) => {
  const full = backup.resolveBackup(req.params.file);
  if (!full) return res.status(404).json({ error: 'No such backup' });
  res.download(full, req.params.file);
});

router.delete('/backups/:file', auth.requireAuth, requireSuperAdmin, (req, res) => {
  const full = backup.resolveBackup(req.params.file);
  if (!full) return res.status(404).json({ error: 'No such backup' });
  try {
    require('fs').unlinkSync(full);
    res.json({ data: { file: req.params.file, deleted: true }, error: null });
  } catch (e) {
    fail(res, e, { status: 500, context: 'admin:DELETE /backups/:file' });
  }
});

module.exports = router;