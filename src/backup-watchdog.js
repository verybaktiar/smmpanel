'use strict';
// Pemeriksa backup harian: lihat kapan snapshot terakhir benar-benar ter-push,
// lalu kirim notifikasi bila sudah lewat batas (default 2 hari).
// Sumber kebenaran = .tmp-logs/backup-status.json yang ditulis scripts/backup-github.js
// setelah push sukses. Kalau file itu belum ada, pakai snapshot terbaru di .backup-repo.

const fs = require('fs');
const path = require('path');
const notif = require('./notification-system');

const ROOT = path.join(__dirname, '..');
const FILE_STATUS = path.join(ROOT, '.tmp-logs', 'backup-status.json');
const DIR_REPO = path.join(ROOT, '.backup-repo');
const BATAS_HARI = Number(process.env.BACKUP_MAKS_HARI) > 0 ? Number(process.env.BACKUP_MAKS_HARI) : 2;
const ULANG_NOTIF_MS = 24 * 60 * 60 * 1000; // pengingat ulang maksimal sekali sehari

const state = {
  status: 'belum-pernah', // ok | telat | belum-pernah
  terakhir: null,         // ISO waktu backup sukses
  snapshot: null,
  umurJam: null,
  batasHari: BATAS_HARI,
  cekTerakhir: null,
  alarmAktif: false,
  terakhirDiingatkan: null,
  jumlahJob: null,
};

function bacaStatus() {
  try {
    return JSON.parse(fs.readFileSync(FILE_STATUS, 'utf8'));
  } catch (e) {
    return null;
  }
}

// Cadangan bila status belum pernah ditulis: snapshot .enc terbaru di repo backup lokal.
function snapshotTerbaru() {
  try {
    const daftar = fs
      .readdirSync(DIR_REPO)
      .filter((f) => /^backup-\d{4}-\d{2}-\d{2}\.enc$/.test(f))
      .sort();
    if (!daftar.length) return null;
    const nama = daftar[daftar.length - 1];
    return { nama, waktu: fs.statSync(path.join(DIR_REPO, nama)).mtime.toISOString() };
  } catch (e) {
    return null;
  }
}

// Cek murni tanpa notifikasi — dipakai endpoint status.
function periksa() {
  const status = bacaStatus();
  let terakhir = status && status.terakhirSukses ? status.terakhirSukses : null;
  let snapshot = status && status.snapshot ? status.snapshot : null;
  state.jumlahJob = status && typeof status.jumlahJob === 'number' ? status.jumlahJob : null;

  if (!terakhir) {
    const lokal = snapshotTerbaru();
    if (lokal) {
      terakhir = lokal.waktu;
      snapshot = lokal.nama;
    }
  }

  state.terakhir = terakhir;
  state.snapshot = snapshot;
  state.cekTerakhir = new Date().toISOString();

  if (!terakhir) {
    state.status = 'belum-pernah';
    state.umurJam = null;
    return state;
  }

  const umurJam = (Date.now() - new Date(terakhir).getTime()) / 3600000;
  state.umurJam = Math.round(umurJam * 10) / 10;
  state.status = umurJam > BATAS_HARI * 24 ? 'telat' : 'ok';
  return state;
}

// Dipanggil berkala: selain memperbarui status, kirim peringatan saat telat.
// Peringatan diulang maksimal sekali sehari supaya tidak membanjiri kanal.
async function cek() {
  const hasil = periksa();

  if (hasil.status !== 'telat') {
    state.alarmAktif = false;
    return hasil;
  }

  const sekarang = Date.now();
  const bolehKirim = !state.alarmAktif || !state.terakhirDiingatkan || sekarang - new Date(state.terakhirDiingatkan).getTime() >= ULANG_NOTIF_MS;
  if (!bolehKirim) return hasil;

  state.alarmAktif = true;
  state.terakhirDiingatkan = new Date().toISOString();

  const kapan = hasil.terakhir ? new Date(hasil.terakhir).toLocaleString('id-ID') : 'tidak diketahui';
  const pesan =
    `Backup terakhir: ${kapan} (${hasil.umurJam} jam lalu, batas ${BATAS_HARI} hari).\n` +
    `Periksa tugas "SMMPanel Backup Harian" atau jalankan: node scripts/backup-github.js`;

  // Tidak di-await: pengiriman kanal boleh lambat, tak boleh menahan proses lain.
  notif.send(pesan, { title: 'Backup harian belum jalan', priority: 'high', channels: ['telegram', 'whatsapp', 'discord', 'email'] }).catch(() => {});
  console.log(`[backup-watchdog] peringatan dikirim — ${pesan.split('\n')[0]}`);
  return hasil;
}

function start(intervalMs = 6 * 60 * 60 * 1000) {
  const t = setInterval(() => { cek().catch(() => {}); }, intervalMs);
  if (t.unref) t.unref(); // jangan menahan proses tetap hidup hanya karena watchdog
  cek().catch(() => {});
  return state;
}

function status() {
  return { ...periksa() };
}

module.exports = { start, cek, periksa, status, BATAS_HARI };
