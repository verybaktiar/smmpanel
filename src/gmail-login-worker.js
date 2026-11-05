'use strict';
// Worker login Gmail (dipanggil gmail-login.js): email + password → Google.
// Anti-detect mengikuti jalur panel: patchright + spoof config deterministik per
// akun + proxy sticky. TIDAK menambah patch manual di luar fingerprint-spoof
// (aturan patchright: patch buatan melemahkan patch internalnya).
//
// Argumen: <id> <email> <password> [--mode headed|headless] [--proxy host:port:user:pass]
// Keluar: exit 0 bila login sukses (status 'ok'), exit 3 bila hasil non-sukses
// yang "wajar" (2fa_prompt/checkpoint/bad_password/wait_hp dsb), exit 1 bila
// error teknis. Status selalu ditulis ke DB via db.setGmailLoginStatus.
//
// ARSITEKTUR STATE MACHINE (pengganti if-else bertingkat):
// loop tunggal → classify() memutus SATU state per giliran → dispatcher
// mendelegasikan ke pemilik state:
//   auto    → worker beraksi sendiri (isi email/password, klik pemilih sekali,
//             fallback URL identifier bila pemilih tidak berpindah)
//   operator→ browser dibuka, worker menunggu (captcha manual, ketuk angka HP)
//   terminal→ status final dilaporkan (rejected/verify_block/signed_out/
//             bad_password/2fa_prompt)
// Tidak ada lagi klik berulang tanpa baca hasil: keadaan pembaca ulang TIAP
// giliran, jadi klik yang tak berpindah terdeteksi sebagai state lain.

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { chromium } = require('patchright');
const stealth = require('./stealth');
const spoof = require('./fingerprint-spoof');
const db = require('./db');
// Helper proxy sticky dibagi dengan gmail-open (sesi tersimpan).
const { stickyProxy, proxyParts } = require('./gmail-proxy');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ROOT = path.join(__dirname, '..');

// Tahapan progres untuk panel: baris [stage] diparse gmail-login.js jadi job.stage
// sehingga operator melihat langkah yang sedang berjalan, bukan tombol diam.
const stage = (label) => console.log(`[stage] ${label}`);

function parseArgs(argv) {
  const out = { mode: 'headed', proxy: null, noProxy: false, waitManual: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--mode') out.mode = argv[++i] || out.mode;
    else if (argv[i] === '--headed') out.mode = 'headed';
    else if (argv[i] === '--headless') out.mode = 'headless';
    else if (argv[i] === '--proxy') out.proxy = argv[++i] || null;
    else if (argv[i] === '--no-proxy') out.noProxy = true;
    else if (argv[i] === '--wait-manual') out.waitManual = true;
  }
  return out;
}

// Batas tunggu operator menyelesaikan captcha manual (10 menit, pola creator
// IG/TikTok/FB yang sudah teruji di panel ini).
const MANUAL_MAX_MS = 10 * 60 * 1000;

// Captcha Google saat login: (a) halaman "Confirm you're not a robot" dengan
// tombol Next/checkbox reCAPTCHA, (b) widget reCAPTCHA TERLIHAT (challenge
// puzzle/gambar). Pelajaran uji nyata #14: Google menyisipkan iframe reCAPTCHA
// TERSEMBUNYI (risk scoring) di SEMUA halaman sign-in — iframe sendirian BUKAN
// captcha; tanpa cek terlihat, tunggu captcha tak pernah selesai padahal form
// password sudah tampil (false positive 10 menit).
const S_CAPTCHA_TEXT = /confirm.*not.*robot|bukan robot|unusual traffic|lalu lintas tidak biasa|prove you.re not|this point as well as you can|coba lagi nanti|tekan tombol berikutnya.*(robot|manusia)|bantu kita|pilih.*gambar.*(cocok|sama)/i;
function isCaptchaPage(page) {
  return (async () => {
    try {
      const body = await page.evaluate(() => (document.body ? document.body.innerText : ''));
      if (body && S_CAPTCHA_TEXT.test(body)) return true;
      // Iframe reCAPTCHA hanya dihitung bila TERLIHAT: challenge asli tampil
      // menempel di halaman (checkbox/puzzle). Iframe tersembunyi ukuran 0
      // (anchor bawah, visibility hidden) adalah risk-scoring bawaan — abaikan.
      const rw = await page.locator(
        'iframe[src*="recaptcha"]:visible, iframe[title*="reCAPTCHA"]:visible, '
        + 'div[data-sitekey]:visible, span[id*="recaptcha"]:visible, '
        + '.g-recaptcha:visible, #captcha:visible, [id*="captcha"]:visible, [name*="captcha"]:visible',
      ).count().catch(() => 0);
      return rw > 0;
    } catch (e) { return false; }
  })();
}

// Tunggu captcha terjawab. Sinyal utama: URL KELUAR dari halaman challenge
// saat masuk (Google selalu navigasi begitu captcha lolos — menuju
// /challenge/pwd, sukses, atau challenge lain dengan TL berbeda). Uji #14
// run-2 memperlihatkan deteksi teks/iframe yang tak andal di halaman
// /v3/signin/challenge/recaptcha: operator selesai tapi URL tak dibaca.
// Deteksi dengan pembedah URL deterministik. Max 10 menit. Screenshot tiap
// 20 dtk supaya kondisi browser bisa dianalisis belakangan, bukan ditebak.
async function waitCaptchaSolved(page) {
  const started = Date.now();
  let announcedProgress = -1;
  let lastShot = 0;
  const entryPath = (() => { try { return new URL(page.url()).pathname + '?' + (new URL(page.url()).search || ''); } catch (e) { return page.url(); } })();
  const urlNow = () => { try { const u = new URL(page.url()); return u.pathname + '?' + (u.search || ''); } catch (e) { return page.url(); } };
  while (Date.now() - started < MANUAL_MAX_MS) {
    await sleep(4000);
    if (S_SUCCESS_URL.test(page.url())) return true;
    // URL berpindah dari challenge captcha = lolos (pwd/sukses/challenge lain).
    if (urlNow() !== entryPath) return true;
    if (await page.locator('input[type="password"]').first().isVisible().catch(() => false)) return true;
    const stillCaptcha = await isCaptchaPage(page);
    if (!stillCaptcha) return true;
    const mins = Math.floor((Date.now() - started) / 60000);
    if (mins !== announcedProgress && mins > 0) {
      announcedProgress = mins;
      stage(`Operator masih menyelesaikan captcha manual (${mins} menit berlalu)`);
    }
    if (Date.now() - lastShot > 20000) {
      lastShot = Date.now();
      await page.screenshot({ path: path.join(ROOT, 'sessions', 'captcha-wait-live.png'), fullPage: false }).catch(() => {});
    }
  }
  return false; // timeout
}

// Satu titik penanganan captcha: selesaikan manual di browser (worker tidak
// menutup jendela), lalu loop kembali ke classify. Status 'captcha_timeout'
// bila 10 menit lewat tanpa solve.
async function handleCaptcha(page) {
  stage('Captcha terdeteksi - selesaikan manual di browser');
  console.log('[gmail-login] CAPTCHA: selesaikan manual di browser (klik checkbox/puzzles). Worker menunggu max 10 menit; browser TIDAK ditutup.');
  const solved = await waitCaptchaSolved(page);
  if (!solved) {
    console.log('[gmail-login] captcha tidak selesai dalam 10 menit.');
    return 'captcha_timeout';
  }
  console.log('[gmail-login] captcha lolos - lanjut otomatis.');
  return null;
}

// Textarea/input aktif pertama yang cocok, dengan teks terlihat sebagai fallback.
async function typeInto(page, selector, value) {
  const el = page.locator(selector).first();
  await el.waitFor({ state: 'visible', timeout: 20000 });
  await el.click();
  await page.keyboard.type(value, { delay: 40 + Math.floor(Math.random() * 60) });
}

const EMAIL_SEL = 'input#identifierId, input[name="identifier"], input[type="email"]';
// URL yang menandakan usai: sudah keluar dari challenge login.
const S_SUCCESS_URL = /myaccount\.google\.com|my\.google\.com|accounts\.google\.com\/b\/\d+/;

// Teks pembedah state (digali dari uji nyata di panel ini; lihat riwayat).
const T_REJECT = /tidak dapat memproses login|This browser or app may not be secure|Couldn.t sign you in/i;
const T_VERIFY = /tidak dapat memverifikasi|can.t verify|verifikasi diri|confirm it.s you|Verify it|confirm it.s you/i;
const T_BADPW = /password.*salah|Wrong password|password.*incorrect/i;
const T_CHOOSER = /pilih akun|Choose an account|Gunakan akun lain|Use another account/i;
const T_SIGNEDOUT = /Signed out|log ?out|keluar dari akun/i;
const T_DEVPROMPT = /ketuk|tap|tekan|sentuh|tampilkan di layar HP|check.{0,20}phone|pilih.{0,20}angka/i;

// Google kadang minta konfirmasi lewat HP: "ketuk [N] di HP Anda" (device
// prompt). Nomornya ekstrak dari teks halaman supaya operator bisa langsung
// mengetuk angka yang sama di HP — tanpa ini operator harus buka jendela browser.
async function detectConfirmNumber(page) {
  try {
    const body = await page.evaluate(() => (document.body ? document.body.innerText : ''));
    const m = body.match(/(?:ketuk|tap|tekan|sentuh)\s*(?:\u201c|\u201d|"|'|&#39;)?\s*([0-9]{1,3})\s*(?:\u201c|\u201d|")?/i)
      || body.match(/(?:number|angka)\s*([0-9]{1,3})\s*(?:on|di|pada)/i);
    if (m) return m[1];
    // Varian tampilan angka besar tunggal di tengah halaman device prompt.
    const big = body.match(/\b([1-9]|1[0-2])\b/);
    return /tampilkan di layar HP|check.{0,20}phone|pilih.{0,20}angka/i.test(body) && big ? big[1] : null;
  } catch (e) { return null; }
}

// BATAS tunggu ketukan di HP (operator kadang lambat ambil HP).
const CONFIRM_MAX_MS = 15 * 60 * 1000;

// Halaman device prompt: JANGAN tutup browser. Tunggu operator mengetuk angka
// di HP-nya — Google lanjut sendiri setelah ketukan, lalu kita pembaca URL.
// Nomor boleh berganti (Google bisa rotasi), jadi tiap perubahan diumumkan.
async function waitConfirmDone(page, initialNumber) {
  const started = Date.now();
  let saidNum = initialNumber;
  let saidTick = Date.now();
  stage(`Menunggu ketuk angka ${saidNum} di HP (maks 15 menit)`);
  while (Date.now() - started < CONFIRM_MAX_MS) {
    await sleep(3000);
    if (S_SUCCESS_URL.test(page.url())) return { status: 'ok', confirmNumber: saidNum };
    const n = await detectConfirmNumber(page);
    if (n && n !== saidNum) {
      saidNum = n; saidTick = Date.now();
      stage(`Nomor berganti: ketuk angka ${n} di HP`);
    } else if (Date.now() - saidTick > 30000) {
      saidTick = Date.now();
      stage(`Masih menunggu ketukan angka ${saidNum} di HP (${Math.round((Date.now() - started) / 60000)} menit berlalu)`);
    }
  }
  return { status: 'wait_hp', confirmNumber: saidNum };
}

// ─── KLASIFIKASI: satu fungsi → SATU state per giliran ───────────────────────
// Urutan cek: spesifik dulu. Kelas: logged_in | password_form | bad_password |
// totp | captcha | device_prompt | rejected | verify_block | email_form |
// chooser | signed_out | unknown.
async function classify(page, email) {
  if (S_SUCCESS_URL.test(page.url())) return 'logged_in';
  let body = '';
  try {
    body = await page.evaluate(() => (document.body ? document.body.innerText : ''));
  } catch (e) { return 'unknown'; }
  const pwVisible = await page.locator('input[type="password"]').first().isVisible().catch(() => false);
  if (pwVisible) return T_BADPW.test(body) ? 'bad_password' : 'password_form';
  if (await page.locator('input[name="totpPin"], input[aria-label*="kode"], input[autocomplete="one-time-code"]').count().catch(() => 0) > 0) return 'totp';
  if (await isCaptchaPage(page)) return 'captcha';
  if (T_DEVPROMPT.test(body) && (await detectConfirmNumber(page))) return 'device_prompt';
  if (T_REJECT.test(body)) return 'rejected';
  if (T_VERIFY.test(body)) return 'verify_block';
  if (await page.locator(EMAIL_SEL).first().isVisible().catch(() => false)) return 'email_form';
  if (await page.locator(`div[data-identifier="${email}"], div[role="link"]:has-text("${email}"), button:has-text("${email}"), li:has-text("${email}")`).first().isVisible().catch(() => false)) return 'chooser';
  if (T_CHOOSER.test(body)) return 'chooser';
  if (T_SIGNEDOUT.test(body)) return 'signed_out';
  return 'unknown';
}

(async () => {
  const argv = process.argv.slice(2);
  const gmailId = Number(argv[0]) || 0;
  const email = argv[1] || '';
  const password = argv[2] || '';
  const opts = parseArgs(argv.slice(3));
  if (!gmailId || !email || !password) { console.error('argumen kurang'); process.exit(1); }

  const proxyStr = stickyProxy(gmailId, opts.proxy);
  const proxy = opts.noProxy ? null : proxyParts(proxyStr);
  if (!opts.noProxy && !proxy) { console.error('proxy tidak valid:', proxyStr.slice(0, 40)); process.exit(1); }
  if (opts.noProxy) console.log('[gmail-login] TANPA PROXY: memakai IP asli mesin ini (Google lebih percaya IP yang biasa).');

  const cfg = spoof.spoofConfigFor({
    id: gmailId, name: `gmail-${gmailId}`, email,
    user_agent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36',
  });
  const profileDir = path.join(ROOT, 'sessions', `gmail-${gmailId}`);
  fs.mkdirSync(profileDir, { recursive: true });

  console.log(`[gmail-login] #${gmailId} ${email} mode=${opts.mode} proxy sid=gmail-${gmailId}`);
  console.log(`[gmail-login] spoof: cores ${cfg.hardwareConcurrency} | mem ${cfg.deviceMemory}GB | ${cfg.webgl.vendor}`);
  stage('Menyiapkan browser & proxy sticky');

  const ctxOpts = {
    locale: 'id-ID',
    timezoneId: 'Asia/Jakarta',
    viewport: { width: 1280, height: 800 },
  };
  const ARGS = ['--no-first-run', '--no-default-browser-check', '--no-sandbox', '--disable-dev-shm-usage', '--force-webrtc-ip-handling-policy=disable_non_proxied_udp'];

  // PROFIL PERSISTEN: sumber sesi = folder profil, bukan replay cookies.json.
  // Pelajaran dari uji "Buka Gmail": replay jar cookie sederhana TIDAK cukup
  // untuk Google (account chooser selalu tampil "Signed out"). Sesi hidup
  // di profil yang sama dipakai login dan pembukaan jendela, jadi tidak
  // ada perbedaan antara "yang login" dan "yang dibuka".
  const launchOpts = {
    headless: opts.mode === 'headless',
    args: ARGS, ...ctxOpts,
  };
  if (proxy) launchOpts.proxy = proxy; // tanpa proxy = IP asli, kunci tak dikirim
  const browser = await chromium.launchPersistentContext(profileDir, launchOpts);
  const context = browser;
  await context.addInitScript(stealth.spoofInitScript(cfg));
  const page = await context.newPage();

  let status = 'error';
  let confirmNumber = null; // nomor "ketuk di HP" bila Google minta device prompt

  // Screenshot diagnosa per state (nama tetap per state, menimpa — tak menumpuk).
  const shot = (name) => page.screenshot({ path: path.join(profileDir, `login-state-${name}.png`), fullPage: false }).catch(() => {});

  try {
    stage('Membuka halaman login Google');
    await page.goto('https://accounts.google.com/', { timeout: 60000, waitUntil: 'domcontentloaded' });
    await sleep(2500);
    console.log('[gmail-login] url awal:', page.url().slice(0, 90));
    await shot('step0');
    stage('Memeriksa sesi tersimpan');

    // ─── LOOP STATE ─────────────────────────────────────────────────────────
    // Tiap giliran: classify → delegasi satu aksi → classify ulang. Klik yang
    // tidak memindahkan page tidak diulang buta; state berikutnya menang.
    const MAX_ITER = 25;
    let iter = 0;
    let unknownStreak = 0;
    while (iter++ < MAX_ITER) {
      const st = await classify(page, email);
      console.log(`[state] ${st} | url: ${page.url().slice(0, 70)}`);
      await shot(st).catch(() => {});

      switch (st) {
        // ── AUTO: worker beraksi ──
        case 'logged_in':
          status = 'ok';
          console.log('[gmail-login] login sukses (sesi profil hidup), land di:', page.url().slice(0, 80));
          break; // keluar loop
        case 'email_form': {
          stage('Mengisi email');
          await typeInto(page, EMAIL_SEL, email);
          await page.keyboard.press('Enter');
          await sleep(3500);
          continue;
        }
        case 'password_form': {
          stage('Mengisi password');
          await typeInto(page, 'input[type="password"]', password);
          await page.keyboard.press('Enter');
          await sleep(4500);
          continue;
        }
        case 'chooser': {
          // Klik SEKALI per giliran: baris akun → tombol Berikutnya (interstisial
          // konfirmasi) → "Gunakan akun lain". Bila pengklik berjalan tapi page
          // tetap chooser di giliran berikutnya, fallback URL identifier
          // langsung (selalu membuka form email) — bukan klik berulang buta.
          const row = page.locator(`div[data-identifier="${email}"], div[role="link"]:has-text("${email}"), button:has-text("${email}"), li:has-text("${email}")`).first();
          if (await row.isVisible().catch(() => false)) {
            console.log(`[gmail-login] klik baris akun ${email} di pemilih`);
            await row.click().catch(() => {});
          } else {
            const next = page.locator('button:has-text("Berikutnya"), button:has-text("Next")').first();
            if (await next.isVisible().catch(() => false)) {
              console.log('[gmail-login] klik Berikutnya (konfirmasi akun)');
              await next.click().catch(() => {});
            } else {
              const other = page.locator('text=/akun lain|another account/i').first();
              if (await other.isVisible().catch(() => false)) {
                console.log('[gmail-login] klik akun lain');
                await other.click().catch(() => {});
              }
            }
          }
          await sleep(3000);
          if ((await classify(page, email)) === 'chooser') {
            console.log('[gmail-login] pemilih tetap setelah klik — coba URL identifier langsung');
            for (const u of [
              'https://accounts.google.com/signin/v2/identifier?continue=https://myaccount.google.com&hl=id',
              'https://accounts.google.com/AccountChooser?continue=https://myaccount.google.com&hl=id&flowName=GlifWebSignIn&flowEntry=AccountChooser',
            ]) {
              await page.goto(u, { timeout: 45000, waitUntil: 'domcontentloaded' }).catch(() => {});
              await sleep(2500);
              if ((await classify(page, email)) !== 'chooser') break;
            }
          }
          continue;
        }

        // ── OPERATOR: browser dibuka, worker menunggu ──
        case 'captcha': {
          if (!opts.waitManual) {
            status = 'captcha';
            console.log('[gmail-login] CAPTCHA muncul. Centang "Selesaikan captcha manual" di panel agar browser ditunggu.');
            break; // keluar loop
          }
          const r = await handleCaptcha(page);
          if (r) { status = r; break; } // captcha_timeout
          continue; // captcha lolos → classify ulang
        }
        case 'device_prompt': {
          const n = await detectConfirmNumber(page);
          confirmNumber = n || confirmNumber;
          console.log(`[gmail-login] Google minta konfirmasi HP: ketuk angka ${confirmNumber}. Browser tetap terbuka, tunggu ketukan di HP.`);
          const r = await waitConfirmDone(page, confirmNumber);
          status = r.status;
          confirmNumber = r.confirmNumber;
          console.log('[gmail-login] hasil menunggu konfirmasi HP:', status);
          break; // terminal
        }

        // ── TERMINAL: status final, penjelasan ke operator ──
        case 'rejected':
          status = 'rejected';
          console.log('[gmail-login] Google menolak browser ini (rejected). Coba mode headed/Ip asli (--no-proxy), atau tunggu reputasi akun naik.');
          break;
        case 'verify_block':
          status = 'verify_block';
          confirmNumber = confirmNumber || (await detectConfirmNumber(page));
          console.log('[gmail-login] Google: "Confirm it\'s you" (verify_block) — sesi profil diminta login ulang. Coba lagi tanpa proxy (IP asli).');
          break;
        case 'signed_out':
          status = 'signed_out';
          console.log('[gmail-login] pemilih akun menandai "Signed out" — cookie login mati. Login ulang diperlukan (uji --no-proxy kalau Google menolak).');
          break;
        case 'bad_password':
          status = 'bad_password';
          console.log('[gmail-login] password salah (bad_password).');
          break;
        case 'totp':
          status = '2fa_prompt';
          console.log('[gmail-login] Google minta kode 2FA (totp).');
          break;
        case 'unknown':
        default:
          // Beri redirect lambat satu kesempatan: dua giliran berturut-turut
          // tanpa state dikenali → checkpoint (bukan error teknis).
          unknownStreak++;
          if (unknownStreak >= 2) {
            status = 'checkpoint';
            console.log(`[gmail-login] halaman tak dikenali 2 giliran: ${page.url().slice(0, 80)}`);
            break;
          }
          await sleep(5000);
          continue;
      }
      break; // status non-continue = keluar loop
    }
    if (status === 'error' && iter >= MAX_ITER) {
      status = 'checkpoint';
      console.log('[gmail-login] batas giliran tercapai tanpa hasil final.');
    }

    if (status === 'ok') {
      // Cadangan: salin jar cookie profil untuk audit (sesi asli tetap di profil).
      const cookies = await context.cookies();
      fs.writeFileSync(path.join(profileDir, 'cookies.json'),
        JSON.stringify({ engine: 'patchright', mode: opts.mode, savedAt: new Date().toISOString(), cookies }, null, 2));
      console.log(`[gmail-login] ${cookies.length} cookie -> sessions/gmail-${gmailId}/cookies.json (pro profil = sumber utama)`);
    }
  } catch (e) {
    status = 'error';
    console.log('[gmail-login] error teknis:', (e.message || '').split('\n')[0]);
  } finally {
    stage(`Login selesai: ${status}`);
    try { await browser.close(); } catch (e) { /* abaikan */ }
  }

  // Riwayat (addGmailLoginLog) ditulis runner di proses server — sql.js
  // per-proses, tulisan dari proses worker tidak terlihat memori server.
  await db.setGmailLoginStatus(gmailId, status, new Date().toISOString());
  if (confirmNumber) console.log(`[stage] Butuh konfirmasi HP: ketuk angka ${confirmNumber} di HP`);
  console.log(`[gmail-login] status akun #${gmailId} -> ${status}`);
  process.exit(status === 'ok' ? 0 : (['2fa_prompt', 'checkpoint', 'bad_password', 'wait_hp', 'verify_block', 'captcha', 'captcha_timeout', 'signed_out', 'rejected'].includes(status) ? 3 : 1));
})().catch((e) => {
  console.error('[gmail-login] FATAL:', (e.message || '').split('\n')[0]);
  process.exit(1);
});
