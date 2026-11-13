// The picture montage («С картинками»): the site plans the shots, this module prepares their pictures and writes
// the montage from the blocks of src/kit/Pictures.tsx. Nothing here is written by a model, so it always builds.
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import type { PictureCut, PictureMotion } from "../src/kit/Pictures";
import { inPool, realPhoto } from "./assets";
import { postBridge } from "./bridge";

export type CardsLayout = "split" | "full" | "author";

/** One shot of the plan, in seconds of the cleaned recording. */
export type CardsShot = {
  from: number;
  to: number;
  layout: CardsLayout;
  /** A picture on disk: a photo of the story found by the site's media library. */
  file?: string;
  /** A picture to draw: the moment as a real photo would show it, in English, with its facts. */
  scene?: string;
  /** A real photo of a known person, place or thing: the Wikipedia article (English) and a search query. */
  real?: { query: string; wiki?: string };
  /** Taken when the picture cannot be prepared: another photo on disk. */
  backup?: string;
  motion?: PictureMotion;
  cut?: PictureCut;
  /** A strong moment of the story: the picture comes in with a flash or a zoom and a hit. */
  accent?: boolean;
};

/** One look for the drawn pictures: a real news photo, never an illustration. */
const SCENE_LOOK = "Photorealistic photo, as if taken on a good phone camera for a news story: natural light, real materials and people, " +
  "realistic proportions, sharp focus on the subject. The main subject and every important person and object are large, whole and close together, " +
  "nothing important touches an edge. No text, no captions, no watermark, no logos except those on real objects. Scene: ";

const tag = (text: string) => createHash("sha1").update(text).digest("hex").slice(0, 12);
const rel = (publicDir: string, file: string) => path.relative(publicDir, file).split(path.sep).join("/");

/** Pictures bigger than this are brought down before the render: every render tab decodes them on every frame. */
const MAX_SIDE = 2400;

async function sizeOf(file: string): Promise<{ w: number; h: number } | null> {
  const m = await sharp(file).metadata().catch(() => null);
  if (!m?.width || !m.height) return null;
  // EXIF rotation swaps the sides the browser shows.
  return (m.orientation ?? 1) >= 5 ? { w: m.height, h: m.width } : { w: m.width, h: m.height };
}

/** A photo of the library, upright and not larger than the render needs, in the job's public folder. */
async function importPhoto(file: string, dir: string): Promise<string | null> {
  if (!fs.existsSync(file)) return null;
  const stat = fs.statSync(file);
  const out = path.join(dir, `${tag(`${path.resolve(file)}|${stat.size}|${stat.mtimeMs}`)}.jpg`);
  if (fs.existsSync(out)) return out;
  fs.mkdirSync(dir, { recursive: true });
  try {
    await sharp(file).rotate().resize(MAX_SIDE, MAX_SIDE, { fit: "inside", withoutEnlargement: true }).flatten({ background: "#0D1115" }).jpeg({ quality: 90 }).toFile(out);
    return out;
  } catch {
    return null;
  }
}

/** Draws a scene: square for the upper panel, a full phone screen for a full-screen shot. Kept by its prompt between runs. */
async function drawScene(prompt: string, aspect: "1:1" | "9:16", dir: string, log: (line: string) => void): Promise<string | null> {
  const file = path.join(dir, `${tag(`${aspect}|${SCENE_LOOK}${prompt}`)}.png`);
  if (fs.existsSync(file)) return file;
  // The image tool sometimes ends a run without a picture; a second try usually gives one.
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const result = await postBridge<{ base64: string }>("/image", { prompt: SCENE_LOOK + prompt, aspectRatio: aspect, references: [], mode: "generate" },
        20 * 60_000, process.env.CODEX_IMAGE_BRIDGE_URL ?? process.env.CODEX_BRIDGE_URL);
      if (!result?.base64) continue;
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(file, Buffer.from(result.base64, "base64"));
      return file;
    } catch (error) {
      log(`Сцена не нарисовалась (${attempt}): ${String((error as Error).message).slice(0, 160)}`);
    }
  }
  return null;
}

export type PreparedPictures = {
  /** The shots with every picture resolved to a public path; a shot whose picture failed becomes the author. */
  shots: (CardsShot & { src?: string })[];
  assets: Record<string, string>;
  sizes: Record<string, { w: number; h: number }>;
  notes: string[];
};

/**
 * Brings every picture of the plan into the public folder: library photos are copied upright, scenes are drawn
 * (three at a time), real photos are taken from Wikipedia. A picture that cannot be had falls back to the shot's backup,
 * and without one the shot shows the author: the video is made either way.
 */
export async function preparePictures(shots: CardsShot[], publicDir: string, subdir: string, cacheDir: string, log: (line: string) => void): Promise<PreparedPictures> {
  const photos = path.join(publicDir, subdir, "cards");
  const scenes = path.join(cacheDir, "cards-scenes");
  const reals = path.join(cacheDir, "real");
  const assets: Record<string, string> = {};
  const sizes: Record<string, { w: number; h: number }> = {};
  const notes: string[] = [];
  const put = async (file: string | null): Promise<string | undefined> => {
    if (!file) return undefined;
    const key = rel(publicDir, file);
    if (!sizes[key]) {
      const size = await sizeOf(file);
      if (!size) return undefined;
      sizes[key] = size;
    }
    assets[key] = key;
    return key;
  };
  const resolved = await inPool(shots.map(shot => async () => {
    if (shot.layout === "author") return { ...shot };
    let src: string | undefined;
    if (shot.file) src = await put(await importPhoto(shot.file, photos));
    else if (shot.scene) {
      const drawn = await drawScene(shot.scene, shot.layout === "full" ? "9:16" : "1:1", scenes, log);
      src = await put(drawn ? await importPhoto(drawn, photos) : null);
      if (!src) notes.push(`сцена не нарисовалась: ${shot.scene.slice(0, 80)}`);
    } else if (shot.real) {
      const found = await realPhoto(shot.real.query, shot.real.wiki, reals).catch(() => null);
      src = await put(found ? await importPhoto(found, photos) : null);
      if (!src) notes.push(`настоящее фото не нашлось: ${shot.real.wiki ?? shot.real.query}`);
    }
    if (!src && shot.backup) src = await put(await importPhoto(shot.backup, photos));
    if (!src) return { ...shot, layout: "author" as const };
    // A wide photo that stood in for a tall scene goes to the upper panel: over the whole screen it is a strip on a blur.
    const wide = sizes[src].w / sizes[src].h > 0.8;
    return { ...shot, src, layout: shot.layout === "full" && wide ? "split" as const : shot.layout };
  }));
  return { shots: resolved, assets, sizes, notes };
}

/** A shot with its picture resolved. */
type Ready = PreparedPictures["shots"][number];

/**
 * The montage file for the shots: runs of panel pictures, full-screen pictures, camera punches on the author's own
 * moments, quiet whooshes on the big changes, the owner's music and the one-word captions.
 */
export function cardsMontage(input: { shots: Ready[]; duration: number; emphasis?: number[] }): string {
  const shots = [...input.shots].sort((a, b) => a.from - b.from);
  // An author moment shorter than this between two panel pictures keeps the panel open: it would only flicker.
  // It is longer than the kit's JOIN_GAP, which would otherwise stretch one run over the next.
  const SHORT_AUTHOR = 1.6;
  const merged: Ready[] = [];
  for (const shot of shots) {
    const last = merged[merged.length - 1];
    // The same picture twice in a row (a backup that stood in) is one longer shot.
    const same = last && last.layout === shot.layout && (shot.layout === "author" || last.src === shot.src);
    if (same) { last.to = shot.to; continue; }
    merged.push({ ...shot });
  }
  for (let i = 1; i < merged.length - 1; i++) {
    const s = merged[i];
    if (s.layout === "author" && s.to - s.from < SHORT_AUTHOR && merged[i - 1].layout === "split" && merged[i + 1].layout === "split") {
      merged[i - 1].to = s.to;
      merged.splice(i, 1);
      i--;
    }
  }
  // Every shot ends where the next begins; the last one holds to the end of the video.
  merged.forEach((s, i) => { s.to = i + 1 < merged.length ? merged[i + 1].from : Math.max(s.to, input.duration); });

  const runs: { from: number; to: number; shots: Ready[] }[] = [];
  const fulls: Ready[] = [];
  const authors: Ready[] = [];
  for (const s of merged) {
    if (s.layout === "split") {
      const run = runs[runs.length - 1];
      if (run && Math.abs(run.to - s.from) < 0.01) { run.shots.push(s); run.to = s.to; }
      else runs.push({ from: s.from, to: s.to, shots: [s] });
    } else if (s.layout === "full") fulls.push(s);
    else authors.push(s);
  }

  // A full-screen picture covers the panel's comings and goings: the panel is already open when the picture leaves,
  // and closes under the picture that comes over it. The author never flashes between the two.
  const fullFrom = new Set(fulls.map(f => round(f.from)));
  const fullTo = new Set(fulls.map(f => round(f.to)));
  for (const f of fulls) if (runs.some(r => Math.abs(r.from - f.to) < 0.01)) f.to += 0.25;

  const sounds: { at: number; role: string }[] = [];
  const sound = (at: number, role: string) => {
    // Sounds stay in the background: never two within a second and a half.
    if (at < 0.15 || sounds.some(x => Math.abs(x.at - at) < 1.5)) return;
    sounds.push({ at, role });
  };
  const cutOf = (s: Ready, k: number): PictureCut => s.cut ?? (s.accent ? (k % 2 ? "flash" : "zoom") : k % 3 === 2 ? "slide" : "pop");
  const lines: string[] = [];
  for (const run of runs) {
    const list = run.shots.map((s, k) => ({ from: round(s.from), to: round(s.to), src: s.src!, ...(s.motion ? { motion: s.motion } : {}), ...(k ? { cut: cutOf(s, k) } : {}) }));
    const open = run.from < 0.1 || fullTo.has(round(run.from));
    const to = fullFrom.has(round(run.to)) ? run.to + 0.45 : run.to;
    lines.push(`    <PictureRun from={${round(run.from)}} to={${round(to)}}${open ? " open" : ""} shots={${JSON.stringify(list)}} />`);
    if (!open) sound(run.from, "whoosh");
    run.shots.forEach((s, k) => {
      if (!k) return;
      const cut = cutOf(s, k);
      if (s.accent) sound(s.from, "impact");
      else if (cut === "slide") sound(s.from, "swipe");
    });
  }
  fulls.forEach((s, k) => {
    const cut: PictureCut = s.cut ?? (s.accent ? "flash" : k % 2 ? "zoom" : "pop");
    lines.push(`    <FullPicture from={${round(s.from)}} to={${round(s.to)}} src=${JSON.stringify(s.src)}${s.motion ? ` motion="${s.motion}"` : ""} cut="${cut}" />`);
    sound(s.from, s.accent ? "impact" : "whoosh");
  });
  for (const s of sounds.sort((a, b) => a.at - b.at)) lines.push(`    <Sfx at={${round(s.at)}} role="${s.role}" />`);

  // The author's own moments get the camera: a push on the opening line, punches in on the others, back at their end.
  const camera: string[] = [];
  authors.forEach((s, k) => {
    if (s.to - s.from < 0.8) return;
    if (s.from < 0.1) camera.push(`cam.push(0, ${round(Math.min(3, s.to - 0.05))}, 1.1)`);
    else camera.push(`cam.punch(${round(s.from)}, ${k % 2 ? 1.18 : 1.12})`);
    camera.push(`cam.reset(${round(s.to)})`);
  });

  return [
    `import React from "react";`,
    `import { AstraVideo, cam, Captions, Sfx, Music } from "../kit";`,
    `import { PictureRun, FullPicture } from "../kit/Pictures";`,
    ``,
    `export const Montage: React.FC = () => (`,
    `  <AstraVideo accent="scene" camera={[${camera.join(", ")}]}>`,
    ...lines,
    `    <Music mood="tense" />`,
    `    <Captions emphasis={${JSON.stringify(input.emphasis ?? [])}} />`,
    `  </AstraVideo>`,
    `);`,
    ``,
  ].join("\n");
}

const round = (n: number) => Math.round(n * 100) / 100;
