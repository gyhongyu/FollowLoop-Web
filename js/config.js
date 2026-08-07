/**
 * FollowLoop-Web 中央配置檔
 * 包含 GAS Web App URL, SPREADSHEET_ID 與系統常數
 */
const CONFIG = {
  APP_TITLE: "FollowLoop 閉環工程 AI 助理",
  VERSION: "v1.2.0-Draft-SSOT",
  
  // 權威 雙 GAS Web App 網址配置 (恪守 dual_gas_url_contract_guard 天條)
  // 1. Google Sheets 數據庫與 Live 看板專用 (模組二 & 模組三)
  GAS_WEB_APP_URL: "https://script.google.com/macros/s/AKfycbz8slAubwAOO7lbCi3xb5I0WmykqGM4DJyPbSXgOK3JDuCHWVA4APVmucb969BZqTnXGg/exec",
  
  // 2. Google Drive 二階段大檔直傳專用 (模組一 ⚡ 直傳門閥)
  GAS_DRIVE_URL: "https://script.google.com/macros/s/AKfycbywZiZgUu1pqrbQp43PDsiVQIrCE7fDvwTtdGd6_BaOzeozCX3DDJTg9iTWl1_8EXyw_g/exec",
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

// 輔助函式：安全發送 GET 請求至 GAS Sheets 讀取 Memory_Pool_View 唯讀數據
async function sendGasGetRequest() {
  try {
    const url = `${CONFIG.GAS_WEB_APP_URL}?spreadsheet_id=${CONFIG.SPREADSHEET_ID}&t=${Date.now()}`;
    const response = await fetch(url, {
      method: "GET"
    });
    
    if (!response.ok) {
      throw new Error(`HTTP GET 錯誤! 狀態碼: ${response.status}`);
    }
    
    const data = await response.json();
    return data;
  } catch (error) {
    console.error("[GAS GET Request Error]:", error);
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
