// Safari Video Downloader - Portale della Didattica (PoliTo) Adapter
// Specialized detection, endpoint resolution, and inline download buttons for didattica.polito.it

(() => {
  const isPoliToSite =
    location.hostname.includes("polito.it") ||
    location.href.includes("mock-polito") ||
    document.title.toLowerCase().includes("portale della didattica");

  if (!isPoliToSite) return;

  console.log("[Safari Video Downloader] Portale della Didattica adapter active on:", location.href);

  // Cache to avoid repeated fetches of same lecture page
  const resolvedCache = new Map();

  // Clean lecture title
  function sanitizeName(name) {
    return (name || "videolezione")
      .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
      .replace(/\s+/g, " ")
      .trim();
  }

  function cleanLectureLinkText(rawText) {
    if (!rawText) return "";
    let text = rawText.replace(/^[•\s\-\*]+/, "").trim();
    const match = text.match(/(?:Videolezione|Lezione)\s*(?:del\s*)?[\d\/\-\.]+/i);
    if (match) {
      const fullCleaned = text.replace(/^[•\s\-\*]+/, "").replace(/\s+/g, " ").trim();
      return fullCleaned.length > 70 ? match[0] : fullCleaned;
    }
    return text.replace(/\s+/g, " ").slice(0, 100);
  }

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

  function resolveCurrentLectureTitle() {
    // 1. Check clicked link from sessionStorage
    try {
      const stored = sessionStorage.getItem("__SVD_LAST_CLICKED_TITLE__");
      if (stored && !isGenericTitle(stored)) return stored;
    } catch (_) {}

    // 2. Check active/highlighted elements on page
    const activeLink = document.querySelector(".active, .selected, [aria-current='page'], .corrente");
    if (activeLink) {
      const text = cleanLectureLinkText(activeLink.innerText || activeLink.textContent || "");
      if (text && !isGenericTitle(text)) return text;
    }

    // 3. Check page headings for "Lezione del DD/MM/YYYY"
    const headings = document.querySelectorAll("h1, h2, h3, h4, h5, .titolo_lezione, p, strong");
    for (const h of headings) {
      const text = (h.innerText || h.textContent || "").trim();
      if (/(?:Videolezione|Lezione)\s*(?:del\s*)?[\d\/\-\.]+/i.test(text)) {
        return cleanLectureLinkText(text);
      }
    }

    // 4. Check links matching "Lezione del DD/MM/YYYY"
    const allLinks = document.querySelectorAll("a");
    for (const l of allLinks) {
      const text = (l.innerText || l.textContent || "").trim();
      if (/Lezione del \d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}/i.test(text)) {
        return cleanLectureLinkText(text);
      }
    }

    return !isGenericTitle(document.title) ? document.title : "Videolezione";
  }

  // Resolve video URL from a lecture viewer page
  async function resolveLectureVideoUrl(lectureUrl) {
    if (resolvedCache.has(lectureUrl)) {
      return resolvedCache.get(lectureUrl);
    }

    try {
      const response = await fetch(lectureUrl, { credentials: "include" });
      const html = await response.text();

      // Check common PoliTo video patterns
      // 1. Direct video.polito.it MP4 download pattern
      const mp4Match = html.match(/https?:\/\/video\.polito\.it\/dl\/[^\s"']+\.mp4/i);
      if (mp4Match) {
        resolvedCache.set(lectureUrl, mp4Match[0]);
        return mp4Match[0];
      }

      // 2. Generic .mp4 or .m3u8 within source or video tag
      const genericMp4 = html.match(/https?:\/\/[^\s"']+\.mp4(?:\?[^\s"']*)?/i);
      if (genericMp4) {
        resolvedCache.set(lectureUrl, genericMp4[0]);
        return genericMp4[0];
      }

      const m3u8Match = html.match(/https?:\/\/[^\s"']+\.m3u8(?:\?[^\s"']*)?/i);
      if (m3u8Match) {
        resolvedCache.set(lectureUrl, m3u8Match[0]);
        return m3u8Match[0];
      }

      // 3. Relative video path
      const relativeMatch = html.match(/["'](\/(?:dl|video)\/[^"']+\.mp4)["']/i);
      if (relativeMatch) {
        const full = new URL(relativeMatch[1], lectureUrl).href;
        resolvedCache.set(lectureUrl, full);
        return full;
      }
    } catch (err) {
      console.warn("[Safari Video Downloader] Could not resolve lecture page:", lectureUrl, err);
    }

    return null;
  }

  // Inject inline download buttons on course / lecture tables
  async function enhanceLectureLinks() {
    // Selectors covering legacy and current Portale della Didattica lecture links
    const selectors = [
      'a[href*="sviluppo.videolezioni"]',
      'a[href*="videolezioni.vis"]',
      'a[href*="video.polito.it"]',
      'a[href*="lez="]',
      'li.h5 a',
      '.policorpolink',
      'li a',
      'table a'
    ];

    const candidates = document.querySelectorAll(selectors.join(", "));
    if (candidates.length === 0) return;

    candidates.forEach(async (link) => {
      const rawText = link.innerText || link.textContent || "";
      const href = link.getAttribute("href") || "";

      // Match either known URL pattern or text containing "Lezione" / "Videolezione"
      const isLecture =
        /(?:Videolezione|Lezione)\s*(?:del\s*)?[\d\/\-\.]+/i.test(rawText) ||
        href.includes("sviluppo.videolezioni") ||
        href.includes("video.polito.it") ||
        href.includes("lez=");

      if (!isLecture) return;

      if (link.dataset.svdEnhanced) return;
      link.dataset.svdEnhanced = "true";

      const fullUrl = href ? new URL(href, location.href).href : "";
      const lectureTitle = cleanLectureLinkText(rawText) || "Videolezione";

      // Track click on the link directly
      link.addEventListener("click", () => {
        try {
          sessionStorage.setItem("__SVD_LAST_CLICKED_TITLE__", lectureTitle);
        } catch (_) {}
        chrome.runtime.sendMessage({
          action: "SET_LAST_CLICKED_LINK",
          title: lectureTitle,
          url: fullUrl
        });
      });

      // If the link directly points to an mp4/m3u8
      const isDirectMedia = /\.(mp4|m3u8)(\?.*)?$/i.test(fullUrl);

      // Create inline button
      const btn = document.createElement("button");
      btn.className = "svd-inline-btn";
      btn.type = "button";
      btn.innerHTML = `
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
          <polyline points="7 10 12 15 17 10"></polyline>
          <line x1="12" y1="15" x2="12" y2="3"></line>
        </svg>
        <span>Scarica Video</span>
      `;
      btn.title = `Scarica "${lectureTitle}" con Safari Video Downloader`;

      btn.addEventListener("click", async (e) => {
        e.preventDefault();
        e.stopPropagation();

        btn.classList.add("svd-loading");
        btn.querySelector("span").textContent = "Ricerca stream...";

        let targetVideoUrl = fullUrl;
        if (!isDirectMedia) {
          targetVideoUrl = await resolveLectureVideoUrl(fullUrl);
        }

        btn.classList.remove("svd-loading");

        if (targetVideoUrl) {
          btn.classList.add("svd-success");
          btn.querySelector("span").textContent = "Download in corso...";

          const filename = `${sanitizeName(lectureTitle)}.${targetVideoUrl.includes(".m3u8") ? "mp4" : "mp4"}`;

          // Immediately register with background extension list
          chrome.runtime.sendMessage({
            action: "ADD_MEDIA",
            item: {
              url: targetVideoUrl,
              title: lectureTitle,
              ext: targetVideoUrl.includes(".m3u8") ? "m3u8" : "mp4",
              source: "polito"
            }
          });

          if (targetVideoUrl.includes(".m3u8")) {
            chrome.runtime.sendMessage({
              action: "OPEN_HLS_DOWNLOADER",
              url: targetVideoUrl,
              title: lectureTitle
            });
          } else {
            chrome.runtime.sendMessage({
              action: "START_DOWNLOAD",
              url: targetVideoUrl,
              filename: filename
            });
          }

          setTimeout(() => {
            btn.classList.remove("svd-success");
            btn.querySelector("span").textContent = "Scarica Video";
          }, 3000);
        } else {
          btn.classList.add("svd-error");
          btn.querySelector("span").textContent = "Non trovato";
          setTimeout(() => {
            btn.classList.remove("svd-error");
            btn.querySelector("span").textContent = "Scarica Video";
          }, 3000);
        }
      });

      // Insert button right after the link
      link.insertAdjacentElement("afterend", btn);

      // Pre-resolve and add to background extension badge if possible
      if (isDirectMedia) {
        chrome.runtime.sendMessage({
          action: "ADD_MEDIA",
          item: {
            url: fullUrl,
            title: lectureTitle,
            ext: fullUrl.includes(".m3u8") ? "m3u8" : "mp4",
            source: "polito"
          }
        });
      }
    });
  }

  // Add floating banner if we are on a lecture playback page with an active video
  function checkLecturePlaybackPage() {
    const video = document.querySelector("video");
    if (!video) return;

    if (document.getElementById("svd-polito-floating-bar")) return;

    const bar = document.createElement("div");
    bar.id = "svd-polito-floating-bar";
    bar.className = "svd-floating-bar";

    const title = resolveCurrentLectureTitle();
    bar.innerHTML = `
      <div class="svd-floating-info">
        <span class="svd-floating-icon">🎓</span>
        <span class="svd-floating-title">${title}</span>
      </div>
      <button class="svd-floating-btn" id="svd-floating-dl-btn">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
          <polyline points="7 10 12 15 17 10"></polyline>
          <line x1="12" y1="15" x2="12" y2="3"></line>
        </svg>
        <span>Scarica Videolezione (.mp4)</span>
      </button>
    `;

    document.body.appendChild(bar);

    // Notify background with resolved lecture title
    const currentSrc = video.currentSrc || video.src;
    if (currentSrc && !currentSrc.startsWith("blob:")) {
      chrome.runtime.sendMessage({
        action: "ADD_MEDIA",
        item: {
          url: new URL(currentSrc, location.href).href,
          title: title,
          ext: currentSrc.includes(".m3u8") ? "m3u8" : "mp4",
          source: "polito_player"
        }
      });
    }

    document.getElementById("svd-floating-dl-btn").addEventListener("click", () => {
      const src = video.currentSrc || video.src;
      if (src) {
        const ext = src.includes(".m3u8") ? "m3u8" : "mp4";
        if (ext === "m3u8") {
          chrome.runtime.sendMessage({
            action: "OPEN_HLS_DOWNLOADER",
            url: src,
            title: title
          });
        } else {
          chrome.runtime.sendMessage({
            action: "START_DOWNLOAD",
            url: src,
            filename: `${sanitizeName(title)}.mp4`
          });
        }
      }
    });
  }

  function initPoliToAdapter() {
    enhanceLectureLinks();
    checkLecturePlaybackPage();

    const observer = new MutationObserver(() => {
      enhanceLectureLinks();
      checkLecturePlaybackPage();
    });

    if (document.body) {
      observer.observe(document.body, { childList: true, subtree: true });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initPoliToAdapter);
  } else {
    initPoliToAdapter();
  }
})();
