/**
 * Quick test to see what Facebook signup page looks like
 * Run: node test-fb-page.js
 */

const { chromium } = require('playwright');

async function test() {
  console.log('Launching browser...');
  
  const browser = await chromium.launch({
    headless: false, // Show browser to see what happens
    args: [
      '--disable-blink-features=AutomationControlled',
      '--disable-dev-shm-usage',
      '--no-sandbox'
    ]
  });
  
  const context = await browser.newContext({
    viewport: { width: 1366, height: 768 },
    locale: 'en-US',
    timezoneId: 'America/New_York'
  });
  
  const page = await context.newPage();
  
  console.log('Navigating to Facebook signup...');
  await page.goto('https://www.facebook.com/reg', {
    waitUntil: 'networkidle',
    timeout: 30000
  });
  
  console.log('Taking screenshot...');
  await page.screenshot({ path: './automation/screenshots/fb-signup-page.png', fullPage: true });
  
  console.log('Current URL:', page.url());
  
  // Check what elements exist
  const hasFirstname = await page.$('input[name="firstname"]');
  const hasRegFirstname = await page.$('input[name="reg_firstname"]');
  const hasEmail = await page.$('input[name="reg_email__"]');
  
  console.log('Found input[name="firstname"]:', !!hasFirstname);
  console.log('Found input[name="reg_firstname"]:', !!hasRegFirstname);
  console.log('Found input[name="reg_email__"]:', !!hasEmail);
  
  // Get page title
  const title = await page.title();
  console.log('Page title:', title);
  
  console.log('\nScreenshot saved to: ./automation/screenshots/fb-signup-page.png');
  console.log('Press Ctrl+C to close browser');
  
  // Keep browser open for inspection
  await new Promise(() => {});
}

test().catch(console.error);
