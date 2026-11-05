'use strict';
// Webhook receiver (CJS) — adaptor dari _extract/webhook-receiver/index.js.
// Worker mengirim POST { event:'email.received', inbox, sender, subject, ... }
// ke MAIL_WEBHOOK_URL. Kita verifikasi X-Webhook-Secret lalu tarik full
// message via MailWorkerClient + extract OTP.
const crypto = require('crypto');
const { extractOtp } = require('./otp');
function verifySecret(secret, bodyText, sigHeader) {
  if (!secret) return true;
  if (!sigHeader) return false;
  let sig = String(sigHeader).trim();
  if (sig.toLowerCase().startsWith('sha256=')) sig = sig.substring(7);
  const exp = crypto.createHmac('sha256', secret).update(bodyText).digest('hex');
  try {
    if (exp.length !== sig.length) return false;
    return crypto.timingSafeEqual(Buffer.from(exp), Buffer.from(sig));
  } catch (e) { return false; }
}
function createMailWebhookReceiver(opts) {
  opts = opts || {};
  const secret = opts.secret || process.env.MAIL_WEBHOOK_SECRET || '';
  const client = opts.client || null;
  const onOtp = opts.onOtp || null;
  const onEmail = opts.onEmail || null;
  return function handle(payload, headers) {
    headers = headers || {};
    const rawBody = JSON.stringify(payload);
    const sig = headers['x-webhook-secret'] || headers['X-Webhook-Secret'] || headers['x-tempmail-signature'] || '';
    if (!verifySecret(secret, rawBody, sig)) return Promise.resolve({ status: 401, body: { ok: false, error: 'invalid_signature' } });
    const event = String(payload.event || '');
    if (event === 'webhook.test') return Promise.resolve({ status: 200, body: { ok: true } });
    if (event !== 'email.received') return Promise.resolve({ status: 200, body: { ok: true, ignored: event } });
    const inboxAddr = String(payload.inbox || '').toLowerCase();
    const shortId = String(payload.id || payload.message_id || '');
    const sender = String(payload.sender || payload.from || '');
    const subject = String(payload.subject || '');
    const finish = (textBody, htmlBody) => {
      const f = extractOtp(textBody || '', htmlBody || '', subject);
      const at = inboxAddr.indexOf('@');
      const out = { address: inboxAddr, alias: at > 0 ? inboxAddr.slice(0, at) : '', domain: at > 0 ? inboxAddr.slice(at + 1) : '', sender, subject, otpCode: f.code, verifyUrl: f.verifyUrl, bodyText: textBody || '', bodyHtml: htmlBody || '', messageShortId: shortId, receivedAt: Math.floor(Date.now() / 1000) };
      let p = Promise.resolve();
      if (onOtp && out.otpCode) p = p.then(() => onOtp(out));
      if (onEmail) p = p.then(() => onEmail(out));
      return p.then(() => ({ status: 200, body: { ok: true, otp: !!out.otpCode } }));
    };
    if (shortId && client && client.configured) {
      return client.getMessage(shortId).then((full) => finish(full.text || full.body || '', full.html || '')).catch(() => finish('', ''));
    }
    return finish('', '');
  };
}
module.exports = { createMailWebhookReceiver };
