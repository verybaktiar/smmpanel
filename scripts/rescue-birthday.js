'use strict';
// Penyelamat dialog "Tetapkan tanggal" IG (date picker native 3 roda).
// Pakai: node scripts/rescue-birthday.js <deviceId> <dd> <mm> <yyyy>
// Roda dikenali dari dump UI; geser via swipe (input swipe) sampai target di tengah.
const { execFile } = require('child_process');
const ADB = process.env.ADB_PATH || 'C:/Users/Admin/AppData/Local/Microsoft/WinGet/Packages/Genymobile.scrcpy_Microsoft.Winget.Source_8wekyb3d8bbwe/scrcpy-win64-v4.1/adb.exe';
const id = process.argv[2];
const WANT_D = Number(process.argv[3] || 15);
const WANT_M = Number(process.argv[4] || 6); // 1-12
const WANT_Y = Number(process.argv[5] || 1998);
if (!id) { console.log('Pakai: node scripts/rescue-birthday.js <deviceId> <dd> <mm> <yyyy>'); process.exit(1); }

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
function adb(args, timeout = 25000) {
  return new Promise((resolve, reject) => {
    execFile(ADB, ['-s', id, ...args], { timeout }, (e, o, er) => (e ? reject(new Error((er || e.message).slice(0, 150))) : resolve(String(o))));
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function dumpNodes() {
  await adb(['shell', 'uiautomator', 'dump', '/sdcard/igui.xml']);
  const xml = await adb(['shell', 'cat', '/sdcard/igui.xml']);
  const nodes = [];
  for (const m of xml.matchAll(/<node[^>]*text="([^"]*)"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"[^>]*>/g)) {
    nodes.push({ text: m[1], x: (+m[2] + +m[4]) >> 1, y: (+m[3] + +m[5]) >> 1, cy: (+m[3] + +m[5]) / 2, h: +m[5] - +m[3] });
  }
  return nodes;
}

// Satu roda = kolom X dengan item teksnya. Temukan posisi target saat ini (y terdekat
// dengan pusat roda), lalu swipe sampai item target tepat di pusat.
async function spinTo(wheel, targetText, label) {
  const cx = wheel.x;
  for (let round = 0; round < 40; round++) {
    const nodes = await dumpNodes();
    const items = nodes.filter((n) => Math.abs(n.x - cx) < 40 && wheel.items.includes(n.text));
    if (!items.length) { console.log(`[wheel ${label}] item tak terbaca, ulangi`); await sleep(800); continue; }
    const center = items.reduce((a, b) => (Math.abs(a.cy - wheel.centerY) < Math.abs(b.cy - wheel.centerY) ? a : b));
    if (center.text === targetText) { console.log(`[wheel ${label}] OK di ${targetText}`); return true; }
    // Arah: item target di atas/bawah item terpilih? (urutan stabil via slice+sort)
    const target = items.find((n) => n.text === targetText);
    if (!target) { console.log(`[wheel ${label}] target ${targetText} belum tampil di roda — swipe satu langkah`); }
    const byY = items.slice().sort((a, b) => a.y - b.y);
    const idxC = byY.findIndex((n) => n.text === center.text);
    const idxT = byY.findIndex((n) => n.text === targetText);
    const stepsApart = idxT >= 0 ? Math.abs(idxC - idxT) : 1;
    const step = Math.min(Math.max(stepsApart * (wheel.h || 130), wheel.h || 130), 6 * (wheel.h || 130));
    const goingUp = target ? target.y < center.y : true; // target di atas = swipe ke bawah
    const y1 = goingUp ? wheel.centerY + step : wheel.centerY - step;
    const y2 = goingUp ? wheel.centerY - step : wheel.centerY + step;
    await adb(['shell', 'input', 'swipe', String(cx), String(y1), String(cx), String(y2), '350']);
    await sleep(900);
  }
  console.log(`[wheel ${label}] GAGAL capai ${targetText}`);
  return false;
}

(async () => {
  // Snapshot awal: kenali 3 roda dari kelompok X item + tombol ATUR.
  let nodes = await dumpNodes();
  let atur = nodes.find((n) => /^atur$/i.test(n.text));
  if (!atur) { console.log('Dialog Tetapkan tanggal tidak terlihat. Dump: ' + nodes.slice(0, 8).map((n) => n.text).join('|')); process.exit(2); }

  const wheelTexts = nodes.filter((n) => /^(19|20)\d\d$/.test(n.text) || MONTHS.includes(n.text) || /^\d{1,2}$/.test(n.text));
  const byX = new Map();
  for (const n of wheelTexts) { const k = n.x; if (!byX.has(k)) byX.set(k, []); byX.get(k).push(n); }
  const cols = [...byX.entries()].filter(([, v]) => v.length >= 3).sort((a, b) => a[0] - b[0]);
  if (cols.length < 3) { console.log('Roda tidak terbaca lengkap:', cols.map(([x, v]) => x + ':' + v.length).join(', ')); process.exit(2); }
  const mkWheel = ([x, items]) => {
    const sorted = [...items].sort((a, b) => a.cy - b.cy);
    return {
      x,
      items: items.map((n) => n.text),
      centerY: sorted[Math.floor(sorted.length / 2)].cy,
      h: Math.round(sorted[Math.floor(sorted.length / 2)].h) || 130,
    };
  };
  const wheels = cols.map(mkWheel);
  const dayW = wheels[0], monW = wheels[1], yearW = wheels[2];
  const yLabel = (n) => MONTHS[n - 1] || String(n);

  let ok = true;
  ok = (await spinTo(dayW, String(WANT_D), 'hari')) && ok;
  ok = (await spinTo(monW, MONTHS[WANT_M - 1], 'bulan')) && ok;
  ok = (await spinTo(yearW, String(WANT_Y), 'tahun')) && ok;
  await sleep(600);
  const fin = await dumpNodes();
  const atur2 = fin.find((n) => /^atur$/i.test(n.text)) || atur;
  await adb(['shell', 'input', 'tap', String(atur2.x), String(atur2.y)]);
  console.log('ATUR ditekan. Hasil roda:', ok ? 'sesuai target' : 'TIDAK semua sesuai — periksa layar');
  process.exit(ok ? 0 : 3);
})().catch((e) => { console.error('GAGAL:', e.message); process.exit(3); });
