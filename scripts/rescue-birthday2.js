'use strict';
// Penyelamat dialog "Tetapkan tanggal" IG — V2 cepat (hitung matang, swipe besar).
// Pakai: node scripts/rescue-birthday2.js <deviceId> <dd> <mm> <yyyy>
// Strategi: dump SEKALI -> hitung selisih target dgn posisi terpilih ->
// swipe panjang = selisih*itemH sekali per roda -> verifikasi -> koreksi halus.
const { execFile } = require('child_process');
const ADB = process.env.ADB_PATH || 'C:/Users/Admin/AppData/Local/Microsoft/WinGet/Packages/Genymobile.scrcpy_Microsoft.Winget.Source_8wekyb3d8bbwe/scrcpy-win64-v4.1/adb.exe';
const id = process.argv[2];
const WANT_D = Number(process.argv[3] || 15);
const WANT_M = Number(process.argv[4] || 6);
const WANT_Y = Number(process.argv[5] || 1998);
if (!id) { console.log('Pakai: node scripts/rescue-birthday2.js <deviceId> <dd> <mm> <yyyy>'); process.exit(1); }

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
    nodes.push({ text: m[1], x: (+m[2] + +m[4]) >> 1, y: +m[3], cy: (+m[3] + +m[5]) / 2, h: +m[5] - +m[3] });
  }
  return nodes;
}

// Ambil snapshot roda: 3 kolom. Posisi terpilih = item paling dekat centerY dialog.
async function snapshotWheels() {
  const nodes = await dumpNodes();
  const MONTH_RE = new RegExp(`^(${MONTHS.join('|')})$`);
  const isWheelText = (t) => /^(19|20)\d\d$/.test(t) || MONTH_RE.test(t) || /^\d{1,2}$/.test(t);
  const byX = new Map();
  for (const n of nodes) if (isWheelText(n.text)) { if (!byX.has(n.x)) byX.set(n.x, []); byX.get(n.x).push(n); }
  const cols = [...byX.entries()].filter(([, v]) => v.length >= 3).sort((a, b) => a[0] - b[0]);
  if (cols.length < 3) return null;
  return cols.map(([x, items]) => {
    const s = [...items].sort((a, b) => a.cy - b.cy);
    return { x, items: s, centerY: s[1].cy, h: s[1].h || 132 };
  });
}

// Kumpulan nilai yang mungkin utk satu roda (urutan naik), dari item terlihat + target.
function valueSeries(kind) {
  if (kind === 'month') return MONTHS;
  if (kind === 'year') { const a = []; for (let y = 2010; y >= 1990; y--) a.push(String(y)); return a; }
  const a = []; for (let d = 1; d <= 31; d++) a.push(String(d).padStart(2, '0')); return a;
}
// Nilai dpt cocok '28' atau '28' padStart — cocokkan longgar.
function matchIdx(series, text) {
  const t = String(text).trim().toLowerCase();
  let i = series.findIndex((s) => String(s).toLowerCase() === t);
  if (i < 0 && kindIsNum(series)) { const n = parseInt(t, 10); i = series.findIndex((s) => parseInt(s, 10) === n); }
  return i;
}
function kindIsNum(series) { return typeof series[0] === 'string' && /^\d/.test(series[0]); }

async function spinWheel(wheel, kind, wantText, label) {
  const series = valueSeries(kind);
  for (let pass = 0; pass < 25; pass++) {
    const w = wheel; // posisi x stabil antar pass
    const cur = matchIdx(series, w.items[1].text); // item tengah = terpilih
    const want = matchIdx(series, wantText);
    if (cur < 0 || want < 0) { console.log(`[${label}] tak terbaca: cur=${w.items[1].text} want=${wantText}`); await sleep(600); continue; }
    if (cur === want) { console.log(`[${label}] OK di ${wantText}`); return true; }
    const delta = want - cur; // positif = maju (item di bawah datang ke tengah = swipe ke atas)
    const mag = Math.min(Math.abs(delta), 12);
    const dist = mag * w.h;
    const y1 = delta > 0 ? w.centerY + dist : w.centerY - dist;
    const y2 = w.centerY;
    console.log(`[${label}] ${w.items[1].text} -> ${wantText} (delta ${delta}, swipe ${Math.round(dist)}px)`);
    await adb(['shell', 'input', 'swipe', String(w.x), String(y1), String(w.x), String(y2), '400']);
    await sleep(1400);
    // refresh posisi items
    const nodes = await dumpNodes();
    const items = nodes.filter((n) => Math.abs(n.x - w.x) < 40).sort((a, b) => a.cy - b.cy);
    if (items.length) { w.items = items; w.centerY = items[1] ? items[1].cy : w.centerY; w.h = (items[1] ? items[1].h : w.h) || 132; }
  }
  console.log(`[${label}] GAGAL capai ${wantText}`);
  return false;
}

(async () => {
  const wheels = await snapshotWheels();
  if (!wheels || wheels.length < 3) { console.log('Roda tidak terbaca — pastikan dialog Tetapkan tanggal terbuka.'); process.exit(2); }
  const [dayW, monW, yearW] = wheels;
  let ok = true;
  ok = (await spinWheel(yearW, 'year', String(WANT_Y), 'tahun')) && ok;
  ok = (await spinWheel(monW, 'month', MONTHS[WANT_M - 1], 'bulan')) && ok;
  // Hari terakhir (jumlah hari tergantung bulan; longgar 1-31)
  ok = (await spinWheel(dayW, 'day', String(WANT_D).padStart(2, '0'), 'hari')) && ok;
  await sleep(700);
  const fin = await dumpNodes();
  const atur = fin.find((n) => /^atur$/i.test(n.text));
  if (atur) await adb(['shell', 'input', 'tap', String(atur.x), String(atur.y)]);
  console.log('ATUR ditekan. Roda:', ok ? 'sesuai target' : 'TIDAK semua sesuai — cek layar HP');
  process.exit(ok ? 0 : 3);
})().catch((e) => { console.error('GAGAL:', e.message); process.exit(3); });
