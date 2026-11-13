// Entry point for the site's pipeline: one cleaned recording in, Astra's finished montage out.
// npx tsx director/run-job.ts spec.json
// Prints "STAGE <name> [fraction]" lines for the progress bar, "LOG <line>" for the worker log,
// and "RESULT <path to final.mp4>" at the end. Exits with code 1 and an "ERROR <message>" line on failure.
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { astraInputSchema, DEFAULT_FACE, type Word } from "../src/input";
import { directMontage } from "./job";
import { sceneColor } from "./sceneColor";
import { extractFrames } from "./sequence";
import { linkSounds, prepareVoiceAsync } from "./sounds";
import { ENGINE_ROOT } from "./workspace";
import { consumeRepair, loadRepair } from "./repair";
import { designProfile, type DesignProfile } from "./design";
import { MASCOT_POSES, mascotFile, mascotKey } from "../src/kit/ui";

export type JobSpec = {
  designProfile?: DesignProfile;
  hyperframes?: boolean;
  /** The recording after speech cleanup, 1080x1920; absent while the site is still cutting it (see `videoReady`). */
  video?: string;
  /** A file the site writes when the cleaned recording is ready; it holds the recording's path. Astra writes meanwhile. */
  videoReady?: string;
  /** The uncut recording, the filter that gives the montage frame, and its length: the head is found on it while the recording is cut. */
  faceFrom?: { video: string; filter: string; duration: number };
  duration: number;
  /** Words on the cleaned timeline. */
  words: Word[];
  topic: string;
  /** Checked facts of the story, if the project has research. */
  facts?: string[];
  /** Folder for this job: the render's public folder and Astra's working files are made inside. */
  workDir: string;
  /** The owner's sound library (sfx/<role>, music/<mood>) and meme clips. */
  soundsDir?: string;
  memesDir?: string;
  /** Prepared sounds are kept here between jobs. */
  cacheDir?: string;
  /** The site renders one video at a time: before the final render the engine prints "WAIT render" and waits for "GO render" on stdin. */
  renderGate?: boolean;
};

/** Waits for the site's permission to start the final render. */
function renderTurn(): Promise<void> {
  return new Promise(resolve => {
    let buffer = "";
    const onData = (chunk: string) => {
      buffer += chunk;
      if (!buffer.includes("GO render")) return;
      process.stdin.off("data", onData);
      // An open stdin would keep this process alive after the montage is done, and the site would wait for it forever.
      process.stdin.destroy();
      resolve();
    };
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", onData);
    process.stdin.resume();
    emit("WAIT render");
  });
}

/** The channel's mascot pictures this job has, under the keys the kit reads them by. */
function mascotAssets(publicDir: string): Record<string, string> {
  return Object.fromEntries(MASCOT_POSES.filter(pose => fs.existsSync(path.join(publicDir, mascotFile(pose)))).map(pose => [mascotKey(pose), mascotFile(pose)]));
}

const emit = (line: string) => process.stdout.write(`${line.replace(/\r?\n/g, " ")}\n`);

/** Where the author's head is, from the matting silhouette; the default box if the tool is unavailable. */
function findFace(video: string, duration: number) {
  try {
    const python = process.env.ASTRA_PYTHON ?? "python3";
    const model = process.env.ASTRA_RVM_MODEL ?? path.join(ENGINE_ROOT, "matting/rvm_mobilenetv3_fp32.onnx");
    const out = execFileSync(python, [path.join(ENGINE_ROOT, "matting/head.py"), "--video", video, "--duration", String(duration), "--model", model],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 180_000 });
    const box = JSON.parse(out.trim().split(/\r?\n/).pop() ?? "{}");
    if ([box.x, box.y, box.w, box.h].every((n: unknown) => typeof n === "number" && Number.isFinite(n))) return box as typeof DEFAULT_FACE;
  } catch (error) {
    emit(`LOG Положение головы не найдено, беру обычное: ${String((error as Error).message).slice(0, 160)}`);
  }
  return DEFAULT_FACE;
}

/**
 * The head on seven frames of the uncut recording, brought to the montage frame by the site's filter:
 * found in seconds, while the site is still cutting the recording. Null if the frames could not be taken.
 */
async function findFaceEarly(from: NonNullable<JobSpec["faceFrom"]>, dir: string) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  try {
    // Seven frames at once, each the nearest keyframe: the head does not need the exact moment, and a 4K file decodes slowly.
    await Promise.all(Array.from({ length: 7 }, (_, i) => new Promise<void>((resolve, reject) => {
      const child = spawn("ffmpeg", ["-v", "error", "-y", "-noaccurate_seek", "-ss", (from.duration * (i + 0.5) / 7).toFixed(3), "-i", from.video,
        "-frames:v", "1", "-vf", from.filter, "-q:v", "2", path.join(dir, `${i}.jpg`)], { stdio: "ignore" });
      const timer = setTimeout(() => child.kill(), 60_000);
      child.on("error", reject);
      child.on("close", code => { clearTimeout(timer); if (code === 0) resolve(); else reject(new Error(`ffmpeg ${code}`)); });
    })));
    // Each frame holds its whole second: the head finder seeks to the middle of every second.
    const probe = path.join(dir, "probe.mp4");
    execFileSync("ffmpeg", ["-v", "error", "-y", "-framerate", "1", "-i", path.join(dir, "%d.jpg"), "-vf", "fps=4", "-c:v", "libx264", "-pix_fmt", "yuv420p", probe],
      { stdio: "ignore", timeout: 60_000 });
    return { face: findFace(probe, 7), frames: Array.from({ length: 7 }, (_, i) => path.join(dir, `${i}.jpg`)) };
  } catch (error) {
    emit(`LOG Кадры для поиска головы не получились, жду запись: ${String((error as Error).message).slice(0, 160)}`);
    return null;
  }
}

/** Four stills of the montage frame, for the color of the room. */
async function stillsOf(video: string, duration: number, dir: string): Promise<string[]> {
  fs.mkdirSync(dir, { recursive: true });
  const files = [0.15, 0.4, 0.65, 0.9].map((f, i) => ({ at: duration * f, file: path.join(dir, `still${i}.jpg`) }));
  await Promise.all(files.map(({ at, file }) => new Promise<void>(resolve => {
    const child = spawn("ffmpeg", ["-v", "error", "-y", "-ss", at.toFixed(2), "-i", video, "-frames:v", "1", "-q:v", "3", file], { stdio: "ignore" });
    child.on("error", () => resolve());
    child.on("close", () => resolve());
  })));
  return files.map(f => f.file).filter(f => fs.existsSync(f));
}

/** The cleaned recording's path: given at once, or written by the site into `videoReady` when the cut is done. */
async function waitForVideo(spec: JobSpec): Promise<string> {
  if (spec.video && !spec.videoReady) return spec.video;
  for (;;) {
    if (spec.videoReady && fs.existsSync(spec.videoReady)) return fs.readFileSync(spec.videoReady, "utf8").trim();
    await new Promise(resolve => setTimeout(resolve, 500));
  }
}

async function main() {
  const spec = JSON.parse(fs.readFileSync(path.resolve(process.argv[2]), "utf8")) as JobSpec;
  const repaired = loadRepair(spec.workDir, { duration: spec.duration, words: spec.words, recording: spec.faceFrom?.video ?? spec.video ?? "" });
  const publicDir = path.join(spec.workDir, "public");
  const outDir = path.join(spec.workDir, "run");
  fs.mkdirSync(path.join(publicDir, "job"), { recursive: true });
  fs.cpSync(path.join(ENGINE_ROOT, "public/fonts"), path.join(publicDir, "fonts"), { recursive: true });
  // The channel's own pictures (the mascot, paper grain) that interface parts and collages draw on.
  if (fs.existsSync(path.join(ENGINE_ROOT, "public/astra-ui"))) fs.cpSync(path.join(ENGINE_ROOT, "public/astra-ui"), path.join(publicDir, "astra-ui"), { recursive: true });
  // The recording enters the render's public folder without a second copy when the file system allows it.
  // The site may still be cutting it: everything that reads it waits for `videoReady`, Astra starts writing at once.
  const video = path.join(publicDir, "job/video.mp4");
  const videoReady = waitForVideo(spec).then(source => {
    fs.rmSync(video, { force: true });
    try { fs.linkSync(source, video); } catch { fs.copyFileSync(source, video); }
  });
  videoReady.catch(() => { /* awaited by the montage */ });

  emit("STAGE prepare");
  const early = spec.faceFrom ? await findFaceEarly(spec.faceFrom, path.join(spec.workDir, "face")) : null;
  let face = early?.face;
  let stills = early?.frames ?? [];
  if (!face) {
    await videoReady;
    face = findFace(video, spec.duration);
    stills = await stillsOf(video, spec.duration, path.join(spec.workDir, "face"));
  }
  const color = await sceneColor(stills).catch(() => null);
  emit(`LOG Цвет кадра: ${color ?? "своего нет, акцент из палитры"}`);
  const library = linkSounds(spec.soundsDir, publicDir, spec.cacheDir ?? publicDir);
  // The voice and the frames for the final render are made while Astra writes; a failure of either is not fatal.
  const voice = videoReady.then(() => prepareVoiceAsync(video, publicDir, "job")).catch(error => {
    emit(`LOG Голос не подготовлен, в ролике будет звук записи: ${String((error as Error).message).slice(0, 160)}`);
    return undefined;
  });
  const frames = videoReady.then(() => extractFrames({ video, publicDir, subdir: "job", duration: spec.duration })).catch(error => {
    emit(`LOG Кадры записи не нарезаны: ${String((error as Error).message).slice(0, 160)}`);
    return undefined;
  });
  const input = astraInputSchema.parse({
    duration: spec.duration, fps: 30, video: "job/video.mp4", words: spec.words, face, ...library, cutouts: [], assets: mascotAssets(publicDir),
    ...(color ? { sceneColor: color } : {}),
  });
  // The owner's remarks (owner-notes.txt next to the run, one per line) are applied to the last finished montage
  // instead of writing a new one: the places named change, the rest stays. Without remarks the montage is written anew.
  const remarksFile = path.join(spec.workDir, "owner-notes.txt");
  const lastCode = path.join(spec.workDir, "last", "Montage.tsx");
  const remarks = fs.existsSync(remarksFile) ? fs.readFileSync(remarksFile, "utf8").split(/\r?\n/).map(line => line.trim()).filter(Boolean) : [];
  const startCode = repaired?.code ?? (remarks.length && fs.existsSync(lastCode) ? fs.readFileSync(lastCode, "utf8") : undefined);
  if (remarks.length && !startCode) emit("LOG Замечания владельца есть, а прошлого монтажа нет — монтаж пишется заново");
  if (repaired) emit("LOG Продолжаю с исправленного и проверенного монтажа; запись и расшифровка совпадают");
  else if (startCode) emit(`LOG Правки прошлого монтажа по замечаниям владельца: ${remarks.length}`);
  const result = await directMontage({
    designProfile: designProfile(spec.designProfile ?? "legacy"), hyperframes: spec.hyperframes === true,
    input, topic: spec.topic, lessons: [], facts: spec.facts, publicDir, mediaSubdir: "job", outDir,
    memesDir: spec.memesDir, videoReady, voice, frames, startCode, remarks: startCode && !repaired ? remarks : undefined,
    skipReview: startCode ? true : process.env.ASTRA_REVIEW !== "1",
    // Next to the site's data (…/data/uploads/<id>/astra → …/data): it outlives rebuilds of the worker image.
    musicHistory: path.join(path.dirname(path.dirname(path.dirname(path.resolve(spec.workDir)))), "astra-cache", "music-history.json"),
    beforeRender: spec.renderGate ? renderTurn : undefined,
    log: line => emit(`LOG ${line}`),
    onStage: (stage, fraction) => emit(`STAGE ${stage}${fraction === undefined ? "" : ` ${fraction.toFixed(3)}`}`),
  });
  // The finished montage is kept outside the run folder (the site empties it before the next job): remarks start from it.
  fs.mkdirSync(path.dirname(lastCode), { recursive: true });
  fs.copyFileSync(path.join(outDir, "Montage.tsx"), lastCode);
  if (repaired) consumeRepair(spec.workDir, repaired.token);
  else if (startCode) fs.rmSync(remarksFile, { force: true });
  emit(`RESULT ${result.final}`);
}

// This is a one-shot CLI. Renderer/SDK timers must not keep a completed job alive.
main().then(() => {
  process.stdout.write("", () => process.exit(0));
}).catch(error => {
  emit(`ERROR ${String((error as Error)?.message ?? error).slice(0, 600)}`);
  process.stdout.write("", () => process.exit(1));
});
