# SYSTEM_AUDIT.md — SMM Panel / Phone Farm (15 Sep 2026)

> Sumber: source aktual `G:/laragon/www/smmpanel`. 143 route API, ~12.8k baris backend,
> 11+ tabel sql.js, 10 cron worker, 17+ halaman React. Prototype berjalan, BUKAN production.

## 1. Arsitektur (kini)

React `:5175` → Express `:3000` (API key global) → sql.js in-memory + file JSON
(sessions, farm-jobs, config, logs). Worker cron proses terpisah. Lapisan baru:
orkestra file-JSON (`farm-jobs/`), sopir HP ADB, warming executor+scheduler.

## 2. Temuan + severity

### P0 Critical
- **P0-1 DB in-memory per proses.** Server dan worker masing-masing pegang DB sendiri;
  tulis lintas proses tak terlihat sampai restart. Restart = risiko kehilangan tulis
  yang belum `save()`. Orkestra sudah menghindar via file JSON — pola yang benar,
  tapi sisa sistem (queue order, warming, sesi) masih di DB.
- **P0-2 Queue order di memory/DB non-persistent.** Restart server/worker di tengah
  order berjalan = order gantung tanpa recovery (pernah 2x hang: port LISTEN tapi
  `000`/timeout, obat manual `taskkill`). Belum ada lease/heartbeat/timeout.
- **P0-3 Tanpa git.** Bukan repo (`fatal: not a git repository`). Tak ada versioning,
  rollback, atau jejak perubahan selain backup 1,7 GB.
- **P0-4 Kredensial plaintext.** `.env` berisi API key, Ammail key, proxy user:pass,
  password akun; session cookie JSON plaintext; password akun IG pernah di chat.

### P1 High
- **P1-1 Satu API key global**, tanpa role. Semua endpoint (termasuk hapus/restore/backup,
  rotate proxy, kill job) terbuka bagi siapa pun pemegang key. Tanpa RBAC, tanpa audit log.
- **P1-2 Rate limit dimatikan** (`DISABLE_RATE_LIMIT=1`) — wajib hidup di VPS publik.
- **P1-3 Device tanpa registry/heartbeat.** `listDevices` = hasil `adb devices` sesaat;
  device hilang di tengah job hanya ketahuan saat aksi gagal. Kabel goyang terbukti
  3x putus dalam 1 sesi. Tanpa lock resmi selain file job (itu sudah benar, tapi
  tanpa timeout/orphan recovery).
- **P1-4 Backup tanpa manifest/checksum/retention/uji restore.** 1,7 GB tanpa daftar isi;
  validitas tak pernah dibuktikan via restore.
- **P1-5 Logging = console.log.** Tanpa level, tanpa correlation ID (job→worker→device
  tak bisa ditelusuri satu insiden), tanpa agregasi.
- **P1-6 Duplikat route** (`/api/proxy/rotate/:accountId` 2x) — satu tak terpakai/menimpa.

### P2 Medium
- **P2-1 Farm-job file-JSON tanpa lock tulis** (race bila 2 penulis bersamaan), tanpa
  retry/timeout/heartbeat — cukup untuk 1 HP, kurang untuk 10 HP.
- **P2-2 Tabel `table-wrap` scroll hanya per-halaman** (ditambal di Warming/Accounts,
  belum global). `min-width:0` di `.main` sudah perbaiki global.
- **P2-3 Halaman AI Content, Captcha, Notifications, TikTok Hub belum diaudit.**
- **P2-4 Tanpa API versioning** (`/api/` langsung), tanpa health endpoint mesin
  (`/api/system/status` ada tapi bukan standar health).
- **P2-5 Tanpa test suite** (`test-*.js` = skrip manual, bukan assert). Tanpa staging env.
- **P2-6 Config tersebar**: `.env` + JSON config + konstanta kode (cooldown 24 jam di
  2 tempat: orchestra + aturan dokumen).

### P3 Low
- **P3-1 File audit `*.png` + arsip menumpuk di root project** (puluhan file).
- **P3-2 `.env.example` ada** — perlu sinkronisasi tiap tambah variabel (ADB_PATH baru
  belum masuk contoh).
- **P3-3 Magic numbers**: jeda warming, retry OTP 20x15 dtk, batas log — pindah ke config.

## 3. Yang sudah benar (pertahankan)

- Orkestra file-JSON lintas proses; 1 HP = 1 job; cooldown per device; lapor langkah.
- Fail-safe sopir (gagal cepat + lapor, tanpa progres karangan); guard birthday.
- Warming + gerbang Setujui; default MATI + dry-run; persenjataan berkonfirmasi.
- Proxy disamarkan di panel; sesi per-platform terpisah; backup auto 04:00.
- Antislop UI + verifikasi nol-error per halaman.

## 4. Rencana perbaikan (sesuai master prompt, bertahap)

1. Backup pra-migrasi (berjalan) → 2. PostgreSQL + migrasi aman (dual-write, sql.js
   tetap sampai data terverifikasi) → 3. Queue persistent + lease → 4. Watchdog worker →
   5. Device registry + heartbeat → 6. Security (RBAC bertahap: key baca vs tulis dulu,
   lalu role) → 7. Logging terstruktur + audit → 8. Backup manifest + restore test →
   9. Monitoring + Incident → 10. Farm Core refactor → 11. Docs + tests → 12. Staging.
2. Aturan main: tiap phase = bukti (file berubah, API berubah, tes + hasil, known issues).
   Target yang butuh keputusan user ditandai BLOCKED — REQUIRES USER INPUT.
