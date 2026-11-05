'use strict';

/**
 * TikTok Account Creator — slider captcha MANUAL (bila muncul), sisanya otomatis.
 * Alur: inbox -> cookies decline -> Use phone or email -> Sign up with email ->
 *   birthday -> email+password -> Send code -> kode OTP otomatis -> centang
 *   consent -> Next -> (slider manual max 10 mnt) -> simpan session.
 * Run: node src/tiktok-account-creator.js [proxy] [--keep-open] [--email alamat]
 */
require('dotenv').config();
const { chromium } = require('patchright'); // engine panel: patchright (drop-in playwright)
const fs = require('fs');
const path = require('path');
// Mail Worker (Cloudflare) — adaptor CJS di lib/mail-worker.
// PROVIDER INBOX: TMAILOR=1 pakai tmailor.com (Open API resmi, domain baru
// tiap run) — jalur ini yang dipakai setelah domain AMMail terbukti kena
// error_code 7 di TikTok. Default tetap Mail Worker (Cloudflare).
const USE_TMAILOR = (process.env.TMAILOR === '1' || process.argv.includes('--tmailor'))
  && !process.argv.includes('--email');
const { MailWorkerClient } = require('../lib/mail-worker');
const { TmailorClient } = require('../lib/mail-worker/tmailor');
const { extractOtp } = require('../lib/mail-worker/otp');
const mailWorker = USE_TMAILOR ? new TmailorClient() : new MailWorkerClient();

// Argumen berharga (--gmail-id N, --email alamat) dibaca dari argv MENTAH —
// kalau dibaca dari ARGS, flag-nya sudah terbuang dan nilainya kebaca sebagai
// PROXY_ARG ("http://--email:undefined").
const RAW_ARGV = process.argv.slice(2);
const flagVal = (name) => {
  const i = RAW_ARGV.indexOf(name);
  return i !== -1 && RAW_ARGV[i + 1] ? String(RAW_ARGV[i + 1]).trim() : null;
};
const VALUE_FLAGS = ['--gmail-id', '--email'];
const ARGS = RAW_ARGV.filter((a, idx, all) => {
  if (['--keep-open', '--desktop', '--tmailor'].includes(a)) return false;
  if (VALUE_FLAGS.includes(a)) return false;
  return !VALUE_FLAGS.includes(all[idx - 1]);
});
const PROXY_ARG = ARGS[0] || null;
const KEEP_OPEN = RAW_ARGV.includes('--keep-open');
// GMAIL STOK (--gmail-id N): pakai Gmail pool sbg email pendaftar TikTok — pola
// sama dgn FB: OTP dibaca via tab mail.google.com di context yang sama (profil
// sessions/gmail-<id> sudah login dari panel) + fallback kartu OTP panel bila tab
// gagal. Tanpagmail: temp-mail bot pilih sendiri.
const GMAIL_ID_ARG = (() => {
  const v = flagVal('--gmail-id');
  return v ? Number(v) : null;
})();
// EMAIL MANUAL (--email alamat): operator ketik sendiri di panel, paritas IG/FB.
// Bukan Gmail stok, bukan temp-mail: inboxnya di luar kendali bot, jadi kode
// verifikasi diminta lewat kartu OTP panel ([OTP_REQUIRED]) dan diketik operator.
const EMAIL_ARG = (() => {
  const v = flagVal('--email');
  return v ? v.toLowerCase() : null;
})();
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

function extractCode(subject, text, htmlStripped) {
  const hay = [subject || '', text || '', htmlStripped || ''].join('\n');
  let m = /(?:verification|confirm)\w*\s*code[^0-9]{0,10}([0-9]{4,8})|\bcode\b[^0-9]{0,10}([0-9]{4,8})/i.exec(hay);
  if (m) return m[1] || m[2];
  m = /\b([0-9]{6})\b/.exec((subject || '') + '\n' + (text || ''));
  return m ? m[1] : '';
}

(async () => {
  const result = { status: 'failed', email: null, password: null, error: null, steps: [], notes: [] };
  // wheelDone: birthday sudah terisi di age-gate (wheel UI-baru) — dipakai step
  // 'birthday' agar tidak false-menyesatkan di halaman email (tanpa combobox).
  let wheelDone = false;
  const step = (name, ok, msg) => {
    result.steps.push({ name, ok, msg: (msg || '').slice(0, 160) });
    console.log(`${ok ? 'OK ' : '....'} ${name} ${msg || ''}`);
  };
  let browser = null;

  try {
    // 0. Identitas Indonesia (untuk email manusiawi + password kuat).
    const idn = require('./id-identity').makeIdentity();
    result.fullName = idn.name;

    // 0b. Guard upaya CLI (jalur CLI tidak lewat create-runner, jadi dihitung di sini):
    // TikTok membalas error_code 7 "Batas percobaan maksimum" kalau 1 proxy/domain
    // dipakai terlalu sering dalam 24 jam — GAGAL PUN TERHITUNG. Cek sebelum browser
    // terbuka supaya kuota SIM tidak terbakar untuk run yang pasti ditolak.
    // (Lewat create-runner = TT_VIA_RUNNER=1 — runner sudah guard sendiri.)
    if (process.env.TT_VIA_RUNNER !== '1') try {
      const db = require('./db');
      const maxAtt = Number(process.env.MAX_ATTEMPTS_PER_PROXY_PER_DAY || '3');
      const att = PROXY_ARG ? db.countSignupAttempts24hByProxy(PROXY_ARG) : 0;
      if (att >= maxAtt) {
        console.log(`[GUARD] Proxy ini sudah dipakai ${att}x upaya signup 24 jam (maks ${maxAtt}, gagal termasuk).`);
        console.log('[GUARD] Rotasi IP (airplane mode 10 detik) atau tunggu cooldown. Run dibatalkan sebelum menyentuh TikTok.');
        process.exit(2);
      }
    } catch (e) { /* DB gagal — jangan blokir */ }

    // 1. Inbox — GMAIL STOK bila diminta, EMAIL MANUAL bila operator ketik
    //    di panel, kalau tidak temp-mail Mail Worker.
    let stockGmail = null;
    let manualEmail = null;
    // alias dasar nama file sesi (tt-<alias>.json). Dulu cuma ada di cabang
    // temp-mail sehingga tak terlihat saat nama sesi ditulis; kini diangkat
    // ke sini dan diisi setelah cabang inbox dipilih.
    let alias = null;
    if (GMAIL_ID_ARG) {
      const db = require('./db');
      await db.waitReady();
      const rows = await db.rawAll('SELECT id, email, password_enc, status, used_by FROM gmail_pool WHERE id = ?', [GMAIL_ID_ARG]);
      if (!rows || !rows.length) throw new Error('gmail #' + GMAIL_ID_ARG + ' tidak ditemukan di pool');
      // Satu Gmail layak daftar TIKTOK sendiri (platform-nya tiktok, tidak kena kurungan fb/ig).
      if (rows[0].status === 'used' && require('./db').gmailUsedPlatforms(rows[0].used_by || '').includes('tiktok')) {
        throw new Error('gmail #' + GMAIL_ID_ARG + ' (' + rows[0].email + ') sudah terpakai daftar TikTok (' + rows[0].used_by + ') — pilih Gmail lain');
      }
      const pw = require('./crypto').decrypt(rows[0].password_enc);
      if (!pw) throw new Error('password gmail #' + GMAIL_ID_ARG + ' tidak terbaca');
      stockGmail = { id: GMAIL_ID_ARG, email: rows[0].email, password: pw };
      result.email = stockGmail.email;
      result.gmailId = GMAIL_ID_ARG;
      step('inbox', true, 'Gmail stok #' + GMAIL_ID_ARG + ': ' + result.email);
    } else if (!EMAIL_ARG) {
      if (!mailWorker.configured) throw new Error(USE_TMAILOR
        ? 'tmailor belum dikonfigurasi (TMAILOR_API_KEY)'
        : 'Mail Worker belum dikonfigurasi (AMMAIL_BASE_URL/API_KEY)');
      const em = USE_TMAILOR ? {} : require('./email-alias').makeEmail({ first: idn.first, last: idn.last });
      const inboxRes = await mailWorker.createInbox(em.alias, em.domain).catch((e) => {
        throw new Error('inbox gagal: ' + String(e.message || e).split('\n')[0]);
      });
      const inboxEmail = inboxRes.email || inboxRes.address || '';
      if (!inboxEmail) throw new Error('Gagal bikin inbox');
      result.email = inboxEmail;
      alias = USE_TMAILOR ? inboxEmail : em.alias;
      if (inboxRes.reuseUrl) console.log('[TMAILOR] inbox reuse: ' + inboxRes.reuseUrl);
      step('inbox', true, result.email);
    } else if (EMAIL_ARG) {
      // EMAIL MANUAL: alamat ketik operator di panel. Inboxnya di luar kendali
      // bot, jadi kode verifikasi nanti diminta lewat kartu OTP panel.
      manualEmail = EMAIL_ARG;
      result.email = manualEmail;
      step('inbox', true, 'email manual operator: ' + manualEmail);
    }
    if (!alias) alias = String(result.email || 'tt').split('@')[0];
    result.password = idn.password;

    // 2. Browser — stealth terpusat (anti-detect): args anti-automation + cegah
    //    kebocoran IP asli via WebRTC (disable_non_proxied_udp).
    const stealth = require('./stealth');
    const launchOptions = {
      headless: false,
      args: stealth.launchArgs(),
    };
    if (PROXY_ARG) {
      const p = PROXY_ARG.split(':');
      launchOptions.proxy = { server: `http://${p[0]}:${p[1]}` };
      if (p[2]) { launchOptions.proxy.username = p[2]; launchOptions.proxy.password = p[3] || ''; }
      console.log('Proxy:', `http://${p[0]}:${p[1]}`);
    }
    // Chrome ASLI > Chromium Playwright: stack TLS/JA3 + biner identik Chrome asli
    // (Playwright Chromium punya sidik jari yang dikenali mesin risiko TikTok).
    // TT_CHROME=0 untuk memaksa Chromium bila perlu A/B test.
    if (process.env.TT_CHROME !== '0') {
      try {
        browser = await chromium.launch({ ...launchOptions, channel: 'chrome' });
        console.log('Browser: Google Chrome asli (channel chrome) — sidik jari lebih tahan deteksi');
      } catch (e) {
        console.log('Chrome asli tidak tersedia, fallback ke Chromium Playwright:', String(e.message).split('\n')[0].slice(0, 90));
      }
    }
    if (!browser) browser = await chromium.launch(launchOptions);
    // Mode MOBILE ID (default): emulasi HP Android + profil Indonesia, koheren dengan
    // geo proxy. Desktop pun ikut locale id-ID (en-US/New York + IP ID = sinyal aneh).
    const MOBILE = !process.argv.includes('--desktop');
    // Ukur layar asli via probe — PARITAS IG (akar perbaikan "tampilan terpotong"):
    // viewport lebih tinggi dari monitor membuat Chromium memotong jendela ke area
    // kerja Windows dan sisi bawah (tombol Berikutnya/slider) hilang. TikTok lama
    // memakai 412x915 fixed — di monitor pendek terpotong.
    // Viewport mobile DIVARIASIKAN per akun — paritas UA yang juga diundi dari pool.
    // Resolusi yang sama persis di puluhan akun adalah penanda pengelompokan yang
    // sama murahnya dengan UA identik. Daftar diambil dari stealth.VIEWPORTS supaya
    // hanya ukuran HP Android yang masuk, bukan angka acak.
    const vpPool = (stealth.VIEWPORTS || []).filter((v) => v && v.width && v.height && v.height <= 940);
    const vpUndi = MOBILE && vpPool.length
      ? vpPool[Math.floor(Math.random() * vpPool.length)]
      : { width: 1366, height: 768 };
    let vpW = vpUndi.width, vpH = vpUndi.height;
    try {
      const probe = await browser.newContext({ viewport: null });
      const ppage = await probe.newPage();
      await ppage.goto('about:blank', { timeout: 15000 }).catch(() => {});
      const scr = await ppage.evaluate(() => ({ w: screen.availWidth, h: screen.availHeight }));
      await probe.close().catch(() => {});
      if (scr && scr.h) {
        // Batas atas = area kerja monitor dikurangi ruang taskbar dan judul jendela.
        // min() di akhir bukan hiasan: kalau hasilnya lebih tinggi dari layar,
        // Chromium memotong jendela ke area kerja Windows dan tombol Berikutnya
        // serta slider captcha di bawah jadi tak bisa diklik (bug "tampilan
        // terpotong" yang sudah pernah terjadi). Lebar diperlakukan sama.
        const maxH = Math.max(480, scr.h - 140);
        const maxW = Math.max(320, scr.w);
        vpH = Math.min(vpH, maxH);
        vpW = Math.min(vpW, maxW);
        console.log(`Layar asli ${scr.w}x${scr.h} → viewport TikTok ${vpW}x${vpH} (undian ${vpUndi.width}x${vpUndi.height})`);
      }
    } catch (e) {
      console.log('ukur layar gagal — pakai viewport undian', vpW + 'x' + vpH);
    }
    // Versi Chrome di UA DISAMAKAN dengan Chromium asli (UA bohong = sinyal bot klasik).
    // UA mobile diambil dari pool perangkat (48 varian HP yang lazim di Indonesia),
    // bukan dipaku Pixel 7: UA identik di semua akun adalah penanda paling gampang
    // dipakai mesin risiko untuk mengelompokkan akun. Jalur --desktop (hanya untuk
    // uji) tetap satu varian karena bukan jalur produksi.
    const UA = stealth.alignUaVersion(
      MOBILE
        ? stealth.USER_AGENTS[Math.floor(Math.random() * stealth.USER_AGENTS.length)]
        : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      browser.version()
    );
    result.userAgent = UA;
    if (MOBILE) {
      // Model dicatat supaya Client Hints bisa dicek di log: harus sama dengan UA ini.
      const dev = /Android\s+[\d.]+\s*;\s*([^;)]+)/i.exec(UA);
      console.log('Perangkat: ' + (dev ? dev[1].trim() : 'Android'));
    }
    const context = MOBILE
      ? await browser.newContext({
          // Tinggi mengikuti layar asli (paritas IG): bagian bawah form/slider tak
          // terpotong di monitor pendek.
          viewport: { width: vpW, height: vpH },
          isMobile: true,
          hasTouch: true,
          deviceScaleFactor: 2,
          locale: 'id-ID',
          timezoneId: 'Asia/Jakarta',
          userAgent: UA,
        })
      : await browser.newContext({
          viewport: { width: vpW, height: vpH }, locale: 'id-ID', timezoneId: 'Asia/Jakarta',
          userAgent: UA,
        });
    if (MOBILE) console.log('Mode: MOBILE ID (Asia/Jakarta)');
    // Patchright: anti-detect di level engine — TANPA init script manual.
    // Hardening CDP per halaman tetap: UA protokol + userAgentData + Accept-Language.
    const FP = { userAgent: UA, languages: ['id-ID', 'id', 'en-US', 'en'] };
    context.on('page', (pg) => { stealth.attachPageHardening(context, pg, FP).catch(() => {}); });
    // Spoof canvas/WebGL/ClientRects/hardware — SEED DETERMINISTIK DARI EMAIL
    // (paritas IG/FB create). Email dipilih sebagai seed karena satu-satunya
    // identitas yang sudah pasti saat context dibuat DAN masih sama saat akun
    // dikelola nanti; seed dari id mustahil di sini karena baris akun belum ada.
    // Tanpa init script ini semua akun TikTok berbagi canvas hash identik —
    // sinyal clustering perangkat yang bisa menautkan akun-akun tersebut.
    try {
      const ttSpoof = require('./fingerprint-spoof').spoofConfigFor({
        id: 0,
        name: (result.email || '').split('@')[0],
        email: result.email || '',
        user_agent: UA,
      });
      await context.addInitScript(stealth.spoofInitScript(ttSpoof));
      // Ikut ditulis ke result file: jalur daftar akun memakai konfig INI, bukan
      // membangkitkan ulang dari id — kalau dibangkitkan ulang, canvas berubah
      // antara saat daftar dan login pertama (pola yang tidak natural).
      result.fingerprintJson = ttSpoof;
      console.log('Spoof: canvas 0x' + ttSpoof.canvasSeed.toString(16) + ' | webgl ' + ttSpoof.webgl.renderer);
    } catch (e) {
      console.log('spoof pasang gagal (lanjut tanpa):', String(e.message || e).slice(0, 90));
    }
    const page = await context.newPage();
    step('browser', true, 'terbuka');

    // Rekaman respons API TikTok: kalau "Kirim kode" tidak berefek, respons
    // passport/passpoint di sini membedakan blokir IP vs blokir sesi vs error form.
    const apiLog = [];
    page.on('response', async (resp) => {
      try {
        const u = resp.url();
        if (!/passport|passpoint|send_code|verify|captcha|challenge/i.test(u)) return;
        if (apiLog.length > 30) return;
        let body = '';
        try { body = (await resp.text()).slice(0, 300); } catch (e) { body = '<body tak terbaca>'; }
        apiLog.push({ url: u.slice(0, 160), status: resp.status(), body });
        console.log(`[api] ${resp.status()} ${u.slice(0, 110)} :: ${body.slice(0, 160)}`);
      } catch (e) { /* logging non-fatal */ }
    });

    // Landing TikTok memakai div[role="link"] dengan teks di dalamnya — click()
    // Playwright sering ditolak di div itu, jadi urutan percobaan: role link →
    // teks biasa → ketuk koordinat tengah elemen (fallback terakhir, selalu jalan).
    // Di mode mobile HANYA pakai sentuh: halaman web mobile TikTok mendengarkan
    // pointer/touch event, dan klik mouse sintetis sering diabaikan tanpa error —
    // inilah gejala "nav1 OK tapi layar tidak berpindah" pada dry-run 2/11.
    const clickText = async (texts, timeout = 8000) => {
      for (const t of texts) {
        const re = new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
        for (const loc of [page.getByRole('link', { name: re }), page.getByRole('button', { name: re }), page.locator(`text=${t}`)]) {
          const el = loc.first();
          if ((await el.count()) === 0) continue;
          await el.scrollIntoViewIfNeeded().catch(() => {});
          const box = await el.boundingBox().catch(() => null);
          if (MOBILE && box) {
            await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2).catch(() => {});
            await sleep(3000);
            return t;
          }
          if (await el.click({ timeout }).then(() => true).catch(() => false)) { await sleep(3000); return t; }
          if (box) {
            await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2).catch(() => {});
            await sleep(3000);
            return t;
          }
        }
      }
      return null;
    };

    // 3. Landing -> phone-or-email -> tab email
    // Navigasi ke TikTok kadang menggantung sekali di percobaan pertama
    // (ERR_TIMED_OUT padahal curl ke alamat yang sama balas 200 dalam 1 detik).
    // Ulangi maksimal 3x — jauh lebih murah daripada menggagalkan seluruh run.
    for (let coba = 1; ; coba++) {
      try {
        await page.goto('https://www.tiktok.com/signup', { timeout: 90000, waitUntil: 'domcontentloaded' });
        break;
      } catch (e) {
        if (coba >= 3) throw e;
        console.log(`goto gagal (percobaan ${coba}): ${String(e.message).split('\n')[0].slice(0, 90)} — ulangi`);
        await sleep(4000);
      }
    }
    await sleep(rand(4000, 6000));
    for (const name of [/decline/i, /reject/i, /tolak\b/i]) {
      const b = page.getByRole('button', { name }).first();
      if ((await b.count()) > 0) { await b.click().catch(() => {}); await sleep(2000); break; }
    }
    // Interstitial "Dapatkan pengalaman lebih lengkap di aplikasi" — WAJIB ditutup
    // dulu, kalau tidak seluruh halaman signup tertutup overlay dan semua klik
    // berikutnya gagal (screenshot 2/11: modal menutupi "Gunakan nomor telepon").
    // Tombolnya <button> teks polos ("Nanti saja" / "Not now"), jadi pakai
    // getByRole + klik koordinat sebagai cadangan.
    const closeAppModal = async () => {
      for (const name of [/nanti saja/i, /not now/i, /^later$/i, /^skip$/i, /buka tiktok/i]) {
        const btn = page.getByRole('button', { name }).first();
        if ((await btn.count()) === 0) continue;
        const visible = await btn.isVisible().catch(() => false);
        if (!visible) continue;
        if (/buka tiktok/i.test(name.source)) continue; // tombol merah = buka app, bukan tutup
        await btn.click({ timeout: 8000 }).catch(async () => {
          const bb = await btn.boundingBox().catch(() => null);
          if (bb) await page.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2).catch(() => {});
        });
        await sleep(2500);
        return true;
      }
      return false;
    };
    await closeAppModal();
    // Modal bisa muncul terlambat setelah navigasi (delay render) — cek sekali lagi.
    await sleep(2000);
    await closeAppModal();
    // Klik yang diterima Playwright belum tentu dijalankan React: handler kadang
    // belum terpasang saat halaman baru hydrate, jadi klik menjadi no-op tanpa
    // error dan run melapor nav1 OK padahal masih di landing — semua langkah
    // sesudahnya lalu gagal tanpa sebab yang jelas (run dry-run 2/11). Keberhasilan
    // dibuktikan dari layar: teks landing hilang berarti halaman benar-benar pindah.
    const masihDiLanding = async () => {
      const t = await page.evaluate(() => (document.body ? document.body.innerText : '') || '').catch(() => '');
      return /Gunakan nomor telepon atau email|Use phone or email/i.test(t);
    };
    let nav1ok = false;
    for (let coba = 0; coba < 3 && !nav1ok; coba++) {
      await clickText(['Use phone or email', 'Gunakan nomor telepon atau email']);
      const batas = Date.now() + 8000;
      while (Date.now() < batas) {
        if (!(await masihDiLanding())) { nav1ok = true; break; }
        await sleep(500);
      }
      if (!nav1ok) await sleep(1500);
    }
    step('nav1', nav1ok, nav1ok ? 'landing' : 'masih di landing setelah 3 percobaan klik');
    // Kalau tombol landing tetap tidak bisa ditekan, biasanya karena lapisan
    // DivMask menutupinya — pemicunya cookie/consent yang gagal dimuat dari
    // mon.tiktokv.com. Rute email bisa dibuka langsung tanpa tombol itu, jadi
    // dipakai sebagai cadangan. Catatan: jalur ini melewati gerbang umur; kalau
    // TikTok tetap menagih tanggal lahir setelah email, langkah birthday di
    // bawah yang menanganinya.
    if (!nav1ok) {
      try {
        await page.goto('https://www.tiktok.com/signup/phone-or-email/email', { timeout: 90000, waitUntil: 'domcontentloaded' });
        await sleep(4000);
        nav1ok = (await page.locator('input[type="email"], input[name="email"]').count()) > 0;
        step('nav1-cadangan', nav1ok, nav1ok ? 'rute email dibuka langsung' : 'rute email juga kosong');
        await stopIfRateLimited('halaman email (cadangan)');
      } catch (e) {
        step('nav1-cadangan', false, String(e.message).split('\n')[0].slice(0, 80));
      }
    }

    // Mesin risiko TikTok bisa langsung menampilkan "Frekuensi kunjungan terlalu
    // sering" / "Batas percobaan maksimum" (error_code 7) SEBELUM form diisi,
    // termasuk di halaman email (bukti screenshot 29/10). Deteksi dini: run
    // berhenti dengan diagnosis jelas, tidak lanjut mengisi email lalu menunggu
    // kode yang tidak akan pernah datang.
    const rateLimitHit = async () => {
      const t = await page.evaluate(() => (document.body ? document.body.innerText : '') || '').catch(() => '');
      const m = /(?:frekuensi kunjungan terlalu sering|batas percobaan maksimum|kunjungan terlalu sering)/i.exec(t);
      return m ? m[0] : '';
    };
    const stopIfRateLimited = async (where) => {
      const hit = await rateLimitHit();
      if (!hit) return;
      throw new Error('TikTok menolak di ' + where + ': "' + hit + '" (error_code 7 = IP/subnet/domain ini sudah ditandai). Pakai IP lain (rotasi/airplane mode atau proxy kamar bersih), atau ganti jalur email: "Ketik email sendiri" / Gmail stok.');
    };
    await stopIfRateLimited('landing signup');

    // TikTok punya DUA UI age-gate yang muncul bergantian (A/B di sisi mereka):
    //   (a) halaman /signup/phone-or-email/* — 3 dropdown div .DivSelector
    //       (Bulan/Hari/Tahun) sebaris dengan form Telepon/Email;
    //   (b) halaman /signup/age-gate — wheel .rmc-picker 3 kolom + tombol
    //       Berikutnya, harus digeser (touch), default-nya di 2025-12-10.
    // Keduanya wajib ditangani: run 2/11 masuk (a), run berikutnya (b).
    const MONTHS_W = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
    // Tanggal lahir diacak per run dalam rentang umur wajar. Dulu dipaku 8 Juli
    // 1998 sehingga seluruh akun lahir di tanggal identik. Batas bawah dijaga 20
    // tahun: umur di bawah 18 memicu pembatasan konten TikTok, jadi akun yang
    // lahir dengan tanggal itu langsung merugikan dirinya sendiri.
    // Bulan versi Inggris dipakai jalur desktop (combobox EN), bulan Indonesia
    // dipakai jalur mobile — keduanya harus berasal dari indeks yang sama.
    const MONTHS_EN = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    const BIRTH = (() => {
      const tahun = new Date().getFullYear() - rand(20, 34);
      const bulanIdx = rand(0, 11);
      const hariMax = new Date(tahun, bulanIdx + 1, 0).getDate();
      return {
        bulan: MONTHS_W[bulanIdx],
        bulanEn: MONTHS_EN[bulanIdx],
        hari: String(rand(1, hariMax)),
        tahun: String(tahun),
      };
    })();
    console.log(`Tanggal lahir: ${BIRTH.hari} ${BIRTH.bulan} ${BIRTH.tahun}`);

    // Helper: baca teks item yang tengah-terkurung di .rmc-picker-indicator
    const _readCol = async (i) => page.evaluate((i) => {
      const cols = [...document.querySelectorAll('.rmc-picker')].filter((e) => e.offsetParent !== null);
      const col = cols[i]; if (!col) return '';
      const ind = col.querySelector('.rmc-picker-indicator');
      const items = [...col.querySelectorAll('.rmc-picker-item')];
      if (!ind || !items.length) return '';
      const ic = ind.getBoundingClientRect().top + ind.getBoundingClientRect().height / 2;
      let best = null, bd = 1e9;
      for (const it of items) { const r = it.getBoundingClientRect(); const c = r.top + r.height / 2; const d = Math.abs(c - ic); if (d < bd) { bd = d; best = it; } }
      return best ? (best.innerText || '').trim() : '';
    }, i);

    // ---- (a) dropdown div ----
    // TikTok dropdown: label teks "Bulan" di atas, opsi-opsi ada di dalam container
    // DivSelector yang terbuka setelah label diklik. getByText('Juli') dengan anchor
    // ^Juli$ GAGAL karena teks ada di dalam <span> child. Cari opsi langsung via
    // evaluate + mouse click koordinat (paling reliable untuk nested React elements).
    const dropdownPresent = async () =>
      (await page.locator('.DivSelector').count()) >= 3;
    const pickIn = async (label, value) => {
      // 1. Klik label — cari elemen yang innerText persis = label
      const bb = await page.evaluate((lbl) => {
        const el = [...document.querySelectorAll('div,span')]
          .find(e => e.offsetParent !== null && (e.innerText || '').trim() === lbl);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height };
      }, label);
      if (!bb) return false;
      await page.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2);
      await sleep(1200);
      // 2. Dropdown terbuka — cari SEMUA elemen yang innerText persis = value
      const optCandidates = await page.evaluate((val) => {
        const results = [];
        const allEls = document.querySelectorAll('*');
        for (const el of allEls) {
          if (el.offsetParent === null) continue;
          const t = (el.innerText || '').trim();
          if (t === val || t === String(val)) {
            const r = el.getBoundingClientRect();
            if (r.width > 0 && r.height > 0) results.push({ text: t, x: r.x, y: r.y, w: r.width, h: r.height });
          }
        }
        results.sort((a, b) => (b.w * b.h) - (a.w * a.h));
        return results.slice(0, 5);
      }, value);
      if (!optCandidates.length) { await page.keyboard.press('Escape').catch(() => {}); return false; }
      const chosen = optCandidates[0];
      console.log('[pickIn] ' + label + '=' + value + ' -> click (' + chosen.x.toFixed(0) + ',' + chosen.y.toFixed(0) + ')');
      await page.mouse.click(chosen.x + chosen.w / 2, chosen.y + chosen.h / 2);
      await sleep(1000);
      return true;
    };

    // ---- (b) wheel .rmc-picker ----
    // mouse.wheel() TIDAK work di rmc-picker (tidak merespons event scroll).
    // Ganti dengan: CDP touch flick (confirmed work di probe) + keyboard arrows
    // sebagai fallback. Kolom urutan: [tahun, bulan, hari].
    const wheelPresent = async () => (await page.locator('.rmc-picker:visible').count()) > 0;
    const wheelTo = async (i, target, order) => {
      const idxOf = (s) => order ? order.indexOf(s) : parseInt(String(s).trim(), 10);
      const want = idxOf(target);
      if (!isFinite(want)) return false;
      const colBox = await page.locator('.rmc-picker:visible').nth(i).boundingBox().catch(() => null);
      if (!colBox) return false;
      const cx = colBox.x + colBox.width / 2, cy = colBox.y + colBox.height / 2;
      const ITEM_H = await page.evaluate(() => {
        const el = document.querySelector('.rmc-picker-item');
        return el ? el.getBoundingClientRect().height : 42;
      });
      let cdp = null;
      try { cdp = await context.newCDPSession(page); } catch (_) {}
      const flick = async (dy) => {
        if (!cdp) return;
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: cx, y: cy }] });
        for (let s = 1; s <= 20; s++) {
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: cx, y: cy + (dy * s) / 20 }] });
          await sleep(25);
        }
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await sleep(600);
      };
      // Jarak kolom tahun bisa 30+ item (2025 ke 1994), sedangkan satu flick sudah
      // meluncur beberapa item karena momentum. Versi lama cuma 4 percobaan dengan
      // langkah maksimal 6 item, jadi tahun jauh mustahil tercapai dan roda berhenti
      // di tahun default (2025) — run 2/11: "wheel gagal (tahun=false)".
      // Dua fase: geser kasar untuk jarak jauh, panah untuk sisa 1-3 item. Besar
      // geseran dihitung dari rasio gerak NYATA yang diukur tiap langkah, jadi
      // overshoot momentum terkoreksi sendiri tanpa menebak karakter picker.
      const panah = async (key, n) => {
        await page.locator('.rmc-picker:visible').nth(i).click().catch(() => {});
        await sleep(300);
        for (let k = 0; k < n; k++) {
          await page.keyboard.press(key);
          await sleep(120);
        }
        await sleep(400);
      };
      let rasio = 1;
      let sebelumnya = null;
      let diam = 0;
      for (let attempt = 0; attempt < 30; attempt++) {
        const cur = await _readCol(i);
        if (cur === String(target)) return true;
        const a = idxOf(cur);
        // a < 0 = teks kolom tidak dikenali (indeks bulan tak ketemu) — jangan
        // digeser ke arah yang salah hanya karena indexOf memberi -1.
        if (!isFinite(a) || a < 0) break;
        const diff = a - want;
        if (diff === 0) return true; // nilai sama walau format teksnya beda

        // Sisa 1-3 item: panah menggerakkan tepat satu item, tanpa momentum.
        if (Math.abs(diff) <= 3) {
          await panah(diff > 0 ? 'ArrowUp' : 'ArrowDown', Math.abs(diff));
          if (await _readCol(i) === String(target)) return true;
          if (++diam >= 2) break;
          sebelumnya = cur;
          await flick(Math.sign(diff) * ITEM_H);
          continue;
        }

        if (cur === sebelumnya) { if (++diam >= 2) break; } else { diam = 0; }
        sebelumnya = cur;

        const minta = Math.max(1, Math.min(12, Math.round(Math.abs(diff) / Math.max(0.35, rasio))));
        await flick(Math.sign(diff) * minta * ITEM_H);
        const b = idxOf(await _readCol(i));
        if (isFinite(b) && b !== a) {
          const bergerak = Math.abs(b - a);
          if (bergerak > 0 && Math.sign(b - a) === Math.sign(want - a)) rasio = bergerak / minta;
        }
      }
      return (await _readCol(i)) === String(target);
    };

    // Halaman /signup/phone-or-email/* kadang menampilkan judul birthday SEBELUM
    // dropdown-nya ter-render. Tunggu sampai salah satu varian benar-benar ada,
    // kalau tidak deteksi jatuh ke cabang wheel yang tidak ada apa-apa.
    for (let w = 0; w < 20; w++) {
      if ((await dropdownPresent()) || (await wheelPresent())) break;
      await sleep(1000);
    }
    if (await dropdownPresent()) {
      const okBulan = await pickIn('Bulan', BIRTH.bulan);
      const okHari = await pickIn('Hari', BIRTH.hari);
      const okTahun = await pickIn('Tahun', BIRTH.tahun);
      const ok = okBulan && okHari && okTahun;
      step('birthday', ok, ok ? `dropdown ${BIRTH.bulan}/${BIRTH.hari}/${BIRTH.tahun}` : `dropdown gagal (bulan=${okBulan} hari=${okHari} tahun=${okTahun})`);
      if (!ok) await page.screenshot({ path: 'tt-birthday-fail.png' }).catch(() => {});
      wheelDone = ok;
    } else if (await wheelPresent()) {
      const okTahun = await wheelTo(0, BIRTH.tahun, null);
      const okBulan = await wheelTo(1, BIRTH.bulan, MONTHS_W);
      const okHari = await wheelTo(2, BIRTH.hari, null);
      const ok = okTahun && okBulan && okHari;
      step('birthday', ok, ok ? `wheel ${BIRTH.bulan}/${BIRTH.hari}/${BIRTH.tahun}` : `wheel gagal (tahun=${okTahun} bulan=${okBulan} hari=${okHari})`);
      if (!ok) await page.screenshot({ path: 'tt-birthday-fail.png' }).catch(() => {});
      if (ok) {
        const nextW = page.getByRole('button', { name: /berikutnya|next/i }).first();
        if ((await nextW.count()) > 0 && !(await nextW.isDisabled().catch(() => true))) {
          await nextW.click({ timeout: 8000 }).catch(() => {});
          await sleep(4000);
        }
      }
      wheelDone = ok;
    }

    let nav2ok = !!(await clickText(['Mendaftar dengan email', 'Sign up with email', 'Daftar dengan email', 'Gunakan email', 'Lanjutkan dengan email']));
    if (!nav2ok) {
      // Varian UI baru: setelah nav1 langsung ke halaman gabungan (birthday+email satu
      // halaman) — tidak ada tombol nav2; cukup pastikan kolom email sudah terlihat.
      await sleep(2500);
      nav2ok = (await page.locator('input[type="email"], input[name="email"]').count()) > 0;
    }
    step('nav2', nav2ok, 'tab email');
    // UI BARU: /signup/phone-or-email menampilkan tab "Telepon | Email" — klik tab
    // "Email" EXACT (klik container memilih Telepon, penyebab halaman tak berpindah).
    if (/phone-or-email/.test(page.url()) && !/\/email/.test(page.url())) {
      const tabEmail = page.getByText('Email', { exact: true }).first();
      if ((await tabEmail.count()) > 0) {
        await tabEmail.click({ timeout: 8000 }).catch(() => {});
        await sleep(3000);
        step('tab-email', true, 'halaman email terbuka');
      } else {
        step('tab-email', false, 'tab Email tidak ketemu');
      }
    }
    await stopIfRateLimited('halaman email');

    // 4. Birthday — tiga varian UI:
    //    (a) mobile-web id-ID: rmc-picker 3 kolom [tahun,bulan,hari] berbasis flick — sulit,
    //        hanya dipakai bila --desktop gagal;
    //    (b) desktop EN: [role=combobox] Month/Day/Year, klik -> listbox klikable;
    //    (c) combobox ID lama.
    const CONTEXT_IS_MOBILE = MOBILE;
    let bd = [false, false, false];
    // Paritas UI-BARU: age-gate wheel di /age-gate SUDAH diisi + klik Berikutnya di
    // blok atas (step 'wheel' true/true/true). Halaman email selanjutnya TAK PUNYA
    // combobox birthday lagi — step 'birthday' membaca flag wheelDone (dideklarasikan
    // di atas, sebelum async IIFE body). Run 12/10: wheel sukses tapi step birthday
    // melapor false/false/false (bohong).
    const MONTHS = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
    if ((await page.locator('.rmc-picker:visible').count()) >= 3) {
      // (a) rmc-picker: kolom [tahun,bulan,hari]; swipe pendek dead-zone, flick 200px =
      //     3-7 item tergantung momentum — dikendalikan loop: flick menuju target, baca
      //     .rmc-picker-item-selected, ulangi sampai pas atau berhenti bila tak berubah.
      //     HANYA picker TERLIHAT — sisa picker tersembunyi dari UI lama membuat
      //     bacaan kosong dan birthday gagal diam-diam.
      const cols = page.locator('.rmc-picker:visible');
      const cdp = await context.newCDPSession(page);
      // Timeout eksplisit 2.5s + selector bertingkat: varian UI baru kadang tak
      // punya .rmc-picker-item-selected — coba [class*=selected] yang terlihat.
      const readSel = async (i) => {
        if ((await cols.count()) <= i) return '';
        const col = cols.nth(i);
        let v = await col.locator('.rmc-picker-item-selected:visible').first().innerText({ timeout: 2500 }).catch(() => '');
        if (!v) v = await col.locator('[class*="selected"]:visible').first().innerText({ timeout: 2500 }).catch(() => '');
        return (v || '').trim();
      };
      const swipe = async (i, dy, totalMs) => {
        const box = await cols.nth(i).boundingBox().catch(() => null);
        if (!box) return;
        const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: cx, y: cy }] });
        for (let s = 1; s <= 20; s++) {
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: cx, y: cy + (dy * s) / 20 }] });
          await sleep(totalMs / 20);
        }
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await sleep(3000);
      };
      const ORDER = [null, MONTHS, null]; // kolom 0=tahun, 1=bulan, 2=hari
      const TARGET = [BIRTH.tahun, BIRTH.bulan, BIRTH.hari];
      // Watchdog: seluruh loop flick maks 150 detik — kalau lewat, lanjut dengan
      // apa adanya (fallback combobox/email tetap berjalan) daripada menggantung.
      const flickAll = async () => {
      const idxOf = (i, s) => (ORDER[i] ? ORDER[i].indexOf(s) : parseInt(s, 10));
      for (let i = 0; i < 3; i++) {
        const target = String(TARGET[i]);
        for (let k = 0; k < 12; k++) {
          const cur = await readSel(i);
          if (cur === target) { bd[i] = true; break; }
          const a = idxOf(i, cur), b = idxOf(i, target);
          if (!isFinite(a) || !isFinite(b) || a === b) break;
          const gap = Math.abs(b - a);
          // dy>0 = index turun; arah diperbaiki lewat pembacaan ulang tiap iterasi
          const dy = (b > a ? 1 : -1) * Math.min(220, 120 + gap * 8);
          await swipe(i, dy, 500);
          const now = await readSel(i);
          if (now === cur) { /* flick tak berefek — coba sekali lagi dengan daya beda */
            await swipe(i, (b > a ? 1 : -1) * 200, 400);
          }
        }
        bd[i] = (await readSel(i)) === target;
      }
      };
      await Promise.race([flickAll(), sleep(150000)]);
      if (!bd.every((v) => v === true)) {
        try { await page.screenshot({ path: 'tt-birthday-fail.png' }); } catch (e) { /* abaikan */ }
        console.log('[birthday] wheel ada tapi target tak tercapai — bukti: tt-birthday-fail.png');
      }
    } else {
      // (b) Desktop EN/ID: [role=combobox] Month/Day/Year (atau Bulan/Hari/Tahun)
      //     -> popup listbox DOM klikable. Label & nilai dicoba EN dan ID.
      // Catatan: setelah dipilih, label BERGANTI jadi nilai — jadi verifikasi
      // memakai indeks combobox (0=bulan,1=hari,2=tahun), bukan locator ber-label.
      const pickDesk = async (labels, targets, idx) => {
        let combo = null;
        for (const label of labels) {
          const c = page.locator('[role="combobox"]', { has: page.getByText(label, { exact: true }) }).first();
          if ((await c.count()) > 0) { combo = c; break; }
        }
        if (!combo) return false;
        await combo.click({ timeout: 8000 }).catch(() => {});
        await sleep(1500);
        let opt = null;
        for (const target of targets) {
          opt = page.locator('[role="option"]', { hasText: new RegExp(`^${target}$`, 'i') }).first();
          if ((await opt.count()) === 0) opt = page.getByText(target, { exact: true }).last();
          if ((await opt.count()) > 0) break;
        }
        if (!opt || (await opt.count()) === 0) { await page.keyboard.press('Escape').catch(() => {}); return false; }
        await opt.click({ timeout: 8000 }).catch(() => {});
        await sleep(1000);
        const vals = await page.locator('[role="combobox"]').allTextContents().catch(() => []);
        return targets.some((t) => String(vals[idx] || '').includes(t));
      };
      bd = [
        await pickDesk(['Month', 'Bulan'], [BIRTH.bulanEn, BIRTH.bulan], 0),
        await pickDesk(['Day', 'Hari', 'Tanggal'], [BIRTH.hari], 1),
        await pickDesk(['Year', 'Tahun'], [BIRTH.tahun], 2),
      ];
      // Retry: halaman lambat via seluler kadang belum meng-hydrate combobox saat
      // pickDesk pertama jalan — ulang maks 3x sampai ketiganya terpilih.
      for (let att = 0; att < 3 && !bd.every((v) => v === true); att++) {
        await page.waitForSelector('[role="combobox"]', { timeout: 12000 }).catch(() => {});
        await sleep(2500);
        bd = [
          bd[0] || await pickDesk(['Month', 'Bulan'], [BIRTH.bulanEn, BIRTH.bulan], 0),
          bd[1] || await pickDesk(['Day', 'Hari', 'Tanggal'], [BIRTH.hari], 1),
          bd[2] || await pickDesk(['Year', 'Tahun'], [BIRTH.tahun], 2),
        ];
      }
      // Fallback (c): Combobox ID lama (mobile UI versi lama) — dipakai bila
      // combobox gaya-desktop tidak ada tapi combobox lain tersedia.
      if (!bd.some((v) => v === true) && (await page.locator('[role="combobox"]').count()) > 0) {
      const pickTT = async (boxName, optionText) => {
        const box = page.locator('[role="combobox"]', { hasText: new RegExp(`^${boxName}`, 'i') }).first();
        if ((await box.count()) === 0) {
          const alt = page.locator(`div[aria-label*="${boxName}" i]`).first();
          if ((await alt.count()) === 0) return false;
          await alt.click({ timeout: 8000 }).catch(() => {});
        } else {
          await box.click({ timeout: 8000 }).catch(() => {});
        }
        await sleep(1800);
        const opt = page.locator('[role="option"], [role="listitem"]', { hasText: new RegExp(`^${optionText}$`, 'i') }).first();
        if ((await opt.count()) > 0) {
          await opt.click({ timeout: 8000 }).catch(() => {});
          await sleep(1000);
          return true;
        }
        return false;
      };
      const pickAny = async (boxes, options) => {
        for (const b of boxes) for (const o of options) {
          if ((await pickTT(b, o)) === true) return true;
        }
        return false;
      };
      bd = [
        await pickAny(['Month', 'Bulan'], [BIRTH.bulan, BIRTH.bulanEn]),
        await pickAny(['Day', 'Tanggal'], [BIRTH.hari]),
        await pickAny(['Year', 'Tahun'], [BIRTH.tahun]),
      ];
      }
    }
    // Wheel age-gate sudah sukses = birthday SELESAI (tanggal di halaman email tidak
    // ada); hanya bila tak ada wheel barulah dicek combobox di halaman ini.
    step('birthday', wheelDone || bd.every((v) => v === true), wheelDone ? 'terisi di age-gate (wheel)' : bd.join('/'));
    if (bd.every((v) => v === true)) {
      // Mobile id-ID: klik "Berikutnya" untuk lanjut ke halaman email.
      // Desktop EN: form email sudah di halaman sama — JANGAN klik "Next"
      // (itu tombol submit tab phone).
      const nextB = page.getByRole('button', { name: /^Berikutnya$/ }).first();
      if ((await nextB.count()) > 0) { await nextB.click().catch(() => {}); await sleep(3500); }
    }

    // 5. Email + password (desktop: form di halaman sama; mobile id-ID: setelah Berikutnya)
    const emailBox = page.locator('input[type="email"], input[name="email"], input[placeholder*="mail" i]').first();
    if ((await emailBox.count()) > 0) {
      await emailBox.click().catch(() => {});
      await emailBox.fill(result.email).catch(() => {});
      await sleep(1000);
    }
    const passBox = page.locator('input[type="password"]').first();
    if ((await passBox.count()) > 0) {
      await passBox.click().catch(() => {});
      await passBox.fill(result.password).catch(() => {});
      await sleep(1000);
    }
    // JANGAN klaim sukses palsu: halaman birthday berdiri sendiri tak punya kolom
    // email — tandai ok hanya kalau kolomnya benar-benar ada.
    step('form', (await emailBox.count()) > 0, 'email+pass');

    // DRY-RUN: berhenti SEBELUM Send code — OTP tidak dikirim, akun tidak dibuat,
    // email hasil generate tidak terpakai untuk pendaftaran.
    if (process.env.TT_DRY_RUN === '1') {
      try { await page.screenshot({ path: 'tt-dryrun.png' }); } catch (e) { /* abaikan */ }
      // Pesan ini dulu selalu menulis "email+pass+birthday terisi" apa pun keadaan
      // sebenarnya, sehingga run yang gagal separuh tetap terbaca sukses. Sekarang
      // tiap bagian dilaporkan dari hasil pemeriksaan, bukan dari harapan.
      const ringkas = [
        'email=' + ((await emailBox.count()) > 0 ? 'ada' : 'tidak ada'),
        'sandi=' + ((await passBox.count()) > 0 ? 'ada' : 'tidak ada'),
        'birthday=' + ((wheelDone || bd.every((v) => v === true)) ? 'ok' : 'gagal'),
      ].join(' ');
      step('dry-run', true, `berhenti SEBELUM Send code — ${ringkas} (bukti: tt-dryrun.png)`);
      result.status = 'dry-run';
      console.log('\nHASIL: dry-run |', result.email, '| form TikTok terisi, Send code tidak diklik (TT_DRY_RUN=1)');
      console.log('\nRingkasan:', JSON.stringify(result.steps, null, 1));
      if (browser) await browser.close().catch(() => {});
      process.exit(0);
    }

    // 6. Send code -> baca OTP dari inbox -> isi (label EN/ID: "Send code"/"Kirim kode")
    // Cari tombol bertingkat: <button> asli → teks apa pun (TikTok kadang pakai
    // <div> ber-style tombol) → button-like yang memuat "kode". Via seluler halaman
    // kadang lambat hydrate, jadi tiap putaran diberi jeda — total ±24 detik.
    const findSend = async () => {
      // UI baru (/phone-or-email/email): tombol submit = "Berikutnya" — klik ini
      // yang memicu pengiriman kode (bukan "Kirim kode" seperti UI lama).
      const strat = /phone-or-email\/email/.test(page.url()) ? [
        () => page.getByRole('button', { name: /berikutnya|next/i }).first(),
      ] : [
        () => page.getByRole('button', { name: /send code|kirim kode/i }).first(),
        () => page.locator('text=/kirim kode|send code/i').first(),
        () => page.locator('button:has-text("kode"), [role="button"]:has-text("kode")').first(),
      ];
      for (let round = 0; round < 3; round++) {
        for (const s of strat) {
          const l = s();
          if ((await l.count()) > 0) return l;
        }
        await sleep(3000);
      }
      return null;
    };
    const sendBtn = await findSend();
    if (!sendBtn) {
      try { await page.screenshot({ path: 'tt-no-send.png' }); } catch (e) { /* abaikan */ }
      throw new Error('Tombol Send code tidak ketemu (bukti: tt-no-send.png)');
    }
    const sendDis = await sendBtn.isDisabled().catch(() => true);
    if (sendDis) throw new Error('Send code disabled — birthday/email belum valid');

    // Klik TERVERIFIKASI: ulangi max 3x sampai ada efek (countdown / slider / field aktif)
    const sendEffect = async () => {
      const t = await page.evaluate(() => document.body ? document.body.innerText : '').catch(() => '');
      return /resend|re-send|kirim ulang|kode terkirim|code sent|masukkan kode|kode verifikasi|enter.{0,12}code|\b\d{1,3}\s*(s|dtk|detik)\b|drag.*(slider|puzzle)|slide to complete|verify.*drag|seret/i.test(t || '');
    };
    let sentOk = false;
    // Klik mirip manusia: gerak mouse bertahap ke tombol + jeda acak + klik penuh
    // (locator.click polos kadang diabaikan mesin risiko TikTok tanpa pesan apa pun).
    const humanClick = async (loc) => {
      const box = await loc.boundingBox().catch(() => null);
      if (!box) return loc.click({ timeout: 8000 }).catch(() => {});
      await page.mouse.move(box.x + box.width / 2 + (Math.random() * 10 - 5), box.y + box.height / 2 + (Math.random() * 6 - 3), { steps: 12 + Math.floor(Math.random() * 10) });
      await sleep(250 + Math.floor(Math.random() * 350));
      await page.mouse.down(); await sleep(60 + Math.floor(Math.random() * 80)); await page.mouse.up();
    };
    for (let attempt = 1; attempt <= 3 && !sentOk; attempt++) {
      await sendBtn.scrollIntoViewIfNeeded().catch(() => {});
      await humanClick(sendBtn);
      await sleep(4000);
      // Fallback: fokus + Enter
      if (!(await sendEffect())) {
        await sendBtn.focus().catch(() => {});
        await page.keyboard.press('Enter').catch(() => {});
        await sleep(4000);
      }
      sentOk = await sendEffect();
      step('sendcode', sentOk, `klik ke-${attempt} ${sentOk ? 'berefek' : 'belum berefek'}`);
    }
    try { await page.screenshot({ path: 'tt-after-send.png' }); } catch (e) { /* abaikan */ }
    // Fail-fast: TikTok menolak di level API (error_code 7) — inline error muncul
    // tanpa slider/kode. Jangan buang 5 mnt polling OTP untuk run yang pasti gagal.
    const rejectText = await page.evaluate(() => {
      const t = (document.body ? document.body.innerText : '') || '';
      const m = /Batas percobaan maksimum|Frekuensi kunjungan|terlalu sering/i.exec(t);
      return m ? m[0] : '';
    }).catch(() => '');
    if (rejectText) throw new Error('TikTok menolak: ' + rejectText + ' (error_code 7 — rotasi IP/subnet, bukan cuma airplane mode)');
    // Gmail stok SEKALI PAKAI: begitu tombol Send/Berikutnya sudah diklik, TikTok
    // bisa saja sudah menerima email walau UI bilang "belum berefek" (klik diabaikan
    // bukan berarti server menolak). Tandai used DI SINI — SEBELUM polling OTP —
    // supaya run macet apa pun hasilnya (captcha timeout, OTP tak datang, browser
    // ditutup) Gmail ini tidak kembali 'available' di dropdown dan dipakai daftar
    // ulang (OTP kedua tidak pernah datang ke inbox yang sama — berulang = bug panel).
    // TikTok menolak error_code 7 SEBELUM titik ini = email belum tersentuh, tetap available.
    if (stockGmail) {
      try {
        require('./db').markGmailUsed(stockGmail.id, 'tiktok', (result.email || '').split('@')[0]);
        console.log('[GMAIL] pool #' + stockGmail.id + ' ditandai used utk tiktok (email sudah diketik + Send diklik): ' + String(result.email || '').split('@')[0]);
      } catch (e) { console.log('[GMAIL] tandai used (send-code) gagal: ' + e.message); }
    }
    if (!sentOk) {
      step('sendcode', false, 'tidak berefek 3x — KLIK MANUAL di browser, bot lanjut polling OTP 5 mnt');
    }

    // Slider bisa muncul LANGSUNG habis Send code — selesaikan manual dulu
    // baru polling OTP (kalau tidak, email tidak akan pernah dikirim).
    const sliderGoneEarly = async () => {
      const t = await page.evaluate(() => document.body ? document.body.innerText : '').catch(() => '');
      return !/drag.*(slider|puzzle)|slide to complete|verify.*drag|drag the slider|seret/i.test(t || '');
    };
    if (!(await sliderGoneEarly())) {
      console.log('\n*** GESER SLIDER CAPTCHA DI BROWSER SEKARANG (max 10 mnt) ***\n');
      step('captcha', false, 'menunggu geser manual...');
      let waited = 0;
      while (waited < 600 && !(await sliderGoneEarly())) {
        await sleep(5000);
        waited += 5;
        if (waited % 60 === 0) console.log(`... nunggu slider (${waited / 60} mnt)`);
      }
      if (!(await sliderGoneEarly())) throw new Error('captcha_timeout');
      step('captcha', true, 'selesai manual');
      await sleep(3000);
    }

    let code = '';
    if (manualEmail) {
      // JALUR EMAIL MANUAL: inbox email itu di luar kendali bot (bukan Gmail
      // stok, bukan temp-mail). Marker [OTP_REQUIRED] memunculkan kartu OTP di
      // panel; operator ambil kode dari inbox email itu lalu ketik di kartu.
      // Baris masuk dibaca dari stdin, jalur sama dengan kartu OTP IG/FB.
      console.log('[OTP_REQUIRED] Email manual ' + manualEmail + ' — buka inbox email itu, ambil kode verifikasi TikTok, ketik di panel (kartu OTP). Menunggu max 8 menit.');
      code = await new Promise((resolve) => {
        if (!process.stdin || process.stdin.readable === false) {
          console.log('[OTP_REQUIRED] stdin tidak tersedia — jalankan lewat panel supaya kartu OTP aktif.');
          return resolve('');
        }
        let buf = '';
        const onData = (d) => {
          buf += String(d);
          const nl = buf.indexOf('\n');
          if (nl === -1) return;
          process.stdin.off('data', onData);
          const m = /\b(\d{4,8})\b/.exec(buf.slice(0, nl));
          resolve(m ? m[1] : '');
        };
        process.stdin.setEncoding('utf8');
        process.stdin.on('data', onData);
        setTimeout(() => { process.stdin.off('data', onData); resolve(''); }, 8 * 60 * 1000);
      });
      if (code) console.log('[OTP_GOT] kode diterima dari panel.');
    } else if (stockGmail) {
      // JALUR GMAIL STOK: OTP dibaca via tab mail.google.com di context yang sama
      // (profil sessions/gmail-<id> sudah login dari panel) — pola FB. Bila tab
      // gagal atau email tak datang, FALLBACK: kartu OTP panel ([OTP_REQUIRED]).
      let gmailTab = null;
      try {
        const pages = context.pages();
        gmailTab = pages.find((p) => /mail\.google\.com/.test(p.url())) || null;
        if (!gmailTab) {
          gmailTab = await context.newPage();
          await gmailTab.goto('https://mail.google.com/mail/u/0/#inbox', { timeout: 60000, waitUntil: 'domcontentloaded' }).catch(() => {});
        }
      } catch (e) { gmailTab = null; }
      console.log('[OTP] polling Gmail stok via tab' + (gmailTab ? '' : ' GAGAL DIBUKA — fallback kartu OTP panel setelah 60 dtk'));
      for (let i = 0; i < 24 && !code; i++) {
        await sleep(5000);
        try {
          if (gmailTab) {
            const rows = gmailTab.locator('tr.zA, div[role="link"][data-legacy-thread-id], tr[jsmodel]').filter({ hasText: /tiktok/i }).first();
            if (await rows.isVisible().catch(() => false)) {
              await rows.click({ timeout: 8000 }).catch(() => {});
              await sleep(3000);
              const body = await gmailTab.evaluate(() => (document.body ? document.body.innerText : '')).catch(() => '');
              const f = extractOtp('', body, body);
              if (f.code) { code = f.code; break; }
              await gmailTab.goBack({ timeout: 15000, waitUntil: 'domcontentloaded' }).catch(() => {});
            }
          }
        } catch (e) { /* lanjut */ }
        if (i === 11) console.log('[OTP_REQUIRED] Gmail stok belum terima kode — ketik kode manual di panel (kartu OTP). Menunggu max 4 menit lagi.');
        if (i >= 12) {
          // Fallback operator: baca stdin via askOperatorOtp-like (baris angka).
          try {
            const line = await new Promise((resolve) => {
              let buf = '';
              const onData = (d) => { buf += String(d); const nl = buf.indexOf('\n'); if (nl !== -1) { process.stdin.off('data', onData); resolve(buf.slice(0, nl).trim()); } };
              process.stdin.setEncoding('utf8'); process.stdin.on('data', onData);
              setTimeout(() => { process.stdin.off('data', onData); resolve(''); }, 20 * 1000);
            });
            const m = /\b(\d{4,8})\b/.exec(line || '');
            if (m) code = m[1];
          } catch (e) { /* lanjut */ }
        }
        if (i % 6 === 5) console.log(`... nunggu kode OTP (${Math.round((i + 1) * 5 / 60)} mnt)`);
      }
    } else {
      // TEMP-MAIL (Mail Worker / tmailor): OTP ditarik dari API inbox.
      if (USE_TMAILOR && typeof mailWorker.waitForOtp === 'function') {
        const found = await mailWorker.waitForOtp(alias, 5).catch((e) => {
          console.log('[OTP] tmailor error: ' + String(e.message || '').split('\n')[0]);
          return null;
        });
        if (found && found.code) code = String(found.code);
        if (!code) {
          for (let i = 0; i < 12 && !code; i++) {
            await sleep(5000);
            try {
              for (const prev of await mailWorker.listMessages(alias)) {
                if (!prev.id) continue;
                const msg = await mailWorker.getMessage(prev.id);
                const f = extractOtp(msg.text || msg.body || '', msg.html || '', msg.subject || '');
                if (f.code || msg.otp) { code = String(f.code || msg.codes?.[0] || msg.otp); break; }
              }
            } catch (e) { /* lanjut */ }
          }
        }
      }
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
        } catch (e) { /* lanjut */ }
        if (i % 6 === 5) console.log(`... nunggu kode OTP (${Math.round((i + 1) * 5 / 60)} mnt)`);
      }
    }
    step('otp', !!code, code ? `kode: ${code}` : 'tidak masuk');
    if (!code) throw new Error('otp_not_received');

    const codeBox = page.locator('input[placeholder*="code" i], input[placeholder*="kode" i], input[name*="code" i]').first();
    if ((await codeBox.count()) > 0) {
      await codeBox.click().catch(() => {});
      await codeBox.fill(code).catch(() => {});
      await sleep(2000);
      step('fillcode', true, 'kode diisi');
    } else {
      step('fillcode', false, 'kolom kode tidak ketemu');
    }

    // 7. Centang consent (sesuai arahan: centang dulu baru Next)
    const checkbox = page.locator('input[type="checkbox"]').first();
    if ((await checkbox.count()) > 0) {
      const checked = await checkbox.isChecked().catch(() => false);
      if (!checked) await checkbox.check({ force: true }).catch(() => {});
      await sleep(1000);
      step('consent', true, 'dicentang');
    } else {
      step('consent', false, 'checkbox tidak ketemu');
    }

    // 8. Slider captcha MANUAL bila muncul (max 10 mnt)
    const sliderGone = async () => {
      const t = await page.evaluate(() => document.body ? document.body.innerText : '').catch(() => '');
      return !/drag.*(slider|puzzle)|slide to complete|verify.*drag|seret/i.test(t || '');
    };
    if (!(await sliderGone())) {
      console.log('\n*** GESER SLIDER CAPTCHA DI BROWSER SEKARANG (max 10 mnt) ***\n');
      step('captcha', false, 'menunggu geser manual...');
      let waited = 0;
      while (waited < 600 && !(await sliderGone())) {
        await sleep(5000);
        waited += 5;
        if (waited % 60 === 0) console.log(`... nunggu slider (${waited / 60} mnt)`);
      }
      if (!(await sliderGone())) throw new Error('captcha_timeout');
      step('captcha', true, 'selesai manual');
    } else {
      step('captcha', true, 'tidak muncul');
    }

    // 9. Next
    const nextBtn = page.getByRole('button', { name: /^next$/i }).first();
    if ((await nextBtn.count()) > 0) {
      const dis = await nextBtn.isDisabled().catch(() => true);
      step('next-state', !dis, 'disabled=' + dis);
      if (!dis) {
        await nextBtn.click().catch(() => {});
        await sleep(rand(8000, 12000));
      }
    }
    const afterUrl = page.url();
    const afterText = await page.evaluate(() => document.body ? document.body.innerText : '').catch(() => '');
    result.notes.push('After-next URL: ' + afterUrl.slice(0, 120));
    result.notes.push('After-next: ' + String(afterText).slice(0, 400).replace(/\n+/g, ' | '));
    try { await page.screenshot({ path: 'tiktok-create-result.png' }); } catch (e) { /* abaikan */ }
    step('next', true, afterUrl.slice(0, 80));

    // 10. Session
    const cookies = await context.cookies().catch(() => []);
    const sessionDir = path.join(__dirname, '..', 'sessions');
    fs.mkdirSync(sessionDir, { recursive: true });
    const sessionPath = path.join(sessionDir, `tt-${alias}.json`);
    fs.writeFileSync(sessionPath, JSON.stringify({
      platform: 'tiktok', email: result.email, password: result.password,
      cookies, created_at: new Date().toISOString()
    }, null, 2));
    step('session', true, sessionPath);

    if (/foryou|following|@[\w.]+/i.test(afterUrl) || cookies.some((c) => /sessionid|sid|uid/.test(c.name))) {
      result.status = 'success';
    } else {
      result.status = 'partial';
      result.error = 'cek tiktok-create-result.png';
    }
    console.log('\nHASIL:', result.status, '|', result.email, '|', result.error || '-');

    // Result file untuk panel (dibaca create-runner → kartu hasil & tombol daftar).
    try {
      fs.mkdirSync(path.join(__dirname, '..', 'sessions'), { recursive: true });
      fs.writeFileSync(path.join(__dirname, '..', 'sessions', 'last-create-tiktok.json'), JSON.stringify({
        platform: 'tiktok', status: result.status, username: result.username || (result.email || '').split('@')[0],
        email: result.email, password: result.password, fullName: result.fullName || null,
        emailDomain: (result.email || '').split('@')[1] || null,
        proxy: PROXY_ARG || null, birthIp: process.env.TT_BIRTH_IP || null,
        fingerprintJson: result.fingerprintJson || null,
        user_agent: result.userAgent || null,
        sessionFile: path.join(__dirname, '..', 'sessions', `tt-${alias}.json`),
        error: result.error || null, notes: result.notes || [],
        createdAt: new Date().toISOString(),
      }, null, 2));
    } catch (e) { console.log('Gagal tulis result file:', e.message); }
    // Gmail stok terpakai daftar TikTok — tandai pool 'used utk tiktok' saat job sukses
    // (paritas IG: platform masing-masing sekali; partial dibiarkan available utk nyoba lagi).
    if (stockGmail && result.status === 'success') {
      try {
        require('./db').markGmailUsed(stockGmail.id, 'tiktok', (result.email || '').split('@')[0]);
        console.log('[GMAIL] pool #' + stockGmail.id + ' ditandai used utk tiktok:' + String(result.email || '').split('@')[0]);
      } catch (e) { console.log('[GMAIL] tandai used gagal: ' + e.message); }
    }
    // Catat upaya CLI ke riwayat — guard butuh hitungan ini (dry-run tak dihitung).
    if (result.status !== 'dry-run') try {
      const db = require('./db');
      void db.addSignupHistory({
        ip: process.env.TT_BIRTH_IP || null,
        platform: 'tiktok',
        username: result.username || (result.email || '').split('@')[0] || null,
        status: result.status,
        proxy: PROXY_ARG || null,
        emailDomain: (result.email || '').split('@')[1] || null,
      });
    } catch (e) { /* riwayat gagal — jangan ganggu hasil */ }
  // Enhanced TikTok error detection dengan pattern matching
  const detectTikTokError = (errorMessage) => {
    const patterns = {
      // Rate limiting & IP blocking
      'error_code_7': /error_code.*7|Frekuensi kunjungan|terlalu sering|Batas percobaan/i,
      'ip_ban': /blocked|banned|diblokir|restricted|access denied/i,
      'captcha': /captcha|verify|human verification|robot check/i,
      'device_ban': /device.*ban|browser.*block|fingerprint.*detect/i,
      'phone_required': /phone.*required|nomor telepon|sms.*verification/i,
      'email_domain': /email.*domain|domain.*not.*allowed|invalid.*domain/i
    };
    
    for (const [errorType, pattern] of Object.entries(patterns)) {
      if (pattern.test(errorMessage)) {
        return errorType;
      }
    }
    return 'unknown';
  };
  
  // Auto-recovery strategies berdasarkan error type
  const recoveryStrategies = {
    'error_code_7': {
      action: 'rotate_proxy',
      delay: 3600000, // 1 hour
      message: 'IP rate limited - rotating proxy'
    },
    'ip_ban': {
      action: 'change_ip_subnet', 
      delay: 86400000, // 24 hours
      message: 'IP banned - need different subnet'
    },
    'captcha': {
      action: 'change_fingerprint',
      delay: 1800000, // 30 minutes
      message: 'Captcha detected - changing fingerprint'
    },
    'device_ban': {
      action: 'full_reset',
      delay: 432000000, // 5 days
      message: 'Device banned - full reset required'
    },
    'phone_required': {
      action: 'switch_method',
      delay: 0,
      message: 'Phone verification required - try email method'
    }
  };
    
    // Upaya gagal (termasuk sebelum form) pun dicatat — reputasi IP/domain tetap terbakar.
    // SELALU tulis result file dulu: guard/probe membaca ini, dan error dini
    // (proxy mati dsb.) tidak punya steps — tanpa result file, run jadi tak terlihat.
    try {
      fs.mkdirSync(path.join(__dirname, '..', 'sessions'), { recursive: true });
      fs.writeFileSync(path.join(__dirname, '..', 'sessions', 'last-create-tiktok.json'), JSON.stringify({
        platform: 'tiktok', status: result.status, username: result.username || (result.email || '').split('@')[0],
        email: result.email, password: result.password, fullName: result.fullName || null,
        emailDomain: (result.email || '').split('@')[1] || null,
        proxy: PROXY_ARG || null, birthIp: process.env.TT_BIRTH_IP || null,
        fingerprintJson: result.fingerprintJson || null,
        user_agent: result.userAgent || null,
        sessionFile: null, error: result.error || null, notes: result.notes || [],
        createdAt: new Date().toISOString(),
      }, null, 2));
    } catch (e2) { /* abaikan */ }
    if (result.email) try {
      const db = require('./db');
      void db.addSignupHistory({
        ip: process.env.TT_BIRTH_IP || null,
        platform: 'tiktok',
        username: (result.email || '').split('@')[0] || null,
        status: 'failed',
        proxy: PROXY_ARG || null,
        emailDomain: (result.email || '').split('@')[1] || null,
      });
    } catch (e3) { /* abaikan */ }
  } finally {
    console.log('\nRingkasan:', JSON.stringify(result.steps, null, 1));
    if (result.notes.length) console.log('Catatan:', JSON.stringify(result.notes, null, 1));
    if (KEEP_OPEN && browser) {
      console.log('\n*** BROWSER DIBIARKAN TERBUKA — Ctrl+C untuk tutup ***');
      process.on('SIGINT', async () => { await browser.close().catch(() => {}); process.exit(0); });
      await new Promise(() => {});
    }
    if (browser) await browser.close().catch(() => {});
  }
})();
