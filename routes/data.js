'use strict';
/**
 * routes/data.js — Generic REST handler that talks the same query
 * dialect Supabase/PostgREST does. The frontend's existing Supabase
 * SDK calls translate into URLs of the form:
 *
 *   GET    /api/data/leads?status=eq.NEW&order=created_at.desc&limit=10
 *   GET    /api/data/listings?select=*,property_images(*)&id=eq.123
 *   POST   /api/data/leads                              { body }
 *   PATCH  /api/data/leads?id=eq.abc                    { body }
 *   DELETE /api/data/leads?id=eq.abc
 *
 * Supports:
 *   - Filters:    eq, neq, gt, gte, lt, lte, like, ilike, is, in
 *   - select:     '*', 'col1,col2', '*,fk_table(*)', '*,alias:fk_table!fk_name(col1,col2)'
 *   - order:      'col' | 'col.asc' | 'col.desc' | comma-separated
 *   - limit
 *   - count=exact + Prefer: count=exact header → Content-Range
 *   - head=true (skip body, only return count)
 *
 * Multi-tenancy: when the table has a `company_id` column, we automatically
 * scope to req.user.company_id unless the row being created provides one.
 */

const express = require('express');
const { nanoid } = require('nanoid');
const { db, TABLES, TENANT_TABLES, SENSITIVE_COLUMNS, SCHEMA_CACHE } = require('../db');
const { requireAuth } = require('../auth');
const billing = require('../billing');
const { notifyTaskAssigned, notifyTaskTakenAway, notifyTaskClosed, clearAlerts, TASK_ALERT_TYPES } = require('../notify');
const { fail, safeMessage } = require('./_errors');

const router = express.Router();

// Task statuses that count as finished. Mirrors TASK_STATUS in
// public/js/app/12-tasks.js; DONE/CANCELED are the pre-unification spellings
// still present in older rows.
const CLOSED_TASK_STATUSES = new Set(['COMPLETED', 'CANCELLED', 'DONE', 'CANCELED']);

/* ─────────────────────────────────────────────────────────────────────────
 * Parsing helpers
 * ───────────────────────────────────────────────────────────────────────── */

// Tokens like `eq.5`, `gte.100`, `in.(A,B,C)`, `is.null`, `not.is.null`, `not.in.(A,B)`
function parseFilter(raw) {
  if (typeof raw !== 'string') return null;
  // Handle `not.<op>.<val>` by recursing and flipping the operator
  if (raw.startsWith('not.')) {
    const inner = parseFilter(raw.slice(4));
    if (!inner) return null;
    return { ...inner, negate: true };
  }
  const dot = raw.indexOf('.');
  if (dot < 0) return null;
  const op = raw.slice(0, dot);
  let val = raw.slice(dot + 1);

  // Strip surrounding quotes that Supabase sometimes sends
  if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);

  // SQLite stores booleans as integers 1/0. The Supabase shim sends true/false,
  // so coerce them for equality/inequality filters (e.g. is_active=eq.true).
  let coerced = val;
  if (val === 'true') coerced = 1;
  else if (val === 'false') coerced = 0;

  const OPS = {
    eq:'=', neq:'!=', gt:'>', gte:'>=', lt:'<', lte:'<=',
    like:'LIKE', ilike:'LIKE',  // SQLite LIKE is case-insensitive by default for ASCII
  };
  if (op in OPS) return { op: OPS[op], val: (op === 'eq' || op === 'neq') ? coerced : val };
  if (op === 'is')  return { op: val === 'null' ? 'IS NULL' : 'IS NOT NULL', val: null };
  if (op === 'in') {
    // in.(a,b,c)
    let inner = val;
    if (inner.startsWith('(') && inner.endsWith(')')) inner = inner.slice(1, -1);
    return { op: 'IN', val: inner.split(',').map(s => s.replace(/^"|"$/g, '').trim()) };
  }
  return null;
}

// Parse Supabase-style select clause. Returns { columns: [...], embeds: [{alias,table,cols}] }
function parseSelect(raw) {
  if (!raw || raw === '*') return { columns: ['*'], embeds: [] };

  const out = { columns: [], embeds: [] };
  // Walk the string respecting parentheses depth
  let depth = 0, start = 0;
  const tokens = [];
  for (let i = 0; i <= raw.length; i++) {
    const c = raw[i];
    if (c === '(') depth++;
    else if (c === ')') depth--;
    else if ((c === ',' && depth === 0) || i === raw.length) {
      tokens.push(raw.slice(start, i).trim());
      start = i + 1;
    }
  }

  for (const token of tokens) {
    if (!token) continue;
    const parenIdx = token.indexOf('(');
    if (parenIdx > 0) {
      // It's an embed: "[alias:]table[!fkname](col1,col2,...)"
      const head = token.slice(0, parenIdx);
      const inner = token.slice(parenIdx + 1, token.lastIndexOf(')'));
      let alias = null, table = head, fk = null;
      if (head.includes(':')) { [alias, table] = head.split(':', 2); }
      if (table.includes('!')) { [table, fk] = table.split('!', 2); }
      const cols = inner.split(',').map(s => s.trim()).filter(Boolean);
      out.embeds.push({
        alias: alias || table,
        table: table.trim(),
        fk,
        columns: cols.length ? cols : ['*'],
      });
    } else {
      out.columns.push(token);
    }
  }
  if (!out.columns.length) out.columns = ['*'];
  return out;
}

function parseOrder(raw) {
  if (!raw) return [];
  return raw.split(',').map(s => {
    const [col, dir = 'asc'] = s.split('.');
    return { col: col.trim(), dir: dir.toLowerCase() === 'desc' ? 'DESC' : 'ASC' };
  });
}

/* ─────────────────────────────────────────────────────────────────────────
 * Query building
 * ───────────────────────────────────────────────────────────────────────── */

// Parse a PostgREST OR group: "(col.op.val,col2.op2.val2)" → SQL "col LIKE ? OR col2 LIKE ?"
function parseOrGroup(raw, cols) {
  if (typeof raw !== 'string') return null;
  let inner = raw.trim();
  if (inner.startsWith('(') && inner.endsWith(')')) inner = inner.slice(1, -1);
  // Split on commas that are not inside parentheses (e.g. in.(a,b))
  const parts = [];
  let depth = 0, start = 0;
  for (let i = 0; i <= inner.length; i++) {
    const c = inner[i];
    if (c === '(') depth++;
    else if (c === ')') depth--;
    else if ((c === ',' && depth === 0) || i === inner.length) {
      parts.push(inner.slice(start, i).trim());
      start = i + 1;
    }
  }
  const sub = [];
  const params = [];
  for (const part of parts) {
    if (!part) continue;
    const dot = part.indexOf('.');
    if (dot < 0) continue;
    const col = part.slice(0, dot);
    if (!cols.includes(col)) continue;
    const f = parseFilter(part.slice(dot + 1));
    if (!f) continue;
    if (f.op === 'IS NULL' || f.op === 'IS NOT NULL') {
      sub.push(`${col} ${f.op}`);
    } else if (f.op === 'IN') {
      sub.push(`${col} IN (${f.val.map(() => '?').join(',')})`);
      params.push(...f.val);
    } else {
      sub.push(`${col} ${f.op} ?`);
      params.push(f.val);
    }
  }
  if (!sub.length) return null;
  return { sql: sub.join(' OR '), params };
}

function buildWhere(table, query, user) {
  const cols = SCHEMA_CACHE[table];
  const conds = [];
  const params = [];

  for (const [key, raw] of Object.entries(query)) {
    if (['select','order','limit','offset','count','head'].includes(key)) continue;
    // PostgREST OR group:  or=(title.ilike.%x%,district.ilike.%x%)
    if (key === 'or') {
      const orClause = parseOrGroup(raw, cols);
      if (orClause) { conds.push(`(${orClause.sql})`); params.push(...orClause.params); }
      continue;
    }
    if (!cols.includes(key)) continue;
    // A range puts two conditions on one column (?due_at=gte.X&due_at=lt.Y), and
    // Express hands those over as an ARRAY. parseFilter only accepts strings, so
    // the whole filter used to be dropped — and dropping a filter fails OPEN,
    // returning every row instead of the requested window. Apply each in turn,
    // ANDed together.
    for (const one of (Array.isArray(raw) ? raw : [raw])) {
      const f = parseFilter(one);
      if (!f) continue;
      if (f.op === 'IN') {
        const placeholders = f.val.map(()=>'?').join(',');
        conds.push(`${key} ${f.negate ? 'NOT IN' : 'IN'} (${placeholders})`);
        params.push(...f.val);
      } else if (f.op === 'IS NULL' || f.op === 'IS NOT NULL') {
        // Flip if negated
        const operator = f.negate
          ? (f.op === 'IS NULL' ? 'IS NOT NULL' : 'IS NULL')
          : f.op;
        conds.push(`${key} ${operator}`);
      } else {
        // For comparison ops, NOT-wrap the whole condition
        if (f.negate) {
          conds.push(`NOT (${key} ${f.op} ?)`);
        } else {
          conds.push(`${key} ${f.op} ?`);
        }
        params.push(f.val);
      }
    }
  }

  // Auto-tenant scoping. This is a hard boundary, not a default the caller can
  // opt out of: a client-supplied company_id filter is ANDed with ours (added
  // in the loop above), it never replaces it. Previously, passing any
  // `company_id=eq.…` skipped this block entirely, which let any logged-in user
  // read, edit and delete every other company's rows.
  //
  // Super-admins are scoped exactly like everyone else here. This layer serves
  // the CRM app, where a platform owner is simply a member of their own agency
  // — an earlier version exempted them, which meant every list in the product
  // (users, teams, leads, listings, deals) silently showed other companies'
  // rows to whoever held the flag. Cross-company work belongs to /api/admin,
  // which has its own deliberately unscoped queries behind requireSuperAdmin.
  if (TENANT_TABLES.has(table) && user) {
    if (table === 'companies') {
      // A tenant may only ever reach its own company row.
      conds.push('id = ?');
      params.push(user.company_id || '');
    } else if (cols.includes('company_id')) {
      if (user.company_id) {
        conds.push('company_id = ?');
        params.push(user.company_id);
      } else {
        // No company => no tenant rows at all, rather than the whole table.
        conds.push('1 = 0');
      }
    }
  }

  // Agent visibility scoping: regular agents only see records they created
  // OR that are assigned to them. Managers/owners/founders see everything.
  // NOTE: 'listings' is intentionally NOT here — all company members can SEE
  // all listings (write access is gated separately in PATCH/DELETE below).
  const MANAGER_ROLES = new Set(['MANAGER', 'OWNER', 'FOUNDER', 'ADMIN']);
  // Per-table ownership columns. A non-manager sees only rows where one of these
  // columns equals their user id. Enforced here so it applies to list, single-id
  // GET, search, filters, exports, AND (since PATCH/DELETE reuse this WHERE) writes.
  const AGENT_OWN_COLS = {
    leads:                  ['agent_id', 'created_by_id'],
    clients:                ['primary_agent_id', 'agent_id', 'created_by_id'],
    deals:                  ['buyer_agent_id', 'seller_agent_id', 'created_by_id'],
    agent_hunting_profiles: ['user_id', 'agent_id', 'created_by_id'],
    property_alerts:        ['user_id', 'agent_id', 'created_by_id'],
  };
  if (AGENT_OWN_COLS[table] && user && user.role && !MANAGER_ROLES.has(user.role)) {
    const ors = [];
    for (const col of AGENT_OWN_COLS[table]) {
      if (cols.includes(col)) { ors.push(`${col} = ?`); params.push(user.id); }
    }
    // If none of the ownership columns exist we intentionally add an always-false
    // condition rather than leak the whole table.
    conds.push(ors.length ? '(' + ors.join(' OR ') + ')' : '1 = 0');
  }
  // Listings are readable by all company members (the properties page has a
  // My/Agency toggle). EDIT/DELETE of others' listings is blocked below.

  // Spreadsheets: managers/owners/founders see ALL spreadsheets in the company
  // (company_id filter already applied above). Regular agents/brokers only see
  // the spreadsheets they personally created.
  if (table === 'spreadsheets' && user && cols.includes('created_by') && !MANAGER_ROLES.has(user.role)) {
    conds.push('created_by = ?');
    params.push(user.id);
  }

  return { sql: conds.length ? 'WHERE ' + conds.join(' AND ') : '', params };
}

function stripSensitive(table, rows) {
  const drop = SENSITIVE_COLUMNS[table];
  if (!drop || !rows) return rows;
  if (Array.isArray(rows)) {
    return rows.map(r => { const o = {...r}; for (const c of drop) delete o[c]; return o; });
  }
  const o = {...rows}; for (const c of drop) delete o[c]; return o;
}

// Auto-parse JSON-shaped strings ("[…]" / "{…}") so the frontend sees
// real arrays / objects (Supabase's PostgREST does the same thing).
function parseJsonColumns(rows) {
  if (!rows) return rows;
  const arr = Array.isArray(rows) ? rows : [rows];
  for (const row of arr) {
    if (!row || typeof row !== 'object') continue;
    for (const [k, v] of Object.entries(row)) {
      if (typeof v !== 'string') continue;
      const s = v.trim();
      if (!(s.startsWith('[') || s.startsWith('{'))) continue;
      try { row[k] = JSON.parse(s); } catch { /* leave as string */ }
    }
  }
  return rows;
}

// Hydrate embeds — for every parent row, run a follow-up SELECT against the
// related table. This is sufficient for the queries the frontend issues
// (small result sets, single-level joins).
// Work out which column joins a parent row to an embedded table. Both the
// projection builder and the hydrator need the same answer, so it lives in one
// place: the hydrator reads parent[fk], and if the SELECT never projected that
// column there is nothing to join on and the embed quietly resolves to null.
//
//   property_images(*)            — child stores {parent_singular}_id
//   companies(*)                  — parent stores company_id
//   client:clients(...)           — parent stores client_id
//   agent:users!fk_name(...)      — explicit fk hint names the column outright
function resolveEmbedJoin(table, embed) {
  if (!TABLES.includes(embed.table) && embed.table !== 'companies') return null;
  const parentCols = SCHEMA_CACHE[table];
  const embedCols = SCHEMA_CACHE[embed.table];
  if (!parentCols || !embedCols) return null;

  // An explicit hint (`users!tasks_assigned_to_fkey`) names the joining column
  // outright. It was being parsed and then ignored, so any relation whose
  // column doesn't happen to match `<alias>_id` or `<table>_id` silently
  // resolved to [] — which is why every task showed "—" for its assignee
  // (`assigned_to` matches neither `assigned_id` nor `user_id`).
  const hinted = [];
  if (embed.fk) {
    const m = String(embed.fk).match(/^(?:(.+?)_)?(.+?)_fkey$/);
    // "tasks_assigned_to_fkey" -> "assigned_to"; also accept a bare column name.
    if (m && m[2]) hinted.push(m[2]);
    hinted.push(embed.fk);
  }

  const parentFk = [
    ...hinted,
    `${singularize(embed.alias)}_id`,
    `${singularize(embed.table)}_id`,
  ].find(c => parentCols.includes(c));
  if (parentFk) return { kind: 'parent', fk: parentFk, needs: parentFk };

  const childFk = `${singularize(table)}_id`;
  if (embedCols.includes(childFk)) return { kind: 'child', fk: childFk, needs: 'id' };

  return null;
}

function hydrateEmbeds(table, parents, embeds, user) {
  if (!embeds.length || !parents.length) return parents;

  for (const embed of embeds) {
    const join = resolveEmbedJoin(table, embed);
    if (!join) {
      // Cannot infer — return an empty array so the UI doesn't blow up
      for (const p of parents) p[embed.alias] = Array.isArray(p[embed.alias]) ? p[embed.alias] : [];
      continue;
    }

    // These column names are interpolated straight into the child SELECT.
    // Top-level select columns have always been filtered against the schema,
    // but embed columns were not — so whatever the caller typed reached the
    // SQL parser with nothing but the quoting standing in the way.
    const embedCols = SCHEMA_CACHE[embed.table];
    const asked = embed.columns.includes('*') ? [] : embed.columns.filter(c => embedCols.includes(c));
    const colList = asked.length ? asked.map(c => `"${c}"`).join(',') : '*';

    if (join.kind === 'parent') {
      const stmt = db.prepare(`SELECT ${colList} FROM ${embed.table} WHERE id = ?`);
      for (const p of parents) {
        const id = p[join.fk];
        if (!id) { p[embed.alias] = null; continue; }
        const row = stmt.get(id);
        p[embed.alias] = parseJsonColumns(stripSensitive(embed.table, row || null));
      }
    } else {
      const stmt = db.prepare(`SELECT ${colList} FROM ${embed.table} WHERE ${join.fk} = ?`);
      for (const p of parents) {
        const rows = stmt.all(p.id);
        p[embed.alias] = parseJsonColumns(stripSensitive(embed.table, rows));
      }
    }
  }
  return parents;
}

function singularize(s) {
  if (!s) return s;
  if (s.endsWith('ies')) return s.slice(0, -3) + 'y';
  if (s.endsWith('s'))   return s.slice(0, -1);
  return s;
}

/* ─────────────────────────────────────────────────────────────────────────
 * Routes
 * ───────────────────────────────────────────────────────────────────────── */

router.use(requireAuth);

// Mount validation: only known tables may be reached
function tableGuard(req, res, next) {
  const t = req.params.table;
  if (!TABLES.includes(t)) {
    return res.status(404).json({ error: `Unknown table: ${t}` });
  }
  req.table = t;
  next();
}

// SELECT
router.get('/:table', tableGuard, (req, res) => {
  const t = req.table;
  const sel = parseSelect(req.query.select);
  const where = buildWhere(t, req.query, req.user);
  const order = parseOrder(req.query.order);
  const limit = req.query.limit ? Math.max(1, Math.min(parseInt(req.query.limit, 10) || 100, 1000)) : null;
  const offset = req.query.offset ? Math.max(0, parseInt(req.query.offset, 10) || 0) : 0;
  const wantCount = req.query.count === 'exact' || req.headers.prefer === 'count=exact';
  const headOnly = req.query.head === 'true';

  // Build column list (top-level cols only, embeds handled later)
  const cols = SCHEMA_CACHE[t];
  let projection = '*';
  // Columns fetched only so the embeds can be resolved; stripped before reply.
  const joinCols = [];
  if (sel.columns && sel.columns[0] !== '*') {
    const asked = sel.columns.filter(c => cols.includes(c));
    // An embed joins on a column of THIS row. A narrow select that happens to
    // omit that column left the hydrator nothing to match on, so the embed came
    // back null: `select=*,agent:users!fk(name)` worked while
    // `select=id,agent:users!fk(name)` returned no agent at all. Fetch the join
    // columns behind the scenes and strip them again afterwards.
    for (const embed of sel.embeds) {
      const join = resolveEmbedJoin(t, embed);
      if (!join || !cols.includes(join.needs)) continue;
      if (!asked.includes(join.needs) && !joinCols.includes(join.needs)) joinCols.push(join.needs);
    }
    projection = [...asked, ...joinCols].map(c => `"${c}"`).join(',') || '*';
  }

  let count = null;
  if (wantCount) {
    count = db.prepare(`SELECT COUNT(*) AS n FROM ${t} ${where.sql}`).get(...where.params).n;
    res.setHeader('Content-Range', `0-${Math.max(count-1,0)}/${count}`);
  }
  if (headOnly) return res.json({ data: null, count });

  let sql = `SELECT ${projection} FROM ${t} ${where.sql}`;
  if (order.length) {
    const safeOrder = order
      .filter(o => cols.includes(o.col))
      .map(o => `"${o.col}" ${o.dir}`)
      .join(',');
    if (safeOrder) sql += ` ORDER BY ${safeOrder}`;
  }
  if (limit !== null) sql += ` LIMIT ${limit} OFFSET ${offset}`;

  let rows = db.prepare(sql).all(...where.params);
  rows = stripSensitive(t, rows);
  rows = parseJsonColumns(rows);
  rows = hydrateEmbeds(t, rows, sel.embeds, req.user);
  if (joinCols.length) for (const r of rows) for (const c of joinCols) delete r[c];

  res.json({ data: rows, count });
});

// INSERT
router.post('/:table', tableGuard, express.json({limit:'5mb'}), (req, res) => {
  const t = req.table;
  let bodies = Array.isArray(req.body) ? req.body : [req.body];
  const cols = SCHEMA_CACHE[t];

  // Plan limit on listings. Checked once for the whole request rather than per
  // row, so a bulk import that would blow past the limit is refused up front
  // instead of writing half of it.
  if (t === 'listings' && req.user?.company_id) {
    const cap = billing.checkLimit(req.user.company_id, 'listings');
    if (!cap.ok) return res.status(402).json({ error: cap.error, limit: cap.limit, used: cap.used });
  }

  const tableGate = requireManagerForTable(t, req.user);
  if (tableGate) return res.status(403).json({ error: tableGate });

  const inserted = [];
  for (const body of bodies) {
    const guard = rejectProtectedColumns(t, body, req.user);
    if (guard) return res.status(403).json({ error: guard });

    const row = { ...body };
    if (cols.includes('id') && !row.id) row.id = nanoid();
    // company_id is stamped from the session, never taken from the body — it is
    // in IMMUTABLE_COLUMNS for users, and overwritten here for every other
    // tenant table so a row can't be planted in someone else's company.
    if (cols.includes('company_id') && TENANT_TABLES.has(t) && t !== 'companies') {
      row.company_id = req.user.company_id;
    }
    // Spreadsheets: always stamp the creator server-side (never trust client) so
    // they stay private to the user who made them.
    if (t === 'spreadsheets' && cols.includes('created_by')) {
      row.created_by = req.user.id;
    }
    // Tasks: who raised it is stamped here rather than taken from the body. The
    // frontend happened to send created_by, so anything that didn't — an
    // integration, a direct API call — produced a task nobody owned, and the
    // completion alert had no one to notify.
    if (t === 'tasks') {
      if (cols.includes('created_by')) row.created_by = req.user.id;
      const assignGate = checkTaskAssignment(t, row, req.user);
      if (assignGate) return res.status(403).json({ error: assignGate });
      // An agent creating their own task need not say so explicitly.
      if (cols.includes('assigned_to') && !row.assigned_to) row.assigned_to = req.user.id;
    }
    // Auto-generate deal_number for new deals (D-0001 per company)
    if (t === 'deals' && !row.deal_number) {
      const companyId = row.company_id || req.user.company_id;
      const lastRow = db.prepare(
        `SELECT deal_number FROM deals WHERE company_id = ? AND deal_number IS NOT NULL ORDER BY rowid DESC LIMIT 1`
      ).get(companyId);
      let nextNum = 1;
      if (lastRow?.deal_number) {
        const match = lastRow.deal_number.match(/(\d+)$/);
        if (match) nextNum = parseInt(match[1], 10) + 1;
      }
      row.deal_number = 'D-' + String(nextNum).padStart(4, '0');
    }
    // Auto-generate contract_number for new contracts (CNT-2026-00001 per company)
    if (t === 'contracts' && !row.contract_number) {
      const companyId = row.company_id || req.user.company_id;
      const year = new Date().getFullYear();
      const lastRow = db.prepare(
        `SELECT contract_number FROM contracts WHERE company_id = ? AND contract_number LIKE ? ORDER BY rowid DESC LIMIT 1`
      ).get(companyId, `CNT-${year}-%`);
      let nextNum = 1;
      if (lastRow?.contract_number) {
        const match = lastRow.contract_number.match(/(\d+)$/);
        if (match) nextNum = parseInt(match[1], 10) + 1;
      }
      row.contract_number = `CNT-${year}-` + String(nextNum).padStart(5, '0');
    }
    // Auto-generate listing_number for new listings (L-0001 per company)
    if (t === 'listings' && !row.listing_number) {
      const companyId = row.company_id || req.user.company_id;
      const lastRow = db.prepare(
        `SELECT listing_number FROM listings WHERE company_id = ? AND listing_number IS NOT NULL ORDER BY rowid DESC LIMIT 1`
      ).get(companyId);
      let nextNum = 1;
      if (lastRow?.listing_number) {
        const match = lastRow.listing_number.match(/(\d+)$/);
        if (match) nextNum = parseInt(match[1], 10) + 1;
      }
      row.listing_number = 'L-' + String(nextNum).padStart(4, '0');
    }
    // Auto-generate lead_number for new leads (LD-0001 per company).
    // Without this, leads were saved with a NULL lead_number and the UI showed "—".
    if (t === 'leads' && !row.lead_number) {
      const companyId = row.company_id || req.user.company_id;
      const lastRow = db.prepare(
        `SELECT lead_number FROM leads WHERE company_id = ? AND lead_number IS NOT NULL ORDER BY rowid DESC LIMIT 1`
      ).get(companyId);
      let nextNum = 1;
      if (lastRow?.lead_number) {
        const match = lastRow.lead_number.match(/(\d+)$/);
        if (match) nextNum = parseInt(match[1], 10) + 1;
      }
      row.lead_number = 'LD-' + String(nextNum).padStart(4, '0');
    }
    // Auto-generate client_number for new clients (C-0001 per company).
    if (t === 'clients' && !row.client_number) {
      const companyId = row.company_id || req.user.company_id;
      const lastRow = db.prepare(
        `SELECT client_number FROM clients WHERE company_id = ? AND client_number IS NOT NULL ORDER BY rowid DESC LIMIT 1`
      ).get(companyId);
      let nextNum = 1;
      if (lastRow?.client_number) {
        const match = lastRow.client_number.match(/(\d+)$/);
        if (match) nextNum = parseInt(match[1], 10) + 1;
      }
      row.client_number = 'C-' + String(nextNum).padStart(4, '0');
    }
    // Track who created the record (for agent visibility scoping).
    if (cols.includes('created_by_id') && !row.created_by_id && req.user) {
      row.created_by_id = req.user.id;
    }
    // Strip unknown columns
    const valid = Object.keys(row).filter(k => cols.includes(k));
    if (!valid.length) {
      return res.status(400).json({ error: 'No valid columns provided', table: t });
    }
    const placeholders = valid.map(()=>'?').join(',');
    const colList = valid.map(c => `"${c}"`).join(',');
    const params = valid.map(k => normalizeValue(row[k]));
    // role_permissions has a UNIQUE(company_id, role, resource) constraint.
    // Use INSERT OR REPLACE so re-saving permissions never fails on duplicates
    // (the frontend deletes-then-inserts, but this guarantees correctness even
    // if a stale row survives).
    const verb = (t === 'role_permissions') ? 'INSERT OR REPLACE INTO' : 'INSERT INTO';
    try {
      db.prepare(`${verb} ${t} (${colList}) VALUES (${placeholders})`).run(...params);
    } catch (e) {
      return fail(res, e, { status: 400, context: 'data:POST /:table' });
    }
    // Notify the assignee via a Chat DM when a task is created for someone else.
    // Direct DB write (not the manager-gated inbox/chat compose flow) since this
    // is an automatic system notification, not a user-composed message.
    if (t === 'tasks' && row.assigned_to && row.assigned_to !== req.user.id) {
      // Two channels on purpose: the chat DM is conversational, the
      // notification is the durable record the Tasks badge counts.
      notifyTaskAssigned(row, req.user.id);
      try {
        const assignerName = (() => {
          const u = db.prepare('SELECT first_name, last_name FROM users WHERE id = ?').get(req.user.id);
          return u ? `${u.first_name || ''} ${u.last_name || ''}`.trim() : '';
        })();
        const dueTxt = row.due_at ? ` (ვადა: ${String(row.due_at).slice(0, 10)})` : '';
        const companyId = row.company_id || req.user.company_id;

        // Find-or-create the DM channel between the assigner and the assignee.
        const dmKey = [req.user.id, row.assigned_to].sort().join(':');
        let ch = db.prepare('SELECT id FROM chat_channels WHERE company_id = ? AND dm_key = ?').get(companyId, dmKey);
        if (!ch) {
          const chId = nanoid();
          db.prepare('INSERT INTO chat_channels (id, company_id, is_dm, dm_key, created_by) VALUES (?, ?, 1, ?, ?)').run(chId, companyId, dmKey, req.user.id);
          db.prepare('INSERT INTO chat_channel_members (id, channel_id, user_id) VALUES (?, ?, ?)').run(nanoid(), chId, req.user.id);
          db.prepare('INSERT INTO chat_channel_members (id, channel_id, user_id) VALUES (?, ?, ?)').run(nanoid(), chId, row.assigned_to);
          ch = { id: chId };
        }
        const msgId = nanoid();
        const body = `📋 ${assignerName ? assignerName + '-მ ' : ''}დაგინიშნა ახალი დავალება: "${row.title || ''}"${dueTxt}`;
        db.prepare('INSERT INTO chat_messages (id, channel_id, sender_id, content) VALUES (?, ?, ?, ?)').run(msgId, ch.id, req.user.id, body);

        if (global.__chatBroadcast) {
          const memberIds = db.prepare('SELECT user_id FROM chat_channel_members WHERE channel_id = ?').all(ch.id).map(r => r.user_id);
          const msg = db.prepare('SELECT * FROM chat_messages WHERE id = ?').get(msgId);
          global.__chatBroadcast(memberIds, { type: 'message:new', channelId: ch.id, message: { ...msg, sender_name: assignerName, reactions: [], reply_preview: null } });
        }
      } catch (e) { console.error('[tasks] chat notify failed:', e.message); }
    }
    if (row.id) {
      const back = db.prepare(`SELECT * FROM ${t} WHERE id = ?`).get(row.id);
      inserted.push(parseJsonColumns(stripSensitive(t, back)));
    }
  }
  res.status(201).json({ data: Array.isArray(req.body) ? inserted : (inserted[0] || null) });
});

// UPDATE
router.patch('/:table', tableGuard, express.json({limit:'5mb'}), (req, res) => {
  const t = req.table;
  const where = buildWhere(t, req.query, req.user);
  if (!where.sql) return res.status(400).json({ error: 'Refusing UPDATE without filter' });
  const cols = SCHEMA_CACHE[t];
  const body = req.body || {};
  const guard = rejectProtectedColumns(t, body, req.user);
  if (guard) return res.status(403).json({ error: guard });
  const tableGate = requireManagerForTable(t, req.user);
  if (tableGate) return res.status(403).json({ error: tableGate });
  const setCols = Object.keys(body).filter(k => cols.includes(k) && k !== 'id');
  if (!setCols.length) return res.status(400).json({ error: 'No valid columns to update' });

  // The company record is agency-wide identity — name, logo, contact details.
  // Tenant scoping already limits this to the caller's own company, but every
  // member of it could otherwise rebrand the agency.
  if (t === 'companies' && !(req.user && WRITE_MANAGER_ROLES.has(req.user.role))) {
    return res.status(403).json({ error: 'Only managers may change company details' });
  }

  // Tasks: capture the rows as they stand before the write. Every task alert is
  // a comparison — assigned to someone new, taken off someone, closed out — so
  // only a genuine change notifies, not every unrelated edit to the row.
  let tasksBefore = null;
  if (t === 'tasks') {
    tasksBefore = db.prepare(
      `SELECT id, title, due_at, assigned_to, created_by, status FROM tasks ${where.sql}`
    ).all(...where.params);

    const perm = canWriteTasks(req.user, t, tasksBefore.map(r => r.id));
    if (!perm.ok) return res.status(perm.status).json({ error: perm.error });

    for (const before of tasksBefore) {
      const assignGate = checkTaskAssignment(t, body, req.user, { current: before });
      if (assignGate) return res.status(403).json({ error: assignGate });
    }
  }

  // users: an agent may edit only their own profile; managers edit anyone in
  // the company (the tenant scope in buildWhere already bounds that to us).
  if (t === 'users') {
    const targets = db.prepare(`SELECT id FROM users ${where.sql}`).all(...where.params);
    const perm = canWriteUsers(req.user, t, targets.map(r => r.id));
    if (!perm.ok) return res.status(perm.status).json({ error: perm.error });
  }

  // For listings: enforce write permission, and reassignment = managers only.
  if (t === 'listings') {
    const targets = db.prepare(`SELECT id, agent_id, created_by_id FROM listings ${where.sql}`).all(...where.params);
    const ids = targets.map(r => r.id);
    const isManager = req.user && WRITE_MANAGER_ROLES.has(req.user.role);
    // Reassignment: changing agent_id is manager-only.
    if (!isManager && setCols.includes('agent_id')) {
      const changing = targets.some(r => String(r.agent_id || '') !== String(body.agent_id || ''));
      if (changing) return res.status(403).json({ error: 'Only managers can reassign listings' });
    }
    const perm = canWriteListings(req.user, t, ids);
    if (!perm.ok) return res.status(perm.status).json({ error: perm.error });
  }

  const setSql = setCols.map(c => `"${c}" = ?`).join(',');
  const setParams = setCols.map(c => normalizeValue(body[c]));
  // Auto-bump updated_at for tables that have it
  const extraSet = (SCHEMA_CACHE[t].includes('updated_at') && !setCols.includes('updated_at'))
    ? `, "updated_at" = datetime('now')` : '';
  try {
    db.prepare(`UPDATE ${t} SET ${setSql}${extraSet} ${where.sql}`).run(...setParams, ...where.params);
  } catch (e) {
    return fail(res, e, { status: 400, context: 'data:PATCH /:table' });
  }
  const rows = db.prepare(`SELECT * FROM ${t} ${where.sql}`).all(...where.params);

  if (tasksBefore) {
    for (const before of tasksBefore) {
      const after = rows.find(r => r.id === before.id);
      if (!after) continue;

      // Handed to someone new: tell the person picking it up, and the person it
      // left — their queue changed under them either way.
      if (after.assigned_to !== before.assigned_to) {
        notifyTaskAssigned(after, req.user.id);
        notifyTaskTakenAway(after, before.assigned_to, req.user.id);
        // The new holder has not missed this deadline, whatever the last one did.
        clearAlerts(after.id, ['TASK_DUE', 'TASK_OVERDUE']);
      }

      // Closed out: the half of the loop that was missing. Whoever asked for the
      // work had no way to learn it was finished short of re-reading the list.
      const closedNow = CLOSED_TASK_STATUSES.has(after.status) && !CLOSED_TASK_STATUSES.has(before.status);
      if (closedNow) notifyTaskClosed({ ...after, created_by: before.created_by }, req.user.id, after.status);

      // A deadline that moves is a new deadline: drop the alerts raised against
      // the old one so a second missed date is reported as its own miss. Same on
      // reopening — a task that goes back to open can go late again.
      const dueMoved = String(before.due_at || '') !== String(after.due_at || '');
      const reopened = CLOSED_TASK_STATUSES.has(before.status) && !CLOSED_TASK_STATUSES.has(after.status);
      if (dueMoved || reopened) clearAlerts(after.id, ['TASK_DUE', 'TASK_OVERDUE']);
    }
  }

  res.json({ data: parseJsonColumns(stripSensitive(t, rows)) });
});

// BULK DELETE — accepts a JSON body { ids: [...] } instead of putting every id in
// the URL. The old approach (DELETE ...?id=in.(id1,id2,...)) breaks once the id
// list gets long: the request line/query string blows past URL and HTTP header
// size limits (browsers, Node, and any reverse proxy in front of it), so with a
// few thousand ids the request gets truncated and only the ids that fit before
// the cutoff actually get deleted — exactly the "only some got deleted" bug.
// Sending ids in the POST body has no such practical limit, and we still batch
// server-side to keep each individual SQL statement's bound-parameter count
// small and safe regardless of how many ids are requested.
router.post('/:table/bulk-delete', tableGuard, express.json({ limit: '10mb' }), (req, res) => {
  const t = req.table;
  const idsRaw = Array.isArray(req.body?.ids) ? req.body.ids : [];
  const ids = [...new Set(idsRaw.map(String).filter(Boolean))];
  if (!ids.length) return res.status(400).json({ error: 'ids array required' });

  // Tenant + agent-ownership scoping (same rules as every other read/write),
  // computed once — the per-chunk id filter is ANDed on top of this.
  const base = buildWhere(t, {}, req.user);

  const CHUNK = 400; // safely under SQLite's bound-parameter ceiling
  let deleted = 0;
  const errors = [];
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    const placeholders = chunk.map(() => '?').join(',');
    const sql = base.sql
      ? `${base.sql} AND id IN (${placeholders})`
      : `WHERE id IN (${placeholders})`;
    const params = [...base.params, ...chunk];
    try {
      const before = db.prepare(`SELECT id FROM ${t} ${sql}`).all(...params);
      if (t === 'listings') {
        const perm = canWriteListings(req.user, t, before.map(r => r.id));
        if (!perm.ok) { errors.push(perm.error); continue; } // skip, don't abort the whole batch
      }
      if (t === 'users') {
        const perm = canWriteUsers(req.user, t, before.map(r => r.id), { isDelete: true });
        if (!perm.ok) { errors.push(perm.error); continue; }
      }
      if (t === 'tasks') {
        const perm = canWriteTasks(req.user, t, before.map(r => r.id), { isDelete: true });
        if (!perm.ok) { errors.push(perm.error); continue; }
      }
      const info = db.prepare(`DELETE FROM ${t} ${sql}`).run(...params);
      deleted += info.changes;
    } catch (e) {
      errors.push(safeMessage(e, 'Could not delete this record.'));
    }
  }
  res.json({ data: { deleted, requested: ids.length }, error: errors.length ? errors[0] : null });
});

// DELETE
router.delete('/:table', tableGuard, (req, res) => {
  const t = req.table;
  const where = buildWhere(t, req.query, req.user);
  if (!where.sql) return res.status(400).json({ error: 'Refusing DELETE without filter' });
  const tableGate = requireManagerForTable(t, req.user);
  if (tableGate) return res.status(403).json({ error: tableGate });
  const before = db.prepare(`SELECT * FROM ${t} ${where.sql}`).all(...where.params);
  // Listings: non-managers can only delete their own/assigned.
  if (t === 'listings') {
    const perm = canWriteListings(req.user, t, before.map(r => r.id));
    if (!perm.ok) return res.status(perm.status).json({ error: perm.error });
  }
  if (t === 'users') {
    const perm = canWriteUsers(req.user, t, before.map(r => r.id), { isDelete: true });
    if (!perm.ok) return res.status(perm.status).json({ error: perm.error });
  }
  // Tasks: an agent may bin work they raised, not work handed to them.
  if (t === 'tasks') {
    const perm = canWriteTasks(req.user, t, before.map(r => r.id), { isDelete: true });
    if (!perm.ok) return res.status(perm.status).json({ error: perm.error });
  }
  db.prepare(`DELETE FROM ${t} ${where.sql}`).run(...where.params);
  // A deleted task cannot be worked, so its pending deadline alerts go too.
  if (t === 'tasks') for (const r of before) clearAlerts(r.id, TASK_ALERT_TYPES);
  res.json({ data: parseJsonColumns(stripSensitive(t, before)) });
});

function normalizeValue(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'object') return JSON.stringify(v);
  return v;
}

const WRITE_MANAGER_ROLES = new Set(['MANAGER', 'OWNER', 'FOUNDER', 'ADMIN']);

/* ─────────────────────────────────────────────────────────────────────────
 * Column write guards
 *
 * The generic writer accepts any column that exists on the table, so every
 * column that is a *boundary* rather than ordinary data has to be named here.
 * Credentials and the platform-admin flag are owned by dedicated endpoints;
 * company_id is the tenancy boundary; the billing columns are the platform's,
 * not the tenant's (routes/admin.js writes those directly, bypassing this).
 * ───────────────────────────────────────────────────────────────────────── */
const IMMUTABLE_COLUMNS = {
  users:     ['password_hash', 'is_super_admin', 'auth_user_id', 'company_id'],
  companies: ['plan', 'subscription_status', 'subscription_expires_at', 'admin_notes'],
};

// Columns a rank-and-file agent must not set on themselves or anyone else.
const MANAGER_ONLY_COLUMNS = {
  users: ['role', 'is_active', 'team_id'],
};

// Returns an error string when the body touches a protected column, else null.
// Tables only a manager may create, change or remove rows in. Reads stay open
// to the whole company — everyone should be able to see the org structure.
const MANAGER_ONLY_TABLES = new Set(['teams']);

function requireManagerForTable(table, user) {
  if (!MANAGER_ONLY_TABLES.has(table)) return null;
  if (user && WRITE_MANAGER_ROLES.has(user.role)) return null;
  return 'Only managers may change teams';
}

function rejectProtectedColumns(table, body, user) {
  if (!body || typeof body !== 'object') return null;
  const immutable = (IMMUTABLE_COLUMNS[table] || []).filter(c => c in body);
  if (immutable.length) {
    return `Not writable through this API: ${immutable.join(', ')}`;
  }
  if (!(user && WRITE_MANAGER_ROLES.has(user.role))) {
    const managerOnly = (MANAGER_ONLY_COLUMNS[table] || []).filter(c => c in body);
    if (managerOnly.length) return `Only managers may set: ${managerOnly.join(', ')}`;
  }
  return null;
}

// Non-managers may only write their own users row; nobody deletes users here.
function canWriteUsers(user, table, ids, { isDelete = false } = {}) {
  if (table !== 'users') return { ok: true };
  if (isDelete && !(user && WRITE_MANAGER_ROLES.has(user.role))) {
    return { ok: false, status: 403, error: 'Only managers may remove team members' };
  }
  if (user && WRITE_MANAGER_ROLES.has(user.role)) return { ok: true };
  if (ids.some(id => id !== user.id)) {
    return { ok: false, status: 403, error: 'You can only edit your own profile' };
  }
  return { ok: true };
}
/* Task write permission.
 *
 * Tasks had no guard at all, which meant the assignment workflow was not a
 * workflow: any agent could create work and drop it on a colleague, reassign a
 * manager's task off their own plate, or delete it outright. All three were
 * reachable from the API with an ordinary agent session.
 *
 *  - Managers may write any task in the company.
 *  - An agent may work a task that is theirs: assigned to them, or one they
 *    raised themselves.
 *  - An agent may not delete a task somebody else assigned to them. Refusing
 *    work is a status change (CANCELLED), which is visible and notifies the
 *    person who asked — deleting it is not.
 */
function canWriteTasks(user, table, ids, { isDelete = false } = {}) {
  if (table !== 'tasks') return { ok: true };
  if (user && WRITE_MANAGER_ROLES.has(user.role)) return { ok: true };
  if (!ids.length) return { ok: true };

  const placeholders = ids.map(() => '?').join(',');
  const rows = db.prepare(
    `SELECT id, assigned_to, created_by FROM tasks WHERE id IN (${placeholders})`
  ).all(...ids);

  for (const r of rows) {
    const mine = r.assigned_to === user.id || r.created_by === user.id;
    if (!mine) {
      return { ok: false, status: 403, error: 'You can only change tasks assigned to you' };
    }
    if (isDelete && r.created_by && r.created_by !== user.id) {
      return { ok: false, status: 403, error: 'Only the person who created this task, or a manager, may delete it' };
    }
  }
  return { ok: true };
}

/* Who a task may be handed to.
 *
 * Assigning work to another person is a manager action — it is the whole point
 * of the teams feature. An agent may still create tasks, but for themselves.
 * Returns an error string, or null when the assignment is allowed.
 */
function checkTaskAssignment(table, body, user, { current = null } = {}) {
  if (table !== 'tasks' || !body || !('assigned_to' in body)) return null;
  if (user && WRITE_MANAGER_ROLES.has(user.role)) return null;

  const target = body.assigned_to;
  // Changing who holds an existing task is reassignment, manager-only even when
  // the agent is handing it to themselves.
  if (current && target !== current.assigned_to) {
    return 'Only managers may reassign a task';
  }
  if (!current && target && target !== user.id) {
    return 'Only managers may assign tasks to someone else';
  }
  return null;
}

// Listing write permission for non-managers:
//  - If the listing IS assigned (agent_id set): only the assigned agent may write.
//  - If the listing is NOT assigned: the uploader (created_by_id) may write.
// Managers always may write. Reassignment itself is gated separately (manager-only).
function canWriteListings(user, table, ids) {
  if (table !== 'listings') return { ok: true };
  if (user && WRITE_MANAGER_ROLES.has(user.role)) return { ok: true };
  if (!ids.length) return { ok: true };
  const placeholders = ids.map(() => '?').join(',');
  const rows = db.prepare(
    `SELECT id, agent_id, created_by_id FROM listings WHERE id IN (${placeholders})`
  ).all(...ids);
  for (const r of rows) {
    let allowed;
    if (r.agent_id) {
      // Assigned → only the assignee controls it.
      allowed = r.agent_id === user.id;
    } else {
      // Unassigned → the uploader controls it.
      allowed = r.created_by_id === user.id;
    }
    if (!allowed) return { ok: false, status: 403, error: 'You can only modify listings assigned to you' };
  }
  return { ok: true };
}

module.exports = router;
