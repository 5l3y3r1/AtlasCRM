'use strict';
/**
 * db.js — SQLite schema aligned to the frontend's exact column expectations.
 *
 * Uses node:sqlite (built-in to Node 22+).
 */
const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'warm.db');
const db = new DatabaseSync(DB_PATH);

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

CREATE TABLE IF NOT EXISTS sessions (
  token        TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at   TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);
`;

db.exec(SCHEMA);

const TABLES = [
  'companies', 'users', 'leads', 'clients', 'listings', 'property_images',
  'deals', 'tasks', 'showings', 'financial_transactions', 'commission_records',
  'contracts', 'contract_templates', 'deal_documents', 'marketing_campaigns',
  'notifications', 'agent_hunting_profiles', 'external_listings',
  'property_alerts'
];

const TENANT_TABLES = new Set([
  'leads', 'clients', 'listings', 'deals', 'tasks', 'showings',
  'financial_transactions', 'commission_records', 'contracts',
  'contract_templates', 'marketing_campaigns', 'users', 'companies'
]);

const SENSITIVE_COLUMNS = { users: ['password_hash'] };

function columnsOf(table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map(r => r.name);
}
const SCHEMA_CACHE = {};
for (const t of TABLES) SCHEMA_CACHE[t] = columnsOf(t);

module.exports = { db, TABLES, TENANT_TABLES, SENSITIVE_COLUMNS, SCHEMA_CACHE };
