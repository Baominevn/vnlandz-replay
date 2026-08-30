import React, { useState } from 'react';
import { Search, Trash2, ArrowDownCircle, Check, Copy, AlertCircle, RefreshCw, Terminal, Clock, User, Server } from 'lucide-react';
import { ClientData, EventLog } from '../types';

interface ClientsManagerProps {
  clientsData: Record<string, ClientData>;
  onPollClient: (clientKey: string) => Promise<string | null>;
  onClearClient: (clientKey: string) => void;
}

export const ClientsManager: React.FC<ClientsManagerProps> = ({
  clientsData,
  onPollClient,
  onClearClient
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [pollingKey, setPollingKey] = useState<string | null>(null);
  const [pollResult, setPollResult] = useState<{ clientKey: string; command: string } | null>(null);

  const keys = Object.keys(clientsData || {});
  const filteredKeys = keys.filter((k) =>
    k.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(id);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const handlePoll = async (clientKey: string) => {
    setPollingKey(clientKey);
    const cmd = await onPollClient(clientKey);
    setPollingKey(null);
    if (cmd) {
      setPollResult({ clientKey, command: cmd });
      setTimeout(() => setPollResult(null), 4000);
    } else {
      setPollResult({ clientKey, command: '(Hàng đợi rỗng)' });
      setTimeout(() => setPollResult(null), 3000);
    }
  };

  return (
    <div className="space-y-4">
      {/* Search & Filter bar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 p-4 rounded-xl cyber-box border border-cyan-500/20">
        <div className="relative w-full sm:w-96">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-cyan-400" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="🔍 Tìm kiếm Client Key..."
            className="w-full pl-10 pr-4 py-2 bg-black/60 border border-cyan-500/30 rounded-lg text-xs font-mono text-cyan-200 placeholder-slate-600 focus:outline-none focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400"
          />
        </div>

        <div className="text-xs font-mono text-slate-400">
          Hiển thị <span className="text-cyan-300 font-bold">{filteredKeys.length}</span> / {keys.length} Client Keys
        </div>
      </div>

      {pollResult && (
        <div className="p-3 rounded-lg bg-emerald-950/40 border border-emerald-500/40 text-xs font-mono text-emerald-300 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ArrowDownCircle className="w-4 h-4 text-emerald-400" />
            <span>
              Kết quả poll <strong>[{pollResult.clientKey}]</strong>: <code className="bg-black/50 px-2 py-0.5 rounded text-cyan-300">{pollResult.command}</code>
            </span>
          </div>
        </div>
      )}

      {/* Grid of Clients */}
      {filteredKeys.length === 0 ? (
        <div className="p-12 text-center rounded-xl cyber-box border border-dashed border-cyan-500/20 text-slate-400 font-mono text-xs">
          <AlertCircle className="w-8 h-8 text-cyan-500/40 mx-auto mb-3 animate-pulse" />
          <p className="text-sm font-semibold text-slate-300 mb-1">Chưa có Client Key nào kết nối hoặc khớp với tìm kiếm</p>
          <p className="text-slate-500 text-xs">Dùng thanh "Gửi lệnh Queue" ở trên để gửi tin thử nghiệm hoặc gọi API từ Client.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredKeys.map((key) => {
            const data = clientsData[key] || { queue: [], events: [] };
            const queueCount = data.queue?.length || 0;
            const eventsCount = data.events?.length || 0;

            return (
              <div
                key={key}
                className="relative overflow-hidden rounded-xl cyber-box border border-cyan-500/20 hover:border-cyan-400/40 transition duration-300 shadow-lg p-5"
              >
                {/* Left accent indicator */}
                <div className="absolute top-0 left-0 w-1 h-full bg-gradient-to-b from-cyan-400 to-emerald-400" />

                {/* Card Header */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-cyan-500/10 pb-3 mb-4">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-cyan-950/60 border border-cyan-500/30 text-cyan-400 font-mono text-xs">
                      🔑 KEY
                    </div>
                    <div>
                      <h3 className="text-base font-bold font-orbitron text-cyan-300 flex items-center gap-2">
                        {key}
                        <button
                          onClick={() => copyToClipboard(key, `key-${key}`)}
                          className="text-slate-500 hover:text-cyan-400 transition"
                          title="Copy Key"
                        >
                          {copiedKey === `key-${key}` ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                        </button>
                      </h3>
                      <div className="flex items-center gap-3 text-[11px] font-mono text-slate-400 mt-0.5">
                        <span className="text-emerald-400">Queue: {queueCount} lệnh</span>
                        <span className="text-amber-400">Events: {eventsCount} nhật ký</span>
                      </div>
                    </div>
                  </div>

                  {/* Actions for this client */}
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handlePoll(key)}
                      disabled={pollingKey === key || queueCount === 0}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/40 text-xs font-mono text-emerald-300 transition disabled:opacity-40 disabled:cursor-not-allowed"
                      title="Mô phỏng client gọi GET /poll để lấy lệnh tiếp theo"
                    >
                      <ArrowDownCircle className={`w-3.5 h-3.5 ${pollingKey === key ? 'animate-spin' : ''}`} />
                      <span>POLL TIẾP THEO</span>
                    </button>

                    <button
                      onClick={() => onClearClient(key)}
                      className="p-1.5 rounded-lg bg-rose-950/40 hover:bg-rose-900/60 border border-rose-500/40 text-rose-300 transition"
                      title="Xóa dữ liệu client này"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Data Panels (Queue & Events) */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  
                  {/* Panel 1: Queue list */}
                  <div className="rounded-lg bg-black/50 border border-cyan-500/10 p-3 flex flex-col">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-mono font-bold text-emerald-400 flex items-center gap-1.5">
                        <Terminal className="w-3.5 h-3.5" /> HÀNG ĐỢI LỆNH ({queueCount})
                      </span>
                      {queueCount > 0 && (
                        <button
                          onClick={() => copyToClipboard(JSON.stringify(data.queue, null, 2), `queue-${key}`)}
                          className="text-[10px] font-mono text-slate-400 hover:text-cyan-300 flex items-center gap-1"
                        >
                          {copiedKey === `queue-${key}` ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                          JSON
                        </button>
                      )}
                    </div>

                    {queueCount === 0 ? (
                      <div className="flex-1 flex items-center justify-center p-6 text-[11px] font-mono text-slate-600 italic border border-dashed border-slate-800 rounded">
                        Hàng đợi trống. Không có lệnh chờ.
                      </div>
                    ) : (
                      <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                        {data.queue.map((cmd, idx) => (
                          <div
                            key={idx}
                            className="p-2 rounded bg-[#090e21] border border-cyan-500/20 text-xs font-mono text-cyan-200 flex items-center justify-between group"
                          >
                            <div className="flex items-center gap-2 overflow-hidden text-ellipsis">
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-950 text-cyan-400 font-bold">
                                #{idx + 1}
                              </span>
                              <span className="truncate">{cmd}</span>
                            </div>
                            <button
                              onClick={() => copyToClipboard(cmd, `cmd-${key}-${idx}`)}
                              className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-cyan-300 transition"
                            >
                              {copiedKey === `cmd-${key}-${idx}` ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Panel 2: Events log */}
                  <div className="rounded-lg bg-black/50 border border-cyan-500/10 p-3 flex flex-col">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-mono font-bold text-amber-400 flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5" /> NHẬT KÝ SỰ KIỆN ({eventsCount})
                      </span>
                      {eventsCount > 0 && (
                        <button
                          onClick={() => copyToClipboard(JSON.stringify(data.events, null, 2), `events-${key}`)}
                          className="text-[10px] font-mono text-slate-400 hover:text-amber-300 flex items-center gap-1"
                        >
                          {copiedKey === `events-${key}` ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                          JSON
                        </button>
                      )}
                    </div>

                    {eventsCount === 0 ? (
                      <div className="flex-1 flex items-center justify-center p-6 text-[11px] font-mono text-slate-600 italic border border-dashed border-slate-800 rounded">
                        Chưa có sự kiện nào được ghi nhận.
                      </div>
                    ) : (
                      <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                        {data.events.slice().reverse().map((ev, idx) => (
                          <div
                            key={idx}
                            className="p-2.5 rounded bg-[#090e21] border border-amber-500/20 text-xs font-mono text-slate-300 space-y-1"
                          >
                            <div className="flex items-center justify-between text-[10px]">
                              <span className="px-1.5 py-0.5 rounded bg-amber-950/80 border border-amber-500/30 text-amber-300 font-semibold">
                                {ev.type || 'LOG'}
                              </span>
                              <span className="text-slate-500">
                                {ev.time ? new Date(ev.time).toLocaleTimeString() : '--:--'}
                              </span>
                            </div>

                            {ev.title && (
                              <div className="font-bold text-amber-200 text-[11px]">
                                {ev.title}
                              </div>
                            )}

                            {ev.message && (
                              <div className="text-slate-300 bg-black/40 p-1.5 rounded border border-white/5 text-[11px]">
                                {ev.message}
                              </div>
                            )}

                            <div className="flex items-center gap-3 text-[10px] text-slate-500 pt-0.5">
                              {ev.player && (
                                <span className="flex items-center gap-1">
                                  <User className="w-3 h-3 text-cyan-400" /> {ev.player}
                                </span>
                              )}
                              {ev.server && (
                                <span className="flex items-center gap-1">
                                  <Server className="w-3 h-3 text-emerald-400" /> {ev.server}
                                </span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                </div>

              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
