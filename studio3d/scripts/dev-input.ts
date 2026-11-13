/**
 * Builds src/dev-input.json for the studio and test renders from a saved ElevenLabs dialogue response:
 *   npx tsx scripts/dev-input.ts <response.json> <who per line, comma separated>
 * The voice goes to public/dev/voice.mp3 (ignored by git).
 */
import fs from "node:fs";
import path from "node:path";
import { voicedLines, type Alignment, type VoiceSegment } from "../director/mouth";

const [file, whoList = "me,claude"] = process.argv.slice(2);
if (!file) throw new Error("Нужен путь к ответу ElevenLabs (with-timestamps)");
const res = JSON.parse(fs.readFileSync(file, "utf8")) as { audio_base64: string; alignment: Alignment; voice_segments: VoiceSegment[] };
const who = whoList.split(",");
const root = path.resolve(import.meta.dirname, "..");
fs.mkdirSync(path.join(root, "public/dev"), { recursive: true });
fs.writeFileSync(path.join(root, "public/dev/voice.mp3"), Buffer.from(res.audio_base64, "base64"));
const lines = voicedLines(res.alignment, res.voice_segments, (s) => who[s.dialogue_input_index] ?? who[0]);
const cast = JSON.parse(fs.readFileSync(path.join(root, "cast.json"), "utf8"));
const duration = Math.max(...res.voice_segments.map((s) => s.end_time_seconds)) + 0.6;
const input = { fps: 30, duration: Math.round(duration * 100) / 100, voice: "dev/voice.mp3", lines, cast };
fs.writeFileSync(path.join(root, "src/dev-input.json"), JSON.stringify(input, null, 1));
console.log(`${lines.length} реплик, ${input.duration} с`);
