import fs from "fs";
import http from "http";
import https from "https";
import path from "path";
import { execFile } from "child_process";
import type { Cover3D, Project3D } from "./types";
import { getProject, mutate, projectDir, Studio3DError, videoPath } from "./store";
import { dialogueText, siteSpend } from "./meta";
import { projectTitle } from "./rules";
import { generateCoverConcept, type CoverConcept } from "../cover";
import { resolveHeadline } from "../coverHeadline";
import { encodeFinalCover, finishCoverImage, fullAiCoverEnabled } from "../coverProvider";
import { ffmpegBin } from "../ffmpeg";

/**
 * Cover of a «3Д» video, in the look of the main videos' covers but in the 3D style: a frame of the video
 * goes to GPT through the site's image bridge (the owner's choice, 2026-10-27) as the reference instead of the
 * owner's photo, and comes back redrawn as a toy-render poster of both heroes with a big headline. The headline
 * comes from the main concept writer and passes the same preflight gate, so a weak headline never costs an image.
 * One image per action, no automatic retries — like the main covers.
 */

export const COVER_FILE = "cover.jpg";
export const PREV_COVER_FILE = "cover-prev.jpg";
const WORK_DIR = "cover-work";
export const HEADLINE_MAX = 60;

// ---- the frame

const PROBE_W = 54;
const PROBE_H = 96;
/** Where to look for both heroes: 35% first (past the hook, before the punchline), then around it. */
export const FRAME_POINTS = [0.35, 0.3, 0.45, 0.6, 0.75];
/** Below this share of the frame a hero is not really in the shot (an edge of a leg, a reflection). */
const SEEN = 0.015;

export type FrameScore = { at: number; claude: number; owner: number };

/**
 * Share of Claude's orange and of the owner's skin and blond hair in a small RGB frame. Thresholds are measured
 * on real renders: Claude's #d97757 stays more saturated than the owner's skin under any of the scene lights.
 */
export function scoreFrame(rgb: Uint8Array): { claude: number; owner: number } {
  const n = Math.floor(rgb.length / 3);
  if (!n) return { claude: 0, owner: 0 };
  let claude = 0;
  let owner = 0;
  for (let i = 0; i < n; i++) {
    const r = rgb[i * 3] / 255;
    const g = rgb[i * 3 + 1] / 255;
    const b = rgb[i * 3 + 2] / 255;
    const max = Math.max(r, g, b);
    const d = max - Math.min(r, g, b);
    const s = max ? d / max : 0;
    let h = 0;
    if (d) h = max === r ? 60 * (((g - b) / d) % 6) : max === g ? 60 * ((b - r) / d + 2) : 60 * ((r - g) / d + 4);
    if (h < 0) h += 360;
    if (h >= 4 && h <= 20 && s >= 0.56 && max >= 0.35) claude++;
    else if (h > 24 && h <= 48 && s >= 0.12 && s <= 0.5 && max >= 0.5) owner++;
  }
  return { claude: claude / n, owner: owner / n };
}

/** The frame where the less visible hero is seen best; 35% when no candidate shows both. */
export function pickFrame(scores: FrameScore[], duration: number): number {
  const both = (s: FrameScore) => Math.min(s.claude, s.owner);
  let best: FrameScore | null = null;
  for (const s of scores) if (both(s) >= SEEN && (!best || both(s) > both(best))) best = s;
  return best ? best.at : Math.max(0, duration) * FRAME_POINTS[0];
}

function ffmpeg(args: string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    execFile(ffmpegBin(), args, { encoding: "buffer", maxBuffer: 32 * 1024 * 1024, timeout: 60_000, windowsHide: true }, (err, stdout, stderr) => {
      if (err) reject(new Error(`ffmpeg: ${String(stderr || err.message).slice(-300)}`));
      else resolve(stdout);
    });
  });
}

/** A few tiny frames are scored (cheap), the chosen one is taken at full size as the image model's reference. */
export async function grabFrame(video: string, workDir: string, duration: number): Promise<{ file: string; at: number }> {
  const scores: FrameScore[] = [];
  for (const point of FRAME_POINTS) {
    const at = Math.round(Math.max(0, duration) * point * 100) / 100;
    try {
      const raw = await ffmpeg(["-v", "error", "-ss", String(at), "-i", video, "-frames:v", "1", "-vf", `scale=${PROBE_W}:${PROBE_H}`, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]);
      scores.push({ at, ...scoreFrame(raw) });
    } catch {
      // a timestamp that does not decode is simply not a candidate
    }
  }
  const at = pickFrame(scores, duration);
  const file = path.join(workDir, "frame.jpg");
  await ffmpeg(["-v", "error", "-y", "-ss", String(at), "-i", video, "-frames:v", "1", "-q:v", "2", file]);
  return { file, at };
}

// ---- the prompt

/** The concept writer is made for photo covers; this tells it what the video is, so the headline fits a sketch. */
const STYLE_HINT =
  "это 3D-скетч, а не фото: воксельный двойник автора и оранжевый кубик-маскот Клод разговаривают о крипте. " +
  "Заголовок — суть их разговора, понятная без ролика.";

/** The cast as cast.json draws them: the frame gives the style and the set, this keeps both heroes on model. */
const CAST =
  "Exactly two characters, both clearly visible and large in frame: " +
  "(1) a blocky voxel man built from cubes — platinum-blond stepped voxel crop haircut, light stubble, warm tan skin, " +
  "a white baseball jersey with thin navy pinstripes and the word YORK on the chest, a thin gold chain, black trousers; " +
  "(2) Claude — a small orange (#d97757) cube mascot with a simple pixel face (two rectangular eyes and a small mouth), " +
  "short blocky arms and four stubby legs, no clothes. No other people, animals or mascots.";

/** One prompt for one image, sectioned like the main buildFullCoverPrompt but for a 3D toy render instead of a photo. */
export function buildCover3DPrompt(concept: CoverConcept): string {
  const headline = concept.headlineLines.map((l) => l.text).join("\n");
  const reference =
    "The attached image is a frame from our 3D animated sketch. Use it as the reference for both characters' designs, " +
    "colors and materials and for the set and the lighting mood. Ignore any subtitles, captions or interface text in " +
    "the frame and never copy them.";
  const style =
    "Redraw it as a vivid premium stylized 3D toy render: voxel and clay toy look, soft studio key light with a warm rim " +
    "light, saturated colors, gentle depth of field, clean shapes, like key art for an animated short. " +
    "Not photorealistic and not a flat illustration.";
  const composition =
    "Vertical 9:16 viral cover. The two characters fill the upper 60% of the frame, close together, facing each other " +
    "or the viewer and acting out the story with a clear readable emotion" +
    (concept.emotion ? ` (${concept.emotion})` : "") +
    "; the voxel man is slightly larger. One simple uncluttered background taken from the frame's set, slightly out of focus.";
  const typography =
    "Create the complete final cover including professionally designed Russian typography as an integral part of the " +
    "composition, not a generic overlay. Extremely bold condensed Cyrillic display letters, huge and readable at " +
    "thumbnail size, tight line spacing and strong hierarchy; white, warm yellow and black as the typography palette, " +
    "a yellow box with black letters is allowed for the key word. The headline block sits in the lower part of the " +
    "frame and may overlap the characters' feet, never their faces.";
  const exactText =
    `The ONLY readable text allowed in the image is:\n"${headline}"\nplus the word YORK printed on the jersey. ` +
    "Render these exact Russian words correctly; the line breaks may change, the words may not: do not replace, add, " +
    "translate or misspell anything. No other words, letters, numbers, logos, captions, badges, watermarks, interface " +
    "elements or pseudo-text anywhere in the image.";
  const negatives =
    "Strictly not: photorealistic people, realistic human skin, anime, flat vector art, comic panels, extra characters, " +
    "extra or missing limbs, duplicated characters, a busy background, neon glow, floating particles, fake HUD.";
  return [reference, CAST, style, composition, typography, exactText, negatives].join(" ");
}

// ---- the image

/** The image bridge the carousels and memes draw through (scripts/codex-image-bridge.ts, port 43129). */
const imageBridgeUrl = () => process.env.CODEX_IMAGE_BRIDGE_URL || process.env.CODEX_BRIDGE_URL || "";
/** The bridge keeps one queue for every picture of the site; past this a hung run would hold the cover slot. */
const BRIDGE_TIMEOUT = 1_850_000;

/**
 * GPT on the ChatGPT subscription draws the cover from the prompt with the video frame attached. node:http, not
 * fetch: the bridge answers only when the picture is ready, and fetch gives up waiting for headers after 5 minutes.
 */
export async function generateFromFrame(prompt: string, frameFile: string, outFile: string): Promise<{ cost: number }> {
  const base = imageBridgeUrl();
  const token = process.env.CODEX_BRIDGE_TOKEN;
  if (!base || !token) throw new Error("NO_IMAGE_BRIDGE");
  const frame = (await fs.promises.readFile(frameFile)).toString("base64");
  const body = JSON.stringify({ prompt, aspectRatio: "9:16", mode: "generate", references: [`data:image/jpeg;base64,${frame}`] });
  const url = new URL("/image", base);
  const answer = await new Promise<{ status: number; text: string }>((resolve, reject) => {
    const req = (url.protocol === "https:" ? https : http).request(
      url,
      {
        method: "POST",
        timeout: BRIDGE_TIMEOUT,
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body), Authorization: `Bearer ${token}` },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString("utf8") }));
        res.on("error", reject);
      },
    );
    req.on("timeout", () => req.destroy(new Error("IMAGE_PROVIDER_ERROR: GPT не ответил за 30 минут")));
    req.on("error", reject);
    req.end(body);
  });
  let json: { base64?: unknown; error?: unknown } = {};
  try {
    json = JSON.parse(answer.text);
  } catch {
    // the status below says what went wrong
  }
  if (answer.status !== 200 || typeof json.base64 !== "string" || !json.base64) {
    throw new Error(`IMAGE_PROVIDER_ERROR: ${answer.status} ${String(json.error ?? "картинка не вернулась").slice(0, 200)}`);
  }
  await fs.promises.writeFile(outFile, Buffer.from(json.base64, "base64"));
  return { cost: 0 };
}

// ---- the action

export type CoverDeps3D = {
  grabFrame: (video: string, workDir: string, duration: number) => Promise<{ file: string; at: number }>;
  concept: (topic: string, script: string, title: string, strictNote: string | null) => Promise<CoverConcept | null>;
  generateImage: (prompt: string, frameFile: string, outFile: string) => Promise<{ cost: number }>;
  finish: (dir: string, source: string, out: string) => Promise<string>;
  encodeFinal: (dir: string, base: string, out: string) => Promise<string>;
  /** Wraps the paid part so it lands in the spend log (meta.ts siteSpend); tests run it bare. */
  spend: <T>(id: string, topic: string, fn: () => Promise<T>) => Promise<T>;
  /** Why a cover cannot be drawn at all (switched off, no key) — checked before the first paid call. */
  blocked: () => string | null;
};

const liveDeps: CoverDeps3D = {
  grabFrame,
  concept: (topic, script, title, strictNote) => generateCoverConcept(topic, script, title, strictNote, STYLE_HINT),
  generateImage: generateFromFrame,
  finish: finishCoverImage,
  encodeFinal: encodeFinalCover,
  spend: (_id, topic, fn) => siteSpend(topic, "Обложка (3Д)", fn),
  blocked: () =>
    !fullAiCoverEnabled()
      ? "обложки выключены настройкой FULL_AI_COVER=false"
      : !imageBridgeUrl() || !process.env.CODEX_BRIDGE_TOKEN
        ? "не настроен мост картинок GPT (CODEX_IMAGE_BRIDGE_URL)"
        : null,
};

/** Covers being drawn, shared by the automatic one after a montage and the owner's button: one per project. */
const BUSY = Symbol.for("gudini.studio3d.coverBusy");
export function coverBusy(): Set<string> {
  const g = globalThis as unknown as Record<symbol, Set<string> | undefined>;
  return (g[BUSY] ??= new Set());
}

export function checkHeadline(raw: unknown): string | undefined {
  if (raw === undefined || raw === null || raw === "") return undefined;
  if (typeof raw !== "string") throw new Studio3DError("Заголовок должен быть строкой", 400);
  const headline = raw.replace(/\s+/g, " ").trim();
  if (!headline) return undefined;
  if (headline.length > HEADLINE_MAX) throw new Studio3DError(`Заголовок обложки — не длиннее ${HEADLINE_MAX} знаков`, 400);
  return headline;
}

function reasonOf(e: unknown): string {
  const m = String((e as Error)?.message ?? e);
  if (m.includes("NO_IMAGE_BRIDGE")) return "не настроен мост картинок GPT (CODEX_IMAGE_BRIDGE_URL)";
  if (m.includes("ECONNREFUSED") || m.includes("ECONNRESET")) return "мост картинок GPT не отвечает (127.0.0.1:43129)";
  if (m.startsWith("IMAGE_PROVIDER_ERROR")) return `GPT ответил ошибкой (${m.replace(/^IMAGE_PROVIDER_ERROR:\s*/, "").slice(0, 160)})`;
  return m.slice(0, 200);
}

/** Windows briefly refuses to replace a file that a reader (the cover route) still holds. */
async function replaceFile(from: string, to: string) {
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

type Outcome = { status: Cover3D["status"]; reason?: string; headline?: string };

export type CoverResult = {
  project: Project3D;
  ok: boolean;
  /** The new one failed and the previous cover stayed in place. */
  kept?: boolean;
  /** onlyIfMissing found a cover already there: nothing was drawn or paid. */
  skipped?: boolean;
  error?: string;
};

/**
 * Draws a new cover: one paid image. On failure the previous cover is restored (cover-prev.jpg) and stays,
 * like the main cover route; without a previous one the failure and its reason are stored for the page.
 * onlyIfMissing (the automatic cover after a montage) draws nothing when the project already has a cover:
 * checked while holding the project's cover slot, so a cover the owner drew a moment ago is never paid twice.
 */
export async function makeCover3D(
  id: string,
  opts: { headline?: string; onlyIfMissing?: boolean } = {},
  deps: Partial<CoverDeps3D> = {},
): Promise<CoverResult> {
  const p = getProject(id);
  if (!p) throw new Studio3DError("Проект не найден", 404);
  if (!p.video) throw new Studio3DError("Сначала смонтируйте видео", 409);
  const script = dialogueText(p.script);
  if (!script) throw new Studio3DError("Сначала нужен сценарий", 409);
  const busy = coverBusy();
  if (busy.has(id)) throw new Studio3DError("Обложка уже создаётся — подождите минуту", 409);
  busy.add(id);
  try {
    // p was read just above with nothing awaited since, so it is the state under the slot
    if (opts.onlyIfMissing && p.cover) return { project: p, ok: p.cover.status === "ok", skipped: true };
    const d: CoverDeps3D = { ...liveDeps, ...deps };
    const video = p.video;
    const dir = projectDir(id);
    const work = path.join(dir, WORK_DIR);
    await fs.promises.mkdir(work, { recursive: true });
    const coverFile = path.join(dir, COVER_FILE);
    const prevFile = path.join(dir, PREV_COVER_FILE);
    const hadCover = p.cover?.status === "ok" && fs.existsSync(coverFile);
    if (hadCover) await fs.promises.copyFile(coverFile, prevFile);
    const override = opts.headline?.trim() || undefined;
    const title = p.script?.title || p.topic;

    const draw = async (): Promise<Outcome> => {
      const frame = await d.grabFrame(videoPath(id), work, video.duration);
      // the same text-only gate as the main covers: a headline that lost the topic never costs an image
      const resolved = await resolveHeadline(
        async (_attempt, strictNote) => {
          const concept = await d.concept(p.topic, script, title, strictNote);
          if (concept && override) concept.headlineCandidates = [override];
          return concept;
        },
        work,
        { ignoreAnchor: Boolean(override) },
      );
      if (!resolved.concept) return { status: "failed", reason: "не удалось придумать заголовок — попробуйте ещё раз" };
      const headline = resolved.concept.headlineLines.map((l) => l.text).join(" ");
      if (!resolved.ok) return { status: "headline_failed", reason: "заголовок потерял тему ролика — картинка не заказывалась", headline };
      const prompt = buildCover3DPrompt(resolved.concept);
      await fs.promises.writeFile(path.join(work, "cover-prompt.txt"), prompt, "utf8");
      const raw = path.join(work, "cover-attempt.png");
      await d.generateImage(prompt, frame.file, raw);
      const finished = await d.finish(work, raw, path.join(work, "cover-final.png"));
      const out = path.join(work, COVER_FILE);
      await d.encodeFinal(work, finished, out);
      if (!((await fs.promises.stat(out)).size > 0)) throw new Error("обложка получилась пустой");
      await replaceFile(out, coverFile);
      return { status: "ok", headline };
    };

    const blocked = d.blocked();
    const outcome: Outcome = blocked
      ? { status: "failed", reason: blocked }
      : await d.spend(id, projectTitle(p), draw).catch((e): Outcome => ({ status: "failed", reason: reasonOf(e) }));
    const at = new Date().toISOString();

    if (outcome.status === "ok") {
      await fs.promises.rm(prevFile, { force: true });
      const { project } = await mutate(id, (q) => {
        q.cover = { file: COVER_FILE, at, status: "ok", ...(outcome.headline ? { headline: outcome.headline } : {}), videoAt: video.at };
        q.updatedAt = at;
      });
      return { project, ok: true };
    }
    const reason = outcome.reason ?? "обложка не получилась";
    if (hadCover) {
      // the money for the previous one is spent: it stays the cover
      await fs.promises.copyFile(prevFile, coverFile);
      await fs.promises.rm(prevFile, { force: true });
      return { project: getProject(id) ?? p, ok: false, kept: true, error: `Новую обложку создать не удалось: ${reason} — оставлена прежняя` };
    }
    const { project } = await mutate(id, (q) => {
      q.cover = { file: COVER_FILE, at, status: outcome.status, reason, ...(outcome.headline ? { headline: outcome.headline } : {}), videoAt: video.at };
      q.updatedAt = at;
    });
    return { project, ok: false, error: `Обложку создать не удалось: ${reason}` };
  } finally {
    busy.delete(id);
  }
}

/** The stored cover file, only when the cover is a good one (a failed attempt leaves no picture). */
export function coverFile(p: Project3D): string | null {
  if (p.cover?.status !== "ok") return null;
  const file = path.join(projectDir(p.id), COVER_FILE);
  return fs.existsSync(file) ? file : null;
}
