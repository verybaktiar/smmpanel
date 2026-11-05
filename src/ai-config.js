'use strict';

// Konfigurasi AI yang bisa diubah operator dari halaman AI tanpa restart server.
// Urutan: config/ai.json → variabel .env. File ini berisi API key, jadi tidak
// pernah dikirim balik ke browser dan tidak masuk repo (lihat .gitignore).

const fs = require('fs');
const path = require('path');

const FILE = process.env.AI_CONFIG_FILE
  ? path.resolve(process.env.AI_CONFIG_FILE)
  : path.join(__dirname, '..', 'config', 'ai.json');

const ENV_BASE_URL = 'https://tokenharbor.ai/v1';
const ENV_MODEL = 'deepseek-v4-flash:free';

let cache = null; // { mtimeMs, data } — file dibaca ulang hanya saat berubah

function readFile() {
  try {
    const stat = fs.statSync(FILE);
    if (cache && cache.mtimeMs === stat.mtimeMs) return cache.data;
    const data = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    const clean = data && typeof data === 'object' && !Array.isArray(data) ? data : {};
    cache = { mtimeMs: stat.mtimeMs, data: clean };
    return clean;
  } catch (e) {
    // File dihapus = kembali ke .env. Cache lama harus ikut dibuang, bukan
    // dipakai lagi sampai server restart.
    if (e.code === 'ENOENT') { cache = null; return {}; }
    console.warn(`[ai-config] ${FILE} tidak terbaca: ${e.message}`);
    return cache ? cache.data : {};
  }
}

function normalizeBaseUrl(value) {
  const raw = String(value == null ? '' : value).trim();
  if (!raw) return '';
  let url;
  try {
    url = new URL(raw);
  } catch (e) {
    throw new Error('Base URL tidak valid. Contoh: https://tokenharbor.ai/v1');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('Base URL harus diawali http:// atau https://');
  }
  if (url.search || url.hash) throw new Error('Base URL tidak boleh berisi query atau fragmen.');
  return raw.replace(/\/+$/, '');
}

function normalizeModel(value) {
  const raw = String(value == null ? '' : value).trim();
  if (!raw) return '';
  if (raw.length > 160) throw new Error('Nama model terlalu panjang (maks 160 karakter).');
  if (/\s/.test(raw)) throw new Error('Nama model tidak boleh berisi spasi.');
  return raw;
}

// Model reasoning (Qwen, DeepSeek) memakai sebagian token untuk berpikir dulu.
// Ollama menerima reasoning_effort "none" untuk mematikannya; tanpa itu balasan
// bisa kosong walau permintaan berhasil.
const REASONING_MODES = new Set(['none', 'low', 'medium', 'high']);
function normalizeReasoningEffort(value) {
  const raw = String(value == null ? '' : value).trim().toLowerCase();
  if (!raw) return '';
  if (!REASONING_MODES.has(raw)) {
    throw new Error('Mode berpikir harus none, low, medium, atau high.');
  }
  return raw;
}

// Batas tunggu per permintaan. Model lokal lewat tunnel bisa jauh lebih lambat
// dari penyedia cloud, jadi nilainya bisa dinaikkan tanpa mengubah kode.
function normalizeTimeoutMs(value) {
  if (value === '' || value == null) return 0;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 5000 || n > 600000) {
    throw new Error('Batas tunggu harus antara 5000 dan 600000 ms.');
  }
  return Math.round(n);
}

// Nilai efektif yang dipakai src/ai.js. Key tidak pernah keluar dari server
// kecuali lewat publicConfig() yang hanya mengirim petunjuk samaran.
function safe(normalize, value) {
  try { return normalize(value); } catch (e) { return ''; }
}

function load() {
  const file = readFile();
  // File yang diedit manual bisa berisi nilai tidak valid. Jangan sampai satu
  // baris salah membuat seluruh fitur AI gagal: pakai nilai berikutnya yang sah.
  const fileBase = safe(normalizeBaseUrl, file.baseUrl);
  const envBase = safe(normalizeBaseUrl, process.env.AI_BASE_URL);
  const fileModel = safe(normalizeModel, file.model);
  const envModel = safe(normalizeModel, process.env.AI_MODEL);
  const baseUrl = fileBase || envBase || ENV_BASE_URL;
  const model = fileModel || envModel || ENV_MODEL;
  const apiKey = String(file.apiKey || process.env.AI_API_KEY || '').trim();
  return {
    baseUrl,
    model,
    apiKey,
    reasoningEffort: safe(normalizeReasoningEffort, file.reasoningEffort),
    timeoutMs: safe(normalizeTimeoutMs, file.timeoutMs),
    baseUrlSource: fileBase ? 'file' : (envBase ? 'env' : 'default'),
    modelSource: fileModel ? 'file' : (envModel ? 'env' : 'default'),
    keySource: file.apiKey ? 'file' : (process.env.AI_API_KEY ? 'env' : 'none'),
  };
}

function maskKey(key) {
  const s = String(key || '');
  if (s.length < 12) return s ? '••••' : '';
  return `${s.slice(0, 3)}…${s.slice(-4)}`;
}

function publicConfig() {
  const cfg = load();
  return {
    baseUrl: cfg.baseUrl,
    model: cfg.model,
    reasoningEffort: cfg.reasoningEffort,
    baseUrlSource: cfg.baseUrlSource,
    modelSource: cfg.modelSource,
    hasKey: !!cfg.apiKey,
    keySource: cfg.keySource,
    keyHint: maskKey(cfg.apiKey),
    configured: !!cfg.apiKey,
    file: path.relative(path.join(__dirname, '..'), FILE).replace(/\\/g, '/'),
    defaults: {
      baseUrl: process.env.AI_BASE_URL || ENV_BASE_URL,
      model: process.env.AI_MODEL || ENV_MODEL,
    },
  };
}

// Simpan hanya field yang dikirim. String kosong berarti "hapus override,
// kembali ke .env" supaya operator bisa membatalkan perubahan tanpa edit file.
function save(patch = {}) {
  const next = { ...readFile() };

  if (Object.prototype.hasOwnProperty.call(patch, 'baseUrl')) {
    const v = normalizeBaseUrl(patch.baseUrl);
    if (v) next.baseUrl = v;
    else delete next.baseUrl;
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'model')) {
    const v = normalizeModel(patch.model);
    if (v) next.model = v;
    else delete next.model;
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'reasoningEffort')) {
    const v = normalizeReasoningEffort(patch.reasoningEffort);
    if (v) next.reasoningEffort = v;
    else delete next.reasoningEffort;
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'timeoutMs')) {
    const v = normalizeTimeoutMs(patch.timeoutMs);
    if (v) next.timeoutMs = v;
    else delete next.timeoutMs;
  }
  if (patch.clearKey === true) {
    delete next.apiKey;
  } else if (typeof patch.apiKey === 'string' && patch.apiKey.trim()) {
    const key = patch.apiKey.trim();
    if (key.length > 500) throw new Error('API key terlalu panjang.');
    next.apiKey = key;
  }

  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  const tmp = `${FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(tmp, FILE);
  cache = null;
  return publicConfig();
}

module.exports = { load, publicConfig, save, normalizeBaseUrl, normalizeModel, FILE };
