(async function GuitarTabsExtension() {
  if (window.__spicetifyGuitarTabsLoaded) return;

  while (
    !window.Spicetify ||
    !Spicetify.Player ||
    !Spicetify.Platform ||
    !Spicetify.Topbar ||
    !document.body
  ) {
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  window.__spicetifyGuitarTabsLoaded = true;

  const EXTENSION_VERSION = "2.0.1";
  const VERSION_STORAGE_KEY = "spicetify-guitar-tabs:last-seen-version";
  const STORAGE_PREFIX = "spicetify-guitar-tabs:v2:";
  const LEGACY_PREFIX = "guitar-tabs-";
  const STYLE_ID = "sgt-styles";
  const MODAL_ID = "sgt-modal-overlay";
  const CHANGELOG_MODAL_ID = "sgt-changelog-overlay";

  const CHANGELOG = {
    version: EXTENSION_VERSION,
    title: "Guitar Tabs Update",
    added: [
      "Restored official Songsterr blue (#0077cc) and Ultimate Guitar yellow (#FFD706) button colors.",
      "Updated Web Search to search broadly across all guitar tab sites instead of restricting results to Songsterr."
    ],
    fixed: [
      "Removed redundant site:songsterr.com filter from the Web Search fallback button.",
      "Improved button contrast and hover states for quick visual distinction."
    ]
  };

  const resolvedUrlCache = new Map();

  function stripDiacritics(str) {
    return (str || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
  }

  function cleanTrackTitle(rawTitle) {
    if (!rawTitle) return "";
    return rawTitle
      .replace(
        /\s*[-–—]\s*(\d{4}\s*)?(remaster(ed)?|live|acoustic|demo|mono|stereo|radio edit|single version|album version|instrumental|bonus track|deluxe|anniversary|explicit|clean).*$/i,
        ""
      )
      .replace(
        /\s*[\(\[]\s*(\d{4}\s*)?(remaster(ed)?|live|acoustic|demo|mono|stereo|radio edit|single|album|instrumental|bonus|deluxe|anniversary|feat\.?|ft\.?|with\s+).*?[\)\]]/gi,
        ""
      )
      .replace(/\s+/g, " ")
      .trim();
  }

  function cleanArtistName(rawArtist) {
    if (!rawArtist) return "";
    return rawArtist.split(",")[0].trim();
  }

  function normalizeForMatch(str) {
    return stripDiacritics(str)
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function slugify(str) {
    return stripDiacritics(str)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  function escapeHtml(str) {
    return (str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function getCurrentTrackInfo() {
    const item = Spicetify.Player?.data?.item;
    if (!item) return null;

    const meta = item.metadata || {};
    const rawTitle = item.name || meta.title || "";
    const rawArtist =
      (Array.isArray(item.artists) && item.artists.map((a) => a.name).join(", ")) ||
      meta.artist_name ||
      meta.album_artist_name ||
      "";

    if (!rawTitle) return null;

    const cleanTitle = cleanTrackTitle(rawTitle) || rawTitle;
    const cleanArtist = cleanArtistName(rawArtist) || rawArtist;
    const asciiArtist = stripDiacritics(cleanArtist);
    const asciiTitle = stripDiacritics(cleanTitle);
    const searchQuery = [asciiArtist, asciiTitle].filter(Boolean).join(" ").trim();

    const storageKey = `${STORAGE_PREFIX}${normalizeForMatch(cleanArtist)}::${normalizeForMatch(cleanTitle)}`;
    const legacyKey = `${LEGACY_PREFIX}${rawArtist}-${rawTitle}`;

    return {
      uri: item.uri || "",
      rawTitle,
      rawArtist,
      cleanTitle,
      cleanArtist,
      searchQuery,
      storageKey,
      legacyKey
    };
  }

  function buildFallbackUrls(track) {
    const q = encodeURIComponent(track.searchQuery);
    return {
      songsterrSearch: `https://www.songsterr.com/?pattern=${q}`,
      duckDuckGo: `https://duckduckgo.com/?q=${encodeURIComponent(`${track.searchQuery} guitar tab`)}`,
      ultimateGuitar: `https://www.ultimate-guitar.com/search.php?search_type=title&value=${q}`
    };
  }

  function getSongArtist(song) {
    if (typeof song?.artist === "string") return song.artist;
    if (typeof song?.artist?.name === "string") return song.artist.name;
    return "";
  }

  function getSongId(song) {
    return song?.songId ?? song?.id ?? null;
  }

  function scoreSongsterrCandidate(song, targetArtistNorm, targetTitleNorm) {
    const songTitle = normalizeForMatch(song?.title || "");
    const songArtist = normalizeForMatch(getSongArtist(song));
    if (!songTitle) return -1;

    let score = 0;
    if (songTitle === targetTitleNorm) score += 60;
    else if (songTitle.includes(targetTitleNorm) || targetTitleNorm.includes(songTitle)) score += 35;

    if (targetArtistNorm) {
      if (songArtist === targetArtistNorm) score += 60;
      else if (songArtist.includes(targetArtistNorm) || targetArtistNorm.includes(songArtist)) score += 35;
      else score -= 40;
    }

    return score;
  }

  async function fetchJsonWithTimeout(url, timeoutMs = 2500) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);
      if (!res.ok) return null;
      return await res.json();
    } catch (_) {
      clearTimeout(timeoutId);
      return null;
    }
  }

  async function querySongsterrApi(query) {
    const apiUrl = `https://www.songsterr.com/api/songs?pattern=${encodeURIComponent(query)}`;

    const directData = await fetchJsonWithTimeout(apiUrl, 2000);
    if (Array.isArray(directData)) return directData;

    const allOriginsUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(apiUrl)}`;
    const allOriginsData = await fetchJsonWithTimeout(allOriginsUrl, 2500);
    if (Array.isArray(allOriginsData)) return allOriginsData;

    const corsProxyUrl = `https://corsproxy.io/?${encodeURIComponent(apiUrl)}`;
    const corsProxyData = await fetchJsonWithTimeout(corsProxyUrl, 2500);
    if (Array.isArray(corsProxyData)) return corsProxyData;

    if (Spicetify?.CosmosAsync?.get) {
      try {
        const cosmosRes = await Spicetify.CosmosAsync.get(apiUrl);
        if (Array.isArray(cosmosRes)) return cosmosRes;
        if (Array.isArray(cosmosRes?.body)) return cosmosRes.body;
      } catch (_) {}
    }

    return null;
  }

  async function resolveSongsterrUrl(track) {
    if (!track || !track.searchQuery) {
      return { url: "https://www.songsterr.com/", isDirect: false };
    }

    const cacheKey = track.storageKey;
    if (resolvedUrlCache.has(cacheKey)) {
      return resolvedUrlCache.get(cacheKey);
    }

    const fallbacks = buildFallbackUrls(track);
    const songs = await querySongsterrApi(track.searchQuery);

    if (Array.isArray(songs) && songs.length > 0) {
      const targetArtist = normalizeForMatch(track.cleanArtist);
      const targetTitle = normalizeForMatch(track.cleanTitle);

      let bestSong = null;
      let bestScore = 0;

      for (const song of songs.slice(0, 12)) {
        const s = scoreSongsterrCandidate(song, targetArtist, targetTitle);
        if (s > bestScore) {
          bestScore = s;
          bestSong = song;
        }
      }

      const bestId = getSongId(bestSong);
      if (bestSong && bestId && bestScore >= 50) {
        const artistSlug = slugify(getSongArtist(bestSong) || track.cleanArtist || "artist");
        const titleSlug = slugify(bestSong.title || track.cleanTitle || "song");
        const directUrl = `https://www.songsterr.com/a/wsa/${artistSlug}-${titleSlug}-tab-s${bestId}`;
        const result = { url: directUrl, isDirect: true };
        resolvedUrlCache.set(cacheKey, result);
        return result;
      }
    }

    const fallbackResult = { url: fallbacks.songsterrSearch, isDirect: false };
    resolvedUrlCache.set(cacheKey, fallbackResult);
    return fallbackResult;
  }

  function openExternalUrl(url) {
    try {
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (_) {
      if (Spicetify.Platform?.ExternalUrls?.open) {
        Spicetify.Platform.ExternalUrls.open(url);
      }
    }
  }

  function loadNotes(track) {
    if (!track) return "";
    const current = localStorage.getItem(track.storageKey);
    if (current !== null) {
      if (localStorage.getItem(track.legacyKey) !== null) {
        localStorage.removeItem(track.legacyKey);
      }
      return current;
    }

    const legacy = localStorage.getItem(track.legacyKey);
    if (legacy !== null) {
      localStorage.setItem(track.storageKey, legacy);
      localStorage.removeItem(track.legacyKey);
      return legacy;
    }
    return "";
  }

  function saveNotes(track, text) {
    if (!track) return;
    if (!text) {
      localStorage.removeItem(track.storageKey);
    } else {
      localStorage.setItem(track.storageKey, text);
    }
    if (localStorage.getItem(track.legacyKey) !== null) {
      localStorage.removeItem(track.legacyKey);
    }
  }

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      #${MODAL_ID},
      #${CHANGELOG_MODAL_ID} {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.74);
        backdrop-filter: blur(4px);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 99999;
        padding: 16px;
        font-family: var(--font-family, CircularSp, system-ui, -apple-system, sans-serif);
      }
      #${CHANGELOG_MODAL_ID} {
        z-index: 100000;
      }
      .sgt-card {
        width: 100%;
        max-width: 580px;
        background: #181818;
        color: #ffffff;
        border: 1px solid rgba(255, 255, 255, 0.12);
        border-radius: 12px;
        box-shadow: 0 20px 50px rgba(0, 0, 0, 0.65);
        padding: 20px 22px;
        display: flex;
        flex-direction: column;
        gap: 14px;
        max-height: 88vh;
        overflow-y: auto;
      }
      .sgt-changelog-card {
        max-width: 520px;
      }
      .sgt-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
      }
      .sgt-title {
        font-size: 18px;
        font-weight: 700;
        margin: 0;
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
      }
      .sgt-badge {
        font-size: 11px;
        font-weight: 600;
        padding: 2px 8px;
        border-radius: 999px;
        background: rgba(29, 185, 84, 0.16);
        color: #1db954;
      }
      .sgt-version-pill {
        font-size: 11px;
        font-weight: 600;
        padding: 2px 8px;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.08);
        color: #b3b3b3;
        border: 1px solid rgba(255, 255, 255, 0.12);
        cursor: pointer;
      }
      .sgt-version-pill:hover {
        color: #ffffff;
        background: rgba(255, 255, 255, 0.15);
      }
      .sgt-close {
        background: transparent;
        border: none;
        color: #b3b3b3;
        font-size: 22px;
        line-height: 1;
        cursor: pointer;
        padding: 4px 8px;
        border-radius: 6px;
      }
      .sgt-close:hover {
        color: #ffffff;
        background: rgba(255, 255, 255, 0.1);
      }
      .sgt-now-playing {
        font-size: 13px;
        color: #b3b3b3;
        background: #222222;
        padding: 10px 12px;
        border-radius: 8px;
        border: 1px solid rgba(255, 255, 255, 0.06);
      }
      .sgt-now-playing strong {
        color: #ffffff;
      }
      .sgt-actions-row {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        align-items: center;
      }
      .sgt-btn-primary {
        background: #1db954;
        color: #000000;
        border: none;
        border-radius: 8px;
        padding: 9px 14px;
        font-size: 13px;
        font-weight: 700;
        cursor: pointer;
        transition: transform 0.08s ease, background 0.15s ease;
      }
      .sgt-btn-primary:hover:not(:disabled) {
        background: #1ed760;
      }
      .sgt-btn-primary:disabled {
        opacity: 0.45;
        cursor: not-allowed;
      }
      #sgt-open-songsterr {
        background: #0077cc;
        color: #ffffff;
      }
      #sgt-open-songsterr:hover:not(:disabled) {
        background: #148be0;
      }
      .sgt-btn-secondary {
        background: #2a2a2a;
        color: #e5e5e5;
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 8px;
        padding: 8px 11px;
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
      }
      .sgt-btn-secondary:hover:not(:disabled) {
        background: #363636;
        color: #ffffff;
      }
      .sgt-btn-secondary:disabled {
        opacity: 0.45;
        cursor: not-allowed;
      }
      #sgt-open-ug {
        background: #FFD706;
        color: #000000;
        border-color: #FFD706;
        font-weight: 700;
      }
      #sgt-open-ug:hover:not(:disabled) {
        background: #ffe033;
        border-color: #ffe033;
        color: #000000;
      }
      .sgt-url-box {
        background: #121212;
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 6px;
        padding: 7px 10px;
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
        font-size: 11px;
        color: #9e9e9e;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .sgt-notes-toolbar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        flex-wrap: wrap;
      }
      .sgt-notes-label {
        font-size: 12px;
        font-weight: 600;
        color: #d4d4d4;
      }
      .sgt-notes-status {
        font-size: 11px;
        color: #1db954;
        margin-left: 6px;
      }
      .sgt-notes-tools {
        display: flex;
        gap: 6px;
      }
      .sgt-textarea {
        width: 100%;
        min-height: 210px;
        resize: vertical;
        background: #121212;
        color: #f1f1f1;
        border: 1px solid rgba(255, 255, 255, 0.14);
        border-radius: 8px;
        padding: 12px;
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
        font-size: 12.5px;
        line-height: 1.45;
        box-sizing: border-box;
        outline: none;
      }
      .sgt-textarea:focus {
        border-color: #1db954;
      }
      .sgt-cl-section {
        background: #202020;
        border: 1px solid rgba(255, 255, 255, 0.07);
        border-radius: 10px;
        padding: 12px 14px;
      }
      .sgt-cl-heading {
        font-size: 12px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        margin: 0 0 8px 0;
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .sgt-cl-heading-added {
        color: #1db954;
      }
      .sgt-cl-heading-fixed {
        color: #60a5fa;
      }
      .sgt-cl-list {
        margin: 0;
        padding-left: 18px;
        display: flex;
        flex-direction: column;
        gap: 6px;
        font-size: 13px;
        line-height: 1.45;
        color: #e0e0e0;
      }
      .sgt-cl-footer {
        display: flex;
        justify-content: flex-end;
      }
    `;
    document.head.appendChild(style);
  }

  function closeChangelogModal() {
    const existing = document.getElementById(CHANGELOG_MODAL_ID);
    if (existing) existing.remove();
  }

  function openChangelogModal() {
    injectStyles();
    closeChangelogModal();
    localStorage.setItem(VERSION_STORAGE_KEY, EXTENSION_VERSION);

    const overlay = document.createElement("div");
    overlay.id = CHANGELOG_MODAL_ID;
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) closeChangelogModal();
    });

    const addedItems = CHANGELOG.added
      .map((item) => `<li>${escapeHtml(item)}</li>`)
      .join("");
    const fixedItems = CHANGELOG.fixed
      .map((item) => `<li>${escapeHtml(item)}</li>`)
      .join("");

    overlay.innerHTML = `
      <div class="sgt-card sgt-changelog-card" role="dialog" aria-modal="true" aria-label="What's New in Guitar Tabs">
        <div class="sgt-header">
          <h2 class="sgt-title">
            ${escapeHtml(CHANGELOG.title)}
            <span class="sgt-badge">v${escapeHtml(CHANGELOG.version)}</span>
          </h2>
          <button class="sgt-close" id="sgt-cl-close-btn" title="Close">&times;</button>
        </div>

        <div class="sgt-cl-section">
          <h3 class="sgt-cl-heading sgt-cl-heading-added">What's Added</h3>
          <ul class="sgt-cl-list">${addedItems}</ul>
        </div>

        <div class="sgt-cl-section">
          <h3 class="sgt-cl-heading sgt-cl-heading-fixed">Bugs Solved</h3>
          <ul class="sgt-cl-list">${fixedItems}</ul>
        </div>

        <div class="sgt-cl-footer">
          <button class="sgt-btn-primary" id="sgt-cl-ack-btn">Got it</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    const closeBtn = document.getElementById("sgt-cl-close-btn");
    const ackBtn = document.getElementById("sgt-cl-ack-btn");
    closeBtn.addEventListener("click", closeChangelogModal);
    ackBtn.addEventListener("click", closeChangelogModal);
  }

  const SIX_STRING_TEMPLATE = [
    "e|-----------------------------------------|",
    "B|-----------------------------------------|",
    "G|-----------------------------------------|",
    "D|-----------------------------------------|",
    "A|-----------------------------------------|",
    "E|-----------------------------------------|",
    ""
  ].join("\n");

  function closeModal() {
    const existing = document.getElementById(MODAL_ID);
    if (existing) existing.remove();
    document.removeEventListener("keydown", handleGlobalKeydown);
  }

  function handleGlobalKeydown(e) {
    if (e.key === "Escape") {
      if (document.getElementById(CHANGELOG_MODAL_ID)) {
        closeChangelogModal();
      } else {
        closeModal();
      }
    }
  }

  async function openModal() {
    injectStyles();
    closeModal();

    const overlay = document.createElement("div");
    overlay.id = MODAL_ID;
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) closeModal();
    });

    overlay.innerHTML = `
      <div class="sgt-card" role="dialog" aria-modal="true" aria-label="Guitar Tabs">
        <div class="sgt-header">
          <h2 class="sgt-title">
            Guitar Tabs
            <span class="sgt-badge" id="sgt-match-badge">Ready</span>
            <button class="sgt-version-pill" id="sgt-version-btn" title="View changelog">v${escapeHtml(EXTENSION_VERSION)}</button>
          </h2>
          <button class="sgt-close" id="sgt-close-btn" title="Close (Esc)">&times;</button>
        </div>

        <div class="sgt-now-playing" id="sgt-now-playing">Checking current track...</div>

        <div class="sgt-actions-row">
          <button class="sgt-btn-primary" id="sgt-open-songsterr">Open on Songsterr</button>
          <button class="sgt-btn-secondary" id="sgt-open-ug" title="Search on Ultimate Guitar">Ultimate Guitar</button>
          <button class="sgt-btn-secondary" id="sgt-open-ddg" title="Search the web for guitar tabs">Web Search</button>
        </div>

        <div class="sgt-url-box" id="sgt-url-preview">https://www.songsterr.com/</div>

        <div class="sgt-notes-toolbar">
          <div>
            <span class="sgt-notes-label">Saved Tabs / Notes (auto-saved per song)</span>
            <span class="sgt-notes-status" id="sgt-save-status"></span>
          </div>
          <div class="sgt-notes-tools">
            <button class="sgt-btn-secondary" id="sgt-insert-staff" title="Insert blank 6-string ASCII tab">+ 6-String Tab</button>
            <button class="sgt-btn-secondary" id="sgt-copy-notes">Copy</button>
            <button class="sgt-btn-secondary" id="sgt-clear-notes">Clear</button>
          </div>
        </div>

        <textarea
          class="sgt-textarea"
          id="sgt-notes-area"
          spellcheck="false"
          placeholder="Write guitar tabs, chords, tuning, or notes here..."
        ></textarea>
      </div>
    `;

    document.body.appendChild(overlay);
    document.addEventListener("keydown", handleGlobalKeydown);

    const closeBtn = document.getElementById("sgt-close-btn");
    const versionBtn = document.getElementById("sgt-version-btn");
    const nowPlayingEl = document.getElementById("sgt-now-playing");
    const badgeEl = document.getElementById("sgt-match-badge");
    const primaryBtn = document.getElementById("sgt-open-songsterr");
    const ugBtn = document.getElementById("sgt-open-ug");
    const ddgBtn = document.getElementById("sgt-open-ddg");
    const urlPreviewEl = document.getElementById("sgt-url-preview");
    const textarea = document.getElementById("sgt-notes-area");
    const saveStatusEl = document.getElementById("sgt-save-status");
    const insertStaffBtn = document.getElementById("sgt-insert-staff");
    const copyBtn = document.getElementById("sgt-copy-notes");
    const clearBtn = document.getElementById("sgt-clear-notes");

    let activeTrack = null;
    let activeUrls = {
      primary: "https://www.songsterr.com/",
      ultimateGuitar: "https://www.ultimate-guitar.com/",
      duckDuckGo: "https://duckduckgo.com/?q=guitar+tabs"
    };
    let clearConfirmTimer = null;

    async function syncTrackView() {
      activeTrack = getCurrentTrackInfo();

      if (!activeTrack) {
        nowPlayingEl.textContent = "Nothing currently playing — start a track in Spotify to look up tabs.";
        badgeEl.textContent = "No Track";
        urlPreviewEl.textContent = "https://www.songsterr.com/";
        primaryBtn.textContent = "Open Songsterr";
        activeUrls = {
          primary: "https://www.songsterr.com/",
          ultimateGuitar: "https://www.ultimate-guitar.com/",
          duckDuckGo: "https://duckduckgo.com/?q=guitar+tabs"
        };
        textarea.value = "";
        textarea.disabled = true;
        return;
      }

      textarea.disabled = false;
      nowPlayingEl.innerHTML = `Now Playing: <strong>${escapeHtml(activeTrack.rawTitle)}</strong>${
        activeTrack.rawArtist ? ` — ${escapeHtml(activeTrack.rawArtist)}` : ""
      }`;

      const fallbacks = buildFallbackUrls(activeTrack);
      activeUrls.primary = fallbacks.songsterrSearch;
      activeUrls.ultimateGuitar = fallbacks.ultimateGuitar;
      activeUrls.duckDuckGo = fallbacks.duckDuckGo;

      badgeEl.textContent = "Matching...";
      primaryBtn.textContent = "Open on Songsterr";
      urlPreviewEl.textContent = fallbacks.songsterrSearch;

      textarea.value = loadNotes(activeTrack);
      saveStatusEl.textContent = textarea.value ? "Loaded" : "";

      const snapshotKey = activeTrack.storageKey;
      const resolved = await resolveSongsterrUrl(activeTrack);

      if (!activeTrack || activeTrack.storageKey !== snapshotKey) return;

      activeUrls.primary = resolved.url;
      urlPreviewEl.textContent = resolved.url;
      if (resolved.isDirect) {
        badgeEl.textContent = "Direct Tab";
        primaryBtn.textContent = "Open on Songsterr (direct tab)";
      } else {
        badgeEl.textContent = "Songsterr Search";
        primaryBtn.textContent = "Search on Songsterr";
      }
    }

    closeBtn.addEventListener("click", closeModal);
    versionBtn.addEventListener("click", openChangelogModal);
    primaryBtn.addEventListener("click", () => openExternalUrl(activeUrls.primary));
    ugBtn.addEventListener("click", () => openExternalUrl(activeUrls.ultimateGuitar));
    ddgBtn.addEventListener("click", () => openExternalUrl(activeUrls.duckDuckGo));

    textarea.addEventListener("input", () => {
      if (!activeTrack) return;
      saveNotes(activeTrack, textarea.value);
      saveStatusEl.textContent = "Saved";
    });

    textarea.addEventListener("keydown", (e) => {
      if (e.key === "Tab") {
        e.preventDefault();
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        textarea.value =
          textarea.value.substring(0, start) + "  " + textarea.value.substring(end);
        textarea.selectionStart = textarea.selectionEnd = start + 2;
        if (activeTrack) {
          saveNotes(activeTrack, textarea.value);
          saveStatusEl.textContent = "Saved";
        }
      }
    });

    insertStaffBtn.addEventListener("click", () => {
      if (!activeTrack) return;
      const prefix = textarea.value && !textarea.value.endsWith("\n") ? "\n\n" : "";
      textarea.value += prefix + SIX_STRING_TEMPLATE;
      saveNotes(activeTrack, textarea.value);
      saveStatusEl.textContent = "Saved";
      textarea.focus();
    });

    copyBtn.addEventListener("click", async () => {
      if (!textarea.value) return;
      try {
        await navigator.clipboard.writeText(textarea.value);
        copyBtn.textContent = "Copied!";
        setTimeout(() => (copyBtn.textContent = "Copy"), 1500);
      } catch (_) {
        textarea.select();
        document.execCommand("copy");
      }
    });

    clearBtn.addEventListener("click", () => {
      if (!activeTrack || !textarea.value) return;
      if (clearBtn.dataset.armed !== "true") {
        clearBtn.dataset.armed = "true";
        clearBtn.textContent = "Confirm Clear?";
        clearConfirmTimer = setTimeout(() => {
          clearBtn.dataset.armed = "false";
          clearBtn.textContent = "Clear";
        }, 2500);
        return;
      }
      clearTimeout(clearConfirmTimer);
      clearBtn.dataset.armed = "false";
      clearBtn.textContent = "Clear";
      textarea.value = "";
      saveNotes(activeTrack, "");
      saveStatusEl.textContent = "Cleared";
    });

    const onSongChange = () => {
      if (document.getElementById(MODAL_ID)) {
        syncTrackView();
      } else {
        Spicetify.Player.removeEventListener("songchange", onSongChange);
      }
    };
    Spicetify.Player.addEventListener("songchange", onSongChange);

    await syncTrackView();
  }

  const GUITAR_ICON_SVG = `
    <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true">
      <path d="M12.5 1.5a.75.75 0 0 1 .53.22l1.25 1.25a.75.75 0 0 1 0 1.06l-1.1 1.1a.75.75 0 0 1-1.06 0l-.19-.19-2.22 2.22a3.75 3.75 0 0 1-.82 4.11l-.96.96a3.5 3.5 0 0 1-4.95-4.95l.96-.96a3.75 3.75 0 0 1 4.11-.82l2.22-2.22-.19-.19a.75.75 0 0 1 0-1.06l1.1-1.1a.75.75 0 0 1 .53-.22zM5.6 8.6a2 2 0 1 0 2.8 2.8 2 2 0 0 0-2.8-2.8z"/>
    </svg>
  `;

  new Spicetify.Topbar.Button(
    "Guitar Tabs",
    GUITAR_ICON_SVG,
    openModal,
    false
  );

  const lastSeenVersion = localStorage.getItem(VERSION_STORAGE_KEY);
  if (lastSeenVersion !== EXTENSION_VERSION) {
    setTimeout(() => {
      document.addEventListener("keydown", handleGlobalKeydown);
      openChangelogModal();
    }, 1500);
  }
})();
