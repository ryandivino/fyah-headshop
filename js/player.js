(function () {
  "use strict";

  const PLAYER_CSV_URL = ""; 
  const PLAYLIST_URL_FIXA = "https://soundcloud.com/lucasps0075/sets/playlist-dancehall?si=c9e89c8162e24e498d08c7c702b8e6be&utm_source=clipboard&utm_medium=text&utm_campaign=social_sharing";

  const SC_API_SRC = "https://w.soundcloud.com/player/api.js";
  const LOAD_TIMEOUT_MS = 12000; 
  const NUDGE_MS = 1800;

  const btn = document.getElementById("sound-btn");
  if (!btn) return;

  // ---------- utilidades ----------
  const fmt = (ms) => {
    const s = Math.max(0, Math.floor(ms / 1000));
    return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
  };

  function parseCsv(text) {
    const rows = [];
    let row = [], field = "", inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQuotes) {
        if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
        else if (c === '"') inQuotes = false;
        else field += c;
      } else if (c === '"') inQuotes = true;
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\n" || c === "\r") {
        if (field !== "" || row.length) { row.push(field); rows.push(row); }
        row = []; field = "";
        if (c === "\r" && text[i + 1] === "\n") i++;
      } else field += c;
    }
    if (field !== "" || row.length) { row.push(field); rows.push(row); }
    return rows;
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      if (window.SC && window.SC.Widget) return resolve();
      const s = document.createElement("script");
      s.src = src;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error("script"));
      document.head.appendChild(s);
    });
  }

  function isSoundCloudUrl(u) {
    try { return new URL(u).hostname.replace(/^(www|m)\./, "") === "soundcloud.com"; }
    catch (e) { return false; }
  }

  async function getPlaylistUrl() {
    if (PLAYLIST_URL_FIXA) return PLAYLIST_URL_FIXA.trim();
    if (!PLAYER_CSV_URL) return "";
    try {
      const res = await fetch(PLAYER_CSV_URL, { cache: "no-store" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const rows = parseCsv(await res.text());
      const row = rows.find((r) => (r[0] || "").trim().toLowerCase() === "playlist");
      return row ? (row[1] || "").trim() : "";
    } catch (err) {
      console.error("[player] não foi possível ler a planilha:", err);
      return "";
    }
  }

  // ---------- estado ----------
  const ICON = {
    play: '<svg viewBox="0 0 24 24"><path d="M7 4v16l13-8z"/></svg>',
    pause: '<svg viewBox="0 0 24 24"><path d="M6 4h4v16H6zM14 4h4v16h-4z"/></svg>',
    prev: '<svg viewBox="0 0 24 24"><path d="M6 5h2v14H6zM20 5v14L9 12z"/></svg>',
    next: '<svg viewBox="0 0 24 24"><path d="M16 5h2v14h-2zM4 5v14l11-7z"/></svg>',
    list: '<svg viewBox="0 0 24 24"><path d="M4 6h16v2H4zM4 11h16v2H4zM4 16h10v2H4z"/></svg>'
  };

  let playlistUrl = "";
  let root = null, els = {};
  let widget = null, iframe = null, pending = null;
  let sounds = [], cur = 0, posMs = 0;
  let playing = false, wantPlay = false, seeking = false;
  let state = "idle"; // idle | loading | ready | error
  let notice = "", nudgeTimer = null;

  // ---------- interface ----------
  function buildPlayer() {
    const el = document.createElement("div");
    el.className = "player";
    el.setAttribute("role", "region");
    el.setAttribute("aria-label", "Sound system da Fyah");
    el.innerHTML =
      '<div class="panel"><div class="panel-in">' +
        '<h3>Playlist via SoundCloud · <a class="sc-link" target="_blank" rel="noopener">abrir no SoundCloud</a></h3>' +
        '<div class="list"></div>' +
      '</div></div>' +
      '<div class="row">' +
        '<div class="disc" aria-hidden="true"></div>' +
        '<div class="meta">' +
          '<b><span class="eq" aria-hidden="true"><i></i><i></i><i></i></span><span class="title"></span></b>' +
          '<span class="artist"></span>' +
        '</div>' +
        '<div class="ctrl">' +
          '<button type="button" class="ic prev" aria-label="Faixa anterior">' + ICON.prev + '</button>' +
          '<button type="button" class="ic main play" aria-label="Tocar"></button>' +
          '<button type="button" class="ic next" aria-label="Próxima faixa">' + ICON.next + '</button>' +
          '<button type="button" class="ic toggle" aria-label="Abrir lista de faixas" aria-expanded="false">' + ICON.list + '</button>' +
        '</div>' +
      '</div>' +
      '<div class="bar">' +
        '<time class="cur">0:00</time>' +
        '<div class="seek" role="slider" tabindex="0" aria-label="Progresso da faixa" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><div><i></i></div></div>' +
        '<time class="dur">0:00</time>' +
      '</div>' +
      '<div class="err"><span class="err-msg"></span><button type="button" class="retry">Tentar de novo</button></div>';
    document.body.appendChild(el);

    const q = (s) => el.querySelector(s);
    els = {
      title: q(".title"), artist: q(".artist"), cur: q(".cur"), dur: q(".dur"),
      fill: q(".seek i"), seek: q(".seek"), play: q(".play"), prev: q(".prev"),
      next: q(".next"), toggle: q(".toggle"), list: q(".list"),
      retry: q(".retry"), errMsg: q(".err-msg"), scLink: q(".sc-link")
    };
    els.scLink.href = playlistUrl;
    return el;
  }

  function paintProgress() {
    const dur = (sounds[cur] && sounds[cur].duration) || 0;
    const pct = dur ? Math.min(100, (posMs / dur) * 100) : 0;
    els.cur.textContent = fmt(posMs);
    els.fill.style.width = pct + "%";
    els.seek.setAttribute("aria-valuenow", Math.round(pct));
  }

  function ui() {
    const s = sounds[cur] || {};
    const loading = state === "loading";
    root.classList.toggle("playing", playing);
    btn.classList.toggle("playing", playing);

    els.title.textContent = loading ? "Carregando playlist..." : (s.title || "Sound system");
    els.artist.textContent = notice ||
      (loading || !s.artist ? "via SoundCloud" : s.artist + " · via SoundCloud");
    root.style.setProperty("--cover",
      !loading && s.cover ? 'url("' + s.cover.replace(/"/g, "%22") + '")' : "var(--p-yellow)");

    els.dur.textContent = fmt(s.duration || 0);
    paintProgress();
    els.play.innerHTML = playing ? ICON.pause : ICON.play;
    els.play.setAttribute("aria-label", playing ? "Pausar" : "Tocar");
    els.list.querySelectorAll(".track").forEach((t, i) => t.classList.toggle("on", i === cur));
  }

  function renderList() {
    els.list.textContent = "";
    sounds.forEach((s, i) => {
      // textContent de propósito: título e artista vêm de terceiros
      const b = document.createElement("button");
      b.type = "button"; b.className = "track"; b.dataset.i = i;
      const n = document.createElement("span"); n.className = "n"; n.textContent = i + 1;
      const tt = document.createElement("span"); tt.className = "tt";
      const t = document.createElement("b"); t.textContent = s.title;
      const a = document.createElement("span"); a.textContent = s.artist;
      tt.append(t, a);
      const d = document.createElement("span"); d.className = "du"; d.textContent = fmt(s.duration);
      b.append(n, tt, d);
      els.list.appendChild(b);
    });
  }

  function setBar(on) {
    root.classList.toggle("show", on);
    document.body.classList.toggle("player-on", on);
    btn.classList.add("seen");
    btn.setAttribute("aria-pressed", on);
    const label = on ? "Desligar o sound system" : "Ligar o sound system";
    btn.setAttribute("aria-label", label);
    btn.title = label;
    if (!on) {
      root.classList.remove("open");
      els.toggle.classList.remove("on");
      els.toggle.setAttribute("aria-expanded", "false");
    }
  }

  function showError(msg) {
    state = "error"; playing = false; wantPlay = false;
    clearTimeout(nudgeTimer);
    els.errMsg.textContent = msg || "Sound system fora do ar por enquanto.";
    root.classList.add("error");
    ui();
  }

  // ---------- widget do SoundCloud ----------
  function normalize(list) {
    return (list || []).map((s) => {
      const cover = (s && (s.artwork_url || (s.user && s.user.avatar_url))) || "";
      return {
        title: s && s.title ? String(s.title) : "Faixa sem título",
        artist: s && s.user && s.user.username ? String(s.user.username) : "",
        duration: Number(s && s.duration) || 0,
        cover: cover ? String(cover).replace("-large.", "-t200x200.") : ""
      };
    });
  }

  function syncIndex() {
    if (!widget) return;
    widget.getCurrentSoundIndex((i) => {
      if (typeof i === "number" && i !== cur) { cur = i; posMs = 0; }
      ui();
    });
  }

  function bindEvents(w) {
    const E = window.SC.Widget.Events;
    w.bind(E.PLAY, () => {
      playing = true; wantPlay = false; notice = "";
      clearTimeout(nudgeTimer);
      syncIndex(); ui();
    });
    w.bind(E.PAUSE, () => { playing = false; ui(); });
    // ao fim de uma faixa a playlist segue sozinha (o PLAY dispara de novo)
    w.bind(E.FINISH, () => { playing = false; ui(); });
    w.bind(E.PLAY_PROGRESS, (d) => {
      if (seeking) return;
      posMs = (d && d.currentPosition) || 0;
      paintProgress();
    });
    w.bind(E.ERROR, () => showError("O SoundCloud não conseguiu tocar essa playlist."));
  }

  async function createWidget() {
    await loadScript(SC_API_SRC);
    iframe = document.createElement("iframe");
    iframe.title = "Player do SoundCloud (oculto)";
    iframe.allow = "autoplay";
    iframe.setAttribute("aria-hidden", "true");
    iframe.tabIndex = -1;
    iframe.style.cssText = "position:fixed;left:-9999px;top:0;width:300px;height:166px;border:0;";
    iframe.src = "https://w.soundcloud.com/player/?url=" + encodeURIComponent(playlistUrl) +
      "&auto_play=false&hide_related=true&show_comments=false&show_user=false" +
      "&show_reposts=false&show_teaser=false&visual=false";
    document.body.appendChild(iframe);

    const w = window.SC.Widget(iframe);
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("timeout")), LOAD_TIMEOUT_MS);
      w.bind(window.SC.Widget.Events.READY, () => { clearTimeout(t); resolve(); });
    });
    const list = await new Promise((resolve) => w.getSounds(resolve));
    sounds = normalize(list);
    if (!sounds.length) throw new Error("vazia");

    widget = w; cur = 0; posMs = 0;
    bindEvents(w);
    renderList();
  }

  function ensureWidget() {
    if (widget) return Promise.resolve();
    if (!pending) pending = createWidget().finally(() => { pending = null; });
    return pending;
  }

  function resetWidget() {
    if (iframe) { iframe.remove(); iframe = null; }
    widget = null; sounds = []; cur = 0; posMs = 0;
    playing = false; state = "idle"; notice = "";
    root.classList.remove("error");
  }

  // ---------- fluxo ligar / desligar ----------
  function startPlayback() {
    widget.play();
    clearTimeout(nudgeTimer);
    nudgeTimer = setTimeout(() => {
      if (!playing && wantPlay && state === "ready") {
        notice = "Toque em play pra começar";
        ui();
      }
    }, NUDGE_MS);
  }

  async function turnOn() {
    if (state === "error") resetWidget();
    setBar(true);
    wantPlay = true;
    if (!widget) {
      state = "loading"; ui();
      try {
        await ensureWidget();
      } catch (err) {
        console.error("[player]", err);
        showError(err && err.message === "vazia"
          ? "Essa playlist está vazia ou é privada."
          : "Sound system fora do ar por enquanto.");
        return;
      }
      state = "ready";
      if (!root.classList.contains("show")) { ui(); return; } // desligou durante o carregamento
    }
    ui();
    startPlayback();
  }

  function turnOff() {
    wantPlay = false; notice = "";
    clearTimeout(nudgeTimer);
    if (widget && playing) widget.pause();
    setBar(false);
  }

  // ---------- eventos da interface ----------
  function wire() {
    btn.addEventListener("click", () => (root.classList.contains("show") ? turnOff() : turnOn()));

    els.play.addEventListener("click", () => {
      if (!widget) return;
      if (playing) widget.pause();
      else { notice = ""; widget.play(); }
      ui();
    });
    els.next.addEventListener("click", () => { if (widget) widget.next(); });
    els.prev.addEventListener("click", () => {
      if (!widget) return;
      if (posMs > 3000) widget.seekTo(0); else widget.prev();
    });
    els.toggle.addEventListener("click", () => {
      const open = root.classList.toggle("open");
      els.toggle.classList.toggle("on", open);
      els.toggle.setAttribute("aria-expanded", open);
    });
    els.list.addEventListener("click", (e) => {
      const b = e.target.closest(".track");
      if (!b || !widget) return;
      widget.skip(Number(b.dataset.i));
      widget.play();
    });
    els.retry.addEventListener("click", () => { resetWidget(); turnOn(); });

    const seekFrom = (e) => {
      const r = els.seek.getBoundingClientRect();
      const f = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
      posMs = f * ((sounds[cur] && sounds[cur].duration) || 0);
      paintProgress();
    };
    els.seek.addEventListener("pointerdown", (e) => {
      if (!widget) return;
      seeking = true;
      els.seek.setPointerCapture(e.pointerId);
      seekFrom(e);
    });
    els.seek.addEventListener("pointermove", (e) => { if (seeking) seekFrom(e); });
    els.seek.addEventListener("pointerup", () => {
      if (!seeking) return;
      seeking = false;
      widget.seekTo(posMs);
    });
    els.seek.addEventListener("pointercancel", () => { seeking = false; });
    els.seek.addEventListener("keydown", (e) => {
      if (!widget) return;
      const d = (sounds[cur] && sounds[cur].duration) || 0;
      if (e.key === "ArrowRight") widget.seekTo(Math.min(d, posMs + 5000));
      if (e.key === "ArrowLeft") widget.seekTo(Math.max(0, posMs - 5000));
    });
  }

  // ---------- início ----------
  (async function init() {
    const url = await getPlaylistUrl();
    if (!url) return; // sem conteúdo: o botão continua escondido
    if (!isSoundCloudUrl(url)) {
      console.warn("[player] o link não é do SoundCloud (use soundcloud.com/..., não o link encurtado). Botão escondido:", url);
      return;
    }
    playlistUrl = new URL(url).href;
    root = buildPlayer();
    wire();
    ui();
    btn.hidden = false;
  })();
})();