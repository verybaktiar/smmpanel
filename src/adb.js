/**
 * adb.js — Toolkit otomatisasi Android via ADB (tanpa dependensi eksternal).
 * Untuk farm kelahiran Gmail di HP native (aplikasi Gmail / wizard GMS).
 *
 * Resolusi binary adb (urut prioritas):
 *   1. env ADB_PATH
 *   2. adb di PATH sistem
 *
 * Pemakaian:
 *   const { listDevices, forDevice, find, sleep, humanPause, KEY } = require('./adb');
 *   const hp = forDevice('SERIAL');
 *   await hp.wake(); await hp.unlockSwipe();
 *   const { nodes, ok } = await hp.dump();
 *   const btn = find(nodes, { textContains: 'buat akun' })[0];
 *   if (btn) { await hp.humanPause(300, 900); await hp.tapNode(btn); }
 *
 * Catatan input teks: `adb shell input text` punya batasan charset shell
 * (spasi → %s; karakter seperti & < > ( ) tidak aman). Generator identitas
 * sebaiknya memakai charset aman: A-Za-z0-9 @ . _ - +  (lihat text()).
 */

'use strict';

const { spawn } = require('child_process');
const path = require('path');

const KEY = {
  WAKEUP: 224,
  SLEEP: 223,
  BACK: 4,
  HOME: 3,
  ENTER: 66,
  TAB: 61,
  DEL: 67,
};

let cachedAdb = null;

function resolveAdb() {
  if (cachedAdb) return cachedAdb;
  // Pakai resolusi tervalidasi adb-farm: 'adb' di PATH bisa biner yang segfault
  // (paket scrcpy) sehingga semua perintah device gagal tanpa pesan jelas.
  try { cachedAdb = require('./adb-farm').adbPath(); }
  catch (e) { cachedAdb = process.env.ADB_PATH || 'adb'; }
  return cachedAdb;
}

/** Jalankan adb dengan args array, kumpulkan output. */
function run(args, { timeoutMs = 20000 } = {}) {
  return new Promise((resolve) => {
    const exe = resolveAdb();
    const child = spawn(exe, args, { shell: false, windowsHide: true });
    let stdout = Buffer.alloc(0);
    let stderr = '';
    let done = false;
    const timer = setTimeout(() => {
      if (!done) { try { child.kill(); } catch (_) {} done = true; resolve({ code: -1, stdout, stderr: 'timeout' }); }
    }, timeoutMs);
    child.stdout.on('data', (c) => { stdout = Buffer.concat([stdout, c]); });
    child.stderr.on('data', (c) => { stderr += c.toString('utf8'); });
    child.on('error', (e) => {
      if (done) return;
      done = true; clearTimeout(timer);
      resolve({ code: -1, stdout: Buffer.alloc(0), stderr: String(e && e.message || e) });
    });
    child.on('close', (code) => {
      if (done) return;
      done = true; clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

/** Daftar HP terhubung: [{ serial, state, model }] */
async function listDevices() {
  const r = await run(['devices', '-l']);
  const out = r.stdout.toString('utf8');
  const devs = [];
  for (const line of out.split(/\r?\n/)) {
    const m = line.match(/^(\S+)\s+(device|offline|unauthorized|recovery)(?:\s+(.*))?$/);
    if (!m) continue;
    const model = (m[3] || '').match(/model:(\S+)/);
    devs.push({ serial: m[1], state: m[2], model: model ? model[1] : '' });
  }
  return devs;
}

function parseBounds(s) {
  const m = String(s || '').match(/\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]/);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
}

/** Parse XML uiautomator menjadi array node datar (tanpa dependensi). */
function parseUiautomatorXml(xml) {
  const nodes = [];
  const re = /<node\b([^>]*?)\/?>/g;
  let m;
  while ((m = re.exec(xml))) {
    const attrs = {};
    const are = /([\w:-]+)="([^"]*)"/g;
    let a;
    while ((a = are.exec(m[1]))) attrs[a[1]] = a[2];
    const b = parseBounds(attrs.bounds);
    if (!b) continue;
    nodes.push({
      index: nodes.length,
      resourceId: attrs['resource-id'] || '',
      text: attrs.text || '',
      desc: attrs['content-desc'] || '',
      cls: attrs.class || '',
      pkg: attrs.package || '',
      clickable: attrs.clickable === 'true',
      enabled: attrs.enabled !== 'false',
      bounds: b,
      cx: Math.round((b[0] + b[2]) / 2),
      cy: Math.round((b[1] + b[3]) / 2),
    });
  }
  return nodes;
}

/**
 * Cari node berdasarkan kriteria (AND). Query:
 * { id, idContains, text, textContains, desc, descContains, anyContains, cls, clickable, pkg }
 * `id` mendukung wildcard di akhir: 'com.google.android.gms:id/*'
 * `anyContains` = cocokkan teks ATAU content-desc (tombol GMS sering
 * membawa label di content-desc, bukan text).
 */
function find(nodes, q = {}) {
  return (nodes || []).filter((n) => {
    if (q.id) {
      if (q.id.endsWith('*')) { if (!n.resourceId.startsWith(q.id.slice(0, -1))) return false; }
      else if (n.resourceId !== q.id) return false;
    }
    if (q.idContains && !n.resourceId.includes(q.idContains)) return false;
    if (q.text != null && n.text !== q.text) return false;
    if (q.textContains && !n.text.toLowerCase().includes(String(q.textContains).toLowerCase())) return false;
    if (q.desc != null && n.desc !== q.desc) return false;
    if (q.descContains && !n.desc.toLowerCase().includes(String(q.descContains).toLowerCase())) return false;
    if (q.anyContains) {
      const s = String(q.anyContains).toLowerCase();
      if (!n.text.toLowerCase().includes(s) && !n.desc.toLowerCase().includes(s)) return false;
    }
    if (q.cls && n.cls !== q.cls) return false;
    if (q.pkg && n.pkg !== q.pkg) return false;
    if (q.clickable && !n.clickable) return false;
    return true;
  });
}

/** Objek per-perangkat dengan helper siap pakai. */
function forDevice(serial) {
  const A = ['-s', serial];

  const d = {
    serial,

    /** Jalankan shell command di HP, kembalikan { code, stdout, stderr }. */
    async shell(cmd, opt = {}) {
      return run([...A, 'shell', cmd], opt);
    },

    async tap(x, y) {
      await run([...A, 'shell', `input tap ${Math.round(x)} ${Math.round(y)}`]);
    },
    async swipe(x1, y1, x2, y2, durMs = 400) {
      await run([...A, 'shell', `input swipe ${Math.round(x1)} ${Math.round(y1)} ${Math.round(x2)} ${Math.round(y2)} ${Math.round(durMs)}`]);
    },
    async key(code) {
      await run([...A, 'shell', `input keyevent ${code}`]);
    },
    async back() { await d.key(KEY.BACK); },
    async home() { await d.key(KEY.HOME); },

    /**
     * Ketik teks. Aman utk charset A-Za-z0-9 @ . _ - + (spasi jadi %s).
     * Khusus password: generate dari charset ini saja supaya lolos `input text`.
     */
    async text(str) {
      const safe = String(str).replace(/ /g, '%s').replace(/[^A-Za-z0-9@._%+\-]/g, '');
      return d.shell(`input text ${safe}`);
    },

    async wake() { await d.key(KEY.WAKEUP); },

    /** Bangunkan layar + geser ke atas utk buka kunci (lock screen tanpa PIN). */
    async unlockSwipe() {
      await d.wake();
      const sz = await d.screenSize();
      const cx = Math.round(sz.w / 2);
      await d.swipe(cx, Math.round(sz.h * 0.85), cx, Math.round(sz.h * 0.25), 350);
      await sleep(600);
    },

    async screenSize() {
      const r = await d.shell('wm size');
      const m = (r.stdout || '').toString().match(/(\d+)x(\d+)/);
      // Orientasi fisik vs logis bisa terbalik; dumpsys memberi rotasi saat ini:
      let rot = { stdout: '' };
      try { rot = await d.shell('dumpsys input | grep SurfaceOrientation'); } catch (_) {}
      let w = Number(m ? m[1] : 1080);
      let h = Number(m ? m[2] : 1920);
      if (/SurfaceOrientation.*1|SurfaceOrientation.*3/.test((rot.stdout || '').toString())) { const t = w; w = h; h = t; }
      return { w, h };
    },

    /** Aktivitas yang sedang tampil di depan (utk klasifikasi langkah wizard). */
    async currentActivity() {
      const r = await d.shell('dumpsys activity activities');
      const out = (r.stdout || '').toString();
      let m = out.match(/topResumedActivity[^\n]*?u0\s+([^\s}]+)/);
      if (m) return m[1];
      m = out.match(/mResumedActivity[^\n]*?u0\s+([^\s}]+)/);
      if (m) return m[1];
      const w = await d.shell('dumpsys window windows');
      m = (w.stdout || '').toString().match(/mCurrentFocus[^\n]*?u0\s+([^\s}]+)/);
      return m ? m[1] : '';
    },

    /**
     * Dump hierarki UI (uiautomator). Coba beberapa kali karena dump sering
     * gagal saat layar animasi. ok=false bisa berarti layar FLAG_SECURE
     * (diblokir dari pembacaan) — saat itu kita "menyetir buta" atau handoff manual.
     *
     * Anti-dump-basi (ditemukan nyata di MIUI): file dump unik per panggilan +
     * dihapus sebelum dump (kalau gagal, cat() tidak akan dapat isi lama) +
     * pemeriksaan silang paket root dump vs aktivitas depan — kalau beda,
     * dump dianggap basi dan diulang.
     */
    async dump({ retries = 3 } = {}) {
      const f = `/sdcard/uidump-${Date.now() % 100000000}.xml`;
      for (let i = 0; i < retries; i++) {
        await d.shell(`rm -f ${f}`);
        await run([...A, 'shell', `uiautomator dump ${f}`]);
        const c = await d.shell(`cat ${f} 2>/dev/null; rm -f ${f}`);
        const xml = (c.stdout || '').toString();
        if (xml.includes('<hierarchy')) {
          const nodes = parseUiautomatorXml(xml);
          try {
            const act = await d.currentActivity();
            const rootPkg = (nodes[0] && nodes[0].pkg) || '';
            if (act && rootPkg && !act.startsWith(rootPkg)) {
              await sleep(1200);
              continue; // dump basi (isi layar lama) → ulang
            }
          } catch (_) {}
          return { xml, nodes, ok: true };
        }
        await sleep(1200);
      }
      return { xml: '', nodes: [], ok: false };
    },

    async screenshot(outPath) {
      const r = await run([...A, 'exec-out', 'screencap', '-p'], { timeoutMs: 30000 });
      const buf = Buffer.isBuffer(r.stdout) ? r.stdout : Buffer.from(r.stdout || '');
      if (!buf.length || buf.length < 100) throw new Error(`screencap gagal (${buf.length} byte) ${r.stderr || ''}`);
      require('fs').writeFileSync(outPath, buf);
      return outPath;
    },

    /** Buka aplikasi/activity: aman pakai nama package. */
    async launch(pkgOrComponent) {
      await run([...A, 'shell', `monkey -p ${pkgOrComponent} -c android.intent.category.LAUNCHER 1`]);
    },
  };
  return d;
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

/** Jeda acak bergaya manusia (ms). */
function humanPause(minMs = 300, maxMs = 900) {
  return sleep(Math.floor(minMs + Math.random() * Math.max(1, maxMs - minMs)));
}

module.exports = { listDevices, forDevice, parseUiautomatorXml, find, run, sleep, humanPause, KEY };
