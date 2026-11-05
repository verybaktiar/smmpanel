/**
 * Standalone Ammail Client — zero external dependencies.
 * 
 * Usage:
 *   import { TempMailClient } from './ammail-client/index.js';
 * 
 *   const client = new TempMailClient({
 *     baseUrl: 'https://your-worker.workers.dev',
 *     apiKey: 'your-api-key',
 *     domain: 'yourdomain.com',
 *   });
 * 
 *   const inbox = await client.createInbox('john123');
 *   console.log(inbox.email); // john123@yourdomain.com
 */

export class TempMailError extends Error {
  constructor(message, status = 0, body = "") {
    super(message);
    this.name = "TempMailError";
    this.status = status;
    this.body = body;
  }
}

export class TempMailClient {
  constructor(opts = {}) {
    let baseUrl = (opts.baseUrl || "").trim().replace(/\/+$/, "");
    if (baseUrl && !/^https?:\/\//i.test(baseUrl)) {
      baseUrl = `https://${baseUrl}`;
    }

    let fallbackUrl = (opts.fallbackUrl || "").trim().replace(/\/+$/, "");
    if (fallbackUrl && !/^https?:\/\//i.test(fallbackUrl)) {
      fallbackUrl = `https://${fallbackUrl}`;
    }

    this.baseUrl = baseUrl;
    this.fallbackUrl = fallbackUrl;
    this.apiKey = (opts.apiKey || "").trim();
    this.defaultDomain = (opts.domain || "").trim().toLowerCase();
    this.timeout = opts.timeout || 20000;
  }

  get configured() {
    return !!this.baseUrl && !!this.apiKey;
  }

  async _request(method, path, body = null) {
    if (!this.configured) {
      throw new TempMailError("ammail_not_configured");
    }

    try {
      return await this._executeRequest(this.baseUrl, method, path, body);
    } catch (e) {
      if (this.fallbackUrl && this.fallbackUrl !== this.baseUrl) {
        try {
          console.warn(`Ammail Client: Primary URL ${this.baseUrl} failed, retrying with fallback:`, e.message);
          return await this._executeRequest(this.fallbackUrl, method, path, body);
        } catch (fallbackErr) {
          throw fallbackErr;
        }
      }
      throw e;
    }
  }

  async _executeRequest(baseUrl, method, path, body = null) {
    const url = `${baseUrl}${path}`;
    const headers = {
      "X-API-Key": this.apiKey,
      "Accept": "application/json",
    };

    if (body !== null) {
      headers["Content-Type"] = "application/json";
    }

    try {
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), this.timeout);

      const res = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : null,
        signal: controller.signal,
      });
      clearTimeout(id);

      const text = await res.text();
      let data = {};
      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        data = { raw: text.substring(0, 1000) };
      }

      if (res.status >= 400) {
        const errMsg = data.error || `http_${res.status}`;
        throw new TempMailError(errMsg, res.status, text.substring(0, 1000));
      }

      return data;
    } catch (e) {
      if (e instanceof TempMailError) throw e;
      throw new TempMailError(`network_error: ${e.message}`);
    }
  }

  // --- API Methods ---

  async health() {
    return this._request("GET", "/api/health");
  }

  async info() {
    return this._request("GET", "/api");
  }

  async createInbox(alias = null, domain = null) {
    const body = {};
    if (alias) body.alias = alias;
    const targetDomain = (domain || this.defaultDomain || "").trim().toLowerCase();
    if (targetDomain) body.domain = targetDomain;
    return this._request("POST", "/api/inboxes", body);
  }

  async listInboxes() {
    const data = await this._request("GET", "/api/inboxes");
    return data.inboxes || [];
  }

  async deleteInbox(alias) {
    const data = await this._request("DELETE", `/api/inboxes/${alias.trim().toLowerCase()}`);
    return !!data.deleted;
  }

  async listMessages(alias) {
    const data = await this._request("GET", `/api/inboxes/${alias.trim().toLowerCase()}/messages`);
    return data.messages || [];
  }

  async getMessage(messageId) {
    const data = await this._request("GET", `/api/messages/${messageId.trim()}`);
    return data.message || {};
  }

  async getWebhook() {
    const data = await this._request("GET", "/api/webhook");
    return data.webhook || null;
  }

  async setWebhook(url, secret = null) {
    const body = { url };
    if (secret !== null) body.secret = secret;
    const data = await this._request("PUT", "/api/webhook", body);
    return data.webhook || {};
  }

  async testWebhook() {
    return this._request("POST", "/api/webhook/test");
  }

  async deleteWebhook() {
    const data = await this._request("DELETE", "/api/webhook");
    return !!data.deleted;
  }
}
