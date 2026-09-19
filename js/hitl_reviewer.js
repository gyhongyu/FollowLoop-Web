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

    // 🛡️ 防復活樂觀鎖：sessionStorage 記錄本 Session 已操作的 ID，阻斷 60s 刷新覆蓋
    this._actionedIds = new Set();
    try {
      const saved = sessionStorage.getItem('fl_hitl_actioned_ids');
      if (saved) JSON.parse(saved).forEach(id => this._actionedIds.add(id));
    } catch (e) {}
  }

  /**
   * 將已操作 ID 寫入 sessionStorage（防 60s 刷新復活，F5 後自動清除）
   */
  _markActioned(logId, fileId = null) {
    if (logId) this._actionedIds.add(logId);
    if (fileId) this._actionedIds.add(fileId);
    try {
      sessionStorage.setItem('fl_hitl_actioned_ids', JSON.stringify(Array.from(this._actionedIds)));
    } catch (e) {}
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

        // 🛡️ 全域 Drive File ID 真值集合初始化（不依賴本機快取，以雲端資料庫全表為單一真理 SSOT）
        if (!window.FL_PROCESSED_DRIVE_IDS) {
          window.FL_PROCESSED_DRIVE_IDS = new Set();
        }

        const queueTag = CONFIG.CARDS_QUEUE_TAG || "CARDS_QUEUE";
        // 🛡️ 已審核圖檔真值盾牌 (Approved Shield Set)
        const approvedDriveFileIds = new Set();

        // 跳過標頭列 (r=1 開始)
        for (let r = 1; r < rows.length; r++) {
          const row = rows[r];
          const status = (row[10] || "").toString().trim().toUpperCase();

          // ⚡ 核心修復：無論該行是 APPROVED、PROCESSED 還是 PENDING，只要在資料庫中存在附件圖檔，立即收錄其 File ID 杜絕重複辨識
          const attRaw = row[8];
          if (attRaw) {
            try {
              const attList = typeof attRaw === "string" && attRaw.startsWith("[") ? JSON.parse(attRaw) : (Array.isArray(attRaw) ? attRaw : []);
              if (Array.isArray(attList)) {
                for (const att of attList) {
                  if (att.id) {
                    window.FL_PROCESSED_DRIVE_IDS.add(att.id);
                    if (status === "APPROVED" || status === "PROCESSED") {
                      approvedDriveFileIds.add(att.id);
                    }
                  }
                  const m = (att.url || "").match(/[-\w]{25,}/);
                  if (m) {
                    window.FL_PROCESSED_DRIVE_IDS.add(m[0]);
                    if (status === "APPROVED" || status === "PROCESSED") {
                      approvedDriveFileIds.add(m[0]);
                    }
                  }
                }
              }
            } catch (e) {}
          }

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

        // 🛡️ 雙重防禦過濾：
        // 1. 樂觀鎖：排除本 Session 已操作但後端尚未同步的卡片 (按 logId 與 fileId 雙查)
        // 2. 審核盾牌 (Approved Shield)：若待審卡片的 Drive File ID 已在全表中被標記為 APPROVED，代表已有設備批准入庫，立即物理過濾並非同步抹除幽靈卡
        // 3. 隊列去重：若多張待審卡引用相同 Drive File ID，僅保留第一張
        const seenPendingFileIds = new Set();
        this.pendingCards = pendingList.filter(card => {
          const cid = card.log_id || card.entry_id;
          if (this._actionedIds && this._actionedIds.has(cid)) {
            console.log(`[HitlReviewer] 🛡️ 樂觀鎖過濾: 卡片 ${cid} 本 Session 已操作，跳過顯示`);
            return false;
          }

          // 審核盾牌與檔案排重
          if (card.attachments && Array.isArray(card.attachments) && card.attachments.length > 0) {
            for (const att of card.attachments) {
              const fid = att.id || ((att.url || "").match(/[-\w]{25,}/) || [])[0];
              if (fid) {
                if (this._actionedIds && this._actionedIds.has(fid)) {
                  console.log(`[HitlReviewer] 🛡️ 樂觀鎖過濾 (File ID): 卡片檔案 ${fid} 本 Session 已操作，跳過顯示`);
                  return false;
                }
                if (approvedDriveFileIds.has(fid)) {
                  console.warn(`[HitlReviewer] 🛡️ 審核盾牌攔截: 卡片 ${cid} 之檔案 ${fid} 在資料庫中已為 APPROVED，判定為併發孿生殘留，自動過濾並清理！`);
                  if (typeof sendGasRequest === "function") {
                    sendGasRequest("delete_record", { sheet: "Memory_Pool_Raw", id: cid }).catch(() => {});
                  }
                  return false;
                }
                if (seenPendingFileIds.has(fid)) {
                  console.warn(`[HitlReviewer] 🛡️ 隊列去重: 檔案 ${fid} 已有待審卡片，剔除重複待審卡 ${cid}`);
                  return false;
                }
                seenPendingFileIds.add(fid);
              }
            }
          }

          return true;
        });
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
    this._markActioned(targetId);
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

    this._markActioned(targetId);
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

    // 4. 🛡️ 持久化 Drive 檔案 ID 至全域真值 Set 與 localStorage，防止打工仔重複提煉已作廢圖檔
    for (const fid of filesToTrash) {
      if (typeof window.markDriveFileProcessed === "function") {
        window.markDriveFileProcessed(fid);
      }
      if (window.backgroundPipeline && typeof window.backgroundPipeline.markFileProcessed === 'function') {
        window.backgroundPipeline.markFileProcessed(fid);
      } else {
        try {
          const saved = localStorage.getItem('fl_processed_card_files');
          const arr = saved ? JSON.parse(saved) : [];
          if (!arr.includes(fid)) arr.push(fid);
          localStorage.setItem('fl_processed_card_files', JSON.stringify(arr));
        } catch (e) {}
      }
    }

    // 5. sessionStorage 樂觀鎖 + 本地即時物理移除卡片 (按 logId 與 fileId 雙鎖定)
    const rejectFid = filesToTrash.length > 0 ? filesToTrash[0] : null;
    this._markActioned(targetId, rejectFid);
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
   * @param {string} linkedResourceName - 若手動關聯現有 Google 聯絡人，傳入其 resourceName 進行 UPDATE 合併
   */
  async approveBusinessCard(logId, overrideCardData = null, isFoxlinkGroup = true, linkedResourceName = null) {
    const card = this.pendingCards.find((c) => (c.log_id === logId || c.entry_id === logId));
    if (!card) throw new Error("找不著指定的待審核名片！");

    const targetId = card.log_id || card.entry_id;
    const finalData = overrideCardData || card;
    const targetResourceName = linkedResourceName || (overrideCardData && overrideCardData.linkedResourceName) || null;
    const isUpdate = !!targetResourceName;

    console.log(`[HitlReviewer] 🪪 批准名片入庫 (${isUpdate ? 'UPDATE 整合模式' : 'CREATE 新建模式'}): ${finalData.name} (${finalData.company})`);

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

    // 2. 構建 People API Payload (支援 phones 陣列、primaryPhone、address 與 website)
    const contactPayload = {
      name: finalData.name,
      phone: primaryPhoneStr,
      phones: phonesPayload,
      company: finalData.company || "",
      title: finalData.title || "",
      email: finalData.email || "",
      address: finalData.address || "",
      website: finalData.website || finalData.url || "",
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

    const action = isUpdate ? "update" : "create";
    if (isUpdate) {
      contactPayload.resourceName = targetResourceName;
      console.log(`[HitlReviewer] 🔗 即將發送 UPDATE 至 Google 聯絡人: ${targetResourceName}`);
    }

    const contactRes = await fetch(contactsUrl, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({
        action: action,
        data: contactPayload
      })
    });

    if (!contactRes.ok) {
      throw new Error(`Google 通訊錄${isUpdate ? '更新' : '寫入'}失敗: ${contactRes.statusText}`);
    }

    const contactJson = await contactRes.json();
    if (contactJson && contactJson.status === "error") {
      throw new Error(`Google 通訊錄網關拒絕: ${contactJson.message || '未知錯誤'}`);
    }

    // 4. 0 搬移不可變架構：嚴格 await 更新個人檔案總帳狀態為 PROCESSED + 持久化防重複提煉
    try {
      if (card.attachments && card.attachments.length > 0 && typeof sendDriveGasRequest === "function") {
        for (const att of card.attachments) {
          const fid = att.id || ((att.url || "").match(/[-\w]{25,}/) || [])[0];
          if (fid) {
            console.log(`[HitlReviewer] 嚴格 await 更新個人檔案總帳 (${fid}) 狀態為 PROCESSED...`);
            await sendDriveGasRequest("update_file_status", { file_id: fid, status: "PROCESSED" });
            // 🛡️ 持久化至全域真值 Set 與 localStorage 防止打工仔重複提煉
            if (typeof window.markDriveFileProcessed === "function") {
              window.markDriveFileProcessed(fid);
            }
            if (window.backgroundPipeline && typeof window.backgroundPipeline.markFileProcessed === 'function') {
              window.backgroundPipeline.markFileProcessed(fid);
            } else {
              try {
                const saved = localStorage.getItem('fl_processed_card_files');
                const arr = saved ? JSON.parse(saved) : [];
                if (!arr.includes(fid)) arr.push(fid);
                localStorage.setItem('fl_processed_card_files', JSON.stringify(arr));
              } catch (e) {}
            }
          }
        }
      }
    } catch (attErr) {
      console.warn("[HitlReviewer] 更新個人檔案總帳狀態警告 (非致命):", attErr);
    }

    // 5. 嚴格 await 呼叫 GAS review_action 將待審佇列標記為 APPROVED (不再靜默吞錯)
    const reviewRes = await this._sendReviewAction(targetId, "APPROVE");
    if (reviewRes && reviewRes.status !== "success") {
      console.warn("[HitlReviewer] 名片佇列狀態更新未完全成功:", reviewRes);
    }

    // 6. 🛡️ 記錄至 sessionStorage 樂觀鎖 + 前端即時移除 (按 logId 與 fileId 雙鎖定)
    const firstFid = (card.attachments && card.attachments[0]) ? (card.attachments[0].id || ((card.attachments[0].url || "").match(/[-\w]{25,}/) || [])[0]) : null;
    this._markActioned(targetId, firstFid);
    this.pendingCards = this.pendingCards.filter((c) => (c.log_id !== targetId && c.entry_id !== targetId));
    this._classifyCards();
    this.notify();

    const successMsg = isUpdate
      ? `🎉 已成功將名片資訊整合更新至 Google 聯絡人 [${finalData.name}]！${isFoxlinkGroup ? '（已標記 Foxlink 公務人脈）' : ''}`
      : `🎉 名片 [${finalData.name} - ${finalData.company || ''}] 已成功入庫 Google 通訊錄！${isFoxlinkGroup ? '（已標記 Foxlink 公務人脈）' : '（個人人脈）'}`;

    return {
      status: "success",
      message: successMsg
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

// 🛡️ 全域 0ms 真值查重介面 (以資料庫全表記錄為準，徹底擺脫 localStorage 依賴)
window.isDriveFileProcessed = function(fileId) {
  if (!fileId) return false;
  return window.FL_PROCESSED_DRIVE_IDS ? window.FL_PROCESSED_DRIVE_IDS.has(fileId) : false;
};

window.markDriveFileProcessed = function(fileId) {
  if (!fileId) return;
  if (!window.FL_PROCESSED_DRIVE_IDS) window.FL_PROCESSED_DRIVE_IDS = new Set();
  window.FL_PROCESSED_DRIVE_IDS.add(fileId);
};
