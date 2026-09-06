/**
 * FollowLoop-Web HITL 人工審核卡片 (是/修改/否 機制 A) 邏輯模組
 * 負責呈現本機 AI 結構化解析後的待審核卡片，並提供三向操作與 Modal 彈窗
 */

class HitlReviewer {
  constructor() {
    this.pendingCards = [];
    this.pendingBusinessLogs = [];
    this.pendingBusinessCards = [];
    this.currentEditingCard = null;
    this.currentEditingBusinessCard = null;
    this.activeSubTab = "business"; // "business" | "cards"
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
    this.onCardsUpdatedCallbacks.forEach((cb) => cb(this.pendingCards, this.pendingBusinessLogs, this.pendingBusinessCards));
  }

  /**
   * 背景管線或即時辨識直接注入卡片 (0ms 反應)
   */
  addCardDirectly(card) {
    this.pendingCards.unshift(card);
    this._classifyCards();
    this.notify();
  }

  /**
   * 內部輔助：將 pendingCards 分類為 商業情報 vs 名片
   */
  _classifyCards() {
    const queueTag = CONFIG.CARDS_QUEUE_TAG || "CARDS_QUEUE";
    this.pendingBusinessCards = this.pendingCards.filter(c => c.is_card || c.project_tag === queueTag);
    this.pendingBusinessLogs = this.pendingCards.filter(c => !c.is_card && c.project_tag !== queueTag);
  }

  /**
   * 向後端拉取尚待 HITL 審核的卡片列表 (agent_status === PENDING_REVIEW)
   * ⚡ 自適應架構：本地模式直讀 SQLite 0ms 秒出卡（無需等同步），雲端模式走 GAS
   */
  async fetchPendingCards() {
    try {
      // ⚡ 與寫入端 100% 對齊：優先自適應調用 sendGasGetRequest (本地模式直讀 SQLite 0ms)
      const res = await sendGasGetRequest("Memory_Pool_Raw");
      if (res && res.status === "success" && Array.isArray(res.data) && res.data.length > 1) {
        const rows = res.data;
        const pendingList = [];

        const queueTag = CONFIG.CARDS_QUEUE_TAG || "CARDS_QUEUE";

        // 跳過標頭列 (r=1 開始)
        for (let r = 1; r < rows.length; r++) {
          const row = rows[r];
          const status = (row[10] || "").toString().trim().toUpperCase();

          if (status === "PENDING_REVIEW" || status === "PENDING") {
            const rawId = row[0] || `RAW-ROW-${r + 1}`;
            const pTag = (row[2] || "NEW_UNCLASSIFIED").toString().trim();
            const isCard = (pTag === queueTag);

            if (isCard) {
              // 🪪 名片結構解析
              let details = {};
              try {
                details = typeof row[7] === "string" && row[7].startsWith("{") ? JSON.parse(row[7]) : { notes: row[7] || "" };
              } catch (e) {
                details = { notes: row[7] || "" };
              }

              let attachments = [];
              try {
                attachments = typeof row[8] === "string" && row[8].startsWith("[") ? JSON.parse(row[8]) : [];
              } catch (e) {}

              const rawPhone = String(row[6] || "").trim();
              const cleanPhone = rawPhone.startsWith("'") ? rawPhone.substring(1) : rawPhone;

              pendingList.push({
                entry_id: rawId,
                log_id: rawId,
                timestamp: row[1] || new Date().toISOString(),
                source_type: "🪪 名片辨識",
                is_card: true,
                project_tag: queueTag,
                name: row[3] || "未知聯絡人",
                title: row[4] || "",
                group_tag: row[5] || "Foxlink",
                phone: cleanPhone,
                phones: details.phones || [],
                company: details.company || "",
                email: details.email || "",
                address: details.address || "",
                notes: details.notes || "",
                attachment_links: row[8] || "",
                attachments: attachments,
                confidence_score: row[9] || "0.95",
                status: "PENDING_REVIEW"
              });
            } else {
              // 📜 既有商業情報結構解析
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
                is_card: false,
                project_tag: pTag,
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
        }

        this.pendingCards = pendingList;
        this._classifyCards();
      } else {
        this.pendingCards = [];
        this.pendingBusinessLogs = [];
        this.pendingBusinessCards = [];
      }

      this.notify();
      return this.pendingCards;
    } catch (err) {
      console.warn("[HitlReviewer] 無法連線至後端待審核佇列:", err);
      this.pendingCards = [];
      this.pendingBusinessLogs = [];
      this.pendingBusinessCards = [];
      this.notify();
      return this.pendingCards;
    }
  }

  /**
   * 內部輔助：100% 穿透直發雲端 GAS review_action，並雙向同步本地 SQLite
   */
  async _sendReviewAction(targetId, decision, extraData = {}) {
    const payload = {
      log_id: targetId,
      entry_id: targetId,
      decision: decision,
      ...extraData
    };

    // 1. 100% 直連雲端 GAS (單一真理 SSOT，物理抹除或變更狀態)
    let cloudRes = null;
    try {
      if (typeof sendCloudGasRequest === "function") {
        cloudRes = await sendCloudGasRequest("review_action", payload);
      } else {
        cloudRes = await sendGasRequest("review_action", payload);
      }
    } catch (e) {
      console.warn("[HitlReviewer] 雲端 review_action 警示:", e);
    }

    // 2. 雙重保險：同步通知本地 SQLite (若本地微服務在線，確保 F5 不殘留舊快取)
    if (CONFIG.IS_LOCAL_MODE) {
      try {
        if (decision === "REJECT") {
          await fetch(`${CONFIG.LOCAL_API_BASE}/action`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "delete_record", sheet: "Memory_Pool_Raw", id: targetId })
          });
        } else if (decision === "APPROVE" || decision === "EDIT") {
          await fetch(`${CONFIG.LOCAL_API_BASE}/action`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "review_action", log_id: targetId, decision: decision, data: extraData.data })
          });
        }
      } catch (locErr) {
        console.warn("[HitlReviewer] 本地 SQLite 同步略過:", locErr);
      }
    }

    return cloudRes;
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

    const res = await this._sendReviewAction(targetId, "APPROVE");
    if (res && res.status !== "success") {
      throw new Error(res.message || "GAS 批准操作未成功");
    }

    // 從前端待審列表中移除該卡片
    this.pendingCards = this.pendingCards.filter((c) => (c.log_id !== targetId && c.entry_id !== targetId));
    this._classifyCards();
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

    const res = await this._sendReviewAction(targetId, "EDIT", { data: updatedFields });
    if (res && res.status !== "success") {
      throw new Error(res.message || "GAS 修訂批准操作未成功");
    }

    this.pendingCards = this.pendingCards.filter((c) => (c.log_id !== targetId && c.entry_id !== targetId));
    this._classifyCards();
    this.notify();
    return { status: "success", message: `已修訂並成功批准日誌 (${targetId})！` };
  }

  /**
   * 操作 3：【否 (Reject)】— 物理抹除作廢 (Physical Deletion & File Cleanup)
   * 1. 物理刪除個人 Google Drive 圖檔並自 FollowLoop_google_drive_files 總帳物理清除
   * 2. 物理抹除雲端 Google Sheet 的 Memory_Pool_Raw 該行 (sheet.deleteRow)
   * 3. 同步物理抹除本地 SQLite 該行，杜絕 F5 刷新後復活
   * @param {string} logId 
   */
  async rejectCard(logId) {
    const card = this.pendingCards.find((c) => (c.log_id === logId || c.entry_id === logId));
    const targetId = card ? (card.log_id || card.entry_id) : logId;

    console.log(`[HitlReviewer] 人工審核 [否]：卡片 ${targetId} 物理作廢並清理來源`);

    // 1. 精準提取所有關聯的 Google Drive File ID
    const filesToTrash = new Set();
    if (card) {
      if (card.attachment_links) {
        try {
          const links = typeof card.attachment_links === "string" ? JSON.parse(card.attachment_links) : card.attachment_links;
          if (Array.isArray(links)) {
            for (const l of links) {
              if (l.id) filesToTrash.add(l.id);
              const m = (l.url || "").match(/[-\w]{25,}/);
              if (m) filesToTrash.add(m[0]);
            }
          }
        } catch (e) {}
      }
      if (card.attachments && Array.isArray(card.attachments)) {
        for (const att of card.attachments) {
          if (att.id) filesToTrash.add(att.id);
          const m = (att.url || "").match(/[-\w]{25,}/);
          if (m) filesToTrash.add(m[0]);
        }
      }
      if (card.drive_file_id) filesToTrash.add(card.drive_file_id);
    }

    // 2. 🗑️ 嚴格 AWAIT 物理刪除 Google Drive 檔案並同步自 FollowLoop_google_drive_files 總帳清除
    if (typeof sendDriveGasRequest === "function" && filesToTrash.size > 0) {
      for (const fid of filesToTrash) {
        console.log(`[HitlReviewer] 正在物理刪除 Google Drive 檔案並清退總帳: ${fid}...`);
        try {
          await sendDriveGasRequest("delete_file", { file_id: fid });
          console.log(`[HitlReviewer] ✅ 檔案 ${fid} 已移至垃圾桶並自總帳物理抹除！`);
        } catch (delErr) {
          console.warn(`[HitlReviewer] 物理刪除 Drive 檔案 ${fid} 警示:`, delErr);
        }
      }
    }

    // 3. 雲端 Google Sheet + 本地 SQLite 物理抹除 Memory_Pool_Raw 該行
    await this._sendReviewAction(targetId, "REJECT");

    // 4. 本地即時物理移除卡片
    this.pendingCards = this.pendingCards.filter((c) => (c.log_id !== targetId && c.entry_id !== targetId));
    this._classifyCards();
    this.notify();
    return { status: "success", message: `🗑️ 已成功作廢名片/情報 (${targetId}) 並物理清理雲端圖檔與總帳！` };
  }

  /**
   * =========================================================================
   * 🪪 名片專屬 HITL 閉環操作 (Business Card Dedicated Workflow)
   * =========================================================================
   */

  /**
   * 🪪 名片專屬【批准入庫】(Approve Business Card)
   * 1. 呼叫 Contacts 網關寫入 Google 通訊錄 (若是公務則帶入 Foxlink 標籤 + 備註帶 Drive 原圖外鏈)
   * 2. 若有 Drive 原圖，背景搬移歸檔至 Projects_Attachments/BusinessCards/
   * 3. 呼叫 GAS review_action 原地轉為 APPROVED
   * @param {string} logId 
   * @param {Object} overrideCardData - 可選，若用戶在批准時有即時修訂
   * @param {boolean} isFoxlinkGroup - 是否歸入 Foxlink 公務標籤 (預設 true)
   */
  async approveBusinessCard(logId, overrideCardData = null, isFoxlinkGroup = true) {
    const card = this.pendingCards.find((c) => (c.log_id === logId || c.entry_id === logId));
    if (!card) throw new Error("找不著指定的待審核名片！");

    const targetId = card.log_id || card.entry_id;
    const finalData = overrideCardData || card;

    console.log(`[HitlReviewer] 🪪 批准名片入庫: ${finalData.name} (${finalData.company})`);

    // 0. 規範化解析與清洗電話號碼 (VCF / E.164 標準)
    let phonesPayload = [];
    if (finalData.phones && Array.isArray(finalData.phones) && finalData.phones.length > 0) {
      phonesPayload = finalData.phones.map(p => typeof p === "string" ? { value: p, type: "mobile" } : { value: p.value || p.number, type: p.type || "mobile" });
    } else if (finalData.phone) {
      // 容錯拆解帶斜線或分號的電話字串
      const rawParts = String(finalData.phone).split(/[\/\n;,|]+/).map(s => s.trim()).filter(Boolean);
      phonesPayload = rawParts.map(p => {
        const isWork = /office|work|tel|市話|公司|020-|080-/i.test(p);
        return { value: p, type: isWork ? "work" : "mobile" };
      });
    }

    // 格式化電話：補齊國碼防呆
    phonesPayload = phonesPayload.map(p => {
      let v = p.value.trim();
      const pureDigits = v.replace(/[^\d]/g, "");
      if (!v.startsWith("+")) {
        if (pureDigits.length === 10 && /^[6-9]/.test(pureDigits)) {
          v = `+91 ${pureDigits.substring(0, 5)} ${pureDigits.substring(5)}`;
        } else if (pureDigits.length === 10 && pureDigits.startsWith("0")) {
          v = `+91 ${pureDigits.substring(1)}`;
        } else if (pureDigits.length === 10 && pureDigits.startsWith("09")) {
          v = `+886 ${pureDigits.substring(1)}`;
        }
      }
      return { value: v, type: p.type || "mobile" };
    });

    const primaryPhoneStr = phonesPayload.length > 0 ? phonesPayload[0].value : (finalData.phone || "");

    // 1. 組裝 Google Drive 原圖外鏈至備註中
    let driveUrlNotes = "";
    if (card.attachments && card.attachments.length > 0) {
      driveUrlNotes = card.attachments.map((att, i) => {
        const side = i === 0 ? "正面" : "背面";
        return `名片原圖(${side}): ${att.url}`;
      }).join(" | ");
    } else if (card.attachment_links) {
      try {
        const parsed = JSON.parse(card.attachment_links);
        if (Array.isArray(parsed)) {
          driveUrlNotes = parsed.map((p, i) => `名片原圖: ${p.url}`).join(" | ");
        }
      } catch (e) {}
    }

    // 淨化備註：剔除電話複述垃圾
    let cleanNotes = (finalData.notes || "")
      .replace(/(辦公室電話|行動電話|電話|手機|TEL|Phone|Mobile|Office)[\s:：]*[+\d\s\-\/]+/gi, "")
      .replace(/^[、，,.\s]+|[、，,.\s]+$/g, "")
      .trim();

    let fullNotes = "";
    if (cleanNotes) fullNotes += `備註: ${cleanNotes}\n`;
    if (finalData.address) fullNotes += `地址: ${finalData.address}\n`;
    if (driveUrlNotes) fullNotes += `📎 雲端檔案: ${driveUrlNotes}`;
    fullNotes = fullNotes.trim();

    // 2. 構建 People API Payload (支援 phones 陣列與 primaryPhone)
    const contactPayload = {
      name: finalData.name,
      phone: primaryPhoneStr,
      phones: phonesPayload,
      company: finalData.company || "",
      title: finalData.title || "",
      email: finalData.email || "",
      notes: fullNotes
    };

    // 🔒 恪守通訊錄標籤真理：有 Foxlink = 公務；無 = 個人
    if (isFoxlinkGroup) {
      contactPayload.groupResourceNames = [
        CONFIG.FOXLINK_GROUP_RESOURCE_NAME || "contactGroups/32c2175b88f3d791"
      ];
    }

    // 3. 呼叫 Google Contacts 萬能網關 (google_contacts_gateway)
    const contactsUrl = CONFIG.CONTACTS_GATEWAY_URL;
    if (!contactsUrl) throw new Error("未配置 CONTACTS_GATEWAY_URL！");

    const contactRes = await fetch(contactsUrl, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({
        action: "create",
        data: contactPayload
      })
    });

    if (!contactRes.ok) {
      throw new Error(`Google 通訊錄寫入失敗: ${contactRes.statusText}`);
    }

    const contactJson = await contactRes.json();
    if (contactJson && contactJson.status === "error") {
      throw new Error(`Google 通訊錄網關拒絕: ${contactJson.message || '未知錯誤'}`);
    }

    // 4. 0 搬移不可變架構：背景更新個人檔案總帳狀態為 APPROVED (不搬移實體檔案，0 延遲，杜絕跨帳號 403 報錯)
    (async () => {
      try {
        if (card.attachments && card.attachments.length > 0 && typeof sendDriveGasRequest === "function") {
          for (const att of card.attachments) {
            const fid = att.id || ((att.url || "").match(/[-\w]{25,}/) || [])[0];
            if (fid) {
              console.log(`[HitlReviewer] 0 搬移架構：更新個人檔案總帳 (${fid}) 狀態為 PROCESSED (已提煉素材)...`);
              sendDriveGasRequest("update_file_status", { file_id: fid, status: "PROCESSED" }).catch(() => {});
            }
          }
        }
      } catch (attErr) {
        console.warn("[HitlReviewer] 更新個人檔案總帳狀態略過:", attErr);
      }
    })();

    // 5. 呼叫 GAS review_action 將待審佇列標記為 APPROVED (直連雲端並雙向同步本地)
    await this._sendReviewAction(targetId, "APPROVE").catch(e => {
      console.warn("[HitlReviewer] 名片佇列狀態更新警示:", e);
    });

    // 6. 前端即時移除該名片卡片
    this.pendingCards = this.pendingCards.filter((c) => (c.log_id !== targetId && c.entry_id !== targetId));
    this._classifyCards();
    this.notify();

    return {
      status: "success",
      message: `🎉 名片 [${finalData.name} - ${finalData.company || ''}] 已成功入庫 Google 通訊錄！${isFoxlinkGroup ? '（已標記 Foxlink 公務人脈）' : '（個人人脈）'}`
    };
  }

  /**
   * 🪪 編輯名片佇列卡片 (在待審核狀態下原地更新)
   */
  async updateBusinessCard(logId, updatedCard) {
    const card = this.pendingCards.find((c) => (c.log_id === logId || c.entry_id === logId));
    if (!card) throw new Error("找不著指定的待審核名片！");

    const targetId = card.log_id || card.entry_id;
    Object.assign(card, updatedCard);

    // 原地更新 update_log 與 entity_target
    const detailsPayload = JSON.stringify({
      company: card.company || "",
      email: card.email || "",
      address: card.address || "",
      notes: card.notes || ""
    });

    await this._sendReviewAction(targetId, "EDIT", {
      data: {
        entity_target: card.name,
        target_purpose: card.title || "",
        action_taken: card.phone || "",
        update_log: detailsPayload
      }
    }).catch(e => {
      console.warn("[HitlReviewer] 名片更新遠端警示:", e);
    });

    this._classifyCards();
    this.notify();
    return { status: "success", message: `名片資訊已更新！` };
  }
}

// 導出全域單例
window.hitlReviewer = new HitlReviewer();
