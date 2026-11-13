/**
 * Stills of a finished montage with the current kit, to compare the look before and after a kit change:
 *   npx tsx scripts/stills.ts <workDir> <outDir> 1,5.2,9.5
 * STUDIO3D_GL picks the WebGL backend (angle on the owner's PC), STUDIO3D_DPR the interior resolution,
 * STUDIO3D_POST=0|1 the depth of field and glow (on by default on a graphics card).
 */
import fs from "node:fs";
import path from "node:path";
import { castForScene, loadCast } from "../director/cast";
import { bundleWorkspace, renderStills } from "../director/render";
import { prepareWorkspace, removeWorkspace } from "../director/workspace";

const [workArg = "", outArg = "out/stills", secondsArg = "1"] = process.argv.slice(2);
const workDir = path.resolve(workArg);
const outDir = path.resolve(outArg);
const code = fs.readFileSync(path.join(workDir, "Scene.tsx"), "utf8");
const input = JSON.parse(fs.readFileSync(path.join(workDir, "input.json"), "utf8"));
input.cast = castForScene(loadCast());
delete input.music;
const name = `${path.basename(workDir)}-stills`;
const ws = prepareWorkspace(code, name);
const bundleDir = path.join(outDir, "bundle");
const t0 = Date.now();
try {
  const serveUrl = await bundleWorkspace(ws, path.join(workDir, "public"), bundleDir);
  const files = await renderStills(serveUrl, input, secondsArg.split(",").map(Number), outDir);
  console.log(`${files.length} кадров за ${((Date.now() - t0) / 1000).toFixed(0)} с → ${outDir}`);
} finally {
  removeWorkspace(ws);
  fs.rmSync(bundleDir, { recursive: true, force: true });
}
