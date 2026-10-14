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
function adbPath() {
  if (_adb) return _adb;
  // Pilih adb yang benar-benar bisa jalan (pernah ada adb.exe segfault 0xC0000005);
  // platform-tools lama di C:\platform-tools terbukti crash, Downloads yang sehat.
  const cands = [process.env.ADB_PATH, 'C:/Users/Admin/Downloads/platform-tools/adb.exe', 'C:/platform-tools/platform-tools/adb.exe', 'adb'].filter(Boolean);
  for (const c of [...new Set(cands)]) {
    try { execFileSync(c, ['version'], { timeout: 8000, stdio: 'pipe' }); _adb = c; break; }
    catch (e) { /* coba berikutnya */ }
  }
  if (!_adb) _adb = 'adb';
  return _adb;
}

function run(args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(adbPath(), args, { timeout: opts.timeout || 30000, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) return reject(new Error(`adb ${args.slice(0, 3).join(' ')}: ${(stderr || err.message).slice(0, 200)}`));
      resolve(stdout);
    });
  });
}

const target = (id, args) => (id ? ['-s', id, ...args] : args);

async function listDevices() {
  const out = await run(['devices', '-l']);
  return out.split('\n').slice(1)
    .map((l) => l.trim())
    .filter((l) => l && /\sdevice(\s|$)/.test(l) && !l.startsWith('*'))
    .map((l) => {
      const [id, state] = l.split(/\s+/);
      const model = (/model:(\S+)/.exec(l) || [])[1] || '';
      return { id, state, model };
    });
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

async function openApp(id, pkg) {
  return run(target(id, ['shell', 'monkey', '-p', pkg, '-c', 'android.intent.category.LAUNCHER', '1']));
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
  // MIUI: dump via file (direct /dev/tty ketutup noise stderr)
  await run(target(id, ['shell', 'uiautomator', 'dump', '/sdcard/hermes-ui.xml'])).catch(() => '');
  const out = await run(target(id, ['shell', 'cat', '/sdcard/hermes-ui.xml'])).catch(() => '');
  const xml = out.slice(out.indexOf('<?xml') < 0 ? out.indexOf('<hierarchy') : out.indexOf('<?xml'));
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
  if (title) args.push('--window-title', title);
  if (geom) {
    if (geom.x != null) args.push('--window-x', String(geom.x));
    if (geom.y != null) args.push('--window-y', String(geom.y));
    if (geom.w != null) args.push('--window-width', String(geom.w));
    if (geom.h != null) args.push('--window-height', String(geom.h));
  }
  const child = spawn(scrcpyPath(), args, { detached: true, stdio: 'ignore', windowsHide: true });
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
  listDevices, deviceInfo, screenshot, openApp, tap, swipe, typeText, keyEvent, uiDump, openLive, shell, APPS
};

// Antre capture: adb HP tua kewalahan bila screencap tumpuk (stream + foto)
// Semua pemanggil lewat sini agar selalu berurutan.
let capChain = Promise.resolve();
function screenshot(id, outPath, width = 540) {
  const job = capChain.then(() => screenshotInner(id, outPath, width));
  capChain = job.then(() => {}, () => {});
  return job;
}
