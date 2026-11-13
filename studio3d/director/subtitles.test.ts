import assert from "node:assert/strict";
import test from "node:test";
import { captionWords, displayWord } from "../src/kit/Subtitles";

test("subtitles: one word at a time like the main videos, no full stop at the end", () => {
  assert.equal(displayWord("деньги."), "деньги");
  assert.equal(displayWord("ноль?!"), "ноль");
  assert.equal(displayWord("«Сид-фразу"), "Сид-фразу");
  assert.equal(displayWord("—"), "");
  assert.equal(displayWord("50%"), "50%");
  const words = captionWords([
    { who: "me", text: "", start: 0, end: 1, mouth: [], words: [{ text: "Плюс", start: 0, end: 0.3 }, { text: "сто!", start: 0.32, end: 0.8 }] },
    { who: "claude", text: "", start: 1.2, end: 2, mouth: [], words: [{ text: "—", start: 1.2, end: 1.25 }, { text: "Ноль.", start: 1.3, end: 1.7 }] },
  ] as never);
  assert.deepEqual(words.map((w) => w.text), ["Плюс", "сто", "Ноль"]);
  for (let i = 1; i < words.length; i++) assert.ok(words[i].start >= words[i - 1].end, "words never overlap");
  assert.ok(Math.abs(words[1].end - 0.9) < 1e-9, "a word holds 0.1 s after its sound");
});
