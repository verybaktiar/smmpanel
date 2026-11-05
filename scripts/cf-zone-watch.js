'use strict';
// Watcher aktivasi zone Cloudflare + auto-enable Email Routing.
// Run: CF_TOKEN=xxx node scripts/cf-zone-watch.js   (atau set CF_WATCH_TOKEN di .env)
// Poll tiap 5 menit (max 6 jam). Begitu zone 'active':
//   1. POST /email/routing/enable  (Cloudflare otomatis menambah MX + SPF)
//   2. Verifikasi record DNS, tulis laporan ke sessions/cf-zone-watch-result.json
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const fs = require('fs');

const TOKEN = process.env.CF_WATCH_TOKEN || process.env.CF_TOKEN || '';
const ZONE = process.env.CF_ZONE_ID || '14cb5159d6d149aa47d69263d42a5c8b';
const LOG = path.join(__dirname, '..', 'logs', 'cf-zone-watch.log');
const RESULT = path.join(__dirname, '..', 'sessions', 'cf-zone-watch-result.json');
const INTERVAL = 5 * 60 * 1000;
const MAX_HOURS = 6;

function log(m) {
  const line = `[${new Date().toISOString()}] ${m}`;
  console.log(line);
  try { fs.appendFileSync(LOG, line + '\n'); } catch (e) { /* abaikan */ }
}

async function cf(method, urlPath, body) {
  const r = await fetch(`https://api.cloudflare.com/client/v4${urlPath}`, {
    method,
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return r.json();
}

async function main() {
  if (!TOKEN) { log('CF_TOKEN kosong — mati.'); process.exit(1); }
  const t0 = Date.now();
  while (Date.now() - t0 < MAX_HOURS * 3600 * 1000) {
    const z = await cf('GET', `/zones/${ZONE}`);
    const status = z.result ? z.result.status : `api_error:${JSON.stringify(z.errors).slice(0, 120)}`;
    log(`status zone: ${status}`);
    if (status === 'active') {
      log('ZONE AKTIF — enable Email Routing…');
      const en = await cf('POST', `/zones/${ZONE}/email/routing/enable`);
      log(`enable: success=${en.success} ${en.errors && en.errors.length ? JSON.stringify(en.errors).slice(0, 200) : ''}`);
      // Beri waktu Cloudflare menambah record MX/SPF, lalu verifikasi.
      await new Promise((r) => setTimeout(r, 20000));
      const recs = await cf('GET', `/zones/${ZONE}/dns_records?per_page=50`);
      const list = recs.success ? recs.result.map((r) => `${r.type} ${r.name} → ${String(r.content).slice(0, 60)}`) : [];
      const mx = list.filter((l) => l.startsWith('MX'));
      const txt = list.filter((l) => l.startsWith('TXT'));
      const out = {
        at: new Date().toISOString(), zoneStatus: 'active',
        enableSuccess: !!en.success, totalRecords: list.length,
        mx, txt, allRecords: list,
      };
      fs.mkdirSync(path.dirname(RESULT), { recursive: true });
      fs.writeFileSync(RESULT, JSON.stringify(out, null, 1));
      log(`SELESAI — ${mx.length} MX, ${txt.length} TXT. Laporan: sessions/cf-zone-watch-result.json`);
      process.exit(0);
    }
    if (status.startsWith('api_error')) log('(ulangi tetap — kemungkinan token/limit)');
    await new Promise((r) => setTimeout(r, INTERVAL));
  }
  log('Timeout 6 jam — zone masih belum aktif. Jalankan ulang bila perlu.');
  process.exit(2);
}

main().catch((e) => { log('GAGAL: ' + e.message); process.exit(3); });
