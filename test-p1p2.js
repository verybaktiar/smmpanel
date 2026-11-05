'use strict';
// Tes end-to-end adopsi P1+P2 di jalur panel ASLI (openAccountBrowser) — v3:
//   P2 — UA natural engine patchright (headed) = format reduced Chrome asli modern
//        ("Chrome/153.0.0.0", persis perilaku Chrome asli — BUKAN sinyal bot);
//        headless → UA sintetis fp tanpa "HeadlessChrome" (major disamakan binary).
//   P1 — geolocation koordinat dari IP proxy STICKY (permission tetap "ask" default;
//        di tes di-grant sementara HANYA untuk membaca koordinat & membandingkan geo).
// Jalankan: node test-p1p2.js 66
require('dotenv').config();
const { openAccountBrowser, stickyProxy } = require('./src/browser');
const stealth = require('./src/stealth');
const db = require('./src/db');

(async () => {
  const id = Number(process.argv[2] || 66);
  await db.waitReady();
  const account = await db.getAccountById(id);
  if (!account) { console.error('Akun tidak ditemukan:', id); process.exit(1); }
  console.log('Akun:', account.name, '| proxy:', account.proxy || '(kosong)');

  // --- Diagnostik geo (logika yang sama dgn openAccountBrowser) ---
  const sticky = stickyProxy(account.proxy, account.name);
  const geo = await stealth.resolveProxyGeo(sticky).catch((e) => ({ error: e.message }));
  console.log('\n=== DIAGNOSTIK GEO (sticky:', (sticky.split(':')[2] || '').slice(0, 30) + ') ===');
  console.log('geo:', JSON.stringify(geo));
  const fp0 = await stealth.ensureAccountFingerprint(account).catch(() => null);
  console.log('fp.timezoneId:', fp0 && fp0.timezoneId, '| fp.userAgent (DB):', fp0 && fp0.userAgent);

  // ================= 1) HEADED (jalur tombol Buka) =================
  const { context } = await openAccountBrowser(account, { headless: false });
  const bObj = context.browser();
  console.log('\n=== DIAGNOSTIK BROWSER OBJ (persistent context) ===');
  console.log('context.browser():', bObj ? 'ADA' : 'NULL',
    '| newBrowserCDPSession:', bObj && typeof bObj.newBrowserCDPSession === 'function' ? 'ADA' : 'TIDAK',
    '| version():', bObj && typeof bObj.version === 'function' ? bObj.version() : 'TIDAK');

  const page = await context.newPage();
  const ua = await page.evaluate(() => navigator.userAgent);
  console.log('\n=== P2 (HEADED): UA natural ===');
  console.log('UA        :', ua);
  console.log('Headless? :', /Headless/i.test(ua) ? 'YA (SALAH!)' : 'TIDAK ✓');
  console.log('Format    :', /Chrome\/(\d+)\.0\.0\.0/.test(ua) ? 'reduced (major.0.0.0) = format Chrome asli modern ✓' : 'non-standar');

  // P1: state permission default dulu (perilaku panel nyata), lalu grant utk baca koordinat
  await page.goto('https://example.com', { timeout: 45000, waitUntil: 'domcontentloaded' });
  const stDefault = await page.evaluate(() => navigator.permissions.query({ name: 'geolocation' }).then((s) => s.state)).catch(() => '?');
  console.log('\n=== P1: GEOLOCATION ===');
  console.log('Permission default (tanpa grant):', stDefault);
  console.log('userAgentData di situs nyata  :', await page.evaluate(() => typeof navigator.userAgentData));
  try {
    await context.grantPermissions(['geolocation'], { origin: 'https://example.com' });
    const pos = await page.evaluate(() => new Promise((resolve) => {
      const t = setTimeout(() => resolve({ error: 'timeout (coords tidak tertempel?)' }), 15000);
      navigator.geolocation.getCurrentPosition(
        (p) => { clearTimeout(t); resolve({ lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy }); },
        (e) => { clearTimeout(t); resolve({ error: e.message }); },
        { timeout: 14000 }
      );
    }));
    console.log('Koordinat dibaca situs :', JSON.stringify(pos));
    console.log('Harapan (geo IP sticky):', JSON.stringify({ lat: geo.latitude, lon: geo.longitude }));
    const match = pos.lat === geo.latitude && pos.lon === geo.longitude;
    console.log('KOORDINAT COHEREN DGN IP PROXY:', match ? 'YA ✓' : 'TIDAK ✗');
  } catch (e) { console.log('geo test error:', e.message.split('\n')[0]); }
  try { await context.close(); } catch (e) {}

  // ================= 2) HEADLESS (jalur warming/health-check) =================
  const headlessAcc = { ...account, id: null }; // clone tanpa id → tak menulis ip_history
  const { context: ctxH } = await openAccountBrowser(headlessAcc, { headless: true });
  const pageH = await ctxH.newPage();
  const uaH = await pageH.evaluate(() => navigator.userAgent);
  console.log('\n=== P2 (HEADLESS): mask HeadlessChrome ===');
  console.log('UA headless:', uaH);
  console.log('HeadlessChrome hilang:', !/Headless/i.test(uaH) ? 'YA ✓' : 'TIDAK ✗');
  console.log('Major sinkron binary:', /Chrome\/153\.0\.0\.0/.test(uaH) ? 'YA ✓ (153)' : 'periksa: ' + uaH);
  try { await ctxH.close(); } catch (e) {}

  console.log('\nSelesai.');
  process.exit(0);
})().catch((e) => { console.error('FATAL:', (e.message || '').split('\n').slice(0, 3).join('\n')); process.exit(1); });
