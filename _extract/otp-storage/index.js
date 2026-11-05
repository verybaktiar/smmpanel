/**
 * Standalone OTP Storage — SQLite via better-sqlite3.
 * 
 * Usage:
 *   import { OtpStore } from './otp-storage/index.js';
 * 
 *   const store = new OtpStore('./data/otp.db');
 *   await store.init();
 * 
 *   await store.insert({ address: 'user@domain.com', otpCode: '123456', ... });
 *   const otp = await store.findLatest('user@domain.com');
 *   await store.markUsed(otp.id);
 */

import Database from 'better-sqlite3';

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS otps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  address TEXT NOT NULL,
  alias TEXT,
  domain TEXT,
  sender TEXT,
  subject TEXT,
  otpCode TEXT,
  verifyUrl TEXT,
  bodyText TEXT,
  bodyHtml TEXT,
  messageShortId TEXT,
  receivedAt INTEGER NOT NULL,
  usedAt INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_otps_address_received ON otps(address, receivedAt DESC);
CREATE INDEX IF NOT EXISTS idx_otps_used ON otps(usedAt, receivedAt DESC);
`;

export class OtpStore {
  constructor(dbPath = "./otp.db") {
    this.dbPath = dbPath;
    this.db = null;
  }

  async init() {
    this.db = new Database(this.dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = NORMAL");
    this.db.exec(SCHEMA_SQL);
    return this;
  }

  insert(data) {
    const stmt = this.db.prepare(`
      INSERT INTO otps (address, alias, domain, sender, subject, otpCode, verifyUrl, bodyText, bodyHtml, messageShortId, receivedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const receivedAt = data.receivedAt || Math.floor(Date.now() / 1000);
    const result = stmt.run(
      data.address || "",
      data.alias || "",
      data.domain || "",
      data.sender || "",
      data.subject || "",
      data.otpCode || "",
      data.verifyUrl || "",
      data.bodyText || "",
      data.bodyHtml || "",
      data.messageShortId || "",
      receivedAt
    );

    return { id: result.lastInsertRowid, ...data, receivedAt };
  }

  findLatest(address, opts = {}) {
    const { sinceTs = 0, onlyUnused = true } = opts;

    let sql = "SELECT * FROM otps WHERE address = ? AND receivedAt >= ?";
    const params = [address.toLowerCase(), sinceTs];

    if (onlyUnused) {
      sql += " AND usedAt = 0";
    }

    sql += " ORDER BY receivedAt DESC LIMIT 1";
    return this.db.prepare(sql).get(...params);
  }

  markUsed(id) {
    const nowUnix = Math.floor(Date.now() / 1000);
    this.db.prepare("UPDATE otps SET usedAt = ? WHERE id = ?").run(nowUnix, id);
  }

  list(filter = {}) {
    const where = [];
    const params = [];

    if (filter.address) {
      where.push("LOWER(address) = ?");
      params.push(filter.address.toLowerCase());
    }

    if (filter.folder === "unread") {
      where.push("usedAt = 0");
    } else if (filter.folder === "read") {
      where.push("usedAt > 0");
    } else if (filter.folder === "otp") {
      where.push("otpCode IS NOT NULL AND otpCode != ''");
    }

    const sql = `SELECT * FROM otps ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY receivedAt DESC`;
    return this.db.prepare(sql).all(...params);
  }

  get(id) {
    return this.db.prepare("SELECT * FROM otps WHERE id = ?").get(id);
  }

  delete(id) {
    this.db.prepare("DELETE FROM otps WHERE id = ?").run(id);
  }

  deleteBulk(filter = {}) {
    const where = [];
    const params = [];

    if (filter.address) {
      where.push("LOWER(address) = ?");
      params.push(filter.address.toLowerCase());
    }
    if (filter.alias) {
      where.push("LOWER(alias) = ?");
      params.push(filter.alias.toLowerCase());
    }
    if (filter.folder === "unread") {
      where.push("usedAt = 0");
    } else if (filter.folder === "read") {
      where.push("usedAt > 0");
    }

    const sql = `DELETE FROM otps ${where.length ? `WHERE ${where.join(" AND ")}` : ""}`;
    this.db.prepare(sql).run(...params);
  }

  close() {
    if (this.db) this.db.close();
  }
}
