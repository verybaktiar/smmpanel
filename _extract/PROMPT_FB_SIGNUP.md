# Prompt: Auto Create Facebook Account dengan Email + OTP

Gunakan prompt ini untuk AI (Cursor, ChatGPT, Claude, dll) atau sebagai panduan implementasi manual.

---

## PROMPT UNTUK AI

```
Kamu adalah senior automation engineer. Buatkan sistem auto-create Facebook account
menggunakan Camoufox (anti-fingerprint Firefox) + Playwright + temp email (Ammail Worker).

## REFERENSI FILE YANG SUDAH ADA

Semua file reusable ada di folder `_extract/`:

1. `_extract/tempmail-worker/` — Temp email server (deploy ke Cloudflare Workers)
2. `_extract/ammail-client/index.js` — TempMailClient class (create inbox, list messages)
3. `_extract/ammail-client/otp-extractor.js` — extractOtp() function (extract OTP dari email)
4. `_extract/webhook-receiver/index.js` — Webhook handler (real-time OTP receiver)
5. `_extract/otp-storage/index.js` — OtpStore class (simpan OTP di SQLite)
6. `_extract/proxy/parser.py` — parse_proxy() function (parse semua format proxy)
7. `_extract/example-usage.js` — Contoh cara pakai TempMailClient

## REFERENSI CODE ORIGINAL (untuk pattern)

Lihat file berikut untuk pola browser automation:
- `backend/src/automation/cloudflare_signup.py` — Camoufox launch, form filling, CAPTCHA handling
- `backend/src/automation/test_proxy.py` — Proxy test pattern

## YANG HARUS DIBUAT

Buat file Python di `backend/src/automation/fb_signup.py` dengan flow:

### Flow Lengkap

```
1. Parse arguments (--email, --password, --proxy, --headless, --profiles-dir)
2. Generate atau pakai email yang di-pass
3. Buat inbox via Ammail API (atau pakai email yang sudah ada)
4. Launch Camoufox browser
5. Buka https://www.facebook.com/register
6. Isi form: First name, Last name, Email, Password, Birthday, Gender
7. Handle CAPTCHA jika muncul (reCAPTCHA v2/v3)
8. Submit form
9. Tunggu email verifikasi dari Facebook ke Ammail
10. Extract OTP code atau verification URL dari email
11. Submit OTP / buka verification URL
12. Jika ada "Confirm your identity" → handle OTP lagi
13. Login ke Facebook
14. Extract session cookies / access token
15. Output JSON: { status, email, password, session, cookies }
```

### Detail Tiap Step

#### Step 1: Argument Parsing
```python
parser = argparse.ArgumentParser()
parser.add_argument("--email", required=True)
parser.add_argument("--password", required=True)
parser.add_argument("--first-name", default=None)  # random jika tidak diisi
parser.add_argument("--last-name", default=None)   # random jika tidak diisi
parser.add_argument("--birthday", default=None)     # format: YYYY-MM-DD
parser.add_argument("--gender", default=None)       # male/female
parser.add_argument("--proxy", default=None)
parser.add_argument("--proxy-user", default=None)
parser.add_argument("--proxy-pass", default=None)
parser.add_argument("--headless", action="store_true", default=True)
parser.add_argument("--profiles-dir", default="./profiles/fb")
parser.add_argument("--ammail-base-url", default=None)
parser.add_argument("--ammail-api-key", default=None)
parser.add_argument("--ammail-domain", default=None)
parser.add_argument("--2captcha-key", default=None)
parser.add_argument("--timeout", type=int, default=180)
```

#### Step 2: Generate Identity
```python
import random
import string
from datetime import datetime, timedelta

FIRST_NAMES = ["James", "Mary", "John", "Patricia", "Robert", ...]  # 100+ names
LAST_NAMES = ["Smith", "Johnson", "Williams", "Brown", "Jones", ...]  # 100+ names

def generate_identity():
    first = random.choice(FIRST_NAMES)
    last = random.choice(LAST_NAMES)
    # Birthday: 18-55 tahun lalu
    days_ago = random.randint(18*365, 55*365)
    birthday = (datetime.now() - timedelta(days=days_ago)).strftime("%Y-%m-%d")
    gender = random.choice(["male", "female"])
    return first, last, birthday, gender
```

#### Step 3: Camoufox Launch
```python
from camoufox.sync_api import Camoufox
from proxy.parser import parse_proxy

proxy_config = parse_proxy(args.proxy) if args.proxy else None

browser = Camoufox(
    headless=args.headless,
    proxy=proxy_config,
    humanize=True,              # Random typing delay
    geoip=True,                 # Match locale to proxy IP
    os="windows",               # spoof OS
    locale="en-US",
)
```

#### Step 4-6: Form Filling
```python
page.goto("https://www.facebook.com/register", wait_until="networkidle", timeout=30000)

# First Name
page.locator("input[name='firstname']").fill(first_name)

# Last Name
page.locator("input[name='lastname']").fill(last_name)

# Email
page.locator("input[name='reg_email__']").fill(email)

# Password
page.locator("input[name='reg_passwd__']").fill(password)

# Birthday — select dropdown
page.locator("select[name='birthday_day']").select_option(str(day))
page.locator("select[name='birthday_month']").select_option(str(month))
page.locator("select[name='birthday_year']").select_option(str(year))

# Gender — radio button
page.locator(f"input[name='sex'][value='{gender_value}']").click()

# Submit
page.locator("button[name='websubmit']").click()
```

#### Step 7: CAPTCHA Handling
```python
def handle_captcha(page, captcha_key=None):
    """Detect and solve CAPTCHA."""
    # Check for reCAPTCHA
    recaptcha_frame = page.frame_locator("iframe[src*='recaptcha']")
    try:
        if recaptcha_frame.locator(".recaptcha-checkbox").is_visible(timeout=3000):
            if captcha_key:
                # Solve via 2Captcha API
                token = solve_recaptcha_v2(captcha_key, page.url)
                # Inject token
                page.evaluate(f"""
                    document.getElementById('g-recaptcha-response').innerHTML = '{token}';
                """)
                # Submit again
                page.locator("button[name='websubmit']").click()
    except:
        pass
```

#### Step 8-10: Email Verification
```python
def wait_for_fb_verify_email(ammail_client, alias, timeout=180):
    """Poll Ammail for Facebook verification email."""
    import time
    
    start = time.time()
    while time.time() - start < timeout:
        messages = ammail_client.list_messages(alias)
        for msg in messages:
            if "facebook" in (msg.get("sender", "")).lower() or \
               "facebook" in (msg.get("subject", "")).lower():
                full = ammail_client.get_message(msg["id"])
                return full
        time.sleep(5)
    
    return None

def extract_fb_otp(email_body):
    """Extract OTP from Facebook email."""
    import re
    
    # Facebook OTP patterns
    patterns = [
        r'(\d{5})',                              # 5-digit code
        r'code[:\s]+(\d{5,6})',                  # "code: 12345"
        r'verification[:\s]+(\d{5,6})',          # "verification: 12345"
        r'(?:https?://)[^\s]+confirm[^\s]+',     # Verification URL
    ]
    
    for pattern in patterns:
        match = re.search(pattern, email_body, re.I)
        if match:
            return match.group(1) if match.lastindex else match.group(0)
    
    return None
```

#### Step 11: Submit OTP
```python
# If OTP page appears
otp_input = page.locator("input[name='code'], input[name='confirmation_code']")
if otp_input.is_visible(timeout=5000):
    otp_input.fill(otp_code)
    page.locator("button[type='submit'], button:has-text('Confirm')").click()
```

#### Step 12: Extract Session
```python
def extract_session(page):
    """Extract cookies and session data."""
    cookies = page.context.cookies()
    
    # Key cookies to extract
    session_cookies = {}
    for cookie in cookies:
        if cookie["name"] in ["c_user", "xs", "fr", "datr", "sb", "wd"]:
            session_cookies[cookie["name"]] = cookie["value"]
    
    return {
        "cookies": session_cookies,
        "all_cookies": cookies,
    }
```

#### Step 13: Output JSON
```python
result = {
    "status": "success",
    "email": args.email,
    "password": args.password,
    "first_name": first_name,
    "last_name": last_name,
    "session": extract_session(page),
}
print(json.dumps(result))
```

### Error Handling

```python
class FbSignupError(Exception):
    pass

class CaptchaError(FbSignupError):
    pass

class EmailNotReceivedError(FbSignupError):
    pass

class AccountBlockedError(FbSignupError):
    pass

# Main try-catch
try:
    # ... signup flow
except CaptchaError as e:
    print(json.dumps({"status": "failed", "error": "captcha", "detail": str(e)}))
    sys.exit(1)
except EmailNotReceivedError as e:
    print(json.dumps({"status": "failed", "error": "email_timeout", "detail": str(e)}))
    sys.exit(1)
except AccountBlockedError as e:
    print(json.dumps({"status": "failed", "error": "blocked", "detail": str(e)}))
    sys.exit(1)
except Exception as e:
    print(json.dumps({"status": "failed", "error": "unknown", "detail": str(e)[:300]}))
    sys.exit(1)
```

### Anti-Detection Patterns

```python
# 1. Random delays (jangan semua langsung)
import time
import random

def human_delay(min_ms=500, max_ms=2000):
    time.sleep(random.uniform(min_ms/1000, max_ms/1000))

# 2. Human-like typing
def human_type(page, selector, text):
    el = page.locator(selector)
    el.click()
    for char in text:
        el.press_sequentially(char, delay=random.randint(50, 150))

# 3. Random scroll sebelum action
def random_scroll(page):
    page.evaluate(f"window.scrollBy(0, {random.randint(100, 300)})")
    time.sleep(random.uniform(0.3, 0.8))

# 4. Jangan langsung submit form
def fill_form_with_delays(page, fields):
    for selector, value in fields.items():
        human_type(page, selector, value)
        human_delay(300, 800)

# 5. Proxy rotation
proxy_round_robin_idx = 0
def get_next_proxy(proxies):
    global proxy_round_robin_idx
    proxy = proxies[proxy_round_robin_idx % len(proxies)]
    proxy_round_robin_idx += 1
    return proxy
```

### File Structure

```
backend/src/automation/
├── fb_signup.py              ← Main signup script
├── fb_verify.py              ← Email verification helper
├── captcha_solver.py         ← reCAPTCHA solver (2Captcha)
├── identity_generator.py     ← Generate random identities
├── proxy_parser.py           ← (copy dari _extract/proxy/parser.py)
└── profiles/fb/              ← Browser profiles
```

### Integration dengan Node.js Orchestrator

Di route.ts, spawn Python script:

```typescript
const child = spawn(pythonPath, [
  "backend/src/automation/fb_signup.py",
  `--email=${email}`,
  `--password=${password}`,
  `--proxy=${proxyUrl}`,
  `--ammail-base-url=${ammailBaseUrl}`,
  `--ammail-api-key=${ammailApiKey}`,
  `--ammail-domain=${ammailDomain}`,
  `--headless`,
], { env: process.env });

child.stdout.on("data", (data) => {
  const line = data.toString();
  try {
    const result = JSON.parse(line);
    if (result.status === "success") {
      // Save to database
    }
  } catch {}
});

child.stderr.on("data", (data) => {
  console.error("FB Signup:", data.toString());
});
```

### Database Schema (tambahkan di schema.js)

```javascript
fbAccounts: {
  columns: {
    id: "INTEGER PRIMARY KEY AUTOINCREMENT",
    email: "TEXT NOT NULL",
    password: "TEXT NOT NULL",
    firstName: "TEXT",
    lastName: "TEXT",
    birthday: "TEXT",
    gender: "TEXT",
    sessionId: "TEXT",
    sessionData: "TEXT",
    status: "TEXT DEFAULT 'pending'",
    lastError: "TEXT",
    createdAt: "TEXT NOT NULL",
  },
  unique: ["email"],
  indexes: ["CREATE INDEX IF NOT EXISTS idx_fb_email ON fbAccounts(email)"],
},
```

### Flow Diagram

```
┌─────────────────────────────────────────────────────────┐
│                  Node.js Orchestrator                   │
│  codebuddy/route.ts → spawn python fb_signup.py        │
└─────────────────────────┬───────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────┐
│                    fb_signup.py                         │
│                                                         │
│  1. Parse args                                          │
│  2. Generate identity (name, birthday, gender)          │
│  3. Create Ammail inbox → email@domain.com              │
│  4. Launch Camoufox + proxy                             │
│  5. Buka facebook.com/register                         │
│  6. Isi form (name, email, password, birthday, gender)  │
│  7. Handle CAPTCHA (reCAPTCHA v2 → 2Captcha)            │
│  8. Submit                                              │
│  9. Poll Ammail → tunggu email dari Facebook             │
│ 10. Extract OTP / verification URL                      │
│ 11. Submit OTP di browser                               │
│ 12. Login → extract session cookies                     │
│ 13. Output JSON result                                  │
│                                                         │
└─────────────────────────┬───────────────────────────────┘
                          │ stdout JSON
                          ▼
┌─────────────────────────────────────────────────────────┐
│                  Node.js Orchestrator                   │
│  Parse result → save to DB → mark success/failed        │
└─────────────────────────────────────────────────────────┘
```

### Testing Checklist

- [ ] Bisa create inbox via Ammail API
- [ ] Bisa extract OTP dari email Facebook
- [ ] Buka facebook.com/register tanpa block
- [ ] Isi form berhasil
- [ ] Handle reCAPTCHA v2
- [ ] Submit OTP berhasil
- [ ] Extract session cookies
- [ ] Output JSON valid
- [ ] Handle error: email timeout, captcha fail, blocked
- [ ] Proxy rotation works
- [ ] Headless mode works
- [ ] Multiple concurrent signups (stagger delay)
```

---

## CATATAN PENTING

1. **reCAPTCHA**: Facebook pakai reCAPTCHA v2/v3, BUKAN Turnstile. Kamu perlu 2Captcha key yang support reCAPTCHA.

2. **Phone Number**: Facebook sering minta nomor HP setelah signup. Siapkan SMS service (sms-activate.org / 5sim.net) sebagai fallback.

3. **Rate Limit**: Jangan buat terlalu banyak akun dari IP yang sama. Gunakan proxy pool + stagger delay.

4. **Email Domain**: Beberapa domain temp email sudah di-block Facebook. Test dulu dengan domain kamu.

5. **Account Warming**: Setelah akun jangan langsung dipakai untuk automation berat. Warm up dulu (scroll, like, add friends).
