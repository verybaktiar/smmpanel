'use strict';

/**
 * GMAIL ACCOUNT CREATOR (FULL-AUTO EKSPERIMENTAL) — uji sejauh mana wizard signup
 * Google bisa dilewati otomatis via patchright + DataImpulse sticky Indonesia.
 *
 * Ekspektasi realistis: kemungkinan besar berhenti di layar verifikasi nomor HP
 * (Google hampir selalu minta dari IP proxy) atau challenge reCAPTCHA. Script
 * BERHENTI RAPI di tembok pertama, screenshot tiap langkah, dan menulis verdict
 * JSON ke logs/ — buang waktu minimal bila kena wall.
 *
 * Anti-detect: paritas panel — engine patchright (tanpa stealth manual, tanpa flag
 * anti-automation), geo P1 dari IP sticky (tz/locale/koordinat), UA natural headed (P2),
 * WebRTC anti-leak, typing manusiawi via typeHuman (jeda acak antar ketukan).
 *
 * Run:  node src/gmail-account-creator.js [--sid gmail-auto1] [--profile sessions/gmail-auto-1] [--gender male|female]
 * Proxy: host:port:user:pass (default DataImpulse __cr.id;sid.<sid> dari --sid)
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const http = require('http');
const { chromium } = require('patchright');
const browserUtil = require('./browser');   // parseProxy, stickyProxy, typeHuman, humanDelay, rand
const stealth = require('./stealth');       // resolveProxyGeo, geolocationOption, localeForTz
const identity = require('./id-identity');  // makeIdentity (nama/DOB/password Indonesia)

// ---- Argumen CLI ----
const argv = process.argv.slice(2);
function argVal(name) {
  const i = argv.indexOf(name);
  if (i !== -1 && argv[i + 1] && !argv[i + 1].startsWith('--')) return argv[i + 1];
  return null;
}
const has = (f) => argv.includes(f);
const SEMI = has('--semi'); // handoff: berhenti di verifikasi HP, jendela terbuka, lanjut otomatis setelah user lolos
const TETHERING = has('--tethering'); // IP seluler HP langsung (USB tethering/hotspot) — TANPA proxy; paling dipercaya Google
const HP_LABEL = (argVal('--hp') || null); // label HP utk profil & arsip: --hp hp1 → sessions/gmail-hp1
const SID = (argVal('--sid') || (TETHERING ? (HP_LABEL || 'tether') : 'gmail-auto1')).replace(/[^a-zA-Z0-9_-]/g, '-');
const PROFILE_DIR = path.resolve(argVal('--profile') || `sessions/gmail-${SID}`);
const SHOTS_DIR = path.join(PROFILE_DIR, 'shots');
// Tethering = TANPA proxy (traffic lewat SIM di HP); mode farm = DataImpulse sticky.
const PROXY_STR = TETHERING
  ? null
  : browserUtil.stickyProxy(
      argv.find((a, i) => !a.startsWith('--') && !(argv[i - 1] || '').startsWith('--')) ||
      'gw.dataimpulse.com:823:3075a7ad6bdec8af6597:c1c5eef4de4fbac0',
      SID
    );

const { rand, humanDelay, typeHuman } = browserUtil;
const BULAN_ID = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];

// ---- Util kecil ----
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function shot(page, label, stepNo) {
  const file = path.join(SHOTS_DIR, `step-${String(stepNo).padStart(2, '0')}-${label}.png`);
  await page.screenshot({ path: file }).catch(() => {});
  return file;
}
function out(msg) { console.log(`[${new Date().toLocaleTimeString('id-ID')}] ${msg}`); }

// IP publik aktual — tethering: direct (ipify https); farm: absolute-form via proxy.
function exitIpDirect() {
  return new Promise((resolve) => {
    require('https').get('https://api.ipify.org?format=json', { timeout: 8000 }, (res) => {
      let b = ''; res.on('data', (c) => { b += c; }); res.on('end', () => { try { resolve(JSON.parse(b).ip || null); } catch (e) { resolve(null); } });
    }).on('timeout', function () { this.destroy(); resolve(null); }).on('error', () => resolve(null));
  });
}

// Klik tombol pertama yang visible+enabled dari daftar kandidat selector/teks.
async function tryClickAny(page, candidates) {
  for (const sel of candidates) {
    const locs = page.locator(sel);
    const n = await locs.count().catch(() => 0);
    for (let i = 0; i < n; i++) {
      const el = locs.nth(i);
      try {
        if (!(await el.isVisible()) || !(await el.isEnabled())) continue;
        await el.click({ timeout: 3000 });
        return true;
      } catch (e) { /* lanjut kandidat berikutnya */ }
    }
  }
  return false;
}
async function firstVisible(page, selectors) {
  for (const sel of selectors) {
    const locs = page.locator(sel);
    const n = await locs.count().catch(() => 0);
    for (let i = 0; i < n; i++) {
      const el = locs.nth(i);
      try { if (await el.isVisible()) return el; } catch (e) { /* lanjut */ }
    }
  }
  return null;
}
async function bodyTextHas(page, needles) {
  try {
    const txt = (await page.locator('body').innerText({ timeout: 4000 })).toLowerCase();
    return needles.find((w) => txt.includes(w.toLowerCase())) || null;
  } catch (e) { return null; }
}
// Inventaris field input/select/listbox — diagnosis selector tanpa perlu baca screenshot.
async function dumpFields(page, tag) {
  const inv = await page.evaluate(() => Array.from(document.querySelectorAll('input,select,[role="listbox"]')).map((el) => ({
    t: el.tagName.toLowerCase() + (el.getAttribute('role') ? ':' + el.getAttribute('role') : ''),
    id: el.id || undefined, name: el.getAttribute('name') || undefined,
    aria: el.getAttribute('aria-label') || undefined, ph: el.placeholder || undefined
  })));
  out(`   FIELDS[${tag}]: ${JSON.stringify(inv)}`);
  return inv;
}
// Pilih opsi di <select> native ATAU dropdown custom (role=listbox — wizard baru Google).
async function pickListOrSelect(page, loc, value, labels) {
  try { await loc.selectOption(String(value), { timeout: 2500 }); return true; } catch (e) { /* bukan select */ }
  try { await loc.selectOption({ label: labels[0] }, { timeout: 2500 }); return true; } catch (e) { /* lanjut */ }
  try {
    await loc.click({ timeout: 2500 });
    await humanDelay(400, 900);
    for (const lbl of labels) {
      const opt = page.locator(`[role="option"]:has-text("${lbl}")`).first();
      if (await opt.isVisible({ timeout: 3000 }).catch(() => false)) { await opt.click({ timeout: 3000 }); return true; }
    }
    await page.keyboard.press('Escape').catch(() => {});
  } catch (e) { /* tak bisa */ }
  return false;
}
// IP exit via absolute-form HTTP (ip-api — HTTP murni, ipify 301 lewat proxy).
function exitIp(proxyObj) {
  return new Promise((resolve) => {
    const req = http.request({
      host: proxyObj.server.replace(/^https?:\/\//, '').split(':')[0],
      port: +(proxyObj.server.match(/:(\d+)$/) || [])[1] || 80,
      path: 'http://ip-api.com/json/?fields=query,country,city',
      headers: { 'Proxy-Authorization': 'Basic ' + Buffer.from(`${proxyObj.username}:${proxyObj.password || ''}`).toString('base64') },
      timeout: 8000
    }, (res) => { let b = ''; res.on('data', (c) => { b += c; }); res.on('end', () => { try { resolve(JSON.parse(b)); } catch (e) { resolve(null); } }); });
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.on('error', () => resolve(null));
    req.end();
  });
}

// ---- Klasifikasi langkah wizard (return 'nama' | 'dob' | 'email' | ... ) ----
async function classify(page) {
  const url = page.url();
  if (/\/welcome|myaccount\.google\.com/.test(url)) return 'welcome';
  if (await firstVisible(page, ['input[name="firstName"], #firstName'])) return 'nama';
  if (await firstVisible(page, ['input[name="day"], #day, [aria-label="Hari"], input[aria-label="Day"]'])) return 'dob';
  if (await firstVisible(page, ['input[name="Passwd"], #passwd, input[aria-label="Masukkan sandi"], input[type="password"][aria-label*="andi"]'])) return 'password';
  if (await bodyTextHas(page, ['alamat gmail itu sudah dipakai', 'sudah digunakan', 'that username is taken', 'is already taken', 'karakter telah dimasukkan', 'maximum characters', 'gunakan setidaknya', 'try other usernames', 'coba nama pengguna lain'])) return 'email-taken';
  if (/steps\/signup\/username/.test(url) ||
      await firstVisible(page, ['input[name="Username"], #usernameId', 'input[name="usernameRadio"]'])) return 'username';
  if (await firstVisible(page, ['input[name="recoveryEmailId"], input[aria-label="Email pemulihan"]']) ||
      (await bodyTextHas(page, ['email pemulihan', 'recovery email']) && !/verifikasi/.test(url))) return 'recovery';
  if (await firstVisible(page, ['input[name="phoneNumber"], #phoneNumberId, input[aria-label*="elepon"], input[aria-label*="hone number"]'])) return 'phone';
  if (/verification|verifikasi/.test(url) ||
      await bodyTextHas(page, ['verifikasi nomor telepon', 'verify your phone', 'tambahkan nomor telepon', 'add phone number',
        'verifikasi beberapa info', 'perlu memverifikasi', 'verify some information'])) return 'phone';
  if (await bodyTextHas(page, ['periksa dan buat', 'confirm your account details', 'tinjau'])) return 'review';
  if (await bodyTextHas(page, ['saya setuju', 'i agree', 'privasi dan persyaratan', 'privacy and terms'])) return 'tos';
  if (await bodyTextHas(page, ['ya, saya ikut', 'tidak, terima kasih', "yes, i'm in", 'no thanks'])) return 'personalisasi';
  if (await bodyTextHas(page, ['konfirmasi bahwa anda bukan robot', 'unusual traffic', 'lalu lintas tidak biasa', 'confirm you', 'not a robot'])) return 'captcha';
  return 'unknown';
}

// ---- Aksi per langkah ----
async function stepNama(page, id) {
  const f = await firstVisible(page, ['input[name="firstName"], #firstName']);
  const l = await firstVisible(page, ['input[name="lastName"], #lastName']);
  if (!f || !l) return false;
  await typeHuman(f, id.first);
  await humanDelay(400, 900);
  await typeHuman(l, id.last);
  await humanDelay(700, 1500);
  return tryClickAny(page, ['button:has-text("Lanjutkan")', 'button:has-text("Berikutnya")', 'button:has-text("Next")']);
}
async function stepDob(page, id) {
  // Selector longgar: id/name klasik + aria-label parsial (label wizard baru bisa "Hari (DD)" dsb).
  const day = await firstVisible(page, ['input[name="day"], #day', 'input[aria-label*="Hari"]', 'input[aria-label*="Day"]', 'input[placeholder*="Hari"]', 'input[placeholder*="DD"]']);
  const mon = await firstVisible(page, ['select[name="month"], #month', 'select[aria-label*="Bulan"]', '[role="listbox"][aria-label*="Bulan"]', 'select[aria-label*="Month"]', '[role="listbox"][aria-label*="Month"]']);
  const yr = await firstVisible(page, ['input[name="year"], #year', 'input[aria-label*="Tahun"]', 'input[aria-label*="Year"]', 'input[placeholder*="Tahun"]', 'input[placeholder*="YYYY"]']);
  let gen = await firstVisible(page, ['select[name="gender"], #gender', 'select[aria-label*="ender"]', '[role="listbox"][aria-label*="ender"]', 'select[aria-label*="Jenis"]', '[role="listbox"][aria-label*="Jenis"]']);
  if (!gen) {
    // Wizard baru: gender = listbox "pasangan" Bulan (halaman dob punya 2 dropdown).
    // Tambah juga varian radio group.
    try {
      const infos = await page.evaluate(() => Array.from(document.querySelectorAll('[role="listbox"], select')).map((el) => ({ aria: (el.getAttribute('aria-label') || '').toLowerCase(), id: (el.id || '').toLowerCase() })));
      for (let idx = 0; idx < infos.length; idx++) {
        if (/bulan|month/.test(infos[idx].aria) || /month|bul/.test(infos[idx].id)) continue;
        const cand = page.locator('[role="listbox"], select').nth(idx);
        if (await cand.isVisible().catch(() => false)) { gen = cand; out('   gender = listbox pasangan (index ' + idx + ', aria="' + infos[idx].aria + '")'); break; }
      }
    } catch (e) { /* coba jalur radio */ }
  }
  if (!day || !mon || !yr) { await dumpFields(page, 'dob-missing'); return false; }
  await typeHuman(day, id.birthdate.day);
  await humanDelay(300, 700);
  if (!(await pickListOrSelect(page, mon, +id.birthdate.month, [BULAN_ID[+id.birthdate.month - 1]]))) { await dumpFields(page, 'dob-month'); return false; }
  await humanDelay(300, 700);
  await typeHuman(yr, id.birthdate.year);
  if (gen) {
    await humanDelay(300, 700);
    // KOSAKATA TERUKUR (probe DOM 4/10): opsi wizard = "Wanita", "Pria", "Kustom",
    // "Tidak ingin memberi tahu" — BUKAN "Perempuan/Laki-laki". Nilai select 2/1 dicoba
    // dulu utk select native; label Pria/Wanita untuk dropdown custom Material.
    const okGen = await pickListOrSelect(page, gen, id.gender === 'male' ? 2 : 1,
      id.gender === 'male' ? ['Pria', 'Laki-laki', 'Male'] : ['Wanita', 'Perempuan', 'Female']);
    if (!okGen) {
      const okRadio = await tryClickAny(page, ['[role="radio"]:has-text("' + (id.gender === 'male' ? 'Pria' : 'Wanita') + '")']);
      out('   gender: listbox=' + okGen + ', radio=' + okRadio);
    }
  } else {
    out('   gender control TIDAK ditemukan — coba jalur radio…');
    await tryClickAny(page, ['[role="radio"]:has-text("' + (id.gender === 'male' ? 'Pria' : 'Wanita') + '")']);
  }
  await humanDelay(800, 1600);
  return tryClickAny(page, ['button:has-text("Lanjutkan")', 'button:has-text("Berikutnya")', 'button:has-text("Next")']);
}
async function stepUsername(page, id) {
  // Halaman ini RADIO GROUP (terukur via probe): saran alamat (usernameRadio) +
  // radio value="custom" ("Buat alamat Gmail…") + "Gunakan email yang sudah Anda miliki"
  // (JANGAN). PRIORITAS: saran Google dulu (selalu valid & tersedia) — 2 run beruntun
  // membuktikan custom input sering ditolak diam-diam (mis. underscore tidak diizinkan).
  const gwan = await firstVisible(page, ['input[name="Username"], #usernameId']);
  const radios = await page.evaluate(() => Array.from(document.querySelectorAll('input[name="usernameRadio"]'))
    .filter((el) => !['custom', 'existing', 'reuse'].includes(String(el.value).toLowerCase()))
    .map((el) => ({ val: el.value, vis: !!el.offsetParent || (el.offsetWidth > 0 && el.offsetHeight > 0) })));
  const pick = radios.find((r) => r.vis && r.val);
  if (pick && pick.val.length >= 6) { // saran terlalu pendek = identitas terlalu generik → coba custom
    const loc = page.locator(`input[name="usernameRadio"][value="${pick.val}"]`).first();
    await loc.click({ force: true, timeout: 3000 }).catch(() => {});
    id.username = pick.val;
    result.identity.username = pick.val;
    result.identity.email = `${pick.val}@gmail.com`;
    out(`   pakai saran Google: ${pick.val}@gmail.com`);
    await humanDelay(600, 1200);
    return tryClickAny(page, NEXT_SELS);
  }
  // Fallback custom: underscore tidak diizinkan Gmail (terukur) → konversi ke titik.
  const custom = await firstVisible(page, ['input[name="usernameRadio"][value="custom"]']);
  if (custom) {
    const clicked = await tryClickAny(page, [
      'label:has(input[value="custom"])',
      '[role="radio"]:has-text("Buat alamat Gmail")',
      ':text("Buat alamat Gmail")',
      'input[value="custom"]'
    ]);
    out('   radio custom diklik: ' + clicked);
    await humanDelay(1200, 2200);
  }
  const uin = gwan || await firstVisible(page, ['input[name="Username"], #usernameId']);
  if (uin) {
    const uname = id.username.replace(/_/g, '.');
    if (uname !== id.username) {
      id.username = uname;
      result.identity.username = uname;
      result.identity.email = `${uname}@gmail.com`;
      out(`   username dikonversi utk Gmail: ${uname}@gmail.com (underscore → titik)`);
    }
    await uin.click().catch(() => {});
    await uin.fill('').catch(() => {});
    await typeHuman(uin, id.username);
    await humanDelay(1500, 2500);
    return tryClickAny(page, NEXT_SELS);
  }
  return false;
}
async function stepPassword(page, id) {
  const p1 = await firstVisible(page, ['input[name="Passwd"], #passwd']);
  const p2 = await firstVisible(page, ['input[name="ConfirmPasswd"], #confirm-passwd']);
  if (!p1) return false;
  await typeHuman(p1, id.password);
  if (p2) { await humanDelay(400, 900); await typeHuman(p2, id.password); }
  await humanDelay(700, 1500);
  return tryClickAny(page, NEXT_SELS);
}
async function stepRecovery(page) {
  // Halaman opsional — selalu lewati (recovery = footprint antar akun farm).
  if (await tryClickAny(page, ['button:has-text("Lewati")', 'button:has-text("Skip")', 'button:has-text("Not now")'])) return true;
  return tryClickAny(page, NEXT_SELS); // kalau tak ada tombol lewati, coba next (biasanya tak ada)
}
async function stepPhone(page) {
  // Halaman challenge pra-buat (mophoneverification) butuh waktu render — beri 8 dtk,
  // lalu cek tombol lewati. Tanpa lewati = TEMBOK (butuh nomor HP/perangkat asli).
  await sleep(8000);
  const skipped = await tryClickAny(page, ['button:has-text("Lewati")', 'button:has-text("Skip")', 'button:has-text("Not now")', 'button:has-text("Tidak, terima kasih")']);
  if (skipped) { out('Halaman verifikasi punya tombol lewati — dilewati.'); return 'skipped'; }
  return 'wall';
}
async function stepReview(page) {
  return tryClickAny(page, ['button:has-text("Lanjutkan")', 'button:has-text("Berikutnya")', 'button:has-text("Next")']);
}
async function stepTos(page) {
  const cb = await firstVisible(page, ['[role="checkbox"]', 'input[type="checkbox"]']);
  if (cb) { await cb.click({ timeout: 3000 }).catch(() => {}); await humanDelay(600, 1200); }
  return tryClickAny(page, ['button:has-text("Saya setuju")', 'button:has-text("I agree")']);
}
async function stepPersonalisasi(page) {
  return tryClickAny(page, ['button:has-text("Tidak, terima kasih")', 'button:has-text("No thanks")', 'button:has-text("Skip")']);
}

const NEXT_SELS = ['button:has-text("Lanjutkan")', 'button:has-text("Berikutnya")', 'button:has-text("Next")'];

// ---- State global (dipakai helper step, mis. stepUsername saat fallback saran) ----
const result = { engine: 'patchright', sid: SID, profile: PROFILE_DIR, startedAt: new Date().toISOString(), identity: null, proxy: PROXY_STR, steps: [], shots: [], verdict: null };

// ---- Main ----
(async () => {
  fs.mkdirSync(SHOTS_DIR, { recursive: true });
  const t0 = Date.now();
  const proxyObj = TETHERING ? null : browserUtil.parseProxy(PROXY_STR);
  const id = identity.makeIdentity(has('--gender') ? argVal('--gender') : undefined);
  result.identity = { ...id, email: `${id.username}@gmail.com` };

  console.log('GMAIL CREATOR (FULL-AUTO EKSPERIMENTAL) — patchright', SEMI ? '+ MODE SEMI (handoff verifikasi HP)' : '', TETHERING ? '+ TETHERING ' + (HP_LABEL ? '(HP: ' + HP_LABEL + ')' : '') : '');
  console.log('IDENTITAS        :', id.name, `(${id.gender})`, '| DOB', id.birthdate.day + '/' + id.birthdate.month + '/' + id.birthdate.year);
  console.log('EMAIL DITUJU     :', `${id.username}@gmail.com`, '| PASS:', id.password);
  console.log('PROFIL           :', PROFILE_DIR, TETHERING ? '| SUMBER IP: seluler HP (tanpa proxy)' : '| SID: ' + SID);

  // P1 — geo dari IP: tethering = lookup IP publik langsung; farm = lookup via proxy.
  let geo = null;
  if (TETHERING) {
    const ip = await exitIpDirect();
    if (ip) { try { geo = await stealth.lookupIpGeo(ip); } catch (e) { /* fallback bawah */ } }
    if (!geo) geo = { country: 'ID', timezone: 'Asia/Jakarta', city: HP_LABEL || 'Indonesia', latitude: -6.2088, longitude: 106.8456 };
    result.geo = { ip, geo, sumber: 'tethering' };
    console.log(`GEO              : ${ip || 'ip?'} | tz ${geo.timezone} | (IP seluler HP — jangan dihitung ulang tiap run)`);
  } else {
    try { geo = await stealth.resolveProxyGeo(PROXY_STR); } catch (e) { /* fallback bawah */ }
    const ipInfo = await exitIp(proxyObj);
    console.log(`GEO              : ${ipInfo ? ipInfo.query + ' ' + ipInfo.city + ', ' + ipInfo.country : 'ip?'} | tz ${geo ? geo.timezone : '?'}`);
    result.geo = { geo, ip: ipInfo };
  }

  const tz = (geo && geo.timezone) || 'Asia/Jakarta';
  const ctxOpts = { locale: stealth.localeForTz(tz), timezoneId: tz, ignoreHTTPSErrors: true };
  const geoOpt = stealth.geolocationOption(geo);
  if (geoOpt) ctxOpts.geolocation = geoOpt; // permission tetap "ask"

  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    ...(proxyObj ? { proxy: proxyObj } : {}),
    args: ['--no-first-run', '--no-default-browser-check', '--no-sandbox', '--disable-dev-shm-usage', '--force-webrtc-ip-handling-policy=disable_non_proxied_udp'],
    ...ctxOpts
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15000); // batasi SEMUA aksi (klik/screenshot) — QR page terus polling, aksi bisa gantung 30 dtk

  let stepNo = 0;
  let lastUnknownText = '';
  try {
    await page.goto('https://accounts.google.com/signup', { timeout: 60000, waitUntil: 'domcontentloaded' });
    await humanDelay(3000, 5000);

    const MAX_ROUNDS = 30; // halaman username bisa bandel (banyak varian ditolak) — beri ruang + adopsi "Tersedia:"
    let lastKey = '', lastDumpedKey = '';
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const step = await classify(page);
      stepNo++;
      out(`STEP ${stepNo} → ${step} (${page.url().slice(0, 90)})`);

      // Deteksi stuck: URL+step sama dgn putaran sebelumnya → cetak pesan error halaman
      // + inventaris field (nilai terisi?), supaya penyebab validasi kelihatan di log.
      const key = page.url() + '|' + step;
      if (key === lastKey && key !== lastDumpedKey) {
        lastDumpedKey = key;
        const body = await page.locator('body').innerText({ timeout: 4000 }).catch(() => '');
        const lines = body.split('\n').map((s) => s.trim()).filter((s) => s && s.length < 120);
        const errLines = lines.filter((s) => /isi kolom|wajib|pilih|masukkan|invalid|tidak valid|error|harus|required|tolong|tanggal lahir|gender|bulan|tahun|hari|maksimum|karakter|gunakan|sudah|dipakai|tersedia/i.test(s));
        out(`   STUCK — kandidat pesan validasi: ${JSON.stringify(errLines.slice(0, 10))}`);
        // Adopsi saran "Tersedia:<nama>" dari Google (dijamin tersedia) — hindari kalah
        // lomba varian acak saat username utama sudah padat.
        const mSug = body.match(/Tersedia[:\s]*([a-zA-Z0-9.]{4,30})/i);
        if (mSug && (step === 'username' || step === 'email-taken')) {
          id.username = mSug[1];
          result.identity.username = mSug[1];
          result.identity.email = `${mSug[1]}@gmail.com`;
          out(`   adopsi saran tersedia dari Google: ${mSug[1]}@gmail.com`);
        }
        // Kartu form utama: teks penuh (tampilkan saran/opsi yang tersedia).
        const card = await page.evaluate(() => {
          const el = document.querySelector('[role="main"], form, .FxYi0e, [jsname="WiEfjd"]');
          return el ? (el.innerText || '').replace(/\s+/g, ' | ').slice(0, 500) : '';
        });
        if (card) out(`   STUCK — kartu form: "${card}"`);
        const vals = await page.evaluate(() => Array.from(document.querySelectorAll('input,select')).map((el) => ({ id: el.id || undefined, name: el.getAttribute('name') || undefined, val: (el.value || '').slice(0, 30) || undefined, sel: el.tagName === 'SELECT' ? el.selectedIndex : undefined })));
        out(`   STUCK — nilai field: ${JSON.stringify(vals.filter((v) => v.val !== undefined || v.sel !== undefined))}`);
        result.steps.push({ step: 'stuck-' + step });
      }
      lastKey = key;

      if (step === 'welcome') {
        result.verdict = 'created';
        result.shots.push(await shot(page, 'welcome', stepNo));
        out('🎉 AKUN BERHASIL DIBUAT — layar welcome/myaccount tercapai.');
        break;
      }
      if (step === 'phone') {
        const ph = await stepPhone(page);
        if (ph === 'skipped') { result.steps.push({ step: 'phone-skipped' }); result.shots.push(await shot(page, 'phone-skipped', stepNo)); await humanDelay(2000, 4000); continue; }
        if (SEMI) {
          // HANDOFF — jendela dibiarkan terbuka; user isi nomor + kode SMS manual.
          result.shots.push(await shot(page, 'phone-handoff', stepNo));
          result.steps.push({ step: 'phone-handoff' });
          out('🖐  HANDOFF: silakan selesaikan VERIFIKASI di jendela browser (isi nomor HP + kode SMS).');
          out('    Skrip MEMANTAU dan akan melanjutkan otomatis begitu verifikasi lolos (maks 20 menit).');
          out('    Jangan tutup jendela browser.');
          let handed = false;
          for (let i = 0; i < 240; i++) { // 240 × 5 dtk = 20 menit
            await sleep(5000);
            const u2 = page.url();
            // Syarat WAJIB: keluar dari path verifikasi (DOM halaman verifikasi masih
            // menyimpan input password lama → klasifikasi bisa terpicu palsu).
            if (/verification|verifikasi/i.test(u2)) continue;
            let s2 = null;
            try { s2 = await classify(page); } catch (e) { continue; }
            const nextSteps = ['welcome', 'review', 'tos', 'personalisasi', 'username', 'recovery', 'email-choice'];
            if (nextSteps.includes(s2) || (s2 === 'password' && !/verification/i.test(u2))) {
              out(`✓ Verifikasi lolos — skrip lanjut otomatis (langkah berikut: ${s2}).`);
              handed = true;
              break;
            }
            if (i > 0 && i % 24 === 0) out(`   (masih menunggu verifikasi… ${Math.round(i / 12)} menit)`);
          }
          if (!handed) {
            result.verdict = 'phone_wall_timeout';
            result.wallNote = 'Handoff verifikasi HP tidak diselesaikan dalam 20 menit.';
            result.shots.push(await shot(page, 'phone-handoff-timeout', stepNo));
            out('⏱ Timeout handoff — berhenti.');
            break;
          }
          continue; // kembali ke loop utama — langkah pasca-verifikasi otomatis
        }
        result.verdict = 'phone_wall';
        result.shots.push(await shot(page, 'phone-wall', stepNo));
        result.wallNote = 'Google meminta verifikasi nomor HP tanpa tombol lewati — hambatan ekspektasi utama.';
        out('⛔ TEMBOK: WAJIB VERIFIKASI NOMOR HP (tanpa tombol lewati). Berhenti rapi.');
        break;
      }
      if (step === 'captcha') {
        result.verdict = 'captcha_wall';
        result.shots.push(await shot(page, 'captcha-wall', stepNo));
        result.wallNote = 'Challenge anti-robot muncul — jangan dipaksa, IP/sesi dianggap mencurigakan.';
        out('⛔ TEMBOK: CHALLENGE ANTI-ROBOT. Berhenti rapi.');
        break;
      }
      if (step === 'email-taken') {
        out('Username ditolak Google — regenerasi varian baru…');
        id.username = identity.makeUsername(id.first, id.last);
        result.identity.username = id.username;
        result.identity.email = `${id.username}@gmail.com`;
        result.steps.push({ step: 'email-taken', newUsername: id.username });
        result.shots.push(await shot(page, 'email-taken', stepNo));
        // tetap di halaman email-own — lanjutkan loop, step berikutnya akan mengisi ulang
        await humanDelay(1000, 2000);
        continue;
      }
      if (step === 'unknown') {
        // Halaman mungkin masih loading — tunggu sabar sebelum putusan.
        await sleep(8000);
        const body = await page.locator('body').innerText({ timeout: 4000 }).catch(() => '');
        if (body !== lastUnknownText) {
          lastUnknownText = body;
          out(`   (halaman tidak dikenali — sample: "${body.replace(/\s+/g, ' ').slice(0, 140)}")`);
        }
        result.shots.push(await shot(page, 'unknown', stepNo));
        const unknownStreak = result.steps.filter((s) => s.step === 'unknown').length;
        result.steps.push({ step: 'unknown' });
        if (unknownStreak >= 3) {
          result.verdict = 'unknown_wall';
          result.wallNote = 'Halaman tidak dikenali 3x beruntun — lihat screenshot di ' + SHOTS_DIR;
          out('⛔ Halaman tidak dikenali berulang — berhenti. Cek screenshots.');
          break;
        }
        await tryClickAny(page, NEXT_SELS);
        await humanDelay(2500, 4000);
        continue;
      }

      const actions = { nama: stepNama, dob: stepDob, username: stepUsername, password: stepPassword, recovery: stepRecovery, review: stepReview, tos: stepTos, personalisasi: stepPersonalisasi };
      const fn = actions[step];
      if (!fn) { await humanDelay(2000, 3000); continue; }
      let acted = false;
      try {
        acted = await fn(page, id);
      } catch (e) {
        // Error satu langkah TIDAK boleh membunuh run (halaman QR/verifikasi sering churn) —
        // laporkan, lanjut putaran berikutnya.
        out(`   (aksi ${step} error: ${(e.message || '').split('\n')[0]} — ulangi putaran berikutnya)`);
        result.steps.push({ step: 'error-' + step, err: (e.message || '').split('\n')[0] });
        await humanDelay(2500, 4000);
        continue;
      }
      result.steps.push({ step, acted: !!acted });
      result.shots.push(await shot(page, step, stepNo));
      if (!acted && step !== 'personalisasi') out(`   (aksi ${step} tidak tereksekusi — coba lagi putaran berikutnya)`);
      await humanDelay(2500, 4500); // transisi wizard via proxy bisa lambat — hindari dobel isi
    }

    if (!result.verdict) { result.verdict = 'max_rounds'; result.wallNote = 'Batas ' + stepNo + ' langkah tercapai tanpa verdict.'; }
  } catch (e) {
    result.verdict = 'error';
    result.error = (e.message || '').split('\n')[0];
    out('ERROR: ' + result.error);
    result.shots.push(await shot(page, 'error', stepNo).catch(() => null));
  }

  // Arsip: cookie snapshot + hasil.
  try {
    const cookies = await context.cookies();
    fs.writeFileSync(path.join(PROFILE_DIR, 'manual-1.json'), JSON.stringify({ proxy: PROXY_STR || `tethering:${HP_LABEL || 'langsung'}`, engine: 'patchright', savedAt: new Date().toISOString(), cookies }, null, 2));
    result.cookiesCount = cookies.length;
  } catch (e) { /* abaikan */ }
  result.finishedAt = new Date().toISOString();
  result.durationSec = Math.round((Date.now() - t0) / 1000);
  const outFile = path.join('logs', `gmail-fullauto-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(outFile, JSON.stringify(result, null, 2));
  console.log(`\nVERDICT          : ${result.verdict}`);
  if (result.wallNote) console.log('CATATAN          :', result.wallNote);
  console.log('HASIL JSON       :', outFile);
  console.log('SCREENSHOTS      :', SHOTS_DIR);
  console.log('IDENTITAS (arsip):', JSON.stringify(result.identity));

  try { await context.close(); } catch (e) { /* abaikan */ }
  process.exit(0);
})().catch((e) => { console.error('FATAL:', (e.message || '').split('\n')[0]); process.exit(1); });
