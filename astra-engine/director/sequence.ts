import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AstraInput } from "../src/input";

export type AuthorFrames = NonNullable<AstraInput["frames"]>;

// The blurred copy behind a moved author, the same as the CSS `blur(36px) brightness(0.55) saturate(1.2)` it replaces:
// blur(36px) on 1080 px wide is sigma 9 on a quarter-size frame; brightness and saturate are one RGB matrix
// (the 0.55 scale times the feColorMatrix "saturate" 1.2), computed on the same gamma-encoded values the browser uses.
const BLUR = "scale=270:480,gblur=sigma=9,format=gbrp," +
  "colorchannelmixer=rr=0.6366:rg=-0.0787:rb=-0.0079:gr=-0.0234:gg=0.5814:gb=-0.0079:br=-0.0234:bg=-0.0787:bb=0.6521";

function ffmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", ["-hide_banner", "-v", "error", "-y", ...args], { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", chunk => { stderr = (stderr + String(chunk)).slice(-2000); });
    child.on("error", reject);
    child.on("close", code => (code === 0 ? resolve() : reject(new Error(`ffmpeg: ${stderr.trim() || `code ${code}`}`))));
  });
}

/**
 * The recording as JPEG frames, sharp and blurred, for the final render. A video is decoded in one render tab
 * for every tab, which caps the render at a few frames per second; frames are loaded by each tab itself.
 * Several FFmpeg processes cut their own stretch at once; the whole minute-long video takes about a quarter of a minute.
 */
export async function extractFrames(opts: { video: string; publicDir: string; subdir: string; duration: number; fps?: number }): Promise<AuthorFrames> {
  const fps = opts.fps ?? 30;
  const author = `${opts.subdir}/author`, blur = `${opts.subdir}/blur`;
  for (const dir of [author, blur]) {
    fs.rmSync(path.join(opts.publicDir, dir), { recursive: true, force: true });
    fs.mkdirSync(path.join(opts.publicDir, dir), { recursive: true });
  }
  const total = Math.max(1, Math.round(opts.duration * fps));
  const parts = Math.max(1, Math.min(4, Math.floor(os.cpus().length / 3)));
  const per = Math.ceil(total / parts);
  await Promise.all(Array.from({ length: parts }, (_, i) => {
    const first = i * per, count = Math.min(per, total - first);
    if (count <= 0) return Promise.resolve();
    return ffmpeg([
      "-ss", (first / fps).toFixed(4), "-i", opts.video,
      // An uncut recording can come at another size (4K); frames are always the 1080x1920 montage frame.
      "-filter_complex", `[0:v]fps=${fps},scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,split=2[sharp][soft];[soft]${BLUR}[blurred]`,
      "-map", "[sharp]", "-frames:v", String(count), "-q:v", "3", "-start_number", String(first + 1), path.join(opts.publicDir, author, "%05d.jpg"),
      "-map", "[blurred]", "-frames:v", String(count), "-q:v", "5", "-start_number", String(first + 1), path.join(opts.publicDir, blur, "%05d.jpg"),
    ]);
  }));
  // Frames are numbered from 1 without gaps; the last stretch may end a frame or two early.
  let count = 0;
  while (count < total && fs.existsSync(path.join(opts.publicDir, author, `${String(count + 1).padStart(5, "0")}.jpg`))) count++;
  if (count < total - fps) throw new Error(`кадров записи ${count} из ${total}`);
  return { author, blur, count };
}

/** Frames take hundreds of megabytes: they are removed as soon as the final render is done. */
export function removeFrames(publicDir: string, frames: AuthorFrames | undefined) {
  if (!frames) return;
  for (const dir of [frames.author, frames.blur]) fs.rmSync(path.join(publicDir, dir), { recursive: true, force: true });
}
