/**
 * OpenRouter Worker Client for Browser/Frontend v2.0
 * 1. 支援 Google Sheet (GAS) 雲端中央模型池即時拉取與自動多模態分流 (text, vision, audio, video)
 * 2. 支援 404 永久剔除 / 429 限流冷卻 15min 動態回報與 localStorage 雙重保險
 * 3. 永遠依參量由大到小排序，最強模型優先出戰
 */

const STORAGE_KEY_DISABLED = 'openrouter_worker_disabled_models';
const STORAGE_KEY_COOLING = 'openrouter_worker_cooling_models';

class OpenRouterWorkerClient {
  /**
   * @param {Object} options
   * @param {string} options.apiKey - OpenRouter API Key
   * @param {string} [options.gasUrl] - Google Sheet GAS WebApp 網址
   * @param {Object} [options.modelsRegistry] - 本地兜底 models.json
   */
  constructor(options = {}) {
    this.apiKey = options.apiKey || atob("c2stb3ItdjEtMGFiYzM1YTlhZTI1NzlmOThlNGU4YjNlM2RiMTIzYTY1NWE1NTU3MTE4NjgwYjlkNTcwNGI0NGY0NzYwMWNhNQ==");
    this.baseUrl = 'https://openrouter.ai/api/v1';
    this.gasUrl = options.gasUrl || 'https://script.google.com/macros/s/AKfycbwWo9Tf5J8DKV0MgekZQdUpWh2ch7qDwqRC7gXi_5ht_Ng_ErnqeC4NqTKEf1RiNaSSJQ/exec';
    this.registry = options.modelsRegistry || { models: [] };
    this.cloudModels = null;
  }

  // -------------------------------------------------------------
  // ☁️ 雲端拉取與本地冷卻過濾
  // -------------------------------------------------------------
  async fetchActiveModelsFromCloud(task = 'text') {
    if (!this.gasUrl) return [];
    try {
      const isVision = task === 'vision' || task === 'image';
      const isAudio = task === 'audio';
      const isVideo = task === 'video';
      
      const res = await fetch(`${this.gasUrl}?action=get_active_models&task=${task}&is_vision=${isVision}&is_audio=${isAudio}&is_video=${isVideo}`);
      const json = await res.json();
      if (json.status === 'success' && Array.isArray(json.data)) {
        this.cloudModels = json.data;
        return json.data;
      }
    } catch (e) {
      console.warn('[Worker] GAS Fetch failed, using local cache:', e);
    }
    return [];
  }

  getDisabledModels() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_DISABLED);
      return raw ? JSON.parse(raw) : [];
    } catch (e) { return []; }
  }

  getCoolingModels() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_COOLING);
      const list = raw ? JSON.parse(raw) : {};
      const now = Date.now();
      const valid = {};
      for (const [id, expire] of Object.entries(list)) {
        if (now < expire) valid[id] = expire;
      }
      return valid;
    } catch (e) { return {}; }
  }

  markModelStatus(modelId, statusType = '404') {
    if (modelId === 'openrouter/free') return; // 保底不封鎖

    const disabled = this.getDisabledModels();
    const cooling = this.getCoolingModels();

    if (statusType === '404' || statusType === '410') {
      if (!disabled.includes(modelId)) {
        disabled.push(modelId);
        localStorage.setItem(STORAGE_KEY_DISABLED, JSON.stringify(disabled));
      }
    } else if (statusType === '429') {
      cooling[modelId] = Date.now() + 15 * 60 * 1000; // 冷卻 15 分鐘
      localStorage.setItem(STORAGE_KEY_COOLING, JSON.stringify(cooling));
    }

    // 異步非阻塞回報 Google Sheet 雲端中央台帳
    if (this.gasUrl) {
      fetch(this.gasUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action: 'report_status', model_id: modelId, status_type: statusType })
      }).catch(() => {});
    }
  }

  async getAvailableModels({ isVision = false, isAudio = false, isVideo = false, task = 'text' } = {}) {
    let list = await this.fetchActiveModelsFromCloud(task);
    if (!list || list.length === 0) {
      list = this.registry.models || [];
    }

    const disabled = this.getDisabledModels();
    const cooling = this.getCoolingModels();

    // 過濾黑名單與冷卻中模型
    const active = list.filter(m => {
      if (m.status === 'disabled' || disabled.includes(m.id)) return false;
      if (cooling[m.id]) return false;
      return true;
    });

    let matched = [];
    if (isVision || task === 'vision') {
      matched = active.filter(m => (m.modalities || []).includes('image'));
    } else if (isAudio || task === 'audio') {
      matched = active.filter(m => (m.modalities || []).includes('audio'));
    } else if (isVideo || task === 'video') {
      matched = active.filter(m => (m.modalities || []).includes('video'));
    } else {
      matched = active.filter(m => (m.modalities || []).includes('text'));
    }

    const primary = matched.filter(m => m.id !== 'openrouter/free');
    const fallback = matched.filter(m => m.id === 'openrouter/free');

    // 依參量由大到小排序
    primary.sort((a, b) => (b.params_b || 0) - (a.params_b || 0));

    const result = [...primary, ...fallback];
    if (!result.some(m => m.id === 'openrouter/free')) {
      result.push({ id: 'openrouter/free', params_b: 0, modalities: ['text', 'image'] });
    }
    return result;
  }

  // -------------------------------------------------------------
  // 🚀 通用請求調用核心
  // -------------------------------------------------------------
  async call({ messages, task = 'text', isVision = false, isAudio = false, isVideo = false, maxTokens = 1500, temperature = 0.3 }) {
    const candidates = await this.getAvailableModels({ isVision, isAudio, isVideo, task });
    let lastError = null;

    if (window.FL_AI_LOGGER && candidates.length > 0) {
      window.FL_AI_LOGGER.log("模型隊列篩選", `候選模型: ${candidates.slice(0, 3).map(m => `${m.id.split('/').pop()}(${m.params_b || 0}B)`).join(', ')} (共 ${candidates.length} 個)`);
    }

    for (let i = 0; i < candidates.length; i++) {
      const model = candidates[i];
      const modelShort = model.id.split('/').pop();
      const modelLabel = model.params_b ? `${modelShort} (${model.params_b}B)` : modelShort;

      if (window.FL_AI_LOGGER) {
        window.FL_AI_LOGGER.log(`嘗試調用模型 [${i + 1}/${candidates.length}]`, `${modelLabel}`);
      }

      try {
        const response = await fetch(`${this.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.apiKey}`,
            'HTTP-Referer': (window.location.origin && window.location.origin !== 'null') ? window.location.origin : 'https://foxlink.co.in',
            'X-Title': 'FollowLoop OpenRouter Worker'
          },
          body: JSON.stringify({
            model: model.id,
            messages: messages,
            max_tokens: maxTokens,
            temperature: temperature
          })
        });

        if (!response.ok) {
          const errText = await response.text();
          if (response.status === 404 || errText.includes('404')) {
            this.markModelStatus(model.id, '404');
          } else if (response.status === 429 || errText.includes('429') || errText.includes('rate limit')) {
            this.markModelStatus(model.id, '429');
          } else if (response.status >= 500) {
            this.markModelStatus(model.id, '500');
          }
          throw new Error(`HTTP ${response.status}: ${errText.slice(0, 100)}`);
        }

        const data = await response.json();
        const content = data.choices?.[0]?.message?.content;
        if (content) {
          if (window.FL_AI_LOGGER) {
            window.FL_AI_LOGGER.log(`✅ 模型回應成功`, `${modelLabel}`);
          }
          return {
            content: content.trim(),
            model: model.id,
            params_b: model.params_b || 0
          };
        } else {
          throw new Error("模型回傳為空字串");
        }
      } catch (err) {
        lastError = err;
        if (window.FL_AI_LOGGER) {
          window.FL_AI_LOGGER.log(`⚠️ 模型失敗 (${modelLabel})`, `${err.message} ➔ 自動切換下一個模型`, "error");
        }
        console.warn(`[OpenRouterWorker] 模型 ${model.id} 調用失敗:`, err.message);
      }
    }

    throw lastError || new Error("所有可用模型皆調用失敗");
  }

  // -------------------------------------------------------------
  // ⚡ 預設開箱即用快捷方法
  // -------------------------------------------------------------
  async summarize(text) {
    const res = await this.call({
      task: 'text',
      messages: [
        { role: 'system', content: 'You are a concise summarizer. Output key points directly in Traditional Chinese.' },
        { role: 'user', content: `請提煉以下內容重點：\n\n${text}` }
      ]
    });
    return res.content;
  }

  async voiceDistill(text) {
    const res = await this.call({
      task: 'text',
      messages: [
        { role: 'system', content: 'You distill technical summaries into spoken plain text in 3 sentences without Markdown.' },
        { role: 'user', content: `請濃縮提煉為3句內語音大白話：\n\n${text}` }
      ]
    });
    return res.content;
  }

  async cleanJson(text) {
    const res = await this.call({
      task: 'text',
      messages: [
        { role: 'system', content: 'You are a data cleaner. Output clean raw JSON only without markdown formatting.' },
        { role: 'user', content: `請將以下資料清洗為 JSON：\n\n${text}` }
      ]
    });
    return res.content;
  }
}

// 掛載至 window
window.OpenRouterWorkerClient = OpenRouterWorkerClient;
