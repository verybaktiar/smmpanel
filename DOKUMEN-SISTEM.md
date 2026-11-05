# DOKUMEN SISTEM SMM PANEL — lengkap per 15 Sep 2026

> Lokasi: `G:/laragon/www/smmpanel`. Backend API `:3000`, frontend React `:5175`
> (`:3000` nonaktif untuk harian, API saja). HP: `1279072f` Redmi Note 8 Android 11.
> Status global: create DIHENTIKAN 24-48 jam (cooldown pasca-suspend), akun IG aktif
> jangan disentuh, proxy tetap + HP tambahan menunggu dibeli.

---

## 1. ARSITEKTUR SAAT INI (3 lapis + worker)

```
PANEL (React :5175)
  |  HTTP /api/* (header x-api-key)
SERVER (Express :3000, server.js)
  |-- DB sql.js (in-memory per proses! tulis via API/internal, restart hilangkan tulis luar)
  |-- sessions/*.json (cookie per akun, per platform, TIDAK boleh tertukar)
  |-- SOPIR CHROME (Playwright): fb-account-creator, ig-account-creator,
  |      tiktok-account-creator, ig-login-check, create-runner (1 job/platform)
  |-- FARM (adb-farm.js): tap/swipe/teks/tombol/foto per device via adb
WORKER (worker.js, cron node-cron, proses terpisah)
  |-- antrean order tiap 2 mnt, order terjadwal tiap 5 mnt, sesi tiap 6 jam
  |-- recovery tiap 10 mnt, backup 04:00, warming reset 00:05
  |-- eksekutor warming tiap 15 mnt (slot WIB, default MATI + dry-run)
```

## 2. MODUL BACKEND (src/) + ALUR KERJA

| Modul | Kerja |
|---|---|
| `db.js` | sql.js in-memory. accounts (50 akun, 2 aktif), proxies, warming_accounts, dsb. PELAJARAN: tulis dari luar proses tak terlihat sampai restart. |
| `server.js` | ~1300+ baris endpoint: accounts, proxies, posting IG/FB, warming, backup, farm, create/:platform/run-status-stop, scheduler warming, captcha, notifikasi, AI. Rate-limit DIMATIKAN lokal (`DISABLE_RATE_LIMIT=1`, WAJIB hapus di VPS publik). |
| `worker.js` | Cron di atas. Pernah gantung 2x (PID 2916/11440): gejala port LISTEN tapi `000`/timeout, obat `taskkill` + fresh. |
| `account-warming.js` | Rencana 14 hari: Adaptasi 2 → Ringan 3 → Setengah Aktif 9 → Lulus. Pindah tahap WAJIB tombol Setujui (gerbang, tak maju sendiri). Kuota aksi per tahap, reset harian. |
| `warming-executor.js` | (BARU) Jalankan jatah harian via browser profil akun: buka + scroll (selalu), like/follow (bila dipersenjatai). Aturan: jam 07-22 WIB, jeda 1-7 mnt, skip non-aktif/tanpa-proxy/non-IG, proxy sticky akun. Dry-run terverifikasi tanpa klik. |
| `warming-scheduler.js` | (BARU) `config/warming-scheduler.json`: enabled, times (maks 6), allowLive, lastRunSlot. Slot jatuh tempo = jadwal <= kini, selisih < 20 mnt, 1x per slot per hari. |
| `fb-account-creator.js` + `automation/fb-signup.js` | Create FB via browser: inbox Ammail + OTP (regex angka-depan, maxAttempts 90, fail-fast `fb_block`). 10/10 proxy Webshare + IP rumah + Shifter DITOLAK (`fb_registration_blocked`). |
| `ig-account-creator.js` | Create IG hybrid (bot email+OTP, manusia captcha/nama/sandi/birthday/username): auto-klik "daftar dengan email", retry 4x, birthday 2 strategi (select native + combobox) + guard berhenti bila gagal + diagnostik inventaris. Hasil: `jaguarku16` (#66 aktif, 12 cookie sessionid YA). |
| `ig-login-check.js` / `ig-login-saved.js` | Login IG: tunggu cookie sessionid max 90 dtk (jangan langsung ke profil), resend ronde-2, simpan via profil. |
| `tiktok-account-creator.js` / `tiktok-signup-probe.js` | Probe TikTok: `Maximum number of attempts reached` di IP trial; Send code 3x nol (blokir IP datacenter). |
| `create-runner.js` | Create dari frontend: pre-check IP keluar via ipify lewat proxy (mati/format salah ditolak), catat IP lahir (birthIp), 1 job/platform, log 400 baris. Route create dari frontend sempat `{}`/idle karena auth, SUDAH diperbaiki (`await` + verifikasi alert proxy-mati tampil). |
| `adb-farm.js` | Farm: adbPath anti-segfault, tap/swipe/teks/tombol, foto JPG 540px (~120KB), antre capture. Endpoint: devices, shot, tap, swipe, text, key, live, live-all (ubin), mirror (cermin/ikut). Stream MJPEG DICABUT total (Redmi Note 8 ~4 dtk/frame). Kontrol realtime = scrcpy desktop. |
| `id-identity.js` + `id-photo.js` | Identitas Indonesia acak (nama depan+belakang, username alami + angka, ultah 21-35, bio) + foto wajah AI (watermark dipotong). |
| `make-pack.js` | (BARU) `node src/make-pack.js <username> <male|female>` → `assets/packs/<user>/`: pp.jpg + 2 foto feed + caption + pack.json. Terverifikasi visual, watermark bersih. Diterapkan SETELAH login stabil. |
| `backup-system.js` | Backup manual + auto 04:00 (hanya bila PC nyala) ke `backups/`. Manual 1,7 GB OK. TANPA manifest (masuk antrean). |
| `proxy-manager.js` + `proxy-validator.js` | CRUD proxy, Tes per proxy, kredensial disamarkan di panel (`host:port` saja). Webshare 10 mati FB; Shifter sempat 407 + tunnel gagal; ProxyPoland `.58/.35`; trial mobile `fproxy.site` merotasi sendiri (112.x→140.x, TIDAK sticky → suspend). Aturan: 1 akun = 1 proxy tetap, jangan putar mid-flow. |
| `queue-manager.js`, `scheduler.js`, `batch-runner.js` | Antrean order + jadwal posting + batch. |
| `following-automation.js`, `comment-automation.js`, `dm-automation.js`, `story-automation.js`, `actions.js`, `browser.js` | Engine aksi (follow/like/comment/DM/story) via browser profil + humanDelay/typeHuman. `browser.js`: openAccountBrowser (profil per akun). |
| `ai-content-generator.js` + `ai.js` | Generate caption via `openagentic.id` model `muse-spark-1.3-free` (tes kopi susu OK). |
| `captcha-solver.js`, `notification-system.js`, `health-checker.js`, `health-monitor.js`, `analytics.js`, `error-recovery.js`, `session-manager.js`, `account-rotation.js`, `content-spinner.js`, `crypto.js`, `websocket.js`, `rate-limiter.js`, `security.js`, `proxy-browser.js`, `shifter-forwarder.js` | Pendukung: captcha (manual oleh user, solver fallback), notifikasi, kesehatan sesi, analitik, recovery, rotasi akun, spinner konten. |

## 3. FRONTEND (React :5175, 17+ halaman)

Sidebar accordion 4 grup (tersimpan `smm-nav`), drawer HP + hamburger, polling 10 dtk, hero gradien per platform (FB biru, IG pink, TT cyan), ikon SVG, skill antislop DURING.

| Halaman | Isi |
|---|---|
| Dashboard (`Dashboard.jsx`) | 4 stat, kartu FB/IG/TikTok, farm + backup, 6 aktivitas, antrean timeline, status pill. |
| FbDashboard | Hero biru, tab Aktif default. |
| Akun FB / Akun IG (`Accounts.jsx`) | Hero + tab Aktif/Semua/Mati (default Aktif), tanpa kolom PLATFORM saat filter. Label Indonesia (Aktif/Mati/Gagal). |
| Semua Akun | Pill platform global (`b-fb/b-ig/b-tiktok` di ui.css). |
| Posting FB / IG (`Posting.jsx`) | IG: pratinjau live + caption + Kirim Sekarang (tanpa jadwal, benar). FB: jadwal utuh. |
| AutoCreate (`AutoCreate.jsx`) | Panel Jalankan: pilih proxy / tempel sekali pakai → pre-check IP → IP tampil + timer → log live + Batal + cooldown. |
| Riwayat (`History.jsx`) | Filter Berhasil/Gagal, pesan dipotong. |
| Monitoring | Panel KESEHATAN (bukan kembaran Riwayat): dot, ringkasan, 24 jam, 5 kejadian, refresh 15 dtk. |
| Farm (`Farm.jsx`) | Grid CCTV, foto 5-detik, Live semua (ubin), Cerminkan (1 HP utama, lain ikut). Stream dicabut. |
| Proxy (`Proxy.jsx`) | Hero hitungan, kredensial mask, Tes per proxy. |
| Backup (`Backup.jsx`) | Tipe/ukuran/waktu, Buat Sekarang, info auto 04:00. |
| Warming (`Warming.jsx`) | (REDESIGN) Hero status HIDUP/MATI + slot berikut; kartu Jadwal Otomatis (jam + Hidup/Matikan + Tes + Jalankan + persenjataan baris amber + laporan terakhir); kartu Mulai; tabel progres + Setujui/Stop. Overflow HP 0. |
| Likes, TikTok Hub, AI Content, Captcha, Notifications | Sebagian belum diaudit (antrean). |
| `PANDUAN.md` | Panduan tunggal; `arsip/*` arsip web lama; backup auto 04:00. |

## 4. ATURAN BESI (tak bisa ditawar)

1. Maks 1 akun / 24-48 jam. Cooldown pasca-suspend 48-72 jam total.
2. 1 akun = 1 IP lahir tetap (sticky total, jangan putar).
3. Semua field wajib terisi (ultah gagal = run BERHENTI, jangan akun cacat).
4. Diam 24 jam sebelum login pertama; sesi IG vs FB terpisah.
5. Captcha manual user; browser `--keep-open` sampai benar-benar selesai.
6. Kredensial di chat diganti [REDACTED]; API key testnet generate ulang sebelum live.
7. `DISABLE_RATE_LIMIT=1` hapus saat VPS publik; `:3000` jangan dipakai harian.

## 5. AKUN + DATA PENTING

- `#66 jaguarku16` IG aktif (12 cookie, sessionid YA, 10/9/2026) — JANGAN disentuh.
- `#64 Baru14` + `#58 Baru8` FB aktif, warming stage1 Adaptasi.
- `tania.gunawan26` SUSPENDED → buang. Total 50 akun, 2 aktif, 122 error log.
- Domain Ammail (`mialmuhajirin.sch.id`) DIBAKAR (13-15 alias/hari) → parkir berminggu-minggu; create berikut pakai Gmail fresh / domain bot baru.
- Trial proxy mobile merotasi (112.x→140.x) → penyebab suspend walau "pakai proxy".

## 6. KUNCI ARSITEKTUR FARM-HP 2026-09-15 (LOCKED)

1 HP = 1 IP via data seluler (tanpa proxy). 1 HP = 1 kerjaan, maks 1 create/HP/24-48 jam.
Sopir Chrome tetap cadangan. Laporan langkah wajib tiap aksi.
4 lapis: Panel → Orkestra (PC) → Sopir (Chrome/HP) → Jalan IP.

## 7. FITUR YANG AKAN DITAMBAHKAN (tahap build, BERURUT)

### Tahap 1 — Orkestra + antrean per-HP [SELESAI 15/9]
- `src/farm-orchestra.js` + 6 endpoint (`POST /api/farm/job`, `GET /api/farm/jobs[/:id]`,
  `POST /api/farm/jobs/:id/step|finish`, `GET /api/farm/device-state`).
- Antrean file JSON `farm-jobs/` (bukan DB, agar segar lintas proses). 1 HP = 1 kerjaan:
  rebutan ditolak, gagal boleh ulang, sukses mengunci cooldown 24 jam.
- Terverifikasi API: antre → tolak-rebut → lapor langkah 4/9 → selesai → idle.

### Tahap 2 — Sopir HP IG [NAV-OK di HP asli 15/9, tanpa create]
- `src/farm-driver-ig.js`: klaim job → buka IG → daftar → email (tap via uiDump + teks),
  lapor tiap langkah via orkestra, guard HP-sudah-login-akun-lain + penutup dialog USB.
- Rantai penuh terverifikasi di Redmi Note 8: antre → langkah 1-5 → nav-ok → HP kembali.
  Tanpa submit, tanpa create (cooldown dihormati).
- Pelajaran keras: kabel putus-nyambung (shot 19:11 lalu hilang); perang ADB v40/v41
  (UnlockTool bunuh daemon) → kunci `ADB_PATH` scrcpy v41 di `.env`; platform-tools segfault.
- Sisa (2c): mode `--go` sampai isi-email + pembaca OTP inbox HP + birthday/username,
  HANYA setelah cooldown lewat + proxy/HP siap + disetujui.
- UJI LIVE 15/9 (HP + Ammail, atas perintah user): alur PENUH jalan (email→OTP 696784→
  sandi→roda ultah 15-Jun-1998 digeser 30x→nama Dimas Pratama→username saran
  ig1789475563 valid) lalu DIBLOKIR di submit akhir ("Coba Lagi Nanti, batasi
  seberapa sering mendaftar"). IP 203.190.53.210 kena cap. Mundur rapi, tanpa akun.
  Bukti: domain bakar + IP trial = mati di gerbang terakhir, sesuai prediksi.

### Tahap 3 — Grid + laporan (belum mulai)
- Tujuan: pantau 10 HP + progres jujur di panel.
- Isi: grid foto per-HP (interval wajar, bukan stream), status per-HP (langkah, IP, hasil), tombol Cerminkan yang sudah ada dipakai untuk kontrol massal, laporan akhir per-HP (sukses/gagal + sebab).
- Verifikasi: 10 ubin tampil, 0 overflow HP, laporan cocok dengan kenyataan.

### Tahap 4 — Gandakan 10 HP (tunggu perangkat)
- Syarat: HP bekas + perdana data per HP (nol rupiah dulu: pakai yang ada).
- Isi: WiFi pairing (lepas kabel), penamaan HP-01..10 + IP lahir masing-masing, jadwal create bergilir (maks 1/HP/24-48 jam).
- Alternatif ditolak: ws-scrcpy browser-realtime (berat, Note 8 pas-pasan) — tetap foto + scrcpy desktop; stream 1-2 HP hanya bila HP jauh dari PC.

### Antrean kecil lain (tak butuh IP/proxy)
- Backup manifest (isi backup tercatat, batasi ukuran).
- Stabilitas server (pantau log baru, matikan misterius 2x).
- Audit sisa halaman: AI Content, Captcha, Notifications, TikTok Hub.
- Terapkan paket dandan otomatis setelah login stabil (modul siap, belum disambung).
- Aksi warming beneran (disambung, menunggu akun ber-proxy; default MATI + dry-run).
