'use strict';

// Rate limiter untuk mencegah spam dan ban dari Facebook/Instagram
// Menggunakan random delay antar action untuk meniru behavior manusia

const { rand } = require('./browser');

// Tracking per-account rate limiting
const accountLastAction = new Map();
const accountActionCount = new Map();

setInterval(() => {
  const now = Date.now();
  for (const [id, data] of accountActionCount.entries()) {
    if (now > data.resetAt + 3600000) {
      accountActionCount.delete(id);
      accountLastAction.delete(id);
    }
  }
}, 3600000);

/**
 * Generate random delay antara min dan max detik
 * @param {number} minSeconds - Minimum delay dalam detik
 * @param {number} maxSeconds - Maximum delay dalam detik
 * @returns {number} Random delay dalam milliseconds
 */
function getRandomDelay(minSeconds = 30, maxSeconds = 90) {
  return rand(minSeconds * 1000, maxSeconds * 1000);
}

/**
 * Sleep dengan random delay untuk meniru human behavior
 * @param {number} minSeconds - Minimum delay dalam detik
 * @param {number} maxSeconds - Maximum delay dalam detik
 */
async function randomDelay(minSeconds = 30, maxSeconds = 90) {
  // DELAY DISABLED - No waiting
  console.log(`  [rate-limiter] Delay disabled, skipping wait`);
  return;
  
  // const delay = getRandomDelay(minSeconds, maxSeconds);
  // console.log(`  [rate-limiter] Waiting ${(delay / 1000).toFixed(1)}s...`);
  // await new Promise(resolve => setTimeout(resolve, delay));
}

/**
 * Check apakah akun sudah terlalu sering melakukan action
 * @param {number} accountId - ID akun
 * @param {number} maxActionsPerHour - Max actions per jam (default 20)
 * @returns {boolean} True jika safe untuk action
 */
function canPerformAction(accountId, maxActionsPerHour = 20) {
  // AKTIF: gerbang ini menahan frekuensi eksekusi engagement (like/comment/dm)
  // supaya tidak menembak beruntun dalam satu jam — sisa jitter antar-aksinya
  // ditangani waitForRateLimit di bawah.
  const now = Date.now();
  const count = accountActionCount.get(accountId);
  if (count && now <= count.resetAt && count.count >= maxActionsPerHour) {
    console.log(`  [rate-limiter] Account ${accountId} limit ${count.count}/${maxActionsPerHour}/jam tunggu ${Math.ceil((count.resetAt - now) / 60000)} mnt`);
    return false;
  }
  return true;
}

/**
 * Record action untuk tracking rate limit
 * @param {number} accountId - ID akun
 */
function recordAction(accountId) {
  const now = Date.now();
  accountLastAction.set(accountId, now);
  
  const count = accountActionCount.get(accountId) || { count: 0, resetAt: now + 3600000 };
  count.count++;
  accountActionCount.set(accountId, count);
  
  console.log(`  [rate-limiter] Account ${accountId} actions: ${count.count}/hour`);
}

/**
 * Wait jika action terakhir terlalu baru (default min 30 detik antar action)
 * @param {number} accountId - ID akun
 * @param {number} minDelaySeconds - Minimum delay dalam detik
 */
async function waitForRateLimit(accountId, minDelaySeconds = 30) {
  // AKTIF: jitter antar aksi engagement. Dipanggil queue-manager + endpoint aksi
  // manual agar aksi beruntun di akun yang sama terjeda acak sedikit di atas
  // minimum — pola manusia, bukan mesin.
  const now = Date.now();
  const last = accountLastAction.get(accountId);
  if (!last) return;
  const elapsed = now - last;
  const minDelay = minDelaySeconds * 1000;
  if (elapsed < minDelay) {
    const waitSeconds = (minDelay - elapsed) / 1000 + Math.random() * 5; // +0–5 dtk jitter acak
    console.log(`  [rate-limiter] Account ${accountId} cooldown ${waitSeconds.toFixed(1)}s...`);
    await new Promise((resolve) => setTimeout(resolve, waitSeconds * 1000));
  }
}

/**
 * Reset rate limit untuk akun (untuk testing atau manual reset)
 * @param {number} accountId - ID akun
 */
function resetAccountRateLimit(accountId) {
  accountLastAction.delete(accountId);
  accountActionCount.delete(accountId);
  console.log(`  [rate-limiter] Reset rate limit for account ${accountId}`);
}

module.exports = {
  getRandomDelay,
  randomDelay,
  canPerformAction,
  recordAction,
  waitForRateLimit,
  resetAccountRateLimit,
};
