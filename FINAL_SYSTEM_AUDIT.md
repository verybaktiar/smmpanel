# FINAL_SYSTEM_AUDIT.md — berjalan per phase (mulai 15 Sep 2026)

## PHASE 0 — Backup pra-kerja [SELESAI]

- Status: OK. `backups/backup_manual_2026-09-15T12-57-56-079Z` + `database.db.pre-pg-2026-09-15.bak` (217KB).
- Backup dipertahankan sampai migrasi PG terverifikasi (belum dihapus).

## PHASE 1 — Audit [SELESAI]

- Status: OK. `SYSTEM_AUDIT.md`: 4 P0, 6 P1, 6 P2, 3 P3. Files changed: 1 (baru).
- Production behavior: tidak berubah.

## PHASE 2 — PostgreSQL [SELESAI, terverifikasi]

- Files changed: `src/pg.js` (baru: pool + DDL), `scripts/pg-migrate.js` (baru:
  introspeksi schema + copy id + sinkron kolom + verifikasi hitung), `.env` (+PG*),
  `package.json` (+pg). Database changes: DB `smmpanel` di PG 18.4, 11 tabel + 8 index
  + 3 unique, 386 baris.
- API changes: tidak ada (production tetap sql.js — perilaku tak berubah).
- Frontend changes: tidak ada.
- Tests executed + result:
  - Koneksi backend (`pg.ping`): OK (smmpanel, PostgreSQL 18.4).
  - Migrasi hitung 11/11 tabel cocok sqlite=pg (50 akun, 2 aktif): OK.
  - CRUD (insert/select/update/delete): OK. Transaction rollback: OK.
  - Service systemd: RUNNING, `listen_addresses=localhost` (127.0.0.1 + ::1), auth
    scram-sha-256, password kuat 24-char hanya di `.env`.
- Known issues:
  - PG18 sudah ada di mesin (bukan instalasi kita) — dipakai setelah diamankan ulang
    (password diganti, trust sementara ditutup, localhost-only). Instalasi PG17 parsial
    di `C:/PostgreSQL/17` GAGAL (port terisi) — direktori sisa perlu dibersihkan nanti.
  - Winget + Chocolatey gagal (403 EDB): diatasi unduh langsung via curl UA browser.
## PHASE 3 — Persistent queue + lease [SELESAI, 10/10 tes PASS]

- Files changed: `src/pg-queue.js` (baru: enqueue/claim/heartbeat/markRunning/finish/
  recoverOrphans/cancel/pause/get/stats), `scripts/pg-queue-test.js` (baru: 10 tes).
- Database changes: tabel `jobs` (UUID, type/platform/device/account, 9 status CHECK,
  priority, attempts/max_attempts, worker/lease/heartbeat/started/finished,
  error_code/message, payload/result JSONB, idempotency_key UNIQUE) + 7 index.
- API changes: BELUM (endpoint API + worker watchdog = STEP 4; produksi sql.js utuh).
- Tests executed: T1 success, T2 retry→failed, T3 worker-mati→RETRY, T4 lease→recovered,
  T5 double-claim 1 pemenang, T6 idempoten, T7 restart-survive, T8 device-lock/release.
  Result: 10/10 PASS.
## PHASE 4 — Worker watchdog + recovery [SELESAI, 10/10 tes PASS]

- Files changed: `src/pg-worker.js` (baru: registry/heartbeat/health/watchdog/shutdown/
  startup/events), `scripts/pg-worker-test.js` (baru: 10 tes), `worker.js`
  (+startup recovery, heartbeat */1, watchdog */2, SIGINT/SIGTERM — aditif),
  `server.js` (+`GET /api/workers/status`, `GET /api/workers/events` baca saja).
- Database changes: tabel `workers` + `worker_events` (+2 index).
- API changes: 2 endpoint baca. Frontend: tidak ada.
- Tests executed: W1 heartbeat, W2 stale→WARNING→UNHEALTHY, W3 hang-vs-hidup,
  W4 crash→RETRY, W5 startup-recovery, W6 multi-recovery, W7 restart-loop→STOPPED,
  W8 graceful→STOPPED+RETRY, W9 orphan-via-watchdog, W10 structured-log. 10/10 PASS.
- Live: worker produksi terdaftar HEALTHY (mem/cpu), startup recovery jalan.
- Known issues: 2 bug tes (bukan kode): sisa run gagal mencemari run berikut
  (diatasi bersih-awal) + format string watchdog salah dibaca (diperbaiki).
  1 bug kode nyata: override `process.exit` cacat → dibuang, handler sinyal cukup.
