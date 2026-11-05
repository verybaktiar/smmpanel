/**
 * Debug tombol submit setelah form diisi
 * Run: node debug-submit-button.js
 */

const { chromium } = require('playwright');

async function debug() {
  console.log('🔍 Debugging submit button on filled form...\n');

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

  console.log('Filling form with dummy data...');
  const inputs = await page.$$('input[type="text"]:visible');
  if (inputs[0]) await inputs[0].type('John');
  if (inputs[1]) await inputs[1].type('Doe');
  if (inputs[2]) await inputs[2].type('test@example.com');

  const passwordInput = await page.$('input[type="password"]:visible');
  if (passwordInput) await passwordInput.type('TestPass123!');

  await page.waitForTimeout(2000);

  console.log('\n--- All buttons after filling form ---\n');
  const allButtons = await page.$$('button, input[type="submit"], [role="button"]');
  console.log(`Found ${allButtons.length} clickable elements\n`);

  for (let i = 0; i < allButtons.length; i++) {
    const button = allButtons[i];
    const info = await button.evaluate(el => ({
      tag: el.tagName,
      type: el.type,
      name: el.name,
      id: el.id,
      text: el.textContent?.trim(),
      ariaLabel: el.getAttribute('aria-label'),
      dataTestId: el.getAttribute('data-testid'),
      visible: el.offsetParent !== null,
      disabled: el.disabled
    }));
    
    if (info.visible) {
      console.log(`${i + 1}. VISIBLE:`, JSON.stringify(info, null, 2));
    }
  }

  console.log('\n--- Taking screenshot ---');
  await page.screenshot({ path: './fb-filled-form.png', fullPage: true });
  console.log('Screenshot: fb-filled-form.png');

  console.log('\n✅ Browser tetap terbuka. Cek manually tombol mana yang harus diklik.');
  console.log('Press Ctrl+C to close.\n');

  await new Promise(() => {});
}

debug().catch(console.error);
