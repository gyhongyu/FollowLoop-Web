/**
 * FollowLoop-Web 中央配置檔
 * 包含 GAS Web App URL, SPREADSHEET_ID 與系統常數
 */
const CONFIG = {
  APP_TITLE: "FollowLoop 閉環工程 AI 助理",
  VERSION: "v1.1.0-MVP",
  
  // 權威 GAS Web App 與 Sheet ID 配置 (引自 e:/Projects/FollowLoop/config.py)
  GAS_WEB_APP_URL: "https://script.google.com/macros/s/AKfycbz8slAubwAOO7lbCi3xb5I0WmykqGM4DJyPbSXgOK3JDuCHWVA4APVmucb969BZqTnXGg/exec",
  SPREADSHEET_ID: "1YgwlA-f5Iq487-0FVU2ChOckNVLb3h1ejbrUNkUr4WQ",
  
  // Google Drive 原始 Input 資料夾 ID (FollowLoop_RawInputs)
  DRIVE_RAW_INPUTS_FOLDER_ID: "1YgwlA-f5Iq487-0FVU2ChOckNVLb3h1ejbrUNkUr4WQ",
  
  // CORS 安全防護標頭 (全系統強制使用 text/plain 以避開 Preflight 跨域阻擋)
  FETCH_HEADERS: {
    "Content-Type": "text/plain;charset=utf-8"
  },

  // 定時刷新與卡片輪詢間隔 (毫秒)
  AUTO_REFRESH_INTERVAL: 60000
};

// 輔助函式：包裝標準 GAS 請求 Payload (帶入 SPREADSHEET_ID)
function createGasPayload(action, additionalParams = {}) {
  return Object.assign({
    action: action,
    spreadsheet_id: CONFIG.SPREADSHEET_ID
  }, additionalParams);
}

// 輔助函式：安全發送 POST 請求至 GAS (避開 CORS 阻擋)
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
