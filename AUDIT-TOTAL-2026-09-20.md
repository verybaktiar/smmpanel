# AUDIT TOTAL SISTEM — SMM Panel / Phone Farm (20 Sep 2026)

> Auditor: Buffy (Codebuff). Metode: verifikasi ulang seluruh temuan `AUDIT-TOTAL-2026-09-19.md`
> langsung di source + probe runtime (`curl` ke server hidup) + `npm audit`.
> Kondisi saat audit: server :3000 HIDUP (PID 13504), worker HIDUP (PID 11276), Vite :5175 dinyalakan
> selama audit. Skala: 156 endpoint (server.js 1.868 baris, naik dari 1.616), 50 modul src/ (12.772 baris),
> worker 11 cron, frontend React 15 halaman + halaman baru Engagement.

---

## 1. RINGKASAN EKSEKUTIF

Sistem dalam pemakaian lokal tetap **layak dikendarai**. Sejak audit kemarin ada 2 perbaikan nyata
(`rawAll` murni-baca; modul `account-gate.js` sebagai gerbang kebijakan tunggal) dan 1 perbaikan
saat audit ini (proxy `/config.json` di Vite). Lubang kritis **/config.js + /config.json** masih
terbuka dan kini bahkan menjadi bagian desain frontend — jadi status "lokal aman, publik JANGAN"
tetap berlaku.

Insiden operasional hari ini: **3 salinan server.js berjalan paralel** (port 3000, 52406, 54108)
+ 1 worker = 4 penulis `database.db` bersamaan (sql.js full-file save per tulisan) → risiko tulisan
hilang/timpa. Dua duplikat sudah dimatikan; kini 1 server + 1 worker. Pola ini menegaskan perlunya
**kunci single-instance** (lihat rekomendasi #3).

---

## 2. STATUS TEMUAN LAMA (verifikasi langsung di kode, 20 Sep)

### Diperbaiki sejak 19 Sep ✅
- **P2-B1 `rawAll` auto-save** → DIPERBAIKI. `src/db.js:449-452` kini murni `waitReady + query`,
  tanpa `save()`. Kontrak baca/tulis sehat kembali.
- **BARU: `account-gate.js`** — gerbang kebijakan TUNGGAL (status akun + kuota warming + cooldown
  rotasi + limiter) yang dipakai server, queue-manager, dan tiktok-creator. Desain tepat untuk
  masalah "tiga sistem saling bertentangan". Pertahankan dan paksa semua eksekutor lewat sini.

### Masih terbuka (diverifikasi ulang) ❌
- **P0-B1 API key disajikan tanpa auth — MELEBAR.** Selain `/config.js` (server.js:37-39), kini ada
  **`/config.json`** (server.js:41-44) yang dipakai `frontend/src/api.js` (`ensureKey()`) untuk
  mengambil API key. Terbukti live: `curl :3000/config.json` mengembalikan key penuh. Kedua endpoint
  terpasang sebelum middleware `requireApiKey` (yang hanya melindungi `/api/*`).
- **P0-3 tanpa git** — masih. `fatal: not a git repository`. `.gitignore` sudah ada tapi tak dipakai.
- **P0-4 kredensial plaintext** — masih: `.env`, `sessions/*.json`, `database.db` (password_enc),
  dan **`test-import.txt` masih berisi email+password akun nyata** (Play1-3).
- **P1-B1 path traversal backup** — masih. `src/backup-system.js` memakai
  `path.join(this.backupDir, backupName)` di restore/delete TANPA `basename`/resolve-check.
- **P1-B2 file statis bypass API key** — masih. `express.static('public')` tanpa auth;
  `public/farm/1279072f.jpg` (screenshot HP real-time) bisa diambil siapa pun.
- **P1-6 duplikat route rotate** — masih: `server.js:912` (proxyValidator) vs `server.js:1132`
  (proxyManager, dead code di Express 5).
- **P3-B1 api_key via query string** — masih (`src/security.js:75`).
- **P3-B2 dua handler SIGINT di worker** — masih (`worker.js:172` dan `worker.js:261`).
- **P2-B4 `index.js` entry duplikat** — masih, walau sudah disederhanakan (27 baris).
  `start.bat` masih menjalankannya sebagai "Scheduler" padahal worker sudah memuat tugas serupa.

---

## 3. TEMUAN BARU (20 Sep)

### P1-C1 — Vite tidak mem-proxy `/config.json` → panel React 401 total [DITAMBAL hari ini]
`frontend/src/api.js` mengambil key dari `/config.json`, tapi `vite.config.js` hanya mem-proxy
`/api`, `/config.js`, `/farm` → di mode dev, `ensureKey()` 404 diam-diam → semua request tanpa
`X-API-Key` → 401 di seluruh panel. **Sudah diperbaiki** (1 baris proxy `/config.json`) dan
diverifikasi: panel :5175 → `/config.json` → `/api/stats` 200 dengan data nyata.
Sisa pekerjaan: pola "frontend ambil key dari endpoint publik" tetap harus diganti total sebelum
publik (lihat rekomendasi #2).

### P1-C2 — Multi-instance server: 3× server.js paralel [INSIDEN, ditangani]
Ditemukan 3 salinan server.js hidup (port 3000, 52406, 54108 — dua di antaranya memilih port acak)
+ worker = 4 proses menulis `database.db` yang sama. Karena `save()` menulis file penuh dari
snapshot memori masing-masing proses, tulisan antar-proses saling menimpa → cooldown/status/order
bisa lenyap (berbahaya bagi aturan besi 1-akun-1-IP & cooldown). Dua duplikat dimatikan (Stop-Process
4916 & 13328); kini 1 server (:3000) + 1 worker, kesehatan terverifikasi.
**Obat struktural**: kunci single-instance — mis. lockfile + `process.kill(pid,0)` saat startup
server.js/worker.js, atau paksa `listen` lebih dulu (gagal cepat bila port dipakai) sebelum init DB.

### P2-C1 — 2 kerentanan dependensi (npm audit)
- **multer — HIGH**: DoS via oversized array index pada field name (dipakai untuk upload media).
- **qs — moderate**: array-limit bypass + DoS via isBuffer.
Keduanya lulus `npm audit fix` — jalankan, uji upload sekali, selesai.

### P2-C2 — `frontend/dist` dibangun tapi tak pernah disajikan [LOW]
Express hanya melayani `public/` (web lama arsip) + catch-all `public/index.html`; folder
`frontend/dist` (build 19 Sep 11:39) tidak dipakai siapa pun. Buang kebiasaan build tanpa konsumen,
atau sajikan dist lewat Express agar ada mode produksi nyata.

---

## 4. YANG SUDAH BAIK (pertahankan)

- `account-gate.js`: satu pintu kebijakan, dipakai lintas eksekutor — kualitas desain naik.
- `rawAll` kini kontraknya jujur (baca murni); `save()` eksplisit di jalur tulis.
- Server sehat di runtime: `/api/stats` mengembalikan data nyata (50 akun, 122 log error),
  WebSocket status 200, upload multer ber-batas ukuran + filter mimetype.
- Tidak ada secret hardcoded di src/ (semua via env; AMMAIL_API_KEY dll. dibaca `process.env`).
- Dokumentasi operasional (DOKUMEN-SISTEM.md) terbukti akurat: gejala hang + obat taskkill persis
  seperti tercatat, dan audit ini mengikuti jejaknya.

---

## 5. URUTAN TINDAK LANJUT (paling murah → paling besar efek)

1. **Hari ini, 30 menit**: init git + commit pertama bersih (`.gitignore` + `test-import.txt`,
   `*.png`, `*.log`, `farm-jobs/`, `node`, `frontend/dist`, `backups/`). Tanpa ini semua patch
   tanpa jaring pengaman. Hapus/rotasi password di `test-import.txt` lebih dulu.
2. **Hari ini, 30 menit**: patch kecil berdampak besar:
   a. `deleteBackup`/`restoreBackup`: `path.basename` + prefix `backup_` + resolve-check;
   b. hapus route rotate duplikat (server.js:1132);
   c. `npm audit fix` (multer + qs), uji upload.
3. **Minggu ini**: single-instance lock di server.js & worker.js (lihat P1-C2) + gabung dua SIGINT
   worker jadi satu.
4. **Sebelum VPS**: cabut `/config.js` + `/config.json`, inject key saat build atau ganti session/login;
   pindahkan `public/farm/` ke belakang `requireApiKey`; hapus `DISABLE_RATE_LIMIT`.
5. **Jalur PG lanjut**: pg-queue/pg-worker sudah lulus tes — tinggal dipindah ke jalur order produksi.

---

## 6. CATATAN SESI INI (perubahan yang dilakukan audit)

- Menambal `frontend/vite.config.js`: menambah proxy `'/config.json'` → panel dev kini bisa auth.
- Menyalakan Vite :5175 (PID 13612) + memverifikasi rantai panel→API end-to-end.
- Mematikan 2 duplikat server.js (PID 4916, 13328) untuk mencegah race tulis DB 4-proses.
- Tidak mengubah file backend lain; semua temuan P0/P1 lama sengaja dibiarkan menyala untuk
  keputusan pemilik (lihat daftar rekomendasi).
