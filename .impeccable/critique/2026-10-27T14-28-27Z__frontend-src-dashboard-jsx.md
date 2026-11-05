---
target: dashboard
total_score: 26
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 2
target_identity: "file:G:\\laragon\\www\\smmpanel\\frontend\\src\\Dashboard.jsx"
target_fingerprint: "sha256:0d2191f6c7ebf9a2e0e00894f0f6dcb616ee53872174aa122793011fd89b8b8c"
target_path: "G:\\laragon\\www\\smmpanel\\frontend\\src\\Dashboard.jsx"
timestamp: 2026-10-27T14-28-27Z
slug: frontend-src-dashboard-jsx
---
# Critique: Dashboard (frontend/src/Dashboard.jsx)

⚠️ DEGRADED: single-context (hanya `researcher-web` yang tersedia sebagai sub-agent; tidak ada agen review/CLI untuk isolasi Assessment A/B)

Mode: **Operate** — operator tunggal memantau 68 akun FB/IG/TikTok.

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 4 | "Diperbarui X lalu", status per-sumber, live dot, tanpa angka palsu saat fetch gagal |
| 2 | Match System / Real World | 3 | Bahasa operator sudah pas; "Jaga Farm", "heartbeat", "gate" tetap jargon internal |
| 3 | User Control and Freedom | 3 | Auto-refresh 30 dtk tanpa jeda/jeda-manual, tanpa tombol refresh |
| 4 | Consistency and Standards | 3 | Dua sistem badge (`b-*` vs `p-*`), ikon glyph vs set SVG, kartu radius 20 di semua tempat |
| 5 | Error Prevention | 3 | Halaman baca-saja, risiko rendah |
| 6 | Recognition Rather Than Recall | 2 | "126 Error" tanpa periode; "belum ada heartbeat" menuntut pengetahuan istilah |
| 7 | Flexibility and Efficiency | 2 | Tanpa shortcut, tanpa rentang waktu, tanpa filter/density |
| 8 | Aesthetic and Minimalist Design | 2 | 8 kartu berbobot sama; angka yang sama muncul dua kali |
| 9 | Error Recovery | 3 | "gagal dihubungi" jujur, tapi tidak ada aksi coba-ulang |
| 10 | Help and Documentation | 1 | Tidak ada bantuan in-product; footer menunjuk panel lama |
| **Total** | | **26/40** | **Acceptable** |

## Design Specificity Verdict

**LLM**: Struktur mengikuti rutinitas pagi operator (sapaan -> metrik -> platform -> tren -> antrean/status -> feed), dan itu khas produk ini, bukan template. Yang generik adalah lapisan visualnya: setiap blok adalah kartu radius sama dengan gradien tipis, sehingga kedalaman informasi tidak terbaca dari bentuk.

**Deterministic scan**: `detect` atas `frontend/src` = 22 temuan; 2 di antaranya milik dashboard, keduanya di `Dashboard.css`:
- `gradient-text` (warning) baris 9 — H1 memakai `background-clip: text`
- `bounce-easing` (advisory) baris 188 — `cubic-bezier(.34, 1.56, .64, 1)`

**Visual overlay**: tidak tersedia (`live-server --background` menggantung; port 8400 sudah dihentikan).

## Overall Impression

Dashboard ini jujur dan operasional: tidak ada angka karangan, sumber yang gagal tidak dipalsukan jadi nol, dan empty state punya jalan keluar. Peluang terbesarnya bukan menambah warna atau animasi, melainkan memberi bobot berbeda pada blok yang berbeda, dan memberi arti pada satu angka yang paling mendesak: 126 error.

## What's Working

- Kejujuran status per-sumber (D5): `/api/workers/status` gagal tampil "gagal dihubungi", bukan "0". Ini yang membuat dashboard layak dipercaya.
- Empty state lengkap: antrean kosong punya CTA "Buat posting", feed kosong menyebut jendela 48 jam dan menautkan Riwayat.
- Kontras teks lolos semua: muted `#8d969e` 5,9:1; label sidebar `#98a2ad` 6,9:1; merah error 7,1:1.

## Priority Issues

**[P1] "126 Error" mencampur skala waktu.** `logErrors` = `COUNT(*) post_log WHERE status IN ('post_failed','login_failed','error')` tanpa filter tanggal, sementara tetangganya "Jadwal Hari Ini". Dua kartu sebaris memakai periode berbeda tanpa label.
Fix: beri periode eksplisit ("Error total" vs "Error 24 jam"), atau pakai 24 jam dan tambahkan delta terhadap hari sebelumnya. `$impeccable clarify`

**[P1] Metrik yang sama dibaca dua kali.** "11 akun aktif", antrean, dan "0 HP terhubung" muncul di hero-sum sekaligus di stat-row dan kartu platform.
Fix: hero hanya memuat hal yang tidak ada di bawah (atau ringkas jadi satu kalimat status), biarkan stat-row jadi satu-satunya tempat angka hidup. `$impeccable distill`

**[P2] Ritme visual seragam.** Hero, 4 stat, 3 platform, tren, 2 kartu, feed semuanya radius 20px dengan gradien tipis; setelah hero tidak ada yang lebih penting dari yang lain.
Fix: saat error > 0, jadikan kartu error pita peringatan penuh yang memimpin halaman; saat tren datar, biarkan kartu tren mengecil (sudah ada `.is-flat`) dan beri blok antrean bobot lebih. `$impeccable layout`

**[P2] H1 gradien dekoratif.** Detector dan pembacaan manual sepakat: gradien putih-lavender-pink pada "Ringkasan hari ini" tidak menandai hierarki apa pun.
Fix: warna solid dengan kontras tinggi; simpan aksen ungu untuk aksi. `$impeccable typeset`

**[P2] "belum ada heartbeat" selalu kuning.** Badge peringatan permanen pada instalasi baru melatih operator mengabaikan kuning.
Fix: bedakan "worker belum pernah jalan" (netral, abu) dari "worker mati > 24 jam" (merah). `$impeccable clarify`

## Persona Red Flags

**Alex (Power User)**: tidak ada shortcut; tidak ada rentang waktu pada tren 7 hari; untuk tahu 126 error itu apa, ia harus meninggalkan halaman ke /history; `useCountUp` menganimasikan ulang setiap polling 30 dtk sehingga angka bergerak saat sedang dibaca.

**Sam (Accessibility)**: grafik tren adalah `div` tanpa `role="img"`/`aria-label` dan tanpa tabel alternatif; pembaca layar hanya mendapat deretan angka + label hari tanpa relasi. Fokus keyboard dan `prefers-reduced-motion` sudah ditangani dengan benar di tempat lain.

## Minor Observations

- Hari tanpa aktivitas di tren digambar `2px` sehingga terbaca seperti garis rusak, bukan "0".
- Ikon status sistem memakai glyph teks (▦ ◷ ▣ ⚑) sementara sidebar memakai set SVG; ketebalan dan arti berbeda.
- Kartu "Antrean kosong" setinggi ~250px mendominasi layar ketika memang tidak ada antrean.
- Label "6% aktif" pada kartu Facebook benar (3/51), tapi tidak ada pembanding, jadi sulit dinilai cepat.

## Questions to Consider

- Kalau dashboard ini hanya boleh menampilkan tiga angka, mana yang Anda buka setiap pagi?
- Apakah "126 error" perlu bisa ditindak dari halaman ini, bukan hanya ditautkan?
- Berapa lama data boleh basi sebelum halaman berhenti terasa "live"?
