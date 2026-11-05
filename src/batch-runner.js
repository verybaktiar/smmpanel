'use strict';

const db = require('./db');
const actions = require('./actions');
const { broadcastNotification } = require('./websocket');

const MAX_CONCURRENT = parseInt(process.env.MAX_CONCURRENT_BATCH) || 5;

let running = false;
let progress = {
  running: false,
  action: null,
  total: 0,
  done: 0,
  success: 0,
  failed: 0,
  current: null,
  currentStep: 0,
  steps: [],
  lastError: null,
  startedAt: null,
};

function resetProgress(action, total) {
  running = true;
  progress = {
    running: true,
    action,
    total,
    done: 0,
    success: 0,
    failed: 0,
    current: null,
    currentStep: 0,
    steps: [],
    lastError: null,
    startedAt: new Date().toISOString(),
  };
}

function getStepsForAction(action) {
  const stepTemplates = {
    login: [
      { label: '🌐 Membuka browser', icon: '🌐' },
      { label: '📧 Mengisi email', icon: '📧' },
      { label: '🔐 Mengisi password', icon: '🔐' },
      { label: '🔘 Klik tombol login', icon: '🔘' },
      { label: '✅ Verifikasi login', icon: '✅' }
    ],
    like: [
      { label: '🌐 Membuka browser', icon: '🌐' },
      { label: '🔗 Membuka URL postingan', icon: '🔗' },
      { label: '👍 Mencari tombol like', icon: '👍' },
      { label: '✅ Mengklik like', icon: '✅' }
    ],
    'ig-like': [
      { label: '🌐 Membuka browser', icon: '🌐' },
      { label: '🔗 Membuka URL postingan IG', icon: '🔗' },
      { label: '❤️ Mencari tombol like', icon: '❤️' },
      { label: '✅ Mengklik like', icon: '✅' }
    ],
    post: [
      { label: '🌐 Membuka browser', icon: '🌐' },
      { label: '📝 Membuka composer', icon: '📝' },
      { label: '⌨️ Mengetik konten', icon: '⌨️' },
      { label: '📤 Posting', icon: '📤' },
      { label: '✅ Verifikasi posting', icon: '✅' }
    ],
    'post-ig': [
      { label: '🌐 Membuka browser', icon: '🌐' },
      { label: '➕ Membuka new post', icon: '➕' },
      { label: '🖼️ Upload media', icon: '🖼️' },
      { label: '📝 Menulis caption', icon: '📝' },
      { label: '📤 Posting', icon: '📤' }
    ]
  };
  return stepTemplates[action] || [
    { label: '🔄 Memproses', icon: '🔄' },
    { label: '✅ Selesai', icon: '✅' }
  ];
}

function updateStep(stepIndex, success = true, duration = null) {
  if (stepIndex < progress.steps.length) {
    progress.steps[stepIndex].success = success;
    if (duration !== null) progress.steps[stepIndex].duration = duration;
  }
  progress.currentStep = stepIndex;
}

function getProgress() {
  return { ...progress };
}

function isRunning() {
  return running;
}

function broadcast() {
  broadcastNotification('batch-progress', { ...progress });
}

async function runActionForAccount(account, action, params) {
  const res = await (async () => {
    switch (action) {
      case 'login':
        return await actions.loginAccount(account);
      case 'like':
        return await actions.likePosting(account, params.url);
      case 'ig-like':
        return await actions.likeIgPosting(account, params.url);
      case 'post':
        return await actions.postToTimeline(account, params.content, params.mediaPath);
      case 'post-ig':
        return await actions.postToInstagram(account, params.mediaPath, params.caption);
      default:
        return { ok: false, reason: `Action tidak dikenal: ${action}` };
    }
  })();
  return res && typeof res === 'object' ? res : { ok: !!res, reason: res };
}

async function persistResult(account, action, res, params) {
  const base = { accountId: account.id, contentText: params.content || '' };
  try {
    if (action === 'login') {
      if (res.ok) {
        await db.setAccountStatus(account.id, 'active');
        await db.setAccountLastLogin(account.id);
        await db.logPost({ ...base, status: 'login_ok', message: 'Batch login berhasil' });
      } else {
        await db.setAccountStatus(account.id, 'checkpoint');
        await db.logPost({ ...base, status: 'login_failed', message: 'Batch login: ' + (res.reason || '') });
      }
    } else if (action === 'like' || action === 'ig-like') {
      await db.logPost({
        ...base,
        status: res.ok ? 'like_ok' : 'like_failed',
        message: (action === 'ig-like' ? 'IG ' : 'FB ') + 'Batch like: ' + (res.reason || 'OK'),
      });
    } else if (action === 'post' || action === 'post-ig') {
      await db.logPost({
        ...base,
        status: res.ok ? 'post_ok' : 'post_failed',
        message: 'Batch post: ' + (res.reason || 'OK'),
      });
    }
  } catch (e) {
    console.error(`  [batch] gagal persist hasil ${account.name}: ${e.message}`);
  }
}

async function runBatch(accountList, action, params = {}, opts = {}) {
  const concurrency = Math.max(1, parseInt(opts.concurrency) || MAX_CONCURRENT);
  const filtered = (accountList || []).filter(Boolean);

  if (running) {
    const err = new Error('Batch lain sedang berjalan. Tunggu sampai selesai terlebih dahulu.');
    err.status = 409;
    throw err;
  }
  if (!filtered.length) throw new Error('Tidak ada akun untuk dijalankan.');
  if (!actions[actionMap[action]]) {
    const err = new Error(`Action "${action}" tidak dikenal. Gunakan: ${Object.keys(actionMap).join(', ')}`);
    err.status = 400;
    throw err;
  }

  resetProgress(action, filtered.length);
  const summary = {
    action,
    total: filtered.length,
    success: 0,
    failed: 0,
    results: [],
  };

  try {
    for (let i = 0; i < filtered.length; i += concurrency) {
      const batch = filtered.slice(i, i + concurrency);
      await Promise.all(batch.map(async (account) => {
        progress.current = account.name;
        progress.steps = getStepsForAction(action).map(s => ({ ...s, success: null, duration: null }));
        progress.currentStep = 0;
        broadcast();
        
        const startTime = Date.now();
        const res = await runActionForAccount(account, action, params)
          .catch((err) => ({ ok: false, reason: 'error: ' + err.message }));
        const duration = Date.now() - startTime;

        // Mark all steps based on result
        const success = res.ok;
        const errorReason = res.reason || 'unknown_error';
        progress.steps.forEach((step, idx) => {
          step.success = success;
          step.errorMsg = success ? null : errorReason;
          if (idx === progress.steps.length - 1) step.duration = duration;
        });
        progress.currentStep = progress.steps.length;
        // Set lastError only if this is a new failure
        if (!success) {
          progress.lastError = errorReason;
        } else {
          progress.lastError = null;
        }
        broadcast();

        await persistResult(account, action, res, params);

        progress.done++;
        if (res.ok) {
          progress.success++;
          summary.success++;
        } else {
          progress.failed++;
          summary.failed++;
          // Kirim notifikasi error ke frontend
          broadcastNotification('batch-error', {
            accountName: account.name,
            error: res.reason || 'Unknown error'
          });
        }
        summary.results.push({
          accountId: account.id,
          name: account.name,
          email: account.email,
          ok: res.ok,
          reason: res.reason || null,
        });
        broadcast();
      }));
    }
  } finally {
    running = false;
    progress.running = false;
    progress.current = null;
    progress.steps = [];
    progress.currentStep = 0;
    broadcastNotification('batch-done', summary);
  }
  return summary;
}

const actionMap = {
  login: 'loginAccount',
  like: 'likePosting',
  'ig-like': 'likeIgPosting',
  post: 'postToTimeline',
  'post-ig': 'postToInstagram',
};

module.exports = {
  runBatch,
  getProgress,
  isRunning,
  MAX_CONCURRENT,
};
