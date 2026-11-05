'use strict';
// Pembuka sesi Gmail yang sudah login (status 'ok' & cookies.json tersimpan).
// Tujuan: tombol "Buka" di panel — operator lihat inbox langsung tanpa login
// ulang. Kelakuan: buka patchright dengan profil + cookie profil + IP proxy
// sticky yang sama, land ke gmail. Proses tinggal hidup selama jendela terbuka;
// tutup jendela = proses mati sendiri.

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { chromium } = require('patchright');
const stealth = require('./stealth');
const spoof = require('./fingerprint-spoof');
const { stickyProxy, proxyParts } = require('./gmail-proxy');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ROOT = path.join(__dirname, '..');

function parseArgs(argv) {
  const out = { proxy: null, url: 'https://mail.google.com/', once: false, closeAfter: 0, noProxy: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--proxy') out.proxy = argv[++i] || null;
    else if (argv[i] === '--url') out.url = argv[++i] || out.url;
    // --once: mode refresh terjadwal (headless + simpan cookie kembali + tutup sendiri).
    else if (argv[i] === '--once') out.once = true;
    else if (argv[i] === '--close-after') out.closeAfter = Number(argv[++i]) || 0;
    else if (argv[i] === '--no-proxy') out.noProxy = true;
  }
  return out;
}

(async () => {
  const argv = process.argv.slice(2);
  const gmailId = Number(argv[0]) || 0;
  const email = argv[1] || '';
  const opts = parseArgs(argv.slice(2));
  if (!gmailId || !email) { console.error('argumen kurang'); process.exit(1); }

  const profileDir = path.join(ROOT, 'sessions', `gmail-${gmailId}`);
  // Sumber sesi = profil persisten itu sendiri (login worker memakai folder
  // yang sama). Cookies.json hanya cadangan audit; replay jar cookie sederhana
  // terbukti tidak cukup untuk Google: chooser selalu tampil "Signed out".
  if (!fs.existsSync(path.join(profileDir, 'Default'))) {
    console.error(`profil kosong: ${profileDir} (login dulu supaya profil terisi)`);
    process.exit(1);
  }

  const proxyStr = opts.noProxy ? null : stickyProxy(gmailId, opts.proxy);
  const proxy = proxyStr ? proxyParts(proxyStr) : null;
  if (!opts.noProxy && !proxy) { console.error('proxy tidak valid:', String(proxyStr).slice(0, 40)); process.exit(1); }
  if (opts.noProxy) console.log('[gmail-open] TANPA PROXY: IP asli — jalur sama dengan login agar Google tak curiga.');

  const cfg = spoof.spoofConfigFor({
    id: gmailId, name: `gmail-${gmailId}`, email,
    user_agent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36',
  });

  // Konteks persisten SELARAS dengan worker login: argumen Chrome sama,
  // locale/timezone sama — supaya profil dianggap konteks yang sama oleh Google.
  const ARGS = ['--no-first-run', '--no-default-browser-check', '--no-sandbox', '--disable-dev-shm-usage', '--force-webrtc-ip-handling-policy=disable_non_proxied_udp'];
  const launchOpts = {
    headless: !!opts.once, // refresh terjadwal berjalan tanpa jendela
    args: ARGS,
    locale: 'id-ID',
    timezoneId: 'Asia/Jakarta',
    viewport: { width: 1280, height: 800 },
    timeout: 120000,
  };
  if (proxy) launchOpts.proxy = proxy; // --no-proxy diteruskan bila ada
  const browserCtx = await chromium.launchPersistentContext(profileDir, launchOpts);
  await browserCtx.addInitScript(stealth.spoofInitScript(cfg));

  const page = await browserCtx.newPage();
  console.log('[gmail-open] membuka', opts.url);
  try {
    await page.goto(opts.url, { timeout: 60000, waitUntil: 'domcontentloaded' });
  } catch (e) {
    console.log('[gmail-open] goto gagal:', (e.message || '').split('\n')[0], '— mencoba accounts.google.com');
    await page.goto('https://accounts.google.com/', { timeout: 60000, waitUntil: 'domcontentloaded' }).catch(() => {});
  }
  await sleep(3000);
  const landed = page.url();
  console.log('[gmail-open] url sekarang:', landed.slice(0, 100));

  // Verifikasi auth dari HOSTNAME asli — BUKAN substring URL. Pelajaran uji:
  // chooser muncul sebagai accounts.google.com/v3/signin/accountchooser?
  // continue=https://mail.google.com/mail/u/0/ - substring "mail/u/0" di
  // parameter continue membuat deteksi lama salah bilang SESI_HIDUP padahal
  // chooser menampilkan "Signed out". Sesi hidup = UA benar-benar mendarat di
  // host mail.google.com dengan path /mail/u/<digit>.
  let u = null;
  try { u = new URL(landed); } catch (e) { /* url aneh */ }
  const aliveNow = u && u.hostname === 'mail.google.com' && /^\/mail\/u\/\d+/.test(u.pathname);
  let sessionAlive = aliveNow;
  if (!sessionAlive) {
    // Redirect kadang lambat — cek sekali lagi setelah jeda pendek.
    await sleep(4000);
    const landed2 = page.url();
    try { u = new URL(landed2); } catch (e) { /* url aneh */ }
    sessionAlive = !!(u && u.hostname === 'mail.google.com' && /^\/mail\/u\/\d+/.test(u.pathname));
    console.log('[gmail-open] cek kedua url:', landed2.slice(0, 100), '→ sesi', sessionAlive ? 'hidup' : 'habis');
    if (!sessionAlive && u && u.hostname === 'accounts.google.com' && u.pathname.includes('accountchooser')) {
      // Chooser dengan label "Signed out": profil mengenal akun tapi cookie
      // login tidak valid. Coba klik entri akun yang cocok (Google tetap
      // meminta password bila benar-benar habis).
      console.log('[gmail-open] chooser terdeteksi, mencoba klik entri akun...');
      try {
        const entry = browserCtx.pages()[0];
        const acc = entry.locator(`div[data-identifier="${email}"]`).first();
        if (await acc.isVisible().catch(() => false)) {
          await acc.click();
          await sleep(5000);
          const landed3 = entry.url();
          try { u = new URL(landed3); } catch (e2) { /* url aneh */ }
          sessionAlive = !!(u && u.hostname === 'mail.google.com' && /^\/mail\/u\/\d+/.test(u.pathname));
          console.log('[gmail-open] setelah klik entri:', landed3.slice(0, 100), '→ sesi', sessionAlive ? 'hidup' : 'perlu password');
        } else {
          console.log('[gmail-open] entri akun tidak terlihat di chooser.');
        }
      } catch (e2) {
        console.log('[gmail-open] klik entri gagal:', (e2.message || '').split('\n')[0]);
      }
    }
  }
  if (sessionAlive) {
    if (opts.once) {
      const fresh = await browserCtx.cookies();
      fs.writeFileSync(path.join(profileDir, 'cookies.json'),
        JSON.stringify({ engine: 'patchright', mode: 'scheduled-refresh', savedAt: new Date().toISOString(), cookies: fresh }, null, 2));
      console.log(`[gmail-open] ${fresh.length} cookie tersimpan ulang (refresh terjadwal).`);
    }
    console.log('[gmail-open] SESI_DIVERIFIKASI: inbox terbuka dengan sesi profil.' + (opts.once ? ' (refresh --once)' : ''));
  } else {
    console.log('[gmail-open] PERINGATAN: sesi tampak habis, Google tampilkan halaman login (SESI_HABIS).');
  }

  if (opts.once) {
    // Mode refresh: verifikasi selesai dengan cookie terkinikan, tutup browser rapi.
    try { await browserCtx.close(); } catch (e) { /* abaikan */ }
    console.log('[gmail-open] refresh selesai, konteks ditutup (--once).');
    process.exit(sessionAlive ? 0 : 3);
  }

  console.log('[gmail-open] jendela terbuka; tutup jendela untuk keluar.');
  // Tahan proses selama jendela masih ada.
  const closeAfter = opts.closeAfter || 0;
  if (closeAfter > 0) {
    await sleep(closeAfter * 1000);
  } else {
    await new Promise((resolve) => {
      const iv = setInterval(() => {
        const ctxClosed = browserCtx.pages().length === 0;
        if (ctxClosed) { clearInterval(iv); resolve(); }
      }, 2000);
    });
  }
  try { await browserCtx.close(); } catch (e) { /* sudah tertutup */ }
  console.log('[gmail-open] selesai.');
})().catch((e) => {
  console.error('[gmail-open] FATAL:', (e.message || '').split('\n')[0]);
  process.exit(1);
});
