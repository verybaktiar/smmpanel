'use strict';

/**
 * IG Account Creator — captcha MANUAL, sisanya otomatis.
 * Alur: inbox Ammail -> isi form -> birthday -> submit ->
 *   JEDA: user klik captcha "I'm not a robot" di browser (bot nunggu max 10 mnt,
 *   otomatis lanjut begitu captcha hilang/tercentang) ->
 *   klik Next -> kode OTP email otomatis -> simpan session.
 * Run: node src/ig-account-creator.js [proxy] [--mobile]
 *   proxy format: host:port:user:pass
 *   Dry-run (TANPA buat akun): IG_DRY_RUN=1 node src/ig-account-creator.js [proxy] --mobile
 *     - mobile  : berhenti di layar terms "Saya setuju" (tidak diklik) + bukti ig-dryrun-terms.png
 *     - desktop : form + ultah terisi, berhenti SEBELUM submit + bukti ig-dryrun-form.png
 */

require('dotenv').config();
const { chromium } = require('patchright'); // engine panel: patchright (drop-in playwright)
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ARGS = process.argv.slice(2).filter((a) => a !== '--keep-open' && a !== '--mobile');
// PROXY mentah dari argumen lalu di-sticky-kan per attempt (sid unik di bawah) —
// hasil akhirnya masuk PROXY_ARG yang kepakai seluruh run.
const RAW_PROXY = ARGS[0] || null;
// Mode daftar via NOMOR HP (--phone-signup): wizard IG dijalankan lewat opsi
// "Daftar dengan nomor ponsel" — TANPA email/gmail/temp-mail. Nomornya tidak lewat
// argumen: operator mengetiknya di panel saat worker mencetak [PHONE_REQUIRED]
// (pola sama dgn kartu OTP). Sandi/nama/username/ultah tetap dari generator.
const PHONE_SIGNUP = ARGS.includes('--phone-signup');
// Gmail stok (opsi --gmail-id N): pakai Gmail pool sbg email pendaftar IG — konsep
// disamakan dgn FB create. Bila gmail tidak ada/gagal baca, fallback temp-mail otomatis.
const GMAIL_ID_ARG = (() => {
  const i = ARGS.indexOf('--gmail-id');
  return i !== -1 ? Number(ARGS[i + 1]) : null;
})();
// Email manual dari panel (--email a@domain.tld): operator ketik alamatnya sendiri
// (bukan Gmail stok, bukan temp-mail). Kode verifikasi tidak bisa dibaca bot dari
// inbox tak dikenal — OTP via kartu operator, pola sama dgn Gmail stok.
const MANUAL_EMAIL_ARG = (() => {
  const i = ARGS.indexOf('--email');
  const v = i !== -1 ? String(ARGS[i + 1] || '').trim().toLowerCase() : '';
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? v : null;
})();
// STICKY PER ATTEMPT (paritas fb-create-run + prinsip "1 akun = 1 IP"): proxy
// DataImpulse dari dropdown panel selalu string yang sama, jadi guard per-proxy
// menghitung attempt lama yang sebenarnya sudah beda IP keluar. Setiap attempt
// diberi sid unik supaya DataImpulse meminjamkan kartu (IP) baru — kartu yang
// sudah terpakai signup tidak dipakai ulang. Proxy bukan DataImpulse atau yang
// sudah membawa param '__' diteruskan apa adanya.
const attemptSid = RAW_PROXY && /dataimpulse/i.test(RAW_PROXY) && !RAW_PROXY.includes('__')
  ? 'ig-' + Date.now()
  : null;
const PROXY_ARG = attemptSid
  ? require('./browser').stickyProxy(RAW_PROXY, attemptSid)
  : RAW_PROXY;
if (attemptSid) console.log('[SID] kunci sesi ini: sid.' + attemptSid + ' (IP lahir akan mengikuti kartu ini)');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
// Mail Worker (Cloudflare) — adaptor CJS di lib/mail-worker (copy _extract TIDAK diubah).
const { MailWorkerClient } = require('../lib/mail-worker');
const { extractOtp } = require('../lib/mail-worker/otp');
const mailWorker = new MailWorkerClient();

// BULK paralel: bila env IG_BULK_RUN=n terisi, result file jadi PER-RUN
// (last-create-ig-bulk<n>.json) — N browser jalan serentak menulis file yang sama
// pasti saling timpa. Run tunggal (env kosong) tetap pakai last-create-ig.json.
const BULK_RUN_N = Number(process.env.IG_BULK_RUN || '0') || null;
const RESULT_FILE_NAME = BULK_RUN_N ? `last-create-ig-bulk${BULK_RUN_N}.json` : 'last-create-ig.json';
const writeResultFile = (payload) => {
  try {
    fs.mkdirSync(path.join(__dirname, '..', 'sessions'), { recursive: true });
    fs.writeFileSync(path.join(__dirname, '..', 'sessions', RESULT_FILE_NAME), JSON.stringify(payload, null, 2));
  } catch (e) { /* non-fatal */ }
};

function parseProxy(str) {
  if (!str) return null;
  let raw = str.trim();
  // Buang http:// bila ikut ditempel (format user:pass tanpa @).
  // Format URL user:pass@host dibiarkan utuh.
  if (!raw.includes('@')) raw = raw.replace(/^\w+:\/\//, '');
  const m = raw.match(/^(socks[45]?|https?|http):\/\/(?:([^:@]+):([^@]+)@)?([^:]+):(\d+)$/i);
  if (m) {
    const proxy = { server: `${m[1]}://${m[4]}:${m[5]}` };
    if (m[2]) { proxy.username = m[2]; proxy.password = m[3]; }
    return proxy;
  }
  const p = raw.split(':');
  if (p.length >= 2) {
    const proxy = { server: `http://${p[0]}:${p[1]}` };
    if (p[2]) proxy.username = p[2];
    if (p[3]) proxy.password = p[3];
    return proxy;
  }
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
  m = /\b([0-9]{4,8})\s+is your \w+ confir/i.exec(hay) || /^\s*([0-9]{4,8})\b/m.exec(subject || '');
  if (m) return m[1];
  m = /\b([0-9]{5,6})\b/.exec((subject || '') + '\n' + (text || ''));
  return m ? m[1] : '';
}

(async () => {
  const result = { status: 'failed', email: null, username: null, error: null, steps: [] };
  const step = (name, ok, msg) => {
    result.steps.push({ name, ok, msg: (msg || '').slice(0, 160) });
    console.log(`${ok ? 'OK ' : '....'} ${name} ${msg || ''}`);
  };
  let browser = null;
  let context = null;

  try {
    // 0. Identitas dulu (email diturunkan dari nama — lihat di bawah).
    const idn = require('./id-identity').makeIdentity();

    // 1. Email pendaftar — Gmail stok bila diminta, kalau tidak temp-mail Mail Worker.
    let alias = null;
    let stockGmail = null;
    let markStockGmailUsed = () => {}; // diisi jalur Gmail stok; no-op utk temp-mail/phone
    if (PHONE_SIGNUP) {
      step('mode-hp', true, 'daftar via nomor HP — nomor diisi operator lewat panel (kartu No. HP)');
    } else if (MANUAL_EMAIL_ARG) {
      result.email = MANUAL_EMAIL_ARG;
      step('email_manual', true, MANUAL_EMAIL_ARG + ' — email ketik-an operator, bukan stok Gmail');
      console.log('[EMAIL-MANUAL] pakai email dari operator: ' + MANUAL_EMAIL_ARG + ' — OTP verifikasi via kartu panel');
    } else if (GMAIL_ID_ARG) {
      const db = require('./db');
      await db.waitReady();
      const rows = await db.rawAll('SELECT id, email, password_enc, status, used_by FROM gmail_pool WHERE id = ?', [GMAIL_ID_ARG]);
      if (!rows || !rows.length) throw new Error('gmail #' + GMAIL_ID_ARG + ' tidak ditemukan di pool');
      // Gmail pernah dipakai daftar FB TETAP boleh dipakai IG (satu Gmail layak daftar
      // FB dan IG masing-masing sekali). Dilarang hanya bila pernah dipakai daftar IG
      // sendiri — pencegahan dobel-dukun lewat helper db.gmailUsedPlatforms.
      const gmailPlts = require('./db').gmailUsedPlatforms(rows[0].used_by);
      if (rows[0].status === 'used' && gmailPlts.includes('ig')) throw new Error('gmail #' + GMAIL_ID_ARG + ' (' + rows[0].email + ') sudah terpakai daftar IG (' + (rows[0].used_by || '-') + ')');
      if (rows[0].status === 'used') console.log('[GMAIL] dipakai utk ' + rows[0].used_by + ' — boleh dipakai ulang utk daftar IG.');
      const pw = require('./crypto').decrypt(rows[0].password_enc);
      if (!pw) throw new Error('password gmail #' + GMAIL_ID_ARG + ' tidak terbaca');
      stockGmail = { id: GMAIL_ID_ARG, email: rows[0].email, password: pw };
      result.email = stockGmail.email;
      step('gmail_stok', true, result.email);
      // Helper penanda SEKALI PAKAI (idempotent): dipasang SEKETIKA saat IG minta
      // kode verifikasi — bukan di akhir run. Email stok sudah tercatat di IG
      // saat layar kode muncul; bila run crash/server restart di tengah OTP,
      // Gmail ini tak boleh kembali 'available' lalu dipakai daftar ulang
      // (OTP kedua tak akan pernah datang ke inbox yang sama).
      markStockGmailUsed = () => {
        if (markStockGmailUsed._done) return;
        markStockGmailUsed._done = true;
        try {
          require('./db').markGmailUsed(GMAIL_ID_ARG, 'ig', String(result.username || result.email || '').split('@')[0]);
          console.log('[GMAIL] pool #' + GMAIL_ID_ARG + ' ditandai used utk ig (OTP diminta): ' + String(result.username || result.email || '').split('@')[0]);
        } catch (e) { console.log('[GMAIL] tandai used (ig, otp-required) gagal: ' + e.message); }
      };
    } else {
      if (!mailWorker.configured) throw new Error('Mail Worker belum dikonfigurasi (AMMAIL_BASE_URL/API_KEY)');
      const em = require('./email-alias').makeEmail({ first: idn.first, last: idn.last });
      alias = em.alias;
      const inboxRes = await mailWorker.createInbox(em.alias, em.domain);
      const inboxEmail = inboxRes.email || inboxRes.address || '';
      if (!inboxEmail) throw new Error('Gagal bikin inbox');
      result.email = inboxEmail;
      step('inbox', true, result.email);
    }
    const em = alias ? { alias } : null;

    // 2. Browser — stealth terpusat (anti-detect): args anti-automation + cegah
    //    kebocoran IP asli via WebRTC (disable_non_proxied_udp).
    const stealth = require('./stealth');
    const launchOptions = {
      headless: false,
      args: stealth.launchArgs(),
    };
    const proxy = parseProxy(PROXY_ARG);
    if (proxy) { launchOptions.proxy = proxy; console.log('Proxy:', proxy.server); }
    browser = await chromium.launch(launchOptions);
    // Pola mobile: emulasi HP Android + profil Indonesia (IG mobile-first)
    const MOBILE = process.argv.includes('--mobile');
    // Versi Chrome di UA DISAMAKAN dengan Chromium asli (UA bohong = sinyal bot klasik).
    const UA = stealth.alignUaVersion(
      MOBILE
        ? 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36'
        : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      browser.version()
    );
    // Ukur layar asli via halaman probe SEBELUM context dibuat: viewport lebih tinggi
    // dari monitor = Chromium memotong jendela ke area kerja Windows, sisa bawah
    // hilang (kasus "masih terpotong" — viewport 1080 di layar yang lebih pendek).
    let vpW = MOBILE ? 412 : 1366, vpH = MOBILE ? 1080 : 768;
    try {
      const probe = await browser.newContext({ viewport: null });
      const ppage = await probe.newPage();
      await ppage.goto('about:blank', { timeout: 15000 }).catch(() => {});
      const scr = await ppage.evaluate(() => ({ w: screen.availWidth, h: screen.availHeight }));
      await probe.close().catch(() => {});
      if (scr && scr.h) {
        vpH = Math.max(560, Math.min(vpH, scr.h - 140));
        vpW = Math.max(320, Math.min(vpW, scr.w));
        console.log(`Layar asli ${scr.w}x${scr.h} → viewport wizard ${vpW}x${vpH}`);
      }
    } catch (e) { console.log('ukur layar gagal — pakai viewport standar', vpW + 'x' + vpH); }
    const context = await (MOBILE
      ? browser.newContext({
          // Tinggi mengikuti layar asli (maks 1080): menu bawah IG (Settings/2FA dsb)
          // tidak terpotong di monitor pendek, bagian bawah tetap tersentuh.
          viewport: { width: vpW, height: vpH },
          isMobile: true,
          hasTouch: true,
          deviceScaleFactor: 2,
          locale: 'id-ID',
          timezoneId: 'Asia/Jakarta',
          userAgent: UA,
        })
      : browser.newContext({
          // Locale/tz mengikuti geo IP (ID) — en-US/New York dengan IP Indonesia = sinyal aneh.
          viewport: { width: vpW, height: vpH }, locale: 'id-ID', timezoneId: 'Asia/Jakarta',
          userAgent: UA,
        }));
    if (MOBILE) console.log('Mode: MOBILE ID (Pixel 7, Asia/Jakarta)');
    // Patchright: anti-detect di level engine — TANPA init script manual.
    // Hardening CDP per halaman tetap: UA protokol + userAgentData + Accept-Language.
    const FP = { userAgent: UA, languages: ['id-ID', 'id', 'en-US', 'en'] };
    // Spoof canvas/audio/rects/hardware/WebGL — SEED deterministik dari username
    // (paritas dengan jalur FB create): akun lain → seed lain, akun sama → seed sama
    // selamanya. Konfig disimpan ke accounts.fingerprint_json — login berikutnya
    // memakai nilai identik via findAccountFingerprint.
    let igSpoof = null;
    try { igSpoof = require('./fingerprint-spoof').spoofConfigFor({ id: 0, name: result.username, email: result.email, user_agent: UA }); } catch (e) { /* spoof cfg gagal — lanjut tanpa */ }
    if (igSpoof) {
      try {
        await context.addInitScript(stealth.spoofInitScript(igSpoof));
        console.log('Spoof: canvas 0x' + igSpoof.canvasSeed.toString(16) + ' | audio 0x' + igSpoof.audioSeed.toString(16) + ' | webgl ' + igSpoof.webgl.vendor);
      } catch (e) { console.log('spoof pasang gagal:', e.message); }
    }
    context.on('page', (pg) => { stealth.attachPageHardening(context, pg, FP).catch(() => {}); });
    const page = await context.newPage();
    step('browser', true, 'terbuka');
    // Catat IP lahir (aturan besi: 1 akun = 1 IP tetap — login berikutnya wajib IP sama
    // via suffix -session- yang sama di username proxy Bright Data).
    let birthIp = '';
    try {
      const r = await context.request.get('https://api.ipify.org?format=text', { timeout: 20000 });
      if (r.ok()) birthIp = (await r.text()).trim();
    } catch (e) { /* IP opsional */ }
    if (birthIp) console.log('IP lahir:', birthIp);

    // 3. MOBILE = wizard bertahap (1 layar 1 langkah). Desktop = form sekaligus.
    //    Identitas sudah dibuat di langkah 0 (dipakai juga untuk email).
    const username = idn.username;
    const password = idn.password;
    const fullName = idn.name;
    const bday = idn.birthdate;
    result.username = username;
    result.password = password;
    result.fullName = fullName;
    console.log(`ID  ${fullName} (@${username})`);

    const ID_M = ['', 'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
    const EN_M = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

    const typeHuman = async (loc, value) => {
      await loc.click(); await sleep(rand(200, 500)); await loc.fill('');
      for (const ch of value) {
        await loc.type(ch, { delay: rand(50, 180) });
        if (Math.random() < 0.1) await sleep(rand(200, 600));
      }
      await sleep(rand(600, 1400));
    };
    const pageText = async () => (await page.evaluate(() => document.body ? document.body.innerText : '').catch(() => '')) || '';
    // goto dengan retry: sebagian URL IG sering ditolak via proxy (ERR_HTTP_RESPONSE_CODE_FAILURE).
    // Trik dari ig-relogin.js: lewati dulu root IG, lalu coba URL tujuan lagi.
    const gotoRetry = async (url, tries = 3) => {
      for (let i = 1; i <= tries; i++) {
        try { await page.goto(url, { timeout: 45000, waitUntil: 'domcontentloaded' }); return true; }
        catch (e) {
          if (i === tries) return false;
          await sleep(rand(3000, 6000));
          try { await page.goto('https://www.instagram.com/', { timeout: 45000, waitUntil: 'domcontentloaded' }); } catch (e2) { /* lanjut */ }
          await sleep(rand(2000, 4000));
        }
      }
      return false;
    };
    const clickNext = async () => {
      // Berikutnya/Lanjutkan/Daftar — JANGAN "Daftar dengan nomor ponsel"
      const cands = await page.getByRole('button').all().catch(() => []);
      for (const b of cands) {
        const t = ((await b.textContent().catch(() => '')) || '').trim();
        if (/ponsel|phone/i.test(t)) continue;
        if (/^(berikutnya|lanjutkan|lanjut|next|continue|daftar|sign up|buat akun)$/i.test(t)) {
          const dis = await b.isDisabled().catch(() => true);
          if (!dis) {
            await b.click().catch(() => {});
            await sleep(rand(3500, 5500));
            return t;
          }
        }
      }
      return null;
    };
    // Helper input kode OTP / nomor HP dari panel (stdin via runner) — pola sama dgn
    // fb-account-creator. Regex & marker bisa diganti (mode daftar via nomor HP).
    const askOperatorOtp = ({ timeoutMs = 8 * 60 * 1000, re = /(\d{4,8})/, reqMark = '[OTP_REQUIRED]', gotMark = '[OTP_GOT]' } = {}) => {
      if (!process.stdin || process.stdin.readable === false) return Promise.resolve(null);
      return new Promise((resolve) => {
        let buf = '';
        const onData = (d) => {
          buf += String(d);
          let nl;
          while ((nl = buf.indexOf('\n')) !== -1) {
            const line = buf.slice(0, nl).trim();
            buf = buf.slice(nl + 1);
            const m = re !== null ? line.match(re) : null;
            if (m) {
              cleanup();
              console.log(gotMark + ' diterima dari panel.');
              step('otp_operator', true, 'input: ' + m[0]);
              resolve(m[1]);
              return;
            }
            console.log('[panel-txt] input tidak dikenal:', line.slice(0, 20));
          }
        };
        const cleanup = () => {
          if (process.stdin.off) process.stdin.off('data', onData);
          clearTimeout(timer);
        };
        const timer = setTimeout(() => {
          cleanup();
          console.log(reqMark + ' operator tidak memasukkan input dalam 8 menit.');
          step('otp_operator', false, 'timeout menunggu kode');
          resolve(null);
        }, timeoutMs);
        if (process.stdin.setEncoding) process.stdin.setEncoding('utf8');
        process.stdin.on('data', onData);
      });
    };
    // Tunggu teks layar berubah setelah submit kritis — kasus run 12/10: IG pindah
    // layar telat (SMS belum terkirim), mesin wizard membaca layar lama dan MINTA
    // NOMOR DUA KALI padahal IG sudah di layar kode; operator menyelesaikan manual
    // (nomor 628895463755) — fatal untuk nomor virtual sekali pakai.
    const waitScreenLeft = async (markerRe, maxMs = 30000) => {
      for (let w = 0; w < maxMs / 2500; w++) {
        await sleep(2500);
        const t2 = await pageText();
        if (!markerRe.test(t2)) return true;
      }
      return false;
    };
    const pollOtp = async (maxMin = 5) => {
      for (let i = 0; i < maxMin * 12; i++) {
        await sleep(5000);
        try {
          const list = await mailWorker.listMessages(alias);
          for (const prev of list) {
            if (!prev.id) continue;
            const msg = await mailWorker.getMessage(prev.id);
            const f = extractOtp(msg.text || msg.body || '', msg.html || '', msg.subject || '');
            if (f.code) return f.code;
          }
        } catch (e) { /* lanjut */ }
      }
      return '';
    };

    // 3b-pre (desktop): buka signup & cek apakah IG masih menyajikan form 4-kolom.
    // Bila form tidak muncul (UI IG berubah / aset lambat via proxy), desktop JATUH KE
    // mesin wizard di bawah (selector role/teks — aman juga di viewport desktop).
    let desktopFormOK = false;
    if (!MOBILE) {
      if (!(await gotoRetry('https://www.instagram.com/accounts/emailsignup/', 3))) throw new Error('signup tak terbuka via proxy (3x coba)');
      await sleep(rand(3000, 5000));
      // Tunggu form muncul: poll ~30 dtk sebelum menyerah (aset via proxy sering lambat)
      for (let w = 0; w < 10; w++) {
        if ((await page.locator('input').count().catch(() => 0)) >= 4) { desktopFormOK = true; break; }
        await sleep(3000);
      }
      if (!desktopFormOK) {
        try { await page.screenshot({ path: 'ig-noform.png' }); } catch (e) { /* abaikan */ }
        step('form', false, 'form 4-kolom tidak muncul → desktop fallback ke mesin wizard (ig-noform.png)');
      }
    }

    if (MOBILE) {
      if (!(await gotoRetry('https://www.instagram.com/accounts/emailsignup/', 3))) throw new Error('signup tak terbuka via proxy (3x coba)');
      await sleep(rand(3000, 5000));
      // Opsi awal bila ada — mode nomor HP memilih jalur ponsel, mode email tetap email.
      if (PHONE_SIGNUP) {
        for (const name of [/daftar dengan nomor ponsel/i, /sign up with mobile number/i, /sign up with phone number/i]) {
          const opt = page.getByRole('button', { name }).first();
          if ((await opt.count()) > 0) {
            await opt.click().catch(() => {});
            await sleep(rand(3000, 5000));
            step('nav-phone', true, String(name.source));
            break;
          }
        }
      } else {
        for (const name of [/daftar dengan email/i, /sign up with email/i]) {
          const opt = page.getByRole('button', { name }).first();
          if ((await opt.count()) > 0) {
            await opt.click().catch(() => {});
            await sleep(rand(3000, 5000));
            step('nav-email', true, String(name));
            break;
          }
        }
      }
      // Mesin wizard max 12 layar
      let termsPassed = false; // layar syarat sudah disetujui — akun sudah lahir
      // Jaring pengaman cookies: flush draft session PADA SETIAP AKHIR iterasi layar.
      // Kasus run 12/10: browser ditutup/dicrash di tengah wizard — username/password
      // diketahui tapi cookies hilang; draft tiap layar menjamin ada kunci apa pun
      // (draft diperbarui lagi di session-early/session final kalau alur tuntas).
      let draftFlushed = 0;
      const flushDraftCookies = async () => {
        try {
          if (!result.username) return;
          fs.mkdirSync(path.join(__dirname, '..', 'sessions'), { recursive: true });
          const cks = await context.cookies().catch(() => []);
          if (cks.length === 0 || cks.length === draftFlushed) return; // tidak berubah → skip
          draftFlushed = cks.length;
          fs.writeFileSync(path.join(__dirname, '..', 'sessions', `ig-${result.username}.json`), JSON.stringify({
            platform: 'instagram', username: result.username, email: result.email,
            password, cookies: cks, created_at: new Date().toISOString(),
            proxy: PROXY_ARG || null, phone: result.phone || null,
            note: 'draft bertahap: cookie flush tiap layar wizard',
          }, null, 2));
        } catch (e) { /* non-fatal */ }
      };
      let unk = 0;
      for (let s = 1; s <= 12; s++) {
        const t = await pageText();
        const inputs = page.locator('input');
        const n = await inputs.count().catch(() => 0);
        // Akun dibekukan IG saat proses daftar = sinyal IP dicurigai. Hentikan, jangan lanjut.
        // Bila wizard sudah tuntas (sedang di layar terms), akun SEBENARNYA sudah lahir —
        // simpan status 'partial' + kredensial agar masih bisa didaftarkan ke panel dan
        // diupayakan lewat jalur aktivasi/login, jangan gagal polos yang dianggap tidak ada.
        if (/accounts\/suspended|akun dinonaktifkan|account (has been )?disabled/i.test(page.url() + ' ' + t)) {
          try { await page.screenshot({ path: 'ig-suspended.png' }); } catch (e) { /* abaikan */ }
          if (termsPassed) {
            result.status = 'partial';
            result.error = 'akun_dibekukan_IG_saat_daftar — akun sudah lahir (login ulang/verify di IG untuk buka)';
            console.log('\nHASIL: partial |', result.email, '|', result.error);
            try {
              fs.mkdirSync(path.join(__dirname, '..', 'sessions'), { recursive: true });
              writeResultFile({
                platform: 'ig', status: 'partial', username: result.username, email: result.email,
                password, fullName, proxy: PROXY_ARG || null, birthIp: birthIp || null,
                phone: result.phone || null, spoof: igSpoof ? { canvas_seed: '0x' + igSpoof.canvasSeed.toString(16), audio_seed: '0x' + igSpoof.audioSeed.toString(16), webgl: igSpoof.webgl } : null,
                error: result.error, createdAt: new Date().toISOString(),
              });
            } catch (e2) { /* non-fatal */ }
            // cookies draft tugar flush — akun lahir walau status partial
            await flushDraftCookies();
            // Gmail stok yang sudah jadi identitas daftar akun lahir (partial) —
            // TANDAI used: email ini SUDAH TERPAKAI di IG, tidak boleh nongol lagi
            // "available" di dropdown (pelajaran run 12/10: Gmail #24 dipakai lagi).
            if (stockGmail) {
              try {
                require('./db').markGmailUsed(stockGmail.id, 'ig', (result.username || result.email || '').split('@')[0]);
                console.log('[GMAIL] pool #' + stockGmail.id + ' ditandai used utk ig (partial akun lahir): ' + String(result.username || result.email || '').split('@')[0]);
              } catch (e3) { console.log('[GMAIL] tandai used (partial) gagal: ' + e3.message); }
            }
            // --keep-open: browser JANGAN ditutup — operator harus bisa lihat/status akun
            // di layar (run 12/10: browser tiba-tiba hilang saat suspended, tidak sempat cek).
            if (process.argv.includes('--keep-open') && browser) {
              console.log('\n*** AKUN DIBEKUKAN SAAT DAFTAR — browser dibiarkan terbuka utk dicek. Ctrl+C di terminal utk tutup. ***');
              try { await page.screenshot({ path: 'ig-suspended-final.png' }); } catch (e4) { /* abaikan */ }
              process.on('SIGINT', async () => { await browser.close().catch(() => {}); process.exit(0); });
              await new Promise(() => {}); // nggantung sampai Ctrl+C
            }
            if (browser) await browser.close().catch(() => {});
            process.exit(0);
          }
          throw new Error('akun_dibekukan_IG_saat_daftar — IP dicurigai, ganti IP lain');
        }
        // Screen "Konfirmasikan bahwa Anda adalah manusia" = puzzle/captcha lanjutan:
        // tunggu user selesaikan manual di browser (max 10 mnt), JANGAN diterobos bot.
        if (/konfirmasikan bahwa anda (adalah )?manusia|confirm that you('| a)?re a human|konfirmasi bahwa anda manusia/i.test(t)) {
          console.log('\n*** SELESAIKAN PUZZLE MANUSIA DI BROWSER (max 10 mnt) ***\n');
          step('human-check', false, 'menunggu penyelesaian manual di browser...');
          let hw = 0;
          while (hw < 600) {
            await sleep(5000); hw += 5;
            const t2 = await pageText();
            if (!/konfirmasikan bahwa anda (adalah )?manusia|confirm that you('| a)?re a human/i.test(t2)) break;
          }
          step('human-check', true, hw < 600 ? 'selesai manual' : 'timeout 10 mnt');
          if (hw >= 600) throw new Error('human_check_timeout');
          continue;
        }
        let acted = 'selesai?';
        if (/i'm not a robot|confirm it's you|robot/i.test(t)) {
          console.log('\n*** KLIK CAPTCHA DI BROWSER (max 10 mnt) ***\n');
          step('captcha', false, 'menunggu klik manual...');
          let w = 0;
          while (w < 600) {
            await sleep(5000); w += 5;
            const t2 = await pageText();
            if (!/i'm not a robot|confirm it's you|robot/i.test(t2)) break;
          }
          step('captcha', true, 'lanjut');
          continue;
        } else if (/apa email|your email|alamat email/i.test(t) && n > 0) {
          if (PHONE_SIGNUP) {
            // Wizard jebak ke jalur email padahal mode HP: cari tombol pindah ke nomor ponsel.
            const swapBtn = page.getByRole('button', { name: /daftar dengan nomor ponsel|sign up with (mobile |phone )?number/i }).first();
            if ((await swapBtn.count()) > 0) { await swapBtn.click().catch(() => {}); await sleep(rand(3000, 5000)); step('wiz-to-phone', true, 'pindah jalur ponsel'); continue; }
            if (!/ponsel/i.test(t)) { step('wiz-email-salah-jalur', false, 'mode HP tapi wizard tetap jalur email'); await sleep(4000); continue; }
          }
          await typeHuman(inputs.first(), result.email);
          acted = 'email: ' + (await clickNext());
          step('wiz-email', true, acted);
          // Gmail stok SEKALI PAKAI: begitu email diketik + tombol lanjut diklik, IG
          // bisa saja sudah menerima identitas daftar walau layar berikutnya macet
          // (captcha, challenge, browser ditutup). Tandai used DI SINI — paling awal —
          // supaya run macet apa pun hasilnya Gmail ini tidak kembali 'available' di
          // dropdown dan dipakai daftar ulang (pelajaran run 12/10: #23/#24, dan run
          // yang gagal SEBELUM OTP). Helper idempotent: penandaan ganda tetap satu.
          if (stockGmail) {
            try {
              require('./db').markGmailUsed(stockGmail.id, 'ig', (result.email || '').split('@')[0]);
              console.log('[GMAIL] pool #' + stockGmail.id + ' ditandai used utk ig (email terkirim): ' + String(result.email || '').split('@')[0]);
            } catch (e5) { console.log('[GMAIL] tandai used (wiz-email) gagal: ' + e5.message); }
          }
        } else if (/nomor ponsel|phone number|mobile number/i.test(t) && n > 0
          && !/kode konfirmasi|confirmation|masukkan kode|6-digit/i.test(t)) {
          // Jalur ponsel: layar mengisi nomor. Nomor TIDAK disimpan di worker —
          // operator mengetiknya di panel (kartu No. HP) setelah marker ini.
          console.log('[PHONE_REQUIRED] ketik nomor HP aktif di panel (kartu No. HP). Menunggu max 8 menit.');
          step('wiz-phone', false, 'menunggu operator mengetik nomor di panel...');
          const phone = await askOperatorOtp({ re: /(\+?\d[\d\s-]{6,17}\d)/, reqMark: '[PHONE_REQUIRED]', gotMark: '[PHONE_GOT]' });
          if (!phone) throw new Error('phone_not_received');
          result.phone = phone.replace(/[\s-]+/g, '');
          await typeHuman(inputs.first(), result.phone);
          acted = 'nomor: ' + (await clickNext());
          // Tunggu layar benar-benar pindah dari nomor ke layar berikutnya sebelum
          // iterasi berikut — tanpa ini wizard membaca ulang layar nomor (salah salah).
          await waitScreenLeft(/nomor ponsel|phone number|mobile number/i);
          step('wiz-phone', true, acted);
          await flushDraftCookies();
        } else if (/kode konfirmasi|confirmation|enter.*code|6-digit/i.test(t) && n > 0) {
          step('wiz-otp', false, 'menunggu kode...');
          let c = '';
          if (stockGmail || MANUAL_EMAIL_ARG) {
            // Jalur operator (desktop & wizard mobile pola sama): Gmail stok ATAU email
            // manual dari panel — OTP diisi OPERATOR lewat kartu panel (marker
            // OTP_REQUIRED → input → submit → stdin). Temp-mail polling dilewati:
            // email manual bukan inbox Mail Worker.
            console.log('[OTP_REQUIRED] IG minta kode verifikasi — ketik kode dari inbox ' + (stockGmail ? 'Gmail stok #' + stockGmail.id : result.email) + ' di panel (kartu OTP). Menunggu max 8 menit.');
            if (stockGmail) markStockGmailUsed(); // email sudah tercatat di IG — tahan crash
            c = await askOperatorOtp();
            if (!c) throw new Error('otp_not_received');
          } else if (PHONE_SIGNUP) {
            // Jalur nomor HP: kode SMS masuk di HP itu — operator bacayya lalu ketik di panel.
            console.log('[OTP_REQUIRED] IG minta kode verifikasi SMS — baca SMS di HP itu, ketik kodenya di panel (kartu OTP). Menunggu max 8 menit.');
            c = await askOperatorOtp();
            if (!c) throw new Error('otp_not_received');
          } else {
            c = await pollOtp(5);
            if (!c) throw new Error('otp_not_received');
          }
          await typeHuman(inputs.first(), c);
          acted = 'kode: ' + (await clickNext());
          // Sama: pastikan layar kode sudah ditinggalkan sebelum baca ulang.
          await waitScreenLeft(/kode konfirmasi|confirmation|enter.*code|6-digit/i);
          step('wiz-otp', true, acted);
          await flushDraftCookies();
          if (process.argv.includes('--stop-after-otp')) {
            console.log('\n*** OTP TERISI — GILIRANMU. Browser dibiarkan terbuka. ***\n');
            try { await page.screenshot({ path: 'ig-stop-otp.png' }); } catch (e) { /* abaikan */ }
            process.on('SIGINT', async () => { await browser.close().catch(() => {}); process.exit(0); });
            await new Promise(() => {});
          }
        } else if (/nama lengkap|full name|siapa nama|your name|nama anda/i.test(t) && n > 0) {
          await typeHuman(inputs.first(), fullName);
          acted = 'nama: ' + (await clickNext());
          step('wiz-name', true, acted);
        } else if (/kata sandi|buat.*sandi|create.*password|^password/i.test(t)) {
          const pw = page.locator('input[type="password"]').first();
          if ((await pw.count()) > 0) {
            await typeHuman(pw, password);
            acted = 'sandi: ' + (await clickNext());
            step('wiz-pass', true, acted);
          } else { acted = 'kolom sandi ga ketemu'; step('wiz-pass', false, acted); break; }
        } else if (/ulang tahun|birthday|tanggal lahir/i.test(t)) {
          const mNum = +bday.month, dNum = +bday.day, yStr = bday.year;
          // Strategi 0: input tanggal native (IG web mobile 2026: <input aria="Tanggal lahir (0 tahun)">)
          const pad2 = (x) => String(x).padStart(2, '0');
          const iso = `${yStr}-${pad2(mNum)}-${pad2(dNum)}`;
          let via = '';
          const nativeDate = page.locator('input[type="date"], input[aria-label*="anggal lahir" i], input[aria-label*="date of birth" i]').first();
          if ((await nativeDate.count().catch(() => 0)) > 0) {
            try {
              await nativeDate.click().catch(() => {});
              await nativeDate.evaluate((el, val) => {
                Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(el, val);
                el.dispatchEvent(new Event('input', { bubbles: true }));
                el.dispatchEvent(new Event('change', { bubbles: true }));
              }, iso).catch(() => {});
              await sleep(rand(500, 1000));
              if ((await nativeDate.inputValue().catch(() => '')) === iso) via = 'native date';
              if (!via) { await nativeDate.fill(iso).catch(() => {}); await sleep(400); if ((await nativeDate.inputValue().catch(() => '')) === iso) via = 'native date'; }
            } catch (e) { via = ''; }
          }
          // Strategi 1: <select> native (umum di web mobile) — 3 dropdown bulan/tgl/tahun
          const trySelect = async () => {
            const sels = page.locator('select');
            if ((await sels.count().catch(() => 0)) < 3) return false;
            const tryOne = async (sel, labels, values) => {
              for (const lb of labels) {
                try { await sel.selectOption({ label: lb }, { timeout: 3000 }); return true; } catch (e) { /* next */ }
              }
              for (const v of values) {
                try { await sel.selectOption(v, { timeout: 3000 }); return true; } catch (e) { /* next */ }
              }
              return false;
            };
            const okM = await tryOne(sels.nth(0), [ID_M[mNum], EN_M[mNum]], [String(mNum), String(mNum - 1)]);
            const okD = await tryOne(sels.nth(1), [String(dNum)], [String(dNum)]);
            const okY = await tryOne(sels.nth(2), [yStr], [yStr]);
            return okM && okD && okY;
          };
          const pickM = async (comboRe, optText) => {
            const combo = page.getByRole('combobox', { name: comboRe }).first();
            if ((await combo.count()) === 0) return false;
            await combo.click().catch(() => {}); await sleep(1500);
            const opt = page.getByRole('option', { name: new RegExp(`^${optText}$`, 'i') }).first();
            if ((await opt.count()) === 0) { await page.keyboard.press('Escape').catch(() => {}); return false; }
            await opt.click().catch(() => {}); await sleep(1000);
            return true;
          };
          let bdOK = via === 'native date' || await trySelect();
          let bd = [bdOK, bdOK, bdOK];
          if (!bdOK) {
            bd = [await pickM(/bulan|month/i, ID_M[mNum]), await pickM(/tanggal|day/i, String(dNum)), await pickM(/tahun|year/i, yStr)];
            if (!bd.every(Boolean)) bd = [await pickM(/month/i, EN_M[mNum]), await pickM(/day/i, String(dNum)), await pickM(/year/i, yStr)];
          }
          acted = 'birthday: ' + (bdOK ? `${dNum}/${mNum}/${yStr}${via ? ` (${via})` : ' (select)'}` : bd.join('/'));
          if (!(bdOK || bd.every((v) => v === true))) {
            // Diagnostik: inventaris kontrol agar kegagalan berikut langsung bisa diperbaiki
            const inv = await page.evaluate(() => [...document.querySelectorAll('select, input, button, [role=combobox], [role=listbox]')]
              .slice(0, 20).map((e) => `${e.tagName}.${(e.getAttribute('role') || '')}[name=${e.getAttribute('name') || ''}][aria=${e.getAttribute('aria-label') || ''}][txt=${(e.innerText || e.value || '').slice(0, 30)}]`).join(' | ')).catch(() => 'n/a');
            console.log('BDAY-INV:', inv);
            try { await page.screenshot({ path: 'ig-bday-fail.png' }); } catch (e) { /* abaikan */ }
            throw new Error('birthday_picker_gagal: hentikan, jangan buat akun cacat');
          }
          step('wiz-bday', true, acted);
          await clickNext();
        } else if (/nama pengguna|username/i.test(t) && n > 0) {
          // Input bisa disabled sesaat (validasi/refresh UI saat transisi lambat via proxy).
          const uin = inputs.first();
          let enabled = false;
          for (let w = 0; w < 12; w++) {
            if (!(await uin.isDisabled().catch(() => true))) { enabled = true; break; }
            await sleep(2500);
          }
          if (!enabled) { step('wiz-user', false, 'input username tetap disabled'); break; }
          // FIX: bila "nama pengguna tidak tersedia" JANGAN ketik ulang nilai yang sama.
          // Urutan: cek pesan error -> pakai saran IG (item bercentang) -> varian angka.
          // Settle (tidak ada error) dulu, baru klik Berikutnya SATU kali.
          const userErrRe = /tidak tersedia|not available|sudah digunakan|tidak dapat menggunakan|unavailable/i;
          const pickSuggestion = async (tried) => {
            const cands = await page.evaluate(() => {
              const re = /^[a-z0-9._]{3,30}$/;
              const out = [];
              for (const el of document.querySelectorAll('[role="button"], [role="option"], li')) {
                const tx = (((el.innerText || '').split('\n')[0]) || '').trim().toLowerCase();
                if (re.test(tx) && el.querySelector('svg')) out.push(tx);
              }
              return Array.from(new Set(out)).slice(0, 6);
            }).catch(() => []);
            // saran belum dicoba saja — jangan ulang nilai yang sama (pelajaran run-1)
            return cands.find((c) => c && c !== result.username && !tried.has(c)) || '';
          };
          // Klik saran IG langsung (pilihan alami manusia). Return true bila input terisi val.
          const clickSuggestion = async (val) => {
            const locs = [
              page.getByRole('button', { name: val, exact: true }).first(),
              page.getByRole('option', { name: val, exact: true }).first(),
              page.locator(`li:has-text("${val}")`).first()
            ];
            for (const loc of locs) {
              try {
                if ((await loc.count()) === 0) continue;
                await loc.click().catch(() => {});
                await sleep(rand(800, 1500));
                if ((await uin.inputValue().catch(() => '')) === val) return true;
              } catch (e) { /* lanjut cara ketik */ }
            }
            return false;
          };
          const tried = new Set();
          let settled = false, attempt = 0, used = '';
          while (attempt < 6 && !settled) {
            attempt++;
            let val = attempt === 1 ? username : await pickSuggestion(tried);
            if (!val || tried.has(val)) val = username.replace(/[._]+$/, '') + rand(100, 9999);
            tried.add(val); used = val;
            if (attempt === 1 || !(await clickSuggestion(val))) await typeHuman(uin, val);
            await sleep(rand(2500, 4000)); // beri waktu IG memvalidasi ketersediaan
            const t2 = await pageText();
            if (!userErrRe.test(t2)) { settled = true; break; }
            // error bisa sisa dari nilai sebelumnya: bila tidak menyinggung nilai sekarang,
            // tunggu sebentar dan cek ulang sebelum menyimpulkan ditolak
            if (!t2.toLowerCase().includes(val.toLowerCase())) {
              await sleep(2500);
              if (!userErrRe.test(await pageText())) { settled = true; break; }
            }
          }
          if (!settled) {
            try { await page.screenshot({ path: 'ig-user-fail.png' }); } catch (e) { /* abaikan */ }
            step('wiz-user', false, `username tak tersedia setelah ${attempt} varian (terakhir: ${used})`);
            throw new Error('username_tidak_tersedia: hentikan run, jangan buat akun cacat');
          }
          result.username = used; // pakai username final yang disetujui IG
          step('wiz-user', true, `user OK: ${used} (coba ${attempt}x)`);
          let clickedU = null;
          for (let w = 0; w < 8 && !clickedU; w++) { clickedU = await clickNext(); if (!clickedU) await sleep(2000); }
          await sleep(rand(5000, 8000)); // transisi lambat via proxy: hindari dobel isi di layar yang sama
        } else if (/nomor ponsel|phone number/i.test(t) && !PHONE_SIGNUP) {
          // Jalur EMAIL saja: layar pilih-nomor → pindah ke email. Mode nomor HP
          // JANGAN lewat sini — layar mengisi nomor sudah ditangani cabang di atas.
          const mailBtn = page.getByRole('button', { name: /daftar dengan email|sign up with email/i }).first();
          if ((await mailBtn.count()) > 0) {
            await mailBtn.click().catch(() => {});
            acted = 'klik daftar-dengan-email';
            step('wiz-to-email', true, acted);
          } else { acted = 'tombol email ga ketemu'; step('wiz-phone', false, acted); break; }
        } else if (/nomor ponsel|phone number/i.test(t) && PHONE_SIGNUP && n === 0) {
          // Mode nomor HP: layar pilih-nomor tanpa kolom input — cari tombol pindah ke
          // kolom nomor (mis. "Gunakan nomor telepon"). Bila tak ketemu, screenshot.
          const useNum = page.getByRole('button', { name: /gunakan nomor|use (this )?(phone|mobile)|masukkan nomor|enter (your )?(phone|mobile)/i }).first();
          if ((await useNum.count()) > 0) {
            await useNum.click().catch(() => {});
            await sleep(rand(3000, 5000));
            step('wiz-phone-cont', true, 'lanjut ke kolom nomor');
          } else {
            try { await page.screenshot({ path: 'ig-phone-screen.png' }); } catch (e) { /* abaikan */ }
            step('wiz-phone-screen', false, 'layar nomor tanpa kolom — cek ig-phone-screen.png');
            await sleep(4000);
          }
        } else if (/setuju dengan syarat|syarat dan kebijakan|terms and policies/i.test(t)) {
          // Layar TERAKHIR signup: persetujuan syarat — TANPA klik ini akun TIDAK jadi.
          if (process.env.IG_DRY_RUN === '1') {
            try { await page.screenshot({ path: 'ig-dryrun-terms.png' }); } catch (e) { /* abaikan */ }
            step('dry-run', true, 'layar terms tercapai — berhenti TANPA setuju (bukti: ig-dryrun-terms.png)');
            console.log('\nHASIL: dry-run |', result.email, '| wizard + terms tercapai, tidak disetujui (IG_DRY_RUN=1)');
            console.log('\nRingkasan:', JSON.stringify(result.steps, null, 1));
            if (browser) await browser.close().catch(() => {});
            process.exit(0);
          }
          const agreeBtn = page.getByRole('button', { name: /saya setuju|i agree/i }).first();
          if ((await agreeBtn.count()) > 0) {
            await agreeBtn.click().catch(() => {});
            termsPassed = true; // akun resmi lahir — dibekukan setelah titik ini tetap terselamatkan
            step('wiz-terms', true, 'klik "Saya setuju" — akun resmi dibuat');
          } else {
            step('wiz-terms', false, 'tombol setuju tidak ketemu (screenshot ig-terms.png)');
            try { await page.screenshot({ path: 'ig-terms.png' }); } catch (e) { /* abaikan */ }
          }
          acted = 'terms';
          await sleep(rand(5000, 8000));
        } else if (n === 0 && ((/beranda|home feed/i.test(t) && /sarankan|stories|suggested/i.test(t)) || /instagram\.com\/(\?|$)/.test(page.url()))) {
          step('wiz-done', true, 'masuk beranda');
          break;
        } else if (/ada masalah|halaman tidak bisa dimuat|something went wrong|page isn't available|couldn't load/i.test(t)) {
          // Halaman error IG sendiri (aset gagal via proxy): klik tombol "Muat ulang
          // halaman" — inilah reload bawaan IG, lebih aman daripada page.reload yang
          // bisa mengulang navigasi dari nol. Dianggap layar dikenal: unk tak reset di sini
          // (sengaja — biarkan hitungan unk lama), tapi beri jeda sebelum baca ulang.
          const reloadBtn = page.getByRole('button', { name: /muat ulang halaman|reload (the )?page|try again|coba lagi/i }).first();
          if ((await reloadBtn.count().catch(() => 0)) > 0) {
            await reloadBtn.click().catch(() => {});
            await sleep(rand(5000, 8000));
            step('wiz-reload', true, `klik "Muat ulang halaman" (percobaan ${unk + 1})`);
          } else {
            try { await page.reload({ timeout: 30000 }); } catch (e) { /* abaikan */ }
            await sleep(6000);
            step('wiz-reload', false, 'tombol muat-ulang tidak ketemu — page.reload');
          }
          continue;
        } else {
          unk++;
          try { await page.screenshot({ path: 'ig-wiz-unknown.png' }); } catch (e) { /* abaikan */ }
          if (!t.trim() && unk <= 3) {
            // Splash macet (logo saja): reload, biasa karena aset lambat via proxy
            try { await page.reload({ timeout: 30000 }); } catch (e) { /* abaikan */ }
            await sleep(8000);
            step('wiz-unknown', false, `reload ${unk}/3 (splash macet)`);
            continue;
          }
          step('wiz-unknown', false, `coba ${unk}/4: ` + t.slice(0, 120).replace(/\n+/g, ' | '));
          if (unk >= 4) break; // halaman benar-benar tak dikenal
          await sleep(6000); // mungkin masih loading, baca ulang
          continue;
        }
        unk = 0; // layar dikenal, reset hitungan
        await sleep(1500);
      }
      step('wizard', true, 'selesai');
    }

    // DRY-RUN fallback (wizard): wizard selesai TANPA menyentuh layar terms — tetap berhenti,
    // JANGAN lanjut ke captcha/OTP/login (tidak buat akun, tidak login).
    if (process.env.IG_DRY_RUN === '1' && (MOBILE || !desktopFormOK)) {
      try { await page.screenshot({ path: 'ig-dryrun-wizard.png' }); } catch (e) { /* abaikan */ }
      step('dry-run', true, 'wizard selesai tanpa layar terms — berhenti di sini (tidak buat akun, tidak login)');
      result.status = 'dry-run';
      console.log('\nHASIL: dry-run |', result.email, '| wizard selesai (layar terms tidak tersentuh), berhenti (IG_DRY_RUN=1)');
      console.log('\nRingkasan:', JSON.stringify(result.steps, null, 1));
      if (browser) await browser.close().catch(() => {});
      process.exit(0);
    }

    // 3b. Desktop: isi form sekaligus (hanya bila form 4-kolom tersedia — sudah dicek di atas)
    if (!MOBILE && desktopFormOK) {
    const inputs = page.locator('input');
    await typeHuman(inputs.nth(0), result.email);
    await typeHuman(page.locator('input[type="password"]').first(), password);
    await typeHuman(inputs.nth(2), fullName);
    await typeHuman(inputs.nth(3), username);
    step('form', true, username);

    // 4. Birthday (desktop)
    const pickOption = async (comboName, optionText) => {
      const combo = page.getByRole('combobox', { name: comboName }).first();
      if ((await combo.count()) === 0) return false;
      await combo.scrollIntoViewIfNeeded().catch(() => {});
      await combo.click(); await sleep(rand(1000, 1800));
      const controlsId = await combo.getAttribute('aria-controls').catch(() => null);
      let opt = null;
      if (controlsId) {
        const list = page.locator(`#${controlsId.replace(/[^a-zA-Z0-9_-]/g, '')} [role="option"]`);
        const nn = await list.count().catch(() => 0);
        for (let i = 0; i < nn; i++) {
          const tt = ((await list.nth(i).textContent().catch(() => '')) || '').trim();
          if (tt === String(optionText)) { opt = list.nth(i); break; }
        }
      }
      if (!opt) {
        const any = page.getByRole('option', { name: String(optionText), exact: true });
        if ((await any.count()) === 0) { await page.keyboard.press('Escape'); return false; }
        opt = any.first();
      }
      await opt.scrollIntoViewIfNeeded().catch(() => {});
      await opt.click(); await sleep(rand(600, 1200));
      return true;
    };
    // Label combobox (aria-label) EN/ID + urutan kolom beda (id-ID: Hari/Bulan/Tahun).
    // Nilai bulan dicoba ID dulu lalu EN; verifikasi baca nilai persis tiap combobox.
    const pickVal = async (nameRe, values) => {
      for (const v of values) { if (await pickOption(nameRe, v)) return true; }
      return false;
    };
    const dayVal = String(+idn.birthdate.day);
    const monVal = EN_M[+idn.birthdate.month], monValId = ID_M[+idn.birthdate.month];
    const yrVal = String(idn.birthdate.year);
    await pickVal(/pilih bulan|select month/i, [monValId, monVal]);
    await pickVal(/pilih hari|pilih tanggal|select day/i, [dayVal]);
    await pickVal(/pilih tahun|select year/i, [yrVal]);
    const readCombos = async () => (await page.getByRole('combobox').allTextContents().catch(() => [])).map((s) => String(s).trim());
    const after = await readCombos();
    // textContent combobox = "LabelNilai" tanpa newline (mis. "BulanNovember") —
    // kupas label (EN/ID) dulu lalu cocokkan nilai persis.
    const vals = after.map((s) => s.replace(/^(select\s+)?(day|month|year|hari|bulan|tahun)/i, '').trim());
    const eq = (v) => vals.includes(String(v));
    const bday = [eq(dayVal), eq(monValId) || eq(monVal), eq(yrVal)];
    step('birthday', bday.every(Boolean), bday.join('/'));

    // DRY-RUN (desktop): form + ultah terisi — berhenti SEBELUM submit (akun tidak jadi).
    if (process.env.IG_DRY_RUN === '1') {
      try { await page.screenshot({ path: 'ig-dryrun-form.png' }); } catch (e) { /* abaikan */ }
      step('dry-run', true, 'form + ultah terisi — berhenti SEBELUM submit (bukti: ig-dryrun-form.png)');
      result.status = 'dry-run';
      console.log('\nHASIL: dry-run |', result.email, '| form desktop terisi, berhenti sebelum submit (IG_DRY_RUN=1)');
      console.log('\nRingkasan:', JSON.stringify(result.steps, null, 1));
      if (browser) await browser.close().catch(() => {});
      process.exit(0);
    }

    // 5. Submit (desktop)
    const submitBtn = page.getByRole('button', { name: /submit|sign up/i }).first();
    if ((await submitBtn.count()) === 0) throw new Error('Tombol submit tidak ketemu');
    await submitBtn.scrollIntoViewIfNeeded().catch(() => {});
    await submitBtn.click();
    await sleep(rand(4000, 6000));
    step('submit', true, 'diklik');
    // Gmail stok SEKALI PAKAI — jalur desktop 4-kolom: form sudah disubmit, IG bisa
    // saja menerima email walau tahap berikutnya macet (captcha, challenge). Tandai
    // used SEKARANG (sebelum captcha) — paritas jalur wizard di atas. Dry-run yang
    // berhenti SEBELUM submit tidak lolos ke sini (form terisi tapi tak dikirim).
    if (stockGmail) {
      try {
        require('./db').markGmailUsed(stockGmail.id, 'ig', (result.email || '').split('@')[0]);
        console.log('[GMAIL] pool #' + stockGmail.id + ' ditandai used utk ig (form desktop terkirim): ' + String(result.email || '').split('@')[0]);
      } catch (e6) { console.log('[GMAIL] tandai used (desktop submit) gagal: ' + e6.message); }
    }
    }

    // 6. Captcha MANUAL — tunggu sampai dialog hilang max 10 menit
    const captchaGone = async () => {
      const t = await page.evaluate(() => document.body ? document.body.innerText : '').catch(() => '');
      return !/i'm not a robot|confirm it's you/i.test(t || '');
    };
    if (!(await captchaGone())) {
      console.log('\n*** KLIK CAPTCHA "I\'m not a robot" DI BROWSER SEKARANG ***');
      console.log('*** Bot menunggu max 10 menit, otomatis lanjut setelah centang ***\n');
      step('captcha', false, 'menunggu klik manual...');
      let waited = 0;
      while (waited < 600 && !(await captchaGone())) {
        await sleep(5000);
        waited += 5;
        if (waited % 60 === 0) console.log(`... masih menunggu captcha (${waited / 60} mnt)`);
      }
      if (!(await captchaGone())) throw new Error('captcha_timeout: captcha tidak diselesaikan dalam 10 menit');
      step('captcha', true, 'selesai manual');
    } else {
      step('captcha', true, 'tidak muncul, lanjut');
    }

    // 7. Tombol Next/Lanjut setelah captcha
    const nextBtn = page.getByRole('button', { name: /next|continue|lanjut/i }).first();
    if ((await nextBtn.count()) > 0) {
      await nextBtn.click().catch(() => {});
      await sleep(rand(4000, 6000));
      step('next', true, 'diklik');
    }

    // 8. Kode OTP email — jalur Gmail stok: worker minta operator ketik di panel
    // (marker OTP_REQUIRED; polling temp-mail dilewati). Jalur temp-mail: poll inbox.
    let code = '';
    if (stockGmail || MANUAL_EMAIL_ARG) {
      console.log('[OTP_REQUIRED] IG minta kode verifikasi — ketik kode dari inbox ' + (stockGmail ? 'Gmail stok #' + stockGmail.id : result.email) + ' di panel (kartu OTP). Menunggu max 8 menit.');
      step('otp', false, 'menunggu operator memasukkan kode OTP di panel...');
      if (stockGmail) markStockGmailUsed(); // email sudah tercatat di IG — tahan crash
      code = await askOperatorOtp();
    } else {
      for (let i = 0; i < 60 && !code; i++) {
        await sleep(5000);
        try {
          const list = await mailWorker.listMessages(alias);
          for (const prev of list) {
            if (!prev.id) continue;
            const msg = await mailWorker.getMessage(prev.id);
            const f = extractOtp(msg.text || msg.body || '', msg.html || '', msg.subject || '');
            if (f.code) { code = f.code; break; }
          }
        } catch (e) { /* polling lanjut */ }
      }
    }
    step('otp', !!code, code ? `kode: ${code}` : 'tidak masuk');

    // 9. Isi kode bila ada kolomnya
    if (code) {
      const codeInput = page.getByLabel(/code|kode/i).first();
      if ((await codeInput.count()) > 0) {
        await typeHuman(codeInput, code);
        await sleep(2000);
        const confirmBtn = page.getByRole('button', { name: /confirm|next|submit/i }).first();
        if ((await confirmBtn.count()) > 0) await confirmBtn.click().catch(() => {});
        // Tunggu hasil konfirmasi JANGAN buru-buru pindah — baca state halaman
        await sleep(rand(8000, 12000));
        const afterConfirmUrl = page.url();
        const afterConfirmText = await page.evaluate(() => document.body ? document.body.innerText : '').catch(() => '');
        step('confirm', true, `kode diisi | ${afterConfirmUrl.slice(0, 80)}`);
        result.notes = result.notes || [];
        result.notes.push('After-confirm: ' + (afterConfirmText || '').slice(0, 300).replace(/\n+/g, ' | '));
        try { await page.screenshot({ path: 'ig-after-confirm.png' }); } catch (e) { /* abaikan */ }
      } else {
        step('confirm', false, 'kolom kode tidak ketemu — isi manual di browser bila ada');
      }
    }

    // 9a. Login eksplisit (IG web tidak auto-login habis daftar)
    try {
      let loginOpened = await gotoRetry('https://www.instagram.com/accounts/login/');
      if (!loginOpened) loginOpened = await gotoRetry('https://www.instagram.com/');
      if (!loginOpened) throw new Error('halaman login/root tak terbuka via proxy (3x coba)');
      await sleep(rand(3000, 5000));
      const loginInputs = page.locator('input');
      if ((await loginInputs.count()) >= 2) {
        await typeHuman(loginInputs.nth(0), result.username);
        await typeHuman(page.locator('input[type="password"]').first(), password);
        const loginBtn = page.getByRole('button', { name: /^log in$/i }).first();
        if ((await loginBtn.count()) > 0) {
          await loginBtn.click();
          await sleep(rand(6000, 9000));
        }
      }
      // Tutup dialog "Save login info / Turn on notifications" bila muncul
      for (const name of [/not now/i, /save/i]) {
        const b = page.getByRole('button', { name }).first();
        if ((await b.count()) > 0) await b.click().catch(() => {});
        await sleep(1500);
      }
      step('login', true, 'dicoba');
    } catch (e) {
      step('login', false, e.message.slice(0, 100));
    }

    // 9b. Verifikasi: cookie sessionid + fetch same-origin profil (bukan innerText — sering
    // false-negative karena dialog onboarding "Simpan info login" menutupi teks beranda).
    let homeOk = false, profileOk = false;
    try {
      const hasSess = (await context.cookies().catch(() => [])).some((c) => c.name === 'sessionid');
      const profFetch = async () => page.evaluate(async (u) => {
        try {
          const res = await fetch('/' + u + '/', { credentials: 'include' });
          const t = await res.text();
          return { status: res.status, has: t.includes(u) };
        } catch (e) { return { status: 0, has: false }; }
      }, result.username);
      let pf = await profFetch();
      if (pf.status === 429) { await sleep(30000); pf = await profFetch(); }
      homeOk = hasSess; // cookie sessionid = bukti login cukup
      profileOk = pf.status === 200 && pf.has;
      step('home', homeOk, homeOk ? 'sessionid ada' : 'sessionid tidak ada');
      step('profile', profileOk, profileOk ? 'profil kebuka: ' + result.username : 'profil HTTP ' + pf.status);
      try { await page.screenshot({ path: 'ig-home.png' }); } catch (e) { /* abaikan */ }
    } catch (e) {
      step('home', false, e.message.slice(0, 100));
    }
    try { await page.screenshot({ path: 'ig-profile.png' }); } catch (e) { /* abaikan */ }

    // Gmail stok sukses dipakai daftar IG — tandai pool 'used utk ig' (platform
    // IG memasangkan dirinya ke used_by; jalur FB tetap kebal dgn platform 'fb').
    // PARTIAL AKUN LAHIR juga dianggap TERPAKAI: wizard sudah tuntas sampai layar
    // terms (termsPassed) berarti akun resmi ada walau verifikasi belum tuntas —
    // email ini tak boleh nongol 'available' di dropdown (pelajaran 12/10 #24).
    if (stockGmail && (result.status === 'success' || termsPassed)) {
      try {
        require('./db').markGmailUsed(stockGmail.id, 'ig', (result.username || result.email || '').split('@')[0]);
        console.log('[GMAIL] pool #' + stockGmail.id + ' ditandai used utk ig' + (result.status !== 'success' ? ' (partial akun lahir)' : '') + ':' + String(result.username || result.email || '').split('@')[0]);
      } catch (e) { console.log('[GMAIL] tandai used gagal: ' + e.message); }
    }

    // 9c. FLUSH SESSION AWAL utk mode --keep-open: operator sering melanjutkan manual
    // (2FA dsb) lalu browser ditutup via Ctrl+C — simpan cookies SEKARANG supaya
    // sesi tidak hilang; file diperbarui lagi di langkah 10 bila alur penuh selesai.
    if (process.argv.includes('--keep-open') && result.username) {
      try {
        const sessDir0 = path.join(__dirname, '..', 'sessions');
        try { fs.mkdirSync(sessDir0, { recursive: true }); } catch (e0) { /* abaikon */ }
        const flushPath = path.join(sessDir0, `ig-${result.username}.json`);
        const flushCookies = await context.cookies().catch(() => []);
        fs.writeFileSync(flushPath, JSON.stringify({
          platform: 'instagram', username: result.username, email: result.email,
          password, cookies: flushCookies, created_at: new Date().toISOString(),
          proxy: PROXY_ARG || null, birth_ip: birthIp || null, phone: result.phone || null,
        }, null, 2));
        step('session-early', true, `${flushCookies.length} cookie tersimpan (flush awal)`);
      } catch (e) { step('session-early', false, e.message.slice(0, 80)); }
    }

    // 10. Simpan session
    const cookies = await context.cookies().catch(() => []);
    const sessionDir = path.join(__dirname, '..', 'sessions');
    try { fs.mkdirSync(sessionDir, { recursive: true }); } catch (e) { /* abaikan */ }
    const sessionPath = path.join(sessionDir, `ig-${result.username}.json`);
    fs.writeFileSync(sessionPath, JSON.stringify({
      platform: 'instagram', username: result.username, email: result.email,
      password, cookies, created_at: new Date().toISOString(),
      proxy: PROXY_ARG || null, birth_ip: birthIp || null, phone: result.phone || null
    }, null, 2));
    step('session', true, sessionPath);

    // 10b. CAPTURE 2FA — sesi masih hangat, buka menu Autentikasi dua faktor dan
    // ambil teks kunci SEKALI: begitu kunci masuk DB, login berikutnya yang kena 2FA
    // dihitung panel sendiri (tanpa HP). Gagal di sini tidak menggagalkan akun —
    // operator bisa paste kunci manual nanti (kolom 2FA di halaman Akun).
    try {
      step('2fa', false, 'buka menu Autentikasi dua faktor...');
      await gotoRetry('https://www.instagram.com/accounts/two_fac/2fa/settings/', 2);
      await sleep(rand(6000, 9000));
      let t2fa = await pageText();
      const authOpt = page.getByText(/aplikasi autentikasi|authentication app/i).first();
      if ((await authOpt.count().catch(() => 0)) > 0) {
        await authOpt.click().catch(() => {});
        await sleep(rand(5000, 8000));
        t2fa = await pageText();
      }
      // IG menampilkan teks kunci berformat base32 berkelompok (mis. GPT7 DQ5H EBCA
      // 2EWL). Ambil kandidat terpanjang — QR tak terbaca page evaluate, teks selalu tampil.
      const secM = /[A-Z2-7][A-Z2-7\s-]{14,80}/.exec(t2fa || '');
      if (secM) {
        const secretB32 = require('./totp').normalizeSecret(secM[0]);
        if (secretB32) {
          fs.mkdirSync(path.join(__dirname, '..', 'sessions'), { recursive: true });
          fs.writeFileSync(path.join(__dirname, '..', 'sessions', `ig-${result.username}.totp`), secretB32 + '\n');
          step('2fa', true, 'kunci 2FA disimpan ke file (register ke panel akan membacanya — GPT7****).');
          console.log('[2FA] kunci autentikator tercapture dan disimpan: ' + secretB32.slice(0, 4) + '****');
        } else step('2fa', false, 'teks kunci ditemukan tapi tidak base32 valid');
      } else {
        step('2fa', false, 'teks kunci tidak ketemu (UI IG beda / menu tidak terbuka) — paste manual nanti');
        try { await page.screenshot({ path: 'ig-2fa-unknown.png' }); } catch (e) { /* abaikan */ }
      }
    } catch (e) {
      step('2fa', false, 'gagal buka menu 2FA: ' + e.message.slice(0, 80));
    }

    // Simpan hasil terstruktur untuk panel (kredensial + proxy + IP lahir).
    try {
      writeResultFile({
        platform: 'ig', status: result.status, username: result.username, email: result.email,
        password, fullName, proxy: PROXY_ARG || null, birthIp: birthIp || null,
        phone: result.phone || null,
        spoof: igSpoof ? { canvas_seed: '0x' + igSpoof.canvasSeed.toString(16), audio_seed: '0x' + igSpoof.audioSeed.toString(16), webgl: igSpoof.webgl } : null,
        sessionFile: sessionPath, createdAt: new Date().toISOString(),
      });
    } catch (e) { /* non-fatal */ }
    try { await page.screenshot({ path: 'ig-create-result.png' }); } catch (e) { /* abaikan */ }

    const url = page.url();
    if (homeOk && profileOk) {
      result.status = 'success';
    } else if (/challenge|checkpoint|login/i.test(url) && cookies.length < 3) {
      result.status = 'partial';
      result.error = 'butuh langkah manual lanjutan, lihat ig-create-result.png';
    } else {
      result.status = 'partial';
      result.error = result.error || (code ? 'verifikasi beranda/profil gagal' : 'otp_not_received');
    }
    console.log('\nHASIL:', result.status, '|', result.email, '|', result.error || '-');
    // Perbarui file hasil dengan status FINAL (kartu hasil panel harus menampilkan
    // status yang benar — bukan 'failed' default yang tertulis sebelum verifikasi).
    try {
      writeResultFile({
        platform: 'ig', status: result.status, username: result.username, email: result.email,
        password, fullName, proxy: PROXY_ARG || null, birthIp: birthIp || null,
        spoof: igSpoof ? { canvas_seed: '0x' + igSpoof.canvasSeed.toString(16), audio_seed: '0x' + igSpoof.audioSeed.toString(16), webgl: igSpoof.webgl } : null,
        sessionFile: sessionPath, createdAt: new Date().toISOString(),
      });
    } catch (e) { /* non-fatal */ }
  } catch (e) {
    result.status = 'failed';
    result.error = e.message;
    console.log('\nHASIL: failed |', e.message);
    // GMAIL STOK SUDAH KEPERNAHAN KIRIM/PAKAI: kalau run gagal SETELAH OTP operator
    // diisi ([OTP_GOT] bekas di log — OTP hanya dikirim ke email itu), email stok
    // tetap terpakai walau status akun failed. Tanpa ini Gmail kembali 'available'
    // dan bisa dipakai daftar ulang — OTP kedua tak pernah datang. Guard disini
    // dgn cek step 'otp' ok.*  (udah diperbaiki di atas)  + tanda askOperatorOtp
    // menerima nggak: bila OTP_GOT pernah tercetak, tandai used.
    if (stockGmail && (result.steps || []).some((s) => /otp/i.test(s.name) && /kode dari operator/i.test(s.msg || ''))) {
      try {
        require('./db').markGmailUsed(stockGmail.id, 'ig', (result.username || result.email || '').split('@')[0]);
        console.log('[GMAIL] pool #' + stockGmail.id + ' ditandai used (OTP sudah dikirim walau run gagal): ' + String(result.username || result.email || '').split('@')[0]);
      } catch (e5) { console.log('[GMAIL] tandai used (otp-sent failed) gagal: ' + e5.message); }
    }
    // Jangan tutup apa-apa lagi: tulis draft session + file hasil SEKARANG kalau ada
    // kredensial yang sudah merikel lama — sulit menyimpannya saat run berhenti manual
    // (pola sama dgn flush awal langkah 9c: tagih kredensial SIAP SAAT TERMINAL.
    // Untuk mode nomor HP: OTP virtual sekali pakai — kalau nomor fraud bail,
    // tidak punya denyut kedua.
    if (context && result.username) {
      try {
        fs.mkdirSync(path.join(__dirname, '..', 'sessions'), { recursive: true });
        const cks = await context.cookies().catch(() => []);
        fs.writeFileSync(path.join(__dirname, '..', 'sessions', `ig-${result.username}.json`), JSON.stringify({
          platform: 'instagram', username: result.username, email: result.email,
          password: result.password || null, cookies: cks, created_at: new Date().toISOString(),
          proxy: PROXY_ARG || null, phone: result.phone || null,
          note: 'draft: run gagal — kredensial + cookie apa adanya',
        }, null, 2));
        step('session-draft', true, `${cks.length} cookie tersimpan (draft run gagal)`);
      } catch (e2) { step('session-draft', false, String(e2.message || e2).slice(0, 80)); }
    }
  } finally {
    console.log('\nRingkasan:', JSON.stringify(result.steps, null, 1));
    if (result.notes) console.log('Catatan:', JSON.stringify(result.notes, null, 1));
    // --keep-open: browser dibiarkan terbuka biar bisa dicek/lanjut manual.
    // Tutup manual dengan Ctrl+C di terminal.
    if (process.argv.includes('--keep-open') && browser) {
      console.log('\n*** BROWSER DIBIARKAN TERBUKA — cek/lanjut manual, Ctrl+C untuk tutup ***');
      process.on('SIGINT', async () => {
        console.log('\nMenutup browser...');
        await browser.close().catch(() => {});
        process.exit(0);
      });
      await new Promise(() => {});
    }
    if (browser) await browser.close().catch(() => {});
  }
})();
