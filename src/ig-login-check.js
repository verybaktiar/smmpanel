'use strict';
// Tes login IG: identitas login SELALU prioritas EMAIL (username arg bisa nama panel, bukan username IG asli).
// Run: node src/ig-login-check.js <username> <password> [proxy] [email]
require('dotenv').config();
const { chromium } = require('patchright'); // engine panel: patchright (drop-in playwright)
const fs = require('fs');
const path = require('path');

const _args = process.argv.slice(2);
const username = _args[0];
const password = _args[1] || '';
// Argumen fleksibel: [proxy] [email] — proxy selalu mengandung ':' + port
let proxyArg = '', emailArg = '', totpArg = '';
for (let i = 2; i < _args.length; i++) {
  const a = _args[i];
  if (!a) continue;
  if (a === '--totp') { totpArg = _args[i + 1] || ''; i++; }
  else if (/:\d+/.test(a) && !a.includes('@') || /^[^@]+:\d+:[^:]+/.test(a)) proxyArg = a;
  else if (a.includes('@')) emailArg = a;
  else if (/^\d+$/.test(a)) { /* abaikan */ }
  else proxyArg = proxyArg || a;
}
if (!username || !password) { console.log('Pakai: node src/ig-login-check.js <username> <password> [proxy] [--totp <secretB32>]'); process.exit(1); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Kode TOTP dari secret base32 (2FA): diisi otomatis kalau IG minta kode autentikator.
const totpCodeOf = (secret) => {
  try { return require('./totp').totpCode(require('./totp').normalizeSecret(secret)).code; }
  catch (e) { console.log('TOTP gagal dibaca:', e.message); return ''; }
};

(async () => {
  let browser = null;
  try {
    const opts = { headless: false, args: ['--no-sandbox'] }; // tanpa flag anti-automation: patchright melarang
    if (proxyArg) {
      const p = proxyArg.split(':');
      opts.proxy = { server: `http://${p[0]}:${p[1]}`, username: p[2], password: p[3] };
    }
    browser = await chromium.launch(opts);
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 }, locale: 'en-US' });
    // Tanpa addInitScript webdriver — patchright menangani di level engine.
    const page = await ctx.newPage();
    await page.goto('https://www.instagram.com/accounts/login/', { timeout: 60000, waitUntil: 'domcontentloaded' });
    await sleep(4000);
    // Kode tantangan manual: file <username>-code.txt — baris pertama yang masih valid saat layar
    // codeentry/challenge muncul (WhatsApp/SMS) dipakai sebagai kode. Operator mengetik kodenya
    // di chat/papan; file bisa diisi ulang untuk kode berikutnya ("kirim ulang").
    const codeFile = path.join(__dirname, '..', `${username.replace(/[^a-zA-Z0-9_-]/g, '_')}-code.txt`);
    const readCodeFile = () => {
      try {
        const line = fs.readFileSync(codeFile, 'utf8').split(/\r?\n/).map((l) => l.trim()).find(Boolean);
        return line || '';
      } catch (e) { return ''; }
    };
    const consumeCodeFile = () => {
      const c = readCodeFile();
      if (c) { try { fs.writeFileSync(codeFile, ''); } catch (e) { /* abaikan */ } }
      return c;
    };
    const inputs = page.locator('input');
    const loginId = String(emailArg || '').trim() || username; // email dulu, fallback username
    console.log('Login pakai identitas:', /@/.test(loginId) ? `${loginId} (email)` : loginId);
    await inputs.nth(0).click(); await inputs.nth(0).fill(loginId); await sleep(800);
    const pw = page.locator('input[type="password"]').first();
    await pw.click(); await pw.fill(password); await sleep(800);
    await page.getByRole('button', { name: /^log in$/i }).first().click();
    // Tunggu URL stabil max 30 dtk (redirect tantangan kadang telat)
    let settled = '';
    for (let w = 0; w < 6; w++) {
      await sleep(5000);
      settled = page.url();
      if (/codeentry|challenge|checkpoint/i.test(settled)) break;
      if (/instagram\.com\/($|\?|#)/.test(settled) && !/accounts\/login/.test(settled)) break;
    }
    // Layar 2FA TOTP: kode dari secret --totp (jendela 30 dtk) + centang "Trust this
    // device" supaya step 2FA tidak berulang tiap login dari profil ini.
    if (/two_step_verification|totp|authentication.?app/i.test(page.url() + ' ' + (await page.locator('body').innerText().catch(() => '')))) {
      const tc = totpCodeOf(totpArg);
      if (tc) {
        console.log('2FA TOTP: kode diisi otomatis (' + tc + ')');
        const trust = page.locator('input[type="checkbox"], [role="checkbox"]').first();
        if ((await trust.count()) > 0 && !(await trust.isChecked().catch(() => true))) { await trust.check().catch(() => {}); await sleep(500); }
        const ci = page.locator('input').first();
        await ci.click().catch(() => {}); await ci.fill(tc).catch(() => {});
        await sleep(2000);
        const vb = page.getByRole('button', { name: /lanjutkan|berikutnya|continue|next|confirm|verify|submit/i }).first();
        if ((await vb.count()) > 0) await vb.click().catch(() => {});
        await sleep(15000);
      } else {
        console.log('2FA TOTP diperlukan tapi --totp tidak diset — isi manual di browser (skrip lanjut 3 menit).');
        for (let w = 0; w < 36; w++) {
          await sleep(5000);
          if (!/two_step_verification/i.test(page.url())) break;
        }
      }
    }
    // Layar tantangan WhatsApp/SMS: ambil kode dari file — tunggu operator menulisnya,
    // konsumsi (file dikosongkan supaya polling berikutnya harus kode baru), isi + lanjut.
    if (/codeentry|challenge|checkpoint/i.test(page.url())) {
      const cf = consumeCodeFile();
      if (cf) {
        console.log('CHALLENGE: kode dari file:', cf);
        const ci = page.locator('input').first();
        if ((await ci.count()) > 0) {
          await ci.click().catch(() => {}); await ci.fill(cf).catch(() => {});
          await sleep(2000);
          const vb = page.getByRole('button', { name: /berikutnya|lanjutkan|confirm|verify|submit|next|continue|kirim/i }).first();
          if ((await vb.count()) > 0) await vb.click().catch(() => {});
          await sleep(15000);
        }
      } else {
        console.log('CHALLENGE: layar codeentry muncul, tapi kode belum ada. Isi file', path.basename(codeFile), 'lalu lanjut manual di browser; skrip menunggu 3 menit.');
        for (let w = 0; w < 36; w++) {
          await sleep(5000);
          const c2 = consumeCodeFile();
          if (c2) {
            console.log('CHALLENGE: kode dari file:', c2);
            const ci2 = page.locator('input').first();
            await ci2.click().catch(() => {}); await ci2.fill(c2).catch(() => {});
            await sleep(2000);
            const vb2 = page.getByRole('button', { name: /berikutnya|lanjutkan|confirm|verify|submit|next|continue|kirim/i }).first();
            if ((await vb2.count()) > 0) await vb2.click().catch(() => {});
            await sleep(15000);
            break;
          }
        }
      }
    }
    // TUNGGU login benar-benar selesai: polling cookie sessionid max 90 dtk.
    // Jangan ke beranda/profil sebelum ini, kalau tidak dianggap belum login.
    let hasSession = false;
    for (let w = 0; w < 18; w++) {
      const cks = await ctx.cookies().catch(() => []);
      if (cks.some((c) => c.name === 'sessionid')) { hasSession = true; break; }
      await sleep(5000);
    }
    console.log('SESSION:', hasSession ? 'OK (sessionid ada)' : 'BELUM (lanjut cek manual)');
    await sleep(3000);
    // Helper HTTP (didefinisikan dulu dipakai pre-check + polling)
    const mh2 = (u, key) => new Promise((resolve, reject) => {
      const lib = u.startsWith('https') ? require('https') : require('http');
      const uu = new URL(u);
      const req = lib.request({ hostname: uu.hostname, port: uu.port || 443, path: uu.pathname, method: 'GET', headers: { 'X-API-Key': key } }, (res) => {
        let d = ''; res.on('data', (c) => { d += c; }); res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { resolve({}); } });
      });
      req.on('error', reject); req.end();
    });
    // Tandai pesan lama SEBELUM login — tantangan harus pakai kode BARU
    let knownIds = new Set();
    try {
      const em0 = String(emailArg || username);
      const at0 = em0.lastIndexOf('@');
      const dom0 = process.env.AMMAIL_DOMAIN || '';
      if (at0 > 0 && dom0 && em0.slice(at0 + 1).toLowerCase() === dom0.toLowerCase()) {
        const base0 = (process.env.AMMAIL_BASE_URL || '').replace(/\/+$/, '');
        const pre = await mh2(`${base0}/api/inboxes/${em0.slice(0, at0)}/messages`, process.env.AMMAIL_API_KEY || '');
        (pre.messages || []).forEach((m) => { if (m.id) knownIds.add(m.id); });
      }
    } catch (e) { /* abaikan */ }
    // Tantangan codeentry (akun baru): ambil kode terbaru dari Ammail bila email sedomain
    try {
      const em = String(emailArg || username);
      const at = em.lastIndexOf('@');
      const dom = process.env.AMMAIL_DOMAIN || '';
      if (/codeentry|challenge|checkpoint/i.test(page.url()) && at > 0 && dom && em.slice(at + 1).toLowerCase() === dom.toLowerCase()) {
        const alias = em.slice(0, at);
        console.log('CHALLENGE: ambil kode untuk', alias);
        const baseUrl = (process.env.AMMAIL_BASE_URL || '').replace(/\/+$/, '');
        const apiKey = process.env.AMMAIL_API_KEY || '';
        const mh = (u, o) => new Promise((resolve, reject) => {
          const lib = u.startsWith('https') ? require('https') : require('http');
          const uu = new URL(u);
          const req = lib.request({ hostname: uu.hostname, port: uu.port || 443, path: uu.pathname, method: (o && o.method) || 'GET', headers: (o && o.headers) || {} }, (res) => {
            let d = ''; res.on('data', (c) => { d += c; }); res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { resolve({}); } });
          });
          req.on('error', reject); req.end();
        });
        let code = '';
        for (let i = 0; i < 24 && !code; i++) {
          await sleep(5000);
          try {
            const list = await mh(`${baseUrl}/api/inboxes/${alias}/messages`, { headers: { 'X-API-Key': apiKey } });
            const msgs = (list.messages || [])
              .filter((m) => m.id && !knownIds.has(m.id))
              .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
            for (const prev of msgs) {
              if (!prev.id) continue;
              const full = await mh(`${baseUrl}/api/messages/${prev.id}`, { headers: { 'X-API-Key': apiKey } });
              const msg = full.message || {};
              const hay = [msg.subject || '', msg.text || '', String(msg.html || '').replace(/<[^>]+>/g, ' ')].join('\n');
              const m = hay.match(/\b(\d{6})\b/) || hay.match(/\b(\d{5})\b/);
              if (m) { code = m[1]; break; }
            }
          } catch (e) { /* lanjut */ }
        }
        console.log('CHALLENGE kode:', code ? 'dapat' : 'tidak masuk, coba kirim ulang...');
        if (!code) {
          // Klik "Get a new code" lalu polling ronde 2
          const resend = page.locator('text=Get a new code').first();
          if ((await resend.count()) > 0) {
            await resend.click().catch(() => {});
            await sleep(10000);
            for (let i = 0; i < 24 && !code; i++) {
              await sleep(5000);
              try {
                const list = await mh(`${baseUrl}/api/inboxes/${alias}/messages`, { headers: { 'X-API-Key': apiKey } });
                const msgs = (list.messages || [])
                  .filter((m) => m.id && !knownIds.has(m.id))
                  .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
                for (const prev of msgs) {
                  if (!prev.id) continue;
                  const full = await mh(`${baseUrl}/api/messages/${prev.id}`, { headers: { 'X-API-Key': apiKey } });
                  const msg = full.message || {};
                  const hay = [msg.subject || '', msg.text || '', String(msg.html || '').replace(/<[^>]+>/g, ' ')].join('\n');
                  const m = hay.match(/\b(\d{6})\b/) || hay.match(/\b(\d{5})\b/);
                  if (m) { code = m[1]; break; }
                }
              } catch (e) { /* lanjut */ }
            }
            console.log('CHALLENGE ronde 2:', code ? 'dapat' : 'tetap tidak masuk');
          }
        }
        if (code) {
          const ci = page.locator('input').first();
          if ((await ci.count()) > 0) {
            await ci.click().catch(() => {}); await ci.fill(code).catch(() => {});
            await sleep(2000);
            const vb = page.getByRole('button', { name: /confirm|verify|submit|next|continue|kirim/i }).first();
            if ((await vb.count()) > 0) await vb.click().catch(() => {});
            await sleep(15000);
          }
        }
      }
    } catch (e) { console.log('CHALLENGE err:', e.message.slice(0, 100)); }
    const afterUrl = page.url();
    const afterText = await page.evaluate(() => document.body.innerText).catch(() => '');
    console.log('URL habis login:', afterUrl.slice(0, 200));
    console.log('Isi halaman (500 char):', (afterText || '').slice(0, 500).replace(/\n+/g, ' | '));
    await page.screenshot({ path: 'ig-after-submit.png' }).catch(() => {});
    for (const name of [/not now/i]) {
      const b = page.getByRole('button', { name }).first();
      if ((await b.count()) > 0) await b.click().catch(() => {});
      await sleep(1500);
    }
    await page.goto('https://www.instagram.com/', { timeout: 45000, waitUntil: 'domcontentloaded' });
    await sleep(5000);
    const homeText = await page.evaluate(() => document.body.innerText).catch(() => '');
    const homeOk = /home|stories|search|reels/i.test(homeText) && !/log into instagram/i.test(homeText.slice(0, 800));
    console.log('HOME:', homeOk ? 'OK' : 'GAGAL');
    await page.screenshot({ path: 'ig-home.png' }).catch(() => {});
    await page.goto(`https://www.instagram.com/${username}/`, { timeout: 45000, waitUntil: 'domcontentloaded' });
    await sleep(5000);
    const profText = await page.evaluate(() => document.body.innerText).catch(() => '');
    const profileOk = profText.includes(username) && !/page not found|log into instagram/i.test(profText);
    console.log('PROFILE:', profileOk ? 'OK ' + username : 'GAGAL');
    await page.screenshot({ path: 'ig-profile.png' }).catch(() => {});
    if (homeOk && profileOk) {
      const cookies = await ctx.cookies().catch(() => []);
      const dir = path.join(__dirname, '..', 'sessions');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, `ig-${username}-loggedin.json`),
        JSON.stringify({ platform: 'instagram', username, password, cookies, loggedin_at: new Date().toISOString() }, null, 2));
      console.log('SESSION LOGIN TERSIMPAN');
    } else if (profileOk) {
      // Profil kebuka = auth valid walau beranda gagal render (JS berat). Simpan juga.
      const cookies = await ctx.cookies().catch(() => []);
      const dir = path.join(__dirname, '..', 'sessions');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, `ig-${username}-loggedin.json`),
        JSON.stringify({ platform: 'instagram', username, password, cookies, loggedin_at: new Date().toISOString(), note: 'profile-ok-home-fail' }, null, 2));
      console.log('SESSION LOGIN TERSIMPAN (via profil)');
    }
    console.log(homeOk && profileOk ? 'HASIL: success' : 'HASIL: partial');
  } catch (e) {
    console.log('HASIL: failed |', e.message);
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
})();
