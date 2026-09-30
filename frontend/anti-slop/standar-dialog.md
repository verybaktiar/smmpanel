# Standar Dialog Panel

Aturan tunggal untuk semua modal, dialog, dan panel melayang di frontend. Berlaku untuk fitur baru dan refactor. Dasar: aturan R-32 (aksesibilitas keyboard) dan R-31 (satu baris alasan per keputusan).

## 1. Pohon keputusan: jenis elemen melayang

| Kebutuhan | Jenis | Contoh di panel |
|---|---|---|
| Tanya keputusan / umumkan hasil (butuh jawaban) | Dialog kustom `dialog.js` (`confirmDlg` / `alertDlg`) | Hapus order, hasil probe gagal |
| Form atau data yang menutup alur kerja sampai selesai | Modal React `.overlay` + `.modal` | Tambah Akun, Proxy/Session, Riwayat IP |
| Umpan balik hasil aksi tanpa tombol | Toast `toastOk` / `toastErr` / `toastInfo` | Proxy tersimpan, gagal salin |
| Status proses berjalan yang boleh diabaikan | Panel non-modal `role="status"` | `.act-float` aktivasi |

Aturan memilih: kalau pengguna harus menjawab atau mengisi sesuatu sebelum lanjut, pakai dialog kustom atau modal. Kalau hanya memberi tahu, pakai toast atau panel status. Jangan pakai modal untuk sekadar pemberitahuan.

## 2. Wajib untuk semua modal (Hard Gate, R-32)

1. `role="dialog"` + `aria-modal="true"` + `aria-label` Indonesia pada elemen `.modal`. Contoh: `<form className="modal" role="dialog" aria-modal="true" aria-label="Tambah Akun">`. Untuk dialog kustom `dialog.js`, pakai `aria-labelledby` yang menunjuk judul (sudah otomatis, ID unik per dialog).
2. Focus trap Tab: runtime [kinetics.js](../src/kinetics.js) sudah otomatis untuk `.dlg-ov` dan `.overlay`. Fitur baru tidak perlu menulis trap sendiri; cukup pastikan modal benar-benar memakai class itu.
3. Fokus masuk otomatis saat modal muncul dan kembali ke pemicu saat tertutup. Sudah ditangani runtime untuk modal React; dialog kustom menangani sendiri (`prevFocus`).
4. Escape menutup. Dialog kustom: otomatis. Modal React per halaman: satu `useEffect` per halaman yang memantau semua modalnya sekaligus dan menutup berjenjang (lihat pola `anyModalOpen` di [Accounts.jsx](../src/pages/Accounts.jsx)). Escape harus bekerja meski fokus sedang di input di dalam modal (pasang listener di `window`).
5. Klik overlay menutup, klik di dalam modal tidak. Pola: `onClick` di overlay + `stopPropagation` di modal.
6. Tombol tutup eksplisit (Batal/Tutup) selalu ada. Jangan gantungkan penutupan hanya pada Escape atau klik luar.
7. Sembunyikan overlay murni-sentuh dari pembaca layar dengan `aria-hidden="true"` (contoh: `nav-overlay` di [layout.jsx](../src/layout.jsx)).

## 3. Wajib untuk drawer dan panel semi-modal

Drawer navigasi mobile (`.sidebar.open`) diperlakukan sebagai modal tipis: Escape menutup, fokus masuk ke tautan pertama saat terbuka, fokus kembali ke tombol Menu saat tertutup, tombol Menu punya `aria-expanded` + `aria-controls`, landmark diberi `aria-label`. Pola lengkap di [layout.jsx](../src/layout.jsx).

Panel status melayang (`.act-float`) TIDAK butuh focus trap (non-modal, boleh diabaikan), tapi wajib `role="status"` dan punya tombol Tutup.

## 4. Toast

Toast wajib lewat helper `toast.js` (sudah `aria-live="polite"`, kurva spring, reduced-motion). Jangan buat elemen toast sendiri. Durasi standar cukup; durasi panjang (mis. 7000) hanya untuk pesan peringatan panjang.

## 5. Checklist sebelum komit fitur dengan modal

- [ ] `role="dialog"` + `aria-modal` + `aria-label` ada di setiap modal.
- [ ] Tab tidak pernah keluar dari modal yang terbuka (uji 7x Tab).
- [ ] Escape menutup, termasuk saat fokus di input; fokus kembali ke pemicu.
- [ ] Klik overlay menutup; klik dalam modal tidak.
- [ ] Di lebar 320px modal tidak overflow (scroll horizontal 0).
- [ ] Teks UI tanpa em dash; label dan pesan berbahasa operator Indonesia; kalimat pendek.
- [ ] Empty state + state gagal fetch ditangani (R-27) bila modal menampilkan data dari server.

## 6. Alasan desain (tercatat, R-31)

- Focus trap terpusat di runtime, bukan per komponen: satu tempat perbaikan, semua modal ikut; komponen fitur tetap tipis.
- Escape di `window`, bukan di elemen modal: fokus sering berada di input, dan event tetap harus tertangkap.
- `aria-labelledby` dengan ID acak unik: aman bila dua dialog pernah hidup bersamaan.
- Drawer mobile diberi perlakuan modal penuh: saat terbuka ia menutupi seluruh layar, sama bahayanya dengan modal bila fokus bebas.
- Panel status non-modal tanpa trap: ia tidak menutupi konten; memaksa fokus masuk justru mencuri kontrol dari operator.
