'use strict';
// CLI wrapper: FB create via job runner (dipicu dari frontend).
// node src/fb-create-run.js [--keep-open] [--gmail-id N] [--phone-signup] "host:port:user:pass"
//
// JALUR NOMOR HP (--phone-signup): daftar FB via nomor telepon — TANPA email/
// temp-mail. Nomor + kode SMS diisi OPERATOR di panel (kartu No. HP & kartu OTP)
// setelah worker mencetak [PHONE_REQUIRED]. Pola sama dgn IG --phone-signup.
// JALUR GMAIL STOK (--gmail-id N): pakai akun Gmail dari gmail_pool sebagai
// email pendaftaran FB. OTP dibaca lewat tab mail.google.com di context browser
// FB — syaratnya profil sessions/gmail-<id> SUDAH login (login_status='ok'
// dari panel; profil yang sama dipakai ulang, bukan login ulang). Pelajaran
// akun keblok kemarin: domain temp-mail massal jadi sinyal; email Gmail asli
// lebih bersih di mata Facebook.
const FacebookAccountCreator = require('./fb-account-creator');
// .env sebelum decrypt password Gmail: ENCRYPTION_KEY (crypto.js melempar bila
// kosong — pelajaran run-1: FATAL sebelum apapun jalan).
require('dotenv').config();

// Bukti teks FB ke account_events bila attempt ini sudah tersambung ke akun
// panel (accountId). signup_history ditulis runner — IP lahir dikenalnya,
// jadi jangan dobel dari sini.
async function recordFbFail(result, proxy, accountId) {
  const status = (result && result.status) || 'failed';
  const failReason = (result && (result.fbReason || result.error)) || null;
  if (!failReason || !accountId) return; // sukses tanpa bukti, atau akun belum terdaftar — tidak dicatat
  const db = require('./db');
  await db.waitReady();
  await db.addAccountEvent({
    accountId, platform: 'fb',
    event: (result && result.fbChallenge) || status,
    source: 'signup', reason: failReason,
  });
}
(async () => {
  const keepOpen = process.argv.includes('--keep-open');
  const phoneSignup = process.argv.includes('--phone-signup');
  const gi = process.argv.indexOf('--gmail-id');
  const gmailId = gi !== -1 && process.argv[gi + 1] ? Number(process.argv[gi + 1]) : null;
  const em = process.argv.indexOf('--email');
  // --email "nama@domain.tld": email ketik-an operator (jalur manual, paritas IG).
  // Bukan Gmail stok, bukan temp-mail: FB daftar pakai email ini, dan kode
  // verifikasinya operator ambil sendiri dari inbox itu lalu isi di kartu OTP panel.
  let manualEmail = null;
  if (em !== -1 && process.argv[em + 1]) {
    manualEmail = String(process.argv[em + 1]).trim().toLowerCase();
  }
  const gm = process.argv.indexOf('--gmail-manual');
  // --gmail-manual "email@gmail.com:password": pakai Gmail tanpa wajib login panel
  // (digunakan saat operator belum login ulang akunnya di panel tapi mau uji FB).
  // Profil Gmail yang dipakai baca OTP tetap sessions/gmail-<id> bila ada sesi
  // hidupnya; kalau tidak ada, tombil OTP lewat tab browser TIDAK AKAN JALAN —
  // jalur ini hanya layak bila profilnya sudah login.
  let manualGmail = null;
  if (gm !== -1 && process.argv[gm + 1]) {
    const cred = process.argv[gm + 1];
    const idx = cred.indexOf(':');
    if (idx === -1) { console.error('[GAGAL] --gmail-manual butuh format email:password'); process.exit(1); }
    manualGmail = { email: cred.slice(0, idx), password: cred.slice(idx + 1) };
  }
  const proxy = process.argv.slice(2).find((a) => !a.startsWith('--')
    && a !== String(gmailId || '')
    && a !== (gm !== -1 ? process.argv[gm + 1] : null)
    && a !== (em !== -1 ? process.argv[em + 1] : null)) || null;
  // Catat crash yang biasanya hilang tanpa jejak (exit -1) supaya bisa didiagnosis.
  process.on('uncaughtException', (e) => console.error('[UNCAUGHT] ' + ((e && (e.stack || e.message)) || e)));
  process.on('unhandledRejection', (e) => console.error('[UNHANDLED] ' + ((e && (e.stack || e.message)) || e)));
  // STICKY PER ATTEMPT (prinsip "1 akun = 1 IP"): bila proxy DataImpulse dipilih,
  // tentukan sid unik untuk percobaan INI dan kunci sesinya ke sid itu — IP yang
  // sama dipinjam sepanjang attempt + tersimpan di result file supaya login ulang
  // akun ini bisa memakai sid yang sama (kamar hotel yang sama selamanya).
  // Pola: browserUtil.stickyProxy(proxyStr, sid) — hanya DataImpulse yang diubah;
  // Bright Data/ip asli diteruskan apa adanya.
  const browserUtil = require('./browser');
  let attemptSid = null;
  if (proxy && /dataimpulse/i.test(proxy) && !proxy.includes('__')) {
    attemptSid = 'fb-' + Date.now();
    proxy = browserUtil.stickyProxy(proxy, attemptSid);
    console.log('[SID] kunci sesi ini: sid.' + attemptSid + ' (IP lahir akan mengikuti kartu ini)');
  }
  console.log('[MULAI] FB create ' + (proxy ? 'via proxy' : 'direct (tanpa proxy)')
    + (phoneSignup ? ' | JALUR NOMOR HP (nomor & SMS via panel)'
      : manualEmail ? ` | EMAIL MANUAL ${manualEmail}`
      : gmailId ? ` | email stok gmail #${gmailId}` : '')
    + (manualGmail && !phoneSignup ? ` | gmail manual ${manualGmail.email.slice(0, 3)}***` : '')
    + (!phoneSignup && !gmailId && !manualGmail && !manualEmail ? ' | temp-mail AMMAIL' : ''));

  let gmailInfo = null;
  if (gmailId) {
    const db = require('./db');
    await db.waitReady();
    const rows = await db.rawAll('SELECT id, email, password_enc, login_status, status, used_by FROM gmail_pool WHERE id = ?', [gmailId]);
    if (!rows || !rows.length) { console.error('[GAGAL] gmail #' + gmailId + ' tidak ditemukan'); process.exit(1); }
    const pw = require('./crypto').decrypt(rows[0].password_enc);
    if (!pw) { console.error('[GAGAL] password gmail #' + gmailId + ' tidak terbaca'); process.exit(1); }
    // Pelajaran run Gmail-Hp (2026-10-10): Gmail cukup login di HP — profil PC
    // ndak wajib. Bila FB minta kode verifikasi, worker minta via marker
    // OTP_REQUIRED → operator mengetik kode dari HP Gmail di kartu panel.
    if (rows[0].login_status !== 'ok') {
      console.log('[GMAIL] status login PC: ' + (rows[0].login_status || 'belum pernah login') + ' — OTP verifikasi nanti diisi operator di kartu panel.');
    }
    if (rows[0].status === 'used') {
      console.error('[GAGAL] gmail #' + gmailId + ' (' + rows[0].email + ') sudah terpakai' + (rows[0].used_by ? ' utk ' + rows[0].used_by : '') + '. Pilih Gmail lain dari dropdown.');
      process.exit(1);
    }
    gmailInfo = { id: gmailId, email: rows[0].email, password: pw, used_by: rows[0].used_by || null };
    console.log('[GMAIL] pakai ' + gmailInfo.email + ' (profil sessions/gmail-' + gmailId + ')');
  } else if (manualGmail) {
    gmailInfo = { id: null, email: manualGmail.email, password: manualGmail.password };
    console.log('[GMAIL] manual ' + manualGmail.email.split('@')[0].slice(0, 3) + '*** — profil yang akan dibaca OTP: sessions/gmail-manual (login manual di browser bila perlu)');
  }

  const creator = new FacebookAccountCreator({
    proxy, headless: false, saveToDatabase: true,
    // JALUR NOMOR HP: tanpa email — nomor & SMS via panel (marker PHONE_REQUIRED).
    phoneSignup,
    // Email pendaftar: stok Gmail / email manual operator / null (temp-mail).
    email: manualEmail || (gmailInfo && !phoneSignup ? gmailInfo.email : null),
    // Email manual BUKAN jalur pembaca OTP tab Gmail — kodenya lewat kartu operator.
    gmailContext: !manualEmail && gmailInfo && !phoneSignup ? { profileDir: require('path').join(__dirname, '..', 'sessions', 'gmail-' + (gmailId || 'manual')) } : null,
  });
  if (keepOpen) {
    creator.cleanup = async () => console.log('[KEEP-OPEN] browser dibiarkan terbuka, selesaikan captcha manual di sana');
  }
  const result = await creator.run();
  console.log('[HASIL] ' + JSON.stringify({ status: result.status, error: result.error || null, email: result.email || null, phone: (result && result.phone) || null, fbChallenge: result.fbChallenge || null }));
  // Bukti teks FB (checkpoint/penolakan) ke account_events bila akun sudah
// terdaftar di panel (accountId diisi saveToDatabase saat sukses); gagal murni
// tetap tanpa accountId — buktinya cukup via signup_history hasil baca runner.
  try { await recordFbFail(result, proxy, result.accountId || null); } catch (e) { /* non-fatal */ }
  // Result file dulu, BARU marker HASIL: — runner menandai selesai saat marker
  // tercetak lalu langsung membaca file (kartu hasil & riwayat IP).
  try {
    const fs = require('fs');
    const path = require('path');
    fs.mkdirSync(path.join(__dirname, '..', 'sessions'), { recursive: true });
    fs.writeFileSync(path.join(__dirname, '..', 'sessions', 'last-create-fb.json'), JSON.stringify({
      platform: 'fb', status: result.status, username: (result.email || (result.phone ? 'fb' + result.phone.slice(-4) : 'fbakun')).slice(0, 24),
      email: result.email || null, phone: (result && result.phone) || null, password: result.password || null, fullName: result.fullName || null,
      gender: result.steps ? (result.steps.find((s) => s.step === 'identity') || {}).message || null : null,
      proxy: proxy || null, birthIp: process.env.FB_BIRTH_IP || null,
      // sid sesi attempt: simpan agar login ulang akun ini meminjam IP lahir yang sama
      attemptSid: attemptSid || null,
      gmailId: gmailInfo ? (gmailInfo.id || 'manual') : null,
      error: result.error || null, steps: result.steps || [],
      fbReason: result.fbReason || null, fbChallenge: result.fbChallenge || null,
      createdAt: new Date().toISOString(),
    }, null, 2));
  } catch (e) { console.log('Gagal tulis result file:', e.message); }
  console.log(`HASIL: ${result.status} | ${result.email || (result && result.phone ? 'hp:' + result.phone : '-')} | ${result.fullName || ''}${result.fbChallenge ? ' | ' + result.fbChallenge : ''}`);
  // Gmail terpakai utk apa — tandai di pool BILA status akhir success (bukan partial/failed).
  // Partial/failed dibiarkan 'available' supaya operator bisa mencoba lagi dgn Gmail yang sama.
  if (result && result.status === 'success' && gmailId && gmailInfo && gmailInfo.id) {
    try {
      require('./db').markGmailUsed(gmailId, 'fb', (result.email || '').split('@')[0]);
      console.log('[GMAIL] pool #: ' + gmailId + ' ditandai used utk fb:' + String(result.email || '').split('@')[0]);
    } catch (e) { console.log('[GMAIL] tandai used gagal: ' + e.message); }
  }
  if (keepOpen) {
    console.log('[MANUAL] selesaikan captcha/nama di browser terbuka, lalu tutup browser');
    await new Promise(() => {});
  }
  process.exit(result && result.status === 'success' ? 0 : 2);
})().catch((e) => { console.error('[FATAL] ' + (e && e.message)); process.exit(1); });
