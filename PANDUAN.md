# PANDUAN SMM Panel (pengganti 15 file .md lama — yang lama di `arsip/docs/`)

## 1. Peta cepat
- `server.js` → dashboard http://localhost:3000 (satu tombol **Open** ikut platform akun)
- `worker.js` → antrean + warming + **auto-backup jam 04:00** ke `backups/`
- `cli.js` → `account add --platform fb|ig|tiktok`, `run --platform ...`
- Sumber resmi kreator: `src/fb-account-creator.js`, `src/ig-account-creator.js`, `src/tiktok-account-creator.js` (`automation/` = arsip, jangan dipakai)
- Data: `database.db` + `sessions/<nama>/` (profil browser + `cookies.json`) + `.env`
- Farm HP: tab 📱 Phone Farm di dashboard (file `public/farm.html` lama sudah di `arsip/web/`)

## 2. Operasi harian
- Sidebar per platform: **📘 Facebook** (Dashboard, Akun FB, Posting FB, Like FB, Auto-Create) | **📸 Instagram** (Akun IG, Posting IG, Like IG, Auto-Create hybrid) | **🎵 TikTok** (hub status — daftar via proxy diblokir, jalur HP)
- Menu "Akun Facebook/Instagram" otomatis filter platform; "Posting FB" saat filter IG dibuka → panel IG
- Tambah akun: dashboard → Tambah Akun (pilih platform) atau `node cli.js account add --name X --email E --password P --platform ig`
- Buka akun: tombol **Open** (FB→facebook.com, IG→instagram.com + cookie otomatis)
- Akun hidup: #64 Baru14 (fb, active), #66 jaguarku16 (ig, active). Sisanya checkpoint = arsip, jangan dipakai operasi.
- Gagal/bekas: folder profil di `sessions/arsip/`, JSON gagal di `sessions/arsip/`

## 3. Pindah laptop (tanpa login ulang)
Bawa: `database.db` + `sessions/jaguarku16/` + `sessions/Baru14/` + `.env` — atau restore 1 file dari `backups/`.
Proxy tiap akun harus sama. Jangan login massal sekaligus.

## 4. Aturan anti-banned
- 1 akun = 1 proxy sticky. Cooldown FB 24-48 jam. Max 1 akun baru/hari saat cooldown.
- IG baru wajib warming 3-7 hari sebelum aksi berat.
