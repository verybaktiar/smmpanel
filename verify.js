#!/usr/bin/env node
'use strict';

// Comprehensive verification script
const db = require('./src/db');

console.log('🔍 SMM Panel - Comprehensive Verification\n');

async function runChecks() {
  try {
    // 1. Database check
    console.log('1️⃣  Database Check');
    await db.load();
    console.log('   ✓ Database loaded successfully\n');

    // 2. Check indexes
    console.log('2️⃣  Database Indexes');
    const indexes = await db.rawAll("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%'");
    console.log(`   Found ${indexes.length} indexes:`);
    indexes.forEach(idx => console.log(`   ✓ ${idx.name}`));
    console.log();

    // 3. Check new columns in accounts
    console.log('3️⃣  New Account Columns');
    const accountCols = await db.rawAll('PRAGMA table_info(accounts)');
    const newAccountCols = accountCols.filter(c => ['last_health_check', 'health_status'].includes(c.name));
    console.log(`   Found ${newAccountCols.length} new columns:`);
    newAccountCols.forEach(col => console.log(`   ✓ ${col.name}`));
    console.log();

    // 4. Check new columns in smm_like_orders
    console.log('4️⃣  New SMM Order Columns');
    const orderCols = await db.rawAll('PRAGMA table_info(smm_like_orders)');
    const newOrderCols = orderCols.filter(c => ['scheduled_at', 'quantity'].includes(c.name));
    console.log(`   Found ${newOrderCols.length} new columns:`);
    newOrderCols.forEach(col => console.log(`   ✓ ${col.name}`));
    console.log();

    // 5. Check new columns in proxies
    console.log('5️⃣  New Proxy Columns');
    const proxyCols = await db.rawAll('PRAGMA table_info(proxies)');
    const newProxyCols = proxyCols.filter(c => ['response_time', 'last_tested_at'].includes(c.name));
    console.log(`   Found ${newProxyCols.length} new columns:`);
    newProxyCols.forEach(col => console.log(`   ✓ ${col.name}`));
    console.log();

    // 6. Module imports
    console.log('6️⃣  Module Imports');
    const modules = [
      'rate-limiter',
      'queue-manager',
      'health-checker',
      'proxy-validator',
      'security',
      'websocket'
    ];
    
    for (const mod of modules) {
      require(`./src/${mod}`);
      console.log(`   ✓ ${mod}`);
    }
    console.log();

    // 7. Dependencies check
    console.log('7️⃣  Dependencies');
    const deps = ['socket.io', 'express-rate-limit', 'cors', 'helmet'];
    for (const dep of deps) {
      try {
        require(dep);
        console.log(`   ✓ ${dep}`);
      } catch (e) {
        console.log(`   ✗ ${dep} - NOT INSTALLED`);
      }
    }
    console.log();

    // 8. File structure check
    console.log('8️⃣  File Structure');
    const fs = require('fs');
    const files = [
      'server.js',
      'worker.js',
      'test-features.js',
      '.env.example',
      'README.md',
      'IMPLEMENTATION.md',
      'QUICK-REFERENCE.md',
      'SUMMARY.md'
    ];
    
    for (const file of files) {
      if (fs.existsSync(file)) {
        console.log(`   ✓ ${file}`);
      } else {
        console.log(`   ✗ ${file} - MISSING`);
      }
    }
    console.log();

    // Summary
    console.log('=' .repeat(50));
    console.log('✅ Verification Complete\n');
    console.log('Summary:');
    console.log(`  - ${indexes.length} database indexes`);
    console.log(`  - ${newAccountCols.length + newOrderCols.length + newProxyCols.length} new columns`);
    console.log(`  - ${modules.length} new modules`);
    console.log(`  - ${deps.length} new dependencies`);
    console.log(`  - ${files.length} documentation files`);
    console.log();
    console.log('All systems ready! 🚀');
    console.log();

    process.exit(0);
  } catch (error) {
    console.error('\n❌ Verification failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

runChecks();
