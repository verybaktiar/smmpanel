# Facebook Account Auto-Signup

Sistem otomatis untuk membuat akun Facebook menggunakan Camoufox (anti-fingerprint browser) + Playwright + Ammail Worker (temp email).

## Features

- ✅ Anti-fingerprint browser (Camoufox/Playwright)
- ✅ Temp email integration (Ammail Worker)
- ✅ Auto OTP extraction dari email
- ✅ Human-like typing & behavior
- ✅ Proxy support (HTTP/SOCKS5)
- ✅ Batch account creation
- ✅ Headless mode
- ✅ Auto-generate user data (nama, tanggal lahir, gender)
- ✅ Cookie extraction untuk session
- ✅ Comprehensive logging
- ✅ Error handling & retry logic

## Prerequisites

1. **Node.js** >= 18.0.0
2. **Playwright** browser binaries
3. **Ammail Worker** deployed ke Cloudflare Workers
4. **2Captcha API Key** (optional, untuk CAPTCHA solving)

## Installation

```bash
cd automation

# Install dependencies
npm install

# Install Playwright browsers
npx playwright install chromium

# Copy environment file
cp .env.example .env

# Edit .env dengan konfigurasi Anda
nano .env
```

## Configuration

Edit file `.env`:

```bash
# Ammail Worker Configuration
AMMAIL_BASE_URL=https://your-worker.workers.dev
AMMAIL_API_KEY=your-api-key-here
AMMAIL_DOMAIN=yourdomain.com

# Browser Configuration
HEADLESS=false
SAVE_SCREENSHOTS=true

# CAPTCHA Service (optional)
CAPTCHA_SERVICE=2captcha
CAPTCHA_API_KEY=your-2captcha-key

# Logging
LOG_LEVEL=info
DEBUG=false
```

## Usage

### 1. Single Account dengan Email Custom

```bash
node cli.js --email test@example.com --password MyPassword123
```

### 2. Auto-Generate Semua Data

```bash
node cli.js --auto
```

### 3. Headless Mode dengan Proxy

```bash
node cli.js --auto --headless --proxy "host:port:user:pass"
```

### 4. Batch Creation (Multiple Accounts)

```bash
# Buat 5 akun dengan delay 10 detik antar akun
node cli.js --auto --batch 5 --delay 10000
```

### 5. Dengan Output ke File

```bash
node cli.js --auto --output results.json
```

### 6. Custom Data

```bash
node cli.js \
  --email custom@mail.com \
  --password MyPass123 \
  --first-name John \
  --last-name Doe \
  --gender male \
  --proxy "proxy.example.com:8080:user:pass"
```

## CLI Options

```
Options:
  -e, --email <email>         Email address (or auto-generate if --auto)
  -p, --password <password>   Password for account
  -f, --first-name <name>     First name (or random)
  -l, --last-name <name>      Last name (or random)
  -g, --gender <male|female>  Gender (or random)
  --proxy <proxy-string>      Proxy (format: host:port:user:pass)
  -H, --headless              Run in headless mode
  -a, --auto                  Auto-generate all data
  -b, --batch <number>        Create multiple accounts (default: 1)
  -d, --delay <ms>            Delay between batch signups (default: 5000)
  -o, --output <file>         Save results to JSON file
  -h, --help                  Show help message
```

## Proxy Formats

Supported proxy formats:

```bash
# HTTP with auth
http://user:pass@host:port

# SOCKS5
socks5://host:port

# Plain format
host:port:user:pass

# Plain without auth
host:port
```

## Flow Lengkap

```
1. ✓ Parse arguments
2. ✓ Initialize temp email client
3. ✓ Create/use email inbox
4. ✓ Launch Camoufox browser
5. ✓ Navigate to facebook.com/reg
6. ✓ Fill signup form (first name, last name, email, password, birthday, gender)
7. ✓ Submit form
8. ✓ Wait for verification email (polling)
9. ✓ Extract OTP code atau verification URL
10. ✓ Submit OTP / open verification URL
11. ✓ Handle "Confirm your identity" flow
12. ✓ Extract session cookies
13. ✓ Output JSON result
```

## Output Format

```json
{
  "status": "success",
  "email": "test4521@yourdomain.com",
  "password": "MyPassword123",
  "cookies": [
    {
      "name": "c_user",
      "value": "100012345678901",
      "domain": ".facebook.com"
    },
    {
      "name": "xs",
      "value": "...",
      "domain": ".facebook.com"
    }
  ],
  "steps": [
    {
      "step": "init_tempmail",
      "success": true,
      "message": "ok",
      "timestamp": "2026-09-03T13:30:00.000Z"
    },
    {
      "step": "setup_email",
      "success": true,
      "message": "test4521@yourdomain.com",
      "timestamp": "2026-09-03T13:30:05.000Z"
    }
  ]
}
```

## Project Structure

```
automation/
├── cli.js                  # CLI tool
├── fb-signup.js           # Main Facebook signup class
├── config/
│   └── default.js         # Default configuration
├── utils/
│   ├── name-generator.js  # Random name generator
│   ├── date-generator.js  # Random date & delay functions
│   ├── proxy-parser.js    # Proxy parser & validator
│   └── logger.js          # Console logger
├── profiles/              # Browser profiles (auto-created)
├── screenshots/           # Debug screenshots (auto-created)
├── cookies/               # Saved session cookies (auto-created)
├── .env                   # Environment variables
├── .env.example           # Example environment file
├── package.json           # NPM dependencies
└── README.md              # This file
```

## Dependencies

File-file reusable dari `_extract/`:

```
_extract/
├── ammail-client/
│   ├── index.js           # TempMailClient class
│   └── otp-extractor.js   # extractOtp() function
└── tempmail-worker/       # Cloudflare Worker code
```

## Troubleshooting

### 1. Email tidak diterima

- Pastikan Ammail Worker sudah deployed
- Cek API key dan domain sudah benar
- Cek apakah domain email sudah di-block Facebook
- Increase timeout di `.env`: `AMMAIL_TIMEOUT=30000`

### 2. CAPTCHA muncul terus

- Gunakan proxy berkualitas
- Jangan terlalu banyak signup dari IP sama
- Enable CAPTCHA solving service (2Captcha)
- Tambahkan delay antar signup: `--delay 30000`

### 3. Browser crash

- Disable headless mode: `HEADLESS=false`
- Tambah memory: `--max-old-space-size=4096`
- Cek Playwright browser sudah terinstall

### 4. Proxy tidak bekerja

- Test proxy format: `node -e "import('./utils/proxy-parser.js').then(m => console.log(m.parseProxy('your-proxy')))"`
- Cek proxy masih aktif dan valid
- Gunakan proxy dengan lokasi yang masuk akal (US, UK, dll)

### 5. Form tidak terisi

- Facebook mungkin ubah selector
- Disable headless untuk debug: `HEADLESS=false`
- Check screenshot di folder `screenshots/`
- Update selector di `fb-signup.js`

## Important Notes

1. **Rate Limiting**: Jangan create terlalu banyak akun dari IP yang sama. Use proxy rotation.

2. **Email Domain**: Beberapa domain temp email sudah di-block Facebook. Test dulu dengan domain Anda.

3. **Phone Number**: Facebook sering minta nomor HP setelah signup. Siapkan SMS service sebagai fallback (sms-activate.org, 5sim.net).

4. **Account Warming**: Akun baru jangan langsung dipakai untuk automation berat. Warm up dulu (scroll feed, like posts, add friends).

5. **Legal**: Pastikan Anda comply dengan Facebook Terms of Service. Tool ini untuk educational purposes only.

## Example Script

### test-signup.js

```javascript
import FacebookSignup from './fb-signup.js';

async function test() {
  const signup = new FacebookSignup({
    auto: true,
    headless: false,
    proxy: null
  });
  
  const result = await signup.run();
  
  console.log('\n=== RESULT ===');
  console.log(JSON.stringify(result, null, 2));
}

test().catch(console.error);
```

Run test:

```bash
node test-signup.js
```

## Advanced Usage

### Programmatic API

```javascript
import FacebookSignup from './automation/fb-signup.js';

const signup = new FacebookSignup({
  email: 'custom@example.com',
  password: 'SecurePass123',
  firstName: 'John',
  lastName: 'Doe',
  gender: 'male',
  proxy: 'proxy.example.com:8080:user:pass',
  headless: true
});

const result = await signup.run();

if (result.status === 'success') {
  console.log('Account created:', result.email);
  console.log('Cookies:', result.cookies);
} else {
  console.error('Failed:', result.error);
}
```

### Batch Processing dengan Proxy Rotation

```javascript
import FacebookSignup from './automation/fb-signup.js';
import fs from 'fs/promises';

const proxies = [
  'proxy1.com:8080:user:pass',
  'proxy2.com:8080:user:pass',
  'proxy3.com:8080:user:pass'
];

const results = [];

for (let i = 0; i < 10; i++) {
  const proxy = proxies[i % proxies.length];
  
  const signup = new FacebookSignup({
    auto: true,
    headless: true,
    proxy: proxy
  });
  
  const result = await signup.run();
  results.push(result);
  
  // Delay between signups
  await new Promise(resolve => setTimeout(resolve, 30000));
}

await fs.writeFile('batch-results.json', JSON.stringify(results, null, 2));
```

## License

MIT

## Author

Senior Automation Engineer

## Support

Untuk bug report atau feature request, silakan buat issue.
