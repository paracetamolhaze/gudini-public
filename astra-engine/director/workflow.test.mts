import { test, mock } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

test("review and sound repair retain the selected footage and its crop through the complete director cycle", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "astra-workflow-"));
  const previousMusic = process.env.ASTRA_MUSIC;
  const previousDraw = process.env.ASTRA_DRAW;
  process.env.ASTRA_MUSIC = "0";
  process.env.ASTRA_DRAW = "1";
  let requestedClips = 0, choices = 0, questions = 0;
  const original = 'import React from "react";\nimport { AstraVideo, Captions, Title, Footage, Sfx } from "../kit";\nexport const Montage = () => <AstraVideo><Captions/><Title from={0} to={3} text="Hook"/><Footage from={3} to={7} query="Telegram settings"/><Sfx at={3} role="pop" /></AstraVideo>;\n';
  const reviewed = original.replace('text="Hook"', 'text="Clear hook"').replace('at={3} role="pop"', 'at={3.45} role="pop"');
  const repaired = reviewed.replace('<Sfx at={3.45} role="pop" />', "");
  const moduleUrl = (name: string) => new URL(`./${name}.ts`, import.meta.url).href;
  const replace = (name: string, namedExports: Record<string, unknown>) => mock.module(moduleUrl(name), { namedExports });
  try {
    for (const file of ["master.mp4", "master.jpg", "window.mp4", "window.jpg"]) fs.writeFileSync(path.join(root, file), "fixture");
    replace("bridge", {
      extractCode: (text: string) => text.trim() + "\n",
      askAstra: async (system: string) => {
        questions++;
        let text: string;
        if (questions === 1) { choices++; text = '{"1":{"start":1,"span":[0.2,0.7]}}'; }
        else if (system.includes("Ответ: точечные правки")) text = JSON.stringify({ edits: questions === 2 ? [
          { before: 'text="Hook"', after: 'text="Clear hook"', reason: "readability" },
          { before: 'at={3} role="pop"', after: 'at={3.45} role="pop"', reason: "review edit" },
        ] : [{ before: '<Sfx at={3.45} role="pop" />', after: "", reason: "no event" }] });
        else text = questions === 2 ? reviewed : repaired;
        return { text, usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0 }, durationMs: 1, queueWaitMs: 0 };
      },
    });
    replace("assets", {
      FRAME_STEP: 3,
      listMemes: () => ({}),
      inPool: async (tasks: (() => Promise<unknown>)[]) => Promise.all(tasks.map(fn => fn())),
      realKey: (r: { query: string; wiki?: string }) => `real:${r.wiki ?? r.query}`,
      footageKeys: (query: string) => ({ video: `footage:${query}`, poster: `footage-poster:${query}` }),
      resolveAssets: async (needs: { footage: unknown[] }) => {
        requestedClips += needs.footage.length;
        return { assets: needs.footage.length ? { "footage:Telegram settings": "master.mp4", "footage-poster:Telegram settings": "master.jpg" } : {},
          sizes: needs.footage.length ? { "footage:Telegram settings": { w: 1920, h: 1080 } } : {}, missing: [], notes: [], check: [] };
      },
      footageFrames: async () => [0, 3, 6].map(at => ({ at, jpeg: Buffer.from("fixture") })),
      windowFootage: async () => ({ file: path.join(root, "window.mp4"), poster: path.join(root, "window.jpg") }),
      discardFootage: () => { throw new Error("Unexpected rejection"); },
      footage: () => { throw new Error("Unexpected replacement"); },
      discardLogo: () => {}, redrawScene: () => {},
    });
    replace("workspace", { ENGINE_ROOT: fileURLToPath(new URL("..", import.meta.url)), prepareWorkspace: () => "fixture", typecheck: () => [] });
    replace("matting", { makeCutouts: async () => [] });
    replace("frames", { keyMoments: () => [], draftStills: async () => ({ images: [], labels: [] }) });
    replace("render", { renderVideo: async (options: any) => {
      assert.equal(options.input.assets["footage:Telegram settings"], "window.mp4");
      assert.deepEqual(options.input.sizes["footage:Telegram settings"].span, [0.2, 0.7]);
      fs.writeFileSync(options.out, "fixture");
    } });
    const { directMontage } = await import(moduleUrl(process.env.ASTRA_JOB_UNDER_TEST || "job"));
    const result = await directMontage({ topic: "Telegram", lessons: [], startCode: original, publicDir: root, mediaSubdir: "job", outDir: path.join(root, "run"),
      input: { duration: 10, fps: 30, video: "author.mp4", words: [{ word: "support", start: 3, end: 6 }], assets: {}, sizes: {}, music: {}, sounds: {}, soundInfo: {}, cutouts: [] } });
    assert.equal(result.code, repaired);
    assert.equal(requestedClips, 1, "the unchanged request resolves only once");
    assert.equal(choices, 1, "the approved window is inspected only once");
    assert.equal(questions, 3, "only window selection, review and local sound repair");
    assert.ok(fs.existsSync(path.join(root, "run", "render-timing.json")));
  } finally {
    mock.restoreAll();
    if (previousMusic === undefined) delete process.env.ASTRA_MUSIC; else process.env.ASTRA_MUSIC = previousMusic;
    if (previousDraw === undefined) delete process.env.ASTRA_DRAW; else process.env.ASTRA_DRAW = previousDraw;
    fs.rmSync(root, { recursive: true, force: true });
  }
});
