'use strict';
// Tes login FB pakai email+password tersimpan, lewat IP lahir (proxy yang sama).
// Kalau --profile <dir> diberikan, login dilakukan di profil persisten akun —
// cookies menempel permanen sehingga health-check & posting di panel langsung bisa.
// Run: node src/fb-login-check.js <email> <password> [proxy] [--profile <dir>]
require('dotenv').config();
const { chromium } = require('patchright'); // engine panel: patchright (drop-in playwright)
const fs = require('fs');
const path = require('path');

const _args = process.argv.slice(2);
const email = _args[0];
const password = _args[1] || '';
let proxyArg = '', profileDir = null;
for (const a of _args.slice(2)) {
  if (a === '--profile') { profileDir = _args[_args.indexOf(a) + 1]; continue; }
  if (!a || a === profileDir) continue;
  if (/:\/\/|^\d+\.\d+\.\d+\.\d+:\d+/.test(a) || /^\S+:\d+:\S+/.test(a)) proxyArg = a;
}
if (!email || !password) { console.log('Pakai: node src/fb-login-check.js <email> <password> [proxy] [--profile <dir>]'); process.exit(1); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function mailJson(url, apiKey) {
  const r = await fetch(url, { headers: { 'X-API-Key': apiKey, Accept: 'application/json' } });
  if (!r.ok) throw new Error(`email_api_http_${r.status}`);
  return r.json();
}

function extractConfirmationCode(subject, text, html) {
  const hay = [subject || '', text || '', String(html || '').replace(/<[^>]+>/g, ' ')].join('\\n');
  const labeled = hay.match(/(?:confirmation|verification|security)\\s*code[^0-9]{0,30}([0-9]{5})|(?:kode\\s*(?:konfirmasi|verifikasi))[^0-9]{0,30}([0-9]{5})/i);
  if (labeled) return labeled[1] || labeled[2];
  // Facebook's email often renders the five digits without a label.
  const loose = hay.match(/(?<![0-9])([0-9]{5})(?![0-9])/);
  return loose ? loose[1] : '';
}

async function listInboxMessages(baseUrl, apiKey, alias) {
  const data = await mailJson(`${baseUrl}/api/inboxes/${encodeURIComponent(alias)}/messages`, apiKey);
  return Array.isArray(data.messages) ? data.messages : [];
}

async function pollConfirmationCode(email, knownIds = new Set(), timeoutMs = 180000) {
  const baseUrl = (process.env.AMMAIL_BASE_URL || '').replace(/\/+$/, '');
  const apiKey = process.env.AMMAIL_API_KEY || '';
  const at = String(email || '').lastIndexOf('@');
  const domain = String(email || '').slice(at + 1).toLowerCase();
  const configuredDomain = String(process.env.AMMAIL_DOMAIN || '').toLowerCase();
  if (!baseUrl || !apiKey || at <= 0 || (configuredDomain && domain !== configuredDomain)) return '';
  const alias = email.slice(0, at);
  const deadline = Date.now() + timeoutMs;
  console.log('Challenge FB terdeteksi — menunggu kode konfirmasi dari inbox...');
  while (Date.now() < deadline) {
    try {
      const messages = (await listInboxMessages(baseUrl, apiKey, alias))
        .filter((m) => m.id && !knownIds.has(m.id))
        .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
      for (const item of messages) {
        const full = await mailJson(`${baseUrl}/api/messages/${encodeURIComponent(item.id)}`, apiKey);
        const msg = full.message || {};
        const code = extractConfirmationCode(msg.subject, msg.text, msg.html);
        if (code) return code;
      }
    } catch (e) {
      console.log('Inbox belum bisa dibaca, akan mencoba lagi...');
    }
    await sleep(5000);
  }
  return '';
}

(async () => {
  let ctx = null;
  let loginFp = null; // fingerprint konsisten untuk seluruh sesi login ini
  try {
    const opts = {
      headless: false,
      args: ['--no-sandbox', '--no-first-run', '--disable-infobars'], // tanpa flag anti-automation: patchright melarang
    };
    if (proxyArg) {
      const p = proxyArg.replace(/^\w+:\/\//, '').split(':');
      opts.proxy = { server: `http://${p[0]}:${p[1]}`, username: p[2], password: p.slice(3).join(':') };
      console.log('Proxy:', `http://${p[0]}:${p[1]}`);
    }
    if (profileDir) {
      fs.mkdirSync(profileDir, { recursive: true });
      // Fingerprint konsisten dengan signup: ambil dari DB akun (UA/locale/tz yang
      // disimpan saat pendaftaran). Fallback: geo IP proxy. Ini yang mencegah
      // "device berubah" antara signup dan login pertama.
      const stealth = require('./stealth');
      let fp = null;
      try {
        const db = require('./db');
        const rows = await db.rawAll(`SELECT * FROM accounts WHERE email = ? ORDER BY id DESC LIMIT 1`, [email]);
        if (rows && rows.length) fp = await stealth.ensureAccountFingerprint(rows[0]);
      } catch (e) { /* DB tidak tersedia — fallback di bawah */ }
      if (!fp) {
        fp = stealth.pickFreshFingerprint(await stealth.resolveProxyGeo(proxyArg));
      }
      loginFp = fp;
      opts.locale = fp.locale;
      opts.timezoneId = fp.timezoneId;
      const vp = String(fp.viewport || '1366x768').split('x').map(Number);
      opts.viewport = { width: vp[0] || 1366, height: vp[1] || 768 };
      ctx = await chromium.launchPersistentContext(profileDir, opts);
      console.log('Profil persisten:', profileDir, '|', fp.locale, '|', fp.timezoneId);
    } else {
      const browser = await chromium.launch(opts);
      ctx = await browser.newContext({ viewport: { width: 1366, height: 768 }, locale: 'id-ID', timezoneId: 'Asia/Jakarta' });
    }
    const page = await ctx.newPage();
    // Hardening CDP (UA asli + userAgentData + Accept-Language) untuk halaman login.
    // Tanpa init script manual — patchright menangani anti-detect di level engine.
    try {
      const st = require('./stealth');
      await st.attachPageHardening(ctx, page, loginFp || st.pickFreshFingerprint(null));
    } catch (e) {}

    await page.goto('https://www.facebook.com/login', { timeout: 60000, waitUntil: 'domcontentloaded' });
    await sleep(rand(4000, 6000));
    // Tutup cookie banner bila ada
    for (const name of [/tolak semua/i, /reject all/i, /decline/i, /only necessary/i]) {
      const b = page.getByRole('button', { name }).first();
      if ((await b.count()) > 0) { await b.click().catch(() => {}); await sleep(1500); break; }
    }

    const emailBox = page.locator('input[name="email"], input[type="email"]').first();
    await emailBox.click();
    await emailBox.fill('');
    await emailBox.type(email, { delay: rand(50, 130) });
    await sleep(rand(600, 1200));
    const passBox = page.locator('input[name="pass"], input[type="password"]').first();
    await passBox.click();
    await passBox.fill('');
    await passBox.type(password, { delay: rand(50, 130) });
    await sleep(rand(600, 1200));
    // Tandai email lama agar kode challenge selalu berasal dari login ini.
    const knownMailIds = new Set();
    try {
      const at = String(email).lastIndexOf('@');
      if (at > 0) {
        const before = await listInboxMessages((process.env.AMMAIL_BASE_URL || '').replace(/\/+$/, ''), process.env.AMMAIL_API_KEY || '', email.slice(0, at));
        before.forEach((m) => { if (m.id) knownMailIds.add(m.id); });
      }
    } catch (e) { /* inbox opsional; fallback manual tetap tersedia */ }

    const loginBtn = page.locator('button[name="login"], button:has-text("Log in"), button:has-text("Masuk")').first();
    await loginBtn.click().catch(() => page.keyboard.press('Enter'));

    // Tunggu hasil: cookie c_user (session FB) muncul ATAU checkpoint terdeteksi
    let ok = false, checkpoint = false;
    for (let w = 0; w < 24; w++) {
      await sleep(5000);
      const url = page.url();
      if (/checkpoint|checkpoint_challenge|two_step|codeentry/i.test(url)) { checkpoint = true; break; }
      const cks = await ctx.cookies().catch(() => []);
      if (cks.some((c) => c.name === 'c_user') && !/\/login/.test(url)) { ok = true; break; }
      if (w % 6 === 5) console.log(`... menunggu login (${(w + 1) * 5} dtk), url: ${url.slice(0, 80)}`);
    }
    let cks = await ctx.cookies().catch(() => []);
    let hasCuser = cks.some((c) => c.name === 'c_user');
    let hasXs = cks.some((c) => c.name === 'xs');

    // Facebook kadang menampilkan form kode tanpa URL checkpoint yang jelas.
    const challengeText = await page.locator('body').innerText().catch(() => '');
    const needsCode = checkpoint || /enter the confirmation code|confirmation code|5-digit code|kode konfirmasi|kode verifikasi/i.test(challengeText);
    if (needsCode && !hasCuser) {
      const code = await pollConfirmationCode(email, knownMailIds);
      if (code) {
        console.log('Kode konfirmasi ditemukan otomatis, mengisi browser...');
        const codeBox = page.locator('input[name="code"], input[name="confirmation_code"], input[placeholder*="code" i], input[placeholder*="kode" i]').first();
        if (await codeBox.count()) {
          await codeBox.fill(code);
          const submitCode = page.locator('button[type="submit"], button:has-text("Continue"), button:has-text("Confirm"), button:has-text("Lanjut")').first();
          if (await submitCode.count()) await submitCode.click().catch(() => {});
          else await codeBox.press('Enter').catch(() => {});
          for (let w = 0; w < 18; w++) {
            await sleep(5000);
            cks = await ctx.cookies().catch(() => []);
            hasCuser = cks.some((c) => c.name === 'c_user');
            hasXs = cks.some((c) => c.name === 'xs');
            if (hasCuser) { ok = true; checkpoint = false; break; }
          }
        } else {
          console.log('Form kode tidak ditemukan — lanjut manual di browser.');
        }
      } else {
        console.log('Kode otomatis tidak tersedia — lanjut manual di browser.');
      }
    }

    if (checkpoint && !hasCuser) {
      // Kutip baris teks FB yang relevan supaya runner bisa menyimpan bukti
      // langsung ke account_events (bukan cuma label 'checkpoint').
      const dd = String(challengeText || '').split(/\r?\n/).map((s) => s.trim())
        .filter((s) => s.length > 3 && /checkpoint|verifikasi|konfirmasi|kode|code|identit|security|suspicious|akun|account/i.test(s))
        .slice(0, 4).join(' | ');
      console.log('CHECKPOINT: FB minta verifikasi tambahan (selesaikan manual di browser).');
      if (dd) console.log('CHECKPOINT DETAIL:', dd.slice(0, 300));
      console.log('HASIL: LOGIN CHECKPOINT |', email);
      process.exitCode = 2;
    } else if (ok && hasCuser && hasXs) {
      console.log('SESSION: OK (c_user + xs ada) — login terverifikasi.');
      console.log('HASIL: LOGIN OK |', email);
    } else if (hasCuser) {
      console.log('SESSION: PARSIAL (c_user ada, xs belum) — cek manual bila perlu.');
      console.log('HASIL: LOGIN PARSIAL |', email);
    } else {
      console.log('LOGIN GAGAL: kredensial ditolak / tantangan tak terdeteksi. Cek browser.');
      console.log('HASIL: LOGIN GAGAL |', email);
      process.exitCode = 2;
    }
    // Screenshot bukti
    try { await page.screenshot({ path: 'fb-login-check.png' }); } catch (e) { /* abaikan */ }
    // Biarkan browser terbuka bila checkpoint (bisa diselesaikan manual).
    if (checkpoint || !ok) { console.log('Browser dibiarkan terbuka 60 dtk untuk penanganan manual...'); await sleep(60000); }
  } catch (e) {
    console.log('FATAL:', e.message);
    console.log('HASIL: LOGIN ERROR |', email);
    process.exitCode = 1;
  } finally {
    try { if (ctx) await ctx.close(); } catch (e) { /* abaikan */ }
  }
})();

function rand(min, max) { return min + Math.floor(Math.random() * (max - min + 1)); }
