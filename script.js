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
            errorMsg.innerText = "Lỗi kết nối mạng tuyến tính!";
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
        if (globalDataCache) {
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
            dashboardBox.style.display = "block";
            await loadData(false);
        } else {
            loginBox.style.display = "flex";
        }
    } catch {
        loginBox.style.display = "flex";
    }
}

async function loadData(isManual = false) {
    const container = document.getElementById("contentData");
    if (isManual) container.innerHTML = `<div class="loading-state">Đang làm mới dữ liệu...</div>`;

    try {
        const res = await fetch("/admin/data");
        if (res.status === 401) {
            location.reload();
            return;
        }
        
        const data = await res.json();
        globalDataCache = data;

        // Cập nhật thẻ thông số (Metrics)
        document.getElementById("statClients").innerText = data.stats.totalClients;
        document.getElementById("ipDisplay").innerText = `IP: ${data.stats.activeIp}`;

        let totalQ = 0;
        let totalE = 0;
        for (const val of Object.values(data.clientsData)) {
            totalQ += (val.queue || []).length;
            totalE += (val.events || []).length;
        }
        document.getElementById("statQueues").innerText = totalQ;
        document.getElementById("statEvents").innerText = totalE;

        // Render danh sách Client theo bộ lọc tìm kiếm hiện tại
        const filterText = document.getElementById("searchInput").value;
        renderClients(data.clientsData, filterText);

    } catch {
        container.innerHTML = `<div class="empty-state" style="color: var(--neon-pink);">Lỗi khi đồng bộ dữ liệu từ Relay Server.</div>`;
    }
}

function renderClients(clientsData, filter = "") {
    const container = document.getElementById("contentData");
    let html = "";
    
    const filteredKeys = Object.keys(clientsData).filter(key => key.toLowerCase().includes(filter.toLowerCase()));

    for (const key of filteredKeys) {
        const val = clientsData[key];
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
    }, 3000); // Tự động làm mới mỗi 3 giây
}

function stopAutoRefresh() {
    if (autoRefreshInterval) clearInterval(autoRefreshInterval);
}