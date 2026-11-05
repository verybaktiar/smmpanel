'use strict';
// Bedah black-box browser AdsPower via CDP (debug port dari local-active).
// Eksplorasi apa yang mereka patch di lapisan JS dan apa yang tersisa:
//   1. Probe MAIN world (canvas hash, audio, hardware, WebGL).
//   2. Cari FUNGSI TAMU: fungsi dasar yang toString-nya bukan format native Chromium.
//   3. Uji bot.sannysoft.com + creepjs, bandingkan dgn hasil panel kita.
// Jalankan: node probe-adspower.js

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

// Tarik profil aktif dari Local API AdsPower.
async function getActiveProfile() {
  const r = await fetch('http://localhost:50325/api/v1/browser/local-active', {
    headers: { Authorization: 'Bearer ' + process.env.ADSPOWER_API_KEY },
  }).then((res) => res.json());
  if (!r.data || !r.data.list || !r.data.list.length) throw new Error('tidak ada profil AdsPower aktif');
  return r.data.list[0];
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

  // Deteksi fungsi "tamuna": fungsi asli jadi bila toString-nya beda dari
  // format bawaan Chromium 'function name() { [native code] }' saat dipanggil.
  const suspects = [
    'HTMLCanvasElement.prototype.toDataURL',
    'HTMLCanvasElement.prototype.toBlob',
    'CanvasRenderingContext2D.prototype.getImageData',
    'AudioBuffer.prototype.getChannelData',
    'Element.prototype.getBoundingClientRect',
    'WebGLRenderingContext.prototype.getParameter',
    'Navigator.prototype.hardwareConcurrency',
    'AudioBuffer.prototype.copyFromChannel',
  ];
  const giftWrap = {};
  for (const path of suspects) {
    try {
      const [cls, prop] = path.split('.prototype.');
      const obj = window[cls] ? window[cls].prototype[cls === 'Navigator' ? 'get hardwareConcurrency' : prop] : null;
      const s = String(obj || '');
      const nativeStd = /function \\(\\) \\{ \\[native code\\] \\}/.test(s) || /\\{ \\[native code\\] \\}/.test(s);
      giftWrap[path] = nativeStd ? 'register native' : s.slice(0, 80);
    } catch (e) { giftWrap[path] = 'gagal baca: ' + (e.message || e).slice(0, 40); }
  }
  return {
    ua: navigator.userAgent.slice(0, 120),
    webdriver: navigator.webdriver,
    hardwareConcurrency: navigator.hardwareConcurrency,
    deviceMemory: navigator.deviceMemory,
    platform: navigator.platform,
    languages: navigator.languages,
    canvasHash: String(hashStr(c.toDataURL())),
    webglVendor: String(webgl.vendor),
    webglRenderer: String(webgl.renderer).slice(0, 80),
    audioSum,
    giftWrap,
  };
}`;

async function probeMainWorld(page, cdp) {
  const out = await cdp.send('Runtime.evaluate', {
    expression: `(${PROBE_SRC})()`,
    awaitPromise: true,
    returnByValue: true,
  });
  if (out.exceptionDetails) throw new Error('probe: ' + JSON.stringify((out.exceptionDetails.exception && out.exceptionDetails.exception.description) || out.exceptionDetails.text).slice(0, 300));
  return out.result.value;
}

async function scrapeSannysoft(page) {
  await page.goto('https://bot.sannysoft.com/', { timeout: 60000, waitUntil: 'domcontentloaded' });
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
  let rows = [], prev = -1, stable = 0;
  for (let i = 0; i < 25; i++) {
    await sleep(800);
    rows = await page.evaluate(rowsExpr);
    const complete = rows.length > 0 && rows.every((r) => r.res !== '');
    if (rows.length === prev && complete) { if (++stable >= 2) break; } else stable = 0;
    prev = rows.length;
  }
  return rows;
}

async function scrapeCreepjs(page, cdp) {
  await page.goto('https://abrahamjuliot.github.io/creepjs/', { timeout: 90000, waitUntil: 'domcontentloaded' });
  let text = '', prev = -1, stable = 0;
  for (let i = 0; i < 45; i++) {
    await sleep(2000);
    text = await page.evaluate(() => (document.body ? document.body.innerText : ''));
    const ready = /trust|lies|grade/i.test(text) && text.length > 200;
    if (ready && text.length === prev) { if (++stable >= 3) break; } else stable = 0;
    prev = text.length;
    if (i % 5 === 4) console.log(`  creepjs tunggu ${((i + 1) * 2)}s, innerText ${text.length} char`);
  }
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const i = lines.findIndex((l) => /^Headless/i.test(l));
  const probe = await probeMainWorld(page, cdp);
  return {
    fpId: (text.match(/FP ID: ([a-f0-9]+)/) || ['-'])[0],
    headlessBlock: i >= 0 ? lines.slice(i + 1, i + 5).join(' ; ') : '(tidak ada)',
    fullText: text.slice(0, 9000),
    probe,
  };
}

(async () => {
  const out = { error: null, profile: null, probe: null, sannysoft: null, creep: null };
  let browser = null;
  try {
    const prof = await getActiveProfile();
    out.profile = { user_id: prof.user_id, debug_port: prof.debug_port };
    console.log('PROFIL ADPOWER aktif:', JSON.stringify(out.profile));
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${prof.debug_port}`);
    console.log('CDP terhubung. Contexts:', browser.contexts().length);
    const ctx = browser.contexts()[0];
    const page = ctx.pages()[0] || (await ctx.newPage());
    const cdp = await browser.newBrowserCDPSession ? await browser.newBrowserCDPSession() : null;
    // Playwright: buat CDPSession dari context bila perBrowserCDPSession tidak ada
    let pageCdp = null;
    try { pageCdp = await ctx.newCDPSession(page); } catch (e) { pageCdp = null; }

    console.log('\\n=== 1. PROBE MAIN WORLD di about blank ===');
    await page.goto('about:blank').catch(() => {});
    out.probe = await probeMainWorld(page, pageCdp);
    console.log('UA:', out.probe.ua);
    console.log('webdriver:', out.probe.webdriver, '| platform:', out.probe.platform, '| lang:', out.probe.languages);
    console.log('cores:', out.probe.hardwareConcurrency, '| mem:', out.probe.deviceMemory);
    console.log('canvasHash:', out.probe.canvasHash);
    console.log('webgl:', out.probe.webglVendor, '/', out.probe.webglRenderer);
    console.log('audio:', out.probe.audioSum);
    console.log('FUNGSI TAMU (lapisan toSt ring dari fungsi dasar):');
    for (const [k, v] of Object.entries(out.probe.giftWrap || {})) console.log('  ', k, '=>', v);

    console.log('\\n=== 2. SANNYSOFT ===');
    out.sannysoft = await scrapeSannysoft(page);
    const fails = out.sannysoft.filter((r) => r.res === 'FAIL');
    console.log(`sannysoft: ${out.sannysoft.length - fails.length} PASS / ${fails.length} FAIL dari ${out.sannysoft.length} baris`);
    if (fails.length) console.log('  GAGAL: ' + fails.map((f) => f.name).join(' | '));

    console.log('\\n=== 3. CREEPJS ===');
    out.creep = await scrapeCreepjs(page, pageCdp);
    console.log('FP ID:', out.creep.fpId);
    console.log('headless/stealth:', out.creep.headlessBlock);
  } catch (e) {
    out.error = (e.message || '').split('\\n')[0];
    console.error('ERROR:', out.error);
  }
  try { if (browser) await browser.close(); } catch (e) {}
  // HANYA browser.close()-nya, TIDAK close profil AdsPower agar tetap  hidup di app.
  const outPath = path.join('logs', 'runtime-adspower-probe.json');
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log('\\nDetail ->', outPath);
  process.exit(0);
})().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
