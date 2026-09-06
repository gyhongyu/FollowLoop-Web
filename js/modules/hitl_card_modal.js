/**
 * FollowLoop-Web 名片專屬 HITL 前端交互模組 (hitl_card_modal.js)
 * 負責：名片批准入庫至 Google 通訊錄、名片編輯 Modal、Drive 縮圖高清燈箱預覽
 */

// 1. 批准入庫 (點擊「✓ 批准入庫」)
window.onApproveBusinessCard = async function(cardId) {
  const checkEl = document.getElementById(`foxlink-tag-check-${cardId}`);
  const isFoxlink = checkEl ? checkEl.checked : true;

  try {
    showToast(`正在將名片入庫至 Google 通訊錄${isFoxlink ? ' (Foxlink 公務人脈)' : ''}...`, "info");
    const res = await hitlReviewer.approveBusinessCard(cardId, null, isFoxlink);
    showToast(res.message, "success");
  } catch (err) {
    console.error("[HITL] 名片批准失敗:", err);
    showToast(`名片入庫失敗: ${err.message}`, "danger");
  }
};

// 2. 開啟名片編輯 Modal
window.onEditBusinessCardModal = function(cardId) {
  const card = hitlReviewer.pendingCards.find(c => c.log_id === cardId || c.entry_id === cardId);
  if (!card) return;

  const backdrop = document.getElementById("edit-card-modal-backdrop");
  if (!backdrop) return;

  document.getElementById("modal-card-id").value = cardId;
  document.getElementById("modal-card-name").value = card.name || "";
  document.getElementById("modal-card-company").value = card.company || "";
  document.getElementById("modal-card-title").value = card.title || "";
  document.getElementById("modal-card-phone").value = card.phone || "";
  document.getElementById("modal-card-email").value = card.email || "";
  document.getElementById("modal-card-address").value = card.address || "";
  document.getElementById("modal-card-notes").value = card.notes || "";

  backdrop.style.display = "flex";
};

window.closeEditCardModal = function() {
  const backdrop = document.getElementById("edit-card-modal-backdrop");
  if (backdrop) backdrop.style.display = "none";
};

// 3. 提交名片編輯 (更新待審卡片並可直接入庫)
window.submitEditBusinessCard = async function(andApprove = false) {
  const cardId = document.getElementById("modal-card-id").value;
  const updatedData = {
    name: document.getElementById("modal-card-name").value.trim(),
    company: document.getElementById("modal-card-company").value.trim(),
    title: document.getElementById("modal-card-title").value.trim(),
    phone: document.getElementById("modal-card-phone").value.trim(),
    email: document.getElementById("modal-card-email").value.trim(),
    address: document.getElementById("modal-card-address").value.trim(),
    notes: document.getElementById("modal-card-notes").value.trim()
  };

  if (!updatedData.name) {
    showToast("請輸入姓名！", "warning");
    return;
  }

  try {
    if (andApprove) {
      showToast("正在儲存修訂並入庫 Google 通訊錄...", "info");
      const res = await hitlReviewer.approveBusinessCard(cardId, updatedData, true);
      closeEditCardModal();
      showToast(res.message, "success");
    } else {
      showToast("正在更新名片待審資訊...", "info");
      const res = await hitlReviewer.updateBusinessCard(cardId, updatedData);
      closeEditCardModal();
      showToast(res.message, "success");
    }
  } catch (err) {
    showToast(`操作失敗: ${err.message}`, "danger");
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
