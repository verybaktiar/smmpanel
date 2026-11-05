/**
 * Default Configuration for Facebook Signup Automation
 * 
 * Copy .env.example to .env and update values
 */

export const config = {
  // Ammail Worker Configuration
  ammail: {
    baseUrl: process.env.AMMAIL_BASE_URL || 'https://your-worker.workers.dev',
    apiKey: process.env.AMMAIL_API_KEY || 'your-api-key',
    domain: process.env.AMMAIL_DOMAIN || 'yourdomain.com',
    fallbackUrl: process.env.AMMAIL_FALLBACK_URL || null,
    timeout: parseInt(process.env.AMMAIL_TIMEOUT || '20000', 10)
  },

  // Browser Configuration
  browser: {
    headless: process.env.HEADLESS === 'true',
    profilesDir: process.env.PROFILES_DIR || './automation/profiles',
    viewport: {
      width: 1366,
      height: 768
    },
    userAgent: null, // Will be randomized by anti-detection module
    locale: 'en-US',
    timezone: 'America/New_York',
    // Anti-detection features
    randomizeFingerprint: true,
    randomizeViewport: true,
    randomizeTimezone: true,
    randomizeLocale: true,
    useMouseMovement: true,
    useHumanTyping: true
  },

  // Facebook Configuration
  facebook: {
    signupUrl: 'https://www.facebook.com/reg',
    loginUrl: 'https://www.facebook.com/login',
    timeout: 60000, // 60 seconds for page loads
    navigationTimeout: 30000,
    minAge: 18,
    maxAge: 45
  },

  // CAPTCHA Configuration
  captcha: {
    service: process.env.CAPTCHA_SERVICE || '2captcha', // '2captcha' or 'anticaptcha'
    apiKey: process.env.CAPTCHA_API_KEY || '',
    timeout: 120000, // 2 minutes
    pollingInterval: 5000 // Check every 5 seconds
  },

  // Email Configuration
  email: {
    waitTimeout: 300000, // 5 minutes
    pollingInterval: 5000, // Check every 5 seconds
    maxAttempts: 60 // 60 * 5s = 5 minutes
  },

  // Retry Configuration
  retry: {
    maxAttempts: 3,
    delayMs: 5000,
    backoff: true
  },

  // Delays (in milliseconds) - More human-like with randomization
  delays: {
    typing: { min: 50, max: 200 }, // Per character (variable)
    thinkingWhileTyping: { min: 300, max: 800, chance: 0.15 }, // Random pauses
    betweenFields: { min: 800, max: 2000 }, // Increased from 500-1500
    afterPageLoad: { min: 2500, max: 5000 }, // Increased from 2000-4000
    beforeSubmit: { min: 1500, max: 3000 }, // Increased from 1000-2000
    mouseMovement: { min: 200, max: 500 },
    afterClick: { min: 300, max: 800 },
    scrolling: { min: 500, max: 1500 }
  },

  // Output Configuration
  output: {
    saveScreenshots: process.env.SAVE_SCREENSHOTS === 'true',
    screenshotDir: './automation/screenshots',
    saveCookies: true,
    cookiesDir: './automation/cookies',
    logLevel: process.env.LOG_LEVEL || 'info' // 'debug', 'info', 'warn', 'error'
  }
};
