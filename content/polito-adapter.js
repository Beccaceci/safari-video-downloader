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

  // Clean lecture title preserving dates
  function sanitizeName(name) {
    if (!name) return "videolezione";
    return name
      .replace(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/g, "$1-$2-$3") // Convert 09/10/2026 -> 09-10-2026
      .replace(/[<>:"/\\|?*\x00-\x1F]/g, " ")
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

      // Track click on the link directly so extension popup gets the clean lecture title
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

      const isDirectMedia = /\.(mp4|m3u8)(\?.*)?$/i.test(fullUrl) || fullUrl.includes("video.polito.it");

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

  // Register media when on a lecture playback page with an active video
  function checkLecturePlaybackPage() {
    const video = document.querySelector("video");
    if (!video) return;

    const title = resolveCurrentLectureTitle();
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
