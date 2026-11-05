'use strict';
// Phone Proxy Pool: kelola proxy dari HP Android (Tailscale + aplikasi proxy).
// Sumber: proxies-pool.txt (1 baris = 1 HP). Sync ke tabel `proxies` DB yang sudah
// dipakai seluruh sistem (dropdown AutoCreate, assign, create-runner), jadi pool HP
// otomatis mengikuti semua guard existing tanpa jalur khusus.
//
// - parsePool(): baca & validasi proxies-pool.txt
// - syncToDb():  tambahkan/update proxy dari pool, hapus pool lama yang tak ada lagi
// - startHealth(): tes semua HP paralel terbatas -> IP keluar, geo, latensi,
//   keterjangkauan tiktok/ig/fb, lalu update status DB + laporan JSON

const fs = require('fs');
const net = require('net');
const path = require('path');
const db = require('./db');

const POOL_FILE = path.join(__dirname, '..', 'proxies-pool.txt');
const REPORT_FILE = path.join(__dirname, '..', 'sessions', 'phone-pool-health.json');
const SOURCE = 'phone';
const UA = 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';
const CONCURRENCY = Math.max(1, Number(process.env.POOL_CHECK_CONCURRENCY || '3'));

// ---- Parse pool file ----

// Baris valid: `host:port:user:pass | Label`. Komentar (#) & kosong diabaikan.
function parsePool() {
  if (!fs.existsSync(POOL_FILE)) return [];
  const out = [];
  const seen = new Set();
  for (const raw of fs.readFileSync(POOL_FILE, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const [proxyPart, ...labelParts] = line.split('|');
    const value = proxyPart.trim();
    const parts = value.split(':');
    const ok = parts.length >= 2 && parts.length <= 4 && /^\d+$/.test(parts[1] || '') && parts[0];
    if (!ok || seen.has(value)) continue;
    seen.add(value);
    out.push({
      value,
      label: (labelParts.join('|').trim() || ('HP ' + parts[0])),
    });
  }
  return out;
}

// ---- Sync pool -> DB ----

// Tambahkan proxy pool ke DB (tanpa duplikat), perbarui label, dan hapus entri pool
// yang sudah tak ada di file (kecuali masih dipakai akun — jangan putus akun hidup).
async function syncToDb() {
  await db.load();
  const pool = parsePool();
  const existing = await db.listProxies();
  const byValue = new Map(existing.map((p) => [p.value, p]));
  const poolValues = new Set(pool.map((p) => p.value));

  let added = 0, updated = 0;
  for (const item of pool) {
    const cur = byValue.get(item.value);
    if (!cur) {
      db.run(`INSERT INTO proxies (value, label, source, status) VALUES (?, ?, ?, 'unused')`, [item.value, item.label, SOURCE]);
      added++;
    } else if ((cur.label || '') !== item.label || (cur.source || '') !== SOURCE) {
      db.run(`UPDATE proxies SET label = ?, source = ? WHERE id = ?`, [item.label, SOURCE, cur.id]);
      updated++;
    }
  }

  // Hapus pool lama yang hilang dari file & tak dipakai akun mana pun.
  let removed = 0;
  for (const p of existing) {
    if ((p.source || '') !== SOURCE || poolValues.has(p.value)) continue;
    const used = db.rawAll ? await db.rawAll(`SELECT COUNT(*) AS c FROM accounts WHERE proxy = ?`, [p.value]) : [{ c: 0 }];
    if (!used[0] || !used[0].c) {
      db.run(`DELETE FROM proxies WHERE id = ?`, [p.id]);
      removed++;
    }
  }
  db.save();
  return { ok: true, poolSize: pool.length, added, updated, removed };
}

// ---- Health-check satu proxy (browser headless ringan) ----

async function checkProxy(proxyStr) {
  const { chromium } = require('patchright'); // engine panel: patchright (drop-in playwright)
  const parts = String(proxyStr).split(':');
  const proxyCfg = { server: `http://${parts[0]}:${parts[1]}` };
  if (parts[2]) proxyCfg.username = parts[2];
  if (parts[3]) proxyCfg.password = parts[3];

  const t0 = Date.now();
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'], proxy: proxyCfg });
  try {
    const page = await (await browser.newContext({ userAgent: UA })).newPage();
    await page.goto('https://api.ipify.org?format=json', { timeout: 25000, waitUntil: 'domcontentloaded' });
    const ip = JSON.parse(await page.evaluate(() => document.body.innerText)).ip || '?';
    const latency = Date.now() - t0;

    let geo = '?', isp = '?';
    try {
      await page.goto(`http://ip-api.com/json/${ip}?fields=country,city,isp,mobile`, { timeout: 15000, waitUntil: 'domcontentloaded' });
      const g = JSON.parse(await page.evaluate(() => document.body.innerText));
      geo = `${g.country || '?'}/${g.city || '?'}`;
      isp = g.isp || '?';
    } catch (e) { /* geo non-fatal */ }

    const reach = {};
    const targets = { tiktok: 'https://www.tiktok.com/', ig: 'https://www.instagram.com/', fb: 'https://www.facebook.com/' };
    for (const [name, url] of Object.entries(targets)) {
      try {
        const r = await page.goto(url, { timeout: 30000, waitUntil: 'domcontentloaded' });
        reach[name] = r && r.status() < 500 ? 'ok' : `http${r ? r.status() : '?'}`;
      } catch (e) {
        reach[name] = 'blokir';
      }
    }
    return { ok: true, ip, geo, isp, latency, reach };
  } finally {
    await browser.close().catch(() => {});
  }
}

// ---- Ping ringan (TANPA browser — hemat kuota SIM, cocok untuk monitoring berkala) ----
// Satu koneksi CONNECT ke api.ipify.org:443 sekaligus membuktikan proxy hidup,
// mengukur latensi, dan mendapat IP keluar. Tidak membuka situs sosmed apa pun.
function pingLite(proxyStr) {
  return new Promise((resolve) => {
    const parts = String(proxyStr).split(':');
    const host = parts[0], port = +parts[1], user = parts[2] || '', pass = parts[3] || '';
    const t0 = Date.now();
    const sock = net.connect(port, host);
    const done = (r) => { try { sock.destroy(); } catch (e) { /* abaikan */ } resolve({ latency: Date.now() - t0, ...r }); };
    const timer = setTimeout(() => done({ error: 'timeout 12 dtk (HP mati/Tailscale putus?)' }), 12000);
    sock.on('error', () => { clearTimeout(timer); done({ error: 'tak tersambung' }); });
    sock.on('connect', () => {
      const auth = user ? `Proxy-Authorization: Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}\r\n` : '';
      sock.write(`CONNECT api.ipify.org:443 HTTP/1.1\r\nHost: api.ipify.org:443\r\n${auth}\r\n`);
    });
    let head = '';
    sock.on('data', (chunk) => {
      head += chunk.toString();
      if (!head.includes('\r\n\r\n')) return;
      if (!/ 200 /.test(head.split('\r\n')[0])) { clearTimeout(timer); done({ error: 'proxy menolak (auth salah?)' }); return; }
      sock.removeAllListeners('data');
      const tls = require('tls');
      const t = tls.connect({ socket: sock, servername: 'api.ipify.org' }, () => {
        t.write('GET / HTTP/1.1\r\nHost: api.ipify.org\r\nConnection: close\r\n\r\n');
      });
      let body = '';
      t.on('data', (c) => { body += c.toString(); });
      t.on('close', () => {
        clearTimeout(timer);
        const ip = (body.split('\r\n\r\n').pop() || '').trim();
        done(/^\d+\.\d+\.\d+\.\d+$/.test(ip) ? { ip } : { error: 'ip tak terbaca' });
      });
      t.on('error', () => { clearTimeout(timer); done({ error: 'gagal baca ip' }); });
    });
  });
}

// ---- Monitor ringan berkala: hidup/mati + latensi + deteksi ganti IP ----
// Tanpa browser & tanpa situs sosmed → bisa dijalankan tiap 10-15 menit tanpa
// menguras kuota SIM. Ganti IP terdeteksi otomatis (CGNAT operator berputar).
const monitorJob = { running: false, lastRun: null, lastResults: [] };

async function monitorOnce() {
  if (monitorJob.running) return { error: 'already_running' };
  const pool = parsePool();
  if (!pool.length) return { error: 'pool kosong — isi proxies-pool.txt dulu' };
  await syncToDb();
  await db.load();
  const entries = await db.rawAll(`SELECT * FROM proxies WHERE source = ? ORDER BY id`, [SOURCE]);
  monitorJob.running = true;
  const results = await mapLimit(entries, Math.max(1, Number(process.env.POOL_CHECK_CONCURRENCY || '3')), async (p) => {
    const prev = await db.rawAll(`SELECT exit_ip, alive FROM phone_health_log WHERE proxy = ? ORDER BY id DESC LIMIT 1`, [p.value]);
    const prevIp = prev[0] ? prev[0].exit_ip : null;
    const prevAlive = prev[0] ? !!prev[0].alive : true;
    const r = await pingLite(p.value);
    const alive = !!r.ip;
    const row = {
      label: p.label, proxy: p.value, alive,
      latency: alive ? r.latency : null,
      ip: r.ip || null,
      prevIp,
      ipChanged: !!(alive && prevIp && r.ip !== prevIp),
      wasDead: !prevAlive && alive,
      error: alive ? null : r.error,
    };
    await db.addPhoneHealthLog({
      proxy: p.value, label: p.label, alive,
      latencyMs: row.latency, exitIp: row.ip, prevIp, ipChanged: row.ipChanged,
      error: row.error,
    });
    return row;
  });
  monitorJob.running = false;
  monitorJob.lastRun = new Date().toISOString();
  monitorJob.lastResults = results;
  await alertFleet(results).catch(() => {}); // notifikasi Telegram/WA — non-fatal
  await alertRecovery(results).catch(() => {}); // konfirmasi HP hidup lagi
  return { ok: true, at: monitorJob.lastRun, results };
}

// ---- Notifikasi fleet: HP mati & ganti IP → Telegram/Discord/WA (jika dikonfigurasi) ----
// Anti-spam: mati hanya alert pada transisi (hidup→mati), bukan tiap cek; ganti IP
// hanya alert bila FLEET_NOTIFY_IP_CHANGE=1 (default mati karena CGNAT sering berputar).
let notifMod = null;
function notifier() {
  if (!notifMod) notifMod = require('./notification-system');
  return notifMod;
}

async function alertFleet(results) {
  const dead = results.filter((r) => !r.alive);
  const changed = process.env.FLEET_NOTIFY_IP_CHANGE === '1'
    ? results.filter((r) => r.alive && r.ipChanged)
    : [];
  if (!dead.length && !changed.length) return;

  const lines = [];
  for (const r of dead) lines.push(`❌ ${r.label} MATI — ${r.error || 'tak diketahui'}`);
  for (const r of changed) lines.push(`🔄 ${r.label} ganti IP: ${r.prevIp} → ${r.ip}`);
  const msg = lines.join('\n');

  try {
    await notifier().send(msg, { title: 'Fleet HP Monitor', priority: 'high', channels: ['telegram', 'whatsapp', 'discord'] });
  } catch (e) { /* notif non-fatal */ }
}

// Alert juga ketika HP yang MATI kembali hidup (konfirmasi pemulihan).
async function alertRecovery(results) {
  const recovered = results.filter((r) => r.alive && r.wasDead);
  if (!recovered.length) return;
  const msg = recovered.map((r) => `✅ ${r.label} kembali hidup — IP ${r.ip}, ${r.latency} ms`).join('\n');
  try {
    await notifier().send(msg, { title: 'Fleet HP Pemulihan', priority: 'normal', channels: ['telegram', 'whatsapp', 'discord'] });
  } catch (e) { /* notif non-fatal */ }
}

function monitorStatus() {
  return { running: monitorJob.running, lastRun: monitorJob.lastRun, results: monitorJob.lastResults };
}

// ---- Statistik fleet (dashboard): uptime 7 hari, latensi, ganti IP, ikatan akun ----
async function fleetStats() {
  await db.load();
  const stats = await db.phoneHealthStats();
  const out = [];
  for (const s of stats) {
    const bound = await db.rawAll(`SELECT COUNT(*) AS c FROM accounts WHERE proxy = ?`, [s.proxy]);
    const signups24h = s.last_ip ? db.countSignups24h(s.last_ip) : 0;
    out.push({
      proxy: s.proxy, label: s.label, checks: s.checks,
      uptimePct: s.uptime_pct, avgLatency: s.avg_latency,
      ipChanges: s.ip_changes || 0, tiktokOk: s.tiktok_ok || 0,
      lastIp: s.last_ip, lastCheck: s.last_check,
      boundAccounts: bound[0] ? bound[0].c : 0,
      signups24h,
    });
  }
  return out;
}

// ---- Auto-monitor (opsional): set PHONE_MONITOR_INTERVAL_MIN=15 di .env ----
let autoTimer = null;
function startAutoMonitor() {
  const min = Number(process.env.PHONE_MONITOR_INTERVAL_MIN || '0');
  if (!min || autoTimer) return;
  autoTimer = setInterval(() => { monitorOnce().catch(() => {}); }, min * 60000);
  if (autoTimer.unref) autoTimer.unref();
  console.log(`[phone-pool] auto-monitor aktif tiap ${min} menit (${parsePool().length} HP)`);
}

// ---- Health-check seluruh fleet (job background + laporan) ----

const job = { running: false, startedAt: null, finishedAt: null, progress: '', results: [] };
let lastReport = null;
try { if (fs.existsSync(REPORT_FILE)) lastReport = JSON.parse(fs.readFileSync(REPORT_FILE, 'utf8')); } catch (e) { /* laporan opsional */ }

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length || 1) }, async () => {
    while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx], idx); }
  }));
  return out;
}

async function startHealth() {
  if (job.running) return { error: 'already_running' };
  const sync = await syncToDb();
  if (!sync.poolSize) return { error: 'pool kosong — isi proxies-pool.txt dulu (host:port:user:pass | Label)' };

  const entries = await db.rawAll(`SELECT * FROM proxies WHERE source = ? ORDER BY id`, [SOURCE]);
  job.running = true;
  job.startedAt = new Date().toISOString();
  job.finishedAt = null;
  job.progress = `0/${entries.length}`;
  job.results = [];

  // Fire-and-forget: endpoint health/status dipakai UI untuk polling progres.
  void (async () => {
    const results = await mapLimit(entries, CONCURRENCY, async (p, idx) => {
      let r;
      try {
        const chk = await checkProxy(p.value);
        const status = chk.ok ? 'active' : 'dead';
        db.run(`UPDATE proxies SET status = ?, response_time = ?, last_tested_at = datetime('now') WHERE id = ?`, [status, chk.latency || null, p.id]);
        db.save();
        // Tulis juga ke log monitoring supaya badge TikTok/IG/FB terisi di Fleet.
        const prevH = await db.rawAll(`SELECT exit_ip FROM phone_health_log WHERE proxy = ? AND exit_ip IS NOT NULL ORDER BY id DESC LIMIT 1`, [p.value]);
        await db.addPhoneHealthLog({
          proxy: p.value, label: p.label, alive: chk.ok,
          latencyMs: chk.latency, exitIp: chk.ip,
          prevIp: prevH[0] ? prevH[0].exit_ip : null,
          ipChanged: !!(chk.ip && prevH[0] && prevH[0].exit_ip !== chk.ip),
          tiktokOk: chk.reach && chk.reach.tiktok === 'ok' ? 1 : 0,
          igOk: chk.reach && chk.reach.ig === 'ok' ? 1 : 0,
          fbOk: chk.reach && chk.reach.fb === 'ok' ? 1 : 0,
        });
        r = { label: p.label, value: p.value, status, ...chk };
      } catch (e) {
        db.run(`UPDATE proxies SET status = 'dead', last_tested_at = datetime('now') WHERE id = ?`, [p.id]);
        db.save();
        await db.addPhoneHealthLog({ proxy: p.value, label: p.label, alive: false, error: String(e.message).split('\n')[0] }).catch(() => {});
        r = { label: p.label, value: p.value, status: 'dead', ok: false, error: String(e.message).split('\n')[0] };
      }
      job.results[idx] = r;
      job.progress = `${job.results.filter(Boolean).length}/${entries.length}`;
      return r;
    });
    const report = {
      finishedAt: new Date().toISOString(),
      total: entries.length,
      alive: results.filter((r) => r && r.status === 'active').length,
      tiktokOk: results.filter((r) => r && r.reach && r.reach.tiktok === 'ok').length,
      results,
    };
    lastReport = report;
    try {
      fs.mkdirSync(path.dirname(REPORT_FILE), { recursive: true });
      fs.writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2));
    } catch (e) { /* laporan opsional */ }
    job.running = false;
    job.finishedAt = report.finishedAt;
    job.progress = `${entries.length}/${entries.length}`;
  })();

  return { ok: true, total: entries.length };
}

function status() {
  return { running: job.running, progress: job.progress, startedAt: job.startedAt, finishedAt: job.finishedAt, results: job.results.filter(Boolean) };
}

function lastReportValue() { return lastReport; }

module.exports = {
  parsePool, syncToDb, checkProxy, startHealth, status, lastReportValue,
  pingLite, monitorOnce, monitorStatus, fleetStats, startAutoMonitor,
};
