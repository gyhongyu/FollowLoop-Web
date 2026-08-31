/**
 * FollowLoop-Web OpenRouter 外部打工仔多模態提煉模組 (v2.0 - 打工仔中央總帳版)
 * 專為手機/公網 Web 端設計：
 * 1. 雙層 Guardrail 防護（0ms 純問候/測試詞攔截 + LLM 語意過濾）
 * 2. 純 URL 智慧嗅探（自動識別 Google Drive/Docs/Sheets/GitHub 並轉為待歸檔附件）
 * 3. 多模態支援：
 *    - 文字速記提煉 (Text Mode)
 *    - 圖片/截圖 OCR 提煉 (Vision Mode - 自動調用 200B MiniMax-M3 / 31B Gemma-4 等)
 *    - 音訊語音理解 (Audio Mode)
 * 4. 接入 Google Sheet 中央模型總帳，享受參量秒排序與 404/429 智能自癒
 */

class OpenRouterExtractor {
  constructor() {
    this.worker = new OpenRouterWorkerClient({
      apiKey: getOpenRouterApiKey(),
      gasUrl: CONFIG.OPENROUTER_WORKER_GAS_URL
    });

    // 純問候與測試無效詞黑名單
    this.noiseKeywords = [
      "hi", "hello", "hey", "test", "testing", "ok", "okay",
      "你好", "哈囉", "嗨", "測試", "收到", "好的", "在嗎", "早安", "午安", "晚安",
      "123", "1234", "111", "aaa", "..."
    ];
  }

  /**
   * 🥇 第一層 Guardrail：前端 0ms 秒拒純噪音與無效字串
   * @param {string} text 
   * @returns {{isValid: boolean, message?: string}}
   */
  checkInputGuardrail(text) {
    if (!text || typeof text !== "string") {
      return { isValid: false, message: "請輸入速記內容！" };
    }

    const clean = text.trim();
    if (clean.length === 0) {
      return { isValid: false, message: "請輸入速記內容！" };
    }

    // 若為 URL 則直接放行
    if (this.isPureUrl(clean)) {
      return { isValid: true };
    }

    // 檢查字數過短
    const pureAlphaNum = clean.replace(/[\s\p{P}]/gu, "");
    if (pureAlphaNum.length < 2) {
      return { isValid: false, message: "💡 輸入字數過短，請輸入具體的會議結論、客戶動態或待辦事項。" };
    }

    // 檢查純問候/測試詞黑名單
    const lower = clean.toLowerCase();
    if (this.noiseKeywords.includes(lower)) {
      return { isValid: false, message: "💡 內容僅為打招呼或測試字詞，無實質商務情報，請輸入具體商務事實。" };
    }

    return { isValid: true };
  }

  /**
   * 🌐 檢查輸入是否為純 URL 網址
   * @param {string} text 
   * @returns {boolean}
   */
  isPureUrl(text) {
    const clean = text.trim();
    if (!clean.startsWith("http://") && !clean.startsWith("https://")) {
      return false;
    }
    try {
      new URL(clean);
      return !clean.includes(" ") && !clean.includes("\n");
    } catch (e) {
      return false;
    }
  }

  /**
   * 🌐 純 URL 智慧嗅探與屬性推導 (無需呼叫 LLM，0ms 解析)
   * @param {string} url 
   * @param {Array} projectList 
   * @returns {Object}
   */
  sniffUrlDetails(url, projectList = []) {
    let category = "Web Link";
    let title = "專案參考雲端資源";
    const lower = url.toLowerCase();

    if (lower.includes("spreadsheets") || lower.includes("sheets.google")) {
      category = "Google Sheets";
      title = "Google Sheets 雲端試算表";
    } else if (lower.includes("document") || lower.includes("docs.google")) {
      category = "Google Docs";
      title = "Google Docs 雲端文檔";
    } else if (lower.includes("drive.google.com")) {
      category = "Google Drive";
      title = "Google Drive 雲端檔案/資料夾";
    } else if (lower.includes("github.com")) {
      category = "GitHub";
      title = "GitHub 程式碼倉庫/專案鏈結";
    }

    const attLink = JSON.stringify([{
      title: title,
      url: url,
      category: category,
      created_at: new Date().toISOString()
    }]);

    return {
      status: "success",
      is_valid: true,
      model_used: "url-sniffer (0ms)",
      project_tag: "NEW_UNCLASSIFIED",
      entity_target: "外部雲端資源 (待指定客戶)",
      target_purpose: `登記外部專案參考資源 [${category}]`,
      action_taken: `分享雲端參考鏈結與資料 (${category})`,
      update_log: `使用者分享外部雲端參考資源：\n• 資源鏈結: ${url}\n• 資源類型: ${category}\n• 請於審核時確認歸屬專案並批准歸檔至專案附件庫。`,
      attachment_links: attLink,
      confidence_score: 1.0
    };
  }

  /**
   * 📝 組裝工業級全方位 System Prompt (動態時間錨點、防腦補、防幻覺、相對時間精確推算)
   * @param {Array} projectList 
   * @param {string} mode - 'text' | 'vision' | 'audio'
   * @returns {string}
   */
  buildSystemPrompt(projectList = [], mode = "text") {
    let projectsContext = "";
    if (Array.isArray(projectList) && projectList.length > 0) {
      projectsContext = projectList
        .map(p => `- 標籤: "${p.tag}", 客戶/主體: "${p.acct || ''}", 專案名: "${p.name || ''}"`)
        .join("\n");
    } else {
      projectsContext = "- 標籤: 'Item_2_01', 客戶: 'VVDN Technologies'\n- 標籤: 'Item_3_01', 客戶: 'DELTA ELECTRONICS'\n- 標籤: 'Item_5_01', 客戶: 'SSSTC'\n- 標籤: 'Item_6_01', 客戶: 'Sensetek'";
    }

    const now = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    const todayStr = `${now.getFullYear()}/${pad(now.getMonth() + 1)}/${pad(now.getDate())}`;
    const daysOfWeek = ["日", "一", "二", "三", "四", "五", "六"];
    const dayOfWeekStr = `星期${daysOfWeek[now.getDay()]}`;

    let modalityIntro = "使用者的輸入是隨手記錄的商務會議、對話、動態或工作速記。";
    if (mode === "vision") {
      modalityIntro = "使用者上傳了一張圖片/截圖（可能包含名片、報價單、技術規格圖、會議白板或聊天對話截圖）。請結合圖片中的 OCR 文字與視覺細節進行專業商務提煉。";
    } else if (mode === "audio") {
      modalityIntro = "使用者提供了一段商務錄音/語音訊息。請轉寫並解析音訊中的核心商務對話與結論。";
    } else if (mode === "document") {
      modalityIntro = "使用者上傳了一份正式商務/專案文檔（如 PDF、技術評估、專案提案、規格書、合約或改善報告）。文檔通常包含背景訴求、審批申請、技術指標或改善方案，請務必深入萃取其中的核心事實、決策、行動與結論，嚴禁將其視為無效噪音！";
    }

    return `你是一位頂級企業商務情報提煉秘書（FollowLoop 核心提煉引擎）。${modalityIntro}
你的任務是將輸入提煉為標準結構化 JSON，並嚴格遵守以下 FollowLoop 核心天條：

【⏰ 系統基準時間錨點】：
當前系統基準日期為：${todayStr} (${dayOfWeekStr})。

【🚨 FollowLoop 核心天條 (Core Invariants)】：
1. 嚴格忠於事實：嚴禁無中生有編造未提及的人名、會議細節、價格、時間或原因！
2. ⏰ 素材時間物理真值與精確推算：
   - 若素材中包含明確發生日期、申請日期或相對時間詞（如『昨天』、『8/25』）：
   - 必須精確錨定推算出事件發生的真實西元日期（格式：YYYY/MM/DD）。
   - 強制在 update_log 輸出的最開頭第一行第一句標註該西元日期（例如：'2026/08/27 客戶動態：...' 或 '2026/08/27 提案摘要：...'）。
   - 嚴禁在流水帳記要中殘留模糊的『昨天』、『今天』、『前天』字眼！
3. 🎯 文檔與情報有效性判定：
   - 只要輸入包含任何具體業務事實、專案申請、技術指標、客戶訴求或會議進展，**必須視為有效情報 (is_valid: true)**。
   - 僅當輸入為純粹無意義亂碼、空白或測試字元（如 'asdf', '123'）時，才輸出 {"is_valid": false, "reason": "純測試無意義字元"}。
4. 💎 專案與個人流水帳映射：
   - 比對下方【已知專案主檔字典】，若明確命中客戶/窗口/產品（如 SSD、線材、VVDN、SSSTC）則填入對應 project_tag。
   - 若為自我工作備忘、跨專案行程，映射至 Item_1_01；若為全新客戶或暫無對應專案，填寫 "NEW_UNCLASSIFIED"！
5. 📝 update_log 輸出規範：
   - 必須以標準繁體中文撰寫，條理分明（包含事實背景、核心訴求/決策、下一步行動）。
   - 嚴禁包含任何 http/https 網址（網址由附件庫接管）。
6. 格式約束：必須直接輸出純 JSON 物件，嚴禁包含 markdown 代碼塊標記（如 \`\`\`json）。

【已知專案主檔字典】：
${projectsContext}

【標準 JSON 輸出欄位】：
{
  "is_valid": true,
  "project_tag": "若命中已知專案填入標籤(如 Item_2_01 或 Item_2_02)；否則填寫 'NEW_UNCLASSIFIED'",
  "entity_target": "權責對象/客戶公司名稱或主要窗口(例如：VVDN Technologies / Manikandan M)",
  "target_purpose": "對方訴求/商機背景/目的摘要(一句話)",
  "action_taken": "最新行動/進展摘要(一句話)",
  "update_log": "帶精確西元日期開頭(如 2026/08/27 ...)、條理分明、客觀專業的繁體中文條列式商業流水帳記要(包含事實與結論)",
  "confidence_score": 0.85
}`;
  }

  /**
   * 廣播即時日誌事件
   */
  logProgress(step, details, status = "running") {
    if (window.FL_AI_LOGGER && typeof window.FL_AI_LOGGER.log === "function") {
      window.FL_AI_LOGGER.log(step, details, status);
    }
  }

  /**
   * 清理並解析大模型回傳的 JSON
   */
  parseJsonResponse(rawText) {
    let clean = (rawText || "").trim();
    if (clean.startsWith("```json")) clean = clean.slice(7);
    if (clean.startsWith("```")) clean = clean.slice(3);
    if (clean.endsWith("```")) clean = clean.slice(0, -3);
    clean = clean.trim();

    const match = clean.match(/\{[\s\S]*\}/);
    if (match) clean = match[0];

    return JSON.parse(clean);
  }

  /**
   * 1. 純文字提煉入口
   * @param {string} userText 
   * @param {Array} projectList 
   * @returns {Promise<Object>}
   */
  async extract(userText, projectList = []) {
    // 1. 🥇 第一層 Guardrail 檢測
    const guard = this.checkInputGuardrail(userText);
    if (!guard.isValid) {
      throw new Error(guard.message || "輸入無效！");
    }

    const cleanText = userText.trim();

    // 2. 🌐 純 URL 智慧嗅探 (0ms 直接轉為待歸檔附件)
    if (this.isPureUrl(cleanText)) {
      console.log("[OpenRouterExtractor] 偵測到純 URL 輸入，啟動智慧附件嗅探器...");
      return this.sniffUrlDetails(cleanText, projectList);
    }

    // 3. 🤖 打工仔中央總帳調度
    this.worker.apiKey = getOpenRouterApiKey();
    const systemPrompt = this.buildSystemPrompt(projectList, "text");

    try {
      console.log("[OpenRouterExtractor] 調用打工仔中央總帳 (Task: text)...");
      const res = await this.worker.call({
        task: 'text',
        temperature: 0.2,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: cleanText }
        ]
      });

      const parsed = this.parseJsonResponse(res.content);

      if (parsed.is_valid === false) {
        throw new Error("AI 判定此內容無具體商務事實或動態，已取消建立卡片。");
      }

      let tag = parsed.project_tag || "NEW_UNCLASSIFIED";
      if (tag !== "NEW_UNCLASSIFIED") {
        const exists = projectList.some(p => p.tag === tag);
        if (!exists) tag = "NEW_UNCLASSIFIED";
      }

      return {
        status: "success",
        is_valid: true,
        model_used: res.model,
        params_b: res.params_b,
        project_tag: tag,
        entity_target: parsed.entity_target || "未指定客戶 (待編輯)",
        target_purpose: parsed.target_purpose || "",
        action_taken: parsed.action_taken || "最新跟進紀錄",
        update_log: parsed.update_log || cleanText,
        attachment_links: "",
        confidence_score: parsed.confidence_score || 0.85
      };
    } catch (err) {
      if (err.message.includes("AI 判定此內容無具體商務事實")) {
        throw err;
      }
      console.warn("[OpenRouterExtractor] 打工仔呼叫異常，啟用本地備援降級:", err.message);
      return {
        status: "fallback",
        is_valid: true,
        model_used: "local-fallback",
        project_tag: "NEW_UNCLASSIFIED",
        entity_target: "未指定客戶 (待編輯)",
        target_purpose: "",
        action_taken: "速記備忘",
        update_log: cleanText,
        attachment_links: "",
        confidence_score: 0.5,
        error_message: err.message
      };
    }
  }

  /**
   * 2. 多模態圖片 / 截圖 OCR 提煉入口
   * @param {string} dataUrl - 圖片 Base64 Data URL (如 data:image/png;base64,...)
   * @param {string} userNotes - 使用者補充備註
   * @param {Array} projectList 
   * @returns {Promise<Object>}
   */
  async extractVision(dataUrl, userNotes = "", projectList = []) {
    this.worker.apiKey = getOpenRouterApiKey();
    const systemPrompt = this.buildSystemPrompt(projectList, "vision");
    const userPrompt = userNotes.trim() ? `【使用者附加說明】：${userNotes}\n請詳細解析這張圖片/截圖並提煉商務動態。` : "請詳細解析這張圖片/截圖中的表格、文字或對話並提煉為商務動態。";

    console.log("[OpenRouterExtractor] 調用打工仔多模態視覺隊列 (Task: vision)...");
    const res = await this.worker.call({
      task: 'vision',
      isVision: true,
      temperature: 0.2,
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: [
            { type: "text", text: userPrompt },
            { type: "image_url", image_url: { url: dataUrl } }
          ]
        }
      ]
    });

    const parsed = this.parseJsonResponse(res.content);

    if (parsed.is_valid === false) {
      throw new Error("AI 判定此圖片無具體商務事實或動態。");
    }

    let tag = parsed.project_tag || "NEW_UNCLASSIFIED";
    if (tag !== "NEW_UNCLASSIFIED") {
      const exists = projectList.some(p => p.tag === tag);
      if (!exists) tag = "NEW_UNCLASSIFIED";
    }

    return {
      status: "success",
      is_valid: true,
      model_used: res.model,
      params_b: res.params_b,
      project_tag: tag,
      entity_target: parsed.entity_target || "未指定客戶 (待編輯)",
      target_purpose: parsed.target_purpose || "",
      action_taken: parsed.action_taken || "圖片/截圖分析動態",
      update_log: parsed.update_log || "完成圖片 OCR 解析與動態提煉",
      attachment_links: "",
      confidence_score: parsed.confidence_score || 0.90
    };
  }

  /**
   * 3. 多模態短音訊語音理解提煉入口
   * @param {string} base64Data - 音訊純 Base64 字串
   * @param {string} mimeType - 例如 'audio/webm' 或 'audio/mp4'
   * @param {string} userNotes - 使用者補充備註
   * @param {Array} projectList 
   * @returns {Promise<Object>}
   */
  async extractAudio(base64Data, mimeType = "audio/webm", userNotes = "", projectList = []) {
    this.worker.apiKey = getOpenRouterApiKey();
    const systemPrompt = this.buildSystemPrompt(projectList, "audio");
    const userPrompt = userNotes.trim() ? `【使用者附加備註】：${userNotes}\n請轉寫並解析此段商務錄音重點。` : "請轉寫並解析此段錄音的核心商務動態。";
    const format = mimeType.split("/")[1] || "wav";

    console.log("[OpenRouterExtractor] 調用打工仔語音理解隊列 (Task: audio)...");
    const res = await this.worker.call({
      task: 'audio',
      isAudio: true,
      temperature: 0.2,
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: [
            { type: "text", text: userPrompt },
            { type: "input_audio", input_audio: { data: base64Data, format: format } }
          ]
        }
      ]
    });

    const parsed = this.parseJsonResponse(res.content);

    if (parsed.is_valid === false) {
      throw new Error("AI 判定此錄音無具體商務事實。");
    }

    let tag = parsed.project_tag || "NEW_UNCLASSIFIED";
    if (tag !== "NEW_UNCLASSIFIED") {
      const exists = projectList.some(p => p.tag === tag);
      if (!exists) tag = "NEW_UNCLASSIFIED";
    }

    return {
      status: "success",
      is_valid: true,
      model_used: res.model,
      params_b: res.params_b,
      project_tag: tag,
      entity_target: parsed.entity_target || "未指定客戶 (待編輯)",
      target_purpose: parsed.target_purpose || "",
      action_taken: parsed.action_taken || "語音錄音轉寫紀錄",
      update_log: parsed.update_log || "完成錄音轉寫與動態提煉",
      attachment_links: "",
      confidence_score: parsed.confidence_score || 0.90
    };
  }

  /**
   * 4. 📄 多模態文檔 (PDF / DOC / TXT) 提煉入口
   * @param {string} docText - 文檔提取出的內文或 Base64 內容
   * @param {string} fileName - 檔案名稱
   * @param {string} userNotes - 使用者補充備註
   * @param {Array} projectList 
   * @returns {Promise<Object>}
   */
  async extractDocument(docText, fileName = "文檔", userNotes = "", projectList = []) {
    this.worker.apiKey = getOpenRouterApiKey();
    const systemPrompt = this.buildSystemPrompt(projectList, "document");
    const userPrompt = `【檔案名稱】：${fileName}\n${userNotes.trim() ? `【使用者備註】：${userNotes}\n` : ''}【文檔內容摘要】：\n${docText.slice(0, 15000)}`;

    console.log("[OpenRouterExtractor] 調用打工仔旗艦模型解析文檔 (Task: text/doc)...");
    const res = await this.worker.call({
      task: 'text',
      temperature: 0.2,
      maxTokens: 2000,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ]
    });

    const parsed = this.parseJsonResponse(res.content);

    let tag = parsed.project_tag || "NEW_UNCLASSIFIED";
    if (tag !== "NEW_UNCLASSIFIED") {
      const exists = projectList.some(p => p.tag === tag);
      if (!exists) tag = "NEW_UNCLASSIFIED";
    }

    const isValid = parsed.is_valid !== false;
    const defaultLog = isValid ? `完成文檔 [${fileName}] 解析與動態提煉` : `[未分類文檔/待人工確認] ${parsed.reason || "文檔內容需人工審閱"}`;

    return {
      status: "success",
      is_valid: isValid,
      model_used: res.model,
      params_b: res.params_b,
      project_tag: tag,
      entity_target: parsed.entity_target || "未指定客戶 (待編輯)",
      target_purpose: parsed.target_purpose || "",
      action_taken: parsed.action_taken || `解析文檔 [${fileName}]`,
      update_log: parsed.update_log || defaultLog,
      attachment_links: "",
      confidence_score: parsed.confidence_score || (isValid ? 0.90 : 0.60)
    };
  }
}

// 實例化並掛載至全局
window.openRouterExtractor = new OpenRouterExtractor();
