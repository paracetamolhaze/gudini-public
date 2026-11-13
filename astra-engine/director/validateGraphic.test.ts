import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeMontage } from "./validate";

const code = (sound: number) => `import { AstraVideo, Graphic, Sfx, Captions } from "../kit";
export const Montage = () => <AstraVideo><Graphic from={0} to={4} html={'<div class="click"></div>'} motion={[{at: 2, sel: ".click", from: {scale: 0, opacity: 0}, dur: 0.2}]} /><Sfx at={${sound}} role="pop"/><Captions/></AstraVideo>;`;

test("sound on a Graphic animation event is accepted, while a sound without an event is rejected", () => {
  assert.deepEqual(analyzeMontage(code(2), 5).problems, []);
  assert.ok(analyzeMontage(code(3), 5).problems.some(p => p.includes("Звук pop")));
});

test("short graphics and an animation in the closing interval still fail validation", () => {
  const bad = code(2).replace('to={4}', 'to={2.2}');
  const errors = analyzeMontage(bad, 5).problems;
  assert.ok(errors.some(p => p.includes("хотя бы 3 секунды")));
  assert.ok(errors.some(p => p.includes("последние 0.3")));
});
