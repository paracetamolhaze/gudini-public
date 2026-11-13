/**
 * The whole montage of one script outside the site, for checking by hand:
 *   npx tsx scripts/try-montage.ts <script.json> <topic.json> <name>
 * Work files and final.mp4 land in out/try/<name>.
 */
import fs from "node:fs";
import path from "node:path";
import { makeMontage } from "../director/montage";
import type { Script3D } from "../director/api";

const [scriptFile, topicFile, name = "run"] = process.argv.slice(2);
const script = JSON.parse(fs.readFileSync(scriptFile, "utf8")) as Script3D;
const { topic } = JSON.parse(fs.readFileSync(topicFile, "utf8")) as { topic: string };
const workDir = path.resolve(import.meta.dirname, "../out/try", name);
const t0 = Date.now();
const stamp = () => `${((Date.now() - t0) / 1000).toFixed(0).padStart(4)} с`;
const result = await makeMontage(
  { id: name, topic, script, scriptVersion: 1 },
  workDir,
  { stage: (s, p) => console.log(`${stamp()} [${p}%] ${s}`), log: (m) => console.log(`${stamp()}   ${m}`), signal: new AbortController().signal },
);
console.log(`${stamp()} готово: ${result.video} (${result.duration} с)`);
