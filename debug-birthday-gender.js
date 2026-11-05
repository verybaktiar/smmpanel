/**
 * Debug birthday dan gender elements
 * Run: node debug-birthday-gender.js
 */

const { chromium } = require('playwright');

async function debug() {
  console.log('🔍 Debugging birthday and gender fields...\n');

  const browser = await chromium.launch({
    headless: false,
    args: ['--disable-blink-features=AutomationControlled', '--no-sandbox']
  });

  const context = await browser.newContext({
    viewport: { width: 1366, height: 768 },
    locale: 'en-US',
    timezoneId: 'America/New_York',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });

  const page = await context.newPage();
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    window.chrome = { runtime: {} };
  });

  console.log('Loading Facebook...');
  await page.goto('https://www.facebook.com/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);

  console.log('Clicking Create new account...');
  await page.click('a:has-text("Create new account")');
  await page.waitForTimeout(5000);

  console.log('\n--- Birthday Select Elements ---\n');
  const allSelects = await page.$$('select');
  console.log(`Found ${allSelects.length} select elements\n`);

  for (let i = 0; i < allSelects.length; i++) {
    const select = allSelects[i];
    const info = await select.evaluate(el => ({
      name: el.name,
      id: el.id,
      ariaLabel: el.getAttribute('aria-label'),
      title: el.title,
      optionsCount: el.options.length,
      firstOptions: Array.from(el.options).slice(0, 5).map(o => o.value)
    }));
    console.log(`${i + 1}.`, JSON.stringify(info, null, 2));
  }

  console.log('\n--- Gender Radio/Input Elements ---\n');
  const radioInputs = await page.$$('input[type="radio"], input[name*="sex"], input[name*="gender"]');
  console.log(`Found ${radioInputs.length} radio/gender inputs\n`);

  for (let i = 0; i < radioInputs.length; i++) {
    const input = radioInputs[i];
    const info = await input.evaluate(el => ({
      type: el.type,
      name: el.name,
      id: el.id,
      value: el.value,
      ariaLabel: el.getAttribute('aria-label'),
      visible: el.offsetParent !== null
    }));
    console.log(`${i + 1}.`, JSON.stringify(info, null, 2));
  }

  console.log('\n--- All DIV with role="button" (might be gender buttons) ---\n');
  const divButtons = await page.$$('div[role="button"]');
  console.log(`Found ${divButtons.length} div buttons\n`);

  for (let i = 0; i < Math.min(divButtons.length, 20); i++) {
    const div = divButtons[i];
    const info = await div.evaluate(el => ({
      text: el.textContent?.trim(),
      ariaLabel: el.getAttribute('aria-label'),
      dataType: el.getAttribute('data-type'),
      dataName: el.getAttribute('data-name'),
      visible: el.offsetParent !== null
    }));
    
    if (info.visible && info.text && info.text.length < 20) {
      console.log(`${i + 1}.`, JSON.stringify(info, null, 2));
    }
  }

  console.log('\n--- Labels that might be for gender ---\n');
  const labels = await page.$$('label');
  for (let i = 0; i < labels.length; i++) {
    const label = labels[i];
    const text = await label.textContent();
    if (text && (text.includes('Male') || text.includes('Female') || text.includes('Custom'))) {
      const info = await label.evaluate(el => ({
        text: el.textContent?.trim(),
        for: el.htmlFor,
        ariaLabel: el.getAttribute('aria-label')
      }));
      console.log(JSON.stringify(info, null, 2));
    }
  }

  console.log('\n--- Taking screenshot ---');
  await page.screenshot({ path: './fb-birthday-gender.png', fullPage: true });
  console.log('Screenshot: fb-birthday-gender.png');

  console.log('\n✅ Browser tetap terbuka untuk inspeksi manual.');
  console.log('Press Ctrl+C to close.\n');

  await new Promise(() => {});
}

debug().catch(console.error);
