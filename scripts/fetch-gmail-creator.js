#!/usr/bin/env node
// Unduh binary Gmail Creator Pro (52 MB, proprietary) dari repo upstream.
// Binary dikecualikan dari git (.gitignore); config tetap divendor.
// Pemakaian: node scripts/fetch-gmail-creator.js
const fs = require('fs');
const path = require('path');
const https = require('https');

const REPO = 'ShadowHackrs/gmail-account-creator';
const BRANCH = 'main';
const FILES = [
  'auto_gmail_creator.exe',
  // Temuan 2026-10-03: tool upstream error "names txt is empty" bila daftar nama
  // tidak ada; ikutkan juga file data-nya.
  'data/names.txt',
];
const DEST_DIR = path.join(__dirname, '..', 'tools', 'gmail-creator');

fs.mkdirSync(path.join(DEST_DIR, 'data'), { recursive: true });

function get(rel, depth) {
  const dest = path.join(DEST_DIR, ...rel.split('/'));
  if (fs.existsSync(dest) && fs.statSync(dest).size > 0) {
    console.log(`Lewati (sudah ada): ${rel}`);
    next();
    return;
  }
  const url = `https://raw.githubusercontent.com/${REPO}/${BRANCH}/${rel}`;
  console.log('Mengunduh:', url);
  if (depth > 3) { console.error('Gagal: terlalu banyak redirect'); process.exit(1); }
  https.get(url, (res) => {
    if (res.statusCode === 301 || res.statusCode === 302) {
      res.resume();
      return get(rel, depth + 1);
    }
    if (res.statusCode !== 200) {
      console.error('Gagal: HTTP', res.statusCode);
      process.exit(1);
    }
    const total = Number(res.headers['content-length'] || 0);
    const out = fs.createWriteStream(dest);
    let got = 0;
    res.on('data', (c) => {
      got += c.length;
      if (total) process.stdout.write(`\r${(got / 1048576).toFixed(1)} / ${(total / 1048576).toFixed(1)} MB`);
    });
    res.pipe(out);
    res.on('end', () => {
      console.log(`\nSelesai: ${dest} (${(got / 1048576).toFixed(1)} MB)`);
      next();
    });
    out.on('error', (e) => { console.error('Gagal menulis:', e.message); process.exit(1); });
  }).on('error', (e) => { console.error('Gagal:', e.message); process.exit(1); });
}

let i = 0;
function next() {
  if (i >= FILES.length) return;
  const rel = FILES[i++];
  get(rel, 0);
}
next();
