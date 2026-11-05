'use strict';

/**
 * Facebook Account Auto-Creator - Integrated with SMM Panel
 * 
 * Service untuk membuat akun Facebook otomatis menggunakan:
 * - Playwright browser automation
 * - Ammail Worker untuk temp email
 * - Anti-fingerprint techniques
 * - Proxy support
 */

const { chromium } = require('patchright'); // engine panel: patchright (drop-in playwright)
const https = require('https');
const http = require('http');
// Mail Worker (Cloudflare) — adaptor CJS di lib/mail-worker.
const { MailWorkerClient } = require('../lib/mail-worker');
const { extractOtp } = require('../lib/mail-worker/otp');
const { makeEmail } = require('./email-alias');
const { pickName } = require('./id-identity');
const crypto = require('./crypto');
const db = require('./db');
const notificationSystem = require('./notification-system');
const fs = require('fs');
const path = require('path');
const sessionsRoot = path.join(__dirname, '..', 'sessions');

class FacebookAccountCreator {
  constructor(options = {}) {
    this.options = {
      email: options.email || null,
      password: options.password || null,
      firstName: options.firstName || null,
      lastName: options.lastName || null,
      gender: options.gender || null,
      proxy: options.proxy || null,
      headless: options.headless !== undefined ? options.headless : true,
      ammailConfig: options.ammailConfig || this.getAmmailConfig(),
      captchaKey: options.captchaKey || process.env.CAPTCHA_API_KEY || null,
      saveToDatabase: options.saveToDatabase !== undefined ? options.saveToDatabase : true,
      // JALUR NOMOR HP (paritas IG --phone-signup): daftar FB lewat nomor telepon —
      // tanpa email/temp-mail. Nomor + kode SMS diisi operator di panel (kartu).
      phoneSignup: options.phoneSignup === true
    };

    this.browser = null;
    this.context = null;
    this.page = null;
    this.inboxAlias = null;
    
    this.result = {
      status: 'failed',
      email: null,
      password: null,
      phone: null,
      cookies: null,
      accountId: null,
      error: null,
      // Bukti teks FB dari halaman (snapFbEvidence) — untuk DB & file hasil.
      fbReason: null,
      fbChallenge: null,
      steps: []
    };
  }

  /**
   * Get Ammail configuration from environment
   */
  getAmmailConfig() {
    return {
      baseUrl: process.env.AMMAIL_BASE_URL || '',
      apiKey: process.env.AMMAIL_API_KEY || '',
      domain: process.env.AMMAIL_DOMAIN || '',
      timeout: parseInt(process.env.AMMAIL_TIMEOUT || '20000', 10)
    };
  }

  /**
   * Add step to result
   */
  addStep(step, success = true, message = '') {
    this.result.steps.push({
      step,
      success,
      message,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Create temp email inbox via Ammail API
   */
  async createTempEmail() {
    this.addStep('create_temp_email', false, 'Starting...');
    this.mailWorker = this.mailWorker || new MailWorkerClient();
    const config = this.options.ammailConfig;
    // JALUR NOMOR HP (--phone-signup): TANPA email/temp-mail/Gmail. Identitas nama
    // tetap dibuat (bank Indonesia) agar form daftar diisi nama manusia; nomor HP
    // TIDAK datang dari sini — operator mengetiknya di panel saat worker mencetak
    // [PHONE_REQUIRED] di tengah wizard (pola sama dgn IG). FB tidak menyediakan
    // tombol "ganti jalur" di form desktop: kalau form tidak punya kolom telepon,
    // fallback otomatis ke tab m.facebook.com/reg/ jalur ponsel.
    if (this.options.phoneSignup) {
      const idn = this.identity || pickName();
      this.identity = { firstName: idn.first, lastName: idn.last, gender: idn.gender };
      this.inboxAlias = null;
      this.addStep('identity', true, idn.gender);
      this.addStep('mode-hp', true, 'daftar via nomor HP — nomor diisi operator lewat panel (kartu No. HP)');
      console.log('[PHONE] mode nomor HP: nomor&SMS diisi operator di panel (kartu No. HP / kartu OTP).');
      return null;
    }
    // JALUR GMAIL STOK: options.gmailContext diset = pembaca OTP via tab
    // mail.google.com di context browser FB (profil Gmail stok sudah login).
    // Pelajaran akun keblok kemarin: domain temp-mail massal = sinyal; email
    // penerimaan Gmail asli lebih bersih. OTP tetap dibaca otomatis.
    if (this.options.gmailContext) {
      if (!this.options.email || !this.options.email.includes('@gmail')) {
        throw new Error('jalur gmail stok butuh options.email ber-domain gmail');
      }
      this.result.email = this.options.email;
      // Identitas nama juga dihasilkan di jalur Gmail (bank Indonesia) — pelajaran
      // run '#18': tanpa ini fillSignupForm jatuh ke fallback Inggris 'James Jones'.
      const idn = this.identity || pickName();
      this.identity = { firstName: idn.first, lastName: idn.last, gender: idn.gender };
      this.addStep('identity', true, idn.gender);
      this.inboxAlias = null; // AMMAIL tidak dipakai di jalur ini
      this.addStep('create_temp_email', true, `Gmail stok: ${this.options.email}`);
      return this.options.email;
    }
    if (this.options.email && this.options.email.includes('@')) {
      this.result.email = this.options.email;
      // Biar polling OTP tetap jalan saat email manual satu domain dengan Ammail
      const atIdx = this.options.email.lastIndexOf('@');
      const localPart = this.options.email.slice(0, atIdx);
      const emailDomain = this.options.email.slice(atIdx + 1).toLowerCase();
      if (emailDomain && config.domain && emailDomain === String(config.domain).toLowerCase()) {
        this.inboxAlias = localPart;
      }
      this.addStep('create_temp_email', true, `Using provided email: ${this.options.email}`);
      return this.options.email;
    }
    if (!config.baseUrl || !config.apiKey) {
      throw new Error('Ammail configuration missing (AMMAIL_BASE_URL, AMMAIL_API_KEY)');
    }

    // Gunakan alias email yang terlihat seperti username manusia, bukan timestamp.
    // Identitas dibuat SEKALI dan dipakai bersama: nama depan/belakang/gender form
    // = sumber alias email, jadi "Budi Pratama" mendapat budi.pratama1998@...
    const idn = pickName();
    const made = makeEmail({ first: idn.first, last: idn.last });
    this.identity = { firstName: idn.first, lastName: idn.last, gender: idn.gender };
    this.inboxAlias = made.alias;
    this.addStep('identity', true, idn.gender);

    // Via Mail Worker (Cloudflare tempmail-worker).
    if (!this.mailWorker.configured) throw new Error('Ammail configuration missing (AMMAIL_BASE_URL, AMMAIL_API_KEY)');
    const inbox = await this.mailWorker.createInbox(made.alias, config.domain);
    const inboxEmail = inbox.email || inbox.address || '';

    if (inboxEmail) {
      this.result.email = inboxEmail;
      this.addStep('create_temp_email', true, this.result.email);
      return this.result.email;
    }

    throw new Error('Failed to create temp email inbox');
  }

  /**
   * Make HTTP request (Promise wrapper)
   */
  makeHttpRequest(url, options) {
    return new Promise((resolve, reject) => {
      const urlObj = new URL(url);
      const protocol = urlObj.protocol === 'https:' ? https : http;
      
      const reqOptions = {
        hostname: urlObj.hostname,
        port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
        path: urlObj.pathname + urlObj.search,
        method: options.method || 'GET',
        headers: options.headers || {}
      };

      const req = protocol.request(reqOptions, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            resolve({ raw: data });
          }
        });
      });

      req.on('error', reject);
      if (options.body) req.write(options.body);
      req.end();
    });
  }

  /**
   * Launch browser SIGNUP dengan profil PERSISTEN per email akun + stealth penuh.
   * Temuan checkpoint: fingerprint signup dulu diacak tiap run lalu profil dibuang —
   * login berikutnya dari device/locale berbeda = sinyal pembajakan akun → checkpoint.
   * Solusi: fingerprint diacak SEKALI (locale+tz mengikuti geo IP proxy), disimpan
   * ke DB bersama akunnya, dan profil browser persisten di sessions/<alias-email>
   * yang nanti dipakai ulang oleh tombol "Aktivasi via login".
   */
  async launchBrowser() {
    this.addStep('launch_browser', false, 'Launching...');

    const stealth = require('./stealth');

    // 1) Geo IP proxy → timezone & locale konsisten dengan lokasi jaringan.
    const geo = await stealth.resolveProxyGeo(this.options.proxy);
    console.log(`🌍 Geo IP: ${geo.country || '?'} / ${geo.timezone} (${geo.city || '-'})`);

    // 2) Fingerprint diacak sekali (UA/viewport), locale+tz ikut geo — lalu permanen.
    //    SOLUSI JAYA: FB signup dibuka di emulasi HP Android (paritas IG Create).
    //    UA mobile menjawab sisi “device”, UI-nya jadi form mobile FB.
    const fp = stealth.pickFreshFingerprint(geo);
    this.fingerprint = fp;
    // Deteksi jalur mobile dari UA: kalau UA sudah Android Mobile, context browser
    // wajib mobile emulation juga — kalau tidak viewport/UA tidak match = sinyal bot.
    this.isMobileUA = /Android.*Mobile|iPhone|iPad/i.test(fp.userAgent || '');
    const chromeVer = (fp.userAgent.match(/Chrome\/(\d+)/) || [null, '?'])[1];
    console.log(`🧬 Fingerprint: Chrome ${chromeVer} | ${fp.viewport} | ${fp.timezoneId} | ${fp.locale} | ${this.isMobileUA ? 'mobile' : 'desktop'}`);

    // Paritas IG Create: ukur layar fisik dulu (WAJIB juga di mobile —
    // viewport 915 di monitor 1366x768 memotong jendela; persis kasus 12/10).
    try {
      const probe = await chromium.launch({ headless: false, args: ['--no-sandbox'] });
      const ppage = await (await probe.newContext({ viewport: null })).newPage();
      await ppage.goto('about:blank', { timeout: 15000 }).catch(() => {});
      const scr = await ppage.evaluate(() => ({ w: screen.availWidth || 1280, h: screen.availHeight || 720 }));
      await probe.close().catch(() => {});
      const [w, h] = fp.viewport.split('x').map(Number);
      if (this.isMobileUA) {
        // PARITAS IG CREATE (jalur yang sudah sempurna): clamp tinggi layar - 140
        // TANPA --window-size (jendela menyesuaikan isi, konten tak terpotong).
        // Fallback 1280x720 bila screen API aneh — jaga jangan pernah NaN.
        const scrW = Number(scr.w) || 1280, scrH = Number(scr.h) || 720;
        const vh = Math.max(560, Math.min(h, scrH - 140));
        const vw = Math.max(320, Math.min(w, 412, scrW));
        if (vw !== w || vh !== h) {
          console.log(`Viewport mobile ${w}x${h} > layar ${scr.w}x${scr.h} → clamp ${vw}x${vh}`);
          fp.viewport = `${vw}x${vh}`;
        }
      } else if (w > scr.w || h > scr.h) {
        const vw = Math.min(w, scr.w);
        const vh = Math.min(h, scr.h);
        console.log(`Viewport ${fp.viewport} > layar ${scr.w}x${scr.h} → clamp ${vw}x${vh}`);
        fp.viewport = `${vw}x${vh}`;
      }
    } catch (e) { console.log('Probe layar gagal — pakai viewport fingerprint:', e.message); }

    // 3) Profil persisten per email akun (dipakai ulang saat "Aktivasi via login").
    // Nama profil: email akun (email path) ATAU unik per attempt (jalur nomor HP —
    // email null saat profil dibuat, dan nomor baru diketik operator belakangan).
    // Tanpa ini semua run HP menumpuk di profil 'fbuser' yang sama: Chrome kunci
    // user-data-dir yang masih dipegai run KEEP-OPEN sebelumnya → sesi lama terbuka.
    const profileName = this.result.email
      ? String(this.result.email).split('@')[0].replace(/[^a-zA-Z0-9._-]/g, '_')
      : 'fb-hp-' + Date.now();
    const emailLocal = profileName;
    const profileDir = path.join(sessionsRoot, emailLocal);
    this.result.browser_profile_dir = profileDir;

    // 2b) Spoof canvas/audio/rects/hardware/WebGL — deterministik per akun.
    //     Seed diturunkan dari email (emailLocal) supaya sama persis di setiap
    //     sesi akun ini, tapi berbeda antar akun (paritas AdsPower). Pola yang
    //     sama dengan farm IG di browser.js → spoofConfigFor + spoofInitScript.
    //     Init script dipasang SETELAH launch (butuh context yang sudah ada).
    try {
      this.spoofConfig = require('./fingerprint-spoof').spoofConfigFor({
        id: 0,
        name: emailLocal,
        email: this.result.email,
        user_agent: fp.userAgent,
      });
      console.log(`🎭 Spoof: canvas 0x${this.spoofConfig.canvasSeed.toString(16)} | audio 0x${this.spoofConfig.audioSeed.toString(16)} | webgl ${this.spoofConfig.webgl.vendor}`);
    } catch (e) {
      console.log(`  [fb-creator] spoof cfg gagal: ${e.message}`);
    }

    const vp = fp.viewport.split('x').map(Number);
    // MOBILE CONTEXT — selaras UA: mobile Android → isMobile+hasTouch+DPR 2
    // (paritas IG Create / pola yang bikin form FB tampil mobile-nyata).
    const mobileCtxOpts = this.isMobileUA
      ? {
          isMobile: true,
          hasTouch: true,
          deviceScaleFactor: 2,
        }
      : {};
    this.context = await chromium.launchPersistentContext(profileDir, {
      headless: this.options.headless,
      viewport: { width: vp[0] || 1366, height: vp[1] || 768 },
      ...mobileCtxOpts,
      locale: fp.locale,
      timezoneId: fp.timezoneId,
      // UA diatur via CDP (attachPageHardening) — bukan di sini, agar override
      // protokol CDP yang menang. Tidak ada flag anti-automation: patchright melarang.
      args: [
        '--disable-dev-shm-usage',
        '--no-sandbox',
        '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
        '--disable-features=IsolateOrigins,site-per-process',
        '--disable-site-isolation-trials',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-infobars',
      ],
      proxy: this.options.proxy ? this.parseProxy(this.options.proxy) : undefined,
      ignoreHTTPSErrors: true,
    });

    // 2c) Pasang init script spoof ke context yang SUDAH jalan — addInitScript
    //     berlaku utk semua page berikutnya (termasuk this.page di bawah).
    if (this.spoofConfig) {
      try {
        await this.context.addInitScript(stealth.spoofInitScript(this.spoofConfig));
      } catch (e) {
        console.log(`  [fb-creator] pasang init script spoof gagal: ${e.message}`);
      }
    }

    // 4) Hardening CDP (UA asli + navigator.userAgentData + Accept-Language) untuk
    //    semua halaman. Versi Chrome di UA disamakan dgn Chromium asli (UA bohong =
    //    sinyal bot). Anti-detect lain (webdriver/runtime) ditangani patchright.
    //    Catatan: hanya objek Browser (bukan BrowserType) yang punya .version().
    try {
      const bObj = this.context.browser();
      if (bObj && typeof bObj.version === 'function') fp.userAgent = stealth.alignUaVersion(fp.userAgent, bObj.version());
    } catch (e) { /* pakai UA apa adanya */ }
    this.context.on('page', (page) => {
      stealth.attachPageHardening(this.context, page, fp).catch(() => {});
    });

    this.page = await this.context.newPage();
    this.addStep('launch_browser', true, `Persistent profile: ${emailLocal} | tz ${fp.timezoneId} | ${fp.locale}`);
    return true;
  }

  /**
   * Parse proxy string
   */
  parseProxy(proxyStr) {
    if (!proxyStr) return null;
    
    let raw = proxyStr.trim();
    // Buang http:// bila ikut ditempel (format user:pass tanpa @).
    // Format URL user:pass@host dibiarkan utuh.
    if (!raw.includes('@')) raw = raw.replace(/^\w+:\/\//, '');
    
    // URL format: http://user:pass@host:port
    const urlMatch = raw.match(/^(socks[45]?|https?|http):\/\/(?:([^:@]+):([^@]+)@)?([^:]+):(\d+)$/i);
    if (urlMatch) {
      const [, proto, user, password, host, port] = urlMatch;
      const proxy = { server: `${proto}://${host}:${port}` };
      if (user) {
        proxy.username = user;
        proxy.password = password;
      }
      return proxy;
    }
    
    // Plain: host:port:user:pass
    const parts = raw.split(':');
    if (parts.length === 4 && /^\d+$/.test(parts[1])) {
      const [host, port, user, password] = parts;
      return {
        server: `http://${host}:${port}`,
        username: user,
        password: password
      };
    }
    
    // Plain: host:port
    if (parts.length === 2 && /^\d+$/.test(parts[1])) {
      return { server: `http://${parts[0]}:${parts[1]}` };
    }
    
    return null;
  }

  /**
   * Tutup cookie/consent banner (wajib di locale UE — menutupi seluruh halaman).
   * Prioritas tombol tolak: lebih sedikit cookie = jejak lebih kecil.
   */
  async dismissCookieBanner() {
    const names = [/tolak semua/i, /reject all/i, /decline all/i, /decline optional/i, /decline/i, /only necessary/i, /hanya yang diperlukan/i];
    for (const name of names) {
      try {
        const b = this.page.getByRole('button', { name }).first();
        if ((await b.count()) > 0 && (await b.isVisible().catch(() => false))) {
          await b.click({ timeout: 3000 });
          console.log('Cookie banner ditutup:', name);
          await this.sleep(this.randomInt(1000, 1800));
          return true;
        }
      } catch (e) { /* coba label berikutnya */ }
    }
    console.log('Cookie banner tidak ditemukan (mungkin tidak ada).');
    return false;
  }

  /**
   * Navigate to Facebook signup page
   */
  async navigateToSignup() {
    this.addStep('navigate_signup', false, 'Loading...');

    // Jalur mobile (UA Android): homepage www = versi desktop, selalu jadi
    // asal klik gagal lalu fallback — buang 5 time-out sekaligus render campur.
    // Langsung ke reg mobile (form satu halaman/ wizard berasal dari sini).
    if (this.isMobileUA) {
      try {
        await this.page.goto('https://m.facebook.com/reg/?entry_point=login', {
          waitUntil: 'domcontentloaded', timeout: 30000,
        });
        await this.sleep(this.randomInt(2000, 4000));
        this.addStep('navigate_signup', true, 'reg mobile langsung (m.facebook.com/reg)');
        await this.dismissCookieBanner();
        return;
      } catch (e) {
        console.log('reg mobile gagal — lanjut jalur homepage: ' + e.message);
      }
    }
    try {
      // Buka homepage dulu seperti user biasa
      await this.page.goto('https://www.facebook.com/', {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });

      await this.sleep(this.randomInt(2000, 4000));
      
      // Check if we're on facebook
      const currentUrl = this.page.url();
      if (!currentUrl.includes('facebook.com')) {
        throw new Error('Navigation failed: not on Facebook');
      }
      
      this.addStep('navigate_signup', true, 'Facebook page loaded');
      // Banner consent UE harus ditutup SEBELUM apa pun — menutupi tombol & form.
      await this.dismissCookieBanner();
    } catch (error) {
      this.addStep('navigate_signup', false, error.message);
      throw error;
    }
  }

  /**
   * JALUR NOMOR HP — pastikan form yang terbuka punya kolom telepon.
   * Desktop FB: tab "Telepon" kadang sudah aktif bila datang via m.facebook link;
   * bila tab tettel ada → klik; bila form hanya email → fallback m.facebook.com/reg.
   * Dipanggil SEBELUM allInputs dihitung, jadi index-0/1/2 tidak salah sasaran.
   */
  async ensurePhoneForm() {
    const bodyText = await this.page.evaluate(() => (document.body ? document.body.innerText : '')).catch(() => '');
    // sudah di mode telepon (label kolom nomor terlihat)?
    const phoneVisible = /nomor ponsel|mobile number|phone number|telepon/i.test(bodyText || '');
    if (phoneVisible) {
      this.addStep('nav-phone', true, 'kolom telepon terlihat di form');
      return true;
    }
    // Tab "Telepon" di desktop reg — klik bila ada.
    const tabs = [
      'div[role="tab"]:has-text("Telepon")',
      'div[role="tab"]:has-text("Phone")',
      '[role="button"]:has-text("Telepon")',
      '[role="button"]:has-text("Phone")',
      'a:has-text("Telepon")',
    ];
    for (const sel of tabs) {
      try {
        const el = this.page.locator(sel).first();
        if ((await el.count()) > 0 && (await el.isVisible().catch(() => false))) {
          await el.click({ timeout: 5000 });
          await this.sleep(this.randomInt(1500, 2500));
          const t2 = await this.page.evaluate(() => (document.body ? document.body.innerText : '')).catch(() => '');
          if (/nomor ponsel|mobile number|phone number|telepon/i.test(t2 || '')) {
            this.addStep('nav-phone', true, `tab diklik: ${sel}`);
            return true;
          }
        }
      } catch (e) { /* coba selector berikutnya */ }
    }
    // Fallback: halaman mobile reg — varian ini selalu punya kolom nomor/telepon.
    console.log('[PHONE] form desktop tanpa kolom telepon — fallback m.facebook.com/reg/?sid=');
    this.addStep('mode-hp', false, 'form desktop tanpa kolom telepon — fallback m.facebook.com/reg/?sid=');
    await this.page.goto('https://m.facebook.com/reg/?sid=__phone_mode__', {
      waitUntil: 'domcontentloaded', timeout: 30000,
    }).catch(() => {});
    await this.sleep(this.randomInt(2000, 3500));
    const t3 = await this.page.evaluate(() => (document.body ? document.body.innerText : '')).catch(() => '');
    if (/nomor ponsel|mobile number|phone number|telepon/i.test(t3 || '')) {
      this.addStep('nav-phone', true, 'fallback m.facebook punya kolom telepon');
      return true;
    }
    // m.facebook juga tanpa kolom telepon (jarang — kadang varian daerah):
    this.result.error = 'form_phone_not_supported'; // diturunkan ke askOperatorPhone → run gagal jelas.
    this.addStep('nav-phone', false, 'tidak ada jalur telepon di form ini (desktop & m.facebook)');
    throw new Error('form_phone_not_supported: form daftar tidak punya kolom nomor HP');
  }

  /**
   * JALUR NOMOR HP — verifikasi via SMS setelah submit form.
   * FB tampil layar masukkan kode (SMS ke nomor operator). Nomor operator datang
   * dari kartu panel [PHONE_REQUIRED]; kode SMS dari kartu OTP [OTP_REQUIRED].
   */
  async runPhoneVerification() {
    // 1. Layar nomor HP: bila kolom telepon belum terisi (form daftar minta nomor
    // SETELAH submit/layar terpisah), minta nomor dari operator.
    const bodyText = await this.page.evaluate(() => (document.body ? document.body.innerText : '')).catch(() => '');
    const needPhone = /nomor ponsel|mobile number|phone number|enter your phone|masukkan nomor/i.test(bodyText || '');
    if (needPhone) {
      this.addStep('wait_phone', false, 'Menunggu operator memasukkan nomor HP di panel (kartu No. HP)...');
      const phone = await this.askOperatorPhone();
      if (!phone) {
        this.result.error = this.result.error || 'phone_not_received';
        throw new Error('fb_phone_not_received: operator tidak mengisi nomor HP dalam 8 menit');
      }
      this.result.phone = phone;
      this.addStep('wait_phone', true, `Nomor dari operator: ${phone.slice(0, 5)}***`);
      // isi ke kolom nomor (visible + semua frame fallback)
      const findPhone = async () => {
        for (const frame of this.page.frames()) {
          try {
            for (const sel of ['input[type="tel"]', 'input[name="phone"]', 'input[aria-label*="nomor" i]', 'input[aria-label*="phone" i]', 'input[type="text"]']) {
              const loc = frame.locator(sel).first();
              if ((await loc.count()) && (await loc.isVisible().catch(() => false))) return { frame, loc };
            }
          } catch (e) { /* frame lepas */ }
        }
        return null;
      };
      const target = await findPhone();
      if (target) {
        await target.loc.click().catch(() => {});
        if (target.loc.pressSequentially) await target.loc.pressSequentially(phone, { delay: 90 });
        else await target.loc.type(phone, { delay: 90 });
        await this.sleep(this.randomInt(600, 1200));
        const btn = target.frame.getByRole('button', { name: /continue|lanjut|submit|next|berikutnya/i }).first();
        if (await btn.count()) await btn.click().catch(() => {});
        else await target.loc.press('Enter').catch(() => {});
        await this.sleep(5000);
        this.addStep('submit_phone', true, 'Nomor terkirim ke FB');
      } else {
        this.addStep('submit_phone', false, 'kolom nomor HP tidak ketemu setelah operator isi');
        throw new Error('phone_input_not_found');
      }
    }
    // 2. Layar kode SMS — pola sama dgn submitVerificationCode (semua frame).
    this.addStep('wait_sms_code', false, 'Menunggu operator mengisi kode SMS di panel (kartu OTP)...');
    const smsCode = await this.askOperatorOtp();
    if (!smsCode) {
      this.result.error = this.result.error || 'otp_operator_timeout';
      throw new Error('fb_sms_code_not_received: operator tidak mengisi kode SMS dalam 8 menit');
    }
    const okSms = await this.submitVerificationCode(smsCode);
    this.codeSubmitted = okSms;
    if (!okSms) {
      this.result.error = this.result.error || 'confirmation_code_submit_failed';
      throw new Error('fb_sms_code_submit_failed: kode SMS ditolak / form tidak ketemu (5 menit)');
    }
    this.addStep('sms_verified', true, 'Kode SMS diteruskan ke FB');
  }

  /**
   * Fill signup form - Facebook homepage style
   */
  async fillSignupForm() {
    this.addStep('fill_form', false, 'Filling...');

    // Generate user data — pakai identitas yang sama dengan email bila ada,
    // fallback ke generator lama hanya untuk opsi manual.
    const gender = this.options.gender || (this.identity && this.identity.gender) || (Math.random() > 0.5 ? 'male' : 'female');
    const fallbackName = this.generateName(gender);
    const firstName = this.options.firstName || (this.identity && this.identity.firstName) || fallbackName.firstName;
    const lastName = this.options.lastName || (this.identity && this.identity.lastName) || fallbackName.lastName;
    this.result.fullName = `${firstName} ${lastName}`;
    // Jalur nomor HP: nomor belum ada saat baris ini tercetak (operator isi kemudian).
    console.log(`📝 Nama: ${firstName} ${lastName} | ${this.options.phoneSignup ? 'No. HP: (diisi operator di panel)' : 'Email: ' + this.result.email}`);
    const birthdate = this.generateBirthdate(18, 45);
    const password = this.options.password || this.generatePassword();

    this.result.password = password;

    // Klik "Create new account" button di homepage.
    // MOBILE (paritas IG Create): di m.facebook/UA Android tombol daftar punya
    // label berbeda ("Create new account" ada, "Sign up" juga umum di m.facebook),
    // jadi daftar selector diperluas dan fallback navigasi langsung reg-mobile.
    this.addStep('click_create_account', false, 'Clicking...');
    console.log('🔍 Looking for "Create new account" button...');
    
    const createAccountSelectors = this.isMobileUA
      ? [
          'a:has-text("Create new account")',
          'a:has-text("Create New Account")',
          '[role="button"]:has-text("Create new account")',
          'a:has-text("Sign up")',
          '[role="button"]:has-text("Sign up")',
          'a[href*="/reg/"]',
          'a[href*="signup"]',
        ]
      : [
          'a:has-text("Create new account")',
          'a:has-text("Create New Account")',
          'a[aria-label="Create new account"]',
          'a[href*="/reg/"]'
        ];

    let clicked = false;
    for (const selector of createAccountSelectors) {
      try {
        console.log(`  Trying selector: ${selector}`);
        await this.page.click(selector, { timeout: 5000 });
        clicked = true;
        console.log(`✅ Clicked: ${selector}`);
        this.addStep('click_create_account', true, `Clicked: ${selector}`);
        break;
      } catch (e) {
        console.log(`  ❌ Failed: ${e.message}`);
        continue;
      }
    }

    if (!clicked) {
      // Locale UE (mis. en-GB) menampilkan cookie-banner yang MENUTUPI tombol
      // ("subtree intercepts pointer events"). Tutup banner lalu coba lagi.
      console.log('Klik gagal — mencoba menutup cookie-banner lalu klik ulang...');
      await this.dismissCookieBanner();
      for (const selector of createAccountSelectors) {
        try {
          await this.page.click(selector, { timeout: 5000 });
          clicked = true;
          console.log(`✅ Clicked setelah banner ditutup: ${selector}`);
          this.addStep('click_create_account', true, `Clicked after banner: ${selector}`);
          break;
        } catch (e) { continue; }
      }
    }

    if (!clicked) {
      // Fallback terakhir: halaman registrasi langsung (tanpa klik apa pun).
      // MOBILE: khusus UA mobile — pakai m.facebook.com (form mobile asli),
      // desktop tetap facebook.com/reg.
      console.log('Fallback: navigasi langsung ke /reg/' + (this.isMobileUA ? ' (m.facebook)' : ''));
      const regUrl = this.isMobileUA
        ? 'https://m.facebook.com/reg/?entry_point=login'
        : 'https://www.facebook.com/reg/?entry_point=login';
      await this.page.goto(regUrl, {
        waitUntil: 'domcontentloaded', timeout: 30000,
      }).catch(() => {});
      await this.sleep(this.randomInt(1500, 2500));
    }

    // Tunggu sebentar untuk animasi
    console.log('⏳ Waiting for signup form to appear...');
    await this.sleep(2000);
    
    this.addStep('wait_signup_form', false, 'Waiting for form...');

    // Pelajaran run 2026-10-19 (ketiga): klik daftar di homepage bisa mendarat
    // di landing Meta (m.facebook.com/ig/login_via — tombol [Mulai]), BUKAN
    // form klasik. Cek ulang bila tertangkap: alih ke jalur wizard, jangan
    // tunggu form klasik yang tidak akan muncul.
    if (await this.isMetaLanding()) {
      // Dump 2026-10-19: varian SATU HALAMAN bermuatan heading Meta yang sama
      // tapi tombolnya [Kirim], bukan wizard bertahap — isi form tunggal di sini.
      if (await this.isSinglePageRegForm()) {
        this.addStep('wait_signup_form', true, 'landing Meta + form satu halaman — isi form tunggal');
        await this.fillSinglePageReg();
        return false;
      }
      this.addStep('wait_signup_form', true, 'klik daftar mendarat di landing Meta — alih jalur wizard');
      await this.runMetaWizard(firstName, lastName, birthdate, gender);
      return true; // true = sudah lewat wizard, submitForm tidak perlu
    }
    return false;
    // JALUR NOMOR HP: deteksi bentuk form. FB desktop (facebook.com/reg) kadang
    // menyembunyikan kolom telepon sampai tab dipilih; kadang juga hanya menawarkan
    // email (varian daerah). Bila kolom telepon tidak ada seluruhnya, pindah ke
    // m.facebook.com/reg/?sid=… (varian mobile selalu punya Telepon or Email).
    // MOBILE (UA Android): input bisa type tel/email, bukan hanya text —
    // selector diperluas supaya wait tak timeout di form mobile.
    const waitingInputSel = this.isMobileUA
      ? 'input[type="text"], input[type="tel"], input[type="email"]'
      : 'input[type="text"]';
    try {
      await this.page.waitForSelector(waitingInputSel, { timeout: 15000, state: 'visible' });
      if (this.options.phoneSignup) {
        await this.ensurePhoneForm();
      }
    } catch (e) {
      console.error('❌ Timeout waiting for signup form');
      throw new Error(`Signup form did not appear: ${e.message}`);
    }

    const currentURL2 = this.page.url();
    console.log(`✅ Form loaded. Current URL: ${currentURL2}`);
    this.addStep('wait_signup_form', true, `/reg/: ${currentURL2.includes('/reg/') ? 'ya' : 'tidak'}`);

    // JALUR NOMOR HP: nomor harus ADA SEBELUM form diisi — kartu No. HP muncul
    // di panel saat baris ini tercetak. Bila layar berikutnya ternyata masih
    // minta nomor lagi, runPhoneVerification mengulang marker [PHONE_REQUIRED].
    if (this.options.phoneSignup && !this.result.phone) {
      const phoneFromPanel = await this.askOperatorPhone();
      if (!phoneFromPanel) throw new Error('phone_not_received: operator tidak mengisi nomor HP dalam 8 menit');
      this.result.phone = phoneFromPanel;
      console.log('📝 Nomor HP (dari panel):', phoneFromPanel.slice(0, 5) + '***');
    }

    // Tunggu input fields stabil
    console.log('⏳ Waiting for form to stabilize...');
    await this.sleep(1500);

    // Ambil semua input fields yang visible.
    // MOBILE (UA Android): form m.facebook memakai input tel/email/number untuk
    // kolom nomor — harus diikutkan, bukan hanya type=text.
    const inputQuerySel = this.isMobileUA
      ? 'input[type="text"], input[type="tel"], input[type="email"]'
      : 'input[type="text"]';
    const allInputs = await this.page.$$(inputQuerySel + ':visible');
    const passwordInput = await this.page.$('input[type="password"]:visible');
    
    this.addStep('detect_inputs', true, `Found ${allInputs.length} visible inputs (mobile: ${this.isMobileUA ? 'ya' : 'tidak'})`);

    if (allInputs.length < 3) {
      throw new Error(`Expected at least 3 input fields, found ${allInputs.length}`);
    }

    // Facebook signup form biasanya: [firstname, lastname, email, (confirm email)]
    // JALUR NOMOR HP: form jalur ponsel biasanya [nama depan, nama belakang, telepon, (ulangi telepon)]
    // — tab Telepon m.facebook menaruh kolom nomor di indeks 2 (pengganti email).
    // Nilai teks yang diketik tergantung jalur: email vs nomor.
    const fillValue = this.options.phoneSignup ? this.result.phone : this.result.email;
    try {
      // Input 0: First name
      await allInputs[0].click();
      await this.sleep(this.randomInt(100, 300));
      await allInputs[0].type(firstName, { delay: this.randomInt(50, 150) });
      await this.sleep(this.randomInt(500, 1000));

      // Input 1: Last name  
      await allInputs[1].click();
      await this.sleep(this.randomInt(100, 300));
      await allInputs[1].type(lastName, { delay: this.randomInt(50, 150) });
      await this.sleep(this.randomInt(500, 1000));

      // Input 2: Email ATAU nomor HP (tergantung jalur terpilih)
      await allInputs[2].click();
      await this.sleep(this.randomInt(100, 300));
      await allInputs[2].type(fillValue, { delay: this.randomInt(50, 150) });
      await this.sleep(this.randomInt(500, 1000));

      // Jika ada input 3, kemungkinan confirm email / ulangi nomor
      if (allInputs.length >= 4) {
        await allInputs[3].click();
        await this.sleep(this.randomInt(100, 300));
        await allInputs[3].type(fillValue, { delay: this.randomInt(50, 150) });
        await this.sleep(this.randomInt(500, 1000));
      }

      // Password
      if (passwordInput) {
        await passwordInput.click();
        await this.sleep(this.randomInt(100, 300));
        await passwordInput.type(password, { delay: this.randomInt(50, 150) });
        await this.sleep(this.randomInt(500, 1000));
      }

    } catch (error) {
      throw new Error(`Failed to fill inputs: ${error.message}`);
    }

    // Scroll ke bawah untuk memastikan birthday dan gender terlihat
    await this.page.evaluate(() => window.scrollBy(0, 300));
    await this.sleep(this.randomInt(1000, 2000));

    // Birthday - fill dengan input date atau select
    try {
      await this.fillBirthday(birthdate);
      await this.sleep(this.randomInt(500, 1000));
    } catch (error) {
      // Birthday gagal, tapi tidak fatal - continue
      console.log(`Birthday fill skipped: ${error.message}`);
    }

    // Gender
    try {
      await this.selectGender(gender);
      await this.sleep(this.randomInt(1000, 2000));
    } catch (error) {
      // Gender gagal, tapi tidak fatal - continue
      console.log(`Gender select skipped: ${error.message}`);
    }

    this.addStep('fill_form', true, `Filled: ${firstName} ${lastName}`);
  }

  // Varian registrasi SATU HALAMAN (dump wizard-dump-2026-10-19T09-26-14):
  // heading "Mulai di Facebook dengan Akun Meta" + form penuh di layar yang
  // sama — pembeda dari wizard bertahap: ada native <select> (Hari/Bulan/Tahun)
  // atau kata sandi visible, dan tidak ada tombol [Berikutnya].
  async isSinglePageRegForm() {
    try {
      const url = this.page.url();
      if (!/login_via|\/ig\/|\/reg\//.test(url)) return false;
      return await this.page.evaluate(() => {
        const vis = (el) => el.offsetWidth > 0 && el.offsetHeight > 0;
        const selects = [...document.querySelectorAll('select')].filter(vis);
        const pw = [...document.querySelectorAll('input[type="password"]')].filter(vis);
        const hasBerikutnya = [...document.querySelectorAll('button, [role="button"]')]
          .some((el) => vis(el) && /berikutnya|\bnext\b/i.test(el.textContent || ''));
        return selects.length >= 2 || (pw.length > 0 && !hasBerikutnya);
      });
    } catch (e) { return false; }
  }

  /**
   * Isi varian form satu halaman: 2 kolom nama + kontak + dropdown DOB
   * (Hari/Bulan/Tahun, native select) + dropdown gender + kata sandi.
   * Tombol [Kirim] diklik oleh submitForm() — return false*, jalur klasik.
   */
  async fillSinglePageReg() {
    const gender = this.options.gender || (this.identity && this.identity.gender) || (Math.random() > 0.5 ? 'male' : 'female');
    const fallbackName = this.generateName(gender);
    const firstName = this.options.firstName || (this.identity && this.identity.firstName) || fallbackName.firstName;
    const lastName = this.options.lastName || (this.identity && this.identity.lastName) || fallbackName.lastName;
    this.result.fullName = `${firstName} ${lastName}`;
    const password = this.options.password || this.generatePassword();
    this.result.password = password;
    const birthdate = this.generateBirthdate(18, 45);
    this.addStep('single_page_reg', false, 'Mengisi form satu halaman…');
    // Banner consent UE menutupi kolom pertama (pelajaran run 2026-10-19:
    // elementHandle.click "subtree intercepts pointer events" 30×retry).
    await this.dismissCookieBanner();
    await this.sleep(this.randomInt(500, 1000));

    const tangani = async (el, val) => {
      await el.click();
      await this.sleep(this.randomInt(100, 300));
      await el.type(val, { delay: this.randomInt(50, 130) });
      await this.sleep(this.randomInt(400, 900));
    };
    // Klik tahan overlay: bila click Playwright time-out ("subtree intercepts
    // pointer events" — overlay FB menutupi kolom), isi via DOM langsung.
    const tanganiTahanOverlay = async (el, val) => {
      try {
        await tangani(el, val);
      } catch (e) {
        this.addStep('single_page_reg', false, `klik biasa gagal (${String(e.message || e).split('\n')[0].slice(0, 90)}) — isi via DOM langsung`);
        await el.fill(val).catch(async () => {
          await el.evaluate((node, v) => {
            node.focus();
            node.value = v;
            node.dispatchEvent(new Event('input', { bubbles: true }));
            node.dispatchEvent(new Event('change', { bubbles: true }));
          }, val);
        });
        await this.sleep(this.randomInt(400, 900));
      }
    };

    // Nama (kolom teks 0–1) + kontak (kolom teks 2: "Nomor ponsel atau email").
    const nameInputs = await this.page.$$('input[type="text"]:visible');
    if (nameInputs.length < 3) throw new Error(`single_page_reg: kolom nama/kontak kurang (ketemu ${nameInputs.length})`);
    await tanganiTahanOverlay(nameInputs[0], firstName);
    await tanganiTahanOverlay(nameInputs[1], lastName);
    let kontak;
    if (this.options.phoneSignup) {
      if (!this.result.phone) {
        const p = await this.askOperatorPhone();
        if (!p) throw new Error('phone_not_received');
        this.result.phone = p;
      }
      kontak = this.result.phone;
    } else {
      kontak = this.result.email;
    }
    await tanganiTahanOverlay(nameInputs[2], kontak);

    // DOB: path 1 native <select>; path 2 (varian nyata run 2026-10-19, dump
    // wizard-dump-09-26: TANPA native select) dropdown div[role="combobox"]
    // Hari/Bulan/Tahun — helper fillBirthday sudah menangani persis ini.
    const selInfo = await this.page.$$eval('select:visible', els =>
      els.map((el, i) => ({ i, first: (el.options[0] && el.options[0].textContent.trim()) || '' }))).catch(() => []);
    const dSel = selInfo.find((x) => /hari|^day/i.test(x.first));
    const mSel = selInfo.find((x) => /bulan|month/i.test(x.first));
    const ySel = selInfo.find((x) => /tahun|year/i.test(x.first));
    if (dSel && mSel && ySel) {
      const selHandles = await this.page.$$('select:visible');
      const pick = async (handle, cands, tag) => {
        for (const c of cands) {
          try { await handle.selectOption(String(c)); return; } catch (e) { continue; }
        }
        throw new Error(`single_page_reg: opsi ${tag} tidak ketemu`);
      };
      await pick(selHandles[dSel.i], [birthdate.day, `0${birthdate.day}`], 'hari');
      const monthNamesId = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
      const monthNamesEn = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
      const mIdx = parseInt(birthdate.month) - 1;
      await pick(selHandles[mSel.i], [birthdate.month, monthNamesId[mIdx], monthNamesEn[mIdx]], 'bulan');
      await pick(selHandles[ySel.i], [birthdate.year], 'tahun');
    } else {
      await this.fillBirthday(birthdate); // combobox Hari/Bulan/Tahun (EN/ID)
      await this.sleep(this.randomInt(500, 1000));
    }

    // Gender: path 1 native select berlabel gender; path 2 combobox
    // "Pilih jenis kelamin Anda" via selectGender (sudah ada, EN/ID).
    let genderFilled = false;
    const genderCands = gender === 'male' ? ['Laki-laki', 'Male']
      : gender === 'female' ? ['Perempuan', 'Female'] : ['Lainnya', 'Custom'];
    try {
      const genderInfo = await this.page.$$eval('select:visible', els =>
        els.map((el, i) => ({ i, opts: [...el.options].map((o) => o.textContent.trim()) })));
      if (genderInfo.some((g) => g.opts.some((o) => genderCands.some((c) => o.includes(c))))) {
        const selHandles = await this.page.$$('select:visible');
        const pick = async (handle, cands, tag) => {
          for (const c of cands) {
            try { await handle.selectOption(String(c)); return; } catch (e) { continue; }
          }
          throw new Error(`single_page_reg: opsi ${tag} tidak ketemu`);
        };
        const gSel = genderInfo.find((g) => g.opts.some((o) => genderCands.some((c) => o.includes(c))));
        await pick(selHandles[gSel.i], genderCands, 'gender');
        genderFilled = true;
      }
    } catch (e) { /* atau combobox */ }
    if (!genderFilled) await this.selectGender(gender);

    // Kata sandi
    const pw = await this.page.$('input[type="password"]:visible');
    if (pw) await tangani(pw, password);

    this.addStep('single_page_reg', true, `Terisi: ${firstName} ${lastName}, DOB ${birthdate.year}-${birthdate.month}-${birthdate.day}`);
  }

  /**
   * Fill field dengan multiple selector fallback
   */
  async fillField(selectors, value) {
    for (const selector of selectors) {
      try {
        const element = await this.page.$(selector);
        if (element) {
          await this.typeHuman(selector, value);
          return true;
        }
      } catch (e) {
        continue;
      }
    }
    throw new Error(`Cannot find field for value: ${value.substring(0, 10)}...`);
  }

  // Klik combobox tahan overlay: klik Playwright tertangkap <div class="x…">
  // menutupi ("subtree intercepts pointer events" — run #3 tahun combobox).
  // Fallback: dispatch pointer+mouse+click via DOM langsung pada elemen.
  async klikCombobox(el) {
    try {
      await el.click({ timeout: 5000 });
      return;
    } catch (e) {
      await el.evaluate((node) => {
        ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach((t) =>
          node.dispatchEvent(new MouseEvent(t, { bubbles: t === 'click', cancelable: true, view: window })));
      });
    }
    await this.sleep(this.randomInt(400, 800));
  }

  // Pilih opsi combobox tahan overlay: klik Playwright pada div[role=option]
  // ikut tertangkap overlay (run #4 tahun 1992). Fallback: dispatch event pada
  // elemen opsi yang teksnya cocok, via DOM langsung.
  async pilihOpsiTeks(teks, exact) {
    try {
      await this.page.click(`div[role="option"]:has-text("${teks}")`, { timeout: 4000 });
      return true;
    } catch (e) { /* jatuh ke dispatch */ }
    // evaluate Playwright hanya 1 argumen — bungkus dalam objek (bug run #5).
    return await this.page.evaluate(({ t, exact }) => {
      const norm = (s) => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
      const vis = (el) => el.offsetWidth > 0 && el.offsetHeight > 0;
      const cands = [...document.querySelectorAll('div[role="option"]')]
        .filter((el) => vis(el) && (exact ? norm(el.textContent) === norm(t) : norm(el.textContent).includes(norm(t))));
      const el = cands[cands.length - 1];
      if (!el) return false;
      ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach((ty) =>
        el.dispatchEvent(new MouseEvent(ty, { bubbles: ty === 'click', cancelable: true, view: window })));
      return true;
    }, { t: teks, exact });
  }

  /**
   * Fill birthday menggunakan combobox dengan role="combobox"
   */
  async fillBirthday(birthdate) {
    this.addStep('fill_birthday', false, 'Filling birthday...');
    
    try {
      // Facebook modern UI menggunakan div[role="combobox"] untuk date picker
      // Struktur: Month combobox, Day combobox, Year combobox
      
      // Tunggu combobox muncul
      await this.page.waitForSelector('div[role="combobox"]', { timeout: 5000, state: 'visible' });
      await this.sleep(this.randomInt(500, 1000));
      
      const comboboxes = await this.page.$$('div[role="combobox"]');
      console.log(`Found ${comboboxes.length} combobox elements`);
      
      if (comboboxes.length < 3) {
        throw new Error(`Expected at least 3 comboboxes, found ${comboboxes.length}`);
      }
      
      // Identifikasi combobox berdasarkan aria-label atau text
      const comboboxInfo = await this.page.$$eval('div[role="combobox"]', els => 
        els.map((el, idx) => ({
          index: idx,
          ariaLabel: el.getAttribute('aria-label'),
          text: el.textContent.trim(),
          id: el.id
        }))
      );
      
      console.log('Combobox info:', JSON.stringify(comboboxInfo, null, 2));
      
      let monthIdx = -1, dayIdx = -1, yearIdx = -1;
      
      // Identifikasi berdasarkan aria-label atau text content (EN + ID: Bulan/Hari/Tahun)
      for (let i = 0; i < comboboxInfo.length; i++) {
        const info = comboboxInfo[i];
        const label = (info.ariaLabel || '').toLowerCase();
        const text = (info.text || '').toLowerCase();
        
        if (/month|bulan/.test(label + ' ' + text)) monthIdx = i;
        else if (/\bday\b|\bhari\b/.test(label + ' ' + text)) dayIdx = i;
        else if (/year|tahun/.test(label + ' ' + text)) yearIdx = i;
      }
      
      this.addStep('identify_comboboxes', true, `Month:${monthIdx}, Day:${dayIdx}, Year:${yearIdx}`);
      
      if (monthIdx === -1 || dayIdx === -1 || yearIdx === -1) {
        throw new Error('Could not identify all birthday comboboxes');
      }
      
      // Month mapping — EN + ID (locale id-ID: Januari..Desember)
      const monthNamesEn = ['January', 'February', 'March', 'April', 'May', 'June', 
                         'July', 'August', 'September', 'October', 'November', 'December'];
      const monthNamesId = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 
                         'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
      const mIdx = parseInt(birthdate.month) - 1;
      
      // Fill Month — coba opsi EN lalu ID sesuai locale halaman
      console.log(`Clicking month combobox (index ${monthIdx})...`);
      await this.klikCombobox(comboboxes[monthIdx]);
      await this.sleep(this.randomInt(500, 800));
      
      let monthName = '';
      for (const cand of [monthNamesEn[mIdx], monthNamesId[mIdx]]) {
        if (await this.pilihOpsiTeks(cand, false)) { monthName = cand; break; }
      }
      if (!monthName) throw new Error('opsi bulan (EN/ID) tidak ketemu');
      console.log(`Selecting month option: ${monthName}...`);
      await this.sleep(this.randomInt(300, 500));
      
      // Fill Day
      console.log(`Clicking day combobox (index ${dayIdx})...`);
      await this.klikCombobox(comboboxes[dayIdx]);
      await this.sleep(this.randomInt(500, 800));
      
      console.log(`Selecting day option: ${birthdate.day}...`);
      if (!(await this.pilihOpsiTeks(String(birthdate.day), true))) throw new Error('opsi hari tidak ketemu');
      await this.sleep(this.randomInt(300, 500));
      
      // Fill Year
      console.log(`Clicking year combobox (index ${yearIdx})...`);
      await this.klikCombobox(comboboxes[yearIdx]);
      await this.sleep(this.randomInt(500, 800));
      
      console.log(`Selecting year option: ${birthdate.year}...`);
      if (!(await this.pilihOpsiTeks(String(birthdate.year), true))) throw new Error('opsi tahun tidak ketemu');
      await this.sleep(this.randomInt(300, 500));
      
      this.addStep('fill_birthday', true, `Birthday: ${monthName} ${birthdate.day}, ${birthdate.year}`);
      
    } catch (error) {
      console.log('Birthday fill error:', error.message);
      this.addStep('fill_birthday', false, error.message);
      throw new Error(`Cannot fill birthday: ${error.message}`);
    }
  }

  /**
   * Select gender menggunakan combobox dengan role="combobox"
   */
  async selectGender(gender) {
    this.addStep('fill_gender', false, 'Selecting gender...');      // Opsi gender per locale: EN (Male/Female/Custom) atau ID (Laki-laki/Perempuan/Kustom)
      const genderCandidates = gender === 'male' ? ['Male', 'Laki-laki']
        : gender === 'female' ? ['Female', 'Perempuan'] : ['Custom', 'Kustom'];
    
    try {
      // Facebook modern UI: Gender adalah combobox dengan text "Select your gender"
      await this.page.waitForSelector('div[role="combobox"]', { timeout: 5000, state: 'visible' });
      await this.sleep(this.randomInt(500, 1000));
      
      const comboboxes = await this.page.$$('div[role="combobox"]');
      console.log(`Found ${comboboxes.length} combobox elements for gender`);
      
      // Cari combobox dengan text "Select your gender" atau aria-label gender
      const comboboxInfo = await this.page.$$eval('div[role="combobox"]', els => 
        els.map((el, idx) => ({
          index: idx,
          text: el.textContent.trim().toLowerCase(),
          ariaLabel: (el.getAttribute('aria-label') || '').toLowerCase()
        }))
      );
      
      console.log('Gender combobox search:', JSON.stringify(comboboxInfo, null, 2));
      
      let genderIdx = -1;
      for (let i = 0; i < comboboxInfo.length; i++) {
        const info = comboboxInfo[i];
        // EN: gender | ID: "Pilih jenis kelamin Anda"
        if (/gender|jenis kelamin/.test(info.text + ' ' + info.ariaLabel)) {
          genderIdx = i;
          break;
        }
      }
      
      if (genderIdx === -1) {
        throw new Error('Could not find gender combobox');
      }
      
      this.addStep('identify_gender_combobox', true, `Gender combobox at index ${genderIdx}`);
      
      // Klik combobox gender
      console.log(`Clicking gender combobox (index ${genderIdx})...`);
      await this.klikCombobox(comboboxes[genderIdx]);
      await this.sleep(this.randomInt(500, 800));
      
      // Pilih option gender — coba EN lalu ID sesuai locale halaman
      let genderUsed = '';
      for (const cand of genderCandidates) {
        if (await this.pilihOpsiTeks(cand, false)) { genderUsed = cand; break; }
      }
      if (!genderUsed) throw new Error('opsi gender (EN/ID) tidak ketemu');
      console.log(`Selecting gender option: ${genderUsed}...`);
      await this.sleep(this.randomInt(300, 500));
      
      this.addStep('fill_gender', true, `Gender: ${genderUsed}`);
      
    } catch (error) {
      console.log('Gender fill error:', error.message);
      this.addStep('fill_gender', false, error.message);
      throw new Error(`Cannot select gender: ${error.message}`);
    }
  }

  /**
   * Type with human-like delays and random pauses
   */
  async typeHuman(selector, text) {
    await this.page.click(selector);
    await this.sleep(this.randomInt(200, 500)); // Initial focus delay
    
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      
      // Variable typing speed per character
      const baseDelay = this.randomInt(80, 180);
      
      // Occasionally type faster (2 characters quick succession)
      const isFastTyping = Math.random() < 0.15;
      const delay = isFastTyping ? this.randomInt(30, 70) : baseDelay;
      
      await this.page.type(selector, char, { delay });
      
      // Random thinking pauses (15% chance)
      if (Math.random() < 0.15 && i < text.length - 1) {
        await this.sleep(this.randomInt(400, 1200));
      }
      
      // Occasional micro-pause between words
      if (char === ' ' && Math.random() < 0.3) {
        await this.sleep(this.randomInt(100, 300));
      }
    }
    
    // Small delay after finishing typing
    await this.sleep(this.randomInt(100, 300));
  }

  /**
   * Move mouse to element before clicking (human-like behavior)
   */
  async moveMouseToElement(element) {
    try {
      const box = await element.boundingBox();
      if (box) {
        // Move mouse in steps (not instant teleport)
        const targetX = box.x + box.width / 2 + this.randomInt(-5, 5);
        const targetY = box.y + box.height / 2 + this.randomInt(-5, 5);
        
        await this.page.mouse.move(targetX, targetY, {
          steps: this.randomInt(10, 30) // Curved movement
        });
        
        // Hover briefly before clicking
        await this.sleep(this.randomInt(100, 300));
      }
    } catch (err) {
      // If mouse movement fails, continue anyway
      console.log('Mouse movement skipped:', err.message);
    }
  }

  /**
   * Natural scrolling behavior
   */
  async naturalScroll(direction = 'down') {
    try {
      const scrollDistance = direction === 'down' 
        ? this.randomInt(150, 400) 
        : -this.randomInt(150, 400);
      
      await this.page.evaluate((distance) => {
        window.scrollBy({
          top: distance,
          behavior: 'smooth'
        });
      }, scrollDistance);
      
      await this.sleep(this.randomInt(600, 1500));
    } catch (err) {
      console.log('Scroll skipped:', err.message);
    }
  }

  /**
   * Human delay with occasional longer pauses
   */
  async humanDelay(min = 1000, max = 3000) {
    let delay = this.randomInt(min, max);
    
    // 10% chance of longer "thinking" pause
    if (Math.random() < 0.1) {
      delay += this.randomInt(2000, 5000);
    }
    
    await this.sleep(delay);
  }

  /**
   * Submit form
   */
  async submitForm() {
    this.addStep('submit_form', false, 'Submitting...');

    await this.sleep(this.randomInt(1000, 2000));
    
    // Coba beberapa cara mencari tombol submit
    let submitButton = null;
    
    // 1. Facebook menggunakan DIV sebagai button, cari berdasarkan text "Submit"
    // Locale Indonesia: tombol daftar = "Daftar" (pelajaran run 2026-10-09:
    // 'Cannot find submit button' padahal form terisi rapi).
    // Locale Indonesia tombol daftar = "Kirim" (run-3: dump kandidat
    // memperlihatkan "Kirim" sebagai tombol submit form, bukan "Daftar").
    // MOBILE (m.facebook): tombol daftar = "Buat Akun Baru" / "Create Account"
    // / "Sign up" — tanpa ini form mobile gagal klik submit.
    const submitLabels = this.isMobileUA
      ? ['Daftar', 'Sign Up', 'Sign Up'.toUpperCase(), 'Create Account', 'Buat Akun Baru', 'Kirim', 'Send', 'Submit', 'Gabung', 'Berikutnya', 'Lanjut']
      : ['Submit', 'Sign Up', 'Create Account', 'Daftar', 'Gabung', 'Kirim', 'Send'];
    const allClickables = await this.page.$$('button, div[role="button"], [role="button"]');
    for (const element of allClickables) {
      const text = await element.textContent();
      if (text && submitLabels.some(lbl => text.includes(lbl))) {
        submitButton = element;
        this.addStep('find_submit', true, `Found submit element with text: ${text.trim()}`);
        break;
      }
    }
    
    // 2. Fallback: cari dengan selector tradisional
    if (!submitButton) {
      const submitSelectors = [
        'button[name="websubmit"]',
        'button[type="submit"]',
        '[data-testid*="signup"]',
        '[data-testid*="registration"]'
      ];

      for (const selector of submitSelectors) {
        try {
          submitButton = await this.page.$(selector);
          if (submitButton) {
            this.addStep('find_submit', true, `Found button: ${selector}`);
            break;
          }
        } catch (e) {
          continue;
        }
      }
    }

    if (!submitButton) {
      // Diagnostik: daftar kandidat tombol terlihat supaya selector tidak buta.
      try {
        const cands = await this.page.evaluate(() =>
          Array.from(document.querySelectorAll('button, [role="button"]'))
            .slice(0, 30)
            .map((el) => ({ text: (el.textContent || '').trim().slice(0, 40), aria: el.getAttribute('aria-label'), type: el.getAttribute('type') }))
            .filter((c) => c.text || c.aria));
        console.log('Tombol kandidat:', JSON.stringify(cands));
      } catch (e) { /* abaikan */ }
      throw new Error('Cannot find submit button');
    }

    // Click submit button
    await submitButton.click();
    this.addStep('click_submit', true, 'Clicked submit button');

    // Wait for response
    try {
      await Promise.race([
        this.page.waitForNavigation({ timeout: 30000, waitUntil: 'domcontentloaded' }),
        this.page.waitForSelector('[role="alert"]', { timeout: 5000 }).then(() => {
          throw new Error('Form validation error');
        })
      ]);
    } catch (error) {
      // Check jika masih di halaman yang sama atau ada error
      const errorElements = await this.page.$$('[role="alert"], .error, [aria-label*="error"]');
      if (errorElements.length > 0) {
        const errorText = await errorElements[0].textContent();
        throw new Error(`Validation error: ${errorText}`);
      }
    }

    this.addStep('submit_form', true, 'Form submitted');
    await this.checkRegistrationBlocked('after_submit');
  }

  /**
   * Fail-fast: FB menolak registrasi di server (rate-limit IP / flag).
   * Kalau banner ini ada, email OTP tidak akan pernah datang — langsung gagal jelas.
   */
  async checkRegistrationBlocked(when) {
    try {
      const bodyText = await this.page.evaluate(() => document.body ? document.body.innerText : '');
      if (/an error occurred during your registration/i.test(bodyText || '')) {
        await this.snapFbEvidence('blocked_' + when);
        this.addStep('fb_block', false, `Blocked ${when}: rate-limit/flag IP`);
        throw new Error('fb_registration_blocked: IP kena rate-limit/flag FB — cooldown + ganti IP/proxy sebelum coba lagi');
      }
    } catch (e) {
      if (e.message && e.message.startsWith('fb_registration_blocked')) throw e;
      // Abaikan error baca halaman, lanjut alur normal
    }
  }

  /**
   * Rekam bukti teks FB langsung dari halaman (kutipan + klasifikasi):
   * checkpoint, suspended/disabled, atau pesan error apa pun. Disimpan di
   * this.result.fbReason/fbChallenge → result file → kolom fail_reason/
   * challenge signup_history + account_events. Panggilan gagal dibaca
   * halaman tak pernah mengganggu alur utama.
   */
  async snapFbEvidence(stage) {
    try {
      const url = this.page.url();
      const raw = await this.page.evaluate(() => document.body ? document.body.innerText : '');
      const flat = String(raw || '').replace(/\s+/g, ' ').trim();
      const RE = /(an error occurred[^\n]{0,140}|checkpoint[^\n]{0,140}|confirm your identity[^\n]{0,140}|suspended[^\n]{0,140}|account.{0,40}disabled[^\n]{0,140}|too many[^\n]{0,140}|temporarily blocked[^\n]{0,140}|security check[^\n]{0,140})/i;
      const m = RE.exec(flat);
      let challenge = null;
      if (/an error occurred during your registration/i.test(flat)) challenge = 'fb_registration_blocked';
      else if (/checkpoint|checkpoint_challenge|two_step/i.test(url)) challenge = 'checkpoint';
      else if (/suspended|disabled/i.test(flat)) challenge = 'suspended_or_disabled';
      else if (m) challenge = 'error_message';
      if (!this.result.fbReason) this.result.fbReason = (m && m[0]) || flat.slice(0, 200) || null;
      if (!this.result.fbChallenge && challenge) this.result.fbChallenge = challenge;
      if (challenge || m) console.log(`[BUKTI FB] ${stage}: ${this.result.fbChallenge} | url: ${url.slice(0, 100)}`);
    } catch (e) { /* halaman sudah lepas/tutup — bukti tetap dari error di atas */ }
  }

  /**
   * Minta satu baris bebas dari operator via panel. Marker `reqMark` memunculkan
   * kartu terkait di UI; input operator diteruskan server lewat stdin (satu baris).
   * Pola IG (askOperatorOtp): callback stdin per baris, regex kembalian, guard 8 menit.
   * Dipakai utk: kode OTP email (default regex \d{4,8}), NOMOR HP (regex nomor).
   * Bila stdin tidak tersedia (dipanggil via worker.js), kembalikan null —
   * pemanggil memutuskan fallback.
   */
  async askOperatorLine({ timeoutMs = 8 * 60 * 1000, reqMark = '[OTP_REQUIRED]', gotMark = '[OTP_GOT]', re = /(\d{4,8})/ } = {}) {
    if (!process.stdin || process.stdin.readable === false) {
      console.log('[panel] stdin tidak tersedia — input operator dilewati.');
      return null;
    }
    console.log(reqMark);
    return new Promise((resolve) => {
      let buf = '';
      const onData = (d) => {
        buf += String(d);
        let nl;
        while ((nl = buf.indexOf('\n')) !== -1) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          const m = re.exec(line);
          if (m && m[1] !== undefined) {
            cleanup();
            console.log(gotMark);
            resolve(String(m[1] !== null ? m[1] : m[0]).trim());
            return;
          }
          console.log('[panel-txt] input tidak cocok, coba lagi:', line.slice(0, 24));
        }
      };
      const cleanup = () => {
        if (process.stdin.off) process.stdin.off('data', onData);
        clearTimeout(timer);
      };
      const timer = setTimeout(() => {
        cleanup();
        console.log(reqMark + ' operator tidak memasukkan input dalam 8 menit.');
        resolve(null);
      }, timeoutMs);
      if (process.stdin.setEncoding) process.stdin.setEncoding('utf8');
      process.stdin.on('data', onData);
    });
  }

  /**
   * Wait for verification email
   */
  async waitForVerificationEmail() {
    this.addStep('wait_email', false, 'Waiting...');
    this.mailWorker = this.mailWorker || new MailWorkerClient();

    // MOBILE (paritas IG Create): FB mobile kadang skip form kode di browser dan
    // HANYA kirim link konfirmasi via email (halaman konfirmasi buka di tab baru).
    // Bila halaman aktif membuka confirmemail.php → navigasikan sendiri ke sana
    // supaya tuntaskan tanpa operator.
    if (this.isMobileUA && this.page) {
      const urlNow = String(this.page.url() || '');
      if (/confirmemail\.php/.test(urlNow) || this.pendingConfirmUrl) {
        const target = this.pendingConfirmUrl || urlNow;
        console.log('Mobile: buka URL konfirmasi email terukur:', target);
        try { await this.page.goto(target, { timeout: 30000, waitUntil: 'domcontentloaded' }); this.pendingConfirmUrl = null; } catch (e) { /* lanjut polling */ }
      }
    }

    // JALUR GMAIL STOK: polling inbox Gmail via tab browser di context yang sama
    // (profil Gmail stok sudah login dari panel). Tidak melalui AMMAIL.
    if (this.options.gmailContext && !this.inboxAlias) {
      // Sudah masuk polling email FB = FB sudah diminta kirim kode ke inbox ini.
      // Tandai used sekarang (idempotent), bukan hanya saat success di wrapper.
      this.markStockGmailUsed();
      return this.waitForVerificationViaGmailTab();
    }

    if (!this.inboxAlias) {
      this.addStep('wait_email', false, 'No inbox alias');
      return null;
    }

    const maxAttempts = 90;
    let attempts = 0;

    while (attempts < maxAttempts) {
      await this.sleep(5000);
      attempts++;

      try {
        const messages = await this.mailWorker.listMessages(this.inboxAlias);

        if (messages && messages.length > 0) {
          // Cek semua pesan (FB kadang kirim >1 email), ambil yang ada kode/link
          for (const preview of messages) {
            if (!preview.id) continue;
            // Get full message
            const msg = await this.mailWorker.getMessage(preview.id);

            const otp = this.extractOtp(msg || {});
            if (otp.code || otp.verifyUrl) {
              this.addStep('wait_email', true, `Code: ${otp.code || otp.verifyUrl}`);
              return otp;
            }
          }
        }
      } catch (error) {
        // Continue polling
      }
    }

    this.addStep('wait_email', false, 'Timeout');
    return null;
  }

  /**
   * Jalur Gmail stok: buka tab mail.google.com di context FB (profil Gmail
   * sudah login), polling email dari Facebook, ekstrak kode OTP atau link
   * konfirmasi. Max 90 x 5 dtk = 7.5 menit (sama seperti jalur AMMAIL).
   * Email FB dikenali dari subject/sender (facebookmail.com).
   */
  async waitForVerificationViaGmailTab() {
    const maxAttempts = 90;
    let attempts = 0;
    let gmailTab = null;
    try {
      // Pakai tab yang sudah ada bila ada; kalau tidak, buka baru.
      const pages = this.context.pages();
      gmailTab = pages.find((p) => /mail\.google\.com/.test(p.url())) || null;
      if (!gmailTab) {
        gmailTab = await this.context.newPage();
        await gmailTab.goto('https://mail.google.com/mail/u/0/#inbox', { timeout: 60000, waitUntil: 'domcontentloaded' }).catch(() => {});
      }
    } catch (e) {
      this.addStep('wait_email', false, 'gagal buka Gmail tab: ' + ((e && e.message) || e).split('\n')[0]);
      return null;
    }

    while (attempts < maxAttempts) {
      await this.sleep(5000);
      attempts++;
      try {
        // Gmail web: baris email di list. Cari yang dari facebookmail.com.
        const rows = gmailTab.locator('tr.zA, div[role="link"][data-legacy-thread-id], tr[jsmodel]').filter({ hasText: /facebook/i }).first();
        if (!(await rows.isVisible().catch(() => false))) continue;
        await rows.click({ timeout: 8000 }).catch(() => {});
        await this.sleep(3000);
        // Baca isi halaman: subject + body + cari kode/link konfirmasi.
        const body = await gmailTab.evaluate(() => (document.body ? document.body.innerText : ''));
        const otp = this.extractOtp({ text: body, html: body, subject: body });
        if (otp.code || otp.verifyUrl) {
          this.addStep('wait_email', true, `Code: ${otp.code || otp.verifyUrl}`);
          return otp;
        }
        // Bukan email OTP (misal notifikasi lain) — balik ke inbox coba lagi.
        await gmailTab.goBack({ timeout: 15000, waitUntil: 'domcontentloaded' }).catch(() => {});
      } catch (e) {
        // lanjut polling
      }
    }
    this.addStep('wait_email', false, 'Timeout menunggu email FB di Gmail stok');
    return null;
  }

  /**
   * Extract OTP from email
   */
  extractOtp(message) {
    const msg = message || {};
    const f = extractOtp(msg.text || msg.body || '', msg.html || '', msg.subject || '');
    return { code: f.code || '', verifyUrl: f.verifyUrl || '' };
  }

  /**
   * Extract verification URL from email
   */
  extractVerifyUrl(msg) {
    const haystack = [(msg && msg.subject) || '', (msg && msg.text) || '', (msg && msg.html) || ''].join('\n');
    const verifyUrlMatch = /https?:\/\/[^\s<>"']+(?:verify|confirm|activate)[^\s<>"']*/i.exec(haystack);
    return verifyUrlMatch ? verifyUrlMatch[0] : '';
  }

  /**
   * Submit the Facebook confirmation code returned by Ammail.
   * Sabar menunggu input muncul (maks 5 menit): FB bisa menyela captcha/security
   * check dulu, dan form kodenya bisa berada di dalam IFRAME atau memakai input
   * generik — jadi pencarian dilakukan di semua frame + fallback selector luas.
   */
  async submitVerificationCode(code, { timeoutMs = 300000 } = {}) {
    if (!code) return false;
    const deadline = Date.now() + timeoutMs;
    let announcedCaptcha = false;
    const inputSel = [
      'input[name="code"]', 'input[name="confirmation_code"]',
      'input[placeholder*="code" i]', 'input[aria-label*="code" i]',
      'input[inputmode="numeric"]', 'input[type="tel"]', 'input[type="text"]',
    ].join(', ');
    // Cari input kode di SEMUA frame (FB kadang render checkpoint di iframe).
    const findInput = async () => {
      for (const frame of this.page.frames()) {
        try {
          const loc = frame.locator(inputSel).first();
          if ((await loc.count()) && (await loc.isVisible())) return { frame, loc };
        } catch (e) { /* frame lepas, lanjut frame berikut */ }
      }
      return null;
    };
    while (Date.now() < deadline) {
      const bodyText = await this.page.evaluate(() => (document.body ? document.body.innerText : '')).catch(() => '');
      const onCodePage = /enter the confirmation code|confirmation code|kode konfirmasi/i.test(bodyText || '');
      const onCaptcha = /security check|captcha|selesaikan/i.test(bodyText || '') && !onCodePage;
      if (onCaptcha) {
        if (!announcedCaptcha) {
          console.log('Captcha/security check terdeteksi — selesaikan manual di browser; bot menunggu form kode muncul...');
          announcedCaptcha = true;
        }
        await this.sleep(3000);
        continue;
      }
      const found = await findInput();
      if (found) {
        try {
          await found.loc.click().catch(() => {});
          // Ketik per karakter (bukan fill) supaya handler React/JS FB terpicu.
          if (found.loc.pressSequentially) await found.loc.pressSequentially(String(code), { delay: 90 });
          else await found.loc.type(String(code), { delay: 90 });
          await this.sleep(this.randomInt(600, 1200));
          const btn = found.frame.getByRole('button', { name: /continue|confirm|lanjut|konfirmasi/i }).first();
          if (await btn.count()) await btn.click().catch(() => {});
          else await found.loc.press('Enter').catch(() => {});
          await this.sleep(5000);
          this.addStep('submit_code', true, 'Confirmation code submitted');
          console.log('Kode konfirmasi terkirim:', String(code));
          return true;
        } catch (error) {
          this.addStep('submit_code', false, error.message);
          console.log('Gagal mengisi kode konfirmasi:', error.message);
          return false;
        }
      }
      if (!announcedCaptcha && onCodePage) {
        console.log('Halaman kode konfirmasi terbuka — mencari input di semua frame...');
      }
      await this.sleep(2000);
    }
    this.addStep('submit_code', false, 'form kode konfirmasi tidak pernah muncul (timeout 5 menit)');
    console.log('Timeout menunggu form kode konfirmasi.');
    return false;
  }

  /**
   * Extract cookies
   */
  async extractCookies() {
    this.addStep('extract_cookies', false, 'Extracting...');

    const cookies = await this.context.cookies();
    const sessionCookies = cookies.filter(c => 
      ['c_user', 'xs', 'datr', 'fr'].includes(c.name)
    );

    if (sessionCookies.length > 0) {
      this.result.cookies = sessionCookies;
      this.addStep('extract_cookies', true, `${sessionCookies.length} cookies`);
      return sessionCookies;
    }

    this.addStep('extract_cookies', false, 'No cookies');
    return null;
  }

  /**
   * Save account to database
   */
  async saveToDatabase() {
    if (!this.options.saveToDatabase) return null;

    this.addStep('save_to_db', false, 'Saving...');

    try {
      await db.waitReady();

      const accountData = {
        name: this.result.email.split('@')[0],
        email: this.result.email,
        password: this.result.password,
        proxy: this.options.proxy || '',
        status: 'active',
        platform: 'fb',
        // Fingerprint signup = fingerprint selamanya (kunci anti-checkpoint).
        user_agent: (this.fingerprint && this.fingerprint.userAgent) || '',
        viewport: (this.fingerprint && this.fingerprint.viewport) || '1366x768',
        locale: (this.fingerprint && this.fingerprint.locale) || 'id-ID',
        timezone: (this.fingerprint && this.fingerprint.timezoneId) || 'Asia/Jakarta',
      };

      const accountId = await db.addAccount(accountData);
      this.result.accountId = accountId;

      // Konfig spoof canvas/audio/webgl ikut disimpan permanen — seed yang sama
      // dipakai ulang setiap kali akun ini login/buka browser (konsistensi > keacakan).
      if (this.spoofConfig) {
        try {
          db.run('UPDATE accounts SET fingerprint_json = ? WHERE id = ?', [JSON.stringify(this.spoofConfig), accountId]);
          db.save();
        } catch (e) {
          console.log(`  [fb-creator] simpan spoof cfg gagal: ${e.message}`);
        }
      }

      this.addStep('save_to_db', true, `Account ID: ${accountId}`);
      
      // Send notification
      try {
        await notificationSystem.send({
          title: '✅ Facebook Account Created',
          message: `New account created: ${this.result.email}`,
          type: 'success',
          data: { accountId, email: this.result.email }
        });
      } catch (e) {
        // Notification failed, continue
      }

      return accountId;
    } catch (error) {
      this.addStep('save_to_db', false, error.message);
      throw error;
    }
  }

  /**
   * Cleanup
   */
  async cleanup() {
    try {
      if (this.page) await this.page.close();
      if (this.context) await this.context.close();
      if (this.browser) await this.browser.close();
    } catch (error) {
      // Ignore cleanup errors
    }
  }

  // Minta kode OTP dari operator via panel. Worker mencetak marker yang
  // diparse UI → kartu input muncul → operator ketik → server meneruskan lewat
  // stdin (satu baris). Batas tunggu 8 menit menyamai window OTP FB.
  async askOperatorOtp({ timeoutMs = 8 * 60 * 1000 } = {}) {
    return this.askOperatorLine({ timeoutMs, reqMark: '[OTP_REQUIRED]', gotMark: '[OTP_GOT]', re: /(\d{4,8})/ });
  }

  // Gmail stok SEKALI PAKAI: begitu FB meminta kode verifikasi ke email ini
  // (atau operator mengisi OTP-nya), email sudah tercatat di FB — run macet
  // apa pun hasilnya (form stuck, OTP tak terbaca, browser ditutup) Gmail ini
  // tidak boleh kembali 'available' di dropdown lalu dipakai daftar ulang
  // (OTP kedua tidak akan pernah datang ke inbox yang sama). Idempotent: dipanggil
  // berkali-kali tetap satu penandaan.
  markStockGmailUsed() {
    if (this._gmailMarked) return;
    const m = /gmail-(\d+)/.exec(String((this.options.gmailContext && this.options.gmailContext.profileDir) || ''));
    if (!m) return;
    this._gmailMarked = true;
    try {
      db.markGmailUsed(Number(m[1]), 'fb', String(this.result.email || '').split('@')[0]);
      console.log('[GMAIL] pool #' + m[1] + ' ditandai used utk fb (verifikasi diminta): ' + String(this.result.email || '').split('@')[0]);
    } catch (e) { console.log('[GMAIL] tandai used (fb) gagal: ' + e.message); }
  }

  // Nomor HP untuk --phone-signup. Marker [PHONE_REQUIRED] diparse UI (kartu No. HP);
  // penerimaan [PHONE_GOT] menchup kartunya. Nol sama bila operator menyerah
  // (timeout 8 menit) — run gagal jelas dengan error phone_not_received.
  async askOperatorPhone({ timeoutMs = 8 * 60 * 1000 } = {}) {
    const raw = await this.askOperatorLine({
      timeoutMs,
      reqMark: '[PHONE_REQUIRED] Facebook minta nomor HP — ketik nomor SIM aktif di panel (kartu No. HP). Menunggu max 8 menit.',
      gotMark: '[PHONE_GOT] nomor diterima dari panel.',
      re: /(\+?\d[\d\s-]{6,17}\d)/,
    });
    if (!raw) {
      if (this.result.error === 'form_phone_not_supported') return null; // sudah difemarkan di fallback m.facebook
      throw new Error('phone_not_received');
    }
    return raw.replace(/[\s-]+/g, '');
  }

  /**
   * WIZARD META BARU (pelajaran run 16/10): m.facebook.com/reg REDIRECT ke
   * m.facebook.com/ig/login_via/app/ — landing "Mulai di Facebook dengan Akun
   * Meta" dengan tombol [Mulai]. Klik SEBELUM hidrasi React selesai tidak
   * bereaksi (inilah penyebab "Signup form did not appear"). Wizard bertahap:
   *   1. Siapa nama Anda?  (2 input text: aria Nama depan/Nama belakang)
   *   2. Kapan tanggal lahir Anda? (input[type=date])
   *   3. Apa jenis kelamin Anda? (teks opsi: Perempuan/Laki-laki/Opsi lainnya)
   *   4. Berapa nomor ponsel Anda? (input[type=tel] + tautan "Daftar dengan email")
   * Tiap langkah tombol [Berikutnya]. Jalur email = klik "Daftar dengan email"
   * di langkah 4.
   */
  async runMetaWizard(firstName, lastName, birthdate, gender) {
    try {
      return await this._runMetaWizardInner(firstName, lastName, birthdate, gender);
    } catch (error) {
      // Bila error bukan meta_wizard_* (mis. operator timeout), dump tetap berguna
      // untuk melihat di layar mana operator terbengkalai.
      await this.dumpWizardStructure(error.message);
      throw error;
    }
  }

  async _runMetaWizardInner(firstName, lastName, birthdate, gender) {
    // Pelajaran run 2026-10-19: wizard bisa sudah terlanjur di tengah (hidrasi,
    // retry, atau operator menekan lanjut saat browser KEEP-OPEN terbuka) —
    // alur lama linear dari landing gagal dan jatuh ke jalur form klasik.
    // Deteksi langkah aktif tiap putaran, lanjut dari situ.
    this.addStep('meta_wizard', false, 'Landing Meta terdeteksi — jalur wizard bertahap');
    let lastStep = null;
    let sameCount = 0;
    let unknownCount = 0;
    let mulaiAttempts = 0;
    for (let round = 0; round < 15; round++) {
      const step = await this.detectWizardStep();
      if (step === lastStep && step !== 'landing') {
        sameCount++; // langkah sama berulang walau Berikutnya sudah diklik = klik tidak bereaksi
        if (sameCount >= 3) throw new Error(`meta_wizard_failed: langkah "${step}" tidak lanjut walau tombol diklik`);
      } else {
        sameCount = 0;
      }
      lastStep = step;

      if (step === 'landing') {
        mulaiAttempts++;
        await this.clickWizardMulai(mulaiAttempts);
        continue;
      }

      // LANGKAH nama — nama depan + belakang (input aria-label, tanpa name/id).
      if (step === 'name') {
        const nameInputs = await this.page.$$('input[type="text"]:visible');
        if (nameInputs.length < 2) throw new Error('meta_wizard_failed: input nama tidak ketemu');
        await nameInputs[0].click();
        await nameInputs[0].type(firstName, { delay: this.randomInt(50, 130) });
        await this.sleep(this.randomInt(400, 900));
        await nameInputs[1].click();
        await nameInputs[1].type(lastName, { delay: this.randomInt(50, 130) });
        await this.sleep(this.randomInt(400, 900));
        if (!(await this.clickWizardNext())) throw new Error('meta_wizard_failed: tombol Berikutnya (nama) tidak ketemu');
        this.addStep('wizard_name', true, `Nama: ${firstName} ${lastName}`);
        continue;
      }

      // LANGKAH dob — input[type=date], format YYYY-MM-DD.
      if (step === 'dob') {
        const dob = await this.page.$('input[type="date"]:visible');
        if (!dob) throw new Error('meta_wizard_failed: input tanggal lahir tidak ketemu');
        const iso = `${birthdate.year}-${String(birthdate.month).padStart(2, '0')}-${String(birthdate.day).padStart(2, '0')}`;
        await dob.click().catch(() => {});
        await dob.fill(iso).catch(async () => {
          await dob.evaluate((el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); }, iso);
        });
        await this.sleep(this.randomInt(600, 1200));
        if (!(await this.clickWizardNext())) throw new Error('meta_wizard_failed: tombol Berikutnya (dob) tidak ketemu');
        this.addStep('wizard_dob', true, `DOB: ${iso}`);
        continue;
      }

      // LANGKAH gender — opsi teks biasa, bukan combobox.
      if (step === 'gender') {
        const genderCandidates = gender === 'male' ? ['Laki-laki', 'Male']
          : gender === 'female' ? ['Perempuan', 'Female'] : ['Opsi lainnya', 'Custom'];
        let genderUsed = '';
        for (const cand of genderCandidates) {
          const opt = this.page.locator(`[role="button"]:has-text("${cand}"), div[role="radio"]:has-text("${cand}"), label:has-text("${cand}")`).first();
          if (await opt.count()) {
            await opt.click({ timeout: 5000 }).catch(() => {});
            genderUsed = cand;
            break;
          }
        }
        if (!genderUsed) console.log('Gender wizard tidak ketemu — lanjut (FB akan minta ulang bila wajib)');
        else this.addStep('wizard_gender', true, `Gender: ${genderUsed}`);
        await this.sleep(this.randomInt(500, 1000));
        if (!(await this.clickWizardNext())) throw new Error('meta_wizard_failed: tombol Berikutnya (gender) tidak ketemu');
        continue;
      }

      // LANGKAH kontak. Jalur telepon: isi input tel + Berikutnya.
      // Jalur email: klik tautan "Daftar dengan email" → kolom email muncul.
      if (step === 'contact') {
        await this.sleep(this.randomInt(1500, 2500));
        if (this.options.phoneSignup) {
          const tel = await this.page.$('input[type="tel"]:visible');
          if (!tel) throw new Error('meta_wizard_failed: input nomor ponsel tidak ketemu');
          if (!this.result.phone) {
            const p = await this.askOperatorPhone();
            if (!p) throw new Error('phone_not_received');
            this.result.phone = p;
          }
          await tel.click();
          await tel.type(this.result.phone, { delay: this.randomInt(60, 140) });
          await this.sleep(this.randomInt(600, 1200));
          if (!(await this.clickWizardNext())) throw new Error('meta_wizard_failed: Berikutnya (nomor) tidak ketemu');
          this.addStep('wizard_contact', true, 'nomor terkirim — layar kode SMS menyusul');
          return; // verifikasi SMS dilanjutkan runPhoneVerification di run()
        }
        // Jalur email: tautan "Daftar dengan email" (landing nomor dulu di varian ini).
        const emailLink = this.page.locator('[role="button"]:has-text("Daftar dengan email"), a:has-text("Daftar dengan email"), [role="button"]:has-text("Sign up with email")').first();
        if (await emailLink.count()) {
          await emailLink.click({ timeout: 5000 }).catch(() => {});
          await this.sleep(this.randomInt(2000, 3500));
        }
        const emailInput = await this.page.$('input[type="email"]:visible, input[type="text"]:visible');
        if (!emailInput) throw new Error('meta_wizard_failed: input email tidak ketemu setelah tautan email');
        await emailInput.click();
        await emailInput.type(this.result.email, { delay: this.randomInt(50, 130) });
        await this.sleep(this.randomInt(600, 1200));
        if (!(await this.clickWizardNext())) throw new Error('meta_wizard_failed: Berikutnya (email) tidak ketemu');
        this.addStep('wizard_contact', true, 'email terkirim — layar kode verifikasi menyusul');
        return;
      }

      // Langkah tak dikenal: kasih waktu hidrasi/animasi, deteksi ulang;
      // stagnan → gagal (dump struktur otomatis ikut via runMetaWizard).
      unknownCount++;
      if (unknownCount >= 3) {
        const snippet = await this.page.evaluate(() => ((document.body && document.body.innerText) || '').replace(/\s+/g, ' ').slice(0, 150));
        throw new Error(`meta_wizard_failed: langkah tidak dikenal — "${snippet}"`);
      }
      await this.sleep(this.randomInt(2000, 3500));
    }
    throw new Error('meta_wizard_failed: wizard tidak selesai dalam 15 putaran deteksi');
  }

  // Klik [Mulai] di landing Meta. Klik prematur sebelum hidrasi React tidak
  // bereaksi — mulai percobaan ke-4, dispatch event DOM langsung via JS.
  async clickWizardMulai(attempt) {
    await this.sleep(this.randomInt(1500, 2500));
    const mulai = this.page.locator('[role="button"]:has-text("Mulai"), button:has-text("Mulai"), a:has-text("Mulai"), button:has-text("Get started"), [role="button"]:has-text("Get started")').first();
    if (!(await mulai.count())) return false; // landing sudah berubah — deteksi ulang
    try {
      await mulai.click({ timeout: 5000 });
    } catch (e) {
      if (attempt >= 4) {
        await this.page.evaluate(() => {
          const cands = [...document.querySelectorAll('button, [role="button"], a, div')]
            .filter((el) => (el.textContent || '').trim() === 'Mulai' && el.offsetWidth > 0);
          const el = cands[cands.length - 1];
          if (!el) return;
          ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach((t) =>
            el.dispatchEvent(new MouseEvent(t, { bubbles: t === 'click', cancelable: true, view: window })));
        });
      }
    }
    await this.sleep(this.randomInt(2500, 4000));
    return true;
  }

  // Identifikasi langkah wizard aktif dari teks layar — bukan dari posisi
  // terakhir, supaya bot bisa masuk kapan pun wizard sudah berada di situ.
  async detectWizardStep() {
    try {
      const t = await this.page.evaluate(() => (document.body ? document.body.innerText : ''));
      const s = t || '';
      if (/siapa nama anda/i.test(s)) return 'name';
      if (/jenis kelamin/i.test(s)) return 'gender';
      if (/nomor ponsel|daftar dengan email/i.test(s)) return 'contact';
      if (/tanggal lahir/i.test(s) || (await this.page.$('input[type="date"]:visible'))) return 'dob';
      if (/akun meta|meta account/i.test(s)) return 'landing';
      if (await this.page.locator('[role="button"]:has-text("Mulai"), button:has-text("Mulai"), a:has-text("Mulai")').count()) return 'landing';
      return null;
    } catch (e) { return null; }
  }

  /**
   * Dump struktur halaman wizard saat berhenti di langkah tak dikenal —
   * sessions/wizard-dump-<waktu>.json. Audit berikutnya cukup baca file ini,
   * tidak perlu probe manual ulang. Non-fatal: kegagalan dump tak menutupi
   * error aslinya.
   */
  async dumpWizardStructure(reason) {
    try {
      const info = await this.page.evaluate(() => {
        const vis = (el) => el.offsetWidth > 0 && el.offsetHeight > 0;
        const inputs = [...document.querySelectorAll('input')].map((el) => ({
          type: el.type, name: el.name || null, id: el.id || null,
          aria: el.getAttribute('aria-label'), visible: vis(el),
          placeholder: (el.placeholder || '').slice(0, 40),
        }));
        const buttons = [...document.querySelectorAll('button, [role="button"], input[type="submit"]')]
          .filter(vis)
          .map((el) => ({ tag: el.tagName.toLowerCase(), label: ((el.textContent || el.value || '').trim().slice(0, 50)) }))
          .filter((b) => b.label);
        return {
          url: location.href,
          title: (document.title || '').slice(0, 120),
          text: ((document.body && document.body.innerText) || '').split(/\r?\n/).filter(Boolean).slice(0, 25),
          inputs, buttons,
          formHtml: document.querySelector('form') ? document.querySelector('form').outerHTML.replace(/\s+/g, ' ').slice(0, 2500) : null,
        };
      });
      info.stoppedAt = String(reason || '').slice(0, 200);
      info.status = this.result.status || null;
      info.error = this.result.error || null;
      info.dumpedAt = new Date().toISOString();
      const dir = path.join(__dirname, '..', 'sessions');
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, 'wizard-dump-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json');
      fs.writeFileSync(file, JSON.stringify(info, null, 2));
      console.log('[DUMP] struktur wizard tersimpan: ' + path.basename(file) + ' (lampirkan file ini bila minta bantuan audit)');
      return file;
    } catch (e) {
      console.log('[DUMP] gagal dump struktur wizard: ' + e.message);
      return null;
    }
  }

  // Klik tombol [Berikutnya]/[Next] wizard; false bila tidak ada (bukan error).
  async clickWizardNext() {
    const btn = this.page.locator('[role="button"]:has-text("Berikutnya"), button:has-text("Berikutnya"), [role="button"]:has-text("Next")').first();
    if (!(await btn.count())) return false;
    await btn.click({ timeout: 8000 }).catch(() => {});
    await this.sleep(this.randomInt(2000, 3500));
    return true;
  }

  // Deteksi alur wizard Meta bertahap — bukan hanya landing "Mulai": varian
  // /reg/ dan login_via sama-sama membukanya, dan wizard bisa sudah di langkah
  // nama saat run tiba. Ciri khasnya judul langkah bertahap, bukan form klasik.
  // Pelajaran run 2026-10-19 (kedua): cek SEKALI di awal sering bertemu body
  // kosong — React belum hydrate saat run baru tiba → salah jalur ke form
  // klasik. Solusi: polling sampai teks muncul ATAU habis percobaan.
  async isMetaLanding() {
    const wizardRe = /akun meta|meta account|siapa nama anda|daftar dengan email|mulai di facebook|get started on facebook/i;
    try {
      const url = this.page.url();
      if (!/login_via|\/ig\/|\/reg\//.test(url)) return false;
      for (let attempt = 0; attempt < 5; attempt++) {
        if (attempt > 0) await this.sleep(this.randomInt(1500, 2500));
        const t = await this.page.evaluate(() => (document.body ? document.body.innerText : ''));
        if (wizardRe.test(t || '')) return true;
      }
      return false;
    } catch (e) { return false; }
  }

  /**
   * Run full signup flow
   */
  async run() {
    try {
      await this.createTempEmail();
      await this.launchBrowser();
      await this.navigateToSignup();

      // STRUKTUR BARU 2026: /reg mengarah ke landing Meta Account wizard bertahap.
      // Deteksi dulu — bila landing Meta, jalur wizard menggantikan fillSignupForm
      // + submitForm (form panjang klasik sudah tidak ada di varian ini).
      let usedWizard = false;
      const genderW = this.options.gender || (this.identity && this.identity.gender) || (Math.random() > 0.5 ? 'male' : 'female');
      const fbName = this.generateName(genderW);
      const wFirst = this.options.firstName || (this.identity && this.identity.firstName) || fbName.firstName;
      const wLast = this.options.lastName || (this.identity && this.identity.lastName) || fbName.lastName;
      const wBirth = this.generateBirthdate(18, 45);
      if (await this.isMetaLanding() && !(await this.isSinglePageRegForm())) {
        usedWizard = true;
        this.result.fullName = `${wFirst} ${wLast}`;
        await this.runMetaWizard(wFirst, wLast, wBirth, genderW);
        if (this.options.phoneSignup) {
          await this.runPhoneVerification();
        }
      } else {
        // fillSignupForm meng-alih sendiri ke wizard bila klik daftar mendarat
        // di landing Meta — submitForm hanya untuk form klasik sungguhan.
        if (await this.fillSignupForm()) {
          usedWizard = true;
          if (this.options.phoneSignup) {
            await this.runPhoneVerification();
          }
        } else {
          await this.submitForm();
        }
      }

      // JALUR NOMOR HP (jalur klasik non-wizard): FB kirim kode OTP via SMS, BUKAN email.
      let verifyEmail = null;
      if (this.options.phoneSignup && usedWizard) {
        // sudah ditangani di dalam cabang wizard di atas
      } else if (this.options.phoneSignup) {
        await this.runPhoneVerification();
      } else {
        verifyEmail = await this.waitForVerificationEmail();
        if (verifyEmail && verifyEmail.code) {
          const submitted = await this.submitVerificationCode(verifyEmail.code);
          if (!submitted) this.result.error = this.result.error || 'confirmation_code_submit_failed';
          this.codeSubmitted = submitted;
        } else if (verifyEmail && verifyEmail.verifyUrl) {
          await this.page.goto(verifyEmail.verifyUrl);
          await this.sleep(5000);
        } else {
          // FALLBACK OPERATOR: email tak terbaca (temp-mail lambat / Gmail belum
          // login di profil). Worker minta kode dari panel: marker OTP_REQUIRED →
          // UI menampilkan kartu input OTP → operator ketik → server meneruskan
          // lewat stdin → worker isi ke form → lanjut otomatis.
          this.markStockGmailUsed(); // email sudah tercatat di FB saat kode diminta — tahan crash
          const manualCode = await this.askOperatorOtp();
          if (manualCode) {
            // OTP operator terkirim ke email stok ini = email sudah terkonsumsi FB.
            this.markStockGmailUsed();
            const submitted = await this.submitVerificationCode(manualCode);
            if (!submitted) this.result.error = this.result.error || 'confirmation_code_submit_failed';
            this.codeSubmitted = submitted;
          } else {
            this.result.error = this.result.error || 'otp_operator_timeout';
          }
        }
      }
      // Setelah kode terisi FB biasanya menyuruh input nama profil / melempar
      // ke beranda — operator yang menyelesaikan di browser (paritas IG).

      // Fingerprint identik antara signup & login, TAPI IP harus juga tetap sama.
      // CATATAN BESAR: signup via proxy, login via IP lain → FB tetap minta kode.
      // Jadi panel HARUS memakai proxy yang sama (IP lahir) saat aktivasi login.
      // Simpan proxy di result file supaya "Daftarkan" membawanya ke akun panel.

      // Sukses = kode sudah dikirim (dari email ATAU dari operator di panel).
      // Run 2026-10-10: OTP operator 95530 terkirim + 5 cookies session, tapi
      // verdict lama menuntut verification dari email → status 'partial' +
      // error 'otp_not_received' (bohong). Padahal akun sudah verifikasi.
      const currentUrl = this.page.url();
      const viaEmail = (verifyEmail && verifyEmail.code && this.codeSubmitted)
        || (verifyEmail && !verifyEmail.code && verifyEmail.verifyUrl);
      const verified = viaEmail || this.codeSubmitted;
      if (verified && currentUrl.includes('facebook.com') && !currentUrl.includes('/login')) {
        this.result.status = 'success';
        if (this.result.error === 'otp_not_received') this.result.error = null;
        await this.saveToDatabase();
      } else {
        this.result.status = 'partial';
        if (!verified) {
          this.result.error = this.result.error || 'otp_not_received';
        }
      }
    } catch (error) {
      await this.snapFbEvidence('pre_verify');
      if (!this.result.fbReason) this.result.fbReason = error.message;
      this.result.error = error.message;
      this.addStep('error', false, error.message);
    } finally {
      await this.cleanup();
    }

    return this.result;
  }

  // Utility functions
  // Fallback nama: pakai BANK INDONESIA (id-identity), bukan nama Inggris —
  // pelajaran run 2026-10-10 'James Jones' terlihat bot karena identitas tidak
  // cocok dengan IP/email Indonesia. pickName dipakai juga oleh jalur temp-mail.
  generateName(gender) {
    const { pickName } = require('./id-identity');
    const idn = pickName(gender);
    return { firstName: idn.first, lastName: idn.last };
  }

  generateBirthdate(minAge, maxAge) {
    const currentYear = new Date().getFullYear();
    const year = currentYear - (minAge + Math.floor(Math.random() * (maxAge - minAge)));
    const month = (1 + Math.floor(Math.random() * 12)).toString();
    const day = (1 + Math.floor(Math.random() * 28)).toString();
    
    return { day, month, year };
  }

  generatePassword() {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%';
    let password = '';
    for (let i = 0; i < 12; i++) {
      password += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return password;
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }
}

module.exports = FacebookAccountCreator;
