import React, { useState } from 'react';
import { Send, PlusCircle, Sparkles, Terminal, MessageSquare, Flame } from 'lucide-react';

interface QuickActionProps {
  onSendMessage: (clientKey: string, message: string) => Promise<boolean>;
  onSendEvent: (clientKey: string, payload: any) => Promise<boolean>;
  activeClientKeys: string[];
}

export const QuickActionHub: React.FC<QuickActionProps> = ({
  onSendMessage,
  onSendEvent,
  activeClientKeys
}) => {
  const [tab, setTab] = useState<'command' | 'event'>('command');
  const [clientKey, setClientKey] = useState<string>('test-client-1');
  const [message, setMessage] = useState<string>('hello world from relay nexus');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [notification, setNotification] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  // Event form states
  const [player, setPlayer] = useState('PlayerOne');
  const [eventType, setEventType] = useState('LOG_ACTION');
  const [eventTitle, setEventTitle] = useState('Boss Defeated');
  const [eventMessage, setEventMessage] = useState('Player defeated CyberDragon lvl 99');
  const [autoQueueCommand, setAutoQueueCommand] = useState(false);

  const showNotification = (msg: string, type: 'success' | 'error' = 'success') => {
    setNotification({ msg, type });
    setTimeout(() => setNotification(null), 3000);
  };

  const handleSendCommand = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!clientKey.trim() || !message.trim()) return;

    setIsSubmitting(true);
    const success = await onSendMessage(clientKey.trim(), message.trim());
    setIsSubmitting(false);

    if (success) {
      showNotification(`Đã gửi lệnh vào hàng đợi của [${clientKey}]!`);
    } else {
      showNotification(`Lỗi khi gửi lệnh!`, 'error');
    }
  };

  const handleSendEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!clientKey.trim()) return;

    setIsSubmitting(true);
    const payload = {
      client: 'web-nexus-tester',
      version: '1.0',
      type: eventType,
      title: eventTitle,
      player: player,
      server: 'Asian-East-Server',
      message: eventMessage,
      autoQueue: autoQueueCommand,
      command: autoQueueCommand ? `/notify ${player} congratulations!` : ''
    };

    const success = await onSendEvent(clientKey.trim(), payload);
    setIsSubmitting(false);

    if (success) {
      showNotification(`Đã bắn Event vào nhật ký của [${clientKey}]!`);
    } else {
      showNotification(`Lỗi khi gửi Event!`, 'error');
    }
  };

  const presetMessages = [
    '/kill @e[type=zombie]',
    '/give Player1 diamond 64',
    'chat Xin chào toàn bộ server VnlandZ!',
    '/gamemode creative',
    'exec:reload_config'
  ];

  return (
    <div className="mb-6 p-4 md:p-6 rounded-xl cyber-box border border-cyan-500/20 shadow-lg">
      
      {/* Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-cyan-500/20 pb-4 mb-4">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setTab('command')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-mono font-bold tracking-wider transition ${
              tab === 'command'
                ? 'bg-cyan-500 text-black shadow-lg shadow-cyan-500/30'
                : 'bg-black/40 text-slate-400 hover:text-cyan-300 border border-slate-800'
            }`}
          >
            <Terminal className="w-3.5 h-3.5" />
            GỬI LỆNH QUEUE (/SEND)
          </button>

          <button
            onClick={() => setTab('event')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-mono font-bold tracking-wider transition ${
              tab === 'event'
                ? 'bg-amber-500 text-black shadow-lg shadow-amber-500/30'
                : 'bg-black/40 text-slate-400 hover:text-amber-300 border border-slate-800'
            }`}
          >
            <Flame className="w-3.5 h-3.5" />
            BẮN EVENT LOG (/EVENTS)
          </button>
        </div>

        {/* Existing Keys Dropdown shortcut */}
        {activeClientKeys.length > 0 && (
          <div className="flex items-center gap-2 text-xs font-mono text-slate-400">
            <span>Chọn Key có sẵn:</span>
            <select
              value={clientKey}
              onChange={(e) => setClientKey(e.target.value)}
              className="bg-black/60 border border-cyan-500/30 text-cyan-300 rounded px-2 py-1 text-xs outline-none"
            >
              {activeClientKeys.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {notification && (
        <div
          className={`mb-4 p-3 rounded-lg text-xs font-mono border transition ${
            notification.type === 'success'
              ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-300'
              : 'bg-rose-950/40 border-rose-500/40 text-rose-300'
          }`}
        >
          {notification.msg}
        </div>
      )}

      {tab === 'command' ? (
        <form onSubmit={handleSendCommand} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-mono text-cyan-300 mb-1.5 font-semibold">
                CLIENT KEY ĐÍCH
              </label>
              <input
                type="text"
                value={clientKey}
                onChange={(e) => setClientKey(e.target.value)}
                placeholder="VD: bot-01 hoặc user-key"
                className="w-full px-3.5 py-2.5 rounded-lg bg-black/60 border border-cyan-500/30 text-sm font-mono text-cyan-200 placeholder-slate-600 focus:outline-none focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400 transition"
                required
              />
            </div>

            <div className="md:col-span-2">
              <label className="block text-xs font-mono text-cyan-300 mb-1.5 font-semibold">
                NỘI DUNG LỆNH / TIN NHẮN CHỜ
              </label>
              <div className="relative">
                <input
                  type="text"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Nhập lệnh hoặc tin nhắn (/chat, /give, command...)"
                  className="w-full px-3.5 py-2.5 rounded-lg bg-black/60 border border-cyan-500/30 text-sm font-mono text-cyan-200 placeholder-slate-600 focus:outline-none focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400 transition pr-28"
                  required
                />
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="absolute right-1 top-1 bottom-1 px-4 rounded-md bg-cyan-500 hover:bg-cyan-400 text-black font-bold font-mono text-xs flex items-center gap-1.5 transition shadow-md shadow-cyan-500/20 disabled:opacity-50"
                >
                  <Send className="w-3.5 h-3.5" />
                  {isSubmitting ? 'ĐANG GỬI...' : 'GỬI ĐI'}
                </button>
              </div>
            </div>
          </div>

          {/* Quick presets */}
          <div className="flex items-center gap-2 flex-wrap pt-2">
            <span className="text-[11px] font-mono text-slate-500 flex items-center gap-1">
              <Sparkles className="w-3 h-3 text-cyan-400" /> Mẫu nhanh:
            </span>
            {presetMessages.map((msg, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setMessage(msg)}
                className="px-2.5 py-1 rounded bg-slate-900/80 hover:bg-cyan-950/60 border border-slate-700/60 hover:border-cyan-500/40 text-[11px] font-mono text-slate-300 hover:text-cyan-300 transition"
              >
                {msg}
              </button>
            ))}
          </div>
        </form>
      ) : (
        <form onSubmit={handleSendEvent} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <label className="block text-xs font-mono text-amber-300 mb-1 font-semibold">
                CLIENT KEY
              </label>
              <input
                type="text"
                value={clientKey}
                onChange={(e) => setClientKey(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-black/60 border border-amber-500/30 text-xs font-mono text-amber-200 focus:outline-none focus:border-amber-400"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-mono text-amber-300 mb-1 font-semibold">
                PLAYER NAME
              </label>
              <input
                type="text"
                value={player}
                onChange={(e) => setPlayer(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-black/60 border border-amber-500/30 text-xs font-mono text-amber-200 focus:outline-none focus:border-amber-400"
              />
            </div>
            <div>
              <label className="block text-xs font-mono text-amber-300 mb-1 font-semibold">
                EVENT TYPE
              </label>
              <input
                type="text"
                value={eventType}
                onChange={(e) => setEventType(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-black/60 border border-amber-500/30 text-xs font-mono text-amber-200 focus:outline-none focus:border-amber-400"
              />
            </div>
            <div>
              <label className="block text-xs font-mono text-amber-300 mb-1 font-semibold">
                EVENT TITLE
              </label>
              <input
                type="text"
                value={eventTitle}
                onChange={(e) => setEventTitle(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-black/60 border border-amber-500/30 text-xs font-mono text-amber-200 focus:outline-none focus:border-amber-400"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-mono text-amber-300 mb-1 font-semibold">
              EVENT MESSAGE
            </label>
            <input
              type="text"
              value={eventMessage}
              onChange={(e) => setEventMessage(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-black/60 border border-amber-500/30 text-xs font-mono text-amber-200 focus:outline-none focus:border-amber-400"
            />
          </div>

          <div className="flex items-center justify-between pt-2">
            <label className="flex items-center gap-2 text-xs font-mono text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={autoQueueCommand}
                onChange={(e) => setAutoQueueCommand(e.target.checked)}
                className="rounded border-slate-700 text-amber-500 focus:ring-amber-400"
              />
              <span>Tự động push kèm phản hồi vào Queue (autoQueue: true)</span>
            </label>

            <button
              type="submit"
              disabled={isSubmitting}
              className="px-5 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-black font-bold font-mono text-xs flex items-center gap-2 transition shadow-md shadow-amber-500/20"
            >
              <Flame className="w-3.5 h-3.5" />
              BẮN EVENT LOG
            </button>
          </div>
        </form>
      )}

    </div>
  );
};
