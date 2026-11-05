'use strict';
// Browser manual via proxy: PC bukakan, user yang kontrol penuh.
// Run: node src/proxy-browser.js [proxy] [url] [--mobile] [--profile <folder>] [--sid <id>] [--ttl <detik>]
//
// Opsi:
//   --profile <folder>  Profil persisten (launchPersistentContext): cookie/login TERSIMPAN
//                       di folder itu, jadi daftar manual sekali = akses berikutnya langsung
//                       masuk via cookie. Saran: pakai folder profil akun panel
//                       (sessions/<nama-akun>) supaya tombol "Buka" membuka profil & cookie yg sama.
//   --sid <id>          Sticky session DataImpulse — IP sama antar buka-tutup browser.
//                       Format resmi: username__sid.<id>;sessttl.<detik>. Kalau --profile
//                       diisi tapi --sid tidak, otomatis pakai nama folder profil sebagai sid.
//   --ttl <detik>       Opsional: umur sesi sticky DataImpulse (param sessttl).
//
// Contoh (daftar IG manual via DataImpulse, IP + cookie lengket ke satu akun):
//   node src/proxy-browser.js "gw.dataimpulse.com:823:KEY:SECRET" \
//     https://www.instagram.com/accounts/emailsignup/ --mobile --profile sessions/pocotre76
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

// ---- Parse argumen (posisi lama tetap didukung: [proxy] [url] [--mobile]) ----
const argv = process.argv.slice(2);
const FLAGS = ['--mobile'];
const OPTS = ['--profile', '--sid', '--ttl'];
const MOBILE = argv.includes('--mobile');

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

const PROXY_ARG = POSITIONAL[0] || 'p.shifter.io:443:customer-hawinvery35-country-id-region-eastjava-city-madiun-sid-ev789rj4-ttl-60:Yi0Z4hMoY';
const URL = POSITIONAL[1] || 'https://www.facebook.com/reg/';
const PROFILE_ARG = argVal('--profile');
const PROFILE_DIR = PROFILE_ARG ? path.resolve(PROFILE_ARG) : null;
const TTL_NUM = argVal('--ttl') ? parseInt(argVal('--ttl'), 10) : 0;
let SID = argVal('--sid') || (PROFILE_DIR ? path.basename(PROFILE_DIR) : null);
if (SID) SID = String(SID).replace(/[^a-zA-Z0-9_-]/g, '-') || null;

// Sticky session DataImpulse: param ditempel di username setelah "__", dipisah ";".
// Contoh resmi docs: LOGIN__sid.job01;sessttl.600  (password tidak berubah).
function applySticky(proxyStr) {
  const p = proxyStr.split(':');
  if (!SID || p.length < 3) return proxyStr;
  if (!p[0].includes('dataimpulse')) {
    console.log(`[sid] --sid diabaikan: hanya berlaku untuk gateway DataImpulse (ini ${p[0]}).`);
    return proxyStr;
  }
  const params = [`sid.${SID}`];
  if (TTL_NUM > 0) params.push(`sessttl.${TTL_NUM}`);
  const suffix = params.join(';');
  p[2] = p[2].includes('__') ? `${p[2]};${suffix}` : `${p[2]}__${suffix}`;
  return p.join(':');
}

(async () => {
  const proxyStr = applySticky(PROXY_ARG);
  const p = proxyStr.split(':');
  const proxy = { server: `http://${p[0]}:${p[1]}`, username: p[2], password: p.slice(3).join(':') };
  const ctxOpts = MOBILE
    ? {
        viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true,
        locale: 'id-ID', timezoneId: 'Asia/Jakarta',
        userAgent: 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36'
      }
    : { viewport: { width: 1366, height: 768 }, locale: 'id-ID', timezoneId: 'Asia/Jakarta' };
  ctxOpts.ignoreHTTPSErrors = true;
  const ARGS = [
    '--disable-blink-features=AutomationControlled', '--disable-dev-shm-usage', '--no-sandbox',
    '--no-first-run', '--no-default-browser-check',
  ];

  let context = null;
  if (PROFILE_DIR) {
    fs.mkdirSync(PROFILE_DIR, { recursive: true });
    console.log('PROFIL PERSISTEN :', PROFILE_DIR, '(cookie tersimpan otomatis di folder ini)');
    if (SID) console.log('STICKY SID       :', SID, TTL_NUM > 0 ? `(sessttl ${TTL_NUM}s)` : '(umur default provider)');
    try {
      context = await chromium.launchPersistentContext(PROFILE_DIR, { headless: false, proxy, args: ARGS, ...ctxOpts });
    } catch (e) {
      console.error('GAGAL buka profil persisten:', (e.message || '').split('\n')[0]);
      console.error('Kemungkinan folder profil sedang dipakai browser lain (aktivasi/tombol Buka) — tutup dulu, lalu ulangi.');
      process.exit(1);
    }
  } else {
    const browser = await chromium.launch({ headless: false, proxy, args: ARGS });
    context = await browser.newContext(ctxOpts);
  }

  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });
  const page = await context.newPage();
  await page.goto(URL, { timeout: 60000, waitUntil: 'domcontentloaded' }).catch((e) => console.log('nav:', e.message.split('\n')[0]));
  console.log('BROWSER TERBUKA, KONTROL MANUAL. Ctrl+C untuk tutup.', PROFILE_DIR ? '(cookie diflush ke profil saat tutup)' : '');

  let closing = false;
  async function shutdown() {
    if (closing) return;
    closing = true;
    // Best-effort: snapshot cookie ke manual-1.json — dibaca server saat tombol "Buka"
    // untuk suntik cookie bila profil akun berbeda. Sengaja TIDAK menimpa cookies.json
    // supaya session file relogin (dgn proxy IP lahir) tidak ketutup file polos.
    if (PROFILE_DIR) {
      try {
        const cookies = await context.cookies();
        const out = path.join(PROFILE_DIR, 'manual-1.json');
        fs.writeFileSync(out, JSON.stringify({ proxy: proxyStr, savedAt: new Date().toISOString(), cookies }, null, 2));
        console.log(`\n${cookies.length} cookie disimpan -> ${out}`);
      } catch (e) { /* browser sudah tertutup / cookie tak terbaca */ }
    }
    try { if (context) await context.close(); } catch (e) { /* abaikan */ }
    process.exit(0);
  }
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  await new Promise(() => {});
})();
