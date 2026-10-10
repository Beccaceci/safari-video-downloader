// Safari Video Downloader - Main World Interceptor
// Injected into the page window context to intercept fetch, XHR, and MediaSource

(() => {
  if (window.__SAFARI_VID_INTERCEPTOR_INIT__) return;
  window.__SAFARI_VID_INTERCEPTOR_INIT__ = true;

  const VIDEO_EXT_REGEX = /\.(mp4|m3u8|webm|m4v|mov|mkv|flv|ts)(\?.*)?$/i;
  const VIDEO_MIME_PREFIXES = [
    "video/",
    "application/vnd.apple.mpegurl",
    "application/x-mpegurl",
    "application/dash+xml"
  ];

  function isVideoMime(mime) {
    if (!mime) return false;
    const lower = mime.toLowerCase();
    return VIDEO_MIME_PREFIXES.some((prefix) => lower.includes(prefix));
  }

  function notifyMediaFound(details) {
    try {
      window.postMessage(
        {
          type: "__SAFARI_VID_FOUND__",
          data: {
            url: details.url,
            mime: details.mime || "",
            size: details.size || 0,
            title: details.title || document.title || "Video",
            source: details.source || "interceptor"
          }
        },
        "*"
      );
    } catch (e) {
      // Ignore cross-origin serialization issues
    }
  }

  // --- 1. Intercept Fetch API ---
  const originalFetch = window.fetch;
  window.fetch = async function (...args) {
    const input = args[0];
    const url = typeof input === "string" ? input : input?.url;

    try {
      const response = await originalFetch.apply(this, args);
      if (url) {
        let isVideo = VIDEO_EXT_REGEX.test(url);
        let mime = "";
        let size = 0;

        try {
          mime = response.headers.get("content-type") || "";
          size = parseInt(response.headers.get("content-length") || "0", 10);
        } catch (_) {}

        if (isVideo || isVideoMime(mime)) {
          notifyMediaFound({
            url: new URL(url, location.href).href,
            mime: mime,
            size: size,
            source: "fetch"
          });
        }
      }
      return response;
    } catch (err) {
      return originalFetch.apply(this, args);
    }
  };

  // --- 2. Intercept XMLHttpRequest ---
  const originalXHROpen = XMLHttpRequest.prototype.open;
  const originalXHRSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__svd_url = url;
    return originalXHROpen.apply(this, [method, url, ...rest]);
  };

  XMLHttpRequest.prototype.send = function (...args) {
    this.addEventListener("load", () => {
      try {
        const url = this.__svd_url;
        if (!url) return;

        let isVideo = VIDEO_EXT_REGEX.test(url);
        const mime = this.getResponseHeader("content-type") || "";
        const size = parseInt(this.getResponseHeader("content-length") || "0", 10);

        if (isVideo || isVideoMime(mime)) {
          notifyMediaFound({
            url: new URL(url, location.href).href,
            mime: mime,
            size: size,
            source: "xhr"
          });
        }
      } catch (_) {}
    });

    return originalXHRSend.apply(this, args);
  };

  // --- 3. Intercept MediaSource (CocoCut strategy for streaming players) ---
  if (window.MediaSource && window.MediaSource.prototype.addSourceBuffer) {
    const originalAddSourceBuffer = window.MediaSource.prototype.addSourceBuffer;
    window.MediaSource.prototype.addSourceBuffer = function (mimeType) {
      if (mimeType && mimeType.toLowerCase().includes("video")) {
        // Find associated video tag src or active streams
        setTimeout(() => {
          document.querySelectorAll("video").forEach((vid) => {
            const src = vid.currentSrc || vid.src;
            if (src && !src.startsWith("blob:")) {
              notifyMediaFound({
                url: new URL(src, location.href).href,
                mime: mimeType,
                title: document.title,
                source: "mediasource"
              });
            }
          });
        }, 500);
      }
      return originalAddSourceBuffer.apply(this, arguments);
    };
  }

  // --- 4. Intercept HTMLMediaElement src assignment ---
  try {
    const srcDescriptor = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "src");
    if (srcDescriptor && srcDescriptor.set) {
      const originalSrcSet = srcDescriptor.set;
      srcDescriptor.set = function (newSrc) {
        if (newSrc && typeof newSrc === "string" && !newSrc.startsWith("blob:")) {
          notifyMediaFound({
            url: new URL(newSrc, location.href).href,
            title: document.title,
            source: "dom_video"
          });
        }
        return originalSrcSet.call(this, newSrc);
      };
      Object.defineProperty(HTMLMediaElement.prototype, "src", srcDescriptor);
    }
  } catch (_) {}

})();
