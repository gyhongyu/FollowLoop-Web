/**
 * FollowLoop-Web 中央配置檔
 * 包含 GAS Web App URL, SPREADSHEET_ID 與系統常數
 */
const CONFIG = {
  APP_TITLE: "FollowLoop 閉環工程 AI 助理",
  VERSION: "v1.2.0-Draft-SSOT",
  
  // 權威 雙 GAS Web App 網址配置 (恪守 dual_gas_url_contract_guard 天條)
  // 1. Google Sheets 後端網關 (Universal_GAS_Gateway v5.0 - Strict SSOT)
  GAS_WEB_APP_URL: "https://script.google.com/macros/s/AKfycbw8FVXfcK9Bi9bjH6DVP0RDaP2hWwTFtiGVKoo2pNO9XA8GpA1FMOudW3Hjty9SajtR/exec",
  
  // 2. Google Drive 二階段大檔直傳專用 (模組一 ⚡ 直傳門閥)
  GAS_DRIVE_URL: "https://script.google.com/macros/s/AKfycbywZiZgUu1pqrbQp43PDsiVQIrCE7fDvwTtdGd6_BaOzeozCX3DDJTg9iTWl1_8EXyw_g/exec",
  
  // 3. Google Contacts 萬能網關 (google_contacts_gateway)
  CONTACTS_GATEWAY_URL: "https://script.google.com/macros/s/AKfycbyKnxJ2waOYny88XQH_65GagqVpcbBGVh7vCMwIT4JwowO2u__k6CUk1NDbTDrs-oqQ/exec",
  
  SPREADSHEET_ID: "1YgwlA-f5Iq487-0FVU2ChOckNVLb3h1ejbrUNkUr4WQ",
  
  // Google Drive 資料夾 ID (SSOT)
  DRIVE_RAW_INPUTS_FOLDER_NAME: "FollowLoop_RawInputs",
  DRIVE_ATTACHMENTS_FOLDER_ID: "1qSx-L6u6thXV_JY5oLu5gXg_58hVRAnX",
  DRIVE_ATTACHMENTS_FOLDER_NAME: "Projects_Attachments",

  // 🗂️ 全域唯一 素材物理場景分類契約 (RAW_SCENE_CATEGORIES SSOT)
  RAW_SCENE_CATEGORIES: {
    VOUCHERS: { folder: "Vouchers", prefix: "voucher", icon: "🧾", label: "報銷單據/發票/機票/UPI" },
    VOICE_MEMOS: { folder: "VoiceMemos", prefix: "audio", icon: "🎙️", label: "出差語音/會議錄音" },
    BUSINESS_CARDS: { folder: "BusinessCards", prefix: "card", icon: "🪪", label: "名片正反面" },
    CHAT_SCREENSHOTS: { folder: "ChatScreenshots", prefix: "chat", icon: "💬", label: "對話/承諾截圖" },
    TRAVEL_TRACKS: { folder: "TravelTracks", prefix: "track", icon: "📍", label: "導航/合影/出差佐證" },
    PROJECT_DOCS: { folder: "ProjectDocs", prefix: "doc", icon: "📄", label: "規格書/報價/合約/PPT" },
    LINKS: { folder: "Links", prefix: "link", icon: "🌐", label: "網址與新聞鏈結" },
    UNCLASSIFIED: { folder: "Unclassified", prefix: "raw", icon: "📦", label: "未分類 (0 LLM 直傳)" }
  },
  
  // CORS 安全防護標頭 (全系統強制使用 text/plain 以避開 Preflight 跨域阻擋)
  FETCH_HEADERS: {
    "Content-Type": "text/plain;charset=utf-8"
  },

  // 定時刷新與卡片輪詢間隔 (毫秒)
  AUTO_REFRESH_INTERVAL: 60000,

  // 🤖 打工仔 OpenRouter 免費模型中央總帳與多模態配置 (v2.0)
  OPENROUTER_BASE_URL: "https://openrouter.ai/api/v1",
  OPENROUTER_DEFAULT_KEY: atob("c2stb3ItdjEtMGFiYzM1YTlhZTI1NzlmOThlNGU4YjNlM2RiMTIzYTY1NWE1NTU3MTE4NjgwYjlkNTcwNGI0NGY0NzYwMWNhNQ=="),
  OPENROUTER_WORKER_GAS_URL: "https://script.google.com/macros/s/AKfycbwWo9Tf5J8DKV0MgekZQdUpWh2ch7qDwqRC7gXi_5ht_Ng_ErnqeC4NqTKEf1RiNaSSJQ/exec",
  MULTIMODAL_MAX_FILE_SIZE: 25 * 1024 * 1024 // 25MB (超過此大小分流走 Google Drive Resumable 直傳)
};

// 輔助函式：取得當前生效的 OpenRouter API Key (優先讀取 localStorage 自訂)
function getOpenRouterApiKey() {
  return localStorage.getItem("fl_openrouter_key") || CONFIG.OPENROUTER_DEFAULT_KEY;
}

// 輔助函式：取得當前生效的 OpenRouter 模型清單 (優先讀取 localStorage 自訂)
function getOpenRouterModels() {
  const custom = localStorage.getItem("fl_openrouter_models");
  if (custom) {
    try {
      const parsed = JSON.parse(custom);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    } catch(e) {}
  }
  return CONFIG.OPENROUTER_DEFAULT_MODELS;
}

// 輔助函式：包裝標準 GAS 請求 Payload (帶入 SPREADSHEET_ID)
function createGasPayload(action, additionalParams = {}) {
  return Object.assign({
    action: action,
    spreadsheet_id: CONFIG.SPREADSHEET_ID
  }, additionalParams);
}

// 輔助函式：安全發送 POST 請求至 GAS Sheets (避開 CORS 阻擋)
async function sendGasRequest(action, additionalParams = {}) {
  const payload = createGasPayload(action, additionalParams);
  try {
    const response = await fetch(CONFIG.GAS_WEB_APP_URL, {
      method: "POST",
      headers: CONFIG.FETCH_HEADERS,
      body: JSON.stringify(payload)
    });
    
    if (!response.ok) {
      throw new Error(`HTTP 錯誤! 狀態碼: ${response.status}`);
    }
    
    const data = await response.json();
    return data;
  } catch (error) {
    console.error(`[GAS Request Error] Action (${action}):`, error);
    throw error;
  }
}

// 輔助函式：安全發送 GET 請求至 GAS Sheets 讀取指定頁籤數據
async function sendGasGetRequest(sheetName = "Memory_Pool_Raw") {
  try {
    const url = `${CONFIG.GAS_WEB_APP_URL}?spreadsheet_id=${CONFIG.SPREADSHEET_ID}&sheet=${encodeURIComponent(sheetName)}&t=${Date.now()}`;
    const response = await fetch(url, {
      method: "GET"
    });
    
    if (!response.ok) {
      throw new Error(`HTTP GET 錯誤! 狀態碼: ${response.status}`);
    }
    
    const data = await response.json();
    return data;
  } catch (error) {
    console.error(`[GAS GET Request Error] Sheet (${sheetName}):`, error);
    throw error;
  }
}

// 輔助函式：專門發送 POST 請求至 Google Drive 專用 GAS
async function sendDriveGasRequest(action, additionalParams = {}) {
  const payload = createGasPayload(action, additionalParams);
  try {
    const response = await fetch(CONFIG.GAS_DRIVE_URL, {
      method: "POST",
      headers: CONFIG.FETCH_HEADERS,
      body: JSON.stringify(payload)
    });
    
    if (!response.ok) {
      throw new Error(`HTTP 錯誤! 狀態碼: ${response.status}`);
    }
    
    const data = await response.json();
    return data;
  } catch (error) {
    console.error(`[GAS Drive Error] Action (${action}):`, error);
    throw error;
  }
}
