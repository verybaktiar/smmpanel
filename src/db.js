'use strict';

// Memakai sql.js (SQLite via WebAssembly) — berjalan di Node 18+ TANPA kompilasi native,
// sehingga tidak ada crash ABI (napi_get_last_error_info) ataupun ERR_UNKNOWN_BUILTIN_MODULE.
// DB diekspor & disimpan ke file setiap kali ada perubahan (WASM tidak persist otomatis).

const fs = require('fs');
const path = require('path');
const loadSqlModule = require('sql.js').default;
const crypto = require('./crypto');

const SQL_JS_DIR = path.dirname(require.resolve('sql.js'));
const WASM_BINARY = path.join(SQL_JS_DIR, 'sql-wasm.wasm');
const DB_FILE = process.env.DB_PATH || path.join(__dirname, '..', 'database.db');

let SQL = null;
let db = null;
let readyPromise = null;

async function load() {
  if (db) return;
  const wasmBinary = fs.readFileSync(WASM_BINARY);
  SQL = await loadSqlModule({ wasmBinary });
  db = fs.existsSync(DB_FILE)
    ? new SQL.Database(fs.readFileSync(DB_FILE))
    : new SQL.Database();

  db.run(`
    CREATE TABLE IF NOT EXISTS accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
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
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS contents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      text TEXT NOT NULL,
      media_path TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS schedules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL REFERENCES accounts(id),
      content_id INTEGER NOT NULL REFERENCES contents(id),
      scheduled_at TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      posted_at TEXT,
      repeat TEXT DEFAULT 'none',
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS post_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL REFERENCES accounts(id),
      content_id INTEGER,
      schedule_id INTEGER,
      status TEXT,
      message TEXT,
      content_text TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS like_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL REFERENCES accounts(id),
      name TEXT NOT NULL,
      post_url TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      last_run_at TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- Riwayat exit IP per akun (diprobe via proxy saat browser dibuka/dilogin ulang).
    -- Tujuan: monitoring konsistensi IP & lokasi per akun farm.
    CREATE TABLE IF NOT EXISTS ip_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL REFERENCES accounts(id),
      ip TEXT,
      country TEXT,
      country_code TEXT,
      city TEXT,
      asn TEXT,
      source TEXT DEFAULT 'open',
      ok INTEGER DEFAULT 1,
      error TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- Pool Gmail fresh untuk AutoCreate (hasil Gmail Creator Pro atau impor
    -- manual). Password terenkripsi format crypto.js. Dipakai lewat /api/gmail/claim.
    CREATE TABLE IF NOT EXISTS gmail_pool (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      password_enc TEXT NOT NULL,
      status TEXT DEFAULT 'available',
      source TEXT DEFAULT 'manual',
      used_at TEXT,
      used_by TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS smm_like_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      post_url TEXT NOT NULL,
      target_likes INTEGER NOT NULL,
      completed_likes INTEGER DEFAULT 0,
      status TEXT DEFAULT 'pending',
      platform TEXT DEFAULT 'fb',
      created_at TEXT DEFAULT (datetime('now')),
      completed_at TEXT,
      paused_at TEXT,
      cancelled_at TEXT
    );

    CREATE TABLE IF NOT EXISTS smm_like_executions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL REFERENCES smm_like_orders(id),
      account_id INTEGER NOT NULL REFERENCES accounts(id),
      status TEXT DEFAULT 'pending',
      executed_at TEXT,
      error_message TEXT,
      retry_count INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS ig_like_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL REFERENCES accounts(id),
      name TEXT NOT NULL,
      post_url TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      last_run_at TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS engagement_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL REFERENCES accounts(id),
      action TEXT NOT NULL,
      target_url TEXT,
      target_user TEXT,
      comment_text TEXT,
      status TEXT NOT NULL,
      message TEXT,
      batch_id TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS proxies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      value TEXT NOT NULL UNIQUE,
      status TEXT DEFAULT 'unused',
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS warming_accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL UNIQUE,
      current_stage TEXT DEFAULT 'stage1',
      stage_started_at TEXT DEFAULT (datetime('now')),
      total_days INTEGER DEFAULT 0,
      last_action_at TEXT,
      actions_today TEXT DEFAULT '{}',
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS probe_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ip TEXT NOT NULL,
      proxy TEXT,
      verdict TEXT NOT NULL,
      challenge TEXT,
      reason TEXT,
      email TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS phone_health_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      proxy TEXT NOT NULL,
      label TEXT,
      alive INTEGER NOT NULL DEFAULT 0,
      latency_ms INTEGER,
      exit_ip TEXT,
      prev_ip TEXT,
      ip_changed INTEGER DEFAULT 0,
      tiktok_ok INTEGER,
      ig_ok INTEGER,
      fb_ok INTEGER,
      error TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_phone_health_proxy ON phone_health_log(proxy, created_at);

    CREATE TABLE IF NOT EXISTS signup_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ip TEXT NOT NULL,
      platform TEXT DEFAULT 'ig',
      username TEXT,
      status TEXT NOT NULL,
      proxy TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS warming_activity_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL,
      action_type TEXT NOT NULL,
      status TEXT NOT NULL,
      message TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS account_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL,
      platform TEXT NOT NULL,
      event TEXT NOT NULL,
      reason TEXT,
      source TEXT,
      url TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS gmail_login_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      gmail_id INTEGER NOT NULL,
      mode TEXT,
      result TEXT,
      detail TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS smm_comment_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      post_url TEXT NOT NULL,
      target_comments INTEGER NOT NULL,
      completed_comments INTEGER DEFAULT 0,
      comment_text TEXT,
      status TEXT DEFAULT 'pending',
      platform TEXT DEFAULT 'fb',
      created_at TEXT DEFAULT (datetime('now')),
      completed_at TEXT,
      cancelled_at TEXT,
      ai_context INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS smm_comment_executions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL REFERENCES smm_comment_orders(id),
      account_id INTEGER NOT NULL REFERENCES accounts(id),
      status TEXT DEFAULT 'pending',
      comment_text TEXT,
      executed_at TEXT,
      error_message TEXT,
      retry_count INTEGER DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_cmt_executions_order_status ON smm_comment_executions(order_id, status);

    CREATE TABLE IF NOT EXISTS analytics_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type TEXT NOT NULL,
      entity_type TEXT,
      entity_id INTEGER,
      account_id INTEGER REFERENCES accounts(id),
      metadata TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_analytics_type_date ON analytics_events(event_type, created_at);

    CREATE TABLE IF NOT EXISTS error_recovery_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_type TEXT NOT NULL,
      entity_id INTEGER NOT NULL,
      action TEXT NOT NULL,
      retry_count INTEGER DEFAULT 0,
      max_retries INTEGER DEFAULT 3,
      next_retry_at TEXT,
      status TEXT DEFAULT 'pending',
      created_at TEXT DEFAULT (datetime('now')),
      last_error TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_error_recovery_status ON error_recovery_queue(status, next_retry_at);

    CREATE TABLE IF NOT EXISTS health_check_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL REFERENCES accounts(id),
      check_type TEXT NOT NULL,
      status TEXT NOT NULL,
      checked_at TEXT DEFAULT (datetime('now')),
      error_message TEXT,
      response_time INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_health_check_account ON health_check_history(account_id);
    CREATE INDEX IF NOT EXISTS idx_health_check_date ON health_check_history(checked_at);
  `);

  db.run('PRAGMA foreign_keys = ON');

  // Migrasi ringan: pastikan kolom `platform` ada (utk DB lama).
  const cols = query(`PRAGMA table_info(accounts)`).map((c) => c.name);
  if (!cols.includes('platform')) {
    db.run(`ALTER TABLE accounts ADD COLUMN platform TEXT DEFAULT 'fb'`);
  }
  // Migrasi: kolom content_text di post_log.
  const pcols = query(`PRAGMA table_info(post_log)`).map((c) => c.name);
  if (!pcols.includes('content_text')) {
    db.run(`ALTER TABLE post_log ADD COLUMN content_text TEXT`);
  }
  // Migrasi: kolom media_path di contents.
  const ccols = query(`PRAGMA table_info(contents)`).map((c) => c.name);
  if (!ccols.includes('media_path')) {
    db.run(`ALTER TABLE contents ADD COLUMN media_path TEXT`);
  }
  // Migrasi: kolom repeat di schedules.
  const scols = query(`PRAGMA table_info(schedules)`).map((c) => c.name);
  if (!scols.includes('repeat')) {
    db.run(`ALTER TABLE schedules ADD COLUMN repeat TEXT DEFAULT 'none'`);
  }
  // Migrasi: kolom email_domain di signup_history (guard upaya per domain —
  // TikTok men-throttle per domain email, bukan hanya per IP).
  const shcols = query(`PRAGMA table_info(signup_history)`).map((c) => c.name);
  if (!shcols.includes('email_domain')) {
    db.run(`ALTER TABLE signup_history ADD COLUMN email_domain TEXT`);
  }

  // Migrasi: tambah kolom scheduled_at untuk smm_like_orders
  const smm_cols = query(`PRAGMA table_info(smm_like_orders)`).map((c) => c.name);
  if (!smm_cols.includes('scheduled_at')) {
    db.run(`ALTER TABLE smm_like_orders ADD COLUMN scheduled_at TEXT`);
  }
  
  // Migrasi: tambah kolom quantity untuk backward compatibility
  if (!smm_cols.includes('quantity')) {
    db.run(`ALTER TABLE smm_like_orders ADD COLUMN quantity INTEGER`);
    // Update existing records
    db.run(`UPDATE smm_like_orders SET quantity = target_likes WHERE quantity IS NULL`);
  }

  // Migrasi: tambah kolom target_url di smm_like_executions
  const exec_cols = query(`PRAGMA table_info(smm_like_executions)`).map((c) => c.name);
  if (!exec_cols.includes('target_url')) {
    db.run(`ALTER TABLE smm_like_executions ADD COLUMN target_url TEXT`);
    // Copy post_url dari parent order untuk existing records
    db.run(`
      UPDATE smm_like_executions 
      SET target_url = (SELECT post_url FROM smm_like_orders WHERE id = smm_like_executions.order_id)
      WHERE target_url IS NULL
    `);
  }

  // Migrasi: tambah kolom last_health_check di accounts
  if (!cols.includes('last_health_check')) {
    db.run(`ALTER TABLE accounts ADD COLUMN last_health_check TEXT`);
  }
  
  // Migrasi: tambah kolom auto_created untuk tracking auto-created accounts
  if (!cols.includes('auto_created')) {
    db.run(`ALTER TABLE accounts ADD COLUMN auto_created INTEGER DEFAULT 0`);
  }
  
  // Migrasi: tambah kolom cookies_json untuk menyimpan session cookies
  if (!cols.includes('cookies_json')) {
    db.run(`ALTER TABLE accounts ADD COLUMN cookies_json TEXT`);
  }
  if (!cols.includes('health_status')) {
    db.run(`ALTER TABLE accounts ADD COLUMN health_status TEXT DEFAULT 'unknown'`);
  }
  if (!cols.includes('last_login')) {
    db.run(`ALTER TABLE accounts ADD COLUMN last_login TEXT`);
  }

  // Migrasi: tambah kolom response_time di proxies untuk tracking performance
  const proxy_cols = query(`PRAGMA table_info(proxies)`).map((c) => c.name);
  if (!proxy_cols.includes('response_time')) {
    db.run(`ALTER TABLE proxies ADD COLUMN response_time INTEGER`);
  }
  if (!proxy_cols.includes('last_tested_at')) {
    db.run(`ALTER TABLE proxies ADD COLUMN last_tested_at TEXT`);
  }
  // Migrasi: kolom label & source — menandai asal proxy (mis. 'phone' = pool HP
  // dari proxies-pool.txt) agar sync pool tidak menghapus proxy manual user.
  if (!proxy_cols.includes('label')) {
    db.run(`ALTER TABLE proxies ADD COLUMN label TEXT`);
  }
  if (!proxy_cols.includes('source')) {
    db.run(`ALTER TABLE proxies ADD COLUMN source TEXT`);
  }

  // Migrasi: kolom sesi, sidik jari, dan TOTP di accounts — dipakai login & cek kode 2FA.
  const tambah = (tabel, kolom, tipe) => {
    const ada = query(`PRAGMA table_info(${tabel})`).map((c) => c.name);
    if (!ada.includes(kolom)) db.run(`ALTER TABLE ${tabel} ADD COLUMN ${kolom} ${tipe}`);
  };
  tambah('accounts', 'session_created_at', 'TEXT');
  tambah('accounts', 'session_expires_at', 'TEXT');
  tambah('accounts', 'last_activity_at', 'TEXT');
  tambah('accounts', 'fingerprint_json', 'TEXT');
  tambah('accounts', 'totp_secret_enc', 'TEXT');
  tambah('accounts', 'totp_locked', 'INTEGER DEFAULT 0');
  // Migrasi: status & TOTP di pool Gmail supaya login ulang tidak perlu isi kode manual.
  tambah('gmail_pool', 'totp_secret_enc', 'TEXT');
  tambah('gmail_pool', 'totp_locked', 'INTEGER DEFAULT 0');
  tambah('gmail_pool', 'login_status', 'TEXT');
  tambah('gmail_pool', 'login_at', 'TEXT');
  // Migrasi: alasan gagal & jenis challenge dicatat per percobaan signup.
  tambah('signup_history', 'fail_reason', 'TEXT');
  tambah('signup_history', 'challenge', 'TEXT');
  // Migrasi: penanda akun warming yang menunggu persetujuan operator.
  tambah('warming_accounts', 'needs_approval', 'INTEGER DEFAULT 0');

  // Create indexes untuk optimasi query performance
  try {
    db.run(`CREATE INDEX IF NOT EXISTS idx_schedules_status ON schedules(status)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_schedules_scheduled_at ON schedules(scheduled_at)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_smm_orders_status ON smm_like_orders(status)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_smm_executions_order_status ON smm_like_executions(order_id, status)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_smm_executions_account ON smm_like_executions(account_id)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_post_log_created_at ON post_log(created_at)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_accounts_status ON accounts(status)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_accounts_platform ON accounts(platform)`);
  } catch (e) {
    // Indexes already exist, ignore
  }

  save();
}

function waitReady() {
  if (!readyPromise) readyPromise = load();
  return readyPromise;
}

function save() {
  if (!db) return;
  fs.writeFileSync(DB_FILE, Buffer.from(db.export()));
  for (const suffix of ['-wal', '-shm']) {
    const p = DB_FILE + suffix;
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
}

// ==== API (semua async) ====

async function addAccount({ name, email, password, userAgent, viewport, locale, timezone, proxy, platform }) {
  await waitReady();
  const dir = path.join(__dirname, '..', 'sessions', name);
  const s = (v) => (v === undefined || v === null ? null : v);
  db.run(
    `INSERT INTO accounts (name, email, password_enc, user_agent, viewport, locale, timezone, proxy, browser_profile_dir, platform)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [name, email, crypto.encrypt(password), s(userAgent), s(viewport), s(locale), s(timezone), s(proxy), dir, s(platform) || 'fb']
  );
  const id = lastInsertId();
  save();
  return id;
}

async function listAccounts() {
  await waitReady();
  return query(`SELECT id, name, email, user_agent, viewport, locale, timezone, proxy, status, platform, last_login FROM accounts ORDER BY platform, id DESC`);
}

async function getAccountByName(name) {
  await waitReady();
  const row = query(`SELECT * FROM accounts WHERE name = ?`, [name])[0];
  return row || null;
}

async function getAccountById(id) {
  await waitReady();
  const row = query(`SELECT * FROM accounts WHERE id = ?`, [id])[0];
  return row || null;
}

async function setAccountStatus(id, status) {
  await waitReady();
  db.run(`UPDATE accounts SET status = ? WHERE id = ?`, [status, id]);
  save();
}

async function setAccountPlatform(id, platform) {
  await waitReady();
  db.run(`UPDATE accounts SET platform = ? WHERE id = ?`, [platform, id]);
  save();
}

async function setAccountLastLogin(id) {
  await waitReady();
  db.run(`UPDATE accounts SET last_login = datetime('now') WHERE id = ?`, [id]);
  save();
}

async function getAccountStats() {
  await waitReady();
  const total = query(`SELECT COUNT(*) as count FROM accounts`)[0].count;
  const active = query(`SELECT COUNT(*) as count FROM accounts WHERE status = 'active'`)[0].count;
  const checkpoint = query(`SELECT COUNT(*) as count FROM accounts WHERE status = 'checkpoint'`)[0].count;
  const inactive = query(`SELECT COUNT(*) as count FROM accounts WHERE status = 'inactive'`)[0].count;
  const neverLoggedIn = query(`SELECT COUNT(*) as count FROM accounts WHERE last_login IS NULL`)[0].count;
  return { total, active, checkpoint, inactive, neverLoggedIn };
}

async function updateAccountPassword(id, newPassword) {
  await waitReady();
  db.run(`UPDATE accounts SET password_enc = ? WHERE id = ?`, [crypto.encrypt(newPassword), id]);
  save();
}

// Hapus akun beserta dependen (post_log, schedules, contents) dan folder profil browser.
async function deleteAccount(id) {
  await waitReady();
  const account = query(`SELECT * FROM accounts WHERE id = ?`, [id])[0];
  db.run(`DELETE FROM post_log WHERE account_id = ?`, [id]);
  db.run(`DELETE FROM schedules WHERE account_id = ?`, [id]);
  db.run(`DELETE FROM contents WHERE id NOT IN (SELECT DISTINCT content_id FROM schedules)`);
  db.run(`DELETE FROM accounts WHERE id = ?`, [id]);
  if (account && account.browser_profile_dir) {
    try { require('fs').rmSync(account.browser_profile_dir, { recursive: true, force: true }); } catch (e) {}
  }
  save();
  return account || null;
}

async function addContent(text, mediaPath) {
  await waitReady();
  db.run(`INSERT INTO contents (text, media_path) VALUES (?, ?)`, [text, mediaPath || null]);
  const id = lastInsertId();
  save();
  return id;
}

async function addSchedule(accountId, contentId, scheduledAt, repeat = 'none') {
  await waitReady();
  db.run(`INSERT INTO schedules (account_id, content_id, scheduled_at, repeat) VALUES (?, ?, ?, ?)`, [accountId, contentId, scheduledAt, repeat]);
  const id = lastInsertId();
  save();
  return id;
}

// Jadwalkan ulang schedule berulang ke next occurrence. Kembalikan true jika dibuat.
async function reschedule(id, nextScheduledAt) {
  await waitReady();
  db.run(`UPDATE schedules SET scheduled_at = ?, status = 'pending', posted_at = NULL WHERE id = ?`, [nextScheduledAt, id]);
  save();
}

async function deleteSchedule(id) {
  await waitReady();
  const schedule = query(`SELECT * FROM schedules WHERE id = ?`, [id])[0];
  if (!schedule) return null;
  db.run(`DELETE FROM schedules WHERE id = ?`, [id]);
  // Hapus content jika tidak dipakai schedule lain
  db.run(`DELETE FROM contents WHERE id NOT IN (SELECT DISTINCT content_id FROM schedules)`);
  save();
  return schedule;
}

async function getDueSchedules(nowIso) {
  await waitReady();
  return query(`
    SELECT s.*, a.name AS account_name, c.text AS content_text, c.media_path AS media_path
    FROM schedules s
    JOIN accounts a ON a.id = s.account_id
    JOIN contents c ON c.id = s.content_id
    WHERE s.status = 'pending' AND s.scheduled_at <= ?
    ORDER BY s.scheduled_at ASC
  `, [nowIso]);
}

async function setScheduleStatus(id, status) {
  await waitReady();
  db.run(`UPDATE schedules SET status = ?, posted_at = ? WHERE id = ?`,
    [status, status === 'done' ? new Date().toISOString() : null, id]);
  save();
}

async function claimSchedule(id) {
  await waitReady();
  db.run(`UPDATE schedules SET status = 'processing' WHERE id = ? AND status = 'pending'`, [id]);
  const claimed = query(`SELECT id FROM schedules WHERE id = ? AND status = 'processing'`, [id]).length > 0;
  save();
  return claimed;
}

async function logPost({ accountId, contentId, scheduleId, status, message, contentText }) {
  await waitReady();
  const s = (v) => (v === undefined ? null : v);
  db.run(`INSERT INTO post_log (account_id, content_id, schedule_id, status, message, content_text) VALUES (?,?,?,?,?,?)`,
    [accountId, s(contentId), s(scheduleId), s(status), s(message), s(contentText)]);
  save();
}

// ---- engagement_log (komentar/DM/story otomatis) ----
// Satu baris per aksi per akun; batch menulis beberapa baris dengan batch_id sama.
async function logEngagement({ accountId, action, targetUrl, targetUser, commentText, status, message, batchId }) {
  await waitReady();
  const s = (v) => (v === undefined || v === null ? null : String(v).slice(0, 1000));
  db.run(
    `INSERT INTO engagement_log (account_id, action, target_url, target_user, comment_text, status, message, batch_id)
     VALUES (?,?,?,?,?,?,?,?)`,
    [accountId, action, s(targetUrl), s(targetUser), s(commentText), status, s(message), batchId ? String(batchId) : null]
  );
  save();
}

// Daftar log engagement terbaru (untuk History): nama akun + platform disertakan.
async function listEngagementLog({ limit = 100, accountId = null, action = null } = {}) {
  await waitReady();
  let sql = `SELECT e.id, e.action, e.target_url, e.target_user, e.comment_text, e.status, e.message, e.batch_id, e.created_at,
      a.name AS account, a.platform
    FROM engagement_log e JOIN accounts a ON a.id = e.account_id WHERE 1=1`;
  const params = [];
  if (accountId) { sql += ' AND e.account_id = ?'; params.push(accountId); }
  if (action) { sql += ' AND e.action = ?'; params.push(action); }
  sql += ' ORDER BY e.id DESC LIMIT ?';
  params.push(Number(limit) || 100);
  return query(sql, params);
}

// Query bebas untuk server/dashboard (return array objek)
async function rawAll(sql, params = []) {
  await waitReady();
  return query(sql, params);
}

// ---- like_jobs ----
async function addLikeJob({ accountId, name, postUrl }) {
  await waitReady();
  db.run(`INSERT INTO like_jobs (account_id, name, post_url) VALUES (?, ?, ?)`, [accountId, name, postUrl]);
  const id = lastInsertId();
  save();
  return id;
}

async function listLikeJobs() {
  await waitReady();
  return query(`
    SELECT l.*, a.name AS account_name
    FROM like_jobs l JOIN accounts a ON a.id = l.account_id
    ORDER BY l.created_at DESC
  `);
}

async function deleteLikeJob(id) {
  await waitReady();
  db.run(`DELETE FROM like_jobs WHERE id = ?`, [id]);
  save();
}

// ---- probe_history (riwayat tes kelayakan IP signup IG) ----
async function addProbeHistory({ ip, proxy, verdict, challenge, reason, email }) {
  await waitReady();
  db.run(
    `INSERT INTO probe_history (ip, proxy, verdict, challenge, reason, email) VALUES (?, ?, ?, ?, ?, ?)`,
    [ip || null, proxy || null, verdict || 'ragu', challenge || null, reason || null, email || null]
  );
  save();
}

// Skor kelayakan per IP: total probe, verdict terakhir, waktu tes terakhir.
// Skor = persentase probe 'layak' (bobot 100) + 'ragu' (30) — dicurigai 0.
async function getProbeScores(limit = 50) {
  await waitReady();
  const rows = query(`
    SELECT ip, MAX(id) AS last_id,
      COUNT(*) AS total,
      SUM(CASE WHEN verdict = 'layak' THEN 1 ELSE 0 END) AS layak,
      SUM(CASE WHEN verdict = 'ragu' THEN 1 ELSE 0 END) AS ragu,
      SUM(CASE WHEN verdict = 'dicurigai' THEN 1 ELSE 0 END) AS dicurigai
    FROM probe_history
    GROUP BY ip
    ORDER BY MAX(id) DESC
    LIMIT ?
  `, [Number(limit) || 50]);
  return rows.map((r) => {
    const score = Math.round(((r.layak || 0) * 100 + (r.ragu || 0) * 30) / Math.max(1, r.total));
    return { ...r, score, layak: r.layak || 0, ragu: r.ragu || 0, dicurigai: r.dicurigai || 0 };
  });
}

// ---- phone_health_log (monitoring fleet proxy HP) ----
async function addPhoneHealthLog({ proxy, label, alive, latencyMs, exitIp, prevIp, ipChanged, tiktokOk, igOk, fbOk, error }) {
  await waitReady();
  db.run(
    `INSERT INTO phone_health_log (proxy, label, alive, latency_ms, exit_ip, prev_ip, ip_changed, tiktok_ok, ig_ok, fb_ok, error)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [proxy, label || null, alive ? 1 : 0, latencyMs ?? null, exitIp || null, prevIp || null, ipChanged ? 1 : 0, tiktokOk ?? null, igOk ?? null, fbOk ?? null, error || null]
  );
  save();
}

// Riwayat cek terbaru (opsional per proxy) untuk tabel monitoring di dashboard.
async function listPhoneHealth({ limit = 100, proxy = null } = {}) {
  await waitReady();
  let sql = `SELECT * FROM phone_health_log`;
  const params = [];
  if (proxy) { sql += ` WHERE proxy = ?`; params.push(proxy); }
  sql += ` ORDER BY id DESC LIMIT ?`;
  params.push(Number(limit) || 100);
  return query(sql, params);
}

// Statistik per HP: uptime %, latensi rata-rata, berapa kali ganti IP, cek terakhir.
// Window 7 hari — cukup untuk pola kesehatan tanpa membebani DB.
async function phoneHealthStats() {
  await waitReady();
  return query(`
    SELECT proxy,
      MAX(label) AS label,
      COUNT(*) AS checks,
      SUM(alive) AS alive_checks,
      ROUND(100.0 * SUM(alive) / MAX(1, COUNT(*)), 1) AS uptime_pct,
      CAST(ROUND(AVG(CASE WHEN alive = 1 THEN latency_ms END)) AS INTEGER) AS avg_latency,
      SUM(ip_changed) AS ip_changes,
      SUM(tiktok_ok) AS tiktok_ok,
      MAX(exit_ip) AS last_ip,
      MAX(created_at) AS last_check
    FROM phone_health_log
    WHERE created_at >= datetime('now', '-7 days')
    GROUP BY proxy
    ORDER BY uptime_pct DESC
  `);
}

// Tren harian 7 hari per HP untuk grafik: uptime %, latensi rata-rata, jumlah cek,
// dan ganti IP per tanggal. Grafik digambar dari hasil agregasi ini.
async function phoneHealthTrend() {
  await waitReady();
  return query(`
    SELECT proxy,
      MAX(label) AS label,
      date(created_at) AS day,
      COUNT(*) AS checks,
      SUM(alive) AS alive_checks,
      ROUND(100.0 * SUM(alive) / MAX(1, COUNT(*)), 1) AS uptime_pct,
      CAST(ROUND(AVG(CASE WHEN alive = 1 THEN latency_ms END)) AS INTEGER) AS avg_latency,
      SUM(ip_changed) AS ip_changes
    FROM phone_health_log
    WHERE created_at >= datetime('now', '-7 days')
    GROUP BY proxy, date(created_at)
    ORDER BY proxy, day ASC
  `);
}

// ---- signup_history (IP yang sudah dipakai untuk signup — penanda jangan dipakai lagi) ----
async function addSignupHistory({ ip, platform, username, status, proxy, emailDomain, failReason, challenge }) {
  await waitReady();
  // Kolom ip NOT NULL — jalur CLI tanpa TT_BIRTH_IP menyimpan string kosong.
  db.run(
    `INSERT INTO signup_history (ip, platform, username, status, proxy, email_domain, fail_reason, challenge) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [ip || '', platform || 'ig', username || null, status || 'unknown', proxy || null, emailDomain || null, failReason ? String(failReason).slice(0, 500) : null, challenge || null]
  );
  save();
}

// ---- account_events (bukti teks platform saat checkpoint/suspend/penolakan) ----
async function addAccountEvent({ accountId, platform, event, reason, source, url }) {
  await waitReady();
  db.run(
    `INSERT INTO account_events (account_id, platform, event, reason, source, url) VALUES (?, ?, ?, ?, ?, ?)`,
    [Number(accountId) || 0, platform || 'fb', event || 'event', reason ? String(reason).slice(0, 500) : null, source || null, url || null]
  );
  save();
}

async function listAccountEvents(accountId, limit = 50) {
  await waitReady();
  return query(`SELECT * FROM account_events WHERE account_id = ? ORDER BY id DESC LIMIT ?`, [Number(accountId), limit]);
}

// Jumlah signup via satu IP dalam 24 jam terakhir (success/partial dihitung;
// failed juga dihitung karena kegagalan pun membakar reputasi IP di sisi FB).
// Identitas kamar DataImpulse dari string proxy (…sid.perm-N:…). Null bila bukan
// DataImpulse — guard kamar hanya berlaku untuk pool kamar, bukan IP asli/Bright Data.
function dataimpulseRoom(proxyStr) {
  const m = /sid\.perm-(\d+)/.exec(String(proxyStr || ''));
  return m ? `perm-${m[1]}` : null;
}

// Akun FB yang BERHASIL lahir via kamar ini dalam 24 jam — dasar guard
// "satu kamar satu kelahiran FB per hari" (pelajaran 14/10: 2 attempt + 1
// success dalam 33 menit di kamar Perm-N yang dipakai IG pagi → suspend).
function countFbSignups24hByRoom(proxyStr) {
  const room = dataimpulseRoom(proxyStr);
  if (!room) return 0;
  return query(
    `SELECT COUNT(*) as count FROM signup_history
     WHERE platform = 'fb' AND status = 'success'
       AND proxy LIKE '%sid.' || ? || ':%'
       AND created_at >= datetime('now', '-1 day')`,
    [room]
  )[0].count;
}

// Kamar ini dipakai signup platform LAIN dalam 12 jam terakhir (apa pun status)?
// Semakin baru, semakin panas reputasi backbone-nya — FB paling melar.
function otherPlatformRoomUse12h(proxyStr, platform) {
  const room = dataimpulseRoom(proxyStr);
  if (!room) return null;
  const rows = query(
    `SELECT platform, MAX(created_at) as at, COUNT(*) as n FROM signup_history
     WHERE proxy LIKE '%sid.' || ? || ':%' AND platform != ?
       AND created_at >= datetime('now', '-12 hours')
     GROUP BY platform`,
    [room, platform]
  );
  return rows.length ? rows : null;
}

function countSignups24h(ip) {
  if (!ip) return 0;
  return query(
    `SELECT COUNT(*) as count FROM signup_history WHERE ip = ? AND created_at >= datetime('now', '-1 day')`,
    [ip]
  )[0].count;
}

// ---- Guard upaya per IP + per domain (pelajaran 2026-09-26: TikTok membalas
// eksplisit error_code 7 "Batas percobaan maksimum tercapai" setelah 8+ upaya dari
// 1 domain + blok IP CGNAT yang sama dalam ±2 jam. Upaya GAGAL pun membakar.) ----
// Semua upaya signup 24 jam terakhir via satu IP keluar (apa pun statusnya).
function countSignupAttempts24hByIp(ip) {
  if (!ip) return 0;
  return query(
    `SELECT COUNT(*) as count FROM signup_history WHERE ip = ? AND created_at >= datetime('now', '-1 day')`,
    [ip]
  )[0].count;
}

// Semua upaya signup 24 jam terakhir via satu domain email (kolom email_domain
// diisi saat pencatatan; baris lama tanpa kolom dihitung dari username bila
// memuat '@domain' lengkap).
function countSignupAttempts24hByDomain(domain) {
  if (!domain) return 0;
  return query(
    `SELECT COUNT(*) as count FROM signup_history
     WHERE (email_domain = ? OR username LIKE '%@' || ?)
       AND created_at >= datetime('now', '-1 day')`,
    [domain, domain]
  )[0].count;
}

// Semua upaya 24 jam via satu identitas proxy — tahan CGNAT yang memutar IP
// (blok /16 operator tetap di-skoring TikTok walau IP keluar berganti).
function countSignupAttempts24hByProxy(proxy) {
  if (!proxy) return 0;
  return query(
    `SELECT COUNT(*) as count FROM signup_history
     WHERE proxy = ? AND created_at >= datetime('now', '-1 day')`,
    [proxy]
  )[0].count;
}

// Peta IP -> riwayat signup terakhir (dipakai badge halaman Proxy).
// used=true jika IP pernah dipakai signup; burn=true jika percobaan terakhir gagal.
async function getSignupIps(limit = 500) {
  await waitReady();
  const rows = query(
    `SELECT ip, platform, username, status, created_at
     FROM (SELECT * FROM signup_history ORDER BY id DESC LIMIT ?)
     GROUP BY ip`,
    [Number(limit) || 500]
  );
  const map = {};
  for (const r of rows) {
    if (!r.ip) continue;
    const failed = ['failed', 'dicurigai', 'error', 'suspended'].includes(String(r.status).toLowerCase());
    map[r.ip] = { platform: r.platform, username: r.username, status: r.status, createdAt: r.created_at, used: true, burn: failed };
  }
  return map;
}

async function getLatestVerdicts(limit = 200) {
  await waitReady();
  return query(
    `SELECT ip, verdict, challenge, reason, created_at FROM probe_history ORDER BY id DESC LIMIT ?`,
    [Number(limit) || 200]
  );
}

// ---- ig_like_jobs ----
async function addIgLikeJob({ accountId, name, postUrl }) {
  await waitReady();
  db.run(`INSERT INTO ig_like_jobs (account_id, name, post_url) VALUES (?, ?, ?)`, [accountId, name, postUrl]);
  const id = lastInsertId();
  save();
  return id;
}

// ---- SMM Like Orders (Rotasi Akun) ----
async function createSmmLikeOrder({ name, postUrl, targetLikes, platform = 'fb' }) {
  return transaction(async () => {
    const accounts = query(
      `SELECT id FROM accounts WHERE platform = ? AND status = 'active' ORDER BY id`,
      [platform]
    );
    if (accounts.length === 0) throw new Error('Tidak ada akun aktif untuk platform ' + platform);
    if (targetLikes > accounts.length) {
      throw new Error(`Target ${targetLikes} like melebihi jumlah akun aktif (${accounts.length} akun). Setiap akun hanya bisa like 1x per postingan.`);
    }
    db.run(
      `INSERT INTO smm_like_orders (name, post_url, target_likes, platform) VALUES (?, ?, ?, ?)`,
      [name, postUrl, targetLikes, platform]
    );
    const orderId = lastInsertId();
    for (let i = 0; i < targetLikes; i++) {
      db.run(`INSERT INTO smm_like_executions (order_id, account_id) VALUES (?, ?)`, [orderId, accounts[i].id]);
    }
    return orderId;
  });
}

async function listSmmLikeOrders(status = null) {
  await waitReady();
  const where = status ? 'WHERE o.status = ?' : '';
  const params = status ? [status] : [];
  return query(`
    SELECT 
      o.*,
      COUNT(e.id) as total_executions,
      SUM(CASE WHEN e.status = 'completed' THEN 1 ELSE 0 END) as completed_count,
      SUM(CASE WHEN e.status = 'failed' THEN 1 ELSE 0 END) as failed_count
    FROM smm_like_orders o
    LEFT JOIN smm_like_executions e ON e.order_id = o.id
    ${where}
    GROUP BY o.id
    ORDER BY o.created_at DESC
  `, params);
}

async function logWarmingActivity({ accountId, actionType, status, message = null }) {
  await waitReady();
  db.run(
    `INSERT INTO warming_activity_logs (account_id, action_type, status, message)
     VALUES (?, ?, ?, ?)`,
    [accountId, actionType, status, message]
  );
  save();
}

async function getSmmLikeOrder(id) {
  await waitReady();
  const order = query(`SELECT * FROM smm_like_orders WHERE id = ?`, [id])[0];
  if (!order) return null;
  
  const executions = query(`
    SELECT e.*, a.name as account_name, a.email as account_email
    FROM smm_like_executions e
    JOIN accounts a ON a.id = e.account_id
    WHERE e.order_id = ?
    ORDER BY e.id
  `, [id]);
  
  return { ...order, executions };
}

async function updateSmmExecutionStatus(executionId, status, errorMessage = null) {
  await waitReady();
  const execution = query(`SELECT retry_count FROM smm_like_executions WHERE id = ?`, [executionId])[0];
  const retryCount = (execution?.retry_count || 0) + (status === 'failed' ? 1 : 0);
  
  db.run(
    `UPDATE smm_like_executions SET status = ?, executed_at = datetime('now'), error_message = ?, retry_count = ? WHERE id = ?`,
    [status, errorMessage, retryCount, executionId]
  );
  
  // Update order completed_likes count
  const exec = query(`SELECT order_id FROM smm_like_executions WHERE id = ?`, [executionId])[0];
  if (exec) {
    const completed = query(
      `SELECT COUNT(*) as cnt FROM smm_like_executions WHERE order_id = ? AND status = 'completed'`,
      [exec.order_id]
    )[0].cnt;
    
    const order = query(`SELECT target_likes FROM smm_like_orders WHERE id = ?`, [exec.order_id])[0];
    
    const nextStatus = completed >= order.target_likes ? 'completed' : 'running';
    db.run(
      `UPDATE smm_like_orders SET completed_likes = ?, status = ?, completed_at = CASE WHEN ? >= target_likes THEN datetime('now') ELSE NULL END WHERE id = ?`,
      [completed, nextStatus, completed, exec.order_id]
    );
  }
  
  save();
}

async function pauseSmmLikeOrder(id) {
  await waitReady();
  db.run(`UPDATE smm_like_orders SET status = 'paused', paused_at = datetime('now') WHERE id = ?`, [id]);
  save();
}

async function resumeSmmLikeOrder(id) {
  await waitReady();
  const order = query(`SELECT completed_likes, target_likes FROM smm_like_orders WHERE id = ?`, [id])[0];
  const newStatus = order.completed_likes >= order.target_likes ? 'completed' : 'pending';
  db.run(`UPDATE smm_like_orders SET status = ?, paused_at = NULL WHERE id = ?`, [newStatus, id]);
  save();
}

async function cancelSmmLikeOrder(id) {
  await waitReady();
  db.run(`UPDATE smm_like_orders SET status = 'cancelled', cancelled_at = datetime('now') WHERE id = ?`, [id]);
  db.run(`UPDATE smm_like_executions SET status = 'cancelled' WHERE order_id = ? AND status = 'pending'`, [id]);
  save();
}

async function deleteSmmLikeOrder(id) {
  await waitReady();
  db.run(`DELETE FROM smm_like_executions WHERE order_id = ?`, [id]);
  db.run(`DELETE FROM smm_like_orders WHERE id = ?`, [id]);
  save();
}

async function getPendingSmmExecutions(orderId, limit = 10) {
  await waitReady();
  return query(`
    SELECT e.*, a.name as account_name, a.email, a.password_enc, a.browser_profile_dir, a.proxy
    FROM smm_like_executions e
    JOIN accounts a ON a.id = e.account_id
    WHERE e.order_id = ? AND e.status = 'pending'
    ORDER BY e.id
    LIMIT ?
  `, [orderId, limit]);
}

async function listIgLikeJobs() {
  await waitReady();
  return query(`
    SELECT l.*, a.name AS account_name
    FROM ig_like_jobs l JOIN accounts a ON a.id = l.account_id
    ORDER BY l.created_at DESC
  `);
}

async function deleteIgLikeJob(id) {
  await waitReady();
  db.run(`DELETE FROM ig_like_jobs WHERE id = ?`, [id]);
  save();
}

async function getIgLikeJob(id) {
  await waitReady();
  return query(`SELECT * FROM ig_like_jobs WHERE id = ?`, [id])[0] || null;
}

async function getLikeJob(id) {
  await waitReady();
  return query(`SELECT * FROM like_jobs WHERE id = ?`, [id])[0] || null;
}

// ---- SMM Comment Orders (Auto Komentar) ----
// Satu eksekusi = satu komentar dari satu akun. Akun diikat saat order dibuat
// (supaya target langsung terkunci ke jumlah akun aktif), lalu runner boleh
// memindahkannya ke akun sehat lain yang belum dipakai di order ini.
async function createSmmCommentOrder({ name, postUrl, targetComments, platform = 'fb', commentText = null, aiContext = true }) {
  return transaction(async () => {
    const accounts = query(
      `SELECT id FROM accounts WHERE platform = ? AND status = 'active' ORDER BY id`,
      [platform]
    );
    if (accounts.length === 0) throw new Error('Tidak ada akun aktif untuk platform ' + platform);
    if (targetComments > accounts.length) {
      throw new Error(`Target ${targetComments} komentar melebihi jumlah akun aktif (${accounts.length} akun). Satu akun hanya bisa komentar 1x di postingan yang sama.`);
    }
    db.run(
      `INSERT INTO smm_comment_orders (name, post_url, target_comments, platform, comment_text, ai_context) VALUES (?, ?, ?, ?, ?, ?)`,
      [name, postUrl, targetComments, platform, commentText ? String(commentText).slice(0, 1000) : null, aiContext ? 1 : 0]
    );
    const orderId = lastInsertId();
    for (let i = 0; i < targetComments; i++) {
      db.run(`INSERT INTO smm_comment_executions (order_id, account_id) VALUES (?, ?)`, [orderId, accounts[i].id]);
    }
    return orderId;
  });
}

async function listSmmCommentOrders(status = null) {
  await waitReady();
  const where = status ? 'WHERE o.status = ?' : '';
  const params = status ? [status] : [];
  return query(`
    SELECT
      o.*,
      COUNT(e.id) as total_executions,
      SUM(CASE WHEN e.status = 'completed' THEN 1 ELSE 0 END) as completed_count,
      SUM(CASE WHEN e.status = 'failed' THEN 1 ELSE 0 END) as failed_count
    FROM smm_comment_orders o
    LEFT JOIN smm_comment_executions e ON e.order_id = o.id
    ${where}
    GROUP BY o.id
    ORDER BY o.created_at DESC, o.id DESC
  `, params);
}

async function getSmmCommentOrder(id) {
  await waitReady();
  const order = query(`SELECT * FROM smm_comment_orders WHERE id = ?`, [id])[0];
  if (!order) return null;
  const executions = query(`
    SELECT e.*, a.name as account_name, a.email as account_email
    FROM smm_comment_executions e
    JOIN accounts a ON a.id = e.account_id
    WHERE e.order_id = ?
    ORDER BY e.id
  `, [id]);
  return { ...order, executions };
}

async function getPendingSmmCommentExecutions(orderId, limit = 10) {
  await waitReady();
  return query(`
    SELECT e.*, a.name as account_name, a.email, a.password_enc, a.browser_profile_dir, a.proxy, a.platform
    FROM smm_comment_executions e
    JOIN accounts a ON a.id = e.account_id
    WHERE e.order_id = ? AND e.status = 'pending'
    ORDER BY e.id
    LIMIT ?
  `, [orderId, limit]);
}

// Eksekusi bisa dipindah ke akun lain saat akun terikatnya gagal gate.
async function assignSmmCommentExecutionAccount(executionId, accountId) {
  await waitReady();
  db.run(`UPDATE smm_comment_executions SET account_id = ? WHERE id = ?`, [accountId, executionId]);
  save();
}

// Eksekusi 'running' yang tertinggal dari proses mati dikembalikan ke antrean.
async function resetRunningSmmCommentExecutions(orderId) {
  await waitReady();
  db.run(`UPDATE smm_comment_executions SET status = 'pending' WHERE order_id = ? AND status = 'running'`, [orderId]);
  save();
}

// Jalankan ulang setelah gagal: eksekusi yang gagal kembali ke antrean supaya
// akun lain bisa mencoba (mis. akun lama kena gate, bukan postingannya mati).
async function resetFailedSmmCommentExecutions(orderId) {
  await waitReady();
  db.run(`UPDATE smm_comment_executions SET status = 'pending', error_message = NULL WHERE order_id = ? AND status = 'failed'`, [orderId]);
  save();
}

async function markSmmCommentExecutionRunning(executionId) {
  await waitReady();
  db.run(`UPDATE smm_comment_executions SET status = 'running' WHERE id = ?`, [executionId]);
  save();
}

async function updateSmmCommentExecution(executionId, status, errorMessage = null, commentText = null) {
  await waitReady();
  const exec = query(`SELECT retry_count, order_id FROM smm_comment_executions WHERE id = ?`, [executionId])[0];
  if (!exec) return;
  const retryCount = (exec.retry_count || 0) + (status === 'failed' ? 1 : 0);
  db.run(
    `UPDATE smm_comment_executions
     SET status = ?, executed_at = datetime('now'), error_message = ?, retry_count = ?, comment_text = COALESCE(?, comment_text)
     WHERE id = ?`,
    [status, errorMessage, retryCount, commentText, executionId]
  );

  const completed = query(
    `SELECT COUNT(*) as cnt FROM smm_comment_executions WHERE order_id = ? AND status = 'completed'`,
    [exec.order_id]
  )[0].cnt;
  const order = query(`SELECT target_comments, status FROM smm_comment_orders WHERE id = ?`, [exec.order_id])[0];
  if (!order || order.status === 'cancelled') { save(); return; }
  const pending = query(
    `SELECT COUNT(*) as cnt FROM smm_comment_executions WHERE order_id = ? AND status IN ('pending', 'running')`,
    [exec.order_id]
  )[0].cnt;
  const nextStatus = completed >= order.target_comments ? 'completed' : pending === 0 ? 'failed' : 'running';
  db.run(
    `UPDATE smm_comment_orders
     SET completed_comments = ?, status = ?, completed_at = CASE WHEN ? >= target_comments THEN datetime('now') ELSE NULL END
     WHERE id = ?`,
    [completed, nextStatus, completed, exec.order_id]
  );
  save();
}

async function setSmmCommentOrderStatus(id, status) {
  await waitReady();
  db.run(`UPDATE smm_comment_orders SET status = ? WHERE id = ? AND status <> 'cancelled'`, [status, id]);
  save();
}

async function cancelSmmCommentOrder(id) {
  await waitReady();
  db.run(`UPDATE smm_comment_orders SET status = 'cancelled', cancelled_at = datetime('now') WHERE id = ?`, [id]);
  db.run(`UPDATE smm_comment_executions SET status = 'cancelled' WHERE order_id = ? AND status IN ('pending', 'running')`, [id]);
  save();
}

async function deleteSmmCommentOrder(id) {
  await waitReady();
  db.run(`DELETE FROM smm_comment_executions WHERE order_id = ?`, [id]);
  db.run(`DELETE FROM smm_comment_orders WHERE id = ?`, [id]);
  save();
}

// ---- proxies ----
async function addProxy(value) {
  await waitReady();
  db.run(`INSERT OR IGNORE INTO proxies (value) VALUES (?)`, [value]);
  save();
}

// Label provider (mis. "Bright Data ISP") untuk dropdown create — kolom sudah
// ada di schema, addProxy lama tidak menyimpannya (2026-10-10).
async function setProxyLabel(value, label) {
  await waitReady();
  db.run(`UPDATE proxies SET label = ? WHERE value = ?`, [String(label).slice(0, 60), String(value).trim()]);
  save();
}

// ---- Alokasi IP lahir otomatis (1 signup = 1 IP tetap) ----
const ipOfProxy = (value) => (/-ip-(\d+\.\d+\.\d+\.\d+)/i.exec(String(value || '')) || [])[1] || '';

// IP dianggap bersih hanya bila belum pernah muncul di riwayat signup, riwayat
// probe akun, maupun proxy yang sudah dipatok ke IP itu. Semua status dihitung:
// percobaan gagal ikut membakar reputasi IP.
async function countIpUses(ip) {
  await waitReady();
  if (!ip) return 0;
  const row = query(
    `SELECT
       (SELECT COUNT(*) FROM signup_history WHERE ip = ?) +
       (SELECT COUNT(*) FROM ip_history WHERE ip = ?) +
       (SELECT COUNT(*) FROM proxies WHERE value LIKE ? OR label LIKE ?) AS n`,
    [ip, ip, `%-ip-${ip}:%`, `%${ip}%`]
  )[0];
  return Number(row && row.n) || 0;
}

// Baris proxy hasil alokasi: status 'reserved' sampai akunnya lahir.
async function addAutoProxy(value, ip) {
  await waitReady();
  const label = `auto · IP ${ip}`;
  db.run(`INSERT OR IGNORE INTO proxies (value, label, source, status) VALUES (?, ?, 'auto-ip', 'reserved')`, [value, label]);
  db.run(
    `UPDATE proxies SET label = ?, source = 'auto-ip', status = 'reserved', last_tested_at = datetime('now') WHERE value = ?`,
    [label, value]
  );
  save();
  return query(`SELECT * FROM proxies WHERE value = ?`, [value])[0] || null;
}

// Ikat permanen: label memuat nama akun + IP, dan barisnya tidak dihapus saat
// akun memakai proxy ini. accounts.proxy menyimpan string yang sama.
async function bindAutoProxy(value, accountName) {
  await waitReady();
  if (!value) return;
  const ip = ipOfProxy(value);
  const label = `akun ${String(accountName || 'baru').slice(0, 40)}${ip ? ' · IP ' + ip : ''}`;
  db.run(`UPDATE proxies SET status = 'active', label = ? WHERE value = ?`, [label, value]);
  save();
}

// Run benar-benar dimulai: baris tidak boleh dianggap "alokasi menganggur" lagi,
// walau operator menghentikannya sebelum akun lahir. IP yang sudah terlihat IG
// tetap tidak dialokasikan ulang.
async function markAutoProxyAttempt(value) {
  await waitReady();
  if (!value) return;
  const ip = ipOfProxy(value);
  db.run(
    `UPDATE proxies SET label = ? WHERE value = ? AND source = 'auto-ip' AND status = 'reserved'`,
    [`upaya signup${ip ? ' · IP ' + ip : ''}`, value]
  );
  save();
}

// Signup gagal = IP sudah terbakar. Baris tetap disimpan sebagai jejak agar IP
// itu tidak pernah dialokasikan lagi.
async function burnAutoProxy(value) {
  await waitReady();
  if (!value) return;
  const ip = ipOfProxy(value);
  db.run(`UPDATE proxies SET status = 'burned', label = ? WHERE value = ?`, [`bekas signup${ip ? ' · IP ' + ip : ''}`, value]);
  save();
}

// Alokasi batal sebelum browser jalan: baris reserved boleh dibuang lagi.
async function releaseAutoProxy(value) {
  await waitReady();
  if (!value) return;
  db.run(
    `DELETE FROM proxies WHERE value = ? AND source = 'auto-ip' AND status = 'reserved'
       AND value NOT IN (SELECT proxy FROM accounts WHERE proxy IS NOT NULL)`, [value]
  );
  save();
}

// Reserved yang ditinggal SEBELUM run dimulai (server mati di tengah alokasi)
// jangan menahan IP selamanya. Baris yang sudah dipakai run tetap disimpan.
async function releaseStaleAutoProxies() {
  await waitReady();
  db.run(
    `DELETE FROM proxies WHERE source = 'auto-ip' AND status = 'reserved'
       AND label LIKE 'auto · IP %'
       AND created_at < datetime('now', '-6 hours')
       AND value NOT IN (SELECT proxy FROM accounts WHERE proxy IS NOT NULL)`, []
  );
  save();
}

async function accountsUsingProxy(value) {
  await waitReady();
  return query(`SELECT id, name, platform FROM accounts WHERE proxy = ?`, [String(value)]);
}

async function listProxies() {
  await waitReady();
  return query(`SELECT * FROM proxies ORDER BY id ASC`);
}

async function deleteProxy(id) {
  await waitReady();
  // Pelajaran 2026-10-10: guard lama menolak bila proxies.value masih ditulis
  // di accounts.proxy (AKTIF/MATI sama-sama) — tapi selalu ok:true tanpa pesan,
  // operator belum jogja tahu kenapa row tak hilang (bug diam-diam).
  // Sekarang: value masih dipakai accounts → null-kan di accounts dulu supaya
  // hapus tak memutus login lama, karena proxy table ini hanya daftar pilihan
  // dropdown — baris accounts punya proxy string sendiri yang dipakai runner.
  const row = query('SELECT value FROM proxies WHERE id = ?', [id])[0];
  if (!row) return;
  db.run('UPDATE accounts SET proxy = NULL WHERE proxy = ?', [row.value]);
  db.run('DELETE FROM proxies WHERE id = ?', [id]);
  save();
}

async function updateProxy(id, value) {
  await waitReady();
  db.run(`UPDATE proxies SET value = ? WHERE id = ?`, [value, id]);
  save();
}

async function clearProxies() {
  await waitReady();
  db.run(`DELETE FROM proxies WHERE value NOT IN (SELECT proxy FROM accounts WHERE proxy IS NOT NULL)`, []);
  save();
}

// ---- Riwayat IP per akun (monitoring konsistensi IP/lokasi) ----
// Catat satu probe. Dedupe: kalau IP sukses sama dgn baris terakhir akun ini,
// cukup perbarui created_at-nya (jadi "terakhir terlihat"), jangan tumpuk baris.
async function addIpHistory(accountId, { ip, country, country_code, city, asn, source = 'open', ok = 1, error = null } = {}) {
  await waitReady();
  if (ok && ip) {
    const last = query(`SELECT id, ip FROM ip_history WHERE account_id = ? AND ok = 1 ORDER BY id DESC LIMIT 1`, [accountId])[0];
    if (last && last.ip === ip) {
      db.run(`UPDATE ip_history SET created_at = datetime('now') WHERE id = ?`, [last.id]);
      save();
      return;
    }
  }
  db.run(`INSERT INTO ip_history (account_id, ip, country, country_code, city, asn, source, ok, error) VALUES (?,?,?,?,?,?,?,?,?)`,
    [accountId, ip || null, country || null, country_code || null, city || null, asn || null, source || 'open', ok ? 1 : 0, error || null]);
  // Prune: simpan maks 50 baris terakhir per akun.
  db.run(`DELETE FROM ip_history WHERE account_id = ? AND id NOT IN (SELECT id FROM ip_history WHERE account_id = ? ORDER BY id DESC LIMIT 50)`, [accountId, accountId]);
  save();
}

function listIpHistory(accountId, limit = 30) {
  return query(`SELECT id, ip, country, country_code, city, asn, source, ok, error, created_at FROM ip_history WHERE account_id = ? ORDER BY id DESC LIMIT ?`, [accountId, limit]);
}

// Map ringkas { account_id: { ip, country, country_code, city, created_at } } — baris sukses terakhir tiap akun.
function latestIpByAccount() {
  return query(`SELECT account_id, ip, country, country_code, city, created_at FROM ip_history
    WHERE ok = 1 AND id IN (SELECT MAX(id) FROM ip_history WHERE ok = 1 GROUP BY account_id)`);
}

async function setAccountProxy(accountId, proxyValue) {
  await waitReady();
  db.run(`UPDATE accounts SET proxy = ? WHERE id = ?`, [proxyValue || null, accountId]);
  save();
}

// Assign daftar proxy ke akun (proksi #i ke akun #i).
// overwrite=false: hanya isi akun yang belum punya proxy.
// overwrite=true : timpa proxy semua akun sesuai urutan (re-assign).
async function assignProxiesToAccounts({ overwrite = false } = {}) {
  await waitReady();
  // Proxy hasil alokasi otomatis sudah milik satu akun — jangan pernah dibagikan
  // ulang ke akun lain hanya karena urutan id. Proxy bekas signup juga dilewati.
  const taken = new Set(query(`SELECT proxy FROM accounts WHERE proxy IS NOT NULL AND proxy != ''`).map((r) => r.proxy));
  const proxs = query(`SELECT value FROM proxies WHERE COALESCE(source, '') != 'auto-ip' AND COALESCE(status, '') != 'burned' ORDER BY id`)
    .filter((p) => !taken.has(p.value));
  const accounts = query(`SELECT id FROM accounts ORDER BY id`);
  let assigned = 0;
  accounts.forEach((acc, i) => {
    if (proxs[i]) {
      if (!overwrite) {
        const cur = query(`SELECT proxy FROM accounts WHERE id=?`, [acc.id])[0].proxy;
        if (cur) return; // skip yang sudah punya
      }
      db.run(`UPDATE accounts SET proxy = ? WHERE id = ?`, [proxs[i].value, acc.id]);
      assigned++;
    }
  });
  save();
  return assigned;
}

// Pembersihan: hapus schedule & content yg status final, beserta media_path-nya.
// Kembalikan daftar file media yang bisa dihapus dari uploads/.
async function cleanupFinalized({ keepLogDays = 30 } = {}) {
  await waitReady();
  // Ambil media_path dari content yang jadwalnya sudah selesai (done/failed).
  const mediaRows = query(`
    SELECT c.media_path FROM contents c
    JOIN schedules s ON s.content_id = c.id
    WHERE s.status IN ('done','failed')
  `);
  const files = mediaRows.map(r => r.media_path).filter(Boolean);

  // Hapus schedule yg sudah final (done/failed) & > keepLogDays lama.
  db.run(`DELETE FROM schedules WHERE status IN ('done','failed') AND datetime(scheduled_at) < datetime('now', ?)`, [`-${keepLogDays} days`]);

  // Hapus content yang tidak lagi direferensi jadwal aktif (pending).
  db.run(`DELETE FROM contents WHERE id NOT IN (SELECT DISTINCT content_id FROM schedules)`);

  // Hapus log yang lebih tua dari keepLogDays.
  db.run(`DELETE FROM post_log WHERE datetime(created_at) < datetime('now', ?)`, [`-${keepLogDays} days`]);

  save();
  return files;
}

// ==== helpers ====
function query(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params || []);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}
function lastInsertId() {
  const r = query(`SELECT last_insert_rowid() AS id`)[0];
  return Math.abs(Number(r.id));
}

// Wrapper functions untuk expose db.run dan save
function run(sql, params = []) {
  if (!db) throw new Error('Database not ready');
  return db.run(sql, params);
}

function runSave() {
  save();
}

async function transaction(callback) {
  await waitReady();
  db.run('BEGIN TRANSACTION');
  try {
    const result = await callback();
    db.run('COMMIT');
    save();
    return result;
  } catch (error) {
    db.run('ROLLBACK');
    throw error;
  }
}

// ---- gmail_pool ----
// Stok Gmail fresh untuk AutoCreate. Password disimpan terenkripsi (format
// crypto.encrypt, sama dengan tabel accounts). status: available | used.
async function addGmail({ email, password, source = 'manual', totpSecret }) {
  await waitReady();
  const em = String(email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) throw new Error('email tidak valid');
  const pw = String(password || '');
  if (!pw) throw new Error('password kosong');
  // Secret tak valid menggagalkan barisnya, bukan diam-diam masuk tanpa 2FA:
  // akun belian yang secret-nya hilang jadi tak terkendali.
  const secretB32 = totpSecret ? totp.normalizeSecret(totpSecret) : null;
  if (totpSecret && !secretB32) throw new Error('secret 2FA tidak valid');
  // Dedupe email di level app (bukan hanya UNIQUE constraint): baris duplikat
  // dengan status berbeda dianggap baris yang sama. Yang menang baris TERBARU —
  // dipakai dulu (`used`) = email lama tak boleh kembali muncul `available`
  // (pelajaran 2026-10-14: duplikat 'available' + 'used' dipakai 2x sehari).
  const existing = query(`SELECT id, status FROM gmail_pool WHERE lower(email) = ?`, [em]);
  if (existing.length) {
    const newest = existing.reduce((a, b) => (Number(b.id) > Number(a.id) ? b : a));
    db.run(`UPDATE gmail_pool SET password_enc = ?, source = ?, status = ?, totp_secret_enc = COALESCE(?, totp_secret_enc) WHERE id = ?`,
      [crypto.encrypt(pw), source, String(newest.status) === 'used' ? 'used' : 'available',
       secretB32 ? crypto.encrypt(secretB32) : null, Number(newest.id)]);
    if (existing.length > 1) {
      const orphanIds = existing.filter((s) => Number(s.id) !== Number(newest.id)).map((s) => Number(s.id));
      db.run(`DELETE FROM gmail_pool WHERE id IN (${orphanIds.map(() => '?').join(',')})`, orphanIds);
      console.log('[GMAIL] dedupe: ' + em + ' — ' + (existing.length - 1) + ' baris duplikat dihapus, status memegang "' + newest.status + '" (terbaru id #' + newest.id + ')');
    }
    save();
    // Selalu balikkan id baris yang LIVE (newest): di jalur UPDATE, last_insert_rowid()
    // memegang nilai INSERT terakhir yang tak relevan — minta ulang dari DB.
    const live = query(`SELECT id FROM gmail_pool WHERE lower(email) = ?`, [em]);
    return live.length ? Number(live[0].id) : Number(newest.id);
  }
  db.run(`INSERT INTO gmail_pool (email, password_enc, source, totp_secret_enc) VALUES (?, ?, ?, ?)`,
    [em, crypto.encrypt(pw), source, secretB32 ? crypto.encrypt(secretB32) : null]);
  const id = lastInsertId();
  save();
  return id;
}

async function listGmail(limit = 100) {
  await waitReady();
  return query(
    `SELECT id, email, status, source, used_at, used_by, created_at,
            totp_secret_enc IS NOT NULL AND totp_secret_enc != '' AS has_totp,
            totp_locked, login_status, login_at
     FROM gmail_pool ORDER BY id DESC LIMIT ?`,
    [Math.min(Number(limit) || 100, 500)]
  );
}

// Tarik satu Gmail tersedia (FIFO: id terkecil dulu), tandai terpakai.
// Return { id, email, password } atau null bila stok kosong.
async function claimGmail(platform) {
  await waitReady();
  const rows = query(`SELECT * FROM gmail_pool WHERE status = 'available' ORDER BY id ASC LIMIT 1`);
  if (!rows.length) return null;
  const r = rows[0];
  db.run(`UPDATE gmail_pool SET status = 'used', used_at = datetime('now'), used_by = ? WHERE id = ?`, [platform || null, r.id]);
  save();
  let pw = null;
  try { pw = crypto.decrypt(r.password_enc); } catch (e) { pw = null; }
  return { id: r.id, email: r.email, password: pw };
}

// Gmail dipakai utk platform apa saja: pieces 'platform:nama' dipisah ' | '
// (mis. 'fb:pocotre76 | ig:sinta.surya57'). Satu Gmail boleh dipakai SEKALI
// per platform (FB daftar pakai Gmail, IG juga boleh pakai Gmail yang sama) —
// pencegahan dobel-dukun dibaca dari daftar platform di sini.
function gmailUsedPlatforms(usedBy) {
  return String(usedBy || '').split('|')
    .map((piece) => (piece.split(':')[0] || '').trim().toLowerCase())
    .filter(Boolean);
}

// Tandai satu Gmail pool sebagai terpakai utk platform tertentu (+ nama akun).
// Dipakai jalur FB & IG create ketika operator memilih Gmail manual (bukan FIFO
// claim). used_by disusun ulang tanpa menghapus sejarah platform lain:
// 'fb:pocotre76' + mark('ig','sinta…') → 'fb:pocotre76 | ig:sinta…'.
async function markGmailUsed(id, platform, accountName) {
  await waitReady();
  const plt = platform || 'fb';
  const rows = query(`SELECT used_by FROM gmail_pool WHERE id = ?`, [Number(id) || 0]);
  const existing = rows.length ? String(rows[0].used_by || '') : '';
  const pieces = existing.split('|').map((s) => s.trim()).filter(Boolean)
    .filter((p) => (p.split(':')[0] || '').trim().toLowerCase() !== plt);
  pieces.push(accountName ? `${plt}:${accountName}` : plt);
  db.run(`UPDATE gmail_pool SET status = 'used', used_at = datetime('now'), used_by = ? WHERE id = ?`, [pieces.join(' | '), Number(id) || 0]);
  save();
}

async function gmailStats() {
  await waitReady();
  const s = { total: 0, available: 0, used: 0 };
  for (const r of query(`SELECT status, COUNT(*) AS c FROM gmail_pool GROUP BY status`)) {
    s.total += r.c;
    if (r.status === 'available') s.available = r.c;
    else if (r.status === 'used') s.used = r.c;
  }
  return s;
}

// Simpan hasil login Gmail satu akun pool (dipanggil modul gmail-login).
async function setGmailLoginStatus(id, loginStatus, loginAt) {
  await waitReady();
  db.run(`UPDATE gmail_pool SET login_status = ?, login_at = ? WHERE id = ?`,
    [String(loginStatus || ''), loginAt ? String(loginAt) : null, Number(id) || 0]);
  save();
}

// Riwayat percobaan login per akun pool: satu baris per run (waktu, mode, hasil,
// detail pendek mis. nomor konfirmasi). Mode dari job, bukan tebakan.
async function addGmailLoginLog(gmailId, mode, result, detail) {
  await waitReady();
  db.run(`INSERT INTO gmail_login_log (gmail_id, mode, result, detail) VALUES (?, ?, ?, ?)`,
    [Number(gmailId) || 0, String(mode || ''), String(result || ''),
     detail ? String(detail).slice(0, 200) : null]);
  // Simpan 30 percobaan terakhir per akun: riwayat, bukan arsip.
  db.run(`DELETE FROM gmail_login_log WHERE gmail_id = ? AND id NOT IN
    (SELECT id FROM gmail_login_log WHERE gmail_id = ? ORDER BY id DESC LIMIT 30)`,
    [Number(gmailId) || 0, Number(gmailId) || 0]);
  save();
}

async function listGmailLoginLog(gmailId, limit = 10) {
  await waitReady();
  return query(`SELECT mode, result, detail, created_at FROM gmail_login_log
    WHERE gmail_id = ? ORDER BY id DESC LIMIT ?`, [Number(gmailId) || 0, Math.min(Number(limit) || 10, 30)]);
}

// Kode TOTP on-demand untuk satu akun pool: panel jadi Google Authenticator-nya.
// Secret hanya didekripsi di RAM saat menghitung, tidak pernah dikirim keluar.
async function gmailTotpCode(id) {
  await waitReady();
  const rows = query(`SELECT id, totp_secret_enc, totp_locked FROM gmail_pool WHERE id = ?`, [Number(id) || 0]);
  if (!rows.length) return { error: 'tidak_ditemukan' };
  const r = rows[0];
  if (r.totp_locked) return { error: 'totp_seller' };
  if (!r.totp_secret_enc) return { error: 'tanpa_totp' };
  let secret;
  try { secret = crypto.decrypt(r.totp_secret_enc); } catch (e) { return { error: 'secret_rusak' }; }
  return { id: r.id, ...totp.totpCode(secret) };
}

// 2FA akun panel (paritas gmailTotpCode): simpan kunci baru (replace bila sudah
// ada — re-setup), ambil kode saat ini. Secret tak valid menggagalkan simpan: kunci
// salah yang diam-diam masuk jadi kegagalan login yang sulit dilacak.
async function setAccountTotp(id, totpSecret) {
  await waitReady();
  const idN = Number(id) || 0;
  const rows = query(`SELECT id FROM accounts WHERE id = ?`, [idN]);
  if (!rows.length) return { error: 'tidak_ditemukan' };
  if (totpSecret === null) {
    db.run(`UPDATE accounts SET totp_secret_enc = NULL, totp_locked = 0 WHERE id = ?`, [idN]);
    save();
    return { id: idN, removed: true };
  }
  // Kunci valid wajib terbukti menghitung kode sebelum disimpan — validasi format
  // saja tidak menangkap kunci salah-ketik yang kebetulan lolos regex base32.
  const secretB32 = totp.normalizeSecret(totpSecret);
  if (!secretB32) return { error: 'kunci_tidak_valid (harus base32 / otpauth://)' };
  try { totp.totpCode(secretB32); } catch (e) { return { error: 'kunci_tak_bisa_dihitung: ' + e.message }; }
  db.run(`UPDATE accounts SET totp_secret_enc = ?, totp_locked = 0 WHERE id = ?`, [crypto.encrypt(secretB32), idN]);
  save();
  return { id: idN, set: true, has_totp: true };
}

async function accountTotpCode(id) {
  await waitReady();
  const rows = query(`SELECT id, totp_secret_enc, totp_locked FROM accounts WHERE id = ?`, [Number(id) || 0]);
  if (!rows.length) return { error: 'tidak_ditemukan' };
  const r = rows[0];
  if (r.totp_locked) return { error: 'totp_locked' };
  if (!r.totp_secret_enc) return { error: 'tanpa_totp' };
  let secret;
  try { secret = crypto.decrypt(r.totp_secret_enc); } catch (e) { return { error: 'secret_rusak' }; }
  return { id: r.id, ...totp.totpCode(secret) };
}

// Impor massal dari teks: JSON array (output Gmail Creator Pro) atau baris
// email|sandi[|secret]. Kolom ketiga = secret 2FA (base32 / URL otpauth://).
// Duplikat / tak valid dihitung skipped, bukan menggagalkan semua.
async function importGmailText(text, source = 'manual') {
  const src = ['manual', 'belian'].includes(source) ? source : 'manual';
  const t = String(text || '').trim();
  const res = { added: 0, skipped: 0, details: [] };
  if (!t) return res;
  const entries = [];
  if (t.startsWith('[') || t.startsWith('{')) {
    try {
      const j = JSON.parse(t);
      const arr = Array.isArray(j) ? j : (Array.isArray(j.accounts) ? j.accounts : [j]);
      for (const e of arr) entries.push({ email: e.email || e.mail || e.gmail, password: e.password || e.pass, secret: e.secret || e.totp_secret || e.totp });
    } catch (e) { /* bukan JSON valid: jatuh ke mode baris */ }
  }
  if (!entries.length) {
    for (let line of t.split(/\r?\n/)) {
      line = line.trim();
      if (!line || line.startsWith('#')) continue;
      const m = line.split(/[|,;]/).map((x) => x.trim());
      if (m.length >= 2) entries.push({ email: m[0], password: m[1], secret: m[2] });
      else if (m.length === 1 && m[0].includes('@')) entries.push({ email: m[0], password: '' });
      else { res.skipped++; res.details.push({ email: m[0] || '(tanpa email)', reason: 'format salah, pakai email|sandi[|secret]' }); }
    }
  }
  for (const e of entries) {
    try { await addGmail({ email: e.email, password: e.password, source: src, totpSecret: e.secret }); res.added++; }
    catch (err) {
      res.skipped++;
      // Alasan per baris ikut dikirim supaya operator tahu kenapa tidak masuk.
      let reason = err && err.message ? err.message : 'gagal menyimpan';
      if (/unique constraint/i.test(reason)) reason = 'email sudah ada di stok';
      res.details.push({ email: String(e.email || '').trim() || '(tanpa email)', reason });
    }
  }
  save();
  return res;
}

async function deleteGmail(id) {
  await waitReady();
  db.run(`DELETE FROM gmail_pool WHERE id = ?`, [id]);
  const c = query(`SELECT changes() AS c`)[0].c;
  save();
  return c > 0;
}

module.exports = {
  load: waitReady,
  waitReady,
  run,
  save: runSave,
  transaction,
  addAccount,
  listAccounts,
  getAccountByName,
  getAccountById,
  setAccountStatus,
  setAccountPlatform,
  setAccountLastLogin,
  getAccountStats,
  updateAccountPassword,
  deleteAccount,
  addContent,
  addSchedule,
  reschedule,
  deleteSchedule,
  getDueSchedules,
  setScheduleStatus,
  claimSchedule,
  logPost,
  logEngagement,
  listEngagementLog,
  rawAll,
  cleanupFinalized,
  addLikeJob,
  listLikeJobs,
  deleteLikeJob,
  getLikeJob,
  addIgLikeJob,
  addProbeHistory,
  getProbeScores,
  addPhoneHealthLog,
  listPhoneHealth,
  phoneHealthStats,
  phoneHealthTrend,
  getLatestVerdicts,
  addSignupHistory,
  addAccountEvent,
  listAccountEvents,
  countSignups24h,
  dataimpulseRoom,
  countFbSignups24hByRoom,
  otherPlatformRoomUse12h,
  countSignupAttempts24hByIp,
  countSignupAttempts24hByDomain,
  countSignupAttempts24hByProxy,
  getSignupIps,
  listIgLikeJobs,
  deleteIgLikeJob,
  getIgLikeJob,
  createSmmLikeOrder,
  createSmmCommentOrder,
  listSmmCommentOrders,
  getSmmCommentOrder,
  getPendingSmmCommentExecutions,
  assignSmmCommentExecutionAccount,
  resetRunningSmmCommentExecutions,
  resetFailedSmmCommentExecutions,
  markSmmCommentExecutionRunning,
  updateSmmCommentExecution,
  setSmmCommentOrderStatus,
  cancelSmmCommentOrder,
  deleteSmmCommentOrder,
  listSmmLikeOrders,
  getSmmLikeOrder,
  updateSmmExecutionStatus,
  pauseSmmLikeOrder,
  resumeSmmLikeOrder,
  cancelSmmLikeOrder,
  deleteSmmLikeOrder,
  getPendingSmmExecutions,
  logWarmingActivity,
  addProxy,
  listProxies,
  deleteProxy,
  setProxyLabel,
  updateProxy,
  clearProxies,
  setAccountProxy,
  assignProxiesToAccounts,
  countIpUses,
  addAutoProxy,
  markAutoProxyAttempt,
  bindAutoProxy,
  burnAutoProxy,
  releaseAutoProxy,
  releaseStaleAutoProxies,
  accountsUsingProxy,
  addIpHistory,
  listIpHistory,
  latestIpByAccount,
  addGmail,
  listGmail,
  claimGmail,
  markGmailUsed,
  gmailUsedPlatforms,
  gmailStats,
  gmailTotpCode,
  setAccountTotp,
  accountTotpCode,
  setGmailLoginStatus,
  addGmailLoginLog,
  listGmailLoginLog,
  importGmailText,
  deleteGmail,
};
