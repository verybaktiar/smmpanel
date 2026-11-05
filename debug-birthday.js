/**
 * TikTok birthday picker probe — diagnose DOM struktur dropdown & wheel
 * sebelum mengedit tiktok-account-creator.js.
 * Run: node debug-birthday.js [proxy]
 */
'use strict';

require('dotenv').config();
const { chromium } = require('patchright');
const stealth = require('./stealth');
const PROXY = process.argv[2] || null;

(async () => {
  let browser;
  try {
    const opts = { headless: false, args: stealth.launchArgs() };
    if (PROXY) {
      const p = PROXY.split(':');
      opts.proxy = { server: `http://${p[0]}:${p[1]}` };
      if (p[2]) { opts.proxy.username = p[2]; opts.proxy.password = p[3] || ''; }
    }
    if (process.env.TT_CHROME !== '0') {
      try { browser = await chromium.launch({ ...opts, channel: 'chrome' }); } catch (_) {}
    }
    if (!browser) browser = await chromium.launch(opts);

    const context = await browser.newContext({
      viewport: { width: 412, height: 915 },
      userAgent: 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
      languages: ['id-ID', 'id', 'en-US', 'en'],
    });
    const page = await context.newPage();
    console.log('=== BROWSER OPEN ===');

    // Intercept & log TikTok API responses
    page.on('response', r => {
      if (/passport|passpoint|age|signup/i.test(r.url())) {
        r.text().then(t => {
          if (t.length < 500) console.log(`[API] ${r.status()} ${r.url().slice(0,120)} :: ${t}`);
        }).catch(() => {});
      }
    });

    await page.goto('https://www.tiktok.com/signup', { timeout: 120000, waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(5000);

    // Tutup modal cookies
    for (const name of [/decline/i, /tolak/i]) {
      const b = page.getByRole('button', { name }).first();
      if (await b.count() > 0) { await b.click().catch(() => {}); await page.waitForTimeout(2000); }
    }
    // Tutup interstitial "Dapatkan pengalaman lebih lengkap"
    for (const name of [/nanti saja/i, /not now/i]) {
      const btn = page.getByRole('button', { name }).first();
      if (await btn.count() > 0) { await btn.click().catch(() => {}); await page.waitForTimeout(2000); }
    }

    console.log('URL setelah landing:', page.url());

    // Klik nav1
    const nav1 = await Promise.race([
      page.getByRole('link', { name: /Gunakan nomor telepon atau email/i }).first().click().then(() => true).catch(() => false),
      page.getByRole('link', { name: /Use phone or email/i }).first().click().then(() => true).catch(() => false),
    ]);
    if (!nav1) {
      const box = await page.locator('text=/Gunakan nomor telepon atau email|Use phone or email/i').first().boundingBox().catch(() => null);
      if (box) { await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2); }
    }
    await page.waitForTimeout(5000);
    console.log('URL setelah nav1:', page.url());

    // === PROBE 1: cek rate-limit ===
    const bodyText = await page.evaluate(() => document.body ? document.body.innerText : '').catch(() => '');
    if (/batas percobaan|frekuensi/i.test(bodyText)) {
      console.log('[RATE-LIMITED]', bodyText.slice(0, 200));
      await page.screenshot({ path: 'probe-rate-limit.png' });
      await browser.close(); return;
    }

    // === PROBE 2: dropdown variant ===
    console.log('\n=== PROBING DROPDOWN (.DivSelector) ===');
    const dropLabels = await page.locator('.DivSelector').count();
    console.log('.DivSelector count:', dropLabels);

    // Semua teks yang mengandung "Bulan", "Hari", "Tahun" (bukan exact match)
    const bulanAll = await page.locator('*:has-text("Bulan")').count();
    const hariAll = await page.locator('*:has-text("Hari")').count();
    const tahunAll = await page.locator('*:has-text("Tahun")').count();
    console.log('Has "Bulan":', bulanAll, ' | "Hari":', hariAll, ' | "Tahun":', tahunAll);

    // Struktur detail: cari div dengan aria-label atau text murni
    const bulanExact = await page.locator('div:has-text("^Bulan$")').count();
    console.log('div dengan "^Bulan$":', bulanExact);

    // Semua DivSelector dengan innerText
    const dss = await page.evaluate(() => {
      return [...document.querySelectorAll('.DivSelector')].map(el => ({
        text: el.innerText,
        html: el.outerHTML.slice(0, 300),
        visible: el.offsetParent !== null,
        children: el.children.length,
        tag: el.tagName,
      }));
    }).catch(() => []);
    console.log('DivSelector details:', JSON.stringify(dss.slice(0, 5), null, 2));

    // === PROBE 3: wheel variant ===
    console.log('\n=== PROBING WHEEL (.rmc-picker) ===');
    const wheelCount = await page.locator('.rmc-picker').count();
    console.log('.rmc-picker count:', wheelCount);

    if (wheelCount > 0) {
      const wheelInfo = await page.evaluate(() => {
        const cols = [...document.querySelectorAll('.rmc-picker')].filter(e => e.offsetParent !== null);
        return cols.map((col, i) => ({
          idx: i,
          visible: col.offsetParent !== null,
          itemCount: col.querySelectorAll('.rmc-picker-item').length,
          items: [...col.querySelectorAll('.rmc-picker-item')].map(it => it.innerText.trim()),
          indicatorText: (() => {
            const sel = col.querySelector('.rmc-picker-item-selected');
            return sel ? sel.innerText.trim() : 'none';
          })(),
          style: {
            overflow: col.style.overflow,
            transform: col.style.transform,
          },
          boundingBox: (() => {
            const r = col.getBoundingClientRect();
            return { x: r.x, y: r.y, w: r.width, h: r.height };
          })(),
        }));
      }).catch(() => []);
      console.log('Wheel columns:', JSON.stringify(wheelInfo, null, 2));

      // Test scroll: coba mouse.wheel pada year column
      if (wheelInfo.length >= 1) {
        const yearCol = wheelInfo[0];
        console.log('\n=== TESTING MOUSE.WHEEL on year column ===');
        console.log('Year column boundingBox:', yearCol.boundingBox);
        console.log('Current year value:', yearCol.indicatorText);
        console.log('First 5 items:', yearCol.items.slice(0, 5));
        console.log('Last 5 items:', yearCol.items.slice(-5));

        // Try scrolling up (toward older years)
        const { x, y, w, h } = yearCol.boundingBox;
        const cx = x + w / 2, cy = y + h / 2;
        await page.mouse.move(cx, cy);
        for (let i = 0; i < 3; i++) {
          await page.mouse.wheel(0, -200);
          await page.waitForTimeout(500);
        }
        const afterScroll = await page.evaluate(() => {
          const cols = [...document.querySelectorAll('.rmc-picker')].filter(e => e.offsetParent !== null);
          if (!cols[0]) return 'no cols';
          const sel = cols[0].querySelector('.rmc-picker-item-selected');
          return sel ? sel.innerText.trim() : 'no selected';
        });
        console.log('Year after 3 scroll-up (-200px each):', afterScroll);
      }
    }

    // === PROBE 4: tab email ===
    console.log('\n=== PROBING EMAIL TAB ===');
    const tabEmail = await page.locator('text=/^Email$/').count();
    const tabPhone = await page.locator('text=/^Telepon$/').count();
    console.log('Tab "Email":', tabEmail, ' | "Telepon":', tabPhone);
    const tabDetails = await page.evaluate(() => {
      return [...document.querySelectorAll('div,span')]
        .filter(el => el.innerText && /^Email$|^Telepon$/.test(el.innerText.trim()))
        .slice(0, 10)
        .map(el => ({
          text: el.innerText.trim(),
          tag: el.tagName,
          role: el.getAttribute('role'),
          ariaLabel: el.getAttribute('aria-label'),
          html: el.outerHTML.slice(0, 200),
          visible: el.offsetParent !== null,
        }));
    }).catch(() => []);
    console.log('Exact tab details:', JSON.stringify(tabDetails, null, 2));

    // === PROBE 5: full body HTML sample ===
    console.log('\n=== BODY SAMPLE ===');
    const bodySample = await page.evaluate(() => {
      return document.body.innerHTML.slice(0, 3000);
    }).catch(() => '');
    console.log(bodySample);

    await page.waitForTimeout(2000);
    await page.screenshot({ path: 'probe-birthday.png', fullPage: false });
    console.log('\n[Screenshot: probe-birthday.png]');
    await browser.close();
    console.log('DONE');
  } catch (e) {
    console.error('ERROR:', e.message);
    if (browser) { await page.screenshot({ path: 'probe-error.png' }).catch(() => {}); await browser.close().catch(() => {}); }
  }
})();