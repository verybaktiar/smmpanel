'use strict';
/* Tes proxy Bright Data via Playwright:
 * 1) cek IP/geo keluar  2) buka halaman signup IG.
 * Run: node test-proxy-bd.js "<host:port:user:pass>" [--no-ig]
 */
require('dotenv').config();
const { chromium } = require('playwright');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const RAW = process.argv[2] || '';
if (!RAW) { console.error('Pemakaian: node test-proxy-bd.js "host:port:user:pass"'); process.exit(1); }
const NO_IG = process.argv.includes('--no-ig');

function parseBd(str) {
  let s = str.trim();
  if (!s.includes('@')) s = s.replace(/^\w+:\/\//, '');
  // Format 1: user:pass@host:port
  const m = s.match(/^(?:([^:@]+):([^@]+)@)?([^:@]+):(\d+)$/);
  if (m) {
    const proxy = { server: `http://${m[3]}:${m[4]}` };
    if (m[1]) { proxy.username = m[1]; proxy.password = m[2]; }
    return proxy;
  }
  // Format 2: host:port:user:pass
  const p = s.split(':');
  if (p.length >= 4) {
    return { server: `http://${p[0]}:${p[1]}`, username: p[2], password: p.slice(3).join(':') };
  }
  throw new Error('format proxy tidak dikenali');
}

(async () => {
  const proxy = parseBd(RAW);
  console.log('Proxy server:', proxy.server, '| user:', proxy.username);
  const browser = await chromium.launch({
    headless: false, // perlu headed biar IG tidak curiga
    args: ['--disable-blink-features=AutomationControlled', '--disable-dev-shm-usage', '--no-sandbox'],
    proxy,
  });

  // 1) Cek IP keluar
  let ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  let page = await ctx.newPage();
  let geo = {};
  try {
    await page.goto('https://geo.brdtest.com/mygeo.json', { timeout: 45000, waitUntil: 'domcontentloaded' });
    geo = await page.evaluate(() => { try { return JSON.parse(document.body.innerText); } catch (e) { return {}; } });
    console.log(`IP keluar : ${geo.ip || '?'}  |  ${geo.city || '?'}, ${geo.country || '?'} (tz: ${geo.timezone || '?'})`);
  } catch (e) {
    console.log('Gagal cek geo:', e.message.split('\n')[0]);
  }
  await ctx.close();

  if (NO_IG) { console.log('Selesai (--no-ig).'); await browser.close(); process.exit(0); }

  // 2) Buka halaman signup IG
  ctx = await browser.newContext({
    viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2,
    locale: 'id-ID', timezoneId: 'Asia/Jakarta',
    userAgent: 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
  });
  await ctx.addInitScript(() => { Object.defineProperty(navigator, 'webdriver', { get: () => undefined }); });
  page = await ctx.newPage();
  try {
    const t0 = Date.now();
    await page.goto('https://www.instagram.com/accounts/emailsignup/', { timeout: 60000, waitUntil: 'domcontentloaded' });
    // Polling sabar: aset IG lambat via proxy, reload max 3x bila splash macet
    let text = '', inputs = 0, reloads = 0;
    for (let i = 0; i < 18; i++) {
      await sleep(5000);
      text = (await page.evaluate(() => document.body ? document.body.innerText : '').catch(() => '')) || '';
      inputs = await page.locator('input').count().catch(() => 0);
      if (inputs > 0 || /sign up|daftar|log in|masuk/i.test(text)) break;
      if (i > 0 && i % 6 === 0 && reloads < 3) {
        reloads++;
        console.log(`... splash macet (${i * 5}s), reload ke-${reloads}`);
        try { await page.reload({ timeout: 45000, waitUntil: 'domcontentloaded' }); } catch (e) { /* lanjut */ }
      }
    }
    console.log(`IG signup: total ${(Date.now() - t0) / 1000 | 0}dtk | reload=${reloads} | input=${inputs}`);
    console.log('Konten awal:', (text || '').slice(0, 200).replace(/\n+/g, ' | '));
    if (inputs > 0 || /log in|sign up|daftar|email|nomor/i.test(text)) console.log('✅ IG signup TERBUKA lewat proxy');
    else console.log('⚠️  Halaman terbuka tapi isi tak dikenali — cek ig-proxy-probe.png');
    await page.screenshot({ path: 'ig-proxy-probe.png', fullPage: false });
  } catch (e) {
    console.log('❌ Gagal buka IG signup:', e.message.split('\n')[0]);
    try { await page.screenshot({ path: 'ig-proxy-probe.png' }); } catch (e2) { /* abaikan */ }
    process.exitCode = 1;
  } finally {
    await browser.close().catch(() => {});
  }
})();
