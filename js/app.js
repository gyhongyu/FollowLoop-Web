/**
 * FollowLoop-Web SPA 主控制與 DOM 事件驅動腳本 (app.js - V1.2 本地草稿與 SSOT 升級版)
 * 整合：直傳門閥 (預設開啟) / HITL 審核 / 專案看板 (全屏 Promise Blocking & Local Draft CRUD)
 */

document.addEventListener("DOMContentLoaded", () => {
  console.log(`[FollowLoop-Web] 應用程式初始化 (V2.0 Auth + Local Draft & SSOT)... 版本: ${CONFIG.VERSION}`);
  
  // Auth-first：先登入驗證，成功後才初始化所有模組
  FL_AUTH.initAuth(function onLoginSuccess(user) {
    console.log(`[Auth] 登入成功: ${user.name} (${user.id}), 角色: ${user.roles}`);

    // 登入後刷新 Admin Panel 主題卡片（per-user key 生效後需重建）
    if (window.FL_ADMIN && window.FL_ADMIN.refreshAfterLogin) {
      window.FL_ADMIN.refreshAfterLogin();
    }

    // 1. 初始化草稿狀態列事件
    initDraftAlertBar();

    // 1.5 初始化全域常駐 LLM 任務狀態機與日誌抽屜
    initAiTaskConsole();

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

    // 7. 📲 檢查是否有從 Android 系統分享 (Web Share Target) 進來的檔案
    handleIncomingSharedFiles();
  });
});

/* --------------------------------------------------------------------------
   0. 全域常駐 LLM 任務狀態機與即時監控台 (Global AI Task State Machine)
   -------------------------------------------------------------------------- */
class AiTaskLogger {
  constructor() {
    this.logs = [];
    this.currentTask = null;
    this.startTime = 0;
  }

  startTask(taskName, details = "") {
    this.startTime = Date.now();
    this.currentTask = { name: taskName, status: "RUNNING", startTime: this.startTime };
    this.updatePill("⚡ 執行中", "running", taskName);
    this.appendLog(`🚀 [開始] ${taskName} ${details ? `(${details})` : ""}`);
  }

  log(step, details = "", status = "running") {
    const elapsed = ((Date.now() - this.startTime) / 1000).toFixed(1);
    this.appendLog(`  • [${elapsed}s] ${step} ${details ? `— ${details}` : ""}`, status);
    if (this.currentTask) {
      this.updatePill(`⚡ ${step} (${elapsed}s)`, "running", this.currentTask.name);
    }
  }

  completeTask(message = "完成") {
    const elapsed = ((Date.now() - this.startTime) / 1000).toFixed(1);
    this.appendLog(`🎉 [完成] ${message} (總耗時: ${elapsed}s)`, "success");
    this.currentTask = null;
    this.updatePill("AI 就緒", "success", "上一個任務已完成");
  }

  failTask(errorMessage = "執行失敗") {
    const elapsed = ((Date.now() - this.startTime) / 1000).toFixed(1);
    this.appendLog(`❌ [失敗] ${errorMessage} (停格於: ${elapsed}s)`, "error");
    this.currentTask = null;
    this.updatePill("AI 異常", "error", errorMessage);
  }

  appendLog(text, level = "info") {
    const timeStr = new Date().toLocaleTimeString("zh-TW", { hour12: false });
    this.logs.unshift({ time: timeStr, text, level });
    if (this.logs.length > 50) this.logs.pop();
    this.renderDrawerLogs();
  }

  updatePill(text, state = "idle", title = "") {
    const pill = document.getElementById("ai-task-status-pill");
    const textEl = document.getElementById("ai-task-status-text");
    const iconEl = document.getElementById("ai-task-status-icon");
    if (!pill || !textEl) return;

    textEl.textContent = text;
    if (title) pill.title = title;

    if (state === "running") {
      pill.style.background = "rgba(245, 158, 11, 0.15)";
      pill.style.color = "#fbbf24";
      pill.style.borderColor = "rgba(245, 158, 11, 0.4)";
      if (iconEl) iconEl.textContent = "⚡";
    } else if (state === "success") {
      pill.style.background = "rgba(16, 185, 129, 0.15)";
      pill.style.color = "#34d399";
      pill.style.borderColor = "rgba(16, 185, 129, 0.4)";
      if (iconEl) iconEl.textContent = "✅";
    } else if (state === "error") {
      pill.style.background = "rgba(239, 68, 68, 0.2)";
      pill.style.color = "#f87171";
      pill.style.borderColor = "rgba(239, 68, 68, 0.5)";
      if (iconEl) iconEl.textContent = "❌";
    } else {
      pill.style.background = "rgba(99, 102, 241, 0.12)";
      pill.style.color = "#818cf8";
      pill.style.borderColor = "rgba(99, 102, 241, 0.35)";
      if (iconEl) iconEl.textContent = "🤖";
    }
  }

  renderDrawerLogs() {
    const container = document.getElementById("ai-log-list");
    if (!container) return;

    if (this.logs.length === 0) {
      container.innerHTML = '<div style="color: var(--text-muted); padding: 12px 0;">目前無任務紀錄。</div>';
      return;
    }

    container.innerHTML = this.logs.map(item => {
      let badgeBg = "rgba(99, 102, 241, 0.15)";
      let badgeColor = "#6366f1";
      let textStyle = "color: var(--text-main);";
      
      if (item.level === "error") {
        badgeBg = "rgba(239, 68, 68, 0.15)";
        badgeColor = "#ef4444";
        textStyle = "color: #dc2626; font-weight: 600;";
      } else if (item.level === "success") {
        badgeBg = "rgba(16, 185, 129, 0.15)";
        badgeColor = "#10b981";
        textStyle = "color: #059669; font-weight: 600;";
      } else if (item.level === "running") {
        badgeBg = "rgba(245, 158, 11, 0.15)";
        badgeColor = "#d97706";
        textStyle = "color: #b45309; font-weight: 500;";
      }

      return `
        <div style="padding: 6px 8px; border-radius: 6px; background: rgba(125,125,125,0.04); margin-bottom: 4px; ${textStyle} display: flex; align-items: flex-start; gap: 8px; font-size: 0.82rem;">
          <span style="background: ${badgeBg}; color: ${badgeColor}; font-size: 0.7rem; padding: 2px 6px; border-radius: 4px; font-weight: 700; white-space: nowrap;">${item.time}</span>
          <span style="flex: 1; word-break: break-all; line-height: 1.4;">${item.text}</span>
        </div>
      `;
    }).join("");
  }
}

window.FL_AI_LOGGER = new AiTaskLogger();

function initAiTaskConsole() {
  const pill = document.getElementById("ai-task-status-pill");
  const drawer = document.getElementById("ai-log-drawer");
  const closeBtn = document.getElementById("ai-log-drawer-close");

  if (pill && drawer) {
    pill.addEventListener("click", () => {
      drawer.style.display = (drawer.style.display === "none" || !drawer.style.display) ? "flex" : "none";
    });
  }

  if (closeBtn && drawer) {
    closeBtn.addEventListener("click", () => {
      drawer.style.display = "none";
    });
  }
}

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
  if (window._isSyncing) return;
  
  const drafts = window.draftStore.drafts;
  const count = window.draftStore.getDraftCount();
  if (count === 0) return;

  const syncBtn = document.getElementById("btn-draft-sync");
  if (syncBtn) syncBtn.disabled = true;

  if (!confirm(`確定將本地 ${count} 筆變更同步上傳至 Google Drive 雲端 Memory_Pool_Raw 數據庫？`)) {
    if (syncBtn) syncBtn.disabled = false;
    return;
  }

  window._isSyncing = true;
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

    // 2. 修改筆數 (fix_raw_log)：以 log_id 主鍵精準鎖定修訂 Memory_Pool_Raw H 欄
    for (const logId of Object.keys(drafts.edited)) {
      const editInfo = drafts.edited[logId];
      const res = await sendGasRequest("fix_raw_log", {
        log_id: logId,
        new_text: editInfo.updateLog
      });
      if (!res || res.status !== "success") {
        throw new Error(res ? res.message : "GAS 修訂流水帳未傳回 success 狀態");
      }
    }

    // 3. 刪除筆數 (delete_record)：人類 UI 授權直接發起 0.8s 物理乾淨抹除 (In-Memory Batch Rewrite)
    for (const logId of drafts.deleted) {
      const res = await sendGasRequest("delete_record", {
        sheet: "Memory_Pool_Raw",
        id: logId
      });
      if (!res || res.status !== "success") {
        throw new Error(res ? res.message : "GAS 刪除流水帳未傳回 success 狀態");
      }
    }

    // 4. 新增專案資源鏈結草稿 (Projects_Attachments)：寫入 Projects_Attachments 頁籤
    if (Array.isArray(drafts.attachmentsAppended)) {
      for (const item of drafts.attachmentsAppended) {
        let cleanLinkId = item.linkId || "";
        if (!cleanLinkId || cleanLinkId.startsWith("LINK-DRAFT-")) {
          const hash4 = (Math.random().toString(36) + "0000").slice(2, 6);
          const tag = (item.projectTag || "General").replace(/\s+/g, "_");
          cleanLinkId = `LINK_${tag}_${hash4}`;
        }
        
        let cleanCreatedAt = item.createdAt || "";
        if (!cleanCreatedAt || cleanCreatedAt.includes("T")) {
          const d = new Date(item.createdAt || Date.now());
          const pad = (n) => String(n).padStart(2, "0");
          cleanCreatedAt = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
        }

        const linkRow = [
          cleanLinkId,
          item.projectTag || "General",
          item.title || "無標題資源",
          item.url || "",
          item.category || "Web Link",
          cleanCreatedAt
        ];

        const res = await sendGasRequest("batch_append_raw", {
          sheet: "Projects_Attachments",
          rows: [linkRow]
        });
        if (!res || res.status !== "success") {
          throw new Error(res ? res.message : "GAS 追加專案資源鏈結未傳回 success 狀態");
        }
      }
    }

    // 4.5 修訂專案資源鏈結草稿 (Projects_Attachments)：追加修訂記錄至 Projects_Attachments 頁籤
    if (drafts.attachmentsEdited && typeof drafts.attachmentsEdited === "object") {
      for (const linkId of Object.keys(drafts.attachmentsEdited)) {
        const editItem = drafts.attachmentsEdited[linkId];
        let pTag = "General";
        liveView.viewRows.forEach((r) => {
          const found = (r.attachments || []).find((a) => a.linkId === linkId);
          if (found) pTag = found.projectTag || r.itemCode || "General";
        });

        const d = new Date();
        const pad = (n) => String(n).padStart(2, "0");
        const cleanCreatedAt = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

        const linkRow = [
          linkId,
          pTag,
          editItem.title || "無標題資源",
          editItem.url || "",
          "Web Link",
          cleanCreatedAt
        ];

        const res = await sendGasRequest("batch_append_raw", {
          sheet: "Projects_Attachments",
          rows: [linkRow]
        });
        if (!res || res.status !== "success") {
          throw new Error(res ? res.message : "GAS 修訂專案資源鏈結未傳回 success 狀態");
        }
      }
    }

    // 4.6 刪除專案資源鏈結草稿 (Projects_Attachments)：人類 UI 授權直接發起 0.8s delete_record 物理抹除
    if (Array.isArray(drafts.attachmentsDeleted) && drafts.attachmentsDeleted.length > 0) {
      for (const linkId of drafts.attachmentsDeleted) {
        const res = await sendGasRequest("delete_record", {
          sheet: "Projects_Attachments",
          id: linkId
        });
        if (!res || res.status !== "success") {
          throw new Error(res ? res.message : "GAS 刪除專案資源鏈結未傳回 success 狀態");
        }
      }
    }

    // 清空本地草稿並 0 閃爍無縫重繪畫面
    window.draftStore.clearDrafts();
    await liveView.fetchViewData(false);
    showToast(`🎉 成功同步 ${count} 筆變更至 Google Drive 雲端數據庫！`, "success");
    renderLiveViewGrid();

    // 如果詳情 Modal 開啟中，同步刷新時間軸
    if (window.currentActiveKpiId) {
      window.openKpiDetailModal(window.currentActiveKpiId);
    }
  } catch (err) {
    showToast(`同步至雲端失敗: ${err.message}`, "danger");
  } finally {
    window._isSyncing = false;
    if (syncBtn) syncBtn.disabled = false;
    liveView.hideFullscreenLoading();
  }
}

function discardLocalDrafts() {
  const count = window.draftStore.getDraftCount();
  if (count === 0) return;

  if (confirm(`確定放棄本地 ${count} 筆未同步的草稿變更？\n此動作將清理本地緩存，還原記憶體中雲端最新資料。`)) {
    window.draftStore.clearDrafts();
    showToast("已放棄本地草稿變更！", "warning");
    // 0ms 純記憶體重新融合，嚴禁發起 HTTP GET 雲端請求
    liveView.reparse();
    renderLiveViewGrid();
    if (window.currentActiveKpiId) {
      window.openKpiDetailModal(window.currentActiveKpiId);
    }
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
        handleFilesBatch(Array.from(e.dataTransfer.files));
      }
    });

    fileInput.addEventListener("change", () => {
      if (fileInput.files && fileInput.files.length > 0) {
        handleFilesBatch(Array.from(fileInput.files));
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
          micBtn.classList.remove("recording");
          timerText.textContent = "00:00";
          const audioFile = await driveUploader.stopRecording();
          
          // 🌟 彈出 4 選 1 語音分流選單 (0 LLM 瞎猜)
          const modalBackdrop = document.getElementById("audio-category-modal-backdrop");
          if (modalBackdrop) {
            modalBackdrop.style.display = "flex";
            window._pendingAudioFile = audioFile;
          } else {
            await handleFileUpload(audioFile);
          }
        } catch (err) {
          showToast(err.message, "danger");
        }
      }
    });
  }

  // 🎙️ 綁定語音 4 選 1 分流彈窗按鈕事件
  const audioCloseBtn = document.getElementById("audio-cat-close-btn");
  if (audioCloseBtn) {
    audioCloseBtn.addEventListener("click", () => {
      const modalBackdrop = document.getElementById("audio-category-modal-backdrop");
      if (modalBackdrop) modalBackdrop.style.display = "none";
      window._pendingAudioFile = null;
    });
  }

  document.querySelectorAll(".audio-cat-btn").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      const catKey = btn.getAttribute("data-cat") || "raw";
      const modalBackdrop = document.getElementById("audio-category-modal-backdrop");
      if (modalBackdrop) modalBackdrop.style.display = "none";

      const file = window._pendingAudioFile;
      window._pendingAudioFile = null;
      if (!file) return;

      const subfolderMap = {
        meeting: "VoiceMemos/Meeting",
        call: "VoiceMemos/Call",
        memo: "VoiceMemos/Memo",
        raw: "VoiceMemos"
      };
      const catLabelMap = {
        meeting: "會議錄音",
        call: "通話記錄",
        memo: "個人速記",
        raw: "待轉寫語音"
      };

      const now = new Date();
      const pad = (n) => String(n).padStart(2, "0");
      const ymd = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
      const hms = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
      const ext = file.name.split('.').pop() || "m4a";
      const customName = `audio_${catKey}_${ymd}_${hms}.${ext}`;
      
      const renamedFile = new File([file], customName, { type: file.type });
      renamedFile.transcript = file.transcript || "";

      showToast(`🎙️ 正在分流至 ${catLabelMap[catKey] || '語音箱'} (0 LLM 直傳)...`, "info");
      await executeDirectCategorizedUpload(renamedFile, `[語音/${catLabelMap[catKey]}]`, "VOICE_MEMOS");
    });
  });

  if (submitNoteBtn && noteTextarea) {
    submitNoteBtn.addEventListener("click", async () => {
      const text = noteTextarea.value.trim();
      if (!text) {
        showToast("請輸入速記內容！", "warning");
        return;
      }

      submitNoteBtn.disabled = true;
      submitNoteBtn.innerHTML = "<span>⚡ AI 智腦提煉中...</span>";
      showToast("⚡ 正在呼叫打工仔大模型中央總帳提煉情報...", "info");
      window.FL_AI_LOGGER.startTask("速記情報提煉", text.slice(0, 30));

      try {
        const projectList = getAvailableProjectsList();
        window.FL_AI_LOGGER.log("呼叫打工仔大模型", "進行 7 大 Invariants 結構化提煉");
        const extracted = await window.openRouterExtractor.extract(text, projectList);

        const now = new Date();
        const pad = (n) => String(n).padStart(2, "0");
        const cleanTimestamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
        const randSuffix = (Math.random().toString(36) + "0000").slice(2, 6);
        const logId = `LOG_TXT_${Date.now()}_${randSuffix}`;

        window.FL_AI_LOGGER.log("持久化存檔", `寫入 Memory_Pool_Raw (${logId})`);

        // 100% 精確對齊 11 欄 RAW_HEADERS (0~10)
        const rawRow = [
          logId,                                            // 0. A log_id
          cleanTimestamp,                                   // 1. B timestamp
          extracted.project_tag || "NEW_UNCLASSIFIED",      // 2. C project_tag
          extracted.entity_target || "未指定客戶 (待編輯)",   // 3. D entity_target
          extracted.target_purpose || "",                   // 4. E target_purpose
          "",                                               // 5. F our_advantages
          extracted.action_taken || "最新跟進紀錄",          // 6. G action_taken
          extracted.update_log || text,                     // 7. H update_log (條理分明繁中)
          extracted.attachment_links || "",                 // 8. I attachment_links
          String(extracted.confidence_score || 0.85),       // 9. J confidence_score
          "PENDING_REVIEW"                                  // 10. K agent_status
        ];

        // ☁️ 持久化寫入雲端 Memory_Pool_Raw
        await sendGasRequest("batch_append_raw", {
          sheet: "Memory_Pool_Raw",
          rows: [rawRow]
        });

        // ⚡ 即時注入前端 HITL 待審核佇列 (0ms 反應)
        const isUrlItem = !!extracted.attachment_links;
        const modelLabel = extracted.params_b ? `${extracted.model_used} (${extracted.params_b}B)` : (extracted.model_used || "OpenRouter");
        const newCard = {
          entry_id: logId,
          log_id: logId,
          timestamp: cleanTimestamp,
          source_type: isUrlItem ? "🔗 雲端資源鏈結" : `🤖 AI 速記 (${modelLabel})`,
          project_tag: extracted.project_tag || "NEW_UNCLASSIFIED",
          entity_target: extracted.entity_target || "未指定客戶 (待編輯)",
          target_purpose: extracted.target_purpose || "",
          action_taken: extracted.action_taken || "最新跟進紀錄",
          update_log: extracted.update_log || text,
          raw_text: text,
          attachment_links: extracted.attachment_links || "",
          confidence_score: String(extracted.confidence_score || 0.85),
          status: "PENDING_REVIEW"
        };

        if (window.hitlReviewer) {
          window.hitlReviewer.pendingCards.unshift(newCard);
          window.hitlReviewer.notify();
        }

        // 更新頂部 HITL 徽章
        const badgeEl = document.getElementById("hitl-badge-count");
        if (badgeEl && window.hitlReviewer) {
          badgeEl.textContent = window.hitlReviewer.pendingCards.length;
        }

        noteTextarea.value = "";
        window.FL_AI_LOGGER.completeTask(`提煉成功，生成待審核卡片 (${modelLabel})`);
        showToast(`🎉 速記提煉完成！已生成待審核卡片 (模型: ${modelLabel})`, "success");
      } catch (err) {
        window.FL_AI_LOGGER.failTask(`速記提煉失敗: ${err.message}`);
        showToast(`速記提煉失敗: ${err.message}`, "danger");
      } finally {
        submitNoteBtn.disabled = false;
        submitNoteBtn.innerHTML = "<span>🚀 傳送至 FollowLoop 門閥</span>";
      }
    });
  }

  /**
   * 🖼️ 前端 Canvas 即時無損感知壓縮（僅供打工仔 Vision 初篩，原圖 100% 原始畫質直傳 Drive）
   * @param {File} file 
   * @param {number} maxSide - 最長邊上限 (預設 800px)
   * @param {number} quality - JPEG 壓縮品質 (預設 0.6)
   * @returns {Promise<string>} 壓縮後極小的 Base64 Data URL (~100KB)
   */
  async function compressImageForLLM(file, maxSide = 800, quality = 0.6) {
    return new Promise((resolve) => {
      // 門檻：若小於 400KB 則不浪費 Canvas 運算
      if (file.size <= 400 * 1024) {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(file);
        return;
      }

      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        let w = img.naturalWidth || img.width;
        let h = img.naturalHeight || img.height;

        // 計算等比縮放
        if (w > maxSide || h > maxSide) {
          if (w > h) {
            h = Math.round((h * maxSide) / w);
            w = maxSide;
          } else {
            w = Math.round((w * maxSide) / h);
            h = maxSide;
          }
        }

        // 防禦：防止長截圖最短邊過小
        w = Math.max(w, 200);
        h = Math.max(h, 200);

        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        // 白色底色避免透明 PNG 轉黑
        ctx.fillStyle = "#FFFFFF";
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);

        const compressedDataUrl = canvas.toDataURL("image/jpeg", quality);
        resolve(compressedDataUrl);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(file);
      };
      img.src = url;
    });
  }

  /**
   * ⚡ 執行純代碼 / 0 LLM 素材分類直傳 Google Drive
   * @param {File} file 
   * @param {string} userNotes 
   * @param {string} categoryKey - VOUCHERS / VOICE_MEMOS / BUSINESS_CARDS / PROJECT_DOCS / UNCLASSIFIED 等
   */
  async function executeDirectCategorizedUpload(file, userNotes = "", categoryKey = "UNCLASSIFIED") {
    progressContainer.classList.add("active");
    progressBarFill.style.width = "0%";
    progressBarFill.style.background = "var(--color-primary)";
    const catConfig = CONFIG.RAW_SCENE_CATEGORIES[categoryKey] || CONFIG.RAW_SCENE_CATEGORIES.UNCLASSIFIED;
    progressText.textContent = `⚡ 正在直傳至 ${catConfig.icon} ${catConfig.folder}: ${file.name}... (0%)`;
    window.FL_AI_LOGGER.startTask(`素材分流直傳 [${catConfig.folder}]`, `${file.name} (${(file.size / 1024).toFixed(1)} KB)`);

    try {
      const driveRes = await driveUploader.uploadFileDirect(file, userNotes, (percent) => {
        progressBarFill.style.width = `${percent}%`;
        progressText.textContent = `直傳 ${catConfig.folder} 中: ${percent}%`;
        window.FL_AI_LOGGER.log("直傳進度", `${percent}%`);
      }, null, categoryKey);

      progressBarFill.style.width = "100%";
      progressText.textContent = `✅ 直傳完成！已安全存入 ${catConfig.folder}/`;
      window.FL_AI_LOGGER.completeTask(`素材已歸入 ${catConfig.folder}/，等待本機 AI 治理`);
      showToast(`🎉 檔案 ${file.name} 已安全存入 ${catConfig.icon} ${catConfig.folder}/！`, "success");
      
      if (noteTextarea) noteTextarea.value = "";
    } catch (err) {
      progressBarFill.style.width = "100%";
      progressBarFill.style.background = "#ef4444";
      progressText.textContent = `❌ 上傳失敗: ${err.message}`;
      window.FL_AI_LOGGER.failTask(`分流直傳失敗: ${err.message}`);
      showToast(`上傳失敗: ${err.message}`, "danger");
    } finally {
      setTimeout(() => {
        progressContainer.classList.remove("active");
      }, 3500);
    }
  }

  /**
   * ⚡ 彈出快捷素材分類與人類覆寫確認彈窗 (1 點即傳 Click-and-Go，零 LLM 耗損)
   */
  function promptQuickCategoryModal(fileOrFiles, defaultCategory = "UNCLASSIFIED", summaryText = "", userNotes = "") {
    return new Promise((resolve) => {
      const modalBackdrop = document.getElementById("quick-category-modal-backdrop");
      const previewInfo = document.getElementById("quick-cat-preview-info");
      const timerLabel = document.getElementById("quick-cat-timer-label");
      const confirmBtn = document.getElementById("quick-cat-confirm-btn");
      const cancelBtn = document.getElementById("quick-cat-cancel-btn");
      const closeBtn = document.getElementById("quick-cat-close-btn");

      const isBatch = Array.isArray(fileOrFiles);
      let selectedCat = defaultCategory;

      if (previewInfo) {
        if (isBatch) {
          const totalSizeKb = fileOrFiles.reduce((acc, f) => acc + f.size, 0) / 1024;
          const namesList = fileOrFiles.map(f => f.name).slice(0, 3).join(", ") + (fileOrFiles.length > 3 ? ` 等 ${fileOrFiles.length} 檔` : '');
          previewInfo.innerHTML = `
            <div style="font-weight:700; color:var(--text-heading); margin-bottom:4px;">📁 批次素材：${fileOrFiles.length} 個檔案 (${totalSizeKb.toFixed(1)} KB)</div>
            <div style="font-size:0.8rem; color:var(--text-muted); word-break:break-all;">清單：<span style="color:#818cf8;">${namesList}</span></div>
            <div style="font-size:0.75rem; color:var(--text-subtle); margin-top:4px;">請指定統一目標箱（點擊選項立刻發起直傳）：</div>
          `;
        } else {
          const file = fileOrFiles;
          const catConfig = CONFIG.RAW_SCENE_CATEGORIES[selectedCat] || CONFIG.RAW_SCENE_CATEGORIES.UNCLASSIFIED;
          previewInfo.innerHTML = `
            <div style="font-weight:700; color:var(--text-heading); margin-bottom:4px;">📄 檔案：${file.name} (${(file.size/1024).toFixed(1)} KB)</div>
            <div style="font-size:0.8rem; color:var(--text-muted);">${summaryText ? `提示：<b style="color:#818cf8;">${summaryText}</b>` : '請點選目標箱直接上傳：'}</div>
            <div style="font-size:0.75rem; color:var(--text-subtle); margin-top:2px;">目標門閥：<b>FollowLoop_RawInputs/</b></div>
          `;
        }
      }

      const cleanup = () => {
        if (modalBackdrop) modalBackdrop.style.display = "none";
      };

      const doConfirm = (cat) => {
        cleanup();
        resolve(cat || selectedCat);
      };

      const doCancel = () => {
        cleanup();
        resolve(null);
      };

      // 🌟 人性化一鍵直選：點擊任何分類選項，立刻確認並發起直傳 (Click & Go)
      document.querySelectorAll(".quick-cat-option").forEach(b => {
        b.onclick = () => {
          const cat = b.getAttribute("data-key");
          doConfirm(cat);
        };
      });

      if (confirmBtn) confirmBtn.onclick = () => doConfirm(selectedCat);
      if (cancelBtn) cancelBtn.onclick = doCancel;
      if (closeBtn) closeBtn.onclick = doCancel;

      if (timerLabel) timerLabel.textContent = "請點選目標箱直接上傳 (1 點即發)：";
      if (modalBackdrop) modalBackdrop.style.display = "flex";
    });
  }

  async function handleFileUpload(file) {
    if (!file) return;

    const userNotes = noteTextarea ? noteTextarea.value : "";
    const isAudio = file.type.startsWith("audio/") || file.name.match(/\.(mp3|m4a|wav|aac|ogg|webm|amr)$/i);

    // 🌟 1. 語音音訊 ➔ 彈出 4 選 1 語音菜單
    if (isAudio) {
      const modalBackdrop = document.getElementById("audio-category-modal-backdrop");
      if (modalBackdrop) {
        modalBackdrop.style.display = "flex";
        window._pendingAudioFile = file;
        return;
      }
    }

    // 🌟 2. 智慧預判預設分類（純副檔名/特徵偵測，0 LLM 消耗）
    let defaultCat = "UNCLASSIFIED";
    let summaryHint = "";
    const isImage = file.type.startsWith("image/");
    const isPdf = file.type === "application/pdf" || file.name.match(/\.pdf$/i);
    const isDocText = file.type.startsWith("text/") || file.name.match(/\.(txt|md|json|csv|log|ini|conf)$/i);
    const isDocument = isPdf || isDocText || file.name.match(/\.(docx|doc|pptx|ppt|xlsx|xls|cad|dwg|zip|rar|7z)$/i);

    if (isDocument) {
      const isLikelyVoucher = file.name.match(/(invoice|receipt|bill|voucher|ticket|flight|hotel|發票|收據|單據|報銷|水單|車票|機票)/i);
      defaultCat = isLikelyVoucher ? "VOUCHERS" : "PROJECT_DOCS";
      summaryHint = isLikelyVoucher ? "偵測為報銷單據/發票文檔" : "偵測為專案/技術文檔";
    } else if (isImage) {
      const isCardName = file.name.match(/(card|namecard|businesscard|名片)/i);
      const isVoucherName = file.name.match(/(invoice|receipt|bill|voucher|ticket|發票|收據|單據|報銷)/i);
      const isChatName = file.name.match(/(chat|wechat|whatsapp|webex|screen|對話|截圖)/i);
      if (isCardName) {
        defaultCat = "BUSINESS_CARDS";
        summaryHint = "檔名特徵包含名片";
      } else if (isVoucherName) {
        defaultCat = "VOUCHERS";
        summaryHint = "檔名特徵包含報銷/發票";
      } else if (isChatName) {
        defaultCat = "CHAT_SCREENSHOTS";
        summaryHint = "檔名特徵包含對話截圖";
      }
    }

    // 🌟 3. 彈出分類確認選單（1 點即發，確保 100% 絕對真理分流）
    let chosenCat = await promptQuickCategoryModal(file, defaultCat, summaryHint, userNotes);
    if (!chosenCat) {
      showToast("已取消上傳", "info");
      return;
    }

    if (chosenCat === "CARDS_SINGLE" || chosenCat === "CARDS_DOUBLE") {
      chosenCat = "BUSINESS_CARDS";
    }

    await executeDirectCategorizedUpload(file, userNotes, chosenCat);
  }

  /**
   * 🖼️ Canvas 本地將 2 張圖片上下無損合併為單一圖片物件 (雙面名片合體神器)
   * @param {File} file1 - 正面圖檔
   * @param {File} file2 - 背面圖檔
   * @returns {Promise<File>} 合併後的 File 物件
   */
  async function mergeTwoImagesVertically(file1, file2) {
    return new Promise((resolve, reject) => {
      const img1 = new Image();
      const img2 = new Image();
      let loadedCount = 0;

      const onLoad = () => {
        loadedCount++;
        if (loadedCount < 2) return;

        // 計算 Canvas 尺寸：寬度取兩者最大，高度相加
        const targetWidth = Math.max(img1.naturalWidth || img1.width, img2.naturalWidth || img2.width);
        // 按比例計算各自高度
        const h1 = ((img1.naturalHeight || img1.height) * (targetWidth / (img1.naturalWidth || img1.width))) || 600;
        const h2 = ((img2.naturalHeight || img2.height) * (targetWidth / (img2.naturalWidth || img2.width))) || 600;
        const padding = 20; // 中間留一條細微分界
        const targetHeight = Math.round(h1 + h2 + padding);

        const canvas = document.createElement("canvas");
        canvas.width = targetWidth;
        canvas.height = targetHeight;
        const ctx = canvas.getContext("2d");

        // 填入乾淨白底
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, targetWidth, targetHeight);

        // 繪製正面 (上方)
        ctx.drawImage(img1, 0, 0, targetWidth, h1);

        // 繪製分隔線
        ctx.fillStyle = "#e2e8f0";
        ctx.fillRect(0, h1 + 8, targetWidth, 4);

        // 繪製背面 (下方)
        ctx.drawImage(img2, 0, h1 + padding, targetWidth, h2);

        canvas.toBlob((blob) => {
          if (!blob) {
            reject(new Error("Canvas 合成名片圖檔失敗"));
            return;
          }
          const now = new Date();
          const pad = (n) => String(n).padStart(2, "0");
          const ymd = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
          const mergedFile = new File([blob], `card_${ymd}_merged.jpg`, { type: "image/jpeg" });
          resolve(mergedFile);
        }, "image/jpeg", 0.92);
      };

      img1.onload = onLoad;
      img2.onload = onLoad;
      img1.onerror = (e) => reject(new Error("讀取第一張名片圖片失敗: " + e));
      img2.onerror = (e) => reject(new Error("讀取第二張名片圖片失敗: " + e));

      img1.src = URL.createObjectURL(file1);
      img2.src = URL.createObjectURL(file2);
    });
  }

  /**
   * 🌟 批次素材分流處理器 (支援名片正反面成對合體與多檔案批次 1 點入箱)
   * @param {Array<File>} files 
   */
  async function handleFilesBatch(files) {
    if (!files || files.length === 0) return;

    // 1. 若只有 1 個檔案，直接走單檔處理流程
    if (files.length === 1) {
      await handleFileUpload(files[0]);
      return;
    }

    const userNotes = noteTextarea ? noteTextarea.value : "";
    const allImages = files.every(f => f.type.startsWith("image/"));

    // 2. 🌟 批次上傳彈窗：一次指定整批檔案的目標箱 (0 LLM 消耗，1 點即傳)
    let defaultCat = "UNCLASSIFIED";
    if (allImages) {
      defaultCat = files.length === 2 ? "CARDS_DOUBLE" : "CARDS_SINGLE";
    }

    const chosenCat = await promptQuickCategoryModal(files, defaultCat, `已選取 ${files.length} 個檔案`, userNotes);
    if (!chosenCat) {
      showToast("已取消批次上傳", "info");
      return;
    }

    // 🪪 情況 A：使用者選擇【🔄 雙面名片 (合拼為1張)】
    if (chosenCat === "CARDS_DOUBLE") {
      if (files.length !== 2) {
        showToast("⚠️ 雙面名片合體僅限選取 2 張圖片 (正面與背面)！", "warning");
        return;
      }
      try {
        showToast("🔄 正在本地將名片正反面上下合成單張高畫質大圖...", "info");
        const mergedCardFile = await mergeTwoImagesVertically(files[0], files[1]);
        showToast("⚡ 合成完畢！開始直傳至 BusinessCards/ 箱...", "info");
        await executeDirectCategorizedUpload(mergedCardFile, `[雙面名片合併] ${userNotes}`.trim(), "BUSINESS_CARDS");
        showToast("🎉 雙面名片已合為單圖並安全存入！", "success");
        return;
      } catch (mergeErr) {
        console.error("[CardMerge] 合成名片失敗:", mergeErr);
        showToast(`名片合成失敗: ${mergeErr.message}，改走個別直傳`, "warning");
      }
    }

    // 🪪 情況 B：使用者選擇【🪪 單面名片 (批次獨立)】
    if (chosenCat === "CARDS_SINGLE") {
      showToast(`🪪 開始將 ${files.length} 張名片作為獨立名片直傳至 BusinessCards/ 箱...`, "info");
      const now = new Date();
      const pad = (n) => String(n).padStart(2, "0");

      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        const ext = f.name.split('.').pop() || "jpg";
        const ymd = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}_${i + 1}`;
        const singleName = `card_${ymd}.${ext}`;
        const renamedFile = new File([f], singleName, { type: f.type });

        await executeDirectCategorizedUpload(renamedFile, userNotes, "BUSINESS_CARDS");
      }
      return;
    }

    // 3. 其餘批次檔案：依選定的目標箱全量直傳
    const finalCat = (chosenCat === "BUSINESS_CARDS") ? "BUSINESS_CARDS" : chosenCat;
    showToast(`⚡ 開始將 ${files.length} 個檔案直傳至 ${finalCat} 箱...`, "info");
    for (let i = 0; i < files.length; i++) {
      await executeDirectCategorizedUpload(files[i], userNotes, finalCat);
    }
  }

  // 🌐 全域安全掛載 handleFileUpload 與 handleFilesBatch
  window.handleFileUpload = handleFileUpload;
  window.handleFilesBatch = handleFilesBatch;
}


/* --------------------------------------------------------------------------
   4. 模組二：HITL 人工審核 (HITL Review Gate)
   -------------------------------------------------------------------------- */
function initHitlModule() {
  const refreshBtn = document.getElementById("hitl-refresh-btn");
  const badgeCount = document.getElementById("hitl-badge-count");
  const subBadgeLogs = document.getElementById("hitl-sub-badge-logs");
  const subBadgeCards = document.getElementById("hitl-sub-badge-cards");
  const subBtnLogs = document.getElementById("hitl-sub-tab-logs");
  const subBtnCards = document.getElementById("hitl-sub-tab-cards");

  // 子頁籤點擊切換事件
  if (subBtnLogs) {
    subBtnLogs.addEventListener("click", () => {
      hitlReviewer.activeSubTab = "business";
      if (subBtnLogs) subBtnLogs.classList.add("active");
      if (subBtnCards) subBtnCards.classList.remove("active");
      renderHitlCards();
    });
  }

  if (subBtnCards) {
    subBtnCards.addEventListener("click", () => {
      hitlReviewer.activeSubTab = "cards";
      if (subBtnCards) subBtnCards.classList.add("active");
      if (subBtnLogs) subBtnLogs.classList.remove("active");
      renderHitlCards();
    });
  }

  hitlReviewer.subscribe((allCards, businessLogs, businessCards) => {
    if (badgeCount) badgeCount.textContent = allCards.length;
    if (subBadgeLogs) subBadgeLogs.textContent = businessLogs.length;
    if (subBadgeCards) subBadgeCards.textContent = businessCards.length;
    renderHitlCards();
  });

  if (refreshBtn) {
    refreshBtn.addEventListener("click", async () => {
      showToast("正在拉取最新待審核卡片...", "info");
      await hitlReviewer.fetchPendingCards();
    });
  }

  hitlReviewer.fetchPendingCards();
}

function calculateNextNewProjectInfo(projectList) {
  let maxId = 0;
  let unclassifiedCount = 0;
  
  projectList.forEach((p) => {
    const match = (p.tag || "").match(/Item_(\d+)/i);
    if (match && match[1]) {
      const num = parseInt(match[1], 10);
      if (num > maxId) maxId = num;
    }
    if ((p.name && p.name.includes("未分類專案")) || (p.acct && p.acct.includes("未指定客戶"))) {
      unclassifiedCount++;
    }
  });

  const nextId = maxId > 0 ? maxId + 1 : 1;
  const nextSeq = unclassifiedCount + 1;
  const nextSeqStr = String(nextSeq).padStart(2, '0');
  const nextTag = `Item_${nextId}_01`;
  const nextProjectName = `未分類專案-${nextSeqStr}`;

  return { nextId, nextSeq, nextSeqStr, nextTag, nextProjectName };
}

function getAvailableProjectsList() {
  const list = [];
  // 1. 優先從 liveView 記憶體讀取
  if (window.liveView && Array.isArray(window.liveView.lastMasterData) && window.liveView.lastMasterData.length > 1) {
    const data = window.liveView.lastMasterData;
    for (let r = 1; r < data.length; r++) {
      const tag = (data[r][0] || "").toString().trim();
      const acct = (data[r][1] || "").toString().trim();
      const name = (data[r][3] || "").toString().trim();
      if (tag) list.push({ tag, name, acct });
    }
  }
  // 2. 備援從 LocalStorage 快照讀取
  if (list.length === 0) {
    try {
      const cached = JSON.parse(localStorage.getItem("FL_DUAL_TABLE_SNAPSHOT") || "{}");
      if (cached && Array.isArray(cached.masterData) && cached.masterData.length > 1) {
        const data = cached.masterData;
        for (let r = 1; r < data.length; r++) {
          const tag = (data[r][0] || "").toString().trim();
          const acct = (data[r][1] || "").toString().trim();
          const name = (data[r][3] || "").toString().trim();
          if (tag) list.push({ tag, name, acct });
        }
      }
    } catch (e) {}
  }
  return list;
}

async function ensureNewProjectMasterCreated(targetTag, projectName) {
  const nowStr = new Date().toISOString();
  const tagParts = targetTag.split("_");
  const accountTag = tagParts.length >= 2 ? `${tagParts[0]}_${tagParts[1]}` : targetTag;

  // 100% 精確對齊 21 欄 MASTER_HEADERS (0~20)
  const newRow = [
    targetTag,                                  // 0. A project_tag
    "未指定客戶 (待編輯)",                        // 1. B account_name
    "待指定窗口",                                // 2. C primary_contact
    projectName,                                // 3. D project_name
    "New Lead",                                 // 4. E stage (待完善)
    "Unclassified",                             // 5. F priority (⚪ 灰色指示燈)
    "",                                         // 6. G annual_quantity
    "",                                         // 7. H annual_revenue
    "USD",                                      // 8. I currency
    "",                                         // 9. J probability
    "新商機情報待完善，請編輯此卡片補充客戶資料",   // 10. K target_purpose
    "",                                         // 11. L our_leverage_point
    "",                                         // 12. M our_advantages
    "",                                         // 13. N lead_source
    "Michael Chen",                             // 14. O owner
    "ACTIVE",                                   // 15. P project_status
    nowStr,                                     // 16. Q created_at
    nowStr,                                     // 17. R updated_at
    "",                                         // 18. S end_customer
    "",                                         // 19. T tier1_partner
    accountTag                                  // 20. U account_tag (自動推導如 Item_34)
  ];

  // ⚡ 0ms 本地記憶體即時注入 (Local-First)
  if (window.liveView) {
    if (!Array.isArray(window.liveView.lastMasterData)) {
      window.liveView.lastMasterData = [["project_tag","account_name","primary_contact","project_name","stage","priority"]];
    }
    window.liveView.lastMasterData.push(newRow);
  }

  // ☁️ 強制 await 持久化至雲端 GAS (防範孤兒流水帳)
  try {
    await sendGasRequest("batch_append_raw", {
      sheet: "Projects_Master",
      rows: [newRow]
    });
  } catch (e) {
    console.warn("建立未分類專案主檔背景警示:", e);
  }
}

function renderHitlCards(cards) {
  const container = document.getElementById("hitl-card-grid");
  if (!container) return;

  // 依當前 activeSubTab 決定展示清單
  const activeTab = hitlReviewer.activeSubTab || "business";
  const displayCards = activeTab === "cards" ? hitlReviewer.pendingBusinessCards : hitlReviewer.pendingBusinessLogs;

  if (!displayCards || displayCards.length === 0) {
    const emptyIcon = activeTab === "cards" ? "🪪" : "✨";
    const emptyTitle = activeTab === "cards" ? "目前沒有尚待審核的名片" : "目前沒有尚待審核的商業情報";
    const emptyDesc = activeTab === "cards" ? "上傳名片或後台打工仔解析完成後，名片會出現在此處供您審核入庫至 Google 通訊錄" : "本機 AI 代理人解析完畢後，卡片會自動出現在此處供您 [是 / 修改 / 否] 審核";

    container.innerHTML = `
      <div style="grid-column: 1/-1; text-align: center; padding: 60px 20px; color: var(--text-subtle); background: var(--bg-card-glass); border-radius: 16px; border: 1px dashed var(--border-card-light);">
        <div style="font-size: 48px; margin-bottom: 12px; filter: drop-shadow(0 4px 10px rgba(99,102,241,0.2));">${emptyIcon}</div>
        <p style="font-size: 1.15rem; font-weight: 700; color: var(--text-heading); margin-bottom: 6px;">${emptyTitle}</p>
        <p style="font-size: 0.88rem; color: var(--text-muted);">${emptyDesc}</p>
      </div>
    `;
    return;
  }

  // 🪪 分支 A：名片專屬審核視圖
  if (activeTab === "cards") {
    container.innerHTML = displayCards.map((card) => {
      const cardId = card.log_id || card.entry_id;
      const atts = card.attachments || [];
      const firstImg = atts.length > 0 ? atts[0] : null;
      const imgUrl = firstImg ? firstImg.url : "";
      const thumbId = firstImg && firstImg.id ? `https://drive.google.com/thumbnail?id=${firstImg.id}&sz=w400` : "";

      return `
      <div class="card-hitl-box" id="card-${cardId}">
        <!-- 頂部標籤 -->
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <div style="display: flex; gap: 8px; align-items: center;">
            <span class="badge-tag" style="background: rgba(99, 102, 241, 0.18); color: var(--primary-light); font-weight: 700;">🪪 名片辨識</span>
            <span class="badge-stage" style="background: rgba(16, 185, 129, 0.15); color: #059669; font-weight: 700;">🎯 信心度 95%</span>
          </div>
          <span style="font-size: 0.76rem; color: var(--text-subtle); font-family: monospace;">${new Date(card.timestamp).toLocaleString()}</span>
        </div>

        <!-- 核心名片預覽 (左圖右文) -->
        <div class="card-preview-container">
          <div class="card-thumb-wrap" onclick="window.openCardPreviewLightbox('${imgUrl || (firstImg ? firstImg.url : '')}')" title="點擊檢視原圖">
            ${thumbId ? `<img src="${thumbId}" class="card-thumb-img" alt="名片原圖" onerror="this.src='img/icons/icon-192.png'">` : `<div style="color:var(--text-muted); font-size:2rem;">🪪</div>`}
            ${imgUrl ? `<span class="card-thumb-badge">🔍 點擊原圖</span>` : ''}
          </div>
          <div class="card-info-col">
            <div class="card-person-name" id="card-name-${cardId}">${card.name || "未知姓名"}</div>
            <div class="card-person-title">${card.title || "商務窗口"}</div>
            <div class="card-person-company" title="${card.company}">${card.company || "未填寫公司"}</div>
          </div>
        </div>

        <!-- 詳細通訊錄欄位預覽 -->
        <div class="card-detail-table">
          <div class="card-detail-row">
            <span class="card-detail-label">📞 電話:</span>
            <span class="card-detail-value" style="font-weight:700; color:#10b981;">${card.phone || "無電話號碼"}</span>
          </div>
          ${card.email ? `
          <div class="card-detail-row">
            <span class="card-detail-label">✉️ Email:</span>
            <span class="card-detail-value">${card.email}</span>
          </div>` : ''}
          ${card.address ? `
          <div class="card-detail-row">
            <span class="card-detail-label">📍 地址:</span>
            <span class="card-detail-value">${card.address}</span>
          </div>` : ''}
          ${card.notes ? `
          <div class="card-detail-row">
            <span class="card-detail-label">📝 備註:</span>
            <span class="card-detail-value">${card.notes}</span>
          </div>` : ''}
        </div>

        <!-- 🔒 通訊錄公私分流開關 (Foxlink 標籤) -->
        <div class="card-foxlink-switch">
          <label style="display:flex; align-items:center; gap:8px; cursor:pointer; font-weight:700; color:var(--text-heading);">
            <input type="checkbox" id="foxlink-tag-check-${cardId}" checked style="width:16px; height:16px; cursor:pointer;">
            <span>🏢 標記為 Foxlink 公務人脈 (自動打標)</span>
          </label>
          <span style="font-size:0.75rem; color:var(--text-muted);">無標籤則為個人</span>
        </div>

        <!-- 底部名片專屬操作按鈕 -->
        <div class="hitl-actions">
          <button class="btn-approve" onclick="onApproveBusinessCard('${cardId}')" style="flex: 1.2; padding: 9px 14px; font-size: 0.88rem; font-weight: 700;">
            ✓ 批准入庫 (Google Contacts)
          </button>
          <button class="btn-edit" onclick="onEditBusinessCardModal('${cardId}')" style="flex: 0.9; padding: 9px 12px; font-size: 0.88rem; font-weight: 600;">
            ✎ 修改資料
          </button>
          <button class="btn-reject" onclick="onRejectCard('${cardId}')" style="padding: 9px 12px; font-size: 0.88rem; font-weight: 600;" title="作廢並物理抹除">
            ✕ 作廢
          </button>
        </div>
      </div>
      `;
    }).join("");
    return;
  }

  // 📜 分支 B：既有商業情報審核視圖
  const projectList = getAvailableProjectsList();
  const nextInfo = calculateNextNewProjectInfo(projectList);

  container.innerHTML = displayCards
    .map((card) => {
      const logId = card.log_id || card.entry_id;
      const currentTag = card.project_tag || "General";
      const isUnclassified = currentTag === "General" || currentTag === "NEW_UNCLASSIFIED" || currentTag.startsWith("Item_New") || !currentTag;
      const confidence = card.confidence_score ? `${Math.round(parseFloat(card.confidence_score) * 100)}%` : "85%";
      const cleanUpdateLog = (card.update_log || card.raw_text || "").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>");
      
      // 動態建立專案下拉選單選項 (首項為帶流水號的新專案卡)
      let optionsHtml = `<option value="NEW_UNCLASSIFIED" ${isUnclassified ? "selected" : ""}>➕ 建立新專案卡 (${nextInfo.nextProjectName})</option>`;
      projectList.forEach((p) => {
        const isSelected = p.tag === currentTag && !isUnclassified;
        const label = `${p.tag} | ${p.acct ? p.acct + " : " : ""}${p.name}`;
        optionsHtml += `<option value="${p.tag}" ${isSelected ? "selected" : ""}>${label}</option>`;
      });

      return `
      <div class="hitl-card" id="card-${logId}">
        <div>
          <!-- 卡片頂部徽章列 -->
          <div class="hitl-card-header">
            <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
              <span class="badge-tag" style="background: rgba(99, 102, 241, 0.18); color: var(--primary-light); font-weight: 700;">${card.source_type || "🎙️ 語音錄音轉寫"}</span>
              <span class="badge-stage" style="background: rgba(16, 185, 129, 0.15); color: #059669; font-weight: 700;">🎯 信心度 ${confidence}</span>
            </div>
            <span style="font-size: 0.76rem; color: var(--text-subtle); font-family: monospace;">${new Date(card.timestamp).toLocaleString()}</span>
          </div>

          <!-- 醒目專案保存目標與即時下拉選單 -->
          <div class="hitl-tag-box ${isUnclassified ? 'unclassified' : ''}">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
              <span style="font-size: 0.82rem; font-weight: 700; color: ${isUnclassified ? '#d97706' : 'var(--primary-light)'};">
                ${isUnclassified ? '⚪ 待完善新商機 (將自動建卡)' : '🎯 擬保存至 CRM 專案'}
              </span>
              <span style="font-size: 0.72rem; color: var(--text-subtle);">可直接切換</span>
            </div>
            <select class="form-control" id="card-tag-select-${logId}" style="width: 100%; font-size: 0.88rem; font-weight: 600; padding: 6px 10px;" onchange="onCardTagChanged('${logId}', this.value)">
              ${optionsHtml}
            </select>
          </div>

          <!-- 情報核心內容 -->
          <div style="display: flex; flex-direction: column; gap: 6px; font-size: 0.88rem;">
            <div class="hitl-meta-row">
              <span class="hitl-meta-label">🏢 權責對象:</span>
              <span class="hitl-meta-value" id="card-entity-val-${logId}">${card.entity_target || "未指定客戶 (待編輯)"}</span>
            </div>

            ${card.target_purpose ? `
            <div class="hitl-meta-row">
              <span class="hitl-meta-label">💡 商機目的:</span>
              <span style="color: var(--text-body);">${card.target_purpose}</span>
            </div>` : ""}

            <div class="hitl-meta-row">
              <span class="hitl-meta-label">🚀 最新行動:</span>
              <span style="color: #059669; font-weight: 600;">${card.action_taken || "最新跟進"}</span>
            </div>

            <!-- 核心商務流水帳 -->
            <div class="hitl-log-box">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                <span style="font-size: 0.78rem; font-weight: 700; color: var(--text-muted);">📝 商業流水帳記要:</span>
                <span style="font-size: 0.72rem; color: var(--text-subtle);">預覽限 4 行</span>
              </div>
              <div style="font-size: 0.86rem; color: var(--text-body); line-height: 1.6; display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden; text-overflow: ellipsis;">${cleanUpdateLog}</div>
            </div>
          </div>
        </div>

        <!-- 底部審核按鈕 -->
        <div class="hitl-actions">
          <button class="btn-approve" onclick="onApproveCard('${logId}')" style="flex: 1.2; padding: 8px 12px; font-size: 0.88rem; font-weight: 700;" title="批准並存入所選專案 (若為新專案將自動建卡)">✓ 是 (Approve)</button>
          <button class="btn-edit" onclick="onEditCardModal('${logId}')" style="flex: 1; padding: 8px 12px; font-size: 0.88rem; font-weight: 600;" title="開啟完整彈窗修訂情報">✎ 修改 (Edit)</button>
          <button class="btn-reject" onclick="onRejectCard('${logId}')" style="padding: 8px 12px; font-size: 0.88rem; font-weight: 600;" title="標記 REJECTED 作廢">✕ 否</button>
        </div>
      </div>
    `;
    })
    .join("");
}

// 卡片下拉選單即時變更事件
window.onCardTagChanged = function(logId, newTag) {
  const card = hitlReviewer.pendingCards.find((c) => (c.log_id === logId || c.entry_id === logId));
  if (card) {
    card.project_tag = newTag;
    const entityEl = document.getElementById(`card-entity-val-${logId}`);
    if (newTag === "NEW_UNCLASSIFIED") {
      card.entity_target = "未指定客戶 (待編輯)";
      if (entityEl) entityEl.textContent = "未指定客戶 (待編輯)";
    } else {
      const projectList = getAvailableProjectsList();
      const matched = projectList.find(p => p.tag === newTag);
      if (matched && matched.acct) {
        card.entity_target = matched.acct;
        if (entityEl) entityEl.textContent = matched.acct;
      }
    }
  }
};

window.onApproveCard = async function (logId) {
  try {
    const card = hitlReviewer.pendingCards.find((c) => (c.log_id === logId || c.entry_id === logId));
    const selectEl = document.getElementById(`card-tag-select-${logId}`);
    let selectedTag = selectEl ? selectEl.value : (card ? card.project_tag : "NEW_UNCLASSIFIED");

    const projectList = getAvailableProjectsList();
    const nextInfo = calculateNextNewProjectInfo(projectList);

    // ➕ 若選中了建立新專案卡 (未分類專案-XX)
    if (selectedTag === "NEW_UNCLASSIFIED" || selectedTag === "General" || !selectedTag) {
      selectedTag = nextInfo.nextTag;
      showToast(`正在為新商機自動建立專案主檔 [${nextInfo.nextProjectName}]...`, "info");
      await ensureNewProjectMasterCreated(selectedTag, nextInfo.nextProjectName);
      if (card) card.entity_target = "未指定客戶 (待編輯)";
    } else {
      showToast(`正在批准入庫至 [${selectedTag}]...`, "info");
    }

    if (card) card.project_tag = selectedTag;

    const updatedFields = {
      project_tag: selectedTag,
      entity_target: card ? card.entity_target : "未指定客戶 (待編輯)",
      target_purpose: card ? card.target_purpose : "",
      action_taken: card ? card.action_taken : "",
      update_log: card ? (card.update_log || card.raw_text) : ""
    };

    const res = await hitlReviewer.editAndApproveCard(logId, updatedFields);
    showToast(res.message, "success");

    // 📎 若卡片自帶 Drive 附件鏈結，自動寫入 Projects_Attachments 頁籤
    if (card && card.attachment_links) {
      try {
        const links = typeof card.attachment_links === "string" ? JSON.parse(card.attachment_links) : card.attachment_links;
        if (Array.isArray(links) && links.length > 0 && links[0].url) {
          const nowStr = new Date().toISOString().replace("T", " ").slice(0, 19);
          const randSuffix = (Math.random().toString(36) + "0000").slice(2, 6);
          const attRow = [
            `ATT_${Date.now()}_${randSuffix}`,
            selectedTag,
            links[0].title || "來源附件",
            links[0].category || "Google Drive",
            links[0].url,
            nowStr,
            "Michael Chen"
          ];
          sendGasRequest("batch_append_raw", {
            sheet: "Projects_Attachments",
            rows: [attRow]
          }).catch(e => console.warn("[Projects_Attachments] 自動登記失敗: ", e.message));
        }
      } catch (e) {
        console.warn("[Projects_Attachments] 解析附件鏈結異常: ", e.message);
      }
    }

    // ⚡ 即建即選連動：重新計算並刷新其餘卡片的下拉選單
    renderHitlCards(hitlReviewer.pendingCards);

    // 自動背景靜默刷新雙表看板
    if (window.liveView) {
      window.liveView.fetchViewData(false).catch(() => {});
    }
  } catch (err) {
    showToast(`批准失敗: ${err.message}`, "danger");
  }
};

window.onEditCardModal = function (logId) {
  const card = hitlReviewer.pendingCards.find((c) => (c.log_id === logId || c.entry_id === logId));
  if (!card) return;

  const targetId = card.log_id || card.entry_id;
  const projectList = getAvailableProjectsList();
  const nextInfo = calculateNextNewProjectInfo(projectList);
  const tagSelect = document.getElementById("modal-hitl-tag");
  const currentTag = card.project_tag || "NEW_UNCLASSIFIED";
  const isUnclassified = currentTag === "General" || currentTag === "NEW_UNCLASSIFIED" || currentTag.startsWith("Item_New") || !currentTag;

  if (tagSelect) {
    let optionsHtml = `<option value="NEW_UNCLASSIFIED" ${isUnclassified ? "selected" : ""}>➕ 建立新專案卡 (${nextInfo.nextProjectName})</option>`;
    projectList.forEach((p) => {
      const isSelected = p.tag === currentTag && !isUnclassified;
      optionsHtml += `<option value="${p.tag}" ${isSelected ? "selected" : ""}>${p.tag} | ${p.acct ? p.acct + " : " : ""}${p.name}</option>`;
    });
    tagSelect.innerHTML = optionsHtml;

    tagSelect.onchange = function() {
      if (this.value === "NEW_UNCLASSIFIED") {
        document.getElementById("modal-hitl-entity").value = "未指定客戶 (待編輯)";
      } else {
        const matched = projectList.find(p => p.tag === this.value);
        if (matched && matched.acct) {
          document.getElementById("modal-hitl-entity").value = matched.acct;
        }
      }
    };
  }

  document.getElementById("modal-hitl-id").value = targetId;
  document.getElementById("modal-hitl-entity").value = card.entity_target || "";
  document.getElementById("modal-hitl-purpose").value = card.target_purpose || "";
  document.getElementById("modal-hitl-action").value = card.action_taken || "";
  document.getElementById("modal-hitl-log").value = card.update_log || card.raw_text || "";

  // 📎 附件自主歸檔預填 (預設不勾選，防附件暴增)
  const attachCheck = document.getElementById("modal-hitl-attach-check");
  const attachBox = document.getElementById("modal-hitl-attach-box");
  const attTitleInput = document.getElementById("modal-hitl-att-title");
  const attUrlInput = document.getElementById("modal-hitl-att-url");

  if (attachCheck && attachBox) {
    attachCheck.checked = false;
    attachBox.style.display = "none";

    let defaultTitle = `${new Date().toLocaleDateString()} 來源附件`;
    let defaultUrl = "";
    let hasUrl = false;

    // 嘗試從 card 元數據或 attachment_links 解析真實 URL
    if (card.attachment_links) {
      try {
        const links = typeof card.attachment_links === "string" ? JSON.parse(card.attachment_links) : card.attachment_links;
        if (Array.isArray(links) && links.length > 0) {
          defaultTitle = links[0].title || defaultTitle;
          defaultUrl = links[0].url || "";
          if (defaultUrl) hasUrl = true;
        }
      } catch (e) {}
    }

    if (attTitleInput) attTitleInput.value = defaultTitle;
    if (attUrlInput) {
      attUrlInput.value = defaultUrl;
      attUrlInput.placeholder = "貼上 Google Drive 或雲端檔案分享鏈結";
    }

    if (hasUrl) {
      attachCheck.checked = true;
      attachBox.style.display = "block";
    }
  }

  const backdrop = document.getElementById("edit-hitl-modal-backdrop");
  if (backdrop) {
    backdrop.style.display = "flex";
  }
};

window.closeEditModal = function () {
  const backdrop = document.getElementById("edit-hitl-modal-backdrop");
  if (backdrop) {
    backdrop.style.display = "none";
  }
};

window.submitEditCard = async function () {
  const logId = document.getElementById("modal-hitl-id").value;
  let projectTag = document.getElementById("modal-hitl-tag").value.trim();
  let entityTarget = document.getElementById("modal-hitl-entity").value.trim();

  // 立即關閉彈窗防連點
  closeEditModal();

  const projectList = getAvailableProjectsList();
  const nextInfo = calculateNextNewProjectInfo(projectList);

  // ➕ 若選中了建立新專案卡 (未分類專案-XX)
  if (projectTag === "NEW_UNCLASSIFIED" || projectTag === "General" || !projectTag) {
    projectTag = nextInfo.nextTag;
    showToast(`正在為新商機自動建立專案主檔 [${nextInfo.nextProjectName}]...`, "info");
    await ensureNewProjectMasterCreated(projectTag, nextInfo.nextProjectName);
    if (!entityTarget || entityTarget === "未指定單位/窗口") {
      entityTarget = "未指定客戶 (待編輯)";
    }
  }

  const updatedFields = {
    project_tag: projectTag,
    entity_target: entityTarget,
    target_purpose: document.getElementById("modal-hitl-purpose").value.trim(),
    action_taken: document.getElementById("modal-hitl-action").value.trim(),
    update_log: document.getElementById("modal-hitl-log").value.trim()
  };

  const attachCheck = document.getElementById("modal-hitl-attach-check");
  const attTitle = document.getElementById("modal-hitl-att-title") ? document.getElementById("modal-hitl-att-title").value.trim() : "";
  const attUrl = document.getElementById("modal-hitl-att-url") ? document.getElementById("modal-hitl-att-url").value.trim() : "";

  try {
    showToast("正在修訂並批准日誌...", "info");
    const res = await hitlReviewer.editAndApproveCard(logId, updatedFields);

    // 📎 若使用者主動勾選了附件歸檔
    if (attachCheck && attachCheck.checked) {
      if (attUrl) {
        let attCategory = "Google Drive";
        const lowerUrl = attUrl.toLowerCase();
        if (lowerUrl.includes("spreadsheets")) attCategory = "Google Sheets";
        else if (lowerUrl.includes("document")) attCategory = "Google Docs";
        else if (lowerUrl.includes("github.com")) attCategory = "GitHub";
        else if (!lowerUrl.includes("drive.google.com")) attCategory = "Web Link";

        const randSuffix = (Math.random().toString(36) + "0000").slice(2, 6);
        const cleanTag = (projectTag || "General").replace(/\s+/g, "_");
        const linkId = `LINK_${cleanTag}_${Date.now()}_${randSuffix}`;
        const linkRow = [
          linkId,
          projectTag || "General",
          attTitle || "專案附件資源",
          attUrl,
          attCategory,
          new Date().toISOString()
        ];

        await sendGasRequest("batch_append_raw", {
          sheet: "Projects_Attachments",
          rows: [linkRow]
        }).catch(e => console.warn("附件登記背景警示:", e));
        showToast(`📎 附件已同步歸檔至專案附件庫 [${attCategory}]！`, "success");
      }
    }

    // ⚡ 即建即選連動：重新計算並刷新其餘卡片的下拉選單
    renderHitlCards(hitlReviewer.pendingCards);

    // ⚡ 0ms 本地記憶體寫透 (Local Write-Through)：立刻同步 Master、Raw、Attachments
    if (window.liveView) {
      if (!Array.isArray(window.liveView.lastRawData)) {
        window.liveView.lastRawData = [["log_id","timestamp","project_tag","entity_target","target_purpose","our_advantages","action_taken","update_log","attachment_links","confidence_score","agent_status"]];
      }
      
      const existingRawIdx = window.liveView.lastRawData.findIndex(r => r[0] === logId);
      const rawRow = [
        logId,
        new Date().toISOString(),
        projectTag,
        entityTarget,
        updatedFields.target_purpose || "",
        "",
        updatedFields.action_taken || "最新跟進",
        updatedFields.update_log || "",
        "",
        "0.95",
        "APPROVED"
      ];
      
      if (existingRawIdx > 0) {
        window.liveView.lastRawData[existingRawIdx] = rawRow;
      } else {
        window.liveView.lastRawData.push(rawRow);
      }

      if (attachCheck && attachCheck.checked && attUrl) {
        if (!Array.isArray(window.liveView.lastAttachmentsData)) {
          window.liveView.lastAttachmentsData = [["link_id","project_tag","title","url","category","created_at"]];
        }
        window.liveView.lastAttachmentsData.push([
          `LINK_${projectTag}_${Date.now()}`,
          projectTag,
          attTitle || "專案附件資源",
          attUrl,
          "Google Drive",
          new Date().toISOString()
        ]);
      }

      // 0ms 重新計算並渲染看板
      window.liveView.viewRows = window.liveView.parseDualTableData(
        window.liveView.lastRawData,
        window.liveView.lastMasterData,
        window.liveView.lastAttachmentsData
      );
      window.liveView.applyFilter();
      window.liveView.saveLocalCache();
      if (typeof window.renderLiveViewGrid === "function") {
        window.renderLiveViewGrid();
      }
    }

    closeEditModal();
    showToast(res.message, "success");
  } catch (err) {
    showToast(`修改保存失敗: ${err.message}`, "danger");
  }
};

window.onRejectCard = async function (logId) {
  if (confirm("確定將此卡片標記為 [否 (Reject)] 廢棄？")) {
    try {
      showToast("正在標記作廢...", "info");
      const res = await hitlReviewer.rejectCard(logId);
      showToast(res.message, "warning");
    } catch (err) {
      showToast(`標記失敗: ${err.message}`, "danger");
    }
  }
};

/* ==========================================================================
   🪪 名片專屬 HITL 前端交互 (Business Card HITL Interactions)
   ========================================================================== */

// 1. 批准入庫 (點擊「✓ 批准入庫」)
window.onApproveBusinessCard = async function(cardId) {
  const checkEl = document.getElementById(`foxlink-tag-check-${cardId}`);
  const isFoxlink = checkEl ? checkEl.checked : true;

  try {
    showToast(`正在將名片入庫至 Google 通訊錄${isFoxlink ? ' (Foxlink 公務人脈)' : ''}...`, "info");
    const res = await hitlReviewer.approveBusinessCard(cardId, null, isFoxlink);
    showToast(res.message, "success");
  } catch (err) {
    console.error("[HITL] 名片批准失敗:", err);
    showToast(`名片入庫失敗: ${err.message}`, "danger");
  }
};

// 2. 開啟名片編輯 Modal
window.onEditBusinessCardModal = function(cardId) {
  const card = hitlReviewer.pendingCards.find(c => c.log_id === cardId || c.entry_id === cardId);
  if (!card) return;

  const backdrop = document.getElementById("edit-card-modal-backdrop");
  if (!backdrop) return;

  document.getElementById("modal-card-id").value = cardId;
  document.getElementById("modal-card-name").value = card.name || "";
  document.getElementById("modal-card-company").value = card.company || "";
  document.getElementById("modal-card-title").value = card.title || "";
  document.getElementById("modal-card-phone").value = card.phone || "";
  document.getElementById("modal-card-email").value = card.email || "";
  document.getElementById("modal-card-address").value = card.address || "";
  document.getElementById("modal-card-notes").value = card.notes || "";

  backdrop.style.display = "flex";
};

window.closeEditCardModal = function() {
  const backdrop = document.getElementById("edit-card-modal-backdrop");
  if (backdrop) backdrop.style.display = "none";
};

// 3. 提交名片編輯 (更新待審卡片並可直接入庫)
window.submitEditBusinessCard = async function(andApprove = false) {
  const cardId = document.getElementById("modal-card-id").value;
  const updatedData = {
    name: document.getElementById("modal-card-name").value.trim(),
    company: document.getElementById("modal-card-company").value.trim(),
    title: document.getElementById("modal-card-title").value.trim(),
    phone: document.getElementById("modal-card-phone").value.trim(),
    email: document.getElementById("modal-card-email").value.trim(),
    address: document.getElementById("modal-card-address").value.trim(),
    notes: document.getElementById("modal-card-notes").value.trim()
  };

  if (!updatedData.name) {
    showToast("請輸入姓名！", "warning");
    return;
  }

  try {
    if (andApprove) {
      showToast("正在儲存修訂並入庫 Google 通訊錄...", "info");
      const res = await hitlReviewer.approveBusinessCard(cardId, updatedData, true);
      closeEditCardModal();
      showToast(res.message, "success");
    } else {
      showToast("正在更新名片待審資訊...", "info");
      const res = await hitlReviewer.updateBusinessCard(cardId, updatedData);
      closeEditCardModal();
      showToast(res.message, "success");
    }
  } catch (err) {
    showToast(`操作失敗: ${err.message}`, "danger");
  }
};

// 4. 原圖檢視燈箱 (支援 Google Drive 縮圖代理高清防破圖)
window.openCardPreviewLightbox = function(url) {
  if (!url) return;
  const lb = document.getElementById("card-lightbox-backdrop");
  const img = document.getElementById("card-lightbox-img");
  const link = document.getElementById("card-lightbox-link");
  if (lb && img) {
    // 提取 Google Drive File ID 並轉為高清縮圖代理網址 (解決 Google X-Frame-Options 跨域黑屏問題)
    const fileIdMatch = url.match(/[-\w]{25,}/);
    if (fileIdMatch) {
      const fileId = fileIdMatch[0];
      img.src = `https://drive.google.com/thumbnail?sz=w1200&id=${fileId}`;
    } else {
      img.src = url;
    }
    if (link) link.href = url;
    lb.style.display = "flex";
  } else {
    window.open(url, "_blank");
  }
};

window.closeCardLightbox = function() {
  const lb = document.getElementById("card-lightbox-backdrop");
  if (lb) lb.style.display = "none";
};


/* --------------------------------------------------------------------------
   5. 模組三：💎 專案看板 (Live View Dashboard)
   -------------------------------------------------------------------------- */
function initLiveViewModule() {
  const searchInput = document.getElementById("kpi-search-input");
  const filterSelect = document.getElementById("kpi-filter-select");
  const refreshBtn = document.getElementById("liveview-refresh-btn");

  // 1. 本地硬碟持久化記憶：還原上次選擇的過濾偏好 (如全部、高優先權等)
  const savedFilter = localStorage.getItem("FL_FILTER_PREFERENCE") || "ALL";
  if (filterSelect) {
    filterSelect.value = savedFilter;
  }
  liveView.selectedCategory = savedFilter;

  if (searchInput) {
    searchInput.addEventListener("input", (e) => {
      liveView.applyFilter(e.target.value, filterSelect ? filterSelect.value : "ALL");
      renderLiveViewGrid();
    });
  }

  if (filterSelect) {
    filterSelect.addEventListener("change", (e) => {
      const selectedVal = e.target.value;
      localStorage.setItem("FL_FILTER_PREFERENCE", selectedVal);
      liveView.applyFilter(searchInput ? searchInput.value : "", selectedVal);
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

      // 專案等級發光燈號與 tooltip 提示 (未分類/待完善顯示 ⚪ 灰色指示燈)
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

      // 拆分「客戶名稱」與「專案標題」（100% 不使用 🏢 圖態）
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
        <!-- 頂部工具列：燈號 + 公司名稱膠囊 (無 🏢 圖態) + 階段 Badge -->
        <div class="kpi-header-row">
          <span class="priority-dot ${priorityClass}" title="專案等級：${priorityTitle}">${priorityIcon}</span>
          <span class="kpi-account-tag" title="${accountLabel}">${accountLabel}</span>
          ${stageHtml}
          <div class="kpi-card-actions">
            <button class="btn-card-action btn-card-edit" title="編輯專案主檔" onclick="event.stopPropagation(); if(window.projectManager) window.projectManager.openEditModal('${item.itemCode}')">✏️</button>
            <button class="btn-card-action btn-card-delete" title="刪除專案主檔" onclick="event.stopPropagation(); if(window.projectManager) window.projectManager.deleteProject('${item.itemCode}', '${accountLabel.replace(/'/g, "\\'")}', '${projectTitle.replace(/'/g, "\\'")}')">🗑️</button>
          </div>
        </div>
        
        <!-- 核心專案標題 (固定 2 行空間) -->
        <div class="kpi-project-title">${projectTitle}</div>

        <!-- 最新一條動態區塊 (固定 4 行內文空間) -->
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
   6. Modal 專案詳情與 21 欄 CRM 雙欄板 (Timeline Spine & Inline Edit CRUD)
   -------------------------------------------------------------------------- */
window.editingTimelineLogId = null;

window.openKpiDetailModal = function (kpiId) {
  window.currentActiveKpiId = kpiId;
  const item = liveView.viewRows.find((r) => r.id === kpiId);
  if (!item) return;
  window.currentActiveKpiItemCode = item.itemCode;

  // 1. 標題與 Tag
  const titleEl = document.getElementById("detail-entity-title");
  if (titleEl) {
    const pName = item.projectName ? `- ${item.projectName}` : "";
    titleEl.textContent = `🏢 ${item.accountName || item.itemCode} ${pName}`;
  }

  const subTagEl = document.getElementById("detail-project-tag-sub");
  if (subTagEl) subTagEl.textContent = `Project Tag: ${item.itemCode}`;

  const accTagEl = document.getElementById("detail-account-tag-badge");
  if (accTagEl) accTagEl.textContent = `Account Tag: ${item.accountTag || item.itemCode.split('_')[0]}`;

  const stageEl = document.getElementById("detail-stage-badge");
  if (stageEl) stageEl.textContent = item.stage || "RFQ";

  // 2. 優先權 Badge (🟢 / 🟠 / 🔴)
  const prioBadgeEl = document.getElementById("detail-priority-badge");
  if (prioBadgeEl) {
    prioBadgeEl.className = "priority-badge";
    if (item.priority === "HIGH") {
      prioBadgeEl.classList.add("prio-high");
      prioBadgeEl.textContent = "🟢 高優先權";
    } else if (item.priority === "LOW") {
      prioBadgeEl.classList.add("prio-low");
      prioBadgeEl.textContent = "🟠 低優先權";
    } else if (item.priority === "PAUSED") {
      prioBadgeEl.classList.add("prio-paused");
      prioBadgeEl.textContent = "🔴 暫停行動";
    } else {
      prioBadgeEl.textContent = item.priority || "🟢 高優先權";
    }
  }

  // 3. 財務指標 Badges
  const revEl = document.getElementById("detail-revenue-val");
  if (revEl) revEl.textContent = item.annualRevenue ? `${item.annualRevenue} ${item.currency || 'USD'}` : "-";

  const probEl = document.getElementById("detail-probability-val");
  if (probEl) probEl.textContent = item.probability || "-";

  const qtyEl = document.getElementById("detail-quantity-val");
  if (qtyEl) qtyEl.textContent = item.annualQuantity || "-";

  // 4. 價值主張與訴求
  const tpEl = document.getElementById("detail-target-purpose-val");
  if (tpEl) tpEl.textContent = item.targetPurpose || "無特定說明";

  const levEl = document.getElementById("detail-leverage-val");
  if (levEl) levEl.textContent = item.ourLeveragePoint || "無特定說明";

  const advEl = document.getElementById("detail-advantages-val");
  if (advEl) advEl.textContent = item.ourAdvantages || "無特定說明";

  // 5. 屬性 2 欄 Grid
  const pcEl = document.getElementById("detail-primary-contact-val");
  if (pcEl) pcEl.textContent = item.primaryContact || "-";

  const ownerEl = document.getElementById("detail-owner-val");
  if (ownerEl) ownerEl.textContent = item.owner || "-";

  const ecEl = document.getElementById("detail-end-customer-val");
  if (ecEl) ecEl.textContent = item.endCustomer || "-";

  const t1El = document.getElementById("detail-tier1-partner-val");
  if (t1El) t1El.textContent = item.tier1Partner || "-";

  const lsEl = document.getElementById("detail-lead-source-val");
  if (lsEl) lsEl.textContent = item.leadSource || "-";

  const stEl = document.getElementById("detail-status-val");
  if (stEl) stEl.textContent = item.projectStatus || "ACTIVE";

  // 6. 綁定「➕ 新增」時間軸動態按鈕事件 (0ms 本地快取 ✕ 背景自動同步)
  const addBtn = document.getElementById("btn-add-timeline-log");
  const addInput = document.getElementById("new-timeline-input");

  if (addBtn && addInput) {
    const newBtn = addBtn.cloneNode(true);
    addBtn.parentNode.replaceChild(newBtn, addBtn);

    newBtn.addEventListener("click", () => {
      const text = addInput.value.trim();
      if (!text) {
        showToast("請輸入動態內文！", "warning");
        return;
      }

      const logId = `LOG_${Date.now()}`;
      const nowIso = new Date().toISOString();
      const newRawRow = [
        logId,                                   // 0. log_id
        nowIso,                                  // 1. timestamp
        item.itemCode || "General",              // 2. project_tag
        item.accountName || item.entity || "",   // 3. entity_target
        item.targetPurpose || "",                // 4. target_purpose
        item.ourAdvantages || "",                // 5. our_advantages
        "日常商務跟進",                           // 6. action_taken
        text,                                    // 7. update_log
        "",                                      // 8. attachment_links
        0.95,                                    // 9. confidence_score
        "APPROVED",                              // 10. agent_status
        item.priority || "HIGH"                  // 11. priority
      ];

      if (!Array.isArray(window.liveView.lastRawData)) {
        window.liveView.lastRawData = [];
      }
      window.liveView.lastRawData.push(newRawRow);

      if (typeof window.liveView.saveLocalCache === "function") {
        window.liveView.saveLocalCache();
      }

      addInput.value = "";
      liveView.reparse();
      renderLiveViewGrid();
      const updatedItem = liveView.viewRows.find((r) => r.id === item.id);
      if (updatedItem) renderTimelineSpine(updatedItem);

      if (typeof window.setCloudStatus === "function") {
        window.setCloudStatus("syncing");
      }

      (async () => {
        try {
          await sendGasRequest("batch_append_raw", {
            sheet: "Memory_Pool_Raw",
            rows: [newRawRow]
          });
          if (typeof window.setCloudStatus === "function") {
            window.setCloudStatus("synced");
          }
        } catch (err) {
          console.error("[AutoSync] 時間軸同步失敗:", err);
          if (typeof window.setCloudStatus === "function") {
            window.setCloudStatus("offline");
          }
        }
      })();
    });
  }

  // 6.5 綁定「➕ 新增」專案資源鏈結按鈕事件 (0ms 本地快取 ✕ 背景自動同步)
  const addLinkBtn = document.getElementById("btn-add-attachment-link");
  const addTitleInput = document.getElementById("new-link-title-input");
  const addUrlInput = document.getElementById("new-link-url-input");

  if (addLinkBtn && addTitleInput && addUrlInput) {
    const newLinkBtn = addLinkBtn.cloneNode(true);
    addLinkBtn.parentNode.replaceChild(newLinkBtn, addLinkBtn);

    newLinkBtn.addEventListener("click", () => {
      const title = addTitleInput.value.trim();
      const url = addUrlInput.value.trim();
      if (!title || !url) {
        showToast("請輸入資源名稱與完整網址！", "warning");
        return;
      }

      const linkId = `ATT_${Date.now()}`;
      const d = new Date();
      const pad = (n) => String(n).padStart(2, "0");
      const cleanCreatedAt = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

      const linkRow = [
        linkId,
        item.itemCode || "General",
        title,
        url,
        "Web Link",
        cleanCreatedAt
      ];

      if (!Array.isArray(window.liveView.lastAttachmentsData)) {
        window.liveView.lastAttachmentsData = [];
      }
      window.liveView.lastAttachmentsData.push(linkRow);

      if (typeof window.liveView.saveLocalCache === "function") {
        window.liveView.saveLocalCache();
      }

      addTitleInput.value = "";
      addUrlInput.value = "";
      liveView.reparse();
      renderLiveViewGrid();

      const updatedItem = liveView.viewRows.find((r) => r.id === item.id);
      if (updatedItem) renderProjectAttachments(updatedItem);

      if (typeof window.setCloudStatus === "function") {
        window.setCloudStatus("syncing");
      }

      (async () => {
        try {
          await sendGasRequest("batch_append_raw", {
            sheet: "Projects_Attachments",
            rows: [linkRow]
          });
          if (typeof window.setCloudStatus === "function") {
            window.setCloudStatus("synced");
          }
        } catch (err) {
          console.error("[AutoSync] 專案資源同步失敗:", err);
          if (typeof window.setCloudStatus === "function") {
            window.setCloudStatus("offline");
          }
        }
      })();
    });
  }

  // 7. 預設切換至右欄『動態歷程時間軸』頁籤並渲染兩大面板 (手機版預設為 info 專案資料)
  window.switchRightColTab('timeline');
  if (typeof window.switchMobileDetailTab === "function") {
    window.switchMobileDetailTab('info');
  }
  renderTimelineSpine(item, window.editingTimelineLogId);
  renderProjectAttachments(item);

  const backdropEl = document.getElementById("detail-modal-backdrop");
  if (backdropEl) backdropEl.classList.add("active");
};

function renderTimelineSpine(item, activeEditLogId = null) {
  const spineContainer = document.getElementById("detail-timeline-spine");
  if (!spineContainer) return;

  const logs = item.rawLogs || [];
  if (logs.length === 0) {
    spineContainer.innerHTML = `<div style="text-align: center; color: var(--text-subtle); padding: 20px;">尚無歷史動態紀錄</div>`;
    return;
  }

  const formatJustDate = (ts) => {
    if (!ts) return "歷史紀錄";
    if (typeof ts === "string") {
      const cleanStr = ts.split("T")[0].replace(/-/g, "/");
      if (/^\d{4}\/\d{1,2}\/\d{1,2}$/.test(cleanStr)) {
        return cleanStr;
      }
    }
    try {
      const d = new Date(ts);
      if (!isNaN(d.getTime())) {
        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        return `${yyyy}/${mm}/${dd}`;
      }
    } catch (e) {}
    return String(ts).split("T")[0];
  };

  const getLogDisplayDate = (log) => {
    if (!log) return "歷史紀錄";
    const text = typeof log.updateLog === "string" ? log.updateLog : "";
    const match = text.match(/^\s*(\d{4}[-/.]\d{1,2}[-/.]\d{1,2})/);
    if (match && match[1]) {
      return match[1].replace(/-/g, "/").replace(/\./g, "/");
    }
    return formatJustDate(log.timestamp);
  };

  const getLogSortTime = (log) => {
    if (!log) return 0;
    const text = typeof log.updateLog === "string" ? log.updateLog : "";
    const match = text.match(/^\s*(\d{4}[-/.]\d{1,2}[-/.]\d{1,2})/);
    if (match && match[1]) {
      const normalizedStr = match[1].replace(/\./g, "-").replace(/\//g, "-");
      const d = new Date(normalizedStr);
      if (!isNaN(d.getTime())) return d.getTime();
    }
    if (log.timestamp) {
      const d2 = new Date(log.timestamp);
      if (!isNaN(d2.getTime())) return d2.getTime();
    }
    return 0;
  };

  const stripLeadingDate = (text) => {
    if (!text) return "";
    const clean = text.replace(/^\s*\d{4}[-/.]\d{1,2}[-/.]\d{1,2}\s*[:\-—]?\s*/, "");
    return clean.trim() ? clean : text;
  };

  const sortedLogs = [...logs].sort((a, b) => {
    const timeA = getLogSortTime(a);
    const timeB = getLogSortTime(b);
    if (timeB !== timeA) {
      return timeB - timeA;
    }
    const tsA = a.timestamp ? new Date(a.timestamp).getTime() : 0;
    const tsB = b.timestamp ? new Date(b.timestamp).getTime() : 0;
    return (isNaN(tsB) ? 0 : tsB) - (isNaN(tsA) ? 0 : tsA);
  });

  spineContainer.innerHTML = sortedLogs
    .map((log) => {
      const isDraftClass = log.isDraft ? "is-draft" : "";
      const isDraftBadge = log.isDraft
        ? `<span style="background: #f59e0b; color: #0f172a; padding: 1px 6px; border-radius: 4px; font-weight: 800; font-size: 0.72rem;">本地新草稿</span>`
        : log.isDraftEdit
        ? `<span style="background: #60a5fa; color: #0f172a; padding: 1px 6px; border-radius: 4px; font-weight: 800; font-size: 0.72rem;">本地已編修</span>`
        : "";

      const timeStr = getLogDisplayDate(log);
      const isInlineEditing = (activeEditLogId === log.logId);

      if (isInlineEditing) {
        return `
          <div class="timeline-item-card ${isDraftClass}">
            <div class="timeline-content" style="width: 100%;">
              <div class="timeline-meta">
                <span>📅 ${timeStr}</span>
                ${isDraftBadge}
                <span style="color: #60a5fa; font-weight: 700; font-size: 0.75rem; margin-left: 6px;">✏️ 行內編輯中...</span>
              </div>
              <div class="timeline-inline-edit-box">
                <textarea class="timeline-inline-textarea" id="inline-edit-textarea-${log.logId}">${log.updateLog}</textarea>
                <div class="timeline-inline-actions">
                  <button class="btn-inline-cancel" onclick="onCancelInlineEditTimelineItem('${item.id}')">✕ 取消</button>
                  <button class="btn-inline-save" onclick="onSaveInlineEditTimelineItem('${item.id}', '${log.logId}')">💾 儲存</button>
                </div>
              </div>
            </div>
          </div>
        `;
      }

      return `
        <div class="timeline-item-card ${isDraftClass}">
          <div class="timeline-content">
            <div class="timeline-meta">
              <span>📅 ${timeStr}</span>
              ${isDraftBadge}
            </div>
            <div class="timeline-text">${stripLeadingDate(log.updateLog)}</div>
          </div>
          <div class="timeline-actions">
            <button class="btn-timeline-action-icon" title="編輯這筆跟進紀錄 (暫存本地)" onclick="onToggleInlineEditTimelineItem('${item.id}', '${log.logId}')">✏️</button>
            <button class="btn-timeline-action-icon delete" title="作廢這筆跟進紀錄 (暫存本地)" onclick="onDeleteTimelineItem('${item.id}', '${log.logId}')">🗑️</button>
          </div>
        </div>
      `;
    })
    .join("");
}

// 切換為卡片行內編輯模式 (Inline Edit)
window.onToggleInlineEditTimelineItem = function (kpiId, logId) {
  window.editingTimelineLogId = logId;
  const item = liveView.viewRows.find((r) => r.id === kpiId);
  if (item) renderTimelineSpine(item, logId);
};

// 取消卡片行內編輯模式
window.onCancelInlineEditTimelineItem = function (kpiId) {
  window.editingTimelineLogId = null;
  const item = liveView.viewRows.find((r) => r.id === kpiId);
  if (item) renderTimelineSpine(item, null);
};

// 儲存卡片行內編輯結果至本地草稿
window.onSaveInlineEditTimelineItem = function (kpiId, logId) {
  const textarea = document.getElementById(`inline-edit-textarea-${logId}`);
  if (!textarea) return;

  const newText = textarea.value.trim();
  if (!newText) {
    showToast("紀錄內文不可為空！", "warning");
    return;
  }

  window.draftStore.editDraftLog(logId, newText);
  showToast("修訂已暫存至本地草稿！(按頂部「更新至雲端」生效)", "info");

  window.editingTimelineLogId = null;
  liveView.reparse();
  renderLiveViewGrid();

  const item = liveView.viewRows.find((r) => r.id === kpiId);
  if (item) renderTimelineSpine(item, null);
};

// 點擊時間軸「🗑️ 作廢」
window.onDeleteTimelineItem = function (kpiId, logId) {
  if (confirm("確定作廢此筆動態？\n變更將暫存於本地草稿，點擊「更新至雲端」後生效。")) {
    window.draftStore.deleteDraftLog(logId);
    showToast("作廢標記已暫存至本地草稿！", "warning");

    liveView.reparse();
    renderLiveViewGrid();

    const item = liveView.viewRows.find((r) => r.id === kpiId);
    if (item) renderTimelineSpine(item, null);
  }
};

window.closeDetailModal = function () {
  document.getElementById("detail-modal-backdrop").classList.remove("active");
  window.currentActiveKpiId = null;
  window.editingTimelineLogId = null;
};

/* ==========================================================================
   V3.9 專案詳情手機版 3 分頁切換 (Segmented Control: timeline / info / attachments)
   ========================================================================== */
window.switchMobileDetailTab = function (tabName) {
  const modalBody = document.getElementById("crm-detail-modal-body");
  const tabTimelineBtn = document.getElementById("mob-tab-timeline");
  const tabInfoBtn = document.getElementById("mob-tab-info");
  const tabAttBtn = document.getElementById("mob-tab-attachments");

  if (tabTimelineBtn) tabTimelineBtn.classList.remove("active");
  if (tabInfoBtn) tabInfoBtn.classList.remove("active");
  if (tabAttBtn) tabAttBtn.classList.remove("active");

  if (tabName === "info") {
    if (tabInfoBtn) tabInfoBtn.classList.add("active");
    if (modalBody) modalBody.setAttribute("data-mobile-active-tab", "info");
  } else if (tabName === "attachments") {
    if (tabAttBtn) tabAttBtn.classList.add("active");
    if (modalBody) modalBody.setAttribute("data-mobile-active-tab", "attachments");
    window.switchRightColTab("attachments");
  } else {
    // 預設 timeline (流水帳動態)
    if (tabTimelineBtn) tabTimelineBtn.classList.add("active");
    if (modalBody) modalBody.setAttribute("data-mobile-active-tab", "timeline");
    window.switchRightColTab("timeline");
  }
};

/* ==========================================================================
   V2.4 專案詳情右欄雙頁籤切換與 Projects_Attachments 渲染函式
   ========================================================================== */
window.switchRightColTab = function (tabName) {
  const timelineBtn = document.getElementById("tab-btn-timeline");
  const attachmentsBtn = document.getElementById("tab-btn-attachments");
  const timelinePanel = document.getElementById("right-panel-timeline");
  const attachmentsPanel = document.getElementById("right-panel-attachments");

  if (tabName === "attachments") {
    if (timelineBtn) timelineBtn.classList.remove("active");
    if (attachmentsBtn) attachmentsBtn.classList.add("active");
    if (timelinePanel) {
      timelinePanel.classList.remove("active");
      timelinePanel.style.display = "none";
    }
    if (attachmentsPanel) {
      attachmentsPanel.classList.add("active");
      attachmentsPanel.style.display = "flex";
    }
  } else {
    if (attachmentsBtn) attachmentsBtn.classList.remove("active");
    if (timelineBtn) timelineBtn.classList.add("active");
    if (attachmentsPanel) {
      attachmentsPanel.classList.remove("active");
      attachmentsPanel.style.display = "none";
    }
    if (timelinePanel) {
      timelinePanel.classList.add("active");
      timelinePanel.style.display = "flex";
    }
  }
};

function autoCategoryIcon(category) {
  switch (category) {
    case "Google Sheets": return "📊";
    case "Google Docs": return "📝";
    case "NotebookLM": return "🧠";
    case "GitHub": return "🐙";
    case "Report": return "📑";
    default: return "🔗";
  }
}

window.editingAttachmentLinkId = null;

function renderProjectAttachments(item) {
  const gridContainer = document.getElementById("detail-attachments-grid");
  const countBadge = document.getElementById("detail-attachments-count");
  const mobCountBadge = document.getElementById("mob-detail-attachments-count");
  if (!gridContainer) return;

  const attachments = item.attachments || [];
  if (countBadge) countBadge.textContent = attachments.length;
  if (mobCountBadge) mobCountBadge.textContent = attachments.length;

  if (attachments.length === 0) {
    gridContainer.innerHTML = `<div style="grid-column: 1 / -1; text-align: center; color: var(--text-subtle); padding: 35px; background: rgba(255,255,255,0.02); border-radius: 8px;">尚無專案雲端資源與鏈結紀錄</div>`;
    return;
  }

  gridContainer.innerHTML = attachments
    .map((att) => {
      const icon = autoCategoryIcon(att.category);
      const isDraftClass = att.isDraft ? "is-draft" : "";
      const isDraftBadge = att.isDraft
        ? `<span style="background: #f59e0b; color: #0f172a; padding: 1px 6px; border-radius: 4px; font-weight: 800; font-size: 0.72rem;">本地草稿</span>`
        : "";

      return `
        <div class="attachment-card ${isDraftClass}">
          <div class="attachment-card-header">
            <span class="attachment-icon">${icon}</span>
            <a href="${att.url}" target="_blank" rel="noopener noreferrer" class="attachment-title-link" title="${att.title.replace(/"/g, '&quot;')} - 點擊開啟：${att.url.replace(/"/g, '&quot;')}">
              ${att.title} ↗
            </a>
          </div>
          <div class="attachment-card-footer">
            <div style="display: flex; align-items: center; gap: 6px;">
              <span class="attachment-category-badge">${att.category}</span>
              ${isDraftBadge}
            </div>
            <div style="display: flex; gap: 6px;">
              <button class="btn-timeline-action-icon edit" title="編輯資源名稱與網址 (暫存本地)" onclick="onEditAttachmentLink('${item.id}', '${att.linkId}')">✏️</button>
              <button class="btn-timeline-action-icon delete" title="作廢此筆資源鏈結 (暫存本地)" onclick="onDeleteAttachmentLink('${item.id}', '${att.linkId}')">🗑️</button>
            </div>
          </div>
        </div>
      `;
    })
    .join("");
}

window.onEditAttachmentLink = function (kpiId, linkId) {
  const item = liveView.viewRows.find((r) => r.id === kpiId);
  if (!item) return;
  const att = (item.attachments || []).find((a) => a.linkId === linkId);
  if (!att) return;

  const kpiInput = document.getElementById("edit-att-kpi-id");
  const linkInput = document.getElementById("edit-att-link-id");
  const titleInput = document.getElementById("modal-edit-att-title");
  const urlInput = document.getElementById("modal-edit-att-url");
  const backdrop = document.getElementById("edit-attachment-modal-backdrop");
  const modal = document.getElementById("edit-attachment-modal");

  if (kpiInput) kpiInput.value = kpiId;
  if (linkInput) linkInput.value = linkId;
  if (titleInput) titleInput.value = att.title;
  if (urlInput) urlInput.value = att.url;

  if (backdrop) backdrop.style.display = "flex";
};

window.onCloseEditAttachmentModal = function () {
  const backdrop = document.getElementById("edit-attachment-modal-backdrop");
  if (backdrop) backdrop.style.display = "none";
};

window.onSaveEditAttachmentModal = function () {
  const kpiId = document.getElementById("edit-att-kpi-id")?.value;
  const linkId = document.getElementById("edit-att-link-id")?.value;
  const titleInput = document.getElementById("modal-edit-att-title");
  const urlInput = document.getElementById("modal-edit-att-url");

  if (!titleInput || !urlInput || !kpiId || !linkId) return;

  const newTitle = titleInput.value.trim();
  const newUrl = urlInput.value.trim();
  if (!newTitle || !newUrl) {
    showToast("資源名稱與網址不可為空！", "warning");
    return;
  }

  window.draftStore.editDraftAttachment(linkId, newTitle, newUrl);

  // 秒速同步修訂記憶體中 viewRows / filteredRows 該筆資產物件
  (liveView.viewRows || []).concat(liveView.filteredRows || []).forEach((row) => {
    (row.attachments || []).forEach((att) => {
      if (att.linkId === linkId) {
        att.title = newTitle;
        att.url = newUrl;
        att.isDraft = true;
      }
    });
  });

  showToast("已更新資源名稱/網址至本地草稿！(按頂部「更新至雲端」生效)", "info");

  onCloseEditAttachmentModal();

  liveView.reparse();
  renderLiveViewGrid();

  const item = liveView.viewRows.find((r) => r.id === kpiId);
  if (item) renderProjectAttachments(item);
};

window.onDeleteAttachmentLink = function (kpiId, linkId) {
  if (!confirm("確定要在本地草稿中作廢此筆資源鏈結嗎？(按下頂部『更新至雲端』生效)")) return;

  window.draftStore.deleteDraftAttachment(linkId);
  showToast("已將該筆資源鏈結作廢標記存入本地草稿！", "warning");

  liveView.reparse();
  renderLiveViewGrid();

  const item = liveView.viewRows.find((r) => r.id === kpiId);
  if (item) renderProjectAttachments(item, null);
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

// 🌐 全域掛載渲染函數供 project_manager 與 live_view 調用
window.renderLiveViewGrid = renderLiveViewGrid;
window.renderLiveViewDashboard = renderLiveViewDashboard;

// ☁️ 頂部微型雲端指示燈控制函數
window.setCloudStatus = function (status) {
  const pill = document.getElementById("cloud-sync-status");
  if (!pill) return;

  if (status === "syncing") {
    pill.className = "cloud-status-pill syncing";
    pill.innerHTML = "<span class='spin-icon'>🔄</span> 雲端同步中...";
  } else if (status === "offline") {
    pill.className = "cloud-status-pill offline";
    pill.innerHTML = "🟠 本地已存 (離線)";
  } else {
    pill.className = "cloud-status-pill";
    pill.innerHTML = "🟢 雲端已同步";
  }
};

// 🛡️ 瀏覽器關閉防呆保護 (若有正在進行之同步或儲存，彈出提示)
window.addEventListener("beforeunload", (e) => {
  if (window._isSyncing || (window.projectManager && window.projectManager.isSaving)) {
    e.preventDefault();
    e.returnValue = "您有正在同步至雲端的數據，確定要離開嗎？";
    return e.returnValue;
  }
});

/* --------------------------------------------------------------------------
   📲 Web Share Target 檔案接收與二階段直傳模組 (Android 系統分享閉環)
   -------------------------------------------------------------------------- */
const SHARE_DB_NAME = 'FollowLoop_ShareDB';
const SHARE_DB_VERSION = 1;
const SHARE_STORE_NAME = 'shared_files';

function openShareDBClient() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(SHARE_DB_NAME, SHARE_DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(SHARE_STORE_NAME)) {
        db.createObjectStore(SHARE_STORE_NAME, { keyPath: 'id', autoIncrement: true });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function getAndClearSharedFiles() {
  try {
    const db = await openShareDBClient();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(SHARE_STORE_NAME, 'readwrite');
      const store = tx.objectStore(SHARE_STORE_NAME);
      const getAllReq = store.getAll();

      getAllReq.onsuccess = () => {
        const files = getAllReq.result || [];
        if (files.length > 0) {
          // 取出後立即清空，避免重複處理
          store.clear();
        }
        resolve(files);
      };
      getAllReq.onerror = () => reject(getAllReq.error);
    });
  } catch (e) {
    console.warn('[ShareTarget] 讀取 IndexedDB 異常:', e);
    return [];
  }
}

async function handleIncomingSharedFiles() {
  const sharedItems = await getAndClearSharedFiles();
  if (!sharedItems || sharedItems.length === 0) {
    return;
  }

  console.log(`[ShareTarget] 成功獲取 ${sharedItems.length} 筆由系統分享傳入的檔案！`);
  showToast(`📲 接收到 ${sharedItems.length} 筆由手機分享傳入的檔案，開始直傳 Google Drive...`, 'info');

  // 切換至直傳門閥分頁以展示進度
  const ingestionBtn = document.querySelector('.nav-tab-btn[data-tab="ingestion"]');
  if (ingestionBtn) ingestionBtn.click();

  const progressContainer = document.getElementById("progress-container");
  const progressBarFill = document.getElementById("progress-bar-fill");
  const progressText = document.getElementById("progress-text");

  for (let i = 0; i < sharedItems.length; i++) {
    const item = sharedItems[i];

    // 🌟 若為純網址分享 ➔ 0 LLM 直接建立 .url 捷徑存入 Links/ 箱
    const incomingUrl = item.url || (item.text && item.text.match(/^https?:\/\/[^\s]+$/) ? item.text.trim() : null);
    if (incomingUrl && !item.blob) {
      try {
        showToast(`🌐 偵測到網址分享，正在儲存至 Links 箱: ${incomingUrl}`, 'info');
        await driveUploader.uploadUrlShortcut(incomingUrl, item.title || item.text || '');
        showToast(`🎉 網址捷徑已安全存入 Links/ 資料夾！`, 'success');
      } catch (urlErr) {
        console.error('[ShareTarget] 網址儲存失敗:', urlErr);
        showToast(`❌ 網址存入失敗: ${urlErr.message}`, 'danger');
      }
      continue;
    }

    const fileBlob = item.blob || item;
    // 重建標準 File 物件
    const file = new File([fileBlob], item.name || `shared_file_${Date.now()}`, {
      type: item.type || fileBlob.type || 'application/octet-stream'
    });

    const userNotes = item.text || item.title ? `[系統分享] ${item.title || ''} ${item.text || ''}`.trim() : `[系統分享] 來自 Android 系統分享之檔案`;

    // 走智慧場景分流通道 (單檔/多檔自動調用分類彈窗)
    await handleFileUpload(file);
  }

  // 清除 URL hash 中的 #share-incoming 標記
  if (window.location.hash.includes('share-incoming')) {
    history.replaceState(null, null, window.location.pathname + window.location.search);
  }

  setTimeout(() => {
    if (progressContainer) progressContainer.classList.remove("active");
  }, 4000);
}


