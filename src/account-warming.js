'use strict';

const db = require('./db');
const fs = require('fs');
const path = require('path');

/**
 * Account Warming System
 * Gradually increase activity to build account reputation
 */

class AccountWarming {
  constructor() {
    // Rencana 14 hari, Indonesia, semi-otomatis (pindah tahap wajib persetujuan).
    // Batas harian dijaga rendah + jam manusia (diatur worker/scheduler).
    this.warmingStages = {
      stage1: {
        name: 'Adaptasi',
        days: 2,
        actions: {
          login: { count: 1, interval: 86400000 },
          view: { count: 10, interval: 3600000 },
          like: { count: 5, interval: 86400000 }
        }
      },
      stage2: {
        name: 'Pemanasan Ringan',
        days: 3,
        actions: {
          login: { count: 2, interval: 43200000 },
          view: { count: 15, interval: 3600000 },
          like: { count: 10, interval: 86400000 },
          follow: { count: 10, interval: 86400000 }
        }
      },
      stage3: {
        name: 'Setengah Aktif',
        days: 9,
        actions: {
          login: { count: 3, interval: 28800000 },
          view: { count: 20, interval: 3600000 },
          like: { count: 20, interval: 86400000 },
          follow: { count: 15, interval: 86400000 },
          comment: { count: 2, interval: 86400000 },
          post: { count: 1, interval: 172800000 }
        }
      },
      stage4: {
        name: 'Lulus',
        days: -1, // Indefinite
        actions: {
          login: { count: 3, interval: 28800000 },
          view: { count: 30, interval: 3600000 },
          like: { count: 30, interval: 86400000 },
          follow: { count: 20, interval: 86400000 },
          comment: { count: 3, interval: 86400000 },
          post: { count: 1, interval: 86400000 }
        }
      }
    };
  }

  async ensureTable() {
    await db.waitReady();
    try {
      await db.rawAll('SELECT needs_approval FROM warming_accounts LIMIT 1');
    } catch (e) {
      db.run('ALTER TABLE warming_accounts ADD COLUMN needs_approval INTEGER DEFAULT 0');
      db.save();
    }
  }

  /**
   * Initialize warming for new account
   */
  async startWarming(accountId) {
    return db.transaction(async () => {
      const account = await db.rawAll('SELECT id FROM accounts WHERE id = ?', [accountId]);
      if (account.length === 0) throw new Error('Account not found');
      const existing = await db.rawAll('SELECT * FROM warming_accounts WHERE account_id = ?', [accountId]);
      if (existing.length > 0) return { warming: true, stage: existing[0].current_stage };
      db.run('INSERT INTO warming_accounts (account_id) VALUES (?)', [accountId]);
      console.log(`[warming] Started warming for account ${accountId}`);
      return { warming: true, stage: 'stage1' };
    });
  }

  /**
   * Get warming status for account
   */
  async getWarmingStatus(accountId) {
    await this.ensureTable();
    
    const warming = await db.rawAll(
      'SELECT * FROM warming_accounts WHERE account_id = ?',
      [accountId]
    );
    
    if (warming.length === 0) {
      return { warming: false };
    }
    
    const status = warming[0];
    const stage = this.warmingStages[status.current_stage] || this.warmingStages.stage1;
    const stageStarted = new Date(status.stage_started_at);
    const daysSinceStageStart = Math.floor((Date.now() - stageStarted) / 86400000);
    
    let actionsToday = {};
    try {
      actionsToday = JSON.parse(status.actions_today || '{}');
    } catch {
      actionsToday = {};
    }
    
    return {
      warming: true,
      currentStage: status.current_stage,
      stageName: stage.name,
      daysSinceStageStart,
      stageDuration: stage.days,
      needsApproval: !!(status.needs_approval || status.needsApproval),
      actionsToday,
      allowedActions: stage.actions,
      totalDays: status.total_days
    };
  }

  /**
   * Check if action is allowed for warming account
   */
  async canPerformAction(accountId, actionType) {
    const status = await this.getWarmingStatus(accountId);
    
    if (!status.warming) {
      return { allowed: true, reason: 'not_warming' };
    }
    
    const allowedActions = status.allowedActions;
    
    if (!allowedActions[actionType]) {
      return { allowed: false, reason: 'action_not_allowed_in_stage' };
    }
    
    const actionsToday = status.actionsToday;
    const actionCount = actionsToday[actionType] || 0;
    const maxActions = allowedActions[actionType].count;
    
    if (actionCount >= maxActions) {
      return { 
        allowed: false, 
        reason: 'daily_limit_reached',
        current: actionCount,
        max: maxActions
      };
    }
    
    return {
      allowed: true,
      remaining: maxActions - actionCount
    };
  }

  /**
   * Record action for warming account
   */
  async recordAction(accountId, actionType) {
    await this.ensureTable();
    
    const warming = await db.rawAll(
      'SELECT * FROM warming_accounts WHERE account_id = ?',
      [accountId]
    );
    
    if (warming.length === 0) return;
    
    const status = warming[0];
    let actionsToday = {};
    try {
      actionsToday = JSON.parse(status.actions_today || '{}');
    } catch {
      actionsToday = {};
    }
    
    actionsToday[actionType] = (actionsToday[actionType] || 0) + 1;
    
    db.run(
      `UPDATE warming_accounts 
       SET actions_today = ?, last_action_at = datetime('now') 
       WHERE account_id = ?`,
      [JSON.stringify(actionsToday), accountId]
    );
    db.save();
    await db.logWarmingActivity({ accountId, actionType, status: 'completed' });
  }

  /**
   * Progress to next stage
   */
  async progressStage(accountId) {
    await db.waitReady();
    
    const status = await this.getWarmingStatus(accountId);
    
    if (!status.warming) return;
    
    const currentStageKey = status.currentStage;
    const currentStage = this.warmingStages[currentStageKey];
    
    // Check if enough days passed
    if (currentStage.days > 0 && status.daysSinceStageStart < currentStage.days) {
      return { progressed: false, reason: 'stage_not_complete' };
    }

    // GATE: tahap selesai → tunggu persetujuan manusia, jangan maju sendiri
    if (!status.needsApproval) {
      db.run('UPDATE warming_accounts SET needs_approval = 1 WHERE account_id = ?', [accountId]);
      db.save();
      console.log(`[warming] Account ${accountId} menunggu persetujuan (${currentStageKey} selesai)`);
      return { progressed: false, reason: 'awaiting_approval' };
    }
    return { progressed: false, reason: 'awaiting_approval' };
  }

  /**
   * Setujui pindah tahap (dipencet manusia dari panel)
   */
  async approveStage(accountId) {
    await db.waitReady();
    const status = await this.getWarmingStatus(accountId);
    if (!status.warming) return { error: 'not_warming' };
    if (!status.needsApproval) return { error: 'not_ready' };
    const currentStageKey = status.currentStage;
    const stageNumber = parseInt(currentStageKey.replace('stage', ''));
    const nextStageKey = `stage${stageNumber + 1}`;
    if (!this.warmingStages[nextStageKey]) return { error: 'max_stage_reached' };
    db.run(
      `UPDATE warming_accounts
       SET current_stage = ?,
           stage_started_at = datetime('now'),
           needs_approval = 0,
           total_days = total_days + ?
       WHERE account_id = ?`,
      [nextStageKey, status.daysSinceStageStart, accountId]
    );
    db.save();
    console.log(`[warming] Account ${accountId} disetujui ke ${nextStageKey}`);
    return { approved: true, newStage: nextStageKey };
  }

  /**
   * Reset daily actions (run this daily via cron)
   */
  async resetDailyActions() {
    await this.ensureTable();
    
    db.run(
      `UPDATE warming_accounts SET actions_today = '{}'`
    );
    db.save();
    
    console.log('[warming] Daily actions reset');
  }

  /**
   * Auto-progress stages (run this daily via cron)
   */
  async autoProgressStages() {
    await this.ensureTable();
    
    const allWarming = await db.rawAll('SELECT account_id FROM warming_accounts');
    
    for (const record of allWarming) {
      await this.progressStage(record.account_id);
    }
  }

  /**
   * Stop warming for account
   */
  async stopWarming(accountId) {
    await this.ensureTable();
    await db.transaction(async () => {
      db.run('DELETE FROM warming_accounts WHERE account_id = ?', [accountId]);
    });
    console.log(`[warming] Stopped warming for account ${accountId}`);
  }

  /**
   * Get all warming accounts
   */
  async getAllWarmingAccounts() {
    await this.ensureTable();
    
    const warming = await db.rawAll(`
      SELECT 
        w.*,
        a.name as account_name,
        a.email,
        a.platform
      FROM warming_accounts w
      JOIN accounts a ON a.id = w.account_id
      ORDER BY w.created_at DESC
    `);
    
    // Transform data tanpa loop tambahan
    return warming.map(record => {
      const stage = this.warmingStages[record.current_stage] || this.warmingStages['stage1'];
      const stageStarted = new Date(record.stage_started_at);
      const daysSinceStageStart = Math.floor((Date.now() - stageStarted) / 86400000);
      
      return {
        account_id: record.account_id,
        account_name: record.account_name,
        email: record.email,
        platform: record.platform,
        current_stage: record.current_stage,
        stage_name: stage.name,
        days_since_stage_start: daysSinceStageStart,
        stage_duration: stage.days,
        needs_approval: !!record.needs_approval,
        total_days: record.total_days,
        created_at: record.created_at,
        stage_started_at: record.stage_started_at
      };
    });
  }
}

module.exports = new AccountWarming();
