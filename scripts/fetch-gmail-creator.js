#!/usr/bin/env node
// Unduh binary Gmail Creator Pro (52 MB, proprietary) dari repo upstream.
// Binary dikecualikan dari git (.gitignore); config tetap divendor.
// Pemakaian: node scripts/fetch-gmail-creator.js
const fs = require('fs');
const path = require('path');
const https = require('https');

const REPO = 'ShadowHackrs/gmail-account-creator';
const BRANCH = 'main';
const EXE = 'auto_gmail_creator.exe';
const DEST = path.join(__dirname, '..', 'tools', 'gmail-creator', EXE);

fs.mkdirSync(path.dirname(DEST), { recursive: true });
const url = `https://raw.githubusercontent.com/${REPO}/${BRANCH}/${EXE}`;
console.log('Mengunduh:', url);

function get(u, depth) {
  if (depth > 3) { console.error('Gagal: terlalu banyak redirect'); process.exit(1); }
  https.get(u, (res) => {
    if (res.statusCode === 301 || res.statusCode === 302) {
      return get(res.headers.location, depth + 1);
    }
    if (res.statusCode !== 200) {
      console.error('Gagal: HTTP', res.statusCode);
      process.exit(1);
    }
    const total = Number(res.headers['content-length'] || 0);
    const out = fs.createWriteStream(DEST);
    let got = 0;
    res.on('data', (c) => {
      got += c.length;
      if (total) process.stdout.write(`\r${(got / 1048576).toFixed(1)} / ${(total / 1048576).toFixed(1)} MB`);
    });
    res.pipe(out);
    res.on('end', () => {
      console.log(`\nSelesai: ${DEST} (${(got / 1048576).toFixed(1)} MB)`);
    });
    out.on('error', (e) => { console.error('Gagal menulis:', e.message); process.exit(1); });
  }).on('error', (e) => { console.error('Gagal:', e.message); process.exit(1); });
}
get(url, 0);
