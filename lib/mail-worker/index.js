'use strict';
// MailWorkerClient: REST client ke Cloudflare tempmail-worker.
// Endpoint dipakai: GET /api/health, POST /api/inboxes,
// GET /api/inboxes/:alias/messages, GET /api/messages/:id
// Header auth: X-API-Key (sama dengan _extract/ammail-client).
const https = require('https');
const http = require('http');
const { extractOtp } = require('./otp');
class MailWorkerError extends Error {
  constructor(message, status, body) {
    super(message);
    this.name = 'MailWorkerError';
    this.status = status || 0;
    this.body = body || '';
  }
}
class MailWorkerClient {
  constructor(opts) {
    opts = opts || {};
    let b = String(opts.baseUrl || process.env.AMMAIL_BASE_URL || '').trim().replace(/\/+$/, '');
    if (b && !/^https?:\/\//i.test(b)) b = 'https://' + b;
    this.baseUrl = b;
    this.apiKey = String(opts.apiKey || process.env.AMMAIL_API_KEY || '').trim();
    this.defaultDomain = String(opts.domain || process.env.AMMAIL_DOMAIN || '').trim().toLowerCase();
    this.timeoutMs = Number(opts.timeoutMs || process.env.AMMAIL_TIMEOUT || 20000);
  }
  get configured() { return !!this.baseUrl && !!this.apiKey; }
  request(method, path, body) {
    const self = this;
    if (!self.configured) return Promise.reject(new MailWorkerError('mail_worker_not_configured'));
    return new Promise((resolve, reject) => {
      const u = new URL(self.baseUrl + path);
      const lib = u.protocol === 'https:' ? https : http;
      const payload = body ? JSON.stringify(body) : null;
      const headers = { Accept: 'application/json', 'X-API-Key': self.apiKey };
      if (payload) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(payload); }
      const req = lib.request({ hostname: u.hostname, port: u.port || 443, path: u.pathname + u.search, method, headers }, (res) => {
        let d = '';
        res.on('data', (c) => { d += c; });
        res.on('end', () => {
          let data = {};
          try { data = d ? JSON.parse(d) : {}; } catch (e) { data = { raw: String(d).slice(0, 500) }; }
          if (res.statusCode >= 400) return reject(new MailWorkerError(data.error || ('http_' + res.statusCode), res.statusCode, String(d).slice(0, 500)));
          resolve(data);
        });
      });
      req.on('error', (e) => reject(new MailWorkerError('network_error: ' + e.message)));
      req.setTimeout(self.timeoutMs, () => req.destroy(new Error('timeout')));
      if (payload) req.write(payload);
      req.end();
    });
  }
  health() { return this.request('GET', '/api/health'); }
  info() { return this.request('GET', '/api'); }
  createInbox(alias, domain) {
    const body = {};
    if (alias) body.alias = alias;
    const dom = String(domain || this.defaultDomain || '').trim().toLowerCase();
    if (dom) body.domain = dom;
    const self = this;
    return self.request('POST', '/api/inboxes', body).then((d) => d.inbox || d);
  }
  listMessages(alias) {
    const self = this;
    return self.request('GET', '/api/inboxes/' + String(alias).trim().toLowerCase() + '/messages').then((d) => d.messages || []);
  }
  getMessage(id) {
    const self = this;
    return self.request('GET', '/api/messages/' + String(id).trim()).then((d) => d.message || {});
  }
  waitForOtp(alias, timeoutMin, intervalMs) {
    const self = this;
    const tMin = timeoutMin || 5;
    const gap = intervalMs || 5000;
    const tries = Math.max(1, Math.round((tMin * 60000) / gap));
    let chain = Promise.resolve(null);
    for (let i = 0; i < tries; i++) {
      chain = chain.then((found) => {
        if (found) return found;
        return new Promise((r) => setTimeout(r, gap)).then(() => self.listMessages(alias).then((list) => {
          const jobs = (list || []).filter((p) => p.id).map((p) => self.getMessage(p.id).catch(() => null));
          return Promise.all(jobs).then((msgs) => {
            for (const msg of msgs) {
              if (!msg) continue;
              const f = extractOtp(msg.text || msg.body || '', msg.html || '', msg.subject || '');
              if (f.code || f.verifyUrl) return { code: f.code, verifyUrl: f.verifyUrl, message: msg };
            }
            return null;
          });
        }).catch(() => null));
      });
    }
    return chain;
  }
}
module.exports = { MailWorkerClient, MailWorkerError };
