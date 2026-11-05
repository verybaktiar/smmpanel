CREATE TABLE IF NOT EXISTS inboxes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  alias TEXT NOT NULL,
  domain TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  expires_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_inboxes_alias_domain ON inboxes(alias, domain);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  inbox_alias TEXT NOT NULL,
  inbox_domain TEXT NOT NULL,
  sender TEXT,
  recipient TEXT,
  subject TEXT,
  text_body TEXT,
  html_body TEXT,
  raw_size INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_messages_inbox ON messages(inbox_alias, inbox_domain);

CREATE TABLE IF NOT EXISTS chats (
  chat_id TEXT PRIMARY KEY,
  username TEXT,
  first_name TEXT,
  last_name TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS api_access (
  user_id TEXT PRIMARY KEY,
  api_key TEXT NOT NULL,
  quota_daily INTEGER DEFAULT 0,
  quota_used INTEGER DEFAULT 0,
  quota_date TEXT,
  granted_by TEXT,
  granted_at TEXT DEFAULT (datetime('now')),
  expires_at TEXT
);

CREATE TABLE IF NOT EXISTS webhook_config (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  url TEXT,
  secret TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
);
