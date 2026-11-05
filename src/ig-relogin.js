'use strict';
/* Login ulang akun IG dari file session + verifikasi + update cookie session.
 * Strategi: semua navigasi via root IG + SPA (client-side) — hindari page.goto
 * ke URL IG lain yang sering ditolak via proxy (ERR_HTTP_RESPONSE_CODE_FAILURE).
 * Challenge kode konfirmasi email ditangani otomatis via inbox Ammail.
 * Run: node src/ig-relogin.js sessions/ig-<user>.json "<host:port:user:pass>"
 */
require('dotenv').config();
const { chromium } = require('patchright'); // engine panel: patchright (drop-in playwright)
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

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

function makeHttp(url, options) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request({
      hostname: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + u.search, method: options.method || 'GET', headers: options.headers || {}
    }, (res) => {
      let d = '';
      res.on('data', (c) => { d += c; });
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { resolve({ raw: d }); } });
    });
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

function extractCode(subject, text, htmlStripped) {
  const hay = [subject || '', text || '', htmlStripped || ''].join('\n');
  let m = /(?:confirmation|verification|security)\s*code[^0-9]{0,10}([0-9]{4,8})|\bcode\b[^0-9]{0,10}([0-9]{4,8})/i.exec(hay);
  if (m) return m[1] || m[2];
  m = /\b([0-9]{4,8})\s+is your \w+ (?:confir|verification)/i.exec(hay) || /^\s*([0-9]{4,8})\b/m.exec(subject || '');
  if (m) return m[1];
  m = /\b([0-9]{5,6})\b/.exec((subject || '') + '\n' + (text || ''));
  return m ? m[1] : '';
}

async function pollInboxCode(alias, maxMin = 5) {
  const baseUrl = (process.env.AMMAIL_BASE_URL || '').replace(/\/+$/, '');
  const apiKey = process.env.AMMAIL_API_KEY || '';
  for (let i = 0; i < maxMin * 12; i++) {
    await sleep(5000);
    try {
      const list = await makeHttp(`${baseUrl}/api/inboxes/${alias}/messages`, { method: 'GET', headers: { 'X-API-Key': apiKey } });
      for (const prev of (list.messages || [])) {
        if (!prev.id) continue;
        const full = await makeHttp(`${baseUrl}/api/messages/${prev.id}`, { method: 'GET', headers: { 'X-API-Key': apiKey } });
        const msg = full.message || {};
        const c = extractCode(msg.subject, msg.text, String(msg.html || '').replace(/<[^>]+>/g, ' '));
        if (c) return c;
      }
    } catch (e) { /* lanjut polling */ }
  }
  return '';
}

const pageText = (page) => page.evaluate(() => document.body ? document.body.innerText : '').catch(() => '');

(async () => {
  const args = process.argv.slice(2);
  const sessPath = args[0];
  const proxyStr = args[1];
  let profileDir = null;
  // --account <id>: nama file session aktivasi (login-activation.json) bukan nama
  // akun, jadi tanpa id kunci 2FA tak ketemu dan kode selalu diminta ke operator.
  let accountIdArg = null;
  for (let i = 2; i < args.length; i++) {
    if (args[i] === '--profile') { profileDir = args[i + 1] || null; i++; }
    else if (args[i] === '--account') { accountIdArg = Number(args[i + 1]) || null; i++; }
  }
  // --keep-open: browser dibiarkan terbuka setelah login terverifikasi — operator
  // lanjut memakai akun di jendela itu (panel tetap mencatat HASIL: LOGIN OK).
  const KEEP_OPEN = args.includes('--keep-open');
  if (!sessPath || !proxyStr) { console.error('Pemakaian: node src/ig-relogin.js sessions/ig-<user>.json "<host:port:user:pass>" [--profile <dir>]'); process.exit(1); }
  const sess = JSON.parse(fs.readFileSync(sessPath, 'utf8'));
  const alias = String(sess.email || '').split('@')[0];
  const nameArg = path.basename(sessPath).replace(/^ig-/, '').replace(/\.json$/, '');
  console.log('Login ulang:', String(sess.email || '').trim() || sess.username);

  const launchOpts = {
    headless: false,
    args: ['--disable-dev-shm-usage', '--no-sandbox'], // tanpa flag anti-automation: patchright melarang
    proxy: parseProxy(proxyStr) || undefined, // 'direct'/null = tanpa proxy (Playwright menolak null)
  };
  const MOBILE_RELOGIN = !args.includes('--desktop');
  // Paritas IG Create: ukur layar fisik dulu (context probe) — viewport ganu lebih
  // tinggi dari monitor membuat Chromium memotong jendela + menu bawah IG terpotong
  // (kasus run 12/10 di layar 1366x768).
  let vpW = 412, vpH = 1080;
  try {
    const probe = await chromium.launch({ headless: false, args: ['--no-sandbox'], proxy: parseProxy(proxyStr) || undefined });
    const ppage = await (await probe.newContext({ viewport: null })).newPage();
    await ppage.goto('about:blank', { timeout: 15000 }).catch(() => {});
    const scr = await ppage.evaluate(() => ({ w: screen.availWidth || 1280, h: screen.availHeight || 720 }));
    await probe.close().catch(() => {});
    vpH = Math.max(560, Math.min(1080, scr.h - 140));
    vpW = Math.max(320, Math.min(412, scr.w));
    console.log(`Layar asli ${scr.w}x${scr.h} → viewport aktivasi ${vpW}x${vpH}`);
  } catch (e) { console.log('ukur layar gagal — pakai viewport 412x1080:', e.message); }
  const UA_MOBILE = 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';
  const context = (profileDir && !MOBILE_RELOGIN)
    ? await chromium.launchPersistentContext(profileDir, launchOpts)
    : await (await chromium.launch(launchOpts)).newContext({
    viewport: { width: vpW, height: vpH }, isMobile: true, hasTouch: true, deviceScaleFactor: 2,
    locale: 'id-ID', timezoneId: 'Asia/Jakarta',
    userAgent: UA_MOBILE,
  });
  if (profileDir) console.log('Profil persisten:', profileDir, MOBILE_RELOGIN ? '(dimobilkan — cookies profil tetap, tampilan Pixel 7)' : '(desktop)');
  // Tanpa addInitScript webdriver — patchright menangani di level engine.

  // Catat exit IP ke ip_history (via proxy aktivasi, biar monitoring IP akun akurat).
  try {
    const sessName = path.basename(sessPath).replace(/^ig-/, '').replace(/\.json$/, '').replace(/-di$/, '');
    const { recordIpProbe } = require('./browser');
    recordIpProbe(context, { id: null, name: sessName, _probeSource: 'activation' })
      .then((rec) => {
        if (!rec || !rec.ip) return;
        const { addIpHistory, getAccountByName } = require('./db');
        return getAccountByName(sessName).then((acc) =>
          acc ? addIpHistory(acc.id, { ...rec, source: 'activation' }) : null);
      })
      .catch(() => {});
  } catch (e) { /* probe gagal = bukan fatal */ }

  if (Array.isArray(sess.cookies) && sess.cookies.length) await context.addCookies(sess.cookies).catch(() => {});
  const page = await context.newPage();

  let ok = false;
  try {
    // 1) Root IG (satu-satunya page.goto)
    await page.goto('https://www.instagram.com/', { timeout: 60000, waitUntil: 'domcontentloaded' });

    // 2) Tunggu form login hidrasi (lambat via proxy) — max 60 dtk
    let formReady = false, text = '';
    for (let w = 0; w < 24; w++) {
      await sleep(2500);
      text = await pageText(page);
      const pw = await page.locator('input[type="password"]').count().catch(() => 0);
      const logged = /beranda|stories|sarankan|reels/i.test(text) && !/log ?in|daftar/i.test(text.slice(0, 300));
      if (logged) { formReady = false; break; } // ternyata sudah login (cookie aktif)
      if (pw > 0) { formReady = true; break; }
    }
    console.log('Form login:', formReady ? 'terdeteksi' : 'tidak muncul (mungkin sudah login/blocked)');

    // 2a) Fallback: klik link "Log in" bila form belum hidrasi tapi linknya ada
    if (!formReady && /log ?in|masuk/i.test(text) && (await page.locator('input[type="password"]').count()) === 0) {
      const link = page.locator('a[href*="/accounts/login"], a:has-text("Log in"), a:has-text("Masuk")').first();
      if ((await link.count()) > 0) {
        await link.click().catch(() => {});
        console.log('Klik link Log in...');
        await sleep(rand(6000, 9000));
        for (let w = 0; w < 12; w++) {
          await sleep(2500);
          if ((await page.locator('input[type="password"]').count()) > 0) { formReady = true; break; }
        }
        console.log('Form login (fallback):', formReady ? 'terdeteksi' : 'tetap tidak muncul');
      }
    }

    // 3) Isi kredensial bila form ada
    if (formReady) {
      // Login SELALU pakai email bila ada — username panel sering bukan username IG asli.
      const loginId = String(sess.email || '').trim() || String(sess.username || '').trim();
      console.log('Login pakai identitas:', /@/.test(loginId) ? `${loginId} (email)` : loginId);
      const uin = page.locator('input:not([type="password"])').first();
      const pin = page.locator('input[type="password"]').first();
      for (let w = 0; w < 8; w++) { if (!(await uin.isDisabled().catch(() => true))) break; await sleep(2000); }
      await uin.click(); await sleep(rand(500, 900));
      await uin.fill(loginId); await sleep(rand(600, 1200));
      await pin.click(); await sleep(rand(400, 800));
      await pin.fill(sess.password); await sleep(rand(600, 1200));
      const btn = page.getByRole('button', { name: /log ?in|masuk/i }).first();
      if ((await btn.count()) > 0 && !(await btn.isDisabled().catch(() => true))) await btn.click().catch(() => {});
      else { await pin.press('Enter').catch(() => {}); }
      console.log('Kredensial dikirim, menunggu respons...');
      // Poll max 30 dtk: sessionid muncul ATAU pesan error sandi (jangan match label kolom!)
      let loginSettled = '';
      for (let w = 0; w < 10; w++) {
        await sleep(3000);
        const cs = await context.cookies();
        if (cs.some((c) => c.name === 'sessionid')) { loginSettled = 'sessionid-ada'; break; }
        const tt = await pageText(page);
        const errM = /kata sandi (anda )?(adalah )?salah[^"]{0,80}|sandi salah[^"]{0,80}|password (was )?incorrect[^"]{0,80}|tidak cocok[^"]{0,60}/i.exec(tt);
        if (errM) { loginSettled = 'password-salah: ' + errM[0].slice(0, 90); break; }
      }
      console.log('Status setelah submit:', loginSettled || 'belum jelas (tanpa pesan error)');
      await page.screenshot({ path: 'ig-relogin-after-submit.png' }).catch(() => {});
      await sleep(rand(4000, 8000));
      text = await pageText(page);
    }

    // 3b) Challenge TOTP 2FA — kunci tersimpan di tabel accounts (totp_secret_enc).
    // Bot menghitung kode langsung (panel jadi Google Authenticator-nya); tanpa kunci,
    // minta operator ketik di kartu OTP via stdin. Deteksi teks/URL challenge.
    if (/autentikasi dua faktor|two.?factor|kode autentikasi|authentication code|aplikasi autentikasi/i.test(text) || /\/two-factor\//i.test(page.url())) {
      console.log('Challenge 2FA terdeteksi.');
      let tfCode = null;
      try {
        const db = require('./db');
        await db.waitReady();
        // Cari akun lewat id panel, lalu nama file, lalu username session.
        let acct = accountIdArg ? await db.getAccountById(accountIdArg) : null;
        if (!acct) acct = await db.getAccountByName(nameArg);
        if (!acct && sess.username) acct = await db.getAccountByName(String(sess.username));
        if (acct && acct.id) {
          const tc = await db.accountTotpCode(acct.id);
          if (tc.code) tfCode = tc.code; // kunci tersimpan — kode dihitung bot
          else console.log('Kunci 2FA tidak terbaca: ' + (tc.error || 'tanpa_totp'));
        }
      } catch (e) { console.log('Baca kunci 2FA gagal: ' + e.message); }
      if (tfCode) console.log('Kode 2FA dari kunci tersimpan: ' + tfCode);
      else {
        console.log('[OTP_REQUIRED] 2FA tanpa kunci tersimpan — ketik kode authenticator di panel. Menunggu max 8 menit.');
        console.log('[OTP_REQUIRED] Jika tidak punya kunci, ambil kodenya dari Google Authenticator HP-mu.');
        // Kartu OTP via stdin (paritas fb-account-creator / wizard IG): baris berisi
        // 6 digit diterima sebagai kode.
        tfCode = await new Promise((resolve) => {
          let buf = '';
          const timer = setTimeout(() => { process.stdin.off('data', onData); console.log('Operator tidak mengisi kode dalam 8 menit.'); resolve(null); }, 8 * 60 * 1000);
          const onData = (d) => {
            buf += String(d); let nl;
            while ((nl = buf.indexOf('\n')) !== -1) {
              const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
              const m = line.match(/\b(\d{6})\b/);
              if (m) { clearTimeout(timer); process.stdin.off('data', onData); console.log('[OTP_GOT] diterima dari panel.'); resolve(m[1]); return; }
            }
          };
          if (process.stdin.setEncoding) process.stdin.setEncoding('utf8');
          process.stdin.on('data', onData);
        });
      }
      if (!tfCode) throw new Error('kode_2fa_tidak_dapat');
      const cin = page.locator('input').first();
      await cin.click(); await sleep(500);
      await cin.fill(tfCode); await sleep(rand(1000, 2000));
      const nb = page.getByRole('button', { name: /next|berikutnya|confirm|lanjut|verifikasi/i }).first();
      await nb.click().catch(() => {});
      await sleep(rand(8000, 12000));
      text = await pageText(page);
    }

    // 4) Challenge kode konfirmasi — auto dari inbox. Deteksi via teks ATAU URL
    //    (/challenge/, /checkpoint/) karena kadang teks belum terbaca saat transisi.
    if (/kode konfirmasi|confirmation code|security code|masukkan kode|enter the code|cek.*(email|inbox)|check.*(email|inbox)/i.test(text) || /\/challenge\/|\/checkpoint\//i.test(page.url())) {
      console.log('Challenge kode konfirmasi terdeteksi — polling inbox...');
      const code = await pollInboxCode(alias, 5);
      if (!code) throw new Error('kode_challenge_tidak_dapat');
      console.log('Kode:', code);
      const cin = page.locator('input').first();
      await cin.click(); await sleep(500);
      await cin.fill(code); await sleep(rand(1000, 2000));
      const nb = page.getByRole('button', { name: /next|berikutnya|confirm|lanjut/i }).first();
      await nb.click().catch(() => {});
      await sleep(rand(8000, 12000));
    }

    // 5) Tutup dialog onboarding/notifikasi bila ada
    for (const name of [/not now/i, /nanti/i, /lewati/i, /^save$/i, /^simpan$/i, /allow/i, /izinkan/i]) {
      const b = page.getByRole('button', { name }).first();
      if ((await b.count()) > 0) { await b.click().catch(() => {}); await sleep(1500); }
    }

    // 6) Cek cookie login
    let cookies = await context.cookies();
    const hasSession = cookies.some((c) => c.name === 'sessionid');
    console.log('sessionid:', hasSession ? 'ADA \u2705' : 'belum ada');

    // 7) Verifikasi beranda — HANYA bila sessionid belum ada (hemat request, hindari 429)
    let homeOk = false;
    if (hasSession) {
      homeOk = true; // cookie login = bukti cukup, tidak perlu reload root
      console.log('Beranda: dilewati (sessionid sudah cukup sebagai bukti login)');
    } else {
      try { await page.reload({ timeout: 60000, waitUntil: 'domcontentloaded' }); } catch (e) { /* lanjut */ }
      await sleep(rand(6000, 9000));
      const homeText = await pageText(page);
      homeOk = /home|beranda|stories|sarankan|reels|cari|ikon/i.test(homeText) && !/log ?in|daftar sekarang/i.test(homeText.slice(0, 300));
      console.log('Beranda:', homeOk ? 'KEBUKA \u2705' : 'ragu: ' + homeText.slice(0, 100).replace(/\n+/g, ' | '));
      await page.screenshot({ path: 'ig-relogin-home.png' }).catch(() => {});
    }

    // 7b) Handle IG asli — nama akun panel sering bukan username IG ("akun hp"),
    // jadi cek profil dengan nama panel selalu gagal walau login sukses.
    let igHandle = String(sess.ig_username || '').trim();
    if (hasSession && !igHandle) {
      igHandle = await page.evaluate(async () => {
        try {
          const r = await fetch('/api/v1/accounts/current_user/?edit=true', { credentials: 'include', headers: { 'X-IG-App-ID': '936619743392459' } });
          if (r.ok) { const j = await r.json(); if (j && j.user && j.user.username) return j.user.username; }
        } catch (e) { /* jatuh ke DOM */ }
        const skip = ['explore', 'reels', 'direct', 'accounts', 'about', 'legal', 'privacy', 'developer', 'api', 'web'];
        const found = [...document.querySelectorAll('a[href]')]
          .map((a) => (/^\/([A-Za-z0-9._]{2,30})\/$/.exec(a.getAttribute('href') || '') || [])[1])
          .filter((u) => u && !skip.includes(u));
        return found[0] || '';
      }).catch(() => '');
      if (igHandle) { sess.ig_username = igHandle; console.log('Handle IG terbaca: @' + igHandle); }
    }
    const profUser = igHandle || String(sess.username || '').trim();

    // 8) Verifikasi profil via fetch same-origin (bukan page.goto — hindari ERR code)
    //    429 = rate-limit: tunggu 30 dtk lalu coba 1x lagi
    let profOk = false;
    const profFetch = async () => page.evaluate(async (u) => {
      try {
        const res = await fetch('/' + u + '/', { credentials: 'include' });
        const t = await res.text();
        return { status: res.status, has: t.includes(u) };
      } catch (e) { return { status: 0, has: false, err: String(e).slice(0, 80) }; }
    }, profUser);
    const profPass = (r) => r.status === 200 && (r.has || !igHandle);
    try {
      let r = await profFetch();
      if (r.status === 429) {
        console.log('Profil: 429 rate-limit, tunggu 30 dtk lalu coba lagi...');
        await sleep(30000);
        r = await profFetch();
      }
      if (!profPass(r)) {
        // Retry sekali setelah 15 dtk — kadang IG lambat propagasi session via proxy.
        console.log('Profil belum kebuka (HTTP ' + r.status + '), tunggu 15 dtk, coba 1x lagi...');
        await sleep(15000);
        r = await profFetch();
      }
      profOk = profPass(r);
      console.log(`Profil (${profUser}): HTTP ${r.status} ${r.has ? '+ username ditemukan' : ''} ${profOk ? '\u2705' : ''}${igHandle ? '' : ' (nama panel bukan handle — HTTP 200 cukup)'}`);
    } catch (e) {
      console.log('Profil: cek fetch gagal —', e.message.split('\n')[0]);
    }
    await page.screenshot({ path: 'ig-relogin-profile.png' }).catch(() => {});

    ok = hasSession && homeOk && profOk;
    if (hasSession) {
      cookies = await context.cookies();
      sess.cookies = cookies;
      sess.relogin_at = new Date().toISOString();
      fs.writeFileSync(path.resolve(sessPath), JSON.stringify(sess, null, 2));
      console.log('Session file diupdate:', sessPath);
      // Sinkron ke kanon: tombol Buka membaca sessions/<nama>/cookies.json — tanpa
      // ditulis di sini, Buka membuka browser dengan cookies STALE (masih draft lama).
      try {
        const canonDir = path.join(__dirname, '..', 'sessions', String(sess.username || '').trim());
        const canonPath = path.join(canonDir, 'cookies.json');
        const old = fs.existsSync(canonPath) ? JSON.parse(fs.readFileSync(canonPath, 'utf8')) : {};
        fs.mkdirSync(canonDir, { recursive: true });
        fs.writeFileSync(canonPath, JSON.stringify({
          ...old,
          platform: 'instagram', username: sess.username, email: sess.email,
          password: sess.password || old.password, proxy: sess.proxy || old.proxy,
          cookies, relogin_at: sess.relogin_at, updated_from: 'ig-relogin',
        }, null, 2));
        console.log('Cookie kanonis diupdate:', canonPath, '(' + cookies.length + ' cookies)');
      } catch (e) { console.log('Sinkron kanon gagal (non-fatal):', e.message.slice(0, 80)); }
    }
  } catch (e) {
    console.log('GAGAL:', e.message.split('\n')[0]);
    await page.screenshot({ path: 'ig-relogin-fail.png' }).catch(() => {});
  } finally {
    // --keep-open: JANGAN tutup browser (login jadi; operator lanjut di sana).
    // Cookies relogin & sinkron kanon SUDAH selesai di langkah di atas — proses
    // tetap memegang context sampai Ctrl+C, panel sudah menandai selesai.
    if (!(KEEP_OPEN && ok)) {
      await (profileDir ? context.close() : context.browser().close()).catch(() => {});
    }
  }
  console.log(ok ? '\nHASIL: LOGIN OK \u2705' : '\nHASIL: belum terverifikasi penuh');
  if (KEEP_OPEN && ok) {
    // Penanda proses pemegang browser: panel memakai PID ini untuk menutup jendela
    // aktivasi, bukan menebak proses lain.
    const pidFile = profileDir ? path.join(profileDir, 'keep-open.pid') : null;
    const dropPid = () => { try { if (pidFile) fs.unlinkSync(pidFile); } catch (e) { /* sudah hilang */ } };
    try { if (pidFile) fs.writeFileSync(pidFile, String(process.pid)); } catch (e) { /* non-fatal */ }
    const quit = async () => {
      dropPid();
      const b = context.browser();
      await (b ? b.close() : context.close()).catch(() => {});
      process.exit(0);
    };
    console.log('\n*** BROWSER DIBIARKAN TERBUKA — lanjut pakai akun di sana. Tutup lewat panel atau Ctrl+C. ***');
    process.on('SIGINT', quit);
    process.on('SIGTERM', quit);
    process.on('exit', dropPid);
    await new Promise(() => {}); // nggantung sampai panel/Ctrl+C menutup
  }
  process.exit(ok ? 0 : 1);
})();
