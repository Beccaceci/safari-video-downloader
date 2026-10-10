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
      const dataSrc = link.dataset.src || link.dataset.url || link.getAttribute("data-video");

      let candidateUrl = "";
      if (dataSrc) {
        try {
          candidateUrl = new URL(dataSrc, location.href).href;
        } catch (_) {}
      } else if (href && !href.startsWith("javascript:") && !href.startsWith("#")) {
        try {
          candidateUrl = new URL(href, location.href).href;
        } catch (_) {}
      }

      if (cleaned) {
        window.__SVD_LAST_CLICKED_TITLE__ = cleaned;
        try {
          sessionStorage.setItem("__SVD_LAST_CLICKED_TITLE__", cleaned);
        } catch (_) {}

        chrome.runtime.sendMessage({
          action: "SET_LAST_CLICKED_LINK",
          title: cleaned,
          url: candidateUrl
        });
      }

      // If the clicked link directly points to a video or lecture stream, immediately register it
      if (candidateUrl && (VIDEO_EXT_REGEX.test(candidateUrl) || candidateUrl.includes("video.polito.it"))) {
        chrome.runtime.sendMessage({
          action: "ADD_MEDIA",
          item: {
            url: candidateUrl,
            title: cleaned || extractTitle(link),
            source: "clicked_link"
          }
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

  // In-page floating download toolbar manager (driven by background progress events)
  class PageToolbarManager {
    constructor() {
      this.downloads = new Map();
    }

    formatBytes(bytes) {
      if (!bytes || bytes === 0) return "0 B";
      const k = 1024;
      const sizes = ["B", "KB", "MB", "GB"];
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
    }

    update(dl) {
      this.downloads.set(dl.id || dl.url, dl);

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
      const totalFormatted = dl.totalBytes > 0 ? this.formatBytes(dl.totalBytes) : "calculating...";
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
        pauseBtn.addEventListener("click", () => {
          chrome.runtime.sendMessage({
            action: "PAUSE_DOWNLOAD",
            downloadId: dl.id,
            url: dl.url
          });
        });
      }

      const resumeBtn = toolbar.querySelector("#svd-page-resume");
      if (resumeBtn) {
        resumeBtn.addEventListener("click", () => {
          chrome.runtime.sendMessage({
            action: "RESUME_DOWNLOAD",
            downloadId: dl.id,
            url: dl.url
          });
        });
      }

      const cancelBtn = toolbar.querySelector("#svd-page-cancel");
      if (cancelBtn) {
        cancelBtn.addEventListener("click", () => {
          chrome.runtime.sendMessage({
            action: "CANCEL_DOWNLOAD",
            downloadId: dl.id,
            url: dl.url
          });
          toolbar.remove();
        });
      }

      const dismissBtn = toolbar.querySelector("#svd-page-dismiss");
      if (dismissBtn) {
        dismissBtn.addEventListener("click", () => toolbar.remove());
      }
    }
  }

  const pageToolbar = new PageToolbarManager();

  // Message listener from background/popup
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "TRIGGER_SCAN") {
      const items = scanPage();
      sendResponse({ success: true, count: items.length, items });
      return true;
    }

    if (message.action === "DOWNLOAD_PROGRESS" && message.data) {
      pageToolbar.update(message.data);
      sendResponse({ success: true });
      return true;
    }

    if (message.action === "TRIGGER_BLOB_SAVE" && message.blobUrl) {
      const a = document.createElement("a");
      a.href = message.blobUrl;
      a.download = message.filename || "video.mp4";
      a.style.display = "none";
      (document.body || document.documentElement).appendChild(a);
      a.click();
      setTimeout(() => a.remove(), 2000);
      sendResponse({ success: true });
      return true;
    }

    if (message.action === "TRIGGER_FILE_SAVE" && message.url) {
      const a = document.createElement("a");
      a.href = message.url;
      a.download = message.filename || "video.mp4";
      a.style.display = "none";
      (document.body || document.documentElement).appendChild(a);
      a.click();
      setTimeout(() => a.remove(), 2000);
      sendResponse({ success: true });
      return true;
    }
  });

  // Export helper for specialized adapters
  window.__SAFARI_VID_DOWNLOAD_IN_PAGE__ = (url, filename) => {
    return chrome.runtime.sendMessage({
      action: "START_DOWNLOAD",
      url: url,
      filename: filename
    });
  };
})();
