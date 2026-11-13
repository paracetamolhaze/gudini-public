import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { applyMontagePatch } from "./patch";
import { footageContext, PreparedAssets } from "./reuse";
import type { AssetNeeds } from "./assets";

test("two sound edits preserve every byte of already selected footage and graphics", () => {
  const code = 'import React from "react";\nconst x = <><Footage query="Telegram settings" from={4} to={9} /><Sfx role="error" at={20.46} /><Graphic html="kept" /><Sfx role="error" at={56.17} /></>;\n';
  const patched = applyMontagePatch(code, JSON.stringify({ edits: [
    { before: '<Sfx role="error" at={20.46} />', after: "", reason: "no visual event" },
    { before: '<Sfx role="error" at={56.17} />', after: "", reason: "no visual event" },
  ] }));
  assert.equal(patched, code.replace('<Sfx role="error" at={20.46} />', "").replace('<Sfx role="error" at={56.17} />', ""));
  assert.equal(applyMontagePatch(code, '{"edits":[]}'), code);
});

test("ambiguous, overlapping and invented replacements cannot modify a montage", () => {
  const patch = (edits: unknown[]) => JSON.stringify({ edits });
  assert.throws(() => applyMontagePatch("a a", patch([{ before: "a", after: "b", reason: "test" }])), /один раз/);
  assert.throws(() => applyMontagePatch("abcd", patch([{ before: "abc", after: "x", reason: "test" }, { before: "bcd", after: "y", reason: "test" }])), /пересекаются/);
  assert.throws(() => applyMontagePatch("abcd", patch([{ before: "missing", after: "x", reason: "test" }])), /один раз/);
  assert.throws(() => applyMontagePatch("abcd", "```tsx\nnew file\n```"), /JSON/);
  assert.throws(() => applyMontagePatch("abcd", patch([{ before: "", after: "x", reason: "test" }])), /before/);
});

test("a footage window is rechecked when the speech or required length changes", () => {
  const blocks = [{ type: "Footage", from: 1, to: 4, props: { query: "Telegram" } }];
  const words = [{ word: "support", start: 1, end: 2 }, { word: "scammer", start: 5, end: 6 }];
  const context = footageContext({ blocks } as any, words, { query: "Telegram" });
  const layoutOnly = footageContext({ blocks: blocks.map(b => ({ ...b, props: { ...b.props, layout: "full" } })) } as any, words, { query: "Telegram" });
  const differentMeaning = footageContext({ blocks: blocks.map(b => ({ ...b, from: 5, to: 8 })) } as any, words, { query: "Telegram" });
  const longer = footageContext({ blocks: blocks.map(b => ({ ...b, to: 10 })) } as any, words, { query: "Telegram" });
  assert.equal(context.purpose, layoutOnly.purpose);
  assert.notEqual(context.purpose, differentMeaning.purpose);
  assert.notEqual(context.purpose, longer.purpose);
});

test("a repair round keeps the approved cut, redraw, crop and plate; changed meaning and missing files resolve again", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "astra-reuse-"));
  try {
    for (const file of ["window.mp4", "poster.jpg", "redrawn.jpg", "logo.png"]) fs.writeFileSync(path.join(root, file), "fixture");
    const needs: AssetNeeds = { emoji: [], logos: ["Telegram"], photos: ["phone"], looks: { phone: "Telegram profile screen" }, footage: [{ query: "Telegram settings" }] };
    const input = { assets: { "footage:Telegram settings": "window.mp4", "footage-poster:Telegram settings": "poster.jpg", "photo:phone": "redrawn.jpg", "logo:telegram": "logo.png" }, sizes: { "photo:phone": { w: 1080, h: 1920, span: [0.2, 0.7] }, "logo:telegram": { w: 200, h: 200, plate: true } } };
    const reuse = new PreparedAssets(root);
    reuse.remember(needs, input);
    const pending = reuse.pending(needs, input);
    assert.deepEqual(pending.footage, []);
    assert.deepEqual(pending.photos, []);
    assert.deepEqual(pending.logos, []);
    assert.deepEqual(input.sizes["photo:phone"].span, [0.2, 0.7]);
    assert.equal(input.sizes["logo:telegram"].plate, true);
    assert.deepEqual(reuse.pending({ ...needs, looks: { phone: "scammer messages" } }, input).photos, ["phone"]);
    fs.unlinkSync(path.join(root, "poster.jpg"));
    assert.deepEqual(reuse.pending(needs, input).footage, needs.footage);
    fs.writeFileSync(path.join(root, "redrawn.jpg"), "replacement file");
    assert.deepEqual(reuse.pending(needs, input).photos, ["phone"]);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
