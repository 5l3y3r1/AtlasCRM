'use strict';
// Real-time team chat: group channels + 1:1 private DMs.
// A DM is modeled as a 2-person channel (is_dm=1, dm_key=sorted "uidA:uidB") so
// there is exactly one send/read/list code path for both — no duplicated logic.
const express = require('express');
const router = express.Router();
const { nanoid } = require('nanoid');
const { db } = require('../db');
const auth = require('../auth');
router.use(express.json({ limit: '256kb' }));

// Reads fall back to an empty result so one missing row cannot blank the whole
// chat panel — but they say so in the log rather than disappearing.
const q1 = (sql, ...p) => { try { return db.prepare(sql).get(...p) || {}; } catch (e) { console.error('[chat] query failed:', sql, e.message); return {}; } };
const qa = (sql, ...p) => { try { return db.prepare(sql).all(...p); } catch (e) { console.error('[chat] query failed:', sql, e.message); return []; } };
// Writes do NOT get that treatment. This used to swallow the error and return
// {}, so a message that was never stored still came back to the sender as sent
// and vanished on reload. Let it throw — server.js turns it into a clean error.
const run = (sql, ...p) => db.prepare(sql).run(...p);
const userName = (id) => { const u = q1('SELECT first_name, last_name FROM users WHERE id = ?', id); return ((u.first_name || '') + ' ' + (u.last_name || '')).trim() || null; };

const MGR_ROLES = new Set(['FOUNDER', 'MANAGER']);
const DATA_MGR_ROLES = new Set(['FOUNDER', 'MANAGER', 'OWNER', 'ADMIN']); // who may see/attach ANY record, not just their own
const REF_TABLES = { DEAL: 'deals', LISTING: 'listings', MEETING: 'meetings' };
// Ownership columns per record type — only what actually exists on each table.
const REF_OWN_COLS = {
  DEAL: ['buyer_agent_id', 'seller_agent_id'],
  LISTING: ['agent_id', 'created_by_id'],
  MEETING: ['primary_agent_id', 'secondary_agent_id', 'created_by_id'],
};
// A non-manager may only see/attach records they actually own — same rule as
// everywhere else in the app (Owners/Clients/Deals/Properties isolation).
function refOwnershipClause(type, userId, params) {
  const cols = REF_OWN_COLS[type] || [];
  if (!cols.length) return '1=0';
  params.push(...cols.map(() => userId));
  return '(' + cols.map(c => `${c} = ?`).join(' OR ') + ')';
}

// Who may add/remove members on a GROUP channel: the channel's own admin/owner,
// or a company FOUNDER/MANAGER. (Not applicable to DMs — those are fixed at 2.)
function canManageChannel(channelId, user) {
  if (MGR_ROLES.has(user.role)) return true;
  const m = q1('SELECT role FROM chat_channel_members WHERE channel_id = ? AND user_id = ?', channelId, user.id);
  return m.role === 'admin' || m.role === 'owner';
}

// Enrich a raw chat_messages row with sender name, grouped reactions, and a short
// reply-preview — used by both the message-list endpoint and a fresh send response.
function enrichMessage(m) {
  const reactions = qa('SELECT emoji, user_id FROM chat_reactions WHERE message_id = ?', m.id);
  let replyPreview = null;
  if (m.reply_to_id) {
    const orig = q1('SELECT content, sender_id, deleted_at FROM chat_messages WHERE id = ?', m.reply_to_id);
    if (orig.sender_id) {
      replyPreview = { sender_name: userName(orig.sender_id), content: orig.deleted_at ? null : (orig.content || '📎') };
    }
  }
  return { ...m, sender_name: userName(m.sender_id), reactions, reply_preview: replyPreview };
}

// Lazily ensure a company-wide "General" channel exists and the current user is in it.
// Self-heals for both brand-new companies and users added after the channel was created.
function ensureGeneralChannel(companyId, userId) {
  let gen = q1("SELECT id FROM chat_channels WHERE company_id = ? AND is_dm = 0 AND name = 'General' ORDER BY created_at ASC LIMIT 1", companyId);
  if (!gen.id) {
    gen = { id: nanoid() };
    run('INSERT INTO chat_channels (id, company_id, name, description, is_dm, created_by) VALUES (?, ?, ?, ?, 0, ?)',
        gen.id, companyId, 'General', null, userId);
  }
  const already = db.prepare('SELECT 1 FROM chat_channel_members WHERE channel_id = ? AND user_id = ?').get(gen.id, userId);
  if (!already) run('INSERT INTO chat_channel_members (id, channel_id, user_id, role) VALUES (?, ?, ?, ?)', nanoid(), gen.id, userId, 'member');
  return gen.id;
}

// ── list my channels + DMs, with last message preview + unread count ──
router.get('/channels', auth.requireAuth, (req, res) => {
  const uid = req.user.id, cid = req.user.company_id;
  ensureGeneralChannel(cid, uid);

  const rows = qa(`
    SELECT c.id, c.name, c.description, c.is_dm, c.dm_key, m.last_read_message_id
      FROM chat_channel_members m JOIN chat_channels c ON c.id = m.channel_id
     WHERE m.user_id = ? AND c.company_id = ?`, uid, cid);

  const data = rows.map(c => {
    const last = q1('SELECT id, content, attachment_url, sender_id, created_at FROM chat_messages WHERE channel_id = ? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1', c.id);
    const unread = c.last_read_message_id
      ? (q1('SELECT COUNT(*) n FROM chat_messages WHERE channel_id = ? AND deleted_at IS NULL AND created_at > (SELECT created_at FROM chat_messages WHERE id = ?)', c.id, c.last_read_message_id).n || 0)
      : (q1('SELECT COUNT(*) n FROM chat_messages WHERE channel_id = ? AND deleted_at IS NULL', c.id).n || 0);
    let displayName = c.name, otherUserId = null, otherOnline = false;
    if (c.is_dm) {
      const other = qa('SELECT user_id FROM chat_channel_members WHERE channel_id = ? AND user_id != ?', c.id, uid)[0];
      otherUserId = other ? other.user_id : null;
      displayName = otherUserId ? userName(otherUserId) : 'Unknown';
      if (otherUserId) {
        const ou = q1('SELECT last_seen_at FROM users WHERE id = ?', otherUserId);
        otherOnline = !!(ou.last_seen_at && (Date.now() - Date.parse(ou.last_seen_at) < 5 * 60 * 1000));
      }
    }
    return {
      id: c.id, name: displayName, description: c.description, is_dm: !!c.is_dm,
      other_user_id: otherUserId, other_online: otherOnline,
      last_message: last.id ? { content: last.content, attachment_url: last.attachment_url, sender_id: last.sender_id, sender_name: userName(last.sender_id), created_at: last.created_at } : null,
      unread,
    };
  });
  data.sort((a, b) => {
    const at = a.last_message ? a.last_message.created_at : '';
    const bt = b.last_message ? b.last_message.created_at : '';
    return bt.localeCompare(at);
  });
  res.json({ data, error: null });
});

// ── create a group channel ──
router.post('/channels', auth.requireAuth, (req, res) => {
  const b = req.body || {};
  const name = (b.name || '').toString().trim();
  if (!name) return res.status(400).json({ error: 'სახელი აუცილებელია' });
  const memberIds = Array.isArray(b.memberIds) ? b.memberIds : [];

  const id = nanoid();
  run('INSERT INTO chat_channels (id, company_id, name, description, is_dm, created_by) VALUES (?, ?, ?, ?, 0, ?)',
      id, req.user.company_id, name, (b.description || '').toString().trim() || null, req.user.id);
  run('INSERT INTO chat_channel_members (id, channel_id, user_id, role) VALUES (?, ?, ?, ?)', nanoid(), id, req.user.id, 'owner');

  const validMembers = memberIds.length
    ? qa(`SELECT id FROM users WHERE company_id = ? AND id IN (${memberIds.map(() => '?').join(',')})`, req.user.company_id, ...memberIds).map(r => r.id)
    : [];
  for (const uid of validMembers) {
    if (uid === req.user.id) continue;
    // A member already in the channel is not an error; anything else is.
    try { run('INSERT INTO chat_channel_members (id, channel_id, user_id, role) VALUES (?, ?, ?, ?)', nanoid(), id, uid, 'member'); }
    catch (e) { if (!/UNIQUE constraint/.test(e.message)) throw e; }
  }
  res.json({ data: { id, name }, error: null });
});

// ── list a channel's members (for the members modal) ──
router.get('/channels/:id/members', auth.requireAuth, (req, res) => {
  const ch = q1('SELECT id, company_id FROM chat_channels WHERE id = ?', req.params.id);
  if (!ch.id || ch.company_id !== req.user.company_id) return res.status(404).json({ error: 'არხი ვერ მოიძებნა' });
  if (!db.prepare('SELECT 1 FROM chat_channel_members WHERE channel_id = ? AND user_id = ?').get(ch.id, req.user.id))
    return res.status(403).json({ error: 'თქვენ არ ხართ ამ არხის წევრი' });
  const rows = qa(`SELECT m.user_id, m.role, u.first_name, u.last_name, u.role AS company_role
                     FROM chat_channel_members m JOIN users u ON u.id = m.user_id
                    WHERE m.channel_id = ?`, ch.id);
  res.json({ data: rows, error: null, canManage: canManageChannel(ch.id, req.user) });
});

// ── add a member to a channel (channel admin/owner or company manager/founder; not for DMs) ──
router.post('/channels/:id/members', auth.requireAuth, (req, res) => {
  const ch = q1('SELECT id, company_id, is_dm FROM chat_channels WHERE id = ?', req.params.id);
  if (!ch.id || ch.company_id !== req.user.company_id) return res.status(404).json({ error: 'არხი ვერ მოიძებნა' });
  if (ch.is_dm) return res.status(400).json({ error: 'პირად მიმოწერაში წევრის დამატება არ შეიძლება' });
  if (!canManageChannel(ch.id, req.user)) return res.status(403).json({ error: 'წევრების მართვა მხოლოდ ადმინს შეუძლია' });
  const userId = (req.body || {}).userId;
  const u = q1('SELECT id FROM users WHERE id = ? AND company_id = ?', userId, req.user.company_id);
  if (!u.id) return res.status(404).json({ error: 'მომხმარებელი ვერ მოიძებნა' });
  if (!db.prepare('SELECT 1 FROM chat_channel_members WHERE channel_id = ? AND user_id = ?').get(ch.id, u.id))
    run('INSERT INTO chat_channel_members (id, channel_id, user_id, role) VALUES (?, ?, ?, ?)', nanoid(), ch.id, u.id, 'member');
  res.json({ data: { ok: true }, error: null });
});

// ── remove a member (channel admin/owner or company manager/founder; not for DMs) ──
router.delete('/channels/:id/members/:userId', auth.requireAuth, (req, res) => {
  const ch = q1('SELECT id, company_id, is_dm, created_by FROM chat_channels WHERE id = ?', req.params.id);
  if (!ch.id || ch.company_id !== req.user.company_id) return res.status(404).json({ error: 'არხი ვერ მოიძებნა' });
  if (ch.is_dm) return res.status(400).json({ error: 'პირადი მიმოწერიდან წევრის ამოშლა არ შეიძლება' });
  if (!canManageChannel(ch.id, req.user)) return res.status(403).json({ error: 'წევრების მართვა მხოლოდ ადმინს შეუძლია' });
  const target = q1('SELECT role FROM chat_channel_members WHERE channel_id = ? AND user_id = ?', ch.id, req.params.userId);
  if (target.role === 'owner') return res.status(400).json({ error: 'არხის მფლობელის ამოშლა არ შეიძლება' });
  run('DELETE FROM chat_channel_members WHERE channel_id = ? AND user_id = ?', ch.id, req.params.userId);
  res.json({ data: { ok: true }, error: null });
});

// ── find or create a DM with another user ──
router.post('/dm', auth.requireAuth, (req, res) => {
  const withUserId = (req.body || {}).withUserId;
  if (!withUserId || withUserId === req.user.id) return res.status(400).json({ error: 'withUserId required' });
  const other = q1('SELECT id FROM users WHERE id = ? AND company_id = ?', withUserId, req.user.company_id);
  if (!other.id) return res.status(404).json({ error: 'მომხმარებელი ვერ მოიძებნა' });

  const dmKey = [req.user.id, withUserId].sort().join(':');
  let ch = q1('SELECT id FROM chat_channels WHERE company_id = ? AND dm_key = ?', req.user.company_id, dmKey);
  if (!ch.id) {
    ch = { id: nanoid() };
    run('INSERT INTO chat_channels (id, company_id, is_dm, dm_key, created_by) VALUES (?, ?, 1, ?, ?)',
        ch.id, req.user.company_id, dmKey, req.user.id);
    run('INSERT INTO chat_channel_members (id, channel_id, user_id) VALUES (?, ?, ?)', nanoid(), ch.id, req.user.id);
    run('INSERT INTO chat_channel_members (id, channel_id, user_id) VALUES (?, ?, ?)', nanoid(), ch.id, withUserId);
  }
  res.json({ data: { id: ch.id, name: userName(withUserId) }, error: null });
});

// ── paginated messages ──
router.get('/channels/:id/messages', auth.requireAuth, (req, res) => {
  const ch = q1('SELECT id, company_id FROM chat_channels WHERE id = ?', req.params.id);
  if (!ch.id || ch.company_id !== req.user.company_id) return res.status(404).json({ error: 'არხი ვერ მოიძებნა' });
  if (!db.prepare('SELECT 1 FROM chat_channel_members WHERE channel_id = ? AND user_id = ?').get(ch.id, req.user.id))
    return res.status(403).json({ error: 'თქვენ არ ხართ ამ არხის წევრი' });

  const limit = Math.max(1, Math.min(parseInt(req.query.limit, 10) || 50, 200));
  const before = req.query.before;
  let rows;
  if (before) {
    const anchor = q1('SELECT created_at FROM chat_messages WHERE id = ?', before);
    rows = qa('SELECT * FROM chat_messages WHERE channel_id = ? AND deleted_at IS NULL AND created_at < ? ORDER BY created_at DESC LIMIT ?', ch.id, anchor.created_at || '9999', limit);
  } else {
    rows = qa('SELECT * FROM chat_messages WHERE channel_id = ? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT ?', ch.id, limit);
  }
  const data = rows.reverse().map(m => enrichMessage(m));
  res.json({ data, error: null });
});

// ── attach-record picker: search a CRM table for the "link to record" feature ──
router.get('/ref-search', auth.requireAuth, (req, res) => {
  const type = (req.query.type || '').toUpperCase();
  const table = REF_TABLES[type];
  if (!table) return res.status(400).json({ error: 'invalid type' });
  const term = `%${(req.query.q || '').toString().trim()}%`;
  const cid = req.user.company_id;
  const canSeeAll = DATA_MGR_ROLES.has(req.user.role);

  let rows;
  if (type === 'DEAL') {
    const p = [cid, term, term];
    const ownClause = canSeeAll ? '1=1' : refOwnershipClause('DEAL', req.user.id, p);
    rows = qa(`SELECT id, title, deal_number, asking_price FROM deals WHERE company_id=? AND (title LIKE ? OR deal_number LIKE ?) AND ${ownClause} ORDER BY created_at DESC LIMIT 30`, ...p);
  } else {
    const p = [cid, term];
    const ownClause = canSeeAll ? '1=1' : refOwnershipClause('LISTING', req.user.id, p);
    rows = qa(`SELECT id, title, list_price FROM listings WHERE company_id=? AND title LIKE ? AND ${ownClause} ORDER BY created_at DESC LIMIT 30`, ...p);
  }
  res.json({ data: rows, error: null });
});

// ── send a message (REST is the single write path; WS only pushes/broadcasts) ──
router.post('/channels/:id/messages', auth.requireAuth, (req, res) => {
  const ch = q1('SELECT id, company_id FROM chat_channels WHERE id = ?', req.params.id);
  if (!ch.id || ch.company_id !== req.user.company_id) return res.status(404).json({ error: 'არხი ვერ მოიძებნა' });
  if (!db.prepare('SELECT 1 FROM chat_channel_members WHERE channel_id = ? AND user_id = ?').get(ch.id, req.user.id))
    return res.status(403).json({ error: 'თქვენ არ ხართ ამ არხის წევრი' });

  const content = ((req.body || {}).content || '').toString().trim();
  const attachmentUrl = (req.body || {}).attachmentUrl || null;
  const refTypeRaw = (req.body || {}).refType ? String(req.body.refType).toUpperCase() : null;
  const refId = (req.body || {}).refId || null;
  let refType = null, refLabel = null;
  if (refTypeRaw && refId) {
    if (!REF_TABLES[refTypeRaw]) return res.status(400).json({ error: 'ამ ტიპის ჩანაწერის მიბმა ჩატში აღარ შეიძლება' });
    // Confirm the record belongs to this company AND — for non-managers — that the
    // sender actually owns it. This is the real security boundary; the ref-search
    // picker only controls what's convenient to browse, not what's allowed to send.
    const canSeeAll = DATA_MGR_ROLES.has(req.user.role);
    const p = [refId, req.user.company_id];
    const ownClause = canSeeAll ? '1=1' : refOwnershipClause(refTypeRaw, req.user.id, p);
    const row = q1(`SELECT id FROM ${REF_TABLES[refTypeRaw]} WHERE id = ? AND company_id = ? AND ${ownClause}`, ...p);
    if (row.id) { refType = refTypeRaw; refLabel = (req.body.refLabel || '').toString().slice(0, 120) || null; }
    else return res.status(403).json({ error: 'ამ ჩანაწერის მიბმა არ შეგიძლიათ' });
  }
  if (!content && !attachmentUrl && !refType) return res.status(400).json({ error: 'ტექსტი აუცილებელია' });

  const id = nanoid();
  run('INSERT INTO chat_messages (id, channel_id, sender_id, content, attachment_url, reply_to_id, ref_type, ref_id, ref_label) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      id, ch.id, req.user.id, content || null, attachmentUrl, (req.body || {}).replyToId || null, refType, refType ? refId : null, refLabel);
  const msg = enrichMessage(q1('SELECT * FROM chat_messages WHERE id = ?', id));

  // Push to every other member's open sockets, if the WS layer is attached.
  try {
    if (global.__chatBroadcast) {
      const memberIds = qa('SELECT user_id FROM chat_channel_members WHERE channel_id = ?', ch.id).map(r => r.user_id);
      global.__chatBroadcast(memberIds, { type: 'message:new', channelId: ch.id, message: msg });
    }
  } catch (e) { console.error('[chat] realtime push failed:', e.message); }

  res.status(201).json({ data: msg, error: null });
});

// ── edit own message ──
router.patch('/channels/:id/messages/:msgId', auth.requireAuth, (req, res) => {
  const m = q1('SELECT id, channel_id, sender_id, deleted_at FROM chat_messages WHERE id = ?', req.params.msgId);
  if (!m.id || m.channel_id !== req.params.id) return res.status(404).json({ error: 'შეტყობინება ვერ მოიძებნა' });
  if (m.sender_id !== req.user.id) return res.status(403).json({ error: 'მხოლოდ საკუთარი შეტყობინების რედაქტირება შეგიძლია' });
  if (m.deleted_at) return res.status(400).json({ error: 'წაშლილი შეტყობინება ვერ დარედაქტირდება' });
  const content = ((req.body || {}).content || '').toString().trim();
  if (!content) return res.status(400).json({ error: 'ტექსტი აუცილებელია' });
  run('UPDATE chat_messages SET content = ?, edited_at = datetime(\'now\') WHERE id = ?', content, m.id);
  const msg = enrichMessage(q1('SELECT * FROM chat_messages WHERE id = ?', m.id));
  try {
    if (global.__chatBroadcast) {
      const memberIds = qa('SELECT user_id FROM chat_channel_members WHERE channel_id = ?', m.channel_id).map(r => r.user_id);
      global.__chatBroadcast(memberIds, { type: 'message:edited', channelId: m.channel_id, message: msg });
    }
  } catch (e) { console.error('[chat] realtime push failed:', e.message); }
  res.json({ data: msg, error: null });
});

// ── soft-delete own message ──
router.delete('/channels/:id/messages/:msgId', auth.requireAuth, (req, res) => {
  const m = q1('SELECT id, channel_id, sender_id FROM chat_messages WHERE id = ?', req.params.msgId);
  if (!m.id || m.channel_id !== req.params.id) return res.status(404).json({ error: 'შეტყობინება ვერ მოიძებნა' });
  if (m.sender_id !== req.user.id) return res.status(403).json({ error: 'მხოლოდ საკუთარი შეტყობინების წაშლა შეგიძლია' });
  run('UPDATE chat_messages SET deleted_at = datetime(\'now\'), content = NULL, attachment_url = NULL WHERE id = ?', m.id);
  try {
    if (global.__chatBroadcast) {
      const memberIds = qa('SELECT user_id FROM chat_channel_members WHERE channel_id = ?', m.channel_id).map(r => r.user_id);
      global.__chatBroadcast(memberIds, { type: 'message:deleted', channelId: m.channel_id, messageId: m.id });
    }
  } catch (e) { console.error('[chat] realtime push failed:', e.message); }
  res.json({ data: { ok: true }, error: null });
});

// ── toggle a reaction (add if new, remove if already reacted with this emoji) ──
router.post('/channels/:id/messages/:msgId/reactions', auth.requireAuth, (req, res) => {
  const m = q1('SELECT id, channel_id FROM chat_messages WHERE id = ?', req.params.msgId);
  if (!m.id || m.channel_id !== req.params.id) return res.status(404).json({ error: 'შეტყობინება ვერ მოიძებნა' });
  if (!db.prepare('SELECT 1 FROM chat_channel_members WHERE channel_id = ? AND user_id = ?').get(m.channel_id, req.user.id))
    return res.status(403).json({ error: 'თქვენ არ ხართ ამ არხის წევრი' });
  const emoji = ((req.body || {}).emoji || '').toString().slice(0, 8);
  if (!emoji) return res.status(400).json({ error: 'emoji required' });
  const existing = q1('SELECT id FROM chat_reactions WHERE message_id = ? AND user_id = ? AND emoji = ?', m.id, req.user.id, emoji);
  if (existing.id) run('DELETE FROM chat_reactions WHERE id = ?', existing.id);
  else run('INSERT INTO chat_reactions (id, message_id, user_id, emoji) VALUES (?, ?, ?, ?)', nanoid(), m.id, req.user.id, emoji);
  const reactions = qa('SELECT emoji, user_id FROM chat_reactions WHERE message_id = ?', m.id);
  try {
    if (global.__chatBroadcast) {
      const memberIds = qa('SELECT user_id FROM chat_channel_members WHERE channel_id = ?', m.channel_id).map(r => r.user_id);
      global.__chatBroadcast(memberIds, { type: 'reaction:changed', channelId: m.channel_id, messageId: m.id, reactions });
    }
  } catch (e) { console.error('[chat] realtime push failed:', e.message); }
  res.json({ data: { reactions }, error: null });
});

// ── mark read ──
router.post('/read', auth.requireAuth, (req, res) => {
  const { channelId, lastReadMessageId } = req.body || {};
  if (!channelId) return res.status(400).json({ error: 'channelId required' });
  run('UPDATE chat_channel_members SET last_read_message_id = ? WHERE channel_id = ? AND user_id = ?', lastReadMessageId || null, channelId, req.user.id);
  res.json({ data: { ok: true }, error: null });
});

// ── total unread across all channels (nav badge) ──
router.get('/unread', auth.requireAuth, (req, res) => {
  const uid = req.user.id, cid = req.user.company_id;
  ensureGeneralChannel(cid, uid);
  const rows = qa(`SELECT c.id, m.last_read_message_id FROM chat_channel_members m JOIN chat_channels c ON c.id = m.channel_id WHERE m.user_id = ? AND c.company_id = ?`, uid, cid);
  let total = 0;
  for (const c of rows) {
    total += c.last_read_message_id
      ? (q1('SELECT COUNT(*) n FROM chat_messages WHERE channel_id = ? AND deleted_at IS NULL AND created_at > (SELECT created_at FROM chat_messages WHERE id = ?)', c.id, c.last_read_message_id).n || 0)
      : (q1('SELECT COUNT(*) n FROM chat_messages WHERE channel_id = ? AND deleted_at IS NULL', c.id).n || 0);
  }
  res.json({ data: { unread: total }, error: null });
});

// ── teammates list, for starting a new DM or inviting to a channel ──
router.get('/teammates', auth.requireAuth, (req, res) => {
  const rows = qa('SELECT id, first_name, last_name, role, last_seen_at FROM users WHERE company_id = ? AND is_active = 1 AND id != ? ORDER BY first_name', req.user.company_id, req.user.id);
  res.json({ data: rows, error: null });
});

module.exports = router;
