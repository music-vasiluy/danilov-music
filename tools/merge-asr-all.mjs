// Вливает все распознанные тексты (<outdir>/<id>.json) в data/songs.json.
import fs from "node:fs";
import path from "node:path";

const ROOT = "C:/Users/ruslan/Desktop/danilov-music";
const songsPath = path.join(ROOT, "data", "songs.json");
const outdir = path.join(process.env.TEMP || "C:/Users/ruslan/AppData/Local/Temp", "opencode", "asr-all");

const songs = JSON.parse(fs.readFileSync(songsPath, "utf8"));
let merged = 0, kept = 0, missing = 0;

for (const s of songs) {
  if (s.demo || !s.audio) continue;
  const file = path.join(outdir, `${s.id}.json`);
  if (fs.existsSync(file)) {
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    const lines = (data.lines || []).filter((l) => l.text && l.words && l.words.length);
    if (lines.length) {
      s.lyrics_timed = lines;
      s.lyrics_source = "asr";
      merged += 1;
    }
  } else if (s.lyrics_timed) {
    kept += 1;
  } else {
    missing += 1;
  }
}

fs.writeFileSync(songsPath, JSON.stringify(songs, null, 2) + "\n", "utf8");
console.log(`влито из ASR: ${merged}; уже с текстом (нет файла): ${kept}; без текста пока: ${missing}`);
