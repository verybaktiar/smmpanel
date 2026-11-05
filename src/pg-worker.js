'use strict';
// STEP 4: worker watchdog + recovery. Registry worker di PG, health state,
// restart protection, graceful shutdown, startup recovery, structured events.
// Worker lama (node-cron) TIDAK diubah perilakunya — modul ini dipanggil berkala darinya.
const pg = require('./pg');
const queue = require('./pg-queue');

const HEALTH = ['HEALTHY', 'WARNING', 'UNHEALTHY', 'STOPPED'];
// Batas: heartbeat > 90 dtk = WARNING, > 300 dtk = UNHEALTHY (stale)
const WARN_AFTER_S = 90;
const DEAD_AFTER_S = 300;
const MAX_RESTARTS = 5;      // threshold restart loop
const RESTART_WINDOW_S = 600; // dalam 10 menit

const DDL = `
CREATE TABLE IF NOT EXISTS workers (
  worker_id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'HEALTHY' CHECK (status IN ('HEALTHY','WARNING','UNHEALTHY','STOPPED')),
  last_seen TIMESTAMPTZ,
  current_job_id UUID,
  started_at TIMESTAMPTZ,
  uptime_s INTEGER DEFAULT 0,
  memory_mb INTEGER,
  cpu_pct REAL,
  restart_count INTEGER NOT NULL DEFAULT 0,
  last_restart_at TIMESTAMPTZ,
  note TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS worker_events (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  worker_id TEXT,
  job_id UUID,
  severity TEXT NOT NULL DEFAULT 'INFO' CHECK (severity IN ('INFO','WARN','ERROR','FATAL')),
  event TEXT NOT NULL,
  duration_ms INTEGER,
  error_code TEXT,
  message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_worker_events_worker ON worker_events(worker_id);
CREATE INDEX IF NOT EXISTS idx_worker_events_created ON worker_events(created_at);
`;

async function migrate() { await pg.query(DDL); }

function mem() { return Math.round(process.memoryUsage().rss / 1048576); }
async function cpu() {
  // CPU % kasar: delta cpu time per 100ms. null bila tak tersedia.
  try {
    const a = process.cpuUsage();
    await new Promise((r) => setTimeout(r, 120));
    const b = process.cpuUsage(a);
    return Math.round(((b.user + b.system) / 1000 / 120) * 100) / 100;
  } catch (e) { return null; }
}

async function log(workerId, event, { jobId = null, severity = 'INFO', durationMs = null, errorCode = null, message = null } = {}) {
  await pg.query(
    `INSERT INTO worker_events (worker_id, job_id, severity, event, duration_ms, error_code, message)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [workerId, jobId, severity, event, durationMs, errorCode, message ? String(message).slice(0, 500) : null]);
}

// Heartbeat: upsert + hitung health dari kealpaan. Restart tercatat bila started_at baru.
async function heartbeat(workerId, { jobId = null, restarted = false } = {}) {
  const mno = mem();
  const cpuv = await cpu();
  const r = await pg.query(
    `INSERT INTO workers (worker_id, status, last_seen, current_job_id, started_at, uptime_s, memory_mb, cpu_pct, restart_count, last_restart_at, updated_at)
     VALUES ($1,'HEALTHY',now(),$2,now(),0,$3,$4,0,NULL,now())
     ON CONFLICT (worker_id) DO UPDATE SET
       last_seen = now(), current_job_id = COALESCE($2, workers.current_job_id),
       uptime_s = EXTRACT(EPOCH FROM (now() - workers.started_at))::int,
       memory_mb = $3, cpu_pct = $4,
       status = CASE WHEN workers.status = 'STOPPED' THEN 'STOPPED' ELSE 'HEALTHY' END,
       restart_count = CASE WHEN $5 THEN workers.restart_count + 1 ELSE workers.restart_count END,
       last_restart_at = CASE WHEN $5 THEN now() ELSE workers.last_restart_at END,
       updated_at = now()
     RETURNING *`,
    [workerId, jobId, mno, cpuv, restarted]);
  const w = r.rows[0];
  if (restarted) {
    await log(workerId, 'restart', { severity: 'WARN', message: `restart #${w.restart_count}` });
    // Restart protection: > MAX dalam jendela -> STOPPED + incident
    const recent = await pg.query(
      `SELECT COUNT(*)::int AS n FROM worker_events
       WHERE worker_id = $1 AND event = 'restart' AND created_at > now() - ($2 || ' seconds')::interval`,
      [workerId, String(RESTART_WINDOW_S)]);
    if (recent.rows[0].n > MAX_RESTARTS) {
      await pg.query(`UPDATE workers SET status = 'STOPPED', note = 'restart loop, perlu manusia' WHERE worker_id = $1`, [workerId]);
      await log(workerId, 'restart-loop', { severity: 'FATAL', message: `>${MAX_RESTARTS} restart/${RESTART_WINDOW_S}s, STOPPED` });
      return { ...w, status: 'STOPPED', stopped: true };
    }
  }
  return w;
}

async function setJob(workerId, jobId) {
  await pg.query(`UPDATE workers SET current_job_id = $2, updated_at = now() WHERE worker_id = $1`, [workerId, jobId]);
}
async function clearJob(workerId) {
  await pg.query(`UPDATE workers SET current_job_id = NULL, updated_at = now() WHERE worker_id = $1`, [workerId]);
}

// Watchdog tick: stale -> WARNING/UNHEALTHY; orphan jobs -> recovery; STOPPED dibiarkan.
// Mengembalikan ringkasan untuk log.
async function watchdogTick() {
  const stale = await pg.query(
    `UPDATE workers SET status = CASE
        WHEN last_seen < now() - ($1 || ' seconds')::interval THEN 'UNHEALTHY'
        WHEN last_seen < now() - ($2 || ' seconds')::interval THEN 'WARNING'
        ELSE status END,
      updated_at = now()
     WHERE status IN ('HEALTHY','WARNING') AND last_seen IS NOT NULL
     RETURNING worker_id, status`, [String(DEAD_AFTER_S), String(WARN_AFTER_S)]);
  for (const w of stale.rows) {
    if (w.status === 'UNHEALTHY') {
      await log(w.worker_id, 'stale', { severity: 'ERROR', message: 'heartbeat basi, UNHEALTHY' });
    }
  }
  const recovered = await queue.recoverOrphans();
  for (const j of recovered) {
    await log(null, 'orphan-recovered', { jobId: j.id, severity: 'WARN', message: `job ${j.id} -> ${j.status}` });
  }
  // Registry hygiene: baris worker dengan heartbeat >48 jam sudah pasti mati
  // (tak mungkin kembali) — hapus supaya status dashboard tidak tersumbat baris
  // usang, plus buang event yatimnya.
  const purged = await pg.query(
    `DELETE FROM workers WHERE last_seen < now() - interval '48 hours' RETURNING worker_id`);
  if (purged.rows.length) {
    await pg.query(`DELETE FROM worker_events WHERE worker_id NOT IN (SELECT worker_id FROM workers)`);
    for (const w of purged.rows) {
      await log(null, 'worker-purged', { severity: 'WARN', message: `${w.worker_id} dihapus dari registry (heartbeat >48 jam)` });
    }
  }
  return { stale: stale.rows.map((r) => `${r.worker_id}:${r.status}`), recovered: recovered.map((r) => `${r.id}:${r.status}`), purged: purged.rows.map((r) => r.worker_id) };
}

// Graceful shutdown: tulis status, lepas job (lease dibiarkan kedaluwarsa -> recovery
// mengambil alih; atau klaim ulang). Tutup pool.
async function shutdown(workerId, reason = 'shutdown') {
  await log(workerId, 'shutdown', { message: reason });
  await pg.query(`UPDATE workers SET status = 'STOPPED', current_job_id = NULL, note = $2, updated_at = now() WHERE worker_id = $1`, [workerId, reason]);
}

// Startup recovery: pulihkan orphan, laporkan job aktif, kembalikan worker ke HEALTHY.
async function startupRecovery(workerId) {
  const recovered = await queue.recoverOrphans();
  const active = await pg.query(
    `SELECT id, status, worker_id FROM jobs WHERE status IN ('ASSIGNED','RUNNING')`);
  await heartbeat(workerId, { restarted: true });
  await log(workerId, 'startup', { message: `recovered=${recovered.length} active=${active.rows.length}` });
  return { recovered, active: active.rows };
}

async function status() {
  const w = (await pg.query('SELECT * FROM workers ORDER BY worker_id')).rows;
  const j = await queue.stats();
  return { workers: w, queue: j, at: new Date().toISOString() };
}

module.exports = { migrate, heartbeat, setJob, clearJob, watchdogTick, shutdown,
  startupRecovery, status, log, HEALTH, WARN_AFTER_S, DEAD_AFTER_S, MAX_RESTARTS };
