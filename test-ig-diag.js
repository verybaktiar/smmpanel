'use strict';
/* Diagnosa: root IG -> klik Log in -> dump konten + daftar link
 * (untuk mencari selector "Lupa kata sandi" yang benar).
 * Run: node test-ig-diag.js "<host:port:user:pass>"
 */
require('dotenv').config();
const { chromium } = require('playwright');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parseProxy(str) {
  let s = str.trim();
  if (!s.includes('@')) s = s.replace(/^\w+:\/\//, '');
  const m = s.match(/^(?:([^:@]+):([^@]+)@)?([^:@]+):(\d+)$/);
  if (m) {
    const proxy = { server: `http://${m[3]}:${m[4]}` };
    if (m[1]) { proxy.username = m[1]; proxy.password = m[2]; }
    return proxy;
  }
  const p = s.split(':');
  if (p.length >= 4) return { server: `http://${p[0]}:${p[1]}`, username: p[2], password: p.slice(3).join(':') };
  return null;
}

(async () => {
  const browser = await chromium.launch({
    headless: false,
    args: ['--disable-blink-features=AutomationControlled', '--disable-dev-shm-usage', '--no-sandbox'],
    proxy: parseProxy(process.argv[2] || ''),
  });
  const context = await browser.newContext({
    viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2,
    locale: 'id-ID', timezoneId: 'Asia/Jakarta',
    userAgent: 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
  });
  await context.addInitScript(() => { Object.defineProperty(navigator, 'webdriver', { get: () => undefined }); });
  const page = await context.newPage();

  try {
    await page.goto('https://www.instagram.com/', { timeout: 60000, waitUntil: 'domcontentloaded' });
    await sleep(6000);

    // Klik link Log in bila ada
    const link = page.locator('a[href*="/accounts/login"], a:has-text("Log in"), a:has-text("Masuk")').first();
    if ((await link.count()) > 0) {
      await link.click().catch(() => {});
      console.log('Klik Log in OK, url:', page.url());
      await sleep(8000);
    } else {
      console.log('Link Log in tidak ketemu di root');
    }

    // Dump teks + link
    const text = await page.evaluate(() => document.body ? document.body.innerText : '').catch(() => '');
    console.log('--- TEKS HALAMAN (500 char) ---');
    console.log((text || '').slice(0, 500).replace(/\n+/g, ' | '));
    const links = await page.evaluate(() =>
      [...document.querySelectorAll('a')].slice(0, 30).map((a) => `[${(a.innerText || '').trim().slice(0, 30)}] -> ${(a.getAttribute('href') || '').slice(0, 60)}`).join('\n')
    ).catch(() => 'n/a');
    console.log('--- LINKS ---');
    console.log(links);
    const inputs = await page.evaluate(() =>
      [...document.querySelectorAll('input, button')].slice(0, 15).map((e) => `${e.tagName}[type=${e.type || ''}][aria=${(e.getAttribute('aria-label') || '').slice(0, 25)}][txt=${(e.innerText || '').trim().slice(0, 20)}]`).join('\n')
    ).catch(() => 'n/a');
    console.log('--- INPUTS/BUTTONS ---');
    console.log(inputs);
    await page.screenshot({ path: 'ig-diag.png' }).catch(() => {});
  } catch (e) {
    console.log('GAGAL:', e.message.split('\n')[0]);
  } finally {
    await browser.close().catch(() => {});
  }
  process.exit(0);
})();
