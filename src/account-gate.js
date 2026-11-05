'use strict';
// ACCOUNT GATE — gerbang kebijakan TUNGGAL sebelum akun dipakai otomatis.
// Menggabungkan semua sumber aturan yang dulu tercecer:
//   1. status akun (DB: active)
//   2. warming quota (account-warming: kuota per tahap + gerbang Setujui)
//   3. rotation cooldown + limit harian (account-rotation: post/like/login)
//   4. rate limiter in-process (rate-limiter: max aksi per jam)
// Semua eksekusi otomatis (queue order, scheduler, warming, comment/DM/story)
// WAJIB lewat sini supaya tiga sistem tidak saling bertentangan lagi.
//
// API:
//   await gate.check(accountId, action)  -> { ok, reasons: [...], detail }
//   gate.record(accountId, action)       -> catat aksi ke limiter + warming
//   await gate.excludedAccountIds(action, platform) -> [id...] utk rotasi
//   await gate.getActionQuota(accountId) -> kuota per aksi hari ini (papan tangga)

const db = require('./db');
const accountRotation = require('./account-rotation');
const accountWarming = require('./account-warming');
const rateLimiter = require('./rate-limiter');

// Semua aksi yang diatur tahap warming (IG). Pemetaan aksi panel -> aksi warming:
//   like/view/comment ada langsung; story & DM dibebankan ke kuota 'post'
//   (story tandingan posting sementara; DM dipetakan 'dm' agar bisa dibedakan —
//   tahap tanpa kuota dm otomatis menolak, jadi DM hanya terbuka bila tahap skema
//   memuatnya — see nama aksi 'dm' di bawah dijembatani ke konfigurasi warming).
const WARMING_ACTIONS = new Set(['view', 'like', 'follow', 'comment', 'post', 'dm', 'story']);

// Peta aksi panel (request) -> aksi warming (kuota tahap di account-warming).
// Story/DM yang belum punya baris di skema tahap otomatis ditolak sebagai
// stage_not_allowed — persis perilaku pengaman yang diinginkan.
const WARMING_ACTION_MAP = { story: 'post' };

// Jembatan alasan warming → kode standar yang sudah mengerti gateLabel UI.
function warmingReason(reason) {
  if (reason === 'action_not_allowed_in_stage') return `stage_not_allowed`;
  if (reason === 'daily_limit_reached') return `warming:daily_limit`;
  if (reason === 'not_warming') return null; // bukan blokir
  return `warming:${reason}`;
}

async function check(accountId, action) {
  const reasons = [];
  const detail = {};

  // 1) Akun harus ada & aktif
  await db.waitReady();
  const rows = await db.rawAll('SELECT id, name, status, platform FROM accounts WHERE id = ?', [accountId]);
  if (!rows.length) {
    return { ok: false, reasons: ['account_not_found'], detail };
  }
  const acc = rows[0];
  if (acc.status !== 'active') {
    reasons.push(`status_${acc.status}`);
  }

  // 2) Warming quota (hanya aksi yang diatur tahap warming)
  if (WARMING_ACTIONS.has(action)) {
    try {
      const w = await accountWarming.canPerformAction(accountId, WARMING_ACTION_MAP[action] || action);
      detail.warming = w;
      if (!w.allowed) {
        const r = warmingReason(w.reason);
        if (r) reasons.push(r);
        // not_warming tidak memblokir — akun di luar program warming bebas aksi.
      }
    } catch (e) {
      // Warming bermasalah = jangan blokir aksi, tapi catat.
      detail.warming = { error: e.message.slice(0, 80) };
    }
  }

  // 3) Rotation cooldown (checkpoint/error/post/like terakhir)
  try {
    const cd = await accountRotation.isInCooldown(accountId);
    detail.cooldown = cd.inCooldown ? cd.reason : null;
    if (cd.inCooldown) reasons.push(`cooldown:${cd.reason}`);
  } catch (e) {
    detail.cooldown = { error: e.message.slice(0, 80) };
  }

  // 4) Limit harian rotation (post/like/login yang terdaftar; lainnya lolos)
  try {
    const lim = await accountRotation.hasExceededLimits(accountId, action);
    detail.limit = lim.exceeded ? { count: lim.count, max: lim.limit } : null;
    if (lim.exceeded) reasons.push(`daily_limit:${action}`);
  } catch (e) {
    detail.limit = { error: e.message.slice(0, 80) };
  }

  // 5) Rate limiter in-process (max aksi/jam; record via gate.record)
  if (!rateLimiter.canPerformAction(accountId, 20)) {
    reasons.push('rate_limit:hourly');
  }

  return { ok: reasons.length === 0, reasons, detail };
}

// Catat aksi SETELAH sukses dieksekusi — jangan dicatat saat hanya mencoba.
// Aksi dipetakan balik ke istilah warming sebelum dicatat (story -> post).
function record(accountId, action) {
  try { rateLimiter.recordAction(accountId); } catch (e) { /* non-fatal */ }
  const mapped = WARMING_ACTION_MAP[action] || action;
  if (WARMING_ACTIONS.has(mapped)) {
    accountWarming.recordAction(accountId, mapped).catch(() => {});
  }
}

// Daftar akun yang TIDAK boleh dipakai untuk aksi ini — umpan langsung ke
// excludeIds rotasi (getNextAccount) supaya akun mati/limit tak pernah dipilih.
async function excludedAccountIds(action, platform = null) {
  await db.waitReady();
  let sql = 'SELECT id, status, platform FROM accounts WHERE 1=1';
  const params = [];
  if (platform) { sql += ' AND platform = ?'; params.push(platform); }
  const all = await db.rawAll(sql, params);
  const out = [];
  for (const a of all) {
    const c = await check(a.id, action);
    if (!c.ok) out.push(a.id);
  }
  return out;
}

// Pilih akun berikutnya via rotasi (paling sedikit terpakai) untuk aksi + platform.
// Akun yang gagal gate sudah disaring via excludedAccountIds.
async function rotationNext(action, platform = null) {
  const exclude = await excludedAccountIds(action, platform);
  return accountRotation.getNextAccount(action, platform, exclude);
}

// Kuota papan tangga: untuk tiap aksi panel (like/comment/post/story/dm)
// berikan sisa kuota warming hari ini + alasan bila tertutup.
async function getActionQuota(accountId) {
  const ACTIONS = ['view', 'like', 'comment', 'post', 'dm', 'story'];
  const out = {};
  // Satu kali baca status warming (cepat), lalu hitung kuota per aksi lokal.
  const status = await accountWarming.getWarmingStatus(accountId);
  for (const action of ACTIONS) {
    if (!status.warming) { out[action] = { open: true, source: 'no_warming_plan', unlimited: true }; continue; }
    const warmAction = WARMING_ACTION_MAP[action] || action;
    const quota = status.allowedActions[warmAction];
    if (!quota) { out[action] = { open: false, source: 'stage_not_allowed' }; continue; }
    // Pemakaian hari ini disimpan di kunci aksi warming (story tercatat sbg 'post').
    const used = status.actionsToday[warmAction] || 0;
    const remaining = Math.max(0, quota.count - used);
    out[action] = { open: remaining > 0, remaining, max: quota.count, used, source: 'warming' };
  }
  return { warming: status.warming, stage: status.currentStage, stageName: status.stageName, quota: out };
}

module.exports = { check, record, excludedAccountIds, rotationNext, getActionQuota, WARMING_ACTIONS, WARMING_ACTION_MAP };
