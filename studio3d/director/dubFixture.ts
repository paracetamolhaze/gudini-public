/** Test helpers for the dub: tone bursts as voices, and a finished montage in a work folder. */
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import type { AlignedText } from "./elevenlabs";
import { encode } from "./lineVoice";
import type { VoicedLine } from "./mouth";
import { RATE } from "./recorded";

const run = promisify(execFile);

export const N = (t: number) => Math.round(t * RATE);

/** total seconds of silence with tone bursts [from, to, hz, amp] in it: a stand-in for voices. */
export function sound(total: number, ...bursts: [number, number, number, number][]): Float32Array {
  const out = new Float32Array(N(total));
  for (const [from, to, hz, amp] of bursts) for (let n = N(from); n < N(to); n++) out[n] += amp * Math.sin((2 * Math.PI * hz * n) / RATE);
  return out;
}

/** What forced alignment returns for a text read evenly from `start` over `seconds` of the file it was sent. */
export const aligned = (text: string, start: number, seconds: number): AlignedText => {
  const chars = [...text];
  const step = seconds / chars.length;
  return { characters: chars.map((ch, i) => ({ text: ch, start: start + i * step, end: start + (i + 1) * step })), words: [], loss: 0.1 };
};

/** The clips of fakeMontage's lines with `clips`: the owner's first clip starts with a breath 0.4 s before his words. */
export const FAKE_CLIPS: [number, number][] = [
  [0.6, 2.1],
  [2.4, 3.6],
  [3.9, 5.2],
];

/**
 * A finished montage the way makeMontage leaves it: input.json, Scene.tsx, public/ with the voice and fonts, then
 * final.mp4 of `duration` seconds. The owner speaks 1.0–2.0 (script line 0) and 4.0–5.0 (line 3), Claude 2.5–3.5 (line 1).
 * With `clips` the voice is also in voice/ with its raw timings, as line-by-line voicing leaves it, and the owner's
 * first clip has a breath at 0.62–0.72, well before his words. With `laugh` too, script line 2 («[laughs]», no
 * words, no window) is a clip of its own, 3.62–3.88, sounding 3.65–3.85.
 */
export async function fakeMontage(dir: string, { duration = 6.2, indexed = true, clips = false, laugh = false } = {}): Promise<VoicedLine[]> {
  const lines = [
    { who: "me", text: "Что такое сид-фраза?", start: 1.0, end: 2.0, words: [{ text: "Что", start: 1.0, end: 1.2 }], mouth: [[1.0, 0.5]] },
    { who: "claude", text: "Двенадцать слов.", start: 2.5, end: 3.5, words: [{ text: "Двенадцать", start: 2.5, end: 3.0 }], mouth: [[2.5, 0.7]] },
    { who: "me", text: "И всё?", start: 4.0, end: 5.0, words: [{ text: "И", start: 4.0, end: 4.1 }], mouth: [[4.0, 0.4]] },
  ].map((l, i) => (indexed ? { ...l, index: [0, 1, 3][i] } : l)) as VoicedLine[];
  fs.mkdirSync(path.join(dir, "public", "fonts"), { recursive: true });
  fs.writeFileSync(path.join(dir, "public", "fonts", "font.txt"), "шрифт");
  const breath: [number, number, number, number][] = clips ? [[0.62, 0.72, 700, 0.05], ...(laugh ? [[3.65, 3.85, 700, 0.05] as [number, number, number, number]] : [])] : [];
  await encode(sound(duration - 0.7, ...breath, [1.0, 2.0, 500, 0.1], [2.5, 3.5, 300, 0.1], [4.0, 5.0, 500, 0.1]), path.join(dir, "public", "voice.mp3"));
  if (clips) {
    fs.mkdirSync(path.join(dir, "voice"), { recursive: true });
    fs.copyFileSync(path.join(dir, "public", "voice.mp3"), path.join(dir, "voice", "0123456789abcdef.mp3"));
    const segments = FAKE_CLIPS.map(([start, end], i) => ({ voice_id: "v", start_time_seconds: start, end_time_seconds: end, character_start_index: 0, character_end_index: 1, dialogue_input_index: [0, 1, 3][i] }));
    if (laugh) segments.splice(2, 0, { voice_id: "v", start_time_seconds: 3.62, end_time_seconds: 3.88, character_start_index: 0, character_end_index: 1, dialogue_input_index: 2 });
    fs.writeFileSync(path.join(dir, "voice", "0123456789abcdef.raw.json"), JSON.stringify({ alignment: {}, segments, characters: 0 }));
  }
  fs.writeFileSync(path.join(dir, "input.json"), JSON.stringify({ fps: 30, duration, voice: "voice.mp3", lines, cast: {}, dpr: 0.75 }));
  fs.writeFileSync(path.join(dir, "Scene.tsx"), "export const Scene = () => null; // сцена режиссёра\n");
  const video = ["-f", "lavfi", "-i", `color=c=black:s=32x32:r=30:d=${duration}`, "-f", "lavfi", "-i", "anullsrc=r=48000:cl=mono"];
  await run("ffmpeg", ["-v", "error", "-y", ...video, "-t", String(duration), "-c:v", "libx264", "-c:a", "aac", "-shortest", path.join(dir, "final.mp4")]);
  return lines;
}
