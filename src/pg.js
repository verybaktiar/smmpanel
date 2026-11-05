'use strict';
// Lapisan PostgreSQL (STEP 2). Pool dari .env (PGHOST/PGPORT/PGDATABASE/PGUSER/PGPASSWORD).
// sql.js tetap hidup sebagai production sampai migrasi diverifikasi penuh.
const { Pool } = require('pg');

function cfg() {
  return {
    host: process.env.PGHOST || '127.0.0.1',
    port: Number(process.env.PGPORT || 5432),
    database: process.env.PGDATABASE || 'smmpanel',
    user: process.env.PGUSER || 'postgres',
    password: process.env.PGPASSWORD || '',
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 8000,
  };
}

let pool = null;
function getPool() {
  if (!pool) pool = new Pool(cfg());
  return pool;
}

async function query(text, params) {
  return getPool().query(text, params);
}

async function ping() {
  const r = await query('SELECT version() AS v, current_database() AS db');
  return r.rows[0];
}

// DDL adaptasi SQLite -> PostgreSQL (AUTOINCREMENT -> IDENTITY, datetime -> TIMESTAMPTZ teks tetap TEXT agar kompatibel baca/tulis kode lama).
const DDL = `
CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  password_enc TEXT NOT NULL,
  user_agent TEXT,
  viewport TEXT DEFAULT '1280x720',
  locale TEXT DEFAULT 'id-ID',
  timezone TEXT DEFAULT 'Asia/Jakarta',
  proxy TEXT,
  browser_profile_dir TEXT,
  status TEXT DEFAULT 'inactive',
  platform TEXT DEFAULT 'fb',
  created_at TEXT DEFAULT (now()::text),
  last_health_check TEXT,
  auto_created INTEGER DEFAULT 0,
  cookies_json TEXT,
  health_status TEXT DEFAULT 'unknown',
  last_login TEXT
);
CREATE TABLE IF NOT EXISTS contents (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  text TEXT NOT NULL,
  media_path TEXT,
  created_at TEXT DEFAULT (now()::text)
);
CREATE TABLE IF NOT EXISTS schedules (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  content_id INTEGER NOT NULL REFERENCES contents(id),
  scheduled_at TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  posted_at TEXT,
  repeat TEXT DEFAULT 'none',
  created_at TEXT DEFAULT (now()::text)
);
CREATE TABLE IF NOT EXISTS post_log (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  content_id INTEGER,
  schedule_id INTEGER,
  status TEXT,
  message TEXT,
  content_text TEXT,
  created_at TEXT DEFAULT (now()::text)
);
CREATE TABLE IF NOT EXISTS like_jobs (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  name TEXT NOT NULL,
  post_url TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  last_run_at TEXT,
  created_at TEXT DEFAULT (now()::text)
);
CREATE TABLE IF NOT EXISTS smm_like_orders (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name TEXT NOT NULL,
  post_url TEXT NOT NULL,
  target_likes INTEGER NOT NULL,
  completed_likes INTEGER DEFAULT 0,
  status TEXT DEFAULT 'pending',
  platform TEXT DEFAULT 'fb',
  created_at TEXT DEFAULT (now()::text),
  completed_at TEXT,
  paused_at TEXT,
  cancelled_at TEXT,
  scheduled_at TEXT,
  quantity INTEGER
);
CREATE TABLE IF NOT EXISTS smm_like_executions (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES smm_like_orders(id),
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  status TEXT DEFAULT 'pending',
  executed_at TEXT,
  error_message TEXT,
  retry_count INTEGER DEFAULT 0,
  target_url TEXT
);
CREATE TABLE IF NOT EXISTS ig_like_jobs (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  name TEXT NOT NULL,
  post_url TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  last_run_at TEXT,
  created_at TEXT DEFAULT (now()::text)
);
CREATE TABLE IF NOT EXISTS proxies (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  value TEXT NOT NULL UNIQUE,
  status TEXT DEFAULT 'unused',
  created_at TEXT DEFAULT (now()::text),
  response_time INTEGER,
  last_tested_at TEXT
);
CREATE TABLE IF NOT EXISTS warming_accounts (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id INTEGER NOT NULL UNIQUE REFERENCES accounts(id) ON DELETE CASCADE,
  current_stage TEXT DEFAULT 'stage1',
  stage_started_at TEXT DEFAULT (now()::text),
  total_days INTEGER DEFAULT 0,
  last_action_at TEXT,
  actions_today TEXT DEFAULT '{}',
  created_at TEXT DEFAULT (now()::text)
);
CREATE TABLE IF NOT EXISTS warming_activity_logs (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  action_type TEXT NOT NULL,
  status TEXT NOT NULL,
  message TEXT,
  created_at TEXT DEFAULT (now()::text)
);
CREATE INDEX IF NOT EXISTS idx_schedules_status ON schedules(status);
CREATE INDEX IF NOT EXISTS idx_schedules_scheduled_at ON schedules(scheduled_at);
CREATE INDEX IF NOT EXISTS idx_smm_orders_status ON smm_like_orders(status);
CREATE INDEX IF NOT EXISTS idx_smm_executions_order_status ON smm_like_executions(order_id, status);
CREATE INDEX IF NOT EXISTS idx_smm_executions_account ON smm_like_executions(account_id);
CREATE INDEX IF NOT EXISTS idx_post_log_created_at ON post_log(created_at);
CREATE INDEX IF NOT EXISTS idx_accounts_status ON accounts(status);
CREATE INDEX IF NOT EXISTS idx_accounts_platform ON accounts(platform);
`;

async function migrateSchema() {
  await query(DDL);
}

module.exports = { getPool, query, ping, migrateSchema, DDL };
