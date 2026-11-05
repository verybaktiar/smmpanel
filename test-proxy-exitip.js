'use strict';
/* Verifikasi IP keluar ASLI tiap proxy (bandingkan dengan IP yang diminta). */
require('dotenv').config();
const { chromium } = require('playwright');
const net = require('net');

const HOST = 'brd.superproxy.io';
const PORT = '44445';
const PASS = 'm54lgk0nxq3v';
const IPS = ['178.171.22.65', '89.184.24.90', '89.184.25.143', '72.56.160.178', '95.135.87.69'];

(async () => {
  for (const ip of IPS) {
    const proxy = {
      server: `http://${HOST}:${PORT}`,
      username: `brd-customer-hl_24c1d95d-zone-isp_proxy2-ip-${ip}`,
      password: PASS,
    };
    const browser = await chromium.launch({ headless: true, proxy });
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    let exitIp = '?';
    try {
      await page.goto('https://api.ipify.org?format=json', { timeout: 45000, waitUntil: 'domcontentloaded' });
      const txt = await page.evaluate(() => document.body.innerText);
      exitIp = (JSON.parse(txt).ip) || '?';
    } catch (e) {
      exitIp = 'ERR: ' + e.message.split('\n')[0].replace('page.goto: net::', '');
    }
    const match = exitIp === ip ? 'SESUAI' : 'BEDA!';
    console.log(`${match === 'SESUAI' ? '✅' : '⚠️ '} diminta ${ip} → keluar ${exitIp}  [${match}]`);
    await browser.close().catch(() => {});
  }
})();
