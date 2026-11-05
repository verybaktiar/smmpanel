'use strict';

// Background worker untuk queue processing menggunakan node-cron
// File ini dijalankan terpisah dari server.js untuk background processing

require('dotenv').config();

const cron = require('node-cron');
const db = require('./src/db');
const queueManager = require('./src/queue-manager');
const sessionManager = require('./src/session-manager');
const errorRecovery = require('./src/error-recovery');
const analytics = require('./src/analytics');
const accountWarming = require('./src/account-warming');
const backupSystem = require('./src/backup-system');

console.log('[worker] SMM Panel Queue Worker starting...');

// Process running orders setiap 2 menit
cron.schedule('*/2 * * * *', async () => {
  const now = new Date().toLocaleString('id-ID');
  console.log(`\n[worker] Tick at ${now}`);
  
  try {
    const result = await queueManager.processAllRunningOrders();
    
    if (result.ordersProcessed > 0) {
      console.log(`[worker] Processed ${result.ordersProcessed} orders:`);
      console.log(`  - ${result.executionsProcessed} executions succeeded`);
      console.log(`  - ${result.executionsFailed} executions failed`);
      console.log(`  - ${result.executionsSkipped} executions skipped`);
    } else {
      console.log('[worker] No running orders to process');
    }
  } catch (error) {
    console.error('[worker] Error processing orders:', error.message);
  }
});

// Check scheduled orders setiap 5 menit dan start jika waktunya sudah tiba
cron.schedule('*/5 * * * *', async () => {
  console.log('\n[worker] Checking scheduled orders...');
  
  try {
    await db.load();
    
    // Get scheduled orders yang waktunya sudah tiba
    const dueOrders = await db.rawAll(`
      SELECT * FROM smm_like_orders 
      WHERE status = 'scheduled' 
      AND scheduled_at <= datetime('now')
    `);
    
    if (dueOrders.length > 0) {
      console.log(`[worker] Found ${dueOrders.length} scheduled orders ready to start`);
      
      for (const order of dueOrders) {
        console.log(`[worker] Starting scheduled order ${order.id}`);
        
        // Update status ke running
        await db.rawAll(`UPDATE smm_like_orders SET status = 'running' WHERE id = ?`, [order.id]);
      }
    } else {
      console.log('[worker] No scheduled orders ready to start');
    }
  } catch (error) {
    console.error('[worker] Error checking scheduled orders:', error.message);
  }
});

// AUTO-POST: proses jadwal posting yang jatuh tempo (dulu hanya di index.js yang
// tidak pernah ikut dev:all — jadwal post tidak pernah jalan otomatis).
const { processDueSchedules } = require('./src/scheduler');
cron.schedule('*/5 * * * *', async () => {
  try {
    const processed = await processDueSchedules();
    if (processed > 0) console.log(`[worker] Auto-post: ${processed} jadwal diproses`);
  } catch (error) {
    console.error('[worker] Error auto-post scheduler:', error.message);
  }
});

// Health check untuk semua akun setiap hari jam 3 pagi
cron.schedule('0 3 * * *', async () => {
  console.log('\n[worker] Running daily health check for all accounts...');
  
  try {
    const healthMonitor = require('./src/health-monitor');
    const result = await healthMonitor.runHealthCheck();
    console.log(`[worker] Health check completed: ${result.healthy} healthy, ${result.unhealthy} unhealthy`);
    if (result.errors.length > 0) {
      console.log('[worker] Errors:', result.errors.slice(0, 5));
    }
  } catch (error) {
    console.error('[worker] Error in health check:', error.message);
  }
});

cron.schedule(`0 */${process.env.SESSION_CHECK_INTERVAL_HOURS || 6} * * *`, async () => {
  console.log('\n[worker] Checking session expiry...');
  
  try {
    const expired = await sessionManager.checkSessionExpiry();
    console.log(`[worker] Marked ${expired} accounts as inactive due to expired sessions`);
  } catch (error) {
    console.error('[worker] Error checking sessions:', error.message);
  }
});

cron.schedule('*/10 * * * *', async () => {
  try {
    const results = await errorRecovery.processRecoveryQueue();
    if (results.processed > 0) {
      console.log(`[worker] Recovery: ${results.succeeded} succeeded, ${results.failed} failed`);
    }
  } catch (error) {
    console.error('[worker] Error in recovery queue:', error.message);
  }
});

// SOP onboarding akun IG muda: cek tiap 20 menit, jalan max 1x/hari jam manusia pagi.
// Tugas: hari-0 dandan profil (pp+bio) dari pack dandan, lalu ritme harian = posting
// feed dari pack (sesuai kuota tahap warming) + interaksi kecil like ke akun penopang.
// Semua aksi lewat account-gate — tak bisa melewati cooldown/limit/kuota warming.
cron.schedule('*/20 * * * *', async () => {
  try {
    const sop = require('./src/onboarding-sop');
    // Nyala/mati: dari config/sop-config.json (tombol panel). Tanpa file = mati default.
    let enabled = false;
    try { enabled = !!JSON.parse(require('fs').readFileSync('./config/sop-config.json', 'utf8')).enabled; } catch (e) { /* mati */ }
    if (!enabled) return;
    // Jam manusia pagi WIB 07-10: kota rata-rata buka HP. Jam lain ditunda.
    const wib = Number(new Date().toLocaleString('en-US', { timeZone: 'Asia/Jakarta', hour: 'numeric', hour12: false }));
    if (wib < 7 || wib >= 10) return;
    // Dedupe harian via laporan terakhir (file log/sop-last.json).
    let last = null;
    try { last = JSON.parse(require('fs').readFileSync('./logs/sop-last.json', 'utf8')); } catch (e) { /* belum ada */ }
    const today = new Date().toISOString().slice(0, 10);
    if (last && last.at && last.at.slice(0, 10) === today) return; // sudah jalan hari ini
    console.log('[worker] SOP onboarding akun IG muda jalan…');
    const report = await sop.runDay();
    const done = (report.accounts || []).filter((a) => a.ok).length;
    console.log(`[worker] SOP selesai: ${done}/${(report.accounts || []).length} akun terproses`);
  } catch (error) {
    console.error('[worker] Error SOP onboarding:', error.message);
  }
});

// Auto-backup harian jam 04:00 (database + sessions) — jawaban migrasi laptop.
cron.schedule('0 4 * * *', async () => {
  try {
    const r = await backupSystem.createBackup('auto');
    console.log('[worker] Auto-backup selesai:', r.backupName || 'ok');
  } catch (error) {
    console.error('[worker] Error auto-backup:', error.message);
  }
});

// Eksekutor warming otomatis: cek tiap 15 menit, jalan bila jam WIB cocok + dry-run aman default.
// Mode default DRY-RUN (tanpa klik) sampai user persenjatai via panel (allowLive=true di config).
cron.schedule('*/15 * * * *', async () => {
  try {
    const sched = require('./src/warming-scheduler');
    const cfg = sched.getConfig();
    if (!cfg.enabled) return;
    const now = sched.wibNow();
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
    const slot = sched.dueSlot(cfg, now, today);
    if (!slot) return;
    console.log(`[worker] Warming executor jalan (slot ${slot} WIB)...`);
    const ex = require('./src/warming-executor');
    const report = await ex.runOnce({ dryRun: !cfg.allowLive });
    sched.saveReport(report);
    sched.markRan(slot);
    const done = (report.accounts || []).map((a) => `${a.account}:${(a.actions || []).join(',') || a.skipped || a.error || '-'}`).join(' | ');
    console.log('[worker] Warming selesai:', done || 'tanpa akun');
  } catch (error) {
    console.error('[worker] Error warming executor:', error.message);
  }
});

// STEP 4: heartbeat + watchdog PG (aditif — perilaku lama tak berubah).
// Gagal PG = log saja, cron lama tetap jalan (produksi masih sql.js).
const WORKER_ID = `worker-${process.pid}`;
try {
  const pgw = require('./src/pg-worker');
  pgw.startupRecovery(WORKER_ID).then((r) => {
    console.log(`[worker] PG startup recovery: ${r.recovered.length} pulih, ${r.active.length} aktif`);
  }).catch((e) => console.log('[worker] PG startup recovery lewat (PG mati?):', e.message));
  cron.schedule('*/1 * * * *', async () => {
    try { await pgw.heartbeat(WORKER_ID); }
    catch (e) { /* PG mati: abaikan */ }
  });
  cron.schedule('*/2 * * * *', async () => {
    try {
      const t = await pgw.watchdogTick();
      if (t.stale.length || t.recovered.length) console.log('[worker] PG watchdog:', JSON.stringify(t));
    } catch (e) { /* PG mati: abaikan */ }
  });
  process.on('SIGINT', handleWorkerSignal);
  process.on('SIGTERM', handleWorkerSignal);
} catch (e) { console.log('[worker] modul pg-worker tak termuat:', e.message); }

// Handler sinyal TUNGGAL (dulu 2 handler saling menimpa — shutdown PG bisa terlewat).
let signalHandled = false;
async function handleWorkerSignal(sig) {
  if (signalHandled) return;
  signalHandled = true;
  console.log(`\n[worker] Shutting down gracefully (${sig})...`);
  try { await pgwRef.shutdown(WORKER_ID, sig); } catch (e) {}
  process.exit(0);
}
const pgwRef = (() => { try { return require('./src/pg-worker'); } catch (e) { return null; } })();

// Reset warming limits and advance stages daily.
cron.schedule('5 0 * * *', async () => {
  try {
    await accountWarming.resetDailyActions();
    await accountWarming.autoProgressStages();
    console.log('[worker] Account warming maintenance completed');
  } catch (error) {
    console.error('[worker] Error in account warming maintenance:', error.message);
  }
});

// Validate all proxies setiap 6 jam
cron.schedule('0 */6 * * *', async () => {
  console.log('\n[worker] Validating all proxies...');
  
  try {
    const proxyValidator = require('./src/proxy-validator');
    const result = await proxyValidator.validateAllProxies(db);
    
    console.log(`[worker] Proxy validation completed: ${result.valid}/${result.total} proxies valid`);
  } catch (error) {
    console.error('[worker] Error validating proxies:', error.message);
  }
});

// Database cleanup setiap minggu (Sunday jam 2 pagi)
cron.schedule('0 2 * * 0', async () => {
  console.log('\n[worker] Running weekly database cleanup...');
  
  try {
    await db.load();
    
    // Cleanup old logs (older than 30 days)
    const deletedLogs = await db.rawAll(`
      DELETE FROM post_log 
      WHERE created_at < datetime('now', '-30 days')
    `);
    
    // Cleanup completed orders (older than 7 days)
    const deletedOrders = await db.rawAll(`
      DELETE FROM smm_like_orders 
      WHERE status = 'completed' 
      AND completed_at < datetime('now', '-7 days')
    `);
    
    // Retensi engagement_log: 90 hari (komentar/DM/story)
    const deletedEng = await db.rawAll(`
      DELETE FROM engagement_log 
      WHERE created_at < datetime('now', '-90 days')
    `);
    console.log(`[worker] Cleanup selesai (post_log: ${Array.isArray(deletedLogs) ? deletedLogs.length : 0}, orders: ${Array.isArray(deletedOrders) ? deletedOrders.length : 0}, engagement: ${Array.isArray(deletedEng) ? deletedEng.length : 0} baris)`);
  } catch (error) {
    console.error('[worker] Error in database cleanup:', error.message);
  }
});

// Initialize database
db.load().then(() => {
  console.log('[worker] Database loaded');
  console.log('[worker] Queue worker is running. Press Ctrl+C to stop.');
  console.log('[worker] Schedules:');
  console.log('  - Process running orders: every 2 minutes');
  console.log('  - Check scheduled orders: every 5 minutes');
  console.log('  - Daily health check: 03:00');
  console.log('  - Proxy validation: every 6 hours');
  console.log('  - Database cleanup: Sunday 02:00');
}).catch(error => {
  console.error('[worker] Failed to load database:', error);
  process.exit(1);
});

// Graceful shutdown — sinyal ditangani terpusat di handleWorkerSignal bila modul
// pg-worker termuat; fallback di sini bila tidak.
if (!pgwRef) {
  process.on('SIGINT', () => { console.log('\n[worker] Shutting down gracefully...'); process.exit(0); });
  process.on('SIGTERM', () => { console.log('\n[worker] Shutting down gracefully...'); process.exit(0); });
}
