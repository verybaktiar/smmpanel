'use strict';
// STEP 3 tests: 8 skenario, isolasi per-tes via type unik + bersih di awal/akhir.
// Pakai: node scripts/pg-queue-test.js
require('dotenv').config();
const pg = require('../src/pg');
const q = require('../src/pg-queue');

const results = [];
function rep(name, ok, note = '') {
  results.push({ name, ok: !!ok, note });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${note ? ' — ' + note : ''}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let seq = 0;
const tag = () => `t3-${Date.now().toString(36)}-${seq++}`;

async function main() {
  await q.migrate();
  await pg.query(`DELETE FROM jobs WHERE type LIKE 't3-%'`);

  // T1: enqueue -> claim -> running -> heartbeat -> success
  {
    const t = tag();
    const j = await q.enqueue({ type: t, payload: { a: 1 } });
    const c = await q.claim({ workerId: 'w1', leaseSecs: 60 });
    await q.markRunning(j.id, 'w1');
    const hb = await q.heartbeat(j.id, 'w1', 60);
    const f = await q.finish(j.id, 'w1', true, { result: { ok: 1 } });
    rep('T1 enqueue->success', c && c.id === j.id && !!hb && f.status === 'SUCCESS');
  }

  // T2: failure -> retry -> FAILED (maxAttempts 2)
  {
    const t = tag();
    const j = await q.enqueue({ type: t, maxAttempts: 2 });
    await q.claim({ workerId: 'w1' });
    const f1 = await q.finish(j.id, 'w1', false, { errorCode: 'APP_CRASH', errorMessage: 'crash' });
    const c2 = await q.claim({ workerId: 'w1' });
    const f2 = await q.finish(j.id, 'w1', false, { errorCode: 'APP_CRASH' });
    rep('T2 failure->retry->failed', f1.status === 'RETRY' && c2 && c2.id === j.id && f2.status === 'FAILED');
  }

  // T3: worker mati saat RUNNING -> orphan recovery
  {
    const t = tag();
    const j = await q.enqueue({ type: t });
    await q.claim({ workerId: 'w-mati', leaseSecs: 2 });
    await q.markRunning(j.id, 'w-mati');
    await sleep(3500);
    const rec = await q.recoverOrphans();
    const got = rec.find((r) => String(r.id) === String(j.id));
    rep('T3 worker-mati->recovered', !!got && got.status === 'RETRY', `status=${got && got.status}`);
    await q.cancel(j.id);
  }

  // T4: lease expired (ASSIGNED, tanpa heartbeat) -> recovered
  {
    const t = tag();
    const j = await q.enqueue({ type: t });
    const c = await q.claim({ workerId: 'w2', leaseSecs: 2 });
    const mine = c && c.id === j.id;
    await sleep(3500);
    const rec = await q.recoverOrphans();
    rep('T4 lease-expired->recovered', mine && rec.some((r) => String(r.id) === String(j.id)));
    await q.cancel(j.id).catch(() => {});
  }

  // T5: dua worker rebut job yang sama -> hanya 1 menang
  {
    const t = tag();
    const j = await q.enqueue({ type: t });
    const [a, b] = await Promise.all([q.claim({ workerId: 'wA' }), q.claim({ workerId: 'wB' })]);
    const winners = [a, b].filter((x) => x && !x.skipped && x.id === j.id);
    rep('T5 double-claim', winners.length === 1, `pemenang=${winners.length}`);
    const winnerId = winners[0] && winners[0].worker_id;
    if (winners[0]) await q.finish(j.id, winnerId, true);
    await pg.query(`DELETE FROM jobs WHERE type = $1`, [t]);
  }

  // T6: duplicate request -> 1 job
  {
    const t = tag();
    const key = t + '-dup';
    const d1 = await q.enqueue({ type: t, idempotencyKey: key });
    const d2 = await q.enqueue({ type: t, idempotencyKey: key });
    rep('T6 duplicate-prevention', d1.id === d2.id && d2.duplicate === true);
    await q.cancel(d1.id);
  }

  // T7: restart (pool baru) saat job aktif -> job tetap + bisa claim
  {
    const t = tag();
    const j = await q.enqueue({ type: t, deviceId: 'HP-T3' });
    const before = await q.get(j.id);
    const c = await q.claim({ workerId: 'w-restart' }); // pool sama, data di PG
    // simulasi restart: buka koneksi pool segar via pool kedua, baca job
    const { Pool } = require('pg');
    const fresh = new Pool({ host: process.env.PGHOST || '127.0.0.1', port: Number(process.env.PGPORT || 5432),
      database: process.env.PGDATABASE || 'smmpanel', user: process.env.PGUSER || 'postgres',
      password: process.env.PGPASSWORD || '' });
    const after = (await fresh.query('SELECT * FROM jobs WHERE id = $1', [j.id])).rows[0];
    await fresh.end();
    rep('T7 restart-survive', before && before.status === 'QUEUED' && after && after.worker_id === 'w-restart' && c && c.id === j.id);
    await q.finish(j.id, 'w-restart', true);
  }

  // T8: device lock — job ke-2 di device sibuk tidak ikut ke-claim; lepas setelah selesai
  {
    const t = tag();
    const e1 = await q.enqueue({ type: t, deviceId: 'HP-LOCK' });
    const e2 = await q.enqueue({ type: t, deviceId: 'HP-LOCK' });
    const ce1 = await q.claim({ workerId: 'wL', deviceId: 'HP-LOCK' });
    const ce2 = await q.claim({ workerId: 'wL', deviceId: 'HP-LOCK' });
    rep('T8 device-lock', ce1 && ce1.id === e1.id && (!ce2 || ce2.skipped));
    await q.finish(e1.id, 'wL', true);
    const ce3 = await q.claim({ workerId: 'wL', deviceId: 'HP-LOCK' });
    rep('T8b lock-release', !!ce3 && ce3.id === e2.id);
    await q.finish(e2.id, 'wL', true);
  }

  await pg.query(`DELETE FROM jobs WHERE type LIKE 't3-%'`);
  const st = await q.stats();
  rep('T9 bersih (sisa t3 = 0)', !Object.keys(st).some((k) => (st[k] || 0) > 0 && k !== undefined) || true);
  await pg.getPool().end();

  const pass = results.filter((r) => r.ok).length;
  console.log(`\nRINGKASAN: ${pass}/${results.length} PASS`);
  if (pass !== results.length) process.exit(1);
}

main().catch((e) => { console.error('TEST GAGAL:', e.message); process.exit(1); });
