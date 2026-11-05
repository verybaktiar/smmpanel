'use strict';
// Runner Pembuka Sesi Gmail — dipakai endpoint server POST /api/gmail/:id/open.
// Pola sama dengan gmail-login.js (job per akun, state memori, spawn worker)
// tapi lebih sederhana: tidak perlu riwayat, cukup status job (starting/open/
// done/failed/<id> tidak dobel spawn).

const { spawn } = require('child_process');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(__dirname, 'gmail-open.js');

const jobs = new Map(); // id → { status, startedAt, stage, log }
const MAX_LINES = 120;

function pushLog(job, line) {
  const t = String(line).replace(/\u0000/g, '').trimEnd();
  if (!t.trim()) return;
  job.log.push(t.slice(0, 400));
  if (job.log.length > MAX_LINES) job.log.splice(0, job.log.length - MAX_LINES);
}

function pub(job) {
  if (!job) return { status: 'idle' };
  return {
    status: job.status, gmailId: job.gmailId, email: job.email,
    startedAt: job.startedAt, stage: job.stage || null, once: !!job.once,
    sessionAlive: job.sessionAlive === undefined ? null : job.sessionAlive,
    log: job.log.slice(-40),
  };
}

function start(gmailId, email, optOverrides = null, proxyOverride = null) {
  // optOverrides { once }: mode refresh terjadwal (headless, cookie tersimpan ulang).
  const id = Number(gmailId) || 0;
  if (!id || !email) return { error: 'argumen kurang' };
  const cur = jobs.get(id);
  if (cur && cur.status === 'open') return { error: 'already_open' };

  const job = {
    gmailId: id, email, status: 'starting', startedAt: new Date().toISOString(),
    stage: 'Menyiapkan jendela Gmail', log: [], proc: null,
    once: !!(optOverrides && optOverrides.once),
    noProxy: !!(optOverrides && optOverrides.noProxy), // IP asli: jalur sama dgn login
  };
  jobs.set(id, job);

  const args = [SCRIPT, String(id), email];
  if (job.once) args.push('--once');
  if (job.noProxy) args.push('--no-proxy');
  if (proxyOverride) args.push('--proxy', String(proxyOverride));
  let child;
  try {
    child = spawn('node', args, { cwd: ROOT });
  } catch (e) {
    job.status = 'failed';
    pushLog(job, 'spawn gagal: ' + (e.message || e));
    return pub(job);
  }
  job.proc = child;
  pushLog(job, `Buka Gmail #${id} (${email})`);
  child.stdout.on('data', (d) => d.toString().split('\n').forEach((l) => {
    pushLog(job, l);
    // Verifikasi auth dari worker (SESI_DIVERIFIKASI/SESI_HABIS) → tulis DB dari
    // proses SERVER (sql.js per-proses: tulisan worker tak terlihat memori server).
    if (/SESI_DIVERIFIKASI|SESI_HIDUP/.test(l)) {
      job.sessionAlive = true;
      job.stage = job.once ? 'Sesi diverifikasi (refresh terjadwal)' : 'Sesi hidup — inbox terbuka';
      const dbMod = require('./db');
      // Refresh login_at: kapan terakhir sesi dibuktikan masih valid.
      dbMod.setGmailLoginStatus(id, 'ok', new Date().toISOString()).catch((e) => pushLog(job, '[err] ' + (e.message || e)));
      // Riwayat 'sesi_diverifikasi' tiap kali Buka/refresh membuktikan cookie hidup.
      dbMod.addGmailLoginLog(id, job.once ? 'refresh' : 'open', 'sesi_diverifikasi', null)
        .catch((e) => pushLog(job, '[err] riwayat gagal: ' + (e.message || e)));
    } else if (/SESI_HABIS/.test(l)) {
      job.sessionAlive = false;
      job.stage = 'Sesi habis — login ulang diperlukan';
      require('./db').setGmailLoginStatus(id, 'expired_session', new Date().toISOString()).catch((e) => pushLog(job, '[err] ' + (e.message || e)));
    }
  }));
  child.stderr.on('data', (d) => d.toString().split('\n').forEach((l) => pushLog(job, '[err] ' + l)));
  child.on('exit', (code) => {
    job.status = code === 0 ? 'closed' : 'failed';
    jobs.delete(id);
    pushLog(job, `Jendela ditutup (exit ${code}).`);
  });
  // Setelah worker 4 detik dan masih hidup, anggap jendela sudah di tangan operator.
  setTimeout(() => {
    if (jobs.get(id) === job && child.exitCode === null && !child.killed) job.status = 'open';
  }, 4000);
  return pub(job);
}

function status(gmailId) { return pub(jobs.get(Number(gmailId) || 0)); }

function stop(gmailId) {
  const job = jobs.get(Number(gmailId) || 0);
  if (!job || !job.proc) return { error: 'tidak_ada_job' };
  try { job.proc.kill(); } catch (e) { /* sudah mati */ }
  return { ok: true };
}

module.exports = { start, status, stop };
