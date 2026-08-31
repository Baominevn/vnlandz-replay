import express, { Request, Response, NextFunction } from "express";
import path from "path";
import fs from "fs";
import https from "https";
import crypto from "crypto";

// ==========================================
// Types & State Definitions
// ==========================================

interface DiscordStats {
  forwarded: number;
  failed: number;
  lastSent: string | null;
  lastError: string | null;
  lastLatencyMs: number | null;
}

interface AppConfig {
  discordWebhookUrl: string;
  forwardEventsToDiscord: boolean;
  forwardChat: boolean;
  forwardJoinLeave: boolean;
  forwardDeaths: boolean;
  forwardCommands: boolean;
}

interface RelayEvent {
  time: string;
  client: string;
  version: string;
  type: string;
  title: string;
  player: string;
  server: string;
  message: string;
}

interface LoginAttemptInfo {
  count: number;
  firstAttempt: number;
  lockedUntil: number;
}

interface RateLimitInfo {
  count: number;
  resetTime: number;
}

// Global persistent state across hot reloads
const queues: Map<string, string[]> = (globalThis as any).__vnlandzQueues || new Map();
const events: Map<string, RelayEvent[]> = (globalThis as any).__vnlandzEvents || new Map();
const sessions: Map<string, { createdAt: number; expiresAt: number }> =
  (globalThis as any).__vnlandzSessions || new Map();
const discordStats: DiscordStats = (globalThis as any).__vnlandzDiscordStats || {
  forwarded: 0,
  failed: 0,
  lastSent: null,
  lastError: null,
  lastLatencyMs: null,
};
const appConfig: AppConfig = (globalThis as any).__vnlandzConfig || {
  discordWebhookUrl: process.env.DISCORD_WEBHOOK_URL || "",
  forwardEventsToDiscord: true,
  forwardChat: true,
  forwardJoinLeave: true,
  forwardDeaths: true,
  forwardCommands: true,
};

// Request Counters for real telemetry
const requestCounters = (globalThis as any).__vnlandzCounters || {
  polls: 0,
  sends: 0,
  events: 0,
  totalHttp: 0,
};

// Anti-Brute Force & Rate Limit Storage
const loginAttempts: Map<string, LoginAttemptInfo> =
  (globalThis as any).__vnlandzLoginAttempts || new Map();
const rateLimits: Map<string, RateLimitInfo> =
  (globalThis as any).__vnlandzRateLimits || new Map();

(globalThis as any).__vnlandzQueues = queues;
(globalThis as any).__vnlandzEvents = events;
(globalThis as any).__vnlandzSessions = sessions;
(globalThis as any).__vnlandzDiscordStats = discordStats;
(globalThis as any).__vnlandzConfig = appConfig;
(globalThis as any).__vnlandzCounters = requestCounters;
(globalThis as any).__vnlandzLoginAttempts = loginAttempts;
(globalThis as any).__vnlandzRateLimits = rateLimits;

// Limits & Constants
const MAX_QUEUE = 50;
const MAX_EVENTS = 100;
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const MAX_LOGIN_ATTEMPTS = 5;
const LOGIN_LOCKOUT_MS = 15 * 60 * 1000; // 15 minutes
const ADMIN_USER = process.env.ADMIN_USER || "admin";
const ADMIN_PASS = process.env.ADMIN_PASS || "admin1234";
const PORT = 3000;

// Periodic cleanup of expired rate limits and sessions (every 10 minutes)
setInterval(() => {
  const now = Date.now();
  for (const [token, session] of sessions.entries()) {
    if (session.expiresAt < now) {
      sessions.delete(token);
    }
  }
  for (const [ip, attempt] of loginAttempts.entries()) {
    if (attempt.lockedUntil < now && now - attempt.firstAttempt > LOGIN_LOCKOUT_MS) {
      loginAttempts.delete(ip);
    }
  }
  for (const [key, limit] of rateLimits.entries()) {
    if (limit.resetTime < now) {
      rateLimits.delete(key);
    }
  }
}, 10 * 60 * 1000);

const app = express();

// Global request counter
app.use((req: Request, res: Response, next: NextFunction) => {
  requestCounters.totalHttp++;
  next();
});

// ==========================================
// 1. Security Headers & CORS Middleware
// ==========================================
app.use((req: Request, res: Response, next: NextFunction) => {
  // Prevent MIME-sniffing
  res.setHeader("X-Content-Type-Options", "nosniff");
  // Cross-site scripting filter
  res.setHeader("X-XSS-Protection", "1; mode=block");
  // Prevent clickjacking while allowing trusted embedding in AI Studio preview
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  // Referrer Policy
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  // Permissions Policy
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  // Content Security Policy
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' https://mc-heads.net https://raw.githubusercontent.com data:; connect-src 'self' https://discord.com; frame-ancestors 'self' *;"
  );

  // CORS Headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS,PUT,DELETE");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type,Authorization,X-VnlandZ-Client-Key,X-VnlandZ-Player,X-VnlandZ-Server,X-Discord-Webhook,X-Admin-Token"
  );

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  next();
});

// Body parsers with safe payload size limit (max 2MB to prevent memory exhaustion)
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true, limit: "2mb" }));

// ==========================================
// 2. Helper Security Utilities
// ==========================================

function getClientIp(req: Request): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string") {
    return forwarded.split(",")[0].trim();
  }
  return req.socket.remoteAddress || "127.0.0.1";
}

function cleanKey(value: any): string {
  return String(value || "")
    .trim()
    .replace(/[^A-Za-z0-9_-]/g, "")
    .slice(0, 64);
}

function cleanText(value: any): string {
  return String(value || "")
    .replace(/[\0\r]/g, "")
    .trim()
    .slice(0, 1000);
}

function normalizeIncoming(value: any): string {
  const text = cleanText(value);
  const lower = text.toLowerCase();
  if (lower.startsWith("/chat ")) return cleanText(text.slice(6));
  if (lower.startsWith(".chat ")) return cleanText(text.slice(6));
  if (lower.startsWith("chat ")) return cleanText(text.slice(5));
  return text;
}

function parseCookies(cookieHeader?: string): Record<string, string> {
  const list: Record<string, string> = {};
  if (!cookieHeader) return list;
  cookieHeader.split(";").forEach((cookie) => {
    const parts = cookie.split("=");
    const name = parts[0]?.trim();
    if (name) {
      list[name] = decodeURIComponent(parts.slice(1).join("=").trim());
    }
  });
  return list;
}

function maskWebhook(url: string): string {
  if (!url) return "";
  if (url.length < 25) return "••••••••";
  const start = url.substring(0, 33);
  const end = url.substring(url.length - 6);
  return `${start}••••••••••••${end}`;
}

function isValidDiscordWebhook(url: string): boolean {
  return (
    typeof url === "string" &&
    (url.startsWith("https://discord.com/api/webhooks/") ||
      url.startsWith("https://discordapp.com/api/webhooks/"))
  );
}

// Constant-time string comparison to prevent timing attacks
function timingSafeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf-8");
  const bufB = Buffer.from(b, "utf-8");
  if (bufA.length !== bufB.length) {
    // Run comparison with self to prevent short-circuit timing leak
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

function pushMessage(clientKey: string, message: string): string[] {
  const queue = queues.get(clientKey) || [];
  queue.push(message);
  while (queue.length > MAX_QUEUE) queue.shift();
  queues.set(clientKey, queue);
  return queue;
}

function shouldForwardToDiscord(type: string): boolean {
  if (!appConfig.forwardEventsToDiscord) return false;
  const t = String(type || "").toUpperCase();
  if (t === "CHAT" && !appConfig.forwardChat) return false;
  if ((t === "JOIN" || t === "LEAVE") && !appConfig.forwardJoinLeave) return false;
  if ((t === "DEATH" || t === "DAMAGE" || t === "ALERT") && !appConfig.forwardDeaths) return false;
  if (t === "COMMAND" && !appConfig.forwardCommands) return false;
  return true;
}

function forwardToDiscord(
  webhookUrl: string,
  event: RelayEvent,
  clientKey: string
): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  return new Promise((resolve) => {
    const startTime = Date.now();
    try {
      if (!isValidDiscordWebhook(webhookUrl)) {
        return resolve({ ok: false, latencyMs: 0, error: "Invalid Discord Webhook URL" });
      }

      const typeUpper = (event.type || "LOG").toUpperCase();
      let embedColor = 0x00f2fe; // Neon Cyan
      let typeEmoji = "⚡";

      if (typeUpper === "CHAT") {
        embedColor = 0x00ff87;
        typeEmoji = "💬";
      } else if (typeUpper === "JOIN") {
        embedColor = 0x10b981;
        typeEmoji = "🟢";
      } else if (typeUpper === "LEAVE") {
        embedColor = 0xf59e0b;
        typeEmoji = "🔴";
      } else if (typeUpper === "DEATH" || typeUpper === "ALERT" || typeUpper === "DAMAGE") {
        embedColor = 0xff007f;
        typeEmoji = "☠️";
      } else if (typeUpper === "COMMAND" || typeUpper === "REPLAY") {
        embedColor = 0x8b5cf6;
        typeEmoji = "🎮";
      }

      const rawPlayer = event.player && event.player !== "Unknown_Player" ? event.player : "Minecraft Client";
      const sanitizedPlayer = cleanText(rawPlayer).replace(/[^\w\s\-_.]/g, "");
      const avatarUrl =
        sanitizedPlayer && sanitizedPlayer !== "Minecraft Client"
          ? `https://mc-heads.net/avatar/${encodeURIComponent(sanitizedPlayer)}/128`
          : "https://mc-heads.net/avatar/MHF_Steve/128";

      const payload = {
        username: "Minecraft Relay Nexus",
        avatar_url: "https://mc-heads.net/avatar/MHF_Steve/128",
        embeds: [
          {
            title: `${typeEmoji} [${typeUpper}] ${cleanText(event.title || "Event Log")}`,
            description: event.message ? `\`\`\`fix\n${cleanText(event.message)}\n\`\`\`` : "_Không có nội dung tin nhắn_",
            color: embedColor,
            author: {
              name: `${sanitizedPlayer} • ${cleanText(event.server || "Minecraft Server")}`,
              icon_url: avatarUrl,
            },
            fields: [
              { name: "🔑 Client Key", value: `\`${cleanKey(clientKey)}\``, inline: true },
              { name: "🌐 Server", value: cleanText(event.server || "Local / Replay"), inline: true },
              { name: "📦 Client / Ver", value: `${cleanText(event.client || "Client")} (${cleanText(event.version || "1.0")})`, inline: true },
            ],
            footer: {
              text: "VnlandZ Relay Bridge • Real-time Sync",
              icon_url: "https://mc-heads.net/avatar/MHF_Chest/64",
            },
            timestamp: event.time || new Date().toISOString(),
          },
        ],
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
          "User-Agent": "VnlandZ-Minecraft-Relay/2.0",
        },
      };

      const req = https.request(options, (res) => {
        let responseBody = "";
        res.on("data", (chunk) => {
          responseBody += chunk;
        });
        res.on("end", () => {
          const latencyMs = Date.now() - startTime;
          discordStats.lastLatencyMs = latencyMs;
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            resolve({ ok: true, latencyMs });
          } else {
            resolve({ ok: false, latencyMs, error: `Discord HTTP ${res.statusCode}: ${responseBody || "Unknown"}` });
          }
        });
      });

      req.on("error", (err) => {
        const latencyMs = Date.now() - startTime;
        discordStats.lastLatencyMs = latencyMs;
        resolve({ ok: false, latencyMs, error: err.message });
      });

      req.setTimeout(8000, () => {
        const latencyMs = Date.now() - startTime;
        req.destroy();
        resolve({ ok: false, latencyMs, error: "Discord request timed out (8s)" });
      });

      req.write(payloadData);
      req.end();
    } catch (err: any) {
      const latencyMs = Date.now() - startTime;
      resolve({ ok: false, latencyMs, error: err.message });
    }
  });
}

function extractClientKey(req: Request): string {
  const queryKey = req.query.clientKey || req.query.key;
  const headerKey = req.headers["x-vnlandz-client-key"];
  return cleanKey(queryKey || headerKey);
}

// ==========================================
// 3. Anti-Spam / Rate Limiting Middleware
// ==========================================
function rateLimit(maxRequests: number, windowMs: number) {
  return (req: Request, res: Response, next: NextFunction) => {
    const ip = getClientIp(req);
    const key = `${ip}:${req.baseUrl || req.path}`;
    const now = Date.now();

    const record = rateLimits.get(key);
    if (!record || record.resetTime < now) {
      rateLimits.set(key, { count: 1, resetTime: now + windowMs });
      return next();
    }

    if (record.count >= maxRequests) {
      const retryAfterSec = Math.ceil((record.resetTime - now) / 1000);
      res.setHeader("Retry-After", String(retryAfterSec));
      res.status(429).json({
        ok: false,
        error: `Quá nhiều yêu cầu (Rate limit exceeded). Vui lòng thử lại sau ${retryAfterSec} giây.`,
      });
      return;
    }

    record.count++;
    next();
  };
}

// ==========================================
// 4. Authentication & Anti-Brute Force Protection
// ==========================================

// Login Route with Anti-Brute Force, Timing Protection & Honeypot
app.post("/login", (req: Request, res: Response) => {
  const ip = getClientIp(req);
  const now = Date.now();

  // 1. Check Anti-Bot Honeypot
  if (req.body._hp_security_check) {
    res.status(400).json({ ok: false, error: "Yêu cầu không hợp lệ (Bot detected)." });
    return;
  }

  // 2. Check Anti-Brute Force Lockout
  const attemptInfo = loginAttempts.get(ip);
  if (attemptInfo && attemptInfo.lockedUntil > now) {
    const remainingMin = Math.ceil((attemptInfo.lockedUntil - now) / 60000);
    res.status(429).json({
      ok: false,
      error: `IP tạm thời bị khóa do nhập sai mật khẩu quá 5 lần. Vui lòng thử lại sau ${remainingMin} phút.`,
    });
    return;
  }

  const username = String(req.body.username || "").trim();
  const password = String(req.body.password || "").trim();

  const isUserValid = timingSafeCompare(username, ADMIN_USER);
  const isPassValid = timingSafeCompare(password, ADMIN_PASS);

  if (isUserValid && isPassValid) {
    // Reset failed attempts on success
    loginAttempts.delete(ip);

    // Generate cryptographically secure token
    const token = "vnz_sec_" + crypto.randomBytes(32).toString("hex");
    const expiresAt = now + SESSION_TTL_MS;
    sessions.set(token, { createdAt: now, expiresAt });

    // Set secure cookie
    res.setHeader(
      "Set-Cookie",
      `admin_token=${token}; Path=/; HttpOnly; SameSite=None; Secure; Max-Age=${SESSION_TTL_MS / 1000}`
    );

    res.json({
      ok: true,
      token,
      message: "Đăng nhập thành công",
    });
    return;
  }

  // Record failed attempt
  const currentCount = attemptInfo && now - attemptInfo.firstAttempt < LOGIN_LOCKOUT_MS ? attemptInfo.count + 1 : 1;
  const lockedUntil = currentCount >= MAX_LOGIN_ATTEMPTS ? now + LOGIN_LOCKOUT_MS : 0;

  loginAttempts.set(ip, {
    count: currentCount,
    firstAttempt: attemptInfo ? attemptInfo.firstAttempt : now,
    lockedUntil,
  });

  if (lockedUntil > 0) {
    res.status(429).json({
      ok: false,
      error: `Bạn đã nhập sai 5 lần! IP của bạn đã bị tạm khóa 15 phút để bảo vệ hệ thống.`,
    });
    return;
  }

  res.status(401).json({
    ok: false,
    error: `Sai tài khoản hoặc mật khẩu! (Còn ${MAX_LOGIN_ATTEMPTS - currentCount} lần thử)`,
  });
});

app.all("/logout", (req: Request, res: Response) => {
  const cookies = parseCookies(req.headers.cookie);
  const authHeader = req.headers.authorization;
  let token = cookies.admin_token;
  if (!token && authHeader && authHeader.startsWith("Bearer ")) {
    token = authHeader.substring(7).trim();
  }
  if (!token && req.headers["x-admin-token"]) {
    token = String(req.headers["x-admin-token"]).trim();
  }
  if (token) {
    sessions.delete(token);
  }
  res.setHeader("Set-Cookie", `admin_token=; Path=/; HttpOnly; SameSite=None; Secure; Max-Age=0`);
  res.json({ ok: true, message: "Đã đăng xuất an toàn" });
});

// Middleware for Admin Route Protection
function checkAuth(req: Request, res: Response, next: NextFunction) {
  const cookies = parseCookies(req.headers.cookie);
  const authHeader = req.headers.authorization;
  let token = cookies.admin_token;
  if (!token && authHeader && authHeader.startsWith("Bearer ")) {
    token = authHeader.substring(7).trim();
  }
  if (!token && req.headers["x-admin-token"]) {
    token = String(req.headers["x-admin-token"]).trim();
  }

  if (!token || !sessions.has(token)) {
    res.status(401).json({ ok: false, error: "Chưa xác thực quyền truy cập!" });
    return;
  }

  const session = sessions.get(token);
  if (session && session.expiresAt < Date.now()) {
    sessions.delete(token);
    res.status(401).json({ ok: false, error: "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại!" });
    return;
  }

  next();
}

// ==========================================
// 5. Protected Admin APIs
// ==========================================
app.get("/admin/data", checkAuth, rateLimit(100, 60000), (req: Request, res: Response) => {
  const clientIp = getClientIp(req);
  const allKeys = new Set([...queues.keys(), ...events.keys()]);
  const clientsData: Record<string, { queue: string[]; events: RelayEvent[] }> = {};

  for (const k of allKeys) {
    clientsData[k] = {
      queue: queues.get(k) || [],
      events: events.get(k) || [],
    };
  }

  // Real System & Telemetry Metrics
  const mem = process.memoryUsage();
  const uptimeSec = Math.floor(process.uptime());
  const totalDispatches = discordStats.forwarded + discordStats.failed;
  const syncRate = totalDispatches > 0 ? ((discordStats.forwarded / totalDispatches) * 100).toFixed(1) : "100.0";

  res.json({
    ok: true,
    stats: {
      totalClients: allKeys.size,
      activeIp: clientIp,
      uptimeSeconds: uptimeSec,
      memoryHeapUsedMB: (mem.heapUsed / (1024 * 1024)).toFixed(1),
      memoryRssMB: (mem.rss / (1024 * 1024)).toFixed(1),
      nodeVersion: process.version,
      platform: process.platform,
      totalPollRequests: requestCounters.polls,
      totalSendRequests: requestCounters.sends,
      totalEventRequests: requestCounters.events,
      totalHttpRequests: requestCounters.totalHttp,
      discordForwarded: discordStats.forwarded,
      discordFailed: discordStats.failed,
      discordLastSent: discordStats.lastSent,
      discordLastError: discordStats.lastError,
      discordLatencyMs: discordStats.lastLatencyMs,
      discordSyncRate: parseFloat(syncRate),
    },
    config: {
      discordWebhookConfigured: Boolean(appConfig.discordWebhookUrl),
      discordWebhookUrl: maskWebhook(appConfig.discordWebhookUrl),
      forwardEventsToDiscord: appConfig.forwardEventsToDiscord,
      forwardChat: appConfig.forwardChat,
      forwardJoinLeave: appConfig.forwardJoinLeave,
      forwardDeaths: appConfig.forwardDeaths,
      forwardCommands: appConfig.forwardCommands,
    },
    clientsData,
  });
});

app.post("/admin/settings", checkAuth, rateLimit(30, 60000), (req: Request, res: Response) => {
  const body = req.body;
  if (typeof body.discordWebhookUrl === "string") {
    const rawUrl = cleanText(body.discordWebhookUrl);
    if (rawUrl && !rawUrl.includes("••••")) {
      if (isValidDiscordWebhook(rawUrl)) {
        appConfig.discordWebhookUrl = rawUrl;
      } else {
        res.status(400).json({ ok: false, error: "Địa chỉ Discord Webhook không đúng định dạng!" });
        return;
      }
    } else if (rawUrl === "") {
      appConfig.discordWebhookUrl = "";
    }
  }

  if (typeof body.forwardEventsToDiscord === "boolean") appConfig.forwardEventsToDiscord = body.forwardEventsToDiscord;
  if (typeof body.forwardChat === "boolean") appConfig.forwardChat = body.forwardChat;
  if (typeof body.forwardJoinLeave === "boolean") appConfig.forwardJoinLeave = body.forwardJoinLeave;
  if (typeof body.forwardDeaths === "boolean") appConfig.forwardDeaths = body.forwardDeaths;
  if (typeof body.forwardCommands === "boolean") appConfig.forwardCommands = body.forwardCommands;

  res.json({
    ok: true,
    message: "Cập nhật cấu hình thành công!",
    config: {
      discordWebhookConfigured: Boolean(appConfig.discordWebhookUrl),
      discordWebhookUrl: maskWebhook(appConfig.discordWebhookUrl),
      forwardEventsToDiscord: appConfig.forwardEventsToDiscord,
      forwardChat: appConfig.forwardChat,
      forwardJoinLeave: appConfig.forwardJoinLeave,
      forwardDeaths: appConfig.forwardDeaths,
      forwardCommands: appConfig.forwardCommands,
    },
  });
});

app.post("/admin/test-discord", checkAuth, rateLimit(10, 60000), async (req: Request, res: Response) => {
  const body = req.body;
  const targetWebhook = cleanText(body.webhookUrl || appConfig.discordWebhookUrl || process.env.DISCORD_WEBHOOK_URL || "");

  if (!targetWebhook || !isValidDiscordWebhook(targetWebhook)) {
    res.status(400).json({ ok: false, error: "Link Discord Webhook không hợp lệ!" });
    return;
  }

  const testEvent: RelayEvent = {
    time: new Date().toISOString(),
    client: "VnlandZ_Relay_Test",
    version: "1.20.4",
    type: "TEST",
    title: "⚡ Kiểm Tra Kết Nối Discord Webhook",
    player: "MinecraftPlayer",
    server: "Relay.Nexus.VN",
    message: "Chúc mừng! Kết nối từ Minecraft Client Relay đến Discord Webhook đã hoạt động an toàn.",
  };

  const result = await forwardToDiscord(targetWebhook, testEvent, "test_client_key");
  if (result.ok) {
    discordStats.forwarded++;
    discordStats.lastSent = new Date().toISOString();
    res.json({
      ok: true,
      message: `Đã gửi tin nhắn test đến Discord thành công! Độ trễ thực tế: ${result.latencyMs}ms`,
      latencyMs: result.latencyMs,
    });
  } else {
    discordStats.failed++;
    discordStats.lastError = result.error || "Unknown error";
    res.status(500).json({
      ok: false,
      error: `Gửi Discord thất bại (${result.latencyMs}ms): ${result.error || "Unknown error"}`,
      latencyMs: result.latencyMs,
    });
  }
});

app.post("/admin/clear-queue", checkAuth, rateLimit(30, 60000), (req: Request, res: Response) => {
  const targetKey = cleanKey(req.body.clientKey);
  if (targetKey) {
    queues.set(targetKey, []);
  }
  res.json({ ok: true, message: `Đã làm sạch hàng đợi cho key ${targetKey}` });
});

// ==========================================
// 6. Public Minecraft Client & Relay APIs
// ==========================================

// Health Check API (without exposing credentials)
app.get(["/api/health", "/health"], (req: Request, res: Response) => {
  const mem = process.memoryUsage();
  res.json({
    ok: true,
    service: "VnlandZ Minecraft Relay & Discord Bridge",
    uptimeSeconds: Math.floor(process.uptime()),
    activeClients: queues.size,
    memoryHeapUsedMB: (mem.heapUsed / (1024 * 1024)).toFixed(1),
    security: {
      antiBruteForce: "Enabled (5 max attempts / 15m lockout)",
      rateLimiting: "Active",
      dataMasking: "Strict",
    },
    timestamp: Date.now(),
  });
});

// API Poll - Minecraft Client lấy lệnh tiếp theo trong hàng đợi (Rate limited: 180 req/min)
app.get("/poll", rateLimit(180, 60000), (req: Request, res: Response) => {
  requestCounters.polls++;
  const clientKey = extractClientKey(req);
  if (!clientKey) {
    res.status(400).json({ ok: false, error: "Missing clientKey" });
    return;
  }

  const queue = queues.get(clientKey) || [];
  const next = queue.shift() || "";
  queues.set(clientKey, queue);

  res.json({
    ok: true,
    clientKey,
    command: next,
    message: next,
    pending: queue.length,
  });
});

// API Send - Gửi lệnh/tin nhắn vào hàng đợi của Minecraft Client (Rate limited: 60 req/min)
app.all("/send", rateLimit(60, 60000), (req: Request, res: Response) => {
  requestCounters.sends++;
  const clientKey = extractClientKey(req);
  if (!clientKey) {
    res.status(400).json({ ok: false, error: "Missing clientKey. Dùng ?clientKey=TEN_KEY" });
    return;
  }

  let message = "";
  if (req.method === "GET") {
    message = String(req.query.message || req.query.msg || req.query.command || "");
  } else {
    message = String(req.body.command || req.body.message || req.body.text || "");
  }

  const normalized = normalizeIncoming(message);
  if (!normalized) {
    res.status(400).json({ ok: false, error: "Missing message to send" });
    return;
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
    message: `Lệnh đã được đưa vào hàng đợi: ${normalized}`,
  });
  while (list.length > MAX_EVENTS) list.shift();
  events.set(clientKey, list);

  res.json({
    ok: true,
    queued: true,
    clientKey,
    command: normalized,
    pending: queue.length,
  });
});

// API Events / Push - Minecraft Client gửi sự kiện / chat / replay lên Relay (Rate limited: 120 req/min)
app.post(["/events", "/push"], rateLimit(120, 60000), (req: Request, res: Response) => {
  requestCounters.events++;
  const clientKey = extractClientKey(req);
  if (!clientKey) {
    res.status(400).json({ ok: false, error: "Missing clientKey header hoặc query param" });
    return;
  }

  const body = req.body || {};
  const list = events.get(clientKey) || [];

  const eventItem: RelayEvent = {
    time: new Date().toISOString(),
    client: cleanText(body.client || "Minecraft_Client"),
    version: cleanText(body.version || "1.0"),
    type: cleanText(body.type || "LOG").toUpperCase(),
    title: cleanText(body.title || "Minecraft Event"),
    player: cleanText(body.player || req.headers["x-vnlandz-player"] || "Unknown_Player"),
    server: cleanText(body.server || req.headers["x-vnlandz-server"] || "Minecraft Server"),
    message: cleanText(body.message || body.text || body.content || ""),
  };

  list.push(eventItem);
  while (list.length > MAX_EVENTS) list.shift();
  events.set(clientKey, list);

  // If autoQueue is enabled, put incoming command to queue
  const incomingCmd = normalizeIncoming(body.command || (body.autoQueue ? body.message : ""));
  if (incomingCmd && body.autoQueue) {
    pushMessage(clientKey, incomingCmd);
  }

  // Forward event to Discord Webhook asynchronously
  let discordResult: { forwarded: boolean; target?: string } = { forwarded: false };
  const customWebhook = cleanText((req.headers["x-discord-webhook"] as string) || body.discordWebhook || body.webhookUrl || "");
  const targetWebhook = customWebhook || appConfig.discordWebhookUrl || process.env.DISCORD_WEBHOOK_URL;

  if (targetWebhook && shouldForwardToDiscord(eventItem.type)) {
    forwardToDiscord(targetWebhook, eventItem, clientKey)
      .then((res) => {
        if (res.ok) {
          discordStats.forwarded++;
          discordStats.lastSent = new Date().toISOString();
        } else {
          discordStats.failed++;
          discordStats.lastError = res.error || "Unknown";
        }
      })
      .catch((err) => {
        discordStats.failed++;
        discordStats.lastError = err.message;
      });
    discordResult = { forwarded: true, target: "Discord Webhook" };
  }

  res.json({
    ok: true,
    received: true,
    clientKey,
    eventsCount: list.length,
    discord: discordResult,
  });
});

// Clear API
app.all("/clear", checkAuth, (req: Request, res: Response) => {
  const clientKey = extractClientKey(req);
  if (clientKey) {
    queues.set(clientKey, []);
    events.set(clientKey, []);
  }
  res.json({ ok: true, message: "Cleared", clientKey });
});

// Static assets
app.get("/style.css", (req: Request, res: Response) => {
  res.sendFile(path.join(process.cwd(), "style.css"));
});

app.get("/script.js", (req: Request, res: Response) => {
  res.sendFile(path.join(process.cwd(), "script.js"));
});

const publicDir = path.join(process.cwd(), "public");
if (fs.existsSync(publicDir)) {
  app.use("/public", express.static(publicDir));
}

// Single-page application entry point
app.get("*", (req: Request, res: Response) => {
  res.sendFile(path.join(process.cwd(), "index.html"));
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`[VnlandZ Minecraft Relay & Discord Bridge] Server running securely on http://0.0.0.0:${PORT}`);
});
