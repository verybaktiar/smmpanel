'use strict';
// Watchdog Phone Farm: probe adb (logika sama yang menentukan 503 /api/farm/devices) tiap 10 menit.
// Episode gagal yang berjalan >1 jam memicu alarm berjudul 'Phone Farm gagal >1 jam' SEKALI,
// episode berhenti saat probe sukses lagi. Ringkasan harian hanya kirinya bila hari itu ada episode kegagalan.

const farm = require('./adb-farm');
const notif = require('./notification-system');

const TITLE = 'Phone Farm gagal >1 jam';
// Ambang 1 jam bisa dikecilkan via env utk test simulasi (FARM_WATCHDOG_HOUR_MS=dalam ms).
const HOUR_MS = Number(process.env.FARM_WATCHDOG_HOUR_MS) > 0 ? Number(process.env.FARM_WATCHDOG_HOUR_MS) : 60 * 60 * 1000;

const state = {
  probing: false,
  firstFailAt: 0,
  fails: 0,
  alarmed: false,
  episodes: [],      // episode per hari: { from, until_ms, fails, alarmed }
  dayKey: '',
  lastProbeAt: 0,
};

async function probe() {
  if (state.probing) return state;
  state.probing = true;
  state.lastProbeAt = Date.now();
  try {
    await farm.listDevices();
    // Episode berakhir: catat hanya kalau pernah gagal (probe sukses tidak menambah log).
    if (state.fails > 0) {
      state.episodes.push({ from: new Date(state.firstFailAt).toISOString(), until_ms: state.lastProbeAt - state.firstFailAt, fails: state.fails, alarmed: state.alarmed });
      state.fails = 0; state.firstFailAt = 0; state.alarmed = false;
    } else {
      state.firstFailAt = 0; state.alarmed = false;
    }
  } catch (e) {
    if (!state.firstFailAt) state.firstFailAt = state.lastProbeAt;
    state.fails++;
    if (!state.alarmed && state.lastProbeAt - state.firstFailAt >= HOUR_MS) {
      state.alarmed = true;
      const mins = Math.round((state.lastProbeAt - state.firstFailAt) / 60000);
      // Kirim tidak di-await: pengiriman kanal boleh lambat, tak boleh menahan probe berikutnya.
      notif.send(
        `Phone Farm gagal berulang ${mins} menit (${state.fails} probe). Penyebab umum: ADB crash/unavailable. Detail: ${String(e.message).slice(0, 140)}`,
        { title: TITLE, priority: 'high', channels: ['email', 'telegram', 'discord'] }
      ).catch(() => {});
    }
  } finally {
    state.probing = false;
  }
  // Pergantian hari: ringkasan episode kemarin (hanya bila ada kegagalan), lalu reset list.
  const today = new Date().toISOString().slice(0, 10);
  if (state.dayKey && state.dayKey !== today && state.episodes.length) {
    const totMin = state.episodes.reduce((a, x) => a + x.until_ms, 0) / 60000;
    notif.send(
      `Ringkasan ${state.dayKey}: ${state.episodes.length} episode Phone Farm gagal, total ~${Math.round(totMin / 10) * 10} menit.`,
      { title: 'Ringkasan Phone Farm', priority: 'low', channels: ['email', 'telegram', 'discord'] }
    ).catch(() => {});
  }
  if (state.dayKey !== today) { state.episodes = []; state.dayKey = today; }
  return state;
}

function start(intervalMs = 10 * 60 * 1000) {
  const t = setInterval(() => { probe().catch(() => {}); }, intervalMs);
  if (t.unref) t.unref(); // jangan menahan window server tetap hidup hanya karena watchdog
  state.dayKey = new Date().toISOString().slice(0, 10);
  probe().catch(() => {});
  return state;
}

function status() {
  return {
    firstFailAt: state.firstFailAt || null,
    fails: state.fails,
    alarmed: state.alarmed,
    episodes: state.episodes,
    lastProbeAt: state.lastProbeAt || null,
  };
}

module.exports = { start, probe, status };
