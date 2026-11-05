/**
 * Debug script untuk melihat struktur birthday selectors di Facebook
 */

const { chromium } = require('playwright');

(async () => {
  console.log('🔍 Debugging Facebook birthday selectors...\n');

  const browser = await chromium.launch({
    headless: false,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });

  const page = await context.newPage();

  try {
    // Navigate to Facebook
    console.log('📍 Navigating to Facebook...');
    await page.goto('https://www.facebook.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);

    // Click "Create new account"
    console.log('🖱️  Clicking "Create new account"...');
    const createAccountBtn = await page.locator('a:has-text("Create new account"), a:has-text("Create New Account")').first();
    await createAccountBtn.click();
    await page.waitForTimeout(3000);

    // Wait for modal/form
    console.log('⏳ Waiting for signup form...\n');
    await page.waitForURL('**/reg/**', { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(2000);

    // Debug: Check all inputs
    console.log('=== ALL INPUT ELEMENTS ===');
    const allInputs = await page.$$eval('input', inputs => 
      inputs.map((el, idx) => ({
        index: idx,
        type: el.type,
        name: el.name,
        id: el.id,
        placeholder: el.placeholder,
        ariaLabel: el.getAttribute('aria-label')
      }))
    );
    console.log(JSON.stringify(allInputs, null, 2));

    // Debug: Check all select elements
    console.log('\n=== ALL SELECT ELEMENTS ===');
    const allSelects = await page.$$eval('select', selects => 
      selects.map((el, idx) => ({
        index: idx,
        name: el.name,
        id: el.id,
        title: el.title,
        ariaLabel: el.getAttribute('aria-label'),
        options: Array.from(el.options).slice(0, 3).map(opt => ({ value: opt.value, text: opt.text }))
      }))
    );
    console.log(JSON.stringify(allSelects, null, 2));

    // Debug: Check for birthday-related elements
    console.log('\n=== BIRTHDAY RELATED ELEMENTS ===');
    const birthdayElements = await page.evaluate(() => {
      const elements = [];
      
      // Check for any element with birthday in id/name/class
      document.querySelectorAll('[id*="birth"], [name*="birth"], [class*="birth"], [aria-label*="Birth"], [aria-label*="birth"]').forEach((el, idx) => {
        elements.push({
          index: idx,
          tagName: el.tagName,
          type: el.type,
          id: el.id,
          name: el.name,
          className: el.className,
          ariaLabel: el.getAttribute('aria-label')
        });
      });
      
      return elements;
    });
    console.log(JSON.stringify(birthdayElements, null, 2));

    // Debug: Check all visible selects (not hidden)
    console.log('\n=== VISIBLE SELECT ELEMENTS ===');
    const visibleSelects = await page.evaluate(() => {
      const selects = Array.from(document.querySelectorAll('select'));
      return selects
        .filter(el => {
          const style = window.getComputedStyle(el);
          return style.display !== 'none' && style.visibility !== 'hidden' && el.offsetParent !== null;
        })
        .map((el, idx) => ({
          index: idx,
          name: el.name,
          id: el.id,
          ariaLabel: el.getAttribute('aria-label'),
          title: el.title,
          optionsCount: el.options.length,
          firstOptions: Array.from(el.options).slice(0, 3).map(opt => ({ value: opt.value, text: opt.text }))
        }));
    });
    console.log(JSON.stringify(visibleSelects, null, 2));

    // Screenshot
    await page.screenshot({ path: './fb-birthday-debug.png', fullPage: true });
    console.log('\n📸 Screenshot saved: fb-birthday-debug.png');

    console.log('\n✅ Debug complete. Keeping browser open for 30 seconds...');
    await page.waitForTimeout(30000);

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await browser.close();
  }
})();
