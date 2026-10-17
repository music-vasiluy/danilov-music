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
  const audios = [];

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

  /* ---------- Плеер ---------- */

  function pauseAll(except) {
    audios.forEach((a) => { if (a !== except && !a.paused) a.pause(); });
  }

  function initPlayer(node, song) {
    const playerEl = node.querySelector(".player");
    const btn = playerEl.querySelector(".player-btn");
    const range = playerEl.querySelector(".player-range");
    const fill = playerEl.querySelector(".player-fill");
    const time = playerEl.querySelector(".player-time");

    const audio = new Audio();
    audio.preload = "metadata";
    audio.src = song.audio;
    audios.push(audio);

    let seeking = false;
    const total = () =>
      Number.isFinite(audio.duration) && audio.duration > 0
        ? audio.duration
        : Number(song.duration) || 0;

    function paint() {
      const d = total();
      const ratio = d ? Math.min(1, audio.currentTime / d) : 0;
      fill.style.width = `${ratio * 100}%`;
      if (!seeking) range.value = String(Math.round(ratio * 1000));
      time.textContent = fmtDur(audio.currentTime) || "0:00";
    }

    audio.addEventListener("loadedmetadata", paint);
    audio.addEventListener("timeupdate", paint);
    audio.addEventListener("play", () => {
      pauseAll(audio);
      btn.dataset.playing = "true";
      btn.setAttribute("aria-label", "Пауза");
    });
    audio.addEventListener("pause", () => {
      btn.dataset.playing = "false";
      btn.setAttribute("aria-label", "Воспроизвести");
    });
    audio.addEventListener("ended", () => {
      audio.currentTime = 0;
      btn.dataset.playing = "false";
      btn.setAttribute("aria-label", "Воспроизвести");
      paint();
    });

    btn.addEventListener("click", () => {
      if (audio.paused) {
        audio.play().catch(() => toast("Не удалось включить запись"));
      } else {
        audio.pause();
      }
    });

    range.addEventListener("input", () => {
      seeking = true;
      const d = total();
      if (d) audio.currentTime = (Number(range.value) / 1000) * d;
      paint();
    });
    const stopSeek = () => { seeking = false; };
    range.addEventListener("change", stopSeek);
    range.addEventListener("pointerup", stopSeek);

    paint();
    return audio;
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
    const playerEl = node.querySelector(".player");
    const lyricsSec = node.querySelector(".lyrics");
    const listenBtn = node.querySelector("[data-listen]");
    const textBtn = node.querySelector("[data-lyrics]");
    const refreshPanel = () => {
      panel.hidden = playerEl.hidden && lyricsSec.hidden;
    };

    // Кнопка «Слушать» — раскрывает плеер под песней.
    let audio = null;
    if (song.audio) {
      audio = initPlayer(node, song);
      listenBtn.hidden = false;
      listenBtn.addEventListener("click", () => {
        const open = playerEl.hidden;
        playerEl.hidden = !open;
        listenBtn.setAttribute("aria-expanded", String(open));
        if (!open && !audio.paused) audio.pause();
        refreshPanel();
      });
    } else if (song.audio_missing) {
      const note = node.querySelector(".song-note");
      note.textContent = song.audio_missing === "big"
        ? "Файл больше 20 МБ — прослушивание на сайте недоступно"
        : "Аудио пока не загружено";
      note.hidden = false;
    }

    // Кнопка «Текст» — слова песни (первые 4 строки, дальше «Показать полностью»).
    const lyricsText = String(song.lyrics || song.text || "").trim();
    if (lyricsText) {
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
    audios.length = 0;
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
