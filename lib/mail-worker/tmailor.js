'use strict';
// Provider temp-mail tmailor.com (Open API resmi). Kontrak sama dengan
// MailWorkerClient supaya penukaran provider di creator cukup ganti import:
//   createInbox() -> { email, id }, listMessages(alias), getMessage(id),
//   waitForOtp(alias, timeoutMin).
// Khusus tmailor: API key WAJIB, dan plan Free hanya menerima panggilan dari
// IP yang di-allowlist di platform.tmailor.com. SDK resmi dipakai apa adanya
// (fetch bawaan Node, tanpa dependensi tambahan).
const { extractOtp } = require('./otp');

// tmailor meng-allowlist alamat IPv4. Di host dual-stack, fetch Node memilih
// IPv6 lebih dulu dan panggilan ditolak IpNotAllowed walau IPv4 mesin sudah
// terdaftar (terbukti di mesin ini: tanpa ini gagal, dengan ini lolos).
try { require('dns').setDefaultResultOrder('ipv4first'); } catch (e) { /* Node lama: biarkan */ }

const TMAILOR_KEY = () =>
  String(process.env.TMAILOR_API_KEY || '').trim();

class TmailorClient {
  constructor(opts) {
    opts = opts || {};
    this.apiKey = String(opts.apiKey || TMAILOR_KEY()).trim();
    this.timeoutMs = Number(opts.timeoutMs || process.env.TMAILOR_TIMEOUT || 20000);
    // email -> { box, createdAt }
    this._boxes = new Map();
  }

  get configured() { return !!this.apiKey; }

  _client() {
    if (!this.apiKey) throw new Error('tmailor_api_key_missing (set TMAILOR_API_KEY)');
    if (!this._sdk) {
      const { Client } = require('tmailor');
      this._sdk = new Client({ apiKey: this.apiKey, timeout: this.timeoutMs });
    }
    return this._sdk;
  }

  async createInbox(alias, domain) {
    const client = this._client();
    // Plan Free tmailor kadang menolak dengan IpNotAllowed walau IP sama
    // (allowlist belum konsisten di sisi mereka). Retry sekali-dua kali dulu
    // sebelum menyerah — run TikTok tidak perlu ikut mati karena ini.
    let lastErr = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const box = await client.mailboxes.create();
        this._boxes.set(box.email, { box, createdAt: box.createdAt });
        return { email: box.email, id: box.email, token: box.token, reuseUrl: box.web && box.web.reuse_url };
      } catch (e) {
        lastErr = e;
        if (!/IpNotAllowed/i.test(String(e.code || e.message))) throw e;
        if (attempt < 2) await new Promise((r) => setTimeout(r, 8000 * (attempt + 1)));
      }
    }
    throw new Error('tmailor menolak IP pemanggil (IpNotAllowed). Plan Free hanya menerima IP yang di-allowlist di platform.tmailor.com — pastikan IP publik mesin ini terdaftar, atau upgrade ke plan Starter. Detail: ' + (lastErr && lastErr.message));
  }

  async listMessages(email) {
    const ctx = this._boxes.get(email);
    if (!ctx) return [];
    const page = await ctx.box.messagesPage({ pageSize: 20 });
    return (page.items || []).map((m) => ({
      id: m.id,
      subject: m.subject,
      from: m.from && (m.from.address || m.from),
      receivedAt: m.receivedAt,
    }));
  }

  async getMessage(id) {
    for (const { box } of this._boxes.values()) {
      try {
        const msg = await box.message(id);
        return {
          id: msg.id,
          subject: msg.subject || '',
          text: msg.text || '',
          html: msg.html || '',
          otp: msg.otp || '',
          codes: msg.codes || [],
        };
      } catch (e) { /* bukan milik box ini — lanjut */ }
    }
    return {};
  }

  async waitForOtp(email, timeoutMin, intervalMs) {
    const ctx = this._boxes.get(email);
    if (!ctx) return null;
    const tMin = timeoutMin || 5;
    try {
      const msg = await ctx.box.waitForMessage({
        timeout: tMin * 60000,
        since: (ctx.createdAt || 0) - 1,
        pollInterval: intervalMs || 5000,
      });
      const f = extractOtp(msg.text || msg.body || '', msg.html || '', msg.subject || '');
      return { code: f.code || msg.otp || (msg.codes || [])[0] || '', verifyUrl: f.verifyUrl, message: msg };
    } catch (e) {
      if (e && /WaitTimeout/i.test(e.name || '')) return null;
      throw e;
    }
  }
}

module.exports = { TmailorClient };
