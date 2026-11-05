'use strict';
// Orkestra farm-HP tahap 1: antrean kerja per device via file JSON.
// Kenapa file, bukan DB: server dan worker proses terpisah dengan DB in-memory
// masing-masing; file dibaca segar tiap akses sehingga tak ada state basi.
// 1 device = 1 kerjaan aktif. Cooldown create 24 jam per device (aturan besi).
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'farm-jobs');
const COOLDOWN_MS = 24 * 3600 * 1000;

function ensureDir() { fs.mkdirSync(DIR, { recursive: true }); }
function jobPath(id) { return path.join(DIR, `${String(id).replace(/[^a-zA-Z0-9_-]/g, '')}.json`); }
function lastPath(deviceId) { return path.join(DIR, `last-${String(deviceId).replace(/[^a-zA-Z0-9_-]/g, '')}.json`); }

function readJson(f, fb) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return fb; } }
function writeJson(f, o) { ensureDir(); fs.writeFileSync(f, JSON.stringify(o, null, 2)); }

function newId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

// Status device: idle | working (+ alasan bila terkunci cooldown)
function deviceState(deviceId) {
  ensureDir();
  const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.json') && !f.startsWith('last-'));
  for (const f of files) {
    const j = readJson(path.join(DIR, f), null);
    if (j && j.deviceId === deviceId && (j.status === 'queued' || j.status === 'working')) {
      return { state: 'working', jobId: j.id };
    }
    // Grace 60 dtk: sopir butuh ≤15 dtk untuk sadar & keluar setelah cancel.
    // Tanpa ini device langsung idle dan job baru bisa menabrak sopir lama.
    if (j && j.deviceId === deviceId && j.status === 'cancelled'
      && j.updated_at && Date.now() - new Date(j.updated_at).getTime() < 60000) {
      return { state: 'working', jobId: j.id };
    }
  }
  const last = readJson(lastPath(deviceId), null);
  if (last && last.at && Date.now() - last.at < COOLDOWN_MS) {
    const sisa = Math.ceil((COOLDOWN_MS - (Date.now() - last.at)) / 3600000);
    return { state: 'locked', reason: `cooldown create, sisa ~${sisa} jam` };
  }
  return { state: 'idle' };
}

function queueJob(deviceId, platform, payload) {
  deviceId = String(deviceId || '').trim();
  platform = String(platform || '').trim().toLowerCase();
  if (!deviceId) return { error: 'deviceId wajib.' };
  if (!['ig', 'fb', 'tiktok'].includes(platform)) return { error: 'platform harus ig/fb/tiktok.' };
  payload = payload || {};
  const st = deviceState(deviceId);
  // Job nav-only (tes navigasi tanpa submit) TIDAK membakar reputasi platform,
  // jadi boleh jalan walau device masih cooldown create — proteksi sesungguhnya
  // ditegakkan sopir di mode --go (cek lastCreate + konfirmasi eksplisit).
  const navOnly = !!payload.navOnly;
  if (st.state !== 'idle' && !(navOnly && st.state === 'locked')) {
    return { error: st.state === 'locked' ? st.reason : `HP sibuk (job ${st.jobId}). Antre? tunggu selesai.` };
  }
  const job = {
    id: newId(), deviceId, platform, payload: payload || {},
    status: 'queued', step: 0, total: 9, note: 'menunggu sopir',
    steps: [], created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  };
  writeJson(jobPath(job.id), job);
  return job;
}

function listJobs(deviceId, limit = 50) {
  ensureDir();
  const out = [];
  for (const f of fs.readdirSync(DIR).filter((f) => f.endsWith('.json') && !f.startsWith('last-') && !f.startsWith('arsip-'))) {
    const j = readJson(path.join(DIR, f), null);
    if (j && (!deviceId || j.deviceId === deviceId)) out.push(j);
  }
  out.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
  return out.slice(0, limit).map((j) => ({ ...j, steps: undefined })); // ringkas, detail via getJob
}

function getJob(id) { return readJson(jobPath(id), null); }

function saveJob(job) { job.updated_at = new Date().toISOString(); writeJson(jobPath(job.id), job); return job; }

function reportStep(id, step, total, status, note) {
  const job = getJob(id);
  if (!job) return { error: 'job tak ketemu.' };
  if (job.status === 'done' || job.status === 'failed' || job.status === 'cancelled') return { error: `job sudah ${job.status}.` };
  job.status = 'working';
  job.step = Number(step) || job.step;
  if (Number(total) > 0) job.total = Number(total);
  job.note = String(note || status || '').slice(0, 320);
  job.steps.push({ step: job.step, status: String(status || ''), note: job.note, at: new Date().toISOString() });
  if (job.steps.length > 60) job.steps = job.steps.slice(-60);
  return saveJob(job);
}

function finishJob(id, ok, note) {
  const job = getJob(id);
  if (!job) return { error: 'job tak ketemu.' };
  // Job yang dibatalkan operator jangan ditimpa sopir yang telat sadar.
  if (job.status === 'cancelled') return job;
  job.status = ok ? 'done' : 'failed';
  job.note = String(note || '').slice(0, 320);
  saveJob(job);
  // Create sukses = catat waktu untuk cooldown 24 jam device ini.
  // Nav-only TIDAK create — tidak memicu cooldown.
  if (ok && !(job.payload && job.payload.navOnly)
    && (job.platform === 'ig' || job.platform === 'fb' || job.platform === 'tiktok')) {
    writeJson(lastPath(job.deviceId), { at: Date.now(), jobId: job.id, platform: job.platform });
  }
  return job;
}

// Waktu create terakhir per device (untuk guard di sopir mode --go & UI badge).
function lastCreate(deviceId) { return readJson(lastPath(deviceId), null); }

// Tempel OTP (dari manusia via UI atau auto-poll mail worker) ke payload job.
function appendOtp(jobId, code) {
  const job = getJob(jobId);
  if (!job) return { error: 'job tak ketemu.' };
  job.payload = { ...(job.payload || {}), otp: String(code).replace(/\D/g, '').slice(0, 8) };
  return saveJob(job);
}

// Nomor HP dari panel (diketik operator di frontend, SISTEM yang mengetik ke HP).
// Driver langkah 7 mem-poll payload.phone tiap 15 dtk lalu mengetiknya via ADB.
function appendPhone(jobId, phone) {
  const job = getJob(jobId);
  if (!job) return { error: 'job tak ketemu.' };
  job.payload = { ...(job.payload || {}), phone: String(phone).replace(/[^\d+]/g, '').slice(0, 18) };
  return saveJob(job);
}

// Batalkan job dari panel (tombol Stop). Sopir yang masih jalan memeriksa
// status ini tiap langkah / tiap poll lalu berhenti sendiri (≤15 dtk).
function cancelJob(id, note) {
  const job = getJob(id);
  if (!job) return { error: 'job tak ketemu.' };
  if (job.status === 'done' || job.status === 'failed') return { error: `job sudah ${job.status}.` };
  job.status = 'cancelled';
  job.note = String(note || 'dibatalkan operator').slice(0, 200);
  return saveJob(job);
}

function jobsRoot() { ensureDir(); return DIR; }

module.exports = { deviceState, queueJob, listJobs, getJob, saveJob, reportStep, finishJob, lastCreate, appendOtp, appendPhone, cancelJob, jobsRoot, COOLDOWN_MS };
