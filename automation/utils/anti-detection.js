/**
 * Anti-Detection & Anti-Fingerprinting Utilities
 * Implements human-like behavior patterns to avoid bot detection
 */

/**
 * Random screen resolutions (common desktop sizes)
 */
const SCREEN_RESOLUTIONS = [
  { width: 1920, height: 1080 },
  { width: 1366, height: 768 },
  { width: 1536, height: 864 },
  { width: 1440, height: 900 },
  { width: 1600, height: 900 },
  { width: 1280, height: 720 },
  { width: 1280, height: 800 },
  { width: 1680, height: 1050 }
];

/**
 * Common timezones
 */
const TIMEZONES = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Phoenix',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Asia/Tokyo',
  'Asia/Shanghai',
  'Australia/Sydney'
];

/**
 * Common locales
 */
const LOCALES = [
  'en-US',
  'en-GB',
  'en-CA',
  'en-AU',
  'de-DE',
  'fr-FR',
  'es-ES',
  'it-IT',
  'ja-JP',
  'zh-CN'
];

/**
 * Realistic user agents (updated for 2026)
 */
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:130.0) Gecko/20100101 Firefox/130.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 Edg/128.0.0.0',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'
];

/**
 * Get random element from array
 */
function randomChoice(array) {
  return array[Math.floor(Math.random() * array.length)];
}

/**
 * Generate random screen resolution
 */
export function getRandomResolution() {
  return randomChoice(SCREEN_RESOLUTIONS);
}

/**
 * Generate random timezone
 */
export function getRandomTimezone() {
  return randomChoice(TIMEZONES);
}

/**
 * Generate random locale
 */
export function getRandomLocale() {
  return randomChoice(LOCALES);
}

/**
 * Generate random user agent
 */
export function getRandomUserAgent() {
  return randomChoice(USER_AGENTS);
}

/**
 * Human-like delay with occasional longer pauses (thinking time)
 * @param {number} min - Minimum delay in ms
 * @param {number} max - Maximum delay in ms
 * @returns {Promise<number>} - Actual delay used
 */
export async function humanDelay(min = 1000, max = 3000) {
  const delay = Math.floor(Math.random() * (max - min + 1)) + min;
  
  // 10% chance of adding a longer "thinking" pause
  if (Math.random() < 0.1) {
    const thinkingDelay = delay + Math.floor(Math.random() * 3000) + 2000;
    await sleep(thinkingDelay);
    return thinkingDelay;
  }
  
  await sleep(delay);
  return delay;
}

/**
 * Basic sleep function
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Type text in a human-like manner with variable delays and thinking pauses
 * @param {Object} element - Playwright element
 * @param {string} text - Text to type
 * @param {Object} options - Options
 */
export async function typeHumanLike(element, text, options = {}) {
  const {
    minDelay = 50,
    maxDelay = 200,
    thinkingPauseChance = 0.15,
    thinkingPauseMin = 300,
    thinkingPauseMax = 800
  } = options;

  // Click and wait a bit before typing
  await element.click();
  await sleep(Math.floor(Math.random() * 200) + 100);
  
  for (const char of text) {
    // Variable delay per character
    const charDelay = Math.floor(Math.random() * (maxDelay - minDelay + 1)) + minDelay;
    await element.type(char, { delay: charDelay });
    
    // Random thinking pauses while typing
    if (Math.random() < thinkingPauseChance) {
      const pauseDelay = Math.floor(Math.random() * (thinkingPauseMax - thinkingPauseMin + 1)) + thinkingPauseMin;
      await sleep(pauseDelay);
    }
  }
}

/**
 * Simulate mouse movement to an element before clicking
 * @param {Object} page - Playwright page
 * @param {Object} element - Element to move to
 */
export async function moveMouseToElement(page, element) {
  try {
    const box = await element.boundingBox();
    if (!box) return;
    
    // Get current mouse position (or start from random position)
    const startX = Math.floor(Math.random() * 200) + 100;
    const startY = Math.floor(Math.random() * 200) + 100;
    
    // Target position (random point within element)
    const targetX = box.x + Math.floor(Math.random() * box.width);
    const targetY = box.y + Math.floor(Math.random() * box.height);
    
    // Number of steps for smooth movement
    const steps = Math.floor(Math.random() * 10) + 15;
    
    // Move mouse in steps
    for (let i = 0; i <= steps; i++) {
      const progress = i / steps;
      const x = startX + (targetX - startX) * progress;
      const y = startY + (targetY - startY) * progress;
      
      await page.mouse.move(x, y);
      await sleep(Math.floor(Math.random() * 20) + 10);
    }
    
    // Small pause before click
    await sleep(Math.floor(Math.random() * 200) + 100);
  } catch (error) {
    // Silently continue if mouse movement fails
  }
}

/**
 * Click element with human-like behavior (hover + delay + click)
 * @param {Object} page - Playwright page
 * @param {Object} element - Element to click
 */
export async function humanClick(page, element) {
  // Move mouse to element
  await moveMouseToElement(page, element);
  
  // Hover for a moment
  await element.hover();
  await sleep(Math.floor(Math.random() * 300) + 200);
  
  // Click
  await element.click();
}

/**
 * Scroll page randomly to simulate reading
 * @param {Object} page - Playwright page
 */
export async function randomScroll(page) {
  try {
    const scrollAmount = Math.floor(Math.random() * 300) + 100;
    await page.evaluate((amount) => {
      window.scrollBy({
        top: amount,
        behavior: 'smooth'
      });
    }, scrollAmount);
    await sleep(Math.floor(Math.random() * 1000) + 500);
  } catch (error) {
    // Silently continue if scroll fails
  }
}

/**
 * Anti-fingerprinting script to inject into page context
 * Masks browser automation indicators
 */
export function getAntiFingerprint() {
  return `
    // Override navigator.webdriver
    Object.defineProperty(navigator, 'webdriver', {
      get: () => undefined
    });
    
    // Override permissions
    const originalQuery = window.navigator.permissions.query;
    window.navigator.permissions.query = (parameters) => (
      parameters.name === 'notifications' ?
        Promise.resolve({ state: Notification.permission }) :
        originalQuery(parameters)
    );
    
    // Override plugins
    Object.defineProperty(navigator, 'plugins', {
      get: () => [
        {
          0: { type: "application/x-google-chrome-pdf", suffixes: "pdf", description: "Portable Document Format" },
          description: "Portable Document Format",
          filename: "internal-pdf-viewer",
          length: 1,
          name: "Chrome PDF Plugin"
        },
        {
          0: { type: "application/pdf", suffixes: "pdf", description: "Portable Document Format" },
          description: "Portable Document Format",
          filename: "mhjfbmdgcfjbbpaeojofohoefgiehjai",
          length: 1,
          name: "Chrome PDF Viewer"
        },
        {
          0: { type: "application/x-nacl", suffixes: "", description: "Native Client Executable" },
          1: { type: "application/x-pnacl", suffixes: "", description: "Portable Native Client Executable" },
          description: "",
          filename: "internal-nacl-plugin",
          length: 2,
          name: "Native Client"
        }
      ]
    });
    
    // Override languages
    Object.defineProperty(navigator, 'languages', {
      get: () => ['en-US', 'en']
    });
    
    // Add chrome object if not present
    if (!window.chrome) {
      window.chrome = {
        runtime: {},
        loadTimes: function() {},
        csi: function() {},
        app: {}
      };
    }
    
    // Mock permissions
    const originalPermissions = navigator.permissions;
    navigator.permissions = {
      query: (parameters) => {
        if (parameters.name === 'notifications') {
          return Promise.resolve({ state: 'prompt' });
        }
        return originalPermissions.query(parameters);
      }
    };
  `;
}

/**
 * Get enhanced browser launch options with anti-detection
 * @param {Object} options - Custom options
 * @returns {Object} - Launch options
 */
export function getEnhancedLaunchOptions(options = {}) {
  const resolution = getRandomResolution();
  const timezone = getRandomTimezone();
  const locale = getRandomLocale();
  const userAgent = getRandomUserAgent();
  
  return {
    headless: options.headless || false,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--disable-dev-shm-usage',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-web-security',
      '--disable-features=IsolateOrigins,site-per-process',
      `--window-size=${resolution.width},${resolution.height}`,
      '--lang=' + locale,
      '--disable-infobars',
      '--disable-notifications',
      '--disable-popup-blocking'
    ],
    viewport: {
      width: resolution.width,
      height: resolution.height
    },
    userAgent: userAgent,
    locale: locale,
    timezoneId: timezone,
    permissions: ['geolocation', 'notifications'],
    geolocation: getRandomGeolocation(),
    colorScheme: Math.random() > 0.5 ? 'light' : 'dark',
    deviceScaleFactor: Math.random() > 0.7 ? 2 : 1,
    isMobile: false,
    hasTouch: false,
    ...options
  };
}

/**
 * Get random geolocation based on timezone
 */
function getRandomGeolocation() {
  const locations = [
    { latitude: 40.7128, longitude: -74.0060 },  // New York
    { latitude: 34.0522, longitude: -118.2437 }, // Los Angeles
    { latitude: 41.8781, longitude: -87.6298 },  // Chicago
    { latitude: 51.5074, longitude: -0.1278 },   // London
    { latitude: 48.8566, longitude: 2.3522 },    // Paris
    { latitude: 35.6762, longitude: 139.6503 }   // Tokyo
  ];
  
  return randomChoice(locations);
}

/**
 * Add random delays between actions
 * @param {string} actionType - Type of action (typing, clicking, scrolling)
 * @returns {Promise<void>}
 */
export async function randomActionDelay(actionType = 'default') {
  const delays = {
    typing: { min: 100, max: 400 },
    clicking: { min: 300, max: 800 },
    scrolling: { min: 500, max: 1500 },
    reading: { min: 1000, max: 3000 },
    default: { min: 500, max: 1500 }
  };
  
  const delayRange = delays[actionType] || delays.default;
  await humanDelay(delayRange.min, delayRange.max);
}
