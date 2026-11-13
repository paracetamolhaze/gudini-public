/**
 * The owner's own recordings of his lines («озвучить самому»), made ready to stand in the joined track where his
 * synthesized line would be: trimmed to the speech with a little air, and given letter timings for lips and
 * subtitles by ElevenLabs forced alignment. Loudness is not touched here: the line joiner brings each take to the
 * cast's tts.loudness, measured over the words (`speech`) and not the air around them.
 */
import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { alignAudio, type AlignedText } from "./elevenlabs";
import type { Alignment } from "./mouth";

const run = promisify(execFile);
export const RATE = 44100;
const FRAME = 0.01;
/** Air kept before the first and after the last sound, so a breath in and a word's tail are not cut. */
const AIR = 0.08;
/** Speech is what comes within this many dB of the loud part of the take: mic levels differ from take to take. */
const BELOW_LOUD = 30;
/** ...and stands this far above the room's own noise. */
const ABOVE_NOISE = 8;
/** The room's noise is the level of the quietest tenth of the take: there is always a breath of it before or after the words. */
const NOISE_SHARE = 0.1;
/** A loud spot shorter than this is a click (the record button), not a word. */
const MIN_SOUND = 0.05;
/** A sound quieter than this is not speech at all. */
const SILENT_DB = -70;
const FADE = 0.005;
/** Bump when trimming changes, so takes prepared by the old way are made again. */
const VERSION = 2;

/** One recorded take for script line `index`, as downloaded from the site. */
export type Recording = { index: number; file: string; sha256: string };
/** speech: where the words are in the prepared file, in seconds (the file keeps a little air around them). */
export type PreparedRecording = { file: string; alignment: Alignment; source: "elevenlabs" | "even"; speech: [number, number] };

/** A take with no sound in it that could be a word. */
export class SilentTakeError extends Error {}

/** Mono 44.1 kHz samples of any audio file: the timeline every line of the joined track is built on. */
export async function decodeMono(file: string, signal?: AbortSignal): Promise<Float32Array> {
  const { stdout } = await run("ffmpeg", ["-v", "error", "-i", file, "-ac", "1", "-ar", String(RATE), "-f", "f32le", "-"], { encoding: "buffer", maxBuffer: 1 << 30, signal });
  const out = new Float32Array(Math.floor(stdout.length / 4));
  for (let i = 0; i < out.length; i++) out[i] = stdout.readFloatLE(i * 4);
  return out;
}

/** The level of every whole 10 ms frame of the samples, dBFS (soundLines.ts measures the montage's clips with it too). */
export const FRAME_SAMPLES = Math.round(RATE * FRAME);
export const frameLevels = (samples: Float32Array): number[] => {
  const n = FRAME_SAMPLES;
  const out: number[] = [];
  for (let i = 0; i + n <= samples.length; i += n) {
    let sum = 0;
    for (let k = i; k < i + n; k++) sum += samples[k] * samples[k];
    out.push(10 * Math.log10(sum / n + 1e-12));
  }
  return out;
};

export const percentile = (sorted: number[], p: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))))];

const SPAN = Math.max(2, Math.round(MIN_SOUND / FRAME));

/** Frames inside a sound that lasts: most of some 50 ms around them is above too, so a click is left out. */
const sustained = (above: boolean[]): boolean[] => {
  const out = above.map(() => false);
  let count = 0;
  for (let i = 0; i < above.length; i++) {
    count += above[i] ? 1 : 0;
    if (i >= SPAN) count -= above[i - SPAN] ? 1 : 0;
    if (i >= SPAN - 1 && count >= SPAN - 1) for (let k = i - SPAN + 1; k <= i; k++) out[k] = above[k];
  }
  return out;
};

/** The level a frame of the take must pass to be speech (see speechBounds), or null when nothing stands out of the room. */
function speechLevel(db: number[]): number | null {
  if (!db.length) return null;
  const noise = percentile([...db].sort((a, b) => a - b), NOISE_SHARE);
  const floor = Math.max(noise + ABOVE_NOISE, SILENT_DB);
  const sounding = sustained(db.map((v) => v > floor));
  const voiced = db.filter((_, i) => sounding[i]).sort((a, b) => a - b);
  // nothing stands out of the room for 50 ms: silence, steady noise or a lone click
  if (!voiced.length) return null;
  const loud = percentile(voiced, 0.98);
  return Math.min(Math.max(loud - BELOW_LOUD, floor), loud - 6);
}

/**
 * Every stretch of lasting speech in a take, in order, seconds: the words, a breath loud enough, a cough — what
 * speechBounds hears, apart. The dub tells his line from sounds before or after it by the pauses between them.
 */
export function speechRuns(samples: Float32Array): [number, number][] {
  const db = frameLevels(samples);
  const threshold = speechLevel(db);
  if (threshold === null) return [];
  const on = sustained(db.map((v) => v > threshold));
  const runs: [number, number][] = [];
  for (let i = 0; i < on.length; i++) {
    if (!on[i]) continue;
    let j = i;
    while (j + 1 < on.length && on[j + 1]) j++;
    runs.push([i * FRAME, (j + 1) * FRAME]);
    i = j;
  }
  return runs;
}

/**
 * Where the speech in a take begins and ends, in seconds, or null when there is none. The threshold is relative:
 * a fixed level would cut a quiet take's soft words and keep a loud take's room noise. Both ends of it are found
 * whatever share of the take the words fill — one word in a minute the owner forgot to stop is still one word:
 * the room's noise is the quietest frames of the take, and the loud part is that of the sounds standing above it.
 */
export function speechBounds(samples: Float32Array): [number, number] | null {
  const db = frameLevels(samples);
  const threshold = speechLevel(db);
  if (threshold === null) return null;
  const above = db.map((v) => v > threshold);
  // a sound counts when most of the next 50 ms are loud too
  const lasting = (i: number, dir: 1 | -1) => {
    let count = 0;
    for (let k = 0; k < SPAN; k++) if (above[i + dir * k]) count++;
    return above[i] && count >= SPAN - 1;
  };
  let first = -1;
  for (let i = 0; i < above.length && first < 0; i++) if (lasting(i, 1)) first = i;
  let last = -1;
  for (let i = above.length - 1; i >= 0 && last < 0; i--) if (lasting(i, -1)) last = i;
  if (first < 0 || last < first) return null;
  return [first * FRAME, (last + 1) * FRAME];
}

/** The take cut to its speech plus the air around it, with short fades so the cuts do not click. */
export function trimToSpeech(samples: Float32Array, bounds: [number, number]): Float32Array {
  const from = Math.max(0, Math.round((bounds[0] - AIR) * RATE));
  const to = Math.min(samples.length, Math.round((bounds[1] + AIR) * RATE));
  const out = samples.slice(from, to);
  const fade = Math.min(Math.round(FADE * RATE), Math.floor(out.length / 2));
  for (let k = 0; k < fade; k++) {
    out[k] *= k / fade;
    out[out.length - 1 - k] *= k / fade;
  }
  return out;
}

/** Letters spread evenly over the speech: lips that move in time with the take when the aligner could not help. */
export function evenAlignment(text: string, speech: [number, number]): Alignment {
  const chars = [...text];
  const step = chars.length ? (speech[1] - speech[0]) / chars.length : 0;
  return {
    characters: chars,
    character_start_times_seconds: chars.map((_, i) => speech[0] + i * step),
    character_end_times_seconds: chars.map((_, i) => speech[0] + (i + 1) * step),
  };
}

const same = (a: string, b: string) => (/\s/.test(a) ? /\s/.test(b) : a.toLowerCase().replace("ё", "е") === b.toLowerCase().replace("ё", "е"));

/**
 * The aligner's answer laid onto the text's own characters, spaces and punctuation included, since words are split
 * at the spaces. A character the aligner left out sits at the end of the one before it. Null when too few letters
 * found their match to trust the timings.
 */
export function toAlignment(text: string, aligned: AlignedText, duration: number): Alignment | null {
  const flat: { ch: string; start: number; end: number }[] = [];
  for (const c of aligned.characters) {
    const chars = [...String(c.text ?? "")];
    const start = Number(c.start);
    const end = Number(c.end);
    if (!chars.length || !Number.isFinite(start) || !Number.isFinite(end)) continue;
    chars.forEach((ch, k) => flat.push({ ch, start: start + ((end - start) * k) / chars.length, end: start + ((end - start) * (k + 1)) / chars.length }));
  }
  const clamp = (t: number) => Math.max(0, Math.min(duration, t));
  const out: Alignment = { characters: [], character_start_times_seconds: [], character_end_times_seconds: [] };
  let at = 0;
  let prevStart = 0;
  let prevEnd = 0;
  let letters = 0;
  let matched = 0;
  for (const ch of text) {
    const isLetter = /[\p{L}\p{N}]/u.test(ch);
    if (isLetter) letters++;
    let hit = -1;
    for (let q = at; q < Math.min(flat.length, at + 8) && hit < 0; q++) if (same(ch, flat[q].ch)) hit = q;
    let start = prevEnd;
    let end = prevEnd;
    if (hit >= 0) {
      start = flat[hit].start;
      end = flat[hit].end;
      at = hit + 1;
      if (isLetter) matched++;
    }
    start = Math.max(prevStart, clamp(start));
    end = Math.max(start, clamp(end));
    out.characters.push(ch);
    out.character_start_times_seconds.push(start);
    out.character_end_times_seconds.push(end);
    prevStart = start;
    prevEnd = Math.max(prevEnd, end);
  }
  return letters && matched >= letters * 0.6 ? out : null;
}

/** Mono 44.1 kHz samples to a 16-bit FLAC, renamed into place when whole. */
export const encodeFlac = async (samples: Float32Array, out: string, signal?: AbortSignal) => {
  const raw = `${out}.f32`;
  const part = `${out}.part.flac`;
  fs.writeFileSync(raw, Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength));
  try {
    await run("ffmpeg", ["-v", "error", "-y", "-f", "f32le", "-ar", String(RATE), "-ac", "1", "-i", raw, "-c:a", "flac", "-sample_fmt", "s16", part], { signal });
    fs.renameSync(part, out);
  } finally {
    fs.rmSync(raw, { force: true });
    fs.rmSync(part, { force: true });
  }
};

/**
 * One recorded line ready for the joined track. Everything is cached under the take's sha256 in `dir`: the trimmed
 * audio, and its alignment per spoken text, so a re-run (another render, an edited Claude line) pays nothing.
 * A failed alignment falls back to even letters and is not cached, so the next run tries again.
 */
export async function prepareRecording(rec: Recording, text: string, dir: string, signal?: AbortSignal, log?: (m: string) => void): Promise<PreparedRecording> {
  fs.mkdirSync(dir, { recursive: true });
  const id = `${rec.sha256.toLowerCase().slice(0, 16)}.r${VERSION}`;
  const file = path.join(dir, `${id}.flac`);
  const boundsFile = path.join(dir, `${id}.json`);
  const alignFile = path.join(dir, `${id}.${crypto.createHash("sha1").update(text).digest("hex").slice(0, 12)}.align.json`);
  const label = `реплики ${rec.index + 1}`;

  // the speech bounds are written last and renamed into place: bounds on disk mean a whole prepared take
  const cachedBounds = (): { speech: [number, number]; duration: number } | null => {
    if (!fs.existsSync(file)) return null;
    try {
      const got = JSON.parse(fs.readFileSync(boundsFile, "utf8")) as { speech?: unknown; duration?: unknown };
      const ok = Array.isArray(got.speech) && got.speech.length === 2 && got.speech.every(Number.isFinite) && Number.isFinite(got.duration);
      return ok ? { speech: got.speech as [number, number], duration: got.duration as number } : null;
    } catch {
      return null;
    }
  };
  let speech: [number, number];
  let duration: number;
  const known = cachedBounds();
  if (known) {
    ({ speech, duration } = known);
  } else {
    const samples = await decodeMono(rec.file, signal);
    const bounds = speechBounds(samples);
    if (!bounds) throw new SilentTakeError(`В записи ${label} не слышно речи — перезапишите её`);
    const trimmed = trimToSpeech(samples, bounds);
    const from = Math.max(0, bounds[0] - AIR);
    speech = [bounds[0] - from, bounds[1] - from];
    duration = trimmed.length / RATE;
    await encodeFlac(trimmed, file, signal);
    fs.writeFileSync(`${boundsFile}.part`, JSON.stringify({ speech, duration, source: path.basename(rec.file), cut: [from, from + duration] }));
    fs.renameSync(`${boundsFile}.part`, boundsFile);
    log?.(`Запись ${label}: речь ${(bounds[1] - bounds[0]).toFixed(2)} с из ${(samples.length / RATE).toFixed(2)} с`);
  }

  if (!text) return { file, alignment: evenAlignment("", speech), source: "even", speech };
  if (fs.existsSync(alignFile)) return { file, alignment: JSON.parse(fs.readFileSync(alignFile, "utf8")) as Alignment, source: "elevenlabs", speech };
  try {
    const alignment = toAlignment(text, await alignAudio(file, text, signal), duration);
    if (!alignment) throw new Error("буквы записи не совпали с текстом реплики");
    fs.writeFileSync(`${alignFile}.part`, JSON.stringify(alignment));
    fs.renameSync(`${alignFile}.part`, alignFile);
    return { file, alignment, source: "elevenlabs", speech };
  } catch (error) {
    if (signal?.aborted) throw error;
    log?.(`Выравнивание записи ${label} не удалось (${(error as Error).message.slice(0, 200)}) — буквы распределены по речи равномерно`);
    return { file, alignment: evenAlignment(text, speech), source: "even", speech };
  }
}
