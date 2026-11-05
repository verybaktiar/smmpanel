const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
  console.log('Launching browser...');
  const browser = await chromium.launch({ 
    headless: false,
    args: ['--start-maximized']
  });
  
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1366, height: 768 });

  try {
    await page.goto('https://www.facebook.com', { waitUntil: 'networkidle' });
    
    console.log('Clicking Create new account...');
    await page.click('a:has-text("Create new account")');
    await page.waitForTimeout(3000);
    
    console.log('Clicking Date of birth field...');
    const birthdaySpan = page.locator('span:has-text("Date of birth")').first();
    await birthdaySpan.click();
    await page.waitForTimeout(2000);
    
    // Ambil detail combobox
    const comboboxDetails = await page.evaluate(() => {
      const comboboxes = document.querySelectorAll('div[role="combobox"]');
      const details = [];
      
      comboboxes.forEach((combo, idx) => {
        const rect = combo.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          details.push({
            index: idx,
            id: combo.id,
            text: combo.textContent.trim().substring(0, 100),
            ariaLabel: combo.getAttribute('aria-label'),
            ariaExpanded: combo.getAttribute('aria-expanded'),
            children: combo.children.length,
            firstChildTag: combo.children[0]?.tagName,
            firstChildText: combo.children[0]?.textContent.trim().substring(0, 50)
          });
        }
      });
      
      return details;
    });
    
    console.log('\n=== COMBOBOX DETAILS ===');
    console.log(JSON.stringify(comboboxDetails, null, 2));
    
    // Coba klik combobox pertama dan lihat apa yang muncul
    console.log('\n=== Testing first combobox click ===');
    const firstCombo = page.locator('div[role="combobox"]').first();
    await firstCombo.click();
    await page.waitForTimeout(1500);
    
    // Lihat apa yang muncul setelah klik
    const afterComboClick = await page.evaluate(() => {
      // Cek listbox atau menu
      const listboxes = document.querySelectorAll('div[role="listbox"], ul[role="listbox"]');
      const options = document.querySelectorAll('div[role="option"], li[role="option"]');
      
      const info = {
        listboxCount: listboxes.length,
        optionCount: options.length,
        options: []
      };
      
      options.forEach((opt, idx) => {
        if (idx < 15) { // First 15 options
          info.options.push({
            index: idx,
            text: opt.textContent.trim(),
            ariaSelected: opt.getAttribute('aria-selected'),
            dataValue: opt.getAttribute('data-value') || opt.getAttribute('value')
          });
        }
      });
      
      return info;
    });
    
    console.log('\n=== AFTER COMBOBOX CLICK ===');
    console.log('Listboxes:', afterComboClick.listboxCount);
    console.log('Options:', afterComboClick.optionCount);
    console.log('First 15 options:', JSON.stringify(afterComboClick.options, null, 2));
    
    // Save all info
    const allInfo = {
      comboboxDetails,
      afterComboClick
    };
    
    fs.writeFileSync(
      'debug-combobox-details.json',
      JSON.stringify(allInfo, null, 2)
    );
    console.log('\nSaved to: debug-combobox-details.json');
    
    await page.screenshot({ path: 'debug-combobox-open.png' });
    console.log('Screenshot: debug-combobox-open.png');
    
    console.log('\n=== Press Enter to close ===');
    await new Promise(resolve => process.stdin.once('data', resolve));
    
  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await browser.close();
  }
})();
