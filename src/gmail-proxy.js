'use strict';
// Proxy sticky Gmail: kunci negara DI_COUNTRY + sid gmail-<id> (IP konsisten
// antar login dan pembukaan sesi). Dipakai gmail-login-worker dan gmail-open.

function stickyProxy(gmailId, override) {
  if (override) return override;
  const HOST = 'gw.dataimpulse.com:823';
  const KEY = '3075a7ad6bdec8af6597';
  const PASS = 'c1c5eef4de4fbac0';
  const cc = String(process.env.DI_COUNTRY || 'id').trim().toLowerCase() || 'id';
  return `${HOST}:${KEY}__cr.${cc};sid.gmail-${gmailId}:${PASS}`;
}

function proxyParts(proxyStr) {
  const p = String(proxyStr).split(':');
  if (p.length < 3) return null;
  return { server: `http://${p[0]}:${p[1]}`, username: p[2], password: p.slice(3).join(':') };
}

module.exports = { stickyProxy, proxyParts };
