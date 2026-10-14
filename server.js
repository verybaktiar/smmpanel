'use strict';

require('dotenv').config();

const express = require('express');
const http = require('http');
const path = require('path');
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
  res.json({ accounts, schedulesToday, postedToday, pending, logErrors });
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
  res.json(await db.listAccounts());
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
  const devices = await farm.listDevices().catch(() => []);
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
  res.json({ devices: rows, jobs: jobs.slice(0, 25) });
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
    SELECT s.id, s.scheduled_at, s.status, s.posted_at, s.repeat, a.name AS account, c.text AS content
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

// Tarik satu Gmail untuk create: tandai terpakai lalu kirim kredensialnya.
app.post('/api/gmail/claim', asyncH(async (req, res) => {
  const b = req.body || {};
  const platform = ['ig', 'fb', 'tiktok'].includes(b.platform) ? b.platform : 'ig';
  const got = await db.claimGmail(platform);
  if (!got) return res.status(409).json({ error: 'stok_gmail_habis' });
  broadcastNotification('success', `Gmail #${got.id} ditarik untuk AutoCreate ${platform.toUpperCase()}`);
  res.json(got);
}));

// Impor massal dari teks: JSON hasil Gmail Creator Pro atau baris email|sandi.
app.post('/api/gmail/import', strictLimiter, asyncH(async (req, res) => {
  const text = String((req.body || {}).text || '');
  if (!text.trim()) return res.status(400).json({ error: 'teks kosong' });
  const r = await db.importGmailText(text);
  broadcastNotification('success', `${r.added} Gmail diimpor ke stok (${r.skipped} dilewati)`);
  res.json(r);
}));

app.delete('/api/gmail/:id', asyncH(async (req, res) => {
  const ok = await db.deleteGmail(Number(req.params.id));
  if (!ok) return res.status(404).json({ error: 'tidak ditemukan' });
  res.json({ ok: true });
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
  const { proxy } = (req.body || {});
  const r = await createRunner.startCreate(p, proxy ? String(proxy) : '');
  if (r.error) return res.status(409).json(r);
  res.json(r);
}));
app.get('/api/create/:platform/status', asyncH(async (req, res) => {
  const p = CP(req.params.platform);
  res.json(createRunner.createStatus(p));
}));
app.post('/api/create/:platform/stop', asyncH(async (req, res) => {
  const p = CP(req.params.platform);
  res.json(createRunner.stopCreate(p));
}));

// Hasil akun terakhir (username/email/password/proxy/IP lahir) dari file result creator.
app.get('/api/create/:platform/result', asyncH(async (req, res) => {
  const p = CP(req.params.platform);
  res.json({ result: createRunner.getCreateResult(p) });
}));

// Daftarkan akun hasil create ke panel TANPA CLI (pakai jalur sama dengan form Akun).
app.post('/api/create/:platform/register', asyncH(async (req, res) => {
  const p = CP(req.params.platform);
  const r = createRunner.getCreateResult(p);
  if (!r) return res.status(404).json({ error: 'Belum ada hasil create untuk didaftarkan' });
  const existing = await db.getAccountByName(r.username).catch(() => null);
  if (existing) {
    createRunner.markRegistered(p, existing.id);
    return res.json({ ok: true, id: existing.id, already: true, name: existing.name });
  }
  const id = await db.addAccount({
    name: r.username, email: r.email, password: r.password,
    proxy: r.proxy || undefined, platform: p,
  });
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
  const { values } = req.body; // bisa string (satu) atau array
  if (!values) return res.status(400).json({ error: 'values wajib' });
  const arr = Array.isArray(values) ? values : [values];
  for (const v of arr) { if (typeof v === 'string' && v.trim()) await db.addProxy(v.trim()); }
  res.json({ ok: true, added: arr.length });
}));

app.delete('/api/proxies/:id', asyncH(async (req, res) => {
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
  await db.rawAll(`UPDATE ig_like_jobs SET status = 'running' WHERE id = ?`, [job.id]);
  const result = await likeIgPosting(account, job.post_url);
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
  const result = await postToInstagram(account, mediaPath, caption || '');
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

// ---- AI ----
// Generate konten pakai AI.
app.post('/api/ai/generate', asyncH(async (req, res) => {
  const { generateContent } = require('./src/ai');
  const { prompt } = req.body;
  if (!prompt) return res.status(400).json({ error: 'prompt wajib' });
  const content = await generateContent(prompt);
  res.json({ content });
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
  res.json(createRunner.activationStatus(Number(req.params.id)));
}));
app.post('/api/accounts/:id/activate-login/stop', asyncH(async (req, res) => {
  res.json(createRunner.stopActivation(Number(req.params.id)));
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
  const { context, browser } = await openAccountBrowser(account, { headless: false });
  // Arah ke platform akun masing-masing (bukan selalu FB).
  const isIg = account.platform === 'ig' || account.platform === 'instagram';
  const homeUrl = isIg ? 'https://www.instagram.com/' : 'https://www.facebook.com/';
  // Suntik cookie login tersimpan (kanonis: sessions/<nama>/cookies.json, legacy: sessions/ig-<nama>-*.json)
  try {
    const fs = require('fs');
    const sessDir = path.join(__dirname, 'sessions');
    let sess = null;
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
  res.json({ ok: true });
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
  const result = await postToTimeline(account, content, mediaPath);
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
  const mode = ['cek', 'ig', 'ads', 'ip', 'semua'].includes(String((req.body || {}).mode)) ? String(req.body.mode) : 'semua';
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
app.post('/api/ai/caption', asyncH(async (req, res) => {
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

app.post('/api/ai/hashtags', asyncH(async (req, res) => {
  const { topic, count } = req.body;
  
  if (!topic) {
    return res.status(400).json({ error: 'Topic is required' });
  }
  
  const hashtags = await aiContentGenerator.generateHashtags(topic, count);
  res.json({ hashtags });
}));

app.post('/api/ai/rewrite', asyncH(async (req, res) => {
  const { content, tone } = req.body;
  
  if (!content) {
    return res.status(400).json({ error: 'Content is required' });
  }
  
  const rewritten = await aiContentGenerator.rewriteContent(content, tone);
  res.json({ content: rewritten });
}));

app.post('/api/ai/comment', asyncH(async (req, res) => {
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
  server.listen(PORT, () => {
    console.log(`Dashboard: http://localhost:${PORT}`);
    console.log(`WebSocket: ws://localhost:${PORT}`);
    broadcastNotification('info', 'SMM Panel started successfully');
  });
});
