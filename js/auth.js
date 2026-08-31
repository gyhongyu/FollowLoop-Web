/**
 * FollowLoop-Web 帳號驗證與登入模組 (auth.js)
 * 
 * 職責：
 * - 從 GAS 拉取 admin 頁籤比對帳密
 * - 「記住我」checkbox → localStorage 持久化 / sessionStorage 臨時
 * - per-user 主題映射 (fl_theme_{userId})
 * - 離線容錯：有本地帳密記錄 → 可離線登入；無記錄 → 僅能重試
 */

(function () {
  'use strict';

  const AUTH_SAVED_KEY = 'FL_AUTH_SAVED';       // localStorage: { id, password }
  const AUTH_SESSION_KEY = 'FL_AUTH_SESSION';    // sessionStorage: 當前登入 user 完整物件
  const AUTH_USERS_CACHE_KEY = 'FL_AUTH_USERS_CACHE'; // localStorage: 上次成功拉取的完整 admin 表

  let _onLoginSuccessCallback = null;

  /* --------------------------------------------------------------------------
     初始化登入介面
     -------------------------------------------------------------------------- */
  function initAuth(onLoginSuccess) {
    _onLoginSuccessCallback = onLoginSuccess;

    // 此函式由 app.js 在 DOMContentLoaded 內呼叫，DOM 已 ready，直接綁定
    const loginBtn = document.getElementById('login-submit-btn');
    const loginIdInput = document.getElementById('login-id');
    const loginPwInput = document.getElementById('login-password');
    const rememberCheckbox = document.getElementById('login-remember-me');

    // 綁定登入事件
    if (loginBtn) {
      loginBtn.addEventListener('click', _handleLoginClick);
    }

    // Enter 鍵也觸發登入
    [loginIdInput, loginPwInput].forEach(el => {
      if (el) {
        el.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') _handleLoginClick();
        });
      }
    });

    // 1. 若當前 Session 尚在 (網頁刷新 F5) → 直接秒速自動恢復登入狀態
    const currentSessionUser = getCurrentUser();
    if (currentSessionUser) {
      _loginSuccess(currentSessionUser, true);
      return;
    }

    // 2. 若有「記住我」的持久化帳密 → 自動填入 + 自動靜默驗證登入 (不需手動點登入按鈕)
    const saved = _getSavedCredentials();
    if (saved && saved.id && saved.password) {
      if (loginIdInput) loginIdInput.value = saved.id;
      if (loginPwInput) loginPwInput.value = saved.password;
      if (rememberCheckbox) rememberCheckbox.checked = true;

      // 自動靜默登入
      setTimeout(() => {
        doLogin(saved.id, saved.password, true);
      }, 0);
    }
  }

  /* --------------------------------------------------------------------------
     登入按鈕 click handler
     -------------------------------------------------------------------------- */
  async function _handleLoginClick() {
    const id = (document.getElementById('login-id').value || '').trim();
    const password = (document.getElementById('login-password').value || '').trim();
    const rememberMe = document.getElementById('login-remember-me').checked;

    _hideLoginError();

    if (!id || !password) {
      _showLoginError('請輸入帳號與密碼');
      return;
    }

    await doLogin(id, password, rememberMe);
  }

  /* --------------------------------------------------------------------------
     主登入流程
     -------------------------------------------------------------------------- */
  async function doLogin(id, password, rememberMe) {
    // 顯示全屏 Loading
    window.showFullscreenLoading('正在連線驗證帳號...', '讀取 admin 頁籤進行身份比對');

    try {
      // 拉取 admin 頁籤
      const res = await sendGasGetRequest('admin');

      if (!res || res.status !== 'success' || !Array.isArray(res.data)) {
        throw new Error('admin 頁籤回傳格式異常');
      }

      // 快取完整 admin 表到 localStorage (供離線用)
      try {
        localStorage.setItem(AUTH_USERS_CACHE_KEY, JSON.stringify(res.data));
      } catch (e) { /* ignore storage errors */ }

      // 比對帳密 (跳過第 0 列標頭)
      const user = _matchUser(res.data, id, password);

      if (user) {
        _loginSuccess(user, rememberMe);
      } else {
        window.hideFullscreenLoading();
        _showLoginError('帳號或密碼錯誤，請重新輸入');
      }

    } catch (err) {
      console.warn('[Auth] GAS 連線失敗:', err);
      window.hideFullscreenLoading();
      _handleOfflineLogin(id, password, rememberMe);
    }
  }

  /* --------------------------------------------------------------------------
     離線容錯登入
     -------------------------------------------------------------------------- */
  function _handleOfflineLogin(id, password, rememberMe) {
    const saved = _getSavedCredentials();

    if (saved && saved.id === id && saved.password === password) {
      // 有本地匹配 → 提供「重試 / 離線模式」選擇
      _showOfflineChoiceDialog(id, password, rememberMe, true);
    } else if (saved) {
      // 有本地記錄但不匹配
      _showOfflineChoiceDialog(id, password, rememberMe, false);
    } else {
      // 完全無本地記錄 → 僅能重試
      _showOfflineChoiceDialog(id, password, rememberMe, false);
    }
  }

  /* --------------------------------------------------------------------------
     離線選擇彈窗 (重試 / 離線模式)
     -------------------------------------------------------------------------- */
  function _showOfflineChoiceDialog(id, password, rememberMe, canOffline) {
    // 移除舊彈窗
    const oldDialog = document.getElementById('offline-choice-dialog');
    if (oldDialog) oldDialog.remove();

    const dialog = document.createElement('div');
    dialog.id = 'offline-choice-dialog';
    dialog.className = 'offline-dialog-backdrop';
    dialog.innerHTML = `
      <div class="offline-dialog-card">
        <div class="offline-dialog-icon">⚠️</div>
        <div class="offline-dialog-title">無法連線至雲端</div>
        <div class="offline-dialog-text">
          ${canOffline
            ? '網路連線失敗，您可以選擇重試或使用離線模式繼續編輯。'
            : '網路連線失敗，且本機無已記住的帳號資料，請確認網路後重試。'
          }
        </div>
        <div class="offline-dialog-actions">
          <button class="offline-btn-retry" id="offline-btn-retry">🔄 重試</button>
          ${canOffline ? '<button class="offline-btn-offline" id="offline-btn-offline">📴 離線模式</button>' : ''}
        </div>
      </div>
    `;

    document.body.appendChild(dialog);

    // 重試按鈕
    document.getElementById('offline-btn-retry').addEventListener('click', () => {
      dialog.remove();
      doLogin(id, password, rememberMe);
    });

    // 離線模式按鈕
    if (canOffline) {
      document.getElementById('offline-btn-offline').addEventListener('click', () => {
        dialog.remove();
        // 使用本地快取的 admin 表嘗試建立 user 物件
        const cachedData = _getCachedAdminData();
        let user = null;
        if (cachedData) {
          user = _matchUser(cachedData, id, password);
        }
        if (!user) {
          // 如果快取也沒有完整資訊，建立最小 user 物件
          const saved = _getSavedCredentials();
          user = {
            id: saved.id,
            password: saved.password,
            roles: 'user',
            name: saved.id,
            email: '',
            note: '',
            con_temple: ''
          };
        }
        _loginSuccess(user, rememberMe);
      });
    }
  }

  /* --------------------------------------------------------------------------
     比對 admin 表中的帳密 (跳過標頭列)
     admin 表結構: [id, password, roles, name, email, note, con_temple]
     -------------------------------------------------------------------------- */
  function _matchUser(data, id, password) {
    if (!data || data.length < 2) return null;

    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      if (!row || !row[0]) continue;

      const rowId = String(row[0]).trim();
      const rowPw = String(row[1]).trim();

      if (rowId === id && rowPw === password) {
        return {
          id: rowId,
          password: rowPw,
          roles: String(row[2] || '').trim(),
          name: String(row[3] || '').trim(),
          email: String(row[4] || '').trim(),
          note: String(row[5] || '').trim(),
          con_temple: String(row[6] || '').trim()
        };
      }
    }
    return null;
  }

  /* --------------------------------------------------------------------------
     登入成功處理
     -------------------------------------------------------------------------- */
  function _loginSuccess(user, rememberMe) {
    // 1. 存入 sessionStorage (當前 session)
    try {
      sessionStorage.setItem(AUTH_SESSION_KEY, JSON.stringify(user));
    } catch (e) { /* ignore */ }

    // 2. 記住我 → localStorage；不勾 → 清除
    if (rememberMe) {
      try {
        localStorage.setItem(AUTH_SAVED_KEY, JSON.stringify({ id: user.id, password: user.password }));
      } catch (e) { /* ignore */ }
    } else {
      localStorage.removeItem(AUTH_SAVED_KEY);
    }

    // 3. 套用主題
    _applyUserTheme(user);

    // 4. 隱藏登入遮罩，顯示主應用
    const loginOverlay = document.getElementById('login-overlay');
    if (loginOverlay) {
      loginOverlay.classList.add('fade-out');
      setTimeout(() => {
        loginOverlay.classList.remove('active');
        loginOverlay.classList.remove('fade-out');
      }, 350);
    }

    const appContainer = document.getElementById('app-main-container');
    if (appContainer) {
      appContainer.style.display = '';
    }

    window.hideFullscreenLoading();

    // 5. 觸發 app 初始化 callback
    if (_onLoginSuccessCallback) {
      _onLoginSuccessCallback(user);
    }
  }

  /* --------------------------------------------------------------------------
     Per-user 主題套用
     -------------------------------------------------------------------------- */
  function _applyUserTheme(user) {
    const userId = user.id;
    const perUserKey = `fl_theme_${userId}`;

    // 優先使用本機 per-user 偏好 (使用者曾手動切換過)
    const localPref = localStorage.getItem(perUserKey);

    if (localPref) {
      document.documentElement.setAttribute('data-theme', localPref);
    } else if (user.con_temple) {
      // 使用 admin 表設定的預設主題
      document.documentElement.setAttribute('data-theme', user.con_temple);
      // 也存一份到 per-user key，作為初始值
      try {
        localStorage.setItem(perUserKey, user.con_temple);
      } catch (e) { /* ignore */ }
    }
    // 如果都沒有，保持 head 裡的阻塞式 init 設的 midnight
  }

  /* --------------------------------------------------------------------------
     輔助函式
     -------------------------------------------------------------------------- */
  function _getSavedCredentials() {
    try {
      const raw = localStorage.getItem(AUTH_SAVED_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }

  function _getCachedAdminData() {
    try {
      const raw = localStorage.getItem(AUTH_USERS_CACHE_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }

  function _showLoginError(msg) {
    const el = document.getElementById('login-error-msg');
    if (el) {
      el.textContent = msg;
      el.classList.remove('hidden');
    }
  }

  function _hideLoginError() {
    const el = document.getElementById('login-error-msg');
    if (el) {
      el.classList.add('hidden');
    }
  }

  /**
   * 全域可用：取得當前登入的使用者物件
   */
  function getCurrentUser() {
    try {
      const raw = sessionStorage.getItem(AUTH_SESSION_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) { /* ignore */ }
    return null;
  }

  /* --------------------------------------------------------------------------
     公開 API
     -------------------------------------------------------------------------- */
  window.FL_AUTH = {
    initAuth,
    getCurrentUser
  };

  // 全域快捷方法
  window.getCurrentUser = getCurrentUser;

})();
