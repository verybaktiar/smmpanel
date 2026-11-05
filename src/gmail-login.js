'use strict';
// LOGIN GMAIL otomatis (tahap 1 dari rencana email:password → 2FA otomatis).
// Satu job per akun gmail_pool. Browser patchright + spoof fingerprint per akun
// (config deterministik dari fingerprint-spoof) + proxy DataImpulse sticky
// sid gmail-<id> supaya IP dan fingerprint konsisten antar login.
//
// Mode: 'headed' (default, browser tampil, aman untuk akun pertama) atau
// 'headless' (untuk batch). Dipilih via parameter API/CLI, bukan hardcode.
//
// Hasil: db.setGmailLoginStatus(id, status, waktu) dengan status:
//   ok           → login berhasil, cookie tersimpan
//   2fa_prompt   → Google minta kode 2FA (akun ternyata sudah punya 2FA seller)
//   checkpoint   → verifikasi keamanan Google (HP/recovery) — berhenti rapi
//   bad_password → password ditolak
//   error        → kesalahan teknis (proxy, selector, timeout)
// Cookie sukses disimpan di sessions/gmail-<id>/cookies.json (pola kanonis panel).
// Tahap 2 (setup 2FA otomatis) menempel di modul ini setelah status 'ok'.

const { spawn } = require('child_process');
const path = require('path');
require('dotenv').config(); // ENCRYPTION_KEY wajib utk decrypt password pool

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(__dirname, 'gmail-login-worker.js');

// AUTO-RETRY verify_block (prinsip penjual #2: JANGAN ganti IP — job akan
// berulang dari profil & IP yang sama, karena "verifikasi diri" Google sering
// lolos di percobaan berikutnya bila polanya konsisten, bukan bila IP berpindah.
// Delay acak 6-24 jam: terlalu cepat = pola bot, terlalu lama = operator hilang
// kesabaran). Job disimpan di map terpisah supaya status() bisa menjawab
// "menunggu retry" tanpa proses child hidup. Maks 3 percobaan; config via env:
// GMAIL_LOGIN_RETRY_MS (min delay ms, default 6 jam) dan
// GMAIL_LOGIN_RETRY_MAX_MS (max delay ms, default 24 jam).
const RETRY_MIN_MS = Number(process.env.GMAIL_LOGIN_RETRY_MS) || 6 * 60 * 60 * 1000;
const RETRY_MAX_MS = Number(process.env.GMAIL_LOGIN_RETRY_MAX_MS) || 24 * 60 * 60 * 1000;
const RETRY_LIMIT = 3;
const retryTimers = new Map(); // gmailId -> { timer, attempt, lastResult }

// Satu job per akun; state di memori (pola sama dengan create-runner activationJobs).
const jobs = new Map();
const MAX_LINES = 400;

function pushLog(job, line) {
  const t = String(line).replace(/\u0000/g, '').replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').trimEnd();
  if (!t.trim()) return;
  job.log.push(t.slice(0, 500));
  if (job.log.length > MAX_LINES) job.log.splice(0, job.log.length - MAX_LINES);
}

function pub(job) {
  if (!job) return { status: 'idle' };
  // confirmNumber: nomor "ketuk di HP" yang diminta Google, di-parse dari log
  // stage worker. UI menampilkannya besar di panel live.
  const cm = typeof job.confirmNumber === 'string'
    ? job.confirmNumber
    : ((job.stage || '').match(/ketuk angka (\d{1,3})/i) || [])[1] || null;
  return {
    status: job.status, gmailId: job.gmailId, email: job.email, mode: job.mode,
    startedAt: job.startedAt, finishedAt: job.finishedAt, exitCode: job.exitCode,
    stage: job.stage || null, confirmNumber: cm,
    elapsedMs: Date.now() - new Date(job.startedAt).getTime(),
    result: job.result || null, log: job.log.slice(-150),
  };
}

function start(db, gmailId, mode = 'headed', proxyOverride = null, optOverrides = null, retryMeta = null) {
  // optOverrides { noProxy, manualCaptcha }: jalur IP asli (Google lebih percaya
  // IP yang biasa dipakai akun) + captcha diselesaikan manual di browser
  // (worker menunggu max 10 menit, browser tidak ditutup).
  const id = Number(gmailId) || 0;
  if (!id) return Promise.resolve({ error: 'id tidak valid' });
  const m = ['headed', 'headless'].includes(mode) ? mode : 'headed';
  const current = jobs.get(id);
  if (current && current.status === 'running') return Promise.resolve({ error: 'already_running' });

  // rawAll ASYNC (pelajaran bug 404 2026-10-08): tanpa await, Promise bukan
  // array sehingga SEMUA akun terbaca tidak_ditemukan. Sekarang start async.
  return (async () => {
    const row = await db.rawAll('SELECT id, email, password_enc FROM gmail_pool WHERE id = ?', [id]);
    if (!row || !row.length) return { error: 'tidak_ditemukan' };
    let password = null;
    try { password = require('./crypto').decrypt(row[0].password_enc); } catch (e) { password = null; }
    if (!password) return { error: 'password_rusak' };

  const job = {
    gmailId: id, email: row[0].email, mode: m, status: 'running',
    startedAt: new Date().toISOString(), finishedAt: null, exitCode: null,
    stage: 'Menyiapkan job login', result: null, confirmNumber: null,
    log: [], proc: null,
    proxyOverride, optOverrides, // disimpan utk auto-retry (profil & IP tetap)
    retryAttempt: retryMeta ? retryMeta.autoRetryAttempt : null,
  };
  jobs.set(id, job);
  if (retryMeta) console.log(`[gmail-login] auto-retry #${retryMeta.autoRetryAttempt} untuk akun #${id} dimulai.`);

  const args = [SCRIPT, String(id), row[0].email, password, '--mode', m];
  if (proxyOverride) args.push('--proxy', String(proxyOverride));
  if (optOverrides && optOverrides.noProxy) args.push('--no-proxy');
  if (optOverrides && optOverrides.manualCaptcha) args.push('--wait-manual');

  let child;
  try {
    child = spawn('node', args, { cwd: ROOT, windowsHide: false });
  } catch (e) {
    job.status = 'error'; job.finishedAt = new Date().toISOString();
    pushLog(job, 'spawn gagal: ' + (e.message || e));
    return { error: 'spawn_gagal' };
  }
  job.proc = child;
  pushLog(job, `Login Gmail #${id} (${row[0].email}) mode ${m} dimulai.`);
  const onLine = (l) => {
    pushLog(job, l);
    // Baris [stage] dari worker jadi indikator tahap untuk UI (spin ditampilkan
    // hanya saat job masih running, jadi tahap terakhir tidak terbawa ke status
    // done/failed — pub() yang memutuskan).
    const sm = l.match(/^\[stage\] (.+)$/);
    if (sm) job.stage = sm[1].trim().slice(0, 120);
    // Hasil final worker (baris status) + detail risiko bila ada.
    const rm = l.match(/^\[gmail-login\] status akun #\d+ -> (\w+)$/);
    if (rm) job.result = rm[1];
    if (/risiko Google|tidak dapat memverifikasi/.test(l)) job.detail = 'verify_block';
    const ckm = l.match(/ketuk angka (\d{1,3})/i);
    if (ckm) job.confirmNumber = ckm[1];
  };
  child.stdout.on('data', (d) => d.toString().split('\n').forEach(onLine));
  child.stderr.on('data', (d) => d.toString().split('\n').forEach((l) => { pushLog(job, '[err] ' + l); }));
  child.on('exit', (code) => {
    job.exitCode = code;
    job.status = code === 0 ? 'done' : 'failed';
    job.finishedAt = new Date().toISOString();
    pushLog(job, `Selesai (exit ${code}), status akun: ${job.result || 'tidak dilaporkan'}`);
    // Tulis status + riwayat dari PROSES SERVER (sql.js per-proses: tulisan
    // worker ke file tidak terlihat memori server, API jadi basi kalau tidak).
    const detail = job.confirmNumber ? `konfirmasi HP: ketuk ${job.confirmNumber}`
      : job.result === 'verify_block' ? 'Google: tidak dapat memverifikasi diri (coba IP asli)'
      : job.result === 'captcha_timeout' ? 'Captcha manual tidak selesai dalam 10 menit (coba lagi, siapkan waktu)'
      : job.result === 'captcha' ? 'Captcha muncul tanpa opsi "Selesaikan captcha manual"'
      : null;
    const writes = [db.addGmailLoginLog(id, m, job.result || 'error', detail)];
    if (job.result) writes.push(db.setGmailLoginStatus(id, job.result, job.finishedAt));
    Promise.all(writes).then(() => {
      // AUTO-RETRY verify_block: hanya bila result memang verify_block (dilarang
      // berulang di error teknis; attempt sudah mentok tidak dijadwalkan lagi).
      if (job.result === 'verify_block') scheduleRetry(db, id, job);
      else if (job.result !== 'error') retryTimers.delete(id); // sukses/2fa/captcha §dll: hapus rencana retry.
    }).catch((e) => pushLog(job, '[err] simpan riwayat gagal: ' + (e.message || e)));
  });
  return pub(job);
  })();
}

function status(gmailId) { return pub(jobs.get(Number(gmailId) || 0)); }

// Info auto-retry utk API: attempt aktif + jadwal, atau null.
function retryInfo(gmailId) {
  const r = retryTimers.get(Number(gmailId) || 0);
  if (!r) return null;
  return { attempt: r.attempt, limit: RETRY_LIMIT, retryAt: r.retryAt, lastResult: r.lastResult };
}

function stop(gmailId) {
  const job = jobs.get(Number(gmailId) || 0);
  // Batalkan juga auto-retry yang menunggu: operator yang menekan Stop
  // berarti tidak ingin percobaan otomatis berikutnya.
  const r = retryTimers.get(Number(gmailId) || 0);
  if (r) { clearTimeout(r.timer); retryTimers.delete(Number(gmailId) || 0); }
  if (!job || job.status !== 'running') return { ok: true, retryCanceled: !!r };
  try { job.proc.kill(); } catch (e) { /* sudah mati */ }
  return { ok: true, retryCanceled: !!r };
}

// CLI langsung: node src/gmail-login.js <id> [--headed|--headless] [--proxy "..."]
// Mode runner: dipanggil server.js via start(db, id, mode, proxyOverride).
if (require.main === module) {
  const dbMod = require('./db');
  const argv = process.argv.slice(2);
  const idArg = Number(argv[0]) || 0;
  const m = argv.includes('--headless') ? 'headless' : 'headed';
  const pi = argv.indexOf('--proxy');
  const proxy = pi !== -1 && argv[pi + 1] ? argv[pi + 1] : null;
  dbMod.waitReady().then(() => {
    // CLI mode: start akan spawn worker; tunggu job selesai lalu keluar.
    const r = start(dbMod, idArg, m, proxy);
    if (r.error) { console.error('GAGAL:', r.error); process.exit(1); }
    const iv = setInterval(() => {
      const st = status(idArg);
      if (st.status === 'done' || st.status === 'failed') {
        clearInterval(iv);
        console.log(st.log.slice(-10).join('\n'));
        process.exit(st.status === 'done' ? 0 : 2);
      }
    }, 2000);
  }).catch((e) => { console.error('DB error:', e.message); process.exit(1); });
}

function scheduleRetry(db, id, job) {
  const prev = retryTimers.get(id);
  const attempt = (prev ? prev.attempt : 0) + 1;
  if (attempt > RETRY_LIMIT) {
    pushLog(job, `[retry] Batas ${RETRY_LIMIT} percobaan otomatis tercapai — berhenti, coba manual.`);
    return;
  }
  const delay = RETRY_MIN_MS + Math.floor(Math.random() * (RETRY_MAX_MS - RETRY_MIN_MS));
  const retryAt = new Date(Date.now() + delay).toISOString();
  const hours = (delay / 3600000).toFixed(1);
  pushLog(job, `[retry] verify_block → login ulang otomatis #${attempt}/${RETRY_LIMIT} dalam ${hours} jam (profil & IP sama, sesuai pola konsisten).`);
  const timer = setTimeout(async () => {
    retryTimers.delete(id);
    // PENTING: retry memakai opsi PERSIS job sebelumnya (mode/proxy/noProxy/
    // manualCaptcha) supaya profil & IP tidak berganti — itu inti tip #2.
    const o = job.optOverrides || {};
    await start(db, id, job.mode, job.proxyOverride, o, { autoRetryAttempt: attempt });
  }, delay);
  retryTimers.set(id, { timer, attempt, retryAt, lastResult: job.result || 'verify_block' });
}

module.exports = { start, status, stop, retryInfo, scheduleRetry };
