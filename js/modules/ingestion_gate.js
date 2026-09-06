/**
 * FollowLoop-Web 直傳門閥模組 (ingestion_gate.js)
 * 負責：拖曳/選取檔案、錄音上傳、8 大物理場景快捷分類 (0 LLM 直傳)、名片正反面本地合成、速記文字 AI 提煉
 */

function initIngestionModule() {
  const dropzone = document.getElementById("dropzone");
  const fileInput = document.getElementById("file-input");
  const progressContainer = document.getElementById("progress-container");
  const progressBarFill = document.getElementById("progress-bar-fill");
  const progressText = document.getElementById("progress-text");
  
  const micBtn = document.getElementById("mic-btn");
  const timerText = document.getElementById("timer-text");
  
  const noteTextarea = document.getElementById("note-textarea");
  const submitNoteBtn = document.getElementById("submit-note-btn");

  if (dropzone && fileInput) {
    dropzone.addEventListener("click", () => fileInput.click());

    dropzone.addEventListener("dragover", (e) => {
      e.preventDefault();
      dropzone.classList.add("dragover");
    });

    dropzone.addEventListener("dragleave", () => {
      dropzone.classList.remove("dragover");
    });

    dropzone.addEventListener("drop", (e) => {
      e.preventDefault();
      dropzone.classList.remove("dragover");
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        handleFilesBatch(Array.from(e.dataTransfer.files));
      }
    });

    fileInput.addEventListener("change", () => {
      if (fileInput.files && fileInput.files.length > 0) {
        handleFilesBatch(Array.from(fileInput.files));
      }
    });

    // 📋 全域剪貼簿貼上監聽 (支援直接 Ctrl+V 貼上截圖直傳，或自動填入文字速記框)
    window.addEventListener("paste", (e) => {
      const activeEl = document.activeElement;
      const isTextInputFocused = activeEl && (activeEl.tagName === "INPUT" || activeEl.tagName === "TEXTAREA");
      const items = e.clipboardData && e.clipboardData.items;
      if (!items || items.length === 0) return;

      const imageFiles = [];
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.type && item.type.startsWith("image/")) {
          const blob = item.getAsFile();
          if (blob) {
            const now = new Date();
            const pad = (n) => String(n).padStart(2, "0");
            const timestamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
            const ext = blob.type.split("/")[1] || "png";
            const namedFile = new File([blob], `screenshot_${timestamp}.${ext}`, { type: blob.type });
            imageFiles.push(namedFile);
          }
        }
      }

      // 1. 若剪貼簿有圖片，直接啟動素材分流直傳
      if (imageFiles.length > 0) {
        e.preventDefault();
        showToast(`📋 已自剪貼簿取得 ${imageFiles.length} 張截圖，即刻啟動分流直傳...`, "info");
        handleFilesBatch(imageFiles);
        return;
      }

      // 2. 若剪貼簿為純文字，且游標尚未聚焦任何輸入框 ➔ 自動聚焦速記框並貼上！
      if (!isTextInputFocused && noteTextarea) {
        const text = e.clipboardData.getData("text");
        if (text && text.trim()) {
          e.preventDefault();
          noteTextarea.focus();
          const currentVal = noteTextarea.value;
          noteTextarea.value = currentVal ? `${currentVal}\n${text}` : text;
          noteTextarea.selectionStart = noteTextarea.selectionEnd = noteTextarea.value.length;
          showToast("📋 已自動將剪貼簿文字填入速記框", "info");
        }
      }
    });
  }

  if (micBtn) {
    micBtn.addEventListener("click", async () => {
      if (!driveUploader.isRecording) {
        try {
          await driveUploader.startRecording((seconds) => {
            const mins = String(Math.floor(seconds / 60)).padStart(2, "0");
            const secs = String(seconds % 60).padStart(2, "0");
            timerText.textContent = `${mins}:${secs}`;
          });
          micBtn.classList.add("recording");
          showToast("開始麥克風錄音...", "info");
        } catch (err) {
          showToast(err.message, "danger");
        }
      } else {
        try {
          micBtn.classList.remove("recording");
          timerText.textContent = "00:00";
          const audioFile = await driveUploader.stopRecording();
          
          // 🌟 彈出 4 選 1 語音分流選單
          const modalBackdrop = document.getElementById("audio-category-modal-backdrop");
          if (modalBackdrop) {
            modalBackdrop.style.display = "flex";
            window._pendingAudioFile = audioFile;
          } else {
            await handleFileUpload(audioFile);
          }
        } catch (err) {
          showToast(err.message, "danger");
        }
      }
    });
  }

  // 🎙️ 綁定語音 4 選 1 分流彈窗按鈕事件
  const audioCloseBtn = document.getElementById("audio-cat-close-btn");
  if (audioCloseBtn) {
    audioCloseBtn.addEventListener("click", () => {
      const modalBackdrop = document.getElementById("audio-category-modal-backdrop");
      if (modalBackdrop) modalBackdrop.style.display = "none";
      window._pendingAudioFile = null;
    });
  }

  document.querySelectorAll(".audio-cat-btn").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      const catKey = btn.getAttribute("data-cat") || "raw";
      const modalBackdrop = document.getElementById("audio-category-modal-backdrop");
      if (modalBackdrop) modalBackdrop.style.display = "none";

      const file = window._pendingAudioFile;
      window._pendingAudioFile = null;
      if (!file) return;

      const catLabelMap = {
        meeting: "會議錄音",
        call: "通話記錄",
        memo: "個人速記",
        raw: "待轉寫語音"
      };

      const now = new Date();
      const pad = (n) => String(n).padStart(2, "0");
      const ymd = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
      const hms = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
      const ext = file.name.split('.').pop() || "m4a";
      const customName = `audio_${catKey}_${ymd}_${hms}.${ext}`;
      
      const renamedFile = new File([file], customName, { type: file.type });
      renamedFile.transcript = file.transcript || "";

      showToast(`🎙️ 正在分流至 ${catLabelMap[catKey] || '語音箱'} (0 LLM 直傳)...`, "info");
      await executeDirectCategorizedUpload(renamedFile, `[語音/${catLabelMap[catKey]}]`, "VOICE_MEMOS");
    });
  });

  if (submitNoteBtn && noteTextarea) {
    submitNoteBtn.addEventListener("click", async () => {
      const text = noteTextarea.value.trim();
      if (!text) {
        showToast("請輸入速記內容！", "warning");
        return;
      }

      submitNoteBtn.disabled = true;
      submitNoteBtn.innerHTML = "<span>⚡ AI 智腦提煉中...</span>";
      showToast("⚡ 正在呼叫打工仔大模型中央總帳提煉情報...", "info");
      if (window.FL_AI_LOGGER) {
        window.FL_AI_LOGGER.startTask("速記情報提煉", text.slice(0, 30));
      }

      try {
        const projectList = getAvailableProjectsList();
        if (window.FL_AI_LOGGER) {
          window.FL_AI_LOGGER.log("呼叫打工仔大模型", "進行 7 大 Invariants 結構化提煉");
        }
        const extracted = await window.openRouterExtractor.extract(text, projectList);

        const now = new Date();
        const pad = (n) => String(n).padStart(2, "0");
        const cleanTimestamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
        const randSuffix = (Math.random().toString(36) + "0000").slice(2, 6);
        const logId = `LOG_TXT_${Date.now()}_${randSuffix}`;

        if (window.FL_AI_LOGGER) {
          window.FL_AI_LOGGER.log("持久化存檔", `寫入 Memory_Pool_Raw (${logId})`);
        }

        const isUrlItem = !!extracted.attachment_links;

        // 100% 精確對齊 11 欄 RAW_HEADERS
        const rawRow = [
          logId,                                            // 0. A log_id
          cleanTimestamp,                                   // 1. B timestamp
          extracted.project_tag || "NEW_UNCLASSIFIED",      // 2. C project_tag
          extracted.entity_target || "未指定客戶 (待編輯)",   // 3. D entity_target
          extracted.target_purpose || "",                   // 4. E target_purpose
          "",                                               // 5. F our_advantages
          extracted.action_taken || "最新跟進紀錄",          // 6. G action_taken
          isUrlItem ? (extracted.update_log || "") : (extracted.update_log || text), // 7. H update_log (若為外鏈，留空選填)
          extracted.attachment_links || "",                 // 8. I attachment_links
          String(extracted.confidence_score || 0.85),       // 9. J confidence_score
          "PENDING_REVIEW"                                  // 10. K agent_status
        ];

        // ☁️ 持久化寫入雲端 Memory_Pool_Raw
        await sendGasRequest("batch_append_raw", {
          sheet: "Memory_Pool_Raw",
          rows: [rawRow]
        });

        // ⚡ 即時注入前端 HITL 待審核佇列 (0ms 反應)
        const modelLabel = extracted.params_b ? `${extracted.model_used} (${extracted.params_b}B)` : (extracted.model_used || "OpenRouter");
        const newCard = {
          entry_id: logId,
          log_id: logId,
          timestamp: cleanTimestamp,
          source_type: isUrlItem ? "🔗 雲端資源鏈結" : `🤖 AI 速記 (${modelLabel})`,
          project_tag: extracted.project_tag || "NEW_UNCLASSIFIED",
          entity_target: extracted.entity_target || "未指定客戶 (待編輯)",
          target_purpose: extracted.target_purpose || "",
          action_taken: extracted.action_taken || (isUrlItem ? "登記專案參考資源" : "最新跟進紀錄"),
          update_log: isUrlItem ? (extracted.update_log || "") : (extracted.update_log || text),
          raw_text: text,
          attachment_links: extracted.attachment_links || "",
          confidence_score: String(extracted.confidence_score || 0.85),
          status: "PENDING_REVIEW"
        };

        if (window.hitlReviewer) {
          window.hitlReviewer.addCardDirectly(newCard);
        }

        // 更新頂部 HITL 徽章
        const badgeEl = document.getElementById("hitl-badge-count");
        if (badgeEl && window.hitlReviewer) {
          badgeEl.textContent = window.hitlReviewer.pendingCards.length;
        }

        noteTextarea.value = "";
        if (window.FL_AI_LOGGER) {
          window.FL_AI_LOGGER.completeTask(`提煉成功，生成待審核卡片 (${modelLabel})`);
        }
        showToast(`🎉 速記提煉完成！已生成待審核卡片 (模型: ${modelLabel})`, "success");
      } catch (err) {
        if (window.FL_AI_LOGGER) {
          window.FL_AI_LOGGER.failTask(`速記提煉失敗: ${err.message}`);
        }
        showToast(`速記提煉失敗: ${err.message}`, "danger");
      } finally {
        submitNoteBtn.disabled = false;
        submitNoteBtn.innerHTML = "<span>🚀 傳送至 FollowLoop 門閥</span>";
      }
    });
  }

  /**
   * ⚡ 執行純代碼 / 0 LLM 素材分類直傳 Google Drive
   */
  async function executeDirectCategorizedUpload(file, userNotes = "", categoryKey = "UNCLASSIFIED") {
    progressContainer.classList.add("active");
    progressBarFill.style.width = "0%";
    progressBarFill.style.background = "var(--color-primary)";
    const catConfig = CONFIG.RAW_SCENE_CATEGORIES[categoryKey] || CONFIG.RAW_SCENE_CATEGORIES.UNCLASSIFIED;
    progressText.textContent = `⚡ 正在直傳至 ${catConfig.icon} ${catConfig.folder}: ${file.name}... (0%)`;

    try {
      const driveRes = await driveUploader.uploadFileDirect(file, userNotes, (percent) => {
        progressBarFill.style.width = `${percent}%`;
        progressText.textContent = `直傳 ${catConfig.folder} 中: ${percent}%`;
      }, null, categoryKey);

      progressBarFill.style.width = "100%";
      progressText.textContent = `✅ 直傳完成！已安全存入 ${catConfig.folder}/`;
      showToast(`🎉 檔案 ${file.name} 已安全存入 ${catConfig.icon} ${catConfig.folder}/！`, "success");
      
      if (noteTextarea) noteTextarea.value = "";
    } catch (err) {
      progressBarFill.style.width = "100%";
      progressBarFill.style.background = "#ef4444";
      progressText.textContent = `❌ 上傳失敗: ${err.message}`;
      showToast(`上傳失敗: ${err.message}`, "danger");
    } finally {
      setTimeout(() => {
        progressContainer.classList.remove("active");
      }, 3500);
    }
  }

  /**
   * ⚡ 彈出快捷素材分類與人類覆寫確認彈窗 (1 點即傳 Click-and-Go)
   */
  function promptQuickCategoryModal(fileOrFiles, defaultCategory = "UNCLASSIFIED", summaryText = "", userNotes = "") {
    return new Promise((resolve) => {
      const modalBackdrop = document.getElementById("quick-category-modal-backdrop");
      const previewInfo = document.getElementById("quick-cat-preview-info");
      const timerLabel = document.getElementById("quick-cat-timer-label");
      const confirmBtn = document.getElementById("quick-cat-confirm-btn");
      const cancelBtn = document.getElementById("quick-cat-cancel-btn");
      const closeBtn = document.getElementById("quick-cat-close-btn");

      const isBatch = Array.isArray(fileOrFiles);
      let selectedCat = defaultCategory;

      if (previewInfo) {
        if (isBatch) {
          const totalSizeKb = fileOrFiles.reduce((acc, f) => acc + f.size, 0) / 1024;
          const namesList = fileOrFiles.map(f => f.name).slice(0, 3).join(", ") + (fileOrFiles.length > 3 ? ` 等 ${fileOrFiles.length} 檔` : '');
          previewInfo.innerHTML = `
            <div style="font-weight:700; color:var(--text-heading); margin-bottom:4px;">📁 批次素材：${fileOrFiles.length} 個檔案 (${totalSizeKb.toFixed(1)} KB)</div>
            <div style="font-size:0.8rem; color:var(--text-muted); word-break:break-all;">清單：<span style="color:#818cf8;">${namesList}</span></div>
            <div style="font-size:0.75rem; color:var(--text-subtle); margin-top:4px;">請指定統一目標箱（點擊選項立刻發起直傳）：</div>
          `;
        } else {
          const file = fileOrFiles;
          previewInfo.innerHTML = `
            <div style="font-weight:700; color:var(--text-heading); margin-bottom:4px;">📄 檔案：${file.name} (${(file.size/1024).toFixed(1)} KB)</div>
            <div style="font-size:0.8rem; color:var(--text-muted);">${summaryText ? `提示：<b style="color:#818cf8;">${summaryText}</b>` : '請點選目標箱直接上傳：'}</div>
            <div style="font-size:0.75rem; color:var(--text-subtle); margin-top:2px;">目標門閥：<b>${CONFIG.DRIVE_RAW_INPUTS_FOLDER_NAME || 'FollowLoop_Storage'}/</b></div>
          `;
        }
      }

      const cleanup = () => {
        if (modalBackdrop) modalBackdrop.style.display = "none";
      };

      const doConfirm = (cat) => {
        cleanup();
        resolve(cat || selectedCat);
      };

      const doCancel = () => {
        cleanup();
        resolve(null);
      };

      // 點擊任何分類選項，立刻確認並發起直傳 (Click & Go)
      document.querySelectorAll(".quick-cat-option").forEach(b => {
        b.onclick = () => {
          const cat = b.getAttribute("data-key");
          doConfirm(cat);
        };
      });

      if (confirmBtn) confirmBtn.onclick = () => doConfirm(selectedCat);
      if (cancelBtn) cancelBtn.onclick = doCancel;
      if (closeBtn) closeBtn.onclick = doCancel;

      if (timerLabel) timerLabel.textContent = "請點選目標箱直接上傳 (1 點即發)：";
      if (modalBackdrop) modalBackdrop.style.display = "flex";
    });
  }

  async function handleFileUpload(file) {
    if (!file) return;

    const userNotes = noteTextarea ? noteTextarea.value : "";
    const isAudio = file.type.startsWith("audio/") || file.name.match(/\.(mp3|m4a|wav|aac|ogg|webm|amr)$/i);

    // 🌟 1. 語音音訊 ➔ 彈出 4 選 1 語音菜單
    if (isAudio) {
      const modalBackdrop = document.getElementById("audio-category-modal-backdrop");
      if (modalBackdrop) {
        modalBackdrop.style.display = "flex";
        window._pendingAudioFile = file;
        return;
      }
    }

    // 🌟 2. 智慧預判預設分類
    let defaultCat = "UNCLASSIFIED";
    let summaryHint = "";
    const isImage = file.type.startsWith("image/");
    const isPdf = file.type === "application/pdf" || file.name.match(/\.pdf$/i);
    const isDocText = file.type.startsWith("text/") || file.name.match(/\.(txt|md|json|csv|log|ini|conf)$/i);
    const isDocument = isPdf || isDocText || file.name.match(/\.(docx|doc|pptx|ppt|xlsx|xls|cad|dwg|zip|rar|7z)$/i);

    if (isDocument) {
      const isLikelyVoucher = file.name.match(/(invoice|receipt|bill|voucher|ticket|flight|hotel|發票|收據|單據|報銷|水單|車票|機票)/i);
      defaultCat = isLikelyVoucher ? "VOUCHERS" : "PROJECT_DOCS";
      summaryHint = isLikelyVoucher ? "偵測為報銷單據/發票文檔" : "偵測為專案/業務文檔";
    } else if (isImage) {
      const isCardName = file.name.match(/(card|namecard|businesscard|名片)/i);
      const isVoucherName = file.name.match(/(invoice|receipt|bill|voucher|ticket|發票|收據|單據|報銷)/i);
      const isChatName = file.name.match(/(chat|wechat|whatsapp|webex|screen|對話|截圖)/i);
      const isLinkName = file.name.match(/(link|url|http|web|site|news|新聞|鏈結|連結|網址)/i);
      if (isCardName) {
        defaultCat = "BUSINESS_CARDS";
        summaryHint = "檔名特徵包含名片";
      } else if (isVoucherName) {
        defaultCat = "VOUCHERS";
        summaryHint = "檔名特徵包含報銷/發票";
      } else if (isLinkName) {
        defaultCat = "LINKS";
        summaryHint = "檔名特徵包含網址/新聞鏈結";
      } else if (isChatName) {
        defaultCat = "CHAT_SCREENSHOTS";
        summaryHint = "檔名特徵包含對話截圖";
      }
    }

    // 🌟 3. 彈出分類確認選單
    let chosenCat = await promptQuickCategoryModal(file, defaultCat, summaryHint, userNotes);
    if (!chosenCat) {
      showToast("已取消上傳", "info");
      return;
    }

    if (chosenCat === "CARDS_SINGLE" || chosenCat === "CARDS_DOUBLE") {
      chosenCat = "BUSINESS_CARDS";
    }

    await executeDirectCategorizedUpload(file, userNotes, chosenCat);
  }

  /**
   * 🖼️ 內部輔助：將單一檔案渲染為 HTMLCanvasElement
   */
  async function renderItemToCanvas(file, targetWidth = null) {
    const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
    if (isPdf && window.pdfjsLib) {
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      const page = await pdf.getPage(1);
      const viewport = page.getViewport({ scale: 1.5 });
      const canvas = document.createElement("canvas");
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport: viewport }).promise;
      return canvas;
    }

    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        const w = img.naturalWidth || img.width || 800;
        const h = img.naturalHeight || img.height || 600;
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas);
      };
      img.onerror = (err) => {
        URL.revokeObjectURL(url);
        reject(new Error(`讀取素材失敗 (${file.name}): ` + err));
      };
      img.src = url;
    });
  }

  /**
   * 🖼️ Canvas 本地將 2 個素材 (JPG/PNG/WebP/PDF) 上下自動合成單一長圖
   */
  async function mergeTwoItemsVertically(file1, file2) {
    const [c1, c2] = await Promise.all([
      renderItemToCanvas(file1),
      renderItemToCanvas(file2)
    ]);

    let targetWidth = Math.max(c1.width, c2.width);
    const maxSide = 1200;
    if (targetWidth > maxSide) {
      targetWidth = maxSide;
    }

    const h1 = Math.round(c1.height * (targetWidth / c1.width));
    const h2 = Math.round(c2.height * (targetWidth / c2.width));
    const padding = 20;
    const targetHeight = Math.round(h1 + h2 + padding);

    const mergedCanvas = document.createElement("canvas");
    mergedCanvas.width = targetWidth;
    mergedCanvas.height = targetHeight;
    const ctx = mergedCanvas.getContext("2d");

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, targetWidth, targetHeight);
    ctx.drawImage(c1, 0, 0, targetWidth, h1);

    ctx.fillStyle = "#e2e8f0";
    ctx.fillRect(0, h1 + 8, targetWidth, 4);

    ctx.drawImage(c2, 0, h1 + padding, targetWidth, h2);

    return new Promise((resolve, reject) => {
      mergedCanvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error("Canvas 合成名片圖檔失敗"));
          return;
        }
        const now = new Date();
        const pad = (n) => String(n).padStart(2, "0");
        const ymd = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
        const mergedFile = new File([blob], `card_${ymd}_merged.jpg`, { type: "image/jpeg" });
        resolve(mergedFile);
      }, "image/jpeg", 0.85);
    });
  }

  /**
   * 🌟 批次素材分流處理器
   */
  async function handleFilesBatch(files) {
    if (!files || files.length === 0) return;

    if (files.length === 1) {
      await handleFileUpload(files[0]);
      return;
    }

    const userNotes = noteTextarea ? noteTextarea.value : "";
    const allCardCandidates = files.every(f => f.type.startsWith("image/") || f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf"));

    let defaultCat = "UNCLASSIFIED";
    if (allCardCandidates) {
      defaultCat = files.length === 2 ? "CARDS_DOUBLE" : "CARDS_SINGLE";
    }

    const chosenCat = await promptQuickCategoryModal(files, defaultCat, `已選取 ${files.length} 個檔案`, userNotes);
    if (!chosenCat) {
      showToast("已取消批次上傳", "info");
      return;
    }

    // 🪪 情況 A：【🔄 雙面名片 (合拼為1張)】
    if (chosenCat === "CARDS_DOUBLE") {
      if (files.length !== 2) {
        showToast("⚠️ 雙面名片合體僅限選取 2 個素材 (正面與背面)！", "warning");
        return;
      }
      try {
        showToast("🔄 正在本地將名片正反面上下合成單張高畫質大圖...", "info");
        const mergedCardFile = await mergeTwoItemsVertically(files[0], files[1]);
        showToast("⚡ 合成完畢！開始直傳至 BusinessCards/ 箱...", "info");
        await executeDirectCategorizedUpload(mergedCardFile, `[雙面名片合併] ${userNotes}`.trim(), "BUSINESS_CARDS");
        showToast("🎉 雙面名片已合為單圖並安全存入！", "success");
        return;
      } catch (mergeErr) {
        console.error("[CardMerge] 合成名片失敗:", mergeErr);
        showToast(`名片合成失敗: ${mergeErr.message}，改走個別直傳`, "warning");
      }
    }

    // 🪪 情況 B：【🪪 單面名片 (批次獨立)】
    if (chosenCat === "CARDS_SINGLE") {
      showToast(`🪪 開始將 ${files.length} 張名片作為獨立名片直傳至 BusinessCards/ 箱...`, "info");
      const now = new Date();
      const pad = (n) => String(n).padStart(2, "0");

      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        const ext = f.name.split('.').pop() || "jpg";
        const ymd = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}_${i + 1}`;
        const singleName = `card_${ymd}.${ext}`;
        const renamedFile = new File([f], singleName, { type: f.type });

        await executeDirectCategorizedUpload(renamedFile, userNotes, "BUSINESS_CARDS");
      }
      return;
    }

    // 3. 其餘批次檔案
    const finalCat = (chosenCat === "BUSINESS_CARDS") ? "BUSINESS_CARDS" : chosenCat;
    showToast(`⚡ 開始將 ${files.length} 個檔案直傳至 ${finalCat} 箱...`, "info");
    for (let i = 0; i < files.length; i++) {
      await executeDirectCategorizedUpload(files[i], userNotes, finalCat);
    }
  }

  // 🌐 全域安全掛載 handleFileUpload 與 handleFilesBatch
  window.handleFileUpload = handleFileUpload;
  window.handleFilesBatch = handleFilesBatch;
}

// 🌐 全域安全掛載模組初始化函式
window.initIngestionModule = initIngestionModule;
