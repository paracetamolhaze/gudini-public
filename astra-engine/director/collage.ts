import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import sharp from "sharp";
import { ENGINE_ROOT } from "./workspace";

const run = promisify(execFile);
const SIZE = 1024;

export const objectModel = () => process.env.ASTRA_OBJECT_MODEL ?? path.join(ENGINE_ROOT, "matting/isnet-general-use.onnx");

/**
 * The main subject of a real photo cut out along its edge, as if with scissors: black and white like an archive print
 * (or in its own colors), with a white paper margin around it. This is what a paper collage is made of.
 */
export async function cutoutSubject(photo: string, out: string, opts: { color?: boolean; paper?: boolean } = {}): Promise<{ file: string; size: { w: number; h: number } } | { error: string }> {
  if (fs.existsSync(out)) {
    const m = await sharp(out).metadata();
    return { file: out, size: { w: m.width ?? 1, h: m.height ?? 1 } };
  }
  if (!fs.existsSync(objectModel())) return { error: "нет модели вырезки предметов" };
  const work = `${out}.work`;
  fs.mkdirSync(work, { recursive: true });
  try {
    // Big photos are brought down first: the cut needs no more than the screen will show. The real size of the turned
    // picture comes back with the pixels (a photo shot upright swaps its width and height).
    const { data: rgb, info } = await sharp(photo).rotate().resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
      .removeAlpha().toColourspace("srgb").raw().toBuffer({ resolveWithObject: true });
    const W = info.width, H = info.height, CH = info.channels;
    fs.writeFileSync(path.join(work, "in.rgb"), await sharp(rgb, { raw: { width: W, height: H, channels: CH } }).removeAlpha().resize(SIZE, SIZE, { fit: "fill" }).raw().toBuffer());
    await run(process.env.ASTRA_PYTHON ?? "python3", [path.join(ENGINE_ROOT, "matting/objects.py"), "--model", objectModel(),
      "--input", path.join(work, "in.rgb"), "--output", path.join(work, "mask.raw")], { timeout: 180_000 });
    const soft = await sharp(fs.readFileSync(path.join(work, "mask.raw")), { raw: { width: SIZE, height: SIZE, channels: 1 } })
      .resize(W, H, { fit: "fill" }).extractChannel(0).raw().toBuffer();
    // A soft mask is firmed up: half-sure pixels at the edge are kept partly, the background drops out.
    const alpha = Buffer.alloc(W * H);
    let covered = 0, x0 = W, y0 = H, x1 = -1, y1 = -1;
    for (let i = 0; i < W * H; i++) {
      const a = Math.max(0, Math.min(255, Math.round(((soft[i] - 50) * 255) / 150)));
      alpha[i] = a;
      if (a > 128) {
        covered++;
        const x = i % W, y = (i - x) / W;
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
    const share = covered / (W * H);
    if (share < 0.03) return { error: "на фото не нашлось главного предмета" };
    if (share > 0.9) return { error: "фото не отделилось от фона" };
    // The paper margin is as wide as a pair of scissors leaves: about 2% of the subject.
    // Without paper (a drawn character) the subject keeps only its own edge.
    const paperless = opts.paper === false;
    const border = paperless ? 0 : Math.max(8, Math.round(0.02 * Math.max(x1 - x0, y1 - y0)));
    const pad = border + 6;
    const left = Math.max(0, x0 - pad), top = Math.max(0, y0 - pad);
    const cw = Math.min(W, x1 + pad + 1) - left, ch = Math.min(H, y1 + pad + 1) - top;
    const canvas = { width: cw + 2 * pad, height: ch + 2 * pad };
    const cropAlpha = await sharp(alpha, { raw: { width: W, height: H, channels: 1 } }).extract({ left, top, width: cw, height: ch })
      .extend({ top: pad, bottom: pad, left: pad, right: pad, background: { r: 0, g: 0, b: 0 } }).extractChannel(0).raw().toBuffer();
    // The margin: the silhouette grown by `border`, with a slightly ragged, hand-cut edge.
    const grown = paperless ? cropAlpha : await sharp(cropAlpha, { raw: { ...canvas, channels: 1 } }).blur(border * 0.55).extractChannel(0).raw().toBuffer();
    const paper = Buffer.alloc(canvas.width * canvas.height);
    for (let i = 0; i < paper.length; i++) paper[i] = paperless ? 0 : grown[i] > 10 ? 255 : Math.round(grown[i] * 25.5);
    const paperAlpha = await sharp(paper, { raw: { ...canvas, channels: 1 } }).blur(0.7).extractChannel(0).raw().toBuffer();
    let picture = sharp(rgb, { raw: { width: W, height: H, channels: CH } }).extract({ left, top, width: cw, height: ch })
      .extend({ top: pad, bottom: pad, left: pad, right: pad, background: { r: 255, g: 255, b: 255 } });
    // Archive look: black and white with a little more contrast, the way a newspaper print is cut out.
    if (!opts.color && !paperless) picture = picture.greyscale().linear(1.16, -14).toColourspace("srgb");
    const { data: pictureRgb, info: shown } = await picture.raw().toBuffer({ resolveWithObject: true });
    const channels = shown.channels;
    const rgba = Buffer.alloc(canvas.width * canvas.height * 4);
    for (let i = 0; i < canvas.width * canvas.height; i++) {
      const a = cropAlpha[i] / 255, p = paperAlpha[i] / 255;
      const r = channels === 1 ? pictureRgb[i] : pictureRgb[i * channels], g = channels === 1 ? pictureRgb[i] : pictureRgb[i * channels + 1], b = channels === 1 ? pictureRgb[i] : pictureRgb[i * channels + 2];
      // Photo over white paper; the paper's own edge is the outer alpha.
      rgba[i * 4] = Math.round(r * a + 250 * (1 - a));
      rgba[i * 4 + 1] = Math.round(g * a + 248 * (1 - a));
      rgba[i * 4 + 2] = Math.round(b * a + 243 * (1 - a));
      rgba[i * 4 + 3] = Math.round(255 * Math.max(a, p));
    }
    fs.mkdirSync(path.dirname(out), { recursive: true });
    await sharp(rgba, { raw: { ...canvas, channels: 4 } }).png({ compressionLevel: 8 }).toFile(out);
    return { file: out, size: { w: canvas.width, h: canvas.height } };
  } catch (error) {
    return { error: `вырезка не получилась: ${String((error as Error).message).replace(/\s+/g, " ").slice(0, 160)}` };
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}
