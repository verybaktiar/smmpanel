'use strict';
// Uji detektor publik: bot.sannysoft.com + creepjs, patchright headed via proxy
// DataImpulse (sticky cr.id + sid), BASELINE (tanpa spoof) vs SPOOF (init script
// fingerprint-spoof.js). Jalankan: node test-sannysoft-creepjs.js
//
// Metode:
//   - Baris sannysoft dibaca dari DOM tabel (page.evaluate cukup, DOM bersama),
//     pola sama dengan src/fingerprint-compare.js (polling sampai baris stabil).
//   - Probe fingerprint (canvas/webgl/hardware) dibaca lewat CDP Runtime.evaluate
//     MAIN world: page.evaluate patchright jalan di isolated world sehingga TIDAK
//     melihat spoof. Creepjs adalah situs https nyata, jadi init script patchright
//     ikut tersuntik (injeksi via rute request HTML).

const fs = require('fs');
const path = require('path');
const { chromium } = require('patchright');
const spoof = require('./src/fingerprint-spoof');
const stealth = require('./src/stealth');

const DI_HOST = 'gw.dataimpulse.com:823';
const DI_KEY = '3075a7ad6bdec8af6597';
const DI_PASS = 'c1c5eef4de4fbac0';

function diProxy(sid) {
  return {
    server: `http://${DI_HOST}`,
    username: `${DI_KEY}__cr.id;sid.${sid}`,
    password: DI_PASS,
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Versi worker dari spoof: worker biasa + service worker tidak punya DOM, jadi
// hanya hardware + WebGL yang relevan di worker. Node canvas/audio/rects
// dilepas. Suntik via worker.evaluate segera saat worker dibuat (best-effort;
// balapan dengan mulainya tes creepjs di dalam worker).
const spoofSwSrc = (cfg) => `
(() => {
  const cfg = ${JSON.stringify(cfg)};
  try { Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => cfg.hardwareConcurrency, configurable: true }); } catch (e) {}
  try { Object.defineProperty(navigator, 'deviceMemory', { get: () => cfg.deviceMemory, configurable: true }); } catch (e) {}
  const V = cfg.webgl.vendor, R = cfg.webgl.renderer;
  try {
    if (typeof OffscreenCanvas !== 'undefined' && self.OffscreenCanvasRenderingContext2D) {
      const oGet = OffscreenCanvasRenderingContext2D.prototype.getParameter;
      OffscreenCanvasRenderingContext2D.prototype.getParameter = function (p) {
        if (p === 37445) return V; if (p === 37446) return R; return oGet.call(this, p);
      };
    }
  } catch (e) {}
  // Nilai baca-bali untuk verifikasi injeksi benar-benar efektif di worker.
  return { hwc: navigator.hardwareConcurrency, mem: navigator.deviceMemory, scope: (typeof ServiceWorkerGlobalScope !== 'undefined' ? 'SW' : 'worker') };
})();`;

// Probe MAIN world: sudut pandang skrip situs (dipanggil via CDP, awaitPromise).
const PROBE_SRC = `async () => {
  function hashStr(s) {
    let h = 5381;
    s = String(s || '');
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
    return h;
  }
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
  return {
    ua: navigator.userAgent.slice(0, 120),
    webdriver: navigator.webdriver,
    hardwareConcurrency: navigator.hardwareConcurrency,
    deviceMemory: navigator.deviceMemory,
    canvasHash: String(hashStr(c.toDataURL())),
    webglVendor: String(webgl.vendor),
    webglRenderer: String(webgl.renderer).slice(0, 80),
    audioSum,
  };
}`;

async function probeMainWorld(page, cdp) {
  const out = await cdp.send('Runtime.evaluate', {
    expression: `(${PROBE_SRC})()`,
    awaitPromise: true,
    returnByValue: true,
  });
  if (out.exceptionDetails) {
    throw new Error('probe: ' + JSON.stringify((out.exceptionDetails.exception && out.exceptionDetails.exception.description) || out.exceptionDetails.text).slice(0, 200));
  }
  return out.result.value;
}

async function gotoRetry(page, url, opts) {
  let lastErr = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await page.goto(url, { timeout: opts.timeout, waitUntil: 'domcontentloaded' });
      return true;
    } catch (e) {
      lastErr = e;
      console.log(`  goto percobaan ${attempt}/3 gagal: ${(e.message || '').split('\n')[0]}`);
    }
  }
  throw lastErr;
}

// Sannysoft: baris dari DOM tabel, polling sampai jumlah & isi stabil.
async function scrapeSannysoft(page, sid) {
  await gotoRetry(page, 'https://bot.sannysoft.com/', { timeout: 60000 });
  const rowsExpr = () => {
    const rows = [];
    document.querySelectorAll('table tr').forEach((tr) => {
      const tds = tr.querySelectorAll('td');
      if (!tds.length) return;
      const name = (tds[0].innerText || '').trim();
      if (!name) return;
      const cell = tds[1];
      if (!cell) return;
      if (cell.querySelector('.failed') || /failed/i.test(cell.className)) rows.push({ name, res: 'FAIL' });
      else if (cell.querySelector('.passed') || /passed/i.test(cell.className)) rows.push({ name, res: 'PASS' });
      else rows.push({ name, res: (cell.innerText || '').trim().slice(0, 40) });
    });
    return rows;
  };
  let rows = [];
  let prev = -1, stable = 0;
  for (let i = 0; i < 25; i++) {
    await sleep(800);
    rows = await page.evaluate(rowsExpr);
    const complete = rows.length > 0 && rows.every((r) => r.res !== '');
    if (rows.length === prev && complete) { if (++stable >= 2) break; } else stable = 0;
    prev = rows.length;
  }
  return rows;
}

// Creepjs: tunggu sampai hasil tes muncul di DOM, lalu ambil ringkasan skor.
async function scrapeCreepjs(page, cdp) {
  await gotoRetry(page, 'https://abrahamjuliot.github.io/creepjs/', { timeout: 90000 });
  // Creepjs butuh waktu menjalankan semua tesnya; tunggu teks skor muncul lalu stabil.
  let text = '';
  let prev = -1, stable = 0;
  for (let i = 0; i < 45; i++) {
    await sleep(2000);
    text = await page.evaluate(() => (document.body ? document.body.innerText : ''));
    const ready = /trust|lies|grade/i.test(text) && text.length > 200;
    if (ready && text.length === prev) { if (++stable >= 3) break; } else stable = 0;
    prev = text.length;
    if (i % 5 === 4) console.log(`  creepjs tunggu ${((i + 1) * 2)}s, innerText ${text.length} char`);
  }
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const pick = (re) => lines.find((l) => re.test(l)) || '';
  const probe = await probeMainWorld(page, cdp);
  return {
    trust: pick(/trust score/i),
    fingerprintId: pick(/fingerprint/i),
    lies: pick(/lies/i),
    botOrNot: pick(/bot/i),
    // Cuplikan bagian "stealth" jika ada (creepjs menampilkan deteksi keaslian engine).
    snippet: lines.slice(0, 200).join(' | ').slice(0, 6000),
    fullText: text.slice(0, 9000),
    probe,
  };
}

async function runVariant(label, sid, withSpoof) {
  console.log(`\\n========== ${label.toUpperCase()} (sid ${sid}, spoof ${withSpoof ? 'ON' : 'OFF'}) ==========`);
  const cfg = withSpoof
    ? spoof.spoofConfigFor({ id: 7, name: 'uji-detektor', email: 'uji@panel.local', user_agent: '' })
    : null;
  if (cfg) console.log(`cfg: cores ${cfg.hardwareConcurrency} | mem ${cfg.deviceMemory}GB | ${cfg.webgl.vendor} | canvasSeed ${cfg.canvasSeed}`);
  const out = { label, sid, spoof: withSpoof, cfg, error: null };
  let context = null;
  try {
    let geo = null;
    try { geo = await stealth.resolveProxyGeo(`${DI_HOST}:${DI_KEY}__cr.id;sid.${sid}:${DI_PASS}`); } catch (e) {}
    const browser = await chromium.launch({
      headless: false,
      proxy: diProxy(sid),
      args: ['--no-first-run', '--no-default-browser-check', '--no-sandbox', '--disable-dev-shm-usage', '--force-webrtc-ip-handling-policy=disable_non_proxied_udp'],
    });
    context = await browser.newContext({
      locale: 'id-ID',
      timezoneId: (geo && geo.timezone) || 'Asia/Jakarta',
    });
    if (cfg) await context.addInitScript(stealth.spoofInitScript(cfg));
    // Catatan: default init script KINI tanpa audio (paritas AdsPower). Koreksi
    // eksperimen sebelumnya: regex NO_AUDIO lama menghapus SEMUA blok sebelum
    // ClientRects sehingga 0% stealth yang terbaca berasal dari spoof nyaris
    // kosong, bukan dari pembuangan audio saja. 20% stealth diperoleh kembali
    // saat canvas/WebGL/hardware tetap di-spoof (wrapper tertangkap GLITCH).
    // Coherence worker: creepjs menjalankan tes konsistensi di dalam service
    // worker. Init script patchright TIDAK menyentuh worker, dan evaluate saat
    // event 'serviceworker' kalah cepat dari tes creepjs di SW. Yang menang:
    // suntik spoof ke AKHIR sumber skrip SW lewat route interception (dieksekusi
    // sebelum handler apa pun, termasuk listener pesan creepjs).
    if (cfg) {
      const swScript = spoofSwSrc(cfg);
      // Suntik ke SW + dedicated worker; log HASIL, jangan ditelen diam supaya
      // gagal/berhasil injeksi terbaca.
      const inject = (w, kind) => { try { w.evaluate(spoofSwSrc(cfg)).then((r) => console.log(`  inject ${kind} OK`, JSON.stringify(r))).catch((e) => console.log(`  inject ${kind} GAGAL:`, (e.message || '').split('\n')[0])); } catch (e) { console.log(`  inject ${kind} throw:`, (e.message || '').split('\n')[0]); } };
      context.on('serviceworker', (w) => { console.log('  event serviceworker:', w.url()); inject(w, 'SW'); });
      context.on('worker', (w) => { console.log('  event worker:', w.url()); inject(w, 'worker'); });
      // Route interception juga dipertahankan: menambah jala bila event telat.
      await context.route(/sw\.js|sw-|serviceworker/i, async (route) => {
        try {
          const resp = await route.fetch();
          const ct = resp.headers()['content-type'] || '';
          if (!/javascript/i.test(ct)) {
            return route.fallback();
          }
          const body = await resp.text();
          // Hindari injeksi ganda: lewati kalau tanda spoof sudah ada.
          if (body.includes('fingerprint-spoof')) return route.fulfill({ response: resp, body, headers: resp.headers() });
          const patched = body + '\n;/*fingerprint-spoof*/' + swScript;
          console.log('  route SW dipatch:', resp.url().slice(0, 90));
          return route.fulfill({ response: resp, body: patched, headers: { ...resp.headers(), 'content-length': String(Buffer.byteLength(patched)) } });
        } catch (e) {
          return route.fallback();
        }
      });
    }
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send('Page.enable');

    out.probeSannysoft = null;
    out.sannysoft = await scrapeSannysoft(page, sid);
    out.probeSannysoft = await probeMainWorld(page, cdp);
    out.creep = await scrapeCreepjs(page, cdp);
    await browser.close().catch(() => {});
    context = null;
  } catch (e) {
    out.error = (e.message || '').split('\\n')[0];
    try { if (context) await context.close(); } catch (e2) {}
  }
  if (out.sannysoft) {
    const fails = out.sannysoft.filter((r) => r.res === 'FAIL');
    console.log(`sannysoft: ${out.sannysoft.length - fails.length} PASS / ${fails.length} FAIL dari ${out.sannysoft.length} baris`);
    if (fails.length) console.log('  GAGAL: ' + fails.map((f) => f.name).join(' | '));
  }
  if (out.error) console.log('ERROR:', out.error);
  return out;
}

function printRows(results) {
  const names = [];
  for (const r of results) for (const row of r.sannysoft || []) if (!names.includes(row.name)) names.push(row.name);
  console.log('\\n================ TABEL PER BARI SANNYSOFT ================');
  for (const n of names) {
    const cells = results.map((r) => {
      const row = (r.sannysoft || []).find((x) => x.name === n);
      return `${r.label}: ${row ? row.res : 'n/a'}`;
    });
    console.log(`  ${n.padEnd(34)} ${cells.join('  |  ')}`);
  }
}

(async () => {
  const MODE = (process.env.MODE || 'all').toLowerCase();
  const base = MODE === 'all' || MODE === 'baseline' ? await runVariant('baseline', 'fpdet-base', false) : null;
  await sleep(2000);
  const sp = MODE === 'all' || MODE === 'spoof' ? await runVariant('spoof', 'fpdet-spoof', true) : null;

  printRows([base, sp].filter(Boolean));

  console.log('\\n================ PROBE MAIN WORLD (sudut pandang situs) ================');
  for (const r of [base, sp].filter(Boolean)) {
    const p = (r.creep && r.creep.probe) || {};
    console.log(`[${r.label}] canvasHash=${p.canvasHash} | cores=${p.hardwareConcurrency} | mem=${p.deviceMemory}GB`);
    console.log(`          webgl=${p.webglVendor} / ${p.webglRenderer}`);
    console.log(`          audio=${p.audioSum} | webdriver=${p.webdriver}`);
  }

  console.log('\\n================ CREEPJS ================');
  for (const r of [base, sp].filter(Boolean)) {
    const c = r.creep || {};
    console.log(`[${r.label}] ${c.trust || '(skor tidak terbaca)'} | ${c.lies || ''} | ${c.botOrNot || ''}`);
    console.log(`          ${c.fingerprintId || ''}`);
  }

  const out = path.join('logs', 'sannysoft-creepjs-result.json');
  fs.writeFileSync(out, JSON.stringify({ savedAt: new Date().toISOString(), base, spoof: sp }, null, 2));
  console.log('\\nDetail lengkap -> ' + out);
  process.exit(0);
})().catch((e) => {
  console.error('FATAL:', e.message);
  process.exit(1);
});
