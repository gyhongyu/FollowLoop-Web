/**
 * OpenRouter Worker Client for Browser/Frontend v2.0
 * 1. 支援 Google Sheet (GAS) 雲端中央模型池即時拉取與自動多模態分流 (text, vision, audio, video)
 * 2. 支援 404 永久剔除 / 429 限流冷卻 15min 動態回報與 localStorage 雙重保險
 * 3. 永遠依參量由大到小排序，最強模型優先出戰
 */

const STORAGE_KEY_DISABLED = 'openrouter_worker_disabled_models';
const STORAGE_KEY_COOLING = 'openrouter_worker_cooling_models';
const STORAGE_KEY_LAST_USED = 'openrouter_worker_last_used_map';

class OpenRouterWorkerClient {
  /**
   * @param {Object} options
   * @param {string} [options.apiKey] - OpenRouter API Key
   * @param {string} [options.gasUrl] - Google Sheet GAS WebApp 網址
   * @param {Object} [options.modelsRegistry] - 本地兜底 models.json
   */
  constructor(options = {}) {
    this.apiKey = options.apiKey || (window.CONFIG && CONFIG.OPENROUTER_DEFAULT_KEY) || '';
    this.groqApiKey = options.groqApiKey || localStorage.getItem('fl_groq_key') || '';
    this.geminiApiKey = options.geminiApiKey || localStorage.getItem('fl_gemini_key') || '';
    
    this.baseUrl = 'https://openrouter.ai/api/v1';
    this.groqBaseUrl = 'https://api.groq.com/openai/v1';
    this.geminiBaseUrl = 'https://generativelanguage.googleapis.com/v1beta/openai';

    this.gasUrl = options.gasUrl || 'https://script.google.com/macros/s/AKfycbwWo9Tf5J8DKV0MgekZQdUpWh2ch7qDwqRC7gXi_5ht_Ng_ErnqeC4NqTKEf1RiNaSSJQ/exec';
    this.registry = options.modelsRegistry || { models: [] };
    this.cloudModels = null;
  }

  getEndpointForModel(modelId) {
    const mid = String(modelId || '').toLowerCase();
    if (mid.startsWith('openai/gpt-oss') || mid.startsWith('qwen/') || mid.startsWith('groq/') || mid.includes('whisper')) {
      return {
        url: `${this.groqBaseUrl}/chat/completions`,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.groqApiKey}`
        },
        targetModel: modelId
      };
    } else if (mid.startsWith('gemini-') || mid.startsWith('models/gemini')) {
      return {
        url: `${this.geminiBaseUrl}/chat/completions`,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.geminiApiKey}`
        },
        targetModel: modelId.replace('models/', '')
      };
    } else {
      return {
        url: `${this.baseUrl}/chat/completions`,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
          'HTTP-Referer': (typeof window !== 'undefined' && window.location.origin) ? window.location.origin : 'http://localhost',
          'X-Title': 'OpenRouter Universal Worker'
        },
        targetModel: modelId
      };
    }
  }

  // -------------------------------------------------------------
  // ☁️ 雲端拉取與本地冷卻/輪替管理
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

  getLastUsedMap() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_LAST_USED);
      return raw ? JSON.parse(raw) : {};
    } catch (e) { return {}; }
  }

  recordModelSuccess(modelId) {
    if (!modelId) return;
    try {
      const map = this.getLastUsedMap();
      map[modelId] = Date.now();
      localStorage.setItem(STORAGE_KEY_LAST_USED, JSON.stringify(map));
    } catch (e) {}

    // 異步回報雲端解除冷卻與成功計數
    if (this.gasUrl) {
      fetch(this.gasUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action: 'report_status', model_id: modelId, status_type: 'success' })
      }).catch(() => {});
    }
  }

  markModelStatus(modelId, statusType = '404') {
    if (modelId === 'openrouter/free') return;

    const disabled = this.getDisabledModels();
    const cooling = this.getCoolingModels();

    if (statusType === '404' || statusType === '410') {
      if (!disabled.includes(modelId)) {
        disabled.push(modelId);
        localStorage.setItem(STORAGE_KEY_DISABLED, JSON.stringify(disabled));
      }
    } else if (statusType === '429') {
      cooling[modelId] = Date.now() + 15 * 60 * 1000;
      localStorage.setItem(STORAGE_KEY_COOLING, JSON.stringify(cooling));
    } else if (statusType === '500' || statusType === '503') {
      cooling[modelId] = Date.now() + 3 * 60 * 1000;
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

  async getAvailableModels({ isVision = false, isAudio = false, isVideo = false, task = 'text', minParamsB = 0 } = {}) {
    let list = await this.fetchActiveModelsFromCloud(task);
    if (!list || list.length === 0) {
      list = this.registry.models || [];
    }

    const disabled = this.getDisabledModels();
    const cooling = this.getCoolingModels();
    const lastUsedMap = this.getLastUsedMap();

    // 過濾黑名單、冷卻中與低於最低參量要求的模型
    const active = list.filter(m => {
      if (m.status === 'disabled' || disabled.includes(m.id)) return false;
      if (cooling[m.id]) return false;
      if (minParamsB > 0 && m.id !== 'openrouter/free' && (m.params_b || 0) < minParamsB) return false;
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

    // 🌟 智慧階梯分桶 (Tiered Buckets)：≥100B 旗艦或 Gemini 全系皆進入 Tier 1 主力梯隊
    const tier1 = primary.filter(m => (m.params_b || 0) >= 100 || (m.id || '').toLowerCase().includes('gemini'));
    const tier2 = primary.filter(m => (m.params_b || 0) >= 30 && (m.params_b || 0) < 100 && !(m.id || '').toLowerCase().includes('gemini'));
    const tier3 = primary.filter(m => (m.params_b || 0) > 0 && (m.params_b || 0) < 30 && !(m.id || '').toLowerCase().includes('gemini'));

    // 🌟 同階梯 LRU 最久未調用優先出戰
    const sortByLru = (arr) => arr.slice().sort((a, b) => (lastUsedMap[a.id] || 0) - (lastUsedMap[b.id] || 0));

    const result = [...sortByLru(tier1), ...sortByLru(tier2), ...sortByLru(tier3), ...fallback];
    if (!result.some(m => m.id === 'openrouter/free')) {
      result.push({ id: 'openrouter/free', name: 'OpenRouter Free Auto-Router', params_b: 0, modalities: ['text', 'image'], status: 'active' });
    }
    return result;
  }

  // -------------------------------------------------------------
  // 🚀 通用請求調用核心 (支援 onProgress 動態解耦日誌事件與多平台端點適配)
  // -------------------------------------------------------------
  async call({ messages, task = 'text', isVision = false, isAudio = false, isVideo = false, minParamsB = 0, temperature = 0.3, maxTokens = null, max_tokens = null, onProgress = null }) {
    const candidates = await this.getAvailableModels({ isVision, isAudio, isVideo, task, minParamsB });
    let lastError = null;
    let attempt = 0;

    for (const model of candidates) {
      attempt++;
      const pLabel = model.params_b ? ` (${model.params_b}B)` : '';
      if (typeof onProgress === 'function') {
        onProgress({
          stage: 'connecting',
          model: model.id,
          modelName: model.name || model.id,
          params_b: model.params_b || 0,
          attempt: attempt,
          total: candidates.length,
          message: `🤖 連線打工仔模型: ${model.id}${pLabel} ...`
        });
      }

      try {
        const endpoint = this.getEndpointForModel(model.id);
        const reqBody = {
          model: endpoint.targetModel,
          messages: messages,
          temperature: temperature
        };
        const tokenLimit = maxTokens || max_tokens;
        if (tokenLimit && tokenLimit > 0) {
          reqBody.max_tokens = tokenLimit;
        }

        const response = await fetch(endpoint.url, {
          method: 'POST',
          headers: endpoint.headers,
          body: JSON.stringify(reqBody)
        });

        if (!response.ok) {
          const errText = await response.text();
          let statusType = '500';
          if (response.status === 404 || errText.includes('404')) {
            statusType = '404';
          } else if (response.status === 429 || errText.includes('429') || errText.includes('rate limit')) {
            statusType = '429';
          }
          this.markModelStatus(model.id, statusType);

          const warnMsg = `模型 ${model.id} HTTP ${response.status} (${statusType === '429' ? '頻率限制冷卻15分' : '異常'})，自動輪替至下一位打工仔...`;
          if (typeof onProgress === 'function') {
            onProgress({ stage: 'error', model: model.id, statusType, message: `⚠️ ${warnMsg}` });
          }
          throw new Error(`HTTP ${response.status}: ${errText}`);
        }

        if (typeof onProgress === 'function') {
          onProgress({ stage: 'receiving', model: model.id, message: '📥 收到模型回執數據，正在校驗結構...' });
        }

        const data = await response.json();
        const content = data.choices?.[0]?.message?.content;
        if (content) {
          this.recordModelSuccess(model.id);
          if (typeof onProgress === 'function') {
            onProgress({ stage: 'success', model: model.id, message: `🎉 模型 ${model.id} 解析成功！` });
          }
          const trimmed = content.trim();
          return {
            content: trimmed,
            model: model.id,
            params_b: model.params_b || 0,
            toString() { return this.content; },
            valueOf() { return this.content; }
          };
        } else {
          throw new Error(`Invalid or empty choices returned from ${model.id}`);
        }
      } catch (err) {
        lastError = err;
        continue;
      }
    }

    throw new Error(`所有打工仔模型皆暫時無法回應。最後錯誤: ${lastError?.message || lastError}`);
  }

  // -------------------------------------------------------------
  // ⚡ 預設開箱即用快捷方法
  // -------------------------------------------------------------
  async summarize(text) {
    return this.call({
      task: 'text',
      messages: [
        { role: 'system', content: 'You are a concise summarizer. Output key points directly in Traditional Chinese.' },
        { role: 'user', content: `請提煉以下內容重點：\n\n${text}` }
      ]
    });
  }

  async voiceDistill(text) {
    return this.call({
      task: 'text',
      messages: [
        { role: 'system', content: 'You distill technical summaries into spoken plain text in 3 sentences without Markdown.' },
        { role: 'user', content: `請濃縮提煉為3句內語音大白話：\n\n${text}` }
      ]
    });
  }

  async cleanJson(text) {
    return this.call({
      task: 'text',
      messages: [
        { role: 'system', content: 'You are a data cleaner. Output clean raw JSON only without markdown formatting.' },
        { role: 'user', content: `請將以下資料清洗為 JSON：\n\n${text}` }
      ]
    });
  }
}

if (typeof window !== 'undefined') {
  window.OpenRouterWorkerClient = OpenRouterWorkerClient;
}
