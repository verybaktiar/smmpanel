'use strict';

/**
 * TikTok Signup Probe — BUKAN creator penuh.
 * Tugas: buka halaman daftar, coba alur email, submit 1x, laporkan tantangan
 * (slider_captcha | phone_required | blocked | email_code | unknown).
 * Alur UI mobile-ID (2026-09): /signup -> "Gunakan nomor telepon atau email" ->
 *   /signup/age-gate (wheel rmc-picker 3 kolom, flick touch) -> Berikutnya ->
 *   /signup/phone-or-email -> tab "Email" -> /signup/phone-or-email/email ->
 *   isi email -> "Berikutnya" (submit; memicu kode OTP).
 * Run: node src/tiktok-signup-probe.js [proxy]
 */
require('dotenv').config();
const { chromium } = require('patchright'); // engine panel: patchright (drop-in playwright)
const https = require('https');
const http = require('http');

const PROXY_ARG = process.argv.slice(2).find((a) => a !== '--keep-open') || null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

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

(async () => {
  const result = {
    status: 'probed', verdict: 'ragu', verdictReason: '', challenge: 'unknown',
    email: null, ip: null, notes: [], createdAt: new Date().toISOString(),
  };
  let browser = null;
  try {
    const baseUrl = (process.env.AMMAIL_BASE_URL || '').replace(/\/+$/, '');
    const apiKey = process.env.AMMAIL_API_KEY || '';
    // Alias manusiawi + rotasi domain (helper sama dengan IG).
    const em = require('./email-alias').makeEmail();
    const alias = em.alias;
    const inboxRes = await makeHttp(`${baseUrl}/api/inboxes`, {
      method: 'POST', headers: { 'X-API-Key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ alias: em.alias, domain: em.domain })
    });
    if (!inboxRes.inbox || !inboxRes.inbox.email) throw new Error('Gagal bikin inbox');
    result.email = inboxRes.inbox.email;
    console.log('Inbox:', result.email);

    const launchOptions = {
      headless: false,
      args: require('./stealth').launchArgs(),
    };
    if (PROXY_ARG) {
      const p = PROXY_ARG.split(':');
      launchOptions.proxy = { server: `http://${p[0]}:${p[1]}` };
      if (p[2]) { launchOptions.proxy.username = p[2]; launchOptions.proxy.password = p[3] || ''; }
      console.log('Proxy:', `http://${p[0]}:${p[1]}`);
    }
    // Chrome ASLI + stealth = fingerprint SAMA dengan creator — verdict probe
    // jadi prediksi valid untuk create sungguhan (probe pakai Chromium polos +
    // UA Chrome/120 hardcoded dulang: versi UA vs binary beda = sinyal bot yang
    // bikin verdict menyalahkan IP padahal fingerprint probe-nya sendiri).
    const stealth = require('./stealth');
    if (process.env.TT_CHROME !== '0') {
      try { browser = await chromium.launch({ ...launchOptions, channel: 'chrome' }); }
      catch (e) { console.log('Chrome asli tak tersedia, fallback Chromium:', String(e.message).split('\n')[0].slice(0, 80)); }
    }
    if (!browser) browser = await chromium.launch(launchOptions);
    // Mode MOBILE ID default (koheren dengan proxy Indonesia) — sama dengan IG.
    const MOBILE = !process.argv.includes('--desktop');
    // Versi UA DISAMAKAN dengan browser nyata (UA bohong = sinyal bot klasik).
    const UA = stealth.alignUaVersion(
      MOBILE
        ? 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36'
        : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      browser.version()
    );
    const context = MOBILE
      ? await browser.newContext({
          viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true,
          deviceScaleFactor: 2, locale: 'id-ID', timezoneId: 'Asia/Jakarta',
          userAgent: UA,
        })
      : await browser.newContext({
          viewport: { width: 1366, height: 768 }, locale: 'id-ID', timezoneId: 'Asia/Jakarta',
          userAgent: UA,
        });
    // Patchright: anti-detect di level engine — TANPA init script manual.
    // Hardening CDP per halaman tetap: UA protokol + userAgentData + Accept-Language.
    const FP = { userAgent: UA, languages: ['id-ID', 'id', 'en-US', 'en'] };
    context.on('page', (pg) => { stealth.attachPageHardening(context, pg, FP).catch(() => {}); });
    const page = await context.newPage();
    // Rekaman respons API TikTok: jawaban send_code/captcha adalah sinyal verdict
    // paling andal (UI bisa diam, API tidak).
    const apiLog = [];
    page.on('response', async (resp) => {
      try {
        const u = resp.url();
        if (!/passport|passpoint|send_code|verify|captcha|challenge|check/i.test(u)) return;
        if (apiLog.length > 25) return;
        let body = '';
        try { body = (await resp.text()).slice(0, 220); } catch (e) { body = '<tak terbaca>'; }
        apiLog.push(`${resp.status()} ${u.slice(0, 110)} :: ${body.slice(0, 160)}`);
      } catch (e) { /* non-fatal */ }
    });
    await page.goto('https://www.tiktok.com/signup', { timeout: 60000, waitUntil: 'domcontentloaded' });
    await sleep(rand(5000, 8000));

    const snap = async (label) => {
      const t = await page.evaluate(() => document.body ? document.body.innerText : '').catch(() => '');
      result.notes.push(`${label} URL: ${page.url().slice(0, 100)}`);
      result.notes.push(`${label} teks: ${String(t).slice(0, 400).replace(/\n+/g, ' | ')}`);
      return String(t);
    };
    let bodyText = await snap('LOAD');

    // 0. Tutup cookie banner + interstitial "Dapatkan pengalaman lebih lengkap di aplikasi"
    for (const name of [/decline/i, /reject/i, /necessary only/i]) {
      const b = page.getByRole('button', { name }).first();
      if ((await b.count()) > 0) {
        await b.click().catch(() => {});
        await sleep(2000);
        result.notes.push('Cookie banner ditutup');
        break;
      }
    }
    for (const t of ['Nanti saja', 'Not now', 'Later', 'Skip']) {
      const el = page.getByText(t, { exact: false }).first();
      if ((await el.count()) > 0) { await el.click({ timeout: 5000 }).catch(() => {}); await sleep(2000); break; }
    }

    // 1. Landing -> tap "Gunakan nomor telepon atau email" (klik koordinat via
    //    touchscreen: locator.click polos terbukti kadang diabaikan UI baru).
    const tapText = async (texts) => {
      for (const t of texts) {
        const el = page.getByText(t, { exact: true }).first();
        if ((await el.count()) === 0) continue;
        const box = await el.boundingBox().catch(() => null);
        if (!box) continue;
        if (MOBILE) await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2).catch(() => {});
        else await el.click({ timeout: 8000 }).catch(() => {});
        await sleep(3500);
        return t;
      }
      return null;
    };
    const clicked1 = await tapText(['Gunakan nomor telepon atau email', 'Use phone or email']);
    result.notes.push('Klik landing: ' + (clicked1 || 'GAGAL'));

    // 2. Age-gate: wheel rmc-picker 3 kolom [tahun, bulan, hari] — flick touch asli.
    //    Bacaan sel = item terdekat ke .rmc-picker-indicator (.rmc-picker-item-selected
    //    TIDAK ADA di UI baru; bacaan lama = NaN = birthday gagal diam-diam).
    const onAgeGate = /age-gate/.test(page.url()) || (await page.locator('.rmc-picker:visible').count()) > 0;
    if (onAgeGate) {
      const cdp = await context.newCDPSession(page);
      const readSel = (i) => page.evaluate((i) => {
        const pickers = [...document.querySelectorAll('.rmc-picker')].filter((e) => e.offsetParent !== null);
        const col = pickers[i]; if (!col) return '';
        const ind = col.querySelector('.rmc-picker-indicator');
        const items = [...col.querySelectorAll('.rmc-picker-item')];
        if (!ind || !items.length) return '';
        const ir = ind.getBoundingClientRect(); const ic = ir.top + ir.height / 2;
        let best = null, bd = 1e9;
        for (const it of items) { const r = it.getBoundingClientRect(); const c = r.top + r.height / 2; const d = Math.abs(c - ic); if (d < bd) { bd = d; best = it; } }
        return best ? (best.innerText || '').trim() : '';
      }, i);
      const itemH = await page.evaluate(() => {
        const col = [...document.querySelectorAll('.rmc-picker')].filter((e) => e.offsetParent !== null)[0];
        const it = col && col.querySelector('.rmc-picker-item');
        return it ? it.getBoundingClientRect().height : 42;
      });
      const flick = async (i, dy) => {
        const box = await page.locator('.rmc-picker:visible').nth(i).boundingBox().catch(() => null);
        if (!box) return;
        const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: cx, y: cy }] });
        for (let s = 1; s <= 6; s++) {
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: cx, y: cy + (dy * s) / 6 }] });
          await sleep(35);
        }
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await sleep(900);
      };
      const MONTHS = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
      const ORDER = [null, MONTHS, null];
      const TARGET = ['1998', 'Juli', '8'];
      const bd = [false, false, false];
      for (let i = 0; i < 3; i++) {
        for (let k = 0; k < 12 && !bd[i]; k++) {
          const cur = await readSel(i);
          if (cur === TARGET[i]) { bd[i] = true; break; }
          const idxOf = (s) => (ORDER[i] ? ORDER[i].indexOf(s) : parseInt(s, 10));
          const a = idxOf(cur), b = idxOf(TARGET[i]);
          if (!isFinite(a) || !isFinite(b)) break;
          const dy = Math.sign(a - b) * Math.min(Math.abs(a - b) * itemH, itemH * 6);
          await flick(i, dy);
        }
      }
      result.notes.push('Birthday wheel: ' + bd.join('/'));
      if (bd.every((v) => v === true)) {
        const nextB = page.getByRole('button', { name: /berikutnya|next/i }).first();
        if ((await nextB.count()) > 0 && !(await nextB.isDisabled().catch(() => true))) {
          await nextB.click().catch(() => {});
          await sleep(4000);
        }
      }
    } else {
      // UI lama: tab email langsung di landing (desktop EN / varian lama)
      await tapText(['Sign up with email', 'Daftar dengan email', 'Gunakan email', 'Lanjutkan dengan email']);
    }
    // Fallback UI lama: pilih birthday via combobox
    if (/age-gate/.test(page.url())) {
      const pickTT = async (boxNames, optionTexts) => {
        for (const boxName of boxNames) {
          const box = page.locator('[role="combobox"]', { hasText: new RegExp(`^${boxName}`, 'i') }).first();
          if ((await box.count()) === 0) continue;
          await box.click({ timeout: 8000 }).catch(() => {});
          await sleep(1800);
          for (const optionText of optionTexts) {
            const opt = page.locator('[role="option"], [role="listitem"]', { hasText: new RegExp(`^${optionText}$`, 'i') }).first();
            if ((await opt.count()) > 0) { await opt.click({ timeout: 8000 }).catch(() => {}); await sleep(1000); return true; }
          }
        }
        return false;
      };
      await pickTT(['Month', 'Bulan'], ['Juli', 'July']);
      await pickTT(['Day', 'Tanggal'], ['8']);
      await pickTT(['Year', 'Tahun'], ['1998']);
    }

    const tabCheck = await page.evaluate(() => document.body ? document.body.innerText : '').catch(() => '');
    const onEmailTab = /\/email/i.test(page.url()) || /email address|alamat email/i.test(tabCheck || '');
    result.notes.push('Tab email: ' + onEmailTab);

    // 3. Halaman phone-or-email: klik tab "Email" (exact — container "Telepon\nEmail")
    if (/phone-or-email/.test(page.url()) && !/\/email/.test(page.url())) {
      const tabEmail = page.getByText('Email', { exact: true }).first();
      if ((await tabEmail.count()) > 0) {
        await tabEmail.click({ timeout: 8000 }).catch(() => {});
        await sleep(3000);
        result.notes.push('Tab Email diklik');
      }
    }
    bodyText = await snap('EMAIL-TAB');

    // 4. Isi email (+ password bila UI masih menyediakan)
    const emailBox = page.locator('input[type="email"], input[name="email"], input[placeholder*="mail" i]').first();
    if ((await emailBox.count()) > 0) {
      await emailBox.click().catch(() => {});
      await emailBox.fill(result.email).catch(() => {});
      result.notes.push('Email terisi');
    } else {
      result.notes.push('Kolom email tidak ketemu');
    }
    const passBox = page.locator('input[type="password"]').first();
    if ((await passBox.count()) > 0) {
      const pw = `TestPass${rand(100, 999)}!@#`;
      await passBox.click().catch(() => {});
      await passBox.fill(pw).catch(() => {});
      result.notes.push('Password terisi');
    }

    // 5. Submit 1x — tombol "Berikutnya" (UI baru) / "Kirim kode" / "Sign up" (lama)
    for (const name of [/kirim kode/i, /send code/i, /berikutnya/i, /^next/i, /sign up$/i, /^sign up/i, /^daftar/i]) {
      const b = page.getByRole('button', { name }).first();
      if ((await b.count()) > 0) {
        const dis = await b.isDisabled().catch(() => true);
        result.notes.push(`Tombol "${name}" disabled=${dis}`);
        if (!dis) {
          await b.click().catch(() => {});
          // Sampel 3x: UI baru kadang lambat — slider/iframe captcha bisa muncul belakangan.
          for (let w = 0; w < 3; w++) {
            await sleep(4000);
            const s = await page.evaluate(() => document.body ? document.body.innerText : '').catch(() => '');
            const frames = page.frames().map((f) => f.url()).filter((u) => u && u !== 'about:blank');
            if (/captcha|seret|slide|verifikasi|kode/i.test(s || '') || frames.some((u) => /captcha|verify|challenge/i.test(u))) {
              result.notes.push(`Submit+${(w + 1) * 4}s: aktivitas terdeteksi`);
              break;
            }
          }
          break;
        }
      }
    }
    bodyText = await snap('SUBMIT');
    // Iframe captcha/verification (TikTok menaruh slider di iframe — body text kosong)
    const frameUrls = page.frames().map((f) => f.url()).filter((u) => u && !/about:blank|^$/.test(u));
    const capFrame = frameUrls.find((u) => /captcha|verify|challenge|security/i.test(u));
    if (capFrame) {
      result.notes.push('Iframe captcha: ' + capFrame.slice(0, 120));
      if (result.challenge === 'unknown') result.challenge = 'slider_captcha';
    }
    // Error inline di dekat kolom email (email ditolak, dsb.)
    const errText = await page.evaluate(() => {
      const el = [...document.querySelectorAll('[class*="error" i], [class*="Error"], [role="alert"], [aria-live]')]
        .find((e) => e.offsetParent !== null && (e.innerText || '').trim());
      return el ? (el.innerText || '').trim().slice(0, 160) : '';
    }).catch(() => '');
    if (errText) result.notes.push('Inline error: ' + errText);
    if (apiLog.length) result.notes.push('API: ' + apiLog.slice(-6).join(' || '));

    const t = bodyText || '';
    // API paling jujur: error_code 7 "Frekuensi kunjungan terlalu sering" = IP
    // di-throttle TikTok (batas percobaan 24 jam) — sama artinya dengan blocked.
    const apiStr = apiLog.join('\n');
    if (/error_code"\s*:\s*7|Frekuensi kunjungan|terlalu sering|Batas percobaan/i.test(apiStr)) {
      result.challenge = 'blocked_after_submit';
      result.notes.push('TikTok error_code 7 — IP kena batas percobaan 24 jam');
    } else if (/drag.*(slider|puzzle)|slide to|verify.*drag|captcha|seret/i.test(t)) {
      result.challenge = 'slider_captcha';
    } else if (/enter.*code|verification code|kode verifikasi|masukkan kode|6-digit|kirim ulang|resend/i.test(t)) {
      result.challenge = 'email_code';
    } else if (/phone.*required|enter.*phone|mobile number.*required|nomor telepon.*wajib|sms/i.test(t)) {
      result.challenge = 'phone_required';
    } else if (/blocked|banned|suspicious|too many|try again later|diblokir|terlalu banyak|terlalu sering|coba lagi nanti|error/i.test(t)) {
      result.challenge = 'blocked_after_submit';
    } else {
      result.challenge = 'unknown';
    }
    // IP keluar (aturan 1 akun = 1 IP): catat untuk kartu verdict.
    try {
      const pg = await context.newPage();
      const ipBody = await pg.goto('https://api.ipify.org?format=json', { timeout: 15000 }).then((r) => r.text()).catch(() => '');
      const m = /"ip"\s*:\s*"([0-9.]+)"/.exec(ipBody || '');
      if (m) result.ip = m[1];
      await pg.close().catch(() => {});
    } catch (e) { /* abaikan */ }
    console.log('IP:', result.ip || 'tak terbaca');
    // Verdict sama semantiknya dengan IG: lolos sampai minta kode = layak;
    // slider/blokir setelah submit = dicurigai; ragu untuk hasil tak jelas.
    if (result.challenge === 'email_code') {
      result.verdict = 'layak';
      result.verdictReason = 'IP lolos sampai minta kode email — signup berjalan normal';
    } else if (result.challenge === 'slider_captcha' || result.challenge === 'blocked_after_submit') {
      result.verdict = 'dicurigai';
      const throttle = result.notes.some((n) => /error_code 7/.test(n));
      result.verdictReason = throttle
        ? 'IP kena batas percobaan TikTok (error_code 7 — Frekuensi kunjungan terlalu sering). Rotasi IP (airplane mode 10 detik) sebelum create.'
        : 'Tantangan/blokir muncul setelah submit — IP dicurigai TikTok';
    } else if (result.challenge === 'phone_required') {
      result.verdict = 'ragu';
      result.verdictReason = 'TikTok minta nomor HP — alur email tidak tersedia untuk IP ini';
    } else {
      result.verdict = 'ragu';
      result.verdictReason = 'Hasil tidak jelas — cek notes/screenshot';
    }
    try { await page.screenshot({ path: 'tiktok-probe-result.png' }); result.notes.push('Screenshot: tiktok-probe-result.png'); } catch (e) { /* abaikan */ }
    result.status = 'probed';
    try {
      const fs = require('fs');
      const path = require('path');
      fs.mkdirSync(path.join(__dirname, '..', 'sessions'), { recursive: true });
      fs.writeFileSync(path.join(__dirname, '..', 'sessions', 'last-probe-tiktok.json'), JSON.stringify(result, null, 2));
    } catch (e) { /* abaikan */ }
    console.log('\nHASIL PROBE TIKTOK:', JSON.stringify(result, null, 2));
  } catch (e) {
    result.status = 'error';
    result.notes.push('FATAL: ' + e.message);
    console.log('\nHASIL PROBE TIKTOK:', JSON.stringify(result, null, 2));
    process.exitCode = 1;
  } finally {
    if (process.argv.includes('--keep-open') && browser) {
      console.log('\n*** BROWSER DIBIARKAN TERBUKA ***');
      await new Promise(() => {});
    }
    if (browser) await browser.close().catch(() => {});
  }
})();
