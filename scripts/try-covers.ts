// Проба обложек: npx tsx scripts/try-covers.ts <папка> — рисует сцены ниже шаблоном «Расследования» и сохраняет jpg.
import fs from "fs";
import path from "path";
import sharp from "sharp";
import { coverPrompt } from "../lib/carousel/sid/cover";
import { nativeImageBridge } from "../lib/codexImageClient";

const SCENES: Record<string, string> = {
  ios: "An older iPhone with a hairline crack across its switched-off screen lies on a kitchen table covered with a checked oilcloth, next to a torn-out ruled notebook page with twelve empty lines and a cheap ballpoint pen; a bare hand is about to flip the phone over; window daylight.",
  cb: "A small black hardware crypto wallet on a short cable lies on top of an opened paper envelope and a folded official letter with blank lines on a white windowsill; a bank card lies beside it; grey daylight from the window, dust on the sill.",
  leak: "A cardboard box packed with used hard drives in antistatic bags stands in the open boot of a car in an underground car park, one drive pulled out and lying on the boot floor; direct phone flash.",
  lbank: "A phone with a switched-off screen lies on a white office desk under a clear plastic food container turned upside down over it, a small brass padlock hooked through the container's handle; a bare hand rests on the desk next to it; ceiling office lamps.",
};

async function main() {
  const out = process.argv[2];
  const only = process.argv.slice(3);
  fs.mkdirSync(out, { recursive: true });
  await Promise.all(Object.entries(SCENES).filter(([k]) => !only.length || only.includes(k)).map(async ([name, scene]) => {
    const r = await nativeImageBridge({ prompt: coverPrompt(scene), aspectRatio: "4:5", references: [], mode: "generate" });
    await sharp(r.buffer).resize(1080).jpeg({ quality: 90 }).toFile(path.join(out, `${name}.jpg`));
    console.log("готово", name);
  }));
}
main().catch((e) => { console.error(e); process.exit(1); });
