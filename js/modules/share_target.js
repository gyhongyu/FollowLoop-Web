/**
 * FollowLoop-Web Web Share Target 模組 (share_target.js)
 * 負責：Android 系統分享二階段接收、IndexedDB 快取提取與直傳隊列對接
 */

const SHARE_DB_NAME = 'FollowLoop_ShareDB';
const SHARE_DB_VERSION = 1;
const SHARE_STORE_NAME = 'shared_files';

function openShareDBClient() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(SHARE_DB_NAME, SHARE_DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(SHARE_STORE_NAME)) {
        db.createObjectStore(SHARE_STORE_NAME, { keyPath: 'id', autoIncrement: true });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function getAndClearSharedFiles() {
  try {
    const db = await openShareDBClient();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(SHARE_STORE_NAME, 'readwrite');
      const store = tx.objectStore(SHARE_STORE_NAME);
      const getAllReq = store.getAll();

      getAllReq.onsuccess = () => {
        const files = getAllReq.result || [];
        if (files.length > 0) {
          store.clear();
        }
        resolve(files);
      };
      getAllReq.onerror = () => reject(getAllReq.error);
    });
  } catch (e) {
    console.warn('[ShareTarget] 讀取 IndexedDB 異常:', e);
    return [];
  }
}

async function handleIncomingSharedFiles() {
  const sharedItems = await getAndClearSharedFiles();
  if (!sharedItems || sharedItems.length === 0) {
    return;
  }

  console.log(`[ShareTarget] 成功獲取 ${sharedItems.length} 筆由系統分享傳入的檔案！`);
  showToast(`📲 接收到 ${sharedItems.length} 筆由手機分享傳入的檔案，開始直傳 Google Drive...`, 'info');

  const ingestionBtn = document.querySelector('.nav-tab-btn[data-tab="ingestion"]');
  if (ingestionBtn) ingestionBtn.click();

  const progressContainer = document.getElementById("progress-container");
  const incomingFiles = [];
  let combinedNotes = "";

  for (let i = 0; i < sharedItems.length; i++) {
    const item = sharedItems[i];

    let incomingUrl = (item.url && item.url.trim().startsWith('http')) ? item.url.trim() : null;
    const rawText = (item.text || "").trim();
    if (!incomingUrl && rawText) {
      const match = rawText.match(/https?:\/\/[^\s]+/i);
      if (match) incomingUrl = match[0];
    }

    const isRealBinaryFile = item.blob && (item.blob.size > 0) && (item.type && !item.type.startsWith('text/'));

    if (incomingUrl && !isRealBinaryFile) {
      try {
        const linkTitle = item.title || rawText.replace(incomingUrl, '').trim() || incomingUrl;
        showToast(`🌐 偵測到網址分享，正在儲存至 Links 箱: ${incomingUrl}`, 'info');
        await driveUploader.uploadUrlShortcut(incomingUrl, linkTitle);
        showToast(`🎉 網址捷徑已安全存入 Links/ 資料夾！`, 'success');
      } catch (urlErr) {
        console.error('[ShareTarget] 網址儲存失敗:', urlErr);
        showToast(`❌ 網址存入失敗: ${urlErr.message}`, 'danger');
      }
      continue;
    }

    const fileBlob = item.blob || item;
    const file = new File([fileBlob], item.name || `shared_file_${Date.now()}_${i + 1}`, {
      type: item.type || fileBlob.type || 'application/octet-stream'
    });
    incomingFiles.push(file);

    if (item.title || item.text) {
      const notePart = `${item.title || ''} ${item.text || ''}`.trim();
      if (notePart && !combinedNotes.includes(notePart)) {
        combinedNotes = combinedNotes ? `${combinedNotes} | ${notePart}` : notePart;
      }
    }
  }

  const noteEl = document.getElementById("note-textarea");
  if (noteEl && combinedNotes) {
    noteEl.value = `[系統分享] ${combinedNotes}`;
  }

  try {
    const uploadSingle = window.handleFileUpload;
    const uploadBatch = window.handleFilesBatch;

    if (incomingFiles.length === 1 && typeof uploadSingle === "function") {
      await uploadSingle(incomingFiles[0]);
    } else if (incomingFiles.length > 1 && typeof uploadBatch === "function") {
      await uploadBatch(incomingFiles);
    }
  } catch (procErr) {
    console.error("[ShareTarget] 處理分享檔案失敗:", procErr);
    showToast(`處理分享檔案失敗: ${procErr.message}`, "danger");
  }

  if (window.location.hash.includes('share-incoming')) {
    history.replaceState(null, null, window.location.pathname + window.location.search);
  }

  setTimeout(() => {
    if (progressContainer) progressContainer.classList.remove("active");
  }, 4000);
}

// 🌐 全域安全掛載函式
window.handleIncomingSharedFiles = handleIncomingSharedFiles;
