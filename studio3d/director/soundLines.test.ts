import test from "node:test";
import assert from "node:assert/strict";
import { LINES_VERSION } from "../runner/protocol";
import { N, sound } from "./dubFixture";
import { RATE } from "./recorded";
import { lineSounds, SOUND_LINES, soundBounds, strayWindows, type Span } from "./soundLines";

/** A steady hiss of `amp` over [from, to): a gasp, or a voice's room tone. Seeded, so every run hears the same. */
function hiss(x: Float32Array, from: number, to: number, amp: number, seed = 1) {
  let s = seed;
  for (let n = N(from); n < N(to) && n < x.length; n++) {
    s = (s * 1103515245 + 12345) % 2147483648;
    x[n] += amp * (2 * (s / 2147483648) - 1);
  }
}

/** A word dying out: `amp` at `from`, 40 dB down by `quiet`, cut at `to`. */
function tail(x: Float32Array, from: number, quiet: number, to: number, hz: number, amp: number) {
  const tau = (quiet - from) / Math.log(100);
  for (let n = N(from); n < N(to); n++) x[n] += amp * Math.exp(-(n / RATE - from) / tau) * Math.sin((2 * Math.PI * hz * n) / RATE);
}

const near = (actual: number, expected: number, slack: number, what: string) =>
  assert.ok(Math.abs(actual - expected) <= slack, `${what}: ${actual.toFixed(3)} вместо ${expected.toFixed(3)} ± ${slack}`);

test("a line's window is its sound: a gasp before the words and the whole tail of the last one, not the clip's silence or a click", () => {
  // Claude's clip 0–0.9; the owner's clip 1.15–3.1: room tone all through, a click where it was joined in, a gasp
  // 1.40–1.62, words 1.90–2.60 dying out 40 dB down by 2.85; Claude again from 3.35
  const track = sound(4.2, [0.1, 0.85, 300, 0.2], [1.9, 2.6, 220, 0.2], [3.4, 4.0, 300, 0.2]);
  hiss(track, 1.15, 3.1, 0.0005);
  hiss(track, 1.15, 1.152, 0.3, 7);
  hiss(track, 1.4, 1.62, 0.02, 3);
  tail(track, 2.6, 2.85, 3.0, 220, 0.2);
  const clips: Span[] = [
    [0, 0.9],
    [1.15, 3.1],
    [3.35, 4.1],
  ];
  // the letters: the words only, the last letter ends before its tail
  const letters: Span[] = [
    [0.1, 0.85],
    [1.9, 2.55],
    [3.4, 4.0],
  ];
  const [claude, owner, next] = lineSounds(track, clips, clips, letters);
  near(owner[0], 1.4 - 0.03, 0.011, "начало — вздох с запасом 0.03 с");
  near(owner[1], 2.85 + 0.03, 0.02, "конец — хвост последнего слова с запасом");
  assert.ok(owner[0] > 1.3, "щелчок на стыке клипа и тишина до вздоха — не реплика");
  near(claude[0], 0.07, 0.011, "Клод");
  near(claude[1], 0.88, 0.011, "Клод");
  near(next[0], 3.37, 0.011, "следующая реплика");

  const bounds = soundBounds(track, 1.15, 3.1)!;
  assert.ok(bounds[0] <= 1.4 + 0.01 && bounds[1] >= 2.84, `звук клипа ${bounds.join("–")}`);
  assert.equal(soundBounds(new Float32Array(N(1)), 0, 1), null, "тишина");
});

test("windows never reach into a neighbour's clip nor overlap each other; a silent clip keeps its letters", () => {
  // three clips 0.01 s apart, each sounding from edge to edge: the pads have only half the gap each
  const track = sound(3.2, [0.0, 1.0, 300, 0.2], [1.01, 2.0, 220, 0.2], [2.01, 3.0, 300, 0.2]);
  const clips: Span[] = [
    [0, 1],
    [1.01, 2],
    [2.01, 3],
  ];
  const windows = lineSounds(track, clips, clips, clips);
  windows.forEach(([start, end], k) => {
    const others = clips.filter((_, o) => o !== k);
    for (const [s0, s1] of others) assert.ok(end <= s0 + 1e-9 || start >= s1 - 1e-9, `окно ${k + 1} (${start}–${end}) заходит в чужой клип ${s0}–${s1}`);
    if (k) assert.ok(start >= windows[k - 1][1] - 1e-9, `окна ${k} и ${k + 1} перекрываются`);
  });
  near(windows[1][0], 1.005, 1e-6, "запас до середины промежутка");
  near(windows[1][1], 2.005, 1e-6, "запас до середины промежутка");

  // a line without words between them has a clip too: the owner's window stays off it
  const withLaugh = sound(3.2, [0.3, 1.2, 220, 0.2], [1.25, 1.6, 900, 0.1]);
  const [line] = lineSounds(withLaugh, [[0.2, 1.24]], [[0.2, 1.24], [1.25, 1.7]], [[0.3, 1.1]]);
  assert.ok(line[1] <= 1.245 + 1e-9, `окно не заходит на смех (${line[1]})`);

  // nothing sounds in the clip: the letters' window stays
  const [kept] = lineSounds(new Float32Array(N(2)), [[0.5, 1.5]], [[0.5, 1.5]], [[0.7, 1.2]]);
  near(kept[0], 0.67, 1e-9, "окно по буквам");
  near(kept[1], 1.23, 1e-9, "окно по буквам");
});

test("stray windows: the clips no line owns get windows of their sound, one per clip however many segments it came back in", () => {
  // the owner's clip 0.2–1.24, Claude's «[laughs]» back in two segments 1.5–1.7 and 1.7–1.9 sounding 1.55–1.85,
  // Claude's words 2.0–2.9
  const track = sound(3.2, [0.3, 1.2, 220, 0.2], [1.55, 1.85, 900, 0.1], [2.05, 2.85, 300, 0.2]);
  const own: Span[] = [
    [0.2, 1.24],
    [2.0, 2.9],
  ];
  const clips: Span[] = [own[0], [1.5, 1.7], [1.7, 1.9], own[1]];
  const stray = strayWindows(track, own, clips);
  assert.equal(stray.length, 1, JSON.stringify(stray));
  near(stray[0][0], 1.52, 0.011, "смех со своим запасом");
  near(stray[0][1], 1.88, 0.011, "смех со своим запасом");
  assert.deepEqual(strayWindows(track, own, own), [], "у каждой реплики свой клип — чужих нет");
});

test("the director's sound windows are the protocol's LINES_VERSION", () => {
  assert.equal(SOUND_LINES, LINES_VERSION);
});
