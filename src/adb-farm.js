'use strict';

/**
 * ADB Farm — kendalikan HP Android dari panel (1 PC -> banyak HP via USB/WiFi).
 * Fungsi: listDevices, screenshot, openApp, tap, swipe, typeText, uiDump, shell.
 * ADB path: env ADB_PATH atau default C:/platform-tools/platform-tools/adb.exe
 */

const { execFile, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

let _adb = null;
const _bad = new Map(); // kandidat adb -> waktu (ms) ditandai rusak
const BAD_TTL = 60000;   // tanda rusak kedaluwarsa: adb bisa gagal sesaat lalu sehat lagi
let _terakhirAda = 0;    // kapan terakhir adb benar-benar melihat HP
let _reconnectSampai = 0; // cooldown restart daemon (hindari restart tiap polling)
let _reconnectCold = 0;   // percobaan saat proses belum pernah melihat HP
let _terakhirSukses = 0; // perintah `-s <hp>` terakhir yang sukses: adb jelas hidup

function adbCandidates() {
  // tools/platform-tools: adb hasil unduhan Google di dalam proyek (yang dipakai
  // uji create-user 19/10). Biner di luar proyek dimasukkan sebagai cadangan.
  const proyekAdb = path.join(__dirname, '..', 'tools', 'platform-tools', 'adb.exe');
  // adb.exe di folder itu crash saat dijalankan (0xC0000005 access violation),
  // sedangkan salinan sehatnya tersimpan sebagai adb.exe.dat. Karena itu ada
  // adb-asli.exe (hasil salinan .dat). Pelajaran 5/11: .exe BISA berubah/rusak
  // di tengah pemakaian (hash berubah, client crash padahal daemon hidup),
  // sedangkan .dat tidak pernah ditulis proses lain. Jadi .dat dipakai LEBIH
  // DULU; .exe hanya cadangan. Keduanya biner resmi yang sama.
  const proyekAdbAsli = path.join(__dirname, '..', 'tools', 'platform-tools', 'adb-asli.exe');
  const proyekAdbDat = proyekAdbAsli + '.dat';
  return [...new Set([
    process.env.ADB_PATH,
    fs.existsSync(proyekAdbDat) ? proyekAdbDat : null,
    fs.existsSync(proyekAdbAsli) ? proyekAdbAsli : null,
    fs.existsSync(proyekAdb) ? proyekAdb : null,
    'adb',
    'C:/platform-tools/platform-tools/adb.exe'
  ].filter(Boolean))];
}

function badNow(c) {
  const t = _bad.get(c);
  if (!t) return false;
  if (Date.now() - t < BAD_TTL) return true;
  _bad.delete(c);
  return false;
}

// Biner dianggap rusak hanya bila benar-benar rusak. Timeout perintah biasa
// (HP sedang sibuk, screencap lambat) JANGAN menandai biner: dulu satu timeout
// membuat semua kandidat dihitamkan dan farm langsung "tidak ada adb".
const BROKEN_CODES = new Set([
  3221225477, // 0xC0000005 access violation (adb bawaan scrcpy)
  3221225781, // 0xC0000135 DLL hilang
  3221226505, // 0xC0000409 stack buffer overrun
]);
function isBroken(err) {
  if (!err) return false;
  if (err.code === 'ENOENT' || err.code === 'EACCES' || err.code === 'EMPTY') return true;
  if (err.signal === 'SIGSEGV' || err.signal === 'SIGILL') return true;
  return typeof err.code === 'number' && BROKEN_CODES.has(err.code);
}

// Perintah yang dihentikan karena melewati batas waktu: daemon adb bisa macet,
// jadi yang perlu dipulihkan daemon-nya, bukan binernya.
function isTimeout(err) {
  return !!err && (err.killed === true || err.signal === 'SIGTERM' || /timed? ?out|ETIMEDOUT/i.test(String(err.message || '')));
}

// Biner adb bisa rusak di tengah pemakaian: client crash 0xC0000005 padahal
// daemon-nya masih hidup, sehingga semua perintah baru gagal sampai ada yang
// memulihkan. Salinan sehat disimpan sebagai <bin>.dat. Salinan dibuat dengan
// nama unik karena file yang sedang dipakai daemon terkunci di Windows.
const _pulih = new Map(); // biner rusak -> salinan sehat yang sudah diverifikasi
function pulihkan(bin) {
  const sudah = _pulih.get(bin);
  if (sudah) return fs.existsSync(sudah) ? sudah : null;
  const dat = bin + '.dat';
  if (!fs.existsSync(dat)) return null;
  const out = bin.replace(/\.exe$/i, '') + `-pulih-${process.pid}.exe`;
  try {
    fs.copyFileSync(dat, out);
    const v = execFileSync(out, ['version'], { timeout: 15000, stdio: 'pipe' }).toString();
    if (!/Android Debug Bridge/i.test(v)) throw new Error('bukan adb');
    _pulih.set(bin, out);
    return out;
  } catch (e) {
    try { fs.unlinkSync(out); } catch (e2) { /* abaikan */ }
    return null;
  }
}

// Probe wajib melihat header `devices`. Ada biner adb yang keluar dengan status 0
// tapi output kosong; biner seperti itu dulu ikut terpilih sehingga daftar HP
// selalu kosong walau ada adb sehat di kandidat berikutnya.
function hitungDevice(out) {
  return String(out).split('\n').filter((l) => !l.startsWith('*') && /\sdevice(\s|$)/.test(l)).length;
}

function probeAdb(c) {
  const out = execFileSync(c, ['devices'], { timeout: 15000, stdio: 'pipe' }).toString();
  if (!/List of devices attached/.test(out)) {
    const e = new Error('output devices kosong');
    e.code = 'EMPTY';
    throw e;
  }
  return hitungDevice(out);
}

// Pilih kandidat yang benar-benar MELIHAT HP. adb yang tidak crash bisa saja
// melaporkan 0 device (server-nya versi lain); kalau dipilih, panel kembali
// kosong walau biner sehat lain bisa membaca kedua HP.
function adbPath() {
  if (_adb && !badNow(_adb)) return _adb;
  _adb = null;
  let cadangan = null; // sehat, tapi belum melihat HP
  for (const c of adbCandidates()) {
    if (badNow(c)) continue;
    try {
      if (probeAdb(c) > 0) { _adb = c; return c; }
      if (!cadangan) cadangan = c;
    } catch (e) {
      if (!isBroken(e)) continue; // gagal sesaat: coba kandidat berikutnya
      _bad.set(c, Date.now());
      // Jangan biarkan farm buta sampai server di-restart manual: pulihkan dari
      // salinan .dat lalu probe ulang. Bila pulih, langsung dipakai.
      const sehat = pulihkan(c);
      if (!sehat) continue;
      try {
        if (probeAdb(sehat) > 0) { _adb = sehat; return sehat; }
      } catch (e2) { /* salinan juga tak melihat HP: lanjut kandidat lain */ }
    }
  }
  // Cadangan (belum melihat HP) sengaja TIDAK di-cache: begitu HP dicolok, panggilan
  // berikutnya probe ulang dan yang benar-benar melihat HP yang dipakai.
  if (cadangan) return cadangan;
  throw new Error(`tidak ada adb yang bisa dipakai (dicoba: ${adbCandidates().join(', ')})`);
}

// Diagnosa semua kandidat adb. Dipanggil saat server start supaya biner yang rusak
// terlihat di log, tidak cuma muncul sebagai "belum ada HP" di panel.
async function diagnose() {
  const rows = [];
  // Berurutan, bukan paralel: beberapa adb versi berbeda yang start-server
  // bersamaan saling menjatuhkan daemon dan hasilnya jadi acak.
  for (const bin of adbCandidates()) rows.push(await new Promise((resolve) => {
    execFile(bin, ['devices'], { timeout: 15000, maxBuffer: 1024 * 1024 }, (err, stdout) => {
      if (err) {
        // ENOENT = kandidat tidak terpasang di mesin ini, bukan adb yang rusak.
        if (err.code === 'ENOENT') return resolve({ bin, ok: false, broken: true, hilang: true, reason: 'tidak ditemukan' });
        const kode = err.code !== undefined ? err.code : (err.signal || '?');
        const rusak = isBroken(err);
        return resolve({ bin, ok: false, broken: rusak, reason: `${rusak ? 'crash' : 'gagal sementara'} (kode ${kode})` });
      }
      const out = String(stdout || '');
      if (!/List of devices attached/.test(out)) return resolve({ bin, ok: false, broken: true, reason: 'tidak mengeluarkan daftar device' });
      resolve({ bin, ok: true, broken: false, devices: hitungDevice(out) });
    });
  }));
  // Kandidat yang memang tidak terpasang tidak ditampilkan sebagai baris merah.
  // Kalau semuanya tidak ada, baris tetap dikembalikan supaya penyebabnya terlihat.
  const terpasang = rows.filter((r) => !r.hilang);
  return terpasang.length ? terpasang : rows;
}

// ---- HP hilang sesaat ----
// Daemon adb bisa restart (client versi lain, `kill-server` dari panel) dan kabel
// USB bisa enumerate ulang 1-3 detik. Perintah yang jatuh di jeda itu menjawab
// "device not found" walau HP masih tercolok; dulu satu jawaban seperti itu
// membunuh job create yang sudah berjalan 10 menit (job mw3eobny1kldx, 5/11:
// mati di langkah 8 "mengisi sandi").
const HILANG_RE = /device .*not found|device offline|no devices\/emulators found|device still authorizing|device still connecting|error: closed|protocol fault|connection reset/i;
const TUNGGU_HP_MS = 20000;

function isDeviceHilang(err) {
  return HILANG_RE.test(`${(err && err.stderr) || ''} ${(err && err.message) || ''}`);
}

// Serial yang dituju perintah (-s X), atau '' bila perintah tidak menunjuk HP.
function serialTujuan(args) {
  return args[0] === '-s' && args[1] ? args[1] : '';
}

function tidur(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// Tunggu sampai serial terlihat "device" lagi. `reconnect offline` dipakai setelah
// 3 detik: state offline tidak lepas hanya dengan menunggu.
async function tungguDevice(id, batasMs = TUNGGU_HP_MS) {
  const mulai = Date.now();
  const selesai = mulai + batasMs;
  let reconnect = 0;
  while (Date.now() < selesai) {
    try {
      const out = await run(['devices', '-l'], { timeout: 6000, noRetry: true });
      if (parseDevices(out).some((d) => d.state === 'device' && (!id || d.id === id))) return true;
      if (Date.now() - mulai > 3000 && reconnect < 2) {
        reconnect++;
        await run(['reconnect', 'offline'], { timeout: 6000, noRetry: true }).catch(() => {});
      }
    } catch (e) { /* daemon sedang naik: ulangi */ }
    await tidur(700);
  }
  return false;
}

function run(args, opts = {}) {
  return new Promise((resolve, reject) => {
    const tried = new Set();
    // Batas total menunggu HP kembali untuk satu perintah. noRetry = tanpa tunggu,
    // dipakai probe kesehatan supaya daemon yang benar-benar macet cepat terlihat.
    const batasTunggu = Date.now() + (opts.noRetry ? 0 : (opts.tungguMs === undefined ? TUNGGU_HP_MS : Number(opts.tungguMs) || 0));
    const start = () => {
      let bin;
      try { bin = adbPath(); } catch (e) { return reject(e); }
      tried.add(bin);
      const attempt = async (retried) => {
        let err;
        try {
          const stdout = await new Promise((res, rej) => {
            execFile(bin, args, { timeout: opts.timeout || 30000, maxBuffer: 16 * 1024 * 1024 }, (e, out, stderr) => {
              if (e) { e.stderr = String(stderr || ''); return rej(e); }
              res(out);
            });
          });
          if (args[0] === '-s' && args[1]) _terakhirSukses = Date.now();
          return resolve(stdout);
        } catch (e) { err = e; }
        // HP hilang sesaat: tunggu kembali lalu ulangi perintah yang sama. Satu
        // perintah boleh 2-20 detik lebih lama; job 10 menit tidak boleh mati.
        if (!opts.noRetry && isDeviceHilang(err) && Date.now() < batasTunggu) {
          if (await tungguDevice(serialTujuan(args), batasTunggu - Date.now())) return attempt(true);
        }
        // Gagal sesaat lain (daemon baru start, HP sibuk) belum tentu biner rusak.
        // Pemeriksaan kesehatan memakai noRetry agar tidak menunggu dua kali
        // saat daemon benar-benar macet.
        if (!retried && !opts.noRetry) { await tidur(250); return attempt(true); }
        const pesan = `adb ${args.slice(0, 3).join(' ')}: ${(err.stderr || err.message).slice(0, 200)}`;
        const gagal = new Error(pesan);
        gagal.killed = !!err.killed;
        gagal.signal = err.signal;
        gagal.code = err.code;
        // Hanya crash/ENOENT/output kosong yang ditandai rusak, lalu pindah kandidat.
        if (!isBroken(err)) return reject(gagal);
        _bad.set(bin, Date.now());
        if (_adb === bin) _adb = null;
        if (tried.size < adbCandidates().length) return start();
        reject(gagal);
      };
      attempt(false).catch(reject);
    };
    start();
  });
}

const target = (id, args) => (id ? ['-s', id, ...args] : args);

function parseDevices(out) {
  return String(out).split('\n').slice(1)
    .map((l) => l.trim())
    .filter((l) => l && /\sdevice(\s|$)/.test(l) && !l.startsWith('*'))
    .map((l) => {
      const [id, state] = l.split(/\s+/);
      const model = (/model:(\S+)/.exec(l) || [])[1] || '';
      return { id, state, model };
    });
}

// Restart daemon adb yang macet. kill-server normalnya cukup; kalau perintah itu
// ikut menggantung, matikan listener 5037 langsung (Windows) supaya client tidak
// menumpuk menunggu daemon yang sudah tidak merespons.
let _pulihDaemon = null;
function killAdbListener() {
  if (process.platform !== 'win32') return false;
  try {
    const out = execFileSync('netstat', ['-ano'], { timeout: 5000, stdio: 'pipe' }).toString();
    const baris = out.split(/\r?\n/).find((l) => /:5037\s/.test(l) && /LISTENING/i.test(l));
    const pid = baris ? baris.trim().split(/\s+/).pop() : '';
    if (pid && /^\d+$/.test(pid)) {
      execFileSync('taskkill', ['/F', '/PID', pid], { timeout: 5000, stdio: 'pipe' });
      return true;
    }
  } catch (e) { /* abaikan */ }
  return false;
}

function pulihkanDaemon() {
  if (_pulihDaemon) return _pulihDaemon;
  _pulihDaemon = (async () => {
    let mati = true;
    await run(['kill-server'], { timeout: 6000, noRetry: true }).catch(() => { mati = false; });
    if (!mati) killAdbListener();
    await new Promise((r) => setTimeout(r, 900));
    await run(['start-server'], { timeout: 10000, noRetry: true }).catch(() => {});
    await new Promise((r) => setTimeout(r, 1500));
  })().finally(() => { _pulihDaemon = null; });
  return _pulihDaemon;
}

async function listDevicesInner() {
  let out = '';
  let macet = false;
  try {
    // Timeout pendek: panel tidak boleh menggantung 30 detik hanya untuk daftar HP.
    out = await run(['devices', '-l'], { timeout: 8000, noRetry: true });
  } catch (e) {
    if (!isTimeout(e)) throw e;
    macet = true;
  }
  let rows = parseDevices(out);
  if (rows.length) { _terakhirAda = Date.now(); return rows; }

  // Enumerate ulang USB kadang hanya hilang 1-2 detik. Cek sekali lagi sebelum
  // menyimpulkan HP hilang, supaya panel tidak sempat kosong dan daemon tidak
  // di-restart tanpa perlu.
  if (!macet) {
    await new Promise((r) => setTimeout(r, 1500));
    try {
      rows = parseDevices(await run(['devices', '-l'], { timeout: 6000, noRetry: true }));
    } catch (e) { rows = []; }
    if (rows.length) { _terakhirAda = Date.now(); return rows; }
  }

  // Daemon bisa kehilangan HP setelah HP ganti user atau kabel enumerate ulang,
  // padahal Windows masih melihat perangkatnya. Pemulihan dijalankan di latar
  // belakang supaya respons panel tetap cepat; polling berikutnya melihat hasilnya.
  const baruHilang = _terakhirAda && Date.now() - _terakhirAda < 10 * 60000;
  // Cold start: daemon lama bisa sudah kehilangan HP sebelum proses ini pernah
  // melihatnya. Coba sekali saja, jangan mengulang tiap polling bila HP memang
  // tidak dicolok.
  const coldStart = !_terakhirAda && _reconnectCold < 3;
  // Perintah device yang baru sukses = adb jelas hidup; daftar kosong berarti HP
  // memang lepas, bukan daemon macet. Restart daemon saat job berjalan justru
  // memutus HP di tengah langkah (penyebab "device not found" di langkah sandi).
  const adbBaruSehat = _terakhirSukses && Date.now() - _terakhirSukses < 60000;
  if (!adbBaruSehat && (macet || baruHilang || coldStart) && Date.now() > _reconnectSampai) {
    _reconnectSampai = Date.now() + 60000;
    if (!baruHilang) _reconnectCold++;
    void pulihkanDaemon();
  }
  return rows;
}

// Polling panel bisa datang beberapa kali bersamaan. Antrekan agar tidak ada
// beberapa pemulihan daemon yang berjalan sekaligus.
let _antreList = Promise.resolve();
function listDevices() {
  const kerja = () => listDevicesInner();
  const p = _antreList.then(kerja, kerja);
  _antreList = p.then(() => {}, () => {});
  return p;
}

async function deviceInfo(id) {
  const get = async (prop) => (await run(target(id, ['shell', 'getprop', prop]))).trim();
  const [model, android, battery] = await Promise.all([
    get('ro.product.model').catch(() => ''),
    get('ro.build.version.release').catch(() => ''),
    run(target(id, ['shell', 'dumpsys', 'battery'])).then((o) => (/level:\s*(\d+)/.exec(o) || [])[1] || '').catch(() => '')
  ]);
  return { id, model, android, battery };
}

async function screenshotInner(id, outPath, width = 540) {
  const dir = path.dirname(outPath);
  fs.mkdirSync(dir, { recursive: true });
  const tmpPng = outPath.replace(/\.jpe?g$/i, '') + '.tmp.png';
  await new Promise((resolve, reject) => {
    const { spawn } = require('child_process');
    const child = spawn(adbPath(), target(id, ['exec-out', 'screencap', '-p']), { timeout: 20000 });
    const ws = fs.createWriteStream(tmpPng);
    child.stdout.pipe(ws);
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error('screencap exit ' + code))));
  });
  // Kecilkan ke JPEG (default 540px, ~20x lebih ringan dari PNG full)
  const jpgPath = outPath.replace(/\.png$/i, '.jpg');
  try {
    await new Promise((resolve, reject) => {
      const { spawn } = require('child_process');
      const ff = process.env.FFMPEG_PATH || 'ffmpeg';
      const child = spawn(ff, ['-y', '-v', 'error', '-i', tmpPng, '-vf', `scale=${width}:-1`, '-q:v', '6', jpgPath], { timeout: 15000 });
      child.on('error', reject);
      child.on('close', (code) => (code === 0 ? resolve() : reject(new Error('ffmpeg exit ' + code))));
    });
    fs.unlink(tmpPng, () => {});
    return jpgPath;
  } catch (e) {
    // Fallback: pakai PNG asli bila ffmpeg gagal
    const pngPath = outPath.replace(/\.jpe?g$/i, '.png');
    try { fs.renameSync(tmpPng, pngPath); } catch (e2) { /* abaikan */ }
    return pngPath;
  }
}

async function openApp(id, pkg, user = 0) {
  // Monkey per-user: slot user kedua/ketiga butuh --user N (uji 19/10: user 10 & 11).
  const u = Number(user) > 0 ? ['--user', String(Number(user))] : [];
  return run(target(id, ['shell', 'monkey', '-p', pkg, '-c', 'android.intent.category.LAUNCHER', ...u, '1']));
}

// Jalankan shell arbitrer di device (dipakai modul lain: detail IP, radio, dll.)
async function shell(id, args) { return run(target(id, args)); }

async function tap(id, x, y) {
  return run(target(id, ['shell', 'input', 'tap', String(x), String(y)]));
}

async function swipe(id, x1, y1, x2, y2, ms = 400) {
  return run(target(id, ['shell', 'input', 'swipe', String(x1), String(y1), String(x2), String(y2), String(ms)]));
}

async function typeText(id, text) {
  const safe = String(text).replace(/[^a-zA-Z0-9@._+\-!#% ]/g, '').replace(/ /g, '%s');
  return run(target(id, ['shell', 'input', 'text', safe]));
}

async function keyEvent(id, code) {
  return run(target(id, ['shell', 'input', 'keyevent', String(code)]));
}

async function uiDump(id) {
  // MIUI: dump via file (direct /dev/tty ketutup noise stderr).
  // File lama DIHAPUS dulu: kalau dump gagal (adb crash, layar sibuk), `cat`
  // tanpa hapus mengembalikan layar lama dan sopir mengetuk koordinat yang
  // sudah tidak ada.
  await run(target(id, ['shell', 'rm', '-f', '/sdcard/hermes-ui.xml'])).catch(() => '');
  await run(target(id, ['shell', 'uiautomator', 'dump', '/sdcard/hermes-ui.xml'])).catch(() => '');
  const out = await run(target(id, ['shell', 'cat', '/sdcard/hermes-ui.xml'])).catch(() => '');
  const start = out.indexOf('<?xml') >= 0 ? out.indexOf('<?xml') : out.indexOf('<hierarchy');
  if (start < 0) return [];
  const xml = out.slice(start);
  const nodes = [];
  const attr = (s, name) => {
    const m = new RegExp(name + '="([^"]*)"').exec(s);
    return m ? m[1] : '';
  };
  const blocks = xml.match(/<node\b[^>]*\/?>/g) || [];
  for (const b of blocks) {
    if (nodes.length >= 300) break;
    const text = attr(b, 'text') || attr(b, 'content-desc');
    const bounds = /\[(\d+),(\d+)\]\[(\d+),(\d+)\]/.exec(attr(b, 'bounds'));
    if (!bounds) continue;
    nodes.push({
      text, id: attr(b, 'resource-id'), cls: attr(b, 'class'),
      focused: attr(b, 'focused') === 'true',
      x: (+bounds[1] + +bounds[3]) >> 1, y: (+bounds[2] + +bounds[4]) >> 1,
      clickable: attr(b, 'clickable') === 'true'
    });
  }
  return nodes;
}

function scrcpyPath() {
  if (process.env.SCRCPY_PATH && fs.existsSync(process.env.SCRCPY_PATH)) return process.env.SCRCPY_PATH;
  const wingetBase = 'C:/Users/Admin/AppData/Local/Microsoft/WinGet/Packages';
  try {
    const dirs = fs.readdirSync(wingetBase).filter((d) => d.startsWith('Genymobile.scrcpy'));
    for (const d of dirs) {
      const inner = path.join(wingetBase, d);
      for (const sub of fs.readdirSync(inner)) {
        const exe = path.join(inner, sub, 'scrcpy.exe');
        if (fs.existsSync(exe)) return exe;
      }
    }
  } catch (e) { /* abaikan */ }
  return 'scrcpy';
}

async function openLive(id, title, geom) {
  const { spawn } = require('child_process');
  const args = ['--no-audio', '--max-size', '720', '-s', id];
  // scrcpy memakai adb dari PATH; sejak adb bermasalah dibuang, tunjuk langsung
  // ke biner yang lolos probe lewat env ADB (dibaca scrcpy sebagai path adb).
  let adbEnv = {};
  try { adbEnv = { ADB: adbPath() }; } catch (e) { /* biarkan scrcpy cari sendiri */ }
  if (title) args.push('--window-title', title);
  if (geom) {
    if (geom.x != null) args.push('--window-x', String(geom.x));
    if (geom.y != null) args.push('--window-y', String(geom.y));
    if (geom.w != null) args.push('--window-width', String(geom.w));
    if (geom.h != null) args.push('--window-height', String(geom.h));
  }
  const child = spawn(scrcpyPath(), args, { detached: true, stdio: 'ignore', windowsHide: true, env: { ...process.env, ...adbEnv } });
  child.unref();
  return true;
}

const APPS = {
  tiktok: 'com.ss.android.ugc.trill',
  instagram: 'com.instagram.android',
  facebook: 'com.facebook.katana',
  settings: 'com.android.settings'
};

module.exports = {
  listDevices, deviceInfo, screenshot, openApp, tap, swipe, typeText, keyEvent, uiDump, openLive, shell, APPS,
  adbPath, // dipakai modul lain agar semua ikut adb yang sudah lolos probe
  diagnose
};

// Antre capture: adb HP tua kewalahan bila screencap tumpuk (stream + foto)
// Semua pemanggil lewat sini agar selalu berurutan.
let capChain = Promise.resolve();
function screenshot(id, outPath, width = 540) {
  const job = capChain.then(() => screenshotInner(id, outPath, width));
  capChain = job.then(() => {}, () => {});
  return job;
}
