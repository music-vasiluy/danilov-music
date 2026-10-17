/* Данила Васильев — сайт песен.
   Данные берутся из data/songs.json (его обновляет синхронизация с Telegram).
   Посмотреть оформление с примерами: откройте сайт с ?preview=demo */

(() => {
  "use strict";

  const CONTACTS = {
    email: "vasilijdanilov93@gmail.com",
    phoneDisplay: "8 913 700-89-60",
    phoneTel: "+79137008960",
    telegram: "https://t.me/Danilov_Vasilii_music",
  };

  const listEl = document.getElementById("songs-list");
  const emptyEl = document.getElementById("songs-empty");
  const tpl = document.getElementById("song-template");
  const modal = document.getElementById("contact-modal");
  const modalSong = document.getElementById("modal-song");
  const modalMail = document.getElementById("modal-mail");
  const toastEl = document.getElementById("toast");

  const byId = new Map();

  /* ---------- Вспомогательное ---------- */

  const monthFmt = new Intl.DateTimeFormat("ru-RU", { month: "long", year: "numeric" });

  function fmtDate(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return monthFmt.format(d);
  }

  function fmtDur(seconds) {
    const s = Math.round(Number(seconds));
    if (!Number.isFinite(s) || s <= 0) return "";
    const m = Math.floor(s / 60);
    const rem = s % 60;
    return `${m}:${String(rem).padStart(2, "0")}`;
  }

  const MEDIA_LABEL = {
    audio: "аудио",
    voice: "запись",
    document: "файл",
    video: "видео",
    photo: "обложка",
    text: "текст",
  };

  let toastTimer = 0;
  function toast(text) {
    clearTimeout(toastTimer);
    toastEl.textContent = text;
    toastEl.hidden = false;
    requestAnimationFrame(() => toastEl.classList.add("show"));
    toastTimer = setTimeout(() => {
      toastEl.classList.remove("show");
      setTimeout(() => { toastEl.hidden = true; }, 320);
    }, 1900);
  }

  /* ---------- Плеер внизу экрана ---------- */

  const dockEl = document.getElementById("player-dock");
  const dockToggle = dockEl.querySelector("[data-dock-toggle]");
  const dockCloseBtn = dockEl.querySelector("[data-dock-close]");
  const dockTitleEl = document.getElementById("dock-title");
  const dockRange = document.getElementById("dock-range");
  const dockFill = document.getElementById("dock-fill");
  const dockTime = document.getElementById("dock-time");

  const audio = new Audio();
  audio.preload = "none"; // файл загружается только в момент воспроизведения

  let currentSong = null; // песня в нижнем плеере
  let currentCard = null; // её карточка
  let dockSeeking = false;
  let tickId = 0;

  const total = () =>
    Number.isFinite(audio.duration) && audio.duration > 0
      ? audio.duration
      : Number(currentSong && currentSong.duration) || 0;

  function paintDock() {
    const d = total();
    const ratio = d ? Math.min(1, audio.currentTime / d) : 0;
    dockFill.style.width = `${ratio * 100}%`;
    if (!dockSeeking) dockRange.value = String(Math.round(ratio * 1000));
    dockTime.textContent = fmtDur(audio.currentTime) || "0:00";
  }

  function syncLyrics() {
    if (currentCard && typeof currentCard.__syncLyrics === "function") currentCard.__syncLyrics();
  }

  function clearHighlight() {
    document.querySelectorAll(".lyrics-line .w.is-current").forEach((el) => el.classList.remove("is-current"));
    document.querySelectorAll(".lyrics-line.is-active").forEach((el) => el.classList.remove("is-active"));
  }

  function tick() {
    tickId = 0;
    paintDock();
    syncLyrics();
    if (!audio.paused && !audio.ended) tickId = requestAnimationFrame(tick);
  }

  function ensureTick(on) {
    if (on) {
      if (!tickId) tickId = requestAnimationFrame(tick);
    } else if (tickId) {
      cancelAnimationFrame(tickId);
      tickId = 0;
      paintDock();
      syncLyrics();
    }
  }

  function markCard() {
    document.querySelectorAll(".song.is-current").forEach((n) => n.classList.remove("is-current"));
    if (currentCard) currentCard.classList.add("is-current");
  }

  function playSong(song, node) {
    if (currentSong === song && !dockEl.hidden) {
      // Та же песня: пауза / продолжить.
      if (audio.paused) audio.play().catch(() => toast("Не удалось включить запись"));
      else audio.pause();
      return;
    }

    clearHighlight();
    if (currentCard && currentCard !== node && typeof currentCard.__resetLyrics === "function") {
      currentCard.__resetLyrics();
    }
    currentSong = song;
    currentCard = node;
    dockTitleEl.textContent = song.title || "Без названия";
    audio.src = song.audio; // загрузка стартует только сейчас
    paintDock();
    if (dockEl.hidden) {
      dockEl.hidden = false;
      document.body.classList.add("has-dock");
    }
    markCard();
    audio.play().catch(() => toast("Не удалось включить запись"));
  }

  audio.addEventListener("loadedmetadata", () => { paintDock(); syncLyrics(); });
  audio.addEventListener("play", () => {
    dockToggle.dataset.playing = "true";
    dockToggle.setAttribute("aria-label", "Пауза");
    ensureTick(true);
  });
  audio.addEventListener("pause", () => {
    dockToggle.dataset.playing = "false";
    dockToggle.setAttribute("aria-label", "Воспроизвести");
    ensureTick(false);
  });
  audio.addEventListener("ended", () => {
    audio.currentTime = 0;
    dockToggle.dataset.playing = "false";
    ensureTick(false);
  });

  dockToggle.addEventListener("click", () => {
    if (!currentSong) return;
    if (audio.paused) audio.play().catch(() => toast("Не удалось включить запись"));
    else audio.pause();
  });

  dockRange.addEventListener("input", () => {
    dockSeeking = true;
    const d = total();
    if (d) audio.currentTime = (Number(dockRange.value) / 1000) * d;
    paintDock();
    syncLyrics();
  });
  const stopDockSeek = () => { dockSeeking = false; };
  dockRange.addEventListener("change", stopDockSeek);
  dockRange.addEventListener("pointerup", stopDockSeek);

  dockCloseBtn.addEventListener("click", () => {
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
    clearHighlight();
    if (currentCard && typeof currentCard.__resetLyrics === "function") currentCard.__resetLyrics();
    currentSong = null;
    currentCard = null;
    dockEl.hidden = true;
    document.body.classList.remove("has-dock");
    markCard();
  });

  /* ---------- Текст песни (караоке с подсветкой слов) ---------- */

  function num(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  /* Приводит данные к виду [{t, words: [{w, t}]}] — с запасными вариантами. */
  function normalizeTimed(raw, duration) {
    if (!Array.isArray(raw) || raw.length === 0) return null;
    const lines = [];
    raw.forEach((item) => {
      if (typeof item === "string") {
        const words = item.trim().split(/\s+/).filter(Boolean).map((w) => ({ w, t: null }));
        if (words.length) lines.push({ t: null, words });
        return;
      }
      if (!item || typeof item !== "object") return;
      let words = null;
      if (Array.isArray(item.words) && item.words.length) {
        words = item.words
          .map((w) => (typeof w === "string"
            ? { w: w.trim(), t: null }
            : { w: String((w && (w.w || w.word)) || "").trim(), t: num(w && (w.t != null ? w.t : w.start)) }))
          .filter((w) => w.w);
      }
      const text = String(item.text || item.line || "").trim();
      if (!words || !words.length) {
        if (!text) return;
        words = text.split(/\s+/).filter(Boolean).map((w) => ({ w, t: null }));
      }
      lines.push({ t: num(item.t != null ? item.t : item.start), words });
    });
    if (!lines.length) return null;

    const dur = Number(duration) > 1 ? Number(duration) : lines.length * 4;
    lines.forEach((ln, i) => {
      if (ln.t == null) ln.t = 0.6 + Math.max(0, dur - 1.4) * (i / lines.length);
    });
    lines.sort((a, b) => a.t - b.t);
    lines.forEach((ln, i) => {
      const start = ln.t;
      const end = i + 1 < lines.length ? Math.max(lines[i + 1].t, start + 0.4) : Math.max(dur, start + 0.4);
      const step = (end - start) / Math.max(1, ln.words.length);
      ln.words.forEach((w, j) => {
        if (w.t == null) w.t = start + step * j;
      });
      ln.words.sort((a, b) => a.t - b.t);
    });
    return lines;
  }

  function setupKaraoke(node, song, timed) {
    const lyricsSec = node.querySelector(".lyrics");
    const body = node.querySelector(".lyrics-body");
    const toggleBtn = node.querySelector(".lyrics-toggle");
    const textBtn = node.querySelector("[data-lyrics]");

    let built = false;
    let linesWrap = null;
    const lineEls = [];
    const wordEls = [];
    let lastLine = -2;
    let lastWord = -2;

    function build() {
      built = true;
      body.textContent = "";
      linesWrap = document.createElement("div");
      linesWrap.className = "lyrics-lines";
      timed.forEach((ln) => {
        const line = document.createElement("div");
        line.className = "lyrics-line";
        const spanList = [];
        ln.words.forEach((w, i) => {
          const span = document.createElement("span");
          span.className = "w";
          span.textContent = w.w;
          line.appendChild(span);
          spanList.push(span);
          if (i < ln.words.length - 1) line.appendChild(document.createTextNode(" "));
        });
        linesWrap.appendChild(line);
        lineEls.push(line);
        wordEls.push(spanList);
      });
      body.appendChild(linesWrap);
      lyricsSec.classList.add("lyrics-karaoke");
      toggleBtn.hidden = true;
    }

    function reset() {
      lastLine = -2;
      lastWord = -2;
      if (!built) return;
      lineEls.forEach((el) => el.classList.remove("is-active", "is-past"));
      wordEls.forEach((arr) => arr.forEach((el) => el.classList.remove("is-current")));
      if (linesWrap) linesWrap.style.transform = "translateY(0)";
    }

    /* Обновляет окно из 4 строк и подсветку читаемого слова. */
    function sync() {
      if (!built || lyricsSec.hidden || currentSong !== song) return;
      const t = audio.currentTime;

      let li = -1;
      for (let i = 0; i < timed.length; i++) {
        if (timed[i].t <= t + 0.03) li = i;
        else break;
      }
      let wi = -1;
      if (li >= 0) {
        const ws = timed[li].words;
        for (let i = 0; i < ws.length; i++) {
          if (ws[i].t <= t + 0.03) wi = i;
          else break;
        }
      }

      if (li !== lastLine) {
        lineEls.forEach((el, i) => {
          el.classList.toggle("is-active", i === li);
          el.classList.toggle("is-past", i < li);
        });
        const start = li >= 0 ? Math.min(li, lineEls.length - 1) : 0;
        if (lineEls[start] && linesWrap) {
          linesWrap.style.transform = `translateY(${-lineEls[start].offsetTop}px)`;
        }
      }

      if (li !== lastLine || wi !== lastWord) {
        if (lastLine >= 0 && lastWord >= 0 && wordEls[lastLine] && wordEls[lastLine][lastWord]) {
          wordEls[lastLine][lastWord].classList.remove("is-current");
        }
        if (li >= 0 && wi >= 0 && wordEls[li] && wordEls[li][wi]) {
          wordEls[li][wi].classList.add("is-current");
        }
        lastLine = li;
        lastWord = wi;
      }
    }

    textBtn.hidden = false;
    textBtn.addEventListener("click", () => {
      const open = lyricsSec.hidden;
      if (open && !built) build();
      lyricsSec.hidden = !open;
      textBtn.setAttribute("aria-expanded", String(open));
      node.querySelector(".song-panel").hidden = lyricsSec.hidden;
      if (open) sync();
    });

    node.__syncLyrics = sync;
    node.__resetLyrics = reset;
  }

  /* ---------- Отрисовка песен ---------- */

  function renderSong(song) {
    const node = tpl.content.firstElementChild.cloneNode(true);
    node.dataset.songId = song.id || "";

    const coverImg = node.querySelector(".song-cover-img");
    const coverPh = node.querySelector(".song-cover-ph");
    if (song.cover) {
      coverImg.src = song.cover;
      coverImg.alt = `Обложка: ${song.title || "песня"}`;
      coverImg.hidden = false;
      coverPh.hidden = true;
    }

    node.querySelector(".song-title").textContent = song.title || "Без названия";
    if (song.demo) node.querySelector(".song-chip-demo").hidden = false;

    const meta = [
      fmtDate(song.date),
      fmtDur(song.duration),
      MEDIA_LABEL[song.media] || "",
    ].filter(Boolean).join(" · ");
    node.querySelector(".song-meta").textContent = meta;

    const panel = node.querySelector(".song-panel");
    const lyricsSec = node.querySelector(".lyrics");
    const listenBtn = node.querySelector("[data-listen]");
    const textBtn = node.querySelector("[data-lyrics]");
    const refreshPanel = () => {
      panel.hidden = lyricsSec.hidden;
    };

    // Кнопка «Слушать» — включает песню в плеере внизу экрана.
    if (song.audio) {
      listenBtn.hidden = false;
      listenBtn.addEventListener("click", () => playSong(song, node));
    } else if (song.audio_missing) {
      const note = node.querySelector(".song-note");
      note.textContent = song.audio_missing === "big"
        ? "Файл больше 20 МБ — прослушивание на сайте недоступно"
        : "Аудио пока не загружено";
      note.hidden = false;
    }

    // Кнопка «Текст»: караоке с подсветкой читаемого слова (если есть тайминг),
    // иначе — обычный показ первых 4 строк с кнопкой «Показать полностью».
    const timed = normalizeTimed(song.lyrics_timed, song.duration);
    const lyricsText = String(song.lyrics || song.text || "").trim();

    if (timed) {
      setupKaraoke(node, song, timed);
    } else if (lyricsText) {
      const body = node.querySelector(".lyrics-body");
      const toggle = node.querySelector(".lyrics-toggle");

      lyricsText.split("\n").forEach((line, i) => {
        if (i) body.appendChild(document.createElement("br"));
        if (line.trim()) body.appendChild(document.createTextNode(line));
      });

      textBtn.hidden = false;
      textBtn.addEventListener("click", () => {
        const open = lyricsSec.hidden;
        lyricsSec.hidden = !open;
        textBtn.setAttribute("aria-expanded", String(open));
        if (open && !lyricsSec.classList.contains("is-open")) {
          toggle.hidden = body.scrollHeight - body.clientHeight <= 2;
        }
        refreshPanel();
      });

      toggle.addEventListener("click", () => {
        const opened = !lyricsSec.classList.contains("is-open");
        lyricsSec.classList.toggle("is-open", opened);
        toggle.textContent = opened ? "Свернуть" : "Показать полностью";
      });
    }

    return node;
  }

  function render(songs) {
    byId.clear();
    listEl.textContent = "";

    const items = Array.isArray(songs)
      ? songs.filter((s) => s && s.title).slice().sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0))
      : [];

    items.forEach((song, i) => {
      byId.set(song.id || `i-${i}`, song);
      listEl.appendChild(renderSong(song));
    });

    if (items.length === 0) {
      listEl.classList.add("is-empty");
      emptyEl.hidden = false;
    } else {
      listEl.classList.remove("is-empty");
      emptyEl.hidden = true;
    }
  }

  /* ---------- Окно «Купить» ---------- */

  function openModal(song) {
    if (song && song.title) {
      modalSong.textContent = `«${song.title}»`;
      modalSong.hidden = false;
      const subject = encodeURIComponent(`Песня «${song.title}» — покупка`);
      const body = encodeURIComponent(
        `Здравствуйте!\n\nХочу приобрести песню «${song.title}».\n\nМеня зовут: \nКомментарий: `
      );
      modalMail.href = `mailto:${CONTACTS.email}?subject=${subject}&body=${body}`;
    } else {
      modalSong.hidden = true;
      modalMail.href = `mailto:${CONTACTS.email}?subject=${encodeURIComponent("Песни Данилы Васильева")}`;
    }
    modal.showModal();
  }

  document.querySelectorAll("[data-buy-open]").forEach((btn) => {
    btn.addEventListener("click", () => openModal(null));
  });

  listEl.addEventListener("click", (e) => {
    const buy = e.target.closest("[data-buy]");
    if (!buy) return;
    const card = buy.closest(".song");
    openModal(byId.get(card && card.dataset.songId) || null);
  });

  modal.querySelector("[data-close]").addEventListener("click", () => modal.close());
  modal.addEventListener("click", (e) => {
    if (e.target === modal) modal.close();
  });

  /* ---------- Копирование ---------- */

  document.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-copy]");
    if (!btn) return;
    const value = btn.getAttribute("data-copy") || "";
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(value);
      } else {
        const ta = document.createElement("textarea");
        ta.value = value;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        ta.remove();
      }
      toast("Скопировано");
      btn.classList.add("copied");
      setTimeout(() => btn.classList.remove("copied"), 1600);
    } catch {
      toast("Не получилось скопировать");
    }
  });

  /* ---------- Загрузка данных ---------- */

  async function load() {
    const demo = new URLSearchParams(location.search).get("preview") === "demo";
    const path = demo ? "data/songs.example.json" : "data/songs.json";
    try {
      const res = await fetch(`${path}?v=${Date.now()}`, { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      render(await res.json());
    } catch {
      render([]);
    }
  }

  /* ---------- Цитаты автора ---------- */

  async function loadQuotes() {
    const block = document.getElementById("quotes-block");
    const box = document.getElementById("quotes");
    if (!block || !box) return;
    try {
      const res = await fetch(`data/quotes.json?v=${Date.now()}`, { cache: "no-store" });
      if (!res.ok) return;
      const quotes = await res.json();
      if (!Array.isArray(quotes) || quotes.length === 0) return;

      quotes.forEach((q) => {
        if (!q || !q.text) return;
        const fig = document.createElement("figure");
        fig.className = "quote-card";

        const bq = document.createElement("blockquote");
        const p = document.createElement("p");
        String(q.text).split("\n").forEach((line, i) => {
          if (i) p.appendChild(document.createElement("br"));
          p.appendChild(document.createTextNode(line));
        });
        bq.appendChild(p);
        fig.appendChild(bq);

        if (q.author) {
          const cap = document.createElement("figcaption");
          cap.textContent = `— ${q.author}`;
          fig.appendChild(cap);
        }

        box.appendChild(fig);
      });

      block.hidden = false;
    } catch {
      /* цитаты не загрузились — просто не показываем блок */
    }
  }

  /* ---------- Контакты ----------
     Единое место правки — объект CONTACTS вверху файла.
     Эти значения автоматически подставляются в карточки и окно «Купить». */

  function applyContacts() {
    const setText = (sel, value) =>
      document.querySelectorAll(sel).forEach((el) => { el.textContent = value; });
    const setHref = (sel, value) =>
      document.querySelectorAll(sel).forEach((el) => { el.href = value; });
    const setCopy = (sel, value) =>
      document.querySelectorAll(sel).forEach((el) => el.setAttribute("data-copy", value));

    setText("[data-fill-email-text]", CONTACTS.email);
    setHref("[data-fill-email-href]", `mailto:${CONTACTS.email}`);
    setText(".copy-inline[data-copy-email] span", CONTACTS.email);
    setCopy("[data-copy-email]", CONTACTS.email);

    setText("[data-fill-phone-text]", CONTACTS.phoneDisplay);
    setHref("[data-fill-phone-href]", `tel:${CONTACTS.phoneTel}`);
    setText(".copy-inline[data-copy-phone] span", CONTACTS.phoneDisplay);
    setCopy("[data-copy-phone]", CONTACTS.phoneTel);
  }

  applyContacts();
  loadQuotes();

  const yearEl = document.getElementById("year");
  if (yearEl) yearEl.textContent = String(new Date().getFullYear());

  load();
})();
