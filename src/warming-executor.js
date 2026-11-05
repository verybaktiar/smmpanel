'use strict';
// Eksekutor warming: jalankan jatah harian (view/like/follow) via browser profil akun.
// Default DRY-RUN (buka + scroll + hitung, tanpa klik) sampai dipersenjatai via panel.
// Aturan: jam manusia 07-22 WIB, jeda acak, kuota dari account-warming, proxy sticky akun.
const db = require('./db');
const accountWarming = require('./account-warming');
const { openAccountBrowser, humanDelay, rand } = require('./browser');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Target follow: akun besar Indonesia (pengikut nyata, bukan sesama bot)
const IG_TARGETS = ['raffinagita1717', 'ayutingting92', 'prillylatuconsina96', 'rizkybillar', 'natashawilona12'];

function wibHour() {
  return Number(new Date().toLocaleString('en-US', { timeZone: 'Asia/Jakarta', hour: 'numeric', hour12: false }));
}

async function runOnce({ dryRun = true } = {}) {
  const report = { dryRun, hour: wibHour(), accounts: [] };
  if (report.hour < 7 || report.hour >= 22) {
    report.skipped = 'di luar jam manusia (07-22 WIB)';
    return report;
  }
  const list = await accountWarming.getAllWarmingAccounts();
  for (const w of list) {
    const item = { account: w.account_name, stage: w.stage_name, actions: [] };
    try {
      if (w.platform !== 'ig') { item.skipped = 'v1 hanya Instagram'; report.accounts.push(item); continue; }
      const rows = await db.rawAll('SELECT * FROM accounts WHERE id = ?', [w.account_id]);
      if (!rows.length) { item.skipped = 'akun hilang'; report.accounts.push(item); continue; }
      const account = rows[0];
      if (account.status !== 'active') { item.skipped = `status ${account.status}, dilewati`; report.accounts.push(item); continue; }
      if (!account.proxy) { item.skipped = 'tanpa proxy sticky, dilewati (bahaya IP rumah)'; report.accounts.push(item); continue; }
      const st = await accountWarming.getWarmingStatus(w.account_id);
      const q = st.allowedActions || {};
      const can = async (t) => (await accountWarming.canPerformAction(w.account_id, t)).allowed;

      const { browser, page } = await openAccountBrowser(account, { headless: true });
      try {
        await page.goto('https://www.instagram.com/', { timeout: 45000, waitUntil: 'domcontentloaded' });
        await sleep(5000);
        // VIEW: scroll feed
        const views = Math.min(q.view ? q.view.count : 5, 10);
        for (let i = 0; i < views; i++) {
          await page.mouse.wheel(0, 600 + rand(0, 400)).catch(() => {});
          await humanDelay(2000, 5000);
        }
        if (await can('view')) { await accountWarming.recordAction(w.account_id, 'view'); item.actions.push(`view:${views}`); }
        if (dryRun) { item.actions.push('dry-run: tanpa klik'); }
        else {
          // LIKE: tombol Like di beranda sampai kuota
          if (q.like && await can('like')) {
            let liked = 0;
            const btns = page.getByRole('button', { name: /suka|like/i });
            const n = await btns.count().catch(() => 0);
            for (let i = 0; i < Math.min(n, q.like.count); i++) {
              try { await btns.nth(i).click({ timeout: 5000 }); liked++; } catch (e) { /* lewati */ }
              await humanDelay(60000, 300000); // 1-5 menit antar like
              await accountWarming.recordAction(w.account_id, 'like');
            }
            item.actions.push(`like:${liked}`);
          }
          // FOLLOW: kunjungi target, klik Ikuti sampai kuota
          if (q.follow && await can('follow')) {
            let followed = 0;
            for (const t of IG_TARGETS) {
              if (followed >= q.follow.count) break;
              if (!(await can('follow'))) break;
              await page.goto(`https://www.instagram.com/${t}/`, { timeout: 45000, waitUntil: 'domcontentloaded' }).catch(() => {});
              await sleep(4000);
              const fb = page.getByRole('button', { name: /^ikuti|follow$/i }).first();
              if ((await fb.count().catch(() => 0)) > 0) {
                try { await fb.click({ timeout: 5000 }); followed++; } catch (e) { /* lewati */ }
                await accountWarming.recordAction(w.account_id, 'follow');
                await humanDelay(120000, 420000); // 2-7 menit antar follow
              }
            }
            item.actions.push(`follow:${followed}`);
          }
        }
      } finally {
        await browser.close().catch(() => {});
      }
    } catch (e) {
      item.error = String(e.message || e).slice(0, 150);
    }
    report.accounts.push(item);
  }
  return report;
}

module.exports = { runOnce };
