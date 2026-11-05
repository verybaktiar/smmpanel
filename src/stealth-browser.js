'use strict';
// Browser manual STEALTH via Patchright — fork Playwright dengan patch anti-detect
// level C (CDP runtime leaks, webdriver, automation surface) tanpa stealth script buatan.
//
// CLI SAMA PERSIS dengan proxy-browser.js (biar gampang A/B compare):
//   node src/stealth-browser.js [proxy] [url] [--mobile] [--spoof] [--profile <folder>] [--sid <id>] [--ttl <detik>]
//
// --spoof: pasang spoof fingerprint (canvas/audio/ClientRects/hardware/WebGL) di
// atas patchright, cfg deterministik per profil/sid (paritas jalur panel browser.js).
//
// Contoh (kelahiran IG via DataImpulse Indonesia):
//   node src/stealth-browser.js "gw.dataimpulse.com:823:KEY__cr.id:SECRET" \
//     https://www.instagram.com/accounts/emailsignup/ --mobile --profile sessions/stealth-akun1
//
// Contoh ujicoba kelahiran Gmail (DI Indonesia + sticky, geo koheren dari IP):
//   node src/stealth-browser.js "gw.dataimpulse.com:823:KEY__cr.id:SECRET" \
//     https://accounts.google.com/signup --profile sessions/gmail-test --sid gmail-test --shot
//
// Paritas P1/P2 panel (AdsPower-style):
//   P1 — timezone/locale/koordinat geolocation mengikuti IP proxy sticky ("Based on IP");
//        permission lokasi tetap "ask" (tidak di-grant otomatis).
//   P2 — headed: UA natural binary patchright apa adanya (TIDAK di-spoof).
//
// Catatan patchright: JANGAN tambah stealth hack manual (addInitScript webdriver dll) —
// patch internalnya malah bisa lemif kalau ditimpa. Jangan pakai flag
// --disable-blink-features=AutomationControlled (patchright menangani lewat jalurnya sendiri).
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { chromium } = require('patchright');
const stealth = require('./stealth');
const spoof = require('./fingerprint-spoof');

// ---- Parse argumen (identik proxy-browser.js) ----
const argv = process.argv.slice(2);
const FLAGS = ['--mobile', '--shot', '--spoof'];
const OPTS = ['--profile', '--sid', '--ttl'];
const MOBILE = argv.includes('--mobile');
const SPOOF = argv.includes('--spoof');

function argVal(name) {
  const i = argv.indexOf(name);
  if (i !== -1 && argv[i + 1] && !argv[i + 1].startsWith('--')) return argv[i + 1];
  const eq = argv.find((a) => a.startsWith(name + '='));
  return eq ? eq.slice(name.length + 1) : null;
}

const POSITIONAL = argv.filter((a, i) => {
  if (FLAGS.includes(a) || OPTS.includes(a)) return false;
  if (OPTS.some((o) => a.startsWith(o + '='))) return false;
  return !OPTS.includes(argv[i - 1]);
});

// Tanpa argumen = TANPA proxy (IP rumah/tethering). Proxy default sebelumnya
// senyap memakai kuota DataImpulse saat maksudnya jalan "kosong".
const PROXY_ARG = POSITIONAL[0] || null;
const URL = POSITIONAL[1] || 'https://www.instagram.com/';
const PROFILE_ARG = argVal('--profile');
const PROFILE_DIR = PROFILE_ARG ? path.resolve(PROFILE_ARG) : null;
const TTL_NUM = argVal('--ttl') ? parseInt(argVal('--ttl'), 10) : 0;
let SID = argVal('--sid') || (PROFILE_DIR ? path.basename(PROFILE_DIR) : null);
if (SID) SID = String(SID).replace(/[^a-zA-Z0-9_-]/g, '-') || null;

// Sticky DataImpulse: paritas stickyProxy panel — lock negara cr.<DI_COUNTRY> bila
// username belum punya param "__", plus sid.<nama> (raw tanpa suffix = negara ACAK!).
function applySticky(proxyStr) {
  const p = proxyStr.split(':');
  if (!SID || p.length < 3) return proxyStr;
  if (!p[0].includes('dataimpulse')) {
    console.log(`[sid] --sid diabaikan: hanya berlaku untuk gateway DataImpulse (ini ${p[0]}).`);
    return proxyStr;
  }
  const params = [];
  if (!p[2].includes('__')) {
    const cc = String(process.env.DI_COUNTRY || 'id').trim().toLowerCase();
    if (cc && cc !== 'off') params.push(`cr.${cc}`);
  }
  params.push(`sid.${SID}`);
  if (TTL_NUM > 0) params.push(`sessttl.${TTL_NUM}`);
  const suffix = params.join(';');
  p[2] = p[2].includes('__') ? `${p[2]};${suffix}` : `${p[2]}__${suffix}`;
  return p.join(':');
}

(async () => {
  console.log('STEALTH ENGINE   : patchright (Chromium fork anti-detect open-source)');
  const proxyStr = PROXY_ARG ? applySticky(PROXY_ARG) : null;
  const p = proxyStr ? proxyStr.split(':') : null;
  const proxy = p ? { server: `http://${p[0]}:${p[1]}`, username: p[2], password: p.slice(3).join(':') } : undefined;
  // P1 — geo dari IP sticky yang SAMA dengan yang dipakai browser (lookup CONNECT).
  // Timezone + locale + koordinat mengikuti IP ("Based on IP" ala AdsPower), jadi
  // syarat tz==geo selalu terpenuhi — tidak ada koordinat vs jam yang bertentangan.
  const FALLBACK_GEO = { country: 'ID', timezone: 'Asia/Jakarta', city: 'Jakarta', latitude: -6.2088, longitude: 106.8456 };
  let geo = FALLBACK_GEO;
  if (!proxyStr) {
    console.log('GEO (dari IP sticky) : TANPA PROXY — trafik lewat IP publik mesin ini');
  } else {
    try {
      geo = (await stealth.resolveProxyGeo(proxyStr)) || FALLBACK_GEO;
    } catch (e) { /* pakai fallback Indonesia */ }
  }
  const isFallback = geo.city === FALLBACK_GEO.city && geo.latitude === FALLBACK_GEO.latitude;
  const geoOpt = stealth.geolocationOption(geo);
  // IP exit aktual (absolute-form HTTP lewat proxy) — tercatat utk arsip kelahiran.
  const exitIp = proxyStr ? await new Promise((resolve) => {
    const req = require('http').request({
      host: p[0], port: +p[1],      path: 'http://ip-api.com/json/?fields=query',
      headers: { 'Proxy-Authorization': 'Basic ' + Buffer.from(`${p[2]}:${p.slice(3).join(':')}`).toString('base64') },
      timeout: 8000
    }, (res) => { let b = ''; res.on('data', (c) => { b += c; }); res.on('end', () => { try { resolve((JSON.parse(b).query) || '?'); } catch (e) { resolve('?'); } }); });
    req.on('timeout', () => { req.destroy(); resolve('?'); });
    req.on('error', () => resolve('?'));
    req.end();
  }) : null;
  if (exitIp !== null) console.log(`GEO (dari IP sticky) : ${exitIp} | ${geo.city || '?'}, ${geo.country || '?'} | tz ${geo.timezone}${isFallback ? ' (FALLBACK — lookup gagal, cek gateway)' : ''}`);

  const ctxOpts = MOBILE
    ? {
        viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true,
        locale: stealth.localeForTz(geo.timezone), timezoneId: geo.timezone,
        userAgent: 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36'
      }
    : {
        // P2 — headed: TANPA override userAgent; UA natural binary patchright.
        locale: stealth.localeForTz(geo.timezone), timezoneId: geo.timezone
      };
  if (geoOpt) ctxOpts.geolocation = geoOpt; // permission tetap "ask" — tidak di-grant
  // Spoof fingerprint deterministik: seed dari profil/sid supaya sesi yang sama
  // selalu dapat cfg identik (konsistensi antar buka), sesi lain berbeda. Platform
  // WebGL mengikuti mode: android saat --mobile, desktop (win) saat headed normal.
  let spoofCfg = null;
  if (SPOOF) {
    spoofCfg = spoof.spoofConfigFor({
      id: 0,
      name: PROFILE_DIR || URL,
      email: SID || '',
      user_agent: MOBILE ? 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36' : '',
    });
  }
  ctxOpts.ignoreHTTPSErrors = true;
  // Enhanced session isolation - prevent cross-contamination
  const sessionId = SID || require('crypto').randomBytes(8).toString('hex');
  const sessionHash = require('crypto').createHash('sha256').update(sessionId).digest('hex').slice(0, 16);
  
  // Unique storage partition for each session
  ctxOpts.storageState = {
    cookies: [],
    origins: [],
    // Session-specific storage isolation
    extraHTTPHeaders: {
      'X-Session-ID': sessionHash,
      'X-Request-ID': require('crypto').randomBytes(4).toString('hex')
    }
  };
  
  // Enhanced security args
  const SECURITY_ARGS = [
    '--no-first-run', '--no-default-browser-check', '--no-sandbox', 
    '--disable-dev-shm-usage', '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
    '--disable-features=site-per-process', // Better isolation
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-back-forward-cache', // Prevent memory leaks
    '--aggressive-cache-discard',
    '--enable-features=NetworkService',
  ];
  
  // Args minimal — patchright menyarankan tanpa flag anti-deteksi buatan.
  // WebRTC policy = cegah leak IP asli (bukan flag anti-automation; paritas panel).
  const ARGS = SECURITY_ARGS;

  // Memory leak protection and cleanup
  const cleanupHandlers = [];
  
  // Auto-cleanup on exit
  process.on('SIGINT', async () => {
    console.log('\n🧹 Cleaning up browser sessions...');
    for (const cleanup of cleanupHandlers) {
      try { await cleanup(); } catch (e) {}
    }
    if (context) {
      try { 
        await context.close(); 
        console.log('Browser context closed gracefully');
      } catch (e) {}
    }
    process.exit(0);
  });
  
  // Periodic memory cleanup for long-running sessions
  if (TTL_NUM > 60) {
    const cleanupInterval = setInterval(async () => {
      try {
        const pages = context.pages();
        for (const page of pages) {
          if (page.url() === 'about:blank' || !page.url()) {
            await page.close();
          }
        }
        // Clear memory caches
        await context.evaluate(() => {
          if (window.gc) window.gc();
        }).catch(() => {});
      } catch (e) {}
    }, 30000); // Every 30 seconds
    
    cleanupHandlers.push(() => clearInterval(cleanupInterval));
  }
  if (PROFILE_DIR) {
    fs.mkdirSync(PROFILE_DIR, { recursive: true });
    console.log('PROFIL PERSISTEN :', PROFILE_DIR, '(cookie tersimpan otomatis di folder ini)');
    if (SID) console.log('STICKY SID       :', SID, TTL_NUM > 0 ? `(sessttl ${TTL_NUM}s)` : '(umur default provider)');
    try {
      context = await chromium.launchPersistentContext(PROFILE_DIR, { headless: false, proxy, args: ARGS, ...ctxOpts });
    } catch (e) {
      console.error('GAGAL buka profil persisten:', (e.message || '').split('\n')[0]);
      console.error('Kemungkinan folder profil sedang dipakai browser lain — tutup dulu, lalu ulangi.');
      process.exit(1);
    }
  } else {
    const browser = await chromium.launch({ headless: false, proxy, args: ARGS });
    context = await browser.newContext(ctxOpts);
  }

  // Init script WAJIB terpasang sebelum navigasi pertama. Catatan patchright:
  // addInitScript menyuntik via rute request HTML, jadi efeknya baru terlihat di
  // halaman yang diambil lewat jaringan (https/http), bukan di about:blank.
  if (spoofCfg) {
    await context.addInitScript(stealth.spoofInitScript(spoofCfg));
    console.log(`FINGERPRINT SPOOF : aktif (deterministik per ${PROFILE_DIR ? 'profil' : 'sid/url'})`);
    console.log(`                     cores ${spoofCfg.hardwareConcurrency} | mem ${spoofCfg.deviceMemory}GB | WebGL ${spoofCfg.webgl.vendor} / ${String(spoofCfg.webgl.renderer).slice(0, 60)}`);
    console.log(`                     canvasSeed ${spoofCfg.canvasSeed} | audioSeed ${spoofCfg.audioSeed} | rectSeed ${spoofCfg.rectSeed}`);
  }

  const page = await context.newPage();
  await page.goto(URL, { timeout: 60000, waitUntil: 'domcontentloaded' }).catch((e) => console.log('nav:', e.message.split('\n')[0]));
  // Verifikasi on-page: apa yang DILIHAT SITUS (bukan whoer eksternal).
  try {
    const view = await page.evaluate(() => ({
      ua: navigator.userAgent,
      tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
      lang: navigator.language,
      coords: !!(navigator.geolocation)
    }));
    console.log(`ON-PAGE VIEW       : UA ${view.ua}`);
    console.log(`                     tz ${view.tz} | lang ${view.lang} | geolocation API: ada`);
  } catch (e) { /* halaman mungkin belum siap — bukan fatal */ }
  if (argv.includes('--shot')) {
    await page.waitForTimeout(3000).catch(() => {});
    const shotPath = PROFILE_DIR ? path.join(PROFILE_DIR, 'startup.png') : 'logs/stealth-browser-startup.png';
    await page.screenshot({ path: shotPath, fullPage: false }).then(
      () => console.log('SCREENSHOT         :', shotPath),
      (e) => console.log('screenshot gagal:', e.message.split('\n')[0])
    );
  }
  console.log('BROWSER TERBUKA (patchright), KONTROL MANUAL. Ctrl+C untuk tutup.', PROFILE_DIR ? '(cookie diflush ke profil saat tutup)' : '');

  let closing = false;
  // Snapshot cookie berkala — X-close oleh user tidak lewat SIGINT, jadi simpan
  // rutin biar cookie gmail muda tetap tercata walau jendela ditutup manual.
  const cookieTimer = PROFILE_DIR ? setInterval(() => {
    if (closing) return;
    context.cookies().then((cookies) => {
      const out = path.join(PROFILE_DIR, 'manual-1.json');
      fs.writeFileSync(out, JSON.stringify({ proxy: proxyStr, engine: 'patchright', savedAt: new Date().toISOString(), cookies }, null, 2));
    }).catch(() => {});
  }, 60000) : null;
  async function shutdown() {
    if (closing) return;
    closing = true;
    if (PROFILE_DIR) {
      try {
        const cookies = await context.cookies();
        const out = path.join(PROFILE_DIR, 'manual-1.json');
        fs.writeFileSync(out, JSON.stringify({ proxy: proxyStr, engine: 'patchright', savedAt: new Date().toISOString(), cookies }, null, 2));
        console.log(`\n${cookies.length} cookie disimpan -> ${out}`);
      } catch (e) { /* browser sudah tertutup */ }
    }
    try { if (cookieTimer) clearInterval(cookieTimer); } catch (e) { /* abaikan */ }
    try { if (context) await context.close(); } catch (e) { /* abaikan */ }
    process.exit(0);
  }
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  // Tutup jendela via tombol X browser -> event 'close' -> proses node ikut mati.
  try { context.on('close', shutdown); } catch (e) { /* abaikan */ }
  await new Promise(() => {});
})();
