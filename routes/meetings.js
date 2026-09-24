'use strict';
// Meetings — scheduled via the chat "attach a record" flow. Not just free text:
// the owner and client are found-or-created against the real leads/clients
// tables (deduped by phone within the company), matching how the extension's
// owner-import already works, so a meeting genuinely links into the CRM.
const express = require('express');
const router = express.Router();
const { nanoid } = require('nanoid');
const { db } = require('../db');
const auth = require('../auth');
router.use(express.json({ limit: '256kb' }));

const MGR_ROLES = new Set(['FOUNDER', 'MANAGER', 'OWNER', 'ADMIN']);
const q1 = (sql, ...p) => { try { return db.prepare(sql).get(...p) || {}; } catch (e) { return {}; } };
const qa = (sql, ...p) => { try { return db.prepare(sql).all(...p); } catch (e) { return []; } };
const run = (sql, ...p) => { try { return db.prepare(sql).run(...p); } catch (e) { return {}; } };

function generateCaseNumber() {
  const d = new Date();
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  for (let i = 0; i < 5; i++) {
    const candidate = `CASE-${stamp}-${Math.floor(Math.random() * 900 + 100)}`;
    if (!q1('SELECT id FROM meetings WHERE case_number = ?', candidate).id) return candidate;
  }
  return `CASE-${stamp}-${nanoid(4)}`;
}

// Find-or-create an owner lead by phone (same dedupe rule the extension's import already uses).
function ensureOwner(companyId, agentId, name, phone) {
  if (!phone && !name) return null;
  if (phone) {
    const existing = q1('SELECT id FROM leads WHERE company_id = ? AND phone = ?', companyId, phone);
    if (existing.id) return existing.id;
  }
  const id = nanoid();
  run('INSERT INTO leads (id, company_id, agent_id, created_by_id, full_name, phone, source, status, temperature) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      id, companyId, agentId, agentId, name || null, phone || null, 'MEETING_FORM', 'NEW', 'WARM');
  return id;
}

// Find-or-create a client by phone.
function ensureClient(companyId, agentId, name, phone) {
  if (!phone && !name) return null;
  if (phone) {
    const existing = q1('SELECT id FROM clients WHERE company_id = ? AND phone = ?', companyId, phone);
    if (existing.id) return existing.id;
  }
  const parts = (name || '').trim().split(/\s+/);
  const id = nanoid();
  run('INSERT INTO clients (id, company_id, primary_agent_id, created_by_id, first_name, last_name, phone, lead_source, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      id, companyId, agentId, agentId, parts[0] || name || null, parts.slice(1).join(' ') || null, phone || null, 'MEETING_FORM', 'ACTIVE');
  return id;
}

function canManageMeeting(user, meeting) {
  if (MGR_ROLES.has(user.role)) return true;
  return meeting.primary_agent_id === user.id || meeting.secondary_agent_id === user.id || meeting.created_by_id === user.id;
}

// ── create a meeting ──
router.post('/', auth.requireAuth, (req, res) => {
  const b = req.body || {};
  const companyId = req.user.company_id;
  const ownerId = ensureOwner(companyId, req.user.id, (b.ownerName || '').trim(), (b.ownerPhone || '').trim());
  const clientId = ensureClient(companyId, req.user.id, (b.clientName || '').trim(), (b.clientPhone || '').trim());

  const id = nanoid();
  const caseNumber = (b.caseNumber || '').trim() || generateCaseNumber();
  run(`INSERT INTO meetings (
        id, company_id, case_number, property_type, deal_type, address,
        owner_lead_id, owner_name, owner_phone, client_id, client_name, client_phone,
        price, cooperation, term_months, meeting_time,
        primary_agent_id, primary_agent_role, secondary_agent_id, secondary_agent_role,
        created_by_id
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      id, companyId, caseNumber, b.propertyType || null, b.dealType || null, (b.address || '').trim() || null,
      ownerId, (b.ownerName || '').trim() || null, (b.ownerPhone || '').trim() || null,
      clientId, (b.clientName || '').trim() || null, (b.clientPhone || '').trim() || null,
      b.price ? Number(b.price) : null, (b.cooperation || '').trim() || null,
      b.termMonths ? Number(b.termMonths) : 12, b.meetingTime || null,
      req.user.id, (b.agentRole || '').trim() || null,
      b.secondAgentId || null, b.secondAgentId ? ((b.secondAgentRole || '').trim() || null) : null,
      req.user.id);

  const meeting = q1('SELECT * FROM meetings WHERE id = ?', id);
  res.status(201).json({ data: { ...meeting, label: meetingLabel(meeting) }, error: null });
});

// ── fetch one (to reopen the form pre-filled) ──
router.get('/:id', auth.requireAuth, (req, res) => {
  const m = q1('SELECT * FROM meetings WHERE id = ?', req.params.id);
  if (!m.id || m.company_id !== req.user.company_id) return res.status(404).json({ error: 'შეხვედრა ვერ მოიძებნა' });
  if (!canManageMeeting(req.user, m)) return res.status(403).json({ error: 'წვდომა შეზღუდულია' });
  res.json({ data: { ...m, label: meetingLabel(m) }, error: null });
});

// ── update (re-save the same form) ──
router.put('/:id', auth.requireAuth, (req, res) => {
  const existing = q1('SELECT * FROM meetings WHERE id = ?', req.params.id);
  if (!existing.id || existing.company_id !== req.user.company_id) return res.status(404).json({ error: 'შეხვედრა ვერ მოიძებნა' });
  if (!canManageMeeting(req.user, existing)) return res.status(403).json({ error: 'ცვლილება შეზღუდულია' });

  const b = req.body || {};
  const companyId = req.user.company_id;
  const ownerId = ensureOwner(companyId, existing.primary_agent_id || req.user.id, (b.ownerName || '').trim(), (b.ownerPhone || '').trim());
  const clientId = ensureClient(companyId, existing.primary_agent_id || req.user.id, (b.clientName || '').trim(), (b.clientPhone || '').trim());

  run(`UPDATE meetings SET
        property_type=?, deal_type=?, address=?, owner_lead_id=?, owner_name=?, owner_phone=?,
        client_id=?, client_name=?, client_phone=?, price=?, cooperation=?, term_months=?,
        meeting_time=?, primary_agent_role=?, secondary_agent_id=?, secondary_agent_role=?,
        status=?, updated_at=datetime('now')
       WHERE id=?`,
      b.propertyType || null, b.dealType || null, (b.address || '').trim() || null,
      ownerId, (b.ownerName || '').trim() || null, (b.ownerPhone || '').trim() || null,
      clientId, (b.clientName || '').trim() || null, (b.clientPhone || '').trim() || null,
      b.price ? Number(b.price) : null, (b.cooperation || '').trim() || null,
      b.termMonths ? Number(b.termMonths) : 12, b.meetingTime || null,
      (b.agentRole || '').trim() || null, b.secondAgentId || null,
      b.secondAgentId ? ((b.secondAgentRole || '').trim() || null) : null,
      b.status || existing.status || 'SCHEDULED', req.params.id);

  const meeting = q1('SELECT * FROM meetings WHERE id = ?', req.params.id);
  res.json({ data: { ...meeting, label: meetingLabel(meeting) }, error: null });
});

function meetingLabel(m) {
  const when = m.meeting_time ? new Date(m.meeting_time.replace(' ', 'T')).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
  return [m.case_number, m.address, when].filter(Boolean).join(' — ');
}

module.exports = router;
