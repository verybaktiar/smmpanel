'use strict';
/* Tes batch proxy Bright Data — cek IP keluar + geo tiap proxy.
 * Run: node test-proxy-batch.js
 */
require('dotenv').config();
const { chromium } = require('playwright');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const HOST = 'brd.superproxy.io';
const PORT = '44445';
const PASS = 'm54lgk0nxq3v';
const IPS = [
  '178.171.22.65',
  '89.184.24.90',
  '89.184.25.143',
  '72.56.160.178',
  '95.135.87.69',
];

function buildProxy(ip) {
  const username = `brd-customer-hl_24c1d95d-zone-isp_proxy2-ip-${ip}`;
  return { server: `http://${HOST}:${PORT}`, username, password: PASS };
}

(async () => {
  const results = [];
  for (const ip of IPS) {
    const proxy = buildProxy(ip);
    console.log(`\n=== ${ip} ===`);
    const browser = await chromium.launch({ headless: true, proxy });
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await ctx.newPage();
    const rec = { ip, ok: false };
    const t0 = Date.now();
    try {
      await page.goto('https://geo.brdtest.com/mygeo.json', { timeout: 45000, waitUntil: 'domcontentloaded' });
      const raw = await page.evaluate(() => document.body.innerText);
      let geo = {};
      try { geo = JSON.parse(raw); } catch (e) { /* bukan JSON */ }
      rec.ok = true;
      rec.geo = geo;
      rec.raw = raw;
      rec.ms = Date.now() - t0;
      console.log(`✅ Respon ${rec.ms}ms:`, raw.slice(0, 400));
    } catch (e) {
      rec.error = e.message.split('\n')[0];
      console.log(`❌ Gagal: ${rec.error}`);
    }
    await browser.close().catch(() => {});
    results.push(rec);
    await sleep(1000);
  }

  console.log('\n=== RINGKASAN ===');
  for (const r of results) {
    if (r.ok) {
      console.log(`✅ ${r.ip} → respon ok (${r.ms}ms)`);
    } else {
      console.log(`❌ ${r.ip} → ${r.error}`);
    }
  }
})();
