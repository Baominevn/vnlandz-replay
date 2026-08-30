import React, { useState } from 'react';
import { AlertTriangle, Check, Copy, FileCode, FolderTree, Terminal, Zap, ShieldCheck } from 'lucide-react';

export const VercelFixGuide: React.FC<{ isOpen: boolean; onClose: () => void }> = ({ isOpen, onClose }) => {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  if (!isOpen) return null;

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const vercelJsonCode = `{
  "rewrites": [
    { "source": "/(style.css|script.js|favicon.ico)", "destination": "/$1" },
    { "source": "/api/(.*)", "destination": "/api/index.js" },
    { "source": "/(login|logout|admin/data|poll|send|events|push)", "destination": "/api/index.js" },
    { "source": "/((?!api|style.css|script.js).*)", "destination": "/index.html" }
  ]
}`;

  const vercelJsonV3Standard = `{
  "rewrites": [
    { "source": "/api/(.*)", "destination": "/api/index.js" },
    { "source": "/(poll|send|events|push|login|logout|admin/data)", "destination": "/api/index.js" }
  ]
}`;

  const directoryTree = `project-root/
├── api/
│   └── index.js      <-- [QUAN TRỌNG] Chuyển code server.js vào đây
├── public/ (hoặc root)
│   ├── index.html
│   ├── style.css
│   └── script.js
├── package.json
└── vercel.json       <-- File cấu hình định tuyến`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md overflow-y-auto">
      <div className="relative w-full max-w-4xl bg-[#090e21] border border-cyan-500/30 rounded-xl p-6 shadow-2xl text-slate-200 my-8">
        
        {/* Header */}
        <div className="flex items-center justify-between border-b border-cyan-500/20 pb-4 mb-5">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-400">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-xl font-bold font-orbitron text-cyan-400 tracking-wide">
                HƯỚNG DẪN SỬA LỖI 404 VERCEL (NOT_FOUND)
              </h2>
              <p className="text-xs text-slate-400">
                Mã lỗi: <span className="text-amber-400 font-mono">404: NOT_FOUND (ID: hkg1::...)</span>
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded-lg text-xs font-mono bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition"
          >
            ĐÓNG (ESC)
          </button>
        </div>

        {/* Nguyên nhân */}
        <div className="mb-6 p-4 rounded-lg bg-red-950/20 border border-red-500/30">
          <h3 className="text-sm font-semibold text-red-400 mb-2 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" /> Nguyên nhân gây lỗi 404 trên Vercel:
          </h3>
          <ul className="text-xs space-y-1.5 text-slate-300 list-disc list-inside leading-relaxed">
            <li>
              Vercel thế hệ mới không còn dùng <code className="text-amber-300 bg-black/40 px-1 py-0.5 rounded">builds: server.js</code> nữa mà ưu tiên thư mục <code className="text-cyan-300 bg-black/40 px-1 py-0.5 rounded">/api</code> hoặc <code className="text-cyan-300 bg-black/40 px-1 py-0.5 rounded">rewrites</code>.
            </li>
            <li>
              Cấu hình <code className="text-amber-300 bg-black/40 px-1 py-0.5 rounded">routes</code> cũ khiến Vercel Serverless Function không nhận được request từ frontend, dẫn đến Vercel Edge Server (<span className="text-slate-400">hkg1 = Hong Kong Node</span>) trả về ngay lỗi 404.
            </li>
          </ul>
        </div>

        {/* Các bước khắc phục */}
        <div className="space-y-6">
          
          {/* Bước 1: Cấu trúc thư mục */}
          <div className="p-4 rounded-lg bg-[#050814] border border-cyan-500/20">
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-sm font-bold text-cyan-300 flex items-center gap-2">
                <FolderTree className="w-4 h-4 text-cyan-400" /> BƯỚC 1: Sắp xếp cấu trúc thư mục Vercel
              </h4>
            </div>
            <p className="text-xs text-slate-400 mb-3">
              Tạo thư mục <code className="text-cyan-300 font-mono">api/</code> và đổi tên <code className="text-emerald-300 font-mono">server.js</code> thành <code className="text-emerald-300 font-mono">api/index.js</code>:
            </p>
            <div className="relative">
              <pre className="p-3 bg-black/60 rounded text-xs font-mono text-emerald-400 overflow-x-auto border border-white/5">
                {directoryTree}
              </pre>
            </div>
          </div>

          {/* Bước 2: File vercel.json mới */}
          <div className="p-4 rounded-lg bg-[#050814] border border-cyan-500/20">
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-sm font-bold text-cyan-300 flex items-center gap-2">
                <FileCode className="w-4 h-4 text-cyan-400" /> BƯỚC 2: Cập nhật file <span className="font-mono text-amber-300">vercel.json</span>
              </h4>
              <button
                onClick={() => copyToClipboard(vercelJsonCode, 'vercelJson')}
                className="flex items-center gap-1.5 px-3 py-1 bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 border border-cyan-500/40 rounded text-xs font-mono transition"
              >
                {copiedKey === 'vercelJson' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                {copiedKey === 'vercelJson' ? 'ĐÃ COPY' : 'COPY VERCEL.JSON'}
              </button>
            </div>
            <pre className="p-3 bg-black/60 rounded text-xs font-mono text-cyan-300 overflow-x-auto border border-white/5">
              {vercelJsonCode}
            </pre>
          </div>

          {/* Bước 3: Lưu ý dữ liệu RAM trên Serverless */}
          <div className="p-4 rounded-lg bg-emerald-950/20 border border-emerald-500/30 text-xs text-slate-300">
            <div className="flex items-center gap-2 font-semibold text-emerald-400 mb-1">
              <ShieldCheck className="w-4 h-4" /> Mẹo vận hành mượt mà:
            </div>
            <p className="leading-relaxed text-slate-300">
              Vercel tự động nhận file trong <code className="text-cyan-300 font-mono">/api/index.js</code> làm Serverless Function. Mọi request đến <code className="text-amber-300 font-mono">/poll</code>, <code className="text-amber-300 font-mono">/send</code>, <code className="text-amber-300 font-mono">/events</code>, <code className="text-amber-300 font-mono">/admin/data</code> sẽ chạy trực tiếp không còn bị lỗi 404!
            </p>
          </div>

        </div>

        {/* Footer */}
        <div className="mt-6 pt-4 border-t border-cyan-500/20 flex justify-end">
          <button
            onClick={onClose}
            className="px-5 py-2 rounded-lg text-xs font-bold font-orbitron bg-cyan-500 text-black hover:bg-cyan-400 shadow-lg shadow-cyan-500/20 transition"
          >
            ĐÃ HIỂU, QUAY LẠI DASHBOARD
          </button>
        </div>

      </div>
    </div>
  );
};
