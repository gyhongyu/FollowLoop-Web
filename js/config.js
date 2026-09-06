/**
 * FollowLoop-Web 中央配置檔
 * 包含 GAS Web App URL, SPREADSHEET_ID 與系統常數
 */
// 🌟 全域版本真值自動探針 (SSOT)
function getAutoAppVersion() {
  try {
    const path = (typeof window !== "undefined" && window.location && window.location.pathname) || "";
    const match = path.match(/FollowLoop-web-(V\d+\.\d+)/i);
    if (match) return match[1];
    if (typeof document !== "undefined" && document.title) {
      const tMatch = document.title.match(/(V\d+\.\d+)/i);
      if (tMatch) return tMatch[1];
    }
  } catch (e) {}
  return "V5.4";
}

const CONFIG = {
  APP_TITLE: "FollowLoop 閉環工程 AI 助理",
  VERSION: getAutoAppVersion(),
  
  // 權威 雙 GAS Web App 網址配置 (恪守 dual_gas_url_contract_guard 天條)
  // 1. Google Sheets 後端網關 (Universal_GAS_Gateway v5.0 - Strict SSOT)
  GAS_WEB_APP_URL: "https://script.google.com/macros/s/AKfycbw8FVXfcK9Bi9bjH6DVP0RDaP2hWwTFtiGVKoo2pNO9XA8GpA1FMOudW3Hjty9SajtR/exec",
  
  // 2. Google Drive 二階段大檔直傳與個人檔案總帳專用網關 (gyhongyu@gmail.com 5TB)
  GAS_DRIVE_URL: "https://script.google.com/macros/s/AKfycbxkvUs9uwru7L8yNkqWBmLh8wPwhpRTsTYyrTzYDnG518DBC-yvcAbamSO7-8ajiOfdgg/exec",
  
  // 3. Google Contacts 萬能網關 (google_contacts_gateway)
  CONTACTS_GATEWAY_URL: "https://script.google.com/macros/s/AKfycbyKnxJ2waOYny88XQH_65GagqVpcbBGVh7vCMwIT4JwowO2u__k6CUk1NDbTDrs-oqQ/exec",
  FOXLINK_GROUP_RESOURCE_NAME: "contactGroups/32c2175b88f3d791", // 🔒 Foxlink 公務專屬人脈標籤 (SSOT)
  CARDS_QUEUE_TAG: "CARDS_QUEUE", // 🪪 名片獨立 HITL 暫存佇列標籤
  
  SPREADSHEET_ID: "1YgwlA-f5Iq487-0FVU2ChOckNVLb3h1ejbrUNkUr4WQ",
  FILES_REGISTRY_SPREADSHEET_ID: "1qOjDliZUI7LJeZIW854vf3CWOIlRJ1TdvVJRQIfGxmk", // 📁 個人檔案總帳表 (FollowLoop_google_drive_files)
  
  // Google Drive 個人存儲池 (FollowLoop_Storage)
  DRIVE_RAW_INPUTS_FOLDER_NAME: "FollowLoop_Storage",
  DRIVE_ATTACHMENTS_FOLDER_ID: "1fH7PcFJC1tjoaD7A2vb7sv_iPGtY_uxV",
  DRIVE_ATTACHMENTS_FOLDER_NAME: "FollowLoop_Storage",

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

  // 🤖 打工仔 OpenRouter & Gemini 免費模型中央總帳與多模態配置 (v2.0)
  OPENROUTER_BASE_URL: "https://openrouter.ai/api/v1",
  OPENROUTER_DEFAULT_KEY: atob("c2stb3ItdjEtMGFiYzM1YTlhZTI1NzlmOThlNGU4YjNlM2RiMTIzYTY1NWE1NTU3MTE4NjgwYjlkNTcwNGI0NGY0NzYwMWNhNQ=="),
  GEMINI_DEFAULT_KEY: atob("QVEuQWI4Uk42SjlmcEpKZnBoeTRJeEVFazZZcWhCZ1Y4aDhUYmhzNFNHMkRBWmcxSDZlTUE="),
  OPENROUTER_WORKER_GAS_URL: "https://script.google.com/macros/s/AKfycbwWo9Tf5J8DKV0MgekZQdUpWh2ch7qDwqRC7gXi_5ht_Ng_ErnqeC4NqTKEf1RiNaSSJQ/exec",
  MULTIMODAL_MAX_FILE_SIZE: 25 * 1024 * 1024, // 25MB (超過此大小分流走 Google Drive Resumable 直傳)
  // 本地極速 SQLite 服務配置 (127.0.0.1:8765)
  LOCAL_SERVER_URL: "http://127.0.0.1:8765",
  LOCAL_API_BASE: "http://127.0.0.1:8765/api",
  IS_LOCAL_MODE: false // 執行階段動態探測 (Local-First vs Cloud Fallback)
};

// ☁️ 全域同步狀態管理
let isSyncingNow = false;

// 輔助函式：動態更新頂部狀態燈 (本地極速 ⚡ vs 待同步 🟠 vs 雲端 GAS ☁️)
function updateBackendStatusUI(isLocal, pendingCount = 0) {
  const statusContainer = document.getElementById("cloud-sync-status");
  const statusIcon = document.getElementById("cloud-sync-icon");
  const statusText = document.getElementById("cloud-sync-text");
  if (!statusContainer || !statusIcon || !statusText) return;

  statusContainer.style.cursor = "pointer";
  statusContainer.style.transition = "all 0.25s ease";

  if (isSyncingNow) {
    statusContainer.style.background = "rgba(59, 130, 246, 0.2)";
    statusContainer.style.borderColor = "rgba(59, 130, 246, 0.5)";
    statusContainer.style.color = "#60a5fa";
    statusContainer.title = "正在與 Google Sheet 雲端雙向同步中...";
    statusIcon.textContent = "🔄";
    statusText.textContent = "同步中...";
    return;
  }

  if (isLocal) {
    if (pendingCount > 0) {
      // 🟠 有待同步資料：琥珀橘高亮警示
      statusContainer.style.background = "rgba(245, 158, 11, 0.22)";
      statusContainer.style.borderColor = "rgba(245, 158, 11, 0.55)";
      statusContainer.style.color = "#fbbf24";
      statusContainer.title = `有 ${pendingCount} 筆本地資料尚未同步到 Google Sheet，點擊立即強制同步！`;
      statusIcon.textContent = "🟠";
      statusText.textContent = `待同步 (${pendingCount})`;
    } else {
      // 🟢 全部已同步：清新綠燈
      statusContainer.style.background = "rgba(16, 185, 129, 0.18)";
      statusContainer.style.borderColor = "rgba(16, 185, 129, 0.45)";
      statusContainer.style.color = "#34d399";
      statusContainer.title = "本地極速 SQLite (0ms 延遲)，所有資料已與雲端同步。點擊可手動強制檢查同步。";
      statusIcon.textContent = "⚡";
      statusText.textContent = "本地極速";
    }
  } else {
    // ☁️ 純雲端 GAS 模式 (外出或本地服務關閉)
    statusContainer.style.background = "rgba(99, 102, 241, 0.15)";
    statusContainer.style.borderColor = "rgba(99, 102, 241, 0.35)";
    statusContainer.style.color = "#818cf8";
    statusContainer.title = "已連線 Google Apps Script 雲端數據庫 (出差/離線自適應模式)";
    statusIcon.textContent = "☁️";
    statusText.textContent = "雲端 GAS";
  }
}

// 輔助函式：極速探測本地服務 (1000ms 內判定是否走本地 127.0.0.1:8765，支援 1 次自癒重試)
async function detectLocalBackend(isRetry = false) {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 1000);
    const res = await fetch(`${CONFIG.LOCAL_API_BASE}/ping`, {
      method: "GET",
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    if (res.ok) {
      const data = await res.json();
      if (data.status === "success" && data.mode === "local") {
        CONFIG.IS_LOCAL_MODE = true;
        console.log("⚡ [FollowLoop Gateway] 成功連線本地極速服務 (127.0.0.1:8765)！進入 Local-First 模式。");
        checkCloudSyncStatus();
        return true;
      }
    }
  } catch (e) {
    if (!isRetry) {
      // 首次探測若因主線程短暫繁忙超時，等待 300ms 自癒重試一次
      await new Promise(r => setTimeout(r, 300));
      return await detectLocalBackend(true);
    }
  }
  CONFIG.IS_LOCAL_MODE = false;
  console.log("☁️ [FollowLoop Gateway] 本地服務未啟動或處於外網，自動切換為 Google Apps Script 雲端模式。");
  updateBackendStatusUI(false);
  return false;
}

// 輔助函式：輪詢 Outbox 待同步狀態 (每 15 秒檢查一次)
async function checkCloudSyncStatus() {
  if (!CONFIG.IS_LOCAL_MODE || isSyncingNow) return;
  try {
    const res = await fetch(`${CONFIG.LOCAL_API_BASE}/sync_status`);
    if (res.ok) {
      const data = await res.json();
      if (data.status === "success") {
        updateBackendStatusUI(true, data.pending_count || 0);
        return;
      }
    }
  } catch (e) {
    // 若連線中斷，自動降級
    CONFIG.IS_LOCAL_MODE = false;
    updateBackendStatusUI(false);
  }
}

// 輔助函式：點擊頂部雲朵手動強制立即同步 (triggerCloudSyncNow)
async function triggerCloudSyncNow() {
  if (isSyncingNow) return;

  const toastFn = (msg, type) => {
    if (typeof window.showToast === "function") window.showToast(msg, type);
    else if (typeof showToast === "function") showToast(msg, type);
  };

  if (!CONFIG.IS_LOCAL_MODE) {
    toastFn("🔍 正在嘗試連接本地極速微服務 (127.0.0.1:8765)...", "info");
    const ok = await detectLocalBackend();
    if (ok) {
      toastFn("⚡ 已成功連線本地微服務，切換至 Local-First 極速模式！", "success");
    } else {
      toastFn("☁️ 本地服務 (8765) 未啟動，維持 Google Sheet 雲端直連模式。", "info");
    }
    return;
  }

  isSyncingNow = true;
  updateBackendStatusUI(true);
  toastFn("🔄 正在強制回寫 Google Sheet 雲端數據庫...", "info");

  try {
    const res = await fetch(`${CONFIG.LOCAL_API_BASE}/sync_now`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "sync_now" })
    });
    if (res.ok) {
      const data = await res.json();
      const synced = data.synced_count || 0;
      const rem = data.pending_count || 0;
      isSyncingNow = false;
      updateBackendStatusUI(true, rem);

      if (synced > 0) {
        toastFn(`✅ 雲端同步完成！已成功回寫 ${synced} 筆至 Google Sheet。`, "success");
      } else if (rem === 0) {
        toastFn("🎉 所有本地資料均已與 Google Sheet 保持同步！", "success");
      } else {
        toastFn(`⚠️ 尚有 ${rem} 筆待同步，背景服務稍後將自動補發。`, "warning");
      }
      return;
    }
  } catch (e) {
    console.warn("手動同步異常:", e);
  }

  isSyncingNow = false;
  updateBackendStatusUI(true);
  toastFn("⚠️ 網路超時或微服務離線，資料已安全保留於本地，將自動背景自癒。", "warning");
}

// 🌐 掛載到全域 window 供 HTML inline 與其他腳本調用
window.triggerCloudSyncNow = triggerCloudSyncNow;
window.checkCloudSyncStatus = checkCloudSyncStatus;
window.detectLocalBackend = detectLocalBackend;

// 腳本載入時立即發動非同步探針並啟動 15s 定時檢查
if (typeof detectLocalBackend === "function") {
  detectLocalBackend();
}
setInterval(() => {
  if (CONFIG.IS_LOCAL_MODE) {
    checkCloudSyncStatus();
  }
}, 15000);

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

// 輔助函式：自適應發送 POST 請求 (優先本地 SQLite 0ms，降級 GAS)
async function sendGasRequest(action, additionalParams = {}) {
  const payload = createGasPayload(action, additionalParams);

  // 1. 若本地服務在線，直寫本地 SQLite
  if (CONFIG.IS_LOCAL_MODE) {
    try {
      const response = await fetch(`${CONFIG.LOCAL_API_BASE}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json;charset=utf-8" },
        body: JSON.stringify(payload)
      });
      if (response.ok) {
        const data = await response.json();
        return data;
      }
    } catch (localErr) {
      console.warn("⚠️ 本地服務連線異常，自動切換至雲端 GAS 發送:", localErr);
      CONFIG.IS_LOCAL_MODE = false;
      updateBackendStatusUI(false);
    }
  }

  // 2. 備援或雲端模式：發送至 Google Apps Script
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

// 輔助函式：自適應發送 GET 請求 (優先本地 SQLite 0ms，降級 GAS)
async function sendGasGetRequest(sheetName = "Memory_Pool_Raw") {
  // 1. 若本地服務在線，直讀本地 SQLite (0ms 二維陣列)
  if (CONFIG.IS_LOCAL_MODE) {
    try {
      const url = `${CONFIG.LOCAL_API_BASE}/data?sheet=${encodeURIComponent(sheetName)}`;
      const response = await fetch(url, { method: "GET" });
      if (response.ok) {
        const data = await response.json();
        return data;
      }
    } catch (localErr) {
      console.warn("⚠️ 本地服務讀取異常，本單次請求平滑備援至雲端 GAS 讀取:", localErr);
      // 保持靜默平滑備援，避免單次網絡抖動永久切斷本地極速
    }
  }

  // 2. 備援或雲端模式：發送至 Google Apps Script
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

// ☁️ 專屬穿透函式：100% 強制直發 Google Apps Script 雲端數據庫 (繞過本地 8765 代理，專供 HITL 入庫審核等高一致性場景)
async function sendCloudGasRequest(action, additionalParams = {}) {
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
    console.error(`[Cloud GAS POST Error] Action (${action}):`, error);
    throw error;
  }
}

// ☁️ 專屬穿透函式：100% 強制自 Google Apps Script 雲端試算表直讀原始數據 (繞過本地 8765 代理)
async function sendCloudGasGetRequest(sheetName = "Memory_Pool_Raw") {
  try {
    const url = `${CONFIG.GAS_WEB_APP_URL}?spreadsheet_id=${CONFIG.SPREADSHEET_ID}&sheet=${encodeURIComponent(sheetName)}&t=${Date.now()}`;
    const response = await fetch(url, { method: "GET" });
    if (!response.ok) {
      throw new Error(`HTTP GET 錯誤! 狀態碼: ${response.status}`);
    }
    const data = await response.json();
    return data;
  } catch (error) {
    console.error(`[Cloud GAS GET Error] Sheet (${sheetName}):`, error);
    throw error;
  }
}

window.sendCloudGasRequest = sendCloudGasRequest;
window.sendCloudGasGetRequest = sendCloudGasGetRequest;

