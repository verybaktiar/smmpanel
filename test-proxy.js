'use strict';

const { chromium } = require('playwright');
const path = require('path');

// Test apakah proxy benar-benar digunakan
async function testProxy() {
  console.log('=== Testing Proxy Usage ===\n');
  
  // Test 1: Tanpa proxy - cek IP asli
  console.log('Test 1: Membuka browser TANPA proxy...');
  const contextNoProxy = await chromium.launchPersistentContext(
    path.join(__dirname, 'sessions', 'test-no-proxy'),
    {
      headless: false,
      viewport: { width: 1280, height: 720 }
    }
  );
  
  const pageNoProxy = await contextNoProxy.newPage();
  await pageNoProxy.goto('https://api.ipify.org?format=json', { timeout: 30000 });
  const ipNoProxy = await pageNoProxy.textContent('body');
  console.log('IP tanpa proxy:', ipNoProxy);
  await contextNoProxy.close();
  
  // Tunggu sebentar
  await new Promise(r => setTimeout(r, 2000));
  
  // Test 2: Dengan proxy - cek IP proxy
  console.log('\nTest 2: Membuka browser DENGAN proxy...');
  console.log('Masukkan proxy Anda dalam format: host:port:username:password');
  console.log('Atau host:port jika tanpa auth');
  console.log('Contoh: 123.45.67.89:8080:user:pass');
  console.log('\nSkip test ini jika tidak ada proxy (tekan Ctrl+C)\n');
  
  // Untuk testing manual, hardcode proxy di sini atau baca dari env
  const testProxyString = process.env.TEST_PROXY || null;
  
  if (!testProxyString) {
    console.log('⚠️  Tidak ada proxy untuk di-test.');
    console.log('Set environment variable TEST_PROXY untuk test proxy.');
    console.log('Contoh: SET TEST_PROXY=123.45.67.89:8080:user:pass');
    return;
  }
  
  const [host, port, username, password] = testProxyString.split(':');
  const proxyConfig = {
    server: `${host}:${port}`,
    username: username || undefined,
    password: password || undefined
  };
  
  console.log(`Menggunakan proxy: ${proxyConfig.server}`);
  if (proxyConfig.username) {
    console.log(`Dengan auth: ${proxyConfig.username}:***`);
  }
  
  const contextWithProxy = await chromium.launchPersistentContext(
    path.join(__dirname, 'sessions', 'test-with-proxy'),
    {
      headless: false,
      viewport: { width: 1280, height: 720 },
      proxy: proxyConfig
    }
  );
  
  const pageWithProxy = await contextWithProxy.newPage();
  
  try {
    await pageWithProxy.goto('https://api.ipify.org?format=json', { timeout: 30000 });
    const ipWithProxy = await pageWithProxy.textContent('body');
    console.log('IP dengan proxy:', ipWithProxy);
    
    // Parse dan compare
    const ipObjNoProxy = JSON.parse(ipNoProxy);
    const ipObjWithProxy = JSON.parse(ipWithProxy);
    
    console.log('\n=== Hasil ===');
    console.log(`IP asli: ${ipObjNoProxy.ip}`);
    console.log(`IP proxy: ${ipObjWithProxy.ip}`);
    
    if (ipObjNoProxy.ip === ipObjWithProxy.ip) {
      console.log('\n❌ PROXY TIDAK BERFUNGSI - IP sama!');
    } else {
      console.log('\n✅ PROXY BERFUNGSI - IP berbeda!');
    }
  } catch (err) {
    console.error('\n❌ Error saat menggunakan proxy:', err.message);
    console.log('\nKemungkinan masalah:');
    console.log('- Proxy tidak valid atau mati');
    console.log('- Username/password salah');
    console.log('- Proxy memblokir koneksi');
  } finally {
    await contextWithProxy.close();
  }
  
  console.log('\n=== Test Selesai ===');
}

// Tambahan: Test proxy dari database
async function testProxyFromAccount() {
  console.log('\n=== Testing Proxy from Account ===\n');
  
  const db = require('./src/db');
  await db.waitReady();
  
  // Ambil akun pertama yang punya proxy
  const accounts = await db.rawAll(`SELECT id, name, proxy FROM accounts WHERE proxy IS NOT NULL AND proxy != '' LIMIT 1`);
  
  if (accounts.length === 0) {
    console.log('⚠️  Tidak ada akun dengan proxy di database.');
    return;
  }
  
  const account = accounts[0];
  console.log(`Testing proxy untuk akun: ${account.name}`);
  console.log(`Proxy: ${account.proxy}`);
  
  const [host, port, username, password] = account.proxy.split(':');
  const proxyConfig = {
    server: `${host}:${port}`,
    username: username || undefined,
    password: password || undefined
  };
  
  const contextWithProxy = await chromium.launchPersistentContext(
    path.join(__dirname, 'sessions', `account-${account.id}`),
    {
      headless: false,
      viewport: { width: 1280, height: 720 },
      proxy: proxyConfig
    }
  );
  
  const page = await contextWithProxy.newPage();
  
  try {
    console.log('Checking IP via ipify.org...');
    await page.goto('https://api.ipify.org?format=json', { timeout: 30000 });
    const ipData = await page.textContent('body');
    const { ip } = JSON.parse(ipData);
    console.log(`✅ IP yang terdeteksi: ${ip}`);
    
    // Juga test ke situs lain untuk konfirmasi
    console.log('\nChecking IP via ifconfig.me...');
    await page.goto('https://ifconfig.me/ip', { timeout: 30000 });
    const ip2 = await page.textContent('body');
    console.log(`✅ IP konfirmasi: ${ip2.trim()}`);
    
    console.log('\n✅ Proxy berhasil digunakan!');
  } catch (err) {
    console.error(`❌ Error: ${err.message}`);
  } finally {
    await contextWithProxy.close();
  }
}

// Main
(async () => {
  const args = process.argv.slice(2);
  
  if (args.includes('--from-db')) {
    await testProxyFromAccount();
  } else {
    await testProxy();
  }
  
  process.exit(0);
})();
