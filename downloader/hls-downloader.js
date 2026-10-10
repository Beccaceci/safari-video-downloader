// Safari Video Downloader - HLS Stream Downloader & Merger

document.addEventListener("DOMContentLoaded", () => {
  const params = new URLSearchParams(window.location.search);
  const initialUrl = params.get("url") || "";
  const initialTitle = params.get("title") || "video_lecture";

  const titleInput = document.getElementById("video-title");
  const urlInput = document.getElementById("m3u8-url");
  const copyUrlBtn = document.getElementById("copy-url-btn");
  const qualityField = document.getElementById("quality-field");
  const qualitySelect = document.getElementById("quality-select");

  const statusBadge = document.getElementById("status-badge");
  const statusText = document.getElementById("status-text");
  const percentageText = document.getElementById("percentage-text");
  const progressBar = document.getElementById("progress-bar");

  const statSegments = document.getElementById("stat-segments");
  const statSize = document.getElementById("stat-size");
  const statSpeed = document.getElementById("stat-speed");
  const statEta = document.getElementById("stat-eta");

  const startBtn = document.getElementById("start-btn");
  const cancelBtn = document.getElementById("cancel-btn");
  const saveBtn = document.getElementById("save-btn");
  const clearLogBtn = document.getElementById("clear-log-btn");
  const logOutput = document.getElementById("log-output");

  titleInput.value = initialTitle;
  urlInput.value = initialUrl;

  let isDownloading = false;
  let isCancelled = false;
  let abortControllers = [];
  let downloadedBlobUrl = null;

  function log(msg, type = "info") {
    const line = document.createElement("div");
    line.className = `log-line ${type}`;
    const time = new Date().toLocaleTimeString();
    line.textContent = `[${time}] ${msg}`;
    logOutput.appendChild(line);
    logOutput.scrollTop = logOutput.scrollHeight;
  }

  clearLogBtn.addEventListener("click", () => {
    logOutput.innerHTML = "";
  });

  copyUrlBtn.addEventListener("click", () => {
    if (urlInput.value) {
      navigator.clipboard.writeText(urlInput.value);
      copyUrlBtn.textContent = "Copied!";
      setTimeout(() => (copyUrlBtn.textContent = "Copy"), 2000);
    }
  });

  // Resolve relative URL against base
  function resolveUrl(relative, base) {
    try {
      return new URL(relative, base).href;
    } catch (_) {
      return relative;
    }
  }

  // Parse Master or Media Playlist
  async function inspectPlaylist(url) {
    try {
      log(`Fetching playlist: ${url}`, "info");
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      const text = await res.text();

      // Check if Master Playlist with multiple variants
      if (text.includes("#EXT-X-STREAM-INF")) {
        log("Master playlist detected with multiple stream qualities.", "info");
        const lines = text.split("\n");
        const variants = [];

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i].trim();
          if (line.startsWith("#EXT-X-STREAM-INF:")) {
            const streamInfo = line.slice(18);
            let resMatch = streamInfo.match(/RESOLUTION=(\d+x\d+)/i);
            let bwMatch = streamInfo.match(/BANDWIDTH=(\d+)/i);
            const nextLine = (lines[i + 1] || "").trim();

            if (nextLine && !nextLine.startsWith("#")) {
              const variantUrl = resolveUrl(nextLine, url);
              variants.push({
                resolution: resMatch ? resMatch[1] : "Adaptive",
                bandwidth: bwMatch ? Math.round(parseInt(bwMatch[1], 10) / 1000) : 0,
                url: variantUrl
              });
            }
          }
        }

        if (variants.length > 0) {
          qualityField.classList.remove("hidden");
          qualitySelect.innerHTML = "";
          variants.forEach((v, idx) => {
            const opt = document.createElement("option");
            opt.value = v.url;
            opt.textContent = `${v.resolution} (${v.bandwidth ? v.bandwidth + " kbps" : "auto"})`;
            qualitySelect.appendChild(opt);
          });
          return variants[0].url;
        }
      }

      return url;
    } catch (err) {
      log(`Error inspecting playlist: ${err.message}`, "error");
      return url;
    }
  }

  // Parse Media Playlist for Segments and Keys
  async function parseMediaPlaylist(mediaUrl) {
    const res = await fetch(mediaUrl, { credentials: "include" });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    const text = await res.text();
    const lines = text.split("\n");

    const segments = [];
    let encryptionKey = null;
    let encryptionIv = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      // Encryption Key Check
      if (line.startsWith("#EXT-X-KEY:")) {
        const keyInfo = line.slice(11);
        if (keyInfo.includes("METHOD=AES-128")) {
          const uriMatch = keyInfo.match(/URI="([^"]+)"/);
          const ivMatch = keyInfo.match(/IV=(0x[0-9a-fA-F]+)/);

          if (uriMatch) {
            const keyUrl = resolveUrl(uriMatch[1], mediaUrl);
            log(`Encrypted stream (AES-128) detected. Fetching key from: ${keyUrl}`, "info");
            const keyRes = await fetch(keyUrl, { credentials: "include" });
            const keyBuffer = await keyRes.arrayBuffer();

            // Import key into Web Crypto
            encryptionKey = await window.crypto.subtle.importKey(
              "raw",
              keyBuffer,
              { name: "AES-CBC" },
              false,
              ["decrypt"]
            );

            if (ivMatch) {
              const hex = ivMatch[1].slice(2);
              const ivBytes = new Uint8Array(16);
              for (let j = 0; j < 16; j++) {
                ivBytes[j] = parseInt(hex.substr(j * 2, 2), 16) || 0;
              }
              encryptionIv = ivBytes;
            }
          }
        }
      }

      // Segment URL
      if (line && !line.startsWith("#")) {
        const segUrl = resolveUrl(line, mediaUrl);
        segments.push({
          index: segments.length,
          url: segUrl,
          key: encryptionKey,
          iv: encryptionIv
        });
      }
    }

    return segments;
  }

  // Format Helper
  function formatBytes(bytes) {
    if (!bytes) return "0 MB";
    const mb = bytes / (1024 * 1024);
    return `${mb.toFixed(1)} MB`;
  }

  function formatTime(seconds) {
    if (!isFinite(seconds) || seconds < 0) return "--:--";
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }

  // Core Downloader Engine
  async function downloadStream() {
    if (isDownloading) return;
    isDownloading = true;
    isCancelled = false;
    abortControllers = [];

    startBtn.classList.add("hidden");
    cancelBtn.classList.remove("hidden");
    saveBtn.classList.add("hidden");

    statusBadge.className = "status-badge downloading";
    statusBadge.textContent = "Downloading";
    statusText.textContent = "Fetching segments...";

    try {
      const activeUrl = qualitySelect.value || urlInput.value;
      if (!activeUrl) throw new Error("No Stream URL provided.");

      const segments = await parseMediaPlaylist(activeUrl);
      if (segments.length === 0) throw new Error("No video segments found in playlist.");

      log(`Found ${segments.length} video segments to download.`, "info");

      const totalSegments = segments.length;
      const chunks = new Array(totalSegments);
      let downloadedCount = 0;
      let totalBytes = 0;

      const startTime = Date.now();
      const concurrencyLimit = 4;
      let currentIndex = 0;

      // Worker function to process segments in parallel
      async function worker() {
        while (currentIndex < totalSegments && !isCancelled) {
          const segIndex = currentIndex++;
          const seg = segments[segIndex];

          const controller = new AbortController();
          abortControllers.push(controller);

          try {
            const res = await fetch(seg.url, {
              signal: controller.signal,
              credentials: "include"
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            let buffer = await res.arrayBuffer();

            // Decrypt if AES-128
            if (seg.key) {
              const iv = seg.iv || new Uint8Array(16);
              buffer = await window.crypto.subtle.decrypt(
                { name: "AES-CBC", iv: iv },
                seg.key,
                buffer
              );
            }

            chunks[segIndex] = buffer;
            downloadedCount++;
            totalBytes += buffer.byteLength;

            // Update Progress & Stats
            const percent = Math.round((downloadedCount / totalSegments) * 100);
            progressBar.style.width = `${percent}%`;
            percentageText.textContent = `${percent}%`;
            statSegments.textContent = `${downloadedCount} / ${totalSegments}`;
            statSize.textContent = formatBytes(totalBytes);

            const elapsedSec = (Date.now() - startTime) / 1000;
            const speedBytesPerSec = totalBytes / (elapsedSec || 1);
            const speedKB = speedBytesPerSec / 1024;
            statSpeed.textContent =
              speedKB > 1024
                ? `${(speedKB / 1024).toFixed(1)} MB/s`
                : `${Math.round(speedKB)} KB/s`;

            const remainingSegments = totalSegments - downloadedCount;
            const avgTimePerSegment = elapsedSec / downloadedCount;
            const etaSec = remainingSegments * avgTimePerSegment;
            statEta.textContent = formatTime(etaSec);
          } catch (err) {
            if (isCancelled) return;
            log(`Segment ${segIndex + 1} download error: ${err.message}`, "error");
          }
        }
      }

      // Launch workers
      const workers = [];
      for (let i = 0; i < concurrencyLimit; i++) {
        workers.push(worker());
      }
      await Promise.all(workers);

      if (isCancelled) {
        log("Download cancelled by user.", "info");
        statusBadge.className = "status-badge error";
        statusBadge.textContent = "Cancelled";
        statusText.textContent = "Download cancelled.";
        return;
      }

      // Stitch chunks into unified video Blob
      log("All segments downloaded. Merging into video file...", "info");
      statusText.textContent = "Merging segments into video file...";

      const validChunks = chunks.filter((c) => c && c.byteLength > 0);
      const mergedBlob = new Blob(validChunks, { type: "video/mp4" });
      downloadedBlobUrl = URL.createObjectURL(mergedBlob);

      statusBadge.className = "status-badge success";
      statusBadge.textContent = "Complete";
      statusText.textContent = `Completed! Total size: ${formatBytes(mergedBlob.size)}`;
      progressBar.style.width = "100%";
      percentageText.textContent = "100%";
      statEta.textContent = "00:00";

      saveBtn.classList.remove("hidden");
      cancelBtn.classList.add("hidden");

      log(`Download finished successfully (${formatBytes(mergedBlob.size)}). Triggering save...`, "success");

      // Auto-trigger save
      saveMergedVideo();
    } catch (err) {
      if (!isCancelled) {
        log(`Download failed: ${err.message}`, "error");
        statusBadge.className = "status-badge error";
        statusBadge.textContent = "Error";
        statusText.textContent = err.message;
      }
    } finally {
      isDownloading = false;
      if (!downloadedBlobUrl) {
        startBtn.classList.remove("hidden");
        cancelBtn.classList.add("hidden");
      }
    }
  }

  function saveMergedVideo() {
    if (!downloadedBlobUrl) return;
    const rawTitle = titleInput.value.trim() || "video_lecture";
    const filename = `${rawTitle.replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")}.mp4`;

    const a = document.createElement("a");
    a.href = downloadedBlobUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => a.remove(), 1000);
    log(`Saved video as "${filename}". Check Safari's Downloads list.`, "success");
  }

  function cancelDownload() {
    isCancelled = true;
    abortControllers.forEach((c) => {
      try {
        c.abort();
      } catch (_) {}
    });
    abortControllers = [];
    isDownloading = false;
  }

  startBtn.addEventListener("click", downloadStream);
  cancelBtn.addEventListener("click", cancelDownload);
  saveBtn.addEventListener("click", saveMergedVideo);

  // Initialize playlist inspection if URL passed in
  if (initialUrl) {
    inspectPlaylist(initialUrl);
  }
});
