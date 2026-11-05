'use strict';
// PROBE DOM halaman birthday-gender signup Google — bedah struktur dropdown gender
// (satu kali jalan, dump, exit). Bukan creator.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { chromium } = require('patchright');
const browserUtil = require('./browser');

const PROXY_STR = browserUtil.stickyProxy('gw.dataimpulse.com:823:3075a7ad6bdec8af6597:c1c5eef4de4fbac0', 'gmail-auto1');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const proxyObj = browserUtil.parseProxy(PROXY_STR);
  const context = await chromium.launchPersistentContext(path.resolve('sessions/gmail-auto1'), {
    headless: false, proxy: proxyObj,
    args: ['--no-first-run', '--no-default-browser-check', '--no-sandbox', '--disable-dev-shm-usage', '--force-webrtc-ip-handling-policy=disable_non_proxied_udp'],
    locale: 'id-ID', timezoneId: 'Asia/Jakarta', ignoreHTTPSErrors: true
  });
  const page = await context.newPage();
  await page.goto('https://accounts.google.com/signup', { timeout: 60000, waitUntil: 'domcontentloaded' });
  await sleep(6000);

  // Isi nama (step 1) supaya sampai ke halaman dob.
  const f = page.locator('input[name="firstName"], #firstName').first();
  await f.click(); await f.fill('Budi'); await sleep(400);
  const l = page.locator('input[name="lastName"], #lastName').first();
  await l.click(); await l.fill('Santoso'); await sleep(600);
  await page.locator('button:has-text("Lanjutkan"), button:has-text("Berikutnya")').first().click().catch(() => {});
  await sleep(7000);
  console.log('URL:', page.url());

  // Dump SEMUA kontrol dropdown: select native & role=listbox.
  const ctrls = await page.evaluate(() => Array.from(document.querySelectorAll('select, [role="listbox"]')).map((el, i) => ({
    i,
    tag: el.tagName.toLowerCase(),
    role: el.getAttribute('role'),
    id: el.id || null,
    name: el.getAttribute('name'),
    aria: el.getAttribute('aria-label'),
    expanded: el.getAttribute('aria-expanded'),
    visible: !!el.offsetParent || (el.offsetWidth > 0 && el.offsetHeight > 0),
    cls: (el.className && String(el.className).slice(0, 90)) || null,
    lis: Array.from(el.querySelectorAll('li, [role="option"]')).slice(0, 6).map((li) => ({ role: li.getAttribute('role'), txt: (li.innerText || '').trim().slice(0, 30) })),
    html: el.outerHTML.slice(0, 400)
  })));
  fs.writeFileSync('logs/probe-dob-dom.json', JSON.stringify(ctrls, null, 1));
  console.log('=== KONTROL DROPDOWN → logs/probe-dob-dom.json ===');
  for (const c of ctrls) console.log(`i=${c.i} tag=${c.tag} aria="${c.aria}" id=${c.id} expanded=${c.expanded} visible=${c.visible} lis=${c.lis.length}`);

  // UJI 3 RESEP pilih gender (urutan opsi: Perempuan, Laki-laki, Kustom, Tidak ingin memberi tahu).
  const state = () => page.evaluate(() => {
    const gul = document.querySelector('ul[aria-label="Gender"]');
    const root = gul ? gul.closest('[jscontroller]') || gul.parentElement : null;
    const r = gul ? gul.getBoundingClientRect() : null;
    return { rootTxt: (root ? root.innerText : '').trim().slice(0, 40), rect: r ? { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } : null, disp: gul ? getComputedStyle(gul).display : null, vis: gul ? getComputedStyle(gul).visibility : null, lis: gul ? Array.from(gul.querySelectorAll('li')).map((x) => (x.innerText || '').trim().slice(0, 20)) : [] };
  });
  console.log('STATE AWAL:', JSON.stringify(await state()));

  // A) keyboard: focus ul → Enter (buka) → ArrowDown ×2 → Enter (commit)
  try {
    const gul = page.locator('ul[aria-label="Gender"]').first();
    await gul.focus();
    await page.keyboard.press('Enter'); await sleep(900);
    await page.keyboard.press('ArrowDown'); await sleep(350);
    await page.keyboard.press('ArrowDown'); await sleep(350);
    await page.keyboard.press('Enter'); await sleep(1200);
    console.log('RESEP A (keyboard):', JSON.stringify(await state()));
  } catch (e) { console.log('RESEP A gagal:', (e.message || '').split('\n')[0]); }

  // B) dispatch klik bubbling pada li (jsaction delegasi document)
  try {
    const lis = await page.evaluate(() => {
      const g = document.querySelector('ul[aria-label="Gender"]');
      if (!g) return [];
      const items = Array.from(g.querySelectorAll('li'));
      const t = items.find((x) => (x.innerText || '').includes('Laki-laki'));
      if (t) t.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
      return items.map((x) => (x.innerText || '').trim().slice(0, 20));
    });
    console.log('RESEP B (jsaction klik) li=', JSON.stringify(lis));
    await sleep(1200);
    console.log('STATE SETELAH B:', JSON.stringify(await state()));
  } catch (e) { console.log('RESEP B gagal:', (e.message || '').split('\n')[0]); }

  // Bukti akhir: isi hari/tahun → Lanjutkan → URL maju?
  const dayI = page.locator('input[name="day"], #day').first();
  await dayI.click(); await dayI.fill(''); await dayI.type('14', { delay: 80 });
  await sleep(400);
  const yrI = page.locator('input[name="year"], #year').first();
  await yrI.click(); await yrI.fill(''); await yrI.type('1994', { delay: 80 });
  await sleep(500);
  await page.locator('button:has-text("Lanjutkan"), button:has-text("Berikutnya")').first().click().catch(() => {});
  await sleep(7000);
  console.log('URL SETELAH LANJUTKAN:', page.url());
  await context.close().catch(() => {});
  process.exit(0);
})().catch((e) => { console.error('FATAL:', (e.message || '').split('\n')[0]); process.exit(1); });
/*
    console.log(`\n=== BUKA KANDIDAT i=${c.i} tag=${c.tag} aria="${c.aria}" visible=${c.visible} ===`);
    const loc = page.locator('[role="listbox"]').nth(c.i);
    try {
      await loc.click({ timeout: 4000 });
      await sleep(3000);
      const opts = await page.evaluate(() => Array.from(document.querySelectorAll('li, [role="option"]'))
        .filter((el) => el.offsetParent !== null)
        .map((el) => ({ role: el.getAttribute('role'), txt: (el.innerText || '').trim().slice(0, 40), cls: String(el.className).slice(0, 40) }))
        .filter((x) => x.txt));
      console.log('OPSI TERLIHAT:', JSON.stringify(opts.slice(0, 20)));
      // Coba pilih "Laki-laki" via li langsung di dalam menu Gender.
      const liAlt = page.locator('ul[aria-label="Gender"] li').filter({ hasText: 'Laki-laki' }).first();
      try { await liAlt.click({ timeout: 4000 }); console.log('KLIK LI OK'); await sleep(2000); } catch (e) { console.log('klik li gagal:', (e.message || '').split('\n')[0]); }
      const done = await page.evaluate(() => Array.from(document.querySelectorAll('[role="listbox"]')).map((el) => ({ aria: el.getAttribute('aria-label'), txt: (el.innerText || '').trim().slice(0, 30) })));
      console.log('LISTBOX SETELAH PILIH:', JSON.stringify(done));
      fs.writeFileSync('logs/probe-dob-after.json', JSON.stringify(done, null, 1));
      await page.keyboard.press('Escape').catch(() => {});
    } catch (e) { console.log('klik gagal:', (e.message || '').split('\n')[0]); }
    break; // cukup satu kandidat
  }
*/
