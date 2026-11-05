'use strict';
/* Recovery akun IG: reset password via "Lupa kata sandi?" pakai email dari file session.
 * Kode reset diambil otomatis dari inbox Ammail (HANYA email reset — email konfirmasi lama diabaikan),
 * password baru diset, login otomatis, session file diupdate.
 * Run: node src/ig-recover.js sessions/ig-<user>.json "<host:port:user:pass>"
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
  let m = /(?:confirmation|verification|security|reset)\s*code[^0-9]{0,10}([0-9]{4,8})|\bcode\b[^0-9]{0,10}([0-9]{4,8})/i.exec(hay);
  if (m) return m[1] || m[2];
  m = /\b([0-9]{4,8})\s+is your \w+ (?:confir|verification|reset)/i.exec(hay) || /^\s*([0-9]{4,8})\b/m.exec(subject || '');
  if (m) return m[1];
  m = /\b([0-9]{5,6})\b/.exec((subject || '') + '\n' + (text || ''));
  return m ? m[1] : '';
}

function extractResetUrl(subject, text, html) {
  const hay = [subject || '', text || '', String(html || '').replace(/<[^>]+>/g, ' ')].join('\n');
  const m = /https:\/\/(?:www\.)?instagram\.com\/[^\s"'<>]*(?:password|reset)[^\s"'<>]*/i.exec(hay);
  return m ? m[0] : '';
}

// Polling inbox — HANYA email reset password (jangan sampai kode konfirmasi lama kebaca)
async function pollReset(alias, maxMin = 5) {
  const baseUrl = (process.env.AMMAIL_BASE_URL || '').replace(/\/+$/, '');
  const apiKey = process.env.AMMAIL_API_KEY || '';
  for (let i = 0; i < maxMin * 12; i++) {
    await sleep(5000);
    try {
      const list = await makeHttp(`${baseUrl}/api/inboxes/${alias}/messages`, { method: 'GET', headers: { 'X-API-Key': apiKey } });
      const msgs = (list.messages || []).slice().sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
      for (const prev of msgs) {
        if (!prev.id) continue;
        const full = await makeHttp(`${baseUrl}/api/messages/${prev.id}`, { method: 'GET', headers: { 'X-API-Key': apiKey } });
        const msg = full.message || {};
        const stripped = String(msg.html || '').replace(/<[^>]+>/g, ' ');
        const hay = [msg.subject || '', msg.text || '', stripped].join('\n');
        // WAJIB mengandung kata reset/atur ulang — email konfirmasi signup biasa LEWAT
        if (!/reset your password|reset\s*(your\s*)?password|atur ulang|ubah kata sandi|lupa kata sandi|reset code|password reset/i.test(hay)) continue;
        const code = extractCode(msg.subject, msg.text, stripped);
        const url = extractResetUrl(msg.subject, msg.text, msg.html);
        if (code || url) return { code, url, subject: msg.subject };
      }
    } catch (e) { /* lanjut polling */ }
  }
  return null;
}

const pageText = (page) => page.evaluate(() => document.body ? document.body.innerText : '').catch(() => '');

(async () => {
  const [sessPath, proxyStr] = process.argv.slice(2);
  if (!sessPath || !proxyStr) { console.error('Pemakaian: node src/ig-recover.js sessions/ig-<user>.json "<host:port:user:pass>"'); process.exit(1); }
  const sess = JSON.parse(fs.readFileSync(sessPath, 'utf8'));
  const alias = String(sess.email || '').split('@')[0];
  const NEW_PASS = 'Rv' + Math.random().toString(36).slice(2, 10) + '!7';
  console.log('Recovery:', sess.username, '| email:', sess.email);

  const browser = await chromium.launch({
    headless: false,
    args: ['--disable-dev-shm-usage', '--no-sandbox'], // tanpa flag anti-automation: patchright melarang
    proxy: parseProxy(proxyStr),
  });
  const context = await browser.newContext({
    viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2,
    locale: 'id-ID', timezoneId: 'Asia/Jakarta',
    userAgent: 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
  });
  // Tanpa addInitScript webdriver — patchright menangani di level engine.
  const page = await context.newPage();

  let ok = false;
  try {
    // 1) Root IG (retry max 3x — proxy kadang timeout)
    let gotoOk = false;
    for (let i = 1; i <= 3 && !gotoOk; i++) {
      try { await page.goto('https://www.instagram.com/', { timeout: 60000, waitUntil: 'domcontentloaded' }); gotoOk = true; }
      catch (e) { console.log(`goto root gagal (${i}/3): ${e.message.split('\n')[0]}`); if (i < 3) await sleep(rand(10000, 15000)); }
    }
    if (!gotoOk) throw new Error('root_ig_tak_terbuka (proxy lambat/rate-limit)');
    await sleep(rand(4000, 7000));
    const loginLink = page.locator('text=/^log ?in$|^masuk$/i').first();
    if ((await loginLink.count()) > 0) { await loginLink.click().catch(() => {}); await sleep(rand(6000, 9000)); }
    let forgot = page.locator('text=/lupa kata sandi|lupa sandi|forgot password/i').first();
    for (let w = 0; w < 10 && (await forgot.count()) === 0; w++) { await sleep(2500); forgot = page.locator('text=/lupa kata sandi|lupa sandi|forgot password/i').first(); }
    if ((await forgot.count()) === 0) throw new Error('link_lupa_sandi_tidak_ketemu');
    await forgot.click().catch(() => {});
    console.log('Halaman Lupa kata sandi dibuka...');

    // 2) Isi email akun & submit
    for (let w = 0; w < 12; w++) { await sleep(2500); if ((await page.locator('input').count()) > 0) break; }
    const fin = page.locator('input').first();
    for (let w = 0; w < 8; w++) { if (!(await fin.isDisabled().catch(() => true))) break; await sleep(2000); }
    await fin.click(); await sleep(rand(500, 900));
    await fin.fill(sess.email); await sleep(rand(600, 1200));
    const sb = page.getByRole('button', { name: /kirim|send|lanjut|next/i }).first();
    if ((await sb.count()) > 0) await sb.click().catch(() => {}); else await fin.press('Enter').catch(() => {});
    console.log('Permintaan reset dikirim, polling inbox (hanya email reset)...');
    await sleep(rand(6000, 9000));
    // Diagnosa: apa kata IG setelah submit? (error "email tidak ditemukan" dll)
    const afterTxt = await pageText(page);
    console.log('Respons halaman:', (afterTxt || '').slice(0, 220).replace(/\n+/g, ' | '));
    await page.screenshot({ path: 'ig-recover-after-send.png' }).catch(() => {});

    // 3) Polling inbox: kode ATAU link reset (email reset saja) — max 8 menit
    const hit = await pollReset(alias, 8);
    if (!hit) throw new Error('email_reset_tidak_dapat');
    console.log('Email reset ditemukan:', (hit.subject || '').slice(0, 60), '|', hit.code ? 'kode ' + hit.code : 'link reset');

    // 4) Bila ada link reset langsung, buka (mampir; IG biasanya minta kode tetap)
    if (hit.url) {
      try {
        await page.goto(hit.url, { timeout: 60000, waitUntil: 'domcontentloaded' });
        await sleep(rand(4000, 7000));
      } catch (e) { console.log('Buka link reset gagal (lanjut mode kode):', e.message.split('\n')[0]); }
    }

    // 5) Tunggu form muncul: kode ATAU password baru (halaman sama, tanpa goto ekstra)
    const stageDetect = async () => {
      for (let w = 0; w < 14; w++) {
        const t = await pageText(page);
        const pwN = await page.locator('input[type="password"]').count().catch(() => 0);
        const inN = await page.locator('input').count().catch(() => 0);
        if (pwN > 0) return 'pass';
        if (inN > 0 && /kode|code|digit/i.test(t)) return 'code';
        await sleep(2500);
      }
      return '';
    };
    let stage = await stageDetect();
    console.log('Tahap form:', stage || 'tidak dikenali');

    // 6) Isi kode bila diminta
    if (stage === 'code') {
      if (!hit.code) throw new Error('form_kode_tapi_email_tak_berisi_kode');
      const ci = page.locator('input:not([type="password"])').first();
      for (let w = 0; w < 8; w++) { if (!(await ci.isDisabled().catch(() => true))) break; await sleep(2000); }
      await ci.click(); await sleep(400);
      await ci.fill(hit.code); await sleep(rand(800, 1500));
      const nb = page.getByRole('button', { name: /verif|next|berikutnya|lanjut/i }).first();
      if ((await nb.count()) > 0 && !(await nb.isDisabled().catch(() => true))) await nb.click().catch(() => {});
      else await ci.press('Enter').catch(() => {});
      console.log('Kode dikirim, menunggu form password baru...');
      await sleep(rand(6000, 10000));
      stage = await stageDetect();
      console.log('Tahap form (setelah kode):', stage || 'tidak dikenali');
    }
    if (stage !== 'pass') {
      await page.screenshot({ path: 'ig-recover-nopass.png' }).catch(() => {});
      throw new Error('form_password_baru_tidak_ketemu');
    }

    // 7) Set password baru
    const pi = page.locator('input[type="password"]').first();
    for (let w = 0; w < 8; w++) { if (!(await pi.isDisabled().catch(() => true))) break; await sleep(2000); }
    await pi.click(); await sleep(rand(400, 800));
    await pi.fill(NEW_PASS); await sleep(rand(600, 1200));
    const nb2 = page.getByRole('button', { name: /reset|atur|ubah|simpan|submit|next|berikutnya|lanjut/i }).first();
    if ((await nb2.count()) > 0 && !(await nb2.isDisabled().catch(() => true))) await nb2.click().catch(() => {});
    else await pi.press('Enter').catch(() => {});
    console.log('Password baru diset.');
    await sleep(rand(6000, 10000));

    // 8) Login ulang dengan password baru (root -> Log in -> isi form)
    for (let i = 1; i <= 3; i++) {
      try { await page.goto('https://www.instagram.com/', { timeout: 60000, waitUntil: 'domcontentloaded' }); break; }
      catch (e) { if (i === 3) break; await sleep(10000); }
    }
    await sleep(rand(4000, 7000));
    let text = await pageText(page);
    if (!/log ?in|masuk/i.test(text) || (await page.locator('input[type="password"]').count()) === 0) {
      const ll = page.locator('a[href*="/accounts/login"], text=/^log ?in$|^masuk$/i').first();
      if ((await ll.count()) > 0) { await ll.click().catch(() => {}); await sleep(rand(6000, 9000)); }
    }
    for (let w = 0; w < 12 && (await page.locator('input[type="password"]').count()) === 0; w++) await sleep(2500);
    const uin = page.locator('input:not([type="password"])').first();
    const pin = page.locator('input[type="password"]').first();
    if ((await pin.count()) > 0 && (await uin.count()) > 0) {
      // Identitas login: email dulu (username panel belum tentu username IG asli).
      const loginId = String(sess.email || '').trim() || String(sess.username || '').trim();
      await uin.click(); await sleep(500);
      await uin.fill(loginId); await sleep(rand(600, 1200));
      await pin.click(); await sleep(400);
      await pin.fill(NEW_PASS); await sleep(rand(600, 1200));
      const lb = page.getByRole('button', { name: /^log ?in$|^masuk$/i }).first();
      if ((await lb.count()) > 0 && !(await lb.isDisabled().catch(() => true))) await lb.click().catch(() => {});
      else await pin.press('Enter').catch(() => {});
      console.log('Login dengan password baru dikirim...');
      for (let w = 0; w < 12; w++) {
        await sleep(3000);
        const cs = await context.cookies();
        if (cs.some((c) => c.name === 'sessionid')) break;
      }
    }

    // 9) Cek & simpan session
    let cookies = await context.cookies();
    const hasSession = cookies.some((c) => c.name === 'sessionid');
    console.log('sessionid:', hasSession ? 'ADA \u2705' : 'belum ada');
    await page.screenshot({ path: 'ig-recover-result.png' }).catch(() => {});
    if (hasSession) {
      cookies = await context.cookies();
      sess.password = NEW_PASS;
      sess.cookies = cookies;
      sess.recovered_at = new Date().toISOString();
      fs.writeFileSync(path.resolve(sessPath), JSON.stringify(sess, null, 2));
      console.log('Session file diupdate:', sessPath);
      ok = true;
    }
  } catch (e) {
    console.log('GAGAL:', e.message.split('\n')[0]);
    await page.screenshot({ path: 'ig-recover-fail.png' }).catch(() => {});
  } finally {
    await browser.close().catch(() => {});
  }
  console.log(ok ? '\nHASIL: RECOVERY OK \u2705 (password baru tersimpan di session file)' : '\nHASIL: recovery belum selesai');
  process.exit(ok ? 0 : 1);
})();
