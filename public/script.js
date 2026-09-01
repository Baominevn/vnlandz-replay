// ==========================================
// VnlandZ Minecraft Relay Nexus Frontend Engine
// ==========================================

let globalDataCache = null;
let currentClientKey = "";
let autoRefreshTimer = null;
let isMasked = true;
let socket = null;
let skinViewer = null;

// Command History (I.6)
const CMD_HISTORY_KEY = "vnlandz_cmd_history";
let commandHistory = JSON.parse(localStorage.getItem(CMD_HISTORY_KEY) || "[]");
let historyIndex = -1;

// Minecraft Commands for Autocomplete (I.6)
const MC_COMMANDS = [
  { cmd: "/say", desc: "Phát sóng thông điệp cho toàn bộ người chơi" },
  { cmd: "/gamemode creative", desc: "Chuyển sang chế độ Sáng tạo" },
  { cmd: "/gamemode survival", desc: "Chuyển sang chế độ Sinh tồn" },
  { cmd: "/gamemode spectator", desc: "Chuyển sang chế độ Khán giả" },
  { cmd: "/time set day", desc: "Đặt thời gian trong game thành ban ngày" },
  { cmd: "/time set night", desc: "Đặt thời gian thành ban đêm" },
  { cmd: "/weather clear", desc: "Xóa mưa bão, làm trời quang đãng" },
  { cmd: "/weather thunder", desc: "Bật trời mưa dông sét" },
  { cmd: "/tp", desc: "Dịch chuyển tức thời vị trí người chơi" },
  { cmd: "/kill", desc: "Tiêu diệt entity hoặc người chơi" },
  { cmd: "/give", desc: "Cấp phát vật phẩm cho người chơi" },
  { cmd: "/effect give", desc: "Cấp hiệu ứng potion cho người chơi" },
  { cmd: "/kick", desc: "Đuổi người chơi khỏi máy chủ" },
  { cmd: "/ban", desc: "Cấm vĩnh viễn người chơi vào server" },
  { cmd: "/whitelist add", desc: "Thêm người chơi vào danh sách trắng" },
  { cmd: ".replay start", desc: "Bắt đầu ghi lại Replay Client" },
  { cmd: ".replay stop", desc: "Dừng ghi hình Replay Client" },
  { cmd: ".replay pause", desc: "Tạm dừng phiên Replay" },
];

// Telemetry graph history (IV.1)
const graphHistory = {
  httpReqs: new Array(30).fill(0),
  events: new Array(30).fill(0),
  wsMsgs: new Array(30).fill(0),
};
let lastTelemetryCounters = { http: 0, events: 0, ws: 0 };

document.addEventListener("DOMContentLoaded", () => {
  initTheme();
  initAuthFlow();
  initTabs();
  initCommandDispatcher();
  initSkinViewer();
  initDiscordEmbedBuilder();
  initAnalyticsChart();
  initKeyManager();
  initAuditLogs();
  initAiStudio();
  initLeaderboards();
  initBackupRestore();
  initExportTools();
  initSmartFilters();
  initWebSocket();
  initStaffAndMaintenance();
});

// ==========================================
// 1. Theme Switcher (IV.5)
// ==========================================
function initTheme() {
  const savedTheme = localStorage.getItem("vnlandz_theme") || "cyberpunk";
  setTheme(savedTheme);

  document.querySelectorAll(".theme-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const theme = btn.dataset.theme;
      setTheme(theme);
    });
  });
}

function setTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem("vnlandz_theme", theme);
  document.querySelectorAll(".theme-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.theme === theme);
  });
}

// ==========================================
// 2. Navigation Tabs & Interactive Animations
// ==========================================
function initTabs() {
  document.querySelectorAll(".nav-tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const targetTabId = btn.dataset.tab;
      document.querySelectorAll(".nav-tab-btn").forEach((b) => b.classList.remove("active"));
      document.querySelectorAll(".tab-pane").forEach((pane) => {
        pane.style.display = "none";
        pane.classList.remove("active");
      });

      btn.classList.add("active");
      const targetPane = document.getElementById(targetTabId);
      if (targetPane) {
        targetPane.style.display = "block";
        targetPane.classList.add("active");
      }

      if (targetTabId === "tab-audit") loadAuditLogs();
      if (targetTabId === "tab-keys") loadClientKeys();
      if (targetTabId === "tab-leaderboard") loadLeaderboards();
      if (targetTabId === "tab-staff-admin") loadRbacMatrix();
    });
  });

  // Attach button ripple micro-interactions
  document.querySelectorAll(".btn, .nav-tab-btn, .quick-cmd-btn, .theme-btn").forEach((btn) => {
    btn.addEventListener("pointerdown", (e) => {
      const rect = btn.getBoundingClientRect();
      const ripple = document.createElement("span");
      ripple.className = "btn-click-ripple";
      const size = Math.max(rect.width, rect.height) * 1.5;
      ripple.style.width = ripple.style.height = `${size}px`;
      ripple.style.left = `${e.clientX - rect.left - size / 2}px`;
      ripple.style.top = `${e.clientY - rect.top - size / 2}px`;
      btn.appendChild(ripple);
      setTimeout(() => ripple.remove(), 600);
    });
  });
}

// ==========================================
// 3. Bi-directional WebSocket Engine (I.1)
// ==========================================
function initWebSocket() {
  const wsBadge = document.getElementById("wsStatusBadge");
  const wsDot = document.getElementById("wsStatusDot");
  const wsText = document.getElementById("wsStatusText");

  function connect() {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws/relay?role=dashboard`;

    try {
      socket = new WebSocket(wsUrl);

      socket.onopen = () => {
        if (wsBadge && wsText && wsDot) {
          wsText.innerText = "WS: Trực Tiếp";
          wsBadge.style.color = "var(--mc-green)";
          wsBadge.style.borderColor = "rgba(34, 197, 94, 0.4)";
          wsDot.style.background = "var(--mc-green)";
          wsDot.style.boxShadow = "0 0 8px var(--mc-green)";
        }
      };

      socket.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          handleWebSocketMessage(payload);
        } catch (e) {
          console.error("WS Parse error:", e);
        }
      };

      socket.onclose = () => {
        if (wsBadge && wsText && wsDot) {
          wsText.innerText = "WS: Mất kết nối (Đang thử lại...)";
          wsBadge.style.color = "var(--amber-warning)";
          wsBadge.style.borderColor = "rgba(245, 158, 11, 0.4)";
          wsDot.style.background = "var(--amber-warning)";
          wsDot.style.boxShadow = "none";
        }
        setTimeout(connect, 3000);
      };

      socket.onerror = () => {
        socket.close();
      };
    } catch (e) {
      console.warn("WebSocket init error:", e);
    }
  }

  connect();
}

function handleWebSocketMessage(msg) {
  if (msg.type === "QUEUE_UPDATED" || msg.type === "EVENT_RECEIVED") {
    // If active in dashboard, refresh or update cache directly
    loadDashboardData(false);
  } else if (msg.type === "MAINTENANCE_UPDATED") {
    if (globalDataCache) {
      globalDataCache.maintenance = msg.maintenance;
      renderStaffAndMaintenance(globalDataCache);
    }
  } else if (msg.type === "RBAC_MATRIX_UPDATED") {
    loadRbacMatrix();
  }
}

// ==========================================
// 4. Authentication Flow
// ==========================================
function initAuthFlow() {
  const loginForm = document.getElementById("loginForm");
  const errorMsg = document.getElementById("errorMsg");
  const logoutBtn = document.getElementById("logoutBtn");
  const reloadBtn = document.getElementById("reloadBtn");

  if (loginForm) {
    loginForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      errorMsg.style.display = "none";

      const username = document.getElementById("username").value.trim();
      const password = document.getElementById("admin_password").value.trim();
      const honeypot = document.getElementById("_hp_security_check").value;

      try {
        const res = await fetch("/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username, password, _hp_security_check: honeypot }),
        });

        let data = {};
        const text = await res.text();
        try {
          data = JSON.parse(text);
        } catch {
          data = { ok: false, error: text || `Máy chủ phản hồi mã lỗi HTTP ${res.status}` };
        }

        if (res.ok && data.ok) {
          if (data.token) {
            localStorage.setItem("admin_token", data.token);
          }
          showDashboard();
        } else {
          errorMsg.innerText = data.error || "Sai thông tin đăng nhập!";
          errorMsg.style.display = "block";
        }
      } catch (err) {
        errorMsg.innerText = "Lỗi kết nối máy chủ: " + err.message;
        errorMsg.style.display = "block";
      }
    });
  }

  if (logoutBtn) {
    logoutBtn.addEventListener("click", async () => {
      const token = localStorage.getItem("admin_token") || "";
      await fetch("/logout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
      });
      localStorage.removeItem("admin_token");
      location.reload();
    });
  }

  if (reloadBtn) {
    reloadBtn.addEventListener("click", () => {
      loadDashboardData(true);
    });
  }

  // Check existing login
  loadDashboardData(false);
}

function showDashboard() {
  document.getElementById("loginBox").style.display = "none";
  document.getElementById("dashboardBox").style.display = "block";
  loadDashboardData(true);
  startAutoRefresh();
}

function showLogin() {
  document.getElementById("dashboardBox").style.display = "none";
  document.getElementById("loginBox").style.display = "flex";
  stopAutoRefresh();
}

// ==========================================
// 5. Dashboard Data Fetcher & Renderer
// ==========================================
async function loadDashboardData(showFeedback = false) {
  const token = localStorage.getItem("admin_token") || "";
  try {
    const res = await fetch("/admin/data", {
      headers: {
        Authorization: `Bearer ${token}`,
        "X-Admin-Token": token,
      },
    });

    if (res.status === 401) {
      showLogin();
      return;
    }

    if (res.ok) {
      document.getElementById("loginBox").style.display = "none";
      document.getElementById("dashboardBox").style.display = "block";

      const data = await res.json();
      globalDataCache = data;
      renderMetrics(data);
      renderDiscordConfig(data.config);
      renderClientSelect(data.clientsData, data.clientKeysList);
      renderClientsAndEvents(data.clientsData);
      updateTelemetryGraphData(data.stats);
      renderStaffAndMaintenance(data);

      if (showFeedback) {
        const reloadBtn = document.getElementById("reloadBtn");
        if (reloadBtn) {
          reloadBtn.style.borderColor = "var(--mc-green)";
          setTimeout(() => (reloadBtn.style.borderColor = ""), 600);
        }
      }
    }
  } catch (err) {
    console.error("Fetch data error:", err);
  }
}

function renderMetrics(data) {
  const stats = data.stats || {};
  const totalClients = stats.totalClients || 0;

  const elClients = document.getElementById("statClients");
  const elIp = document.getElementById("ipDisplay");
  const elQ = document.getElementById("statQueues");
  const elE = document.getElementById("statEvents");
  const elDiscordFwd = document.getElementById("statDiscordForwards");
  const discordHeaderBadge = document.getElementById("discordHeaderBadge");
  const clientStatusBadge = document.getElementById("clientStatusBadge");
  const clientStatusText = document.getElementById("clientStatusText");
  const clientStatusDot = document.getElementById("clientStatusDot");
  const headerSubtext = document.getElementById("headerSubtext");
  const statHeapMem = document.getElementById("statHeapMem");
  const statNodeVerTag = document.getElementById("statNodeVerTag");
  const statUptime = document.getElementById("statUptime");
  const statTotalReqs = document.getElementById("statTotalReqs");
  const statSyncRate = document.getElementById("statSyncRate");
  const statDiscordLatency = document.getElementById("statDiscordLatency");

  if (elClients) elClients.innerText = totalClients;
  if (elIp) elIp.innerText = `IP: ${stats.activeIp || "127.0.0.1"}`;
  if (statHeapMem) statHeapMem.innerText = `${stats.memoryHeapUsedMB || "--"} MB`;
  if (statNodeVerTag) statNodeVerTag.innerText = (stats.nodeVersion || "NODE").toUpperCase();
  if (statUptime) statUptime.innerText = formatUptime(stats.uptimeSeconds || 0);
  if (statTotalReqs) statTotalReqs.innerText = Number(stats.totalHttpRequests || 0).toLocaleString();

  if (statSyncRate) {
    const rate = typeof stats.discordSyncRate === "number" ? stats.discordSyncRate : 100;
    statSyncRate.innerText = `${rate}%`;
    statSyncRate.style.color = rate >= 90 ? "#22c55e" : rate >= 60 ? "#fbbf24" : "#ff007f";
  }

  if (statDiscordLatency) {
    if (typeof stats.discordLatencyMs === "number") {
      statDiscordLatency.innerText = `${stats.discordLatencyMs}ms`;
      statDiscordLatency.style.color = stats.discordLatencyMs < 300 ? "#818cf8" : "#fbbf24";
    } else if (data.config?.discordWebhookConfigured) {
      statDiscordLatency.innerText = "Sẵn sàng (Đã kết nối)";
      statDiscordLatency.style.color = "#818cf8";
    } else {
      statDiscordLatency.innerText = "Chưa cấu hình URL";
      statDiscordLatency.style.color = "var(--text-dim)";
    }
  }

  if (headerSubtext) {
    headerSubtext.innerText = `Node.js ${stats.nodeVersion || ""} • Uptime: ${formatUptime(
      stats.uptimeSeconds || 0
    )} • WS & Discord Real-time Sync`;
  }

  let totalQ = 0;
  let totalE = 0;
  if (data.clientsData) {
    for (const k in data.clientsData) {
      totalQ += (data.clientsData[k].queue || []).length;
      totalE += (data.clientsData[k].events || []).length;
    }
  }
  if (elQ) elQ.innerText = totalQ;
  if (elE) elE.innerText = totalE;
  if (elDiscordFwd) elDiscordFwd.innerText = stats.discordForwarded || 0;

  if (discordHeaderBadge) {
    if (data.config?.discordWebhookConfigured) {
      discordHeaderBadge.style.color = "#818cf8";
      discordHeaderBadge.style.borderColor = "rgba(88, 101, 242, 0.4)";
    } else {
      discordHeaderBadge.style.color = "var(--text-dim)";
      discordHeaderBadge.style.borderColor = "var(--border-color)";
    }
  }
}

function renderDiscordConfig(cfg) {
  if (!cfg) return;
  const webhookInput = document.getElementById("discordWebhookInput");
  if (webhookInput && !webhookInput.matches(":focus")) {
    webhookInput.value = cfg.discordWebhookUrl || "";
  }

  setCheckbox("toggleForwardEvents", cfg.forwardEventsToDiscord);
  setCheckbox("toggleForwardChat", cfg.forwardChat);
  setCheckbox("toggleForwardJoinLeave", cfg.forwardJoinLeave);
  setCheckbox("toggleForwardDeaths", cfg.forwardDeaths);
  setCheckbox("toggleForwardCommands", cfg.forwardCommands);

  // Embed Builder config (II.2)
  if (cfg.embedConfig) {
    const embedColorPicker = document.getElementById("embedColorPicker");
    const embedThemeColorInput = document.getElementById("embedThemeColorInput");
    const embedBotTitleInput = document.getElementById("embedBotTitleInput");
    const embedFooterTextInput = document.getElementById("embedFooterTextInput");
    const toggleShowPlayerAvatar = document.getElementById("toggleShowPlayerAvatar");

    if (embedColorPicker) embedColorPicker.value = cfg.embedConfig.themeColor || "#00f2fe";
    if (embedThemeColorInput) embedThemeColorInput.value = cfg.embedConfig.themeColor || "#00f2fe";
    if (embedBotTitleInput) embedBotTitleInput.value = cfg.embedConfig.customTitle || "Minecraft Relay Nexus";
    if (embedFooterTextInput) embedFooterTextInput.value = cfg.embedConfig.footerText || "VnlandZ Relay Bridge • Real-time Sync";
    if (toggleShowPlayerAvatar) toggleShowPlayerAvatar.checked = cfg.embedConfig.showPlayerAvatar !== false;

    updateEmbedPreview();
  }
}

function renderClientSelect(clientsData, keysList) {
  const select = document.getElementById("clientSelect");
  if (!select) return;

  const currentVal = select.value;
  select.innerHTML = '<option value="">-- Chọn Client Key sẵn có --</option>';

  const allKeys = new Set([...Object.keys(clientsData || {}), ...(keysList || []).map((k) => k.key)]);

  allKeys.forEach((key) => {
    const opt = document.createElement("option");
    opt.value = key;
    opt.innerText = key;
    if (key === currentVal || key === currentClientKey) opt.selected = true;
    select.appendChild(opt);
  });
}

function renderClientsAndEvents(clientsData) {
  const container = document.getElementById("contentData");
  if (!container) return;

  const keys = Object.keys(clientsData || {});
  const searchTerm = (document.getElementById("searchInput")?.value || "").toLowerCase().trim();
  const eventType = document.getElementById("eventTypeFilter")?.value || "ALL";

  if (keys.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <p style="font-size: 16px; margin-bottom: 8px;">Chưa có Client nào kết nối</p>
        <p style="font-size: 12.5px; color: var(--text-dim);">Hãy dùng lệnh trên hoặc gửi yêu cầu API với <code>?clientKey=TEN_KEY</code> để tạo Client đầu tiên.</p>
      </div>`;
    return;
  }

  let html = "";
  const detectedPlayers = new Set();

  keys.forEach((key) => {
    const info = clientsData[key] || { queue: [], events: [] };
    const queue = info.queue || [];
    let events = info.events || [];

    // Collect players for Quick 3D Skin Picker (I.3)
    events.forEach((e) => {
      if (e.player && e.player !== "Unknown_Player" && e.player !== "Minecraft Client") {
        detectedPlayers.add(e.player);
      }
    });

    // Filter events by Search Term (Regex or String) and Type (IV.3)
    if (eventType !== "ALL") {
      events = events.filter((e) => (e.type || "").toUpperCase() === eventType);
    }

    if (searchTerm) {
      events = events.filter((e) => {
        try {
          const regex = new RegExp(searchTerm, "i");
          return (
            key.toLowerCase().includes(searchTerm) ||
            regex.test(e.player || "") ||
            regex.test(e.message || "") ||
            regex.test(e.title || "")
          );
        } catch {
          return (
            key.toLowerCase().includes(searchTerm) ||
            (e.player || "").toLowerCase().includes(searchTerm) ||
            (e.message || "").toLowerCase().includes(searchTerm)
          );
        }
      });
    }

    const hasMatch = key.toLowerCase().includes(searchTerm) || events.length > 0;
    if (searchTerm && !hasMatch && eventType === "ALL") return;

    html += `
      <div class="client-card">
        <div class="client-header">
          <div class="client-title">
            <span class="client-key-badge">${escapeHtml(key)}</span>
            <span class="status-micro-tag" style="background: rgba(34, 197, 94, 0.15); color: #4ade80;">ACTIVE</span>
          </div>
          <div style="display: flex; gap: 6px;">
            <button class="btn btn-sm btn-outline btn-send-to-key" data-key="${escapeHtml(key)}" title="Chọn Key này để gửi lệnh">
              <span>✍️ Chọn Gửi Lệnh</span>
            </button>
            <button class="btn btn-sm btn-danger-outline btn-clear-q" data-key="${escapeHtml(key)}" title="Làm sạch hàng đợi">
              <span>🗑️ Clear Queue</span>
            </button>
          </div>
        </div>

        <div class="client-body">
          <!-- Left Column: Command Queue -->
          <div class="queue-pane">
            <div class="pane-title">
              <span>📦 Hàng Đợi Lệnh (${queue.length})</span>
              <span style="font-size: 10px; color: var(--text-dim);">Chờ Minecraft Poll</span>
            </div>
            <div class="queue-list">
              ${
                queue.length === 0
                  ? '<div style="color: var(--text-dim); font-size: 11.5px; padding: 12px 0; text-align: center;">Hàng đợi trống</div>'
                  : queue
                      .map(
                        (cmd, idx) => `
                    <div class="queue-item">
                      <span class="queue-index">#${idx + 1}</span>
                      <span class="queue-text">${escapeHtml(cmd)}</span>
                    </div>`
                      )
                      .join("")
              }
            </div>
          </div>

          <!-- Right Column: Events & Logs -->
          <div class="events-pane">
            <div class="pane-title">
              <span>⚡ Sự Kiện Gần Nhất (${events.length})</span>
              <span style="font-size: 10px; color: var(--text-dim);">Real-time Sync</span>
            </div>
            <div class="events-list">
              ${
                events.length === 0
                  ? '<div style="color: var(--text-dim); font-size: 11.5px; padding: 12px 0; text-align: center;">Chưa có sự kiện nào</div>'
                  : events
                      .slice()
                      .reverse()
                      .map((ev) => {
                        const typeUpper = (ev.type || "LOG").toUpperCase();
                        let typeClass = "type-log";
                        if (typeUpper === "CHAT") typeClass = "type-chat";
                        else if (typeUpper === "JOIN") typeClass = "type-join";
                        else if (typeUpper === "LEAVE") typeClass = "type-leave";
                        else if (typeUpper === "DEATH" || typeUpper === "DAMAGE" || typeUpper === "ALERT")
                          typeClass = "type-death";
                        else if (typeUpper === "COMMAND") typeClass = "type-command";

                        const avatar =
                          ev.player && ev.player !== "Unknown_Player"
                            ? `https://mc-heads.net/avatar/${encodeURIComponent(ev.player)}/32`
                            : "https://mc-heads.net/avatar/MHF_Steve/32";

                        return `
                        <div class="event-item">
                          <div class="event-top">
                            <div style="display: flex; align-items: center; gap: 6px;">
                              <img src="${avatar}" alt="" style="width: 16px; height: 16px; border-radius: 2px;" />
                              <span class="event-player">${escapeHtml(ev.player || "Client")}</span>
                              <span class="event-type-badge ${typeClass}">${escapeHtml(typeUpper)}</span>
                            </div>
                            <span class="event-time">${formatTime(ev.time)}</span>
                          </div>
                          <div class="event-msg">${escapeHtml(ev.message || "")}</div>
                        </div>`;
                      })
                      .join("")
              }
            </div>
          </div>
        </div>
      </div>`;
  });

  container.innerHTML = html;

  // Bind Clear Queue Buttons
  document.querySelectorAll(".btn-clear-q").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      const key = e.currentTarget.dataset.key;
      const token = localStorage.getItem("admin_token") || "";
      await fetch("/admin/clear-queue", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ clientKey: key }),
      });
      loadDashboardData(false);
    });
  });

  // Bind Send To Key Buttons
  document.querySelectorAll(".btn-send-to-key").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const key = e.currentTarget.dataset.key;
      const targetKeyInput = document.getElementById("targetKeyInput");
      const clientSelect = document.getElementById("clientSelect");
      if (targetKeyInput) targetKeyInput.value = key;
      if (clientSelect) clientSelect.value = key;
      currentClientKey = key;
      document.getElementById("commandTextInput")?.focus();
    });
  });

  // Update quick players list in 3D skin tab
  if (detectedPlayers.size > 0) {
    updateQuickPlayersList(Array.from(detectedPlayers));
  }
}

// ==========================================
// 6. Command Dispatcher, History & Autocomplete (I.6)
// ==========================================
function initCommandDispatcher() {
  const form = document.getElementById("commandForm");
  const inputCmd = document.getElementById("commandTextInput");
  const targetKeyInput = document.getElementById("targetKeyInput");
  const clientSelect = document.getElementById("clientSelect");
  const feedback = document.getElementById("cmdFeedback");
  const dropdown = document.getElementById("autocompleteDropdown");

  if (clientSelect) {
    clientSelect.addEventListener("change", (e) => {
      const val = e.target.value;
      if (val && targetKeyInput) {
        targetKeyInput.value = val;
        currentClientKey = val;
      }
    });
  }

  // Quick Preset Command Buttons
  document.querySelectorAll(".quick-cmd-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const cmd = e.currentTarget.dataset.cmd;
      if (inputCmd && cmd) {
        inputCmd.value = cmd;
        inputCmd.focus();
      }
    });
  });

  // History & Autocomplete Keyboard Navigation (I.6)
  if (inputCmd) {
    inputCmd.addEventListener("keydown", (e) => {
      // Arrow Up -> Browse back in history
      if (e.key === "ArrowUp") {
        e.preventDefault();
        if (commandHistory.length > 0) {
          historyIndex = Math.min(historyIndex + 1, commandHistory.length - 1);
          inputCmd.value = commandHistory[commandHistory.length - 1 - historyIndex] || "";
        }
        return;
      }

      // Arrow Down -> Browse forward in history
      if (e.key === "ArrowDown") {
        e.preventDefault();
        if (historyIndex > 0) {
          historyIndex--;
          inputCmd.value = commandHistory[commandHistory.length - 1 - historyIndex] || "";
        } else if (historyIndex === 0) {
          historyIndex = -1;
          inputCmd.value = "";
        }
        return;
      }

      // Tab or Enter when dropdown is active -> Select completion
      if ((e.key === "Tab" || e.key === "Enter") && dropdown && dropdown.style.display === "block") {
        const activeItem = dropdown.querySelector(".autocomplete-item.active") || dropdown.querySelector(".autocomplete-item");
        if (activeItem) {
          e.preventDefault();
          inputCmd.value = activeItem.dataset.cmd + " ";
          dropdown.style.display = "none";
          return;
        }
      }

      if (e.key === "Escape" && dropdown) {
        dropdown.style.display = "none";
      }
    });

    inputCmd.addEventListener("input", (e) => {
      historyIndex = -1;
      const val = e.target.value.trim();
      if (!val.startsWith("/") && !val.startsWith(".")) {
        if (dropdown) dropdown.style.display = "none";
        return;
      }

      const matches = MC_COMMANDS.filter((c) => c.cmd.toLowerCase().startsWith(val.toLowerCase()));
      if (matches.length > 0 && dropdown) {
        dropdown.innerHTML = matches
          .map(
            (c, idx) => `
            <div class="autocomplete-item ${idx === 0 ? "active" : ""}" data-cmd="${c.cmd}">
              <span>${c.cmd}</span>
              <span class="cmd-desc">${c.desc}</span>
            </div>`
          )
          .join("");
        dropdown.style.display = "block";

        dropdown.querySelectorAll(".autocomplete-item").forEach((item) => {
          item.addEventListener("click", () => {
            inputCmd.value = item.dataset.cmd + " ";
            dropdown.style.display = "none";
            inputCmd.focus();
          });
        });
      } else if (dropdown) {
        dropdown.style.display = "none";
      }
    });
  }

  // Form Submit
  if (form) {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (dropdown) dropdown.style.display = "none";
      const clientKey = targetKeyInput.value.trim();
      const command = inputCmd.value.trim();

      if (!clientKey || !command) return;

      // Save to Command History (I.6)
      if (!commandHistory.includes(command)) {
        commandHistory.push(command);
        if (commandHistory.length > 50) commandHistory.shift();
        localStorage.setItem(CMD_HISTORY_KEY, JSON.stringify(commandHistory));
      }
      historyIndex = -1;

      try {
        const token = localStorage.getItem("admin_token") || "";
        const res = await fetch("/send", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ clientKey, command }),
        });

        const data = await res.json();
        if (res.ok && data.ok) {
          feedback.innerHTML = `<span style="color: var(--mc-green);">✅ Đã đẩy lệnh vào Queue [${escapeHtml(
            clientKey
          )}]: ${escapeHtml(command)}</span>`;
          inputCmd.value = "";
          loadDashboardData(false);
        } else {
          feedback.innerHTML = `<span style="color: var(--rose-danger);">❌ Lỗi: ${data.error}</span>`;
        }
      } catch (err) {
        feedback.innerHTML = `<span style="color: var(--rose-danger);">❌ Lỗi: ${err.message}</span>`;
      }
    });
  }
}

// ==========================================
// 7. Interactive 3D Minecraft Skin Viewer & Multi-Action Poses (I.3)
// ==========================================

function resetPlayerPose(viewer) {
  if (!viewer || !viewer.playerObject) return;
  viewer.animation = null;

  const player = viewer.playerObject;
  player.position.set(0, 0, 0);
  player.rotation.set(0, 0, 0);

  const skin = player.skin;
  if (skin) {
    skin.head.rotation.set(0, 0, 0);
    if (skin.body) skin.body.rotation.set(0, 0, 0);
    if (skin.torso) skin.torso.rotation.set(0, 0, 0);
    skin.leftArm.rotation.set(0, 0, 0);
    skin.rightArm.rotation.set(0, 0, 0);
    skin.leftLeg.rotation.set(0, 0, 0);
    skin.rightLeg.rotation.set(0, 0, 0);
  }
}

function setSkinAction(viewer, animOrPoseFn, activeBtnId) {
  if (!viewer || !viewer.playerObject) return;

  // Highlight active button
  document.querySelectorAll(".skin-controls .btn").forEach((btn) => {
    if (btn.id === "skinAnimRotate" || btn.id === "skinAnimPause") return;
    if (btn.id === activeBtnId) {
      btn.classList.add("btn-neon");
      btn.classList.remove("btn-outline");
    } else {
      btn.classList.remove("btn-neon");
      btn.classList.add("btn-outline");
    }
  });

  resetPlayerPose(viewer);

  if (animOrPoseFn) {
    viewer.animation = animOrPoseFn;
  } else {
    viewer.animation = null;
  }
}

function initSkinViewer() {
  const canvas = document.getElementById("skinCanvas");
  if (!canvas || typeof skinview3d === "undefined") return;

  try {
    skinViewer = new skinview3d.SkinViewer({
      canvas: canvas,
      width: 240,
      height: 280,
      skin: "https://mc-heads.net/skin/Steve",
    });

    skinViewer.camera.position.set(0, 0, 70);
    skinViewer.animation = new skinview3d.WalkingAnimation();
    skinViewer.animation.speed = 0.8;
    skinViewer.autoRotate = true;
    skinViewer.autoRotateSpeed = 0.5;

    // Highlight initial walking button
    const initWalkBtn = document.getElementById("skinAnimWalk");
    if (initWalkBtn) {
      initWalkBtn.classList.add("btn-neon");
      initWalkBtn.classList.remove("btn-outline");
    }

    // Load Skin Function
    const loadSkin = (nickname) => {
      if (!nickname) return;
      const clean = nickname.trim().replace(/[^\w\s\-_.]/g, "");
      if (clean && skinViewer) {
        skinViewer.loadSkin(`https://mc-heads.net/skin/${encodeURIComponent(clean)}`);
      }
    };

    // 1. Walking Animation
    document.getElementById("skinAnimWalk")?.addEventListener("click", () => {
      const walkAnim = new skinview3d.WalkingAnimation();
      walkAnim.speed = 0.8;
      setSkinAction(skinViewer, walkAnim, "skinAnimWalk");
    });

    // 2. Running Animation
    document.getElementById("skinAnimRun")?.addEventListener("click", () => {
      const runAnim = new skinview3d.RunningAnimation();
      runAnim.speed = 1.3;
      setSkinAction(skinViewer, runAnim, "skinAnimRun");
    });

    // 3. Flying Animation
    document.getElementById("skinAnimFly")?.addEventListener("click", () => {
      const flyAnim = new skinview3d.FlyingAnimation();
      flyAnim.speed = 1.0;
      setSkinAction(skinViewer, flyAnim, "skinAnimFly");
    });

    // 4. Wave / Vẫy Chào Animation
    document.getElementById("skinAnimWave")?.addEventListener("click", () => {
      const waveAnim = new skinview3d.FunctionAnimation((player, progress) => {
        const skin = player.skin;
        if (!skin) return;
        player.position.set(0, 0, 0);
        player.rotation.set(0, 0, 0);

        // Right arm raised and waving left/right
        skin.rightArm.rotation.x = Math.PI - 0.4;
        skin.rightArm.rotation.y = 0;
        skin.rightArm.rotation.z = Math.sin(progress * 6) * 0.35 + 0.3;

        skin.leftArm.rotation.x = 0;
        skin.leftArm.rotation.y = 0;
        skin.leftArm.rotation.z = 0.08;

        skin.head.rotation.x = 0;
        skin.head.rotation.y = Math.sin(progress * 3) * 0.15;
        skin.head.rotation.z = Math.sin(progress * 3) * 0.08;

        const torso = skin.torso || skin.body;
        if (torso) torso.rotation.set(0, 0, 0);
        skin.leftLeg.rotation.set(0, 0, 0);
        skin.rightLeg.rotation.set(0, 0, 0);
      });
      waveAnim.speed = 0.8;
      setSkinAction(skinViewer, waveAnim, "skinAnimWave");
    });

    // 5. Cute / Nhún nhảy & Lắc đầu
    document.getElementById("skinAnimCute")?.addEventListener("click", () => {
      const cuteAnim = new skinview3d.FunctionAnimation((player, progress) => {
        const skin = player.skin;
        if (!skin) return;

        // Head tilting cutely side to side
        skin.head.rotation.z = Math.sin(progress * 3) * 0.22;
        skin.head.rotation.y = Math.sin(progress * 1.5) * 0.15;
        skin.head.rotation.x = Math.abs(Math.sin(progress * 3.5)) * 0.08;

        // Cute arms slightly held in front/bent
        skin.rightArm.rotation.x = -0.35 + Math.sin(progress * 3) * 0.08;
        skin.rightArm.rotation.y = 0;
        skin.rightArm.rotation.z = 0.28;

        skin.leftArm.rotation.x = -0.35 - Math.sin(progress * 3) * 0.08;
        skin.leftArm.rotation.y = 0;
        skin.leftArm.rotation.z = -0.28;

        const torso = skin.torso || skin.body;
        if (torso) torso.rotation.set(0, 0, 0);
        skin.leftLeg.rotation.set(0, 0, 0);
        skin.rightLeg.rotation.set(0, 0, 0);

        // Body bouncing
        player.position.set(0, Math.abs(Math.sin(progress * 3.5)) * 2, 0);
        player.rotation.set(0, 0, 0);
      });
      cuteAnim.speed = 0.8;
      setSkinAction(skinViewer, cuteAnim, "skinAnimCute");
    });

    // 6. Zombie / Tay vươn thẳng
    document.getElementById("skinAnimZombie")?.addEventListener("click", () => {
      const zombieAnim = new skinview3d.FunctionAnimation((player, progress) => {
        const skin = player.skin;
        if (!skin) return;

        // Both arms straight forward with slight bobbing
        skin.rightArm.rotation.x = -Math.PI / 2 + Math.sin(progress * 2.5) * 0.08;
        skin.rightArm.rotation.y = 0.05;
        skin.rightArm.rotation.z = 0;

        skin.leftArm.rotation.x = -Math.PI / 2 + Math.cos(progress * 2.5) * 0.08;
        skin.leftArm.rotation.y = -0.05;
        skin.leftArm.rotation.z = 0;

        // Zombie slow shamble walk
        skin.leftLeg.rotation.x = Math.sin(progress * 2.5) * 0.35;
        skin.leftLeg.rotation.y = 0;
        skin.leftLeg.rotation.z = 0;

        skin.rightLeg.rotation.x = -Math.sin(progress * 2.5) * 0.35;
        skin.rightLeg.rotation.y = 0;
        skin.rightLeg.rotation.z = 0;

        skin.head.rotation.x = 0.15;
        skin.head.rotation.y = 0;
        skin.head.rotation.z = Math.sin(progress * 1.25) * 0.1;

        const torso = skin.torso || skin.body;
        if (torso) torso.rotation.set(0, 0, 0);

        player.position.set(0, 0, 0);
        player.rotation.set(0, 0, 0);
      });
      zombieAnim.speed = 0.8;
      setSkinAction(skinViewer, zombieAnim, "skinAnimZombie");
    });

    // 7. Sitting Pose (Ngồi)
    document.getElementById("skinPoseSit")?.addEventListener("click", () => {
      const sitPose = new skinview3d.FunctionAnimation((player) => {
        const skin = player.skin;
        if (!skin) return;

        skin.head.rotation.set(0, 0, 0);
        const torso = skin.torso || skin.body;
        if (torso) torso.rotation.set(0, 0, 0);

        // Legs rotated 90 degrees forward
        skin.leftLeg.rotation.set(-Math.PI / 2, -0.1, 0);
        skin.rightLeg.rotation.set(-Math.PI / 2, 0.1, 0);

        // Arms resting on knees/lap
        skin.leftArm.rotation.set(-Math.PI / 3, 0.15, 0);
        skin.rightArm.rotation.set(-Math.PI / 3, -0.15, 0);

        // Lower body down to sitting level
        player.position.set(0, -6, 0);
        player.rotation.set(0, 0, 0);
      });
      setSkinAction(skinViewer, sitPose, "skinPoseSit");
    });

    // 8. Sleep / Lying Down Pose (Nằm ngủ)
    document.getElementById("skinPoseSleep")?.addEventListener("click", () => {
      const sleepPose = new skinview3d.FunctionAnimation((player) => {
        const skin = player.skin;
        if (!skin) return;

        skin.head.rotation.set(0, 0.3, -0.1);
        const torso = skin.torso || skin.body;
        if (torso) torso.rotation.set(0, 0, 0);

        skin.leftLeg.rotation.set(0, 0, 0);
        skin.rightLeg.rotation.set(0, 0, 0);

        skin.leftArm.rotation.set(-0.2, 0, 0.2);
        skin.rightArm.rotation.set(-0.2, 0, -0.2);

        player.rotation.set(-Math.PI / 2, 0, 0);
        player.position.set(0, -10, -8);
      });
      setSkinAction(skinViewer, sleepPose, "skinPoseSleep");
    });

    // 9. Bow Pose (Cúi chào)
    document.getElementById("skinPoseBow")?.addEventListener("click", () => {
      const bowPose = new skinview3d.FunctionAnimation((player) => {
        const skin = player.skin;
        if (!skin) return;

        const torso = skin.torso || skin.body;
        if (torso) torso.rotation.set(0.55, 0, 0);
        skin.head.rotation.set(0.4, 0, 0);

        skin.leftLeg.rotation.set(0, 0, 0);
        skin.rightLeg.rotation.set(0, 0, 0);

        skin.leftArm.rotation.set(0.25, 0, -0.1);
        skin.rightArm.rotation.set(0.25, 0, 0.1);

        player.position.set(0, 0, 0);
        player.rotation.set(0, 0, 0);
      });
      setSkinAction(skinViewer, bowPose, "skinPoseBow");
    });

    // 10. Standing Default Pose (Đứng chuẩn)
    document.getElementById("skinPoseStand")?.addEventListener("click", () => {
      const standPose = new skinview3d.FunctionAnimation((player) => {
        const skin = player.skin;
        if (!skin) return;

        skin.head.rotation.set(0, 0, 0);
        const torso = skin.torso || skin.body;
        if (torso) torso.rotation.set(0, 0, 0);
        skin.leftArm.rotation.set(0, 0, 0);
        skin.rightArm.rotation.set(0, 0, 0);
        skin.leftLeg.rotation.set(0, 0, 0);
        skin.rightLeg.rotation.set(0, 0, 0);

        player.position.set(0, 0, 0);
        player.rotation.set(0, 0, 0);
      });
      setSkinAction(skinViewer, standPose, "skinPoseStand");
    });

    // Pause
    document.getElementById("skinAnimPause")?.addEventListener("click", () => {
      skinViewer.animation = null;
      skinViewer.autoRotate = false;
      document.querySelectorAll(".skin-controls .btn").forEach((btn) => {
        if (btn.id !== "skinAnimRotate" && btn.id !== "skinAnimPause") {
          btn.classList.remove("btn-neon");
          btn.classList.add("btn-outline");
        }
      });
    });

    // Toggle Auto Rotate
    document.getElementById("skinAnimRotate")?.addEventListener("click", () => {
      skinViewer.autoRotate = !skinViewer.autoRotate;
      const rotateBtn = document.getElementById("skinAnimRotate");
      if (rotateBtn) {
        rotateBtn.classList.toggle("btn-neon", skinViewer.autoRotate);
        rotateBtn.classList.toggle("btn-outline", !skinViewer.autoRotate);
      }
    });

    // Load Skin By Nickname click & enter
    document.getElementById("loadSkinBtn")?.addEventListener("click", () => {
      const input = document.getElementById("skinPlayerInput");
      if (input) loadSkin(input.value);
    });

    document.getElementById("skinPlayerInput")?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        loadSkin(e.target.value);
      }
    });
  } catch (err) {
    console.warn("3D SkinViewer init:", err);
  }
}

function updateQuickPlayersList(players) {
  const container = document.getElementById("quickPlayersList");
  const countTag = document.getElementById("quickPlayersCountTag");
  if (!container) return;

  if (!Array.isArray(players) || players.length === 0) {
    container.innerHTML = `<span style="font-size: 11.5px; color: var(--text-dim); padding: 4px;">Chưa có người chơi nào trong logs</span>`;
    return;
  }

  // Deduplicate and filter valid player names
  const validPlayers = Array.from(new Set(
    players
      .filter((p) => p && typeof p === "string")
      .map((p) => p.trim())
      .filter((p) => p.length > 0 && p !== "Unknown_Player" && p !== "Minecraft Client" && p !== "Admin / Discord Bridge")
  ));

  if (countTag) {
    countTag.innerText = `${validPlayers.length} người chơi từ logs`;
  }

  container.innerHTML = validPlayers
    .map(
      (p) => `
      <button type="button" class="quick-cmd-btn" data-player="${escapeHtml(p)}" title="Bấm để tải ngay skin 3D của ${escapeHtml(p)}" style="display: inline-flex; align-items: center; gap: 6px;">
        <img src="https://mc-heads.net/avatar/${encodeURIComponent(p)}/24" alt="" style="width: 14px; height: 14px; border-radius: 2px; image-rendering: pixelated;" />
        <span>${escapeHtml(p)}</span>
      </button>`
    )
    .join("");

  // Direct click handler to immediately load skin into 3D viewer
  container.querySelectorAll(".quick-cmd-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const player = e.currentTarget.dataset.player;
      const input = document.getElementById("skinPlayerInput");
      if (input && player) input.value = player;
      if (skinViewer && player) {
        skinViewer.loadSkin(`https://mc-heads.net/skin/${encodeURIComponent(player)}`);
      }
    });
  });
}

// ==========================================
// 8. Discord Embed Visual Builder & Bridge (II.1, II.2)
// ==========================================
function initDiscordEmbedBuilder() {
  const colorPicker = document.getElementById("embedColorPicker");
  const colorInput = document.getElementById("embedThemeColorInput");
  const botTitleInput = document.getElementById("embedBotTitleInput");
  const footerTextInput = document.getElementById("embedFooterTextInput");
  const toggleShowPlayerAvatar = document.getElementById("toggleShowPlayerAvatar");
  const saveBtn = document.getElementById("saveDiscordBtn");
  const testBtn = document.getElementById("testDiscordBtn");
  const toggleMaskBtn = document.getElementById("toggleMaskWebhookBtn");
  const d2mcForm = document.getElementById("discordToMcForm");

  // Sync Color Inputs
  if (colorPicker && colorInput) {
    colorPicker.addEventListener("input", (e) => {
      colorInput.value = e.target.value;
      updateEmbedPreview();
    });
    colorInput.addEventListener("input", (e) => {
      colorPicker.value = e.target.value;
      updateEmbedPreview();
    });
  }

  [botTitleInput, footerTextInput, toggleShowPlayerAvatar].forEach((el) => {
    el?.addEventListener("input", updateEmbedPreview);
  });

  if (toggleMaskBtn) {
    toggleMaskBtn.addEventListener("click", () => {
      const webhookInput = document.getElementById("discordWebhookInput");
      if (webhookInput) {
        isMasked = !isMasked;
        webhookInput.type = isMasked ? "password" : "text";
        toggleMaskBtn.innerText = isMasked ? "Hiện Link" : "Ẩn Link";
      }
    });
  }

  // Save Discord Settings
  if (saveBtn) {
    saveBtn.addEventListener("click", async () => {
      const webhookInput = document.getElementById("discordWebhookInput");
      const statusDiv = document.getElementById("discordSaveStatus");
      const token = localStorage.getItem("admin_token") || "";

      const body = {
        discordWebhookUrl: webhookInput.value.trim(),
        forwardEventsToDiscord: document.getElementById("toggleForwardEvents")?.checked,
        forwardChat: document.getElementById("toggleForwardChat")?.checked,
        forwardJoinLeave: document.getElementById("toggleForwardJoinLeave")?.checked,
        forwardDeaths: document.getElementById("toggleForwardDeaths")?.checked,
        forwardCommands: document.getElementById("toggleForwardCommands")?.checked,
        embedConfig: {
          themeColor: colorInput.value.trim() || "#00f2fe",
          customTitle: botTitleInput.value.trim() || "Minecraft Relay Nexus",
          footerText: footerTextInput.value.trim() || "VnlandZ Relay Bridge • Real-time Sync",
          showPlayerAvatar: toggleShowPlayerAvatar?.checked !== false,
        },
      };

      try {
        const res = await fetch("/admin/settings", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify(body),
        });

        const data = await res.json();
        if (res.ok && data.ok) {
          statusDiv.innerHTML = `<span style="color: var(--mc-green);">✅ Đã lưu cấu hình Discord & Embed thành công!</span>`;
          loadDashboardData(false);
        } else {
          statusDiv.innerHTML = `<span style="color: var(--rose-danger);">❌ Lỗi: ${data.error}</span>`;
        }
      } catch (err) {
        statusDiv.innerHTML = `<span style="color: var(--rose-danger);">❌ Lỗi: ${err.message}</span>`;
      }
    });
  }

  // Test Discord Message
  if (testBtn) {
    testBtn.addEventListener("click", async () => {
      const webhookInput = document.getElementById("discordWebhookInput");
      const statusDiv = document.getElementById("discordSaveStatus");
      const token = localStorage.getItem("admin_token") || "";

      statusDiv.innerHTML = `<span style="color: var(--amber-warning);">⏳ Đang gửi tin nhắn test đến Discord...</span>`;

      try {
        const res = await fetch("/admin/test-discord", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ webhookUrl: webhookInput.value.trim() }),
        });

        const data = await res.json();
        if (res.ok && data.ok) {
          statusDiv.innerHTML = `<span style="color: var(--mc-green);">⚡ ${data.message}</span>`;
          loadDashboardData(false);
        } else {
          statusDiv.innerHTML = `<span style="color: var(--rose-danger);">❌ ${data.error}</span>`;
        }
      } catch (err) {
        statusDiv.innerHTML = `<span style="color: var(--rose-danger);">❌ Lỗi: ${err.message}</span>`;
      }
    });
  }

  // Discord -> Minecraft Inbound Bridge Simulator (II.1)
  if (d2mcForm) {
    d2mcForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const author = document.getElementById("d2mcAuthor")?.value.trim();
      const channel = document.getElementById("d2mcChannel")?.value.trim();
      const content = document.getElementById("d2mcContent")?.value.trim();
      const feedback = document.getElementById("d2mcFeedback");

      try {
        const res = await fetch("/api/discord-to-mc", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            clientKey: currentClientKey || "vnlandz_main",
            author,
            channel,
            content,
          }),
        });

        const data = await res.json();
        if (res.ok && data.ok) {
          feedback.innerHTML = `<span style="color: var(--mc-green);">✅ Đã bắn vào Minecraft: ${escapeHtml(
            data.queuedCommand
          )}</span>`;
          document.getElementById("d2mcContent").value = "";
          loadDashboardData(false);
        } else {
          feedback.innerHTML = `<span style="color: var(--rose-danger);">❌ Lỗi: ${data.error}</span>`;
        }
      } catch (err) {
        feedback.innerHTML = `<span style="color: var(--rose-danger);">❌ Lỗi: ${err.message}</span>`;
      }
    });
  }
}

function updateEmbedPreview() {
  const color = document.getElementById("embedThemeColorInput")?.value || "#00f2fe";
  const title = document.getElementById("embedBotTitleInput")?.value || "Minecraft Relay Nexus";
  const footer = document.getElementById("embedFooterTextInput")?.value || "VnlandZ Relay Bridge • Real-time Sync";
  const showAvatar = document.getElementById("toggleShowPlayerAvatar")?.checked !== false;

  const previewBox = document.getElementById("previewEmbedBox");
  const previewTitle = document.getElementById("previewBotTitle");
  const previewFooter = document.getElementById("previewFooterText");
  const previewPlayerHead = document.getElementById("previewPlayerHead");

  if (previewBox) previewBox.style.borderLeftColor = color;
  if (previewTitle) previewTitle.innerText = title;
  if (previewFooter) previewFooter.innerText = footer;
  if (previewPlayerHead) previewPlayerHead.style.display = showAvatar ? "inline-block" : "none";
}

// ==========================================
// 9. Real-time Analytics Canvas Waveform (IV.1)
// ==========================================
function initAnalyticsChart() {
  const canvas = document.getElementById("analyticsChartCanvas");
  if (!canvas) return;

  const ctx = canvas.getContext("2d");

  function drawChart() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const w = canvas.width;
    const h = canvas.height;
    const padding = 16;
    const pointsCount = graphHistory.httpReqs.length;
    const stepX = (w - padding * 2) / (pointsCount - 1);

    // Draw Grid Lines
    ctx.strokeStyle = "rgba(255, 255, 255, 0.05)";
    ctx.lineWidth = 1;
    for (let y = padding; y < h - padding; y += 24) {
      ctx.beginPath();
      ctx.moveTo(padding, y);
      ctx.lineTo(w - padding, y);
      ctx.stroke();
    }

    // Helper to draw series
    function drawSeries(data, color, fillAlpha) {
      const maxVal = Math.max(...data, 10);
      ctx.strokeStyle = color;
      ctx.fillStyle = color.replace(")", `, ${fillAlpha})`).replace("rgb", "rgba");
      ctx.lineWidth = 2;

      ctx.beginPath();
      ctx.moveTo(padding, h - padding - (data[0] / maxVal) * (h - padding * 2));

      for (let i = 1; i < pointsCount; i++) {
        const x = padding + i * stepX;
        const y = h - padding - (data[i] / maxVal) * (h - padding * 2);
        ctx.lineTo(x, y);
      }

      ctx.stroke();
    }

    drawSeries(graphHistory.httpReqs, "#00f2fe", 0.1);
    drawSeries(graphHistory.events, "#4ade80", 0.1);
    drawSeries(graphHistory.wsMsgs, "#818cf8", 0.1);

    requestAnimationFrame(drawChart);
  }

  requestAnimationFrame(drawChart);
}

function updateTelemetryGraphData(stats) {
  if (!stats) return;
  const currentHttp = stats.totalHttpRequests || 0;
  const currentEvents = stats.totalEventRequests || 0;

  const deltaHttp = Math.max(0, currentHttp - lastTelemetryCounters.http);
  const deltaEvents = Math.max(0, currentEvents - lastTelemetryCounters.events);

  lastTelemetryCounters.http = currentHttp;
  lastTelemetryCounters.events = currentEvents;

  graphHistory.httpReqs.shift();
  graphHistory.httpReqs.push(deltaHttp);

  graphHistory.events.shift();
  graphHistory.events.push(deltaEvents);

  graphHistory.wsMsgs.shift();
  graphHistory.wsMsgs.push(stats.wsConnections || 1);
}

// ==========================================
// 10. Multi-Tenant Client Key Management (I.2)
// ==========================================
function initKeyManager() {
  const openModalBtn = document.getElementById("openAddKeyModalBtn");
  const closeModalBtn = document.getElementById("closeKeyModalBtn");
  const cancelModalBtn = document.getElementById("cancelKeyModalBtn");
  const keyModal = document.getElementById("keyModal");
  const keyForm = document.getElementById("keyForm");
  const genBtn = document.getElementById("genRandomKeyBtn");

  if (openModalBtn) {
    openModalBtn.addEventListener("click", () => {
      document.getElementById("modalKeyInput").value = "";
      document.getElementById("modalLabelInput").value = "";
      document.getElementById("modalNotesInput").value = "";
      keyModal.classList.add("active");
    });
  }

  [closeModalBtn, cancelModalBtn].forEach((btn) => {
    btn?.addEventListener("click", () => keyModal.classList.remove("active"));
  });

  if (genBtn) {
    genBtn.addEventListener("click", () => {
      const rand = "key_" + Math.random().toString(36).substring(2, 10);
      document.getElementById("modalKeyInput").value = rand;
      document.getElementById("modalLabelInput").value = "Bot " + rand;
    });
  }

  if (keyForm) {
    keyForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const token = localStorage.getItem("admin_token") || "";
      const key = document.getElementById("modalKeyInput").value.trim();
      const label = document.getElementById("modalLabelInput").value.trim();
      const status = document.getElementById("modalStatusSelect").value;
      const notes = document.getElementById("modalNotesInput").value.trim();

      try {
        const res = await fetch("/admin/keys", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ key, label, status, notes }),
        });

        const data = await res.json();
        if (res.ok && data.ok) {
          keyModal.classList.remove("active");
          loadClientKeys();
          loadDashboardData(false);
        } else {
          alert("Lỗi: " + data.error);
        }
      } catch (err) {
        alert("Lỗi kết nối: " + err.message);
      }
    });
  }
}

async function loadClientKeys() {
  const container = document.getElementById("keysContainer");
  if (!container) return;

  const token = localStorage.getItem("admin_token") || "";
  try {
    const res = await fetch("/admin/keys", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    if (res.ok && data.ok) {
      renderKeyCards(data.keys || []);
    }
  } catch (err) {
    console.error("Load keys error:", err);
  }
}

function renderKeyCards(keys) {
  const container = document.getElementById("keysContainer");
  if (!container) return;

  if (keys.length === 0) {
    container.innerHTML = `
      <div class="empty-state" style="padding: 34px 20px; text-align: center; background: rgba(0,0,0,0.3); border-radius: 12px; border: 1px dashed var(--border-color);">
        <div style="font-size: 28px; margin-bottom: 8px;">🔑</div>
        <p style="font-size: 15px; font-weight: 700; color: #ffffff; margin-bottom: 6px;">Chưa Có Client Key Nào</p>
        <p style="font-size: 12.5px; color: var(--text-dim); margin-bottom: 16px; max-width: 480px; margin-left: auto; margin-right: auto;">
          Hệ thống không tự tạo Client Key giả. Hãy tạo Client Key mới bên dưới hoặc kết nối từ Minecraft Bot với tham số <code>?clientKey=TEN_KEY</code>.
        </p>
        <button type="button" class="btn btn-sm btn-neon" onclick="document.getElementById('openAddKeyModalBtn')?.click()">
          <span>➕ Tạo Client Key Mới</span>
        </button>
      </div>`;
    return;
  }

  container.innerHTML = keys
    .map(
      (k) => `
      <div class="key-card">
        <div>
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
            <strong style="color: #60a5fa; font-family: 'JetBrains Mono', monospace; font-size: 13px;">${escapeHtml(
              k.key
            )}</strong>
            <span class="status-micro-tag" style="${
              k.status === "active"
                ? "background: rgba(34, 197, 94, 0.2); color: #4ade80;"
                : "background: rgba(239, 68, 68, 0.2); color: #f87171;"
            }">${k.status.toUpperCase()}</span>
          </div>
          <div style="font-size: 12px; font-weight: 600; color: #ffffff; margin-bottom: 4px;">${escapeHtml(
            k.label
          )}</div>
          <div style="font-size: 11px; color: var(--text-dim);">${escapeHtml(k.notes || "Không có ghi chú")}</div>
          <div style="font-size: 10px; color: var(--text-dim); margin-top: 8px;">Hoạt động gần nhất: ${new Date(
            k.lastSeen || k.createdAt
          ).toLocaleTimeString()}</div>
        </div>

        <div style="display: flex; gap: 8px; margin-top: 12px;">
          <button class="btn btn-sm btn-outline btn-copy-key" data-key="${escapeHtml(
            k.key
          )}" style="flex: 1;">📋 Sao Chép</button>
          <button class="btn btn-sm btn-danger-outline btn-del-key" data-key="${escapeHtml(
            k.key
          )}">🗑️ Xóa</button>
        </div>
      </div>`
    )
    .join("");

  // Copy Key
  container.querySelectorAll(".btn-copy-key").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const key = e.currentTarget.dataset.key;
      navigator.clipboard.writeText(key);
      btn.innerText = "✓ Đã Chép!";
      setTimeout(() => (btn.innerText = "📋 Sao Chép"), 1500);
    });
  });

  // Delete Key
  container.querySelectorAll(".btn-del-key").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      const key = e.currentTarget.dataset.key;
      if (!confirm(`Bạn có chắc chắn muốn xóa Client Key "${key}"?`)) return;

      const token = localStorage.getItem("admin_token") || "";
      await fetch(`/admin/keys/${encodeURIComponent(key)}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      loadClientKeys();
      loadDashboardData(false);
    });
  });
}

// ==========================================
// 11. Audit Logs (III.3)
// ==========================================
function initAuditLogs() {
  document.getElementById("reloadAuditBtn")?.addEventListener("click", loadAuditLogs);
}

async function loadAuditLogs() {
  const tbody = document.getElementById("auditTableBody");
  if (!tbody) return;

  const token = localStorage.getItem("admin_token") || "";
  try {
    const res = await fetch("/admin/audit-logs?limit=50", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    if (res.ok && data.ok) {
      renderAuditLogs(data.logs || []);
    }
  } catch (err) {
    console.error("Audit log load error:", err);
  }
}

function renderAuditLogs(logs) {
  const tbody = document.getElementById("auditTableBody");
  if (!tbody) return;

  if (logs.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--text-dim); padding: 20px;">Chưa có nhật ký kiểm toán</td></tr>`;
    return;
  }

  tbody.innerHTML = logs
    .map((l) => {
      let badgeColor = "#60a5fa";
      if (l.severity === "warn") badgeColor = "#fbbf24";
      if (l.severity === "security") badgeColor = "#f87171";

      return `
      <tr>
        <td style="font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--text-dim);">${formatTime(
          l.time
        )}</td>
        <td style="font-family: 'JetBrains Mono', monospace; font-size: 11px;">${escapeHtml(l.ip)}</td>
        <td><strong style="color: #ffffff;">${escapeHtml(l.action)}</strong></td>
        <td><span class="status-micro-tag" style="background: rgba(255,255,255,0.1); color: ${badgeColor};">${l.severity.toUpperCase()}</span></td>
        <td style="color: var(--text-main); font-size: 11.5px;">${escapeHtml(l.details)}</td>
      </tr>`;
    })
    .join("");
}

// ==========================================
// 12. Gemini AI Studio Integration (V.5)
// ==========================================
function initAiStudio() {
  const summarizeBtn = document.getElementById("btnAiSummarize");
  const filterBtn = document.getElementById("btnAiFilterCheck");
  const summarizeOutput = document.getElementById("aiSummarizeOutput");
  const filterInput = document.getElementById("aiFilterInput");
  const filterOutput = document.getElementById("aiFilterOutput");

  if (summarizeBtn) {
    summarizeBtn.addEventListener("click", async () => {
      const token = localStorage.getItem("admin_token") || "";
      summarizeOutput.innerHTML = "⏳ <em>Gemini 3.7 Flash đang phân tích log sự kiện và chat... Vui lòng chờ vài giây...</em>";

      try {
        const res = await fetch("/admin/ai/summarize", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ clientKey: currentClientKey || "" }),
        });

        const data = await res.json();
        if (res.ok && data.ok) {
          summarizeOutput.innerText = data.summary;
        } else {
          summarizeOutput.innerHTML = `<span style="color: var(--rose-danger);">❌ Lỗi AI: ${data.error}</span>`;
        }
      } catch (err) {
        summarizeOutput.innerHTML = `<span style="color: var(--rose-danger);">❌ Lỗi: ${err.message}</span>`;
      }
    });
  }

  if (filterBtn) {
    filterBtn.addEventListener("click", async () => {
      const text = filterInput.value.trim();
      if (!text) return;

      const token = localStorage.getItem("admin_token") || "";
      filterOutput.style.display = "block";
      filterOutput.innerHTML = "⏳ Đang kiểm tra vi phạm với AI...";

      try {
        const res = await fetch("/admin/ai/filter-chat", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ text }),
        });

        const data = await res.json();
        if (res.ok && data.ok && data.result) {
          const r = data.result;
          const isSafe = r.isSafe;
          filterOutput.innerHTML = `
            <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px;">
              <span class="status-micro-tag" style="${
                isSafe ? "background: rgba(34,197,94,0.2); color: #4ade80;" : "background: rgba(239,68,68,0.2); color: #f87171;"
              }">${r.category || (isSafe ? "SAFE" : "TOXIC")}</span>
              <strong>${isSafe ? "✅ An Toàn" : "⚠️ Cảnh Báo Vi Phạm"}</strong>
            </div>
            <div><strong>Lý do:</strong> ${escapeHtml(r.reason || "Không có")}</div>
            <div style="margin-top: 4px;"><strong>Đề xuất:</strong> <code>${r.suggestedAction || "ALLOW"}</code></div>
          `;
        } else {
          filterOutput.innerHTML = `<span style="color: var(--rose-danger);">❌ Lỗi: ${data.error}</span>`;
        }
      } catch (err) {
        filterOutput.innerHTML = `<span style="color: var(--rose-danger);">❌ Lỗi: ${err.message}</span>`;
      }
    });
  }
}

// ==========================================
// 13. Backup & Restore System (VI.1, VI.4)
// ==========================================
function initBackupRestore() {
  const downloadBtn = document.getElementById("downloadBackupBtn");
  const restoreFile = document.getElementById("restoreFileInput");
  const triggerBtn = document.getElementById("triggerRestoreBtn");
  const statusMsg = document.getElementById("restoreStatusMsg");

  if (downloadBtn) {
    downloadBtn.addEventListener("click", () => {
      window.location.href = "/admin/backup";
    });
  }

  if (triggerBtn && restoreFile) {
    triggerBtn.addEventListener("click", () => restoreFile.click());

    restoreFile.addEventListener("change", async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;

      statusMsg.innerHTML = `<span style="color: var(--amber-warning);">⏳ Đang đọc và xác thực file backup...</span>`;
      const reader = new FileReader();
      reader.onload = async (event) => {
        try {
          const parsed = JSON.parse(event.target.result);
          const token = localStorage.getItem("admin_token") || "";

          const res = await fetch("/admin/restore", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
            body: JSON.stringify(parsed),
          });

          const data = await res.json();
          if (res.ok && data.ok) {
            statusMsg.innerHTML = `<span style="color: var(--mc-green);">✅ ${data.message}</span>`;
            loadDashboardData(true);
          } else {
            statusMsg.innerHTML = `<span style="color: var(--rose-danger);">❌ Lỗi: ${data.error}</span>`;
          }
        } catch (err) {
          statusMsg.innerHTML = `<span style="color: var(--rose-danger);">❌ File không đúng định dạng JSON: ${err.message}</span>`;
        }
      };
      reader.readAsText(file);
    });
  }
}

// ==========================================
// 14. Leaderboards & Top Active Players System
// ==========================================
let currentLbCategory = "all";
let cachedLeaderboards = null;

async function loadLeaderboards() {
  const token = localStorage.getItem("admin_token") || "";
  const container = document.getElementById("leaderboardGridContainer");
  if (!container) return;

  try {
    const res = await fetch("/admin/leaderboards", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    if (res.ok && data.ok) {
      cachedLeaderboards = data.leaderboards || {};
      const totalPlayers = data.totalPlayers || 0;

      const totalEl = document.getElementById("lbTotalTrackedPlayers");
      if (totalEl) totalEl.innerText = totalPlayers;

      // Update King Badges
      const chatKing = cachedLeaderboards.topChat?.[0];
      const deathKing = cachedLeaderboards.topDeaths?.[0];
      const timeKing = cachedLeaderboards.topPlaytime?.[0];

      const chatKingEl = document.getElementById("lbTopChatKing");
      if (chatKingEl) {
        chatKingEl.innerHTML = chatKing
          ? `<img src="${chatKing.avatarUrl}" class="lb-avatar" style="width:20px;height:20px;" /> <span>${escapeHtml(chatKing.player)} (${chatKing.totalMessages} tin)</span>`
          : `<span style="color:var(--text-muted)">Chưa có dữ liệu</span>`;
      }

      const deathKingEl = document.getElementById("lbTopDeathKing");
      if (deathKingEl) {
        deathKingEl.innerHTML = deathKing
          ? `<img src="${deathKing.avatarUrl}" class="lb-avatar" style="width:20px;height:20px;" /> <span>${escapeHtml(deathKing.player)} (${deathKing.totalDeaths} lần)</span>`
          : `<span style="color:var(--text-muted)">Chưa có dữ liệu</span>`;
      }

      const timeKingEl = document.getElementById("lbTopPlaytimeKing");
      if (timeKingEl) {
        timeKingEl.innerHTML = timeKing
          ? `<img src="${timeKing.avatarUrl}" class="lb-avatar" style="width:20px;height:20px;" /> <span>${escapeHtml(timeKing.player)} (${formatUptime(timeKing.onlineDurationSeconds)})</span>`
          : `<span style="color:var(--text-muted)">Chưa có dữ liệu</span>`;
      }

      renderLeaderboardGrid();

      // Also enrich 3D skin quick player selector with leaderboard players
      const leaderboardPlayerNames = [];
      Object.values(cachedLeaderboards).forEach((arr) => {
        if (Array.isArray(arr)) {
          arr.forEach((p) => {
            if (p && p.player) leaderboardPlayerNames.push(p.player);
          });
        }
      });
      if (leaderboardPlayerNames.length > 0) {
        updateQuickPlayersList(leaderboardPlayerNames);
      }
    } else {
      container.innerHTML = `<div style="grid-column: 1 / -1; text-align: center; color: var(--rose-danger); padding: 30px;">❌ Lỗi tải BXH: ${escapeHtml(data.error || "Không thể nạp dữ liệu")}</div>`;
    }
  } catch (err) {
    container.innerHTML = `<div style="grid-column: 1 / -1; text-align: center; color: var(--rose-danger); padding: 30px;">❌ Lỗi kết nối: ${escapeHtml(err.message)}</div>`;
  }
}

function renderLeaderboardGrid() {
  const container = document.getElementById("leaderboardGridContainer");
  if (!container || !cachedLeaderboards) return;

  const categories = [
    {
      id: "topChat",
      title: "Top Chat Nhiều Nhất",
      icon: "💬",
      accent: "#4ade80",
      getValue: (p) => `${p.totalMessages} tin nhắn`,
    },
    {
      id: "topDeaths",
      title: "Top Tử Vong Nhiều Nhất",
      icon: "☠️",
      accent: "#f87171",
      getValue: (p) => `${p.totalDeaths} lần chết`,
    },
    {
      id: "topPlaytime",
      title: "Top Online Lâu Nhất",
      icon: "⏳",
      accent: "#fbbf24",
      getValue: (p) => formatUptime(p.onlineDurationSeconds),
    },
    {
      id: "topKills",
      title: "Top Chiến Thần PvP (Kills)",
      icon: "⚔️",
      accent: "#a78bfa",
      getValue: (p) => `${p.killCount} hạ gục`,
    },
    {
      id: "topJoins",
      title: "Top Chăm Chỉ Đăng Nhập",
      icon: "🟢",
      accent: "#38bdf8",
      getValue: (p) => `${p.totalJoins} lượt vào`,
    },
    {
      id: "topCommands",
      title: "Top Sử Dụng Lệnh",
      icon: "⚡",
      accent: "#f472b6",
      getValue: (p) => `${p.totalCommands} lệnh`,
    },
    {
      id: "topDamage",
      title: "Top Sát Thương & Giao Tranh",
      icon: "🛡️",
      accent: "#fb923c",
      getValue: (p) => `${p.damageCount} lần chạm trán`,
    },
    {
      id: "topActivity",
      title: "Top Điểm Tương Tác Toàn Diện",
      icon: "🔥",
      accent: "#00f2fe",
      getValue: (p) => `${Math.floor(p.totalEvents * 2 + p.totalMessages * 3 + p.onlineDurationSeconds / 60)} pts`,
    },
    {
      id: "topClean",
      title: "Top Người Chơi Gương Mẫu",
      icon: "⭐",
      accent: "#fcd34d",
      getValue: (p) => `0 cảnh cáo • ${p.totalEvents} events`,
    },
  ];

  const listToRender = currentLbCategory === "all"
    ? categories
    : categories.filter((c) => c.id === currentLbCategory);

  let html = "";

  listToRender.forEach((cat) => {
    const list = cachedLeaderboards[cat.id] || [];
    const hasData = list.length > 0;

    html += `
      <div class="lb-card" style="border-top: 3px solid ${cat.accent};">
        <div class="lb-card-header">
          <div class="lb-card-title">
            <span>${cat.icon}</span>
            <span>${cat.title}</span>
          </div>
          <span style="font-size: 11px; color: ${cat.accent}; font-family: 'JetBrains Mono', monospace; font-weight: 700;">TOP ${list.length}</span>
        </div>

        <div style="display: flex; flex-direction: column; gap: 8px;">
          ${
            hasData
              ? list
                  .map((player, index) => {
                    const rank = index + 1;
                    const rankClass = rank === 1 ? "lb-rank-1" : rank === 2 ? "lb-rank-2" : rank === 3 ? "lb-rank-3" : "lb-rank-other";
                    return `
                      <div class="lb-player-row" style="cursor: pointer;" title="Bấm để tra cứu đầy đủ thứ hạng của ${escapeHtml(player.player)}" data-inspect-player="${escapeHtml(player.player)}">
                        <div style="display: flex; align-items: center; gap: 10px; min-width: 0;">
                          <div class="lb-rank-badge ${rankClass}">#${rank}</div>
                          <img src="${player.avatarUrl || `https://mc-heads.net/avatar/${encodeURIComponent(player.player)}/128`}" alt="${escapeHtml(player.player)}" class="lb-avatar" loading="lazy" />
                          <div style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                            <div style="font-size: 13px; font-weight: 700; color: #ffffff;">${escapeHtml(player.player)}</div>
                            <div style="font-size: 10.5px; color: var(--text-muted);">${escapeHtml(player.lastServer || "Server")}</div>
                          </div>
                        </div>
                        <div class="lb-value-pill" style="color: ${cat.accent}; border-color: ${cat.accent}33;">
                          ${cat.getValue(player)}
                        </div>
                      </div>
                    `;
                  })
                  .join("")
              : `<div style="text-align: center; padding: 24px; color: var(--text-muted); font-size: 12px;">Chưa có dữ liệu sự kiện người chơi nào trong mục này</div>`
          }
        </div>
      </div>
    `;
  });

  container.innerHTML = html;

  // Bind click on player row to search player ranks
  container.querySelectorAll("[data-inspect-player]").forEach((row) => {
    row.addEventListener("click", (e) => {
      const playerName = e.currentTarget.dataset.inspectPlayer;
      const searchInput = document.getElementById("lbPlayerSearchInput");
      const searchForm = document.getElementById("lbPlayerSearchForm");
      if (searchInput && searchForm && playerName) {
        searchInput.value = playerName;
        searchForm.dispatchEvent(new Event("submit"));
        document.getElementById("lbPlayerSearchResult")?.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    });
  });
}

function initLeaderboards() {
  const refreshBtn = document.getElementById("refreshLeaderboardBtn");
  const resetBtn = document.getElementById("resetLeaderboardBtn");
  const searchForm = document.getElementById("lbPlayerSearchForm");
  const searchInput = document.getElementById("lbPlayerSearchInput");
  const searchClearBtn = document.getElementById("lbPlayerSearchClearBtn");
  const searchResultContainer = document.getElementById("lbPlayerSearchResult");

  refreshBtn?.addEventListener("click", () => {
    loadLeaderboards();
  });

  resetBtn?.addEventListener("click", async () => {
    if (!confirm("Bạn có chắc muốn đặt lại toàn bộ dữ liệu bảng xếp hạng về 0?")) return;
    const token = localStorage.getItem("admin_token") || "";
    try {
      const res = await fetch("/admin/leaderboards/reset", {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        alert("✅ " + data.message);
        loadLeaderboards();
      } else {
        alert("❌ Lỗi: " + (data.error || "Không thể reset"));
      }
    } catch (err) {
      alert("❌ Lỗi kết nối: " + err.message);
    }
  });

  document.querySelectorAll(".lb-cat-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".lb-cat-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      currentLbCategory = btn.dataset.lbCat || "all";
      renderLeaderboardGrid();
    });
  });

  // Player Rank Search Handler
  if (searchForm && searchInput && searchResultContainer) {
    searchForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const query = searchInput.value.trim();
      if (!query) return;

      searchResultContainer.style.display = "block";
      searchResultContainer.innerHTML = `<div style="text-align: center; padding: 18px; color: var(--cyan-accent);">⏳ Đang tra cứu toàn bộ thứ hạng của "${escapeHtml(query)}"...</div>`;
      if (searchClearBtn) searchClearBtn.style.display = "inline-flex";

      const token = localStorage.getItem("admin_token") || "";
      try {
        const res = await fetch(`/admin/leaderboards/player/${encodeURIComponent(query)}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json();

        if (res.ok && data.ok && data.player) {
          const p = data.player;
          const ranks = data.rankings || {};
          const totalPlayers = data.totalPlayers || 0;

          const renderRankBadge = (rankObj, icon, title, accentColor = "#00f2fe") => {
            if (!rankObj || rankObj.rank == null) {
              return `
                <div class="player-rank-box">
                  <div class="box-title"><span>${icon}</span> <span>${title}</span></div>
                  <div class="box-rank" style="color: var(--text-dim);">Chưa có xếp hạng</div>
                  <div class="box-val">0 dữ liệu</div>
                </div>`;
            }
            const r = rankObj.rank;
            const isTop10 = r <= 10;
            return `
              <div class="player-rank-box ${isTop10 ? "rank-top10" : ""}">
                <div class="box-title">
                  <span>${icon}</span>
                  <span>${title}</span>
                  ${isTop10 ? '<span class="status-micro-tag" style="background: rgba(251, 191, 36, 0.2); color: #fbbf24; margin-left: auto;">TOP 10</span>' : ""}
                </div>
                <div class="box-rank" style="color: ${isTop10 ? "#fbbf24" : accentColor};">
                  #${r} <span style="font-size: 11px; font-weight: 500; color: var(--text-dim);">/ ${rankObj.total || totalPlayers}</span>
                </div>
                <div class="box-val">${escapeHtml(rankObj.value)}</div>
              </div>`;
          };

          searchResultContainer.innerHTML = `
            <div class="player-search-card">
              <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px; border-bottom: 1px solid rgba(255, 255, 255, 0.08); padding-bottom: 12px;">
                <div style="display: flex; align-items: center; gap: 12px;">
                  <img src="${p.avatarUrl || `https://mc-heads.net/avatar/${encodeURIComponent(p.player)}/128`}" alt="${escapeHtml(p.player)}" style="width: 44px; height: 44px; border-radius: 8px; border: 2px solid rgba(0, 242, 254, 0.5); image-rendering: pixelated;" />
                  <div>
                    <div style="font-size: 16px; font-weight: 800; color: #ffffff; display: flex; align-items: center; gap: 8px;">
                      <span>${escapeHtml(p.player)}</span>
                      <span class="status-micro-tag" style="background: rgba(34, 197, 94, 0.2); color: #4ade80;">RECORDED PLAYER</span>
                    </div>
                    <div style="font-size: 11px; color: var(--text-dim); margin-top: 2px;">
                      Máy chủ: <strong style="color: var(--text-main);">${escapeHtml(p.lastServer || "Server")}</strong> • Hoạt động: <strong style="color: var(--text-main);">${p.totalEvents || 0} events</strong>
                    </div>
                  </div>
                </div>
                <div style="display: flex; gap: 8px;">
                  <button type="button" class="btn btn-sm btn-neon" id="btnView3DSkinFromSearch" data-player="${escapeHtml(p.player)}">
                    <span>🧍 Mở Skin 3D</span>
                  </button>
                </div>
              </div>

              <!-- Detailed Rankings across all Top categories -->
              <div class="player-search-grid">
                ${renderRankBadge(ranks.chat, "💬", "Top Chat", "#4ade80")}
                ${renderRankBadge(ranks.deaths, "☠️", "Top Tử Vong", "#f87171")}
                ${renderRankBadge(ranks.playtime, "⏳", "Top Playtime (Online)", "#fbbf24")}
                ${renderRankBadge(ranks.kills, "⚔️", "Top PvP Kills", "#a78bfa")}
                ${renderRankBadge(ranks.joins, "🟢", "Top Đăng Nhập", "#38bdf8")}
                ${renderRankBadge(ranks.commands, "⚡", "Top Dùng Lệnh", "#f472b6")}
                ${renderRankBadge(ranks.damage, "🛡️", "Top Sát Thương", "#fb923c")}
                ${renderRankBadge(ranks.activity, "🔥", "Điểm Tương Tác", "#00f2fe")}
                ${renderRankBadge(ranks.clean, "⭐", "Kỷ Luật / Gương Mẫu", "#fcd34d")}
              </div>
            </div>
          `;

          // Quick link to 3D skin
          document.getElementById("btnView3DSkinFromSearch")?.addEventListener("click", () => {
            const tabBtn = document.querySelector('.nav-tab-btn[data-tab="skin3d"]');
            if (tabBtn) tabBtn.click();
            const input = document.getElementById("skinPlayerInput");
            if (input) input.value = p.player;
            if (skinViewer) {
              skinViewer.loadSkin(`https://mc-heads.net/skin/${encodeURIComponent(p.player)}`);
            }
          });
        } else {
          searchResultContainer.innerHTML = `
            <div style="background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.3); border-radius: 8px; padding: 14px; color: #f87171; font-size: 13px; text-align: center;">
              ❌ ${escapeHtml(data.error || "Không tìm thấy người chơi này")}
            </div>
          `;
        }
      } catch (err) {
        searchResultContainer.innerHTML = `
          <div style="background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.3); border-radius: 8px; padding: 14px; color: #f87171; font-size: 13px; text-align: center;">
            ❌ Lỗi kết nối: ${escapeHtml(err.message)}
          </div>
        `;
      }
    });

    searchClearBtn?.addEventListener("click", () => {
      searchInput.value = "";
      searchResultContainer.innerHTML = "";
      searchResultContainer.style.display = "none";
      searchClearBtn.style.display = "none";
      searchInput.focus();
    });
  }
}

// ==========================================
// 15. Data Export Tools (IV.4)
// ==========================================
function initExportTools() {
  document.getElementById("exportJsonBtn")?.addEventListener("click", () => {
    if (!globalDataCache) return;
    downloadFile(
      JSON.stringify(globalDataCache.clientsData || {}, null, 2),
      `minecraft_relay_events_${Date.now()}.json`,
      "application/json"
    );
  });

  document.getElementById("exportCsvBtn")?.addEventListener("click", () => {
    if (!globalDataCache) return;
    const rows = [["ClientKey", "Time", "Type", "Player", "Server", "Message"]];
    const data = globalDataCache.clientsData || {};

    for (const key in data) {
      for (const ev of data[key].events || []) {
        rows.push([
          `"${key}"`,
          `"${ev.time || ""}"`,
          `"${ev.type || ""}"`,
          `"${(ev.player || "").replace(/"/g, '""')}"`,
          `"${(ev.server || "").replace(/"/g, '""')}"`,
          `"${(ev.message || "").replace(/"/g, '""')}"`,
        ]);
      }
    }

    const csvContent = rows.map((e) => e.join(",")).join("\n");
    downloadFile(csvContent, `minecraft_relay_events_${Date.now()}.csv`, "text/csv");
  });

  document.getElementById("exportLogsBtn")?.addEventListener("click", () => {
    if (!globalDataCache) return;
    const lines = [];
    const data = globalDataCache.clientsData || {};

    for (const key in data) {
      for (const ev of data[key].events || []) {
        lines.push(`[${ev.time}] [${key}] [${ev.type}] <${ev.player}>: ${ev.message}`);
      }
    }

    downloadFile(lines.join("\n"), `minecraft_relay_${Date.now()}.log`, "text/plain");
  });
}

function downloadFile(content, fileName, contentType) {
  const a = document.createElement("a");
  const file = new Blob([content], { type: contentType });
  a.href = URL.createObjectURL(file);
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ==========================================
// 15. Smart Filter & Search (IV.3)
// ==========================================
function initSmartFilters() {
  const searchInput = document.getElementById("searchInput");
  const typeFilter = document.getElementById("eventTypeFilter");

  [searchInput, typeFilter].forEach((el) => {
    el?.addEventListener("input", () => {
      if (globalDataCache) {
        renderClientsAndEvents(globalDataCache.clientsData);
      }
    });
  });
}

// ==========================================
// Helper Utilities
// ==========================================
function formatUptime(seconds) {
  if (!seconds || seconds <= 0) return "0s";
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function formatTime(iso) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString();
  } catch {
    return iso;
  }
}

function setCheckbox(id, val) {
  const el = document.getElementById(id);
  if (el && typeof val === "boolean") el.checked = val;
}

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function startAutoRefresh() {
  stopAutoRefresh();
  autoRefreshTimer = setInterval(() => {
    const toggle = document.getElementById("autoRefreshToggle");
    if (toggle && toggle.checked) {
      loadDashboardData(false);
    }
  }, 3000);
}

function stopAutoRefresh() {
  if (autoRefreshTimer) {
    clearInterval(autoRefreshTimer);
    autoRefreshTimer = null;
  }
}

// ==========================================
// 16. Staff Management, RBAC Matrix & 1-Click Maintenance Mode
// ==========================================
let maintenanceTickerTimer = null;
let currentRemainingSecs = 0;
let cachedRbacMatrix = [];

function switchToTab(tabId) {
  document.querySelectorAll(".nav-tab-btn").forEach((b) => {
    b.classList.toggle("active", b.dataset.tab === tabId);
  });
  document.querySelectorAll(".tab-pane").forEach((pane) => {
    const isTarget = pane.id === tabId;
    pane.style.display = isTarget ? "block" : "none";
    pane.classList.toggle("active", isTarget);
  });

  if (tabId === "tab-audit") loadAuditLogs();
  if (tabId === "tab-keys") loadClientKeys();
  if (tabId === "tab-leaderboard") loadLeaderboards();
  if (tabId === "tab-staff-admin") loadRbacMatrix();
}

function initStaffAndMaintenance() {
  // 1. Corner Profile & Quick Maintenance Buttons -> Navigate to Staff Tab
  const cornerBtn = document.getElementById("adminAvatarCornerBtn");
  if (cornerBtn) {
    cornerBtn.addEventListener("click", () => {
      switchToTab("tab-staff-admin");
    });
  }

  const quickMaintBtn = document.getElementById("quickMaintenanceBtn");
  if (quickMaintBtn) {
    quickMaintBtn.addEventListener("click", () => {
      switchToTab("tab-staff-admin");
    });
  }

  // 2. Global Maintenance Banner Actions
  const bannerManageBtn = document.getElementById("maintBannerManageBtn");
  if (bannerManageBtn) {
    bannerManageBtn.addEventListener("click", () => {
      switchToTab("tab-staff-admin");
    });
  }

  const bannerQuickOffBtn = document.getElementById("maintBannerQuickOffBtn");
  if (bannerQuickOffBtn) {
    bannerQuickOffBtn.addEventListener("click", async () => {
      bannerQuickOffBtn.disabled = true;
      bannerQuickOffBtn.innerText = "⏳ Đang xử lý...";
      await toggleMaintenance(false);
      bannerQuickOffBtn.disabled = false;
      bannerQuickOffBtn.innerText = "🔓 Tắt Bảo Trì Ngay";
    });
  }

  // 3. Public Maintenance Overlay Staff Login Bypass
  const staffLoginBypassBtn = document.getElementById("publicMaintStaffLoginBtn");
  if (staffLoginBypassBtn) {
    staffLoginBypassBtn.addEventListener("click", () => {
      const overlay = document.getElementById("publicMaintenanceOverlay");
      if (overlay) overlay.style.display = "none";
      showLogin();
    });
  }

  // 4. Maintenance Duration Preset Buttons
  document.querySelectorAll(".maint-preset-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const mins = btn.dataset.min;
      const input = document.getElementById("maintCustomMinutesInput");
      if (input && mins) {
        input.value = mins;
        document.querySelectorAll(".maint-preset-btn").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
      }
    });
  });

  // 5. Toggle Maintenance ON (1-Click Lockdown)
  const toggleOnBtn = document.getElementById("btnToggleMaintenanceOn");
  if (toggleOnBtn) {
    toggleOnBtn.addEventListener("click", async () => {
      const minutesInput = document.getElementById("maintCustomMinutesInput");
      const messageInput = document.getElementById("maintMessageInput");
      const minutes = parseInt(minutesInput?.value || "30", 10);
      const reason = messageInput?.value?.trim() || "Hệ thống VnlandZ Minecraft Relay đang trong đợt bảo trì nâng cấp định kỳ.";
      const feedbackEl = document.getElementById("maintAdminFeedback");

      if (isNaN(minutes) || minutes < 1) {
        if (feedbackEl) {
          feedbackEl.innerHTML = `<span style="color: #ef4444;">⚠️ Vui lòng nhập thời gian bảo trì hợp lệ (tối thiểu 1 phút)!</span>`;
        }
        return;
      }

      toggleOnBtn.disabled = true;
      toggleOnBtn.innerText = "⏳ Đang kích hoạt...";
      if (feedbackEl) {
        feedbackEl.innerHTML = `<span style="color: #00f2fe;">⏳ Đang gửi yêu cầu kích hoạt bảo trì (${minutes} phút)...</span>`;
      }

      await toggleMaintenance(true, minutes, reason);

      toggleOnBtn.disabled = false;
      toggleOnBtn.innerText = "🔒 Kích Hoạt Bảo Trì (Lockdown)";
    });
  }

  // 6. Toggle Maintenance OFF (Khôi Phục Hoạt Động)
  const toggleOffBtn = document.getElementById("btnToggleMaintenanceOff");
  if (toggleOffBtn) {
    toggleOffBtn.addEventListener("click", async () => {
      const feedbackEl = document.getElementById("maintAdminFeedback");
      toggleOffBtn.disabled = true;
      toggleOffBtn.innerText = "⏳ Đang xử lý...";
      if (feedbackEl) {
        feedbackEl.innerHTML = `<span style="color: #00f2fe;">⏳ Đang gửi yêu cầu tắt chế độ bảo trì...</span>`;
      }

      await toggleMaintenance(false);

      toggleOffBtn.disabled = false;
      toggleOffBtn.innerText = "🔓 Tắt Bảo Trì (Mở Lại)";
    });
  }

  // 7. Save RBAC Matrix Button
  const saveMatrixBtn = document.getElementById("saveRbacMatrixBtn");
  if (saveMatrixBtn) {
    saveMatrixBtn.addEventListener("click", saveRbacMatrix);
  }

  // 8. Reset RBAC Matrix Button
  const resetMatrixBtn = document.getElementById("resetRbacMatrixBtn");
  if (resetMatrixBtn) {
    resetMatrixBtn.addEventListener("click", resetRbacMatrix);
  }

  // Check public maintenance status immediately on initial boot
  checkPublicMaintenance();
}

async function toggleMaintenance(active, minutes = 30, reason = "") {
  const token = localStorage.getItem("admin_token") || "";
  const feedbackEl = document.getElementById("maintAdminFeedback");

  try {
    const res = await fetch("/admin/maintenance", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        "X-Admin-Token": token,
      },
      body: JSON.stringify({ active, minutes, reason }),
    });

    const data = await res.json();
    if (res.ok && data.ok) {
      if (feedbackEl) {
        feedbackEl.innerHTML = `<span style="color: #4ade80;">✓ ${data.message || "Cập nhật chế độ bảo trì thành công!"}</span>`;
        setTimeout(() => { if (feedbackEl) feedbackEl.innerHTML = ""; }, 5000);
      }
      loadDashboardData(true);
    } else {
      if (feedbackEl) {
        feedbackEl.innerHTML = `<span style="color: #ef4444;">⚠️ ${data.error || "Không thể cập nhật bảo trì"}</span>`;
      } else {
        alert("⚠️ " + (data.error || "Không thể cập nhật bảo trì"));
      }
    }
  } catch (err) {
    if (feedbackEl) {
      feedbackEl.innerHTML = `<span style="color: #ef4444;">Lỗi kết nối: ${err.message}</span>`;
    } else {
      alert("Lỗi kết nối: " + err.message);
    }
  }
}

async function checkPublicMaintenance() {
  try {
    const res = await fetch("/api/maintenance/status");
    if (res.ok) {
      const data = await res.json();
      const maint = data.maintenance || data;
      const token = localStorage.getItem("admin_token");
      const isDashboardVisible = document.getElementById("dashboardBox")?.style.display === "block";

      if (maint && (maint.active || maint.enabled)) {
        // If user is not logged in / on login screen, show public maintenance modal
        if (!token && !isDashboardVisible) {
          const publicOverlay = document.getElementById("publicMaintenanceOverlay");
          const msgEl = document.getElementById("publicMaintMessage");
          if (publicOverlay) publicOverlay.style.display = "flex";
          if (msgEl) msgEl.innerText = maint.message || maint.reason || "Hệ thống VnlandZ Minecraft Relay đang trong đợt bảo trì nâng cấp định kỳ.";
          startPublicCountdownTicker(maint.remainingSeconds || 0);
        }
      }
    }
  } catch (e) {
    // Silently ignore network issue on initial check
  }
}

function startPublicCountdownTicker(initialSecs) {
  let secs = initialSecs;
  const clockEl = document.getElementById("publicMaintCountdown");
  const timeEl = document.getElementById("publicMaintServerTime");

  function tick() {
    if (timeEl) timeEl.innerText = new Date().toLocaleTimeString();
    if (clockEl) clockEl.innerText = formatCountdown(secs);
    if (secs > 0) {
      secs--;
    }
  }
  tick();
  setInterval(tick, 1000);
}

function formatCountdown(totalSeconds) {
  if (!totalSeconds || totalSeconds <= 0) return "00:00:00";
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.floor(totalSeconds % 60);
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

// Load and Render Dynamic RBAC Matrix
async function loadRbacMatrix() {
  const tableBody = document.getElementById("rbacMatrixTableBody");
  if (!tableBody) return;

  const token = localStorage.getItem("admin_token") || "";
  try {
    const res = await fetch("/admin/rbac/matrix", {
      headers: {
        Authorization: `Bearer ${token}`,
        "X-Admin-Token": token,
      },
    });

    if (res.ok) {
      const data = await res.json();
      cachedRbacMatrix = data.matrix || [];
      renderRbacMatrix(cachedRbacMatrix);
    } else {
      tableBody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: #ef4444; padding: 20px;">Không thể tải ma trận phân quyền: HTTP ${res.status}</td></tr>`;
    }
  } catch (err) {
    tableBody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: #ef4444; padding: 20px;">Lỗi kết nối máy chủ: ${err.message}</td></tr>`;
  }
}

function renderRbacMatrix(matrix) {
  const tableBody = document.getElementById("rbacMatrixTableBody");
  if (!tableBody) return;

  if (!matrix || matrix.length === 0) {
    tableBody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--text-dim); padding: 20px;">Không có dữ liệu phân quyền.</td></tr>`;
    return;
  }

  const currentUserRole = globalDataCache?.auth?.role || "admin";
  const isCurrentUserAdmin = currentUserRole === "admin";

  let html = "";
  matrix.forEach((perm) => {
    let riskBadge = "";
    if (perm.risk === "LOW") {
      riskBadge = `<span class="status-micro-tag" style="background: rgba(34, 197, 94, 0.2); color: #4ade80;">THẤP (LOW)</span>`;
    } else if (perm.risk === "MEDIUM") {
      riskBadge = `<span class="status-micro-tag" style="background: rgba(251, 191, 36, 0.2); color: #fbbf24;">TRUNG BÌNH (MED)</span>`;
    } else if (perm.risk === "HIGH") {
      riskBadge = `<span class="status-micro-tag" style="background: rgba(249, 115, 22, 0.2); color: #fb923c;">CAO (HIGH)</span>`;
    } else {
      riskBadge = `<span class="status-micro-tag" style="background: rgba(239, 68, 68, 0.2); color: #f87171;">NGUY HIỂM (CRITICAL)</span>`;
    }

    const disabledAttr = !isCurrentUserAdmin ? "disabled" : "";

    html += `
      <tr data-perm-code="${perm.code}">
        <td>
          <div style="font-weight: 600; color: #ffffff; margin-bottom: 2px;">${escapeHtml(perm.name)}</div>
          <div style="font-size: 11.5px; color: var(--text-muted); line-height: 1.4;">${escapeHtml(perm.description)}</div>
        </td>
        <td>
          <code style="background: rgba(0,0,0,0.5); padding: 4px 8px; border-radius: 4px; color: #00f2fe; font-size: 11.5px; border: 1px solid var(--border-color); font-family: 'JetBrains Mono', monospace;">
            ${escapeHtml(perm.code)}
          </code>
        </td>
        <td style="text-align: center;">
          <label style="display: inline-flex; align-items: center; cursor: ${isCurrentUserAdmin ? "pointer" : "not-allowed"}; gap: 6px;">
            <input type="checkbox" class="rbac-checkbox rbac-admin-check" data-code="${perm.code}" ${perm.admin ? "checked" : ""} ${disabledAttr} style="transform: scale(1.2); accent-color: #60a5fa; cursor: inherit;" />
            <span style="font-size: 12px; font-weight: 600; color: ${perm.admin ? "#60a5fa" : "var(--text-dim)"};">${perm.admin ? "BẬT" : "TẮT"}</span>
          </label>
        </td>
        <td style="text-align: center;">
          <label style="display: inline-flex; align-items: center; cursor: ${isCurrentUserAdmin ? "pointer" : "not-allowed"}; gap: 6px;">
            <input type="checkbox" class="rbac-checkbox rbac-mod-check" data-code="${perm.code}" ${perm.mod ? "checked" : ""} ${disabledAttr} style="transform: scale(1.2); accent-color: #fbbf24; cursor: inherit;" />
            <span style="font-size: 12px; font-weight: 600; color: ${perm.mod ? "#fbbf24" : "var(--text-dim)"};">${perm.mod ? "BẬT" : "TẮT"}</span>
          </label>
        </td>
        <td>${riskBadge}</td>
      </tr>
    `;
  });

  tableBody.innerHTML = html;

  // Add change event listeners to update label text on toggle
  tableBody.querySelectorAll(".rbac-checkbox").forEach((cb) => {
    cb.addEventListener("change", (e) => {
      const span = e.target.parentElement?.querySelector("span");
      if (span) {
        const isAdmin = e.target.classList.contains("rbac-admin-check");
        span.innerText = e.target.checked ? "BẬT" : "TẮT";
        span.style.color = e.target.checked ? (isAdmin ? "#60a5fa" : "#fbbf24") : "var(--text-dim)";
      }
    });
  });
}

// Save RBAC Matrix Changes
async function saveRbacMatrix() {
  const saveBtn = document.getElementById("saveRbacMatrixBtn");
  const feedbackEl = document.getElementById("rbacStatusFeedback");
  const rows = document.querySelectorAll("#rbacMatrixTableBody tr[data-perm-code]");

  if (rows.length === 0) return;

  const matrixPayload = [];
  rows.forEach((row) => {
    const code = row.getAttribute("data-perm-code");
    const adminCheck = row.querySelector(".rbac-admin-check");
    const modCheck = row.querySelector(".rbac-mod-check");
    if (code && adminCheck && modCheck) {
      matrixPayload.push({
        code,
        admin: adminCheck.checked,
        mod: modCheck.checked,
      });
    }
  });

  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.innerText = "⏳ Đang lưu...";
  }

  const token = localStorage.getItem("admin_token") || "";
  try {
    const res = await fetch("/admin/rbac/matrix", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        "X-Admin-Token": token,
      },
      body: JSON.stringify({ matrix: matrixPayload }),
    });

    const data = await res.json();
    if (res.ok && data.ok) {
      cachedRbacMatrix = data.matrix || matrixPayload;
      renderRbacMatrix(cachedRbacMatrix);
      if (feedbackEl) {
        feedbackEl.style.display = "block";
        feedbackEl.style.background = "rgba(34, 197, 94, 0.15)";
        feedbackEl.style.border = "1px solid rgba(34, 197, 94, 0.4)";
        feedbackEl.style.color = "#4ade80";
        feedbackEl.innerHTML = `✓ ${data.message || "Đã lưu cài đặt Ma Trận Phân Quyền (RBAC Matrix) thành công!"}`;
        setTimeout(() => { if (feedbackEl) feedbackEl.style.display = "none"; }, 5000);
      }
    } else {
      if (feedbackEl) {
        feedbackEl.style.display = "block";
        feedbackEl.style.background = "rgba(239, 68, 68, 0.15)";
        feedbackEl.style.border = "1px solid rgba(239, 68, 68, 0.4)";
        feedbackEl.style.color = "#ef4444";
        feedbackEl.innerHTML = `⚠️ ${data.error || "Không thể lưu ma trận phân quyền"}`;
      } else {
        alert("⚠️ " + (data.error || "Không thể lưu ma trận phân quyền"));
      }
    }
  } catch (err) {
    if (feedbackEl) {
      feedbackEl.style.display = "block";
      feedbackEl.style.background = "rgba(239, 68, 68, 0.15)";
      feedbackEl.style.border = "1px solid rgba(239, 68, 68, 0.4)";
      feedbackEl.style.color = "#ef4444";
      feedbackEl.innerHTML = `Lỗi kết nối: ${err.message}`;
    } else {
      alert("Lỗi kết nối: " + err.message);
    }
  } finally {
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.innerText = "💾 Lưu Cài Đặt Phân Quyền";
    }
  }
}

// Reset RBAC Matrix to Defaults
async function resetRbacMatrix() {
  if (!confirm("Bạn có chắc chắn muốn KHÔI PHỤC TOÀN BỘ MA TRẬN PHÂN QUYỀN về mặc định ban đầu của hệ thống?")) {
    return;
  }

  const resetBtn = document.getElementById("resetRbacMatrixBtn");
  const feedbackEl = document.getElementById("rbacStatusFeedback");

  if (resetBtn) {
    resetBtn.disabled = true;
    resetBtn.innerText = "⏳ Đang khôi phục...";
  }

  const token = localStorage.getItem("admin_token") || "";
  try {
    const res = await fetch("/admin/rbac/reset", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        "X-Admin-Token": token,
      },
    });

    const data = await res.json();
    if (res.ok && data.ok) {
      cachedRbacMatrix = data.matrix || [];
      renderRbacMatrix(cachedRbacMatrix);
      if (feedbackEl) {
        feedbackEl.style.display = "block";
        feedbackEl.style.background = "rgba(34, 197, 94, 0.15)";
        feedbackEl.style.border = "1px solid rgba(34, 197, 94, 0.4)";
        feedbackEl.style.color = "#4ade80";
        feedbackEl.innerHTML = `✓ ${data.message || "Đã khôi phục ma trận phân quyền về mặc định thành công!"}`;
        setTimeout(() => { if (feedbackEl) feedbackEl.style.display = "none"; }, 5000);
      }
    } else {
      if (feedbackEl) {
        feedbackEl.style.display = "block";
        feedbackEl.style.background = "rgba(239, 68, 68, 0.15)";
        feedbackEl.style.border = "1px solid rgba(239, 68, 68, 0.4)";
        feedbackEl.style.color = "#ef4444";
        feedbackEl.innerHTML = `⚠️ ${data.error || "Không thể khôi phục ma trận phân quyền"}`;
      } else {
        alert("⚠️ " + (data.error || "Không thể khôi phục"));
      }
    }
  } catch (err) {
    if (feedbackEl) {
      feedbackEl.style.display = "block";
      feedbackEl.style.background = "rgba(239, 68, 68, 0.15)";
      feedbackEl.style.border = "1px solid rgba(239, 68, 68, 0.4)";
      feedbackEl.style.color = "#ef4444";
      feedbackEl.innerHTML = `Lỗi kết nối: ${err.message}`;
    }
  } finally {
    if (resetBtn) {
      resetBtn.disabled = false;
      resetBtn.innerText = "🔄 Khôi Phục Mặc Định";
    }
  }
}

function renderStaffAndMaintenance(data) {
  const auth = data.auth || {
    username: "admin",
    displayName: "Tổng Quản Trị",
    role: "admin",
    avatarUrl: "https://mc-heads.net/avatar/MHF_Steve/128",
  };
  const isAdmin = auth.role === "admin";

  // 1. Update Corner Avatar Profile in Top Nav
  const cornerAvatarImg = document.getElementById("cornerAdminAvatarImg");
  const cornerDisplayName = document.getElementById("cornerDisplayName") || document.getElementById("cornerAdminName");
  const cornerRoleBadge = document.getElementById("cornerRoleBadge") || document.getElementById("cornerRolePill");

  if (cornerAvatarImg) cornerAvatarImg.src = auth.avatarUrl || `https://mc-heads.net/avatar/${encodeURIComponent(auth.username)}/128`;
  if (cornerDisplayName) cornerDisplayName.innerText = auth.displayName || auth.username;
  if (cornerRoleBadge) {
    cornerRoleBadge.innerText = isAdmin ? "ADMIN" : "MODERATOR";
    cornerRoleBadge.className = `corner-role-pill ${isAdmin ? "role-admin" : "role-mod"}`;
  }

  // 2. Update Current Profile Card in Staff Tab
  const profileHeadImg = document.getElementById("profileHeadImg") || document.getElementById("profileAvatarImg");
  const profileDisplayName = document.getElementById("profileDisplayName");
  const profileUsername = document.getElementById("profileUsername");
  const profileRoleBadge = document.getElementById("profileRoleBadge");
  const profileIp = document.getElementById("profileIp");
  const profileRoleDesc = document.getElementById("profileRoleDesc");

  if (profileHeadImg) profileHeadImg.src = auth.avatarUrl || `https://mc-heads.net/avatar/${encodeURIComponent(auth.username)}/128`;
  if (profileDisplayName) profileDisplayName.innerText = auth.displayName || auth.username;
  if (profileUsername) profileUsername.innerText = auth.username;
  if (profileIp) profileIp.innerText = data.clientIp || "127.0.0.1";
  if (profileRoleDesc) {
    profileRoleDesc.innerText = isAdmin
      ? "Toàn quyền quản trị máy chủ, điều khiển cầu nối và cấu hình bảo mật."
      : "Quyền xem và theo dõi (Read-only), không có quyền can thiệp cấu hình hoặc gửi lệnh.";
  }
  if (profileRoleBadge) {
    profileRoleBadge.innerText = isAdmin ? "ADMIN (TOÀN QUYỀN)" : "MOD (CHỈ XEM)";
    profileRoleBadge.className = `corner-role-pill ${isAdmin ? "role-admin" : "role-mod"}`;
  }

  // 3. Render Profile RBAC Permission Badges
  const permList = document.getElementById("profilePermissionsList");
  if (permList) {
    if (isAdmin) {
      permList.innerHTML = `
        <div class="perm-badge allowed">✓ Xem dữ liệu & telemetry</div>
        <div class="perm-badge allowed">✓ Gửi lệnh Minecraft & Dispatch</div>
        <div class="perm-badge allowed">✓ Quản lý Client Key (Thêm/Xoá)</div>
        <div class="perm-badge allowed">✓ Cài đặt Webhook & Embed Discord</div>
        <div class="perm-badge allowed">✓ Kích hoạt Chế Độ Bảo Trì</div>
        <div class="perm-badge allowed">✓ Ma Trận Phân Quyền & Cấu Hình</div>
      `;
    } else {
      permList.innerHTML = `
        <div class="perm-badge allowed">✓ Xem dữ liệu & telemetry</div>
        <div class="perm-badge allowed">✓ Xem Replay & Skins 3D</div>
        <div class="perm-badge allowed">✓ Xuất file JSON/CSV/Log</div>
        <div class="perm-badge denied">✗ Gửi lệnh Minecraft (Bị chặn)</div>
        <div class="perm-badge denied">✗ Thêm/Sửa Client Key (Bị chặn)</div>
        <div class="perm-badge denied">✗ Đổi cài đặt Webhook/Bảo trì (Bị chặn)</div>
      `;
    }
  }

  // 4. Enforce Client-Side RBAC Disabling for 'mod' users
  const adminOnlyButtonIds = [
    "pushBtn",
    "autoExecBtn",
    "openAddKeyModalBtn",
    "saveDiscordConfigBtn",
    "saveDiscordEmbedBtn",
    "resetLeaderboardBtn",
    "clearQueueBtn",
    "btnToggleMaintenanceOn",
    "btnToggleMaintenanceOff",
    "saveRbacMatrixBtn",
    "resetRbacMatrixBtn",
    "maintBannerQuickOffBtn",
  ];

  adminOnlyButtonIds.forEach((id) => {
    const btn = document.getElementById(id);
    if (btn) {
      if (!isAdmin) {
        btn.disabled = true;
        btn.title = "Chức năng bị giới hạn: Tài khoản Điều hành viên (Mod) chỉ có quyền Xem (Read-only).";
        btn.style.opacity = "0.5";
        btn.style.cursor = "not-allowed";
      } else {
        btn.disabled = false;
        btn.title = "";
        btn.style.opacity = "1";
        btn.style.cursor = "pointer";
      }
    }
  });

  // 5. Render Maintenance Mode Status and Countdowns
  const maint = data.maintenance || { active: false, enabled: false, remainingSeconds: 0 };
  const isMaintActive = Boolean(maint.active || maint.enabled);

  const maintBanner = document.getElementById("maintenanceGlobalBanner");
  const quickMaintBtn = document.getElementById("quickMaintenanceBtn");
  const quickMaintText = document.getElementById("quickMaintText");
  const quickMaintDot = document.getElementById("quickMaintDot");
  const maintCardStatusBadge = document.getElementById("maintCardStatusBadge");
  const maintTabCountdownClock = document.getElementById("maintTabCountdownClock");
  const maintTabStatusSub = document.getElementById("maintTabStatusSub");
  const maintBannerCountdown = document.getElementById("maintBannerCountdown");
  const maintBannerMessage = document.getElementById("maintBannerMessage");
  const toggleOnBtn = document.getElementById("btnToggleMaintenanceOn");
  const toggleOffBtn = document.getElementById("btnToggleMaintenanceOff");

  currentRemainingSecs = maint.remainingSeconds || 0;

  if (isMaintActive) {
    if (maintBanner) maintBanner.style.display = "block";
    if (maintBannerMessage) maintBannerMessage.innerText = maint.message || maint.reason || "Hệ thống đang trong chế độ bảo trì nâng cấp.";
    if (quickMaintBtn) quickMaintBtn.classList.add("maint-active");
    if (quickMaintDot) {
      quickMaintDot.style.background = "#ef4444";
      quickMaintDot.style.boxShadow = "0 0 10px #ef4444";
    }
    if (quickMaintText) quickMaintText.innerText = `BẢO TRÌ: ${formatCountdown(currentRemainingSecs)}`;

    if (maintCardStatusBadge) {
      maintCardStatusBadge.innerText = "🔴 ĐANG BẢO TRÌ (LOCKDOWN)";
      maintCardStatusBadge.style.background = "rgba(239, 68, 68, 0.2)";
      maintCardStatusBadge.style.color = "#f87171";
    }
    if (maintTabStatusSub) {
      maintTabStatusSub.innerText = `Kích hoạt bởi: ${maint.activatedBy || "Admin"} • Đang giới hạn truy cập`;
      maintTabStatusSub.style.color = "#fb923c";
    }
    if (maintTabCountdownClock) {
      maintTabCountdownClock.innerText = formatCountdown(currentRemainingSecs);
      maintTabCountdownClock.style.color = "#ef4444";
    }

    if (toggleOnBtn) toggleOnBtn.style.display = "none";
    if (toggleOffBtn) toggleOffBtn.style.display = "inline-flex";

    startMaintenanceTicker();
  } else {
    if (maintBanner) maintBanner.style.display = "none";
    if (quickMaintBtn) quickMaintBtn.classList.remove("maint-active");
    if (quickMaintDot) {
      quickMaintDot.style.background = "var(--mc-green)";
      quickMaintDot.style.boxShadow = "0 0 8px var(--mc-green)";
    }
    if (quickMaintText) quickMaintText.innerText = "HỆ THỐNG TRỰC TUYẾN";

    if (maintCardStatusBadge) {
      maintCardStatusBadge.innerText = "🟢 HỆ THỐNG MỞ";
      maintCardStatusBadge.style.background = "rgba(34, 197, 94, 0.2)";
      maintCardStatusBadge.style.color = "#4ade80";
    }
    if (maintTabStatusSub) {
      maintTabStatusSub.innerText = "Hệ thống đang hoạt động bình thường";
      maintTabStatusSub.style.color = "var(--text-muted)";
    }
    if (maintTabCountdownClock) {
      maintTabCountdownClock.innerText = "00:00:00";
      maintTabCountdownClock.style.color = "#00f2fe";
    }

    if (toggleOnBtn) toggleOnBtn.style.display = "inline-flex";
    if (toggleOffBtn) toggleOffBtn.style.display = "none";

    stopMaintenanceTicker();
  }
}

function startMaintenanceTicker() {
  stopMaintenanceTicker();
  const updateDisplays = () => {
    const formatted = formatCountdown(currentRemainingSecs);
    const tabClock = document.getElementById("maintTabCountdownClock");
    const bannerClock = document.getElementById("maintBannerCountdown");
    const quickMaintText = document.getElementById("quickMaintText");

    if (tabClock) tabClock.innerText = formatted;
    if (bannerClock) bannerClock.innerText = formatted;
    if (quickMaintText) quickMaintText.innerText = `BẢO TRÌ: ${formatted}`;

    if (currentRemainingSecs > 0) {
      currentRemainingSecs--;
    } else {
      if (tabClock) tabClock.innerText = "00:00:00 (Hết hạn)";
    }
  };

  updateDisplays();
  maintenanceTickerTimer = setInterval(updateDisplays, 1000);
}

function stopMaintenanceTicker() {
  if (maintenanceTickerTimer) {
    clearInterval(maintenanceTickerTimer);
    maintenanceTickerTimer = null;
  }
}
