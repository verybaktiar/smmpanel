/**
 * Example: Create inbox, wait for OTP, extract code.
 * 
 * Run: node example-usage.js
 * 
 * Prerequisites:
 *   1. Deploy tempmail-worker to Cloudflare Workers
 *   2. Set AMAIL_BASE_URL and AMAIL_API_KEY below
 */

import { TempMailClient } from './ammail-client/index.js';
import { extractOtp } from './ammail-client/otp-extractor.js';

// --- Configuration ---
const AMAIL_BASE_URL = "https://your-worker.workers.dev"; // Cloudflare Worker URL
const AMAIL_API_KEY = "your-api-key";                      // API key from D1 api_access table
const AMAIL_DOMAIN = "yourdomain.com";                     // Your configured mail domain

async function main() {
  const client = new TempMailClient({
    baseUrl: AMAIL_BASE_URL,
    apiKey: AMAIL_API_KEY,
    domain: AMAIL_DOMAIN,
  });

  // 1. Check connectivity
  const health = await client.health();
  console.log("Worker status:", health.status);

  // 2. Create inbox
  const alias = `test${Math.floor(Math.random() * 10000)}`;
  const inbox = await client.createInbox(alias);
  console.log("Inbox created:", inbox.email);
  // inbox.email = "test4521@yourdomain.com"

  // 3. Register on target site with this email
  // ... your automation code here ...
  // await registerOnFacebook(inbox.email);

  // 4. Poll for messages (waiting for OTP/verification email)
  console.log("Waiting for email...");
  let attempts = 0;
  const maxAttempts = 60; // 60 * 5s = 5 minutes

  while (attempts < maxAttempts) {
    await sleep(5000);
    attempts++;

    const messages = await client.listMessages(alias);
    if (messages.length === 0) {
      process.stdout.write(".");
      continue;
    }

    console.log(`\nFound ${messages.length} message(s)!`);

    // 5. Get full message body
    const msg = await client.getMessage(messages[0].id);

    // 6. Extract OTP code and verification URL
    const { code, verifyUrl } = extractOtp(msg.text || "", msg.html || "", msg.subject || "");

    if (code) {
      console.log("OTP Code:", code);
      // Use code for verification
    }

    if (verifyUrl) {
      console.log("Verification URL:", verifyUrl);
      // Open URL to verify email
    }

    break;
  }

  if (attempts >= maxAttempts) {
    console.log("\nTimeout: No email received");
  }

  // 7. Cleanup — delete inbox
  await client.deleteInbox(alias);
  console.log("Inbox deleted");
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

main().catch(console.error);
