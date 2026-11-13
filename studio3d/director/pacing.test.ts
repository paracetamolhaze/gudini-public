import test from "node:test";
import assert from "node:assert/strict";
import { analyzeScene, type SceneFacts } from "./validate";

// The owner (2026-10-23): «иногда кадры очень быстро меняются, либо когда говорит один — кадр на другом».
// The cut follows the voice: one line is one shot, and a single shot shows whoever is speaking.

const lines: SceneFacts["lines"] = [
  { who: "me", start: 0.2, end: 1.8, text: "Клод, сделай мне бота." },
  { who: "claude", start: 2.2, end: 5.6, text: "Такого не бывает. Кто обещает только плюс, продаёт сказку." },
  { who: "me", start: 6.4, end: 8.0, text: "Ой, всё. Попрошу Кодекс." },
  { who: "claude", start: 8.3, end: 9.0, text: "Попроси." },
  { who: "me", start: 9.3, end: 13.8, text: "Клод! Кодекс сделал! Сто процентов сделок в плюс!" },
];
const facts: SceneFacts = { duration: 14, cast: ["me", "claude"], lines };
const scene = (shots: string[]) => `import React from "react";
import { Sketch, Actor, Shot, Face } from "../kit";
export const Scene: React.FC = () => (
  <Sketch>
    <Actor id="me" at={[-2.24, 0.56]} />
    <Actor id="claude" at={[2.24, 0.56]} />
    ${shots.join("\n    ")}
  </Sketch>
);`;
// the sketch opens on the face of whoever says the first line
const DESK = '<Shot from={0} to={2.1} on="me" kind="medium" move="push" />\n    <Face who="me" from={0} to={2.1} mood="happy" />';

test("a montage that cuts on the change of speaker and keeps the speaker in the frame passes", () => {
  const shots = [
    DESK,
    '<Shot from={2.1} to={6.3} on="claude" kind="close" move="push" />',
    // two short lines in a row: one shot of both, not two flashes
    '<Shot from={6.3} to={9.2} on="both" kind="wide" />',
    '<Shot from={9.2} to={14} on="me" kind="close" move="push" />',
  ];
  assert.deepEqual(analyzeScene(scene(shots), facts), []);
});

test("the validator sends back a shot of the listener while the other one speaks", () => {
  const shots = [DESK, '<Shot from={2.1} to={6.3} on="me" kind="medium" />', '<Shot from={6.3} to={9.2} on="both" kind="wide" />', '<Shot from={9.2} to={14} on="me" kind="close" />'];
  const problems = analyzeScene(scene(shots), facts);
  assert.ok(problems.some((p) => /кадр на другом/.test(p) && /план claude с 2,1/.test(p) && /Такого не бывает/.test(p)), problems.join(" | "));
});

test("the validator keeps a line in one shot and short shots out", () => {
  const cut = [
    DESK,
    '<Shot from={2.1} to={4} on="claude" kind="close" />',
    '<Shot from={4} to={6.3} on="claude" kind="medium" />',
    '<Shot from={6.3} to={9.2} on="both" kind="wide" />',
    '<Shot from={9.2} to={14} on="me" kind="close" />',
  ];
  const cutProblems = analyzeScene(scene(cut), facts);
  assert.ok(cutProblems.some((p) => /режет реплику claude/.test(p) && /один план/.test(p)), cutProblems.join(" | "));
  const flash = [
    DESK,
    '<Shot from={2.1} to={6.3} on="claude" kind="close" />',
    '<Shot from={6.3} to={8.2} on="me" kind="close" />',
    '<Shot from={8.2} to={9.2} on="claude" kind="medium" />',
    '<Shot from={9.2} to={14} on="me" kind="medium" />',
  ];
  const flashProblems = analyzeScene(scene(flash), facts);
  assert.ok(flashProblems.some((p) => /не короче 1,5 с/.test(p) && /общим планом на двоих/.test(p)), flashProblems.join(" | "));
});

test("a long line may change size once", () => {
  const long: SceneFacts = { ...facts, duration: 17, lines: [...lines.slice(0, 4), { who: "me", start: 9.3, end: 16.6, text: "Длинная реплика" }] };
  const once = [DESK, '<Shot from={2.1} to={6.3} on="claude" kind="close" />', '<Shot from={6.3} to={9.2} on="both" kind="wide" />', '<Shot from={9.2} to={13} on="me" kind="close" />', '<Shot from={13} to={17} on="me" kind="medium" />'];
  assert.deepEqual(analyzeScene(scene(once), long), []);
  const twice = [...once.slice(0, 4), '<Shot from={13} to={15} on="me" kind="medium" />', '<Shot from={15} to={17} on="me" kind="close" />'];
  assert.ok(analyzeScene(scene(twice), long).some((p) => /режет реплику me/.test(p) && /дольше 6 с/.test(p)));
});
