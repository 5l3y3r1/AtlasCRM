'use strict';
/**
 * routes/export.js — Tenant data export (mounted at /api/export).
 *
 * Two audiences, one mechanism:
 *   - An agency owner who wants their data out of the product (and the right to
 *     take it elsewhere — GDPR art. 20 data portability).
 *   - An operator who wants a human-readable dump that isn't a binary .db file.
 *
 * Everything here is scoped to the caller's own company and gated to managers.
 * Whole-platform snapshots are a different thing entirely — see backup.js.
 */
const express = require('express');
const { db, TABLES, TENANT_TABLES, SENSITIVE_COLUMNS, SCHEMA_CACHE } = require('../db');
const auth = require('../auth');

const router = express.Router();

const MANAGER_ROLES = new Set(['MANAGER', 'OWNER', 'FOUNDER', 'ADMIN']);

function requireManager(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
  if (!MANAGER_ROLES.has(req.user.role)) {
    return res.status(403).json({ error: 'Only managers may export company data' });
  }
  if (!req.user.company_id) return res.status(400).json({ error: 'No company on this account' });
  next();
}

// Tables worth exporting: the tenant-scoped business data. `companies` is
// handled separately (one row) and `users` has its credential column stripped
// by the shared SENSITIVE_COLUMNS rule below.
const TENANT_SCOPED = TABLES.filter(t =>
  TENANT_TABLES.has(t) && t !== 'companies' && SCHEMA_CACHE[t]?.includes('company_id')
);

// Child tables carry no company_id of their own — they belong to the tenant
// through a parent row. Without these, an export would silently omit every
// listing photo and every document attached to a deal, which is exactly the
// data an agency would most notice missing.
const CHILD_TABLES = {
  property_images: { fk: 'listing_id', parent: 'listings' },
  deal_documents:  { fk: 'deal_id',    parent: 'deals' },
};

const EXPORTABLE = [...TENANT_SCOPED, ...Object.keys(CHILD_TABLES).filter(t => SCHEMA_CACHE[t])];

function stripSensitive(table, rows) {
  const drop = SENSITIVE_COLUMNS[table];
  if (!drop) return rows;
  return rows.map(r => { const o = { ...r }; for (const c of drop) delete o[c]; return o; });
}

// The WHERE clause that scopes a table to one company, direct or via a parent.
function scopeSql(table) {
  const child = CHILD_TABLES[table];
  return child
    ? `WHERE ${child.fk} IN (SELECT id FROM ${child.parent} WHERE company_id = ?)`
    : 'WHERE company_id = ?';
}

function readTable(table, companyId) {
  const rows = db.prepare(`SELECT * FROM ${table} ${scopeSql(table)}`).all(companyId);
  return stripSensitive(table, rows);
}

function countTable(table, companyId) {
  return db.prepare(`SELECT COUNT(*) n FROM ${table} ${scopeSql(table)}`).get(companyId).n;
}

/* ─── GET /api/export/tables ────────────────────────────────────────────
 * What's available and how much of it, so the UI can show a manifest before
 * the user commits to a large download.
 * ─────────────────────────────────────────────────────────────────────── */
router.get('/tables', auth.requireAuth, requireManager, (req, res) => {
  const data = EXPORTABLE.map(t => ({ table: t, rows: countTable(t, req.user.company_id) }));
  res.json({ data, error: null });
});

/* ─── GET /api/export/company.json ──────────────────────────────────────
 * The complete tenant dataset in one file. This is the format to keep: it
 * round-trips every column, including the JSON-shaped ones.
 * ─────────────────────────────────────────────────────────────────────── */
router.get('/company.json', auth.requireAuth, requireManager, (req, res) => {
  const companyId = req.user.company_id;
  const company = db.prepare('SELECT * FROM companies WHERE id = ?').get(companyId);

  const payload = {
    exported_at: new Date().toISOString(),
    exported_by: { id: req.user.id, email: req.user.email },
    format_version: 1,
    company: company || null,
    tables: {},
  };
  for (const t of EXPORTABLE) payload.tables[t] = readTable(t, companyId);

  const slug = String(company?.name || 'company').replace(/[^\w.-]+/g, '_').slice(0, 40);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition',
    `attachment; filename="hearth-${slug}-${new Date().toISOString().slice(0, 10)}.json"`);
  res.send(JSON.stringify(payload, null, 2));
});

/* ─── GET /api/export/:table.csv ────────────────────────────────────────
 * One table, for opening in Excel/Sheets. UTF-8 BOM so Excel doesn't mangle
 * Georgian text — without it, ქართული renders as mojibake on Windows.
 * ─────────────────────────────────────────────────────────────────────── */
router.get('/:table.csv', auth.requireAuth, requireManager, (req, res) => {
  const t = req.params.table;
  if (!EXPORTABLE.includes(t)) return res.status(404).json({ error: `Not exportable: ${t}` });

  const rows = readTable(t, req.user.company_id);
  const cols = rows.length
    ? Object.keys(rows[0])
    : SCHEMA_CACHE[t].filter(c => !(SENSITIVE_COLUMNS[t] || []).includes(c));

  const csv = [cols.join(','), ...rows.map(r => cols.map(c => csvCell(r[c])).join(','))].join('\r\n');

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition',
    `attachment; filename="${t}-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send('﻿' + csv);
});

// Quote per RFC 4180, and neutralise spreadsheet formula injection: a cell
// starting with = + - @ is executed as a formula by Excel and Sheets, so a
// lead named `=cmd|...` in someone's CRM would run on export. Prefixing with a
// tab keeps the text intact while forcing it to be read as a string.
function csvCell(v) {
  if (v === null || v === undefined) return '';
  let s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = '\t' + s;
  if (/[",\r\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
}

module.exports = router;
