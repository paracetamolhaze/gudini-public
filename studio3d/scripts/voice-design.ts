/**
 * Voice Design previews for a cast member, so the owner can pick a voice by ear:
 *   npx tsx scripts/voice-design.ts <name> "<description>" "<Russian sample text>"
 * Writes out/voices/<name>-<n>.mp3 and out/voices/<name>.json with the generated ids.
 * Saving the chosen preview as a permanent voice: npx tsx scripts/voice-design.ts --save <generated_voice_id> "<voice name>"
 */
import fs from "node:fs";
import path from "node:path";
import { elevenKey, speak } from "../director/elevenlabs";

const root = path.resolve(import.meta.dirname, "..");
const outDir = path.join(root, "out/voices");
fs.mkdirSync(outDir, { recursive: true });
const key = elevenKey();
const args = process.argv.slice(2);

if (args[0] === "--speak") {
  // An existing voice reading the same sample: npx tsx scripts/voice-design.ts --speak <voice_id> <spec.json> <out.mp3>
  const [, voiceId, specFile, outFile] = args;
  const spec = JSON.parse(fs.readFileSync(specFile, "utf8")) as { text: string; stability?: number };
  fs.writeFileSync(outFile, await speak(spec.text, voiceId, spec.stability));
  console.log(outFile);
} else if (args[0] === "--save") {
  const [, generated, name] = args;
  const res = await fetch("https://api.elevenlabs.io/v1/text-to-voice", {
    method: "POST",
    headers: { "xi-api-key": key, "Content-Type": "application/json" },
    body: JSON.stringify({ voice_name: name, voice_description: name, generated_voice_id: generated }),
  });
  const json = (await res.json()) as { voice_id?: string };
  if (!res.ok || !json.voice_id) throw new Error(`ElevenLabs ${res.status}: ${JSON.stringify(json).slice(0, 300)}`);
  console.log(`voice_id ${json.voice_id}`);
} else {
  // A JSON file {name, description, text} keeps Cyrillic intact on Windows shells.
  const [name, description, text] = args[0]?.endsWith(".json")
    ? (({ name, description, text }) => [name, description, text])(JSON.parse(fs.readFileSync(args[0], "utf8")))
    : args;
  if (!name || !description || !text) throw new Error("Нужны имя, описание голоса и русский текст пробы (100–1000 знаков)");
  const res = await fetch("https://api.elevenlabs.io/v1/text-to-voice/design?output_format=mp3_44100_128", {
    method: "POST",
    headers: { "xi-api-key": key, "Content-Type": "application/json" },
    body: JSON.stringify({ voice_description: description, model_id: "eleven_ttv_v3", text, guidance_scale: 5 }),
  });
  const json = (await res.json()) as { previews?: { generated_voice_id: string; audio_base_64: string; duration_secs?: number }[] };
  if (!res.ok || !json.previews) throw new Error(`ElevenLabs ${res.status}: ${JSON.stringify(json).slice(0, 300)}`);
  json.previews.forEach((p, i) => fs.writeFileSync(path.join(outDir, `${name}-${i + 1}.mp3`), Buffer.from(p.audio_base_64, "base64")));
  fs.writeFileSync(path.join(outDir, `${name}.json`), JSON.stringify(json.previews.map((p, i) => ({ n: i + 1, id: p.generated_voice_id, duration: p.duration_secs })), null, 1));
  console.log(`${json.previews.length} проб: ${json.previews.map((p, i) => `${name}-${i + 1}.mp3 ${p.generated_voice_id}`).join(", ")}`);
}
