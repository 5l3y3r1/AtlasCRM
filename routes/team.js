'use strict';
// Team management (#4): safe user account deletion within a company.
// Managers/founders only. Soft (deactivate) or hard (reassign records + remove).
//
// The cascade itself lives in routes/_deletion.js, shared with the platform
// admin route. This file used to carry its own copy built on a helper that
// swallowed every failure — `const run = (sql, ...p) => { try { ... } catch {} }`
// — so a delete that hit a constraint still answered "deleted: true" and left
// the account in place. It also only knew about six tables, which meant an
// agent's showings, contracts, commissions and meetings kept pointing at
// someone who no longer existed.
const express = require('express');
const router = express.Router();
const { db } = require('../db');
const auth = require('../auth');
const { fail } = require('./_errors');
const deletion = require('./_deletion');
router.use(express.json());

const MGR = new Set(['MANAGER', 'OWNER', 'FOUNDER', 'ADMIN']);

router.post('/delete-user', auth.requireAuth, (req, res) => {
  if (!MGR.has(req.user.role)) return res.status(403).json({ error: 'მხოლოდ მენეჯერს/დამფუძნებელს შეუძლია მომხმარებლის წაშლა' });
  const b = req.body || {};
  const userId = (b.userId || '').toString();
  const mode = b.mode === 'hard' ? 'hard' : 'soft';
  const reassignTo = (b.reassignTo || '').toString();

  if (!userId) return res.status(400).json({ error: 'userId required' });
  if (userId === req.user.id) return res.status(400).json({ error: 'საკუთარი ანგარიშის წაშლა არ შეიძლება' });

  const target = db.prepare('SELECT id, company_id, role, email FROM users WHERE id = ?').get(userId);
  if (!target || target.company_id !== req.user.company_id)
    return res.status(404).json({ error: 'მომხმარებელი ვერ მოიძებნა' });

  // Never remove the last active founder.
  if (target.role === 'FOUNDER') {
    const founders = db.prepare("SELECT COUNT(*) n FROM users WHERE company_id = ? AND role = 'FOUNDER' AND is_active = 1")
      .get(target.company_id).n || 0;
    if (founders <= 1) return res.status(400).json({ error: 'ბოლო დამფუძნებლის წაშლა/გათიშვა არ შეიძლება' });
  }

  if (mode === 'soft') {
    try {
      return res.json({ data: deletion.deactivateUser(userId), error: null });
    } catch (e) {
      return fail(res, e, { context: 'team:POST /delete-user (deactivate)', message: 'ანგარიშის გათიშვა ვერ მოხერხდა' });
    }
  }

  // Work is handed to a colleague only if that colleague is real and in the
  // same company — otherwise the records are left unassigned rather than
  // quietly moved to whatever id the caller sent.
  let newId = null;
  if (reassignTo && reassignTo !== userId) {
    const rt = db.prepare('SELECT id FROM users WHERE id = ? AND company_id = ?').get(reassignTo, target.company_id);
    if (rt) newId = rt.id;
  }

  let result;
  try {
    result = deletion.hardDeleteUser(userId, { reassignTo: newId });
  } catch (e) {
    return fail(res, e, { context: 'team:POST /delete-user', message: 'მომხმარებლის წაშლა ვერ მოხერხდა' });
  }

  console.warn(`[team] user deleted: ${target.email} (${userId}) by ${req.user.email}`);
  res.json({ data: { id: userId, deleted: true, reassignedTo: result.reassignedTo, reassigned: result.reassigned }, error: null });
});

module.exports = router;
