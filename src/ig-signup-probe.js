'use strict';

/**
 * IG Signup Probe — tes kelayakan IP untuk signup IG. BUKAN creator penuh.
 * Alur: buat inbox Ammail → buka form daftar IG → isi form → submit 1x →
 * baca tantangan yang muncul → VERDICT: layak / dicurigai / ragu.
 * Tujuan: gali kelayakan IP SEBELUM create penuh, supaya email/identitas tidak terbuang.
 * Hasil ditulis ke sessions/last-probe-ig.json untuk panel.
 * Run: node src/ig-signup-probe.js [proxy]
 *   proxy format: host:port:user:pass  (opsional; kosong = IP langsung)
 */

require('dotenv').config();
const { chromium } = require('patchright'); // engine panel: patchright (drop-in playwright)
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const PROXY_ARG = process.argv[2] || null;

function parseProxy(str) {
  if (!str) return null;
  const raw = str.trim();
  // Buang http:// bila format user:pass tanpa @ (URL dibiarkan utuh).
  const norm = raw.includes('@') ? raw : raw.replace(/^\w+:\/\//, '');
  const urlMatch = norm.match(/^(socks[45]?|https?|http):\/\/(?:([^:@]+):([^@]+)@)?([^:]+):(\d+)$/i);
  if (urlMatch) {
    const proxy = { server: `${urlMatch[1]}://${urlMatch[4]}:${urlMatch[5]}` };
    if (urlMatch[2]) { proxy.username = urlMatch[2]; proxy.password = urlMatch[3]; }
    return proxy;
  }
  const parts = norm.split(':');
  if (parts.length >= 2) {
    const proxy = { server: `http://${parts[0]}:${parts[1]}` };
    if (parts[2]) proxy.username = parts[2];
    if (parts[3]) proxy.password = parts.slice(3).join(':');
    return proxy;
  }
  return null;
}

function makeHttp(url, options) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const protocol = urlObj.protocol === 'https:' ? https : http;
    const req = protocol.request({
      hostname: urlObj.hostname,
      port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: options.method || 'GET',
      headers: options.headers || {}
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { resolve({ raw: data }); }
      });
    });
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

async function createInbox() {
  const baseUrl = (process.env.AMMAIL_BASE_URL || '').replace(/\/+$/, '');
  const apiKey = process.env.AMMAIL_API_KEY || '';
  if (!baseUrl || !apiKey) throw new Error('Ammail belum dikonfigurasi');
  // Alias manusiawi + rotasi domain (helper sama dengan creator).
  const em = require('./email-alias').makeEmail();
  const res = await makeHttp(`${baseUrl}/api/inboxes`, {
    method: 'POST',
    headers: { 'X-API-Key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ alias: em.alias, domain: em.domain })
  });
  if (!res.inbox || !res.inbox.email) throw new Error('Gagal bikin inbox: ' + JSON.stringify(res).slice(0, 200));
  return res.inbox.email;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const pageText = (page) => page.evaluate(() => document.body ? document.body.innerText : '').catch(() => '');

(async () => {
  const result = {
    status: 'probed', verdict: 'ragu', verdictReason: '',
    challenge: 'unknown', email: null, ip: null, notes: [], createdAt: new Date().toISOString(),
  };
  let browser = null;
  try {
    result.email = await createInbox();
    console.log('Inbox:', result.email);

    const launchOptions = {
      headless: false,
      args: ['--disable-dev-shm-usage', '--no-sandbox'] // tanpa flag anti-automation: patchright melarang
    };
    const proxy = parseProxy(PROXY_ARG);
    if (proxy) {
      launchOptions.proxy = proxy;
      console.log('Proxy:', proxy.server);
    } else {
      console.log('Tanpa proxy (IP langsung)');
    }

    browser = await chromium.launch(launchOptions);
    // Profil mobile Indonesia — sama dengan creator penuh supaya hasil probe mewakili.
    const context = await browser.newContext({
      viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2,
      locale: 'id-ID', timezoneId: 'Asia/Jakarta',
      userAgent: 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36'
    });
    // Tanpa addInitScript webdriver — patchright menangani di level engine.
    const page = await context.newPage();

    // Catat IP keluar dulu (bukti IP yang sedang dites).
    try {
      const r = await context.request.get('https://api.ipify.org?format=text', { timeout: 20000 });
      if (r.ok()) { result.ip = (await r.text()).trim(); console.log('IP:', result.ip); }
    } catch (e) { /* opsional */ }

    await page.goto('https://www.instagram.com/accounts/emailsignup/', { timeout: 60000, waitUntil: 'domcontentloaded' });
    await sleep(rand(3000, 5000));

    let bodyText = await pageText(page);
    const suspendedEarly = /accounts\/suspended|akun dinonaktifkan|account (has been )?disabled/i.test(page.url() + ' ' + (bodyText || ''));
    if (suspendedEarly) {
      result.challenge = 'suspended_on_load';
      result.verdict = 'dicurigai';
      result.verdictReason = 'IP langsung diarahkan ke halaman suspended sebelum isi form — sangat di-flag';
      result.notes.push('Halaman daftar langsung diblokir/suspended');
    } else if (/something went wrong|try again later|challenge/i.test(bodyText || '') && !(await page.$('input[name="emailOrPhone"]'))) {
      result.challenge = 'blocked_on_load';
      result.verdict = 'dicurigai';
      result.verdictReason = 'Halaman daftar diblokir sebelum isi form';
      result.notes.push('Halaman daftar langsung diblokir sebelum isi form');
    } else {
      // Isi form wizard mobile (1 layar 1 langkah) — email → sandi → ultah → nama → username.
      const fullName = 'Sari Wulandari';
      const username = `sari.wulandari${rand(1000, 9999)}`;
      const password = `TestPass${rand(100, 999)}!@#`;

      const typeLikeHuman = async (locator, value) => {
        await locator.click();
        await sleep(rand(200, 500));
        await locator.fill('');
        for (const ch of value) {
          await locator.type(ch, { delay: rand(50, 180) });
          if (Math.random() < 0.1) await sleep(rand(200, 600));
        }
        await sleep(rand(600, 1400));
      };
      const clickNext = async () => {
        const cands = await page.getByRole('button').all().catch(() => []);
        for (const b of cands) {
          const t = ((await b.textContent().catch(() => '')) || '').trim();
          if (/ponsel|phone/i.test(t)) continue;
          if (/^(berikutnya|lanjutkan|lanjut|next|continue|daftar|sign up|buat akun)$/i.test(t)) {
            if (!(await b.isDisabled().catch(() => true))) {
              await b.click().catch(() => {});
              await sleep(rand(3500, 5500));
              return true;
            }
          }
        }
        return false;
      };

      let filled = 0;
      for (let s = 0; s < 12; s++) {
        const t = await pageText(page);
        const inputs = page.locator('input');
        const n = await inputs.count().catch(() => 0);
        if (/accounts\/suspended|akun dinonaktifkan|account (has been )?disabled/i.test(page.url() + ' ' + t)) {
          result.challenge = 'suspended_mid';
          result.verdict = 'dicurigai';
          result.verdictReason = 'IP di-suspend IG di tengah wizard — pool IP di-flag untuk signup';
          break;
        }
        if (/i'm not a robot|confirm it's you|robot/i.test(t)) {
          // Captcha penuh = layak tapi ada kerja manual; jangan submit (tak buang email).
          result.challenge = 'captcha_before_submit';
          result.verdict = 'layak';
          result.verdictReason = 'IP lolos sampai captcha — selesaikan manual lalu bot lanjut (alur create penuh aman)';
          break;
        }
        if (/kode konfirmasi|confirmation|enter.*code|6-digit/i.test(t) && n > 0) {
          result.challenge = 'email_code';
          result.verdict = 'layak';
          result.verdictReason = 'IP lolos sampai minta kode email — signup berjalan normal';
          break;
        }
        if (/masukkan kode|enter the code|dengarkan kode|get.*code|dapatkan kode/i.test(t) && n === 0) {
          result.challenge = 'human_check';
          result.verdict = 'ragu';
          result.verdictReason = 'IG minta verifikasi manusia/kode audio sebelum lanjut — IP sedang diawasi';
          break;
        }
        if (/daftar dengan email|sign up with email/i.test(t)) {
          const opt = page.getByRole('button', { name: /daftar dengan email|sign up with email/i }).first();
          if ((await opt.count()) > 0) { await opt.click().catch(() => {}); await sleep(rand(3000, 5000)); continue; }
        }
        if (/apa email|your email|alamat email/i.test(t) && n > 0) {
          await typeLikeHuman(inputs.first(), result.email);
          if (!(await clickNext())) result.notes.push('tombol next email ga ketemu');
          filled++; continue;
        }
        if (/kata sandi|buat.*sandi|create.*password|^password/i.test(t)) {
          const pw = page.locator('input[type="password"]').first();
          if ((await pw.count()) > 0) { await typeLikeHuman(pw, password); await clickNext(); filled++; continue; }
        }
        if (/ulang tahun|birthday|tanggal lahir/i.test(t)) {
          const nativeDate = page.locator('input[type="date"], input[aria-label*="anggal lahir" i], input[aria-label*="date of birth" i]').first();
          if ((await nativeDate.count()) > 0) {
            const iso = '1996-11-02';
            await nativeDate.click().catch(() => {});
            await nativeDate.evaluate((el, val) => {
              Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(el, val);
              el.dispatchEvent(new Event('input', { bubbles: true }));
              el.dispatchEvent(new Event('change', { bubbles: true }));
            }, iso).catch(() => {});
            await clickNext(); filled++; continue;
          }
        }
        if (/nama lengkap|full name|siapa nama|your name/i.test(t) && n > 0) {
          await typeLikeHuman(inputs.first(), fullName);
          await clickNext(); filled++; continue;
        }
        if (/nama pengguna|username/i.test(t) && n > 0) {
          const uin = inputs.first();
          await typeLikeHuman(uin, username);
          // JANGAN submit wizard (itu yang bikin akun jadi/suspend). Verdict di sini:
          // sampai layar username tanpa error = form dapat diisi normal.
          const t2 = await pageText(page);
          result.challenge = 'reached_username';
          if (/tidak tersedia|not available/i.test(t2)) {
            result.verdict = 'layak';
            result.verdictReason = 'Sampai layar username (error nama saja) — form normal, IP layak dipakai';
          } else {
            result.verdict = 'layak';
            result.verdictReason = 'Sampai layar username tanpa blokir — form normal, IP layak dipakai';
          }
          break;
        }
        // Splash macet: reload
        if (!t.trim() && s <= 3) {
          try { await page.reload({ timeout: 30000 }); } catch (e) { /* abaikan */ }
          await sleep(8000);
          continue;
        }
        if (s === 4) result.notes.push('Layar tak dikenal: ' + (t || '(kosong)').slice(0, 140).replace(/\n+/g, ' | ') + ' | URL: ' + page.url().slice(0, 80));
        await sleep(4000);
      }
      if (result.verdict === 'ragu' && !result.verdictReason) {
        result.verdictReason = result.challenge === 'unknown' ? 'Tidak bisa mencapai form daftar (layar tak dikenal)' : '';
      }
      result.notes.push('Langkah terisi: ' + filled);
    }

    try { await page.screenshot({ path: 'ig-probe-result.png', fullPage: false }); result.notes.push('Screenshot: ig-probe-result.png'); } catch (e) { /* abaikan */ }

    console.log('\nHASIL PROBE IG: verdict=' + result.verdict + ' | challenge=' + result.challenge + ' | IP=' + (result.ip || '-') + ' | ' + result.verdictReason);
    console.log('Ringkasan:', JSON.stringify(result.notes, null, 1));
  } catch (e) {
    result.status = 'error';
    result.verdict = result.verdict || 'ragu';
    result.verdictReason = result.verdictReason || ('FATAL: ' + e.message);
    result.notes.push('FATAL: ' + e.message);
    console.log('\nHASIL PROBE IG: verdict=' + result.verdict + ' | ' + result.verdictReason);
    process.exitCode = 1;
  } finally {
    // Tulis file hasil untuk panel (selalu, biar verdict tak hilang).
    try {
      const dir = path.join(__dirname, '..', 'sessions');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'last-probe-ig.json'), JSON.stringify(result, null, 2));
    } catch (e) { /* non-fatal */ }
    if (browser) await browser.close().catch(() => {});
  }
})();
