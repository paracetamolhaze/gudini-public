/**
 * Where the render time of a montage goes: the same frames of a finished montage rendered with one change at a time.
 *   npx tsx scripts/render-bench.ts <workDir> <from-to|all> <variant,...> [tabs]
 * A variant is a change of the look (input) or a patch of the kit in a private copy of src, never of src itself:
 *   base           the look the runner renders with (STUDIO3D_GL, angle by default: its dpr, post and sounds)
 *   nopost         without the depth of field and glow passes
 *   dpr75          the 3D layer at 0.75 of the frame size
 *   nosfx          without the room's sounds
 *   still-screens  the screens painted once, never repainted
 *   nobokeh        the glow pass without the depth of field pass
 *   nobloom        the depth of field pass without the glow pass
 *   nomsaa         the post passes' target without multisampling
 *   noshadow       without shadow maps
 *   screens10      the screens repainted 10 times a second instead of 15
 *   screens-nomip  the screens' textures without mipmaps
 *   screens-paint-only   the screens' apps drawn but never sent to the graphics card
 *   screens-upload-only  the screens' apps sent to the graphics card at their rate but never drawn again
 * A variant may also replace whole files of src with candidates from .work/bench/candidates (files).
 * Prints the frame rate of each variant (frames only, no audio mixing) and writes nothing outside .work/bench.
 * The range "all" renders the whole video with its sound, as a montage does (without the loudness pass after it),
 * and also prints how long the sound took after the last frame.
 *
 * What it found (2026-10-23, «Бот только в плюс», 2 tabs on the RTX 3060 Ti): the screens' repaint cost half the speed —
 * the whole desktop painted and sent to the card every other frame; the post passes, dpr, sounds and shadows cost
 * nothing measurable. Sending only the app (Screens.tsx) took the whole video from 10.4 to 15.2 frames a second.
 */
import fs from "node:fs";
import path from "node:path";
import { renderMedia, selectComposition, type ChromiumOptions } from "@remotion/renderer";
import { ENGINE_ROOT } from "../director/cast";
import { prepareWorkspace, removeWorkspace } from "../director/workspace";

// render.ts picks the look (dpr, post) from STUDIO3D_GL when it loads: the bench renders on the card, so it looks like it
process.env.STUDIO3D_GL ||= "angle";
const { bundleWorkspace, DEFAULT_DPR, DEFAULT_POST, DEFAULT_SFX } = await import("../director/render");

/** files: whole files of src replaced by candidates from .work/bench/candidates. */
type Variant = { input?: Record<string, unknown>; patch?: [file: string, from: string | RegExp, to: string][]; files?: Record<string, string> };

const VARIANTS: Record<string, Variant> = {
  base: {},
  nopost: { input: { post: false } },
  dpr75: { input: { dpr: 0.75 } },
  nosfx: { input: { sfx: false } },
  "still-screens": { patch: [["kit/Screens.tsx", "const t = Math.floor((frame / fps) * RATE) / RATE;", "const t = 0 * frame * fps * RATE;"]] },
  nobokeh: { patch: [["kit/Post.tsx", "composer.addPass(bokeh);", ""]] },
  nobloom: { patch: [["kit/Post.tsx", /composer\.addPass\(new UnrealBloomPass\([^;]*\);/, ""]] },
  nomsaa: { patch: [["kit/Post.tsx", "samples: 4", "samples: 0"]] },
  noshadow: { patch: [["kit/Sketch.tsx", /\n\s*shadows\r?\n/, "\n"]] },
  screens10: { patch: [["kit/Screens.tsx", "const RATE = 15;", "const RATE = 10;"]] },
  "screens-nomip": { patch: [["kit/Screens.tsx", "texture.anisotropy = 8;", "texture.anisotropy = 8; texture.generateMipmaps = false; texture.minFilter = THREE.LinearFilter;"]] },
  // the screens' cost split in two: drawing the apps, and sending them to the graphics card
  "screens-paint-only": { patch: [["kit/Screens.tsx", "paint.texture.needsUpdate = true;", ""]] },
  "screens-upload-only": { patch: [["kit/Screens.tsx", /const a = paint\.app\.getContext\("2d"\)!;[\s\S]*?\} else paintScreen\(a, w, h, surface, now, t\);/, ""]] },
};

const [workDir, range = "450-749", names = "base", tabsArg] = process.argv.slice(2);
if (!workDir) throw new Error("usage: render-bench.ts <workDir> <from-to> <variant,...> [tabs]");
const whole = range === "all";
const [from, to] = whole ? [0, Infinity] : range.split("-").map(Number);
const tabs = Number(tabsArg || process.env.STUDIO3D_TABS || 2);
const gl = (process.env.STUDIO3D_GL || "angle") as ChromiumOptions["gl"];
const code = fs.readFileSync(path.join(workDir, "Scene.tsx"), "utf8");
const look = JSON.parse(fs.readFileSync(path.join(workDir, "input.json"), "utf8"));
const benchDir = path.join(ENGINE_ROOT, ".work", "bench");
fs.mkdirSync(benchDir, { recursive: true });
const publicDir = path.join(workDir, "public");
fs.cpSync(path.join(ENGINE_ROOT, "public/sfx"), path.join(publicDir, "sfx"), { recursive: true });

console.log(`gl=${gl} tabs=${tabs} frames ${from}-${to} dpr=${DEFAULT_DPR} post=${DEFAULT_POST} sfx=${DEFAULT_SFX}`);
for (const name of names.split(",")) {
  const variant = VARIANTS[name];
  if (!variant) throw new Error(`unknown variant ${name}: ${Object.keys(VARIANTS).join(", ")}`);
  const ws = prepareWorkspace(code, `bench-${name}`);
  const bundleDir = path.join(benchDir, `bundle-${name}`);
  try {
    for (const [file, candidate] of Object.entries(variant.files ?? {})) fs.copyFileSync(path.join(benchDir, "candidates", candidate), path.join(ws, "src", file));
    for (const [file, a, b] of variant.patch ?? []) {
      const p = path.join(ws, "src", file);
      const before = fs.readFileSync(p, "utf8");
      const after = before.replace(a, b);
      if (after === before) throw new Error(`${name}: the patch of ${file} found nothing`);
      fs.writeFileSync(p, after);
    }
    const serveUrl = await bundleWorkspace(ws, publicDir, bundleDir);
    const input = { ...look, dpr: DEFAULT_DPR, post: DEFAULT_POST, sfx: DEFAULT_SFX, ...variant.input };
    const composition = await selectComposition({ serveUrl, id: "Sketch3D", inputProps: input, chromiumOptions: { gl }, timeoutInMilliseconds: 120_000 });
    const last = Math.min(to, composition.durationInFrames - 1);
    let start = 0;
    let firstAt = 0;
    let framesDone = 0;
    const s = Date.now();
    await renderMedia({
      serveUrl,
      composition,
      codec: "h264",
      crf: 18,
      muted: !whole,
      audioCodec: whole ? "aac" : undefined,
      outputLocation: path.join(benchDir, `${name}.mp4`),
      inputProps: input,
      chromiumOptions: { gl },
      concurrency: tabs,
      frameRange: [from, last],
      timeoutInMilliseconds: 120_000,
      onProgress: ({ renderedFrames }) => {
        // the clock starts at the first frame: opening the tabs and loading the scene are the same for every variant
        if (renderedFrames > 0 && !start) {
          start = Date.now();
          firstAt = renderedFrames;
        }
        if (renderedFrames >= last - from + 1 && !framesDone) framesDone = Date.now();
      },
    });
    const frames = last - from + 1 - firstAt;
    const sec = ((framesDone || Date.now()) - start) / 1000;
    const tail = whole ? `, sound and muxing after the frames ${((Date.now() - (framesDone || Date.now())) / 1000).toFixed(1)} s` : "";
    console.log(`${name.padEnd(14)} ${(frames / sec).toFixed(2)} fps  (${frames} frames in ${sec.toFixed(1)} s, wall ${((Date.now() - s) / 1000).toFixed(1)} s${tail})`);
  } finally {
    removeWorkspace(ws);
    fs.rmSync(bundleDir, { recursive: true, force: true });
  }
}
