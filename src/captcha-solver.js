'use strict';

const https = require('https');

/**
 * 2Captcha Solver Integration
 * Automatic captcha solving for login and registration
 */

class CaptchaSolver {
  constructor(apiKey = null) {
    this.apiKey = apiKey || process.env.TWOCAPTCHA_API_KEY || process.env.CAPTCHA_API_KEY;
    this.apiUrl = 'https://2captcha.com';
    this.timeout = 120000; // 2 minutes
  }

  /**
   * Submit captcha for solving
   */
  async submitCaptcha(params) {
    const { type, sitekey, pageurl, data, method = 'userrecaptcha' } = params;
    
    if (!this.apiKey) {
      throw new Error('2Captcha API key not configured');
    }

    const requestData = new URLSearchParams({
      key: this.apiKey,
      method,
      googlekey: sitekey,
      pageurl,
      json: 1
    });

    if (data) {
      requestData.append('data', data);
    }

    const response = await this.makeRequest('/in.php', requestData.toString());
    
    if (response.status !== 1) {
      throw new Error(`2Captcha submit failed: ${response.request}`);
    }

    return response.request; // captcha ID
  }

  /**
   * Get captcha solution
   */
  async getCaptchaSolution(captchaId) {
    const startTime = Date.now();
    
    while (Date.now() - startTime < this.timeout) {
      await this.sleep(5000); // Wait 5 seconds between checks
      
      const response = await this.makeRequest('/res.php', 
        `key=${this.apiKey}&action=get&id=${captchaId}&json=1`
      );
      
      if (response.status === 1) {
        return response.request; // solution
      }
      
      if (response.request !== 'CAPCHA_NOT_READY') {
        throw new Error(`2Captcha error: ${response.request}`);
      }
    }
    
    throw new Error('Captcha solving timeout');
  }

  /**
   * Solve reCAPTCHA v2
   */
  async solveRecaptchaV2(sitekey, pageurl) {
    console.log(`[captcha] Solving reCAPTCHA v2 for ${pageurl}`);
    
    const captchaId = await this.submitCaptcha({
      type: 'recaptcha',
      sitekey,
      pageurl,
      method: 'userrecaptcha'
    });
    
    console.log(`[captcha] Submitted, ID: ${captchaId}`);
    
    const solution = await this.getCaptchaSolution(captchaId);
    
    console.log(`[captcha] Solved successfully`);
    
    return solution;
  }

  /**
   * Solve reCAPTCHA v3
   */
  async solveRecaptchaV3(sitekey, pageurl, action = 'verify', minScore = 0.3) {
    console.log(`[captcha] Solving reCAPTCHA v3 for ${pageurl}`);
    
    const requestData = new URLSearchParams({
      key: this.apiKey,
      method: 'userrecaptcha',
      version: 'v3',
      googlekey: sitekey,
      pageurl,
      action,
      min_score: minScore,
      json: 1
    });
    
    const response = await this.makeRequest('/in.php', requestData.toString());
    
    if (response.status !== 1) {
      throw new Error(`2Captcha submit failed: ${response.request}`);
    }
    
    const solution = await this.getCaptchaSolution(response.request);
    
    console.log(`[captcha] Solved successfully`);
    
    return solution;
  }

  /**
   * Solve hCaptcha
   */
  async solveHCaptcha(sitekey, pageurl) {
    console.log(`[captcha] Solving hCaptcha for ${pageurl}`);
    
    const requestData = new URLSearchParams({
      key: this.apiKey,
      method: 'hcaptcha',
      sitekey,
      pageurl,
      json: 1
    });
    
    const response = await this.makeRequest('/in.php', requestData.toString());
    
    if (response.status !== 1) {
      throw new Error(`2Captcha submit failed: ${response.request}`);
    }
    
    const solution = await this.getCaptchaSolution(response.request);
    
    console.log(`[captcha] Solved successfully`);
    
    return solution;
  }

  /**
   * Solve image captcha
   */
  async solveImageCaptcha(base64Image) {
    console.log(`[captcha] Solving image captcha`);
    
    const requestData = new URLSearchParams({
      key: this.apiKey,
      method: 'base64',
      body: base64Image,
      json: 1
    });
    
    const response = await this.makeRequest('/in.php', requestData.toString());
    
    if (response.status !== 1) {
      throw new Error(`2Captcha submit failed: ${response.request}`);
    }
    
    const solution = await this.getCaptchaSolution(response.request);
    
    console.log(`[captcha] Solved: ${solution}`);
    
    return solution;
  }

  /**
   * Get account balance
   */
  async getBalance() {
    const response = await this.makeRequest('/res.php',
      `key=${this.apiKey}&action=getbalance&json=1`
    );
    
    if (response.status === 1) {
      return parseFloat(response.request);
    }
    
    throw new Error('Failed to get balance');
  }

  /**
   * Report bad captcha
   */
  async reportBad(captchaId) {
    const response = await this.makeRequest('/res.php',
      `key=${this.apiKey}&action=reportbad&id=${captchaId}&json=1`
    );
    
    return response.status === 1;
  }

  /**
   * Make HTTP request to 2Captcha API
   */
  makeRequest(path, data) {
    return new Promise((resolve, reject) => {
      const options = {
        hostname: '2captcha.com',
        path,
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(data)
        }
      };
      
      const req = https.request(options, (res) => {
        let body = '';
        
        res.on('data', (chunk) => {
          body += chunk;
        });
        
        res.on('end', () => {
          try {
            const json = JSON.parse(body);
            resolve(json);
          } catch (e) {
            reject(new Error(`Invalid JSON response: ${body}`));
          }
        });
      });
      
      req.on('error', reject);
      req.write(data);
      req.end();
    });
  }

  /**
   * Sleep helper
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Set API key
   */
  setApiKey(apiKey) {
    this.apiKey = apiKey;
  }
}

module.exports = new CaptchaSolver();
