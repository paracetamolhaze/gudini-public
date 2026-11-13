/**
 * Renders a finished montage again with the current kit and cast looks — the director's Scene.tsx,
 * the voice and the timings stay as they were (fixes of the kit, never of the montage):
 *   npx tsx scripts/rerender.ts <workDir>
 */
import fs from "node:fs";
import path from "node:path";
import { castForScene, loadCast } from "../director/cast";
import { renderScene } from "../director/render";

const workDir = path.resolve(process.argv[2] ?? "");
const code = fs.readFileSync(path.join(workDir, "Scene.tsx"), "utf8");
const input = JSON.parse(fs.readFileSync(path.join(workDir, "input.json"), "utf8"));
input.cast = castForScene(loadCast());
const publicDir = path.join(workDir, "public");
// montages made before 2026-10-22 had a music bed; the sketches are voices only now
delete input.music;
fs.writeFileSync(path.join(workDir, "input.json"), JSON.stringify(input));
const t0 = Date.now();
let shown = -1;
await renderScene(code, input, publicDir, path.join(workDir, "final.mp4"), `${path.basename(workDir)}-rerender`, (f) => {
  const pct = Math.round(f * 100);
  if (pct % 10 === 0 && pct !== shown) console.log(`${(shown = pct)}%`);
}, new AbortController().signal);
console.log(`готово за ${((Date.now() - t0) / 1000).toFixed(0)} с`);
