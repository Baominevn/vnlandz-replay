import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';

const queues = new Map<string, string[]>();
const events = new Map<string, any[]>();
const sessions = new Set<string>();

const MAX_QUEUE = 50;
const MAX_EVENTS = 100;
const ADMIN_USER = 'admin';
const ADMIN_PASS = 'admin1234';

function cleanKey(value: any): string {
  return String(value || '')
    .trim()
    .replace(/[^A-Za-z0-9_-]/g, '')
    .slice(0, 64);
}

function cleanText(value: any): string {
  return String(value || '')
    .replace(/\r/g, '')
    .trim()
    .slice(0, 500);
}

function normalizeIncoming(value: any): string {
  const text = cleanText(value);
  const lower = text.toLowerCase();
  if (lower.startsWith('/chat ')) return cleanText(text.slice(6));
  if (lower.startsWith('.chat ')) return cleanText(text.slice(6));
  if (lower.startsWith('chat ')) return cleanText(text.slice(5));
  return text;
}

function pushMessage(clientKey: string, message: string): string[] {
  const queue = queues.get(clientKey) || [];
  queue.push(message);
  while (queue.length > MAX_QUEUE) queue.shift();
  queues.set(clientKey, queue);
  return queue;
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  // JSON & URL-encoded parser
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // CORS Middleware
  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,X-VnlandZ-Client-Key,X-VnlandZ-Player,X-VnlandZ-Server');
    if (req.method === 'OPTIONS') {
      return res.status(204).end();
    }
    next();
  });

  // Seed sample demo data
  if (queues.size === 0) {
    pushMessage('test-client-1', '/give Player1 diamond 64');
    pushMessage('test-client-1', '/weather clear');
    events.set('test-client-1', [
      {
        time: new Date(Date.now() - 1000 * 60 * 5).toISOString(),
        client: 'Minecraft-Bridge',
        version: '1.20.4',
        type: 'PLAYER_JOIN',
        title: 'Player Connected',
        player: 'Player1',
        server: 'Main-Survival',
        message: 'Player1 đã tham gia máy chủ.'
      }
    ]);
  }

  // --- API ROUTES ---

  // 1. Login
  app.post('/login', (req, res) => {
    const { username, password } = req.body || {};
    if (username === ADMIN_USER && password === ADMIN_PASS) {
      const token = 'session_' + Math.random().toString(36).substring(2);
      sessions.add(token);
      res.setHeader('Set-Cookie', `admin_token=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800`);
      return res.json({ ok: true, message: 'Đăng nhập thành công' });
    }
    return res.status(401).json({ ok: false, error: 'Sai tài khoản hoặc mật khẩu!' });
  });

  // 2. Logout
  app.get('/logout', (req, res) => {
    res.setHeader('Set-Cookie', `admin_token=; Path=/; HttpOnly; Max-Age=0`);
    res.json({ ok: true, message: 'Đã đăng xuất' });
  });

  // 3. Admin Data
  app.get('/admin/data', (req, res) => {
    const clientIp = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || '127.0.0.1';
    const allKeys = new Set([...queues.keys(), ...events.keys()]);
    const clientsData: Record<string, any> = {};

    for (const k of allKeys) {
      clientsData[k] = {
        queue: queues.get(k) || [],
        events: events.get(k) || []
      };
    }

    res.json({
      ok: true,
      stats: {
        totalClients: allKeys.size,
        activeIp: String(clientIp).split(',')[0].trim()
      },
      clientsData
    });
  });

  // 4. Poll
  app.get('/poll', (req, res) => {
    const clientKey = cleanKey(
      req.query.clientKey || req.query.key || req.headers['x-vnlandz-client-key'] || ''
    );
    if (!clientKey) {
      return res.status(400).json({ ok: false, error: 'Missing clientKey parameter' });
    }
    const queue = queues.get(clientKey) || [];
    const next = queue.shift() || '';
    queues.set(clientKey, queue);

    res.json({
      ok: true,
      clientKey,
      command: next,
      message: next
    });
  });

  // 5. Send
  const handleSend = (req: express.Request, res: express.Response) => {
    const clientKey = cleanKey(
      req.query.clientKey || req.body?.clientKey || req.headers['x-vnlandz-client-key'] || ''
    );
    if (!clientKey) {
      return res.status(400).json({ ok: false, error: 'Missing clientKey parameter' });
    }

    const message =
      req.query.message ||
      req.query.msg ||
      req.query.text ||
      req.query.command ||
      req.body?.command ||
      req.body?.message ||
      req.body?.text ||
      req.body?.content ||
      '';

    const normalized = normalizeIncoming(message);
    if (!normalized) {
      return res.status(400).json({ ok: false, error: 'Missing message content' });
    }

    const queue = pushMessage(clientKey, normalized);
    res.json({
      ok: true,
      queued: true,
      clientKey,
      pending: queue.length
    });
  };

  app.get('/send', handleSend);
  app.post('/send', handleSend);

  // 6. Events / Push
  const handleEvent = (req: express.Request, res: express.Response) => {
    const clientKey = cleanKey(
      req.query.clientKey || req.body?.clientKey || req.headers['x-vnlandz-client-key'] || ''
    );
    if (!clientKey) {
      return res.status(400).json({ ok: false, error: 'Missing clientKey parameter' });
    }

    const body = req.body || {};
    const list = events.get(clientKey) || [];

    list.push({
      time: new Date().toISOString(),
      client: cleanText(body.client),
      version: cleanText(body.version),
      type: cleanText(body.type || 'LOG'),
      title: cleanText(body.title || 'Event'),
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

    res.json({
      ok: true,
      received: true,
      clientKey,
      eventsCount: list.length
    });
  };

  app.post('/events', handleEvent);
  app.post('/push', handleEvent);

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa'
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
  });
}

startServer();
