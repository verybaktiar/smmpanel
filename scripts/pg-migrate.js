'use strict';
// Migrasi data sql.js -> PostgreSQL (STEP 2). Idempotent: TRUNCATE per tabel lalu
// insert ulang dengan id asli (OVERRIDING SYSTEM VALUE), FK dimatikan sesaat.
// JANGAN jalankan saat server/worker menulis (hentikan dulu) agar snapshot konsisten.
// Pakai: node scripts/pg-migrate.js
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pg = require('../src/pg');

const TABLES = ['accounts', 'contents', 'schedules', 'post_log', 'like_jobs',
  'smm_like_orders', 'smm_like_executions', 'ig_like_jobs', 'proxies',
  'warming_accounts', 'warming_activity_logs'];

async function loadSqlite() {
  const loadSqlModule = require('sql.js').default;
  const SQL_JS_DIR = path.dirname(require.resolve('sql.js'));
  const wasmBinary = fs.readFileSync(path.join(SQL_JS_DIR, 'sql-wasm.wasm'));
  const SQL = await loadSqlModule({ wasmBinary });
  const file = process.env.DB_PATH || path.join(__dirname, '..', 'database.db');
  const db = new SQL.Database(fs.readFileSync(file));
  const tables = {};
  const schemas = {};
  for (const t of TABLES) {
    try {
      const info = db.exec(`PRAGMA table_info(${t})`);
      if (!info.length) { tables[t] = []; continue; }
      // info columns: cid, name, type, notnull, dflt_value, pk
      schemas[t] = info[0].values.map((r) => ({ name: r[1], type: String(r[2] || 'TEXT').toUpperCase(), pk: r[5] === 1 }));
      const res = db.exec(`SELECT * FROM ${t}`);
      if (!res.length) { tables[t] = []; continue; }
      const { columns, values } = res[0];
      tables[t] = values.map((row) => Object.fromEntries(columns.map((c, i) => [c, row[i]])));
    } catch (e) { tables[t] = []; }
  }
  return { tables, schemas };
}

const PG_INDEXES = [
  'CREATE INDEX IF NOT EXISTS idx_schedules_status ON schedules(status)',
  'CREATE INDEX IF NOT EXISTS idx_schedules_scheduled_at ON schedules(scheduled_at)',
  'CREATE INDEX IF NOT EXISTS idx_smm_orders_status ON smm_like_orders(status)',
  'CREATE INDEX IF NOT EXISTS idx_smm_executions_order_status ON smm_like_executions(order_id, status)',
  'CREATE INDEX IF NOT EXISTS idx_smm_executions_account ON smm_like_executions(account_id)',
  'CREATE INDEX IF NOT EXISTS idx_post_log_created_at ON post_log(created_at)',
  'CREATE INDEX IF NOT EXISTS idx_accounts_status ON accounts(status)',
  'CREATE INDEX IF NOT EXISTS idx_accounts_platform ON accounts(platform)',
];

function pgType(sqliteType, name, pk) {
  if (pk) return 'INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY';
  if (/INT/.test(sqliteType)) return 'INTEGER';
  if (/REAL|FLOA|DOUB/.test(sqliteType)) return 'DOUBLE PRECISION';
  return 'TEXT';
}

async function main() {
  console.log('1/4 baca sqlite...');
  const { tables: data, schemas } = await loadSqlite();
  const total = Object.values(data).reduce((a, r) => a + r.length, 0);
  console.log(`   ${TABLES.length} tabel, ${total} baris`);
  console.log('2/4 buat schema PG dari struktur sqlite...');
  for (const t of TABLES) {
    const cols = schemas[t] || [];
    if (!cols.length) continue;
    const defs = cols.map((c) => `"${c.name}" ${pgType(c.type, c.name, c.pk)}`).join(',\n  ');
    await pg.query(`CREATE TABLE IF NOT EXISTS ${t} (\n  ${defs}\n)`);
  }
  // UNIQUE yang dikenal (di luar PK)
  for (const [t, c] of [['accounts', 'name'], ['proxies', 'value'], ['warming_accounts', 'account_id']]) {
    try { await pg.query(`ALTER TABLE ${t} ADD CONSTRAINT ${t}_${c}_uniq UNIQUE (${c})`); } catch (e) { /* sudah ada */ }
  }
  for (const ix of PG_INDEXES) { try { await pg.query(ix); } catch (e) { /* kolom mungkin tak ada */ } }
  // Sinkron kolom: tambah yang kurang (migrasi parsial sebelumnya mungkin ketinggalan)
  for (const t of TABLES) {
    const cols = schemas[t] || [];
    if (!cols.length) continue;
    const have = (await pg.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = $1`, [t])).rows.map((r) => r.column_name);
    for (const c of cols) {
      if (!have.includes(c.name)) {
        await pg.query(`ALTER TABLE ${t} ADD COLUMN "${c.name}" ${pgType(c.type, c.name, false)}`);
        console.log(`   + kolom ${t}.${c.name}`);
      }
    }
  }
  console.log('3/4 pindah data (id asli dipertahankan)...');
  const client = await pg.getPool().connect();
  try {
    await client.query('BEGIN');
    await client.query('SET session_replication_role = replica');
    // TRUNCATE urutan anak -> induk
    for (const t of [...TABLES].reverse()) await client.query(`TRUNCATE ${t} RESTART IDENTITY CASCADE`);
    for (const t of TABLES) {
      const rows = data[t];
      if (!rows.length) { console.log(`   ${t}: 0`); continue; }
      const cols = Object.keys(rows[0]);
      const ph = (i) => cols.map((_, k) => `$${i * cols.length + k + 1}`).join(',');
      const vals = [];
      const chunks = [];
      rows.forEach((r, i) => { chunks.push(`(${ph(i)})`); cols.forEach((c) => vals.push(r[c])); });
      // OVERRIDING SYSTEM VALUE agar id asli masuk ke kolom IDENTITY
      const colList = cols.map((c) => `"${c}"`).join(',');
      await client.query(`INSERT INTO ${t} (${colList}) OVERRIDING SYSTEM VALUE VALUES ${chunks.join(',')}`, vals);
      await client.query(`SELECT setval(pg_get_serial_sequence('${t}', 'id'), (SELECT COALESCE(MAX(id),0)+1 FROM ${t}), false)`);
      console.log(`   ${t}: ${rows.length}`);
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
  console.log('4/4 verifikasi hitung...');
  for (const t of TABLES) {
    const pgN = (await pg.query(`SELECT COUNT(*)::int AS n FROM ${t}`)).rows[0].n;
    const liteN = data[t].length;
    console.log(`   ${t}: sqlite=${liteN} pg=${pgN} ${pgN === liteN ? 'OK' : 'SELISIH!'}`);
  }
  await pg.getPool().end();
  console.log('MIGRASI SELESAI');
}

main().catch((e) => { console.error('MIGRASI GAGAL:', e.message); process.exit(1); });
