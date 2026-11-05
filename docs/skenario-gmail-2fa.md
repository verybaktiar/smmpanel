# Skenario: Kelola Gmail Belian dengan 2FA Otomatis

Status: skenario disetujui, belum diimplementasi. Tanggal: 2026-10-07.

## 1. Masalah
Gmail belian sudah punya email dan password, tinggal login. Kendala: 2FA. Kalau 2FA dipegang Google Authenticator di HP, petugas harus cek kode 1 per 1, lambat dan tidak bisa diotomasi.

## 2. Prinsip dasar
Kode 6 digit Google Authenticator adalah fungsi dari (secret base32 + waktu, ganti tiap 30 detik). Tidak butuh jaringan, tidak butuh SMS. Begitu secret sebuah akun tersimpan di database panel (terenkripsi), panel sendiri bisa menghitung kode akun mana pun kapan saja: jadi panel itu = Google Authenticator untuk seluruh stok.

Karena TOTP tidak pakai SIM, jalur ini kebal dari kendala SIM Tri yang diblokir Google.

## 3. Keputusan yang sudah dikunci
- Dua jalur dibangun: (a) imporkan secret bila seller kasih, (b) pasang 2FA sendiri saat onboarding karena mayoritas seller hanya kasih email + password.
- Alur onboarding login belian menjadi mode kedua di halaman Buat Gmail (`/gmail-native/buat`), memakai ulang infra run Gmail native (spawn detached, kunci run.json, guard tanpa HP, log live, verdict per run).
- Status 2FA di tabel Stok: 3 keadaan:
  - `TOTP` (hijau): secret ada, kode bisa dihitung panel kapan pun.
  - `tanpa 2FA` (jingga): perlu onboarding penyalan 2FA.
  - `2FA seller` (merah): challenge muncul dan panel tidak bisa menjawab; selesaikan manual dengan seller atau buang akunnya.

## 4. Perubahan data (rencana)
- Tabel `gmail_pool` ([src/db.js](../src/db.js)) tambah kolom:
  - `totp_secret_enc` TEXT NULL: secret base32 terenkripsi format crypto.encrypt, NULL artinya tanpa 2FA.
  - `recovery_codes_enc` TEXT NULL (opsional): kode cadangan 8-10 digit dari setelan keamanan, disimpan sekalian saat onboarding.
- Source label baru: `belian`, terpisah dari `manual` dan `hp-native` di map SRC [Gmail.jsx](../frontend/src/pages/Gmail.jsx). Status available/used tidak berubah; kolom 2FA adalah halaman terpisah dari status pakai.
- Password tetap tidak pernah keluar lewat daftar stok; secret hanya didekripsi di RAM saat generate kode.

## 5. Dua kondisi akun masuk stok
| Dari seller | Hasil masuk stok |
|---|---|
| Email + password saja (mayoritas) | Status `tanpa 2FA`, disyalakan saat onboarding (bab 7). |
| Email + password + secret base32 atau QR transfer Authenticator | Langsung `TOTP`, generator siap begitu impor selesai, tanpa sentuh HP. |

## 6. Impor (perubahan kecil)
Modal Impor di Gmail.jsx menerima format diperluas:
- Baris: `email|sandi|secret` (kolom ketiga opsional).
- JSON Gmail Creator: properti `secret` ikut dibaca.
Parser lama sudah membaca baris split `|,;`; cukup tambah kolom ketiga. Duplikat tetap skipped, bukan gagalkan semua.

## 7. Onboarding login belian di HP farm (mode "Login belian")
Alur run baru, pola infra Gmail native yang sudah terverifikasi:
1. Ambil satu akun `tanpa 2FA` dari pool lewat claimGmail (FIFO, dipakai ulang).
2. Buka Google sign-in di Chrome HP farm, isi email, isi password.
3. Kalau Google menaikkan challenge (minta nomor HP, suspended, disabled): jangan nekat, tulis verdict `perlu cek` atau `gagal`, lanjut akun berikut. Akun belian memang lebih sering kena challenge daripada akun kelahiran sendiri.
4. Setelah masuk: pasang Authenticator atas nama kita. Ambil secret lewat setelan 2SV, opsi "can't scan it" yang menampilkan setup key sebagai teks; alternatif: screenshot QR lalu dekode lokal.
5. Verifikasi dengan mengetik 6 digit hasil generator panel sendiri sebelum menekan aktifkan, supaya tidak ke-lockout. Bila lolos: simpan secret terenkripsi, status akun naik ke `TOTP`.
6. Bonus direkomendasikan: simpan kode cadangan (recovery codes) sekalian, terenkripsi.

Arsip onboarding pisah dari arsip kelahiran: log JSONL sendiri di `logs/`, verdict sama (sukses / perlu cek / gagal) sehingga pola chip filter, modal detail, dan ekspor CSV GmailNative.jsx bisa dipakaikan ulang.

## 8. Hasil akhir di AutoCreate platform lain
Saat automasi FB/IG/TikTok memakai Gmail dari pool dan Google meminta 2FA, automasi memanggil generator internal di backend (bukan lewat UI) dan mengetikkan 6 digit itu sendiri. Tidak perlu buka Google Authenticator sama sekali, sekalipun untuk banyak akun serentak. Automasi berjalan di mesin yang sama dengan panel, jadi panggilannya fungsi lokal.

## 9. Risiko yang diperhitungkan
- Akun belian lebih sering kena challenge nomor HP. Sudah jadi verdict `perlu cek`, bukan kegagalan fatal.
- Recovery HP seller yang masih menempel: Google bisa kirim kode ke HP seller, kita tidak bisa jawab. Masuk state `2FA seller` atau `perlu cek`.
- Secret adalah aset: lapisan penyimpanan sama dengan password (crypto.encrypt), hanya didekripsi saat generate.
- Jam server harus akurat; mesin lokal/VPS biasanya sudah NTP.

## 10. Urutan bangun
1. Fase 1: kolom totp_secret_enc, generator TOTP di backend, kolom 2FA dan tombol kode sekarang di Stok. Dapat dibangun dan diuji tanpa HP.
2. Fase 2: impor `email|sandi|secret` dan source `belian`.
3. Fase 3: mode Login belian di Buat Gmail + penyalan 2FA otomatis + arsip onboarding. Uji nyata menunggu HP farm tercolok (hp1 saat skenario dibuat masih lepas).

## 11. Jangan lupa
- Verifikasi akhir mengikuti aturan R-35: uji nyata di browser atau hasil fisik, bukan klaim.
- Anti-slop tetap aktif saat implementasi (mode during, session override).
