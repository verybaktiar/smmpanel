/**
 * Debug script - inspect ALL form elements (including hidden ones)
 */

const { chromium } = require('playwright');

(async () => {
  console.log('🔍 Inspecting ALL form elements...\n');

  const browser = await chromium.launch({
    headless: false,
    args: ['--no-sandbox']
  });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
  });

  const page = await context.newPage();

  try {
    await page.goto('https://www.facebook.com/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);

    await page.locator('a:has-text("Create new account")').first().click();
    await page.waitForTimeout(3000);

    await page.waitForURL('**/reg/**', { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(2000);
    
    await page.evaluate(() => window.scrollBy(0, 300));
    await page.waitForTimeout(2000);
    
    // Get ALL elements dalam form - termasuk yang hidden
    const formElements = await page.evaluate(() => {
      const result = {
        allInputs: [],
        allSelects: [],
        allButtons: [],
        allLabels: [],
        birthdayRelated: []
      };
      
      // Semua inputs
      document.querySelectorAll('input').forEach((el, idx) => {
        const computed = window.getComputedStyle(el);
        result.allInputs.push({
          index: idx,
          type: el.type,
          name: el.name,
          id: el.id,
          value: el.value,
          placeholder: el.placeholder,
          ariaLabel: el.getAttribute('aria-label'),
          className: el.className.substring(0, 50),
          display: computed.display,
          visibility: computed.visibility,
          offsetParent: el.offsetParent !== null
        });
      });
      
      // Semua selects
      document.querySelectorAll('select').forEach((el, idx) => {
        const computed = window.getComputedStyle(el);
        result.allSelects.push({
          index: idx,
          name: el.name,
          id: el.id,
          ariaLabel: el.getAttribute('aria-label'),
          optionsCount: el.options.length,
          display: computed.display,
          visibility: computed.visibility
        });
      });
      
      // Buttons
      document.querySelectorAll('button').forEach((el, idx) => {
        if (idx < 10) { // Limit untuk tidak terlalu banyak
          result.allButtons.push({
            index: idx,
            text: el.textContent.substring(0, 30),
            type: el.type,
            name: el.name
          });
        }
      });
      
      // Labels yang mention birthday/date/age
      document.querySelectorAll('label, div[role="label"]').forEach((el) => {
        const text = el.textContent.toLowerCase();
        if (text.includes('birth') || text.includes('date') || text.includes('age') || 
            text.includes('day') || text.includes('month') || text.includes('year')) {
          result.birthdayRelated.push({
            tag: el.tagName,
            text: el.textContent.substring(0, 100),
            for: el.getAttribute('for'),
            id: el.id
          });
        }
      });
      
      // Cari elemen yang contain birthday text
      const allElements = document.querySelectorAll('*');
      allElements.forEach((el) => {
        const text = el.textContent;
        if ((text.includes('Birthday') || text.includes('Date of birth')) && 
            text.length < 200 && 
            el.children.length < 5) {
          const computed = window.getComputedStyle(el);
          result.birthdayRelated.push({
            tag: el.tagName,
            text: text.substring(0, 100),
            id: el.id,
            className: el.className.substring(0, 50),
            display: computed.display
          });
        }
      });
      
      return result;
    });
    
    console.log('=== ALL INPUTS ===');
    console.log(JSON.stringify(formElements.allInputs, null, 2));
    
    console.log('\n=== ALL SELECTS ===');
    console.log(JSON.stringify(formElements.allSelects, null, 2));
    
    console.log('\n=== BUTTONS ===');
    console.log(JSON.stringify(formElements.allButtons, null, 2));
    
    console.log('\n=== BIRTHDAY RELATED ===');
    console.log(JSON.stringify(formElements.birthdayRelated, null, 2));
    
    await page.screenshot({ path: './fb-all-elements.png', fullPage: true });
    console.log('\n📸 Screenshot: fb-all-elements.png');
    
    console.log('\n⏸️  Keeping browser open for 30 seconds...');
    await page.waitForTimeout(30000);

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await browser.close();
  }
})();
