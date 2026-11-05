'use strict';

/**
 * Audit stealth LIVE — replikasi konfigurasi PERSIS creator (Chrome asli
 * channel:chrome + proxy + attachStealthMobile + hardening CDP), lalu cek
 * kebocoran dari dalam halaman: webdriver, UA-CH, WebGL, WebRTC, timezone.
 * Run: node audit-stealth-live.js [proxy]   (tanpa argumen = direct IP)
 */
require('dotenv').config();
const { chromium } = require('playwright');
const stealth = require('./src/stealth');

const PROXY_ARG = process.argv.slice(2)[0] || null;

(async () => {
  const launchOptions = { headless: false, args: stealth.launchArgs() };
  if (PROXY_ARG) {
    const p = PROXY_ARG.split(':');
    launchOptions.proxy = { server: `http://${p[0]}:${p[1]}` };
    if (p[2]) { launchOptions.proxy.username = p[2]; launchOptions.proxy.password = p[3] || ''; }
  }
  // Jalur utama creator: Chrome ASLI dulu, fallback Chromium (sama seperti creator TikTok)
  let browser = null, usingRealChrome = true;
  try { browser = await chromium.launch({ ...launchOptions, channel: 'chrome' }); }
  catch (e) { browser = await chromium.launch(launchOptions); usingRealChrome = false; }

  const realVer = browser.version();
  const UA = stealth.alignUaVersion(
    'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
    realVer
  );
  const context = await browser.newContext({
    viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2,
    locale: 'id-ID', timezoneId: 'Asia/Jakarta', userAgent: UA,
  });
  const FP = { userAgent: UA, languages: ['id-ID', 'id', 'en-US', 'en'] };
  await stealth.attachStealthMobile(context, FP);
  context.on('page', (pg) => { stealth.attachPageHardening(context, pg, FP).catch(() => {}); });
  const page = await context.newPage();
  await stealth.attachPageHardening(context, page, FP).catch(() => {});

  const ipPage = await page.goto('https://api.ipify.org?format=json', { timeout: 45000, waitUntil: 'domcontentloaded' })
    .then((r) => r.text()).catch(() => '');
  const exitIp = (/"ip"\s*:\s*"([\d.]+)"/.exec(ipPage) || [])[1] || '?';

  const panel = await page.evaluate(() => ({
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    languages: [...(navigator.languages || [])],
    language: navigator.language,
    hardwareConcurrency: navigator.hardwareConcurrency,
    deviceMemory: navigator.deviceMemory,
    maxTouchPoints: navigator.maxTouchPoints,
    plugins: navigator.plugins ? navigator.plugins.length : null,
    webdriver: navigator.webdriver,
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
    uaData: navigator.userAgentData ? {
      brands: navigator.userAgentData.brands, mobile: navigator.userAgentData.mobile, platform: navigator.userAgentData.platform,
    } : null,
    uaDataHigh: null,
    webgl: (() => { try { const c = document.createElement('canvas').getContext('webgl'); return { vendor: c.getParameter(37445), renderer: c.getParameter(37446) }; } catch (e) { return null; } })(),
    chromeObj: !!window.chrome,
  }));
  panel.uaDataHigh = await page.evaluate(async () => {
    try { return await navigator.userAgentData.getHighEntropyValues(['platform', 'platformVersion', 'model', 'fullVersionList', 'architecture', 'bitness']); }
    catch (e) { return null; }
  }).catch(() => null);

  const webrtc = await page.evaluate(() => new Promise((resolve) => {
    const ips = new Set();
    let pc;
    try { pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] }); }
    catch (e) { return resolve({ error: String(e) }); }
    pc.createDataChannel('x');
    pc.onicecandidate = (e) => { if (e.candidate) { const m = /([0-9]{1,3}(\.[0-9]{1,3}){3})/.exec(e.candidate.candidate); if (m) ips.add(m[1]); } };
    pc.createOffer().then((o) => pc.setLocalDescription(o)).catch(() => {});
    setTimeout(() => { try { pc.close(); } catch (e) {} resolve({ ips: [...ips] }); }, 6000);
  }));

  console.log('=== BROWSER NYATA:', usingRealChrome ? 'Google Chrome asli (channel chrome)' : 'Chromium Playwright (fallback)', '| versi', realVer);
  console.log('=== IP KELUAR via proxy:', exitIp, PROXY_ARG ? '(proxy: ' + PROXY_ARG.split(':').slice(0, 2).join(':') + ')' : '(direct)');
  console.log('=== PANEL FINGERPRINT ==='); console.log(JSON.stringify(panel, null, 1));
  console.log('=== WEBRTC (STUN google) ==='); console.log(JSON.stringify(webrtc));

  console.log('=== VERDICT ===');
  const ck = (ok, okMsg, badMsg) => console.log((ok ? 'OK  ' : 'FAIL') + ' ' + (ok ? okMsg : badMsg));
  ck(panel.webdriver === undefined || panel.webdriver === false, `webdriver tertutup (${panel.webdriver})`, `webdriver=${panel.webdriver} TERLIHAT`);
  const uaMajor = (panel.userAgent.match(/Chrome\/(\d+)/) || [])[1];
  ck(uaMajor === String(realVer).split('.')[0], `versi UA (${uaMajor}) = browser nyata (${realVer})`, `versi UA bohong: UA=${uaMajor} nyata=${realVer}`);
  ck(/Android/.test(panel.userAgent) && panel.platform === 'Linux armv8l', 'platform Android konsisten (Linux armv8l)', `platform mismatch: '${panel.platform}' vs UA Android`);
  const d = panel.uaDataHigh || {};
  ck(d.platform === 'Android' && d.model === 'Pixel 7', `UA-CH high-entropy: Android / ${d.model || '?'} / platformVer ${d.platformVersion || '?'}`, `UA-CH high-entropy salah: ${JSON.stringify({ platform: d.platform, model: d.model })}`);
  ck(panel.maxTouchPoints === 5, 'maxTouchPoints=5 (Android)', `maxTouchPoints=${panel.maxTouchPoints}`);
  ck(panel.tz === 'Asia/Jakarta', `timezone halaman = ${panel.tz}`, `timezone halaman = ${panel.tz} (harusnya Asia/Jakarta)`);
  ck(panel.language === 'id-ID', `language = ${panel.language}`, `language = ${panel.language}`);
  const gl = panel.webgl || {};
  ck(gl.vendor === 'ARM' && /Mali/.test(gl.renderer || ''), `WebGL Android konsisten (${gl.vendor} / ${gl.renderer})`, `WebGL TIDAK konsisten mobile: ${gl.vendor} / ${gl.renderer}`);
  const pubIps = (webrtc.ips || []).filter((ip) => !/^(10\.|172\.(1[6-9]|2|3[01])\.|192\.168\.|127\.|100\.|0\.)/.test(ip));
  ck(!pubIps.length, 'WebRTC tidak bocor IP publik' + ((webrtc.ips || []).length ? ` (hanya: ${webrtc.ips.join(', ')})` : ''), `WEBRTC LEAK: ${pubIps.join(', ')}`);
  const leakedHome = (webrtc.ips || []).some((ip) => pubIps.includes(ip) && ip !== exitIp);
  ck(!leakedHome, 'IP asli (rumah) tidak muncul di kandidat ICE', 'IP ASLI TERLIHAT via WebRTC');
  console.log('Panel lengkap tersimpan: sessions/stealth-audit.json');
  try {
    const fs = require('fs');
    fs.mkdirSync('sessions', { recursive: true });
    fs.writeFileSync('sessions/stealth-audit.json', JSON.stringify({ at: new Date().toISOString(), browser: usingRealChrome ? 'chrome' : 'chromium', realVer, exitIp, panel, webrtc }, null, 2));
  } catch (e) { /* abaikan */ }
  await browser.close().catch(() => {});
  process.exit(0);
})().catch((e) => { console.error('GAGAL:', e.message.split('\n')[0]); process.exit(1); });
