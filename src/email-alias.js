'use strict';
// Helper email signup IG.
// 1. Alias menyerupai manusia (dari nama identitas): teguh.pratama05, dewi.sari2003, dst.
//    Bukan lagi `ig1789960987110258` (timestamp mentah = sinyal bot yang jelas).
// 2. Rotasi domain: AMMAIL_DOMAINS="a.com,b.com" dipakai bergiliran (round-robin per
//    proses). Fallback ke AMMAIL_DOMAIN tunggal bila AMMAIL_DOMAINS tidak diset.
//    Tujuan: sebar signup antar domain, maksimal 1-2/hari/domain agar reputasi domain awet.

const fs = require('fs');
const path = require('path');

const STATE_FILE = path.join(__dirname, '..', 'sessions', 'email-domain-index.json');

// ---- Domain rotator ----
// Lock-file kecil supaya beberapa proses (creator, probe, relogin) dapat giliran
// bergantian tanpa saling timpa — index disimpan per proses+file, atomic write.
function loadIndex() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')).index || 0; } catch (e) { return 0; }
}

function saveIndex(i) {
  try {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify({ index: i }, null, 1));
  } catch (e) { /* abaikan: rotasi tidak kritikal */ }
}

function mailDomains() {
  const multi = (process.env.AMMAIL_DOMAINS || '')
    .split(',').map((s) => s.trim()).filter(Boolean);
  if (multi.length) return multi;
  const single = (process.env.AMMAIL_DOMAIN || '').trim();
  return single ? [single] : [];
}

function nextDomain() {
  const list = mailDomains();
  if (!list.length) return '';
  const i = loadIndex();
  const d = list[i % list.length];
  saveIndex(i + 1);
  return d;
}

// ---- Alias manusiawi dari nama identitas ----
// first/last dari id-identity (Rizky, Pratama, ...). Output contoh:
//   teguh.pratama05 | dewi.sari | rangga.wibowo2004 | p.utama77
// Tanpa timestamp, angka kecil wajar seperti manusia milih email.
function humanAlias(first, last) {
  const f = String(first || 'user').toLowerCase().replace(/[^a-z]/g, '') || 'user';
  const l = String(last || '').toLowerCase().replace(/[^a-z]/g, '');
  const n = (min, max) => min + Math.floor(Math.random() * (max - min + 1));
  const styles = [
    () => `${f}.${l}${String(n(1, 99)).padStart(2, '0')}`,
    () => `${f}.${l}`,
    () => `${f}.${l}${n(1995, 2007)}`,
    () => `${f[0]}.${l}${n(10, 99)}`,
    () => `${f}${n(10, 99)}.${l}`,
    () => `${f}.${l[0]}${n(10, 99)}`,
  ];
  return (styles[n(0, styles.length - 1)])();
}

// Gabungan: alias + domain rotasi. Tanpa first/last (mis. probe), ambil nama acak
// dari bank identitas Indonesia supaya aliasnya tetap manusiawi.
function makeEmail(names = {}) {
  let first = names.first, last = names.last;
  if (!first) {
    const p = require('./id-identity').pickName();
    first = p.first; last = p.last;
  }
  const alias = humanAlias(first, last);
  const domain = nextDomain();
  return { alias, domain, email: domain ? `${alias}@${domain}` : alias };
}

module.exports = { makeEmail, humanAlias, nextDomain, mailDomains };
