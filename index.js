'use strict';

require('dotenv').config();

const cron = require('node-cron');
const db = require('./src/db');
const { processDueSchedules } = require('./src/scheduler');

async function runScheduler() {
  try {
    const processed = await processDueSchedules();
    if (processed > 0) console.log(`[scheduler] ${processed} jadwal diproses`);
  } catch (error) {
    console.error('[scheduler] Gagal memproses jadwal:', error.message);
  }
}

db.load().then(() => {
  console.log('[scheduler] Scheduler aktif, interval 1 menit');
  cron.schedule('* * * * *', runScheduler);
  runScheduler();
}).catch(error => {
  console.error('[scheduler] Gagal memuat database:', error.message);
  process.exitCode = 1;
});

module.exports = { runScheduler };
