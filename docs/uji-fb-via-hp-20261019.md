# Uji Create Akun FB via HP (USB) — Catatan 19 Okt 2026

## 1. Device tercolok (terverifikasi via adb, bukan screenshot)

| Properti | Nilai |
|---|---|
| Serial adb | `72d1b9490221` |
| Merek / Model | **POCO M3** (M2010J19CG, codename `citrus`) |
| OS | MIUI-based Android 12 (fingerprint `POCO/citrus_global/citrus:12/RKQ1.211130.001/V14.0.2.0.SJFMIXM:user/release-keys`) — build user, release-keys, bootloader locked |
| Layar | 1080 × 2340 |
| Baterai | USB powered (status 2 / charging) |
| SIM aktif | **by.U** (kartu data lokal Indonesia) |
| Jaringan sekarang | **WiFi "ERM_WIFI"** (192.168.31.155) — bukan data SIM |
| USB debugging | aktif (`adb_enabled=1`) |

Adb yang dipakai: `C:\Users\Admin\Downloads\platform-tools\adb.exe` (v35.0.1). Catatan: adb bundle scrcpy (Winget) crash saat dijalankan — jangan pakai itu.

Aplikasi terpasang yang relevan:
- `com.facebook.katana` versi **583.0.0.39.55** (uji A / aplikasi FB)
- `com.android.chrome` versi **128.0.6613.88** (uji B / browser)
- `com.instagram.android` juga ada

Screenshot layar HP saat ini: [hp_screen_1.png](artifacts/hp_screen_1.png)

## 2. Catatan penting sebelum uji

- HP sedang di **WiFi**, bukan data SIM. Untuk uji, putuskan WiFi & pakai **data SIM by.U** supaya IP kelahiran = IP SIM (aset trust bersih untuk FB).
- `ro.build.version.incremental = eng.nippon` → ROM MIUI custom-ish, tapi fingerprint resmi release-keys + bootloader locked — sinyal device tetap utuh/normal ke mata FB.
- FB aplikasi versi 583 sudah cukup baru; jangan diupdate di tengah uji supaya konsisten.
- Chrome HP 128 mendukung remote debugging — bisa dikontrol dari PC via `chrome://inspect` kalau nanti mau uji automasinya juga.

## 3. Langkah uji selanjutnya (A = aplikasi FB, B = Chrome HP)

Sesuai rencana A/B: dua akun, dua identitas, jangan cicip. Putus WiFi dulu → cek IP SIM via `dumpsys connectivity` → baru mulai create.

---

## 4. HASIL UJI A — Aplikasi FB di HP (19 Okt 2026, ~19:30 WIB)

**Status: SUKSES — akun lahir & langsung masuk Feed, TANPA checkpoint.**

| Item | Nilai |
|---|---|
| Nama | Bagus Setiawan |
| Tanggal lahir | 14 Maret 1994 (32 th) |
| Gender | Laki-laki |
| Verifikasi | Nomor HP by.U (diketik manual user) — SMS kode konfirmasi FB **tidak muncul di inbox** (app mungkin auto-verifikasi), tapi layar kode terlewati otomatis ke wizard berikutnya |
| Password | Bgs#Stw#1994!FbUji |
| IP kelahiran (presumptive) | Public WiFi ERM ≈ 203.190.53.177 (PC & HP satu NAT); HP LAN 192.168.31.155 |
| Setelah lahir | Step "Tambahkan foto" → Lewati; "Impor kontak" → Lewati; "Tambahkan email" → Lewati (semua sesuai SOP — diisi belakangan dari profil kelahiran) |
| Bukti | hp_fb_2..12.png (wizard) + hp_fb_12.png = Feed beranda |

**Catatan penting:** wizard meminta nama, DOB, gender, HP, password persis seperti jalur desktop. Verifikasi SMS tidak diketik manual — wizard lewat sendiri (petanda FB auto-verify via app atau verifikasi tertunda). Ini beda mencolok vs jalur PC/patchright yang sering kena checkpoint 1501092823525282.

**Risyka belum selesai:** profil kosong — foto, email, TOTP 2FA, jeda 24 jam. Jangan dipakai apa-apa sampai warming jalan.
