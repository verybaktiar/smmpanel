'use strict';
/* Tes batch: buka halaman signup IG lewat tiap proxy Bright Data.
 * Run: node test-proxy-ig-batch.js
 */
require('dotenv').config();
const { chromium } = require('playwright');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const HOST = 'brd.superproxy.io';
const PORT = '44445';
const PASS = 'm54lgk0nxq3v';
const IPS = ['178.171.22.65', '89.184.24.90', '89.184.25.143', '72.56.160.178', '95.135.87.69'];

(async () => {
  const results = [];
  for (const ip of IPS) {
    console.log(`\n=== ${ip} ===`);
    const proxy = {
      server: `http://${HOST}:${PORT}`,
      username: `brd-customer-hl_24c1d95d-zone-isp_proxy2-ip-${ip}`,
      password: PASS,
    };
    const rec = { ip, ok: false };
    const browser = await chromium.launch({
      headless: false,
      args: ['--disable-blink-features=AutomationControlled', '--disable-dev-shm-usage', '--no-sandbox'],
      proxy,
    });
    const ctx = await browser.newContext({
      viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2,
      locale: 'id-ID', timezoneId: 'Asia/Jakarta',
      userAgent: 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
    });
    await ctx.addInitScript(() => { Object.defineProperty(navigator, 'webdriver', { get: () => undefined }); });
    const page = await ctx.newPage();
    try {
      const t0 = Date.now();
      await page.goto('https://www.instagram.com/accounts/emailsignup/', { timeout: 60000, waitUntil: 'domcontentloaded' });
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
      rec.ms = (Date.now() - t0) / 1000 | 0;
      rec.inputs = inputs;
      rec.text = (text || '').slice(0, 150).replace(/\n+/g, ' | ');
      const open = inputs > 0 || /log in|sign up|daftar|email|nomor/i.test(text);
      rec.ok = open;
      console.log(`${rec.ms}dtk | reload=${reloads} | input=${inputs}`);
      console.log(`Konten: ${rec.text}`);
      console.log(open ? '✅ IG signup TERBUKA lewat proxy ini' : '⚠️  Halaman terbuka tapi isi tak dikenali');
      await page.screenshot({ path: `ig-probe-${ip}.png`, fullPage: false });
    } catch (e) {
      rec.error = e.message.split('\n')[0];
      console.log(`❌ Gagal: ${rec.error}`);
      try { await page.screenshot({ path: `ig-probe-${ip}.png` }); } catch (e2) { /* abaikan */ }
    } finally {
      await browser.close().catch(() => {});
      await sleep(1500);
    }
    results.push(rec);
  }

  console.log('\n=== RINGKASAN IG ===');
  for (const r of results) {
    if (r.ok) console.log(`✅ ${r.ip} → terbuka (${r.ms}dtk, input=${r.inputs})`);
    else console.log(`❌ ${r.ip} → ${r.error || ('tidak dikenali: ' + (r.text || ''))}`);
  }
})();
