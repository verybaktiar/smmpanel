'use strict';

// AI Content Generator — OpenAI-compatible API. Base URL, model, dan key dibaca
// dari src/ai-config.js supaya bisa diubah dari halaman AI tanpa restart.

const aiConfig = require('./ai-config');

function baseUrl() { return aiConfig.load().baseUrl; }
function apiKey() { return aiConfig.load().apiKey; }
function model() { return aiConfig.load().model; }

// Provider kadang menempel ekor SSE ("data: [DONE]") setelah JSON — kupas dulu sebelum parse.
function parseAIResponse(text) {
  let t = String(text || '').trim();
  const lines = t.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('data:'));
  const dataLines = lines.map((l) => l.slice(5).trim()).filter((l) => l && l !== '[DONE]');
  if (dataLines.length) t = dataLines[dataLines.length - 1];
  else {
    const m = t.match(/\{[\s\S]*\}/);
    if (m) t = m[0];
  }
  return JSON.parse(t);
}

// Pesan provider diterjemahkan jadi tindakan yang jelas: operator tidak perlu
// membaca JSON mentah untuk tahu key ditolak atau model tidak ada.
function providerError(status, body) {
  let detail = '';
  try {
    const j = JSON.parse(body);
    detail = (j && j.error && (j.error.message || j.error)) || j.message || '';
  } catch (e) {
    detail = String(body || '').trim();
  }
  detail = String(detail || '').replace(/\s+/g, ' ').slice(0, 220);
  if (status === 401 || status === 403) {
    return new Error(`API key ditolak provider (${status}). Periksa key di Pengaturan AI.`);
  }
  if (status === 404) {
    return new Error(`Endpoint atau model tidak ditemukan (404). Periksa Base URL dan nama model.${detail ? ` ${detail}` : ''}`);
  }
  if (status === 429) {
    return new Error(`Kuota atau batas permintaan provider tercapai (429).${detail ? ` ${detail}` : ''}`);
  }
  return new Error(`Provider menolak permintaan (${status}).${detail ? ` ${detail}` : ''}`);
}

const MODEL_TIMEOUT_MS = 45000;
const FALLBACK_TIMEOUT_MS = 20000;

function callModel(key, modelName, prompt, maxTokens, timeoutMs) {
  // Model reasoning bisa menghabiskan jatah token untuk berpikir lalu
  // mengembalikan content kosong. Parameter ini hanya dikirim kalau operator
  // memilihnya, karena tidak semua penyedia menerima reasoning_effort.
  const effort = aiConfig.load().reasoningEffort;
  return fetch(`${baseUrl()}/chat/completions`, {
    signal: AbortSignal.timeout(timeoutMs || MODEL_TIMEOUT_MS),
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: modelName,
      messages: [
        {
          role: 'system',
          content: 'Kamu adalah asisten pembuat konten media sosial. ' +
            'Buat konten yang menarik, terstruktur, dan siap diposting. ' +
            'Tulis langsung isi postingan tanpa kata pengantar seperti "Berikut" atau "Ini".',
        },
        { role: 'user', content: prompt },
      ],
      max_tokens: maxTokens,
      temperature: 0.8,
      ...(effort ? { reasoning_effort: effort } : {}),
    }),
  });
}

// Model di AI_MODEL bisa hilang dari plan akun atau kuota gratisnya habis.
// Saat itu terjadi, ambil daftar model gratis yang memang terdaftar untuk key ini
// lalu coba berurutan, bukan menebak satu nama.
let freeModels;
const deadModels = new Set();
let cacheSig = '';
function syncCache() {
  // Sertakan potongan key: key yang diganti (tetap sama-sama ada) harus
  // membuang daftar model gratis milik key lama.
  const key = apiKey();
  const sig = `${baseUrl()}|${key ? key.slice(-8) : 'nokey'}`;
  if (sig === cacheSig) return;
  cacheSig = sig;
  freeModels = undefined;
  deadModels.clear();
}

async function listFreeModels(key) {
  if (freeModels !== undefined) return freeModels;
  freeModels = [];
  try {
    const res = await fetch(`${baseUrl()}/models`, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return freeModels;
    const data = await res.json().catch(() => null);
    const ids = ((data && (data.data || data.models)) || []).map((m) => m.id).filter(Boolean);
    // Model "flash" lebih cepat dan biasanya punya kuota gratis lebih longgar,
    // jadi dicoba lebih dulu sebelum model gratis lain.
    freeModels = ids.filter((id) => /free/i.test(id))
      .sort((a, b) => (/flash/i.test(b) ? 1 : 0) - (/flash/i.test(a) ? 1 : 0));
  } catch (e) { /* tanpa daftar model, error asli yang ditampilkan */ }
  return freeModels;
}

// Hasilkan konten dari prompt pengguna.
async function generateContent(prompt, { maxTokens = 4000 } = {}) {
  syncCache();
  const key = apiKey();
  if (!key) {
    throw new Error('API key AI belum diisi. Buka halaman AI → Koneksi AI untuk mengisinya.');
  }
  // Batas tunggu dari config dipakai untuk semua percobaan: model lokal yang
  // berjalan di mesin operator butuh waktu jauh lebih lama dari cloud.
  const timeoutMs = aiConfig.load().timeoutMs || MODEL_TIMEOUT_MS;
  const tried = [];
  const errors = [];
  const attempt = async (name, timeoutMs) => {
    tried.push(name);
    try {
      const res = await callModel(key, name, prompt, maxTokens, timeoutMs);
      const text = await res.text();
      if (res.ok) return text;
      errors.push(`${name} (${res.status}): ${text.slice(0, 200)}`);
      if (res.status === 410 || /deprecated|tidak tersedia|model_not_available|kuota gratis.*habis|quota.*exhausted/i.test(text)) {
        deadModels.add(name);
      }
      return null;
    } catch (e) {
      errors.push(`${name}: ${e.message}`);
      return null;
    }
  };

  let text = await attempt(model(), timeoutMs);
  if (!text) {
    const alts = await listFreeModels(key);
    for (const alt of alts) {
      if (tried.length > 4) break;
      if (tried.includes(alt) || deadModels.has(alt)) continue;
      console.warn(`[ai] ${tried[tried.length - 1]} gagal, coba ${alt}`);
      text = await attempt(alt, FALLBACK_TIMEOUT_MS);
      if (text) break;
    }
  }

  if (!text) {
    // Detail lengkap masuk log; pesan ke operator dibuat singkat dan memberi
    // tindakan yang jelas daripada menampilkan JSON provider.
    const detail = errors.join(' | ');
    console.warn('[ai] semua model gagal:', detail);
    if (/\((401|403)\)/.test(detail)) {
      throw new Error('API key ditolak provider. Periksa key di halaman AI → Koneksi AI.');
    }
    if (errors.length === 1 && /\(404\)/.test(detail)) {
      throw new Error('Endpoint atau model tidak ditemukan (404). Periksa Base URL dan nama model di Koneksi AI.');
    }
    throw new Error('Kuota AI gratis habis atau model tidak tersedia. Coba lagi nanti atau ganti model di Pengaturan AI.');
  }
  const data = parseAIResponse(text);
  const choice = data?.choices?.[0];
  const out = choice?.message?.content;
  if (!out) {
    // Model reasoning bisa menghabiskan seluruh max_tokens untuk berpikir,
    // sehingga content kosong walau HTTP 200. Pesannya harus bisa ditindaklanjuti.
    if (choice?.finish_reason === 'length') {
      throw new Error('Model kehabisan token sebelum selesai menulis. Coba lagi atau pilih model non-reasoning di Koneksi AI.');
    }
    throw new Error('AI tidak mengembalikan konten');
  }
  return out.trim();
}

// Daftar model dari provider aktif, dipakai datalist di Pengaturan AI.
// Nilai dari formulir boleh dikirim sebelum disimpan supaya operator bisa
// memeriksa base URL baru tanpa mengubah konfigurasi yang sedang dipakai.
async function listModels({ baseUrl: baseOverride, apiKey: keyOverride } = {}) {
  const base = String(baseOverride || baseUrl()).replace(/\/+$/, '');
  const key = keyOverride || apiKey();
  if (!key) throw new Error('API key belum diisi. Isi dulu sebelum memuat daftar model.');
  let res;
  try {
    res = await fetch(`${base}/models`, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(15000),
    });
  } catch (e) {
    throw new Error(e.name === 'TimeoutError' || e.name === 'AbortError'
      ? `Provider tidak menjawab dalam 15 detik (${base}).`
      : `Tidak bisa menghubungi ${base}: ${e.message}`);
  }
  const text = await res.text();
  if (!res.ok) throw providerError(res.status, text);
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new Error('Balasan daftar model bukan JSON. Pastikan Base URL mengarah ke endpoint OpenAI-compatible (/v1).');
  }
  const ids = ((data && (data.data || data.models)) || [])
    .map((m) => (typeof m === 'string' ? m : m && m.id))
    .filter(Boolean);
  if (!ids.length) throw new Error('Provider tidak mengembalikan model apa pun.');
  return [...new Set(ids)].sort((a, b) => a.localeCompare(b));
}

// Uji koneksi dengan satu permintaan kecil. Hasilnya dipakai halaman AI untuk
// menampilkan model yang menjawab dan waktu tempuh, bukan sekadar "berhasil".
async function testConnection({ baseUrl: baseOverride, model: modelOverride, apiKey: keyOverride, reasoningEffort: effortOverride } = {}) {
  const cfg = aiConfig.load();
  const base = String(baseOverride || baseUrl()).replace(/\/+$/, '');
  const name = String(modelOverride || model()).trim();
  const key = keyOverride || apiKey();
  const effort = String(effortOverride === undefined ? cfg.reasoningEffort : effortOverride).trim();
  // Uji koneksi tetap singkat: model yang lambat sekali pun hanya menjawab
  // satu kata, jadi batas 25 detik cukup kecuali operator menaikkannya.
  const timeoutMs = cfg.timeoutMs || 25000;
  if (!key) throw new Error('API key belum diisi.');
  if (!name) throw new Error('Nama model belum diisi.');
  const started = Date.now();
  let res;
  try {
    res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: name,
        messages: [{ role: 'user', content: 'Balas dengan satu kata: siap' }],
        max_tokens: 24,
        temperature: 0,
        ...(effort ? { reasoning_effort: effort } : {}),
      }),
    });
  } catch (e) {
    throw new Error(e.name === 'TimeoutError' || e.name === 'AbortError'
      ? `Provider tidak menjawab dalam ${Math.round(timeoutMs / 1000)} detik (${base}).`
      : `Tidak bisa menghubungi ${base}: ${e.message}`);
  }
  const text = await res.text();
  if (!res.ok) throw providerError(res.status, text);
  let data = null;
  try { data = parseAIResponse(text); } catch (e) { /* balasan bukan JSON, tetap anggap tersambung */ }
  const reply = data?.choices?.[0]?.message?.content || '';
  return {
    ok: true,
    ms: Date.now() - started,
    model: data?.model || name,
    baseUrl: base,
    reply: String(reply).trim().slice(0, 120),
  };
}

// Variasi caption untuk beberapa akun: satu topik, kalimat pembuka berbeda tiap akun.
// Model diminta membalas JSON; kalau tetap membungkus dengan prosa, ambil blok array pertama.
function parseVariants(text, count) {
  const raw = String(text || '').trim();
  let list = null;
  try {
    const j = JSON.parse(raw);
    if (Array.isArray(j)) list = j;
  } catch (e) { /* bukan JSON murni, coba ekstrak */ }
  if (!list) {
    const m = raw.match(/\[[\s\S]*\]/);
    if (m) {
      try {
        const j = JSON.parse(m[0]);
        if (Array.isArray(j)) list = j;
      } catch (e) { /* fallback ke baris */ }
    }
  }
  if (!list) {
    list = raw.split('\n')
      .map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').replace(/^["“]|["”]$/g, '').trim())
      .filter(Boolean);
  }
  return list.slice(0, count).map((item) => {
    if (typeof item === 'string') return { caption: item.trim(), image: '' };
    return {
      caption: String(item.caption || item.text || '').trim(),
      image: String(item.image || item.imagePrompt || '').trim(),
    };
  }).filter((v) => v.caption);
}

async function generateCaptionVariants({ topic, count = 1, platform = 'Instagram' }) {
  const n = Math.max(1, Math.min(Number(count) || 1, 20));
  const prompt = `Buat ${n} variasi caption ${platform} untuk satu topik berikut: "${topic}".

Aturan:
- Setiap variasi memakai kalimat pembuka dan sudut berbeda, tetapi topiknya sama.
- Panjang 120-220 karakter, bahasa Indonesia yang wajar, 2-4 hashtag bila relevan.
- Jangan menyalin caption yang sama atau hanya mengganti satu kata.
- image: satu kalimat bahasa Inggris berisi deskripsi visual untuk generator gambar, cocok dengan caption, tanpa teks atau logo di dalam gambar.

Balas HANYA array JSON berisi tepat ${n} objek, tanpa penjelasan:
[{"caption":"...","image":"..."}]`;
  // Model reasoning memakai sebagian token untuk berpikir sebelum menulis JSON.
  // Lantai 1.800 mencegah array caption terpotong di tengah pada batch kecil.
  const text = await generateContent(prompt, { maxTokens: Math.min(4000, Math.max(1800, 500 + n * 260)) });
  const variants = parseVariants(text, n);
  if (!variants.length) throw new Error('AI tidak mengembalikan variasi caption');
  if (variants.length < n) throw new Error(`AI hanya mengembalikan ${variants.length} dari ${n} variasi`);
  return variants;
}

const satuBaris = (v) => String(v || '').replace(/\s+/g, ' ').trim();

// Kalimat topik berbahasa Indonesia tidak bisa dipakai langsung sebagai prompt
// model gambar: yang tertangkap hanya potongan katanya, sehingga hasilnya adegan
// umum. Satu panggilan teks di depan menyiapkan dua hal sekaligus: deskripsi
// visual berbahasa Inggris untuk generator gambar, dan teks kartu berita
// (kicker/judul/detail) yang dicetak di atas gambarnya.
async function generateImageBrief({ topic, caption = '' } = {}) {
  const inti = String(topic || '').trim();
  if (!inti) throw new Error('topik wajib');
  const teks = String(caption || '').trim().slice(0, 400);
  const prompt = `Siapkan bahan untuk satu gambar media sosial.

Topik/petunjuk operator: "${inti.slice(0, 300)}"
${teks ? `\nDraf caption yang akan tampil di postingan (SUMBER UTAMA adegan dan teks kartu):\n"${teks}"\n` : ''}
Balas HANYA satu objek JSON, tanpa penjelasan dan tanpa blok kode:
{"visual":"...","kicker":"...","headline":"...","detail":"..."}

Aturan isian:
- visual: satu kalimat bahasa Inggris 25-45 kata berisi adegan yang mewakili isi. Bila draf caption ada, ambil objek, lokasi, dan kejadian dari draf itu; topik hanya menguatkan. Sebut suasana khas Indonesia bila menyebut tempat atau peristiwa lokal. Jangan sebut gaya gambar, jenis kamera, atau pencahayaan; biarkan model gambar memilih gayanya sendiri. Tanpa teks atau logo di dalam gambar.
- kicker: 2-3 kata bahasa Indonesia HURUF BESAR untuk label merah, mis. "BERITA MADIUN".
- headline: maksimal 42 karakter HURUF BESAR, ringkas dan tegas, mis. "MADIUN HARI INI".
- detail: maksimal 95 karakter HURUF BESAR berisi inti kejadian, tanpa titik di akhir.
- Jangan mengarang angka, nama orang, nama tempat, atau korban yang tidak ada di topik/caption.`;
  // Model reasoning memakai sebagian token untuk berpikir sebelum menulis JSON;
  // 900 token mencegah objek terpotong di tengah.
  const text = await generateContent(prompt, { maxTokens: 900 });
  const raw = String(text || '').trim();
  let data = null;
  const m = raw.match(/\{[\s\S]*\}/);
  if (m) {
    try { data = JSON.parse(m[0]); } catch (e) { data = null; }
  }
  // Tanpa JSON yang valid, seluruh balasan dianggap deskripsi visual: gambar
  // tetap bisa dibuat, hanya kartu beritanya yang dilewati.
  const visual = satuBaris(data && data.visual) || satuBaris(raw.split('\n')[0]).slice(0, 400);
  if (!visual) throw new Error('AI tidak mengembalikan deskripsi gambar');
  const news = data && satuBaris(data.headline)
    ? {
      kicker: satuBaris(data.kicker).slice(0, 40),
      headline: satuBaris(data.headline).slice(0, 60),
      detail: satuBaris(data.detail).slice(0, 130),
    }
    : null;
  return { prompt: visual.slice(0, 400), news };
}

module.exports = { generateContent, generateCaptionVariants, generateImageBrief, listModels, testConnection, parseAIResponse };
