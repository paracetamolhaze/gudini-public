import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import type { AstraInput } from "../src/input";

/**
 * The workspace code bundled for rendering. The public folder (the recording, its frames, pictures, sounds) is linked
 * into the bundle rather than copied where the system allows links: it is hundreds of megabytes.
 */
export function bundleJob(workspace: string, publicDir: string): Promise<string> {
  return bundle({ entryPoint: path.join(workspace, "src/index.ts"), publicDir, symlinkPublicDir: process.platform !== "win32" });
}

let memoryTemp: { dir: string; before: string | undefined; users: number } | null = null;

/**
 * Runs `work` with the temporary folder in memory. Chrome's profile and HTTP cache, the bundle and Remotion's audio
 * mixing churn through it on every frame; on the Docker disk the render stood waiting for it: 1.6 frames/s against
 * 15 with the folder in /dev/shm (2026-10-20, 300 frames of Waymo). Calls that overlap share one folder; the last one
 * out removes it. Without /dev/shm (Windows) nothing changes.
 */
export async function withMemoryTemp<T>(work: () => Promise<T>): Promise<T> {
  if (!memoryTemp) {
    if (!fs.existsSync("/dev/shm")) return work();
    memoryTemp = { dir: fs.mkdtempSync("/dev/shm/render-tmp-"), before: process.env.TMPDIR, users: 0 };
    process.env.TMPDIR = memoryTemp.dir;
  }
  const held = memoryTemp;
  held.users++;
  try {
    return await work();
  } finally {
    if (--held.users === 0) {
      if (held.before === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = held.before;
      fs.rmSync(held.dir, { recursive: true, force: true });
      memoryTemp = null;
    }
  }
}

/** Bundles a workspace and renders it to MP4. `scale` below 1 gives a fast draft. */
export function renderVideo(opts: {
  workspace: string;
  publicDir: string;
  input: AstraInput;
  out: string;
  scale?: number;
  onProgress?: (fraction: number) => void;
}): Promise<void> {
  return withMemoryTemp(() => renderInTemp(opts));
}

async function renderInTemp(opts: Parameters<typeof renderVideo>[0]): Promise<void> {
  const serveUrl = await bundleJob(opts.workspace, opts.publicDir);
  try {
  const inputProps = opts.input as unknown as Record<string, unknown>;
  const composition = await selectComposition({ serveUrl, id: "Astra", inputProps });
  const render = (concurrency: number) => renderMedia({
    serveUrl, composition, inputProps, outputLocation: opts.out,
    codec: "h264", crf: opts.scale && opts.scale < 1 ? 26 : 18, pixelFormat: "yuv420p",
    audioCodec: "aac", audioBitrate: "192k",
    concurrency,
    // A heavy frame on a busy machine may take longer than the default 30 s; a stuck one is still caught.
    timeoutInMilliseconds: 90_000,
    scale: opts.scale ?? 1,
    onProgress: ({ progress }) => opts.onProgress?.(progress),
  });
  const tabs = Math.max(2, Math.floor(os.cpus().length / 2));
  try {
    await render(tabs);
  } catch (error) {
    // A render that stalled is tried once more with half the tabs: less contention, the same video.
    console.error(`Рендер не прошёл (${String((error as Error)?.message ?? error).slice(0, 160)}), повтор с ${Math.max(1, Math.floor(tabs / 2))} вкладками`);
    await render(Math.max(1, Math.floor(tabs / 2)));
  }
  } finally {
    // A bundle carries a copy of the job's public folder (the video, pictures, sounds): hundreds of MB.
    fs.rmSync(serveUrl, { recursive: true, force: true });
  }
  masterAudio(opts.out);
}

/** A voice at TikTok loudness plus effects can sum above 0 dB: a soft limiter keeps peaks under -1 dB. The picture is copied as is. */
export function masterAudio(file: string) {
  const temp = `${file}.master.mp4`;
  execFileSync("ffmpeg", ["-hide_banner", "-v", "error", "-y", "-i", file, "-c:v", "copy",
    "-af", "alimiter=limit=0.891:attack=5:release=60:level=false", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", temp], { stdio: "pipe" });
  fs.renameSync(temp, file);
}
