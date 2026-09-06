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

  // 📜 分支 B：既有商業情報審核視圖
  const projectList = getAvailableProjectsList();
  const nextInfo = calculateNextNewProjectInfo(projectList);

  container.innerHTML = displayCards
    .map((card) => {
      const logId = card.log_id || card.entry_id;
      const currentTag = card.project_tag || "General";
      const isUnclassified = currentTag === "General" || currentTag === "NEW_UNCLASSIFIED" || currentTag.startsWith("Item_New") || !currentTag;
      const confidence = card.confidence_score ? `${Math.round(parseFloat(card.confidence_score) * 100)}%` : "85%";
      const cleanUpdateLog = (card.update_log || card.raw_text || "").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>");
      
      let optionsHtml = `<option value="NEW_UNCLASSIFIED" ${isUnclassified ? "selected" : ""}>➕ 建立新專案卡 (${nextInfo.nextProjectName})</option>`;
      projectList.forEach((p) => {
        const isSelected = p.tag === currentTag && !isUnclassified;
        const label = `${p.tag} | ${p.acct ? p.acct + " : " : ""}${p.name}`;
        optionsHtml += `<option value="${p.tag}" ${isSelected ? "selected" : ""}>${label}</option>`;
      });

      return `
      <div class="hitl-card" id="card-${logId}">
        <div>
          <div class="hitl-card-header">
            <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
              <span class="badge-tag" style="background: rgba(99, 102, 241, 0.18); color: var(--primary-light); font-weight: 700;">${card.source_type || "🎙️ 語音錄音轉寫"}</span>
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

          <div style="display: flex; flex-direction: column; gap: 6px; font-size: 0.88rem;">
            <div class="hitl-meta-row">
              <span class="hitl-meta-label">🏢 權責對象:</span>
              <span class="hitl-meta-value" id="card-entity-val-${logId}">${card.entity_target || "未指定客戶 (待編輯)"}</span>
            </div>

            ${card.target_purpose ? `
            <div class="hitl-meta-row">
              <span class="hitl-meta-label">💡 商機目的:</span>
              <span style="color: var(--text-body);">${card.target_purpose}</span>
            </div>` : ""}

            <div class="hitl-meta-row">
              <span class="hitl-meta-label">🚀 最新行動:</span>
              <span style="color: #059669; font-weight: 600;">${card.action_taken || "最新跟進"}</span>
            </div>

            <div class="hitl-log-box">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                <span style="font-size: 0.78rem; font-weight: 700; color: var(--text-muted);">📝 商業流水帳記要:</span>
                <span style="font-size: 0.72rem; color: var(--text-subtle);">預覽限 4 行</span>
              </div>
              <div style="font-size: 0.86rem; color: var(--text-body); line-height: 1.6; display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden; text-overflow: ellipsis;">${cleanUpdateLog}</div>
            </div>
          </div>
        </div>

        <div class="hitl-actions">
          <button class="btn-approve" onclick="onApproveCard('${logId}')" style="flex: 1.2; padding: 8px 12px; font-size: 0.88rem; font-weight: 700;" title="批准並存入所選專案 (若為新專案將自動建卡)">✓ 是 (Approve)</button>
          <button class="btn-edit" onclick="onEditCardModal('${logId}')" style="flex: 1; padding: 8px 12px; font-size: 0.88rem; font-weight: 600;" title="開啟完整彈窗修訂情報">✎ 修改 (Edit)</button>
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

    const updatedFields = {
      project_tag: selectedTag,
      entity_target: card ? card.entity_target : "未指定客戶 (待編輯)",
      target_purpose: card ? card.target_purpose : "",
      action_taken: card ? card.action_taken : "",
      update_log: card ? (card.update_log || card.raw_text) : ""
    };

    const res = await hitlReviewer.editAndApproveCard(logId, updatedFields);
    showToast(res.message, "success");

    if (card && card.attachment_links) {
      try {
        const links = typeof card.attachment_links === "string" ? JSON.parse(card.attachment_links) : card.attachment_links;
        if (Array.isArray(links) && links.length > 0 && links[0].url) {
          const nowStr = new Date().toISOString().replace("T", " ").slice(0, 19);
          const randSuffix = (Math.random().toString(36) + "0000").slice(2, 6);
          const attRow = [
            `ATT_${Date.now()}_${randSuffix}`,
            selectedTag,
            links[0].title || "來源附件",
            links[0].url || "",
            links[0].category || "Google Drive",
            nowStr
          ];
          sendGasRequest("batch_append_raw", {
            sheet: "Projects_Attachments",
            rows: [attRow]
          }).catch(e => console.warn("[Projects_Attachments] 自動登記失敗: ", e.message));
        }
      } catch (e) {
        console.warn("[Projects_Attachments] 解析附件鏈結異常: ", e.message);
      }
    }

    renderHitlCards(hitlReviewer.pendingCards);

    if (window.liveView) {
      window.liveView.fetchViewData(false).catch(() => {});
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
    let optionsHtml = `<option value="NEW_UNCLASSIFIED" ${isUnclassified ? "selected" : ""}>➕ 建立新專案卡 (${nextInfo.nextProjectName})</option>`;
    projectList.forEach((p) => {
      const isSelected = p.tag === currentTag && !isUnclassified;
      optionsHtml += `<option value="${p.tag}" ${isSelected ? "selected" : ""}>${p.tag} | ${p.acct ? p.acct + " : " : ""}${p.name}</option>`;
    });
    tagSelect.innerHTML = optionsHtml;

    tagSelect.onchange = function() {
      if (this.value === "NEW_UNCLASSIFIED") {
        document.getElementById("modal-hitl-entity").value = "未指定客戶 (待編輯)";
      } else {
        const matched = projectList.find(p => p.tag === this.value);
        if (matched && matched.acct) {
          document.getElementById("modal-hitl-entity").value = matched.acct;
        }
      }
    };
  }

  document.getElementById("modal-hitl-id").value = targetId;
  document.getElementById("modal-hitl-entity").value = card.entity_target || "";
  document.getElementById("modal-hitl-purpose").value = card.target_purpose || "";
  document.getElementById("modal-hitl-action").value = card.action_taken || "";
  document.getElementById("modal-hitl-log").value = card.update_log || card.raw_text || "";

  const attachCheck = document.getElementById("modal-hitl-attach-check");
  const attachBox = document.getElementById("modal-hitl-attach-box");
  const attTitleInput = document.getElementById("modal-hitl-att-title");
  const attUrlInput = document.getElementById("modal-hitl-att-url");

  if (attachCheck && attachBox) {
    attachCheck.checked = false;
    attachBox.style.display = "none";

    let defaultTitle = `${new Date().toLocaleDateString()} 來源附件`;
    let defaultUrl = "";
    let hasUrl = false;

    if (card.attachment_links) {
      try {
        const links = typeof card.attachment_links === "string" ? JSON.parse(card.attachment_links) : card.attachment_links;
        if (Array.isArray(links) && links.length > 0) {
          defaultTitle = links[0].title || defaultTitle;
          defaultUrl = links[0].url || "";
          if (defaultUrl) hasUrl = true;
        }
      } catch (e) {}
    }

    if (attTitleInput) attTitleInput.value = defaultTitle;
    if (attUrlInput) {
      attUrlInput.value = defaultUrl;
      attUrlInput.placeholder = "貼上 Google Drive 或雲端檔案分享鏈結";
    }

    if (hasUrl) {
      attachCheck.checked = true;
      attachBox.style.display = "block";
    }
  }

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
  let entityTarget = document.getElementById("modal-hitl-entity").value.trim();

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

  const updatedFields = {
    project_tag: projectTag,
    entity_target: entityTarget,
    target_purpose: document.getElementById("modal-hitl-purpose").value.trim(),
    action_taken: document.getElementById("modal-hitl-action").value.trim(),
    update_log: document.getElementById("modal-hitl-log").value.trim()
  };

  const attachCheck = document.getElementById("modal-hitl-attach-check");
  const attTitle = document.getElementById("modal-hitl-att-title") ? document.getElementById("modal-hitl-att-title").value.trim() : "";
  const attUrl = document.getElementById("modal-hitl-att-url") ? document.getElementById("modal-hitl-att-url").value.trim() : "";

  try {
    showToast("正在修訂並批准日誌...", "info");
    const res = await hitlReviewer.editAndApproveCard(logId, updatedFields);

    if (attachCheck && attachCheck.checked && attUrl) {
      let attCategory = "Google Drive";
      const lowerUrl = attUrl.toLowerCase();
      if (lowerUrl.includes("spreadsheets")) attCategory = "Google Sheets";
      else if (lowerUrl.includes("document")) attCategory = "Google Docs";
      else if (lowerUrl.includes("github.com")) attCategory = "GitHub";
      else if (!lowerUrl.includes("drive.google.com")) attCategory = "Web Link";

      const randSuffix = (Math.random().toString(36) + "0000").slice(2, 6);
      const cleanTag = (projectTag || "General").replace(/\s+/g, "_");
      const linkId = `LINK_${cleanTag}_${Date.now()}_${randSuffix}`;
      const linkRow = [
        linkId,
        projectTag || "General",
        attTitle || "專案附件資源",
        attUrl,
        attCategory,
        new Date().toISOString()
      ];

      await sendGasRequest("batch_append_raw", {
        sheet: "Projects_Attachments",
        rows: [linkRow]
      }).catch(e => console.warn("附件登記背景警示:", e));
      showToast(`📎 附件已同步歸檔至專案附件庫 [${attCategory}]！`, "success");
    }

    renderHitlCards(hitlReviewer.pendingCards);

    if (window.liveView) {
      if (!Array.isArray(window.liveView.lastRawData)) {
        window.liveView.lastRawData = [["log_id","timestamp","project_tag","entity_target","target_purpose","our_advantages","action_taken","update_log","attachment_links","confidence_score","agent_status"]];
      }
      
      const existingRawIdx = window.liveView.lastRawData.findIndex(r => r[0] === logId);
      const rawRow = [
        logId,
        new Date().toISOString(),
        projectTag,
        entityTarget,
        updatedFields.target_purpose || "",
        "",
        updatedFields.action_taken || "最新跟進",
        updatedFields.update_log || "",
        "",
        "0.95",
        "APPROVED"
      ];
      
      if (existingRawIdx > 0) {
        window.liveView.lastRawData[existingRawIdx] = rawRow;
      } else {
        window.liveView.lastRawData.push(rawRow);
      }

      if (attachCheck && attachCheck.checked && attUrl) {
        if (!Array.isArray(window.liveView.lastAttachmentsData)) {
          window.liveView.lastAttachmentsData = [["link_id","project_tag","title","url","category","created_at"]];
        }
        window.liveView.lastAttachmentsData.push([
          `LINK_${projectTag}_${Date.now()}`,
          projectTag,
          attTitle || "專案附件資源",
          attUrl,
          "Google Drive",
          new Date().toISOString()
        ]);
      }

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

    closeEditModal();
    showToast(res.message, "success");
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

// 🌐 全域安全掛載函式
window.initHitlModule = initHitlModule;
window.renderHitlCards = renderHitlCards;
window.getAvailableProjectsList = getAvailableProjectsList;
