'use strict';

// TikTok-specific proxy management dengan optimasi untuk platform TikTok
const ProxyManager = require('./proxy-manager');
const { getBestTikTokProxy } = require('./proxy-validator');

class TikTokProxyManager extends ProxyManager {
  constructor() {
    super();
    this.tiktokProxyCache = new Map();
  }
  
  /**
   * Get best proxy khusus untuk TikTok dengan caching
   */
  async getBestTikTokProxy(excludeProxies = []) {
    const cacheKey = excludeProxies.join(',');
    const now = Date.now();
    
    // Check cache (5 menit)
    const cached = this.tiktokProxyCache.get(cacheKey);
    if (cached && now - cached.timestamp < 300000) {
      return cached.proxy;
    }
    
    await this.loadScores();
    
    const availableProxies = await this.getAvailableProxies(excludeProxies, 'tiktok');
    
    if (availableProxies.length === 0) {
      return null;
    }
    
    // Prioritize TikTok-optimized proxies
    const bestProxy = await getBestTikTokProxy(availableProxies.map(p => p.value));
    
    if (bestProxy) {
      // Cache the result
      this.tiktokProxyCache.set(cacheKey, {
        proxy: bestProxy,
        timestamp: now
      });
    }
    
    return bestProxy;
  }
  
  /**
   * Get available proxies dengan filter TikTok
   */
  async getAvailableProxies(excludeProxies = [], platform = null) {
    await this.loadScores();
    
    let query = `
      SELECT * FROM proxies 
      WHERE status != 'dead' 
      AND value NOT IN (${excludeProxies.map(() => '?').join(',')})
    `;
    const params = [...excludeProxies];
    
    // TikTok-specific filtering
    if (platform === 'tiktok') {
      query += ` AND (country = 'ID' OR country IS NULL OR country = '')`;
      query += ` AND (type = 'residential' OR type = 'mobile' OR type IS NULL)`;
    }
    
    query += ` ORDER BY response_time ASC`;
    
    return await this.db.rawAll(query, params);
  }
  
  /**
   * Rotate proxy untuk TikTok account
   */
  async rotateTikTokProxy(accountId) {
    await this.loadScores();
    
    const account = await this.db.getAccountById(accountId);
    if (!account) throw new Error('Account not found');
    
    const currentProxy = account.proxy;
    const excludeProxies = currentProxy ? [currentProxy] : [];
    
    const newProxy = await this.getBestTikTokProxy(excludeProxies);
    if (!newProxy) {
      console.log(`[tiktok-proxy] No TikTok-optimized proxy available for account ${account.name}`);
      return null;
    }
    
    await this.db.setAccountProxy(accountId, newProxy);
    
    await this.db.rawAll(`
      INSERT INTO analytics_events (event_type, entity_type, entity_id, metadata)
      VALUES ('tiktok_proxy_rotated', 'account', ?, ?)
    `, [accountId, JSON.stringify({ 
      old_proxy: currentProxy, 
      new_proxy: newProxy,
      platform: 'tiktok'
    })]);
    
    console.log(`[tiktok-proxy] Rotated TikTok proxy for ${account.name}: ${currentProxy || 'none'} -> ${newProxy}`);
    return newProxy;
  }
  
  /**
   * Bulk validate proxies untuk TikTok
   */
  async validateTikTokProxies() {
    await this.loadScores();
    
    const proxies = await this.db.rawAll('SELECT * FROM proxies WHERE status != "dead"');
    const results = [];
    
    for (const proxy of proxies) {
      const { getBestTikTokProxy } = require('./proxy-validator');
      const result = await getBestTikTokProxy([proxy.value]);
      
      results.push({
        proxy: proxy.value,
        tiktokCompatible: !!result,
        testedAt: new Date().toISOString()
      });
      
      // Update proxy metadata jika perlu
      if (result) {
        await this.db.rawAll(
          'UPDATE proxies SET tiktok_compatible = ? WHERE value = ?',
          [true, proxy.value]
        );
      }
    }
    
    return results;
  }
}

module.exports = TikTokProxyManager;