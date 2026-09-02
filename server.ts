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

export interface StaffAccount {
  username: string;
  role: "admin" | "mod";
  displayName: string;
  avatarUrl: string;
  pass: string;
  description: string;
}

export interface MaintenanceConfig {
  enabled: boolean;
  message: string;
  startTime: number | null;
  endTime: number | null;
  durationMinutes: number;
  activatedBy: string;
  allowStaffBypass: boolean;
}

export interface RbacPermission {
  code: string;
  name: string;
  description: string;
  admin: boolean;
  mod: boolean;
  risk: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
}

export interface PlayerStats {
  player: string;
  avatarUrl: string;
  totalMessages: number;
  totalDeaths: number;
  totalJoins: number;
  totalLeaves: number;
  totalCommands: number;
  totalEvents: number;
  onlineDurationSeconds: number;
  firstSeen: string;
  lastSeen: string;
  lastServer: string;
  killCount: number;
  damageCount: number;
  warningCount: number;
  activeSessionStart?: number;
}

export interface AppConfig {
  discordWebhookUrl: string;
  forwardEventsToDiscord: boolean;
  forwardChat: boolean;
  forwardJoinLeave: boolean;
  forwardDeaths: boolean;
  forwardCommands: boolean;
  embedConfig: EmbedConfig;
  discordToMcFormat?: "client_chat" | "tellraw" | "say";
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
  ip?: string;
}

export interface ClientKeyMetadata {
  key: string;
  label: string;
  createdAt: number;
  lastSeen: number;
  status: "active" | "disabled" | "readonly";
  notes?: string;
  lastIp?: string;
  recentIps?: string[];
  activePlayers?: string[];
  lastPlayer?: string;
  totalEvents?: number;
  totalPolls?: number;
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
const playerStatsMap: Map<string, PlayerStats> =
  (globalThis as any).__vnlandzPlayerStats || new Map();
const auditLogs: AuditLogItem[] = (globalThis as any).__vnlandzAuditLogs || [];
interface SessionData {
  username: string;
  role: "admin" | "mod";
  displayName: string;
  avatarUrl: string;
  createdAt: number;
  expiresAt: number;
}

const sessions: Map<string, SessionData> =
  (globalThis as any).__vnlandzSessions || new Map();

const maintenanceState: MaintenanceConfig = (globalThis as any).__vnlandzMaintenance || {
  enabled: false,
  message: "Hệ thống VnlandZ Minecraft Relay đang trong đợt bảo trì nâng cấp định kỳ.",
  startTime: null,
  endTime: null,
  durationMinutes: 30,
  activatedBy: "",
  allowStaffBypass: true,
};

// Built-in Staff Accounts with explicit passwords & RBAC roles
const BUILT_IN_STAFF: Record<string, StaffAccount> = {
  admin: {
    username: "admin",
    role: "admin",
    displayName: "Tổng Quản Trị (Super Admin)",
    avatarUrl: "https://mc-heads.net/avatar/MHF_Steve/128",
    pass: process.env.ADMIN_PASS || "admin1234",
    description: "Toàn quyền cấu hình máy chủ, quản lý keys, lệnh dispatch và chế độ bảo trì.",
  },
  admin2: {
    username: "admin2",
    role: "admin",
    displayName: "Phó Quản Trị 2 (Admin 2)",
    avatarUrl: "https://mc-heads.net/avatar/MHF_Alex/128",
    pass: "admin2222",
    description: "Quản trị viên phụ - Toàn quyền cấu hình, điều hành và xử lý sự cố.",
  },
  admin3: {
    username: "admin3",
    role: "admin",
    displayName: "Phó Quản Trị 3 (Admin 3)",
    avatarUrl: "https://mc-heads.net/avatar/MHF_Herobrine/128",
    pass: "admin3333",
    description: "Quản trị viên phụ - Toàn quyền cấu hình, điều hành và giám sát cầu nối.",
  },
  mod1: {
    username: "mod1",
    role: "mod",
    displayName: "Kiểm Soát Viên 1 (Mod 1)",
    avatarUrl: "https://mc-heads.net/avatar/mod1/128",
    pass: "e93ke0",
    description: "Kiểm soát viên cấp 1 - Chỉ xem dữ liệu sự kiện, bảng xếp hạng và nhật ký (Read-only).",
  },
  mod2: {
    username: "mod2",
    role: "mod",
    displayName: "Kiểm Soát Viên 2 (Mod 2)",
    avatarUrl: "https://mc-heads.net/avatar/mod2/128",
    pass: "38fj9d2",
    description: "Kiểm soát viên cấp 2 - Chỉ xem dữ liệu sự kiện, bảng xếp hạng và nhật ký (Read-only).",
  },
  mod3: {
    username: "mod3",
    role: "mod",
    displayName: "Kiểm Soát Viên 3 (Mod 3)",
    avatarUrl: "https://mc-heads.net/avatar/mod3/128",
    pass: "feoa9d3",
    description: "Kiểm soát viên cấp 3 - Chỉ xem dữ liệu sự kiện, bảng xếp hạng và nhật ký (Read-only).",
  },
  mod4: {
    username: "mod4",
    role: "mod",
    displayName: "Kiểm Soát Viên 4 (Mod 4)",
    avatarUrl: "https://mc-heads.net/avatar/mod4/128",
    pass: "39kfe3re",
    description: "Kiểm soát viên cấp 4 - Chỉ xem dữ liệu sự kiện, bảng xếp hạng và nhật ký (Read-only).",
  },
  mod5: {
    username: "mod5",
    role: "mod",
    displayName: "Kiểm Soát Viên 5 (Mod 5)",
    avatarUrl: "https://mc-heads.net/avatar/mod5/128",
    pass: "38jfa32d",
    description: "Kiểm soát viên cấp 5 - Chỉ xem dữ liệu sự kiện, bảng xếp hạng và nhật ký (Read-only).",
  },
};

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

const DEFAULT_RBAC_MATRIX: RbacPermission[] = [
  {
    code: "VIEW_EVENTS",
    name: "Xem Console & Dữ Liệu Sự Kiện Real-time",
    description: "Truy cập giao diện console, xem log sự kiện và tin nhắn chat theo thời gian thực.",
    admin: true,
    mod: true,
    risk: "LOW",
  },
  {
    code: "VIEW_LEADERBOARDS",
    name: "Xem BXH Hoạt Động & Thống Kê Người Chơi",
    description: "Xem xếp hạng người chơi nói nhiều nhất, tử vong, thời gian online, PvP kills.",
    admin: true,
    mod: true,
    risk: "LOW",
  },
  {
    code: "VIEW_KEYS",
    name: "Xem Danh Sách Client Keys & Trạng Thái",
    description: "Xem các key kết nối Minecraft client và thời gian hoạt động gần nhất.",
    admin: true,
    mod: true,
    risk: "LOW",
  },
  {
    code: "VIEW_LOGS",
    name: "Xem Biểu Đồ Analytics & Audit Logs",
    description: "Xem biểu đồ telemetry, nhật ký kiểm toán hệ thống và lưu lượng mạng.",
    admin: true,
    mod: true,
    risk: "LOW",
  },
  {
    code: "AI_STUDIO",
    name: "Sử Dụng AI Gemini Summarizer & Chat Filter",
    description: "Gọi AI để tóm tắt phiên chơi hoặc kiểm duyệt nội dung độc hại.",
    admin: true,
    mod: true,
    risk: "MEDIUM",
  },
  {
    code: "SEND_COMMAND",
    name: "Gửi Lệnh / Command Dispatcher Vào Máy Chủ",
    description: "Đưa lệnh Minecraft vào hàng đợi để client thực thi trên máy chủ.",
    admin: true,
    mod: false,
    risk: "HIGH",
  },
  {
    code: "MANAGE_KEYS",
    name: "Thêm, Sửa, Vô Hiệu Hóa, Xoá Client Keys",
    description: "Quản lý toàn bộ danh sách Client Keys kết nối.",
    admin: true,
    mod: false,
    risk: "HIGH",
  },
  {
    code: "EDIT_SETTINGS",
    name: "Thay Đổi Cấu Hình Discord Webhook & Embed",
    description: "Cập nhật link webhook Discord, mẫu Embed và bộ lọc sự kiện.",
    admin: true,
    mod: false,
    risk: "HIGH",
  },
  {
    code: "TOGGLE_MAINTENANCE",
    name: "Bật / Tắt Chế Độ Bảo Trì 1-Chạm (Lockdown)",
    description: "Kích hoạt hoặc gỡ bỏ trạng thái bảo trì hệ thống toàn cầu.",
    admin: true,
    mod: false,
    risk: "HIGH",
  },
  {
    code: "RESET_DATA",
    name: "Xoá Hàng Đợi Lệnh / Reset BXH Hoạt Động",
    description: "Xoá sạch hàng đợi hoặc đặt lại toàn bộ bảng thống kê người chơi về 0.",
    admin: true,
    mod: false,
    risk: "CRITICAL",
  },
  {
    code: "BACKUP_RESTORE",
    name: "Sao Lưu & Khôi Phục Dữ Liệu Toàn Cục (.json)",
    description: "Tải file backup JSON hoặc ghi đè trạng thái hệ thống từ file sao lưu.",
    admin: true,
    mod: false,
    risk: "CRITICAL",
  },
];

let rbacMatrix: RbacPermission[] =
  (globalThis as any).__vnlandzRbacMatrix || JSON.parse(JSON.stringify(DEFAULT_RBAC_MATRIX));
(globalThis as any).__vnlandzRbacMatrix = rbacMatrix;

function hasPermission(role: "admin" | "mod", code: string): boolean {
  const perm = rbacMatrix.find((p) => p.code === code);
  if (!perm) return role === "admin";
  return role === "admin" ? perm.admin : perm.mod;
}

function getMaintenanceStatus() {
  const now = Date.now();
  let remainingSeconds = 0;
  if (maintenanceState.enabled && maintenanceState.endTime && maintenanceState.endTime > now) {
    remainingSeconds = Math.max(0, Math.floor((maintenanceState.endTime - now) / 1000));
  } else if (maintenanceState.enabled && maintenanceState.endTime && maintenanceState.endTime <= now) {
    maintenanceState.enabled = false;
    maintenanceState.startTime = null;
    maintenanceState.endTime = null;
    maintenanceState.activatedBy = "";
    persistData();
  }
  return {
    ...maintenanceState,
    active: maintenanceState.enabled,
    remainingSeconds,
    serverTime: now,
  };
}

(globalThis as any).__vnlandzQueues = queues;
(globalThis as any).__vnlandzEvents = events;
(globalThis as any).__vnlandzClientKeys = clientKeys;
(globalThis as any).__vnlandzPlayerStats = playerStatsMap;
(globalThis as any).__vnlandzAuditLogs = auditLogs;
(globalThis as any).__vnlandzSessions = sessions;
(globalThis as any).__vnlandzDiscordStats = discordStats;
(globalThis as any).__vnlandzConfig = appConfig;
(globalThis as any).__vnlandzCounters = requestCounters;
(globalThis as any).__vnlandzLoginAttempts = loginAttempts;
(globalThis as any).__vnlandzRateLimits = rateLimits;
(globalThis as any).__vnlandzMaintenance = maintenanceState;

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

// Player Statistics & Leaderboard Processing Engine
function trackPlayerEvent(event: RelayEvent) {
  const rawPlayer = event.player && event.player !== "Unknown_Player" ? event.player.trim() : "";
  if (!rawPlayer || rawPlayer === "Minecraft Client" || rawPlayer === "Admin / Discord Bridge") {
    return;
  }

  const cleanPlayerName = rawPlayer.replace(/[^\w\s\-_.]/g, "").trim();
  if (!cleanPlayerName) return;

  const nowTime = new Date().toISOString();
  const nowMs = Date.now();

  let stat = playerStatsMap.get(cleanPlayerName);
  if (!stat) {
    stat = {
      player: cleanPlayerName,
      avatarUrl: `https://mc-heads.net/avatar/${encodeURIComponent(cleanPlayerName)}/128`,
      totalMessages: 0,
      totalDeaths: 0,
      totalJoins: 0,
      totalLeaves: 0,
      totalCommands: 0,
      totalEvents: 0,
      onlineDurationSeconds: 0,
      firstSeen: nowTime,
      lastSeen: nowTime,
      lastServer: event.server || "Minecraft Server",
      killCount: 0,
      damageCount: 0,
      warningCount: 0,
      activeSessionStart: nowMs,
    };
  }

  stat.totalEvents++;
  stat.lastSeen = nowTime;
  if (event.server) stat.lastServer = event.server;

  const typeUpper = (event.type || "LOG").toUpperCase();
  const msg = (event.message || "").toLowerCase();

  if (typeUpper === "CHAT") {
    stat.totalMessages++;
  } else if (typeUpper === "JOIN") {
    stat.totalJoins++;
    stat.activeSessionStart = nowMs;
  } else if (typeUpper === "LEAVE") {
    stat.totalLeaves++;
    if (stat.activeSessionStart) {
      const sessionSecs = Math.max(10, Math.floor((nowMs - stat.activeSessionStart) / 1000));
      stat.onlineDurationSeconds += sessionSecs;
      stat.activeSessionStart = undefined;
    }
  } else if (typeUpper === "DEATH") {
    stat.totalDeaths++;
  } else if (typeUpper === "COMMAND" || typeUpper === "REPLAY") {
    stat.totalCommands++;
  } else if (typeUpper === "DAMAGE") {
    stat.damageCount++;
  }

  // Detect kills & warnings from text context
  if (msg.includes("slain by") || msg.includes("killed by") || msg.includes("shot by")) {
    if (msg.includes(cleanPlayerName.toLowerCase())) {
      stat.killCount++;
    }
  }
  if (msg.includes("warning") || msg.includes("cảnh cáo") || msg.includes("kicked") || msg.includes("muted")) {
    stat.warningCount++;
  }

  // Auto-accumulate live playtime for active sessions
  if (stat.activeSessionStart) {
    const elapsed = Math.floor((nowMs - stat.activeSessionStart) / 1000);
    if (elapsed > 0 && elapsed < 86400) {
      stat.onlineDurationSeconds += Math.min(elapsed, 30);
      stat.activeSessionStart = nowMs;
    }
  }

  playerStatsMap.set(cleanPlayerName, stat);
  persistData();
}

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
      if (parsed.auditLogs && Array.isArray(parsed.auditLogs)) {
        auditLogs.length = 0;
        auditLogs.push(...parsed.auditLogs.slice(-MAX_AUDIT_LOGS));
      }
      if (parsed.playerStats && typeof parsed.playerStats === "object") {
        playerStatsMap.clear();
        for (const [p, st] of Object.entries(parsed.playerStats)) {
          if (st && typeof st === "object") {
            playerStatsMap.set(p, st as PlayerStats);
          }
        }
      }
      if (parsed.discordStats) {
        Object.assign(discordStats, parsed.discordStats);
      }
      if (parsed.maintenance) {
        Object.assign(maintenanceState, parsed.maintenance);
      }
      if (parsed.rbacMatrix && Array.isArray(parsed.rbacMatrix)) {
        for (const item of parsed.rbacMatrix) {
          const existing = rbacMatrix.find((p) => p.code === item.code);
          if (existing) {
            if (typeof item.admin === "boolean") existing.admin = item.admin;
            if (typeof item.mod === "boolean") existing.mod = item.mod;
          }
        }
      }
      console.log("[Persistence] Successfully loaded stored state from data/store.json");
    }
  } catch (err) {
    console.error("[Persistence] Error loading data/store.json:", err);
  }

  // Pre-seed user's actual Minecraft Client Key if not present
  if (!clientKeys.has("Vz9Qm4Tn7Lp2KxA")) {
    clientKeys.set("Vz9Qm4Tn7Lp2KxA", {
      key: "Vz9Qm4Tn7Lp2KxA",
      label: "Minecraft Replay Mod (Vz9Qm4Tn7Lp2KxA)",
      createdAt: Date.now(),
      lastSeen: Date.now(),
      status: "active",
      notes: "Client Key kết nối trực tiếp với Mod Minecraft / Replay",
    });
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
        playerStats: Object.fromEntries(playerStatsMap.entries()),
        auditLogs: auditLogs.slice(-MAX_AUDIT_LOGS),
        discordStats,
        maintenance: maintenanceState,
        rbacMatrix,
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

// Global URL normalization (Vercel Serverless / Proxy rewrites support)
app.use((req: Request, res: Response, next: NextFunction) => {
  requestCounters.totalHttp++;

  const headers = req.headers || {};
  const rawUrl = req.url || "/";
  const initialUrl = rawUrl;

  if (rawUrl === "/api/index.ts" || rawUrl.startsWith("/api/index.ts") || rawUrl === "/api/index" || rawUrl.startsWith("/api/index")) {
    const candidateHeaders = [
      headers["x-vercel-matched-path"],
      headers["x-forwarded-uri"],
      headers["x-real-url"],
      headers["x-original-url"],
      headers["x-original-uri"],
      headers["x-rewrite-url"],
      headers["x-invoke-path"],
    ];

    let resolved = "";
    for (const h of candidateHeaders) {
      if (typeof h === "string" && h.trim() && !h.startsWith("/api/index")) {
        resolved = h.trim();
        break;
      }
    }

    if (resolved) {
      const query = rawUrl.includes("?") && !resolved.includes("?") ? rawUrl.substring(rawUrl.indexOf("?")) : "";
      req.url = resolved + query;
    } else {
      const query = rawUrl.includes("?") ? rawUrl.substring(rawUrl.indexOf("?")) : "";
      const stripped = rawUrl.split("?")[0].replace(/^\/api\/index(\.ts)?/, "").trim();
      req.url = (stripped || "/") + query;
    }
  }

  if (req.url !== initialUrl) {
    (req as any)._parsedUrl = undefined;
    (req as any)._parsedOriginalUrl = undefined;
  }

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
    "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' https://mc-heads.net https://textures.minecraft.net https://crafatar.com https://minotar.net https://raw.githubusercontent.com data: blob:; media-src 'self' data: blob:; connect-src 'self' https://cdn.jsdelivr.net https://discord.com https://mc-heads.net https://textures.minecraft.net https://crafatar.com https://minotar.net wss: ws:; frame-ancestors 'self' *;"
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

function touchClientKey(key: string, ip?: string, player?: string, action?: "event" | "poll") {
  if (!key) return;
  let existing = clientKeys.get(key);
  if (!existing) {
    existing = {
      key,
      label: key,
      createdAt: Date.now(),
      lastSeen: Date.now(),
      status: "active",
      lastIp: ip || "",
      recentIps: ip ? [ip] : [],
      activePlayers: player && player !== "Unknown_Player" && player !== "Minecraft_Player" ? [player] : [],
      lastPlayer: player || "",
      totalEvents: action === "event" ? 1 : 0,
      totalPolls: action === "poll" ? 1 : 0,
    };
    clientKeys.set(key, existing);
  } else {
    existing.lastSeen = Date.now();
    if (ip) {
      existing.lastIp = ip;
      if (!existing.recentIps) existing.recentIps = [];
      if (!existing.recentIps.includes(ip)) {
        existing.recentIps.unshift(ip);
        if (existing.recentIps.length > 5) existing.recentIps.pop();
      }
    }
    if (player && player !== "Unknown_Player" && player !== "Minecraft_Player" && player !== "Client" && player !== "Minecraft Client") {
      existing.lastPlayer = player;
      if (!existing.activePlayers) existing.activePlayers = [];
      if (!existing.activePlayers.includes(player)) {
        existing.activePlayers.unshift(player);
        if (existing.activePlayers.length > 10) existing.activePlayers.pop();
      }
    }
    if (action === "event") existing.totalEvents = (existing.totalEvents || 0) + 1;
    if (action === "poll") existing.totalPolls = (existing.totalPolls || 0) + 1;
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
  const queryKey = req.query?.clientKey || req.query?.key;
  const headerKey = req.headers["x-vnlandz-client-key"];
  const bodyKey = req.body && typeof req.body === "object" ? (req.body.clientKey || req.body.key) : "";
  const key = cleanKey(queryKey || headerKey || bodyKey);
  if (key) return key;
  // If only 1 client key exists, use it as fallback
  if (clientKeys.size > 0) {
    return Array.from(clientKeys.keys())[0];
  }
  return "vnlandz_main";
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

app.post(["/", "/login", "/api/login", "/api/auth/login", "/api/index.ts", "/api/index"], (req: Request, res: Response) => {
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

  const usernameInput = String(req.body.username || "").trim();
  const passwordInput = String(req.body.password || "").trim();

  // Find staff account (case-insensitive username check)
  const matchedKey = Object.keys(BUILT_IN_STAFF).find(
    (k) => k.toLowerCase() === usernameInput.toLowerCase()
  );
  const staff = matchedKey ? BUILT_IN_STAFF[matchedKey] : null;

  let isValid = false;
  if (staff) {
    if (staff.role === "admin") {
      // Admin account: ONLY this admin's password or master ADMIN_PASS can log in.
      // Mod passwords CAN NEVER log into an admin account!
      isValid = timingSafeCompare(passwordInput, staff.pass) || timingSafeCompare(passwordInput, ADMIN_PASS);
    } else {
      // Mod account (mod1..mod5):
      // 1. Mod's own password
      // 2. OR ANY Admin account password (master ADMIN_PASS, admin1234, admin2222, admin3333)
      const isModOwnPass = timingSafeCompare(passwordInput, staff.pass);
      const isMasterAdminPass = timingSafeCompare(passwordInput, ADMIN_PASS);
      const isAdminStaffPass = Object.values(BUILT_IN_STAFF)
        .filter((s) => s.role === "admin")
        .some((adminStaff) => timingSafeCompare(passwordInput, adminStaff.pass));

      isValid = isModOwnPass || isMasterAdminPass || isAdminStaffPass;
    }
  } else if (timingSafeCompare(usernameInput, ADMIN_USER) && timingSafeCompare(passwordInput, ADMIN_PASS)) {
    isValid = true;
  }

  if (isValid) {
    loginAttempts.delete(ip);

    const effectiveUser = staff?.username || usernameInput;
    const effectiveRole = staff?.role || "admin";
    const effectiveDisplayName = staff?.displayName || (effectiveRole === "admin" ? "Quản Trị Viên" : "Kiểm Soát Viên");
    const effectiveAvatar =
      staff?.avatarUrl || `https://mc-heads.net/avatar/${encodeURIComponent(effectiveUser)}/128`;

    const token = "vnz_sec_" + crypto.randomBytes(32).toString("hex");
    const expiresAt = now + SESSION_TTL_MS;
    sessions.set(token, {
      username: effectiveUser,
      role: effectiveRole,
      displayName: effectiveDisplayName,
      avatarUrl: effectiveAvatar,
      createdAt: now,
      expiresAt,
    });

    res.setHeader(
      "Set-Cookie",
      `admin_token=${token}; Path=/; HttpOnly; SameSite=None; Secure; Max-Age=${
        SESSION_TTL_MS / 1000
      }`
    );

    addAuditLog(
      ip,
      "LOGIN_SUCCESS",
      `Đăng nhập thành công: ${effectiveDisplayName} (${effectiveUser}) [Vai trò: ${effectiveRole.toUpperCase()}]`,
      "info"
    );

    res.json({
      ok: true,
      token,
      user: {
        username: effectiveUser,
        role: effectiveRole,
        displayName: effectiveDisplayName,
        avatarUrl: effectiveAvatar,
      },
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
    `Sai thông tin đăng nhập (Tài khoản thử: ${usernameInput}, Lần thử: ${currentCount}/5)`,
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

app.post("/admin/switch-account", checkAuth, (req: Request, res: Response) => {
  const ip = getClientIp(req);
  const currentUser = (req as any).user;
  const targetUsername = String(req.body.targetUsername || "").trim();

  const matchedKey = Object.keys(BUILT_IN_STAFF).find(
    (k) => k.toLowerCase() === targetUsername.toLowerCase()
  );
  const targetStaff = matchedKey ? BUILT_IN_STAFF[matchedKey] : null;

  if (!targetStaff) {
    res.status(404).json({ ok: false, error: "Không tìm thấy tài khoản nhân viên chỉ định!" });
    return;
  }

  // Rule: Admin can switch to ANY mod account or any admin account.
  // Mod CANNOT switch to an Admin account!
  if (currentUser.role === "mod" && targetStaff.role === "admin") {
    addAuditLog(
      ip,
      "RBAC_BLOCKED",
      `Tài khoản Moderator '${currentUser.username}' bị chặn khi cố gắng chiếm quyền Admin '${targetStaff.username}'`,
      "security"
    );
    res.status(403).json({
      ok: false,
      error: "BỊ TỪ CHỐI: Tài khoản Kiểm Soát Viên (Mod) KHÔNG ĐƯỢC PHÉP chuyển sang tài khoản Quản Trị Viên (Admin)!",
    });
    return;
  }

  const now = Date.now();
  const token = "vnz_sec_" + crypto.randomBytes(32).toString("hex");
  const expiresAt = now + SESSION_TTL_MS;
  sessions.set(token, {
    username: targetStaff.username,
    role: targetStaff.role,
    displayName: targetStaff.displayName,
    avatarUrl: targetStaff.avatarUrl,
    createdAt: now,
    expiresAt,
  });

  res.setHeader(
    "Set-Cookie",
    `admin_token=${token}; Path=/; HttpOnly; SameSite=None; Secure; Max-Age=${SESSION_TTL_MS / 1000}`
  );

  addAuditLog(
    ip,
    "ACCOUNT_SWITCH",
    `Chuyển đổi phiên đăng nhập từ '${currentUser.username}' sang '${targetStaff.username}' [Vai trò: ${targetStaff.role.toUpperCase()}]`,
    "info"
  );

  res.json({
    ok: true,
    token,
    user: {
      username: targetStaff.username,
      role: targetStaff.role,
      displayName: targetStaff.displayName,
      avatarUrl: targetStaff.avatarUrl,
    },
    message: `Đã chuyển đổi thành công sang tài khoản ${targetStaff.displayName} (${targetStaff.username})!`,
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

// Middleware for Authenticated Staff (Admin or Moderator)
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

  if (session) {
    (req as any).user = {
      username: session.username,
      role: session.role,
      displayName: session.displayName,
      avatarUrl: session.avatarUrl,
    };
  }

  next();
}

// Middleware for Dynamic RBAC Permission Check
function requirePermission(permCode: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = (req as any).user;
    if (!user) {
      res.status(401).json({ ok: false, error: "Chưa xác thực danh tính" });
      return;
    }
    if (!hasPermission(user.role, permCode)) {
      const ip = getClientIp(req);
      const permObj = rbacMatrix.find((p) => p.code === permCode);
      const permName = permObj ? permObj.name : permCode;
      addAuditLog(
        ip,
        "RBAC_DENIED",
        `Tài khoản '${user.username}' [Vai trò: ${user.role.toUpperCase()}] bị từ chối quyền: ${permName} (${permCode})`,
        "warn"
      );
      res.status(403).json({
        ok: false,
        error: `Từ chối truy cập: Bạn không có quyền '${permName}' (${permCode}). Vui lòng liên hệ Quản Trị Viên (Admin) để cấp quyền!`,
      });
      return;
    }
    next();
  };
}

// Legacy helper for Admin-Only Write Operations
function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const user = (req as any).user;
  if (!user || user.role !== "admin") {
    const ip = getClientIp(req);
    addAuditLog(
      ip,
      "RBAC_BLOCKED",
      `Tài khoản Moderator '${user?.username || "Ẩn danh"}' bị chặn khi cố gắng thao tác ghi (${req.method} ${req.path})`,
      "warn"
    );
    res.status(403).json({
      ok: false,
      error: `Từ chối truy cập: Tài khoản '${user?.username || "Moderator"}' chỉ có quyền XEM DỮ LIỆU (Read-only). Hành động này yêu cầu quyền Quản Trị Viên (Admin)!`,
    });
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
        const token = cleanText(data.token || "");
        const session = token ? sessions.get(token) : null;
        if (session && session.role === "mod") {
          ws.send(
            JSON.stringify({
              type: "COMMAND_ERROR",
              error: "Tài khoản Moderator chỉ có quyền xem dữ liệu (Read-only), không thể gửi lệnh!",
            })
          );
          return;
        }
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
        trackPlayerEvent(item);
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
// 6. Protected Admin APIs & RBAC Management
// ==========================================

// Current Staff Profile & Permissions
app.get("/admin/me", checkAuth, (req: Request, res: Response) => {
  const user = (req as any).user;
  const role = user.role as "admin" | "mod";
  res.json({
    ok: true,
    user: {
      username: user.username,
      role: user.role,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      permissions: {
        canViewDashboard: hasPermission(role, "VIEW_EVENTS"),
        canViewLeaderboards: hasPermission(role, "VIEW_LEADERBOARDS"),
        canViewLogs: hasPermission(role, "VIEW_LOGS"),
        canViewKeys: hasPermission(role, "VIEW_KEYS"),
        canSendCommand: hasPermission(role, "SEND_COMMAND"),
        canManageKeys: hasPermission(role, "MANAGE_KEYS"),
        canEditSettings: hasPermission(role, "EDIT_SETTINGS"),
        canToggleMaintenance: hasPermission(role, "TOGGLE_MAINTENANCE"),
        canClearQueue: hasPermission(role, "RESET_DATA"),
        canResetStats: hasPermission(role, "RESET_DATA"),
        canBackupRestore: hasPermission(role, "BACKUP_RESTORE"),
        canUseAi: hasPermission(role, "AI_STUDIO"),
      },
    },
    maintenance: getMaintenanceStatus(),
  });
});

// Staff Accounts Directory & RBAC Matrix
app.get("/admin/staff", checkAuth, (req: Request, res: Response) => {
  const staffList = Object.values(BUILT_IN_STAFF).map((s) => ({
    username: s.username,
    role: s.role,
    displayName: s.displayName,
    avatarUrl: s.avatarUrl,
    description: s.description,
  }));

  res.json({
    ok: true,
    currentUser: (req as any).user,
    staff: staffList,
    matrix: rbacMatrix,
  });
});

// GET dynamic RBAC Matrix
app.get("/admin/rbac/matrix", checkAuth, (req: Request, res: Response) => {
  res.json({
    ok: true,
    matrix: rbacMatrix,
  });
});

// SAVE dynamic RBAC Matrix (Editable permissions for Admin and Mod)
app.post("/admin/rbac/matrix", checkAuth, requirePermission("EDIT_SETTINGS"), rateLimit(30, 60000), (req: Request, res: Response) => {
  const ip = getClientIp(req);
  const matrixInput = req.body.matrix;

  if (!Array.isArray(matrixInput)) {
    res.status(400).json({ ok: false, error: "Dữ liệu ma trận phân quyền không hợp lệ!" });
    return;
  }

  for (const item of matrixInput) {
    if (item && typeof item.code === "string") {
      const existing = rbacMatrix.find((p) => p.code === item.code);
      if (existing) {
        if (typeof item.admin === "boolean") existing.admin = item.admin;
        if (typeof item.mod === "boolean") existing.mod = item.mod;
      }
    }
  }

  persistData();
  addAuditLog(ip, "RBAC_MATRIX_UPDATED", "Cập nhật cài đặt Ma Trận Cấp Quyền & Phân Quyền (RBAC Matrix)", "warn");

  broadcastToWs({
    type: "RBAC_MATRIX_UPDATED",
    matrix: rbacMatrix,
  });

  res.json({
    ok: true,
    message: "Đã lưu cài đặt Ma Trận Cấp Quyền (RBAC Matrix) thành công!",
    matrix: rbacMatrix,
  });
});

// RESET dynamic RBAC Matrix to default
app.post("/admin/rbac/reset", checkAuth, requirePermission("EDIT_SETTINGS"), rateLimit(10, 60000), (req: Request, res: Response) => {
  const ip = getClientIp(req);
  rbacMatrix = JSON.parse(JSON.stringify(DEFAULT_RBAC_MATRIX));
  (globalThis as any).__vnlandzRbacMatrix = rbacMatrix;

  persistData();
  addAuditLog(ip, "RBAC_MATRIX_RESET", "Đã khôi phục Ma Trận Phân Quyền (RBAC Matrix) về mặc định ban đầu", "info");

  broadcastToWs({
    type: "RBAC_MATRIX_UPDATED",
    matrix: rbacMatrix,
  });

  res.json({
    ok: true,
    message: "Đã khôi phục Ma Trận Cấp Quyền về mặc định thành công!",
    matrix: rbacMatrix,
  });
});

// Public Maintenance Status
app.get(["/api/maintenance", "/api/maintenance/status", "/maintenance"], (req: Request, res: Response) => {
  res.json({
    ok: true,
    maintenance: getMaintenanceStatus(),
  });
});

// 1-Click Maintenance Mode Toggle (Admin-Only)
app.post("/admin/maintenance", checkAuth, requirePermission("TOGGLE_MAINTENANCE"), rateLimit(30, 60000), (req: Request, res: Response) => {
  const ip = getClientIp(req);
  const user = (req as any).user;
  const body = req.body || {};

  let isEnabled: boolean;
  if (typeof body.active === "boolean") {
    isEnabled = body.active;
  } else if (typeof body.enabled === "boolean") {
    isEnabled = body.enabled;
  } else {
    isEnabled = !maintenanceState.enabled;
  }

  const dur =
    typeof body.minutes === "number" && body.minutes > 0
      ? body.minutes
      : typeof body.durationMinutes === "number" && body.durationMinutes > 0
      ? body.durationMinutes
      : maintenanceState.durationMinutes || 30;

  const msg =
    typeof body.reason === "string" && body.reason.trim()
      ? cleanText(body.reason)
      : typeof body.message === "string" && body.message.trim()
      ? cleanText(body.message)
      : maintenanceState.message;

  const now = Date.now();

  maintenanceState.enabled = isEnabled;
  if (isEnabled) {
    maintenanceState.startTime = now;
    maintenanceState.durationMinutes = dur;
    maintenanceState.endTime =
      typeof body.endTime === "number" && body.endTime > now ? body.endTime : now + dur * 60 * 1000;
    maintenanceState.activatedBy = user?.displayName || user?.username || "Admin";
    maintenanceState.message = msg || "Hệ thống VnlandZ Minecraft Relay đang trong đợt bảo trì nâng cấp định kỳ.";

    addAuditLog(
      ip,
      "MAINTENANCE_ENABLED",
      `Quản trị viên ${user?.username} đã KÍCH HOẠT Chế độ Bảo trì (${dur} phút): "${maintenanceState.message}"`,
      "warn"
    );
  } else {
    maintenanceState.startTime = null;
    maintenanceState.endTime = null;
    maintenanceState.activatedBy = "";

    addAuditLog(
      ip,
      "MAINTENANCE_DISABLED",
      `Quản trị viên ${user?.username} đã TẮT Chế độ Bảo trì, mở lại toàn bộ hệ thống`,
      "info"
    );
  }

  persistData();

  const status = getMaintenanceStatus();

  // Broadcast maintenance change to all dashboards & clients
  broadcastToWs({
    type: "MAINTENANCE_UPDATED",
    maintenance: status,
  });

  res.json({
    ok: true,
    message: isEnabled
      ? `Đã kích hoạt Chế độ Bảo trì thành công! Đếm ngược ${dur} phút.`
      : "Đã tắt Chế độ Bảo trì thành công. Hệ thống hoạt động bình thường!",
    maintenance: status,
  });
});

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

  const cookies = parseCookies(req.headers.cookie);
  const authHeader = req.headers.authorization;
  let token = cookies.admin_token;
  if (!token && authHeader && authHeader.startsWith("Bearer ")) {
    token = authHeader.substring(7).trim();
  }
  if (!token && req.headers["x-admin-token"]) {
    token = String(req.headers["x-admin-token"]).trim();
  }
  const session = token ? sessions.get(token) : null;

  const mem = process.memoryUsage();
  const uptimeSec = Math.floor(process.uptime());
  const totalDispatches = discordStats.forwarded + discordStats.failed;
  const syncRate =
    totalDispatches > 0 ? ((discordStats.forwarded / totalDispatches) * 100).toFixed(1) : "100.0";

  res.json({
    ok: true,
    auth: {
      username: session ? session.username : "admin",
      displayName: session ? session.displayName : "Tổng Quản Trị",
      role: session ? session.role : "admin",
      avatarUrl: session ? session.avatarUrl : "https://mc-heads.net/avatar/MHF_Steve/128",
    },
    maintenance: getMaintenanceStatus(),
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

app.post("/admin/settings", checkAuth, requirePermission("EDIT_SETTINGS"), rateLimit(30, 60000), (req: Request, res: Response) => {
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

app.post("/admin/keys", checkAuth, requirePermission("MANAGE_KEYS"), rateLimit(30, 60000), (req: Request, res: Response) => {
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

app.delete("/admin/keys/:key", checkAuth, requirePermission("MANAGE_KEYS"), (req: Request, res: Response) => {
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

// Leaderboards & Player Stats API (Top Active, Top Deaths, Top Chat, etc.)
app.get("/admin/leaderboards", checkAuth, rateLimit(60, 60000), (req: Request, res: Response) => {
  const allStats = Array.from(playerStatsMap.values());

  // 1. Top Chat / Message Count (Nói nhiều nhất)
  const topChat = [...allStats]
    .sort((a, b) => b.totalMessages - a.totalMessages || b.totalEvents - a.totalEvents)
    .slice(0, 10);

  // 2. Top Deaths (Tử vong nhiều nhất)
  const topDeaths = [...allStats]
    .sort((a, b) => b.totalDeaths - a.totalDeaths || b.totalEvents - a.totalEvents)
    .slice(0, 10);

  // 3. Top Playtime / Online Duration (Online lâu nhất)
  const topPlaytime = [...allStats]
    .sort((a, b) => b.onlineDurationSeconds - a.onlineDurationSeconds || b.totalEvents - a.totalEvents)
    .slice(0, 10);

  // 4. Top Kills / PvP Warriors (Chiến thần tiêu diệt)
  const topKills = [...allStats]
    .sort((a, b) => b.killCount - a.killCount || b.totalEvents - a.totalEvents)
    .slice(0, 10);

  // 5. Top Joins / Loyal Frequent Visitors (Chăm chỉ đăng nhập nhất)
  const topJoins = [...allStats]
    .sort((a, b) => b.totalJoins - a.totalJoins || b.totalEvents - a.totalEvents)
    .slice(0, 10);

  // 6. Top Commands Executed / Power Users (Sử dụng lệnh nhiều nhất)
  const topCommands = [...allStats]
    .sort((a, b) => b.totalCommands - a.totalCommands || b.totalEvents - a.totalEvents)
    .slice(0, 10);

  // 7. Top Damage / Combat Engaged (Bị dính sát thương / Giao tranh nhiều nhất)
  const topDamage = [...allStats]
    .sort((a, b) => b.damageCount - a.damageCount || b.totalEvents - a.totalEvents)
    .slice(0, 10);

  // 8. Top Total Activity Score (Tổng điểm tương tác máy chủ toàn diện)
  const topActivity = [...allStats]
    .sort(
      (a, b) =>
        b.totalEvents * 2 +
        b.totalMessages * 3 +
        b.onlineDurationSeconds / 60 -
        (a.totalEvents * 2 + a.totalMessages * 3 + a.onlineDurationSeconds / 60)
    )
    .slice(0, 10);

  // 9. Top Clean Record / Zero Violations (Người chơi gương mẫu, 0 cảnh cáo)
  const topClean = [...allStats]
    .filter((p) => p.warningCount === 0 && p.totalEvents > 0)
    .sort((a, b) => b.totalEvents - a.totalEvents)
    .slice(0, 10);

  res.json({
    ok: true,
    totalPlayers: allStats.length,
    leaderboards: {
      topChat,
      topDeaths,
      topPlaytime,
      topKills,
      topJoins,
      topCommands,
      topDamage,
      topActivity,
      topClean,
    },
  });
});

// Player Specific Leaderboard Search & Overall Ranking API
app.get("/admin/leaderboards/player/:name", checkAuth, rateLimit(60, 60000), (req: Request, res: Response) => {
  const rawName = req.params.name;
  if (!rawName) {
    res.status(400).json({ ok: false, error: "Tên người chơi không được để trống" });
    return;
  }

  const queryName = rawName.trim().toLowerCase();
  const allStats = Array.from(playerStatsMap.values());

  // Find direct match or close matches
  const matchedPlayer = allStats.find((p) => p.player.toLowerCase() === queryName) ||
    allStats.find((p) => p.player.toLowerCase().includes(queryName));

  if (!matchedPlayer) {
    res.status(404).json({
      ok: false,
      error: `Không tìm thấy người chơi có tên chứa "${rawName}" trong dữ liệu thống kê.`,
      totalPlayers: allStats.length,
    });
    return;
  }

  const target = matchedPlayer;

  // Calculate exact absolute ranking across all categories
  const sortedChat = [...allStats].sort((a, b) => b.totalMessages - a.totalMessages || b.totalEvents - a.totalEvents);
  const rankChat = sortedChat.findIndex((p) => p.player.toLowerCase() === target.player.toLowerCase()) + 1;

  const sortedDeaths = [...allStats].sort((a, b) => b.totalDeaths - a.totalDeaths || b.totalEvents - a.totalEvents);
  const rankDeaths = sortedDeaths.findIndex((p) => p.player.toLowerCase() === target.player.toLowerCase()) + 1;

  const sortedPlaytime = [...allStats].sort((a, b) => b.onlineDurationSeconds - a.onlineDurationSeconds || b.totalEvents - a.totalEvents);
  const rankPlaytime = sortedPlaytime.findIndex((p) => p.player.toLowerCase() === target.player.toLowerCase()) + 1;

  const sortedKills = [...allStats].sort((a, b) => b.killCount - a.killCount || b.totalEvents - a.totalEvents);
  const rankKills = sortedKills.findIndex((p) => p.player.toLowerCase() === target.player.toLowerCase()) + 1;

  const sortedJoins = [...allStats].sort((a, b) => b.totalJoins - a.totalJoins || b.totalEvents - a.totalEvents);
  const rankJoins = sortedJoins.findIndex((p) => p.player.toLowerCase() === target.player.toLowerCase()) + 1;

  const sortedCommands = [...allStats].sort((a, b) => b.totalCommands - a.totalCommands || b.totalEvents - a.totalEvents);
  const rankCommands = sortedCommands.findIndex((p) => p.player.toLowerCase() === target.player.toLowerCase()) + 1;

  const sortedDamage = [...allStats].sort((a, b) => b.damageCount - a.damageCount || b.totalEvents - a.totalEvents);
  const rankDamage = sortedDamage.findIndex((p) => p.player.toLowerCase() === target.player.toLowerCase()) + 1;

  const sortedActivity = [...allStats].sort(
    (a, b) =>
      b.totalEvents * 2 +
      b.totalMessages * 3 +
      b.onlineDurationSeconds / 60 -
      (a.totalEvents * 2 + a.totalMessages * 3 + a.onlineDurationSeconds / 60)
  );
  const rankActivity = sortedActivity.findIndex((p) => p.player.toLowerCase() === target.player.toLowerCase()) + 1;

  const cleanList = [...allStats].filter((p) => p.warningCount === 0 && p.totalEvents > 0).sort((a, b) => b.totalEvents - a.totalEvents);
  const cleanIdx = cleanList.findIndex((p) => p.player.toLowerCase() === target.player.toLowerCase());
  const rankClean = cleanIdx >= 0 ? cleanIdx + 1 : null;

  res.json({
    ok: true,
    player: target,
    totalPlayers: allStats.length,
    rankings: {
      chat: { rank: rankChat, value: `${target.totalMessages} tin nhắn`, total: allStats.length },
      deaths: { rank: rankDeaths, value: `${target.totalDeaths} lần chết`, total: allStats.length },
      playtime: { rank: rankPlaytime, value: `${Math.floor(target.onlineDurationSeconds / 60)} phút`, seconds: target.onlineDurationSeconds, total: allStats.length },
      kills: { rank: rankKills, value: `${target.killCount} hạ gục`, total: allStats.length },
      joins: { rank: rankJoins, value: `${target.totalJoins} lượt vào`, total: allStats.length },
      commands: { rank: rankCommands, value: `${target.totalCommands} lệnh`, total: allStats.length },
      damage: { rank: rankDamage, value: `${target.damageCount} lần chạm trán`, total: allStats.length },
      activity: {
        rank: rankActivity,
        value: `${Math.floor(target.totalEvents * 2 + target.totalMessages * 3 + target.onlineDurationSeconds / 60)} pts`,
        total: allStats.length,
      },
      clean: {
        rank: rankClean,
        value: target.warningCount === 0 ? "0 cảnh cáo (Gương mẫu)" : `${target.warningCount} cảnh cáo`,
        total: cleanList.length,
      },
    },
  });
});

app.delete("/admin/leaderboards/reset", checkAuth, requirePermission("RESET_DATA"), (req: Request, res: Response) => {
  const ip = getClientIp(req);
  playerStatsMap.clear();
  persistData();
  addAuditLog(ip, "LEADERBOARD_RESET", "Đã đặt lại dữ liệu bảng xếp hạng người chơi", "warn");
  res.json({ ok: true, message: "Đã làm mới bảng xếp hạng người chơi về 0!" });
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
  const { clientKey, author, content, channel, format } = req.body;
  const targetKey = cleanKey(clientKey || "vnlandz_main");
  const authorName = cleanText(author || "DiscordUser");
  const messageText = cleanText(content || "");
  const channelName = cleanText(channel || "general");
  const msgFormat = format || appConfig.discordToMcFormat || "client_chat";

  if (!messageText) {
    res.status(400).json({ ok: false, error: "Nội dung tin nhắn không được trống" });
    return;
  }

  // Format message depending on mode (Client chat vs Server OP tellraw vs say)
  let formattedCmd = "";
  if (msgFormat === "tellraw") {
    formattedCmd = `/tellraw @a [{"text":"[Discord #${channelName}] ","color":"blue"},{"text":"${authorName}: ","color":"aqua","bold":true},{"text":"${messageText}","color":"white"}]`;
  } else if (msgFormat === "say") {
    formattedCmd = `/say [Discord #${channelName}] ${authorName}: ${messageText}`;
  } else {
    // Default: Client-side friendly chat (No OP permission required!)
    formattedCmd = `[Discord #${channelName}] ${authorName}: ${messageText}`;
  }

  pushMessage(targetKey, formattedCmd);

  // Log in events
  const list = events.get(targetKey) || [];
  const inboundEvent: RelayEvent = {
    time: new Date().toISOString(),
    client: "Discord_Bridge_Inbound",
    version: "2.0",
    type: "CHAT",
    title: `Discord Inbound (#${channelName})`,
    player: authorName,
    server: "Discord Bridge",
    message: `[Discord #${channelName}] ${messageText}`,
    ip,
  };
  list.push(inboundEvent);
  while (list.length > MAX_EVENTS) list.shift();
  events.set(targetKey, list);

  // Broadcast to WS
  broadcastToWs({
    type: "EVENT_RECEIVED",
    clientKey: targetKey,
    event: inboundEvent,
  });

  persistData();
  addAuditLog(
    ip,
    "DISCORD_TO_MC",
    `Tin nhắn từ Discord (${authorName} -> Key: ${targetKey}, Mode: ${msgFormat}): ${messageText}`,
    "info"
  );

  res.json({
    ok: true,
    message: "Đã chuyển tiếp tin nhắn Discord vào Minecraft thành công!",
    format: msgFormat,
    queuedCommand: formattedCmd,
  });
});

// Multi-Provider AI Engine (Gemini, OpenAI, Groq, DeepSeek, Anthropic, OpenRouter, Custom)
interface AiRequestOptions {
  provider?: string;
  model?: string;
  apiKey?: string;
}

function detectAiProvider(key: string, manualProvider?: string): string {
  const k = (key || "").trim();
  const mp = (manualProvider || "").trim().toLowerCase();
  if (mp && mp !== "auto") {
    return mp;
  }
  if (!k) return "gemini";
  if (k.startsWith("AIzaSy") || k.length === 39) return "gemini";
  if (k.startsWith("sk-ant-")) return "anthropic";
  if (k.startsWith("gsk_")) return "groq";
  if (k.startsWith("sk-or-")) return "openrouter";
  if (k.startsWith("sk-") && k.length >= 40) {
    if (k.includes("deepseek") || k.length === 35) return "deepseek";
    return "openai";
  }
  return "custom";
}

function getGemini(customKey?: string): GoogleGenAI {
  const key = (customKey && typeof customKey === "string" && customKey.trim().length > 0)
    ? customKey.trim()
    : process.env.GEMINI_API_KEY;
  if (!key) {
    throw new Error("Chưa cấu hình Gemini API Key! Vui lòng nhập API Key của bạn từ Google AI Studio trên giao diện hoặc cấu hình biến môi trường GEMINI_API_KEY.");
  }
  return new GoogleGenAI({ apiKey: key });
}

// Universal AI Caller supporting OpenAI compatible APIs (ChatGPT, Groq, DeepSeek, OpenRouter, etc.)
async function executeUniversalAiCall(opts: {
  provider: string;
  model: string;
  apiKey: string;
  prompt: string;
  systemPrompt?: string;
  jsonMode?: boolean;
}): Promise<{ text: string; modelUsed: string; providerUsed: string }> {
  const { provider, model, apiKey, prompt, systemPrompt, jsonMode } = opts;

  if (provider === "gemini") {
    const ai = getGemini(apiKey);
    const resolvedModel = (!model || model === "auto") ? "gemini-2.5-flash" : model;
    const response = await ai.models.generateContent({
      model: resolvedModel,
      contents: prompt,
      config: jsonMode ? { responseMimeType: "application/json" } : undefined,
    });
    return {
      text: response.text || "",
      modelUsed: resolvedModel,
      providerUsed: "Google Gemini",
    };
  }

  // OpenAI-compatible endpoints mapping
  let baseUrl = "https://api.openai.com/v1/chat/completions";
  let defaultModel = "gpt-4o-mini";
  let authHeader = `Bearer ${apiKey}`;
  let customHeaders: Record<string, string> = {};

  if (provider === "groq") {
    baseUrl = "https://api.groq.com/openai/v1/chat/completions";
    defaultModel = "llama-3.3-70b-versatile";
  } else if (provider === "deepseek") {
    baseUrl = "https://api.deepseek.com/chat/completions";
    defaultModel = "deepseek-chat";
  } else if (provider === "openrouter") {
    baseUrl = "https://openrouter.ai/api/v1/chat/completions";
    defaultModel = "meta-llama/llama-3.3-70b-instruct";
    customHeaders["HTTP-Referer"] = "https://vnlandz-replay.com";
    customHeaders["X-Title"] = "VnlandZ Relay Nexus";
  } else if (provider === "anthropic") {
    // Anthropic Claude Messages API
    const anthropicModel = (!model || model === "auto") ? "claude-3-5-sonnet-20241022" : model;
    const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: anthropicModel,
        max_tokens: 2048,
        system: systemPrompt || "You are a professional Minecraft server analyst.",
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!claudeRes.ok) {
      const errData = await claudeRes.json().catch(() => ({}));
      throw new Error(`Anthropic Claude API Error (${claudeRes.status}): ${errData.error?.message || claudeRes.statusText}`);
    }
    const claudeData = await claudeRes.json();
    const replyText = claudeData.content?.[0]?.text || "";
    return {
      text: replyText,
      modelUsed: anthropicModel,
      providerUsed: "Anthropic Claude",
    };
  }

  if (!apiKey) {
    throw new Error(`Chưa có API Key cho nhà cung cấp ${provider.toUpperCase()}! Vui lòng nhập API Key trên giao diện.`);
  }

  const selectedModel = (!model || model === "auto") ? defaultModel : model;
  const messages = [];
  if (systemPrompt) {
    messages.push({ role: "system", content: systemPrompt });
  }
  messages.push({ role: "user", content: prompt });

  const reqBody: any = {
    model: selectedModel,
    messages,
    temperature: 0.3,
  };
  if (jsonMode && (provider === "openai" || provider === "groq" || provider === "deepseek")) {
    reqBody.response_format = { type: "json_object" };
  }

  const res = await fetch(baseUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: authHeader,
      ...customHeaders,
    },
    body: JSON.stringify(reqBody),
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    const errMsg = errData.error?.message || `HTTP ${res.status} ${res.statusText}`;
    throw new Error(`${provider.toUpperCase()} API Error: ${errMsg}`);
  }

  const data = await res.json();
  const reply = data.choices?.[0]?.message?.content || "";
  return {
    text: reply,
    modelUsed: selectedModel,
    providerUsed: provider.toUpperCase(),
  };
}

app.post("/admin/ai/summarize", checkAuth, requirePermission("AI_STUDIO"), rateLimit(10, 60000), async (req: Request, res: Response) => {
  const ip = getClientIp(req);
  try {
    const targetKey = cleanKey(req.body.clientKey);
    const customApiKey = typeof req.body.apiKey === "string" ? req.body.apiKey.trim() : "";
    const requestedModel = typeof req.body.model === "string" ? req.body.model.trim() : "auto";
    const manualProvider = typeof req.body.provider === "string" ? req.body.provider.trim() : "";
    const provider = detectAiProvider(customApiKey, manualProvider);

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

    const aiResult = await executeUniversalAiCall({
      provider,
      model: requestedModel,
      apiKey: customApiKey,
      prompt,
      systemPrompt: "Bạn là trợ lý AI chuyên phân tích dữ liệu máy chủ Minecraft chuyên nghiệp.",
    });

    addAuditLog(ip, "AI_SUMMARIZE", `Tạo báo cáo tóm tắt AI (${aiResult.providerUsed} - ${aiResult.modelUsed}) cho ${targetEvents.length} logs`, "info");

    res.json({
      ok: true,
      summary: aiResult.text || "Không tạo được nội dung tóm tắt.",
      modelUsed: aiResult.modelUsed,
      providerUsed: aiResult.providerUsed,
      logsAnalyzed: targetEvents.length,
    });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: `AI Summarizer Lỗi: ${err.message}` });
  }
});

app.post("/admin/ai/filter-chat", checkAuth, requirePermission("AI_STUDIO"), rateLimit(15, 60000), async (req: Request, res: Response) => {
  try {
    const text = cleanText(req.body.text || "");
    const customApiKey = typeof req.body.apiKey === "string" ? req.body.apiKey.trim() : "";
    const requestedModel = typeof req.body.model === "string" ? req.body.model.trim() : "auto";
    const manualProvider = typeof req.body.provider === "string" ? req.body.provider.trim() : "";
    const provider = detectAiProvider(customApiKey, manualProvider);

    if (!text) {
      res.status(400).json({ ok: false, error: "Nội dung kiểm duyệt không được trống" });
      return;
    }

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

    const aiResult = await executeUniversalAiCall({
      provider,
      model: requestedModel,
      apiKey: customApiKey,
      prompt,
      systemPrompt: "Bạn là bot kiểm duyệt chat Minecraft, luôn trả về định dạng JSON hợp lệ.",
      jsonMode: true,
    });

    let parsedResult: any = {};
    try {
      const cleaned = aiResult.text.replace(/```json/gi, "").replace(/```/g, "").trim();
      parsedResult = JSON.parse(cleaned);
    } catch {
      parsedResult = {
        isSafe: true,
        category: "UNKNOWN",
        reason: aiResult.text,
        suggestedAction: "ALLOW",
      };
    }

    res.json({
      ok: true,
      modelUsed: aiResult.modelUsed,
      providerUsed: aiResult.providerUsed,
      result: parsedResult,
    });
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
    playerStats: Object.fromEntries(playerStatsMap.entries()),
    auditLogs: auditLogs.slice(-100),
  };
  addAuditLog(ip, "BACKUP_EXPORT", "Xuất file sao lưu hệ thống", "info");
  res.setHeader("Content-Disposition", `attachment; filename="vnlandz_relay_backup_${Date.now()}.json"`);
  res.json(backupData);
});

app.post("/admin/restore", checkAuth, requirePermission("BACKUP_RESTORE"), rateLimit(5, 60000), (req: Request, res: Response) => {
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
    if (data.playerStats && typeof data.playerStats === "object") {
      playerStatsMap.clear();
      for (const [p, st] of Object.entries(data.playerStats)) {
        if (st && typeof st === "object") {
          playerStatsMap.set(p, st as PlayerStats);
        }
      }
    }

    persistData();
    addAuditLog(ip, "BACKUP_RESTORE", "Đã khôi phục thành công dữ liệu từ bản sao lưu", "warn");

    res.json({ ok: true, message: "Đã khôi phục cấu hình và trạng thái thành công!" });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: `Khôi phục thất bại: ${err.message}` });
  }
});

app.post("/admin/test-discord", checkAuth, requirePermission("EDIT_SETTINGS"), rateLimit(10, 60000), async (req: Request, res: Response) => {
  const body = req.body || {};
  let targetWebhook = cleanText(body.webhookUrl || "");
  if (!targetWebhook || targetWebhook.includes("••••")) {
    targetWebhook = appConfig.discordWebhookUrl || process.env.DISCORD_WEBHOOK_URL || "";
  }

  if (!targetWebhook || !isValidDiscordWebhook(targetWebhook)) {
    res.status(400).json({
      ok: false,
      error: "Vui lòng nhập Link Discord Webhook hợp lệ (bắt đầu bằng https://discord.com/api/webhooks/...)!",
    });
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
      message: `Đã gửi tin nhắn test đến Discord thành công! Độ trễ: ${result.latencyMs}ms`,
      latencyMs: result.latencyMs,
    });
  } else {
    discordStats.failed++;
    discordStats.lastError = result.error || "Unknown error";
    res.status(400).json({
      ok: false,
      error: `Gửi Discord thất bại (${result.latencyMs}ms): ${result.error || "Không kết nối được Discord"}`,
      latencyMs: result.latencyMs,
    });
  }
});

app.post("/admin/clear-queue", checkAuth, requirePermission("RESET_DATA"), rateLimit(30, 60000), (req: Request, res: Response) => {
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

app.all(["/poll", "/api/poll", "/command/poll"], rateLimit(180, 60000), (req: Request, res: Response) => {
  requestCounters.polls++;
  const ip = getClientIp(req);
  const clientKey = extractClientKey(req);
  if (!clientKey) {
    res.status(400).json({ ok: false, error: "Missing clientKey" });
    return;
  }

  touchClientKey(clientKey, ip, undefined, "poll");
  const queue = queues.get(clientKey) || [];
  const next = queue.shift() || "";
  queues.set(clientKey, queue);
  persistData();

  // If mod expects plain text or JSON
  if (req.headers.accept === "text/plain" || req.query.format === "text") {
    if (!next) {
      res.status(204).end();
      return;
    }
    res.send(next);
    return;
  }

  res.json({
    ok: true,
    clientKey,
    command: next,
    message: next,
    cmd: next,
    pending: queue.length,
  });
});

app.all("/send", rateLimit(60, 60000), (req: Request, res: Response) => {
  requestCounters.sends++;
  const ip = getClientIp(req);
  const clientKey = extractClientKey(req);
  if (!clientKey) {
    res.status(400).json({ ok: false, error: "Missing clientKey. Dùng ?clientKey=TEN_KEY" });
    return;
  }

  // Check if sent by a moderator token
  const cookies = parseCookies(req.headers.cookie);
  const authHeader = req.headers.authorization;
  let token = cookies.admin_token;
  if (!token && authHeader && authHeader.startsWith("Bearer ")) {
    token = authHeader.substring(7).trim();
  }
  if (!token && req.headers["x-admin-token"]) {
    token = String(req.headers["x-admin-token"]).trim();
  }
  if (token && sessions.has(token)) {
    const sess = sessions.get(token);
    if (sess && !hasPermission(sess.role, "SEND_COMMAND")) {
      res.status(403).json({
        ok: false,
        error: `Tài khoản '${sess.username}' (Vai trò: ${sess.role.toUpperCase()}) không có quyền gửi lệnh (SEND_COMMAND) vào máy chủ!`,
      });
      return;
    }
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
  const cmdEvent: RelayEvent = {
    time: new Date().toISOString(),
    client: "Relay_Dashboard_Bridge",
    version: "2.5",
    type: "COMMAND",
    title: "Relay Command Queued",
    player: "Admin / Discord Bridge",
    server: "Relay Server",
    message: `Lệnh đã được đưa vào hàng đợi: ${normalized}`,
    ip,
  };
  list.push(cmdEvent);
  while (list.length > MAX_EVENTS) list.shift();
  events.set(clientKey, list);
  persistData();

  broadcastToWs({
    type: "EVENT_RECEIVED",
    clientKey,
    event: cmdEvent,
  });

  res.json({
    ok: true,
    queued: true,
    clientKey,
    command: normalized,
    pending: queue.length,
  });
});

app.post(["/events", "/push", "/webhook", "/api/events", "/api/push", "/api/webhook"], rateLimit(120, 60000), (req: Request, res: Response) => {
  requestCounters.events++;
  const ip = getClientIp(req);
  const clientKey = extractClientKey(req);
  if (!clientKey) {
    res.status(400).json({ ok: false, error: "Missing clientKey header hoặc query param" });
    return;
  }

  const body = req.body || {};
  const list = events.get(clientKey) || [];

  // Extract from Discord Webhook standard format if sent by Webhook mods
  let player = cleanText(body.player || body.username || req.headers["x-vnlandz-player"] || "Minecraft_Player");
  let message = cleanText(body.message || body.text || body.content || "");
  let title = cleanText(body.title || "Minecraft Event");
  let eventType = cleanText(body.type || "").toUpperCase();

  // If mod sends Discord Embeds: { embeds: [{ title, description, author, fields, ... }] }
  if (Array.isArray(body.embeds) && body.embeds.length > 0) {
    const embed = body.embeds[0] || {};
    if (embed.title && !body.title) title = cleanText(embed.title);
    if (embed.description && !message) message = cleanText(embed.description);
    if (embed.author?.name && player === "Minecraft_Player") player = cleanText(embed.author.name);
  }

  // Infer event type if not explicitly set
  if (!eventType || eventType === "LOG") {
    const lowerMsg = (message + " " + title).toLowerCase();
    if (lowerMsg.includes("died") || lowerMsg.includes("slain") || lowerMsg.includes("killed") || lowerMsg.includes("chết") || lowerMsg.includes("bị giết") || lowerMsg.includes("fell") || lowerMsg.includes("drowned") || lowerMsg.includes("burned")) {
      eventType = "DEATH";
    } else if (lowerMsg.includes("joined") || lowerMsg.includes("tham gia") || lowerMsg.includes("vào server") || lowerMsg.includes("connect")) {
      eventType = "JOIN";
    } else if (lowerMsg.includes("left") || lowerMsg.includes("rời server") || lowerMsg.includes("thoát") || lowerMsg.includes("disconnect") || lowerMsg.includes("quit")) {
      eventType = "LEAVE";
    } else if (lowerMsg.includes("executed command") || message.startsWith("/")) {
      eventType = "COMMAND";
    } else if (message) {
      eventType = "CHAT";
    } else {
      eventType = "LOG";
    }
  }

  touchClientKey(clientKey, ip, player, "event");

  const eventItem: RelayEvent = {
    time: new Date().toISOString(),
    client: cleanText(body.client || "Minecraft_Client"),
    version: cleanText(body.version || "1.0"),
    type: eventType,
    title: title || `${eventType} Event`,
    player: player,
    server: cleanText(body.server || req.headers["x-vnlandz-server"] || "Minecraft Server"),
    message: message || title || "Sự kiện từ Minecraft",
    ip,
  };

  list.push(eventItem);
  while (list.length > MAX_EVENTS) list.shift();
  events.set(clientKey, list);
  trackPlayerEvent(eventItem);
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

  // If mod is acting as Discord Webhook client without ?wait=true, return 204 No Content (standard Discord Webhook behavior)
  // This completely stops Minecraft mod from printing any response spam in player chat!
  if (req.query?.wait !== "true" && req.query?.format !== "json" && !req.headers.accept?.includes("application/json")) {
    res.status(204).end();
    return;
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

// Static assets, build files & PWA manifest
app.use("/assets", express.static(path.join(process.cwd(), "dist", "assets")));
if (fs.existsSync(path.join(process.cwd(), "dist"))) {
  app.use(express.static(path.join(process.cwd(), "dist")));
}
const publicDir = path.join(process.cwd(), "public");
if (fs.existsSync(publicDir)) {
  app.use(express.static(publicDir));
  app.use("/public", express.static(publicDir));
}

app.get("/manifest.json", (req: Request, res: Response) => {
  res.setHeader("Content-Type", "application/json");
  const pubPath = path.join(process.cwd(), "public", "manifest.json");
  if (fs.existsSync(pubPath)) return res.sendFile(pubPath);
  res.sendFile(path.join(process.cwd(), "manifest.json"));
});

app.get("/style.css", (req: Request, res: Response) => {
  res.setHeader("Content-Type", "text/css");
  const pubPath = path.join(process.cwd(), "public", "style.css");
  if (fs.existsSync(pubPath)) return res.sendFile(pubPath);
  res.sendFile(path.join(process.cwd(), "style.css"));
});

app.get("/script.js", (req: Request, res: Response) => {
  res.setHeader("Content-Type", "application/javascript");
  const pubPath = path.join(process.cwd(), "public", "script.js");
  if (fs.existsSync(pubPath)) return res.sendFile(pubPath);
  res.sendFile(path.join(process.cwd(), "script.js"));
});

app.get("*", (req: Request, res: Response) => {
  const p = req.path || "";
  // Do NOT return HTML for API/poll/webhook endpoints
  if (p.startsWith("/api/") || p === "/poll" || p === "/events" || p === "/webhook" || p === "/send" || p === "/push" || p === "/health" || p === "/clear") {
    return res.status(404).json({ ok: false, error: "Endpoint not found" });
  }

  const distIndex = path.join(process.cwd(), "dist", "index.html");
  if (fs.existsSync(distIndex)) {
    return res.sendFile(distIndex);
  }
  res.sendFile(path.join(process.cwd(), "index.html"));
});

if (!process.env.VERCEL) {
  server.listen(PORT, "0.0.0.0", () => {
    console.log(
      `[VnlandZ Minecraft Relay & Discord Bridge] Server running securely with WebSockets on http://0.0.0.0:${PORT}`
    );
  });
}

export { app, server };
export default app;
