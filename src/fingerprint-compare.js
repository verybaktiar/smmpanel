'use strict';
// Perbandingan fingerprint otomatis: Playwright vs Patchright (+ AdsPower bila hidup).
// Jalankan: node src/fingerprint-compare.js
// Membuka bot.sannysoft.com pada tiap engine via proxy DataImpulse Indonesia,
// membaca status tiap baris tes dari DOM, plus probe JS penting (webdriver, plugins, WebGL, dst).
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');

const DI_HOST = 'gw.dataimpulse.com:823';
const DI_KEY = '3075a7ad6bdec8af6597';
const DI_PASS = 'c1c5eef4de4fbac0';
// AdsPower Local API memakai api-key (lihat di app: Automation -> API). Bisa lewat env:
const AP_KEY = process.env.ADSPOWER_API_KEY || process.env.AP_API_KEY || '';

function diProxy(sid) {
  const user = `${DI_KEY}__cr.id;sid.${sid}`;
  return { server: `http://${DI_HOST}`, username: user, password: DI_PASS };
}

function getJson(url, timeoutMs = 5000) {
  return new Promise((resolve) => {
    const headers = {};
    if (AP_KEY) headers['Authorization'] = `Bearer ${AP_KEY}`;
    const req = http.get(url, { timeout: timeoutMs, headers }, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve(null); } });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PROBES = `(() => {
  function webgl() {
    try {
      const c = document.createElement('canvas');
      const gl = c.getContext('webgl');
      const dbg = gl.getExtension('WEBGL_debug_renderer_info');
      return { vendor: gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL), renderer: gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) };
    } catch (e) { return { vendor: '?', renderer: '?' }; }
  }
  let permState = '?';
  return Promise.resolve().then(async () => {
    try { permState = (await navigator.permissions.query({ name: 'notifications' })).state; } catch (e) {}
    const w = webgl();
    return {
      ua: navigator.userAgent,
      webdriver: navigator.webdriver,
      platform: navigator.platform,
      languages: navigator.languages,
      plugins: navigator.plugins.length,
      chromeObj: !!window.chrome,
      hardwareConcurrency: navigator.hardwareConcurrency,
      deviceMemory: navigator.deviceMemory,
      permState,
      webglVendor: w.vendor,
      webglRenderer: w.renderer
    };
  });
})()`;

function extractRowsExpr() {
  return () => {
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
}

async function scrapeSannysoft(page) {
  await page.goto('https://bot.sannysoft.com/', { timeout: 45000, waitUntil: 'domcontentloaded' });
  // Tabel sannysoft terisi progresif — tunggu sampai jumlah baris stabil & terisi semua.
  let rows = [];
  let prev = -1, stable = 0;
  for (let i = 0; i < 25; i++) {
    await page.waitForTimeout(800);
    rows = await page.evaluate(extractRowsExpr());
    const complete = rows.length > 0 && rows.every((r) => r.res !== '');
    if (rows.length === prev && complete) { if (++stable >= 2) break; } else stable = 0;
    prev = rows.length;
  }
  return rows;
}

async function testEngine(name, launchFn) {
  const out = { engine: name, sannysoft: null, probes: null, error: null };
  let ctx = null;
  try {
    ctx = await launchFn();
    const page = ctx.pages()[0] || (await ctx.newPage());
    out.sannysoft = await scrapeSannysoft(page);
    out.probes = await page.evaluate(PROBES);
  } catch (e) {
    out.error = (e.message || '').split('\n')[0];
  }
  try { if (ctx) await ctx.close(); } catch (e) {}
  return out;
}

(async () => {
  const results = [];

  // 1) Playwright (engine lama panel)
  const pw = require('playwright');
  results.push(await testEngine('playwright', async () => {
    const b = await pw.chromium.launch({
      headless: false,
      proxy: diProxy('fpauto-pw'),
      args: ['--disable-blink-features=AutomationControlled', '--no-sandbox', '--no-first-run', '--no-default-browser-check'],
    });
    return b.newContext({ locale: 'id-ID', timezoneId: 'Asia/Jakarta' });
  }));

  // 2) Patchright (engine stealth open-source)
  const pr = require('patchright');
  results.push(await testEngine('patchright', async () => {
    const b = await pr.chromium.launch({
      headless: false,
      proxy: diProxy('fpauto-pr'),
      args: ['--no-sandbox', '--no-first-run', '--no-default-browser-check'],
    });
    return b.newContext({ locale: 'id-ID', timezoneId: 'Asia/Jakarta' });
  }));

  // 3) AdsPower via Local API (kalau app-nya hidup)
  const status = await getJson('http://localhost:50325/status');
  await sleep(1300); // limit free plan: +-1 request/detik
  if (status && status.code === 0) {
    if (!AP_KEY) {
      results.push({ engine: 'adspower', error: 'ADSPOWER_API_KEY belum diisi (ambil dari app: Automation -> API, lalu jalankan: ADSPOWER_API_KEY=xxxx node src/fingerprint-compare.js)' });
    } else {
      const list = await getJson('http://localhost:50325/api/v1/user/list?page_size=5');
      await sleep(1300);
      const first = list && list.data && list.data.list && list.data.list[0];
      if (first) {
        const start = await getJson(`http://localhost:50325/api/v1/browser/start?user_id=${first.user_id}&headless=0&open_tabs=1`);
        await sleep(1300);
        if (start && start.data && start.data.ws && start.data.debug_port) {
        const prc = require('playwright');
        results.push(await testEngine('adspower(' + (first.name || first.user_id) + ')', async () => {
          const b = await prc.chromium.connectOverCDP(`http://127.0.0.1:${start.data.debug_port}`);
          return b.contexts()[0];
        }));
        await getJson(`http://localhost:50325/api/v1/browser/stop?user_id=${first.user_id}`);
      } else {
        results.push({ engine: 'adspower', error: 'start profil gagal: ' + JSON.stringify(start).slice(0, 120) });
      }
      } else {
        results.push({ engine: 'adspower', error: 'list profil kosong / api-key salah: ' + JSON.stringify(list).slice(0, 160) });
      }
    }
  } else {
    results.push({ engine: 'adspower', error: 'app tidak jalan (Local API mati) — buka AdsPower lalu ulangi' });
  }
  // Catatan: AdsPower Global plan free membatasi Local API ("paid subscriptions"),
  // jadi pengukuran AdsPower via API hanya bisa kalau langganan aktif. Gunakan versi manual untuk free.

  // ---- Ringkasan ----
  const fsOut = path.join('logs', 'fingerprint-compare.json');
  fs.writeFileSync(fsOut, JSON.stringify(results, null, 2));
  for (const r of results) {
    console.log('\n================ ' + r.engine.toUpperCase() + ' ================');
    if (r.error) { console.log('ERROR:', r.error); continue; }
    const fails = r.sannysoft.filter((x) => x.res === 'FAIL');
    const passes = r.sannysoft.filter((x) => x.res === 'PASS');
    console.log(`sannysoft: ${passes.length} PASS / ${fails.length} FAIL dari ${r.sannysoft.length} baris`);
    if (fails.length) console.log('  GAGAL : ' + fails.map((f) => f.name).join(' | '));
    const p = r.probes || {};
    console.log('  webdriver:', p.webdriver, '| chromeObj:', p.chromeObj, '| plugins:', p.plugins, '| perm:', p.permState);
    console.log('  platform:', p.platform, '| langs:', JSON.stringify(p.languages), '| core:', p.hardwareConcurrency, '| mem:', p.deviceMemory);
    console.log('  WebGL  :', p.webglVendor, '/', p.webglRenderer);
    console.log('  UA     :', (p.ua || '').slice(0, 110));
  }
  console.log('\nDetail lengkap -> ' + fsOut);
  process.exit(0);
})();
