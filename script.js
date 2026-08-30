let globalDataCache = null;
let autoRefreshInterval = null;

document.addEventListener("DOMContentLoaded", async () => {
    const loginBox = document.getElementById("loginBox");
    const dashboardBox = document.getElementById("dashboardBox");
    const loginForm = document.getElementById("loginForm");
    const logoutBtn = document.getElementById("logoutBtn");
    const reloadBtn = document.getElementById("reloadBtn");
    const searchInput = document.getElementById("searchInput");
    const autoRefreshToggle = document.getElementById("autoRefreshToggle");

    // Kiểm tra trạng thái đăng nhập ban đầu
    await checkAuthAndLoad();

    // Xử lý Login Form
    loginForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const username = document.getElementById("username").value;
        const password = document.getElementById("admin_password").value;
        const errorMsg = document.getElementById("errorMsg");

        try {
            const res = await fetch("/login", {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });
            const data = await res.json();
            
            if (data.ok) {
                location.reload();
            } else {
                errorMsg.innerText = data.error || "Xác thực thất bại!";
            }
        } catch {
            errorMsg.innerText = "Lỗi kết nối tới Server!";
        }
    });

    // Logout
    logoutBtn.addEventListener("click", async () => {
        await fetch("/logout");
        location.reload();
    });

    // Nút làm mới thủ công
    reloadBtn.addEventListener("click", () => loadData(true));

    // Tìm kiếm trực tiếp client key
    searchInput.addEventListener("input", () => {
        if (globalDataCache && globalDataCache.clientsData) {
            renderClients(globalDataCache.clientsData, searchInput.value);
        }
    });

    // Toggle Auto-refresh
    autoRefreshToggle.addEventListener("change", (e) => {
        if (e.target.checked) {
            startAutoRefresh();
        } else {
            stopAutoRefresh();
        }
    });

    startAutoRefresh();
});

async function checkAuthAndLoad() {
    const loginBox = document.getElementById("loginBox");
    const dashboardBox = document.getElementById("dashboardBox");

    try {
        const res = await fetch("/admin/data");
        if (res.ok) {
            loginBox.style.display = "none";
            dashboardBox.style.display = "block";
            await loadData(false);
        } else {
            dashboardBox.style.display = "none";
            loginBox.style.display = "flex";
        }
    } catch {
        dashboardBox.style.display = "none";
        loginBox.style.display = "flex";
    }
}

async function loadData(isManual = false) {
    const container = document.getElementById("contentData");
    if (isManual && container) container.innerHTML = `<div class="loading-state">Đang làm mới dữ liệu...</div>`;

    try {
        const res = await fetch("/admin/data");
        if (res.status === 401) {
            location.reload();
            return;
        }
        
        const data = await res.json();
        globalDataCache = data;

        // Cập nhật thông số
        const elClients = document.getElementById("statClients");
        const elIp = document.getElementById("ipDisplay");
        const elQ = document.getElementById("statQueues");
        const elE = document.getElementById("statEvents");

        if (elClients) elClients.innerText = data.stats?.totalClients || 0;
        if (elIp) elIp.innerText = `IP: ${data.stats?.activeIp || '127.0.0.1'}`;

        let totalQ = 0;
        let totalE = 0;
        const clients = data.clientsData || {};
        for (const val of Object.values(clients)) {
            totalQ += (val.queue || []).length;
            totalE += (val.events || []).length;
        }
        if (elQ) elQ.innerText = totalQ;
        if (elE) elE.innerText = totalE;

        // Render danh sách Client theo bộ lọc tìm kiếm
        const filterText = document.getElementById("searchInput")?.value || "";
        renderClients(clients, filterText);

    } catch {
        if (container) {
            container.innerHTML = `<div class="empty-state" style="color: var(--neon-pink);">Lỗi khi đồng bộ dữ liệu từ Relay Server.</div>`;
        }
    }
}

function renderClients(clientsData, filter = "") {
    const container = document.getElementById("contentData");
    if (!container) return;

    let html = "";
    const filteredKeys = Object.keys(clientsData || {}).filter(key => key.toLowerCase().includes(filter.toLowerCase()));

    for (const key of filteredKeys) {
        const val = clientsData[key] || { queue: [], events: [] };
        html += `
            <div class="client-box">
                <div class="client-header">
                    <h3 class="client-key-title">🔑 KEY: ${key}</h3>
                    <span style="font-size: 11px; color: var(--text-muted);">Queue: ${val.queue.length} | Events: ${val.events.length}</span>
                </div>
                <div class="data-panels">
                    <div>
                        <span class="panel-title">📦 HÀNG ĐỢI LỆNH (QUEUE)</span>
                        <pre>${JSON.stringify(val.queue, null, 2)}</pre>
                    </div>
                    <div>
                        <span class="panel-title">⚡ SỰ KIỆN GẦN NHẤT (EVENTS LOG)</span>
                        <pre>${JSON.stringify(val.events, null, 2)}</pre>
                    </div>
                </div>
            </div>
        `;
    }

    if (filteredKeys.length === 0) {
        html = `<div class="empty-state">Không tìm thấy Client Key phù hợp với bộ lọc.</div>`;
    }

    container.innerHTML = html;
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