/**
 * FollowLoop-Web 二階段大檔直傳 (Google Drive Resumable Upload) 模組
 * 解決 100MB~200MB+ 大檔案經 GAS 中轉會逾時與爆流量的問題
 */

class DriveUploader {
  constructor() {
    this.mediaRecorder = null;
    this.audioChunks = [];
    this.isRecording = false;
    this.startTime = 0;
    this.timerInterval = null;
    this.recognition = null;
    this.recordedTranscript = "";
    this.subfolderCache = {}; // 快取各子資料夾 ID: { "Vouchers": "id_123" }
  }

  /**
   * 根據 category 取得或自動建立 Google Drive 子資料夾 ID
   * @param {string} token - Google OAuth Token
   * @param {string} parentRawFolderId - FollowLoop_RawInputs 的 Folder ID
   * @param {string} categoryKey - VOUCHERS / VOICE_MEMOS / BUSINESS_CARDS 等
   */
  async getSubfolderId(token, parentRawFolderId, categoryKey) {
    if (!categoryKey || !CONFIG.RAW_SCENE_CATEGORIES) return parentRawFolderId;
    const cat = CONFIG.RAW_SCENE_CATEGORIES[categoryKey] || 
      Object.values(CONFIG.RAW_SCENE_CATEGORIES).find(c => c.folder.toLowerCase() === String(categoryKey).toLowerCase());
    
    if (!cat) return parentRawFolderId;
    const folderName = cat.folder;

    if (this.subfolderCache[folderName]) {
      return this.subfolderCache[folderName];
    }

    // 嘗試從 localStorage 快取中讀取 (提升離線與極速體驗)
    const storageKey = `fl_drive_folder_${folderName}`;
    const cachedId = localStorage.getItem(storageKey);
    if (cachedId) {
      this.subfolderCache[folderName] = cachedId;
      return cachedId;
    }

    try {
      // 1. 查詢子資料夾是否存在
      const q = encodeURIComponent(`name = '${folderName}' and '${parentRawFolderId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`);
      const searchRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}`, {
        headers: { "Authorization": `Bearer ${token}` }
      });
      if (searchRes.ok) {
        const data = await searchRes.json();
        if (data.files && data.files.length > 0) {
          const fid = data.files[0].id;
          this.subfolderCache[folderName] = fid;
          localStorage.setItem(storageKey, fid);
          return fid;
        }
      }

      // 2. 若不存在則在 parentRawFolderId 下自動建立
      console.log(`[DriveUploader] 正在 Google Drive 建立子資料夾: ${folderName}...`);
      const createRes = await fetch("https://www.googleapis.com/drive/v3/files", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json; charset=UTF-8"
        },
        body: JSON.stringify({
          name: folderName,
          mimeType: "application/vnd.google-apps.folder",
          parents: [parentRawFolderId]
        })
      });
      if (createRes.ok) {
        const newFolder = await createRes.json();
        const fid = newFolder.id;
        this.subfolderCache[folderName] = fid;
        localStorage.setItem(storageKey, fid);
        return fid;
      }
    } catch (e) {
      console.warn(`[DriveUploader] 查詢/建立子資料夾 (${folderName}) 失敗，退回根目錄:`, e);
    }

    return parentRawFolderId;
  }

  /**
   * 執行二階段大檔直傳至 Google Drive
   * @param {File} file - 待上傳的檔案
   * @param {string} notes - 使用者補充備註
   * @param {Function} onProgress - 進度回呼 (percentage)
   * @param {string} targetFolderId - 明確指定資料夾 ID
   * @param {string} categoryKey - VOUCHERS / VOICE_MEMOS / BUSINESS_CARDS 等
   * @returns {Promise<Object>} 上傳結果資訊
   */
  async uploadFileDirect(file, notes = "", onProgress = null, targetFolderId = null, categoryKey = null) {
    if (!file) {
      throw new Error("請先選擇或錄製檔案！");
    }

    console.log(`[DriveUploader] 步驟 1/2: 向 GAS 申請 Resumable Session URL (${file.name}, 分類: ${categoryKey || '未指定'})`);

    let sessionUrl = null;
    let sessionRes = null;

    try {
      // 1. 第一階段：向專用 Drive GAS 獲取授權 Token
      const tokenRes = await sendDriveGasRequest("get_drive_token", {
        filename: file.name,
        mimeType: file.type || "application/octet-stream",
        fileSize: file.size,
        userNotes: notes
      });

      if (tokenRes && tokenRes.status === "success" && tokenRes.token) {
        // 🌟 自動解析目標資料夾：優先使用 targetFolderId，否則依 categoryKey 自動路由子資料夾
        let finalFolderId = targetFolderId;
        if (!finalFolderId && categoryKey) {
          finalFolderId = await this.getSubfolderId(tokenRes.token, tokenRes.folder_id, categoryKey);
        }
        if (!finalFolderId) {
          finalFolderId = tokenRes.folder_id;
        }

        console.log(`[DriveUploader] 成功取得 GAS OAuth Token，發起 Resumable Session (目標資料夾: ${finalFolderId})...`);
        
        const metadata = {
          name: file.name,
          mimeType: file.type || "application/octet-stream",
          parents: [finalFolderId]
        };

        const sessionInitResp = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable", {
          method: "POST",
          headers: {
            "Authorization": "Bearer " + tokenRes.token,
            "Content-Type": "application/json; charset=UTF-8",
            "X-Upload-Content-Type": file.type || "application/octet-stream",
            "X-Upload-Content-Length": file.size.toString()
          },
          body: JSON.stringify(metadata)
        });

        if (sessionInitResp.ok || sessionInitResp.status === 200) {
          sessionUrl = sessionInitResp.headers.get("Location") || sessionInitResp.headers.get("location");
        }
      }
    } catch (e) {
      console.warn("[DriveUploader] 前端發起 Resumable Session 異常，準備嘗試 fallback: ", e);
    }

    // 容錯 Fallback 路線：若未取得 sessionUrl，檢查檔案大小
    if (!sessionUrl) {
      // 防禦機制：若檔案大於 10MB (10485760 bytes)，Base64 上傳會觸發 Google HTTP 413 (Content Too Large) 限制
      if (file.size > 10 * 1024 * 1024) {
        const sizeMb = (file.size / (1024 * 1024)).toFixed(1);
        throw new Error(`檔案較大 (${sizeMb} MB)。請確保在 Google Apps Script 中點擊「執行」完成一次權限授權 (UrlFetchApp)，以開啟大檔案 Resumable 直傳！`);
      }

      console.log(`[DriveUploader] 小檔案 (${(file.size / 1024).toFixed(1)} KB) 採用 Base64 模式存入 Google Drive...`);
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = async (evt) => {
          try {
            const base64Data = evt.target.result.split(',')[1];
            const fallbackRes = await sendDriveGasRequest("upload_file", {
              filename: file.name,
              file_b64: base64Data,
              mime_type: file.type || "application/octet-stream",
              user_notes: notes
            });
            if (fallbackRes.status === "success") {
              resolve({
                status: "success",
                file_id: fallbackRes.file_id || "UPLOADED_DIRECTLY",
                filename: file.name,
                size: file.size,
                notes: notes,
                raw_url: fallbackRes.download_url || ""
              });
            } else {
              reject(new Error(fallbackRes.message || "上傳至 Google Drive 失敗！"));
            }
          } catch (err) {
            reject(err);
          }
        };
        reader.onerror = (err) => reject(err);
        reader.readAsDataURL(file);
      });
    }

    console.log(`[DriveUploader] 步驟 2/2: 前端開始直傳 Google Drive (PUT to Session URL)...`);

    // 2. 第二階段：前端使用 XMLHttpRequest 發起 PUT 直傳，即時更新進度條
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", sessionUrl, true);
      xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && onProgress) {
          const percent = Math.round((e.loaded / e.total) * 100);
          onProgress(percent);
        }
      };

      xhr.onload = () => {
        if (xhr.status === 200 || xhr.status === 201) {
          try {
            const resData = xhr.responseText ? JSON.parse(xhr.responseText) : {};
            resolve({
              status: "success",
              file_id: resData.id || "UPLOADED_DIRECTLY",
              filename: file.name,
              size: file.size,
              notes: notes,
              raw_url: resData.webViewLink || ""
            });
          } catch (err) {
            resolve({
              status: "success",
              file_id: "UPLOADED_DIRECTLY",
              filename: file.name,
              size: file.size,
              notes: notes
            });
          }
        } else {
          reject(new Error(`Google Drive 直傳回應失敗! HTTP Status: ${xhr.status}`));
        }
      };

      xhr.onerror = () => {
        reject(new Error("網路中斷或直傳 Google Drive 過程發生異常！"));
      };

      xhr.send(file);
    });
  }

  /**
   * 上傳純文字速記 / 備註
   * @param {string} textContent 
   * @param {string} categoryKey 
   */
  async uploadTextNote(textContent, categoryKey = "UNCLASSIFIED") {
    if (!textContent || !textContent.trim()) {
      throw new Error("請輸入速記內容！");
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `Note_${timestamp}.txt`;
    const blob = new Blob([textContent], { type: "text/plain;charset=utf-8" });
    const file = new File([blob], filename, { type: "text/plain" });

    return await this.uploadFileDirect(file, `[速記] ${textContent}`, null, null, categoryKey);
  }

  /**
   * 上傳網址捷徑 (.url) 檔至 Google Drive Links/ 子資料夾
   * @param {string} url - 目標網址
   * @param {string} title - 網頁標題或說明
   */
  async uploadUrlShortcut(url, title = "") {
    if (!url || !url.trim()) throw new Error("請提供有效網址！");
    const cleanUrl = url.trim();
    let domain = "web";
    try {
      const u = new URL(cleanUrl);
      domain = u.hostname.replace(/[^a-zA-Z0-9.-]/g, "_");
    } catch (e) {}

    const now = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    const ymd = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
    const hms = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    const filename = `link_${domain}_${ymd}_${hms}.url`;
    
    // Windows 標準網頁快捷方式檔內容格式
    const fileContent = `[InternetShortcut]\nURL=${cleanUrl}\nTitle=${title || domain}\nCreated=${now.toISOString()}\n`;
    const blob = new Blob([fileContent], { type: "text/plain;charset=utf-8" });
    const file = new File([blob], filename, { type: "text/plain" });

    return await this.uploadFileDirect(file, `[網址鏈結] ${title || cleanUrl}`, null, null, "LINKS");
  }

  /**
   * 初始化與啟動麥克風錄音 (Browser MediaRecorder + Web Speech API 即時轉寫)
   */
  async startRecording(onTick = null) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error("您的瀏覽器不支援麥克風錄音功能！");
    }

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.audioChunks = [];
    this.recordedTranscript = "";
    
    // 優先選用 m4a / webm
    const mimeType = MediaRecorder.isTypeSupported("audio/mp4")
      ? "audio/mp4"
      : MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : "audio/webm";

    this.mediaRecorder = new MediaRecorder(stream, { mimeType });

    this.mediaRecorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        this.audioChunks.push(event.data);
      }
    };

    // 啟動瀏覽器原生 Web Speech 語音識別 (繁體中文 / 英文)
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
      try {
        this.recognition = new SpeechRecognition();
        this.recognition.continuous = true;
        this.recognition.interimResults = true;
        this.recognition.lang = "zh-TW";

        this.recognition.onresult = (event) => {
          let currentTranscript = "";
          for (let i = 0; i < event.results.length; i++) {
            currentTranscript += event.results[i][0].transcript + " ";
          }
          this.recordedTranscript = currentTranscript.trim();
        };

        this.recognition.onerror = (e) => {
          console.warn("[WebSpeech] 語音識別提示: ", e.error);
        };

        this.recognition.start();
      } catch (recErr) {
        console.warn("[WebSpeech] 啟動識別異常: ", recErr.message);
      }
    }

    this.mediaRecorder.start(250);
    this.isRecording = true;
    this.startTime = Date.now();

    if (onTick) {
      this.timerInterval = setInterval(() => {
        const elapsedSec = Math.floor((Date.now() - this.startTime) / 1000);
        onTick(elapsedSec);
      }, 1000);
    }
  }

  /**
   * 停止麥克風錄音並封裝為 File 物件 (攜帶語音逐字稿)
   * @returns {Promise<File>} 錄製完成的語音檔
   */
  async stopRecording() {
    return new Promise((resolve, reject) => {
      if (!this.mediaRecorder || !this.isRecording) {
        reject(new Error("目前未在錄音狀態！"));
        return;
      }

      if (this.timerInterval) {
        clearInterval(this.timerInterval);
        this.timerInterval = null;
      }

      if (this.recognition) {
        try {
          this.recognition.stop();
        } catch (e) {}
      }

      this.mediaRecorder.onstop = () => {
        this.isRecording = false;
        const mimeType = this.mediaRecorder.mimeType || "audio/webm";
        const ext = mimeType.includes("mp4") ? "m4a" : "webm";
        const audioBlob = new Blob(this.audioChunks, { type: mimeType });
        
        // 關閉麥克風音軌
        this.mediaRecorder.stream.getTracks().forEach((track) => track.stop());

        const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
        const audioFile = new File([audioBlob], `Voice_Record_${timestamp}.${ext}`, { type: mimeType });
        
        // 將 Web Speech 轉錄之逐字稿直接掛載於 File 物件
        audioFile.transcript = this.recordedTranscript || "";
        resolve(audioFile);
      };

      this.mediaRecorder.stop();
    });
  }
}

// 導出全域單例
window.driveUploader = new DriveUploader();
