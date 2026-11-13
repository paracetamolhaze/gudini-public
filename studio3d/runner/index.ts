/**
 * The gudini-3d container's process: takes «3Д» jobs from the site one at a time, hands them to the director
 * (Claude writes, ElevenLabs voices, Remotion renders) and sends the result back. The image's CMD starts it.
 */
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import type { DubRequest, Hooks, IdeaChoice, LineWindow, MontageVoice, ProjectSpec, Recording, Script3D as DirectorScript, SiteVideo, VoicedClip } from "../director/api";
import { writeMark } from "../director/montageMark";
import type { FoundWindows, MadeVideo } from "../director/soundLines";
import { CAST_IDS, LINES_VERSION, MAX_DUB_BYTES, type CastId, type CompleteBody, type DubPlanLine, type IdeaPool, type Job3D, type JobTask, type Script3D, type Video3D, type VideoLine, type VoicePlan } from "./protocol";
import { createSite, isJobLost, type Claimed, type Site } from "./site";

/** A video's linesVersion and found windows' version count the way the protocol's LINES_VERSION does. */
export type Director = {
  /** «Создать видео»: Claude picks the next sketch from the site's trend cards, or writes one of its own. */
  findIdea: (pool: IdeaPool, hooks: Hooks) => Promise<IdeaChoice>;
  writeScript: (project: ProjectSpec, hooks: Hooks) => Promise<DirectorScript>;
  makeMontage: (project: ProjectSpec & { script: DirectorScript }, workDir: string, hooks: Hooks, voice?: MontageVoice) => Promise<MadeVideo>;
  /** The "voice" job: every line synthesized on its own; the files are the per-line cache the montage reuses. */
  voiceLines: (project: ProjectSpec & { script: DirectorScript }, workDir: string, hooks: Hooks) => Promise<VoicedClip[]>;
  /** The "dub" job: the montage in workDir re-rendered with the owner's takes, recorded over it, in place of his lines. */
  makeDub: (project: ProjectSpec, workDir: string, hooks: Hooks, dub: DubRequest) => Promise<MadeVideo>;
  /** The line windows of the site's video, from its montage in workDir; null when the folder has no montage of it. */
  findLineWindows: (workDir: string, video: SiteVideo, script: DirectorScript | null, log?: (m: string) => void) => Promise<FoundWindows | null>;
};

export type RunnerOptions = {
  site?: Site;
  /** Tests pass a stub; the real director is loaded on the first job, so a broken one fails jobs, not the process. */
  director?: Director;
  workRoot?: string;
  pollMs?: number;
  heartbeatMs?: number;
  log?: (line: string) => void;
};

const MAX_ERROR_CHARS = 600;
/** A director that ignores the abort gets this long to stop before the next job may start. */
const ABORT_GRACE_MS = 30_000;
const STOPPED_MESSAGE = "Исполнитель 3Д остановили посреди задания — запустите его снова.";

export const logLine = (line: string): void => console.log(`${new Date().toISOString()} ${line}`);

const loadDirector = async (): Promise<Director> => {
  const api = await import("../director/api");
  return { findIdea: api.findIdea, writeScript: api.writeScript, makeMontage: api.makeMontage, voiceLines: api.voiceLines, makeDub: api.makeDub, findLineWindows: api.findLineWindows };
};

const describe = (error: unknown): string => (error instanceof Error ? error.message : String(error));
const FAILED: Record<JobTask, string> = { script: "Сценарий не написан", voice: "Реплики не озвучены", montage: "Монтаж не сделан", dub: "Ролик с твоим голосом не собран" };

/** What the owner reads under the job: the message and its causes, in Russian, at most 600 characters. */
export function errorText(error: unknown, task: JobTask): string {
  const parts: string[] = [];
  let current: unknown = error;
  for (let depth = 0; current !== undefined && current !== null && depth < 4; depth++) {
    const message = describe(current).trim();
    if (message && !parts.some(part => part.includes(message))) parts.push(message);
    current = current instanceof Error ? current.cause : undefined;
  }
  let text = parts.join(" — ") || "неизвестная ошибка";
  if (!/[а-яё]/i.test(text)) text = `${FAILED[task] ?? "Задание не выполнено"}: ${text}`;
  return text.slice(0, MAX_ERROR_CHARS);
}

const isCastId = (who: string): who is CastId => (CAST_IDS as readonly string[]).includes(who);

/** The director speaks plain strings; the site accepts only its cast. */
function toSiteScript(script: DirectorScript): Script3D {
  const lines = script.lines.map(line => {
    if (!isCastId(line.who)) throw new Error(`Сценарист вернул неизвестного героя «${line.who}»`);
    return { who: line.who, text: line.text };
  });
  if (!lines.length) throw new Error("Сценарист вернул пустой диалог");
  return { title: script.title, lines };
}

/** The owner's cast id: recorded takes belong to his lines only. */
const OWNER: CastId = "me";
/**
 * The rule the site keeps too: a line needs a voice clip (and, in the owner's voice, a take) only when letters or
 * digits are left once its [..] tags are gone. A line of tags only ([sighs], [pause]) may have neither.
 */
export const hasWords = (text: string) => /[\p{L}\p{N}]/u.test(text.replace(/\[[^\]]*\]/g, " "));

/**
 * The "voice" job's clips that go to the site, one per key. The site keeps one clip per key, labelled with the
 * first line that has it, so only that line's own clip goes up: another speaker's equal words never stand in for
 * it. Every line with words must have its clip; a line of tags only may have none (Claude's line model drops
 * the tags, so his «[sighs]» is never voiced).
 */
export function clipsToUpload(clips: VoicedClip[], plan: VoicePlan, script: Script3D): VoicedClip[] {
  for (const clip of clips) if (!Number.isInteger(clip.index) || plan.keys[clip.index] === undefined) throw new Error(`Озвучена реплика ${clip.index + 1}, которой нет в сценарии`);
  const byIndex = new Map(clips.map(clip => [clip.index, clip]));
  // the same choice as the site's clipSpeakers: the first line WITH WORDS owns a key; a key of tags only, its first line
  const firstOfKey = new Map<string, number>();
  script.lines.forEach((line, i) => {
    if (hasWords(line.text) && !firstOfKey.has(plan.keys[i])) firstOfKey.set(plan.keys[i], i);
  });
  plan.keys.forEach((key, i) => {
    if (!firstOfKey.has(key)) firstOfKey.set(key, i);
  });
  const unvoiced = script.lines.flatMap((line, i) => (hasWords(line.text) && !byIndex.has(firstOfKey.get(plan.keys[i])!) ? [i + 1] : []));
  if (unvoiced.length) throw new Error(`${unvoiced.length > 1 ? "Не озвучены реплики" : "Не озвучена реплика"} ${unvoiced.join(", ")}`);
  return [...firstOfKey.values()].flatMap(i => byIndex.get(i) ?? []);
}

const badPlan = (what: string) => new Error(`Сайт прислал неверный план озвучки: ${what}`);

/**
 * The site's voice plan, checked before anything is paid for or downloaded: a bad plan fails the job with its
 * reason instead of a video that quietly mixes synthesized and recorded lines. needKeys: the "voice" job uploads by key.
 */
export function checkPlan(plan: VoicePlan, script: Script3D, needKeys: boolean): VoicePlan {
  if (needKeys && (!Array.isArray(plan.keys) || plan.keys.length !== script.lines.length || !plan.keys.every(key => typeof key === "string" && key.length > 0)))
    throw badPlan("ключи реплик не совпадают со сценарием");
  if (!plan.ownVoice) return plan;
  const recorded = checkTakes(plan, script);
  // the owner (2026-10-22): his own voice only when every one of his lines is recorded
  const missing = script.lines.flatMap((line, i) => (line.who === OWNER && hasWords(line.text) && !recorded.has(i) ? [i + 1] : []));
  if (missing.length) throw new Error(`Своим голосом можно монтировать, только когда записаны все ваши реплики: нет записи ${missing.length > 1 ? "реплик" : "реплики"} ${missing.join(", ")}`);
  return plan;
}

/** The plan's takes: each of an existing owner line, at most one per line, with its key, take number, checksum and size. */
function checkTakes(plan: VoicePlan, script: Script3D): Set<number> {
  if (!Array.isArray(plan.lines)) throw badPlan("нет списка записей");
  if (!Number.isInteger(plan.dubVersion)) throw badPlan("нет версии записей");
  const recorded = new Set<number>();
  for (const line of plan.lines) {
    const index = line?.index;
    if (!Number.isInteger(index) || index < 0 || index >= script.lines.length) throw badPlan(`запись для реплики ${Number(index) + 1}, а в сценарии их ${script.lines.length}`);
    if (script.lines[index].who !== OWNER) throw badPlan(`запись для реплики ${index + 1}, а её говорит не владелец`);
    if (recorded.has(index)) throw badPlan(`две записи реплики ${index + 1}`);
    recorded.add(index);
    if (typeof line.key !== "string" || !line.key || !Number.isInteger(line.take) || !/^[0-9a-f]{64}$/i.test(String(line.sha256)))
      throw badPlan(`у записи реплики ${index + 1} нет ключа, дубля или контрольной суммы`);
    if (!(line.bytes > 0 && line.bytes <= MAX_DUB_BYTES)) throw badPlan(`запись реплики ${index + 1} размером ${line.bytes} байт`);
  }
  return recorded;
}

/**
 * The plan of a "dub" job: takes recorded over the video, each with the video time of its first sample and its
 * line's window. Which lines must be dubbed is the site's call; the runner refuses only a take it cannot place.
 */
export function checkDubPlan(plan: VoicePlan, script: Script3D, videoDuration: number): DubPlanLine[] {
  checkTakes(plan, script);
  if (!plan.lines.length) throw new Error("Нет ни одной записи поверх ролика — озвучьте свои реплики и соберите снова");
  for (const line of plan.lines) {
    const { videoStart, lineStart, lineEnd } = line;
    const numbers = [videoStart, lineStart, lineEnd].every(v => typeof v === "number" && Number.isFinite(v));
    if (!numbers || !(lineEnd! > lineStart!) || lineStart! < 0 || lineEnd! > videoDuration + 0.5)
      throw new Error(`Реплика ${line.index + 1} записана не поверх ролика — озвучьте её заново на странице озвучки`);
  }
  return plan.lines;
}

/** The director's line windows as the site takes them: the whole list or none, since the site refuses a list with any bad window. */
export function toVideoLines(lines: LineWindow[] | null | undefined): VideoLine[] | undefined {
  if (!lines?.length) return undefined;
  const out: VideoLine[] = [];
  for (const line of lines) {
    if (!isCastId(line.who) || !Number.isInteger(line.index) || line.index < 0 || !(line.start >= 0) || !(line.end > line.start)) return undefined;
    out.push({ index: line.index, who: line.who, start: line.start, end: line.end });
  }
  return out;
}

/** How windows were found, as the protocol counts it: 1 (or none said) from the letter timings, LINES_VERSION from the sound. */
const versionOf = (version: number | undefined): number => (Number.isInteger(version) && version! >= 1 && version! <= LINES_VERSION ? version! : 1);
/** The version of the windows a video on the site has; 0 when it has none. A newer site's version is kept as it says. */
const videoLinesVersion = (video: Pick<Video3D, "lines" | "linesVersion">): number =>
  !video.lines?.length ? 0 : Number.isInteger(video.linesVersion) && video.linesVersion! > 1 ? video.linesVersion! : 1;

/** A finished video's windows for /complete: the lines, and linesVersion when they were found better than by letters. */
export function videoWindows(result: Pick<MadeVideo, "lines" | "linesVersion">): { lines?: VideoLine[]; linesVersion?: number } {
  const lines = toVideoLines(result.lines);
  if (!lines) return {};
  const version = versionOf(result.linesVersion);
  return { lines, ...(version > 1 ? { linesVersion: version } : {}) };
}

/**
 * The site took the video: the montage in workDir is now the site's video of that time (director/montageMark.ts),
 * which is what a dub over it checks. For a dub the montage stays the same and only the video's time is new. A job
 * the site failed keeps the folder's mark as it was; a site that does not answer with the job leaves the folder
 * unmarked, told by length as before marks.
 */
function markShown(workDir: string, finished: Job3D | null, jobId: string, log: (m: string) => void): void {
  try {
    if (!finished) writeMark(workDir, null);
    else if (finished.id === jobId && finished.state === "done" && typeof finished.finishedAt === "string" && finished.finishedAt)
      writeMark(workDir, { state: "shown", videoAt: finished.finishedAt, jobId });
  } catch (error) {
    log(`метка монтажа не записана: ${describe(error)}`);
  }
}

const sha256Of = async (file: string): Promise<string> =>
  fs.readFile(file).then(bytes => createHash("sha256").update(bytes).digest("hex"), () => "");

/** The planned takes in workDir/dub, named by their sha256: a take already there from an earlier run is not fetched again. */
async function fetchTakes(site: Site, ids: { id: string; jobId: string }, plan: VoicePlan, workDir: string, hooks: Hooks, label = "Скачиваю записи владельца"): Promise<Recording[]> {
  const dir = path.join(workDir, "dub");
  await fs.mkdir(dir, { recursive: true });
  const recordings: Recording[] = [];
  for (const [n, line] of plan.lines.entries()) {
    hooks.stage(`${label}: ${n + 1} из ${plan.lines.length}`, 1 + Math.round((3 * n) / plan.lines.length));
    const sha256 = line.sha256.toLowerCase();
    const file = path.join(dir, `${sha256.slice(0, 16)}.flac`);
    if ((await sha256Of(file)) !== sha256) await site.downloadDub(ids.id, ids.jobId, line.key, line.take, file, { sha256, bytes: line.bytes }, { signal: hooks.signal });
    recordings.push({ index: line.index, file, sha256 });
  }
  return recordings;
}

/** Resolves with the work or rejects as soon as the signal aborts, whichever comes first. */
async function untilAborted<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  let onAbort = () => {};
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    return await Promise.race([work, aborted]);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

/** Runs one claimed job to the end: the result or an error always reaches the site, unless the site gave the job away. */
export async function runJob(claimed: Claimed, options: RunnerOptions & { shutdown?: AbortSignal } = {}): Promise<void> {
  const { project, job } = claimed;
  const site = options.site ?? createSite();
  const write = options.log ?? logLine;
  const prefix = `[${project.id} ${job.task}]`;
  const log = (message: string) => write(`${prefix} ${message}`);
  const ids = { id: project.id, jobId: job.id };

  const controller = new AbortController();
  const shutdown = options.shutdown;
  const onShutdown = () => controller.abort(shutdown?.reason);
  if (shutdown?.aborted) onShutdown();
  else shutdown?.addEventListener("abort", onShutdown, { once: true });

  let latest = { step: "Контейнер 3Д взял задание", progress: 1 };
  let lost = false;
  let beating = false;
  let unheard = false;
  const beats = new AbortController();
  const beat = async () => {
    if (beating || beats.signal.aborted || controller.signal.aborted) return;
    beating = true;
    try {
      await site.progress({ ...ids, ...latest }, { signal: AbortSignal.any([controller.signal, beats.signal]), timeoutMs: 15_000 });
      if (unheard) log("пульс снова доходит до сайта");
      unheard = false;
    } catch (error) {
      if (isJobLost(error)) {
        lost = true;
        log("сайт отдал задание другому — останавливаю");
        controller.abort(error);
      } else if (!controller.signal.aborted && !beats.signal.aborted && !unheard) {
        // The work goes on: a site restarting for a deploy is not a reason to drop a render.
        unheard = true;
        log(`пульс не дошёл до сайта: ${describe(error)}`);
      }
    } finally {
      beating = false;
    }
  };
  const timer = setInterval(() => void beat(), options.heartbeatMs ?? 5000);
  const stopBeats = () => {
    clearInterval(timer);
    beats.abort();
  };

  const hooks: Hooks = {
    stage: (step, progress) => {
      const next = { step: String(step).slice(0, 200), progress: Number.isFinite(progress) ? Math.max(0, Math.min(100, Math.round(progress))) : latest.progress };
      if (next.step !== latest.step) log(`${next.step} (${next.progress}%)`);
      latest = next;
    },
    log,
    signal: controller.signal,
  };
  const spec: ProjectSpec = { id: project.id, topic: project.topic, notes: project.notes, script: project.script, scriptVersion: project.scriptVersion };

  let pending = null as Promise<unknown> | null;
  const directed = <T>(work: Promise<T>): Promise<T> => {
    pending = work;
    // The race below may leave the director's promise behind; its late rejection must not crash the process.
    work.catch(() => {});
    return untilAborted(work, controller.signal);
  };

  void beat();
  try {
    log(`начинаю: «${String(project.topic).slice(0, 80)}»`);
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(project.id)) throw new Error(`Некорректный id проекта «${project.id.slice(0, 40)}»`);
    const director = options.director ?? (await loadDirector());
    controller.signal.throwIfAborted();
    if (job.task === "script") {
      if (project.auto && !spec.topic.trim()) {
        // «Создать видео»: the idea comes first, from the trends the site keeps; the site stores it before the script
        hooks.stage("Ищу идею", 5);
        const pool = await site.ideas(ids, { signal: controller.signal });
        const choice = await directed(director.findIdea(pool, hooks));
        const stored = await site.sendIdea({ ...ids, key: choice.key, topic: choice.topic }, { signal: controller.signal, patient: true });
        spec.topic = stored.topic;
        if (stored.notes) spec.notes = stored.notes;
        log(`идея ${choice.key ?? "своя"}: «${stored.topic.slice(0, 120)}»`);
      }
      const script = toSiteScript(await directed(director.writeScript(spec, hooks)));
      hooks.stage("Сохраняю сценарий", 99);
      await site.sendScript({ ...ids, script }, { signal: controller.signal, patient: true });
      // heartbeats go on until the site has the result: a slow or restarting site must not see a silent job
      await site.complete(ids, { signal: controller.signal, patient: true });
      stopBeats();
      log(`готово: «${script.title}», реплик ${script.lines.length}`);
    } else if (job.task === "voice") {
      const script = project.script;
      if (!script?.lines.length) throw new Error("Сначала нужен сценарий: напишите или вставьте диалог");
      if (!claimed.voice) throw new Error("Сайт не прислал ключи реплик — обновите сайт и запустите озвучку снова");
      const plan = checkPlan(claimed.voice, script, true);
      // the same folder as the montage: its per-line cache is what the montage reuses without paying again
      const workDir = path.join(options.workRoot ?? process.env.STUDIO3D_WORK ?? "/data/work", project.id);
      await fs.mkdir(workDir, { recursive: true });
      const clips = await directed(director.voiceLines({ ...spec, script }, workDir, hooks));
      const uploads = clipsToUpload(clips, plan, script);
      for (const [n, clip] of uploads.entries()) {
        hooks.stage(`Загружаю реплики на сайт: ${n + 1} из ${uploads.length}`, 90 + Math.round((9 * n) / uploads.length));
        await site.uploadClip(project.id, job.id, plan.keys[clip.index], path.resolve(workDir, clip.file), clip.duration, { signal: controller.signal });
      }
      // a video made before windows were stored, or with windows found from the letters, gets them from its montage
      // here, measured from the sound, without a new render; the site decides whether they replace its own, and takes
      // them only for the current script, so after a script edit there is nothing to look for
      let videoLines: CompleteBody["videoLines"];
      const video = project.video;
      if (video && video.scriptVersion === project.scriptVersion && videoLinesVersion(video) < LINES_VERSION) {
        try {
          const found = await director.findLineWindows(workDir, { duration: video.duration, at: video.at }, script, log);
          const lines = toVideoLines(found?.lines);
          const version = versionOf(found?.version);
          if (found && lines && version > videoLinesVersion(video)) {
            videoLines = { videoDuration: found.videoDuration, lines, ...(version > 1 ? { version } : {}) };
            log(`окна реплик ролика найдены в его монтаже${version > 1 ? " по звуку" : ""}: ${lines.length}`);
          } else if (found && lines) log("окна реплик в монтаже ролика найдены так же, как те, что уже на сайте — не отправляю");
        } catch (error) {
          if (controller.signal.aborted) throw error;
          log(`окна реплик ролика не найдены: ${describe(error)}`);
        }
      }
      await site.complete({ ...ids, ...(videoLines ? { videoLines } : {}) }, { signal: controller.signal, patient: true });
      stopBeats();
      log(`готово: реплик ${uploads.length}`);
    } else if (job.task === "montage") {
      const script = project.script;
      if (!script?.lines.length) throw new Error("Сначала нужен сценарий: напишите или вставьте диалог");
      // a claim without a plan comes from a site older than self-dub: the montage runs as it always did
      const plan = claimed.voice ? checkPlan(claimed.voice, script, false) : undefined;
      const workDir = path.join(options.workRoot ?? process.env.STUDIO3D_WORK ?? "/data/work", project.id);
      await fs.mkdir(workDir, { recursive: true });
      const voice: MontageVoice = plan?.ownVoice ? { recordings: await fetchTakes(site, ids, plan, workDir, hooks) } : {};
      const result = await directed(director.makeMontage({ ...spec, script }, workDir, hooks, voice));
      if (!Number.isFinite(result.duration) || result.duration <= 0) throw new Error("Монтаж вернул ролик без длительности");
      hooks.stage("Загружаю ролик на сайт", 99);
      await site.uploadVideo(project.id, job.id, path.resolve(workDir, result.video), { signal: controller.signal });
      const own = plan ? (plan.ownVoice ? { ownVoice: true, dubVersion: plan.dubVersion } : { ownVoice: false }) : {};
      // where every line sits in the video: the dubbing page plays and records exactly these windows
      const windows = videoWindows(result);
      if (result.lines?.length && !windows.lines) log("окна реплик монтажа не по протоколу — ролик уходит без них");
      const finished = await site.complete({ ...ids, video: { duration: result.duration, scriptVersion: project.scriptVersion, ...own, ...windows } }, { signal: controller.signal, patient: true });
      stopBeats();
      markShown(workDir, finished, job.id, log);
      log(`готово: ролик ${result.duration.toFixed(1)} с${plan?.ownVoice ? ", голос владельца — его записи" : ""}`);
    } else if (job.task === "dub") {
      const script = project.script;
      const video = project.video;
      if (!script?.lines.length) throw new Error("Сначала нужен сценарий: напишите или вставьте диалог");
      if (!video) throw new Error("Сначала нужен ролик: соберите его, потом озвучьте поверх своим голосом");
      if (!claimed.voice) throw new Error("Сайт не прислал твои записи — обновите сайт и запустите сборку снова");
      const plan = claimed.voice;
      const takes = checkDubPlan(plan, script, video.duration);
      const workDir = path.join(options.workRoot ?? process.env.STUDIO3D_WORK ?? "/data/work", project.id);
      await fs.mkdir(workDir, { recursive: true });
      const dub: DubRequest = {
        videoDuration: video.duration,
        videoAt: video.at,
        // a re-render put on the site by hand has a new time there: the file size still tells it is this montage
        videoBytes: () => site.videoBytes(project.id, { signal: controller.signal }),
        videoScript: video.scriptVersion === project.scriptVersion ? script : null,
        // the dub reports windows found the way the video's were: the takes over them stay valid for the next dub
        linesVersion: videoLinesVersion(video),
        takes: takes.map(t => ({ index: t.index, text: t.text, sha256: t.sha256, videoStart: t.videoStart!, lineStart: t.lineStart!, lineEnd: t.lineEnd! })),
        // the director looks for the montage's sources first: without them nothing is downloaded
        download: () => fetchTakes(site, ids, plan, workDir, hooks, "Скачиваю твои записи"),
      };
      const result = await directed(director.makeDub(spec, workDir, hooks, dub));
      if (!Number.isFinite(result.duration) || result.duration <= 0) throw new Error("Сборка вернула ролик без длительности");
      hooks.stage("Загружаю ролик", 97);
      await site.uploadVideo(project.id, job.id, path.resolve(workDir, result.video), { signal: controller.signal });
      // the same scene from the same script: the video keeps the script version it was made from
      const made = { duration: result.duration, scriptVersion: video.scriptVersion, ownVoice: true, dubVersion: plan.dubVersion, ...videoWindows(result) };
      const finished = await site.complete({ ...ids, video: made }, { signal: controller.signal, patient: true });
      stopBeats();
      markShown(workDir, finished, job.id, log);
      log(`готово: ролик ${result.duration.toFixed(1)} с с твоим голосом, записей ${takes.length}`);
    } else {
      throw new Error(`Неизвестная задача «${String(job.task)}»`);
    }
  } catch (error) {
    stopBeats();
    if (lost || isJobLost(error)) {
      log("задание больше не наше, на сайт ничего не отправляю");
      // Two renders at once would starve both: give the abandoned one time to stop.
      if (pending) await Promise.race([pending.catch(() => {}), sleep(ABORT_GRACE_MS, undefined, { ref: false })]);
      return;
    }
    const stopped = shutdown?.aborted === true;
    const message = stopped ? STOPPED_MESSAGE : errorText(error, job.task);
    log(`ошибка: ${stopped ? "остановка контейнера" : describe(error)}`);
    // On shutdown there are only seconds left: one short attempt, the stale-job check on the site covers a miss.
    await site.complete({ ...ids, error: message }, stopped ? { timeoutMs: 2000, retry: false } : { patient: true }).catch(failure => {
      log(`сайт не принял ошибку: ${describe(failure)}`);
    });
  } finally {
    stopBeats();
    shutdown?.removeEventListener("abort", onShutdown);
  }
}

/** Polls the site and runs at most one job at a time; stop() aborts the current job and waits briefly for it. */
export function startRunner(options: RunnerOptions = {}) {
  const site = options.site ?? createSite();
  const log = options.log ?? logLine;
  const shutdown = new AbortController();
  let current: Promise<void> | null = null;
  let polling = false;
  let problem = "";

  const poll = async () => {
    if (polling || current || shutdown.signal.aborted) return;
    polling = true;
    try {
      const claimed = await site.claim({ signal: shutdown.signal });
      if (problem) log("сайт снова отвечает");
      problem = "";
      if (claimed) {
        current = runJob(claimed, { ...options, site, log, shutdown: shutdown.signal })
          .catch(error => log(`[${claimed.project.id}] сбой исполнителя: ${describe(error)}`))
          .finally(() => {
            current = null;
          });
      }
    } catch (error) {
      // One line per new problem: a site that is down for an hour must not fill the log every five seconds.
      const text = describe(error);
      if (!shutdown.signal.aborted && text !== problem) log(`опрос сайта не удался: ${text}`);
      problem = text;
    } finally {
      polling = false;
    }
  };

  void poll();
  const timer = setInterval(() => void poll(), options.pollMs ?? 5000);
  return {
    get busy() {
      return current !== null;
    },
    async stop(graceMs = 4000): Promise<void> {
      clearInterval(timer);
      shutdown.abort(new Error("Исполнитель 3Д останавливается"));
      if (current) await Promise.race([current, sleep(graceMs, undefined, { ref: false })]);
    },
  };
}

async function main(): Promise<void> {
  const site = createSite();
  const workRoot = process.env.STUDIO3D_WORK ?? "/data/work";
  let stopping = false;
  let runner: ReturnType<typeof startRunner> | null = null;
  const onSignal = (name: string) => {
    if (stopping) process.exit(1);
    stopping = true;
    logLine(`${name}: останавливаюсь`);
    void (runner ? runner.stop(4000) : Promise.resolve()).finally(() => process.exit(0));
  };
  process.on("SIGTERM", () => onSignal("SIGTERM"));
  process.on("SIGINT", () => onSignal("SIGINT"));
  process.on("unhandledRejection", error => logLine(`необработанная ошибка: ${describe(error)}`));

  if (!(process.env.GUDINI_PASSWORD || process.env.SITE_PASSWORD)) {
    logLine("Не задан GUDINI_PASSWORD (или SITE_PASSWORD): впишите пароль сайта в .env и пересоздайте контейнер.");
    // A slow restart loop instead of a fast one: the log stays readable until the setting is fixed.
    await sleep(10 * 60_000);
    process.exit(1);
  }
  logLine(`Исполнитель 3Д запущен → ${site.url}, рабочая папка ${workRoot}, рендер ${process.env.STUDIO3D_GL || "swangle"} × ${process.env.STUDIO3D_TABS || "авто"}`);
  runner = startRunner({ site, workRoot });
}

const entry = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (entry === fileURLToPath(import.meta.url)) void main();
