(function guitarTabsExtension() {
  if (!Spicetify || !Spicetify.React || !Spicetify.ReactDOM || !Spicetify.Player || !Spicetify.Topbar || !Spicetify.PopupModal) {
    setTimeout(guitarTabsExtension, 300);
    return;
  }

  const { React, ReactDOM } = Spicetify;
  const { useState, useEffect, useRef } = React;
  const qMark = String.fromCharCode(63);
  const colon = String.fromCharCode(58);
  const tabTemplate = "e|----------------|\nB|----------------|\nG|----------------|\nD|----------------|\nA|----------------|\nE|----------------|\n\n";
  const iconSvg = '<svg role="img" height="16" width="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>';

  const styles = {
    wrap: { padding: "8px 4px", color: "var(--spice-text)" },
    row: { display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center", marginBottom: "14px" },
    btnPri: { padding: "11px 18px", borderRadius: "8px", backgroundColor: "#1693FF", color: "#ffffff", textDecoration: "none", fontWeight: "700", fontSize: "14px", display: "inline-block" },
    btnSm: { padding: "6px 10px", borderRadius: "6px", backgroundColor: "rgba(255,255,255,0.08)", color: "var(--spice-text)", border: "1px solid rgba(255,255,255,0.15)", fontSize: "12px", cursor: "pointer" },
    input: { flex: "1", padding: "10px 12px", borderRadius: "8px", backgroundColor: "rgba(0,0,0,0.3)", color: "var(--spice-text)", border: "1px solid rgba(255,255,255,0.15)", fontSize: "13px" },
    ta: { width: "100%", height: "340px", padding: "14px", borderRadius: "8px", backgroundColor: "rgba(0,0,0,0.3)", color: "var(--spice-text)", border: "1px solid rgba(255,255,255,0.15)", fontFamily: "monospace", fontSize: "14px", lineHeight: "1.5", resize: "vertical", boxSizing: "border-box" }
  };

  function getTrackInfo() {
    const item = Spicetify.Player.data && Spicetify.Player.data.item;
    if (!item) return { title: "", rawTitle: "", artist: "", uri: "" };

    const rawTitle = item.name || "";
    const title = rawTitle
      .replace(/\s*[-(\[].*?(remaster|live|version|edit|mix|acoustic).*$/i, "")
      .trim();

    let artist = "";
    if (Array.isArray(item.artists) && item.artists.length > 0 && item.artists[0].name) {
      artist = item.artists[0].name;
    } else if (item.metadata && item.metadata.artist_name) {
      artist = item.metadata.artist_name;
    }

    return {
      title: title,
      rawTitle: rawTitle,
      artist: artist,
      uri: item.uri || artist + "-" + title
    };
  }

  function GuitarTabsModal() {
    const [track, setTrack] = useState(getTrackInfo);
    const [notes, setNotes] = useState("");
    const [customUrl, setCustomUrl] = useState("");
    const [scrollSpeed, setScrollSpeed] = useState(0);
    const taRef = useRef(null);

    useEffect(function () {
      function onSongChange() {
        setTrack(getTrackInfo());
        setScrollSpeed(0);
      }
      Spicetify.Player.addEventListener("songchange", onSongChange);
      return function () {
        Spicetify.Player.removeEventListener("songchange", onSongChange);
      };
    }, []);

    useEffect(function () {
      if (!track.uri) return;
      setNotes(localStorage.getItem("guitar-tabs" + colon + "notes" + colon + track.uri) || "");
      setCustomUrl(localStorage.getItem("guitar-tabs" + colon + "url" + colon + track.uri) || "");
    }, [track.uri]);

    useEffect(function () {
      if (!scrollSpeed) return;
      const timer = setInterval(function () {
        if (taRef.current) taRef.current.scrollTop += scrollSpeed;
      }, 110);
      return function () {
        clearInterval(timer);
      };
    }, [scrollSpeed]);

    function updateNotes(val) {
      setNotes(val);
      if (track.uri) {
        localStorage.setItem("guitar-tabs" + colon + "notes" + colon + track.uri, val);
      }
    }

    function updateUrl(val) {
      setCustomUrl(val);
      if (track.uri) {
        localStorage.setItem("guitar-tabs" + colon + "url" + colon + track.uri, val);
      }
    }

    const fullQuery = (track.artist ? track.artist + " " + track.title : track.title).trim();
    const luckyQuery = encodeURIComponent("!ducky site" + colon + "//songsterr.com " + fullQuery);
    const autoSongsterrUrl = "https" + colon + "//duckduckgo.com" + qMark + "q=" + luckyQuery;
    const finalSongsterrUrl = customUrl.trim() ? customUrl.trim() : autoSongsterrUrl;

    return React.createElement(
      "div",
      { style: styles.wrap },
      React.createElement(
        "p",
        { style: { opacity: 0.85, marginTop: 0, marginBottom: "16px", fontSize: "1.05rem" } },
        track.rawTitle
          ? "Now Playing" + colon + " " + track.rawTitle + (track.artist ? " — " + track.artist : "")
          : "Play a song in Spotify to load guitar tabs"
      ),

      track.title &&
        React.createElement(
          "div",
          { style: styles.row },
          React.createElement(
            "a",
            { href: finalSongsterrUrl, target: "_blank", rel: "noopener noreferrer", style: styles.btnPri },
            customUrl.trim() ? "Open Pinned Songsterr Tab ↗" : "Jump Straight to Songsterr Tab ↗"
          )
        ),

      track.title &&
        React.createElement(
          "div",
          { style: Object.assign({}, styles.row, { marginBottom: "20px" }) },
          React.createElement("input", {
            type: "text",
            value: customUrl,
            onChange: function (e) { updateUrl(e.target.value); },
            placeholder: "Optional" + colon + " Paste a specific Songsterr link here to pin it permanently for this song...",
            style: styles.input
          }),
          customUrl.trim() &&
            React.createElement(
              "button",
              { type: "button", style: styles.btnSm, onClick: function () { updateUrl(""); } },
              "Clear"
            )
        ),

      React.createElement(
        "div",
        { style: Object.assign({}, styles.row, { justifyContent: "space-between", marginBottom: "8px" }) },
        React.createElement("h3", { style: { margin: 0, fontSize: "15px" } }, "Saved Guitar Tab Notes (Auto-saved per song)"),
        React.createElement(
          "div",
          { style: { display: "flex", gap: "8px" } },
          React.createElement(
            "button",
            {
              type: "button",
              style: styles.btnSm,
              onClick: function () {
                updateNotes(notes + (notes && !notes.endsWith("\n") ? "\n\n" : "") + tabTemplate);
              }
            },
            "+ Tab Lines"
          ),
          React.createElement(
            "button",
            {
              type: "button",
              style: styles.btnSm,
              onClick: function () { setScrollSpeed((scrollSpeed + 1) % 4); }
            },
            scrollSpeed ? "Auto-Scroll" + colon + " " + scrollSpeed + "x" : "Auto-Scroll" + colon + " Off"
          )
        )
      ),

      React.createElement("textarea", {
        ref: taRef,
        value: notes,
        onChange: function (e) { updateNotes(e.target.value); },
        placeholder: "Paste ASCII guitar tabs or chord progressions here...",
        style: styles.ta
      })
    );
  }

  function openGuitarTabsModal() {
    const container = document.createElement("div");
    ReactDOM.render(React.createElement(GuitarTabsModal), container);
    Spicetify.PopupModal.display({
      title: "Guitar Tabs",
      content: container,
      isLarge: true
    });
  }

  new Spicetify.Topbar.Button("Guitar Tabs", iconSvg, openGuitarTabsModal);
})();