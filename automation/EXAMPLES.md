# Examples - Facebook Auto-Signup

Kumpulan contoh penggunaan berbagai scenario.

## 1. Basic Single Account

```bash
node cli.js --auto
```

## 2. Custom Email & Password

```bash
node cli.js \
  --email johndoe@mail.com \
  --password MySecretPass123
```

## 3. Full Custom Data

```bash
node cli.js \
  --email custom@mail.com \
  --password Pass123456 \
  --first-name John \
  --last-name Smith \
  --gender male
```

## 4. With Proxy (HTTP)

```bash
node cli.js \
  --auto \
  --proxy "proxy.example.com:8080:username:password"
```

## 5. With Proxy (SOCKS5)

```bash
node cli.js \
  --auto \
  --proxy "socks5://proxy.example.com:1080"
```

## 6. Headless Mode

```bash
node cli.js --auto --headless
```

## 7. Batch Creation (5 Accounts)

```bash
node cli.js \
  --auto \
  --batch 5 \
  --delay 15000 \
  --headless
```

## 8. Save Results to JSON

```bash
node cli.js \
  --auto \
  --batch 3 \
  --output my-accounts.json
```

## 9. With Proxy Rotation (Programmatic)

File: `batch-with-proxies.js`

```javascript
import FacebookSignup from './fb-signup.js';
import { logger } from './utils/logger.js';
import fs from 'fs/promises';

const proxies = [
  'proxy1.com:8080:user1:pass1',
  'proxy2.com:8080:user2:pass2',
  'proxy3.com:8080:user3:pass3'
];

async function main() {
  const accounts = [];
  
  for (let i = 0; i < 10; i++) {
    const proxy = proxies[i % proxies.length];
    
    logger.info(`\nCreating account ${i + 1}/10 with proxy: ${proxy.split(':')[0]}`);
    
    const signup = new FacebookSignup({
      auto: true,
      headless: true,
      proxy: proxy
    });
    
    const result = await signup.run();
    accounts.push(result);
    
    if (result.status === 'success') {
      logger.success(`✅ ${result.email} created!`);
    } else {
      logger.error(`❌ Failed: ${result.error}`);
    }
    
    // Wait before next
    if (i < 9) {
      logger.info('Waiting 30 seconds...');
      await new Promise(resolve => setTimeout(resolve, 30000));
    }
  }
  
  // Save results
  await fs.writeFile('batch-results.json', JSON.stringify(accounts, null, 2));
  logger.success(`\nAll done! Results saved to batch-results.json`);
}

main().catch(console.error);
```

Run:
```bash
node batch-with-proxies.js
```

## 10. Read Proxies from File

File: `proxies.txt`
```
proxy1.com:8080:user1:pass1
proxy2.com:8080:user2:pass2
proxy3.com:8080:user3:pass3
```

File: `batch-from-file.js`
```javascript
import FacebookSignup from './fb-signup.js';
import { logger } from './utils/logger.js';
import fs from 'fs/promises';

async function main() {
  // Read proxies
  const proxyContent = await fs.readFile('proxies.txt', 'utf-8');
  const proxies = proxyContent.split('\n').filter(p => p.trim());
  
  logger.info(`Found ${proxies.length} proxies`);
  
  const accounts = [];
  
  for (const proxy of proxies) {
    const signup = new FacebookSignup({
      auto: true,
      headless: true,
      proxy: proxy.trim()
    });
    
    const result = await signup.run();
    accounts.push(result);
    
    await new Promise(resolve => setTimeout(resolve, 20000));
  }
  
  // Filter successful accounts
  const successful = accounts.filter(a => a.status === 'success');
  
  logger.success(`\nCreated ${successful.length}/${accounts.length} accounts`);
  
  // Save credentials
  const credentials = successful.map(a => ({
    email: a.email,
    password: a.password
  }));
  
  await fs.writeFile('credentials.json', JSON.stringify(credentials, null, 2));
  logger.success('Credentials saved to credentials.json');
}

main().catch(console.error);
```

## 11. Retry on Failure

File: `signup-with-retry.js`
```javascript
import FacebookSignup from './fb-signup.js';
import { logger } from './utils/logger.js';

async function signupWithRetry(options, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    logger.info(`\nAttempt ${attempt}/${maxRetries}`);
    
    const signup = new FacebookSignup(options);
    const result = await signup.run();
    
    if (result.status === 'success') {
      logger.success('Account created!');
      return result;
    }
    
    if (attempt < maxRetries) {
      logger.warn(`Failed, retrying in 10 seconds...`);
      await new Promise(resolve => setTimeout(resolve, 10000));
    }
  }
  
  logger.error('All retries failed');
  return null;
}

async function main() {
  const result = await signupWithRetry({
    auto: true,
    headless: true,
    proxy: 'your-proxy:8080:user:pass'
  });
  
  if (result) {
    console.log('\nResult:', result.email, result.password);
  }
}

main().catch(console.error);
```

## 12. Schedule with Node-Cron

File: `scheduled-signup.js`
```javascript
import cron from 'node-cron';
import FacebookSignup from './fb-signup.js';
import { logger } from './utils/logger.js';

// Every day at 2 AM
cron.schedule('0 2 * * *', async () => {
  logger.info('Starting scheduled signup...');
  
  const signup = new FacebookSignup({
    auto: true,
    headless: true
  });
  
  const result = await signup.run();
  
  if (result.status === 'success') {
    logger.success(`Daily account created: ${result.email}`);
  } else {
    logger.error(`Scheduled signup failed: ${result.error}`);
  }
});

logger.info('Scheduler started. Waiting for cron jobs...');
```

Install: `npm install node-cron`

## 13. Export to CSV

File: `export-csv.js`
```javascript
import fs from 'fs/promises';

async function exportToCsv(jsonFile, csvFile) {
  const data = JSON.parse(await fs.readFile(jsonFile, 'utf-8'));
  
  const successful = data.filter(d => d.status === 'success');
  
  let csv = 'Email,Password,Status\n';
  
  for (const account of successful) {
    csv += `${account.email},${account.password},${account.status}\n`;
  }
  
  await fs.writeFile(csvFile, csv);
  console.log(`Exported ${successful.length} accounts to ${csvFile}`);
}

exportToCsv('results.json', 'accounts.csv').catch(console.error);
```

Run:
```bash
node export-csv.js
```

## 14. Webhook Notification on Success

File: `signup-with-webhook.js`
```javascript
import FacebookSignup from './fb-signup.js';
import { logger } from './utils/logger.js';

async function notifyWebhook(url, data) {
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    logger.success('Webhook notified');
  } catch (error) {
    logger.error('Webhook failed:', error.message);
  }
}

async function main() {
  const signup = new FacebookSignup({
    auto: true,
    headless: true
  });
  
  const result = await signup.run();
  
  if (result.status === 'success') {
    await notifyWebhook('https://your-webhook.com/signup', {
      email: result.email,
      password: result.password,
      timestamp: new Date().toISOString()
    });
  }
}

main().catch(console.error);
```

## 15. Integration with Database

File: `save-to-db.js`
```javascript
import FacebookSignup from './fb-signup.js';
import sqlite3 from 'sqlite3';
import { promisify } from 'util';

const db = new sqlite3.Database('accounts.db');
const dbRun = promisify(db.run.bind(db));

async function initDb() {
  await dbRun(`
    CREATE TABLE IF NOT EXISTS accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE,
      password TEXT,
      status TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

async function saveAccount(account) {
  await dbRun(
    'INSERT INTO accounts (email, password, status) VALUES (?, ?, ?)',
    [account.email, account.password, account.status]
  );
}

async function main() {
  await initDb();
  
  const signup = new FacebookSignup({
    auto: true,
    headless: true
  });
  
  const result = await signup.run();
  
  if (result.status === 'success') {
    await saveAccount(result);
    console.log('Account saved to database');
  }
  
  db.close();
}

main().catch(console.error);
```

Install: `npm install sqlite3`

## Tips

1. **Rate Limiting**: Tunggu minimal 10-30 detik antar signup dari IP yang sama
2. **Proxy Quality**: Gunakan residential proxy untuk success rate tinggi
3. **Headless Mode**: Gunakan untuk production, non-headless untuk debugging
4. **Monitoring**: Check `screenshots/` folder jika ada error
5. **Cookies**: Session cookies disimpan di `cookies/` folder

## Common Patterns

### Pattern 1: Bulk Creation with Progress Bar

```javascript
import cliProgress from 'cli-progress';

const bar = new cliProgress.SingleBar();
bar.start(10, 0);

for (let i = 0; i < 10; i++) {
  await createAccount();
  bar.update(i + 1);
}

bar.stop();
```

### Pattern 2: Concurrent Creation (with limit)

```javascript
import pLimit from 'p-limit';

const limit = pLimit(3); // Max 3 concurrent

const promises = accounts.map(config => 
  limit(() => createAccount(config))
);

await Promise.all(promises);
```

### Pattern 3: Queue-based Processing

```javascript
import Queue from 'bull';

const queue = new Queue('signup');

queue.process(async (job) => {
  return await createAccount(job.data);
});

// Add jobs
queue.add({ proxy: 'proxy1:8080:u:p' });
queue.add({ proxy: 'proxy2:8080:u:p' });
```
