#!/usr/bin/env node
/**
 * Синхронизация песен из Telegram-канала в статический сайт.
 *
 * Как это работает:
 *   1. Скрипт опрашивает Telegram Bot API (getUpdates) — бот должен быть
 *      добавлен в канал АДМИНИСТРАТОРОМ, тогда он получает все новые посты.
 *   2. Аудио (и обложки) скачиваются в папки audio/ и covers/.
 *   3. Список песен сохраняется в data/songs.json — сайт читает его при загрузке.
 *
 * Переменные окружения:
 *   BOT_TOKEN — токен бота от @BotFather (обязательно; в GitHub — секрет).
 *   CHANNEL   — username канала без @ (по умолчанию Danilov_Vasilii_music).
 *   API_BASE  — адрес Bot API (для локальных тестов).
 *
 * Запуск локально:
 *   PowerShell:  $env:BOT_TOKEN="123:AA..."; node sync/sync.mjs
 *   bash:        BOT_TOKEN="123:AA..." node sync/sync.mjs
 */

import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dns from "node:dns";

// Некоторые домашние сети не поддерживают IPv6 — принудительно используем IPv4.
dns.setDefaultResultOrder("ipv4first");

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BOT_TOKEN = (process.env.BOT_TOKEN || "").trim();
const CHANNEL = (process.env.CHANNEL || "Danilov_Vasilii_music").trim();
const API_BASE = (process.env.API_BASE || "https://api.telegram.org").replace(/\/+$/, "");

const SONGS_PATH = path.join(ROOT, "data", "songs.json");
const STATE_PATH = path.join(ROOT, "data", "tg-state.json");
const AUDIO_DIR = "audio";
const COVERS_DIR = "covers";

/** Bot API не отдаёт файлы больше ~20 МБ */
const MAX_DOWNLOAD_BYTES = 20 * 1024 * 1024;

if (!BOT_TOKEN) {
  console.log(
    "[sync] BOT_TOKEN не задан — синхронизация пропущена.\n" +
      "[sync] Добавьте его в Settings → Secrets and variables → Actions (имя: BOT_TOKEN)."
  );
  process.exit(0);
}

const API = `${API_BASE}/bot${BOT_TOKEN}`;
const FILE_API = `${API_BASE}/file/bot${BOT_TOKEN}`;

/* ---------- Telegram API ---------- */

async function callTelegram(method, params = {}) {
  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    let res;
    try {
      res = await fetch(`${API}/${method}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(params),
      });
    } catch (err) {
      lastError = err; // обрыв или таймаут — попробуем ещё раз
      if (attempt < 3) await new Promise((r) => setTimeout(r, 2000));
      continue;
    }
    const data = await res.json().catch(() => null);
    if (!data || !data.ok) {
      const desc = data && data.description ? data.description : `HTTP ${res.status}`;
      throw new Error(`Telegram API «${method}»: ${desc}`);
    }
    return data.result;
  }
  throw new Error(`Telegram API «${method}»: сеть недоступна (${lastError ? lastError.message : "?"})`);
}

/* ---------- Файлы ---------- */

async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return fallback;
  }
}

async function writeJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(value, null, 2) + "\n", "utf8");
}

const exists = (file) =>
  access(file).then(
    () => true,
    () => false
  );

/**
 * Скачивает файл из Telegram в папку репозитория (если его там ещё нет).
 * @returns {{relPath: string|null, tooBig: boolean, failed: boolean}}
 */
async function downloadTelegramFile(fileId, relPath) {
  const abs = path.join(ROOT, relPath);
  if (await exists(abs)) return { relPath, tooBig: false, failed: false };

  try {
    const info = await callTelegram("getFile", { file_id: fileId });
    if (info.file_size && info.file_size > MAX_DOWNLOAD_BYTES) {
      console.warn(`[sync] Файл слишком большой (${info.file_size} Б), скачивание пропущено`);
      return { relPath: null, tooBig: true, failed: false };
    }
    let res = null;
    for (let attempt = 1; attempt <= 3 && !res; attempt += 1) {
      try {
        res = await fetch(`${FILE_API}/${info.file_path}`);
      } catch (err) {
        if (attempt === 3) throw err;
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, buf);
    console.log(`[sync] Скачан ${relPath} (${(buf.length / 1024 / 1024).toFixed(1)} МБ)`);
    return { relPath, tooBig: false, failed: false };
  } catch (err) {
    console.warn(`[sync] Не удалось скачать файл: ${err.message}`);
    return { relPath: null, tooBig: false, failed: true };
  }
}

/* ---------- Разбор сообщений ---------- */

const TRANSLIT = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z",
  и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r",
  с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "ts", ч: "ch", ш: "sh", щ: "sch",
  ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
};

function slugify(input, max = 40) {
  let out = "";
  for (const ch of String(input || "").toLowerCase()) {
    out += ch in TRANSLIT ? TRANSLIT[ch] : ch;
  }
  out = out
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .replace(/-+$/g, "");
  return out || "track";
}

const EXT_BY_MIME = {
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/ogg": "ogg",
  "audio/opus": "opus",
  "audio/webm": "webm",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/m4a": "m4a",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/flac": "flac",
  "audio/x-flac": "flac",
  "audio/aac": "aac",
};

function extensionFor(mime, fileName) {
  if (mime && EXT_BY_MIME[mime.toLowerCase()]) return EXT_BY_MIME[mime.toLowerCase()];
  const ext = path.extname(fileName || "").slice(1).toLowerCase();
  return /^[a-z0-9]{2,5}$/.test(ext) ? ext : "mp3";
}

function isServiceMessage(msg) {
  return Boolean(
    msg.new_chat_members ||
      msg.left_chat_member ||
      msg.new_chat_title ||
      msg.new_chat_photo ||
      msg.delete_chat_photo ||
      msg.pinned_message ||
      msg.group_chat_created ||
      msg.channel_chat_created ||
      msg.supergroup_chat_created ||
      msg.migrate_to_chat_id ||
      msg.migrate_from_chat_id
  );
}

/** Описание медиа сообщения. */
function describeMedia(msg) {
  if (msg.audio) {
    return {
      kind: "audio",
      fileId: msg.audio.file_id,
      mime: msg.audio.mime_type || "audio/mpeg",
      duration: msg.audio.duration || null,
      title: msg.audio.title || null,
      performer: msg.audio.performer || null,
      fileName: msg.audio.file_name || null,
      downloadable: true,
    };
  }
  if (msg.voice) {
    return {
      kind: "voice",
      fileId: msg.voice.file_id,
      mime: msg.voice.mime_type || "audio/ogg",
      duration: msg.voice.duration || null,
      title: null,
      performer: null,
      fileName: null,
      downloadable: true,
    };
  }
  if (msg.document) {
    const mime = msg.document.mime_type || "";
    return {
      kind: "document",
      fileId: msg.document.file_id,
      mime,
      duration: null,
      title: null,
      performer: null,
      fileName: msg.document.file_name || null,
      downloadable: mime.startsWith("audio/"),
    };
  }
  if (msg.video) {
    return { kind: "video", fileId: msg.video.file_id, duration: msg.video.duration || null, downloadable: false };
  }
  if (msg.video_note || msg.animation) {
    return { kind: "video", fileId: null, duration: null, downloadable: false };
  }
  if (msg.photo && msg.photo.length) {
    const largest = msg.photo[msg.photo.length - 1];
    return { kind: "photo", fileId: largest.file_id, duration: null, downloadable: false, coverFileId: largest.file_id };
  }
  if (msg.text) return { kind: "text", fileId: null, duration: null, downloadable: false };
  return { kind: "other", fileId: null, duration: null, downloadable: false };
}

const MESSAGE_LINK = (messageId) => `https://t.me/${CHANNEL}/${messageId}`;

/** Собирает объект песни из группы сообщений (одного поста или медиагруппы). */
async function buildSong(messages) {
  const first = messages[0];
  const caption = messages
    .map((m) => m.caption || m.text || "")
    .filter(Boolean)
    .join("\n\n")
    .trim();

  // Пересланные сообщения хранят дату оригинала — используем её для сайта.
  const origin = first.forward_origin;
  const originalDate = origin && origin.date ? new Date(origin.date * 1000) : new Date(first.date * 1000);

  // Главное медиа: аудио важнее фото.
  const mediaMsg = messages.find((m) => m.audio || m.voice || m.document || m.video || m.video_note || m.animation) || first;
  const media = describeMedia(mediaMsg);

  if (media.kind === "other" && !caption) return null; // стикер без подписи и т.п.

  // Фото без подписи и без аудио на сайте не нужно (просто картинка из чата).
  const hasSongContent = messages.some(
    (m) => m.audio || m.voice || (m.document && (m.document.mime_type || "").startsWith("audio/")) || m.video
  );
  if (!hasSongContent && !caption) return null;

  const id = songIdFor(first);
  const title = (media.title || "").trim() ||
    (caption ? caption.split("\n")[0].trim().slice(0, 80) : "") ||
    `Песня от ${originalDate.toLocaleDateString("ru-RU")}`;

  let audioPath = null;
  let audioMissing = null;
  if (media.downloadable && media.fileId) {
    const ext = extensionFor(media.mime, media.fileName);
    const rel = `${AUDIO_DIR}/${mediaMsg.message_id}-${slugify(title)}.${ext}`;
    const result = await downloadTelegramFile(media.fileId, rel);
    if (result.relPath) audioPath = result.relPath;
    else if (result.tooBig) audioMissing = "big";
    else audioMissing = "download";
  } else if (media.kind === "audio" || media.kind === "voice" || media.kind === "document") {
    audioMissing = "download";
  }

  // Обложка: фото из группы (или самого сообщения), если это не фото-пост без аудио.
  let coverPath = null;
  const photoMsg = messages.find((m) => m.photo && m.photo.length);
  const coverMsg = photoMsg || messages.find((m) => m.document && (m.document.mime_type || "").startsWith("image/"));
  if (coverMsg && (coverMsg.photo || coverMsg.document)) {
    const coverId = coverMsg.photo
      ? coverMsg.photo[coverMsg.photo.length - 1].file_id
      : coverMsg.document.file_id;
    const result = await downloadTelegramFile(coverId, `${COVERS_DIR}/${coverMsg.message_id}.jpg`);
    coverPath = result.relPath;
  }

  const MEDIA_MAP = { audio: "audio", voice: "voice", document: "document", video: "video", photo: "photo", text: "text" };

  return {
    id,
    title,
    performer: media.performer || null,
    date: originalDate.toISOString(),
    duration: media.duration || null,
    media: MEDIA_MAP[media.kind] || "text",
    audio: audioPath,
    audio_missing: audioMissing,
    cover: coverPath,
    text: caption || null,
    tg_link: isImport ? null : MESSAGE_LINK(first.message_id),
    message_id: first.message_id,
  };
}

/** id песни: tg- у сообщений группы/канала, imp- у пересланных боту в личку. */
const songIdFor = (msg) => `${msg.chat && msg.chat.type === "private" ? "imp" : "tg"}-${msg.message_id}`;

/** Сообщение стоит показывать на сайте? (песни — да; болтовню в группе — нет) */
function shouldInclude(msg) {
  const chatType = msg.chat ? msg.chat.type : "";
  const caption = (msg.caption || "").trim();
  const text = (msg.text || "").trim();
  const audioish = Boolean(
    msg.audio ||
      msg.voice ||
      (msg.document && (msg.document.mime_type || "").startsWith("audio/")) ||
      msg.video
  );
  const photoish = Boolean(msg.photo || msg.video_note || msg.animation || msg.document);

  if (chatType === "channel") return true; // в канале каждый пост — это контент

  if (chatType === "private") {
    // Боту в личку пересылают старые песни — берём только пересланные сообщения.
    return Boolean(msg.forward_origin) && (audioish || photoish || caption || text);
  }

  // Группа: песни — это аудио и файлы; фото и видео — только с подписью.
  if (audioish) return true;
  if ((msg.photo || msg.video || msg.video_note || msg.animation) && caption) return true;
  return false;
}

/* ---------- Основной процесс ---------- */

async function main() {
  const songs = await readJson(SONGS_PATH, []);
  const state = await readJson(STATE_PATH, { offset: 0, last_sync: null });

  const updates = await callTelegram("getUpdates", {
    offset: Number(state.offset) || 0,
    limit: 100,
    allowed_updates: ["channel_post", "edited_channel_post", "message", "edited_message"],
    timeout: 0,
  });

  console.log(`[sync] Получено обновлений: ${updates.length}`);

  const known = new Map(songs.map((s) => [s.id, s]));
  let added = 0;
  let edited = 0;
  let maxUpdateId = Number(state.offset) - 1 || 0;

  // Обрабатываем только сообщения нашего канала; сразу группируем медиагруппы.
  const groups = new Map(); // key -> сообщения
  const edits = []; // отредактированные посты

  for (const update of updates) {
    maxUpdateId = Math.max(maxUpdateId, update.update_id);
    const msg = update.channel_post || update.edited_channel_post || update.message || update.edited_message;
    if (!msg) continue;

    const chatType = msg.chat ? msg.chat.type : "";
    const username = (msg.chat && msg.chat.username) || "";
    if (chatType !== "private" && username.toLowerCase() !== CHANNEL.replace(/^@/, "").toLowerCase()) {
      console.log(`[sync] Пропуск сообщения из чужого чата: @${username}`);
      continue;
    }
    if (isServiceMessage(msg)) continue;

    const media = describeMedia(msg);
    if (media.kind === "other" && !msg.text && !msg.caption) continue;

    if (update.edited_channel_post || update.edited_message) {
      edits.push(msg);
      continue;
    }

    // В группе болтовню пропускаем, но все элементы фото-альбомов берём целиком.
    if (!msg.media_group_id && !shouldInclude(msg)) continue;

    // Каждое аудио/видео/файл — отдельная песня; фото-альбом склеиваем по media_group_id.
    const solo = media.kind === "audio" || media.kind === "voice" || media.kind === "document" || media.kind === "video";
    const key = solo ? `msg-${msg.message_id}` : msg.media_group_id ? `grp-${msg.media_group_id}` : `msg-${msg.message_id}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(msg);
  }

  for (const messages of groups.values()) {
    const songId = songIdFor(messages[0]);
    if (known.has(songId)) {
      console.log(`[sync] Уже на сайте: ${songId}`);
      continue;
    }
    const song = await buildSong(messages);
    if (!song) continue;
    songs.push(song);
    known.set(song.id, song);
    added += 1;
    console.log(`[sync] + ${song.title} (${song.id})`);
  }

  // Правки подписей к уже выгруженным постам.
  for (const msg of edits) {
    const song = known.get(songIdFor(msg));
    if (!song) continue;
    const caption = (msg.caption || msg.text || "").trim();
    if (caption && caption !== song.text) {
      song.text = caption;
      edited += 1;
      console.log(`[sync] ~ обновлён текст: ${song.id}`);
    }
  }

  // Убираем демо-записи, как только появились настоящие.
  const realCount = songs.filter((s) => !s.demo).length;
  if (realCount > 0) {
    for (let i = songs.length - 1; i >= 0; i -= 1) {
      if (songs[i].demo) songs.splice(i, 1);
    }
  }

  songs.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));

  if (added || edited) {
    await writeJson(SONGS_PATH, songs);
  }
  await writeJson(STATE_PATH, {
    offset: maxUpdateId + 1,
    last_sync: new Date().toISOString(),
  });

  console.log(`[sync] Готово. Новых песен: ${added}, правок: ${edited}, всего на сайте: ${songs.length}`);
}

main().catch((err) => {
  console.error(`[sync] Ошибка: ${err.message}`);
  process.exit(1);
});
