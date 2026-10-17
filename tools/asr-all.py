#!/usr/bin/env python3
"""Пакетное распознавание текстов всех песен (караоке) — в фоне.

Запуск:
  python tools/asr-all.py [--limit N] [--only ID] [--outdir PATH]

Для каждой песни из data/songs.json, где есть audio-файл и ещё нет
lyrics_timed, распознаёт слова с таймингом и пишет результат в
<outdir>/<id>.json (по умолчанию %TEMP%/opencode/asr-all).
Файлы пишутся атомарно (tmp + rename), повторный запуск пропускает готовые.
Настройки модели — как в проверенном tools/asr-lyrics.py (small, CPU, int8).
"""
import json
import os
import sys
import time
import tempfile

os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

import av  # noqa: E402

_av_open = av.open


def _av_open_compat(*args, **kwargs):
    try:
        return _av_open(*args, **kwargs)
    except TypeError as exc:
        if "metadata_errors" in kwargs and "metadata_errors" in str(exc):
            kwargs.pop("metadata_errors")
            return _av_open(*args, **kwargs)
        raise


av.open = _av_open_compat

from faster_whisper import WhisperModel  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SONGS = os.path.join(ROOT, "data", "songs.json")


def split_lines(words, max_words=7, pause=0.7):
    """Группируем слова в строки: по паузам, длине строки и знакам конца."""
    lines = []
    cur = []

    def flush():
        if cur:
            lines.append({
                "t": round(cur[0]["t"], 2),
                "text": " ".join(x["w"] for x in cur),
                "words": [{"w": x["w"], "t": round(x["t"], 2)} for x in cur],
            })
            cur.clear()

    prev = None
    for w in words:
        if not w["w"]:
            continue
        if cur and (
            (prev and w["t"] - prev["e"] > pause)
            or len(cur) >= max_words
            or (prev and prev["w"].endswith((".", "!", "?", "…")))
        ):
            flush()
        cur.append(w)
        prev = w
    flush()
    return lines


def parse_args(argv):
    opts = {"limit": None, "only": None, "outdir": os.path.join(tempfile.gettempdir(), "opencode", "asr-all")}
    i = 1
    while i < len(argv):
        a = argv[i]
        if a == "--limit" and i + 1 < len(argv):
            opts["limit"] = int(argv[i + 1]); i += 2
        elif a == "--only" and i + 1 < len(argv):
            opts["only"] = argv[i + 1]; i += 2
        elif a == "--outdir" and i + 1 < len(argv):
            opts["outdir"] = argv[i + 1]; i += 2
        else:
            i += 1
    return opts


def main():
    opts = parse_args(sys.argv)
    outdir = opts["outdir"]
    os.makedirs(outdir, exist_ok=True)

    with open(SONGS, "r", encoding="utf-8") as f:
        songs = json.load(f)

    todo = []
    for s in songs:
        if s.get("demo") or not s.get("audio"):
            continue
        if s.get("lyrics_timed"):
            continue
        if not os.path.isfile(os.path.join(ROOT, s["audio"].replace("/", os.sep))):
            continue
        if opts["only"] and s.get("id") != opts["only"]:
            continue
        out = os.path.join(outdir, f"{s['id']}.json")
        if os.path.isfile(out):
            continue
        todo.append((s, out))

    if opts["limit"]:
        todo = todo[: opts["limit"]]

    total = len(todo)
    print(f"[asr-all] песен в очереди: {total} (outdir: {outdir})", flush=True)
    if not total:
        print("[asr-all] нечего делать — всё уже распознано.", flush=True)
        return

    threads = max(4, (os.cpu_count() or 8) // 2)
    print(f"[asr-all] модель small / cpu / int8, потоков: {threads}", flush=True)
    t0 = time.time()
    model = WhisperModel("small", device="cpu", compute_type="int8", cpu_threads=threads)

    ok = fail = 0
    for n, (song, out) in enumerate(todo, 1):
        audio = os.path.join(ROOT, song["audio"].replace("/", os.sep))
        ts = time.time()
        try:
            segments, info = model.transcribe(
                audio,
                language="ru",
                word_timestamps=True,
                vad_filter=False,
                condition_on_previous_text=False,
                temperature=0.0,
            )
            words = []
            for seg in segments:
                for w in seg.words or []:
                    words.append({"w": w.word.strip(), "t": w.start, "e": w.end})
            lines = [ln for ln in split_lines(words) if not any(
                k in ln["text"].lower() for k in ("субтитр", "редактор"))]

            tmp = out + ".tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump({"audio": os.path.basename(audio), "lines": lines}, f,
                          ensure_ascii=False, indent=2)
            os.replace(tmp, out)
            ok += 1
            per = time.time() - ts
            elapsed = time.time() - t0
            eta = (elapsed / n) * (total - n) / 3600
            print(f"[asr-all] [{n}/{total}] {song['id']} «{song.get('title')}» — "
                  f"{len(words)} слов, {len(lines)} строк ({per:.0f} c); "
                  f"осталось ~{eta:.1f} ч", flush=True)
        except Exception as exc:
            fail += 1
            print(f"[asr-all] [{n}/{total}] {song['id']} ОШИБКА: {exc}", flush=True)

    print(f"[asr-all] готово: {ok} песен, ошибок {fail}, за {(time.time()-t0)/60:.1f} мин", flush=True)


if __name__ == "__main__":
    main()
