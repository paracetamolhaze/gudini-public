// Dev tool: draws the channel's mascot once — a base look, then every pose as an edit of it, so it is the same
// character everywhere — and cuts each picture out of its white background for the interface parts and the ending.
// npx tsx director/mascot.ts <out dir> [pose...]
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { postBridge } from "./bridge";
import { cutoutSubject } from "./collage";
import { inPool } from "./assets";
import { MASCOT_POSES, type MascotPose } from "../src/kit/ui";

const CHARACTER = "a cute claymation mascot for a short-video channel that explains crypto to beginners: " +
  "a chunky golden coin standing on its edge, a thick round body with a raised rim, made of smooth matte plasticine " +
  "with subtle fingerprints, a plain face on the coin with two simple black vertical rectangular eyes, " +
  "small stubby clay arms and two short clay legs, friendly and a little goofy";
const LOOK = "Soft warm studio light, soft shadow under the feet, the whole character visible and centered with space around it, " +
  "plain pure white background, no text, no letters, no symbols or logos on the coin, high quality 3D claymation render.";

const POSES: Record<MascotPose, string> = {
  hi: "waving hello with one raised arm, the other arm relaxed",
  point: "pointing with one stretched arm to the right side of the picture, as if showing a button there, body turned slightly right",
  think: "thinking: one hand on its chin, eyes looking up, the other arm folded",
  shock: "shocked: both arms thrown up, eyes wide and taller, leaning back a little",
  happy: "jumping for joy with both arms up, feet off the ground",
  sad: "sad: slumped, arms hanging down, eyes looking down",
  key: "holding a big old-fashioned golden key in both arms in front of itself, proud",
  phone: "holding a smartphone in both hands and looking at its screen",
};

async function draw(prompt: string, file: string, references: string[] = [], mode: "generate" | "edit" = "generate") {
  if (fs.existsSync(file)) return;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const result = await postBridge<{ base64: string }>("/image", { prompt, aspectRatio: "4:5", references, mode }, 20 * 60_000,
        process.env.CODEX_IMAGE_BRIDGE_URL ?? process.env.CODEX_BRIDGE_URL);
      if (result?.base64) { fs.writeFileSync(file, Buffer.from(result.base64, "base64")); return; }
    } catch (error) { console.error(`${path.basename(file)}: ${String((error as Error).message).slice(0, 200)}`); }
  }
  throw new Error(`no picture for ${path.basename(file)}`);
}

async function main() {
  const [outDir = "public/astra-ui/mascot", ...only] = process.argv.slice(2);
  const raw = path.join(outDir, "raw");
  fs.mkdirSync(raw, { recursive: true });
  const base = path.join(raw, "base.png");
  await draw(`${CHARACTER}, standing calmly, arms at its sides, looking at the viewer. ${LOOK}`, base);
  const reference = `data:image/png;base64,${fs.readFileSync(base).toString("base64")}`;
  const poses = (only.length ? only : MASCOT_POSES) as MascotPose[];
  await inPool(poses.map(pose => async () => {
    const file = path.join(raw, `${pose}.png`);
    await draw(`Edit this picture: the same character ${POSES[pose]}. Keep exactly the same character — shape, golden clay material, ` +
      `rim, eyes, arms, legs, proportions and lighting. ${LOOK}`, file, [reference], "edit");
    const cut = await cutoutSubject(file, path.join(outDir, `${pose}.png`), { color: true, paper: false });
    if ("error" in cut) { console.log(pose, `ERROR ${cut.error}`); return; }
    // A sticker on a phone screen needs no more than 800 px.
    const small = await sharp(cut.file).resize({ width: 800, height: 800, fit: "inside" }).png({ compressionLevel: 9 }).toBuffer();
    fs.writeFileSync(cut.file, small);
    console.log(pose, "ok");
  }), 3);
}
main().catch(e => { console.error(e); process.exit(1); });
