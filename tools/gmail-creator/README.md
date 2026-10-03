# Gmail Creator Pro (vendored upstream)

Sumber: https://github.com/ShadowHackrs/gmail-account-creator (versi 2.x, lisensi proprietary).

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
- Mode jalan otomatis terbatas: panel mengirim pilihan menu "buat akun" ke stdin
  proses. Bila tool upstream berubah alur menunya, jalankan manual:
  `cd tools/gmail-creator && ./auto_gmail_creator.exe`, lalu impor JSON-nya.
- Setelah satu putaran selesai, tool kembali ke menu; tekan Hentikan di panel
  untuk mematikan prosesnya.
- Kualitas dan risiko pembuatan akun otomatis (pemeriksaan Google, 5sim, proxy
  gratis) ada di luar kendali panel. Panel hanya mengelola stok dan prosesnya.
