import { CAST_IDS, DUB_POST_ROLL, DUB_PRE_ROLL, LINES_VERSION, MAX_LINE_CHARS, MAX_LINES, MAX_SCRIPT_CHARS, STALE_MS } from "./types";
import type { CastId, Dub3D, DubTake, Job3D, LineClip, Project3D, Script3D, Video3D, VideoLine } from "./types";

/**
 * Rules of the «3Д» section that both the store and the pages need: limits, script checks,
 * job liveness and the status chip. No Node imports here — the pages bundle this file.
 */

export const TOPIC_MIN = 3;
export const TOPIC_MAX = 600;
export const NOTES_MAX = 1000;
export const TITLE_MAX = 120;

export const CAST_LABEL: Record<CastId, string> = { me: "Ты", claude: "Клод" };

export const isCastId = (v: unknown): v is CastId => typeof v === "string" && (CAST_IDS as readonly string[]).includes(v);

/** Line breaks and double spaces mean nothing to the voice or the subtitles. */
export const cleanText = (s: string) => s.replace(/\s+/g, " ").trim();

/** ElevenLabs performs only English audio tags; a Russian one would be read out loud. */
const RUSSIAN_TAG = /\[[^\]]*[а-яё][^\]]*\]/i;

/**
 * Normalizes a script from the page or the runner. Problems come back as Russian sentences
 * instead of an exception, so the editor can show them next to the lines.
 */
export function checkScript(raw: unknown, minLines = 1): { script: Script3D | null; problems: string[] } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { script: null, problems: ["Сценарий не распознан"] };
  const r = raw as { title?: unknown; lines?: unknown };
  const problems: string[] = [];
  if (r.title !== undefined && typeof r.title !== "string") problems.push("Название должно быть строкой");
  const title = typeof r.title === "string" ? cleanText(r.title) : "";
  if (title.length > TITLE_MAX) problems.push(`Название длиннее ${TITLE_MAX} знаков`);
  if (!Array.isArray(r.lines)) return { script: null, problems: [...problems, "В сценарии нет списка реплик"] };

  const lines: Script3D["lines"] = [];
  r.lines.forEach((line: unknown, i: number) => {
    const n = i + 1;
    const l = (line && typeof line === "object" ? line : {}) as { who?: unknown; text?: unknown };
    if (!isCastId(l.who)) problems.push(`Реплика ${n}: неизвестно, кто говорит`);
    const text = typeof l.text === "string" ? cleanText(l.text) : "";
    if (!text) problems.push(`Реплика ${n} пустая`);
    else if (text.length > MAX_LINE_CHARS) problems.push(`Реплика ${n} длиннее ${MAX_LINE_CHARS} знаков (${text.length})`);
    if (RUSSIAN_TAG.test(text)) problems.push(`Реплика ${n}: теги голоса пишутся по-английски — [sighs], а не [вздыхает]`);
    lines.push({ who: isCastId(l.who) ? l.who : "me", text });
  });

  if (lines.length < minLines) problems.push(minLines >= 2 ? "Для диалога нужно не меньше двух реплик" : "Добавьте хотя бы одну реплику");
  if (lines.length > MAX_LINES) problems.push(`Реплик больше ${MAX_LINES}`);
  const total = scriptChars(lines);
  if (total > MAX_SCRIPT_CHARS) problems.push(`Сценарий длиннее ${MAX_SCRIPT_CHARS} знаков (${total})`);
  return problems.length ? { script: null, problems } : { script: { title, lines }, problems };
}

export const scriptChars = (lines: { text: string }[]) => lines.reduce((sum, l) => sum + l.text.length, 0);

export const sameScript = (a: Script3D | null, b: Script3D | null) => JSON.stringify(a) === JSON.stringify(b);

/** A running job silent for STALE_MS: the container died or lost the site. It may be replaced. */
export function isLost(job: Job3D | null | undefined, now = Date.now()): boolean {
  if (!job || job.state !== "running") return false;
  const seen = Date.parse(job.heartbeatAt ?? job.startedAt ?? job.createdAt);
  return !Number.isFinite(seen) || now - seen > STALE_MS;
}

/** Queued or running and not lost: while it lives, the project is not edited and no new job starts. */
export function isLive(job: Job3D | null | undefined, now = Date.now()): boolean {
  if (!job) return false;
  return job.state === "queued" || (job.state === "running" && !isLost(job, now));
}

// ---- what the pages get: the stored project plus the server's verdict on the job

export type JobView = Job3D & { lost: boolean };
export type ProjectView = Omit<Project3D, "job"> & { job: JobView | null };
/**
 * Where the video went, for the list: posted, scheduled, being sent now, or a TikTok send that stopped until the
 * owner logs in again (the worker does not go on by itself).
 */
export type PublishedMark = { platform: "tiktok" | "youtube" | "instagram"; state: "published" | "scheduled" | "sending" | "login"; trial?: boolean };
export type ProjectSummary = {
  id: string;
  title: string;
  topic: string;
  createdAt: string;
  updatedAt: string;
  lines: number;
  scriptVersion: number;
  job: JobView | null;
  video: Video3D | null;
  /** Owner lines recorded by the owner himself, of all his lines in the script. */
  dub: { total: number; recorded: number };
  /** Of those, recorded over the current video («озвучено X из N» on the dubbing page). */
  dubbed: number;
  ownVoice: boolean;
  /** The 3D cover when there is one: the list shows it instead of a frame of the video. */
  cover: { at: string } | null;
  published: PublishedMark[];
};

/** The server decides "lost" by its own clock: the phone's clock may be off. */
export function toView(p: Project3D, now = Date.now()): ProjectView {
  return { ...p, job: p.job ? { ...p.job, lost: isLost(p.job, now) } : null };
}

/** A «Создать видео» project has neither a title nor a topic until the runner finds its idea. */
export const projectTitle = (p: { topic: string; script: Script3D | null }) => p.script?.title || p.topic || "Новый ролик";

/** marks come from the server: the cover file and the mirror's publications are not in the project itself. */
export function toSummary(p: Project3D, now = Date.now(), marks: Pick<ProjectSummary, "cover" | "published"> = { cover: null, published: [] }): ProjectSummary {
  return {
    id: p.id,
    title: projectTitle(p),
    topic: p.topic,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    lines: p.script?.lines.length ?? 0,
    scriptVersion: p.scriptVersion,
    job: toView(p, now).job,
    video: p.video,
    dub: (({ total, recorded }) => ({ total, recorded }))(dubProgress(p.script, p.dub)),
    dubbed: voiceOverProgress(p).recorded,
    ownVoice: p.ownVoice === true,
    cover: marks.cover,
    published: marks.published,
  };
}

export type StatusTone = "neutral" | "accent" | "success" | "warn" | "error";
export type Status = { text: string; tone: StatusTone; busy: boolean };

/** topic "" is a «Создать видео» project whose runner is still choosing the idea. */
export function statusOf(p: { job: JobView | null; lines: number; video: Video3D | null; topic?: string }): Status {
  const job = p.job;
  if (job?.lost) return { text: "Контейнер не отвечает", tone: "warn", busy: false };
  if (job?.state === "queued") return { text: "В очереди", tone: "neutral", busy: true };
  if (job?.state === "running") {
    if (job.task === "script") return { text: p.topic === "" ? "Ищет идею" : "Пишет сценарий", tone: "accent", busy: true };
    if (job.task === "voice") return { text: "Готовит подсказки", tone: "accent", busy: true };
    if (job.task === "dub") return { text: "Собираем с твоим голосом", tone: "accent", busy: true };
    return { text: `Монтаж: ${job.step || "идёт"}`, tone: "accent", busy: true };
  }
  if (job?.state === "error") return { text: "Ошибка", tone: "error", busy: false };
  // cues for recording do not touch the video: it stays as ready as it was
  if (job?.state === "done" && job.task !== "script" && p.video) return { text: "Готово", tone: "success", busy: false };
  if (p.lines > 0) return { text: "Сценарий готов", tone: "neutral", busy: false };
  return { text: "Без сценария", tone: "neutral", busy: false };
}

export const jobActive = (job: JobView | null) => Boolean(job && (job.state === "queued" || job.state === "running"));

// ---- self-dub: the owner records his own lines

/** What a task is called in Russian, for the job panel. */
export const TASK_LABEL: Record<Job3D["task"], string> = { script: "сценарий", voice: "подсказки", montage: "монтаж", dub: "сборка с твоим голосом" };

/** Script positions as the owner sees them: «1, 3 и 5». */
export function lineNumbers(indexes: number[]): string {
  const n = indexes.map((i) => String(i + 1));
  return n.length > 1 ? `${n.slice(0, -1).join(", ")} и ${n[n.length - 1]}` : n.join("");
}

const LINE_KEY_RE = /^[a-z0-9]{10,14}$/;
export const isLineKey = (v: unknown): v is string => typeof v === "string" && LINE_KEY_RE.test(v);

/** Only the words count: case, punctuation, ё/е and voice tags do not change what is said. */
function lineWords(text: string): string {
  return text
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** FNV-1a over UTF-16 code units; two seeds give 64 bits, enough for a few dozen lines per project. */
function fnv1a(s: string, seed: number): string {
  let h = seed >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36).padStart(7, "0");
}

/**
 * The key of a line's words: a recorded take stays valid while the words stay the same, wherever the
 * line moves. Pure JS: the recording page computes it too. A line of tags only ([laughs]) keys by its tag.
 */
export function lineKey(text: string): string {
  const words = lineWords(text.replace(/\[[^\]]*\]/g, " ")) || lineWords(text) || text.trim();
  return fnv1a(words, 0x811c9dc5) + fnv1a(words, 0x9e3779b9);
}

/**
 * Does the line say anything once its voice tags are gone? Only such a line needs a voiced clip (a cue) and,
 * for the owner, a recorded take. «[laughs]» or «[pause]» alone has nothing to say: the runner voices no clip for
 * it and the montage needs no take (the same rule as hasWords in studio3d/runner/index.ts).
 */
export const hasWords = (text: string) => /[\p{L}\p{N}]/u.test(text.replace(/\[[^\]]*\]/g, " "));

/** spoken: the line has words, so a montage with «Мой голос» needs a take of it; a tag-only line may have one. */
export type OwnLine = { index: number; key: string; text: string; spoken: boolean };

/** The owner's lines in script order; index is the position in the whole script. */
export function ownLines(script: Script3D | null | undefined): OwnLine[] {
  const out: OwnLine[] = [];
  (script?.lines ?? []).forEach((l, index) => {
    if (l.who === "me") out.push({ index, key: lineKey(l.text), text: l.text, spoken: hasWords(l.text) });
  });
  return out;
}

export type DubProgress = {
  /** Owner lines with words: only they must be recorded. */
  total: number;
  recorded: number;
  /** Script indexes of owner lines with words and without a take. */
  missing: number[];
  /** Takes whose words are no longer in the script (the line was rewritten or deleted). */
  stale: string[];
};

export function dubProgress(script: Script3D | null | undefined, dub: Dub3D | null | undefined): DubProgress {
  const takes = dub?.takes ?? {};
  const own = ownLines(script);
  const spoken = own.filter((l) => l.spoken);
  const missing = spoken.filter((l) => !takes[l.key]).map((l) => l.index);
  const keys = new Set(own.map((l) => l.key));
  return { total: spoken.length, recorded: spoken.length - missing.length, missing, stale: Object.keys(takes).filter((k) => !keys.has(k)) };
}

/** The stale takes themselves, oldest first: the recording page lists them so the owner can delete them. */
export function staleTakes(script: Script3D | null | undefined, dub: Dub3D | null | undefined): DubTake[] {
  const takes = dub?.takes ?? {};
  return dubProgress(script, dub)
    .stale.map((k) => takes[k])
    .filter((t): t is DubTake => Boolean(t))
    .sort((a, b) => String(a.at).localeCompare(String(b.at)));
}

/** optional: a line without words (only tags) and without a take; recording it is allowed, not needed. */
export type DubLineStatus = "recorded" | "missing" | "stale" | "optional";
export type DubLine = OwnLine & { take: DubTake | null; status: DubLineStatus };

/** Share of the words two texts have in common (Jaccard). */
function overlap(a: string, b: string): number {
  const x = new Set(lineWords(a.replace(/\[[^\]]*\]/g, " ")).split(" ").filter(Boolean));
  const y = new Set(lineWords(b.replace(/\[[^\]]*\]/g, " ")).split(" ").filter(Boolean));
  if (!x.size || !y.size) return 0;
  let common = 0;
  for (const w of x) if (y.has(w)) common++;
  return common / (x.size + y.size - common);
}

/**
 * Owner lines with their takes for the recording page. A line without a take is "stale" when a take of
 * mostly the same words exists: the line was rewritten after recording and needs a new take.
 */
export function dubLines(script: Script3D | null | undefined, dub: Dub3D | null | undefined): DubLine[] {
  const takes = dub?.takes ?? {};
  const old = staleTakes(script, dub);
  return ownLines(script).map((l) => {
    const take = takes[l.key] ?? null;
    if (take) return { ...l, take, status: "recorded" as const };
    if (!l.spoken) return { ...l, take: null, status: "optional" as const };
    return { ...l, take: null, status: old.some((t) => overlap(t.text, l.text) >= 0.5) ? ("stale" as const) : ("missing" as const) };
  });
}

/**
 * Who voices the clip of each key: the first line with those words that has words to say. The runner uploads
 * one clip per key (the first such line's), and the site labels it with that line's speaker.
 */
export function clipSpeakers(script: Script3D | null | undefined): Map<string, CastId> {
  const out = new Map<string, CastId>();
  for (const l of script?.lines ?? []) {
    if (!hasWords(l.text)) continue;
    const key = lineKey(l.text);
    if (!out.has(key)) out.set(key, l.who);
  }
  return out;
}

/** A synthesized clip of this line, only if it was voiced for the same speaker (equal words of the other one do not count). */
export function clipFor(clips: Record<string, LineClip> | null | undefined, line: { who: CastId; text: string }): LineClip | null {
  const clip = clips?.[lineKey(line.text)];
  return clip && clip.who === line.who ? clip : null;
}

/**
 * Script lines that need a cue and have none that clipFor would find: the page offers a "voice" job for them,
 * and a "voice" job is complete only when this is empty. A line without words needs no clip. When the other
 * speaker says the very same words first, the one clip of that key is theirs: this line goes without a cue
 * instead of failing every "voice" job.
 */
export function missingClips(script: Script3D | null | undefined, clips: Record<string, LineClip> | null | undefined): number[] {
  const speakers = clipSpeakers(script);
  const out: number[] = [];
  (script?.lines ?? []).forEach((l, i) => {
    if (!hasWords(l.text) || speakers.get(lineKey(l.text)) !== l.who) return;
    if (!clipFor(clips, l)) out.push(i);
  });
  return out;
}

/** How many lines a "voice" job must voice: those missingClips checks. */
export function clipLinesNeeded(script: Script3D | null | undefined): number {
  const speakers = clipSpeakers(script);
  return (script?.lines ?? []).filter((l) => hasWords(l.text) && speakers.get(lineKey(l.text)) === l.who).length;
}

// ---- dubbing over the video: the owner records his lines in sync with the finished video

/**
 * How far the page's numbers for a window may be from the video's own, seconds; also how far a dub's windows may
 * move from the previous video's and still keep the takes recorded over it (sameWindow).
 */
export const WINDOW_TOLERANCE = 0.05;

/** Windows are stored to the millisecond: closer than half of one, two times are the same. */
const SAME_TIME = 0.0005;

/** The version of a video's line windows: missing (or not a whole number ≥ 1) means 1, from the letter timings. */
export function linesVersionOf(v: { linesVersion?: unknown } | null | undefined): number {
  const n = v?.linesVersion;
  return typeof n === "number" && Number.isInteger(n) && n >= 1 ? n : 1;
}

/** Two windows of one line within WINDOW_TOLERANCE at both ends: a dub's re-measured window of the same line. */
export const sameWindow = (a: { start: number; end: number }, b: { start: number; end: number }) =>
  Math.abs(a.start - b.start) <= WINDOW_TOLERANCE && Math.abs(a.end - b.end) <= WINDOW_TOLERANCE;

/** What the dubbing rules look at; a Project3D or a ProjectView fits. */
export type DubSource = {
  script: Script3D | null | undefined;
  scriptVersion: number;
  dub?: Dub3D | null;
  video: Video3D | null | undefined;
  /** The old «Мой голос» switch: a montage then voices his lines from his takes again. */
  ownVoice?: boolean;
  /** The project's latest job: a "voice" job measures windows from the letters anew (needsRefine). */
  job?: Job3D | null;
};

/**
 * The video's line windows by script index. They describe the script the video was made from, so after a script
 * edit they no longer say where the current lines are: then there are none until the video is made again.
 */
export function videoWindows(p: DubSource): Map<number, VideoLine> {
  const out = new Map<number, VideoLine>();
  if (!p.video || p.video.scriptVersion !== p.scriptVersion) return out;
  const lines = p.script?.lines ?? [];
  for (const w of p.video.lines ?? []) if (lines[w.index]?.who === w.who) out.set(w.index, w);
  return out;
}

/**
 * The video's windows for the current script come from the letter timings: a performed [gasps] before the words and
 * the tail of the last word lie outside them, so a take timed to them comes out crooked, and once a "voice" job
 * measures them from the sound (the video stays the same) every take timed to them goes stale.
 */
export const letterWindows = (p: DubSource) => videoWindows(p).size > 0 && linesVersionOf(p.video) < LINES_VERSION;

/**
 * A "voice" job finished and the windows are still the letters': the runner could not measure them from the sound
 * (no montage of this video in its folder, no voice timings next to it) or the job failed. Dubbing over the letters'
 * windows is allowed then, the other way is a new montage. The job is the project's latest and makes no video, so it
 * always came after the video.
 */
export const refineTried = (p: DubSource) => Boolean(p.job && p.job.task === "voice" && (p.job.state === "done" || p.job.state === "error"));

/** A live "voice" job is measuring the letters' windows anew: a take recorded now would be for the old ones. */
export const remeasuring = (p: DubSource, now = Date.now()) => letterWindows(p) && p.job?.task === "voice" && isLive(p.job, now);

/**
 * Takes over this video wait for its windows to be measured from the sound (or for a try at it): before that they
 * are neither recorded nor assembled. The page, the store and the sketch page («Собрать с моим голосом») agree on it.
 */
export const needsRefine = (p: DubSource) => letterWindows(p) && !refineTried(p);

const same = (a: unknown, b: number) => typeof a === "number" && Number.isFinite(a) && Math.abs(a - b) < SAME_TIME;

/**
 * Was the take dubbed over this very video for this very window? Only such a take goes into a "dub" job. A take keeps
 * a copy of the window it was recorded for, so it matches to the millisecond: once the video's windows are measured
 * anew (performed sighs and word tails included), a take recorded for an old window is stale even when the window
 * moved only a little — the owner timed his line to the old one. Nothing is deleted: the page shows it as «устарело».
 */
export function takeFits(take: DubTake | null | undefined, video: Video3D | null | undefined, w: VideoLine | null | undefined): boolean {
  if (!take || !video || !w || take.videoAt !== video.at) return false;
  return typeof take.videoStart === "number" && Number.isFinite(take.videoStart) && same(take.lineStart, w.start) && same(take.lineEnd, w.end);
}

/**
 * A take over this video whose window the video no longer has: the windows were measured anew after it was
 * recorded. The page says so instead of the general «прежний ролик или прежние слова».
 */
export const retimed = (l: Pick<VoiceOverLine, "take" | "status">, video: Video3D | null | undefined) =>
  l.status === "stale" && Boolean(video && l.take?.videoAt === video.at);

/**
 * Where a fitting take sits for the line of window w. The same words said twice share one take (takes are keyed by
 * words), so for the other place the take moves by the distance between the two windows.
 */
export function placeTake(take: DubTake, w: VideoLine): { videoStart: number; lineStart: number; lineEnd: number } {
  const shift = w.start - (take.lineStart ?? w.start);
  return { videoStart: Math.round(((take.videoStart ?? 0) + shift) * 1000) / 1000, lineStart: w.start, lineEnd: w.end };
}

/**
 * The window the dubbing page plays and records a line in: DUB_PRE_ROLL before it (the video rolls, muted, so the
 * owner catches the moment), DUB_POST_ROLL after it (his last word may ring a little longer). A line near the very
 * start has less video before it, so `from` goes below 0: a take then holds the first frame for `lead` seconds and
 * plays the video from `play`, and the owner still gets the same run-up.
 */
export function dubSpan(w: { start: number; end: number }, duration: number) {
  const from = w.start - DUB_PRE_ROLL;
  const play = Math.max(0, from);
  const to = Math.max(play + 0.2, Math.min(duration, w.end + DUB_POST_ROLL));
  return { from, play, lead: play - from, to };
}

export function median(xs: number[]): number {
  const a = [...xs].sort((x, y) => x - y);
  return a.length ? (a.length % 2 ? a[(a.length - 1) / 2] : (a[a.length / 2 - 1] + a[a.length / 2]) / 2) : NaN;
}

/** A take's offset is the median of this many of its first frames; its last frames are checked against them. */
export const SYNC_FRAMES = 15;

/**
 * How far a take's sync moved from its first frames to its last, seconds. Each frame estimates the video time at the
 * take's first sample; a buffering pause under the running recorder lowers every later estimate by its length.
 * A busy or throttled browser shows only a few frames a second, so up to SYNC_FRAMES at each end are compared, and
 * at least two: one frame alone may be late. 0 when there are too few frames to tell.
 */
export function takeSlip(estimates: number[]): number {
  const k = Math.min(SYNC_FRAMES, Math.floor(estimates.length / 2));
  return k >= 2 ? Math.abs(median(estimates.slice(-k)) - median(estimates.slice(0, k))) : 0;
}

/** recorded: over this video; stale: a take exists, but over an older video or of older words; optional: no words to say. */
export type VoiceOverStatus = "recorded" | "missing" | "stale" | "optional";

export type VoiceOverLine = {
  index: number;
  who: CastId;
  key: string;
  text: string;
  spoken: boolean;
  window: VideoLine | null;
  /** Owner lines only: the take of these words, whatever video it was recorded over. */
  take: DubTake | null;
  /** Owner lines only; Claude's lines are there to listen to. */
  status: VoiceOverStatus | null;
};

/** Every script line with its place in the video and, for the owner's lines, the state of his take. */
export function voiceOverLines(p: DubSource): VoiceOverLine[] {
  const takes = p.dub?.takes ?? {};
  const windows = videoWindows(p);
  const lines = p.script?.lines ?? [];
  // the windows of each owner key: a take recorded at any of them counts for all lines with those words
  const keyWindows = new Map<string, VideoLine[]>();
  const keys = lines.map((l) => lineKey(l.text));
  lines.forEach((l, i) => {
    const w = windows.get(i);
    if (l.who === "me" && w) keyWindows.set(keys[i], [...(keyWindows.get(keys[i]) ?? []), w]);
  });
  const old = staleTakes(p.script, p.dub);
  return lines.map((l, index) => {
    const key = keys[index];
    const base = { index, who: l.who, key, text: l.text, spoken: hasWords(l.text), window: windows.get(index) ?? null };
    if (l.who !== "me") return { ...base, take: null, status: null };
    const take = takes[key] ?? null;
    const fits = Boolean(take && base.window && (keyWindows.get(key) ?? []).some((w) => takeFits(take, p.video, w)));
    let status: VoiceOverStatus;
    if (fits) status = "recorded";
    else if (take || (base.spoken && old.some((t) => overlap(t.text, l.text) >= 0.5))) status = "stale";
    else status = base.spoken ? "missing" : "optional";
    return { ...base, take, status };
  });
}

export type VoiceOverProgress = {
  /** Owner lines with words: each needs a take over this video. */
  total: number;
  recorded: number;
  /** Script indexes of owner lines with words not yet recorded over this video. */
  missing: number[];
  /** Why «Собрать с моим голосом» cannot run now, in Russian; null when it can. */
  problem: string | null;
};

/**
 * Owner lines whose take was dubbed over a video. Such a take holds the run-up before the line (older ones also
 * Claude's cue from the speakers) and the tail after it, so only a "dub" job can use it: it cuts the line's window
 * out at its place.
 */
export function overVideoLines(script: Script3D | null | undefined, dub: Dub3D | null | undefined): number[] {
  const takes = dub?.takes ?? {};
  return ownLines(script)
    .filter((l) => typeof takes[l.key]?.videoAt === "string")
    .map((l) => l.index);
}

/**
 * Why a new montage needs the owner's yes, in Russian; null when it loses nothing. A montage makes a new scene and
 * new timing: a video dubbed with his voice is replaced by synthesis, and takes recorded over the current video no
 * longer fit it.
 */
export function montageWarning(p: DubSource): string | null {
  const v = p.video;
  if (!v) return null;
  // only takes that still fit this video are lost: a stale one (older windows) has to be re-recorded anyway
  const takes = new Set(voiceOverLines(p).flatMap((l) => (l.status === "recorded" && l.take?.videoAt === v.at ? [l.key] : []))).size;
  // the old switch voices his lines from his takes again: his voice stays, only takes over this video go stale
  if (v.ownVoice && !p.ownVoice) return "Ролик с твоим голосом заменится новым, а все твои реплики придётся озвучить заново.";
  if (takes) return `Новый монтаж сдвинет реплики: записанное поверх этого ролика (${takes}) придётся озвучить заново.`;
  return null;
}

/** «озвучено X из N» and whether the dub job may start — the page and the store use the same verdict. */
export function voiceOverProgress(p: DubSource): VoiceOverProgress {
  const lines = voiceOverLines(p);
  const spoken = lines.filter((l) => l.who === "me" && l.spoken);
  const missing = spoken.filter((l) => l.status !== "recorded").map((l) => l.index);
  const total = spoken.length;
  const recorded = total - missing.length;
  const unplaced = spoken.filter((l) => !l.window).map((l) => l.index);
  let problem: string | null = null;
  if (!p.video) problem = "сначала нужен ролик";
  else if (p.video.scriptVersion !== p.scriptVersion) problem = "сценарий изменён после монтажа — сначала пересоберите ролик";
  else if (!p.video.lines?.length) problem = "в ролике нет разметки реплик";
  else if (!total) problem = "в сценарии нет твоих реплик";
  else if (unplaced.length) problem = `в ролике нет ${unplaced.length > 1 ? "реплик" : "реплики"} ${lineNumbers(unplaced)} — пересоберите ролик`;
  // a dub on the letters' windows would cut a performed sigh, and measure them from the sound itself: his takes go stale
  else if (needsRefine(p)) problem = "реплики размечены по буквам — сначала уточните разметку на странице озвучки";
  else if (missing.length) problem = `${missing.length > 1 ? "не озвучены реплики" : "не озвучена реплика"} ${lineNumbers(missing)}`;
  // a finished dub moves the takes onto its own video, so without this check the same takes could be sent again
  else if (p.video.ownVoice && p.video.dubVersion !== undefined && p.video.dubVersion === p.dub?.version)
    problem = "ролик уже собран с этими записями — перезапиши реплику, чтобы собрать заново";
  return { total, recorded, missing, problem };
}
