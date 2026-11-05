/**
 * Debug script untuk melihat struktur HTML birthday field
 */

const { chromium } = require('playwright');
const fs = require('fs');

async function debugBirthdayStructure() {
  console.log('Launching browser...');
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();
  
  // Navigate ke Facebook
  await page.goto('https://www.facebook.com/');
  await page.waitForTimeout(3000);
  
  // Klik "Create new account"
  console.log('Clicking Create new account...');
  await page.click('a:has-text("Create new account")');
  await page.waitForTimeout(4000);
  
  // Tunggu form muncul
  await page.waitForURL('**/reg/**');
  await page.waitForTimeout(3000);
  
  // Dump semua HTML
  const fullHTML = await page.content();
  fs.writeFileSync('debug-full-page.html', fullHTML);
  console.log('Saved full page HTML to: debug-full-page.html');
  
  // Cari elemen birthday dengan berbagai cara
  const birthdayInfo = await page.evaluate(() => {
    const results = {
      allSelects: [],
      allInputs: [],
      birthdayContainer: null,
      elementsWithBirthText: []
    };
    
    // Cari semua select
    document.querySelectorAll('select').forEach((sel, idx) => {
      results.allSelects.push({
        index: idx,
        id: sel.id,
        name: sel.name,
        innerHTML: sel.innerHTML.substring(0, 200)
      });
    });
    
    // Cari semua input
    document.querySelectorAll('input').forEach((inp, idx) => {
      results.allInputs.push({
        index: idx,
        id: inp.id,
        name: inp.name,
        type: inp.type,
        placeholder: inp.placeholder
      });
    });
    
    // Cari elemen yang mengandung "birth" atau "Birthday"
    document.querySelectorAll('*').forEach(el => {
      const text = el.textContent || '';
      if ((text.includes('Date of birth') || text.includes('Birthday')) && el.children.length > 0) {
        results.elementsWithBirthText.push({
          tagName: el.tagName,
          id: el.id,
          className: el.className,
          innerHTML: el.innerHTML.substring(0, 500)
        });
      }
    });
    
    return results;
  });
  
  console.log('\n=== BIRTHDAY DEBUG INFO ===');
  console.log('Select elements found:', birthdayInfo.allSelects.length);
  console.log('Input elements found:', birthdayInfo.allInputs.length);
  console.log('Elements with birth text:', birthdayInfo.elementsWithBirthText.length);
  
  fs.writeFileSync('debug-birthday-info.json', JSON.stringify(birthdayInfo, null, 2));
  console.log('\nSaved birthday info to: debug-birthday-info.json');
  
  console.log('\n=== Press Enter to close browser ===');
  
  // Tunggu user input sebelum close
  await new Promise(resolve => {
    process.stdin.once('data', resolve);
  });
  
  await browser.close();
}

debugBirthdayStructure().catch(console.error);
