// FollowLoop PWA Service Worker (V5.2.4 - Dual-Mode Speed & HITL Cloud Direct)
// 快取策略：靜態資源 Network-First (網路優先+快取備援)，API / GAS 請求 Network-Only (完全直通)
// 支援 Web Share Target Level 2 檔案接收並安全中轉至 IndexedDB

const CACHE_NAME = 'followloop-pwa-v5.2.5';

// 預快取靜態資源清單
const STATIC_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './favicon.ico',
  './css/main.css?v=5.2',
  './css/components.css?v=5.2',
  './css/responsive.css?v=5.2',
  './css/themes.css?v=5.2',
  './js/config.js?v=5.2.4',
  './js/openrouter-worker.js?v=5.2.4',
  './js/openrouter_extractor.js?v=5.2.4',
  './js/admin_panel.js?v=5.2.4',
  './js/drive_uploader.js?v=5.2.4',
  './js/hitl_reviewer.js?v=5.2.4',
  './js/live_view.js?v=5.2.4',
  './js/project_manager.js?v=5.2.4',
  './js/auth.js?v=5.2.4',
  './js/app.js?v=5.2.5',
  './js/background-pipeline.js?v=5.2.4',
  './img/icons/icon-192.png',
  './img/icons/icon-512.png',
  './img/icons/icon-maskable-512.png',
  './img/icons/apple-touch-icon.png',
  './img/icons/favicon-32.png',
  './img/deepbluelogo_foxlink-m.png',
  './img/wlogo_foxlink_s.png'
];

/* --------------------------------------------------------------------------
   IndexedDB 工具：專門存放 Web Share Target 接收到的檔案
   -------------------------------------------------------------------------- */
const DB_NAME = 'FollowLoop_ShareDB';
const DB_VERSION = 1;
const STORE_NAME = 'shared_files';

function openShareDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function saveSharedFiles(files, metadata = {}) {
  const db = await openShareDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    
    // 將每個 File/Blob 存入 IndexedDB
    files.forEach((file) => {
      store.add({
        name: file.name || `shared_${Date.now()}`,
        type: file.type || 'application/octet-stream',
        size: file.size || 0,
        blob: file,
        title: metadata.title || '',
        text: metadata.text || '',
        url: metadata.url || '',
        receivedAt: new Date().toISOString()
      });
    });

    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

// 安裝階段：快取核心資產並立即接管
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return Promise.allSettled(
        STATIC_ASSETS.map((url) => cache.add(url).catch((err) => console.warn('[PWA SW] Pre-cache skipped for:', url, err)))
      );
    }).then(() => self.skipWaiting())
  );
});

// 啟動階段：清理舊版快取並立即宣告控制權
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            console.log('[PWA SW] Removing old cache:', key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// 請求攔截
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // 0. 攔截 Web Share Target POST 請求 (路徑包含 share-target)
  if (req.method === 'POST' && url.pathname.includes('share-target')) {
    event.respondWith((async () => {
      try {
        const formData = await req.formData();
        const mediaFiles = formData.getAll('media');
        const title = formData.get('title') || '';
        const text = formData.get('text') || '';
        const sharedUrl = formData.get('url') || '';

        console.log(`[PWA SW] 收到 Web Share Target 檔案分享: ${mediaFiles.length} 個檔案, title: ${title}, text: ${text}, url: ${sharedUrl}`);

        if (mediaFiles && mediaFiles.length > 0) {
          await saveSharedFiles(mediaFiles, { title, text, url: sharedUrl });
        } else if (sharedUrl || text) {
          // 純網址或純文字分享 (無附加檔案)
          await saveSharedFiles([{
            name: sharedUrl ? `url_${Date.now()}.url` : `text_${Date.now()}.txt`,
            type: sharedUrl ? 'text/uri-list' : 'text/plain',
            size: (sharedUrl || text).length
          }], { title, text, url: sharedUrl });
        }

        // 以 303 See Other 重新導向至主頁，並附加 #share-incoming 錨點喚醒前台
        return Response.redirect('./index.html#share-incoming', 303);
      } catch (err) {
        console.error('[PWA SW] 處理 Web Share Target 失敗:', err);
        return Response.redirect('./index.html#share-error', 303);
      }
    })());
    return;
  }

  // 1. 凡是 GAS (script.google.com)、Google Drive API 或非 GET 請求：一律 Network-Only，絕不快取
  if (
    req.method !== 'GET' ||
    url.hostname.includes('script.google.com') ||
    url.hostname.includes('script.googleusercontent.com') ||
    url.hostname.includes('googleapis.com') ||
    url.hostname.includes('google.com')
  ) {
    return event.respondWith(fetch(req));
  }

  // 2. 本地與同源靜態資源：Network-First (網路優先，失敗讀取快取)
  event.respondWith(
    fetch(req)
      .then((networkResponse) => {
        // 成功取得網路資源時，非同步更新快取
        if (networkResponse && networkResponse.status === 200) {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(req, responseToCache).catch(() => {});
          });
        }
        return networkResponse;
      })
      .catch(async () => {
        // 網路中斷時嘗試從快取讀取
        const cachedResponse = await caches.match(req);
        if (cachedResponse) {
          return cachedResponse;
        }
        // 若找不到且為頁面導覽，回退到主頁
        if (req.mode === 'navigate') {
          const fallback = await caches.match('./index.html');
          if (fallback) return fallback;
        }
        return new Response('Offline: Network unavailable', { status: 503, statusText: 'Service Unavailable' });
      })
  );
});
