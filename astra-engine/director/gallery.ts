// Dev tool: stills of a montage at chosen seconds, tiled into one contact sheet — to look at blocks without a full render.
// npx tsx director/gallery.ts <Montage.tsx> <input.json> <publicDir> <sheet.jpg> [palette=name] <seconds...>
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { openBrowser, renderStill, selectComposition } from "@remotion/renderer";
import { bundleJob } from "./render";
import { prepareWorkspace } from "./workspace";

async function main() {
  const [montage, inputFile, publicDir, sheet, ...rest] = process.argv.slice(2);
  const paletteArg = rest.find(a => a.startsWith("palette="));
  const times = rest.filter(a => !a.startsWith("palette=")).map(Number).filter(n => Number.isFinite(n));
  let code = fs.readFileSync(montage, "utf8");
  if (paletteArg) {
    const name = paletteArg.slice(8);
    code = /palette="[a-z]+"/.test(code) ? code.replace(/palette="[a-z]+"/, `palette="${name}"`) : code.replace(/<AstraVideo(\s)/, `<AstraVideo palette="${name}"$1`);
  }
  // Stills need no sound: the gallery input drops the voice and the sound library.
  const input = { ...JSON.parse(fs.readFileSync(inputFile, "utf8")), voice: undefined, sounds: {}, music: {}, frames: undefined };
  const workspace = prepareWorkspace(code, `gallery-${Date.now()}`);
  const serveUrl = await bundleJob(workspace, publicDir);
  const browser = await openBrowser("chrome");
  const dir = `${sheet}.frames`;
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  try {
    const composition = await selectComposition({ serveUrl, id: "Astra", inputProps: input, puppeteerInstance: browser });
    for (const [i, t] of times.entries()) {
      await renderStill({ serveUrl, composition, inputProps: input, frame: Math.min(composition.durationInFrames - 1, Math.round(t * 30)),
        output: path.join(dir, `${String(i).padStart(2, "0")}.png`), scale: 0.5, puppeteerInstance: browser });
    }
  } finally {
    await browser.close({ silent: true });
    fs.rmSync(serveUrl, { recursive: true, force: true });
    fs.rmSync(workspace, { recursive: true, force: true });
  }
  const cols = Math.min(4, times.length), rows = Math.ceil(times.length / cols);
  execFileSync("ffmpeg", ["-v", "error", "-y", "-framerate", "1", "-i", path.join(dir, "%02d.png"),
    "-vf", `scale=432:768,tile=${cols}x${rows}:padding=6:color=black`, "-frames:v", "1", "-q:v", "3", sheet]);
  console.log(`sheet: ${sheet} (${times.length} frames)`);
}
main().catch(e => { console.error(e); process.exit(1); });
