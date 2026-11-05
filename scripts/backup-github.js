#!/usr/bin/env node
'use strict';

// Backup harian database.db + farm-jobs ke GitHub.
// Repo proyek ini publik, jadi isi backup dienkripsi AES-256-GCM dulu memakai
// ENCRYPTION_KEY yang sama dengan sandi akun di database. Yang ter-push hanya
// ciphertext; tidak pernah ada data akun mentah di GitHub.
//
// Pakai:
//   node scripts/backup-github.js                     -> buat snapshot & push
//   node scripts/backup-github.js --pulihkan <file>   -> pulihkan snapshot
//   node scripts/backup-github.js --pulihkan <file> --timpa
//
// Butuh: git terpasang dan kredensial GitHub untuk remote proyek sudah tersimpan.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
require('dotenv').config({ path: path.join(ROOT, '.env'), quiet: true });

const REPO_BACKUP = path.join(ROOT, '.backup-repo');
const BRANCH = 'backup-data';
const SIMPAN = 14; // snapshot harian yang disimpan sebelum yang tertua dibuang
const FILE_DB = path.join(ROOT, 'database.db');
const DIR_JOBS = path.join(ROOT, 'farm-jobs');
const LOG = path.join(ROOT, '.tmp-logs', 'backup-github.log');
const MAGIC = 'SMMBAK1';

function log(pesan) {
  const baris = `[${new Date().toLocaleString('id-ID')}] ${pesan}`;
  console.log(baris);
  try {
    fs.mkdirSync(path.dirname(LOG), { recursive: true });
    fs.appendFileSync(LOG, baris + '\n');
  } catch (e) {
    // Log gagal tidak boleh menggagalkan backup.
  }
}

function kunci() {
  const env = process.env.ENCRYPTION_KEY;
  if (!env || env.length < 32) {
    throw new Error('ENCRYPTION_KEY kosong atau < 32 karakter di .env — backup dibatalkan supaya tidak ada data mentah yang ter-push');
  }
  return crypto.createHash('sha256').update(env).digest();
}

function bundel() {
  if (!fs.existsSync(FILE_DB)) throw new Error('database.db tidak ditemukan');
  const jobs = {};
  if (fs.existsSync(DIR_JOBS)) {
    for (const nama of fs.readdirSync(DIR_JOBS)) {
      if (!nama.endsWith('.json')) continue;
      jobs[nama] = fs.readFileSync(path.join(DIR_JOBS, nama)).toString('base64');
    }
  }
  const isi = {
    dibuat: new Date().toISOString(),
    database: fs.readFileSync(FILE_DB).toString('base64'),
    farmJobs: jobs,
  };
  return { isi, jumlahJob: Object.keys(jobs).length };
}

function enkripsi(buffer) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', kunci(), iv);
  const enc = Buffer.concat([cipher.update(buffer), cipher.final()]);
  return Buffer.concat([Buffer.from(MAGIC, 'ascii'), iv, cipher.getAuthTag(), enc]);
}

function dekripsi(buf) {
  if (buf.slice(0, 7).toString('ascii') !== MAGIC) throw new Error('file ini bukan snapshot SMM Panel');
  const iv = buf.slice(7, 19);
  const tag = buf.slice(19, 35);
  const decipher = crypto.createDecipheriv('aes-256-gcm', kunci(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(buf.slice(35)), decipher.final()]);
}

function git(args, cwd = REPO_BACKUP) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function remoteProyek() {
  return git(['remote', 'get-url', 'origin'], ROOT);
}

function siapkanRepo() {
  const url = remoteProyek();
  if (!fs.existsSync(path.join(REPO_BACKUP, '.git'))) {
    fs.mkdirSync(REPO_BACKUP, { recursive: true });
    git(['init', '-q', '-b', BRANCH]);
    git(['remote', 'add', 'origin', url]);
    log(`repo backup dibuat di .backup-repo (branch ${BRANCH})`);
  } else {
    git(['remote', 'set-url', 'origin', url]);
  }

  // Samakan dengan remote; snapshot bersifat tambah-saja jadi rebase aman.
  try {
    git(['fetch', '-q', 'origin', BRANCH]);
    git(['reset', '-q', '--hard', `origin/${BRANCH}`]);
  } catch (e) {
    // Branch belum ada di remote: ini backup pertama.
  }
}

function jalankanBackup() {
  siapkanRepo();

  const { isi, jumlahJob } = bundel();
  const terenkripsi = enkripsi(Buffer.from(JSON.stringify(isi), 'utf8'));
  const nama = `backup-${new Date().toISOString().slice(0, 10)}.enc`;
  const tujuan = path.join(REPO_BACKUP, nama);
  fs.writeFileSync(tujuan, terenkripsi);

  // Buang snapshot terlama supaya repo tidak membengkak.
  const semua = fs
    .readdirSync(REPO_BACKUP)
    .filter((f) => /^backup-\d{4}-\d{2}-\d{2}\.enc$/.test(f))
    .sort();
  for (const lama of semua.slice(0, Math.max(0, semua.length - SIMPAN))) {
    fs.unlinkSync(path.join(REPO_BACKUP, lama));
    log(`snapshot lama dibuang: ${lama}`);
  }

  git(['add', '-A']);
  const diStage = git(['diff', '--cached', '--name-only']).split('\n').filter(Boolean);
  const bukanEnkripsi = diStage.filter((f) => !f.endsWith('.enc'));
  if (bukanEnkripsi.length) {
    // Pengaman: jangan pernah push apa pun selain ciphertext.
    throw new Error(`ada file non-.enc di stage (${bukanEnkripsi.join(', ')}) — push dibatalkan`);
  }
  if (!diStage.length) {
    log('tidak ada perubahan, tidak ada yang di-push');
    return;
  }

  const pesan = `Backup ${nama.replace('backup-', '').replace('.enc', '')} (database + ${jumlahJob} job)`;
  git(['commit', '-q', '-m', pesan]);

  let terakhir;
  for (let i = 1; i <= 3; i++) {
    try {
      git(['push', '-q', '-u', 'origin', BRANCH]);
      terakhir = null;
      break;
    } catch (e) {
      terakhir = e;
      log(`push gagal (percobaan ${i}/3): ${(e.stderr || e.message || '').toString().split('\n')[0]}`);
      if (i < 3) execFileSync('node', ['-e', 'setTimeout(()=>{},8000)']);
    }
  }
  if (terakhir) throw terakhir;

  const ukuran = (fs.statSync(tujuan).size / 1024).toFixed(0);
  log(`OK ${nama} — ${ukuran} KB terenkripsi, ${jumlahJob} job, branch ${BRANCH} ter-push`);
}

function pulihkan(file, timpa) {
  if (!file) throw new Error('sebutkan file snapshot: --pulihkan backup-2026-11-05.enc');
  const buf = fs.readFileSync(file);
  const isi = JSON.parse(dekripsi(buf).toString('utf8'));

  if (fs.existsSync(FILE_DB) && !timpa) {
    throw new Error('database.db sudah ada — pakai --timpa kalau memang mau menimpanya');
  }
  fs.writeFileSync(FILE_DB, Buffer.from(isi.database, 'base64'));
  log(`database.db dipulihkan dari snapshot ${isi.dibuat}`);

  const jobs = isi.farmJobs || {};
  fs.mkdirSync(DIR_JOBS, { recursive: true });
  let n = 0;
  for (const [nama, isiB64] of Object.entries(jobs)) {
    const target = path.join(DIR_JOBS, nama);
    if (fs.existsSync(target) && !timpa) continue;
    fs.writeFileSync(target, Buffer.from(isiB64, 'base64'));
    n++;
  }
  log(`farm-jobs dipulihkan: ${n} file`);
}

function main() {
  const args = process.argv.slice(2);
  const i = args.indexOf('--pulihkan');
  if (i >= 0) {
    pulihkan(args[i + 1], args.includes('--timpa'));
  } else {
    jalankanBackup();
  }
}

try {
  main();
} catch (e) {
  log(`GAGAL: ${e.message}`);
  process.exit(1);
}
