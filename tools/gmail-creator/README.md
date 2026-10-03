# Gmail Creator Pro (vendored upstream)

Sumber: https://github.com/ShadowHackrs/gmail-account-creator (versi 2.x, lisensi proprietary).

## CATATAN: pilihan utama kini Gmail-infinity (open-source)

Tool exe lama ini usang: saat putaran nyata 2026-10-03, selector-nya kalah oleh
perubahan UI signup Google ("Email-selection heading not found") dan tak bisa
dipatch karena tertutup kode. Penerus resmi developer yang sama,
https://github.com/ShadowHackrs/Gmail-infinity, justru OPEN SOURCE Python
(Playwright) dan sudah diaudit panel: tanpa exec/eval/obfuscation, hanya
menghubungi Google + layanan SMS/captcha opsional + ipify.

Setup backend open-source (sekali saja):

    git clone --depth 1 https://github.com/ShadowHackrs/Gmail-infinity tools/gmail-infinity
    cd tools/gmail-infinity
    python -m venv venv
    venv\Scripts\python -m pip install -r requirements.txt
    venv\Scripts\python -m playwright install chromium

Runner panel memilih backend ini otomatis bila venv ada; data demo bawaan repo
(database.db, accounts.json) WAJIB dihapus dulu agar tak mencemari stok panel.
Impor hasil membaca SQLite data/database.db (tabel accounts) via node:sqlite.

## Apa yang divendor

Hanya file konfigurasi teks + dokumentasi ini. Kode sumber Python TIDAK disertakan
di repo upstream; yang mereka distribusikan adalah `auto_gmail_creator.exe` 52 MB
hasil kompilasi (Nuitka, Python + Selenium + ChromeDriver, UI menu konsol
interaktif, target Windows).

- `config/config.py` = salinan config upstream. Kunci yang dipakai panel: nama akun
  (`USE_ARABIC_NAMES`, `NAMES_FILE`), sandi (`password.txt`), ulang tahun & gender.
- `auto_gmail_creator.exe` TIDAK masuk repo (52 MB + proprietary). Unduh dengan:
  `node scripts/fetch-gmail-creator.js`

## Alasan desain integrasi (R-31)

- Repo upstream tertutup kode dan interaktif via menu konsol, jadi tidak bisa
  dijadikan library. Panel menjalankannya sebagai proses terpisah
  (`src/gmail-creator-runner.js`, mode 1 akun) dan mengambil hasilnya dari
  `data/accounts.json` yang ditulis tool tersebut.
- Hasil (email, sandi, tanggal) diimpor ke tabel `gmail_pool` di panel lewat
  halaman Stok Gmail. Impor manual (JSON atau baris `email|sandi`) tetap tersedia
  karena cara paling andal: tool upstream menyimpan hasilnya ke JSON lokal.
- Pool ini menjawab catatan DOKUMEN-SISTEM: domain Ammail dibakar dan kebutuhan
  create berikutnya adalah Gmail fresh. AutoCreate IG/FB/TikTok bisa menarik satu
  Gmail via `POST /api/gmail/claim`.
- Password di pool disimpan terenkripsi AES-256-GCM dengan format yang sama
  dengan tabel accounts (ENCRYPTION_KEY di .env).

## Batasan yang jujur

- Exe butuh Chrome terpasang di mesin server dan, untuk hasil yang layak, proxy
  yang benar (config upstream, isian manual di `config/`).

## Masalah dikenal

- **TUI-nya tidak bisa dijalankan tanpa konsol nyata.** Dua kegagalan terukur
  saat panel mencoba memipakan stdout (mode tersembunyi):
  1. Banner `rich` crash `UnicodeEncodeError: 'charmap' codec` karena renderer
     legacy Windows meng-encode cp1252; `PYTHONUTF8=1`/`PYTHONIOENCODING` TIDAK
     menolong (kode upstream tertutup, jalur render di luar kendali env).
  2. Setelah env diperbaiki sekalipun, menu tetap tidak bisa diandalkan via
     stdin pipa: output interaktif `rich` tidak cocok untuk di-pompa.
  Solusi final (dipakai `src/gmail-creator-runner.js`): tool dijalankan dengan
  jendela konsolnya sendiri via `cmd /c start "" /wait`, panel TIDAK memipa
  stdout-nya, operator memilih menu langsung di jendela itu, dan hasil
  `data/accounts.json` diimpor otomatis begitu jendela ditutup.
- Jalankan manual tetap bisa: `cd tools/gmail-creator` lalu
  `auto_gmail_creator.exe`, hasilnya diimpor lewat tombol Impor di halaman
  Stok Gmail.

- Tombol "Hentikan" di panel menutup seluruh pohon proses (cmd wait + jendela
  exe) via taskkill /T. Proses signup yang sedang berjalan tentu ikut gugur.
- Kualitas dan risiko pembuatan akun otomatis (pemeriksaan Google, 5sim, proxy
  gratis) ada di luar kendali panel. Panel hanya mengelola stok dan prosesnya.
