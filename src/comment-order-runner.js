'use strict';

// Eksekutor order auto komentar (FB & IG). Dipanggil endpoint run dan berjalan
// di latar belakang supaya request HTTP tidak menggantung selama jeda antar
// komentar. Setiap komentar lewat account-gate yang sama dengan aksi manual.

const db = require('./db');
const accountGate = require('./account-gate');
const commentAutomation = require('./comment-automation');
const aiContentGenerator = require('./ai-content-generator');

const running = new Set();

// Teks komentar satu baris: FB/IG merender newline sebagai paragraf dan tanda
// kutip pembungkus dari AI terlihat seperti bot yang menyalin prompt.
function clean(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^["'“”]+|["'“”]+$/g, '')
    .slice(0, 1000);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const gap = () => 45000 + Math.floor(Math.random() * 45000);

async function pickText(order, used, context = '') {
  const base = clean(order.comment_text);
  if (base) return base;
  if (Number(order.ai_context ?? 1) !== 0) {
    try {
      const hint = [
        `Ini komentar ke-${used.length + 1} dari ${order.target_comments}.`,
        'Tulis komentar yang berbeda dari komentar sebelumnya.',
        used.length ? `Jangan ulangi komentar ini: ${used.map((t) => `"${t}"`).join(' | ')}` : '',
      ].filter(Boolean).join('\n');
      const ai = clean(await aiContentGenerator.generateComment(context || order.post_url, hint));
      if (ai && !used.includes(ai)) return ai;
    } catch (e) {
      console.warn(`  [komentar-order] AI gagal untuk order ${order.id}: ${e.message}`);
    }
  }
  const templates = [...commentAutomation.commentTemplates.general, ...commentAutomation.commentTemplates.supportive];
  const fresh = templates.filter((t) => !used.includes(t));
  if (fresh.length) return fresh[Math.floor(Math.random() * fresh.length)];
  return `${templates[used.length % templates.length]} ${['👍', '🔥', '✨'][used.length % 3]}`;
}

// Akun terikat dipakai bila masih sehat. Kalau tidak, cari akun aktif lain yang
// belum dipakai di order ini supaya target tetap tercapai tanpa komentar ganda.
async function pickAccount(order, exec) {
  const bound = await db.getAccountById(exec.account_id);
  if (bound && bound.status === 'active') {
    const g = await accountGate.check(bound.id, 'comment');
    if (g.ok) return bound;
  }

  // Akun yang masih dipegang eksekusi lain tidak boleh direbut: kalau tidak,
  // eksekusi berikutnya kehabisan akun dan satu akun bisa komentar dua kali.
  const boundRows = await db.rawAll(
    `SELECT account_id FROM smm_comment_executions WHERE order_id = ? AND id <> ? AND status IN ('pending', 'running', 'completed')`,
    [order.id, exec.id]
  );
  const used = new Set(boundRows.map((r) => r.account_id));

  const candidates = await db.rawAll(
    `SELECT id FROM accounts WHERE platform = ? AND status = 'active' ORDER BY id`,
    [order.platform]
  );
  for (const c of candidates) {
    if (used.has(c.id) || c.id === exec.account_id) continue;
    const acc = await db.getAccountById(c.id);
    const g = await accountGate.check(c.id, 'comment');
    if (!g.ok) continue;
    await db.assignSmmCommentExecutionAccount(exec.id, c.id);
    exec.account_id = c.id;
    return acc;
  }
  return null;
}

async function runOrder(orderId) {
  if (running.has(orderId)) return;
  running.add(orderId);
  try {
    await db.resetRunningSmmCommentExecutions(orderId);
    for (;;) {
      const order = await db.getSmmCommentOrder(orderId);
      if (!order) break;
      if (order.status === 'cancelled' || order.status === 'paused') break;
      if (Number(order.completed_comments) >= Number(order.target_comments)) break;
      if (order.status !== 'running') await db.setSmmCommentOrderStatus(orderId, 'running');

      const [exec] = await db.getPendingSmmCommentExecutions(orderId, 1);
      if (!exec) {
        // Tidak ada sisa antrean tapi target belum tercapai: tandai gagal agar
        // status tidak tertinggal di 'running' selamanya.
        await db.setSmmCommentOrderStatus(orderId, 'failed');
        break;
      }

      const account = await pickAccount(order, exec);
      if (!account) {
        // Kapasitas akun habis sementara (cooldown/limit). Order berhenti rapi;
        // tombol Jalankan membukanya lagi saat akun sudah longgar.
        await db.setSmmCommentOrderStatus(orderId, 'paused');
        console.log(`  [komentar-order] order ${orderId}: tidak ada akun lolos gate, dijeda`);
        break;
      }

      await db.markSmmCommentExecutionRunning(exec.id);
      const usedRows = await db.rawAll(
        `SELECT comment_text FROM smm_comment_executions WHERE order_id = ? AND comment_text IS NOT NULL AND comment_text <> ''`,
        [orderId]
      );
      const used = usedRows.map((r) => r.comment_text);
      const manual = clean(order.comment_text);
      const useAi = !manual && Number(order.ai_context ?? 1) !== 0;
      // Sumber berupa fungsi: teks baru dibuat setelah browser membaca kiriman,
      // jadi AI memakai konteks halaman yang sama dengan yang akan dikomentari.
      const source = useAi ? (context) => pickText(order, used, context) : await pickText(order, used, '');

      let result;
      try {
        result = order.platform === 'ig'
          ? await commentAutomation.commentOnInstagramPost(account, order.post_url, source)
          : await commentAutomation.commentOnFacebookPost(account, order.post_url, source);
      } catch (e) {
        result = { ok: false, reason: 'error: ' + e.message };
      }

      const text = clean(result.comment || (typeof source === 'string' ? source : ''));
      if (result.ok) accountGate.record(account.id, 'comment');
      await db.updateSmmCommentExecution(exec.id, result.ok ? 'completed' : 'failed', result.reason || null, text || null);
      await db.logEngagement({
        accountId: account.id,
        action: 'comment',
        targetUrl: order.post_url,
        commentText: text || null,
        status: result.ok ? 'success' : 'failed',
        message: result.reason || null,
        batchId: `cmt-order-${orderId}`,
      }).catch(() => {});

      console.log(`  [komentar-order] ${orderId} ${account.name}: ${result.ok ? 'terkirim' : (result.reason || 'gagal')}`);

      // Login/checkpoint = masalah akun, bukan masalah postingan target.
      if (!result.ok && /login|checkpoint|blocked|banned|suspended/i.test(result.reason || '')) {
        await db.setAccountStatus(account.id, 'failed');
      }

      const next = await db.getSmmCommentOrder(orderId);
      if (!next || next.status === 'cancelled' || next.status === 'paused') break;
      if (Number(next.completed_comments) >= Number(next.target_comments)) break;
      await sleep(gap());
    }
  } catch (e) {
    console.error(`  [komentar-order] order ${orderId} berhenti:`, e.message);
  } finally {
    running.delete(orderId);
  }
}

function start(orderId) {
  if (running.has(orderId)) return false;
  runOrder(orderId);
  return true;
}

module.exports = { start, isRunning: (orderId) => running.has(orderId), clean };
