/**
 * FollowLoop-Web HITL 人工審核卡片 (是/修改/否 機制 A) 邏輯模組
 * 負責呈現本機 AI 結構化解析後的待審核卡片，並提供三向操作與 Modal 彈窗
 */

class HitlReviewer {
  constructor() {
    this.pendingCards = [];
    this.currentEditingCard = null;
    this.onCardsUpdatedCallbacks = [];
  }

  /**
   * 訂閱卡片更新事件
   */
  subscribe(callback) {
    if (typeof callback === "function") {
      this.onCardsUpdatedCallbacks.push(callback);
    }
  }

  /**
   * 通知所有訂閱者
   */
  notify() {
    this.onCardsUpdatedCallbacks.forEach((cb) => cb(this.pendingCards));
  }

  /**
   * 向 GAS 拉取尚待 HITL 審核的卡片列表 (agent_status === PENDING_REVIEW)
   * 優先採用穩定的 sendGasGetRequest("Memory_Pool_Raw") 提取真值
   */
  async fetchPendingCards() {
    try {
      const res = await sendGasGetRequest("Memory_Pool_Raw");
      if (res && res.status === "success" && Array.isArray(res.data) && res.data.length > 1) {
        const rows = res.data;
        const pendingList = [];

        // 跳過標頭列 (r=1 開始)
        for (let r = 1; r < rows.length; r++) {
          const row = rows[r];
          const status = (row[10] || "").toString().trim().toUpperCase();

          if (status === "PENDING_REVIEW" || status === "PENDING") {
            const rawId = row[0] || `RAW-ROW-${r + 1}`;
            const isVoice = (row[7] || "").includes("語音錄音") || (row[7] || "").includes("轉寫");
            const isUrl = !!(row[8] && row[8].toString().trim() && row[8] !== "[]");

            let sourceType = "🤖 AI 智腦速記";
            if (isVoice) sourceType = "🎙️ 語音錄音轉寫";
            else if (isUrl) sourceType = "🔗 雲端資源鏈結";

            pendingList.push({
              entry_id: rawId,
              log_id: rawId,
              timestamp: row[1] || new Date().toISOString(),
              source_type: sourceType,
              project_tag: row[2] || "NEW_UNCLASSIFIED",
              entity_target: row[3] || "未指定客戶 (待編輯)",
              target_purpose: row[4] || "",
              our_advantages: row[5] || "",
              action_taken: row[6] || "最新跟進紀錄",
              update_log: row[7] || "",
              raw_text: row[7] || "",
              attachment_links: row[8] || "",
              confidence_score: row[9] || "0.85",
              status: "PENDING_REVIEW"
            });
          }
        }

        this.pendingCards = pendingList;
      } else {
        this.pendingCards = [];
      }

      this.notify();
      return this.pendingCards;
    } catch (err) {
      console.warn("[HitlReviewer] 無法連線至後端待審核佇列:", err);
      this.pendingCards = [];
      this.notify();
      return this.pendingCards;
    }
  }

  /**
   * 操作 1：【是 (Approve)】— 原地批准寫入 Memory_Pool_Raw
   * @param {string} logId 
   */
  async approveCard(logId) {
    const card = this.pendingCards.find((c) => (c.log_id === logId || c.entry_id === logId));
    if (!card) throw new Error("找不著指定的待審核卡片！");

    const targetId = card.log_id || card.entry_id;
    console.log(`[HitlReviewer] 人工審核 [是]：原地批准卡片 ${targetId}`);

    const res = await sendGasRequest("review_action", {
      log_id: targetId,
      entry_id: targetId,
      decision: "APPROVE"
    });

    if (res && res.status !== "success") {
      throw new Error(res.message || "GAS 批准操作未成功");
    }

    // 從前端待審列表中移除該卡片
    this.pendingCards = this.pendingCards.filter((c) => (c.log_id !== targetId && c.entry_id !== targetId));
    this.notify();
    return { status: "success", message: `已批准日誌 (${targetId})！狀態已更新為 APPROVED。` };
  }

  /**
   * 操作 2：【修改 (Edit & Approve)】— 編輯後原地批准寫入 Memory_Pool_Raw
   * @param {string} logId 
   * @param {Object} updatedFields - { project_tag, entity_target, target_purpose, action_taken, update_log }
   */
  async editAndApproveCard(logId, updatedFields) {
    const card = this.pendingCards.find((c) => (c.log_id === logId || c.entry_id === logId));
    if (!card) throw new Error("找不著指定的待審核卡片！");

    const targetId = card.log_id || card.entry_id;
    console.log(`[HitlReviewer] 人工審核 [修改]：更新卡片 ${targetId}`, updatedFields);

    const res = await sendGasRequest("review_action", {
      log_id: targetId,
      entry_id: targetId,
      decision: "EDIT",
      data: updatedFields
    });

    if (res && res.status !== "success") {
      throw new Error(res.message || "GAS 修訂批准操作未成功");
    }

    this.pendingCards = this.pendingCards.filter((c) => (c.log_id !== targetId && c.entry_id !== targetId));
    this.notify();
    return { status: "success", message: `已修訂並成功批准日誌 (${targetId})！` };
  }

  /**
   * 操作 3：【否 (Reject)】— 物理抹除作廢 (Physical Deletion & File Cleanup)
   * 絕不寫入數據庫，並自動清理關聯的暫存檔案或雲端硬碟檔案
   * @param {string} logId 
   */
  async rejectCard(logId) {
    const card = this.pendingCards.find((c) => (c.log_id === logId || c.entry_id === logId));
    const targetId = card ? (card.log_id || card.entry_id) : logId;

    console.log(`[HitlReviewer] 人工審核 [否]：卡片 ${targetId} 物理作廢並清理來源`);

    // 嘗試從附件鏈結中提取 Google Drive File ID
    let driveFileId = "";
    if (card && card.attachment_links) {
      try {
        const links = typeof card.attachment_links === "string" ? JSON.parse(card.attachment_links) : card.attachment_links;
        if (Array.isArray(links)) {
          for (const l of links) {
            const m = (l.url || "").match(/[-\w]{25,}/);
            if (m) {
              driveFileId = m[0];
              break;
            }
          }
        }
      } catch (e) {}
    }

    // 發送物理抹除請求
    await sendGasRequest("review_action", {
      log_id: targetId,
      entry_id: targetId,
      decision: "REJECT",
      drive_file_id: driveFileId
    }).catch(e => {
      console.warn("[HitlReviewer] Reject 背景警示:", e);
    });

    // 本地即時物理移除卡片
    this.pendingCards = this.pendingCards.filter((c) => (c.log_id !== targetId && c.entry_id !== targetId));
    this.notify();
    return { status: "success", message: `🗑️ 已成功作廢情報 (${targetId}) 並清理相關來源！` };
  }
}

// 導出全域單例
window.hitlReviewer = new HitlReviewer();
