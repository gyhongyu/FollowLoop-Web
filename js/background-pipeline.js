/**
 * ============================================================================
 * 🤖 FollowLoop 後台打工仔模組化自動巡檢管線 (BackgroundWorkerPipeline v1.0)
 * ============================================================================
 * 
 * 📌 設計核心：
 * 1. 模組化插件架構 (Pluggable Handler Registry)：各類檔案處理器獨立封裝，未來無痛擴充。
 * 2. 靜默背景巡檢 (Silent Background Polling)：定時探測 Raw 箱，零彈窗干擾。
 * 3. 日誌全量輸出 (AI Logger Integration)：所有步驟進度即時灌入 window.FL_AI_LOGGER。
 * 4. 併發防禦鎖 (Concurrency Lock)：嚴格避免多重輪詢搶工或重複處理。
 * ============================================================================
 */

class BackgroundWorkerPipeline {
  constructor() {
    this.handlers = new Map(); // folderName -> Handler instance
    this.isPolling = false;
    this.isPaused = false; // 支援手動或本地 AI 獨佔模式暫停
    this.pollingInterval = null;
    this.pollIntervalMs = 60000; // 預設 60 秒巡檢一次
    this.processingFiles = new Set(); // 正在處理中的 File ID 記憶體鎖
    this.cooldownFiles = new Map(); // fileId -> expireTimestamp (低置信度/失敗冷卻 10 分鐘，防死循環空耗 Token)
  }

  /**
   * 手動暫停背景巡檢 (提供本機 AI 代理治理時之互斥防禦)
   */
  pause() {
    this.isPaused = true;
    console.log("[WorkerPipeline] ⏸️ 巡檢管線已手動暫停");
    if (window.FL_AI_LOGGER) {
      window.FL_AI_LOGGER.log("巡檢管線狀態", "⏸️ 已暫停 (本地 AI 獨佔或手動維護模式)");
    }
  }

  /**
   * 恢復背景巡檢
   */
  resume() {
    this.isPaused = false;
    console.log("[WorkerPipeline] ▶️ 巡檢管線已恢復執行");
    if (window.FL_AI_LOGGER) {
      window.FL_AI_LOGGER.log("巡檢管線狀態", "▶️ 背景巡檢已恢復 (60s 週期)");
    }
  }

  /**
   * 註冊子任務處理器 (Plugin Registration)
   * @param {string} folderName - 如 "BusinessCards", "Vouchers", "ChatScreenshots"
   * @param {Object} handler - 實作了 process(fileItem, context) 的處理器實例
   */
  registerHandler(folderName, handler) {
    if (!folderName || !handler || typeof handler.processBatch !== 'function' && typeof handler.process !== 'function') {
      console.warn(`[WorkerPipeline] 註冊失敗: handler 必須實作 process 或 processBatch 方法`, folderName);
      return;
    }
    this.handlers.set(folderName.toLowerCase(), handler);
    console.log(`[WorkerPipeline] ✅ 成功註冊後台處理模組: [${folderName}]`);
  }

  /**
   * 啟動背景定時巡檢
   * @param {number} intervalMs 
   */
  startPolling(intervalMs = 60000) {
    this.pollIntervalMs = intervalMs;
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
    }

    console.log(`[WorkerPipeline] 🚀 啟動打工仔後台巡檢引擎 (間隔: ${this.pollIntervalMs / 1000}s)`);
    
    // 首次啟動延遲 5 秒後執行第一次巡檢，避開首頁載入高峰
    setTimeout(() => {
      this.pollOnce();
    }, 5000);

    this.pollingInterval = setInterval(() => {
      this.pollOnce();
    }, this.pollIntervalMs);
  }

  /**
   * 停止巡檢
   */
  stopPolling() {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
    console.log(`[WorkerPipeline] ⏸️ 暫停打工仔後台巡檢引擎`);
  }

  /**
   * 執行單次全箱巡檢
   */
  async pollOnce() {
    if (this.isPolling || this.isPaused) {
      if (this.isPolling) console.log(`[WorkerPipeline] 上一輪巡檢尚未結束，跳過本次觸發`);
      return;
    }

    this.isPolling = true;

    try {
      // 依序檢查已註冊的各子箱
      for (const [folderKey, handler] of this.handlers.entries()) {
        try {
          await this.inspectFolder(folderKey, handler);
        } catch (folderErr) {
          console.warn(`[WorkerPipeline] 巡檢箱 [${folderKey}] 異常:`, folderErr);
        }
      }
    } finally {
      this.isPolling = false;
    }
  }

  /**
   * 巡檢單一子箱並派發處理
   */
  async inspectFolder(folderName, handler) {
    // 1. 取得 Google Drive OAuth Token 與 FollowLoop_RawInputs Folder ID
    if (typeof sendDriveGasRequest !== "function") return;
    const tokenRes = await sendDriveGasRequest("get_drive_token", {});
    if (!tokenRes || tokenRes.status !== "success" || !tokenRes.token) {
      return;
    }

    const token = tokenRes.token;
    const parentRawFolderId = tokenRes.folder_id;

    // 2. 尋找子資料夾 ID
    const qFolder = encodeURIComponent(`name = '${folderName}' and '${parentRawFolderId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`);
    const folderSearchRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${qFolder}`, {
      headers: { "Authorization": `Bearer ${token}` }
    });

    if (!folderSearchRes.ok) return;
    const folderData = await folderSearchRes.json();
    if (!folderData.files || folderData.files.length === 0) return;

    const subfolderId = folderData.files[0].id;

    // 3. 列出該子資料夾下的檔案 (非資料夾、未丟垃圾桶)
    const qFiles = encodeURIComponent(`'${subfolderId}' in parents and mimeType != 'application/vnd.google-apps.folder' and trashed = false`);
    const filesRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${qFiles}&fields=files(id,name,mimeType,size,createdTime)&orderBy=createdTime`, {
      headers: { "Authorization": `Bearer ${token}` }
    });

    if (!filesRes.ok) return;
    const filesData = await filesRes.json();
    const files = filesData.files || [];

    if (files.length === 0) return;

    // 4. 將未被鎖定且未在冷卻期中的檔案交由 handler 處理
    const context = {
      token,
      parentRawFolderId,
      subfolderId,
      folderName,
      pipeline: this
    };

    const now = Date.now();
    const isFileAvailable = (f) => {
      if (this.processingFiles.has(f.id)) return false;
      const cooldownUntil = this.cooldownFiles.get(f.id);
      if (cooldownUntil && cooldownUntil > now) {
        return false;
      }
      return true;
    };

    if (typeof handler.processBatch === 'function') {
      // 支援成對 / 批次處理模式 (如名片正反面)
      const availableFiles = files.filter(isFileAvailable);
      if (availableFiles.length > 0) {
        availableFiles.forEach(f => this.processingFiles.add(f.id));
        try {
          await handler.processBatch(availableFiles, context);
        } finally {
          availableFiles.forEach(f => this.processingFiles.delete(f.id));
        }
      }
    } else if (typeof handler.process === 'function') {
      // 單檔逐一處理
      for (const file of files) {
        if (!isFileAvailable(file)) continue;
        this.processingFiles.add(file.id);
        try {
          await handler.process(file, context);
        } catch (err) {
          console.error(`[WorkerPipeline] 處理檔案 (${file.name}) 失敗:`, err);
        } finally {
          this.processingFiles.delete(file.id);
        }
      }
    }
  }
}

/**
 * ============================================================================
 * 🪪 名片處理模組 (BusinessCardHandler)
 * ============================================================================
 */
class BusinessCardHandler {
  constructor() {
    this.workerClient = null;
  }

  getWorker() {
    if (!this.workerClient && typeof OpenRouterWorkerClient !== "undefined") {
      this.workerClient = new OpenRouterWorkerClient({
        apiKey: typeof getOpenRouterApiKey === "function" ? getOpenRouterApiKey() : (window.CONFIG && CONFIG.OPENROUTER_DEFAULT_KEY),
        gasUrl: CONFIG.OPENROUTER_WORKER_GAS_URL
      });
    } else if (this.workerClient) {
      // 確保動態讀取最新 localStorage 或配置 key
      this.workerClient.apiKey = typeof getOpenRouterApiKey === "function" ? getOpenRouterApiKey() : (window.CONFIG && CONFIG.OPENROUTER_DEFAULT_KEY);
    }
    return this.workerClient;
  }

  /**
   * 批次/成對處理名片清單
   */
  async processBatch(files, context) {
    // 依時間戳或命名分組 (成對 front/back 或單張獨立名片)
    const cardGroups = this.groupCards(files);

    for (const group of cardGroups) {
      await this.processCardGroup(group, context);
    }
  }

  /**
   * 將名片檔案依時間戳或前綴自動分組 (成對 front/back)
   */
  groupCards(files) {
    const groups = {};
    files.forEach(f => {
      // 例如 card_20260902_153431_front.jpeg -> key: card_20260902_153431
      const match = f.name.match(/^(card_\d{8}_\d{6})_(front|back|p\d+)/i);
      const key = match ? match[1] : f.id;
      if (!groups[key]) groups[key] = [];
      groups[key].push(f);
    });
    return Object.values(groups);
  }

  /**
   * 處理單組名片 (1張或2張正反面)
   */
  async processCardGroup(fileList, context) {
    const names = fileList.map(f => f.name).join(" + ");
    const isPaired = fileList.length > 1;
    const taskTitle = isPaired ? `🪪 名片成對自動識別與建檔 (${fileList.length} 面)` : `🪪 名片自動識別與建檔 (${fileList[0].name})`;

    if (window.FL_AI_LOGGER) {
      window.FL_AI_LOGGER.startTask(taskTitle, names);
      window.FL_AI_LOGGER.log("下載名片圖檔", `取得 Google Drive 檔案二進位資料...`);
    }

    try {
      // 1. 下載圖片轉 Base64 Data URL
      const imagesDataUrls = [];
      for (const file of fileList) {
        const dataUrl = await this.fetchDriveImageDataUrl(file.id, context.token);
        if (dataUrl) imagesDataUrls.push({ name: file.name, id: file.id, dataUrl });
      }

      if (imagesDataUrls.length === 0) {
        throw new Error("無法從 Google Drive 下載名片圖檔");
      }

      // 2. 調用打工仔 Vision 進行結構化提煉
      if (window.FL_AI_LOGGER) {
        window.FL_AI_LOGGER.log("打工仔 Vision 識別", `調度免費大模型隊列提煉名片欄位...`);
      }

      const cardInfo = await this.extractCardInfo(imagesDataUrls);

      // 🛡️ 置信度與真偽門閥：校驗打工仔提取之名片資料，防止幻覺或殘缺資料污染 Google 通訊錄
      const confidence = this.validateConfidence(cardInfo);
      if (!confidence.valid) {
        // 設定 10 分鐘冷卻期，避免 60 秒定時輪詢無限空耗 Token
        const cooldownUntil = Date.now() + (10 * 60 * 1000);
        fileList.forEach(f => {
          if (context.pipeline && context.pipeline.cooldownFiles) {
            context.pipeline.cooldownFiles.set(f.id, cooldownUntil);
          }
        });

        throw new Error(`[🛡️ 低置信度防禦攔截] ${confidence.reason}。已安全保留在 RawInputs 箱，杜絕髒資料污染通訊錄！等待本地 AI 代理或人工審核。`);
      }

      if (window.FL_AI_LOGGER) {
        window.FL_AI_LOGGER.log("提煉結構化成果", `${cardInfo.name} | ${cardInfo.company || '無公司'} | ${cardInfo.phone || '無電話'}`);
      }

      // 3. 組裝 Drive 原圖外鏈與附件資訊
      const attachmentLinks = fileList.map((f, idx) => {
        const label = idx === 0 ? "正面" : "背面";
        return {
          title: `名片圖檔 (${label})`,
          url: `https://drive.google.com/file/d/${f.id}/view`,
          id: f.id,
          name: f.name
        };
      });

      // 4. 🪪 攔截直接寫入通訊錄！改為寫入 CARDS_QUEUE 待審核中轉隊列 (0-Deploy SSOT)
      if (window.FL_AI_LOGGER) {
        window.FL_AI_LOGGER.log("呈報 HITL 待審隊列", `寫入名片待審隊列: ${cardInfo.name}...`);
      }

      const now = new Date();
      const pad = (n) => String(n).padStart(2, "0");
      const ymd = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
      const logId = `CARD_${ymd}_${Math.random().toString(36).substring(2, 6)}`;
      const cleanTimestamp = now.toISOString();

      const detailsPayload = JSON.stringify({
        company: cardInfo.company || "",
        email: cardInfo.email || "",
        address: cardInfo.address || "",
        notes: cardInfo.notes || ""
      });

      const safePhone = cardInfo.phone ? (String(cardInfo.phone).startsWith("+") ? `'${cardInfo.phone}` : String(cardInfo.phone)) : "";

      // 100% 精確對齊 11 欄 RAW_FIELDS (project_tag 鎖定 CARDS_QUEUE)
      const rawRow = [
        logId,                                            // 0. A log_id
        cleanTimestamp,                                   // 1. B timestamp
        CONFIG.CARDS_QUEUE_TAG || "CARDS_QUEUE",          // 2. C project_tag (專屬隔離標籤)
        cardInfo.name,                                    // 3. D entity_target (姓名)
        cardInfo.title || "商務窗口",                      // 4. E target_purpose (職稱)
        "Foxlink",                                        // 5. F our_advantages (預設公務標籤)
        safePhone,                                        // 6. G action_taken (電話號碼，防 Google Sheet 公式報錯)
        detailsPayload,                                   // 7. H update_log (公司/Email/地址/備註 JSON)
        JSON.stringify(attachmentLinks),                  // 8. I attachment_links (原圖外鏈與 File ID)
        "0.95",                                           // 9. J confidence_score
        "PENDING_REVIEW"                                  // 10. K agent_status
      ];

      // ☁️ 持久化寫入雲端 Memory_Pool_Raw (CARDS_QUEUE)
      if (typeof sendGasRequest === "function") {
        await sendGasRequest("batch_append_raw", {
          sheet: "Memory_Pool_Raw",
          rows: [rawRow]
        });
      }

      // 📦 【關鍵生命週期閉環】立即將檔案移入 Pending_Review/ 隔離箱，防止巡檢器重複提煉！
      if (context.token) {
        for (const file of fileList) {
          try {
            await this.moveToPendingReview(file.id, context.token, context.parentRawFolderId);
          } catch (mErr) {
            console.warn(`[BusinessCardHandler] 搬移檔案 ${file.name} 至 Pending_Review 略過或異常:`, mErr);
          }
        }
      }

      // ⚡ 即時注入前端 HITL 待審核佇列 (0ms 反應)
      if (window.hitlReviewer) {
        window.hitlReviewer.addCardDirectly({
          entry_id: logId,
          log_id: logId,
          timestamp: cleanTimestamp,
          source_type: "🪪 名片辨識",
          is_card: true,
          project_tag: CONFIG.CARDS_QUEUE_TAG || "CARDS_QUEUE",
          name: cardInfo.name,
          title: cardInfo.title || "商務窗口",
          company: cardInfo.company || "",
          phone: cardInfo.phone || "",
          email: cardInfo.email || "",
          address: cardInfo.address || "",
          notes: cardInfo.notes || "",
          attachment_links: JSON.stringify(attachmentLinks),
          attachments: attachmentLinks,
          confidence_score: "0.95",
          status: "PENDING_REVIEW"
        });
      }

      if (window.FL_AI_LOGGER) {
        window.FL_AI_LOGGER.completeTask(`✅ 名片已呈報待審隊列: [${cardInfo.name} - ${cardInfo.company || ''}] (等待人類審核入庫)`);
      }

    } catch (err) {
      console.warn(`[BusinessCardHandler] 處理名片組失敗:`, err);
      if (window.FL_AI_LOGGER) {
        window.FL_AI_LOGGER.failTask(`名片處理失敗: ${err.message} (保留在待處理箱待下次重試)`);
      }
    }
  }

  /**
   * 🛡️ 置信度與真偽門閥：校驗打工仔提取之名片資料，防止幻覺或殘缺資料污染 Google 通訊錄
   */
  validateConfidence(cardInfo) {
    if (!cardInfo) {
      return { valid: false, reason: "提取結果為空" };
    }

    const name = (cardInfo.name || "").trim();
    if (!name || name.length < 2) {
      return { valid: false, reason: `姓名為空或長度不足 (${name})` };
    }

    if (/^(unknown|none|n\/a|null|undefined|未知|無|名片|未提供|待確認|正面|背面|先生|小姐|主管|經理)$/i.test(name)) {
      return { valid: false, reason: `姓名為無效佔位符 (${name})` };
    }

    const phone = (cardInfo.phone || "").trim();
    const email = (cardInfo.email || "").trim();
    const company = (cardInfo.company || "").trim();

    const digitsOnly = phone.replace(/\D/g, "");
    const hasValidPhone = digitsOnly.length >= 6; // 包含國碼或市話至少 6 位
    const hasValidEmail = email.includes("@") && email.includes(".");
    const hasValidCompany = company.length >= 2 && !/^(unknown|none|n\/a|未知|無|公司)$/i.test(company);

    // 至少必須有「電話」、「信箱」或「具體公司」任一有效錨點
    if (!hasValidPhone && !hasValidEmail && !hasValidCompany) {
      return { valid: false, reason: `缺乏可信的聯繫方式或公司名稱 (Phone: '${phone}', Email: '${email}', Company: '${company}')` };
    }

    return { valid: true, reason: "OK" };
  }

  /**
   * 從 Google Drive API 讀取圖片並轉為 Data URL
   */
  async fetchDriveImageDataUrl(fileId, token) {
    const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
      headers: { "Authorization": `Bearer ${token}` }
    });
    if (!res.ok) throw new Error(`讀取 Drive 檔案失敗: ${res.statusText}`);
    const blob = await res.blob();

    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  /**
   * 調用 Vision 大模型解析名片
   */
  async extractCardInfo(images) {
    const worker = this.getWorker();
    const prompt = `請詳細辨識圖片中的名片內容，並嚴格提取為純 JSON 物件：
{
  "name": "聯絡人姓名 (若有多人請取主要名片持有人)",
  "company": "公司或機構名稱",
  "title": "職稱 / 頭銜",
  "phone": "電話或手機號碼 (包含國碼如 +91 或 +886)",
  "email": "電子郵件信箱",
  "address": "公司地址 / 據點",
  "notes": "業務範疇 / 服務項目 / 統編或重要備註"
}
注意：若為正反兩面，請將兩面資訊融合提取。必須直接輸出純 JSON，嚴禁包含 markdown 標籤。`;

    const userContent = [{ type: "text", text: prompt }];
    images.forEach(img => {
      userContent.push({
        type: "image_url",
        image_url: { url: img.dataUrl }
      });
    });

    const res = await worker.call({
      task: 'vision',
      isVision: true,
      temperature: 0.1,
      messages: [{ role: "user", content: userContent }]
    });

    const raw = typeof res === "string" ? res : (res.content || "");
    let clean = raw.replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/```(?:json)?/gi, "").replace(/```/g, "").trim();
    const match = clean.match(/\{[\s\S]*\}/);
    if (match) clean = match[0];
    return JSON.parse(clean);
  }

  /**
   * 寫入 Google 聯絡人 (直通 google_contacts_gateway GAS)
   */
  async saveToGoogleContacts(contactData) {
    const contactsGasUrl = CONFIG.CONTACTS_GATEWAY_URL || "https://script.google.com/macros/s/AKfycbyKnxJ2waOYny88XQH_65GagqVpcbBGVh7vCMwIT4JwowO2u__k6CUk1NDbTDrs-oqQ/exec";
    
    // 先查重 (search)
    try {
      const searchRes = await fetch(contactsGasUrl, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({
          action: "search",
          data: { query: contactData.name || contactData.phone, pageSize: 5 }
        })
      });

      if (searchRes.ok) {
        const searchJson = await searchRes.json();
        const existing = (searchJson.data && searchJson.data.contacts) || [];
        if (existing.length > 0) {
          // 已存在相同聯絡人，執行 update 補充 notes
          const target = existing[0];
          await fetch(contactsGasUrl, {
            method: "POST",
            headers: { "Content-Type": "text/plain;charset=utf-8" },
            body: JSON.stringify({
              action: "update",
              data: {
                resourceName: target.resourceName,
                notes: `${target.notes || ''}\n${contactData.notes}`.trim()
              }
            })
          });
          return;
        }
      }
    } catch (searchErr) {
      console.warn("[BusinessCardHandler] 聯絡人查重跳過:", searchErr);
    }

    // 建立新聯絡人
    const createRes = await fetch(contactsGasUrl, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({
        action: "create",
        data: contactData
      })
    });

    if (!createRes.ok) {
      throw new Error(`寫入 Google 聯絡人失敗: ${createRes.statusText}`);
    }
  }

  /**
   * 將 Drive 檔案自 Raw 箱搬移至 Projects_Attachments/BusinessCards/ (無損 PATCH parents)
   */
  async archiveFileToAttachments(fileId, token) {
    // 1. 取得 Projects_Attachments 根資料夾 ID
    const targetFolderName = CONFIG.DRIVE_ATTACHMENTS_FOLDER_NAME || "Projects_Attachments";
    const qTarget = encodeURIComponent(`name = '${targetFolderName}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`);
    const targetRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${qTarget}`, {
      headers: { "Authorization": `Bearer ${token}` }
    });

    let rootAttachmentsId = CONFIG.DRIVE_ATTACHMENTS_FOLDER_ID;
    if (targetRes.ok) {
      const targetData = await targetRes.json();
      if (targetData.files && targetData.files.length > 0) {
        rootAttachmentsId = targetData.files[0].id;
      }
    }

    // 2. 尋找或建立 Projects_Attachments 下的 BusinessCards 子資料夾
    let finalTargetId = rootAttachmentsId;
    if (rootAttachmentsId) {
      const qSub = encodeURIComponent(`name = 'BusinessCards' and '${rootAttachmentsId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`);
      const subRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${qSub}`, {
        headers: { "Authorization": `Bearer ${token}` }
      });
      if (subRes.ok) {
        const subData = await subRes.json();
        if (subData.files && subData.files.length > 0) {
          finalTargetId = subData.files[0].id;
        } else {
          // 建立 BusinessCards 子資料夾
          const createRes = await fetch(`https://www.googleapis.com/drive/v3/files`, {
            method: "POST",
            headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              name: "BusinessCards",
              mimeType: "application/vnd.google-apps.folder",
              parents: [rootAttachmentsId]
            })
          });
          if (createRes.ok) {
            const newFolder = await createRes.json();
            finalTargetId = newFolder.id;
          }
        }
      }
    }

    // 3. 取得檔案現有 parents
    const fileRes = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?fields=parents`, {
      headers: { "Authorization": `Bearer ${token}` }
    });

    let prevParents = "";
    if (fileRes.ok) {
      const fileData = await fileRes.json();
      if (fileData.parents) prevParents = fileData.parents.join(",");
    }

    // 4. 執行 PATCH 搬移至 BusinessCards 子資料夾
    const moveRes = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?addParents=${finalTargetId}&removeParents=${prevParents}&fields=id,parents`, {
      method: "PATCH",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json"
      }
    });

    if (!moveRes.ok) {
      throw new Error(`Drive 搬移檔案失敗: ${moveRes.statusText}`);
    }
  }

  /**
   * 📦 將名片自待處理區搬移至 Pending_Review/ 隔離箱 (自動尋找或動態建立)
   */
  async moveToPendingReview(fileId, token, parentRawFolderId) {
    if (!parentRawFolderId) return;

    // 1. 尋找或自動建立 FollowLoop_RawInputs 下的 Pending_Review 子資料夾
    let pendingFolderId = null;
    const qPending = encodeURIComponent(`name = 'Pending_Review' and '${parentRawFolderId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`);
    const searchRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${qPending}`, {
      headers: { "Authorization": `Bearer ${token}` }
    });

    if (searchRes.ok) {
      const sData = await searchRes.json();
      if (sData.files && sData.files.length > 0) {
        pendingFolderId = sData.files[0].id;
      } else {
        // 動態建立 Pending_Review 子資料夾
        const createRes = await fetch(`https://www.googleapis.com/drive/v3/files`, {
          method: "POST",
          headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            name: "Pending_Review",
            mimeType: "application/vnd.google-apps.folder",
            parents: [parentRawFolderId]
          })
        });
        if (createRes.ok) {
          const newFolder = await createRes.json();
          pendingFolderId = newFolder.id;
        }
      }
    }

    if (!pendingFolderId) return;

    // 2. 取得該檔案的現有 parents
    const fileRes = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?fields=parents`, {
      headers: { "Authorization": `Bearer ${token}` }
    });
    let prevParents = "";
    if (fileRes.ok) {
      const fData = await fileRes.json();
      if (fData.parents) prevParents = fData.parents.join(",");
    }

    // 3. 執行 PATCH 搬移至 Pending_Review (自 BusinessCards/ 拔除)
    await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?addParents=${pendingFolderId}&removeParents=${prevParents}&fields=id,parents`, {
      method: "PATCH",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json"
      }
    });
  }
}

// 實例化全域背景管線
window.FL_BACKGROUND_PIPELINE = new BackgroundWorkerPipeline();
window.FL_BACKGROUND_PIPELINE.registerHandler("BusinessCards", new BusinessCardHandler());

// 網頁載入後自動啟動背景定時巡檢
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    window.FL_BACKGROUND_PIPELINE.startPolling(60000);
  });
} else {
  window.FL_BACKGROUND_PIPELINE.startPolling(60000);
}
