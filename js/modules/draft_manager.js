/**
 * FollowLoop-Web 本地草稿狀態列與同步管理器模組 (draft_manager.js)
 * 負責：LocalStorage 離線草稿提示列、批次推送到雲端 (GAS) 與放棄草稿
 */

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

  if (window.draftStore && typeof window.draftStore.notifyUI === "function") {
    window.draftStore.notifyUI();
  }
}

/**
 * 將 LocalStorage 草稿全數批次推送到雲端 Memory_Pool_Raw 數據庫
 */
async function syncLocalDraftsToCloud() {
  if (window._isSyncing) return;
  
  if (!window.draftStore) return;
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
  if (window.liveView && typeof window.liveView.showFullscreenLoading === "function") {
    window.liveView.showFullscreenLoading("正在同步本地草稿至雲端...", `處理 ${count} 筆 CRUD 異步請求中`);
  }

  try {
    // 1. 新增筆數 (batch_append_raw)：傳送 contents.rows 11 欄二維陣列
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

    // 3. 刪除筆數 (delete_record)：人類 UI 授權直接發起 0.8s 物理乾淨抹除
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

    // 4.5 修訂專案資源鏈結草稿 (Projects_Attachments)
    if (drafts.attachmentsEdited && typeof drafts.attachmentsEdited === "object") {
      for (const linkId of Object.keys(drafts.attachmentsEdited)) {
        const editItem = drafts.attachmentsEdited[linkId];
        let pTag = "General";
        if (window.liveView && window.liveView.viewRows) {
          window.liveView.viewRows.forEach((r) => {
            const found = (r.attachments || []).find((a) => a.linkId === linkId);
            if (found) pTag = found.projectTag || r.itemCode || "General";
          });
        }

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

    // 4.6 刪除專案資源鏈結草稿 (Projects_Attachments)
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
    if (window.liveView && typeof window.liveView.fetchViewData === "function") {
      await window.liveView.fetchViewData(false);
    }
    showToast(`🎉 成功同步 ${count} 筆變更至 Google Drive 雲端數據庫！`, "success");
    if (typeof window.renderLiveViewGrid === "function") {
      window.renderLiveViewGrid();
    }

    // 如果詳情 Modal 開啟中，同步刷新時間軸
    if (window.currentActiveKpiId && typeof window.openKpiDetailModal === "function") {
      window.openKpiDetailModal(window.currentActiveKpiId);
    }
  } catch (err) {
    showToast(`同步至雲端失敗: ${err.message}`, "danger");
  } finally {
    window._isSyncing = false;
    if (syncBtn) syncBtn.disabled = false;
    if (window.liveView && typeof window.liveView.hideFullscreenLoading === "function") {
      window.liveView.hideFullscreenLoading();
    }
  }
}

function discardLocalDrafts() {
  if (!window.draftStore) return;
  const count = window.draftStore.getDraftCount();
  if (count === 0) return;

  if (confirm(`確定放棄本地 ${count} 筆未同步的草稿變更？\n此動作將清理本地緩存，還原記憶體中雲端最新資料。`)) {
    window.draftStore.clearDrafts();
    showToast("已放棄本地草稿變更！", "warning");
    if (window.liveView && typeof window.liveView.reparse === "function") {
      window.liveView.reparse();
    }
    if (typeof window.renderLiveViewGrid === "function") {
      window.renderLiveViewGrid();
    }
    if (window.currentActiveKpiId && typeof window.openKpiDetailModal === "function") {
      window.openKpiDetailModal(window.currentActiveKpiId);
    }
  }
}

// 🌐 全域安全掛載函式
window.initDraftAlertBar = initDraftAlertBar;
window.syncLocalDraftsToCloud = syncLocalDraftsToCloud;
window.discardLocalDrafts = discardLocalDrafts;
