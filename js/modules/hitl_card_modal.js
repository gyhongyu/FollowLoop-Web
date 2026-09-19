/**
 * FollowLoop-Web 名片專屬 HITL 前端交互模組 (hitl_card_modal.js)
 * 負責：名片批准入庫至 Google 通訊錄、名片編輯 Modal、Drive 縮圖高清燈箱預覽
 */

// 1. 批准入庫 (點擊待審卡片上的「✓ 批准入庫」)
window.onApproveBusinessCard = async function(cardId) {
  const checkEl = document.getElementById(`foxlink-tag-check-${cardId}`);
  const isFoxlink = checkEl ? checkEl.checked : true;
  const card = hitlReviewer.pendingCards.find(c => c.log_id === cardId || c.entry_id === cardId);
  const cardName = card ? (card.name || "聯絡人") : "聯絡人";

  if (typeof window.showProgressOverlay === "function") {
    window.showProgressOverlay("正在寫入 Google 通訊錄", `準備將 [${cardName}] 入庫至 Google 通訊錄${isFoxlink ? ' (Foxlink 公務人脈)' : ''}...`);
    window.updateProgressOverlay("正在連線 Google Contacts 網關傳輸資料...", 40);
  } else {
    showToast(`正在將名片入庫至 Google 通訊錄${isFoxlink ? ' (Foxlink 公務人脈)' : ''}...`, "info");
  }

  try {
    const res = await hitlReviewer.approveBusinessCard(cardId, null, isFoxlink);
    if (typeof window.finishProgressOverlay === "function") {
      window.updateProgressOverlay("正在同步待審佇列狀態與本地快取...", 90);
      window.finishProgressOverlay(true, res.message || `🎉 名片 [${cardName}] 已成功入庫！`, 1200);
    } else {
      showToast(res.message, "success");
    }
  } catch (err) {
    console.error("[HITL] 名片批准失敗:", err);
    if (typeof window.finishProgressOverlay === "function") {
      window.finishProgressOverlay(false, `名片入庫失敗: ${err.message}`);
    } else {
      showToast(`名片入庫失敗: ${err.message}`, "danger");
    }
  }
};

// 2. 開啟名片編輯 Modal
window.onEditBusinessCardModal = function(cardId) {
  const card = hitlReviewer.pendingCards.find(c => c.log_id === cardId || c.entry_id === cardId);
  if (!card) return;

  const backdrop = document.getElementById("edit-card-modal-backdrop");
  if (!backdrop) return;

  // 重設人脈關聯狀態
  window.unlinkCardContactCandidate(false);

  // 拆分手機、座機、傳真
  let mobileStr = "";
  let workPhoneStr = "";
  let faxStr = "";

  const phonesList = Array.isArray(card.phones) && card.phones.length > 0 ? card.phones : (card.phone ? [{ value: card.phone, type: "work" }] : []);
  phonesList.forEach(p => {
    const val = p.value || "";
    const type = (p.type || "").toLowerCase();
    if (type.includes("fax")) {
      faxStr = val;
    } else if (type === "mobile" || type === "cell" || (val.startsWith("+") && !val.includes("120-") && !val.includes(" 120 "))) {
      if (!mobileStr) mobileStr = val;
      else workPhoneStr = val;
    } else {
      if (!workPhoneStr) workPhoneStr = val;
      else if (!mobileStr) mobileStr = val;
    }
  });

  document.getElementById("modal-card-id").value = cardId;
  document.getElementById("modal-card-name").value = card.name || "";
  document.getElementById("modal-card-company").value = card.company || "";
  document.getElementById("modal-card-title").value = card.title || "";
  
  // 獨立通訊欄位回填
  const mobEl = document.getElementById("modal-card-mobile");
  if (mobEl) mobEl.value = mobileStr;
  const workEl = document.getElementById("modal-card-work-phone");
  if (workEl) workEl.value = workPhoneStr;
  const faxEl = document.getElementById("modal-card-fax");
  if (faxEl) faxEl.value = faxStr;

  document.getElementById("modal-card-email").value = card.email || "";
  const webEl = document.getElementById("modal-card-website");
  if (webEl) webEl.value = card.website || card.url || "";
  document.getElementById("modal-card-address").value = card.address || "";
  document.getElementById("modal-card-notes").value = card.notes || "";

  // 關閉搜尋抽屜
  const drawer = document.getElementById("modal-card-contact-picker-drawer");
  if (drawer) drawer.style.display = "none";

  backdrop.style.display = "flex";
};

window.closeEditCardModal = function() {
  const backdrop = document.getElementById("edit-card-modal-backdrop");
  if (backdrop) backdrop.style.display = "none";
  window.unlinkCardContactCandidate(false);
};

// 2.1 取消關聯現有 Google 聯絡人
window.unlinkCardContactCandidate = function(notify = true) {
  const linkedInput = document.getElementById("modal-card-linked-gc-id");
  if (linkedInput) linkedInput.value = "";

  const banner = document.getElementById("modal-card-linked-gc-banner");
  if (banner) banner.style.display = "none";

  const approveBtn = document.getElementById("modal-card-approve-btn");
  if (approveBtn) {
    approveBtn.innerHTML = "<span>✓ 儲存並批准入庫</span>";
    approveBtn.style.background = "";
  }

  if (notify && typeof showToast === "function") {
    showToast("已取消人脈關聯，入庫時將建立全新聯絡人", "info");
  }
};

// 3. 提交名片編輯 (更新待審卡片並可直接入庫)
window.submitEditBusinessCard = async function(andApprove = false) {
  const cardId = document.getElementById("modal-card-id").value;
  const webEl = document.getElementById("modal-card-website");
  
  const mobVal = (document.getElementById("modal-card-mobile") ? document.getElementById("modal-card-mobile").value : "").trim();
  const workVal = (document.getElementById("modal-card-work-phone") ? document.getElementById("modal-card-work-phone").value : "").trim();
  const faxVal = (document.getElementById("modal-card-fax") ? document.getElementById("modal-card-fax").value : "").trim();

  // 自動組裝乾淨的 phones 陣列與主電話
  const assembledPhones = [];
  if (mobVal) assembledPhones.push({ value: mobVal, type: "mobile" });
  if (workVal) assembledPhones.push({ value: workVal, type: "work" });
  if (faxVal) assembledPhones.push({ value: faxVal, type: "work_fax" });

  const primaryPhone = mobVal || workVal || faxVal || "";

  const updatedData = {
    name: document.getElementById("modal-card-name").value.trim(),
    company: document.getElementById("modal-card-company").value.trim(),
    title: document.getElementById("modal-card-title").value.trim(),
    phone: primaryPhone,
    phones: assembledPhones,
    email: document.getElementById("modal-card-email").value.trim(),
    website: webEl ? webEl.value.trim() : "",
    address: document.getElementById("modal-card-address").value.trim(),
    notes: document.getElementById("modal-card-notes").value.trim()
  };

  if (!updatedData.name) {
    showToast("請輸入姓名！", "warning");
    return;
  }

  // 取得使用者關聯的現有 Google 聯絡人 resourceName
  const linkedGcId = (document.getElementById("modal-card-linked-gc-id") ? document.getElementById("modal-card-linked-gc-id").value : "").trim();
  const isUpdateMode = !!linkedGcId;

  try {
    if (andApprove) {
      const pName = updatedData.name || "聯絡人";
      if (typeof window.showProgressOverlay === "function") {
        window.showProgressOverlay(
          isUpdateMode ? "正在更新 Google 通訊錄" : "正在入庫 Google 通訊錄",
          isUpdateMode ? `正在將名片資訊整合更新至現有聯絡人 [${pName}]...` : `正在建立新聯絡人 [${pName}] 並入庫...`
        );
        window.updateProgressOverlay(
          isUpdateMode ? "比對並智慧合併電話、Email 與備註中..." : "正在傳輸名片完整屬性至 Google 通訊錄...",
          40
        );
      } else {
        showToast(isUpdateMode ? `正在將名片資訊整合更新至 Google 聯絡人...` : "正在儲存修訂並入庫 Google 通訊錄...", "info");
      }

      const res = await hitlReviewer.approveBusinessCard(cardId, updatedData, true, linkedGcId);

      if (typeof window.finishProgressOverlay === "function") {
        window.updateProgressOverlay("同步待審佇列狀態與本地快取...", 85);
        window.finishProgressOverlay(true, res.message || "🎉 名片已成功處理！", 1200);
      } else {
        showToast(res.message, "success");
      }
      closeEditCardModal();
    } else {
      showToast("正在更新名片待審資訊...", "info");
      const res = await hitlReviewer.updateBusinessCard(cardId, updatedData);
      closeEditCardModal();
      showToast(res.message, "success");
    }
  } catch (err) {
    console.error("[HITL] 操作失敗:", err);
    if (andApprove && typeof window.finishProgressOverlay === "function") {
      window.finishProgressOverlay(false, `操作失敗: ${err.message}`);
    } else {
      showToast(`操作失敗: ${err.message}`, "danger");
    }
  }
};

// 4. 原圖檢視燈箱 (支援 Google Drive 縮圖代理高清防破圖)
window.openCardPreviewLightbox = function(url) {
  if (!url) return;
  const lb = document.getElementById("card-lightbox-backdrop");
  const img = document.getElementById("card-lightbox-img");
  const link = document.getElementById("card-lightbox-link");
  if (lb && img) {
    const fileIdMatch = url.match(/[-\w]{25,}/);
    if (fileIdMatch) {
      const fileId = fileIdMatch[0];
      img.src = `https://drive.google.com/thumbnail?sz=w1200&id=${fileId}`;
    } else {
      img.src = url;
    }
    if (link) link.href = url;
    lb.style.display = "flex";
  } else {
    window.open(url, "_blank");
  }
};

window.closeCardLightbox = function() {
  const lb = document.getElementById("card-lightbox-backdrop");
  if (lb) lb.style.display = "none";
};

// =========================================================================
// 🔗 5. 智慧人脈候選抽屜與即時搜尋控制器 (Contact Linker & Picker)
// =========================================================================
window.toggleCardContactPicker = async function() {
  const drawer = document.getElementById("modal-card-contact-picker-drawer");
  if (!drawer) return;

  const isHidden = drawer.style.display === "none";
  drawer.style.display = isHidden ? "block" : "none";

  if (isHidden) {
    const cardId = document.getElementById("modal-card-id").value;
    const card = hitlReviewer.pendingCards.find(c => c.log_id === cardId || c.entry_id === cardId);
    const searchInput = document.getElementById("modal-card-contact-search-input");
    
    let defaultQ = "";
    if (card) {
      defaultQ = card.name || card.company || "";
    }
    if (searchInput) searchInput.value = defaultQ;
    await window.fetchAndRenderCardContactCandidates(defaultQ, card);
  }
};

window.searchCardContactsManual = async function() {
  const searchInput = document.getElementById("modal-card-contact-search-input");
  const q = searchInput ? searchInput.value.trim() : "";
  await window.fetchAndRenderCardContactCandidates(q);
};

// 綁定鍵盤 Enter 快捷搜尋
document.addEventListener("DOMContentLoaded", () => {
  const searchInput = document.getElementById("modal-card-contact-search-input");
  if (searchInput) {
    searchInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        window.searchCardContactsManual();
      }
    });
  }
});

window.fetchAndRenderCardContactCandidates = async function(query, cardContext = null) {
  const listEl = document.getElementById("modal-card-contact-candidates-list");
  if (!listEl) return;

  listEl.innerHTML = `<div style="color: var(--text-subtle); text-align: center; padding: 6px;">🔍 正在搜尋 WhatsApp 與 Google 通訊錄...</div>`;

  try {
    const isManualSearch = typeof query === "string" && query.trim().length > 0;
    const searchPayload = isManualSearch
      ? { query: query.trim() }
      : {
          name: document.getElementById("modal-card-name") ? document.getElementById("modal-card-name").value : "",
          company: document.getElementById("modal-card-company") ? document.getElementById("modal-card-company").value : "",
          phone: document.getElementById("modal-card-mobile") ? document.getElementById("modal-card-mobile").value : ""
        };

    const res = await fetch("http://127.0.0.1:8765/api/exec", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "search_local_contacts",
        data: searchPayload
      })
    }).then(r => r.ok ? r.json() : null).catch(() => null);

    if (!res || !res.candidates || res.candidates.length === 0) {
      listEl.innerHTML = `<div style="color: var(--text-muted); text-align: center; padding: 8px;">未找到相符人脈 (可於上方輸入框換關鍵字搜尋)</div>`;
      return;
    }

    listEl.innerHTML = res.candidates.map(c => {
      const isWA = c.source === "WhatsApp";
      const icon = isWA ? "🟢" : "🔵";
      const sourceBadge = isWA 
        ? `<span style="background:rgba(37,211,102,0.15); color:#25D366; padding:1px 6px; border-radius:4px; font-size:0.7rem; border:1px solid rgba(37,211,102,0.3);">WhatsApp</span>` 
        : `<span style="background:rgba(59,130,246,0.15); color:#60a5fa; padding:1px 6px; border-radius:4px; font-size:0.7rem; border:1px solid rgba(59,130,246,0.3);">Google Contacts</span>`;
      const phoneDisp = c.phone ? `📱 ${c.phone}` : "無電話";
      const compDisp = c.company ? ` | 🏢 ${c.company}` : "";
      const titleDisp = c.title ? ` (${c.title})` : "";
      const emailDisp = c.email ? ` | ✉️ ${c.email}` : "";

      return `
      <div onclick="window.selectCardContactCandidate('${encodeURIComponent(JSON.stringify(c))}')" style="display: flex; justify-content: space-between; align-items: center; background: rgba(255,255,255,0.04); padding: 8px 12px; border-radius: 6px; cursor: pointer; border: 1px solid rgba(255,255,255,0.08); transition: all 0.15s;" onmouseover="this.style.background='rgba(16, 185, 129, 0.12)'; this.style.borderColor='rgba(16, 185, 129, 0.4)';" onmouseout="this.style.background='rgba(255,255,255,0.04)'; this.style.borderColor='rgba(255,255,255,0.08)';">
        <div style="display: flex; flex-direction: column; gap: 2px; overflow: hidden; text-align: left; max-width: 80%;">
          <div style="font-weight: 700; color: #fff; font-size: 0.88rem; display: flex; align-items: center; gap: 6px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
            <span>${icon} ${c.name}</span>
            ${sourceBadge}
          </div>
          <div style="font-size: 0.78rem; color: #34d399; font-family: monospace;">
            ${phoneDisp}<span style="color: var(--text-muted); font-family: sans-serif;">${compDisp}${titleDisp}${emailDisp}</span>
          </div>
        </div>
        <button type="button" style="background: rgba(16, 185, 129, 0.2); border: 1px solid #10b981; color: #10b981; border-radius: 4px; padding: 4px 10px; font-size: 0.78rem; font-weight: 700; cursor: pointer; white-space: nowrap;">
          帶入此人 ➔
        </button>
      </div>`;
    }).join("");

  } catch (err) {
    listEl.innerHTML = `<div style="color: #ef4444; text-align: center; padding: 6px;">搜尋失敗: ${err.message}</div>`;
  }
};

window.selectCardContactCandidate = function(candidateJsonStr) {
  try {
    const candidate = JSON.parse(decodeURIComponent(candidateJsonStr));
    const mobileInput = document.getElementById("modal-card-mobile");

    let targetPhone = candidate.phone || "";
    if (targetPhone && mobileInput) {
      if (!targetPhone.startsWith("+") && targetPhone.length >= 8) {
        targetPhone = "+" + targetPhone;
      }
      mobileInput.value = targetPhone;
    }

    // 若名片缺少公司/Email，且庫中有，自動輔助補齊
    const emailInput = document.getElementById("modal-card-email");
    if (emailInput && !emailInput.value && candidate.email) {
      emailInput.value = candidate.email;
    }

    // 🔗 核心關鍵：若來自 Google Contacts，強制綁定 resourceName 並切換為 UPDATE 整合模式
    if (candidate.source === "GoogleContacts" && candidate.id) {
      const linkedInput = document.getElementById("modal-card-linked-gc-id");
      if (linkedInput) linkedInput.value = candidate.id;

      const banner = document.getElementById("modal-card-linked-gc-banner");
      const nameEl = document.getElementById("modal-card-linked-gc-name");
      if (nameEl) nameEl.textContent = `${candidate.name}${targetPhone ? ' (' + targetPhone + ')' : ''}`;
      if (banner) banner.style.display = "flex";

      const approveBtn = document.getElementById("modal-card-approve-btn");
      if (approveBtn) {
        approveBtn.innerHTML = "<span>✓ 儲存並更新至 Google 聯絡人</span>";
        approveBtn.style.background = "linear-gradient(135deg, #2563eb, #1d4ed8)";
      }

      showToast(`🔗 已成功關聯 Google 聯絡人: ${candidate.name}！批准時將自動整合更新。`, "success");
    } else {
      showToast(`已成功帶入號碼: ${targetPhone} (${candidate.name})`, "success");
    }

    const drawer = document.getElementById("modal-card-contact-picker-drawer");
    if (drawer) drawer.style.display = "none";

  } catch (e) {
    console.warn("解析候選人失敗:", e);
  }
};
