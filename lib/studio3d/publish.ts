import fs from "fs";
import path from "path";
import crypto from "crypto";
import type { Cover3D, Meta3D, Project3D } from "./types";
import { projectTitle, type ProjectSummary, type PublishedMark } from "./rules";
import { getProject, mutate, removeProject, Studio3DError, VIDEO_FILE, videoPath } from "./store";
import { dialogueText, regenerateMeta, type MetaDeps } from "./meta";
import { COVER_FILE, coverBusy, coverFile, makeCover3D, type CoverDeps3D } from "./cover";
import { MIRROR_MARK, mirrorOf } from "./links";
import * as site from "../store";
import { publish, tiktokDirectPostEnabled, type PublishMode, type TikTokPostOptions } from "../publish";
import { cancelInstagramSchedule } from "../publicationSchedule";
import { browserTikTokEnabled, readTikTokState, type TikTokJob } from "../tiktok/state";
import { tikTokBrowserRequest } from "../tiktok/client";

/**
 * Publishing a «3Д» video through a hidden main-site project — its "mirror". The main publishing code
 * (TikTok browser worker, YouTube, Instagram Reels, drafts, schedules, trial Reels, cancel, the publications
 * page) works on main projects only, so each 3D project gets one main project that carries its video, cover
 * and caption, and that code runs on it unchanged. The mirror is marked with studio3dId (links.ts): the main
 * projects list hides it and the publications page links its entries to /3d/<id> (both are build-time patches
 * of live shared files, studio3d/deploy/site/patch-live.mjs), and it is always "done", so no montage worker
 * or recovery ever picks it up. A sidecar file in the mirror's folder remembers which 3D video it holds and which video
 * each network got, so a re-copy happens only when the video changed and the page can warn about old posts.
 */

export const PLATFORMS = ["tiktok", "youtube", "instagram"] as const satisfies readonly site.Platform[];
export const isPlatform = (v: unknown): v is site.Platform => typeof v === "string" && (PLATFORMS as readonly string[]).includes(v);

/** The field that marks a mirror in db.json (and hides it from the main projects list). */
export { MIRROR_MARK };
const SIDECAR = "studio3d-mirror.json";

export type MirrorProject = site.Project & { studio3dId?: string };
type MirrorPatch = Partial<site.Project> & { studio3dId?: string };

type Sent = { videoAt: string; at: string };
type Sidecar = {
  studio3dId: string;
  /** The 3D video (Video3D.at and size) now in the mirror's folder. */
  video?: { at: string; size: number } | null;
  cover?: { at: string } | null;
  /** Which 3D video each network was last sent. */
  sent?: Partial<Record<site.Platform, Sent>>;
};

/** Never "running": the montage worker and its orphan recovery only look at running projects. */
const DONE: site.ProcessingState = { state: "done", step: "Готово", progress: 100 };

const isMirrorOf = (p: site.Project | null | undefined, id: string): p is MirrorProject => Boolean(p) && mirrorOf(p) === id;

/**
 * The mirror by its stored id; with scan, also by the mark when the id was lost (the site stopped between the
 * two writes). The scan reads every project with its overlays, so only a call that may create a mirror does it.
 */
function findMirror(id: string, mirrorId: string | null | undefined, scan: boolean): MirrorProject | null {
  if (mirrorId) {
    const m = site.getProject(mirrorId);
    if (isMirrorOf(m, id)) return m;
  }
  return scan ? (site.listProjects().find((m): m is MirrorProject => isMirrorOf(m, id)) ?? null) : null;
}

// ---- one mirror operation at a time per 3D project (a lock of its own: the project lock is taken inside)

const LOCKS = Symbol.for("gudini.studio3d.mirrorLocks");

function withMirrorLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
  const g = globalThis as unknown as Record<symbol, Map<string, Promise<void>> | undefined>;
  const map = (g[LOCKS] ??= new Map());
  const run = (map.get(id) ?? Promise.resolve()).then(fn);
  const tail = run.then(
    () => {},
    () => {},
  );
  map.set(id, tail);
  void tail.then(() => {
    if (map.get(id) === tail) map.delete(id);
  });
  return run;
}

// ---- files

const fileSize = (file: string) => {
  try {
    return fs.statSync(file).size;
  } catch {
    return -1;
  }
};

/** Windows briefly refuses to replace a file that a reader (Instagram's download, the player) still holds. */
async function renameWithRetry(from: string, to: string) {
  for (let i = 0; ; i++) {
    try {
      await fs.promises.rename(from, to);
      return;
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code ?? "";
      if (i >= 20 || !["EPERM", "EBUSY", "EACCES"].includes(code)) throw e;
      await new Promise((r) => setTimeout(r, 25));
    }
  }
}

/**
 * Puts a copy in place atomically: a reader sees the old file or the new one, never half of it. The video is
 * a hard link when the disk allows (same data volume, no second 50 MB); the 3D side only ever replaces its
 * out.mp4 by rename, so the mirror's link keeps the old video until the next sync.
 */
async function placeFile(src: string, dest: string, link: boolean) {
  const tmp = `${dest}.${crypto.randomBytes(4).toString("hex")}.tmp`;
  try {
    if (link) {
      try {
        await fs.promises.link(src, tmp);
      } catch {
        await fs.promises.copyFile(src, tmp);
      }
    } else await fs.promises.copyFile(src, tmp);
    await renameWithRetry(tmp, dest);
  } finally {
    await fs.promises.rm(tmp, { force: true });
  }
}

function readSidecar(dir: string, id: string): Sidecar {
  try {
    const s = JSON.parse(fs.readFileSync(path.join(dir, SIDECAR), "utf8")) as Sidecar;
    if (s && s.studio3dId === id) return s;
  } catch {}
  return { studio3dId: id };
}

async function writeSidecar(dir: string, s: Sidecar) {
  const file = path.join(dir, SIDECAR);
  const tmp = `${file}.${crypto.randomBytes(4).toString("hex")}.tmp`;
  await fs.promises.writeFile(tmp, JSON.stringify(s, null, 2));
  try {
    await renameWithRetry(tmp, file);
  } finally {
    await fs.promises.rm(tmp, { force: true });
  }
}

// ---- the mirror

/** Brings the mirror up to date with the 3D project; makes it first when create. Call under the mirror lock. */
async function syncLocked(id: string, create: boolean): Promise<MirrorProject | null> {
  const p = getProject(id);
  if (!p) throw new Studio3DError("Проект не найден", 404);
  let mirror = findMirror(id, p.mirrorId, create);
  if (!mirror) {
    if (!create) return null;
    if (!p.video) throw new Studio3DError("Сначала смонтируйте видео", 409);
    const made = site.createProject(projectTitle(p));
    // marked before anything else: if the site stops right here, the next call finds this one and the list hides it
    const mark: MirrorPatch = { studio3dId: id, processing: DONE };
    mirror = (site.updateProject(made.id, mark) as MirrorProject | null) ?? { ...made, studio3dId: id };
  }
  const mirrorId = mirror.id;
  const dir = site.projectDir(mirrorId);
  const side = readSidecar(dir, id);

  if (p.video) {
    const src = videoPath(id);
    const size = fileSize(src);
    if (size <= 0) throw new Studio3DError("Файл ролика не найден — смонтируйте видео заново", 409);
    const dest = path.join(dir, VIDEO_FILE);
    // only a changed video is placed again: the same one keeps its file (and the main lead-in cache stays valid)
    if (side.video?.at !== p.video.at || side.video.size !== size || fileSize(dest) !== size) {
      await placeFile(src, dest, true);
      side.video = { at: p.video.at, size };
    }
  }
  const cover = coverFile(p);
  const destCover = path.join(dir, COVER_FILE);
  if (cover && p.cover) {
    if (side.cover?.at !== p.cover.at || fileSize(destCover) !== fileSize(cover)) {
      await placeFile(cover, destCover, false);
      side.cover = { at: p.cover.at };
    }
  } else side.cover = null;
  await writeSidecar(dir, side);

  const patch: MirrorPatch = {
    studio3dId: id,
    topic: projectTitle(p),
    script: dialogueText(p.script) || null,
    rawVideo: null,
    processedVideo: side.video ? VIDEO_FILE : null,
    processing: DONE,
    meta: p.meta ? { title: p.meta.title, description: p.meta.description, hashtags: [...p.meta.hashtags] } : null,
    cover: side.cover ? COVER_FILE : null,
    coverStatus: p.cover?.status,
    coverReason: p.cover?.reason,
  };
  site.updateProject(mirrorId, patch);
  if (p.mirrorId !== mirrorId) {
    await mutate(id, (q) => {
      q.mirrorId = mirrorId;
    });
  }
  return site.getProject(mirrorId) as MirrorProject | null;
}

/**
 * The 3D project's mirror, up to date: the video is placed again only when it changed, the cover and the
 * caption are copied, the mark and the "done" state are kept. One mirror per 3D project, never two.
 * create: false only refreshes an existing mirror (after a montage or an edit) and returns null without one.
 */
export function ensureMirror(id: string, opts: { create?: boolean } = {}): Promise<MirrorProject | null> {
  return withMirrorLock(id, () => syncLocked(id, opts.create !== false));
}

/**
 * After an edit of the caption or the cover. Routes do not wait for it: a publication in progress holds the
 * mirror for minutes (Instagram processing), and the next publication syncs anyway, so a failure only logs.
 */
export async function syncMirror(id: string): Promise<void> {
  await ensureMirror(id, { create: false }).catch((e) => console.warn(`3Д ${id}: зеркало не обновлено:`, (e as Error)?.message ?? e));
}

// ---- what the page gets

/** A publication that reached or is about to reach a network: for these an older video is worth a warning. */
const SENT_STATUSES = new Set<site.Publication["status"]>(["published", "draft", "scheduled", "queued", "running", "needs_login", "unknown"]);

export type AccountsSummary = {
  connected: Record<site.Platform, boolean>;
  /** The active account's name, null when the network is not connected. */
  accounts: Record<site.Platform, string | null>;
  tiktok: { browser: boolean; direct: boolean };
};

/** The same verdicts as the main /api/settings: connected networks and the active account of each. */
export function accountsSummary(): AccountsSummary {
  const s = site.getSettings();
  const browser = browserTikTokEnabled();
  let tik: ReturnType<typeof readTikTokState> | null = null;
  if (browser) {
    try {
      tik = readTikTokState();
    } catch {
      tik = null;
    }
  }
  const active = (platform: site.Platform) => site.listAccounts(platform).find((a) => a.active)?.label || "Аккаунт подключён";
  const connected = {
    youtube: Boolean(s.youtubeTokens),
    tiktok: browser ? Boolean(tik?.connected) : Boolean(s.tiktokTokens),
    instagram: Boolean(s.instagramTokens),
  };
  return {
    connected,
    accounts: {
      youtube: connected.youtube ? active("youtube") : null,
      tiktok: !connected.tiktok ? null : browser ? tik?.accountLabel || "TikTok" : active("tiktok"),
      instagram: connected.instagram ? active("instagram") : null,
    },
    // as the main /api/projects/[id]/tiktok: the browser worker publishes by itself and ignores TIKTOK_DIRECT_POST;
    // only the API way's direct post needs the main TikTok form, which this page does not have
    tiktok: { browser, direct: !browser && tiktokDirectPostEnabled() },
  };
}

export type PublishView = AccountsSummary & {
  mirrorId: string | null;
  /** Video3D.at of the current video. */
  videoAt: string | null;
  /** The cover and caption after a montage are still being made: publishing waits for them. */
  preparing: boolean;
  coverBusy: boolean;
  /** The mirror's publications with the live overlays (TikTok worker jobs, Instagram schedules). */
  publications: site.Publication[];
  sent: Partial<Record<site.Platform, Sent>>;
  /** Networks whose publication carries an older video than the current one. */
  stale: site.Platform[];
  meta: Meta3D | null;
  cover: Cover3D | null;
};

export function publishView(id: string): PublishView {
  const p = getProject(id);
  if (!p) throw new Studio3DError("Проект не найден", 404);
  // the stored id only: this is polled every few seconds and must not scan every project of the site
  const found = p.mirrorId ? site.getProject(p.mirrorId) : null;
  const mirror = isMirrorOf(found, id) ? found : null;
  const sent = mirror ? (readSidecar(path.join(site.UPLOADS_DIR, mirror.id), id).sent ?? {}) : {};
  const publications = mirror?.publications ?? [];
  const videoAt = p.video?.at ?? null;
  const stale = publications
    .filter((pub) => SENT_STATUSES.has(pub.status) && videoAt && sent[pub.platform] && sent[pub.platform]!.videoAt !== videoAt)
    .map((pub) => pub.platform);
  return {
    ...accountsSummary(),
    mirrorId: mirror?.id ?? null,
    videoAt,
    preparing: isPreparing(id),
    coverBusy: coverBusy().has(id),
    publications,
    sent,
    stale,
    meta: p.meta ?? null,
    cover: p.cover ?? null,
  };
}

// ---- the list of sketches

const MARK_STATE: Partial<Record<site.Publication["status"], PublishedMark["state"]>> = {
  published: "published",
  scheduled: "scheduled",
  queued: "sending",
  running: "sending",
  needs_login: "login",
};

/** A queued TikTok job of the mirror with its time still ahead is a schedule, not a send in progress. */
function tikTokScheduled(mirrorId: string, jobs: () => TikTokJob[], now: number): boolean {
  const job = jobs().filter((j) => j.projectId === mirrorId).at(-1);
  return Boolean(job && job.status === "queued" && Date.parse(job.scheduledAt) > now);
}

/**
 * What the list shows beside each sketch: its cover and where its video went. Mirrors are read by their stored
 * id only, like publishView: the list is polled while a job runs and must not scan every project of the site.
 */
export function listMarks(projects: Project3D[], now = Date.now()): Map<string, Pick<ProjectSummary, "cover" | "published">> {
  // the TikTok queue is read once, and only when some sketch has a TikTok send waiting
  let queue: TikTokJob[] | null = null;
  const tikTokJobs = () => (queue ??= readQueueSafe());
  return new Map(
    projects.map((p) => {
      const found = p.mirrorId ? site.getProject(p.mirrorId) : null;
      const published: PublishedMark[] = [];
      for (const pub of isMirrorOf(found, p.id) ? found.publications : []) {
        let state = MARK_STATE[pub.status];
        if (state === "sending" && pub.platform === "tiktok" && tikTokScheduled(found!.id, tikTokJobs, now)) state = "scheduled";
        if (state && isPlatform(pub.platform)) published.push({ platform: pub.platform, state, ...(pub.instagramTrial ? { trial: true } : {}) });
      }
      return [p.id, { cover: coverFile(p) && p.cover ? { at: p.cover.at } : null, published }];
    }),
  );
}

const NETWORK: Record<site.Platform, string> = { tiktok: "TikTok", youtube: "YouTube", instagram: "Instagram" };

const readQueueSafe = (): TikTokJob[] => {
  try {
    return readTikTokState().jobs;
  } catch {
    return [];
  }
};

/**
 * Every send of the mirror still on its way — not only the newest one per network that the overlays show: a
 * TikTok draft made after a schedule, or a schedule on another Instagram account, hides an older pending send.
 * The Instagram schedules are read from their folder (lib/publicationSchedule.ts keeps one job.json per send and
 * exports no list); an unreadable TikTok queue counts as pending, so a delete never loses a send it cannot see.
 */
function pendingSends(mirrorId: string): site.Platform[] {
  const pending = new Set<site.Platform>();
  try {
    if (readTikTokState().jobs.some((j) => j.projectId === mirrorId && ["queued", "running", "needs_login"].includes(j.status))) pending.add("tiktok");
  } catch {
    pending.add("tiktok");
  }
  const schedules = path.join(process.cwd(), "data", "publication-schedule");
  for (const dir of fs.existsSync(schedules) ? fs.readdirSync(schedules) : []) {
    try {
      const job = JSON.parse(fs.readFileSync(path.join(schedules, dir, "job.json"), "utf8")) as { projectId?: string; status?: string };
      if (job.projectId === mirrorId && (job.status === "scheduled" || job.status === "running")) pending.add("instagram");
    } catch {}
  }
  return [...pending];
}

/**
 * Deletes the sketch and its mirror — the copy of the video, the caption and the cover in the main site's folder.
 * What went out stays in the networks and in the publications history. A send still on its way needs the mirror
 * (the TikTok worker's job, the Instagram schedule), so it blocks the delete; a YouTube schedule lives in
 * YouTube Studio and does not.
 */
export async function removeProject3D(id: string): Promise<void> {
  await withMirrorLock(id, async () => {
    const p = getProject(id);
    if (!p) throw new Studio3DError("Проект не найден", 404);
    if (isPreparing(id)) throw new Studio3DError("Готовятся обложка и подпись — удалить можно через пару минут", 409);
    const mirror = findMirror(id, p.mirrorId, true);
    const sending = mirror ? pendingSends(mirror.id) : [];
    if (sending.length) {
      throw new Studio3DError(`Ролик ещё отправляется в ${sending.map((n) => NETWORK[n]).join(" и ")} — дождитесь или отмените отправку на странице скетча`, 409);
    }
    await removeProject(id);
    if (mirror) site.deleteProject(mirror.id);
  });
}

// ---- publishing

export type PublishRequest = {
  platform: site.Platform;
  mode: PublishMode;
  instagramTrial: boolean;
  scheduledAt?: string;
  tiktok?: TikTokPostOptions;
};

/** The same checks as the main publish route (app/api/projects/[id]/publish), with Russian reasons. */
export function checkPublishRequest(body: Record<string, unknown>): PublishRequest {
  const { platform, mode, scheduledAt, instagramTrial, tiktok } = body;
  if (!isPlatform(platform)) throw new Studio3DError("Неизвестная платформа", 400);
  if (mode !== undefined && mode !== "live" && mode !== "draft") throw new Studio3DError("Неизвестный режим публикации", 400);
  if (instagramTrial !== undefined && (typeof instagramTrial !== "boolean" || (instagramTrial && (platform !== "instagram" || mode === "draft")))) {
    throw new Studio3DError("Некорректный пробный режим Instagram", 400);
  }
  if (scheduledAt !== undefined && (typeof scheduledAt !== "string" || !Number.isFinite(Date.parse(scheduledAt)))) {
    throw new Studio3DError("Неверная дата публикации", 400);
  }
  if (tiktok !== undefined && (!tiktok || typeof tiktok !== "object" || Array.isArray(tiktok))) {
    throw new Studio3DError("Некорректные настройки публикации TikTok", 400);
  }
  return {
    platform,
    mode: mode === "draft" ? "draft" : "live",
    instagramTrial: instagramTrial === true,
    ...(typeof scheduledAt === "string" ? { scheduledAt } : {}),
    ...(tiktok ? { tiktok: tiktok as TikTokPostOptions } : {}),
  };
}

/**
 * Publishes the current video through the mirror with the live main publish(): now, as a draft, on schedule,
 * or as a trial Reel — whatever the main code supports, with its own checks and messages.
 */
export async function publish3D(id: string, req: PublishRequest): Promise<{ publication: site.Publication; view: PublishView }> {
  const p = getProject(id);
  if (!p) throw new Studio3DError("Проект не найден", 404);
  if (!p.video) throw new Studio3DError("Сначала смонтируйте видео", 409);
  // the cover and caption made after the montage go out with this publication, not after it
  await waitForPrep(id);
  if (!getProject(id)?.meta) {
    // a generated caption beats the bare title; without the model the title still goes
    await regenerateMeta(id, { onlyIfMissing: true }).catch((e) => console.warn(`3Д ${id}: описание перед публикацией не создано:`, (e as Error)?.message ?? e));
  }
  const publication = await withMirrorLock(id, async () => {
    // under the lock until the end: no sync swaps the video between the copy and the upload
    const mirror = await syncLocked(id, true);
    if (!mirror) throw new Studio3DError("Проект не найден", 404);
    let result: site.Publication;
    try {
      result = await publish(mirror.id, req.platform, {
        instagramTrial: req.instagramTrial,
        mode: req.mode,
        ...(req.tiktok ? { tiktok: req.tiktok } : {}),
        ...(req.scheduledAt ? { scheduledAt: req.scheduledAt } : {}),
      });
    } catch (e) {
      // the main code throws only for a request it refuses (time, mode, a pending send): the owner's to fix
      throw new Studio3DError(String((e as Error)?.message ?? e).slice(0, 500), 400);
    }
    const dir = site.projectDir(mirror.id);
    const side = readSidecar(dir, id);
    if (side.video) {
      side.sent = { ...side.sent, [req.platform]: { videoAt: side.video.at, at: result.at } };
      await writeSidecar(dir, side);
    }
    return result;
  });
  return { publication, view: publishView(id) };
}

/** Cancels a pending send — the same as the main route: Instagram schedules, TikTok worker jobs not yet started. */
export async function cancel3D(id: string, platform: unknown): Promise<PublishView> {
  if (!isPlatform(platform)) throw new Studio3DError("Неизвестная платформа", 400);
  const p = getProject(id);
  if (!p) throw new Studio3DError("Проект не найден", 404);
  if (platform === "youtube") throw new Studio3DError("Отмените расписание в YouTube Studio.", 400);
  const found = p.mirrorId ? site.getProject(p.mirrorId) : null;
  if (!isMirrorOf(found, id)) throw new Studio3DError("Отменять нечего — этот ролик ещё не отправляли", 409);
  try {
    if (platform === "instagram") cancelInstagramSchedule(found.id);
    else {
      const state = (await tikTokBrowserRequest("status")) as { jobs?: { id: string; projectId: string; status: string }[] };
      for (const job of (state.jobs ?? []).filter((j) => j.projectId === found.id && ["queued", "needs_login"].includes(j.status))) {
        await tikTokBrowserRequest("cancel", { id: job.id });
      }
    }
  } catch (e) {
    throw new Studio3DError(String((e as Error)?.message ?? e).slice(0, 500), 400);
  }
  return publishView(id);
}

// ---- after a montage

const PREP = Symbol.for("gudini.studio3d.prep");

function prepRuns(): Map<string, Promise<void>> {
  const g = globalThis as unknown as Record<symbol, Map<string, Promise<void>> | undefined>;
  return (g[PREP] ??= new Map());
}

export const isPreparing = (id: string) => prepRuns().has(id);

/** A publication right after a montage waits for its cover and caption, but not forever. */
async function waitForPrep(id: string, ms = 150_000) {
  const run = prepRuns().get(id);
  if (!run) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([run.catch(() => {}), new Promise((r) => (timer = setTimeout(r, ms)))]);
  clearTimeout(timer);
}

const warn = (id: string, what: string) => (e: unknown) => console.warn(`3Д ${id}: ${what}:`, (e as Error)?.message ?? e);

/**
 * After a successful montage, in the background: the caption and the cover, if the project has none yet
 * (a new montage keeps the ones the owner already has), then the existing mirror gets the new video.
 * One run per project at a time; a second call joins the running one. Each step looks at the project afresh:
 * the caption call takes seconds, and a cover the owner drew meanwhile must not be paid for twice.
 */
export function afterMontage(id: string, deps: { meta?: Partial<MetaDeps>; cover?: Partial<CoverDeps3D> } = {}): Promise<void> {
  const runs = prepRuns();
  const running = runs.get(id);
  if (running) return running;
  const run: Promise<void> = (async () => {
    if (!getProject(id)?.video) return;
    if (!getProject(id)?.meta) await regenerateMeta(id, { onlyIfMissing: true }, deps.meta).catch(warn(id, "описание после монтажа не создано"));
    // makeCover3D checks again once it holds the project's cover slot, right before anything is paid
    if (!getProject(id)?.cover) await makeCover3D(id, { onlyIfMissing: true }, deps.cover).catch(warn(id, "обложка после монтажа не создана"));
    // a first mirror is made by the first publication; an existing one gets the new video now
    await ensureMirror(id, { create: false }).catch(warn(id, "зеркало после монтажа не обновлено"));
  })().finally(() => {
    if (runs.get(id) === run) runs.delete(id);
  });
  runs.set(id, run);
  return run;
}
