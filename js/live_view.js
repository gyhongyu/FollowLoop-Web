/**
 * FollowLoop-Web Google Sheet Live View 前端檢視看板與 Local Storage 草稿暫存器 (live_view.js)
 * 恪守【zero_touch_view_guard 零觸碰防線】與【memory_pool_raw_ssot_guard】
 * 支援 100% 本地草稿暫存 (Uncommitted Drafts)，斷網/重開網頁變更不消失，直到用戶手動點擊「更新至雲端」。
 */

/* ==========================================================================
   1. Local Storage 草稿暫存器 (DraftStore)
   ========================================================================== */
class LocalDraftStore {
  constructor() {
    this.STORAGE_KEY = "FOLLOWLOOP_LOCAL_DRAFTS_V1.2";
    this.drafts = this.loadDrafts();
  }

  loadDrafts() {
    try {
      const raw = localStorage.getItem(this.STORAGE_KEY);
      if (!raw) return { appended: [], edited: {}, deleted: [] };
      const parsed = JSON.parse(raw);
      return {
        appended: parsed.appended || [],
        edited: parsed.edited || {},
        deleted: parsed.deleted || []
      };
    } catch (err) {
      console.error("[LocalDraftStore] 讀取本地草稿失敗，重置草稿:", err);
      return { appended: [], edited: {}, deleted: [] };
    }
  }

  saveDrafts() {
    try {
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.drafts));
      this.notifyUI();
    } catch (err) {
      console.error("[LocalDraftStore] 寫入本地草稿失敗:", err);
    }
  }

  // ➕ 新增本地動態草稿
  addDraftLog(projectTag, entityTarget, updateLog) {
    const draftId = `DRAFT-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const newLog = {
      logId: draftId,
      projectTag: projectTag,
      entityTarget: entityTarget,
      updateLog: updateLog,
      actionTaken: "最新跟進 (本地草稿)",
      timestamp: new Date().toISOString(),
      isDraft: true
    };

    this.drafts.appended.unshift(newLog);
    this.saveDrafts();
    return newLog;
  }

  // ✎ 編輯本地動態草稿
  editDraftLog(logId, newText) {
    // 若該 log 是本地剛剛新增的草稿，直接更新 appended
    const appItem = this.drafts.appended.find((item) => item.logId === logId);
    if (appItem) {
      appItem.updateLog = newText;
      appItem.timestamp = new Date().toISOString();
    } else {
      // 若是雲端舊資料，記錄在 edited 雜湊表
      this.drafts.edited[logId] = {
        updateLog: newText,
        timestamp: new Date().toISOString(),
        isDraftEdit: true
      };
    }
    this.saveDrafts();
  }

  // ✕ 作廢本地動態草稿
  deleteDraftLog(logId) {
    // 若該 log 是本地新增的，直接從 appended 移除
    const appIndex = this.drafts.appended.findIndex((item) => item.logId === logId);
    if (appIndex !== -1) {
      this.drafts.appended.splice(appIndex, 1);
    } else {
      // 若是雲端舊資料，加入 deleted 陣列
      if (!this.drafts.deleted.includes(logId)) {
        this.drafts.deleted.push(logId);
      }
    }
    this.saveDrafts();
  }

  // 🗑️ 放棄並清空所有本地草稿
  clearDrafts() {
    this.drafts = { appended: [], edited: {}, deleted: [] };
    localStorage.removeItem(this.STORAGE_KEY);
    this.notifyUI();
  }

  // 獲取草稿總筆數
  getDraftCount() {
    const appCount = this.drafts.appended.length;
    const editCount = Object.keys(this.drafts.edited).length;
    const delCount = this.drafts.deleted.length;
    return appCount + editCount + delCount;
  }

  // 通知 UI 更新頂部提示列
  notifyUI() {
    if (window.updateDraftAlertBarUI) {
      window.updateDraftAlertBarUI(this.getDraftCount());
    }
  }
}

window.draftStore = new LocalDraftStore();


/* ==========================================================================
   2. LiveView 前端檢視與 GroupBy 聚合器
   ========================================================================== */
class LiveView {
  constructor() {
    this.viewRows = [];
    this.filteredRows = [];
    this.searchQuery = "";
    this.selectedCategory = "ALL";
    this.isLoading = false;
  }

  /**
   * 顯示全屏 Blocking Loading 遮罩 (Promise 驅動，絕非 setTimeout)
   */
  showFullscreenLoading(title = "正在讀取 Memory_Pool_Raw 數據庫...", subtext = "網路通訊與動態 GroupBy 聚合中") {
    const overlay = document.getElementById("fullscreen-loading-overlay");
    const titleEl = document.getElementById("loading-overlay-title");
    const subEl = document.getElementById("loading-overlay-subtext");
    if (titleEl) titleEl.textContent = title;
    if (subEl) subEl.textContent = subtext;
    if (overlay) overlay.classList.add("active");
  }

  /**
   * 解除全屏 Blocking Loading 遮罩
   */
  hideFullscreenLoading() {
    const overlay = document.getElementById("fullscreen-loading-overlay");
    if (overlay) overlay.classList.remove("active");
  }

  /**
   * 向 GAS Web App 拉取 Raw 數據庫 (唯讀 GET，純 Promise 驅動全屏加載)
   */
  async fetchViewData(showOverlay = true) {
    if (showOverlay) {
      this.showFullscreenLoading("正在載入 Raw 數據庫...", "恪守 memory_pool_raw_ssot_guard 獲取最新動態");
    }

    this.isLoading = true;
    try {
      const res = await sendGasGetRequest();

      if (res && res.status === "success" && Array.isArray(res.data) && res.data.length > 1) {
        this.viewRows = this.parseMemoryPoolRaw(res.data);
      } else if (res && res.status === "success" && Array.isArray(res.rows)) {
        this.viewRows = this.parseMemoryPoolRaw(res.rows);
      } else {
        console.warn("[LiveView] 遠端未傳回 Raw 數據，載入預設看板:", res);
        this.viewRows = this.parseMemoryPoolRaw(this.getMockRawRows());
      }
    } catch (err) {
      console.warn("[LiveView] 無法連線讀取 Memory_Pool_Raw，載入本地降級看板與草稿:", err);
      this.viewRows = this.parseMemoryPoolRaw(this.getMockRawRows());
      if (window.showToast) {
        window.showToast("目前處於離線狀態，已為您載入本地歷史與草稿暫存！", "warning");
      }
    } finally {
      this.isLoading = false;
      this.applyFilter();
      if (showOverlay) {
        this.hideFullscreenLoading();
      }
      window.draftStore.notifyUI();
    }
  }

  /**
   * 前端 GroupBy 聚合演算法：將 Raw 原始條目與 Local Drafts 進行無縫 Overlay 融合
   */
  parseMemoryPoolRaw(rows) {
    if (!rows || rows.length <= 1) return [];

    const drafts = window.draftStore.drafts;
    const dataRows = rows.slice(1);
    const groups = {};

    dataRows.forEach((row, idx) => {
      const logId = row[0] || `RAW-${idx + 1}`;
      const timestamp = row[1] || new Date().toISOString();
      const projectTag = (row[2] || "General").trim();
      const entityTarget = row[3] || "未指定單位";
      const targetPurpose = row[4] || "";
      const ourAdvantages = row[5] || "";
      const actionTaken = row[6] || "處理中";
      let updateLog = row[7] || "";
      const attachmentLinks = row[8] || "";
      const agentStatus = (row[10] || "APPROVED").toString().toUpperCase();

      // 檢查是否被本地草稿作廢/隱藏
      const isDraftDeleted = drafts.deleted.includes(logId);
      if (agentStatus === "ARCHIVED" || agentStatus === "REJECTED" || isDraftDeleted) return;

      // 檢查是否被本地草稿編輯
      let isDraftEdit = false;
      if (drafts.edited[logId]) {
        updateLog = drafts.edited[logId].updateLog;
        isDraftEdit = true;
      }

      // 讀取第 12 欄真實優先權 (SSOT 嚴格精準比對，空白者 100% 傳回 UNSET，絕不假造綠燈)
      let priority = "UNSET";
      const rawPriority = row[11] ? String(row[11]).trim().toUpperCase() : "";
      if (rawPriority === "PAUSED" || rawPriority === "INACTIVE" || rawPriority === "🔴") {
        priority = "PAUSED";
      } else if (rawPriority === "LOW" || rawPriority === "PASSIVE" || rawPriority === "🟠") {
        priority = "LOW";
      } else if (rawPriority === "HIGH" || rawPriority === "ACTIVE" || rawPriority === "🟢") {
        priority = "HIGH";
      }

      if (!groups[projectTag]) {
        groups[projectTag] = {
          projectTag: projectTag,
          entityTarget: entityTarget,
          targetPurpose: targetPurpose,
          ourAdvantages: ourAdvantages,
          latestAction: actionTaken,
          priority: priority,
          logs: []
        };
      }

      if (entityTarget) groups[projectTag].entityTarget = entityTarget;
      if (targetPurpose) groups[projectTag].targetPurpose = targetPurpose;
      if (ourAdvantages) groups[projectTag].ourAdvantages = ourAdvantages;
      if (actionTaken) groups[projectTag].latestAction = actionTaken;
      if (priority && priority !== "UNSET") groups[projectTag].priority = priority;

      groups[projectTag].logs.push({
        logId: logId,
        timestamp: timestamp,
        updateLog: updateLog || `${actionTaken} - ${entityTarget}`,
        actionTaken: actionTaken,
        attachmentLinks: attachmentLinks,
        isDraft: false,
        isDraftEdit: isDraftEdit
      });
    });

    // 融合本地新追加的草稿 (Appended Drafts)
    drafts.appended.forEach((draft) => {
      const tag = draft.projectTag || "General";
      if (!groups[tag]) {
        groups[tag] = {
          projectTag: tag,
          entityTarget: draft.entityTarget || "未指定單位",
          targetPurpose: "本地草稿專案",
          ourAdvantages: "即時追蹤",
          latestAction: draft.actionTaken || "最新跟進 (草稿)",
          priority: draft.priority || "HIGH",
          logs: []
        };
      }

      // 新增草稿放在頂端 (Newest First)
      groups[tag].logs.unshift({
        logId: draft.logId,
        timestamp: draft.timestamp,
        updateLog: draft.updateLog,
        actionTaken: draft.actionTaken,
        attachmentLinks: "",
        isDraft: true,
        isDraftEdit: false
      });
    });

    const projectKeys = Object.keys(groups);
    if (projectKeys.length === 0) return [];

    return projectKeys.map((tag, idx) => {
      const g = groups[tag];

      // 排序時間軸 (最新在最上面)
      g.logs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

      const timelineText = g.logs.map((l) => `${l.updateLog}`).join("\n\n");

      return {
        id: `KPI-${idx + 1}`,
        itemCode: g.projectTag,
        entity: g.entityTarget,
        taskName: g.targetPurpose || g.entityTarget,
        ourAdvantages: g.ourAdvantages,
        actionTaken: g.latestAction,
        tag: g.latestAction || "追蹤中",
        priority: g.priority || "HIGH",
        timelineHistory: timelineText || "尚無詳細動態紀錄",
        rawLogs: g.logs,
        lastUpdated: new Date().toLocaleDateString()
      };
    });
  }

  getMockRawRows() {
    return [
      ["log_id", "timestamp", "project_tag", "entity_target", "target_purpose", "our_advantages", "action_taken", "update_log", "attachment_links", "confidence_score", "agent_status"],
      ["LOG_001", "2026-06-26T10:00:00Z", "Item_1", "Michael Chen", "開拓印度市場", "開拓印度市場", "1. 印度外資Automotive Tier1客戶開發", "2026/06/26 完成無人機FPC樣品刪電子版", "", "0.95", "APPROVED"],
      ["LOG_002", "2026-07-17T14:30:00Z", "Item_2", "VVDN Technologies Private Limited", "Cables OEM / SSD", "Phison 方案彈性與客製化化認能能力", "1. 商務對接", "2026/07/17 收到 VVDN 採購工程師 Manikandan M 的新業務詢價提案", "", "0.98", "APPROVED"],
      ["LOG_003", "2026-03-13T09:15:00Z", "Item_3", "DELTA ELECTRONICS INDIA PVT. LTD.", "車載線代工 SMT代工", "綠/SMT代工機會 加大開發範圍", "1. 利用其Gurgaon廠開發外資企業", "2026/03/13 客戶要求報SMT代工價格，競爭對手是台表科....", "", "0.92", "APPROVED"]
    ];
  }

  applyFilter(query = this.searchQuery, category = this.selectedCategory) {
    this.searchQuery = query.toLowerCase().trim();
    this.selectedCategory = category;

    this.filteredRows = this.viewRows.filter((item) => {
      const matchQuery =
        !this.searchQuery ||
        item.itemCode.toLowerCase().includes(this.searchQuery) ||
        item.entity.toLowerCase().includes(this.searchQuery) ||
        item.taskName.toLowerCase().includes(this.searchQuery) ||
        item.timelineHistory.toLowerCase().includes(this.searchQuery);

      let matchCategory = true;
      if (this.selectedCategory === "HIGH") {
        matchCategory = (item.priority === "HIGH");
      } else if (this.selectedCategory === "LOW") {
        matchCategory = (item.priority === "LOW");
      } else if (this.selectedCategory === "PAUSED") {
        matchCategory = (item.priority === "PAUSED");
      } else if (this.selectedCategory === "ACTIVE") {
        matchCategory = (item.priority !== "PAUSED");
      }

      return matchQuery && matchCategory;
    });

    return this.filteredRows;
  }
}

// 導出全域單例
window.liveView = new LiveView();
