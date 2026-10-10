// Safari Video Downloader - Content Script Bridge
// Scans DOM hyperlinks and video elements, injects main-world interceptor, and routes messages

(() => {
  const VIDEO_EXTENSIONS = ["mp4", "m3u8", "webm", "m4v", "mov", "mkv", "flv", "ts"];
  const VIDEO_EXT_REGEX = new RegExp(`\\.(${VIDEO_EXTENSIONS.join("|")})(\\?|#|$)`, "i");

  // Inject main-world interceptor script
  function injectMainWorldInterceptor() {
    try {
      const script = document.createElement("script");
      script.src = chrome.runtime.getURL("content/main-world-interceptor.js");
      script.onload = function () {
        this.remove();
      };
      (document.head || document.documentElement).appendChild(script);
    } catch (e) {
      console.debug("Could not inject main-world interceptor:", e);
    }
  }

  injectMainWorldInterceptor();

  // Listen for messages from the main-world interceptor
  // Clean raw link text (e.g. "• Lezione del 02/10/2026 of ...")
  function cleanLectureLinkText(rawText) {
    if (!rawText) return "";
    let text = rawText.replace(/^[•\s\-\*]+/, "").trim();
    // Prioritize "Lezione del DD/MM/YYYY" or "Videolezione DD"
    const match = text.match(/(?:Videolezione|Lezione)\s*(?:del\s*)?[\d\/\-\.]+/i);
    if (match) {
      const fullCleaned = text.replace(/^[•\s\-\*]+/, "").replace(/\s+/g, " ").trim();
      return fullCleaned.length > 70 ? match[0] : fullCleaned;
    }
    return text.replace(/\s+/g, " ").slice(0, 100);
  }

  // Global click tracker on all <a> links
  document.addEventListener(
    "click",
    (e) => {
      const link = e.target.closest("a");
      if (!link) return;

      const rawText = link.innerText || link.textContent || "";
      const cleaned = cleanLectureLinkText(rawText);
      const href = link.getAttribute("href");

      if (cleaned) {
        window.__SVD_LAST_CLICKED_TITLE__ = cleaned;
        try {
          sessionStorage.setItem("__SVD_LAST_CLICKED_TITLE__", cleaned);
        } catch (_) {}

        const fullUrl = href ? new URL(href, location.href).href : "";
        chrome.runtime.sendMessage({
          action: "SET_LAST_CLICKED_LINK",
          title: cleaned,
          url: fullUrl
        });
      }
    },
    true
  );

  function isGenericTitle(t) {
    if (!t) return true;
    const lower = t.toLowerCase().trim();
    return (
      lower === "" ||
      lower === "video" ||
      lower === "video lecture" ||
      lower === "videolezione" ||
      lower === "dom video" ||
      lower === "dom source" ||
      lower === "safari tab" ||
      lower.includes("pagina del corso") ||
      lower.includes("portale della didattica")
    );
  }

  // Find the best lecture title from clicked link or page context
  function getBestLectureTitle() {
    // 1. Check in-memory clicked title or session storage
    if (window.__SVD_LAST_CLICKED_TITLE__) return window.__SVD_LAST_CLICKED_TITLE__;
    try {
      const stored = sessionStorage.getItem("__SVD_LAST_CLICKED_TITLE__");
      if (stored) return stored;
    } catch (_) {}

    // 2. Check for any link or heading on page with "Lezione del DD/MM/YYYY"
    const lecturePattern = /(?:Videolezione|Lezione)\s*(?:del\s*)?[\d\/\-\.]+/i;
    const links = document.querySelectorAll("a, h1, h2, h3, h4, h5, .titolo_lezione, .active");
    for (const el of links) {
      const txt = (el.innerText || el.textContent || "").trim();
      if (lecturePattern.test(txt)) {
        return cleanLectureLinkText(txt);
      }
    }

    return !isGenericTitle(document.title) ? document.title : "Video Lecture";
  }

  // Listen for messages from the main-world interceptor
  window.addEventListener("message", (event) => {
    if (event.source !== window || !event.data || event.data.type !== "__SAFARI_VID_FOUND__") {
      return;
    }

    const mediaData = event.data.data;
    if (mediaData && mediaData.url) {
      const title =
        mediaData.title && !isGenericTitle(mediaData.title)
          ? mediaData.title
          : getBestLectureTitle();

      chrome.runtime.sendMessage({
        action: "ADD_MEDIA",
        item: {
          url: mediaData.url,
          title: title,
          mime: mediaData.mime,
          size: mediaData.size,
          source: mediaData.source
        }
      });
    }
  });

  // Extract a readable title for a media link or video element
  function extractTitle(element, defaultTitle = "") {
    if (!element) return getBestLectureTitle();

    // 1. Check title or aria-label attributes
    const attrTitle = element.getAttribute("title") || element.getAttribute("aria-label");
    if (attrTitle && attrTitle.trim() && !isGenericTitle(attrTitle)) {
      return cleanLectureLinkText(attrTitle.trim());
    }

    // 2. Check innerText
    const text = element.innerText || element.textContent;
    if (text && text.trim() && text.trim().length > 2 && text.trim().length < 100 && !isGenericTitle(text)) {
      return cleanLectureLinkText(text.trim());
    }

    // 3. Check nearest heading or table row or list item context
    const row = element.closest("tr, li, .lecture, .video-card, .video-container");
    if (row) {
      const heading = row.querySelector("h1, h2, h3, h4, h5, strong, .title, .nome_lezione, a");
      if (heading && heading.textContent.trim()) {
        const cleaned = cleanLectureLinkText(heading.textContent.trim());
        if (!isGenericTitle(cleaned)) return cleaned;
      }
    }

    // 4. Fallback to best lecture title
    return getBestLectureTitle();
  }

  // Scan all <a> hyperlinks for video URLs
  function scanHyperlinks() {
    const links = document.querySelectorAll("a[href]");
    const found = [];

    links.forEach((link) => {
      const href = link.getAttribute("href");
      if (!href || href.startsWith("javascript:") || href.startsWith("#")) return;

      try {
        const fullUrl = new URL(href, location.href).href;
        if (VIDEO_EXT_REGEX.test(fullUrl)) {
          const title = extractTitle(link, link.innerText);
          found.push({
            url: fullUrl,
            title: title,
            source: "hyperlink"
          });
        }
      } catch (_) {}
    });

    return found;
  }

  // Scan all <video> and <source> elements
  function scanMediaElements() {
    const found = [];

    // Scan <video> tags
    const videos = document.querySelectorAll("video");
    videos.forEach((video) => {
      const src = video.currentSrc || video.src || video.getAttribute("src");
      if (src && !src.startsWith("blob:")) {
        try {
          const fullUrl = new URL(src, location.href).href;
          found.push({
            url: fullUrl,
            title: extractTitle(video, getBestLectureTitle()),
            source: "dom_video"
          });
        } catch (_) {}
      }

      // Check child <source> tags
      video.querySelectorAll("source[src]").forEach((source) => {
        const sourceSrc = source.getAttribute("src");
        if (sourceSrc && !sourceSrc.startsWith("blob:")) {
          try {
            const fullUrl = new URL(sourceSrc, location.href).href;
            found.push({
              url: fullUrl,
              title: extractTitle(video, getBestLectureTitle()),
              mime: source.getAttribute("type") || "video/mp4",
              source: "dom_source"
            });
          } catch (_) {}
        }
      });
    });

    return found;
  }

  // Full DOM scan
  function scanPage() {
    const hyperlinks = scanHyperlinks();
    const media = scanMediaElements();
    const all = [...hyperlinks, ...media];

    if (all.length > 0) {
      chrome.runtime.sendMessage({
        action: "ADD_BATCH_MEDIA",
        items: all
      });
    }

    return all;
  }

  // Perform initial scan when DOM is ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", scanPage);
  } else {
    scanPage();
  }

  // Re-scan when new DOM nodes are added
  let scanTimeout = null;
  const observer = new MutationObserver(() => {
    if (scanTimeout) clearTimeout(scanTimeout);
    scanTimeout = setTimeout(scanPage, 1000);
  });

  if (document.body) {
    observer.observe(document.body, { childList: true, subtree: true });
  } else {
    document.addEventListener("DOMContentLoaded", () => {
      observer.observe(document.body, { childList: true, subtree: true });
    });
  }

  // StreamDownloadManager: chunked streaming download with progress, pause/resume, and zero video player playback
  class StreamDownloadManager {
    constructor() {
      this.downloads = new Map(); // id -> downloadObj & url -> downloadObj
    }

    findDownload(idOrUrl) {
      if (!idOrUrl) return null;
      if (this.downloads.has(idOrUrl)) return this.downloads.get(idOrUrl);
      for (const dl of this.downloads.values()) {
        if (dl.url === idOrUrl || dl.id === idOrUrl) return dl;
      }
      return null;
    }

    formatBytes(bytes) {
      if (!bytes || bytes === 0) return "0 B";
      const k = 1024;
      const sizes = ["B", "KB", "MB", "GB"];
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
    }

    formatSpeed(bytesPerSec) {
      if (!bytesPerSec || bytesPerSec <= 0) return "";
      return this.formatBytes(bytesPerSec) + "/s";
    }

    notify(dl) {
      const payload = {
        id: dl.id,
        url: dl.url,
        filename: dl.filename,
        percent: dl.percent,
        receivedBytes: dl.receivedBytes,
        totalBytes: dl.totalBytes,
        speed: dl.speed,
        status: dl.status,
        error: dl.error
      };

      // 1. Notify background service worker (and open popup)
      try {
        chrome.runtime.sendMessage({
          action: "DOWNLOAD_PROGRESS",
          data: payload
        });
      } catch (_) {}

      // 2. Update in-page floating progress toolbar
      this.updatePageToolbar(dl);
    }

    // In-page sleek floating download toolbar
    updatePageToolbar(dl) {
      let toolbar = document.getElementById("svd-page-dl-toolbar");
      if (!toolbar) {
        toolbar = document.createElement("div");
        toolbar.id = "svd-page-dl-toolbar";
        toolbar.className = "svd-page-dl-toolbar";
        (document.body || document.documentElement).appendChild(toolbar);
      }

      // Check if all downloads finished / cancelled
      const activeOrPaused = Array.from(this.downloads.values()).find(
        (d) => d.status === "downloading" || d.status === "paused"
      );

      if (!activeOrPaused && dl.status === "completed") {
        setTimeout(() => {
          if (!Array.from(this.downloads.values()).some((d) => d.status === "downloading" || d.status === "paused")) {
            toolbar.remove();
          }
        }, 6000);
      } else if (!activeOrPaused && (dl.status === "cancelled" || dl.status === "idle")) {
        toolbar.remove();
        return;
      }

      const receivedFormatted = this.formatBytes(dl.receivedBytes);
      const totalFormatted = dl.totalBytes > 0 ? this.formatBytes(dl.totalBytes) : "Unknown size";
      const percentStr = dl.totalBytes > 0 ? `${dl.percent}%` : "";
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

      toolbar.innerHTML = `
        <div class="svd-toolbar-header">
          <div class="svd-toolbar-title-wrap">
            <span class="svd-toolbar-icon">⬇️</span>
            <span class="svd-toolbar-title" title="${dl.filename}">${dl.filename}</span>
          </div>
          <div class="svd-toolbar-meta">
            <span class="svd-status-pill ${statusClass}">${statusBadge}</span>
            <span class="svd-percent-txt">${percentStr}</span>
          </div>
        </div>
        <div class="svd-progress-track">
          <div class="svd-progress-fill ${statusClass}" style="width: ${dl.percent}%"></div>
        </div>
        <div class="svd-toolbar-footer">
          <span class="svd-toolbar-metrics">
            ${receivedFormatted} / ${totalFormatted} ${dl.speed ? `&bull; ${dl.speed}` : ""}
          </span>
          <div class="svd-toolbar-controls">
            ${
              !isCompleted && !isError
                ? isPaused
                  ? `<button class="svd-ctrl-btn resume-btn" id="svd-page-resume" title="Resume Download">
                      ▶ Resume
                     </button>`
                  : `<button class="svd-ctrl-btn pause-btn" id="svd-page-pause" title="Pause Download">
                      ⏸ Pause
                     </button>`
                : ""
            }
            ${
              !isCompleted
                ? `<button class="svd-ctrl-btn cancel-btn" id="svd-page-cancel" title="Cancel Download">
                    ✕ Cancel
                   </button>`
                : `<button class="svd-ctrl-btn dismiss-btn" id="svd-page-dismiss">Dismiss</button>`
            }
          </div>
        </div>
      `;

      // Event listeners for page toolbar
      const pauseBtn = toolbar.querySelector("#svd-page-pause");
      if (pauseBtn) {
        pauseBtn.addEventListener("click", () => this.pause(dl.id));
      }

      const resumeBtn = toolbar.querySelector("#svd-page-resume");
      if (resumeBtn) {
        resumeBtn.addEventListener("click", () => this.resume(dl.id));
      }

      const cancelBtn = toolbar.querySelector("#svd-page-cancel");
      if (cancelBtn) {
        cancelBtn.addEventListener("click", () => this.cancel(dl.id));
      }

      const dismissBtn = toolbar.querySelector("#svd-page-dismiss");
      if (dismissBtn) {
        dismissBtn.addEventListener("click", () => toolbar.remove());
      }
    }

    async start(url, filename, customId) {
      let dl = this.findDownload(url);
      if (dl) {
        if (dl.status === "paused") {
          return this.resume(dl.id);
        }
        if (dl.status === "downloading") {
          return dl;
        }
      }

      const id = customId || `dl_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      dl = {
        id,
        url,
        filename: filename || "video.mp4",
        status: "downloading",
        receivedBytes: 0,
        totalBytes: 0,
        percent: 0,
        speed: "Connecting...",
        chunks: [],
        abortController: new AbortController(),
        lastReportTime: Date.now(),
        lastReportBytes: 0,
        error: null
      };

      this.downloads.set(id, dl);
      this.downloads.set(url, dl);
      this.executeStream(dl);
      return dl;
    }

    async executeStream(dl) {
      dl.status = "downloading";
      dl.error = null;
      dl.abortController = new AbortController();
      this.notify(dl);

      try {
        const headers = {};
        if (dl.receivedBytes > 0) {
          headers["Range"] = `bytes=${dl.receivedBytes}-`;
        }

        const response = await fetch(dl.url, {
          headers,
          credentials: "include",
          signal: dl.abortController.signal
        });

        if (!response.ok && response.status !== 206) {
          throw new Error(`Server returned HTTP ${response.status} ${response.statusText}`);
        }

        // If resuming but server sent HTTP 200 (Range not supported), reset to byte 0
        if (dl.receivedBytes > 0 && response.status === 200) {
          console.warn("[SVD] Server does not support Range requests. Restarting download from byte 0.");
          dl.chunks = [];
          dl.receivedBytes = 0;
        }

        // Determine total size
        const contentRange = response.headers.get("content-range");
        const contentLength = response.headers.get("content-length");
        if (contentRange) {
          const match = contentRange.match(/\/(\d+)/);
          if (match) {
            dl.totalBytes = parseInt(match[1], 10);
          }
        } else if (contentLength) {
          dl.totalBytes = dl.receivedBytes + parseInt(contentLength, 10);
        }

        const reader = response.body.getReader();
        dl.lastReportTime = Date.now();
        dl.lastReportBytes = dl.receivedBytes;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          dl.chunks.push(value);
          dl.receivedBytes += value.length;

          if (dl.totalBytes > 0) {
            dl.percent = Math.min(99, Math.round((dl.receivedBytes / dl.totalBytes) * 100));
          } else {
            dl.percent = 0;
          }

          const now = Date.now();
          const timeDiff = now - dl.lastReportTime;
          if (timeDiff >= 200) {
            const bytesDiff = dl.receivedBytes - dl.lastReportBytes;
            const bytesPerSec = (bytesDiff / timeDiff) * 1000;
            dl.speed = this.formatSpeed(bytesPerSec);
            dl.lastReportTime = now;
            dl.lastReportBytes = dl.receivedBytes;
            this.notify(dl);
          }
        }

        // Completed
        dl.percent = 100;
        dl.status = "completed";
        dl.speed = "";
        this.notify(dl);

        // Convert chunks to Blob and trigger direct browser save without navigating or playing video!
        const mime = response.headers.get("content-type") || "video/mp4";
        const blob = new Blob(dl.chunks, { type: mime });
        const blobUrl = URL.createObjectURL(blob);

        const a = document.createElement("a");
        a.href = blobUrl;
        a.download = dl.filename;
        a.style.display = "none";
        (document.body || document.documentElement).appendChild(a);
        a.click();

        setTimeout(() => {
          a.remove();
          URL.revokeObjectURL(blobUrl);
          // Free chunks from memory once saved to disk
          dl.chunks = [];
        }, 30000);

      } catch (err) {
        if (err.name === "AbortError" || dl.status === "paused" || dl.status === "cancelled") {
          return;
        }

        console.error("[SVD] Download stream error:", err);
        dl.status = "error";
        dl.error = err.message || "Download failed";
        dl.speed = "";
        this.notify(dl);
      }
    }

    pause(idOrUrl) {
      const dl = this.findDownload(idOrUrl);
      if (dl && dl.status === "downloading") {
        dl.status = "paused";
        dl.speed = "Paused";
        if (dl.abortController) {
          dl.abortController.abort();
        }
        this.notify(dl);
      }
    }

    resume(idOrUrl) {
      const dl = this.findDownload(idOrUrl);
      if (dl && (dl.status === "paused" || dl.status === "error")) {
        dl.status = "downloading";
        dl.speed = "Resuming...";
        dl.error = null;
        this.executeStream(dl);
      }
    }

    cancel(idOrUrl) {
      const dl = this.findDownload(idOrUrl);
      if (dl) {
        dl.status = "cancelled";
        dl.speed = "";
        if (dl.abortController) {
          dl.abortController.abort();
        }
        dl.chunks = [];
        dl.receivedBytes = 0;
        this.notify(dl);
        this.downloads.delete(dl.id);
        this.downloads.delete(dl.url);
      }
    }

    getAllStates() {
      const states = [];
      const seen = new Set();
      for (const dl of this.downloads.values()) {
        if (!seen.has(dl.id)) {
          seen.add(dl.id);
          states.push({
            id: dl.id,
            url: dl.url,
            filename: dl.filename,
            percent: dl.percent,
            receivedBytes: dl.receivedBytes,
            totalBytes: dl.totalBytes,
            speed: dl.speed,
            status: dl.status,
            error: dl.error
          });
        }
      }
      return states;
    }
  }

  const downloadManager = new StreamDownloadManager();

  // Message listener from background/popup
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "TRIGGER_SCAN") {
      const items = scanPage();
      sendResponse({ success: true, count: items.length, items });
      return true;
    }

    if (message.action === "START_DOWNLOAD" || message.action === "TRIGGER_DOWNLOAD") {
      downloadManager.start(message.url, message.filename, message.downloadId);
      sendResponse({ success: true });
      return true;
    }

    if (message.action === "PAUSE_DOWNLOAD") {
      downloadManager.pause(message.downloadId || message.url);
      sendResponse({ success: true });
      return true;
    }

    if (message.action === "RESUME_DOWNLOAD") {
      downloadManager.resume(message.downloadId || message.url);
      sendResponse({ success: true });
      return true;
    }

    if (message.action === "CANCEL_DOWNLOAD") {
      downloadManager.cancel(message.downloadId || message.url);
      sendResponse({ success: true });
      return true;
    }

    if (message.action === "GET_PAGE_DOWNLOADS") {
      sendResponse({ success: true, downloads: downloadManager.getAllStates() });
      return true;
    }
  });

  // Export helper for specialized adapters
  window.__SAFARI_VID_DOWNLOAD_IN_PAGE__ = (url, filename) => {
    return downloadManager.start(url, filename);
  };
})();
