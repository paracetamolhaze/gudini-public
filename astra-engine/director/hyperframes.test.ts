import { test } from "node:test";
import assert from "node:assert/strict";
import { graphicDocument, montagePalette, type HyperGraphic } from "./hyperframes";
import { designOf } from "../src/design";
import { graphicKey } from "../src/graphicKey";
import type { AstraInput } from "../src/input";

const g: HyperGraphic = { from: 2.01, to: 4.03, html: '<div class="coin">$10</div>', motion: [{ at: 2.01, sel: ".coin", from: { x: 0 }, to: { x: 120 }, dur: 0.3 }] };
test("HyperFrames converts absolute word timing to frame-aligned scene time, with alpha and no network scripts", () => {
  const doc = graphicDocument(g, designOf("violet").palette, 30, "");
  assert.ok(doc.includes('data-duration="2.033333333333333"'));
  assert.ok(doc.includes('data-width="984" data-height="638"'));
  assert.ok(doc.includes('window.__timelines={main:tl}'));
  assert.ok(doc.includes('start=2;'));
  assert.ok(doc.includes('background:transparent'));
  assert.equal(doc.includes('https://'), false);
  assert.notEqual(graphicKey(g), graphicKey({ ...g, motion: [{ ...g.motion[0], dur: 0.6 }] }));
  assert.equal(graphicKey(g), graphicKey({ ...g, css: "", author: "split" }));
});
test("scene palette matches Remotion, malformed markup cannot inject script into the export", () => {
  const p = montagePalette('export const Montage=()=> <AstraVideo palette={"violet"} accent="scene"/>', { sceneColor: "#22AAFF" } as AstraInput);
  assert.equal(p.accent, "#22AAFF");
  assert.throws(() => graphicDocument({ ...g, css: '</style><script>bad()</script>' }, p, 30, ""), /Unsafe/);
  const doc = graphicDocument({ ...g, motion: [{ at: 2, sel: '</script><script>', to: { text: '</script>' } }] }, p, 30, "");
  assert.ok(doc.includes('\\u003c/script>'));
});
