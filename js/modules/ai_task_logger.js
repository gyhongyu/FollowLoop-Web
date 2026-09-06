/**
 * FollowLoop-Web AI 任務狀態機與即時監控台模組 (ai_task_logger.js)
 * 負責：全域 LLM 任務狀態顯示、日誌記錄、右側任務日誌抽屜管理
 */

class AiTaskLogger {
  constructor() {
    this.logs = [];
    this.currentTask = null;
    this.startTime = 0;
  }

  startTask(taskName, details = "", taskType = "ai") {
    this.startTime = Date.now();
    this.currentTask = { name: taskName, status: "RUNNING", startTime: this.startTime, type: taskType };
    const pillLabel = taskType === "upload" ? "⚡ 雲端直傳" : "⚡ 執行中";
    this.updatePill(pillLabel, "running", taskName);
    this.appendLog(`🚀 [${taskType === "upload" ? "直傳" : "開始"}] ${taskName} ${details ? `(${details})` : ""}`);
  }

  log(step, details = "", status = "running") {
    const elapsed = ((Date.now() - this.startTime) / 1000).toFixed(1);
    this.appendLog(`  • [${elapsed}s] ${step} ${details ? `— ${details}` : ""}`, status);
    if (this.currentTask) {
      this.updatePill(`⚡ ${step} (${elapsed}s)`, "running", this.currentTask.name);
    }
  }

  completeTask(message = "完成") {
    const elapsed = ((Date.now() - this.startTime) / 1000).toFixed(1);
    this.appendLog(`🎉 [完成] ${message} (總耗時: ${elapsed}s)`, "success");
    this.currentTask = null;
    this.updatePill("AI 就緒", "success", "上一個任務已完成");
  }

  failTask(errorMessage = "執行失敗") {
    const elapsed = ((Date.now() - this.startTime) / 1000).toFixed(1);
    this.appendLog(`❌ [失敗] ${errorMessage} (停格於: ${elapsed}s)`, "error");
    this.currentTask = null;
    this.updatePill("AI 異常", "error", errorMessage);
  }

  appendLog(text, level = "info") {
    const timeStr = new Date().toLocaleTimeString("zh-TW", { hour12: false });
    this.logs.unshift({ time: timeStr, text, level });
    if (this.logs.length > 50) this.logs.pop();
    this.renderDrawerLogs();
  }

  updatePill(text, state = "idle", title = "") {
    const pill = document.getElementById("ai-task-status-pill");
    const textEl = document.getElementById("ai-task-status-text");
    const iconEl = document.getElementById("ai-task-status-icon");
    if (!pill) return;

    if (textEl) textEl.textContent = text;
    if (title) pill.title = title;

    if (state === "running") {
      pill.style.background = "rgba(245, 158, 11, 0.25)";
      pill.style.color = "#fbbf24";
      pill.style.borderColor = "rgba(245, 158, 11, 0.6)";
      pill.style.boxShadow = "0 0 10px rgba(245, 158, 11, 0.4)";
      if (iconEl) iconEl.textContent = "⚡";
    } else if (state === "success") {
      pill.style.background = "rgba(16, 185, 129, 0.2)";
      pill.style.color = "#34d399";
      pill.style.borderColor = "rgba(16, 185, 129, 0.5)";
      pill.style.boxShadow = "none";
      if (iconEl) iconEl.textContent = "🤖";
    } else if (state === "error") {
      pill.style.background = "rgba(239, 68, 68, 0.25)";
      pill.style.color = "#f87171";
      pill.style.borderColor = "rgba(239, 68, 68, 0.6)";
      pill.style.boxShadow = "0 0 10px rgba(239, 68, 68, 0.4)";
      if (iconEl) iconEl.textContent = "⚠️";
    } else {
      // 💤 閒置待命狀態：睡覺圖標
      pill.style.background = "rgba(99, 102, 241, 0.12)";
      pill.style.color = "#818cf8";
      pill.style.borderColor = "rgba(99, 102, 241, 0.35)";
      pill.style.boxShadow = "none";
      if (iconEl) iconEl.textContent = "💤";
    }
  }

  renderDrawerLogs() {
    const container = document.getElementById("ai-log-list");
    if (!container) return;

    if (this.logs.length === 0) {
      container.innerHTML = '<div style="color: var(--text-muted); padding: 12px 0;">目前無任務紀錄。</div>';
      return;
    }

    container.innerHTML = this.logs.map(item => {
      let badgeBg = "rgba(99, 102, 241, 0.15)";
      let badgeColor = "#6366f1";
      let textStyle = "color: var(--text-main);";
      
      if (item.level === "error") {
        badgeBg = "rgba(239, 68, 68, 0.15)";
        badgeColor = "#ef4444";
        textStyle = "color: #dc2626; font-weight: 600;";
      } else if (item.level === "success") {
        badgeBg = "rgba(16, 185, 129, 0.15)";
        badgeColor = "#10b981";
        textStyle = "color: #059669; font-weight: 600;";
      } else if (item.level === "running") {
        badgeBg = "rgba(245, 158, 11, 0.15)";
        badgeColor = "#d97706";
        textStyle = "color: #b45309; font-weight: 500;";
      }

      return `
        <div style="padding: 6px 8px; border-radius: 6px; background: rgba(125,125,125,0.04); margin-bottom: 4px; ${textStyle} display: flex; align-items: flex-start; gap: 8px; font-size: 0.82rem;">
          <span style="background: ${badgeBg}; color: ${badgeColor}; font-size: 0.7rem; padding: 2px 6px; border-radius: 4px; font-weight: 700; white-space: nowrap;">${item.time}</span>
          <span style="flex: 1; word-break: break-all; line-height: 1.4;">${item.text}</span>
        </div>
      `;
    }).join("");
  }
}

// 🌐 全域安全掛載實例與初始化函式
window.AiTaskLogger = AiTaskLogger;
window.FL_AI_LOGGER = new AiTaskLogger();

window.initAiTaskConsole = function() {
  const pill = document.getElementById("ai-task-status-pill");
  const drawer = document.getElementById("ai-log-drawer");
  const closeBtn = document.getElementById("ai-log-drawer-close");

  if (pill && drawer) {
    pill.addEventListener("click", () => {
      drawer.style.display = (drawer.style.display === "none" || !drawer.style.display) ? "flex" : "none";
    });
  }

  if (closeBtn && drawer) {
    closeBtn.addEventListener("click", () => {
      drawer.style.display = "none";
    });
  }
};
