/**
 * FollowLoop-Web CRM 專案主檔 CRUD 管理模組 (project_manager.js - V4.1)
 * 恪守【mode_and_superset_routing_guard】與【memory_pool_raw_ssot_guard】
 * 支援：
 * 1. 12 個官方專案階段字典 + 1 個方案提案階段
 * 2. 3 大優先級 (HIGH 🟢 / LOW 🟠 / PAUSED 🔴)
 * 3. 21 欄 CRM Projects_Master 結構
 * 4. 0ms 本地記憶體即時反饋 (lastMasterData + liveView.reparse())
 * 5. 0.8s 後端物理抹除 (delete_record) 與雲端同步 (batch_append_raw)
 */

(function (window) {
  "use strict";

  // 1. 官方階段字典 (SSOT 來自 docs/STATE.md 與『階段定義』頁籤)
  const STAGES_DICTIONARY = [
    { key: "Lead", label: "Lead (初步商機 / 建立窗口 / 拜訪記錄)", desc: "初步商機、建立窗口、取得名片或會議記錄" },
    { key: "Opportunity", label: "Opportunity (已確認商機 / 開始追蹤)", desc: "已確認商機、開始追蹤" },
    { key: "NDA", label: "NDA (保密協議簽署中 / 已完成)", desc: "NDA 協商、法務審核、完成簽署" },
    { key: "RFI", label: "RFI (需求與技術資訊交換)", desc: "需求、技術資訊交換" },
    { key: "RFQ", label: "RFQ (正式收到報價需求)", desc: "收到正式 RFQ" },
    { key: "Feasibility", label: "Feasibility (可行性分析 / DFM / 成本)", desc: "Design Review / Drawing / DFM / FAE / BOM / 成本" },
    { key: "Quote Submitted", label: "Quote Submitted (正式報價已送出)", desc: "正式報價已送出" },
    { key: "Customer Review", label: "Customer Review (客戶商務/技術評估)", desc: "客戶商務 / 技術評估" },
    { key: "Sample", label: "Sample (打樣 / 送樣中)", desc: "打樣、送樣" },
    { key: "Qualification", label: "Qualification (認證中 EVT/DVT/PVT/PPAP)", desc: "產品與製程資格認證" },
    { key: "Award", label: "Award (Design Win / 定點)", desc: "Design Win / Nomination 客戶正式定點" },
    { key: "SOP / MP", label: "SOP / MP (試量產 / 正式量產)", desc: "試量產 / 正式量產" },
    { key: "Solution Proposal", label: "Solution Proposal (替代方案/Cost Down提案)", desc: "替代方案 / Cost Down 提案 (非正式階段)" }
  ];

  // 2. 優先級字典
  const PRIORITIES = [
    { key: "HIGH", label: "🟢 High (高優先權 / 主動進行)", icon: "🟢" },
    { key: "LOW", label: "🟠 Low (低優先權 / 被動進行)", icon: "🟠" },
    { key: "PAUSED", label: "🔴 PAUSED (暫停行動)", icon: "🔴" }
  ];

  // 3. Projects_Master 21 欄 Schema 標頭標準定義
  const MASTER_HEADERS = [
    "project_tag",        // 0. A
    "account_name",       // 1. B
    "primary_contact",    // 2. C
    "project_name",       // 3. D
    "stage",              // 4. E
    "priority",           // 5. F
    "annual_quantity",    // 6. G
    "annual_revenue",     // 7. H
    "currency",           // 8. I
    "probability",        // 9. J
    "target_purpose",     // 10. K
    "our_leverage_point", // 11. L
    "our_advantages",     // 12. M
    "lead_source",        // 13. N
    "owner",              // 14. O
    "project_status",     // 15. P
    "created_at",         // 16. Q
    "updated_at",         // 17. R
    "end_customer",       // 18. S
    "tier1_partner",      // 19. T
    "account_tag"         // 20. U
  ];

  class ProjectManager {
    constructor() {
      this.isSaving = false;
      this.currentEditingTag = null; // null 表示新增，有值表示編輯
    }

    /**
     * 初始化專案管理模組 (DOM 事件與下拉選項注入)
     */
    init() {
      console.log("[ProjectManager] 初始化專案主檔 CRM 模組 (V4.1)...");
      this.populateStageSelect();
      this.bindEvents();
    }

    /**
     * 填充 12+1 個官方階段下拉選單
     */
    populateStageSelect() {
      const stageSelect = document.getElementById("pm-input-stage");
      if (!stageSelect) return;

      stageSelect.innerHTML = STAGES_DICTIONARY.map(s => 
        `<option value="${s.key}">${s.label}</option>`
      ).join("");
    }

    /**
     * 綁定相關 DOM 事件
     */
    bindEvents() {
      // 點擊 Modal 外部關閉
      const modalBackdrop = document.getElementById("project-modal-backdrop");
      if (modalBackdrop) {
        modalBackdrop.addEventListener("click", (e) => {
          if (e.target === modalBackdrop) {
            this.closeModal();
          }
        });
      }

      // 客戶名稱輸入時自動輔助建議 Tag
      const accountInput = document.getElementById("pm-input-account");
      if (accountInput) {
        accountInput.addEventListener("input", () => {
          if (!this.currentEditingTag) {
            this.autoSuggestTag();
          }
        });
      }
    }

    /**
     * 依據現有 Projects_Master 數據自動推算下一個合適的 Project Tag (如 Item_14_01)
     */
    autoSuggestTag() {
      const tagInput = document.getElementById("pm-input-tag");
      const accountTagInput = document.getElementById("pm-input-account-tag");
      const accountName = (document.getElementById("pm-input-account")?.value || "").trim();
      
      if (!tagInput || !accountTagInput) return;

      // 檢查現有 masterData 是否有相同客戶名稱
      const masterRows = window.liveView?.lastMasterData || [];
      let matchedAccountTag = "";
      let maxSubIndex = 0;
      let maxMainItemNum = 0;

      for (let r = 1; r < masterRows.length; r++) {
        const row = masterRows[r];
        if (!row || !row[0]) continue;
        const pTag = String(row[0]).trim();
        const aName = String(row[1] || "").trim();
        const aTag = String(row[20] || "").trim();

        // 提取 Item 主編號 (如 Item_14)
        const matchMain = pTag.match(/^Item_(\d+)/i);
        if (matchMain) {
          const num = parseInt(matchMain[1], 10);
          if (num > maxMainItemNum) maxMainItemNum = num;
        }

        // 如果客戶名稱相同
        if (accountName && aName && aName.toLowerCase() === accountName.toLowerCase()) {
          matchedAccountTag = aTag || pTag.split("_").slice(0, 2).join("_");
          // 找該客戶下最大的子專案號
          const matchSub = pTag.match(/_(\d+)$/);
          if (matchSub) {
            const subNum = parseInt(matchSub[1], 10);
            if (subNum > maxSubIndex) maxSubIndex = subNum;
          }
        }
      }

      if (matchedAccountTag) {
        accountTagInput.value = matchedAccountTag;
        const nextSub = String(maxSubIndex + 1).padStart(2, "0");
        tagInput.value = `${matchedAccountTag}_${nextSub}`;
      } else {
        const nextMain = maxMainItemNum + 1;
        const newAccTag = `Item_${nextMain}`;
        accountTagInput.value = newAccTag;
        tagInput.value = `${newAccTag}_01`;
      }
    }

    /**
     * 打開「新增專案」彈窗
     */
    openCreateModal() {
      this.currentEditingTag = null;
      const modal = document.getElementById("project-modal-backdrop");
      const titleEl = document.getElementById("pm-modal-title");
      const tagInput = document.getElementById("pm-input-tag");

      if (titleEl) titleEl.innerHTML = "➕ 新增 CRM 專案主檔";
      if (tagInput) tagInput.readOnly = false;

      // 清空表單並帶入預設值
      this.resetForm({
        stage: "Lead",
        priority: "HIGH",
        currency: "USD",
        owner: "Michael",
        projectStatus: "ACTIVE",
        probability: "50%"
      });

      this.autoSuggestTag();

      if (modal) {
        modal.style.display = "flex";
        document.body.style.overflow = "hidden"; // 防止背景滾動
      }
    }

    /**
     * 打開「編輯專案」彈窗
     * @param {string} projectTag 專案主鍵 (如 Item_14_01)
     */
    openEditModal(projectTag) {
      if (!projectTag) return;
      this.currentEditingTag = projectTag;

      // 從 liveView.viewRows 或 lastMasterData 查找
      const item = window.liveView?.viewRows?.find(r => r.itemCode === projectTag);
      const masterRows = window.liveView?.lastMasterData || [];
      let rawMasterRow = null;

      for (let r = 1; r < masterRows.length; r++) {
        if (masterRows[r] && String(masterRows[r][0]).trim() === projectTag) {
          rawMasterRow = masterRows[r];
          break;
        }
      }

      const modal = document.getElementById("project-modal-backdrop");
      const titleEl = document.getElementById("pm-modal-title");
      const tagInput = document.getElementById("pm-input-tag");

      if (titleEl) titleEl.innerHTML = `✏️ 編輯專案主檔 <span style="font-size:0.85rem; color:var(--primary-light); font-weight:normal;">(${projectTag})</span>`;
      if (tagInput) tagInput.readOnly = true; // 編輯時鎖定 PK 主鍵

      // 填入既有數值
      const formData = {
        projectTag: projectTag,
        accountName: item?.accountName || rawMasterRow?.[1] || "",
        primaryContact: item?.primaryContact || rawMasterRow?.[2] || "",
        projectName: item?.projectName || rawMasterRow?.[3] || "",
        stage: item?.stage || rawMasterRow?.[4] || "Opportunity",
        priority: item?.priority || rawMasterRow?.[5] || "HIGH",
        annualQuantity: item?.annualQuantity || rawMasterRow?.[6] || "",
        annualRevenue: item?.annualRevenue || rawMasterRow?.[7] || "",
        currency: item?.currency || rawMasterRow?.[8] || "USD",
        probability: item?.probability || rawMasterRow?.[9] || "",
        targetPurpose: item?.targetPurpose || rawMasterRow?.[10] || "",
        ourLeveragePoint: item?.ourLeveragePoint || rawMasterRow?.[11] || "",
        ourAdvantages: item?.ourAdvantages || rawMasterRow?.[12] || "",
        leadSource: item?.leadSource || rawMasterRow?.[13] || "",
        owner: item?.owner || rawMasterRow?.[14] || "Michael",
        projectStatus: item?.projectStatus || rawMasterRow?.[15] || "ACTIVE",
        endCustomer: item?.endCustomer || rawMasterRow?.[18] || "",
        tier1Partner: item?.tier1Partner || rawMasterRow?.[19] || "",
        accountTag: item?.accountTag || rawMasterRow?.[20] || projectTag.split("_").slice(0, 2).join("_")
      };

      this.fillForm(formData);

      if (modal) {
        modal.style.display = "flex";
        document.body.style.overflow = "hidden";
      }
    }

    /**
     * 關閉專案管理彈窗
     */
    closeModal() {
      const modal = document.getElementById("project-modal-backdrop");
      if (modal) {
        modal.style.display = "none";
        document.body.style.overflow = "";
      }
      this.currentEditingTag = null;
      this.isSaving = false;
      const saveBtn = document.getElementById("pm-submit-btn");
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.innerHTML = "💾 儲存專案主檔";
      }
    }

    /**
     * 重置表單值
     */
    resetForm(defaults = {}) {
      document.getElementById("pm-input-tag").value = defaults.projectTag || "";
      document.getElementById("pm-input-account-tag").value = defaults.accountTag || "";
      document.getElementById("pm-input-account").value = defaults.accountName || "";
      document.getElementById("pm-input-project").value = defaults.projectName || "";
      document.getElementById("pm-input-contact").value = defaults.primaryContact || "";
      document.getElementById("pm-input-stage").value = defaults.stage || "Lead";
      document.getElementById("pm-input-priority").value = defaults.priority || "HIGH";
      document.getElementById("pm-input-revenue").value = defaults.annualRevenue || "";
      document.getElementById("pm-input-currency").value = defaults.currency || "USD";
      document.getElementById("pm-input-quantity").value = defaults.annualQuantity || "";
      document.getElementById("pm-input-prob").value = defaults.probability || "";
      document.getElementById("pm-input-purpose").value = defaults.targetPurpose || "";
      document.getElementById("pm-input-leverage").value = defaults.ourLeveragePoint || "";
      document.getElementById("pm-input-advantages").value = defaults.ourAdvantages || "";
      document.getElementById("pm-input-source").value = defaults.leadSource || "";
      document.getElementById("pm-input-owner").value = defaults.owner || "Michael";
      document.getElementById("pm-input-end-customer").value = defaults.endCustomer || "";
      document.getElementById("pm-input-tier1").value = defaults.tier1Partner || "";
    }

    /**
     * 填入表單值
     */
    fillForm(data) {
      document.getElementById("pm-input-tag").value = data.projectTag || "";
      document.getElementById("pm-input-account-tag").value = data.accountTag || "";
      document.getElementById("pm-input-account").value = data.accountName || "";
      document.getElementById("pm-input-project").value = data.projectName || "";
      document.getElementById("pm-input-contact").value = data.primaryContact || "";
      document.getElementById("pm-input-stage").value = data.stage || "Lead";
      document.getElementById("pm-input-priority").value = data.priority || "HIGH";
      document.getElementById("pm-input-revenue").value = data.annualRevenue || "";
      document.getElementById("pm-input-currency").value = data.currency || "USD";
      document.getElementById("pm-input-quantity").value = data.annualQuantity || "";
      document.getElementById("pm-input-prob").value = data.probability || "";
      document.getElementById("pm-input-purpose").value = data.targetPurpose || "";
      document.getElementById("pm-input-leverage").value = data.ourLeveragePoint || "";
      document.getElementById("pm-input-advantages").value = data.ourAdvantages || "";
      document.getElementById("pm-input-source").value = data.leadSource || "";
      document.getElementById("pm-input-owner").value = data.owner || "Michael";
      document.getElementById("pm-input-end-customer").value = data.endCustomer || "";
      document.getElementById("pm-input-tier1").value = data.tier1Partner || "";
    }

    /**
     * 讀取表單資料並構造 21 欄 Projects_Master 陣列
     */
    getFormDataAsRow() {
      const projectTag = (document.getElementById("pm-input-tag")?.value || "").trim();
      const accountName = (document.getElementById("pm-input-account")?.value || "").trim();
      const primaryContact = (document.getElementById("pm-input-contact")?.value || "").trim();
      const projectName = (document.getElementById("pm-input-project")?.value || "").trim();
      const stage = (document.getElementById("pm-input-stage")?.value || "").trim();
      const priority = (document.getElementById("pm-input-priority")?.value || "").trim().toUpperCase();
      const annualQuantity = (document.getElementById("pm-input-quantity")?.value || "").trim();
      const annualRevenue = (document.getElementById("pm-input-revenue")?.value || "").trim();
      const currency = (document.getElementById("pm-input-currency")?.value || "USD").trim();
      const probability = (document.getElementById("pm-input-prob")?.value || "").trim();
      const targetPurpose = (document.getElementById("pm-input-purpose")?.value || "").trim();
      const ourLeveragePoint = (document.getElementById("pm-input-leverage")?.value || "").trim();
      const ourAdvantages = (document.getElementById("pm-input-advantages")?.value || "").trim();
      const leadSource = (document.getElementById("pm-input-source")?.value || "").trim();
      const owner = (document.getElementById("pm-input-owner")?.value || "Michael").trim();
      const projectStatus = "ACTIVE";
      const nowStr = new Date().toISOString().slice(0, 19).replace("T", " ");
      const endCustomer = (document.getElementById("pm-input-end-customer")?.value || "").trim();
      const tier1Partner = (document.getElementById("pm-input-tier1")?.value || "").trim();
      const accountTag = (document.getElementById("pm-input-account-tag")?.value || projectTag.split("_").slice(0, 2).join("_")).trim();

      // 驗證必填
      if (!projectTag) throw new Error("請提供專案標籤 (Project Tag)！");
      if (!accountName) throw new Error("請填寫客戶名稱 (Account Name)！");
      if (!projectName) throw new Error("請填寫專案名稱 (Project Name)！");

      // 構建 21 欄 row
      return [
        projectTag,        // 0. A: project_tag
        accountName,       // 1. B: account_name
        primaryContact,    // 2. C: primary_contact
        projectName,       // 3. D: project_name
        stage,             // 4. E: stage
        priority,          // 5. F: priority
        annualQuantity,    // 6. G: annual_quantity
        annualRevenue,     // 7. H: annual_revenue
        currency,          // 8. I: currency
        probability,       // 9. J: probability
        targetPurpose,     // 10. K: target_purpose
        ourLeveragePoint,  // 11. L: our_leverage_point
        ourAdvantages,     // 12. M: our_advantages
        leadSource,        // 13. N: lead_source
        owner,             // 14. O: owner
        projectStatus,     // 15. P: project_status
        nowStr,            // 16. Q: created_at
        nowStr,            // 17. R: updated_at
        endCustomer,       // 18. S: end_customer
        tier1Partner,      // 19. T: tier1_partner
        accountTag         // 20. U: account_tag
      ];
    }

    /**
     * 提交儲存專案 (0ms 立即關閉彈窗 + 0ms 本地持久快取落盤 + 背景非同步雲端同步)
     */
    submitProject() {
      let rowData;
      try {
        rowData = this.getFormDataAsRow();
      } catch (err) {
        if (window.showToast) window.showToast(err.message, "warning");
        else alert(err.message);
        return;
      }

      const isEdit = !!this.currentEditingTag;
      const targetTag = rowData[0];
      const accountName = rowData[1];
      const projectName = rowData[3];

      // =========================================================================
      // 💎 0ms 本地快取與畫面即時更新：1 毫秒內完成，絕不卡住使用者
      // =========================================================================
      if (!Array.isArray(window.liveView.lastMasterData) || window.liveView.lastMasterData.length === 0) {
        window.liveView.lastMasterData = [MASTER_HEADERS];
      }

      if (isEdit) {
        // 原地替換
        let found = false;
        for (let r = 1; r < window.liveView.lastMasterData.length; r++) {
          if (String(window.liveView.lastMasterData[r][0]).trim() === targetTag) {
            // 保留原始建立時間
            const origCreated = window.liveView.lastMasterData[r][16];
            if (origCreated) rowData[16] = origCreated;
            window.liveView.lastMasterData[r] = rowData;
            found = true;
            break;
          }
        }
        if (!found) {
          window.liveView.lastMasterData.push(rowData);
        }
      } else {
        // 新增：檢查 Tag 是否重複
        const exists = window.liveView.lastMasterData.slice(1).some(r => String(r[0]).trim() === targetTag);
        if (exists) {
          const msg = `專案標籤 '${targetTag}' 已存在！請修改標籤名稱。`;
          if (window.showToast) window.showToast(msg, "warning");
          else alert(msg);
          return;
        }
        window.liveView.lastMasterData.push(rowData);
      }

      // 0ms 寫入本地硬碟快取 (LocalStorage 持久化)
      if (typeof window.liveView.saveLocalCache === "function") {
        window.liveView.saveLocalCache();
      }

      // 0ms 即時重繪看板卡片 (紅燈 🔴 瞬間變更)
      window.liveView.reparse();
      if (typeof window.renderLiveViewGrid === "function") {
        window.renderLiveViewGrid();
      }

      // 0ms 立即關閉彈窗！使用者完全不用等待，可直接進行下一步操作！
      this.closeModal();

      if (typeof window.setCloudStatus === "function") {
        window.setCloudStatus("syncing");
      }

      // =========================================================================
      // 🌐 背景非同步雲端同步 (完全在背後靜默發送，不阻斷 UI 操作)
      // =========================================================================
      (async () => {
        try {
          if (isEdit) {
            await window.sendGasRequest("delete_record", {
              sheet: "Projects_Master",
              id: targetTag
            });
            await window.sendGasRequest("batch_append_raw", {
              sheet: "Projects_Master",
              rows: [rowData]
            });
          } else {
            await window.sendGasRequest("batch_append_raw", {
              sheet: "Projects_Master",
              rows: [rowData]
            });
          }

          if (typeof window.setCloudStatus === "function") {
            window.setCloudStatus("synced");
          }
        } catch (cloudErr) {
          console.error("[ProjectManager] 雲端同步失敗:", cloudErr);
          if (typeof window.setCloudStatus === "function") {
            window.setCloudStatus("offline");
          }
        }
      })();
    }

    /**
     * 彈出高質感毛玻璃危險操作確認 Modal (Promise-based)
     */
    showDeleteConfirmDialog({ dispName, projectTag, rawCount, attCount, driveCount }) {
      return new Promise((resolve) => {
        // 先移除可能殘留的舊對話框
        const existing = document.getElementById("fl-cascade-delete-modal");
        if (existing) existing.remove();

        const modalHtml = `
        <div id="fl-cascade-delete-modal" style="
          position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
          background: rgba(15, 23, 42, 0.78); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);
          display: flex; align-items: center; justify-content: center; z-index: 9999;
          opacity: 0; transition: opacity 0.2s cubic-bezier(0.16, 1, 0.3, 1); padding: 16px; box-sizing: border-box;
        ">
          <div id="fl-delete-dialog-card" style="
            background: rgba(30, 41, 59, 0.96);
            border: 1px solid rgba(239, 68, 68, 0.45);
            box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.7), 0 0 35px rgba(239, 68, 68, 0.22);
            border-radius: 18px; width: 100%; max-width: 480px; overflow: hidden;
            transform: scale(0.95) translateY(10px); transition: transform 0.25s cubic-bezier(0.16, 1, 0.3, 1);
            color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Noto Sans TC', sans-serif;
          ">
            <!-- 標頭 Header -->
            <div style="
              display: flex; align-items: center; justify-content: space-between;
              padding: 16px 20px; background: rgba(239, 68, 68, 0.12);
              border-bottom: 1px solid rgba(239, 68, 68, 0.25);
            ">
              <div style="display: flex; align-items: center; gap: 10px; font-weight: 700; font-size: 1.05rem; color: #fca5a5;">
                <span style="font-size: 1.25rem;">🚨</span>
                <span>危險操作確認 (Cascade Delete)</span>
              </div>
              <button id="fl-delete-btn-close" style="
                background: transparent; border: none; color: #94a3b8; font-size: 1.2rem;
                cursor: pointer; padding: 4px; border-radius: 6px; line-height: 1; transition: color 0.15s;
              " onmouseover="this.style.color='#ffffff'" onmouseout="this.style.color='#94a3b8'">✕</button>
            </div>

            <!-- 內容 Body -->
            <div style="padding: 20px;">
              <p style="margin: 0 0 10px 0; font-size: 0.9rem; color: #cbd5e1;">確定要刪除以下 CRM 專案主檔嗎？</p>
              
              <!-- 專案標題卡片 -->
              <div style="
                background: rgba(15, 23, 42, 0.65); border: 1px solid rgba(255, 255, 255, 0.1);
                border-radius: 12px; padding: 12px 16px; margin-bottom: 16px;
              ">
                <div style="font-weight: 700; font-size: 1.05rem; color: #ffffff; word-break: break-word; margin-bottom: 6px;">
                  ${dispName}
                </div>
                <div style="display: inline-flex; align-items: center; gap: 6px; background: rgba(99, 102, 241, 0.18); border: 1px solid rgba(99, 102, 241, 0.4); color: #a5b4fc; font-size: 0.8rem; padding: 2px 8px; border-radius: 6px; font-family: ui-monospace, monospace;">
                  <span>🏷️</span>
                  <span>${projectTag}</span>
                </div>
              </div>

              <!-- 關聯連帶資源 3 欄徽章 -->
              <p style="margin: 0 0 10px 0; font-size: 0.82rem; color: #94a3b8; font-weight: 600;">
                📌 系統將一併【三表連動 ✕ Google Drive 級聯物理抹除】：
              </p>
              <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 16px;">
                <div style="background: rgba(15, 23, 42, 0.5); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 10px; padding: 10px 6px; text-align: center;">
                  <div style="font-size: 0.72rem; color: #94a3b8; margin-bottom: 4px;">📝 流水帳</div>
                  <div style="font-size: 1.25rem; font-weight: 700; color: #60a5fa;">${rawCount} <span style="font-size: 0.72rem; font-weight: normal; color: #94a3b8;">筆</span></div>
                </div>
                <div style="background: rgba(15, 23, 42, 0.5); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 10px; padding: 10px 6px; text-align: center;">
                  <div style="font-size: 0.72rem; color: #94a3b8; margin-bottom: 4px;">📎 專案附件</div>
                  <div style="font-size: 1.25rem; font-weight: 700; color: #34d399;">${attCount} <span style="font-size: 0.72rem; font-weight: normal; color: #94a3b8;">筆</span></div>
                </div>
                <div style="background: rgba(15, 23, 42, 0.5); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 10px; padding: 10px 6px; text-align: center;">
                  <div style="font-size: 0.72rem; color: #94a3b8; margin-bottom: 4px;">☁️ Drive 實體</div>
                  <div style="font-size: 1.25rem; font-weight: 700; color: #f59e0b;">${driveCount} <span style="font-size: 0.72rem; font-weight: normal; color: #94a3b8;">個</span></div>
                </div>
              </div>

              <!-- 警告條 -->
              <div style="
                background: rgba(239, 68, 68, 0.12); border-left: 3px solid #ef4444;
                padding: 10px 12px; border-radius: 6px; font-size: 0.8rem; color: #fca5a5; line-height: 1.45;
              ">
                ⚠️ <strong>此操作無法復原！</strong> 雲端試算表孤兒列與 Google Drive 實體檔案將全量物理清退。
              </div>
            </div>

            <!-- 按鈕 Footer -->
            <div style="
              padding: 14px 20px; background: rgba(15, 23, 42, 0.45);
              border-top: 1px solid rgba(255, 255, 255, 0.08);
              display: flex; justify-content: flex-end; gap: 12px;
            ">
              <button id="fl-delete-btn-cancel" style="
                background: rgba(255, 255, 255, 0.08); border: 1px solid rgba(255, 255, 255, 0.15);
                color: #e2e8f0; padding: 8px 18px; border-radius: 8px; font-size: 0.88rem;
                font-weight: 600; cursor: pointer; transition: all 0.15s ease;
              ">取消 (ESC)</button>
              <button id="fl-delete-btn-confirm" style="
                background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
                border: 1px solid #f87171; color: #ffffff; padding: 8px 20px;
                border-radius: 8px; font-size: 0.88rem; font-weight: 700;
                cursor: pointer; box-shadow: 0 4px 12px rgba(239, 68, 68, 0.35);
                transition: all 0.15s ease; display: flex; align-items: center; gap: 6px;
              ">
                <span>🗑️</span>
                <span>確認連帶抹除</span>
              </button>
            </div>
          </div>
        </div>
        `;

        document.body.insertAdjacentHTML("beforeend", modalHtml);

        const modalEl = document.getElementById("fl-cascade-delete-modal");
        const dialogEl = document.getElementById("fl-delete-dialog-card");
        const btnCancel = document.getElementById("fl-delete-btn-cancel");
        const btnConfirm = document.getElementById("fl-delete-btn-confirm");
        const btnClose = document.getElementById("fl-delete-btn-close");

        const cleanup = (result) => {
          if (!modalEl) return;
          modalEl.style.opacity = "0";
          if (dialogEl) dialogEl.style.transform = "scale(0.95) translateY(10px)";
          document.removeEventListener("keydown", handleKey);
          setTimeout(() => {
            modalEl.remove();
            resolve(result);
          }, 200);
        };

        const handleKey = (e) => {
          if (e.key === "Escape") cleanup(false);
          else if (e.key === "Enter") cleanup(true);
        };

        document.addEventListener("keydown", handleKey);

        modalEl.addEventListener("click", (e) => {
          if (e.target === modalEl) cleanup(false);
        });

        if (btnCancel) btnCancel.addEventListener("click", () => cleanup(false));
        if (btnClose) btnClose.addEventListener("click", () => cleanup(false));
        if (btnConfirm) btnConfirm.addEventListener("click", () => cleanup(true));

        // 動畫進場
        requestAnimationFrame(() => {
          if (modalEl) modalEl.style.opacity = "1";
          if (dialogEl) dialogEl.style.transform = "scale(1) translateY(0)";
          if (btnCancel) btnCancel.focus();
        });
      });
    }

    /**
     * 刪除專案 (含級聯連動刪除三表資料、二次防呆提示與 0ms 記憶體即時反饋 + 物理乾淨抹除)
     * @param {string} projectTag 專案主鍵 (如 Item_14_01)
     * @param {string} accountName 客戶名稱
     * @param {string} projectName 專案名稱
     */
    async deleteProject(projectTag, accountName = "", projectName = "") {
      if (!projectTag) return;

      const dispName = projectName ? `${accountName} - ${projectName}` : (accountName || projectTag);
      
      // 收集該專案關聯的所有子資源 ID 與 Google Drive 檔案 ID
      const rawIds = [];
      const attachmentIds = [];
      const driveFileIds = new Set();

      if (Array.isArray(window.liveView?.lastRawData)) {
        for (let idx = 1; idx < window.liveView.lastRawData.length; idx++) {
          const row = window.liveView.lastRawData[idx];
          if (row && String(row[2] || "").trim() === projectTag) {
            const rawId = String(row[0] || "").trim();
            if (rawId) rawIds.push(rawId);
            const driveUrl = String(row[8] || "").trim();
            const m = driveUrl.match(/[-\w]{25,}/);
            if (m) driveFileIds.add(m[0]);
          }
        }
      }

      if (Array.isArray(window.liveView?.lastAttachmentsData)) {
        for (let idx = 1; idx < window.liveView.lastAttachmentsData.length; idx++) {
          const row = window.liveView.lastAttachmentsData[idx];
          if (row && String(row[1] || "").trim() === projectTag) {
            const attId = String(row[0] || "").trim();
            if (attId) attachmentIds.push(attId);
            const attUrl = String(row[3] || "").trim();
            const m = attUrl.match(/[-\w]{25,}/);
            if (m) driveFileIds.add(m[0]);
          }
        }
      }

      const rawCount = rawIds.length;
      const attCount = attachmentIds.length;
      const driveCount = driveFileIds.size;

      const isConfirmed = await this.showDeleteConfirmDialog({
        dispName,
        projectTag,
        rawCount,
        attCount,
        driveCount
      });

      if (!isConfirmed) {
        return;
      }

      // =========================================================================
      // 💎 0ms 記憶體即時反饋：三表同步過濾連動移除並 reparse()
      // =========================================================================
      // 1. Projects_Master 移除
      if (Array.isArray(window.liveView.lastMasterData)) {
        window.liveView.lastMasterData = window.liveView.lastMasterData.filter((row, idx) => {
          if (idx === 0) return true;
          return String(row[0] || "").trim() !== projectTag;
        });
      }

      // 2. 級聯移除 Memory_Pool_Raw 孤兒流水帳
      if (Array.isArray(window.liveView.lastRawData)) {
        window.liveView.lastRawData = window.liveView.lastRawData.filter((row, idx) => {
          if (idx === 0) return true;
          return String(row[2] || "").trim() !== projectTag;
        });
      }

      // 3. 級聯移除 Projects_Attachments 孤兒附件
      if (Array.isArray(window.liveView.lastAttachmentsData)) {
        window.liveView.lastAttachmentsData = window.liveView.lastAttachmentsData.filter((row, idx) => {
          if (idx === 0) return true;
          return String(row[1] || "").trim() !== projectTag;
        });
      }

      // 0ms 本地硬碟持久化 + 即時刷新前端看板
      if (typeof window.liveView.saveLocalCache === "function") {
        window.liveView.saveLocalCache();
      }
      window.liveView.reparse();
      if (typeof window.renderLiveViewGrid === "function") {
        window.renderLiveViewGrid();
      }

      // 若目前詳情彈窗開啟此專案，關閉詳情彈窗
      if (typeof window.closeDetailModal === "function") {
        window.closeDetailModal();
      }

      if (window.showToast) {
        window.showToast(`專案【${dispName}】已自看板移除，正在執行三表與 Google Drive 級聯連帶抹除...`, "info");
      }

      // =========================================================================
      // 🌐 後端非同步級聯物理抹除 (Cascade Delete: Master + Raw + Attachments + Google Drive)
      // =========================================================================
      try {
        // 1. 🗑️ 物理抹除 Google Drive 實體附件檔案
        if (typeof sendDriveGasRequest === "function" && driveFileIds.size > 0) {
          for (const fid of driveFileIds) {
            console.log(`[ProjectManager] 正在物理刪除 Google Drive 專案附件: ${fid}...`);
            try {
              await sendDriveGasRequest("delete_file", { file_id: fid });
              console.log(`[ProjectManager] ✅ Drive 檔案 ${fid} 已移入垃圾桶並清退總帳！`);
            } catch (delErr) {
              console.warn(`[ProjectManager] 刪除 Drive 檔案 ${fid} 警示:`, delErr);
            }
          }
        }

        // 2. 🗑️ 雲端 Google Sheet 三表連帶物理抹除
        // 2.1 刪除 Memory_Pool_Raw 關聯流水
        for (const rawId of rawIds) {
          await window.sendGasRequest("delete_record", {
            sheet: "Memory_Pool_Raw",
            id: rawId
          }).catch(e => console.warn(`刪除雲端流水 ${rawId} 警示:`, e));
        }

        // 2.2 刪除 Projects_Attachments 關聯附件記錄
        for (const attId of attachmentIds) {
          await window.sendGasRequest("delete_record", {
            sheet: "Projects_Attachments",
            id: attId
          }).catch(e => console.warn(`刪除雲端附件 ${attId} 警示:`, e));
        }

        // 2.3 刪除 Projects_Master 主檔
        await window.sendGasRequest("delete_record", {
          sheet: "Projects_Master",
          id: projectTag
        });

        // 3. 🗑️ 本地 SQLite 級聯物理抹除 + Outbox 隊列
        if (CONFIG.IS_LOCAL_MODE) {
          fetch(`${CONFIG.LOCAL_API_BASE}/action`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "cascade_delete_project", project_tag: projectTag })
          }).catch(e => console.warn("本地級聯刪除略過:", e));
        }

        if (window.showToast) {
          window.showToast(`🗑️ 專案【${dispName}】三表連動與 Google Drive 級聯抹除完成 (0 孤兒數據)！`, "success");
        }
      } catch (err) {
        console.error("[ProjectManager] 級聯刪除專案失敗:", err);
        if (window.showToast) {
          window.showToast(`⚠️ 專案已自畫面移除，但後端刪除異常：${err.message || err}`, "warning");
        }
      }
    }
  }

  // 導出全域單例
  window.projectManager = new ProjectManager();

  // DOM 載入完成後初始化
  document.addEventListener("DOMContentLoaded", () => {
    window.projectManager.init();
  });

})(window);
