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
  initBackupRestore();
  initExportTools();
  initSmartFilters();
  initWebSocket();
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

        const data = await res.json();
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
// 7. Interactive 3D Minecraft Skin Viewer (I.3)
// ==========================================
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

    // Button Controls
    document.getElementById("skinAnimWalk")?.addEventListener("click", () => {
      skinViewer.animation = new skinview3d.WalkingAnimation();
      skinViewer.animation.speed = 0.8;
    });
    document.getElementById("skinAnimRun")?.addEventListener("click", () => {
      skinViewer.animation = new skinview3d.RunningAnimation();
      skinViewer.animation.speed = 1.2;
    });
    document.getElementById("skinAnimFly")?.addEventListener("click", () => {
      skinViewer.animation = new skinview3d.FlyingAnimation();
      skinViewer.animation.speed = 1.0;
    });
    document.getElementById("skinAnimPause")?.addEventListener("click", () => {
      skinViewer.animation = null;
      skinViewer.autoRotate = false;
    });
    document.getElementById("skinAnimRotate")?.addEventListener("click", () => {
      skinViewer.autoRotate = !skinViewer.autoRotate;
    });

    // Load Skin By Nickname
    const loadSkin = (nickname) => {
      if (!nickname) return;
      const clean = nickname.trim().replace(/[^\w]/g, "");
      if (clean) {
        skinViewer.loadSkin(`https://mc-heads.net/skin/${encodeURIComponent(clean)}`);
      }
    };

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
  if (!container) return;

  container.innerHTML = players
    .slice(0, 8)
    .map((p) => `<button type="button" class="quick-cmd-btn" data-player="${escapeHtml(p)}">${escapeHtml(p)}</button>`)
    .join("");

  container.querySelectorAll(".quick-cmd-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const player = e.currentTarget.dataset.player;
      const input = document.getElementById("skinPlayerInput");
      if (input) input.value = player;
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
// 14. Data Export Tools (IV.4)
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
