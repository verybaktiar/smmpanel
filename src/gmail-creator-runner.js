'use strict';
// Runner Gmail Creator Pro (tools/gmail-creator/auto_gmail_creator.exe).
// Satu job dalam satu waktu: spawn exe, kirim pilihan menu ke stdin, pompa log,
// lalu impor hasil dari data/accounts.json (output upstream) ke tabel gmail_pool.
// Alasan bukan library (R-31): upstream tertutup kode dan interaktif via menu
// konsol, jadi satu-satunya jalur otomatis yang jujur adalah subprocess.

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
  const t = String(line).replace(/\u0000/g, '').trimEnd();
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
async function importResults(t0, notes) {
  let entries = [];
  try {
    const raw = fs.readFileSync(ACCOUNTS_JSON, 'utf8');
    const j = JSON.parse(raw);
    entries = Array.isArray(j) ? j : (Array.isArray(j.accounts) ? j.accounts : [j]);
  } catch (e) {
    notes.push('accounts.json tidak terbaca: ' + (e.message || e));
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
  pushLog(j, 'Menjalankan Gmail Creator Pro (mode 1 akun, tanpa proxy)...');

  let child;
  try {
    child = spawn(EXE, [], { cwd: TOOL_DIR, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: false });
  } catch (e) {
    j.status = 'failed'; j.finishedAt = new Date().toISOString();
    pushLog(j, 'Gagal menjalankan exe: ' + (e.message || e));
    return { ok: true, job: pub(j) };
  }
  j.child = child;
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  let buf = '';
  const onChunk = (c) => {
    buf += c;
    let idx;
    while ((idx = buf.search(/[\r\n]/)) >= 0) {
      const line = buf.slice(0, idx);
      buf = buf.slice(idx + 1);
      pushLog(j, line);
    }
  };
  child.stdout.on('data', onChunk);
  child.stderr.on('data', onChunk);

  // Kirim pilihan menu: opsi 1 = buat akun (alur utama tool upstream).
  setTimeout(() => { try { child.stdin.write('1\n'); } catch (e) { /* proses sudah tutup */ } }, 2500);

  child.on('error', (e) => {
    j.status = 'failed'; j.finishedAt = new Date().toISOString();
    pushLog(j, 'Proses gagal: ' + (e.message || e));
  });
  child.on('close', async (code) => {
    j.exitCode = code;
    pushLog(j, `Proses berakhir (kode ${code}). Memeriksa hasil...`);
    try {
      const n = await importResults(t0, j.log);
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
  try { job.child.kill(); } catch (e) { /* abaikan */ }
  pushLog(job, 'Dihentikan operator.');
  return { ok: true };
}

module.exports = {
  status: () => pub(job),
  start: startJob,
  stop: stopJob,
  hasBinary: () => fs.existsSync(EXE),
};
