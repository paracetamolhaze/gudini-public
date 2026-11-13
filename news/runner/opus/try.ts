/**
 * Проба «Опус 5.5» без сайта: запись и слова из папки → ролик в <папка>/work/final.mp4.
 *   npx tsx runner/opus/try.ts <папка с source.mp4 и spec.json (words/topic, как у Астры)>
 */
import fs from "node:fs";
import path from "node:path";
import { makeOpus } from "./make";

const dir = path.resolve(process.argv[2] ?? ".");
const spec = JSON.parse(fs.readFileSync(path.join(dir, "spec.json"), "utf8")) as { words: { word: string; start: number; end: number }[]; topic?: string; script?: string };
const words = spec.words.map((w) => ({ w: w.word, s: w.start, e: w.end }));
const t0 = Date.now();
const made = await makeOpus(path.join(dir, "work"), path.join(dir, "source.mp4"), { topic: spec.topic ?? "", script: spec.script ?? "", words }, {
  log: (line) => console.log(`  ${line}`),
  step: async (text, p) => console.log(`${((Date.now() - t0) / 1000).toFixed(0)} с · ${p}% ${text}`),
});
console.log("готово:", made.file, made.duration.toFixed(1), "с");
