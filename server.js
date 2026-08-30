const queues = globalThis.__vnlandzQueues || new Map();
const events = globalThis.__vnlandzEvents || new Map();

globalThis.__vnlandzQueues = queues;
globalThis.__vnlandzEvents = events;

const MAX_QUEUE = 50;
const MAX_EVENTS = 100;

module.exports = async (req, res) => {
  setCors(res);

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  try {
    const url = new URL(req.url, "https://vnlandz-relay.local");
    const pathname = url.pathname.toLowerCase();
    const clientKey = getClientKey(url, req);

    // 1. Trang chủ / Hướng dẫn sử dụng
    if (pathname === "/" && req.method === "GET" && !clientKey) {
      return res.status(200).json({
        ok: true,
        name: "VnlandZ Relay Pro All-in-One",
        status: "online",
        version: "3.0",
        endpoints: {
          home: "GET /",
          poll: "GET /poll?clientKey=YOUR_KEY",
          send: "GET /send?clientKey=YOUR_KEY&message=hello hoặc POST /send { clientKey, message }",
          pushEvent: "POST /events { clientKey, player, message, ... }"
        }
      });
    }

    // Kiểm tra clientKey bắt buộc cho các action bên dưới
    if (!clientKey) {
      return res.status(400).json({
        ok: false,
        error: "Missing or invalid clientKey"
      });
    }

    // 2. Endpoint: /poll (Client gọi để lấy lệnh/tin nhắn tiếp theo)
    if (pathname === "/poll" && req.method === "GET") {
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

    // 3. Endpoint: /send (Gửi nhanh qua GET hoặc POST)
    if (pathname === "/send") {
      let message = "";
      if (req.method === "GET") {
        message = url.searchParams.get("message") || url.searchParams.get("msg") || url.searchParams.get("text") || url.searchParams.get("command") || "";
      } else if (req.method === "POST") {
        const body = await readJson(req);
        message = body.command || body.message || body.text || body.content || "";
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

    // 4. Endpoint: /events hoặc /push (Nhận sự kiện log từ client/game)
    if ((pathname === "/events" || pathname === "/push") && req.method === "POST") {
      const body = await readJson(req);
      const list = events.get(clientKey) || [];
      
      list.push({
        time: new Date().toISOString(),
        client: cleanText(body.client),
        version: cleanText(body.version),
        type: cleanText(body.type),
        title: cleanText(body.title),
        player: cleanText(body.player),
        server: cleanText(body.server),
        message: cleanText(body.message)
      });

      while (list.length > MAX_EVENTS) list.shift();
      events.set(clientKey, list);

      // Nếu sự kiện có gửi kèm message/command cần thực thi luôn, push vào queue luôn
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

    // Tương thích ngược với code cũ: Nếu gọi POST thẳng vào root "/"
    if (pathname === "/" && req.method === "POST") {
      const body = await readJson(req);
      const incoming = normalizeIncoming(body.command || body.message || body.text || body.content);

      if (incoming) {
        const queue = pushMessage(clientKey, incoming);
        return res.status(200).json({
          ok: true,
          queued: true,
          clientKey,
          pending: queue.length
        });
      }

      // Lưu event mặc định nếu không có message
      const list = events.get(clientKey) || [];
      list.push({
        time: new Date().toISOString(),
        client: cleanText(body.client),
        version: cleanText(body.version),
        type: cleanText(body.type),
        title: cleanText(body.title),
        player: cleanText(body.player),
        server: cleanText(body.server),
        message: cleanText(body.message)
      });
      while (list.length > MAX_EVENTS) list.shift();
      events.set(clientKey, list);

      return res.status(200).json({
        ok: true,
        received: true,
        clientKey,
        events: list.length
      });
    }

    return res.status(404).json({
      ok: false,
      error: "Endpoint not found"
    });

  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: "Internal Relay Error"
    });
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

function readJson(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", chunk => {
      data += chunk;
      if (data.length > 16384) req.destroy();
    });
    req.on("end", () => {
      if (!data.trim()) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch {
        resolve({});
      }
    });
    req.on("error", () => resolve({}));
  });
}