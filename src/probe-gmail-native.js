/**
 * probe-gmail-native.js — Perekam layar wizard signup Google di HP (observer mode).
 *
 * Cara pakai: jalankan probe di PC, lalu di HP kamu navigasi MANUAL dari
 * aplikasi Gmail: foto profil → Tambah akun lain → Google → Buat akun →
 * isi satu per satu sampai langkah terakhir yang mungkin.
 * Setiap layar berubah, probe menyimpan XML UI + screenshot ke
 * sessions/gmail-native-<label>/ — dari rekaman inilah resource-id tiap
 * tombol/kolom diambil untuk membangun creator native (seperti probe DOM web dulu).
 *
 * Pemakaian:
 *   node src/probe-gmail-native.js --list
 *   node src/probe-gmail-native.js --label hp1
 *   node src/probe-gmail-native.js --serial ABC123 --label hp1 --minutes 20
 *   node src/probe-gmail-native.js --once            (satu dump saja)
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { listDevices, forDevice, sleep } = require('./adb');

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')) return process.argv[i + 1];
  if (i >= 0) return true; // flag tanpa nilai
  return def;
}

async function main() {
  if (arg('list')) {
    const devs = await listDevices();
    if (!devs.length) console.log('Tidak ada HP terhubung. Cek: kabel, USB debugging, dan terima prompt "Izinkan debugging USB?" di HP.');
    for (const d of devs) console.log(`${d.serial.padEnd(20)} ${d.state.padEnd(12)} ${d.model}`);
    return;
  }

  const devs = await listDevices();
  if (!devs.length) {
    console.error('Tidak ada HP terhubung. Pastikan: kabel data, USB debugging aktif, dan prompt RSA di HP sudah diterima.');
    process.exit(1);
  }
  const unauthorized = devs.filter((d) => d.state === 'unauthorized');
  if (unauthorized.length) {
    console.error(`HP ${unauthorized.map((d) => d.serial).join(', ')} status unauthorized — buka HP dan terima prompt "Izinkan debugging USB?".`);
  }
  const serial = arg('serial') || (devs.find((d) => d.state === 'device') || {}).serial;
  if (!serial) { console.error('Tidak ada HP berstatus "device".'); process.exit(1); }

  const label = String(arg('label', 'hp1'));
  const minutes = Number(arg('minutes', 20));
  const interval = Math.max(2000, Number(arg('interval', 4000)));
  const once = !!arg('once');

  const hp = forDevice(serial);
  const dir = path.join(__dirname, '..', 'sessions', `gmail-native-${label}`);
  fs.mkdirSync(dir, { recursive: true });
  const indexPath = path.join(dir, 'index.md');

  console.log(`Probe native: ${serial} → ${dir}`);
  console.log(`Sekarang buka di HP: aplikasi Gmail → foto profil → Tambah akun lain → Google → Buat akun.`);
  console.log(`Probe merekam tiap layar berubah. Berhenti: Ctrl+C. Batas waktu: ${minutes} menit.\n`);

  if (!fs.existsSync(indexPath)) {
    fs.writeFileSync(indexPath, `# Rekaman wizard native — ${label} (${serial})\n\n| # | Waktu | Aktivitas | Node | Catatan teks |\n|---|-------|-----------|------|--------------|\n`);
  }

  let stepN = 0;
  let lastHash = '';
  const started = Date.now();
  const deadline = started + minutes * 60 * 1000;

  const stop = async () => {
    console.log(`\nSelesai: ${stepN} layar terekam di ${dir}`);
    console.log(`Rekap: ${indexPath}`);
    process.exit(0);
  };
  process.on('SIGINT', () => { stop(); });

  while (Date.now() < deadline) {
    const activity = await hp.currentActivity();
    const { xml, nodes, ok } = await hp.dump();

    if (!ok) {
      console.log(`[${new Date().toLocaleTimeString()}] Dump gagal (${activity || 'layar tidak terbaca'}) — kemungkinan FLAG_SECURE/animasi. Diulang otomatis.`);
      if (once) process.exit(2);
      await sleep(interval);
      continue;
    }

    const hash = crypto.createHash('md5').update(xml).digest('hex');
    if (once) {
      console.log(`Aktivitas: ${activity || '?'}`);
      console.log(`Node: ${nodes.length}`);
      const texts = [...new Set(nodes.map((n) => n.text || n.desc).filter(Boolean))].slice(0, 25);
      for (const t of texts) console.log(`  · ${t}`);
      process.exit(0);
    }

    if (hash !== lastHash) {
      stepN += 1;
      const safeAct = String(activity || 'unknown').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
      const stamp = new Date().toLocaleTimeString();
      const xmlFile = `step-${String(stepN).padStart(3, '0')}-${safeAct}.xml`;
      const pngFile = xmlFile.replace(/\.xml$/, '.png');
      try { fs.writeFileSync(path.join(dir, xmlFile), xml); } catch (_) {}
      try { await hp.screenshot(path.join(dir, pngFile)); } catch (e) { console.log(`  (screenshot gagal: ${e.message})`); }
      const texts = [...new Set(nodes.map((n) => n.text || n.desc).filter(Boolean))].slice(0, 6).join(' | ');
      fs.appendFileSync(indexPath, `| ${stepN} | ${stamp} | ${activity || '?'} | ${nodes.length} | ${texts.replace(/\|/g, '/')} |\n`);
      console.log(`[${stamp}] Layar #${stepN}: ${activity || '?'} (${nodes.length} node) → ${xmlFile}`);
      lastHash = hash;
    }

    await sleep(interval);
  }

  await stop();
}

main().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
