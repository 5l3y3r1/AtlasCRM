'use strict';
/**
 * db.js — SQLite schema aligned to the frontend's exact column expectations.
 *
 * Uses node:sqlite (built-in to Node 22+).
 */
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs   = require('fs');
const crypto = require('crypto');

let actualDbPath = process.env.DB_PATH || path.join(__dirname, 'warm.db');
let db;
try {
  db = new DatabaseSync(actualDbPath);
} catch (e) {
  // Fallback to /tmp if the original path is not writable (e.g., on Vercel)
  const fallbackPath = path.join('/tmp', 'warm.db');
  console.warn(`[db] Failed to open database at ${actualDbPath}: ${e.message}. Falling back to ${fallbackPath}`);
  actualDbPath = fallbackPath;
  db = new DatabaseSync(fallbackPath);
}
const DB_PATH = actualDbPath;

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  PRAGMA synchronous = NORMAL;
  PRAGMA busy_timeout = 5000;
`);

const SCHEMA = `
CREATE TABLE IF NOT EXISTS companies (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  email         TEXT,
  phone         TEXT,
  logo_url      TEXT,
  address       TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS users (
  id              TEXT PRIMARY KEY,
  auth_user_id    TEXT UNIQUE,
  company_id      TEXT REFERENCES companies(id) ON DELETE CASCADE,
  first_name      TEXT NOT NULL,
  last_name       TEXT,
  email           TEXT UNIQUE NOT NULL,
  password_hash   TEXT NOT NULL,
  phone           TEXT,
  role            TEXT NOT NULL DEFAULT 'AGENT',
  is_active       INTEGER NOT NULL DEFAULT 1,
  avatar_url      TEXT,
  bio             TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS users_company_idx ON users(company_id);
CREATE INDEX IF NOT EXISTS users_email_idx   ON users(email);

CREATE TABLE IF NOT EXISTS leads (
  id                TEXT PRIMARY KEY,
  lead_number       TEXT,
  company_id        TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  agent_id          TEXT REFERENCES users(id) ON DELETE SET NULL,
  source            TEXT NOT NULL DEFAULT 'OTHER',
  full_name         TEXT,
  phone             TEXT,
  email             TEXT,
  inquiry_message   TEXT,
  temperature       TEXT NOT NULL DEFAULT 'WARM',
  status            TEXT NOT NULL DEFAULT 'NEW',
  contacted_at      TEXT,
  notes             TEXT,
  direction         TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS leads_company_idx ON leads(company_id);
CREATE INDEX IF NOT EXISTS leads_status_idx  ON leads(status);

CREATE TABLE IF NOT EXISTS clients (
  id                TEXT PRIMARY KEY,
  client_number     TEXT,
  company_id        TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  primary_agent_id  TEXT REFERENCES users(id) ON DELETE SET NULL,
  first_name        TEXT NOT NULL,
  last_name         TEXT,
  phone             TEXT,
  email             TEXT,
  client_type       TEXT DEFAULT 'BUYER',
  status            TEXT NOT NULL DEFAULT 'ACTIVE',
  budget_min        REAL,
  budget_max        REAL,
  notes             TEXT,
  is_active         INTEGER NOT NULL DEFAULT 1,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS clients_company_idx ON clients(company_id);

CREATE TABLE IF NOT EXISTS listings (
  id              TEXT PRIMARY KEY,
  listing_key     TEXT,
  company_id      TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  agent_id        TEXT REFERENCES users(id) ON DELETE SET NULL,
  title           TEXT NOT NULL,
  description     TEXT,
  listing_type    TEXT NOT NULL DEFAULT 'SALE',
  property_type   TEXT NOT NULL DEFAULT 'APARTMENT',
  status          TEXT NOT NULL DEFAULT 'ACTIVE',
  list_price      REAL,
  price_per_sqm   REAL,
  commission_pct  REAL DEFAULT 3.0,
  bedrooms_total  INTEGER,
  bathrooms       INTEGER,
  living_area     REAL,
  total_area      REAL,
  floor           INTEGER,
  total_floors    INTEGER,
  year_built      INTEGER,
  region          TEXT,
  city            TEXT,
  district        TEXT,
  address         TEXT,
  cadastral_code  TEXT,
  latitude        REAL,
  longitude       REAL,
  amenities       TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS listings_company_idx ON listings(company_id);
CREATE INDEX IF NOT EXISTS listings_status_idx  ON listings(status);

CREATE TABLE IF NOT EXISTS property_images (
  id           TEXT PRIMARY KEY,
  listing_id   TEXT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  image_url    TEXT NOT NULL,
  is_primary   INTEGER NOT NULL DEFAULT 0,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS property_images_listing_idx ON property_images(listing_id);

CREATE TABLE IF NOT EXISTS deals (
  id                    TEXT PRIMARY KEY,
  deal_number           TEXT,
  company_id            TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  buyer_agent_id        TEXT REFERENCES users(id) ON DELETE SET NULL,
  seller_agent_id       TEXT REFERENCES users(id) ON DELETE SET NULL,
  client_id             TEXT REFERENCES clients(id) ON DELETE SET NULL,
  listing_id            TEXT REFERENCES listings(id) ON DELETE SET NULL,
  title                 TEXT,
  deal_type             TEXT NOT NULL DEFAULT 'SALE',
  current_stage         TEXT NOT NULL DEFAULT 'LEAD',
  asking_price          REAL,
  final_price           REAL,
  commission_amount     REAL,
  commission_percent    REAL,
  deposit_amount        REAL,
  expected_close_date   TEXT,
  closed_at             TEXT,
  stage_changed_at      TEXT,
  notes                 TEXT,
  created_at            TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at            TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS deals_company_idx ON deals(company_id);
CREATE INDEX IF NOT EXISTS deals_stage_idx   ON deals(current_stage);

CREATE TABLE IF NOT EXISTS tasks (
  id              TEXT PRIMARY KEY,
  company_id      TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  created_by      TEXT REFERENCES users(id) ON DELETE SET NULL,
  assigned_to     TEXT REFERENCES users(id) ON DELETE SET NULL,
  related_type    TEXT,
  related_id      TEXT,
  task_type       TEXT,
  title           TEXT NOT NULL,
  description     TEXT,
  due_at          TEXT,
  priority        TEXT NOT NULL DEFAULT 'MEDIUM',
  status          TEXT NOT NULL DEFAULT 'PENDING',
  completed_at    TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS tasks_company_idx ON tasks(company_id);
CREATE INDEX IF NOT EXISTS tasks_assigned_idx ON tasks(assigned_to);
CREATE INDEX IF NOT EXISTS tasks_status_idx   ON tasks(status);

CREATE TABLE IF NOT EXISTS showings (
  id                TEXT PRIMARY KEY,
  company_id        TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  listing_id        TEXT REFERENCES listings(id) ON DELETE SET NULL,
  agent_id          TEXT REFERENCES users(id) ON DELETE SET NULL,
  client_id         TEXT REFERENCES clients(id) ON DELETE SET NULL,
  scheduled_at      TEXT,
  duration_minutes  INTEGER DEFAULT 60,
  agent_notes       TEXT,
  status            TEXT NOT NULL DEFAULT 'SCHEDULED',
  feedback          TEXT,
  interest_level    TEXT,
  rating            INTEGER,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS showings_company_idx ON showings(company_id);
CREATE INDEX IF NOT EXISTS showings_date_idx    ON showings(scheduled_at);

CREATE TABLE IF NOT EXISTS financial_transactions (
  id                  TEXT PRIMARY KEY,
  transaction_number  TEXT,
  company_id          TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  agent_id            TEXT REFERENCES users(id) ON DELETE SET NULL,
  deal_id             TEXT REFERENCES deals(id) ON DELETE SET NULL,
  transaction_type    TEXT NOT NULL DEFAULT 'COMMISSION',
  direction           TEXT NOT NULL DEFAULT 'INFLOW',
  amount              REAL NOT NULL,
  currency            TEXT DEFAULT 'USD',
  description         TEXT,
  transaction_date    TEXT NOT NULL DEFAULT (datetime('now')),
  payment_method      TEXT,
  bank_reference      TEXT,
  status              TEXT NOT NULL DEFAULT 'COMPLETED',
  created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ftx_company_idx ON financial_transactions(company_id);
CREATE INDEX IF NOT EXISTS ftx_date_idx    ON financial_transactions(transaction_date);

CREATE TABLE IF NOT EXISTS commission_records (
  id              TEXT PRIMARY KEY,
  company_id      TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  deal_id         TEXT REFERENCES deals(id) ON DELETE CASCADE,
  user_id         TEXT REFERENCES users(id) ON DELETE SET NULL,
  current_stage   TEXT,
  amount          REAL NOT NULL,
  percent         REAL,
  role            TEXT,
  payment_status  TEXT NOT NULL DEFAULT 'PENDING',
  is_paid         INTEGER NOT NULL DEFAULT 0,
  paid_at         TEXT,
  paid_by         TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS commission_company_idx ON commission_records(company_id);

CREATE TABLE IF NOT EXISTS contracts (
  id               TEXT PRIMARY KEY,
  contract_number  TEXT,
  company_id       TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  deal_id          TEXT REFERENCES deals(id) ON DELETE SET NULL,
  client_id        TEXT REFERENCES clients(id) ON DELETE SET NULL,
  agent_id         TEXT REFERENCES users(id) ON DELETE SET NULL,
  template_id      TEXT,
  contract_type    TEXT,
  title            TEXT NOT NULL,
  contract_value   REAL,
  currency         TEXT DEFAULT 'USD',
  final_content    TEXT,
  pdf_url          TEXT,
  status           TEXT NOT NULL DEFAULT 'DRAFT',
  signed_at        TEXT,
  valid_from       TEXT,
  valid_until      TEXT,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS contracts_company_idx ON contracts(company_id);

CREATE TABLE IF NOT EXISTS contract_templates (
  id          TEXT PRIMARY KEY,
  company_id  TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  category    TEXT,
  content     TEXT NOT NULL,
  is_active   INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS deal_documents (
  id            TEXT PRIMARY KEY,
  deal_id       TEXT NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  uploaded_by   TEXT REFERENCES users(id) ON DELETE SET NULL,
  file_name     TEXT NOT NULL,
  file_url      TEXT NOT NULL,
  document_type TEXT,
  size_bytes    INTEGER,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS role_permissions (
  id          TEXT PRIMARY KEY,
  company_id  TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  role        TEXT NOT NULL CHECK(role IN ('FOUNDER','MANAGER','AGENT','BROKER')),
  resource    TEXT NOT NULL,
  can_view    INTEGER NOT NULL DEFAULT 1,
  can_create  INTEGER NOT NULL DEFAULT 1,
  can_edit    INTEGER NOT NULL DEFAULT 1,
  can_delete  INTEGER NOT NULL DEFAULT 0,
  UNIQUE(company_id, role, resource)
);

CREATE TABLE IF NOT EXISTS messages (
  id            TEXT PRIMARY KEY,
  company_id    TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  sent_by       TEXT REFERENCES users(id) ON DELETE SET NULL,
  channel       TEXT NOT NULL CHECK(channel IN ('whatsapp','email')),
  direction     TEXT NOT NULL DEFAULT 'outbound' CHECK(direction IN ('outbound','inbound')),
  contact_type  TEXT CHECK(contact_type IN ('lead','client')),
  contact_id    TEXT,
  to_phone      TEXT,
  to_email      TEXT,
  subject       TEXT,
  body          TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'sent' CHECK(status IN ('sent','delivered','failed','read')),
  provider_id   TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS company_integrations (
  id            TEXT PRIMARY KEY,
  company_id    TEXT NOT NULL UNIQUE REFERENCES companies(id) ON DELETE CASCADE,
  twilio_sid    TEXT,
  twilio_token  TEXT,
  twilio_whatsapp_from TEXT,
  whatsapp_number TEXT,
  whatsapp_template TEXT,
  smtp_host     TEXT,
  smtp_port     INTEGER DEFAULT 587,
  smtp_user     TEXT,
  smtp_pass     TEXT,
  smtp_from     TEXT,
  smtp_from_name TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS spreadsheets (
  id          TEXT PRIMARY KEY,
  company_id  TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  created_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
  name        TEXT NOT NULL,
  content     TEXT NOT NULL DEFAULT '{}',
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS marketing_campaigns (
  id                 TEXT PRIMARY KEY,
  company_id         TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  agent_id           TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_by         TEXT REFERENCES users(id) ON DELETE SET NULL,
  name               TEXT NOT NULL,
  description        TEXT,
  campaign_type      TEXT NOT NULL DEFAULT 'AWARENESS',
  platform           TEXT NOT NULL DEFAULT 'FACEBOOK',
  budget_amount      REAL DEFAULT 0,
  currency           TEXT DEFAULT 'USD',
  spent              REAL DEFAULT 0,
  status             TEXT NOT NULL DEFAULT 'DRAFT',
  start_date         TEXT,
  end_date           TEXT,
  leads_generated    INTEGER DEFAULT 0,
  conversion_rate    REAL DEFAULT 0,
  roi                REAL,
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS campaigns_company_idx ON marketing_campaigns(company_id);

CREATE TABLE IF NOT EXISTS notifications (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type        TEXT NOT NULL DEFAULT 'INFO',
  title       TEXT NOT NULL,
  message     TEXT,
  link        TEXT,
  is_read     INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS notifications_user_idx ON notifications(user_id, is_read);

CREATE TABLE IF NOT EXISTS agent_hunting_profiles (
  id              TEXT PRIMARY KEY,
  agent_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  regions         TEXT,
  districts       TEXT,
  property_types  TEXT,
  listing_types   TEXT,
  deal_type       TEXT,
  price_min       REAL,
  price_max       REAL,
  min_bedrooms    INTEGER,
  max_bedrooms    INTEGER,
  is_active       INTEGER NOT NULL DEFAULT 1,
  match_count     INTEGER DEFAULT 0,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS external_listings (
  id           TEXT PRIMARY KEY,
  source       TEXT NOT NULL,
  external_id  TEXT,
  external_url TEXT,
  title        TEXT,
  description  TEXT,
  list_price   REAL,
  bedrooms     INTEGER,
  area_sqm     REAL,
  region       TEXT,
  city         TEXT,
  district     TEXT,
  owner_phone  TEXT,
  is_owner     INTEGER DEFAULT 0,
  contacted    INTEGER DEFAULT 0,
  raw_data     TEXT,
  scraped_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ext_district_idx ON external_listings(district);

CREATE TABLE IF NOT EXISTS property_alerts (
  id                   TEXT PRIMARY KEY,
  profile_id           TEXT NOT NULL REFERENCES agent_hunting_profiles(id) ON DELETE CASCADE,
  external_listing_id  TEXT NOT NULL REFERENCES external_listings(id) ON DELETE CASCADE,
  match_score          REAL,
  status               TEXT NOT NULL DEFAULT 'NEW',
  created_at           TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS listing_imports (
  id              TEXT PRIMARY KEY,
  company_id      TEXT REFERENCES companies(id) ON DELETE CASCADE,
  user_id         TEXT REFERENCES users(id) ON DELETE SET NULL,
  source          TEXT,           -- 'myhome.ge' / 'ss.ge'
  source_url      TEXT,           -- original listing URL
  title           TEXT,
  description     TEXT,
  list_price      REAL,
  currency        TEXT,
  deal_type       TEXT,           -- SALE / RENT / DAILY
  property_type   TEXT,           -- APARTMENT / HOUSE / LAND / COMMERCIAL...
  area_sqm        REAL,
  rooms           INTEGER,
  bedrooms        INTEGER,
  floor           INTEGER,
  total_floors    INTEGER,
  city            TEXT,
  district        TEXT,
  address         TEXT,
  owner_phone     TEXT,
  photos_json     TEXT,           -- JSON array of local photo paths
  raw_data        TEXT,           -- JSON of the full source payload (fallback)
  status          TEXT NOT NULL DEFAULT 'DRAFT',  -- DRAFT / POSTED / DISCARDED
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS listing_imports_company_idx ON listing_imports(company_id);

CREATE TABLE IF NOT EXISTS sessions (
  token        TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at   TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);

-- Teams group agents under a manager. A user belongs to at most one team
-- (users.team_id), and a team has exactly one manager, so "my team" is
-- answerable from either direction without a join table.
CREATE TABLE IF NOT EXISTS teams (
  id          TEXT PRIMARY KEY,
  company_id  TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  manager_id  TEXT REFERENCES users(id) ON DELETE SET NULL,
  color       TEXT,
  description TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS teams_company_idx ON teams(company_id);
CREATE INDEX IF NOT EXISTS teams_manager_idx ON teams(manager_id);

-- One-time tokens for password reset and email verification.
-- Only the SHA-256 of the token is stored: a leaked database (or a backup that
-- ends up somewhere it shouldn't) then can't be used to seize accounts, because
-- the raw token exists only in the email that was sent.
CREATE TABLE IF NOT EXISTS auth_tokens (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,              -- 'password_reset' | 'email_verify'
  token_hash  TEXT NOT NULL UNIQUE,
  expires_at  TEXT NOT NULL,
  used_at     TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS auth_tokens_user_idx ON auth_tokens(user_id, kind);
CREATE INDEX IF NOT EXISTS auth_tokens_hash_idx ON auth_tokens(token_hash);
`;

db.exec(SCHEMA);

const TABLES = [
  'companies', 'users', 'leads', 'clients', 'listings', 'property_images',
  'deals', 'tasks', 'showings', 'financial_transactions', 'commission_records',
  'contracts', 'contract_templates', 'deal_documents', 'marketing_campaigns',
  'notifications', 'agent_hunting_profiles', 'external_listings',
  'property_alerts', 'listing_imports', 'spreadsheets', 'messages', 'company_integrations', 'role_permissions',
  'teams', 'notifications'
];

const TENANT_TABLES = new Set([
  'leads', 'clients', 'listings', 'deals', 'tasks', 'showings',
  'financial_transactions', 'commission_records', 'contracts',
  'contract_templates', 'marketing_campaigns', 'users', 'companies',
  'agent_hunting_profiles', 'property_alerts', 'listing_imports', 'spreadsheets',
  'messages', 'company_integrations', 'role_permissions', 'teams', 'deal_documents'
]);

// extension_key is a live, reusable credential (like an API key) rather than a
// one-time secret, so — unlike password_hash — it's fine for a user to read
// their *own* copy back (their /api/auth/me response includes it on purpose).
// What it must never do is leak through the generic list/export endpoints,
// which return rows for potentially many teammates at once.
const SENSITIVE_COLUMNS = { users: ['password_hash', 'extension_key'] };

function columnsOf(table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map(r => r.name);
}

// ── Lightweight idempotent migrations ──
// Returns true only when the column was actually added on this boot, so a
// caller can run a one-time backfill without it repeating on every restart.
function ensureColumn(table, column, ddl) {
  try {
    if (!columnsOf(table).includes(column)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
      console.log(`[migration] ALTER TABLE ${table} ADD COLUMN ${ddl}`);
      return true;
    }
  } catch(e) {
    console.error(`[migration] FAILED: ALTER TABLE ${table} ADD COLUMN ${ddl} —`, e.message);
  }
  return false;
}
ensureColumn('listings', 'currency', "currency TEXT NOT NULL DEFAULT 'USD'");
ensureColumn('listings', 'source', 'source TEXT');
ensureColumn('listings', 'source_url', 'source_url TEXT');
ensureColumn('listings', 'owner_lead_id', 'owner_lead_id TEXT');
ensureColumn('listings', 'source_data', 'source_data TEXT');
// deal_documents was missing columns the frontend (15-documents.js) already
// reads/writes — document_name, status, verified_by, verified_at — plus a
// company_id, without which it was excluded from every tenant-scoping check
// in routes/data.js (TENANT_TABLES.has(t) && cols.includes('company_id')):
// any logged-in user, from any company, could list every company's deal
// documents via GET /api/data/deal_documents. Backfilling company_id from
// each row's own deal closes that.
ensureColumn('deal_documents', 'company_id', 'company_id TEXT REFERENCES companies(id) ON DELETE CASCADE');
ensureColumn('deal_documents', 'document_name', 'document_name TEXT');
ensureColumn('deal_documents', 'status', "status TEXT NOT NULL DEFAULT 'UPLOADED'");
ensureColumn('deal_documents', 'verified_by', 'verified_by TEXT REFERENCES users(id) ON DELETE SET NULL');
ensureColumn('deal_documents', 'verified_at', 'verified_at TEXT');
try {
  const orphaned = db.prepare(`
    UPDATE deal_documents SET company_id = (
      SELECT company_id FROM deals WHERE deals.id = deal_documents.deal_id
    ) WHERE company_id IS NULL
  `).run();
  if (orphaned.changes) console.log(`[migration] backfilled company_id on ${orphaned.changes} deal_documents row(s)`);
} catch (e) { console.error('[migration] deal_documents company_id backfill failed:', e.message); }

// role_permissions' CHECK constraint only allowed FOUNDER/MANAGER/AGENT/BROKER,
// but LAWYER has been an assignable user role (see the "add teammate" form)
// with no way to actually be granted permissions — any attempt to insert a
// role_permissions row for one would violate the constraint and fail. SQLite
// can't ALTER a CHECK constraint in place, so this rebuilds the table when
// the stored schema doesn't already mention LAWYER — guarded by inspecting
// sqlite_master directly so it's a no-op on every boot after the first.
try {
  const schemaRow = db.prepare(
    "SELECT sql FROM sqlite_master WHERE type='table' AND name='role_permissions'"
  ).get();
  if (schemaRow && !schemaRow.sql.includes('LAWYER')) {
    db.exec(`
      CREATE TABLE role_permissions_new (
        id          TEXT PRIMARY KEY,
        company_id  TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        role        TEXT NOT NULL CHECK(role IN ('FOUNDER','MANAGER','AGENT','BROKER','LAWYER')),
        resource    TEXT NOT NULL,
        can_view    INTEGER NOT NULL DEFAULT 1,
        can_create  INTEGER NOT NULL DEFAULT 1,
        can_edit    INTEGER NOT NULL DEFAULT 1,
        can_delete  INTEGER NOT NULL DEFAULT 0,
        UNIQUE(company_id, role, resource)
      );
      INSERT INTO role_permissions_new SELECT * FROM role_permissions;
      DROP TABLE role_permissions;
      ALTER TABLE role_permissions_new RENAME TO role_permissions;
    `);
    console.log('[migration] rebuilt role_permissions to allow the LAWYER role');
  }
} catch (e) { console.error('[migration] role_permissions LAWYER rebuild failed:', e.message); }
// Two extra phone numbers per lead.
ensureColumn('leads', 'phone2', 'phone2 TEXT');
ensureColumn('leads', 'phone3', 'phone3 TEXT');
// Portal listing IDs on owners (leads).
ensureColumn('leads', 'myhome_id', 'myhome_id TEXT');
ensureColumn('leads', 'ssge_id', 'ssge_id TEXT');
// Client follow-up scheduling.
ensureColumn('clients', 'follow_up_date', 'follow_up_date TEXT');
ensureColumn('clients', 'follow_up_note', 'follow_up_note TEXT');
// Deal's property owner (a lead/owner) — was previously mislabeled as a client.
ensureColumn('deals', 'owner_id', 'owner_id TEXT');

// What a notification is about. Without this the only handle on the subject was
// free text in `link`, which made two things impossible: deep-linking to the
// exact record, and knowing whether an alert had already been sent — so a
// nightly "this task is overdue" sweep would have re-notified every night.
ensureColumn('notifications', 'ref_type', 'ref_type TEXT');
ensureColumn('notifications', 'ref_id', 'ref_id TEXT');
try {
  db.exec('CREATE INDEX IF NOT EXISTS idx_notifications_ref ON notifications(user_id, type, ref_id)');
} catch (e) { console.error('[migration] notifications ref index failed:', e.message); }

// ── Expanded client profile fields (#1) ──
for (const [col, def] of Object.entries({
  middle_name: 'TEXT', date_of_birth: 'TEXT', gender: 'TEXT', nationality: 'TEXT',
  personal_id: 'TEXT', phone2: 'TEXT', whatsapp: 'TEXT', telegram: 'TEXT',
  preferred_contact: 'TEXT', country: 'TEXT', region: 'TEXT', city: 'TEXT',
  street: 'TEXT', zip_code: 'TEXT', occupation: 'TEXT', company_name: 'TEXT',
  job_title: 'TEXT', annual_income: 'REAL', preferred_property_type: 'TEXT',
  preferred_location: 'TEXT', financing_method: 'TEXT', mortgage_status: 'TEXT',
  lead_source: 'TEXT', priority: 'TEXT', tags: 'TEXT', last_contact_date: 'TEXT',
  internal_comments: 'TEXT', looking_for: 'TEXT', photo_url: 'TEXT',
})) ensureColumn('clients', col, `${col} ${def}`);

// ── Agent presence (#2): last activity timestamp ──
ensureColumn('users', 'last_seen_at', 'last_seen_at TEXT');

// ── Internal team messaging (#3) ──
db.exec(`CREATE TABLE IF NOT EXISTS team_messages (
  id           TEXT PRIMARY KEY,
  company_id   TEXT NOT NULL,
  sender_id    TEXT NOT NULL,
  subject      TEXT,
  body         TEXT NOT NULL,
  is_important INTEGER NOT NULL DEFAULT 0,
  is_broadcast INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
)`);
db.exec(`CREATE TABLE IF NOT EXISTS team_message_recipients (
  id          TEXT PRIMARY KEY,
  message_id  TEXT NOT NULL,
  user_id     TEXT NOT NULL,
  is_read     INTEGER NOT NULL DEFAULT 0,
  read_at     TEXT
)`);
try { db.exec(`CREATE INDEX IF NOT EXISTS idx_tmr_user ON team_message_recipients(user_id, is_read)`); } catch (e) {}
try { db.exec(`CREATE INDEX IF NOT EXISTS idx_tmr_msg ON team_message_recipients(message_id)`); } catch (e) {}

// ── Real-time team chat: group channels + 1:1 private DMs, unified under one
// message engine (a DM is just a 2-person channel with is_dm=1) so there's one
// send/read/broadcast path instead of duplicating it for channels vs DMs. ──
db.exec(`CREATE TABLE IF NOT EXISTS chat_channels (
  id           TEXT PRIMARY KEY,
  company_id   TEXT NOT NULL,
  name         TEXT,
  description  TEXT,
  is_dm        INTEGER NOT NULL DEFAULT 0,
  dm_key       TEXT,
  created_by   TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
)`);
db.exec(`CREATE TABLE IF NOT EXISTS chat_channel_members (
  id                    TEXT PRIMARY KEY,
  channel_id            TEXT NOT NULL,
  user_id               TEXT NOT NULL,
  role                  TEXT NOT NULL DEFAULT 'member',
  last_read_message_id  TEXT,
  joined_at             TEXT NOT NULL DEFAULT (datetime('now'))
)`);
db.exec(`CREATE TABLE IF NOT EXISTS chat_messages (
  id             TEXT PRIMARY KEY,
  channel_id     TEXT NOT NULL,
  sender_id      TEXT NOT NULL,
  content        TEXT,
  attachment_url TEXT,
  reply_to_id    TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  edited_at      TEXT,
  deleted_at     TEXT
)`);
try { db.exec(`CREATE INDEX IF NOT EXISTS idx_chat_members_channel ON chat_channel_members(channel_id)`); } catch (e) {}
try { db.exec(`CREATE INDEX IF NOT EXISTS idx_chat_members_user ON chat_channel_members(user_id)`); } catch (e) {}
try { db.exec(`CREATE INDEX IF NOT EXISTS idx_chat_messages_channel ON chat_messages(channel_id, created_at)`); } catch (e) {}
try { db.exec(`CREATE INDEX IF NOT EXISTS idx_chat_channels_company ON chat_channels(company_id)`); } catch (e) {}
try { db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_dm_key ON chat_channels(company_id, dm_key) WHERE dm_key IS NOT NULL`); } catch (e) {}

// Link a chat message to a CRM record (lead/deal/listing/client) so you can click
// straight through to it from the conversation.
ensureColumn('chat_messages', 'ref_type', 'ref_type TEXT');
ensureColumn('chat_messages', 'ref_id', 'ref_id TEXT');
ensureColumn('chat_messages', 'ref_label', 'ref_label TEXT');

db.exec(`CREATE TABLE IF NOT EXISTS chat_reactions (
  id          TEXT PRIMARY KEY,
  message_id  TEXT NOT NULL,
  user_id     TEXT NOT NULL,
  emoji       TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(message_id, user_id, emoji)
)`);
try { db.exec(`CREATE INDEX IF NOT EXISTS idx_chat_reactions_msg ON chat_reactions(message_id)`); } catch (e) {}

// ── Meetings: scheduled via the chat "attach a record" flow (meeting-form
// reference). Owner/client are find-or-create'd against leads/clients by
// phone — a meeting isn't just free text, it's tied into the real CRM data.
db.exec(`CREATE TABLE IF NOT EXISTS meetings (
  id                  TEXT PRIMARY KEY,
  company_id          TEXT NOT NULL,
  case_number         TEXT,
  property_type       TEXT,
  deal_type           TEXT,
  address             TEXT,
  owner_lead_id       TEXT REFERENCES leads(id) ON DELETE SET NULL,
  owner_name          TEXT,
  owner_phone         TEXT,
  client_id           TEXT REFERENCES clients(id) ON DELETE SET NULL,
  client_name         TEXT,
  client_phone        TEXT,
  price               REAL,
  cooperation         TEXT,
  term_months         INTEGER,
  meeting_time         TEXT,
  primary_agent_id    TEXT REFERENCES users(id) ON DELETE SET NULL,
  primary_agent_role  TEXT,
  secondary_agent_id  TEXT REFERENCES users(id) ON DELETE SET NULL,
  secondary_agent_role TEXT,
  status              TEXT NOT NULL DEFAULT 'SCHEDULED',
  created_by_id       TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
)`);
try { db.exec(`CREATE INDEX IF NOT EXISTS idx_meetings_company ON meetings(company_id)`); } catch (e) {}
try { db.exec(`CREATE INDEX IF NOT EXISTS idx_meetings_agent ON meetings(primary_agent_id)`); } catch (e) {}

// Platform administration: company subscriptions + super-admin users.
ensureColumn('companies', 'plan', "plan TEXT DEFAULT 'trial'");
ensureColumn('companies', 'subscription_status', "subscription_status TEXT DEFAULT 'active'");
ensureColumn('companies', 'subscription_expires_at', 'subscription_expires_at TEXT');
ensureColumn('companies', 'admin_notes', 'admin_notes TEXT');
// Billing. `seats` / `max_listings` are per-company overrides: NULL means "use
// whatever the plan allows", so raising a plan's limits lifts every company on
// it, while a negotiated exception stays pinned to the one company.
ensureColumn('companies', 'trial_ends_at', 'trial_ends_at TEXT');
ensureColumn('companies', 'billing_email', 'billing_email TEXT');
ensureColumn('companies', 'seats', 'seats INTEGER');
ensureColumn('companies', 'max_listings', 'max_listings INTEGER');
ensureColumn('users', 'is_super_admin', 'is_super_admin INTEGER NOT NULL DEFAULT 0');
// Email verification. Null = unverified.
const ADDED_EMAIL_VERIFIED = ensureColumn('users', 'email_verified_at', 'email_verified_at TEXT');
ensureColumn('users', 'team_id', 'team_id TEXT');

// Invoices. Deliberately provider-agnostic: an invoice is a record of what was
// owed and whether it was settled. How it was settled (bank transfer, card, a
// PSP callback) is just `method` + `reference`, so adding a payment provider
// later means writing those two fields, not reshaping the table.
db.exec(`CREATE TABLE IF NOT EXISTS invoices (
  id            TEXT PRIMARY KEY,
  company_id    TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  number        TEXT UNIQUE,
  plan          TEXT,
  period_start  TEXT,
  period_end    TEXT,
  amount        REAL NOT NULL DEFAULT 0,
  currency      TEXT NOT NULL DEFAULT 'GEL',
  status        TEXT NOT NULL DEFAULT 'DRAFT',   -- DRAFT | SENT | PAID | VOID
  issued_at     TEXT,
  due_at        TEXT,
  paid_at       TEXT,
  method        TEXT,                            -- bank_transfer | card | ...
  reference     TEXT,                            -- PSP id, transfer reference
  notes         TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
)`);
db.exec(`CREATE INDEX IF NOT EXISTS invoices_company_idx ON invoices(company_id)`);
db.exec(`CREATE INDEX IF NOT EXISTS invoices_status_idx  ON invoices(status)`);

// Public contact-form submissions, surfaced in the super-admin dashboard.
db.exec(`CREATE TABLE IF NOT EXISTS contact_messages (
  id          TEXT PRIMARY KEY,
  name        TEXT,
  email       TEXT,
  phone       TEXT,
  company     TEXT,
  message     TEXT NOT NULL,
  is_read     INTEGER NOT NULL DEFAULT 0,
  ip          TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
)`);

// One-time backfill, and ONLY on the boot that adds the column: every account
// that predates email verification is treated as verified, so enabling the
// feature doesn't lock out a live deployment's existing users. Guarding on
// ADDED_EMAIL_VERIFIED matters — running this unconditionally would re-verify
// every pending signup on the next restart.
if (ADDED_EMAIL_VERIFIED) {
  try {
    const r = db.prepare(
      "UPDATE users SET email_verified_at = datetime('now') WHERE email_verified_at IS NULL"
    ).run();
    if (r.changes) console.log(`[migration] marked ${r.changes} pre-existing account(s) email-verified`);
  } catch (e) { console.error('[migration] email verification backfill failed:', e.message); }
}

// Per-user key the browser extension uses to authenticate as a specific
// agent. The extension previously relied on the CRM session cookie riding
// along on its cross-origin fetch (see cookieOptsFor in routes/auth.js) —
// that works when the browser allows it, but a SameSite=None third-party
// cookie is exactly the kind of thing Chrome's privacy features increasingly
// block, and when it's blocked the request falls back to the *shared*
// X-CRM-Key in routes/import.js, which resolveActor() maps to one fixed
// "first owner" account — so every agent's imports silently land in the
// same inbox instead of their own. A per-user key sent explicitly as a
// header sidesteps third-party cookie policy entirely and resolves to the
// exact account it belongs to (see resolveActor in routes/import.js).
function genExtensionKey() {
  return 'whk_' + crypto.randomBytes(24).toString('base64url');
}
ensureColumn('users', 'extension_key', 'extension_key TEXT');
try {
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS users_extension_key_idx ON users(extension_key)');
} catch (e) { console.error('[migration] extension_key index failed:', e.message); }
// Deliberately NOT gated on ADDED_EXTENSION_KEY (unlike the email-verification
// backfill above). This app boots as two separate processes — `node seed.js;
// node server.js` per railway.json — each independently require()-ing this
// file. The column gets added during whichever process runs first, which on
// a fresh deploy is seed.js — *before* it inserts its own demo users (whose
// INSERT never sets extension_key). server.js's later, separate require then
// sees the column already exists and, if gated on "just added", would skip
// backfilling the very rows seed.js just created with a NULL key. Running
// this every boot is safe either way: it only ever touches rows that are
// still NULL, so an already-keyed account is never re-rolled.
try {
  const rows = db.prepare('SELECT id FROM users WHERE extension_key IS NULL').all();
  const setKey = db.prepare('UPDATE users SET extension_key = ? WHERE id = ?');
  for (const r of rows) setKey.run(genExtensionKey(), r.id);
  if (rows.length) console.log(`[migration] generated an extension key for ${rows.length} account(s) missing one`);
} catch (e) { console.error('[migration] extension_key backfill failed:', e.message); }

// Tasks once used 'DONE' while the whole UI compared against 'COMPLETED', so
// those rows rendered unchecked, never matched the completed filter, and were
// counted as overdue forever. Normalise to the single vocabulary the app uses.
(function normaliseTaskStatus() {
  try {
    const r = db.prepare(
      "UPDATE tasks SET status = 'COMPLETED' WHERE status = 'DONE'"
    ).run();
    const r2 = db.prepare(
      "UPDATE tasks SET status = 'CANCELLED' WHERE status = 'CANCELED'"
    ).run();
    const n = (r.changes || 0) + (r2.changes || 0);
    if (n) console.log(`[migration] normalised ${n} task status value(s)`);
  } catch (e) { console.error('[migration] task status normalise failed:', e.message); }
})();

// Grant super-admin to the emails listed in SUPER_ADMIN_EMAILS (comma-separated).
// Set this once on Railway to your own email to unlock the /admin panel.
(function seedSuperAdmins() {
  const emails = String(process.env.SUPER_ADMIN_EMAILS || '')
    .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  if (!emails.length) {
    // Not an error — but if nobody is a super-admin, /admin is unreachable for
    // everyone, and that is worth saying out loud rather than discovering via
    // a 403.
    try {
      const n = db.prepare('SELECT COUNT(*) n FROM users WHERE is_super_admin = 1').get().n;
      if (!n) console.warn('[db] No super-admin exists. /admin is inaccessible. Set SUPER_ADMIN_EMAILS.');
    } catch (e) {}
    return;
  }

  const granted = [];
  const missing = [];
  for (const em of emails) {
    try {
      const r = db.prepare('UPDATE users SET is_super_admin = 1 WHERE lower(email) = ?').run(em);
      (r.changes ? granted : missing).push(em);
    } catch (e) {
      console.error(`[db] granting super-admin to ${em} failed:`, e.message);
    }
  }

  // The list is authoritative: anyone holding super-admin who is NOT on it gets
  // demoted. This is what makes "replace the admin email" actually work —
  // without it, the old address keeps full platform access forever.
  try {
    const stale = db.prepare(
      `SELECT email FROM users WHERE is_super_admin = 1 AND lower(email) NOT IN (${emails.map(() => '?').join(',')})`
    ).all(...emails).map(r => r.email);
    if (stale.length) {
      db.prepare(
        `UPDATE users SET is_super_admin = 0 WHERE is_super_admin = 1 AND lower(email) NOT IN (${emails.map(() => '?').join(',')})`
      ).run(...emails);
      console.log(`[db] Super-admin REVOKED for: ${stale.join(', ')}`);
    }
  } catch (e) {
    console.error('[db] revoking stale super-admins failed:', e.message);
  }

  if (granted.length) console.log(`[db] Super-admin: ${granted.join(', ')}`);
  // The silent-failure case: an address with no account matches no row, so the
  // grant quietly does nothing and /admin still 403s.
  if (missing.length) {
    console.warn(
      `[db] SUPER_ADMIN_EMAILS lists ${missing.join(', ')} — no user account has that email, ` +
      `so nothing was granted. Create the account first (npm run grant-admin -- <email> --create).`
    );
  }
})();

// One-time fix for listings whose stored coordinates land in the wrong country.
// Georgia's bounding box is roughly lat 41.0–43.8, lng 40.0–46.8. If a row's
// (lat,lng) isn't in-box but the swapped (lng,lat) is, swap it; if neither is
// valid, null both so the map re-geocodes (constrained to Georgia).
(function fixListingCoords() {
  const inGeo = (lat, lng) => lat != null && lng != null &&
    lat >= 41 && lat <= 43.8 && lng >= 40 && lng <= 46.8;
  let rows = [];
  try {
    rows = db.prepare(`SELECT id, latitude, longitude FROM listings
                       WHERE latitude IS NOT NULL AND longitude IS NOT NULL`).all();
  } catch (e) { return; }
  let fixed = 0, nulled = 0;
  for (const r of rows) {
    const lat = Number(r.latitude), lng = Number(r.longitude);
    if (inGeo(lat, lng)) continue;                     // already correct
    if (inGeo(lng, lat)) {                             // swapped → fix
      db.prepare(`UPDATE listings SET latitude = ?, longitude = ? WHERE id = ?`).run(lng, lat, r.id);
      fixed++;
    } else {                                           // nonsense → clear for re-geocode
      db.prepare(`UPDATE listings SET latitude = NULL, longitude = NULL WHERE id = ?`).run(r.id);
      nulled++;
    }
  }
  if (fixed || nulled) console.log(`[db] Coordinate fix: swapped ${fixed}, cleared ${nulled} listing(s)`);
})();
ensureColumn('listings', 'created_by_id', 'created_by_id TEXT');
ensureColumn('leads', 'created_by_id', 'created_by_id TEXT');
ensureColumn('clients', 'created_by_id', 'created_by_id TEXT');
ensureColumn('external_listings', 'deal_type', 'deal_type TEXT');
ensureColumn('external_listings', 'address', 'address TEXT');
ensureColumn('external_listings', 'property_type', 'property_type TEXT');
ensureColumn('agent_hunting_profiles', 'area_min', 'area_min REAL');
ensureColumn('agent_hunting_profiles', 'area_max', 'area_max REAL');
ensureColumn('agent_hunting_profiles', 'bedrooms_min', 'bedrooms_min INTEGER');
ensureColumn('agent_hunting_profiles', 'bedrooms_max', 'bedrooms_max INTEGER');
ensureColumn('deal_documents', 'status', "status TEXT NOT NULL DEFAULT 'UPLOADED'");
ensureColumn('deal_documents', 'document_name', 'document_name TEXT');
ensureColumn('deal_documents', 'verified_by', 'verified_by TEXT');
ensureColumn('deal_documents', 'verified_at', 'verified_at TEXT');

// Backfill deal_number for existing deals that have none
(function backfillDealNumbers() {
  const unnumbered = db.prepare(
    `SELECT id, company_id FROM deals WHERE deal_number IS NULL ORDER BY rowid ASC`
  ).all();
  if (!unnumbered.length) return;
  const counters = {};
  for (const deal of unnumbered) {
    const cid = deal.company_id || '_';
    // Find highest existing number for this company
    if (counters[cid] === undefined) {
      const last = db.prepare(
        `SELECT deal_number FROM deals WHERE company_id = ? AND deal_number IS NOT NULL ORDER BY rowid DESC LIMIT 1`
      ).get(deal.company_id);
      const match = last?.deal_number?.match(/(\d+)$/);
      counters[cid] = match ? parseInt(match[1], 10) : 0;
    }
    counters[cid]++;
    const num = 'D-' + String(counters[cid]).padStart(4, '0');
    db.prepare(`UPDATE deals SET deal_number = ? WHERE id = ?`).run(num, deal.id);
  }
  console.log(`[db] Backfilled deal_number for ${unnumbered.length} deal(s)`);
})();

// ── listing_number must exist BEFORE the backfill below ──────────────────────
try { db.exec('ALTER TABLE listings ADD COLUMN listing_number TEXT'); } catch(e) {}

// Backfill listing_number for existing listings
(() => {
  const unnumbered = db.prepare(
    `SELECT id, company_id FROM listings WHERE listing_number IS NULL ORDER BY rowid ASC`
  ).all();
  if (!unnumbered.length) return;
  const counters = {};
  for (const listing of unnumbered) {
    const cid = listing.company_id || '_';
    if (counters[cid] === undefined) {
      const last = db.prepare(
        `SELECT listing_number FROM listings WHERE company_id = ? AND listing_number IS NOT NULL ORDER BY rowid DESC LIMIT 1`
      ).get(listing.company_id);
      const match = last?.listing_number?.match(/(\d+)$/);
      counters[cid] = match ? parseInt(match[1], 10) : 0;
    }
    counters[cid]++;
    const num = 'L-' + String(counters[cid]).padStart(4, '0');
    db.prepare(`UPDATE listings SET listing_number = ? WHERE id = ?`).run(num, listing.id);
  }
  console.log(`[db] Backfilled listing_number for ${unnumbered.length} listing(s)`);
})();

// Backfill lead_number / client_number for existing rows that have none, so the
// list, details, exports and PDFs all show a stable ID. Mirrors the listing logic.
function backfillNumber(table, column, prefix) {
  try { db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} TEXT`); } catch (e) {}
  const unnumbered = db.prepare(
    `SELECT id, company_id FROM ${table} WHERE ${column} IS NULL ORDER BY rowid ASC`
  ).all();
  if (!unnumbered.length) return;
  const counters = {};
  for (const rec of unnumbered) {
    const cid = rec.company_id || '_';
    if (counters[cid] === undefined) {
      const last = db.prepare(
        `SELECT ${column} FROM ${table} WHERE company_id = ? AND ${column} IS NOT NULL ORDER BY rowid DESC LIMIT 1`
      ).get(rec.company_id);
      const match = last?.[column]?.match(/(\d+)$/);
      counters[cid] = match ? parseInt(match[1], 10) : 0;
    }
    counters[cid]++;
    const num = prefix + String(counters[cid]).padStart(4, '0');
    db.prepare(`UPDATE ${table} SET ${column} = ? WHERE id = ?`).run(num, rec.id);
  }
  console.log(`[db] Backfilled ${column} for ${unnumbered.length} ${table} row(s)`);
}
backfillNumber('leads', 'lead_number', 'LD-');
backfillNumber('clients', 'client_number', 'C-');
ensureColumn('agent_hunting_profiles', 'property_type', 'property_type TEXT');
ensureColumn('agent_hunting_profiles', 'source_type_filter', 'source_type_filter TEXT');
ensureColumn('agent_hunting_profiles', 'company_id', 'company_id TEXT');
ensureColumn('property_alerts', 'company_id', 'company_id TEXT');
ensureColumn('property_alerts', 'agent_id', 'agent_id TEXT');
ensureColumn('property_alerts', 'is_read', 'is_read INTEGER DEFAULT 0');
ensureColumn('property_alerts', 'read_at', 'read_at TEXT');
// Force-add whatsapp columns — SQLite ignores "duplicate column" error gracefully
try { db.exec('ALTER TABLE company_integrations ADD COLUMN whatsapp_number TEXT'); } catch(e) {}
try { db.exec('ALTER TABLE company_integrations ADD COLUMN whatsapp_template TEXT'); } catch(e) {}

// ── New listing fields (June 2026) ──────────────────────────────────────────
try { db.exec('ALTER TABLE listings ADD COLUMN is_exclusive INTEGER DEFAULT 0'); } catch(e) {}
try { db.exec('ALTER TABLE listings ADD COLUMN parking_available INTEGER DEFAULT 0'); } catch(e) {}
try { db.exec('ALTER TABLE listings ADD COLUMN parking_type TEXT'); } catch(e) {}
// Private house fields
try { db.exec('ALTER TABLE listings ADD COLUMN land_area REAL'); } catch(e) {}
try { db.exec('ALTER TABLE listings ADD COLUMN has_pool INTEGER DEFAULT 0'); } catch(e) {}
try { db.exec('ALTER TABLE listings ADD COLUMN is_vacation_home INTEGER DEFAULT 0'); } catch(e) {}
// Land fields
try { db.exec('ALTER TABLE listings ADD COLUMN land_coefficient TEXT'); } catch(e) {}
try { db.exec('ALTER TABLE listings ADD COLUMN land_purpose TEXT'); } catch(e) {}
try { db.exec('ALTER TABLE listings ADD COLUMN land_communications TEXT'); } catch(e) {}
try { db.exec('ALTER TABLE listings ADD COLUMN land_road_type TEXT'); } catch(e) {}
try { db.exec('ALTER TABLE listings ADD COLUMN functional_zone TEXT'); } catch(e) {}

ensureColumn('company_integrations', 'whatsapp_number', 'whatsapp_number TEXT');
ensureColumn('company_integrations', 'whatsapp_template', 'whatsapp_template TEXT');
ensureColumn('listings', 'is_exclusive', 'is_exclusive INTEGER DEFAULT 0');
ensureColumn('listings', 'listing_number', 'listing_number TEXT');
ensureColumn('listings', 'parking_available', 'parking_available INTEGER DEFAULT 0');
ensureColumn('listings', 'parking_type', 'parking_type TEXT');
ensureColumn('listings', 'land_area', 'land_area REAL');
ensureColumn('listings', 'has_pool', 'has_pool INTEGER DEFAULT 0');
ensureColumn('listings', 'is_vacation_home', 'is_vacation_home INTEGER DEFAULT 0');
ensureColumn('listings', 'land_coefficient', 'land_coefficient TEXT');
ensureColumn('listings', 'land_purpose', 'land_purpose TEXT');
ensureColumn('listings', 'land_communications', 'land_communications TEXT');
ensureColumn('listings', 'land_road_type', 'land_road_type TEXT');
ensureColumn('listings', 'functional_zone', 'functional_zone TEXT');

// ── Comprehensive property details (building, systems, amenities, media) ──
ensureColumn('listings', 'bathrooms', 'bathrooms INTEGER');
ensureColumn('listings', 'total_area', 'total_area REAL');
ensureColumn('listings', 'building_material', 'building_material TEXT');
ensureColumn('listings', 'building_status', 'building_status TEXT');
ensureColumn('listings', 'renovation_status', 'renovation_status TEXT');
ensureColumn('listings', 'ceiling_height', 'ceiling_height REAL');
ensureColumn('listings', 'heating_type', 'heating_type TEXT');
ensureColumn('listings', 'hot_water_type', 'hot_water_type TEXT');
ensureColumn('listings', 'furniture_status', 'furniture_status TEXT');
ensureColumn('listings', 'balconies_count', 'balconies_count INTEGER');
ensureColumn('listings', 'view_type', 'view_type TEXT');
ensureColumn('listings', 'has_elevator', 'has_elevator INTEGER DEFAULT 0');
ensureColumn('listings', 'has_ac', 'has_ac INTEGER DEFAULT 0');
ensureColumn('listings', 'has_internet', 'has_internet INTEGER DEFAULT 0');
ensureColumn('listings', 'has_tv_cable', 'has_tv_cable INTEGER DEFAULT 0');
ensureColumn('listings', 'has_alarm', 'has_alarm INTEGER DEFAULT 0');
ensureColumn('listings', 'has_storage', 'has_storage INTEGER DEFAULT 0');
ensureColumn('listings', 'has_fireplace', 'has_fireplace INTEGER DEFAULT 0');
ensureColumn('listings', 'is_negotiable', 'is_negotiable INTEGER DEFAULT 0');
ensureColumn('listings', 'video_url', 'video_url TEXT');
ensureColumn('listings', 'virtual_tour_url', 'virtual_tour_url TEXT');

// One-time: spreadsheets are now private per-user. Any legacy spreadsheet with
// no created_by gets assigned to its company's founder so it isn't orphaned
// (otherwise the per-user filter would hide it from everyone).
try {
  const orphans = db.prepare("SELECT id, company_id FROM spreadsheets WHERE created_by IS NULL OR created_by = ''").all();
  if (orphans.length) {
    const findFounder = db.prepare("SELECT id FROM users WHERE company_id = ? AND role = 'FOUNDER' ORDER BY rowid ASC LIMIT 1");
    const findAnyUser = db.prepare("SELECT id FROM users WHERE company_id = ? ORDER BY rowid ASC LIMIT 1");
    const setCreator = db.prepare('UPDATE spreadsheets SET created_by = ? WHERE id = ?');
    let fixed = 0;
    for (const sp of orphans) {
      const owner = findFounder.get(sp.company_id) || findAnyUser.get(sp.company_id);
      if (owner) { setCreator.run(owner.id, sp.id); fixed++; }
    }
    if (fixed) console.log(`[db] Assigned ${fixed} orphaned spreadsheet(s) to company founder`);
  }
} catch(e) { console.error('[db] spreadsheet owner backfill failed:', e.message); }

// ── Additive migrations (safe to re-run; SQLite errors on duplicate column) ──
// Run BEFORE SCHEMA_CACHE is built so the generic data route whitelists the new
// columns (otherwise inserts like leads.campaign_id would be silently stripped).
function addColumn(table, colDef) {
  const col = colDef.split(/\s+/)[0];
  try {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${colDef}`);
    console.log(`[db] migrate: added ${table}.${col}`);
  } catch (e) {
    if (!/duplicate column/i.test(e.message)) console.error(`[db] migrate ${table}.${col}:`, e.message);
  }
}
// Marketing attribution
addColumn('leads',               'campaign_id TEXT');
addColumn('deals',               'campaign_id TEXT');
addColumn('deals',               'agent_split_percent REAL');
addColumn('deals',               'commission_generated_at TEXT');
// Ad-platform spend sync mapping
addColumn('marketing_campaigns', 'external_platform TEXT');     // 'META' | 'TIKTOK'
addColumn('marketing_campaigns', 'external_campaign_id TEXT');  // the platform's campaign id
addColumn('marketing_campaigns', 'spent_synced_at TEXT');
// Per-company ad-platform credentials (user-entered in Settings → Integrations)
addColumn('company_integrations', 'meta_access_token TEXT');
addColumn('company_integrations', 'meta_ad_account_id TEXT');
addColumn('company_integrations', 'tiktok_access_token TEXT');
addColumn('company_integrations', 'tiktok_advertiser_id TEXT');
addColumn('company_integrations', 'ads_synced_at TEXT');

// ── Performance: indexes on the ownership columns used by EVERY isolation-scoped
// query (buildWhere in routes/data.js) and by import's phone-dedupe lookup. These
// were missing before — harmless at a few hundred rows, but the difference between
// an index scan and a full table scan starts to matter as a company's data grows
// into the thousands+ of rows. Safe/additive; CREATE INDEX IF NOT EXISTS is a no-op
// if already applied on a prior boot.
for (const stmt of [
  `CREATE INDEX IF NOT EXISTS leads_agent_idx        ON leads(agent_id)`,
  `CREATE INDEX IF NOT EXISTS leads_created_by_idx   ON leads(created_by_id)`,
  `CREATE INDEX IF NOT EXISTS leads_phone_idx         ON leads(company_id, phone)`,
  `CREATE INDEX IF NOT EXISTS clients_agent_idx       ON clients(primary_agent_id)`,
  `CREATE INDEX IF NOT EXISTS clients_created_by_idx  ON clients(created_by_id)`,
  `CREATE INDEX IF NOT EXISTS deals_buyer_agent_idx   ON deals(buyer_agent_id)`,
  `CREATE INDEX IF NOT EXISTS deals_seller_agent_idx  ON deals(seller_agent_id)`,
  `CREATE INDEX IF NOT EXISTS listings_agent_idx      ON listings(agent_id)`,
  `CREATE INDEX IF NOT EXISTS listings_created_by_idx ON listings(created_by_id)`,
  `CREATE INDEX IF NOT EXISTS users_last_seen_idx     ON users(last_seen_at)`,
]) { try { db.exec(stmt); } catch (e) { console.error('[db] index:', e.message); } }

const SCHEMA_CACHE = {};
for (const t of TABLES) SCHEMA_CACHE[t] = columnsOf(t);

module.exports = { db, DB_PATH, TABLES, TENANT_TABLES, SENSITIVE_COLUMNS, SCHEMA_CACHE, genExtensionKey };
