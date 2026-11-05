'use strict';
// Konfigurasi + jadwal eksekutor warming. Disimpan di config/warming-scheduler.json.
// Format: { enabled: bool, times: ["08:00","13:00","19:00"], lastRunDay: "2026-09-15", lastRunAt: "..." }
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'config');
const FILE = path.join(DIR, 'warming-scheduler.json');
const LAST = path.join(__dirname, '..', 'logs', 'warming-last.json');

const DEFAULTS = { enabled: false, times: ['08:00', '13:00', '19:00'], lastRunDay: '', lastRunAt: '' };

function getConfig() {
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    return { ...DEFAULTS, ...raw };
  } catch (e) { return { ...DEFAULTS }; }
}

function saveConfig(body) {
  let times = [];
  const src = Array.isArray(body.times) ? body.times : String(body.times || '').split(',');
  for (const t of src) {
    const s = String(t || '').trim();
    if (/^([01]\d|2[0-3]):[0-5]\d$/.test(s) && !times.includes(s)) times.push(s);
  }
  if (!times.length) return { error: 'Isi minimal 1 jam valid (mis. 08:00,13:00,19:00).' };
  if (times.length > 6) return { error: 'Maksimal 6 jadwal per hari.' };
  times.sort();
  const prev = getConfig();
  const cfg = { ...prev, enabled: !!body.enabled, times };
  if (typeof body.allowLive !== 'undefined') cfg.allowLive = !!body.allowLive;
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(cfg, null, 2));
  return cfg;
}

function markRan(slot) {
  const cfg = getConfig();
  const now = new Date();
  cfg.lastRunDay = now.toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
  cfg.lastRunAt = now.toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
  cfg.lastRunSlot = slot || '';
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(cfg, null, 2));
}

// Slot yang jatuh tempo: jadwal <= sekarang, selisih < 20 menit, belum dijalankan hari ini.
function dueSlot(cfg, nowStr, todayStr) {
  const toMin = (s) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
  const nowMin = toMin(nowStr);
  const cands = (cfg.times || []).filter((t) => { const d = nowMin - toMin(t); return d >= 0 && d < 20; }).sort();
  for (const t of cands) {
    if (cfg.lastRunSlot !== `${todayStr} ${t}`) return t;
  }
  return null;
}

function saveReport(report) {
  try {
    fs.mkdirSync(path.dirname(LAST), { recursive: true });
    fs.writeFileSync(LAST, JSON.stringify({ at: new Date().toISOString(), report }, null, 2));
  } catch (e) { /* abaikan */ }
}

function getLastReport() {
  try { return JSON.parse(fs.readFileSync(LAST, 'utf8')); }
  catch (e) { return null; }
}

// Jam WIB sekarang sebagai "HH:MM"
function wibNow() {
  return new Date().toLocaleString('en-GB', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', hour12: false });
}

module.exports = { getConfig, saveConfig, markRan, dueSlot, saveReport, getLastReport, wibNow };
