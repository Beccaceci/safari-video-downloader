// Safari Video Downloader - Background Service Worker

// Map of tabId -> Map<url, MediaItem>
const mediaByTab = new Map();

// Active streaming downloads registry: downloadId/url -> DownloadState
const activeDownloads = new Map();
// Map downloadId -> tabId to reliably route pause/resume/cancel commands
const downloadTabMap = new Map();

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
      chrome.tabs.sendMessage(tab.id, {
        action: "START_DOWNLOAD",
        url: media.url,
        filename: `${sanitizeFilename(media.title)}.${ext}`
      });
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
      chrome.tabs.sendMessage(tab.id, {
        action: "START_DOWNLOAD",
        url: media.url,
        filename: `${sanitizeFilename(media.title)}.${ext}`
      });
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

function sanitizeFilename(name) {
  return (name || "video").replace(/[<>:"/\\|?*\x00-\x1F]/g, "_").trim().slice(0, 150);
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
    chrome.tabs.sendMessage(tabId, {
      action: "START_DOWNLOAD",
      url: existing.directUrl720,
      filename: filename
    });
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
    chrome.tabs.sendMessage(tabId, {
      action: "START_DOWNLOAD",
      url: resolvedUrl,
      filename: filename
    });
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

    case "DOWNLOAD_PROGRESS": {
      if (message.data) {
        const d = message.data;
        activeDownloads.set(d.id, d);
        activeDownloads.set(d.url, d);
        if (tabId) {
          downloadTabMap.set(d.id, tabId);
          downloadTabMap.set(d.url, tabId);
        }
        if (d.status === "completed") {
          setTimeout(() => {
            activeDownloads.delete(d.id);
            activeDownloads.delete(d.url);
          }, 30000);
        } else if (d.status === "cancelled") {
          activeDownloads.delete(d.id);
          activeDownloads.delete(d.url);
        }
      }
      sendResponse({ success: true });
      return true;
    }

    case "GET_DOWNLOAD_STATES": {
      const states = [];
      const seen = new Set();
      for (const dl of activeDownloads.values()) {
        if (!seen.has(dl.id)) {
          seen.add(dl.id);
          states.push(dl);
        }
      }
      sendResponse({ success: true, downloads: states });
      return true;
    }

    case "START_DOWNLOAD": {
      const targetTabId = message.tabId || tabId;
      if (targetTabId) {
        downloadTabMap.set(message.url, targetTabId);
        chrome.tabs.sendMessage(targetTabId, {
          action: "START_DOWNLOAD",
          url: message.url,
          filename: message.filename,
          downloadId: message.downloadId
        }, (res) => {
          sendResponse(res || { success: true });
        });
        return true;
      }
      sendResponse({ success: false, error: "No target tab found" });
      return true;
    }

    case "PAUSE_DOWNLOAD": {
      const targetTabId = message.tabId || downloadTabMap.get(message.downloadId) || downloadTabMap.get(message.url) || tabId;
      if (targetTabId) {
        chrome.tabs.sendMessage(targetTabId, {
          action: "PAUSE_DOWNLOAD",
          downloadId: message.downloadId,
          url: message.url
        }, (res) => {
          sendResponse(res || { success: true });
        });
        return true;
      }
      sendResponse({ success: false });
      return true;
    }

    case "RESUME_DOWNLOAD": {
      const targetTabId = message.tabId || downloadTabMap.get(message.downloadId) || downloadTabMap.get(message.url) || tabId;
      if (targetTabId) {
        chrome.tabs.sendMessage(targetTabId, {
          action: "RESUME_DOWNLOAD",
          downloadId: message.downloadId,
          url: message.url
        }, (res) => {
          sendResponse(res || { success: true });
        });
        return true;
      }
      sendResponse({ success: false });
      return true;
    }

    case "CANCEL_DOWNLOAD": {
      const targetTabId = message.tabId || downloadTabMap.get(message.downloadId) || downloadTabMap.get(message.url) || tabId;
      if (message.downloadId) activeDownloads.delete(message.downloadId);
      if (message.url) activeDownloads.delete(message.url);
      if (targetTabId) {
        chrome.tabs.sendMessage(targetTabId, {
          action: "CANCEL_DOWNLOAD",
          downloadId: message.downloadId,
          url: message.url
        }, (res) => {
          sendResponse(res || { success: true });
        });
        return true;
      }
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
