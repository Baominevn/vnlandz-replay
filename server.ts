import express, { Request, Response, NextFunction } from "express";
import http from "http";
import path from "path";
import fs from "fs";
import https from "https";
import crypto from "crypto";
import { WebSocketServer, WebSocket } from "ws";
import { GoogleGenAI } from "@google/genai";

// ==========================================
// Types & State Definitions
// ==========================================

export interface DiscordStats {
  forwarded: number;
  failed: number;
  lastSent: string | null;
  lastError: string | null;
  lastLatencyMs: number | null;
}

export interface EmbedConfig {
  themeColor: string;
  authorIcon: string;
  customTitle: string;
  footerText: string;
  showPlayerAvatar: boolean;
}

export interface AppConfig {
  discordWebhookUrl: string;
  forwardEventsToDiscord: boolean;
  forwardChat: boolean;
  forwardJoinLeave: boolean;
  forwardDeaths: boolean;
  forwardCommands: boolean;
  embedConfig: EmbedConfig;
}

export interface RelayEvent {
  time: string;
  client: string;
  version: string;
  type: string;
  title: string;
  player: string;
  server: string;
  message: string;
}

export interface ClientKeyMetadata {
  key: string;
  label: string;
  createdAt: number;
  lastSeen: number;
  status: "active" | "disabled" | "readonly";
  notes?: string;
}

export interface AuditLogItem {
  id: string;
  time: string;
  ip: string;
  action: string;
  details: string;
  severity: "info" | "warn" | "security";
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
const clientKeys: Map<string, ClientKeyMetadata> =
  (globalThis as any).__vnlandzClientKeys || new Map();
const auditLogs: AuditLogItem[] = (globalThis as any).__vnlandzAuditLogs || [];
const sessions: Map<string, { createdAt: number; expiresAt: number }> =
  (globalThis as any).__vnlandzSessions || new Map();

const defaultEmbedConfig: EmbedConfig = {
  themeColor: "#00f2fe",
  authorIcon: "https://mc-heads.net/avatar/MHF_Steve/128",
  customTitle: "Minecraft Relay Nexus",
  footerText: "VnlandZ Relay Bridge • Real-time Sync",
  showPlayerAvatar: true,
};

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
  embedConfig: defaultEmbedConfig,
};

// Request Counters & Telemetry
const requestCounters = (globalThis as any).__vnlandzCounters || {
  polls: 0,
  sends: 0,
  events: 0,
  totalHttp: 0,
  wsMessages: 0,
};

// Anti-Brute Force & Rate Limit Storage
const loginAttempts: Map<string, LoginAttemptInfo> =
  (globalThis as any).__vnlandzLoginAttempts || new Map();
const rateLimits: Map<string, RateLimitInfo> =
  (globalThis as any).__vnlandzRateLimits || new Map();

(globalThis as any).__vnlandzQueues = queues;
(globalThis as any).__vnlandzEvents = events;
(globalThis as any).__vnlandzClientKeys = clientKeys;
(globalThis as any).__vnlandzAuditLogs = auditLogs;
(globalThis as any).__vnlandzSessions = sessions;
(globalThis as any).__vnlandzDiscordStats = discordStats;
(globalThis as any).__vnlandzConfig = appConfig;
(globalThis as any).__vnlandzCounters = requestCounters;
(globalThis as any).__vnlandzLoginAttempts = loginAttempts;
(globalThis as any).__vnlandzRateLimits = rateLimits;

// Limits & Constants
const MAX_QUEUE = 50;
const MAX_EVENTS = 150;
const MAX_AUDIT_LOGS = 300;
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const MAX_LOGIN_ATTEMPTS = 5;
const LOGIN_LOCKOUT_MS = 15 * 60 * 1000; // 15 minutes
const ADMIN_USER = process.env.ADMIN_USER || "admin";
const ADMIN_PASS = process.env.ADMIN_PASS || "admin1234";
const PORT = 3000;

// Persistent Storage File (VI.1)
const DATA_DIR = path.join(process.cwd(), "data");
const DATA_FILE = path.join(DATA_DIR, "store.json");

function loadPersistedData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, "utf-8");
      const parsed = JSON.parse(raw);
      if (parsed.config) {
        Object.assign(appConfig, parsed.config);
        if (!appConfig.embedConfig) appConfig.embedConfig = defaultEmbedConfig;
      }
      if (Array.isArray(parsed.clientKeys)) {
        clientKeys.clear();
        for (const k of parsed.clientKeys) {
          // Do not restore default fake mock keys if previously saved
          if (k.key === "vnlandz_main" && k.label === "Main Survival Bot") continue;
          if (k.key === "replay_cam_1" && k.label === "Replay Camera #1") continue;
          clientKeys.set(k.key, k);
        }
      }
      if (parsed.queues && typeof parsed.queues === "object") {
        for (const [k, q] of Object.entries(parsed.queues)) {
          if (k === "vnlandz_main" || k === "replay_cam_1") continue;
          if (Array.isArray(q)) queues.set(k, q as string[]);
        }
      }
      if (parsed.events && typeof parsed.events === "object") {
        for (const [k, ev] of Object.entries(parsed.events)) {
          if (k === "vnlandz_main" || k === "replay_cam_1") continue;
          if (Array.isArray(ev)) events.set(k, ev as RelayEvent[]);
        }
      }
      if (Array.isArray(parsed.auditLogs)) {
        auditLogs.length = 0;
        auditLogs.push(...parsed.auditLogs.slice(-MAX_AUDIT_LOGS));
      }
      if (parsed.discordStats) {
        Object.assign(discordStats, parsed.discordStats);
      }
      console.log("[Persistence] Successfully loaded stored state from data/store.json");
    }
  } catch (err) {
    console.error("[Persistence] Error loading data/store.json:", err);
  }
}

let saveDebounceTimer: NodeJS.Timeout | null = null;
function persistData() {
  if (saveDebounceTimer) return;
  saveDebounceTimer = setTimeout(() => {
    saveDebounceTimer = null;
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      const dataToSave = {
        savedAt: new Date().toISOString(),
        config: appConfig,
        clientKeys: Array.from(clientKeys.values()),
        queues: Object.fromEntries(queues.entries()),
        events: Object.fromEntries(events.entries()),
        auditLogs: auditLogs.slice(-MAX_AUDIT_LOGS),
        discordStats,
      };
      fs.writeFileSync(DATA_FILE, JSON.stringify(dataToSave, null, 2), "utf-8");
    } catch (err) {
      console.error("[Persistence] Error saving to data/store.json:", err);
    }
  }, 1000);
}

// Initial Data Load
loadPersistedData();

// Add Audit Log Entry (III.3)
function addAuditLog(
  ip: string,
  action: string,
  details: string,
  severity: "info" | "warn" | "security" = "info"
) {
  const item: AuditLogItem = {
    id: "aud_" + crypto.randomBytes(6).toString("hex"),
    time: new Date().toISOString(),
    ip,
    action,
    details,
    severity,
  };
  auditLogs.push(item);
  while (auditLogs.length > MAX_AUDIT_LOGS) auditLogs.shift();
  persistData();
}

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
const server = http.createServer(app);

// Global request counter
app.use((req: Request, res: Response, next: NextFunction) => {
  requestCounters.totalHttp++;
  next();
});

// ==========================================
// 1. Security Headers & CORS Middleware
// ==========================================
app.use((req: Request, res: Response, next: NextFunction) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-XSS-Protection", "1; mode=block");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' https://mc-heads.net https://raw.githubusercontent.com data:; connect-src 'self' https://discord.com wss: ws:; frame-ancestors 'self' *;"
  );

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

// Body parsers
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true, limit: "2mb" }));

// ==========================================
// 2. Helper Security & Utilities
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
    .slice(0, 1500);
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

function timingSafeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf-8");
  const bufB = Buffer.from(b, "utf-8");
  if (bufA.length !== bufB.length) {
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

function touchClientKey(key: string) {
  if (!key) return;
  const existing = clientKeys.get(key);
  if (existing) {
    existing.lastSeen = Date.now();
  } else {
    clientKeys.set(key, {
      key,
      label: key,
      createdAt: Date.now(),
      lastSeen: Date.now(),
      status: "active",
    });
  }
  persistData();
}

function pushMessage(clientKey: string, message: string): string[] {
  touchClientKey(clientKey);
  const queue = queues.get(clientKey) || [];
  queue.push(message);
  while (queue.length > MAX_QUEUE) queue.shift();
  queues.set(clientKey, queue);
  persistData();

  // Notify WebSocket listeners
  broadcastToWs({
    type: "QUEUE_UPDATED",
    clientKey,
    queue,
    latestCommand: message,
  });

  // Direct push to connected Minecraft clients for this key
  notifyMinecraftClientWs(clientKey, message);

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

// Convert Hex string to decimal number
function parseHexColor(hex: string, defaultColor: number = 0x00f2fe): number {
  try {
    const clean = hex.replace("#", "").trim();
    const num = parseInt(clean, 16);
    return isNaN(num) ? defaultColor : num;
  } catch {
    return defaultColor;
  }
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
      const cfg = appConfig.embedConfig || defaultEmbedConfig;
      let embedColor = parseHexColor(cfg.themeColor, 0x00f2fe);
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

      const rawPlayer =
        event.player && event.player !== "Unknown_Player" ? event.player : "Minecraft Client";
      const sanitizedPlayer = cleanText(rawPlayer).replace(/[^\w\s\-_.]/g, "");
      const avatarUrl =
        cfg.showPlayerAvatar && sanitizedPlayer && sanitizedPlayer !== "Minecraft Client"
          ? `https://mc-heads.net/avatar/${encodeURIComponent(sanitizedPlayer)}/128`
          : cfg.authorIcon || "https://mc-heads.net/avatar/MHF_Steve/128";

      const payload = {
        username: cfg.customTitle || "Minecraft Relay Nexus",
        avatar_url: cfg.authorIcon || "https://mc-heads.net/avatar/MHF_Steve/128",
        embeds: [
          {
            title: `${typeEmoji} [${typeUpper}] ${cleanText(event.title || "Event Log")}`,
            description: event.message
              ? `\`\`\`fix\n${cleanText(event.message)}\n\`\`\``
              : "_Không có nội dung tin nhắn_",
            color: embedColor,
            author: {
              name: `${sanitizedPlayer} • ${cleanText(event.server || "Minecraft Server")}`,
              icon_url: avatarUrl,
            },
            fields: [
              { name: "🔑 Client Key", value: `\`${cleanKey(clientKey)}\``, inline: true },
              {
                name: "🌐 Server",
                value: cleanText(event.server || "Local / Replay"),
                inline: true,
              },
              {
                name: "📦 Client / Ver",
                value: `${cleanText(event.client || "Client")} (${cleanText(
                  event.version || "1.0"
                )})`,
                inline: true,
              },
            ],
            footer: {
              text: cfg.footerText || "VnlandZ Relay Bridge • Real-time Sync",
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
          "User-Agent": "VnlandZ-Minecraft-Relay/2.5",
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
            resolve({
              ok: false,
              latencyMs,
              error: `Discord HTTP ${res.statusCode}: ${responseBody || "Unknown"}`,
            });
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

app.post("/login", (req: Request, res: Response) => {
  const ip = getClientIp(req);
  const now = Date.now();

  // 1. Check Anti-Bot Honeypot
  if (req.body._hp_security_check) {
    addAuditLog(ip, "LOGIN_BLOCKED_BOT", "Phát hiện bot tự động điền form honeypot", "security");
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
    loginAttempts.delete(ip);

    const token = "vnz_sec_" + crypto.randomBytes(32).toString("hex");
    const expiresAt = now + SESSION_TTL_MS;
    sessions.set(token, { createdAt: now, expiresAt });

    res.setHeader(
      "Set-Cookie",
      `admin_token=${token}; Path=/; HttpOnly; SameSite=None; Secure; Max-Age=${
        SESSION_TTL_MS / 1000
      }`
    );

    addAuditLog(ip, "LOGIN_SUCCESS", `Đăng nhập thành công với tài khoản: ${username}`, "info");

    res.json({
      ok: true,
      token,
      message: "Đăng nhập thành công",
    });
    return;
  }

  // Record failed attempt
  const currentCount =
    attemptInfo && now - attemptInfo.firstAttempt < LOGIN_LOCKOUT_MS
      ? attemptInfo.count + 1
      : 1;
  const lockedUntil = currentCount >= MAX_LOGIN_ATTEMPTS ? now + LOGIN_LOCKOUT_MS : 0;

  loginAttempts.set(ip, {
    count: currentCount,
    firstAttempt: attemptInfo ? attemptInfo.firstAttempt : now,
    lockedUntil,
  });

  addAuditLog(
    ip,
    "LOGIN_FAILED",
    `Sai thông tin đăng nhập (Tài khoản thử: ${username}, Lần thử: ${currentCount}/5)`,
    "warn"
  );

  if (lockedUntil > 0) {
    addAuditLog(ip, "IP_LOCKED", `Khóa IP 15 phút do thử sai 5 lần`, "security");
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
  const ip = getClientIp(req);
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
  addAuditLog(ip, "LOGOUT", "Đăng xuất tài khoản quản trị", "info");
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
    res
      .status(401)
      .json({ ok: false, error: "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại!" });
    return;
  }

  next();
}

// ==========================================
// 5. WebSocket Server Setup (I.1)
// ==========================================

interface ExtWebSocket extends WebSocket {
  isAlive: boolean;
  role: "dashboard" | "minecraft_client";
  clientKey?: string;
}

const wss = new WebSocketServer({ server, path: "/ws/relay" });
const wsClients = new Set<ExtWebSocket>();

wss.on("connection", (ws: ExtWebSocket, req) => {
  ws.isAlive = true;
  const urlParams = new URLSearchParams((req.url || "").split("?")[1] || "");
  const role = (urlParams.get("role") || "dashboard") as "dashboard" | "minecraft_client";
  const clientKey = cleanKey(urlParams.get("clientKey") || "");

  ws.role = role;
  ws.clientKey = clientKey;
  wsClients.add(ws);

  if (clientKey) touchClientKey(clientKey);

  // Send initial welcome & state
  ws.send(
    JSON.stringify({
      type: "WS_CONNECTED",
      role,
      clientKey,
      serverTime: Date.now(),
    })
  );

  ws.on("pong", () => {
    ws.isAlive = true;
  });

  ws.on("message", (raw) => {
    try {
      requestCounters.wsMessages++;
      const data = JSON.parse(raw.toString());

      if (data.type === "PING") {
        ws.send(JSON.stringify({ type: "PONG", time: Date.now() }));
        return;
      }

      // Handle push command from dashboard over WS
      if (data.type === "DISPATCH_COMMAND" && data.clientKey && data.command) {
        const key = cleanKey(data.clientKey);
        const cmd = normalizeIncoming(data.command);
        if (cmd) {
          pushMessage(key, cmd);
        }
      }

      // Handle incoming Minecraft event over WS
      if (data.type === "EVENT_LOG" && data.clientKey && data.event) {
        const key = cleanKey(data.clientKey);
        const ev = data.event;
        const list = events.get(key) || [];
        const item: RelayEvent = {
          time: new Date().toISOString(),
          client: cleanText(ev.client || "Minecraft_WS_Client"),
          version: cleanText(ev.version || "1.0"),
          type: cleanText(ev.type || "LOG").toUpperCase(),
          title: cleanText(ev.title || "Minecraft Event"),
          player: cleanText(ev.player || "Unknown_Player"),
          server: cleanText(ev.server || "Minecraft Server"),
          message: cleanText(ev.message || ""),
        };
        list.push(item);
        while (list.length > MAX_EVENTS) list.shift();
        events.set(key, list);
        persistData();

        broadcastToWs({
          type: "EVENT_RECEIVED",
          clientKey: key,
          event: item,
        });

        // Forward to Discord
        if (appConfig.discordWebhookUrl && shouldForwardToDiscord(item.type)) {
          forwardToDiscord(appConfig.discordWebhookUrl, item, key).then((res) => {
            if (res.ok) {
              discordStats.forwarded++;
              discordStats.lastSent = new Date().toISOString();
            } else {
              discordStats.failed++;
              discordStats.lastError = res.error || "Unknown";
            }
          });
        }
      }
    } catch (err) {
      console.error("[WS] Message error:", err);
    }
  });

  ws.on("close", () => {
    wsClients.delete(ws);
  });
});

// Heartbeat ping interval for WebSockets
setInterval(() => {
  for (const ws of wsClients) {
    if (!ws.isAlive) {
      ws.terminate();
      wsClients.delete(ws);
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
}, 30000);

function broadcastToWs(payload: any) {
  const json = JSON.stringify(payload);
  for (const client of wsClients) {
    if (client.readyState === WebSocket.OPEN && client.role === "dashboard") {
      client.send(json);
    }
  }
}

function notifyMinecraftClientWs(clientKey: string, command: string) {
  const json = JSON.stringify({
    type: "EXECUTE_COMMAND",
    command,
    timestamp: Date.now(),
  });
  for (const client of wsClients) {
    if (
      client.readyState === WebSocket.OPEN &&
      client.role === "minecraft_client" &&
      client.clientKey === clientKey
    ) {
      client.send(json);
    }
  }
}

// ==========================================
// 6. Protected Admin APIs
// ==========================================

app.get("/admin/data", checkAuth, rateLimit(100, 60000), (req: Request, res: Response) => {
  const clientIp = getClientIp(req);
  const allKeys = new Set([...queues.keys(), ...events.keys(), ...clientKeys.keys()]);
  const clientsData: Record<string, { queue: string[]; events: RelayEvent[]; meta?: ClientKeyMetadata }> = {};

  for (const k of allKeys) {
    clientsData[k] = {
      queue: queues.get(k) || [],
      events: events.get(k) || [],
      meta: clientKeys.get(k),
    };
  }

  const mem = process.memoryUsage();
  const uptimeSec = Math.floor(process.uptime());
  const totalDispatches = discordStats.forwarded + discordStats.failed;
  const syncRate =
    totalDispatches > 0 ? ((discordStats.forwarded / totalDispatches) * 100).toFixed(1) : "100.0";

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
      wsConnections: wsClients.size,
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
      embedConfig: appConfig.embedConfig || defaultEmbedConfig,
    },
    clientKeysList: Array.from(clientKeys.values()),
    clientsData,
  });
});

app.post("/admin/settings", checkAuth, rateLimit(30, 60000), (req: Request, res: Response) => {
  const ip = getClientIp(req);
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

  if (typeof body.forwardEventsToDiscord === "boolean")
    appConfig.forwardEventsToDiscord = body.forwardEventsToDiscord;
  if (typeof body.forwardChat === "boolean") appConfig.forwardChat = body.forwardChat;
  if (typeof body.forwardJoinLeave === "boolean")
    appConfig.forwardJoinLeave = body.forwardJoinLeave;
  if (typeof body.forwardDeaths === "boolean") appConfig.forwardDeaths = body.forwardDeaths;
  if (typeof body.forwardCommands === "boolean") appConfig.forwardCommands = body.forwardCommands;

  // Embed Builder Options (II.2)
  if (body.embedConfig && typeof body.embedConfig === "object") {
    appConfig.embedConfig = {
      themeColor: cleanText(body.embedConfig.themeColor || "#00f2fe"),
      authorIcon: cleanText(body.embedConfig.authorIcon || defaultEmbedConfig.authorIcon),
      customTitle: cleanText(body.embedConfig.customTitle || defaultEmbedConfig.customTitle),
      footerText: cleanText(body.embedConfig.footerText || defaultEmbedConfig.footerText),
      showPlayerAvatar:
        typeof body.embedConfig.showPlayerAvatar === "boolean"
          ? body.embedConfig.showPlayerAvatar
          : true,
    };
  }

  persistData();
  addAuditLog(ip, "SETTING_CHANGED", "Cập nhật cài đặt Discord & Embed Builder", "info");

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
      embedConfig: appConfig.embedConfig,
    },
  });
});

// Client Key Management APIs (I.2)
app.get("/admin/keys", checkAuth, (req: Request, res: Response) => {
  res.json({
    ok: true,
    keys: Array.from(clientKeys.values()),
  });
});

app.post("/admin/keys", checkAuth, rateLimit(30, 60000), (req: Request, res: Response) => {
  const ip = getClientIp(req);
  const { key, label, status, notes } = req.body;
  const cleaned = cleanKey(key);
  if (!cleaned) {
    res.status(400).json({ ok: false, error: "Tên Client Key không hợp lệ (Chỉ gồm a-z, 0-9, _, -)" });
    return;
  }

  const existing = clientKeys.get(cleaned);
  const record: ClientKeyMetadata = {
    key: cleaned,
    label: cleanText(label || cleaned),
    createdAt: existing ? existing.createdAt : Date.now(),
    lastSeen: existing ? existing.lastSeen : Date.now(),
    status: status === "disabled" || status === "readonly" ? status : "active",
    notes: cleanText(notes || ""),
  };

  clientKeys.set(cleaned, record);
  persistData();
  addAuditLog(ip, "KEY_SAVED", `Lưu/Cập nhật Client Key: ${cleaned} (${record.label})`, "info");

  res.json({ ok: true, message: "Lưu Client Key thành công!", key: record });
});

app.delete("/admin/keys/:key", checkAuth, (req: Request, res: Response) => {
  const ip = getClientIp(req);
  const targetKey = cleanKey(req.params.key);
  if (clientKeys.has(targetKey)) {
    clientKeys.delete(targetKey);
    queues.delete(targetKey);
    events.delete(targetKey);
    persistData();
    addAuditLog(ip, "KEY_DELETED", `Đã xoá Client Key: ${targetKey}`, "warn");
    res.json({ ok: true, message: `Đã xoá Key ${targetKey}` });
  } else {
    res.status(404).json({ ok: false, error: "Không tìm thấy Key cần xoá" });
  }
});

// Audit Logs API (III.3)
app.get("/admin/audit-logs", checkAuth, rateLimit(60, 60000), (req: Request, res: Response) => {
  const limit = Math.min(parseInt(String(req.query.limit || "100"), 10), MAX_AUDIT_LOGS);
  res.json({
    ok: true,
    total: auditLogs.length,
    logs: auditLogs.slice(-limit).reverse(),
  });
});

// Discord to Minecraft API (II.1)
app.post("/api/discord-to-mc", rateLimit(60, 60000), (req: Request, res: Response) => {
  const ip = getClientIp(req);
  const { clientKey, author, content, channel } = req.body;
  const targetKey = cleanKey(clientKey || "vnlandz_main");
  const authorName = cleanText(author || "DiscordUser");
  const messageText = cleanText(content || "");
  const channelName = cleanText(channel || "general");

  if (!messageText) {
    res.status(400).json({ ok: false, error: "Nội dung tin nhắn không được trống" });
    return;
  }

  // Format Minecraft command
  const formattedCmd = `/tellraw @a [{"text":"[Discord #${channelName}] ","color":"blue"},{"text":"${authorName}: ","color":"aqua","bold":true},{"text":"${messageText}","color":"white"}]`;

  pushMessage(targetKey, formattedCmd);

  // Log in events
  const list = events.get(targetKey) || [];
  list.push({
    time: new Date().toISOString(),
    client: "Discord_Bridge_Inbound",
    version: "2.0",
    type: "CHAT",
    title: `Discord Inbound (#${channelName})`,
    player: authorName,
    server: "Discord Bridge",
    message: messageText,
  });
  while (list.length > MAX_EVENTS) list.shift();
  events.set(targetKey, list);

  persistData();
  addAuditLog(
    ip,
    "DISCORD_TO_MC",
    `Tin nhắn từ Discord (${authorName} -> Key: ${targetKey}): ${messageText}`,
    "info"
  );

  res.json({
    ok: true,
    message: "Đã chuyển tiếp tin nhắn Discord vào Minecraft thành công!",
    queuedCommand: formattedCmd,
  });
});

// Gemini AI Summarizer & Chat Filter APIs (V.5)
let geminiClient: GoogleGenAI | null = null;
function getGemini(): GoogleGenAI {
  if (!geminiClient) {
    const key = process.env.GEMINI_API_KEY;
    if (!key) {
      throw new Error("GEMINI_API_KEY environment variable is required for AI features");
    }
    geminiClient = new GoogleGenAI({ apiKey: key });
  }
  return geminiClient;
}

app.post("/admin/ai/summarize", checkAuth, rateLimit(10, 60000), async (req: Request, res: Response) => {
  const ip = getClientIp(req);
  try {
    const targetKey = cleanKey(req.body.clientKey);
    let targetEvents: RelayEvent[] = [];
    if (targetKey && events.has(targetKey)) {
      targetEvents = events.get(targetKey) || [];
    } else {
      for (const evList of events.values()) {
        targetEvents.push(...evList);
      }
      targetEvents.sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
      targetEvents = targetEvents.slice(-50);
    }

    if (targetEvents.length === 0) {
      res.status(400).json({ ok: false, error: "Chưa có log sự kiện nào để tóm tắt!" });
      return;
    }

    const ai = getGemini();
    const prompt = `Bạn là một chuyên gia quản trị máy chủ Minecraft AI và phân tích Relay Logs.
Hãy phân tích danh sách ${targetEvents.length} sự kiện/chat logs gần nhất dưới đây và đưa ra:
1. 📊 Tóm tắt phiên chơi (Tổng quan hoạt động, số người tham gia, diễn biến chính)
2. ⚔️ Các sự kiện nổi bật (PvP, Tử vong, Boss/Damage, Lệnh quan trọng)
3. ⚠️ Đánh giá an ninh & Cảnh báo (Spam, dấu hiệu bất thường, hành vi cần chú ý)
4. 💡 Đề xuất cho Quản trị viên (Nếu có)

Dữ liệu Logs:
${JSON.stringify(
  targetEvents.map((e) => ({
    time: e.time,
    player: e.player,
    type: e.type,
    server: e.server,
    message: e.message,
  })),
  null,
  2
)}`;

    const response = await ai.models.generateContent({
      model: "gemini-3.7-flash",
      contents: prompt,
    });

    const summaryText = response.text || "Không tạo được phản hồi.";
    addAuditLog(ip, "AI_SUMMARIZE", `Tạo báo cáo tóm tắt AI cho ${targetEvents.length} logs`, "info");

    res.json({
      ok: true,
      summary: summaryText,
      logsAnalyzed: targetEvents.length,
    });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: `AI Summarizer Lỗi: ${err.message}` });
  }
});

app.post("/admin/ai/filter-chat", checkAuth, rateLimit(15, 60000), async (req: Request, res: Response) => {
  try {
    const text = cleanText(req.body.text || "");
    if (!text) {
      res.status(400).json({ ok: false, error: "Nội dung kiểm duyệt không được trống" });
      return;
    }

    const ai = getGemini();
    const prompt = `Bạn là hệ thống kiểm duyệt tự động cho máy chủ Minecraft.
Phân tích tin nhắn sau: "${text}"
Trả về JSON chuẩn với format:
{
  "isSafe": true | false,
  "toxicityScore": 0.0 - 1.0,
  "category": "SAFE" | "SPAM" | "TOXIC" | "LEAK_COORDINATES" | "ADVERTISING",
  "reason": "Lý do ngắn gọn bằng tiếng Việt",
  "suggestedAction": "ALLOW" | "WARN" | "MUTE" | "BLOCK"
}`;

    const response = await ai.models.generateContent({
      model: "gemini-3.7-flash",
      contents: prompt,
      config: { responseMimeType: "application/json" },
    });

    const parsedResult = JSON.parse(response.text || "{}");
    res.json({ ok: true, result: parsedResult });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: `AI Filter Lỗi: ${err.message}` });
  }
});

// Backup & Restore APIs (VI.4)
app.get("/admin/backup", checkAuth, (req: Request, res: Response) => {
  const ip = getClientIp(req);
  const backupData = {
    version: "2.5.0",
    exportedAt: new Date().toISOString(),
    config: appConfig,
    clientKeys: Array.from(clientKeys.values()),
    queues: Object.fromEntries(queues.entries()),
    events: Object.fromEntries(events.entries()),
    auditLogs: auditLogs.slice(-100),
  };
  addAuditLog(ip, "BACKUP_EXPORT", "Xuất file sao lưu hệ thống", "info");
  res.setHeader("Content-Disposition", `attachment; filename="vnlandz_relay_backup_${Date.now()}.json"`);
  res.json(backupData);
});

app.post("/admin/restore", checkAuth, rateLimit(5, 60000), (req: Request, res: Response) => {
  const ip = getClientIp(req);
  try {
    const data = req.body;
    if (!data || typeof data !== "object") {
      res.status(400).json({ ok: false, error: "Dữ liệu khôi phục không hợp lệ!" });
      return;
    }

    if (data.config) {
      Object.assign(appConfig, data.config);
    }
    if (Array.isArray(data.clientKeys)) {
      clientKeys.clear();
      for (const k of data.clientKeys) {
        if (k && k.key) clientKeys.set(k.key, k);
      }
    }
    if (data.queues && typeof data.queues === "object") {
      for (const [k, q] of Object.entries(data.queues)) {
        if (Array.isArray(q)) queues.set(k, q as string[]);
      }
    }
    if (data.events && typeof data.events === "object") {
      for (const [k, ev] of Object.entries(data.events)) {
        if (Array.isArray(ev)) events.set(k, ev as RelayEvent[]);
      }
    }

    persistData();
    addAuditLog(ip, "BACKUP_RESTORE", "Đã khôi phục thành công dữ liệu từ bản sao lưu", "warn");

    res.json({ ok: true, message: "Đã khôi phục cấu hình và trạng thái thành công!" });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: `Khôi phục thất bại: ${err.message}` });
  }
});

app.post("/admin/test-discord", checkAuth, rateLimit(10, 60000), async (req: Request, res: Response) => {
  const body = req.body;
  const targetWebhook = cleanText(
    body.webhookUrl || appConfig.discordWebhookUrl || process.env.DISCORD_WEBHOOK_URL || ""
  );

  if (!targetWebhook || !isValidDiscordWebhook(targetWebhook)) {
    res.status(400).json({ ok: false, error: "Link Discord Webhook không hợp lệ!" });
    return;
  }

  const testEvent: RelayEvent = {
    time: new Date().toISOString(),
    client: "VnlandZ_Relay_Test",
    version: "2.5.0",
    type: "TEST",
    title: "⚡ Kiểm Tra Kết Nối Discord Webhook",
    player: "MinecraftPlayer",
    server: "Relay.Nexus.VN",
    message: "Chúc mừng! Kết nối từ Minecraft Client Relay đến Discord Webhook đã hoạt động an toàn và sắc nét.",
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
  const ip = getClientIp(req);
  const targetKey = cleanKey(req.body.clientKey);
  if (targetKey) {
    queues.set(targetKey, []);
    persistData();
    addAuditLog(ip, "QUEUE_CLEARED", `Xoá hàng đợi cho Client Key: ${targetKey}`, "info");
  }
  res.json({ ok: true, message: `Đã làm sạch hàng đợi cho key ${targetKey}` });
});

// ==========================================
// 7. Public Minecraft Client & Relay APIs
// ==========================================

app.get(["/api/health", "/health"], (req: Request, res: Response) => {
  const mem = process.memoryUsage();
  res.json({
    ok: true,
    service: "VnlandZ Minecraft Relay & Discord Bridge",
    uptimeSeconds: Math.floor(process.uptime()),
    activeClients: queues.size,
    wsConnections: wsClients.size,
    memoryHeapUsedMB: (mem.heapUsed / (1024 * 1024)).toFixed(1),
    security: {
      antiBruteForce: "Enabled (5 max attempts / 15m lockout)",
      rateLimiting: "Active",
      dataMasking: "Strict",
    },
    timestamp: Date.now(),
  });
});

app.get("/poll", rateLimit(180, 60000), (req: Request, res: Response) => {
  requestCounters.polls++;
  const clientKey = extractClientKey(req);
  if (!clientKey) {
    res.status(400).json({ ok: false, error: "Missing clientKey" });
    return;
  }

  touchClientKey(clientKey);
  const queue = queues.get(clientKey) || [];
  const next = queue.shift() || "";
  queues.set(clientKey, queue);
  persistData();

  res.json({
    ok: true,
    clientKey,
    command: next,
    message: next,
    pending: queue.length,
  });
});

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

  const list = events.get(clientKey) || [];
  list.push({
    time: new Date().toISOString(),
    client: "Relay_Dashboard_Bridge",
    version: "2.5",
    type: "COMMAND",
    title: "Relay Command Queued",
    player: "Admin / Discord Bridge",
    server: "Relay Server",
    message: `Lệnh đã được đưa vào hàng đợi: ${normalized}`,
  });
  while (list.length > MAX_EVENTS) list.shift();
  events.set(clientKey, list);
  persistData();

  res.json({
    ok: true,
    queued: true,
    clientKey,
    command: normalized,
    pending: queue.length,
  });
});

app.post(["/events", "/push"], rateLimit(120, 60000), (req: Request, res: Response) => {
  requestCounters.events++;
  const clientKey = extractClientKey(req);
  if (!clientKey) {
    res.status(400).json({ ok: false, error: "Missing clientKey header hoặc query param" });
    return;
  }

  touchClientKey(clientKey);
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
  persistData();

  // Broadcast to WS dashboards
  broadcastToWs({
    type: "EVENT_RECEIVED",
    clientKey,
    event: eventItem,
  });

  const incomingCmd = normalizeIncoming(body.command || (body.autoQueue ? body.message : ""));
  if (incomingCmd && body.autoQueue) {
    pushMessage(clientKey, incomingCmd);
  }

  let discordResult: { forwarded: boolean; target?: string } = { forwarded: false };
  const customWebhook = cleanText(
    (req.headers["x-discord-webhook"] as string) || body.discordWebhook || body.webhookUrl || ""
  );
  const targetWebhook =
    customWebhook || appConfig.discordWebhookUrl || process.env.DISCORD_WEBHOOK_URL;

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

app.all("/clear", checkAuth, (req: Request, res: Response) => {
  const clientKey = extractClientKey(req);
  if (clientKey) {
    queues.set(clientKey, []);
    events.set(clientKey, []);
    persistData();
  }
  res.json({ ok: true, message: "Cleared", clientKey });
});

// Static assets & PWA manifest
app.get("/manifest.json", (req: Request, res: Response) => {
  res.sendFile(path.join(process.cwd(), "public", "manifest.json"));
});

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

app.get("*", (req: Request, res: Response) => {
  res.sendFile(path.join(process.cwd(), "index.html"));
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(
    `[VnlandZ Minecraft Relay & Discord Bridge] Server running securely with WebSockets on http://0.0.0.0:${PORT}`
  );
});
