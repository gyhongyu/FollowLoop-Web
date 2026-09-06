/**
 * FollowLoop-Web SPA 主控制與 DOM 事件驅動腳本 (app.js - V5.3 模組化極速版)
 * 核心調度：Auth 登入 / Tab 導航 / 專案卡片列表渲染 / 通用 Toast / 雲端狀態監控
 */

document.addEventListener("DOMContentLoaded", async () => {
  console.log(`[FollowLoop-Web] 應用程式初始化 (V5.3 模組化架構)... 版本: ${CONFIG.VERSION}`);
  
  // 0. 優先極速探測本地 SQLite 服務 (127.0.0.1:8765)，確保登入與看板第一時間走 0ms 本地直連
  if (typeof detectLocalBackend === "function") {
    try {
      await detectLocalBackend();
    } catch (e) {
      console.warn("探測本地後端異常:", e);
    }
  }

  // Auth-first：先登入驗證，成功後才初始化所有模組
  FL_AUTH.initAuth(function onLoginSuccess(user) {
    console.log(`[Auth] 登入成功: ${user.name} (${user.id}), 角色: ${user.roles}`);

    // 登入後刷新 Admin Panel 主題卡片（per-user key 生效後需重建）
    if (window.FL_ADMIN && window.FL_ADMIN.refreshAfterLogin) {
      window.FL_ADMIN.refreshAfterLogin();
    }

    // 確保頂部狀態燈正確顯示
    if (typeof updateBackendStatusUI === "function") {
      updateBackendStatusUI(CONFIG.IS_LOCAL_MODE);
    }

    // 1. 初始化草稿狀態列事件
    if (typeof initDraftAlertBar === "function") {
      initDraftAlertBar();
    }

    // 1.5 初始化全域常駐 LLM 任務狀態機與日誌抽屜
    if (typeof initAiTaskConsole === "function") {
      initAiTaskConsole();
    }

    // 2. 初始化頁籤切換邏輯 (預設直傳門閥)
    initTabNavigation();

    // 3. 初始化模組一：直傳門閥 (Ingestion Gate)
    if (typeof initIngestionModule === "function") {
      initIngestionModule();
    }

    // 4. 初始化模組二：HITL 人工審核 (HITL Review Gate)
    if (typeof initHitlModule === "function") {
      initHitlModule();
    }

    // 5. 初始化模組三：專案看板 (Live View Dashboard)
    initLiveViewModule();

    // 6. 啟動背景輪詢 (僅更新 HITL 待審核數字)
    startAutoRefresh();

    // 7. 📲 檢查是否有從 Android 系統分享 (Web Share Target) 進來的檔案
    if (typeof handleIncomingSharedFiles === "function") {
      handleIncomingSharedFiles();
    }
  });
});

/* --------------------------------------------------------------------------
   1. 頁籤切換 Tab Navigation (預設開啟 ⚡ 直傳門閥)
   -------------------------------------------------------------------------- */
function initTabNavigation() {
  const tabButtons = document.querySelectorAll(".nav-tab-btn");
  const tabSections = document.querySelectorAll(".tab-content-section");

  tabButtons.forEach((btn) => {
    btn.addEventListener("click", async () => {
      const targetTab = btn.getAttribute("data-tab");

      tabButtons.forEach((b) => b.classList.remove("active"));
      tabSections.forEach((s) => s.classList.remove("active"));

      btn.classList.add("active");
      const targetSection = document.getElementById(`tab-section-${targetTab}`);
      if (targetSection) {
        targetSection.classList.add("active");
      }

      // 當切換到「💎 專案看板 (liveview)」時發起全屏 Promise Blocking 讀取
      if (targetTab === "liveview") {
        await renderLiveViewDashboard();
      }
    });
  });
}

/* --------------------------------------------------------------------------
   2. 模組三：💎 專案看板 (Live View Dashboard)
   -------------------------------------------------------------------------- */
function initLiveViewModule() {
  const searchInput = document.getElementById("kpi-search-input");
  const filterSelect = document.getElementById("kpi-filter-select");
  const refreshBtn = document.getElementById("liveview-refresh-btn");

  // 本地硬碟持久化記憶：還原上次選擇的過濾偏好
  const savedFilter = localStorage.getItem("FL_FILTER_PREFERENCE") || "ALL";
  if (filterSelect) {
    filterSelect.value = savedFilter;
  }
  if (window.liveView) {
    window.liveView.selectedCategory = savedFilter;
  }

  if (searchInput) {
    searchInput.addEventListener("input", (e) => {
      if (window.liveView) {
        window.liveView.applyFilter(e.target.value, filterSelect ? filterSelect.value : "ALL");
      }
      renderLiveViewGrid();
    });
  }

  if (filterSelect) {
    filterSelect.addEventListener("change", (e) => {
      const selectedVal = e.target.value;
      localStorage.setItem("FL_FILTER_PREFERENCE", selectedVal);
      if (window.liveView) {
        window.liveView.applyFilter(searchInput ? searchInput.value : "", selectedVal);
      }
      renderLiveViewGrid();
    });
  }

  if (refreshBtn) {
    refreshBtn.addEventListener("click", async () => {
      await renderLiveViewDashboard();
    });
  }
}

async function renderLiveViewDashboard() {
  if (window.liveView) {
    await window.liveView.fetchViewData(true);
  }
  renderLiveViewGrid();
}

function renderLiveViewGrid() {
  const container = document.getElementById("kpi-grid-container");
  if (!container || !window.liveView) return;

  const rows = window.liveView.filteredRows;
  if (!rows || rows.length === 0) {
    container.innerHTML = `
      <div style="grid-column: 1/-1; text-align: center; padding: 50px; color: var(--text-subtle);">
        🔍 查無符合條件的專案項目
      </div>
    `;
    return;
  }

  container.innerHTML = rows
    .map((item) => {
      // 提取最新最多 4 筆流水帳跟進動態內容
      let latestText = "";
      if (item.rawLogs && item.rawLogs.length > 0) {
        const top4Logs = item.rawLogs.slice(0, 4);
        latestText = top4Logs
          .map((log) => (log.updateLog || "").trim())
          .filter(Boolean)
          .join("\n");
      } else if (item.timelineHistory) {
        latestText = item.timelineHistory;
      }
      if (!latestText) latestText = "尚無詳細動態紀錄";

      // 專案等級發光燈號與 tooltip 提示
      let priorityIcon = "⚪";
      let priorityTitle = "⚪ 待完善 / 未分類新專案";
      let priorityClass = "priority-unclassified";
      
      const pUpper = (item.priority || "").toString().toUpperCase().trim();
      const isUnclassified = pUpper === "UNCLASSIFIED" || pUpper === "" || (item.projectName && item.projectName.includes("未分類專案")) || (item.accountName && item.accountName.includes("未指定客戶")) || (item.itemCode && item.itemCode.startsWith("Item_New"));

      if (isUnclassified) {
        priorityIcon = "⚪";
        priorityTitle = "⚪ 待完善 / 未分類新專案";
        priorityClass = "priority-unclassified";
      } else if (pUpper === "HIGH") {
        priorityIcon = "🟢";
        priorityTitle = "高優先權 / 主動進行";
        priorityClass = "priority-high";
      } else if (pUpper === "LOW") {
        priorityIcon = "🟠";
        priorityTitle = "低優先權 / 被動進行";
        priorityClass = "priority-low";
      } else if (pUpper === "PAUSED") {
        priorityIcon = "🔴";
        priorityTitle = "暫停行動";
        priorityClass = "priority-paused";
      }

      // 拆分「客戶名稱」與「專案標題」
      let accountLabel = item.accountName || "";
      let projectTitle = item.projectName || "";

      if (!accountLabel && !projectTitle) {
        const fullEntity = item.entity || item.id || "";
        if (fullEntity.includes(" - ")) {
          const parts = fullEntity.split(" - ");
          accountLabel = parts[0].trim();
          projectTitle = parts.slice(1).join(" - ").trim();
        } else {
          accountLabel = item.accountTag || item.itemCode || "專案";
          projectTitle = fullEntity;
        }
      } else if (!projectTitle && item.entity) {
        projectTitle = item.entity;
      }

      if (!accountLabel) accountLabel = item.accountTag || item.itemCode || "一般客戶";

      const stageHtml = item.stage ? `<span class="kpi-stage-tag">${item.stage}</span>` : "";

      return `
    <div class="kpi-card minimalist-kpi-card" onclick="openKpiDetailModal('${item.id}')" style="cursor: pointer;" title="客戶：${accountLabel}&#10;專案：${projectTitle}">
      <div class="kpi-card-content">
        <!-- 頂部工具列：燈號 + 公司名稱膠囊 + 階段 Badge -->
        <div class="kpi-header-row">
          <span class="priority-dot ${priorityClass}" title="專案等級：${priorityTitle}">${priorityIcon}</span>
          <span class="kpi-account-tag" title="${accountLabel}">${accountLabel}</span>
          ${stageHtml}
          <div class="kpi-card-actions">
            <button class="btn-card-action btn-card-edit" title="編輯專案主檔" onclick="event.stopPropagation(); if(window.projectManager) window.projectManager.openEditModal('${item.itemCode}')">✏️</button>
            <button class="btn-card-action btn-card-delete" title="刪除專案主檔" onclick="event.stopPropagation(); if(window.projectManager) window.projectManager.deleteProject('${item.itemCode}', '${accountLabel.replace(/'/g, "\\'")}', '${projectTitle.replace(/'/g, "\\'")}')">🗑️</button>
          </div>
        </div>
        
        <!-- 核心專案標題 -->
        <div class="kpi-project-title">${projectTitle}</div>

        <!-- 最新一條動態區塊 -->
        <div class="kpi-latest-block">
          <div class="kpi-latest-text">${latestText}</div>
        </div>
      </div>
    </div>
  `;
    })
    .join("");
}

/* --------------------------------------------------------------------------
   3. 通用 Toast 與背景輪詢
   -------------------------------------------------------------------------- */
function showToast(message, type = "info") {
  const container = document.getElementById("toast-container");
  if (!container) return;

  const toast = document.createElement("div");
  toast.className = `toast-item ${type}`;
  toast.innerHTML = `
    <span>${message}</span>
    <span style="cursor:pointer; margin-left: 10px;" onclick="this.parentElement.remove()">✕</span>
  `;

  container.appendChild(toast);

  setTimeout(() => {
    if (toast.parentElement) {
      toast.remove();
    }
  }, 2200);
}

function startAutoRefresh() {
  setInterval(async () => {
    if (window.hitlReviewer && typeof window.hitlReviewer.fetchPendingCards === "function") {
      await window.hitlReviewer.fetchPendingCards();
    }
  }, CONFIG.AUTO_REFRESH_INTERVAL);
}

// 🌐 全域掛載渲染函數供外部調用
window.showToast = showToast;
window.startAutoRefresh = startAutoRefresh;
window.renderLiveViewGrid = renderLiveViewGrid;
window.renderLiveViewDashboard = renderLiveViewDashboard;

// ☁️ 頂部雲端試算表連線狀態控制函數
window.setCloudStatus = function (status) {
  const pill = document.getElementById("cloud-sync-status");
  if (!pill) return;

  const iconEl = document.getElementById("cloud-sync-icon");
  const textEl = document.getElementById("cloud-sync-text");

  if (CONFIG.IS_LOCAL_MODE) {
    if (status === "syncing") {
      pill.style.background = "rgba(245, 158, 11, 0.25)";
      pill.style.borderColor = "rgba(245, 158, 11, 0.6)";
      pill.style.color = "#fbbf24";
      pill.title = "正在與 Google Sheet 雲端數據庫同步中...";
      if (iconEl) iconEl.textContent = "🔄";
      if (textEl) textEl.textContent = "同步中...";
    } else if (typeof window.checkCloudSyncStatus === "function") {
      window.checkCloudSyncStatus();
    }
    return;
  }

  if (status === "syncing") {
    pill.style.background = "rgba(245, 158, 11, 0.15)";
    pill.style.borderColor = "rgba(245, 158, 11, 0.4)";
    pill.style.color = "#fbbf24";
    pill.title = "Google Sheet 雲端同步中...";
    if (iconEl) iconEl.textContent = "🔄";
    if (textEl) textEl.textContent = "同步中";
  } else if (status === "offline" || status === "error") {
    pill.style.background = "rgba(239, 68, 68, 0.2)";
    pill.style.borderColor = "rgba(239, 68, 68, 0.5)";
    pill.style.color = "#f87171";
    pill.title = "Google Sheet 雲端連線失敗或處於離線狀態";
    if (iconEl) iconEl.textContent = "⛈️";
    if (textEl) textEl.textContent = "連線失敗";
  } else {
    pill.style.background = "rgba(16, 185, 129, 0.15)";
    pill.style.borderColor = "rgba(16, 185, 129, 0.4)";
    pill.style.color = "#34d399";
    pill.title = "Google Sheet 雲端連線正常已同步";
    if (iconEl) iconEl.textContent = "☁️";
    if (textEl) textEl.textContent = "已連線";
  }
};

// 🛡️ 瀏覽器關閉防呆保護
window.addEventListener("beforeunload", (e) => {
  if (window._isSyncing || (window.projectManager && window.projectManager.isSaving)) {
    e.preventDefault();
    e.returnValue = "您有正在同步至雲端的數據，確定要離開嗎？";
    return e.returnValue;
  }
});
