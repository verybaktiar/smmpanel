// Bingkai kartu berita: foto AI diberi lapisan teks gaya berita (badge merah,
// bar judul navy, strip detail, chip tanggal) supaya hasilnya terbaca sebagai
// kabar, bukan foto lepas. Digambar di canvas browser agar tidak perlu
// dependensi komposit gambar di server.
const FONT = '-apple-system, "Segoe UI", Roboto, Arial, sans-serif';
const NAVY = '#0f2a63';
const RED = '#c8102e';
const STRIP = '#d5e7f9';
const STRIP_TEXT = '#0b2350';
const INK = '#111418';

// Perkecil ukuran font sampai teks muat satu baris; kalau masih tidak muat di
// batas minimum, potong dengan elipsis agar tidak menabrak elemen sebelah.
function fitFont(ctx, text, maxWidth, size, { weight = 700, min = 12 } = {}) {
  let s = Math.round(size);
  while (s > min) {
    ctx.font = `${weight} ${s}px ${FONT}`;
    if (ctx.measureText(text).width <= maxWidth) return s;
    s -= 1;
  }
  ctx.font = `${weight} ${min}px ${FONT}`;
  return min;
}

function ellipsize(ctx, text, maxWidth) {
  let t = String(text || '');
  if (ctx.measureText(t).width <= maxWidth) return t;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > maxWidth) t = t.slice(0, -1);
  return `${t.trimEnd()}…`;
}

const tanggal = (d) => {
  const s = d.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  return s.charAt(0).toUpperCase() + s.slice(1);
};

/**
 * Tempel bingkai berita pada gambar.
 * @param {File|Blob} file foto dasar (hasil generator AI)
 * @param {{kicker?:string, headline?:string, detail?:string}} news teks kartu
 * @param {Date} when tanggal yang dicetak di chip
 * @returns {Promise<File>} file baru; file asli dikembalikan bila teks tidak lengkap
 */
export async function withNewsCard(file, news, when = new Date()) {
  const headline = String((news && news.headline) || '').trim();
  if (!headline) return file;

  const bitmap = await createImageBitmap(file);
  const W = bitmap.width;
  const H = bitmap.height;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, 0, 0, W, H);
  if (bitmap.close) bitmap.close();

  const m = Math.round(W * 0.03);
  const kickerH = Math.round(H * 0.082);
  const titleH = Math.round(H * 0.125);
  const stripH = Math.round(H * 0.085);
  const kickerY = H - (kickerH + titleH + stripH);
  const titleY = kickerY + kickerH;
  const stripY = titleY + titleH;

  // Foto berita bisa terang; bar bawah digelapkan sedikit dulu supaya tepi
  // bar tidak menyatu dengan langit atau aspal yang terang.
  const shade = ctx.createLinearGradient(0, kickerY - H * 0.12, 0, H);
  shade.addColorStop(0, 'rgba(0,0,0,0)');
  shade.addColorStop(1, 'rgba(0,0,0,.45)');
  ctx.fillStyle = shade;
  ctx.fillRect(0, kickerY - H * 0.12, W, H - kickerY + H * 0.12);

  ctx.textBaseline = 'middle';

  // Badge merah: label rubrik + kota.
  const kicker = String((news && news.kicker) || '').trim().toUpperCase();
  if (kicker) {
    const padX = Math.round(W * 0.016);
    const w = Math.min(W - m * 2, Math.round(W * 0.46));
    ctx.fillStyle = RED;
    ctx.fillRect(m, kickerY, w, kickerH);
    ctx.fillStyle = '#fff';
    const size = fitFont(ctx, kicker, w - padX * 2, kickerH * 0.5, { min: 10 });
    ctx.font = `700 ${size}px ${FONT}`;
    ctx.fillText(ellipsize(ctx, kicker, w - padX * 2), m + padX, kickerY + kickerH / 2 + 1);
  }

  // Bar judul navy dengan chip tanggal di ujung kanan.
  const barW = W - m * 2;
  ctx.fillStyle = NAVY;
  ctx.fillRect(m, titleY, barW, titleH);

  const chipPadX = Math.round(W * 0.012);
  const chipH = Math.round(titleH * 0.56);
  const chipLabel = tanggal(when);
  let chipSize = Math.round(chipH * 0.42);
  ctx.font = `600 ${chipSize}px ${FONT}`;
  let chipW = ctx.measureText(chipLabel).width + chipPadX * 2;
  if (chipW > barW * 0.34) {
    chipSize = Math.round(chipSize * 0.8);
    ctx.font = `600 ${chipSize}px ${FONT}`;
    chipW = ctx.measureText(chipLabel).width + chipPadX * 2;
  }
  const chipX = m + barW - chipW - Math.round(W * 0.012);
  const chipY = titleY + (titleH - chipH) / 2;
  ctx.fillStyle = '#fff';
  ctx.fillRect(chipX, chipY, chipW, chipH);
  ctx.fillStyle = INK;
  ctx.font = `600 ${chipSize}px ${FONT}`;
  ctx.fillText(chipLabel, chipX + chipPadX, chipY + chipH / 2 + 1);

  const titlePadX = Math.round(W * 0.018);
  const titleMax = chipX - m - titlePadX * 2;
  const up = headline.toUpperCase();
  // Bobot 800 ikut diukur: kalau fitFont memakai 700, teks yang digambar lebih
  // lebar dari perkiraan dan terpotong padahal masih ada ruang.
  const titleSize = fitFont(ctx, up, titleMax, titleH * 0.62, { min: 12, weight: 800 });
  ctx.fillStyle = '#fff';
  ctx.font = `800 ${titleSize}px ${FONT}`;
  ctx.fillText(ellipsize(ctx, up, titleMax), m + titlePadX, titleY + titleH / 2 + 1);

  // Strip detail: inti kejadian dalam satu baris padat.
  const detail = String((news && news.detail) || '').trim().toUpperCase();
  if (detail) {
    ctx.fillStyle = STRIP;
    ctx.fillRect(m, stripY, barW, stripH);
    const dPadX = Math.round(W * 0.016);
    const dMax = barW - dPadX * 2;
    const dSize = fitFont(ctx, detail, dMax, stripH * 0.42, { min: 9 });
    ctx.fillStyle = STRIP_TEXT;
    ctx.font = `700 ${dSize}px ${FONT}`;
    ctx.fillText(ellipsize(ctx, detail, dMax), m + dPadX, stripY + stripH / 2 + 1);
  }

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92));
  if (!blob) return file;
  const name = String(file.name || 'ai.jpg').replace(/\.[a-z]+$/i, '');
  return new File([blob], `${name}-berita.jpg`, { type: 'image/jpeg' });
}
