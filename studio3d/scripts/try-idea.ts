/**
 * Picks the next sketch's idea through the 3D bridge, for checking «Создать видео» by hand:
 *   npx tsx scripts/try-idea.ts <pool.json with {cards, recent}, as POST /api/3d/runner/ideas answers>
 */
import fs from "node:fs";
import { findIdea } from "../director/idea";

const [poolFile] = process.argv.slice(2);
const pool = JSON.parse(fs.readFileSync(poolFile, "utf8"));
const t0 = Date.now();
const choice = await findIdea(pool, { stage: (s, p) => console.log(`[${p}%] ${s}`), log: (m) => console.log(m), signal: new AbortController().signal });
console.log(JSON.stringify(choice, null, 1));
console.log(`${((Date.now() - t0) / 1000).toFixed(0)} с`);
