'use strict';
/* Diagnosa akses TikTok via proxy (satu-satunya skrip yang dipertahankan).
   Usage:
     node test-tiktok-access.js                       -> tanpa proxy (IP rumah)
     node test-tiktok-access.js host:port:user:pass   -> via proxy
   Output: IP keluar, geo publik, status HTTP tiktok.com, verdict. */
require('dotenv').config();
const { chromium } = require('playwright');

const PROXY_ARG = process.argv[2] || null;
const UA = 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';

(async () => {
  const launchOptions = { headless: true, args: ['--no-sandbox'] };
  if (PROXY_ARG) {
    const p = String(PROXY_ARG).split(':');
    if (p.length !== 4 && p.length !== 2) { console.error('Format proxy: host:port atau host:port:user:pass'); process.exit(1); }
    launchOptions.proxy = { server: `http://${p[0]}:${p[1]}` };
    if (p[2]) { launchOptions.proxy.username = p[2]; launchOptions.proxy.password = p[3] || ''; }
  }
  const browser = await chromium.launch(launchOptions);
  const page = await (await browser.newContext({ userAgent: UA })).newPage();
  let ip = '?', geo = '?', tt = 'ERR';
  try {
    await page.goto('https://api.ipify.org?format=json', { timeout: 45000, waitUntil: 'domcontentloaded' });
    ip = JSON.parse(await page.evaluate(() => document.body.innerText)).ip || '?';
    await page.goto(`http://ip-api.com/json/${ip}?fields=country,city,isp`, { timeout: 30000, waitUntil: 'domcontentloaded' });
    const g = JSON.parse(await page.evaluate(() => document.body.innerText));
    geo = `${g.country || '?'}/${g.city || '?'} (${g.isp || '?'})`;
  } catch (e) {
    ip = 'ERR: ' + e.message.split('\n')[0].replace('page.goto: net::', '');
  }
  if (!String(ip).startsWith('ERR')) {
    try {
      const resp = await page.goto('https://www.tiktok.com/', { timeout: 60000, waitUntil: 'domcontentloaded' });
      tt = resp ? `HTTP ${resp.status()}` : 'no-response';
    } catch (e) {
      tt = 'ERR: ' + e.message.split('\n')[0].replace('page.goto: net::', '');
    }
  }
  const lolos = /^HTTP 2/.test(tt);
  console.log(`IP keluar : ${ip}`);
  console.log(`Geo       : ${geo}`);
  console.log(`tiktok.com: ${tt}`);
  console.log(`Verdict   : ${lolos ? 'LOLOS — proxy ini bisa dipakai untuk TikTok' : 'DIBLOKIR / gagal — proxy ini tidak bisa dipakai untuk TikTok'}`);
  await browser.close().catch(() => {});
  process.exit(lolos ? 0 : 2);
})().catch((e) => { console.error('GAGAL:', e.message.split('\n')[0]); process.exit(1); });
