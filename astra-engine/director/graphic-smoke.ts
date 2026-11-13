// Проба графики до того, как рецепт попадёт в учебник: монтаж из файла идёт тем же путём, что и в задании
// (проверки → HyperFrames → Remotion), и отдаёт кадры на выбранных секундах — смотреть глазами.
//   npx tsx director/graphic-smoke.ts <Montage.tsx> <папка> <длительность, с> 1.2 2.5 4.0
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { prepareHyperGraphics } from "./hyperframes";
import { analyzeMontage } from "./validate";
import { astraInputSchema } from "../src/input";
import { ENGINE_ROOT, prepareWorkspace, typecheck } from "./workspace";
import { renderVideo } from "./render";

async function main() {
  const [file, outArg, durationArg, ...times] = process.argv.slice(2);
  const root = path.resolve(outArg), duration = Number(durationArg), fps = 30;
  const publicDir = path.join(root, "public");
  fs.mkdirSync(publicDir, { recursive: true });
  for (const dir of ["fonts", "astra-ui"]) fs.cpSync(path.join(ENGINE_ROOT, "public", dir), path.join(publicDir, dir), { recursive: true });
  const video = path.join(publicDir, "author.mp4");
  execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", `color=c=0x2A2622:s=1080x1920:r=${fps}:d=${duration}`, "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo", "-shortest", "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", video]);
  const frameDir = path.join(publicDir, "author-frames");
  fs.mkdirSync(frameDir, { recursive: true });
  execFileSync("ffmpeg", ["-v", "error", "-y", "-i", video, "-frames:v", "1", path.join(frameDir, "00001.jpg")]);
  const count = Math.round(duration * fps);
  for (let n = 2; n <= count; n++) fs.copyFileSync(path.join(frameDir, "00001.jpg"), path.join(frameDir, `${String(n).padStart(5, "0")}.jpg`));
  execFileSync("ffmpeg", ["-v", "error", "-y", "-i", video, "-vn", path.join(publicDir, "voice.wav")]);
  const code = fs.readFileSync(path.resolve(file), "utf8");
  const analysis = analyzeMontage(code, duration);
  const workspace = prepareWorkspace(code, "graphic-smoke");
  const problems = [...analysis.problems, ...typecheck(workspace)];
  for (const note of analysis.notes) console.log(`note: ${note}`);
  if (problems.length) throw new Error(problems.join("\n"));
  const input = astraInputSchema.parse({ duration, fps, video: "author.mp4", voice: "voice.wav", frames: { author: "author-frames", blur: "author-frames", count }, words: [] });
  const prepared = await prepareHyperGraphics({ blocks: analysis.blocks, code, input, publicDir, workDir: root, log: console.log });
  const final = path.join(root, "combined.mp4");
  await renderVideo({ workspace, input: prepared, publicDir, out: final, scale: 0.5, onProgress: () => undefined });
  for (const t of times) {
    const image = path.join(root, `at-${Number(t).toFixed(1)}.jpg`);
    execFileSync("ffmpeg", ["-v", "error", "-y", "-ss", t, "-i", final, "-frames:v", "1", "-q:v", "3", image]);
    console.log(image);
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
