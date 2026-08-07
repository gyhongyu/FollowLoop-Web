/**
 * FollowLoop-Web SPA 主控制與 DOM 事件驅動腳本 (app.js - V1.2 本地草稿與 SSOT 升級版)
 * 整合：直傳門閥 (預設開啟) / HITL 審核 / 專案看板 (全屏 Promise Blocking & Local Draft CRUD)
 */

document.addEventListener("DOMContentLoaded", () => {
  console.log(`[FollowLoop-Web] 應用程式初始化 (V1.2 Local Draft & SSOT)... 版本: ${CONFIG.VERSION}`);
  
  // 1. 初始化草稿狀態列事件
  initDraftAlertBar();

  // 2. 初始化頁籤切換邏輯 (預設直傳門閥)
  initTabNavigation();

  // 3. 初始化模組一：直傳門閥 (Ingestion Gate)
  initIngestionModule();

  // 4. 初始化模組二：HITL 人工審核 (HITL Review Gate)
  initHitlModule();

  // 5. 初始化模組三：專案看板 (Live View Dashboard)
  initLiveViewModule();

  // 6. 啟動背景輪詢 (僅更新 HITL 待審核數字)
  startAutoRefresh();
});

/* --------------------------------------------------------------------------
   1. 本地草稿提示列 (Local Draft Status Bar)
   -------------------------------------------------------------------------- */
function initDraftAlertBar() {
  const syncBtn = document.getElementById("btn-draft-sync");
  const discardBtn = document.getElementById("btn-draft-discard");

  if (syncBtn) {
    syncBtn.addEventListener("click", () => syncLocalDraftsToCloud());
  }

  if (discardBtn) {
    discardBtn.addEventListener("click", () => discardLocalDrafts());
  }

  // 初始更新狀態
  window.updateDraftAlertBarUI = function(count) {
    const bar = document.getElementById("draft-alert-bar");
    const textEl = document.getElementById("draft-alert-text");
    if (!bar || !textEl) return;

    if (count > 0) {
      textEl.textContent = `您目前有 ${count} 筆未同步至雲端的變更（斷網或關閉網頁均不遺失，點擊「更新至雲端」生效）`;
      bar.classList.remove("hidden");
    } else {
      bar.classList.add("hidden");
    }
  };

  window.draftStore.notifyUI();
}

/**
 * 將 LocalStorage 草稿全數批次推送到雲端 Memory_Pool_Raw 數據庫
 */
async function syncLocalDraftsToCloud() {
  const drafts = window.draftStore.drafts;
  const count = window.draftStore.getDraftCount();
  if (count === 0) return;

  if (!confirm(`確定將本地 ${count} 筆變更同步上傳至 Google Drive 雲端 Memory_Pool_Raw 數據庫？`)) {
    return;
  }

  liveView.showFullscreenLoading("正在同步本地草稿至雲端...", `處理 ${count} 筆 CRUD 異步請求中`);

  try {
    // 1. 新增筆數 (batch_append_raw)：依據 gas_code.gs 行 222，必須傳送 contents.rows 11 欄二維陣列
    for (const item of drafts.appended) {
      const logId = item.logId || `LOG_${Date.now()}`;
      const timestamp = item.timestamp || new Date().toISOString();
      const rowArray = [
        logId,                                   // 1. log_id
        timestamp,                               // 2. timestamp
        item.projectTag || "General",            // 3. project_tag
        item.entityTarget || "未指定單位",         // 4. entity_target
        "",                                      // 5. target_purpose
        "",                                      // 6. our_advantages
        item.actionTaken || "最新跟進",           // 7. action_taken
        item.updateLog || "",                    // 8. update_log
        "",                                      // 9. attachment_links
        "1.0",                                   // 10. confidence_score
        "APPROVED"                               // 11. agent_status
      ];

      const res = await sendGasRequest("batch_append_raw", {
        rows: [rowArray]
      });
      if (!res || res.status !== "success") {
        throw new Error(res ? res.message : "GAS 寫入未傳回 success 狀態");
      }
    }

    // 2. 修改筆數 (fix_raw_log)：依據 gas_code.gs 行 241，必須帶 contents.old_text 與 contents.new_text
    for (const logId of Object.keys(drafts.edited)) {
      const editInfo = drafts.edited[logId];
      const oldItem = liveView.viewRows.flatMap(r => r.rawLogs).find(l => l.logId === logId);
      const oldText = oldItem ? oldItem.updateLog : "";
      
      if (oldText) {
        const res = await sendGasRequest("fix_raw_log", {
          old_text: oldText,
          new_text: editInfo.updateLog
        });
        if (!res || res.status !== "success") {
          throw new Error(res ? res.message : "GAS 修正未傳回 success 狀態");
        }
      } else {
        const rowArray = [
          `FIX_${logId}_${Date.now()}`,
          new Date().toISOString(),
          "General",
          "修訂紀錄",
          "", "", "編輯內容",
          editInfo.updateLog,
          "", "1.0", "APPROVED"
        ];
        const res = await sendGasRequest("batch_append_raw", { rows: [rowArray] });
        if (!res || res.status !== "success") {
          throw new Error(res ? res.message : "GAS 修正追加未傳回 success 狀態");
        }
      }
    }

    // 3. 作廢筆數 (review_action REJECT)：依據 gas_code.gs 行 440
    for (const logId of drafts.deleted) {
      const oldItem = liveView.viewRows.flatMap(r => r.rawLogs).find(l => l.logId === logId);
      if (oldItem) {
        const rowArray = [
          logId,
          new Date().toISOString(),
          oldItem.projectTag || "General",
          oldItem.entityTarget || "",
          "", "", "作廢條目",
          `[已作廢] ${oldItem.updateLog}`,
          "", "1.0", "REJECTED"
        ];
        const res = await sendGasRequest("review_action", {
          decision: "REJECT",
          rows: [rowArray]
        });
        if (!res || res.status !== "success") {
          throw new Error(res ? res.message : "GAS 作廢標記未傳回 success 狀態");
        }
      }
    }

    // 清空本地草稿並重載數據庫
    window.draftStore.clearDrafts();
    showToast(`🎉 成功同步 ${count} 筆變更至 Google Drive 雲端數據庫！`, "success");
    await liveView.fetchViewData(false);
    renderLiveViewGrid();

    // 如果詳情 Modal 開啟中，同步刷新時間軸
    if (window.currentActiveKpiId) {
      window.openKpiDetailModal(window.currentActiveKpiId);
    }
  } catch (err) {
    showToast(`同步至雲端失敗: ${err.message}`, "danger");
  } finally {
    liveView.hideFullscreenLoading();
  }
}

/**
 * 一鍵放棄所有本地草稿變更
 */
function discardLocalDrafts() {
  const count = window.draftStore.getDraftCount();
  if (count === 0) return;

  if (confirm(`確定放棄本地 ${count} 筆未同步的草稿變更？\n此動作無法撤銷，將還原為雲端最新資料。`)) {
    window.draftStore.clearDrafts();
    showToast("已放棄本地草稿變更，還原雲端最新數據！", "warning");
    renderLiveViewDashboard();
  }
}


/* --------------------------------------------------------------------------
   2. 頁籤切換 Tab Navigation (預設開啟 ⚡ 直傳門閥)
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
   3. 模組一：直傳門閥 (Ingestion Gate)
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

  async function handleFileUpload(file) {
    if (!file) return;

    const userNotes = noteTextarea ? noteTextarea.value : "";
    progressContainer.classList.add("active");
    progressBarFill.style.width = "0%";
    progressText.textContent = `準備上傳: ${file.name}... (0%)`;

    try {
      showToast(`開始二階段直傳: ${file.name}`, "info");
      await driveUploader.uploadFileDirect(file, userNotes, (percent) => {
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
   4. 模組二：HITL 人工審核 (HITL Review Gate)
   -------------------------------------------------------------------------- */
function initHitlModule() {
  const refreshBtn = document.getElementById("hitl-refresh-btn");
  const badgeCount = document.getElementById("hitl-badge-count");

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

window.onApproveCard = async function (entryId) {
  try {
    const res = await hitlReviewer.approveCard(entryId);
    showToast(res.message, "success");
  } catch (err) {
    showToast(`批准失敗: ${err.message}`, "danger");
  }
};

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

window.onRejectCard = async function (entryId) {
  if (confirm("確定將此卡片標記為 [否 (Reject)] 廢棄？")) {
    try {
      const res = await hitlReviewer.rejectCard(entryId);
      showToast(res.message, "warning");
    } catch (err) {
      showToast(`標記失敗: ${err.message}`, "danger");
    }
  }
};


/* --------------------------------------------------------------------------
   5. 模組三：💎 專案看板 (Live View Dashboard)
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
      await renderLiveViewDashboard();
    });
  }
}

async function renderLiveViewDashboard() {
  // 發起 Promise Blocking 全屏加載，絕非 setTimeout
  await liveView.fetchViewData(true);
  renderLiveViewGrid();
}

function renderLiveViewGrid() {
  const container = document.getElementById("kpi-grid-container");
  if (!container) return;

  const rows = liveView.filteredRows;
  if (!rows || rows.length === 0) {
    container.innerHTML = `
      <div style="grid-column: 1/-1; text-align: center; padding: 50px; color: var(--text-subtle);">
        🔍 查無符合條件的專案項目
      </div>
    `;
    return;
  }

  container.innerHTML = rows
    .map(
      (item) => `
    <div class="kpi-card" onclick="openKpiDetailModal('${item.id}')" style="position: relative;">
      <div>
        <div class="kpi-header">
          <span style="font-size: 0.78rem; color: #60a5fa; background: rgba(96, 165, 250, 0.12); padding: 2px 8px; border-radius: 4px; border: 1px solid rgba(96, 165, 250, 0.25);">Tag: ${item.itemCode}</span>
          <span style="background: rgba(52, 211, 153, 0.15); color: #34d399; border: 1px solid rgba(52, 211, 153, 0.3); padding: 2px 10px; border-radius: 12px; font-size: 0.78rem; font-weight: 600;">🚀 ${item.actionTaken || "進行中"}</span>
        </div>
        
        <!-- 突出顯示權責與商業主體 entity (隱藏 Item_01 硬碼為主的展示) -->
        <div class="kpi-title" style="font-size: 1.15rem; font-weight: 700; color: #f8fafc; margin: 10px 0 6px 0; line-height: 1.35;">🏢 ${item.entity}</div>
        
        ${item.taskName ? `<div style="font-size: 0.86rem; color: #cbd5e1; margin-bottom: 6px;">🎯 <strong>對方訴求：</strong>${item.taskName}</div>` : ""}
        ${item.ourAdvantages ? `<div style="font-size: 0.84rem; color: #fbbf24; margin-bottom: 10px;">💡 <strong>我方切入點：</strong>${item.ourAdvantages}</div>` : ""}
        
        <!-- 最新一筆動態預覽 -->
        <div class="kpi-timeline-preview" style="font-size: 0.82rem; color: #94a3b8; background: rgba(15, 23, 42, 0.6); padding: 8px 10px; border-radius: 6px; white-space: pre-line; max-height: 64px; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;">${item.timelineHistory}</div>
      </div>
      
      <div style="font-size: 0.75rem; color: var(--text-subtle); margin-top: 12px; display: flex; justify-content: space-between; align-items: center;">
        <span>Memory_Pool_Raw 實時跟進</span>
        <span style="color: #64748b;">${item.lastUpdated}</span>
      </div>
    </div>
  `
    )
    .join("");
}

/* --------------------------------------------------------------------------
   6. Modal 專案詳情與垂直時間軸 (Timeline Spine & Local Draft CRUD)
   -------------------------------------------------------------------------- */
window.openKpiDetailModal = function (kpiId) {
  window.currentActiveKpiId = kpiId;
  const item = liveView.viewRows.find((r) => r.id === kpiId);
  if (!item) return;

  // 設定 Header
  const titleEl = document.getElementById("detail-entity-title");
  if (titleEl) titleEl.textContent = `🏢 ${item.entity}`;

  const subTagEl = document.getElementById("detail-project-tag-sub");
  if (subTagEl) subTagEl.textContent = `專案 GroupBy Tag: ${item.itemCode}`;

  // 設定訴求與切入點
  const entityEl = document.getElementById("detail-entity");
  if (entityEl) {
    entityEl.innerHTML = `
      <div style="font-size: 0.95rem; color: #f8fafc; margin-bottom: 6px;">
        <strong>🎯 對方訴求與目的:</strong> ${item.taskName || "無特定說明"}
      </div>
      ${item.ourAdvantages ? `<div style="font-size: 0.92rem; color: #fbbf24;"><strong>💡 我方切入點:</strong> ${item.ourAdvantages}</div>` : ""}
    `;
  }

  // 綁定「➕ 暫存至本地」按鈕事件
  const addBtn = document.getElementById("btn-add-timeline-log");
  const addInput = document.getElementById("new-timeline-input");

  if (addBtn && addInput) {
    // 移除舊 listener
    const newBtn = addBtn.cloneNode(true);
    addBtn.parentNode.replaceChild(newBtn, addBtn);

    newBtn.addEventListener("click", () => {
      const text = addInput.value.trim();
      if (!text) {
        showToast("請輸入動態內文！", "warning");
        return;
      }

      window.draftStore.addDraftLog(item.itemCode, item.entity, text);
      addInput.value = "";
      showToast("已將最新動態暫存至本地草稿！(需按頂部「更新至雲端」同步)", "info");

      // 重新讀取並刷新 DOM
      liveView.fetchViewData(false).then(() => {
        renderLiveViewGrid();
        openKpiDetailModal(kpiId);
      });
    });
  }

  // 渲染垂直時間軸 (Newest First)
  renderTimelineSpine(item);

  const backdropEl = document.getElementById("detail-modal-backdrop");
  if (backdropEl) backdropEl.classList.add("active");
};

function renderTimelineSpine(item) {
  const spineContainer = document.getElementById("detail-timeline-spine");
  if (!spineContainer) return;

  const logs = item.rawLogs || [];
  if (logs.length === 0) {
    spineContainer.innerHTML = `<div style="text-align: center; color: var(--text-subtle); padding: 20px;">尚無歷史動態紀錄</div>`;
    return;
  }

  spineContainer.innerHTML = logs
    .map((log) => {
      const isDraftClass = log.isDraft ? "is-draft" : "";
      const isDraftBadge = log.isDraft
        ? `<span style="background: #f59e0b; color: #0f172a; padding: 1px 6px; border-radius: 4px; font-weight: 800; font-size: 0.72rem;">本地新草稿</span>`
        : log.isDraftEdit
        ? `<span style="background: #60a5fa; color: #0f172a; padding: 1px 6px; border-radius: 4px; font-weight: 800; font-size: 0.72rem;">本地已編修</span>`
        : "";

      const timeStr = log.timestamp ? new Date(log.timestamp).toLocaleString() : "歷史紀錄";

      return `
        <div class="timeline-item-card ${isDraftClass}">
          <div class="timeline-content">
            <div class="timeline-meta">
              <span>🕒 ${timeStr}</span>
              ${isDraftBadge}
            </div>
            <div class="timeline-text">${log.updateLog}</div>
          </div>
          <div class="timeline-actions">
            <button class="btn-timeline-action" title="編輯此筆動態 (暫存本地)" onclick="onEditTimelineItem('${item.id}', '${log.logId}')">✎ 編輯</button>
            <button class="btn-timeline-action delete" title="作廢此筆動態 (暫存本地)" onclick="onDeleteTimelineItem('${item.id}', '${log.logId}')">✕ 作廢</button>
          </div>
        </div>
      `;
    })
    .join("");
}

// 點擊時間軸「✎ 編輯」
window.onEditTimelineItem = function (kpiId, logId) {
  const item = liveView.viewRows.find((r) => r.id === kpiId);
  if (!item) return;

  const log = item.rawLogs.find((l) => l.logId === logId);
  if (!log) return;

  const newText = prompt("修改這筆跟進紀錄 (編修結果將暫存於本地草稿):", log.updateLog);
  if (newText !== null && newText.trim() !== "") {
    window.draftStore.editDraftLog(logId, newText.trim());
    showToast("修訂已暫存至本地草稿！", "info");

    liveView.fetchViewData(false).then(() => {
      renderLiveViewGrid();
      openKpiDetailModal(kpiId);
    });
  }
};

// 點擊時間軸「✕ 作廢」
window.onDeleteTimelineItem = function (kpiId, logId) {
  if (confirm("確定作廢此筆動態？\n變更將暫存於本地草稿，點擊「更新至雲端」後生效。")) {
    window.draftStore.deleteDraftLog(logId);
    showToast("作廢標記已暫存至本地草稿！", "warning");

    liveView.fetchViewData(false).then(() => {
      renderLiveViewGrid();
      openKpiDetailModal(kpiId);
    });
  }
};

window.closeDetailModal = function () {
  document.getElementById("detail-modal-backdrop").classList.remove("active");
  window.currentActiveKpiId = null;
};


/* --------------------------------------------------------------------------
   7. 通用 Toast 與背景輪詢
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
    await hitlReviewer.fetchPendingCards();
  }, CONFIG.AUTO_REFRESH_INTERVAL);
}
