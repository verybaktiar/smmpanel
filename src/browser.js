'use strict';

// Engine: patchright (fork Playwright anti-detect level engine). Drop-in API sama;
// patchright menangani webdriver/runtime-CDP-leak di level internal — JANGAN tambah
// stealth manual (addInitScript webdriver) atau flag anti-automation buatan.
const { chromium } = require('patchright');
const stealth = require('./stealth');

// Acak helper
function rand(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Jeda alami seperti manusia berpikir. Kadang jeda lebih lama.
async function humanDelay(msMin, msMax) {
  const base = rand(msMin, msMax);
  // ~20% kemungkinan jeda ekstra panjang (orang berhenti berpikir / pindah).
  const extra = Math.random() < 0.2 ? rand(1200, 3500) : 0;
  await new Promise((r) => setTimeout(r, base + extra));
}

// Ketik teks ke locator dengan jeda acak antar ketukan (meniru manusia).
// Opsi noClick=true: skip klik (untuk elemen yang terhalang overlay).
async function typeHuman(locator, text, opts = {}) {
  if (!opts.noClick) {
    await locator.click();
  }
  await humanDelay(500, 1200);
  const delay = rand(50, 200); // kecepatan ketik bervariasi
  if (locator.pressSequentially) {
    await locator.pressSequentially(text, { delay });
  } else {
    await locator.type(text, { delay });
  }
}

// Parameter proxy DataImpulse: ditempel di username setelah "__" (format resmi docs:
// LOGIN__cr.us;sid.prof01). Diuji empiris 30/9: sticky IP antar sesi (sid/sessttl) TIDAK
// konsisten di gateway ini — IP tetap pindah negara. Yang terbukti bekerja: KUNCI NEGARA
// via __cr.<kode> (dua probe beruntun -> dua IP Indonesia berbeda carrier).
// Jadi strategi farm: 1 negara konsisten per akun (rotasi dalam negara = wajar utk CGNAT
// seluler Indonesia), plus sid per akun sebagai pemisah (jaga-jaga provider memperbaiki sticky).
// Negara diatur .env: DI_COUNTRY=id (atau 'off' utk menonaktifkan kunci negara).
// Proxy non-DataImpulse atau yang sudah punya param "__" diteruskan apa adanya.
function stickyProxy(proxyStr, sid) {
  if (!proxyStr || !sid) return proxyStr;
  const p = proxyStr.split(':');
  if (p.length < 3 || !/dataimpulse/i.test(p[0])) return proxyStr;
  if (p[2].includes('__')) return proxyStr; // sudah ada param — hormati
  const parts = [];
  const cc = String(process.env.DI_COUNTRY || 'id').trim().toLowerCase();
  if (cc && cc !== 'off') parts.push(`cr.${cc}`);
  const safe = String(sid).replace(/[^a-zA-Z0-9_-]/g, '-') || 'acc';
  parts.push(`sid.${safe}`);
  p[2] = `${p[2]}__${parts.join(';')}`;
  return p.join(':');
}

// Buka browser persistent context untuk sebuah akun — anti-detect penuh:
// - fingerprint konsisten per akun (UA/viewport/locale/timezone tersimpan di DB,
//   tidak berubah antar sesi — konsistensi > keacakan)
// - UA asli via CDP (tanpa "HeadlessChrome" walau headless)
// - anti-detect level engine oleh patchright (webdriver, runtime leak) — tanpa stealth script
async function openAccountBrowser(account, { headless = true, mobile = false } = {}) {
  // Isi fingerprint akun bila belum ada (sekali, lalu permanen di DB).
  let fp = null;
  try {
    fp = await stealth.ensureAccountFingerprint(account);
  } catch (e) {
    fp = stealth.pickFingerprint(account || {});
  }

  // Mode MOBILE (paritas IG Create/aktivasi): emulasi Pixel 7 — layar "Buka" akun IG
  // tampil seperti HP, sama seperti saat daftar/aktivasi. Viewport ikuti layar fisik
  // (kasus 12/10: viewport taller dari monitor membuat jendela terpotong Windows).
  let mobileOpt = null;
  if (mobile) {
    let mW = 412, mH = 1080;
    try {
      const probe = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
      const ppage = await (await probe.newContext({ viewport: null })).newPage();
      await ppage.goto('about:blank', { timeout: 15000 }).catch(() => {});
      const scr = await ppage.evaluate(() => ({ w: screen.availWidth || 1280, h: screen.availHeight || 720 }));
      await probe.close().catch(() => {});
      mH = Math.max(560, Math.min(1080, scr.h - 140));
      mW = Math.max(320, Math.min(412, scr.w));
    } catch (e) { /* pakai default 412x1080 */ }
    mobileOpt = { width: mW, height: mH };
  }

  const vpStr = mobile && mobileOpt
    ? `${mobileOpt.width}x${mobileOpt.height}`
    : (fp && fp.viewport) || account.viewport || '1366x768';
  const vp = vpStr.split('x').map(Number);

  // P1 — koordinat geolocation dari IP proxy (paritas AdsPower "Location: Based on
  // IP"). WAJIB pakai PROXY STICKY yang sama dgn browser (sid per akun) — proxy raw
  // DI keluar negara acak, sticky sid keluar negara terkunci (id). Ditempel HANYA
  // bila timezone geo == timezone akun (kalau beda, skip — jangan biarkan koordinat
  // vs jam bertentangan; PUT /:id/proxy menyamakan keduanya). Permission TIDAK
  // diberikan otomatis — tetap "ask" seperti AdsPower "[Ask]".
  let geoOpt = null;
  try {
    const geo = await stealth.resolveProxyGeo(stickyProxy(account.proxy, account.name));
    if (geo && geo.timezone === fp.timezoneId) geoOpt = stealth.geolocationOption(geo);
  } catch (e) { /* tanpa koordinat — fitur tetap jalan normal */ }

  const context = await chromium.launchPersistentContext(account.browser_profile_dir, {
    headless,
    viewport: { width: vp[0] || 1366, height: vp[1] || 768 },
    locale: (fp && fp.locale) || account.locale || 'id-ID',
    timezoneId: (fp && fp.timezoneId) || account.timezone || 'Asia/Jakarta',
    // Emulasi mobile paritas IG Create — hanya saat mode mobile diminta (jalur Buka IG).
    ...(mobileOpt ? {
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 2,
      userAgent: 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
    } : {}),
    // UA DIATUR VIA CDP (attachPageHardening) — jangan di-set di sini supaya
    // override protokol CDP yang menang; setting dua-duanya bisa konflik.
    ...(geoOpt ? { geolocation: geoOpt } : {}),
    args: [
      '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
      '--disable-features=IsolateOrigins,site-per-process',
      '--disable-site-isolation-trials',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-infobars',
      '--window-size=' + (vp[0] || 1366) + ',' + (vp[1] || 768),
      '--start-maximized',
    ],
    // Proxy opsional per akun (format: host:port:user:pass).
    // DataImpulse: kunci negara (__cr, default id) + sid per akun.
    proxy: parseProxy(stickyProxy(account.proxy, account.name)),
    ignoreHTTPSErrors: true,
  });

  // P2 — UA natural dari binary patchright. FAKTA TERUKUR: UA natural patchright
  // headed = "Chrome/153.0.0.0" — itu format User-Agent Reduction Chrome ASLI modern
  // (Chrome asli sejak lama melaporkan major.0.0.0; full build ala tampilan AdsPower
  // justru deviasi). Jadi: headed → pakai UA natural engine apa adanya (via CDP
  // Browser.getVersion; persistent context patchright tetap punya objek Browser).
  // Headless → UA asli berisi "HeadlessChrome" = bot signal → tetap UA sintetis fp,
  // disamakan major-nya dgn binary (alignUaVersion → "153.0.0.0", format reduced asli).
  let naturalUA = null, fullVersion = null;
  const bObj = context.browser();
  if (bObj) {
    // Coba UA natural via CDP — try TERPISAH agar kegagalan CDP tidak membawa
    // jatuhnya fallback version() di bawah (bug yang bikin UA balik ke .0.0.0).
    try {
      if (typeof bObj.newBrowserCDPSession === 'function') {
        const s = await bObj.newBrowserCDPSession();
        const v = await s.send('Browser.getVersion').catch(() => null);
        if (v && v.userAgent) naturalUA = v.userAgent;
        const pm = v && v.product ? String(v.product).match(/Chrome\/([\d.]+)/) : null;
        if (pm) fullVersion = pm[1];
        try { await s.detach(); } catch (e) { /* sesi sudah tertutup */ }
      }
    } catch (e) { /* CDP gagal — lanjut version() */ }
    // Versi penuh dari objek Browser (selalu tersedia di patchright).
    try {
      if (!fullVersion && typeof bObj.version === 'function') {
        const ver = String(bObj.version() || '');
        if (/^\d+\.\d+\.\d+\.\d+$/.test(ver)) fullVersion = ver;
      }
    } catch (e) { /* abaikan */ }
  }

  let uaNaturalMode = false;
  if (naturalUA && !/HeadlessChrome/i.test(naturalUA)) {
    fp.userAgent = naturalUA; // headed — UA natural engine (reduced format, seperti Chrome asli)
    uaNaturalMode = true;
  } else if (fullVersion && fp.userAgent) {
    // headless / CDP UA tak tersedia — UA sintetis fp, major disamakan dgn binary
    fp.userAgent = stealth.alignUaVersion(fp.userAgent, fullVersion);
  } else {
    // Fallback terakhir: samakan major saja (perilaku lama).
    try {
      const bObj = context.browser();
      if (bObj && typeof bObj.version === 'function') fp.userAgent = stealth.alignUaVersion(fp.userAgent, bObj.version());
    } catch (e) { /* pakai UA apa adanya */ }
  }

  // Paritas fingerprint (opsi 2): spoof canvas/audio/rects/hardware/WebGL per akun.
  // Konfig ditetapkan SEKALI lalu tersimpan di accounts.fingerprint_json — nilai
  // sama di setiap sesi, berbeda antar akun. Yang dipasang HANYA permukaan
  // fingerprint; patch webdriver tetap milik patchright (aturan patchright).
  let spoofCfg = null;
  try {
    spoofCfg = await stealth.ensureSpoofConfig(account);
    await context.addInitScript(stealth.spoofInitScript(spoofCfg));
  } catch (e) {
    console.log(`  [stealth] spoof fingerprint ${account.name || account.id} gagal dipasang: ${e.message}`);
  }

  // TANPA init script stealth manual — patchright menangani webdriver/runtime-leak
  // di level engine; menumpuk patch buatan bisa melemahkan patch internalnya.
  // Hardening CDP per page: UA natural → cukup Accept-Language (platform/userAgentData
  // dibiarkan ASLI engine = koherensi penuh); UA sintetis (headless/fallback) → override
  // metadata penuh seperti sebelumnya.
  context.on('page', (page) => {
    stealth.attachPageHardening(context, page, fp, uaNaturalMode ? { langOnly: true } : {}).catch(() => {});
  });

  // Catat exit IP ke ip_history (async, tak menahan pembukaan browser).
  recordIpProbe(context, account).catch(() => {});

  // Detail profil Chrome (untuk panel — biar operator tahu Chrome ini TIDAK sama
  // dgn Chrome lain; nilai diambil SATU sumber: variabel yang benar-benar dipakai
  // di context ini, bukan tebakan dari DB).
  const profile = {
    ua_mode: uaNaturalMode ? 'natural-engine' : 'sintetis-geo',
    user_agent: fp.userAgent,
    viewport: `${vp[0] || 1366}x${vp[1] || 768}`,
    locale: (fp && fp.locale) || account.locale || 'id-ID',
    languages: (fp && fp.languages) || ['id-ID'],
    timezone: (fp && fp.timezoneId) || account.timezone || 'Asia/Jakarta',
    geolocation: geoOpt ? { latitude: geoOpt.latitude, longitude: geoOpt.longitude } : null,
    proxy: stickyProxy(account.proxy, account.name) || null,
    profile_dir: account.browser_profile_dir || null,
    spoof: spoofCfg ? {
      canvas_seed: '0x' + spoofCfg.canvasSeed.toString(16),
      audio_seed: '0x' + spoofCfg.audioSeed.toString(16),
      rect_seed: '0x' + spoofCfg.rectSeed.toString(16),
      hardware: `${spoofCfg.hardwareConcurrency} core / ${spoofCfg.deviceMemory} GB`,
      webgl: `${spoofCfg.webgl.vendor} — ${spoofCfg.webgl.renderer}`,
    } : null,
  };

  return { context, browser: context.browser(), profile };
}

function parseProxy(proxyStr) {
  if (!proxyStr) return undefined;
  const [host, port, username, password] = proxyStr.split(':');
  return { server: `${host}:${port}`, username: username || undefined, password: password || undefined };
}

// Probe exit IP VIA PROXY BROWSER (bukan dari server) — hasil = IP yang benar-benar
// dipakai akun, via context.request yang mewarisi proxy context, ke ipwho.is.
// Gagal tak menjatuhkan apa pun — hanya console.log; kalau ada account_id, kegagalan
// dicatat ke ip_history (ok=0) supaya monitoring kelihatan.
async function recordIpProbe(context, account) {
  const accId = account && account.id;
  const source = (account && account._probeSource) || 'open';
  try {
    let data = null, threw = null;
    if (context && context.request) {
      try {
        const res = await context.request.get('https://ipwho.is/', { timeout: 12000 });
        data = await res.json().catch(() => null);
        if (!data || !data.ip) threw = 'respon ipwho.is tidak valid';
      } catch (e) { threw = e.message; }
    } else threw = 'context.request tidak tersedia';
    if (!data || !data.ip) {
      console.log(`[ip-probe] ${account ? account.name : '?'} gagal: ${threw || 'tidak diketahui'}`);
      if (accId) {
        try { await require('./db').addIpHistory(accId, { source, ok: 0, error: String(threw || 'gagal').slice(0, 180) }); } catch (e) { /* abaikan */ }
      }
      return null;
    }
    const rec = {
      ip: data.ip, country: data.country || null, country_code: data.country_code || null,
      city: data.city || null, asn: data.connection && data.connection.asn ? String(data.connection.asn) : null,
      source, ok: 1,
    };
    if (accId) {
      try { await require('./db').addIpHistory(accId, rec); } catch (e) { /* abaikan */ }
    }
    const loc = [rec.city, rec.country_code].filter(Boolean).join(', ');
    console.log(`[ip-probe] ${account ? account.name : '?'}: ${rec.ip}${loc ? ` (${loc})` : ''} [${source}]`);
    return rec;
  } catch (e) { console.log('[ip-probe] error:', e.message); return null; }
}

module.exports = { openAccountBrowser, typeHuman, humanDelay, rand, parseProxy, stickyProxy, recordIpProbe };
