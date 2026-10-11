// Safari Video Downloader - Popup Script

document.addEventListener("DOMContentLoaded", async () => {
  const tabHostEl = document.getElementById("tab-host");
  const mediaCountEl = document.getElementById("media-count");
  const batchBarEl = document.getElementById("batch-bar");
  const emptyStateEl = document.getElementById("empty-state");
  const mediaListEl = document.getElementById("media-list");
  const rescanBtn = document.getElementById("rescan-btn");
  const emptyScanBtn = document.getElementById("empty-scan-btn");
  const downloadAllBtn = document.getElementById("download-all-btn");
  const copyAllBtn = document.getElementById("copy-all-btn");

  let activeTab = null;
  let currentItems = [];
  // Active download state map: url -> downloadState
  const downloadStates = new Map();

  // 1. Get current active tab
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    activeTab = tabs && tabs[0];
    if (activeTab && activeTab.url) {
      try {
        tabHostEl.textContent = new URL(activeTab.url).hostname;
      } catch (_) {
        tabHostEl.textContent = activeTab.title || "Safari Tab";
      }
    }
  } catch (err) {
    console.error("Failed to query active tab:", err);
  }

  // Format bytes to human readable string
  function formatBytes(bytes) {
    if (!bytes || bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
  }

  // Sanitize filename preserving readable dates (e.g. 09/10/2026 -> 09-10-2026)
  function sanitizeName(name) {
    if (!name) return "video";
    return name
      .replace(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/g, "$1-$2-$3") // Clean date slashes to dashes
      .replace(/[<>:"/\\|?*\x00-\x1F]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120);
  }

  // 2. Fetch active downloads and detected media items
  function loadMedia() {
    if (!activeTab || !activeTab.id) return;

    // First retrieve active download states
    chrome.runtime.sendMessage({ action: "GET_DOWNLOAD_STATES" }, (res) => {
      if (res && res.downloads) {
        res.downloads.forEach((dl) => {
          if (dl.url) downloadStates.set(dl.url, dl);
        });
      }

      // Then retrieve media items for the active tab
      chrome.runtime.sendMessage({ action: "GET_MEDIA", tabId: activeTab.id }, (response) => {
        const items = (response && response.items) || [];
        currentItems = items;
        renderItems(items);
      });
    });
  }

  // 3. Update single card toolbar in-place
  function updateCardToolbar(url) {
    const dl = downloadStates.get(url);
    const card = document.querySelector(`.media-item[data-url="${CSS.escape(url)}"]`);
    if (!card) return;

    const toolbarContainer = card.querySelector(".card-dl-container");
    const downloadBtn = card.querySelector(".download-btn");

    if (!dl || dl.status === "cancelled") {
      if (toolbarContainer) toolbarContainer.innerHTML = "";
      if (downloadBtn) {
        downloadBtn.classList.remove("hidden");
        downloadBtn.disabled = false;
        downloadBtn.innerHTML = `
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
            <polyline points="7 10 12 15 17 10"></polyline>
            <line x1="12" y1="15" x2="12" y2="3"></line>
          </svg>
          <span>Download</span>
        `;
      }
      return;
    }

    // Hide or update download button while active
    if (downloadBtn) {
      if (dl.status === "completed") {
        downloadBtn.classList.remove("hidden");
        downloadBtn.disabled = false;
        downloadBtn.innerHTML = `<span>Download Again</span>`;
      } else {
        downloadBtn.classList.add("hidden");
      }
    }

    if (!toolbarContainer) return;

    const isPaused = dl.status === "paused";
    const isCompleted = dl.status === "completed";
    const isError = dl.status === "error";

    let statusBadge = "Downloading...";
    let statusClass = "downloading";
    if (isPaused) {
      statusBadge = "Paused";
      statusClass = "paused";
    } else if (isCompleted) {
      statusBadge = "✓ Complete";
      statusClass = "completed";
    } else if (isError) {
      statusBadge = "Error";
      statusClass = "error";
    }

    const receivedFormatted = formatBytes(dl.receivedBytes);
    const totalFormatted = dl.totalBytes > 0 ? formatBytes(dl.totalBytes) : "calculating...";
    const percentStr = dl.totalBytes > 0 ? `${dl.percent}%` : "";

    let toolbar = toolbarContainer.querySelector(".card-dl-toolbar");
    if (!toolbar) {
      toolbar = document.createElement("div");
      toolbar.className = "card-dl-toolbar";
      toolbar.innerHTML = `
        <div class="card-dl-top">
          <span class="card-dl-status"></span>
          <span class="card-dl-percent"></span>
        </div>
        <div class="card-dl-track">
          <div class="card-dl-fill"></div>
        </div>
        <div class="card-dl-bottom">
          <span class="card-dl-metrics"></span>
          <div class="card-dl-controls"></div>
        </div>
      `;
      toolbarContainer.appendChild(toolbar);
    }

    const statusEl = toolbar.querySelector(".card-dl-status");
    const percentEl = toolbar.querySelector(".card-dl-percent");
    const fillEl = toolbar.querySelector(".card-dl-fill");
    const metricsEl = toolbar.querySelector(".card-dl-metrics");
    const controlsEl = toolbar.querySelector(".card-dl-controls");

    statusEl.className = `card-dl-status ${statusClass}`;
    statusEl.textContent = statusBadge;
    percentEl.textContent = percentStr;

    fillEl.className = `card-dl-fill ${statusClass}`;
    fillEl.style.width = `${dl.percent}%`;

    metricsEl.textContent = `${receivedFormatted} / ${totalFormatted}${dl.speed ? ` • ${dl.speed}` : ""}`;

    // Only update buttons when status changes to avoid tearing listeners
    const currentControlStatus = controlsEl.dataset.status;
    if (currentControlStatus !== dl.status) {
      controlsEl.dataset.status = dl.status;
      controlsEl.innerHTML = "";

      if (!isCompleted && !isError) {
        const actionBtn = document.createElement("button");
        actionBtn.className = isPaused ? "card-tool-btn resume" : "card-tool-btn pause";
        actionBtn.textContent = isPaused ? "▶ Resume" : "⏸ Pause";
        actionBtn.onclick = () => (isPaused ? resumeDownload(url) : pauseDownload(url));
        controlsEl.appendChild(actionBtn);
      }

      if (!isCompleted) {
        const cancelBtn = document.createElement("button");
        cancelBtn.className = "card-tool-btn cancel";
        cancelBtn.textContent = "✕ Cancel";
        cancelBtn.onclick = () => cancelDownload(url);
        controlsEl.appendChild(cancelBtn);
      } else {
        // Direct Save Video Button (explicit Safari user gesture to save into ~/Downloads/)
        const saveBtn = document.createElement("button");
        saveBtn.className = "card-tool-btn save";
        saveBtn.innerHTML = `<span>💾 Save Video</span>`;
        saveBtn.title = "Save video directly to your Downloads folder";
        saveBtn.onclick = () => {
          if (dl.blobUrl) {
            const a = document.createElement("a");
            a.href = dl.blobUrl;
            a.download = dl.filename || "video.mp4";
            document.body.appendChild(a);
            a.click();
            setTimeout(() => a.remove(), 2000);
            saveBtn.innerHTML = `<span>✓ Saved!</span>`;
          } else {
            // Trigger direct save via tab or fallback URL
            chrome.tabs.sendMessage(activeTab.id, {
              action: "TRIGGER_FILE_SAVE",
              filename: dl.filename || "video.mp4",
              url: dl.url
            }).catch(() => {
              const a = document.createElement("a");
              a.href = dl.url;
              a.download = dl.filename || "video.mp4";
              a.target = "_blank";
              document.body.appendChild(a);
              a.click();
              setTimeout(() => a.remove(), 2000);
            });
            saveBtn.innerHTML = `<span>✓ Saved!</span>`;
          }
        };
        controlsEl.appendChild(saveBtn);

        const dismissBtn = document.createElement("button");
        dismissBtn.className = "card-tool-btn dismiss";
        dismissBtn.textContent = "Dismiss";
        dismissBtn.onclick = () => {
          downloadStates.delete(url);
          updateCardToolbar(url);
        };
        controlsEl.appendChild(dismissBtn);
      }
    }
  }

  // 4. Render items into DOM
  function renderItems(items) {
    mediaListEl.innerHTML = "";

    if (!items || items.length === 0) {
      emptyStateEl.classList.remove("hidden");
      batchBarEl.classList.add("hidden");
      mediaListEl.classList.add("hidden");
      return;
    }

    emptyStateEl.classList.add("hidden");
    batchBarEl.classList.remove("hidden");
    mediaListEl.classList.remove("hidden");
    mediaCountEl.textContent = items.length;

    items.forEach((item, index) => {
      const card = document.createElement("div");
      card.className = "media-item";
      card.dataset.url = item.url;

      const isYouTube = item.source === "youtube" || !!item.videoId;
      const ext = (item.ext || "mp4").toLowerCase();
      const badgeClass = isYouTube ? "yt" : ext === "m3u8" ? "m3u8" : ext === "webm" ? "webm" : "mp4";
      const badgeLabel = isYouTube ? "YouTube" : ext === "m3u8" ? "HLS" : ext.toUpperCase();

      const sizeStr = item.size ? formatBytes(item.size) : ext === "m3u8" ? "HLS Stream" : isYouTube ? "HD Video & Audio" : "";
      const sourceLabel = item.source ? item.source.replace("_", " ") : "detected";
      const authorStr = item.author ? `&bull; ${item.author}` : "";

      let actionsHtml = "";
      if (isYouTube) {
        actionsHtml = `
          <button class="action-btn secondary copy-btn" data-url="${item.url}">
            <span>Copy</span>
          </button>
          <button class="action-btn yt-audio yt-dl-btn" data-quality="mp3" data-video-id="${item.videoId}" data-title="${encodeURIComponent(item.title)}">
            <span>MP3</span>
          </button>
          <button class="action-btn secondary yt-dl-btn" data-quality="720" data-video-id="${item.videoId}" data-title="${encodeURIComponent(item.title)}">
            <span>720p</span>
          </button>
          <button class="action-btn yt-hd yt-dl-btn" data-quality="1080" data-video-id="${item.videoId}" data-title="${encodeURIComponent(item.title)}">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
              <polyline points="7 10 12 15 17 10"></polyline>
              <line x1="12" y1="15" x2="12" y2="3"></line>
            </svg>
            <span>1080p HD</span>
          </button>
        `;
      } else {
        actionsHtml = `
          <button class="action-btn secondary copy-btn" data-url="${item.url}">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
            </svg>
            <span>Copy</span>
          </button>
          ${
            ext !== "m3u8"
              ? `<button class="action-btn secondary preview-btn" data-index="${index}" data-url="${item.url}">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="12" cy="12" r="10"></circle>
                    <polygon points="10 8 16 12 10 16 10 8"></polygon>
                  </svg>
                  <span>Preview</span>
                </button>`
              : ""
          }
          <button class="action-btn download download-btn" data-index="${index}">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
              <polyline points="7 10 12 15 17 10"></polyline>
              <line x1="12" y1="15" x2="12" y2="3"></line>
            </svg>
            <span>Download</span>
          </button>
        `;
      }

      card.innerHTML = `
        <div class="item-main">
          <span class="format-badge ${badgeClass}">${badgeLabel}</span>
          ${isYouTube && item.thumbnail ? `<img src="${item.thumbnail}" alt="Thumbnail" class="item-thumbnail">` : ""}
          <div class="item-details">
            <h3 class="item-title" title="${item.title || "Video"}">${item.title || "Video"}</h3>
            <div class="item-meta">
              ${sizeStr ? `<span>${sizeStr}</span>` : ""}
              <span class="meta-source">${sourceLabel}</span>
              ${authorStr ? `<span>${authorStr}</span>` : ""}
            </div>
          </div>
        </div>
        <div class="preview-box hidden" id="preview-${index}"></div>
        <div class="card-dl-container" id="dl-container-${index}"></div>
        <div class="item-actions">
          ${actionsHtml}
        </div>
      `;

      // Copy Button
      const copyBtn = card.querySelector(".copy-btn");
      copyBtn.addEventListener("click", () => {
        navigator.clipboard.writeText(item.url).then(() => {
          copyBtn.querySelector("span").textContent = "Copied!";
          setTimeout(() => {
            copyBtn.querySelector("span").textContent = "Copy";
          }, 2000);
        });
      });

      // Preview Button: ONLY place where video playback is rendered!
      const previewBtn = card.querySelector(".preview-btn");
      if (previewBtn) {
        previewBtn.addEventListener("click", () => {
          const previewContainer = card.querySelector(`#preview-${index}`);
          if (previewContainer.classList.contains("hidden")) {
            previewContainer.classList.remove("hidden");
            previewContainer.innerHTML = `
              <div class="preview-container">
                <video src="${item.url}" controls autoplay muted playsinline></video>
              </div>
            `;
            previewBtn.querySelector("span").textContent = "Close";
          } else {
            previewContainer.classList.add("hidden");
            previewContainer.innerHTML = "";
            previewBtn.querySelector("span").textContent = "Preview";
          }
        });
      }

      // Rename Title on Click
      const titleEl = card.querySelector(".item-title");
      titleEl.style.cursor = "pointer";
      titleEl.title = "Click to rename this video";
      titleEl.addEventListener("click", () => {
        const newTitle = prompt("Rename video lecture:", item.title || "Video Lecture");
        if (newTitle && newTitle.trim()) {
          item.title = newTitle.trim();
          titleEl.textContent = item.title;
          chrome.runtime.sendMessage({
            action: "UPDATE_MEDIA_TITLE",
            tabId: activeTab.id,
            url: item.url,
            title: item.title
          });
        }
      });

      // YouTube Download Buttons
      card.querySelectorAll(".yt-dl-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
          const quality = btn.dataset.quality;
          const vId = btn.dataset.videoId;
          const vTitle = decodeURIComponent(btn.dataset.title);

          btn.disabled = true;
          const origHtml = btn.innerHTML;
          btn.textContent = "Loading...";

          chrome.runtime.sendMessage({
            action: "DOWNLOAD_YOUTUBE_MEDIA",
            videoId: vId,
            quality: quality,
            title: vTitle,
            url: item.url
          });

          setTimeout(() => {
            btn.disabled = false;
            btn.innerHTML = origHtml;
          }, 3500);
        });
      });

      // Download Button (for standard media)
      const downloadBtn = card.querySelector(".download-btn");
      if (downloadBtn) {
        downloadBtn.addEventListener("click", () => {
          triggerDownload(item);
        });
      }

      mediaListEl.appendChild(card);

      // If active download already exists for this URL, render progress toolbar
      if (downloadStates.has(item.url)) {
        updateCardToolbar(item.url);
      }
    });
  }

  // 5. Trigger download
  function triggerDownload(item) {
    const ext = (item.ext || "mp4").toLowerCase();
    const filename = `${sanitizeName(item.title)}.${ext === "m3u8" ? "mp4" : ext}`;

    if (ext === "m3u8") {
      // Open dedicated HLS segment downloader tab
      chrome.runtime.sendMessage({
        action: "OPEN_HLS_DOWNLOADER",
        url: item.url,
        title: item.title
      });
    } else {
      // Initialize active download state in popup immediately
      const dlState = {
        url: item.url,
        filename: filename,
        status: "downloading",
        percent: 0,
        receivedBytes: 0,
        totalBytes: item.size || 0,
        speed: "Starting..."
      };
      downloadStates.set(item.url, dlState);
      updateCardToolbar(item.url);

      // Instruct content script via background to execute chunked download
      chrome.runtime.sendMessage({
        action: "START_DOWNLOAD",
        tabId: activeTab.id,
        url: item.url,
        filename: filename
      });
    }
  }

  // 6. Pause, Resume, Cancel actions
  function pauseDownload(url) {
    const dl = downloadStates.get(url);
    if (dl) {
      dl.status = "paused";
      dl.speed = "Paused";
      updateCardToolbar(url);
      chrome.runtime.sendMessage({
        action: "PAUSE_DOWNLOAD",
        tabId: activeTab.id,
        url: url,
        downloadId: dl.id
      });
    }
  }

  function resumeDownload(url) {
    const dl = downloadStates.get(url);
    if (dl) {
      dl.status = "downloading";
      dl.speed = "Resuming...";
      updateCardToolbar(url);
      chrome.runtime.sendMessage({
        action: "RESUME_DOWNLOAD",
        tabId: activeTab.id,
        url: url,
        downloadId: dl.id
      });
    }
  }

  function cancelDownload(url) {
    const dl = downloadStates.get(url);
    chrome.runtime.sendMessage({
      action: "CANCEL_DOWNLOAD",
      tabId: activeTab.id,
      url: url,
      downloadId: dl ? dl.id : undefined
    });
    downloadStates.delete(url);
    updateCardToolbar(url);
  }

  // 7. Listen for real-time progress broadcasts from download manager
  chrome.runtime.onMessage.addListener((message) => {
    if (message.action === "DOWNLOAD_PROGRESS" && message.data) {
      const d = message.data;
      if (d.url) {
        downloadStates.set(d.url, d);
        updateCardToolbar(d.url);
      }
    }

    if (message.action === "TRIGGER_BLOB_SAVE" && message.blobUrl) {
      const a = document.createElement("a");
      a.href = message.blobUrl;
      a.download = message.filename || "video.mp4";
      document.body.appendChild(a);
      a.click();
      setTimeout(() => a.remove(), 2000);
    }
  });

  // 8. Trigger deep page scan
  function triggerScan() {
    if (!activeTab || !activeTab.id) return;
    rescanBtn.classList.add("spinning");

    chrome.runtime.sendMessage({ action: "SCAN_PAGE", tabId: activeTab.id }, () => {
      setTimeout(() => {
        rescanBtn.classList.remove("spinning");
        loadMedia();
      }, 500);
    });
  }

  rescanBtn.addEventListener("click", triggerScan);
  emptyScanBtn.addEventListener("click", triggerScan);

  // Batch: Download all detected MP4s
  downloadAllBtn.addEventListener("click", () => {
    currentItems.forEach((item, i) => {
      setTimeout(() => {
        triggerDownload(item);
      }, i * 600);
    });
  });

  // Batch: Copy all URLs
  copyAllBtn.addEventListener("click", () => {
    const text = currentItems.map((item) => `${item.title}: ${item.url}`).join("\n");
    navigator.clipboard.writeText(text).then(() => {
      copyAllBtn.textContent = "Copied All!";
      setTimeout(() => {
        copyAllBtn.textContent = "Copy Links";
      }, 2000);
    });
  });

  // Initial load
  loadMedia();
});
