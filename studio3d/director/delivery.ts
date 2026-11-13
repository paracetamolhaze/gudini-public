import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import type { CastFile } from "./cast";
import { resolveWhisper, SR, whisperSpansAsync } from "./whisper";

const run = promisify(execFile);

/** Bump when the processing changes: delivered tracks cached by an older version are then made again. */
const VERSION = 3;
/** Turns of one speaker closer than this (one line cut in several segments, two lines in a row) are one span. */
const JOIN_GAP = 0.3;

/** Who speaks when in the take, in seconds of the take's own timeline. */
export type Turn = { who: string; start: number; end: number };

/** The take as samples, mono 44.1 kHz: the timeline every timestamp of the take refers to. */
export async function decodeTrack(file: string, signal?: AbortSignal): Promise<Float64Array> {
  const { stdout } = await run("ffmpeg", ["-v", "error", "-i", file, "-ac", "1", "-ar", String(SR), "-f", "f32le", "-"], { encoding: "buffer", maxBuffer: 512 << 20, signal });
  const bytes = new Uint8Array(stdout.byteLength - (stdout.byteLength % 4));
  bytes.set(stdout.subarray(0, bytes.length)); // a copy: the pipe's buffer need not be 4-byte aligned
  return Float64Array.from(new Float32Array(bytes.buffer));
}

const energy = (x: Float64Array) => x.reduce((s, v) => s + v * v, 0);

/** mp3 192k next to the take; the encoder hands back ~0.3 dB less than it got, so that is put back once. */
async function encodeTrack(y: Float64Array, out: string, signal?: AbortSignal) {
  const raw = `${out}.f32`;
  const part = out.replace(/\.mp3$/, ".part.mp3");
  const encode = async (gain: number) => {
    fs.writeFileSync(raw, Buffer.from(Float32Array.from(y, (v) => Math.max(-1, Math.min(1, v * gain))).buffer));
    await run("ffmpeg", ["-v", "error", "-y", "-f", "f32le", "-ar", String(SR), "-ac", "1", "-i", raw, "-c:a", "libmp3lame", "-b:a", "192k", "-ar", String(SR), part], { signal });
  };
  try {
    await encode(1);
    const back = await decodeTrack(part, signal);
    if (back.length !== y.length) throw new Error(`после кодирования ${back.length} сэмплов вместо ${y.length}`);
    const drift = Math.sqrt(energy(y) / (energy(back) + 1e-20));
    if (Math.abs(20 * Math.log10(drift)) > 0.05) await encode(drift);
    fs.renameSync(part, out);
  } finally {
    fs.rmSync(raw, { force: true });
    fs.rmSync(part, { force: true });
  }
}

/** One speaker's spans: his turns, neighbouring ones joined when nobody else speaks between them. */
export const spansOf = (turns: Turn[], who: string): [number, number][] => {
  const spans: [number, number][] = [];
  let last = "";
  for (const t of [...turns].sort((a, b) => a.start - b.start)) {
    const prev = spans[spans.length - 1];
    if (t.who === who) {
      if (prev && last === who && t.start - prev[1] < JOIN_GAP) prev[1] = Math.max(prev[1], t.end);
      else spans.push([t.start, t.end]);
    }
    last = t.who;
  }
  return spans.filter(([s, e]) => e - s > 0.05);
};

/**
 * The track the video plays: the take with each cast member's delivery (cast.json "delivery") applied to his own
 * spans only. The take, its length and its timestamps stay exactly as they are; the result is cached next to the
 * take under a key of the take's bytes, the spans and the full recipe, so tuning cast.json makes a new one and a
 * re-render reuses it. Without any delivery in the cast the take itself is returned.
 * The processing (~0.5 s of arithmetic per second of speech) hands the event loop back between short steps, so the
 * runner's heartbeats and SIGTERM get through, and the signal stops it within a step.
 */
export async function deliverTake(take: string, turns: Turn[], cast: CastFile, signal?: AbortSignal, log?: (m: string) => void): Promise<string> {
  const plans = Object.entries(cast)
    .filter(([, m]) => m.delivery)
    .map(([who, m]) => ({ who, name: m.name, recipe: resolveWhisper(m.delivery!, who), spans: spansOf(turns, who) }))
    .filter((p) => p.spans.length);
  if (!plans.length) return take;
  const takeHash = crypto.createHash("sha1").update(fs.readFileSync(take)).digest("hex");
  const key = crypto
    .createHash("sha1")
    .update(JSON.stringify({ VERSION, takeHash, plans: plans.map((p) => ({ who: p.who, recipe: p.recipe, spans: p.spans })) }))
    .digest("hex")
    .slice(0, 12);
  const out = take.replace(/\.mp3$/, `.d${key}.mp3`);
  if (fs.existsSync(out)) {
    log?.("Подача голосов для этой озвучки уже готова — беру её");
    return out;
  }
  const started = Date.now();
  const speech = (spans: [number, number][]) => spans.reduce((s, [a, b]) => s + b - a, 0).toFixed(1);
  log?.(`Подача голосов: ${plans.map((p) => `${p.name} — почти шёпот, фраз ${p.spans.length} (${speech(p.spans)} с речи)`).join("; ")}…`);
  let x = await decodeTrack(take, signal);
  const report: { who: string; spans: [number, number][]; steered: unknown[] }[] = [];
  for (const p of plans) {
    const res = await whisperSpansAsync(x, p.spans, p.recipe, { signal });
    x = res.y;
    report.push({ who: p.who, spans: p.spans, steered: res.steered });
  }
  await encodeTrack(x, out, signal);
  fs.writeFileSync(out.replace(/\.mp3$/, ".json"), JSON.stringify({ version: VERSION, take: path.basename(take), recipes: Object.fromEntries(plans.map((p) => [p.who, p.recipe])), report }, null, 1));
  log?.(`Подача голосов: ${plans.map((p) => `${p.name} — почти шёпот (фраз: ${p.spans.length})`).join("; ")} (${((Date.now() - started) / 1000).toFixed(1)} с)`);
  return out;
}
