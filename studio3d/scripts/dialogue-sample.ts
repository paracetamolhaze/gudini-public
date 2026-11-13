/**
 * A short voiced sample of a script with the current cast voices and delivery, to judge voices by ear:
 *   npx tsx scripts/dialogue-sample.ts <script.json> <lines> <out.mp3>
 * It goes through the pipeline's own voiceScript: the same take request, and the same track the video plays (the
 * owner's near-whisper on his lines). The take is kept in out/voices/sample-work, so the same lines with the same
 * voices are paid for once; tuning cast.json "delivery" then costs nothing. <out>.take.mp3 is the take as it came.
 */
import fs from "node:fs";
import path from "node:path";
import type { Script3D } from "../director/api";
import { loadCast } from "../director/cast";
import { voiceScript } from "../director/voice";

const [scriptFile, count = "6", out = "out/voices/dialogue-sample.mp3"] = process.argv.slice(2);
const script = JSON.parse(fs.readFileSync(scriptFile, "utf8")) as Script3D;
const cast = loadCast();
const sample: Script3D = { title: script.title ?? "sample", lines: script.lines.slice(0, Number(count)) };
const voiced = await voiceScript(sample, cast, path.resolve("out/voices/sample-work"), undefined, (m) => console.log(m));
fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
fs.copyFileSync(voiced.file, out);
fs.copyFileSync(voiced.take, out.replace(/\.mp3$/, ".take.mp3"));
console.log(`${out}: ${sample.lines.length} реплик, ${voiced.duration.toFixed(1)} с, ${voiced.characters} знаков ElevenLabs`);
