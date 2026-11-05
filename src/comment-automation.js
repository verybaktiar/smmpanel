'use strict';

const { openAccountBrowser, humanDelay, typeHuman } = require('./browser');

/**
 * Komentar Facebook & Instagram.
 *
 * commentOnPage() bekerja pada halaman yang SUDAH terbuka dan login, dipakai
 * jalur posting supaya kiriman dan komentar berbagi satu sesi browser.
 * commentOnFacebookPost()/commentOnInstagramPost() membuka browser sendiri
 * untuk komentar manual dari halaman Engagement. Teks komentar boleh berupa
 * fungsi yang menerima teks kiriman, dipakai runner untuk komentar AI.
 */

const FB_BOX = [
  'div[role="textbox"][contenteditable="true"][aria-label*="komentar" i]',
  'div[role="textbox"][contenteditable="true"][aria-label*="comment" i]',
  'form div[contenteditable="true"][role="textbox"]',
  'div[contenteditable="true"][data-lexical-editor="true"]',
  'div[role="dialog"] div[contenteditable="true"]',
];

const FB_OPENERS = [
  'div[role="button"]:has-text("Komentar")',
  'div[role="button"]:has-text("Comment")',
  'div[aria-label="Komentar"][role="button"]',
  'div[aria-label="Comment"][role="button"]',
];

const IG_BOX = [
  'textarea[aria-label*="Tambahkan komentar" i]',
  'textarea[aria-label*="Add a comment" i]',
  'textarea[placeholder*="komentar" i]',
  'textarea[placeholder*="comment" i]',
  'form textarea',
];

const IG_OPENERS = [
  'svg[aria-label="Komentar"]',
  'svg[aria-label="Comment"]',
  'button[aria-label*="Komentar" i]',
  'button[aria-label*="Comment" i]',
  'div[role="button"]:has-text("Komentar")',
];

const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();

async function firstVisible(page, selectors, timeout = 0) {
  const end = Date.now() + timeout;
  for (;;) {
    for (const sel of selectors) {
      try {
        const loc = page.locator(sel).first();
        if ((await loc.count()) > 0 && await loc.isVisible().catch(() => false)) return loc;
      } catch (e) { /* selector tidak cocok, lanjut */ }
    }
    if (Date.now() >= end) return null;
    await page.waitForTimeout(500);
  }
}

const CONTEXT_LIMIT = 1400;

// Teks postingan ikut membawa nama akun, tombol aksi, dan komentar orang lain.
// Baris antarmuka dibuang, lalu teks dipotong sebelum bagian komentar supaya AI
// menanggapi isi kiriman, bukan komentar di bawahnya.
function cleanContext(raw) {
  let lines = String(raw || '').split('\n').map(norm).filter(Boolean);
  const stop = lines.findIndex((line, i) => i > 2 && /^(komentar|comments|paling relevan|most relevant|lihat komentar lainnya|view more comments)$/i.test(line));
  if (stop > 0) lines = lines.slice(0, stop);
  lines = lines
    .filter((line) => !/^\d[\d.,]*\s*(suka|likes?|komentar|comments?|tayangan|views?|plays?)\b/i.test(line))
    .filter((line) => !/^(suka|komentar|komentari|bagikan|kirim|simpan|ikuti|mengikuti|lihat terjemahan|lihat semua|balas|postingan terkait|relevan|like|share|send|save|reply|follow|translation)$/i.test(line))
    .filter((line) => !/^(see posts, photos and more on facebook\.?|create an account or log in to instagram\.?|instagram|facebook)$/i.test(line));
  return lines.join(' ').replace(/\s+/g, ' ').trim().slice(0, CONTEXT_LIMIT);
}

// Ambil teks kiriman dari halaman yang sudah terbuka. Meta description dipakai
// sebagai cadangan karena tetap ada saat teks artikel belum termuat atau
// tertutup lapisan login.
async function readPostContext(page, platform) {
  const data = await page.evaluate(() => {
    const meta = (selector) => {
      const el = document.querySelector(selector);
      return el && el.content ? String(el.content).trim() : '';
    };
    const articles = [...document.querySelectorAll('div[role="article"], article')]
      .filter((el) => el.getClientRects().length > 0);
    const articleText = articles[0] ? String(articles[0].innerText || '').slice(0, 5000) : '';
    const caption = [...document.querySelectorAll('article h1, h1')]
      .filter((el) => el.getClientRects().length > 0)
      .map((el) => String(el.innerText || '').trim())
      .find((text) => text.length > 20) || '';
    return {
      title: meta('meta[property="og:title"]') || document.title || '',
      description: meta('meta[property="og:description"]') || meta('meta[name="description"]') || '',
      articleText,
      caption,
    };
  }).catch(() => null);
  if (!data) return '';
  const primary = platform === 'ig'
    ? (data.caption || data.description || data.articleText)
    : (data.articleText || data.description);
  const cleanPrimary = cleanContext(primary);
  if (cleanPrimary.length >= 40) return cleanPrimary;
  return cleanContext(data.description || data.title || primary);
}

async function resolveCommentText(page, platform, source) {
  if (typeof source !== 'function') return norm(source);
  const context = await readPostContext(page, platform).catch(() => '');
  return norm(await source(context));
}

async function loginWall(page) {
  if (/\/login|checkpoint/i.test(page.url())) return true;
  const pw = page.locator('input[type="password"]').first();
  return (await pw.count().catch(() => 0)) > 0 && await pw.isVisible().catch(() => false);
}

async function submitFbComment(page, box, text) {
  await box.click().catch(() => {});
  await humanDelay(500, 1000);
  await typeHuman(box, text, { noClick: true });
  await humanDelay(700, 1500);
  await page.keyboard.press('Enter').catch(() => {});

  let cleared = false;
  const end = Date.now() + 12000;
  while (Date.now() < end) {
    const left = await box.innerText().catch(() => 'x');
    if (!norm(left)) { cleared = true; break; }
    await page.waitForTimeout(600);
  }
  if (!cleared) {
    // Enter kadang hanya menambah baris; klik tombol kirim di form komentar.
    const submit = await firstVisible(page, [
      'div[role="button"][aria-label="Komentar"]:not([aria-haspopup])',
      'div[role="button"][aria-label="Comment"]:not([aria-haspopup])',
      'div[role="button"]:has-text("Kirim")',
      'div[role="button"]:has-text("Post")',
    ]);
    if (submit) {
      await submit.click().catch(() => {});
      await humanDelay(2000, 3500);
      cleared = !norm(await box.innerText().catch(() => 'x'));
    }
  }

  const visible = await page.getByText(text, { exact: false }).first().isVisible().catch(() => false);
  return { ok: cleared || visible, reason: cleared || visible ? 'commented' : 'comment_not_sent' };
}

async function commentFbPage(page, text) {
  if (await loginWall(page)) return { ok: false, reason: 'not_logged_in' };

  let box = await firstVisible(page, FB_BOX);
  if (!box) {
    for (const sel of FB_OPENERS) {
      const btn = await firstVisible(page, [sel]);
      if (!btn) continue;
      await btn.click().catch(() => {});
      await humanDelay(1200, 2200);
      break;
    }
    box = await firstVisible(page, FB_BOX, 8000);
  }
  if (!box) return { ok: false, reason: 'comment_box_not_found' };
  return submitFbComment(page, box, text);
}

// Komentar ke kiriman yang baru dibuat di halaman profil sendiri. Kolom komentar
// dicari di dalam kartu post yang teksnya cocok, jadi tidak perlu URL permalink
// (profil FB tidak selalu memasang tautan permalink di kartu post).
async function commentOnOwnFacebookPost(page, postText, commentText) {
  if (await loginWall(page)) return { ok: false, reason: 'not_logged_in' };
  const snippet = norm(postText).slice(0, 48);
  if (!snippet) return { ok: false, reason: 'post_not_found' };

  await page.goto('https://www.facebook.com/me', { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
  await humanDelay(3000, 5000);
  await page.mouse.wheel(0, 480).catch(() => {});
  await humanDelay(1200, 2200);

  // Profil FB tidak memakai div[role=article]: teks post dicari, lalu naik ke
  // div terdekat yang punya kolom komentar. Itu kartu post yang dimaksud.
  const candidates = page.locator('div').filter({ hasText: snippet });
  if ((await candidates.count().catch(() => 0)) === 0) return { ok: false, reason: 'post_not_found' };
  const textEl = candidates.last();
  await textEl.scrollIntoViewIfNeeded().catch(() => {});
  await humanDelay(800, 1500);

  const card = textEl.locator('xpath=ancestor::div[.//div[@contenteditable="true"]][1]');
  const boxes = card.locator('div[contenteditable="true"]');
  if ((await boxes.count().catch(() => 0)) === 0) return { ok: false, reason: 'comment_box_not_found' };
  return submitFbComment(page, boxes.last(), commentText);
}

async function commentIgPage(page, text) {
  if (await loginWall(page)) return { ok: false, reason: 'not_logged_in' };
  const gone = await page
    .getByText(/Postingan tidak tersedia|Sorry, this page isn't available|Halaman ini tidak tersedia/i)
    .first().isVisible().catch(() => false);
  if (gone) return { ok: false, reason: 'post_unavailable' };

  let box = await firstVisible(page, IG_BOX);
  if (!box) {
    for (const sel of IG_OPENERS) {
      const btn = await firstVisible(page, [sel]);
      if (!btn) continue;
      await btn.click().catch(() => {});
      await humanDelay(1200, 2200);
      break;
    }
    box = await firstVisible(page, IG_BOX, 8000);
  }
  if (!box) return { ok: false, reason: 'comment_box_not_found' };

  await box.click().catch(() => {});
  await humanDelay(500, 1000);
  await typeHuman(box, text, { noClick: true });
  await humanDelay(600, 1300);
  await page.keyboard.press('Enter').catch(() => {});

  let sent = false;
  const end = Date.now() + 10000;
  while (Date.now() < end) {
    if (!norm(await box.inputValue().catch(() => 'x'))) { sent = true; break; }
    await page.waitForTimeout(600);
  }
  if (!sent) {
    for (const sel of [
      'form div[role="button"]:has-text("Post")',
      'form div[role="button"]:has-text("Kirim")',
      'form button[type="submit"]',
      'div[role="button"]:has-text("Post")',
    ]) {
      const btn = await firstVisible(page, [sel]);
      if (!btn) continue;
      await btn.click().catch(() => {});
      await humanDelay(2000, 3200);
      sent = !norm(await box.inputValue().catch(() => 'x'));
      if (sent) break;
    }
  }

  const visible = await page.getByText(text, { exact: false }).first().isVisible().catch(() => false);
  return { ok: sent || visible, reason: sent || visible ? 'commented' : 'comment_not_sent' };
}

async function commentOnPage(page, platform, text) {
  const body = norm(text);
  if (!body) return { ok: false, reason: 'komentar_kosong' };
  return platform === 'ig' ? commentIgPage(page, body) : commentFbPage(page, body);
}

class CommentAutomation {
  constructor() {
    this.commentTemplates = {
      general: [
        'Postingannya bagus!',
        'Keren, lanjutkan!',
        'Isi postingannya menarik.',
        'Setuju dengan postingan ini.',
        'Terima kasih sudah berbagi.',
      ],
      supportive: [
        'Semangat terus!',
        'Karya yang bagus.',
        'Inspiratif sekali.',
        'Lanjutkan kontennya!',
      ],
      emoji: ['🔥🔥', '❤️❤️', '👍👍', '💯', '✨✨'],
    };
  }

  async commentOnFacebookPost(account, postUrl, commentText) {
    const { withDecryptedPassword } = require('./actions');
    const acc = withDecryptedPassword(account);
    const { context } = await openAccountBrowser(acc, { headless: false });
    const page = await context.newPage();
    let body = '';
    try {
      await page.goto(postUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await humanDelay(3000, 5000);
      if (await loginWall(page)) return { ok: false, reason: 'not_logged_in', url: postUrl };
      body = await resolveCommentText(page, 'fb', commentText);
      if (!body) return { ok: false, reason: 'komentar_kosong', url: postUrl };
      const r = await commentOnPage(page, 'fb', body);
      console.log(`  [komentar] Facebook: ${r.ok ? 'terkirim' : r.reason}`);
      return { ...r, url: postUrl, comment: body };
    } catch (error) {
      console.error('[komentar] FB error:', error.message);
      return { ok: false, reason: 'error: ' + error.message, url: postUrl, comment: body };
    } finally {
      await context.close().catch(() => {});
    }
  }

  async commentOnInstagramPost(account, postUrl, commentText) {
    const { withDecryptedPassword } = require('./actions');
    const acc = withDecryptedPassword(account);
    const { context } = await openAccountBrowser(acc, { headless: false });
    const page = await context.newPage();
    let body = '';
    try {
      await page.goto(postUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await humanDelay(3000, 5000);
      if (await loginWall(page)) return { ok: false, reason: 'not_logged_in', url: postUrl };
      body = await resolveCommentText(page, 'ig', commentText);
      if (!body) return { ok: false, reason: 'komentar_kosong', url: postUrl };
      const r = await commentOnPage(page, 'ig', body);
      console.log(`  [komentar] Instagram: ${r.ok ? 'terkirim' : r.reason}`);
      return { ...r, url: postUrl, comment: body };
    } catch (error) {
      console.error('[komentar] IG error:', error.message);
      return { ok: false, reason: 'error: ' + error.message, url: postUrl, comment: body };
    } finally {
      await context.close().catch(() => {});
    }
  }

  // Pratinjau hanya membaca kiriman, tidak mengirim aksi. Browser headless
  // dipakai supaya klik pratinjau tidak membuka jendela baru di layar operator.
  async readPostForPreview(account, postUrl, platform = 'fb') {
    let browserContext = null;
    try {
      const { withDecryptedPassword } = require('./actions');
      const acc = withDecryptedPassword(account);
      ({ context: browserContext } = await openAccountBrowser(acc, { headless: true }));
      const page = await browserContext.newPage();
      await page.goto(postUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await humanDelay(3000, 5000);
      if (await loginWall(page)) return { ok: false, reason: 'not_logged_in' };
      const context = await readPostContext(page, platform);
      if (!context) return { ok: false, reason: 'konteks_tidak_terbaca' };
      return { ok: true, context, url: postUrl };
    } catch (e) {
      return { ok: false, reason: 'error: ' + e.message };
    } finally {
      if (browserContext) await browserContext.close().catch(() => {});
    }
  }

  getRandomComment(category = 'general') {
    const templates = this.commentTemplates[category] || this.commentTemplates.general;
    return templates[Math.floor(Math.random() * templates.length)];
  }

  async batchComment(account, posts, commentTemplate = null) {
    const results = [];
    for (const post of posts) {
      const comment = commentTemplate || this.getRandomComment();
      const result = post.platform === 'instagram'
        ? await this.commentOnInstagramPost(account, post.url, comment)
        : await this.commentOnFacebookPost(account, post.url, comment);
      results.push({ post, comment, result });
      await humanDelay(60000, 120000);
    }
    return results;
  }

  async autoReplyToComments() {
    return { ok: false, reason: 'not_implemented' };
  }
}

module.exports = new CommentAutomation();
module.exports.commentOnPage = commentOnPage;
module.exports.commentOnOwnFacebookPost = commentOnOwnFacebookPost;
module.exports.firstVisible = firstVisible;
module.exports.readPostContext = readPostContext;
