/**
 * FollowLoop-Web SPA 主控制與 DOM 事件驅動腳本 (app.js)
 * 整合：上傳門閥 / HITL 審核 / Live View 看板
 */

document.addEventListener("DOMContentLoaded", () => {
  console.log(`[FollowLoop-Web] 應用程式初始化... 版本: ${CONFIG.VERSION}`);
  
  // 1. 初始化頁籤切換邏輯 (Tabs)
  initTabNavigation();

  // 2. 初始化模組一：直傳門閥 (Ingestion Gate)
  initIngestionModule();

  // 3. 初始化模組二：HITL 人工審核 (HITL Review Gate)
  initHitlModule();

  // 4. 初始化模組三：Live View 看板 (Live View Dashboard)
  initLiveViewModule();

  // 5. 自動輪詢待審核卡片與 View 更新
  startAutoRefresh();
});

/* --------------------------------------------------------------------------
   1. 頁籤切換 Tab Navigation
   -------------------------------------------------------------------------- */
function initTabNavigation() {
  const tabButtons = document.querySelectorAll(".nav-tab-btn");
  const tabSections = document.querySelectorAll(".tab-content-section");

  tabButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const targetTab = btn.getAttribute("data-tab");

      tabButtons.forEach((b) => b.classList.remove("active"));
      tabSections.forEach((s) => s.classList.remove("active"));

      btn.classList.add("active");
      const targetSection = document.getElementById(`tab-section-${targetTab}`);
      if (targetSection) {
        targetSection.classList.add("active");
      }

      // 當切換到 Live View 時自動重新渲染看板
      if (targetTab === "liveview") {
        renderLiveViewDashboard();
      }
    });
  });
}

/* --------------------------------------------------------------------------
   2. 模組一：直傳門閥 (Ingestion Gate)
   -------------------------------------------------------------------------- */
function initIngestionModule() {
  const dropzone = document.getElementById("dropzone");
  const fileInput = document.getElementById("file-input");
  const progressContainer = document.getElementById("progress-container");
  const progressBarFill = document.getElementById("progress-bar-fill");
  const progressText = document.getElementById("progress-text");
  
  const micBtn = document.getElementById("mic-btn");
  const timerText = document.getElementById("timer-text");
  
  const noteTextarea = document.getElementById("note-textarea");
  const submitNoteBtn = document.getElementById("submit-note-btn");

  // 拖曳區事件
  if (dropzone && fileInput) {
    dropzone.addEventListener("click", () => fileInput.click());

    dropzone.addEventListener("dragover", (e) => {
      e.preventDefault();
      dropzone.classList.add("dragover");
    });

    dropzone.addEventListener("dragleave", () => {
      dropzone.classList.remove("dragover");
    });

    dropzone.addEventListener("drop", (e) => {
      e.preventDefault();
      dropzone.classList.remove("dragover");
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        handleFileUpload(e.dataTransfer.files[0]);
      }
    });

    fileInput.addEventListener("change", () => {
      if (fileInput.files && fileInput.files.length > 0) {
        handleFileUpload(fileInput.files[0]);
      }
    });
  }

  // 麥克風錄音事件
  if (micBtn) {
    micBtn.addEventListener("click", async () => {
      if (!driveUploader.isRecording) {
        try {
          await driveUploader.startRecording((seconds) => {
            const mins = String(Math.floor(seconds / 60)).padStart(2, "0");
            const secs = String(seconds % 60).padStart(2, "0");
            timerText.textContent = `${mins}:${secs}`;
          });
          micBtn.classList.add("recording");
          showToast("開始麥克風錄音...", "info");
        } catch (err) {
          showToast(err.message, "danger");
        }
      } else {
        try {
          showToast("停止錄音，準備二階段直傳 Google Drive...", "info");
          micBtn.classList.remove("recording");
          timerText.textContent = "00:00";
          const audioFile = await driveUploader.stopRecording();
          await handleFileUpload(audioFile);
        } catch (err) {
          showToast(err.message, "danger");
        }
      }
    });
  }

  // 快捷文字備註提交
  if (submitNoteBtn && noteTextarea) {
    submitNoteBtn.addEventListener("click", async () => {
      const text = noteTextarea.value;
      if (!text.trim()) {
        showToast("請輸入速記內容！", "warning");
        return;
      }

      submitNoteBtn.disabled = true;
      submitNoteBtn.textContent = "處理中...";
      try {
        await driveUploader.uploadTextNote(text);
        showToast("速記已成功傳送至 FollowLoop Raw Inputs 門閥！", "success");
        noteTextarea.value = "";
      } catch (err) {
        showToast(`傳送失敗: ${err.message}`, "danger");
      } finally {
        submitNoteBtn.disabled = false;
        submitNoteBtn.textContent = "傳送至 FollowLoop 門閥";
      }
    });
  }

  // 統一檔案直傳處理
  async function handleFileUpload(file) {
    if (!file) return;

    const userNotes = noteTextarea ? noteTextarea.value : "";
    progressContainer.classList.add("active");
    progressBarFill.style.width = "0%";
    progressText.textContent = `準備上傳: ${file.name}... (0%)`;

    try {
      showToast(`開始二階段直傳: ${file.name}`, "info");
      const result = await driveUploader.uploadFileDirect(file, userNotes, (percent) => {
        progressBarFill.style.width = `${percent}%`;
        progressText.textContent = `直傳 Google Drive 中: ${percent}%`;
      });

      progressBarFill.style.width = "100%";
      progressText.textContent = "直傳完成！等候本機 AI 智腦解析";
      showToast(`🎉 檔案 ${file.name} 直傳 Google Drive 成功！`, "success");
      
      if (noteTextarea) noteTextarea.value = "";
      setTimeout(() => {
        progressContainer.classList.remove("active");
      }, 3000);
    } catch (err) {
      showToast(`上傳失敗: ${err.message}`, "danger");
      progressText.textContent = "上傳失敗";
    }
  }
}

/* --------------------------------------------------------------------------
   3. 模組二：HITL 人工審核 (HITL Review Gate)
   -------------------------------------------------------------------------- */
function initHitlModule() {
  const container = document.getElementById("hitl-card-grid");
  const refreshBtn = document.getElementById("hitl-refresh-btn");
  const badgeCount = document.getElementById("hitl-badge-count");

  // 訂閱卡片列表更新
  hitlReviewer.subscribe((cards) => {
    if (badgeCount) badgeCount.textContent = cards.length;
    renderHitlCards(cards);
  });

  if (refreshBtn) {
    refreshBtn.addEventListener("click", async () => {
      showToast("正在拉取最新待審核卡片...", "info");
      await hitlReviewer.fetchPendingCards();
    });
  }

  // 初始加載卡片
  hitlReviewer.fetchPendingCards();
}

function renderHitlCards(cards) {
  const container = document.getElementById("hitl-card-grid");
  if (!container) return;

  if (!cards || cards.length === 0) {
    container.innerHTML = `
      <div style="grid-column: 1/-1; text-align: center; padding: 50px; color: var(--text-subtle);">
        <div style="font-size: 40px; margin-bottom: 10px;">✨</div>
        <p style="font-size: 1.1rem; font-weight: 600;">目前沒有尚待審核的動態卡片</p>
        <p style="font-size: 0.85rem;">本機 AI 代理人解析完畢後，卡片會自動出現在此處供您 [是/修改/否] 審核</p>
      </div>
    `;
    return;
  }

  container.innerHTML = cards
    .map(
      (card) => `
    <div class="hitl-card" id="card-${card.entry_id}">
      <div>
        <div class="card-header">
          <span class="card-badge-type">${card.source_type || "Raw Data Ingestion"}</span>
          <span style="font-size: 0.78rem; color: var(--text-subtle);">${new Date(card.timestamp).toLocaleString()}</span>
        </div>
        <div class="card-title">${card.title || "AI 結構化解析條目"}</div>
        
        <div class="card-field-group">
          <div class="field-row">
            <span class="field-label">權責 Entity:</span>
            <span class="field-value">${card.entity_target || "未指定"}</span>
          </div>
          <div class="field-row">
            <span class="field-label">動態 Action:</span>
            <span class="field-value">${card.action_taken || "無摘要"}</span>
          </div>
          <div class="field-row">
            <span class="field-label">專案 Tag:</span>
            <span class="field-value" style="color: var(--primary-light); font-weight: 700;">${card.project_tag || "General"}</span>
          </div>
          ${card.raw_text ? `<div style="font-size: 0.8rem; color: var(--text-muted); margin-top: 4px; font-style: italic;">"${card.raw_text}"</div>` : ""}
        </div>
      </div>

      <div class="hitl-actions">
        <button class="btn-approve" onclick="onApproveCard('${card.entry_id}')">✓ 是 (Approve)</button>
        <button class="btn-edit" onclick="onEditCardModal('${card.entry_id}')">✎ 修改 (Edit)</button>
        <button class="btn-reject" onclick="onRejectCard('${card.entry_id}')">✕ 否 (Reject)</button>
      </div>
    </div>
  `
    )
    .join("");
}

// 點擊 [是 (Approve)]
window.onApproveCard = async function (entryId) {
  try {
    const res = await hitlReviewer.approveCard(entryId);
    showToast(res.message, "success");
  } catch (err) {
    showToast(`批准失敗: ${err.message}`, "danger");
  }
};

// 點擊 [修改 (Edit)]
window.onEditCardModal = function (entryId) {
  const card = hitlReviewer.pendingCards.find((c) => c.entry_id === entryId);
  if (!card) return;

  document.getElementById("modal-card-id").value = card.entry_id;
  document.getElementById("modal-entity").value = card.entity_target || "";
  document.getElementById("modal-action").value = card.action_taken || "";
  document.getElementById("modal-tag").value = card.project_tag || "";
  document.getElementById("modal-details").value = card.raw_text || "";

  document.getElementById("edit-modal-backdrop").classList.add("active");
};

window.closeEditModal = function () {
  document.getElementById("edit-modal-backdrop").classList.remove("active");
};

window.submitEditCard = async function () {
  const entryId = document.getElementById("modal-card-id").value;
  const updatedFields = {
    entity_target: document.getElementById("modal-entity").value,
    action_taken: document.getElementById("modal-action").value,
    project_tag: document.getElementById("modal-tag").value,
    details: document.getElementById("modal-details").value
  };

  try {
    const res = await hitlReviewer.editAndApproveCard(entryId, updatedFields);
    closeEditModal();
    showToast(res.message, "success");
  } catch (err) {
    showToast(`修改保存失敗: ${err.message}`, "danger");
  }
};

// 點擊 [否 (Reject)] — 機制 A (廢棄不落庫)
window.onRejectCard = async function (entryId) {
  if (confirm("確定將此卡片標記為 [否 (Reject)] 廢棄？\n資料將留在 Drive 作歷史備查，本機 AI 未來會自動跳過。")) {
    try {
      const res = await hitlReviewer.rejectCard(entryId);
      showToast(res.message, "warning");
    } catch (err) {
      showToast(`標記失敗: ${err.message}`, "danger");
    }
  }
};

/* --------------------------------------------------------------------------
   4. 模組三：Live View 看板 (Live View Dashboard)
   -------------------------------------------------------------------------- */
function initLiveViewModule() {
  const searchInput = document.getElementById("kpi-search-input");
  const filterSelect = document.getElementById("kpi-filter-select");
  const refreshBtn = document.getElementById("liveview-refresh-btn");

  if (searchInput) {
    searchInput.addEventListener("input", (e) => {
      liveView.applyFilter(e.target.value, filterSelect ? filterSelect.value : "ALL");
      renderLiveViewGrid();
    });
  }

  if (filterSelect) {
    filterSelect.addEventListener("change", (e) => {
      liveView.applyFilter(searchInput ? searchInput.value : "", e.target.value);
      renderLiveViewGrid();
    });
  }

  if (refreshBtn) {
    refreshBtn.addEventListener("click", async () => {
      showToast("正在讀取 Memory_Pool_View 最新 KPI 看板...", "info");
      await renderLiveViewDashboard();
    });
  }
}

async function renderLiveViewDashboard() {
  await liveView.fetchViewData();
  renderLiveViewGrid();
}

function renderLiveViewGrid() {
  const container = document.getElementById("kpi-grid-container");
  if (!container) return;

  const rows = liveView.filteredRows;
  if (!rows || rows.length === 0) {
    container.innerHTML = `
      <div style="grid-column: 1/-1; text-align: center; padding: 50px; color: var(--text-subtle);">
        🔍 查無符合條件的 H2 專案 KPI 項目
      </div>
    `;
    return;
  }

  container.innerHTML = rows
    .map(
      (item) => `
    <div class="kpi-card" onclick="openKpiDetailModal('${item.id}')">
      <div>
        <div class="kpi-header">
          <span class="kpi-code">${item.itemCode}</span>
          <span style="font-size: 0.78rem; color: var(--text-subtle);">${item.tag || "KPI 追蹤"}</span>
        </div>
        <div class="kpi-title">${item.taskName}</div>
        <div style="font-size: 0.85rem; color: var(--primary-light); margin-bottom: 8px;">👤 ${item.entity}</div>
        <div class="kpi-timeline-preview">${item.timelineHistory}</div>
      </div>
      <div style="font-size: 0.75rem; color: var(--text-subtle); margin-top: 10px; display: flex; justify-content: space-between;">
        <span>Memory_Pool_View 連動中</span>
        <span>${item.lastUpdated}</span>
      </div>
    </div>
  `
    )
    .join("");
}

window.openKpiDetailModal = function (kpiId) {
  const item = liveView.viewRows.find((r) => r.id === kpiId);
  if (!item) return;

  document.getElementById("detail-kpi-code").textContent = `${item.itemCode} - ${item.taskName}`;
  document.getElementById("detail-entity").textContent = item.entity;
  document.getElementById("detail-notes").textContent = item.notes || "無額外備註";
  document.getElementById("detail-timeline").textContent = item.timelineHistory;

  document.getElementById("detail-modal-backdrop").classList.add("active");
};

window.closeDetailModal = function () {
  document.getElementById("detail-modal-backdrop").classList.remove("active");
};

/* --------------------------------------------------------------------------
   5. 通用工具與 Toast 訊息通知
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
  }, 4000);
}

function startAutoRefresh() {
  setInterval(async () => {
    // 背景輪詢待審核卡片
    await hitlReviewer.fetchPendingCards();
  }, CONFIG.AUTO_REFRESH_INTERVAL);
}
