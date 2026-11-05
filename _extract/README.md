# Temp Email + OTP Extraction System

Extracted from AMRouter for reuse in other automation projects.

## Folder Structure

```
_extract/
├── tempmail-worker/          ← Deploy ke Cloudflare Workers
│   ├── src/index.js          ← Core Worker (email handler + REST API)
│   ├── migrations/           ← D1 database schema
│   ├── wrangler.jsonc        ← Config (ganti domain + D1 ID)
│   └── package.json
│
├── ammail-client/            ← Client library untuk komunikasi dengan Worker
│   ├── index.js              ← TempMailClient class (create inbox, list messages, dll)
│   └── otp-extractor.js      ← Pure function extract OTP dari email body
│
├── webhook-receiver/         ← Terima webhook dari Worker saat email masuk
│   └── index.js              ← HMAC verification + OTP extraction
│
├── otp-storage/              ← Simpan OTP di SQLite lokal
│   └── index.js              ← OtpStore class (insert, find, mark-used)
│
├── proxy/                    ← Proxy utilities
│   └── parser.py             ← Parse semua format proxy untuk Camoufox
│
└── example-usage.js          ← Contoh penggunaan lengkap
```

## Quick Start

### 1. Deploy Temp Email Worker

```bash
cd tempmail-worker

# Install wrangler
npm install

# Login Cloudflare
npx wrangler login

# Buat D1 database
npx wrangler d1 create tempmail

# Update database_id di wrangler.jsonc

# Deploy
npx wrangler deploy

# Set API key di D1 (bisa via Wrangler dashboard atau CLI)
npx wrangler d1 execute tempmail --remote --command "
  INSERT INTO api_access (user_id, api_key, quota_daily, quota_used, quota_date, granted_by, granted_at)
  VALUES ('admin', 'YOUR_API_KEY_HERE', 0, 0, '', 'manual', datetime('now'))
"
```

### 2. Setup Client di Project Baru

```javascript
import { TempMailClient } from './ammail-client/index.js';
import { extractOtp } from './ammail-client/otp-extractor.js';

const client = new TempMailClient({
  baseUrl: 'https://your-worker.workers.dev',
  apiKey: 'your-api-key',
  domain: 'yourdomain.com',
});

// Buat inbox
const inbox = await client.createInbox('user123');
console.log(inbox.email); // user123@yourdomain.com

// Poll messages
const messages = await client.listMessages('user123');
if (messages.length > 0) {
  const msg = await client.getMessage(messages[0].id);
  const { code, verifyUrl } = extractOtp(msg.text, msg.html, msg.subject);
  console.log('OTP:', code);
}
```

### 3. Setup Webhook (Optional — Real-time)

```javascript
import express from 'express';
import { ammailWebhookMiddleware } from './webhook-receiver/index.js';
import { TempMailClient } from './ammail-client/index.js';

const app = express();
app.use(express.json());

app.post('/api/ammail/webhook', ammailWebhookMiddleware({
  secret: 'your-webhook-secret',
  ammailClient: new TempMailClient({ baseUrl, apiKey, domain }),
  onOtp: (otp) => {
    console.log('OTP received:', otp.otpCode, 'for', otp.address);
    // Store in DB, send to browser, dll
  },
}));

app.listen(3000);
```

## Files untuk Diadopsi

| File | Digunakan Untuk |
|------|-----------------|
| `tempmail-worker/` | Full temp email server (deploy sekali) |
| `ammail-client/index.js` | Create inbox, list messages, API calls |
| `ammail-client/otp-extractor.js` | Extract 4-8 digit OTP dari email body/HTML |
| `webhook-receiver/index.js` | Real-time webhook handler + HMAC verification |
| `otp-storage/index.js` | Simpan OTP di SQLite (untuk polling) |
| `proxy/parser.py` | Parse proxy string untuk browser automation |

## OTP Extraction Patterns

```javascript
// Mendukung semua format umum:
extractOtp("Your verification code is: 123456")    // code = "123456"
extractOtp("OTP: 654321")                          // code = "654321"
extractOtp("Use code 9876 to verify your account") // code = "9876"
extractOtp("Click https://example.com/verify?t=abc") // verifyUrl = "https://..."
```

## Dependencies

- **tempmail-worker**: Cloudflare Workers + D1 (built-in, zero npm deps)
- **ammail-client**: Zero dependencies (uses native fetch)
- **otp-extractor**: Zero dependencies (pure regex)
- **otp-storage**: `better-sqlite3` (Node.js) atau ganti ke driver lain
- **proxy/parser.py**: `camoufox` (untuk test), regex stdlib (untuk parse)
