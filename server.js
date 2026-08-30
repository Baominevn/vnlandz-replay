const queues = globalThis.__vnlandzQueues || new Map();
const events = globalThis.__vnlandzEvents || new Map();
const sessions = globalThis.__vnlandzSessions || new Set();

globalThis.__vnlandzQueues = queues;
globalThis.__vnlandzEvents = events;
globalThis.__vnlandzSessions = sessions;

const MAX_QUEUE = 50;
const MAX_EVENTS = 100;
const ADMIN_USER = "admin";
const ADMIN_PASS = "admin1234";

module.exports = async (req, res) => {
  setCors(res);

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  try {
    const url = new URL(req.url, "https://vnlandz-relay.local");
    const pathname = url.pathname.toLowerCase();
    const clientKey = getClientKey(url, req);
    const clientIp = req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "127.0.0.1";

    // 1. Đăng nhập Admin
    if (pathname === "/login" && req.method === "POST") {
      const body = await readJson(req);
      if (body.username === ADMIN_USER && body.password === ADMIN_PASS) {
        const token = "session_" + Math.random().toString(36).substring(2);
        sessions.add(token);
        res.setHeader("Set-Cookie", `admin_token=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800`);
        return res.status(200).json({ ok: true, message: "Đăng nhập thành công" });
      }
      return res.status(401).json({ ok: false, error: "Sai tài khoản hoặc mật khẩu!" });
    }

    // 2. Đăng xuất Admin
    if (pathname === "/logout") {
      const cookies = parseCookies(req.headers.cookie);
      if (cookies.admin_token) {
        sessions.delete(cookies.admin_token);
      }
      res.setHeader("Set-Cookie", `admin_token=; Path=/; HttpOnly; Max-Age=0`);
      return res.status(200).json({ ok: true, message: "Đã đăng xuất" });
    }

    // 3. Lấy dữ liệu Dashboard
    if (pathname === "/admin/data" && req.method === "GET") {
      const cookies = parseCookies(req.headers.cookie);
      if (!cookies.admin_token || !sessions.has(cookies.admin_token)) {
        return res.status(401).json({ ok: false, error: "Chưa xác thực quyền truy cập!" });
      }

      const allKeys = new Set([...queues.keys(), ...events.keys()]);
      const clientsData = {};

      for (const k of allKeys) {
        clientsData[k] = {
          queue: queues.get(k) || [],
          events: events.get(k) || []
        };
      }

      return res.status(200).json({
        ok: true,
        stats: {
          totalClients: allKeys.size,
          activeIp: String(clientIp).split(",")[0].trim()
        },
        clientsData
      });
    }

    // 4. API Poll
    if (pathname === "/poll" && req.method === "GET") {
      if (!clientKey) {
        return res.status(400).json({ ok: false, error: "Missing clientKey" });
      }
      const queue = queues.get(clientKey) || [];
      const next = queue.shift() || "";
      queues.set(clientKey, queue);

      return res.status(200).json({
        ok: true,
        clientKey,
        command: next,
        message: next
      });
    }

    // 5. API Send
    if (pathname === "/send") {
      if (!clientKey) {
        return res.status(400).json({ ok: false, error: "Missing clientKey" });
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
        return res.status(400).json({ ok: false, error: "Missing message to send" });
      }

      const queue = pushMessage(clientKey, normalized);
      return res.status(200).json({
        ok: true,
        queued: true,
        clientKey,
        pending: queue.length
      });
    }

    // 6. API Events
    if ((pathname === "/events" || pathname === "/push") && req.method === "POST") {
      if (!clientKey) {
        return res.status(400).json({ ok: false, error: "Missing clientKey" });
      }

      const body = await readJson(req);
      const list = events.get(clientKey) || [];
      
      list.push({
        time: new Date().toISOString(),
        client: cleanText(body.client),
        version: cleanText(body.version),
        type: cleanText(body.type || "LOG"),
        title: cleanText(body.title || "Event"),
        player: cleanText(body.player),
        server: cleanText(body.server),
        message: cleanText(body.message)
      });

      while (list.length > MAX_EVENTS) list.shift();
      events.set(clientKey, list);

      const incoming = normalizeIncoming(body.command || body.message);
      if (incoming && body.autoQueue) {
        pushMessage(clientKey, incoming);
      }

      return res.status(200).json({
        ok: true,
        received: true,
        clientKey,
        eventsCount: list.length
      });
    }

    return res.status(404).json({ ok: false, error: "Endpoint not found" });

  } catch (error) {
    return res.status(500).json({ ok: false, error: "Internal Server Error" });
  }
};

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,X-VnlandZ-Client-Key,X-VnlandZ-Player,X-VnlandZ-Server");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
}

function getClientKey(url, req) {
  return cleanKey(
    url.searchParams.get("clientKey")
    || url.searchParams.get("key")
    || req.headers["x-vnlandz-client-key"]
    || ""
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
    .slice(0, 500);
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

function readJson(req) {
  if (req.body && typeof req.body === "object") return Promise.resolve(req.body);
  if (typeof req.body === "string" && req.body.trim()) {
    try { return Promise.resolve(JSON.parse(req.body)); } catch { return Promise.resolve({}); }
  }

  return new Promise((resolve) => {
    let data = "";
    req.on("data", chunk => {
      data += chunk;
      if (data.length > 32768) req.destroy();
    });
    req.on("end", () => {
      if (!data.trim()) return resolve({});
      try { resolve(JSON.parse(data)); } catch { resolve({}); }
    });
    req.on("error", () => resolve({}));
  });
}