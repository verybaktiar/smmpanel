/**
 * Proxy Parser — parse any proxy format for Playwright
 * 
 * Usage:
 *   import { parseProxy } from './utils/proxy-parser.js';
 *   const proxy = parseProxy('http://user:pass@host:port');
 */

/**
 * Parse proxy string into Playwright/Camoufox format
 * @param {string} proxyStr - Proxy string in various formats
 * @returns {object|null} - Proxy object or null if invalid
 * 
 * Supported formats:
 *   - http://user:pass@host:port
 *   - socks5://host:port
 *   - host:port:user:pass
 *   - host:port
 */
export function parseProxy(proxyStr) {
  if (!proxyStr) return null;
  
  const raw = proxyStr.trim();
  
  // URL format: http://user:pass@host:port or socks5://host:port
  const urlMatch = raw.match(
    /^(socks[45]?|https?|http):\/\/(?:([^:@]+):([^@]+)@)?([^:]+):(\d+)$/i
  );
  
  if (urlMatch) {
    const [, proto, user, password, host, port] = urlMatch;
    const proxy = { server: `${proto}://${host}:${port}` };
    
    if (user) {
      proxy.username = user;
      proxy.password = password;
    }
    
    return proxy;
  }
  
  // Malformed URL: http://host:port:user:pass
  const badUrl = raw.match(
    /^(https?|socks[45]?):\/\/([^:]+):(\d+):([^:]+):(.+)$/i
  );
  
  if (badUrl) {
    const [, proto, host, port, user, password] = badUrl;
    return {
      server: `${proto}://${host}:${port}`,
      username: user,
      password: password
    };
  }
  
  // Plain: host:port:user:pass
  const parts = raw.split(':');
  if (parts.length === 4 && /^\d+$/.test(parts[1])) {
    const [host, port, user, password] = parts;
    return {
      server: `http://${host}:${port}`,
      username: user,
      password: password
    };
  }
  
  // Plain: host:port
  if (parts.length === 2 && /^\d+$/.test(parts[1])) {
    return { server: `http://${parts[0]}:${parts[1]}` };
  }
  
  return null;
}

/**
 * Validate proxy by checking if it's properly formatted
 * @param {string} proxyStr 
 * @returns {boolean}
 */
export function isValidProxy(proxyStr) {
  return parseProxy(proxyStr) !== null;
}

/**
 * Test proxy by making a request
 * @param {string} proxyStr 
 * @param {object} page - Playwright page object
 * @returns {Promise<{ok: boolean, ip?: string, error?: string}>}
 */
export async function testProxy(proxyStr, page) {
  try {
    await page.goto('https://api.ipify.org?format=json', {
      waitUntil: 'domcontentloaded',
      timeout: 20000
    });
    
    const bodyText = await page.locator('body').innerText({ timeout: 5000 });
    const info = JSON.parse(bodyText);
    
    return {
      ok: true,
      ip: info.ip
    };
  } catch (error) {
    return {
      ok: false,
      error: error.message
    };
  }
}
