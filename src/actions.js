'use strict';

const path = require('path');
const fs = require('fs');
const { openAccountBrowser, typeHuman, rand, humanDelay } = require('./browser');
const db = require('./db');
const { decrypt } = require('./crypto');

const FB_LOGIN_URL = 'https://www.facebook.com/login';
const IG_LOGIN_URL = 'https://www.instagram.com/accounts/login/';

// Chromium melaporkan proxy yang menolak kredensial atau kehabisan kuota sebagai
// ERR_PROXY_AUTH_UNSUPPORTED. Pesan mentahnya tidak memberi tahu operator apa
// yang harus dilakukan, jadi error jaringan yang dikenal diterjemahkan dulu.
function explainNetError(msg) {
  const s = String(msg || '');
  if (/ERR_PROXY_AUTH_UNSUPPORTED|ERR_PROXY_AUTH_REQUESTED/.test(s)) {
    return 'Proxy menolak autentikasi (biasanya kuota traffic habis atau kredensial berganti). Top up atau ganti proxy akun ini di halaman Proxy.';
  }
  if (/ERR_TUNNEL_CONNECTION_FAILED|ERR_PROXY_CONNECTION_FAILED/.test(s)) {
    return 'Proxy tidak bisa dihubungi. Cek host, port, dan status proxy akun ini di halaman Proxy.';
  }
  if (/ERR_NAME_NOT_RESOLVED/.test(s)) {
    return 'Alamat situs tidak bisa diterjemahkan (DNS). Cek koneksi proxy akun ini.';
  }
  return s;
}

// Profil Chrome hanya boleh dipakai satu proses. Kalau jendela login akun masih
// terbuka, launch gagal dengan pesan Playwright yang panjang; operator cukup
// diberi tahu jendela mana yang harus ditutup.
function explainLaunchError(msg) {
  const s = String(msg || '');
  if (/Opening in existing browser session|already in use|ProcessSingleton|profile.*(locked|in use)/i.test(s)) {
    return 'Jendela browser akun ini masih terbuka. Tutup dulu jendela Chrome akun ini, lalu kirim lagi.';
  }
  return explainNetError(s);
}

function withDecryptedPassword(account) {
  if (!account) return account;
  if (account.password) return account;
  if (account.password_enc) {
    return { ...account, password: decrypt(account.password_enc) };
  }
  return account;
}

async function getAccountForAction(id) {
  await db.waitReady();
  const rows = await db.rawAll('SELECT * FROM accounts WHERE id = ?', [id]);
  return rows[0] ? withDecryptedPassword(rows[0]) : null;
}

// Folder screenshot debug (dipisah agar mudah dibersihkan).
const DEBUG_DIR = path.join(__dirname, '..', 'sessions', 'debug');
fs.mkdirSync(DEBUG_DIR, { recursive: true });
function debugShot(name) {
  return path.join(DEBUG_DIR, name);
}

// Klik elemen login memakai beberapa fallback selector.
async function clickLoginButton(page, isInstagram = false) {
  const igSelectors = [
    'button[type="submit"]',
    'button:has-text("Log in")',
    'button:has-text("Log In")',
    'div[role="button"]:has-text("Log in")',
    'button._acan._acap._acas._aj1-',
  ];
  
  const fbSelectors = [
    'button[name="login"]',
    'button[type="submit"]',
    'button:has-text("Masuk")',
    'button:has-text("Log In")',
    'div[role="button"]:has-text("Masuk")',
    'div[role="button"]:has-text("Log In")',
    '#login_form button',
    '#loginform > ._9bq5',
  ];
  
  const selectors = isInstagram ? igSelectors : fbSelectors;
  // Debug: catat tombol mana yang ada di halaman.
  for (const sel of selectors) {
    try {
      const cnt = await page.locator(sel).count();
      if (cnt > 0) console.log(`  [debug] selector ada (${cnt}): ${sel}`);
    } catch (e) { /* ignore */ }
  }
  // Coba klik tombol yang tersedia.
  for (const sel of selectors) {
    try {
      const el = page.locator(sel).first();
      if ((await el.count()) > 0) {
        await el.waitFor({ state: 'visible', timeout: 3000 }).catch(() => {});
        if (await el.isVisible().catch(() => false)) {
          console.log(`  [login] klik tombol via: ${sel}`);
          await el.click();
          return true;
        }
      }
    } catch (e) { console.log(`  [debug] klik gagal ${sel}: ${e.message}`); }
  }
  // Fallback: tekan Enter pada input terakhir (password) — paling andal utk form FB.
  try {
    console.log(`  [login] fallback: tekan Enter utk submit.`);
    await page.keyboard.press('Enter');
    return true;
  } catch (e) {
    console.error(`  [login] fallback Enter gagal: ${e.message}`);
  }
  return false;
}

// Login TikTok: form email+password, bukti = cookie sessionid. Jalur sendiri dari
// FB/IG karena selector dan kriteria sukses ternyata berbeda (sessionid cookie,
// bukan redirect halaman feed).
async function tiktokLogin(account) {
  const acc = withDecryptedPassword(account);
  const { context } = await openAccountBrowser(acc, { headless: false });
  const page = await context.newPage();
  try {
    // Sudah login di profil persisten? Cukup konfirmasi dgn cookie sessionid.
    const preCookies = await context.cookies('https://www.tiktok.com');
    if (preCookies.some((c) => /^sessionid(_ss)?$/.test(c.name))) {
      console.log('  [login-tt] sessionid sudah ada di profil — login dilewati');
      return { ok: true, already: true };
    }
    await page.goto('https://www.tiktok.com/login/phone-or-email/email', { timeout: 60000, waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(rand(3000, 5000));
    for (const name of [/decline/i, /reject/i, /tolak/i, /nanti saja/i, /not now/i]) {
      const b = page.getByRole('button', { name }).first();
      if ((await b.count()) > 0) { await b.click().catch(() => {}); await page.waitForTimeout(1500); break; }
    }
    console.log('  [login-tt] membuka halaman login TikTok...');
    const emailBox = page.locator('input[name="username"], input[type="email"], input[placeholder*="email" i]').first();
    const passBox = page.locator('input[type="password"]').first();
    try {
      await emailBox.waitFor({ state: 'visible', timeout: 20000 });
    } catch (err) {
      await page.screenshot({ path: debugShot('debug_tt_no_form.png') }).catch(() => {});
      return { ok: false, reason: 'Form login TikTok tidak muncul (captcha/challenge/IP ditolak). Bukti: sessions/debug/debug_tt_no_form.png' };
    }
    await typeHuman(emailBox, acc.email);
    await page.waitForTimeout(rand(300, 800));
    await typeHuman(passBox, acc.password);
    const submit = page.locator('button[type="submit"], button[data-e2e="login-button"], form button').first();
    if ((await submit.count()) > 0) await submit.click().catch(() => {});
    else await passBox.press('Enter').catch(() => {});
    console.log('  [login-tt] kredensial dikirim, menunggu sessionid...');
    let okLogin = false, reason = '';
    for (let i = 0; i < 20; i++) {
      await page.waitForTimeout(2000);
      const cs = await context.cookies('https://www.tiktok.com');
      if (cs.some((c) => /^sessionid(_ss)?$/.test(c.name))) { okLogin = true; break; }
      const t = (await page.evaluate(() => document.body ? document.body.innerText : '').catch(() => '')) || '';
      const errM = /password.*incorrect|kata sandi.*salah|tidak cocok|max.*attempts|terlalu.*percobaan|disabled|dinonaktifkan|suspend/i.exec(t);
      if (errM) { reason = 'TikTok menolak login: ' + errM[0].slice(0, 90); break; }
    }
    if (!okLogin && !reason) {
      await page.screenshot({ path: debugShot('debug_tt_login_stuck.png') }).catch(() => {});
      reason = 'Login TikTok tidak merespons 40 detik (mungkin captcha — selesaikan manual di jendela browser). Bukti: sessions/debug/debug_tt_login_stuck.png';
    }
    if (okLogin) {
      // Sinkron ke kanon: sessions/<nama>/cookies.json — tombol Buka membaca ini.
      try {
        const cookies = await context.cookies('https://www.tiktok.com');
        const canonDir = path.join(__dirname, '..', 'sessions', acc.name || (acc.email || '').split('@')[0]);
        fs.mkdirSync(canonDir, { recursive: true });
        fs.writeFileSync(path.join(canonDir, 'cookies.json'), JSON.stringify({
          platform: 'tiktok', username: acc.name, email: acc.email, password: acc.password || null,
          proxy: acc.proxy || null, cookies, login_at: new Date().toISOString(), updated_from: 'loginAccount-tiktok',
        }, null, 2));
        console.log(`  [login-tt] cookie kanonis tersimpan (${cookies.length} cookies)`);
      } catch (e) { console.log(`  [login-tt] sinkron kanon gagal: ${e.message}`); }
      await page.waitForTimeout(2000);
    }
    return okLogin ? { ok: true } : { ok: false, reason };
  } catch (err) {
    console.error(`  [login-tt] ERROR: ${err.message}`);
    await page.waitForTimeout(1000).catch(() => {});
    return { ok: false, reason: 'error: ' + err.message };
  } finally {
    await page.waitForTimeout(1000).catch(() => {});
    await context.close().catch(() => {});
  }
}

// Login otomatis ke akun. Asumsi awal akun: belum login di profile tersebut.
async function loginAccount(account) {
  const acc = withDecryptedPassword(account);
  // TikTok punya jalur sendiri — selector login + kriteria sukses berbeda dari FB/IG.
  if (acc.platform === 'tiktok') return tiktokLogin(acc);
  const { context } = await openAccountBrowser(acc, { headless: false });
  const page = await context.newPage();
  try {
    // Tentukan URL login berdasarkan platform
    const isInstagram = acc.platform === 'ig' || acc.platform === 'instagram';
    const LOGIN_URL = isInstagram ? IG_LOGIN_URL : FB_LOGIN_URL;
    const platformName = isInstagram ? 'Instagram' : 'Facebook';
    
    // Instagram memerlukan delay lebih lama untuk menghindari deteksi bot
    if (isInstagram) {
      console.log(`  [login] Instagram detected - using enhanced anti-detection...`);
      await page.waitForTimeout(rand(3000, 5000));
    }
    
    // Retry mechanism for page load with longer timeout
    let pageLoaded = false;
    let retryCount = 0;
    const maxRetries = 2;
    
    while (!pageLoaded && retryCount <= maxRetries) {
      try {
        console.log(`  [login] membuka halaman login ${platformName}...`);
        await page.goto(LOGIN_URL, { 
          waitUntil: 'networkidle',  // Tunggu sampai network idle untuk Instagram
          timeout: 60000
        });
        pageLoaded = true;
        console.log(`  [login] halaman login ${platformName} berhasil dimuat`);
      } catch (err) {
        retryCount++;
        if (retryCount > maxRetries) {
          console.error(`  [login] gagal memuat halaman setelah ${maxRetries} percobaan: ${err.message}`);
          const errorMsg = isInstagram 
            ? `Instagram memblokir automated login. Error: ${err.message}\n\nSOLUSI:\n1. Login manual: Buka browser dengan profile yang sama (${acc.browser_profile_dir}) dan login manual\n2. Gunakan proxy berbeda atau ganti IP\n3. Tunggu 24-48 jam sebelum mencoba lagi\n4. Gunakan Facebook login sebagai alternatif (Instagram owned by Meta)`
            : `Timeout - tidak dapat memuat halaman login ${platformName} setelah ${maxRetries} percobaan`;
          return { ok: false, reason: errorMsg };
        }
        console.log(`  [login] percobaan ${retryCount} gagal, retry...`);
        await page.waitForTimeout(rand(5000, 8000));  // Delay lebih lama untuk Instagram
      }
    }
    
    // Extra delay untuk Instagram agar halaman fully loaded
    await page.waitForTimeout(isInstagram ? rand(3000, 5000) : rand(1500, 3000));
    
    // Debug: screenshot halaman untuk melihat apa yang ditampilkan
    try {
      await page.screenshot({ path: debugShot('debug_login_page.png') });
      console.log(`  [login] screenshot halaman login disimpan`);
    } catch (e) { console.log(`  [debug] screenshot gagal: ${e.message}`); }

    // Isi email/username (Instagram menggunakan username, FB menggunakan email)
    let emailBox;
    if (isInstagram) {
      // Untuk Instagram, cari input pertama yang visible (biasanya username field)
      emailBox = page.locator('input[name="username"]').first();
      const exists = await emailBox.count();
      if (exists === 0) {
        // Fallback: cari input text pertama yang visible di form
        emailBox = page.locator('form input[type="text"]').first();
      }
    } else {
      emailBox = page.locator('input[name="email"], input#email, input[type="email"], input#m_login_email').first();
    }
    console.log(`  [login] menunggu kotak email...`);
    
    // Untuk Instagram, cek dulu apakah form login benar-benar muncul
    if (isInstagram) {
      const formExists = await emailBox.count().catch(() => 0);
      if (formExists === 0) {
        console.log(`  [login] Form login Instagram tidak ditemukan - kemungkinan terdeteksi bot`);
        await page.screenshot({ path: debugShot('debug_instagram_blocked.png') });
        
        // Cek apakah ada pesan error atau blocking
        const pageContent = await page.content().catch(() => '');
        if (pageContent.includes('suspicious') || pageContent.includes('verify') || pageContent.includes('challenge')) {
          return { ok: false, reason: 'Instagram mendeteksi aktivitas mencurigakan. Buka browser secara manual untuk verifikasi.' };
        }
        
        return { 
          ok: false, 
          reason: 'Instagram memblokir automated login. Solusi: 1) Login manual via browser dengan profile yang sama, atau 2) Gunakan proxy berbeda, atau 3) Tunggu beberapa jam sebelum mencoba lagi.' 
        };
      }
    }
    
    // Coba tunggu dengan timeout lebih pendek dan tangani error dengan lebih baik
    try {
      await emailBox.waitFor({ state: 'visible', timeout: 10000 });
      console.log(`  [login] kotak email ditemukan`);
    } catch (err) {
      if (isInstagram) {
        await page.screenshot({ path: debugShot('debug_instagram_timeout.png') });
        throw new Error('Instagram login form tidak muncul setelah 10 detik. Kemungkinan Instagram memblokir automated access atau menampilkan CAPTCHA.');
      }
      throw err;
    }
    
    await typeHuman(emailBox, acc.email);
    console.log(`  [login] email terisi: ${acc.email}`);
    await page.waitForTimeout(rand(300, 700));

    // Isi password (Instagram menggunakan name="password", FB menggunakan name="pass")
    let passBox;
    if (isInstagram) {
      passBox = page.locator('input[name="password"]').first();
      const exists = await passBox.count();
      if (exists === 0) {
        // Fallback: cari input password pertama yang visible
        passBox = page.locator('form input[type="password"]').first();
      }
    } else {
      passBox = page.locator('input[name="pass"], input#pass, input[type="password"]').first();
    }
    
    await passBox.waitFor({ state: 'visible', timeout: 10000 });
    await typeHuman(passBox, acc.password);
    console.log(`  [login] password terisi.`);
    await page.waitForTimeout(rand(500, 1200));

    // Klik tombol login
    page.on('crash', () => console.error('  [login] CRASH browser!'));
    // Simpan screenshot right sebelum klik utk debug.
    try {
      await page.screenshot({ path: debugShot('debug_before_click.png') });
      console.log(`  [login] screenshot sblm klik disimpan.`);
    } catch (e) { console.log(`  [debug] screenshot gagal: ${e.message}`); }
    const clicked = await clickLoginButton(page, isInstagram);
    if (!clicked) {
      return { ok: false, reason: 'Tombol login tidak ditemukan' };
    }
    console.log(`  [login] tombol login diklik.`);
    
    // Tunggu lebih lama untuk proses login dan redirect
    await page.waitForTimeout(rand(6000, 10000));
    
    // Tunggu navigation atau perubahan URL dengan timeout yang lebih panjang
    console.log(`  [login] menunggu redirect atau perubahan halaman...`);
    try {
      await Promise.race([
        page.waitForNavigation({ timeout: 15000 }).catch(() => null),
        page.waitForURL(/^(?!.*\/login).*$/, { timeout: 15000 }).catch(() => null),
        page.waitForTimeout(15000)
      ]);
    } catch (e) {
      console.log(`  [login] navigation wait completed: ${e.message}`);
    }
    
    // Tunggu lagi sebentar untuk memastikan halaman stabil
    await page.waitForTimeout(rand(2000, 4000));

    // Cek hasil: redirect menjauhi /login = sukses; cek checkpoint & error.
    const url = page.url();
    console.log(`  [login] URL setelah login: ${url}`);
    
    // Cek berbagai error messages (dengan dukungan Instagram dan Facebook)
    const checkpoint = await page.getByText(/checkpoint|identify|secure your account|suspicious activity|confirm.*identity/i).count().catch(() => 0);
    
    // Instagram: "Sorry, your password was incorrect" / Facebook: "The password that you've entered is incorrect"
    const wrongCreds = await page.getByText(/password.*incorrect|kata sandi.*salah|you entered a wrong|shaking|sorry.*password/i).count().catch(() => 0);
    
    // Instagram: "The username you entered doesn't belong to an account" / Facebook: "isn't connected to an account"
    const emailNotFound = await page.getByText(/tidak terhubung ke akun|isn't connected to an account|email.*tidak ditemukan|email.*not found|username.*doesn't belong|username.*not found/i).count().catch(() => 0);
    
    // Instagram: "Your account has been disabled" / Facebook: "Your account has been disabled"
    const accountDisabled = await page.getByText(/akun.*dinonaktifkan|account.*disabled|account.*suspended/i).count().catch(() => 0);
    
    // Instagram & Facebook: rate limiting
    const tooManyAttempts = await page.getByText(/terlalu banyak percobaan|too many attempts|try again later|please wait/i).count().catch(() => 0);
    
    // Cek apakah masih di halaman login (Instagram: /accounts/login, Facebook: /login)
    const isStillOnLogin = url.includes('/login');
    
    // Cek elemen yang menandakan sudah login (home feed, profile, dll)
    // Instagram: role="main", navigation bar / Facebook: role="feed", profile menu
    const feedVisible = await page.locator('[role="feed"], [role="main"], nav[role="navigation"]').count().catch(() => 0);
    const profileMenu = await page.locator('[aria-label*="Account"], [aria-label*="Akun"], [aria-label*="Profile"], svg[aria-label*="Home"]').count().catch(() => 0);
    
    console.log(`  [login] isStillOnLogin: ${isStillOnLogin}, feedVisible: ${feedVisible}, profileMenu: ${profileMenu}`);

    // Prioritas pengecekan error
    const platformLabel = isInstagram ? 'Instagram' : 'Facebook';
    if (emailNotFound > 0) return { ok: false, reason: `Email/username tidak terhubung ke akun ${platformLabel}` };
    if (accountDisabled > 0) return { ok: false, reason: `Akun telah dinonaktifkan oleh ${platformLabel}` };
    if (tooManyAttempts > 0) return { ok: false, reason: 'Terlalu banyak percobaan login - coba lagi nanti' };
    if (wrongCreds > 0) return { ok: false, reason: 'Password salah' };
    if (checkpoint > 0) return { ok: false, reason: 'Akun terkena checkpoint/verifikasi keamanan' };
    
    // Cek login success
    if (!isStillOnLogin && (feedVisible > 0 || profileMenu > 0)) {
      console.log(`  [login] Login berhasil - redirect ke ${url}`);
      // Tunggu sebentar sebelum close untuk memastikan session tersimpan
      await page.waitForTimeout(2000);
      return { ok: true };
    }
    if (!isStillOnLogin) {
      console.log(`  [login] Tidak di halaman login, anggap berhasil`);
      await page.waitForTimeout(2000);
      return { ok: true };
    }
    
    // Masih di halaman login tanpa error message yang jelas
    await page.waitForTimeout(1000);
    return { ok: false, reason: 'Login gagal - masih di halaman login setelah 25 detik, kemungkinan kredensial salah atau koneksi lambat' };
  } catch (err) {
    console.error(`  [login] ERROR: ${err.message}`);
    // Tambah delay sebelum close untuk debug
    await page.waitForTimeout(2000).catch(() => {});
    return { ok: false, reason: 'error: ' + err.message };
  } finally {
    // Delay sebelum menutup browser agar session sempat tersimpan
    await page.waitForTimeout(1000).catch(() => {});
    await context.close().catch(() => {});
  }
}

// FB akun baru menampilkan "Tinjau audiens" (gabung audiens post & reel) tepat
// di atas dialog komposer. Tanpa dilewati, semua klik ke editor terhalang overlay.
async function passFbPrompts(page) {
  // Dua langkah yang ditemui akun baru: "Tinjau audiens" -> Lanjutkan, lalu
  // "Perbarui pengaturan" (pemilih audiens) -> Simpan. Keduanya menutupi editor.
  const steps = [
    {
      match: /Tinjau audiens|Review audience|gabungan audiens|merge.*audience/i,
      buttons: ['Lanjutkan', 'Continue', 'Oke', 'OK'],
    },
    {
      match: /Perbarui pengaturan|Update settings|Siapa yang bisa melihat postingan dan reel/i,
      buttons: ['Simpan', 'Save', 'Selesai', 'Lanjutkan'],
    },
  ];
  for (let i = 0; i < 4; i += 1) {
    let advanced = false;
    for (const step of steps) {
      const dialog = page.locator('div[role="dialog"]').filter({ hasText: step.match }).first();
      if (!(await dialog.isVisible().catch(() => false))) continue;
      for (const label of step.buttons) {
        const btn = dialog.locator(`div[role="button"]:has-text("${label}"), button:has-text("${label}")`).last();
        if ((await btn.count().catch(() => 0)) === 0 || !(await btn.isVisible().catch(() => false))) continue;
        await btn.click().catch(() => {});
        advanced = true;
        break;
      }
      if (advanced) break;
    }
    if (!advanced) return;
    await humanDelay(1200, 2200);
  }
}

// Posting IG tidak punya URL balikan, jadi profil dibaca dan caption dicocokkan.
// Post yang disematkan tidak akan cocok bila captionnya berbeda.
async function findIgPostUrlByCaption(page, username, caption) {
  const snip = String(caption || '').replace(/\s+/g, ' ').trim().slice(0, 40);
  await page.goto(`https://www.instagram.com/${encodeURIComponent(username)}/`, {
    waitUntil: 'domcontentloaded', timeout: 45000,
  }).catch(() => {});
  await humanDelay(3000, 5000);
  const hrefs = await page.evaluate(() => {
    const out = [];
    const seen = new Set();
    for (const a of document.querySelectorAll('a[href*="/p/"], a[href*="/reel/"]')) {
      const r = a.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      const href = a.href.split('?')[0];
      if (seen.has(href)) continue;
      seen.add(href);
      out.push(href);
    }
    return out.slice(0, 4);
  }).catch(() => []);
  if (!hrefs.length) return null;
  if (!snip) return hrefs[0];
  for (const href of hrefs.slice(0, 3)) {
    await page.goto(href, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
    await humanDelay(1800, 3200);
    const hit = await page.evaluate((s) => (document.body.innerText || '').replace(/\s+/g, ' ').includes(s), snip).catch(() => false);
    if (hit) return href;
  }
  return null;
}

// Posting teks ke profil (timeline). Anggap session masih valid di profile.
async function postToTimeline(account, contentText, mediaPath, opts = {}) {
  const acc = withDecryptedPassword(account);
  let context;
  try {
    ({ context } = await openAccountBrowser(acc, { headless: false }));
  } catch (e) {
    return { ok: false, reason: explainLaunchError(e.message) };
  }
  const page = await context.newPage();
  const dbg = async (name) => {
    try { await page.screenshot({ path: debugShot(name) }); } catch (_) {}
  };
  try {
    page.on('crash', () => console.error('  [post] CRASH browser!'));
    
    // Retry mechanism for page load
    let pageLoaded = false;
    let retryCount = 0;
    let lastErr = null;
    const maxRetries = 2;
    
    while (!pageLoaded && retryCount <= maxRetries) {
      try {
        await page.goto('https://www.facebook.com/', { 
          waitUntil: 'domcontentloaded',
          timeout: 60000
        });
        pageLoaded = true;
      } catch (err) {
        lastErr = err;
        retryCount++;
        if (retryCount > maxRetries) {
          // Sertakan error terakhir: proxy yang menolak auth tidak akan sembuh
          // dengan retry, dan alasannya perlu sampai ke operator.
          return { ok: false, reason: explainNetError(lastErr && lastErr.message) };
        }
        await page.waitForTimeout(rand(2000, 4000));
      }
    }
    
    await humanDelay(3000, 6000); // jeda alami memuat halaman
    await dbg('debug_open_home.png');

    const url = page.url();
    if (url.includes('login')) {
      await dbg('debug_home_login.png');
      return { ok: false, reason: 'not_logged_in' };
    }
    console.log(`  [post] login OK, mulai posting.`);

    // Klik komposer "Apa yang Anda pikirkan" — banyak fallback selector
    const openSelectors = [
      'div[role="button"]:has-text("Apa yang Anda pikirkan")',
      'div[role="button"]:has-text("What\'s on your mind")',
      'div[aria-label*="Apa yang Anda pikirkan"]',
      'div[aria-label*="What\'s on your mind"]',
    ];
    let composer = null;
    for (const sel of openSelectors) {
      const loc = page.locator(sel).first();
      if ((await loc.count().catch(() => 0)) > 0) {
        await loc.click().catch(() => {});
        composer = loc;
        console.log(`  [post] komposer dibuka via: ${sel}`);
        break;
      }
    }
    if (!composer) {
      return { ok: false, reason: 'composer_not_found' };
    }
    await passFbPrompts(page);
    // Tunggu popup editor benar-benar render — polling hingga 15 detik
    // karena FB sering lambat & render bertahap.
    const editorSelectors = [
      'div[role="dialog"] div[contenteditable="true"][role="textbox"]',
      'div[role="dialog"] div[contenteditable="true"]',
      'div[contenteditable="true"][role="textbox"]',
      'div[contenteditable="true"][aria-autocomplete="list"]',
      'div[role="presentation"][contenteditable="true"]',
      'div[contenteditable="true"]',
    ];
    console.log(`  [post] menunggu editor muncul (max 15 detik)...`);
    let editor = null;
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      await passFbPrompts(page);
      for (const sel of editorSelectors) {
        try {
          const loc = page.locator(sel).first();
          if ((await loc.count().catch(() => 0)) > 0 && await loc.isVisible().catch(() => false)) {
            editor = loc;
            console.log(`  [post] editor ketemu via: ${sel}`);
            break;
          }
        } catch (e) { /* lanjut */ }
      }
      if (editor) break;
      await page.waitForTimeout(800);
    }
    if (!editor) {
      await dbg('debug_no_editor.png');
      console.error(`  [post] editor tidak ditemukan setelah 15 detik, screenshot: debug_no_editor.png`);
      return { ok: false, reason: 'editor_not_found' };
    }
    await dbg('debug_editor_found.png');

    // Overlay bisa baru muncul setelah dialog render; klik sekali lagi setelah
    // prompt dilewati, lalu berhenti cepat bila masih terhalang.
    await passFbPrompts(page);
    try {
      await editor.click({ timeout: 12000 });
    } catch (e) {
      await passFbPrompts(page);
      try {
        await editor.click({ timeout: 12000 });
      } catch (e2) {
        await dbg('debug_editor_blocked.png');
        console.error(`  [post] editor terhalang overlay: ${e2.message.split('\n')[0]}`);
        return { ok: false, reason: 'editor_blocked' };
      }
    }
    await humanDelay(800, 1600); // jeda alami klik editor lalu berpikir

    // Upload gambar DULU (jika ada). PENTING: JANGAN klik tombol "Foto", karena
    // itu memunculkan dialog pratinjau terpisah yang menutupi dialog caption,
    // sehingga nanti yang terpost cuma gambar tanpa caption.
    // Sebagai gantinya, langsung inject file ke input[type=file] di dialog utama
    // → gambar & caption berada di dialog yang sama.
    if (mediaPath && require('fs').existsSync(mediaPath)) {
      console.log(`  [post] mengupload gambar (tanpa klik tombol foto): ${mediaPath}`);
      await humanDelay(900, 1600);
      const fileInputSel = 'input[type="file"][accept*="image"], input[type="file"][accept*="video"], div[role="dialog"] input[type="file"]';
      try {
        const fileInput = page.locator(fileInputSel).first();
        await fileInput.waitFor({ state: 'attached', timeout: 10000 }).catch(() => {});
        await fileInput.setInputFiles(mediaPath);
        console.log(`  [post] file gambar di-set.`);
      } catch (e) {
        console.log(`  [post] upload file gagal: ${e.message}`);
      }
      await humanDelay(2500, 4000); // tunggu upload gambar selesai
    }

    // Ketik caption SETELAH upload selesai, di dialog utama (atas gambar).
    // Langsung tulis caption via keyboard, TANPA klik dan TANPA focus()
    // (jangan sentuh editor sama sekali — fokus sudah di editor dari awal,
    //  memanggil focus/klik justru memicu overlay pratinjau lagi).
    await humanDelay(500, 1100);
    try {
      await page.keyboard.type(contentText, { delay: rand(50, 200) });
      console.log(`  [post] caption diketik langsung.`);
    } catch (e) {
      console.log(`  [post] caption keyboard gagal: ${e.message}`);
    }
    await humanDelay(1500, 3000); // jeda sebelum menekan submit (orang periksa tulisannya)
    console.log(`  [post] konten selesai diketik.`);

    // Fokus tetap di editor, lalu tekan Ctrl+Enter utk submit.
    // Ini cara paling andal utk FB (composer); tidak mungkin salah klik.
    console.log(`  [post] submit via Ctrl+Enter...`);
    await page.keyboard.press('Control+Enter').catch(() => {});
    // Jeda alami sebelum verifikasi.
    await humanDelay(2000, 3500);

    // Fallback klik tombol post yang presisi (scoped ke dialog bila ada).
    const postSelectors = [
      'div[role="dialog"] div[aria-label="Post"]',
      'div[role="dialog"] div[aria-label="Kirim"]',
      'div[role="dialog"] div[role="button"]:has-text("Post")',
      'div[role="dialog"] div[role="button"]:has-text("Kirim")',
      'div[aria-label="Post"]',
      'div[aria-label="Kirim"]',
    ];
    let posted = false;
    for (const sel of postSelectors) {
      const loc = page.locator(sel);
      if ((await loc.count().catch(() => 0)) > 0) {
        const visible = loc.last();
        if (await visible.isVisible().catch(() => false)) {
          await visible.click().catch(() => {});
          posted = true;
          console.log(`  [post] tombol post diklik via: ${sel}`);
          break;
        }
      }
    }
    // Jeda alami tunggu hasil posting.
    await humanDelay(5000, 8000);

    // Verifikasi keberhasilan dengan multi-sinyal:
    //  1) editor/dialog menutup (detach atau hidden), ATAU
    //  2) muncul notifikasi/alert sukses di FB.
    let success = false;
    const deadlineV = Date.now() + 30000; // Tambah dari 20 detik ke 30 detik
    while (Date.now() < deadlineV && !success) {
      const vis = await editor.isVisible().catch(() => false);
      const detached = await editor.count().catch(() => 99) === 0;
      if (!vis || detached) {
        success = true;
        break;
      }
      // Deteksi toast notifikasi sukses (playwright global alert/toast).
      const alertVisible = await page.locator('div[role="alert"]').first().isVisible().catch(() => false);
      const toastVisible = await page.locator('[aria-live="polite"]:has-text("post")').first().isVisible().catch(() => false);
      if (alertVisible || toastVisible) {
        await humanDelay(1000, 2000); // beri jeda seolah mengecek notif
        success = true;
        break;
      }
      await page.waitForTimeout(1500); // Tambah dari 1000ms ke 1500ms
    }
    console.log(`  [post] hasil verifikasi: ${success ? 'post sukses (dialog/notif)' : 'masih terbuka (belum/tdk terpost)'}`);

    // Komentar pertama setelah kiriman terbit, di sesi browser yang sama.
    let comment = null;
    if (success && opts.autoComment) {
      try {
        comment = await require('./comment-automation')
          .commentOnOwnFacebookPost(page, contentText, opts.autoComment);
        console.log(`  [post] komentar otomatis: ${comment.ok ? 'terkirim' : comment.reason}`);
      } catch (e) {
        comment = { ok: false, reason: 'error: ' + e.message };
      }
    }
    return { ok: success, reason: success ? 'posted' : 'Dialog masih terbuka setelah 30 detik - posting mungkin gagal', comment };
  } catch (err) {
    console.error(`  [post] ERROR: ${err.message}`);
    return { ok: false, reason: explainNetError(err.message) };
  } finally {
    await context.close().catch(() => {});
  }
}

// Like sebuah postingan FB via URL. Buka halaman, cari tombol like, klik.
async function likePosting(account, postUrl) {
  const acc = withDecryptedPassword(account);
  const { context } = await openAccountBrowser(acc, { headless: false });
  const page = await context.newPage();
  try {
    await page.goto(postUrl, { waitUntil: 'domcontentloaded' });
    await humanDelay(3000, 5000);

    const url = page.url();
    if (url.includes('login')) {
      return { ok: false, reason: 'not_logged_in' };
    }

    // Debug: daftar elemen potensial like di halaman.
    try {
      const candidates = await page.evaluate(() => {
        const out = [];
        const all = document.querySelectorAll('[aria-label],[role="button"]');
        for (const el of all) {
          const label = (el.getAttribute && el.getAttribute('aria-label')) || '';
          const text = (el.textContent || '').trim().slice(0, 30);
          if (/suka|like/i.test(label + ' ' + text)) {
            out.push({ tag: el.tagName, label, role: el.getAttribute('role'), pressed: el.getAttribute('aria-pressed'), text });
          }
        }
        return out.slice(0, 15);
      });
      console.log(`  [like] kandidat tombol like:`);
      candidates.forEach(c => console.log(`    - ${c.tag} label="${c.label}" role=${c.role} pressed=${c.pressed} text="${c.text}"`));
      await page.screenshot({ path: debugShot('debug_like.png') });
    } catch (e) { console.log(`  [like] debug gagal: ${e.message}`); }

    // Cari tombol "Suka"/"Like" atau "Hapus Suka"/"Unlike" untuk cek status
    // Jika tombol "Hapus Suka" ditemukan = sudah di-like, skip
    const unlikeSelectors = [
      'div[role="button"][aria-label="Hapus Suka"]',
      'div[role="button"][aria-label="Unlike"]',
      'div[role="button"][aria-label="Remove Like"]',
    ];
    
    // Cek apakah sudah di-like
    for (const sel of unlikeSelectors) {
      try {
        const loc = page.locator(sel).first();
        const count = await loc.count().catch(() => 0);
        if (count > 0) {
          const isVisible = await loc.isVisible().catch(() => false);
          if (isVisible) {
            console.log(`  [like] postingan sudah di-like (tombol "Hapus Suka" ditemukan)`);
            return { ok: true, already: true, reason: 'already_liked' };
          }
        }
      } catch (e) {}
    }
    
    // Cari tombol "Suka"/"Like". Prioritas: tombol dgn aria-pressed (belum/ter-like),
    // lalu aria-label persis "Suka" (kode Suka kosong adalah tombol, bukan jumlah).
    const likeSelectors = [
      'div[role="button"][aria-pressed="false"][aria-label="Suka"]',
      'div[role="button"][aria-pressed="false"][aria-label="Like"]',
      'div[role="button"][aria-pressed][aria-label*="Suka"]:not([aria-label*="Hapus"]):not([aria-label*="orang"])',
      'div[role="button"][aria-pressed][aria-label*="Like"]:not([aria-label*="Unlike"]):not([aria-label*="people"])',
      'div[role="button"][aria-label="Suka"]:not(:has-text("orang")):not(:has-text("Hapus"))',
      'div[role="button"][aria-label="Like"]:not(:has-text("people")):not(:has-text("Unlike"))',
      'div[role="button"][aria-label="Suka"]',
      'div[role="button"][aria-label="Like"]',
    ];
    let liked = false;
    let likeButton = null;
    
    for (const sel of likeSelectors) {
      try {
        const loc = page.locator(sel).first();
        const count = await loc.count().catch(() => 0);
        if (count > 0) {
          const isVisible = await loc.isVisible().catch(() => false);
          if (isVisible) {
            // Double check bukan tombol "Hapus Suka"
            const label = await loc.getAttribute('aria-label').catch(() => '');
            if (label.includes('Hapus') || label.includes('Unlike') || label.includes('Remove')) {
              continue; // Skip tombol unlike
            }
            
            likeButton = loc;
            console.log(`  [like] tombol like ditemukan via: ${sel}, label="${label}"`);
            break;
          }
        }
      } catch (e) {
        console.log(`  [like] error cek selector ${sel}: ${e.message}`);
      }
    }
    
    if (!likeButton) {
      console.log(`  [like] tombol like tidak ditemukan di halaman`);
      return { ok: false, reason: 'like_button_not_found' };
    }
    
    // Cek status sebelum klik
    const pressedBefore = await likeButton.getAttribute('aria-pressed').catch(() => null);
    console.log(`  [like] status sebelum klik: aria-pressed="${pressedBefore}"`);
    
    // Coba klik tombol like
    try {
      // Scroll ke tombol agar visible
      await likeButton.scrollIntoViewIfNeeded().catch(() => {});
      await humanDelay(300, 600);
      
      // Klik dengan force jika ada overlay
      await likeButton.click({ force: true, timeout: 5000 });
      console.log(`  [like] klik berhasil dilakukan`);
      liked = true;
    } catch (clickError) {
      console.log(`  [like] klik gagal: ${clickError.message}`);
      
      // Fallback: coba klik dengan JavaScript
      try {
        await page.evaluate((selector) => {
          const btn = document.querySelector(selector);
          if (btn) btn.click();
        }, likeSelectors[0]);
        console.log(`  [like] fallback JS click berhasil`);
        liked = true;
      } catch (jsError) {
        console.log(`  [like] fallback JS click gagal: ${jsError.message}`);
        return { ok: false, reason: 'click_failed: ' + clickError.message };
      }
    }
    
    if (!liked) {
      return { ok: false, reason: 'like_button_not_clickable' };
    }
    
    // Tunggu dan verifikasi perubahan status
    await humanDelay(1500, 2500);
    
    // Cek status setelah klik dengan mencari tombol "Hapus Suka"
    try {
      // Cari tombol "Hapus Suka" sebagai konfirmasi like berhasil
      const unlikeBtn = page.locator('div[role="button"][aria-label="Hapus Suka"]').first();
      const unlikeVisible = await unlikeBtn.isVisible().catch(() => false);
      
      if (unlikeVisible) {
        console.log(`  [like] verifikasi: like berhasil (tombol "Hapus Suka" muncul)`);
        return { ok: true };
      }
      
      // Fallback: cek aria-pressed
      const pressedAfter = await likeButton.getAttribute('aria-pressed').catch(() => null);
      console.log(`  [like] status setelah klik: aria-pressed="${pressedAfter}"`);
      
      // Verifikasi berhasil jika pressed berubah dari false ke true
      if (pressedBefore === 'false' && pressedAfter === 'true') {
        console.log(`  [like] verifikasi: like berhasil (pressed: false → true)`);
        return { ok: true };
      } else if (pressedAfter === 'true') {
        console.log(`  [like] verifikasi: sudah ter-like (pressed: true)`);
        return { ok: true };
      } else {
        console.log(`  [like] verifikasi: status tidak berubah, kemungkinan gagal`);
        return { ok: false, reason: 'like_status_not_changed' };
      }
    } catch (verifyError) {
      console.log(`  [like] verifikasi gagal: ${verifyError.message}, anggap sukses`);
      return { ok: true }; // Assume success jika tidak bisa verifikasi
    }
  } catch (err) {
    console.error(`  [like] ERROR: ${err.message}`);
    return { ok: false, reason: 'error: ' + err.message };
  } finally {
    await context.close().catch(() => {});
  }
}

// Posting foto/video ke Instagram, memakai profile FB yang sama (yang terhubung).
async function postToInstagram(account, mediaPath, caption, opts = {}) {
  let context;
  try {
    ({ context } = await openAccountBrowser(account, { headless: false }));
  } catch (e) {
    return { ok: false, reason: explainLaunchError(e.message) };
  }
  const page = await context.newPage();
  try {
    await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded' });
    await humanDelay(3500, 5500);

    // Jika belum login, coba "Continue as Facebook".
    const loginPage = await page.locator('input[name="username"]').count().catch(() => 0) > 0;
    if (loginPage) {
      console.log(`  [ig] halaman login terdeteksi, coba login via FB...`);
      const fbLoginSelectors = [
        'div:has-text("Login dengan Facebook")',
        'div:has-text("Continue as Facebook")',
        'div:has-text("Lanjutkan sebagai Facebook")',
        'span:has-text("Login dengan Facebook")',
        'button:has-text("Continue as Facebook")',
        'button:has-text("Lanjutkan sebagai Facebook")',
        'div[role="button"]:has-text("Continue as Facebook")',
        'div[role="button"]:has-text("Lanjutkan sebagai Facebook")',
      ];
      let clicked = false;
      // Debug: log semua elemen berisi teks login FB.
      try {
        const els = await page.evaluate(() => {
          const matches = [];
          const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
          while (walker.nextNode()) {
            const n = walker.currentNode;
            if (n.childElementCount === 0 && /Login dengan Facebook|Continue as Facebook|Lanjutkan sebagai/i.test(n.textContent || '')) {
              const r = n.getBoundingClientRect();
              matches.push({ tag: n.tagName, text: (n.textContent||'').trim().slice(0,40), visible: r.width>0&&r.height>0, x: Math.round(r.x+r.width/2), y: Math.round(r.y+r.height/2), w: Math.round(r.width), h: Math.round(r.height) });
            }
          }
          return matches.slice(0, 10);
        });
        console.log(`  [ig] debug elemen login FB:`);
        els.forEach(e => console.log(`    - ${e.tag} vis=${e.visible} xy=${e.x},${e.y} size=${e.w}x${e.h} text="${e.text}"`));
        await page.screenshot({ path: debugShot('debug_ig_login.png') });
      } catch (e2) { console.log(`  [ig] debug gagal: ${e2.message}`); }
      // Prioritaskan teks "Login dengan Facebook" (bisa role=none, bukan tombol).
      const textTargets = ['Login dengan Facebook', 'Continue as Facebook', 'Lanjutkan sebagai Facebook'];
      for (const txt of textTargets) {
        try {
          const gt = page.getByText(txt, { exact: false }).last();
          if (await gt.count().catch(() => 0) > 0 && await gt.isVisible().catch(() => false)) {
            await gt.click().catch(() => {});
            clicked = true;
            console.log(`  [ig] login via FB diklik (teks: ${txt})`);
            break;
          }
        } catch (e) {}
      }
      if (!clicked) {
        for (const sel of fbLoginSelectors) {
          try {
            const loc = page.locator(sel).first();
            if ((await loc.count().catch(() => 0)) > 0) {
              await loc.click().catch(() => {});
              clicked = true;
              console.log(`  [ig] login via FB diklik: ${sel}`);
              break;
            }
          } catch (e) {}
        }
      }
      if (!clicked) {
        return { ok: false, reason: 'ig_login_needed' };
      }
      await humanDelay(3500, 5500);

      // Popup/redirect FB: karena sesi FB sudah aktif, cukup klik "Lanjutkan"/"Continue".
      const fbContinueSelectors = [
        'button[name="__CONFIRM__"]',
        'input[value*="Lanjutkan"]',
        'input[value*="Continue"]',
        'button:has-text("Lanjutkan sebagai")',
        'button:has-text("Continue as")',
        'div[role="button"]:has-text("Lanjutkan sebagai")',
        'div[role="button"]:has-text("Continue as")',
      ];
      for (const sel of fbContinueSelectors) {
        try {
          const loc = page.locator(sel).first();
          if ((await loc.count().catch(() => 0)) > 0 && await loc.isVisible().catch(() => false)) {
            await loc.click().catch(() => {});
            console.log(`  [ig] klik Lanjutkan FB: ${sel}`);
            break;
          }
        } catch (e) {}
      }
      await humanDelay(2500, 4000);
    }

    // Klik tombol "+" utk membuat postingan baru.
    // Debug: daftar SEMUA elemen dgn aria-label (temukan tombol + buat post).
    try {
      const navs = await page.evaluate(() => {
        const out = [];
        document.querySelectorAll('a[role="link"], div[role="button"], [role="button"], [aria-label]').forEach((el) => {
          const l = el.getAttribute && el.getAttribute('aria-label');
          if (l && l.trim()) {
            const href = (el.closest && el.closest('a') ? el.closest('a').href : '') || '';
            const r = el.getBoundingClientRect();
            if (r.width>0 && r.height>0) out.push({ tag: el.tagName, label: l.slice(0,40), href });
          }
        });
        return out.slice(0, 40);
      });
      console.log(`  [ig] debug semua aria-label:`);
      navs.forEach(n => console.log(`    - ${n.tag} label="${n.label}" href="${n.href}"`));
      await page.screenshot({ path: debugShot('debug_ig_create.png') });
    } catch (e) { console.log(`  [ig] debug create gagal: ${e.message}`); }

    const addSelectors = [
        'svg[aria-label="Postingan baru"]',
        'svg[aria-label="New post"]',
        'svg[aria-label="Buat postingan baru"]',
        'svg[aria-label="Create"]',
        'svg[aria-label="Buat"]',
        'a[href="/create/"]',
        'a[href="/create"]',
        'a[href="/p/"]',
      ];
    let addClicked = false;
    // 1) Coba temukan anchor yang menuju halaman buat post (/create/), paling spesifik.
    try {
      const createHref = await page.evaluate(() => {
        const a = [...document.querySelectorAll('a[href*="/create"]')].find((el) => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        });
        return a ? a.href : null;
      });
      if (createHref) {
        await page.locator(`a[href*="/create"]`).first().click().catch(() => {});
        addClicked = true;
        console.log(`  [ig] tombol buat post diklik via href: ${createHref}`);
      }
    } catch (e) {}
    // 2) Fallback: selektor lain.
    for (const sel of addSelectors) {
      try {
        if (addClicked) break;
        const loc = page.locator(sel).first();
        if ((await loc.count().catch(() => 0)) > 0) {
          await loc.click().catch(() => {});
          addClicked = true;
          console.log(`  [ig] tombol tambah diklik: ${sel}`);
          break;
        }
      } catch (e) {}
    }
    if (!addClicked) {
      return { ok: false, reason: 'ig_add_button_not_found' };
    }
    await humanDelay(1500, 2500);

    // Upload file. Terkadang muncul opsi "Upload from computer" dulu setelah klik "+".
    const uploadOptionSelectors = [
      'div[role="button"]:has-text("Upload from computer")',
      'div[role="button"]:has-text("Unggah dari komputer")',
      'div[role="button"]:has-text("From computer")',
      'button:has-text("Upload from computer")',
      'button:has-text("Dari komputer")',
      'div[role="button"]:has-text("Select from computer")',
    ];
    for (const sel of uploadOptionSelectors) {
      try {
        const loc = page.locator(sel).first();
        if ((await loc.count().catch(() => 0)) > 0 && await loc.isVisible().catch(() => false)) {
          await loc.click().catch(() => {});
          console.log(`  [ig] opsi upload diklik: ${sel}`);
          break;
        }
      } catch (e) {}
    }
    await humanDelay(800, 1500);

    // Cari input file & set file (polling hingga 20 detik).
    const fileInput = page.locator('input[type="file"]').first();
    let fileSet = false;
    const fileDeadline = Date.now() + 20000;
    while (Date.now() < fileDeadline && !fileSet) {
      try {
        if ((await fileInput.count().catch(() => 0)) > 0) {
          await fileInput.setInputFiles(mediaPath);
          fileSet = true;
          console.log(`  [ig] file di-upload.`);
          break;
        }
      } catch (e) {}
      await page.waitForTimeout(800);
    }
    if (!fileSet) {
      return { ok: false, reason: 'ig_file_input_not_found' };
    }
    await humanDelay(2500, 4000);

    // Klik tombol "Selanjutnya/Next" berulang. Banyak tahap (upload -> edit -> caption).
    for (let i = 0; i < 4; i++) {
      const nextSelectors = [
        'div[role="button"]:has-text("Selanjutnya")',
        'div[role="button"]:has-text("Next")',
        'div[role="button"]:has-text("Lanjut")',
        'div[role="button"]:has-text("Berikutnya")',
        'div[role="button"][aria-label*="Selanjutnya"]',
      ];
      let clickedAny = false;
      for (const sel of nextSelectors) {
        const loc = page.locator(sel).first();
        if ((await loc.count().catch(() => 0)) > 0 && await loc.isVisible().catch(() => false)) {
          await loc.click().catch(() => {});
          console.log(`  [ig] Next diklik (${i+1}): ${sel}`);
          clickedAny = true;
          break;
        }
      }
      if (!clickedAny) break;
      await humanDelay(1200, 2000);
    }

    // Tulis caption (opsional). Selector caption IG web.
    if (caption && caption.trim()) {
      const captionSelectors = [
        'div[aria-label*="Write a caption"] [contenteditable]',
        'div[aria-label*="Tulis keterangan"] [contenteditable]',
        'div[role="textbox"][contenteditable="true"]',
        'div[role="dialog"] [contenteditable="true"]',
        '[contenteditable="true"][aria-label*="caption" i]',
      ];
      let captionDone = false;
      for (const sel of captionSelectors) {
        try {
          const captionEl = page.locator(sel).first();
          await captionEl.waitFor({ state: 'attached', timeout: 5000 }).catch(() => {});
          if ((await captionEl.count().catch(() => 0)) > 0) {
            await captionEl.focus();
            await page.keyboard.type(caption, { delay: rand(50, 160) });
            console.log(`  [ig] caption diketik via: ${sel}`);
            captionDone = true;
            break;
          }
        } catch (e) { /* lanjut */ }
      }
      if (!captionDone) console.log(`  [ig] caption tidak terisi (opsional).`);
    } else {
      console.log(`  [ig] caption kosong, lanjut tanpa caption.`);
    }
    await humanDelay(1200, 2000);

    // Klik tombol Share/Post.
    const shareSelectors = [
      'div[role="button"]:has-text("Bagikan")',
      'div[role="button"]:has-text("Share")',
      'button:has-text("Bagikan")',
      'button:has-text("Share")',
      '[aria-label="Bagikan"][role="button"]',
    ];
    let shared = false;
    for (const sel of shareSelectors) {
      try {
        const all = page.locator(sel);
        const n = await all.count().catch(() => 0);
        // pilih yang visible & enabled (bukan disabled).
        for (let k = n - 1; k >= 0; k--) {
          const loc = all.nth(k);
          if (await loc.isVisible().catch(() => false)) {
            const disabled = await loc.getAttribute('aria-disabled').catch(() => null);
            if (disabled !== 'true') {
              await loc.click().catch(() => {});
              shared = true;
              console.log(`  [ig] Share diklik (visible#${k}): ${sel}`);
              break;
            }
          }
        }
        if (shared) break;
      } catch (e) {}
    }
    if (!shared) {
      return { ok: false, reason: 'ig_share_button_not_found' };
    }

    // Setelah klik Bagikan, JANGAN langsung tutup. Tunggu sampai posting selesai
    // diproses (modal create menutup / kembali ke feed) — bisa beberapa detik-menit.
    console.log(`  [ig] menunggu postingan selesai terproses...`);
    let postedDone = false;
    const postDeadline = Date.now() + 60000; // tunggu maks ~60 detik
    while (Date.now() < postDeadline) {
      // Indikator: modal create (dialog dgn tombol tambah) sudah tidak tampil
      // → posting selesai & kembali ke beranda.
      const createGone = await page.locator('div[role="dialog"]:has-text("Buat postingan"), div[role="dialog"]:has-text("Create new post"), div[role="dialog"]:has-text("Share")').first().isVisible().catch(() => false) === false;
      // Kadang muncul toast sukses "Berhasil dibagikan".
      const toastOk = await page.locator('text=Berhasil dibagikan, text=Your post has been shared, div[role="status"]:has-text("dibagikan")').first().count().catch(() => 0);
      if (createGone || toastOk > 0) {
        postedDone = true;
        break;
      }
      await humanDelay(3000, 5000);
    }
    if (!postedDone) {
      // Belum terlihat selesai; tetap kasih jeda sebelum tutup agar tak terpotong.
      console.log(`  [ig] masih menunggu / belum terkonfirmasi, beri jeda ekstra...`);
      await humanDelay(8000, 12000);
    }
    console.log(`  [ig] postingan selesai (${postedDone ? 'terkonfirmasi' : 'jeda aman'}).`);

    // Komentar pertama setelah kiriman terbit, sebelum browser ditutup/dibiarkan.
    let comment = null;
    let postUrl = null;
    if (opts.autoComment) {
      try {
        postUrl = await findIgPostUrlByCaption(page, account.name, caption);
        if (!postUrl) {
          comment = { ok: false, reason: 'post_not_found' };
        } else {
          comment = await require('./comment-automation').commentOnPage(page, 'ig', opts.autoComment);
          comment.url = postUrl;
        }
        console.log(`  [ig] komentar otomatis: ${comment.ok ? 'terkirim' : comment.reason}`);
      } catch (e) {
        comment = { ok: false, reason: 'error: ' + e.message };
      }
    }
    // Browser TETAP TERBUKA (kept alive) agar user bisa verifikasi posting secara manual.
    console.log(`  [ig] browser dibiarkan terbuka utk verifikasi manual.`);
    return { ok: true, comment, postUrl };
  } catch (err) {
    console.error(`  [ig] ERROR: ${err.message}`);
    try { await context.close().catch(() => {}); } catch (e) {}
    return { ok: false, reason: explainNetError(err.message) };
  }
}

// Buka Instagram dengan auto-klik "Login dengan Facebook" -> "Lanjutkan", browser
// TETAP terbuka (kept alive) agar user bisa selesaikan login & session tersimpan.
async function openIgWithLogin(account) {
  const acc = withDecryptedPassword(account);
  const { context } = await openAccountBrowser(acc, { headless: false });
  const page = await context.newPage();
  try {
    await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded' });
    await humanDelay(4000, 7000);

    // Selalu coba klik "Login dengan Facebook" bila muncul (tanpa bergantung deteksi field username).
    console.log(`  [ig-open] mencoba klik 'Login dengan Facebook'...`);
    const textTargets = ['Login dengan Facebook', 'Continue as Facebook', 'Lanjutkan sebagai Facebook'];
    let clicked = false;
    for (const txt of textTargets) {
      try {
        const gt = page.getByText(txt, { exact: false }).last();
        if (await gt.count().catch(() => 0) > 0 && await gt.isVisible().catch(() => false)) {
          await gt.click().catch(() => {});
          clicked = true;
          console.log(`  [ig-open] diklik: ${txt}`);
          break;
        }
      } catch (e) {}
    }
    if (!clicked) {
      console.log(`  [ig-open] tombol login FB tidak ditemukan.`);
    }
    await humanDelay(3500, 5500);

    // Klik Lanjutkan pada popup/redirect FB (sesi FB aktif).
    for (const sel of [
      'button[name="__CONFIRM__"]',
      'input[value*="Lanjutkan"]',
      'input[value*="Continue"]',
      'button[type="submit"]:has-text("Lanjutkan")',
    ]) {
      try {
        const loc = page.locator(sel).first();
        if ((await loc.count().catch(() => 0)) > 0 && await loc.isVisible().catch(() => false)) {
          await loc.click().catch(() => {});
          console.log(`  [ig-open] klik Lanjutkan: ${sel}`);
          break;
        }
      } catch (e) {}
    }
    await humanDelay(3000, 5000);

    console.log(`  [ig-open] Instagram dibuka (kept alive). Session tersimpan dashboard.`);
    // JANGAN tutup context — biarkan browser tetap terbuka utk user.
    return { ok: true };
  } catch (err) {
    console.error(`  [ig-open] ERROR: ${err.message}`);
    try { await context.close(); } catch (e) {}
    return { ok: false, reason: 'error: ' + err.message };
  }
}

// Like sebuah postingan Instagram via URL, memakai profile FB yang sama.
async function likeIgPosting(account, postUrl) {
  const acc = withDecryptedPassword(account);
  const { context } = await openAccountBrowser(acc, { headless: false });
  const page = await context.newPage();
  try {
    await page.goto(postUrl, { waitUntil: 'domcontentloaded' });
    await humanDelay(3500, 5500);

    // Cari tombol like IG (heart). aria-label "Suka"/"Like"/"Unlike" menunjukkan status.
    const likeSelectors = [
      'svg[aria-label="Suka"]',
      'svg[aria-label="Like"]',
      'div[role="button"] svg[aria-label="Suka"]',
      'div[role="button"] svg[aria-label="Like"]',
      'svg[aria-label="Unlike"]', // sudah ter-like lalu kita skip
    ];
    let liked = false;
    for (const sel of likeSelectors) {
      try {
        const loc = page.locator(sel).first();
        if ((await loc.count().catch(() => 0)) > 0 && await loc.isVisible().catch(() => false)) {
          // Skip jika sudah ter-like (aria-label Unlike) → anggap sukses.
          if (/Unlike|Tidak Suka/i.test(sel)) {
            console.log(`  [ig-like] postingan sudah di-like (${sel}).`);
            return { ok: true, already: true, reason: 'already_liked' };
          }
          await loc.click().catch(() => {});
          liked = true;
          console.log(`  [ig-like] diklik via: ${sel}`);
          break;
        }
      } catch (e) {}
    }
    if (!liked) {
      return { ok: false, reason: 'like_button_not_found' };
    }
    await humanDelay(1500, 2500);
    return { ok: true };
  } catch (err) {
    console.error(`  [ig-like] ERROR: ${err.message}`);
    return { ok: false, reason: 'error: ' + err.message };
  } finally {
    await context.close().catch(() => {});
  }
}

module.exports = { loginAccount, postToTimeline, likePosting, postToInstagram, openIgWithLogin, likeIgPosting, withDecryptedPassword, getAccountForAction, explainNetError, explainLaunchError };
