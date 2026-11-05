/**
 * Debug Facebook selectors - melihat selector apa yang tersedia
 * Run: node debug-fb-selectors.js
 */

const { chromium } = require('playwright');

async function debug() {
  console.log('🔍 Debugging Facebook signup selectors...\n');

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

  // Anti-detection
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
  console.log('Page title:', await page.title());
  console.log('\n--- Checking for signup form elements ---\n');

  // Check berbagai selector
  const selectors = {
    'Firstname input': [
      'input[name="firstname"]',
      'input[name="reg_firstname"]',
      'input[aria-label*="First name"]',
      'input[placeholder*="First name"]',
      'input[placeholder*="first name"]'
    ],
    'Lastname input': [
      'input[name="lastname"]',
      'input[name="reg_lastname"]',
      'input[aria-label*="Last name"]',
      'input[aria-label*="Surname"]'
    ],
    'Email input': [
      'input[name="reg_email__"]',
      'input[type="email"]',
      'input[aria-label*="email"]',
      'input[aria-label*="Email"]'
    ],
    'Password input': [
      'input[name="reg_passwd__"]',
      'input[type="password"]',
      'input[aria-label*="password"]'
    ],
    'Submit button': [
      'button[name="websubmit"]',
      'button[type="submit"]',
      'button:has-text("Sign Up")',
      '[data-testid*="registration"]'
    ],
    'Create Account button': [
      'a[data-testid="open-registration-form-button"]',
      'a:has-text("Create new account")',
      'a:has-text("Create New Account")',
      '[role="button"]:has-text("Create")'
    ]
  };

  for (const [label, selectorList] of Object.entries(selectors)) {
    console.log(`\n${label}:`);
    for (const selector of selectorList) {
      try {
        const element = await page.$(selector);
        if (element) {
          const tagName = await element.evaluate(el => el.tagName.toLowerCase());
          const attrs = await element.evaluate(el => {
            const result = {};
            for (const attr of el.attributes) {
              result[attr.name] = attr.value;
            }
            return result;
          });
          console.log(`  ✅ FOUND: ${selector}`);
          console.log(`     Tag: <${tagName}>`);
          console.log(`     Attributes:`, JSON.stringify(attrs, null, 6));
        } else {
          console.log(`  ❌ Not found: ${selector}`);
        }
      } catch (e) {
        console.log(`  ❌ Error checking: ${selector}`);
      }
    }
  }

  console.log('\n\n--- All input elements on page ---\n');
  const allInputs = await page.$$('input');
  console.log(`Found ${allInputs.length} input elements:`);
  
  for (let i = 0; i < Math.min(allInputs.length, 20); i++) {
    const input = allInputs[i];
    const info = await input.evaluate(el => ({
      type: el.type,
      name: el.name,
      id: el.id,
      placeholder: el.placeholder,
      ariaLabel: el.getAttribute('aria-label'),
      className: el.className
    }));
    console.log(`\n${i + 1}.`, JSON.stringify(info, null, 2));
  }

  console.log('\n\n--- All buttons on page ---\n');
  const allButtons = await page.$$('button, a[role="button"]');
  console.log(`Found ${allButtons.length} buttons:`);
  
  for (let i = 0; i < Math.min(allButtons.length, 15); i++) {
    const button = allButtons[i];
    const info = await button.evaluate(el => ({
      tag: el.tagName,
      type: el.type,
      name: el.name,
      text: el.textContent?.trim().substring(0, 50),
      dataTestId: el.getAttribute('data-testid'),
      className: el.className
    }));
    console.log(`\n${i + 1}.`, JSON.stringify(info, null, 2));
  }

  console.log('\n\n✅ Debug complete. Browser akan tetap terbuka untuk inspeksi manual.');
  console.log('Press Ctrl+C to close.\n');

  // Keep browser open
  await new Promise(() => {});
}

debug().catch(console.error);
