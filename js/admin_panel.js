/* ==========================================================================
   FollowLoop-Web Admin Panel 主題控制器 (admin_panel.js)
   純本地 localStorage 儲存，無需任何雲端 API
   ========================================================================== */

(function () {
  'use strict';

  /* --------------------------------------------------------------------------
     主題定義 (對應 themes.css 中的 [data-theme])
     -------------------------------------------------------------------------- */
  const THEMES = [
    {
      id: 'midnight',
      name: '深邃午夜',
      desc: '經典深色 + 靛紫對比',
      colors: ['#0b0f19', '#1e293b', '#6366f1', '#ec4899'],
    },
    {
      id: 'light-slate',
      name: '極簡純白 ☀️',
      desc: '清爽亮底 + 深色文字',
      colors: ['#e2e8f0', '#ffffff', '#4f46e5', '#0f172a'],
    },
    {
      id: 'emerald-dark',
      name: '翡翠極光',
      desc: '深綠藍底 + 翡翠綠邊',
      colors: ['#021a1a', '#093333', '#10b981', '#34d399'],
    },
    {
      id: 'amber-glow',
      name: '琥珀香檳',
      desc: '暖金暗底 + 琥珀亮邊',
      colors: ['#1c130b', '#362514', '#f59e0b', '#fbbf24'],
    },
  ];

  const STORAGE_KEY_PREFIX = 'fl_theme';
  const DEFAULT_THEME = 'midnight';

  /**
   * 取得當前使用者的 per-user 主題 localStorage key
   * 若尚未登入則 fallback 到通用 key
   */
  function _getStorageKey() {
    const user = window.getCurrentUser ? window.getCurrentUser() : null;
    if (user && user.id) {
      return `${STORAGE_KEY_PREFIX}_${user.id}`;
    }
    return STORAGE_KEY_PREFIX;
  }

  /* --------------------------------------------------------------------------
     動態切換 Header LOGO (淺色主題使用 deepbluelogo_foxlink-m.png)
     -------------------------------------------------------------------------- */
  function _updateLogo(themeId) {
    const logoImg = document.getElementById('brand-logo-img');
    if (!logoImg) return;
    if (themeId === 'light-slate') {
      logoImg.src = 'img/deepbluelogo_foxlink-m.png';
    } else {
      logoImg.src = 'img/wlogo_foxlink_s.png';
    }
  }

  /* --------------------------------------------------------------------------
     套用主題 (設定 html data-theme + localStorage)
     -------------------------------------------------------------------------- */
  function setTheme(themeId) {
    const theme = THEMES.find(t => t.id === themeId) || THEMES[0];
    document.documentElement.setAttribute('data-theme', theme.id);
    localStorage.setItem(_getStorageKey(), theme.id);
    _updateLogo(theme.id);
    _updateActiveCard(theme.id);
  }

  /* --------------------------------------------------------------------------
     開啟 / 關閉 Admin Panel
     -------------------------------------------------------------------------- */
  function openAdminPanel() {
    const panel = document.getElementById('admin-panel');
    const backdrop = document.getElementById('admin-panel-backdrop');
    if (!panel || !backdrop) return;

    backdrop.style.display = 'block';
    requestAnimationFrame(() => {
      backdrop.classList.add('active');
      panel.classList.add('active');
    });

    _updateActiveCard(document.documentElement.getAttribute('data-theme') || DEFAULT_THEME);

  }

  function closeAdminPanel() {
    const panel = document.getElementById('admin-panel');
    const backdrop = document.getElementById('admin-panel-backdrop');
    if (!panel || !backdrop) return;
    panel.classList.remove('active');
    backdrop.classList.remove('active');
    setTimeout(() => { backdrop.style.display = 'none'; }, 280);
  }

  /* --------------------------------------------------------------------------
     更新主題卡片的選中狀態
     -------------------------------------------------------------------------- */
  function _updateActiveCard(themeId) {
    document.querySelectorAll('.theme-card').forEach(card => {
      if (card.dataset.theme === themeId) {
        card.classList.add('active');
      } else {
        card.classList.remove('active');
      }
    });
  }

  /* --------------------------------------------------------------------------
     生成主題卡片 HTML
     -------------------------------------------------------------------------- */
  function _buildThemeCards() {
    const container = document.getElementById('theme-cards-container');
    if (!container) return;

    const currentTheme = localStorage.getItem(_getStorageKey()) || DEFAULT_THEME;

    container.innerHTML = THEMES.map(theme => `
      <div class="theme-card ${theme.id === currentTheme ? 'active' : ''}"
           data-theme="${theme.id}"
           onclick="window.FL_ADMIN.setTheme('${theme.id}')"
           title="${theme.name}">
        <div class="theme-card-preview">
          ${theme.colors.map(c => `<div class="theme-preview-bar" style="background:${c};"></div>`).join('')}
        </div>
        <div class="theme-card-name">${theme.name}</div>
        <div class="theme-card-desc">${theme.desc}</div>
      </div>
    `).join('');
  }

  /* --------------------------------------------------------------------------
     PWA 安裝與狀態檢測邏輯
     -------------------------------------------------------------------------- */
  let deferredInstallPrompt = null;

  window.addEventListener('beforeinstallprompt', (e) => {
    // 阻止 Chrome 67 及之前版本的默認迷你資訊列
    e.preventDefault();
    deferredInstallPrompt = e;
    _renderPwaStatus();
  });

  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    console.log('[PWA] FollowLoop App was installed successfully');
    _renderPwaStatus();
  });

  function isStandalone() {
    return window.matchMedia('(display-mode: standalone)').matches ||
           window.navigator.standalone === true ||
           document.referrer.includes('android-app://');
  }

  function _renderPwaStatus() {
    const container = document.getElementById('pwa-status-container');
    if (!container) return;

    if (isStandalone()) {
      container.innerHTML = `
        <div style="background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.3); border-radius: var(--radius-sm); padding: 10px; font-size: 0.82rem; color: #34d399; display: flex; align-items: center; gap: 8px;">
          <span>✅</span>
          <div>
            <b>已在獨立 App 模式運行</b>
            <div style="font-size: 0.72rem; color: var(--text-muted);">享有原生全螢幕、獨立圖示與快取加速</div>
          </div>
        </div>
      `;
      return;
    }

    // 若瀏覽器支援一鍵安裝
    if (deferredInstallPrompt) {
      container.innerHTML = `
        <button id="pwa-install-btn" class="btn-primary" style="width: 100%; justify-content: center; padding: 10px; font-size: 0.88rem;">
          <span>📲 安裝 FollowLoop App 到手機/桌面</span>
        </button>
      `;
      const btn = document.getElementById('pwa-install-btn');
      if (btn) {
        btn.onclick = async () => {
          if (!deferredInstallPrompt) return;
          deferredInstallPrompt.prompt();
          const { outcome } = await deferredInstallPrompt.userChoice;
          console.log('[PWA] User response to install prompt:', outcome);
          deferredInstallPrompt = null;
          _renderPwaStatus();
        };
      }
      return;
    }

    // iOS / 通用手動引導
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    if (isIOS) {
      container.innerHTML = `
        <div style="background: rgba(99, 102, 241, 0.08); border: 1px solid rgba(99, 102, 241, 0.25); border-radius: var(--radius-sm); padding: 10px; font-size: 0.8rem; color: var(--text-main);">
          <div style="font-weight: 700; color: #818cf8; margin-bottom: 4px;">📲 安裝到 iPhone / iPad 主畫面：</div>
          <div style="color: var(--text-muted); font-size: 0.76rem; line-height: 1.4;">
            1. 點擊 Safari 底部工具列的 <b>分享按鈕 (⎋)</b><br>
            2. 向下滾動並選擇 <b>「加入主畫面」</b> ➔ 點擊右上角「新增」即可！
          </div>
        </div>
      `;
    } else {
      container.innerHTML = `
        <div style="background: rgba(255, 255, 255, 0.03); border: 1px solid var(--border-card-light); border-radius: var(--radius-sm); padding: 10px; font-size: 0.78rem; color: var(--text-muted);">
          📲 <b>App 模式</b>：點擊瀏覽器選單 (⋮) ➔ 選擇「安裝應用程式」或「新增至主畫面」
        </div>
      `;
    }
  }

  /* --------------------------------------------------------------------------
     打工仔 (OpenRouter Worker v2.0) 雲端中央模型總帳狀態檢視
     -------------------------------------------------------------------------- */
  async function _renderOpenRouterSettings() {
    const container = document.getElementById('openrouter-settings-container');
    if (!container) return;

    const currentKey = getOpenRouterApiKey();

    container.innerHTML = `
      <div style="background: rgba(255, 255, 255, 0.02); border: 1px solid var(--border-card-light); border-radius: var(--radius-sm); padding: 14px; margin-top: 18px;">
        <div class="admin-section-label" style="margin-bottom: 8px; display: flex; align-items: center; justify-content: space-between;">
          <span>🤖 打工仔中央模型總帳 (v2.0)</span>
          <span style="font-size: 0.72rem; color: #10b981; background: rgba(16,185,129,0.1); padding: 2px 6px; border-radius: 4px;">Google Sheet SSOT</span>
        </div>
        
        <div style="margin-bottom: 10px;">
          <label style="display: block; font-size: 0.76rem; color: var(--text-muted); margin-bottom: 4px;">OpenRouter API Key:</label>
          <input type="password" id="admin-openrouter-key" class="form-control" style="font-size: 0.8rem; font-family: monospace;" value="${currentKey}">
        </div>

        <div style="margin-bottom: 12px;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
            <label style="font-size: 0.76rem; color: var(--text-muted);">雲端活躍模型池 (按參量降序):</label>
            <button id="admin-refresh-models-btn" class="btn-card-action" style="padding: 2px 8px; font-size: 0.7rem;">🔄 刷新總帳</button>
          </div>
          <div id="admin-models-list-box" style="max-height: 120px; overflow-y: auto; background: rgba(0,0,0,0.25); border: 1px solid var(--border-card-light); border-radius: 6px; padding: 6px; font-size: 0.74rem; font-family: monospace; color: var(--text-main);">
            <div style="color: var(--text-muted);">正在載入雲端模型...</div>
          </div>
          <div style="font-size: 0.7rem; color: var(--text-subtle); margin-top: 4px;">多模態 (Text / Vision / Audio) 自動分流與 429 限流自癒保護中</div>
        </div>

        <button id="admin-save-openrouter-btn" class="btn-primary" style="width: 100%; justify-content: center; padding: 7px; font-size: 0.82rem;">
          <span>💾 儲存 API Key</span>
        </button>
      </div>
    `;

    const loadModels = async () => {
      const box = document.getElementById('admin-models-list-box');
      if (!box) return;
      try {
        if (window.openRouterExtractor && window.openRouterExtractor.worker) {
          const list = await window.openRouterExtractor.worker.getAvailableModels({ task: 'text' });
          if (list && list.length > 0) {
            box.innerHTML = list.map((m, i) => `
              <div style="display:flex; justify-content:space-between; padding:2px 0; border-bottom:1px solid rgba(255,255,255,0.05);">
                <span>${i + 1}. ${m.id}</span>
                <span style="color:#818cf8;">${m.params_b ? m.params_b + 'B' : ''}</span>
              </div>
            `).join('');
            return;
          }
        }
        box.innerHTML = '<div style="color:var(--text-muted);">載入完成 (使用預設隊列)</div>';
      } catch (e) {
        box.innerHTML = `<div style="color:#f87171;">載入失敗: ${e.message}</div>`;
      }
    };

    loadModels();

    const refreshBtn = document.getElementById('admin-refresh-models-btn');
    if (refreshBtn) {
      refreshBtn.onclick = () => {
        const box = document.getElementById('admin-models-list-box');
        if (box) box.innerHTML = '<div style="color: var(--text-muted);">正在刷新雲端模型...</div>';
        loadModels();
      };
    }

    const saveBtn = document.getElementById('admin-save-openrouter-btn');
    if (saveBtn) {
      saveBtn.onclick = () => {
        const keyInput = document.getElementById('admin-openrouter-key');
        if (keyInput && keyInput.value.trim()) {
          localStorage.setItem('fl_openrouter_key', keyInput.value.trim());
          if (window.openRouterExtractor && window.openRouterExtractor.worker) {
            window.openRouterExtractor.worker.apiKey = keyInput.value.trim();
          }
        }
        if (window.showToast) window.showToast("已成功儲存 OpenRouter API Key！", "success");
      };
    }
  }

  /* --------------------------------------------------------------------------
     初始化 (DOMContentLoaded 後執行)
     -------------------------------------------------------------------------- */
  function init() {
    // 初始主題：優先用已登入使用者的 per-user key，否則用通用 key
    const saved = localStorage.getItem(_getStorageKey()) || DEFAULT_THEME;
    document.documentElement.setAttribute('data-theme', saved);

    document.addEventListener('DOMContentLoaded', () => {
      _updateLogo(saved);
      _buildThemeCards();
      _renderPwaStatus();
      _renderOpenRouterSettings();

      const btn = document.getElementById('admin-panel-btn');
      if (btn) btn.addEventListener('click', () => {
        openAdminPanel();
        _renderPwaStatus();
        _renderOpenRouterSettings();
      });

      const closeBtn = document.getElementById('admin-panel-close-btn');
      if (closeBtn) closeBtn.addEventListener('click', closeAdminPanel);

      const backdrop = document.getElementById('admin-panel-backdrop');
      if (backdrop) backdrop.addEventListener('click', closeAdminPanel);
    });
  }

  /**
   * 登入成功後重新初始化主題卡片 (由 auth.js 呼叫)
   */
  function refreshAfterLogin() {
    const current = document.documentElement.getAttribute('data-theme') || DEFAULT_THEME;
    _updateLogo(current);
    _buildThemeCards();
    _renderPwaStatus();
  }

  window.FL_ADMIN = {
    setTheme,
    openAdminPanel,
    closeAdminPanel,
    init,
    refreshAfterLogin,
    renderPwaStatus: _renderPwaStatus,
  };

  init();
})();

