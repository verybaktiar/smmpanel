'use strict';

/**
 * Login otomatis TikTok untuk 1 akun lalu simpan session cookies (kanonik + tt-<alias>.json).
 * Run: node src/tiktok-login.js <email> <password> [proxy] [--keep-open]
 *      --profile <dir>      : bila diisi, browser jalan persistent-context dgn profil itu
 *                             (cookies yang sudah ada ikut dipakai — login biasanya instan)
 *      --keep-open          : browser dibiarkan terbuka setelah login sukses
 * Keluar: print "HASIL: LOGIN OK" / "HASIL: LOGIN GAGAL" (create-runner membaca lebih detail via file cookies).
 */
require('dotenv').config();
const { chromium } = require('patchright');
const path = require('path');
const fs = require('fs');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

function parseProxy(str) {
  if (!str || str === 'direct') return undefined;
  const p = String(str).trim().split(':');
  const proxy = { server: `http://${p[0]}:${p[1]}` };
  if (p[2]) { proxy.username = p[2]; proxy.password = p.slice(3).join(':'); }
  return proxy;
}

/** Coba login via cookie session yang sudah ada (profil persisten) — cek ke tiktok.com/prefetch atau /foryou */
async function hasActiveSession(context) {
  try {
    const cookies = await context.cookies('https://www.tiktok.com');
    if (!cookies.some((c) => /^sessionid(_ss)?/.test(c.name))) return false;
    const page = await context.newPage();
    await page.goto('https://www.tiktok.com/foryou', { timeout: 45000, waitUntil: 'domcontentloaded' }).catch(() => null);
    for (let i = 0; i < 10; i++) {
      await sleep(2500);
      const t = (await page.evaluate(() => document.body ? document.body.innerText : '').catch(() => '')) || '';
      if (/foryou|following/i.test(page.url()) && !/log ?in|daftar|sign ?up/i.test(t.slice(0, 400))) return true;
    }
    return false;
  } catch (e) { return false; }
}

(async () => {
  const args = process.argv.slice(2);
  const KEEP_OPEN = args.includes('--keep-open');
  const PROF = args.includes('--profile') ? args[args.indexOf('--profile') + 1] : null;
  // Hapus nilai --profile <val> dari sisa arg supaya tidak salah baca sbg email/password.
  const profIdx = args.indexOf('--profile');
  const profVal = profIdx !== -1 ? args[profIdx + 1] : null;
  const rest = args.filter((a, i) => a !== '--keep-open' && a !== '--profile' && i !== profIdx + 1);
  const [email, password, proxyStr] = rest.filter(Boolean);
  if (!email || !password) { console.error('Pemakaian: node src/tiktok-login.js <email> <pass> [proxy] [--profile <dir>] [--keep-open]'); process.exit(1); }

  const stealth = require('./stealth');
  const UA = stealth.alignUaVersion('Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36', process.env.TT_UA_VERSION || '131.0.0.0');

  let browser = null;
  const launchOpts = { headless: false, args: stealth.launchArgs(), proxy: parseProxy(proxyStr) };
  // Profil persisten punya launch sendiri — jangan buka browser kosong kedua.
  if (!PROF) {
    try { browser = await chromium.launch({ ...launchOpts, channel: 'chrome' }); console.log('Chrome asli dipakai'); }
    catch (e) { browser = await chromium.launch(launchOpts); console.log('Chromium fallback'); }
  }

  let context = null;
  let ok = false;
  try {
    if (PROF) fs.mkdirSync(PROF, { recursive: true });
    context = PROF
      ? await chromium.launchPersistentContext(PROF, { ...launchOpts, viewport: { width: 412, height: 896 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, locale: 'id-ID', timezoneId: 'Asia/Jakarta', userAgent: UA })
      : await (await browser.newContext({ viewport: { width: 412, height: 896 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, locale: 'id-ID', timezoneId: 'Asia/Jakarta', userAgent: UA }));
    const FP = { userAgent: UA, languages: ['id-ID', 'id', 'en-US', 'en'] };
    context.on('page', (pg) => stealth.attachPageHardening(context, pg, FP, { langOnly: true }).catch(() => {}));
    // Paritas openAccountBrowser (browser.js): konfig spoof akun di accounts.fingerprint_json untuk attack surface identik dgn Buka.
    try {
      const db = require('./db');
      await db.waitReady();
      const rows = await db.rawAll('SELECT id, fingerprint_json FROM accounts WHERE email = ?', [email]);
      if (rows[0] && rows[0].fingerprint_json) {
        await context.addInitScript(stealth.spoofInitScript(JSON.parse(rows[0].fingerprint_json)));
        console.log('Spoof fingerprint akun diterapkan (dari fingerprint_json)');
      } else if (rows[0]) {
        const cfg = await require('./stealth').ensureSpoofConfig({ id: rows[0].id, name: (email || '').split('@')[0], email, fingerprint_json: null });
        await context.addInitScript(stealth.spoofInitScript(cfg));
        console.log('Spoof fingerprint baru dibuat + disimpan');
      }
    } catch (e) { console.log('Spoof fingerprint dilewati:', e.message.slice(0, 80)); }

    const page = await context.newPage();
    // Track: langsung ke login page, bukan signup — supaya hash TikTok utk si mendaftar tidak dipakai.
    await page.goto('https://www.tiktok.com/login/phone-or-email/email', { timeout: 60000, waitUntil: 'domcontentloaded' });
    await sleep(rand(3000, 5000));

    // Sudah login di profil persistent? Cukup konfirmasi, no reauth needed.
    if (await hasActiveSession(context)) {
      ok = true;
      console.log('Session profil masih aktif — login tanpa isi form ulang.');
    } else {
      for (const name of [/decline/i, /reject/i, /tolak/i, /nanti saja/i, /not now/i]) {
        const b = page.getByRole('button', { name }).first();
        if ((await b.count()) > 0) { await b.click().catch(() => {}); await sleep(1500); break; }
      }

      // isi email & password seperti manusia
      const emailBox = page.locator('input[name="username"], input[type="email"], input[placeholder*="email" i]').first();
      const passBox = page.locator('input[type="password"]').first();
      await emailBox.waitFor({ state: 'visible', timeout: 20000 });
      await emailBox.click(); await sleep(rand(400, 900));
      await emailBox.type(email, { delay: rand(60, 160) });
      await sleep(rand(500, 1100));
      await passBox.click(); await sleep(rand(300, 700));
      await passBox.type(password, { delay: rand(60, 160) });
      console.log('Kredensial terisi, klik Masuk...');
      // Tombol "Log in"/"Masuk" versi div-role-button di UI TikTok mobile kadang menyatu dgn form action,
      // jadi fokus + Enter dulu, klik tombol actual bila ada (paritas actions.js)
      const submit = page.locator('button[type="submit"], button[data-e2e="login-button"], form button').first();
      if ((await submit.count()) > 0) { await submit.click().catch(() => {}); }
      else { await passBox.press('Enter').catch(() => {}); }

      // Poll max 40 detik: sessionid muncul ATAU pesan error terlihat
      let settled = '';
      for (let i = 0; i < 20; i++) {
        await sleep(2000);
        const cs = await context.cookies('https://www.tiktok.com');
        if (cs.some((c) => /^sessionid(_ss)?/.test(c.name))) { settled = 'sessionid-ada'; break; }
        const t = (await page.evaluate(() => document.body ? document.body.innerText : '').catch(() => '')) || '';
        const errM = /password.*incorrect|kata sandi.*salah|tidak cocok|max.*attempts|terlalu.*percobaan|disabled|dinonaktifkan|suspend/i.exec(t);
        if (errM) { settled = 'tiktok-menolak: ' + errM[0].slice(0, 90); break; }
      }
      console.log('Status submit:', settled || 'belum jelas');
      if (!settled || !/sessionid-ada/.test(settled)) {
        await page.screenshot({ path: `tt-login-fail.png` }).catch(() => {});
        throw new Error(settled || 'TikTok tak merespons 40 detik (captcha manual/periksa tt-login-fail.png)');
      }
      ok = true;
    }

    if (ok) {
      const cookies = await context.cookies('https://www.tiktok.com');
      const sessionDir = path.join(__dirname, '..', 'sessions');
      fs.mkdirSync(sessionDir, { recursive: true });
      const alias = String(email || '').split('@')[0];
      const sessPath = path.join(sessionDir, `tt-${alias}.json`);
      const existing = fs.existsSync(sessPath) ? JSON.parse(fs.readFileSync(sessPath, 'utf8')) : {};
      fs.writeFileSync(sessPath, JSON.stringify({
        ...existing, platform: 'tiktok', email, password,
        cookies, created_at: existing.created_at || new Date().toISOString(),
        login_at: new Date().toISOString(), proxy: proxyStr || existing.proxy || null,
      }, null, 2));
      console.log('Session cookies disimpan:', sessPath, `(${cookies.length} cookies)`);
      // kanonik sessions/<nama>/cookies.json — paritas sinkronisasi kanonik dari ig-relogin.js.
      // Ini dipakai tombol Buka (server.js /api/accounts/:id/open) utk awetkan login saat membuka browser.
      try {
        const db = require('./db');
        await db.waitReady();
        const rows = await db.rawAll('SELECT id, name FROM accounts WHERE email = ?', [email]);
        const accName = (rows[0] && rows[0].name) || alias;
        const canonDir = path.join(sessionDir, accName);
        fs.mkdirSync(canonDir, { recursive: true });
        fs.writeFileSync(path.join(canonDir, 'cookies.json'), JSON.stringify({
          platform: 'tiktok', username: accName, email, password, proxy: proxyStr || existing.proxy || null,
          cookies, login_at: new Date().toISOString(), updated_from: 'tiktok-login',
        }, null, 2));
      } catch (e) { console.log('Sinkron kanon gagal (non-fatal):', e.message.slice(0, 80)); }
    }
  } catch (e) {
    console.log('GAGAL:', e.message.split('\n')[0]);
  } finally {
    if (!(KEEP_OPEN && ok)) {
      // Persistent context menutup browser-nya sendiri; standalone context butuh browser.close() ikut.
      if (context) await context.close().catch(() => {});
      else if (browser) await browser.close().catch(() => {});
    }
  }
  console.log(ok ? '\nHASIL: LOGIN OK \u2705' : '\nHASIL: LOGIN GAGAL \u274c');
  if (KEEP_OPEN && ok) {
    console.log('\n*** BROWSER DIBIARKAN TERBUKA — lanjut pakai akun di sana. Ctrl+C utk tutup. ***');
    process.on('SIGINT', async () => {
      if (context) await context.close().catch(() => {});
      else if (browser) await browser.close().catch(() => {});
      process.exit(0);
    });
    await new Promise(() => {});
  }
  process.exit(ok ? 0 : 1);
})();
