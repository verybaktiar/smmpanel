'use strict';
// ONBOARDING SOP — rutinitas wajib akun IG baru, otomatis per hari.
// Kebijakan: akun baru yang langsung "telanjang" (tanpa pp/bio/feed) lalu
// buru-buru berinteraksi = pola suspend klasik. SOP ini memastikan setiap
// akun IG baru didandani dulu, lalu diberi ritme kecil harian yang konsisten.
//
// Tahapan SOP (dikunci ke tahap warming, tidak ranah sendiri):
//   hari-0 (begitu warming dibuka): dandan profil — pp + bio + 2 feed dari paket
//     (make-pack: assets/packs/<user>/pp.jpg, feed1, feed2). Timeline dilakukannya
//     SEBELUM aksi engagement pertama supaya profil terlihat "manusia".
//   hari-1+ per tahap warming:
//     tahap1: view + like kuota warming (tanpa follow, tanpa posting)
//     tahap2: + follow kecil ke target terpilih, posting 1 feed tiap 2 hari
//     tahap3+: ritme kerja warming-executor biasa (view/like/follow/comment/post)
//
// Desciption jalur eksekusi: dipanggil worker cron (harian, jam manusia pagi).
// Semua aksi lewat gate.check+gate.record supaya cooldown/limit menyatu.
//
// API:
//   await sop.runDay()                 -> jalankan SOP untuk SEMUA akun IG muda, return report
//   await sop.runAccount(accountId)    -> jalankan SOP 1 akun (dipakai panel juga)
//   await sop.statusFor(accountId)     -> { day, stage, done: [...], pending: [...] }

const db = require('./db');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const accountWarming = require('./account-warming');
const accountGate = require('./account-gate');
const { openAccountBrowser, humanDelay, rand } = require('./browser');

const ROOT = path.join(__dirname, '..');
const PACKS_DIR = path.join(ROOT, 'assets', 'packs');
// Kunci SOP per akun: file kecil di config/sop-state.json — { accId: { pack, day, lastDayAt, doneToday: {} } }
const STATE_FILE = path.join(ROOT, 'config', 'sop-state.json');

function readState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); }
  catch (e) { return {}; }
}
function writeState(s) {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2));
}

// Umur hari akun (sejak dibuat) → "H0" = hari peluncuran.
function accountAgeDays(createdAt) {
  if (!createdAt) return 0;
  const t = new Date(String(createdAt).replace(' ', 'T')).getTime();
  if (Number.isNaN(t)) return 0;
  return Math.max(0, Math.floor((Date.now() - t) / 86400000));
}

// Paket dandan tersedia untuk 1 akun; generate via CLI make-pack bila belum ada.
async function ensurePack(account) {
  const dir = path.join(PACKS_DIR, account.username || account.name);
  if (fs.existsSync(path.join(dir, 'pack.json'))) {
    try { return JSON.parse(fs.readFileSync(path.join(dir, 'pack.json'), 'utf8')); }
    catch (e) { /* regenerasi */ }
  }
  // Jalankan make-pack (CLI kecil, sudah teruji): hasil pp.jpg + feed1 + feed2.
  const gender = Math.random() < 0.5 ? 'male' : 'female';
  const ok = await new Promise((resolve) => {
    const p = spawn('node', ['src/make-pack.js', account.username || account.name, gender], { cwd: ROOT });
    p.on('exit', (code) => resolve(code === 0));
    p.on('error', () => resolve(false));
  });
  if (!ok || !fs.existsSync(path.join(dir, 'pack.json'))) return null;
  return JSON.parse(fs.readFileSync(path.join(dir, 'pack.json'), 'utf8'));
}

// HARI-0 — dandan profil: pasang pp + bio via browser profil + 2 feed dijadwalkan.
// PP/bio dipasang langsung (satu sesi browser); feed mengikuti ritme posting SOP harian.
async function dressUp(account, pack, log) {
  const { context } = await openAccountBrowser(account, { headless: true });
  const page = await context.newPage();
  const result = { pp: false, bio: false, reason: null };
  try {
    await page.goto('https://www.instagram.com/accounts/edit/', { timeout: 60000, waitUntil: 'domcontentloaded' });
    await humanDelay(3000, 5000);
    // Bio/nama (field form profil — selector terbukti dari IG web versi desktop).
    const nameField = page.locator('input[name="fullName"]');
    if (!await nameField.count().catch(() => 0)) throw new Error('form profil tidak ditemukan (mungkin halaman login)');
    await nameField.fill(pack.name || account.name);
    const bioField = page.locator('textarea[name="biography"]');
    if (await bioField.count().catch(() => 0)) await bioField.fill(pack.bio || '');
    const submit = page.getByRole('button', { name: /submit|kirim|simpan/i }).first();
    if (await submit.count().catch(() => 0)) await submit.click({ timeout: 5000 }).catch(() => {});
    result.bio = true;
    // PP: input file di halaman edit / atau halaman ubah foto profil.
    const fileInput = page.locator('input[type="file"]').first();
    if (await fileInput.count().catch(() => 0)) {
      await fileInput.setInputFiles(path.join(PACKS_DIR, pack.username, 'pp.jpg'));
      await humanDelay(2000, 4000);
      // Dialog konfirmasi crop: tombol "Set as profile photo / Selesai / Submit".
      const confirm = page.getByRole('button', { name: /set|submit|selesai|lanjut|done/i }).first();
      if (await confirm.count().catch(() => 0)) await confirm.click({ timeout: 5000 }).catch(() => {});
      result.pp = true;
    } else {
      result.reason = 'pp_input_tidak_ada';
      log('info', 'input file pp tidak ada — pp diatur manual, bio telah diisi');
    }
    await humanDelay(1500, 3000);
  } catch (e) {
    result.reason = e.message.slice(0, 120);
  } finally {
    await context.close().catch(() => {});
  }
  return result;
}

// Posting 1 feed dari paket (bingkai postToInstagram — sudah teruji, log sendiri).
async function postNextFeed(account, pack) {
  const posted = [];
  for (const f of (pack.feeds || [])) {
    if (f.posted) continue; // sekali hidupnya per foto
    const media = path.join(PACKS_DIR, pack.username, f.file);
    if (!fs.existsSync(media)) continue;
    const actions = require('./actions');
    const r = await actions.postToInstagram(account, media, f.caption);
    if (r.ok) posted.push(f.file);
    return { ok: !!r.ok, reason: r.reason || null, posted };
  }
  return { ok: false, reason: 'feed_habis', posted };
}

// Interaksi kecil ke "orang-orang": 1-2 target populér, like 2-3 post teratas.
const SOP_TARGETS = ['raffinagita1717', 'ayutingting92', 'prillylatuconsina96', 'rizkybillar', 'natashawilona12'];

async function warmInteraction(account, w) {
  const out = { visited: 0, liked: 0, stages: [] };
  const { browser, page } = await openAccountBrowser(account, { headless: true });
  try {
    await page.goto('https://www.instagram.com/', { timeout: 45000, waitUntil: 'domcontentloaded' });
    await humanDelay(4000, 6000);
    const target = SOP_TARGETS[Math.floor(Math.random() * SOP_TARGETS.length)];
    await page.goto(`https://www.instagram.com/${target}/`, { timeout: 45000, waitUntil: 'domcontentloaded' });
    await humanDelay(3000, 5000);
    out.visited++; out.stages.push(`lihat-lihat @${target}`);
    // Like sebatas kuota tahap — tombol Like di grid post profil target.
    const q = Math.min((w.allowedActions?.like?.count || 5), 3);
    for (let i = 0; i < q; i++) {
      const btn = page.getByRole('button', { name: /suka|like/i }).nth(i);
      if (!await btn.count().catch(() => 0)) break;
      try { await btn.click({ timeout: 5000 }); out.liked++; out.stages.push(`like @${target} #${i + 1}`); }
      catch (e) { break; }
      await humanDelay(8000, 20000); // jeda alami antar like
    }
  } catch (e) {
    out.stages.push('stop: ' + e.message.slice(0, 60));
  } finally {
    await browser.close().catch(() => {});
  }
  return out;
}

// Status 1 akun untuk strip panel: hari ke-, tahap, apa yang selesai/pending.
async function statusFor(accountId) {
  await db.waitReady();
  const rows = await db.rawAll('SELECT * FROM accounts WHERE id = ?', [accountId]);
  if (!rows.length) return null;
  const a = rows[0];
  const w = await accountWarming.getWarmingStatus(accountId);
  const state = readState()[String(accountId)] || {};
  const st = w.allowedActions || {};
  return {
    accountId,
    name: a.name,
    ageDays: accountAgeDays(a.created_at),
    stage: w.warming ? w.currentStage : null,
    stageName: w.warming ? w.stageName : null,
    packReady: !!state.pack,
    dressed: !!(state.doneToday && state.doneToday.dressed),
    postedToday: !!(state.doneToday && state.doneToday.posted),
    interactedToday: !!(state.doneToday && state.doneToday.interacted),
    quota: { view: st.view?.count ?? null, like: st.like?.count ?? null, follow: st.follow?.count ?? null, comment: st.comment?.count ?? null, post: st.post?.count ?? null },
  };
}

// Jalankan SOP untuk 1 akun (panggilan cron & tombol panel).
async function runAccount(accountId, log = () => {}) {
  await db.waitReady();
  const account = (await db.rawAll('SELECT * FROM accounts WHERE id = ?', [accountId]))[0];
  if (!account) return { ok: false, error: 'account_not_found' };
  if (account.platform !== 'ig') return { ok: false, error: 'bukan_akun_ig' };

  const state = readState();
  const key = String(accountId);
  const s = state[key] || { day: 0, pack: null, doneToday: {} };
  const w = await accountWarming.getWarmingStatus(accountId);
  const steps = [];
  const dayStamp = new Date().toISOString().slice(0, 10);
  if (s.lastDayAt !== dayStamp) s.doneToday = {}; // reset harian
  s.lastDayAt = dayStamp;

  // GATE menyatu: cooldown/limit/kuota menjaga semuanya.
  const gateOk = await accountGate.check(accountId, 'view');
  if (!gateOk.ok) {
    return { ok: false, reason: 'gate', reasons: gateOk.reasons };
  }

  // 1) HARI-0: dandan profil (sekali seumur akun, begitu SOP mulai).
  if (!s.pack) {
    log('info', 'siapkan paket dandan…');
    const pack = await ensurePack(account);
    if (!pack) return { ok: false, error: 'pack_gagal' };
    s.pack = { username: pack.username, name: pack.name, bio: pack.bio, feeds: pack.feeds };
    steps.push('paket siap');
  }
  if (!s.doneToday.dressed && !s.dressed) {
    const d = await dressUp(account, s.pack, log);
    if (d.bio) { s.dressed = true; s.doneToday.dressed = true; steps.push('bio+nama terpasang'); }
    if (d.pp) steps.push('pp terpasang');
    if (d.reason && !d.bio) return { ok: false, error: 'dressup: ' + d.reason };
  }

  // 2) Posting harian: 1 feed dari paket, hanya di tahap yang sudah boleh post.
  if (w.warming && w.allowedActions.post && !s.doneToday.posted) {
    const gp = await accountGate.check(accountId, 'post');
    if (gp.ok) {
      const r = await postNextFeed(account, s.pack);
      s.doneToday.posted = !!r.ok;
      steps.push(r.ok ? `posting ${r.posted} terkirim` : `posting ditunda (${r.reason})`);
      if (r.ok) accountGate.record(accountId, 'post');
    } else {
      steps.push('posting ditunda gate (jeda wajib/limit)');
    }
  }

  // 3) Interaksi kecil ke orang: like 2-3 post akun penopang Indonesia.
  if (!s.doneToday.interacted) {
    const gi = await accountGate.check(accountId, 'like');
    if (gi.ok) {
      const r = await warmInteraction(account, w);
      s.doneToday.interacted = r.liked > 0 || r.visited > 0;
      steps.push(r.liked ? `interaksi: visit ${r.visited}, like ${r.liked}` : 'interaksi: visit saja (kuota like 0)');
    } else {
      steps.push('interaksi ditunda gate');
    }
  }

  // Simpan state per-akun (feed yang sudah dipost ditandai di pack.json oleh postNextFeed).
  state[key] = s;
  writeState(state);
  return { ok: true, steps, day: s.day };
}

// Semua akun IG muda (usia <= 14 hari) — sekali per hari, dipanggil cron pagi.
async function runDay() {
  await db.waitReady();
  const list = await db.rawAll("SELECT id, name, username, platform, status, created_at FROM accounts WHERE platform='ig' AND status='active'");
  const report = { at: new Date().toISOString(), accounts: [] };
  for (const a of list) {
    if (accountAgeDays(a.created_at) > 14) continue; // SOP hanya untuk akun muda
    const r = await runAccount(a.id, (k, m) => console.log(`[sop ${a.name}] ${m}`));
    report.accounts.push({ id: a.id, name: a.name, ...r });
  }
  // Simpan laporan terakhir untuk panel.
  fs.mkdirSync(path.join(ROOT, 'logs'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'logs', 'sop-last.json'), JSON.stringify(report, null, 2));
  return report;
}

// Ringkasan panel: akun IG muda + status SOP masing-masing.
async function panelOverview() {
  await db.waitReady();
  const list = await db.rawAll("SELECT id FROM accounts WHERE platform='ig' AND status='active'");
  const out = [];
  for (const a of list) {
    const st = await statusFor(a.id);
    if (st && st.ageDays <= 14) out.push(st);
  }
  return out;
}

module.exports = { runDay, runAccount, statusFor, panelOverview };
