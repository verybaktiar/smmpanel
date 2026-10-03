'use strict';
// Runner Gmail Creator Pro (tools/gmail-creator/auto_gmail_creator.exe).
// Satu job dalam satu waktu. Temuan nyata 2026-10-03: TUI `rich` upstream
// crash "UnicodeEncodeError: charmap codec" saat stdout-nya DIPIPA (renderer
// legacy Windows meng-encode cp1252), dan PYTHONUTF8/PYTHONIOENCODING tidak
// menolong karena kode upstream tertutup. Maka pola final: tool dapat jendela
// konsolnya SENDIRI via `start /wait` (operator melihat dan mengendalikan
// menunya langsung), panel tidak memipa stdout-nya sama sekali, dan hasil
// data/accounts.json diimpor otomatis saat jendela ditutup.

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const db = require('./db');

const TOOL_DIR = path.join(__dirname, '..', 'tools', 'gmail-creator');
const EXE = path.join(TOOL_DIR, 'auto_gmail_creator.exe');
const ACCOUNTS_JSON = path.join(TOOL_DIR, 'data', 'accounts.json');

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

// Baca data/accounts.json, impor entri yang lebih baru dari t0 (hindari duplikat
// dari run lama: tool menimpa/menambah file dengan seluruh riwayat akunnya).
async function importResults(t0, logSink) {
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
    const created = String(e.created_at || e.date || e.timestamp || '');
    if (t0 && created && new Date(created).getTime() < t0) continue; // hasil run lama
    try {
      await db.addGmail({ email: e.email, password: e.password || '', source: 'gmail-creator' });
      n++;
    } catch (err) { /* duplikat / tak valid: lewati */ }
  }
  return n;
}

function startJob() {
  if (job && job.status === 'running') return { error: 'already_running' };
  if (process.platform !== 'win32') return { error: 'tool ini hanya berkas Windows (.exe)' };
  if (!fs.existsSync(EXE)) return { error: 'binary belum diunduh. Jalankan: node scripts/fetch-gmail-creator.js' };
  const t0 = Date.now() - 5000; // toleransi 5 dtk antara start dan waktu file
  job = { status: 'running', startedAt: new Date().toISOString(), finishedAt: null, exitCode: null, imported: 0, log: [] };
  const j = job;
  pushLog(j, 'Membuka jendela Gmail Creator Pro (mode 1 akun, tanpa proxy)...');
  pushLog(j, 'Pilih menu di jendela tool. Hasil diimpor otomatis ke stok setelah jendelanya ditutup.');

  // `start "" /wait` membuka konsol BARU milik exe sendiri: TUI rich ter-render
  // ke konsol nyata (bebas bug cp1252 pipa) dan operator bisa mengetik menunya.
  // cmd /wait menunggu exe selesai sehingga event close = jendela ditutup.
  let child;
  try {
    child = spawn('cmd.exe',
      ['/c', 'start', '""', '/wait', `"${EXE}"`],
      { cwd: TOOL_DIR, stdio: 'ignore', windowsHide: true, windowsVerbatimArguments: true,
        env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' } });
  } catch (e) {
    j.status = 'failed'; j.finishedAt = new Date().toISOString();
    pushLog(j, 'Gagal menjalankan exe: ' + (e.message || e));
    return { ok: true, job: pub(j) };
  }
  j.child = child;
  child.on('error', (e) => {
    j.status = 'failed'; j.finishedAt = new Date().toISOString();
    pushLog(j, 'Proses gagal: ' + (e.message || e));
  });
  child.on('close', async (code) => {
    j.exitCode = code;
    pushLog(j, `Jendela tool ditutup (kode ${code}). Memeriksa hasil...`);
    try {
      const n = await importResults(t0, (line) => pushLog(j, line));
      j.imported = n;
      pushLog(j, n > 0 ? `${n} akun Gmail diimpor ke pool.` : 'Tidak ada akun baru di accounts.json.');
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
  // Hentikan SELURUH pohon proses: cmd (wait) + jendela exe-nya.
  try {
    spawn('taskkill', ['/PID', String(job.child.pid), '/T', '/F'], { windowsHide: true });
  } catch (e) { /* abaikan */ }
  pushLog(job, 'Dihentikan operator (jendela tool ditutup paksa).');
  return { ok: true };
}

module.exports = {
  status: () => pub(job),
  start: startJob,
  stop: stopJob,
  hasBinary: () => fs.existsSync(EXE),
};
