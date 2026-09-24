'use strict';
/**
 * billing.js — Plans, entitlements, and subscription lifecycle.
 *
 * Deliberately payment-provider-agnostic. This module answers three questions:
 *   1. What does this company's plan allow?        (PLANS + limitsFor)
 *   2. Are they within it?                          (checkSeat / checkListing)
 *   3. Is their subscription still live?            (sweepExpired)
 *
 * Taking money is a separate concern: an invoice records what was owed and
 * whether it was settled, and `method` + `reference` say how. Wiring a real
 * payment provider means filling those two fields in from a webhook — not
 * reshaping anything here.
 *
 * ── SET YOUR REAL PRICES BELOW ──────────────────────────────────────────
 * The amounts are placeholders. They are the one thing in this file that is a
 * business decision rather than an engineering one.
 */
const { nanoid } = require('nanoid');
const { db } = require('./db');

const TRIAL_DAYS = parseInt(process.env.TRIAL_DAYS || '14', 10);

// A grace period after expiry during which the account still works. Cutting
// access off at the exact second an invoice comes due turns a slow bank
// transfer into a support incident and a churned customer.
const GRACE_DAYS = parseInt(process.env.BILLING_GRACE_DAYS || '5', 10);

const PLANS = {
  trial: {
    key: 'trial', name: 'საცდელი', name_en: 'Trial',
    price: 0, currency: 'GEL', interval: 'month',
    seats: 3, listings: 50,
    features: ['სრული CRM', 'ყველა მოდული', `${TRIAL_DAYS} დღე უფასოდ`],
  },
  basic: {
    key: 'basic', name: 'საბაზისო', name_en: 'Basic',
    price: 79, currency: 'GEL', interval: 'month',
    seats: 5, listings: 250,
    features: ['სრული CRM', 'ლიდები და გარიგებები', 'ელფოსტა და WhatsApp'],
  },
  pro: {
    key: 'pro', name: 'პრო', name_en: 'Pro',
    price: 199, currency: 'GEL', interval: 'month',
    seats: 20, listings: 2000,
    features: ['ყველაფერი საბაზისოში', 'ანალიტიკა', 'ფინანსები და საკომისიოები', 'ბრაუზერის გაფართოება'],
  },
  enterprise: {
    key: 'enterprise', name: 'ენტერპრაიზი', name_en: 'Enterprise',
    price: null, currency: 'GEL', interval: 'month',   // null = "contact us"
    seats: null, listings: null,                       // null = unlimited
    features: ['ყველაფერი პროში', 'შეუზღუდავი აგენტები', 'პრიორიტეტული მხარდაჭერა'],
  },
};

const PLAN_KEYS = Object.keys(PLANS);

function planFor(company) {
  return PLANS[company?.plan] || PLANS.trial;
}

/**
 * Effective limits: a per-company override wins over the plan's value, and
 * null at either level means unlimited.
 */
function limitsFor(company) {
  const plan = planFor(company);
  const pick = (override, fromPlan) => (override != null ? override : fromPlan);
  return {
    seats:    pick(company?.seats, plan.seats),
    listings: pick(company?.max_listings, plan.listings),
  };
}

function getCompany(companyId) {
  return db.prepare('SELECT * FROM companies WHERE id = ?').get(companyId);
}

function usageFor(companyId) {
  const count = (table) => {
    try { return db.prepare(`SELECT COUNT(*) n FROM ${table} WHERE company_id = ?`).get(companyId).n; }
    catch (e) { return 0; }
  };
  return {
    seats: db.prepare('SELECT COUNT(*) n FROM users WHERE company_id = ? AND is_active = 1').get(companyId).n,
    listings: count('listings'),
  };
}

/**
 * Entitlement check. Returns { ok } or { ok:false, error, limit, used }.
 * `kind` is 'seats' or 'listings'.
 */
function checkLimit(companyId, kind) {
  const company = getCompany(companyId);
  if (!company) return { ok: true };            // no company row — don't block
  const limit = limitsFor(company)[kind];
  if (limit == null) return { ok: true };        // unlimited
  const used = usageFor(companyId)[kind];
  if (used < limit) return { ok: true };
  return {
    ok: false, limit, used,
    error: kind === 'seats'
      ? `თქვენი გეგმა მოიცავს ${limit} მომხმარებელს. განაახლეთ გეგმა მეტი აგენტის დასამატებლად.`
      : `თქვენი გეგმა მოიცავს ${limit} ობიექტს. განაახლეთ გეგმა მეტის დასამატებლად.`,
  };
}

/* ─── Subscription lifecycle ──────────────────────────────────────────── */

/** Start a company on a trial. Idempotent — won't restart an existing trial. */
function startTrial(companyId) {
  const c = getCompany(companyId);
  if (!c || c.trial_ends_at) return null;
  const ends = new Date(Date.now() + TRIAL_DAYS * 86400000).toISOString();
  db.prepare(
    "UPDATE companies SET plan = COALESCE(plan,'trial'), trial_ends_at = ?, subscription_expires_at = COALESCE(subscription_expires_at, ?), updated_at = datetime('now') WHERE id = ?"
  ).run(ends, ends, companyId);
  return ends;
}

/**
 * Flip companies whose subscription ran out (plus grace) to 'expired'.
 * auth.isCompanyActive already refuses logins past the expiry date, so this is
 * about making the *stored* state honest — otherwise the admin dashboard shows
 * a wall of 'active' companies that can't actually log in.
 */
function sweepExpired() {
  const cutoff = new Date(Date.now() - GRACE_DAYS * 86400000).toISOString();
  try {
    const r = db.prepare(
      `UPDATE companies SET subscription_status = 'expired', updated_at = datetime('now')
        WHERE subscription_status = 'active'
          AND subscription_expires_at IS NOT NULL
          AND subscription_expires_at < ?`
    ).run(cutoff);
    if (r.changes) console.log(`[billing] marked ${r.changes} subscription(s) expired`);
    return r.changes;
  } catch (e) {
    console.error('[billing] expiry sweep failed:', e.message);
    return 0;
  }
}

/** Run the sweep at boot and daily thereafter. */
function scheduleBillingSweep() {
  setTimeout(sweepExpired, 8000);
  const timer = setInterval(sweepExpired, 24 * 3600 * 1000);
  timer.unref();
  return timer;
}

/* ─── Invoices ────────────────────────────────────────────────────────── */

function nextInvoiceNumber() {
  const row = db.prepare(
    "SELECT number FROM invoices WHERE number LIKE 'INV-%' ORDER BY rowid DESC LIMIT 1"
  ).get();
  let n = 1;
  if (row?.number) {
    const m = row.number.match(/(\d+)$/);
    if (m) n = parseInt(m[1], 10) + 1;
  }
  return 'INV-' + String(n).padStart(5, '0');
}

/**
 * Create an invoice for a company's current plan. Amount defaults to the plan
 * price but can be overridden for a negotiated or prorated figure.
 */
function createInvoice(companyId, { amount, plan, period_start, period_end, due_at, notes } = {}) {
  const company = getCompany(companyId);
  if (!company) throw new Error('Company not found');
  const planKey = plan || company.plan || 'trial';
  const planDef = PLANS[planKey] || PLANS.trial;

  const start = period_start || new Date().toISOString().slice(0, 10);
  const end = period_end || new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  const id = nanoid();

  db.prepare(
    `INSERT INTO invoices (id, company_id, number, plan, period_start, period_end,
                           amount, currency, status, issued_at, due_at, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'SENT', datetime('now'), ?, ?)`
  ).run(
    id, companyId, nextInvoiceNumber(), planKey, start, end,
    amount != null ? amount : (planDef.price || 0), planDef.currency || 'GEL',
    due_at || new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10),
    notes || null
  );
  return db.prepare('SELECT * FROM invoices WHERE id = ?').get(id);
}

/**
 * Mark an invoice paid and extend the subscription by one period. This is the
 * single place a payment becomes access — whatever triggers it (an admin
 * confirming a bank transfer today, a PSP webhook later) lands here.
 */
function markInvoicePaid(invoiceId, { method = 'bank_transfer', reference = null } = {}) {
  const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(invoiceId);
  if (!inv) throw new Error('Invoice not found');
  if (inv.status === 'PAID') return inv;

  db.prepare(
    `UPDATE invoices SET status = 'PAID', paid_at = datetime('now'),
            method = ?, reference = ?, updated_at = datetime('now') WHERE id = ?`
  ).run(method, reference, invoiceId);

  // Extend from whichever is later: the current expiry or today. Extending from
  // "today" alone would silently burn the remaining days of anyone who pays early.
  const company = getCompany(inv.company_id);
  const currentEnd = company?.subscription_expires_at
    ? Math.max(Date.parse(company.subscription_expires_at), Date.now())
    : Date.now();
  const newEnd = new Date(currentEnd + 30 * 86400000).toISOString();

  db.prepare(
    `UPDATE companies SET subscription_status = 'active', subscription_expires_at = ?,
            plan = COALESCE(?, plan), updated_at = datetime('now') WHERE id = ?`
  ).run(newEnd, inv.plan || null, inv.company_id);

  return db.prepare('SELECT * FROM invoices WHERE id = ?').get(invoiceId);
}

module.exports = {
  PLANS, PLAN_KEYS, TRIAL_DAYS, GRACE_DAYS,
  planFor, limitsFor, usageFor, checkLimit, getCompany,
  startTrial, sweepExpired, scheduleBillingSweep,
  createInvoice, markInvoicePaid, nextInvoiceNumber,
};
