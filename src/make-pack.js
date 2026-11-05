'use strict';
// Paket dandan akun baru: foto profil + bio + 2 foto feed + caption.
// Run: node src/make-pack.js <username> <male|female>
// Hasil: assets/packs/<username>/ (pp.jpg, feed1.jpg, feed2.jpg, pack.json)
// Terapkan manual/otomatis setelah login stabil (fase proxy tetap).
const fs = require('fs');
const path = require('path');
const { makeIdentity } = require('./id-identity');
const { fetchPhoto, cropWatermark } = require('./id-photo');

const FEED_SCENES = [
  'secangkir kopi susu di meja kafe kayu, foto santai siang hari',
  'senja di pantai dengan siluet perahu, foto hp realistis',
  'jalanan kota tua dengan bangunan kolonial, foto jalan-jalan',
  'makanan rumahan di meja makan, foto hangat realistis',
  'kucing oranye tidur di sofa, foto gemas realistis',
  'pemandangan sawah hijau pagi hari, foto hp realistis',
];
const FEED_CAPS = [
  'Ngopi dulu sebelum lanjut kerja. Selamat pagi semua!',
  'Senja selalu punya cara bikin tenang.',
  'Jalan-jalan santai akhir pekan kemarin.',
  'Masakan rumah tetap juara.',
  'Tukang tidur kesayangan.',
  'Segarnya pagi di desa.',
];
const pick = (a) => a[Math.floor(Math.random() * a.length)];

async function main() {
  const username = process.argv[2];
  const gender = process.argv[3] === 'male' ? 'male' : 'female';
  if (!username) { console.log('Pakai: node src/make-pack.js <username> <male|female>'); process.exit(1); }
  const dir = path.join(__dirname, '..', 'assets', 'packs', username);
  fs.mkdirSync(dir, { recursive: true });
  const idn = makeIdentity(gender);
  console.log(`ID  ${idn.name} | ${idn.bio}`);
  // 1. Foto profil (wajah)
  await fetchPhoto({ gender, username: '__tmp_pp' });
  fs.renameSync(
    path.join(__dirname, '..', 'assets', 'faces', '__tmp_pp.jpg'),
    path.join(dir, 'pp.jpg'));
  console.log('OK  pp.jpg');
  // 2-3. Foto feed (adegan + caption)
  const used = new Set();
  const feeds = [];
  for (let i = 1; i <= 2; i++) {
    let scene = pick(FEED_SCENES);
    while (used.has(scene)) scene = pick(FEED_SCENES);
    used.add(scene);
    const cap = pick(FEED_CAPS);
    const url = 'https://image.pollinations.ai/prompt/' + encodeURIComponent(`realistic smartphone photo, ${scene}`) +
      `?width=768&height=768&seed=${Math.floor(Math.random() * 999999)}&nologo=true`;
    await fetchPhotoRaw(url, path.join(dir, `feed${i}.jpg`));
    await cropWatermark(path.join(dir, `feed${i}.jpg`));
    feeds.push({ file: `feed${i}.jpg`, caption: cap });
    console.log(`OK  feed${i}.jpg — ${cap}`);
  }
  const pack = { username, gender, name: idn.name, bio: idn.bio, feeds, created_at: new Date().toISOString() };
  fs.writeFileSync(path.join(dir, 'pack.json'), JSON.stringify(pack, null, 2));
  console.log('OK  paket:', dir);
}

// Unduh mentah (tanpa crop wajah) untuk foto feed
async function fetchPhotoRaw(url, dest) {
  const https = require('https');
  await new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: 120000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchPhotoRaw(res.headers.location, dest).then(resolve, reject);
      }
      if (res.statusCode !== 200) return reject(new Error('HTTP ' + res.statusCode));
      const ws = fs.createWriteStream(dest);
      res.pipe(ws);
      ws.on('finish', () => ws.close(resolve));
      ws.on('error', reject);
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

main().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
