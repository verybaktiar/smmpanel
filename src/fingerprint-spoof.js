'use strict';
// FINGERPRINT SPOOF (opsi 2) — paritas ala AdsPower pada stack sendiri.
// Menutup permukaan fingerprint yang belum ditangani patchright:
//   canvas 2D + WebGL image, AudioContext, ClientRects, hardware, vendor WebGL.
// Prinsip: konfig DETERMINISTIK per akun (seed dari account.id + email), ditetapkan
// sekali lalu dipakai selamanya (konsistensi > keacakan). Noise yang dihasilkan
// stabil antar sesi, dan berbeda antar akun, sehingga akun tidak bisa ditautkan
// lewat hash canvas/audio yang identik.
//
// Ini BUKAN pengganti patchright: lapisan otomasi (webdriver, runtime CDP) tetap
// milik engine. Jangan menambahkan patch webdriver di sini (aturan patchright).
//
// Font enumeration sengaja belum di-spoof (lihat docs/skenario-fingerprint-paritas.md).

// PRNG deterministik (mulberry32) — versi Node dan versi halaman harus identik.
function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(s) {
  let h = 5381;
  const str = String(s || '');
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
  return h >>> 0;
}

// Pool nilai hardware. deviceMemory memang dibatasi Chrome maksimal 8.
const HWC_POOL = [4, 6, 8, 12, 16];
const DMEM_POOL = [4, 8];

// Pasangan WebGL realistis per platform. Format Windows memakai bentuk ANGLE yang
// benar-benar dilaporkan Chrome; Mac selalu "Apple GPU"; Android sesuai GPU umum.
const WEBGL_POOL = {
  win: [
    { vendor: 'Google Inc. (Intel)', renderer: 'ANGLE (Intel, Intel(R) UHD Graphics 620 (0x00003EA0) Direct3D11 vs_5_0 ps_5_0, D3D11)' },
    { vendor: 'Google Inc. (Intel)', renderer: 'ANGLE (Intel, Intel(R) Iris(R) Xe Graphics (0x00009A49) Direct3D11 vs_5_0 ps_5_0, D3D11)' },
    { vendor: 'Google Inc. (AMD)', renderer: 'ANGLE (AMD, AMD Radeon(TM) Graphics (0x0000164E) Direct3D11 vs_5_0 ps_5_0, D3D11)' },
    { vendor: 'Google Inc. (NVIDIA)', renderer: 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1650 (0x00001F82) Direct3D11 vs_5_0 ps_5_0, D3D11)' },
  ],
  mac: [{ vendor: 'Apple Inc.', renderer: 'Apple GPU' }],
  linux: [
    { vendor: 'Mesa/X.org', renderer: 'llvmpipe (LLVM 15.0.7, 256 bits)' },
    { vendor: 'Intel Open Source Technology Center', renderer: 'Mesa DRI. Intel(R) UHD Graphics 620 (Kaby Lake GT2)' },
  ],
  android: [
    { vendor: 'Qualcomm', renderer: 'Adreno (TM) 730' },
    { vendor: 'Qualcomm', renderer: 'Adreno (TM) 660' },
    { vendor: 'ARM', renderer: 'Mali-G710' },
  ],
};

function platformKeyFromUA(ua) {
  const u = String(ua || '');
  if (/Android/i.test(u)) return 'android';
  if (/Macintosh/i.test(u)) return 'mac';
  if (/Linux/i.test(u)) return 'linux';
  return 'win';
}

function pick(list, rnd) {
  return list[Math.floor(rnd() * list.length) % list.length];
}

// Konfig deterministik untuk sebuah akun. account minimal: { id, name/email, user_agent }.
function spoofConfigFor(account) {
  const id = Number(account && account.id) || 0;
  const identity = `${id}|${(account && account.name) || ''}|${(account && account.email) || ''}`;
  const rnd = mulberry32(hashString(identity));
  const ua = String((account && account.user_agent) || '');
  const key = platformKeyFromUA(ua);
  return {
    v: 1,
    hardwareConcurrency: pick(HWC_POOL, rnd),
    deviceMemory: pick(DMEM_POOL, rnd),
    webgl: pick(WEBGL_POOL[key], rnd),
    canvasSeed: Math.floor(rnd() * 0xffffffff) >>> 0,
    audioSeed: Math.floor(rnd() * 0xffffffff) >>> 0,
    rectSeed: Math.floor(rnd() * 0xffffffff) >>> 0,
  };
}

// Jalur lama (creator IG/TikTok/FB) hanya punya fp, bukan account row:
// seed diturunkan dari UA + viewport supaya tetap stabil per fingerprint.
function spoofFromFp(fp) {
  return spoofConfigFor({ id: 0, name: `${(fp && fp.userAgent) || ''}|${(fp && fp.viewport) || ''}` });
}

// ==== INIT SCRIPT HALAMAN ====
// Default: SKRIP LENGKAP KECUALI AUDIO (paritas AdsPower, dibedah CDP 2026-10-08:
// AdsPower membiarkan audio ASLI karena wrapper getChannelData tertangkap detektor
// GLITCH creepjs; tanpa patch audio, creepjs 0% stealth, hash sama dgn AdsPower).
// includeAudio=true memakai perilaku lama (noise audio) bila dibutuhkan jalur khusus.
// includeHardwareWebgl=false hanya utk stealth.js jalur lama: hardware + vendor
// WebGL sudah dioverride INIT_SCRIPT utamanya, jadi cukup canvas/audio/rects di sini.
const SPOOF_SCRIPT = `
(() => {
  const cfg = __SPOOF_CFG__;
  const makeNative = (fn, name) => {
    try {
      Object.defineProperty(fn, 'name', { value: name, configurable: true });
      fn.toString = () => 'function ' + name + '() { [native code] }';
    } catch (e) {}
    return fn;
  };
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hashStr(s) {
    let h = 5381;
    s = String(s || '');
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
    return h >>> 0;
  }

  // 1) hardware
  try { Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => cfg.hardwareConcurrency, configurable: true }); } catch (e) {}
  try { Object.defineProperty(navigator, 'deviceMemory', { get: () => cfg.deviceMemory, configurable: true }); } catch (e) {}

  // 2) WebGL vendor/renderer (UNMASKED)
  try {
    const VENDOR = cfg.webgl.vendor;
    const RENDERER = cfg.webgl.renderer;
    const hookGetParameter = (proto) => {
      const orig = proto.getParameter;
      proto.getParameter = makeNative(function (param) {
        try {
          if (param === 37445) return VENDOR;
          if (param === 37446) return RENDERER;
        } catch (e) {}
        return orig.call(this, param);
      }, 'getParameter');
    };
    if (window.WebGLRenderingContext) hookGetParameter(WebGLRenderingContext.prototype);
    if (window.WebGL2RenderingContext) hookGetParameter(WebGL2RenderingContext.prototype);
  } catch (e) {}

  // 3) canvas: noise LSB channel merah, deterministik dari seed + ukuran canvas.
  // Perubahan +-1 di 6% piksel tak terlihat mata tapi mengubah hash canvas.
  try {
    const noiseImageData = (img, seedKey) => {
      try {
        const rnd = mulberry32((cfg.canvasSeed ^ (seedKey >>> 0)) >>> 0);
        const d = img.data;
        for (let i = 0; i < d.length; i += 4) {
          if (rnd() < 0.06) d[i] = d[i] ^ 1;
        }
      } catch (e) {}
      return img;
    };
    const sizeKey = (w, h) => ((w * 3163) ^ (h * 21767)) >>> 0;
    const origGetImageData = CanvasRenderingContext2D.prototype.getImageData;
    CanvasRenderingContext2D.prototype.getImageData = makeNative(function (sx, sy, sw, sh) {
      const img = origGetImageData.call(this, sx, sy, sw, sh);
      return noiseImageData(img, sizeKey(sw, sh));
    }, 'getImageData');

    const copy2dNoised = (canvas) => {
      const ctx = canvas.getContext('2d');
      if (!ctx || canvas.width < 1 || canvas.height < 1) return null;
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const copy = document.createElement('canvas');
      copy.width = canvas.width;
      copy.height = canvas.height;
      copy.getContext('2d').putImageData(img, 0, 0);
      return copy;
    };
    const glNoisedCopy = (canvas, glCtx) => {
      const w = canvas.width, h = canvas.height;
      if (w < 1 || h < 1) return null;
      const px = new Uint8Array(w * h * 4);
      glCtx.readPixels(0, 0, w, h, glCtx.RGBA, glCtx.UNSIGNED_BYTE, px);
      const img = noiseImageData(new ImageData(new Uint8ClampedArray(px.buffer), w, h), sizeKey(w, h));
      const copy = document.createElement('canvas');
      copy.width = w;
      copy.height = h;
      copy.getContext('2d').putImageData(img, 0, 0);
      return copy;
    };
    const routedCanvas = (canvas) => {
      const glCtx = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
      if (glCtx) return glNoisedCopy(canvas, glCtx);
      return copy2dNoised(canvas);
    };

    const origToDataURL = HTMLCanvasElement.prototype.toDataURL;
    HTMLCanvasElement.prototype.toDataURL = makeNative(function (...args) {
      try {
        const copy = routedCanvas(this);
        if (copy) return origToDataURL.apply(copy, args);
      } catch (e) {}
      return origToDataURL.apply(this, args);
    }, 'toDataURL');

    const origToBlob = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = makeNative(function (cb, type, q) {
      try {
        const copy = routedCanvas(this);
        if (copy) return origToBlob.call(copy, cb, type, q);
      } catch (e) {}
      return origToBlob.call(this, cb, type, q);
    }, 'toBlob');
  } catch (e) {}

  // 4) AudioContext: noise kecil deterministik per buffer (cache per buffer+channel
  // supaya nilai hash stabil walau getChannelData dipanggil berulang).
  try {
    const noiseCache = new WeakMap();
    const origGetChannelData = AudioBuffer.prototype.getChannelData;
    AudioBuffer.prototype.getChannelData = makeNative(function (ch) {
      const buf = origGetChannelData.call(this, ch);
      try {
        let perBuf = noiseCache.get(this);
        if (!perBuf) { perBuf = {}; noiseCache.set(this, perBuf); }
        if (!perBuf[ch]) {
          const copy = new Float32Array(buf);
          const rnd = mulberry32((cfg.audioSeed ^ ((this.length | 0) ^ (ch * 9176)) ) >>> 0);
          for (let i = 0; i < copy.length; i += 500) copy[i] += (rnd() - 0.5) * 1e-7;
          perBuf[ch] = copy;
        }
        return perBuf[ch];
      } catch (e) { return buf; }
    }, 'getChannelData');
    const origGetFloatFreq = AnalyserNode.prototype.getFloatFrequencyData;
    AnalyserNode.prototype.getFloatFrequencyData = makeNative(function (arr) {
      origGetFloatFreq.call(this, arr);
      try {
        const rnd = mulberry32((cfg.audioSeed ^ arr.length) >>> 0);
        for (let i = 0; i < arr.length; i++) arr[i] += (rnd() - 0.5) * 0.01;
      } catch (e) {}
      return;
    }, 'getFloatFrequencyData');
  } catch (e) {}

  // 5) ClientRects: offset sub-piksel deterministik (tak mengubah klik, mengubah
  // hash geometri yang dipakai detektor font/plugin).
  try {
    const jitterRect = (r, el) => {
      const cls = el && el.className && el.className.toString ? el.className.toString() : '';
      const rnd = mulberry32((cfg.rectSeed ^ hashStr((el && el.tagName) + '|' + (el && el.id) + '|' + cls)) >>> 0);
      const j = () => (rnd() - 0.5) * 0.0002;
      return new DOMRect(r.x + j(), r.y + j(), r.width + j(), r.height + j());
    };
    const origGBCR = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = makeNative(function () {
      return jitterRect(origGBCR.call(this), this);
    }, 'getBoundingClientRect');
    const origGCRs = Element.prototype.getClientRects;
    Element.prototype.getClientRects = makeNative(function () {
      const list = origGCRs.call(this);
      try {
        const out = [];
        for (const r of list) out.push(jitterRect(r, this));
        out.item = (i) => out[i] || null;
        return out;
      } catch (e) { return list; }
    }, 'getClientRects');
  } catch (e) {}
})();`;

function initScript(cfg, opts = {}) {
  let script = SPOOF_SCRIPT;
  if (opts.includeHardwareWebgl === false) {
    // Buang blok hardware + WebGL: INIT_SCRIPT stealth.js jalur lama sudah menangani.
    script = script
      .replace(/ {2}\/\/ 1\) hardware[\s\S]*?\/\/ 2\) WebGL/, '  // 2) WebGL')
      .replace(/ {2}\/\/ 2\) WebGL[\s\S]*?} catch \(e\) \{\}\n\n  \/\/ 3\) canvas/, '  // 3) canvas');
  }
  if (opts.includeAudio !== true) {
    // Buang blok audio (default): wrapper getChannelData tertangkap detektor
    // GLITCH creepjs; audio asli = paritas AdsPower = 0% stealth.
    script = script.replace(/ {2}\/\/ 4\) AudioContext[\s\S]*?\/\/ 5\) ClientRects/, '  // 5) ClientRects');
  }
  return script.replace('__SPOOF_CFG__', JSON.stringify(cfg));
}

module.exports = { spoofConfigFor, spoofFromFp, initScript, HWC_POOL, DMEM_POOL, WEBGL_POOL };
