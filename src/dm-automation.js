'use strict';

const db = require('./db');
const { openAccountBrowser, humanDelay, typeHuman } = require('./browser');

/**
 * DM (Direct Message) Automation
 * Auto-send DMs on Instagram and Facebook Messenger
 */

class DMAutomation {
  
  /**
   * Send Instagram DM
   */
  async sendInstagramDM(account, username, message) {
    const acc = require('./actions').withDecryptedPassword(account);
    const { context } = await openAccountBrowser(acc, { headless: false });
    const page = await context.newPage();
    
    try {
      await page.goto('https://www.instagram.com/direct/inbox/', { timeout: 60000 });
      await humanDelay(3000, 5000);
      
      if (page.url().includes('login')) {
        return { ok: false, reason: 'not_logged_in' };
      }
      
      // Click new message button
      const newMessageButtons = [
        'svg[aria-label="New message"]',
        'text=/New message|Pesan baru/i'
      ];
      
      let clicked = false;
      for (const selector of newMessageButtons) {
        const btn = page.locator(selector).first();
        if (await btn.count() > 0 && await btn.isVisible().catch(() => false)) {
          await btn.click();
          clicked = true;
          await humanDelay(2000, 3000);
          break;
        }
      }
      
      if (!clicked) {
        return { ok: false, reason: 'new_message_button_not_found' };
      }
      
      // Search for user
      const searchInput = page.locator('input[placeholder*="Search" i], input[name="queryBox"]').first();
      if (await searchInput.count() === 0) {
        return { ok: false, reason: 'search_input_not_found' };
      }
      
      await typeHuman(searchInput, username);
      await humanDelay(2000, 3000);
      
      // Select first result
      const userResult = page.locator(`text=/${username}/i`).first();
      if (await userResult.count() === 0) {
        return { ok: false, reason: 'user_not_found' };
      }
      
      await userResult.click();
      await humanDelay(1000, 2000);
      
      // Click "Chat" or "Next"
      const nextButton = page.locator('text=/Chat|Next|Berikutnya/i').first();
      if (await nextButton.count() > 0) {
        await nextButton.click();
        await humanDelay(2000, 3000);
      }
      
      // Type message
      const messageInput = page.locator('textarea[placeholder*="Message" i], div[contenteditable="true"]').first();
      if (await messageInput.count() === 0) {
        return { ok: false, reason: 'message_input_not_found' };
      }
      
      await typeHuman(messageInput, message);
      await humanDelay(1000, 2000);
      
      // Send message
      const sendButton = page.locator('text=/Send|Kirim/i, button[type="submit"]').first();
      if (await sendButton.count() > 0) {
        await sendButton.click();
      } else {
        await page.keyboard.press('Enter');
      }
      
      await humanDelay(2000, 3000);
      
      console.log('[dm] Instagram DM sent successfully');
      return { ok: true, platform: 'instagram' };
      
    } catch (error) {
      console.error('[dm] Error:', error.message);
      return { ok: false, reason: 'error: ' + error.message };
    } finally {
      await context.close().catch(() => {});
    }
  }

  /**
   * Send Facebook Messenger DM
   */
  async sendFacebookDM(account, username, message) {
    const acc = require('./actions').withDecryptedPassword(account);
    const { context } = await openAccountBrowser(acc, { headless: false });
    const page = await context.newPage();
    
    try {
      await page.goto('https://www.facebook.com/messages', { timeout: 60000 });
      await humanDelay(3000, 5000);
      
      if (page.url().includes('login')) {
        return { ok: false, reason: 'not_logged_in' };
      }
      
      // Click new message
      const newMessageButtons = [
        'a[href="/new"]',
        'text=/New message|Pesan baru/i',
        'div[aria-label*="New message" i]'
      ];
      
      let clicked = false;
      for (const selector of newMessageButtons) {
        const btn = page.locator(selector).first();
        if (await btn.count() > 0 && await btn.isVisible().catch(() => false)) {
          await btn.click();
          clicked = true;
          await humanDelay(2000, 3000);
          break;
        }
      }
      
      if (!clicked) {
        return { ok: false, reason: 'new_message_button_not_found' };
      }
      
      // Search for user
      const searchInput = page.locator('input[placeholder*="To:" i], input[aria-label*="To:" i]').first();
      if (await searchInput.count() === 0) {
        return { ok: false, reason: 'search_input_not_found' };
      }
      
      await typeHuman(searchInput, username);
      await humanDelay(2000, 3000);
      
      // Select user from results
      const userResult = page.locator(`text=/${username}/i`).first();
      if (await userResult.count() === 0) {
        return { ok: false, reason: 'user_not_found' };
      }
      
      await userResult.click();
      await humanDelay(2000, 3000);
      
      // Type message
      const messageInput = page.locator('div[contenteditable="true"][aria-label*="Message" i]').first();
      if (await messageInput.count() === 0) {
        return { ok: false, reason: 'message_input_not_found' };
      }
      
      await typeHuman(messageInput, message);
      await humanDelay(1000, 2000);
      
      // Send message
      await page.keyboard.press('Enter');
      await humanDelay(2000, 3000);
      
      console.log('[dm] Facebook DM sent successfully');
      return { ok: true, platform: 'facebook' };
      
    } catch (error) {
      console.error('[dm] Error:', error.message);
      return { ok: false, reason: 'error: ' + error.message };
    } finally {
      await context.close().catch(() => {});
    }
  }

  /**
   * Bulk DM campaign
   */
  async bulkDMCampaign(account, recipients, message, options = {}) {
    const { platform = 'instagram', delayMin = 60000, delayMax = 120000 } = options;
    
    await db.waitReady();
    
    // Create dm_campaigns table
    db.run(`
      CREATE TABLE IF NOT EXISTS dm_campaigns (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        account_id INTEGER NOT NULL,
        platform TEXT NOT NULL,
        recipient TEXT NOT NULL,
        message TEXT NOT NULL,
        status TEXT DEFAULT 'pending',
        sent_at TEXT,
        error TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (account_id) REFERENCES accounts(id)
      )
    `);
    
    const results = [];
    
    for (const recipient of recipients) {
      try {
        let result;
        if (platform === 'instagram') {
          result = await this.sendInstagramDM(account, recipient, message);
        } else if (platform === 'facebook') {
          result = await this.sendFacebookDM(account, recipient, message);
        }
        
        // Record in database
        db.run(
          `INSERT INTO dm_campaigns (account_id, platform, recipient, message, status, sent_at, error) 
           VALUES (?, ?, ?, ?, ?, datetime('now'), ?)`,
          [account.id, platform, recipient, message, result.ok ? 'sent' : 'failed', result.ok ? null : result.reason]
        );
        db.save();
        
        results.push({ recipient, result });
        
        // Rate limiting
        const delay = Math.floor(Math.random() * (delayMax - delayMin + 1)) + delayMin;
        await humanDelay(delay, delay + 10000);
        
      } catch (error) {
        console.error('[dm] Campaign error:', error);
        db.run(
          `INSERT INTO dm_campaigns (account_id, platform, recipient, message, status, error) 
           VALUES (?, ?, ?, ?, ?, ?)`,
          [account.id, platform, recipient, message, 'failed', error.message]
        );
        db.save();
      }
    }
    
    return results;
  }

  /**
   * Get DM campaign statistics
   */
  async getCampaignStats(accountId) {
    await db.waitReady();
    
    const stats = await db.rawAll(`
      SELECT 
        platform,
        COUNT(*) as total,
        SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) as sent,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending
      FROM dm_campaigns
      WHERE account_id = ?
      GROUP BY platform
    `, [accountId]);
    
    return stats;
  }
}

module.exports = new DMAutomation();
