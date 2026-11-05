/**
 * native-explore.js — Alat setir interaktif HP via ADB untuk pemetaan wizard.
 * Setiap perintah = satu langkah. Dump tersimpan otomatis + elemen bisa ditap per indeks.
 *
 * Pemakaian:
 *   node src/native-explore.js dump                 (lihat isi layar + daftar elemen)
 *   node src/native-explore.js tap 12               (tap elemen indeks 12 dari dump terakhir)
 *   node src/native-explore.js tap id=com.google.android.gms:id/xxx
 *   node src/native-explore.js tap t="buat akun"    (cari teks ATAU content-desc)
 *   node src/native-explore.js text 5 "Nama Saya"   (tap indeks 5 lalu ketik)
 *   node src/native-explore.js back | home | wake
 *   node src/native-explore.js open com.google.android.gm
 *   node src/native-explore.js shot
 *   node src/native-explore.js wifi off | data on
 *   node src/native-explore.js sms                  (SMS terbaru — untuk OTP)
 * Opsi: --serial XXX  --label hp1
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { listDevices, forDevice, sleep } = require('./adb');

function argVal(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : null;
}

async function main() {
  const serial = argVal('serial') || ((await listDevices()).find((d) => d.state === 'device') || {}).serial;
  if (!serial) { console.error('Tidak ada HP berstatus device.'); process.exit(1); }
  const label = argVal('label') || 'hp1';
  const dir = path.join(__dirname, '..', 'sessions', `gmail-native-${label}`, 'explore');
  fs.mkdirSync(dir, { recursive: true });
  const lastPath = path.join(dir, '.explore-last.json');
  const hp = forDevice(serial);

  const cmd = process.argv[2];
  const rest = process.argv.slice(3);
  if (!cmd) { console.error('Perintah dibutuhkan: dump/tap/text/back/home/wake/open/shot/wifi/data/sms'); process.exit(1); }

  const stepN = (() => {
    const files = fs.readdirSync(dir).filter((f) => /^explore-\d+-/.test(f));
    return files.length ? Math.max(...files.map((f) => Number(f.match(/^explore-(\d+)-/)[1]))) : 0;
  })();

  const saveDump = async () => {
    const activity = await hp.currentActivity();
    const { xml, nodes, ok } = await hp.dump();
    const n = stepN + 1;
    const safeAct = String(activity || 'unknown').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
    if (ok) {
      const base = `explore-${String(n).padStart(3, '0')}-${safeAct}`;
      fs.writeFileSync(path.join(dir, base + '.xml'), xml);
      try { await hp.screenshot(path.join(dir, base + '.png')); } catch (_) {}
    }
    fs.writeFileSync(lastPath, JSON.stringify({ activity, nodes, ok }, null, 1));
    return { activity, nodes, ok, n };
  };

  const printList = ({ activity, nodes, ok }) => {
    if (!ok) { console.log(`DUMP GAGAL (${activity || 'layar tak terbaca'}) — kemungkinan animasi/FLAG_SECURE. Coba lagi, atau lihat: node src/native-explore.js shot`); return; }
    console.log(`Aktivitas: ${activity}`);
    console.log(`Node: ${nodes.length}`);
    const pick = nodes.filter((x) => x.clickable || x.text || x.desc).slice(0, 60);
    for (const x of pick) {
      const tag = x.text || x.desc || '';
      console.log(`[${x.index}] ${x.clickable ? 'TAP' : '   '} ${x.cls.replace(/^android\.widget\./, '').replace(/^android\./, '')} id=${x.resourceId || '-'} ${tag ? `| ${tag.slice(0, 60)}` : ''} @(${x.cx},${x.cy})`);
    }
  };

  const findIdx = async (q) => {
    const last = JSON.parse(fs.readFileSync(lastPath, 'utf8'));
    if (!last.ok) { console.error('Dump terakhir tidak tersedia.'); process.exit(1); }
    if (/^\d+$/.test(q)) {
      const node = last.nodes[Number(q)];
      if (!node) { console.error(`Indeks ${q} tidak ada (0..${last.nodes.length - 1}).`); process.exit(1); }
      return node;
    }
    const m = q.match(/^(id|t)=(.*)$/);
    if (!m) { console.error('Format: <indeks> | id=<resource-id> | t=<teks/desc>'); process.exit(1); }
    const [_, kind, val] = m;
    const hit = kind === 'id'
      ? last.nodes.filter((x) => x.resourceId === val)
      : last.nodes.filter((x) => (x.text || '').toLowerCase().includes(val.toLowerCase()) || (x.desc || '').toLowerCase().includes(val.toLowerCase()));
    if (!hit.length) { console.error('Tidak ketemu: ' + q); process.exit(1); }
    return hit[0];
  };

  if (cmd === 'dump') {
    printList(await saveDump());
  } else if (cmd === 'tap') {
    const node = await findIdx(rest[0]);
    console.log(`Tap [${node.index}] @(${node.cx},${node.cy}) ${node.text || node.desc || node.resourceId}`);
    await hp.tap(node.cx, node.cy);
    await sleep(2500);
    printList(await saveDump());
  } else if (cmd === 'text') {
    const node = await findIdx(rest[0]);
    const value = rest.slice(1).join(' ');
    console.log(`Ketik di [${node.index}] (${node.resourceId || node.text}): ${value}`);
    await hp.tap(node.cx, node.cy);
    await sleep(700);
    await hp.text(value);
    await sleep(500);
    await hp.key(111); // ESC = tutup keyboard IME tanpa mengubah layar
    await sleep(1200);
    printList(await saveDump());
  } else if (cmd === 'back') {
    await hp.back(); await sleep(1500); printList(await saveDump());
  } else if (cmd === 'home') {
    await hp.home(); await sleep(1200); printList(await saveDump());
  } else if (cmd === 'wake') {
    await hp.unlockSwipe(); printList(await saveDump());
  } else if (cmd === 'open') {
    await hp.shell(`monkey -p ${rest[0]} -c android.intent.category.LAUNCHER 1`);
    await sleep(3500);
    printList(await saveDump());
  } else if (cmd === 'shot') {
    const f = path.join(dir, `shot-${Date.now()}.png`);
    await hp.screenshot(f);
    console.log('Tersimpan: ' + f);
  } else if (cmd === 'wifi' || cmd === 'data') {
    const on = rest[0] !== 'off';
    await hp.shell(`svc ${cmd} ${on ? 'enable' : 'disable'}`);
    await sleep(2500);
    console.log(`${cmd} ${on ? 'on' : 'off'} terkirim.`);
    const net = await hp.shell('dumpsys connectivity | grep "Active default network"');
    console.log((net.stdout || '').toString().trim());
  } else if (cmd === 'sms') {
    const r = await hp.shell('content query --uri content://sms/inbox --projection address,body,date --sort date\\:DESC 2>/dev/null | head -5');
    console.log((r.stdout || '').toString().trim() || '(tidak bisa membaca SMS / tidak ada pesan)');
  } else {
    console.error('Perintah tidak dikenal: ' + cmd);
    process.exit(1);
  }
}

main().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
