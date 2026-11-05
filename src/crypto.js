'use strict';

const crypto = require('crypto');

function getKey() {
  const env = process.env.ENCRYPTION_KEY;
  if (!env || env === 'change-me-to-a-random-32-char-secret-key!!') {
    throw new Error('ENCRYPTION_KEY belum diset. Gunakan nilai acak >= 32 char di .env');
  }
  // Derive 32-byte key dari secret (SHA-256), jadi panjang bebas.
  return crypto.createHash('sha256').update(env).digest();
}

// Format output: iv<>tag<>ciphertext (base64)
function encrypt(plaintext) {
  if (!plaintext) return null;
  const key = getKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}<>${tag.toString('base64')}<>${enc.toString('base64')}`;
}

function decrypt(stored) {
  if (!stored) return null;
  const key = getKey();
  const [ivB64, tagB64, dataB64] = stored.split('<>');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  const plain = Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]);
  return plain.toString('utf8');
}

module.exports = { encrypt, decrypt };