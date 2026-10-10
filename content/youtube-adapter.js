// Safari Video Downloader - YouTube Adapter
// Detects YouTube videos & shorts, injects native-looking download pill button, and registers media

(() => {
  const isYouTube =
    location.hostname.includes("youtube.com") ||
    location.href.includes("mock-youtube");

  if (!isYouTube) return;

  console.log("[Safari Video Downloader] YouTube adapter initialized on:", location.href);

  let currentVideoId = null;
  let ytPlayerData = null;

  // Inject main-world interceptor for accessing YouTube player data
  function injectYouTubeInterceptor() {
    try {
      const script = document.createElement("script");
      script.src = chrome.runtime.getURL("content/youtube-interceptor.js");
      script.onload = function () {
        this.remove();
      };
      (document.head || document.documentElement).appendChild(script);
    } catch (_) {}
  }

  injectYouTubeInterceptor();

  // Listen for player data from main world interceptor
  window.addEventListener("message", (event) => {
    if (event.source !== window || !event.data || event.data.type !== "__SAFARI_VID_YT_DATA__") {
      return;
    }
    ytPlayerData = event.data.data;
    if (ytPlayerData && ytPlayerData.videoId === currentVideoId) {
      registerYouTubeMedia(ytPlayerData);
    }
  });

  // Extract video ID from URL
  function getVideoId() {
    try {
      const url = new URL(location.href);
      if (url.pathname.startsWith("/shorts/")) {
        return url.pathname.split("/shorts/")[1].split("/")[0].split("?")[0];
      }
      return url.searchParams.get("v");
    } catch (_) {
      return null;
    }
  }

  // Extract clean video title from YouTube DOM
  function getVideoTitle() {
    if (ytPlayerData && ytPlayerData.title) return ytPlayerData.title;

    const titleEl =
      document.querySelector("#title h1 yt-formatted-string") ||
      document.querySelector("h1.ytd-watch-metadata yt-formatted-string") ||
      document.querySelector("h1.title") ||
      document.querySelector("h1");

    let title = titleEl ? titleEl.textContent.trim() : document.title;
    return title.replace(/\s*-\s*YouTube$/i, "").trim() || "YouTube Video";
  }

  // Extract channel name
  function getChannelName() {
    if (ytPlayerData && ytPlayerData.author) return ytPlayerData.author;

    const channelEl =
      document.querySelector("#owner #channel-name yt-formatted-string") ||
      document.querySelector("#channel-name a") ||
      document.querySelector(".ytd-channel-name a");

    return channelEl ? channelEl.textContent.trim() : "";
  }

  // Register detected YouTube video with the extension background worker
  function registerYouTubeMedia(extraData = null) {
    const videoId = getVideoId();
    if (!videoId) return;

    const title = (extraData && extraData.title) || getVideoTitle();
    const author = (extraData && extraData.author) || getChannelName();
    const thumbnail = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

    const progressiveFormats = extraData?.formats || [];
    const direct720p = progressiveFormats.find((f) => f.quality?.includes("720") && f.url);
    const direct360p = progressiveFormats.find((f) => f.quality?.includes("360") && f.url);

    chrome.runtime.sendMessage({
      action: "ADD_MEDIA",
      item: {
        url: `https://www.youtube.com/watch?v=${videoId}`,
        title: title,
        ext: "mp4",
        source: "youtube",
        videoId: videoId,
        author: author,
        thumbnail: thumbnail,
        directUrl720: direct720p?.url || "",
        directUrl360: direct360p?.url || ""
      }
    });
  }

  // Download trigger router for YouTube
  function downloadYouTube(videoId, quality, title) {
    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const cleanTitle = title || getVideoTitle();

    chrome.runtime.sendMessage({
      action: "DOWNLOAD_YOUTUBE_MEDIA",
      url: videoUrl,
      videoId: videoId,
      quality: quality, // "1080", "720", "mp3"
      title: cleanTitle
    });
  }

  // Inject sleek, native-looking "⬇ Download" button into YouTube's action bar
  function injectDownloadButton() {
    const videoId = getVideoId();
    if (!videoId) return;

    // Avoid injecting multiple times for the same video
    const existing = document.getElementById("svd-yt-download-btn-wrapper");
    if (existing) {
      if (existing.dataset.videoId === videoId) return;
      existing.remove();
    }

    // Look for YouTube's action button containers
    const actionsBar =
      document.querySelector("#actions #top-level-buttons-computed") ||
      document.querySelector("#menu #top-level-buttons-computed") ||
      document.querySelector("#top-level-buttons-computed") ||
      document.querySelector("#actions-inner") ||
      document.querySelector(".yt-action-buttons");

    if (!actionsBar) return;

    const wrapper = document.createElement("div");
    wrapper.id = "svd-yt-download-btn-wrapper";
    wrapper.className = "svd-yt-btn-wrapper";
    wrapper.dataset.videoId = videoId;

    wrapper.innerHTML = `
      <button type="button" class="svd-yt-btn" id="svd-yt-main-btn" title="Download video with Safari Video Downloader">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
          <polyline points="7 10 12 15 17 10"></polyline>
          <line x1="12" y1="15" x2="12" y2="3"></line>
        </svg>
        <span>Download</span>
        <svg class="svd-caret" width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
          <path d="M7 10l5 5 5-5z"></path>
        </svg>
      </button>

      <div class="svd-yt-menu hidden" id="svd-yt-dropdown">
        <div class="svd-yt-menu-header">Download Options</div>
        <button class="svd-yt-menu-item" data-quality="1080">
          <span class="svd-yt-badge hd">1080p</span>
          <div class="svd-yt-item-info">
            <span class="svd-yt-item-title">Full HD MP4</span>
            <span class="svd-yt-item-sub">Highest resolution video</span>
          </div>
        </button>
        <button class="svd-yt-menu-item" data-quality="720">
          <span class="svd-yt-badge">720p</span>
          <div class="svd-yt-item-info">
            <span class="svd-yt-item-title">Standard HD MP4</span>
            <span class="svd-yt-item-sub">Fast direct download</span>
          </div>
        </button>
        <button class="svd-yt-menu-item" data-quality="mp3">
          <span class="svd-yt-badge audio">MP3</span>
          <div class="svd-yt-item-info">
            <span class="svd-yt-item-title">Audio Only (MP3)</span>
            <span class="svd-yt-item-sub">Extracted high-bitrate audio</span>
          </div>
        </button>
      </div>
    `;

    // Dropdown toggle
    const mainBtn = wrapper.querySelector("#svd-yt-main-btn");
    const dropdown = wrapper.querySelector("#svd-yt-dropdown");

    mainBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      dropdown.classList.toggle("hidden");
    });

    document.addEventListener("click", (e) => {
      if (!wrapper.contains(e.target)) {
        dropdown.classList.add("hidden");
      }
    });

    // Menu options click
    wrapper.querySelectorAll(".svd-yt-menu-item").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        dropdown.classList.add("hidden");

        const quality = btn.dataset.quality;
        const currentTitle = getVideoTitle();

        mainBtn.classList.add("svd-yt-loading");
        mainBtn.querySelector("span").textContent = "Preparing...";

        downloadYouTube(videoId, quality, currentTitle);

        setTimeout(() => {
          mainBtn.classList.remove("svd-yt-loading");
          mainBtn.querySelector("span").textContent = "Download";
        }, 3500);
      });
    });

    // Insert into actions bar
    actionsBar.appendChild(wrapper);
  }

  // Handle SPA (Single Page Application) navigation in YouTube
  function onYouTubePageChange() {
    const videoId = getVideoId();
    if (!videoId) return;

    if (videoId !== currentVideoId) {
      currentVideoId = videoId;
      ytPlayerData = null;

      // Ask main-world interceptor for fresh player data
      window.postMessage({ type: "__SAFARI_VID_YT_REQUEST_DATA__" }, "*");

      // Register video and inject button
      setTimeout(() => {
        registerYouTubeMedia();
        injectDownloadButton();
      }, 500);
    } else {
      injectDownloadButton();
    }
  }

  // Hook into YouTube SPA events
  window.addEventListener("yt-navigate-finish", onYouTubePageChange);
  window.addEventListener("yt-page-data-updated", onYouTubePageChange);
  window.addEventListener("popstate", onYouTubePageChange);

  // Periodic check / MutationObserver to handle dynamic DOM re-renders
  let checkTimer = null;
  const observer = new MutationObserver(() => {
    if (checkTimer) clearTimeout(checkTimer);
    checkTimer = setTimeout(() => {
      const vId = getVideoId();
      if (vId) {
        if (!document.getElementById("svd-yt-download-btn-wrapper")) {
          injectDownloadButton();
        }
      }
    }, 800);
  });

  if (document.body) {
    observer.observe(document.body, { childList: true, subtree: true });
  }

  // Initial trigger
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", onYouTubePageChange);
  } else {
    onYouTubePageChange();
  }
})();
