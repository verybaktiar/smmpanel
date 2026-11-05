'use strict';

/**
 * Debug TikTok signup (mobile ID) — petakan UI setelah klik landing.
 * TIDAK submit apa pun: buka halaman, klik "Gunakan nomor telepon atau email",
 * dump teks/tombol/input, cari opsi email, dump lagi. Screenshot tiap tahap.
 * Run: node debug-tt-signup.js [proxy]
 */
require('dotenv').config();
const { chromium } = require('playwright');
const PROXY_ARG = process.argv.slice(2)[0] || null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const launchOptions = {
    headless: false,
    args: ['--disable-blink-features=AutomationControlled', '--disable-dev-shm-usage', '--no-sandbox'],
  };
  if (PROXY_ARG) {
    const p = PROXY_ARG.split(':');
    launchOptions.proxy = { server: `http://${p[0]}:${p[1]}` };
    if (p[2]) { launchOptions.proxy.username = p[2]; launchOptions.proxy.password = p[3] || ''; }
  }
  const browser = await chromium.launch(launchOptions);
  const context = await browser.newContext({
    viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true,
    deviceScaleFactor: 2, locale: 'id-ID', timezoneId: 'Asia/Jakarta',
    userAgent: 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
  });
  await context.addInitScript(() => { Object.defineProperty(navigator, 'webdriver', { get: () => undefined }); });
  const page = await context.newPage();

  const dump = async (label) => {
    const info = await page.evaluate(() => {
      const txt = (el) => (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 80);
      const buttons = [...document.querySelectorAll('button, [role="button"], div[tabindex], a')]
        .filter((el) => el.offsetParent !== null && txt(el))
        .slice(0, 40)
        .map((el) => ({ tag: el.tagName.toLowerCase(), role: el.getAttribute('role') || '', txt: txt(el) }));
      const inputs = [...document.querySelectorAll('input')]
        .map((el) => ({ type: el.type, name: el.name || '', ph: el.placeholder || '', visible: el.offsetParent !== null }));
      const combos = [...document.querySelectorAll('[role="combobox"]')].map((el) => ({ label: el.getAttribute('aria-label') || '', txt: txt(el), visible: el.offsetParent !== null }));
      return { url: location.href, text: (document.body ? document.body.innerText : '').slice(0, 900), buttons, inputs, combos };
    }).catch((e) => ({ err: e.message }));
    console.log(`\n===== ${label} =====`);
    console.log('URL:', info.url || '-');
    console.log('TEXT:', String(info.text || '').replace(/\n+/g, ' | ').slice(0, 500));
    console.log('INPUTS:', JSON.stringify(info.inputs || []));
    console.log('COMBOS:', JSON.stringify(info.combos || []));
    console.log('BUTTONS:', JSON.stringify((info.buttons || []).slice(0, 25)));
    return info;
  };

  try {
    await page.goto('https://www.tiktok.com/signup', { timeout: 90000, waitUntil: 'domcontentloaded' });
    await sleep(6000);
    await dump('LOAD');
    for (const name of [/decline/i, /reject/i, /necessary only/i, /tolak/i]) {
      const b = page.getByRole('button', { name }).first();
      if ((await b.count()) > 0) { await b.click().catch(() => {}); await sleep(1500); break; }
    }
    for (const t of ['Nanti saja', 'Not now', 'Later', 'Skip']) {
      const el = page.getByText(t, { exact: false }).first();
      if ((await el.count()) > 0) { await el.click({ timeout: 4000 }).catch(() => {}); await sleep(1500); break; }
    }
    await page.screenshot({ path: 'debug-tt-1-landing.png' });

    // Klik tombol landing — coba via <button>/[role=button] BERTINGKAT dulu (bukan text= polos)
    const clicked = await page.evaluate(() => {
      const want = /gunakan nomor telepon atau email|use phone or email/i;
      const els = [...document.querySelectorAll('button, [role="button"], div[tabindex], a, p, span, div')];
      const el = els.find((e) => e.offsetParent !== null && want.test((e.innerText || '').trim()) && (e.children.length === 0 || e.tagName === 'BUTTON' || e.getAttribute('role') === 'button'));
      if (el) { const r = el.getBoundingClientRect(); return { tag: el.tagName, role: el.getAttribute('role') || '', txt: (el.innerText || '').slice(0, 60), rect: { x: r.x, y: r.y, w: r.width, h: r.height } }; }
      return null;
    });
    console.log('\nTARGET landing:', JSON.stringify(clicked));
    if (clicked) {
      // Tap via koordinat (mobile) — paling mirit interaksi asli
      await page.touchscreen.tap(clicked.rect.x + clicked.rect.w / 2, clicked.rect.y + clicked.rect.h / 2).catch(() => {});
      await sleep(4000);
      await dump('AFTER-LANDING-TAP');
      await page.screenshot({ path: 'debug-tt-2-after-landing.png' });
    }

    // Cari & klik opsi apa pun yang mengandung "email"
    const emailOpt = await page.evaluate(() => {
      const els = [...document.querySelectorAll('button, [role="button"], a, p, span, div')];
      const el = els.find((e) => e.offsetParent !== null && /email/i.test((e.innerText || '').trim()) && (e.innerText || '').trim().length < 60 && e.children.length <= 2);
      if (el) { const r = el.getBoundingClientRect(); return { tag: el.tagName, txt: (el.innerText || '').trim().slice(0, 60), rect: { x: r.x, y: r.y, w: r.width, h: r.height } }; }
      return null;
    });
    console.log('\nOPSI email:', JSON.stringify(emailOpt));
    if (emailOpt) {
      await page.touchscreen.tap(emailOpt.rect.x + emailOpt.rect.w / 2, emailOpt.rect.y + emailOpt.rect.h / 2).catch(() => {});
      await sleep(4000);
      await dump('AFTER-EMAIL-OPTION');
      await page.screenshot({ path: 'debug-tt-3-after-email.png' });
    }

    // ===== Tahap age-gate: struktur wheel tanggal lahir =====
    const gate = await page.evaluate(() => ({
      url: location.href,
      rmcCount: document.querySelectorAll('.rmc-picker').length,
      rmcVisible: [...document.querySelectorAll('.rmc-picker')].filter((e) => e.offsetParent !== null).length,
      selClasses: [...document.querySelectorAll('[class*="select"], [class*="Select"], [class*="active"], [class*="item"]')]
        .filter((e) => e.offsetParent !== null).slice(0, 12)
        .map((e) => ({ cls: String(e.className).slice(0, 90), txt: (e.innerText || '').trim().slice(0, 12) })),
      colSample: [...document.querySelectorAll('[class*="picker"], [class*="column"], [class*="col-"]')]
        .filter((e) => e.offsetParent !== null).slice(0, 8)
        .map((e) => ({ cls: String(e.className).slice(0, 90), childCount: e.children.length, firstTxt: e.children[0] ? (e.children[0].innerText || '').trim().slice(0, 10) : '' })),
    })).catch((e) => ({ err: e.message }));
    console.log('\nAGE-GATE:', JSON.stringify(gate, null, 1));

    // (blok fill input "Tanggal Lahir" dibuang — terbukti tidak berpengaruh ke wheel)

    // ===== Bukti set wheel: 8 Juli 1998 — scrollTop programatik + baca item dekat indikator =====
    if (page.url().includes('age-gate')) {
      const readSel = (i) => page.evaluate((i) => {
        const pickers = [...document.querySelectorAll('.rmc-picker')].filter((e) => e.offsetParent !== null);
        const col = pickers[i]; if (!col) return '';
        const ind = col.querySelector('.rmc-picker-indicator');
        const items = [...col.querySelectorAll('.rmc-picker-item')];
        if (!ind || !items.length) return '';
        const ir = ind.getBoundingClientRect(); const ic = ir.top + ir.height / 2;
        let best = null, bd = 1e9;
        for (const it of items) { const r = it.getBoundingClientRect(); const c = r.top + r.height / 2; const d = Math.abs(c - ic); if (d < bd) { bd = d; best = it; } }
        return best ? (best.innerText || '').trim() : '';
      }, i);
      const setCol = (i, idx) => page.evaluate(({ i, idx }) => {
        const pickers = [...document.querySelectorAll('.rmc-picker')].filter((e) => e.offsetParent !== null);
        const col = pickers[i]; if (!col) return false;
        const items = [...col.querySelectorAll('.rmc-picker-item')];
        const el = items[idx]; if (!el) return false;
        const target = el.offsetTop - (col.clientHeight - el.clientHeight) / 2;
        col.scrollTop = target;
        col.dispatchEvent(new Event('scroll', { bubbles: true }));
        return true;
      }, { i, idx });
      const MONTHS = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
      const ORDER = [null, MONTHS, null];
      const TARGET = ['1998', 'Juli', '8'];
      // Tinggi 1 item wheel (untuk dy flick presisi)
      const itemH = await page.evaluate(() => {
        const col = [...document.querySelectorAll('.rmc-picker')].filter((e) => e.offsetParent !== null)[0];
        const it = col && col.querySelector('.rmc-picker-item');
        return it ? it.getBoundingClientRect().height : 42;
      });
      console.log('Tinggi item wheel:', itemH);
      // Flick touch asli: dy = selisih item x tinggi item (positif = tarik turun)
      const flick = async (i, dy) => {
        const box = await page.locator('.rmc-picker:visible').nth(i).boundingBox().catch(() => null);
        if (!box) return;
        const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
        const cdp2 = await context.newCDPSession(page);
        await cdp2.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: cx, y: cy }] });
        for (let s = 1; s <= 6; s++) {
          await cdp2.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: cx, y: cy + (dy * s) / 6 }] });
          await sleep(35);
        }
        await cdp2.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await sleep(900);
      };
      for (let i = 0; i < 3; i++) {
        for (let k = 0; k < 10; k++) {
          const cur = await readSel(i);
          if (cur === TARGET[i]) break;
          const idxOf = (s) => (ORDER[i] ? ORDER[i].indexOf(s) : parseInt(s, 10));
          const a = idxOf(cur), b = idxOf(TARGET[i]);
          if (!isFinite(a) || !isFinite(b)) { console.log(`kolom ${i}: bacaan "${cur}" tak terpetakan`); break; }
          // posisi konten: index kecil di atas; menampilkan item lebih kecil = tarik turun (dy positif)
          const dy = (a - b) * itemH;
          const step = Math.sign(dy) * Math.min(Math.abs(dy), itemH * 6);
          await flick(i, step);
          const now = await readSel(i);
          console.log(`kolom ${i} flick#${k}: "${cur}" -> "${now}" (dy=${step})`);
        }
      }
      console.log('Hasil bacaan akhir:', (await readSel(0)), '/', (await readSel(1)), '/', (await readSel(2)));
      const bdayVal = await page.locator('input[placeholder*="Tanggal" i]').first().inputValue().catch(() => '');
      console.log('Nilai input Tanggal Lahir:', JSON.stringify(bdayVal));
      await page.screenshot({ path: 'debug-tt-6-wheel-set.png' });
      const nextB2 = page.getByRole('button', { name: /berikutnya|next/i }).first();
      const dis2 = await nextB2.isDisabled().catch(() => true);
      console.log('Berikutnya disabled=', dis2);
      if (!dis2) {
        await nextB2.click().catch(() => {});
        await sleep(5000);
        await dump('AFTER-WHEEL-BERIKUTNYA');
        await page.screenshot({ path: 'debug-tt-7-after-wheel-next.png' });
        // Cari & klik opsi email di halaman berikutnya
        const em = await page.evaluate(() => {
          const els = [...document.querySelectorAll('button, [role="button"], a, p, span, div')];
          const el = els.find((e) => e.offsetParent !== null && /email/i.test((e.innerText || '').trim()) && (e.innerText || '').trim().length < 60);
          if (el) { const r = el.getBoundingClientRect(); return { tag: el.tagName, txt: (el.innerText || '').trim().slice(0, 60), rect: { x: r.x, y: r.y, w: r.width, h: r.height } }; }
          return null;
        });
        console.log('OPSI email di halaman baru:', JSON.stringify(em));
        // Klik tab "Email" EXACT (bukan container "Telepon\nEmail")
        const tabEmail = page.getByText('Email', { exact: true }).first();
        if ((await tabEmail.count()) > 0) {
          await tabEmail.click({ timeout: 5000 }).catch(() => {});
          await sleep(3000);
          await dump('AFTER-EMAIL-TAB-CLICK');
          await page.screenshot({ path: 'debug-tt-8-email-tab.png' });
        } else {
          console.log('Tab "Email" exact tidak ketemu');
        }
      }
    }
  } catch (e) {
    console.log('FATAL:', e.message);
  } finally {
    await browser.close().catch(() => {});
  }
})();
