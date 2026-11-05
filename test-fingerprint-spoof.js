'use strict';
// Uji paritas fingerprint (opsi 2) — LOKAL, tanpa proxy, tanpa biaya.
// Jalankan: node test-fingerprint-spoof.js
//
// PENTING soal metode: patchright menjalankan page.evaluate di ISOLATED world
// (anti Runtime.enable), sedangkan init script + skrip situs hidup di MAIN world.
// Probe fingerprint JADI HARUS dibaca lewat CDP Runtime.evaluate (main world),
// persis sudut pandang skrip situs. Membaca via page.evaluate akan selalu
// menampilkan nilai tanpa spoof dan menyesatkan.
//
// Yang dibuktikan:
//   1. Spoof mengubah hash canvas, image data, ClientRects vs baseline.
//   2. Konfig spoof yang sama menghasilkan hash IDENTIK antar sesi (konsistensi).
//   3. Konfig akun berbeda menghasilkan hash BERBEDA (akun tak bisa ditautkan).
//   4. Vendor/renderer WebGL dan nilai hardware mengikuti konfig.
// CATATAN audio (paritas AdsPower, 2026-10-08): audio TIDAK lagi di-spoof secara
// default; wrapper getChannelData tertangkap detektor GLITCH creepjs (20% stealth),
// sedangkan AdsPower membiarkan audio asli dan mendapat 0% stealth. Audio asli
// juga identik antar akun, sesuai pilihan desain AdsPower.

const http = require('http');
const { chromium } = require('patchright');
const spoof = require('./src/fingerprint-spoof');

// Probe fingerprint di MAIN world (dipanggil via CDP Runtime.evaluate, awaitPromise).
const PROBE_SRC = `async () => {
  function hashStr(s) {
    let h = 5381;
    s = String(s || '');
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
    return h;
  }
  const root = document.body || document.documentElement;

  const c = document.createElement('canvas');
  c.width = 240; c.height = 60;
  const ctx = c.getContext('2d');
  ctx.textBaseline = 'top';
  ctx.font = '16px Arial';
  ctx.fillStyle = '#f60';
  ctx.fillRect(0, 0, 100, 30);
  ctx.fillStyle = '#0af';
  ctx.fillText('Fingerprint panel uji', 2, 15);
  ctx.strokeStyle = 'rgba(0,80,200,0.7)';
  ctx.beginPath();
  ctx.arc(50, 40, 18, 0, Math.PI * 1.7);
  ctx.stroke();
  const canvasHash = String(hashStr(c.toDataURL()));
  const img = ctx.getImageData(0, 0, c.width, c.height);
  let sum = 0;
  for (let i = 0; i < img.data.length; i++) sum = (sum + img.data[i]) >>> 0;

  let webgl = { vendor: '?', renderer: '?' };
  try {
    const gl = document.createElement('canvas').getContext('webgl');
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    webgl = { vendor: gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL), renderer: gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) };
  } catch (e) {}

  let audioSum = null;
  try {
    const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    const octx = new OAC(1, 4096, 44100);
    const osc = octx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = 10000;
    const comp = octx.createDynamicsCompressor();
    osc.connect(comp);
    comp.connect(octx.destination);
    osc.start(0);
    const buf = await octx.startRendering();
    const d = buf.getChannelData(0);
    let s = 0;
    for (let i = 0; i < d.length; i++) s += Math.abs(d[i]);
    audioSum = s.toFixed(10);
  } catch (e) { audioSum = 'err:' + (e.message || e); }

  const div = document.createElement('div');
  div.id = 'probe-div';
  root.appendChild(div);
  const rect = div.getBoundingClientRect();

  return {
    canvasHash,
    imageDataSum: String(sum),
    webglVendor: String(webgl.vendor),
    webglRenderer: String(webgl.renderer),
    audioSum,
    hardwareConcurrency: navigator.hardwareConcurrency,
    deviceMemory: navigator.deviceMemory,
    rectX: rect.x.toFixed(6),
    rectW: rect.width.toFixed(6),
  };
}`;

// Halaman uji: server HTTP lokal (init script patchright disuntik via rute request
// HTML, jadi halaman HARUS diambil lewat jaringan; about:blank tidak kena).
function startServer() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      res.setHeader('content-type', 'text/html');
      res.end('<html><head></head><body>halaman uji fingerprint</body></html>');
    });
    srv.listen(0, '127.0.0.1', () => resolve({ srv, url: `http://127.0.0.1:${srv.address().port}/` }));
  });
}

async function probeMainWorld(page, session, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  const out = await session.send('Runtime.evaluate', {
    expression: `(${PROBE_SRC})()`,
    awaitPromise: true,
    returnByValue: true,
  });
  if (out.exceptionDetails) throw new Error('probe error: ' + JSON.stringify(out.exceptionDetails.exception && out.exceptionDetails.exception.description || out.exceptionDetails.text).slice(0, 200));
  return out.result.value;
}

async function runOnce(label, cfg, url) {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    if (cfg) await context.addInitScript(spoof.initScript(cfg));
    const page = await context.newPage();
    const session = await context.newCDPSession(page);
    await session.send('Page.enable');
    const res = await probeMainWorld(page, session, url);
    console.log(`[${label}]`, JSON.stringify(res));
    return res;
  } finally {
    await browser.close().catch(() => {});
  }
}

(async () => {
  const { srv, url } = await startServer();
  try {
    const cfgA = spoof.spoofConfigFor({ id: 101, name: 'akun-a', email: 'a@contoh.com', user_agent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36' });
    const cfgB = spoof.spoofConfigFor({ id: 202, name: 'akun-b', email: 'b@contoh.com', user_agent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36' });
    console.log('cfgA:', JSON.stringify(cfgA));
    console.log('cfgB:', JSON.stringify(cfgB));
    if (cfgA.canvasSeed === cfgB.canvasSeed && cfgA.audioSeed === cfgB.audioSeed) {
      console.error('GAGAL: cfgA dan cfgB identik — seed tidak membedakan akun');
      process.exit(1);
    }

    const base = await runOnce('baseline', null, url);
    const a1 = await runOnce('spoofA-sesi1', cfgA, url);
    const a2 = await runOnce('spoofA-sesi2', cfgA, url);
    const b1 = await runOnce('spoofB', cfgB, url);

    const fails = [];
    const checkDiff = (x, y, label) => { if (String(x) === String(y)) fails.push(label); };
    const checkSame = (x, y, label) => { if (String(x) !== String(y)) fails.push(label); };
    const skip = (v) => String(v).startsWith('err:');

    // 1. Spoof mengubah hash vs baseline (canvas & image data WAJIB; audio diharap
    //    SAMA karena default NO_AUDIO paritas AdsPower).
    checkDiff(a1.canvasHash, base.canvasHash, 'canvas hash spoofA == baseline');
    checkDiff(a1.imageDataSum, base.imageDataSum, 'imageDataSum spoofA == baseline');
    if (!skip(a1.audioSum) && process.env.WITH_AUDIO) checkDiff(a1.audioSum, base.audioSum, 'audioSum spoofA == baseline');
    checkDiff(a1.rectX, base.rectX, 'rectX spoofA == baseline');

    // 2. Konsistensi antar sesi dengan konfig yang sama.
    checkSame(a1.canvasHash, a2.canvasHash, 'canvas hash A berubah antar sesi');
    checkSame(a1.imageDataSum, a2.imageDataSum, 'imageDataSum A berubah antar sesi');
    if (!skip(a1.audioSum) && process.env.WITH_AUDIO) checkSame(a1.audioSum, a2.audioSum, 'audioSum A berubah antar sesi');
    checkSame(a1.rectX, a2.rectX, 'rectX A berubah antar sesi');
    checkSame(String(a1.hardwareConcurrency), String(a2.hardwareConcurrency), 'hardwareConcurrency A berubah antar sesi');

    // 3. Akun berbeda -> hash berbeda (audio tidak diharuskan beda: NO_AUDIO default).
    checkDiff(a1.canvasHash, b1.canvasHash, 'canvas hash spoofA == spoofB');
    checkDiff(a1.imageDataSum, b1.imageDataSum, 'imageDataSum spoofA == spoofB');
    if (!skip(a1.audioSum) && !skip(b1.audioSum) && process.env.WITH_AUDIO) checkDiff(a1.audioSum, b1.audioSum, 'audioSum spoofA == spoofB');

    // 4. Konfig mengikuti cfg.
    if (a1.hardwareConcurrency !== cfgA.hardwareConcurrency) fails.push(`hardwareConcurrency ${a1.hardwareConcurrency} != cfg ${cfgA.hardwareConcurrency}`);
    if (a1.webglVendor !== cfgA.webgl.vendor) fails.push(`webglVendor "${a1.webglVendor}" != cfg "${cfgA.webgl.vendor}"`);
    if (a1.webglRenderer !== cfgA.webgl.renderer) fails.push(`webglRenderer "${a1.webglRenderer}" != cfg "${cfgA.webgl.renderer}"`);

    if (fails.length) {
      console.error('\nGAGAL:');
      fails.forEach((f) => console.error(' -', f));
      process.exitCode = 1;
      return;
    }
    console.log('\nLOLOS: spoof konsisten antar sesi, berbeda antar akun, dan konfig mengikuti seed.');
  } finally {
    srv.close();
  }
})().catch((e) => {
  console.error('ERROR:', e.message);
  process.exit(1);
});
