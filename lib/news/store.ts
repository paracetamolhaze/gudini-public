import fs from "fs";
import path from "path";
import crypto from "crypto";
import type { MusicTrack, NewsJob, NewsPick, NewsProject, NewsStory, NewsTask } from "./types";
import { checkStory, checkTracks, cleanText, isLive, isLost, sameStory } from "./rules";
import { mixTrack } from "./mix";

/**
 * Storage of the «Новости» section: <root>/<id>/project.json, base.mp4 (the PC's render without music) and out.mp4
 * (base with the chosen track, mixed here), <root>/music.json — the music list the runner reports, and
 * <root>/music/<sig>.m4a — the prepared pieces of those tracks it uploads. Separate from db.json and the other
 * sections. Only the site process writes here (the runner talks HTTP), so mutations are serialized by an in-process
 * lock per project; reads need no lock because every write lands atomically (temp file + rename).
 */

export { isLost, isLive };

export class NewsError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409 | 413,
  ) {
    super(message);
    this.name = "NewsError";
  }
}

const notFound = () => new NewsError("Ролик не найден", 404);
const busy = () => new NewsError("Идёт задача — дождитесь её окончания", 409);
/** A runner call for a job the project no longer has: replaced, finished or the project was deleted. */
const staleJob = () => new NewsError("Задача больше не актуальна", 409);

export const VIDEO_FILE = "out.mp4";
export const BASE_FILE = "base.mp4";
/**
 * The runner's upload lands here and becomes base.mp4 only when its job completes: a render that fails after the
 * upload leaves the current video and its record together.
 */
export const UPLOAD_FILE = "base.next.mp4";
export const MAX_VIDEO_BYTES = 2 * 1024 ** 3;
export const MAX_TRACK_BYTES = 40 * 1024 ** 2;
const MUSIC_LIST = "music.json";
const TRACK_DIR = "music";

export function newsRoot(): string {
  return path.resolve(process.env.NEWS_DATA_DIR ?? path.join(process.cwd(), "data", "news"));
}

const ID_RE = /^[a-z0-9-]{6,40}$/;
export const isProjectId = (v: unknown): v is string => typeof v === "string" && ID_RE.test(v);
export const isJobId = isProjectId;

export const newId = () => Date.now().toString(36) + crypto.randomBytes(5).toString("hex");

/** Every id from a URL goes through here before it touches the disk. */
export function projectDir(id: string): string {
  if (!isProjectId(id)) throw new NewsError("Недопустимый id ролика", 400);
  const root = newsRoot();
  const dir = path.resolve(root, id);
  if (path.dirname(dir) !== root) throw new NewsError("Недопустимый id ролика", 400);
  return dir;
}

export const videoPath = (id: string) => path.join(projectDir(id), VIDEO_FILE);
export const basePath = (id: string) => path.join(projectDir(id), BASE_FILE);
const uploadPath = (id: string) => path.join(projectDir(id), UPLOAD_FILE);
const jsonPath = (id: string) => path.join(projectDir(id), "project.json");
const now = () => new Date().toISOString();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---- lock: Next bundles each route separately, so the chains live on globalThis to be shared

type Chains = Map<string, Promise<void>>;
const LOCKS = Symbol.for("gudini.news.locks");

function chains(): Chains {
  const g = globalThis as unknown as Record<symbol, Chains | undefined>;
  return (g[LOCKS] ??= new Map());
}

export function withLock<T>(key: string, fn: () => T | Promise<T>): Promise<T> {
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

export function withProjectLock<T>(id: string, fn: () => T | Promise<T>): Promise<T> {
  return withLock(projectDir(id), fn);
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

export async function writeJson(file: string, value: unknown) {
  const tmp = `${file}.${crypto.randomBytes(4).toString("hex")}.tmp`;
  await fs.promises.writeFile(tmp, JSON.stringify(value, null, 2));
  try {
    await renameWithRetry(tmp, file);
  } catch (e) {
    await fs.promises.rm(tmp, { force: true });
    throw e;
  }
}

const writeProject = (p: NewsProject) => writeJson(jsonPath(p.id), p);

function readProject(id: string): NewsProject | null {
  let raw: string;
  try {
    raw = fs.readFileSync(jsonPath(id), "utf8");
  } catch {
    return null;
  }
  try {
    const p = JSON.parse(raw) as NewsProject;
    if (!p || p.id !== id) return null;
    p.createdAt = typeof p.createdAt === "string" ? p.createdAt : "";
    p.updatedAt = typeof p.updatedAt === "string" ? p.updatedAt : p.createdAt;
    // every reader sees the same full shape
    p.story = p.story ?? null;
    p.job = p.job ?? null;
    // before the music moved to the site a rerender was a "music" job with its track
    if (p.job && (p.job.task as string) === "music") {
      const { music: _music, ...job } = p.job as NewsJob & { music?: unknown };
      p.job = { ...job, task: "rerender" };
    }
    p.video = p.video ? { ...p.video, music: p.video.music ?? null, base: p.video.base ?? null } : null;
    p.meta = p.meta ?? null;
    p.cover = p.cover ?? null;
    p.mirrorId = p.mirrorId ?? null;
    return p;
  } catch {
    console.warn(`Новости ${id}: project.json не читается`);
    return null;
  }
}

/** Read → change → atomic write, under the project's lock. A throw inside fn writes nothing. */
export async function mutate<T>(id: string, fn: (p: NewsProject) => T | Promise<T>): Promise<{ project: NewsProject; result: T }> {
  return withProjectLock(id, async () => {
    const p = readProject(id);
    if (!p) throw notFound();
    const result = await fn(p);
    await writeProject(p);
    return { project: p, result };
  });
}

// ---- reads

export function getProject(id: string): NewsProject | null {
  return isProjectId(id) ? readProject(id) : null;
}

/** Newest first by creation: the list does not jump around while a job reports its progress. */
export function listProjects(): NewsProject[] {
  let names: string[];
  try {
    names = fs.readdirSync(newsRoot());
  } catch {
    return [];
  }
  return names
    .filter(isProjectId)
    .map(readProject)
    .filter((p): p is NewsProject => Boolean(p))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
}

// ---- the music list from the PC

export type MusicList = { tracks: MusicTrack[]; /** When the list last changed; null — never reported. */ at: string | null };

const musicPath = () => path.join(newsRoot(), MUSIC_LIST);

export function readTracks(): MusicList {
  try {
    const raw = JSON.parse(fs.readFileSync(musicPath(), "utf8")) as { tracks?: unknown; at?: unknown };
    return { tracks: checkTracks(raw.tracks).tracks, at: typeof raw.at === "string" ? raw.at : null };
  } catch {
    return { tracks: [], at: null };
  }
}

/**
 * The list from a claim. Written only when it changed: the runner claims every few seconds. Broken entries are
 * dropped (rules: checkTracks), an empty list is a list too — the folder was emptied.
 */
export async function saveTracks(raw: unknown): Promise<MusicList> {
  if (!Array.isArray(raw)) throw new NewsError("Список музыки должен быть массивом", 400);
  const { tracks, dropped } = checkTracks(raw);
  if (dropped) console.warn(`Новости: из списка музыки отброшено записей: ${dropped}`);
  return withLock(`${newsRoot()}#music`, async () => {
    const current = readTracks();
    if (current.at && JSON.stringify(current.tracks) === JSON.stringify(tracks)) return current;
    const next: MusicList = { tracks, at: now() };
    await fs.promises.mkdir(newsRoot(), { recursive: true });
    await writeJson(musicPath(), next);
    return next;
  });
}

// ---- prepared pieces of the tracks, uploaded by the runner once per sig

const SIG_RE = /^[a-f0-9]{8,40}$/;
const trackPath = (sig: string) => path.join(newsRoot(), TRACK_DIR, `${sig}.m4a`);

/** The prepared piece of a reported track, if the site has it. */
export function trackFile(sig: string | undefined): string | null {
  if (!sig || !SIG_RE.test(sig)) return null;
  const file = trackPath(sig);
  return fs.existsSync(file) ? file : null;
}

/** The music list for the pages: ready — the piece is here, the track plays and mixes at once. */
export const trackViews = (): (MusicTrack & { ready: boolean })[] => readTracks().tracks.map((t) => ({ ...t, ready: Boolean(trackFile(t.sig)) }));

/** Reported tracks whose piece is not here yet: the claim asks the runner for them. */
export const missingTracks = (tracks: readonly MusicTrack[] = readTracks().tracks): string[] => tracks.filter((t) => t.sig && !trackFile(t.sig)).map((t) => t.file);

/** A track piece from the runner: only for a track it reported with this sig; written whole or not at all. */
export async function receiveTrack(file: unknown, sig: unknown, data: Buffer): Promise<void> {
  if (typeof sig !== "string" || !SIG_RE.test(sig)) throw new NewsError("Недопустимый sig трека", 400);
  if (!readTracks().tracks.some((t) => t.file === file && t.sig === sig)) throw new NewsError("Такого трека нет в списке с ПК", 409);
  if (!data.length) throw new NewsError("Пустой файл трека", 400);
  if (data.length > MAX_TRACK_BYTES) throw new NewsError("Трек больше 40 МБ", 413);
  const target = trackPath(sig);
  await fs.promises.mkdir(path.dirname(target), { recursive: true });
  const tmp = `${target}.${crypto.randomBytes(4).toString("hex")}.tmp`;
  await fs.promises.writeFile(tmp, data);
  await renameWithRetry(tmp, target);
}

/** The runner's last claim, in memory: the page tells the owner when the PC has not asked for work for a while. */
const SEEN = Symbol.for("gudini.news.runnerSeen");
export function markRunnerSeen(at = now()) {
  (globalThis as unknown as Record<symbol, string | undefined>)[SEEN] = at;
}
export const runnerSeenAt = (): string | null => (globalThis as unknown as Record<symbol, string | undefined>)[SEEN] ?? null;

// ---- owner actions

function newJob(task: NewsTask, extra: Partial<NewsJob> = {}): NewsJob {
  return { id: newId(), task, state: "queued", step: "В очереди", progress: 0, createdAt: now(), ...extra };
}

/**
 * A new video: the runner finds a story and makes the whole video. Nothing to fill in. pick — a story from the PC's
 * stock the owner chose (lib/news/stock.ts checks it): the list shows its title at once, the runner replaces the story
 * with the full one when it starts.
 */
export async function createProject(pick?: NewsPick): Promise<NewsProject> {
  const at = now();
  const story: NewsStory | null = pick ? { title: pick.title, summary: pick.summary, hero: pick.hero, sources: pick.sources.map((url) => ({ url })), script: "" } : null;
  const p: NewsProject = { id: newId(), createdAt: at, updatedAt: at, story, job: newJob("create", pick ? { pick: pick.id } : {}), video: null, meta: null, cover: null, mirrorId: null };
  return withProjectLock(p.id, async () => {
    await fs.promises.mkdir(projectDir(p.id), { recursive: true });
    await writeProject(p);
    return p;
  });
}

export async function removeProject(id: string): Promise<void> {
  await withProjectLock(id, async () => {
    const p = readProject(id);
    if (!p) throw notFound();
    if (p.job?.state === "running" && !isLost(p.job)) throw busy();
    await fs.promises.rm(projectDir(id), { recursive: true, force: true, maxRetries: 5 });
  });
}

/**
 * «Создать заново»: another create job on the same project after a failed or lost one. Only while there is no
 * video: a ready video is changed by a music job, and a new story is a new video («Создать» on the list).
 * The old story goes, so the page does not show it while the runner looks for another.
 */
export async function recreate(id: string): Promise<NewsProject> {
  const { project } = await mutate(id, (p) => {
    if (isLive(p.job)) throw busy();
    if (p.video) throw new NewsError("Ролик уже готов — новую историю создайте кнопкой «Создать» в списке", 409);
    // a lost job is simply replaced: its late runner calls no longer match the job id
    p.job = newJob("create");
    p.story = null;
    p.updatedAt = now();
  });
  return project;
}

/** The music choice from the page: null (no music) or a track the PC reported. */
function checkMusic(raw: unknown): MusicTrack | null {
  if (raw === null) return null;
  if (typeof raw !== "string" || !raw.trim()) throw new NewsError("Музыка — файл из списка или null (без музыки)", 400);
  const file = raw.trim();
  const track = readTracks().tracks.find((t) => t.file === file);
  if (!track) throw new NewsError("Такого трека нет в папке news/music на ПК — обновите страницу", 400);
  return track;
}

/** out.mp4 = base.mp4 with the track (or the base itself without one), into place atomically. */
async function remix(id: string, track: MusicTrack | null, duration: number) {
  const tmp = path.join(projectDir(id), `out.mix.${crypto.randomBytes(4).toString("hex")}.mp4`);
  try {
    const piece = track ? trackFile(track.sig) : null;
    if (track && !piece) throw new NewsError("Трек ещё не дошёл с ПК — подождите полминуты и выберите снова", 409);
    if (piece) await mixTrack(basePath(id), piece, duration, tmp);
    else await fs.promises.copyFile(basePath(id), tmp);
    await renameWithRetry(tmp, videoPath(id));
  } finally {
    await fs.promises.rm(tmp, { force: true });
  }
}

/**
 * Another track under the ready video (or none): mixed here in a second or two, no job for the PC. The caption and
 * the cover stay: the frames are the same, so a cover made from the previous out.mp4 counts as made from this one.
 * The same choice again changes nothing.
 */
export async function setMusic(id: string, raw: unknown): Promise<NewsProject> {
  if (raw === undefined) throw new NewsError("Нужно поле music: файл трека или null", 400);
  // checked before the lock: a bad request should say what is wrong even while a job runs
  const track = checkMusic(raw);
  const music = track?.file ?? null;
  const { project } = await mutate(id, async (p) => {
    const video = p.video;
    if (!video) throw new NewsError("Сначала нужен готовый ролик", 409);
    if ((video.music ?? null) === music) return;
    if (!video.base) throw new NewsError("Этот ролик смонтирован до мгновенной смены музыки — сначала его нужно один раз перемонтировать", 409);
    await remix(id, track, video.duration);
    const at = now();
    if (p.cover?.videoAt === video.at) p.cover = { ...p.cover, videoAt: at };
    p.video = { ...video, music, at };
    p.updatedAt = at;
  });
  return project;
}

/** The same video again from its montage plan on the PC (after a fix of the montage); the chosen track stays. */
export async function enqueueRerender(id: string): Promise<NewsProject> {
  const { project } = await mutate(id, (p) => {
    if (isLive(p.job)) throw busy();
    if (!p.video) throw new NewsError("Сначала нужен готовый ролик", 409);
    p.job = newJob("rerender");
    p.updatedAt = now();
  });
  return project;
}

/** Takes back a job the runner has not picked up yet (the PC may be switched off). */
export async function cancelQueued(id: string): Promise<NewsProject> {
  const { project } = await mutate(id, (p) => {
    if (p.job?.state !== "queued") throw new NewsError("Отменить можно только задачу в очереди", 409);
    p.job = null;
    p.updatedAt = now();
  });
  return project;
}

// ---- runner (news/runner on the PC)

export type Claimed = { project: NewsProject; job: NewsJob };

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
      // a hand-edited project.json could queue a rerender of nothing: the owner cannot (enqueueRerender checks it)
      if (p.job.task === "rerender" && !p.video) {
        p.job = { ...p.job, state: "error", error: "Ролика нет — перемонтировать нечего", finishedAt: at };
        await writeProject(p);
        return null;
      }
      p.job = { ...p.job, state: "running", step: "Взял в работу", startedAt: at, heartbeatAt: at };
      await writeProject(p);
      return { project: p, job: p.job };
    });
    if (claimed) return claimed;
  }
  return null;
}

/** The project's current job, only if it is this running one; otherwise the runner must stop. */
function runningJob(p: NewsProject, jobId: unknown, task?: NewsTask): NewsJob {
  const job = p.job;
  if (!job || job.id !== jobId || job.state !== "running" || (task && job.task !== task)) throw staleJob();
  return job;
}

/** A runner call for a deleted project means the same as for a replaced job. */
async function mutateForRunner<T>(id: string, fn: (p: NewsProject) => T | Promise<T>) {
  try {
    return await mutate(id, fn);
  } catch (e) {
    if (e instanceof NewsError && e.status === 404) throw staleJob();
    throw e;
  }
}

/** Progress is also the heartbeat. */
export async function reportProgress(id: string, jobId: unknown, step: unknown, progress: unknown): Promise<NewsJob> {
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

/** The found story of a create job, shown on the page while the video is made. Rejected whole if invalid. */
export async function setStory(id: string, jobId: unknown, raw: unknown): Promise<NewsProject> {
  const { story, problems } = checkStory(raw);
  if (!story) throw new NewsError(problems.join(". "), 400);
  const { project } = await mutateForRunner(id, (p) => {
    const job = runningJob(p, jobId, "create");
    // a retried request (its answer got lost) brings the same story again: nothing changes but the heartbeat
    if (!sameStory(p.story, story)) p.story = story;
    job.heartbeatAt = now();
    p.updatedAt = now();
  });
  return project;
}

/** Was the upload made by this job, and not left from an earlier one? */
function uploadedBy(job: NewsJob, file: string): fs.Stats | null {
  try {
    const st = fs.statSync(file);
    // a little slack: some filesystems stamp files with a coarse clock
    const started = Date.parse(job.startedAt ?? job.createdAt) - 2000;
    return st.isFile() && st.size > 0 && st.mtimeMs >= started ? st : null;
  } catch {
    return null;
  }
}

export type CompleteInput = { error?: unknown; video?: unknown };

const MUSIC_FILE_MAX = 200;

/**
 * Finishes the running job. The upload (the render without music) becomes base.mp4 only now, and out.mp4 is mixed
 * from it with the track: a new video takes the one the runner suggests, a rerender keeps the owner's choice. A
 * rerender keeps the caption and the cover: the frames are the same.
 */
export async function completeJob(id: string, jobId: unknown, input: CompleteInput): Promise<NewsProject> {
  const upload = uploadPath(id);
  const { project } = await mutateForRunner(id, async (p) => {
    const job = runningJob(p, jobId);
    const at = now();
    const fail = (message: string) => {
      p.job = { ...job, state: "error", error: message.slice(0, 1000), heartbeatAt: at, finishedAt: at };
    };
    const v = (input.video && typeof input.video === "object" ? input.video : {}) as { duration?: unknown; music?: unknown };
    const duration = Math.round(Number(v.duration) * 100) / 100;
    const suggested = v.music === null || v.music === undefined ? null : typeof v.music === "string" ? v.music.trim().slice(0, MUSIC_FILE_MAX) || null : undefined;

    if (typeof input.error === "string" && input.error.trim()) fail(input.error.trim());
    else if (job.task === "create" && !p.story) fail("Исполнитель не прислал историю");
    else if (!Number.isFinite(duration) || duration <= 0 || suggested === undefined) fail("Исполнитель не прислал длительность и музыку ролика");
    else if (!uploadedBy(job, upload)) fail("Видео не загрузилось на сайт");
    else {
      const previous = p.video;
      await renameWithRetry(upload, basePath(id));
      // a track the site has no piece of (or the PC no longer lists) is left out rather than failing the render
      const wanted = job.task === "rerender" ? (previous?.music ?? null) : suggested;
      let track = wanted ? (readTracks().tracks.find((t) => t.file === wanted && trackFile(t.sig)) ?? null) : null;
      if (wanted && !track) console.warn(`Новости ${id}: трека ${JSON.stringify(wanted)} нет на сайте — ролик без музыки`);
      try {
        await remix(id, track, duration);
      } catch (e) {
        // the render is safe as base.mp4: without the mix the video goes out without music
        console.warn(`Новости ${id}: музыка не склеилась — ролик без музыки:`, (e as Error).message);
        track = null;
        await remix(id, null, duration);
      }
      p.video = { file: VIDEO_FILE, at, duration, music: track?.file ?? null, base: { file: BASE_FILE, at } };
      if (job.task === "rerender" && previous && p.cover?.videoAt === previous.at) p.cover = { ...p.cover, videoAt: at };
      p.job = { ...job, state: "done", step: "Готово", progress: 100, heartbeatAt: at, finishedAt: at };
    }
    p.updatedAt = at;
  });
  // a failed job's upload is of no use; a done one was moved into place above
  await Promise.all([fs.promises.rm(upload, { force: true }), fs.promises.rm(`${upload}.part`, { force: true })]);
  return project;
}

export type ChunkResult = { received: number } | { done: true; size: number } | { resync: number };

/**
 * One piece of the video upload, the same protocol as the 3D runner: the piece at x-offset is appended to
 * out.next.mp4.part, a repeat of the last piece is accepted silently, any other offset gets the size received so far
 * so the runner can resume. The whole file is renamed to out.next.mp4; completeJob puts it in place.
 */
export async function receiveVideoChunk(id: string, jobId: unknown, offset: number, total: number, data: Buffer): Promise<ChunkResult> {
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(total) || total <= 0) {
    throw new NewsError("Нужны заголовки x-offset и x-file-size", 400);
  }
  if (total > MAX_VIDEO_BYTES) throw new NewsError("Видео больше 2 ГБ", 413);
  if (!data.length || offset + data.length > total) throw new NewsError("Кусок не помещается в файл", 400);
  return withProjectLock(id, async () => {
    const p = readProject(id);
    if (!p) throw staleJob();
    const job = runningJob(p, jobId);
    const file = uploadPath(id);
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
      throw new NewsError(`Размер не сошёлся: ${received} из ${total}`, 400);
    }
    await renameWithRetry(part, file);
    return { done: true as const, size: received };
  });
}
