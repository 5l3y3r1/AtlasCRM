#!/usr/bin/env node
'use strict';
/**
 * scripts/uploads.js — Audit, reorganise and repair the uploads directory.
 *
 * The uploads folder starts as one flat pile of `<timestamp>-<nanoid>-<name>`
 * files with no relationship to the company that owns them, and drifts out of
 * sync with the database in two directions:
 *
 *   orphans  — files on disk that no database row references (dead weight)
 *   broken   — database rows pointing at files that no longer exist (broken
 *              images in the UI)
 *
 * Commands:
 *   node scripts/uploads.js audit       report only, changes nothing
 *   node scripts/uploads.js organize    move files into <company>/<YYYY-MM>/
 *   node scripts/uploads.js repair      null out references to missing files
 *   node scripts/uploads.js prune       delete orphaned files
 *   node scripts/uploads.js all         organize + repair + prune
 *
 * Every mutating command is a DRY RUN unless you pass --confirm. Pruned files
 * are moved to uploads/_quarantine/ rather than deleted outright, so a mistake
 * is recoverable; pass --hard-delete only if you are certain.
 *
 * Targets whatever UPLOADS_DIR / DB_PATH point at:
 *   DB_PATH=/data/warm.db UPLOADS_DIR=/data/uploads node scripts/uploads.js audit
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const { db } = require(path.join(ROOT, 'db'));

const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(ROOT, 'uploads');
const QUARANTINE = path.join(UPLOADS_DIR, '_quarantine');

const argv = process.argv.slice(2);
const cmd = (argv.find(a => !a.startsWith('--')) || 'audit').toLowerCase();
const CONFIRM = argv.includes('--confirm');
const HARD = argv.includes('--hard-delete');

/* ─────────────────────────────────────────────────────────────────────────
 * Discovering references
 *
 * Upload URLs are scattered across columns rather than held in one table —
 * property_images.image_url, users.avatar_url, JSON blobs on listings, and so
 * on. Rather than hardcode a list that silently rots when a column is added,
 * scan every TEXT column of every table for the /uploads/ marker.
 * ───────────────────────────────────────────────────────────────────────── */
const URL_RE = /\/uploads\/[A-Za-z0-9._\-\/]+/g;

function allTables() {
  return db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
  ).all().map(r => r.name);
}

/** Every (table, id, column, filename) that mentions an upload. */
function scanReferences() {
  const refs = [];
  for (const table of allTables()) {
    let cols;
    try { cols = db.prepare(`PRAGMA table_info(${table})`).all(); } catch (e) { continue; }
    const textCols = cols.filter(c => /TEXT|CHAR|CLOB|JSON|^$/i.test(c.type || ''));
    if (!textCols.length) continue;
    const hasId = cols.some(c => c.name === 'id');
    let rows;
    try { rows = db.prepare(`SELECT * FROM ${table}`).all(); } catch (e) { continue; }
    for (const row of rows) {
      for (const c of textCols) {
        const v = row[c.name];
        if (typeof v !== 'string' || !v.includes('/uploads/')) continue;
        for (const url of v.match(URL_RE) || []) {
          refs.push({
            table, column: c.name, id: hasId ? row.id : null,
            url, rel: url.replace(/^\/uploads\//, ''),
          });
        }
      }
    }
  }
  return refs;
}

/** Every file under UPLOADS_DIR, relative to it, excluding quarantine. */
function scanDisk(dir = UPLOADS_DIR, base = '') {
  const out = [];
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return out; }
  for (const e of entries) {
    if (e.name === '.gitkeep' || e.name === '_quarantine') continue;
    const rel = base ? `${base}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...scanDisk(path.join(dir, e.name), rel));
    else out.push(rel);
  }
  return out;
}

function sizeOf(rel) {
  try { return fs.statSync(path.join(UPLOADS_DIR, rel)).size; } catch (e) { return 0; }
}
const mb = b => (b / 1048576).toFixed(1) + ' MB';

/* ─────────────────────────────────────────────────────────────────────────
 * Owning company — decides which folder a file belongs in.
 * ───────────────────────────────────────────────────────────────────────── */
function companyForRef(ref) {
  const q = (sql, ...p) => { try { return db.prepare(sql).get(...p); } catch (e) { return null; } };
  switch (ref.table) {
    case 'property_images': {
      const r = q('SELECT l.company_id c FROM property_images pi JOIN listings l ON l.id = pi.listing_id WHERE pi.id = ?', ref.id);
      return r && r.c;
    }
    case 'deal_documents': {
      const r = q('SELECT d.company_id c FROM deal_documents dd JOIN deals d ON d.id = dd.deal_id WHERE dd.id = ?', ref.id);
      return r && r.c;
    }
    default: {
      // Most tables carry company_id directly; companies is its own owner.
      if (ref.table === 'companies') return ref.id;
      const r = q(`SELECT company_id c FROM ${ref.table} WHERE id = ?`, ref.id);
      return r && r.c;
    }
  }
}

// Files are named "<epoch-ms>-<nanoid>-<original>"; the timestamp is the only
// date we have, so it decides the YYYY-MM bucket. Fall back to mtime, then now.
function monthFor(rel) {
  const base = path.basename(rel);
  const m = base.match(/^(\d{13})-/);
  let d = m ? new Date(parseInt(m[1], 10)) : null;
  if (!d || isNaN(d.getTime())) {
    try { d = fs.statSync(path.join(UPLOADS_DIR, rel)).mtime; } catch (e) { d = new Date(); }
  }
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/* ─────────────────────────────────────────────────────────────────────────
 * Report
 * ───────────────────────────────────────────────────────────────────────── */
function analyse() {
  const refs = scanReferences();
  const onDisk = scanDisk();
  const diskSet = new Set(onDisk);
  const refSet = new Set(refs.map(r => r.rel));

  const broken = refs.filter(r => !diskSet.has(r.rel));
  const orphans = onDisk.filter(f => !refSet.has(f));
  const orphanBytes = orphans.reduce((n, f) => n + sizeOf(f), 0);
  const totalBytes = onDisk.reduce((n, f) => n + sizeOf(f), 0);

  return { refs, onDisk, broken, orphans, orphanBytes, totalBytes, refSet, diskSet };
}

function audit() {
  const a = analyse();
  const byTable = {};
  for (const r of a.refs) byTable[r.table] = (byTable[r.table] || 0) + 1;

  console.log(`\n  Uploads: ${UPLOADS_DIR}`);
  console.log(`  ${'─'.repeat(58)}`);
  console.log(`  files on disk          ${String(a.onDisk.length).padStart(5)}   ${mb(a.totalBytes)}`);
  console.log(`  referenced by the DB   ${String(a.refs.length).padStart(5)}`);
  console.log(`  orphaned on disk       ${String(a.orphans.length).padStart(5)}   ${mb(a.orphanBytes)}`);
  console.log(`  broken references      ${String(a.broken.length).padStart(5)}   (missing files)`);

  console.log(`\n  References by table:`);
  for (const [t, n] of Object.entries(byTable).sort((x, y) => y[1] - x[1])) {
    console.log(`    ${t.padEnd(24)} ${n}`);
  }

  const flat = a.onDisk.filter(f => !f.includes('/')).length;
  console.log(`\n  Layout: ${flat} file(s) still sit flat in the root` +
              (flat ? ` — run "organize"` : ` — already organised`));

  if (a.broken.length) {
    console.log(`\n  Broken references (first 5):`);
    a.broken.slice(0, 5).forEach(r => console.log(`    ${r.table}.${r.column}  ${r.rel}`));
  }
  if (a.orphans.length) {
    const biggest = [...a.orphans].sort((x, y) => sizeOf(y) - sizeOf(x)).slice(0, 5);
    console.log(`\n  Largest orphans:`);
    biggest.forEach(f => console.log(`    ${mb(sizeOf(f)).padStart(9)}  ${f}`));
  }
  console.log();
  return a;
}

/* ─────────────────────────────────────────────────────────────────────────
 * organize — move each referenced file into <company>/<YYYY-MM>/ and rewrite
 * its database references in one transaction, so disk and DB can't diverge.
 * ───────────────────────────────────────────────────────────────────────── */
function organize() {
  const a = analyse();
  const moves = [];       // {from, to, refs:[]}
  const byFile = new Map();
  for (const r of a.refs) {
    if (!a.diskSet.has(r.rel)) continue;          // broken — repair handles it
    if (!byFile.has(r.rel)) byFile.set(r.rel, []);
    byFile.get(r.rel).push(r);
  }

  for (const [rel, refs] of byFile) {
    const company = refs.map(companyForRef).find(Boolean) || '_unassigned';
    const dest = `${company}/${monthFor(rel)}/${path.basename(rel)}`;
    if (dest === rel) continue;                    // already in place
    moves.push({ from: rel, to: dest, refs });
  }

  console.log(`\n  organize: ${moves.length} file(s) to move` + (CONFIRM ? '' : '   [DRY RUN]'));
  if (!moves.length) { console.log('  Nothing to do.\n'); return; }

  moves.slice(0, 8).forEach(m => console.log(`    ${m.from}\n      → ${m.to}`));
  if (moves.length > 8) console.log(`    … and ${moves.length - 8} more`);

  if (!CONFIRM) { console.log('\n  Re-run with --confirm to apply.\n'); return; }

  let moved = 0, rewritten = 0;
  db.exec('BEGIN');
  try {
    for (const m of moves) {
      const src = path.join(UPLOADS_DIR, m.from);
      const dst = path.join(UPLOADS_DIR, m.to);
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      // Copy-then-unlink rather than rename: the destination may be on another
      // device (a mounted volume), where rename() fails with EXDEV.
      fs.copyFileSync(src, dst);
      for (const r of m.refs) {
        const info = db.prepare(
          `UPDATE ${r.table} SET "${r.column}" = replace("${r.column}", ?, ?) WHERE id = ?`
        ).run(`/uploads/${m.from}`, `/uploads/${m.to}`, r.id);
        rewritten += info.changes;
      }
      fs.unlinkSync(src);
      moved++;
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    console.error(`\n  FAILED after ${moved} file(s): ${e.message}`);
    console.error('  Database rolled back. Files already copied remain in both places (harmless).\n');
    process.exitCode = 1;
    return;
  }
  console.log(`\n  Moved ${moved} file(s), rewrote ${rewritten} database reference(s).\n`);
}

/* ─────────────────────────────────────────────────────────────────────────
 * deadrows — remove child rows whose parent no longer exists.
 *
 * This is the upstream cause of most upload mess: when a listing disappears
 * but its property_images rows survive, every one of those rows keeps a file
 * alive on disk that nothing can ever display. `PRAGMA foreign_keys` is ON
 * now, so new deletes cascade properly — this cleans up what predates that.
 *
 * Only relationships declared ON DELETE CASCADE in the schema are swept: for
 * those, a missing parent already means the child was meant to be gone.
 * ───────────────────────────────────────────────────────────────────────── */
// Relationships are read from the schema rather than hardcoded, so a table
// added later is swept automatically instead of being silently skipped.
//   ON DELETE CASCADE  + missing parent -> the row should not exist: delete it
//   ON DELETE SET NULL + missing parent -> the row is fine: null the column
function foreignKeys() {
  const links = [];
  for (const table of allTables()) {
    let fks;
    try { fks = db.prepare(`PRAGMA foreign_key_list(${table})`).all(); } catch (e) { continue; }
    for (const fk of fks) {
      const action = String(fk.on_delete || '').toUpperCase();
      if (action !== 'CASCADE' && action !== 'SET NULL') continue;
      if (!fk.from || !fk.table) continue;
      links.push({ child: table, col: fk.from, parent: fk.table, to: fk.to || 'id', action });
    }
  }
  return links;
}

function deadrows() {
  const found = [];
  for (const l of foreignKeys()) {
    try {
      const n = db.prepare(
        `SELECT COUNT(*) n FROM ${l.child} c LEFT JOIN ${l.parent} p ON p.${l.to} = c.${l.col}
          WHERE c.${l.col} IS NOT NULL AND p.${l.to} IS NULL`
      ).get().n;
      if (n) found.push({ ...l, n });
    } catch (e) { /* column or table absent in this schema version */ }
  }

  if (!found.length) { console.log('\n  deadrows: no orphaned rows.\n'); return; }

  const total = found.reduce((s, f) => s + f.n, 0);
  console.log(`\n  deadrows: ${total} row(s) pointing at a record that no longer exists` +
              (CONFIRM ? '' : '   [DRY RUN]'));
  found.forEach(f => console.log(
    `    ${(f.child + '.' + f.col).padEnd(34)} ${String(f.n).padStart(5)}  ` +
    `${f.action === 'CASCADE' ? 'delete row ' : 'clear field'}  (missing ${f.parent})`));
  if (!CONFIRM) { console.log('\n  Re-run with --confirm to apply.\n'); return; }

  let deleted = 0, cleared = 0;
  db.exec('BEGIN');
  try {
    // CASCADE first: deleting those rows may resolve SET NULL cases for free.
    for (const f of found.filter(x => x.action === 'CASCADE')) {
      deleted += db.prepare(
        `DELETE FROM ${f.child} WHERE ${f.col} IS NOT NULL
           AND ${f.col} NOT IN (SELECT ${f.to} FROM ${f.parent})`
      ).run().changes;
    }
    for (const f of found.filter(x => x.action === 'SET NULL')) {
      cleared += db.prepare(
        `UPDATE ${f.child} SET "${f.col}" = NULL WHERE ${f.col} IS NOT NULL
           AND ${f.col} NOT IN (SELECT ${f.to} FROM ${f.parent})`
      ).run().changes;
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    console.error(`\n  FAILED: ${e.message}\n`);
    process.exitCode = 1;
    return;
  }
  console.log(`\n  Deleted ${deleted} row(s), cleared ${cleared} field(s).\n`);
}

/* ─────────────────────────────────────────────────────────────────────────
 * relink — reconnect broken references to files that ARE on disk under a
 * different name.
 *
 * This has to run before prune, and it is the reason prune is not simply
 * "delete everything unreferenced". The upload route stores files as
 * `<epoch>-<nanoid>-<original>`, but a batch of property_images rows was
 * written pointing at `<listing-id>/<original>` instead. The files are all
 * present; only the paths disagree. Treating those as orphans would delete
 * real listing photos, so we match on the original filename and repoint the
 * database at what is actually there.
 * ───────────────────────────────────────────────────────────────────────── */
const NAMED_UPLOAD = /^(\d{13})-[A-Za-z0-9_-]{6}-(.+)$/;

function buildTailIndex(onDisk) {
  // original filename -> [disk paths], oldest upload first so the mapping is
  // stable across runs rather than dependent on directory order.
  const idx = new Map();
  for (const rel of onDisk) {
    const m = path.basename(rel).match(NAMED_UPLOAD);
    if (!m) continue;
    if (!idx.has(m[2])) idx.set(m[2], []);
    idx.get(m[2]).push({ rel, ts: parseInt(m[1], 10) });
  }
  for (const list of idx.values()) list.sort((a, b) => a.ts - b.ts);
  return idx;
}

function relink() {
  const a = analyse();
  if (!a.broken.length) { console.log('\n  relink: no broken references.\n'); return 0; }

  const idx = buildTailIndex(a.onDisk);
  const fixes = [];
  const unmatched = [];
  let ambiguous = 0;

  for (const r of a.broken) {
    const name = path.basename(r.rel);
    const candidates = idx.get(name);
    if (!candidates || !candidates.length) { unmatched.push(r); continue; }
    if (candidates.length > 1) ambiguous++;
    fixes.push({ ref: r, to: candidates[0].rel });
  }

  console.log(`\n  relink: ${fixes.length} of ${a.broken.length} broken reference(s) can be reconnected` +
              (CONFIRM ? '' : '   [DRY RUN]'));
  if (ambiguous) console.log(`    ${ambiguous} matched more than one file — took the earliest upload`);
  if (unmatched.length) console.log(`    ${unmatched.length} genuinely missing (no file with that name)`);
  fixes.slice(0, 5).forEach(f => console.log(`    ${f.ref.rel}\n      → ${f.to}`));
  if (fixes.length > 5) console.log(`    … and ${fixes.length - 5} more`);

  if (!CONFIRM) { console.log('\n  Re-run with --confirm to apply.\n'); return 0; }

  let n = 0;
  db.exec('BEGIN');
  try {
    for (const f of fixes) {
      n += db.prepare(
        `UPDATE ${f.ref.table} SET "${f.ref.column}" = ? WHERE id = ?`
      ).run(`/uploads/${f.to}`, f.ref.id).changes;
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    console.error(`\n  FAILED: ${e.message}\n`);
    process.exitCode = 1;
    return 0;
  }
  console.log(`\n  Reconnected ${n} reference(s) to files already on disk.\n`);
  return n;
}

/* ─────────────────────────────────────────────────────────────────────────
 * repair — clear references to files that no longer exist.
 * ───────────────────────────────────────────────────────────────────────── */
function repair() {
  const a = analyse();
  if (!a.broken.length) { console.log('\n  repair: no broken references.\n'); return; }

  // A property_images row whose file is gone is pure noise — delete the row.
  // For other tables the file is one field on a record worth keeping, so null
  // the field and leave the record alone.
  const deletes = a.broken.filter(r => r.table === 'property_images');
  const nulls = a.broken.filter(r => r.table !== 'property_images');

  console.log(`\n  repair: ${a.broken.length} broken reference(s)` + (CONFIRM ? '' : '   [DRY RUN]'));
  console.log(`    delete ${deletes.length} orphaned property_images row(s)`);
  console.log(`    clear  ${nulls.length} field(s) on other records`);
  if (!CONFIRM) { console.log('\n  Re-run with --confirm to apply.\n'); return; }

  let removed = 0, cleared = 0;
  db.exec('BEGIN');
  try {
    for (const r of deletes) {
      removed += db.prepare('DELETE FROM property_images WHERE id = ?').run(r.id).changes;
    }
    for (const r of nulls) {
      cleared += db.prepare(`UPDATE ${r.table} SET "${r.column}" = NULL WHERE id = ?`).run(r.id).changes;
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    console.error(`\n  FAILED: ${e.message}\n`);
    process.exitCode = 1;
    return;
  }
  console.log(`\n  Deleted ${removed} row(s), cleared ${cleared} field(s).\n`);
}

/* ─────────────────────────────────────────────────────────────────────────
 * prune — move orphaned files out of the way (quarantine by default).
 * ───────────────────────────────────────────────────────────────────────── */
function prune() {
  const a = analyse();
  if (!a.orphans.length) { console.log('\n  prune: no orphaned files.\n'); return; }

  console.log(`\n  prune: ${a.orphans.length} orphan(s), ${mb(a.orphanBytes)}` + (CONFIRM ? '' : '   [DRY RUN]'));
  console.log(`  Destination: ${HARD ? 'PERMANENT DELETE' : QUARANTINE}`);
  if (!CONFIRM) { console.log('\n  Re-run with --confirm to apply.\n'); return; }

  let done = 0, bytes = 0;
  for (const rel of a.orphans) {
    const src = path.join(UPLOADS_DIR, rel);
    try {
      const n = sizeOf(rel);
      if (HARD) {
        fs.unlinkSync(src);
      } else {
        const dst = path.join(QUARANTINE, rel);
        fs.mkdirSync(path.dirname(dst), { recursive: true });
        fs.copyFileSync(src, dst);
        fs.unlinkSync(src);
      }
      done++; bytes += n;
    } catch (e) {
      console.error(`    could not move ${rel}: ${e.message}`);
    }
  }
  console.log(`\n  ${HARD ? 'Deleted' : 'Quarantined'} ${done} file(s), ${mb(bytes)} reclaimed.`);
  if (!HARD) console.log(`  Recover with: mv ${QUARANTINE}/* ${UPLOADS_DIR}/`);
  console.log();
}

/* ── Remove now-empty directories left behind by organize/prune ───────── */
function tidyEmptyDirs(dir = UPLOADS_DIR) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
  for (const e of entries) {
    if (!e.isDirectory() || e.name === '_quarantine') continue;
    const sub = path.join(dir, e.name);
    tidyEmptyDirs(sub);
    try { if (!fs.readdirSync(sub).length) fs.rmdirSync(sub); } catch (e) {}
  }
}

function main() {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  switch (cmd) {
    case 'audit':    audit(); break;
    case 'deadrows': deadrows(); break;
    case 'relink':   relink(); break;
    case 'organize': organize(); tidyEmptyDirs(); break;
    case 'repair':   repair(); break;
    case 'prune':    prune(); tidyEmptyDirs(); break;
    case 'all':
      // Order matters. relink runs first so files that only *look* orphaned
      // get reconnected before repair clears rows or prune removes anything.
      audit();
      deadrows();
      relink();
      repair();
      organize();
      prune();
      tidyEmptyDirs();
      if (CONFIRM) { console.log('  ── after ──'); audit(); }
      break;
    default:
      console.log(`\n  Unknown command: ${cmd}`);
      console.log('  Use: audit | relink | organize | repair | prune | all   [--confirm] [--hard-delete]\n');
      process.exitCode = 1;
  }
}

main();
