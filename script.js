/**
 * VnlandZ Minecraft Relay & Discord Bridge Frontend Script
 */

let globalDataCache = null;
let autoRefreshInterval = null;
let activeClientKeys = [];

function getAuthHeaders() {
    const token = localStorage.getItem("vnz_admin_token");
    const headers = { "Content-Type": "application/json" };
    if (token) {
        headers["Authorization"] = `Bearer ${token}`;
        headers["x-admin-token"] = token;
    }
    return headers;
}

document.addEventListener("DOMContentLoaded", async () => {
    // Elements
    const loginForm = document.getElementById("loginForm");
    const logoutBtn = document.getElementById("logoutBtn");
    const reloadBtn = document.getElementById("reloadBtn");
    const searchInput = document.getElementById("searchInput");
    const autoRefreshToggle = document.getElementById("autoRefreshToggle");
    
    // Discord Settings Elements
    const saveDiscordBtn = document.getElementById("saveDiscordBtn");
    const testDiscordBtn = document.getElementById("testDiscordBtn");
    const toggleMaskWebhookBtn = document.getElementById("toggleMaskWebhookBtn");
    const discordWebhookInput = document.getElementById("discordWebhookInput");
    
    // Command Sender Elements
    const commandForm = document.getElementById("commandForm");
    const targetKeyInput = document.getElementById("targetKeyInput");
    const clientSelect = document.getElementById("clientSelect");
    const commandTextInput = document.getElementById("commandTextInput");
    const cmdFeedback = document.getElementById("cmdFeedback");

    // Check Authentication Status on startup
    await checkAuthAndLoad();

    // 1. Login Form Submit
    if (loginForm) {
        loginForm.addEventListener("submit", async (e) => {
            e.preventDefault();
            const username = document.getElementById("username")?.value || "";
            const password = document.getElementById("admin_password")?.value || "";
            const honeypot = document.getElementById("_hp_security_check")?.value || "";
            const errorMsg = document.getElementById("errorMsg");

            if (errorMsg) {
                errorMsg.style.color = "var(--neon-cyan)";
                errorMsg.innerText = "Đang xác thực an toàn...";
            }

            try {
                const res = await fetch("/login", {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username, password, _hp_security_check: honeypot })
                });
                const data = await res.json();
                
                if (data.ok) {
                    if (data.token) {
                        localStorage.setItem("vnz_admin_token", data.token);
                    }
                    if (errorMsg) errorMsg.innerText = "";
                    const loginBox = document.getElementById("loginBox");
                    const dashboardBox = document.getElementById("dashboardBox");
                    if (loginBox) loginBox.style.display = "none";
                    if (dashboardBox) dashboardBox.style.display = "block";
                    await loadData(false);
                    startAutoRefresh();
                } else {
                    if (errorMsg) {
                        errorMsg.style.color = "var(--neon-pink)";
                        errorMsg.innerText = data.error || "Xác thực thất bại!";
                    }
                }
            } catch {
                if (errorMsg) {
                    errorMsg.style.color = "var(--neon-pink)";
                    errorMsg.innerText = "Lỗi kết nối tới Server. Vui lòng thử lại!";
                }
            }
        });
    }

    // 2. Logout Action
    if (logoutBtn) {
        logoutBtn.addEventListener("click", async () => {
            try {
                await fetch("/logout", { method: "POST", headers: getAuthHeaders() });
            } catch {}
            localStorage.removeItem("vnz_admin_token");
            stopAutoRefresh();
            const loginBox = document.getElementById("loginBox");
            const dashboardBox = document.getElementById("dashboardBox");
            if (dashboardBox) dashboardBox.style.display = "none";
            if (loginBox) loginBox.style.display = "flex";
        });
    }

    // 3. Manual Reload
    if (reloadBtn) {
        reloadBtn.addEventListener("click", () => loadData(true));
    }

    // 4. Search Filter
    if (searchInput) {
        searchInput.addEventListener("input", () => {
            if (globalDataCache && globalDataCache.clientsData) {
                renderClients(globalDataCache.clientsData, searchInput.value);
            }
        });
    }

    // 5. Auto-refresh Toggle
    if (autoRefreshToggle) {
        autoRefreshToggle.addEventListener("change", (e) => {
            if (e.target.checked) {
                startAutoRefresh();
            } else {
                stopAutoRefresh();
            }
        });
    }

    // 6. Save Discord Webhook & Routing Settings
    if (saveDiscordBtn) {
        saveDiscordBtn.addEventListener("click", async () => {
            const webhookUrl = discordWebhookInput ? discordWebhookInput.value : "";
            const forwardEvents = document.getElementById("toggleForwardEvents")?.checked ?? true;
            const forwardChat = document.getElementById("toggleForwardChat")?.checked ?? true;
            const forwardJoinLeave = document.getElementById("toggleForwardJoinLeave")?.checked ?? true;
            const forwardDeaths = document.getElementById("toggleForwardDeaths")?.checked ?? true;
            const forwardCommands = document.getElementById("toggleForwardCommands")?.checked ?? true;
            const statusMsg = document.getElementById("discordSaveStatus");

            if (statusMsg) {
                statusMsg.style.color = "var(--neon-cyan)";
                statusMsg.innerText = "Đang lưu cấu hình...";
            }

            try {
                const res = await fetch("/admin/settings", {
                    method: "POST",
                    headers: getAuthHeaders(),
                    body: JSON.stringify({
                        discordWebhookUrl: webhookUrl,
                        forwardEventsToDiscord: forwardEvents,
                        forwardChat: forwardChat,
                        forwardJoinLeave: forwardJoinLeave,
                        forwardDeaths: forwardDeaths,
                        forwardCommands: forwardCommands
                    })
                });

                const data = await res.json();
                if (data.ok) {
                    if (statusMsg) {
                        statusMsg.style.color = "var(--neon-green)";
                        statusMsg.innerText = "✓ Đã lưu cài đặt Discord Webhook!";
                        setTimeout(() => { if (statusMsg) statusMsg.innerText = ""; }, 4000);
                    }
                    await loadData(false);
                } else {
                    if (statusMsg) {
                        statusMsg.style.color = "var(--neon-pink)";
                        statusMsg.innerText = "✗ " + (data.error || "Lỗi lưu cấu hình");
                    }
                }
            } catch {
                if (statusMsg) {
                    statusMsg.style.color = "var(--neon-pink)";
                    statusMsg.innerText = "✗ Lỗi kết nối tới Server";
                }
            }
        });
    }

    // 7. Test Discord Webhook
    if (testDiscordBtn) {
        testDiscordBtn.addEventListener("click", async () => {
            const webhookUrl = discordWebhookInput ? discordWebhookInput.value : "";
            const statusMsg = document.getElementById("discordSaveStatus");

            if (statusMsg) {
                statusMsg.style.color = "var(--neon-cyan)";
                statusMsg.innerText = "Đang gửi test message sang Discord Webhook...";
            }

            try {
                const res = await fetch("/admin/test-discord", {
                    method: "POST",
                    headers: getAuthHeaders(),
                    body: JSON.stringify({ webhookUrl })
                });
                const data = await res.json();

                if (data.ok) {
                    if (statusMsg) {
                        statusMsg.style.color = "var(--neon-green)";
                        statusMsg.innerText = "✓ Test thành công! Kiểm tra kênh Discord của bạn.";
                    }
                    await loadData(false);
                } else {
                    if (statusMsg) {
                        statusMsg.style.color = "var(--neon-pink)";
                        statusMsg.innerText = "✗ " + (data.error || "Gửi test thất bại");
                    }
                }
            } catch {
                if (statusMsg) {
                    statusMsg.style.color = "var(--neon-pink)";
                    statusMsg.innerText = "✗ Lỗi kết nối tới Server";
                }
            }
        });
    }

    // 8. Toggle Mask Webhook URL
    if (toggleMaskWebhookBtn && discordWebhookInput) {
        toggleMaskWebhookBtn.addEventListener("click", () => {
            if (discordWebhookInput.type === "password") {
                discordWebhookInput.type = "text";
                toggleMaskWebhookBtn.innerText = "Ẩn Link";
            } else {
                discordWebhookInput.type = "password";
                toggleMaskWebhookBtn.innerText = "Hiện Link";
            }
        });
    }

    // 9. Send Minecraft Command from Dashboard
    if (commandForm) {
        commandForm.addEventListener("submit", async (e) => {
            e.preventDefault();
            const key = targetKeyInput ? targetKeyInput.value.trim() : "";
            const command = commandTextInput ? commandTextInput.value.trim() : "";

            if (!key) {
                if (cmdFeedback) {
                    cmdFeedback.style.color = "var(--neon-pink)";
                    cmdFeedback.innerText = "Vui lòng nhập hoặc chọn Client Key!";
                }
                return;
            }

            if (!command) {
                if (cmdFeedback) {
                    cmdFeedback.style.color = "var(--neon-pink)";
                    cmdFeedback.innerText = "Vui lòng nhập câu lệnh!";
                }
                return;
            }

            if (cmdFeedback) {
                cmdFeedback.style.color = "var(--neon-cyan)";
                cmdFeedback.innerText = "Đang đưa lệnh vào hàng đợi...";
            }

            try {
                const res = await fetch("/send", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ clientKey: key, command: command })
                });
                const data = await res.json();

                if (data.ok) {
                    if (cmdFeedback) {
                        cmdFeedback.style.color = "var(--neon-green)";
                        cmdFeedback.innerText = `✓ Đã queue lệnh '${command}' thành công! (Pending: ${data.pending})`;
                    }
                    if (commandTextInput) commandTextInput.value = "";
                    await loadData(false);
                } else {
                    if (cmdFeedback) {
                        cmdFeedback.style.color = "var(--neon-pink)";
                        cmdFeedback.innerText = "✗ " + (data.error || "Lỗi gửi lệnh");
                    }
                }
            } catch {
                if (cmdFeedback) {
                    cmdFeedback.style.color = "var(--neon-pink)";
                    cmdFeedback.innerText = "✗ Lỗi kết nối tới Server";
                }
            }
        });
    }

    // Client Selector change sync with target input
    if (clientSelect && targetKeyInput) {
        clientSelect.addEventListener("change", (e) => {
            if (e.target.value) {
                targetKeyInput.value = e.target.value;
            }
        });
    }

    // Quick Command Buttons
    document.querySelectorAll(".quick-cmd-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            const cmd = btn.getAttribute("data-cmd");
            if (commandTextInput && cmd) {
                commandTextInput.value = cmd;
                commandTextInput.focus();
            }
        });
    });
});

/**
 * Check Authentication & Initial Load
 */
async function checkAuthAndLoad() {
    const loginBox = document.getElementById("loginBox");
    const dashboardBox = document.getElementById("dashboardBox");

    try {
        const res = await fetch("/admin/data", { headers: getAuthHeaders() });
        if (res.ok) {
            if (loginBox) loginBox.style.display = "none";
            if (dashboardBox) dashboardBox.style.display = "block";
            await loadData(false);
            startAutoRefresh();
        } else {
            stopAutoRefresh();
            if (dashboardBox) dashboardBox.style.display = "none";
            if (loginBox) loginBox.style.display = "flex";
        }
    } catch {
        stopAutoRefresh();
        if (dashboardBox) dashboardBox.style.display = "none";
        if (loginBox) loginBox.style.display = "flex";
    }
}

/**
 * Fetch and Render Data from Server
 */
async function loadData(isManual = false) {
    const container = document.getElementById("contentData");
    if (isManual && container) {
        container.innerHTML = `<div class="loading-state">Đang làm mới dữ liệu từ Relay Server...</div>`;
    }

    try {
        const res = await fetch("/admin/data", { headers: getAuthHeaders() });
        if (res.status === 401) {
            stopAutoRefresh();
            localStorage.removeItem("vnz_admin_token");
            const loginBox = document.getElementById("loginBox");
            const dashboardBox = document.getElementById("dashboardBox");
            if (dashboardBox) dashboardBox.style.display = "none";
            if (loginBox) loginBox.style.display = "flex";
            return;
        }

        const data = await res.json();
        globalDataCache = data;

        // 1. Update Metrics & Real Telemetry
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

        const stats = data.stats || {};
        const totalClients = stats.totalClients || 0;

        if (elClients) elClients.innerText = totalClients;
        if (elIp) elIp.innerText = `IP: ${stats.activeIp || '127.0.0.1'}`;

        // Live Server Runtime Telemetry
        if (statHeapMem) statHeapMem.innerText = `${stats.memoryHeapUsedMB || '--'} MB`;
        if (statNodeVerTag) statNodeVerTag.innerText = (stats.nodeVersion || 'NODE').toUpperCase();
        if (statUptime) statUptime.innerText = formatUptime(stats.uptimeSeconds || 0);
        if (statTotalReqs) statTotalReqs.innerText = Number(stats.totalHttpRequests || 0).toLocaleString();
        
        // Discord Live Sync Telemetry
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

        // Live Header Subtext
        if (headerSubtext) {
            headerSubtext.innerText = `Node.js ${stats.nodeVersion || ''} • Hoạt động: ${formatUptime(stats.uptimeSeconds || 0)} • Real-time Sync`;
        }

        // Live Client Status Badge
        if (clientStatusBadge && clientStatusText) {
            if (totalClients > 0) {
                clientStatusText.innerText = `${totalClients} Client${totalClients > 1 ? 's' : ''} Hoạt Động`;
                clientStatusBadge.style.color = "var(--neon-green)";
                clientStatusBadge.style.borderColor = "rgba(0, 255, 135, 0.3)";
                if (clientStatusDot) {
                    clientStatusDot.style.background = "var(--neon-green)";
                    clientStatusDot.style.boxShadow = "0 0 8px var(--neon-green)";
                }
            } else {
                clientStatusText.innerText = `0 Client Hoạt Động`;
                clientStatusBadge.style.color = "var(--text-dim)";
                clientStatusBadge.style.borderColor = "var(--border-color)";
                if (clientStatusDot) {
                    clientStatusDot.style.background = "var(--text-dim)";
                    clientStatusDot.style.boxShadow = "none";
                }
            }
        }

        let totalQ = 0;
        let totalE = 0;
        const clients = data.clientsData || {};
        activeClientKeys = Object.keys(clients);

        for (const val of Object.values(clients)) {
            totalQ += (val.queue || []).length;
            totalE += (val.events || []).length;
        }
        if (elQ) elQ.innerText = totalQ;
        if (elE) elE.innerText = totalE;
        if (elDiscordFwd) {
            elDiscordFwd.innerText = stats.discordForwarded || 0;
        }

        // Update Discord status badge in header
        if (discordHeaderBadge) {
            if (data.config?.discordWebhookConfigured) {
                discordHeaderBadge.innerHTML = `<span class="pulse-dot" style="background:#5865F2;box-shadow:0 0 8px #5865F2;"></span> Discord: Đã Kết Nối`;
                discordHeaderBadge.className = "status-pill discord";
            } else {
                discordHeaderBadge.innerHTML = `<span class="pulse-dot" style="background:var(--neon-pink);box-shadow:0 0 8px var(--neon-pink);"></span> Discord: Chưa Cài Link`;
                discordHeaderBadge.className = "status-pill";
                discordHeaderBadge.style.color = "var(--neon-pink)";
                discordHeaderBadge.style.borderColor = "rgba(255,0,127,0.3)";
            }
        }

        // Update Discord form values if not user typing
        const discordInput = document.getElementById("discordWebhookInput");
        if (discordInput && !document.activeElement?.isSameNode(discordInput)) {
            if (data.config?.discordWebhookUrl) {
                discordInput.value = data.config.discordWebhookUrl;
            }
        }

        // Update toggles
        if (data.config) {
            setCheckbox("toggleForwardEvents", data.config.forwardEventsToDiscord);
            setCheckbox("toggleForwardChat", data.config.forwardChat);
            setCheckbox("toggleForwardJoinLeave", data.config.forwardJoinLeave);
            setCheckbox("toggleForwardDeaths", data.config.forwardDeaths);
            setCheckbox("toggleForwardCommands", data.config.forwardCommands);
        }

        // Update client selector in Command Form
        updateClientSelector(activeClientKeys);

        // Render Clients
        const filterText = document.getElementById("searchInput")?.value || "";
        renderClients(clients, filterText);

    } catch (err) {
        console.error("LoadData error:", err);
        if (container && isManual) {
            container.innerHTML = `<div class="empty-state" style="color: var(--neon-pink);">Lỗi khi đồng bộ dữ liệu từ Relay Server.</div>`;
        }
    }
}

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

function setCheckbox(id, val) {
    const el = document.getElementById(id);
    if (el && typeof val === "boolean") el.checked = val;
}

function updateClientSelector(keys) {
    const select = document.getElementById("clientSelect");
    if (!select) return;

    const currentVal = select.value;
    let options = '<option value="">-- Chọn Client Key sẵn có --</option>';
    keys.forEach(k => {
        options += `<option value="${escapeHtml(k)}" ${k === currentVal ? 'selected' : ''}>${escapeHtml(k)}</option>`;
    });
    select.innerHTML = options;
}

/**
 * Render Clients List & Event Logs
 */
function renderClients(clientsData, filter = "") {
    const container = document.getElementById("contentData");
    if (!container) return;

    const filterLower = filter.toLowerCase().trim();
    const allKeys = Object.keys(clientsData || {});
    
    const filteredKeys = allKeys.filter(key => {
        if (!filterLower) return true;
        if (key.toLowerCase().includes(filterLower)) return true;
        const events = clientsData[key]?.events || [];
        return events.some(ev => 
            (ev.player && ev.player.toLowerCase().includes(filterLower)) ||
            (ev.message && ev.message.toLowerCase().includes(filterLower)) ||
            (ev.type && ev.type.toLowerCase().includes(filterLower))
        );
    });

    if (filteredKeys.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div style="font-size: 24px; margin-bottom: 8px;">🎮</div>
                ${allKeys.length === 0 
                    ? 'Chưa có Client Minecraft nào kết nối. Hãy gửi request đến <code>/poll?clientKey=TÊN_KEY</code> hoặc <code>/events</code>' 
                    : 'Không tìm thấy Client Key hoặc sự kiện phù hợp với bộ lọc.'}
            </div>
        `;
        return;
    }

    let html = "";
    for (const key of filteredKeys) {
        const val = clientsData[key] || { queue: [], events: [] };
        const qCount = val.queue.length;
        const eCount = val.events.length;

        // Render events list
        let eventsHtml = "";
        if (val.events.length === 0) {
            eventsHtml = `<div class="empty-state" style="padding: 20px; font-size: 12px;">Chưa có sự kiện nào từ client này.</div>`;
        } else {
            eventsHtml = `<div class="event-list">`;
            // Reverse so newest is top
            const reversedEvents = [...val.events].reverse();
            for (const ev of reversedEvents) {
                const type = (ev.type || "LOG").toUpperCase();
                let typeClass = "type-log";
                if (type === "CHAT") typeClass = "type-chat";
                else if (type === "JOIN") typeClass = "type-join";
                else if (type === "LEAVE") typeClass = "type-leave";
                else if (type === "DEATH" || type === "ALERT" || type === "DAMAGE") typeClass = "type-death";
                else if (type === "COMMAND" || type === "REPLAY") typeClass = "type-command";

                const player = ev.player || "Unknown";
                const avatar = player !== "Unknown" 
                    ? `https://mc-heads.net/avatar/${encodeURIComponent(player)}/64`
                    : "https://mc-heads.net/avatar/MHF_Steve/64";

                const timeStr = formatTime(ev.time);

                eventsHtml += `
                    <div class="event-item">
                        <img src="${avatar}" alt="${escapeHtml(player)}" class="player-avatar" onerror="this.src='https://mc-heads.net/avatar/MHF_Steve/64'">
                        <div class="event-content">
                            <div class="event-top">
                                <span class="event-player">${escapeHtml(player)} <span style="font-weight: normal; color: var(--text-subtle); font-size: 11px;">(${escapeHtml(ev.server || 'Server')})</span></span>
                                <div style="display: flex; align-items: center; gap: 6px;">
                                    <span class="event-type-badge ${typeClass}">${escapeHtml(type)}</span>
                                    <span class="event-time">${timeStr}</span>
                                </div>
                            </div>
                            <div class="event-msg">${escapeHtml(ev.message || ev.title || '')}</div>
                        </div>
                    </div>
                `;
            }
            eventsHtml += `</div>`;
        }

        html += `
            <div class="client-box">
                <div class="client-terminal-bar">
                    <div style="display: flex; align-items: center; gap: 12px;">
                        <div class="terminal-dots">
                            <span class="terminal-dot dot-red"></span>
                            <span class="terminal-dot dot-yellow"></span>
                            <span class="terminal-dot dot-green"></span>
                        </div>
                        <h3 class="client-key-title">
                            <span>🔑</span>
                            <span>KEY: <strong>${escapeHtml(key)}</strong></span>
                        </h3>
                    </div>
                    <div class="client-badges">
                        <span class="badge-tag badge-queue">Queue: ${qCount}</span>
                        <span class="badge-tag badge-events">Events: ${eCount}</span>
                        <button class="btn btn-sm btn-outline" onclick="selectClientForCommand('${escapeHtml(key)}')">Gửi Lệnh</button>
                        <button class="btn btn-sm btn-danger-outline" onclick="clearClientQueue('${escapeHtml(key)}')">Xóa Queue</button>
                    </div>
                </div>
                <div class="client-body">
                    <div class="data-panels">
                        <div>
                            <div class="panel-title">
                                <span>📦 HÀNG ĐỢI LỆNH (PENDING QUEUE)</span>
                                <span style="font-size: 10px; color: var(--text-dim);">Poll qua /poll</span>
                            </div>
                            <pre>${val.queue.length > 0 ? escapeHtml(JSON.stringify(val.queue, null, 2)) : '// Hàng đợi trống'}</pre>
                        </div>
                        <div>
                            <div class="panel-title">
                                <span>⚡ SỰ KIỆN & CHAT GAME</span>
                                <span style="font-size: 10px; color: #818cf8;">➔ Tự đồng bộ Discord</span>
                            </div>
                            ${eventsHtml}
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    container.innerHTML = html;
}

// Global functions for inline button actions
window.selectClientForCommand = function(key) {
    const input = document.getElementById("targetKeyInput");
    const cmdInput = document.getElementById("commandTextInput");
    if (input) {
        input.value = key;
        if (cmdInput) cmdInput.focus();
    }
};

window.clearClientQueue = async function(key) {
    if (!confirm(`Bạn có chắc chắn muốn xóa hàng đợi của key '${key}'?`)) return;
    try {
        const res = await fetch("/admin/clear-queue", {
            method: "POST",
            headers: getAuthHeaders(),
            body: JSON.stringify({ clientKey: key })
        });
        const data = await res.json();
        if (data.ok) {
            loadData(false);
        }
    } catch (err) {
        alert("Lỗi kết nối tới Server");
    }
};

function formatTime(isoStr) {
    if (!isoStr) return "";
    try {
        const d = new Date(isoStr);
        return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch {
        return "";
    }
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
    if (autoRefreshInterval) clearInterval(autoRefreshInterval);
    autoRefreshInterval = setInterval(() => {
        loadData(false);
    }, 3000);
}

function stopAutoRefresh() {
    if (autoRefreshInterval) clearInterval(autoRefreshInterval);
}
