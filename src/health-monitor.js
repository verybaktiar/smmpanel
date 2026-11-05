'use strict';

const db = require('./db');
const healthChecker = require('./health-checker');

async function runHealthCheck(accountId = null) {
  await db.load();
  
  const accounts = accountId 
    ? [await db.getAccountById(accountId)]
    : await db.listAccounts();
  
  const results = { healthy: 0, unhealthy: 0, errors: [] };
  
  for (const account of accounts.filter(Boolean)) {
    try {
      const check = await healthChecker.checkAccountHealth(account);
      
      await db.rawAll(`
        INSERT INTO health_check_history 
        (account_id, check_type, status, error_message, response_time)
        VALUES (?, 'full', ?, ?, ?)
      `, [account.id, check.healthy ? 'healthy' : 'unhealthy', check.error || null, check.responseTime || null]);
      
      if (check.healthy) {
        results.healthy++;
        await db.rawAll(`
          UPDATE accounts 
          SET health_status = 'healthy', last_health_check = datetime('now')
          WHERE id = ?
        `, [account.id]);
      } else {
        results.unhealthy++;
        results.errors.push({ account: account.name, error: check.error });
        await db.rawAll(`
          UPDATE accounts 
          SET health_status = 'unhealthy', last_health_check = datetime('now')
          WHERE id = ?
        `, [account.id]);
      }
    } catch (err) {
      results.unhealthy++;
      results.errors.push({ account: account.name, error: err.message });
    }
  }
  
  return results;
}

async function getHealthHistory(accountId, days = 7) {
  await db.load();
  
  return await db.rawAll(`
    SELECT 
      h.*,
      a.name as account_name,
      a.email as account_email
    FROM health_check_history h
    JOIN accounts a ON h.account_id = a.id
    WHERE h.account_id = ?
    AND datetime(h.checked_at) >= datetime('now', '-${days} days')
    ORDER BY h.checked_at DESC
    LIMIT 100
  `, [accountId]);
}

async function getHealthDashboard() {
  await db.load();
  
  const overview = await db.rawAll(`
    SELECT 
      COUNT(*) as total,
      COUNT(CASE WHEN health_status = 'healthy' THEN 1 END) as healthy,
      COUNT(CASE WHEN health_status = 'unhealthy' THEN 1 END) as unhealthy,
      COUNT(CASE WHEN health_status = 'unknown' THEN 1 END) as unknown,
      COUNT(CASE WHEN last_health_check IS NULL THEN 1 END) as never_checked,
      COUNT(CASE WHEN datetime(last_health_check) < datetime('now', '-24 hours') THEN 1 END) as stale
    FROM accounts
  `);
  
  const recentChecks = await db.rawAll(`
    SELECT 
      a.name,
      a.email,
      a.health_status,
      a.last_health_check,
      h.error_message
    FROM accounts a
    LEFT JOIN (
      SELECT account_id, error_message, 
             ROW_NUMBER() OVER (PARTITION BY account_id ORDER BY checked_at DESC) as rn
      FROM health_check_history
    ) h ON a.id = h.account_id AND h.rn = 1
    ORDER BY a.last_health_check DESC
    LIMIT 20
  `);
  
  return {
    overview: overview[0],
    recentChecks
  };
}

async function getUnhealthyAccounts() {
  await db.load();
  
  return await db.rawAll(`
    SELECT 
      a.*,
      h.error_message,
      h.checked_at as last_check
    FROM accounts a
    LEFT JOIN (
      SELECT account_id, error_message, checked_at,
             ROW_NUMBER() OVER (PARTITION BY account_id ORDER BY checked_at DESC) as rn
      FROM health_check_history
      WHERE status = 'unhealthy'
    ) h ON a.id = h.account_id AND h.rn = 1
    WHERE a.health_status = 'unhealthy'
    OR a.status = 'checkpoint'
    ORDER BY h.checked_at DESC
  `);
}

module.exports = {
  runHealthCheck,
  getHealthHistory,
  getHealthDashboard,
  getUnhealthyAccounts
};
