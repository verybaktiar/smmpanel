'use strict';
// STEALTH LAYER — anti-detect terpusat untuk semua browser automation.
// Dipakai oleh browser.js (satu pintu), jadi seluruh aksi (posting, like, comment,
// DM, story, warming) dapat perlakuan yang sama.
//
// Lapisan:
//   1. Fingerprint konsisten per akun (UA/viewport/locale/timezone disimpan ke DB,
//      tidak diacak ulang tiap buka — sinyal paling sering bikin akun dicurigai
//      adalah fingerprint yang berubah-ubah).
//   2. Hardening runtime via CDP: UA override asli + navigator.userAgentData +
//      Accept-Language, sehingga mode headless TIDAK meninggalkan "HeadlessChrome".
//
// Sejak migrasi patchright, init script stealth MANUAL (webdriver/plugins/WebGL)
// tidak lagi dipakai jalur panel — patchright menangani di level engine, dan
// menumpuk stealth buatan justru bisa melemahkan patch internalnya.
// attachStealth/attachStealthMobile tetap diekspor hanya untuk alat A/B lama.

const fs = require('fs');
const path = require('path');
const db = require('./db');
const net = require('net');
const tls = require('tls');
const spoof = require('./fingerprint-spoof');

// ---- Geo dari IP proxy (ip-api.com, gratis & tanpa key) ----
// Cache 24 jam per IP supaya tidak lookup berulang di setiap buka browser.
const GEO_CACHE_FILE = path.join(__dirname, '..', 'sessions', 'proxy-geo-cache.json');
const geoCache = (() => { try { return JSON.parse(fs.readFileSync(GEO_CACHE_FILE, 'utf8')); } catch (e) { return {}; } })();
let geoCacheDirty = false;

function saveGeoCache() {
  if (!geoCacheDirty) return;
  try {
    fs.mkdirSync(path.dirname(GEO_CACHE_FILE), { recursive: true });
    fs.writeFileSync(GEO_CACHE_FILE, JSON.stringify(geoCache, null, 1));
    geoCacheDirty = false;
  } catch (e) { /* abaikan */ }
}
setInterval(saveGeoCache, 10000).unref();

function httpGetText(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const mod = u.protocol === 'https:' ? tls : require('http');
    const req = mod.get(u, { timeout: 10000 }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c.toString(); });
      res.on('end', () => resolve(body));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
  });
}

async function lookupIpGeo(ip) {
  if (!ip) return null;
  const now = Date.now();
  const hit = geoCache[ip];
  if (hit && now - hit.t < 86400000) return hit.geo;
  try {    const raw = await httpGetText(`http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,country,countryCode,timezone,city,lat,lon`);
  const j = JSON.parse(raw);
  if (j.status === 'success' && j.timezone) {
    geoCache[ip] = { t: now, geo: { country: j.countryCode, timezone: j.timezone, city: j.city, latitude: j.lat, longitude: j.lon } };
      geoCacheDirty = true;
      saveGeoCache();
      return geoCache[ip].geo;
    }
  } catch (e) { /* offline/blocked — pakai fallback negara */ }
  return null;
}

// Geo proxy via CONNECT (ip-api hanya HTTP, jadi tidak butuh chain HTTPS).
// Nama lama lookupProxyGeo dipertahankan.
async function lookupProxyGeo(proxyStr) {
  const s = String(proxyStr || '').trim();
  if (!s) return null;
  // Cache per proxy (di-hash — jangan simpan kredensial di file cache).
  const key = 'p:' + require('crypto').createHash('sha1').update(s).digest('hex').slice(0, 16);
  const now = Date.now();
  const hit = geoCache[key];
  // TTL 1 jam — proxy rotasi bisa berganti exit IP sewaktu-waktu.
  if (hit && now - hit.t < 3600000) return hit.geo;
  const geo = await lookupProxyGeoLive(s);
  if (geo) { geoCache[key] = { t: now, geo }; geoCacheDirty = true; saveGeoCache(); }
  return geo;
}

// Lookup live via CONNECT (ip-api HTTP; fallback ipwho.is HTTP).
async function lookupProxyGeoLive(s) {
  let host, port, user, pass;
  if (s.includes('@')) {
    const m = s.match(/^(?:\w+:\/\/)?(?:([^:@]+):([^@]+)@)?([^:]+):(\d+)$/);
    if (!m) return null;
    host = m[3]; port = +m[4]; user = m[1]; pass = m[2];
  } else {
    const parts = s.replace(/^\w+:\/\//, '').split(':');
    if (parts.length < 2) return null;
    host = parts[0]; port = +parts[1];
    if (parts.length >= 4) { user = parts[2]; pass = parts[3]; }
  }
  return new Promise((resolve) => {
    const sock = net.connect(port, host);
    const done = (r) => { try { sock.destroy(); } catch (e) { /* abaikan */ } resolve(r); };
    const timer = setTimeout(() => done(null), 15000);
    sock.on('error', () => { clearTimeout(timer); done(null); });
    sock.on('connect', () => {
      let auth = '';
      if (user) auth = `Proxy-Authorization: Basic ${Buffer.from(`${user}:${pass || ''}`).toString('base64')}\r\n`;
      sock.write(`CONNECT ip-api.com:80 HTTP/1.1\r\nHost: ip-api.com:80\r\n${auth}\r\n`);
    });
    let head = '';
    sock.on('data', (chunk) => {
      head += chunk.toString();
      if (!head.includes('\r\n\r\n')) return;
      if (!/ 200 /.test(head.split('\r\n')[0])) { clearTimeout(timer); done(null); return; }
      sock.removeAllListeners('data');
      sock.write('GET /json/?fields=status,countryCode,timezone,city,lat,lon HTTP/1.1\r\nHost: ip-api.com\r\nConnection: close\r\n\r\n');
      let body = '';
      sock.on('data', (c) => { body += c.toString(); });
      sock.on('close', () => {
        clearTimeout(timer);
        try {
          const j = JSON.parse(body.split('\r\n\r\n').pop());
          if (j.status === 'success' && j.timezone) {
            return done({ country: j.countryCode, timezone: j.timezone, city: j.city, latitude: j.lat, longitude: j.lon });
          }
        } catch (e) { /* abaikan */ }
        done(null);
      });
    });
  });
}

// Geo fingerprint: proxy di-lookup via CONNECT; direct (tanpa proxy) pakai IP
// publik sendiri. Fallback terakhir: Indonesia.
async function resolveProxyGeo(proxyStr) {
  if (String(proxyStr || '').trim()) {
    const geo = await lookupProxyGeo(proxyStr);
    if (geo) return geo;
  } else {
    try {
      const ip = (await httpGetText('http://api.ipify.org')).trim();
      if (/^\d+\.\d+\.\d+\.\d+$/.test(ip)) {
        const g = await lookupIpGeo(ip);
        if (g) return g;
      }
    } catch (e) { /* abaikan */ }
  }
  return { country: 'ID', timezone: 'Asia/Jakarta', city: 'Jakarta', latitude: -6.2088, longitude: 106.8456 };
}

// Opsi geolocation context dari hasil geo lookup (paritas AdsPower "Location: Based on
// IP"): koordinat dari IP proxy; PERMISSION TIDAK diberikan otomatis (tetap "ask",
// persis AdsPower "[Ask]"). Return null bila koordinat tak tersedia.
function geolocationOption(geo) {
  if (!geo || typeof geo.latitude !== 'number' || typeof geo.longitude !== 'number') return null;
  if (!isFinite(geo.latitude) || !isFinite(geo.longitude)) return null;
  return { latitude: geo.latitude, longitude: geo.longitude, accuracy: 100 };
}

// Locale utama untuk sebuah timezone (dipakai P3: sync fingerprint geo saat proxy diset).
function localeForTz(tz) {
  return (LOCALE_BY_TZ[tz] || LOCALE_BY_TZ['Asia/Jakarta'])[0];
}

// ---- Fingerprint BARU (signup): diacak sekali, lalu dipakai selamanya ----
// Acak UA/viewport; locale+timezone mengikuti geo IP proxy supaya "perangkat"
// cocok dengan lokasi jaringannya (antisipasi inkonsistensi device-vs-IP).
function pickFreshFingerprint(geo) {
  const g = geo || {};
  const tz = g.timezone || 'Asia/Jakarta';
  const loc = LOCALE_BY_TZ[tz] || LOCALE_BY_TZ['Asia/Jakarta'];
  return {
    userAgent: USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)],
    viewport: (() => { const v = VIEWPORTS[Math.floor(Math.random() * VIEWPORTS.length)]; return `${v.width}x${v.height}`; })(),
    locale: loc[0],
    languages: loc[1],
    timezoneId: tz,
    geoCountry: g.country || 'ID',
  };
}

// UA mobile Android (PICK FRESH SIGNUP — paritas IG/TikTok Create):
// signup FB dibuka di emulasi HP Android, bukan desktop Windows/Mac. FB mc
// memberi varian mobile-form di device Android (form ringkas, nomor HP
// langsung tersedia), jejak "desktop baru + langsung daftar" jadi hilang.
const USER_AGENTS = [
  // Original 4
  'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (Linux; Android 12; Redmi Note 11) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
  
  // Samsung Series
  'Mozilla/5.0 (Linux; Android 13; SM-A536E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (Linux; Android 14; SM-S928B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (Linux; Android 13; SM-A235F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (Linux; Android 12; SM-G780G) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Mobile Safari/537.36',
  
  // Xiaomi/Redmi/Poco  
  'Mozilla/5.0 (Linux; Android 13; 2201116SG) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (Linux; Android 14; 23129RAA4G) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (Linux; Android 13; M2101K7AG) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (Linux; Android 12; 21091116AG) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (Linux; Android 13; 23049PCD8G) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
  
  // OPPO/Realme/Vivo
  'Mozilla/5.0 (Linux; Android 13; CPH2581) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (Linux; Android 14; RMX3851) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (Linux; Android 13; V2244) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (Linux; Android 12; CPH2409) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Mobile Safari/537.36',
  
  // Google Pixel Series
  'Mozilla/5.0 (Linux; Android 13; Pixel 6a) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (Linux; Android 12; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (Linux; Android 14; Pixel 7a) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Mobile Safari/537.36',
  
  // Various Chrome versions
  'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (Linux; Android 12; SM-A325F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (Linux; Android 13; 2201116SG) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (Linux; Android 14; RMX3851) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36',
  
  // Motorola/Lenovo
  'Mozilla/5.0 (Linux; Android 13; XT2301-5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (Linux; Android 12; Lenovo TB-370FU) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Mobile Safari/537.36',
  
  // Huawei/Honor
  'Mozilla/5.0 (Linux; Android 13; LIO-AN00) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (Linux; Android 12; NTH-AN00) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Mobile Safari/537.36',
  
  // OnePlus
  'Mozilla/5.0 (Linux; Android 13; CPH2581) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (Linux; Android 14; CPH2617) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Mobile Safari/537.36',
  
  // Nokia/TCL
  'Mozilla/5.0 (Linux; Android 13; Nokia G50) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (Linux; Android 12; TCL 20SE) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Mobile Safari/537.36',
  
  // Infinix/Tecno/Itel (populer di Indonesia)
  'Mozilla/5.0 (Linux; Android 13; Infinix X6833B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (Linux; Android 14; Tecno KG7h) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (Linux; Android 12; Itel S661LP) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Mobile Safari/537.36',
  
  // More Samsung variants
  'Mozilla/5.0 (Linux; Android 13; SM-M536B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (Linux; Android 14; SM-A156B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (Linux; Android 12; SM-A037G) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Mobile Safari/537.36',
  
  // More Xiaomi/POCO
  'Mozilla/5.0 (Linux; Android 13; 22101320G) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (Linux; Android 14; 23127PN0CG) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (Linux; Android 12; M2104K10AC) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Mobile Safari/537.36',
  
  // More OPPO/Realme
  'Mozilla/5.0 (Linux; Android 13; CPH2605) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (Linux; Android 14; RMX3991) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (Linux; Android 12; CPH2371) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Mobile Safari/537.36',
  
  // More Vivo/iQOO
  'Mozilla/5.0 (Linux; Android 13; V2247) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (Linux; Android 14; I2222) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (Linux; Android 12; V2130) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Mobile Safari/537.36',
  
  // More Google Pixel
  'Mozilla/5.0 (Linux; Android 13; Pixel 6 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (Linux; Android 12; Pixel 4a) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36',
  
  // More Motorola
  'Mozilla/5.0 (Linux; Android 13; XT2401-2) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (Linux; Android 12; moto g62 5G) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Mobile Safari/537.36',
  
  // More Huawei/Honor
  'Mozilla/5.0 (Linux; Android 13; ANY-AN00) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (Linux; Android 12; LYA-AL00) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Mobile Safari/537.36',
  
  // More OnePlus
  'Mozilla/5.0 (Linux; Android 13; CPH2449) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (Linux; Android 12; KB2003) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Mobile Safari/537.36',
  
  // Asus/ZTE
  'Mozilla/5.0 (Linux; Android 13; ASUS_I006D) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (Linux; Android 12; ZTE 9040R) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Mobile Safari/537.36',
  
  // Chrome version variants (same models, different versions)
  'Mozilla/5.0 (Linux; Android 13; SM-A536E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (Linux; Android 12; Redmi Note 11) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (Linux; Android 13; 2201116SG) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Mobile Safari/537.36'
];

// Timezone berdasar negara proxy. Default Indonesia.
const TZ_BY_COUNTRY = {
  id: 'Asia/Jakarta',
  sg: 'Asia/Singapore',
  my: 'Asia/Kuala_Lumpur',
  us: 'America/New_York',
  gb: 'Europe/London',
  de: 'Europe/Berlin',
  nl: 'Europe/Amsterdam',
  fr: 'Europe/Paris',
  jp: 'Asia/Tokyo',
};

// Locale berpasangan dengan timezone (satu sumber, tidak diacak terpisah lagi).
const LOCALE_BY_TZ = {
  'Asia/Jakarta': ['id-ID', ['id-ID', 'id', 'en-US', 'en']],
  'Asia/Singapore': ['en-SG', ['en-SG', 'en', 'zh-SG']],
  'Asia/Kuala_Lumpur': ['ms-MY', ['ms-MY', 'ms', 'en']],
  'America/New_York': ['en-US', ['en-US', 'en']],
  'Europe/London': ['en-GB', ['en-GB', 'en']],
  'Europe/Berlin': ['de-DE', ['de-DE', 'de', 'en']],
  'Europe/Amsterdam': ['nl-NL', ['nl-NL', 'nl', 'en']],
  'Europe/Paris': ['fr-FR', ['fr-FR', 'fr', 'en']],
  'Asia/Tokyo': ['ja-JP', ['ja-JP', 'ja', 'en']],
};

// Viewport mobile Android (DPR 2, tinggi mengikuti layar asli saat launch).
const VIEWPORTS = [
  { width: 412, height: 915 },   // Pixel 7
  { width: 384, height: 854 },   // Redmi Note 11
  { width: 384, height: 824 },   // UMIDIGI / A53 umum
  { width: 360, height: 800 },   // Galaxy M / A series
  
  // Tambahan varian viewport
  { width: 393, height: 851 },   // Pixel 8
  { width: 430, height: 932 },   // iPhone 14 Pro
  { width: 390, height: 844 },   // iPhone 12 Pro
  { width: 360, height: 780 },   // Galaxy A13
  { width: 412, height: 892 },   // Realme 10 Pro+
  { width: 393, height: 873 },   // Vivo V29
  { width: 412, height: 915 },   // OPPO Reno 8
  { width: 360, height: 800 },   // Infinix Hot 30
  { width: 412, height: 915 },   // Tecno Camon 20
  { width: 360, height: 800 },   // Itel S23+
  { width: 393, height: 851 },   // Motorola Edge 40
  { width: 412, height: 915 },   // Nokia G42
];

function countryFromProxy(proxyStr) {
  // Format didukung: host:port:user:pass (negara tak terbaca di sini tanpa lookup).
  // Deteksi kasar dari hostname provider yang umum dipakai panel (opsional).
  const s = String(proxyStr || '').toLowerCase();
  if (s.includes('.id') || s.includes('indonesia')) return 'id';
  if (s.includes('.sg') || s.includes('singapore')) return 'sg';
  if (s.includes('.us') || s.includes('united') && s.includes('states')) return 'us';
  return null;
}

// Fingerprint deterministik per akun (seed = account.id) supaya konsisten.
function pickFingerprint(account) {
  const seed = Number(account.id) || 0;
  const ua = USER_AGENTS[seed % USER_AGENTS.length];
  const vp = VIEWPORTS[seed % VIEWPORTS.length];
  const tz = account.timezone || TZ_BY_COUNTRY[countryFromProxy(account.proxy)] || 'Asia/Jakarta';
  const loc = LOCALE_BY_TZ[tz] || LOCALE_BY_TZ['Asia/Jakarta'];
  return {
    userAgent: ua,
    viewport: `${vp.width}x${vp.height}`,
    locale: loc[0],
    languages: loc[1],
    timezoneId: tz,
  };
}

// Simpan fingerprint ke DB bila akun belum punya — SEKALI saja lalu permanen.
// Ini yang membuat akun terlihat sebagai "orang yang sama" tiap sesi.
async function ensureAccountFingerprint(account) {
  if (!account) return pickFingerprint(account || {});
  const needUA = !account.user_agent || account.user_agent === 'default';
  const needLocale = !account.locale;
  const needTz = !account.timezone;
  const needVp = !account.viewport;
  if (!needUA && !needLocale && !needTz && !needVp) {
    return {
      userAgent: account.user_agent,
      viewport: account.viewport,
      locale: account.locale,
      languages: (LOCALE_BY_TZ[account.timezone] || LOCALE_BY_TZ['Asia/Jakarta'])[1],
      timezoneId: account.timezone,
    };
  }
  const fp = pickFingerprint(account);
  try {
    await db.waitReady();
    db.run(
      `UPDATE accounts SET user_agent = COALESCE(NULLIF(?, ''), user_agent),
         viewport = COALESCE(NULLIF(?, ''), viewport),
         locale = COALESCE(NULLIF(?, ''), locale),
         timezone = COALESCE(NULLIF(?, ''), timezone)
       WHERE id = ?`,
      [needUA ? fp.userAgent : '', needVp ? fp.viewport : '', needLocale ? fp.locale : '', needTz ? fp.timezoneId : '', account.id]
    );
    db.save();
  } catch (e) {
    console.log(`  [stealth] fingerprint akun ${account.id} gagal disimpan: ${e.message}`);
  }
  return fp;
}

// ==== INIT SCRIPT (dijalankan sebelum halaman mana pun) ====
// Catatan: semua override memakai helper makeNative agar Function.toString()
// tidak membongkar patch (deteksi klasik: fn.toString().includes('[native code]')).
const INIT_SCRIPT = `
(() => {
  const makeNative = (fn, name) => {
    try {
      Object.defineProperty(fn, 'name', { value: name, configurable: true });
      const orig = Function.prototype.toString;
      const fake = () => 'function ' + name + '() { [native code] }';
      fn.toString = () => { try { return fake(); } catch (e) { return orig.call(fn); } };
    } catch (e) {}
    return fn;
  };

  // 1) webdriver
  try { delete Object.getPrototypeOf(navigator).webdriver; } catch (e) {}
  try {
    Object.defineProperty(navigator, 'webdriver', { get: () => false, configurable: true });
  } catch (e) {}

  // 2) bahasa & platform (diisi dari variabel yang di-inject per akun)
  try { Object.defineProperty(navigator, 'languages', { get: () => __LANGS__, configurable: true }); } catch (e) {}
  try { Object.defineProperty(navigator, 'language', { get: () => __LANGS__[0], configurable: true }); } catch (e) {}
  try { Object.defineProperty(navigator, 'platform', { get: () => __PLATFORM__, configurable: true }); } catch (e) {}

  // 3) plugins & mimeTypes realistis (Chrome desktop: PDF viewer dll)
  try {
    const pluginData = [
      { name: 'PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
      { name: 'Chrome PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
      { name: 'Chromium PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
      { name: 'Microsoft Edge PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
      { name: 'WebKit built-in PDF', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
    ];
    const pluginStore = {
      length: pluginData.length,
      item: (i) => pluginData[i] || null,
      namedItem: (n) => pluginData.find((p) => p.name === n) || null,
      refresh: () => {},
      [Symbol.iterator]: function* () { yield* pluginData; },
    };
    pluginData.forEach((p, i) => { pluginStore[i] = p; });
    Object.defineProperty(navigator, 'plugins', { get: () => pluginStore, configurable: true });
    Object.defineProperty(navigator, 'mimeTypes', {
      get: () => ({ length: 2, item: () => null, namedItem: () => null, [Symbol.iterator]: function* () {} }),
      configurable: true,
    });
  } catch (e) {}

  // 4) hardware & memory (diisi dari konfig spoof per akun, bukan statis 8/8
  //    yang identik di semua akun — sinyal clustering antar akun)
  try { Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => __HWC__, configurable: true }); } catch (e) {}
  try { Object.defineProperty(navigator, 'deviceMemory', { get: () => __DMEM__, configurable: true }); } catch (e) {}
  try { Object.defineProperty(navigator, 'maxTouchPoints', { get: () => __MAXTOUCH__, configurable: true }); } catch (e) {}

  // 5) window.chrome (headless baru baru tanpa ini)
  try {
    if (!window.chrome) window.chrome = {};
    window.chrome.runtime = window.chrome.runtime || {
      OnInstalledReason: { CHROME_UPDATE: 'chrome_update', INSTALL: 'install', SHARED_MODULE_UPDATE: 'shared_module_update', UPDATE: 'update' },
      OnRestartRequiredReason: { APP_UPDATE: 'app_update', OS_UPDATE: 'os_update', PERIODIC: 'periodic' },
      PlatformArch: { ARM: 'arm', ARM64: 'arm64', MIPS: 'mips', MIPS64: 'mips64', X86_32: 'x86-32', X86_64: 'x86-64' },
      PlatformNaclArch: { ARM: 'arm', MIPS: 'mips', MIPS64: 'mips64', X86_32: 'x86-32', X86_64: 'x86-64' },
      PlatformOs: { ANDROID: 'android', CROS: 'cros', LINUX: 'linux', MAC: 'mac', OPENBSD: 'openbsd', WIN: 'win' },
      RequestUpdateCheckStatus: { ERROR: 'error', NO_UPDATE: 'no_update', THROTTLED: 'throttled' },
    };
    window.chrome.loadTimes = window.chrome.loadTimes || function () {
      return { requestTime: performance.timeOrigin / 1000, startLoadTime: performance.timeOrigin / 1000,
        commitLoadTime: performance.timeOrigin / 1000, finishDocumentLoadTime: performance.timeOrigin / 1000,
        finishLoadTime: performance.timeOrigin / 1000, firstPaintTime: performance.timeOrigin / 1000,
        firstPaintAfterLoadTime: 0, navigationType: 'Other', wasFetchedViaSpdy: false,
        wasNpnNegotiated: true, npnNegotiatedProtocol: 'h2', wasAlternateProtocolAvailable: false,
        connectionInfo: 'h2' };
    };
    window.chrome.csi = window.chrome.csi || function () {
      return { onloadT: performance.timeOrigin, startE: performance.timeOrigin, pageT: performance.now(), tran: 15 };
    };
    window.chrome.app = window.chrome.app || { isInstalled: false, InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' }, RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' } };
  } catch (e) {}

  // 6) permissions.query: Notification harus 'prompt' seperti Chrome asli
  try {
    const origQuery = window.Notification && navigator.permissions
      ? navigator.permissions.query.bind(navigator.permissions) : null;
    if (origQuery) {
      navigator.permissions.query = makeNative((p) =>
        p && p.name === 'notifications'
          ? Promise.resolve({ state: Notification.permission, onchange: null })
          : origQuery(p), 'query');
    }
  } catch (e) {}

  // 7) WebGL: samarkan vendor/renderer GPU (__WEBGL_VENDOR__/__WEBGL_RENDERER__
  //    diisi per-platform: desktop Intel, Android ARM/Mali — harus konsisten dgn UA)
  try {
    const VENDOR = __WEBGL_VENDOR__;
    const RENDERER = __WEBGL_RENDERER__;
    const hookGetParameter = (proto) => {
      const orig = proto.getParameter;
      proto.getParameter = makeNative(function (param) {
        try {
          if (param === 37445) return VENDOR;          // UNMASKED_VENDOR_WEBGL
          if (param === 37446) return RENDERER;        // UNMASKED_RENDERER_WEBGL
        } catch (e) {}
        return orig.call(this, param);
      }, 'getParameter');
    };
    if (window.WebGLRenderingContext) hookGetParameter(WebGLRenderingContext.prototype);
    if (window.WebGL2RenderingContext) hookGetParameter(WebGL2RenderingContext.prototype);
  } catch (e) {}

  // 8) iframe contentWindow konsisten (patch cegah null error klasik)
  try {
    const origHTMLIFrameElement = window.HTMLIFrameElement;
    if (origHTMLIFrameElement) {
      Object.defineProperty(origHTMLIFrameElement.prototype, 'contentWindow', {
        get: function () {
          const w = Object.getOwnPropertyDescriptor(origHTMLIFrameElement.prototype, 'contentWindow').get.call(this);
          return w || null;
        },
        configurable: true,
      });
    }
  } catch (e) {}

  // 9) sinyal CDP paling umum: error di console saat error thrown null
  try {
    const origToString = Error.prototype.toString;
    Error.prototype.toString = makeNative(function () {
      try { return origToString.call(this).replace(/at /g, 'at '); } catch (e) { return origToString.call(this); }
    }, 'toString');
  } catch (e) {}

  // 10) kemampuan media tambahan agar tidak "browser kosong"
  try {
    const origCanPlay = HTMLMediaElement.prototype.canPlayType;
    HTMLMediaElement.prototype.canPlayType = makeNative(function (type) {
      // Chromium headless lama melaporkan kosong utk codec tertentu; normalkan.
      const r = origCanPlay.call(this, type);
      if (!r && /probably/i.test('') === false && (type || '').includes('h264')) return 'probably';
      return r;
    }, 'canPlayType');
  } catch (e) {}

  // 11) WebRTC anti-leak: buang iceServers (STUN) dari setiap RTCPeerConnection.
  //  Tanpa STUN, kandidat srflx ber-IP publik tidak pernah terbentuk — IP asli
  //  tidak bisa dibaca situs walau proxy HTTP aktif (flag CLI saja tidak cukup).
  try {
    const OrigPC = window.RTCPeerConnection || window.webkitRTCPeerConnection;
    if (OrigPC) {
      const Patched = makeNative(function (cfg, ...rest) {
        const c = new OrigPC(Object.assign({}, cfg || {}, { iceServers: [] }), ...rest);
        return c;
      }, 'RTCPeerConnection');
      Patched.prototype = OrigPC.prototype;
      window.RTCPeerConnection = Patched;
      if (window.webkitRTCPeerConnection) window.webkitRTCPeerConnection = Patched;
    }
  } catch (e) {}
})();`;

// Platform sesuai UA Windows/Mac/Linux/Android — dipilih dari UA itu sendiri agar konsisten.
function platformFromUA(ua) {
  if (!ua) return 'Win32';
  if (ua.includes('Android')) return 'Linux armv8l';
  if (ua.includes('Macintosh')) return 'MacIntel';
  if (ua.includes('Linux') && !ua.includes('Android')) return 'Linux x86_64';
  return 'Win32';
}

// Pasangan WebGL per-platform: desktop Intel generik, Android sesuai GPU Pixel (Mali).
const WEBGL_DESKTOP = { vendor: 'Intel Inc.', renderer: 'Intel Iris OpenGL Engine' };
const WEBGL_ANDROID = { vendor: 'ARM', renderer: 'Mali-G710' };

// Konfig spoof sebuah akun: dari DB bila sudah ada, bila belum dibuat sekali
// (deterministik dari id) lalu disimpan permanen ke accounts.fingerprint_json.
async function ensureSpoofConfig(account) {
  if (account && account.fingerprint_json) {
    try {
      const cfg = JSON.parse(account.fingerprint_json);
      if (cfg && typeof cfg.canvasSeed === 'number') return cfg;
    } catch (e) { /* JSON rusak — buat ulang */ }
  }
  const cfg = spoof.spoofConfigFor(account || {});
  if (account && account.id) {
    try {
      await db.waitReady();
      db.run('UPDATE accounts SET fingerprint_json = ? WHERE id = ?', [JSON.stringify(cfg), account.id]);
      db.save();
    } catch (e) {
      console.log(`  [stealth] konfig spoof akun ${account.id} gagal disimpan: ${e.message}`);
    }
  }
  return cfg;
}

// Init script spoof utk jalur panel (browser.js): SEMUA permukaan spoof dalam satu
// script. Jalur ini tidak memasang INIT_SCRIPT lama, jadi hardware + WebGL ikut di sini.
function spoofInitScript(cfg) {
  return spoof.initScript(cfg, { includeHardwareWebgl: true });
}

async function attachStealth(context, fp, opts = {}) {
  const cfg = opts.spoof || spoof.spoofFromFp(fp || {});
  const script = INIT_SCRIPT
    .replace(/__LANGS__/g, JSON.stringify(fp.languages || ['id-ID', 'id', 'en-US', 'en']))
    .replace(/__PLATFORM__/g, JSON.stringify(platformFromUA(fp.userAgent)))
    .replace(/__MAXTOUCH__/g, '0')
    .replace(/__WEBGL_VENDOR__/g, JSON.stringify((cfg.webgl && cfg.webgl.vendor) || WEBGL_DESKTOP.vendor))
    .replace(/__WEBGL_RENDERER__/g, JSON.stringify((cfg.webgl && cfg.webgl.renderer) || WEBGL_DESKTOP.renderer))
    .replace(/__HWC__/g, String(cfg.hardwareConcurrency || 8))
    .replace(/__DMEM__/g, String(cfg.deviceMemory || 8));
  await context.addInitScript(script);
  // Permukaan tambahan (canvas/audio/rects) — hardware & WebGL sudah di INIT_SCRIPT
  // di atas, jadi di sini dilepas supaya tidak double-patch.
  await context.addInitScript(spoof.initScript(cfg, { includeHardwareWebgl: false }));
}

// ==== VARIAN MOBILE (Android) — dipakai creator IG/TikTok mode mobile ==== 
// Android Chrome melaporkan platform 'Linux armv8l' dan maxTouchPoints 5.
const isAndroidUa = (ua) => /Android/.test(String(ua || ''));
// Model + versi Android dibaca dari UA, lalu dipakai Client Hints. Dulu modelnya
// dipaku 'Pixel 7': begitu UA berasal dari pool (Redmi, Infinix, OPPO), Client
// Hints yang masih menyebut Pixel 7 jadi pertentangan yang gampang terbaca situs.
function androidInfoFromUa(ua) {
  const m = /Android\s+([\d.]+)\s*;\s*([^;)]+)/i.exec(String(ua || ''));
  if (!m) return null;
  const model = m[2].trim().replace(/\s+Build\/.*$/i, '');
  return { version: m[1], model };
}

// platformVersion Client Hints memakai tiga segmen (13.0.0), sedangkan UA hanya
// membawa major (13) atau major.minor (13.0).
function androidPlatformVersion(raw) {
  const p = String(raw || '13').split('.');
  return `${p[0] || '13'}.${p[1] || '0'}.0`;
}
function attachStealthMobile(context, fp) {
  const cfg = spoof.spoofFromFp(fp || {});
  const script = INIT_SCRIPT
    .replace(/__LANGS__/g, JSON.stringify(fp.languages || ['id-ID', 'id', 'en-US', 'en']))
    .replace(/__PLATFORM__/g, JSON.stringify('Linux armv8l'))
    .replace(/__MAXTOUCH__/g, '5')
    .replace(/__WEBGL_VENDOR__/g, JSON.stringify((cfg.webgl && cfg.webgl.vendor) || WEBGL_ANDROID.vendor))
    .replace(/__WEBGL_RENDERER__/g, JSON.stringify((cfg.webgl && cfg.webgl.renderer) || WEBGL_ANDROID.renderer))
    .replace(/__HWC__/g, String(cfg.hardwareConcurrency || 8))
    .replace(/__DMEM__/g, String(cfg.deviceMemory || 8));
  return context.addInitScript(script).then(() => context.addInitScript(spoof.initScript(cfg, { includeHardwareWebgl: false })));
}

// Samakan versi Chrome di UA dengan versi Chromium yang BENAR-benar dipakai —
// selisih versi UA-vs-nyata adalah sinyal bot klasik (terbaca dari fitur JS/Client Hints).
function alignUaVersion(ua, realVersion) {
  const v = String(realVersion || '').split('.');
  if (!v[0]) return ua;
  return String(ua || '').replace(/Chrome\/[\d.]+/, `Chrome/${v[0]}.0.0.0`);
}

// Argumen launch standar: cegah KEBOCORAN IP ASLI via WebRTC (dengan proxy HTTP,
// STUN/UDP tidak bisa lewat — kandidat ICE publik tak akan terlihat situs; tanpa
// ini IP rumah/server bocor walau proxy aktif). TANPA flag anti-automation buatan:
// patchright (engine panel) menanganinya, flag buatan justru melemahkan patch internal.
function launchArgs() {
  return [
    '--disable-dev-shm-usage',
    '--no-sandbox',
    '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
  ];
}

// Hardening runtime via CDP per page:
//  - UA override ASLI (menghapus "HeadlessChrome" di level protokol, bukan hanya JS)
//  - navigator.userAgentData (brands + platform version, dipakai situs modern)
//  - Accept-Language sesuai locale akun
async function attachPageHardening(context, page, fp, opts = {}) {
  try {
    const session = await page.context().newCDPSession(page);
    const ua = fp.userAgent;
    if (opts.langOnly) {
      // Mode UA NATURAL (panel headed): UA sudah asli dari binary patchright — JANGAN
      // override platform/userAgentData; biarkan nilai asli engine (koherensi penuh,
      // paritas AdsPower UA full build). Cukup Accept-Language sesuai locale akun.
      await session.send('Emulation.setUserAgentOverride', {
        userAgent: ua,
        acceptLanguage: (fp.languages || ['id-ID', 'id', 'en-US', 'en']).join(','),
      });
      return;
    }
    const platform = platformFromUA(ua);
    const android = isAndroidUa(ua);
    const androidInfo = android ? androidInfoFromUa(ua) : null;
    const brands = [];
    const verMatch = ua.match(/Chrome\/(\d+)/);
    const major = verMatch ? verMatch[1] : '131';
    brands.push({ brand: 'Chromium', version: major }, { brand: 'Google Chrome', version: major });
    const platformVersion = android
      ? androidPlatformVersion(androidInfo && androidInfo.version)
      : platform === 'Win32' ? '15.0.0' : platform === 'MacIntel' ? '14.5.0' : '6.6.0';
    await session.send('Emulation.setUserAgentOverride', {
      userAgent: ua,
      acceptLanguage: (fp.languages || ['id-ID', 'id', 'en-US', 'en']).join(','),
      platform: android ? 'Android' : platform === 'MacIntel' ? 'macOS' : platform === 'Linux x86_64' ? 'Linux' : 'Windows',
      userAgentMetadata: {
        brands,
        fullVersion: `${major}.0.0.0`,
        fullVersionList: brands,
        mobile: android,
        model: android ? ((androidInfo && androidInfo.model) || 'Pixel 7') : '',
        platform: android ? 'Android' : platform === 'MacIntel' ? 'macOS' : platform === 'Linux x86_64' ? 'Linux' : 'Windows',
        platformVersion,
        architecture: android ? 'arm' : 'x86',
        bitness: '64',
        wow64: false,
      },
    });
    // TANPA init script stealth via CDP — patchright menangani di level engine;
    // menumpuk patch buatan bisa melemahkan patch internalnya (aturan patchright).
  } catch (e) {
    // CDP gagal (mis. browser non-Chromium) — init script context tetap jalan.
  }
}

module.exports = {
  USER_AGENTS,
  VIEWPORTS,
  pickFingerprint,
  ensureAccountFingerprint,
  ensureSpoofConfig,
  spoofInitScript,
  attachStealth,
  attachStealthMobile,
  attachPageHardening,
  platformFromUA,
  resolveProxyGeo,
  lookupIpGeo,
  geolocationOption,
  localeForTz,
  pickFreshFingerprint,
  alignUaVersion,
  launchArgs,
  isAndroidUa,
};
