#!/usr/bin/env node
'use strict';
/**
 * scripts/grant-admin.js — Grant, create, list or revoke platform super-admins.
 *
 * The normal way to set super-admins is the SUPER_ADMIN_EMAILS env var, applied
 * at boot. This script exists for the two cases that env var can't cover:
 *   - you're locked out and need access right now, without a redeploy;
 *   - the email you want has no user account yet, so the env var would silently
 *     match nothing.
 *
 *   node scripts/grant-admin.js --list
 *   node scripts/grant-admin.js you@example.com
 *   node scripts/grant-admin.js you@example.com --create --password 'secret123'
 *   node scripts/grant-admin.js old@example.com --revoke
 *
 * Operates on whatever DB_PATH points at — set it to target production:
 *   DB_PATH=/data/warm.db node scripts/grant-admin.js you@example.com
 */
const path = require('path');
const { nanoid } = require('nanoid');

// Resolve the app's modules regardless of where this is run from.
const ROOT = path.join(__dirname, '..');
const { db, DB_PATH } = require(path.join(ROOT, 'db'));
const auth = require(path.join(ROOT, 'auth'));

const argv = process.argv.slice(2);
const flags = new Set(argv.filter(a => a.startsWith('--')));
const positional = argv.filter(a => !a.startsWith('--'));

function flagValue(name) {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : null;
}

function listAdmins() {
  const rows = db.prepare(
    `SELECT u.email, u.first_name, u.last_name, u.role, u.is_active, c.name AS company
       FROM users u LEFT JOIN companies c ON c.id = u.company_id
      WHERE u.is_super_admin = 1 ORDER BY u.created_at`
  ).all();
  if (!rows.length) {
    console.log('\n  No super-admins. /admin is currently inaccessible to everyone.\n');
    return;
  }
  console.log(`\n  Super-admins (${rows.length}):`);
  for (const r of rows) {
    console.log(`    ${r.email}  —  ${[r.first_name, r.last_name].filter(Boolean).join(' ')}` +
                `  [${r.role}${r.is_active ? '' : ', DISABLED'}]  ${r.company || 'no company'}`);
  }
  console.log();
}

function usage() {
  console.log(`
  Usage:
    node scripts/grant-admin.js --list
    node scripts/grant-admin.js <email>
    node scripts/grant-admin.js <email> --create --password '<password>' [--name '<name>'] [--company '<company>']
    node scripts/grant-admin.js <email> --revoke

  Acting on: ${DB_PATH}
`);
}

function main() {
  console.log(`\n  Database: ${DB_PATH}`);

  if (flags.has('--list')) return listAdmins();

  const email = (positional[0] || '').trim().toLowerCase();
  if (!email) { usage(); process.exitCode = 1; return; }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    console.error(`\n  Not a valid email: ${email}\n`);
    process.exitCode = 1;
    return;
  }

  const user = db.prepare('SELECT * FROM users WHERE lower(email) = ?').get(email);

  /* ── Revoke ── */
  if (flags.has('--revoke')) {
    if (!user) { console.error(`\n  No account with ${email}\n`); process.exitCode = 1; return; }
    db.prepare('UPDATE users SET is_super_admin = 0 WHERE id = ?').run(user.id);
    console.log(`\n  Revoked super-admin from ${email}`);
    listAdmins();
    return;
  }

  /* ── Create a new account, then grant ── */
  if (!user) {
    if (!flags.has('--create')) {
      console.error(
        `\n  No account with ${email}.\n` +
        `  Super-admin can only be granted to an existing account — this is the same\n` +
        `  reason putting an unknown address in SUPER_ADMIN_EMAILS silently does nothing.\n\n` +
        `  To create it:\n` +
        `    node scripts/grant-admin.js ${email} --create --password '<password>'\n`
      );
      process.exitCode = 1;
      return;
    }

    const password = flagValue('--password');
    if (!password || password.length < 8) {
      console.error('\n  --create needs --password with at least 8 characters\n');
      process.exitCode = 1;
      return;
    }

    const companyName = flagValue('--company') || 'AtlasCRM Platform';
    const fullName = flagValue('--name') || 'Platform Admin';
    const [firstName, ...rest] = fullName.split(' ');

    // Reuse a company of the same name if one exists, so re-running doesn't
    // litter the tenant list with duplicates.
    let company = db.prepare('SELECT * FROM companies WHERE name = ?').get(companyName);
    const companyId = company ? company.id : nanoid();
    const userId = nanoid();

    try {
      db.exec('BEGIN');
      if (!company) {
        db.prepare('INSERT INTO companies (id, name, email) VALUES (?, ?, ?)')
          .run(companyId, companyName, email);
      }
      db.prepare(
        `INSERT INTO users (id, auth_user_id, company_id, first_name, last_name,
                            email, password_hash, role, is_active, is_super_admin)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'FOUNDER', 1, 1)`
      ).run(userId, userId, companyId, firstName || 'Platform',
            rest.join(' ') || null, email, auth.hashPassword(password));
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      console.error(`\n  Failed: ${e.message}\n`);
      process.exitCode = 1;
      return;
    }

    console.log(`\n  Created ${email} as FOUNDER of "${companyName}" and granted super-admin.`);
    console.log(`  Sign in at /login, then open /admin`);
    console.log(`\n  Add this to SUPER_ADMIN_EMAILS so it survives a redeploy:`);
    console.log(`    SUPER_ADMIN_EMAILS=${email}\n`);
    listAdmins();
    return;
  }

  /* ── Grant to an existing account ── */
  if (user.is_super_admin) {
    console.log(`\n  ${email} is already a super-admin.`);
  } else {
    db.prepare('UPDATE users SET is_super_admin = 1 WHERE id = ?').run(user.id);
    console.log(`\n  Granted super-admin to ${email}`);
  }
  if (!user.is_active) {
    console.warn(`  WARNING: this account is disabled (is_active = 0) and cannot log in.`);
  }
  console.log(`\n  Add this to SUPER_ADMIN_EMAILS so it survives a redeploy:`);
  console.log(`    SUPER_ADMIN_EMAILS=${email}\n`);
  listAdmins();
}

main();
