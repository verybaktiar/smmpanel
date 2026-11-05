'use strict';

require('dotenv').config();

const express = require('express');
const http = require('http');
const path = require('path');
const fsp = require('fs').promises;
const { spawn, exec } = require('child_process');
const multer = require('multer');
const db = require('./src/db');
const { setupSecurity, requireApiKey, optionalApiKey } = require('./src/security');
const { initWebSocket, broadcastNotification } = require('./src/websocket');
const healthChecker = require('./src/health-checker');
const proxyValidator = require('./src/proxy-validator');
const queueManager = require('./src/queue-manager');
const batchRunner = require('./src/batch-runner');
const accountRotation = require('./src/account-rotation');
const { ContentSpinner, TemplateManager } = require('./src/content-spinner');
const accountWarming = require('./src/account-warming');
const backupSystem = require('./src/backup-system');
const captchaSolver = require('./src/captcha-solver');
const notificationSystem = require('./src/notification-system');
const aiContentGenerator = require('./src/ai-content-generator');
const aiConfig = require('./src/ai-config');
const followingAutomation = require('./src/following-automation');
const FacebookAccountCreator = require('./src/fb-account-creator');
const createRunner = require('./src/create-runner');
const gmailRunner = require('./src/gmail-creator-runner');
const farm = require('./src/adb-farm');
const farmWatchdog = require('./src/farm-watchdog');
const accountGate = require('./src/account-gate');
const commentAutomation = require('./src/comment-automation');
const dmAutomation = require('./src/dm-automation');
const storyAutomation = require('./src/story-automation');

const app = express();
const server = http.createServer(app);

// Helper async route — HARUS didefinisikan sebelum route yang memakainya
// (route /api/mail/* memakai ini dan berada di atas definisi lama).
const asyncH = (fn) => (req, res, next) => fn(req, res, next).catch(next);

// Setup security middleware
const { strictLimiter } = setupSecurity(app);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
if (process.env.API_KEY) app.use('/api/', requireApiKey);
app.get('/config.js', (req, res) => {
  res.type('application/javascript').send(`window.__SMM_API_KEY = ${JSON.stringify(process.env.API_KEY || '')};`);
});
// Versi JSON untuk frontend React (dipakai api.js via ensureKey, tanpa script tag)
app.get('/config.json', (req, res) => {
  res.json({ api_key: process.env.API_KEY || '' });
});

// Initialize WebSocket
const io = initWebSocket(server);

// Mail Worker (Cloudflare tempmail-worker) — pengganti Exim/Dovecot myVesta
// untuk email MASUK/OTP. myVesta tetap dipakai untuk SMTP kirim.
// Copy di _extract TIDAK diubah; adaptor CJS ada di lib/mail-worker/.
const { MailWorkerClient } = require('./lib/mail-worker');
const { createMailWebhookReceiver } = require('./lib/mail-worker/webhook');
const mailWorker = new MailWorkerClient();
app.get('/api/mail/health', asyncH(async (req, res) => {
  if (!mailWorker.configured) return res.status(503).json({ ok: false, error: 'mail_worker_not_configured' });
  const h = await mailWorker.health();
  res.json({ ok: true, worker: h });
}));
app.post('/api/mail/inboxes', asyncH(async (req, res) => {
  const { alias, domain } = (req.body || {});
  const inbox = await mailWorker.createInbox(alias, domain);
  res.status(201).json({ inbox });
}));
app.get('/api/mail/inboxes/:alias/messages', asyncH(async (req, res) => {
  const messages = await mailWorker.listMessages(req.params.alias);
  res.json({ messages });
}));
app.get('/api/mail/messages/:id', asyncH(async (req, res) => {
  const message = await mailWorker.getMessage(req.params.id);
  res.json({ message });
}));
app.post('/api/mail/webhook', asyncH(async (req, res) => {
  const handler = createMailWebhookReceiver({ client: mailWorker });
  const r = await handler(req.body, req.headers);
  res.status(r.status).json(r.body);
}));

// Upload media (gambar/video) untuk konten posting.
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, '_');
    cb(null, Date.now() + '_' + safe);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: Number(process.env.MAX_UPLOAD_BYTES || 10 * 1024 * 1024) },
  fileFilter: (req, file, cb) => {
    const allowed = /^(image|video)\//i.test(file.mimetype);
    cb(allowed ? null : new Error('Unsupported media type'), allowed);
  }
});

const MAX_CONTENT_LEN = 5000; // batas karakter konten posting

// dipakai route /api/mail/* yang didefinisikan lebih atas — deklarasi const harus
// sebelum pemakaian pertama (dulu let-nya di sini ATAS malah error saat start).

// ---- API ----

// Ringkasan statistik dashboard
app.get('/api/stats', asyncH(async (req, res) => {
  const accounts = (await db.rawAll(`SELECT COUNT(*) AS c FROM accounts`))[0].c;
  const schedulesToday = (await db.rawAll(`SELECT COUNT(*) AS c FROM schedules WHERE date(scheduled_at)=date('now')`))[0].c;
  const postedToday = (await db.rawAll(`SELECT COUNT(*) AS c FROM schedules WHERE status='done' AND date(posted_at)=date('now')`))[0].c;
  const pending = (await db.rawAll(`SELECT COUNT(*) AS c FROM schedules WHERE status='pending'`))[0].c;
  const logErrors = (await db.rawAll(`SELECT COUNT(*) AS c FROM post_log WHERE status IN ('post_failed','login_failed','error')`))[0].c;
  // D10: dashboard memakai jendela 24 jam supaya sebanding dengan "Jadwal Hari Ini";
  // total sepanjang waktu tetap dikirim untuk tooltip dan halaman Monitoring.
  const logErrors24h = (await db.rawAll(`SELECT COUNT(*) AS c FROM post_log WHERE status IN ('post_failed','login_failed','error') AND created_at >= datetime('now','-1 day')`))[0].c;
  res.json({ accounts, schedulesToday, postedToday, pending, logErrors, logErrors24h });
}));

// Tren 7 hari: jumlah akun beraktivitas per hari apa pun hasilnya (posted/login/gagal),
// dasar grafik Dashboard. Data kecil tak menjadi kendala: hanya hari ber-log yang terisi.
app.get('/api/stats/trend', asyncH(async (req, res) => {
  const rows = await db.rawAll(`SELECT date(created_at) AS d, COUNT(DISTINCT account_id) AS c
    FROM post_log WHERE created_at >= date('now','-6 days') GROUP BY d`);
  res.json(rows);
}));

// Daftar akun
// Map { accountId: { ip, country, country_code, city, created_at } } — dipakai kolom "IP Terakhir".
// HARUS terdaftar SEBELUM /api/accounts/:id supaya "ip-latest" tak tertelan param :id.
app.get('/api/accounts/ip-latest', asyncH(async (req, res) => {
  const map = {};
  for (const r of db.latestIpByAccount()) {
    map[r.account_id] = { ip: r.ip, country: r.country, country_code: r.country_code, city: r.city, created_at: r.created_at };
  }
  res.json(map);
}));

app.get('/api/accounts', asyncH(async (req, res) => {
  const rows = await db.listAccounts();
  // keepOpen: browser aktivasi akun ini masih dipegang proses keep-open.
  for (const r of rows) {
    if (r) r.keepOpen = createRunner.activationKeepOpen(r).open;
  }
  res.json(rows);
}));

// Peta { idAkun: keepOpen } — dipakai panel untuk menyegarkan penanda browser
// terbuka berkala tanpa menarik ulang seluruh daftar akun.
app.get('/api/keep-open', asyncH(async (req, res) => {
  res.json(await createRunner.keepOpenMap());
}));

// ---- Phone Farm (ADB) ----
const FARM_SHOT_DIR = path.join(__dirname, 'public', 'farm');
try { require('fs').mkdirSync(FARM_SHOT_DIR, { recursive: true }); } catch (e) { /* abaikan */ }

app.get('/api/farm/devices', asyncH(async (req, res) => {
  let devices;
  try { devices = await farm.listDevices(); }
  catch (e) { return res.status(503).json({ error: 'ADB tidak berjalan: ' + e.message.slice(0, 120) }); }
  const detailed = await Promise.all(devices.map((d) => farm.deviceInfo(d.id).catch(() => d)));
  res.json(detailed);
}));

// Diagnosa biner adb untuk panel: biner mana yang dipakai dan mana yang rusak.
// Dipanggil saat halaman Phone Farm dibuka dan saat tombol cek ulang ditekan,
// bukan ikut polling 8 detik: satu diagnosa menjalankan beberapa proses adb.
app.get('/api/farm/adb', asyncH(async (req, res) => {
  const rows = await farm.diagnose();
  const sehat = rows.filter((r) => r.ok);
  // Urutan sama dengan adbPath(): yang melihat HP menang, lalu kandidat sehat pertama.
  const pilih = sehat.find((r) => r.devices > 0) || sehat[0] || null;
  res.json({ dipakai: pilih ? pilih.bin : null, devices: pilih ? pilih.devices : 0, rows });
}));

// ---- Room tamu (user Android kedua): cek dukungan per HP ----
// Probe jalan di latar: UI poll /api/farm/rooms dan baris HP menyusul satu-satu.
const rooms = require('./src/adb-rooms');
const roomCache = { running: false, at: null, rows: [], error: null };
const roomProbeBusy = new Set();
async function probeRoomAll() {
  roomCache.error = null;
  roomCache.rows = [];
  const devices = await farm.listDevices().catch(() => []);
  if (!devices.length) {
    roomCache.error = 'Belum ada HP terlihat adb. Colok USB lalu aktifkan USB debugging, lalu uji lagi.';
  }
  for (const d of devices) {
    if (orchestra.deviceState(d.id).state === 'working') {
      roomCache.rows.push({ id: d.id, model: d.model, verdict: 'dilewati', pesan: 'HP sedang menjalankan job create. Tes dilewati supaya room tidak tertukar.' });
      continue;
    }
    if (roomProbeBusy.has(d.id)) {
      roomCache.rows.push({ id: d.id, model: d.model, verdict: 'dilewati', pesan: 'Deteksi room HP ini sedang berjalan. Tunggu sampai selesai.' });
      continue;
    }
    const row = await rooms.probeDevice(d.id).catch((e) => ({
      id: d.id, model: d.model, verdict: 'gagal-baca', pesan: String(e.message || e).slice(0, 160), langkah: []
    }));
    roomCache.rows.push(row);
  }
  roomCache.at = new Date().toISOString();
  roomCache.running = false;
}
app.get('/api/farm/rooms', asyncH(async (req, res) => {
  res.json({ running: roomCache.running, at: roomCache.at, error: roomCache.error, rows: roomCache.rows });
}));
app.post('/api/farm/rooms/probe', asyncH(async (req, res) => {
  if (!roomCache.running) {
    roomCache.running = true;
    roomCache.at = null;
    void probeRoomAll().catch((e) => { roomCache.running = false; roomCache.error = String(e.message || e).slice(0, 160); });
  }
  res.json({ started: true });
}));
// Probe room untuk satu HP dari kartu IG Via HP. Probe membuat user Android
// sementara, mirror IG, lalu menghapusnya. Jangan jalan bersamaan dengan job.
app.post('/api/create/ig/room-probe', asyncH(async (req, res) => {
  const deviceId = String((req.body || {}).deviceId || '').trim();
  if (!deviceId) return res.status(400).json({ error: 'deviceId wajib' });
  const devs = await farm.listDevices().catch(() => []);
  if (!devs.some((d) => d.id === deviceId)) return res.status(400).json({ error: 'HP tidak terbaca ADB' });
  if (roomCache.running) return res.status(409).json({ error: 'Probe room Phone Farm sedang berjalan. Tunggu sampai selesai.' });
  if (roomProbeBusy.has(deviceId)) return res.status(409).json({ error: 'Deteksi room HP ini sedang berjalan.' });
  const st = orchestra.deviceState(deviceId);
  if (st.state !== 'idle') {
    return res.status(409).json({ error: st.state === 'working' ? 'HP sedang menjalankan job. Tunggu selesai sebelum deteksi room.' : 'HP sedang cooldown. Deteksi room bisa dicoba setelah cooldown.' });
  }
  roomProbeBusy.add(deviceId);
  try {
    const row = await rooms.probeDevice(deviceId);
    const at = new Date().toISOString();
    row.at = row.at || at;
    const idx = roomCache.rows.findIndex((r) => r.id === deviceId);
    if (idx >= 0) roomCache.rows[idx] = row;
    else roomCache.rows.push(row);
    roomCache.at = at;
    roomCache.error = null;
    res.json({ ok: true, room: row });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e).slice(0, 180) });
  } finally {
    roomProbeBusy.delete(deviceId);
  }
}));

// Status watchdog: episode gagal Phone Farm yang jadi bahan alarm notifikasi.
app.get('/api/farm/watchdog', asyncH(async (req, res) => {
  res.json(farmWatchdog.status());
}));

// Overview monitoring: device + state orkestra (idle/working/locked) + job terakhir
// + create terakhir + detail SIM/IP (cache) — satu panggilan untuk halaman Farm.
let farmDetailBusy = false;
async function refreshFarmDetails(deviceIds) {
  if (farmDetailBusy || !deviceIds.length) return;
  farmDetailBusy = true;
  try { await Promise.all(deviceIds.map((id) => hygiene.refreshDeviceDetails(id).catch(() => {}))); }
  finally { farmDetailBusy = false; }
}
app.get('/api/farm/overview', asyncH(async (req, res) => {
  // Alasan ADB gagal diteruskan ke UI: tanpa ini panel cuma bilang "belum ada HP",
  // padahal masalahnya di adb yang rusak, bukan HP yang belum dicolok.
  let adbError = null;
  const devices = await farm.listDevices().catch((e) => { adbError = String(e.message || e).slice(0, 160); return []; });
  const detailed = await Promise.all(devices.map((d) => farm.deviceInfo(d.id).catch(() => d)));
  const jobs = orchestra.listJobs('', 200);
  const rows = detailed.map((d) => {
    const st = orchestra.deviceState(d.id);
    const active = st.state === 'working' ? jobs.find((j) => j.id === st.jobId) : null;
    const last = jobs.find((j) => j.deviceId === d.id);
    const lastCreate = orchestra.lastCreate(d.id) || null;
    const det = hygiene.cachedDeviceDetails(d.id);
    return { ...d, state: st.state, lockReason: st.reason || null, activeJob: active || null, lastJob: last || null, lastCreate, details: det };
  });
  // Refresh detail SIM/IP di latar (IP dari HP butuh 3-15 dtk — tak boleh blok respons).
  void refreshFarmDetails(devices.map((d) => d.id));
  res.json({ devices: rows, jobs: jobs.slice(0, 25), adbError });
}));

let farmShotBusy = false;
app.get('/api/farm/shot/:id', asyncH(async (req, res) => {
  // request yang datang saat capture jalan: langsung kasih file terakhir (jangan antre)
  if (farmShotBusy) {
    const lastJpg = path.join(FARM_SHOT_DIR, `${req.params.id}.jpg`);
    const lastPng = path.join(FARM_SHOT_DIR, `${req.params.id}.png`);
    const last = require('fs').existsSync(lastJpg) ? lastJpg : lastPng;
    return res.json({ shot: `/farm/${path.basename(last)}?t=${Date.now()}`, cached: true });
  }
  farmShotBusy = true;
  try {
    const t0 = Date.now();
    const file = await farm.screenshot(req.params.id, path.join(FARM_SHOT_DIR, `${req.params.id}.png`));
    res.json({ shot: `/farm/${path.basename(file)}?t=${Date.now()}`, took_ms: Date.now() - t0 });
  } finally {
    farmShotBusy = false;
  }
}));

app.post('/api/farm/tap', asyncH(async (req, res) => {
  const { id, x, y } = req.body || {};
  if (!id || x === undefined || y === undefined) return res.status(400).json({ error: 'id,x,y wajib' });
  await farm.tap(id, Math.round(x), Math.round(y));
  res.json({ ok: true });
}));

app.post('/api/farm/swipe', asyncH(async (req, res) => {
  const { id, x1, y1, x2, y2 } = req.body || {};
  if (!id || x1 === undefined) return res.status(400).json({ error: 'id,x1,y1,x2,y2 wajib' });
  await farm.swipe(id, Math.round(x1), Math.round(y1), Math.round(x2), Math.round(y2));
  res.json({ ok: true });
}));

app.post('/api/farm/open', asyncH(async (req, res) => {
  const { id, app } = req.body || {};
  const pkg = farm.APPS[app] || app;
  if (!id || !pkg) return res.status(400).json({ error: 'id,app wajib' });
  await farm.openApp(id, pkg);
  res.json({ ok: true, pkg });
}));

app.get('/api/farm/ui/:id', asyncH(async (req, res) => {
  res.json(await farm.uiDump(req.params.id));
}));

app.post('/api/farm/text', asyncH(async (req, res) => {
  const { id, text } = req.body || {};
  if (!id || !text) return res.status(400).json({ error: 'id,text wajib' });
  await farm.typeText(id, text);
  res.json({ ok: true });
}));

app.post('/api/farm/key', asyncH(async (req, res) => {
  const { id, code } = req.body || {};
  if (!id || !code) return res.status(400).json({ error: 'id,code wajib' });
  await farm.keyEvent(id, code);
  res.json({ ok: true });
}));

app.post('/api/farm/live', asyncH(async (req, res) => {
  const { id, title } = req.body || {};
  if (!id) return res.status(400).json({ error: 'id wajib' });
  await farm.openLive(id, title || id);
  res.json({ ok: true });
}));

// Live semua: 1 window scrcpy per HP, tertata ubin otomatis (3 kolom)
app.post('/api/farm/live-all', asyncH(async (req, res) => {
  const devices = await farm.listDevices();
  if (!devices.length) return res.status(400).json({ error: 'tidak ada HP' });
  const cols = devices.length <= 2 ? devices.length : 3;
  const TW = 400, TH = 700;
  let i = 0;
  for (const d of devices) {
    const geom = { x: 200 + (i % cols) * (TW + 10), y: 20 + Math.floor(i / cols) * (TH + 40), w: TW, h: TH };
    try { await farm.openLive(d.id, d.id, geom); } catch (e) { /* lanjut HP berikut */ }
    i++;
  }
  res.json({ ok: true, opened: devices.length });
}));

// Broadcast: 1 aksi ke SEMUA HP yang colok, paralel (except = kecualikan 1 HP, utk mode cermin)
app.post('/api/farm/broadcast', asyncH(async (req, res) => {
  const { op, x, y, x1, y1, x2, y2, app, code, text, except } = req.body || {};
  const devices = (await farm.listDevices()).filter((d) => d.id !== except);
  if (!devices.length) return res.status(400).json({ error: 'tidak ada HP' });
  const runOne = async (d) => {
    try {
      if (op === 'tap') await farm.tap(d.id, Math.round(x), Math.round(y));
      else if (op === 'swipe') await farm.swipe(d.id, Math.round(x1), Math.round(y1), Math.round(x2), Math.round(y2));
      else if (op === 'open') await farm.openApp(d.id, farm.APPS[app] || app);
      else if (op === 'key') await farm.keyEvent(d.id, code);
      else if (op === 'text') await farm.typeText(d.id, text);
      else throw new Error('op tidak dikenal: ' + op);
      return { id: d.id, ok: true };
    } catch (e) {
      return { id: d.id, ok: false, error: e.message.slice(0, 100) };
    }
  };
  res.json({ results: await Promise.all(devices.map(runOne)) });
}));

// Ringkasan statistik per akun utk monitoring.
// DITEMPATKAN SEBELUM /api/accounts/:id agar tidak tertangkap sebagai :id
app.get('/api/accounts/summary', asyncH(async (req, res) => {
  const rows = await db.rawAll(`
    SELECT a.id, a.name, a.platform, a.status,
      COUNT(CASE WHEN l.status LIKE '%posted%' OR l.status='done' THEN 1 END) AS berhasil,
      COUNT(CASE WHEN l.status LIKE '%fail%' OR l.status='error' OR l.status='checkpoint' THEN 1 END) AS gagal,
      COUNT(CASE WHEN l.status='login_ok' THEN 1 END) AS login_ok,
      COUNT(l.id) AS total
    FROM accounts a LEFT JOIN post_log l ON l.account_id = a.id
    GROUP BY a.id
    ORDER BY a.platform, a.id DESC
  `);
  res.json(rows);
}));

// Get akun by ID (dengan password decrypt untuk edit)
app.get('/api/accounts/:id', asyncH(async (req, res) => {
  const id = Number(req.params.id);
  const account = await db.getAccountById(id);
  if (!account) return res.status(404).json({ error: 'Akun tidak ditemukan' });
  const { password_enc, ...safeAccount } = account;
  res.json(safeAccount);
}));

// Daftar jadwal (gabung dengan akun & konten)
app.get('/api/schedules', asyncH(async (req, res) => {
  const rows = await db.rawAll(`
    SELECT s.id, s.scheduled_at, s.status, s.posted_at, s.repeat, s.account_id,
      a.name AS account, a.platform, c.text AS content
    FROM schedules s JOIN accounts a ON a.id=s.account_id JOIN contents c ON c.id=s.content_id
    ORDER BY s.scheduled_at DESC
  `);
  res.json(rows);
}));

// Daftar log
app.get('/api/logs', asyncH(async (req, res) => {
  const rows = await db.rawAll(`
    SELECT l.id, l.status, l.message, l.content_text, l.created_at, a.name AS account, a.platform
    FROM post_log l JOIN accounts a ON a.id=l.account_id
    ORDER BY l.created_at DESC LIMIT 100
  `);
  res.json(rows);
}));

// Riwayat posting per akun (post_log + jadwal)
app.get('/api/accounts/:id/history', asyncH(async (req, res) => {
  const id = Number(req.params.id);
  const rows = await db.rawAll(`
    SELECT l.id, l.status, l.message, l.content_text, l.created_at, a.name AS account, a.platform
    FROM post_log l JOIN accounts a ON a.id=l.account_id
    WHERE l.account_id = ?
    ORDER BY l.created_at DESC LIMIT 100
  `, [id]);
  res.json(rows);
}));

// Tambah akun via form
app.post('/api/accounts', asyncH(async (req, res) => {
  const { name, email, password, proxy, platform } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'name, email, password wajib' });
  }
  const id = await db.addAccount({ name, email, password, proxy: proxy || undefined, platform: platform || 'fb' });
  res.json({ id });
}));

// Bulk import akun dari file upload (TXT/CSV)
// Format: name|email|password|platform|proxy (proxy opsional)
// atau: name,email,password,platform,proxy
app.post('/api/accounts/bulk-import', upload.single('file'), asyncH(async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'File wajib diupload' });
  }

  const fileContent = fs.readFileSync(req.file.path, 'utf-8');
  const lines = fileContent.split(/\r?\n/).filter(line => line.trim());
  
  const results = { success: [], failed: [], total: lines.length };
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith('#')) continue; // Skip empty lines & comments
    
    // Deteksi delimiter (| atau ,)
    const delimiter = line.includes('|') ? '|' : ',';
    const parts = line.split(delimiter).map(p => p.trim());
    
    if (parts.length < 3) {
      results.failed.push({ line: i + 1, data: line, reason: 'Format tidak valid (minimal: name|email|password)' });
      continue;
    }
    
    const [name, email, password, platform = 'fb', proxy = ''] = parts;
    
    if (!name || !email || !password) {
      results.failed.push({ line: i + 1, data: line, reason: 'name, email, atau password kosong' });
      continue;
    }
    
    try {
      const id = await db.addAccount({
        name: name,
        email: email,
        password: password,
        platform: platform || 'fb',
        proxy: proxy || undefined
      });
      results.success.push({ line: i + 1, name, email, platform, id });
    } catch (err) {
      results.failed.push({ line: i + 1, data: line, reason: err.message });
    }
  }
  
  // Hapus file upload setelah diproses
  try { fs.unlinkSync(req.file.path); } catch (e) {}
  
  res.json({
    imported: results.success.length,
    failed: results.failed.length,
    total: results.total,
    details: results
  });
}));

// ---- Stok Gmail (pool fresh untuk AutoCreate) ----
// Sumber: hasil Gmail Creator Pro (tools/gmail-creator, lihat README folder itu)
// atau impor manual. Password tersimpan terenkripsi dan tidak pernah dikirim balik
// oleh endpoint daftar; hanya /api/gmail/claim yang mengeluarkan kredensial.
app.get('/api/gmail', asyncH(async (req, res) => {
  res.json(await db.listGmail(req.query.limit ? Number(req.query.limit) : 100));
}));

app.get('/api/gmail/stats', asyncH(async (req, res) => {
  const stats = await db.gmailStats();
  const run = gmailRunner.status();
  res.json({ ...stats, hasBinary: gmailRunner.hasExe(), hasPython: gmailRunner.hasInfinity(), job: { status: run.status, imported: run.imported || 0 } });
}));

// Kode TOTP 6 digit on-demand: panel menghitung sendiri dari secret terenkripsi,
// jadi tidak perlu buka Google Authenticator satu per satu saat login meminta 2FA.
app.get('/api/gmail/totp/:id', strictLimiter, asyncH(async (req, res) => {
  const r = await db.gmailTotpCode(Number(req.params.id));
  if (r.error === 'tidak_ditemukan') return res.status(404).json({ error: r.error });
  if (r.error) return res.status(409).json({ error: r.error });
  res.json(r);
}));

// 2FA akun panel (paritas /api/gmail/totp): paste kunci saat operator sudah
// punya teksnya (mis. dari layar setup atau catatan), panel simpan terenkripsi.
// Kode live dihitung lewat GET kode — kunci tidak pernah dikirim balik.
app.post('/api/accounts/:id/totp', strictLimiter, asyncH(async (req, res) => {
  const b = req.body || {};
  const r = await db.setAccountTotp(Number(req.params.id), typeof b.totpSecret === 'string' ? b.totpSecret : (b.totpSecret === null ? null : ''));
  if (r.error === 'tidak_ditemukan') return res.status(404).json({ error: r.error });
  if (r.error) return res.status(409).json({ error: r.error });
  res.json(r);
}));

app.get('/api/accounts/:id/totp', strictLimiter, asyncH(async (req, res) => {
  const r = await db.accountTotpCode(Number(req.params.id));
  if (r.error === 'tidak_ditemukan') return res.status(404).json({ error: r.error });
  if (r.error) return res.status(409).json({ error: r.error });
  res.json(r);
}));

// Tarik satu Gmail untuk create: tandai terpakai lalu kirim kredensialnya.
app.post('/api/gmail/claim', asyncH(async (req, res) => {
  const b = req.body || {};
  const platform = ['ig', 'fb', 'tiktok'].includes(b.platform) ? b.platform : 'ig';
  const got = await db.claimGmail(platform);
  if (!got) return res.status(409).json({ error: 'stok_gmail_habis' });
  broadcastNotification('success', `Gmail #${got.id} ditarik untuk AutoCreate ${platform.toUpperCase()}`);
  res.json(got);
}));

// Impor massal dari teks: JSON hasil Gmail Creator Pro atau baris email|sandi[|secret].
// source 'belian' menandai akun belian agar terpisah dari 'manual'/'hp-native'.
app.post('/api/gmail/import', strictLimiter, asyncH(async (req, res) => {
  const b = req.body || {};
  const text = String(b.text || '');
  if (!text.trim()) return res.status(400).json({ error: 'teks kosong' });
  const source = b.source === 'belian' ? 'belian' : 'manual';
  const r = await db.importGmailText(text, source);
  // Sertakan alasan per baris (maks 3) agar "dilewati" tidak jadi teka-teki.
  const det = (r.details || []).slice(0, 3).map((d) => `${d.email}: ${d.reason}`).join(', ');
  const more = (r.details || []).length > 3 ? ` (+${r.details.length - 3} lainnya)` : '';
  broadcastNotification('success', `${r.added} Gmail diimpor ke stok (${r.skipped} dilewati)${det ? ` ${det}${more}` : ''}`);
  res.json(r);
}));

app.delete('/api/gmail/:id', asyncH(async (req, res) => {
  const ok = await db.deleteGmail(Number(req.params.id));
  if (!ok) return res.status(404).json({ error: 'tidak ditemukan' });
  res.json({ ok: true });
}));

// ---- Login Gmail (tahap 1): email:password → Google, status per akun ----
// Mode 'headed' (default) atau 'headless' untuk batch. Job satu per akun.
const gmailLogin = require('./src/gmail-login');
const gmailOpen = require('./src/gmail-open-run');
app.post('/api/gmail/:id/login', strictLimiter, asyncH(async (req, res) => {
  const mode = ['headed', 'headless'].includes((req.body || {}).mode) ? req.body.mode : 'headed';
  // start() ASYNC (query DB + decrypt): tanpa await res.json(Promise) = {} dan
  // error path (409/404) tak pernah terkirim — klik Login dari UI terasa mati.
  const r = await gmailLogin.start(db, Number(req.params.id), mode, (req.body || {}).proxy || null,
    { noProxy: !!(req.body || {}).noProxy, manualCaptcha: !!(req.body || {}).manualCaptcha });
  if (r.error === 'already_running') return res.status(409).json(r);
  if (r.error) return res.status(404).json(r);
  broadcastNotification('info', `Login Gmail #${req.params.id} dimulai (${mode})`);
  res.json(r);
}));
app.get('/api/gmail/:id/login/status', asyncH(async (req, res) => {
  const st = gmailLogin.status(Number(req.params.id));
  // Auto-retry info: job bisa idle (child exit) tapi rencana login ulang otomatis
  // masih hidup — operator perlu tahu "menunggu retry, jangan tutup server".
  st.retry = gmailLogin.retryInfo(Number(req.params.id));
  res.json(st);
}));
// Riwayat percobaan login per akun (dipakai modal riwayat di halaman Stok Gmail).
app.get('/api/gmail/:id/login/log', asyncH(async (req, res) => {
  res.json(await db.listGmailLoginLog(Number(req.params.id), 10));
}));
app.post('/api/gmail/:id/login/stop', asyncH(async (req, res) => {
  const r = gmailLogin.stop(Number(req.params.id));
  if (r.error) return res.status(409).json(r);
  res.json(r);
}));

// Buka Gmail pakai sesi tersimpan (tanpa login ulang). Kolom login_status 'ok'
// di UI ganti tombol Login jadi Buka. Guard dobel spawn: status 'open' → 409.
app.post('/api/gmail/:id/open', strictLimiter, asyncH(async (req, res) => {
  const rows = await db.rawAll('SELECT id, email FROM gmail_pool WHERE id = ?', [Number(req.params.id)]);
  const row = rows && rows[0];
  if (!row) return res.status(404).json({ error: 'tidak_ditemukan' });
  const r = gmailOpen.start(row.id, row.email, { noProxy: !!(req.body || {}).noProxy }, (req.body || {}).proxy || null);
  if (r.error === 'already_open') return res.status(409).json(r);
  if (r.error) return res.status(400).json(r);
  res.json(r);
}));
app.get('/api/gmail/:id/open/status', asyncH(async (req, res) => {
  res.json(gmailOpen.status(Number(req.params.id)));
}));
app.post('/api/gmail/:id/open/stop', asyncH(async (req, res) => {
  const r = gmailOpen.stop(Number(req.params.id));
  if (r.error) return res.status(409).json(r);
  res.json(r);
}));

// Jalankan / hentikan Gmail Creator Pro (mode 1 akun) + status log live.
app.post('/api/gmail/run', strictLimiter, asyncH(async (req, res) => {
  const r = gmailRunner.start();
  if (r.error) return res.status(409).json({ error: r.error });
  res.json(r);
}));

app.get('/api/gmail/run/status', asyncH(async (req, res) => {
  res.json(gmailRunner.status());
}));

app.post('/api/gmail/run/stop', asyncH(async (req, res) => {
  const r = gmailRunner.stop();
  if (r.error) return res.status(409).json({ error: r.error });
  res.json(r);
}));

// Jawab prompt TUI tool (pilihan menu, jumlah akun, dll) via stdin proses.
// text kosong ("") berarti cukup Enter.
app.post('/api/gmail/run/input', asyncH(async (req, res) => {
  if (!(req.body) || typeof req.body.text !== 'string') {
    return res.status(400).json({ error: 'field text wajib (string, boleh kosong utk Enter)' });
  }
  const r = gmailRunner.input(req.body.text);
  if (r.error) return res.status(409).json({ error: r.error });
  res.json(r);
}));

// Arsip kelahiran Gmail native (creator HP via ADB): JSONL di logs/gmail-native-births.log.
// Baris rusak dilaporkan lewat `broken`, bukan menggagalkan endpoint; arsip belum ada = kosong.
app.get('/api/gmail-native/births', asyncH(async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 200, 1), 500);
  const rows = [];
  let broken = 0;
  try {
    const text = await fsp.readFile(path.join(__dirname, 'logs', 'gmail-native-births.log'), 'utf8');
    for (const line of text.split('\n')) {
      const t = line.trim();
      if (!t) continue;
      try { rows.push(JSON.parse(t)); } catch { broken += 1; }
    }
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
  rows.reverse(); // terbaru dulu untuk tabel
  res.json({ total: rows.length + broken, broken, rows: rows.slice(0, limit) });
}));

// ---- Gmail native: kontrol run creator HP dari panel ----
// Run dijalankan detached (proses lepas dari server), jadi restart panel tidak
// mematikan creator yang sedang jalan. PID dicatat di
// sessions/gmail-native-<label>/run.json sebagai kunci tunggal: mencegah
// dobel-run sekaligus menjadi dasar tombol Hentikan.
const nativeRunFile = (label) => path.join(__dirname, 'sessions', `gmail-native-${label}`, 'run.json');
const nativeBirthsFile = () => path.join(__dirname, 'logs', 'gmail-native-births.log');
const nativeLabel = (v) => (String(v || 'hp1').replace(/[^a-zA-Z0-9_-]/g, '') || 'hp1');

// Baca run.json dan uji pid masih hidup. Kunci basi (pid sudah mati tanpa
// sempat membersihkan dirinya) dihapus supaya run berikutnya tidak terblokir.
async function readNativeRun(label) {
  let run;
  try { run = JSON.parse(await fsp.readFile(nativeRunFile(label), 'utf8')); }
  catch { return null; }
  try { process.kill(run.pid, 0); } catch {
    await fsp.unlink(nativeRunFile(label)).catch(() => {});
    return null;
  }
  return run;
}

// Baris kelahiran terakhir yang valid, untuk "run terakhir" di status.
async function lastNativeBirth() {
  let text = '';
  try { text = await fsp.readFile(nativeBirthsFile(), 'utf8'); } catch { return null; }
  const lines = text.split('\n').filter((l) => l.trim());
  for (let i = lines.length - 1; i >= 0; i--) {
    try { return JSON.parse(lines[i]); } catch { /* baris rusak, lewati */ }
  }
  return null;
}

// Jalankan creator HP: spawn detached dengan output ke file log khusus run ini.
app.post('/api/gmail-native/run', strictLimiter, asyncH(async (req, res) => {
  const label = nativeLabel(req.body && req.body.label);
  const gender = (req.body && req.body.gender) === 'female' ? 'female' : 'male';
  const network = (req.body && req.body.network) || 'wifi';
  if (!['wifi', 'sim', 'skip_toggle'].includes(network)) {
    return res.status(400).json({ error: 'network harus wifi, sim, atau skip_toggle' });
  }
  if (await readNativeRun(label)) return res.status(409).json({ error: 'already_running' });
  const devs = await farm.listDevices().catch(() => []);
  if (!devs.length) return res.status(400).json({ error: 'no_device' });
  const serial = (req.body && devs.some((d) => d.id === req.body.serial)) ? req.body.serial : devs[0].id;

  const dir = path.join(__dirname, 'sessions', `gmail-native-${label}`);
  await fsp.mkdir(dir, { recursive: true });
  const startedAt = new Date().toISOString();
  const stamp = startedAt.replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '-');
  const logName = `gmail-native-run-${stamp}.log`;
  const logPath = path.join(__dirname, 'logs', logName);
  const args = [path.join('src', 'gmail-native-creator.js'), '--label', label, '--serial', serial, '--gender', gender];
  if (network === 'wifi') args.push('--wifi');
  if (network === 'skip_toggle') args.push('--sim-skip');

  const fh = await fsp.open(logPath, 'a');
  let child;
  try {
    child = spawn(process.execPath, args, {
      cwd: __dirname, detached: true, windowsHide: true, stdio: ['ignore', fh.fd, fh.fd],
    });
    child.unref();
  } finally {
    await fh.close().catch(() => {});
  }

  const run = { pid: child.pid, startedAt, label, serial, gender, network, logFile: logName };
  await fsp.writeFile(nativeRunFile(label), JSON.stringify(run, null, 2));
  res.json({ ok: true, run });
}));

// Status gabungan untuk strip status + tombol di halaman Buat Gmail / Kelahiran.
app.get('/api/gmail-native/run-state', asyncH(async (req, res) => {
  const label = nativeLabel(req.query.label);
  const [run, devs, last] = await Promise.all([
    readNativeRun(label),
    farm.listDevices().catch(() => []),
    lastNativeBirth(),
  ]);
  // deviceInfo menjalankan beberapa shell adb (model, android, baterai), jadi
  // hanya dijalankan untuk device pertama yang dipakai strip status.
  const det = devs.length ? await farm.deviceInfo(devs[0].id).catch(() => null) : null;
  const devices = devs.map((d, i) => (i === 0 && det
    ? { id: d.id, model: det.model || d.model, android: det.android, battery: det.battery }
    : { id: d.id, model: d.model, battery: '' }));
  res.json({
    running: !!run,
    run: run || null,
    hpOnline: devs.length > 0,
    devices,
    lastBirth: last,
  });
}));

// Hentikan run berjalan: bunuh pohon proses, lalu jaga kejujuran arsip. Bila
// creator tidak sempat menulis verdict, catat sendiri sebagai process_killed.
app.post('/api/gmail-native/stop', strictLimiter, asyncH(async (req, res) => {
  const label = nativeLabel(req.body && req.body.label);
  const run = await readNativeRun(label);
  if (!run) return res.status(409).json({ error: 'no_running_job' });
  await new Promise((resolve) => {
    exec(`taskkill /PID ${run.pid} /T /F`, { windowsHide: true }, () => resolve());
  });
  // Beri creator waktu menulis verdict terakhirnya.
  await new Promise((r) => setTimeout(r, 2500));
  const last = await lastNativeBirth();
  if (!last || new Date(last.ts) < new Date(run.startedAt)) {
    const rec = { label: run.label, serial: run.serial, network: run.network, ts: new Date().toISOString(), verdict: 'process_killed', note: 'Dihentikan dari panel' };
    await fsp.appendFile(nativeBirthsFile(), JSON.stringify(rec) + '\n');
  }
  await fsp.unlink(nativeRunFile(label)).catch(() => {});
  res.json({ ok: true });
}));

// Tail log run: file run aktif, atau file mana pun gmail-native-run-*.log.
app.get('/api/gmail-native/run-log', asyncH(async (req, res) => {
  const label = nativeLabel(req.query.label);
  const run = await readNativeRun(label);
  const name = req.query.file ? path.basename(String(req.query.file)) : (run ? run.logFile : null);
  if (!name || !/^gmail-native-run-.*\.log$/.test(name)) return res.status(404).json({ error: 'no_log' });
  let text = '';
  try { text = await fsp.readFile(path.join(__dirname, 'logs', name), 'utf8'); }
  catch (e) { if (e.code === 'ENOENT') return res.json({ file: name, running: !!run, log: '' }); throw e; }
  const lines = text.split('\n');
  res.json({ file: name, running: !!run, log: lines.slice(-120).join('\n') });
}));

// Masukkan hasil kelahiran sukses ke stok Gmail (gmail_pool) agar bisa
// di-claim AutoCreate. Hanya baris verdict 'sukses' yang diterima.
app.post('/api/gmail-native/stock', strictLimiter, asyncH(async (req, res) => {
  const ts = String((req.body && req.body.ts) || '');
  if (!ts) return res.status(400).json({ error: 'field ts wajib' });
  let text = '';
  try { text = await fsp.readFile(nativeBirthsFile(), 'utf8'); }
  catch { return res.status(404).json({ error: 'Arsip kelahiran tidak ditemukan' }); }
  let row = null;
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line);
      if (r.ts === ts && r.verdict === 'sukses' && r.username && r.password) row = r;
    } catch { /* baris rusak, lewati */ }
  }
  if (!row) return res.status(404).json({ error: 'Baris kelahiran tidak ditemukan atau belum sukses' });
  const email = String(row.username).includes('@') ? row.username : `${row.username}@gmail.com`;
  const stock = await db.listGmail(1000);
  if (stock.some((g) => g.email === email)) return res.status(409).json({ error: 'already_in_stock', email });
  await db.addGmail({ email, password: row.password, source: 'hp-native' });
  res.json({ ok: true, email });
}));

// Hapus baris arsip kelahiran per run atau massal, dicocokkan lewat ts.
// Baris rusak dipertahankan: penghapusan hanya menyentuh baris yang cocok.
app.post('/api/gmail-native/births/delete', strictLimiter, asyncH(async (req, res) => {
  const list = Array.isArray(req.body && req.body.tsList) ? req.body.tsList.map(String) : [];
  if (!list.length) return res.status(400).json({ error: 'field tsList wajib (array ts)' });
  if (list.length > 500) return res.status(400).json({ error: 'Maksimal 500 baris per permintaan' });
  const wanted = new Set(list);
  let text = '';
  try { text = await fsp.readFile(nativeBirthsFile(), 'utf8'); }
  catch { return res.status(404).json({ error: 'Arsip kelahiran tidak ditemukan' }); }
  const kept = [];
  const removed = [];
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    let hit = false;
    try { hit = wanted.has(JSON.parse(t).ts); } catch { /* baris rusak: pertahankan */ }
    if (hit) removed.push(t); else kept.push(t);
  }
  if (removed.length) {
    // Cadangan otomatis: salinan baris yang dihapus, sumber tombol Batalkan.
    await fsp.appendFile(path.join(__dirname, 'logs', 'gmail-native-births-trash.log'), removed.join('\n') + '\n');
    await fsp.writeFile(nativeBirthsFile(), kept.join('\n') + (kept.length ? '\n' : ''));
  }
  res.json({ ok: true, deleted: removed.length, lines: removed });
}));

// Gambar screenshot hasil run (field shot di arsip = path file di folder sesi).
// Nama file dibersihkan ke basename dan dicek polanya; <img> tak bisa kirim
// header API key, jadi halaman mengambilnya sebagai blob via fetch.
app.get('/api/gmail-native/shot', asyncH(async (req, res) => {
  const label = nativeLabel(req.query.label);
  const name = req.query.file ? path.basename(String(req.query.file)) : '';
  if (!name || !/^[\w.-]+\.png$/.test(name)) return res.status(404).json({ error: 'no_shot' });
  let buf;
  try { buf = await fsp.readFile(path.join(__dirname, 'sessions', `gmail-native-${label}`, name)); }
  catch { return res.status(404).json({ error: 'Screenshot tidak ditemukan' }); }
  res.type('png').send(buf);
}));

// Kembalikan baris arsip dari tombol Batalkan (atau salin manual dari trash log).
// Baris yang ts-nya sudah ada di arsip dilewati, jadi tak pernah dobel.
app.post('/api/gmail-native/births/restore', strictLimiter, asyncH(async (req, res) => {
  // Item boleh string JSON (dari tombol Batalkan) atau objek langsung; disamakan
  // dulu supaya validasi tunggal.
  const lines = Array.isArray(req.body && req.body.lines)
    ? req.body.lines.map((l) => (typeof l === 'string' ? l : JSON.stringify(l)))
    : [];
  if (!lines.length) return res.status(400).json({ error: 'field lines wajib (array baris JSON)' });
  if (lines.length > 500) return res.status(400).json({ error: 'Maksimal 500 baris per permintaan' });
  const parsed = [];
  for (const l of lines) {
    try {
      const o = JSON.parse(l);
      if (!o || !o.ts) return res.status(400).json({ error: 'Baris cadangan tidak valid (tanpa ts)' });
      parsed.push(JSON.stringify(o));
    } catch { return res.status(400).json({ error: 'Baris cadangan bukan JSON valid' }); }
  }
  let existing = '';
  try { existing = await fsp.readFile(nativeBirthsFile(), 'utf8'); } catch { /* arsip belum ada */ }
  const have = new Set();
  for (const line of existing.split('\n')) {
    if (!line.trim()) continue;
    try { have.add(JSON.parse(line).ts); } catch { /* baris rusak */ }
  }
  const fresh = parsed.filter((l) => { try { return !have.has(JSON.parse(l).ts); } catch { return false; } });
  if (fresh.length) await fsp.appendFile(nativeBirthsFile(), fresh.join('\n') + '\n');
  res.json({ ok: true, restored: fresh.length, skipped: parsed.length - fresh.length });
}));

// Hapus akun beserta data & profil browsernya.
app.delete('/api/accounts/:id', asyncH(async (req, res) => {
  const id = Number(req.params.id);
  const removed = await db.deleteAccount(id);
  if (!removed) return res.status(404).json({ error: 'Akun tidak ditemukan' });
  res.json({ ok: true });
}));

// Update password akun
app.put('/api/accounts/:id/password', asyncH(async (req, res) => {
  const id = Number(req.params.id);
  const { password } = req.body;
  if (!password) {
    return res.status(400).json({ error: 'Password wajib diisi' });
  }
  await db.updateAccountPassword(id, password);
  res.json({ ok: true });
}));

// ---- Facebook Auto-Signup ----

// Create Facebook account automatically
app.post('/api/facebook/auto-create', strictLimiter, asyncH(async (req, res) => {
  if (!req.body) {
    return res.status(400).json({ error: 'Request body is required' });
  }

  const {
    email,
    password,
    firstName,
    lastName,
    gender,
    proxy,
    headless = true,
    saveToDatabase = true
  } = req.body;

  const creator = new FacebookAccountCreator({
    email,
    password,
    firstName,
    lastName,
    gender,
    proxy,
    headless,
    saveToDatabase
  });

  const result = await creator.run();
  
  res.json(result);
}));

// Batch create multiple Facebook accounts
app.post('/api/facebook/batch-create', strictLimiter, asyncH(async (req, res) => {
  if (!req.body) {
    return res.status(400).json({ error: 'Request body is required' });
  }

  const {
    count = 1,
    proxy,
    headless = true,
    delay = 10000
  } = req.body;

  if (count > 10) {
    return res.status(400).json({ error: 'Maximum 10 accounts per batch' });
  }

  const results = [];
  
  for (let i = 0; i < count; i++) {
    const creator = new FacebookAccountCreator({
      proxy,
      headless,
      saveToDatabase: true
    });

    const result = await creator.run();
    results.push(result);

    // Wait before next creation
    if (i < count - 1) {
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  const successful = results.filter(r => r.status === 'success').length;
  const failed = results.filter(r => r.status === 'failed').length;

  res.json({
    total: count,
    successful,
    failed,
    results
  });
}));

// Get Facebook auto-creation status/jobs
app.get('/api/facebook/status', asyncH(async (req, res) => {
  // Get recently created accounts
  const rows = await db.rawAll(`
    SELECT id, name, email, status, platform, created_at
    FROM accounts
    WHERE platform = 'fb'
    ORDER BY created_at DESC
    LIMIT 50
  `);
  
  res.json({ accounts: rows });
}));

// Jalankan creator dari frontend (browser headed terbuka di PC ini).
const CP = (p) => ['ig', 'fb', 'tiktok'].includes(p) ? p : 'ig'; // platform valid utk auto-create

app.post('/api/create/:platform/run', asyncH(async (req, res) => {
  const p = CP(req.params.platform);
  const { proxy, gmailId, phone, manualEmail } = (req.body || {});
  // phone=true: daftar via nomor HP — IG & FB; runner lalu jalan marker [PHONE_REQUIRED]/kartu panel.
  // manualEmail (IG, FB, TikTok): email ketik-an operator — bukan Gmail stok, bukan temp-mail; OTP via kartu panel.
  const r = await createRunner.startCreate(p, proxy ? String(proxy) : '', {
    gmailId,
    phone: phone === true && (p === 'ig' || p === 'fb'),
    manualEmail: ((p === 'ig' || p === 'fb' || p === 'tiktok') && typeof manualEmail === 'string' && manualEmail.trim()) ? manualEmail.trim() : null,
    // IG: tanpa proxy pilihan, runner mengalokasikan IP bersih yang dipatok
    // khusus untuk akun ini (1 akun = 1 IP tetap, bukan pinjaman bergiliran).
    autoIp: p === 'ig' && !proxy && req.body.autoIp === true,
  });
  if (r.error) return res.status(409).json(r);
  res.json(r);
}));
app.get('/api/create/:platform/status', asyncH(async (req, res) => {
  // Slot bulk paralel ('ig:bulk2') diterima — status per-run utk kartu OTP per-run.
  const raw = String(req.params.platform || '');
  const p = /^ig:bulk\d+$/.test(raw) ? raw : CP(raw);
  res.json(createRunner.createStatus(p));
}));
app.post('/api/create/:platform/stop', asyncH(async (req, res) => {
  const p = CP(req.params.platform);
  res.json(createRunner.stopCreate(p));
}));
// Input mid-job (FB): operator kirim kode OTP dari panel → diteruskan ke stdin worker.
// Slot bulk paralel ('ig:bulk2') juga diterima di sini — OTP per-run menuju stdin run itu.
app.post('/api/create/:platform/input', asyncH(async (req, res) => {
  const raw = String(req.params.platform || '');
  const p = /^ig:bulk\d+$/.test(raw) ? raw : CP(raw);
  const { text } = (req.body || {});
  if (typeof text !== 'string' || !text.trim()) return res.status(400).json({ error: 'text wajib' });
  res.json(createRunner.inputCreate(p, text.trim()));
}));

// BULK IG: sekali jalan 1-5 akun berurutan (1 browser per akun, jeda 3-5 mnt).
// Jalur temp-mail otomatis saja — Gmail stok/nomor HP butuh operator per akun.
app.post('/api/create/ig/bulk', strictLimiter, asyncH(async (req, res) => {
  const { count, proxies, proxy, gmailIds, browsers } = (req.body || {});
  const r = await createRunner.startBulkIg(Number(count) || 2, { proxies, proxy, gmailIds, browsers });
  if (r.error) return res.status(409).json(r);
  res.json(r);
}));
app.get('/api/create/ig/bulk/status', asyncH(async (req, res) => {
  res.json(createRunner.bulkStatus());
}));
app.post('/api/create/ig/bulk/stop', asyncH(async (req, res) => {
  res.json(createRunner.stopBulkIg());
}));

// Cek kualitas IP koneksi SEBELUM Mulai: tunnel CONNECT ke ipwho.is via
// proxy persis yang akan dipakai creator (parse + auth sama dgn runner),
// balas operator/ASN/city supaya operator tahu IP keluar milik operator apa —
// guard manual sebelum menyia-siakan email/identitas pada IP Telkomsel burn.
const { lookupExitIp } = require('./src/net-probe');
app.get('/api/create/:platform/ip-geo', asyncH(async (req, res) => {
  const p = CP(req.params.platform);
  const proxy = typeof req.query.proxy === 'string' ? req.query.proxy : '';
  res.json(await lookupExitIp(proxy));
}));

// Tes alokasi IP bersih: tampilkan IP yang akan didapat tanpa menyimpan proxy,
// tanpa mengikat akun, dan tanpa membuka browser.
app.post('/api/create/ig/ip-allocate-test', strictLimiter, asyncH(async (req, res) => {
  const r = await createRunner.previewIgIp();
  res.status(r.error ? 409 : 200).json(r);
}));

// Hasil akun terakhir (username/email/password/proxy/IP lahir) dari file result creator.
app.get('/api/create/:platform/result', asyncH(async (req, res) => {
  const p = CP(req.params.platform);
  res.json({ result: createRunner.getCreateResult(p) });
}));

// Dump struktur wizard terakhir — kartu diagnosis di UI saat run create gagal.
app.get('/api/create/fb/wizard-dump', asyncH(async (req, res) => {
  res.json({ dump: createRunner.getLatestWizardDump() });
}));

// Daftarkan akun hasil create ke panel TANPA CLI (pakai jalur sama dengan form Akun).
app.post('/api/create/:platform/register', asyncH(async (req, res) => {
  const p = CP(req.params.platform);
  const r = createRunner.getCreateResult(p);
  if (!r) return res.status(404).json({ error: 'Belum ada hasil create untuk didaftarkan' });
  const existing = await db.getAccountByName(r.username).catch(() => null);
  // Tambah: akun platform LAIN dengan email sama (mis. registrasi lama 'ig')
  // dianggap berbeda — jalur create FB/IG/TikTok punya tabel platform masing-masing,
  // jadi baris 'ig' lama tidak boleh menelan hasil create 'fb' (pelajaran akun
  // #71 pocotre76 yang tadinya salah masuk daftar Akun Instagram).
  const existingSamePlatform = (existing && existing.platform === p) ? existing : null;
  if (existingSamePlatform) {
    createRunner.markRegistered(p, existing.id);
    return res.json({ ok: true, id: existing.id, already: true, name: existing.name });
  }
  const id = await db.addAccount({
    name: r.username, email: r.email, password: r.password,
    proxy: r.proxy || undefined, platform: p,
  });
  // IP lahir hasil alokasi otomatis diikat permanen ke akun ini.
  if (r.proxy) await db.bindAutoProxy(r.proxy, r.username).catch(() => {});
  // Kunci 2FA hasil capture worker (sessions/ig-<user>.totp) — langsung masuk DB
  // terenkripsi saat akun didaftarkan, jadi akun lahir sudah siap login-otomatis.
  try {
    const fsTotp = require('fs');
    const totpFile = path.join(__dirname, 'sessions', `${p}-${r.username}.totp`);
    if (p === 'ig' && fsTotp.existsSync(totpFile)) {
      const secretRaw = fsTotp.readFileSync(totpFile, 'utf8').trim();
      const st = await db.setAccountTotp(id, secretRaw);
      fsTotp.unlinkSync(totpFile); // kunci sudah di DB — file mentah jangan tertinggal
      console.log('[2FA] kunci capture tersimpan utk akun #' + id + ' (' + (st.error || 'OK') + ')');
    }
  } catch (e) { console.log('[2FA] simpan kunci capture gagal (non-fatal): ' + e.message); }
  // Spoof canvas/audio/webgl — seed ulang dari username+email yang sama, jadi nilai
  // identik dengan yang dipakai browser signup (deterministik). Creator TikTok
  // menyertakan konfig yang BENAR-BENAR dipakai saat daftar (seed email, id belum
  // ada); pakai itu agar canvas hash tidak berubah di login pertama.
  try {
    const fullSpoof = (r.fingerprintJson && typeof r.fingerprintJson === 'object')
      ? r.fingerprintJson
      : require('./src/fingerprint-spoof').spoofConfigFor({ id, name: r.username, email: r.email, user_agent: r.user_agent || '' });
    db.run('UPDATE accounts SET fingerprint_json = ? WHERE id = ?', [JSON.stringify(fullSpoof), id]);
    db.save();
  } catch (e) { /* non-fatal */ }
  createRunner.markRegistered(p, id);
  broadcastNotification('success', `Akun ${r.username} (#${id}) didaftarkan ke panel dari Auto-Create`);
  res.json({ ok: true, id, name: r.username });
}));

// ---- Re-login IG dari panel (log live, proxy IP lahir dari session) ----
app.post('/api/create/ig/relogin', asyncH(async (req, res) => {
  const { name } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name (username akun) wajib' });
  const r = await createRunner.startRelogin(String(name));
  if (r.error) return res.status(409).json({ error: r.error });
  res.json(r);
}));
app.get('/api/create/ig/relogin/status', asyncH(async (req, res) => {
  res.json(createRunner.reloginStatus());
}));
app.post('/api/create/ig/relogin/stop', asyncH(async (req, res) => {
  res.json(createRunner.stopRelogin());
}));

// ---- SIGNUP IG VIA HP (ADB) — mode kedua di halaman IG Auto-Create ----

// Daftar HP + status kelayakan signup: idle / sibuk / cooldown 24 jam. Sumber
// tunggal: adb devices + orchestra.deviceState (hukum tempo yang sama dengan farm).
const SIGNUP_DRIVER = path.join(__dirname, 'src', 'farm-driver-ig.js');
const signupDriverProcs = new Map(); // jobId -> ChildProcess (bila spawn in-process)
app.get('/api/create/ig/phones', asyncH(async (req, res) => {
  const devices = await farm.listDevices().catch(() => []);
  const rows = await Promise.all(devices.map(async (d) => {
    const info = await farm.deviceInfo(d.id).catch(() => ({}));
    const st = orchestra.deviceState(d.id);
    // Detail HP disinkronkan latar (baterai/IPbutuh detik — tidak blok respons)
    void hygiene.refreshDeviceDetails(d.id).catch(() => {});
    const cachedRoom = roomCache.rows.find((r) => r.id === d.id);
    const room = cachedRoom ? {
      verdict: cachedRoom.verdict || '',
      pesan: cachedRoom.pesan || '',
      ig: cachedRoom.ig || '',
      pindah: cachedRoom.pindah || '',
      at: cachedRoom.at || roomCache.at || null,
    } : null;
    return { id: d.id, model: info.model || d.model, android: info.android, battery: info.battery, state: st.state, stateNote: st.reason || null, jobId: st.jobId || null, room };
  }));
  res.json({ phones: rows });
}));

// Mulai signup IG di HP tertentu: antre job via orchestra (cooldown 24j ditegakkan
// di sini) lalu jalankan sopir HP detached (log ke logs/farm-driver-<jobId>.log).
// Payload: { deviceId, gmailId?, manualEmail?, tempEmail?, navOnly? }.
// tempEmail=true: sopir membuat inbox tmailor dan membaca OTP sendiri.
// Jalur lain memakai kartu OTP panel: operator isi kode di papan job.
app.post('/api/create/ig/phone-run', strictLimiter, asyncH(async (req, res) => {
  const { deviceId, gmailId, navOnly, manualEmail, tempEmail } = req.body || {};
  if (!deviceId) return res.status(400).json({ error: 'deviceId wajib' });
  const devs = await farm.listDevices().catch(() => []);
  if (!devs.some((d) => d.id === deviceId)) return res.status(400).json({ error: 'HP tidak terbaca ADB' });
  if (roomProbeBusy.has(deviceId)) return res.status(409).json({ error: 'Deteksi room sedang berjalan. Tunggu sampai selesai.' });
  if (tempEmail && (String(manualEmail || '').trim() || gmailId)) {
    return res.status(400).json({ error: 'pilih tmailor atau email manual/Gmail, jangan campur' });
  }
  if (tempEmail) {
    const { TmailorClient } = require('./lib/mail-worker/tmailor');
    if (!new TmailorClient().configured) {
      return res.status(400).json({ error: 'tmailor belum dikonfigurasi (TMAILOR_API_KEY)' });
    }
  }
  // Identitas: email manual (Outlook dsb.) menang atas pilihan Gmail/temp-mail.
  // OTP domain luar diisi operator di kartu job (payload.otp) saat sopir
  // menunggu di langkah 7.
  let email, password, snoof = null;
  let gmailRow = null;
  let emailManual = null;
  let tempMail = false;
  if (tempEmail) {
    // Alamat dibuat sopir saat job create mulai, lalu disimpan ke payload.
    email = '';
    tempMail = true;
  } else if (typeof manualEmail === 'string' && manualEmail.trim()) {
    const me = manualEmail.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(me)) return res.status(400).json({ error: 'format email manual tidak valid: ' + me });
    const dupAcct = await db.rawAll('SELECT name FROM accounts WHERE lower(email) = ?', [me]).catch(() => []);
    if (dupAcct && dupAcct.length) return res.status(409).json({ error: `email ${me} sudah terpakai akun "${dupAcct[0].name}" di panel` });
    const dupPool = await db.rawAll('SELECT email FROM gmail_pool WHERE lower(email) = ?', [me]).catch(() => []);
    if (dupPool && dupPool.length) return res.status(409).json({ error: `email ${me} sudah ada di stok Gmail` });
    emailManual = me;
    email = me;
    password = require('./src/id-identity').makeIdentity().password;
  } else if (gmailId) {
    const rows = await db.rawAll('SELECT id, email, password_enc, status, used_by FROM gmail_pool WHERE id = ?', [Number(gmailId)]).catch(() => []);
    if (!rows || !rows.length) return res.status(400).json({ error: 'gmail #' + gmailId + ' tidak ditemukan' });
    gmailRow = rows[0];
    const plts = db.gmailUsedPlatforms(gmailRow.used_by);
    if (gmailRow.status === 'used' && plts.includes('ig')) return res.status(409).json({ error: `gmail #${gmailId} sudah terpakai daftar IG (${gmailRow.used_by}) — pilih Gmail lain` });
    try { password = require('./src/crypto').decrypt(gmailRow.password_enc); } catch (e) { password = null; }
    if (!password) return res.status(400).json({ error: 'password gmail #' + gmailId + ' tidak terbaca' });
    email = gmailRow.email;
  } else {
    const idn = require('./src/id-identity').makeIdentity();
    email = (require('./src/email-alias').makeEmail({ first: idn.first, last: idn.last })).alias + '@' + (process.env.AMMAIL_DOMAIN || 'mialmuhajirin.sch.id');
    password = idn.password;
  }
  // Selalu ada identitas penuh — Gmail stok hanya menyuplai email+password; nama
  // esensial username/bday tetap dari generator biar tidak dobel generator.
  const idn = require('./src/id-identity').makeIdentity();
  if (!password) password = idn.password;
  const payload = {
    email, password, username: idn.username, bday: idn.birthdate,
    mode: navOnly ? 'nav' : 'create', gmailId: tempMail ? null : (gmailId || null), via: 'hp', navOnly: !!navOnly,
    manualEmail: emailManual, tempMail,
  };
  const queued = orchestra.queueJob(deviceId, 'ig', payload);
  if (queued.error) return res.status(409).json({ error: queued.error });
  // Sopir: spawn detached (log ke file), pola sama dengan gmail-native/run.
  const stamp = queued.id;
  const logPath = path.join(__dirname, 'logs', `farm-driver-${stamp}.log`);
  await fsp.mkdir(path.dirname(logPath), { recursive: true });
  const fh = await fsp.open(logPath, 'a');
  const args = [SIGNUP_DRIVER, queued.id];
  if (!navOnly) args.push('--go');
  let child;
  try {
    child = spawn(process.execPath, args, { cwd: __dirname, detached: true, windowsHide: true, stdio: ['ignore', fh.fd, fh.fd] });
    child.unref();
  } finally {
    await fh.close().catch(() => {});
  }
  res.json({ ok: true, jobId: queued.id, deviceId, mode: navOnly ? 'nav' : 'create', email, username: idn.username, manualEmail: emailManual, tempMail });
}));

// Daftarkan hasil create IG via HP ke panel. Dipakai tombol di kartu job supaya
// akun lahir di HP tidak menggantung di riwayat job saja. Idempoten per username.
app.post('/api/create/ig/phone-register', strictLimiter, asyncH(async (req, res) => {
  const job = orchestra.getJob(String((req.body || {}).jobId || ''));
  if (!job || job.platform !== 'ig') return res.status(404).json({ error: 'job tidak ditemukan' });
  if (job.status !== 'done' || !job.payload || job.payload.mode !== 'create') {
    return res.status(409).json({ error: 'job belum selesai sebagai create sungguhan' });
  }
  const { username, email, password } = job.payload;
  if (!username || !email || !password) return res.status(400).json({ error: 'payload job tidak lengkap' });
  const existing = await db.getAccountByName(username).catch(() => null);
  if (existing && existing.platform === 'ig') return res.json({ ok: true, id: existing.id, already: true, name: existing.name });
  const id = await db.addAccount({ name: username, email, password, platform: 'ig' });
  try {
    const fullSpoof = require('./src/fingerprint-spoof').spoofConfigFor({ id, name: username, email, user_agent: '' });
    db.run('UPDATE accounts SET fingerprint_json = ? WHERE id = ?', [JSON.stringify(fullSpoof), id]);
    db.save();
  } catch (e) { /* fingerprint non-fatal */ }
  await db.addAccountEvent({
    accountId: id, platform: 'ig', event: 'created',
    source: 'phone_create', reason: `lahir lewat HP ${job.deviceId}`,
  }).catch(() => {});
  res.json({ ok: true, id, name: username });
}));

// Kartu OTP untuk job HP: operator isi kode dari Gmail stok (PC) → job.payload.otp.
// Driver membaca payload.otp di loop langkah 7 — tidak perlu saluran keduua.
app.post('/api/create/ig/phone-otp', strictLimiter, asyncH(async (req, res) => {
  const { jobId, code } = req.body || {};
  if (!jobId || !code) return res.status(400).json({ error: 'jobId & code wajib' });
  const r = orchestra.appendOtp(String(jobId), String(code));
  if (r.error) return res.status(404).json(r);
  res.json({ ok: true });
}));

// Riwayat job HP (papan kanan): 25 job terkini platform ig.
app.get('/api/create/ig/phone-jobs', asyncH(async (req, res) => {
  const jobs = orchestra.listJobs('', 30).filter((j) => j.platform === 'ig').slice(0, 25);
  res.json({ jobs });
}));

// ---- SIGNUP FB VIA HP (ADB) — kartu Via HP di FB Auto-Create ----
// Resep: SOP TERKUNCI docs/sop-create-fb-via-hp.md (uji A 19/10: akun lahir &
// langsung Feed tanpa checkpoint). Perbedaan dengan IG: FB wizard nomor-HP
// TIDAK memakai email OTP — verifikasi lewat SMS yang FB sering auto-verifikasi
// via aplikasi (uji A: layar kode lewat sendiri tanpa SMS masuk inbox).
// Aturan SOP tetap: nomor SIM oleh OPERATOR ketik manual di HP (bot jangan pegang
// nomor), nav-only default, --go hanya bila device cooldown lewat.
const FB_DRIVER = path.join(__dirname, 'src', 'farm-driver-fb.js');
app.get('/api/create/fb/phones', asyncH(async (req, res) => {
  const devices = await farm.listDevices().catch(() => []);
  const rows = await Promise.all(devices.map(async (d) => {
    const info = await farm.deviceInfo(d.id).catch(() => ({}));
    const st = orchestra.deviceState(d.id);
    void hygiene.refreshDeviceDetails(d.id).catch(() => {});
    // Slot user Android HP (dropdown Via HP): daftar room + status kosong.
    let users = [];
    try {
      users = (await rooms.listRooms(d.id, farm.APPS.facebook)).map((u) => ({
        id: u.id, name: u.name, running: u.running, current: u.current, installed: u.installed, empty: u.empty,
      }));
    } catch (e) { users = [{ id: 0, name: 'Pemilik' }]; }
    if (!users.length) users = [{ id: 0, name: 'Pemilik' }];
    return { id: d.id, model: info.model || d.model, android: info.android, battery: info.battery, state: st.state, stateNote: st.reason || null, jobId: st.jobId || null, users };
  }));
  res.json({ phones: rows });
}));
app.post('/api/create/fb/phone-run', strictLimiter, asyncH(async (req, res) => {
  const { deviceId, navOnly, deviceUser } = req.body || {};
  if (!deviceId) return res.status(400).json({ error: 'deviceId wajib' });
  const devs = await farm.listDevices().catch(() => []);
  if (!devs.some((d) => d.id === deviceId)) return res.status(400).json({ error: 'HP tidak terbaca ADB' });
  // Slot user Android HP (0=Pemilik, 10/11=Pengguna baru). Kalau UI tidak mengirim,
  // pilih otomatis: ambil user non-0 pertama yang FB-nya ter-install dan belum
  // memegang sesi (sisa layar welcome) — cek lapangan ringan per kandidat.
  const pilihEksplisit = deviceUser !== undefined && deviceUser !== null && String(deviceUser).trim() !== '';
  if (pilihEksplisit && (!Number.isInteger(Number(deviceUser)) || Number(deviceUser) < 0)) {
    return res.status(400).json({ error: 'deviceUser tidak valid' });
  }
  let slotUser = pilihEksplisit ? Number(deviceUser) : 0;
  const deviceUserKosong = !pilihEksplisit;
  // Janitor slot: buang sisa room tamu IG (tamu-*) sebelum pilih slot — biar
  // pemilihan "user non-0 pertama" tidak makan ruang tamu basi. Slot kerja FB
  // bernama "Slot" aman: janitor tidak pernah menyentuhnya.
  try {
    const jn = await rooms.janitorSlots(deviceId);
    if (jn && jn.dibuang.length) console.log(`[fb-phone-run] janitor: hapus slot ${jn.dibuang.join(', ')} (sisa ${jn.users})`);
  } catch (e) { console.log('[fb-phone-run] janitor gagal (lanjut saja): ' + String(e.message || e).slice(0, 120)); }
  if (deviceUserKosong && !navOnly) {
    try {
      const usersOut = await farm.shell(deviceId, ['shell', 'pm', 'list', 'users']).catch(() => '');
      const ids = [...String(usersOut).matchAll(/UserInfo\{(\d+):/g)].map((m) => Number(m[1])).filter((x) => x !== 0);
      slotUser = 0; // fallback bila tak ada kandidat cocok
      for (const uid of ids) {
        const st = await farm.shell(deviceId, ['shell', 'dumpsys', 'package', 'com.facebook.katana']).catch(() => '');
        const blk = new RegExp(`User ${uid}: (.*)`).exec(String(st));
        if (!blk || !/installed=true/.test(blk[1])) {
          await farm.shell(deviceId, ['shell', 'pm', 'install-existing', '--user', String(uid), 'com.facebook.katana']).catch(() => {});
        }
        // slotUser untuk create = user non-0 pertama yang FB ter-install.
        slotUser = uid;
        break; // sederhana: user non-0 pertama; pengecekan sesi bersih tetap oleh driver
      }
    } catch (e) { /* fallback slotUser=0 */ }
  }
  // Pilihan eksplisit dari UI harus melewati jalur yang sama dengan auto:
  // pastikan room ada dan FB terpasang. Tanpa ini, room kosong yang dipilih
  // akan di-queue tetapi driver membuka aplikasi yang belum ada.
  if (slotUser > 0) {
    const userRows = await rooms.listUsers(deviceId).catch(() => []);
    if (!userRows.some((u) => u.uid === slotUser)) {
      return res.status(400).json({ error: `room ${slotUser} tidak ada di HP` });
    }
    try {
      await rooms.installForUser(deviceId, slotUser, farm.APPS.facebook);
    } catch (e) {
      return res.status(409).json({ error: `Gagal menyiapkan Facebook di room ${slotUser}: ${String(e.message || e).slice(0, 140)}` });
    }
  }
  // Identitas nama/DOB acak dari generator (SOP: usia 20-70). Password kuat.
  // Gender fix Laki-laki (konvensi kelahiran akun sukses).
  const idn = require('./src/id-identity').pickName();
  const sTahun = 1970 + Math.floor(Math.random() * 37); // 1970-2006 (usia 20+)
  const bday = { day: 1 + Math.floor(Math.random() * 28), month: 1 + Math.floor(Math.random() * 12), year: sTahun };
  const password = 'Fb' + Math.random().toString(36).slice(2, 10) + '!7';
  const payload = {
    firstname: idn.first, lastname: idn.last, bday, password,
    mode: navOnly ? 'nav' : 'create', via: 'hp', navOnly: !!navOnly,
    deviceUser: slotUser, // slot user Android tempat FB wizard dijalankan
  };
  const queued = orchestra.queueJob(deviceId, 'fb', payload);
  if (queued.error) return res.status(409).json({ error: queued.error });
  // Sopir FB: spawn detached (log ke file), pola sama dengan IG phone-run.
  const logPath = path.join(__dirname, 'logs', `farm-driver-fb-${queued.id}.log`);
  await fsp.mkdir(path.dirname(logPath), { recursive: true });
  const fh = await fsp.open(logPath, 'a');
  const args = [FB_DRIVER, queued.id];
  if (!navOnly) args.push('--go');
  let child;
  try {
    child = spawn(process.execPath, args, { cwd: __dirname, detached: true, windowsHide: true, stdio: ['ignore', fh.fd, fh.fd] });
    child.unref();
  } finally {
    await fh.close().catch(() => {});
  }
  res.json({ ok: true, jobId: queued.id, deviceId, mode: navOnly ? 'nav' : 'create', name: idn.first + ' ' + idn.last, deviceUser: slotUser });
}));
// Riwayat job HP FB (papan kanan): 25 job terkini platform fb.
app.get('/api/create/fb/phone-jobs', asyncH(async (req, res) => {
  const jobs = orchestra.listJobs('', 30).filter((j) => j.platform === 'fb').slice(0, 25);
  res.json({ jobs });
}));

// ---- SIGNUP TIKTOK VIA HP (ADB): jalur email → layar kode ----
// TikTok di HP hanya menerima email/nomor telepon. Dua sumber email:
//   tempEmail=true -> sopir membuat inbox tmailor dan membaca kodenya sendiri;
//   manualEmail    -> alamat operator, kodenya ditempel di kartu job.
// Domain temp-mail AMMail sengaja tidak dipakai lagi karena sudah ditolak TikTok.
const TIKTOK_DRIVER = path.join(__dirname, 'src', 'farm-driver-tiktok.js');
app.get('/api/create/tiktok/phones', asyncH(async (req, res) => {
  const devices = await farm.listDevices().catch(() => []);
  const rows = await Promise.all(devices.map(async (d) => {
    const info = await farm.deviceInfo(d.id).catch(() => ({}));
    const st = orchestra.deviceState(d.id);
    void hygiene.refreshDeviceDetails(d.id).catch(() => {});
    const userRows = await rooms.listRooms(d.id, farm.APPS.tiktok).catch(() => []);
    return {
      id: d.id, model: info.model || d.model, android: info.android, battery: info.battery,
      state: st.state, stateNote: st.reason || null, jobId: st.jobId || null,
      users: (userRows.length ? userRows : [{ id: 0, name: 'Pemilik', empty: false }]).map((u) => ({
        id: u.id, name: u.name, running: u.running, current: u.current, installed: u.installed, empty: u.empty,
      })),
    };
  }));
  res.json({ phones: rows });
}));
app.post('/api/create/tiktok/phone-run', strictLimiter, asyncH(async (req, res) => {
  const { deviceId, navOnly, manualEmail, tempEmail, deviceUser } = req.body || {};
  if (!deviceId) return res.status(400).json({ error: 'deviceId wajib' });
  const devs = await farm.listDevices().catch(() => []);
  if (!devs.some((d) => d.id === deviceId)) return res.status(400).json({ error: 'HP tidak terbaca ADB' });
  // Spasi dibuang di sini juga: UI bisa mengirim tempelan yang membawa spasi,
  // dan email berspasi tidak akan pernah diterima TikTok.
  const manual = String(manualEmail || '').replace(/\s+/g, '').toLowerCase();
  if (!manual && !tempEmail) {
    return res.status(400).json({ error: 'pilih temp-mail tmailor atau isi email TikTok sendiri' });
  }
  if (manual && !/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(manual)) {
    return res.status(400).json({ error: 'email TikTok tidak valid: ' + manual });
  }
  if (manual) {
    const dupAcct = await db.rawAll('SELECT name FROM accounts WHERE lower(email) = ?', [manual]).catch(() => []);
    if (dupAcct && dupAcct.length) return res.status(409).json({ error: `email ${manual} sudah terpakai akun "${dupAcct[0].name}" di panel` });
  }
  // Pilih room: UI bisa mengirim deviceUser; kalau kosong, ambil room kosong
  // pertama. Jangan diam-diam jatuh ke Pemilik saat semua room terpakai.
  let userRows = await rooms.listRooms(deviceId, farm.APPS.tiktok).catch(() => []);
  if (!userRows.length) {
    userRows = (await rooms.listUsers(deviceId).catch(() => [])).map((u) => ({
      id: u.uid, name: u.nama, empty: false,
    }));
  }
  const pilihEksplisit = deviceUser !== undefined && deviceUser !== null && String(deviceUser).trim() !== '';
  let slotUser = pilihEksplisit ? Number(deviceUser) : null;
  if (pilihEksplisit && (!Number.isInteger(slotUser) || slotUser < 0)) {
    return res.status(400).json({ error: 'deviceUser tidak valid' });
  }
  if (slotUser !== null && slotUser > 0 && !userRows.some((u) => u.id === slotUser)) {
    return res.status(400).json({ error: `room ${slotUser} tidak ada di HP` });
  }
  if (slotUser === null) {
    const kosong = userRows.find((u) => u.id !== 0 && u.empty);
    if (!kosong) {
      return res.status(409).json({ error: 'Tidak ada room kosong. Buat room baru dulu, atau pilih Pemilik secara eksplisit.' });
    }
    slotUser = kosong.id;
  }
  const room = userRows.find((u) => u.id === slotUser);
  // Alamat temp-mail belum ada di sini: sopir yang membuatnya saat job jalan lalu
  // menulis alamat itu ke payload supaya panel dan run ulang memakai alamat sama.
  const queued = orchestra.queueJob(deviceId, 'tiktok', {
    email: manual, tempMail: !manual, via: 'hp', navOnly: !!navOnly,
    mode: navOnly ? 'nav' : 'create', manualEmail: manual || null,
    deviceUser: slotUser,
    deviceUserName: room ? room.name : null,
  });
  if (queued.error) return res.status(409).json({ error: queued.error });
  const logPath = path.join(__dirname, 'logs', `farm-driver-tiktok-${queued.id}.log`);
  await fsp.mkdir(path.dirname(logPath), { recursive: true });
  const fh = await fsp.open(logPath, 'a');
  const args = [TIKTOK_DRIVER, queued.id];
  if (!navOnly) args.push('--go');
  let child;
  try {
    child = spawn(process.execPath, args, { cwd: __dirname, detached: true, windowsHide: true, stdio: ['ignore', fh.fd, fh.fd] });
    child.unref();
  } finally {
    await fh.close().catch(() => {});
  }
  res.json({ ok: true, jobId: queued.id, deviceId, mode: navOnly ? 'nav' : 'create', email: manual, tempMail: !manual, deviceUser: slotUser, deviceUserName: room ? room.name : null });
}));
// Kode dari panel untuk sopir TikTok. Sopir mem-poll payload.otp tiap 15 dtk.
// Ini juga cadangan saat pembacaan inbox tmailor gagal.
app.post('/api/create/tiktok/phone-otp', strictLimiter, asyncH(async (req, res) => {
  const { jobId, code } = req.body || {};
  const digits = String(code || '').replace(/\D/g, '');
  if (!jobId || digits.length < 4) return res.status(400).json({ error: 'jobId dan kode 4-8 angka wajib' });
  const job = orchestra.getJob(String(jobId));
  if (!job || job.platform !== 'tiktok') return res.status(404).json({ error: 'job TikTok tidak ditemukan' });
  const r = orchestra.appendOtp(String(jobId), digits);
  if (r.error) return res.status(404).json(r);
  res.json({ ok: true });
}));
app.get('/api/create/tiktok/phone-jobs', asyncH(async (req, res) => {
  const jobs = orchestra.listJobs('', 30).filter((j) => j.platform === 'tiktok').slice(0, 25);
  res.json({ jobs });
}));

// ---- Tes kelayakan IP signup (probe): cek IP di-flag sebelum buang email ----
app.post('/api/create/:platform/probe', asyncH(async (req, res) => {
  const { proxy } = req.body || {};
  const r = await createRunner.startProbe(CP(req.params.platform), proxy ? String(proxy) : '');
  if (r.error) return res.status(409).json({ error: r.error });
  res.json(r);
}));
app.get('/api/create/:platform/probe/status', asyncH(async (req, res) => {
  res.json(createRunner.probeStatus(CP(req.params.platform)));
}));
app.post('/api/create/:platform/probe/stop', asyncH(async (req, res) => {
  res.json(createRunner.stopProbe(CP(req.params.platform)));
}));

// Skor kelayakan IP dari riwayat probe (halaman Proxy).
app.get('/api/proxy/probe-scores', asyncH(async (req, res) => {
  const [scores, latest, signups] = await Promise.all([
    db.getProbeScores(Number(req.query.limit) || 50),
    db.getLatestVerdicts(Number(req.query.latest) || 200),
    db.getSignupIps(),
  ]);
  // verdict terakhir per IP untuk badge cepat + riwayat pemakaian signup per IP
  const lastVerdict = {};
  for (const v of latest) { if (!lastVerdict[v.ip]) lastVerdict[v.ip] = v; }
  res.json({
    scores: scores.map((s) => ({
      ...s,
      lastVerdict: (lastVerdict[s.ip] || {}).verdict || null,
      signup: signups[s.ip] || null,
    })),
    signups,
  });
}));

// Tambah jadwal via form
app.post('/api/schedules', upload.single('media'), asyncH(async (req, res) => {
  const { accountId, content, time, repeat } = req.body;
  if (!accountId || !content || !time) {
    return res.status(400).json({ error: 'accountId, content, time wajib' });
  }
  if (content.length > MAX_CONTENT_LEN) {
    return res.status(400).json({ error: `Konten terlalu panjang (maks ${MAX_CONTENT_LEN} karakter)` });
  }
  const scheduleAt = new Date();
  const [hh, mm] = time.split(':');
  scheduleAt.setHours(Number(hh), Number(mm), 0, 0);
  const mediaPath = req.file ? path.join(UPLOAD_DIR, req.file.filename) : null;
  const contentId = await db.addContent(content, mediaPath);
  const id = await db.addSchedule(Number(accountId), contentId, scheduleAt.toISOString(), repeat || 'none');
  res.json({ id });
}));

// Hapus jadwal
app.delete('/api/schedules/:id', asyncH(async (req, res) => {
  const id = Number(req.params.id);
  const deleted = await db.deleteSchedule(id);
  if (!deleted) return res.status(404).json({ error: 'Jadwal tidak ditemukan' });
  res.json({ ok: true });
}));

// ---- Like jobs ----
app.get('/api/likes', asyncH(async (req, res) => {
  res.json(await db.listLikeJobs());
}));

app.post('/api/likes', asyncH(async (req, res) => {
  const { accountId, name, postUrl } = req.body;
  if (!accountId || !name || !postUrl) return res.status(400).json({ error: 'accountId, name, postUrl wajib' });
  const id = await db.addLikeJob({ accountId: Number(accountId), name, postUrl });
  res.json({ id });
}));

app.delete('/api/likes/:id', asyncH(async (req, res) => {
  await db.deleteLikeJob(Number(req.params.id));
  res.json({ ok: true });
}));

// Jalankan like untuk satu like_job.
app.post('/api/likes/:id/run', asyncH(async (req, res) => {
  const { likePosting } = require('./src/actions');
  const job = await db.getLikeJob(Number(req.params.id));
  if (!job) return res.status(404).json({ error: 'Like job tidak ditemukan' });
  const account = await db.getAccountById(job.account_id);
  if (!account) return res.status(404).json({ error: 'Akun tidak ditemukan' });
  // Tandai 'running' sebelum proses (bisa diulang kapan saja).
  await db.rawAll(`UPDATE like_jobs SET status = 'running' WHERE id = ?`, [job.id]);
  const result = await likePosting(account, job.post_url);
  // update status & last_run_at
  await db.rawAll(`UPDATE like_jobs SET status = ?, last_run_at = ? WHERE id = ?`,
    [result.ok ? 'done' : 'failed', new Date().toISOString(), job.id]);
  await db.logPost({ accountId: account.id, status: result.ok ? 'like_ok' : 'like_failed', message: 'Like: ' + (result.reason || job.name) });
  res.json(result);
}));

// ---- Proxies ----
app.get('/api/proxies', asyncH(async (req, res) => {
  res.json(await db.listProxies());
}));

app.post('/api/proxies', asyncH(async (req, res) => {
  const { values, labels } = req.body; // bisa string (satu) atau array; labels opsional sejajar values
  if (!values) return res.status(400).json({ error: 'values wajib' });
  const arr = Array.isArray(values) ? values : [values];
  const larr = Array.isArray(labels) ? labels : (labels ? [labels] : []);
  let added = 0;
  for (let i = 0; i < arr.length; i++) {
    const v = String(arr[i] || '').trim();
    if (!v) continue;
    await db.addProxy(v);
    // addProxy INSERT OR IGNORE tanpa label — label dikanal lewat UPDATE bila baris baru.
    if (larr[i] && db.setProxyLabel) await db.setProxyLabel(v, larr[i]);
    added++;
  }
  res.json({ ok: true, added });
}));

app.delete('/api/proxies/:id', asyncH(async (req, res) => {
  // Proxy hasil alokasi = IP lahir satu akun. Menghapusnya memutus login akun
  // itu, jadi tolak selama masih terikat; operator bisa lepas dulu di halaman Akun.
  const row = (await db.listProxies()).find((p) => Number(p.id) === Number(req.params.id));
  if (row && row.source === 'auto-ip') {
    const used = await db.accountsUsingProxy(row.value);
    if (used.length) {
      return res.status(409).json({ error: `Proxy ini IP lahir akun ${used.map((a) => a.name).join(', ')}. Lepas proxy dari akun itu dulu sebelum menghapus.` });
    }
  }
  await db.deleteProxy(Number(req.params.id));
  res.json({ ok: true });
}));

app.put('/api/proxies/:id', asyncH(async (req, res) => {
  const { value } = req.body;
  if (!value || !String(value).trim()) return res.status(400).json({ error: 'value wajib' });
  await db.updateProxy(Number(req.params.id), String(value).trim());
  res.json({ ok: true });
}));

// Assign proxy otomatis: proksi #i -> akun #i (yang belum punya proxy).
app.post('/api/proxies/assign', asyncH(async (req, res) => {
  const overwrite = !!(req.body && req.body.overwrite);
  const n = await db.assignProxiesToAccounts({ overwrite });
  res.json({ ok: true, assigned: n, overwrite });
}));

// ---- Pool HP (proxies-pool.txt: Tailscale + aplikasi proxy di Android) ----
const phonePool = require('./src/phone-pool');

// Preview isi pool tanpa menulis ke DB (validasi format sebelum sync).
app.get('/api/proxies/pool/preview', asyncH(async (req, res) => {
  res.json({ pool: phonePool.parsePool() });
}));

// Sync pool -> tabel proxies (tambah baru, update label, hapus pool lama yang hilang).
app.post('/api/proxies/pool/sync', asyncH(async (req, res) => {
  res.json(await phonePool.syncToDb());
}));

// Health-check seluruh HP: IP keluar, geo, latensi, jangkauan tiktok/ig/fb per SIM.
app.post('/api/proxies/pool/health', asyncH(async (req, res) => {
  res.json(await phonePool.startHealth());
}));
app.get('/api/proxies/pool/health', asyncH(async (req, res) => {
  res.json(phonePool.status());
}));
app.get('/api/proxies/pool/health/report', asyncH(async (req, res) => {
  res.json(phonePool.lastReportValue());
}));

// Monitoring ringan fleet HP: cek hidup/latensi/ganti-IP tanpa browser (hemat kuota).
app.post('/api/proxies/pool/monitor', asyncH(async (req, res) => {
  res.json(await phonePool.monitorOnce());
}));
app.get('/api/proxies/pool/monitor', asyncH(async (req, res) => {
  res.json(phonePool.monitorStatus());
}));
// Statistik fleet: uptime 7 hari, latensi rata-rata, ganti IP, ikatan akun, kuota signup.
app.get('/api/proxies/pool/stats', asyncH(async (req, res) => {
  res.json(await phonePool.fleetStats());
}));
// Riwayat cek mentah (untuk grafik/detail per HP).
app.get('/api/proxies/pool/history', asyncH(async (req, res) => {
  res.json(await db.listPhoneHealth({ limit: Number(req.query.limit) || 100 }));
}));
// Tren harian 7 hari (uptime % & latensi per HP) untuk grafik halaman Fleet.
app.get('/api/proxies/pool/trend', asyncH(async (req, res) => {
  res.json(await db.phoneHealthTrend());
}));

// Auto-monitor berkala (PHONE_MONITOR_INTERVAL_MIN=15 di .env; 0/nonaktif default).
phonePool.startAutoMonitor();
// Refresh sesi Gmail terjadwal: cek 6 jam, refresh sesi akun ok umur ≥10 hari
// supaya badge "Sesi hidup" tidak pernah masuk zona kuning (14 hari).
require('./src/gmail-session-refresh').startAuto();
app.get('/api/gmail/session/refresh/status', asyncH(async (req, res) => {
  res.json(require('./src/gmail-session-refresh').status());
}));
app.post('/api/gmail/session/refresh/run', strictLimiter, asyncH(async (req, res) => {
  res.json(await require('./src/gmail-session-refresh').refreshDueAccounts());
}));

// Helper probe exit IP akun via browser headless (patchright) — dipakai probe-ip
// manual dan PUT /:id/proxy (P3: auto-probe + sync fingerprint geo akun).
async function probeAccountIp(account) {
  const { chromium } = require('patchright'); // engine panel: patchright (drop-in playwright)
  const { parseProxy, stickyProxy } = require('./src/browser');
  const probeCtx = await chromium.launch({
    headless: true,
    proxy: parseProxy(stickyProxy(account.proxy, account.name)),
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  }).catch((e) => { throw new Error('browser probe gagal: ' + e.message.split('\n')[0]); });
  try {
    const ctx = await probeCtx.newContext({ ignoreHTTPSErrors: true });
    const resIp = await ctx.request.get('https://ipwho.is/', { timeout: 15000 });
    const data = await resIp.json().catch(() => null);
    if (!data || !data.ip) throw new Error('tidak bisa membaca exit IP (ipwho.is tidak merespons via proxy ini)');
    const rec = {
      ip: data.ip, country: data.country || null, country_code: data.country_code || null,
      city: data.city || null, asn: data.connection && data.connection.asn ? String(data.connection.asn) : null,
      source: 'probe', ok: 1,
    };
    await db.addIpHistory(account.id, rec);
    return rec;
  } finally { await probeCtx.close().catch(() => {}); }
}

// Set proxy utk satu akun (edit). P3 — paritas alur proxy-checker AdsPower: setelah
// proxy disimpan, langsung probe IP via proxy baru lalu sync fingerprint geo akun
// (timezone/locale mengikuti IP). Hasil probe + geo dikembalikan utk ditampilkan UI.
app.put('/api/accounts/:id/proxy', asyncH(async (req, res) => {
  const { proxy } = req.body;
  await db.setAccountProxy(Number(req.params.id), proxy || null);
  if (!proxy) return res.json({ ok: true, cleared: true });
  const account = await db.getAccountById(Number(req.params.id));
  if (!account) return res.json({ ok: true });
  let probe = null, probeError = null, geo = null;
  try { probe = await probeAccountIp(account); } catch (e) { probeError = String(e.message || e).slice(0, 160); }
  if (probe) {
    try {
      // Geo dari IP PROBE (IP exit persis yang dipakai browser sticky) — BUKAN lookup
      // CONNECT kedua dgn proxy raw: DI tanpa suffix sticky keluar negara ACAK
      // (terbukti: probe Banjarmasin-ID tapi CONNECT raw dapat Moskow).
      const { lookupIpGeo, localeForTz } = require('./src/stealth');
      const g = await lookupIpGeo(probe.ip);
      if (g && g.timezone) {
        const locale = localeForTz(g.timezone);
        db.run(`UPDATE accounts SET timezone = ?, locale = ? WHERE id = ?`, [g.timezone, locale, account.id]);
        db.save();
        geo = { timezone: g.timezone, locale, city: g.city || probe.city, latitude: g.latitude || null, longitude: g.longitude || null };
      }
    } catch (e) { /* sync geo gagal — proxy tetap tersimpan */ }
  }
  res.json({ ok: true, probe: probe ? { ip: probe.ip, country: probe.country, country_code: probe.country_code, city: probe.city } : { error: probeError }, geo });
}));

// ---- Riwayat IP per akun (monitoring IP/lokasi) ----
// Riwayat lengkap satu akun (untuk modal riwayat IP).
app.get('/api/accounts/:id/ip-history', asyncH(async (req, res) => {
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 30));
  res.json(await Promise.resolve(db.listIpHistory(Number(req.params.id), limit)));
}));
// Probe IP manual: buka browser headless sesaat via proxy akun, catat exit IP, tutup.
// Tak menyentuh profil persisten — aman walau akun sedang aktif di jendela lain.
app.post('/api/accounts/:id/probe-ip', asyncH(async (req, res) => {
  const account = await db.getAccountById(Number(req.params.id));
  if (!account) return res.status(404).json({ error: 'Akun tidak ditemukan' });
  const rec = await probeAccountIp(account);
  res.json({ ip: rec.ip, country: rec.country, country_code: rec.country_code, city: rec.city });
}));
app.get('/api/ig-likes', asyncH(async (req, res) => {
  res.json(await db.listIgLikeJobs());
}));

app.post('/api/ig-likes', asyncH(async (req, res) => {
  const { accountId, name, postUrl } = req.body;
  if (!accountId || !name || !postUrl) return res.status(400).json({ error: 'accountId, name, postUrl wajib' });
  const acc = await db.getAccountById(Number(accountId));
  if (!acc) return res.status(404).json({ error: 'Akun tidak ditemukan' });
  if (acc.platform !== 'ig') return res.status(400).json({ error: `Akun "${acc.name}" itu ${acc.platform}, bukan Instagram` });
  const id = await db.addIgLikeJob({ accountId: Number(accountId), name, postUrl });
  res.json({ id });
}));

app.delete('/api/ig-likes/:id', asyncH(async (req, res) => {
  await db.deleteIgLikeJob(Number(req.params.id));
  res.json({ ok: true });
}));

app.post('/api/ig-likes/:id/run', asyncH(async (req, res) => {
  const { likeIgPosting } = require('./src/actions');
  const job = await db.getIgLikeJob(Number(req.params.id));
  if (!job) return res.status(404).json({ error: 'Like IG tidak ditemukan' });
  const account = await db.getAccountById(job.account_id);
  if (!account) return res.status(404).json({ error: 'Akun tidak ditemukan' });
  if (account.platform !== 'ig') return res.status(400).json({ error: `Job IG ini menunjuk akun ${account.platform} ("${account.name}") — hapus & buat ulang dengan akun Instagram` });
  // Paritas jalur FB: eksekusi IG like lewat gerbang kebijakan yang sama
  // (status + warming + cooldown + limit + rate) supaya akun tahap awal tidak
  // seperti-kan postingan tanpa kurungan warming.
  const gate = await accountGate.check(account.id, 'like');
  if (!gate.ok) {
    await db.rawAll(`UPDATE ig_like_jobs SET status = 'blocked', last_run_at = ? WHERE id = ?`, [new Date().toISOString(), job.id]);
    return res.status(429).json({ error: 'Akun ditolak gerbang', reasons: gate.reasons });
  }
  await db.rawAll(`UPDATE ig_like_jobs SET status = 'running' WHERE id = ?`, [job.id]);
  const result = await likeIgPosting(account, job.post_url);
  if (result.ok) accountGate.record(account.id, 'like');
  await db.rawAll(`UPDATE ig_like_jobs SET status = ?, last_run_at = ? WHERE id = ?`,
    [result.ok ? 'done' : 'failed', new Date().toISOString(), job.id]);
  await db.logPost({ accountId: account.id, status: result.ok ? 'like_ok' : 'like_failed', message: 'IG Like: ' + (result.reason || job.name) });
  res.json(result);
}));
// Posting ke Instagram memakai akun IG sendiri. Media wajib.
app.post('/api/ig/post', upload.single('media'), asyncH(async (req, res) => {
  const { postToInstagram } = require('./src/actions');
  const { accountId, caption } = req.body;
  if (!accountId) return res.status(400).json({ error: 'accountId wajib' });
  if (!req.file) return res.status(400).json({ error: 'Media (gambar/video) wajib utk Instagram' });
  const account = await db.getAccountById(Number(accountId));
  if (!account) return res.status(404).json({ error: 'Akun tidak ditemukan' });
  if (account.platform !== 'ig') return res.status(400).json({ error: `Akun "${account.name}" itu ${account.platform}, bukan Instagram` });
  const mediaPath = path.join(UPLOAD_DIR, req.file.filename);
  // Komentar pertama (opsional): teks sama untuk akun ini, dicek gerbang komentar
  // dulu supaya akun tahap warming tidak melanggar batas aksinya.
  const autoComment = String(req.body.autoComment || '').trim().slice(0, 1000);
  const commentGate = autoComment ? await accountGate.check(account.id, 'comment') : null;
  const result = await postToInstagram(account, mediaPath, caption || '', {
    autoComment: autoComment && (!commentGate || commentGate.ok) ? autoComment : '',
  });
  if (autoComment && commentGate && !commentGate.ok) {
    result.comment = { ok: false, reason: 'gate', reasons: commentGate.reasons };
  }
  if (result.comment && result.comment.ok) {
    accountGate.record(account.id, 'comment');
    await db.logEngagement({
      accountId: account.id, action: 'comment', targetUrl: result.comment.url || null,
      commentText: autoComment, status: 'success', message: 'komentar otomatis setelah posting',
    }).catch(() => {});
  } else if (result.comment && !result.comment.ok) {
    await db.logEngagement({
      accountId: account.id, action: 'comment', targetUrl: result.comment.url || null,
      commentText: autoComment, status: 'failed', message: result.comment.reason || null,
    }).catch(() => {});
  }
  await db.logPost({ accountId: account.id, status: result.ok ? 'posted' : 'post_failed', message: 'IG: ' + (result.reason || 'posted'), contentText: caption || '' });
  res.json(result);
}));

// ---- SMM Like Orders (Rotasi Akun) ----
// Buat order like baru dengan rotasi akun otomatis
app.post('/api/smm/like-orders', asyncH(async (req, res) => {
  const { name, postUrl, targetLikes, platform } = req.body;
  if (!name || !postUrl || !targetLikes) {
    return res.status(400).json({ error: 'name, postUrl, dan targetLikes wajib' });
  }
  if (targetLikes < 1 || targetLikes > 1000) {
    return res.status(400).json({ error: 'targetLikes harus antara 1-1000' });
  }
  
  try {
    const orderId = await db.createSmmLikeOrder({
      name,
      postUrl,
      targetLikes: Number(targetLikes),
      platform: platform || 'fb'
    });
    res.json({ id: orderId, message: 'Order dibuat dengan rotasi akun otomatis' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}));

// List semua SMM like orders
app.get('/api/smm/like-orders', asyncH(async (req, res) => {
  const orders = await db.listSmmLikeOrders();
  res.json(orders);
}));

// Get detail order dengan daftar eksekusi per akun
app.get('/api/smm/like-orders/:id', asyncH(async (req, res) => {
  const order = await db.getSmmLikeOrder(Number(req.params.id));
  if (!order) return res.status(404).json({ error: 'Order tidak ditemukan' });
  res.json(order);
}));

// Jalankan order (process pending executions dengan rate limiting)
app.post('/api/smm/like-orders/:id/run', asyncH(async (req, res) => {
  const orderId = Number(req.params.id);
  const order = await db.getSmmLikeOrder(orderId);
  
  if (!order) return res.status(404).json({ error: 'Order tidak ditemukan' });
  if (order.status === 'cancelled') return res.status(400).json({ error: 'Order telah dibatalkan' });
  if (order.status === 'paused') return res.status(400).json({ error: 'Order sedang dipause' });
  
  // Ambil eksekusi pending (batch 2-3 untuk keamanan)
  const batchSize = 2;
  const executions = await db.getPendingSmmExecutions(orderId, batchSize);
  
  if (executions.length === 0) {
    return res.json({ message: 'Tidak ada eksekusi pending', completed: order.completed_likes, target: order.target_likes });
  }
  
  const crypto = require('./src/crypto');
  const { likePosting, likeIgPosting } = require('./src/actions');
  const results = [];
  
  // Process setiap eksekusi dengan delay dan retry
  for (let i = 0; i < executions.length; i++) {
    const exec = executions[i];
    
    const account = {
      id: exec.account_id,
      name: exec.account_name,
      email: exec.email,
      password: crypto.decrypt(exec.password_enc),
      browser_profile_dir: exec.browser_profile_dir,
      proxy: exec.proxy,
      platform: order.platform
    };
    
    // Pilih fungsi like sesuai platform
    const likeFunction = order.platform === 'ig' ? likeIgPosting : likePosting;
    
    let result = null;
    let retryCount = 0;
    const maxRetries = 2;
    
    // Retry mechanism
    while (retryCount <= maxRetries) {
      try {
        result = await likeFunction(account, order.post_url);
        
        // Jika berhasil atau sudah like, break
        if (result.ok || result.already) break;
        
        // Jika gagal dan masih ada retry, tunggu sebentar
        if (retryCount < maxRetries) {
          console.log(`  [smm] retry ${retryCount + 1}/${maxRetries} untuk ${exec.account_name}`);
          await new Promise(resolve => setTimeout(resolve, 5000)); // 5 detik
        }
      } catch (error) {
        result = { ok: false, reason: 'exception: ' + error.message };
      }
      
      retryCount++;
    }
    
    // Update status eksekusi
    await db.updateSmmExecutionStatus(
      exec.id,
      result.ok ? 'completed' : 'failed',
      result.ok ? null : (result.reason || 'Unknown error')
    );
    
    results.push({
      execution_id: exec.id,
      account: exec.account_name,
      status: result.ok ? 'completed' : 'failed',
      message: result.reason || (result.ok ? 'Success' : 'Failed'),
      retries: retryCount - 1
    });
    
    // Rate limiting: delay antar like (30-90 detik) kecuali like terakhir
    if (i < executions.length - 1) {
      const delayMs = 30000 + Math.floor(Math.random() * 60000); // 30-90 detik
      console.log(`  [smm] delay ${Math.round(delayMs/1000)}s sebelum like berikutnya...`);
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
  
  const updatedOrder = await db.getSmmLikeOrder(orderId);
  
  res.json({
    processed: results.length,
    results,
    order_status: updatedOrder.status,
    completed: updatedOrder.completed_likes,
    target: updatedOrder.target_likes,
    rate_limited: true
  });
}));

// Hapus order
app.delete('/api/smm/like-orders/:id', asyncH(async (req, res) => {
  await db.deleteSmmLikeOrder(Number(req.params.id));
  res.json({ ok: true });
}));

// Pause order
app.post('/api/smm/like-orders/:id/pause', asyncH(async (req, res) => {
  await db.pauseSmmLikeOrder(Number(req.params.id));
  res.json({ ok: true, message: 'Order dipause' });
}));

// Resume order
app.post('/api/smm/like-orders/:id/resume', asyncH(async (req, res) => {
  await db.resumeSmmLikeOrder(Number(req.params.id));
  res.json({ ok: true, message: 'Order dilanjutkan' });
}));

// Cancel order
app.post('/api/smm/like-orders/:id/cancel', asyncH(async (req, res) => {
  await db.cancelSmmLikeOrder(Number(req.params.id));
  res.json({ ok: true, message: 'Order dibatalkan' });
}));

// ---- SMM Comment Orders (Auto Komentar FB/IG) ----
// Target = jumlah komentar. Satu akun hanya meninggalkan satu komentar, jadi
// target dibatasi jumlah akun aktif platform tersebut. Runner berjalan di
// latar belakang agar jeda antar komentar tidak menggantung request HTTP.
app.post('/api/smm/comment-orders', asyncH(async (req, res) => {
  const { name, postUrl, targetComments, platform, commentText, aiContext } = req.body || {};
  if (!name || !postUrl || !targetComments) {
    return res.status(400).json({ error: 'name, postUrl, dan targetComments wajib' });
  }
  const target = Number(targetComments);
  if (!Number.isInteger(target) || target < 1 || target > 1000) {
    return res.status(400).json({ error: 'targetComments harus antara 1-1000' });
  }
  const plat = platform === 'ig' ? 'ig' : 'fb';
  const text = typeof commentText === 'string' ? commentText.trim().slice(0, 1000) : '';
  // Klien lama tidak mengirim aiContext; mode AI tetap menjadi bawaan.
  const useAi = aiContext === undefined || aiContext === null
    ? true
    : !(aiContext === false || aiContext === 0 || aiContext === '0' || aiContext === 'false');
  try {
    const id = await db.createSmmCommentOrder({
      name: String(name).trim().slice(0, 160),
      postUrl: String(postUrl).trim(),
      targetComments: target,
      platform: plat,
      commentText: text || null,
      aiContext: useAi,
    });
    res.json({ id, message: 'Order komentar dibuat. Tekan Jalankan untuk mulai.' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}));

// Pratinjau hanya diperbolehkan untuk domain platform yang sesuai. Tanpa
// batas ini, sesi akun operator bisa dipakai membuka situs sembarang.
function isPlatformPostUrl(raw, platform) {
  let url;
  try { url = new URL(String(raw)); } catch (e) { return false; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  const host = url.hostname.toLowerCase();
  if (platform === 'ig') return host === 'instagram.com' || host.endsWith('.instagram.com');
  return ['facebook.com', 'fb.com', 'fb.watch', 'fb.me']
    .some((domain) => host === domain || host.endsWith('.' + domain));
}

app.post('/api/smm/comment-orders/preview', strictLimiter, asyncH(async (req, res) => {
  const { postUrl, platform } = req.body || {};
  const plat = platform === 'ig' ? 'ig' : 'fb';
  const label = plat === 'ig' ? 'Instagram' : 'Facebook';
  const url = String(postUrl || '').trim();
  if (!isPlatformPostUrl(url, plat)) {
    return res.status(400).json({ error: `URL harus mengarah ke postingan ${label}.` });
  }
  if (!aiConfig.load().apiKey) {
    return res.status(400).json({ error: 'AI belum tersambung. Isi key di Pengaturan AI sebelum membuat pratinjau.' });
  }

  // Akun yang paling baru login lebih mungkin masih punya sesi untuk membaca
  // kiriman. Kalau tetap ditolak, pesan error menyebut akun yang dicoba.
  const rows = await db.rawAll(
    `SELECT id FROM accounts WHERE platform = ? AND status = 'active' ORDER BY last_login DESC, id LIMIT 1`,
    [plat]
  );
  if (!rows.length) {
    return res.status(400).json({ error: `Tidak ada akun aktif ${label}. Aktifkan akun dulu di halaman Akun.` });
  }
  const account = await db.getAccountById(rows[0].id);
  if (!account) {
    return res.status(400).json({ error: `Akun aktif ${label} tidak ditemukan.` });
  }

  const read = await commentAutomation.readPostForPreview(account, url, plat);
  if (!read.ok) {
    const reason = String(read.reason || 'gagal');
    let error;
    if (reason === 'not_logged_in') {
      error = `Akun ${account.name} tidak sedang login. Buka akun itu di halaman Akun, lalu coba lagi.`;
    } else if (reason === 'konteks_tidak_terbaca') {
      error = 'Teks postingan tidak terbaca. Pastikan URL membuka kiriman, bukan beranda atau halaman login.';
    } else {
      error = 'Gagal membaca postingan: ' + reason.replace(/^error:\s*/i, '').slice(0, 220);
    }
    return res.status(422).json({ error });
  }

  try {
    const { clean } = require('./src/comment-order-runner');
    const comment = clean(await aiContentGenerator.generateComment(
      read.context,
      'Ini pratinjau satu komentar. Tulis komentar pertama yang relevan dengan postingan.'
    ));
    if (!comment) throw new Error('AI mengembalikan komentar kosong.');
    res.json({
      ok: true,
      context: read.context,
      comment,
      account: { id: account.id, name: account.name },
    });
  } catch (e) {
    res.status(502).json({
      error: 'AI gagal menyusun komentar: ' + e.message,
      context: read.context,
      account: { id: account.id, name: account.name },
    });
  }
}));

app.get('/api/smm/comment-orders', asyncH(async (req, res) => {
  res.json(await db.listSmmCommentOrders());
}));

app.get('/api/smm/comment-orders/:id', asyncH(async (req, res) => {
  const order = await db.getSmmCommentOrder(Number(req.params.id));
  if (!order) return res.status(404).json({ error: 'Order tidak ditemukan' });
  res.json(order);
}));

app.post('/api/smm/comment-orders/:id/run', asyncH(async (req, res) => {
  const id = Number(req.params.id);
  const order = await db.getSmmCommentOrder(id);
  if (!order) return res.status(404).json({ error: 'Order tidak ditemukan' });
  if (order.status === 'cancelled') return res.status(400).json({ error: 'Order sudah dihentikan' });
  if (Number(order.completed_comments) >= Number(order.target_comments)) {
    return res.status(400).json({ error: 'Order sudah selesai' });
  }
  // Order yang berhenti karena semua eksekusi gagal boleh dicoba lagi: kembalikan
  // yang gagal ke antrean, lalu rotasi akun memilih pengganti yang sehat.
  if (order.status === 'failed') await db.resetFailedSmmCommentExecutions(id);
  await db.setSmmCommentOrderStatus(id, 'running');
  const commentOrderRunner = require('./src/comment-order-runner');
  const started = commentOrderRunner.start(id);
  res.json({ started, message: started ? 'Order berjalan di latar belakang.' : 'Order ini sedang berjalan.' });
}));

app.post('/api/smm/comment-orders/:id/cancel', asyncH(async (req, res) => {
  const id = Number(req.params.id);
  if (!(await db.getSmmCommentOrder(id))) return res.status(404).json({ error: 'Order tidak ditemukan' });
  await db.cancelSmmCommentOrder(id);
  res.json({ ok: true, message: 'Order dihentikan. Komentar yang sedang diproses tetap diselesaikan.' });
}));

app.delete('/api/smm/comment-orders/:id', asyncH(async (req, res) => {
  await db.deleteSmmCommentOrder(Number(req.params.id));
  res.json({ ok: true });
}));

// ---- AI ----
// Konfigurasi koneksi AI yang bisa diubah dari halaman AI. Key tidak pernah
// dikirim balik: publicConfig hanya memberi petunjuk samaran dan sumbernya.
app.get('/api/ai/config', (req, res) => {
  res.json(aiConfig.publicConfig());
});

app.put('/api/ai/config', (req, res) => {
  try {
    res.json(aiConfig.save(req.body || {}));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Daftar model dari Base URL yang sedang diisi. Nilai formulir boleh dikirim
// sebelum disimpan supaya operator bisa memeriksa koneksi baru lebih dulu.
app.post('/api/ai/models', asyncH(async (req, res) => {
  const { listModels } = require('./src/ai');
  const { baseUrl: base, apiKey: key } = req.body || {};
  try {
    const models = await listModels({ baseUrl: base, apiKey: key });
    res.json({ models });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
}));

app.post('/api/ai/test', asyncH(async (req, res) => {
  const { testConnection } = require('./src/ai');
  const { baseUrl: base, model, apiKey: key, reasoningEffort } = req.body || {};
  try {
    res.json(await testConnection({ baseUrl: base, model, apiKey: key, reasoningEffort }));
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
}));

// Generate konten pakai AI.
app.post('/api/ai/generate', asyncH(async (req, res) => {
  const { generateContent } = require('./src/ai');
  const { prompt } = req.body || {};
  if (!prompt) return res.status(400).json({ error: 'prompt wajib' });
  try {
    const content = await generateContent(prompt);
    res.json({ content });
  } catch (e) {
    // Pesan kuota/model/key harus sampai ke operator, bukan ditelan handler
    // error global yang mengganti semuanya menjadi "Internal server error".
    res.status(502).json({ error: e.message });
  }
}));

// Variasi caption untuk banyak akun: satu topik, tiap akun dapat kalimat dan
// deskripsi gambar sendiri supaya kiriman massal tidak identik.
app.post('/api/ai/captions', asyncH(async (req, res) => {
  const { generateCaptionVariants } = require('./src/ai');
  const { topic, count, platform } = req.body;
  if (!topic || !String(topic).trim()) return res.status(400).json({ error: 'topic wajib' });
  const n = Math.min(Math.max(Number(count) || 1, 1), 20);
  try {
    const variants = await generateCaptionVariants({
      topic: String(topic).trim().slice(0, 400),
      count: n,
      platform: platform === 'ig' ? 'Instagram' : 'Facebook',
    });
    res.json({ variants });
  } catch (e) {
    // Pesan provider (kuota/model) harus sampai ke operator, bukan ditelan
    // handler error global yang mengganti 500 menjadi "Internal server error".
    res.status(502).json({ error: e.message });
  }
}));

// Gambar posting AI: server yang mengunduh supaya browser hanya menerima bytes
// dari origin sendiri, lalu memasangnya ke FormData tanpa URL lintas origin.
app.get('/api/ai/image', asyncH(async (req, res) => {
  const { generateImage } = require('./src/ai-image');
  const prompt = String(req.query.prompt || '').trim();
  if (!prompt) return res.status(400).json({ error: 'prompt wajib' });
  try {
    const img = await generateImage({
      prompt: prompt.slice(0, 600),
      seed: Number(req.query.seed) || undefined,
      // Model dipilih operator di panel; modul gambar yang memvalidasi daftarnya.
      model: String(req.query.model || ''),
      width: Math.min(Math.max(Number(req.query.width) || 1024, 320), 1440),
      height: Math.min(Math.max(Number(req.query.height) || 1024, 320), 1440),
    });
    res.set('Content-Type', img.type);
    res.set('Cache-Control', 'no-store');
    // Asal gambar ikut dikirim supaya UI bisa menyebut penyedianya tanpa
    // menebak dari nama file atau jam pembuatan.
    if (img.provider) res.set('X-Image-Provider', img.provider);
    if (img.model) res.set('X-Image-Model', img.model);
    res.send(img.buffer);
  } catch (e) {
    res.status(e.statusCode || 502).json({ error: e.message, retryAfter: e.retryAfter || null });
  }
}));

// Topik mentah tidak layak jadi prompt gambar, jadi diterjemahkan dulu lewat
// model teks; dari panggilan yang sama diambil teks kartu berita (kicker, judul,
// detail). Kalau AI belum punya key atau sedang gagal, endpoint tetap
// mengembalikan topik apa adanya supaya tombol Gambar AI tidak ikut mati.
app.post('/api/ai/image-prompt', asyncH(async (req, res) => {
  const { generateImageBrief } = require('./src/ai');
  const body = req.body || {};
  const topic = String(body.topic || '').trim();
  if (!topic) return res.status(400).json({ error: 'topic wajib' });
  try {
    const brief = await generateImageBrief({
      topic: topic.slice(0, 300),
      caption: String(body.caption || '').slice(0, 400),
    });
    res.json({ prompt: brief.prompt, news: brief.news, source: 'ai' });
  } catch (e) {
    res.json({ prompt: topic, news: null, source: 'topic', error: e.message });
  }
}));

// Aktivasi via login: panggil fb-login-check / ig-relogin dengan profil persisten akun.
app.post('/api/accounts/:id/activate-login', asyncH(async (req, res) => {
  const account = await db.getAccountById(Number(req.params.id));
  if (!account) return res.status(404).json({ error: 'Akun tidak ditemukan' });
  const r = await createRunner.startActivation(account);
  if (r.error) return res.status(409).json(r);
  res.json(r);
}));
app.get('/api/accounts/:id/activate-login/status', asyncH(async (req, res) => {
  const id = Number(req.params.id);
  const account = await db.getAccountById(id);
  const st = createRunner.activationStatus(id);
  res.json({ ...st, keepOpen: account ? createRunner.activationKeepOpen(account).open : false });
}));
// Tutup browser yang dibiarkan terbuka setelah login berhasil (proses keep-open).
app.post('/api/accounts/:id/activate-login/close-browser', asyncH(async (req, res) => {
  const account = await db.getAccountById(Number(req.params.id));
  if (!account) return res.status(404).json({ error: 'Akun tidak ditemukan' });
  const r = createRunner.closeActivationBrowser(account);
  if (r.error === 'tidak_ada_browser_terbuka') return res.status(409).json(r);
  if (r.error) return res.status(500).json(r);
  res.json(r);
}));
app.post('/api/accounts/:id/activate-login/stop', asyncH(async (req, res) => {
  res.json(createRunner.stopActivation(Number(req.params.id)));
}));
// Semua job aktivasi (terbaru dulu): panel memulihkan kartu status saat dibuka.
app.get('/api/activations', asyncH(async (req, res) => {
  res.json(await createRunner.activationsStatus());
}));

// Login otomatis untuk satu akun (browser terbuka). Hanya kasih hasil panjang (web dev only).
app.post('/api/accounts/:id/login', asyncH(async (req, res) => {
  const { loginAccount } = require('./src/actions');
  const account = await db.getAccountById(Number(req.params.id));
  if (!account) return res.status(404).json({ error: 'Akun tidak ditemukan' });
  try {
    const result = await loginAccount(account);
    if (result.ok) {
      await db.setAccountStatus(account.id, 'active');
      await db.logPost({ accountId: account.id, status: 'login_ok', message: 'Login berhasil, session tersimpan' });
    } else {
      await db.setAccountStatus(account.id, 'checkpoint');
      await db.logPost({ accountId: account.id, status: 'login_failed', message: result.reason });
    }
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}));

// Buka browser profil akun (headless:false) biarkan terbuka utk inspect manual.
app.post('/api/accounts/:id/open', asyncH(async (req, res) => {
  const { openAccountBrowser } = require('./src/browser');
  const account = await db.getAccountById(Number(req.params.id));
  if (!account) return res.status(404).json({ error: 'Akun tidak ditemukan' });
  // IG dibuka mode mobile (paritas daftar/aktivasi — tampilan seperti HP):
  // FB tetap desktop fingerprint (nilainya fp.viewport 1366x768).
  const isIgPre = account.platform === 'ig' || account.platform === 'instagram';
  const { context, browser, profile } = await openAccountBrowser(account, { headless: false, mobile: isIgPre });
  // Arah ke platform akun masing-masing (bukan selalu FB).
  const isIg = account.platform === 'ig' || account.platform === 'instagram';
  const homeUrl = isIg ? 'https://www.instagram.com/' : 'https://www.facebook.com/';
  // Suntik cookie login tersimpan (kanonis: sessions/<nama>/cookies.json, legacy: sessions/ig-<nama>-*.json)
  let sess = null;
  try {
    const fs = require('fs');
    const sessDir = path.join(__dirname, 'sessions');
    const canonDir = path.join(sessDir, account.name);
    const canonFiles = ['cookies.json', 'manual-1.json'];
    for (const f of canonFiles) {
      const p = path.join(canonDir, f);
      if (fs.existsSync(p)) { sess = JSON.parse(fs.readFileSync(p, 'utf8')); break; }
    }
    if (!sess) {
      const cands = fs.readdirSync(sessDir).filter((f) => f.startsWith(`ig-${account.name}-`) && f.endsWith('.json'));
      if (isIg && cands.length) sess = JSON.parse(fs.readFileSync(path.join(sessDir, cands.sort().pop()), 'utf8'));
    }
    if (sess && sess.cookies && sess.cookies.length) {
      await context.addCookies(sess.cookies.map((c) => ({
        name: c.name, value: c.value, domain: c.domain, path: c.path || '/',
        expires: c.expires && c.expires > 0 ? c.expires : undefined,
        httpOnly: !!c.httpOnly, secure: !!c.secure,
        sameSite: ['Strict', 'Lax', 'None'].includes(c.sameSite) ? c.sameSite : 'Lax'
      })));
      console.log(`[open] ${sess.cookies.length} cookie disuntik untuk "${account.name}"`);
    }
  } catch (e) { console.error('[open] suntik cookie gagal:', e.message); }
  const page = await context.newPage();
  await page.goto(homeUrl, { waitUntil: 'domcontentloaded' }).catch((e) => console.error('[open] goto gagal:', e.message));
  console.log(`[open] browser profil "${account.name}" dibuka & arah ke ${homeUrl} (kept alive).`);
  // Sinkron sesi: cookies context saat ini (termasuk yang IG segarkan saat membuka
  // halaman, atau hasil operator menekan one-tap "Lanjutkan") ditulis balik ke
  // sessions/<nama>/cookies.json supaya pembukaan BERIKUTNYA langsung beranda.
  setTimeout(() => {
    context.cookies().then(async (cks) => {
      if (!cks || !cks.length) return;
      const canonDir = path.join(__dirname, 'sessions', account.name);
      const canonPath = path.join(canonDir, 'cookies.json');
      const old = fs.existsSync(canonPath) ? JSON.parse(fs.readFileSync(canonPath, 'utf8')) : {};
      fs.mkdirSync(canonDir, { recursive: true });
      fs.writeFileSync(canonPath, JSON.stringify({
        ...old,
        platform: isIg ? 'instagram' : 'facebook', username: account.name, email: account.email,
        proxy: account.proxy || old.proxy, cookies: cks, updated_from: 'open',
        updated_at: new Date().toISOString(),
      }, null, 2));
      console.log(`[open] ${cks.length} cookie disinkron ke ${path.relative(__dirname, canonPath)}`);
    }).catch(() => {});
  }, 15000); // beri waktu IG menetapkan sesi (one-tap "Lanjutkan" dimuat + diklik)
  // Membuka browser profil = aktivitas login-ish: last_login ikut dicatat supaya
  // kolom "Login Terakhir" tidak menampilkan "–" untuk akun yang tipis dibuka.
  db.setAccountLastLogin(account.id).catch(() => {});
  // Detail profil Chrome + cookie + proxy: biar panel bisa menampilkan apa yang
  // benar-benar dipakai browser ini (bukan tebakan) — ditempatkan sekali di sini.
  const sessCookieCount = sess && Array.isArray(sess.cookies) ? sess.cookies.length : 0;
  res.json({
    ok: true,
    home: homeUrl,
    cookies: sessCookieCount,
    profile,
  });
}));

// Alias lama: /open-ig kini sama dengan /open (ikut platform akun). Disimpan biar tombol lama tidak 404.
app.post('/api/accounts/:id/open-ig', asyncH(async (req, res) => {
  return res.status(410).json({ error: 'Gunakan /api/accounts/:id/open (otomatis ikut platform akun)' });
}));

// Posting langsung (sekarang) ke satu akun, tanpa menunggu jadwal.
app.post('/api/accounts/:id/post-now', upload.single('media'), asyncH(async (req, res) => {
  const { postToTimeline } = require('./src/actions');
  const content = req.body.content;
  if (!content) return res.status(400).json({ error: 'content wajib' });
  if (content.length > MAX_CONTENT_LEN) {
    return res.status(400).json({ error: `Konten terlalu panjang (maks ${MAX_CONTENT_LEN} karakter)` });
  }
  const account = await db.getAccountById(Number(req.params.id));
  if (!account) return res.status(404).json({ error: 'Akun tidak ditemukan' });
  const mediaPath = req.file ? path.join(UPLOAD_DIR, req.file.filename) : null;
  const autoComment = String(req.body.autoComment || '').trim().slice(0, 1000);
  const commentGate = autoComment ? await accountGate.check(account.id, 'comment') : null;
  const result = await postToTimeline(account, content, mediaPath, {
    autoComment: autoComment && (!commentGate || commentGate.ok) ? autoComment : '',
  });
  if (autoComment && commentGate && !commentGate.ok) {
    result.comment = { ok: false, reason: 'gate', reasons: commentGate.reasons };
  }
  if (result.comment && result.comment.ok) {
    accountGate.record(account.id, 'comment');
    await db.logEngagement({
      accountId: account.id, action: 'comment', targetUrl: result.comment.url || null,
      commentText: autoComment, status: 'success', message: 'komentar otomatis setelah posting',
    }).catch(() => {});
  } else if (result.comment && !result.comment.ok) {
    await db.logEngagement({
      accountId: account.id, action: 'comment', targetUrl: result.comment.url || null,
      commentText: autoComment, status: 'failed', message: result.comment.reason || null,
    }).catch(() => {});
  }
  if (result.ok) {
    await db.logPost({ accountId: account.id, status: 'posted', message: 'Posting langsung berhasil', contentText: content });
  } else {
    await db.logPost({ accountId: account.id, status: 'post_failed', message: result.reason, contentText: content });
  }
  res.json(result);
}));

// Simulasikan menjalankan semua jadwal yang sudah lewat (untuk uji)
app.post('/api/run-due', asyncH(async (req, res) => {
  const { processDueSchedules } = require('./src/scheduler');
  const n = await processDueSchedules();
  res.json({ processed: n });
}));

// Pembersihan data & file lama (schedule done/failed, content unreferenced, log lama).
const fs = require('fs');
app.post('/api/cleanup', asyncH(async (req, res) => {
  const files = await db.cleanupFinalized();
  // Hapus file media dari uploads/ yang sudah tidak dipakai.
  let removed = 0;
  for (const f of files) {
    try { if (fs.existsSync(f)) { fs.unlinkSync(f); removed++; } } catch (e) {}
  }
  res.json({ removedFiles: removed, orphanPaths: files.length });
}));

// ---- NEW FEATURES ----

// Health Check Endpoints
app.get('/api/health/account/:id', strictLimiter, asyncH(async (req, res) => {
  const result = await healthChecker.checkAccountHealth(Number(req.params.id));
  res.json(result);
}));

app.get('/api/health/accounts', strictLimiter, asyncH(async (req, res) => {
  const result = await healthChecker.checkAllAccountsHealth();
  res.json(result);
}));

// Proxy Management Endpoints
app.post('/api/proxy/test', asyncH(async (req, res) => {
  const { proxy } = req.body;
  if (!proxy) return res.status(400).json({ error: 'Proxy string required' });
  const result = await proxyValidator.testProxy(proxy);
  res.json(result);
}));

app.post('/api/proxy/test-multiple', asyncH(async (req, res) => {
  const { proxies } = req.body;
  if (!proxies || !Array.isArray(proxies)) {
    return res.status(400).json({ error: 'Proxies array required' });
  }
  const results = await proxyValidator.testMultipleProxies(proxies);
  res.json(results);
}));

app.get('/api/proxy/validate-all', strictLimiter, asyncH(async (req, res) => {
  const result = await proxyValidator.validateAllProxies(db);
  res.json(result);
}));

app.post('/api/proxy/rotate/:accountId', asyncH(async (req, res) => {
  const result = await proxyValidator.rotateProxyForAccount(db, Number(req.params.accountId));
  res.json(result);
}));

// Queue Management Endpoints
app.post('/api/queue/process-order/:id', asyncH(async (req, res) => {
  const { batchSize } = req.body;
  const result = await queueManager.processSmmOrder(Number(req.params.id), batchSize || 2);
  res.json(result);
}));

app.post('/api/queue/process-all', strictLimiter, asyncH(async (req, res) => {
  const result = await queueManager.processAllRunningOrders();
  res.json(result);
}));

app.get('/api/queue/stats', asyncH(async (req, res) => {
  const stats = queueManager.getQueueStats();
  res.json(stats);
}));

app.post('/api/queue/reset-stats', asyncH(async (req, res) => {
  queueManager.resetQueueStats();
  res.json({ ok: true, message: 'Queue stats reset' });
}));

// Enhanced SMM Order dengan Schedule Support
app.post('/api/smm/like-orders-scheduled', asyncH(async (req, res) => {
  const { post_url, quantity, platform, scheduled_at, name } = req.body;
  
  if (!post_url || !quantity) {
    return res.status(400).json({ error: 'post_url dan quantity wajib' });
  }
  
  if (scheduled_at && new Date(scheduled_at) < new Date()) {
    return res.status(400).json({ error: 'scheduled_at harus di masa depan' });
  }

  const orderId = await db.createSmmLikeOrder({
    name: name || `Scheduled ${Date.now()}`,
    postUrl: post_url,
    targetLikes: Number(quantity),
    platform: platform || 'fb'
  });
  
  if (scheduled_at) {
    await db.rawAll(`UPDATE smm_like_orders SET scheduled_at = ? WHERE id = ?`, [scheduled_at, orderId]);
    await db.rawAll(`UPDATE smm_like_orders SET status = 'scheduled' WHERE id = ?`, [orderId]);
  }
  
  const order = await db.getSmmLikeOrder(orderId);
  broadcastNotification('success', `Order ${orderId} created${scheduled_at ? ' and scheduled' : ''}`, { orderId, scheduled_at });
  
  res.json({ 
    ok: true, 
    orderId, 
    order,
    scheduled: !!scheduled_at 
  });
}));

// WebSocket Status Endpoint
app.get('/api/websocket/status', asyncH(async (req, res) => {
  const { getConnectedClients } = require('./src/websocket');
  res.json({
    connected: getConnectedClients(),
    enabled: true,
  });
}));

// System Status Endpoint
app.get('/api/system/status', asyncH(async (req, res) => {
  const { getConnectedClients } = require('./src/websocket');
  const queueStats = queueManager.getQueueStats();
  
  const runningOrders = await db.listSmmLikeOrders('running');
  const scheduledOrders = await db.rawAll(`SELECT COUNT(*) as c FROM smm_like_orders WHERE status = 'scheduled'`);
  
  res.json({
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    websocket: {
      connected: getConnectedClients(),
    },
    queue: queueStats,
    orders: {
      running: runningOrders.length,
      scheduled: scheduledOrders[0].c,
    },
  });
}));

// Recent Orders Endpoint untuk monitoring
// ---- Multiple Run (Batch Automation) ----
// Jalankan aksi yang sama untuk banyak akun sekaligus (login/like/ig-like/post).

const VALID_BATCH_ACTIONS = ['login', 'like', 'ig-like', 'post', 'post-ig'];

app.get('/api/batch/progress', asyncH(async (req, res) => {
  res.json(batchRunner.getProgress());
}));

app.post('/api/batch/run', asyncH(async (req, res) => {
  const { accountIds, action, url, content, caption, mediaPath } = req.body;
  if (!Array.isArray(accountIds) || !accountIds.length) {
    return res.status(400).json({ error: 'accountIds wajib (array id akun)' });
  }
  if (!VALID_BATCH_ACTIONS.includes(action)) {
    return res.status(400).json({ error: `action wajib salah satu dari: ${VALID_BATCH_ACTIONS.join(', ')}` });
  }
  if ((action === 'like' || action === 'ig-like') && !url) {
    return res.status(400).json({ error: 'url wajib untuk aksi like' });
  }
  if ((action === 'post' || action === 'post-ig') && !content) {
    return res.status(400).json({ error: 'content wajib untuk aksi post' });
  }

  const accounts = [];
  for (const id of accountIds) {
    const a = await db.getAccountById(Number(id));
    if (a) accounts.push(a);
  }
  if (!accounts.length) return res.status(400).json({ error: 'Tidak ada akun valid ditemukan' });

  const summary = await batchRunner.runBatch(accounts, action, { url, content, caption, mediaPath });
  res.json(summary);
}));

app.post('/api/batch/run-all', asyncH(async (req, res) => {
  const { status, platform, action, url, content, caption, mediaPath } = req.body;
  if (!VALID_BATCH_ACTIONS.includes(action)) {
    return res.status(400).json({ error: `action wajib salah satu dari: ${VALID_BATCH_ACTIONS.join(', ')}` });
  }
  if ((action === 'like' || action === 'ig-like') && !url) {
    return res.status(400).json({ error: 'url wajib untuk aksi like' });
  }
  if ((action === 'post' || action === 'post-ig') && !content) {
    return res.status(400).json({ error: 'content wajib untuk aksi post' });
  }

  const all = await db.listAccounts();
  const filtered = all.filter(a => {
    if (status && a.status !== status) return false;
    if (platform && a.platform !== platform) return false;
    return true;
  });
  if (!filtered.length) return res.status(400).json({ error: 'Tidak ada akun yang cocok dengan filter' });

  const summary = await batchRunner.runBatch(filtered, action, { url, content, caption, mediaPath });
  res.json(summary);
}));

app.get('/api/orders/recent', asyncH(async (req, res) => {
  const limit = parseInt(req.query.limit) || 10;
  const orders = await db.rawAll(`
    SELECT 
      id, 
      platform, 
      target_url, 
      target_likes, 
      status, 
      created_at,
      (SELECT COUNT(*) FROM smm_like_executions WHERE order_id = smm_like_orders.id AND status = 'success') as completed
    FROM smm_like_orders 
    ORDER BY created_at DESC 
    LIMIT ?
  `, [limit]);
  res.json(orders);
}));

const healthMonitor = require('./src/health-monitor');
const sessionManager = require('./src/session-manager');
const proxyManager = require('./src/proxy-manager');
const errorRecovery = require('./src/error-recovery');
const analytics = require('./src/analytics');

app.get('/api/health/dashboard', asyncH(async (req, res) => {
  const dashboard = await healthMonitor.getHealthDashboard();
  res.json(dashboard);
}));

app.get('/api/health/history/:accountId', asyncH(async (req, res) => {
  const days = parseInt(req.query.days) || 7;
  const history = await healthMonitor.getHealthHistory(parseInt(req.params.accountId), days);
  res.json(history);
}));

app.post('/api/health/check', asyncH(async (req, res) => {
  const results = await healthMonitor.runHealthCheck(null);
  res.json(results);
}));

app.post('/api/health/check/:accountId', asyncH(async (req, res) => {
  const accountId = parseInt(req.params.accountId);
  const results = await healthMonitor.runHealthCheck(accountId);
  res.json(results);
}));

app.get('/api/sessions/stats', asyncH(async (req, res) => {
  const stats = await sessionManager.getAccountSessionStats();
  res.json(stats[0] || { total: 0, active_sessions: 0, never_logged_in: 0, expired_sessions: 0 });
}));

app.get('/api/sessions/expiring', asyncH(async (req, res) => {
  const days = parseInt(req.query.days) || 7;
  const expiring = await sessionManager.getExpiringSessions(days);
  res.json(expiring);
}));

app.post('/api/sessions/check', asyncH(async (req, res) => {
  const expired = await sessionManager.checkSessionExpiry();
  res.json({ expired_count: expired });
}));

app.get('/api/proxy/stats', asyncH(async (req, res) => {
  const stats = await proxyManager.getProxyStats();
  res.json(stats);
}));

app.post('/api/proxy/rotate/:accountId', asyncH(async (req, res) => {
  const newProxy = await proxyManager.rotateProxy(parseInt(req.params.accountId));
  res.json({ new_proxy: newProxy });
}));

app.post('/api/proxy/mark-dead', asyncH(async (req, res) => {
  const { proxy, reason } = req.body;
  const affected = await proxyManager.markProxyDead(proxy, reason);
  res.json({ affected_accounts: affected });
}));

app.get('/api/analytics/success-rate', asyncH(async (req, res) => {
  const period = req.query.period || '7 days';
  const rate = await analytics.getSuccessRate(period);
  res.json(rate);
}));

app.get('/api/analytics/daily', asyncH(async (req, res) => {
  const days = parseInt(req.query.days) || 7;
  const daily = await analytics.getDailyStats(days);
  res.json(daily);
}));

app.get('/api/analytics/top-performers', asyncH(async (req, res) => {
  const limit = parseInt(req.query.limit) || 10;
  const top = await analytics.getTopPerformers(limit);
  res.json(top);
}));

app.get('/api/analytics/proxy-performance', asyncH(async (req, res) => {
  const perf = await analytics.getProxyPerformance();
  res.json(perf);
}));

app.get('/api/analytics/account/:accountId', asyncH(async (req, res) => {
  const days = parseInt(req.query.days) || 7;
  const perf = await analytics.getAccountPerformance(parseInt(req.params.accountId), days);
  res.json(perf);
}));

app.get('/api/recovery/stats', asyncH(async (req, res) => {
  const stats = await errorRecovery.getRecoveryStats();
  res.json(stats);
}));

app.post('/api/recovery/process', asyncH(async (req, res) => {
  const results = await errorRecovery.processRecoveryQueue();
  res.json(results);
}));

// ==== Account Rotation API ====
app.get('/api/rotation/account/:id/status', asyncH(async (req, res) => {
  const stats = await accountRotation.getAccountStats(parseInt(req.params.id));
  res.json(stats);
}));

app.get('/api/rotation/available', asyncH(async (req, res) => {
  const { action, platform, exclude } = req.query;
  const excludeIds = exclude ? exclude.split(',').map(Number) : [];
  const accounts = await accountRotation.getAvailableAccounts(action, platform, excludeIds);
  res.json(accounts);
}));

app.get('/api/rotation/next', asyncH(async (req, res) => {
  const { action, platform, exclude } = req.query;
  const excludeIds = exclude ? exclude.split(',').map(Number) : [];
  const account = await accountRotation.getNextAccount(action, platform, excludeIds);
  res.json(account || { error: 'No available accounts' });
}));

app.get('/api/rotation/status', asyncH(async (req, res) => {
  const { platform } = req.query;
  const statuses = await accountRotation.getAllAccountsStatus(platform);
  res.json(statuses);
}));

app.post('/api/rotation/config/cooldown', asyncH(async (req, res) => {
  const { actionType, milliseconds } = req.body;
  accountRotation.setCooldown(actionType, milliseconds);
  res.json({ ok: true, message: 'Cooldown updated' });
}));

app.post('/api/rotation/config/limit', asyncH(async (req, res) => {
  const { actionType, count, windowMs } = req.body;
  accountRotation.setLimit(actionType, count, windowMs);
  res.json({ ok: true, message: 'Limit updated' });
}));

// ==== Content Spinner API ====
app.post('/api/content/spin', asyncH(async (req, res) => {
  const { text, count, useSpintax, addEmoji, emojiCategory, emojiCount, shuffle, variables } = req.body;
  
  if (!text) return res.status(400).json({ error: 'Text required' });
  
  const variations = ContentSpinner.generateVariations(text, {
    count: count || 1,
    useSpintax: useSpintax !== false,
    addEmoji: addEmoji || false,
    emojiCategory,
    emojiCount: emojiCount || 1,
    shuffle: shuffle || false,
    variables: variables || {}
  });
  
  res.json({ variations });
}));

app.post('/api/content/templates', asyncH(async (req, res) => {
  const { name, content, category, variables } = req.body;
  
  if (!name || !content) {
    return res.status(400).json({ error: 'Name and content required' });
  }
  
  const id = await TemplateManager.addTemplate(name, content, category, variables);
  res.json({ id, message: 'Template created' });
}));

app.get('/api/content/templates', asyncH(async (req, res) => {
  const { category } = req.query;
  
  if (category) {
    const templates = await TemplateManager.getTemplatesByCategory(category);
    res.json(templates);
  } else {
    const templates = await TemplateManager.loadTemplates();
    res.json(templates);
  }
}));

app.get('/api/content/templates/:id', asyncH(async (req, res) => {
  const template = await TemplateManager.getTemplate(parseInt(req.params.id));
  
  if (!template) {
    return res.status(404).json({ error: 'Template not found' });
  }
  
  res.json(template);
}));

app.put('/api/content/templates/:id', asyncH(async (req, res) => {
  const { name, content, category, variables } = req.body;
  
  await TemplateManager.updateTemplate(parseInt(req.params.id), {
    name,
    content,
    category,
    variables
  });
  
  res.json({ ok: true, message: 'Template updated' });
}));

app.delete('/api/content/templates/:id', asyncH(async (req, res) => {
  await TemplateManager.deleteTemplate(parseInt(req.params.id));
  res.json({ ok: true, message: 'Template deleted' });
}));

// ==== Account Warming API ====
app.post('/api/warming/start/:id', asyncH(async (req, res) => {
  const accountId = Number(req.params.id);
  if (!Number.isInteger(accountId) || accountId <= 0) {
    return res.status(400).json({ error: 'Invalid account ID' });
  }
  const result = await accountWarming.startWarming(accountId);
  res.json(result);
}));

app.get('/api/warming/status/:id', asyncH(async (req, res) => {
  const accountId = Number(req.params.id);
  if (!Number.isInteger(accountId) || accountId <= 0) {
    return res.status(400).json({ error: 'Invalid account ID' });
  }
  const status = await accountWarming.getWarmingStatus(accountId);
  res.json(status);
}));

app.get('/api/warming/accounts', asyncH(async (req, res) => {
  const accounts = await accountWarming.getAllWarmingAccounts();
  res.json(accounts);
}));

app.post('/api/warming/stop/:id', asyncH(async (req, res) => {
  const accountId = Number(req.params.id);
  if (!Number.isInteger(accountId) || accountId <= 0) {
    return res.status(400).json({ error: 'Invalid account ID' });
  }
  await accountWarming.stopWarming(accountId);
  res.json({ ok: true, message: 'Warming stopped' });
}));

app.post('/api/warming/approve/:id', asyncH(async (req, res) => {
  const accountId = Number(req.params.id);
  if (!Number.isInteger(accountId) || accountId <= 0) {
    return res.status(400).json({ error: 'Invalid account ID' });
  }
  const r = await accountWarming.approveStage(accountId);
  if (r.error) return res.status(400).json(r);
  res.json(r);
}));

// ==== Orkestra Farm-HP (tahap 1): antrean per device ====
const orchestra = require('./src/farm-orchestra');
// Jalankan sopir job (nav-only otomatis; mode --go TIDAK pernah dipicu server —
// create beneran selalu lewat SSH/konfirmasi manusia sesuai aturan farm).
function spawnJobRunner(job) {
  if (job.platform !== 'ig') return { spawned: false, note: 'belum ada sopir utk ' + job.platform };
  const { spawn } = require('child_process');
  const child = spawn(process.execPath, [path.join(__dirname, 'src', 'farm-driver-ig.js'), job.id],
    { cwd: __dirname, detached: true, stdio: 'ignore', windowsHide: true });
  child.unref();
  return { spawned: true, pid: child.pid };
}
app.post('/api/farm/job', asyncH(async (req, res) => {
  const { deviceId, platform, payload } = req.body || {};
  const r = orchestra.queueJob(deviceId, platform, payload);
  if (r.error) return res.status(400).json(r);
  // Job nav-only langsung dipandu sopirnya supaya satu klik di UI = hasil.
  const spawnInfo = (payload || {}).navOnly ? spawnJobRunner(r) : { spawned: false };
  res.json({ ...r, runner: spawnInfo });
}));

// ==== Create beneran via HP: gerbang SOP, bukan tombol buta ====
// POST /api/farm/create-ig { deviceId }
// Tolak bila: HP di WiFi (harus data SIM) / SIM tidak terdaftar / domain email
// belum punya MX / device cooldown / sedang working. Payload (email/sandi/
// username) disusun server dari bank identitas + rotator domain.
app.post('/api/farm/create-ig', asyncH(async (req, res) => {
  const deviceId = String((req.body || {}).deviceId || '');
  if (!deviceId) return res.status(400).json({ error: 'deviceId wajib' });
  const st = orchestra.deviceState(deviceId);
  if (st.state === 'working') return res.status(409).json({ error: `HP sibuk (job ${st.jobId})` });
  if (st.state === 'locked') return res.status(409).json({ error: st.reason });

  // Detail HP (cache refresh berkala) — kondisi jaringan wajib data SIM.
  const det = hygiene.cachedDeviceDetails(deviceId);
  if (!det) return res.status(409).json({ error: 'detail HP belum terukur — tunggu ±15 dtk lalu ulangi' });
  if (det.conn !== 'data') return res.status(409).json({ error: `HP online via ${det.conn || 'tidak jelas'} — SOP: create hanya via data SIM (matikan WiFi)` });
  if (!det.simOk) return res.status(409).json({ error: 'SIM tidak terdaftar di jaringan — perbaiki dulu (sinyal/data aktif)' });

  // Domain email: MX wajib sudah terpasang (tanpa MX, OTP takkan pernah tiba).
  const { mailDomains } = require('./src/email-alias');
  const domain = mailDomains()[0] || '';
  if (!domain) return res.status(409).json({ error: 'AMMAIL_DOMAIN(S) kosong — isi .env dulu' });
  const mx = await fetch(`https://dns.google/resolve?name=${encodeURIComponent(domain)}&type=MX`)
    .then((r) => r.json()).catch(() => null);
  if (!mx || !Array.isArray(mx.Answer) || !mx.Answer.length) {
    return res.status(409).json({ error: `domain ${domain} belum punya record MX — selesaikan Email Routing dulu` });
  }

  // Susun identitas + email + jadwal lahir.
  const idn = require('./src/id-identity').pickName();
  const { makeEmail } = require('./src/email-alias');
  const em = makeEmail({ first: idn.first, last: idn.last });
  const bday = { month: 1 + Math.floor(Math.random() * 12), day: 1 + Math.floor(Math.random() * 28), year: 1995 + Math.floor(Math.random() * 8) };
  const password = 'Fm' + Math.random().toString(36).slice(2, 10) + '!7';
  const usernameBase = `${idn.first}.${idn.last}`.toLowerCase().replace(/[^a-z.]/g, '') || 'user';
  const username = `${usernameBase}${Math.floor(10 + Math.random() * 89)}`;

  const job = orchestra.queueJob(deviceId, 'ig', {
    email: em.email, password, username, bday, mode: 'create',
  });
  if (job.error) return res.status(409).json(job);
  res.json({ ok: true, jobId: job.id, email: em.email, username, note: 'job dibuat — pakai /api/farm/jobs/:id/step utk pantau; create dijalankan via farm-driver-ig.js --go di CLI (butuh konfirmasi manusia)' });
}));
app.get('/api/farm/jobs', asyncH(async (req, res) => {
  res.json(orchestra.listJobs(String(req.query.device || '')));
}));
app.get('/api/farm/jobs/:id', asyncH(async (req, res) => {
  const j = orchestra.getJob(req.params.id);
  if (!j) return res.status(404).json({ error: 'job tak ketemu.' });
  res.json(j);
}));
app.post('/api/farm/jobs/:id/step', asyncH(async (req, res) => {
  const { step, total, status, note } = req.body || {};
  const r = orchestra.reportStep(req.params.id, step, total, status, note);
  if (r.error) return res.status(400).json(r);
  res.json(r);
}));
app.post('/api/farm/jobs/:id/finish', asyncH(async (req, res) => {
  const { ok, note } = req.body || {};
  const r = orchestra.finishJob(req.params.id, !!ok, note);
  if (r.error) return res.status(400).json(r);
  res.json(r);
}));
app.get('/api/farm/device-state', asyncH(async (req, res) => {
  res.json(orchestra.deviceState(String(req.query.device || '')));
}));
// OTP manual untuk job HP: user baca inbox sendiri, tempel ke sini, sopir ambil.
// (sopir HP polling payload job via file — aman antar proses)
app.post('/api/farm/jobs/:id/otp', asyncH(async (req, res) => {
  const code = String((req.body || {}).code || '').replace(/\D/g, '').slice(0, 8);
  if (!code) return res.status(400).json({ error: 'code wajib (angka OTP).' });
  const r = orchestra.appendOtp(req.params.id, code);
  if (r.error) return res.status(404).json(r);
  res.json({ ok: true });
}));
// Nomor HP dari panel untuk job HP: operator ketik nomor di sini, SISTEM yang
// mengetikkan ke HP (sopir langkah 7 mem-poll payload.phone tiap 15 dtk).
// Format: digit saja, 9-15 digit (awalan 08 atau 628xx sama-sama diterima).
app.post('/api/farm/jobs/:id/phone', strictLimiter, asyncH(async (req, res) => {
  const digits = String((req.body || {}).phone || '').replace(/\D/g, '').slice(0, 15);
  if (digits.length < 9) return res.status(400).json({ error: 'phone wajib 9-15 digit.' });
  const r = orchestra.appendPhone(req.params.id, digits);
  if (r.error) return res.status(404).json(r);
  res.json({ ok: true, mask: `***${digits.slice(-4)}` });
}));
// Stop job HP dari panel: tandai cancelled, sopir berhenti sendiri ≤15 dtk &
// HP dikembalikan ke user asal. Device grace 60 dtk anti-tabrakan job baru.
app.post('/api/farm/jobs/:id/cancel', strictLimiter, asyncH(async (req, res) => {
  const r = orchestra.cancelJob(req.params.id, String((req.body || {}).note || 'dibatalkan operator'));
  if (r.error) return res.status(404).json(r);
  res.json({ ok: true });
}));

// Auto-OTP: ambil kode dari inbox mail worker (email job) — tanpa tempel manual.
// Dasar: email = payload.email (mis. nama@windevpanel.my.id); alias = bagian sebelum @.
app.post('/api/farm/jobs/:id/auto-otp', asyncH(async (req, res) => {
  const job = orchestra.getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'job tak ketemu.' });
  const email = String((job.payload || {}).email || '');
  if (!email.includes('@')) return res.status(400).json({ error: 'job tanpa payload.email — pakai OTP manual.' });
  const alias = email.split('@')[0].toLowerCase();
  const client = new (require('./lib/mail-worker').MailWorkerClient)();
  if (!client.configured) return res.status(503).json({ error: 'mail worker tak terkonfigurasi (AMMAIL_BASE_URL/API_KEY).' });
  const msgs = await client.listMessages(alias).catch((e) => { throw new Error('inbox: ' + e.message); });
  let found = null;
  for (const m of (msgs || []).slice(0, 5)) {
    if (!m || !m.id) continue;
    const full = await client.getMessage(m.id).catch(() => null);
    if (!full) continue;
    const f = require('./lib/mail-worker/otp').extractOtp(full.text || full.body || '', full.html || '', full.subject || '');
    if (f.code) { found = f.code; break; }
  }
  if (!found) return res.json({ ok: false, note: 'belum ada OTP di inbox' });
  orchestra.appendOtp(job.id, found);
  res.json({ ok: true, code: found });
}));

// ==== Higiene HP antar-create (tanpa root): cek / ig / ads / ip / semua ====
const hygiene = require('./src/phone-hygiene');
const hygieneRuns = new Map(); // deviceId -> {running, log[], startedAt, result, error}
app.post('/api/farm/hygiene/:id', asyncH(async (req, res) => {
  const id = String(req.params.id);
  const mode = ['cek', 'ig', 'fb', 'ads', 'ip', 'semua'].includes(String((req.body || {}).mode)) ? String(req.body.mode) : 'semua';
  const st = hygieneRuns.get(id);
  if (st && st.running) return res.status(409).json({ error: 'higiene sedang jalan untuk HP ini.' });
  const entry = { running: true, mode, log: [], startedAt: new Date().toISOString(), result: null, error: null };
  hygieneRuns.set(id, entry);
  res.json({ ok: true, mode });
  hygiene.runHygiene(id, mode, (m) => { entry.log.push(m); if (entry.log.length > 80) entry.log.shift(); })
    .then((result) => { entry.result = result; entry.running = false; })
    .catch((e) => { entry.error = String(e.message).slice(0, 200); entry.running = false; });
}));
app.get('/api/farm/hygiene/:id', asyncH(async (req, res) => {
  res.json(hygieneRuns.get(String(req.params.id)) || { running: false, log: [] });
}));

// ==== STEP 4: status worker/watchdog PG (baca saja, untuk dashboard nanti) ====
app.get('/api/workers/status', asyncH(async (req, res) => {
  try {
    const pgw = require('./src/pg-worker');
    res.json(await pgw.status());
  } catch (e) { res.status(503).json({ error: 'PG worker registry tak tersedia: ' + e.message }); }
}));
app.get('/api/workers/events', asyncH(async (req, res) => {
  try {
    const pg = require('./src/pg');
    const lim = Math.min(Number(req.query.limit || 50), 200);
    const r = await pg.query('SELECT * FROM worker_events ORDER BY id DESC LIMIT $1', [lim]);
    res.json(r.rows);
  } catch (e) { res.status(503).json({ error: 'PG tak tersedia: ' + e.message }); }
}));

// ==== Warming Executor Scheduler API ====
const warmingScheduler = require('./src/warming-scheduler');
app.get('/api/warming/scheduler', asyncH(async (req, res) => {
  res.json(warmingScheduler.getConfig());
}));
app.post('/api/warming/scheduler', asyncH(async (req, res) => {
  const r = warmingScheduler.saveConfig(req.body || {});
  if (r.error) return res.status(400).json(r);
  res.json(r);
}));
app.post('/api/warming/run-now', asyncH(async (req, res) => {
  const dry = String((req.body || {}).dryRun || '') === '1';
  // Jalan di background agar request tak menggantung (eksekusi menit-menit)
  setImmediate(async () => {
    try {
      const ex = require('./src/warming-executor');
      const report = await ex.runOnce({ dryRun: dry });
      warmingScheduler.saveReport(report);
    } catch (e) { console.error('[warming] run-now gagal:', e.message); }
  });
  res.json({ ok: true, message: dry ? 'Dry-run dimulai di background.' : 'Eksekusi dimulai di background.' });
}));
app.get('/api/warming/last-run', asyncH(async (req, res) => {
  res.json(warmingScheduler.getLastReport());
}));

// ==== Backup System API ====
app.post('/api/backup/create', asyncH(async (req, res) => {
  const { type } = req.body;
  const result = await backupSystem.createBackup(type || 'manual');
  res.json(result);
}));

app.get('/api/backup/list', asyncH(async (req, res) => {
  const backups = await backupSystem.listBackups();
  res.json(backups);
}));

app.post('/api/backup/restore', asyncH(async (req, res) => {
  const { backupName } = req.body;
  if (!backupName) {
    return res.status(400).json({ error: 'Backup name is required' });
  }
  const result = await backupSystem.restoreBackup(backupName);
  res.json(result);
}));

app.delete('/api/backup/:name', asyncH(async (req, res) => {
  await backupSystem.deleteBackup(req.params.name);
  res.json({ ok: true, message: 'Backup deleted' });
}));

app.get('/api/backup/auto-status', asyncH(async (req, res) => {
  const status = await backupSystem.getAutoBackupStatus();
  res.json(status);
}));

// ==== Notification System API ====
app.post('/api/notification/send', asyncH(async (req, res) => {
  const { message, title, priority, channels } = req.body;
  if (!message) {
    return res.status(400).json({ error: 'Message is required' });
  }
  const results = await notificationSystem.send(message, { title, priority, channels });
  res.json(results);
}));

app.post('/api/notification/test/:channel', asyncH(async (req, res) => {
  const { channel } = req.params;
  const result = await notificationSystem.testChannel(channel);
  res.json(result);
}));

app.get('/api/notification/config', asyncH(async (req, res) => {
  // getConfig() belum ada di notification-system — kembalikan yang tersedia
  const channels = notificationSystem.channels || {};
  res.json({ channels: Object.keys(channels), note: 'Detail per kanal via /api/notification/channels' });
}));

app.get('/api/notification/channels', asyncH(async (req, res) => {
  const channels = notificationSystem.channels;
  res.json(channels);
}));

// ==== Captcha Solver API ====
app.post('/api/captcha/solve', asyncH(async (req, res) => {
  const { type, sitekey, pageurl, action } = req.body;
  
  if (!type || !sitekey || !pageurl) {
    return res.status(400).json({ error: 'type, sitekey, and pageurl are required' });
  }
  
  let solution;
  switch(type) {
    case 'recaptcha-v2':
      solution = await captchaSolver.solveRecaptchaV2(sitekey, pageurl);
      break;
    case 'recaptcha-v3':
      solution = await captchaSolver.solveRecaptchaV3(sitekey, pageurl, action);
      break;
    case 'hcaptcha':
      solution = await captchaSolver.solveHCaptcha(sitekey, pageurl);
      break;
    default:
      return res.status(400).json({ error: 'Invalid captcha type. Use: recaptcha-v2, recaptcha-v3, or hcaptcha' });
  }
  
  res.json({ solution });
}));

app.get('/api/captcha/balance', asyncH(async (req, res) => {
  try {
    const balance = await captchaSolver.getBalance();
    res.json({ balance });
  } catch (e) {
    res.json({ balance: null, note: 'API key 2captcha belum diset / tidak terjangkau: ' + e.message });
  }
}));

app.get('/api/captcha/stats', asyncH(async (req, res) => {
  try {
    const stats = typeof captchaSolver.getStats === 'function'
      ? await captchaSolver.getStats()
      : { solved: 0, failed: 0 };
    res.json(stats);
  } catch (e) {
    res.json({ solved: 0, failed: 0, note: e.message });
  }
}));

// ==== AI Content Generator API ====
// Error provider (key, kuota, model) diteruskan apa adanya supaya halaman AI
// bisa menampilkan penyebabnya, bukan "Internal server error".
const aiRoute = (fn) => asyncH(async (req, res) => {
  try {
    await fn(req, res);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

app.post('/api/ai/caption', aiRoute(async (req, res) => {
  const { topic, style, length, platform, emojis } = req.body;
  
  if (!topic) {
    return res.status(400).json({ error: 'Topic is required' });
  }
  
  const caption = await aiContentGenerator.generateCaption({
    topic,
    style,
    length,
    platform,
    emojis
  });
  
  res.json({ caption });
}));

app.post('/api/ai/hashtags', aiRoute(async (req, res) => {
  const { topic, count } = req.body;
  
  if (!topic) {
    return res.status(400).json({ error: 'Topic is required' });
  }
  
  const hashtags = await aiContentGenerator.generateHashtags(topic, count);
  res.json({ hashtags });
}));

app.post('/api/ai/rewrite', aiRoute(async (req, res) => {
  const { content, tone } = req.body;
  
  if (!content) {
    return res.status(400).json({ error: 'Content is required' });
  }
  
  const rewritten = await aiContentGenerator.rewriteContent(content, tone);
  res.json({ content: rewritten });
}));

app.post('/api/ai/comment', aiRoute(async (req, res) => {
  const { postContent, commentContext } = req.body;
  
  if (!postContent) {
    return res.status(400).json({ error: 'Post content is required' });
  }
  
  const comment = await aiContentGenerator.generateComment(postContent, commentContext);
  res.json({ comment });
}));

// ==== Following Automation API ====
app.post('/api/following/start', asyncH(async (req, res) => {
  const { accountId, targetAccounts, limit } = req.body;
  
  if (!accountId || !targetAccounts) {
    return res.status(400).json({ error: 'accountId and targetAccounts are required' });
  }
  
  const account = await db.getAccountById(accountId);
  if (!account) {
    return res.status(404).json({ error: 'Account not found' });
  }
  
  const results = await followingAutomation.followTargetAudience(account, targetAccounts, limit);
  res.json({ results });
}));

app.post('/api/following/unfollow', asyncH(async (req, res) => {
  const { accountId } = req.body;
  
  if (!accountId) {
    return res.status(400).json({ error: 'accountId is required' });
  }
  
  const results = await followingAutomation.autoUnfollow(accountId);
  res.json({ results });
}));

app.get('/api/following/stats/:accountId', asyncH(async (req, res) => {
  const stats = await followingAutomation.getStats(parseInt(req.params.accountId));
  res.json(stats);
}));

// ==== Comment Automation API ====
// Upload media untuk story (dipakai halaman Engagement): simpan ke uploads/, balas path absolut.
app.post('/api/media/upload', upload.single('media'), asyncH(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'media wajib' });
  res.json({ path: path.join(UPLOAD_DIR, req.file.filename), original: req.file.originalname });
}));

// Komentar manual atau otomatis via AI (AI_CONTENT). Gate tunggal dicek dulu.
app.post('/api/comment/run', asyncH(async (req, res) => {
  const { accountId, postUrl, comment, platform } = req.body;
  if (!accountId || !postUrl) return res.status(400).json({ error: 'accountId, postUrl wajib' });
  const account = await db.getAccountById(accountId);
  if (!account) return res.status(404).json({ error: 'Akun tidak ditemukan' });

  const g = await accountGate.check(accountId, 'comment');
  if (!g.ok) return res.status(429).json({ error: 'Akun ditolak gate', reasons: g.reasons });

  // Teks komentar: eksplisit -> AI -> template
  let text = (comment || '').trim();
  if (!text) {
    try { text = await aiContentGenerator.generateComment(postUrl, ''); } catch (e) { /* lanjut fallback */ }
  }
  if (!text) {
    const tpl = commentAutomation.commentTemplates.general;
    text = tpl[Math.floor(Math.random() * tpl.length)];
  }

  const result = platform === 'ig'
    ? await commentAutomation.commentOnInstagramPost(account, postUrl, text)
    : await commentAutomation.commentOnFacebookPost(account, postUrl, text);
  if (result.ok) accountGate.record(accountId, 'comment');
  res.json({ ...result, comment: text });
}));

app.post('/api/comment/batch', asyncH(async (req, res) => {
  const { accountId, accountIds, posts, comment, rotation } = req.body;
  if (!Array.isArray(posts) || !posts.length) {
    return res.status(400).json({ error: 'posts (array) wajib' });
  }
  if (!accountId && !Array.isArray(accountIds)) {
    return res.status(400).json({ error: 'accountId atau accountIds (array) wajib' });
  }
  // rotation: 'roundrobin' (default) = giliran bergantian tiap postingan;
  //           'block' = akun ke-1 mengerjakan semua postingannya dulu, lalu akun ke-2, dst.
  const rotMode = rotation === 'block' ? 'block' : 'roundrobin';

  // MODE MULTI-AKUN: accountIds (array) -> komentar dibagi bergiliran (round-robin)
  // antar akun yang LOLOS gate. Akun yang ditolak dilewati dengan alasannya —
  // batch tetap jalan dengan akun sehat sisanya.
  let pool = [];
  const rejected = [];
  if (Array.isArray(accountIds) && accountIds.length) {
    for (const id of accountIds.slice(0, 10)) {
      const acc = await db.getAccountById(Number(id));
      if (!acc) { rejected.push({ accountId: id, reasons: ['account_not_found'] }); continue; }
      const g = await accountGate.check(acc.id, 'comment');
      if (!g.ok) { rejected.push({ accountId: acc.id, name: acc.name, reasons: g.reasons }); continue; }
      pool.push(acc);
    }
    if (!pool.length) {
      return res.status(429).json({ error: 'Semua akun ditolak gate', rejected });
    }
  } else {
    const acc = await db.getAccountById(accountId);
    if (!acc) return res.status(404).json({ error: 'Akun tidak ditemukan' });
    const g = await accountGate.check(acc.id, 'comment');
    if (!g.ok) return res.status(429).json({ error: 'Akun ditolak gate', reasons: g.reasons });
    pool = [acc];
  }

  // Variasi AI per postingan: konteks dibedakan agar AI menghasilkan teks berbeda.
  // Gagal AI per-postingan = fallback template agar batch tidak mati seluruhnya.
  // Jeda: 60-120 dtk antar komentar akun yang SAMA, 10-20 dtk saat berganti akun
  // (aktivitas tersebar terlihat lebih alami daripada 1 akun menembak beruntun).
  const results = [];
  const batchId = `batch-${Date.now().toString(36)}`;
  for (let i = 0; i < posts.length; i++) {
    const p = posts[i];
    const url = typeof p === 'string' ? p : p.url;
    if (!url) { results.push({ url, ok: false, reason: 'url_kosong' }); continue; }
    // Pilih akun sesuai pola rotasi:
    //   roundrobin: indeks i mod jumlah akun (A,B,A,B...)
    //   block: postingan dibagi rata berurutan (A,A,B,B...)
    const account = rotMode === 'block'
      ? pool[Math.min(pool.length - 1, Math.floor((i * pool.length) / posts.length))]
      : pool[i % pool.length];
    const sameAsPrev = i > 0 && (results[results.length - 1]?.accountId === account.id);
    let text = (typeof p === 'object' && p.comment) || comment || '';
    if (!text) {
      const ctx = `variasi ke-${i + 1} dari ${posts.length}, bahasa santai Indonesia, maks 1 kalimat, jangan ulangi komentar sebelumnya`;
      try { text = await aiContentGenerator.generateComment(url, ctx); } catch (e) { text = ''; }
      if (!text) text = commentAutomation.getRandomComment();
    }
    let r;
    try {
      r = account.platform === 'ig' || account.platform === 'instagram'
        ? await commentAutomation.commentOnInstagramPost(account, url, text)
        : await commentAutomation.commentOnFacebookPost(account, url, text);
    } catch (e) { r = { ok: false, reason: 'error: ' + e.message }; }
    if (r.ok) accountGate.record(account.id, 'comment');
    // Catat ke riwayat engagement (satu baris per aksi per akun).
    await db.logEngagement({
      accountId: account.id,
      action: 'comment',
      targetUrl: url,
      commentText: text,
      status: r.ok ? 'success' : 'failed',
      message: r.reason || null,
      batchId,
    }).catch(() => {});
    results.push({ url, ok: !!r.ok, reason: r.reason || null, comment: text, account: account.name, accountId: account.id });
    if (i < posts.length - 1) {
      const ms = sameAsPrev
        ? Math.floor(Math.random() * 60000) + 60000   // 60-120 dtk akun sama
        : Math.floor(Math.random() * 10000) + 10000;  // 10-20 dtk ganti akun
      await new Promise((res2) => setTimeout(res2, ms));
    }
  }
  res.json({
    results,
    total: results.length,
    succeeded: results.filter((r) => r.ok).length,
    accountsUsed: pool.map((a) => ({ id: a.id, name: a.name })),
    rejected,
    rotation: rotMode,
    batchId,
  });
}));

// Papan tangga warming: per akun IG, tahap + aksi terbuka hari ini + sisa kuota.
// Dipakai strip Engagement/Varming agar aturan "kapan kran aksi dibuka" terlihat,
// bukan tebakan (persepsi alasan gate dibaca dari endpoint gate biasa).
app.get('/api/gate/:accountId/quota', asyncH(async (req, res) => {
  if (!(await db.getAccountById(Number(req.params.accountId)))) {
    return res.status(404).json({ error: 'Akun tidak ditemukan' });
  }
  res.json(await accountGate.getActionQuota(Number(req.params.accountId)));
}));

// Riwayat engagement (dipakai halaman History): filter akun + jenis aksi.
app.get('/api/engagement/log', asyncH(async (req, res) => {
  const rows = await db.listEngagementLog({
    limit: Math.min(Number(req.query.limit) || 100, 300),
    accountId: req.query.accountId ? Number(req.query.accountId) : null,
    action: req.query.action || null,
  });
  res.json(rows);
}));

// Statistik engagement harian (dipakai grafik Monitoring): N hari terakhir,
// jumlah aksi per jenis per hari. Beri placeholder hari kosong agar grafik jujur.
app.get('/api/engagement/stats', asyncH(async (req, res) => {
  const days = Math.min(Number(req.query.days) || 14, 90);
  const rows = await db.rawAll(`
    SELECT date(created_at) AS d, action,
      SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) AS ok,
      SUM(CASE WHEN status != 'success' THEN 1 ELSE 0 END) AS fail
    FROM engagement_log
    WHERE created_at >= datetime('now', ?)
    GROUP BY date(created_at), action
    ORDER BY d
  `, [`-${days} days`]);
  // Susun deret harian lengkap (termasuk hari tanpa aksi)
  const byDay = {};
  for (const r of rows) {
    byDay[r.d] = byDay[r.d] || {};
    byDay[r.d][r.action] = { ok: Number(r.ok) || 0, fail: Number(r.fail) || 0 };
  }
  const series = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
    const e = byDay[d] || {};
    series.push({
      date: d,
      comment: e.comment || { ok: 0, fail: 0 },
      dm: e.dm || { ok: 0, fail: 0 },
      story: e.story || { ok: 0, fail: 0 },
    });
  }
  const total = rows.reduce((s, r) => s + (Number(r.ok) || 0) + (Number(r.fail) || 0), 0);
  res.json({ days, series, total });
}));

// ==== DM Automation API ====
app.post('/api/dm/send', asyncH(async (req, res) => {
  const { accountId, username, message, platform } = req.body;
  if (!accountId || !username || !message) {
    return res.status(400).json({ error: 'accountId, username, message wajib' });
  }
  const account = await db.getAccountById(accountId);
  if (!account) return res.status(404).json({ error: 'Akun tidak ditemukan' });
  const g = await accountGate.check(accountId, 'dm');
  if (!g.ok) return res.status(429).json({ error: 'Akun ditolak gate', reasons: g.reasons });

  const result = platform === 'fb'
    ? await dmAutomation.sendFacebookDM(account, username, message)
    : await dmAutomation.sendInstagramDM(account, username, message);
  if (result.ok) accountGate.record(accountId, 'dm');
  res.json(result);
}));

app.post('/api/dm/bulk', asyncH(async (req, res) => {
  const { accountId, recipients, message, options } = req.body;
  if (!accountId || !Array.isArray(recipients) || !message) {
    return res.status(400).json({ error: 'accountId, recipients (array), message wajib' });
  }
  const account = await db.getAccountById(accountId);
  if (!account) return res.status(404).json({ error: 'Akun tidak ditemukan' });
  const g = await accountGate.check(accountId, 'dm');
  if (!g.ok) return res.status(429).json({ error: 'Akun ditolak gate', reasons: g.reasons });
  const results = await dmAutomation.bulkDMCampaign(account, recipients, message, options || {});
  if (results.some((r) => r.ok)) accountGate.record(accountId, 'dm');
  res.json({ results });
}));

// SOP onboarding: ringkasan akun IG muda + status dandan/post/interaksi harian.
const onboardingSop = require('./src/onboarding-sop');
// File config SOP kecil (nyala/mati + window jam) — pisah dari warming-scheduler.
const fsSop = require('fs');
const SOP_CFG = path.join(__dirname, 'config', 'sop-config.json');
function sopConfig() {
  try { return { ...{ enabled: false, window: '07–10' }, ...JSON.parse(fsSop.readFileSync(SOP_CFG, 'utf8')) }; }
  catch (e) { return { enabled: false, window: '07–10' }; }
}
let sopLastAt = '';
try { sopLastAt = (JSON.parse(fsSop.readFileSync(path.join(__dirname, 'logs', 'sop-last.json'), 'utf8')).at || '').slice(0, 10); } catch (e) { /* belum ada */ }
app.get('/api/sop/overview', asyncH(async (req, res) => {
  res.json(await onboardingSop.panelOverview());
}));
app.get('/api/sop/config', asyncH(async (req, res) => {
  res.json({ ...sopConfig(), lastRunAt: sopLastAt });
}));
app.post('/api/sop/config', asyncH(async (req, res) => {
  const cfg = { ...sopConfig(), enabled: !!(req.body && req.body.enabled) };
  fsSop.mkdirSync(path.dirname(SOP_CFG), { recursive: true });
  fsSop.writeFileSync(SOP_CFG, JSON.stringify(cfg, null, 2));
  // Worker membaca config tiap siklus cron (20 mnt) — ambil live dari file.
  res.json({ ...cfg, lastRunAt: sopLastAt });
}));

// Jalankan manual SOP 1 akun dari panel (tombol "Jalankan ritual").
app.post('/api/sop/run/:accountId', asyncH(async (req, res) => {
  res.json(await onboardingSop.runAccount(Number(req.params.accountId), (k, m) => console.log(`[sop] ${m}`)));
}));

// ==== Story Automation API ====
app.post('/api/story/post', asyncH(async (req, res) => {
  const { accountId, mediaPath, caption, link, mentions, platform } = req.body;
  if (!accountId || !mediaPath) return res.status(400).json({ error: 'accountId, mediaPath wajib' });
  const account = await db.getAccountById(accountId);
  if (!account) return res.status(404).json({ error: 'Akun tidak ditemukan' });
  const g = await accountGate.check(accountId, 'post');
  if (!g.ok) return res.status(429).json({ error: 'Akun ditolak gate', reasons: g.reasons });

  const options = { caption: caption || '', link: link || '', mentions: mentions || [] };
  const result = platform === 'fb'
    ? await storyAutomation.postFacebookStory(account, mediaPath, options)
    : await storyAutomation.postInstagramStory(account, mediaPath, options);
  if (result.ok) accountGate.record(accountId, 'post');
  res.json(result);
}));

// Status gate untuk 1 akun (debug: kenapa akun tidak dipakai rotasi)
app.get('/api/gate/:accountId', asyncH(async (req, res) => {
  const action = req.query.action || 'like';
  res.json(await accountGate.check(Number(req.params.accountId), action));
}));

// Gate massal untuk tabel Akun: 1 request, semua akun + aksi like.
// Timeout 2 dtk per akun agar halaman tidak menggantung bila warming lambat.
app.get('/api/gates', asyncH(async (req, res) => {
  const action = (req.query.action || 'like');
  const rows = await db.rawAll('SELECT id FROM accounts ORDER BY id');
  const out = {};
  await Promise.all(rows.map(async (r) => {
    const g = await Promise.race([
      accountGate.check(r.id, action).catch(() => null),
      new Promise((res2) => setTimeout(() => res2(null), 2000)),
    ]);
    out[r.id] = g ? { ok: g.ok, reasons: g.reasons } : { ok: null, reasons: ['timeout'] };
  }));
  res.json({ action, gates: out });
}));

app.get('*path', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  console.error(`[api] ${req.method} ${req.path}:`, err.message);
  const status = err.statusCode || (err.message === 'Account not found' ? 404 : 500);
  res.status(status).json({ error: status >= 500 ? 'Internal server error' : err.message });
});

const PORT = Number(process.env.PORT) > 0 ? Number(process.env.PORT) : 3000; // PORT=0 dari env luar tak valid → fallback 3000
db.load().then(() => {
  farmWatchdog.start();
  // Cek biner adb saat start: kalau yang terpasang rusak (mis. adb bawaan scrcpy
  // yang crash), Phone Farm tampak "tanpa HP" tanpa penjelasan. Tulis di log.
  farm.diagnose().then((rows) => {
    for (const r of rows) console.log(`[adb] ${r.ok ? 'siap ' : r.broken ? 'RUSAK' : 'GAGAL'} ${r.bin} — ${r.ok ? `${r.devices} HP terdeteksi` : r.reason}`);
    const sehat = rows.filter((r) => r.ok);
    if (!sehat.length) {
      console.warn('[adb] PERINGATAN: tidak ada adb yang bisa dipakai, Phone Farm tidak akan melihat HP.');
      console.warn('[adb] Perbaiki: isi ADB_PATH di .env dengan path adb yang berfungsi (mis. C:/platform-tools/platform-tools/adb.exe).');
      return;
    }
    // Sama dengan urutan pilihan adbPath(): yang melihat HP menang, kalau tidak ada
    // yang melihat HP pakai kandidat sehat pertama.
    const pilih = sehat.find((r) => r.devices > 0) || sehat[0];
    console.log(`[adb] dipakai: ${pilih.bin}`);
    if (!pilih.devices) console.warn('[adb] belum ada HP terlihat di USB; panel akan menampilkan 0 HP sampai HP dicolok dan USB debugging aktif.');
  }).catch(() => { /* diagnosa bersifat informasi, jangan gagalkan start */ });
  server.listen(PORT, () => {
    console.log(`Dashboard: http://localhost:${PORT}`);
    console.log(`WebSocket: ws://localhost:${PORT}`);
    broadcastNotification('info', 'SMM Panel started successfully');
  });
});
