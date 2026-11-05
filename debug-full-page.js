/**
 * Debug lengkap struktur halaman signup Facebook
 * Run: node debug-full-page.js
 */

const { chromium } = require('playwright');

async function debug() {
  console.log('🔍 Full page structure debug...\n');

  const browser = await chromium.launch({
    headless: false,
    args: ['--disable-blink-features=AutomationControlled', '--no-sandbox']
  });

  const context = await browser.newContext({
    viewport: { width: 1366, height: 768 },
    locale: 'en-US',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });

  const page = await context.newPage();
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    window.chrome = { runtime: {} };
  });

  await page.goto('https://www.facebook.com/');
  await page.waitForTimeout(3000);

  await page.click('a:has-text("Create new account")');
  await page.waitForTimeout(5000);

  console.log('Page loaded. Getting full DOM structure...\n');

  // Get HTML snapshot
  const html = await page.content();
  const fs = require('fs');
  fs.writeFileSync('./fb-page-source.html', html);
  console.log('✅ HTML saved to: fb-page-source.html\n');

  // Check for specific patterns
  console.log('--- Checking for common patterns ---\n');

  // Birthday related
  const bdayPatterns = ['birthday', 'birth', 'day', 'month', 'year', 'date of birth'];
  for (const pattern of bdayPatterns) {
    const count = (html.match(new RegExp(pattern, 'gi')) || []).length;
    if (count > 0) {
      console.log(`"${pattern}": ${count} occurrences`);
    }
  }

  console.log('\n--- Checking for gender patterns ---\n');
  const genderPatterns = ['gender', 'male', 'female', 'custom', 'sex'];
  for (const pattern of genderPatterns) {
    const count = (html.match(new RegExp(pattern, 'gi')) || []).length;
    if (count > 0) {
      console.log(`"${pattern}": ${count} occurrences`);
    }
  }

  await page.screenshot({ path: './fb-full-page.png', fullPage: true });
  console.log('\n✅ Screenshot: fb-full-page.png');
  console.log('\n📋 Check fb-page-source.html untuk melihat HTML lengkap');
  console.log('Browser tetap terbuka. Press Ctrl+C to close.\n');

  await new Promise(() => {});
}

debug().catch(console.error);
