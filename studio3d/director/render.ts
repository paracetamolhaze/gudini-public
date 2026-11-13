import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { bundle } from "@remotion/bundler";
import { makeCancelSignal, renderMedia, renderStill, selectComposition, type ChromiumOptions } from "@remotion/renderer";
import { ENGINE_ROOT } from "./cast";
import { prepareWorkspace, removeWorkspace } from "./workspace";

const run = promisify(execFile);

/**
 * In the Docker container Chrome has no GPU, and software WebGL (SwiftShader, "swangle") is the only backend that
 * creates a WebGL context there: 4.4 frames/s with 4 tabs at dpr 0.75 (2026-10-21). On the owner's PC the runner
 * starts natively with STUDIO3D_GL=angle: Direct3D on the RTX 3060 Ti gave 10.2 frames/s with 2 tabs against 1.3 on
 * the CPU, the same picture to under 1/255, while the card stayed mostly free (2026-10-22).
 */
const GL_BACKENDS = ["swangle", "angle", "angle-egl", "egl", "swiftshader", "vulkan"] as const;
const glOf = (value: string | undefined): ChromiumOptions["gl"] => {
  if (!value) return "swangle";
  if (!(GL_BACKENDS as readonly string[]).includes(value)) throw new Error(`STUDIO3D_GL=${value}: известны ${GL_BACKENDS.join(", ")}`);
  return value as ChromiumOptions["gl"];
};
const chromiumOptions: ChromiumOptions = { gl: glOf(process.env.STUDIO3D_GL) };
/** A graphics card draws the 3D layer at full size with depth of field and glow; software WebGL keeps 0.75 and no passes. */
const GPU = ["angle", "angle-egl", "egl", "vulkan"].includes(String(chromiumOptions.gl));
export const DEFAULT_DPR = Number(process.env.STUDIO3D_DPR || (GPU ? 1 : 0.75));
export const DEFAULT_POST = process.env.STUDIO3D_POST ? process.env.STUDIO3D_POST === "1" : GPU;
/** The room's sounds under the voices: on since the owner heard them (2026-10-23: «звуки норм»); STUDIO3D_SFX=0 turns them off. */
export const DEFAULT_SFX = process.env.STUDIO3D_SFX !== "0";
/** The look is the machine's: a re-render or a dub of an old montage gets this machine's size and passes. */
const withLook = (input: Record<string, unknown>) => ({ ...input, dpr: DEFAULT_DPR, post: DEFAULT_POST, sfx: DEFAULT_SFX });
const TABS = Number(process.env.STUDIO3D_TABS || Math.min(4, Math.max(2, Math.floor(os.cpus().length / 3))));

let memoryTemp: { dir: string; before: string | undefined; users: number } | null = null;

/** Chrome's profile and Remotion's audio mixing churn through TMPDIR every frame: keep it in memory when possible. */
export async function withMemoryTemp<T>(work: () => Promise<T>): Promise<T> {
  if (!memoryTemp) {
    if (!fs.existsSync("/dev/shm")) return work();
    memoryTemp = { dir: fs.mkdtempSync("/dev/shm/studio3d-tmp-"), before: process.env.TMPDIR, users: 0 };
    process.env.TMPDIR = memoryTemp.dir;
  }
  const held = memoryTemp;
  held.users++;
  try {
    return await work();
  } finally {
    if (--held.users === 0) {
      if (held.before === undefined) delete process.env.TMPDIR;
      else process.env.TMPDIR = held.before;
      fs.rmSync(held.dir, { recursive: true, force: true });
      memoryTemp = null;
    }
  }
}

/**
 * Bundles a workspace into `outDir` (the caller removes it). No webpack cache: its key includes the workspace
 * path, so every project wrote ~270 MB that no other project ever reused.
 */
export const bundleWorkspace = (workspace: string, publicDir: string, outDir: string) =>
  bundle({ entryPoint: path.join(workspace, "src/index.ts"), publicDir, outDir, enableCaching: false, symlinkPublicDir: process.platform !== "win32" });

/** Draft stills at the given seconds, half size JPEG, for Claude to look at. */
export async function renderStills(serveUrl: string, look: Record<string, unknown>, seconds: number[], outDir: string, signal?: AbortSignal): Promise<string[]> {
  // stills are silent: the draft folder has no sounds, and Claude looks at the picture only
  const input = { ...withLook(look), sfx: false };
  return withMemoryTemp(async () => {
    const composition = await selectComposition({ serveUrl, id: "Sketch3D", inputProps: input, chromiumOptions, timeoutInMilliseconds: 120_000 });
    fs.mkdirSync(outDir, { recursive: true });
    const files: string[] = [];
    for (const s of seconds) {
      signal?.throwIfAborted();
      const frame = Math.max(0, Math.min(composition.durationInFrames - 1, Math.round(s * composition.fps)));
      const output = path.join(outDir, `still-${String(frame).padStart(5, "0")}.jpg`);
      await renderStill({ serveUrl, composition, frame, output, imageFormat: "jpeg", jpegQuality: 80, scale: 0.5, inputProps: input, chromiumOptions, timeoutInMilliseconds: 120_000 });
      files.push(output);
    }
    return files;
  });
}

/** The final video: H.264 at 30 fps with the voice from Remotion, then the loudness set once. */
export async function renderFinal(
  serveUrl: string,
  look: Record<string, unknown>,
  out: string,
  onProgress: (fraction: number) => void,
  signal: AbortSignal,
): Promise<void> {
  const input = withLook(look);
  const raw = `${out}.raw.mp4`;
  await withMemoryTemp(async () => {
    const composition = await selectComposition({ serveUrl, id: "Sketch3D", inputProps: input, chromiumOptions, timeoutInMilliseconds: 120_000 });
    const { cancelSignal, cancel } = makeCancelSignal();
    signal.addEventListener("abort", () => cancel(), { once: true });
    // an abort that came while bundling would never fire the listener again
    signal.throwIfAborted();
    const attempt = (tabs: number) =>
      renderMedia({
        serveUrl,
        composition,
        codec: "h264",
        crf: 18,
        pixelFormat: "yuv420p",
        audioCodec: "aac",
        audioBitrate: "192k",
        outputLocation: raw,
        inputProps: input,
        chromiumOptions,
        concurrency: tabs,
        timeoutInMilliseconds: 120_000,
        cancelSignal,
        onProgress: ({ progress }) => onProgress(progress),
      });
    try {
      await attempt(TABS);
    } catch (error) {
      if (signal.aborted) throw error;
      // a tab that hung on one frame: once more with fewer tabs before giving up. Said in the log: a silent second
      // render doubled a montage's time unnoticed (2026-10-23, «Бот только в плюс»)
      const fewer = Math.max(1, Math.floor(TABS / 2));
      console.warn(`рендер с ${TABS} вкладками не удался, ещё раз с ${fewer}: ${String((error as Error)?.message ?? error).slice(0, 500)}`);
      await attempt(fewer);
    }
  });
  await run("ffmpeg", ["-v", "error", "-y", "-i", raw, "-c:v", "copy", "-af", "loudnorm=I=-14:TP=-1.5:LRA=11", "-ar", "48000", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", out], {
    timeout: 300_000,
  });
  fs.rmSync(raw, { force: true });
}

/**
 * A scene rendered to `out` with the voice and fonts of publicDir: the montage's final render, a re-render of a
 * finished montage, and a dub (the same scene with the owner's voice). Its workspace and bundle are removed after.
 */
export async function renderScene(
  code: string,
  input: Record<string, unknown>,
  publicDir: string,
  out: string,
  name: string,
  onProgress: (fraction: number) => void,
  signal: AbortSignal,
): Promise<void> {
  const ws = prepareWorkspace(code, name);
  // older montages have no sounds in their public folder
  fs.cpSync(path.join(ENGINE_ROOT, "public/sfx"), path.join(publicDir, "sfx"), { recursive: true });
  const bundleDir = path.join(path.dirname(out), `bundle-${path.basename(out, path.extname(out))}`);
  try {
    const serveUrl = await bundleWorkspace(ws, publicDir, bundleDir);
    await renderFinal(serveUrl, input, out, onProgress, signal);
  } finally {
    removeWorkspace(ws);
    fs.rmSync(bundleDir, { recursive: true, force: true });
  }
}
