/**
 * FollowLoop-Web CRM 專案詳情與附件治理模組 (crm_detail_modal.js)
 * 負責：21 欄 CRM 專案詳情 Modal、時間軸流水帳 Inline Edit / 抹除確認、專案附件與鏈結管理、手機版 3 分頁切換
 */

window.editingTimelineLogId = null;
window.confirmingDeleteLogId = null;
window.editingAttachmentLinkId = null;

window.openKpiDetailModal = function (kpiId) {
  window.currentActiveKpiId = kpiId;
  window.editingTimelineLogId = null;
  window.confirmingDeleteLogId = null;
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

  // 2. 優先權 Badge
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

  // 6. 綁定「➕ 新增」時間軸動態按鈕事件
  const addBtn = document.getElementById("btn-add-timeline-log");
  const addInput = document.getElementById("new-timeline-input");

  if (addBtn && addInput) {
    const newBtn = addBtn.cloneNode(true);
    addBtn.parentNode.replaceChild(newBtn, addBtn);

    const handleAddTimelineLog = async () => {
      const text = addInput.value.trim();
      if (!text) {
        showToast("⚠️ 請先在輸入框輸入動態內容！", "warning");
        addInput.focus();
        addInput.style.borderColor = "#f59e0b";
        setTimeout(() => { addInput.style.borderColor = ""; }, 1500);
        return;
      }

      showToast(CONFIG.IS_LOCAL_MODE ? "⚡ [本地 0ms] 正在寫入 SQLite..." : "☁️ 正在同步動態至雲端...", "info");

      const logId = `LOG_${Date.now()}`;
      const nowIso = new Date().toISOString();
      const newRawRow = [
        logId,
        nowIso,
        item.itemCode || "General",
        item.accountName || item.entity || "",
        item.targetPurpose || "",
        item.ourAdvantages || "",
        "日常商務跟進",
        text,
        "",
        0.95,
        "APPROVED",
        item.priority || "HIGH"
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
      const updatedItem = liveView.viewRows.find((r) => r.id === item.id || r.itemCode === item.itemCode);
      if (updatedItem) renderTimelineSpine(updatedItem);

      if (typeof window.setCloudStatus === "function") {
        window.setCloudStatus("syncing");
      }

      try {
        const res = await sendGasRequest("batch_append_raw", {
          sheet: "Memory_Pool_Raw",
          rows: [newRawRow]
        });
        if (res && res.status === "success") {
          showToast(CONFIG.IS_LOCAL_MODE ? "⚡ 最新動態已成功寫入本地 SQLite！" : "✅ 最新動態已同步至雲端！", "success");
          if (CONFIG.IS_LOCAL_MODE && typeof window.checkCloudSyncStatus === "function") {
            window.checkCloudSyncStatus();
          }
        }
        if (typeof window.setCloudStatus === "function") {
          window.setCloudStatus("synced");
        }
      } catch (err) {
        console.error("[AutoSync] 時間軸同步失敗:", err);
        showToast(`❌ 同步失敗: ${err.message}`, "error");
        if (typeof window.setCloudStatus === "function") {
          window.setCloudStatus("offline");
        }
      }
    };

    newBtn.addEventListener("click", handleAddTimelineLog);
    addInput.onkeydown = (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleAddTimelineLog();
      }
    };
  }

  // 6.5 綁定「➕ 新增」專案資源鏈結按鈕事件
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

  // 7. 預設切換至右欄『動態歷程時間軸』頁籤
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
      const isConfirmingDelete = (window.confirmingDeleteLogId === log.logId);

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

      if (isConfirmingDelete) {
        return `
          <div class="timeline-item-card ${isDraftClass}" style="border-color: #ef4444; background: rgba(239, 68, 68, 0.08);">
            <div class="timeline-content" style="width: 100%;">
              <div class="timeline-meta">
                <span>📅 ${timeStr}</span>
                ${isDraftBadge}
                <span style="color: #f87171; font-weight: 700; font-size: 0.75rem; margin-left: 6px;">⚠️ 抹除確認</span>
              </div>
              <div class="timeline-text" style="color: #94a3b8; font-size: 0.86rem; margin-bottom: 8px;">${stripLeadingDate(log.updateLog)}</div>
              <div style="padding: 8px 12px; background: rgba(239, 68, 68, 0.18); border: 1px solid rgba(239, 68, 68, 0.4); border-radius: 6px; display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap;">
                <span style="font-size: 0.84rem; color: #fca5a5; font-weight: 600;">確定自本地與雲端物理抹除此筆動態？此操作不可逆。</span>
                <div style="display: flex; gap: 8px; flex-shrink: 0;">
                  <button class="btn-primary" style="background: #ef4444; border: 1px solid #dc2626; padding: 4px 12px; font-size: 0.82rem; font-weight: 700; border-radius: 4px; color: #fff; cursor: pointer;" onclick="onExecuteDeleteTimelineItem('${item.id}', '${log.logId}')">✓ 確定抹除</button>
                  <button class="btn-secondary" style="background: rgba(255, 255, 255, 0.1); border: 1px solid rgba(255, 255, 255, 0.2); padding: 4px 10px; font-size: 0.82rem; border-radius: 4px; color: #cbd5e1; cursor: pointer;" onclick="onCancelDeleteTimelineItem('${item.id}')">✕ 取消</button>
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
            <button class="btn-timeline-action-icon" title="編輯這筆跟進紀錄" onclick="onToggleInlineEditTimelineItem('${item.id}', '${log.logId}')">✏️</button>
            <button class="btn-timeline-action-icon delete" title="作廢這筆跟進紀錄" onclick="onAskDeleteTimelineItem('${item.id}', '${log.logId}')">🗑️</button>
          </div>
        </div>
      `;
    })
    .join("");
}

// 切換為卡片行內編輯模式
window.onToggleInlineEditTimelineItem = function (kpiId, logId) {
  window.editingTimelineLogId = logId;
  window.confirmingDeleteLogId = null;
  const item = liveView.viewRows.find((r) => r.id === kpiId || r.itemCode === window.currentActiveKpiItemCode);
  if (item) renderTimelineSpine(item, logId);
};

// 取消卡片行內編輯模式
window.onCancelInlineEditTimelineItem = function (kpiId) {
  window.editingTimelineLogId = null;
  const item = liveView.viewRows.find((r) => r.id === kpiId || r.itemCode === window.currentActiveKpiItemCode);
  if (item) renderTimelineSpine(item, null);
};

// 儲存卡片行內編輯結果
window.onSaveInlineEditTimelineItem = async function (kpiId, logId) {
  const textarea = document.getElementById(`inline-edit-textarea-${logId}`);
  if (!textarea) return;

  const newText = textarea.value.trim();
  if (!newText) {
    showToast("⚠️ 紀錄內文不可為空！", "warning");
    return;
  }

  // 1. 樂觀即時更新前端記憶體
  if (liveView && liveView.viewRows) {
    liveView.viewRows.forEach(row => {
      (row.rawLogs || row.logs || []).forEach(lg => {
        if (lg.logId === logId) lg.updateLog = newText;
      });
    });
  }

  // 同步更新 lastRawData
  if (window.liveView && Array.isArray(window.liveView.lastRawData)) {
    const rawIdx = window.liveView.lastRawData.findIndex(r => r[0] === logId);
    if (rawIdx !== -1) {
      window.liveView.lastRawData[rawIdx][7] = newText;
    }
  }
  if (typeof window.liveView?.saveLocalCache === "function") {
    window.liveView.saveLocalCache();
  }

  window.editingTimelineLogId = null;
  renderLiveViewGrid();

  const item = liveView.viewRows.find((r) => r.id === kpiId || r.itemCode === window.currentActiveKpiItemCode);
  if (item) renderTimelineSpine(item, null);

  // 2. 直寫後端數據庫
  showToast(CONFIG.IS_LOCAL_MODE ? "⚡ [本地 0ms] 正在寫入 SQLite..." : "☁️ 正在同步修訂至雲端...", "info");
  try {
    const res = await sendGasRequest("fix_raw_log", { log_id: logId, new_text: newText });
    if (res && res.status === "success") {
      showToast(CONFIG.IS_LOCAL_MODE ? "⚡ 流水帳已即時更新至本地 SQLite！" : "✅ 流水帳已更新至雲端！", "success");
      if (CONFIG.IS_LOCAL_MODE && typeof window.checkCloudSyncStatus === "function") {
        window.checkCloudSyncStatus();
      }
    }
  } catch (err) {
    showToast(`❌ 修訂失敗: ${err.message}`, "error");
    console.error("❌ [Timeline] 修訂失敗:", err);
  }
};

// 點擊時間軸「🗑️」觸發行內防誤觸確認
window.onAskDeleteTimelineItem = function (kpiId, logId) {
  window.confirmingDeleteLogId = logId;
  window.editingTimelineLogId = null;
  const item = liveView.viewRows.find((r) => r.id === kpiId || r.itemCode === window.currentActiveKpiItemCode);
  if (item) renderTimelineSpine(item, null);
};

// 取消作廢確認
window.onCancelDeleteTimelineItem = function (kpiId) {
  window.confirmingDeleteLogId = null;
  const item = liveView.viewRows.find((r) => r.id === kpiId || r.itemCode === window.currentActiveKpiItemCode);
  if (item) renderTimelineSpine(item, null);
};

// 執行物理抹除
window.onExecuteDeleteTimelineItem = async function (kpiId, logId) {
  window.confirmingDeleteLogId = null;

  // 1. 樂觀即時自前端記憶體移除
  if (liveView && liveView.viewRows) {
    liveView.viewRows.forEach(row => {
      if (row.rawLogs) {
        row.rawLogs = row.rawLogs.filter(lg => lg.logId !== logId);
      }
      if (row.logs) {
        row.logs = row.logs.filter(lg => lg.logId !== logId);
      }
    });
  }

  if (window.liveView && Array.isArray(window.liveView.lastRawData)) {
    window.liveView.lastRawData = window.liveView.lastRawData.filter(r => r[0] !== logId);
  }
  if (typeof window.liveView?.saveLocalCache === "function") {
    window.liveView.saveLocalCache();
  }

  renderLiveViewGrid();

  const item = liveView.viewRows.find((r) => r.id === kpiId || r.itemCode === window.currentActiveKpiItemCode);
  if (item) renderTimelineSpine(item, null);

  // 2. 直寫後端數據庫
  showToast(CONFIG.IS_LOCAL_MODE ? "⚡ [本地 0ms] 正在自 SQLite 物理抹除..." : "☁️ 正在自雲端物理抹除...", "info");
  try {
    const res = await sendGasRequest("delete_record", { sheet: "Memory_Pool_Raw", id: logId });
    if (res && res.status === "success") {
      showToast(CONFIG.IS_LOCAL_MODE ? "⚡ 記錄已自本地 SQLite 永久抹除！" : "✅ 記錄已自雲端物理抹除！", "success");
      if (CONFIG.IS_LOCAL_MODE && typeof window.checkCloudSyncStatus === "function") {
        window.checkCloudSyncStatus();
      }
    }
  } catch (err) {
    showToast(`❌ 抹除失敗: ${err.message}`, "error");
    console.error("❌ [Timeline] 抹除失敗:", err);
  }
};

window.onDeleteTimelineItem = window.onAskDeleteTimelineItem;

window.closeDetailModal = function () {
  document.getElementById("detail-modal-backdrop").classList.remove("active");
  window.currentActiveKpiId = null;
  window.editingTimelineLogId = null;
};

// 專案詳情手機版 3 分頁切換
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
    if (tabTimelineBtn) tabTimelineBtn.classList.add("active");
    if (modalBody) modalBody.setAttribute("data-mobile-active-tab", "timeline");
    window.switchRightColTab("timeline");
  }
};

// 專案詳情右欄雙頁籤切換
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

window.onSaveEditAttachmentModal = async function () {
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

  // 1. 樂觀即時同步修訂記憶體
  (liveView.viewRows || []).concat(liveView.filteredRows || []).forEach((row) => {
    (row.attachments || []).forEach((att) => {
      if (att.linkId === linkId) {
        att.title = newTitle;
        att.url = newUrl;
      }
    });
  });

  onCloseEditAttachmentModal();
  renderLiveViewGrid();

  const item = liveView.viewRows.find((r) => r.id === kpiId);
  if (item) renderProjectAttachments(item);

  // 2. 直寫後端數據庫
  showToast(CONFIG.IS_LOCAL_MODE ? "⚡ [本地 0ms] 正在修訂附件..." : "☁️ 正在同步修訂附件...", "info");
  try {
    const res = await sendGasRequest("batch_append_raw", {
      sheet: "Projects_Attachments",
      rows: [{ link_id: linkId, title: newTitle, url: newUrl }]
    });
    if (res && res.status === "success") {
      showToast(CONFIG.IS_LOCAL_MODE ? "⚡ 附件修訂已即時儲存至本地 SQLite！" : "✅ 附件修訂已更新至雲端！", "success");
    }
  } catch (err) {
    showToast(`❌ 附件修訂失敗: ${err.message}`, "error");
  }
};

window.onDeleteAttachmentLink = async function (kpiId, linkId) {
  if (!confirm("確定物理抹除此筆資源鏈結？此操作不可逆。")) return;

  // 1. 樂觀即時自記憶體移除
  (liveView.viewRows || []).concat(liveView.filteredRows || []).forEach((row) => {
    if (row.attachments) {
      row.attachments = row.attachments.filter(att => att.linkId !== linkId);
    }
  });

  renderLiveViewGrid();

  const item = liveView.viewRows.find((r) => r.id === kpiId);
  if (item) renderProjectAttachments(item, null);

  // 2. 直寫物理抹除
  showToast(CONFIG.IS_LOCAL_MODE ? "⚡ [本地 0ms] 正在自 SQLite 抹除附件..." : "☁️ 正在自雲端抹除附件...", "info");
  try {
    const res = await sendGasRequest("delete_record", { sheet: "Projects_Attachments", id: linkId });
    if (res && res.status === "success") {
      showToast(CONFIG.IS_LOCAL_MODE ? "⚡ 附件已自本地 SQLite 抹除！" : "✅ 附件已自雲端物理抹除！", "success");
    }
  } catch (err) {
    showToast(`❌ 抹除失敗: ${err.message}`, "error");
  }
};

// 🌐 全域安全掛載渲染函式
window.renderTimelineSpine = renderTimelineSpine;
window.renderProjectAttachments = renderProjectAttachments;
