import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { VoicedLine } from "./mouth";

const run = promisify(execFile);
const RATE = 16000;
const STEP = 0.01; // seconds per envelope frame
const SPEECH_DB = -38;

/** Loudness of the voice track every 10 ms, in dBFS. */
export async function envelope(file: string): Promise<number[]> {
  const { stdout } = await run("ffmpeg", ["-v", "error", "-i", file, "-ac", "1", "-ar", String(RATE), "-f", "f32le", "-"], { encoding: "buffer", maxBuffer: 256 << 20 });
  const pcm = new Float32Array(stdout.buffer, stdout.byteOffset, Math.floor(stdout.byteLength / 4));
  const n = Math.round(RATE * STEP);
  const out: number[] = [];
  for (let i = 0; i + n <= pcm.length; i += n) {
    let sum = 0;
    for (let j = i; j < i + n; j++) sum += pcm[j] * pcm[j];
    out.push(10 * Math.log10(sum / n + 1e-12));
  }
  return out;
}

/** Speech frames: loud enough, with blips under 60 ms dropped and holes under 80 ms filled. */
export const speechMask = (db: number[]) => {
  const mask = db.map((v) => v > SPEECH_DB);
  const runs = (value: boolean, maxLen: number) => {
    let i = 0;
    while (i < mask.length) {
      if (mask[i] !== value) {
        i++;
        continue;
      }
      let j = i;
      while (j < mask.length && mask[j] === value) j++;
      if (j - i < maxLen && i > 0 && j < mask.length) for (let k = i; k < j; k++) mask[k] = !value;
      i = j;
    }
  };
  runs(false, 8);
  runs(true, 6);
  return mask;
};

/**
 * ElevenLabs v3 letter times run up to ~0.5 s ahead of the audio and the offset wanders (measured 2026-10-21 on the
 * seed-phrase take: in 7 of 19 lines the first word was timed into silence). Every line is moved onto the speech
 * it actually covers — its start to the first sound at or after the aligned start, its end to the last sound before
 * the next line — the words inside are stretched to fit, and the mouth stays shut wherever the track is silent.
 */
export function alignLinesToAudio(lines: VoicedLine[], db: number[]): VoicedLine[] {
  const mask = speechMask(db);
  const at = (t: number) => mask[Math.max(0, Math.min(mask.length - 1, Math.round(t / STEP)))] ?? false;
  const total = mask.length * STEP;
  const onsetAfter = (t: number, limit: number) => {
    // a sound already running at t belongs to the line before when there was a pause just before it
    let i = Math.max(0, Math.round(t / STEP));
    if (mask[i] && i > 0) {
      let k = i;
      while (k > 0 && mask[k - 1]) k--;
      if (k > 0 && i - k < 15) return k * STEP;
      while (i < mask.length && mask[i]) i++;
    }
    while (i < mask.length && !mask[i] && i * STEP < limit) i++;
    return i < mask.length && mask[i] ? i * STEP : null;
  };
  const out: VoicedLine[] = [];
  for (let n = 0; n < lines.length; n++) {
    const line = lines[n];
    const next = lines[n + 1];
    const prevEnd = out.length ? out[out.length - 1].end : 0;
    const start = onsetAfter(Math.max(prevEnd, line.start - 0.1), line.start + 1.0) ?? line.start;
    // the line ends where its speech ends: the last sound before the next line's own onset
    const nextOnset = next ? onsetAfter(Math.max(start + 0.1, next.start - 0.1), next.start + 1.0) ?? next.start : total;
    let endIdx = Math.min(mask.length - 1, Math.round(nextOnset / STEP) - 1);
    while (endIdx > Math.round(start / STEP) && !mask[endIdx]) endIdx--;
    const end = Math.max(start + 0.15, (endIdx + 1) * STEP);
    const span = Math.max(0.05, line.end - line.start);
    const map = (t: number) => start + ((t - line.start) / span) * (end - start);
    const words = line.words.map((w) => ({ text: w.text, start: map(w.start), end: Math.max(map(w.start) + 0.04, map(w.end)) }));
    const mouth: [number, number][] = [];
    for (let t = start - 0.02; t <= end + 0.04; t += 1 / 30) {
      const mapped = line.start + ((t - start) / Math.max(0.05, end - start)) * span;
      const shape = sampleCurve(line.mouth, mapped);
      mouth.push([Math.round(t * 1000) / 1000, at(t) ? Math.max(shape, 0.25) : 0]);
    }
    mouth.push([end + 0.06, 0]);
    out.push({ ...line, start, end, words, mouth });
  }
  return out;
}

const sampleCurve = (keys: [number, number][], t: number) => {
  if (!keys.length) return 0;
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    if (t <= keys[i][0]) {
      const [t0, v0] = keys[i - 1];
      const [t1, v1] = keys[i];
      return t1 === t0 ? v1 : v0 + ((v1 - v0) * (t - t0)) / (t1 - t0);
    }
  }
  return keys[keys.length - 1][1];
};
