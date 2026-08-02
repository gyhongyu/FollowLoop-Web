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
  }

  /**
   * 執行二階段大檔直傳至 Google Drive
   * @param {File} file - 待上傳的檔案
   * @param {string} notes - 使用者補充備註
   * @param {Function} onProgress - 進度回呼 (percentage)
   * @returns {Promise<Object>} 上傳結果資訊
   */
  async uploadFileDirect(file, notes = "", onProgress = null) {
    if (!file) {
      throw new Error("請先選擇或錄製檔案！");
    }

    console.log(`[DriveUploader] 步驟 1/2: 向 GAS 申請 Resumable Session URL (${file.name}, ${file.size} bytes)`);

    let sessionUrl = null;
    let sessionRes = null;

    try {
      // 1. 第一階段：向 GAS Web App 請求上傳 Session URL (CORS 安全 text/plain 標頭)
      sessionRes = await sendGasRequest("get_upload_session", {
        filename: file.name,
        mimeType: file.type || "application/octet-stream",
        fileSize: file.size,
        userNotes: notes
      });
      if (sessionRes && sessionRes.status === "success" && sessionRes.uploadUrl) {
        sessionUrl = sessionRes.uploadUrl;
      }
    } catch (e) {
      console.warn("[DriveUploader] 無法取得 Resumable Session URL，切換至 Base64 直接上傳 fallback: ", e);
    }

    // 容錯 Fallback 路線：若未取得 sessionUrl，使用相容的 Base64 檔案上傳模式
    if (!sessionUrl) {
      console.log(`[DriveUploader] 採用安全 Base64 上傳模式將檔案存入 Google Drive...`);
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = async (evt) => {
          try {
            const base64Data = evt.target.result.split(',')[1];
            const fallbackRes = await sendGasRequest("upload_file", {
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
   * @param {string} category 
   */
  async uploadTextNote(textContent, category = "General") {
    if (!textContent || !textContent.trim()) {
      throw new Error("請輸入速記內容！");
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `Note_${timestamp}.txt`;
    const blob = new Blob([textContent], { type: "text/plain;charset=utf-8" });
    const file = new File([blob], filename, { type: "text/plain" });

    return await this.uploadFileDirect(file, `[速記/分類: ${category}] ${textContent}`);
  }

  /**
   * 初始化與啟動麥克風錄音 (Browser MediaRecorder)
   */
  async startRecording(onTick = null) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error("您的瀏覽器不支援麥克風錄音功能！");
    }

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.audioChunks = [];
    
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
   * 停止麥克風錄音並封裝為 File 物件
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

      this.mediaRecorder.onstop = () => {
        this.isRecording = false;
        const mimeType = this.mediaRecorder.mimeType || "audio/webm";
        const ext = mimeType.includes("mp4") ? "m4a" : "webm";
        const audioBlob = new Blob(this.audioChunks, { type: mimeType });
        
        // 關閉麥克風音軌
        this.mediaRecorder.stream.getTracks().forEach((track) => track.stop());

        const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
        const audioFile = new File([audioBlob], `Voice_Record_${timestamp}.${ext}`, { type: mimeType });
        resolve(audioFile);
      };

      this.mediaRecorder.stop();
    });
  }
}

// 導出全域單例
window.driveUploader = new DriveUploader();
