# Quick Start Guide - Facebook Auto-Signup

Panduan cepat untuk mulai menggunakan Facebook auto-signup tool.

## Setup (5 menit)

### 1. Install Dependencies

```bash
cd automation
npm install
npx playwright install chromium
```

### 2. Setup Environment

```bash
# Copy file environment
cp .env.example .env

# Edit .env
nano .env
```

Minimal configuration:
```bash
AMMAIL_BASE_URL=https://your-worker.workers.dev
AMMAIL_API_KEY=your-api-key
AMMAIL_DOMAIN=yourdomain.com
```

### 3. Test Connection

```bash
node -e "import('./utils/logger.js').then(m => m.logger.success('Setup OK!'))"
```

## Usage Examples

### Single Account (Auto-generate)

```bash
node cli.js --auto
```

Output:
```
✅ Account created successfully!
Email: fb1725369000123@yourdomain.com
Password: aB3$xK9@pL2m
```

### Single Account (Custom Data)

```bash
node cli.js \
  --email myemail@example.com \
  --password MySecurePass123 \
  --first-name John \
  --last-name Doe
```

### Headless Mode

```bash
node cli.js --auto --headless
```

### With Proxy

```bash
node cli.js --auto --proxy "proxy.example.com:8080:user:pass"
```

### Batch Creation

```bash
# Create 5 accounts dengan 10 detik delay
node cli.js --auto --batch 5 --delay 10000 --headless
```

### Save Results to File

```bash
node cli.js --auto --output results.json
```

## Test Script

```bash
node test-signup.js
```

## Proxy Formats

```bash
# HTTP with authentication
http://username:password@host:port

# SOCKS5
socks5://host:port

# Colon-separated
host:port:username:password

# No auth
host:port
```

## Common Issues

### Email tidak diterima
```bash
# Increase timeout di .env
AMMAIL_TIMEOUT=30000

# Atau jalankan tanpa headless untuk debug
node cli.js --auto
```

### Browser crash
```bash
# Reinstall browsers
npx playwright install chromium --force
```

### Proxy tidak work
```bash
# Test proxy format
node -e "import('./utils/proxy-parser.js').then(m => console.log(m.parseProxy('YOUR_PROXY')))"
```

## Project Structure

```
automation/
├── cli.js              # Main CLI tool ⭐
├── fb-signup.js        # Signup logic
├── test-signup.js      # Test script
├── config/
│   └── default.js      # Configuration
├── utils/
│   ├── name-generator.js
│   ├── date-generator.js
│   ├── proxy-parser.js
│   └── logger.js
└── .env                # Your config
```

## Full Documentation

Lihat `README.md` untuk dokumentasi lengkap.

## Support

Issues? Check:
1. `README.md` - Troubleshooting section
2. Screenshots di `automation/screenshots/` (jika error)
3. Cookies di `automation/cookies/` (jika sukses)
