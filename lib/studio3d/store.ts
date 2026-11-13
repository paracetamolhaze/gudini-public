import fs from "fs";
import path from "path";
import crypto from "crypto";
import { DUB_PRE_ROLL, MAX_CLIP_BYTES, MAX_DUB_BYTES, MAX_DUB_SECONDS, MIN_DUB_SECONDS } from "./types";
import type { DubPlanLine, DubTake, Job3D, JobTask, LineClip, Project3D, Script3D, Video3D, VideoLine, VoicePlan } from "./types";
import {
  checkScript,
  cleanText,
  clipLinesNeeded,
  clipSpeakers,
  dubProgress,
  isCastId,
  isLineKey,
  isLive,
  isLost,
  lineKey,
  lineNumbers,
  linesVersionOf,
  missingClips,
  needsRefine,
  NOTES_MAX,
  overVideoLines,
  ownLines,
  placeTake,
  remeasuring,
  sameScript,
  sameWindow,
  takeFits,
  TOPIC_MAX,
  TOPIC_MIN,
  videoWindows,
  voiceOverLines,
  voiceOverProgress,
  WINDOW_TOLERANCE,
} from "./rules";
import { AudioToolError, sniffAudio, toFlac } from "./audio";

/**
 * Storage of the «3Д» section: <root>/<id>/project.json plus out.mp4 from the container.
 * Separate from db.json and the other sections. Only the site process writes here (the container
 * talks HTTP), so mutations are serialized by an in-process lock per project; reads need no lock
 * because every write lands atomically (temp file + rename).
 */

export { isLost, isLive };

export class Studio3DError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409 | 413 | 415,
  ) {
    super(message);
    this.name = "Studio3DError";
  }
}

const notFound = () => new Studio3DError("Проект не найден", 404);
const busy = () => new Studio3DError("Идёт задача — дождитесь её окончания", 409);
/** A runner call for a job the project no longer has: replaced, finished or the project was deleted. */
const staleJob = () => new Studio3DError("Задача больше не актуальна", 409);
const LOST_MESSAGE = "Контейнер 3Д не отвечал больше 10 минут — задача снята. Запустите её заново.";

export const VIDEO_FILE = "out.mp4";
export const MAX_VIDEO_BYTES = 2 * 1024 ** 3;

export function studio3dRoot(): string {
  return path.resolve(process.env.STUDIO3D_DATA_DIR ?? path.join(process.cwd(), "data", "studio3d"));
}

const ID_RE = /^[a-z0-9-]{6,40}$/;
export const isProjectId = (v: unknown): v is string => typeof v === "string" && ID_RE.test(v);
export const isJobId = isProjectId;

export const newId = () => Date.now().toString(36) + crypto.randomBytes(5).toString("hex");

/** Every id from a URL goes through here before it touches the disk. */
export function projectDir(id: string): string {
  if (!isProjectId(id)) throw new Studio3DError("Недопустимый id проекта", 400);
  const root = studio3dRoot();
  const dir = path.resolve(root, id);
  if (path.dirname(dir) !== root) throw new Studio3DError("Недопустимый id проекта", 400);
  return dir;
}

export const videoPath = (id: string) => path.join(projectDir(id), VIDEO_FILE);
const jsonPath = (id: string) => path.join(projectDir(id), "project.json");
const now = () => new Date().toISOString();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---- lock: Next bundles each route separately, so the chains live on globalThis to be shared

type Chains = Map<string, Promise<void>>;
const LOCKS = Symbol.for("gudini.studio3d.locks");

function chains(): Chains {
  const g = globalThis as unknown as Record<symbol, Chains | undefined>;
  return (g[LOCKS] ??= new Map());
}

export function withProjectLock<T>(id: string, fn: () => T | Promise<T>): Promise<T> {
  const key = projectDir(id);
  const map = chains();
  const run = (map.get(key) ?? Promise.resolve()).then(fn);
  const tail = run.then(
    () => {},
    () => {},
  );
  map.set(key, tail);
  void tail.then(() => {
    if (map.get(key) === tail) map.delete(key);
  });
  return run;
}

// ---- files

/** Windows briefly refuses to replace a file that a reader still holds — a few retries. */
async function renameWithRetry(from: string, to: string) {
  for (let i = 0; ; i++) {
    try {
      await fs.promises.rename(from, to);
      return;
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code ?? "";
      if (i >= 20 || !["EPERM", "EBUSY", "EACCES"].includes(code)) throw e;
      await sleep(25);
    }
  }
}

async function writeProject(p: Project3D) {
  const file = jsonPath(p.id);
  const tmp = `${file}.${crypto.randomBytes(4).toString("hex")}.tmp`;
  await fs.promises.writeFile(tmp, JSON.stringify(p, null, 2));
  try {
    await renameWithRetry(tmp, file);
  } catch (e) {
    await fs.promises.rm(tmp, { force: true });
    throw e;
  }
}

function readProject(id: string): Project3D | null {
  let raw: string;
  try {
    raw = fs.readFileSync(jsonPath(id), "utf8");
  } catch {
    return null;
  }
  try {
    const p = JSON.parse(raw) as Project3D;
    if (!p || p.id !== id || typeof p.topic !== "string") return null;
    p.createdAt = typeof p.createdAt === "string" ? p.createdAt : "";
    p.updatedAt = typeof p.updatedAt === "string" ? p.updatedAt : p.createdAt;
    p.script = p.script ?? null;
    p.job = p.job ?? null;
    p.video = p.video ?? null;
    p.scriptVersion = Number.isInteger(p.scriptVersion) ? p.scriptVersion : 0;
    // projects made before self-dub and publishing: every reader sees the same full shape
    p.ownVoice = p.ownVoice === true;
    const dub = p.dub && typeof p.dub === "object" ? p.dub : null;
    p.dub = {
      version: Number.isInteger(dub?.version) && dub!.version >= 0 ? dub!.version : 0,
      takes: dub?.takes && typeof dub.takes === "object" && !Array.isArray(dub.takes) ? dub.takes : {},
    };
    p.clips = p.clips && typeof p.clips === "object" && !Array.isArray(p.clips) ? p.clips : {};
    p.meta = p.meta ?? null;
    p.cover = p.cover ?? null;
    p.mirrorId = p.mirrorId ?? null;
    return p;
  } catch {
    console.warn(`3Д ${id}: project.json не читается`);
    return null;
  }
}

/** Read → change → atomic write, under the project's lock. A throw inside fn writes nothing. */
export async function mutate<T>(id: string, fn: (p: Project3D) => T | Promise<T>): Promise<{ project: Project3D; result: T }> {
  return withProjectLock(id, async () => {
    const p = readProject(id);
    if (!p) throw notFound();
    const result = await fn(p);
    await writeProject(p);
    return { project: p, result };
  });
}

// ---- reads

export function getProject(id: string): Project3D | null {
  return isProjectId(id) ? readProject(id) : null;
}

export function listProjects(): Project3D[] {
  let names: string[];
  try {
    names = fs.readdirSync(studio3dRoot());
  } catch {
    return [];
  }
  return names
    .filter(isProjectId)
    .map(readProject)
    .filter((p): p is Project3D => Boolean(p))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

// ---- owner actions

function checkTopic(raw: unknown): string {
  const topic = typeof raw === "string" ? raw.trim() : "";
  if (topic.length < TOPIC_MIN || topic.length > TOPIC_MAX) {
    throw new Studio3DError(`Идея ролика — от ${TOPIC_MIN} до ${TOPIC_MAX} знаков`, 400);
  }
  return topic;
}

function checkNotes(raw: unknown): string | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== "string") throw new Studio3DError("Пожелания должны быть текстом", 400);
  const notes = raw.trim();
  if (notes.length > NOTES_MAX) throw new Studio3DError(`Пожелания — не длиннее ${NOTES_MAX} знаков`, 400);
  return notes || undefined;
}

function strictScript(raw: unknown, minLines: number): Script3D {
  const { script, problems } = checkScript(raw, minLines);
  if (!script) throw new Studio3DError(problems.join(". "), 400);
  return script;
}

function newJob(task: JobTask): Job3D {
  return { id: newId(), task, state: "queued", step: "В очереди", progress: 0, createdAt: now() };
}

/** A new project starts with Claude writing its script. */
export async function createProject(topicRaw: unknown, notesRaw?: unknown): Promise<Project3D> {
  const topic = checkTopic(topicRaw);
  const notes = checkNotes(notesRaw);
  const at = now();
  const p: Project3D = {
    id: newId(),
    createdAt: at,
    updatedAt: at,
    topic,
    ...(notes ? { notes } : {}),
    script: null,
    scriptVersion: 0,
    job: newJob("script"),
    video: null,
    ownVoice: false,
    dub: { version: 0, takes: {} },
    clips: {},
    meta: null,
    cover: null,
    mirrorId: null,
  };
  return withProjectLock(p.id, async () => {
    await fs.promises.mkdir(projectDir(p.id), { recursive: true });
    await writeProject(p);
    return p;
  });
}

/** «Создать видео»: no idea yet — the runner finds one, writes the script and the montage follows on its own. */
export async function createAutoProject(): Promise<Project3D> {
  const at = now();
  const p: Project3D = {
    id: newId(),
    createdAt: at,
    updatedAt: at,
    topic: "",
    auto: true,
    script: null,
    scriptVersion: 0,
    job: { ...newJob("script"), step: "Ищу идею" },
    video: null,
    ownVoice: false,
    dub: { version: 0, takes: {} },
    clips: {},
    meta: null,
    cover: null,
    mirrorId: null,
  };
  return withProjectLock(p.id, async () => {
    await fs.promises.mkdir(projectDir(p.id), { recursive: true });
    await writeProject(p);
    return p;
  });
}

export type ProjectPatch = { topic?: unknown; notes?: unknown; script?: unknown; ownVoice?: unknown };

export async function patchProject(id: string, patch: ProjectPatch): Promise<Project3D> {
  const has = (k: keyof ProjectPatch) => patch[k] !== undefined;
  if (!has("topic") && !has("notes") && !has("script") && !has("ownVoice")) throw new Studio3DError("Нечего сохранять", 400);
  // checked before the lock: a bad request should say what is wrong even while a job runs
  const topic = has("topic") ? checkTopic(patch.topic) : undefined;
  const notes = has("notes") ? checkNotes(patch.notes) : undefined;
  const script = has("script") ? strictScript(patch.script, 1) : undefined;
  if (has("ownVoice") && typeof patch.ownVoice !== "boolean") throw new Studio3DError("«Мой голос» — да или нет", 400);
  const { project } = await mutate(id, (p) => {
    if (isLive(p.job)) throw busy();
    // the owner's edit takes over a lost job: if its container comes back, its late script must not overwrite the edit
    if (p.job && isLost(p.job)) p.job = { ...p.job, state: "error", error: LOST_MESSAGE, finishedAt: now() };
    if (topic !== undefined) p.topic = topic;
    if (has("notes")) {
      if (notes) p.notes = notes;
      else delete p.notes;
    }
    if (script && !sameScript(p.script, script)) {
      p.script = script;
      p.scriptVersion += 1;
    }
    if (typeof patch.ownVoice === "boolean") p.ownVoice = patch.ownVoice;
    p.updatedAt = now();
  });
  return project;
}

export async function removeProject(id: string): Promise<void> {
  await withProjectLock(id, async () => {
    const p = readProject(id);
    if (!p) throw notFound();
    if (p.job?.state === "running" && !isLost(p.job)) throw busy();
    await fs.promises.rm(projectDir(id), { recursive: true, force: true, maxRetries: 5 });
  });
}

const TASKS: readonly JobTask[] = ["script", "voice", "montage", "dub"];

export async function enqueue(id: string, task: unknown): Promise<Project3D> {
  if (!TASKS.includes(task as JobTask)) throw new Studio3DError("Неизвестная задача", 400);
  let dropped: string[] = [];
  const { project } = await mutate(id, (p) => {
    if (isLive(p.job)) throw busy();
    if (task === "dub") {
      // the same verdict the page shows next to «Собрать с моим голосом»
      const { problem } = voiceOverProgress(p);
      if (problem) throw new Studio3DError(`Собрать с твоим голосом нельзя: ${problem}`, 400);
    }
    if (task === "montage" && (p.script?.lines.length ?? 0) < 2) {
      throw new Studio3DError("Для монтажа нужен сценарий хотя бы из двух реплик", 400);
    }
    if (task === "voice" && (p.script?.lines.length ?? 0) < 2) {
      throw new Studio3DError("Для подсказок нужен сценарий хотя бы из двух реплик", 400);
    }
    if (task === "montage" && p.ownVoice) {
      const { missing } = dubProgress(p.script, p.dub);
      if (missing.length) {
        const [what, them] = missing.length > 1 ? ["не записаны реплики", "их"] : ["не записана реплика", "её"];
        throw new Studio3DError(`Монтаж своим голосом: ${what} ${lineNumbers(missing)}. Запишите ${them} или выключите «Мой голос».`, 400);
      }
      const over = overVideoLines(p.script, p.dub);
      if (over.length) throw new Studio3DError(overVideoMessage(over), 400);
    }
    // a lost job is simply replaced: its late runner calls no longer match the job id
    p.job = newJob(task as JobTask);
    // the montage is made from this script: takes of words it no longer has are of no use any more
    if (task === "montage") dropped = dropStaleTakes(p);
    p.updatedAt = now();
  });
  await removeFiles(id, dropped);
  return project;
}

/** Takes back a job the container has not picked up yet (it may be switched off). */
export async function cancelQueued(id: string): Promise<Project3D> {
  const { project } = await mutate(id, (p) => {
    if (p.job?.state !== "queued") throw new Studio3DError("Отменить можно только задачу в очереди", 409);
    p.job = null;
    p.updatedAt = now();
  });
  return project;
}

// ---- runner (the gudini-3d container)

/** Takes dubbed over a video carry Claude's cue from the speakers: the old whole-take montage would keep it as speech. */
const overVideoMessage = (over: number[]) =>
  `Монтаж с моими записями: ${over.length > 1 ? "реплики" : "реплика"} ${lineNumbers(over)} ${over.length > 1 ? "записаны" : "записана"} поверх ролика — ` +
  "такие записи идут только в «Собрать с моим голосом». Выключите «Монтаж с моими записями» и соберите ролик кнопкой «Собрать с моим голосом».";

/**
 * What the runner needs about voices, resolved here so it never computes keys. A string (the job's error) when an
 * own-voice montage or a dub cannot be made from the takes: the owner cannot get there (enqueue and the dub routes
 * check it), a hand-edited project.json or a take re-recorded between enqueue and claim could.
 */
function voicePlan(p: Project3D, task: JobTask): VoicePlan | string {
  const ownVoice = (task === "montage" && p.ownVoice === true) || task === "dub";
  const takes = p.dub?.takes ?? {};
  const lines: DubPlanLine[] = [];
  if (task === "dub") {
    // dubbed over the video: each take goes exactly where it was recorded, at its line's window
    for (const l of voiceOverLines(p)) {
      if (l.who !== "me") continue;
      if (l.status !== "recorded" || !l.take || !l.window) {
        if (l.spoken) return "Не все твои реплики озвучены поверх этого ролика — озвучьте их заново";
        continue;
      }
      const t = l.take;
      lines.push({ index: l.index, key: l.key, take: t.take, bytes: t.bytes, sha256: t.sha256, text: l.text, ...placeTake(t, l.window) });
    }
  } else if (ownVoice) {
    const over = overVideoLines(p.script, p.dub);
    if (over.length) return overVideoMessage(over);
    for (const l of ownLines(p.script)) {
      const t = takes[l.key];
      // a line of tags only ([pause]) needs no take; if the owner recorded one anyway, it is used
      if (!t) {
        if (l.spoken) return "Не все твои реплики записаны — запишите их или выключите «Мой голос»";
        continue;
      }
      lines.push({ index: l.index, key: l.key, take: t.take, bytes: t.bytes, sha256: t.sha256, text: l.text });
    }
  }
  return { keys: (p.script?.lines ?? []).map((l) => lineKey(l.text)), ownVoice, dubVersion: p.dub?.version ?? 0, lines };
}

export type Claimed = { project: Project3D; job: Job3D; voice?: VoicePlan };

/** The oldest queued job across projects, now running. Null when there is nothing to do. */
export async function claimNext(): Promise<Claimed | null> {
  const queued = listProjects()
    .filter((p) => p.job?.state === "queued")
    .sort((a, b) => a.job!.createdAt.localeCompare(b.job!.createdAt));
  for (const candidate of queued) {
    const jobId = candidate.job!.id;
    const claimed = await withProjectLock(candidate.id, async () => {
      // re-read under the lock: the owner may have cancelled or deleted it meanwhile
      const p = readProject(candidate.id);
      if (!p?.job || p.job.id !== jobId || p.job.state !== "queued") return null;
      const at = now();
      const voice = p.job.task === "script" ? undefined : voicePlan(p, p.job.task);
      if (typeof voice === "string") {
        p.job = { ...p.job, state: "error", error: voice, finishedAt: at };
        await writeProject(p);
        return null;
      }
      p.job = { ...p.job, state: "running", step: "Взял в работу", startedAt: at, heartbeatAt: at };
      await writeProject(p);
      return voice ? { project: p, job: p.job, voice } : { project: p, job: p.job };
    });
    if (claimed) return claimed;
  }
  return null;
}

/** The project's current job, only if it is this running one; otherwise the runner must stop. */
function runningJob(p: Project3D, jobId: unknown, task?: JobTask | readonly JobTask[]): Job3D {
  const job = p.job;
  const tasks = typeof task === "string" ? [task] : task;
  if (!job || job.id !== jobId || job.state !== "running" || (tasks && !tasks.includes(job.task))) throw staleJob();
  return job;
}

/** Jobs that make a video: they upload out.mp4 and read the owner's takes. */
const VIDEO_TASKS: readonly JobTask[] = ["montage", "dub"];

/** A runner call for a deleted project means the same as for a replaced job. */
async function mutateForRunner<T>(id: string, fn: (p: Project3D) => T) {
  try {
    return await mutate(id, fn);
  } catch (e) {
    if (e instanceof Studio3DError && e.status === 404) throw staleJob();
    throw e;
  }
}

/** Progress is also the heartbeat. */
export async function reportProgress(id: string, jobId: unknown, step: unknown, progress: unknown): Promise<Job3D> {
  const { result } = await mutateForRunner(id, (p) => {
    const job = runningJob(p, jobId);
    const label = typeof step === "string" ? cleanText(step).slice(0, 160) : "";
    if (label) job.step = label;
    const n = Number(progress);
    if (Number.isFinite(n)) job.progress = Math.round(Math.max(0, Math.min(99, n)));
    job.heartbeatAt = now();
    return job;
  });
  return result;
}

/** The written dialogue of a "script" job. Rejected whole if invalid: nothing is cut to fit. */
export async function setScriptFromRunner(id: string, jobId: unknown, raw: unknown): Promise<Project3D> {
  const script = strictScript(raw, 2);
  const { project } = await mutateForRunner(id, (p) => {
    const job = runningJob(p, jobId, "script");
    // a retried request (its answer got lost) brings the same script again: that is not a new version
    if (!sameScript(p.script, script)) {
      p.script = script;
      p.scriptVersion += 1;
    }
    job.heartbeatAt = now();
    p.updatedAt = now();
  });
  return project;
}

/** The idea the runner found for a «Создать видео» project; a retried request just writes the same again. */
export async function setIdeaFromRunner(id: string, jobId: unknown, topicRaw: unknown, notesRaw?: unknown): Promise<Project3D> {
  const topic = checkTopic(topicRaw);
  const notes = checkNotes(notesRaw);
  const { project } = await mutateForRunner(id, (p) => {
    const job = runningJob(p, jobId, "script");
    if (!p.auto) throw new Studio3DError("Идею ищет только ролик, созданный кнопкой «Создать видео»", 400);
    p.topic = topic;
    if (notes) p.notes = notes;
    else delete p.notes;
    job.heartbeatAt = now();
    p.updatedAt = now();
  });
  return project;
}

/** Was out.mp4 uploaded by this job, and not left from an earlier montage? */
function uploadedBy(job: Job3D, file: string): fs.Stats | null {
  try {
    const st = fs.statSync(file);
    // a little slack: some filesystems stamp files with a coarse clock
    const started = Date.parse(job.startedAt ?? job.createdAt) - 2000;
    return st.isFile() && st.size > 0 && st.mtimeMs >= started ? st : null;
  } catch {
    return null;
  }
}

export type CompleteInput = { error?: unknown; video?: unknown; videoLines?: unknown };

/** How much a video's own length may differ from the one its windows were measured on, seconds. */
const SAME_DURATION = 0.15;

/**
 * Line windows from the runner, checked against the script and the video's length. Null when any of them is
 * wrong: a partly kept list would let the page record over some lines and silently miss others.
 */
export function checkWindows(raw: unknown, script: Script3D | null, duration: number): VideoLine[] | null {
  if (!Array.isArray(raw) || !raw.length) return null;
  const lines = script?.lines ?? [];
  const seen = new Set<number>();
  const out: VideoLine[] = [];
  for (const item of raw) {
    const w = (item && typeof item === "object" ? item : {}) as { index?: unknown; who?: unknown; start?: unknown; end?: unknown };
    const index = w.index;
    if (typeof index !== "number" || !Number.isInteger(index) || index < 0 || index >= lines.length || seen.has(index)) return null;
    // a window says where this line is said, so it must be said by the script's speaker
    if (!isCastId(w.who) || w.who !== lines[index].who) return null;
    const { start, end } = w;
    if (typeof start !== "number" || typeof end !== "number" || !(start >= 0) || !(end > start) || !(end <= duration + 0.5)) return null;
    seen.add(index);
    out.push({ index, who: w.who, start: round3(start), end: round3(end) });
  }
  return out.sort((a, b) => a.index - b.index);
}

/** The windows' version the runner sent: a whole number ≥ 1, or undefined when it sent none or nonsense (then 1). */
function sentLinesVersion(raw: unknown): number | undefined {
  return typeof raw === "number" && Number.isInteger(raw) && raw >= 1 ? raw : undefined;
}

/**
 * A "voice" job that found the current video's montage in its work folder sends its windows: videos made before
 * windows were stored get them without a new render, and windows measured better (a higher version: from the sound,
 * with performed sighs and whole word tails) replace older ones. Only for the current script, only when the montage
 * it found is this video (the same length), and a replacement must place every line the old windows placed: a
 * half-replaced set would mix two ways of measuring. Anything else is ignored, the job still counts. Takes recorded
 * for the replaced windows stay, stale (takeFits matches windows to the millisecond).
 */
function windowsFromVoice(p: Project3D, raw: unknown) {
  const v = p.video;
  if (!v || v.scriptVersion !== p.scriptVersion || !raw || typeof raw !== "object") return;
  const { videoDuration, lines, version: rawVersion } = raw as { videoDuration?: unknown; lines?: unknown; version?: unknown };
  const version = rawVersion === undefined ? 1 : sentLinesVersion(rawVersion);
  if (version === undefined) return void console.warn(`3Д ${p.id}: версия разметки реплик от исполнителя не принята`);
  const had = v.lines?.length ? v.lines : null;
  if (had && version <= linesVersionOf(v)) return;
  if (typeof videoDuration !== "number" || !(Math.abs(videoDuration - v.duration) <= SAME_DURATION)) return;
  const checked = checkWindows(lines, p.script, v.duration);
  if (!checked) return void console.warn(`3Д ${p.id}: разметка реплик от исполнителя не принята`);
  const placed = new Set(checked.map((w) => w.index));
  const lost = (had ?? []).filter((w) => !placed.has(w.index)).map((w) => w.index);
  if (lost.length) return void console.warn(`3Д ${p.id}: новая разметка без ${lineNumbers(lost)} — оставлена прежняя`);
  v.lines = checked;
  if (rawVersion !== undefined) v.linesVersion = version;
  else delete v.linesVersion;
}

/**
 * A dub keeps the scene and the cuts, so the takes recorded over the previous video stay in place on the new one:
 * they move to it, and re-recording one line does not make the others stale. A dub may measure its windows anew;
 * within WINDOW_TOLERANCE of the old one it is the same line, and the take is re-anchored to the new window (its
 * place on the timeline, videoStart, stays), so it fits the new video exactly.
 */
function moveTakes(p: Project3D, from: Video3D, to: Video3D) {
  const before = videoWindows({ ...p, video: from });
  const after = videoWindows({ ...p, video: to });
  for (const l of ownLines(p.script)) {
    const take = p.dub?.takes[l.key];
    const old = before.get(l.index);
    const w = after.get(l.index);
    if (!take || !old || !w || !takeFits(take, from, old) || !sameWindow(old, w)) continue;
    take.videoAt = to.at;
    take.lineStart = w.start;
    take.lineEnd = w.end;
  }
}

export async function completeJob(id: string, jobId: unknown, input: CompleteInput): Promise<Project3D> {
  const file = videoPath(id);
  /** Clips of words no longer in the script (dropped when a "voice" job has voiced the current ones) and stale takes. */
  const dropped: string[] = [];
  const { project } = await mutateForRunner(id, (p) => {
    const job = runningJob(p, jobId);
    const at = now();
    const fail = (message: string) => {
      p.job = { ...job, state: "error", error: message.slice(0, 1000), heartbeatAt: at, finishedAt: at };
    };
    const done = () => {
      p.job = { ...job, state: "done", step: "Готово", progress: 100, heartbeatAt: at, finishedAt: at };
    };
    if (typeof input.error === "string" && input.error.trim()) fail(input.error.trim());
    else if (job.task === "script") {
      if (!p.script) fail("Контейнер не прислал сценарий");
      // «Создать видео»: the montage is queued right behind its script, nobody has to press anything
      else if (p.auto) p.job = newJob("montage");
      else done();
    } else if (job.task === "voice") {
      if (input.videoLines !== undefined) windowsFromVoice(p, input.videoLines);
      const keys = new Set((p.script?.lines ?? []).map((l) => lineKey(l.text)));
      const clips = p.clips ?? {};
      // the same rule as the page's «Подготовить подсказки»: only lines with words, each by its own speaker
      const missing = missingClips(p.script, clips);
      if (missing.length) {
        const need = clipLinesNeeded(p.script);
        fail(`Контейнер озвучил не все реплики (${need - missing.length} из ${need}): нет ${missing.length > 1 ? "реплик" : "реплики"} ${lineNumbers(missing)}`);
      } else {
        for (const k of Object.keys(clips)) {
          if (keys.has(k)) continue;
          dropped.push(clips[k].file);
          delete clips[k];
        }
        p.clips = clips;
        done();
      }
    } else {
      // montage or dub: a new video
      const v = (input.video && typeof input.video === "object" ? input.video : {}) as {
        duration?: unknown;
        scriptVersion?: unknown;
        ownVoice?: unknown;
        dubVersion?: unknown;
        lines?: unknown;
        linesVersion?: unknown;
      };
      const duration = Number(v.duration);
      const scriptVersion = Number(v.scriptVersion);
      const dubVersion = Number(v.dubVersion);
      if (!Number.isFinite(duration) || duration <= 0 || !Number.isInteger(scriptVersion) || scriptVersion < 0) {
        fail("Контейнер не прислал длительность и версию сценария");
      } else if (!uploadedBy(job, file)) {
        fail("Видео не загрузилось на сайт");
      } else {
        const dub = job.task === "dub";
        const previous = p.video;
        let lines = v.lines === undefined ? null : checkWindows(v.lines, p.script, duration);
        // how the windows were measured; without windows there is nothing to describe
        let linesVersion = lines ? sentLinesVersion(v.linesVersion) : undefined;
        if (v.lines !== undefined && !lines) console.warn(`3Д ${id}: разметка реплик от исполнителя не принята — ролик без неё`);
        // the same scene and cuts: without windows of its own the dub keeps the previous video's, measured as they were
        if (!lines && dub && previous?.lines?.length && previous.scriptVersion === scriptVersion && Math.abs(previous.duration - duration) <= SAME_DURATION) {
          lines = previous.lines;
          linesVersion = sentLinesVersion(previous.linesVersion);
        }
        p.video = {
          file: VIDEO_FILE,
          at,
          duration: Math.round(duration * 100) / 100,
          scriptVersion,
          ...(v.ownVoice === true || dub ? { ownVoice: true, ...(Number.isInteger(dubVersion) && dubVersion >= 0 ? { dubVersion } : {}) } : {}),
          ...(lines ? { lines } : {}),
          ...(lines && linesVersion !== undefined ? { linesVersion } : {}),
        };
        if (dub && previous) moveTakes(p, previous, p.video);
        done();
      }
    }
    // a finished "voice" job (whatever came of it): takes of words no longer in the script go now
    if (job.task === "voice") dropped.push(...dropStaleTakes(p));
    p.updatedAt = at;
  });
  await fs.promises.rm(`${file}.part`, { force: true });
  await removeFiles(id, dropped);
  return project;
}

export type ChunkResult = { received: number } | { done: true; size: number } | { resync: number };

/**
 * One piece of the montage upload, the same protocol as the worker result: the piece at x-offset
 * is appended to out.mp4.part, a repeat of the last piece is accepted silently, any other offset
 * gets the size received so far so the runner can resume. The whole file is renamed to out.mp4.
 */
export async function receiveVideoChunk(id: string, jobId: unknown, offset: number, total: number, data: Buffer): Promise<ChunkResult> {
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(total) || total <= 0) {
    throw new Studio3DError("Нужны заголовки x-offset и x-file-size", 400);
  }
  if (total > MAX_VIDEO_BYTES) throw new Studio3DError("Видео больше 2 ГБ", 413);
  if (!data.length || offset + data.length > total) throw new Studio3DError("Кусок не помещается в файл", 400);
  return withProjectLock(id, async () => {
    const p = readProject(id);
    if (!p) throw staleJob();
    const job = runningJob(p, jobId, VIDEO_TASKS);
    const file = videoPath(id);
    const part = `${file}.part`;
    const current = await fs.promises.stat(part).then((s) => s.size, () => -1);

    // the answer to the final piece got lost and the runner repeats it: the file is already in place
    if (current < 0 && offset + data.length === total && uploadedBy(job, file)?.size === total) return { done: true as const, size: total };

    if (offset === 0) await fs.promises.writeFile(part, data);
    else if (current === offset) await fs.promises.appendFile(part, data);
    else if (current !== offset + data.length) return { resync: Math.max(0, current) };

    // a big upload takes a while: its pieces keep the job alive (at most one write per 15 s)
    if (!(Date.now() - Date.parse(job.heartbeatAt ?? "") <= 15_000)) {
      job.heartbeatAt = now();
      await writeProject(p);
    }

    const received = (await fs.promises.stat(part)).size;
    if (received < total) return { received };
    if (received !== total) {
      await fs.promises.rm(part, { force: true });
      throw new Studio3DError(`Размер не сошёлся: ${received} из ${total}`, 400);
    }
    await renameWithRetry(part, file);
    return { done: true as const, size: received };
  });
}

// ---- self-dub: the owner's own takes and the synthesized cues

export const DUB_DIR = "dub";
export const CLIPS_DIR = "clips";

/** A stored relative file ("dub/…", "clips/…") as an absolute path, never outside the project. */
export function projectFile(id: string, rel: string): string {
  const dir = projectDir(id);
  const file = path.resolve(dir, rel);
  if (!file.startsWith(dir + path.sep)) throw new Studio3DError("Недопустимый путь файла", 400);
  return file;
}

async function removeInside(id: string, rel: string) {
  try {
    await fs.promises.rm(projectFile(id, rel), { force: true });
  } catch (e) {
    console.warn(`3Д ${id}: не удалил ${rel}:`, (e as Error).message);
  }
}

const removeFiles = (id: string, rels: string[]) => Promise.all(rels.map((rel) => removeInside(id, rel)));

/**
 * Forgets the takes of words no longer in the script and returns their files, for the caller to remove after
 * the write. dub.version stays: it marks the set of takes a video was made from, and no current line used these.
 */
function dropStaleTakes(p: Project3D): string[] {
  const dub = p.dub;
  if (!dub) return [];
  const files: string[] = [];
  for (const key of dubProgress(p.script, dub).stale) {
    if (dub.takes[key]?.file) files.push(dub.takes[key].file);
    delete dub.takes[key];
  }
  return files;
}

/** Upload temp files live next to the projects (same disk, so the final rename is atomic) but outside any of them. */
async function tempFile(ext: string): Promise<string> {
  const dir = path.join(studio3dRoot(), ".tmp");
  await fs.promises.mkdir(dir, { recursive: true });
  return path.join(dir, `${Date.now().toString(36)}-${crypto.randomBytes(6).toString("hex")}.${ext}`);
}

/** A montage or a dub reads the takes: while one lives they stay as they are. Throws with the reason. */
function checkTakesFree(p: Project3D) {
  if (!isLive(p.job)) return;
  if (p.job?.task === "montage") throw new Studio3DError("Идёт монтаж — записи можно менять после него", 409);
  if (p.job?.task === "dub") throw new Studio3DError("Идёт сборка с твоим голосом — записи можно менять после неё", 409);
}
/**
 * A take over the video waits for windows measured from the sound (rules: needsRefine): one timed to the letters' would
 * cut a performed sigh and go stale the moment the windows are measured. Throws with the reason.
 */
function checkRefined(p: Project3D) {
  if (!needsRefine(p)) return;
  if (remeasuring(p)) throw new Studio3DError("Уточняем разметку реплик — записывать можно после неё", 409);
  throw new Studio3DError("Реплики размечены по буквам — сначала уточните разметку (обновите страницу)", 409);
}
const notOwnLine = () => new Studio3DError("Такой твоей реплики больше нет в сценарии — обновите страницу", 409);
const unreadable = () => new Studio3DError("Запись не читается — запишите ещё раз", 400);

function checkLineKey(key: unknown): string {
  if (!isLineKey(key)) throw new Studio3DError("Недопустимый ключ реплики", 400);
  return key;
}

const sha256 = (data: Buffer) => crypto.createHash("sha256").update(data).digest("hex");
const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** Where a take was dubbed over the video, as the page sends it (query strings or numbers). */
export type DubMetaInput = { videoStart?: unknown; latencyMs?: unknown; lineStart?: unknown; lineEnd?: unknown; videoAt?: unknown };
type DubMeta = { videoStart: number; latencyMs: number; lineStart: number; lineEnd: number; videoAt: string };

/** The page's latency slider goes to ±400 ms; more than this is not a latency any more. */
const MAX_LATENCY_MS = 2000;
/** A take may end this much before its line does: the recorder's start and the encoded length are a few frames off. */
const TAKE_END_SLACK = 0.2;

const num = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN);

/** Null for a take recorded without the video (the old «Мой голос» path); otherwise all of it or a 400. */
function checkDubMeta(raw: DubMetaInput | undefined): DubMeta | null {
  if (!raw || Object.values(raw).every((v) => v === undefined || v === null)) return null;
  const [videoStart, latencyMs, lineStart, lineEnd] = [raw.videoStart, raw.latencyMs, raw.lineStart, raw.lineEnd].map(num);
  if (typeof raw.videoAt !== "string" || !raw.videoAt || raw.videoAt.length > 64) throw new Studio3DError("Нужна отметка ролика, поверх которого записано", 400);
  if (![videoStart, latencyMs, lineStart, lineEnd].every(Number.isFinite)) throw new Studio3DError("Отметки записи поверх ролика должны быть числами", 400);
  if (Math.abs(latencyMs) > MAX_LATENCY_MS) throw new Studio3DError(`Задержка записи — не больше ${MAX_LATENCY_MS} мс в любую сторону`, 400);
  if (lineStart < 0 || !(lineEnd > lineStart)) throw new Studio3DError("Окно реплики задано неверно", 400);
  // a line at 0 s is recorded with a lead-in held on the first frame: its take starts up to DUB_PRE_ROLL before the video
  if (videoStart < -DUB_PRE_ROLL - 1 - MAX_LATENCY_MS / 1000 || videoStart > lineEnd) throw new Studio3DError("Начало записи не попадает в ролик", 400);
  return { videoStart: round3(videoStart), latencyMs: Math.round(latencyMs), lineStart, lineEnd, videoAt: raw.videoAt };
}

/**
 * A take dubbed over the video must be of this very video and of one of the windows of its words; the stored
 * window is the video's own (the page's numbers only had to be within WINDOW_TOLERANCE of it).
 */
function dubWindow(p: Project3D, key: string, meta: DubMeta): VideoLine {
  if (!p.video || p.video.at !== meta.videoAt) throw new Studio3DError("Ролик изменился — обновите страницу", 409);
  if (p.video.scriptVersion !== p.scriptVersion) throw new Studio3DError("Сценарий изменён после монтажа — сначала пересоберите ролик", 409);
  const windows = videoWindows(p);
  const near = (a: number, b: number) => Math.abs(a - b) <= WINDOW_TOLERANCE;
  const w = ownLines(p.script)
    .filter((l) => l.key === key)
    .map((l) => windows.get(l.index))
    .find((x) => x && near(x.start, meta.lineStart) && near(x.end, meta.lineEnd));
  if (!w) throw new Studio3DError("Окно реплики не совпадает с разметкой ролика — обновите страницу", 409);
  return w;
}

/**
 * One take of an owner line from the recording page: any browser format in, FLAC out. The slow part
 * (ffmpeg) runs outside the lock; under it the project is checked again, the take number grows and the
 * previous take's file goes away only after the new state is written. With metaRaw the take was dubbed
 * over the video and remembers where (DubTake.videoStart and the line's window).
 */
export async function saveDubTake(id: string, keyRaw: unknown, data: Buffer, metaRaw?: DubMetaInput): Promise<Project3D> {
  const key = checkLineKey(keyRaw);
  projectDir(id);
  const meta = checkDubMeta(metaRaw);
  if (!data.length) throw new Studio3DError("Пустая запись", 400);
  if (data.length > MAX_DUB_BYTES) throw new Studio3DError(`Запись больше ${MAX_DUB_BYTES / 1024 / 1024} МБ`, 413);
  const kind = sniffAudio(data);
  if (!kind) throw new Studio3DError("Формат записи не распознан — нужен webm, ogg, mp4, wav или mp3", 415);

  // cheap checks first: no point in decoding a take the project would refuse anyway
  const before = getProject(id);
  if (!before) throw notFound();
  checkTakesFree(before);
  if (!ownLines(before.script).some((l) => l.key === key)) throw notOwnLine();
  const lineWindow = meta ? dubWindow(before, key, meta) : null;
  if (meta) checkRefined(before);

  const input = await tempFile(kind);
  const output = await tempFile("flac");
  try {
    await fs.promises.writeFile(input, data);
    const { duration, peakDb } = await toFlac(input, output, MAX_DUB_SECONDS + 1).catch((e) => {
      throw e instanceof AudioToolError ? unreadable() : e;
    });
    if (!(duration >= MIN_DUB_SECONDS) || duration > MAX_DUB_SECONDS) {
      throw new Studio3DError(`Запись должна длиться от ${String(MIN_DUB_SECONDS).replace(".", ",")} до ${MAX_DUB_SECONDS} секунд`, 400);
    }
    if (!(peakDb > -50)) throw new Studio3DError("Запись почти беззвучная — проверьте микрофон", 400);
    if (meta && meta.videoStart + duration <= meta.lineStart) throw new Studio3DError("Запись закончилась раньше, чем началась реплика, — запишите ещё раз", 400);
    // stopped by hand in the middle of the line: the dub silences his synthesized line whole, the rest would be silence.
    // Measured on the page's clock (before the latency shift), where the take ran to at least the line's end.
    if (meta && lineWindow && before.video && meta.videoStart + meta.latencyMs / 1000 + duration < Math.min(lineWindow.end, before.video.duration) - TAKE_END_SLACK) {
      throw new Studio3DError("Запись обрывается до конца реплики — запишите реплику целиком", 400);
    }
    const flac = await fs.promises.readFile(output);

    const { project, previous } = await withProjectLock(id, async () => {
      const p = readProject(id);
      if (!p) throw notFound();
      checkTakesFree(p);
      const line = ownLines(p.script).find((l) => l.key === key);
      if (!line) throw notOwnLine();
      const w = meta ? dubWindow(p, key, meta) : null;
      // a refine may have started while the take was converted
      if (meta) checkRefined(p);
      const dub = p.dub ?? { version: 0, takes: {} };
      const previous: DubTake | undefined = dub.takes[key];
      const take = (previous?.take ?? 0) + 1;
      const rel = `${DUB_DIR}/${key}.${take}.flac`;
      const dest = projectFile(id, rel);
      await fs.promises.mkdir(path.dirname(dest), { recursive: true });
      await renameWithRetry(output, dest);
      dub.takes[key] = {
        key,
        take,
        text: line.text,
        file: rel,
        bytes: flac.length,
        sha256: sha256(flac),
        duration: round3(duration),
        peakDb: Math.round(peakDb * 10) / 10,
        at: now(),
        scriptVersion: p.scriptVersion,
        ...(meta && w ? { videoStart: meta.videoStart, latencyMs: meta.latencyMs, lineStart: w.start, lineEnd: w.end, videoAt: meta.videoAt } : {}),
      };
      dub.version += 1;
      p.dub = dub;
      p.updatedAt = now();
      try {
        await writeProject(p);
      } catch (e) {
        // project.json does not know the new take: its file would be an orphan
        await fs.promises.rm(dest, { force: true });
        throw e;
      }
      return { project: p, previous };
    });
    if (previous) await removeInside(id, previous.file);
    return project;
  } finally {
    await Promise.all([fs.promises.rm(input, { force: true }), fs.promises.rm(output, { force: true })]);
  }
}

/**
 * Forgets a take (of current or stale words); for an own-voice montage that line must be recorded again.
 * Only a take of a current line changes dub.version: a stale one was not part of any current set.
 */
export async function removeDubTake(id: string, keyRaw: unknown): Promise<Project3D> {
  const key = checkLineKey(keyRaw);
  let file = "";
  const { project } = await mutate(id, (p) => {
    checkTakesFree(p);
    const dub = p.dub ?? { version: 0, takes: {} };
    const take = dub.takes[key];
    if (!take) throw new Studio3DError("Записи этой реплики нет", 404);
    file = take.file;
    delete dub.takes[key];
    if (ownLines(p.script).some((l) => l.key === key)) dub.version += 1;
    p.dub = dub;
    p.updatedAt = now();
  });
  await removeInside(id, file);
  return project;
}

/** The current take of a line, for the page to play; null when there is none. */
export function dubTakeFile(id: string, keyRaw: unknown): { file: string; take: DubTake } | null {
  if (!isLineKey(keyRaw)) return null;
  const take = getProject(id)?.dub?.takes[keyRaw];
  return take ? { file: projectFile(id, take.file), take } : null;
}

/** The synthesized clip of a line, for the page to play; null when there is none. */
export function lineClipFile(id: string, keyRaw: unknown): { file: string; clip: LineClip } | null {
  if (!isLineKey(keyRaw)) return null;
  const clip = getProject(id)?.clips?.[keyRaw];
  return clip ? { file: projectFile(id, clip.file), clip } : null;
}

/**
 * One synthesized line from a running "voice" job (mp3, whole file). The key must be one of the plan's:
 * the script cannot change while the job lives, so another key is a runner bug, not a race.
 */
export async function saveLineClip(id: string, jobId: unknown, keyRaw: unknown, data: Buffer, durationRaw: unknown): Promise<LineClip> {
  const key = checkLineKey(keyRaw);
  projectDir(id);
  const duration = Number(durationRaw);
  if (!Number.isFinite(duration) || duration <= 0 || duration > 120) throw new Studio3DError("Нужна длительность реплики в секундах", 400);
  if (!data.length) throw new Studio3DError("Пустой файл", 400);
  if (data.length > MAX_CLIP_BYTES) throw new Studio3DError(`Реплика больше ${MAX_CLIP_BYTES / 1024 / 1024} МБ`, 413);
  if (sniffAudio(data) !== "mp3") throw new Studio3DError("Реплика должна быть в mp3", 415);
  const tmp = await tempFile("mp3");
  try {
    await fs.promises.writeFile(tmp, data);
    const { result } = await mutateForRunner(id, async (p) => {
      const job = runningJob(p, jobId, "voice");
      const line = (p.script?.lines ?? []).find((l) => lineKey(l.text) === key);
      if (!line) throw new Studio3DError("Такой реплики нет в сценарии", 400);
      // the runner uploads one clip per key, voiced for the first line with those words (missingClips expects that speaker)
      const who = clipSpeakers(p.script).get(key) ?? line.who;
      const rel = `${CLIPS_DIR}/${key}.mp3`;
      const dest = projectFile(id, rel);
      await fs.promises.mkdir(path.dirname(dest), { recursive: true });
      await renameWithRetry(tmp, dest);
      const clip: LineClip = { key, who, text: line.text, file: rel, duration: round3(duration), at: now() };
      p.clips = { ...(p.clips ?? {}), [key]: clip };
      job.heartbeatAt = now();
      p.updatedAt = now();
      return clip;
    });
    return result;
  } finally {
    await fs.promises.rm(tmp, { force: true });
  }
}

/** A recorded take for the running montage: only the take its plan named, so a changed take is never mixed in. */
export function runnerDubTake(id: string, jobId: unknown, keyRaw: unknown, takeRaw: unknown): { file: string; sha256: string; bytes: number } {
  const key = checkLineKey(keyRaw);
  const p = getProject(id);
  if (!p) throw staleJob();
  runningJob(p, jobId, VIDEO_TASKS);
  const t = p.dub?.takes[key];
  if (!t || t.take !== Number(takeRaw)) throw new Studio3DError("Запись этой реплики сменилась — задача не актуальна", 409);
  return { file: projectFile(id, t.file), sha256: t.sha256, bytes: t.bytes };
}
