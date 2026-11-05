/**
 * Facebook Account Auto-Signup with Camoufox + Playwright + Ammail
 * 
 * Usage:
 *   node automation/fb-signup.js --email test@example.com --password MyPass123
 *   node automation/fb-signup.js --auto --proxy "host:port:user:pass"
 */

import { chromium } from 'playwright';
import { TempMailClient } from '../_extract/ammail-client/index.js';
import { extractOtp } from '../_extract/ammail-client/otp-extractor.js';
import { generateName } from './utils/name-generator.js';
import { generateBirthdate, generateGender, randomDelay, sleep } from './utils/date-generator.js';
import { parseProxy } from './utils/proxy-parser.js';
import { logger } from './utils/logger.js';
import { config } from './config/default.js';
import {
  typeHumanLike,
  humanClick,
  humanDelay,
  moveMouseToElement,
  randomScroll,
  getEnhancedLaunchOptions,
  getAntiFingerprint,
  randomActionDelay
} from './utils/anti-detection.js';
import fs from 'fs/promises';
import path from 'path';

/**
 * Main Facebook Signup Class
 */
class FacebookSignup {
  constructor(options = {}) {
    this.options = {
      email: options.email || null,
      password: options.password || null,
      firstName: options.firstName || null,
      lastName: options.lastName || null,
      birthday: options.birthday || null,
      gender: options.gender || null,
      proxy: options.proxy || null,
      headless: options.headless !== undefined ? options.headless : config.browser.headless,
      profilesDir: options.profilesDir || config.browser.profilesDir
    };

    this.browser = null;
    this.context = null;
    this.page = null;
    this.tempMailClient = null;
    this.inboxAlias = null;
    this.result = {
      status: 'failed',
      email: null,
      password: null,
      cookies: null,
      error: null,
      steps: []
    };
  }

  /**
   * Add step to result
   */
  addStep(step, success = true, message = '') {
    this.result.steps.push({
      step,
      success,
      message,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Initialize temp email client
   */
  async initTempMail() {
    logger.step('Initializing temp email client...');
    
    this.tempMailClient = new TempMailClient({
      baseUrl: config.ammail.baseUrl,
      apiKey: config.ammail.apiKey,
      domain: config.ammail.domain,
      fallbackUrl: config.ammail.fallbackUrl,
      timeout: config.ammail.timeout
    });

    try {
      const health = await this.tempMailClient.health();
      logger.success(`Temp email service: ${health.status}`);
      this.addStep('init_tempmail', true, health.status);
      return true;
    } catch (error) {
      logger.error('Temp email service unavailable:', error.message);
      this.addStep('init_tempmail', false, error.message);
      return false;
    }
  }

  /**
   * Create or use existing email
   */
  async setupEmail() {
    logger.step('Setting up email...');

    if (this.options.email && this.options.email.includes('@')) {
      // Use provided email
      logger.info(`Using provided email: ${this.options.email}`);
      this.result.email = this.options.email;
      
      // Extract alias for temp mail
      const [alias, domain] = this.options.email.split('@');
      if (domain === config.ammail.domain) {
        this.inboxAlias = alias;
        try {
          await this.tempMailClient.createInbox(alias);
          logger.success(`Created inbox: ${this.options.email}`);
        } catch (error) {
          if (error.message.includes('already exists')) {
            logger.info('Inbox already exists, continuing...');
          } else {
            throw error;
          }
        }
      }
      
      this.addStep('setup_email', true, this.options.email);
      return this.options.email;
    }

    // Generate random email
    const alias = `fb${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const inbox = await this.tempMailClient.createInbox(alias);
    this.result.email = inbox.email;
    this.inboxAlias = alias;
    
    logger.success(`Created email: ${inbox.email}`);
    this.addStep('setup_email', true, inbox.email);
    return inbox.email;
  }

  /**
   * Launch browser with enhanced anti-detection
   */
  async launchBrowser() {
    logger.step('Launching browser with anti-detection...');

    // Get enhanced launch options with randomized fingerprint
    const enhancedOptions = getEnhancedLaunchOptions({
      headless: this.options.headless
    });

    // Add proxy if provided
    if (this.options.proxy) {
      const proxyConfig = parseProxy(this.options.proxy);
      if (proxyConfig) {
        enhancedOptions.proxy = proxyConfig;
        logger.info(`Using proxy: ${proxyConfig.server}`);
      } else {
        logger.warn('Invalid proxy format, continuing without proxy');
      }
    }

    try {
      // Launch browser with enhanced options
      this.browser = await chromium.launch({
        headless: enhancedOptions.headless,
        args: enhancedOptions.args
      });

      // Create context with randomized fingerprint
      this.context = await this.browser.newContext({
        viewport: enhancedOptions.viewport,
        userAgent: enhancedOptions.userAgent,
        locale: enhancedOptions.locale,
        timezoneId: enhancedOptions.timezoneId,
        permissions: enhancedOptions.permissions,
        geolocation: enhancedOptions.geolocation,
        colorScheme: enhancedOptions.colorScheme,
        deviceScaleFactor: enhancedOptions.deviceScaleFactor,
        isMobile: enhancedOptions.isMobile,
        hasTouch: enhancedOptions.hasTouch
      });

      // Inject anti-fingerprinting script
      await this.context.addInitScript(getAntiFingerprint());
      
      this.page = await this.context.newPage();
      
      logger.success(`Browser launched: ${enhancedOptions.viewport.width}x${enhancedOptions.viewport.height}, ${enhancedOptions.locale}, ${enhancedOptions.timezoneId}`);
      this.addStep('launch_browser', true);
      return true;
    } catch (error) {
      logger.error('Failed to launch browser:', error.message);
      this.addStep('launch_browser', false, error.message);
      throw error;
    }
  }

  /**
   * Navigate to Facebook signup page with human-like behavior
   */
  async navigateToSignup() {
    logger.step('Navigating to Facebook signup page...');

    try {
      await this.page.goto(config.facebook.signupUrl, {
        waitUntil: 'domcontentloaded',
        timeout: config.facebook.navigationTimeout
      });

      // Human-like delay after page load
      await humanDelay(
        config.delays.afterPageLoad.min,
        config.delays.afterPageLoad.max
      );
      
      // Simulate reading the page with random scroll
      await randomScroll(this.page);
      await randomActionDelay('reading');
      
      logger.success('Loaded Facebook signup page');
      this.addStep('navigate_signup', true);
      return true;
    } catch (error) {
      logger.error('Failed to load signup page:', error.message);
      this.addStep('navigate_signup', false, error.message);
      throw error;
    }
  }

  /**
   * Fill signup form
   */
  async fillSignupForm() {
    logger.step('Filling signup form...');

    try {
      // Generate user data if not provided
      const gender = this.options.gender || generateGender();
      const name = generateName(gender);
      const firstName = this.options.firstName || name.firstName;
      const lastName = this.options.lastName || name.lastName;
      const birthdate = this.options.birthday || generateBirthdate(
        config.facebook.minAge,
        config.facebook.maxAge
      );
      const password = this.options.password || this.generatePassword();

      this.result.password = password;

      logger.info(`Name: ${firstName} ${lastName}`);
      logger.info(`Birthday: ${birthdate.year}-${birthdate.month}-${birthdate.day}`);
      logger.info(`Gender: ${gender}`);

      // Wait for form to be visible
      await this.page.waitForSelector('input[name="firstname"]', { timeout: 10000 });

      // Simulate reading the form
      await randomScroll(this.page);
      await randomActionDelay('reading');

      // Fill first name with human-like typing
      const firstNameField = await this.page.$('input[name="firstname"]');
      await moveMouseToElement(this.page, firstNameField);
      await typeHumanLike(firstNameField, firstName, {
        minDelay: config.delays.typing.min,
        maxDelay: config.delays.typing.max,
        thinkingPauseChance: config.delays.thinkingWhileTyping.chance,
        thinkingPauseMin: config.delays.thinkingWhileTyping.min,
        thinkingPauseMax: config.delays.thinkingWhileTyping.max
      });
      await humanDelay(config.delays.betweenFields.min, config.delays.betweenFields.max);

      // Fill last name
      const lastNameField = await this.page.$('input[name="lastname"]');
      await moveMouseToElement(this.page, lastNameField);
      await typeHumanLike(lastNameField, lastName, {
        minDelay: config.delays.typing.min,
        maxDelay: config.delays.typing.max,
        thinkingPauseChance: config.delays.thinkingWhileTyping.chance,
        thinkingPauseMin: config.delays.thinkingWhileTyping.min,
        thinkingPauseMax: config.delays.thinkingWhileTyping.max
      });
      await humanDelay(config.delays.betweenFields.min, config.delays.betweenFields.max);

      // Fill email
      const emailField = await this.page.$('input[name="reg_email__"]');
      await moveMouseToElement(this.page, emailField);
      await typeHumanLike(emailField, this.result.email, {
        minDelay: config.delays.typing.min,
        maxDelay: config.delays.typing.max,
        thinkingPauseChance: config.delays.thinkingWhileTyping.chance,
        thinkingPauseMin: config.delays.thinkingWhileTyping.min,
        thinkingPauseMax: config.delays.thinkingWhileTyping.max
      });
      await humanDelay(config.delays.betweenFields.min, config.delays.betweenFields.max);

      // Confirm email (if field exists)
      const confirmEmailField = await this.page.$('input[name="reg_email_confirmation__"]');
      if (confirmEmailField) {
        await moveMouseToElement(this.page, confirmEmailField);
        await typeHumanLike(confirmEmailField, this.result.email, {
          minDelay: config.delays.typing.min,
          maxDelay: config.delays.typing.max,
          thinkingPauseChance: config.delays.thinkingWhileTyping.chance,
          thinkingPauseMin: config.delays.thinkingWhileTyping.min,
          thinkingPauseMax: config.delays.thinkingWhileTyping.max
        });
        await humanDelay(config.delays.betweenFields.min, config.delays.betweenFields.max);
      }

      // Fill password
      const passwordField = await this.page.$('input[name="reg_passwd__"]');
      await moveMouseToElement(this.page, passwordField);
      await typeHumanLike(passwordField, password, {
        minDelay: config.delays.typing.min,
        maxDelay: config.delays.typing.max,
        thinkingPauseChance: config.delays.thinkingWhileTyping.chance,
        thinkingPauseMin: config.delays.thinkingWhileTyping.min,
        thinkingPauseMax: config.delays.thinkingWhileTyping.max
      });
      await humanDelay(config.delays.betweenFields.min, config.delays.betweenFields.max);

      // Select birthday with human-like delays
      await randomScroll(this.page);
      await humanDelay(500, 1000);
      
      const monthSelect = await this.page.$('select[name="birthday_month"]');
      await humanClick(this.page, monthSelect);
      await this.page.selectOption('select[name="birthday_month"]', birthdate.month);
      await humanDelay(300, 600);
      
      const daySelect = await this.page.$('select[name="birthday_day"]');
      await humanClick(this.page, daySelect);
      await this.page.selectOption('select[name="birthday_day"]', birthdate.day);
      await humanDelay(300, 600);
      
      const yearSelect = await this.page.$('select[name="birthday_year"]');
      await humanClick(this.page, yearSelect);
      await this.page.selectOption('select[name="birthday_year"]', birthdate.year);
      await humanDelay(config.delays.betweenFields.min, config.delays.betweenFields.max);

      // Select gender with human-like click
      const genderValue = gender === 'male' ? '2' : '1';
      const genderRadio = await this.page.$(`input[name="sex"][value="${genderValue}"]`);
      await humanClick(this.page, genderRadio);
      await humanDelay(1000, 2000);

      logger.success('Form filled successfully');
      this.addStep('fill_form', true);
      return true;
    } catch (error) {
      logger.error('Failed to fill form:', error.message);
      this.addStep('fill_form', false, error.message);
      
      // Save screenshot for debugging
      if (config.output.saveScreenshots) {
        await this.saveScreenshot('form-fill-error');
      }
      
      throw error;
    }
  }

  /**
   * Submit signup form with human-like behavior
   */
  async submitForm() {
    logger.step('Submitting signup form...');

    try {
      // Wait before submit (human-like behavior - review the form)
      await randomScroll(this.page);
      await humanDelay(
        config.delays.beforeSubmit.min,
        config.delays.beforeSubmit.max
      );

      // Find and click signup button with human-like movement
      const submitButton = await this.page.$('button[name="websubmit"]');
      if (!submitButton) {
        throw new Error('Submit button not found');
      }
      
      await humanClick(this.page, submitButton);
      logger.info('Form submitted, waiting for response...');

      // Wait for navigation or error
      await Promise.race([
        this.page.waitForNavigation({ timeout: 30000 }),
        this.page.waitForSelector('[role="alert"]', { timeout: 30000 }).then(() => {
          throw new Error('Form validation error');
        })
      ]);

      logger.success('Form submitted successfully');
      this.addStep('submit_form', true);
      return true;
    } catch (error) {
      logger.error('Failed to submit form:', error.message);
      this.addStep('submit_form', false, error.message);
      
      // Save screenshot
      if (config.output.saveScreenshots) {
        await this.saveScreenshot('form-submit-error');
      }
      
      throw error;
    }
  }

  /**
   * Wait for verification email and extract OTP
   */
  async waitForVerificationEmail() {
    logger.step('Waiting for verification email...');

    if (!this.inboxAlias) {
      logger.warn('No inbox alias, skipping email verification');
      this.addStep('wait_email', false, 'No inbox alias');
      return null;
    }

    let attempts = 0;
    const maxAttempts = config.email.maxAttempts;

    while (attempts < maxAttempts) {
      await sleep(config.email.pollingInterval);
      attempts++;

      process.stdout.write('.');

      try {
        const messages = await this.tempMailClient.listMessages(this.inboxAlias);
        
        if (messages.length === 0) continue;

        logger.info(`\nFound ${messages.length} message(s)!`);

        // Get the latest message
        const msg = await this.tempMailClient.getMessage(messages[0].id);
        
        // Extract OTP or verification URL
        const { code, verifyUrl } = extractOtp(
          msg.text || '',
          msg.html || '',
          msg.subject || ''
        );

        if (code || verifyUrl) {
          logger.success(`Verification received: ${code || verifyUrl}`);
          this.addStep('wait_email', true, `Code: ${code}, URL: ${verifyUrl}`);
          return { code, verifyUrl };
        }

        logger.warn('Email received but no OTP/URL found');
      } catch (error) {
        logger.debug('Error checking email:', error.message);
      }
    }

    logger.error('\nTimeout: No verification email received');
    this.addStep('wait_email', false, 'Timeout');
    return null;
  }

  /**
   * Submit verification code
   */
  async submitVerificationCode(code) {
    logger.step(`Submitting verification code: ${code}`);

    try {
      // Wait for code input field
      await this.page.waitForSelector('input[name="code"]', { timeout: 10000 });
      
      // Type code
      await this.typeHuman('input[name="code"]', code);
      await randomDelay(500, 1000);

      // Click submit
      await this.page.click('button[type="submit"]');
      await randomDelay(2000, 3000);

      logger.success('Verification code submitted');
      this.addStep('submit_code', true);
      return true;
    } catch (error) {
      logger.error('Failed to submit verification code:', error.message);
      this.addStep('submit_code', false, error.message);
      return false;
    }
  }

  /**
   * Extract session cookies
   */
  async extractCookies() {
    logger.step('Extracting session cookies...');

    try {
      const cookies = await this.context.cookies();
      
      const sessionCookies = cookies.filter(c => 
        ['c_user', 'xs', 'datr', 'fr'].includes(c.name)
      );

      if (sessionCookies.length > 0) {
        this.result.cookies = sessionCookies;
        logger.success(`Extracted ${sessionCookies.length} session cookies`);
        this.addStep('extract_cookies', true, `${sessionCookies.length} cookies`);
        
        // Save cookies to file
        if (config.output.saveCookies) {
          await this.saveCookies(sessionCookies);
        }
        
        return sessionCookies;
      }

      logger.warn('No session cookies found');
      this.addStep('extract_cookies', false, 'No cookies found');
      return null;
    } catch (error) {
      logger.error('Failed to extract cookies:', error.message);
      this.addStep('extract_cookies', false, error.message);
      return null;
    }
  }

  /**
   * Save screenshot
   */
  async saveScreenshot(name) {
    try {
      await fs.mkdir(config.output.screenshotDir, { recursive: true });
      const filename = `${name}-${Date.now()}.png`;
      const filepath = path.join(config.output.screenshotDir, filename);
      await this.page.screenshot({ path: filepath, fullPage: true });
      logger.debug(`Screenshot saved: ${filepath}`);
    } catch (error) {
      logger.debug('Failed to save screenshot:', error.message);
    }
  }

  /**
   * Save cookies to file
   */
  async saveCookies(cookies) {
    try {
      await fs.mkdir(config.output.cookiesDir, { recursive: true });
      const filename = `${this.result.email.replace(/[^a-z0-9]/gi, '_')}.json`;
      const filepath = path.join(config.output.cookiesDir, filename);
      await fs.writeFile(filepath, JSON.stringify(cookies, null, 2));
      logger.debug(`Cookies saved: ${filepath}`);
    } catch (error) {
      logger.debug('Failed to save cookies:', error.message);
    }
  }

  /**
   * Generate random password
   */
  generatePassword() {
    const length = 12;
    const charset = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%';
    let password = '';
    for (let i = 0; i < length; i++) {
      password += charset.charAt(Math.floor(Math.random() * charset.length));
    }
    return password;
  }

  /**
   * Cleanup resources
   */
  async cleanup() {
    logger.step('Cleaning up...');

    try {
      if (this.page) await this.page.close();
      if (this.context) await this.context.close();
      if (this.browser) await this.browser.close();
      
      // Optionally delete inbox
      if (this.inboxAlias && this.tempMailClient) {
        try {
          await this.tempMailClient.deleteInbox(this.inboxAlias);
          logger.debug(`Deleted inbox: ${this.inboxAlias}`);
        } catch (error) {
          logger.debug('Failed to delete inbox:', error.message);
        }
      }

      logger.success('Cleanup completed');
    } catch (error) {
      logger.warn('Cleanup error:', error.message);
    }
  }

  /**
   * Run the full signup flow
   */
  async run() {
    try {
      logger.info('🚀 Starting Facebook account creation...\n');

      // Initialize temp mail
      await this.initTempMail();

      // Setup email
      await this.setupEmail();

      // Launch browser
      await this.launchBrowser();

      // Navigate to signup
      await this.navigateToSignup();

      // Fill form
      await this.fillSignupForm();

      // Submit form
      await this.submitForm();

      // Wait for verification email
      const verification = await this.waitForVerificationEmail();

      if (verification && verification.code) {
        // Submit verification code
        await this.submitVerificationCode(verification.code);
      } else if (verification && verification.verifyUrl) {
        // Open verification URL
        logger.info('Opening verification URL...');
        await this.page.goto(verification.verifyUrl);
        await randomDelay(3000, 5000);
      }

      // Extract cookies
      await this.extractCookies();

      // Check if we're logged in
      const currentUrl = this.page.url();
      if (currentUrl.includes('facebook.com') && !currentUrl.includes('/login')) {
        this.result.status = 'success';
        logger.success('\n✅ Account created successfully!');
      } else {
        this.result.status = 'partial';
        logger.warn('\n⚠️  Account created but verification incomplete');
      }

    } catch (error) {
      this.result.status = 'failed';
      this.result.error = error.message;
      logger.error('\n❌ Account creation failed:', error.message);
    } finally {
      await this.cleanup();
    }

    return this.result;
  }
}

export default FacebookSignup;
