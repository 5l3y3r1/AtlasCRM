'use strict';
/**
 * routes/billing.js — Company-facing billing (mounted at /api/billing).
 *
 * What an agency owner needs to see: which plan they're on, how much of it
 * they're using, when it renews, and their invoice history. Changing plans,
 * issuing invoices and confirming payment are platform-owner actions and live
 * in routes/admin.js instead — a tenant must never be able to extend its own
 * subscription or mark its own invoice paid.
 */
const express = require('express');
const { db } = require('../db');
const auth = require('../auth');
const billing = require('../billing');

const router = express.Router();
router.use(express.json({ limit: '256kb' }));

/* ─── GET /api/billing/plans ────────────────────────────────────────────
 * Public, and mounted before requireAuth on purpose: this is the price list.
 * The marketing page renders it, so it has to be readable by someone who has
 * not signed up yet — and keeping it here means the landing page can never
 * drift out of sync with what billing.js actually charges.
 * ─────────────────────────────────────────────────────────────────────── */
router.get('/plans', (req, res) => {
  res.json({ data: Object.values(billing.PLANS), error: null });
});

router.use(auth.requireAuth);

const MANAGER_ROLES = new Set(['MANAGER', 'OWNER', 'FOUNDER', 'ADMIN']);

function requireManager(req, res, next) {
  if (!MANAGER_ROLES.has(req.user.role)) {
    return res.status(403).json({ error: 'Only managers may view billing' });
  }
  if (!req.user.company_id) return res.status(400).json({ error: 'No company on this account' });
  next();
}

/* ─── GET /api/billing/summary ──────────────────────────────────────────
 * Current plan, limits, live usage, subscription dates and invoices.
 * ─────────────────────────────────────────────────────────────────────── */
router.get('/summary', requireManager, (req, res) => {
  const company = billing.getCompany(req.user.company_id);
  if (!company) return res.status(404).json({ error: 'Company not found' });

  const plan = billing.planFor(company);
  const limits = billing.limitsFor(company);
  const usage = billing.usageFor(company.id);

  const expiresAt = company.subscription_expires_at;
  const daysLeft = expiresAt
    ? Math.ceil((Date.parse(expiresAt) - Date.now()) / 86400000)
    : null;

  const invoices = db.prepare(
    `SELECT id, number, plan, period_start, period_end, amount, currency,
            status, issued_at, due_at, paid_at, method
       FROM invoices WHERE company_id = ? ORDER BY created_at DESC LIMIT 50`
  ).all(company.id);

  res.json({
    data: {
      company: { id: company.id, name: company.name, billing_email: company.billing_email },
      plan,
      limits,
      usage,
      subscription: {
        status: company.subscription_status || 'active',
        expires_at: expiresAt,
        days_left: daysLeft,
        trial_ends_at: company.trial_ends_at,
        in_grace: daysLeft != null && daysLeft <= 0 && daysLeft > -billing.GRACE_DAYS,
        grace_days: billing.GRACE_DAYS,
      },
      invoices,
    },
    error: null,
  });
});

/* ─── PATCH /api/billing/contact ────────────────────────────────────────
 * The one billing field a tenant owns: where their invoices are sent.
 * ─────────────────────────────────────────────────────────────────────── */
router.patch('/contact', requireManager, (req, res) => {
  const email = String(req.body?.billing_email || '').trim();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Invalid email' });
  }
  db.prepare("UPDATE companies SET billing_email = ?, updated_at = datetime('now') WHERE id = ?")
    .run(email || null, req.user.company_id);
  res.json({ data: { billing_email: email || null }, error: null });
});

/* ─── GET /api/billing/invoices/:id ─────────────────────────────────────
 * One invoice, scoped to the caller's company so an id from another tenant
 * resolves to a 404 rather than someone else's billing record.
 * ─────────────────────────────────────────────────────────────────────── */
router.get('/invoices/:id', requireManager, (req, res) => {
  const inv = db.prepare('SELECT * FROM invoices WHERE id = ? AND company_id = ?')
    .get(req.params.id, req.user.company_id);
  if (!inv) return res.status(404).json({ error: 'Invoice not found' });
  res.json({ data: inv, error: null });
});

module.exports = router;
