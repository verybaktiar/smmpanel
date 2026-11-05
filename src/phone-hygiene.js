'use strict';
// Higiene HP antar-create (aturan kuota 1-2 akun/HP/minggu):
//   1. cek   — device ada? IG terpasang? IP sekarang?
//   2. ig    — pm clear com.instagram.android (hapus sesi/cache/beranda akun lama)
//   3. fb    — pm clear com.facebook.katana (persiapan create FB di HP yg sudah dipakai
//              akun lain — farm-driver-fb menolak jalan bila sesi lama masih ada)
//   4. ads   — reset Advertising ID (UUID baru) — jejak iklan Android ikut ganti
//   5. ip    — toggle airplane mode (atau svc data) → CGNAT kasih IP baru → lapor IP lahir
// Pakai: node src/phone-hygiene.js <deviceId> [cek|ig|fb|ads|ip|semua]   (default: semua)
// Tanpa root. IP dicek dari sisi HP (curl api.ipify.org) — IP lahir = IP yang dilihat platform.

const { execFile } = require('child_process');
const crypto = require('crypto');

// adb dipilih sekali lewat resolusi tervalidasi (adb-farm) supaya tidak jatuh ke
// biner yang crash/keluaran kosong: dulu semua baca IP/baterai/SIM ikut gagal.
let _bin = null;
function adbBin() {
  if (_bin) return _bin;
  try { _bin = require('./adb-farm').adbPath(); } catch (e) { _bin = process.env.ADB_PATH || 'adb'; }
  return _bin;
}
const IG_PKG = 'com.instagram.android';
const FB_PKG = 'com.facebook.katana';

function adb(id, args, timeout = 30000) {
  return new Promise((resolve, reject) => {
    execFile(adbBin(), ['-s', id, ...args], { timeout, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) return reject(new Error(`adb ${args.join(' ')}: ${(stderr || err.message).slice(0, 150)}`));
      resolve(String(stdout || ''));
    });
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function deviceIp(id) {
  for (const cmd of [
    ['shell', 'curl', '-s', '-m', '15', 'https://api.ipify.org'],
    ['shell', 'curl', '-s', '-m', '15', 'http://api.ipify.org'],
  ]) {
    try {
      const out = (await adb(id, cmd, 25000)).trim();
      if (/^\d{1,3}(\.\d{1,3}){3}$/.test(out)) return out;
    } catch (e) { /* coba jalur berikutnya */ }
  }
  return '';
}

async function stepCek(id) {
  const devices = await new Promise((resolve, reject) => {
    execFile(adbBin(), ['devices'], { timeout: 10000 }, (e, o) => (e ? reject(e) : resolve(String(o))));
  });
  if (!devices.includes(id + '\tdevice')) throw new Error(`device "${id}" tidak terhubung (state: unauthorized/offline/tidak ada)`);
  const model = (await adb(id, ['shell', 'getprop', 'ro.product.model']).catch(() => '')).trim();
  const android = (await adb(id, ['shell', 'getprop', 'ro.build.version.release']).catch(() => '')).trim();
  const igInstalled = (await adb(id, ['shell', 'pm', 'path', IG_PKG]).catch(() => '')).trim().length > 0;
  const ip = await deviceIp(id);
  return { model, android, igInstalled, ip };
}

async function stepClearIg(id) {
  // pm clear = hapus data+cache+sesi aplikasi (setara "Clear storage" di setting, tanpa root)
  await adb(id, ['shell', 'pm', 'clear', IG_PKG]);
  return true;
}

// Clear data aplikasi FB — syarat farm-driver-fb mau jalan (guard "HP sudah login
// akun FB lain"). PANGGILAN BERBAHAYA: akun yang hidup dan belum terbackup akan
// hilang sesinya dari HP ini. Sesi FB tidak bisa diekspor via adb (app non-debuggable),
// jadi clear = akun itu BUKAN lagi bisa auto-login dari HP ini (login dua kali =
// checkpoint). Pakai HANYA saat akun lama memang sudah selesai dipanen/warming
// di tempat lain atau memang mau dibuang.
async function stepClearFb(id) {
  await adb(id, ['shell', 'pm', 'clear', FB_PKG]);
  return true;
}

async function stepResetAds(id) {
  const sdk = Number((await adb(id, ['shell', 'getprop', 'ro.build.version.sdk']).catch(() => '0')).trim());
  const uuid = crypto.randomUUID();
  if (sdk >= 31) {
    // Android 12+: advertising_id disimpan di Settings.Secure — timpa langsung.
    await adb(id, ['shell', 'settings', 'put', 'secure', 'advertising_id', uuid]);
  } else {
    // Android lama: ID dikelola Play Services — GMS clear adalah satu-satunya cara (berat, opsional).
    await adb(id, ['shell', 'pm', 'clear', 'com.google.android.gms']).catch(() => {
      throw new Error(`Android ${sdk}: reset Ads ID butuh pm clear GMS ( gagal) — lewati bila tak yakin`);
    });
  }
  // Verifikasi bila bisa
  const now = (await adb(id, ['shell', 'settings', 'get', 'secure', 'advertising_id']).catch(() => '')).trim();
  return { uuid, verified: now.toLowerCase() === uuid.toLowerCase() };
}

async function stepRotateIp(id) {
  const before = await deviceIp(id);
  // Cara utama: cmd connectivity (Android 13+); fallback: settings+ broadcast
  try { await adb(id, ['shell', 'cmd', 'connectivity', 'airplane-mode', 'enable']); }
  catch (e) {
    await adb(id, ['shell', 'settings', 'put', 'global', 'airplane_mode_on', '1']);
    await adb(id, ['shell', 'am', 'broadcast', '-a', 'android.intent.action.AIRPLANE_MODE']).catch(() => {});
  }
  await sleep(6000);
  try { await adb(id, ['shell', 'cmd', 'connectivity', 'airplane-mode', 'disable']); }
  catch (e) {
    await adb(id, ['shell', 'settings', 'put', 'global', 'airplane_mode_on', '0']);
    await adb(id, ['shell', 'am', 'broadcast', '-a', 'android.intent.action.AIRPLANE_MODE']).catch(() => {});
  }
  // Tunggu data seluler menyala lagi
  let after = '';
  for (let i = 0; i < 8; i++) {
    await sleep(5000);
    after = await deviceIp(id);
    if (after && after !== before) break;
  }
  return { before, after, changed: !!after && after !== before };
}

// ---- Detail perangkat untuk monitoring (cache + refresh latar) ----
// IP dicek dari sisi HP (curl api.ipify.org) = IP keluar SIM yang dilihat platform.
// Lambat (3-15 dtk), jadi server memanggil refreshDeviceDetails() berkala dan UI
// membaca cache lewat /api/farm/overview tanpa menunggu.
const detailCache = new Map(); // deviceId -> { ip, radio, power, battery, screen, net, at }

async function refreshDeviceDetails(id) {
  const shellA = (args, timeout = 20000) => adb(id, args, timeout).catch(() => '');
  const [ip, radioRaw, powerRaw, screen, routesRaw] = await Promise.all([
    deviceIp(id),
    shellA(['shell', 'dumpsys', 'telephony.registry']).then((o) => String(o).slice(0, 4000)),
    shellA(['shell', 'dumpsys', 'battery']),
    shellA(['shell', 'settings', 'get', 'system', 'screen_brightness']),
    shellA(['shell', 'ip', 'route']),
  ]);
  // Radio SIM (Android 12: mVoiceRegState; 0=IN_SERVICE, 1=OUT_OF_SERVICE, 3=POWER_OFF)
  const reg = Number((/mVoiceRegState=(\d+)/.exec(radioRaw) || [])[1] ?? 1);
  const techNum = Number((/getRilDataRadioTechnology=(\d+)/.exec(radioRaw) || [])[1] ?? -1);
  const TECH = { 13: '5G', 14: '5G', 18: '5G', 20: '5G', 19: 'LTE', 11: 'LTE', 9: 'H+', 10: 'H+', 3: '3G', 5: '3G', 2: '3G', 1: 'G', 8: 'G' };
  const radio = { on: reg === 0, tech: TECH[techNum] || (reg === 0 ? 'on' : 'off') };
  // Koneksi aktif dari interface rute: wlan0=WiFi, rmnet*=Data SIM
  // (rute default kadang tak tampak utk user adb — cukup ada interface-nya)
  const connType = /dev wlan0/m.test(routesRaw) ? 'wifi' : /dev rmnet/m.test(routesRaw) ? 'data' : '';
  const battLevel = Number((/level:\s*(\d+)/.exec(powerRaw) || [])[1] || 0);
  const powered = /AC powered: true|USB powered: true/.test(powerRaw);
  const detail = {
    ip, radio, conn: connType,
    // SIM fungsional = data mengalir via rmnet dgn IP valid (voice registry slot
    // sering stale di dual-SIM — yang penting utk farm adalah jalur data).
    simOk: radio.on || connType === 'data',
    wifiWarn: connType === 'wifi', // create via WiFi = melanggar SOP farm
    battery: battLevel, powered,
    screen: Number(screen) || null,
    at: new Date().toISOString(),
  };
  detailCache.set(id, detail);
  return detail;
}

function cachedDeviceDetails(id) {
  return detailCache.get(id) || null;
}

// ---- API modul (dipakai server.js via /api/farm/hygiene) ----
// Setiap langkah diberi batas waktu ketat: HP tua bisa hang di adb shell.
async function runHygiene(deviceId, mode = 'semua', onLog = () => {}) {
  const log = (m) => { try { onLog(String(m).slice(0, 300)); } catch (e) { /* abaikan */ } };
  const hasil = { mode };
  hasil.cek = await stepCek(deviceId);
  log(`[cek] ${hasil.cek.model} Android ${hasil.cek.android} · IG=${hasil.cek.igInstalled ? 'ya' : 'tidak'} · IP=${hasil.cek.ip || '?'}`);
  if (mode === 'cek') return hasil;

  if ((mode === 'ig' || mode === 'semua')) {
    if (!hasil.cek.igInstalled) { hasil.ig = 'skip (IG tidak terpasang)'; log('[ig] IG tidak terpasang — lewati'); }
    else { await stepClearIg(deviceId); hasil.ig = 'cleared'; log('[ig] data+sesi IG dihapus (pm clear)'); }
  }
  if (mode === 'fb') {
    const fbInstalled = (await adb(deviceId, ['shell', 'pm', 'path', FB_PKG]).catch(() => '')).trim().length > 0;
    if (!fbInstalled) { hasil.fb = 'skip (FB tidak terpasang)'; log('[fb] FB tidak terpasang — lewati'); }
    else { await stepClearFb(deviceId); hasil.fb = 'cleared'; log('[fb] data+sesi FB dihapus (pm clear) — akun lama di HP ini tidak lagi auto-login'); }
  }
  if (mode === 'ads' || mode === 'semua') {
    hasil.ads = await stepResetAds(deviceId);
    log(`[ads] advertising_id baru ${hasil.ads.uuid} (terverifikasi: ${hasil.ads.verified})`);
  }
  if (mode === 'ip' || mode === 'semua') {
    hasil.ip = await stepRotateIp(deviceId);
    log(`[ip] ${hasil.ip.before || '?'} -> ${hasil.ip.after || '?'} (ganti: ${hasil.ip.changed})`);
    if (!hasil.ip.changed) log('[ip] PERINGATAN: IP belum berganti (CGNAT kadang kasih IP sama) — tunggu lalu cek ulang');
  }
  return hasil;
}

module.exports = { runHygiene, deviceIp, stepCek, stepClearIg, stepClearFb, stepResetAds, stepRotateIp, refreshDeviceDetails, cachedDeviceDetails };

// ---- CLI (node src/phone-hygiene.js <deviceId> [cek|ig|fb|ads|ip|semua]) ----
if (require.main === module) {
  const id = process.argv[2];
  const mode = (process.argv[3] || 'semua').toLowerCase();
  if (!id) { console.log('Pakai: node src/phone-hygiene.js <deviceId> [cek|ig|fb|ads|ip|semua]'); process.exit(1); }
  runHygiene(id, mode, (m) => console.log(m))
    .then((hasil) => { console.log('HASIL:', JSON.stringify(hasil, null, 1)); })
    .catch((e) => { console.error('GAGAL:', e.message); process.exit(2); });
}
