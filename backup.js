'use strict';
/**
 * backup.js — Automatic SQLite snapshots.
 *
 * The whole business lives in one SQLite file on one volume. Without this, a
 * corrupted volume, a bad migration, or a mistaken bulk delete is unrecoverable.
 *
 * Snapshots use `VACUUM INTO`, which writes a fully-consistent, compacted copy
 * of the database while the server keeps serving. It is safe with WAL mode and
 * needs no external tooling — the output is an ordinary .db file you can copy
 * off the volume and open anywhere.
 *
 * Configuration (all optional):
 *   BACKUP_DIR              where snapshots go   (default: <db dir>/backups)
 *   BACKUP_INTERVAL_HOURS   how often            (default: 24)
 *   BACKUP_KEEP             how many to retain   (default: 14)
 *   BACKUP_DISABLED=1       turn the scheduler off entirely
 */
const fs   = require('fs');
const path = require('path');
const { db, DB_PATH } = require('./db');

const BACKUP_DIR = process.env.BACKUP_DIR || path.join(path.dirname(DB_PATH), 'backups');
const INTERVAL_HOURS = Math.max(1, parseInt(process.env.BACKUP_INTERVAL_HOURS || '24', 10) || 24);
const KEEP = Math.max(1, parseInt(process.env.BACKUP_KEEP || '14', 10) || 14);

// hearth-2026-09-15T04-12-33.db — sorts chronologically as a plain string.
const FILE_RE = /^hearth-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.db$/;

function ensureDir() {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

function stamp(d = new Date()) {
  return d.toISOString().replace(/\.\d+Z$/, '').replace(/:/g, '-');
}

/** Write a new snapshot. Returns its metadata. Throws on failure. */
function createBackup() {
  ensureDir();
  const name = `hearth-${stamp()}.db`;
  const dest = path.join(BACKUP_DIR, name);
  // VACUUM INTO refuses to overwrite, so a same-second collision can't clobber
  // an existing snapshot — it throws and we surface that.
  db.exec(`VACUUM INTO '${dest.replace(/'/g, "''")}'`);
  const { size, mtime } = fs.statSync(dest);
  return { file: name, size_bytes: size, created_at: mtime.toISOString() };
}

/** Newest first. Ignores anything that isn't one of our snapshots. */
function listBackups() {
  ensureDir();
  return fs.readdirSync(BACKUP_DIR)
    .filter(f => FILE_RE.test(f))
    .sort()
    .reverse()
    .map(f => {
      const { size, mtime } = fs.statSync(path.join(BACKUP_DIR, f));
      return { file: f, size_bytes: size, created_at: mtime.toISOString() };
    });
}

/** Delete all but the newest `keep`. Returns the names removed. */
function pruneBackups(keep = KEEP) {
  const stale = listBackups().slice(keep);
  for (const b of stale) {
    try { fs.unlinkSync(path.join(BACKUP_DIR, b.file)); } catch (e) {
      console.error('[backup] could not remove', b.file, e.message);
    }
  }
  return stale.map(b => b.file);
}

/**
 * Resolve a user-supplied snapshot name to a real path, or null.
 * Names are matched against FILE_RE rather than sanitised, so no traversal
 * sequence can survive — `../../warm.db` simply isn't a snapshot name.
 */
function resolveBackup(name) {
  if (!FILE_RE.test(String(name || ''))) return null;
  const full = path.join(BACKUP_DIR, name);
  return fs.existsSync(full) ? full : null;
}

function runScheduled() {
  try {
    const made = createBackup();
    const pruned = pruneBackups();
    console.log(
      `[backup] ${made.file} (${(made.size_bytes / 1048576).toFixed(1)} MB)` +
      (pruned.length ? ` — pruned ${pruned.length} old` : '')
    );
  } catch (e) {
    // Never let a failed snapshot take the server down.
    console.error('[backup] FAILED:', e.message);
  }
}

/** Start the scheduler. Safe to call once at boot; no-op when disabled. */
function scheduleBackups() {
  if (process.env.BACKUP_DISABLED === '1') {
    console.log('[backup] disabled via BACKUP_DISABLED');
    return null;
  }
  ensureDir();

  // Take one at boot if the newest is already older than the interval. This is
  // what makes the schedule survive restarts: a container that redeploys daily
  // would otherwise never reach its own 24h timer.
  const newest = listBackups()[0];
  const ageMs = newest ? Date.now() - Date.parse(newest.created_at) : Infinity;
  if (ageMs > INTERVAL_HOURS * 3600 * 1000) {
    setTimeout(runScheduled, 5000); // let the server finish booting first
  }

  const timer = setInterval(runScheduled, INTERVAL_HOURS * 3600 * 1000);
  timer.unref();
  console.log(`[backup] every ${INTERVAL_HOURS}h, keeping ${KEEP}, in ${BACKUP_DIR}`);
  return timer;
}

module.exports = {
  BACKUP_DIR, createBackup, listBackups, pruneBackups, resolveBackup, scheduleBackups,
};
