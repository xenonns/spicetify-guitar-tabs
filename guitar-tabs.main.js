(async function GuitarTabsExtension() {
  if (window.__spicetifyGuitarTabsLoaded) return;

  const initStart = Date.now();
  while (!window.Spicetify?.Player || !Spicetify.Platform || !Spicetify.Topbar || !document.body) {
    if (Date.now() - initStart > 30000) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  window.__spicetifyGuitarTabsLoaded = true;

  const EXTENSION_VERSION = "2.2.0";
  const VERSION_KEY = "spicetify-guitar-tabs:last-seen-version";
  const STORAGE_PREFIX = "spicetify-guitar-tabs:v2:";
  const RIG_PREFIX = "spicetify-guitar-tabs:v2:rig:";
  const LEGACY_PREFIX = "guitar-tabs-";
  const STYLE_ID = "sgt-styles";
  const MODAL_ID = "sgt-modal-overlay";
  const CL_MODAL_ID = "sgt-changelog-overlay";
  const NEGATIVE_TTL_MS = 120000;

  const CHANGELOG = {
    version: EXTENSION_VERSION,
    title: "Guitar Tabs Studio Update",
    added: [
      "Bass E1 (41.2 Hz) pitch detection support with a 4096-sample YIN analysis window and target-string comparison.",
      "Full keyboard Tab focus trapping and focus restoration across both modals, plus automatic tuner silence reset."
    ],
    fixed: [
      "Fixed microphone startup/close race conditions using session generation tokens and guaranteed stream cleanup.",
      "Fixed YIN cumulative mean normalization from lag 1 and eliminated duplicate tab openings on external links."
    ]
  };

  const TUNINGS = {
    "E Standard": [{ label: "E2", freq: 82.41 }, { label: "A2", freq: 110.0 }, { label: "D3", freq: 146.83 }, { label: "G3", freq: 196.0 }, { label: "B3", freq: 246.94 }, { label: "E4", freq: 329.63 }],
    "Drop D": [{ label: "D2", freq: 73.42 }, { label: "A2", freq: 110.0 }, { label: "D3", freq: 146.83 }, { label: "G3", freq: 196.0 }, { label: "B3", freq: 246.94 }, { label: "E4", freq: 329.63 }],
    "Eb Standard": [{ label: "Eb2", freq: 77.78 }, { label: "Ab2", freq: 103.83 }, { label: "Db3", freq: 138.59 }, { label: "Gb3", freq: 185.0 }, { label: "Bb3", freq: 233.08 }, { label: "Eb4", freq: 311.13 }],
    "D Standard": [{ label: "D2", freq: 73.42 }, { label: "G2", freq: 98.0 }, { label: "C3", freq: 130.81 }, { label: "F3", freq: 174.61 }, { label: "A3", freq: 220.0 }, { label: "D4", freq: 293.66 }],
    "Drop C": [{ label: "C2", freq: 65.41 }, { label: "G2", freq: 98.0 }, { label: "C3", freq: 130.81 }, { label: "F3", freq: 174.61 }, { label: "A3", freq: 220.0 }, { label: "D4", freq: 293.66 }],
    "Bass (4-Str)": [{ label: "E1", freq: 41.2 }, { label: "A1", freq: 55.0 }, { label: "D2", freq: 73.42 }, { label: "G2", freq: 98.0 }]
  };

  const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const TONE_PRESETS = [
    { match: /(thrash|death|metalcore|djent|heavy metal|speed metal|doom|sludge|metal)/i, label: "High-Gain Metal", tuning: "E Standard / Drop D", amp: "Mesa Rectifier / 5150 — Gain 8.5 | Bass 7 | Mid 4 | Treb 7.5", pedals: "Tube Screamer (Drive 0, Level 10) + Noise Gate" },
    { match: /(punk|pop punk|skate punk|hardcore|grunge|garage)/i, label: "Punk / Grunge Crunch", tuning: "E Standard / Eb Standard", amp: "Marshall JCM800 — Gain 7.5 | Bass 6.5 | Mid 6.5 | Treb 7", pedals: "ProCo RAT or Boss DS-1 Distortion" },
    { match: /(hard rock|classic rock|glam|arena rock|southern rock|stoner)/i, label: "Classic / Hard Rock", tuning: "E Standard", amp: "Marshall Plexi — Gain 6.5 | Bass 6 | Mid 7 | Treb 6.5", pedals: "Warm Overdrive + Subtle Tape Echo" },
    { match: /(blues|soul|funk|r&b|jazz|country)/i, label: "Edge-of-Breakup Clean", tuning: "E Standard", amp: "Fender Twin / Deluxe — Gain 4 | Bass 5.5 | Mid 6.5 | Treb 6", pedals: "TS808 Overdrive + Spring Reverb" },
    { match: /(indie|shoegaze|dream pop|post-punk|alternative|surf|new wave)/i, label: "Chimey Indie / Alt", tuning: "E Standard", amp: "Vox AC30 / JC-120 — Gain 3.5 | Bass 5 | Mid 6 | Treb 7", pedals: "Analog Chorus + Dotted-8th Delay + Hall Reverb" }
  ];
  const DEFAULT_PRESET = { label: "Versatile Rock Crunch", tuning: "E Standard", amp: "British Crunch — Gain 5.5 | Bass 6 | Mid 6 | Treb 6.5", pedals: "Light Overdrive + Room Reverb" };
  const TAB_TEMPLATES = {
    six: "e|-----------------------------------------|\nB|-----------------------------------------|\nG|-----------------------------------------|\nD|-----------------------------------------|\nA|-----------------------------------------|\nE|-----------------------------------------|",
    seven: "e|-----------------------------------------|\nB|-----------------------------------------|\nG|-----------------------------------------|\nD|-----------------------------------------|\nA|-----------------------------------------|\nE|-----------------------------------------|\nB|-----------------------------------------|",
    bass: "G|-----------------------------------------|\nD|-----------------------------------------|\nA|-----------------------------------------|\nE|-----------------------------------------|"
  };

  const songsterrCache = new Map();
  const ugCache = new Map();
  const inFlightSongsterr = new Map();
  const inFlightUg = new Map();
  const artistGenreCache = new Map();

  let prefetchTimer = null;
  let activeAudioCtx = null;
  let activeMicStream = null;
  let tunerAnimFrame = null;
  let isMicRunning = false;
  let micSessionGen = 0;
  let activeSongChangeHandler = null;
  let prevModalFocus = null;
  let prevClFocus = null;

  const safeGet = (k) => { try { return localStorage.getItem(k); } catch (_) { return null; } };
  const safeSet = (k, v) => { try { localStorage.setItem(k, v); return true; } catch (_) { return false; } };
  const safeDel = (k) => { try { localStorage.removeItem(k); return true; } catch (_) { return false; } };

  const stripDiacritics = (s) => (s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const escapeHtml = (s) => (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const normalizeForMatch = (s) => (s || "").normalize("NFC").toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();

  function cleanTrackTitle(raw) {
    return (raw || "")
      .replace(/\s*[-–—]\s*(\d{4}\s*)?(remaster(ed)?|live|acoustic|demo|mono|stereo|radio edit|single version|album version|instrumental|bonus track|deluxe|anniversary|explicit|clean).*$/i, "")
      .replace(/\s*[\(\[]\s*(\d{4}\s*)?(remaster(ed)?|live|acoustic|demo|mono|stereo|radio edit|single|album|instrumental|bonus|deluxe|anniversary|feat\.?|ft\.?|with\s+).*?[\)\]]/gi, "")
      .replace(/\s+/g, " ").trim();
  }

  function slugify(s) {
    const ascii = stripDiacritics(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    if (ascii) return ascii;
    return (s || "").normalize("NFC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "") || "track";
  }

  function getCurrentTrackInfo() {
    const item = Spicetify.Player?.data?.item;
    if (!item) return null;
    const meta = item.metadata || {};
    const rawTitle = item.name || meta.title || "";
    const rawArtist = (Array.isArray(item.artists) && item.artists.map((a) => a.name).join(", ")) || meta.artist_name || meta.album_artist_name || "";
    if (!rawTitle) return null;

    const cleanTitle = cleanTrackTitle(rawTitle) || rawTitle;
    const cleanArtist = rawArtist.split(",")[0].trim() || rawArtist;
    const searchQuery = [stripDiacritics(cleanArtist), stripDiacritics(cleanTitle)].filter(Boolean).join(" ").trim();
    const baseNorm = `${normalizeForMatch(cleanArtist)}::${normalizeForMatch(cleanTitle)}`;

    return {
      primaryArtistUri: (Array.isArray(item.artists) && item.artists[0]?.uri) || meta.artist_uri || "",
      rawTitle,
      rawArtist,
      cleanTitle,
      cleanArtist,
      searchQuery,
      storageKey: `${STORAGE_PREFIX}${baseNorm}`,
      rigKey: `${RIG_PREFIX}${baseNorm}`,
      legacyKey: `${LEGACY_PREFIX}${rawArtist}-${rawTitle}`
    };
  }

  function buildFallbackUrls(track) {
    const q = encodeURIComponent(track.searchQuery);
    return {
      songsterrSearch: `https://www.songsterr.com/?pattern=${q}`,
      ultimateGuitarSearch: `https://www.ultimate-guitar.com/search.php?search_type=title&value=${q}`,
      webSearch: `https://duckduckgo.com/?q=${encodeURIComponent(`${track.searchQuery} guitar tab`)}`
    };
  }

  async function detectToneSuggestion(track) {
    if (!track) return { genreText: "General", preset: DEFAULT_PRESET };
    const artistId = (track.primaryArtistUri || "").split(":")[2] || "";
    let genres = artistGenreCache.get(artistId) || [];

    if (artistId && !artistGenreCache.has(artistId) && Spicetify?.CosmosAsync?.get) {
      try {
        const data = await Spicetify.CosmosAsync.get(`https://api.spotify.com/v1/artists/${artistId}`);
        if (Array.isArray(data?.genres)) {
          genres = data.genres;
          artistGenreCache.set(artistId, genres);
        }
      } catch (_) {}
    }

    const joined = genres.join(", ");
    const preset = TONE_PRESETS.find((p) => p.match.test(joined)) || DEFAULT_PRESET;
    return { genreText: genres.slice(0, 2).join(" • ") || preset.label, preset };
  }

  function extractSongList(payload) {
    let data = payload;
    if (typeof data === "string") {
      try { data = JSON.parse(data); } catch (_) { return null; }
    }
    if (!data) return null;
    if (data.body !== undefined) return extractSongList(data.body);
    return Array.isArray(data) ? data : (data.records || data.songs || data.results || data.data || null);
  }

  async function fetchTextWithTimeout(url, timeoutMs = 4000) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: controller.signal });
      return res.ok ? await res.text() : null;
    } catch (_) {
      return null;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async function fetchViaAllOrigins(targetUrl, timeoutMs = 4000) {
    const raw = await fetchTextWithTimeout(`https://api.allorigins.win/get?url=${encodeURIComponent(targetUrl)}`, timeoutMs);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      return typeof parsed?.contents === "string" ? parsed.contents : null;
    } catch (_) {
      return null;
    }
  }

  async function runBoundedRelay(targetUrl, validatorFn, timeoutMs = 4000) {
    const relays = [
      () => fetchViaAllOrigins(targetUrl, timeoutMs),
      () => fetchTextWithTimeout(`https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(targetUrl)}`, timeoutMs),
      () => fetchTextWithTimeout(`https://corsproxy.io/?url=${encodeURIComponent(targetUrl)}`, timeoutMs)
    ];
    for (let i = 0; i < relays.length; i += 2) {
      const results = await Promise.all(relays.slice(i, i + 2).map((fn) => fn()));
      for (const text of results) {
        const hit = validatorFn(text);
        if (hit) return hit;
      }
    }
    return null;
  }

  function matchBestSongsterrUrl(text, track) {
    const songs = extractSongList(text);
    if (!Array.isArray(songs) || !songs.length) return null;
    const targetArtist = normalizeForMatch(track.cleanArtist);
    const targetTitle = normalizeForMatch(track.cleanTitle);

    let bestSong = null;
    let bestScore = 0;
    for (const song of songs.slice(0, 12)) {
      const title = normalizeForMatch(song?.title || "");
      const artist = normalizeForMatch(typeof song?.artist === "string" ? song.artist : (song?.artist?.name || ""));
      if (!title) continue;
      let score = title === targetTitle ? 60 : (title.includes(targetTitle) || targetTitle.includes(title) ? 35 : 0);
      if (targetArtist) {
        score += artist === targetArtist ? 60 : (artist.includes(targetArtist) || targetArtist.includes(artist) ? 35 : -40);
      }
      if (score > bestScore) { bestScore = score; bestSong = song; }
    }

    const bestId = bestSong?.songId ?? bestSong?.id ?? null;
    if (bestSong && bestId && bestScore >= 50) {
      const rawArt = typeof bestSong.artist === "string" ? bestSong.artist : (bestSong.artist?.name || track.cleanArtist || "artist");
      return `https://www.songsterr.com/a/wsa/${slugify(rawArt)}-${slugify(bestSong.title || track.cleanTitle || "song")}-tab-s${bestId}`;
    }
    return null;
  }

  async function resolveDirectUrlViaSearch(query, urlPattern) {
    const ddgLiteUrl = `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`;
    return await runBoundedRelay(ddgLiteUrl, (html) => {
      if (!html || typeof html !== "string") return null;
      const urls = [];
      let m;
      const uddgRe = /uddg=([^&"'\s<>]+)/gi;
      while ((m = uddgRe.exec(html)) !== null) {
        try { urls.push(decodeURIComponent(m[1])); } catch (_) {}
      }
      const rawRe = /https?:\/\/[^\s"'<>]+/gi;
      while ((m = rawRe.exec(html)) !== null) urls.push(m[0].replace(/&amp;/g, "&"));

      for (const u of urls) {
        const clean = u.split("#")[0].split("?")[0];
        if (urlPattern.test(clean)) return clean;
      }
      return null;
    });
  }

  function getCachedEntry(map, key) {
    const entry = map.get(key);
    if (!entry) return null;
    if (entry.expiresAt && Date.now() > entry.expiresAt) { map.delete(key); return null; }
    return entry;
  }

  async function resolveSongsterrUrl(track) {
    if (!track?.searchQuery) return { url: "https://www.songsterr.com/", isDirect: false };
    const key = track.storageKey;
    const cached = getCachedEntry(songsterrCache, key);
    if (cached) return cached;
    if (inFlightSongsterr.has(key)) return await inFlightSongsterr.get(key);

    const job = (async () => {
      const fallbacks = buildFallbackUrls(track);
      const q = encodeURIComponent(track.searchQuery);
      const searchApi = `https://www.songsterr.com/api/search?pattern=${q}`;
      const songsApi = `https://www.songsterr.com/api/songs?size=20&pattern=${q}`;

      let directUrl = matchBestSongsterrUrl(await fetchTextWithTimeout(searchApi, 2200), track)
        || matchBestSongsterrUrl(await fetchTextWithTimeout(songsApi, 2200), track)
        || await runBoundedRelay(searchApi, (t) => matchBestSongsterrUrl(t, track))
        || await resolveDirectUrlViaSearch(`site:songsterr.com/a/wsa ${track.searchQuery}`, /^https?:\/\/(www\.)?songsterr\.com\/a\/wsa\/[a-z0-9-]+-tab-s\d+/i);

      const res = directUrl
        ? { url: directUrl, isDirect: true }
        : { url: fallbacks.songsterrSearch, isDirect: false, expiresAt: Date.now() + NEGATIVE_TTL_MS };
      songsterrCache.set(key, res);
      return res;
    })().finally(() => inFlightSongsterr.delete(key));

    inFlightSongsterr.set(key, job);
    return await job;
  }

  async function resolveUltimateGuitarUrl(track) {
    if (!track?.searchQuery) return { url: "https://www.ultimate-guitar.com/", isDirect: false };
    const key = track.storageKey;
    const cached = getCachedEntry(ugCache, key);
    if (cached) return cached;
    if (inFlightUg.has(key)) return await inFlightUg.get(key);

    const job = (async () => {
      const fallbacks = buildFallbackUrls(track);
      const directUrl = await resolveDirectUrlViaSearch(
        `site:tabs.ultimate-guitar.com/tab ${track.searchQuery}`,
        /^https?:\/\/tabs\.ultimate-guitar\.com\/tab\/[a-z0-9-]+\/[a-z0-9-]+-\d+/i
      );
      const res = directUrl
        ? { url: directUrl, isDirect: true }
        : { url: fallbacks.ultimateGuitarSearch, isDirect: false, expiresAt: Date.now() + NEGATIVE_TTL_MS };
      ugCache.set(key, res);
      return res;
    })().finally(() => inFlightUg.delete(key));

    inFlightUg.set(key, job);
    return await job;
  }

  function scheduleBackgroundPrefetch() {
    clearTimeout(prefetchTimer);
    prefetchTimer = setTimeout(() => {
      const track = getCurrentTrackInfo();
      if (!track) return;
      if (!getCachedEntry(songsterrCache, track.storageKey)) resolveSongsterrUrl(track);
      if (!getCachedEntry(ugCache, track.storageKey)) resolveUltimateGuitarUrl(track);
    }, 500);
  }

  function openExternalUrl(url) {
    if (Spicetify.Platform?.ExternalUrls?.open) {
      try {
        Spicetify.Platform.ExternalUrls.open(url);
        return;
      } catch (_) {}
    }
    try { window.open(url, "_blank", "noopener,noreferrer"); } catch (_) {}
  }

  async function handleTabButtonClick(btnEl, pendingPromise, getCurrentUrl, getFallbackUrl) {
    if (!pendingPromise) {
      openExternalUrl(getCurrentUrl());
      return;
    }

    const hasNativeBridge = Boolean(Spicetify.Platform?.ExternalUrls?.open);
    let popup = null;
    if (!hasNativeBridge) {
      try { popup = window.open("about:blank", "_blank"); } catch (_) {}
    }

    const prev = btnEl.textContent;
    btnEl.disabled = true;
    btnEl.textContent = "Matching...";
    try {
      await Promise.race([pendingPromise, new Promise((r) => setTimeout(r, 2500))]);
    } finally {
      btnEl.disabled = false;
      if (btnEl.textContent === "Matching...") btnEl.textContent = prev;
    }

    const targetUrl = getCurrentUrl() || getFallbackUrl();
    if (popup && !popup.closed) {
      try {
        popup.opener = null;
        popup.location.href = targetUrl;
        return;
      } catch (_) {}
    }
    openExternalUrl(targetUrl);
  }

  function loadNotes(track) {
    if (!track) return "";
    const cur = safeGet(track.storageKey);
    if (cur !== null) {
      if (safeGet(track.legacyKey) !== null) safeDel(track.legacyKey);
      return cur;
    }
    const leg = safeGet(track.legacyKey);
    if (leg !== null) {
      safeSet(track.storageKey, leg);
      safeDel(track.legacyKey);
      return leg;
    }
    return "";
  }

  function saveNotes(track, text) {
    if (!track) return false;
    const ok = text ? safeSet(track.storageKey, text) : safeDel(track.storageKey);
    if (safeGet(track.legacyKey) !== null) safeDel(track.legacyKey);
    return ok;
  }

  function loadRig(track) {
    const empty = { tuning: "", amp: "", pedals: "" };
    if (!track) return empty;
    const raw = safeGet(track.rigKey);
    if (!raw) return empty;
    try {
      const p = JSON.parse(raw);
      if (!p || typeof p !== "object" || Array.isArray(p)) return empty;
      return {
        tuning: typeof p.tuning === "string" ? p.tuning : "",
        amp: typeof p.amp === "string" ? p.amp : "",
        pedals: typeof p.pedals === "string" ? p.pedals : ""
      };
    } catch (_) {
      return empty;
    }
  }

  function saveRig(track, rig) {
    if (!track || !rig) return false;
    return (!rig.tuning && !rig.amp && !rig.pedals) ? safeDel(track.rigKey) : safeSet(track.rigKey, JSON.stringify(rig));
  }

  function detectPitchYIN(buffer, sampleRate) {
    const halfLen = Math.floor(buffer.length / 2);
    let rms = 0;
    for (let i = 0; i < buffer.length; i++) rms += buffer[i] * buffer[i];
    if (Math.sqrt(rms / buffer.length) < 0.015) return -1;

    const minLag = Math.max(2, Math.floor(sampleRate / 1200));
    const maxLag = Math.min(halfLen - 1, Math.floor(sampleRate / 35));
    if (maxLag <= minLag) return -1;

    const yin = new Float32Array(maxLag + 1);
    yin[0] = 1;
    let runningSum = 0;

    for (let tau = 1; tau <= maxLag; tau++) {
      let sum = 0;
      for (let i = 0; i < halfLen; i++) {
        const d = buffer[i] - buffer[i + tau];
        sum += d * d;
      }
      runningSum += sum;
      yin[tau] = runningSum > 0 ? (sum * tau) / runningSum : 1;
    }

    let tauEst = -1;
    for (let tau = minLag; tau <= maxLag; tau++) {
      if (yin[tau] < 0.15) {
        while (tau + 1 <= maxLag && yin[tau + 1] < yin[tau]) tau++;
        tauEst = tau;
        break;
      }
    }
    if (tauEst === -1) return -1;

    let betterTau = tauEst;
    if (tauEst > minLag && tauEst < maxLag) {
      const s0 = yin[tauEst - 1], s1 = yin[tauEst], s2 = yin[tauEst + 1];
      const denom = 2 * (2 * s1 - s2 - s0);
      if (denom !== 0) betterTau = tauEst + (s2 - s0) / denom;
    }

    const freq = sampleRate / betterTau;
    return freq >= 35 && freq <= 1200 ? freq : -1;
  }

  function evaluatePitchAgainstTuning(freq, tuningNotes) {
    let best = null;
    let minAbs = Infinity;
    for (const target of tuningNotes || []) {
      const diff = 1200 * Math.log2(freq / target.freq);
      if (Math.abs(diff) < minAbs) {
        minAbs = Math.abs(diff);
        best = { label: target.label, targetFreq: target.freq, cents: Math.round(diff) };
      }
    }
    if (best && minAbs <= 150) {
      return { note: best.label, targetLabel: `${best.label} (${best.targetFreq.toFixed(1)} Hz)`, cents: best.cents, freq: freq.toFixed(1) };
    }
    const noteNum = 12 * Math.log2(freq / 440);
    const rounded = Math.round(noteNum);
    const midi = rounded + 69;
    const label = `${NOTE_NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
    return { note: label, targetLabel: `Chromatic: ${label}`, cents: Math.round((noteNum - rounded) * 100), freq: freq.toFixed(1) };
  }

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      #${MODAL_ID}, #${CL_MODAL_ID} { position:fixed; inset:0; background:rgba(0,0,0,.78); backdrop-filter:blur(6px); display:flex; align-items:center; justify-content:center; z-index:99999; padding:16px; font-family:var(--font-family,CircularSp,system-ui,-apple-system,sans-serif); }
      #${CL_MODAL_ID} { z-index:100000; }
      .sgt-card { width:100%; max-width:640px; background:linear-gradient(180deg,#1e1e1e 0%,#141414 100%); color:#fff; border:1px solid rgba(255,255,255,.12); border-radius:14px; box-shadow:0 24px 60px rgba(0,0,0,.75); padding:20px 22px; display:flex; flex-direction:column; gap:12px; max-height:90vh; overflow-y:auto; }
      .sgt-card.sgt-expanded { width:95vw; max-width:1440px; height:92vh; max-height:92vh; overflow:hidden; }
      .sgt-changelog-card { max-width:520px; }
      .sgt-header, .sgt-panel-head, .sgt-notes-toolbar { display:flex; align-items:center; justify-content:space-between; gap:8px; flex-wrap:wrap; flex-shrink:0; }
      .sgt-header-controls, .sgt-actions-row, .sgt-studio-tabs, .sgt-strings-row, .sgt-notes-tools { display:flex; align-items:center; gap:6px; flex-wrap:wrap; }
      .sgt-title { font-size:18px; font-weight:700; margin:0; display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
      .sgt-badge { font-size:11px; font-weight:600; padding:2px 9px; border-radius:999px; background:rgba(29,185,84,.16); color:#1db954; }
      .sgt-version-pill { font-size:11px; font-weight:600; padding:2px 8px; border-radius:999px; background:rgba(255,255,255,.08); color:#b3b3b3; border:1px solid rgba(255,255,255,.12); cursor:pointer; }
      .sgt-version-pill:hover { color:#fff; background:rgba(255,255,255,.15); }
      .sgt-icon-btn { background:rgba(255,255,255,.06); border:1px solid rgba(255,255,255,.1); color:#ccc; font-size:15px; line-height:1; cursor:pointer; padding:5px 9px; border-radius:7px; }
      .sgt-icon-btn:hover { color:#fff; background:rgba(255,255,255,.14); }
      .sgt-workspace { display:flex; flex-direction:column; gap:12px; min-height:0; }
      .sgt-card.sgt-expanded .sgt-workspace { display:grid; grid-template-columns:420px 1fr; gap:18px; flex:1; overflow:hidden; }
      @media (max-width:820px) { .sgt-card.sgt-expanded { overflow-y:auto; } .sgt-card.sgt-expanded .sgt-workspace { display:flex; flex-direction:column; overflow:visible; } .sgt-card.sgt-expanded .sgt-textarea { min-height:260px; } }
      .sgt-left-pane, .sgt-right-pane { display:flex; flex-direction:column; gap:12px; min-height:0; }
      .sgt-card.sgt-expanded .sgt-left-pane { overflow-y:auto; padding-right:4px; }
      .sgt-card.sgt-expanded .sgt-right-pane { height:100%; }
      .sgt-now-playing { font-size:13px; color:#b3b3b3; background:rgba(255,255,255,.04); padding:10px 12px; border-radius:9px; border:1px solid rgba(255,255,255,.07); }
      .sgt-now-playing strong { color:#fff; }
      .sgt-btn-primary { background:#1db954; color:#000; border:none; border-radius:8px; padding:9px 14px; font-size:13px; font-weight:700; cursor:pointer; }
      .sgt-btn-primary:hover:not(:disabled) { background:#1ed760; }
      #sgt-open-songsterr { background:#0077cc; color:#fff; }
      #sgt-open-songsterr:hover:not(:disabled) { background:#148be0; }
      .sgt-btn-secondary { background:#282828; color:#e5e5e5; border:1px solid rgba(255,255,255,.1); border-radius:8px; padding:7px 11px; font-size:12px; font-weight:600; cursor:pointer; }
      .sgt-btn-secondary:hover:not(:disabled) { background:#363636; color:#fff; }
      .sgt-btn-secondary.sgt-active { background:rgba(29,185,84,.18); border-color:#1db954; color:#1db954; }
      .sgt-btn-primary:disabled, .sgt-btn-secondary:disabled { opacity:.45; cursor:not-allowed; }
      #sgt-open-ug { background:#FFD706; color:#000; border-color:#FFD706; font-weight:700; }
      #sgt-open-ug:hover:not(:disabled) { background:#ffe033; border-color:#ffe033; }
      .sgt-url-box { background:#101010; border:1px solid rgba(255,255,255,.08); border-radius:7px; padding:7px 10px; font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace; font-size:11px; color:#9e9e9e; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      .sgt-card.sgt-expanded .sgt-studio-tabs { display:none; }
      .sgt-panel { background:rgba(255,255,255,.035); border:1px solid rgba(255,255,255,.09); border-radius:10px; padding:12px; display:none; flex-direction:column; gap:10px; }
      .sgt-panel.sgt-panel-open, .sgt-card.sgt-expanded .sgt-panel { display:flex; }
      .sgt-panel-title { font-size:12px; font-weight:700; text-transform:uppercase; letter-spacing:.05em; color:#e5e5e5; }
      .sgt-select, .sgt-input { background:#121212; color:#f1f1f1; border:1px solid rgba(255,255,255,.14); border-radius:7px; padding:6px 9px; font-size:12px; outline:none; }
      .sgt-select:focus, .sgt-input:focus, .sgt-textarea:focus { border-color:#1db954; }
      .sgt-string-btn { flex:1; min-width:42px; background:#232323; color:#fff; border:1px solid rgba(255,255,255,.12); border-radius:7px; padding:7px 6px; font-size:12px; font-weight:700; cursor:pointer; text-align:center; }
      .sgt-string-btn:hover { background:#303030; border-color:#1db954; }
      .sgt-string-btn.sgt-playing-tone { background:#1db954; color:#000; border-color:#1db954; }
      .sgt-tuner-display, .sgt-tone-suggestion { background:#101010; border:1px solid rgba(255,255,255,.08); border-radius:8px; padding:10px 12px; display:flex; flex-direction:column; gap:6px; font-size:12px; color:#d4d4d4; }
      .sgt-tone-suggestion strong { color:#1db954; }
      .sgt-tuner-readout { display:flex; align-items:baseline; justify-content:space-between; gap:8px; }
      .sgt-tuner-note { font-size:24px; font-weight:800; color:#fff; }
      .sgt-tuner-note.sgt-in-tune, .sgt-tuner-direction.sgt-in-tune { color:#1db954; }
      .sgt-tuner-direction { font-size:12px; font-weight:700; color:#f59e0b; }
      .sgt-tuner-meta { font-size:11px; color:#a3a3a3; font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace; }
      .sgt-meter-track { position:relative; height:8px; background:#262626; border-radius:999px; overflow:hidden; }
      .sgt-meter-center { position:absolute; left:50%; top:0; bottom:0; width:3px; transform:translateX(-50%); background:#1db954; z-index:2; }
      .sgt-meter-needle { position:absolute; top:0; bottom:0; width:10px; border-radius:999px; background:#f59e0b; left:50%; transform:translateX(-50%); transition:left .08s ease,background .12s ease; }
      .sgt-meter-needle.sgt-in-tune { background:#1db954; }
      .sgt-tuner-hint { font-size:11px; color:#9e9e9e; }
      .sgt-rig-grid { display:grid; grid-template-columns:1fr; gap:7px; }
      .sgt-notes-label { font-size:12px; font-weight:600; color:#d4d4d4; }
      .sgt-notes-status { font-size:11px; color:#1db954; margin-left:6px; }
      .sgt-textarea { width:100%; min-height:200px; resize:vertical; background:#101010; color:#f1f1f1; border:1px solid rgba(255,255,255,.14); border-radius:9px; padding:12px; font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace; font-size:12.5px; line-height:1.45; box-sizing:border-box; outline:none; }
      .sgt-card.sgt-expanded .sgt-textarea { flex:1; min-height:0; resize:none; white-space:pre; overflow-x:auto; font-size:13.5px; }
      .sgt-cl-section { background:#202020; border:1px solid rgba(255,255,255,.07); border-radius:10px; padding:12px 14px; }
      .sgt-cl-heading { font-size:12px; font-weight:700; text-transform:uppercase; letter-spacing:.05em; margin:0 0 8px 0; }
      .sgt-cl-heading-added { color:#1db954; }
      .sgt-cl-heading-fixed { color:#60a5fa; }
      .sgt-cl-list { margin:0; padding-left:18px; display:flex; flex-direction:column; gap:6px; font-size:13px; line-height:1.45; color:#e0e0e0; }
      .sgt-cl-footer { display:flex; justify-content:flex-end; }
    `;
    document.head.appendChild(style);
  }

function trapDialogTabKey(e, container) {
  if (e.defaultPrevented || e.key !== "Tab" || !container) return;
    const focusables = Array.from(
      container.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')
    ).filter((el) => el.offsetParent !== null);
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  function stopTunerAudio() {
    micSessionGen++;
    isMicRunning = false;
    if (tunerAnimFrame) {
      cancelAnimationFrame(tunerAnimFrame);
      tunerAnimFrame = null;
    }
    if (activeMicStream) {
      activeMicStream.getTracks().forEach((t) => t.stop());
      activeMicStream = null;
    }
    if (activeAudioCtx) {
      activeAudioCtx.close().catch(() => {});
      activeAudioCtx = null;
    }
    const micBtn = document.getElementById("sgt-mic-btn");
    if (micBtn) {
      micBtn.disabled = false;
      micBtn.textContent = "Start Mic";
      micBtn.classList.remove("sgt-active");
    }
  }

  function closeChangelogModal() {
    const existing = document.getElementById(CL_MODAL_ID);
    if (existing) existing.remove();
    if (!document.getElementById(MODAL_ID)) {
      document.removeEventListener("keydown", handleGlobalKeydown);
    }
    if (prevClFocus && typeof prevClFocus.focus === "function") {
      prevClFocus.focus();
      prevClFocus = null;
    }
  }

  function openChangelogModal() {
    injectStyles();
    closeChangelogModal();
    prevClFocus = document.activeElement;
    safeSet(VERSION_KEY, EXTENSION_VERSION);

    const overlay = document.createElement("div");
    overlay.id = CL_MODAL_ID;
    overlay.addEventListener("click", (e) => { if (e.target === overlay) closeChangelogModal(); });
    overlay.innerHTML = `
      <div class="sgt-card sgt-changelog-card" role="dialog" aria-modal="true" aria-label="What's New in Guitar Tabs">
        <div class="sgt-header">
          <h2 class="sgt-title">${escapeHtml(CHANGELOG.title)} <span class="sgt-badge">v${escapeHtml(CHANGELOG.version)}</span></h2>
          <button class="sgt-icon-btn" id="sgt-cl-close-btn" title="Close" aria-label="Close">&times;</button>
        </div>
        <div class="sgt-cl-section">
          <h3 class="sgt-cl-heading sgt-cl-heading-added">What's Added</h3>
          <ul class="sgt-cl-list">${CHANGELOG.added.map((i) => `<li>${escapeHtml(i)}</li>`).join("")}</ul>
        </div>
        <div class="sgt-cl-section">
          <h3 class="sgt-cl-heading sgt-cl-heading-fixed">Improvements &amp; Fixes</h3>
          <ul class="sgt-cl-list">${CHANGELOG.fixed.map((i) => `<li>${escapeHtml(i)}</li>`).join("")}</ul>
        </div>
        <div class="sgt-cl-footer"><button class="sgt-btn-primary" id="sgt-cl-ack-btn">Got it</button></div>
      </div>
    `;
    document.body.appendChild(overlay);
    document.addEventListener("keydown", handleGlobalKeydown);

    const ackBtn = document.getElementById("sgt-cl-ack-btn");
    document.getElementById("sgt-cl-close-btn").addEventListener("click", closeChangelogModal);
    ackBtn.addEventListener("click", closeChangelogModal);
    ackBtn.focus();
  }

  function closeModal() {
    stopTunerAudio();
    if (activeSongChangeHandler) {
      Spicetify.Player.removeEventListener("songchange", activeSongChangeHandler);
      activeSongChangeHandler = null;
    }
    const existing = document.getElementById(MODAL_ID);
    if (existing) existing.remove();
    if (!document.getElementById(CL_MODAL_ID)) {
      document.removeEventListener("keydown", handleGlobalKeydown);
    }
    if (prevModalFocus && typeof prevModalFocus.focus === "function") {
      prevModalFocus.focus();
      prevModalFocus = null;
    }
  }

  function handleGlobalKeydown(e) {
    const clOverlay = document.getElementById(CL_MODAL_ID);
    if (clOverlay) {
      if (e.key === "Escape") closeChangelogModal();
      else trapDialogTabKey(e, clOverlay);
      return;
    }
    const modalOverlay = document.getElementById(MODAL_ID);
    if (modalOverlay) {
      if (e.key === "Escape") closeModal();
      else trapDialogTabKey(e, modalOverlay);
    }
  }

  async function openModal() {
    injectStyles();
    closeModal();
    prevModalFocus = document.activeElement;

    const overlay = document.createElement("div");
    overlay.id = MODAL_ID;
    overlay.addEventListener("click", (e) => { if (e.target === overlay) closeModal(); });

    const tuningOptions = Object.keys(TUNINGS).map((t) => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join("");
    overlay.innerHTML = `
      <div class="sgt-card" id="sgt-card-root" role="dialog" aria-modal="true" aria-label="Guitar Tabs">
        <div class="sgt-header">
          <h2 class="sgt-title">Guitar Tabs <span class="sgt-badge" id="sgt-match-badge">Ready</span> <button class="sgt-version-pill" id="sgt-version-btn" title="View changelog">v${escapeHtml(EXTENSION_VERSION)}</button></h2>
          <div class="sgt-header-controls">
            <button class="sgt-icon-btn" id="sgt-fullscreen-btn" title="Toggle Fullscreen Studio Mode" aria-label="Toggle Fullscreen">⛶</button>
            <button class="sgt-icon-btn" id="sgt-close-btn" title="Close (Esc)" aria-label="Close">&times;</button>
          </div>
        </div>
        <div class="sgt-workspace">
          <div class="sgt-left-pane">
            <div class="sgt-now-playing" id="sgt-now-playing">Checking current track...</div>
            <div class="sgt-actions-row">
              <button class="sgt-btn-primary" id="sgt-open-songsterr">Open on Songsterr</button>
              <button class="sgt-btn-secondary" id="sgt-open-ug" title="Open on Ultimate Guitar">Ultimate Guitar</button>
              <button class="sgt-btn-secondary" id="sgt-open-ddg" title="Search the web for guitar tabs">Web Search</button>
            </div>
            <div class="sgt-url-box" id="sgt-url-preview">https://www.songsterr.com/</div>
            <div class="sgt-studio-tabs">
              <button class="sgt-btn-secondary" id="sgt-toggle-tuner">🎛️ Guitar Tuner</button>
              <button class="sgt-btn-secondary" id="sgt-toggle-tone">⚡ Tone &amp; Rig</button>
            </div>
            <div class="sgt-panel" id="sgt-tuner-panel">
              <div class="sgt-panel-head">
                <span class="sgt-panel-title">Guitar Tuner</span>
                <div style="display:flex;gap:6px;align-items:center;">
                  <select class="sgt-select" id="sgt-tuning-select" aria-label="Select Tuning">${tuningOptions}</select>
                  <button class="sgt-btn-secondary" id="sgt-mic-btn">Start Mic</button>
                </div>
              </div>
              <div class="sgt-strings-row" id="sgt-strings-row"></div>
              <div class="sgt-tuner-display">
                <div class="sgt-tuner-readout">
                  <span class="sgt-tuner-note" id="sgt-tuner-note">--</span>
                  <span class="sgt-tuner-direction" id="sgt-tuner-direction">Ready</span>
                </div>
                <div class="sgt-meter-track"><div class="sgt-meter-center"></div><div class="sgt-meter-needle" id="sgt-meter-needle"></div></div>
                <div class="sgt-tuner-meta" id="sgt-tuner-meta">Click a string to hear pitch or Start Mic</div>
                <div class="sgt-tuner-hint" id="sgt-tuner-hint">Reference tones play a 2.5s plucked string sound.</div>
              </div>
            </div>
            <div class="sgt-panel" id="sgt-tone-panel">
              <div class="sgt-panel-head">
                <span class="sgt-panel-title">Tone Finder &amp; Song Rig</span>
                <button class="sgt-btn-secondary" id="sgt-apply-preset">Apply Preset</button>
              </div>
              <div class="sgt-tone-suggestion" id="sgt-tone-suggestion">Detecting artist genre...</div>
              <div class="sgt-rig-grid">
                <input class="sgt-input" id="sgt-rig-tuning" placeholder="Song Tuning (e.g., Eb Standard, Drop D)" />
                <input class="sgt-input" id="sgt-rig-amp" placeholder="Amp &amp; EQ (e.g., Marshall JCM800 - Gain 7, Mid 6)" />
                <input class="sgt-input" id="sgt-rig-pedals" placeholder="Pedals / Notes (e.g., Tube Screamer, Chorus)" />
              </div>
            </div>
          </div>
          <div class="sgt-right-pane">
            <div class="sgt-notes-toolbar">
              <div><span class="sgt-notes-label">Saved Tabs / Notes</span><span class="sgt-notes-status" id="sgt-save-status"></span></div>
              <div class="sgt-notes-tools">
                <button class="sgt-btn-secondary" id="sgt-insert-6" title="Insert 6-string tab at cursor">+ 6-Str</button>
                <button class="sgt-btn-secondary" id="sgt-insert-7" title="Insert 7-string tab at cursor">+ 7-Str</button>
                <button class="sgt-btn-secondary" id="sgt-insert-bass" title="Insert 4-string bass tab at cursor">+ Bass</button>
                <button class="sgt-btn-secondary" id="sgt-copy-notes">Copy</button>
                <button class="sgt-btn-secondary" id="sgt-clear-notes">Clear</button>
              </div>
            </div>
            <textarea class="sgt-textarea" id="sgt-notes-area" spellcheck="false" placeholder="Write guitar tabs, chords, tuning, or notes here... (Press Tab to indent, Ctrl+S to save)"></textarea>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);
    document.addEventListener("keydown", handleGlobalKeydown);

    const $ = (id) => document.getElementById(id);
    const cardRoot = $("sgt-card-root");
    const fullscreenBtn = $("sgt-fullscreen-btn");
    const nowPlayingEl = $("sgt-now-playing");
    const badgeEl = $("sgt-match-badge");
    const primaryBtn = $("sgt-open-songsterr");
    const ugBtn = $("sgt-open-ug");
    const urlPreviewEl = $("sgt-url-preview");
    const tunerPanel = $("sgt-tuner-panel");
    const tonePanel = $("sgt-tone-panel");
    const toggleTunerBtn = $("sgt-toggle-tuner");
    const toggleToneBtn = $("sgt-toggle-tone");
    const tuningSelect = $("sgt-tuning-select");
    const stringsRow = $("sgt-strings-row");
    const micBtn = $("sgt-mic-btn");
    const tunerNoteEl = $("sgt-tuner-note");
    const tunerDirectionEl = $("sgt-tuner-direction");
    const tunerMetaEl = $("sgt-tuner-meta");
    const meterNeedleEl = $("sgt-meter-needle");
    const tunerHintEl = $("sgt-tuner-hint");
    const toneSuggestionEl = $("sgt-tone-suggestion");
    const applyPresetBtn = $("sgt-apply-preset");
    const rigTuningInput = $("sgt-rig-tuning");
    const rigAmpInput = $("sgt-rig-amp");
    const rigPedalsInput = $("sgt-rig-pedals");
    const textarea = $("sgt-notes-area");
    const saveStatusEl = $("sgt-save-status");
    const copyBtn = $("sgt-copy-notes");
    const clearBtn = $("sgt-clear-notes");

    let activeTrack = null;
    let currentPreset = DEFAULT_PRESET;
    let activeUrls = { primary: "https://www.songsterr.com/", ultimateGuitar: "https://www.ultimate-guitar.com/", duckDuckGo: "https://duckduckgo.com/?q=guitar+tabs" };
    let fallbackUrls = { songsterrSearch: activeUrls.primary, ultimateGuitarSearch: activeUrls.ultimateGuitar, webSearch: activeUrls.duckDuckGo };
    let clearTimer = null;
    let pendingSongsterr = null;
    let pendingUg = null;
    let smoothedPitch = null;

    const resetClearArm = () => {
      clearTimeout(clearTimer);
      clearTimer = null;
      clearBtn.dataset.armed = "false";
      clearBtn.textContent = "Clear";
    };

    function playReferenceTone(freq, label, btnEl) {
      if (isMicRunning) stopTunerAudio();
      try {
        if (!activeAudioCtx || activeAudioCtx.state === "closed") {
          activeAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (activeAudioCtx.state === "suspended") activeAudioCtx.resume();

        const now = activeAudioCtx.currentTime;
        const osc1 = activeAudioCtx.createOscillator();
        const osc2 = activeAudioCtx.createOscillator();
        const filter = activeAudioCtx.createBiquadFilter();
        const gain = activeAudioCtx.createGain();

        osc1.type = "triangle";
        osc1.frequency.setValueAtTime(freq, now);
        osc2.type = "sine";
        osc2.frequency.setValueAtTime(freq * 2, now);
        filter.type = "lowpass";
        filter.frequency.setValueAtTime(freq * 6, now);
        filter.frequency.exponentialRampToValueAtTime(freq * 1.5, now + 2.2);
        gain.gain.setValueAtTime(0.001, now);
        gain.gain.linearRampToValueAtTime(0.28, now + 0.03);
        gain.gain.exponentialRampToValueAtTime(0.0008, now + 2.4);

        osc1.connect(filter);
        osc2.connect(filter);
        filter.connect(gain);
        gain.connect(activeAudioCtx.destination);
        osc1.start(now);
        osc2.start(now);
        osc1.stop(now + 2.5);
        osc2.stop(now + 2.5);

        stringsRow.querySelectorAll(".sgt-string-btn").forEach((b) => b.classList.remove("sgt-playing-tone"));
        btnEl.classList.add("sgt-playing-tone");
        tunerNoteEl.textContent = label;
        tunerNoteEl.classList.add("sgt-in-tune");
        tunerDirectionEl.textContent = "Reference Tone";
        tunerDirectionEl.classList.add("sgt-in-tune");
        tunerMetaEl.textContent = `Target: ${freq.toFixed(2)} Hz`;
        meterNeedleEl.style.left = "50%";
        meterNeedleEl.classList.add("sgt-in-tune");
        setTimeout(() => btnEl.classList.remove("sgt-playing-tone"), 2400);
      } catch (_) {
        tunerHintEl.textContent = "Audio playback blocked by system audio policy.";
      }
    }

    function renderStringButtons() {
      const notes = TUNINGS[tuningSelect.value] || TUNINGS["E Standard"];
      stringsRow.innerHTML = notes.map((n) => `<button class="sgt-string-btn" data-freq="${n.freq}" data-label="${escapeHtml(n.label)}">${escapeHtml(n.label)}</button>`).join("");
      stringsRow.querySelectorAll(".sgt-string-btn").forEach((btn) => {
        btn.addEventListener("click", () => playReferenceTone(parseFloat(btn.dataset.freq), btn.dataset.label, btn));
      });
    }

    async function toggleMicTuner() {
      if (isMicRunning) {
        stopTunerAudio();
        smoothedPitch = null;
        tunerDirectionEl.textContent = "Stopped";
        tunerDirectionEl.classList.remove("sgt-in-tune");
        tunerMetaEl.textContent = "Mic stopped";
        return;
      }

      const sessionId = ++micSessionGen;
      micBtn.disabled = true;
      micBtn.textContent = "Starting...";
      let stream = null;

      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
        });
        if (sessionId !== micSessionGen || !document.getElementById(MODAL_ID)) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        if (activeAudioCtx && activeAudioCtx.state !== "closed") {
          await activeAudioCtx.close().catch(() => {});
        }
        if (sessionId !== micSessionGen || !document.getElementById(MODAL_ID)) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        activeAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
        activeMicStream = stream;
        stream = null;

        const source = activeAudioCtx.createMediaStreamSource(activeMicStream);
        const analyser = activeAudioCtx.createAnalyser();
        analyser.fftSize = 4096;
        source.connect(analyser);

        const buffer = new Float32Array(analyser.fftSize);
        isMicRunning = true;
        smoothedPitch = null;
        micBtn.disabled = false;
        micBtn.textContent = "Stop Mic";
        micBtn.classList.add("sgt-active");
        tunerHintEl.textContent = "Pluck one string at a time near your microphone.";

        let lastCheck = 0;
        let lastSignal = 0;

        const updatePitch = (now) => {
          if (!isMicRunning || sessionId !== micSessionGen || !activeAudioCtx) return;
          if (now - lastCheck >= 35) {
            lastCheck = now;
            analyser.getFloatTimeDomainData(buffer);
            const rawPitch = detectPitchYIN(buffer, activeAudioCtx.sampleRate);

            if (rawPitch !== -1) {
              lastSignal = now;
              smoothedPitch = (!smoothedPitch || Math.abs(12 * Math.log2(rawPitch / smoothedPitch)) > 1.5)
                ? rawPitch
                : (smoothedPitch * 0.65 + rawPitch * 0.35);

              const info = evaluatePitchAgainstTuning(smoothedPitch, TUNINGS[tuningSelect.value]);
              const inTune = Math.abs(info.cents) <= 4;
              tunerNoteEl.textContent = info.note;
              tunerNoteEl.classList.toggle("sgt-in-tune", inTune);
              tunerDirectionEl.classList.toggle("sgt-in-tune", inTune);
              tunerDirectionEl.textContent = inTune ? "✓ In Tune" : (info.cents < 0 ? `♭ Tune Up (${info.cents}¢)` : `♯ Tune Down (+${info.cents}¢)`);
              tunerMetaEl.textContent = `${info.freq} Hz • ${info.targetLabel}`;
              meterNeedleEl.style.left = `${50 + Math.max(-50, Math.min(50, info.cents))}%`;
              meterNeedleEl.classList.toggle("sgt-in-tune", inTune);
            } else if (lastSignal && now - lastSignal > 1200) {
              lastSignal = 0;
              smoothedPitch = null;
              tunerNoteEl.textContent = "--";
              tunerNoteEl.classList.remove("sgt-in-tune");
              tunerDirectionEl.textContent = "Waiting for note...";
              tunerDirectionEl.classList.remove("sgt-in-tune");
              tunerMetaEl.textContent = "Listening...";
              meterNeedleEl.style.left = "50%";
              meterNeedleEl.classList.remove("sgt-in-tune");
            }
          }
          tunerAnimFrame = requestAnimationFrame(updatePitch);
        };
        tunerAnimFrame = requestAnimationFrame(updatePitch);
      } catch (_) {
        if (stream) stream.getTracks().forEach((t) => t.stop());
        if (sessionId === micSessionGen) {
          stopTunerAudio();
          tunerHintEl.textContent = "Mic blocked by Spotify permissions — click the string buttons above to tune by ear.";
        }
      }
    }

    renderStringButtons();
    tuningSelect.addEventListener("change", renderStringButtons);
    micBtn.addEventListener("click", toggleMicTuner);

    fullscreenBtn.addEventListener("click", () => {
      const expanded = cardRoot.classList.toggle("sgt-expanded");
      fullscreenBtn.textContent = expanded ? "🗗" : "⛶";
      fullscreenBtn.title = expanded ? "Exit Fullscreen" : "Toggle Fullscreen Studio Mode";
    });
    toggleTunerBtn.addEventListener("click", () => toggleTunerBtn.classList.toggle("sgt-active", tunerPanel.classList.toggle("sgt-panel-open")));
    toggleToneBtn.addEventListener("click", () => toggleToneBtn.classList.toggle("sgt-active", tonePanel.classList.toggle("sgt-panel-open")));

    const persistRig = () => {
      if (!activeTrack) return;
      saveStatusEl.textContent = saveRig(activeTrack, { tuning: rigTuningInput.value, amp: rigAmpInput.value, pedals: rigPedalsInput.value }) ? "Rig Saved" : "Storage Restricted";
    };
    [rigTuningInput, rigAmpInput, rigPedalsInput].forEach((el) => el.addEventListener("input", persistRig));
    applyPresetBtn.addEventListener("click", () => {
      if (!activeTrack || !currentPreset) return;
      rigTuningInput.value = currentPreset.tuning;
      rigAmpInput.value = currentPreset.amp;
      rigPedalsInput.value = currentPreset.pedals;
      persistRig();
    });

    async function syncTrackView() {
      resetClearArm();
      activeTrack = getCurrentTrackInfo();
      const hasTrack = Boolean(activeTrack);
      [textarea, rigTuningInput, rigAmpInput, rigPedalsInput, applyPresetBtn].forEach((el) => { el.disabled = !hasTrack; });

      if (!hasTrack) {
        nowPlayingEl.textContent = "Nothing currently playing — start a track in Spotify to look up tabs.";
        badgeEl.textContent = "No Track";
        urlPreviewEl.textContent = "https://www.songsterr.com/";
        primaryBtn.textContent = "Open Songsterr";
        activeUrls = { primary: "https://www.songsterr.com/", ultimateGuitar: "https://www.ultimate-guitar.com/", duckDuckGo: "https://duckduckgo.com/?q=guitar+tabs" };
        fallbackUrls = { songsterrSearch: activeUrls.primary, ultimateGuitarSearch: activeUrls.ultimateGuitar, webSearch: activeUrls.duckDuckGo };
        pendingSongsterr = pendingUg = null;
        textarea.value = saveStatusEl.textContent = rigTuningInput.value = rigAmpInput.value = rigPedalsInput.value = "";
        toneSuggestionEl.textContent = "Play a track to detect genre-based amp & pedal settings.";
        return;
      }

      nowPlayingEl.innerHTML = `Now Playing: <strong>${escapeHtml(activeTrack.rawTitle)}</strong>${activeTrack.rawArtist ? ` — ${escapeHtml(activeTrack.rawArtist)}` : ""}`;
      fallbackUrls = buildFallbackUrls(activeTrack);
      activeUrls = { primary: fallbackUrls.songsterrSearch, ultimateGuitar: fallbackUrls.ultimateGuitarSearch, duckDuckGo: fallbackUrls.webSearch };
      badgeEl.textContent = "Matching...";
      primaryBtn.textContent = "Open on Songsterr";
      urlPreviewEl.textContent = fallbackUrls.songsterrSearch;

      textarea.value = loadNotes(activeTrack);
      saveStatusEl.textContent = textarea.value ? "Loaded" : "";
      const rig = loadRig(activeTrack);
      rigTuningInput.value = rig.tuning;
      rigAmpInput.value = rig.amp;
      rigPedalsInput.value = rig.pedals;

      const snapKey = activeTrack.storageKey;
      detectToneSuggestion(activeTrack).then(({ genreText, preset }) => {
        if (activeTrack?.storageKey !== snapKey) return;
        currentPreset = preset;
        toneSuggestionEl.innerHTML = `<div>Style: <strong>${escapeHtml(genreText)}</strong> → ${escapeHtml(preset.label)}</div><div>Suggested: ${escapeHtml(preset.amp)}</div><div>Pedals: ${escapeHtml(preset.pedals)}</div>`;
      });

      const sProm = resolveSongsterrUrl(activeTrack);
      const uProm = resolveUltimateGuitarUrl(activeTrack);
      pendingSongsterr = sProm;
      pendingUg = uProm;

      sProm.then((res) => {
        if (pendingSongsterr === sProm) pendingSongsterr = null;
        if (activeTrack?.storageKey !== snapKey) return;
        activeUrls.primary = urlPreviewEl.textContent = res.url;
        badgeEl.textContent = res.isDirect ? "Direct Tab" : "Search Ready";
      });
      uProm.then((res) => {
        if (pendingUg === uProm) pendingUg = null;
        if (activeTrack?.storageKey !== snapKey) return;
        activeUrls.ultimateGuitar = res.url;
      });
    }

    $("sgt-close-btn").addEventListener("click", closeModal);
    $("sgt-version-btn").addEventListener("click", openChangelogModal);
    primaryBtn.addEventListener("click", () => handleTabButtonClick(primaryBtn, pendingSongsterr, () => activeUrls.primary, () => fallbackUrls.songsterrSearch));
    ugBtn.addEventListener("click", () => handleTabButtonClick(ugBtn, pendingUg, () => activeUrls.ultimateGuitar, () => fallbackUrls.ultimateGuitarSearch));
    $("sgt-open-ddg").addEventListener("click", () => openExternalUrl(activeUrls.duckDuckGo));

    textarea.addEventListener("input", () => {
      if (activeTrack) saveStatusEl.textContent = saveNotes(activeTrack, textarea.value) ? "Saved" : "Storage Full";
    });
    textarea.addEventListener("keydown", (e) => {
      if (e.key === "Tab") {
        e.preventDefault();
        const s = textarea.selectionStart, end = textarea.selectionEnd;
        textarea.value = textarea.value.substring(0, s) + "  " + textarea.value.substring(end);
        textarea.selectionStart = textarea.selectionEnd = s + 2;
        if (activeTrack) saveStatusEl.textContent = saveNotes(activeTrack, textarea.value) ? "Saved" : "Storage Full";
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (activeTrack) saveStatusEl.textContent = saveNotes(activeTrack, textarea.value) ? "Saved ✓" : "Storage Full";
      }
    });

    const insertAtCursor = (tpl) => {
      if (!activeTrack) return;
      const s = textarea.selectionStart ?? textarea.value.length;
      const end = textarea.selectionEnd ?? textarea.value.length;
      const before = textarea.value.substring(0, s);
      const after = textarea.value.substring(end);
      const ins = (before.length && !before.endsWith("\n") ? "\n\n" : "") + tpl + (after.length && !after.startsWith("\n") ? "\n\n" : "\n");
      textarea.value = before + ins + after;
      textarea.focus();
      textarea.selectionStart = textarea.selectionEnd = before.length + ins.length;
      saveStatusEl.textContent = saveNotes(activeTrack, textarea.value) ? "Saved" : "Storage Full";
    };
    $("sgt-insert-6").addEventListener("click", () => insertAtCursor(TAB_TEMPLATES.six));
    $("sgt-insert-7").addEventListener("click", () => insertAtCursor(TAB_TEMPLATES.seven));
    $("sgt-insert-bass").addEventListener("click", () => insertAtCursor(TAB_TEMPLATES.bass));

    copyBtn.addEventListener("click", async () => {
      if (!textarea.value) return;
      try {
        await navigator.clipboard.writeText(textarea.value);
        copyBtn.textContent = "Copied!";
        setTimeout(() => { copyBtn.textContent = "Copy"; }, 1500);
      } catch (_) {
        textarea.select();
        document.execCommand("copy");
      }
    });

    clearBtn.addEventListener("click", () => {
      if (!activeTrack || !textarea.value) return;
      if (clearBtn.dataset.armed !== "true") {
        clearBtn.dataset.armed = "true";
        clearBtn.textContent = "Confirm?";
        clearTimer = setTimeout(resetClearArm, 2500);
        return;
      }
      resetClearArm();
      textarea.value = "";
      saveNotes(activeTrack, "");
      saveStatusEl.textContent = "Cleared";
    });

    activeSongChangeHandler = () => { if (document.getElementById(MODAL_ID)) syncTrackView(); else closeModal(); };
    Spicetify.Player.addEventListener("songchange", activeSongChangeHandler);

    await syncTrackView();
    primaryBtn.focus();
  }

  const ICON_SVG = `<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M6 13c0 1.105-1.12 2-2.5 2S1 14.105 1 13c0-1.104 1.12-2 2.5-2s2.5.896 2.5 2zm9-2c0 1.105-1.12 2-2.5 2s-2.5-.895-2.5-2 1.12-2 2.5-2 2.5.895 2.5 2z"/><path fill-rule="evenodd" d="M14 11V2h1v9h-1zM6 3v10H5V3h1z"/><path d="M5 2.905a1 1 0 0 1 .9-.995l8-.8a1 1 0 0 1 1.1.995V3L5 4V2.905z"/></svg>`;
  new Spicetify.Topbar.Button("Guitar Tabs", ICON_SVG, openModal, false);

  Spicetify.Player.addEventListener("songchange", scheduleBackgroundPrefetch);
  scheduleBackgroundPrefetch();

  if (safeGet(VERSION_KEY) !== EXTENSION_VERSION) {
    setTimeout(openChangelogModal, 1500);
  }
})();
