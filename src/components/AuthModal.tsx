import React, { useState } from 'react';
import { Lock, ShieldAlert, KeyRound, ArrowRight } from 'lucide-react';

interface AuthModalProps {
  onLogin: (user: string, pass: string) => Promise<boolean>;
  isOpen: boolean;
}

export const AuthModal: React.FC<AuthModalProps> = ({ onLogin, isOpen }) => {
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('admin1234');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const ok = await onLogin(username, password);
    setLoading(false);
    if (!ok) {
      setError('Xác thực thất bại! Kiểm tra lại tài khoản hoặc mật khẩu.');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md">
      <div className="relative w-full max-w-md p-8 rounded-2xl cyber-box border border-cyan-500/40 shadow-2xl text-slate-100">
        
        {/* Top badge */}
        <div className="text-center mb-6">
          <span className="inline-block px-3 py-1 text-[10px] font-mono tracking-widest text-cyan-400 bg-cyan-950/80 border border-cyan-500/30 rounded-full mb-3 animate-pulse">
            SECURE ACCESS REQUIRED
          </span>
          <h2 className="text-2xl font-black font-orbitron tracking-wider text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-emerald-400">
            VNLANDZ RELAY
          </h2>
          <p className="text-xs text-slate-400 mt-1 font-mono">
            Vui lòng đăng nhập quản trị hệ thống Nexus
          </p>
        </div>

        {error && (
          <div className="mb-4 p-3 rounded-lg bg-rose-950/50 border border-rose-500/40 text-rose-300 text-xs font-mono flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-mono text-cyan-300 mb-1 font-semibold">
              TÊN ĐĂNG NHẬP
            </label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="admin"
              className="w-full px-4 py-2.5 rounded-lg bg-black/70 border border-cyan-500/30 text-sm font-mono text-cyan-200 focus:outline-none focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400 transition"
              required
            />
          </div>

          <div>
            <label className="block text-xs font-mono text-cyan-300 mb-1 font-semibold">
              MẬT KHẨU
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="admin1234"
              className="w-full px-4 py-2.5 rounded-lg bg-black/70 border border-cyan-500/30 text-sm font-mono text-cyan-200 focus:outline-none focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400 transition"
              required
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 px-4 rounded-lg bg-gradient-to-r from-cyan-500 to-teal-400 hover:from-cyan-400 hover:to-teal-300 text-black font-bold font-orbitron text-xs tracking-wider flex items-center justify-center gap-2 shadow-lg shadow-cyan-500/25 transition disabled:opacity-50"
          >
            <KeyRound className="w-4 h-4" />
            {loading ? 'ĐANG XÁC THỰC...' : 'KẾT NỐI HỆ THỐNG'}
          </button>
        </form>

        <div className="mt-6 pt-4 border-t border-cyan-500/10 text-center text-[11px] font-mono text-slate-500">
          Mặc định: <code className="text-cyan-400">admin</code> / <code className="text-cyan-400">admin1234</code>
        </div>

      </div>
    </div>
  );
};
