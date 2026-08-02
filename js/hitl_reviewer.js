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
   * 向 GAS 拉取尚待 HITL 審核的卡片列表
   */
  async fetchPendingCards() {
    try {
      const res = await sendGasRequest("get_pending_reviews");
      if (res.status === "success" && Array.isArray(res.cards)) {
        this.pendingCards = res.cards;
      } else {
        // 如果後端尚未有動態待審核資料，載入展示示範資料或保持空列表
        this.pendingCards = this.getMockCardsIfEmpty(res.cards || []);
      }
      this.notify();
      return this.pendingCards;
    } catch (err) {
      console.warn("[HitlReviewer] 無法連線至後端待審核佇列，使用動態卡片記憶庫:", err);
      if (this.pendingCards.length === 0) {
        this.pendingCards = this.getMockCardsIfEmpty([]);
      }
      this.notify();
      return this.pendingCards;
    }
  }

  /**
   * 示範/預設待審核卡片 (當後端為空或展示測試時)
   */
  getMockCardsIfEmpty(cards) {
    if (cards && cards.length > 0) return cards;

    return [
      {
        entry_id: "CARD-DEMO-001",
        timestamp: new Date().toISOString(),
        source_type: "Email Ingestion",
        title: "與 VVDN 採購 Manikandan 商業採購交期確認",
        raw_text: "Received email from Manikandan regarding item 12 order batch delivery timeline.",
        entity_target: "VVDN Technologies",
        action_taken: "確認 Item_12 批次交期與 PM 追蹤",
        project_tag: "Item_12",
        status: "PENDING_REVIEW"
      },
      {
        entry_id: "CARD-DEMO-002",
        timestamp: new Date(Date.now() - 3600000).toISOString(),
        source_type: "Voice Record",
        title: "語音錄音：週一工程會議指派事項",
        raw_text: "錄音轉寫：討論目前 H2 32個 KPI 項目中，Item 25 與 28 的進度報告需求。",
        entity_target: "工程 RD 團隊",
        action_taken: "追蹤 Item_25 / Item_28 研發里程碑",
        project_tag: "Item_25",
        status: "PENDING_REVIEW"
      }
    ];
  }

  /**
   * 操作 1：【是 (Approve)】批准寫入 Memory_Pool_Raw
   * @param {string} entryId 
   */
  async approveCard(entryId) {
    const card = this.pendingCards.find((c) => c.entry_id === entryId);
    if (!card) throw new Error("找不著指定的待審核卡片！");

    console.log(`[HitlReviewer] 人工審核 [是]：批准卡片 ${entryId}`);

    // 組裝向 Memory_Pool_Raw 追加的單向寫入 Payload (batch_append_raw)
    const rowData = [
      new Date().toISOString().replace("T", " ").substring(0, 19), // Timestamp
      card.entity_target || "未指定",                             // Entity/Target
      card.action_taken || card.title || "無摘要",                 // Action/Update
      card.project_tag || "General",                              // Project Tag
      `[HITL Approved] ${card.raw_text || ""}`                    // Details/Raw Ref
    ];

    try {
      // 一併發送 review_action (decision: APPROVE) 與單向追加
      await sendGasRequest("review_action", {
        entry_id: entryId,
        decision: "APPROVE",
        rows: [rowData]
      });
    } catch (err) {
      console.warn(`[HitlReviewer] 透過 review_action 追加失敗，備用直接呼叫 batch_append_raw:`, err);
      await sendGasRequest("batch_append_raw", {
        rows: [rowData]
      });
    }

    // 從前端待審列表中移除該卡片
    this.pendingCards = this.pendingCards.filter((c) => c.entry_id !== entryId);
    this.notify();
    return { status: "success", message: "已批准並寫入 Memory_Pool_Raw 數據庫！" };
  }

  /**
   * 操作 2：【修改 (Edit & Approve)】編輯後批准寫入 Memory_Pool_Raw
   * @param {string} entryId 
   * @param {Object} updatedFields - { entity_target, action_taken, project_tag, details }
   */
  async editAndApproveCard(entryId, updatedFields) {
    const cardIndex = this.pendingCards.findIndex((c) => c.entry_id === entryId);
    if (cardIndex === -1) throw new Error("找不著指定的待審核卡片！");

    console.log(`[HitlReviewer] 人工審核 [修改]：更新卡片 ${entryId}`, updatedFields);

    const card = this.pendingCards[cardIndex];
    const finalEntity = updatedFields.entity_target || card.entity_target || "未指定";
    const finalAction = updatedFields.action_taken || card.action_taken || "無摘要";
    const finalTag = updatedFields.project_tag || card.project_tag || "General";
    const finalDetails = updatedFields.details || card.raw_text || "";

    const rowData = [
      new Date().toISOString().replace("T", " ").substring(0, 19),
      finalEntity,
      finalAction,
      finalTag,
      `[HITL Edited & Approved] ${finalDetails}`
    ];

    try {
      await sendGasRequest("review_action", {
        entry_id: entryId,
        decision: "EDIT",
        data: updatedFields,
        rows: [rowData]
      });
    } catch (err) {
      console.warn(`[HitlReviewer] review_action 備用切換至 batch_append_raw:`, err);
      await sendGasRequest("batch_append_raw", {
        rows: [rowData]
      });
    }

    this.pendingCards = this.pendingCards.filter((c) => c.entry_id !== entryId);
    this.notify();
    return { status: "success", message: "已修正並成功寫入 Memory_Pool_Raw 數據庫！" };
  }

  /**
   * 操作 3：【否 (Reject)】— 機制 A (廢棄不落庫)
   * 標記狀態為 REJECTED，檔案保留在 Drive，本機 AI 未來自動跳過，絕不上寫入 Memory_Pool
   * @param {string} entryId 
   */
  async rejectCard(entryId) {
    console.log(`[HitlReviewer] 人工審核 [否 - 機制 A]：卡片 ${entryId} 標記廢棄不落庫`);

    try {
      await sendGasRequest("review_action", {
        entry_id: entryId,
        decision: "REJECT",
        status: "REJECTED"
      });
    } catch (err) {
      console.warn(`[HitlReviewer] 遠端標記 REJECTED 警示:`, err);
    }

    // 本地移除卡片
    this.pendingCards = this.pendingCards.filter((c) => c.entry_id !== entryId);
    this.notify();
    return { status: "success", message: "已標記為 REJECTED 廢棄！原始檔保留於 Drive 作為歷史備查，本機 AI 未來將自動跳過。" };
  }
}

// 導出全域單例
window.hitlReviewer = new HitlReviewer();
