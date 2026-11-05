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
    // Navigate to Facebook
    await page.goto('https://www.facebook.com', { waitUntil: 'networkidle' });
    
    // Click "Create new account"
    console.log('Clicking Create new account...');
    await page.click('a:has-text("Create new account")');
    await page.waitForTimeout(3000);
    
    // Click "Date of birth" field
    console.log('Clicking Date of birth field...');
    const birthdaySpan = page.locator('span:has-text("Date of birth")').first();
    await birthdaySpan.click();
    
    console.log('Waiting 2 seconds for UI to appear...');
    await page.waitForTimeout(2000);
    
    // Sekarang ambil info tentang apa yang muncul
    const afterClickInfo = await page.evaluate(() => {
      const info = {
        allSelects: [],
        allInputs: [],
        allButtons: [],
        allDivWithRole: [],
        modalOrPopup: null
      };
      
      // Cek select elements
      const selects = document.querySelectorAll('select');
      selects.forEach((sel, idx) => {
        const rect = sel.getBoundingClientRect();
        info.allSelects.push({
          index: idx,
          id: sel.id,
          name: sel.name,
          visible: rect.width > 0 && rect.height > 0,
          optionsCount: sel.options.length,
          firstOptions: Array.from(sel.options).slice(0, 5).map(o => o.text)
        });
      });
      
      // Cek input elements yang muncul
      const inputs = document.querySelectorAll('input');
      inputs.forEach((inp, idx) => {
        const rect = inp.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          info.allInputs.push({
            index: idx,
            type: inp.type,
            id: inp.id,
            name: inp.name,
            placeholder: inp.placeholder,
            ariaLabel: inp.getAttribute('aria-label')
          });
        }
      });
      
      // Cek buttons
      const buttons = document.querySelectorAll('button, div[role="button"]');
      buttons.forEach((btn, idx) => {
        const rect = btn.getBoundingClientRect();
        const text = btn.textContent.trim();
        if (rect.width > 0 && rect.height > 0 && text.length > 0 && text.length < 50) {
          info.allButtons.push({
            index: idx,
            text: text,
            role: btn.getAttribute('role'),
            ariaLabel: btn.getAttribute('aria-label')
          });
        }
      });
      
      // Cek div dengan role
      const divsWithRole = document.querySelectorAll('div[role="listbox"], div[role="combobox"], div[role="menu"]');
      divsWithRole.forEach((div, idx) => {
        const rect = div.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          info.allDivWithRole.push({
            index: idx,
            role: div.getAttribute('role'),
            id: div.id,
            className: div.className,
            childrenCount: div.children.length
          });
        }
      });
      
      // Cek apakah ada modal/popup
      const modals = document.querySelectorAll('[role="dialog"], .modal, [class*="Modal"]');
      if (modals.length > 0) {
        const modal = modals[0];
        const rect = modal.getBoundingClientRect();
        info.modalOrPopup = {
          role: modal.getAttribute('role'),
          className: modal.className,
          visible: rect.width > 0 && rect.height > 0,
          innerHTML: modal.innerHTML.substring(0, 1000)
        };
      }
      
      return info;
    });
    
    console.log('\n=== AFTER CLICK INFO ===');
    console.log('Selects found:', afterClickInfo.allSelects.length);
    console.log('Visible inputs:', afterClickInfo.allInputs.length);
    console.log('Visible buttons:', afterClickInfo.allButtons.length);
    console.log('Divs with role:', afterClickInfo.allDivWithRole.length);
    console.log('Modal/Popup:', afterClickInfo.modalOrPopup ? 'YES' : 'NO');
    
    // Save to file
    fs.writeFileSync(
      'debug-after-click.json',
      JSON.stringify(afterClickInfo, null, 2)
    );
    console.log('\nSaved to: debug-after-click.json');
    
    // Take screenshot
    await page.screenshot({ path: 'debug-after-click.png', fullPage: false });
    console.log('Screenshot saved: debug-after-click.png');
    
    console.log('\n=== Press Enter to close browser ===');
    await new Promise(resolve => process.stdin.once('data', resolve));
    
  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await browser.close();
  }
})();
