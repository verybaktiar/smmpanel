'use strict';

// Proxy validator dan rotation system
// Validasi proxy sebelum assign ke account dan auto-switch jika proxy failure

const net = require('net');

// Pecah string proxy jadi bagian-bagiannya. Menerima host:port,
// host:port:user:pass, dan bentuk berskema seperti http://user:pass@host:port.
function parseProxy(proxyString) {
  let s = String(proxyString || '').trim().replace(/^[a-z0-9+.-]+:\/\//i, '');
  let user = '';
  let pass = '';
  const at = s.lastIndexOf('@');
  if (at !== -1) {
    const cred = s.slice(0, at);
    s = s.slice(at + 1);
    const ci = cred.indexOf(':');
    user = ci === -1 ? cred : cred.slice(0, ci);
    pass = ci === -1 ? '' : cred.slice(ci + 1);
  }
  const p = s.split(':');
  if (!user && p.length >= 3) {
    user = p[2];
    pass = p.slice(3).join(':');
  }
  return { host: p[0], port: parseInt(p[1], 10), user, pass };
}

// Alasan penolakan dari penyedia proxy diterjemahkan ke satu kalimat pendek
// supaya kolom Tes tetap ringkas. Pesan mentahnya (mis. TRAFFIC_EXHAUSTED,
// ip_forbidden) tetap dikirim di `detail` untuk tooltip. `kind` dipakai UI untuk
// memisahkan proxy yang cuma butuh izin IP dari proxy yang benar-benar mati:
// ip | quota | auth | limit | server | refused.
function explainRefusal(code, reasonPhrase, headers) {
  // Bright Data menaruh alasan asli di x-brd-err-msg / x-brd-err-code, BUKAN di
  // proxy-status. Tanpa header itu pesan "IP belum diizinkan" datang tanpa IP dan
  // tanpa link dashboard — operator harus buka dashboard Bright Data sendiri lalu
  // menebak zone mana yang perlu di-whitelist.
  const raw = [
    reasonPhrase || '',
    headers['proxy-status'] || '',
    headers['x-brd-err-msg'] || '',
    headers['x-brd-err-code'] || '',
  ].join(' ').trim();
  const detail = raw.slice(0, 400);
  if (/TRAFFIC_EXHAUSTED|traffic[_ ]exhausted/i.test(raw)) {
    return { error: 'Kuota traffic habis', detail, kind: 'quota' };
  }
  if (/ip_forbidden|not whitelisted|ip_not_allowed/i.test(raw)) {
    const ip = (/(\d{1,3}(?:\.\d{1,3}){3})/.exec(raw) || [])[1];
    const whitelistUrl = (/(https:\/\/brightdata\.com\/[^\s"']+)/.exec(raw) || [])[1] || null;
    return {
      error: ip ? `IP ${ip} belum diizinkan` : 'IP belum diizinkan',
      detail, kind: 'ip', blockedIp: ip || null, whitelistUrl,
    };
  }
  if (code === 407 || code === 401) return { error: 'Auth proxy ditolak', detail, kind: 'auth' };
  if (code === 402) return { error: 'Kuota traffic habis', detail, kind: 'quota' };
  if (code === 429) return { error: 'Proxy membatasi (429)', detail, kind: 'limit' };
  if (code >= 500) return { error: `Server proxy error (${code})`, detail, kind: 'server' };
  return { error: `Proxy menolak (${code})`, detail, kind: 'refused' };
}

/**
 * Test proxy connection dengan timeout
 * @param {string} proxyString - Format: host:port:user:pass or host:port
 * @param {number} timeout - Timeout dalam ms (default 10000)
 * @returns {object} Result { valid, responseTime, error, detail }. `error` berisi
 *   alasan singkat, detail berisi balasan mentah penyedia (dipakai tooltip).
 */
async function testProxy(proxyString, timeout = 10000) {
  const { host, port, user, pass } = parseProxy(proxyString);

  if (!host || !port || isNaN(port) || port < 1 || port > 65535) {
    return {
      valid: false,
      error: 'Format proxy salah',
      detail: 'Harus host:port atau host:port:user:pass',
    };
  }

  return new Promise((resolve) => {
    const startTime = Date.now();
    let done = false;
    let timer = null;
    let socket = null;

    const finish = (result) => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      if (socket) socket.destroy();
      resolve(result);
    };

    // Handshake CONNECT: cukup untuk tahu proxy hidup dan menerima kredensial,
    // tanpa mengunduh apa pun. Balasan bukan 200 hampir selalu berisi alasan
    // (kuota habis, IP tidak diizinkan, auth salah).
    const head = ['CONNECT api.ipify.org:443 HTTP/1.1', 'Host: api.ipify.org:443', 'Proxy-Connection: keep-alive'];
    if (user) head.push(`Proxy-Authorization: Basic ${Buffer.from(`${user}:${pass || ''}`).toString('base64')}`);

    socket = net.connect({ host, port }, () => {
      socket.write(head.join('\r\n') + '\r\n\r\n');
    });

    timer = setTimeout(() => {
      finish({ valid: false, error: 'Timeout', detail: `proxy tak menjawab dalam ${Math.round(timeout / 1000)} dtk (mati atau jenuh)` });
    }, timeout);

    let buf = '';
    socket.on('data', (chunk) => {
      buf += chunk.toString('latin1');
      const end = buf.indexOf('\r\n\r\n');
      if (end === -1) {
        if (buf.length > 8192) finish({ valid: false, error: 'Balasan proxy tak terbaca' });
        return;
      }
      const lines = buf.slice(0, end).split('\r\n');
      const m = /^HTTP\/\d(?:\.\d)?\s+(\d{3})\s*(.*)$/.exec(lines[0]);
      if (!m) return finish({ valid: false, error: 'Bukan balasan proxy HTTP', detail: lines[0].slice(0, 120) });

      const code = parseInt(m[1], 10);
      const headers = {};
      for (const line of lines.slice(1)) {
        const i = line.indexOf(':');
        if (i > 0) headers[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
      }

      if (code === 200) {
        const responseTime = Date.now() - startTime;
        return finish({ valid: true, responseTime, message: `Proxy responding in ${responseTime}ms` });
      }
      finish({ valid: false, code, ...explainRefusal(code, m[2], headers) });
    });

    socket.on('error', (err) => {
      const hint = err.code === 'ENOTFOUND' ? 'host proxy tak ditemukan'
        : err.code === 'ECONNREFUSED' ? 'port proxy menolak koneksi'
          : err.code === 'EHOSTUNREACH' || err.code === 'ENETUNREACH' ? 'proxy tak terjangkau dari mesin ini'
            : (err.code || err.message);
      finish({ valid: false, error: 'Tak tersambung', detail: hint });
    });

    socket.on('close', () => finish({ valid: false, error: 'Koneksi ditutup proxy' }));
  });
}

/**
 * Test multiple proxies dan return results
 * @param {array} proxies - Array of proxy strings
 * @returns {array} Array of test results
 */
async function testMultipleProxies(proxies) {
  const results = [];
  
  console.log(`  [proxy-validator] Testing ${proxies.length} proxies...`);

  for (let i = 0; i < proxies.length; i++) {
    const proxy = proxies[i];
    console.log(`  [proxy-validator] Testing proxy ${i + 1}/${proxies.length}: ${proxy.split(':').slice(0, 2).join(':')}`);
    
    const result = await testProxy(proxy);
    results.push({
      proxy,
      ...result,
      testedAt: new Date().toISOString(),
    });

    // Small delay antar tests
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  const validCount = results.filter(r => r.valid).length;
  console.log(`  [proxy-validator] Results: ${validCount}/${proxies.length} proxies valid`);

  return results;
}

/**
 * Validate all proxies dalam database
 * @param {object} db - Database instance
 * @returns {object} Validation summary
 */
async function validateAllProxies(db) {
  try {
    const proxies = await db.listProxies();
    
    if (proxies.length === 0) {
      return {
        total: 0,
        valid: 0,
        invalid: 0,
        results: [],
      };
    }

    const proxyStrings = proxies.map(p => p.value);
    const testResults = await testMultipleProxies(proxyStrings);

    // Update database dengan hasil test
    for (let i = 0; i < testResults.length; i++) {
      const result = testResults[i];
      const proxyRecord = proxies[i];
      
      // Update status di database (jika ada field status)
      // Untuk sekarang, kita hanya return results
    }

    const summary = {
      total: testResults.length,
      valid: testResults.filter(r => r.valid).length,
      invalid: testResults.filter(r => !r.valid).length,
      results: testResults,
      testedAt: new Date().toISOString(),
    };

    return summary;

  } catch (error) {
    console.error(`  [proxy-validator] Error validating proxies:`, error.message);
    throw error;
  }
}

/**
 * Test proxy khusus untuk TikTok (lebih strict validation)
 * @param {string} proxyString - Proxy string
 * @returns {object} TikTok-specific test result
 */
async function testProxyForTikTok(proxyString) {
  const baseResult = await testProxy(proxyString);
  
  if (!baseResult.valid) {
    return {
      ...baseResult,
      tiktokCompatible: false,
      tiktokReason: 'Proxy tidak valid dasar'
    };
  }
  
  // Additional TikTok-specific checks
  const { host } = parseProxy(proxyString);
  
  // Check if proxy is from known TikTok-friendly providers
  const isFriendlyProvider = [
    'dataimpulse', 'brightdata', 'iproyal', 'oxylabs',
    'smartproxy', 'netnut', 'shifter', 'soax'
  ].some(provider => host.toLowerCase().includes(provider));
  
  // Check if proxy is residential/mobile (better for TikTok)
  const isResidential = [
    'residential', 'mobile', 'isp', 'real'
  ].some(keyword => host.toLowerCase().includes(keyword));
  
  // Response time threshold for TikTok (must be < 3 seconds)
  const isFastEnough = baseResult.responseTime < 3000;
  
  const tiktokCompatible = isFriendlyProvider && isResidential && isFastEnough;
  
  return {
    ...baseResult,
    tiktokCompatible,
    tiktokDetails: {
      friendlyProvider: isFriendlyProvider,
      residential: isResidential,
      fastEnough: isFastEnough,
      responseTime: baseResult.responseTime
    },
    tiktokReason: tiktokCompatible ? 
      'Kompatibel TikTok' : 
      `TikTok: ${!isFriendlyProvider ? 'provider tidak dikenal' : !isResidential ? 'bukan residential' : 'response time terlalu lambat'}`
  };
}

/**
 * Get best proxy khusus untuk TikTok
 * @param {array} proxies - Array of proxy strings
 * @returns {string|null} Best TikTok-compatible proxy
 */
async function getBestTikTokProxy(proxies) {
  if (proxies.length === 0) return null;
  
  const results = [];
  
  for (const proxy of proxies) {
    const result = await testProxyForTikTok(proxy);
    results.push({ proxy, ...result });
    
    // Small delay between tests
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  const tiktokProxies = results.filter(r => r.tiktokCompatible);
  
  if (tiktokProxies.length === 0) {
    // Fallback to fastest valid proxy if no TikTok-optimized ones
    const validProxies = results.filter(r => r.valid);
    if (validProxies.length === 0) return null;
    
    validProxies.sort((a, b) => a.responseTime - b.responseTime);
    console.log(`  [tiktok-proxy] No TikTok-optimized proxies, using fastest valid: ${validProxies[0].proxy}`);
    return validProxies[0].proxy;
  }
  
  // Sort TikTok proxies by response time
  tiktokProxies.sort((a, b) => a.responseTime - b.responseTime);
  
  return tiktokProxies[0].proxy;
}

/**
 * Get best proxy dari list (paling cepat response time)
 * @param {array} proxies - Array of proxy strings
 * @returns {string|null} Best proxy or null if none valid
 */
async function getBestProxy(proxies) {
  if (proxies.length === 0) return null;

  const results = await testMultipleProxies(proxies);
  const validProxies = results.filter(r => r.valid);

  if (validProxies.length === 0) return null;

  // Sort by response time (fastest first)
  validProxies.sort((a, b) => a.responseTime - b.responseTime);

  return validProxies[0].proxy;
}

/**
 * Rotate proxy untuk account jika current proxy gagal
 * @param {object} db - Database instance
 * @param {number} accountId - Account ID
 * @returns {object} Rotation result
 */
async function rotateProxyForAccount(db, accountId) {
  try {
    const account = await db.getAccountById(accountId);
    if (!account) {
      return { success: false, error: 'Account not found' };
    }

    const allProxies = await db.listProxies();
    if (allProxies.length === 0) {
      return { success: false, error: 'No proxies available' };
    }

    // Filter out current proxy
    const currentProxy = account.proxy;
    const availableProxies = allProxies
      .map(p => p.value)
      .filter(p => p !== currentProxy);

    if (availableProxies.length === 0) {
      return { success: false, error: 'No alternative proxies available' };
    }

    // Get best proxy dari available proxies
    const bestProxy = await getBestProxy(availableProxies);

    if (!bestProxy) {
      return { success: false, error: 'No valid proxies found' };
    }

    // Update account dengan new proxy
    await db.setAccountProxy(accountId, bestProxy);

    console.log(`  [proxy-validator] Rotated proxy for account ${accountId} to ${bestProxy.split(':').slice(0, 2).join(':')}`);

    return {
      success: true,
      oldProxy: currentProxy,
      newProxy: bestProxy,
    };

  } catch (error) {
    console.error(`  [proxy-validator] Error rotating proxy:`, error.message);
    return { success: false, error: error.message };
  }
}

module.exports = {
  explainRefusal,
  testProxy,
  testMultipleProxies,
  validateAllProxies,
  getBestProxy,
  rotateProxyForAccount,
  testProxyForTikTok,
  getBestTikTokProxy
};
