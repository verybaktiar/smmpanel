/**
 * Standalone Webhook Receiver — Express/Node.js compatible.
 * 
 * Handles incoming email events from the Ammail Cloudflare Worker.
 * Extracts OTP codes and verification URLs from email body.
 * 
 * Usage (Express):
 *   import { createWebhookReceiver } from './webhook-receiver/index.js';
 * 
 *   const app = express();
 *   app.use(express.json());
 *   app.post('/api/ammail/webhook', createWebhookReceiver({
 *     secret: 'your-webhook-secret',
 *     ammailClient: myAmmailClient,
 *     onOtp: (otp) => { console.log('OTP received:', otp); },
 *   }));
 * 
 * Usage (standalone):
 *   const handler = createWebhookReceiver({ secret, ammailClient });
 *   const result = await handler(reqBody, headers);
 */

import { extractOtp } from '../ammail-client/otp-extractor.js';
import crypto from 'crypto';

function verifySignature(secret, bodyText, signatureHeader) {
  if (!secret) return true;
  if (!signatureHeader) return false;

  let sig = signatureHeader.trim();
  if (sig.toLowerCase().startsWith("sha256=")) {
    sig = sig.substring(7);
  }

  const expected = crypto.createHmac("sha256", secret).update(bodyText).digest("hex");

  try {
    const expectedBuf = Buffer.from(expected);
    const sigBuf = Buffer.from(sig);
    if (expectedBuf.length !== sigBuf.length) return false;
    return crypto.timingSafeEqual(expectedBuf, sigBuf);
  } catch {
    return false;
  }
}

export function createWebhookReceiver(opts = {}) {
  const { secret = "", ammailClient = null, onOtp = null, onEmail = null } = opts;

  return async function handleWebhook(payload, headers = {}) {
    const rawBody = JSON.stringify(payload);
    const sig = headers["x-tempmail-signature"] || headers["X-Tempmail-Signature"] || "";

    if (!verifySignature(secret, rawBody, sig)) {
      return { status: 401, body: { ok: false, error: "invalid_signature" } };
    }

    const event = String(payload.event || "");
    const data = payload.data || {};
    const inbox = data.inbox || {};
    const rawMessage = data.message;
    const messageMeta = (rawMessage && typeof rawMessage === "object") ? rawMessage : {};

    let address = (inbox.address || messageMeta.delivered_to || messageMeta.to_address || "").trim().toLowerCase();
    const alias = (inbox.alias || "").trim().toLowerCase();
    const domain = address.includes("@") ? address.split("@")[1] : "";

    if (event === "webhook.test") {
      return { status: 200, body: { ok: true, stored: "test" } };
    }

    if (event !== "email.received") {
      return { status: 200, body: { ok: true, ignored: event || "unknown" } };
    }

    const shortId = String(messageMeta.id || "");
    const sender = String(messageMeta.from_address || messageMeta.from_name || "");
    const subject = String(messageMeta.subject || "");
    const snippet = String(messageMeta.snippet || "");

    let textBody = snippet;
    let htmlBody = "";

    if (shortId && ammailClient && ammailClient.configured) {
      try {
        const full = await ammailClient.getMessage(shortId);
        textBody = String(full.text || textBody || "");
        htmlBody = String(full.html || "");
      } catch (e) {
        console.warn(`Failed to pull full message ${shortId}:`, e.message);
      }
    }

    const { code, verifyUrl } = extractOtp(textBody, htmlBody, subject);

    const otpResult = {
      address,
      alias,
      domain,
      sender,
      subject,
      otpCode: code,
      verifyUrl,
      bodyText: textBody,
      bodyHtml: htmlBody,
      messageShortId: shortId,
      receivedAt: Math.floor(Date.now() / 1000),
    };

    if (onOtp && code) {
      await onOtp(otpResult);
    }

    if (onEmail) {
      await onEmail(otpResult);
    }

    console.log(`OTP extracted for ${address} code=${code || "-"} url=${verifyUrl ? "yes" : "-"}`);
    return { status: 200, body: { ok: true, otp: !!code, verify_url: !!verifyUrl } };
  };
}

/**
 * Simple Express middleware wrapper.
 */
export function ammailWebhookMiddleware(opts = {}) {
  const handler = createWebhookReceiver(opts);

  return async (req, res) => {
    try {
      const result = await handler(req.body, req.headers);
      res.status(result.status).json(result.body);
    } catch (error) {
      console.error("Ammail webhook error:", error);
      res.status(500).json({ error: error.message });
    }
  };
}
