/**
 * «Собрать с моим голосом»: the finished video again — the same scene, the same cuts, Claude's voice as it was —
 * with the owner's takes, recorded in sync over that video, in place of his synthesized lines. Nothing is asked of
 * Claude and nothing is synthesized: each take goes into the voice track exactly where it was recorded, his lips and
 * subtitles follow forced alignment of it, and the scene is rendered again (GPU, about two minutes).
 * The montage in the work folder is never changed: the dub is built in dubbed/ next to it, so every dub starts from
 * the montage's own voice and the owner can re-record a line and dub again over the same windows.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Hooks, LineWindow, ProjectSpec, Script3D } from "./api";
import { loadCast, type CastFile } from "./cast";
import { alignAudio } from "./elevenlabs";
import { encode, hasWords, spokenText, wordsLoudness } from "./lineVoice";
import { readMark } from "./montageMark";
import { voicedLines, type Alignment, type VoiceSegment, type VoicedLine } from "./mouth";
import { decodeMono, encodeFlac, evenAlignment, RATE, speechRuns, toAlignment, type Recording } from "./recorded";
import { renderScene } from "./render";
import { lineSounds, SOUND_LINES, strayWindows, type FoundWindows, type MadeVideo, type Span } from "./soundLines";
import { mediaDuration } from "./voice";

const OWNER = "me";
/** The montage in the work folder is the site's video when their lengths agree within this, seconds. */
const SAME_DURATION = 0.15;
/**
 * Without his synthesized clip's bounds, the line is silenced from where its sound starts to where it dies out, and
 * at least this much around its window: the aligner's first letter may come a tenth of a second after the clip's
 * real onset (a plosive, a breath), and its last sound runs on after the last letter.
 */
const SILENCE_BEFORE = 0.05;
const SILENCE_AFTER = 0.3;
/** Below this a 10 ms block of the montage's voice is quiet. */
const QUIET_DB = -60;
const BLOCK = 0.01;
/** A quiet stretch this long ends a clip's sound: a breath and its word are closer, two lines' clips are 0.25 s apart (lineVoice GAP). */
const QUIET_RUN = 0.15;
/** A clip holds its line's window within this, seconds. */
const CLIP_SLACK = 0.01;
/**
 * Windows from the letter timings miss a performed [gasps] before the words and the tail of the last one: his take is
 * kept well wider than such a window.
 */
const KEEP_BEFORE = 0.25;
const KEEP_AFTER = 0.6;
/**
 * A window measured from the sound (soundLines.ts) holds all of his synthesized line: it goes from a little before to
 * a little after the window. His take is kept from EXACT_KEEP_BEFORE before to EXACT_KEEP_AFTER after the window, and
 * over all of his speech there with SPEECH_AIR around it, so a late start or a slower reading is never cut. These are
 * the protocol's DUB_KEEP_BEFORE, DUB_KEEP_AFTER and DUB_SPEECH_AIR: «Моя озвучка» plays his take over the same range.
 */
const EXACT_QUIET_BEFORE = 0.02;
const EXACT_QUIET_AFTER = 0.05;
export const EXACT_KEEP_BEFORE = 0.15;
export const EXACT_KEEP_AFTER = 0.3;
export const SPEECH_AIR = 0.08;
/** Sounds of a take this close together are one line: the pauses between his words, a breath just before them. */
const PAUSE = 0.3;
/** His speech may run this far into a neighbour's window: its air, before the neighbour's own sound (SOUND_PAD). */
const CUT_SLACK = 0.03;
/** Speech this close to an end of the take was still going when the recorder started or stopped. */
const TAKE_EDGE = 0.015;
/** A take belongs to the owner line whose window, this much wider, its own window overlaps. */
const MATCH_BEFORE = 0.25;
const MATCH_AFTER = 0.6;
const FADE = 0.015;
/** His parts never go over -1 dBFS, however far a quiet take is raised. */
const CEILING = 10 ** (-1 / 20);
/** A take is brought to his voice's loudness by at most this many dB: beyond it the take is mostly noise. */
const MAX_GAIN = 30;
/** Less of a take than this on its line's place is a take recorded somewhere else. */
const MIN_PART = 0.1;
/** Where the dub is built, next to the montage it starts from. */
export const DUB_DIR = "dubbed";
export const NO_SOURCES = "На компьютере нет исходников этого ролика — пересоберите ролик, потом озвучьте заново";

/** One owner take from the site's plan: the video time of its first sample and the window of its line. */
export type DubTakePlan = { index: number; text: string; sha256: string; videoStart: number; lineStart: number; lineEnd: number };

export type DubRequest = {
  /** The length of the video the takes were recorded over (the site's Video3D.duration). */
  videoDuration: number;
  /** Its time on the site (Video3D.at): a work folder marked with another video's is not this one's montage. */
  videoAt?: string;
  /** Asks the size of the site's video file; only when the times disagree: the very same file as final.mp4 is this montage. */
  videoBytes?: () => Promise<number | null>;
  /** The script that video was made from, when known: it ties the lines of older montages (no index) to the script. */
  videoScript: Script3D | null;
  /**
   * How the site's video has its windows found (Video3D.linesVersion): 0 none, 1 or missing from the letters,
   * SOUND_LINES from the sound. The dub reports its windows the same way, so the takes over them stay valid.
   */
  linesVersion?: number;
  takes: DubTakePlan[];
  /** Fetches the planned takes; called only once the montage is found, so a missing one costs no download. */
  download: () => Promise<Recording[]>;
};

/** Tests pass a cast and a stand-in for the 3D render. */
export type DubDeps = { cast?: CastFile; render?: typeof renderScene };

type SketchInput = { duration: number; voice?: string; lines: VoicedLine[] } & Record<string, unknown>;
/** Where a line's synthesized clip lies in the montage's voice, seconds: its breath before the words and its air after. */
type Clip = Span;
/**
 * clips: one per input line, null where the voiced take's timings do not tell; segments: every clip of the voice
 * (lines without words too), null when its timings are not next to it.
 */
type Sources = { input: SketchInput; scene: string; publicDir: string; voice: string; clips: (Clip | null)[]; segments: Clip[] | null };
/** The video as the site has it: its length, its time on the site (Video3D.at), and a way to ask its file size. */
export type SiteVideo = { duration: number; at?: string; bytes?: () => Promise<number | null> };

const r3 = (t: number) => Math.round(t * 1000) / 1000;
const sha1 = (text: string) => crypto.createHash("sha1").update(text).digest("hex").slice(0, 12);
const wordsOf = (text: string) =>
  spokenText(text)
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

/**
 * Script indexes of a montage's lines. Lines voiced since 2026-10-22 carry their own; older ones are matched to the
 * script by speaker and words in order, or by position among the lines with words when every speaker agrees.
 * Null when neither fits: no windows is better than windows on the wrong lines.
 */
export function scriptIndexes(lines: Pick<VoicedLine, "who" | "text" | "index">[], script: Script3D | null): number[] | null {
  if (lines.every((l) => Number.isInteger(l.index) && l.index! >= 0)) return lines.map((l) => l.index!);
  if (!script) return null;
  const byWords: number[] = [];
  let from = 0;
  for (const l of lines) {
    const want = wordsOf(l.text);
    let hit = -1;
    for (let i = from; i < script.lines.length && hit < 0; i++) if (script.lines[i].who === l.who && wordsOf(script.lines[i].text) === want) hit = i;
    if (hit < 0) break;
    byWords.push(hit);
    from = hit + 1;
  }
  if (byWords.length === lines.length) return byWords;
  const spoken = script.lines.flatMap((l, i) => (hasWords(l.text) ? [i] : []));
  if (spoken.length === lines.length && spoken.every((i, k) => script.lines[i].who === lines[k].who)) return spoken;
  return null;
}

/**
 * Every voiced line's window for the site, or null when the lines cannot be tied to script lines. sounds[k], when
 * given, is line k's window measured from the sound (measureLines); without them the window is the letters'.
 */
export function lineWindows(lines: VoicedLine[], script: Script3D | null, sounds?: Span[] | null): LineWindow[] | null {
  if (!lines.length || (sounds && sounds.length !== lines.length)) return null;
  const indexes = scriptIndexes(lines, script);
  if (!indexes || new Set(indexes).size !== indexes.length) return null;
  return lines.map((l, k) => {
    const [from, to] = sounds ? sounds[k] : [l.start, l.end];
    const start = r3(Math.max(0, from));
    return { index: indexes[k], who: l.who, start, end: Math.max(r3(to), r3(start + 0.05)) };
  });
}

const statOf = (file: string) => {
  try {
    return fs.statSync(file);
  } catch {
    return null;
  }
};

/**
 * Where each line's clip lies in the montage's voice. public/voice.mp3 is a byte copy of the voiced take in voice/
 * (or of its delivered version, <key>.d<hash>.mp3), and the take's raw timings next to it hold every line's clip:
 * voiced line by line, a line owns its clip whole, the breath before its first letter and the air after its last.
 * Null for a line no clip holds (the cache was cleared, a dialogue take moved its lines onto the sound).
 */
export function clipsOf(workDir: string, voice: string, lines: Pick<VoicedLine, "start" | "end" | "index">[]): (Clip | null)[] {
  const segments = takeSegments(workDir, voice);
  return segments ? clipsIn(segments, lines) : lines.map(() => null);
}

/** The voiced take's segments for the voice in public/ (see clipsOf), or null when its raw timings are not next to it. */
export function takeSegments(workDir: string, voice: string): VoiceSegment[] | null {
  const dir = path.join(workDir, "voice");
  const digest = (file: string) => crypto.createHash("sha1").update(fs.readFileSync(file)).digest("hex");
  try {
    const size = fs.statSync(voice).size;
    const own = digest(voice);
    for (const name of fs.readdirSync(dir)) {
      const key = /^([0-9a-f]+)(?:\.d[0-9a-f]+)?\.mp3$/.exec(name)?.[1];
      const file = path.join(dir, name);
      if (!key || statOf(file)?.size !== size || digest(file) !== own) continue;
      const raw = JSON.parse(fs.readFileSync(path.join(dir, `${key}.raw.json`), "utf8")) as { segments?: unknown };
      if (!Array.isArray(raw.segments)) return null;
      const segments = raw.segments as VoiceSegment[];
      return segments.every((s) => Number.isFinite(s?.start_time_seconds) && Number.isFinite(s?.end_time_seconds)) ? segments : null;
    }
  } catch {
    // no voice folder, or a take without its timings: nothing is known
  }
  return null;
}

const spanOf = (s: VoiceSegment): Clip => [s.start_time_seconds, s.end_time_seconds];

/** Each line's clip among the take's segments (see clipsOf). */
function clipsIn(segments: VoiceSegment[], lines: Pick<VoicedLine, "start" | "end" | "index">[]): (Clip | null)[] {
  return lines.map((l) => {
    // its own segments (one input may come back in several), or, for a line without an index, the one holding it
    const own = segments.filter((s) =>
      Number.isInteger(l.index) ? s.dialogue_input_index === l.index : s.start_time_seconds <= l.start + CLIP_SLACK && s.end_time_seconds >= l.end - CLIP_SLACK,
    );
    if (!own.length) return null;
    const clip: Clip = [Math.min(...own.map((s) => s.start_time_seconds)), Math.max(...own.map((s) => s.end_time_seconds))];
    return Number.isFinite(clip[0]) && Number.isFinite(clip[1]) && clip[0] <= l.start + CLIP_SLACK && clip[1] >= l.end - CLIP_SLACK ? clip : null;
  });
}

/**
 * The finished montage in the work folder, when it is the video the site has: the scene the final render used, its
 * input and voice, and a final.mp4 of the same length. A montage that failed after writing a new input.json or scene
 * leaves the older final.mp4 behind, so files newer than final.mp4 are not its sources. A folder marked with the
 * site's video time (montageMark.ts) must be marked with this video's; one marked "pending" holds a montage the
 * site never took. Folders from before marks are told by length alone.
 */
export async function montageSources(workDir: string, site: SiteVideo): Promise<{ sources: Sources } | { reason: string }> {
  const videoDuration = site.duration;
  const final = path.join(workDir, "final.mp4");
  const inputFile = path.join(workDir, "input.json");
  const sceneFile = path.join(workDir, "Scene.tsx");
  const publicDir = path.join(workDir, "public");
  const [video, inputStat, sceneStat] = [final, inputFile, sceneFile].map(statOf);
  const absent = [!video && "final.mp4", !inputStat && "input.json", !sceneStat && "Scene.tsx"].filter(Boolean);
  if (!video || !inputStat || !sceneStat) return { reason: `нет ${absent.join(", ")}` };
  const mark = readMark(workDir);
  if (mark?.state === "pending") return { reason: "последний монтаж в папке не дошёл до сайта" };
  if (mark && site.at && mark.videoAt !== site.at) {
    // a video re-rendered here and put on the site by hand gets a new time there; the same file is still this montage
    const bytes = site.bytes ? await site.bytes().catch(() => null) : null;
    if (!(bytes && bytes === video.size)) return { reason: `монтаж в папке — ролик от ${mark.videoAt}, а на сайте ролик от ${site.at}` };
  }
  let input: SketchInput;
  try {
    input = JSON.parse(fs.readFileSync(inputFile, "utf8")) as SketchInput;
  } catch {
    return { reason: "input.json не читается" };
  }
  if (!input || !Array.isArray(input.lines) || !Number.isFinite(input.duration)) return { reason: "в input.json нет реплик или длительности" };
  const voiceName = typeof input.voice === "string" && input.voice ? input.voice : "voice.mp3";
  const voice = path.join(publicDir, voiceName);
  if (!statOf(voice)) return { reason: `нет public/${voiceName}` };
  if (inputStat.mtimeMs > video.mtimeMs || sceneStat.mtimeMs > video.mtimeMs) return { reason: "input.json или Scene.tsx новее final.mp4 — последний монтаж не дошёл до рендера" };
  if (!(Math.abs(input.duration - videoDuration) <= SAME_DURATION)) return { reason: `монтаж в папке на ${input.duration} с, а ролик на сайте на ${videoDuration} с` };
  const real = await mediaDuration(final).catch(() => NaN);
  if (!(Math.abs(real - videoDuration) <= SAME_DURATION)) return { reason: `final.mp4 длиной ${real} с, а ролик на сайте на ${videoDuration} с` };
  const segments = takeSegments(workDir, voice);
  const clips = segments ? clipsIn(segments, input.lines) : input.lines.map(() => null);
  return { sources: { input, scene: fs.readFileSync(sceneFile, "utf8"), publicDir, voice, clips, segments: segments?.map(spanOf) ?? null } };
}

/**
 * Each montage line's window measured from the sound of its own clip (soundLines.ts), or null when some line's clip
 * is not known (the voice cache was cleared, an older dialogue take): then every window stays the letters', never a
 * mix of both. audio is the decoded voice when the caller has it already.
 */
export async function measureLines(voice: string, lines: Pick<VoicedLine, "start" | "end">[], clips: (Clip | null)[], segments: Clip[] | null, audio?: Float32Array, signal?: AbortSignal): Promise<Span[] | null> {
  if (!segments || !lines.length || clips.length !== lines.length || clips.some((c) => !c)) return null;
  const samples = audio ?? (await decodeMono(voice, signal));
  return lineSounds(samples, clips as Clip[], segments, lines.map((l): Span => [l.start, l.end]));
}

/**
 * The windows the site gets for a montage's lines: the montage, the voice job's backfill and the dub all find them
 * here, so a video's windows are the same whoever reports them. Measured from the sound (version SOUND_LINES) when the
 * voiced take's timings are next to the voice, else from the letters (no version). Null when the lines do not map.
 */
export async function montageWindows(workDir: string, voice: string, lines: VoicedLine[], script: Script3D | null, signal?: AbortSignal): Promise<{ lines: LineWindow[]; version?: number } | null> {
  const segments = takeSegments(workDir, voice);
  return windowsOf(voice, lines, script, segments ? clipsIn(segments, lines) : [], segments?.map(spanOf) ?? null, signal);
}

async function windowsOf(voice: string, lines: VoicedLine[], script: Script3D | null, clips: (Clip | null)[], segments: Clip[] | null, signal?: AbortSignal): Promise<{ lines: LineWindow[]; version?: number } | null> {
  const sounds = await measureLines(voice, lines, clips, segments, undefined, signal);
  const windows = lineWindows(lines, script, sounds);
  return windows ? { lines: windows, ...(sounds ? { version: SOUND_LINES } : {}) } : null;
}

/**
 * The windows of the video the site has, from its montage in the work folder: a "voice" job sends them for videos
 * made before windows were stored, or measured before they were measured from the sound. Null when the folder holds
 * no montage of this video or its lines do not map.
 */
export async function findLineWindows(workDir: string, video: SiteVideo, script: Script3D | null, log?: (m: string) => void): Promise<FoundWindows | null> {
  const found = await montageSources(workDir, video);
  if (!("sources" in found)) {
    log?.(`Окна реплик ролика не найдены: ${found.reason}`);
    return null;
  }
  const { voice, input, clips, segments } = found.sources;
  const windows = await windowsOf(voice, input.lines, script, clips, segments);
  if (!windows) {
    log?.("Окна реплик ролика не найдены: реплики монтажа не сопоставились со сценарием");
    return null;
  }
  if (!windows.version) log?.("Окна реплик ролика — по буквам: таймингов озвучки рядом с голосом монтажа нет");
  return { videoDuration: input.duration, ...windows };
}

/** One take over the video: mono 44.1 kHz as recorded, its first sample at videoStart; slot is its montage line. */
export type DubTakeAudio = { slot: number; index: number; videoStart: number; window: [number, number]; audio: Float32Array };
/** What of a take went into the track: video samples [from, to), the take's own sample at `offset`, its speech in seconds from `from`. */
export type PlacedPart = { slot: number; index: number; from: number; to: number; offset: number; speech: [number, number] };
export type DubVoice = { track: Float32Array; parts: PlacedPart[]; gainDb: number };

/**
 * A brickwall limiter in place: the gain reaches the ceiling by each peak over it, falling over 5 ms before the peak
 * and recovering over 50 ms after, so the loud spot is lowered without clipping it. Returns the deepest cut, dB.
 */
export function limit(x: Float32Array, ceiling = CEILING): number {
  const need = new Float32Array(x.length);
  let deepest = 1;
  for (let n = 0; n < x.length; n++) {
    const a = Math.abs(x[n]);
    need[n] = a > ceiling ? ceiling / a : 1;
    deepest = Math.min(deepest, need[n]);
  }
  if (deepest >= 1) return 0;
  const attack = 1 / Math.round(0.005 * RATE);
  const release = 1 / Math.round(0.05 * RATE);
  // backwards: the gain is down by the time a peak arrives
  let g = 1;
  for (let n = x.length - 1; n >= 0; n--) need[n] = g = Math.min(need[n], g + attack);
  // forwards: it comes back slowly after it
  g = 1;
  for (let n = 0; n < x.length; n++) {
    g = Math.min(need[n], g + release);
    x[n] *= g;
  }
  return Math.round(20 * Math.log10(deepest) * 10) / 10;
}

/**
 * A montage line for the dub: its window, and its synthesized clip's bounds when the voiced take's timings tell them.
 * exact: the window was measured from the sound of that clip (soundLines.ts) and holds all of the line.
 */
export type DubLine = Pick<VoicedLine, "start" | "end"> & { clip?: Clip | null; exact?: boolean };

/**
 * His line in a take: the runs of speech (video seconds) that meet its place [start, end] — or the one nearest it,
 * when he said all of it before or after — with every run within PAUSE of them: a breath right before the words, a
 * last word after a pause. Runs wholly outside [lo, hi] are other lines' places and never join; a run across lo or
 * hi is his line running into a neighbour. Null when no run is in [lo, hi].
 */
export function lineSpeech(runs: Span[], start: number, end: number, lo: number, hi: number): Span | null {
  const near = runs.filter(([a, b]) => b > lo && a < hi);
  if (!near.length) return null;
  const meets = near.filter(([a, b]) => b > start && a < end);
  const away = ([a, b]: Span) => Math.max(0, start - b, a - end);
  const core = meets.length ? meets : [near.reduce((x, y) => (away(y) < away(x) ? y : x))];
  let c0 = Math.min(...core.map((r) => r[0]));
  let c1 = Math.max(...core.map((r) => r[1]));
  for (let grew = true; grew; ) {
    grew = false;
    for (const [a, b] of near) {
      if (b < c0 - PAUSE || a > c1 + PAUSE || (a >= c0 && b <= c1)) continue;
      [c0, c1, grew] = [Math.min(c0, a), Math.max(c1, b), true];
    }
  }
  return [c0, c1];
}

const sec = (t: number) => t.toFixed(2);

/**
 * The voice track with the owner's takes in place of his lines. lines are the montage's voiced lines (their windows),
 * then the windows of its sounds no line owns (lines without words: no take is theirs). A dubbed line's synthesized
 * clip is silenced in the montage's voice whole (without its bounds, from where its sound starts to where it dies
 * out, heard in the track); an exact window (measured from the sound) is silenced from 0.02 s before to 0.05 s after
 * it. His take is laid in at exactly the video time it was recorded at, over the window with some air around it (an
 * exact one: 0.15 s before, 0.3 s after) and over all of his speech there with SPEECH_AIR around it: all of his line
 * and nothing else. None of it reaches into another line's window or another sound of the montage, and two of his
 * lines in a row meet halfway between his two speeches. Speech that would be cut by that — or that the recorder cut —
 * fails the dub with the lines to re-record, before anything is rendered. All his parts get one gain, to `target`
 * LUFS measured over the speech of all of them together (a short reply counts like a long one); null leaves them as
 * recorded. The montage's voice outside his parts is untouched. base is as long as the video: the montage's voice
 * ends before it, and a take of the last line may run on past that.
 */
export async function buildDubVoice(base: Float32Array, lines: DubLine[], takes: DubTakeAudio[], target: number | null, log?: (m: string) => void): Promise<DubVoice> {
  const total = base.length;
  const length = total / RATE;
  const toN = (t: number) => Math.max(0, Math.min(total, Math.round(t * RATE)));
  const fade = Math.max(1, Math.round(FADE * RATE));
  const ramp = (n: number, from: number, to: number) => Math.max(0, Math.min(1, (n - from) / fade, (to - 1 - n) / fade));
  const block = Math.round(BLOCK * RATE);
  const quiet = 10 ** (QUIET_DB / 10);
  const loud = (x: Float32Array, a: number, b: number) => {
    let energy = 0;
    for (let i = a; i < b; i++) energy += x[i] * x[i];
    return energy >= quiet * (b - a);
  };
  // from t back (-1) or on (+1) through the montage's sound, over pauses shorter than QUIET_RUN, up to `bound`:
  // where the last sound met ends, seconds
  const soundEdge = (t: number, bound: number, dir: 1 | -1): number => {
    const stop = toN(bound);
    let n = toN(t);
    let edge = n;
    let still = 0;
    while (dir < 0 ? n > stop : n < stop) {
      const [a, b] = dir < 0 ? [Math.max(stop, n - block), n] : [n, Math.min(stop, n + block)];
      if (!loud(base, a, b)) {
        still += b - a;
        if (still >= QUIET_RUN * RATE) break;
      } else {
        still = 0;
        edge = dir < 0 ? a : b;
      }
      n = dir < 0 ? a : b;
    }
    return edge / RATE;
  };
  // from t back or on to `bound`, where the first sound of x begins: `bound` when there is none
  const firstSound = (x: Float32Array, t: number, bound: number, dir: 1 | -1): number => {
    const stop = toN(bound);
    for (let n = toN(t); dir < 0 ? n > stop : n < stop; ) {
      const [a, b] = dir < 0 ? [Math.max(stop, n - block), n] : [n, Math.min(stop, n + block)];
      if (loud(x, a, b)) return (dir < 0 ? b : a) / RATE;
      n = dir < 0 ? a : b;
    }
    return bound;
  };
  const dubbed = new Map(takes.map((t) => [t.slot, t]));
  // a dubbed line covers its window in the montage and the window its take was recorded for (the same, normally)
  const spans = lines.map((l, k): [number, number] => {
    const t = dubbed.get(k);
    return t ? [Math.min(l.start, t.window[0]), Math.max(l.end, t.window[1])] : [l.start, l.end];
  });
  // how far a dubbed line may reach: up to the windows of the lines and sounds around it
  const limits = (k: number): [number, number] => {
    const [start, end] = spans[k];
    let lo = 0;
    let hi = length;
    spans.forEach(([s, e], o) => {
      if (o === k) return;
      if (s + e < start + end) lo = Math.max(lo, e);
      else hi = Math.min(hi, s);
    });
    return [Math.min(lo, start), Math.max(hi, end)];
  };

  const track = base.slice();
  for (const t of takes) {
    const [start, end] = spans[t.slot];
    const [lo, hi] = limits(t.slot);
    // the fades lie outside the sound they remove: its onset must not be heard fading out
    const { clip, exact } = lines[t.slot];
    const [quietFrom, quietTo] = exact
      ? // its clip goes whole too when known: a click where it was joined in is no part of the line either
        [Math.min(start - EXACT_QUIET_BEFORE, clip ? clip[0] - FADE : Infinity), Math.max(end + EXACT_QUIET_AFTER, clip ? clip[1] + FADE : -Infinity)]
      : clip
        ? [Math.min(clip[0], start) - FADE, Math.max(clip[1], end) + FADE]
        : [Math.min(start - SILENCE_BEFORE, soundEdge(start - SILENCE_BEFORE, lo, -1) - FADE), Math.max(end + SILENCE_AFTER, soundEdge(end, hi, 1) + FADE)];
    const [a, b] = [toN(Math.max(lo, quietFrom)), toN(Math.min(hi, quietTo))];
    for (let n = a; n < b; n++) track[n] *= 1 - ramp(n, a, b);
  }

  // the part of each take that goes in, once all his synthesized lines are gone
  type Placed = PlacedPart & { said: Span; wide: boolean };
  const placed: Placed[] = [];
  const issues: string[] = [];
  for (const t of takes) {
    const [start, end] = spans[t.slot];
    let [lo, hi] = limits(t.slot);
    const exact = lines[t.slot].exact;
    // windows from the letters miss sounds of the montage around them (a line without words, a neighbour's tail):
    // nothing of his goes over what the track still has
    if (!exact) [lo, hi] = [Math.max(lo, firstSound(track, start, lo, -1)), Math.min(hi, firstSound(track, end, hi, 1))];
    const [before, after] = exact ? [EXACT_KEEP_BEFORE, EXACT_KEEP_AFTER] : [KEEP_BEFORE, KEEP_AFTER];
    const offset = Math.round(t.videoStart * RATE);
    const [takeFrom, takeTo] = [t.videoStart, t.videoStart + t.audio.length / RATE];
    if (Math.min(hi, end + after, takeTo) - Math.max(lo, start - before, takeFrom) < MIN_PART)
      throw new Error(`Запись реплики ${t.index + 1} не попадает на её место в ролике — озвучьте её заново`);
    const runs = speechRuns(t.audio).map(([a, b]): Span => [takeFrom + a, takeFrom + b]);
    const said = lineSpeech(runs, start, end, lo, hi);
    if (!said) throw new Error(`В записи реплики ${t.index + 1} не слышно речи там, где идёт реплика — озвучьте её заново (если говорили, проверьте «Задержку записи»)`);
    const n = t.index + 1;
    if (said[0] < lo - CUT_SLACK)
      issues.push(lo <= 0 ? `реплика ${n} начинается до начала ролика на ${sec(-said[0])} с — начните чуть позже` : `реплика ${n} начинается на ${sec(lo - said[0])} с раньше, чем кончается предыдущая, — начните чуть позже`);
    if (said[1] > hi + CUT_SLACK)
      issues.push(hi >= length ? `реплика ${n} выходит за конец ролика на ${sec(said[1] - hi)} с — скажите её чуть быстрее` : `реплика ${n} заходит на следующую на ${sec(said[1] - hi)} с — скажите её чуть быстрее`);
    if (said[0] <= takeFrom + TAKE_EDGE && takeFrom > lo) issues.push(`в записи реплики ${n} оборвано начало: запись началась, когда вы уже говорили`);
    if (said[1] >= takeTo - TAKE_EDGE && takeTo < hi) issues.push(`в записи реплики ${n} оборван конец: запись остановилась на словах`);
    const keep: Span = [Math.min(start - before, said[0] - SPEECH_AIR), Math.max(end + after, said[1] + SPEECH_AIR)];
    const from = Math.max(toN(Math.max(lo, keep[0])), offset);
    const to = Math.min(toN(Math.min(hi, keep[1])), offset + t.audio.length);
    const wide = keep[0] < start - before || keep[1] > end + after;
    placed.push({ slot: t.slot, index: t.index, from, to, offset, speech: [0, 0], said, wide });
  }
  // two of his lines in a row share the silence between his two speeches
  const inTime = [...placed].sort((p, q) => p.from - q.from);
  for (const [i, q] of inTime.entries()) {
    const p = inTime[i - 1];
    if (!p || p.to <= q.from) continue;
    if (p.said[1] > q.said[0]) issues.push(`реплики ${p.index + 1} и ${q.index + 1} наложились друг на друга — скажите первую быстрее или вторую позже`);
    const border = Math.max(q.from, Math.min(p.to, Math.round(((p.said[1] + q.said[0]) / 2) * RATE)));
    [p.to, q.from] = [border, border];
  }
  if (issues.length) throw new Error(`Запись не встанет в ролик целиком — перезапишите: ${issues.join("; ")}`);
  const parts: PlacedPart[] = placed.map(({ said, wide, ...p }) => {
    const [from, to] = [p.from / RATE, p.to / RATE];
    if (wide) log?.(`Запись реплики ${p.index + 1}: речь шире окна, взята целиком — ${sec(from)}–${sec(to)} с`);
    return { ...p, speech: [Math.max(0, said[0] - from), Math.max(0, Math.min(to, said[1]) - from)] };
  });

  const audioOf = (p: PlacedPart) => dubbed.get(p.slot)!.audio;
  let gainDb = 0;
  if (target !== null && parts.length) {
    const words = parts.map((p) => audioOf(p).subarray(p.from - p.offset + Math.floor(p.speech[0] * RATE), p.from - p.offset + Math.ceil(p.speech[1] * RATE)));
    const joined = new Float32Array(words.reduce((s, w) => s + w.length, 0));
    words.reduce((at, w) => (joined.set(w, at), at + w.length), 0);
    const measured = await wordsLoudness(joined);
    if (!Number.isFinite(measured) || measured <= -69) log?.("Твои записи слишком тихие, чтобы их измерить: громкость оставлена как записана");
    else {
      gainDb = Math.round(Math.max(-MAX_GAIN, Math.min(MAX_GAIN, target - measured)) * 10) / 10;
      if (Math.abs(gainDb) >= MAX_GAIN) log?.(`Твои записи слишком ${gainDb > 0 ? "тихие" : "громкие"}: громкость поправлена на ${gainDb} дБ, не до конца`);
    }
  }
  const k = 10 ** (gainDb / 20);
  for (const p of parts) {
    const audio = audioOf(p);
    for (let n = p.from; n < p.to; n++) track[n] += audio[n - p.offset] * k * ramp(n, p.from, p.to);
  }
  for (const p of parts) {
    const cut = limit(track.subarray(p.from, p.to));
    if (cut < -3) log?.(`Запись реплики ${p.index + 1}: пики срезаны ограничителем на ${-cut} дБ`);
  }
  return { track, parts, gainDb };
}

/** The loudness of the montage's own voice on the lines being replaced: the target when the cast sets none. */
async function replacedLoudness(base: Float32Array, lines: VoicedLine[], slots: number[]): Promise<number | null> {
  const pieces = slots.map((k) => base.subarray(Math.max(0, Math.round(lines[k].start * RATE)), Math.min(base.length, Math.round(lines[k].end * RATE))));
  const joined = new Float32Array(pieces.reduce((s, p) => s + p.length, 0));
  pieces.reduce((at, p) => (joined.set(p, at), at + p.length), 0);
  const measured = await wordsLoudness(joined);
  return Number.isFinite(measured) && measured > -69 ? measured : null;
}

/**
 * Which montage line each take replaces: the owner's line whose window it was recorded for; the index only breaks
 * ties. windows[k] is line k's window in the dub (from the letters or the sound, as the take's own may be either).
 */
function matchTakes(lines: VoicedLine[], windows: DubLine[], takes: DubTakePlan[]): number[] {
  const used = new Set<number>();
  return takes.map((t) => {
    let best = -1;
    let bestScore = 0;
    lines.forEach((l, k) => {
      if (l.who !== OWNER || used.has(k)) return;
      const overlap = Math.min(t.lineEnd, windows[k].end + MATCH_AFTER) - Math.max(t.lineStart, windows[k].start - MATCH_BEFORE);
      const score = overlap + (l.index === t.index ? 1e-3 : 0);
      if (overlap > 0 && score > bestScore) [best, bestScore] = [k, score];
    });
    if (best < 0) throw new Error(`Реплика ${t.index + 1} озвучена поверх другого ролика — озвучьте её заново`);
    used.add(best);
    return best;
  });
}

/**
 * Letter timings of one placed part, in video time. Forced alignment is cached by the take's sha256, the part of
 * it and the text, so dubbing again after re-recording another line pays nothing for this one; a failed alignment
 * spreads the letters over the speech and is not cached, so the next dub tries again.
 */
async function partLine(part: PlacedPart, audio: Float32Array, take: DubTakePlan, cacheDir: string, signal: AbortSignal, log: (m: string) => void): Promise<VoicedLine> {
  const text = spokenText(take.text);
  const raw = audio.subarray(part.from - part.offset, part.to - part.offset);
  const duration = raw.length / RATE;
  const id = `${take.sha256.toLowerCase().slice(0, 16)}.${part.from - part.offset}-${part.to - part.offset}.${sha1(text)}`;
  const cached = path.join(cacheDir, `${id}.align.json`);
  let alignment: Alignment;
  if (fs.existsSync(cached)) alignment = JSON.parse(fs.readFileSync(cached, "utf8")) as Alignment;
  else {
    const file = path.join(cacheDir, `${id}.flac`);
    try {
      fs.mkdirSync(cacheDir, { recursive: true });
      // the aligner hears the part at a full level: a quiet mic must not cost the timings
      let peak = 0;
      for (const v of raw) peak = Math.max(peak, Math.abs(v));
      const loud = Float32Array.from(raw, (v) => (peak > 0 ? (v * 0.9) / peak : 0));
      await encodeFlac(loud, file, signal);
      const found = toAlignment(text, await alignAudio(file, text, signal), duration);
      if (!found) throw new Error("буквы записи не совпали с текстом реплики");
      fs.writeFileSync(`${cached}.part`, JSON.stringify(found));
      fs.renameSync(`${cached}.part`, cached);
      alignment = found;
    } catch (error) {
      if (signal.aborted) throw error;
      log(`Разметка записи реплики ${take.index + 1} не удалась (${(error as Error).message.slice(0, 200)}) — буквы распределены по речи равномерно`);
      alignment = evenAlignment(text, part.speech);
    } finally {
      fs.rmSync(file, { force: true });
    }
  }
  const at = part.from / RATE;
  const shifted: Alignment = {
    characters: alignment.characters,
    character_start_times_seconds: alignment.character_start_times_seconds.map((t) => t + at),
    character_end_times_seconds: alignment.character_end_times_seconds.map((t) => t + at),
  };
  const segment = { voice_id: "", start_time_seconds: at, end_time_seconds: part.to / RATE, character_start_index: 0, character_end_index: shifted.characters.length, dialogue_input_index: take.index };
  return voicedLines(shifted, [segment], () => OWNER)[0];
}

/**
 * The "dub" job: the montage in the work folder (it must be the site's current video) with the owner's takes in
 * place of his synthesized lines — his words, lips and subtitles where he said them, everything else as it was —
 * rendered again and returned with the same windows, so the takes recorded over it stay in place for the next dub.
 */
export async function makeDub(p: ProjectSpec, workDir: string, hooks: Hooks, req: DubRequest, deps: DubDeps = {}): Promise<MadeVideo> {
  hooks.stage("Ищу исходники ролика", 1);
  const found = await montageSources(workDir, { duration: req.videoDuration, at: req.videoAt, bytes: req.videoBytes });
  if (!("sources" in found)) {
    hooks.log(`Исходников ролика нет: ${found.reason}`);
    throw new Error(NO_SOURCES);
  }
  const src = found.sources;
  const base = src.input.lines;
  // a take of a line with no words ([laughs]) has no window in the video: nothing of the montage to replace
  const takes = req.takes.filter((t) => hasWords(t.text));
  for (const t of req.takes) if (!hasWords(t.text)) hooks.log(`Запись реплики ${t.index + 1} без слов — в ролике её место не размечено, пропускаю`);
  if (!takes.length) throw new Error("Нет ни одной записи поверх ролика — озвучьте свои реплики и соберите снова");
  // the montage's own windows, found the way the montage reported them: the places his takes were recorded into
  const decoded = await decodeMono(src.voice, hooks.signal);
  const sounds = await measureLines(src.voice, base, src.clips, src.segments, decoded);
  if (!sounds) hooks.log("Окна реплик монтажа — по буквам: таймингов озвучки рядом с его голосом нет");
  const dubLines = base.map((l, k): DubLine => (sounds ? { start: sounds[k][0], end: sounds[k][1], clip: src.clips[k], exact: true } : { start: l.start, end: l.end, clip: src.clips[k] }));
  // the clips no line owns (a [laughs] of its own) are neighbours too: nothing of his goes over them
  if (sounds && src.segments) dubLines.push(...strayWindows(decoded, src.clips as Clip[], src.segments).map(([start, end]): DubLine => ({ start, end })));
  const slots = matchTakes(base, dubLines, takes);

  const recordings = await req.download();
  hooks.signal.throwIfAborted();
  hooks.stage("Собираю звук", 10);
  const cast = deps.cast ?? loadCast();
  const files = new Map(recordings.map((r) => [r.index, r.file]));
  const audios: DubTakeAudio[] = [];
  for (const [n, t] of takes.entries()) {
    const file = files.get(t.index);
    if (!file) throw new Error(`Запись реплики ${t.index + 1} не скачалась`);
    audios.push({ slot: slots[n], index: t.index, videoStart: t.videoStart, window: [t.lineStart, t.lineEnd], audio: await decodeMono(file, hooks.signal) });
  }
  // the montage's voice ends 0.3 s after its last clip and the video 0.7 s later: a take of the last line may run on
  // into that, so the dub's voice is as long as the video
  const voiceSamples = new Float32Array(Math.max(decoded.length, Math.round(src.input.duration * RATE)));
  voiceSamples.set(decoded);
  const target = cast[OWNER]?.tts?.loudness ?? (await replacedLoudness(voiceSamples, base, slots));
  const voice = await buildDubVoice(voiceSamples, dubLines, audios, target ?? null, hooks.log);
  hooks.log(`Свой голос поверх ролика: записей ${voice.parts.length}, громкость ${voice.gainDb > 0 ? "+" : ""}${voice.gainDb} дБ`);

  const lines = base.slice();
  const cacheDir = path.join(workDir, "dub", "align");
  for (const [n, part] of voice.parts.entries()) {
    hooks.signal.throwIfAborted();
    hooks.stage(`Разметка губ: ${n + 1} из ${voice.parts.length}`, 18 + Math.round((6 * n) / voice.parts.length));
    const k = takes.findIndex((_, i) => slots[i] === part.slot);
    const line = await partLine(part, audios[k].audio, takes[k], cacheDir, hooks.signal, hooks.log);
    const index = base[part.slot].index;
    lines[part.slot] = index === undefined ? line : { ...line, index };
  }

  // the dub next to the montage: the montage itself stays the starting point of every dub
  const dir = path.join(workDir, DUB_DIR);
  fs.rmSync(dir, { recursive: true, force: true });
  const publicDir = path.join(dir, "public");
  fs.cpSync(src.publicDir, publicDir, { recursive: true });
  await encode(voice.track, path.join(publicDir, "voice.mp3"));
  const input = { ...src.input, voice: "voice.mp3", lines };
  fs.writeFileSync(path.join(dir, "input.json"), JSON.stringify(input));
  fs.writeFileSync(path.join(dir, "Scene.tsx"), src.scene);

  hooks.signal.throwIfAborted();
  hooks.stage("Рендер 3D", 25);
  const out = path.join(dir, "final.mp4");
  let shown = -1;
  await (deps.render ?? renderScene)(
    src.scene,
    input,
    publicDir,
    out,
    `${p.id}-dub`,
    (f) => {
      const pct = Math.round(f * 100);
      if (pct !== shown && pct % 5 === 0) {
        shown = pct;
        hooks.stage(`Рендер 3D: ${pct}%`, 25 + Math.round(f * 70));
      }
    },
    hooks.signal,
  );
  hooks.stage("Готово", 96);
  return { video: out, duration: src.input.duration, ...dubWindows(base, req.videoScript, sounds, req.linesVersion ?? 1, hooks.log) };
}

/**
 * The windows a dub reports: the montage's, not where he spoke — they are the places the page records into — and
 * found the way the site's video has them found (siteVersion, its linesVersion: 0 none, 1 the letters), since the
 * site keeps the takes recorded over the previous video only while the windows stay the same. So a dub never
 * re-measures them: windows from the letters stay the letters' until the voice job («Уточнить разметку») measures
 * them from the sound, and when the dub cannot find them as the site has them it sends none, and the site keeps the
 * previous video's. A video without windows gets the best the montage tells.
 */
function dubWindows(lines: VoicedLine[], script: Script3D | null, sounds: Span[] | null, siteVersion: number, log: (m: string) => void): Pick<MadeVideo, "lines" | "linesVersion"> {
  const letters = siteVersion === 1 || (siteVersion === 0 && !sounds);
  if (!letters && !(sounds && siteVersion <= SOUND_LINES)) {
    log("Окна реплик не найти так же, как у ролика на сайте, — на сайте останутся прежние");
    return {};
  }
  if (letters && sounds) log("Окна реплик оставлены по буквам, как у ролика на сайте: по звуку их делает «Уточнить разметку»");
  const windows = lineWindows(lines, script, letters ? null : sounds);
  if (!windows) {
    log("Окна реплик не сопоставились со сценарием — ролик уйдёт без них");
    return {};
  }
  return { lines: windows, ...(letters ? {} : { linesVersion: SOUND_LINES }) };
}
