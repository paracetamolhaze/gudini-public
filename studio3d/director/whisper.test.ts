import test from "node:test";
import assert from "node:assert/strict";
import { loadCast } from "./cast";
import { spansOf } from "./delivery";
import { firstKnobs, nextKnobs, resolveWhisper, SR, STEER, steerMiss, whisperSpans, whisperSpansAsync, type Knobs } from "./whisper";

/** A voiced-like test signal: 130 Hz harmonics under an envelope (0..1 per second of time). */
const tone = (seconds: number, envelope: (t: number) => number, roll = 1) =>
  Float64Array.from({ length: Math.round(seconds * SR) }, (_, i) => {
    const t = i / SR;
    const e = envelope(t);
    if (!e) return 0;
    let v = 0;
    for (let h = 1; h <= 40 && 130 * h < 9000; h++) v += Math.sin(2 * Math.PI * 130 * h * t + h * h) / h ** roll;
    return 0.1 * e * v;
  });

/** Syllables four a second, then silence. */
const voice = (seconds: number) => tone(seconds, (t) => (t < seconds - 0.4 ? Math.max(0, Math.sin(Math.PI * ((t * 4) % 1))) : 0));

/** Level in dB of 5 ms windows from a to b seconds. */
const levels5 = (y: Float64Array, a: number, b: number) => {
  const n = Math.round(0.005 * SR);
  const out: number[] = [];
  for (let i = Math.round(a * SR); i + n <= Math.round(b * SR); i += n) {
    let s = 0;
    for (let k = i; k < i + n; k++) s += y[k] * y[k];
    out.push(10 * Math.log10(s / n + 1e-14));
  }
  return out;
};
const maxStep = (l: number[]) => l.slice(1).reduce((m, v, i) => Math.max(m, Math.abs(v - l[i])), 0);
const p = resolveWhisper({ kind: "whisper", level: "medium" });

test("a speaker's spans: neighbouring turns join, another voice in between splits them", () => {
  const turns = [
    { who: "me", start: 0, end: 1.2 },
    { who: "me", start: 1.2, end: 2 },
    { who: "claude", start: 2, end: 3 },
    { who: "me", start: 3, end: 4.5 },
    { who: "me", start: 4.5, end: 4.52 },
  ];
  assert.deepEqual(spansOf(turns, "me"), [
    [0, 2],
    [3, 4.52],
  ]);
  assert.deepEqual(spansOf(turns, "claude"), [[2, 3]]);
});

test("the recipe: a level with overrides; a typo or a number out of range stops the run before a paid take", () => {
  const r = resolveWhisper({ kind: "whisper", level: "medium", tilt: -13 });
  assert.equal(r.tilt, -13);
  assert.equal(r.amount, 0.22);
  assert.equal(r.seed, 1);
  assert.throws(() => resolveWhisper({ kind: "whisper", tilts: -13 } as never, "me"), /tilts/);
  assert.throws(() => resolveWhisper({ kind: "robot" } as never, "me"), /robot/);
  assert.throws(() => resolveWhisper({ kind: "whisper", level: "loud" } as never, "me"), /loud/);
  assert.throws(() => resolveWhisper({ kind: "whisper", level: "toString" } as never, "me"), /toString/);
  assert.throws(() => resolveWhisper({ kind: "whisper", voiced: 1.5 }, "me"), /«voiced» = 1\.5 вне допустимого: от 0\.2 до 0\.9/);
  assert.throws(() => resolveWhisper({ kind: "whisper", tilt: 14 }, "me"), /tilt/);
  assert.throws(() => resolveWhisper({ kind: "whisper", limitDb: 7 }, "me"), /limitDb/);
  assert.throws(() => resolveWhisper({ kind: "whisper", hi: 1.2 }, "me"), /hi/);
  assert.throws(() => resolveWhisper({ kind: "whisper", dryCut: 20 }, "me"), /dryCut/);
  assert.throws(() => resolveWhisper({ kind: "whisper", seed: 1.5 }, "me"), /seed/);
  assert.equal(resolveWhisper({ kind: "whisper", voiced: 0.2, tilt: -25, limitDb: 0 }).limitDb, 0);
});

test("the cast in the repository passes the same check", () => {
  const cast = loadCast();
  for (const [id, m] of Object.entries(cast)) if (m.delivery) assert.equal(resolveWhisper(m.delivery, id).seed >= 0, true);
});

test("only the span changes: same length, the rest of the track untouched, the same take gives the same sound", () => {
  const x = voice(3);
  const a = whisperSpans(x, [[1, 2]], p);
  assert.equal(a.y.length, x.length);
  // outside the span, the farthest an edge may move (0.3 s) and half the slow crossfade nothing moves
  const free = (i: number) => i < (1 - 0.34) * SR || i > (2 + 0.34) * SR;
  let changedOutside = 0;
  let changedInside = 0;
  for (let i = 0; i < x.length; i++) {
    if (free(i) && a.y[i] !== x[i]) changedOutside++;
    if (i > 1.35 * SR && i < 1.65 * SR && Math.abs(a.y[i] - x[i]) > 1e-4) changedInside++;
  }
  assert.equal(changedOutside, 0);
  assert.ok(changedInside > 0.5 * 0.3 * SR, "the span itself is processed");
  assert.equal(a.steered.length, 1);
  const b = whisperSpans(x, [[1, 2]], p);
  assert.deepEqual(b.y, a.y);
});

test("a speaker's tail running past the segment edge: the edge goes into the pause after it, the tail stays dry", () => {
  // the other voice speaks until 1.17 s, past the segment edge at 1.0; a pause; this voice from 1.37 s
  const x = tone(2.6, (t) => (t > 0.1 && t < 1.17 ? 1 : t > 1.37 && t < 2.3 ? 0.8 + 0.2 * Math.sin(9 * t) : 0));
  const r = whisperSpans(x, [[1, 2.3]], p);
  const [start] = r.steered[0].edges;
  assert.equal(start.quiet, true);
  assert.ok(start.at > 1.17 && start.at < 1.37, `start edge at ${start.at}`);
  for (let i = 0; i < 1.16 * SR; i++) assert.equal(r.y[i], x[i]);
});

test("speech running across a segment edge: no pause near, so the whisper meets the dry voice at its level", () => {
  // one vowel from 0.2 to 2.8 s, the segment edges at 1.0 and 2.0 inside it; the span itself 6 dB under the dry
  const x = tone(3, (t) => (t > 0.2 && t < 2.8 ? 0.8 + 0.2 * Math.sin(7 * t) : 0));
  const r = whisperSpans(x, [[1, 2]], p, { spanGain: -6 });
  const power = (y: Float64Array, a: number, b: number) => 10 * Math.log10(levels5(y, a, b).reduce((s, v) => s + 10 ** (v / 10), 0) / levels5(y, a, b).length);
  for (const [k, edge] of r.steered[0].edges.entries()) {
    assert.equal(edge.quiet, false, `edge ${k} is in speech`);
    assert.ok(Math.abs(edge.at - (k ? 2 : 1)) <= 0.121, `edge ${k} stays near the segment edge: ${edge.at}`);
    assert.ok(edge.matchDb > 3, `edge ${k}: the processed side raised to the dry level (${edge.matchDb} dB)`);
    // 5 ms levels across the crossfade: no step beyond what the dry vowel itself has, the same level on both sides
    const out = maxStep(levels5(r.y, edge.at - 0.06, edge.at + 0.06));
    const dry = maxStep(levels5(x, edge.at - 0.06, edge.at + 0.06));
    assert.ok(out < dry + 1.5, `edge ${k}: 5 ms step ${out.toFixed(1)} dB against the dry's ${dry.toFixed(1)} dB`);
    const inner = k ? [edge.at - 0.04, edge.at - 0.01] : [edge.at + 0.01, edge.at + 0.04];
    const outer = k ? [edge.at + 0.01, edge.at + 0.04] : [edge.at - 0.04, edge.at - 0.01];
    const jump = power(r.y, inner[0], inner[1]) - power(r.y, outer[0], outer[1]);
    assert.ok(Math.abs(jump) < 2, `edge ${k}: ${jump.toFixed(1)} dB between the sides`);
  }
  // past the ease the span is at its own level again
  assert.ok(power(r.y, 1.35, 1.65) - power(x, 1.35, 1.65) < -4, "the span keeps its own level inside");
});

test("when voicing and brightness pull apart, the voiced share wins", () => {
  // a dark line of the trade2 take (17.4–19.0 s), as a linear fit of 40 renders over the knobs: brightness costs it
  // voicing fast, and the old steering ended at its caps (bright 24, delta −0.3) with voiced 0.37, tilt −18.4
  const dark = (k: Knobs) => ({
    voiced: Math.min(1, Math.max(0, 0.51 - 0.0175 * (k.bright - 16) - 0.67 * (k.delta + 0.3) - 0.3 * (k.hi - 0.8) - 0.005 * k.lift)),
    tilt: -23.6 + 0.65 * (k.bright - 16) + 0.65 * k.lift + 4.5 * (k.hi - 0.8),
  });
  // a line both targets fit (a brighter, less voiced take)
  const easy = (k: Knobs) => ({ voiced: Math.min(1, Math.max(0, 0.62 - 0.01 * (k.bright - 16) - 0.6 * k.delta)), tilt: -16 + 0.7 * (k.bright - 16) + 0.7 * k.lift });
  const steer = (model: (k: Knobs) => { voiced: number; tilt: number }) => {
    let k: Knobs | null = firstKnobs(p);
    let best = { miss: Infinity, k: k!, now: model(k!) };
    for (let i = 0; i < STEER.tries && k; i++) {
      const now = model(k);
      if (steerMiss(now, p) < best.miss) best = { miss: steerMiss(now, p), k, now };
      k = nextKnobs(k, now, p);
    }
    return best;
  };
  const d = steer(dark);
  assert.ok(Math.abs(d.now.voiced - p.voiced) <= 0.05, `dark: voiced ${d.now.voiced.toFixed(2)} at ${JSON.stringify(d.k)}`);
  assert.ok(d.now.tilt > -18.4, `dark: tilt ${d.now.tilt.toFixed(1)}, brighter than the caps gave`);
  const e = steer(easy);
  assert.ok(Math.abs(e.now.voiced - p.voiced) < 0.03 && Math.abs(e.now.tilt - p.tilt) < 0.6, `easy: ${JSON.stringify(e.now)}`);
});

test("the stepped run: the event loop keeps turning, the same sound comes out, and an abort stops it", async () => {
  const x = voice(3);
  let ticks = 0;
  let last = performance.now();
  let gap = 0;
  const timer = setInterval(() => {
    const now = performance.now();
    gap = Math.max(gap, now - last);
    last = now;
    ticks++;
  }, 5);
  const t0 = performance.now();
  try {
    const a = await whisperSpansAsync(x, [[1, 2]], p);
    const total = performance.now() - t0;
    assert.deepEqual(a.y, whisperSpans(x, [[1, 2]], p).y);
    assert.ok(ticks >= 5, `the timer ran ${ticks} times in ${total.toFixed(0)} ms`);
    assert.ok(gap < Math.max(250, total / 3), `the longest stall ${gap.toFixed(0)} ms of ${total.toFixed(0)} ms`);
    // abort as soon as the timer gets a turn: the run stops within a step, with the signal's reason
    const controller = new AbortController();
    const stop = setTimeout(() => controller.abort(new Error("стоп")), 30);
    const t1 = performance.now();
    await assert.rejects(whisperSpansAsync(x, [[1, 2]], p, { signal: controller.signal }), /стоп/);
    clearTimeout(stop);
    assert.ok(performance.now() - t1 < total * 0.75, "stopped well before the end");
  } finally {
    clearInterval(timer);
  }
});
