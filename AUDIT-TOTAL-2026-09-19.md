# AUDIT TOTAL SISTEM — SMM Panel / Phone Farm (19 Sep 2026)

> Auditor: Buffy (Codebuff). Metode: telaah source aktual + verifikasi klaim
> `SYSTEM_AUDIT.md` (15 Sep) + `FINAL_SYSTEM_AUDIT.md` + inspeksi runtime.
> Server TIDAK sedang berjalan saat audit (port 3000/5175 tidak LISTEN).
> Skala: 145 endpoint Express (server.js 1.616 baris), worker 11 cron, 50 modul src/,
> frontend React 25 halaman, lapisan PG (3 modul + 3 skrip tes).

---

## 1. RINGKASAN EKSEKUTIF

Kondisi umum: **prototype fungsional yang solid untuk pemakaian lokal 1 orang**, dengan
disiplin operasional yang jarang ada di proyek sekelas ini (aturan besi terdokumentasi,
dry-run default, gerbang persetujuan, verifikasi per-fase). Tapi ada **3 lubang keamanan
baru** yang tidak tercantum di audit lama, dan **2 P0 lama yang masih menggantung** (tanpa
git, queue persistent belum dipakai produksi). Untuk tetap lokal: aman dikendarai.
Untuk VPS publik dalam kondisi sekarang: **JANGAN** — ada jalur akses tanpa kredensial.

| Severity | Lama (15 Sep) | Baru (audit ini) | Status |
|---|---|---|---|
| P0 | 4 | +1 | 4 masih terbuka, 1 tertambal |
| P1 | 6 | +3 | 2 tertambal, 4+3 terbuka |
| P2 | 6 | +4 | mayoritas terbuka |
| P3 | 3 | +2 | terbuka |

---

## 2. VERIFIKASI KLAIM AUDIT LAMA (apa yang benar-benar berubah)

### Tertambal sejak 15 Sep ✅
- **P1-4 backup tanpa manifest** → DIPERBAIKI. `src/backup-system.js` sekarang menulis
  `manifest.json` (type, timestamp, items), ada retensi `MAX_BACKUPS` + `cleanupOldBackups()`,
  restore membuat backup-safety DB saat dulu sebelum menimpa. Sisa: keabsahan restore belum
  pernah dibuktikan dengan uji (lihat P2-B2).
- **P0-2 queue non-persistent** → SEBAGIAN. `src/pg-queue.js` (Phase 3) + `src/pg-worker.js`
  (Phase 4) lulus 10/10 tes (lease, heartbeat, watchdog, recovery orphan). TAPI produksi
  masih 100% sql.js: antrean order di server.js/worker.js tidak menyentuh pg-queue sama
  sekali (hanya heartbeat/watchdog worker yang hidup). Kebangkitan 2x worker dulu belum
  tertangani di jalur order yang benar-benar dipakai.
- **P2-1 tabel overflow** → klaim panel; tidak diverifikasi visual di audit ini.

### Masih terbuka (konfirmasi ulang) ❌
- **P0-1 DB in-memory per proses** — masih. MITIGASI BARU yang tidak dicatat audit lama:
  `db.rawAll()` sekarang otomatis `save()` ke disk (`src/db.js:409-412` + `save()` di
  `:248-255`). Artinya tulisan lintas proses TIDAK lagi hilang — tapi ini menciptakan
  masalah baru (lihat P2-B1 di bawah). Klaim "restart hilangkan tulis luar" di
  DOKUMEN-SISTEM.md sudah usang.
- **P0-3 tanpa git** — masih. `fatal: not a git repository`. Semua kerja Phase 0–4
  TIDAK punya versioning. Ini sekarang risiko terbesar: satu salah hapus = hilang total.
- **P0-4 kredensial plaintext** — masih: `.env` (API key, proxy user:pass, Ammail key),
  `sessions/*.json` cookie plaintext, `database.db` berisi kolom password_enc (file bisa
  dibaca proses lain di mesin). PLUS temuan baru P0-B1 & P1-B3.
- **P1-1 satu API key global tanpa role/audit log** — masih.
- **P1-2 rate limit dimatikan** — masih (`DISABLE_RATE_LIMIT` ada di `.env`).
- **P1-3 device tanpa registry/heartbeat** — masih (`farm.listDevices()` sesaat).
- **P1-6 duplikat route `/api/proxy/rotate/:accountId`** — MASIH ADA, terkonfirmasi:
  `server.js:904` (proxyValidator.rotateProxyForAccount) vs `server.js:1124`
  (proxyManager.rotateProxy). Express 5 menjalankan yang PERTAMA terdaftar (904);
  handler 1124 adalah kode mati yang menyesatkan.
- **P2-3 halaman AI/Captcha/Notifications/TikTok belum diaudit** — masih.
- **P2-5 tanpa test suite** — masih (skrip tes PG lulus tapi manual, tidak ada runner).

---

## 3. TEMUAN BARU (tidak ada di audit 15 Sep)

### P0-B1 — `/config.js` menyajikan API key ke siapa pun [KRITIS]
`server.js:37-39`:
```js
app.get('/config.js', (req, res) => {
  res.type('application/javascript').send(`window.__SMM_API_KEY = ...`);
});
```
Endpoint ini dipasang SEBELUM middleware API key (yang hanya melindungi `/api/*`), jadi
siapa pun yang bisa membuka port mendapat API key admin lengkap. Digabung CORS default
longgar + `DISABLE_RATE_LIMIT=1`, panel = tanpa autentikasi efektif. Kenapa ada: frontend
(`frontend/src/api.js`) memuat key dari `window.__SMM_API_KEY` via proxy Vite. Pola
"frontend jadi admin" ini berarti kebocoran XSS di frontend = kebocoran API key juga.
**Obat**: lokal saja biarkan; sebelum VPS — hapus endpoint, inject key saat build Vite,
atau ganti ke session/login.

### P0-B2 — Tanpa git + file sensitif di root [KRITIS, gabungan]
Bukan repo, sementara root berisi: `.env` (semua secret), `test-import.txt` (email +
password akun plaintext nyata), `example-accounts.txt`, `server.log`, 40+ PNG audit,
`database.db` + backup 217KB. Begitu di-init git dan terlanjur commit, secret masuk
riwayat. **Obat**: init git SEKARANG dengan `.gitignore` (sudah ada — tapi `test-import.txt`
dan PNG belum masuk ignore), commit bersih pertama, baru tambal kode.

### P1-B1 — Path traversal di backup delete/restore [HIGH]
`server.js:1430-1432` → `backupSystem.deleteBackup(req.params.name)` →
`fs.rmSync(path.join(backupDir, backupName), { recursive: true, force: true })` TANPA
sanitasi. `backupName` seperti `..%2F..%2Fuploads` (URL-decode jadi `../../uploads`)
menghapus direktori arbitrer se-recursive. `restoreBackup()` sama: `path.join` +
manifest dibaca dari lokasi attacker-kontrol → bisa menimpa `database.db`/`.env` dari
folder mana pun yang mengandung `manifest.json`. Satu-satunya pencegah sekarang adalah
API key (yang bocor lewat P0-B1).
**Obat**: `const name = path.basename(backupName)` + wajib prefix `backup_` +
`path.resolve()` harus tetap di dalam `backupDir`.

### P1-B2 — File statis bypass API key, termasuk screenshot HP [HIGH]
`app.use(express.static('public'))` (server.js:35) dipasang TANPA auth, sedangkan API key
hanya melindungi `/api/*`. `public/farm/*.jpg` = screenshot layar HP real-time (bisa
berisi OTP, chat, halaman login IG) dapat di-fetch siapa saja tanpa key. `/config.js`
(P0-B1) satu keluarga masalah. **Obat**: pindahkan farm-shots keluar `public/`, sajikan
via endpoint yang kena `requireApiKey`.

### P1-B3 — Kredensial nyata tertinggal di file repo [HIGH]
`test-import.txt` berisi email + password akun plaintext (3 akun "Play1-3"). Kalau P0-B2
ditindaklanjuti tanpa membersihkan file ini dulu, password masuk git permanen. Hapus /
pindah ke luar folder / ganti password akun-nya.

### P2-B1 — `rawAll()` auto-save: setiap SELECT menulis ulang seluruh DB [MEDIUM]
`db.rawAll()` dipakai untuk read (stats, list, dsb.) TAPI sekarang menyimpan file penuh
setiap panggilan (via perilaku save otomatis). Efek: (a) write amplification — GET
dashboard 5 kolom = export + writeFileSync seluruh database; (b) window korupsi lebih
sering terbuka; (c) worker cleanup menggunakan `rawAll` untuk DELETE (worker.js bagian
cleanup Minggu 02:00) — bekerja, tapi kontrak fungsi menipu (nama `All` menyiratkan
read-only). **Obat**: pisahkan `rawAll` (murni baca, tanpa save) dari `rawRun` (tulis +
save); update worker cleanup.

### P2-B2 — Restore backup TIDAK PERNAH diuji [MEDIUM]
Manifest sudah benar, tapi tidak ada satu pun bukti restore menghasilkan sistem hidup
(klaim audit lama: "validitas tak pernah dibuktikan via restore" — masih segala).
Satu sesi restore-uji ke folder tiruan akan menutup ini.

### P2-B3 — Sampah root & direktori aneh [MEDIUM]
File `node` 0 byte di root (nama sama dengan folder dependensi — jebakan bagi script
yang resolve path); 40+ PNG audit + 6 skrip debug + `temp_section.txt` menumpuk di root;
log debug di root. Mengaburkan file penting dan memperlambat backup (uploads + arsip
ikut terbackup penuh 1,7 GB).

### P2-B4 — `index.js` (scheduler lama) masih ada meski ditandai deprecated [LOW-MED]
Duplikasi titik masuk = risiko terjalankan salah (`npm start` benar ke server.js, tapi
`node index.js` masih valid dan akan buka DB yang sama).

### P3-B1 — API key diterima via query string (`req.query.api_key`)
Key ikut ke log akses/proxy history. Cukup cabut dukungan query, paksa header.
### P3-B2 — Dua handler SIGINT di worker (pg-worker + bawah file)
Keduanya `process.exit(0)` — yang menang nondeterministik; shutdown PG bisa terlewat.
Gabungkan jadi satu.

---

## 4. YANG SUDAH BAIK (pertahankan)

- **crypto.js**: AES-256-GCM benar (IV acak 12B, auth tag dicek, key SHA-256 dari secret,
  menolak default key). Contoh implementasi yang rapi.
- **Orkestra farm** (`farm-orchestra.js`): sanitasi `deviceId` di path JSON, 1 HP = 1 job,
  cooldown 24 jam per device, steps dibatasi 60 entri, job selesai tidak bisa dilapor lagi.
  Untuk 1 HP ini desain yang tepat.
- **Backup**: manifest + retensi + safety-copy sebelum restore (bagian dari perbaikan lama).
- **Fail-fast warming/create**: guard birthday berhenti total, cooldown pasca-suspend
  dihormati, dry-run default, gerbang Setujui.
- **Kredensial tidak bocor via API list**: `listAccounts()` tidak memilih password_enc;
  GET `/api/accounts/:id` strip password_enc (komentar kode basah bilang sebaliknya —
  komentar yang salah, perilakunya benar).
- **Lapisan PG diuji beneran**: 10/10 queue + 10/10 worker, idempotency key, device lock,
  restart-survive — kualitas tes di atas rata-rata proyek sejenis.
- Frontend: polling + proxy Vite, tanpa state server; tidak ada temuan keamanan berarti
  di sisi React selain ketergantungan pada /config.js.

---

## 5. URUTAN TINDAK LANJUT (paling murah → paling besar efek)

1. **Hari ini, 30 menit**: init git dengan `.gitignore` diperluas (tambah `test-import.txt`,
   `*.png`, log, `farm-jobs/`, `node`) → commit pertama bersih. Tanpa ini semua patch
   berikutnya tanpa jaring pengaman.
2. **Hari ini, 30 menit**: tambal 3 lubang kecil yang berdampak besar:
   a. `deleteBackup`/`restoreBackup` + `path.basename` + prefix `backup_` + resolve check;
   b. hapus duplikat route rotate (server.js:1124-1126);
   c. hapus dukungan `req.query.api_key`.
3. **Sebelum VPS**: hapus `/config.js` + pindahkan farm-shots ke belakang auth +
   `DISABLE_RATE_LIMIT` dihapus. Tiga item ini adalah pembeda "lokal aman" vs "publik aman".
4. **Minggu ini**: satu uji restore backup ke folder tiruan + catat hasilnya di
   FINAL_SYSTEM_AUDIT.md; pisahkan rawAll/rawRun di db.js.
5. **Jalur lama lanjut**: Phase 5+ (PG jadi produksi + endpoint queue persistent) —
   fondasinya sudah lulus tes, tinggal dipindah-pakai.

---

## 6. KOREKSI DOKUMEN

- DOKUMEN-SISTEM.md: klaim "restart hilangkan tulis luar" tidak berlaku lagi sejak
  rawAll auto-save (masih benar untuk race dua proses).
- README.md: menyebut IMPLEMENTATION.md yang tidak ada di root (ada di arsip/docs).
- Komentar server.js:211 "dengan password decrypt untuk edit" tidak sesuai kode.
