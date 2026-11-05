# SOP TERKUNCI — Create Akun FB via Aplikasi HP (adb) — Versi Terverifikasi 19 Okt 2026

> Status: **TERBUKTI BERHASIL** (uji A, akun #85 Bagus Setiawan — lahir & langsung masuk Feed TANPA checkpoint).
> Jangan ubah langkah/urutan di dokumen ini tanpa uji ulang. Ini adalah baseline "sistem versi ini".

## Alat

- adb: `C:\Users\Admin\Downloads\platform-tools\adb.exe` (v35.0.1). **Jangan** pakai adb bundle scrcpy dari WinGet — crash (access violation).
- HP: POCO M3 (`72d1b9490221`), Android 12 / MIUI V14.0.2.0 `citrus_global`, layar 1080×2340, USB debugging aktif, kabel USB data.
- Aplikasi: FB v583.0.0.39.55 (`com.facebook.katana`).

## Prasyarat (wajib sebelum mulai)

1. HP tercolok USB + USB debugging on (`adb devices` menampilkan serial).
2. Jaringan kelahiran **dipilih sebelum wizard dimulai** dan tidak diubah sampai akun matang:
   - Versi ini terbukti: **WiFi ERM** (IP publik ~203.190.53.177, satu NAT dengan PC).
   - Aturan konsistensi: login/aktivasi berikutnya **harus** dari jaringan yang sama.
3. Identitas baru per akun (nama Indonesia umum + DOB usia 20–70, jangan <19 th). Satu akun = satu device = satu jaringan.
4. Nomor SIM aktif untuk verifikasi (uji ini: by.U). **Nomor diketik manual oleh operator di HP** — jangan bot yang ketik nomor SIM (baca nomor via adb tidak konsisten).

## Urutan langkah (persis yang ditempuh, koordinat untuk layar 1080×2340)

Semua koordinat = titik tengah elemen; cara aman untuk halaman Bloks: `uiautomator dump` → ambil bounds → tap tengahnya.

1. Buka app: `adb shell monkey -p com.facebook.katana -c android.intent.category.LAUNCHER 1` → tunggu layar logged-out ("Mulai" di bounds [489,1892][592,1950]).
2. Tap **Mulai** (540,1921).
3. Dialog "Pilih email untuk mengisi otomatis…" → **Lewati** (741,1384). WAJIB lewati — jangan pakai identitas Google HP.
4. Form nama → isi field via `input text` (Nama depan [88,744][380,800], Nama belakang [601,744][893,800]) → **Berikutnya** (540,949).
5. Tanggal lahir: tap kartu tanggal (540,640) → picker 3 roda (kolom x≈309/529/749, baris tengah y≈1089, langkah 132px/ar-one))) → set Hari/Bulan/Tahun dengan **swipe pendek 135px per langkah, 1 langkah per gerak, verifikasi tiap langkah** (swipe panjang = momentum meleset) → **ATUR** (714,1523).
6. Halaman DOB → **Berikutnya** (540,846).
7. Gender → pilih (Laki-laki pada 167,740) → **Berikutnya** (540,1240).
8. Nomor ponsel: **operator ketik manual** di field [88,585][893,641] → konfirmasi via dump (prefix 6…) → **Berikutnya**.
9. Kata sandi: `input text` ke field [88,639][893,695] → **Berikutnya** (540,948).
10. Ketentuan → **Saya setuju** (540,1323).
11. Layar "Kode konfirmasi" mungkin muncul tanpa SMS masuk — **jangan panik, jangan retry**: di uji ini wizard lewat sendiri ke step berikutnya (auto-verify via aplikasi). Tunggu, jangan tutup app.
12. Step pasca-lahir: "Tambahkan foto" → Lewati; "Impor kontak" → Lewati (konfirmasi Lewati); "Tambahkan email" → Lewati. (Semua diisi belakangan dari profil kelahiran.)
13. Selesai → **FbMainTabActivity** (Feed) = tanda akun lahir sukses.

## Setelah lahir (checklist)

- [ ] Catat IP publik kelahiran (`curl -s https://api.ipify.org` dari PC satu NAT).
- [ ] Daftarkan ke panel: `POST /api/accounts` (`name, email placeholder, password, platform=fb, proxy="cellular://…"`) + naikkan status `active` + event `birth` di `account_events`.
- [ ] Simpan bukti: screenshot per langkah ke `artifacts/hp_fb_N.png`.
- [ ] Jangan lakukan apa pun dengan akun sebelum jeda 24 jam; foto/email/TOTP dijalankan dari **profil kelahiran ini saja**.

## Batasan yang diketahui (do-not-touch)

- Tombol "Berikutnya/Berikutnya" halaman Bloks sering `clickable=false` tapi menanggapi input tap pusat bounds-nya.
- Dump UI halaman Bloks bisa minim teks — kombinasikan screenshot + dump.
- `uiautomator dump` perlu path absolut via `cat /sdcard/window_dump.xml` (exec-out, tanpa shell-redirection error Git Bash).
- Picker tanggal: momentum antar-operasi tidak konsisten — **jangan** multi-langkah dalam satu swipe panjang.

## Hasil uji acuan

- Akun #85: nama Bagus Setiawan, 14/03/1994, L, password tersimpan di panel (terenkripsi), proxy kelahiran `cellular://WiFi ERM (…)`, IP ~203.190.53.177.
- Bukti visual: `artifacts/hp_fb_2..12.png`; narasi: `docs/uji-fb-via-hp-20261019.md`.

## Catatan khusus status di panel

- Health-checker otomatis panel menandai akun `inactive` bila tidak bisa diverifikasi via browser PC. Akun HP (profil di aplikasi HP, bukan PC) **pasti** kena ini — `inactive` di panel untuk akun HP **bukan** tanda akun bermasalah. Jangan coba "aktivasi via panel" untuk akun HP sampai alur adb terintegrasi (itu akan buka browser PC, bukan profil HP dan malah membakar trust device).
- Status yang benar utk akun HP: lihat `account_events` (event `birth`), bukan kolom status.
