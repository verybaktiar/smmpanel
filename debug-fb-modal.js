/**
 * Debug apa yang terjadi setelah klik "Create new account"
 * Run: node debug-fb-modal.js
 */

const { chromium } = require('playwright');

async function debug() {
  console.log('🔍 Debugging Facebook modal after clicking Create Account...\n');

  const browser = await chromium.launch({
    headless: false,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--disable-dev-shm-usage',
      '--no-sandbox'
    ]
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

  console.log('Loading Facebook homepage...');
  await page.goto('https://www.facebook.com/', {
    waitUntil: 'domcontentloaded',
    timeout: 30000
  });

  await page.waitForTimeout(3000);
  console.log('Current URL:', page.url());

  console.log('\nClicking "Create new account" button...');
  await page.click('a:has-text("Create new account")');

  console.log('Waiting 5 seconds for modal/form to appear...');
  await page.waitForTimeout(5000);

  console.log('\nCurrent URL after click:', page.url());

  // Check for modal/dialog
  console.log('\n--- Checking for modal/dialog ---');
  const modals = await page.$$('[role="dialog"], [role="presentation"], .modal, [aria-modal="true"]');
  console.log(`Found ${modals.length} modal elements`);

  if (modals.length > 0) {
    console.log('\nModal found! Checking for input fields inside modal...');
    for (let i = 0; i < modals.length; i++) {
      const modal = modals[i];
      const inputs = await modal.$$('input');
      console.log(`\nModal ${i + 1} has ${inputs.length} input fields:`);
      
      for (let j = 0; j < Math.min(inputs.length, 10); j++) {
        const input = inputs[j];
        const info = await input.evaluate(el => ({
          type: el.type,
          name: el.name,
          id: el.id,
          placeholder: el.placeholder,
          ariaLabel: el.getAttribute('aria-label')
        }));
        console.log(`  ${j + 1}.`, JSON.stringify(info, null, 2));
      }
    }
  }

  // Check all inputs on page after click
  console.log('\n--- All input fields after click ---');
  const allInputs = await page.$$('input');
  console.log(`Found ${allInputs.length} total input elements\n`);

  for (let i = 0; i < Math.min(allInputs.length, 15); i++) {
    const input = allInputs[i];
    const info = await input.evaluate(el => ({
      type: el.type,
      name: el.name,
      id: el.id,
      placeholder: el.placeholder,
      ariaLabel: el.getAttribute('aria-label'),
      visible: el.offsetParent !== null
    }));
    console.log(`${i + 1}.`, JSON.stringify(info, null, 2));
  }

  // Take screenshot
  console.log('\nTaking screenshot...');
  await page.screenshot({ path: './fb-after-click.png', fullPage: true });
  console.log('Screenshot saved: fb-after-click.png');

  console.log('\n✅ Debug complete. Browser tetap terbuka untuk inspeksi.');
  console.log('Cek browser untuk melihat apa yang tampil setelah klik button.');
  console.log('Press Ctrl+C to close.\n');

  await new Promise(() => {});
}

debug().catch(console.error);
