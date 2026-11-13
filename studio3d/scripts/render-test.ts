/**
 * Speed and look checks of the 3D layer:
 *   npx tsx scripts/render-test.ts stills 30,100          → out/still-<frame>.jpg
 *   npx tsx scripts/render-test.ts video 0-149 4          → out/test.mp4 with 4 tabs
 * GL=swangle|angle|angle-egl|vulkan picks the WebGL backend, BROWSER the Chrome executable,
 * DPR the interior resolution of the 3D layer.
 */
import path from "node:path";
import fs from "node:fs";
import { bundle } from "@remotion/bundler";
import { renderMedia, renderStill, selectComposition, type ChromiumOptions } from "@remotion/renderer";

const [mode = "stills", range = "30", tabs = "4"] = process.argv.slice(2);
const root = path.resolve(import.meta.dirname, "..");
const out = path.join(root, "out");
fs.mkdirSync(out, { recursive: true });
const chromiumOptions: ChromiumOptions = { gl: (process.env.GL ?? "swangle") as ChromiumOptions["gl"] };
const browserExecutable = process.env.BROWSER || null;
const input = JSON.parse(fs.readFileSync(path.join(root, "src/dev-input.json"), "utf8"));
if (process.env.DPR) input.dpr = Number(process.env.DPR);
if (process.env.AA) input.aa = process.env.AA !== "0";

const t0 = Date.now();
const serveUrl = await bundle({ entryPoint: path.join(root, "src/index.ts"), publicDir: path.join(root, "public") });
const t1 = Date.now();
const composition = await selectComposition({ serveUrl, id: "Sketch3D", inputProps: input, chromiumOptions, browserExecutable });
console.log(`bundle ${((t1 - t0) / 1000).toFixed(1)} s, ${composition.durationInFrames} frames, gl=${chromiumOptions.gl}, dpr=${input.dpr ?? 1}`);

if (mode === "stills") {
  for (const f of range.split(",").map(Number)) {
    const s = Date.now();
    await renderStill({ serveUrl, composition, frame: f, output: path.join(out, `still-${f}.jpg`), imageFormat: "jpeg", jpegQuality: 85, inputProps: input, chromiumOptions, browserExecutable });
    console.log(`still ${f}: ${((Date.now() - s) / 1000).toFixed(2)} s`);
  }
} else {
  const [a, b] = range.split("-").map(Number);
  const s = Date.now();
  let last = 0;
  await renderMedia({
    serveUrl,
    composition,
    codec: "h264",
    crf: 20,
    outputLocation: path.join(out, "test.mp4"),
    inputProps: input,
    chromiumOptions,
    browserExecutable,
    concurrency: Number(tabs),
    frameRange: [a, Math.min(b, composition.durationInFrames - 1)],
    timeoutInMilliseconds: 120_000,
    onProgress: ({ renderedFrames }) => {
      if (renderedFrames - last >= 15) {
        last = renderedFrames;
        console.log(`${renderedFrames} frames, ${(renderedFrames / ((Date.now() - s) / 1000)).toFixed(2)} fps`);
      }
    },
  });
  const frames = Math.min(b, composition.durationInFrames - 1) - a + 1;
  const sec = (Date.now() - s) / 1000;
  console.log(`video: ${frames} frames in ${sec.toFixed(1)} s = ${(frames / sec).toFixed(2)} fps with ${tabs} tabs`);
}
