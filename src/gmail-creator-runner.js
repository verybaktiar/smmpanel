'use strict';
// Runner Gmail Creator: dua backend.
// 1) gmail-infinity (PILIHAN UTAMA): open-source Python/Playwright di
//    tools/gmail-infinity (klon + venv). Sudah diaudit 2026-10-03: tanpa
//    exec/eval/obfuscation; hanya menghubungi Google, penyedia SMS opsional
//    (5sim/sms-activate/getsms), solver captcha opsional, dan ipify.
//    Hasil: data/database.db SQLite (tabel accounts, email + password polos,
//    dienkripsi ulang saat masuk pool panel).
// 2) auto_gmail_creator.exe (LAMA, fallback): closed-source, sekarang usang
//    (selector kalah cepat dari perubahan UI Google).
// Keduanya TUI konsol interaktif: panel membuka jendela konsolnya sendiri via
// `start /wait` dan TIDAK memipa stdout (pelajaran 2026-10-03: rich crash
// UnicodeEncodeError saat stdout dipipa). Setelah jendela ditutup, hasil
// diimpor otomatis ke tabel gmail_pool.

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const db = require('./db');

const TOOL_DIR = path.join(__dirname, '..', 'tools', 'gmail-creator');
const EXE = path.join(TOOL_DIR, 'auto_gmail_creator.exe');
const ACCOUNTS_JSON = path.join(TOOL_DIR, 'data', 'accounts.json');

const INF_DIR = path.join(__dirname, '..', 'tools', 'gmail-infinity');
const INF_PY = path.join(INF_DIR, 'venv', 'Scripts', 'python.exe');
const INF_DB = path.join(INF_DIR, 'data', 'database.db');

let job = null; // satu job dalam satu waktu
const MAX_LINES = 400;

function pushLog(j, line) {
  let t = String(line).replace(/\u0000/g, '').replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').trimEnd();
  if (!t.trim()) return;
  j.log.push(t.slice(0, 500));
  if (j.log.length > MAX_LINES) j.log.splice(0, j.log.length - MAX_LINES);
}

function pub(j) {
  if (!j) return { status: 'idle', log: [] };
  return {
    status: j.status, startedAt: j.startedAt, finishedAt: j.finishedAt,
    exitCode: j.exitCode, imported: j.imported || 0, log: j.log.slice(-150),
  };
}

function hasInfinity() { return fs.existsSync(INF_PY); }
function hasExe() { return fs.existsSync(EXE); }

// Impor hasil gmail-infinity dari SQLite-nya. Semua baris tabel accounts adalah
// akun yang berhasil dibuat (upsert saat sukses); duplikat ditolak UNIQUE pool.
async function importInfinity(logSink) {
  let DatabaseSync;
  try {
    ({ DatabaseSync } = require('node:sqlite'));
  } catch (e) {
    logSink('node:sqlite tidak tersedia: ' + (e.message || e));
    return 0;
  }
  if (!fs.existsSync(INF_DB)) {
    logSink('database.db tool belum ada (belum ada putaran sukses).');
    return 0;
  }
  const d = new DatabaseSync(INF_DB, { readOnly: true });
  let rows = [];
  try {
    rows = d.prepare('SELECT email, password FROM accounts ORDER BY id DESC').all();
  } finally {
    d.close();
  }
  let n = 0;
  for (const r of rows) {
    if (!r.email || !r.password) continue;
    try {
      await db.addGmail({ email: r.email, password: r.password, source: 'gmail-infinity' });
      n++;
    } catch (e) { /* duplikat / tak valid: lewati */ }
  }
  return n;
}

// Impor hasil exe lama dari data/accounts.json (format upstream lama).
async function importExe(logSink) {
  let entries = [];
  try {
    const raw = fs.readFileSync(ACCOUNTS_JSON, 'utf8');
    const j = JSON.parse(raw);
    entries = Array.isArray(j) ? j : (Array.isArray(j.accounts) ? j.accounts : [j]);
  } catch (e) {
    logSink('accounts.json tidak terbaca: ' + (e.message || e));
    return 0;
  }
  let n = 0;
  for (const e of entries) {
    if (!e || !e.email) continue;
    try {
      await db.addGmail({ email: e.email, password: e.password || '', source: 'gmail-creator' });
      n++;
    } catch (err) { /* duplikat / tak valid: lewati */ }
  }
  return n;
}

function startJob() {
  if (job && job.status === 'running') return { error: 'already_running' };
  if (process.platform !== 'win32') return { error: 'tool ini hanya berkas Windows' };
  const useInfinity = hasInfinity();
  if (!useInfinity && !hasExe()) {
    return { error: 'tool belum disiapkan (venv gmail-infinity dan exe sama-sama tidak ada)' };
  }
  job = { status: 'running', startedAt: new Date().toISOString(), finishedAt: null, exitCode: null, imported: 0, log: [] };
  const j = job;
  pushLog(j, useInfinity
    ? 'Menjalankan Gmail Creator Pro v5 (open-source, tersembunyi, log live di sini)...'
    : 'Membuka jendela Gmail Creator Pro (exe lama)...');

  if (useInfinity) pushLog(j, 'Jawab menu lewat tombol panel (endpoint /api/gmail/run/input) atau kirim dari UI.');

  // Infinity: spawn Python LANGSUNG tanpa jendela (teruji: TUI rich aman dipipa,
  // entry point-nya men-set UTF-8 errors=replace sendiri) sehingga panel dapat
  // log live DAN mengirim pilihan menu via stdin. Pola `start /wait` HANYA untuk
  // exe lama yang TUI-nya crash saat dipipa (butuh konsol nyata).
  let child;
  try {
    child = useInfinity
      ? spawn(INF_PY, ['-u', 'auto_gmail_creator.py'], {
          cwd: INF_DIR,
          stdio: ['pipe', 'pipe', 'pipe'],
          windowsHide: true,
          env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8', PYTHONUNBUFFERED: '1' },
        })
      : spawn('cmd.exe', ['/c', 'start', '""', '/wait', `"${EXE}"`], {
          cwd: TOOL_DIR,
          stdio: 'ignore',
          windowsHide: true,
          windowsVerbatimArguments: true,
          env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
        });
  } catch (e) {
    j.status = 'failed'; j.finishedAt = new Date().toISOString();
    pushLog(j, 'Gagal menjalankan tool: ' + (e.message || e));
    return { ok: true, job: pub(j) };
  }
  j.child = child;
  if (useInfinity) {
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    let buf = '';
    let pendingIdx = -1; // indeks baris prompt-parsial (« ... ») yang belum selesai
    const onChunk = (c) => {
      buf += c;
      let idx;
      while ((idx = buf.search(/[\r\n]/)) >= 0) {
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 1);
        pushLog(j, line);
        pendingIdx = -1;
      }
      // Prompt tanpa newline (mis. "Select operation ... (1): ") tetap harus
      // terlihat operator: tampilkan sebagai baris parsial yang diperbarui.
      const rest = buf;
      if (rest.trim()) {
        const line = '» ' + rest.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').slice(0, 200);
        if (pendingIdx >= 0 && pendingIdx < j.log.length) j.log[pendingIdx] = line;
        else { j.log.push(line); pendingIdx = j.log.length - 1; }
      } else {
        pendingIdx = -1;
      }
    };
    child.stdout.on('data', onChunk);
    child.stderr.on('data', onChunk);
  }
  child.on('error', (e) => {
    j.status = 'failed'; j.finishedAt = new Date().toISOString();
    pushLog(j, 'Proses gagal: ' + (e.message || e));
  });
  child.on('close', async (code) => {
    j.exitCode = code;
    try { if (child.stdin && !child.stdin.destroyed) child.stdin.end(); } catch (e) { /* abaikan */ }
    pushLog(j, `Jendela tool ditutup (kode ${code}). Memeriksa hasil...`);
    try {
      const n = useInfinity ? await importInfinity((line) => pushLog(j, line)) : await importExe((line) => pushLog(j, line));
      j.imported = n;
      pushLog(j, n > 0 ? `${n} akun Gmail diimpor ke pool.` : 'Tidak ada akun baru untuk diimpor.');
    } catch (e) {
      pushLog(j, 'Gagal impor hasil: ' + (e.message || e));
    }
    j.status = code === 0 ? 'done' : 'failed';
    j.finishedAt = new Date().toISOString();
  });
  return { ok: true, job: pub(j) };
}

function stopJob() {
  if (!job || job.status !== 'running' || !job.child) return { error: 'no_running_job' };
  // Hentikan SELURUH pohon proses: cmd (wait) + jendela tool-nya.
  try {
    spawn('taskkill', ['/PID', String(job.child.pid), '/T', '/F'], { windowsHide: true });
  } catch (e) { /* abaikan */ }
  pushLog(job, 'Dihentikan operator (jendela tool ditutup paksa).');
  return { ok: true };
}

// Kirim satu baris ke stdin tool infinity (jawaban menu/prompt).
function sendInput(text) {
  if (!job || job.status !== 'running' || !job.child || !job.child.stdin) return { error: 'no_running_job' };
  try {
    job.child.stdin.write(String(text).replace(/[\r\n]+$/, '') + '\n');
    pushLog(job, `[panel] kirim: ${String(text).slice(0, 60)}`);
    return { ok: true };
  } catch (e) {
    return { error: 'gagal menulis ke proses: ' + (e.message || e) };
  }
}

module.exports = {
  status: () => pub(job),
  start: startJob,
  stop: stopJob,
  input: sendInput,
  hasInfinity,
  hasExe: () => hasExe(),
};
