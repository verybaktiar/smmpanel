'use strict';

// TOTP RFC 6238, kompatibel Google Authenticator: HMAC-SHA1, 6 digit, periode
// 30 detik. Secret dalam base32 (RFC 4648) persis seperti di URL otpauth://.
// Tanpa dependensi supaya bisa dipakai db.js dan automasi tanpa tambahan paket.

const crypto = require('crypto');

const B32 = /^[A-Z2-7]+$/;
const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

// Terima base32 mentah (boleh lowercase/spasi) atau URL otpauth://; kembalikan
// base32 bersih uppercase, atau null bila tidak valid.
function normalizeSecret(raw) {
  let s = String(raw || '').trim();
  if (!s) return null;
  if (/^otpauth:\/\//i.test(s)) {
    try { s = new URL(s).searchParams.get('secret') || ''; } catch (e) { return null; }
  }
  s = s.toUpperCase().replace(/[\s-]/g, '').replace(/=+$/, '');
  if (!B32.test(s) || s.length < 8) return null;
  return s;
}

function b32decode(s) {
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of s) {
    value = (value << 5) | ALPHA.indexOf(ch);
    bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return Buffer.from(out);
}

// Kode jendela berjalan + sisa detiknya. timeMs bisa diisi untuk pengujian.
function totpCode(secretB32, timeMs = Date.now(), period = 30, digits = 6) {
  const key = b32decode(secretB32);
  const counter = Math.floor(timeMs / 1000 / period);
  const msg = Buffer.alloc(8);
  msg.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  msg.writeUInt32BE(counter >>> 0, 4);
  const h = crypto.createHmac('sha1', key).update(msg).digest();
  const off = h[h.length - 1] & 0xf;
  const bin = ((h[off] & 0x7f) << 24) | (h[off + 1] << 16) | (h[off + 2] << 8) | h[off + 3];
  return {
    code: String(bin % 10 ** digits).padStart(digits, '0'),
    expires_in: period - (Math.floor(timeMs / 1000) % period),
    period,
    digits,
  };
}

module.exports = { normalizeSecret, totpCode };
