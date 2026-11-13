import sharp from "sharp";

/**
 * The color the author's own frame is lit with — a neon strip, a lamp, a painted wall — so the graphics can take
 * their accent from the video instead of bringing one of their own. Null when the frame has no clear color of its own.
 */
export async function sceneColor(files: string[]): Promise<string | null> {
  const BINS = 24;
  const weight = new Float64Array(BINS);
  const rgb = Array.from({ length: BINS }, () => [0, 0, 0]);
  let pixels = 0;
  for (const file of files) {
    const { data } = await sharp(file).resize(72, 128, { fit: "fill" }).removeAlpha().raw().toBuffer({ resolveWithObject: true }).catch(() => ({ data: null }));
    if (!data) continue;
    for (let i = 0; i + 2 < data.length; i += 3) {
      pixels++;
      const r = data[i] / 255, g = data[i + 1] / 255, b = data[i + 2] / 255;
      const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
      const s = max === 0 ? 0 : d / max;
      if (s < 0.25 || max < 0.2) continue;
      let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
      h = (h * 60 + 360) % 360;
      // Skin and warm wood are the author and the furniture, not the light of the room.
      if (h < 45 && s < 0.75) continue;
      const w = s * max;
      const bin = Math.floor(h / (360 / BINS)) % BINS;
      weight[bin] += w;
      rgb[bin][0] += r * w; rgb[bin][1] += g * w; rgb[bin][2] += b * w;
    }
  }
  if (!pixels) return null;
  // The strongest hue with its neighbours: a gradient of one light spreads over two bins.
  let best = -1, bestWeight = 0;
  for (let i = 0; i < BINS; i++) {
    const around = weight[(i + BINS - 1) % BINS] * 0.5 + weight[i] + weight[(i + 1) % BINS] * 0.5;
    if (around > bestWeight) { bestWeight = around; best = i; }
  }
  // A few colored pixels are a poster or a cup; the frame's own light covers a noticeable part of it.
  if (best < 0 || weight[best] / pixels < 0.025) return null;
  const [r, g, b] = rgb[best].map(c => c / weight[best]);
  return tune(r, g, b);
}

/** The found color brought to an accent: clear and bright enough to read on a dark board. */
function tune(r: number, g: number, b: number): string {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d > 0) h = (max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4) * 60;
  h = (h + 360) % 360;
  const l0 = (max + min) / 2;
  const s0 = d === 0 ? 0 : d / (1 - Math.abs(2 * l0 - 1));
  return hsl(h, Math.min(0.82, Math.max(0.55, s0)), 0.56);
}

function hsl(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return "#" + [r, g, b].map(v => Math.round((v + m) * 255).toString(16).padStart(2, "0")).join("").toUpperCase();
}
