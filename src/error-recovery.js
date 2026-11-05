'use strict';

const db = require('./db');

const MAX_RETRY_ATTEMPTS = parseInt(process.env.MAX_RETRY_ATTEMPTS) || 3;
const RETRY_DELAY_SECONDS = parseInt(process.env.RETRY_DELAY_SECONDS) || 60;

async function queueRecovery(entityType, entityId, action, error, maxRetries = MAX_RETRY_ATTEMPTS) {
  await db.load();
  const nextRetryAt = new Date(Date.now() + (RETRY_DELAY_SECONDS * 1000)).toISOString();
  
  const existing = await db.rawAll(`
    SELECT id FROM error_recovery_queue 
    WHERE entity_type = ? AND entity_id = ? AND action = ? AND status = 'pending'
  `, [entityType, entityId, action]);
  
  if (existing.length > 0) {
    await db.rawAll(`
      UPDATE error_recovery_queue 
      SET retry_count = retry_count + 1, 
          last_error = ?,
          next_retry_at = ?
      WHERE id = ?
    `, [error, nextRetryAt, existing[0].id]);
    return existing[0].id;
  }
  
  const result = await db.rawAll(`
    INSERT INTO error_recovery_queue 
    (entity_type, entity_id, action, max_retries, next_retry_at, last_error)
    VALUES (?, ?, ?, ?, ?, ?)
  `, [entityType, entityId, action, maxRetries, nextRetryAt, error]);
  
  return result.lastInsertRowid;
}

async function processRecoveryQueue() {
  await db.load();
  const items = await db.rawAll(`
    SELECT * FROM error_recovery_queue 
    WHERE status = 'pending' 
    AND datetime(next_retry_at) <= datetime('now')
    AND retry_count < max_retries
    ORDER BY created_at ASC
    LIMIT 10
  `);
  
  const results = { processed: 0, succeeded: 0, failed: 0 };
  
  for (const item of items) {
    console.log(`[recovery] Processing ${item.action} for ${item.entity_type}:${item.entity_id}`);
    
    try {
      const success = await executeRecoveryAction(item);
      
      if (success) {
        await db.rawAll(`
          UPDATE error_recovery_queue 
          SET status = 'completed', next_retry_at = datetime('now')
          WHERE id = ?
        `, [item.id]);
        results.succeeded++;
        await logAnalyticsEvent('recovery_success', item.entity_type, item.entity_id, { action: item.action });
      } else {
        throw new Error('Action returned false');
      }
    } catch (err) {
      const newRetryCount = item.retry_count + 1;
      const newNextRetry = new Date(Date.now() + (RETRY_DELAY_SECONDS * 1000 * Math.pow(2, newRetryCount))).toISOString();
      
      await db.rawAll(`
        UPDATE error_recovery_queue 
        SET retry_count = ?, 
            next_retry_at = ?,
            last_error = ?,
            status = CASE WHEN ? >= max_retries THEN 'failed' ELSE 'pending' END
        WHERE id = ?
      `, [newRetryCount, newNextRetry, err.message, newRetryCount, item.id]);
      
      results.failed++;
      await logAnalyticsEvent('recovery_failed', item.entity_type, item.entity_id, { 
        action: item.action, 
        error: err.message,
        retry_count: newRetryCount 
      });
    }
    
    results.processed++;
  }
  
  return results;
}

async function executeRecoveryAction(item) {
  switch (item.action) {
    case 'login':
      const account = await db.getAccountById(item.entity_id);
      if (!account) throw new Error('Account not found');
      const actions = require('./actions');
      const result = await actions.loginAccount(account);
      if (result.ok) {
        await db.setAccountStatus(account.id, 'active');
        await db.setAccountLastLogin(account.id);
        return true;
      }
      throw new Error(result.reason || 'Login failed');
    
    case 'like':
      const likeJob = await db.getLikeJob(item.entity_id);
      if (!likeJob) throw new Error('Like job not found');
      const likeAccount = await db.getAccountById(likeJob.account_id);
      const likeResult = await require('./actions').likePosting(likeAccount, likeJob.post_url);
      if (likeResult.ok) return true;
      throw new Error(likeResult.reason || 'Like failed');
    
    default:
      throw new Error(`Unknown recovery action: ${item.action}`);
  }
}

async function logAnalyticsEvent(eventType, entityType, entityId, metadata) {
  await db.rawAll(`
    INSERT INTO analytics_events (event_type, entity_type, entity_id, metadata)
    VALUES (?, ?, ?, ?)
  `, [eventType, entityType, entityId, JSON.stringify(metadata)]);
}

async function getRecoveryStats() {
  await db.load();
  return await db.rawAll(`
    SELECT 
      COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending,
      COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed,
      COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed,
      COUNT(*) as total
    FROM error_recovery_queue
  `)[0];
}

module.exports = {
  queueRecovery,
  processRecoveryQueue,
  getRecoveryStats,
  MAX_RETRY_ATTEMPTS,
  RETRY_DELAY_SECONDS
};
