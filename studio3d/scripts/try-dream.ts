/**
 * The draft review with the target frame on a COPY of a finished montage's folder, for checking by hand:
 *   npx tsx scripts/try-dream.ts <copy of a job folder> [Scene.checked.tsx]
 * Needs input.json, public/ (voice, fonts) and the scene in the folder. Draws the target (dream-N.jpg), asks the
 * critic (dream/critic-N.json), lets the director correct the scene and writes it as Scene.dream-try.tsx.
 * No final render; the folder's Scene.tsx and final.mp4 stay as they are.
 */
import fs from "node:fs";
import path from "node:path";
import { reviewDraft } from "../director/montage";
import { directorSystem } from "../director/prompt";

const [dir, sceneName = "Scene.checked.tsx"] = process.argv.slice(2);
if (!dir) throw new Error("npx tsx scripts/try-dream.ts <копия папки задания> [Scene.checked.tsx]");
const workDir = path.resolve(dir);
const input = JSON.parse(fs.readFileSync(path.join(workDir, "input.json"), "utf8")) as { duration: number; lines: { who: string; start: number; end: number; text: string }[]; cast: Record<string, unknown> };
const code = fs.readFileSync(path.join(workDir, sceneName), "utf8");
const meta = fs.existsSync(path.join(workDir, "topic.json")) ? (JSON.parse(fs.readFileSync(path.join(workDir, "topic.json"), "utf8")) as { topic?: string; title?: string }) : {};
const t0 = Date.now();
const stamp = () => `${((Date.now() - t0) / 1000).toFixed(0).padStart(4)} с`;
const id = `try-dream-${path.basename(workDir)}`;
const result = await reviewDraft({
  id,
  topic: meta.topic ?? "",
  title: meta.title ?? path.basename(workDir),
  code,
  facts: { duration: input.duration, cast: Object.keys(input.cast), lines: input.lines },
  system: directorSystem(),
  input,
  publicDir: path.join(workDir, "public"),
  workDir,
  duration: input.duration,
  hooks: { stage: (s, p) => console.log(`${stamp()} [${p}%] ${s}`), log: (m) => console.log(`${stamp()}   ${m}`), signal: new AbortController().signal },
  save: (c, note) => fs.writeFileSync(path.join(workDir, `Scene.try-${note}.tsx`), c),
});
fs.writeFileSync(path.join(workDir, "Scene.dream-try.tsx"), result);
console.log(`${stamp()} готово: ${result === code ? "сцена без изменений" : "сцена изменена"} — ${path.join(workDir, "Scene.dream-try.tsx")}`);
