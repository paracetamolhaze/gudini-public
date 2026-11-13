import { test } from "node:test";
import assert from "node:assert/strict";
import { cardsMontage } from "./cards";
import { framing } from "../src/kit/Pictures";
import { prepareWorkspace, typecheck } from "./workspace";

const shot = (from: number, to: number, layout: "split" | "full" | "author", src?: string, extra: object = {}) => ({ from, to, layout, ...(src ? { src } : {}), ...extra });

test("picture montage: panel runs, full-screen pictures, author punches and quiet sounds", () => {
  const code = cardsMontage({
    duration: 20,
    emphasis: [3, 7],
    shots: [
      shot(0, 2.5, "split", "job/cards/a.jpg"),
      shot(2.6, 4.8, "split", "job/cards/b.jpg", { accent: true }),
      // A short author moment between two panel pictures keeps the panel open.
      shot(4.8, 5.6, "author"),
      shot(5.6, 8, "split", "job/cards/c.jpg"),
      shot(8, 10.4, "full", "job/cards/tall.jpg"),
      shot(10.4, 13, "split", "job/cards/a.jpg"),
      shot(13, 16, "author"),
      shot(16, 19, "split", "job/cards/d.jpg"),
    ],
  });
  const runs = [...code.matchAll(/<PictureRun from=\{([\d.]+)\} to=\{([\d.]+)\}( open)?/g)];
  assert.equal(runs.length, 3, code);
  assert.equal(runs[0][1], "0");
  assert.ok(runs[0][3], "the video starts on an open panel");
  // The run before the full picture closes under it; the run after it is open when the picture leaves.
  assert.equal(Number(runs[0][2]), 8.45);
  assert.equal(runs[1][1], "10.4");
  assert.ok(runs[1][3]);
  assert.match(code, /<FullPicture from=\{8\} to=\{10.65\} src="job\/cards\/tall.jpg"/);
  // The last run holds to the end of the video.
  assert.equal(Number(runs[2][2]), 20);
  assert.match(code, /cam\.punch\(13, 1\.12\)/);
  assert.match(code, /cam\.reset\(16\)/);
  assert.match(code, /<Captions emphasis=\{\[3,7\]\} \/>/);
  const sounds = [...code.matchAll(/<Sfx at=\{([\d.]+)\}/g)].map(m => Number(m[1]));
  for (let i = 1; i < sounds.length; i++) assert.ok(sounds[i] - sounds[i - 1] >= 1.5, `sounds ${sounds.join(", ")}`);
  assert.equal(typecheck(prepareWorkspace(code, "cards-test")).length, 0);
});

test("picture framing: the picture always covers its window, a pan travels across a wide picture", () => {
  const box = { w: 1080, h: 930 };
  for (const motion of ["in", "out", "left", "right"] as const) {
    for (const size of [{ w: 1920, h: 1080 }, { w: 800, h: 1200 }, { w: 1000, h: 1000 }, { w: 3000, h: 1000, span: [0.7, 0.95] as [number, number] }]) {
      for (const p of [0, 0.5, 1, 1.08]) {
        const f = framing(size, box, motion, p);
        assert.ok(f.x <= 0.001 && f.y <= 0.001, `${motion} ${size.w}x${size.h} p=${p}: left/top edge inside`);
        assert.ok(f.x + f.w * f.scale >= box.w - 0.001 && f.y + f.h * f.scale >= box.h - 0.001, `${motion} ${size.w}x${size.h} p=${p}: right/bottom edge inside`);
      }
    }
  }
  const start = framing({ w: 1920, h: 1080 }, box, "right", 0);
  const end = framing({ w: 1920, h: 1080 }, box, "right", 1);
  assert.ok(start.x - end.x > 100, "the view moves right across the picture");
});
