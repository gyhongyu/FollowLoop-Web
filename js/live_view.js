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
      if (!raw) return { appended: [], edited: {}, deleted: [], attachmentsAppended: [], attachmentsEdited: {}, attachmentsDeleted: [] };
      const parsed = JSON.parse(raw);
      return {
        appended: parsed.appended || [],
        edited: parsed.edited || {},
        deleted: parsed.deleted || [],
        attachmentsAppended: parsed.attachmentsAppended || [],
        attachmentsEdited: parsed.attachmentsEdited || {},
        attachmentsDeleted: parsed.attachmentsDeleted || []
      };
    } catch (err) {
      console.error("[LocalDraftStore] 讀取本地草稿失敗，重置草稿:", err);
      return { appended: [], edited: {}, deleted: [], attachmentsAppended: [], attachmentsEdited: {}, attachmentsDeleted: [] };
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

  // ➕ 新增本地專案資源鏈結草稿
  addDraftAttachment(projectTag, title, url) {
    const hash4 = (Math.random().toString(36) + "0000").slice(2, 6);
    const tag = (projectTag || "General").replace(/\s+/g, "_");
    const draftId = `LINK_${tag}_${hash4}`;
    
    // 自動檢測分類
    let category = "Web Link";
    const urlLower = url.toLowerCase();
    if (urlLower.includes("docs.google.com/spreadsheets")) category = "Google Sheets";
    else if (urlLower.includes("docs.google.com/document")) category = "Google Docs";
    else if (urlLower.includes("notebooklm.google")) category = "NotebookLM";
    else if (urlLower.includes("github.com")) category = "GitHub";
    else if (urlLower.includes("html.foxlink.co.in") || urlLower.includes("reports")) category = "Report";

    const newLink = {
      linkId: draftId,
      projectTag: projectTag,
      title: title,
      url: url,
      category: category,
      createdAt: new Date().toISOString(),
      isDraft: true
    };

    if (!this.drafts.attachmentsAppended) this.drafts.attachmentsAppended = [];
    this.drafts.attachmentsAppended.unshift(newLink);
    this.saveDrafts();
    return newLink;
  }

  // ✎ 編輯本地專案資源鏈結草稿
  editDraftAttachment(linkId, newTitle, newUrl) {
    if (!this.drafts.attachmentsAppended) this.drafts.attachmentsAppended = [];
    if (!this.drafts.attachmentsEdited) this.drafts.attachmentsEdited = {};

    const appItem = this.drafts.attachmentsAppended.find((item) => item.linkId === linkId);
    if (appItem) {
      appItem.title = newTitle;
      appItem.url = newUrl;
    } else {
      this.drafts.attachmentsEdited[linkId] = {
        title: newTitle,
        url: newUrl,
        isDraftEdit: true
      };
    }
    this.saveDrafts();
  }

  // ✕ 作廢本地專案資源鏈結草稿
  deleteDraftAttachment(linkId) {
    if (!this.drafts.attachmentsAppended) this.drafts.attachmentsAppended = [];
    if (!this.drafts.attachmentsDeleted) this.drafts.attachmentsDeleted = [];

    const appIndex = this.drafts.attachmentsAppended.findIndex((item) => item.linkId === linkId);
    if (appIndex !== -1) {
      this.drafts.attachmentsAppended.splice(appIndex, 1);
    } else {
      if (!this.drafts.attachmentsDeleted.includes(linkId)) {
        this.drafts.attachmentsDeleted.push(linkId);
      }
    }
    this.saveDrafts();
  }

  // ➕ 新增本地動態草稿
  addDraftLog(projectTag, entityTarget, updateLog) {
    const hash4 = (Math.random().toString(36) + "0000").slice(2, 6);
    const tag = (projectTag || "General").replace(/\s+/g, "_");
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const draftId = `LOG_${tag}_${today}_${hash4}`;

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
    const appItem = this.drafts.appended.find((item) => item.logId === logId);
    if (appItem) {
      appItem.updateLog = newText;
      appItem.timestamp = new Date().toISOString();
    } else {
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
    const appIndex = this.drafts.appended.findIndex((item) => item.logId === logId);
    if (appIndex !== -1) {
      this.drafts.appended.splice(appIndex, 1);
    } else {
      if (!this.drafts.deleted.includes(logId)) {
        this.drafts.deleted.push(logId);
      }
    }
    this.saveDrafts();
  }

  // 🗑️ 放棄並清空所有本地草稿
  clearDrafts() {
    this.drafts = { appended: [], edited: {}, deleted: [], attachmentsAppended: [], attachmentsEdited: {}, attachmentsDeleted: [] };
    localStorage.removeItem(this.STORAGE_KEY);
    this.notifyUI();
  }

  // 獲取草稿總筆數
  getDraftCount() {
    const appCount = (this.drafts.appended || []).length;
    const editCount = Object.keys(this.drafts.edited || {}).length;
    const delCount = (this.drafts.deleted || []).length;
    const attAppCount = (this.drafts.attachmentsAppended || []).length;
    const attEditCount = Object.keys(this.drafts.attachmentsEdited || {}).length;
    const attDelCount = (this.drafts.attachmentsDeleted || []).length;
    return appCount + editCount + delCount + attAppCount + attEditCount + attDelCount;
  }

  // 檢查是否有任何本地未同步草稿
  hasDrafts() {
    return this.getDraftCount() > 0;
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
   1.5 全域全屏 Blocking Loading 遮罩函式 (供 auth.js / app.js / LiveView 共用)
   ========================================================================== */
window.showFullscreenLoading = function (title, subtext) {
  const overlay = document.getElementById("fullscreen-loading-overlay");
  const titleEl = document.getElementById("loading-overlay-title");
  const subEl = document.getElementById("loading-overlay-subtext");
  if (titleEl) titleEl.textContent = title || "正在讀取數據庫...";
  if (subEl) subEl.textContent = subtext || "網路通訊中，請稍候";
  if (overlay) overlay.classList.add("active");
};

window.hideFullscreenLoading = function () {
  const overlay = document.getElementById("fullscreen-loading-overlay");
  if (overlay) overlay.classList.remove("active");
};


const FL_DUAL_TABLE_CACHE_KEY = "FL_DUAL_TABLE_SNAPSHOT";

/* ==========================================================================
   2. LiveView 前端檢視與 GroupBy 聚合器 (支援 Cache-First 0ms 秒開與 SWR 背景靜默同步)
   ========================================================================== */
class LiveView {
  constructor() {
    this.viewRows = [];
    this.filteredRows = [];
    this.searchQuery = "";
    this.selectedCategory = localStorage.getItem("FL_FILTER_PREFERENCE") || "ALL";
    this.isLoading = false;
  }

  /**
   * 將當前雙表數據副本永久快取至本地硬碟 LocalStorage (0ms 持久化防丟失)
   */
  saveLocalCache() {
    try {
      const payload = {
        rawData: this.lastRawData || [],
        masterData: this.lastMasterData || [],
        attachmentsData: this.lastAttachmentsData || [],
        updatedAt: Date.now()
      };
      localStorage.setItem(FL_DUAL_TABLE_CACHE_KEY, JSON.stringify(payload));
    } catch (e) {
      console.warn("[LiveView] 本地持久快取寫入失敗 (可能是 quota 超限):", e);
    }
  }

  /**
   * 讀取本地硬碟 LocalStorage 快照
   */
  loadLocalCache() {
    try {
      const jsonStr = localStorage.getItem(FL_DUAL_TABLE_CACHE_KEY);
      if (!jsonStr) return null;
      const parsed = JSON.parse(jsonStr);
      if (parsed && Array.isArray(parsed.masterData) && parsed.masterData.length > 0) {
        // 🛡️ 數據完整性自癒防線：若快照中無專案附件，判定為不完整快照，強制重新拉取
        if (!Array.isArray(parsed.attachmentsData) || parsed.attachmentsData.length <= 1) {
          return null;
        }
        return parsed;
      }
      return null;
    } catch (e) {
      console.warn("[LiveView] 本地持久快取讀取異常:", e);
      return null;
    }
  }

  /**
   * 顯示全屏 Blocking Loading 遮罩 (委派給全域函式)
   */
  showFullscreenLoading(title, subtext) {
    window.showFullscreenLoading(title, subtext);
  }

  /**
   * 解除全屏 Blocking Loading 遮罩 (委派給全域函式)
   */
  hideFullscreenLoading() {
    window.hideFullscreenLoading();
  }

  /**
   * 向 GAS Web App 並行拉取 (採用 Cache-First 0ms 秒開 + SWR 背景靜默同步)
   */
  async fetchViewData(showOverlay = true) {
    // 1. 優先嘗試 0ms 本地快取秒開 (Cache-First)
    const cached = this.loadLocalCache();
    const hasLocalCache = !!(cached && Array.isArray(cached.masterData) && cached.masterData.length > 0);

    if (hasLocalCache) {
      // 0ms 瞬間載入本地快取數據，直接渲染畫面
      this.lastRawData = cached.rawData || [];
      this.lastMasterData = cached.masterData || [];
      this.lastAttachmentsData = cached.attachmentsData || [];
      this.viewRows = this.parseDualTableData(this.lastRawData, this.lastMasterData, this.lastAttachmentsData);
      this.applyFilter();
      if (typeof window.renderLiveViewGrid === "function") {
        window.renderLiveViewGrid();
      }
      window.draftStore.notifyUI();
      // 本地有快取時，完全不跳全屏轉圈圈 Loading 遮罩！
      showOverlay = false;
    } else if (showOverlay) {
      // 首次無快取時才顯示全屏 Loading 遮罩
      this.showFullscreenLoading("正在載入 Projects_Master 與 Raw 數據庫...", "首次連線初始化中，後續將自動啟用 0ms 本機快取");
    }

    this.isLoading = true;
    try {
      // 2. 背景發起 GAS 遠端請求 (SWR: Stale-While-Revalidate)
      const [rawRes, masterRes, attachmentsRes] = await Promise.all([
        sendGasGetRequest("Memory_Pool_Raw"),
        sendGasGetRequest("Projects_Master").catch(() => null),
        sendGasGetRequest("Projects_Attachments").catch(() => null)
      ]);

      const rawData = (rawRes && rawRes.status === "success" && Array.isArray(rawRes.data)) ? rawRes.data : (Array.isArray(rawRes?.rows) ? rawRes.rows : []);
      const masterData = (masterRes && masterRes.status === "success" && Array.isArray(masterRes.data)) ? masterRes.data : (Array.isArray(masterRes?.rows) ? masterRes.rows : []);
      const attachmentsData = (attachmentsRes && attachmentsRes.status === "success" && Array.isArray(attachmentsRes.data)) ? attachmentsRes.data : (Array.isArray(attachmentsRes?.rows) ? attachmentsRes.rows : []);

      if (masterData.length > 0 || rawData.length > 0) {
        // 保存純淨雲端原始數據副本
        this.lastRawData = rawData;
        this.lastMasterData = masterData;
        this.lastAttachmentsData = attachmentsData;

        // 0ms 寫入本地硬碟快取
        this.saveLocalCache();

        // 重新聚合並靜默平滑刷新畫面
        this.viewRows = this.parseDualTableData(rawData, masterData, attachmentsData);
        this.applyFilter();
        if (typeof window.renderLiveViewGrid === "function") {
          window.renderLiveViewGrid();
        }
      }
    } catch (err) {
      console.warn("[LiveView] 遠端 GAS 連線受阻，持續使用本地快取/草稿:", err);
      if (!hasLocalCache) {
        this.lastRawData = this.getMockRawRows();
        this.lastMasterData = [];
        this.lastAttachmentsData = [];
        this.viewRows = this.parseDualTableData(this.lastRawData, [], []);
        if (window.showToast) {
          window.showToast("目前處於離線狀態，已為您載入本地歷史與草稿暫存！", "warning");
        }
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
   * 0ms 本機記憶體重新融合：重跑 parseDualTableData 以反映 draftStore 的最新狀態
   * 用途：草稿暫存、編輯、作廢、放棄變更時呼叫，無需發起網路請求
   */
  reparse() {
    this.viewRows = this.parseDualTableData(
      this.lastRawData || [],
      this.lastMasterData || [],
      this.lastAttachmentsData || []
    );
    this.applyFilter();
  }

  /**
   * 前端多表 1-to-N 聚合演算法：將 Projects_Master、Memory_Pool_Raw 與 Projects_Attachments 及 Local Drafts 進行融合
   */
  parseDualTableData(rawRows, masterRows, attachmentsRows = []) {
    const drafts = window.draftStore.drafts;
    const groups = {};

    // 1. 先建立 Projects_Master 主檔 Map
    if (Array.isArray(masterRows) && masterRows.length > 1) {
      const mData = masterRows.slice(1);
      mData.forEach(row => {
        if (!row || !row[0]) return;
        const pTag = String(row[0]).trim();
        const accountName = String(row[1] || "").trim();
        const contact = String(row[2] || "").trim();
        const pName = String(row[3] || "").trim();
        const stage = String(row[4] || "").trim();
        const rawPrio = String(row[5] || "").toUpperCase().trim();
        
        let priority = "HIGH";
        if (rawPrio === "PAUSED" || rawPrio === "🔴") priority = "PAUSED";
        else if (rawPrio === "LOW" || rawPrio === "🟠") priority = "LOW";

        groups[pTag] = {
          projectTag: pTag,
          accountName: accountName,
          primaryContact: contact,
          projectName: pName,
          displayName: pName ? `${accountName} - ${pName}` : (accountName || pTag),
          stage: stage || "進行中",
          priority: priority,
          annualQuantity: row[6] || "",
          annualRevenue: row[7] || "",
          currency: row[8] || "USD",
          probability: row[9] || "",
          targetPurpose: row[10] || "",
          ourLeveragePoint: row[11] || "",
          ourAdvantages: row[12] || "",
          leadSource: row[13] || "",
          owner: row[14] || "Michael",
          projectStatus: row[15] || "ACTIVE",
          endCustomer: row[18] || "",
          tier1Partner: row[19] || "",
          accountTag: row[20] || "",
          logs: [],
          attachments: []
        };
      });
    }

    // 1.5 融合 Projects_Attachments 專案雲端資源鏈結 (支援 linkId 去重與草稿標記)
    if (Array.isArray(attachmentsRows) && attachmentsRows.length > 1) {
      const aData = attachmentsRows.slice(1);
      aData.forEach((row, idx) => {
        const linkId = String(row[0] || `LINK-${idx + 1}`).trim();
        const pTag = String(row[1] || "").trim();
        let title = String(row[2] || "").trim();
        let url = String(row[3] || "").trim();
        const category = String(row[4] || "Web Link").trim();
        const createdAt = row[5] || new Date().toISOString();

        const attDeleted = (drafts.attachmentsDeleted || []).includes(linkId);
        if (attDeleted || !url || title.startsWith("[DELETED]") || category === "DELETED") return;

        let isDraft = false;
        if (drafts.attachmentsEdited && drafts.attachmentsEdited[linkId]) {
          title = drafts.attachmentsEdited[linkId].title || title;
          url = drafts.attachmentsEdited[linkId].url || url;
          isDraft = true;
        }

        if (groups[pTag] && url) {
          const existingAtt = groups[pTag].attachments.find((a) => a.linkId === linkId);
          if (existingAtt) {
            existingAtt.title = title || existingAtt.title;
            existingAtt.url = url || existingAtt.url;
            existingAtt.category = category || existingAtt.category;
            if (isDraft) existingAtt.isDraft = true;
          } else {
            groups[pTag].attachments.push({
              linkId: linkId,
              projectTag: pTag,
              title: title || "無標題資源",
              url: url,
              category: category,
              createdAt: createdAt,
              isDraft: isDraft
            });
          }
        }
      });
    }

    // 1.8 融合本地追加之專案資源草稿
    if (Array.isArray(drafts.attachmentsAppended)) {
      drafts.attachmentsAppended.forEach(attDraft => {
        const pTag = attDraft.projectTag;
        if (groups[pTag]) {
          groups[pTag].attachments.unshift({
            linkId: attDraft.linkId,
            projectTag: pTag,
            title: attDraft.title,
            url: attDraft.url,
            category: attDraft.category || "Web Link",
            createdAt: attDraft.createdAt,
            isDraft: true
          });
        }
      });
    }

    // 2. 融合 Memory_Pool_Raw 流水帳
    if (Array.isArray(rawRows) && rawRows.length > 1) {
      const rData = rawRows.slice(1);
      rData.forEach((row, idx) => {
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

        const isDraftDeleted = drafts.deleted.includes(logId);
        if (agentStatus === "ARCHIVED" || agentStatus === "REJECTED" || isDraftDeleted) return;

        if (drafts.edited[logId]) {
          updateLog = drafts.edited[logId].updateLog;
        }

        // 智能對映與連結：若 projectTag (如 Item_2) 在主檔未精確匹配，嘗試對映至 Item_X_01 (專案主檔第一個專案)
        let targetTag = projectTag;
        if (!groups[targetTag]) {
          const candidateTag = `${projectTag}_01`;
          if (groups[candidateTag]) {
            targetTag = candidateTag;
          }
        }

        // 僅當對應專案主檔已建立時掛載日誌，避免為未建專案產生孤兒卡片
        if (groups[targetTag]) {
          groups[targetTag].logs.push({
            logId: logId,
            timestamp: timestamp,
            updateLog: updateLog || `${actionTaken} - ${entityTarget}`,
            actionTaken: actionTaken,
            attachmentLinks: attachmentLinks,
            isDraft: false
          });
        }
      });
    }

    // 3. 融合本地新追加之草稿
    drafts.appended.forEach(draft => {
      const tag = draft.projectTag || "General";
      if (!groups[tag]) {
        groups[tag] = {
          projectTag: tag,
          accountName: draft.entityTarget || "未指定單位",
          primaryContact: "",
          projectName: "本地草稿專案",
          displayName: draft.entityTarget ? `${draft.entityTarget} (草稿)` : tag,
          stage: "草稿階段",
          priority: draft.priority || "HIGH",
          annualQuantity: "",
          annualRevenue: "",
          currency: "USD",
          probability: "",
          targetPurpose: "即時跟進草稿",
          ourLeveragePoint: "",
          ourAdvantages: "本地暫存",
          leadSource: "",
          owner: "Michael",
          projectStatus: "ACTIVE",
          endCustomer: "",
          tier1Partner: "",
          accountTag: "",
          logs: []
        };
      }

      groups[tag].logs.unshift({
        logId: draft.logId,
        timestamp: draft.timestamp,
        updateLog: draft.updateLog,
        actionTaken: draft.actionTaken || "最新跟進 (草稿)",
        attachmentLinks: "",
        isDraft: true
      });
    });

    const projectKeys = Object.keys(groups);
    if (projectKeys.length === 0) return [];

    const formatJustDate = (ts) => {
      if (!ts) return "";
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

    return projectKeys.map((tag, idx) => {
      const g = groups[tag];
      g.logs.sort((a, b) => {
        const timeA = getLogSortTime(a);
        const timeB = getLogSortTime(b);
        if (timeB !== timeA) {
          return timeB - timeA;
        }
        const tsA = a.timestamp ? new Date(a.timestamp).getTime() : 0;
        const tsB = b.timestamp ? new Date(b.timestamp).getTime() : 0;
        return (isNaN(tsB) ? 0 : tsB) - (isNaN(tsA) ? 0 : tsA);
      });
      const latestLog = g.logs[0] || {};
      const timelineText = g.logs.map(l => `${l.updateLog}`).join("\n\n");

      return {
        id: `KPI-${idx + 1}`,
        itemCode: g.projectTag,
        accountName: g.accountName,
        projectName: g.projectName,
        primaryContact: g.primaryContact,
        entity: g.displayName,
        taskName: g.projectName ? `${g.accountName} - ${g.projectName}` : (g.accountName ? `${g.accountName} (早期探勘)` : g.projectTag),
        stage: g.stage,
        priority: (g.priority && g.priority.toUpperCase() !== "HIGH" && g.priority.toUpperCase() !== "LOW" && g.priority.toUpperCase() !== "PAUSED") ? "UNCLASSIFIED" : (g.priority || "UNCLASSIFIED"),
        annualQuantity: g.annualQuantity,
        annualRevenue: g.annualRevenue,
        currency: g.currency,
        probability: g.probability,
        targetPurpose: g.targetPurpose,
        ourLeveragePoint: g.ourLeveragePoint,
        ourAdvantages: g.ourAdvantages,
        leadSource: g.leadSource,
        owner: g.owner,
        projectStatus: g.projectStatus,
        endCustomer: g.endCustomer,
        tier1Partner: g.tier1Partner,
        accountTag: g.accountTag,
        nextStep: latestLog.updateLog || "尚無最新動態紀錄",
        actionTaken: latestLog.actionTaken || "追蹤中",
        tag: g.stage || "追蹤中",
        timelineHistory: timelineText || "尚無詳細動態紀錄",
        rawLogs: g.logs,
        attachments: g.attachments || [],
        lastUpdated: (latestLog && latestLog.timestamp) ? formatJustDate(latestLog.timestamp) : ""
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
      } else if (this.selectedCategory === "UNCLASSIFIED") {
        matchCategory = (
          item.priority === "Unclassified" ||
          item.priority === "UNCLASSIFIED" ||
          !item.priority ||
          item.stage === "New Lead" ||
          item.stage === "待完善" ||
          (item.projectName && item.projectName.includes("未分類專案")) ||
          (item.accountName && item.accountName.includes("未指定客戶")) ||
          item.itemCode.startsWith("Item_New") ||
          item.itemCode === "General"
        );
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
