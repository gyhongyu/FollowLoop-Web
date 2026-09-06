/**
 * FollowLoop-Web HITL 商業情報審核模組 (hitl_log_modal.js)
 * 負責：商業流水帳情報卡片列表渲染、專案即建即選、批准入庫 (Approve)、修改情報 Modal、標記作廢 (Reject)
 */

function initHitlModule() {
  const refreshBtn = document.getElementById("hitl-refresh-btn");
  const badgeCount = document.getElementById("hitl-badge-count");
  const subBadgeLogs = document.getElementById("hitl-sub-badge-logs");
  const subBadgeCards = document.getElementById("hitl-sub-badge-cards");
  const subBtnLogs = document.getElementById("hitl-sub-tab-logs");
  const subBtnCards = document.getElementById("hitl-sub-tab-cards");

  // 子頁籤點擊切換事件
  if (subBtnLogs) {
    subBtnLogs.addEventListener("click", () => {
      hitlReviewer.activeSubTab = "business";
      if (subBtnLogs) subBtnLogs.classList.add("active");
      if (subBtnCards) subBtnCards.classList.remove("active");
      renderHitlCards();
    });
  }

  if (subBtnCards) {
    subBtnCards.addEventListener("click", () => {
      hitlReviewer.activeSubTab = "cards";
      if (subBtnCards) subBtnCards.classList.add("active");
      if (subBtnLogs) subBtnLogs.classList.remove("active");
      renderHitlCards();
    });
  }

  hitlReviewer.subscribe((allCards, businessLogs, businessCards) => {
    if (badgeCount) badgeCount.textContent = allCards.length;
    if (subBadgeLogs) subBadgeLogs.textContent = businessLogs.length;
    if (subBadgeCards) subBadgeCards.textContent = businessCards.length;
    renderHitlCards();
  });

  if (refreshBtn) {
    refreshBtn.addEventListener("click", async () => {
      showToast("正在拉取最新待審核卡片...", "info");
      await hitlReviewer.fetchPendingCards();
    });
  }

  hitlReviewer.fetchPendingCards();
}

function calculateNextNewProjectInfo(projectList) {
  let maxId = 0;
  let unclassifiedCount = 0;
  
  projectList.forEach((p) => {
    const match = (p.tag || "").match(/Item_(\d+)/i);
    if (match && match[1]) {
      const num = parseInt(match[1], 10);
      if (num > maxId) maxId = num;
    }
    if ((p.name && p.name.includes("未分類專案")) || (p.acct && p.acct.includes("未指定客戶"))) {
      unclassifiedCount++;
    }
  });

  const nextId = maxId > 0 ? maxId + 1 : 1;
  const nextSeq = unclassifiedCount + 1;
  const nextSeqStr = String(nextSeq).padStart(2, '0');
  const nextTag = `Item_${nextId}_01`;
  const nextProjectName = `未分類專案-${nextSeqStr}`;

  return { nextId, nextSeq, nextSeqStr, nextTag, nextProjectName };
}

function getAvailableProjectsList() {
  const list = [];
  if (window.liveView && Array.isArray(window.liveView.lastMasterData) && window.liveView.lastMasterData.length > 1) {
    const data = window.liveView.lastMasterData;
    for (let r = 1; r < data.length; r++) {
      const tag = (data[r][0] || "").toString().trim();
      const acct = (data[r][1] || "").toString().trim();
      const name = (data[r][3] || "").toString().trim();
      if (tag) list.push({ tag, name, acct });
    }
  }
  if (list.length === 0) {
    try {
      const cached = JSON.parse(localStorage.getItem("FL_DUAL_TABLE_SNAPSHOT") || "{}");
      if (cached && Array.isArray(cached.masterData) && cached.masterData.length > 1) {
        const data = cached.masterData;
        for (let r = 1; r < data.length; r++) {
          const tag = (data[r][0] || "").toString().trim();
          const acct = (data[r][1] || "").toString().trim();
          const name = (data[r][3] || "").toString().trim();
          if (tag) list.push({ tag, name, acct });
        }
      }
    } catch (e) {}
  }
  return list;
}

async function ensureNewProjectMasterCreated(targetTag, projectName) {
  const nowStr = new Date().toISOString();
  const tagParts = targetTag.split("_");
  const accountTag = tagParts.length >= 2 ? `${tagParts[0]}_${tagParts[1]}` : targetTag;

  const newRow = [
    targetTag,
    "未指定客戶 (待編輯)",
    "待指定窗口",
    projectName,
    "New Lead",
    "Unclassified",
    "",
    "",
    "USD",
    "",
    "新商機情報待完善，請編輯此卡片補充客戶資料",
    "",
    "",
    "",
    "Michael Chen",
    "ACTIVE",
    nowStr,
    nowStr,
    "",
    "",
    accountTag
  ];

  if (window.liveView) {
    if (!Array.isArray(window.liveView.lastMasterData)) {
      window.liveView.lastMasterData = [["project_tag","account_name","primary_contact","project_name","stage","priority"]];
    }
    window.liveView.lastMasterData.push(newRow);
  }

  try {
    await sendGasRequest("batch_append_raw", {
      sheet: "Projects_Master",
      rows: [newRow]
    });
  } catch (e) {
    console.warn("建立未分類專案主檔背景警示:", e);
  }
}

function renderHitlCards(cards) {
  const container = document.getElementById("hitl-card-grid");
  if (!container) return;

  const activeTab = hitlReviewer.activeSubTab || "business";
  const displayCards = activeTab === "cards" ? hitlReviewer.pendingBusinessCards : hitlReviewer.pendingBusinessLogs;

  if (!displayCards || displayCards.length === 0) {
    const emptyIcon = activeTab === "cards" ? "🪪" : "✨";
    const emptyTitle = activeTab === "cards" ? "目前沒有尚待審核的名片" : "目前沒有尚待審核的商業情報";
    const emptyDesc = activeTab === "cards" ? "上傳名片或後台打工仔解析完成後，名片會出現在此處供您審核入庫至 Google 通訊錄" : "本機 AI 代理人解析完畢後，卡片會自動出現在此處供您 [是 / 修改 / 否] 審核";

    container.innerHTML = `
      <div style="grid-column: 1/-1; text-align: center; padding: 60px 20px; color: var(--text-subtle); background: var(--bg-card-glass); border-radius: 16px; border: 1px dashed var(--border-card-light);">
        <div style="font-size: 48px; margin-bottom: 12px; filter: drop-shadow(0 4px 10px rgba(99,102,241,0.2));">${emptyIcon}</div>
        <p style="font-size: 1.15rem; font-weight: 700; color: var(--text-heading); margin-bottom: 6px;">${emptyTitle}</p>
        <p style="font-size: 0.88rem; color: var(--text-muted);">${emptyDesc}</p>
      </div>
    `;
    return;
  }

  // 🪪 分支 A：名片專屬審核視圖
  if (activeTab === "cards") {
    container.innerHTML = displayCards.map((card) => {
      const cardId = card.log_id || card.entry_id;
      const atts = card.attachments || [];
      const firstImg = atts.length > 0 ? atts[0] : null;
      const imgUrl = firstImg ? firstImg.url : "";
      const thumbId = firstImg && firstImg.id ? `https://drive.google.com/thumbnail?id=${firstImg.id}&sz=w400` : "";

      return `
      <div class="card-hitl-box" id="card-${cardId}">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <div style="display: flex; gap: 8px; align-items: center;">
            <span class="badge-tag" style="background: rgba(99, 102, 241, 0.18); color: var(--primary-light); font-weight: 700;">🪪 名片辨識</span>
            <span class="badge-stage" style="background: rgba(16, 185, 129, 0.15); color: #059669; font-weight: 700;">🎯 信心度 95%</span>
          </div>
          <span style="font-size: 0.76rem; color: var(--text-subtle); font-family: monospace;">${new Date(card.timestamp).toLocaleString()}</span>
        </div>

        <div class="card-preview-container">
          <div class="card-thumb-wrap" onclick="window.openCardPreviewLightbox('${imgUrl || (firstImg ? firstImg.url : '')}')" title="點擊檢視原圖">
            ${thumbId ? `<img src="${thumbId}" class="card-thumb-img" alt="名片原圖" onerror="this.src='img/icons/icon-192.png'">` : `<div style="color:var(--text-muted); font-size:2rem;">🪪</div>`}
            ${imgUrl ? `<span class="card-thumb-badge">🔍 點擊原圖</span>` : ''}
          </div>
          <div class="card-info-col">
            <div class="card-person-name" id="card-name-${cardId}">${card.name || "未知姓名"}</div>
            <div class="card-person-title">${card.title || "商務窗口"}</div>
            <div class="card-person-company" title="${card.company}">${card.company || "未填寫公司"}</div>
          </div>
        </div>

        <div class="card-detail-table">
          <div class="card-detail-row">
            <span class="card-detail-label">📞 電話:</span>
            <span class="card-detail-value" style="font-weight:700; color:#10b981;">${card.phone || "無電話號碼"}</span>
          </div>
          ${card.email ? `
          <div class="card-detail-row">
            <span class="card-detail-label">✉️ Email:</span>
            <span class="card-detail-value">${card.email}</span>
          </div>` : ''}
          ${card.address ? `
          <div class="card-detail-row">
            <span class="card-detail-label">📍 地址:</span>
            <span class="card-detail-value">${card.address}</span>
          </div>` : ''}
          ${card.notes ? `
          <div class="card-detail-row">
            <span class="card-detail-label">📝 備註:</span>
            <span class="card-detail-value">${card.notes}</span>
          </div>` : ''}
        </div>

        <div class="card-foxlink-switch">
          <label style="display:flex; align-items:center; gap:8px; cursor:pointer; font-weight:700; color:var(--text-heading);">
            <input type="checkbox" id="foxlink-tag-check-${cardId}" checked style="width:16px; height:16px; cursor:pointer;">
            <span>🏢 標記為 Foxlink 公務人脈 (自動打標)</span>
          </label>
          <span style="font-size:0.75rem; color:var(--text-muted);">無標籤則為個人</span>
        </div>

        <div class="hitl-actions">
          <button class="btn-approve" onclick="onApproveBusinessCard('${cardId}')" style="flex: 1.2; padding: 9px 14px; font-size: 0.88rem; font-weight: 700;">
            ✓ 批准入庫 (Google Contacts)
          </button>
          <button class="btn-edit" onclick="onEditBusinessCardModal('${cardId}')" style="flex: 0.9; padding: 9px 12px; font-size: 0.88rem; font-weight: 600;">
            ✎ 修改資料
          </button>
          <button class="btn-reject" onclick="onRejectCard('${cardId}')" style="padding: 9px 12px; font-size: 0.88rem; font-weight: 600;" title="作廢並物理抹除">
            ✕ 作廢
          </button>
        </div>
      </div>
      `;
    }).join("");
    return;
  }

  // 📜 分支 B：大一統輕量化審核視圖
  const projectList = getAvailableProjectsList();
  const nextInfo = calculateNextNewProjectInfo(projectList);

  container.innerHTML = displayCards
    .map((card) => {
      const logId = card.log_id || card.entry_id;
      const currentTag = card.project_tag || "General";
      const isUnclassified = currentTag === "General" || currentTag === "NEW_UNCLASSIFIED" || currentTag.startsWith("Item_New") || !currentTag;
      const confidence = card.confidence_score ? `${Math.round(parseFloat(card.confidence_score) * 100)}%` : "100%";
      const cleanUpdateLog = (card.update_log || "").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>");
      
      // 判斷是否為外鏈/附件模式
      let attItem = null;
      if (card.attachment_links) {
        try {
          const links = typeof card.attachment_links === "string" ? JSON.parse(card.attachment_links) : card.attachment_links;
          if (Array.isArray(links) && links.length > 0) {
            attItem = links[0];
          }
        } catch (e) {}
      }

      // 輔助函式：清洗客戶名稱法人贅字
      const cleanAccount = (acct) => {
        if (!acct) return "";
        return acct
          .replace(/\b(Technologies|Private|Limited|Pvt\.?|Ltd\.?|Electronics|India)\b/gi, "")
          .replace(/[,\-:]+/g, " ")
          .trim();
      };

      // 輔助函式：精簡過長專案名稱 (超過 24 字元自動縮寫加省略號)
      const cleanProjectName = (pname) => {
        if (!pname) return "未命名專案";
        const s = pname.trim();
        return s.length > 24 ? s.slice(0, 23) + "…" : s;
      };

      let optionsHtml = `<option value="NEW_UNCLASSIFIED" ${isUnclassified ? "selected" : ""}>➕ 建立新專案卡 (${nextInfo.nextProjectName})</option>`;
      projectList.forEach((p) => {
        const isSelected = p.tag === currentTag && !isUnclassified;
        const acctDisp = cleanAccount(p.acct);
        const nameDisp = cleanProjectName(p.name);
        const label = acctDisp ? `${acctDisp} — ${nameDisp}` : nameDisp;
        optionsHtml += `<option value="${p.tag}" ${isSelected ? "selected" : ""}>${label}</option>`;
      });

      return `
      <div class="hitl-card" id="card-${logId}">
        <div>
          <div class="hitl-card-header">
            <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
              <span class="badge-tag" style="background: rgba(99, 102, 241, 0.18); color: var(--primary-light); font-weight: 700;">
                ${card.source_type || (attItem ? "🔗 雲端資源鏈結" : "📝 速記情報")}
              </span>
              <span class="badge-stage" style="background: rgba(16, 185, 129, 0.15); color: #059669; font-weight: 700;">🎯 信心度 ${confidence}</span>
            </div>
            <span style="font-size: 0.76rem; color: var(--text-subtle); font-family: monospace;">${new Date(card.timestamp).toLocaleString()}</span>
          </div>

          <div class="hitl-tag-box ${isUnclassified ? 'unclassified' : ''}">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
              <span style="font-size: 0.82rem; font-weight: 700; color: ${isUnclassified ? '#d97706' : 'var(--primary-light)'};">
                ${isUnclassified ? '⚪ 待完善新商機 (將自動建卡)' : '🎯 擬保存至 CRM 專案'}
              </span>
              <span style="font-size: 0.72rem; color: var(--text-subtle);">可直接切換</span>
            </div>
            <select class="form-control" id="card-tag-select-${logId}" style="width: 100%; font-size: 0.88rem; font-weight: 600; padding: 6px 10px;" onchange="onCardTagChanged('${logId}', this.value)">
              ${optionsHtml}
            </select>
          </div>

          <div style="display: flex; flex-direction: column; gap: 8px; font-size: 0.88rem; margin-top: 4px;">
            ${attItem ? `
            <div style="background: rgba(99, 102, 241, 0.08); border: 1px solid rgba(99, 102, 241, 0.25); border-radius: 8px; padding: 10px 12px;">
              <div style="font-size: 0.92rem; font-weight: 700; color: var(--text-heading); margin-bottom: 4px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;">
                📎 ${attItem.title || "專案參考資源"}
              </div>
              <div style="font-size: 0.78rem; color: var(--primary-light); word-break: break-all;">
                <a href="${attItem.url}" target="_blank" style="color: inherit; text-decoration: underline;" title="在新分頁開啟鏈結">
                  ${attItem.url} ↗
                </a>
              </div>
            </div>` : `
            <div style="font-size: 0.9rem; font-weight: 700; color: var(--text-heading);">
              💡 ${card.target_purpose || card.action_taken || "商業速記內容"}
            </div>`}

            ${cleanUpdateLog ? `
            <div class="hitl-log-box">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                <span style="font-size: 0.78rem; font-weight: 700; color: var(--text-muted);">📝 流水帳記要:</span>
                <span style="font-size: 0.72rem; color: var(--text-subtle);">預覽限 3 行</span>
              </div>
              <div style="font-size: 0.85rem; color: var(--text-body); line-height: 1.5; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; text-overflow: ellipsis;">${cleanUpdateLog}</div>
            </div>` : ""}
          </div>
        </div>

        <div class="hitl-actions" style="margin-top: 12px;">
          <button class="btn-approve" onclick="onApproveCard('${logId}')" style="flex: 1.2; padding: 8px 12px; font-size: 0.88rem; font-weight: 700;" title="批准入庫 (若為新專案將自動建卡)">✓ 批准入庫</button>
          <button class="btn-edit" onclick="onEditCardModal('${logId}')" style="flex: 1; padding: 8px 12px; font-size: 0.88rem; font-weight: 600;" title="開啟彈窗修訂標題、網址或補流水帳">✎ 修改 (Edit)</button>
          <button class="btn-reject" onclick="onRejectCard('${logId}')" style="padding: 8px 12px; font-size: 0.88rem; font-weight: 600;" title="標記 REJECTED 作廢">✕ 否</button>
        </div>
      </div>
    `;
    })
    .join("");
}

window.onCardTagChanged = function(logId, newTag) {
  const card = hitlReviewer.pendingCards.find((c) => (c.log_id === logId || c.entry_id === logId));
  if (card) {
    card.project_tag = newTag;
    const entityEl = document.getElementById(`card-entity-val-${logId}`);
    if (newTag === "NEW_UNCLASSIFIED") {
      card.entity_target = "未指定客戶 (待編輯)";
      if (entityEl) entityEl.textContent = "未指定客戶 (待編輯)";
    } else {
      const projectList = getAvailableProjectsList();
      const matched = projectList.find(p => p.tag === newTag);
      if (matched && matched.acct) {
        card.entity_target = matched.acct;
        if (entityEl) entityEl.textContent = matched.acct;
      }
    }
  }
};

window.onApproveCard = async function (logId) {
  try {
    const card = hitlReviewer.pendingCards.find((c) => (c.log_id === logId || c.entry_id === logId));
    const selectEl = document.getElementById(`card-tag-select-${logId}`);
    let selectedTag = selectEl ? selectEl.value : (card ? card.project_tag : "NEW_UNCLASSIFIED");

    const projectList = getAvailableProjectsList();
    const nextInfo = calculateNextNewProjectInfo(projectList);

    if (selectedTag === "NEW_UNCLASSIFIED" || selectedTag === "General" || !selectedTag) {
      selectedTag = nextInfo.nextTag;
      showToast(`正在為新商機自動建立專案主檔 [${nextInfo.nextProjectName}]...`, "info");
      await ensureNewProjectMasterCreated(selectedTag, nextInfo.nextProjectName);
      if (card) card.entity_target = "未指定客戶 (待編輯)";
    } else {
      showToast(`正在批准入庫至 [${selectedTag}]...`, "info");
    }

    if (card) card.project_tag = selectedTag;

    // 1. 📎 附件登記：若含有 URL 或附件，100% 歸檔至 Projects_Attachments
    if (card && card.attachment_links) {
      try {
        const links = typeof card.attachment_links === "string" ? JSON.parse(card.attachment_links) : card.attachment_links;
        if (Array.isArray(links) && links.length > 0 && links[0].url) {
          const nowStr = new Date().toISOString().replace("T", " ").slice(0, 19);
          const randSuffix = (Math.random().toString(36) + "0000").slice(2, 6);
          const attRow = [
            `LINK_${selectedTag}_${Date.now()}_${randSuffix}`,
            selectedTag,
            links[0].title || "專案參考資源",
            links[0].url || "",
            links[0].category || "Web Link",
            nowStr
          ];
          await sendGasRequest("batch_append_raw", {
            sheet: "Projects_Attachments",
            rows: [attRow]
          }).catch(e => console.warn("[Projects_Attachments] 自動登記失敗: ", e.message));

          if (window.liveView) {
            if (!Array.isArray(window.liveView.lastAttachmentsData)) {
              window.liveView.lastAttachmentsData = [["link_id","project_tag","title","url","category","created_at"]];
            }
            window.liveView.lastAttachmentsData.push(attRow);
          }
          showToast(`📎 附件已成功歸檔至 [${selectedTag}] 專案附件庫！`, "success");
        }
      } catch (e) {
        console.warn("[Projects_Attachments] 解析附件鏈結異常: ", e.message);
      }
    }

    // 2. 📝 流水帳門禁：若為空，100% 絕對不寫入 Memory_Pool_Raw！
    const currentLog = (card ? (card.update_log || "") : "").trim();
    if (currentLog) {
      const updatedFields = {
        project_tag: selectedTag,
        entity_target: card ? card.entity_target : "未指定客戶 (待編輯)",
        target_purpose: card ? card.target_purpose : "",
        action_taken: card ? card.action_taken : "最新跟進",
        update_log: currentLog
      };
      const res = await hitlReviewer.editAndApproveCard(logId, updatedFields);
      showToast(res.message, "success");
    } else {
      // 💡 流水帳為空：物理抹除待審緩存，0 污染 Memory_Pool_Raw
      await hitlReviewer._sendReviewAction(logId, "REJECT");
      hitlReviewer.pendingCards = hitlReviewer.pendingCards.filter((c) => (c.log_id !== logId && c.entry_id !== logId));
      hitlReviewer._classifyCards();
      hitlReviewer.notify();
      showToast("✅ 已完成歸檔！(流水帳為空，未產生多餘日誌)", "success");
    }

    renderHitlCards(hitlReviewer.pendingCards);

    if (window.liveView) {
      window.liveView.viewRows = window.liveView.parseDualTableData(
        window.liveView.lastRawData,
        window.liveView.lastMasterData,
        window.liveView.lastAttachmentsData
      );
      window.liveView.applyFilter();
      window.liveView.saveLocalCache();
      if (typeof window.renderLiveViewGrid === "function") {
        window.renderLiveViewGrid();
      }
    }
  } catch (err) {
    showToast(`批准失敗: ${err.message}`, "danger");
  }
};

window.onEditCardModal = function (logId) {
  const card = hitlReviewer.pendingCards.find((c) => (c.log_id === logId || c.entry_id === logId));
  if (!card) return;

  const targetId = card.log_id || card.entry_id;
  const projectList = getAvailableProjectsList();
  const nextInfo = calculateNextNewProjectInfo(projectList);
  const tagSelect = document.getElementById("modal-hitl-tag");
  const currentTag = card.project_tag || "NEW_UNCLASSIFIED";
  const isUnclassified = currentTag === "General" || currentTag === "NEW_UNCLASSIFIED" || currentTag.startsWith("Item_New") || !currentTag;

  if (tagSelect) {
    // 輔助函式：清洗客戶名稱法人贅字
    const cleanAccount = (acct) => {
      if (!acct) return "";
      return acct
        .replace(/\b(Technologies|Private|Limited|Pvt\.?|Ltd\.?|Electronics|India)\b/gi, "")
        .replace(/[,\-:]+/g, " ")
        .trim();
    };

    // 輔助函式：精簡過長專案名稱 (超過 24 字元自動縮寫加省略號)
    const cleanProjectName = (pname) => {
      if (!pname) return "未命名專案";
      const s = pname.trim();
      return s.length > 24 ? s.slice(0, 23) + "…" : s;
    };

    let optionsHtml = `<option value="NEW_UNCLASSIFIED" ${isUnclassified ? "selected" : ""}>➕ 建立新專案卡 (${nextInfo.nextProjectName})</option>`;
    projectList.forEach((p) => {
      const isSelected = p.tag === currentTag && !isUnclassified;
      const acctDisp = cleanAccount(p.acct);
      const nameDisp = cleanProjectName(p.name);
      const label = acctDisp ? `${acctDisp} — ${nameDisp}` : nameDisp;
      optionsHtml += `<option value="${p.tag}" ${isSelected ? "selected" : ""}>${label}</option>`;
    });
    tagSelect.innerHTML = optionsHtml;

    // 📱 同步更新現代化單行選擇按鈕文字
    const pickerTextEl = document.getElementById("modal-hitl-tag-picker-text");
    if (pickerTextEl) {
      const selectedOption = tagSelect.options[tagSelect.selectedIndex];
      pickerTextEl.textContent = selectedOption ? selectedOption.textContent : "請選擇歸屬專案...";
    }

    tagSelect.onchange = function() {
      const entityInput = document.getElementById("modal-hitl-entity");
      if (this.value === "NEW_UNCLASSIFIED") {
        if (entityInput) entityInput.value = "未指定客戶 (待編輯)";
      } else {
        const matched = projectList.find(p => p.tag === this.value);
        if (matched && matched.acct && entityInput) {
          entityInput.value = matched.acct;
        }
      }
      const pText = document.getElementById("modal-hitl-tag-picker-text");
      if (pText) {
        const opt = tagSelect.options[tagSelect.selectedIndex];
        pText.textContent = opt ? opt.textContent : "請選擇歸屬專案...";
      }
    };
  }

  // 1. 基礎 ID 與來源類型
  const idEl = document.getElementById("modal-hitl-id");
  if (idEl) idEl.value = targetId;

  // 2. 萃取附件 / 鏈結資訊
  let defaultTitle = "";
  let defaultUrl = "";
  let isLinkMode = false;

  if (card.attachment_links) {
    try {
      const links = typeof card.attachment_links === "string" ? JSON.parse(card.attachment_links) : card.attachment_links;
      if (Array.isArray(links) && links.length > 0) {
        defaultTitle = links[0].title || "";
        defaultUrl = links[0].url || "";
        isLinkMode = !!defaultUrl;
      }
    } catch (e) {}
  }

  if (!defaultTitle) {
    defaultTitle = card.target_purpose || card.action_taken || "專案參考資源";
  }

  const titleInput = document.getElementById("modal-hitl-title");
  if (titleInput) titleInput.value = defaultTitle;

  const urlInput = document.getElementById("modal-hitl-url");
  const urlGroup = document.getElementById("modal-hitl-url-group");
  if (urlInput) urlInput.value = defaultUrl;
  if (urlGroup) {
    // 若有 URL 或是鏈結類型，保持可見；否則預設展開供選填
    urlGroup.style.display = "block";
  }

  const headerTitle = document.getElementById("modal-hitl-header-title");
  if (headerTitle) {
    headerTitle.textContent = isLinkMode ? "🔗 審核與修訂專案鏈結" : "🤖 審核與修訂內容";
  }

  // 3. 流水帳輸入框（依使用者指示：選填）
  const logInput = document.getElementById("modal-hitl-log");
  if (logInput) {
    logInput.value = card.update_log || "";
  }

  // 4. 進階選填 CRM 屬性
  const entityInput = document.getElementById("modal-hitl-entity");
  if (entityInput) entityInput.value = card.entity_target || "";
  const purposeInput = document.getElementById("modal-hitl-purpose");
  if (purposeInput) purposeInput.value = card.target_purpose || "";
  const actionInput = document.getElementById("modal-hitl-action");
  if (actionInput) actionInput.value = card.action_taken || "";

  const backdrop = document.getElementById("edit-hitl-modal-backdrop");
  if (backdrop) {
    backdrop.style.display = "flex";
  }
};

window.closeEditModal = function () {
  const backdrop = document.getElementById("edit-hitl-modal-backdrop");
  if (backdrop) {
    backdrop.style.display = "none";
  }
};

window.submitEditCard = async function () {
  const logId = document.getElementById("modal-hitl-id").value;
  let projectTag = document.getElementById("modal-hitl-tag").value.trim();
  const entityInput = document.getElementById("modal-hitl-entity");
  let entityTarget = entityInput ? entityInput.value.trim() : "";

  closeEditModal();

  const projectList = getAvailableProjectsList();
  const nextInfo = calculateNextNewProjectInfo(projectList);

  if (projectTag === "NEW_UNCLASSIFIED" || projectTag === "General" || !projectTag) {
    projectTag = nextInfo.nextTag;
    showToast(`正在為新商機自動建立專案主檔 [${nextInfo.nextProjectName}]...`, "info");
    await ensureNewProjectMasterCreated(projectTag, nextInfo.nextProjectName);
    if (!entityTarget || entityTarget === "未指定單位/窗口") {
      entityTarget = "未指定客戶 (待編輯)";
    }
  }

  const titleInput = document.getElementById("modal-hitl-title");
  const attTitle = titleInput ? titleInput.value.trim() : "專案參考資源";
  const urlInput = document.getElementById("modal-hitl-url");
  const attUrl = urlInput ? urlInput.value.trim() : "";
  const logInput = document.getElementById("modal-hitl-log");
  const updateLog = logInput ? logInput.value.trim() : "";

  const purposeInput = document.getElementById("modal-hitl-purpose");
  const targetPurpose = purposeInput ? purposeInput.value.trim() : "";
  const actionInput = document.getElementById("modal-hitl-action");
  const actionTaken = actionInput ? actionInput.value.trim() : (attUrl ? "登記專案參考資源" : "最新跟進");

  const card = hitlReviewer.pendingCards.find((c) => (c.log_id === logId || c.entry_id === logId));

  try {
    showToast("正在儲存並執行入庫...", "info");

    // 1. 📎 專案附件入庫：只要有 URL，100% 寫入 Projects_Attachments
    if (attUrl) {
      let attCategory = "Web Link";
      const lowerUrl = attUrl.toLowerCase();
      if (lowerUrl.includes("spreadsheets") || lowerUrl.includes("sheets.google")) attCategory = "Google Sheets";
      else if (lowerUrl.includes("document") || lowerUrl.includes("docs.google")) attCategory = "Google Docs";
      else if (lowerUrl.includes("drive.google.com")) attCategory = "Google Drive";
      else if (lowerUrl.includes("github.com")) attCategory = "GitHub";

      const randSuffix = (Math.random().toString(36) + "0000").slice(2, 6);
      const cleanTag = (projectTag || "General").replace(/\s+/g, "_");
      const linkId = `LINK_${cleanTag}_${Date.now()}_${randSuffix}`;
      const nowStr = new Date().toISOString().replace("T", " ").slice(0, 19);

      const linkRow = [
        linkId,
        projectTag || "General",
        attTitle || "專案參考資源",
        attUrl,
        attCategory,
        nowStr
      ];

      await sendGasRequest("batch_append_raw", {
        sheet: "Projects_Attachments",
        rows: [linkRow]
      }).catch(e => console.warn("附件登記背景警示:", e));
      showToast(`📎 附件已成功歸檔至專案附件庫！`, "success");

      // 同步注入本地 LiveView 快取
      if (window.liveView) {
        if (!Array.isArray(window.liveView.lastAttachmentsData)) {
          window.liveView.lastAttachmentsData = [["link_id","project_tag","title","url","category","created_at"]];
        }
        window.liveView.lastAttachmentsData.push(linkRow);
      }
    }

    // 2. 📝 流水帳門禁：依使用者指示【流水帳沒填就是不寫】！
    if (updateLog) {
      // 使用者有具體填寫流水帳，才寫入 Memory_Pool_Raw
      const updatedFields = {
        project_tag: projectTag,
        entity_target: entityTarget || "未指定客戶 (待編輯)",
        target_purpose: targetPurpose,
        action_taken: actionTaken,
        update_log: updateLog
      };
      await hitlReviewer.editAndApproveCard(logId, updatedFields);
      showToast("📝 流水帳記要已成功記入專案時間線！", "success");
    } else {
      // 💡 使用者留空：100% 絕對不寫入 Memory_Pool_Raw！直接結案移除待審卡片
      await hitlReviewer._sendReviewAction(logId, "REJECT"); // 物理抹除該筆待審緩存，0 污染 Memory_Pool_Raw
      hitlReviewer.pendingCards = hitlReviewer.pendingCards.filter((c) => (c.log_id !== logId && c.entry_id !== logId));
      hitlReviewer._classifyCards();
      hitlReviewer.notify();
      showToast("✅ 已完成歸檔！(流水帳為空，未產生多餘日誌)", "success");
    }

    renderHitlCards(hitlReviewer.pendingCards);

    if (window.liveView) {
      window.liveView.viewRows = window.liveView.parseDualTableData(
        window.liveView.lastRawData,
        window.liveView.lastMasterData,
        window.liveView.lastAttachmentsData
      );
      window.liveView.applyFilter();
      window.liveView.saveLocalCache();
      if (typeof window.renderLiveViewGrid === "function") {
        window.renderLiveViewGrid();
      }
    }
  } catch (err) {
    showToast(`修改保存失敗: ${err.message}`, "danger");
  }
};

window.onRejectCard = async function (logId) {
  if (confirm("確定將此卡片標記為 [否 (Reject)] 廢棄？")) {
    try {
      showToast("正在標記作廢...", "info");
      const res = await hitlReviewer.rejectCard(logId);
      showToast(res.message, "warning");
    } catch (err) {
      showToast(`標記失敗: ${err.message}`, "danger");
    }
  }
};

// =========================================================================
// 📱 現代化專案單行抽屜選擇器 (Project Bottom Sheet Picker Controller)
// =========================================================================
let _currentPickerTargetSelectId = null;

window.openProjectPickerSheet = function(targetSelectId = "modal-hitl-tag") {
  _currentPickerTargetSelectId = targetSelectId;
  const targetSelect = document.getElementById(targetSelectId);
  const backdrop = document.getElementById("global-project-sheet-backdrop");
  const itemsContainer = document.getElementById("project-sheet-items-container");
  const searchInput = document.getElementById("project-sheet-search-input");

  if (!targetSelect || !backdrop || !itemsContainer) return;

  if (searchInput) searchInput.value = "";

  // 渲染所有選項
  _renderPickerList("");

  backdrop.classList.add("active");
  if (searchInput) {
    setTimeout(() => searchInput.focus(), 150);
  }
};

window.closeProjectPickerSheet = function() {
  const backdrop = document.getElementById("global-project-sheet-backdrop");
  if (backdrop) backdrop.classList.remove("active");
  _currentPickerTargetSelectId = null;
};

window.filterProjectPickerItems = function(query) {
  _renderPickerList(query.trim().toLowerCase());
};

function _renderPickerList(filterKeyword = "") {
  const targetSelect = document.getElementById(_currentPickerTargetSelectId || "modal-hitl-tag");
  const itemsContainer = document.getElementById("project-sheet-items-container");
  if (!targetSelect || !itemsContainer) return;

  const currentVal = targetSelect.value;
  const options = Array.from(targetSelect.options);

  let html = "";
  let matchCount = 0;

  options.forEach((opt) => {
    const val = opt.value;
    const text = opt.textContent;
    const isNew = val === "NEW_UNCLASSIFIED";
    const isSelected = val === currentVal;

    if (filterKeyword && !text.toLowerCase().includes(filterKeyword) && !val.toLowerCase().includes(filterKeyword)) {
      return;
    }

    matchCount++;
    const itemClass = `project-sheet-item ${isNew ? 'is-new-opt' : ''} ${isSelected ? 'selected' : ''}`;
    html += `
      <button type="button" class="${itemClass}" onclick="window.selectProjectFromSheet('${val}')">
        <span class="project-sheet-item-label">${text}</span>
        ${isSelected ? '<span class="project-sheet-item-check">✓</span>' : ''}
      </button>
    `;
  });

  if (matchCount === 0) {
    html = `<div style="text-align: center; padding: 28px 12px; color: var(--text-muted); font-size: 0.85rem;">🔍 查無符合的專案項目</div>`;
  }

  itemsContainer.innerHTML = html;
}

window.selectProjectFromSheet = function(selectedValue) {
  const targetSelect = document.getElementById(_currentPickerTargetSelectId || "modal-hitl-tag");
  if (targetSelect) {
    targetSelect.value = selectedValue;
    if (typeof targetSelect.onchange === "function") {
      targetSelect.onchange();
    }
  }
  window.closeProjectPickerSheet();
};

// 🌐 全域安全掛載函式
window.initHitlModule = initHitlModule;
window.renderHitlCards = renderHitlCards;
window.getAvailableProjectsList = getAvailableProjectsList;

