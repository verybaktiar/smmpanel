'use strict';

const db = require('./db');
const actions = require('./actions');

// Hitung waktu berikutnya untuk jadwal berulang berdasarkan scheduled_at terakhir.
function nextRepeat(fromDate, repeat) {
  const next = new Date(fromDate);
  if (repeat === 'daily') next.setDate(next.getDate() + 1);
  else if (repeat === 'weekly') next.setDate(next.getDate() + 7);
  else if (repeat === 'monthly') next.setMonth(next.getMonth() + 1);
  else return null;
  return next.toISOString();
}

async function processDueSchedules() {
  const due = await db.getDueSchedules(new Date().toISOString());
  if (!due.length) return 0;
  console.log(`[scheduler] ${due.length} jadwal siap diproses.`);

  let processed = 0;
  for (const s of due) {
    const claimed = await db.claimSchedule(s.id);
    if (!claimed) continue;
    const account = await db.getAccountById(s.account_id);
    if (!account) {
      await db.setScheduleStatus(s.id, 'failed');
      continue;
    }
    console.log(`  → Posting utk akun "${s.account_name}": "${(s.content_text || '').slice(0, 40)}..."`);
    try {
      const result = await actions.postToTimeline(account, s.content_text, s.media_path);
      // Jika jadwal berulang & sukses, jadwalkan ke occurrence berikutnya.
      if (result.ok && s.repeat && s.repeat !== 'none') {
        const next = nextRepeat(new Date(s.scheduled_at), s.repeat);
        if (next) {
          await db.reschedule(s.id, next);
          console.log(`    ↻ Jadwal diulang ke: ${next}`);
        } else {
          await db.setScheduleStatus(s.id, 'done');
        }
      } else {
        await db.setScheduleStatus(s.id, result.ok ? 'done' : 'failed');
      }
      await db.logPost({ accountId: account.id, contentId: s.content_id, scheduleId: s.id, status: result.ok ? 'posted' : 'post_failed', message: result.reason, contentText: s.content_text });
      console.log(`    ✓ ${result.ok ? 'Berhasil dipost' : 'Gagal (tidak login?): ' + result.reason}`);
      processed++;
    } catch (err) {
      await db.setScheduleStatus(s.id, 'failed');
      await db.logPost({ accountId: account.id, contentId: s.content_id, scheduleId: s.id, status: 'error', message: err.message, contentText: s.content_text });
      console.error(`    ✗ Error: ${err.message}`);
    }
  }
  return processed;
}

module.exports = { processDueSchedules };
