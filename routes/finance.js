'use strict';
/**
 * routes/finance.js — finance engine (derived) + commission automation
 *
 *   GET  /api/finance/rollup              KPIs + commission list + transactions, all derived
 *   POST /api/finance/commissions/generate { deal_id }   create commission + income on a won deal (idempotent)
 *   POST /api/finance/commissions/pay      { id }         mark paid + post the agent payout (idempotent)
 *
 * The agency commission % and the agent split % vary per deal, so they are read
 * from the deal itself (entered in the deal editor). Closing a deal books:
 *   • an INCOMING transaction for the agency's gross commission, and
 *   • a PENDING commission_record per agent (their split of that gross).
 * Marking a commission paid books the matching OUTGOING payout, so net profit is real.
 */
const express = require('express');
const { nanoid } = require('nanoid');
const { db } = require('../db');
const { requireAuth } = require('../auth');
const { fail } = require('./_errors');

const router = express.Router();
router.use(requireAuth);
router.use(express.json());

const WON_STAGES = ['CLOSED', 'CLOSED_WON', 'WON'];

function monthStartISO() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

/* ════════════════════════════════════════════════════════════════════════
   GET /rollup — KPIs + lists, derived with tolerant direction handling
   ════════════════════════════════════════════════════════════════════════ */
router.get('/rollup', (req, res) => {
  const cid = req.user.company_id;
  try {
    const since = monthStartISO();

    // Income / expense for the current month. Direction vocab is inconsistent in
    // historical data ('IN' / 'INFLOW' / 'INCOMING'), so classify by prefix.
    const txns = db.prepare(
      `SELECT amount, direction, status, transaction_date
         FROM financial_transactions
        WHERE company_id = ?`
    ).all(cid);

    let income = 0, expense = 0;
    for (const tr of txns) {
      if ((tr.status || 'COMPLETED').toUpperCase() !== 'COMPLETED') continue;
      if ((tr.transaction_date || '') < since) continue;
      const dir = String(tr.direction || '').toUpperCase();
      const amt = Number(tr.amount || 0);
      if (dir.startsWith('IN')) income += amt;
      else if (dir.startsWith('OUT')) expense += amt;
    }

    const pendingRow = db.prepare(
      `SELECT COALESCE(SUM(amount), 0) AS p
         FROM commission_records
        WHERE company_id = ? AND is_paid = 0`
    ).get(cid);
    const pending = Number(pendingRow.p || 0);

    const commissions = db.prepare(
      `SELECT cr.*, u.first_name, u.last_name, d.title AS deal_title, d.deal_number
         FROM commission_records cr
         LEFT JOIN users u ON u.id = cr.user_id
         LEFT JOIN deals d ON d.id = cr.deal_id
        WHERE cr.company_id = ?
        ORDER BY cr.created_at DESC
        LIMIT 50`
    ).all(cid);

    const transactions = db.prepare(
      `SELECT * FROM financial_transactions
        WHERE company_id = ?
        ORDER BY transaction_date DESC, created_at DESC
        LIMIT 50`
    ).all(cid);

    res.json({
      data: {
        kpis: { income, expense, profit: income - expense, pending },
        commissions,
        transactions,
      },
    });
  } catch (e) {
    fail(res, e, { status: 500, context: 'finance:GET /rollup' });
  }
});

/* ════════════════════════════════════════════════════════════════════════
   POST /commissions/generate — book commission + income for a won deal
   ════════════════════════════════════════════════════════════════════════ */
router.post('/commissions/generate', (req, res) => {
  const cid = req.user.company_id;
  const dealId = req.body && req.body.deal_id;
  if (!dealId) return res.status(400).json({ error: 'deal_id required' });

  try {
    const deal = db.prepare(
      'SELECT * FROM deals WHERE id = ? AND company_id = ?'
    ).get(dealId, cid);
    if (!deal) return res.status(404).json({ error: 'deal not found' });

    if (!WON_STAGES.includes(String(deal.current_stage || '').toUpperCase())) {
      return res.json({ data: { generated: false, reason: 'deal not won' } });
    }

    // Idempotency: never double-book a deal
    if (deal.commission_generated_at) {
      return res.json({ data: { generated: false, reason: 'already generated' } });
    }
    const existing = db.prepare(
      'SELECT COUNT(*) AS n FROM commission_records WHERE deal_id = ?'
    ).get(dealId);
    if (existing.n > 0) {
      return res.json({ data: { generated: false, reason: 'records exist' } });
    }

    const value = Number(deal.final_price || deal.asking_price || 0);
    const agencyGross = Number(deal.commission_amount) > 0
      ? Number(deal.commission_amount)
      : value * (Number(deal.commission_percent || 0) / 100);

    if (!(agencyGross > 0)) {
      return res.json({ data: { generated: false, reason: 'no commission amount on deal' } });
    }

    const split = Number(deal.agent_split_percent != null ? deal.agent_split_percent : 50);

    // Distinct agents on the deal share the gross equally; each keeps `split` %.
    const agentIds = [...new Set([deal.buyer_agent_id, deal.seller_agent_id].filter(Boolean))];
    if (!agentIds.length) {
      return res.json({ data: { generated: false, reason: 'no agent on deal' } });
    }
    const grossPerAgent = agencyGross / agentIds.length;

    const insertCr = db.prepare(
      `INSERT INTO commission_records
        (id, company_id, deal_id, user_id, current_stage, amount, percent, role, payment_status, is_paid)
        VALUES (?,?,?,?,?,?,?,?, 'PENDING', 0)`
    );
    const records = [];
    for (const uid of agentIds) {
      const amount = +(grossPerAgent * split / 100).toFixed(2);
      const id = nanoid();
      insertCr.run(id, cid, dealId, uid, deal.current_stage, amount, split, 'AGENT');
      records.push({ id, user_id: uid, amount });
    }

    // Book the agency's gross commission as income
    db.prepare(
      `INSERT INTO financial_transactions
        (id, transaction_number, company_id, deal_id, transaction_type, direction,
         amount, currency, description, transaction_date, status)
        VALUES (?,?,?,?, 'COMMISSION_RECEIVED', 'INCOMING', ?, 'USD', ?, date('now'), 'COMPLETED')`
    ).run(
      nanoid(), 'TX-' + Date.now(), cid, dealId, agencyGross,
      `Commission — ${deal.title || deal.deal_number || 'deal'}`
    );

    db.prepare("UPDATE deals SET commission_generated_at = datetime('now') WHERE id = ?").run(dealId);

    res.json({ data: { generated: true, agency_gross: agencyGross, records } });
  } catch (e) {
    fail(res, e, { status: 500, context: 'finance:POST /commissions/generate' });
  }
});

/* ════════════════════════════════════════════════════════════════════════
   POST /commissions/pay — mark paid + book the agent payout
   ════════════════════════════════════════════════════════════════════════ */
router.post('/commissions/pay', (req, res) => {
  const cid = req.user.company_id;
  const id = req.body && req.body.id;
  if (!id) return res.status(400).json({ error: 'id required' });

  try {
    const cr = db.prepare(
      'SELECT * FROM commission_records WHERE id = ? AND company_id = ?'
    ).get(id, cid);
    if (!cr) return res.status(404).json({ error: 'commission not found' });
    if (cr.is_paid) return res.json({ data: { paid: true, already: true } });

    db.prepare(
      `UPDATE commission_records
          SET is_paid = 1, payment_status = 'PAID', paid_at = datetime('now'), paid_by = ?
        WHERE id = ?`
    ).run(req.user.id, id);

    // Book the payout as an expense so it hits net profit
    db.prepare(
      `INSERT INTO financial_transactions
        (id, transaction_number, company_id, deal_id, agent_id, transaction_type, direction,
         amount, currency, description, transaction_date, status)
        VALUES (?,?,?,?,?, 'COMMISSION_PAID', 'OUTGOING', ?, 'USD', ?, date('now'), 'COMPLETED')`
    ).run(
      nanoid(), 'TX-' + Date.now(), cid, cr.deal_id, cr.user_id, Number(cr.amount || 0),
      'Agent commission payout'
    );

    res.json({ data: { paid: true } });
  } catch (e) {
    fail(res, e, { status: 500, context: 'finance:POST /commissions/pay' });
  }
});

module.exports = router;
