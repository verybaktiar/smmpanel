'use strict';

const db = require('./src/db');
const actions = require('./src/actions');

const args = process.argv.slice(2);
const command = args[0];

function parseArgs(list) {
  const out = {};
  for (let i = 1; i < list.length; i++) {
    const a = list[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const val = list[i + 1];
      if (val !== undefined && !val.startsWith('--')) {
        out[key] = val;
        i++;
      } else {
        out[key] = true;
      }
    }
  }
  return out;
}

async function cmdAccountAdd(opts) {
  if (!opts.name || !opts.email || !opts.password) {
    console.error('Usage: node cli.js account add --name <nama> --email <email> --password <pass> [--proxy host:port:user:pass] [--platform fb|ig|tiktok]');
    return;
  }
  const platform = ['fb', 'ig', 'tiktok'].includes((opts.platform || '').toLowerCase())
    ? opts.platform.toLowerCase()
    : 'fb';
  const id = await db.addAccount({
    name: opts.name,
    email: opts.email,
    password: opts.password,
    userAgent: opts.ua,
    viewport: opts.viewport,
    locale: opts.locale,
    timezone: opts.timezone,
    proxy: opts.proxy,
    platform,
  });
  console.log(`Akun "${opts.name}" ditambahkan (id=${id}, platform=${platform}).`);
  console.log('Langkah berikut: jalankan "node cli.js login --name ' + opts.name + '" untuk auto-login pertama.');
}

async function cmdAccountList() {
  const stats = await db.getAccountStats();
  console.log(`=== Statistik Akun ===`);
  console.log(`Total: ${stats.total} | Active: ${stats.active} | Checkpoint: ${stats.checkpoint} | Inactive: ${stats.inactive} | Belum Login: ${stats.neverLoggedIn}`);
  console.log(``);
  
  const accounts = await db.listAccounts();
  if (!accounts.length) {
    console.log('Belum ada akun.');
    return;
  }
  for (const a of accounts) {
    const lastLogin = a.last_login ? new Date(a.last_login).toLocaleString('id-ID') : 'belum pernah';
    console.log(`#${a.id} | ${a.name} | ${a.email} | status=${a.status} | last_login=${lastLogin}`);
  }
}

async function cmdLikeAll(opts) {
  if (!opts.url) {
    console.error('Usage: node cli.js like-all --url <post_url> [--status active]');
    return;
  }
  
  const statusFilter = opts.status || 'active';
  const accounts = await db.listAccounts();
  const filtered = accounts.filter(a => a.status === statusFilter);
  
  if (!filtered.length) {
    console.log(`Tidak ada akun dengan status "${statusFilter}".`);
    return;
  }
  
  console.log(`Like batch untuk ${filtered.length} akun ke ${opts.url}...\n`);
  
  const results = { success: 0, failed: 0 };
  const MAX_CONCURRENT = parseInt(process.env.MAX_CONCURRENT_BATCH) || 5;
  
  for (let i = 0; i < filtered.length; i += MAX_CONCURRENT) {
    const batch = filtered.slice(i, i + MAX_CONCURRENT);
    await Promise.all(batch.map(async (account, idx) => {
      console.log(`[${i + idx + 1}/${filtered.length}] Like dari ${account.name} ...`);
      try {
        const result = await actions.likePosting(account, opts.url);
        if (result.ok) {
          console.log(`  ✓ ${account.name}: Like berhasil`);
          results.success++;
        } else {
          console.log(`  ✗ ${account.name}: Gagal - ${result.reason}`);
          results.failed++;
        }
      } catch (err) {
        console.log(`  ✗ ${account.name}: Error - ${err.message}`);
        results.failed++;
      }
    }));
  }
  
  console.log(`\n=== Hasil: ${results.success} berhasil, ${results.failed} gagal ===`);
}

async function cmdLogin(opts) {
  if (opts.all) {
    return await cmdLoginAll(opts);
  }
  if (!opts.name) {
    console.error('Usage: node cli.js login --name <nama>');
    console.error('       node cli.js login --all [--status active|inactive|checkpoint]');
    return;
  }
  const account = await db.getAccountByName(opts.name);
  if (!account) {
    console.error(`Akun "${opts.name}" tidak ditemukan.`);
    return;
  }
  console.log(`Login otomatis untuk ${account.email} ...`);
  const result = await actions.loginAccount(account);
  if (result.ok) {
    await db.setAccountStatus(account.id, 'active');
    await db.setAccountLastLogin(account.id);
    await db.logPost({ accountId: account.id, status: 'login_ok', message: 'Login berhasil' });
    console.log('✓ Login berhasil, session tersimpan.');
  } else {
    await db.setAccountStatus(account.id, 'checkpoint');
    await db.logPost({ accountId: account.id, status: 'login_failed', message: result.reason });
    console.error(`✗ Login gagal: ${result.reason}. Kemungkinan perlu verifikasi manual / kredensial salah.`);
  }
}

async function cmdLoginAll(opts) {
  const statusFilter = opts.status || null;
  const accounts = await db.listAccounts();
  const filtered = statusFilter 
    ? accounts.filter(a => a.status === statusFilter)
    : accounts;
  
  if (!filtered.length) {
    console.log('Tidak ada akun yang cocok.');
    return;
  }
  
  console.log(`Login batch untuk ${filtered.length} akun (${statusFilter || 'semua status'})...\n`);
  
  const results = { success: 0, failed: 0 };
  const MAX_CONCURRENT = parseInt(process.env.MAX_CONCURRENT_BATCH) || 5;
  
  for (let i = 0; i < filtered.length; i += MAX_CONCURRENT) {
    const batch = filtered.slice(i, i + MAX_CONCURRENT);
    await Promise.all(batch.map(async (account, idx) => {
      console.log(`[${i + idx + 1}/${filtered.length}] Login ${account.email} ...`);
      try {
        const result = await actions.loginAccount(account);
        if (result.ok) {
          await db.setAccountStatus(account.id, 'active');
          await db.setAccountLastLogin(account.id);
          await db.logPost({ accountId: account.id, status: 'login_ok', message: 'Login berhasil' });
          console.log(`  ✓ ${account.name}: Login berhasil`);
          results.success++;
        } else {
          await db.setAccountStatus(account.id, 'checkpoint');
          await db.logPost({ accountId: account.id, status: 'login_failed', message: result.reason });
          console.log(`  ✗ ${account.name}: Gagal - ${result.reason}`);
          results.failed++;
        }
      } catch (err) {
        console.log(`  ✗ ${account.name}: Error - ${err.message}`);
        results.failed++;
      }
    }));
  }
  
  console.log(`\n=== Hasil: ${results.success} berhasil, ${results.failed} gagal ===`);
}

async function cmdSchedule(opts) {
  if (!opts.account || !opts.content || !opts.time) {
    console.error('Usage: node cli.js schedule --account <nama> --content "<teks>" --time "HH:MM"');
    return;
  }
  const account = await db.getAccountByName(opts.account);
  if (!account) {
    console.error(`Akun "${opts.account}" tidak ditemukan.`);
    return;
  }
  const contentId = await db.addContent(opts.content);
  const today = new Date();
  const [hh, mm] = opts.time.split(':');
  today.setHours(Number(hh), Number(mm), 0, 0);
  const iso = today.toISOString();
  const scheduleId = await db.addSchedule(account.id, contentId, iso);
  console.log(`Jadwal dibuat: akun="${opts.account}" waktu="${opts.time}" (${iso}) id=#${scheduleId}`);
}

async function cmdScheduleList() {
  const rows = await db.rawAll(`
    SELECT s.id, a.name AS account, c.text AS content, s.scheduled_at, s.status
    FROM schedules s JOIN accounts a ON a.id=s.account_id JOIN contents c ON c.id=s.content_id
    ORDER BY s.scheduled_at
  `);
  for (const r of rows) {
    console.log(`#${r.id} | ${r.account} | ${new Date(r.scheduled_at).toLocaleString()} | [${r.status}] | ${r.content.slice(0, 40)}`);
  }
}

async function cmdLike(opts) {
  if (!opts.name || !opts.url) {
    console.error('Usage: node cli.js like --name <nama> --url <post_url>');
    return;
  }
  const account = await db.getAccountByName(opts.name);
  if (!account) {
    console.error(`Akun "${opts.name}" tidak ditemukan.`);
    return;
  }
  console.log(`Like dari ${account.name} ke ${opts.url} ...`);
  const result = await actions.likePosting(account, opts.url);
  if (result.ok) {
    console.log('✓ Like berhasil.');
  } else {
    console.error(`✗ Like gagal: ${result.reason}`);
  }
}

async function cmdPostAll(opts) {
  if (!opts.content) {
    console.error('Usage: node cli.js post-all --content "<teks>" [--status active]');
    return;
  }
  
  const statusFilter = opts.status || 'active';
  const accounts = await db.listAccounts();
  const filtered = accounts.filter(a => a.status === statusFilter);
  
  if (!filtered.length) {
    console.log(`Tidak ada akun dengan status "${statusFilter}".`);
    return;
  }
  
  console.log(`Post batch untuk ${filtered.length} akun...\n`);
  
  const results = { success: 0, failed: 0 };
  const MAX_CONCURRENT = parseInt(process.env.MAX_CONCURRENT_BATCH) || 5;
  
  for (let i = 0; i < filtered.length; i += MAX_CONCURRENT) {
    const batch = filtered.slice(i, i + MAX_CONCURRENT);
    await Promise.all(batch.map(async (account, idx) => {
      console.log(`[${i + idx + 1}/${filtered.length}] Post dari ${account.name} ...`);
      try {
        const result = await actions.postToTimeline(account, opts.content);
        if (result.ok) {
          console.log(`  ✓ ${account.name}: Post berhasil`);
          results.success++;
        } else {
          console.log(`  ✗ ${account.name}: Gagal - ${result.reason}`);
          results.failed++;
        }
      } catch (err) {
        console.log(`  ✗ ${account.name}: Error - ${err.message}`);
        results.failed++;
      }
    }));
  }
  
  console.log(`\n=== Hasil: ${results.success} berhasil, ${results.failed} gagal ===`);
}

async function cmdScheduleAdd(opts) {
  if (!opts.account || !opts.content || !opts.time) {
    console.error('Usage: node cli.js schedule add --account <nama> --content "<teks>" --time "HH:MM"');
    return;
  }
  await cmdSchedule(opts);
}

async function cmdRun(opts) {
  const batchRunner = require('./src/batch-runner');

  if (!opts.action) {
    console.error('Usage: node cli.js run --action <login|like|ig-like|post|post-ig> [--all] [--ids 1,2,3] [--status active] [--platform fb] [--url <url>] [--content <teks>] [--caption <teks>]');
    return;
  }

  const valid = ['login', 'like', 'ig-like', 'post', 'post-ig'];
  if (!valid.includes(opts.action)) {
    console.error(`Action "${opts.action}" tidak valid. Pilih: ${valid.join(', ')}`);
    return;
  }

  if ((opts.action === 'like' || opts.action === 'ig-like') && !opts.url) {
    console.error('Parameter --url wajib untuk aksi like');
    return;
  }
  if ((opts.action === 'post' || opts.action === 'post-ig') && !opts.content) {
    console.error('Parameter --content wajib untuk aksi post');
    return;
  }

  let accounts = [];
  if (opts.ids) {
    const ids = opts.ids.split(',').map(Number).filter(Boolean);
    for (const id of ids) {
      const a = await db.getAccountById(id);
      if (a) accounts.push(a);
    }
    if (!accounts.length) { console.error('Tidak ada akun valid dari --ids'); return; }
  } else if (opts.all) {
    const all = await db.listAccounts();
    accounts = all.filter(a => {
      if (opts.status && a.status !== opts.status) return false;
      if (opts.platform && a.platform !== opts.platform) return false;
      return true;
    });
    if (!accounts.length) { console.error('Tidak ada akun cocok dengan filter'); return; }
  } else {
    console.error('Gunakan --all untuk semua akun atau --ids 1,2,3 untuk pilih akun tertentu');
    return;
  }

  console.log(`\n🔁 Batch Run: ${opts.action} pada ${accounts.length} akun (concurrency=${batchRunner.MAX_CONCURRENT})...\n`);

  const summary = await batchRunner.runBatch(accounts, opts.action, {
    url: opts.url,
    content: opts.content,
    caption: opts.caption,
  });

  console.log(`\n=== HASIL BATCH RUN ===`);
  console.log(`  Action : ${summary.action}`);
  console.log(`  Total  : ${summary.total}`);
  console.log(`  ✅ Sukses: ${summary.success}`);
  console.log(`  ❌ Gagal : ${summary.failed}`);
  console.log(``);
  for (const r of summary.results) {
    const icon = r.ok ? '✅' : '❌';
    console.log(`  ${icon} ${r.name} (${r.email}) ${r.ok ? '' : ': ' + r.reason}`);
  }
}

const handlers = {
  account: { add: cmdAccountAdd, list: cmdAccountList },
  login: cmdLogin,
  'login-all': cmdLoginAll,
  like: cmdLike,
  'like-all': cmdLikeAll,
  'post-all': cmdPostAll,
  run: cmdRun,
  schedule: { add: cmdScheduleAdd, list: cmdScheduleList },
};

(async () => {
  require('dotenv').config();
  const segment = handlers[command];
  if (!segment) {
    console.log('Perintah tersedia:');
    console.log('  node cli.js account add --name <nama> --email <e> --password <p>');
    console.log('  node cli.js account list');
    console.log('  node cli.js login --name <nama>');
    console.log('  node cli.js login --all [--status active|inactive|checkpoint]');
    console.log('  node cli.js like --name <nama> --url <post_url>');
    console.log('  node cli.js like-all --url <post_url> [--status active]');
    console.log('  node cli.js post-all --content "<teks>" [--status active]');
    console.log('  node cli.js run --action login|like|ig-like|post|post-ig --all [--status <status>] [--platform <fb|ig>] [--url <url>] [--content "<teks>"]');
    console.log('  node cli.js run --action like --ids 1,2,3 --url <post_url>');
    console.log('  node cli.js schedule --account <nama> --content "<teks>" --time "HH:MM"');
    console.log('  node cli.js schedule list');
    return;
  }
  const opts = parseArgs(args);
  if (typeof segment === 'function') {
    await segment(opts);
  } else {
    const subKey = args[1];
    let sub;
    if (subKey && !subKey.startsWith('--')) {
      sub = segment[subKey];
    } else {
      // Tanpa subcommand eksplisit → default ke add (untuk schedule/account)
      sub = segment.add || segment.list;
    }
    await (sub || segment.list)(opts);
  }
})();