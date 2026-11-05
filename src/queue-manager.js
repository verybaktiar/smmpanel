'use strict';

const db = require('./db');
const { likePosting, likeIgPosting, withDecryptedPassword } = require('./actions');
const { randomDelay, waitForRateLimit } = require('./rate-limiter');
const gate = require('./account-gate');

const processingOrders = new Map();
const queueStats = {
  processed: 0,
  failed: 0,
  skipped: 0,
  startTime: Date.now(),
};

function cleanupCompletedOrders() {
  for (const [orderId, data] of processingOrders.entries()) {
    if (data.status === 'completed' || data.status === 'failed' || data.status === 'cancelled') {
      processingOrders.delete(orderId);
    }
  }
}

setInterval(cleanupCompletedOrders, 300000);

/**
 * Process single like execution dengan ROTASI RUNTIME:
 * akun dipilih SAAT eksekusi (bukan diikat saat order dibuat) via
 * account-rotation + account-gate, dengan excludeIds agar:
 *  - akun yang sudah like di order ini tidak dipakai lagi
 *  - akun yang baru gagal tidak langsung dipakai lagi
 * Jika eksekusi lama terikat akun yang kini tak layak, account_id di-update
 * ke akun sehat yang terpilih (re-assign otomatis).
 *
 * @param {object} execution - SMM execution record
 * @param {string} platform - 'fb' or 'ig'
 * @param {number[]} excludeIds - akun yang tidak boleh dipakai
 * @returns {object} Result { success, error, skipped, noAccount }
 */
async function processLikeExecution(execution, platform = 'fb', excludeIds = []) {
  // 1) Pilih akun sehat SAAT EKSEKUSI (inti rotasi runtime)
  const account = await pickAccountForExecution(platform, excludeIds);
  if (!account) {
    console.log(`  [queue] Execution ${execution.id}: tidak ada akun tersedia (cooldown/limit/gate), ditunda`);
    return { success: false, skipped: true, noAccount: true, error: 'no_account_available' };
  }

  // 2) Re-assign execution ke akun terpilih bila berbeda dari ikatan lama
  if (execution.account_id !== account.id) {
    await db.rawAll(`UPDATE smm_like_executions SET account_id = ? WHERE id = ?`, [account.id, execution.id]);
    console.log(`  [queue] Execution ${execution.id} re-assigned: akun ${execution.account_name || execution.account_id} -> ${account.name}`);
    execution.account_id = account.id;
    execution.account_name = account.name;
  }

  const accountId = account.id;
  try {
    // 3) Gate tunggal: status + warming + cooldown + limit + rate
    const g = await gate.check(accountId, 'like');
    if (!g.ok) {
      console.log(`  [queue] Account ${account.name} ditolak gate (${g.reasons.join(',')}), cari akun lain`);
      excludeIds.push(accountId);
      return { success: false, skipped: true, error: `gate:${g.reasons.join(',')}` };
    }

    // 4) Jeda antar aksi bila akun ini baru saja bereaksi
    await waitForRateLimit(accountId, 30);

    console.log(`  [queue] Processing execution ${execution.id} with account ${account.name} (${platform})`);

    const accountWithPassword = withDecryptedPassword(account);

    let result;
    if (platform === 'ig') {
      result = await likeIgPosting(accountWithPassword, execution.target_url);
    } else {
      result = await likePosting(accountWithPassword, execution.target_url);
    }

    if (result.ok) {
      gate.record(accountId, 'like');
      await db.updateSmmExecutionStatus(execution.id, 'completed', result.already ? 'already_liked' : 'liked');
      console.log(`  [queue] ✓ Execution ${execution.id} completed successfully`);
      queueStats.processed++;
      return { success: true };
    }

    // 5) Gagal: catat + reaksi berbeda per jenis kegagalan
    const reason = result.reason || 'unknown_error';
    await db.updateSmmExecutionStatus(execution.id, 'failed', reason);
    console.log(`  [queue] ✗ Execution ${execution.id} failed: ${reason}`);
    queueStats.failed++;

    // Login gagal / checkpoint = akun masalah -> tandai supaya rotasi melewatinya
    if (/login|checkpoint|blocked|banned|suspended/i.test(reason)) {
      await db.setAccountStatus(accountId, 'failed');
      console.log(`  [queue] Account ${account.name} ditandai 'failed' (sebab: ${reason.slice(0, 60)})`);
    }
    excludeIds.push(accountId);
    return { success: false, error: reason };
  } catch (error) {
    console.error(`  [queue] Error processing execution ${execution.id}:`, error.message);
    await db.updateSmmExecutionStatus(execution.id, 'failed', `error: ${error.message}`);
    queueStats.failed++;
    excludeIds.push(accountId);
    return { success: false, error: error.message };
  }
}

/**
 * Pilih akun terbaik yang tersedia untuk eksekusi:
 * rotasi (paling sedikit terpakai) + gate tunggal.
 */
async function pickAccountForExecution(platform, excludeIds = []) {
  const account = await gate.rotationNext('like', platform, excludeIds);
  if (!account) return null;
  const rows = await db.getAccountById(account.id);
  return rows || account;
}

/**
 * Process single SMM order dengan batch processing, delays, dan rotasi runtime.
 * @param {number} orderId - Order ID
 * @param {number} batchSize - How many executions to process per batch (default: 2)
 * @returns {object} Processing result
 */
async function processSmmOrder(orderId, batchSize = 2) {
  // Check jika order sudah sedang diproses
  if (processingOrders.has(orderId)) {
    console.log(`  [queue] Order ${orderId} is already being processed`);
    return { processing: true };
  }

  processingOrders.set(orderId, { started: Date.now() });

  try {
    // Get order details
    const order = await db.getSmmLikeOrder(orderId);
    if (!order) {
      throw new Error(`Order ${orderId} not found`);
    }

    // Check order status (paused/cancelled tidak diproses)
    if (order.status !== 'running') {
      console.log(`  [queue] Order ${orderId} is not in running state (${order.status})`);
      processingOrders.delete(orderId);
      return { skipped: true, reason: 'not_running' };
    }

    console.log(`  [queue] Starting to process order ${orderId} (${order.quantity || order.target_likes} likes)`);

    // Get pending executions (limit ke batch size)
    const executions = await db.getPendingSmmExecutions(orderId, batchSize);

    if (executions.length === 0) {
      // Cek kelulusan order berdasar jumlah sukses vs target
      const allExecutions = await db.rawAll(`
        SELECT status, COUNT(*) as count
        FROM smm_like_executions
        WHERE order_id = ?
        GROUP BY status
      `, [orderId]);

      const successCount = allExecutions.find(e => e.status === 'completed')?.count || 0;
      const totalExecutions = allExecutions.reduce((sum, e) => sum + e.count, 0);

      if (successCount >= order.target_likes || totalExecutions >= order.target_likes) {
        await db.rawAll(`UPDATE smm_like_orders SET status = 'completed', completed_at = datetime('now') WHERE id = ?`, [orderId]);
        console.log(`  [queue] Order ${orderId} selesai: ${successCount}/${order.target_likes} sukses`);
      }

      processingOrders.delete(orderId);
      return { completed: true, processed: 0 };
    }

    console.log(`  [queue] Processing ${executions.length} executions for order ${orderId}`);

    // Rotasi runtime: akun yang sudah dipakai di order ini tidak boleh dipakai lagi
    const usedRows = await db.rawAll(`
      SELECT DISTINCT account_id FROM smm_like_executions
      WHERE order_id = ? AND status IN ('completed', 'working')
    `, [orderId]);
    const excludeIds = usedRows.map((r) => r.account_id);

    // Process each execution dengan delay antar executions
    let processed = 0;
    let failed = 0;
    let skipped = 0;

    for (let i = 0; i < executions.length; i++) {
      const exec = executions[i];

      const result = await processLikeExecution(exec, order.platform, excludeIds);

      if (result.success) {
        processed++;
      } else if (result.noAccount) {
        // Tidak ada akun tersedia: hentikan batch, coba lagi di tick worker berikutnya
        skipped += executions.length - i;
        console.log(`  [queue] Order ${orderId} ditunda: kapasitas akun habis sementara`);
        break;
      } else if (result.skipped) {
        skipped++;
      } else {
        failed++;
      }

      // Add random delay antara executions (kecuali execution terakhir)
      if (i < executions.length - 1) {
        await randomDelay(30, 90); // 30-90 detik delay
      }
    }

    console.log(`  [queue] Order ${orderId} batch completed: ${processed} success, ${failed} failed, ${skipped} skipped`);

    processingOrders.delete(orderId);
    return { processed, failed, skipped };

  } catch (error) {
    console.error(`  [queue] Error processing order ${orderId}:`, error.message);
    processingOrders.delete(orderId);
    throw error;
  }
}

/**
 * Process all running orders (dipanggil oleh cron job)
 * @returns {object} Processing summary
 */
async function processAllRunningOrders() {
  try {
    const runningOrders = await db.listSmmLikeOrders('running');

    if (runningOrders.length === 0) {
      return { processed: 0, message: 'No running orders' };
    }

    console.log(`  [queue] Found ${runningOrders.length} running orders`);

    let totalProcessed = 0;
    let totalFailed = 0;
    let totalSkipped = 0;

    // Process orders sequentially (bukan parallel untuk avoid overwhelming system)
    for (const order of runningOrders) {
      try {
        const result = await processSmmOrder(order.id, 2); // Batch size 2

        if (result.processed !== undefined) {
          totalProcessed += result.processed;
          totalFailed += (result.failed || 0);
          totalSkipped += (result.skipped || 0);
        }
      } catch (error) {
        console.error(`  [queue] Error processing order ${order.id}:`, error.message);
      }
    }

    return {
      ordersProcessed: runningOrders.length,
      executionsProcessed: totalProcessed,
      executionsFailed: totalFailed,
      executionsSkipped: totalSkipped,
    };

  } catch (error) {
    console.error(`  [queue] Error in processAllRunningOrders:`, error.message);
    throw error;
  }
}

/**
 * Get queue statistics
 * @returns {object} Queue stats
 */
function getQueueStats() {
  const uptime = Date.now() - queueStats.startTime;
  return {
    ...queueStats,
    uptime: Math.floor(uptime / 1000),
    activeOrders: processingOrders.size,
  };
}

/**
 * Reset queue statistics
 */
function resetQueueStats() {
  queueStats.processed = 0;
  queueStats.failed = 0;
  queueStats.skipped = 0;
  queueStats.startTime = Date.now();
}

module.exports = {
  processSmmOrder,
  processAllRunningOrders,
  processLikeExecution,
  getQueueStats,
  resetQueueStats,
};
