'use strict';

// Account health checker untuk validasi akun FB/IG
// Mengecek apakah akun masih bisa login dan akses platform

const { openAccountBrowser } = require('./browser');
const db = require('./db');

// Bukti event ke account_events; non-fatal — hasil health check tetap dikembalikan.
async function recordFbHealthEvent(account, event, message, url) {
  try {
    await db.addAccountEvent({
      accountId: account && account.id, platform: 'fb',
      event, source: 'health_check', reason: message, url,
    });
  } catch (e) { /* riwayat non-fatal */ }
}

/**
 * Check Facebook account health
 * @param {object} account - Account data dengan password
 * @returns {object} Health check result
 */
async function checkFacebookHealth(account) {
  let context;
  try {
    const { context: ctx } = await openAccountBrowser(account, { headless: true });
    context = ctx;
    const page = await context.newPage();

    // Coba akses Facebook homepage
    await page.goto('https://www.facebook.com', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);

    const url = page.url();

    // Check apakah masih di login page (berarti session expired)
    if (url.includes('/login')) {
      return {
        healthy: false,
        status: 'session_expired',
        message: 'Session expired, need to re-login',
        needsRelogin: true,
      };
    }

    // Check apakah ada checkpoint/security check
    if (url.includes('checkpoint') || url.includes('security')) {
      await recordFbHealthEvent(account, 'checkpoint', 'Account has security checkpoint', url);
      return {
        healthy: false,
        status: 'checkpoint',
        message: 'Account has security checkpoint',
        needsRelogin: true,
      };
    }

    // Check apakah akun di-ban
    const bodyText = await page.textContent('body').catch(() => '');
    if (bodyText.includes('disabled') || bodyText.includes('suspended')) {
      await recordFbHealthEvent(account, 'suspended_or_disabled', 'Account appears to be disabled or suspended', url);
      return {
        healthy: false,
        status: 'banned',
        message: 'Account appears to be disabled or suspended',
        needsRelogin: false,
      };
    }

    // Akun sehat
    return {
      healthy: true,
      status: 'active',
      message: 'Account is healthy and accessible',
      needsRelogin: false,
    };

  } catch (error) {
    return {
      healthy: false,
      status: 'error',
      message: error.message,
      needsRelogin: false,
    };
  } finally {
    if (context) {
      await context.close().catch(() => {});
    }
  }
}

/**
 * Check Instagram account health
 * @param {object} account - Account data dengan password
 * @returns {object} Health check result
 */
async function checkInstagramHealth(account) {
  let context;
  try {
    const { context: ctx } = await openAccountBrowser(account, { headless: true });
    context = ctx;
    const page = await context.newPage();

    // Coba akses Instagram homepage
    await page.goto('https://www.instagram.com', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);

    const url = page.url();

    // Check apakah di redirect ke login
    if (url.includes('/accounts/login')) {
      return {
        healthy: false,
        status: 'session_expired',
        message: 'Session expired, need to re-login',
        needsRelogin: true,
      };
    }

    // Check apakah ada challenge
    if (url.includes('challenge')) {
      return {
        healthy: false,
        status: 'challenge',
        message: 'Account has security challenge',
        needsRelogin: true,
      };
    }

    // Akun sehat
    return {
      healthy: true,
      status: 'active',
      message: 'Account is healthy and accessible',
      needsRelogin: false,
    };

  } catch (error) {
    return {
      healthy: false,
      status: 'error',
      message: error.message,
      needsRelogin: false,
    };
  } finally {
    if (context) {
      await context.close().catch(() => {});
    }
  }
}

/**
 * Check single account health berdasarkan platform
 * @param {number} accountId - Account ID
 * @returns {object} Health check result dengan account info
 */
async function checkAccountHealth(accountId) {
  try {
    const account = await db.getAccountById(accountId);
    if (!account) {
      return {
        accountId,
        error: 'Account not found',
      };
    }

    // Decrypt password
    const decrypted = require('./crypto').decrypt(account.password_enc);
    const accountWithPassword = { ...account, password: decrypted };

    console.log(`  [health-check] Checking account ${account.name} (${account.platform})`);

    let result;
    if (account.platform === 'ig') {
      result = await checkInstagramHealth(accountWithPassword);
    } else {
      result = await checkFacebookHealth(accountWithPassword);
    }

    // Update account status di database
    const newStatus = result.healthy ? 'active' : 'inactive';
    await db.setAccountStatus(accountId, newStatus);

    return {
      accountId,
      accountName: account.name,
      platform: account.platform,
      ...result,
      checkedAt: new Date().toISOString(),
    };

  } catch (error) {
    console.error(`  [health-check] Error checking account ${accountId}:`, error.message);
    return {
      accountId,
      healthy: false,
      status: 'error',
      message: error.message,
    };
  }
}

/**
 * Check all accounts health
 * @returns {array} Array of health check results
 */
async function checkAllAccountsHealth() {
  try {
    const accounts = await db.listAccounts();
    console.log(`  [health-check] Checking ${accounts.length} accounts...`);

    const results = [];
    
    // Check sequentially untuk avoid overwhelming system
    for (const account of accounts) {
      const result = await checkAccountHealth(account.id);
      results.push(result);
      
      // Small delay antar checks
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    const summary = {
      total: results.length,
      healthy: results.filter(r => r.healthy).length,
      unhealthy: results.filter(r => !r.healthy).length,
      needsRelogin: results.filter(r => r.needsRelogin).length,
    };

    console.log(`  [health-check] Summary: ${summary.healthy} healthy, ${summary.unhealthy} unhealthy, ${summary.needsRelogin} needs re-login`);

    return {
      summary,
      results,
      checkedAt: new Date().toISOString(),
    };

  } catch (error) {
    console.error(`  [health-check] Error in checkAllAccountsHealth:`, error.message);
    throw error;
  }
}

module.exports = {
  checkAccountHealth,
  checkAllAccountsHealth,
  checkFacebookHealth,
  checkInstagramHealth,
};
