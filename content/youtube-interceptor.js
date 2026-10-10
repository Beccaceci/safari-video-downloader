// Safari Video Downloader - YouTube Main World Interceptor
// Injected into YouTube page execution context to extract player response data

(() => {
  if (window.__SVD_YT_INTERCEPTOR_INIT__) return;
  window.__SVD_YT_INTERCEPTOR_INIT__ = true;

  function extractYouTubeData() {
    try {
      let playerResponse = window.ytInitialPlayerResponse;

      // Try player element method if global variable is outdated
      if (!playerResponse || !playerResponse.videoDetails) {
        const playerEl = document.querySelector("#movie_player, ytd-player");
        if (playerEl && typeof playerEl.getPlayerResponse === "function") {
          playerResponse = playerEl.getPlayerResponse();
        }
      }

      if (!playerResponse || !playerResponse.videoDetails) return null;

      const videoDetails = playerResponse.videoDetails;
      const streamingData = playerResponse.streamingData || {};

      // Parse muxed progressive formats (has both video & audio, usually 720p or 360p)
      const formats = (streamingData.formats || []).map((f) => ({
        itag: f.itag,
        quality: f.qualityLabel || f.quality || "720p",
        mimeType: f.mimeType,
        url: f.url || "", // direct progressive MP4 URL if not ciphered
        hasAudio: true,
        hasVideo: true,
        contentLength: f.contentLength || 0
      }));

      // Parse adaptive formats (1080p video, 4K, or audio-only streams)
      const adaptiveFormats = (streamingData.adaptiveFormats || []).map((f) => ({
        itag: f.itag,
        quality: f.qualityLabel || f.quality || (f.mimeType?.includes("audio") ? "audio" : "video"),
        mimeType: f.mimeType,
        url: f.url || "",
        hasAudio: f.mimeType?.includes("audio"),
        hasVideo: f.mimeType?.includes("video"),
        contentLength: f.contentLength || 0
      }));

      const payload = {
        videoId: videoDetails.videoId,
        title: videoDetails.title,
        author: videoDetails.author,
        lengthSeconds: parseInt(videoDetails.lengthSeconds || "0", 10),
        thumbnail:
          videoDetails.thumbnail?.thumbnails?.[0]?.url ||
          `https://i.ytimg.com/vi/${videoDetails.videoId}/hqdefault.jpg`,
        formats: formats,
        adaptiveFormats: adaptiveFormats
      };

      window.postMessage(
        {
          type: "__SAFARI_VID_YT_DATA__",
          data: payload
        },
        "*"
      );

      return payload;
    } catch (err) {
      console.debug("[Safari Video Downloader] YouTube player extraction error:", err);
      return null;
    }
  }

  // Extract on initial injection
  extractYouTubeData();

  // Listen for request from content script or YouTube SPA events
  window.addEventListener("message", (e) => {
    if (e.source === window && e.data && e.data.type === "__SAFARI_VID_YT_REQUEST_DATA__") {
      extractYouTubeData();
    }
  });

  // Re-extract on YouTube player state change or custom events
  window.addEventListener("yt-navigate-finish", () => {
    setTimeout(extractYouTubeData, 800);
  });
})();
