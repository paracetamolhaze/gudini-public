import { test } from "node:test";
import assert from "node:assert/strict";
import { keepSpeechInPauseCuts } from "../lib/speechCleanupPlan";

// Громкость окнами по 0.05 с: тишина −60 дБ, речь −20 дБ.
function levels(duration: number, speech: [number, number][]): number[] {
  return Array.from({ length: Math.ceil(duration / 0.05) }, (_, i) => {
    const t = i * 0.05 + 0.025;
    return speech.some(([a, b]) => t >= a && t < b) ? -20 : -60;
  });
}

test("Пауза между словами с речью внутри: речь остаётся, вырезаются только тихие края", () => {
  // «…сорок» кончается на 18.06, «Биткоин» начинается на 18.96, между ними звучит «долларов» (18.35–18.80).
  const words = [{ word: "$40.", start: 17.62, end: 18.06 }, { word: "Биткоин", start: 18.96, end: 19.26 }];
  const rms = levels(20, [[17.62, 18.06], [18.35, 18.8], [18.96, 19.26]]);
  const { cuts, kept } = keepSpeechInPauseCuts([{ start: 18.06, end: 18.9 }], words, rms, 0.05);
  assert.equal(kept, 1);
  for (const c of cuts) assert.ok(c.end <= 18.35 || c.start >= 18.8, `вырезка ${c.start}–${c.end} задевает речь`);
});

test("Тихая пауза и вырезка поверх слов остаются как были", () => {
  const words = [{ word: "раз", start: 1, end: 1.4 }, { word: "эээ", start: 2, end: 2.5 }, { word: "два", start: 3, end: 3.4 }];
  const rms = levels(5, [[1, 1.4], [2, 2.5], [3, 3.4]]);
  const input = [{ start: 1.5, end: 1.9 }, { start: 1.95, end: 2.6 }];
  const { cuts, kept } = keepSpeechInPauseCuts(input, words, rms, 0.05);
  assert.equal(kept, 0);
  assert.deepEqual(cuts, input);
});

test("Короткий щелчок громче порога паузу не спасает", () => {
  const words = [{ word: "раз", start: 1, end: 1.4 }, { word: "два", start: 3, end: 3.4 }];
  const rms = levels(5, [[1, 1.4], [2.0, 2.05], [3, 3.4]]);
  const { cuts, kept } = keepSpeechInPauseCuts([{ start: 1.5, end: 2.8 }], words, rms, 0.05);
  assert.equal(kept, 0);
  assert.deepEqual(cuts, [{ start: 1.5, end: 2.8 }]);
});
