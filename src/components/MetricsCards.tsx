import React from 'react';
import { KeyRound, Inbox, Terminal, ShieldCheck, Zap } from 'lucide-react';
import { ServerStats } from '../types';

interface MetricsProps {
  stats: ServerStats;
  totalQueued: number;
  totalEvents: number;
}

export const MetricsCards: React.FC<MetricsProps> = ({ stats, totalQueued, totalEvents }) => {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
      
      {/* Metric 1: Total Client Keys */}
      <div className="relative overflow-hidden p-4 rounded-xl cyber-box border border-cyan-500/20 group hover:border-cyan-400/50 transition duration-300">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[11px] font-mono tracking-wider text-slate-400 uppercase">CLIENT KEYS HOẠT ĐỘNG</span>
          <div className="p-2 rounded-lg bg-cyan-500/10 text-cyan-400">
            <KeyRound className="w-4 h-4" />
          </div>
        </div>
        <div className="text-2xl font-black font-orbitron text-cyan-300 tracking-wider">
          {stats.totalClients}
        </div>
        <div className="mt-1 text-[11px] text-slate-500 font-mono">
          Thiết bị / Game client kết nối
        </div>
        <div className="absolute bottom-0 left-0 h-0.5 w-full bg-gradient-to-r from-transparent via-cyan-500 to-transparent opacity-40 group-hover:opacity-100 transition" />
      </div>

      {/* Metric 2: Lệnh trong hàng đợi (Queued) */}
      <div className="relative overflow-hidden p-4 rounded-xl cyber-box border border-emerald-500/20 group hover:border-emerald-400/50 transition duration-300">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[11px] font-mono tracking-wider text-slate-400 uppercase">LỆNH CHỜ (QUEUE)</span>
          <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400">
            <Inbox className="w-4 h-4" />
          </div>
        </div>
        <div className="text-2xl font-black font-orbitron text-emerald-300 tracking-wider">
          {totalQueued}
        </div>
        <div className="mt-1 text-[11px] text-slate-500 font-mono">
          Tin nhắn / Lệnh đang chờ /poll
        </div>
        <div className="absolute bottom-0 left-0 h-0.5 w-full bg-gradient-to-r from-transparent via-emerald-500 to-transparent opacity-40 group-hover:opacity-100 transition" />
      </div>

      {/* Metric 3: Sự kiện Log (Events) */}
      <div className="relative overflow-hidden p-4 rounded-xl cyber-box border border-amber-500/20 group hover:border-amber-400/50 transition duration-300">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[11px] font-mono tracking-wider text-slate-400 uppercase">NHẬT KÝ SỰ KIỆN (EVENTS)</span>
          <div className="p-2 rounded-lg bg-amber-500/10 text-amber-400">
            <Terminal className="w-4 h-4" />
          </div>
        </div>
        <div className="text-2xl font-black font-orbitron text-amber-300 tracking-wider">
          {totalEvents}
        </div>
        <div className="mt-1 text-[11px] text-slate-500 font-mono">
          Log nhận từ game & webhook
        </div>
        <div className="absolute bottom-0 left-0 h-0.5 w-full bg-gradient-to-r from-transparent via-amber-500 to-transparent opacity-40 group-hover:opacity-100 transition" />
      </div>

      {/* Metric 4: Trạng thái Server Relay */}
      <div className="relative overflow-hidden p-4 rounded-xl cyber-box border border-teal-500/20 group hover:border-teal-400/50 transition duration-300">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[11px] font-mono tracking-wider text-slate-400 uppercase">TRẠNG THÁI RELAY</span>
          <div className="p-2 rounded-lg bg-teal-500/10 text-teal-400">
            <ShieldCheck className="w-4 h-4" />
          </div>
        </div>
        <div className="text-sm font-bold font-orbitron text-teal-300 flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-teal-400 animate-ping"></span>
          HIGH-SPEED ONLINE
        </div>
        <div className="mt-2 text-[11px] text-slate-500 font-mono flex items-center gap-1">
          <Zap className="w-3 h-3 text-teal-400" />
          Độ trễ thấp &bull; Tự động giải phóng RAM
        </div>
        <div className="absolute bottom-0 left-0 h-0.5 w-full bg-gradient-to-r from-transparent via-teal-500 to-transparent opacity-40 group-hover:opacity-100 transition" />
      </div>

    </div>
  );
};
