'use strict';
/* Dry-run FB: jalankan creator per-langkah (inbox → browser → signup → isi form)
 * lalu BERHENTI SEBELUM submit — OTP tidak diminta, akun tidak dibuat, DB tidak ditulis.
 * Run: node test-fb-dryrun.js "host:port:user:pass"
 */
require('dotenv').config();
const FacebookAccountCreator = require('./src/fb-account-creator');

(async () => {
  const proxy = process.argv.slice(2).find((a) => !a.startsWith('--')) || null;
  console.log('[MULAI] FB dry-run ' + (proxy ? 'via proxy ' + proxy.split(':').slice(0, 2).join(':') : 'direct'));
  const creator = new FacebookAccountCreator({ proxy, headless: false, saveToDatabase: false });

  try {
    await creator.createTempEmail();
    await creator.launchBrowser();
    await creator.navigateToSignup();
    await creator.fillSignupForm();
    console.log('\n*** DRY-RUN: form TERISI penuh (nama, email, sandi, ultah, gender) — TIDAK di-submit ***');
    try { await creator.page.screenshot({ path: 'fb-dryrun.png', fullPage: true }); } catch (e) { /* abaikan */ }
    creator.addStep('dry_run', true, 'form terisi — berhenti SEBELUM submit (bukti: fb-dryrun.png)');
    creator.result.status = 'dry-run';
    console.log('\nHASIL: dry-run |', creator.result.email, '| form FB terisi, tidak disubmit');
  } catch (e) {
    creator.result.status = 'failed';
    creator.result.error = e.message;
    creator.addStep('error', false, e.message);
    console.log('\nHASIL: failed |', e.message);
  } finally {
    console.log('\nRingkasan:', JSON.stringify(creator.result.steps, null, 1));
    await creator.cleanup();
  }
  process.exit(creator.result.status === 'dry-run' ? 0 : 2);
})().catch((e) => { console.error('[FATAL] ' + (e && e.message)); process.exit(1); });
