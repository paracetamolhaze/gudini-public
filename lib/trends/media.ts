import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { scribeTranscribe } from "../transcribe";
import { shortsFromPlaylist, spokenHook, wordsFromJson3, wordsText, type TimedWord } from "./parse";
import { findCuts, RHYTHM_FPS, RHYTHM_HEIGHT, RHYTHM_WIDTH, type CutScan } from "./rhythm";
import type { ReelStat } from "./types";

/**
 * Видео и звук выброса: yt-dlp (Shorts по ссылке, Instagram с куки браузера), кадры и звук через ffmpeg,
 * речь — автосубтитры YouTube или ElevenLabs Scribe из lib/transcribe. Видео после разбора удаляется:
 * хранятся только кадры и текст.
 */

const run = promisify(execFile);
const YTDLP = process.env.YTDLP_BIN || "yt-dlp";

const ytdlp = (args: string[], timeout: number) => run(YTDLP, ["--no-warnings", "--ignore-config", ...args], { timeout, maxBuffer: 32 << 20 });

/** Shorts канала: подписчики и последние 15 роликов с просмотрами — то, что YouTube показывает без входа. */
export async function readShorts(handle: string): Promise<{ followers: number | null; reels: ReelStat[] }> {
  const { stdout } = await ytdlp(["-J", "--flat-playlist", "--playlist-end", "15", `https://www.youtube.com/@${handle}/shorts`], 120_000)
    .catch((e: { stderr?: string }) => {
      throw new Error(/does not exist|404|not found/i.test(e.stderr ?? "") ? `Канал @${handle} не найден на YouTube` : `YouTube не отдал Shorts @${handle}`);
    });
  return shortsFromPlaylist(JSON.parse(stdout));
}

/** Автосубтитры Shorts по-английски: сказанная зацепка без расшифровки за деньги. */
export async function shortsWords(url: string, dir: string): Promise<TimedWord[]> {
  await ytdlp(["--skip-download", "--write-auto-subs", "--write-subs", "--sub-langs", "en.*,en", "--sub-format", "json3", "-o", path.join(dir, "subs"), url], 90_000).catch(() => null);
  const file = fs.readdirSync(dir).find((f) => f.startsWith("subs") && f.endsWith(".json3"));
  if (!file) return [];
  try {
    return wordsFromJson3(JSON.parse(fs.readFileSync(path.join(dir, file), "utf8")));
  } finally {
    for (const f of fs.readdirSync(dir)) if (f.startsWith("subs")) fs.rmSync(path.join(dir, f), { force: true });
  }
}

/** Видео до 720p в dir/video.mp4. cookies — файл Netscape для Instagram. */
export async function downloadVideo(url: string, dir: string, cookies?: string): Promise<string> {
  const out = path.join(dir, "video.mp4");
  fs.rmSync(out, { force: true });
  await ytdlp([
    "-f", "bv*[height<=720]+ba/b[height<=720]/bv*+ba/b", "--merge-output-format", "mp4", "--max-filesize", "300M",
    "--no-playlist", ...(cookies ? ["--cookies", cookies] : []), "-o", out, url,
  ], 240_000).catch((e: { stderr?: string }) => {
    const why = (e.stderr ?? "").split("\n").find((l) => l.includes("ERROR")) ?? "";
    throw new Error(/login|cookies|private/i.test(why) ? "Instagram не отдал видео без входа" : "Не удалось скачать видео");
  });
  if (!fs.existsSync(out)) throw new Error("Не удалось скачать видео");
  return out;
}

const MAX_VIDEO_BYTES = 300 * 1024 * 1024;

/**
 * Файл рилса по ссылке, которую страница отдала своему плееру: обычный запрос к CDN без куки.
 * Так видео берётся тем же путём, что и в браузере, а сессия владельца не уходит в сторонний клиент.
 */
export async function fetchVideo(url: string, dir: string): Promise<string> {
  if (!/^https:\/\/[^/]+\.(cdninstagram\.com|fbcdn\.net)\//.test(url)) throw new Error("Ссылка на видео не с CDN Instagram");
  const out = path.join(dir, "video.mp4");
  const res = await fetch(url, { headers: { Referer: "https://www.instagram.com/" }, signal: AbortSignal.timeout(180_000) });
  if (!res.ok || !res.body) throw new Error(`CDN Instagram ответил ${res.status}`);
  const declared = Number(res.headers.get("content-length") || 0);
  if (declared > MAX_VIDEO_BYTES) throw new Error("Видео слишком большое");
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    size += chunk.byteLength;
    if (size > MAX_VIDEO_BYTES) throw new Error("Видео слишком большое");
    chunks.push(Buffer.from(chunk));
  }
  fs.writeFileSync(out, Buffer.concat(chunks));
  return out;
}

export async function probeDuration(file: string): Promise<number | null> {
  const { stdout } = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file], { timeout: 30_000 });
  const d = Number(stdout.trim());
  return Number.isFinite(d) && d > 0 ? d : null;
}

/** Кадры для текста на экране: 0,3 с, 1,5 с, 3 с и середина. */
export async function extractFrames(file: string, dir: string, duration: number): Promise<string[]> {
  const times = [0.3, 1.5, 3, duration / 2].map((t) => Math.max(0, Math.min(t, duration - 0.1)));
  const names: string[] = [];
  for (const [i, t] of times.entries()) {
    const name = `frame-${i + 1}.jpg`;
    await run("ffmpeg", ["-y", "-v", "error", "-ss", t.toFixed(2), "-i", file, "-frames:v", "1", "-vf", "scale=540:-2", "-q:v", "4", path.join(dir, name)], { timeout: 30_000 })
      .then(() => names.push(name), () => {});
  }
  return names;
}

/**
 * Склейки и наплывы по файлу: ffmpeg отдаёт мелкие кадры (15 в секунду, 36×64), счёт — в rhythm.ts.
 * Первые 5 минут — это 31 МБ кадров; ролики «Трендов» короче.
 */
export async function readCuts(file: string): Promise<CutScan> {
  const { stdout } = await run("ffmpeg", [
    "-v", "error", "-i", file, "-t", "300", "-an", "-sn", "-dn",
    "-vf", `fps=${RHYTHM_FPS},scale=${RHYTHM_WIDTH}:${RHYTHM_HEIGHT}:flags=area,format=rgb24`, "-f", "rawvideo", "pipe:1",
  ], { timeout: 120_000, maxBuffer: 64 << 20, encoding: "buffer" });
  const scan = findCuts(stdout);
  if (scan.duration < 1) throw new Error("ffmpeg не отдал кадры для ритма");
  return scan;
}

/** Речь ролика: слова со временем. Без ключа ElevenLabs — пусто, и разбор идёт по подписи и кадрам. */
export async function transcribeVideo(file: string, dir: string): Promise<TimedWord[]> {
  const wav = path.join(dir, "audio.wav");
  try {
    await run("ffmpeg", ["-y", "-v", "error", "-i", file, "-vn", "-ac", "1", "-ar", "16000", wav], { timeout: 60_000 });
    return (await scribeTranscribe(wav)) ?? [];
  } finally {
    fs.rmSync(wav, { force: true });
  }
}

export function speech(words: TimedWord[]) {
  return { spokenHook: spokenHook(words), transcript: timedTranscript(words) };
}

/** Расшифровка с отметками времени раз в фразу: Claude видит, где поворот и где развязка. */
export function timedTranscript(words: TimedWord[], maxChars = 4000): string {
  const lines: string[] = [];
  let line: TimedWord[] = [];
  const flush = () => {
    if (line.length) lines.push(`[${line[0].start.toFixed(1)} с] ${wordsText(line)}`);
    line = [];
  };
  for (const w of words) {
    line.push(w);
    if (/[.!?]$/.test(w.word) || line.length >= 14) flush();
  }
  flush();
  return lines.join("\n").slice(0, maxChars);
}
