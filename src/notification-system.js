'use strict';

const https = require('https');
const http = require('http');
const { URL } = require('url');

/**
 * Notification System
 * Send notifications via Email, Telegram, Discord, and SMS
 */

class NotificationSystem {
  constructor() {
    this.channels = {
      email: process.env.EMAIL_ENABLED === 'true',
      telegram: !!process.env.TELEGRAM_BOT_TOKEN,
      discord: !!process.env.DISCORD_WEBHOOK_URL,
      sms: !!process.env.SMS_API_KEY,
      whatsapp: !!process.env.FONNTE_TOKEN
    };
  }

  /**
   * Send notification to all enabled channels
   */
  async send(message, options = {}) {
    const {
      title = 'SMM Panel Notification',
      priority = 'normal', // low, normal, high
      channels = ['email', 'telegram', 'discord']
    } = options;

    const results = {};

    for (const channel of channels) {
      if (this.channels[channel]) {
        try {
          results[channel] = await this[`send${channel.charAt(0).toUpperCase() + channel.slice(1)}`](title, message, priority);
        } catch (error) {
          results[channel] = { success: false, error: error.message };
        }
      } else {
        results[channel] = { success: false, error: 'Channel not configured' };
      }
    }

    return results;
  }

  /**
   * Send Telegram notification
   */
  async sendTelegram(title, message, priority) {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;

    if (!botToken || !chatId) {
      throw new Error('Telegram not configured');
    }

    const emoji = priority === 'high' ? '🚨' : priority === 'low' ? 'ℹ️' : '📢';
    const text = `${emoji} *${title}*\n\n${message}`;

    const params = new URLSearchParams({
      chat_id: chatId,
      text,
      parse_mode: 'Markdown'
    });

    const url = `https://api.telegram.org/bot${botToken}/sendMessage?${params}`;

    const response = await this.makeHttpRequest(url);
    
    if (!response.ok) {
      throw new Error(`Telegram API error: ${response.description}`);
    }

    console.log('[notification] Telegram sent');
    return { success: true, messageId: response.result.message_id };
  }

  /**
   * Send Discord webhook notification
   */
  async sendDiscord(title, message, priority) {
    const webhookUrl = process.env.DISCORD_WEBHOOK_URL;

    if (!webhookUrl) {
      throw new Error('Discord not configured');
    }

    const color = priority === 'high' ? 0xFF0000 : priority === 'low' ? 0x808080 : 0x3B88C3;

    const payload = {
      embeds: [{
        title,
        description: message,
        color,
        timestamp: new Date().toISOString()
      }]
    };

    await this.makeHttpRequest(webhookUrl, 'POST', JSON.stringify(payload), {
      'Content-Type': 'application/json'
    });

    console.log('[notification] Discord sent');
    return { success: true };
  }

  /**
   * Send Email notification (using SMTP or API)
   */
  async sendEmail(title, message, priority) {
    // This is a placeholder - implement based on your email provider
    // Options: SendGrid, Mailgun, AWS SES, SMTP, etc.
    
    const emailTo = process.env.EMAIL_TO;
    const emailFrom = process.env.EMAIL_FROM;

    if (!emailTo || !emailFrom) {
      throw new Error('Email not configured');
    }

    console.log(`[notification] Email would be sent to: ${emailTo}`);
    console.log(`Subject: ${title}`);
    console.log(`Body: ${message}`);

    // TODO: Implement actual email sending
    // For now, just log
    return { success: true, note: 'Email logging only - implement actual sending' };
  }

  /**
   * Send WhatsApp notification via Fonnte (https://fonnte.com) — gratis, pakai WA personal.
   * Env: FONNTE_TOKEN (token device), WHATSAPP_TO (nomor tujuan, opsional bila device single-target).
   */
  async sendWhatsapp(title, message, priority) {
    const token = process.env.FONNTE_TOKEN;
    if (!token) throw new Error('WhatsApp not configured');

    const emoji = priority === 'high' ? '🚨' : priority === 'low' ? 'ℹ️' : '📢';
    const body = new URLSearchParams({
      target: process.env.WHATSAPP_TO || '',
      message: `${emoji} *${title}*\n\n${message}`
    });

    const res = await this.makeHttpRequest('https://api.fonnte.com/send', 'POST', body.toString(), {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': token
    });

    if (res && res.status === false) {
      throw new Error(`Fonnte error: ${res.reason || 'unknown'}`);
    }

    console.log('[notification] WhatsApp sent');
    return { success: true };
  }

  /**
   * Send SMS notification
   */
  async sendSms(title, message, priority) {
    // Placeholder for SMS service (Twilio, Nexmo, etc.)
    const phoneNumber = process.env.SMS_PHONE_NUMBER;

    if (!phoneNumber) {
      throw new Error('SMS not configured');
    }

    console.log(`[notification] SMS would be sent to: ${phoneNumber}`);
    console.log(`Message: ${title} - ${message}`);

    // TODO: Implement actual SMS sending
    return { success: true, note: 'SMS logging only - implement actual sending' };
  }

  /**
   * Make HTTP request
   */
  async makeHttpRequest(url, method = 'GET', body = null, headers = {}) {
    return new Promise((resolve, reject) => {
      const urlObj = new URL(url);
      const lib = urlObj.protocol === 'https:' ? https : http;

      const options = {
        hostname: urlObj.hostname,
        port: urlObj.port,
        path: urlObj.pathname + urlObj.search,
        method,
        headers: {
          'User-Agent': 'SMM-Panel-Notifier',
          ...headers
        }
      };

      if (body) {
        options.headers['Content-Length'] = Buffer.byteLength(body);
      }

      const req = lib.request(options, (res) => {
        let data = '';

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            resolve(json);
          } catch (e) {
            resolve({ success: true, raw: data });
          }
        });
      });

      req.on('error', reject);

      if (body) {
        req.write(body);
      }

      req.end();
    });
  }

  /**
   * Notify account banned
   */
  async notifyAccountBanned(accountName, reason) {
    return await this.send(
      `Account "${accountName}" has been banned or suspended.\nReason: ${reason}`,
      {
        title: '⚠️ Account Banned',
        priority: 'high',
        channels: ['telegram', 'discord', 'email']
      }
    );
  }

  /**
   * Notify order completed
   */
  async notifyOrderCompleted(orderId, successCount, failedCount) {
    return await this.send(
      `Order #${orderId} completed.\n✅ Success: ${successCount}\n❌ Failed: ${failedCount}`,
      {
        title: '✅ Order Completed',
        priority: 'normal',
        channels: ['telegram', 'discord']
      }
    );
  }

  /**
   * Notify low proxy health
   */
  async notifyLowProxyHealth(workingCount, totalCount) {
    const percentage = Math.round((workingCount / totalCount) * 100);
    
    return await this.send(
      `Proxy health is low: ${workingCount}/${totalCount} (${percentage}%) proxies working.`,
      {
        title: '⚠️ Low Proxy Health',
        priority: 'high',
        channels: ['telegram', 'email']
      }
    );
  }

  /**
   * Notify system error
   */
  async notifySystemError(error, context = '') {
    return await this.send(
      `System error occurred${context ? ' in ' + context : ''}:\n${error}`,
      {
        title: '🚨 System Error',
        priority: 'high',
        channels: ['telegram', 'discord', 'email']
      }
    );
  }

  /**
   * Test notification (send to all channels)
   */
  async testNotifications() {
    return await this.send(
      'This is a test notification from SMM Panel. All systems operational.',
      {
        title: '🧪 Test Notification',
        priority: 'low',
        channels: ['email', 'telegram', 'discord', 'sms']
      }
    );
  }
}

module.exports = new NotificationSystem();
