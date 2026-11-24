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

  const EXTENSION_VERSION = "2.1.0";
  const VERSION_STORAGE_KEY = "spicetify-guitar-tabs:last-seen-version";
  const STORAGE_PREFIX = "spicetify-guitar-tabs:v2:";
  const RIG_PREFIX = "spicetify-guitar-tabs:v2:rig:";
  const LEGACY_PREFIX = "guitar-tabs-";
  const STYLE_ID = "sgt-styles";
  const MODAL_ID = "sgt-modal-overlay";
  const CHANGELOG_MODAL_ID = "sgt-changelog-overlay";

  const CHANGELOG = {
    version: EXTENSION_VERSION,
    title: "Guitar Tabs Studio Update",
    added: [
      "Fullscreen Studio Mode toggle (⛶) with a side-by-side workspace and non-wrapping wide tab editor.",
      "Built-in Dual-Mode Guitar Tuner with live microphone pitch detection and plucked reference tones for 6 tunings.",
      "Smart Tone Finder that reads artist genres to suggest Amp, EQ, and Pedal setups plus per-song Rig saving.",
      "Added 7-String and 4-String Bass ASCII tab templates and Ctrl+S save confirmation."
    ],
    fixed: [
      "Prevented long ASCII tab lines from wrapping awkwardly when expanded to fullscreen.",
      "Automatically releases microphone and audio contexts when closing the modal."
    ]
  };

  const TUNINGS = {
    "E Standard": [
      { label: "E2", freq: 82.41 },
      { label: "A2", freq: 110.0 },
      { label: "D3", freq: 146.83 },
      { label: "G3", freq: 196.0 },
      { label: "B3", freq: 246.94 },
      { label: "E4", freq: 329.63 }
    ],
    "Drop D": [
      { label: "D2", freq: 73.42 },
      { label: "A2", freq: 110.0 },
      { label: "D3", freq: 146.83 },
      { label: "G3", freq: 196.0 },
      { label: "B3", freq: 246.94 },
      { label: "E4", freq: 329.63 }
    ],
    "Eb Standard": [
      { label: "Eb2", freq: 77.78 },
      { label: "Ab2", freq: 103.83 },
      { label: "Db3", freq: 138.59 },
      { label: "Gb3", freq: 185.0 },
      { label: "Bb3", freq: 233.08 },
      { label: "Eb4", freq: 311.13 }
    ],
    "D Standard": [
      { label: "D2", freq: 73.42 },
      { label: "G2", freq: 98.0 },
      { label: "C3", freq: 130.81 },
      { label: "F3", freq: 174.61 },
      { label: "A3", freq: 220.0 },
      { label: "D4", freq: 293.66 }
    ],
    "Drop C": [
      { label: "C2", freq: 65.41 },
      { label: "G2", freq: 98.0 },
      { label: "C3", freq: 130.81 },
      { label: "F3", freq: 174.61 },
      { label: "A3", freq: 220.0 },
      { label: "D4", freq: 293.66 }
    ],
    "Bass (4-Str)": [
      { label: "E1", freq: 41.2 },
      { label: "A1", freq: 55.0 },
      { label: "D2", freq: 73.42 },
      { label: "G2", freq: 98.0 }
    ]
  };

  const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

  const TONE_PRESETS = [
    {
      match: /(thrash|death|metalcore|djent|heavy metal|speed metal|doom|sludge|metal)/i,
      label: "High-Gain Metal",
      tuning: "E Standard / Drop D",
      amp: "Mesa Rectifier / 5150 — Gain 8.5 | Bass 7 | Mid 4 | Treb 7.5",
      pedals: "Tube Screamer (Drive 0, Level 10) + Noise Gate"
    },
    {
      match: /(punk|pop punk|skate punk|hardcore|grunge|garage)/i,
      label: "Punk / Grunge Crunch",
      amp: "Marshall JCM800 — Gain 7.5 | Bass 6.5 | Mid 6.5 | Treb 7",
      tuning: "E Standard / Eb Standard",
      pedals: "ProCo RAT or Boss DS-1 Distortion"
    },
    {
      match: /(hard rock|classic rock|glam|arena rock|southern rock|stoner)/i,
      label: "Classic / Hard Rock",
      tuning: "E Standard",
      amp: "Marshall Plexi — Gain 6.5 | Bass 6 | Mid 7 | Treb 6.5",
      pedals: "Warm Overdrive + Subtle Tape Echo"
    },
    {
      match: /(blues|soul|funk|r&b|jazz|country)/i,
      label: "Edge-of-Breakup Clean",
      tuning: "E Standard",
      amp: "Fender Twin / Deluxe — Gain 4 | Bass 5.5 | Mid 6.5 | Treb 6",
      pedals: "TS808 Overdrive + Spring Reverb"
    },
    {
      match: /(indie|shoegaze|dream pop|post-punk|alternative|surf|new wave)/i,
      label: "Chimey Indie / Alt",
      tuning: "E Standard",
      amp: "Vox AC30 / JC-120 — Gain 3.5 | Bass 5 | Mid 6 | Treb 7",
      pedals: "Analog Chorus + Dotted-8th Delay + Hall Reverb"
    }
  ];

  const DEFAULT_TONE_PRESET = {
    label: "Versatile Rock Crunch",
    tuning: "E Standard",
    amp: "British Crunch — Gain 5.5 | Bass 6 | Mid 6 | Treb 6.5",
    pedals: "Light Overdrive + Room Reverb"
  };

  const songsterrCache = new Map();
  const ugCache = new Map();
  const artistGenreCache = new Map();
  let prefetchTimer = null;

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
    const primaryArtistUri =
      (Array.isArray(item.artists) && item.artists[0]?.uri) ||
      meta.artist_uri ||
      "";

    if (!rawTitle) return null;

    const cleanTitle = cleanTrackTitle(rawTitle) || rawTitle;
    const cleanArtist = cleanArtistName(rawArtist) || rawArtist;
    const asciiArtist = stripDiacritics(cleanArtist);
    const asciiTitle = stripDiacritics(cleanTitle);
    const searchQuery = [asciiArtist, asciiTitle].filter(Boolean).join(" ").trim();

    const baseNorm = `${normalizeForMatch(cleanArtist)}::${normalizeForMatch(cleanTitle)}`;
    const storageKey = `${STORAGE_PREFIX}${baseNorm}`;
    const rigKey = `${RIG_PREFIX}${baseNorm}`;
    const legacyKey = `${LEGACY_PREFIX}${rawArtist}-${rawTitle}`;

    return {
      uri: item.uri || "",
      primaryArtistUri,
      rawTitle,
      rawArtist,
      cleanTitle,
      cleanArtist,
      searchQuery,
      storageKey,
      rigKey,
      legacyKey
    };
  }

  async function detectToneSuggestion(track) {
    if (!track) return { genreText: "General", preset: DEFAULT_TONE_PRESET };

    const artistId = (track.primaryArtistUri || "").split(":")[2] || "";
    let genres = [];

    if (artistId) {
      if (artistGenreCache.has(artistId)) {
        genres = artistGenreCache.get(artistId);
      } else if (Spicetify?.CosmosAsync?.get) {
        try {
          const data = await Spicetify.CosmosAsync.get(`https://api.spotify.com/v1/artists/${artistId}`);
          if (Array.isArray(data?.genres)) {
            genres = data.genres;
            artistGenreCache.set(artistId, genres);
          }
        } catch (_) {}
      }
    }

    const joined = genres.join(", ");
    for (const p of TONE_PRESETS) {
      if (p.match.test(joined)) {
        return {
          genreText: genres.slice(0, 2).join(" • ") || p.label,
          preset: p
        };
      }
    }

    return {
      genreText: genres.slice(0, 2).join(" • ") || "Rock / General",
      preset: DEFAULT_TONE_PRESET
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

  function extractSongList(payload) {
    let data = payload;
    if (typeof data === "string") {
      try {
        data = JSON.parse(data);
      } catch (_) {
        return null;
      }
    }
    if (!data) return null;
    if (data.body !== undefined) return extractSongList(data.body);
    if (Array.isArray(data)) return data;
    if (Array.isArray(data.records)) return data.records;
    if (Array.isArray(data.songs)) return data.songs;
    if (Array.isArray(data.results)) return data.results;
    if (Array.isArray(data.data)) return data.data;
    return null;
  }

  async function fetchTextWithTimeout(url, timeoutMs = 4500) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);
      if (!res.ok) return null;
      return await res.text();
    } catch (_) {
      clearTimeout(timeoutId);
      return null;
    }
  }

  async function fetchViaAllOrigins(targetUrl, timeoutMs = 4500) {
    const raw = await fetchTextWithTimeout(
      `https://api.allorigins.win/get?url=${encodeURIComponent(targetUrl)}`,
      timeoutMs
    );
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      return typeof parsed?.contents === "string" ? parsed.contents : null;
    } catch (_) {
      return null;
    }
  }

  function relayTargetUrl(targetUrl, timeoutMs = 4500) {
    return [
      fetchTextWithTimeout(`https://corsproxy.io/?url=${encodeURIComponent(targetUrl)}`, timeoutMs),
      fetchViaAllOrigins(targetUrl, timeoutMs),
      fetchTextWithTimeout(`https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(targetUrl)}`, timeoutMs)
    ];
  }

  function extractUrlsFromSearchHtml(html) {
    if (!html || typeof html !== "string") return [];
    const urls = [];
    const uddgRegex = /uddg=([^&"'\s<>]+)/gi;
    let match;
    while ((match = uddgRegex.exec(html)) !== null) {
      try {
        urls.push(decodeURIComponent(match[1]));
      } catch (_) {}
    }
    const rawRegex = /https?:\/\/[^\s"'<>]+/gi;
    while ((match = rawRegex.exec(html)) !== null) {
      urls.push(match[0].replace(/&amp;/g, "&"));
    }
    return urls;
  }

  function firstTruthy(promises) {
    return new Promise((resolve) => {
      let pending = promises.length;
      if (pending === 0) return resolve(null);
      let settled = false;

      for (const p of promises) {
        Promise.resolve(p)
          .then((val) => {
            if (!settled && val) {
              settled = true;
              resolve(val);
            }
          })
          .catch(() => {})
          .finally(() => {
            pending -= 1;
            if (!settled && pending === 0) {
              resolve(null);
            }
          });
      }
    });
  }

  async function resolveSongsterrFromApi(track) {
    const encoded = encodeURIComponent(track.searchQuery);
    const searchApi = `https://www.songsterr.com/api/search?pattern=${encoded}`;
    const songsApi = `https://www.songsterr.com/api/songs?size=20&pattern=${encoded}`;

    const candidates = [
      fetchTextWithTimeout(searchApi, 2500),
      fetchTextWithTimeout(songsApi, 2500),
      ...relayTargetUrl(searchApi, 4500),
      ...relayTargetUrl(songsApi, 4500)
    ];

    return await firstTruthy(
      candidates.map(async (p) => {
        const text = await p;
        const songs = extractSongList(text);
        if (!Array.isArray(songs) || songs.length === 0) return null;

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
          return `https://www.songsterr.com/a/wsa/${artistSlug}-${titleSlug}-tab-s${bestId}`;
        }
        return null;
      })
    );
  }

  async function resolveDirectUrlViaSearch(query, urlPattern) {
    const ddgLiteUrl = `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`;
    const htmlPromises = relayTargetUrl(ddgLiteUrl, 4500);

    return await firstTruthy(
      htmlPromises.map(async (p) => {
        const html = await p;
        const urls = extractUrlsFromSearchHtml(html);
        for (const u of urls) {
          const clean = u.split("#")[0].split("?")[0];
          if (urlPattern.test(clean)) {
            return clean;
          }
        }
        return null;
      })
    );
  }

  async function resolveSongsterrUrl(track) {
    if (!track || !track.searchQuery) {
      return { url: "https://www.songsterr.com/", isDirect: false };
    }

    const cacheKey = track.storageKey;
    if (songsterrCache.has(cacheKey)) {
      return songsterrCache.get(cacheKey);
    }

    const fallbacks = buildFallbackUrls(track);
    const directUrl = await firstTruthy([
      resolveSongsterrFromApi(track),
      resolveDirectUrlViaSearch(
        `site:songsterr.com/a/wsa ${track.searchQuery}`,
        /^https?:\/\/(www\.)?songsterr\.com\/a\/wsa\/[a-z0-9-]+-tab-s\d+/i
      )
    ]);

    if (directUrl) {
      const result = { url: directUrl, isDirect: true };
      songsterrCache.set(cacheKey, result);
      return result;
    }

    return { url: fallbacks.songsterrSearch, isDirect: false };
  }

  async function resolveUltimateGuitarUrl(track) {
    if (!track || !track.searchQuery) {
      return { url: "https://www.ultimate-guitar.com/", isDirect: false };
    }

    const cacheKey = track.storageKey;
    if (ugCache.has(cacheKey)) {
      return ugCache.get(cacheKey);
    }

    const fallbacks = buildFallbackUrls(track);
    const directUrl = await resolveDirectUrlViaSearch(
      `site:tabs.ultimate-guitar.com/tab ${track.searchQuery}`,
      /^https?:\/\/tabs\.ultimate-guitar\.com\/tab\/[a-z0-9-]+\/[a-z0-9-]+-\d+/i
    );

    if (directUrl) {
      const result = { url: directUrl, isDirect: true };
      ugCache.set(cacheKey, result);
      return result;
    }

    return { url: fallbacks.ultimateGuitarSearch, isDirect: false };
  }

  function scheduleBackgroundPrefetch() {
    clearTimeout(prefetchTimer);
    prefetchTimer = setTimeout(() => {
      const track = getCurrentTrackInfo();
      if (!track) return;
      if (!songsterrCache.has(track.storageKey)) resolveSongsterrUrl(track);
      if (!ugCache.has(track.storageKey)) resolveUltimateGuitarUrl(track);
    }, 500);
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
    if (!text) localStorage.removeItem(track.storageKey);
    else localStorage.setItem(track.storageKey, text);
    if (localStorage.getItem(track.legacyKey) !== null) {
      localStorage.removeItem(track.legacyKey);
    }
  }

  function loadRig(track) {
    if (!track) return { tuning: "", amp: "", pedals: "" };
    try {
      const raw = localStorage.getItem(track.rigKey);
      if (raw) return JSON.parse(raw);
    } catch (_) {}
    return { tuning: "", amp: "", pedals: "" };
  }

  function saveRig(track, rigObj) {
    if (!track) return;
    if (!rigObj.tuning && !rigObj.amp && !rigObj.pedals) {
      localStorage.removeItem(track.rigKey);
    } else {
      localStorage.setItem(track.rigKey, JSON.stringify(rigObj));
    }
  }

  function autoCorrelatePitch(buffer, sampleRate) {
    const size = buffer.length;
    let rms = 0;
    for (let i = 0; i < size; i++) {
      rms += buffer[i] * buffer[i];
    }
    rms = Math.sqrt(rms / size);
    if (rms < 0.012) return -1;

    let r1 = 0;
    let r2 = size - 1;
    const threshold = 0.2;
    for (let i = 0; i < size / 2; i++) {
      if (Math.abs(buffer[i]) < threshold) {
        r1 = i;
        break;
      }
    }
    for (let i = 1; i < size / 2; i++) {
      if (Math.abs(buffer[size - i]) < threshold) {
        r2 = size - i;
        break;
      }
    }

    const sliced = buffer.slice(r1, r2);
    const n = sliced.length;
    const c = new Array(n).fill(0);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n - i; j++) {
        c[i] += sliced[j] * sliced[j + i];
      }
    }

    let d = 0;
    while (d < n - 1 && c[d] > c[d + 1]) d++;

    let maxVal = -1;
    let maxPos = -1;
    for (let i = d; i < n; i++) {
      if (c[i] > maxVal) {
        maxVal = c[i];
        maxPos = i;
      }
    }

    if (maxPos <= 0) return -1;
    let t0 = maxPos;
    if (t0 > 0 && t0 < n - 1) {
      const x1 = c[t0 - 1];
      const x2 = c[t0];
      const x3 = c[t0 + 1];
      const a = (x1 + x3 - 2 * x2) / 2;
      const b = (x3 - x1) / 2;
      if (a) t0 = t0 - b / (2 * a);
    }

    const freq = sampleRate / t0;
    return freq >= 35 && freq <= 1200 ? freq : -1;
  }

  function frequencyToNoteInfo(freq) {
    const noteNum = 12 * (Math.log(freq / 440) / Math.log(2));
    const midi = Math.round(noteNum) + 69;
    const cents = Math.floor((noteNum - Math.round(noteNum)) * 100);
    const name = NOTE_NAMES[((midi % 12) + 12) % 12];
    const octave = Math.floor(midi / 12) - 1;
    return {
      note: `${name}${octave}`,
      cents,
      freq: freq.toFixed(1)
    };
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
        background: rgba(0, 0, 0, 0.78);
        backdrop-filter: blur(6px);
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
        max-width: 640px;
        background: linear-gradient(180deg, #1e1e1e 0%, #141414 100%);
        color: #ffffff;
        border: 1px solid rgba(255, 255, 255, 0.12);
        border-radius: 14px;
        box-shadow: 0 24px 60px rgba(0, 0, 0, 0.75);
        padding: 20px 22px;
        display: flex;
        flex-direction: column;
        gap: 12px;
        max-height: 90vh;
        overflow-y: auto;
        transition: width 0.18s ease, height 0.18s ease, max-width 0.18s ease;
      }
      .sgt-card.sgt-expanded {
        width: 95vw;
        max-width: 1440px;
        height: 92vh;
        max-height: 92vh;
        overflow: hidden;
      }
      .sgt-changelog-card {
        max-width: 520px;
      }
      .sgt-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        flex-shrink: 0;
      }
      .sgt-header-controls {
        display: flex;
        align-items: center;
        gap: 6px;
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
        padding: 2px 9px;
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
      .sgt-icon-btn {
        background: rgba(255, 255, 255, 0.06);
        border: 1px solid rgba(255, 255, 255, 0.1);
        color: #cccccc;
        font-size: 15px;
        line-height: 1;
        cursor: pointer;
        padding: 5px 9px;
        border-radius: 7px;
      }
      .sgt-icon-btn:hover {
        color: #ffffff;
        background: rgba(255, 255, 255, 0.14);
      }
      .sgt-workspace {
        display: flex;
        flex-direction: column;
        gap: 12px;
        min-height: 0;
      }
      .sgt-card.sgt-expanded .sgt-workspace {
        display: grid;
        grid-template-columns: 420px 1fr;
        gap: 18px;
        flex: 1;
        overflow: hidden;
      }
      .sgt-left-pane,
      .sgt-right-pane {
        display: flex;
        flex-direction: column;
        gap: 12px;
        min-height: 0;
      }
      .sgt-card.sgt-expanded .sgt-left-pane {
        overflow-y: auto;
        padding-right: 4px;
      }
      .sgt-card.sgt-expanded .sgt-right-pane {
        height: 100%;
      }
      .sgt-now-playing {
        font-size: 13px;
        color: #b3b3b3;
        background: rgba(255, 255, 255, 0.04);
        padding: 10px 12px;
        border-radius: 9px;
        border: 1px solid rgba(255, 255, 255, 0.07);
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
        background: #282828;
        color: #e5e5e5;
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 8px;
        padding: 7px 11px;
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
      .sgt-btn-secondary.sgt-active {
        background: rgba(29, 185, 84, 0.18);
        border-color: #1db954;
        color: #1db954;
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
        background: #101010;
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 7px;
        padding: 7px 10px;
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
        font-size: 11px;
        color: #9e9e9e;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .sgt-studio-tabs {
        display: flex;
        gap: 6px;
        flex-wrap: wrap;
      }
      .sgt-card.sgt-expanded .sgt-studio-tabs {
        display: none;
      }
      .sgt-panel {
        background: rgba(255, 255, 255, 0.035);
        border: 1px solid rgba(255, 255, 255, 0.09);
        border-radius: 10px;
        padding: 12px;
        display: none;
        flex-direction: column;
        gap: 10px;
      }
      .sgt-panel.sgt-panel-open,
      .sgt-card.sgt-expanded .sgt-panel {
        display: flex;
      }
      .sgt-panel-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        flex-wrap: wrap;
      }
      .sgt-panel-title {
        font-size: 12px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: #e5e5e5;
      }
      .sgt-select,
      .sgt-input {
        background: #121212;
        color: #f1f1f1;
        border: 1px solid rgba(255, 255, 255, 0.14);
        border-radius: 7px;
        padding: 6px 9px;
        font-size: 12px;
        outline: none;
      }
      .sgt-select:focus,
      .sgt-input:focus {
        border-color: #1db954;
      }
      .sgt-strings-row {
        display: flex;
        gap: 6px;
        flex-wrap: wrap;
      }
      .sgt-string-btn {
        flex: 1;
        min-width: 42px;
        background: #232323;
        color: #ffffff;
        border: 1px solid rgba(255, 255, 255, 0.12);
        border-radius: 7px;
        padding: 7px 6px;
        font-size: 12px;
        font-weight: 700;
        cursor: pointer;
        text-align: center;
      }
      .sgt-string-btn:hover {
        background: #303030;
        border-color: #1db954;
      }
      .sgt-string-btn.sgt-playing-tone {
        background: #1db954;
        color: #000000;
        border-color: #1db954;
      }
      .sgt-tuner-display {
        background: #101010;
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 8px;
        padding: 10px 12px;
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .sgt-tuner-readout {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
      }
      .sgt-tuner-note {
        font-size: 24px;
        font-weight: 800;
        color: #ffffff;
        letter-spacing: -0.02em;
      }
      .sgt-tuner-note.sgt-in-tune {
        color: #1db954;
      }
      .sgt-tuner-meta {
        font-size: 12px;
        color: #a3a3a3;
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      }
      .sgt-meter-track {
        position: relative;
        height: 8px;
        background: #262626;
        border-radius: 999px;
        overflow: hidden;
      }
      .sgt-meter-center {
        position: absolute;
        left: 50%;
        top: 0;
        bottom: 0;
        width: 3px;
        transform: translateX(-50%);
        background: #1db954;
        z-index: 2;
      }
      .sgt-meter-needle {
        position: absolute;
        top: 0;
        bottom: 0;
        width: 10px;
        border-radius: 999px;
        background: #f59e0b;
        left: 50%;
        transform: translateX(-50%);
        transition: left 0.08s ease, background 0.12s ease;
      }
      .sgt-meter-needle.sgt-in-tune {
        background: #1db954;
      }
      .sgt-tuner-hint {
        font-size: 11px;
        color: #9e9e9e;
      }
      .sgt-tone-suggestion {
        background: #121212;
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 8px;
        padding: 9px 11px;
        font-size: 12px;
        line-height: 1.45;
        color: #d4d4d4;
      }
      .sgt-tone-suggestion strong {
        color: #1db954;
      }
      .sgt-rig-grid {
        display: grid;
        grid-template-columns: 1fr;
        gap: 7px;
      }
      .sgt-notes-toolbar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        flex-wrap: wrap;
        flex-shrink: 0;
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
        gap: 5px;
        flex-wrap: wrap;
      }
      .sgt-textarea {
        width: 100%;
        min-height: 200px;
        resize: vertical;
        background: #101010;
        color: #f1f1f1;
        border: 1px solid rgba(255, 255, 255, 0.14);
        border-radius: 9px;
        padding: 12px;
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
        font-size: 12.5px;
        line-height: 1.45;
        box-sizing: border-box;
        outline: none;
      }
      .sgt-card.sgt-expanded .sgt-textarea {
        flex: 1;
        min-height: 0;
        resize: none;
        white-space: pre;
        overflow-x: auto;
        font-size: 13.5px;
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
          <button class="sgt-icon-btn" id="sgt-cl-close-btn" title="Close">&times;</button>
        </div>

        <div class="sgt-cl-section">
          <h3 class="sgt-cl-heading sgt-cl-heading-added">What's Added</h3>
          <ul class="sgt-cl-list">${addedItems}</ul>
        </div>

        <div class="sgt-cl-section">
          <h3 class="sgt-cl-heading sgt-cl-heading-fixed">Improvements & Fixes</h3>
          <ul class="sgt-cl-list">${fixedItems}</ul>
        </div>

        <div class="sgt-cl-footer">
          <button class="sgt-btn-primary" id="sgt-cl-ack-btn">Got it</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);
    document.getElementById("sgt-cl-close-btn").addEventListener("click", closeChangelogModal);
    document.getElementById("sgt-cl-ack-btn").addEventListener("click", closeChangelogModal);
  }

  const TAB_TEMPLATES = {
    six: [
      "e|-----------------------------------------|",
      "B|-----------------------------------------|",
      "G|-----------------------------------------|",
      "D|-----------------------------------------|",
      "A|-----------------------------------------|",
      "E|-----------------------------------------|",
      ""
    ].join("\n"),
    seven: [
      "e|-----------------------------------------|",
      "B|-----------------------------------------|",
      "G|-----------------------------------------|",
      "D|-----------------------------------------|",
      "A|-----------------------------------------|",
      "E|-----------------------------------------|",
      "B|-----------------------------------------|",
      ""
    ].join("\n"),
    bass: [
      "G|-----------------------------------------|",
      "D|-----------------------------------------|",
      "A|-----------------------------------------|",
      "E|-----------------------------------------|",
      ""
    ].join("\n")
  };

  let activeAudioCtx = null;
  let activeMicStream = null;
  let tunerAnimFrame = null;

  function stopTunerAudio() {
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
  }

  function closeModal() {
    stopTunerAudio();
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

    const tuningOptions = Object.keys(TUNINGS)
      .map((t) => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`)
      .join("");

    overlay.innerHTML = `
      <div class="sgt-card" id="sgt-card-root" role="dialog" aria-modal="true" aria-label="Guitar Tabs">
        <div class="sgt-header">
          <h2 class="sgt-title">
            Guitar Tabs
            <span class="sgt-badge" id="sgt-match-badge">Ready</span>
            <button class="sgt-version-pill" id="sgt-version-btn" title="View changelog">v${escapeHtml(EXTENSION_VERSION)}</button>
          </h2>
          <div class="sgt-header-controls">
            <button class="sgt-icon-btn" id="sgt-fullscreen-btn" title="Toggle Fullscreen Studio Mode">⛶</button>
            <button class="sgt-icon-btn" id="sgt-close-btn" title="Close (Esc)">&times;</button>
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
                <div style="display:flex; gap:6px; align-items:center;">
                  <select class="sgt-select" id="sgt-tuning-select">${tuningOptions}</select>
                  <button class="sgt-btn-secondary" id="sgt-mic-btn">Start Mic</button>
                </div>
              </div>
              <div class="sgt-strings-row" id="sgt-strings-row"></div>
              <div class="sgt-tuner-display">
                <div class="sgt-tuner-readout">
                  <span class="sgt-tuner-note" id="sgt-tuner-note">--</span>
                  <span class="sgt-tuner-meta" id="sgt-tuner-meta">Click a string to hear pitch or Start Mic</span>
                </div>
                <div class="sgt-meter-track">
                  <div class="sgt-meter-center"></div>
                  <div class="sgt-meter-needle" id="sgt-meter-needle"></div>
                </div>
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
              <div>
                <span class="sgt-notes-label">Saved Tabs / Notes</span>
                <span class="sgt-notes-status" id="sgt-save-status"></span>
              </div>
              <div class="sgt-notes-tools">
                <button class="sgt-btn-secondary" id="sgt-insert-6" title="Insert 6-string tab">+ 6-Str</button>
                <button class="sgt-btn-secondary" id="sgt-insert-7" title="Insert 7-string tab">+ 7-Str</button>
                <button class="sgt-btn-secondary" id="sgt-insert-bass" title="Insert 4-string bass tab">+ Bass</button>
                <button class="sgt-btn-secondary" id="sgt-copy-notes">Copy</button>
                <button class="sgt-btn-secondary" id="sgt-clear-notes">Clear</button>
              </div>
            </div>

            <textarea
              class="sgt-textarea"
              id="sgt-notes-area"
              spellcheck="false"
              placeholder="Write guitar tabs, chords, tuning, or notes here... (Press Tab to indent, Ctrl+S to save)"
            ></textarea>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);
    document.addEventListener("keydown", handleGlobalKeydown);

    const cardRoot = document.getElementById("sgt-card-root");
    const fullscreenBtn = document.getElementById("sgt-fullscreen-btn");
    const closeBtn = document.getElementById("sgt-close-btn");
    const versionBtn = document.getElementById("sgt-version-btn");
    const nowPlayingEl = document.getElementById("sgt-now-playing");
    const badgeEl = document.getElementById("sgt-match-badge");
    const primaryBtn = document.getElementById("sgt-open-songsterr");
    const ugBtn = document.getElementById("sgt-open-ug");
    const ddgBtn = document.getElementById("sgt-open-ddg");
    const urlPreviewEl = document.getElementById("sgt-url-preview");

    const toggleTunerBtn = document.getElementById("sgt-toggle-tuner");
    const toggleToneBtn = document.getElementById("sgt-toggle-tone");
    const tunerPanel = document.getElementById("sgt-tuner-panel");
    const tonePanel = document.getElementById("sgt-tone-panel");

    const tuningSelect = document.getElementById("sgt-tuning-select");
    const stringsRow = document.getElementById("sgt-strings-row");
    const micBtn = document.getElementById("sgt-mic-btn");
    const tunerNoteEl = document.getElementById("sgt-tuner-note");
    const tunerMetaEl = document.getElementById("sgt-tuner-meta");
    const meterNeedleEl = document.getElementById("sgt-meter-needle");
    const tunerHintEl = document.getElementById("sgt-tuner-hint");

    const toneSuggestionEl = document.getElementById("sgt-tone-suggestion");
    const applyPresetBtn = document.getElementById("sgt-apply-preset");
    const rigTuningInput = document.getElementById("sgt-rig-tuning");
    const rigAmpInput = document.getElementById("sgt-rig-amp");
    const rigPedalsInput = document.getElementById("sgt-rig-pedals");

    const textarea = document.getElementById("sgt-notes-area");
    const saveStatusEl = document.getElementById("sgt-save-status");
    const insert6Btn = document.getElementById("sgt-insert-6");
    const insert7Btn = document.getElementById("sgt-insert-7");
    const insertBassBtn = document.getElementById("sgt-insert-bass");
    const copyBtn = document.getElementById("sgt-copy-notes");
    const clearBtn = document.getElementById("sgt-clear-notes");

    let activeTrack = null;
    let currentTonePreset = DEFAULT_TONE_PRESET;
    let activeUrls = {
      primary: "https://www.songsterr.com/",
      ultimateGuitar: "https://www.ultimate-guitar.com/",
      duckDuckGo: "https://duckduckgo.com/?q=guitar+tabs"
    };
    let clearConfirmTimer = null;
    let pendingSongsterr = null;
    let pendingUg = null;
    let isMicRunning = false;

    function renderStringButtons() {
      const notes = TUNINGS[tuningSelect.value] || TUNINGS["E Standard"];
      stringsRow.innerHTML = notes
        .map(
          (n) =>
            `<button class="sgt-string-btn" data-freq="${n.freq}" data-label="${escapeHtml(n.label)}">${escapeHtml(n.label)}</button>`
        )
        .join("");

      stringsRow.querySelectorAll(".sgt-string-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
          const freq = parseFloat(btn.dataset.freq);
          const label = btn.dataset.label;
          playReferenceTone(freq, label, btn);
        });
      });
    }

    function playReferenceTone(freq, label, btnEl) {
      try {
        if (!activeAudioCtx || activeAudioCtx.state === "closed") {
          const AudioCtx = window.AudioContext || window.webkitAudioContext;
          activeAudioCtx = new AudioCtx();
        }
        if (activeAudioCtx.state === "suspended") {
          activeAudioCtx.resume();
        }

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
        tunerMetaEl.textContent = `Reference: ${freq.toFixed(2)} Hz`;
        meterNeedleEl.style.left = "50%";
        meterNeedleEl.classList.add("sgt-in-tune");

        setTimeout(() => {
          btnEl.classList.remove("sgt-playing-tone");
        }, 2400);
      } catch (_) {
        tunerHintEl.textContent = "Audio playback blocked by system audio policy.";
      }
    }

    async function toggleMicTuner() {
      if (isMicRunning) {
        stopTunerAudio();
        isMicRunning = false;
        micBtn.textContent = "Start Mic";
        micBtn.classList.remove("sgt-active");
        tunerMetaEl.textContent = "Mic stopped";
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false
          }
        });
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        activeAudioCtx = new AudioCtx();
        activeMicStream = stream;

        const source = activeAudioCtx.createMediaStreamSource(stream);
        const analyser = activeAudioCtx.createAnalyser();
        analyser.fftSize = 4096;
        source.connect(analyser);

        const buffer = new Float32Array(analyser.fftSize);
        isMicRunning = true;
        micBtn.textContent = "Stop Mic";
        micBtn.classList.add("sgt-active");
        tunerHintEl.textContent = "Pluck one string at a time near your microphone.";

        const updatePitch = () => {
          if (!isMicRunning) return;
          analyser.getFloatTimeDomainData(buffer);
          const pitch = autoCorrelatePitch(buffer, activeAudioCtx.sampleRate);
          if (pitch !== -1) {
            const info = frequencyToNoteInfo(pitch);
            const inTune = Math.abs(info.cents) <= 4;
            tunerNoteEl.textContent = info.note;
            tunerNoteEl.classList.toggle("sgt-in-tune", inTune);
            const sign = info.cents > 0 ? "+" : "";
            tunerMetaEl.textContent = `${info.freq} Hz (${sign}${info.cents} cents)`;

            const clamped = Math.max(-50, Math.min(50, info.cents));
            const pct = 50 + clamped;
            meterNeedleEl.style.left = `${pct}%`;
            meterNeedleEl.classList.toggle("sgt-in-tune", inTune);
          }
          tunerAnimFrame = requestAnimationFrame(updatePitch);
        };
        updatePitch();
      } catch (_) {
        isMicRunning = false;
        micBtn.textContent = "Start Mic";
        micBtn.classList.remove("sgt-active");
        tunerHintEl.textContent = "Mic blocked by Spotify permissions — click the string buttons above to tune by ear.";
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

    toggleTunerBtn.addEventListener("click", () => {
      const open = tunerPanel.classList.toggle("sgt-panel-open");
      toggleTunerBtn.classList.toggle("sgt-active", open);
    });

    toggleToneBtn.addEventListener("click", () => {
      const open = tonePanel.classList.toggle("sgt-panel-open");
      toggleToneBtn.classList.toggle("sgt-active", open);
    });

    function persistCurrentRig() {
      if (!activeTrack) return;
      saveRig(activeTrack, {
        tuning: rigTuningInput.value,
        amp: rigAmpInput.value,
        pedals: rigPedalsInput.value
      });
      saveStatusEl.textContent = "Rig Saved";
    }

    rigTuningInput.addEventListener("input", persistCurrentRig);
    rigAmpInput.addEventListener("input", persistCurrentRig);
    rigPedalsInput.addEventListener("input", persistCurrentRig);

    applyPresetBtn.addEventListener("click", () => {
      if (!activeTrack || !currentTonePreset) return;
      rigTuningInput.value = currentTonePreset.tuning;
      rigAmpInput.value = currentTonePreset.amp;
      rigPedalsInput.value = currentTonePreset.pedals;
      persistCurrentRig();
    });

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
        pendingSongsterr = null;
        pendingUg = null;
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
      activeUrls.ultimateGuitar = fallbacks.ultimateGuitarSearch;
      activeUrls.duckDuckGo = fallbacks.webSearch;

      badgeEl.textContent = "Matching...";
      primaryBtn.textContent = "Open on Songsterr";
      urlPreviewEl.textContent = fallbacks.songsterrSearch;

      textarea.value = loadNotes(activeTrack);
      saveStatusEl.textContent = textarea.value ? "Loaded" : "";

      const savedRig = loadRig(activeTrack);
      rigTuningInput.value = savedRig.tuning || "";
      rigAmpInput.value = savedRig.amp || "";
      rigPedalsInput.value = savedRig.pedals || "";

      const snapshotKey = activeTrack.storageKey;

      detectToneSuggestion(activeTrack).then(({ genreText, preset }) => {
        if (!activeTrack || activeTrack.storageKey !== snapshotKey) return;
        currentTonePreset = preset;
        toneSuggestionEl.innerHTML = `
          <div>Style: <strong>${escapeHtml(genreText)}</strong> → ${escapeHtml(preset.label)}</div>
          <div>Suggested: ${escapeHtml(preset.amp)}</div>
          <div>Pedals: ${escapeHtml(preset.pedals)}</div>
        `;
      });

      const sPromise = resolveSongsterrUrl(activeTrack);
      const uPromise = resolveUltimateGuitarUrl(activeTrack);
      pendingSongsterr = sPromise;
      pendingUg = uPromise;

      sPromise.then((resolved) => {
        if (pendingSongsterr === sPromise) pendingSongsterr = null;
        if (!activeTrack || activeTrack.storageKey !== snapshotKey) return;
        activeUrls.primary = resolved.url;
        urlPreviewEl.textContent = resolved.url;
        badgeEl.textContent = resolved.isDirect ? "Direct Tab" : "Search Ready";
      });

      uPromise.then((resolved) => {
        if (pendingUg === uPromise) pendingUg = null;
        if (!activeTrack || activeTrack.storageKey !== snapshotKey) return;
        activeUrls.ultimateGuitar = resolved.url;
      });
    }

    closeBtn.addEventListener("click", closeModal);
    versionBtn.addEventListener("click", openChangelogModal);

    primaryBtn.addEventListener("click", async () => {
      if (pendingSongsterr) {
        const prev = primaryBtn.textContent;
        primaryBtn.disabled = true;
        primaryBtn.textContent = "Matching...";
        await Promise.race([pendingSongsterr, new Promise((r) => setTimeout(r, 2500))]);
        primaryBtn.disabled = false;
        if (primaryBtn.textContent === "Matching...") primaryBtn.textContent = prev;
      }
      openExternalUrl(activeUrls.primary);
    });

    ugBtn.addEventListener("click", async () => {
      if (pendingUg) {
        const prev = ugBtn.textContent;
        ugBtn.disabled = true;
        ugBtn.textContent = "Matching...";
        await Promise.race([pendingUg, new Promise((r) => setTimeout(r, 2500))]);
        ugBtn.disabled = false;
        if (ugBtn.textContent === "Matching...") ugBtn.textContent = prev;
      }
      openExternalUrl(activeUrls.ultimateGuitar);
    });

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
        textarea.value = textarea.value.substring(0, start) + "  " + textarea.value.substring(end);
        textarea.selectionStart = textarea.selectionEnd = start + 2;
        if (activeTrack) {
          saveNotes(activeTrack, textarea.value);
          saveStatusEl.textContent = "Saved";
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (activeTrack) {
          saveNotes(activeTrack, textarea.value);
          saveStatusEl.textContent = "Saved ✓";
        }
      }
    });

    function insertTemplate(templateStr) {
      if (!activeTrack) return;
      const prefix = textarea.value && !textarea.value.endsWith("\n") ? "\n\n" : "";
      textarea.value += prefix + templateStr;
      saveNotes(activeTrack, textarea.value);
      saveStatusEl.textContent = "Saved";
      textarea.focus();
    }

    insert6Btn.addEventListener("click", () => insertTemplate(TAB_TEMPLATES.six));
    insert7Btn.addEventListener("click", () => insertTemplate(TAB_TEMPLATES.seven));
    insertBassBtn.addEventListener("click", () => insertTemplate(TAB_TEMPLATES.bass));

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
        clearBtn.textContent = "Confirm?";
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

    const onModalSongChange = () => {
      if (document.getElementById(MODAL_ID)) {
        syncTrackView();
      } else {
        Spicetify.Player.removeEventListener("songchange", onModalSongChange);
      }
    };
    Spicetify.Player.addEventListener("songchange", onModalSongChange);

    await syncTrackView();
  }

  const GUITAR_ICON_SVG = `
    <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true">
      <path d="M6 13c0 1.105-1.12 2-2.5 2S1 14.105 1 13c0-1.104 1.12-2 2.5-2s2.5.896 2.5 2zm9-2c0 1.105-1.12 2-2.5 2s-2.5-.895-2.5-2 1.12-2 2.5-2 2.5.895 2.5 2z"/>
      <path fill-rule="evenodd" d="M14 11V2h1v9h-1zM6 3v10H5V3h1z"/>
      <path d="M5 2.905a1 1 0 0 1 .9-.995l8-.8a1 1 0 0 1 1.1.995V3L5 4V2.905z"/>
    </svg>
  `;

  new Spicetify.Topbar.Button(
    "Guitar Tabs",
    GUITAR_ICON_SVG,
    openModal,
    false
  );

  Spicetify.Player.addEventListener("songchange", scheduleBackgroundPrefetch);
  scheduleBackgroundPrefetch();

  const lastSeenVersion = localStorage.getItem(VERSION_STORAGE_KEY);
  if (lastSeenVersion !== EXTENSION_VERSION) {
    setTimeout(() => {
      document.addEventListener("keydown", handleGlobalKeydown);
      openChangelogModal();
    }, 1500);
  }
})();
