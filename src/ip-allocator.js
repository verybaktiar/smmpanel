'use strict';
// Alokasi IP lahir otomatis untuk signup IG.
//
// Masalah yang diselesaikan: stok proxy dipakai bergiliran, jadi dua akun bisa
// lahir di IP yang sama, dan IP yang sudah membakar signup tetap dipakai ulang.
//
// Alur satu alokasi:
//   1. Ambil satu zona putar (Bright Data) dari daftar proxy.
//   2. Minta sesi acak baru → baca IP keluarnya.
//   3. Lewati IP yang sudah punya riwayat apa pun (signup, probe akun, proxy lain).
//   4. PATOK proxy ke IP itu lewat parameter -ip-<ip>, lalu baca ulang untuk
//      memastikan IP-nya benar-benar sama. Pin inilah yang membuat IP tidak
//      berubah lagi saat akun dipakai belakangan.
//   5. Simpan baris proxy (status reserved). Runner mengikatnya ke akun saat
//      akun lahir, dan menandainya bekas bila signup gagal.
const crypto = require('crypto');
const db = require('./db');

const reservedIps = new Set(); // alokasi di proses ini, termasuk yang belum ditulis akun
const MAX_TRIES = 8;

function parseProxy(value) {
  const s = String(value || '').trim().replace(/^\w+:\/\//, '');
  const m = /^(?:([^:@]+):([^@]+)@)?([^:]+):(\d+)(?::([^:]+)(?::([^:]+))?)?$/.exec(s);
  if (!m) return null;
  return { host: m[3], port: m[4], user: m[1] || m[5] || '', pass: m[2] || m[6] || '' };
}

const build = (p, user) => `${p.host}:${p.port}:${user}:${p.pass}`;

// Zona yang bisa diputar + dipatok. Bright Data memakai -ip-<ip> untuk mengunci
// satu IP dari zona; provider lain belum punya jaminan itu, jadi tidak dipakai.
function isPinnableZone(value) {
  const p = parseProxy(value);
  if (!p || !p.user) return false;
  if (!/brd-customer|superproxy/i.test(p.host + ' ' + p.user)) return false;
  return /-zone-[\w-]+/i.test(p.user);
}

function cleanUser(user) {
  return String(user)
    .replace(/-session-[^-:]+/gi, '')
    .replace(/-ip-\d+\.\d+\.\d+\.\d+/gi, '');
}

function sessionVariant(value) {
  const p = parseProxy(value);
  if (!p) return null;
  const sid = crypto.randomBytes(4).toString('hex');
  return build(p, `${cleanUser(p.user)}-session-${sid}`);
}

function pinToIp(value, ip) {
  const p = parseProxy(value);
  if (!p || !ip) return null;
  return build(p, `${cleanUser(p.user)}-ip-${ip}`);
}

// Probe disuntikkan dari create-runner supaya modul ini tidak mengimpor runner
// (runner sudah mengimpor modul ini — hindari lingkaran require).
// persist=false dipakai tombol "Tes alokasi": IP dicari dan dipatok persis
// seperti run nyata, tetapi tidak disimpan dan tidak membuka browser.
async function allocate({ probe, log, persist = true } = {}) {
  if (typeof probe !== 'function') return { error: 'probe IP tidak tersedia' };
  const note = typeof log === 'function' ? log : () => {};
  let bases = [];
  try {
    await db.releaseStaleAutoProxies();
    // Hanya zona stok yang boleh jadi sumber putaran — baris hasil alokasi sudah
    // milik satu akun, jadi jangan dipakai sebagai basis baru.
    bases = (await db.listProxies()).filter(
      (p) => p.source !== 'auto-ip' && p.status !== 'burned' && isPinnableZone(p.value)
    );
  } catch (e) {
    return { error: 'gagal membaca daftar proxy: ' + (e.message || e) };
  }
  if (!bases.length) {
    return { error: 'belum ada zona proxy yang bisa diputar. Tambah Bright Data di halaman Proxy' };
  }
  let lastErr = '';
  for (let i = 0; i < MAX_TRIES; i++) {
    const base = bases[i % bases.length];
    const session = sessionVariant(base.value);
    if (!session) { lastErr = 'format proxy dasar tidak dikenali'; continue; }
    note(`[IP] minta sesi baru dari proxy #${base.id}…`);
    const r = await probe(session);
    if (r.error) { lastErr = `proxy #${base.id}: ${r.error}`; continue; }
    const ip = r.ip;
    if (!ip || ip === 'direct') { lastErr = 'IP keluar tidak terbaca'; continue; }
    // Kunci IP SEBELUM cek riwayat: dua alokasi paralel (bulk) tidak boleh
    // sama-sama lolos pada IP yang sama. Dilepas lagi bila percobaan ini batal.
    if (reservedIps.has(ip)) { lastErr = `IP ${ip} sedang dialokasikan run lain`; continue; }
    if (persist) reservedIps.add(ip);
    let used = 0;
    try { used = await db.countIpUses(ip); } catch (e) { used = 0; }
    if (used > 0) {
      if (persist) reservedIps.delete(ip);
      lastErr = `IP ${ip} sudah punya riwayat (${used} catatan)`;
      continue;
    }
    const pinned = pinToIp(base.value, ip);
    const chk = await probe(pinned);
    if (chk.error || chk.ip !== ip) {
      if (persist) reservedIps.delete(ip);
      lastErr = `pin IP ${ip} gagal (${chk.error || 'keluar ' + chk.ip})`;
      continue;
    }
    if (!persist) return { ok: true, preview: true, proxy: pinned, ip, baseId: base.id };
    let row = null;
    try { row = await db.addAutoProxy(pinned, ip); } catch (e) {
      reservedIps.delete(ip);
      return { error: 'gagal menyimpan proxy hasil alokasi: ' + (e.message || e) };
    }
    return { ok: true, proxy: pinned, ip, proxyId: row && row.id, baseId: base.id };
  }
  return { error: `tidak dapat IP bersih setelah ${MAX_TRIES} percobaan${lastErr ? ': ' + lastErr : ''}` };
}

// Dipakai saat runner berhenti tanpa sempat menulis hasil: baris tetap disimpan
// (IP sudah terlihat oleh IG), hanya statusnya dibedakan supaya operator paham.
async function abandon(proxy) {
  try { await db.burnAutoProxy(proxy); } catch (e) { /* jejak saja */ }
}

module.exports = { allocate, abandon, isPinnableZone, sessionVariant, pinToIp, parseProxy };
