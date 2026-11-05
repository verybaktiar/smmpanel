'use strict';
// STEP 3: antrean persistent PostgreSQL + job lease. Source of truth untuk job baru.
// Queue lama (sql.js) TIDAK disentuh sampai queue ini terbukti.
// Status: QUEUED ASSIGNED RUNNING PAUSED SUCCESS FAILED RETRY CANCELLED TIMEOUT
const pg = require('./pg');

const STATUS = ['QUEUED', 'ASSIGNED', 'RUNNING', 'PAUSED', 'SUCCESS', 'FAILED', 'RETRY', 'CANCELLED', 'TIMEOUT'];
const ERROR_CODES = ['ADB_TIMEOUT', 'DEVICE_OFFLINE', 'NETWORK_ERROR', 'APP_CRASH',
  'SESSION_INVALID', 'JOB_TIMEOUT', 'DATABASE_ERROR', 'WORKER_TIMEOUT', 'PROXY_ERROR',
  'VALIDATION_ERROR', 'AUTH_ERROR', 'UNKNOWN_ERROR'];

const QUEUE_DDL = `
CREATE TABLE IF NOT EXISTS jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL,
  platform TEXT,
  device_id TEXT,
  account_id INTEGER,
  status TEXT NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED','ASSIGNED','RUNNING','PAUSED','SUCCESS','FAILED','RETRY','CANCELLED','TIMEOUT')),
  priority INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  worker_id TEXT,
  locked_at TIMESTAMPTZ,
  lease_until TIMESTAMPTZ,
  heartbeat_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  error_code TEXT,
  error_message TEXT,
  payload JSONB DEFAULT '{}',
  result JSONB,
  idempotency_key TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_device ON jobs(device_id);
CREATE INDEX IF NOT EXISTS idx_jobs_account ON jobs(account_id);
CREATE INDEX IF NOT EXISTS idx_jobs_worker ON jobs(worker_id);
CREATE INDEX IF NOT EXISTS idx_jobs_created ON jobs(created_at);
CREATE INDEX IF NOT EXISTS idx_jobs_lease ON jobs(lease_until) WHERE status IN ('ASSIGNED','RUNNING');
CREATE INDEX IF NOT EXISTS idx_jobs_claim ON jobs(priority DESC, created_at ASC) WHERE status IN ('QUEUED','RETRY');
`;

async function migrate() { await pg.query(QUEUE_DDL); }

// Enqueue. Idempotency: idempotency_key sama -> kembalikan job lama, tanpa duplikat.
async function enqueue({ type, platform = null, deviceId = null, accountId = null,
  payload = {}, priority = 0, maxAttempts = 3, idempotencyKey = null }) {
  if (!type) return { error: 'type wajib.' };
  if (idempotencyKey) {
    const old = await pg.query('SELECT * FROM jobs WHERE idempotency_key = $1', [idempotencyKey]);
    if (old.rows.length) return { ...old.rows[0], duplicate: true };
  }
  const r = await pg.query(
    `INSERT INTO jobs (type, platform, device_id, account_id, payload, priority, max_attempts, idempotency_key)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [type, platform, deviceId, accountId, JSON.stringify(payload), priority, maxAttempts, idempotencyKey]);
  return r.rows[0];
}

// Claim: 1 transaksi — ambil job prioritas tertinggi yang bebas + kunci ke worker.
// FOR UPDATE SKIP LOCKED: dua worker tak bisa dapat job sama.
async function claim({ workerId, deviceId = null, leaseSecs = 120 }) {
  const c = await pg.getPool().connect();
  try {
    await c.query('BEGIN');
    const q = deviceId
      ? `SELECT * FROM jobs WHERE status IN ('QUEUED','RETRY') AND (device_id IS NULL OR device_id = $1)
         ORDER BY priority DESC, created_at ASC LIMIT 1 FOR UPDATE SKIP LOCKED`
      : `SELECT * FROM jobs WHERE status IN ('QUEUED','RETRY')
         ORDER BY priority DESC, created_at ASC LIMIT 1 FOR UPDATE SKIP LOCKED`;
    const args = deviceId ? [deviceId] : [];
    const found = await c.query(q, args);
    if (!found.rows.length) { await c.query('ROLLBACK'); return null; }
    const j = found.rows[0];
    // Device lock: jangan klaim bila device ini masih punya job aktif
    if (j.device_id) {
      const busy = await c.query(
        `SELECT id FROM jobs WHERE device_id = $1 AND status IN ('ASSIGNED','RUNNING') AND id <> $2 LIMIT 1`,
        [j.device_id, j.id]);
      if (busy.rows.length) { await c.query('ROLLBACK'); return { skipped: true, reason: `device ${j.device_id} sibuk` }; }
    }
    const r = await c.query(
      `UPDATE jobs SET status = 'ASSIGNED', worker_id = $1, locked_at = now(),
        lease_until = now() + ($2 || ' seconds')::interval,
        heartbeat_at = now(), attempts = attempts + 1, updated_at = now()
       WHERE id = $3 RETURNING *`,
      [workerId, String(leaseSecs), j.id]);
    await c.query('COMMIT');
    return r.rows[0];
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
}

async function heartbeat(id, workerId, leaseSecs = 120) {
  const r = await pg.query(
    `UPDATE jobs SET heartbeat_at = now(), lease_until = now() + ($3 || ' seconds')::interval, updated_at = now()
     WHERE id = $1 AND worker_id = $2 AND status IN ('ASSIGNED','RUNNING') RETURNING *`,
    [id, workerId, String(leaseSecs)]);
  return r.rows[0] || null;
}

async function markRunning(id, workerId) {
  const r = await pg.query(
    `UPDATE jobs SET status = 'RUNNING', started_at = COALESCE(started_at, now()), updated_at = now()
     WHERE id = $1 AND worker_id = $2 AND status = 'ASSIGNED' RETURNING *`, [id, workerId]);
  return r.rows[0] || null;
}

// finish(ok): sukses -> SUCCESS; gagal -> RETRY (bila attempts < max) else FAILED.
async function finish(id, workerId, ok, { errorCode = null, errorMessage = null, result = null } = {}) {
  if (errorCode && !ERROR_CODES.includes(errorCode)) errorCode = 'UNKNOWN_ERROR';
  const c = await pg.getPool().connect();
  try {
    await c.query('BEGIN');
    const cur = (await c.query('SELECT * FROM jobs WHERE id = $1 FOR UPDATE', [id])).rows[0];
    if (!cur) { await c.query('ROLLBACK'); return { error: 'job tak ketemu.' }; }
    if (cur.worker_id !== workerId) { await c.query('ROLLBACK'); return { error: 'bukan pemilik lease.' }; }
    let status = 'SUCCESS';
    if (!ok) status = (cur.attempts < cur.max_attempts) ? 'RETRY' : 'FAILED';
    const r = await c.query(
      `UPDATE jobs SET status = $1, finished_at = CASE WHEN $1 IN ('SUCCESS','FAILED','CANCELLED') THEN now() ELSE NULL END,
        error_code = $2, error_message = $3, result = $4,
        worker_id = CASE WHEN $1 IN ('SUCCESS','FAILED','CANCELLED') THEN NULL ELSE worker_id END,
        lease_until = CASE WHEN $1 IN ('SUCCESS','FAILED','CANCELLED') THEN NULL ELSE lease_until END,
        updated_at = now() WHERE id = $5 RETURNING *`,
      [status, errorCode, errorMessage ? String(errorMessage).slice(0, 500) : null,
        result ? JSON.stringify(result) : null, id]);
    await c.query('COMMIT');
    return r.rows[0];
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
}

// Recovery: lease kedaluwarsa -> RETRY (atau FAILED bila habis) / TIMEOUT bila terlalu tua.
// Dipanggil watchdog; mengembalikan daftar job yang dipulihkan.
async function recoverOrphans({ timeoutHours = 6 } = {}) {
  const r = await pg.query(
    `UPDATE jobs SET status = CASE
        WHEN attempts >= max_attempts THEN 'FAILED'
        WHEN now() - COALESCE(started_at, locked_at, created_at) > ($1 || ' hours')::interval THEN 'TIMEOUT'
        ELSE 'RETRY' END,
      error_code = COALESCE(error_code, 'WORKER_TIMEOUT'),
      error_message = COALESCE(error_message, 'lease kedaluwarsa, dipulihkan watchdog'),
      worker_id = NULL, lease_until = NULL, updated_at = now()
     WHERE status IN ('ASSIGNED','RUNNING') AND lease_until IS NOT NULL AND lease_until < now()
     RETURNING id, status`, [timeoutHours]);
  return r.rows;
}

async function cancel(id) {
  const r = await pg.query(
    `UPDATE jobs SET status = 'CANCELLED', finished_at = now(), worker_id = NULL, lease_until = NULL, updated_at = now()
     WHERE id = $1 AND status IN ('QUEUED','RETRY','PAUSED','ASSIGNED') RETURNING *`, [id]);
  return r.rows[0] || null;
}

async function pause(id) {
  const r = await pg.query(
    `UPDATE jobs SET status = 'PAUSED', updated_at = now()
     WHERE id = $1 AND status IN ('QUEUED','RETRY') RETURNING *`, [id]);
  return r.rows[0] || null;
}

async function get(id) {
  const r = await pg.query('SELECT * FROM jobs WHERE id = $1', [id]);
  return r.rows[0] || null;
}

async function stats() {
  const r = await pg.query(
    `SELECT status, COUNT(*)::int AS n FROM jobs GROUP BY status`);
  const out = {};
  for (const row of r.rows) out[row.status] = row.n;
  return out;
}

module.exports = { migrate, enqueue, claim, heartbeat, markRunning, finish,
  recoverOrphans, cancel, pause, get, stats, STATUS, ERROR_CODES };
