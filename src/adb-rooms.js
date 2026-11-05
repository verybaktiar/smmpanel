'use strict';
// Room tamu = user Android kedua. Modul ini HANYA menguji kemampuan HP:
//   1. pm create-user    — room tamu boleh dibuat? (Redmi sering kena limit)
//   2. pm install-existing — IG di-mirror ke room tanpa unduhan ulang
//   3. am switch-user    — pindah ke room tamu lalu pulang ke room utama
// User probe selalu dihapus di akhir (finally), tak ada residu. Data room utama
// tidak disentuh. Hasil ini dipakai halaman Phone Farm sebelum alur create
// berbasis room dibangun.

const farm = require('./adb-farm');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const IG = 'com.instagram.android';
// Nama room buatan farm: "tamu-<jobId>" (sopir IG) dan "farm-tamu-*" (probe).
// Nama lain dianggap milik pengguna dan hanya dibuang saat slot benar-benar penuh.
const ROOM_FARM_RE = /^(tamu-|farm-tamu)/i;

// pm create-user menjawab "Success: created user id 21"; varian ROM lain memakai
// "user id 21" atau angka di baris terakhir.
function idUserBaru(out) {
  const s = String(out || '');
  const m = /(?:created user id|user id id|with id|id\s*[:=])\s*(\d+)/i.exec(s)
    || /(\d+)\s*$/.exec((s.split('\n').pop() || '').trim());
  return m ? m[1] : '';
}

async function sh(id, args) {
  // Konvensi farm.shell: argumen pertama WAJIB 'shell' (sama dengan pemanggil lain).
  const out = await farm.shell(id, ['shell', ...args]);
  return String(out || '').trim();
}

// laku(): adb yang selalu berupa {ok, out} — output ADB kadang gabung stderr,
// jadi pesan error juga dipakai sebagai output.
async function probeDevice(id) {
  const r = { id, model: '', verdict: '', ig: '', pindah: '', pesan: '', langkah: [], at: new Date().toISOString() };
  const catat = (s) => r.langkah.push(String(s).slice(0, 200));
  const laku = (args) => sh(id, args).then((v) => ({ ok: true, out: v }), (e) => ({ ok: false, out: String(e.message || e) }));

  const model = await sh(id, ['getprop', 'ro.product.model']).catch(() => '');
  r.model = model;
  if (!model) { r.verdict = 'gagal-baca'; r.pesan = 'HP tidak menjawab adb shell'; return r; }

  const users0 = await laku(['pm', 'list', 'users']);
  if (!users0.ok) { r.verdict = 'gagal-baca'; r.pesan = users0.out.slice(0, 160); return r; }
  r.users = users0.out.replace(/\s+/g, ' ');
  catat(`slot user: ${r.users}`);

  let buat = await laku(['pm', 'create-user', 'farm-tamu-probe']);
  catat(`create-user: ${buat.out.slice(0, 160)}`);
  let uid = /success|created/i.test(buat.out) ? idUserBaru(buat.out) : '';
  if (!buat.ok || !uid) {
    // Slot user HP penuh (MIUI: maks 4 user). Room sisa job lama dibuang dulu,
    // lalu create-user diulang sekali, supaya verdict tidak berhenti di "penuh".
    if (/maximum user limit|couldn't create user/i.test(buat.out)) {
      const jn = await janitorSlots(id, 'probe', { paksa: true }).catch(() => ({ dibuang: [] }));
      if (jn.dibuang && jn.dibuang.length) {
        r.dibuang = jn.dibuang;
        catat(`slot penuh: room terpakai dibuang (${jn.dibuang.join(', ')})`);
        buat = await laku(['pm', 'create-user', 'farm-tamu-probe']);
        catat(`create-user ulang: ${buat.out.slice(0, 160)}`);
        uid = /success|created/i.test(buat.out) ? idUserBaru(buat.out) : '';
      }
    }
    if (!buat.ok || !uid) {
      r.pesan = buat.out.replace(/\s+/g, ' ').slice(0, 200);
      r.verdict = /maximum user limit/i.test(buat.out) ? 'limit-penuh' : 'ditolak';
      return r;
    }
  }
  catat(`room ${uid} dibuat`);

  try {
    const ada = await laku(['pm', 'path', '--user', uid, IG]);
    if (ada.ok && /package:/.test(ada.out)) { r.ig = 'sudah ada'; catat('IG sudah terpasang di room ini'); }
    else {
      const ex = await laku(['pm', 'install-existing', '--user', uid, IG]);
      catat(`install-existing: ${ex.out.slice(0, 140)}`);
      if (ex.ok && /installed for user/i.test(ex.out)) {
        const ver = await laku(['pm', 'path', '--user', uid, IG]);
        r.ig = ver.ok && /package:/.test(ver.out) ? 'mirror (install-existing)' : 'gagal';
        catat(r.ig === 'mirror (install-existing)' ? 'IG di-mirror, tanpa unduhan ulang' : 'mirror iya tapi package tak terbaca');
      } else { r.ig = 'harus install per room'; }
    }

    const sw = await laku(['am', 'switch-user', uid]);
    if (!sw.ok) { r.pindah = 'ditolak'; catat(`switch-user: ${sw.out.slice(0, 140)}`); }
    else {
      await sleep(2500);
      const cur = await laku(['am', 'get-current-user']);
      const angka = (cur.out.replace(/\D+/g, '') || '?');
      r.pindah = angka === uid ? 'ya' : 'ragu';
      catat(`user aktif: ${angka} (target ${uid})`);
      await laku(['am', 'switch-user', '0']);
      await sleep(2000);
      catat('balik ke room utama');
    }
  } finally {
    	  // Android menolak menghapus user yang masih berstatus running: diberhentikan dulu, baru dihapus.
    await laku(['am', 'stop-user', '-w', uid]);
    let rm = await laku(['pm', 'remove-user', uid]);
    if (!(rm.ok && /success/i.test(rm.out))) rm = await laku(['pm', 'remove-user', uid]);
    r.cleanup = rm.ok && /success/i.test(rm.out) ? 'tersih' : 'belum terhapus, cek pm list users';
    catat(`bersih-bersih: ${r.cleanup} (${new Date().toLocaleTimeString('id-ID')})`);
  }

  r.verdict = r.pindah === 'ya' && (r.ig === 'mirror (install-existing)' || r.ig === 'sudah ada')
    ? 'bisa'
    : r.pindah === 'ya' ? 'bisa-parsial' : 'bentur';
  return r;
}

// ---------- Almari room tamu: dipakai sopir create per-job ----------
// Proteksi: user 0 (Pemilik) dan slot kerja FB bernama persis "Slot" tidak pernah dibuang.
async function listUsers(id) {
  const t = await sh(id, ['pm', 'list', 'users']);
  const users = [];
  for (const m of t.matchAll(/UserInfo\{(\d+):([^:}]+)(?::[^}]*)?\}/g)) {
    const nm = (m[2] || '').trim();
    const at = t.indexOf(`{${m[1]}:`);
    users.push({ uid: Number(m[1]), nama: nm, running: at >= 0 && /running/i.test(t.slice(at, at + 160)) });
  }
  return users;
}

// Daftar room + apakah aplikasi platform sudah punya data di room itu.
// "Kosong" = user non-0 yang belum punya data app; room seperti ini aman
// dipakai untuk create baru. User 0 tidak pernah disebut kosong.
async function listRooms(id, pkg = 'com.ss.android.ugc.trill') {
  const users = await listUsers(id);
  const current = Number(String(await sh(id, ['am', 'get-current-user']).catch(() => '0')).replace(/\D+/g, '')) || 0;
  const dump = await sh(id, ['dumpsys', 'package', pkg]).catch(() => '');
  const states = new Map();
  for (const line of String(dump).split('\n')) {
    const m = /^\s*User\s+(\d+):\s*(.*)$/.exec(line);
    if (!m || !/installed=/.test(m[2])) continue;
    const uid = Number(m[1]);
    const ce = Number((/ceDataInode=(\d+)/.exec(m[2]) || [])[1] || 0);
    const de = Number((/deDataInode=(\d+)/.exec(m[2]) || [])[1] || 0);
    states.set(uid, { installed: /installed=true/.test(m[2]), hasData: ce > 0 || de > 0 });
  }
  const rows = [];
  for (const u of users) {
    const path = await sh(id, ['pm', 'path', '--user', String(u.uid), pkg]).catch(() => '');
    const installed = /package:/.test(path);
    const st = states.get(u.uid);
    const hasData = !!(st && st.hasData);
    rows.push({
      id: u.uid,
      uid: u.uid,
      name: u.nama,
      running: u.running,
      current: u.uid === current,
      installed,
      empty: u.uid !== 0 && (!installed || (!!st && !hasData)),
    });
  }
  return rows;
}

// Mirror aplikasi ke user tujuan tanpa unduh ulang. Dipakai sebelum create
// di room yang belum pernah memasang app-nya.
async function installForUser(id, uid, pkg) {
  const target = Number(uid);
  if (!(target > 0)) return { installed: false, changed: false };
  const path = await sh(id, ['pm', 'path', '--user', String(target), pkg]).catch(() => '');
  if (/package:/.test(path)) return { installed: true, changed: false };
  let out = '';
  try { out = await sh(id, ['pm', 'install-existing', '--user', String(target), pkg]); }
  catch (e) { out = String(e.message || e); }
  if (!/installed for user/i.test(out)) {
    throw new Error(`gagal memasang ${pkg} di room ${target}: ${out.replace(/\s+/g, ' ').slice(0, 140)}`);
  }
  return { installed: true, changed: true };
}

// Pindah ke room (termasuk user 0 / Pemilik) dan tunggu user itu benar-benar
// aktif sebelum app dibuka.
async function enterRoom(id, uid) {
  const target = Number(uid);
  if (!Number.isInteger(target) || target < 0) {
    throw new Error(`room tidak valid: ${uid}`);
  }
  const asal = Number(String(await sh(id, ['am', 'get-current-user']).catch(() => '0')).replace(/\D+/g, '')) || 0;
  if (asal === target) return { current: target, origin: asal, changed: false };
  let out = '';
  try { out = await sh(id, ['am', 'switch-user', String(target)]); }
  catch (e) { out = String(e.message || e); }
  for (let i = 0; i < 10; i++) {
    await sleep(i === 0 ? 1500 : 1000);
    const cur = Number(String(await sh(id, ['am', 'get-current-user']).catch(() => '0')).replace(/\D+/g, '')) || 0;
    if (cur === target) return { current: target, origin: asal, changed: true };
  }
  throw new Error(`room ${target} tidak aktif setelah switch-user: ${out.replace(/\s+/g, ' ').slice(0, 140)}`);
}

// Stop-user lalu remove-user, satu usaha ulang. Android menolak hapus user running.
async function dropUser(id, uid) {
  await sh(id, ['am', 'stop-user', '-w', String(uid)]).catch(() => {});
  await sleep(1500);
  let out = '';
  try { out = await sh(id, ['pm', 'remove-user', String(uid)]); }
  catch (e) { out = String(e.message || e); }
  if (!/success/i.test(out)) {
    await sleep(2500);
    try { out = await sh(id, ['pm', 'remove-user', String(uid)]); } catch (e) { out = String(e.message || e); }
  }
  return /success/i.test(out);
}

// Janitor slot: buang sisa room farm (nama tamu-* / farm-tamu-*), termasuk yang
// masih running karena job lama gagal pulang ke Pemilik. Saat slot sudah penuh
// atau saat paksa=true, room diam milik siapa pun ikut dibuang. Pemilik (0) dan
// slot kerja FB bernama persis "Slot" tidak pernah disentuh; room farm yang
// sedang aktif dipulangkan ke Pemilik dulu sebelum dihapus.
async function janitorSlots(id, label, opsi = {}) {
  const paksa = opsi.paksa === true;
  const users = await listUsers(id);
  const boleh = (u) => u.uid !== 0 && u.nama !== 'Slot';
  const sisaFarm = users.filter((u) => boleh(u) && ROOM_FARM_RE.test(u.nama));
  const lainDiam = users.filter((u) => boleh(u) && !ROOM_FARM_RE.test(u.nama) && !u.running);
  let buang = [...sisaFarm];
  if (paksa || users.length - buang.length >= 4) {
    buang = buang.concat(lainDiam.filter((u) => !buang.includes(u)));
  }
  const aktif = Number(String(await sh(id, ['am', 'get-current-user']).catch(() => '0')).replace(/\D+/g, '')) || 0;
  const dibuang = [];
  for (const u of buang) {
    if (u.uid === aktif) {
      await sh(id, ['am', 'switch-user', '0']).catch(() => {});
      await sleep(2500);
    }
    const okHapus = await dropUser(id, u.uid);
    if (okHapus) dibuang.push(u.uid);
    else break; // HP menolak; jangan paksa selanjutnya
  }
  return { dibuang, users: users.length - dibuang.length };
}

// Pastikan ada room tamu siap-pakai: janitor bila perlu, create-user, mirror IG.
// Nama room: prefix-jobId agar jejak job terbaca di HP. Return uid room.
async function ensureRoom(id, namaRoom) {
  const users = await listUsers(id);
  const lebih = users.filter((u) => u.uid !== 0 && u.nama !== 'Slot');
  if (users.length >= 4 || lebih.some((u) => ROOM_FARM_RE.test(u.nama))) {
    await janitorSlots(id, namaRoom).catch(() => {});
  }
  // create-user (nama pendek, huruf kecil — MIUI rewel nama panjang/berkapital)
  const nm = String(namaRoom || 'tamubaru').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 20) || 'tamubaru';
  const buatRoom = async () => {
    try { return await sh(id, ['pm', 'create-user', nm]); }
    catch (e) { return String(e.message || e); }
  };
  let buat = await buatRoom();
  let uid = /success|created/i.test(buat) ? Number(idUserBaru(buat)) : 0;
  if (!uid) {
    // Slot benar-benar penuh: buang semua room terpakai (termasuk yang masih
    // running) kecuali Pemilik (0) dan slot kerja "Slot", lalu coba sekali lagi.
    const jn = await janitorSlots(id, namaRoom, { paksa: true });
    if (jn.dibuang.length) console.log(`[room] slot penuh: room ${jn.dibuang.join(', ')} dibuang`);
    buat = await buatRoom();
    uid = /success|created/i.test(buat) ? Number(idUserBaru(buat)) : 0;
  }
  if (!uid) {
    const sisa = /maximum user limit|couldn't create user/i.test(buat)
      ? ' — tidak ada room sisa yang bisa dibuang, hapus user tamu manual di HP'
      : '';
    throw new Error('create room tamu ditolak HP: ' + buat.replace(/\s+/g, ' ').slice(0, 140) + sisa);
  }
  // Tunggu user dikenali pm (born async) bila perlu
  for (let i = 0; i < 5; i++) {
    const ada0 = await listUsers(id);
    if (ada0.some((u) => u.uid === Number(uid))) break;
    await sleep(2000);
  }
  // Mirror IG ke room (install-existing, tanpa unduhan ulang)
  let ada = '';
  try { ada = await sh(id, ['pm', 'path', '--user', String(uid), IG]); }
  catch (e) { ada = String(e.message || e); }
  if (!/package:/i.test(ada)) {
    let ex = '';
    try { ex = await sh(id, ['pm', 'install-existing', '--user', String(uid), IG]); }
    catch (e) { ex = String(e.message || e); }
    if (!/installed for user/i.test(ex)) {
      // Room gagal di-mirror: burukan segera supaya tidak jadi residu.
      await dropUser(id, uid);
      throw new Error('IG gagal di-mirror ke room ' + uid + ': ' + ex.replace(/\s+/g, ' ').slice(0, 140));
    }
  }
  return uid;
}

// Masuk room (switch-user) lalu pulang ke asal. Return uid user asal (untuk pulang).
async function intoRoom(id, uid) {
  const cur = await sh(id, ['am', 'get-current-user']);
  const asal = (cur.replace(/\D+/g, '') || '0');
  try { await sh(id, ['am', 'switch-user', String(uid)]); }
  catch (e) { throw new Error('pindah ke room ' + uid + ' ditolak: ' + String(e.message || e).slice(0, 120)); }
  await sleep(3000);
  const cek = await sh(id, ['am', 'get-current-user']);
  const aktif = (cek.replace(/\D+/g, '') || '0');
  if (aktif !== String(uid)) throw new Error('room ' + uid + ' tidak jadi aktif (masih ' + aktif + ')');
  return Number(asal);
}

async function homeRoom(id, uid, asal) {
  const target = Number(asal || 0);
  // switch-user bisa ditolak saat layar terkunci atau user sibuk. Dulu kegagalan
  // ini ditelan, room tamu tetap running dan memakan slot (maks 4 user) sampai
  // job berikutnya tidak bisa membuat room. Sekarang dicoba tiga kali dan
  // hasilnya dilaporkan ke sopir.
  let aktif = null;
  for (let i = 0; i < 3; i++) {
    try { await sh(id, ['am', 'switch-user', String(target)]); } catch (e) { /* coba lagi */ }
    await sleep(1500);
    const cur = await sh(id, ['am', 'get-current-user']).catch(() => '');
    aktif = Number(String(cur).replace(/\D+/g, ''));
    if (aktif === target) break;
  }
  const pindah = aktif === target;
  const dihapus = pindah ? await dropUser(id, uid) : false;
  const sisa = pindah ? await listUsers(id).catch(() => []) : [];
  const masihAda = sisa.some((u) => u.uid === uid);
  return { ok: pindah && !masihAda, current: aktif, dihapus };
}

module.exports = { probeDevice, listUsers, listRooms, installForUser, enterRoom, janitorSlots, ensureRoom, intoRoom, homeRoom, dropUser };
