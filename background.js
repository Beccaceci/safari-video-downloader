// Safari Video Downloader - Background Service Worker

// Map of tabId -> Map<url, MediaItem>
const mediaByTab = new Map();

// Helper to get or create media map for a tab
function getTabMediaMap(tabId) {
  if (!mediaByTab.has(tabId)) {
    mediaByTab.set(tabId, new Map());
  }
  return mediaByTab.get(tabId);
}

// Update the extension toolbar badge
function updateBadge(tabId) {
  try {
    const map = mediaByTab.get(tabId);
    const count = map ? map.size : 0;
    const text = count > 0 ? (count > 99 ? "99+" : String(count)) : "";
    chrome.action.setBadgeText({ tabId, text }, () => {
      if (chrome.runtime.lastError) {
        // Tab might have closed or not ready
      }
    });
    chrome.action.setBadgeBackgroundColor({ tabId, color: "#007AFF" }, () => {});
  } catch (e) {
    console.debug("Error updating badge:", e);
  }
}

// Extract clean file extension from URL
function detectExtension(url, mime = "") {
  if (!url) return "mp4";
  try {
    const cleanUrl = url.split("?")[0].split("#")[0].toLowerCase();
    const match = cleanUrl.match(/\.(mp4|m3u8|webm|m4v|mov|mkv|flv|ts|aac|mp3|ogg)(\b|$)/);
    if (match) return match[1];
  } catch (_) {}

  const lowerMime = (mime || "").toLowerCase();
  if (lowerMime.includes("mpegurl") || lowerMime.includes("m3u8")) return "m3u8";
  if (lowerMime.includes("mp4")) return "mp4";
  if (lowerMime.includes("webm")) return "webm";
  if (lowerMime.includes("quicktime")) return "mov";
  if (lowerMime.includes("dash")) return "mpd";

  return "mp4";
}

// Track the last clicked link title per tab
const tabLastClickedLink = new Map();
// Track domain per tab to avoid wiping list on intra-site navigations
const tabHosts = new Map();

// Helper to determine if a detected title is too generic
function isGenericTitle(title) {
  if (!title) return true;
  const lower = title.toLowerCase().trim();
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

// Normalize and deduplicate media entries
function addMediaItem(tabId, item) {
  if (!tabId || !item || !item.url) return;
  const map = getTabMediaMap(tabId);
  const ext = item.ext || detectExtension(item.url, item.mime);

  const key = item.url;
  const existing = map.get(key);

  // Check if title is generic and can be improved by last clicked link
  let finalTitle = item.title;
  const lastClicked = tabLastClickedLink.get(tabId);

  if (isGenericTitle(finalTitle)) {
    if (existing && !isGenericTitle(existing.title)) {
      finalTitle = existing.title;
    } else if (lastClicked && lastClicked.title && Date.now() - lastClicked.time < 300000) {
      finalTitle = lastClicked.title;
    }
  }

  // If already exists, delete so re-inserting appends it to the very bottom (most recent at bottom)
  if (existing) {
    map.delete(key);
  }

  const merged = {
    id: existing ? existing.id : `media_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    url: item.url,
    title: finalTitle || "Video Lecture",
    ext: ext,
    mime: item.mime || existing?.mime || (ext === "m3u8" ? "application/x-mpegURL" : "video/mp4"),
    size: item.size || existing?.size || 0,
    sizeFormatted: item.sizeFormatted || existing?.sizeFormatted || "",
    source: item.source || existing?.source || "detected",
    timestamp: Date.now()
  };

  map.set(key, merged);
  updateBadge(tabId);
  return merged;
}

function sanitizeFilename(name) {
  return (name || "video").replace(/[<>:"/\\|?*\x00-\x1F]/g, "_").trim().slice(0, 150);
}

// =========================================================================
// Background StreamDownloadManager
// Executes fetch() in the Service Worker with <all_urls> permissions
// Completely immune to page CORS or cross-origin restrictions!
// =========================================================================
class BackgroundStreamDownloadManager {
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
      blobUrl: dl.blobUrl || null,
      error: dl.error
    };

    // Broadcast progress to popup or any active extension page
    chrome.runtime.sendMessage({
      action: "DOWNLOAD_PROGRESS",
      data: payload
    }).catch(() => {});

    // Broadcast to the target tab so the in-page toolbar stays updated
    if (dl.tabId) {
      chrome.tabs.sendMessage(dl.tabId, {
        action: "DOWNLOAD_PROGRESS",
        data: payload
      }).catch(() => {});
    }
  }

  async start(url, filename, tabId, customId) {
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
      tabId: tabId || null,
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

      // Privileged fetch inside background service worker (no CORS block)
      const response = await fetch(dl.url, {
        headers,
        credentials: "include",
        signal: dl.abortController.signal
      });

      if (!response.ok && response.status !== 206) {
        throw new Error(`Server returned HTTP ${response.status} ${response.statusText}`);
      }

      // If resuming but server sent HTTP 200 (Range not supported), reset chunks
      if (dl.receivedBytes > 0 && response.status === 200) {
        console.warn("[SVD Background] Server does not support Range requests. Restarting download from byte 0.");
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

      // Assembling completed payload
      const mime = response.headers.get("content-type") || "video/mp4";
      if (typeof Blob !== "undefined" && typeof URL !== "undefined" && URL.createObjectURL) {
        const blob = new Blob(dl.chunks, { type: mime });
        dl.blobUrl = URL.createObjectURL(blob);
      }

      dl.percent = 100;
      dl.status = "completed";
      dl.speed = "";
      this.notify(dl);

      // Trigger file save directly
      await this.deliverCompletedFile(dl, mime);

    } catch (err) {
      if (err.name === "AbortError" || dl.status === "paused" || dl.status === "cancelled") {
        return;
      }

      console.error("[SVD Background] Download stream error:", err);
      dl.status = "error";
      dl.error = err.message || "Download failed";
      dl.speed = "";
      this.notify(dl);
    }
  }

  async deliverCompletedFile(dl, mime) {
    try {
      if (typeof Blob !== "undefined" && typeof URL !== "undefined" && URL.createObjectURL) {
        const blob = new Blob(dl.chunks, { type: mime });
        const blobUrl = URL.createObjectURL(blob);

        // 1. First broadcast to runtime (popup window) so it saves immediately if open
        chrome.runtime.sendMessage({
          action: "TRIGGER_BLOB_SAVE",
          blobUrl: blobUrl,
          filename: dl.filename
        }).catch(() => {});

        // 2. Also send to the tab in page context
        this.fallbackTabSave(dl, blobUrl);

        // 3. And attempt standard chrome.downloads API
        if (chrome.downloads && chrome.downloads.download) {
          chrome.downloads.download(
            {
              url: blobUrl,
              filename: dl.filename,
              saveAs: false
            },
            () => {
              if (chrome.runtime.lastError) {
                console.debug("[SVD Background] chrome.downloads notice:", chrome.runtime.lastError.message);
              }
            }
          );
        }
      } else if (dl.tabId) {
        // Fallback for environments without Blob in service worker
        chrome.tabs.sendMessage(dl.tabId, {
          action: "TRIGGER_FILE_SAVE",
          filename: dl.filename,
          url: dl.url
        }).catch(() => {});
      }
    } catch (e) {
      console.error("[SVD Background] Error delivering completed file:", e);
    }
  }

  fallbackTabSave(dl, blobUrl) {
    if (dl.tabId) {
      chrome.tabs.sendMessage(dl.tabId, {
        action: "TRIGGER_BLOB_SAVE",
        blobUrl: blobUrl,
        filename: dl.filename
      }).catch(() => {});
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

const backgroundDownloader = new BackgroundStreamDownloadManager();

// Context Menu Setup
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: "svd-download-link",
      title: "Download Video from Link",
      contexts: ["link"]
    });
    chrome.contextMenus.create({
      id: "svd-download-video",
      title: "Download Video on Page",
      contexts: ["video"]
    });
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab || !tab.id) return;

  if (info.menuItemId === "svd-download-link" && info.linkUrl) {
    const ext = detectExtension(info.linkUrl);
    const media = addMediaItem(tab.id, {
      url: info.linkUrl,
      title: tab.title || "Linked Video",
      ext: ext,
      source: "context_menu"
    });

    if (ext === "m3u8") {
      openHlsDownloader(media.url, media.title);
    } else {
      backgroundDownloader.start(
        media.url,
        `${sanitizeFilename(media.title)}.${ext}`,
        tab.id
      );
    }
  } else if (info.menuItemId === "svd-download-video" && info.srcUrl) {
    const ext = detectExtension(info.srcUrl);
    const media = addMediaItem(tab.id, {
      url: info.srcUrl,
      title: tab.title || "Page Video",
      ext: ext,
      source: "context_menu"
    });

    if (ext === "m3u8") {
      openHlsDownloader(media.url, media.title);
    } else {
      backgroundDownloader.start(
        media.url,
        `${sanitizeFilename(media.title)}.${ext}`,
        tab.id
      );
    }
  }
});

// Open dedicated HLS segment merger page
function openHlsDownloader(m3u8Url, title = "Video") {
  const url = chrome.runtime.getURL(
    `downloader/hls-downloader.html?url=${encodeURIComponent(m3u8Url)}&title=${encodeURIComponent(title)}`
  );
  chrome.tabs.create({ url });
}

// YouTube Download Handler
async function handleYouTubeDownload(tabId, videoId, quality = "1080", title = "YouTube Video", url = "") {
  const videoUrl = url || `https://www.youtube.com/watch?v=${videoId}`;
  const cleanTitle = sanitizeFilename(title);
  const isAudio = quality === "mp3";
  const ext = isAudio ? "mp3" : "mp4";
  const filename = `${cleanTitle}.${ext}`;

  // Check if we have a direct progressive URL stored for this tab
  const map = mediaByTab.get(tabId);
  const existing = map && (map.get(videoUrl) || Array.from(map.values()).find((m) => m.videoId === videoId));

  if (!isAudio && quality === "720" && existing && existing.directUrl720) {
    backgroundDownloader.start(existing.directUrl720, filename, tabId);
    return;
  }

  // Attempt resolving via Cobalt API instances
  const cobaltEndpoints = [
    "https://api.cobalt.tools/",
    "https://cobalt.api.kwiatekm.tokyo/",
    "https://cobalt-api.kellr.work/"
  ];

  let resolvedUrl = null;

  for (const endpoint of cobaltEndpoints) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          url: videoUrl,
          videoQuality: quality === "1080" ? "1080" : "720",
          downloadMode: isAudio ? "audio" : "auto",
          audioFormat: isAudio ? "mp3" : undefined
        })
      });

      if (response.ok) {
        const data = await response.json();
        if (data && (data.url || data.status === "tunnel" || data.status === "redirect")) {
          resolvedUrl = data.url;
          break;
        }
      }
    } catch (_) {}
  }

  if (resolvedUrl) {
    backgroundDownloader.start(resolvedUrl, filename, tabId);
  } else {
    // If API endpoint is unreachable, open direct clean helper download tab
    const helperUrl = `https://cobalt.tools/#${encodeURIComponent(videoUrl)}`;
    chrome.tabs.create({ url: helperUrl });
  }
}

// Runtime Message Listener
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tabId = (sender.tab && sender.tab.id) || message.tabId;

  switch (message.action) {
    case "ADD_MEDIA": {
      if (tabId && message.item) {
        const item = addMediaItem(tabId, message.item);
        sendResponse({ success: true, item, count: mediaByTab.get(tabId)?.size || 0 });
      } else {
        sendResponse({ success: false, error: "Missing tabId or item" });
      }
      return true;
    }

    case "ADD_BATCH_MEDIA": {
      if (tabId && Array.isArray(message.items)) {
        message.items.forEach((item) => addMediaItem(tabId, item));
        sendResponse({ success: true, count: mediaByTab.get(tabId)?.size || 0 });
      } else {
        sendResponse({ success: false });
      }
      return true;
    }

    case "SET_LAST_CLICKED_LINK": {
      if (tabId && message.title) {
        tabLastClickedLink.set(tabId, {
          title: message.title,
          url: message.url || "",
          time: Date.now()
        });

        // Update any existing item on this tab that has a generic title
        const map = getTabMediaMap(tabId);
        let found = false;

        // If specific URL provided, update that item directly
        if (message.url && map.has(message.url)) {
          const item = map.get(message.url);
          item.title = message.title;
          item.timestamp = Date.now();
          map.delete(message.url);
          map.set(message.url, item); // re-insert at bottom
          found = true;
        }

        // Otherwise update the most recent item if it had a generic title
        if (!found) {
          const entries = Array.from(map.entries());
          for (let i = entries.length - 1; i >= 0; i--) {
            const [url, item] = entries[i];
            if (isGenericTitle(item.title)) {
              item.title = message.title;
              item.timestamp = Date.now();
              map.delete(url);
              map.set(url, item); // re-insert at bottom
              break;
            }
          }
        }

        sendResponse({ success: true });
      }
      return true;
    }

    case "UPDATE_MEDIA_TITLE": {
      if (tabId && message.url && message.title) {
        const map = getTabMediaMap(tabId);
        if (map.has(message.url)) {
          const item = map.get(message.url);
          item.title = message.title;
        }
        sendResponse({ success: true });
      }
      return true;
    }

    case "GET_MEDIA": {
      const targetTabId = message.tabId || tabId;
      const map = mediaByTab.get(targetTabId);
      // Chronological order: oldest at top, newest / most recently clicked at the bottom
      const items = map ? Array.from(map.values()) : [];
      sendResponse({ items, count: items.length });
      return true;
    }

    case "CLEAR_MEDIA": {
      if (tabId) {
        mediaByTab.delete(tabId);
        updateBadge(tabId);
      }
      sendResponse({ success: true });
      return true;
    }

    case "DOWNLOAD_YOUTUBE_MEDIA": {
      handleYouTubeDownload(
        tabId,
        message.videoId,
        message.quality,
        message.title,
        message.url
      );
      sendResponse({ success: true });
      return true;
    }

    case "OPEN_HLS_DOWNLOADER": {
      openHlsDownloader(message.url, message.title);
      sendResponse({ success: true });
      return true;
    }

    case "SCAN_PAGE": {
      if (message.tabId) {
        chrome.tabs.sendMessage(message.tabId, { action: "TRIGGER_SCAN" }, (res) => {
          sendResponse(res || { success: false });
        });
        return true;
      }
      sendResponse({ success: false });
      return true;
    }

    case "GET_DOWNLOAD_STATES": {
      sendResponse({ success: true, downloads: backgroundDownloader.getAllStates() });
      return true;
    }

    case "START_DOWNLOAD": {
      backgroundDownloader.start(
        message.url,
        message.filename,
        tabId,
        message.downloadId
      );
      sendResponse({ success: true });
      return true;
    }

    case "PAUSE_DOWNLOAD": {
      backgroundDownloader.pause(message.downloadId || message.url);
      sendResponse({ success: true });
      return true;
    }

    case "RESUME_DOWNLOAD": {
      backgroundDownloader.resume(message.downloadId || message.url);
      sendResponse({ success: true });
      return true;
    }

    case "CANCEL_DOWNLOAD": {
      backgroundDownloader.cancel(message.downloadId || message.url);
      sendResponse({ success: true });
      return true;
    }

    default:
      break;
  }
});

// Tab lifecycle management
chrome.tabs.onRemoved.addListener((tabId) => {
  mediaByTab.delete(tabId);
  tabLastClickedLink.delete(tabId);
  tabHosts.delete(tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url) {
    try {
      const newHost = new URL(changeInfo.url).hostname;
      const oldHost = tabHosts.get(tabId);

      // Only wipe if navigating to a different website/domain
      if (oldHost && oldHost !== newHost) {
        mediaByTab.delete(tabId);
        tabLastClickedLink.delete(tabId);
        updateBadge(tabId);
      }
      tabHosts.set(tabId, newHost);
    } catch (_) {}
  }
});
