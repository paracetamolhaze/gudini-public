// Entry point for the picture montage («С картинками»): the site's plan of shots in, the finished video out.
// npx tsx director/run-cards.ts spec.json
// Speaks the same lines as run-job.ts: "STAGE <name> [fraction]", "LOG <line>", "WAIT render", "RESULT <path>", "ERROR <message>".
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { astraInputSchema, DEFAULT_FACE, type Word } from "../src/input";
import { cardsMontage, preparePictures, type CardsShot } from "./cards";
import { ownerTrack, prepareMusic } from "./music";
import { renderVideo } from "./render";
import { sceneColor } from "./sceneColor";
import { extractFrames, removeFrames } from "./sequence";
import { linkSounds, prepareVoiceAsync } from "./sounds";
import { ENGINE_ROOT, prepareWorkspace, typecheck } from "./workspace";

export type CardsSpec = {
  /** The recording after speech cleanup, 1080x1920; absent while the site is still cutting it (see `videoReady`). */
  video?: string;
  /** A file the site writes when the cleaned recording is ready; it holds the recording's path. */
  videoReady?: string;
  /** A recording, the filter that gives the montage frame, and its length: the head is found on seven of its frames. Defaults to `video`. */
  faceFrom?: { video: string; filter: string; duration: number };
  duration: number;
  /** Words on the cleaned timeline. */
  words: Word[];
  shots: CardsShot[];
  /** Word indices shown bigger in the captions: numbers and names. */
  emphasis?: number[];
  workDir: string;
  /** The owner's sound library (sfx/<role>). */
  soundsDir?: string;
  /** Prepared sounds are kept here between jobs. */
  cacheDir?: string;
  /** The site renders one video at a time: before the final render the engine prints "WAIT render" and waits for "GO render". */
  renderGate?: boolean;
};

const emit = (line: string) => process.stdout.write(`${line.replace(/\r?\n/g, " ")}\n`);

function renderTurn(): Promise<void> {
  return new Promise(resolve => {
    let buffer = "";
    const onData = (chunk: string) => {
      buffer += chunk;
      if (!buffer.includes("GO render")) return;
      process.stdin.off("data", onData);
      // An open stdin would keep this process alive after the video is done.
      process.stdin.destroy();
      resolve();
    };
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", onData);
    process.stdin.resume();
    emit("WAIT render");
  });
}

/** Where the author's head is, from the matting silhouette (as in run-job.ts); the default box if the tool is unavailable. */
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

/** Seven frames of the uncut recording in the montage frame: the head and the room's color, while the site still cuts the recording. */
async function earlyFrames(from: NonNullable<CardsSpec["faceFrom"]>, dir: string) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  try {
    await Promise.all(Array.from({ length: 7 }, (_, i) => new Promise<void>((resolve, reject) => {
      const child = spawn("ffmpeg", ["-v", "error", "-y", "-noaccurate_seek", "-ss", (from.duration * (i + 0.5) / 7).toFixed(3), "-i", from.video,
        "-frames:v", "1", "-vf", from.filter, "-q:v", "2", path.join(dir, `${i}.jpg`)], { stdio: "ignore" });
      const timer = setTimeout(() => child.kill(), 60_000);
      child.on("error", reject);
      child.on("close", code => { clearTimeout(timer); if (code === 0) resolve(); else reject(new Error(`ffmpeg ${code}`)); });
    })));
    const probe = path.join(dir, "probe.mp4");
    execFileSync("ffmpeg", ["-v", "error", "-y", "-framerate", "1", "-i", path.join(dir, "%d.jpg"), "-vf", "fps=4", "-c:v", "libx264", "-pix_fmt", "yuv420p", probe],
      { stdio: "ignore", timeout: 60_000 });
    return { face: findFace(probe, 7), frames: Array.from({ length: 7 }, (_, i) => path.join(dir, `${i}.jpg`)) };
  } catch (error) {
    emit(`LOG Кадры для поиска головы не получились, жду запись: ${String((error as Error).message).slice(0, 160)}`);
    return null;
  }
}

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

async function waitForVideo(spec: CardsSpec): Promise<string> {
  if (spec.video && !spec.videoReady) return spec.video;
  for (;;) {
    if (spec.videoReady && fs.existsSync(spec.videoReady)) return fs.readFileSync(spec.videoReady, "utf8").trim();
    await new Promise(resolve => setTimeout(resolve, 500));
  }
}

async function main() {
  const spec = JSON.parse(fs.readFileSync(path.resolve(process.argv[2]), "utf8")) as CardsSpec;
  const publicDir = path.join(spec.workDir, "public");
  const outDir = path.join(spec.workDir, "run");
  fs.mkdirSync(path.join(publicDir, "job"), { recursive: true });
  fs.mkdirSync(outDir, { recursive: true });
  const log = (line: string) => { emit(`LOG ${line}`); fs.appendFileSync(path.join(outDir, "log.txt"), `${new Date().toISOString()} ${line}\n`); };
  fs.cpSync(path.join(ENGINE_ROOT, "public/fonts"), path.join(publicDir, "fonts"), { recursive: true });
  const video = path.join(publicDir, "job/video.mp4");
  const videoReady = waitForVideo(spec).then(source => {
    fs.rmSync(video, { force: true });
    try { fs.linkSync(source, video); } catch { fs.copyFileSync(source, video); }
  });
  videoReady.catch(() => { /* awaited below */ });

  emit("STAGE prepare");
  // The cleaned recording is usually ready before the pictures are planned: its frames are already the montage frame,
  // and seven of them are cut in seconds, while seeking through a 4K original can run out of time.
  const probeFrom = spec.faceFrom ?? (spec.video ? { video: spec.video, filter: "null", duration: spec.duration } : undefined);
  const early = probeFrom ? await earlyFrames(probeFrom, path.join(spec.workDir, "face")) : null;
  let face = early?.face;
  let stills = early?.frames ?? [];
  if (!face) {
    await videoReady;
    face = findFace(video, spec.duration);
    stills = await stillsOf(video, spec.duration, path.join(spec.workDir, "face"));
  }
  const color = await sceneColor(stills).catch(() => null);
  const library = linkSounds(spec.soundsDir, publicDir, spec.cacheDir ?? publicDir);
  // The voice, the frames and the music are made while the pictures are drawn; none of them is fatal.
  const voice = videoReady.then(() => prepareVoiceAsync(video, publicDir, "job")).catch(error => {
    log(`Голос не подготовлен, в ролике будет звук записи: ${String((error as Error).message).slice(0, 160)}`);
    return undefined;
  });
  const frames = videoReady.then(() => extractFrames({ video, publicDir, subdir: "job", duration: spec.duration })).catch(error => {
    log(`Кадры записи не нарезаны: ${String((error as Error).message).slice(0, 160)}`);
    return undefined;
  });
  const owner = process.env.ASTRA_MUSIC === "0" ? null : ownerTrack();
  // YouTube now and then drops a download that works a minute later: one more try before the video goes without music.
  const fetchTrack = () => prepareMusic({ wishes: [], pinned: owner!, duration: spec.duration, publicDir, subdir: "job", log }).catch(() => null);
  const music = owner
    ? fetchTrack().then(track => track ?? new Promise<null>(resolve => setTimeout(resolve, 20_000, null)).then(fetchTrack))
    : Promise.resolve(null);

  emit("STAGE assets");
  const drawn = spec.shots.filter(s => s.scene).length;
  log(`Кадров ${spec.shots.length}: фото ${spec.shots.filter(s => s.file).length}, сцен ${drawn}, настоящих фото ${spec.shots.filter(s => s.real).length}`);
  const pictures = await preparePictures(spec.shots, publicDir, "job", path.join(publicDir, "asset-cache"), log);
  for (const note of pictures.notes) log(`  ${note}`);
  fs.writeFileSync(path.join(outDir, "shots.json"), JSON.stringify(pictures.shots, null, 2));

  const code = cardsMontage({ shots: pictures.shots, duration: spec.duration, emphasis: spec.emphasis });
  fs.writeFileSync(path.join(outDir, "Montage.tsx"), code);
  const errors = typecheck(prepareWorkspace(code, `${path.basename(spec.workDir)}-cards-check`));
  if (errors.length) throw new Error(`Монтаж картинок не собирается: ${errors.slice(0, 3).join("; ")}`);

  await videoReady;
  const track = await music;
  const input = astraInputSchema.parse({
    duration: spec.duration, fps: 30, video: "job/video.mp4", words: spec.words, face, ...library,
    music: track ? { tense: [track.file] } : {},
    assets: pictures.assets, sizes: pictures.sizes,
    ...(color ? { sceneColor: color } : {}),
  });
  const prepared = await voice;
  const withVoice = prepared ? { ...input, voice: prepared } : input;
  fs.writeFileSync(path.join(outDir, "input.json"), JSON.stringify(withVoice));

  const authorFrames = await frames;
  if (spec.renderGate) await renderTurn();
  emit("STAGE final 0");
  const final = path.join(outDir, "final.mp4");
  const started = Date.now();
  let last = -1;
  try {
    await renderVideo({
      workspace: prepareWorkspace(code, `${path.basename(spec.workDir)}-cards-final`), publicDir,
      input: authorFrames ? { ...withVoice, frames: authorFrames } : withVoice, out: final,
      onProgress: f => {
        const p = Math.floor(f * 100);
        if (p === last) return;
        last = p;
        emit(`STAGE final ${(p / 100).toFixed(2)}`);
        if (p % 10 === 0) log(`рендер ${p}%`);
      },
    });
  } finally {
    removeFrames(publicDir, authorFrames);
  }
  log(`Рендер: ${((Date.now() - started) / 1000).toFixed(0)} с`);
  emit(`RESULT ${final}`);
}

// A one-shot CLI: renderer timers must not keep a finished job alive.
main().then(() => {
  process.stdout.write("", () => process.exit(0));
}).catch(error => {
  emit(`ERROR ${String((error as Error)?.message ?? error).slice(0, 600)}`);
  process.stdout.write("", () => process.exit(1));
});
