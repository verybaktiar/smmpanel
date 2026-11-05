'use strict';

const db = require('./db');
const { openAccountBrowser, humanDelay, rand } = require('./browser');

/**
 * Story & Reel Automation
 * Auto-post Instagram Stories and Facebook Stories
 */

class StoryAutomation {
  
  /**
   * Post Instagram Story
   */
  async postInstagramStory(account, mediaPath, options = {}) {
    const { caption = '', link = '', mentions = [] } = options;
    const acc = require('./actions').withDecryptedPassword(account);
    const { context } = await openAccountBrowser(acc, { headless: false });
    const page = await context.newPage();
    
    try {
      await page.goto('https://www.instagram.com/', { timeout: 60000 });
      await humanDelay(3000, 5000);
      
      // Check login
      const url = page.url();
      if (url.includes('login')) {
        return { ok: false, reason: 'not_logged_in' };
      }
      
      // Click "+" to create story
      const createButtons = [
        'svg[aria-label="New post"]',
        'svg[aria-label="Create"]',
        'a[href="#"]:has(svg)'
      ];
      
      let clicked = false;
      for (const selector of createButtons) {
        const btn = page.locator(selector).first();
        if (await btn.count() > 0 && await btn.isVisible().catch(() => false)) {
          await btn.click();
          clicked = true;
          await humanDelay(2000, 3000);
          break;
        }
      }
      
      if (!clicked) {
        return { ok: false, reason: 'create_button_not_found' };
      }
      
      // Select "Story"
      const storyButton = page.locator('text=/Story|Cerita/i').first();
      if (await storyButton.count() > 0) {
        await storyButton.click();
        await humanDelay(2000, 3000);
      }
      
      // Upload file
      const fileInput = page.locator('input[type="file"]').first();
      await fileInput.setInputFiles(mediaPath);
      await humanDelay(5000, 8000); // Wait for upload
      
      // Add caption/text if provided
      if (caption) {
        const textButton = page.locator('text=/Text|Teks/i').first();
        if (await textButton.count() > 0) {
          await textButton.click();
          await humanDelay(1000, 2000);
          await page.keyboard.type(caption);
        }
      }
      
      // Post story
      const shareButtons = [
        'text=/Share|Bagikan|Your story/i',
        'button:has-text("Share")',
        'button:has-text("Bagikan")'
      ];
      
      let shared = false;
      for (const selector of shareButtons) {
        const btn = page.locator(selector).first();
        if (await btn.count() > 0 && await btn.isVisible().catch(() => false)) {
          await btn.click();
          shared = true;
          await humanDelay(5000, 8000);
          break;
        }
      }
      
      if (!shared) {
        return { ok: false, reason: 'share_button_not_found' };
      }
      
      console.log('[story] Instagram story posted successfully');
      return { ok: true, platform: 'instagram' };
      
    } catch (error) {
      console.error('[story] Error:', error.message);
      return { ok: false, reason: 'error: ' + error.message };
    } finally {
      await context.close().catch(() => {});
    }
  }

  /**
   * Post Facebook Story
   */
  async postFacebookStory(account, mediaPath, options = {}) {
    const { caption = '' } = options;
    const acc = require('./actions').withDecryptedPassword(account);
    const { context } = await openAccountBrowser(acc, { headless: false });
    const page = await context.newPage();
    
    try {
      await page.goto('https://www.facebook.com/', { timeout: 60000 });
      await humanDelay(3000, 5000);
      
      // Check login
      const url = page.url();
      if (url.includes('login')) {
        return { ok: false, reason: 'not_logged_in' };
      }
      
      // Click "Create Story"
      const storyButtons = [
        'a[href*="/stories/create"]',
        'text=/Create story|Buat cerita/i',
        'div[aria-label*="story" i][role="button"]'
      ];
      
      let clicked = false;
      for (const selector of storyButtons) {
        const btn = page.locator(selector).first();
        if (await btn.count() > 0 && await btn.isVisible().catch(() => false)) {
          await btn.click();
          clicked = true;
          await humanDelay(3000, 5000);
          break;
        }
      }
      
      if (!clicked) {
        return { ok: false, reason: 'story_button_not_found' };
      }
      
      // Upload media
      const fileInput = page.locator('input[type="file"]').first();
      await fileInput.waitFor({ state: 'attached', timeout: 10000 });
      await fileInput.setInputFiles(mediaPath);
      await humanDelay(5000, 8000);
      
      // Add text if provided
      if (caption) {
        const textArea = page.locator('textarea, div[contenteditable="true"]').first();
        if (await textArea.count() > 0) {
          await textArea.click();
          await humanDelay(1000, 2000);
          await page.keyboard.type(caption);
        }
      }
      
      // Post story
      const shareButtons = [
        'text=/Share to story|Bagikan ke cerita|Post/i',
        'div[aria-label*="Share" i][role="button"]'
      ];
      
      let shared = false;
      for (const selector of shareButtons) {
        const btn = page.locator(selector).first();
        if (await btn.count() > 0 && await btn.isVisible().catch(() => false)) {
          await btn.click();
          shared = true;
          await humanDelay(5000, 8000);
          break;
        }
      }
      
      if (!shared) {
        return { ok: false, reason: 'share_button_not_found' };
      }
      
      console.log('[story] Facebook story posted successfully');
      return { ok: true, platform: 'facebook' };
      
    } catch (error) {
      console.error('[story] Error:', error.message);
      return { ok: false, reason: 'error: ' + error.message };
    } finally {
      await context.close().catch(() => {});
    }
  }

  /**
   * Schedule story posting
   */
  async scheduleStory(accountId, mediaPath, platform, scheduledAt, options = {}) {
    await db.waitReady();
    
    // Create stories_schedule table
    db.run(`
      CREATE TABLE IF NOT EXISTS stories_schedule (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        account_id INTEGER NOT NULL,
        media_path TEXT NOT NULL,
        platform TEXT NOT NULL,
        caption TEXT,
        scheduled_at TEXT NOT NULL,
        status TEXT DEFAULT 'pending',
        posted_at TEXT,
        error TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (account_id) REFERENCES accounts(id)
      )
    `);
    
    db.run(
      `INSERT INTO stories_schedule (account_id, media_path, platform, caption, scheduled_at) 
       VALUES (?, ?, ?, ?, ?)`,
      [accountId, mediaPath, platform, options.caption || '', scheduledAt]
    );
    
    const id = db.lastInsertId();
    db.save();
    
    return { id, scheduled: true };
  }

  /**
   * Process scheduled stories
   */
  async processScheduled() {
    await db.waitReady();
    
    const now = new Date().toISOString();
    const stories = await db.rawAll(`
      SELECT s.*, a.* 
      FROM stories_schedule s
      JOIN accounts a ON a.id = s.account_id
      WHERE s.status = 'pending' AND s.scheduled_at <= ?
      ORDER BY s.scheduled_at ASC
      LIMIT 10
    `, [now]);
    
    const results = [];
    
    for (const story of stories) {
      try {
        let result;
        if (story.platform === 'instagram') {
          result = await this.postInstagramStory(story, story.media_path, {
            caption: story.caption
          });
        } else if (story.platform === 'facebook') {
          result = await this.postFacebookStory(story, story.media_path, {
            caption: story.caption
          });
        }
        
        if (result.ok) {
          db.run(
            'UPDATE stories_schedule SET status = ?, posted_at = datetime(\'now\') WHERE id = ?',
            ['done', story.id]
          );
        } else {
          db.run(
            'UPDATE stories_schedule SET status = ?, error = ? WHERE id = ?',
            ['failed', result.reason, story.id]
          );
        }
        
        db.save();
        results.push({ story, result });
        
      } catch (error) {
        console.error('[story] Process error:', error);
        db.run(
          'UPDATE stories_schedule SET status = ?, error = ? WHERE id = ?',
          ['failed', error.message, story.id]
        );
        db.save();
      }
      
      // Rate limiting between stories
      await humanDelay(30000, 60000);
    }
    
    return results;
  }
}

module.exports = new StoryAutomation();
