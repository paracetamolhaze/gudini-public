import fs from "node:fs";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { authorFitFilter } from "./topInset";

const run = promisify(execFile);

/** The 9:16 frame over a recording `width`×`height`, its middle at `center` (a share of the width). */
export function cropAt(center: number, width: number, height: number): string {
  const scaledW = Math.round((1920 * width) / height / 2) * 2;
  const x = Math.max(0, Math.min(scaledW - 1080, Math.round(center * scaledW - 540)));
  return `scale=${scaledW}:1920:flags=lanczos,crop=1080:1920:${x}:0,setsar=1`;
}

/**
 * The 9:16 frame over a wider recording, standing on the author's head instead of the middle of the picture.
 * The teleprompter's frame shows the middle, but recordings made before it have the author off to a side, and the
 * middle crop left him at the edge of every shot. The head is found on seven frames with the matting tool of the
 * Astra engine; without it, or without a head, the frame stays in the middle.
 */
export async function authorCropFilter(dir: string, raw: string, width: number, height: number, duration: number): Promise<string> {
  const middle = authorFitFilter(width, height);
  if (!(width > 0 && height > 0 && duration > 0) || width / height <= (1080 / 1920) * 1.02) return middle;
  const cacheFile = path.join(dir, "author-crop.json");
  try {
    const cached = JSON.parse(fs.readFileSync(cacheFile, "utf8")) as { raw?: string; center?: number };
    if (cached.raw === raw && typeof cached.center === "number") return cropAt(cached.center, width, height);
  } catch { /* found anew */ }
  const engine = path.join(process.cwd(), "astra-engine");
  const model = process.env.ASTRA_RVM_MODEL ?? path.join(engine, "matting/rvm_mobilenetv3_fp32.onnx");
  if (!fs.existsSync(model) || !fs.existsSync(path.join(engine, "matting/head.py"))) return middle;
  const work = path.join(dir, "author-crop");
  fs.rmSync(work, { recursive: true, force: true });
  fs.mkdirSync(work, { recursive: true });
  try {
    // Seven frames at once, each the nearest keyframe: a 4K file decodes slowly, the head does not need the exact moment.
    const probeH = Math.round((960 * height) / width / 2) * 2;
    await Promise.all(Array.from({ length: 7 }, (_, i) => new Promise<void>((resolve, reject) => {
      const child = spawn("ffmpeg", ["-v", "error", "-y", "-noaccurate_seek", "-ss", (duration * (i + 0.5) / 7).toFixed(3), "-i", path.join(dir, raw),
        "-frames:v", "1", "-vf", `scale=960:${probeH},setsar=1`, "-q:v", "2", path.join(work, `${i}.jpg`)], { stdio: "ignore" });
      child.on("error", reject);
      child.on("close", code => (code === 0 ? resolve() : reject(new Error(`ffmpeg ${code}`))));
    })));
    // Each frame holds its whole second: the head finder samples the middle of every second.
    const probe = path.join(work, "probe.mp4");
    await run("ffmpeg", ["-v", "error", "-y", "-framerate", "1", "-i", path.join(work, "%d.jpg"), "-vf", "fps=4", "-c:v", "libx264", "-pix_fmt", "yuv420p", probe]);
    const { stdout } = await run(process.env.ASTRA_PYTHON ?? "python3",
      [path.join(engine, "matting/head.py"), "--video", probe, "--duration", "7", "--model", model], { timeout: 180_000 });
    const box = JSON.parse(stdout.trim().split(/\r?\n/).pop() ?? "{}") as { x?: number; w?: number };
    if (typeof box.x !== "number" || typeof box.w !== "number") return middle;
    const center = Math.max(0, Math.min(1, (box.x + box.w / 2) / 960));
    fs.writeFileSync(cacheFile, JSON.stringify({ raw, center }));
    console.log(`Кадр 9:16 по голове автора: центр на ${(center * 100).toFixed(0)}% ширины записи`);
    return cropAt(center, width, height);
  } catch (e) {
    console.log(`Голова на записи не найдена, кадр по центру: ${String((e as Error)?.message ?? e).slice(0, 120)}`);
    return middle;
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}
