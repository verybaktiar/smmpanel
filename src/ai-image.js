'use strict';
// Gambar posting dari Avatarity (Nano Banana). Server yang mengunduh supaya
// browser menerima byte dari origin sendiri, siap dipasang ke FormData.
// Key: AVATARITY_API_KEY. Model: AVATARITY_IMAGE_MODEL sebagai bawaan, dan
// pemanggil boleh memilih salah satu dari PILIHAN_MODEL.

const TIMEOUT_MS = 120000;
const DOWNLOAD_TIMEOUT_MS = 60000;

// Daftar ini sekaligus menyaring parameter dari browser: model video atau teks
// tidak bisa ikut terkirim lewat endpoint gambar.
const PILIHAN_MODEL = ['nano-banana-pro', 'nano-banana-2.1'];
const MODEL_BAWAAN = process.env.AVATARITY_IMAGE_MODEL || PILIHAN_MODEL[0];

function pilihModel(minta) {
  const teks = String(minta || '').trim();
  if (PILIHAN_MODEL.includes(teks)) return teks;
  return PILIHAN_MODEL.includes(MODEL_BAWAAN) ? MODEL_BAWAAN : PILIHAN_MODEL[0];
}

// Avatarity menerima rasio, bukan piksel. Rasio dipilih yang paling dekat dalam
// skala logaritmik supaya 1024x1350 jatuh ke 3:4, bukan dibulatkan ke 1:1.
const RASIO = [['1:1', 1], ['4:3', 4 / 3], ['3:4', 3 / 4], ['16:9', 16 / 9], ['9:16', 9 / 16]];

function aspectRatio(width, height) {
  const w = Number(width) > 0 ? Number(width) : 1024;
  const h = Number(height) > 0 ? Number(height) : 1024;
  const target = Math.log(w / h);
  let pilih = '1:1';
  let dekat = Infinity;
  for (const [nama, nilai] of RASIO) {
    const jarak = Math.abs(target - Math.log(nilai));
    if (jarak < dekat) { dekat = jarak; pilih = nama; }
  }
  return pilih;
}

// Pesan provider diterjemahkan jadi tindakan yang jelas: operator perlu tahu
// apakah key yang salah, antrean penuh, atau layanannya yang bermasalah.
function apiError(status, detail) {
  const pesan = String(detail || '').replace(/\s+/g, ' ').slice(0, 200);
  if (status === 401 || status === 403) {
    const e = new Error('Kunci Avatarity ditolak. Periksa AVATARITY_API_KEY di .env.');
    e.statusCode = 502;
    return e;
  }
  if (status === 429) {
    const e = new Error(`Antrean atau batas Avatarity sedang penuh (429).${pesan ? ` ${pesan}` : ''}`);
    e.statusCode = 429;
    e.retryAfter = 20;
    return e;
  }
  const e = new Error(`Gambar AI gagal (${status}).${pesan ? ` ${pesan}` : ''}`);
  e.statusCode = 502;
  return e;
}

async function generateImage({ prompt, width = 1024, height = 1024, model } = {}) {
  const teks = String(prompt || '').trim();
  if (!teks) throw new Error('prompt wajib');
  const pakai = pilihModel(model);

  const key = String(process.env.AVATARITY_API_KEY || '').trim();
  if (!key) {
    const e = new Error('AVATARITY_API_KEY belum diisi di .env.');
    e.statusCode = 500;
    throw e;
  }

  let res;
  try {
    res = await fetch('https://avatarity.dev/v1/images/generations', {
      method: 'POST',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: pakai,
        prompt: teks,
        aspect_ratio: aspectRatio(width, height),
        n: 1,
      }),
    });
  } catch (e) {
    const err = new Error(e.name === 'TimeoutError' || e.name === 'AbortError'
      ? 'Avatarity tidak menjawab dalam 120 detik.'
      : e.message);
    err.statusCode = 504;
    throw err;
  }

  const isi = await res.text().catch(() => '');
  if (!res.ok) throw apiError(res.status, isi);

  let data = null;
  try { data = JSON.parse(isi); } catch (e) { data = null; }
  const url = data && data.data && data.data[0] && data.data[0].url;
  if (!url) {
    const e = new Error('Avatarity tidak mengembalikan URL gambar.');
    e.statusCode = 502;
    throw e;
  }

  let img;
  try {
    img = await fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
  } catch (e) {
    const err = new Error('Gambar sudah jadi tapi gagal diunduh dalam 60 detik.');
    err.statusCode = 504;
    throw err;
  }
  if (!img.ok) {
    const e = new Error(`Gagal mengunduh gambar hasil (${img.status}).`);
    e.statusCode = 502;
    throw e;
  }

  const type = img.headers.get('content-type') || 'image/jpeg';
  if (!type.startsWith('image/')) {
    const e = new Error('Avatarity mengembalikan berkas yang bukan gambar.');
    e.statusCode = 502;
    throw e;
  }
  const buffer = Buffer.from(await img.arrayBuffer());
  if (buffer.length < 1000) {
    const e = new Error('Gambar AI kosong.');
    e.statusCode = 502;
    throw e;
  }
  return { buffer, type, provider: 'Avatarity', model: pakai };
}

module.exports = { generateImage, aspectRatio };
