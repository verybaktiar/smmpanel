'use strict';

const db = require('./db');

/**
 * Account Rotation & Cooldown System
 * Manages account usage to prevent detection and bans
 */

class AccountRotation {
  constructor() {
    // Cooldown settings (in milliseconds)
    this.cooldowns = {
      post: 2 * 60 * 60 * 1000,      // 2 hours after post
      like: 30 * 60 * 1000,           // 30 minutes after like
      login: 5 * 60 * 1000,           // 5 minutes after login
      checkpoint: 24 * 60 * 60 * 1000, // 24 hours after checkpoint
      error: 60 * 60 * 1000,          // 1 hour after any error
    };

    // Max actions per time window
    this.limits = {
      post: { count: 5, window: 24 * 60 * 60 * 1000 },    // 5 posts per 24h
      like: { count: 50, window: 24 * 60 * 60 * 1000 },   // 50 likes per 24h
      login: { count: 3, window: 60 * 60 * 1000 },        // 3 logins per hour
    };
  }

  /**
   * Check if account is in cooldown
   */
  async isInCooldown(accountId) {
    await db.waitReady();
    
    const lastActions = await db.rawAll(`
      SELECT status, created_at 
      FROM post_log 
      WHERE account_id = ? 
      ORDER BY created_at DESC 
      LIMIT 1
    `, [accountId]);

    if (lastActions.length === 0) return { inCooldown: false };

    const lastAction = lastActions[0];
    const lastTime = new Date(lastAction.created_at).getTime();
    const now = Date.now();

    // Check cooldown based on last action status
    if (lastAction.status.includes('checkpoint')) {
      const cooldownEnd = lastTime + this.cooldowns.checkpoint;
      if (now < cooldownEnd) {
        return {
          inCooldown: true,
          reason: 'checkpoint',
          remainingMs: cooldownEnd - now,
          endsAt: new Date(cooldownEnd)
        };
      }
    }

    if (lastAction.status.includes('failed') || lastAction.status.includes('error')) {
      const cooldownEnd = lastTime + this.cooldowns.error;
      if (now < cooldownEnd) {
        return {
          inCooldown: true,
          reason: 'error',
          remainingMs: cooldownEnd - now,
          endsAt: new Date(cooldownEnd)
        };
      }
    }

    if (lastAction.status.includes('post')) {
      const cooldownEnd = lastTime + this.cooldowns.post;
      if (now < cooldownEnd) {
        return {
          inCooldown: true,
          reason: 'post',
          remainingMs: cooldownEnd - now,
          endsAt: new Date(cooldownEnd)
        };
      }
    }

    if (lastAction.status.includes('like')) {
      const cooldownEnd = lastTime + this.cooldowns.like;
      if (now < cooldownEnd) {
        return {
          inCooldown: true,
          reason: 'like',
          remainingMs: cooldownEnd - now,
          endsAt: new Date(cooldownEnd)
        };
      }
    }

    return { inCooldown: false };
  }

  /**
   * Check if account exceeded action limits
   */
  async hasExceededLimits(accountId, actionType) {
    await db.waitReady();
    
    const limit = this.limits[actionType];
    if (!limit) return { exceeded: false };

    const windowStart = new Date(Date.now() - limit.window).toISOString();
    
    const actions = await db.rawAll(`
      SELECT COUNT(*) as count 
      FROM post_log 
      WHERE account_id = ? 
        AND status LIKE ? 
        AND created_at > ?
    `, [accountId, `%${actionType}%`, windowStart]);

    const actionCount = actions[0].count;
    
    if (actionCount >= limit.count) {
      return {
        exceeded: true,
        count: actionCount,
        limit: limit.count,
        window: limit.window
      };
    }

    return {
      exceeded: false,
      count: actionCount,
      limit: limit.count,
      remaining: limit.count - actionCount
    };
  }

  /**
   * Get available accounts (not in cooldown, not exceeded limits)
   */
  async getAvailableAccounts(actionType, platform = null, excludeIds = []) {
    await db.waitReady();
    
    let query = `SELECT * FROM accounts WHERE status = 'active'`;
    const params = [];
    
    if (platform) {
      query += ` AND platform = ?`;
      params.push(platform);
    }
    
    if (excludeIds.length > 0) {
      query += ` AND id NOT IN (${excludeIds.map(() => '?').join(',')})`;
      params.push(...excludeIds);
    }

    const accounts = await db.rawAll(query, params);
    
    const available = [];
    
    for (const account of accounts) {
      // Check cooldown
      const cooldownStatus = await this.isInCooldown(account.id);
      if (cooldownStatus.inCooldown) continue;
      
      // Check limits
      const limitStatus = await this.hasExceededLimits(account.id, actionType);
      if (limitStatus.exceeded) continue;
      
      available.push({
        ...account,
        actionCount: limitStatus.count,
        remaining: limitStatus.remaining
      });
    }
    
    // Sort by least used (remaining actions DESC)
    available.sort((a, b) => (b.remaining || 0) - (a.remaining || 0));
    
    return available;
  }

  /**
   * Get next account to use (rotation logic)
   */
  async getNextAccount(actionType, platform = null, excludeIds = []) {
    const available = await this.getAvailableAccounts(actionType, platform, excludeIds);
    
    if (available.length === 0) {
      return null;
    }
    
    // Return account with most remaining actions
    return available[0];
  }

  /**
   * Get account statistics
   */
  async getAccountStats(accountId) {
    await db.waitReady();
    
    const cooldownStatus = await this.isInCooldown(accountId);
    
    const stats = {
      accountId,
      cooldown: cooldownStatus,
      limits: {}
    };
    
    // Check all action types
    for (const [actionType, limit] of Object.entries(this.limits)) {
      const limitStatus = await this.hasExceededLimits(accountId, actionType);
      stats.limits[actionType] = limitStatus;
    }
    
    // Get last 24h activity
    const last24h = await db.rawAll(`
      SELECT 
        status,
        COUNT(*) as count
      FROM post_log 
      WHERE account_id = ? 
        AND created_at > datetime('now', '-24 hours')
      GROUP BY status
    `, [accountId]);
    
    stats.last24h = last24h;
    
    return stats;
  }

  /**
   * Get all accounts status overview
   */
  async getAllAccountsStatus(platform = null) {
    await db.waitReady();
    
    let query = `SELECT id, name, platform, status FROM accounts`;
    const params = [];
    
    if (platform) {
      query += ` WHERE platform = ?`;
      params.push(platform);
    }
    
    const accounts = await db.rawAll(query, params);
    
    const statuses = [];
    
    for (const account of accounts) {
      const stats = await this.getAccountStats(account.id);
      statuses.push({
        ...account,
        ...stats
      });
    }
    
    return statuses;
  }

  /**
   * Update cooldown settings
   */
  setCooldown(actionType, milliseconds) {
    if (this.cooldowns[actionType] !== undefined) {
      this.cooldowns[actionType] = milliseconds;
    }
  }

  /**
   * Update limit settings
   */
  setLimit(actionType, count, windowMs) {
    if (this.limits[actionType] !== undefined) {
      this.limits[actionType] = { count, window: windowMs };
    }
  }
}

module.exports = new AccountRotation();
