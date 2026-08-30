const queues = globalThis.__vnlandzQueues || new Map();
const events = globalThis.__vnlandzEvents || new Map();

globalThis.__vnlandzQueues = queues;
globalThis.__vnlandzEvents = events;

const MAX_QUEUE = 25;
const MAX_EVENTS = 50;

module.exports = async (req, res) => {
  setCors(res);

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  try {
    if (req.method === "GET") {
      const clientKey = readClientKey(req);
      const sent = readUrlMessage(req);

      if (!clientKey) {
        return res.status(200).json({
          ok: true,
          name: "VnlandZ Relay",
          status: "online",
          usage: {
            poll: "GET /?clientKey=YOUR_KEY",
            quickSend: "GET /send?clientKey=YOUR_KEY&message=xin%20chao",
            quickDm: "GET /send?clientKey=YOUR_KEY&message=/chat%20-player%20xin%20chao",
            sendCommand: "POST / { clientKey, command }",
            sendMessage: "POST / { clientKey, message }"
          }
        });
      }

      if (sent) {
        const queued = pushMessage(clientKey, sent);
        return res.status(200).json({
          ok: true,
          queued: true,
          clientKey,
          pending: queued.length
        });
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

    if (req.method === "POST") {
      const body = await readJson(req);
      const clientKey = cleanKey(body.clientKey || readClientKey(req));

      if (!clientKey) {
        return res.status(400).json({
          ok: false,
          error: "Missing clientKey"
        });
      }

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

    return res.status(405).json({
      ok: false,
      error: "Method not allowed"
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: "Relay error"
    });
  }
};

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,X-VnlandZ-Client-Key,X-VnlandZ-Player,X-VnlandZ-Server");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
}

function readClientKey(req) {
  const url = new URL(req.url, "https://vnlandz-relay.local");
  return cleanKey(
    url.searchParams.get("clientKey")
    || url.searchParams.get("key")
    || req.headers["x-vnlandz-client-key"]
    || ""
  );
}

function readUrlMessage(req) {
  const url = new URL(req.url, "https://vnlandz-relay.local");
  if (!url.pathname.toLowerCase().startsWith("/send")) return "";
  return normalizeIncoming(
    url.searchParams.get("message")
    || url.searchParams.get("msg")
    || url.searchParams.get("text")
    || url.searchParams.get("command")
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
    .slice(0, 240);
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
      if (data.length > 8192) req.destroy();
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
