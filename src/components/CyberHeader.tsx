import React from 'react';
import { Activity, Shield, LogOut, RefreshCw, HelpCircle, Code2, Globe } from 'lucide-react';

interface HeaderProps {
  activeIp: string;
  isAutoRefresh: boolean;
  setIsAutoRefresh: (val: boolean) => void;
  onRefresh: () => void;
  onLogout: () => void;
  onOpenFixGuide: () => void;
  onOpenApiModal: () => void;
  isRefreshing: boolean;
}

export const CyberHeader: React.FC<HeaderProps> = ({
  activeIp,
  isAutoRefresh,
  setIsAutoRefresh,
  onRefresh,
  onLogout,
  onOpenFixGuide,
  onOpenApiModal,
  isRefreshing
}) => {
  return (
    <header className="relative z-10 w-full mb-6 p-4 md:p-6 rounded-xl cyber-box flex flex-col md:flex-row items-start md:items-center justify-between gap-4 border border-cyan-500/20 shadow-lg shadow-cyan-950/20">
      
      {/* Brand & Status */}
      <div className="flex items-center gap-4">
        <div className="relative flex items-center justify-center w-12 h-12 rounded-lg bg-cyan-950/40 border border-cyan-500/40 shadow-inner">
          <Activity className="w-6 h-6 text-cyan-400 animate-pulse" />
          <div className="absolute -top-1 -right-1 w-3 h-3 bg-emerald-500 rounded-full animate-ping opacity-75" />
          <div className="absolute -top-1 -right-1 w-3 h-3 bg-emerald-500 rounded-full" />
        </div>

        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl md:text-2xl font-black font-orbitron text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 via-teal-300 to-emerald-400 tracking-wider">
              VNLANDZ RELAY NEXUS
            </h1>
            <span className="hidden sm:inline-block px-2 py-0.5 text-[10px] font-mono tracking-widest text-cyan-300 bg-cyan-950/60 border border-cyan-500/30 rounded">
              v5.2 PRO
            </span>
          </div>
          <p className="text-xs text-slate-400 flex items-center gap-2 mt-0.5">
            <span className="inline-block w-2 h-2 rounded-full bg-emerald-400"></span>
            Hệ thống chuyển tiếp lệnh & sự kiện trò chơi trực tuyến
          </p>
        </div>
      </div>

      {/* Control Buttons & IP Badge */}
      <div className="flex flex-wrap items-center gap-2.5 w-full md:w-auto justify-end">
        {/* IP tag */}
        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-black/40 border border-slate-700/60 text-xs font-mono text-slate-300">
          <Globe className="w-3.5 h-3.5 text-cyan-400" />
          <span>IP: <strong className="text-cyan-300">{activeIp || '127.0.0.1'}</strong></span>
        </div>

        {/* API Code snippets button */}
        <button
          onClick={onOpenApiModal}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-950/60 hover:bg-cyan-900/60 border border-cyan-500/40 text-xs font-mono text-cyan-300 transition hover:shadow-md hover:shadow-cyan-500/20"
          title="Xem mã kết nối mẫu (Roblox Lua, Python, Node.js)"
        >
          <Code2 className="w-3.5 h-3.5" />
          <span>API SNIPPETS</span>
        </button>

        {/* Sửa lỗi 404 Vercel Button */}
        <button
          onClick={onOpenFixGuide}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-950/40 hover:bg-amber-900/50 border border-amber-500/40 text-xs font-mono text-amber-300 transition hover:shadow-md hover:shadow-amber-500/20"
        >
          <HelpCircle className="w-3.5 h-3.5" />
          <span>SỬA LỖI 404 VERCEL</span>
        </button>

        {/* Auto Refresh Toggle */}
        <label className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-black/40 border border-slate-700/60 text-xs font-mono text-slate-300 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={isAutoRefresh}
            onChange={(e) => setIsAutoRefresh(e.target.checked)}
            className="w-3.5 h-3.5 text-cyan-500 rounded bg-slate-900 border-slate-600 focus:ring-cyan-400"
          />
          <span>Auto 3s</span>
        </label>

        {/* Manual Refresh */}
        <button
          onClick={onRefresh}
          disabled={isRefreshing}
          className={`p-2 rounded-lg bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-500/40 text-cyan-300 transition ${isRefreshing ? 'animate-spin' : ''}`}
          title="Làm mới ngay"
        >
          <RefreshCw className="w-4 h-4" />
        </button>

        {/* Logout */}
        <button
          onClick={onLogout}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-pink-950/40 hover:bg-pink-900/50 border border-pink-500/40 text-xs font-mono text-pink-300 transition"
        >
          <LogOut className="w-3.5 h-3.5" />
          <span>ĐĂNG XUẤT</span>
        </button>
      </div>

    </header>
  );
};
