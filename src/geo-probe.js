'use strict';
// GEO-PROBE — jawab pertanyaan: "Apakah IG/FB/TikTok benar-benar meminta geolocation?"
// Metode: buka tiap situs di patchright (headed, tanpa proxy = IP asli ID), pasang
// LOGGER pass-through (BUKAN stealth patch — tidak mengubah perilaku, hanya mencatat
// panggilan) untuk getCurrentPosition / watchPosition / permissions.query('geolocation').
// Jalankan: node src/geo-probe.js
// Keputusan adopsi P1 (geolocation koordinat dari IP) didasarkan output alat ini.
require('dotenv').config();
const path = require('path');
const { chromium } = require('patchright');

const SITES = [
  { name: 'instagram', url: 'https://www.instagram.com/' },
  { name: 'facebook', url: 'https://www.facebook.com/' },
  { name: 'tiktok', url: 'https://www.tiktok.com/' },
];
const WAIT_MS = 12000; // beri waktu SPA hidrasi + panggilan lazy

const INSTRUMENT = `
(() => {
  const emit = (type, extra) => {
    try { console.log('[GEO-PROBE]' + JSON.stringify(Object.assign({ type, url: location.href.slice(0, 80) }, extra))); } catch (e) {}
  };
  try {
    const g = navigator.geolocation;
    const oCP = g.getCurrentPosition.bind(g);
    g.getCurrentPosition = function (...a) { emit('getCurrentPosition'); return oCP(...a); };
    const oWP = g.watchPosition.bind(g);
    g.watchPosition = function (...a) { emit('watchPosition'); return oWP(...a); };
  } catch (e) {}
  try {
    const oQ = navigator.permissions.query.bind(navigator.permissions);
    navigator.permissions.query = function (d) {
      if (d && d.name === 'geolocation') emit('permissionsQuery');
      return oQ(d);
    };
  } catch (e) {}
})();`;

(async () => {
  const profileDir = path.resolve('sessions/geo-probe');
  require('fs').mkdirSync(profileDir, { recursive: true });
  const context = await chromium.launchPersistentContext(profileDir, {
    headless: false,
    locale: 'id-ID',
    timezoneId: 'Asia/Jakarta',
    args: ['--no-first-run', '--no-default-browser-check'],
  });
  await context.addInitScript(INSTRUMENT); // measurement-only

  const summary = {};
  for (const site of SITES) {
    const page = await context.newPage();
    const events = [];
    page.on('console', (msg) => {
      const t = msg.text();
      if (t.startsWith('[GEO-PROBE]')) {
        try { events.push(JSON.parse(t.slice('[GEO-PROBE]'.length))); } catch (e) {}
      }
    });
    process.stdout.write(`Buka ${site.name} ... `);
    await page.goto(site.url, { timeout: 60000, waitUntil: 'domcontentloaded' }).catch((e) => console.log('nav:', e.message.split('\n')[0]));
    await page.waitForTimeout(WAIT_MS);
    // State izin geolocation seperti yang dilihat situs (tanpa kita grant apa pun).
    let permState = '?';
    try { permState = (await page.evaluate(() => navigator.permissions.query({ name: 'geolocation' }).then((s) => s.state))).trim(); } catch (e) {}
    summary[site.name] = {
      calls: events.length,
      detail: events.map((e) => `${e.type}@${e.url.replace(/^https?:\/\//, '').slice(0, 40)}`),
      permState,
    };
    console.log(`${events.length} panggilan geolocation | permission state: ${permState}`);
    for (const d of summary[site.name].detail) console.log('   -', d);
    await page.close();
  }

  console.log('\n==== RINGKASAN GEO-PROBE ====');
  for (const [k, v] of Object.entries(summary)) {
    console.log(`${k.padEnd(10)}: ${v.calls} panggilan | permission: ${v.permState}`);
  }
  console.log('\nInterpretasi: 0 panggilan = situs tak minta lokasi saat load (P1 tetap berguna');
  console.log('untuk alur dalam — composer/check-in FB, fitur lokasi — & paritas AdsPower).');
  try { await context.close(); } catch (e) {}
  process.exit(0);
})();
