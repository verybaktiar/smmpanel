'use strict';
/* Audit 1: panel fingerprint + WebRTC leak — mengetes KONFIGURASI BARU creator
   (stealth.launchArgs + UA terselaraskan + attachStealthMobile + hardening CDP). */
require('dotenv').config();
const { chromium } = require('playwright');
const stealth = require('./src/stealth');

(async () => {
  const browser = await chromium.launch({ headless: false, args: stealth.launchArgs() });
  const UA = stealth.alignUaVersion(
    'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
    browser.version()
  );
  const context = await browser.newContext({
    viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2,
    locale: 'id-ID', timezoneId: 'Asia/Jakarta',
    userAgent: UA,
  });
  const FP = { userAgent: UA, languages: ['id-ID', 'id', 'en-US', 'en'] };
  await stealth.attachStealthMobile(context, FP);
  const page = await context.newPage();
  await stealth.attachPageHardening(context, page, FP).catch(() => {});
  await page.goto('https://api.ipify.org?format=json', { timeout: 30000, waitUntil: 'domcontentloaded' }).catch(() => {});

  const browserVer = browser.version();
  const panel = await page.evaluate(() => ({
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    languages: navigator.languages,
    hardwareConcurrency: navigator.hardwareConcurrency,
    deviceMemory: navigator.deviceMemory,
    maxTouchPoints: navigator.maxTouchPoints,
    plugins: navigator.plugins ? navigator.plugins.length : null,
    webdriver: navigator.webdriver,
    uaData: navigator.userAgentData ? { brands: navigator.userAgentData.brands, mobile: navigator.userAgentData.mobile, platform: navigator.userAgentData.platform } : null,
    webgl: (() => { try { const c = document.createElement('canvas').getContext('webgl'); return { vendor: c.getParameter(37445), renderer: c.getParameter(37446) }; } catch (e) { return null; } })(),
    chromeObj: !!window.chrome,
  }));
  const webrtc = await page.evaluate(() => new Promise((resolve) => {
    const ips = new Set();
    let pc;
    try { pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] }); } catch (e) { return resolve({ error: String(e) }); }
    pc.createDataChannel('x');
    pc.onicecandidate = (e) => { if (e.candidate) { const m = /([0-9]{1,3}(\.[0-9]{1,3}){3})/.exec(e.candidate.candidate); if (m) ips.add(m[1]); } };
    pc.createOffer().then((o) => pc.setLocalDescription(o)).catch(() => {});
    setTimeout(() => { try { pc.close(); } catch (e) {} resolve({ ips: [...ips] }); }, 6000);
  }));

  console.log('=== VERSI BROWSER NYATA (Chromium Playwright):', browserVer);
  console.log('=== PANEL FINGERPRINT (konfigurasi baru) ===');
  console.log(JSON.stringify(panel, null, 1));
  console.log('=== WEBRTC ===');
  console.log(JSON.stringify(webrtc));

  const uaChrome = (panel.userAgent.match(/Chrome\/(\d+)/) || [])[1];
  // Baca ulang userAgentData di halaman sungguhan (hardening CDP aktif setelah navigasi)
  const uaData2 = await page.evaluate(() => navigator.userAgentData ? { brands: navigator.userAgentData.brands, mobile: navigator.userAgentData.mobile, platform: navigator.userAgentData.platform } : null).catch(() => null);
  panel.uaDataHalamanNyata = uaData2;
  console.log('=== userAgentData di halaman nyata ===');
  console.log(JSON.stringify(uaData2));
  console.log('=== VERDICT ===');
  const uaAndroid = /Android/.test(panel.userAgent);
  if (uaAndroid && panel.platform === 'Linux armv8l') console.log('✅ platform Android konsisten dengan UA (Linux armv8l)');
  else console.log(`❌ PLATFORM MISMATCH: UA Android tapi navigator.platform='${panel.platform}'`);
  if (uaChrome && browserVer && uaChrome === String(browserVer).split('.')[0]) console.log(`✅ versi UA (${uaChrome}) cocok browser nyata (${browserVer})`);
  else console.log(`❌ VERSI UA BOHONG: UA=${uaChrome}, nyata=${browserVer}`);
  if (panel.uaData && panel.uaData.mobile === true && panel.uaData.platform === 'Android') console.log(`✅ userAgentData Android/mobile=true (brands: ${(panel.uaData.brands || []).map((b) => b.brand + ' ' + b.version).join(', ')})`);
  else if (panel.uaData) console.log(`⚠️  userAgentData aneh: ${JSON.stringify(panel.uaData)}`);
  else console.log('⚠️  userAgentData tidak terekspos (Android asli selalu punya — minor)');
  if (panel.maxTouchPoints === 5) console.log('✅ maxTouchPoints=5 (Android asli)');
  else console.log(`⚠️  maxTouchPoints=${panel.maxTouchPoints} (harusnya 5 di mobile)`);
  if (panel.webdriver === undefined || panel.webdriver === false) console.log('✅ navigator.webdriver tertutup');
  else console.log(`❌ webdriver=${panel.webdriver}`);
  const pubIps = (webrtc.ips || []).filter((ip) => !/^(10\.|172\.(1[6-9]|2|3[01])\.|192\.168\.|127\.|0\.)/.test(ip));
  if (pubIps.length) console.log(`❌ WEBRTC LEAK: kandidat IP publik terlihat: ${pubIps.join(', ')}`);
  else if ((webrtc.ips || []).length) console.log(`✅ WebRTC hanya IP lokal: ${webrtc.ips.join(', ')}`);
  else console.log('✅ WebRTC: tidak ada kandidat IP yang bocor');
  await browser.close().catch(() => {});
  process.exit(0);
})().catch((e) => { console.error('GAGAL:', e.message.split('\n')[0]); process.exit(1); });
