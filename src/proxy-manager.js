'use strict';

const db = require('./db');

class ProxyManager {
  constructor() {
    this.proxyScores = new Map();
    this.loadScores();
  }
  
  async loadScores() {
    await db.load();
    const proxies = await db.listProxies();
    
    for (const proxy of proxies) {
      const executions = await db.rawAll(`
        SELECT 
          COUNT(*) as total,
          COUNT(CASE WHEN e.status = 'success' THEN 1 END) as successes
        FROM smm_like_executions e
        JOIN accounts a ON e.account_id = a.id
        WHERE a.proxy = ? AND e.executed_at >= datetime('now', '-7 days')
      `, [proxy.value]);
      
      if (executions.length > 0 && executions[0].total > 0) {
        const score = (executions[0].successes / executions[0].total) * 100;
        this.proxyScores.set(proxy.value, {
          score,
          total: executions[0].total,
          successes: executions[0].successes
        });
      }
    }
  }
  
  async getBestProxy(excludeProxies = [], platform = null) {
    await db.load();
    
    let query = `
      SELECT * FROM proxies 
      WHERE status != 'dead' 
      AND value NOT IN (${excludeProxies.map(() => '?').join(',')})
    `;
    const params = [...excludeProxies];
    
    // Filter by platform-specific requirements
    if (platform === 'tiktok') {
      query += ` AND (country = 'ID' OR country IS NULL OR country = '')`;
    } else if (platform === 'instagram') {
      query += ` AND (country IN ('ID', 'SG', 'MY') OR country IS NULL OR country = '')`;
    }
    
    query += ` ORDER BY response_time ASC`;
    
    const availableProxies = await db.rawAll(query, params);
    
    if (availableProxies.length === 0) {
      return null;
    }
    
    const scored = availableProxies.map(p => ({
      ...p,
      performanceScore: this.proxyScores.get(p.value)?.score || 50,
      // Prioritize fresh proxies (recently added)
      freshnessScore: p.created_at ? (Date.now() - new Date(p.created_at).getTime()) / (24 * 60 * 60 * 1000) : 0
    }));
    
    // Weighted scoring: 70% performance, 20% response time, 10% freshness
    scored.forEach(p => {
      const perfScore = p.performanceScore;
      const respScore = p.response_time ? Math.max(0, 100 - (p.response_time / 100)) : 50;
      const freshScore = Math.max(0, 100 - (p.freshnessScore * 10)); // Older = lower score
      
      p.combinedScore = (perfScore * 0.7) + (respScore * 0.2) + (freshScore * 0.1);
    });
    
    scored.sort((a, b) => b.combinedScore - a.combinedScore);
    
    return scored[0];
  }
  
  async rotateProxy(accountId, platform = null) {
    await db.load();
    
    const account = await db.getAccountById(accountId);
    if (!account) throw new Error('Account not found');
    
    const currentProxy = account.proxy;
    const excludeProxies = currentProxy ? [currentProxy] : [];
    
    const newProxy = await this.getBestProxy(excludeProxies, platform);
    if (!newProxy) {
      console.log(`[proxy] No alternative proxy available for account ${account.name}`);
      return null;
    }
    
    await db.setAccountProxy(accountId, newProxy.value);
    
    await db.rawAll(`
      INSERT INTO analytics_events (event_type, entity_type, entity_id, metadata)
      VALUES ('proxy_rotated', 'account', ?, ?)
    `, [accountId, JSON.stringify({ 
      old_proxy: currentProxy, 
      new_proxy: newProxy.value,
      platform: platform
    })]);
    
    console.log(`[proxy] Rotated proxy for ${account.name} (${platform}): ${currentProxy || 'none'} -> ${newProxy.value}`);
    return newProxy.value;
  }
  
  async markProxyDead(proxyValue, reason = 'unknown') {
    await db.load();
    
    await db.rawAll(`
      UPDATE proxies SET status = 'dead' WHERE value = ?
    `, [proxyValue]);
    
    this.proxyScores.delete(proxyValue);
    
    const affectedAccounts = await db.rawAll(`
      SELECT id, name FROM accounts WHERE proxy = ?
    `, [proxyValue]);
    
    for (const account of affectedAccounts) {
      await this.rotateProxy(account.id);
    }
    
    await db.rawAll(`
      INSERT INTO analytics_events (event_type, entity_type, metadata)
      VALUES ('proxy_dead', 'proxy', ?)
    `, [JSON.stringify({ proxy: proxyValue, reason, affected_accounts: affectedAccounts.length })]);
    
    console.log(`[proxy] Marked ${proxyValue} as dead. Affected ${affectedAccounts.length} accounts.`);
    return affectedAccounts.length;
  }
  
  async getProxyStats() {
    const stats = {
      total: 0,
      active: 0,
      dead: 0,
      unused: 0,
      topPerformers: [],
      worstPerformers: []
    };
    
    const proxies = await db.listProxies();
    stats.total = proxies.length;
    stats.dead = proxies.filter(p => p.status === 'dead').length;
    stats.unused = proxies.filter(p => p.status === 'unused').length;
    stats.active = stats.total - stats.dead - stats.unused;
    
    const sorted = Array.from(this.proxyScores.entries())
      .map(([proxy, data]) => ({ proxy, ...data }))
      .sort((a, b) => b.score - a.score);
    
    stats.topPerformers = sorted.slice(0, 5);
    stats.worstPerformers = sorted.slice(-5).reverse();
    
    return stats;
  }
}

module.exports = new ProxyManager();
