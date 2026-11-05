'use strict';
// Refresh sesi Gmail terjadwal: akun dengan login_status 'ok' perlu cookie-nya
// "dihidupkan" kembali sebelum masuk zona kuning (14 hari). Interval cek 6 jam;
// akun di-refresh bila umur login_at ≥ REFRESH_AFTER_DAYS (10). Refresh = buka
// inbox headless (--once): verifikasi auth + simpan cookie segar + tutup sendiri.
//
// Riwayat 'sesi_diverifikasi' ditulis runner gmail-open-run lewat parse stdout
// (sql.js per-proses: tulisan dari proses worker tidak terlihat memori server).
//
// Nonaktif: set GMAIL_SESSION_REFRESH_INTERVAL_MIN=0 di .env.

const db = require('./db');
const gmailOpenRun = require('./gmail-open-run');

const CHECK_INTERVAL_MIN = Number(process.env.GMAIL_SESSION_REFRESH_INTERVAL_MIN || 360); // 6 jam
const REFRESH_AFTER_DAYS = Number(process.env.GMAIL_SESSION_REFRESH_AFTER_DAYS || 10);
const DAY_MS = 86400000;

let timer = null;
let running = false;
let lastReport = null;

async function refreshDueAccounts() {
  if (running) { lastReport = { skipped: 'masih_jalan', at: new Date().toISOString() }; return lastReport; }
  running = true;
  try {
    const rows = await db.rawAll(
      `SELECT id, email, login_at FROM gmail_pool
       WHERE login_status = 'ok' AND login_at IS NOT NULL AND login_at != ''`
    );
    const now = Date.now();
    const due = (rows || []).filter((r) => {
      const age = now - new Date(r.login_at).getTime();
      return Number.isFinite(age) && age >= REFRESH_AFTER_DAYS * DAY_MS;
    });
    lastReport = {
      at: new Date().toISOString(),
      checked: (rows || []).length,
      due: due.length,
      refreshed: 0,
      failed: 0,
    };
    for (const r of due) {
      const res = gmailOpenRun.start(r.id, r.email, { once: true });
      if (res.error) { lastReport.failed++; continue; }
      lastReport.refreshed++;
      // Tunggu proses selesai (maks 3 menit per akun) sebelum lanjut —
      // sql.js satu proses server, jangan tumpuk dua provisi bersamaan.
      await new Promise((resolve) => {
        const iv = setInterval(() => {
          const st = gmailOpenRun.status(r.id);
          if (!st || st.status === 'idle') { clearInterval(iv); resolve(); }
        }, 3000);
        setTimeout(() => { clearInterval(iv); resolve(); }, 180000);
      });
      // Beri jeda supaya DB save() selesai.
      await new Promise((r2) => setTimeout(r2, 2000));
    }
    console.log(`[gmail-refresh] cek sesi: ${lastReport.checked} akun, ${lastReport.due} perlu refresh, ${lastReport.refreshed} dijalankan.`);
    return lastReport;
  } catch (e) {
    lastReport = { error: (e.message || '').split('\n')[0], at: new Date().toISOString() };
    return lastReport;
  } finally {
    running = false;
  }
}

function startAuto() {
  if (!(CHECK_INTERVAL_MIN > 0)) { console.log('[gmail-refresh] nonaktif (GMAIL_SESSION_REFRESH_INTERVAL_MIN=0).'); return; }
  if (timer) return;
  timer = setInterval(() => refreshDueAccounts().catch(() => {}), CHECK_INTERVAL_MIN * 60000);
  console.log(`[gmail-refresh] aktif: cek tiap ${CHECK_INTERVAL_MIN} menit, refresh jika umur sesi ≥ ${REFRESH_AFTER_DAYS} hari.`);
}

function status() { return { intervalMin: CHECK_INTERVAL_MIN, refreshAfterDays: REFRESH_AFTER_DAYS, running, last: lastReport }; }

module.exports = { refreshDueAccounts, startAuto, status };
