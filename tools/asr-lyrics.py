#!/usr/bin/env python3
"""Распознавание слов песни с таймингом (для караоке на сайте).

Запуск:
  python tools/asr-lyrics.py audio/96-sentyabr.mp3 [out.json]

Результат: JSON {"lines": [{"t": сек, "text": "...", "words": [{"w": "...", "t": сек}, ...]}, ...]}
Модель faster-whisper (small, CPU, int8). При первом запуске скачивается (~460 МБ).
"""
import json
import os
import sys

os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")

try:  # чтобы русский текст печатался при любом выводе (в т. ч. в файл)
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

import av  # noqa: E402

# Совместимость: новые версии PyAV убрали параметр metadata_errors,
# который пока передаёт faster-whisper при открытии файла.
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


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    audio = sys.argv[1]
    out = sys.argv[2] if len(sys.argv) > 2 else os.path.splitext(audio)[0] + ".asr.json"

    model = WhisperModel("small", device="cpu", compute_type="int8")
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

    lines = split_lines(words)
    with open(out, "w", encoding="utf-8") as f:
        json.dump({"audio": os.path.basename(audio), "lines": lines}, f, ensure_ascii=False, indent=2)

    print(f"готово: строк {len(lines)}, слов {len(words)} -> {out}")
    for ln in lines[:40]:
        print(f"{ln['t']:7.1f}  {ln['text']}")


if __name__ == "__main__":
    main()
