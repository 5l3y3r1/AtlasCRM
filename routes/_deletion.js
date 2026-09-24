'use strict';
/* ─── Account and tenant deletion ─────────────────────────────────────────
 * Deleting has to actually delete.
 *
 * There used to be two separate implementations of "remove a user" — one for
 * the platform owner in admin.js, one for a company's own manager in team.js —
 * and they had already drifted apart. Both named a handful of tables by hand
 * and wrapped every statement in `catch (e) {}`, so a failure looked exactly
 * like a success: "Deleted" came back while the rows stayed put. The company
 * version was worse still — it left showings, contracts, invoices, meetings,
 * photos, chat history and company_integrations, which holds the tenant's
 * ad-platform access tokens.
 *
 * One implementation now, driven by the live schema, so a table added next
 * month is covered the day it exists. Every path runs in a transaction: it
 * either finishes or changes nothing.
 * ───────────────────────────────────────────────────────────────────────── */
const { db } = require('../db');

function liveTables() {
  return db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    .all().map(r => r.name);
}
function columnsOfLive(t) {
  return db.prepare(`PRAGMA table_info(${t})`).all().map(r => r.name);
}
function hasTable(t) {
  return db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t) != null;
}
function hasColumn(t, c) {
  return hasTable(t) && columnsOfLive(t).includes(c);
}

// SQLite caps how many values one statement may bind, so long id lists go in
// batches rather than as a single IN (...) that would fail on a big tenant.
function deleteWhereIn(table, col, ids) {
  let n = 0;
  for (let i = 0; i < ids.length; i += 400) {
    const chunk = ids.slice(i, i + 400);
    const ph = chunk.map(() => '?').join(',');
    n += db.prepare(`DELETE FROM ${table} WHERE ${col} IN (${ph})`).run(...chunk).changes;
  }
  return n;
}

// Rows that exist only because the user does — a membership, a reaction, a
// delivery record, a login. They go when the account goes.
const USER_OWNED_ROWS = [
  ['sessions', 'user_id'],
  ['auth_tokens', 'user_id'],
  ['notifications', 'user_id'],
  ['team_message_recipients', 'user_id'],
  ['chat_channel_members', 'user_id'],
  ['chat_reactions', 'user_id'],
];

// Work that belongs to a person and should land on a colleague when they
// leave. Authorship columns are deliberately absent — tasks.created_by,
// messages.sent_by, deal_documents.uploaded_by and friends record who did
// something, and rewriting them would falsify the history rather than hand
// over the work. Those are left to the schema's ON DELETE SET NULL.
const REASSIGNABLE = [
  ['clients', 'primary_agent_id'],
  ['listings', 'agent_id'],
  ['leads', 'agent_id'],
  ['deals', 'buyer_agent_id'],
  ['deals', 'seller_agent_id'],
  ['tasks', 'assigned_to'],
  ['showings', 'agent_id'],
  ['contracts', 'agent_id'],
  ['financial_transactions', 'agent_id'],
  ['commission_records', 'user_id'],
  ['marketing_campaigns', 'agent_id'],
  ['meetings', 'primary_agent_id'],
  ['meetings', 'secondary_agent_id'],
  ['teams', 'manager_id'],
];

// A personal saved search belongs to one person; handing it to a colleague
// would silently subscribe them to someone else's alerts. The alerts a search
// produced go with it — "this listing matches your saved search" means nothing
// once there is no you.
const PERSONAL_ROWS = [
  ['agent_hunting_profiles', 'agent_id'],
  ['property_alerts', 'agent_id'],
];

// Columns whose name says "a user" but which point somewhere else.
// deals.owner_id holds a LEAD id — the property owner — so blanking it on staff
// turnover would quietly detach deals from the people selling the property.
const NOT_USER_REFS = new Set(['deals.owner_id', 'users.auth_user_id']);
const USER_REF_NAME = /(agent_id|assigned_to|user_id|manager_id|sender_id|_by|_by_id)$/;

// Every column that points at a user with no declared foreign key behind it, so
// SQLite will not blank it for us and the row would be left pointing at someone
// who no longer exists.
//
// Read off the live schema rather than listed by hand. A hand list is what went
// wrong here before: the first version knew about six tables, and leads and
// listings both grew a created_by_id that nobody went back to add.
function undeclaredUserRefs() {
  const handled = [...USER_OWNED_ROWS, ...PERSONAL_ROWS, ...REASSIGNABLE]
    .map(([t, c]) => `${t}.${c}`);
  const out = [];
  for (const t of liveTables()) {
    if (t === 'users') continue;
    const declared = new Set(db.prepare(`PRAGMA foreign_key_list(${t})`).all()
      .filter(f => f.table === 'users').map(f => f.from));
    for (const c of columnsOfLive(t)) {
      if (!USER_REF_NAME.test(c) || declared.has(c)) continue;
      if (NOT_USER_REFS.has(`${t}.${c}`) || handled.includes(`${t}.${c}`)) continue;
      out.push([t, c]);
    }
  }
  return out;
}

// Run fn inside a transaction with foreign keys deferred, so the statements may
// run in any order as long as the set is complete — constraints are checked
// once, at COMMIT. Anything thrown rolls the whole thing back.
function inTransaction(fn) {
  db.exec('BEGIN');
  try {
    db.exec('PRAGMA defer_foreign_keys = ON');
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch { /* nothing open to roll back */ }
    throw e;
  }
}

/**
 * Remove a user account for good.
 * @param {string} userId
 * @param {{reassignTo?: string|null}} opts  where to send their open work;
 *        null or an unknown id leaves those records unassigned.
 * @returns {{removed: Object, reassigned: Object, reassignedTo: string|null}}
 * @throws if anything fails — nothing is written in that case.
 */
function hardDeleteUser(userId, opts = {}) {
  const newId = opts.reassignTo && opts.reassignTo !== userId ? opts.reassignTo : null;
  const removed = {};
  const reassigned = {};

  return inTransaction(() => {
    for (const [tb, col] of REASSIGNABLE) {
      if (!hasColumn(tb, col)) continue;
      const n = db.prepare(`UPDATE ${tb} SET ${col} = ? WHERE ${col} = ?`).run(newId, userId).changes;
      if (n) reassigned[`${tb}.${col}`] = n;
    }
    for (const [tb, col] of undeclaredUserRefs()) {
      if (!hasColumn(tb, col)) continue;
      db.prepare(`UPDATE ${tb} SET ${col} = NULL WHERE ${col} = ?`).run(userId);
    }
    // Counted before the deletes, not from `changes`: dropping a hunting
    // profile cascades into the alerts it produced, so by the time the loop
    // reaches property_alerts the engine has already taken them and the caller
    // would be told nothing was removed when hundreds of rows were.
    const doomed = [...PERSONAL_ROWS, ...USER_OWNED_ROWS].filter(([tb, col]) => hasColumn(tb, col));
    for (const [tb, col] of doomed) {
      const n = db.prepare(`SELECT COUNT(*) n FROM ${tb} WHERE ${col} = ?`).get(userId).n;
      if (n) removed[tb] = (removed[tb] || 0) + n;
    }
    for (const [tb, col] of doomed) db.prepare(`DELETE FROM ${tb} WHERE ${col} = ?`).run(userId);
    removed.users = db.prepare('DELETE FROM users WHERE id = ?').run(userId).changes;
    return { removed, reassigned, reassignedTo: newId };
  });
}

/** Deactivate an account and end its sessions. */
function deactivateUser(userId) {
  return inTransaction(() => {
    db.prepare('UPDATE users SET is_active = 0 WHERE id = ?').run(userId);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
    return { id: userId, deactivated: true };
  });
}

/**
 * Remove a company and everything belonging to it.
 * @returns {Object} table name → rows removed
 * @throws if anything fails — nothing is written in that case.
 */
function deleteCompany(cid) {
  const removed = {};
  const note = (table, n) => { if (n) removed[table] = (removed[table] || 0) + n; };
  const idsOf = (sql) => db.prepare(sql).all(cid).map(r => r.id);
  const dropChildren = (table, col, ids) => {
    if (!ids.length || !hasColumn(table, col)) return;
    note(table, deleteWhereIn(table, col, ids));
  };

  return inTransaction(() => {
    // Census first, deletes after. Removing users cascades into
    // agent_hunting_profiles and on into property_alerts, so counting as we go
    // would report zero rows for 300-odd real ones — the engine has already
    // taken them by the time the sweep arrives. The caller is being handed a
    // receipt for a destructive action; it should say what was actually there.
    const tenantTables = liveTables().filter(t => t !== 'companies' && columnsOfLive(t).includes('company_id'));
    for (const t of tenantTables) {
      note(t, db.prepare(`SELECT COUNT(*) n FROM ${t} WHERE company_id = ?`).get(cid).n);
    }

    const userIds = idsOf('SELECT id FROM users WHERE company_id = ?');
    const listingIds = idsOf('SELECT id FROM listings WHERE company_id = ?');
    const dealIds = idsOf('SELECT id FROM deals WHERE company_id = ?');
    const teamMsgIds = hasTable('team_messages') ? idsOf('SELECT id FROM team_messages WHERE company_id = ?') : [];
    const channelIds = hasTable('chat_channels') ? idsOf('SELECT id FROM chat_channels WHERE company_id = ?') : [];

    const chatMsgIds = [];
    if (channelIds.length && hasTable('chat_messages')) {
      for (let i = 0; i < channelIds.length; i += 400) {
        const chunk = channelIds.slice(i, i + 400);
        const ph = chunk.map(() => '?').join(',');
        chatMsgIds.push(...db.prepare(`SELECT id FROM chat_messages WHERE channel_id IN (${ph})`).all(...chunk).map(r => r.id));
      }
    }

    // Rows that hang off a tenant row rather than carrying company_id themselves.
    dropChildren('chat_reactions', 'message_id', chatMsgIds);
    dropChildren('chat_messages', 'channel_id', channelIds);
    dropChildren('chat_channel_members', 'channel_id', channelIds);
    dropChildren('property_images', 'listing_id', listingIds);
    dropChildren('deal_documents', 'deal_id', dealIds);
    dropChildren('team_message_recipients', 'message_id', teamMsgIds);
    for (const [tb, col] of USER_OWNED_ROWS) dropChildren(tb, col, userIds);

    // Everything the schema itself says belongs to a company.
    for (const t of tenantTables) db.prepare(`DELETE FROM ${t} WHERE company_id = ?`).run(cid);

    note('companies', db.prepare('DELETE FROM companies WHERE id = ?').run(cid).changes);
    return removed;
  });
}

module.exports = {
  hardDeleteUser,
  deactivateUser,
  deleteCompany,
  inTransaction,
  hasTable,
  hasColumn,
  liveTables,
  columnsOfLive,
  deleteWhereIn,
  REASSIGNABLE,
  USER_OWNED_ROWS,
  undeclaredUserRefs,
};
