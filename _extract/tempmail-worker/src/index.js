export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, X-API-Key, Authorization",
    };

    if (method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      if (path === "/api/health") {
        return json({ status: "ok" }, 200, corsHeaders);
      }

      if (path === "/api" && method === "GET") {
        const domains = (env.MAIL_DOMAINS || env.MAIL_DOMAIN || "").split(",").map(d => d.trim()).filter(Boolean);
        return json({ domains, base_url: env.PUBLIC_BASE_URL || "" }, 200, corsHeaders);
      }

      if (path.startsWith("/api/")) {
        const apiKey = request.headers.get("X-API-Key");
        if (!apiKey || !(await validateApiKey(env.DB, apiKey))) {
          return json({ error: "Unauthorized" }, 401, corsHeaders);
        }
      }

      if (path === "/api/inboxes" && method === "GET") {
        const inboxes = await env.DB.prepare("SELECT alias, domain, created_at, expires_at FROM inboxes ORDER BY created_at DESC").all();
        const result = (inboxes.results || []).map(r => ({ ...r, address: `${r.alias}@${r.domain}` }));
        return json({ inboxes: result }, 200, corsHeaders);
      }

      if (path === "/api/inboxes" && method === "POST") {
        const body = await request.json();
        const alias = (body.alias || generateAlias()).toLowerCase();
        const domain = (body.domain || env.MAIL_DOMAIN || "").toLowerCase();
        if (!domain) return json({ error: "No domain configured" }, 400, corsHeaders);

        const ttlHours = parseInt(env.INBOX_TTL_HOURS || "24", 10);
        const expiresAt = new Date(Date.now() + ttlHours * 3600000).toISOString();

        try {
          await env.DB.prepare(
            "INSERT INTO inboxes (alias, domain, expires_at) VALUES (?, ?, ?)"
          ).bind(alias, domain, expiresAt).run();
        } catch (e) {
          if (e.message?.includes("UNIQUE")) {
            return json({ error: "Inbox already exists" }, 409, corsHeaders);
          }
          throw e;
        }

        return json({ inbox: { alias, domain, address: `${alias}@${domain}`, email: `${alias}@${domain}`, expires_at: expiresAt } }, 201, corsHeaders);
      }

      const inboxMatch = path.match(/^\/api\/inboxes\/([^/]+)$/);
      if (inboxMatch && method === "DELETE") {
        const alias = decodeURIComponent(inboxMatch[1]).toLowerCase();
        await env.DB.prepare("DELETE FROM messages WHERE inbox_alias = ?").bind(alias).run();
        const r = await env.DB.prepare("DELETE FROM inboxes WHERE alias = ?").bind(alias).run();
        return json({ deleted: (r.meta?.changes || 0) > 0 }, 200, corsHeaders);
      }

      const msgListMatch = path.match(/^\/api\/inboxes\/([^/]+)\/messages$/);
      if (msgListMatch && method === "GET") {
        const alias = decodeURIComponent(msgListMatch[1]).toLowerCase();
        const rows = await env.DB.prepare(
          "SELECT id, sender, recipient, subject, created_at FROM messages WHERE inbox_alias = ? ORDER BY created_at DESC"
        ).bind(alias).all();
        const messages = (rows.results || []).map(r => ({ ...r, id: String(r.id) }));
        return json({ messages }, 200, corsHeaders);
      }

      const msgGetMatch = path.match(/^\/api\/messages\/(\d+)$/);
      if (msgGetMatch && method === "GET") {
        const id = parseInt(msgGetMatch[1], 10);
        const msg = await env.DB.prepare(
          "SELECT * FROM messages WHERE id = ?"
        ).bind(id).first();
        if (!msg) return json({ error: "Not found" }, 404, corsHeaders);
        const enriched = {
          ...msg,
          body: msg.text_body || "",
          text: msg.text_body || "",
          html: msg.html_body || "",
          from_address: msg.sender || "",
          from_name: msg.sender || "",
        };
        return json({ message: enriched }, 200, corsHeaders);
      }

      if (path === "/api/webhook" && method === "GET") {
        const wh = await env.DB.prepare("SELECT url, secret, updated_at FROM webhook_config WHERE id = 1").first();
        return json({ webhook: wh || null }, 200, corsHeaders);
      }

      if (path === "/api/webhook" && method === "PUT") {
        const body = await request.json();
        const secret = body.secret || crypto.randomUUID();
        await env.DB.prepare(
          "INSERT OR REPLACE INTO webhook_config (id, url, secret, updated_at) VALUES (1, ?, ?, datetime('now'))"
        ).bind(body.url, secret).run();
        return json({ webhook: { url: body.url, secret } }, 200, corsHeaders);
      }

      if (path === "/api/webhook" && method === "DELETE") {
        await env.DB.prepare("DELETE FROM webhook_config WHERE id = 1").run();
        return json({ deleted: true }, 200, corsHeaders);
      }

      if (path === "/api/webhook/test" && method === "POST") {
        const wh = await env.DB.prepare("SELECT url, secret FROM webhook_config WHERE id = 1").first();
        if (!wh?.url) return json({ error: "No webhook configured" }, 400, corsHeaders);
        try {
          const resp = await fetch(wh.url, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Webhook-Secret": wh.secret || "",
            },
            body: JSON.stringify({ event: "webhook.test", timestamp: new Date().toISOString() }),
          });
          return json({ ok: resp.ok, status: resp.status }, 200, corsHeaders);
        } catch (e) {
          return json({ error: e.message }, 502, corsHeaders);
        }
      }

      if (path === "/telegram/webhook" && method === "POST") {
        return handleTelegramWebhook(request, env, corsHeaders);
      }

      return json({ error: "Not found" }, 404, corsHeaders);
    } catch (e) {
      return json({ error: e.message }, 500, corsHeaders);
    }
  },

  async email(message, env) {
    const to = message.to;
    const from = message.from;
    const rawBody = await new Response(message.raw).text();

    const aliasMatch = to.match(/^([^@]+)@/);
    const domainMatch = to.match(/@(.+)$/);
    if (!aliasMatch || !domainMatch) return;

    const alias = aliasMatch[1].toLowerCase();
    const domain = domainMatch[1].toLowerCase();

    const inbox = await env.DB.prepare(
      "SELECT alias FROM inboxes WHERE alias = ? AND domain = ?"
    ).bind(alias, domain).first();

    if (!inbox) {
      const catchAllDomains = (env.MAIL_DOMAINS || env.MAIL_DOMAIN || "").split(",").map(d => d.trim().toLowerCase());
      if (!catchAllDomains.includes(domain)) return;

      const ttlHours = parseInt(env.INBOX_TTL_HOURS || "24", 10);
      const expiresAt = new Date(Date.now() + ttlHours * 3600000).toISOString();
      try {
        await env.DB.prepare(
          "INSERT OR IGNORE INTO inboxes (alias, domain, expires_at) VALUES (?, ?, ?)"
        ).bind(alias, domain, expiresAt).run();
      } catch {}
    }

    const subject = message.headers.get("subject") || "";
    let textBody = "";
    let htmlBody = "";

    try {
      const headerEnd = rawBody.indexOf("\r\n\r\n");
      const rawHeaders = headerEnd > 0 ? rawBody.substring(0, headerEnd) : "";
      const bodySection = headerEnd > 0 ? rawBody.substring(headerEnd + 4) : rawBody;

      const bMatch = rawHeaders.match(/boundary="?([^";\r\n]+)"?/i);
      if (bMatch) {
        const bnd = bMatch[1];
        const mimeParts = bodySection.split("--" + bnd);
        for (const mp of mimeParts) {
          if (!mp.trim() || mp.trim() === "--") continue;
          const mpHeaderEnd = mp.indexOf("\r\n\r\n");
          if (mpHeaderEnd < 0) continue;
          const mpHeaders = mp.substring(0, mpHeaderEnd).toLowerCase();
          let mpBody = mp.substring(mpHeaderEnd + 4).replace(/\r?\n--[\s\S]*$/, "").trim();
          
          const enc = (mpHeaders.match(/content-transfer-encoding:\s*(\S+)/i) || [])[1] || "";
          if (/quoted-printable/i.test(enc)) {
            mpBody = mpBody.replace(/=\r?\n/g, "").replace(/=([0-9A-F]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
          } else if (/base64/i.test(enc)) {
            try { mpBody = atob(mpBody.replace(/\s/g, "")); } catch {}
          }

          if (mpHeaders.includes("text/html")) {
            htmlBody = mpBody;
          } else if (mpHeaders.includes("text/plain")) {
            textBody = mpBody;
          }
        }
      }

      if (!textBody && !htmlBody) {
        textBody = bodySection.substring(0, 10000);
      }
    } catch (e) {
      textBody = rawBody.substring(0, 10000);
    }

    const maxChars = parseInt(env.MAX_BODY_CHARS || "100000", 10);
    if (textBody.length > maxChars) textBody = textBody.substring(0, maxChars);
    if (htmlBody.length > maxChars) htmlBody = htmlBody.substring(0, maxChars);

    await env.DB.prepare(
      "INSERT INTO messages (inbox_alias, inbox_domain, sender, recipient, subject, text_body, html_body, raw_size) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).bind(alias, domain, from, to, subject, textBody, htmlBody, rawBody.length).run();

    const wh = await env.DB.prepare("SELECT url, secret FROM webhook_config WHERE id = 1").first();
    if (wh?.url) {
      try {
        await fetch(wh.url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Webhook-Secret": wh.secret || "",
          },
          body: JSON.stringify({
            event: "email.received",
            inbox: `${alias}@${domain}`,
            sender: from,
            subject,
            timestamp: new Date().toISOString(),
          }),
        });
      } catch {}
    }
  },
};

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...extraHeaders },
  });
}

function generateAlias() {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < 10; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

async function validateApiKey(db, apiKey) {
  const row = await db.prepare(
    "SELECT user_id, quota_daily, quota_used, quota_date, expires_at FROM api_access WHERE api_key = ?"
  ).bind(apiKey).first();
  if (!row) return false;
  if (row.expires_at && new Date(row.expires_at) < new Date()) return false;
  if (row.quota_daily > 0) {
    const today = new Date().toISOString().split("T")[0];
    if (row.quota_date === today && row.quota_used >= row.quota_daily) return false;
    if (row.quota_date !== today) {
      await db.prepare("UPDATE api_access SET quota_used = 0, quota_date = ? WHERE user_id = ?").bind(today, row.user_id).run();
    }
  }
  await db.prepare("UPDATE api_access SET quota_used = quota_used + 1 WHERE user_id = ?").bind(row.user_id).run();
  return true;
}

function parseMime(raw) {
  let text = "";
  let html = "";

  const boundaryMatch = raw.match(/boundary="?([^";\r\n]+)"?/i);
  const bodyStart = raw.match(/\r?\n\r?\n/);
  if (!bodyStart) return { text: raw, html: "" };
  
  const fullBody = raw.substring(bodyStart.index + bodyStart[0].length);

  if (boundaryMatch) {
    const boundary = boundaryMatch[1];
    const parts = fullBody.split("--" + boundary);
    for (const part of parts) {
      if (part.trim() === "" || part.trim() === "--") continue;
      const partBodyMatch = part.match(/\r?\n\r?\n([\s\S]*)/);
      if (!partBodyMatch) continue;
      const partBody = partBodyMatch[1].trim();
      const partContentType = part.match(/Content-Type:\s*([^\r\n;]+)/i)?.[1]?.trim().toLowerCase() || "";
      const encoding = part.match(/Content-Transfer-Encoding:\s*([^\r\n]+)/i)?.[1]?.trim().toLowerCase() || "";
      
      let decoded = partBody;
      if (encoding === "quoted-printable") {
        decoded = decoded.replace(/=\r?\n/g, "").replace(/=([0-9A-F]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
      } else if (encoding === "base64") {
        try { decoded = atob(decoded.replace(/\s/g, "")); } catch {}
      }

      if (partContentType.includes("text/html")) {
        html = decoded;
      } else if (partContentType.includes("text/plain")) {
        text = decoded;
      }
    }
  } else {
    const contentType = raw.match(/Content-Type:\s*([^\r\n;]+)/i)?.[1]?.trim().toLowerCase() || "";
    const encoding = raw.match(/Content-Transfer-Encoding:\s*([^\r\n]+)/i)?.[1]?.trim().toLowerCase() || "";
    let body = fullBody;
    if (encoding === "quoted-printable") {
      body = body.replace(/=\r?\n/g, "").replace(/=([0-9A-F]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
    } else if (encoding === "base64") {
      try { body = atob(body.replace(/\s/g, "")); } catch {}
    }
    if (contentType.includes("text/html")) {
      html = body;
      text = stripHtml(body);
    } else {
      text = body;
    }
  }

  return { text: text.trim(), html: html.trim() };
}

function stripHtml(html) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ")
    .trim();
}

async function handleTelegramWebhook(request, env, corsHeaders) {
  const secret = request.headers.get("X-Telegram-Bot-Api-Secret-Token");
  const expectedSecret = env.TELEGRAM_WEBHOOK_SECRET;
  if (expectedSecret && secret !== expectedSecret) {
    return json({ error: "Unauthorized" }, 401, corsHeaders);
  }

  const body = await request.json();
  const message = body.message;
  if (!message?.text) return json({ ok: true }, 200, corsHeaders);

  const chatId = String(message.chat.id);
  const text = message.text.trim();
  const botToken = env.TELEGRAM_BOT_TOKEN;

  if (text === "/start") {
    await sendTelegram(botToken, chatId, "Welcome to TempMail Bot! Use /create to get a temp email.");
  } else if (text === "/create") {
    const alias = generateAlias();
    const domain = env.MAIL_DOMAIN || "tempmail.com";
    const ttlHours = parseInt(env.INBOX_TTL_HOURS || "24", 10);
    const expiresAt = new Date(Date.now() + ttlHours * 3600000).toISOString();
    try {
      await env.DB.prepare("INSERT INTO inboxes (alias, domain, expires_at) VALUES (?, ?, ?)").bind(alias, domain, expiresAt).run();
      await sendTelegram(botToken, chatId, `Email: ${alias}@${domain}\nExpires: ${expiresAt}`);
    } catch (e) {
      await sendTelegram(botToken, chatId, `Error: ${e.message}`);
    }
  } else if (text.startsWith("/inbox ")) {
    const target = text.substring(7).trim().toLowerCase();
    const msgs = await env.DB.prepare("SELECT id, sender, subject, created_at FROM messages WHERE inbox_alias = ? ORDER BY created_at DESC LIMIT 10").bind(target).all();
    if (!msgs.results?.length) {
      await sendTelegram(botToken, chatId, `No messages for ${target}`);
    } else {
      const lines = msgs.results.map(m => `[${m.id}] ${m.sender} - ${m.subject || "(no subject)"} (${m.created_at})`);
      await sendTelegram(botToken, chatId, lines.join("\n"));
    }
  }

  return json({ ok: true }, 200, corsHeaders);
}

async function sendTelegram(botToken, chatId, text) {
  if (!botToken) return;
  try {
    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
  } catch {}
}
