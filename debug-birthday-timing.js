/**
 * Debug timing - cek kapan birthday input muncul
 */

const { chromium } = require('playwright');

(async () => {
  console.log('🔍 Debugging birthday input timing...\n');

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
    console.log('📍 Navigate to Facebook...');
    await page.goto('https://www.facebook.com/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);

    console.log('🖱️  Click Create new account...');
    await page.locator('a:has-text("Create new account")').first().click();
    await page.waitForTimeout(3000);

    console.log('⏳ Wait for /reg/ page...\n');
    await page.waitForURL('**/reg/**', { timeout: 10000 }).catch(() => {});
    
    // Deteksi inputs seperti di test
    const textInputs = await page.$$('input[type="text"]');
    console.log(`✅ Found ${textInputs.length} text inputs\n`);
    
    // Scroll seperti di kode asli
    console.log('📜 Scrolling down...');
    await page.evaluate(() => window.scrollBy(0, 300));
    await page.waitForTimeout(2000);
    
    // Cek birthday input setiap 500ms selama 20 detik
    console.log('🔄 Checking for birthday input every 500ms...\n');
    
    for (let i = 0; i < 40; i++) {
      const elapsed = (i * 500) / 1000;
      
      // Cek semua varian selector
      const checks = await page.evaluate(() => {
        return {
          byDateAndName: document.querySelector('input[type="date"][name="birthday"]') !== null,
          byDate: document.querySelector('input[type="date"]') !== null,
          byName: document.querySelector('input[name="birthday"]') !== null,
          allInputs: document.querySelectorAll('input').length,
          visibleDateInputs: Array.from(document.querySelectorAll('input[type="date"]'))
            .filter(el => {
              const style = window.getComputedStyle(el);
              return style.display !== 'none' && style.visibility !== 'hidden';
            }).length
        };
      });
      
      console.log(`[${elapsed}s] date+name:${checks.byDateAndName} | date:${checks.byDate} | name:${checks.byName} | total inputs:${checks.allInputs} | visible date:${checks.visibleDateInputs}`);
      
      if (checks.byDateAndName || checks.byDate) {
        console.log(`\n✅ FOUND at ${elapsed} seconds!`);
        
        // Detail info
        const details = await page.evaluate(() => {
          const input = document.querySelector('input[type="date"]');
          if (!input) return null;
          
          const style = window.getComputedStyle(input);
          return {
            type: input.type,
            name: input.name,
            id: input.id,
            value: input.value,
            display: style.display,
            visibility: style.visibility,
            opacity: style.opacity,
            offsetParent: input.offsetParent !== null,
            boundingBox: input.getBoundingClientRect()
          };
        });
        console.log('Input details:', JSON.stringify(details, null, 2));
        break;
      }
      
      await page.waitForTimeout(500);
    }
    
    await page.screenshot({ path: './fb-birthday-timing.png', fullPage: true });
    console.log('\n📸 Screenshot: fb-birthday-timing.png');
    
    console.log('\n⏸️  Keeping browser open for 20 seconds...');
    await page.waitForTimeout(20000);

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await browser.close();
  }
})();
