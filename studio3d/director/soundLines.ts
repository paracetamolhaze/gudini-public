/**
 * Where each voiced line really sounds in the montage's voice. Voiced line by line, every line is a clip of its own
 * in the joined track (the take's raw segments), so the first and last sound inside its clip are the line's: a
 * performed [gasps] or [laughs] before the words and the whole dying tail of the last word, both of which the
 * letter timings miss (measured 2026-10-22 on the trade video: gasps 0.28–0.48 s before the first letter, tails
 * 0.06–0.17 s after the last one). The clip's own silence around the sound is left out, and a window never reaches
 * into another line's clip. The dubbing page plays and records exactly these windows, and the dub swaps exactly them.
 */
import type { LineWindow, MontageResult } from "./api";
import { FRAME_SAMPLES, frameLevels, percentile, RATE } from "./recorded";

/** The protocol's LINES_VERSION: windows measured from the sound. Missing or 1: from the letter timings. */
export const SOUND_LINES = 2;
/** Air around the sound on each side of a window. */
export const SOUND_PAD = 0.03;
/** Sound is what comes within this many dB of the clip's loud part: a gasp, a breath, a word dying out... */
const BELOW_LOUD = 40;
/** ...and stands this far above the clip's quietest part (a voice's room tone, the air around a recorded take)... */
const ABOVE_QUIET = 10;
/** ...but never closer than this to the loud part, so a clip with words from edge to edge still has its edges. */
const NEAR_LOUD = 20;
/** Quieter than this is silence in any clip. */
const SILENT_DB = -70;
/** A sound fills most of 50 ms: a click where a clip was joined in is not the line. */
const SPAN = 5;
/** ...except right next to the speech: a burst within 150 ms of it (a stop consonant's release) is the word's own. */
const EDGE_BURST = 15;
/** Clip bounds come from the same raw timings: this much apart is the same moment. */
const SAME = 1e-3;

/** [start, end] in seconds of the montage's voice. */
export type Span = [number, number];
/** A finished video and how its windows were found (SOUND_LINES, or none for the letter timings). */
export type MadeVideo = MontageResult & { linesVersion?: number };
/** A video's windows found in its montage by the "voice" job, with how they were found. */
export type FoundWindows = { videoDuration: number; lines: LineWindow[]; version?: number };

/**
 * The first and last moments of lasting sound in audio over [from, to) seconds, or null when nothing there sounds.
 * The threshold follows the clip's own levels: the voices are levelled differently, and a recorded take has its air.
 */
export function soundBounds(audio: Float32Array, from: number, to: number): Span | null {
  const a = Math.max(0, Math.round(from * RATE));
  const b = Math.min(audio.length, Math.round(to * RATE));
  if (b <= a) return null;
  const db = frameLevels(audio.subarray(a, b));
  if (db.length < SPAN) return null;
  const sorted = [...db].sort((x, y) => x - y);
  const loud = percentile(sorted, 0.95);
  if (loud <= SILENT_DB) return null;
  const threshold = Math.min(loud - NEAR_LOUD, Math.max(loud - BELOW_LOUD, percentile(sorted, 0.05) + ABOVE_QUIET, SILENT_DB));
  const above = db.map((v) => v > threshold);
  // a frame starts (or ends) the sound when most of the 50 ms after (before) it sound too
  const lasting = (i: number, dir: 1 | -1) => {
    if (!above[i]) return false;
    let count = 0;
    for (let k = 0; k < SPAN; k++) if (above[i + dir * k]) count++;
    return count >= SPAN - 1;
  };
  let first = -1;
  for (let i = 0; i < above.length && first < 0; i++) if (lasting(i, 1)) first = i;
  let last = -1;
  for (let i = above.length - 1; i >= 0 && last < 0; i--) if (lasting(i, -1)) last = i;
  if (first < 0 || last < first) return null;
  // a short burst right next to the speech belongs to it: the release of a final «т», the click of a «к» before a word
  for (let i = Math.min(above.length - 1, last + EDGE_BURST); i > last; i--) {
    if (above[i]) {
      last = i;
      break;
    }
  }
  for (let i = Math.max(0, first - EDGE_BURST); i < first; i++) {
    if (above[i]) {
      first = i;
      break;
    }
  }
  return [(a + first * FRAME_SAMPLES) / RATE, Math.min(b, a + (last + 1) * FRAME_SAMPLES) / RATE];
}

/**
 * Every line's window from the sound of its own clip: own[k] is line k's clip, clips are all the clips of the track
 * (lines without words have theirs too). The sound gets SOUND_PAD of air on each side, which may take at most half of
 * the silence between two clips: a window never reaches into another clip, nor overlaps the window next to it.
 * A clip where nothing sounds keeps the line's letter window, letters[k].
 */
export function lineSounds(audio: Float32Array, own: Span[], clips: Span[], letters: Span[]): Span[] {
  return own.map(([c0, c1], k) => {
    let lo = 0;
    let hi = Infinity;
    for (const [s0, s1] of clips) {
      if (s0 >= c0 - SAME && s1 <= c1 + SAME) continue;
      if (s0 < c0) lo = Math.max(lo, (Math.min(s1, c0) + c0) / 2);
      else hi = Math.min(hi, (Math.max(s0, c1) + c1) / 2);
    }
    const sound = soundBounds(audio, c0, c1) ?? letters[k];
    const start = Math.max(lo, sound[0] - SOUND_PAD);
    return [start, Math.max(start, Math.min(hi, sound[1] + SOUND_PAD))];
  });
}

/**
 * The windows of the clips no line owns — a line without words ([laughs]) is a clip of the track too — measured the
 * way lineSounds measures the lines': the dub keeps the owner's take off them as off any other line. own are the
 * lines' clips, clips all the clips of the track.
 */
export function strayWindows(audio: Float32Array, own: Span[], clips: Span[]): Span[] {
  const stray = clips.filter(([s0, s1]) => !own.some(([c0, c1]) => s0 >= c0 - SAME && s1 <= c1 + SAME)).sort((a, b) => a[0] - b[0]);
  // one input may come back in several segments, each next to the one before: one clip
  const merged: Span[] = [];
  for (const [s0, s1] of stray) {
    const last = merged[merged.length - 1];
    if (last && s0 <= last[1] + SAME) last[1] = Math.max(last[1], s1);
    else merged.push([s0, s1]);
  }
  return lineSounds(audio, merged, clips, merged);
}
