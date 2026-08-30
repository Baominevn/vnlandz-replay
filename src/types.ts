export interface EventLog {
  id?: string;
  time: string;
  client?: string;
  version?: string;
  type?: string;
  title?: string;
  player?: string;
  server?: string;
  message?: string;
}

export interface ClientData {
  queue: string[];
  events: EventLog[];
  lastActive?: string;
}

export interface ServerStats {
  totalClients: number;
  activeIp: string;
  uptimeSeconds?: number;
  totalQueued?: number;
  totalEvents?: number;
}

export interface ApiResponseData {
  ok: boolean;
  stats: ServerStats;
  clientsData: Record<string, ClientData>;
  error?: string;
}
