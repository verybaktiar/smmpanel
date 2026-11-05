---
target: dashboard
total_score: 30
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 0
target_identity: "file:G:\\laragon\\www\\smmpanel\\frontend\\src\\Dashboard.jsx"
target_fingerprint: "sha256:877e7abba8457b3812cde521653e989d5a82fd7c0736756f2f0b76892303af88"
target_path: "G:\\laragon\\www\\smmpanel\\frontend\\src\\Dashboard.jsx"
timestamp: 2026-10-27T14-44-51Z
slug: frontend-src-dashboard-jsx
---
# Critique: Dashboard (frontend/src/Dashboard.jsx) — run 2

⚠️ DEGRADED: single-context (hanya `researcher-web` yang tersedia sebagai sub-agent; tidak ada agen review/CLI untuk isolasi Assessment A/B)

Mode: **Operate**. Dibandingkan dengan run 1 (26/40).

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 4 | Kalimat verdict + "Diperbarui X lalu" + status per-sumber |
| 2 | Match System / Real World | 3 | Jargon kini punya tooltip, tapi hover-only (mati di layar sentuh) |
| 3 | User Control and Freedom | 3 | Masih tanpa jeda auto-refresh / refresh manual |
| 4 | Consistency and Standards | 4 | Ikon seragam dari set proyek, badge konsisten di permukaan ini |
| 5 | Error Prevention | 3 | Halaman baca-saja, risiko rendah |
| 6 | Recognition Rather Than Recall | 3 | Periode error berlabel, jumlah nonaktif eksplisit, nol ditampilkan |
| 7 | Flexibility and Efficiency | 2 | Tanpa shortcut, tanpa rentang waktu, tanpa filter |
| 8 | Aesthetic and Minimalist Design | 3 | Metrik ganda hilang, empty state ringkas; 8 kartu masih setara bobot |
| 9 | Error Recovery | 3 | Status jujur, belum ada aksi coba-ulang |
| 10 | Help and Documentation | 2 | Tooltip kontekstual ada, dokumentasi in-product belum |
| **Total** | | **30/40** | **Good** |

## Design Specificity Verdict

**LLM**: struktur tetap khas produk ini; lapisan visual kini punya satu titik fokus (kalimat verdict) yang tidak dimiliki template umum. Bobot blok di bawah hero masih datar.

**Deterministic scan**: `detect` atas `frontend/src` = 20 temuan, **0 di dashboard** (run 1: 2). Sisa 2 temuan `bounce-easing` berada di `pages/FbDashboard.css`, permukaan berbeda.

**Visual overlay**: tidak tersedia (`live-server` menggantung di mesin ini).

## Overall Impression

Perbaikan run 1 bertahan: angka error sekarang sebanding (24 jam vs sepanjang waktu), hero menjawab status alih-alih mengulang angka, dan konsistensi ikon selesai. Yang tersisa bukan cacat, melainkan kedalaman: dashboard belum menawarkan jalan pintas atau rentang waktu.

## What's Working

- Satu kalimat verdict menutup celah yang dulu paling berbahaya: dulu hero bisa bilang normal sementara Worker mati; sekarang status worker ikut ke peringatan.
- Angka nol tidak lagi menyamar: hari kosong menampilkan 0 dengan garis dasar netral, dan "belum pernah jalan" dibedakan dari "mati > 24 jam".
- Aksesibilitas grafik: `role="img"` dengan label "Rab 0, Kam 0, Jum 4, Sab 3, Min 1, Sen 0, Sel 0" — seri terbaca utuh tanpa melihat batang.

## Priority Issues

**[P2] Bobot blok masih datar.** Verdict memberi titik masuk, tapi delapan kartu di bawahnya tetap radius, gradien, dan padding yang sama.
Fix: bedakan satu blok "tindakan" (antrean atau error) dengan blok "pemantauan". `$impeccable layout`

**[P2] Tanpa rentang waktu dan drill-down.** Tren terkunci 7 hari; baris Worker/Farm hanya status, tidak menautkan ke halaman yang bisa memperbaikinya.
Fix: tautkan "mati > 24 jam" ke Monitoring/Fleet, dan beri tren pilihan 7/30 hari. `$impeccable shape`

**[P2] Bantuan hanya saat hover.** Penjelasan "heartbeat", "Jaga Farm", "ADB" hilang di layar sentuh — padahal operator bisa membuka halaman ini dari HP.
Fix: sediakan padanan yang bisa difokus ketuk, atau satu baris legenda ringkas di bawah Status Sistem. `$impeccable clarify`

**[P3] Dua sistem badge lintas halaman.** `b-*` di dashboard, `p-*` di halaman lain; menyatu bukan pekerjaan dashboard, tapi tetap utang konsistensi.

## Persona Red Flags

**Alex (Power User)**: angka tidak lagi beranimasi saat polling (membaik), tapi tetap tanpa shortcut dan tanpa rentang waktu; memperbaiki worker yang mati berarti mencari sendiri halamannya.

**Sam (Accessibility)**: grafik sudah punya label teks lengkap; fokus keyboard dan reduced-motion tetap terjaga. Yang belum: tooltip tidak dapat dijangkau keyboard.

## Minor Observations

- Angka "0" pada kartu Error tetap berwarna merah; nol sebaiknya netral.
- "Antrean kosong" masih ~190px saat tidak ada antrean.
- Empat baris Status Sistem memakai dua nada (merah "mati", abu "0 HP") tanpa menjelaskan mana yang lebih mendesak.

## Questions to Consider

- Perlukah dashboard menautkan langsung ke perbaikan, bukan hanya memberi tahu?
- Kalau tren bisa 7/30 hari, apakah satu kartu cukup?
- Mana yang lebih penting bagi operator: melihat 126 error lama, atau tidak pernah melihatnya lagi?
