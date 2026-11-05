#!/usr/bin/env node
'use strict';

// Quick test script untuk verify semua fitur baru
require('dotenv').config();

const http = require('http');

console.log('🧪 Testing SMM Panel Enhanced Features\n');

// Helper function untuk HTTP request
function request(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: process.env.PORT || 3000,
      path: path,
      method: method,
      headers: {
        'Content-Type': 'application/json',
      },
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, data: data });
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function runTests() {
  const tests = [];
  let passed = 0;
  let failed = 0;

  // Test 1: System Status
  tests.push(async () => {
    console.log('📊 Testing system status endpoint...');
    try {
      const res = await request('GET', '/api/system/status');
      if (res.status === 200 && res.data.uptime !== undefined) {
        console.log('✓ System status OK');
        console.log(`  Uptime: ${Math.floor(res.data.uptime)}s`);
        console.log(`  Running orders: ${res.data.orders?.running || 0}`);
        return true;
      } else {
        console.log('✗ System status failed');
        return false;
      }
    } catch (e) {
      console.log('✗ System status error:', e.message);
      return false;
    }
  });

  // Test 2: Queue Stats
  tests.push(async () => {
    console.log('\n📦 Testing queue stats endpoint...');
    try {
      const res = await request('GET', '/api/queue/stats');
      if (res.status === 200) {
        console.log('✓ Queue stats OK');
        console.log(`  Processed: ${res.data.processed}`);
        console.log(`  Failed: ${res.data.failed}`);
        return true;
      } else {
        console.log('✗ Queue stats failed');
        return false;
      }
    } catch (e) {
      console.log('✗ Queue stats error:', e.message);
      return false;
    }
  });

  // Test 3: WebSocket Status
  tests.push(async () => {
    console.log('\n🔌 Testing WebSocket status...');
    try {
      const res = await request('GET', '/api/websocket/status');
      if (res.status === 200 && res.data.enabled) {
        console.log('✓ WebSocket OK');
        console.log(`  Connected clients: ${res.data.connected}`);
        return true;
      } else {
        console.log('✗ WebSocket status failed');
        return false;
      }
    } catch (e) {
      console.log('✗ WebSocket error:', e.message);
      return false;
    }
  });

  // Test 4: Proxy Test (should work even without proxy)
  tests.push(async () => {
    console.log('\n🌐 Testing proxy validation...');
    try {
      const res = await request('POST', '/api/proxy/test', {
        proxy: 'invalid:1234'
      });
      if (res.status === 200) {
        console.log('✓ Proxy validator OK');
        console.log(`  Valid: ${res.data.valid}`);
        return true;
      } else {
        console.log('✗ Proxy test failed');
        return false;
      }
    } catch (e) {
      console.log('✗ Proxy test error:', e.message);
      return false;
    }
  });

  // Test 5: Database indexes
  tests.push(async () => {
    console.log('\n🗄️  Testing database indexes...');
    try {
      const db = require('./src/db');
      await db.load();
      const indexes = await db.rawAll(`SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%'`);
      if (indexes.length >= 8) {
        console.log('✓ Database indexes OK');
        console.log(`  Found ${indexes.length} indexes`);
        return true;
      } else {
        console.log('✗ Missing indexes');
        return false;
      }
    } catch (e) {
      console.log('✗ Database error:', e.message);
      return false;
    }
  });

  // Run all tests
  console.log('Starting tests...\n');
  console.log('='.repeat(50));
  
  for (const test of tests) {
    const result = await test();
    if (result) {
      passed++;
    } else {
      failed++;
    }
    await new Promise(resolve => setTimeout(resolve, 500)); // Small delay between tests
  }

  console.log('\n' + '='.repeat(50));
  console.log(`\n📈 Test Results: ${passed}/${tests.length} passed`);
  
  if (failed === 0) {
    console.log('✅ All tests passed!\n');
  } else {
    console.log(`❌ ${failed} test(s) failed\n`);
  }

  return failed === 0;
}

// Check if server is running
async function checkServer() {
  try {
    await request('GET', '/api/stats');
    return true;
  } catch (e) {
    return false;
  }
}

// Main
(async () => {
  console.log('Checking if server is running...');
  const isRunning = await checkServer();
  
  if (!isRunning) {
    console.log('\n⚠️  Server is not running!');
    console.log('Please start the server first:');
    console.log('  npm run server\n');
    process.exit(1);
  }

  console.log('✓ Server is running\n');
  
  const success = await runTests();
  process.exit(success ? 0 : 1);
})();
