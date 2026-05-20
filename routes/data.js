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

const router = express.Router();

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

  const OPS = {
    eq:'=', neq:'!=', gt:'>', gte:'>=', lt:'<', lte:'<=',
    like:'LIKE', ilike:'LIKE',  // SQLite LIKE is case-insensitive by default for ASCII
  };
  if (op in OPS) return { op: OPS[op], val };
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
    const f = parseFilter(raw);
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

  // Auto-tenant scoping: unless the request already filtered company_id,
  // we add it so tenants can't see each other's data.
  if (TENANT_TABLES.has(table) && cols.includes('company_id') && user && user.company_id) {
    const alreadyScoped = Object.keys(query).includes('company_id');
    if (!alreadyScoped && table !== 'companies') {
      conds.push('company_id = ?');
      params.push(user.company_id);
    }
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
function hydrateEmbeds(table, parents, embeds, user) {
  if (!embeds.length || !parents.length) return parents;
  const parentCols = SCHEMA_CACHE[table];

  // Best-effort foreign-key resolution. The shape of warm.html embeds is:
  //
  //   property_images(*)            — assume <embed.table>.{table_singular}_id
  //   companies(*)                  — parent has companies_id or company_id
  //   client:clients(...)           — assume parent has client_id
  //   agent:users!fk_name(...)      — explicit fk hint: <fk_name> stripped to col
  //
  // For each parent row P and embed E:
  //   - If parent has <singular(E.table)>_id column → child where id = P.<col>
  //   - Else if child has <singular(P.table)>_id column → child where col = P.id
  for (const embed of embeds) {
    if (!TABLES.includes(embed.table) && embed.table !== 'companies') continue;
    if (!SCHEMA_CACHE[embed.table]) continue;

    const embedCols = SCHEMA_CACHE[embed.table];

    // Candidate parent-side FK column (parent stores child id)
    // Use either explicit alias name or table name
    const aliasSingular = singularize(embed.alias);
    const tableSingular = singularize(embed.table);
    const parentFkCandidates = [
      `${aliasSingular}_id`,
      `${tableSingular}_id`,
    ].filter(c => parentCols.includes(c));

    // Candidate child-side FK column (child stores parent id)
    const parentTableSingular = singularize(table);
    const childFkCandidates = [`${parentTableSingular}_id`].filter(c => embedCols.includes(c));

    const cols = embed.columns.includes('*') ? ['*'] : embed.columns;
    const colList = cols[0] === '*' ? '*' : cols.map(c => `"${c}"`).join(',');

    if (parentFkCandidates.length) {
      const fk = parentFkCandidates[0];
      const stmt = db.prepare(`SELECT ${colList} FROM ${embed.table} WHERE id = ?`);
      for (const p of parents) {
        const id = p[fk];
        if (!id) { p[embed.alias] = null; continue; }
        const row = stmt.get(id);
        p[embed.alias] = parseJsonColumns(stripSensitive(embed.table, row || null));
      }
    } else if (childFkCandidates.length) {
      const fk = childFkCandidates[0];
      const stmt = db.prepare(`SELECT ${colList} FROM ${embed.table} WHERE ${fk} = ?`);
      for (const p of parents) {
        const rows = stmt.all(p.id);
        p[embed.alias] = parseJsonColumns(stripSensitive(embed.table, rows));
      }
    } else {
      // Cannot infer — return empty array so the UI doesn't blow up
      for (const p of parents) p[embed.alias] = Array.isArray(p[embed.alias]) ? p[embed.alias] : [];
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
  if (sel.columns && sel.columns[0] !== '*') {
    projection = sel.columns.filter(c => cols.includes(c)).map(c => `"${c}"`).join(',') || '*';
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

  res.json({ data: rows, count });
});

// INSERT
router.post('/:table', tableGuard, express.json({limit:'5mb'}), (req, res) => {
  const t = req.table;
  let bodies = Array.isArray(req.body) ? req.body : [req.body];
  const cols = SCHEMA_CACHE[t];

  const inserted = [];
  for (const body of bodies) {
    const row = { ...body };
    if (cols.includes('id') && !row.id) row.id = nanoid();
    if (cols.includes('company_id') && !row.company_id && TENANT_TABLES.has(t) && t !== 'companies') {
      row.company_id = req.user.company_id;
    }
    // Strip unknown columns
    const valid = Object.keys(row).filter(k => cols.includes(k));
    if (!valid.length) {
      return res.status(400).json({ error: 'No valid columns provided', table: t });
    }
    const placeholders = valid.map(()=>'?').join(',');
    const colList = valid.map(c => `"${c}"`).join(',');
    const params = valid.map(k => normalizeValue(row[k]));
    try {
      db.prepare(`INSERT INTO ${t} (${colList}) VALUES (${placeholders})`).run(...params);
    } catch (e) {
      return res.status(400).json({ error: e.message, table: t });
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
  const setCols = Object.keys(body).filter(k => cols.includes(k) && k !== 'id');
  if (!setCols.length) return res.status(400).json({ error: 'No valid columns to update' });
  const setSql = setCols.map(c => `"${c}" = ?`).join(',');
  const setParams = setCols.map(c => normalizeValue(body[c]));
  try {
    db.prepare(`UPDATE ${t} SET ${setSql} ${where.sql}`).run(...setParams, ...where.params);
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
  const rows = db.prepare(`SELECT * FROM ${t} ${where.sql}`).all(...where.params);
  res.json({ data: parseJsonColumns(stripSensitive(t, rows)) });
});

// DELETE
router.delete('/:table', tableGuard, (req, res) => {
  const t = req.table;
  const where = buildWhere(t, req.query, req.user);
  if (!where.sql) return res.status(400).json({ error: 'Refusing DELETE without filter' });
  const before = db.prepare(`SELECT * FROM ${t} ${where.sql}`).all(...where.params);
  db.prepare(`DELETE FROM ${t} ${where.sql}`).run(...where.params);
  res.json({ data: parseJsonColumns(stripSensitive(t, before)) });
});

function normalizeValue(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'object') return JSON.stringify(v);
  return v;
}

module.exports = router;
