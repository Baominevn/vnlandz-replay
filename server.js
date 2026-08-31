/**
 * VnlandZ Minecraft Relay & Discord Bridge Server
 * Vercel Serverless Function & Express Standalone Compatible
 */

const fs = require("fs");
const path = require("path");
const http = require("http");
const https = require("https");

// Global cached states across serverless invocations & local dev server
const queues = globalThis.__vnlandzQueues || new Map();
const events = globalThis.__vnlandzEvents || new Map();
const sessions = globalThis.__vnlandzSessions || new Set();
const discordStats = globalThis.__vnlandzDiscordStats || { forwarded: 0, failed: 0, lastSent: null, lastError: null };
const appConfig = globalThis.__vnlandzConfig || {
  discordWebhookUrl: process.env.DISCORD_WEBHOOK_URL || "",
  forwardEventsToDiscord: true,
  forwardChat: true,
  forwardJoinLeave: true,
  forwardDeaths: true,
  forwardCommands: true
};

globalThis.__vnlandzQueues = queues;
globalThis.__vnlandzEvents = events;
globalThis.__vnlandzSessions = sessions;
globalThis.__vnlandzDiscordStats = discordStats;
globalThis.__vnlandzConfig = appConfig;

const MAX_QUEUE = 50;
const MAX_EVENTS = 100;
const ADMIN_USER = process.env.ADMIN_USER || "admin";
const ADMIN_PASS = process.env.ADMIN_PASS || "admin1234";

/**
 * Main Vercel / Node HTTP Handler
 */
const mainHandler = async (req, res) => {
  setCors(res);

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    return res.end();
  }

  try {
    const host = req.headers.host || "127.0.0.1:3000";
    const url = new URL(req.url || "/", `http://${host}`);
    const pathname = url.pathname.toLowerCase().replace(/\/+$/, "") || "/";
    const clientKey = getClientKey(url, req);
    const clientIp = String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "127.0.0.1").split(",")[0].trim();

    // 0. Static assets handling (for standalone / local server mode)
    if (pathname === "/" || pathname === "/index.html") {
      const filePath = path.join(process.cwd(), "index.html");
      if (fs.existsSync(filePath)) {
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        return res.end(fs.readFileSync(filePath, "utf-8"));
      }
    }

    if (pathname === "/style.css") {
      const filePath = path.join(process.cwd(), "style.css");
      if (fs.existsSync(filePath)) {
        res.setHeader("Content-Type", "text/css; charset=utf-8");
        return res.end(fs.readFileSync(filePath, "utf-8"));
      }
    }

    if (pathname === "/script.js") {
      const filePath = path.join(process.cwd(), "script.js");
      if (fs.existsSync(filePath)) {
        res.setHeader("Content-Type", "application/javascript; charset=utf-8");
        return res.end(fs.readFileSync(filePath, "utf-8"));
      }
    }

    // 1. Admin Login
    if (pathname === "/login" && req.method === "POST") {
      const body = await readJson(req);
      const username = String(body.username || "").trim();
      const password = String(body.password || "").trim();

      if (username === ADMIN_USER && password === ADMIN_PASS) {
        const token = "vnz_session_" + Math.random().toString(36).substring(2) + Date.now().toString(36);
        sessions.add(token);
        res.setHeader("Set-Cookie", `admin_token=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800`);
        return sendJson(res, 200, { ok: true, message: "Đăng nhập thành công" });
      }
      return sendJson(res, 401, { ok: false, error: "Sai tài khoản hoặc mật khẩu!" });
    }

    // 2. Admin Logout
    if (pathname === "/logout") {
      const cookies = parseCookies(req.headers.cookie);
      if (cookies.admin_token) {
        sessions.delete(cookies.admin_token);
      }
      res.setHeader("Set-Cookie", `admin_token=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
      return sendJson(res, 200, { ok: true, message: "Đã đăng xuất" });
    }

    // 3. Admin Data Dashboard
    if (pathname === "/admin/data" && req.method === "GET") {
      const cookies = parseCookies(req.headers.cookie);
      if (!cookies.admin_token || !sessions.has(cookies.admin_token)) {
        return sendJson(res, 401, { ok: false, error: "Chưa xác thực quyền truy cập!" });
      }

      const allKeys = new Set([...queues.keys(), ...events.keys()]);
      const clientsData = {};

      for (const k of allKeys) {
        clientsData[k] = {
          queue: queues.get(k) || [],
          events: events.get(k) || []
        };
      }

      return sendJson(res, 200, {
        ok: true,
        stats: {
          totalClients: allKeys.size,
          activeIp: clientIp,
          discordForwarded: discordStats.forwarded,
          discordFailed: discordStats.failed,
          discordLastSent: discordStats.lastSent,
          discordLastError: discordStats.lastError
        },
        config: {
          discordWebhookConfigured: Boolean(appConfig.discordWebhookUrl),
          discordWebhookUrl: maskWebhook(appConfig.discordWebhookUrl),
          forwardEventsToDiscord: appConfig.forwardEventsToDiscord,
          forwardChat: appConfig.forwardChat,
          forwardJoinLeave: appConfig.forwardJoinLeave,
          forwardDeaths: appConfig.forwardDeaths,
          forwardCommands: appConfig.forwardCommands
        },
        clientsData
      });
    }

    // 3.1 Update Admin Settings (Discord Webhook & filters)
    if (pathname === "/admin/settings" && req.method === "POST") {
      const cookies = parseCookies(req.headers.cookie);
      if (!cookies.admin_token || !sessions.has(cookies.admin_token)) {
        return sendJson(res, 401, { ok: false, error: "Chưa xác thực quyền truy cập!" });
      }

      const body = await readJson(req);
      if (typeof body.discordWebhookUrl === "string") {
        const rawUrl = body.discordWebhookUrl.trim();
        // If user didn't change the masked one, keep original
        if (rawUrl && !rawUrl.includes("••••")) {
          appConfig.discordWebhookUrl = rawUrl;
        } else if (rawUrl === "") {
          appConfig.discordWebhookUrl = "";
        }
      }

      if (typeof body.forwardEventsToDiscord === "boolean") appConfig.forwardEventsToDiscord = body.forwardEventsToDiscord;
      if (typeof body.forwardChat === "boolean") appConfig.forwardChat = body.forwardChat;
      if (typeof body.forwardJoinLeave === "boolean") appConfig.forwardJoinLeave = body.forwardJoinLeave;
      if (typeof body.forwardDeaths === "boolean") appConfig.forwardDeaths = body.forwardDeaths;
      if (typeof body.forwardCommands === "boolean") appConfig.forwardCommands = body.forwardCommands;

      return sendJson(res, 200, {
        ok: true,
        message: "Cập nhật cấu hình thành công!",
        config: {
          discordWebhookConfigured: Boolean(appConfig.discordWebhookUrl),
          discordWebhookUrl: maskWebhook(appConfig.discordWebhookUrl),
          forwardEventsToDiscord: appConfig.forwardEventsToDiscord,
          forwardChat: appConfig.forwardChat,
          forwardJoinLeave: appConfig.forwardJoinLeave,
          forwardDeaths: appConfig.forwardDeaths,
          forwardCommands: appConfig.forwardCommands
        }
      });
    }

    // 3.2 Test Discord Webhook
    if (pathname === "/admin/test-discord" && req.method === "POST") {
      const cookies = parseCookies(req.headers.cookie);
      if (!cookies.admin_token || !sessions.has(cookies.admin_token)) {
        return sendJson(res, 401, { ok: false, error: "Chưa xác thực quyền truy cập!" });
      }

      const body = await readJson(req);
      const targetWebhook = body.webhookUrl || appConfig.discordWebhookUrl || process.env.DISCORD_WEBHOOK_URL;

      if (!targetWebhook || !isValidDiscordWebhook(targetWebhook)) {
        return sendJson(res, 400, { ok: false, error: "Link Discord Webhook không hợp lệ!" });
      }

      const testEvent = {
        time: new Date().toISOString(),
        client: "VnlandZ_Relay_Test",
        version: "1.20.4",
        type: "TEST",
        title: "⚡ Kiểm Tra Kết Nối Discord Webhook",
        player: "MinecraftPlayer",
        server: "Relay.Nexus.VN",
        message: "Chúc mừng! Kết nối từ Minecraft Client Relay đến Discord Webhook đã hoạt động hoàn hảo."
      };

      const result = await forwardToDiscord(targetWebhook, testEvent, "test_client_key");
      if (result.ok) {
        return sendJson(res, 200, { ok: true, message: "Đã gửi tin nhắn test đến Discord thành công!" });
      } else {
        return sendJson(res, 500, { ok: false, error: `Gửi Discord thất bại: ${result.error || "Unknown error"}` });
      }
    }

    // 3.3 Clear Queue for a client
    if (pathname === "/admin/clear-queue" && req.method === "POST") {
      const cookies = parseCookies(req.headers.cookie);
      if (!cookies.admin_token || !sessions.has(cookies.admin_token)) {
        return sendJson(res, 401, { ok: false, error: "Chưa xác thực quyền truy cập!" });
      }

      const body = await readJson(req);
      const targetKey = cleanKey(body.clientKey);
      if (targetKey) {
        queues.set(targetKey, []);
      }
      return sendJson(res, 200, { ok: true, message: `Đã làm sạch hàng đợi cho key ${targetKey}` });
    }

    // 4. API Poll - Minecraft Client lấy lệnh tiếp theo trong hàng đợi
    if (pathname === "/poll" && req.method === "GET") {
      if (!clientKey) {
        return sendJson(res, 400, { ok: false, error: "Missing clientKey" });
      }
      const queue = queues.get(clientKey) || [];
      const next = queue.shift() || "";
      queues.set(clientKey, queue);

      return sendJson(res, 200, {
        ok: true,
        clientKey,
        command: next,
        message: next,
        pending: queue.length
      });
    }

    // 5. API Send - Gửi lệnh/tin nhắn vào hàng đợi của Minecraft Client
    if (pathname === "/send") {
      if (!clientKey) {
        return sendJson(res, 400, { ok: false, error: "Missing clientKey. Dùng ?clientKey=TEN_KEY" });
      }

      let message = "";
      if (req.method === "GET") {
        message = url.searchParams.get("message") || url.searchParams.get("msg") || url.searchParams.get("command") || "";
      } else if (req.method === "POST") {
        const body = await readJson(req);
        message = body.command || body.message || body.text || "";
      }

      const normalized = normalizeIncoming(message);
      if (!normalized) {
        return sendJson(res, 400, { ok: false, error: "Missing message to send" });
      }

      const queue = pushMessage(clientKey, normalized);

      // Log event of command dispatch
      const list = events.get(clientKey) || [];
      list.push({
        time: new Date().toISOString(),
        client: "Relay_Dashboard_Bridge",
        version: "1.0",
        type: "COMMAND",
        title: "Relay Command Queued",
        player: "Admin / Discord Bridge",
        server: "Relay Server",
        message: `Lệnh đã được đưa vào hàng đợi: ${normalized}`
      });
      while (list.length > MAX_EVENTS) list.shift();
      events.set(clientKey, list);

      return sendJson(res, 200, {
        ok: true,
        queued: true,
        clientKey,
        command: normalized,
        pending: queue.length
      });
    }

    // 6. API Events / Push - Minecraft Client gửi sự kiện / chat / replay lên Relay
    if ((pathname === "/events" || pathname === "/push") && req.method === "POST") {
      if (!clientKey) {
        return sendJson(res, 400, { ok: false, error: "Missing clientKey header hoặc query param" });
      }

      const body = await readJson(req);
      const list = events.get(clientKey) || [];
      
      const eventItem = {
        time: new Date().toISOString(),
        client: cleanText(body.client || "Minecraft_Client"),
        version: cleanText(body.version || "1.0"),
        type: cleanText(body.type || "LOG").toUpperCase(),
        title: cleanText(body.title || "Minecraft Event"),
        player: cleanText(body.player || req.headers["x-vnlandz-player"] || "Unknown_Player"),
        server: cleanText(body.server || req.headers["x-vnlandz-server"] || "Minecraft Server"),
        message: cleanText(body.message || body.text || body.content || "")
      };

      list.push(eventItem);
      while (list.length > MAX_EVENTS) list.shift();
      events.set(clientKey, list);

      // If autoQueue is enabled, put incoming command to queue
      const incomingCmd = normalizeIncoming(body.command || (body.autoQueue ? body.message : ""));
      if (incomingCmd && body.autoQueue) {
        pushMessage(clientKey, incomingCmd);
      }

      // 7. TỰ ĐỘNG CHUYỂN TIẾP SỰ KIỆN SANG DISCORD WEBHOOK
      let discordResult = { forwarded: false };
      const customWebhook = req.headers["x-discord-webhook"] || body.discordWebhook || body.webhookUrl;
      const targetWebhook = customWebhook || appConfig.discordWebhookUrl || process.env.DISCORD_WEBHOOK_URL;

      if (targetWebhook && shouldForwardToDiscord(eventItem.type)) {
        // Send asynchronously to Discord without blocking Minecraft Client
        forwardToDiscord(targetWebhook, eventItem, clientKey)
          .then((res) => {
            if (res.ok) {
              discordStats.forwarded++;
              discordStats.lastSent = new Date().toISOString();
            } else {
              discordStats.failed++;
              discordStats.lastError = res.error;
            }
          })
          .catch((err) => {
            discordStats.failed++;
            discordStats.lastError = err.message;
          });
        discordResult = { forwarded: true, target: "Discord Webhook" };
      }

      return sendJson(res, 200, {
        ok: true,
        received: true,
        clientKey,
        eventsCount: list.length,
        discord: discordResult
      });
    }

    // Health check endpoint
    if (pathname === "/api/health" || pathname === "/health") {
      return sendJson(res, 200, {
        ok: true,
        service: "VnlandZ Minecraft Relay & Discord Bridge",
        uptime: process.uptime(),
        activeQueues: queues.size,
        activeEvents: events.size,
        discordStatus: Boolean(appConfig.discordWebhookUrl || process.env.DISCORD_WEBHOOK_URL) ? "Configured" : "Unconfigured"
      });
    }

    return sendJson(res, 404, { ok: false, error: `Endpoint not found: ${pathname}` });

  } catch (error) {
    console.error("Relay Server Error:", error);
    return sendJson(res, 500, { ok: false, error: "Internal Server Error", details: error.message });
  }
};

/**
 * Forward event to Discord Webhook via HTTPS Post
 */
function forwardToDiscord(webhookUrl, event, clientKey) {
  return new Promise((resolve) => {
    try {
      if (!webhookUrl || !webhookUrl.startsWith("https://discord.com/api/webhooks/")) {
        return resolve({ ok: false, error: "Invalid Discord Webhook URL" });
      }

      const typeUpper = (event.type || "LOG").toUpperCase();
      let embedColor = 0x00F2FE; // Neon Cyan default
      let typeEmoji = "⚡";

      if (typeUpper === "CHAT") {
        embedColor = 0x00FF87; // Neon Green
        typeEmoji = "💬";
      } else if (typeUpper === "JOIN") {
        embedColor = 0x10B981; // Emerald Green
        typeEmoji = "🟢";
      } else if (typeUpper === "LEAVE") {
        embedColor = 0xF59E0B; // Amber
        typeEmoji = "🔴";
      } else if (typeUpper === "DEATH" || typeUpper === "ALERT" || typeUpper === "DAMAGE") {
        embedColor = 0xFF007F; // Neon Pink
        typeEmoji = "☠️";
      } else if (typeUpper === "COMMAND" || typeUpper === "REPLAY") {
        embedColor = 0x8B5CF6; // Purple
        typeEmoji = "🎮";
      }

      const playerName = event.player && event.player !== "Unknown_Player" ? event.player : "Minecraft Client";
      const avatarUrl = playerName !== "Minecraft Client"
        ? `https://mc-heads.net/avatar/${encodeURIComponent(playerName)}/128`
        : "https://raw.githubusercontent.com/PrismarineJS/minecraft-data/master/data/pc/1.20/items.png";

      const payload = {
        username: "Minecraft Relay Nexus",
        avatar_url: "https://mc-heads.net/avatar/MHF_Steve/128",
        embeds: [
          {
            title: `${typeEmoji} [${typeUpper}] ${event.title || "Event Log"}`,
            description: event.message ? `\`\`\`fix\n${event.message}\n\`\`\`` : "_Không có nội dung tin nhắn_",
            color: embedColor,
            author: {
              name: `${playerName} • ${event.server || "Minecraft Server"}`,
              icon_url: avatarUrl
            },
            fields: [
              { name: "🔑 Client Key", value: `\`${clientKey}\``, inline: true },
              { name: "🌐 Server", value: event.server || "Local / Replay", inline: true },
              { name: "📦 Client / Ver", value: `${event.client || "Client"} (${event.version || "1.0"})`, inline: true }
            ],
            footer: {
              text: "VnlandZ Relay Bridge • Real-time Sync",
              icon_url: "https://mc-heads.net/avatar/MHF_Chest/64"
            },
            timestamp: event.time || new Date().toISOString()
          }
        ]
      };

      const payloadData = JSON.stringify(payload);
      const parsedUrl = new URL(webhookUrl);

      const options = {
        hostname: parsedUrl.hostname,
        path: parsedUrl.pathname + parsedUrl.search,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payloadData),
          "User-Agent": "VnlandZ-Minecraft-Relay/2.0"
        }
      };

      const req = https.request(options, (res) => {
        let responseBody = "";
        res.on("data", (chunk) => { responseBody += chunk; });
        res.on("end", () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve({ ok: true, status: res.statusCode });
          } else {
            resolve({ ok: false, error: `Discord HTTP ${res.statusCode}: ${responseBody || "Unknown"}` });
          }
        });
      });

      req.on("error", (err) => {
        resolve({ ok: false, error: err.message });
      });

      req.setTimeout(8000, () => {
        req.destroy();
        resolve({ ok: false, error: "Discord request timed out (8s)" });
      });

      req.write(payloadData);
      req.end();

    } catch (err) {
      resolve({ ok: false, error: err.message });
    }
  });
}

function shouldForwardToDiscord(type) {
  if (!appConfig.forwardEventsToDiscord) return false;
  const t = String(type || "").toUpperCase();
  if (t === "CHAT" && !appConfig.forwardChat) return false;
  if ((t === "JOIN" || t === "LEAVE") && !appConfig.forwardJoinLeave) return false;
  if ((t === "DEATH" || t === "DAMAGE" || t === "ALERT") && !appConfig.forwardDeaths) return false;
  if (t === "COMMAND" && !appConfig.forwardCommands) return false;
  return true;
}

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS,PUT,DELETE");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization,X-VnlandZ-Client-Key,X-VnlandZ-Player,X-VnlandZ-Server,X-Discord-Webhook");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
}

function sendJson(res, statusCode, data) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(data));
}

function getClientKey(url, req) {
  return cleanKey(
    url.searchParams.get("clientKey") ||
    url.searchParams.get("key") ||
    req.headers["x-vnlandz-client-key"] ||
    ""
  );
}

function pushMessage(clientKey, message) {
  const queue = queues.get(clientKey) || [];
  queue.push(message);
  while (queue.length > MAX_QUEUE) queue.shift();
  queues.set(clientKey, queue);
  return queue;
}

function cleanKey(value) {
  return String(value || "")
    .trim()
    .replace(/[^A-Za-z0-9_-]/g, "")
    .slice(0, 64);
}

function cleanText(value) {
  return String(value || "")
    .replace(/\r/g, "")
    .trim()
    .slice(0, 1000);
}

function normalizeIncoming(value) {
  const text = cleanText(value);
  const lower = text.toLowerCase();
  if (lower.startsWith("/chat ")) return cleanText(text.slice(6));
  if (lower.startsWith(".chat ")) return cleanText(text.slice(6));
  if (lower.startsWith("chat ")) return cleanText(text.slice(5));
  return text;
}

function parseCookies(cookieHeader) {
  const list = {};
  if (!cookieHeader) return list;
  cookieHeader.split(";").forEach(cookie => {
    let [name, ...rest] = cookie.split("=");
    name = name?.trim();
    if (name) list[name] = decodeURIComponent(rest.join("=").trim());
  });
  return list;
}

function maskWebhook(url) {
  if (!url) return "";
  if (url.length < 25) return "••••••••";
  const start = url.substring(0, 33); // "https://discord.com/api/webhooks/"
  const end = url.substring(url.length - 6);
  return `${start}••••••••••••${end}`;
}

function isValidDiscordWebhook(url) {
  return typeof url === "string" && url.startsWith("https://discord.com/api/webhooks/");
}

function readJson(req) {
  if (req.body && typeof req.body === "object") return Promise.resolve(req.body);
  if (typeof req.body === "string" && req.body.trim()) {
    try { return Promise.resolve(JSON.parse(req.body)); } catch { return Promise.resolve({}); }
  }
  if (req.readableEnded || req.complete) {
    return Promise.resolve({});
  }

  return new Promise((resolve) => {
    let data = "";
    let isAborted = false;
    const timer = setTimeout(() => {
      resolve({});
    }, 2000);

    req.on("data", chunk => {
      data += chunk;
      if (data.length > 1024 * 1024) {
        isAborted = true;
        clearTimeout(timer);
        req.destroy();
        resolve({});
      }
    });

    req.on("end", () => {
      clearTimeout(timer);
      if (isAborted || !data.trim()) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch {
        resolve({});
      }
    });

    req.on("error", () => {
      clearTimeout(timer);
      resolve({});
    });
  });
}

// Export handler for Vercel
module.exports = mainHandler;

// Standalone execution if executed directly
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  const server = http.createServer((req, res) => {
    mainHandler(req, res);
  });

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`[VnlandZ Relay Server] running on http://0.0.0.0:${PORT}`);
  });
}
