import React, { useState, useEffect, useCallback } from 'react';
import { CyberHeader } from './components/CyberHeader';
import { MetricsCards } from './components/MetricsCards';
import { QuickActionHub } from './components/QuickActionHub';
import { ClientsManager } from './components/ClientsManager';
import { VercelFixGuide } from './components/VercelFixGuide';
import { ApiCodeModal } from './components/ApiCodeModal';
import { AuthModal } from './components/AuthModal';
import { ApiResponseData, ClientData, ServerStats } from './types';

const INITIAL_CLIENTS: Record<string, ClientData> = {
  'test-client-1': {
    queue: ['/give Player1 diamond 64', '/weather clear'],
    events: [
      {
        time: new Date(Date.now() - 1000 * 60 * 5).toISOString(),
        client: 'Minecraft-Fabric-Bridge',
        version: '1.20.4',
        type: 'PLAYER_JOIN',
        title: 'Player Connected',
        player: 'Player1',
        server: 'Main-Survival',
        message: 'Player1 đã tham gia server.'
      },
      {
        time: new Date(Date.now() - 1000 * 60 * 2).toISOString(),
        client: 'Minecraft-Fabric-Bridge',
        version: '1.20.4',
        type: 'BOSS_KILL',
        title: 'Ender Dragon Defeated',
        player: 'Player1',
        server: 'Main-Survival',
        message: 'Ender Dragon đã bị tiêu diệt tại toạ độ 0, 65, 0'
      }
    ]
  },
  'roblox-bot-alpha': {
    queue: ['teleport:hub_zone'],
    events: [
      {
        time: new Date(Date.now() - 1000 * 60 * 12).toISOString(),
        client: 'Roblox-Luau-Relay',
        version: '2.1',
        type: 'HEARTBEAT',
        title: 'Client Online',
        player: 'RobloxAdmin',
        server: 'Place_9824',
        message: 'Roblox Luau client initialized successfully'
      }
    ]
  }
};

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(true);
  const [isAutoRefresh, setIsAutoRefresh] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [isFixGuideOpen, setIsFixGuideOpen] = useState<boolean>(false);
  const [isApiModalOpen, setIsApiModalOpen] = useState<boolean>(false);

  const [stats, setStats] = useState<ServerStats>({
    totalClients: 2,
    activeIp: '127.0.0.1'
  });

  const [clientsData, setClientsData] = useState<Record<string, ClientData>>(() => {
    const saved = localStorage.getItem('vnlandz_clients');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {
        return INITIAL_CLIENTS;
      }
    }
    return INITIAL_CLIENTS;
  });

  // Sync to local storage
  useEffect(() => {
    localStorage.setItem('vnlandz_clients', JSON.stringify(clientsData));
  }, [clientsData]);

  // Load data from server or local state
  const loadData = useCallback(async (manual = false) => {
    if (manual) setIsRefreshing(true);
    try {
      const res = await fetch('/admin/data', {
        headers: { Accept: 'application/json' }
      });

      if (res.ok) {
        const data: ApiResponseData = await res.json();
        if (data.ok && data.clientsData) {
          setClientsData(data.clientsData);
          if (data.stats) setStats(data.stats);
          setIsAuthenticated(true);
        }
      } else if (res.status === 401) {
        // Auth required
      }
    } catch {
      // Running standalone / client-only mode
    } finally {
      if (manual) {
        setTimeout(() => setIsRefreshing(false), 400);
      }
    }
  }, []);

  // Polling interval
  useEffect(() => {
    if (!isAutoRefresh) return;
    const interval = setInterval(() => {
      loadData(false);
    }, 3000);
    return () => clearInterval(interval);
  }, [isAutoRefresh, loadData]);

  // Calculate totals
  const totalQueued = (Object.values(clientsData) as ClientData[]).reduce(
    (acc, curr) => acc + (curr.queue?.length || 0),
    0
  );
  const totalEvents = (Object.values(clientsData) as ClientData[]).reduce(
    (acc, curr) => acc + (curr.events?.length || 0),
    0
  );

  // Update stats clients count
  useEffect(() => {
    setStats((prev) => ({
      ...prev,
      totalClients: Object.keys(clientsData).length
    }));
  }, [clientsData]);

  // Handle send message
  const handleSendMessage = async (clientKey: string, message: string): Promise<boolean> => {
    try {
      // 1. Try real server call
      const res = await fetch('/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientKey, message })
      });
      if (res.ok) {
        await loadData(false);
        return true;
      }
    } catch {
      // Fallback local update
    }

    setClientsData((prev) => {
      const cur = prev[clientKey] || { queue: [], events: [] };
      const newQueue = [...cur.queue, message];
      if (newQueue.length > 50) newQueue.shift();
      return {
        ...prev,
        [clientKey]: {
          ...cur,
          queue: newQueue
        }
      };
    });
    return true;
  };

  // Handle send event
  const handleSendEvent = async (clientKey: string, payload: any): Promise<boolean> => {
    try {
      const res = await fetch('/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientKey, ...payload })
      });
      if (res.ok) {
        await loadData(false);
        return true;
      }
    } catch {
      // Fallback local
    }

    setClientsData((prev) => {
      const cur = prev[clientKey] || { queue: [], events: [] };
      const newEvents = [
        ...cur.events,
        {
          time: new Date().toISOString(),
          ...payload
        }
      ];
      if (newEvents.length > 100) newEvents.shift();

      let newQueue = [...cur.queue];
      if (payload.autoQueue && payload.command) {
        newQueue.push(payload.command);
      }

      return {
        ...prev,
        [clientKey]: {
          ...cur,
          queue: newQueue,
          events: newEvents
        }
      };
    });
    return true;
  };

  // Handle poll
  const handlePollClient = async (clientKey: string): Promise<string | null> => {
    try {
      const res = await fetch(`/poll?clientKey=${encodeURIComponent(clientKey)}`);
      if (res.ok) {
        const data = await res.json();
        await loadData(false);
        return data.command || null;
      }
    } catch {
      // Fallback local
    }

    const cur = clientsData[clientKey];
    if (!cur || !cur.queue || cur.queue.length === 0) return null;

    const [next, ...rest] = cur.queue;
    setClientsData((prev) => ({
      ...prev,
      [clientKey]: {
        ...prev[clientKey],
        queue: rest
      }
    }));
    return next || null;
  };

  // Handle delete client
  const handleClearClient = (clientKey: string) => {
    setClientsData((prev) => {
      const next = { ...prev };
      delete next[clientKey];
      return next;
    });
  };

  // Handle login
  const handleLogin = async (user: string, pass: string): Promise<boolean> => {
    try {
      const res = await fetch('/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: user, password: pass })
      });
      if (res.ok) {
        setIsAuthenticated(true);
        await loadData(true);
        return true;
      }
    } catch {
      // Local demo check
      if (user === 'admin' && pass === 'admin1234') {
        setIsAuthenticated(true);
        return true;
      }
    }
    if (user === 'admin' && pass === 'admin1234') {
      setIsAuthenticated(true);
      return true;
    }
    return false;
  };

  const handleLogout = async () => {
    try {
      await fetch('/logout');
    } catch {
      // ignore
    }
    setIsAuthenticated(false);
  };

  return (
    <div className="relative min-h-screen text-slate-100 p-4 md:p-8 flex flex-col items-center">
      {/* Background Cyber Effects */}
      <div className="cyber-grid-bg" />
      <div className="cyber-scanline" />

      {/* Main Container */}
      <main className="relative z-10 w-full max-w-6xl mx-auto flex-1">
        
        {/* Header */}
        <CyberHeader
          activeIp={stats.activeIp}
          isAutoRefresh={isAutoRefresh}
          setIsAutoRefresh={setIsAutoRefresh}
          onRefresh={() => loadData(true)}
          onLogout={handleLogout}
          onOpenFixGuide={() => setIsFixGuideOpen(true)}
          onOpenApiModal={() => setIsApiModalOpen(true)}
          isRefreshing={isRefreshing}
        />

        {/* Metrics Grid */}
        <MetricsCards
          stats={stats}
          totalQueued={totalQueued}
          totalEvents={totalEvents}
        />

        {/* Quick Action Hub: Send commands & trigger events */}
        <QuickActionHub
          onSendMessage={handleSendMessage}
          onSendEvent={handleSendEvent}
          activeClientKeys={Object.keys(clientsData)}
        />

        {/* Clients & Queues Manager */}
        <ClientsManager
          clientsData={clientsData}
          onPollClient={handlePollClient}
          onClearClient={handleClearClient}
        />
      </main>

      {/* Modals */}
      <VercelFixGuide
        isOpen={isFixGuideOpen}
        onClose={() => setIsFixGuideOpen(false)}
      />

      <ApiCodeModal
        isOpen={isApiModalOpen}
        onClose={() => setIsApiModalOpen(false)}
      />

      <AuthModal
        isOpen={!isAuthenticated}
        onLogin={handleLogin}
      />
    </div>
  );
}
