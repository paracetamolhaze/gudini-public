/**
 * Writes one dialogue through the 3D bridge, for checking the writer by hand:
 *   npx tsx scripts/try-script.ts <spec.json with {topic, notes?}> [out.json]
 */
import fs from "node:fs";
import { writeScript } from "../director/script";

const [specFile, outFile = "out/script.json"] = process.argv.slice(2);
const spec = JSON.parse(fs.readFileSync(specFile, "utf8")) as { topic: string; notes?: string };
const t0 = Date.now();
const script = await writeScript(
  { id: "try", topic: spec.topic, notes: spec.notes, script: null, scriptVersion: 0 },
  { stage: (s, p) => console.log(`[${p}%] ${s}`), log: (m) => console.log(m), signal: new AbortController().signal },
);
fs.writeFileSync(outFile, JSON.stringify(script, null, 1));
console.log(`${script.lines.length} реплик, ${script.lines.reduce((n, l) => n + l.text.length, 0)} знаков, ${((Date.now() - t0) / 1000).toFixed(0)} с → ${outFile}`);
