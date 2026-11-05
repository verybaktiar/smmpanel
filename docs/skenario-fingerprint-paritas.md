# Skenario: Paritas Fingerprint ala AdsPower (Opsi 2)

Status: SIAP DIIMPLEMENTASI. Bagian dari rencana fase 4 (lapisan profil sosmed, executor HP vs Profil Chrome PC). Dokumen ini mengunci keputusan, bukan tutorial.

## Latar

AdsPower menang karena spoofing dilakukan di level kernel browser (SunBrowser): Canvas, WebGL, AudioContext, font, ClientRects, hardware, semuanya konsisten per profil. Stack kita (patchright + stealth.js) baru menutup lapisan otomasi (webdriver, kebocoran runtime CDP) dan menyamarkan vendor WebGL secara statis. Celah utamanya:

1. Canvas 2D dan WebGL image belum di-spoof: hash-nya identik untuk semua akun.
2. AudioContext belum di-spoof.
3. ClientRects (getBoundingClientRect) belum diberi noise.
4. Semua akun desktop melaporkan hardwareConcurrency 8 dan deviceMemory 8 yang persis sama, plus pasangan WebGL "Intel Inc. / Intel Iris OpenGL Engine" yang sama persis. Akun-akun jadi bisa saling ditautkan (sinyal clustering).
5. Konfig spoof tidak tersimpan di DB, jadi tidak ada jaminan konsistensi antar sesi.

## Prinsip

- Konsistensi > keacakan: konfig spoof akun ditetapkan SEKALI (deterministik dari account.id), disimpan di DB, dipakai selamanya. Persis pola fingerprint UA/viewport/locale yang sudah ada.
- Bukan pengganti patchright: spoof ini menutup permukaan fingerprint (canvas/audio/hardware/webgl), bukan lapisan otomasi. Aturan patchright tetap: JANGAN menambah patch webdriver buatan, biarkan engine menangani.
- Koherensi: nilai spoof harus cocok satu sama lain dan dengan UA (platform desktop = GPU desktop, Android = GPU ARM).

## Desain

### 1. Modul baru: src/fingerprint-spoof.js

- `spoofConfigFor(account)`: menghasilkan konfig deterministik dari seed account.id:
  - hardwareConcurrency: dari pool [4, 6, 8, 12, 16]
  - deviceMemory: dari pool [4, 8]
  - webgl: pasangan vendor + renderer dari pool desktop (variasi Intel/AMD/NVIDIA) atau Android (variasi Mali/Adreno) sesuai UA
  - canvasSeed, audioSeed, rectSeed: angka seed untuk PRNG mulberry32 di dalam halaman
- `spoofInitScript(cfg)`: string JS init script yang:
  - Override hardwareConcurrency, deviceMemory dari cfg.
  - Canvas 2D: noise deterministik berbasis seed pada hasil getImageData, dan toDataURL/toBlob dirutekan lewat salinan canvas dengan noise (hash toDataURL dan getImageData tetap konsisten satu sama lain).
  - WebGL: parameter UNMASKED_VENDOR_WEBGL/UNMASKED_RENDERER_WEBGL dari cfg (pola yang sudah ada di stealth.js, kini per akun).
  - AudioContext: noise kecil deterministik pada getChannelData (AudioBuffer) dan getFloatFrequencyData (AnalyserNode).
  - ClientRects: offset kecil deterministik pada getBoundingClientRect/getClientRects.
  - Semua override menyamarkan Function.toString seperti pola makeNative yang sudah ada.
- Font enumeration sengaja TIDAK di-spoof pada tahap ini: risiko inkonsistensi render vs daftar font lebih besar daripada manfaatnya. Dicatat sebagai out of scope.

### 2. Perubahan src/stealth.js

- Placeholder __WEBGL_VENDOR__, __WEBGL_RENDERER__, __HWC__, __DMEM__ diisi dari cfg spoof, bukan nilai statis.
- attachStealth / attachStealthMobile menerima opts.spoof; bila tidak ada, cfg diturunkan dari hash fp (perilaku lama tidak rusak, tapi jalur lama otomatis ikut dapat spoof canvas/audio).
- ensureAccountFingerprint: memuat/menyimpan fingerprint_json.

### 3. Perubahan src/db.js

- Migrasi kolom baru accounts.fingerprint_json (TEXT), pola sama dengan migrasi kolom lain.

### 4. Perubahan src/browser.js (jalur panel)

- openAccountBrowser: memuat konfig spoof dari account.fingerprint_json (atau membuat dan menyimpan sekali), lalu memasang spoof init script via context.addInitScript SEBELUM halaman dibuat.
- Yang dipasang hanya permukaan fingerprint (canvas/audio/hardware/webgl/rects). TIDAK ada patch webdriver buatan (aturan patchright).

### 5. Pengujian

- test-fingerprint-spoof.js: buka Chromium patchright headless lokal (tanpa proxy), bandingkan hasil probe dengan dan tanpa spoof: hash canvas, hash audio, vendor/renderer WebGL, hardwareConcurrency, deviceMemory, offset ClientRects.
- Lulus bila: dua sesi spoof dengan cfg sama menghasilkan hash IDENTIK (konsisten), dan dua cfg berbeda menghasilkan hash BERBEDA (terpisah antar akun), dan visual canvas tidak rusak.

## Batasan yang diakui terbuka

- Ini bukan kernel patch: situs dengan deteksi lanjutan (mis. pengukuran timing sinyal, offscreen canvas worker) masih bisa menemukan celah. Opsi AdsPower (opsi 1) tetap dibuka bila opsi 2 gagal di lapangan.
- Font enumeration belum ditutup.
- WebRTC sudah tertutup lapisan lain (anti-leak STUN di stealth.js + flag launch); tidak diubah di sini.
