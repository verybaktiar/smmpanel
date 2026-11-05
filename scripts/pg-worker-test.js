'use strict';
// STEP 4 tests: 10 skenario worker watchdog + recovery.
// Pakai: node scripts/pg-worker-test.js
require('dotenv').config();
const pg = require('../src/pg');
const w = require('../src/pg-worker');
const q = require('../src/pg-queue');

const results = [];
function rep(name, ok, note = '') {
  results.push({ name, ok: !!ok, note });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${note ? ' — ' + note : ''}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let seq = 0;
const tag = () => `t4-${Date.now().toString(36)}-${seq++}`;

async function main() {
  await w.migrate();
  await q.migrate();
  await pg.query(`DELETE FROM jobs WHERE type LIKE 't4-%' OR type LIKE 't3-%'`);

  // W1: heartbeat normal -> HEALTHY + last_seen segar
  {
    const id = tag();
    const r = await w.heartbeat(id);
    rep('W1 heartbeat-normal', r.status === 'HEALTHY' && !!r.last_seen && r.memory_mb > 0);
  }

  // W2: heartbeat stale -> WARNING lalu UNHEALTHY via watchdog
  {
    const id = tag();
    await w.heartbeat(id);
    await pg.query(`UPDATE workers SET last_seen = now() - interval '200 seconds' WHERE worker_id = $1`, [id]);
    const tick = await w.watchdogTick();
    const st = (await pg.query(`SELECT status FROM workers WHERE worker_id = $1`, [id])).rows[0].status;
    // 200s > WARN(90) tapi < DEAD(300) -> WARNING
    const okWarn = st === 'WARNING';
    await pg.query(`UPDATE workers SET last_seen = now() - interval '400 seconds' WHERE worker_id = $1`, [id]);
    await w.watchdogTick();
    const st2 = (await pg.query(`SELECT status FROM workers WHERE worker_id = $1`, [id])).rows[0].status;
    rep('W2 stale->warning->unhealthy', okWarn && st2 === 'UNHEALTHY', `${st}->${st2}`);
  }

  // W3: hang simulation — process hidup tapi heartbeat berhenti -> UNHEALTHY (beda dari hidup)
  {
    const id = tag();
    await w.heartbeat(id);
    // "hang": 400 dtk tanpa heartbeat
    await pg.query(`UPDATE workers SET last_seen = now() - interval '400 seconds' WHERE worker_id = $1`, [id]);
    await w.watchdogTick();
    const st = (await pg.query(`SELECT status FROM workers WHERE worker_id = $1`, [id])).rows[0].status;
    rep('W3 hang-vs-hidup', st === 'UNHEALTHY', 'process hidup, worker mati terdeteksi');
  }

  // W4: crash saat RUNNING -> job direcovery, tidak hilang
  {
    const t = tag();
    const j = await q.enqueue({ type: t });
    await q.claim({ workerId: 'w-crash', leaseSecs: 2 });
    await q.markRunning(j.id, 'w-crash');
    await w.heartbeat('w-crash');
    await w.setJob('w-crash', j.id);
    // crash: tanpa heartbeat + tanpa finish, lease lewat
    await sleep(3000);
    await w.watchdogTick();
    const jj = await q.get(j.id);
    rep('W4 crash->job-recovered', jj && jj.status === 'RETRY', `job=${jj && jj.status}`);
    await q.cancel(j.id).catch(() => {});
  }

  // W5: restart -> startup recovery laporkan + pulihkan
  {
    const t = tag();
    const j = await q.enqueue({ type: t });
    await q.claim({ workerId: 'w-r', leaseSecs: 1 });
    await sleep(2500);
    const rec = await w.startupRecovery('w-r');
    const jj = await q.get(j.id);
    rep('W5 startup-recovery', rec.recovered.some((r) => String(r.id) === String(j.id)) && jj.status === 'RETRY');
    await q.cancel(j.id).catch(() => {});
  }

  // W6: multiple worker recovery — 2 worker mati, semua job pulih
  {
    const t = tag();
    const j1 = await q.enqueue({ type: t });
    const j2 = await q.enqueue({ type: t });
    await q.claim({ workerId: 'w-m1', leaseSecs: 1 });
    // klaim kedua harus dapat j2 (device lock tak mengikat karena device NULL)
    const cc = await q.claim({ workerId: 'w-m2', leaseSecs: 1 });
    await sleep(2500);
    const tick = await w.watchdogTick();
    const s1 = (await q.get(j1.id)).status;
    const s2 = (await q.get(j2.id)).status;
    const ok = (s1 === 'RETRY' || s1 === 'FAILED') && (s2 === 'RETRY' || s2 === 'FAILED');
    rep('W6 multi-recovery', ok && cc, `${s1}/${s2}`);
    await q.cancel(j1.id).catch(() => {});
    await q.cancel(j2.id).catch(() => {});
  }

  // W7: restart loop protection — 6 restart cepat -> STOPPED + incident
  {
    const id = tag();
    let last = null;
    for (let i = 0; i < 6; i++) last = await w.heartbeat(id, { restarted: true });
    rep('W7 restart-loop->stopped', last.status === 'STOPPED' && last.stopped === true, `status=${last.status}`);
  }

  // W8: graceful shutdown — STOPPED + job dilepas (lease -> recovery)
  {
    const t = tag();
    const j = await q.enqueue({ type: t });
    await q.claim({ workerId: 'w-g', leaseSecs: 2 });
    await w.heartbeat('w-g');
    await w.shutdown('w-g', 'tes shutdown');
    const st = (await pg.query(`SELECT status FROM workers WHERE worker_id = $1`, ['w-g'])).rows[0].status;
    await sleep(3000);
    await w.watchdogTick();
    const jj = await q.get(j.id);
    rep('W8 graceful-shutdown', st === 'STOPPED' && jj.status === 'RETRY', `${st}/${jj.status}`);
    await q.cancel(j.id).catch(() => {});
  }

  // W9: orphan recovery via watchdog berkala (job yatim tanpa worker)
  {
    const t = tag();
    const j = await q.enqueue({ type: t });
    await q.claim({ workerId: 'w-hilang', leaseSecs: 1 });
    await sleep(2500);
    const tick = await w.watchdogTick();
    const jj = await q.get(j.id);
    rep('W9 orphan-via-watchdog', tick.recovered.some((r) => String(r).startsWith(String(j.id))) && jj.status === 'RETRY');
    await q.cancel(j.id).catch(() => {});
  }

  // W10: structured logs tercatat (event + error_code)
  {
    const id = tag();
    await w.log(id, 'demo-event', { severity: 'ERROR', errorCode: 'ADB_TIMEOUT', message: 'tes log', durationMs: 123 });
    const n = (await pg.query(`SELECT COUNT(*)::int AS n FROM worker_events WHERE worker_id = $1 AND error_code = 'ADB_TIMEOUT'`, [id])).rows[0].n;
    rep('W10 structured-log', n === 1);
  }

  // bersih
  await pg.query(`DELETE FROM jobs WHERE type LIKE 't4-%' OR type LIKE 't3-%'`);
  await pg.query(`DELETE FROM worker_events WHERE worker_id LIKE 't4-%'`);
  await pg.query(`DELETE FROM workers WHERE worker_id LIKE 't4-%' OR worker_id IN ('w-crash','w-r','w-m1','w-m2','w-g','w-hilang','w1','w2','wA','wB','wL','w-mati','w-restart')`);
  await pg.getPool().end();

  const pass = results.filter((r) => r.ok).length;
  console.log(`\nRINGKASAN: ${pass}/${results.length} PASS`);
  if (pass !== results.length) process.exit(1);
}

main().catch((e) => { console.error('TEST GAGAL:', e.message); process.exit(1); });
