# SOP Rotasi Email Akun Farm → @windevpanel.my.id

> Tujuan: mengganti email akun farm lama (domain pihak ketiga yang bisa mati sewaktu-waktu)
> ke inbox sendiri `@windevpanel.my.id` **lewat sesi yang masih hidup**, satu per satu,
> tanpa memicu checkpoint. Dikerjakan HANYA setelah zone Cloudflare aktif + Email Routing terpasang.

## Prasyarat (cek semuanya dulu, jangan lanjut kalau ada yang gagal)

1. **Zone `windevpanel.my.id` aktif** di Cloudflare (Overview: "Active", bukan pending).
2. **Email Routing enabled** — MX `route1/2/3.mx.cloudflare.net` + TXT SPF terpasang otomatis.
   Verifikasi: `curl -s "https://dns.google/resolve?name=windevpanel.my.id&type=MX"`.
3. **Catch-all aktif** → Email Routing → Routing rules → Catch-all → aktifkan, tujuan
   *Send to a Worker* `tempmail-9router` (supaya semua `*@windevpanel.my.id` terbaca worker).
4. **Panel siap baca inbox**:
   - `.env` → `AMMAIL_DOMAINS=windevpanel.my.id` (tambah, jangan hapus yang lama)
   - Worker tempmail → vars `MAIL_DOMAINS` tambah `windevpanel.my.id`
5. **Tes ujung-ke-ujung**: kirim email dari Gmail ke `tes1@windevpanel.my.id`, lalu
   `MailWorkerClient.listMessages` harus menampilkannya. GAGAL = STOP, perbaiki dulu.

## Urutan prioritas

| Prioritas | Kelompok | Alasan |
|---|---|---|
| 1 | Akun **aktif** dengan email `mialmuhajirin.sch.id` (id 69 eko.l84, id 66 jaguarku16) | Domain sudah hangus — sesi hidup sekarang adalah satu-satunya pintu ganti email |
| 2 | Akun aktif dengan domain disposable (vintomaper, fironia, donmah, dll. ±45 akun) | Domain bisa mati kapan pun; kerjakan bergiliran |
| 3 | Akun checkpoint/inactive | Perlu login dulu (= kredensial harus masih valid); email rotasi dikerjakan setelah akun hidup lagi |
| 4 | Kasus khusus: `pocotre76@gmail.com` dipakai 2 akun (id 71 + id 70 `mwal_id`) | Ganti email salah satu ke domain sendiri untuk memutus link antar akun |

## Aturan pelaksanaan (WAJIB)

- **Maksimal 1–2 akun per hari per IP/proxy.** Ganti email = perubahan sensitif;
  10 akun sekaligus dari 1 IP = pola farm = freeze massal.
- **Jam acak** (bukan berkali-kali berurutan dalam 1 jam).
- **Pakai sesi/profil persisten yang sudah login** — JANGAN login ulang pakai kredensial.
  Buka profil (`sessions/<nama>/`) → sudah masuk → langsung ke Settings.
- **1 alias = 1 akun, tidak dipakai ulang** untuk akun IG manapun.
- Catat setiap rotasi di file session akun (`sessions/ig-<nama>-*.json` → field `email` baru + tanggal).

## Langkah per akun (±10 menit)

1. Buat alias baru, format manusiawi konsisten:
   `<nama>-<2 digit>@windevpanel.my.id`, mis. `jaguarku16-07@windevpanel.my.id`.
   (Nama bebas — catch-all menerima SEMUA prefix, jadi tak perlu daftar dulu.)
2. Buka profil persisten akun (`/api/accounts/:id/open` atau CLI playwright dengan
   `userDataDir=sessions/<nama>`). Pastikan sudah login (feed terlihat), TIDAK ada form login.
3. Buka `instagram.com/accounts/edit/` (Settings → Edit profile) → klik **email**.
4. Isi alias baru → IG kirim kode verifikasi ke alias itu.
5. Ambil kode: `MailWorkerClient.listMessages('windevpanel.my.id')` (atau endpoint panel
   auto-OTP yang sudah ada) → masukkan kode di IG → konfirmasi sandi bila diminta.
6. Verifikasi di halaman edit: email tampil `…@windevpanel.my.id`.
7. Update data:
   - Panel: `PUT /api/accounts/:id/password` tidak terkait email — sementara edit via
     `db` langsung / endpoint yang tersedia; pastikan field email berubah.
   - File session di `sessions/` → field `email`.
8. **Jangan logout.** Tutup browser. Sesi tetap tersimpan.
9. Istirahatkan akun (tanpa aksi berat) minimal beberapa jam setelah rotasi.

## Kalau muncul challenge "Check your email" saat proses

- Wajar — kode dikirim ke alias BARU yang sudah terbaca worker → ambil OTP via
  `MailWorkerClient` → masukkan → lanjut. Ini justru bukti manfaat domain sendiri:
  challenge apapun kini selalu bisa diselesaikan otomatis.

## Kalau sesi akun sudah mati + email lama hangus

- Rotasi via sesi tidak mungkin. Recovery via "Lupa kata sandi" juga buntu (kode ke inbox mati).
- Akun seperti ini = **hangus**, catat dan jangan buang waktu. Pelajarannya:
  rotasi harus dikerjakan SELAGI sesi hidup — jadi setelah zone aktif, prioritas 1 dikerjakan
  di hari yang sama.

## Checklist progres (update saat berjalan)

- [ ] id 69 eko.l84 (fb) → `eko.l84-xx@windevpanel.my.id`
- [ ] id 66 jaguarku16 (ig) → `jaguarku16-xx@windevpanel.my.id`
- [ ] id 71 pocotre76 ATAU id 70 mwal_id → pisah email (salah satu ke domain sendiri)
- [ ] ±45 akun domain disposable → bergiliran 1–2/hari
- [ ] Setelah semua beres: `AMMAIL_DOMAINS` hanya berisi domain sendiri + domain cadangan
