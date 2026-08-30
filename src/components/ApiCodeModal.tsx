import React, { useState } from 'react';
import { Copy, Check, Code2, Terminal } from 'lucide-react';

export const ApiCodeModal: React.FC<{ isOpen: boolean; onClose: () => void }> = ({ isOpen, onClose }) => {
  const [copiedTab, setCopiedTab] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'lua' | 'curl' | 'node' | 'python'>('lua');

  if (!isOpen) return null;

  const originUrl = typeof window !== 'undefined' ? window.location.origin : 'https://your-domain.vercel.app';

  const copyCode = (code: string, tab: string) => {
    navigator.clipboard.writeText(code);
    setCopiedTab(tab);
    setTimeout(() => setCopiedTab(null), 2000);
  };

  const luaRobloxCode = `-- Roblox Luau Client Script
local HttpService = game:GetService("HttpService")
local CLIENT_KEY = "my-roblox-server-1"
local RELAY_URL = "${originUrl}"

-- 1. Poll lấy lệnh từ Relay Nexus
local function pollCommand()
    local success, response = pcall(function()
        return HttpService:GetAsync(RELAY_URL .. "/poll?clientKey=" .. CLIENT_KEY)
    end)
    
    if success then
        local data = HttpService:JSONDecode(response)
        if data.ok and data.command and data.command ~= "" then
            print("[RELAY NHẬN LỆNH]: " .. data.command)
            -- Xử lý thực thi lệnh trong game ở đây
        end
    end
end

-- 2. Gửi Event Log lên Relay
local function sendEvent(player, message)
    local payload = HttpService:JSONEncode({
        clientKey = CLIENT_KEY,
        client = "Roblox-Game",
        version = "1.0",
        type = "GAME_EVENT",
        title = "Player Action",
        player = player.Name,
        message = message
    })
    
    pcall(function()
        HttpService:PostAsync(RELAY_URL .. "/events", payload, Enum.HttpContentType.ApplicationJson)
    end)
end

-- Vòng lặp poll định kỳ mỗi 2 giây
task.spawn(function()
    while true do
        pollCommand()
        task.wait(2)
    end
end)`;

  const curlCode = `# 1. Lấy lệnh tiếp theo trong hàng đợi (Poll)
curl -X GET "${originUrl}/poll?clientKey=test-client-1"

# 2. Đẩy một lệnh vào hàng đợi (Send Command)
curl -X POST "${originUrl}/send" \\
  -H "Content-Type: application/json" \\
  -d '{"clientKey": "test-client-1", "message": "/give Player1 diamond 64"}'

# 3. Bắn một Sự kiện nhật ký (Push Event Log)
curl -X POST "${originUrl}/events" \\
  -H "Content-Type: application/json" \\
  -d '{
    "clientKey": "test-client-1",
    "player": "Steve",
    "type": "ACHIEVEMENT",
    "title": "Level Up",
    "message": "Player reached Level 50!"
  }'`;

  const nodeCode = `// Node.js / JavaScript Fetch
const RELAY_URL = "${originUrl}";
const CLIENT_KEY = "node-bot-1";

// Poll Command
async function poll() {
  const res = await fetch(\`\${RELAY_URL}/poll?clientKey=\${CLIENT_KEY}\`);
  const data = await res.json();
  if (data.command) {
    console.log("Thực thi lệnh:", data.command);
  }
}

// Send Command
async function sendCommand(cmd) {
  await fetch(\`\${RELAY_URL}/send\`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clientKey: CLIENT_KEY, message: cmd })
  });
}`;

  const pythonCode = `# Python 3 (requests)
import requests
import time

RELAY_URL = "${originUrl}"
CLIENT_KEY = "python-agent-1"

def poll():
    res = requests.get(f"{RELAY_URL}/poll", params={"clientKey": CLIENT_KEY})
    data = res.json()
    if data.get("command"):
        print(f"Lệnh nhận được: {data['command']}")

def send_event(player, msg):
    requests.post(f"{RELAY_URL}/events", json={
        "clientKey": CLIENT_KEY,
        "player": player,
        "message": msg
    })

# Vòng lặp lắng nghe
while True:
    poll()
    time.sleep(2)`;

  const currentCode =
    activeTab === 'lua'
      ? luaRobloxCode
      : activeTab === 'curl'
      ? curlCode
      : activeTab === 'node'
      ? nodeCode
      : pythonCode;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md overflow-y-auto">
      <div className="relative w-full max-w-3xl bg-[#090e21] border border-cyan-500/30 rounded-xl p-6 shadow-2xl text-slate-200 my-8">
        
        {/* Header */}
        <div className="flex items-center justify-between border-b border-cyan-500/20 pb-4 mb-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-cyan-500/10 border border-cyan-500/30 text-cyan-400">
              <Code2 className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-lg font-bold font-orbitron text-cyan-400 tracking-wide">
                API CODE SNIPPETS & TÍCH HỢP
              </h2>
              <p className="text-xs text-slate-400">
                Code mẫu kết nối game/bot tới VnlandZ Relay Server
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

        {/* Language Tabs */}
        <div className="flex items-center gap-2 mb-3">
          {[
            { id: 'lua', label: 'Roblox Luau' },
            { id: 'curl', label: 'cURL / Shell' },
            { id: 'node', label: 'Node.js / JS' },
            { id: 'python', label: 'Python' }
          ].map((t) => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id as any)}
              className={`px-3 py-1.5 rounded-lg text-xs font-mono font-semibold transition ${
                activeTab === t.id
                  ? 'bg-cyan-500 text-black shadow-md shadow-cyan-500/30'
                  : 'bg-black/40 text-slate-400 hover:text-cyan-300 border border-slate-800'
              }`}
            >
              {t.label}
            </button>
          ))}

          <div className="ml-auto">
            <button
              onClick={() => copyCode(currentCode, activeTab)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 border border-cyan-500/40 rounded-lg text-xs font-mono transition"
            >
              {copiedTab === activeTab ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              {copiedTab === activeTab ? 'ĐÃ SAO CHÉP' : 'SAO CHÉP CODE'}
            </button>
          </div>
        </div>

        {/* Code View */}
        <pre className="p-4 bg-black/70 rounded-lg text-xs font-mono text-cyan-200 overflow-x-auto border border-cyan-500/20 max-h-96">
          {currentCode}
        </pre>

        {/* Footer */}
        <div className="mt-4 pt-3 border-t border-cyan-500/20 text-xs font-mono text-slate-400 flex items-center justify-between">
          <span>Relay Base URL: <strong className="text-cyan-300">{originUrl}</strong></span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 transition text-xs"
          >
            Xong
          </button>
        </div>

      </div>
    </div>
  );
};
