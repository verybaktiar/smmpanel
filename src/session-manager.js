'use strict';

const db = require('./db');

const SESSION_EXPIRY_DAYS = parseInt(process.env.SESSION_EXPIRY_DAYS) || 90;
const SESSION_CHECK_INTERVAL_HOURS = parseInt(process.env.SESSION_CHECK_INTERVAL_HOURS) || 6;

async function createSession(accountId) {
  await db.load();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + (SESSION_EXPIRY_DAYS * 24 * 60 * 60 * 1000));
  
  await db.rawAll(`
    UPDATE accounts 
    SET session_created_at = datetime('now'),
        session_expires_at = ?,
        last_activity_at = datetime('now')
    WHERE id = ?
  `, [expiresAt.toISOString(), accountId]);
  
  return { created: now, expires: expiresAt };
}

async function updateActivity(accountId) {
  await db.load();
  await db.rawAll(`
    UPDATE accounts 
    SET last_activity_at = datetime('now')
    WHERE id = ?
  `, [accountId]);
}

async function checkSessionExpiry() {
  await db.load();
  const expired = await db.rawAll(`
    SELECT id, name, email 
    FROM accounts 
    WHERE status = 'active' 
    AND session_expires_at IS NOT NULL 
    AND datetime(session_expires_at) < datetime('now')
  `);
  
  for (const account of expired) {
    console.log(`[session] Account ${account.name} session expired, marking as inactive`);
    await db.rawAll(`UPDATE accounts SET status = 'inactive' WHERE id = ?`, [account.id]);
    await db.rawAll(`
      INSERT INTO analytics_events (event_type, entity_type, entity_id, metadata)
      VALUES ('session_expired', 'account', ?, ?)
    `, [account.id, JSON.stringify({ email: account.email })]);
  }
  
  return expired.length;
}

async function getExpiringSessions(daysThreshold = 7) {
  await db.load();
  return await db.rawAll(`
    SELECT id, name, email, session_expires_at,
           julianday(session_expires_at) - julianday('now') as days_until_expiry
    FROM accounts 
    WHERE status = 'active' 
    AND session_expires_at IS NOT NULL 
    AND datetime(session_expires_at) < datetime('now', '+${daysThreshold} days')
    ORDER BY session_expires_at ASC
  `);
}

async function getAccountSessionStats() {
  await db.load();
  return await db.rawAll(`
    SELECT 
      COUNT(*) as total,
      COUNT(CASE WHEN session_expires_at IS NOT NULL AND datetime(session_expires_at) > datetime('now') THEN 1 END) as active_sessions,
      COUNT(CASE WHEN session_expires_at IS NULL THEN 1 END) as never_logged_in,
      COUNT(CASE WHEN session_expires_at IS NOT NULL AND datetime(session_expires_at) <= datetime('now') THEN 1 END) as expired_sessions
    FROM accounts
  `);
}

module.exports = {
  createSession,
  updateActivity,
  checkSessionExpiry,
  getExpiringSessions,
  getAccountSessionStats,
  SESSION_EXPIRY_DAYS,
  SESSION_CHECK_INTERVAL_HOURS
};
