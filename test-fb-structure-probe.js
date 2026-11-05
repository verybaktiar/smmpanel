'use strict';
// PROBE STRUKTUR FORM FB (read-only, tidak submit akhir):
// node test-fb-structure-probe.js [--mobile] [--steps N] [--keep]
// Dump semua input/button per langkah wizard m.facebook.com/reg supaya
// selector fb-account-creator bisa diaudit dari data nyata, bukan asumsi.
const { chromium } = require('playwright');
require('dotenv').config();

const args = process.argv.slice(2);
const MOBILE = args.includes('--mobile');
const maxSteps = Math.max(1, Number((args.find(a => a.startsWith('--steps=')) || '--steps=4').split('=')[1]));
const KEEP = args.includes('--keep');

function pickFp() {
  try {
    const stealth = require('./src/stealth');
    if (typeof stealth.pickFreshFingerprint === 'function') return stealth.pickFreshFingerprint();
  } catch (e) { /* fallback di bawah */ }
  if (args.includes('--desktop')) {
    return { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36', viewport: '1366x768', locale: 'id-ID', timezoneId: 'Asia/Jakarta' };
  }
  return MOBILE
    ? { userAgent: 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36', viewport: '384x844', locale: 'id-ID', timezoneId: 'Asia/Jakarta' }
    : { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36', viewport: '1366x768', locale: 'id-ID', timezoneId: 'Asia/Jakarta' };
}

(async () => {
  const fp = pickFp();
  const isMobile = /Mobi|Android|iPhone/i.test(fp.userAgent);
  const vp = String(fp.viewport || '1366x768').split('x').map(Number);
  const b = await chromium.launch({ headless: false, args: ['--no-sandbox'] });
  const ctx = await b.newContext({
    viewport: { width: vp[0] || 1366, height: vp[1] || 768 },
    ...(isMobile ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}),
    userAgent: fp.userAgent,
    locale: fp.locale || 'id-ID',
    timezoneId: fp.timezoneId || 'Asia/Jakarta',
  });
  const page = await ctx.newPage();
  const dump = async (label) => {
    const info = await page.evaluate((want) => {
      const out = { url: location.href.slice(0, 120), title: (document.title || '').slice(0, 80), inputs: [], buttons: [], text: '' };
      document.querySelectorAll('input').forEach((el) => {
        const vis = el.offsetWidth > 0 && el.offsetHeight > 0;
        out.inputs.push({ type: el.type, name: el.name || null, id: el.id || null, placeholder: (el.placeholder || '').slice(0, 40), aria: el.getAttribute('aria-label'), visible: vis });
      });
      document.querySelectorAll('button, [role="button"], input[type="submit"]').forEach((el) => {
        const vis = el.offsetWidth > 0 && el.offsetHeight > 0;
        const label = (el.textContent || el.value || '').trim().slice(0, 40);
        if (label) out.buttons.push({ tag: el.tagName.toLowerCase(), label, visible: vis });
      });
      out.text = (document.body && document.body.innerText ? document.body.innerText : '').split(/\r?\n/).filter(Boolean).slice(0, 14);
      return out;
    });
    console.log(`\n===== ${label} | url: ${info.url}`);
    console.log('  title:', info.title);
    console.log('  TEXT :', info.text.join(' / ').slice(0, 320));
    info.inputs.forEach((i) => console.log(`  input type=${i.type} name=${i.name} id=${i.id} aria=${i.aria ? '"' + i.aria.slice(0, 30) + '"' : ''} vis=${i.visible}${i.placeholder ? ' ph="' + i.placeholder + '"' : ''}`));
    info.buttons.slice(0, 8).forEach((bt) => console.log(`  btn  ${bt.tag}="${bt.label}" vis=${bt.visible}`));
    return info;
  };

  try {
    // Path EKSPLISIT desktop: --desktop → UA Windows, buka facebook.com/reg
    if (args.includes('--desktop')) {
      const urls = (process.env.PROBE_URLS || 'https://www.facebook.com/r.php,https://www.facebook.com/reg/').split(',');
      for (const u of urls) {
        await page.goto(u.trim(), { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
        await page.waitForTimeout(5000);
        const d = await dump('DESKTOP ' + u.trim());
        if (d.inputs.length >= 2) { console.log('  FORM KETEMU di', u.trim()); break; }
      }
      return;
    }
    if (false && args.includes('--desktop')) {
      await page.goto('https://www.facebook.com/reg/', { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
      await page.waitForTimeout(5000);
      const d = await dump('DESKTOP facebook.com/reg');
      // Kalau reg tidak berikan form, coba klik link 'Create new account' dari login.
      if (!d.inputs.length) {
        await page.goto('https://www.facebook.com/login/', { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
        await page.waitForTimeout(4000);
        await dump('DESKTOP login');
        const crt = page.locator('a:has-text("Create new account"), a:has-text("Buat akun baru"), [role="button"]:has-text("Create new account")').first();
        if (await crt.count()) {
          await crt.click({ timeout: 5000 }).catch(() => {});
          await page.waitForTimeout(4500);
          await dump('DESKTOP setelah Create new account');
        } else console.log('DESKTOP: Create new account tidak ketemu.');
      }
      return;
    }
    // Path EKSPLISIT: --from-buat → klik 'Buat akun baru' dari login m.facebook
    // (celah paling murah untuk memakai wizard nama bertahap tanpa salur IG)
    if (args.includes('--from-buat')) {
      await page.goto('https://m.facebook.com/?next=https%3A%2F%2Fm.facebook.com%2Freg%2Fpipele%2F', { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
      await page.waitForTimeout(4000);
      await dump('FRO-BUAT: landasan login');
      const buat = page.locator('[role="button"]:has-text("Buat akun baru"), button:has-text("Buat akun baru"), a:has-text("Buat akun baru")').first();
      if (await buat.count()) {
        await buat.click({ timeout: 5000 }).catch(() => {});
        await page.waitForTimeout(4500);
        await dump('FRO-BUAT: setelah Buat akun baru');
      } else console.log('FRO-BUAT: tombol Buat akun baru tidak ketemu.');
      return; // eksplorasi satu jalur saja
    }
    const startUrl = process.env.PROBE_URL || 'https://m.facebook.com/reg/';
    await page.goto(startUrl, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
    await page.waitForTimeout(4000);
    await dump('LANGKAH 1 (landasan reg)');
    // Bila tombol 'Mulai' terlihat (onboarding IG login_via), klik dulu — wizard
    // nama baru dimunculkan setelah tombol ini.
    const mulaiLoc = page.locator('[role="button"]:has-text("Mulai"), button:has-text("Mulai")').first();
    if (await mulaiLoc.count()) {
      await page.waitForTimeout(3000); // beri waktu hidrasi React
      await mulaiLoc.click({ timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(5000);
      let d = await dump('LANGKAH 1b (setelah Mulai klik biasa)');
      if (!d.inputs.length) {
        // Klik via JS dispatch — hidrasi kadang belum memasang handler saat click biasa.
        const jsClick = await page.evaluate(() => {
          const cands = [...document.querySelectorAll('button, [role="button"], div')]
            .filter((el) => (el.textContent || '').trim() === 'Mulai' && el.offsetWidth > 0);
          const el = cands[cands.length - 1]; // inner token, bukan kontainer
          if (!el) return false;
          [["pointerdown", 0], ["mousedown", 0], ["pointerup", 0], ["mouseup", 0], ["click", 1]]
            .forEach(([t, bubbles]) => el.dispatchEvent(new MouseEvent(t, { bubbles: !!bubbles, cancelable: true, view: window })));
          return true;
        });
        await page.waitForTimeout(5000);
        d = await dump('LANGKAH 1c (setelah Mulai JS dispatch=' + jsClick + ')');
      }
      if (d.inputs.length > 0) {
        // MAP wizard bertahap: isi nama dummy → Berikutnya → dump langkah berikutnya
        // berhenti di langkah kontak (tanpa submit contact — tidak lahir akun).
        const inp = await page.$$('input:visible');
        if (inp.length >= 2) {
          await inp[0].click().catch(() => {});
          await inp[0].type('Andi', { delay: 80 }).catch(() => {});
          await page.waitForTimeout(800);
          await inp[1].click().catch(() => {});
          await inp[1].type('Santoso', { delay: 80 }).catch(() => {});
          await page.waitForTimeout(800);
        }
        const btnNext = page.locator('[role="button"]:has-text("Berikutnya"), button:has-text("Berikutnya")').first();
        if (await btnNext.count()) {
          await btnNext.click({ timeout: 8000 }).catch(() => {});
          await page.waitForTimeout(5000);
          await dump('LANGKAH 2 wizard (DOB?)');
          // Isi DOB → next → gender
          const dob = await page.$('input[type=date]:visible');
          if (dob) {
            await dob.fill('2000-05-10').catch(async () => {
              await dob.evaluate((el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); }, '2000-05-10');
            });
            await page.waitForTimeout(800);
          }
          const bn2 = page.locator('[role="button"]:has-text("Berikutnya"), button:has-text("Berikutnya")').first();
          if (await bn2.count()) { await bn2.click({ timeout: 8000 }).catch(() => {}); await page.waitForTimeout(4000); }
          await dump('LANGKAH 3 wizard (gender?)');
          // Pilih gender (radio/role) → next → kontak (BERHENTI SEBELUM isi kontak)
          const g = page.locator('text=Laki-laki').first();
          if (await g.count()) { await g.click({ timeout: 5000 }).catch(() => {}); await page.waitForTimeout(1000); }
          const bn3 = page.locator('[role="button"]:has-text("Berikutnya"), button:has-text("Berikutnya")').first();
          if (await bn3.count()) { await bn3.click({ timeout: 8000 }).catch(() => {}); await page.waitForTimeout(4000); }
          await dump('LANGKAH 4 wizard (kontak?) — BERHENTI, tidak isi kontak');
        }
        return;
      }
    }
    // Redirect ke login_via? Coba landasan alternatif langsung dgn path reg detail.
    if (/login_via/.test(page.url())) {
      console.log('  ~ redirect ke login_via — coba URL reg lain…');
      const alt = ['https://m.facebook.com/reg/?entry_point=login',
                   'https://m.facebook.com/signup/',
                   'https://m.facebook.com/reg/pipele/?entry_point=ig_onboarding&next=https%3A%2F%2Fm.facebook.com%2Freg%2F'];
      for (const a of alt) {
        await page.goto(a, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
        await page.waitForTimeout(4000);
        const d = await dump('ALT ' + a);
        if (d.inputs.length) break;
      }
    }
    // Sampai maxSteps: klik Berikutnya/Next apapun yang ada (ISI atau TIDAK diisi).
    for (let s = 2; s <= maxSteps; s++) {
      const next = page.locator('button:has-text("Berikutnya"), button:has-text("Next"), button:has-text("Lanjut"), [role="button"]:has-text("Mulai"), [role="button"]:has-text("Berikutnya")').first();
      if (await next.count()) {
        await next.click({ timeout: 5000 }).catch(() => {});
        await page.waitForTimeout(3500);
        await dump(`LANGKAH ${s} (setelah klik next)`);
      } else {
        console.log(`LANGKAH ${s}: tombol next tidak ditemukan — berhenti.`);
        break;
      }
    }
    // Dump HTML skeleton form untuk audit terperinci.
    const skel = await page.evaluate(() => {
      const f = document.querySelector('form');
      return f ? f.outerHTML.replace(/\s+/g, ' ').slice(0, 1500) : 'NO_FORM';
    });
    console.log('\nFORM HTML:', skel);
    if (KEEP) await page.waitForTimeout(120000);
  } catch (e) {
    console.error('PROBE GAGAL:', e.message);
    process.exitCode = 1;
  } finally {
    await ctx.close().catch(() => {});
    await b.close().catch(() => {});
  }
  process.exit(0);
})();
