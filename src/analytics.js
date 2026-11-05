'use strict';

const db = require('./db');

async function logEvent(eventType, entityType = null, entityId = null, accountId = null, metadata = {}) {
  await db.load();
  await db.rawAll(`
    INSERT INTO analytics_events (event_type, entity_type, entity_id, account_id, metadata)
    VALUES (?, ?, ?, ?, ?)
  `, [eventType, entityType, entityId, accountId, JSON.stringify(metadata)]);
}

async function getSuccessRate(period = '7 days') {
  await db.load();
  
  const executions = await db.rawAll(`
    SELECT 
      COUNT(*) as total,
      COUNT(CASE WHEN status = 'success' THEN 1 END) as succeeded,
      COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed
    FROM smm_like_executions
    WHERE datetime(created_at) >= datetime('now', '-${period}')
  `);
  
  if (executions.length === 0 || executions[0].total === 0) {
    return { total: 0, succeeded: 0, failed: 0, rate: 0 };
  }
  
  const stat = executions[0];
  return {
    total: stat.total,
    succeeded: stat.succeeded,
    failed: stat.failed,
    rate: ((stat.succeeded / stat.total) * 100).toFixed(2)
  };
}

async function getAccountPerformance(accountId, days = 7) {
  await db.load();
  
  const stats = await db.rawAll(`
    SELECT 
      (SELECT COUNT(*) FROM smm_like_executions 
       WHERE account_id = ? AND status = 'success' 
       AND datetime(executed_at) >= datetime('now', '-${days} days')) as likes_succeeded,
      (SELECT COUNT(*) FROM smm_like_executions 
       WHERE account_id = ? AND status = 'failed' 
       AND datetime(executed_at) >= datetime('now', '-${days} days')) as likes_failed,
      (SELECT COUNT(*) FROM post_log 
       WHERE account_id = ? AND status = 'post_ok' 
       AND datetime(created_at) >= datetime('now', '-${days} days')) as posts_succeeded,
      (SELECT COUNT(*) FROM post_log 
       WHERE account_id = ? AND status = 'post_failed' 
       AND datetime(created_at) >= datetime('now', '-${days} days')) as posts_failed
  `, [accountId, accountId, accountId, accountId]);
  
  return stats[0] || { likes_succeeded: 0, likes_failed: 0, posts_succeeded: 0, posts_failed: 0 };
}

async function getDailyStats(days = 7) {
  await db.load();
  
  return await db.rawAll(`
    SELECT 
      date(created_at) as date,
      COUNT(*) as total_events,
      COUNT(CASE WHEN event_type = 'login_success' THEN 1 END) as logins,
      COUNT(CASE WHEN event_type = 'like_success' THEN 1 END) as likes,
      COUNT(CASE WHEN event_type = 'post_success' THEN 1 END) as posts,
      COUNT(CASE WHEN event_type LIKE '%failed%' THEN 1 END) as failures
    FROM analytics_events
    WHERE datetime(created_at) >= datetime('now', '-${days} days')
    GROUP BY date(created_at)
    ORDER BY date DESC
  `);
}

async function getTopPerformers(limit = 10) {
  await db.load();
  
  return await db.rawAll(`
    SELECT 
      a.id, a.name, a.email,
      COUNT(e.id) as total_executions,
      COUNT(CASE WHEN e.status = 'success' THEN 1 END) as successes,
      ROUND(COUNT(CASE WHEN e.status = 'success' THEN 1 END) * 100.0 / COUNT(e.id), 2) as success_rate
    FROM accounts a
    LEFT JOIN smm_like_executions e ON a.id = e.account_id
    WHERE e.executed_at >= datetime('now', '-7 days')
    GROUP BY a.id
    ORDER BY successes DESC
    LIMIT ?
  `, [limit]);
}

async function getProxyPerformance() {
  await db.load();
  
  return await db.rawAll(`
    SELECT 
      p.value as proxy,
      COUNT(e.id) as total_executions,
      COUNT(CASE WHEN e.status = 'success' THEN 1 END) as successes,
      COUNT(CASE WHEN e.status = 'failed' THEN 1 END) as failures,
      ROUND(COUNT(CASE WHEN e.status = 'success' THEN 1 END) * 100.0 / COUNT(e.id), 2) as success_rate
    FROM proxies p
    LEFT JOIN accounts a ON a.proxy LIKE '%' || p.value || '%'
    LEFT JOIN smm_like_executions e ON a.id = e.account_id
    WHERE e.executed_at >= datetime('now', '-7 days')
    GROUP BY p.id
    ORDER BY success_rate DESC
  `);
}

module.exports = {
  logEvent,
  getSuccessRate,
  getAccountPerformance,
  getDailyStats,
  getTopPerformers,
  getProxyPerformance
};
