(function () {
  "use strict";

  const PLAYER_CSV_URL = "";      // <- link CSV publicado da aba "player"
  const PLAYLIST_URL_FIXA = "https://soundcloud.com/lucasps0075/sets/playlist-dancehall?si=c9e89c8162e24e498d08c7c702b8e6be&utm_source=clipboard&utm_medium=text&utm_campaign=social_sharing";   // <- opcional: link fixo da playlist (ignora a planilha)
  const SHOW_TRACK_LABEL = true;  // false = não mostra o aviso de faixa (erros continuam aparecendo)

  const SC_API_SRC = "https://w.soundcloud.com/player/api.js";
  const LOAD_TIMEOUT_MS = 12000;  // tempo máximo esperando o widget carregar
  const NUDGE_MS = 1800;          // se não começar a tocar nesse tempo, pede outro toque
  const DOUBLE_MS = 320;          // janela do clique duplo
  const TOAST_MS = 3800;          // duração do aviso de faixa

  const btn = document.getElementById("sound-btn");
  if (!btn) return;

  // ---------- utilidades ----------
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
  let playlistUrl = "";
  let widget = null, iframe = null, pending = null;
  let sounds = [], cur = 0, lastAnnounced = -1;
  let playing = false, wantPlay = false;
  let state = "idle"; // idle | loading | ready | error
  let nudgeTimer = null, lastClick = 0;
  let toast = null, toastTimer = null;

  // ---------- botão ----------
  function ui() {
    const loading = state === "loading" && wantPlay;
    btn.classList.toggle("playing", playing);
    btn.classList.toggle("loading", loading);
    btn.setAttribute("aria-pressed", String(playing));
    const label = playing ? "Pausar o sound system" : "Ligar o sound system";
    btn.setAttribute("aria-label", label);
    btn.title = playing ? label + " (clique duas vezes pra pular a faixa)" : label;
  }

  // ---------- aviso rápido ----------
  function hideToastLater(ms) {
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { if (toast) toast.classList.remove("on"); }, ms);
  }

  function showToast(opts, ms) {
    if (!toast) {
      toast = document.createElement("div");
      toast.className = "sound-toast";
      toast.setAttribute("role", "status");
      toast.setAttribute("aria-live", "polite");
      toast.addEventListener("pointerenter", () => clearTimeout(toastTimer));
      toast.addEventListener("pointerleave", () => hideToastLater(1500));
      document.body.appendChild(toast);
    }
    // textContent de propósito: título e artista vêm de terceiros
    toast.textContent = "";
    const main = document.createElement(opts.href ? "a" : "b");
    main.className = "st-main";
    main.textContent = opts.main;
    if (opts.href) { main.href = opts.href; main.target = "_blank"; main.rel = "noopener"; }
    toast.appendChild(main);
    if (opts.sub) {
      const sub = document.createElement("span");
      sub.className = "st-sub";
      sub.textContent = opts.sub;
      toast.appendChild(sub);
    }
    const r = btn.getBoundingClientRect();
    toast.style.top = (r.bottom + 10) + "px";
    toast.style.right = Math.max(8, window.innerWidth - r.right) + "px";
    toast.classList.add("on");
    hideToastLater(ms || TOAST_MS);
  }

  function announce(i) {
    const s = sounds[i];
    if (!s || !SHOW_TRACK_LABEL) return;
    showToast({
      main: s.title,
      sub: (s.artist ? s.artist + " · " : "") + "via SoundCloud",
      href: s.url
    }, TOAST_MS);
  }

  function showError(msg) {
    state = "error"; playing = false; wantPlay = false;
    clearTimeout(nudgeTimer);
    ui();
    showToast({ main: msg || "Sound system fora do ar por enquanto.", sub: "Toque no ícone pra tentar de novo" }, 6000);
  }

  // ---------- widget do SoundCloud ----------
  function normalize(list) {
    return (list || []).map((s) => ({
      title: s && s.title ? String(s.title) : "Faixa sem título",
      artist: s && s.user && s.user.username ? String(s.user.username) : "",
      url: s && isSoundCloudUrl(s.permalink_url) ? String(s.permalink_url) : ""
    }));
  }

  function syncIndex() {
    if (!widget) return;
    widget.getCurrentSoundIndex((i) => {
      if (typeof i !== "number") return;
      cur = i;
      if (i !== lastAnnounced) { lastAnnounced = i; announce(i); }
    });
  }

  function bindEvents(w) {
    const E = window.SC.Widget.Events;
    w.bind(E.PLAY, () => {
      playing = true; wantPlay = false;
      clearTimeout(nudgeTimer);
      syncIndex(); ui();
    });
    w.bind(E.PAUSE, () => { playing = false; ui(); });
    // ao fim de uma faixa a playlist segue sozinha (o PLAY dispara de novo)
    w.bind(E.FINISH, () => { playing = false; ui(); });
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

    widget = w; cur = 0; lastAnnounced = -1;
    bindEvents(w);
  }

  function ensureWidget() {
    if (widget) return Promise.resolve();
    if (!pending) pending = createWidget().finally(() => { pending = null; });
    return pending;
  }

  function resetWidget() {
    if (iframe) { iframe.remove(); iframe = null; }
    widget = null; sounds = []; cur = 0; lastAnnounced = -1;
    playing = false; state = "idle";
  }

  // ---------- ações ----------
  function startPlayback() {
    wantPlay = true;
    widget.play();
    clearTimeout(nudgeTimer);
    // Alguns navegadores de celular (principalmente iPhone) barram o play iniciado
    // depois do carregamento. Se não começar, pedimos outro toque no ícone.
    nudgeTimer = setTimeout(() => {
      if (!playing && wantPlay && state === "ready") {
        showToast({ main: "Toque no ícone de novo pra começar" }, 5000);
      }
    }, NUDGE_MS);
  }

  async function turnOn() {
    if (state === "error") resetWidget();
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
      if (!wantPlay) { ui(); return; } // a pessoa desistiu durante o carregamento
    }
    ui();
    startPlayback();
  }

  function toggle() {
    btn.classList.add("seen");
    if (state === "loading") { wantPlay = !wantPlay; ui(); return; }
    if (!widget) { turnOn(); return; }
    if (playing) {
      wantPlay = false;
      clearTimeout(nudgeTimer);
      widget.pause();
    } else {
      startPlayback();
    }
  }

  function skipNext() {
    if (!widget) return;
    if (cur >= sounds.length - 1) widget.skip(0); else widget.next();
    widget.play();
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

    btn.addEventListener("click", () => {
      const now = performance.now();
      const isDouble = now - lastClick < DOUBLE_MS;
      lastClick = isDouble ? 0 : now;
      if (isDouble) { skipNext(); return; } // segundo clique: pula (sem widget ainda, é ignorado)
      toggle();
    });
    btn.addEventListener("keydown", (e) => {
      if (e.key === "ArrowRight") { e.preventDefault(); skipNext(); }
    });

    ui();
    btn.hidden = false;
  })();
})();