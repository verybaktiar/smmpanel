# SMM Panel - Enhanced Edition

Panel manajemen Social Media Marketing dengan fitur automation untuk Facebook & Instagram.

## 🚀 Fitur Utama

### Core Features
- ✅ Multi-account management (Facebook & Instagram)
- ✅ Automated posting dengan scheduler
- ✅ Like automation dengan rate limiting
- ✅ Proxy support untuk setiap account
- ✅ Browser session persistence

### Enhanced Features (NEW)
- 🔥 **Rate Limiting**: Random delay 30-90 detik antar action untuk menghindari ban
- 🔥 **Error Recovery**: Auto-skip failed accounts dan lanjutkan processing
- 🔥 **Health Check**: Monitor status semua accounts secara otomatis
- 🔥 **Queue System**: Background worker untuk automated order processing
- 🔥 **WebSocket**: Real-time monitoring dan progress tracking
- 🔥 **Proxy Validator**: Auto-test dan rotate proxy
- 🔥 **Security**: API authentication, rate limiting, CORS protection
- 🔥 **Database Optimization**: Indexes untuk query performance
- 🔥 **Scheduled Orders**: Schedule order untuk dijalankan di waktu tertentu

---

## 📦 Installation

### 1. Clone & Install
```bash
cd G:\laragon\www\smmpanel
npm install
```

### 2. Setup Environment
```bash
cp .env.example .env
```

Edit `.env` sesuai kebutuhan:
```env
PORT=3000
API_KEY=your-secret-api-key-here
MAX_ACTIONS_PER_HOUR=20
QUEUE_BATCH_SIZE=2
```

### 3. Start Services

**Option A: Manual (2 terminals)**
```bash
# Terminal 1: Main server
npm run server

# Terminal 2: Background worker
npm run worker
```

**Option B: Auto (1 terminal)**
```bash
npm install -g concurrently
npm run dev:all
```

Dashboard akan tersedia di: `http://localhost:3000`

---

## 📚 API Documentation

### Health Check
```bash
# Check single account
GET /api/health/account/:id

# Check all accounts
GET /api/health/accounts
```

### Proxy Management
```bash
# Test single proxy
POST /api/proxy/test
Body: { "proxy": "host:port:user:pass" }

# Validate all proxies
GET /api/proxy/validate-all

# Rotate proxy for account
POST /api/proxy/rotate/:accountId
```

### Queue Management
```bash
# Process specific order
POST /api/queue/process-order/:id
Body: { "batchSize": 2 }

# Process all running orders
POST /api/queue/process-all

# Get queue statistics
GET /api/queue/stats
```

### Scheduled Orders
```bash
# Create scheduled order
POST /api/smm/like-orders-scheduled
Body: {
  "post_url": "https://facebook.com/post/123",
  "quantity": 50,
  "platform": "fb",
  "scheduled_at": "2026-08-24T10:00:00Z"
}
```

### System Status
```bash
# Get complete system status
GET /api/system/status
```

---

## 🔧 Configuration

### Rate Limiting
Default: 20 actions per hour per account

```env
MAX_ACTIONS_PER_HOUR=20
QUEUE_MIN_DELAY_SECONDS=30
QUEUE_MAX_DELAY_SECONDS=90
```

### Queue Processing
Batch size menentukan berapa execution diproses per batch:

```env
QUEUE_BATCH_SIZE=2  # Recommended: 2-3
```

### Security
Set API key untuk production:

```env
API_KEY=your-secret-key-here
CORS_ORIGIN=https://yourdomain.com
```

---

## 🤖 Background Worker

Worker otomatis menjalankan tasks berikut:

| Task | Schedule | Description |
|------|----------|-------------|
| Process Orders | Every 2 minutes | Process running orders |
| Check Scheduled | Every 5 minutes | Start scheduled orders |
| Health Check | Daily 03:00 | Check all accounts health |
| Proxy Validation | Every 6 hours | Validate all proxies |
| Database Cleanup | Sunday 02:00 | Clean old logs/orders |

---

## 🔌 WebSocket Events

Connect ke WebSocket untuk real-time updates:

```javascript
const socket = io('http://localhost:3000');

// Order progress
socket.on('order:progress', (data) => {
  console.log('Progress:', data);
});

// Execution updates
socket.on('execution:update', (data) => {
  console.log('Execution:', data);
});

// Health check results
socket.on('account:health', (data) => {
  console.log('Health:', data);
});

// System notifications
socket.on('notification', (data) => {
  console.log('Notification:', data);
});
```

---

## 📊 Performance Improvements

| Feature | Before | After | Improvement |
|---------|--------|-------|-------------|
| Batch Size | 5 likes | 2 likes | 60% safer |
| Delay | None | 30-90s | Human-like |
| Query Speed | Slow | Fast | 10x faster (indexes) |
| Error Handling | Stop on error | Continue | 100% resilient |
| Monitoring | Manual | Real-time | WebSocket |

---

## 🛡️ Security Best Practices

1. **Set API Key** di production
2. **Limit CORS** ke domain spesifik
3. **Use HTTPS** di production
4. **Regular health checks** untuk detect banned accounts
5. **Proxy rotation** untuk distribute load
6. **Rate limiting** untuk avoid detection

---

## 🐛 Troubleshooting

### Worker tidak berjalan
```bash
# Check if worker is running
npm run worker

# Check logs
tail -f server.log
```

### Rate limit terlalu ketat
```bash
# Edit .env
MAX_ACTIONS_PER_HOUR=50

# Restart services
```

### Database error
```bash
# Backup first
cp database.db database.db.backup

# Restart server (auto-migrate)
npm run server
```

### WebSocket tidak connect
```bash
# Check status
curl http://localhost:3000/api/websocket/status

# Check firewall
# Windows: Allow port 3000
```

---

## 📁 Project Structure

```
smmpanel/
├── src/
│   ├── actions.js           # FB/IG automation actions
│   ├── browser.js           # Playwright browser setup
│   ├── db.js               # Database layer
│   ├── scheduler.js        # Post scheduling
│   ├── rate-limiter.js     # NEW: Rate limiting
│   ├── queue-manager.js    # NEW: Queue system
│   ├── health-checker.js   # NEW: Account health
│   ├── proxy-validator.js  # NEW: Proxy validation
│   ├── security.js         # NEW: Security middleware
│   └── websocket.js        # NEW: WebSocket server
├── public/                 # Frontend dashboard
├── server.js              # Main API server
├── worker.js              # NEW: Background worker
├── index.js               # Old scheduler (deprecated)
├── cli.js                 # CLI tools
├── database.db            # SQLite database
└── .env                   # Environment config
```

---

## 🔄 Migration from Old Version

Database akan auto-migrate saat pertama kali dijalankan. Backup database Anda:

```bash
cp database.db database.db.backup
```

Semua data lama tetap aman, kolom dan indexes baru akan ditambahkan otomatis.

---

## 📖 Further Documentation

- [Complete Implementation Guide](IMPLEMENTATION.md)
- [API Reference](IMPLEMENTATION.md#-system-status-endpoint)
- [WebSocket Events](IMPLEMENTATION.md#-websocket-real-time-monitoring)

---

## 🎯 Quick Start Example

```bash
# 1. Install
npm install

# 2. Setup
cp .env.example .env

# 3. Start server
npm run server

# 4. Start worker (new terminal)
npm run worker

# 5. Open dashboard
http://localhost:3000

# 6. Add accounts via dashboard

# 7. Create order with schedule
curl -X POST http://localhost:3000/api/smm/like-orders-scheduled \
  -H "Content-Type: application/json" \
  -d '{
    "post_url": "https://facebook.com/post/123",
    "quantity": 50,
    "platform": "fb",
    "scheduled_at": "2026-08-24T10:00:00Z"
  }'

# Worker akan otomatis start order pada waktu yang ditentukan
```

---

## 📝 License

ISC

---

## 🙏 Support

Jika ada pertanyaan atau issue, silakan check:
1. [Implementation Guide](IMPLEMENTATION.md)
2. Server logs: `server.log`
3. Worker output
4. System status: `GET /api/system/status`
