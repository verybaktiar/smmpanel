'use strict';
// Foto profil AI (Pollinations gratis) + potong watermark bawah via ffmpeg.
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const https = require('https');

const DIR = path.join(__dirname, '..', 'assets', 'faces');

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: 120000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return download(res.headers.location, dest).then(resolve, reject);
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

function cropWatermark(file) {
  return new Promise((resolve) => {
    const tmp = file + '.crop.jpg';
    const ff = process.env.FFMPEG_PATH || 'ffmpeg';
    const child = spawn(ff, ['-y', '-v', 'error', '-i', file, '-vf', 'crop=iw:ih*0.9:0:0', tmp]);
    child.on('error', () => resolve(file));
    child.on('close', (code) => {
      if (code === 0 && fs.existsSync(tmp)) {
        fs.renameSync(tmp, file);
        return resolve(file);
      }
      try { fs.unlinkSync(tmp); } catch (e) { /* abaikan */ }
      resolve(file);
    });
  });
}

const SETTINGS = ['di taman kota pagi hari', 'di kafe santai', 'di pantai sore hari',
  'di jalan kota tua', 'di sawah pinggir desa', 'di mal akhir pekan'];

async function fetchPhoto({ gender = 'female', username = 'test' } = {}) {
  fs.mkdirSync(DIR, { recursive: true });
  const age = 22 + Math.floor(Math.random() * 10);
  const who = gender === 'male' ? 'man' : 'woman';
  const prompt = `natural casual portrait photo of a young indonesian ${who} age ${age}, ${SETTINGS[Math.floor(Math.random() * SETTINGS.length)]}, soft daylight, realistic smartphone photo`;
  const seed = Math.floor(Math.random() * 999999);
  const url = 'https://image.pollinations.ai/prompt/' + encodeURIComponent(prompt) +
    `?width=512&height=512&seed=${seed}&nologo=true`;
  const dest = path.join(DIR, `${username}.jpg`);
  await download(url, dest);
  await cropWatermark(dest);
  return dest;
}

module.exports = { fetchPhoto, cropWatermark };
