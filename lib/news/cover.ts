import fs from "fs";
import http from "http";
import https from "https";
import path from "path";
import { execFile } from "child_process";
import type { NewsCover, NewsProject } from "./types";
import { getProject, mutate, NewsError, newsRoot, projectDir, videoPath } from "./store";
import { siteSpend, storyText } from "./meta";
import { projectTitle } from "./rules";
import { generateCoverConcept, type CoverConcept } from "../cover";
import { resolveHeadline } from "../coverHeadline";
import { encodeFinalCover, fullAiCoverEnabled } from "../coverProvider";
import { ffmpegBin } from "../ffmpeg";
import { mediaVision } from "../mediaLlm";

/**
 * Cover of a «Новости» video: GPT draws the host inside the story (the clean frame the PC sends is the reference for the
 * story's hero and scene) with no text, and the headline goes over it in the single news style (composeNewsCover, owner
 * 3.11). The headline comes from the main concept writer and passes the same preflight gate. The styles «post» and
 * «poster» (29.10, GPT drew the headline too) stay below only for the covers already made with them.
 */

export const COVER_FILE = "cover.jpg";
export const PREV_COVER_FILE = "cover-prev.jpg";
const WORK_DIR = "cover-work";
export const HEADLINE_MAX = 60;

// ---- the frame

const PROBE_W = 54;
const PROBE_H = 96;
/** Where to look: 30% first (past the hook, inside the story), then around it. */
export const FRAME_POINTS = [0.3, 0.2, 0.45, 0.6, 0.75];
/** The video opens with a full-frame flash: no frame from it. */
export const INTRO_SECONDS = 1.5;

export type FrameScore = { at: number; score: number };

/**
 * How good a small RGB frame is as a cover reference: its contrast (a dark, blank or washed-out frame scores 0),
 * a bit more when warm skin tones are in it — the hero's face is what the cover is about.
 */
export function scoreFrame(rgb: Uint8Array): number {
  const n = Math.floor(rgb.length / 3);
  if (!n) return 0;
  let sum = 0;
  let sq = 0;
  let skin = 0;
  for (let i = 0; i < n; i++) {
    const r = rgb[i * 3] / 255;
    const g = rgb[i * 3 + 1] / 255;
    const b = rgb[i * 3 + 2] / 255;
    const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    sum += y;
    sq += y * y;
    const max = Math.max(r, g, b);
    const d = max - Math.min(r, g, b);
    const s = max ? d / max : 0;
    let h = 0;
    if (d) h = max === r ? 60 * (((g - b) / d) % 6) : max === g ? 60 * ((b - r) / d + 2) : 60 * ((r - g) / d + 4);
    if (h < 0) h += 360;
    if (h >= 5 && h <= 45 && s >= 0.15 && s <= 0.6 && max >= 0.35) skin++;
  }
  const mean = sum / n;
  const std = Math.sqrt(Math.max(0, sq / n - mean * mean));
  // a dark, washed-out or blank frame (a single color, a fade) is no reference at all
  if (mean < 0.12 || mean > 0.92 || std < 0.03) return 0;
  return std * (1 + Math.min(0.3, skin / n));
}

/** The best-scored frame; 30% of the video (past the intro) when none scores. */
export function pickFrame(scores: FrameScore[], duration: number): number {
  let best: FrameScore | null = null;
  for (const s of scores) if (s.score > 0 && (!best || s.score > best.score)) best = s;
  return best ? best.at : frameTime(duration, FRAME_POINTS[0]);
}

const frameTime = (duration: number, point: number) => {
  const d = Math.max(0, duration);
  return Math.round(Math.min(Math.max(d * point, INTRO_SECONDS), Math.max(0, d - 0.2)) * 100) / 100;
};

function ffmpeg(args: string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    execFile(ffmpegBin(), args, { encoding: "buffer", maxBuffer: 32 * 1024 * 1024, timeout: 60_000, windowsHide: true }, (err, stdout, stderr) => {
      if (err) reject(new Error(`ffmpeg: ${String(stderr || err.message).slice(-300)}`));
      else resolve(stdout);
    });
  });
}

/** A few tiny frames are scored (cheap), the chosen one is taken at full size as the image model's reference. */
export async function grabFrame(video: string, workDir: string, duration: number): Promise<{ file: string; at: number }> {
  const scores: FrameScore[] = [];
  for (const point of FRAME_POINTS) {
    const at = frameTime(duration, point);
    try {
      const raw = await ffmpeg(["-v", "error", "-ss", String(at), "-i", video, "-frames:v", "1", "-vf", `scale=${PROBE_W}:${PROBE_H}`, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]);
      scores.push({ at, score: scoreFrame(raw) });
    } catch {
      // a timestamp that does not decode is simply not a candidate
    }
  }
  const at = pickFrame(scores, duration);
  const file = path.join(workDir, "frame.jpg");
  await ffmpeg(["-v", "error", "-y", "-ss", String(at), "-i", video, "-frames:v", "1", "-q:v", "2", file]);
  return { file, at };
}

// ---- the prompt

/** The concept writer is made for the owner's photo covers; this tells it what the video is, so the headline fits. */
const STYLE_HINT =
  "это ролик-новость: голос автора пересказывает вирусную историю из интернета поверх видео самого героя истории. " +
  "Заголовок — суть истории, понятная без ролика.";

/**
 * Two cover styles the owner chose from four drawn on the Vaseline story (29.10: «оставляем эти 2 варианта, пусть делают
 * точно по тем же промтам»): «post» — the hero pops out of a viral post card on a deep blue background, headline on
 * top with the key word in a yellow box; «poster» — a cinematic movie poster, headline at the bottom with the key word
 * in red. The prompts are those very texts; only the hero, the story's object and the headline change per video.
 */
export type CoverStyle = "hero" | "post" | "poster" | "news";
/**
 * The style of every cover nobody chose: «poster», the cover of «МУЖИК СТАЛ МЕМОМ» — the owner in close-up holding the
 * story's object on a black background, the headline at the bottom with the key word in red (owner 5.11: «обложки как
 * было у "мужик стал мемом" там черный фон и я держал песок»). Before it «hero» — the Vaseline cover (4.11), and «post»,
 * the owner on the blue background (3.11); «hero», «post» and «news» are drawn when asked by name.
 */
export const DEFAULT_COVER_STYLE: CoverStyle = "poster";
export const isCoverStyle = (v: unknown): v is CoverStyle => v === "hero" || v === "post" || v === "poster" || v === "news";

/** The clean frame the PC sends with the video (runner/frame): the first shot of the hero's clip, no subtitles. */
export const COVER_FRAME_FILE = "cover-frame.jpg";

/** The headline font: Impact is put into the site layer at build time (news/deploy/site/prepare.sh), else FreeSans Bold. */
const HEADLINE_FONTS = [
  { file: path.join(process.cwd(), "lib", "news", "fonts", "impact.ttf"), family: "Impact" },
  { file: "/usr/share/fonts/truetype/freefont/FreeSansBold.ttf", family: "FreeSans Bold" },
];

const escapeMarkup = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * One cover style for every news video (owner 3.11: «один текст жёлтый, другой белый — уже не нравится, нужен один стиль,
 * чтобы в сетке Инстаграма выглядели норм»; he chose variant A of two mock-ups): the picture GPT drew (newsPicturePrompt)
 * over the whole 9:16, a dark fade from the middle down, the headline in white capitals bottom-left with a short red bar
 * above it. Everything sits inside the 3:4 the profile grid shows (y 240–1680) and above its view counter (bottom 11% of
 * the cell). The text is ours, not the image model's: the same look every time, nothing misspelt.
 */
export async function composeNewsCover(frame: string, headline: string, out: string): Promise<void> {
  const sharp = (await import("sharp")).default;
  const W = 1080;
  const H = 1920;
  const font = HEADLINE_FONTS.find((f) => fs.existsSync(f.file)) ?? HEADLINE_FONTS[1];
  const text = escapeMarkup(headline.toUpperCase().trim());
  // up to three lines: a long headline gets a smaller size rather than a fourth line
  let block: { data: Buffer; info: { width: number; height: number } } | null = null;
  for (const size of [132, 118, 104, 92]) {
    block = await sharp({ text: { text: `<span foreground="#ffffff">${text}</span>`, font: `${font.family} ${size}`, fontfile: font.file, width: W - 120, rgba: true, wrap: "word", dpi: 72 } })
      .png()
      .toBuffer({ resolveWithObject: true });
    if (block.info.height <= size * 1.25 * 3) break;
  }
  const bottom = 1490;
  const top = bottom - block!.info.height;
  const shade = Buffer.from(
    `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">` +
      // плотная тень под заголовком: надписи и цифры кадра под ним не просвечивают (3.11, таймер в ролике про Марио)
      `<stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset="0.4" stop-color="#000" stop-opacity="0"/>` +
      `<stop offset="0.62" stop-color="#000" stop-opacity="0.82"/><stop offset="0.8" stop-color="#000" stop-opacity="0.93"/><stop offset="1" stop-color="#000" stop-opacity="0.96"/></linearGradient></defs>` +
      `<rect width="${W}" height="${H}" fill="url(#g)"/><rect x="60" y="${top - 38}" width="160" height="14" fill="#e61e28"/></svg>`,
  );
  await sharp(frame)
    .resize(W, H, { fit: "cover", position: "centre" })
    .composite([{ input: shade }, { input: block!.data, left: 60, top }])
    .jpeg({ quality: 90 })
    .toFile(out);
}

/** The word that gets the colour: the story's anchor word when the headline has it, otherwise the last word. */
export function keyWord(concept: CoverConcept): string {
  const words = concept.headlineLines.map((l) => l.text).join(" ").split(/\s+/).filter(Boolean);
  const anchors = (concept.headlineAnchor ?? []).map((a) => a.toLowerCase());
  return words.find((w) => anchors.some((a) => w.toLowerCase().replace(/[^\p{L}\p{N}-]/gu, "").startsWith(a.slice(0, Math.max(4, a.length - 2))))) ?? words[words.length - 1] ?? "";
}

/**
 * Owner 29.10: «на обложках можно делать меня главным героем, только лица у тебя разные получаются, и меняй одежду,
 * главное чтобы лицо было 1в1» — with his photos (owner-faces/) he is the main person: his face from all of them, new
 * clothes on every cover. In the poster the object may glow, the light on him stays natural («то что освещается герой
 * и всё остальное выглядит не очень»).
 */
export const OUTFITS = [
  "a plain black oversized t-shirt and a thin silver chain",
  "a dark charcoal knit sweater",
  "a white t-shirt under an open beige overshirt",
  "a black leather jacket over a black t-shirt",
  "a grey hoodie",
  "a navy bomber jacket over a white t-shirt",
  "a black button-up shirt with the top buttons open",
  "an olive green overshirt over a black t-shirt",
];

/**
 * Сетка профиля Инстаграма и TikTok показывает обложку 9:16 обрезанной до 3:4 по центру (владелец 30.10: «там она
 * обрезается сверху и целое слово не видно»). Просьбу держать заголовок ниже края GPT не слушался («ВЗЛОМ» у самого
 * верха и в сетке срезан), поэтому картинка рисуется 4:5 и растягивается на всю клетку 3:4, а до 9:16 её дополняют поля,
 * уходящие в тень (finishNewsCover). Раньше 4:5 стояла в 3:4 как есть, и по 45 px полей сверху и снизу попадали в сетку
 * границами (владелец 31.10: «почему сверху видно границу и снизу тоже?»).
 */
const COVER_ASPECT = "4:5";
/** Внизу клетки сетки Инстаграм пишет число просмотров — заголовок стоит выше (31.10, «МУЖИК СТАЛ МЕМОМ»). */
const GRID_SAFE =
  "Leave margin around the headline and the faces: nothing important within the outer 4% of the left and right edges, " +
  "the top of the head a little below the top edge, and the bottom of the headline about 15% above the bottom edge — " +
  "the bottom corner of the thumbnail is covered by the view counter.";

/**
 * The single news style (owner 3.11: «я думал ты будешь их генерировать и делать красивыми, ещё добавлять меня»): GPT draws
 * the picture — the host inside the story, next to its hero from the video frame — with no text at all; the headline is
 * laid over it in one look by composeNewsCover, so every cover in the grid matches and nothing is misspelt. Natural light
 * like a reportage photo: neon glow and «AI cinema» haze the owner rejected (01.11).
 */
function newsPicturePrompt(concept: CoverConcept, host?: { outfit: string }): string {
  const object = concept.scene?.storyObject?.trim() || "the key object of the story";
  const place = concept.scene?.environment?.trim() || "the place where the story happened";
  const mood = concept.emotion?.trim() || "genuine surprise";
  const story =
    `The story's hero and scene come from reference 1 (a frame of the video): keep the hero recognizable as in that frame, ` +
    `with the ${object}, in ${place}. Ignore any subtitles, captions, stickers or interface text in the reference.`;
  const who = host
    ? `The man from references 2, 3, 4 and 5 is the channel's host. His face must be exactly his, a 1:1 likeness as in those ` +
      `photos — the same face shape, eyes, eyebrows, nose, lips, ears with the small earring and his short bleached blond hair; ` +
      `not a similar-looking man. He wears ${host.outfit}, not the clothes from the photos. He stands in the foreground of the ` +
      `story's scene, seen from the chest up, turned a little towards the hero and the ${object}, reacting with ${mood}, ` +
      `looking at the viewer. The hero of the story is right behind him or beside him, clearly visible.`
    : `The hero of the story is the main person, seen from the chest up, reacting with ${mood}.`;
  return (
    `${who} ${story} Vertical 4:5 photorealistic cover photo for a short viral news video, made to be clicked at thumbnail ` +
    `size: natural daylight or the scene's own light, like a real reportage photo — no neon glow, no glowing haze, no light ` +
    `rays, no cinematic orange-teal grading. Faces and the ${object} in the upper two thirds of the picture; the bottom third ` +
    `is calm background with no faces and no important details, a headline will be laid over it later. Absolutely no text, ` +
    `letters, numbers, captions, logos, watermarks or interface anywhere in the picture. Nothing important within the outer ` +
    `4% of the left and right edges; the top of the heads a little below the top edge.`
  );
}

/**
 * The Vaseline cover (28.10, «ВАЗЕЛИН СМЕНИЛ ИМЯ» — the owner's favourite: «мне понравился только про вазелин»): the hero of
 * the story from the video frame, redrawn large and photographic, the headline at the bottom with the key word in a yellow
 * box; no host on it. Owner 4.11: «давай вернемся к старым обложкам как у вазелина, только нужно подогнать для инсты как
 * сейчас». GPT draws the picture only: asked to keep the headline above the grid's view counter it still put the last line
 * at the very edge every time («МАЙКЛА СВЕРНУЛИ», «ТАКСИ», «ЗАКРЫЛИ»), so the headline is laid by composeHeroCover in the
 * Vaseline look, where the counter never reaches it. Drawn 4:5 to fill the 3:4 grid cell (finishNewsCover).
 */
function heroCoverPrompt(concept: CoverConcept): string {
  const object = concept.scene?.storyObject?.trim() || "the key object of the story";
  const reference =
    "The attached image is a frame from our short vertical news video about a viral internet story; the person in it — or, " +
    "when there is no person, the main subject — is the hero of the story. Use it as the reference for the hero's look, " +
    "clothes and hairstyle and for the setting and the mood. Ignore any subtitles, captions, stickers, badges or interface " +
    "text in the frame and never copy them.";
  const style =
    "Redraw it as a punchy photographic viral news cover picture: the same hero and the same kind of place, sharper and more " +
    "dramatic — crisp detail, strong contrast, rich but natural colors, a soft vignette, like the cover of a top short-form " +
    "news channel. Photographic, not an illustration, not a 3D render, not anime.";
  const composition =
    "Vertical 4:5 picture. The hero fills the upper 60% of the picture, large and close, with a clear readable emotion" +
    (concept.emotion ? ` (${concept.emotion})` : "") +
    `; the ${object} may appear next to them. One simple uncluttered background taken from the frame, slightly out of focus. ` +
    "The lower 40% continues the same scene calmly — the hero's body or the background, no faces there: a big headline " +
    "will be laid over it later. The top of the head a little below the top edge; nothing important within the outer 4% of " +
    "the left and right edges.";
  const noText =
    "Absolutely no text, letters, numbers, captions, logos, badges, watermarks, interface elements or pseudo-text anywhere " +
    "in the picture.";
  const negatives =
    "Strictly not: a different person, a changed face, extra people, cartoon or 3D style, anime, comic panels, extra or " +
    "missing limbs, distorted hands, a busy background, neon glow, floating particles, fake HUD, a phone interface.";
  return [reference, style, composition, noText, negatives].join(" ");
}

/** Impact is wider than the letters of the Vaseline cover: squeezed to their super-condensed shape. */
const HERO_SQUEEZE = 0.76;

/**
 * The Vaseline headline laid over the 9:16 cover: Impact capitals squeezed narrow, as wide as the cover allows, lines close
 * together; the key word black in a yellow box, the other words white with a soft shadow; the block centred, its bottom at
 * 85% of the 3:4 grid cell (y 240–1680) — above Instagram's view counter in the cell's bottom corner.
 */
export async function composeHeroCover(picture: string, lines: string[], key: string, out: string): Promise<void> {
  const sharp = (await import("sharp")).default;
  const W = 1080;
  const H = 1920;
  const CELL_TOP = 240;
  const CELL_H = 1440;
  const MAX_W = 1000;
  const font = HEADLINE_FONTS.find((f) => fs.existsSync(f.file)) ?? HEADLINE_FONTS[1];
  const keyLetters = lettersOf(key);
  type Ink = { data: Buffer; width: number; height: number; x0: number; x1: number; y0: number };
  // one word: rendered, squeezed, with the columns its ink spans (words have different side bearings). libvips cuts the
  // picture to the ink, so «МАЙКЛ» (the breve of Й) sat lower than «КОТ» and slid out of its yellow box (4.11): an
  // invisible «ЙЩ» after every word gives all of them one height and one baseline
  const word = async (text: string, size: number, color: string): Promise<Ink> => {
    const markup = `<span foreground="${color}">${escapeMarkup(text)}</span><span foreground="#000000" fgalpha="1">ЙЩ</span>`;
    const r = await sharp({ text: { text: markup, font: `${font.family} ${size}`, fontfile: font.file, rgba: true, dpi: 72 } })
      .png()
      .toBuffer({ resolveWithObject: true });
    const { data, info } = await sharp(r.data).resize(Math.max(1, Math.round(r.info.width * HERO_SQUEEZE)), r.info.height, { fit: "fill" }).raw().toBuffer({ resolveWithObject: true });
    let x0 = info.width;
    let x1 = 0;
    let y0 = info.height;
    for (let y = 0; y < info.height; y++)
      for (let x = 0; x < info.width; x++)
        if (data[(y * info.width + x) * 4 + 3] > 40) {
          x0 = Math.min(x0, x);
          x1 = Math.max(x1, x);
          y0 = Math.min(y0, y);
        }
    // cut to the word's own columns: the invisible «ЙЩ» stays out of the layer (at a big size it made the layer wider
    // than the cover, and sharp refused it)
    const left = Math.min(x0, info.width - 1);
    const width = Math.max(1, Math.max(x0, x1) - left + 1);
    const cut = await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).extract({ left, top: 0, width, height: info.height }).raw().toBuffer();
    return { data: cut, width, height: info.height, x0: 0, x1: width - 1, y0 };
  };
  // rows of a capital at this size: where the yellow box and the line step come from
  const capRows = async (size: number) => {
    const g = await word("Н", size, "#ffffff");
    let top = g.height;
    let bot = 0;
    for (let y = 0; y < g.height; y++)
      for (let x = 0; x < g.width; x++)
        if (g.data[(y * g.width + x) * 4 + 3] > 40) {
          top = Math.min(top, y);
          bot = Math.max(bot, y);
        }
    return { top, h: Math.max(1, bot - top + 1) };
  };
  const rows = lines.map((l) => l.toUpperCase().split(/\s+/).filter(Boolean)).filter((l) => l.length);
  type Laid = { words: { ink: Ink; isKey: boolean }[]; width: number };
  let size = 300;
  let laid: Laid[] = [];
  for (; ; size -= 6) {
    const padX = Math.round(size * 0.07);
    const gap = Math.round(size * 0.16);
    laid = [];
    for (const ws of rows) {
      const words: Laid["words"] = [];
      let width = 0;
      for (const [i, t] of ws.entries()) {
        const isKey = lettersOf(t) === keyLetters;
        const ink = await word(t, size, isKey ? "#111111" : "#ffffff");
        words.push({ ink, isKey });
        width += ink.x1 - ink.x0 + 1 + (isKey ? 2 * padX : 0) + (i ? gap : 0);
      }
      laid.push({ words, width });
    }
    if (size <= 96 || laid.every((l) => l.width <= MAX_W)) break;
  }
  const cap = await capRows(size);
  const padX = Math.round(size * 0.07);
  const padY = Math.round(size * 0.05);
  const gap = Math.round(size * 0.16);
  // a line with Й or Ё gets room for its marks above the capitals
  // (round letters rise a few pixels over the capitals too — only real marks count)
  const marks = laid.map((l) => (l.words.some((w) => w.ink.y0 < cap.top - size * 0.06) ? Math.round(size * 0.1) : 0));
  const step = cap.h + 2 * padY + Math.round(size * 0.05);
  const bottom = CELL_TOP + Math.round(CELL_H * 0.85);
  const firstTop = bottom - step * laid.length - marks.slice(1).reduce((a, b) => a + b, 0) + Math.round(size * 0.05);
  const layers: { input: Buffer; left: number; top: number; raw?: { width: number; height: number; channels: 4 } }[] = [];
  let boxes = "";
  for (const [li, line] of laid.entries()) {
    const boxTop = firstTop + li * step + marks.slice(1, li + 1).reduce((a, b) => a + b, 0);
    const glyphTop = boxTop + padY - cap.top;
    let x = Math.round((W - line.width) / 2);
    for (const [i, { ink, isKey }] of line.words.entries()) {
      if (i) x += gap;
      const inkW = ink.x1 - ink.x0 + 1;
      const raw = { width: ink.width, height: ink.height, channels: 4 as const };
      if (isKey) {
        // the box grows up over the marks of Й and Ё
        const top = Math.min(boxTop, glyphTop + ink.y0 - padY);
        boxes += `<rect x="${x}" y="${top}" width="${inkW + 2 * padX}" height="${boxTop + cap.h + 2 * padY - top}" fill="#FFD21F"/>`;
        layers.push({ input: ink.data, raw, left: x + padX - ink.x0, top: glyphTop });
        x += inkW + 2 * padX;
      } else {
        const shadow = await sharp(ink.data, { raw }).linear([0, 0, 0, 0.75], [0, 0, 0, 0]).blur(6).png().toBuffer();
        layers.push({ input: shadow, left: x - ink.x0 + 3, top: glyphTop + 6 });
        layers.push({ input: ink.data, raw, left: x - ink.x0, top: glyphTop });
        x += inkW;
      }
    }
  }
  const shade = Buffer.from(
    `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">` +
      `<stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset="0.5" stop-color="#000" stop-opacity="0"/>` +
      `<stop offset="0.8" stop-color="#000" stop-opacity="0.45"/><stop offset="1" stop-color="#000" stop-opacity="0.6"/></linearGradient></defs>` +
      `<rect width="${W}" height="${H}" fill="url(#g)"/>${boxes}</svg>`,
  );
  await sharp(picture).resize(W, H, { fit: "cover", position: "centre" }).composite([{ input: shade }, ...layers]).jpeg({ quality: 90 }).toFile(out);
}

export function buildNewsCoverPrompt(concept: CoverConcept, style: CoverStyle = "poster", host?: { outfit: string }): string {
  if (style === "hero") return heroCoverPrompt(concept);
  if (style === "news") return newsPicturePrompt(concept, host);
  const headline = concept.headlineLines.map((l) => l.text).join(" ");
  const object = concept.scene?.storyObject?.trim() || "the key object of the story";
  const key = keyWord(concept);
  if (host) {
    const who =
      "The man from references 2, 3, 4 and 5 is the channel's host and the main person of this cover. His face must be " +
      "exactly his, a 1:1 likeness as in those photos — the same face shape, eyes, eyebrows, nose, lips, ears with the small " +
      `earring and his short bleached blond hair; not a similar-looking man. He wears ${host.outfit}, not the clothes from the photos.`;
    const common =
      "Vertical 4:5 cover for a short viral news video (TikTok / Reels), photorealistic, crisp, high contrast, made to be " +
      `clicked at thumbnail size. Render the exact Russian headline correctly, letter by letter; no other readable text, no ` +
      `logos except what is printed on the ${object} itself, no watermarks, no interface. ${GRID_SAFE}`;
    const scene =
      style === "post"
        ? `In the middle a big vertical social-media post card with rounded corners and a white border, showing the hero of the ` +
          `story from reference 1 with ${object}, with a red eye-shaped views icon in its corner. In the foreground the host pops ` +
          `out over the bottom edge of the card, seen from the chest up, looking at the viewer with a cheeky, curious smile. ` +
          `Deep blue gradient background. Headline at the top in huge bold condensed white letters, the word ${key} in a yellow ` +
          `box: "${headline}"`
        : `Cinematic movie-poster look: the host in close-up, dramatic low-key side light, an intense serious gaze into the ` +
          `camera, holding the ${object} in his hands. The ${object} may have a soft glow of its own, but the light on his face, ` +
          `body and the background stays natural, from the side light only — no golden or orange glow on the person, no glowing ` +
          `haze, no light rays, no sparkles. Dark moody background. Headline at the bottom in huge bold condensed letters, white ` +
          `with the word ${key} in red: "${headline}"`;
    return `${who} ${scene}. ${common}`;
  }
  const hero =
    "The person from reference 1 is the hero of a viral story: keep exactly their face, hairstyle and clothes — they must " +
    "be clearly recognizable. Ignore any subtitles, captions, stickers or interface text in the reference.";
  const common =
    "Vertical 4:5 cover for a short viral news video (TikTok / Reels), photorealistic, crisp, high contrast, made to be " +
    `clicked at thumbnail size. Render the exact Russian headline correctly, letter by letter; no other readable text, no ` +
    `logos except what is printed on the ${object} itself, no watermarks, no interface. ${GRID_SAFE}`;
  const scene =
    style === "post"
      ? `In the middle a big vertical social-media post card with rounded corners and a white border, showing the hero with ` +
        `${object}, with a red eye-shaped views icon in its corner. The hero, cut out, pops out over the bottom edge of the ` +
        `card in the foreground with a cheeky smile. Deep blue gradient background. Headline at the top in huge bold condensed ` +
        `white letters, the word ${key} in a yellow box: "${headline}"`
      : `Cinematic movie-poster look: the hero in close-up, dramatic low-key side light, an intense serious gaze into the ` +
        `camera, the ${object} glowing softly in their hands like a treasure; dark moody background with light haze. Headline ` +
        `at the bottom in huge bold condensed letters, white with the word ${key} in red: "${headline}"`;
  return `${hero} ${scene}. ${common}`;
}

/** Letters only, upper case, Ё as Е: how a drawn headline is compared with the one asked for. */
export const lettersOf = (s: string) => s.toUpperCase().replace(/Ё/g, "Е").replace(/[^\p{L}\p{N}]/gu, "");

// ---- the image

/** The image bridge the carousels, memes and 3D covers draw through (scripts/codex-image-bridge.ts, port 43129). */
const imageBridgeUrl = () => process.env.CODEX_IMAGE_BRIDGE_URL || process.env.CODEX_BRIDGE_URL || "";
/** The bridge keeps one queue for every picture of the site; past this a hung run would hold the cover slot. */
const BRIDGE_TIMEOUT = 1_850_000;

/**
 * GPT on the ChatGPT subscription draws the cover from the prompt with the video frame attached. node:http, not
 * fetch: the bridge answers only when the picture is ready, and fetch gives up waiting for headers after 5 minutes.
 */
export async function generateFromFrame(prompt: string, frameFile: string, outFile: string, extra: string[] = []): Promise<{ cost: number }> {
  const base = imageBridgeUrl();
  const token = process.env.CODEX_BRIDGE_TOKEN;
  if (!base || !token) throw new Error("NO_IMAGE_BRIDGE");
  // the frame first (reference 1), then the owner's photos (references 2…)
  const references = await Promise.all([frameFile, ...extra].map(async (f) => `data:image/jpeg;base64,${(await fs.promises.readFile(f)).toString("base64")}`));
  const body = JSON.stringify({ prompt, aspectRatio: COVER_ASPECT, mode: "generate", references });
  const url = new URL("/image", base);
  const answer = await new Promise<{ status: number; text: string }>((resolve, reject) => {
    const req = (url.protocol === "https:" ? https : http).request(
      url,
      {
        method: "POST",
        timeout: BRIDGE_TIMEOUT,
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body), Authorization: `Bearer ${token}` },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString("utf8") }));
        res.on("error", reject);
      },
    );
    req.on("timeout", () => req.destroy(new Error("IMAGE_PROVIDER_ERROR: GPT не ответил за 30 минут")));
    req.on("error", reject);
    req.end(body);
  });
  let json: { base64?: unknown; error?: unknown } = {};
  try {
    json = JSON.parse(answer.text);
  } catch {
    // the status below says what went wrong
  }
  if (answer.status !== 200 || typeof json.base64 !== "string" || !json.base64) {
    throw new Error(`IMAGE_PROVIDER_ERROR: ${answer.status} ${String(json.error ?? "картинка не вернулась").slice(0, 200)}`);
  }
  await fs.promises.writeFile(outFile, Buffer.from(json.base64, "base64"));
  return { cost: 0 };
}

// ---- the action

export type CoverDepsNews = {
  grabFrame: (video: string, workDir: string, duration: number) => Promise<{ file: string; at: number }>;
  concept: (topic: string, script: string, title: string, strictNote: string | null) => Promise<CoverConcept | null>;
  generateImage: (prompt: string, frameFile: string, outFile: string, extra?: string[]) => Promise<{ cost: number }>;
  /** The owner's face photos (data/news/owner-faces/*.jpg): with them he is the main person of the cover. */
  faces: () => string[];
  finish: (dir: string, source: string, out: string) => Promise<string>;
  encodeFinal: (dir: string, base: string, out: string) => Promise<string>;
  /** Wraps the paid part so it lands in the spend log (meta.ts siteSpend); tests run it bare. */
  spend: <T>(id: string, topic: string, fn: () => Promise<T>) => Promise<T>;
  /** Why a cover cannot be drawn at all (switched off, no bridge) — checked before the first paid call. */
  blocked: () => string | null;
  /** The big headline as drawn on the picture (GPT reads it back); null — could not read, the cover stays. */
  readText: (image: string) => Promise<string | null>;
  /** The single news style (variant A) put together from the frame and the headline: composeNewsCover. */
  compose: (frame: string, headline: string, out: string) => Promise<void>;
  /** The Vaseline headline (key word in a yellow box) laid over the hero picture: composeHeroCover. */
  composeHero: (picture: string, lines: string[], key: string, out: string) => Promise<void>;
  /** The cover as the Instagram profile grid shows it: the 3:4 centre of the 9:16 picture. */
  gridCrop: (image: string, out: string) => Promise<string>;
  /** The grid cell with the view counter's corner covered. */
  counterCrop: (grid: string, out: string) => Promise<string>;
};

/**
 * Поле 9:16 над или под клеткой: цвет её края, сильно размытый по ширине и приглушённый, плавно уходит в тень — синий
 * фон поста продолжается без ступеньки, а светлые волосы у края не тянут вверх бежевую полосу. Видно только во весь
 * экран. d — расстояние строки от клетки. Всё в RGB: в YUV строка высотой в пиксель теряла цвет, и ffmpeg сайта красил поля
 * в зелёный (владелец 31.10: «а что за зелёный блик?»); приглушение цвета — смесью с яркостью в geq, без hue.
 */
const fadeBand = (input: string, rows: string, d: string, label: string) => {
  const k = `0.8*pow(max(0\\,1-(${d})/240)\\,1.6)`;
  const luma = "(0.299*r(X\\,Y)+0.587*g(X\\,Y)+0.114*b(X\\,Y))";
  const ch = (c: string) => `(0.6*${c}(X\\,Y)+0.4*${luma})*${k}`;
  return (
    `[${input}]crop=iw:12:0:${rows},format=gbrp,scale=1080:1:flags=area,gblur=sigma=200:sigmaV=0,scale=1080:240:flags=neighbor,` +
    `geq=r='${ch("r")}':g='${ch("g")}':b='${ch("b")}'[${label}];`
  );
};

/**
 * The 4:5 picture in a 9:16 cover: scaled over the whole 1080×1440 middle — exactly the 3:4 the profile grid shows, so the
 * grid is all picture with no seams — and 240 px fields above and below fading into the dark.
 */
export async function finishNewsCover(_dir: string, source: string, out: string): Promise<string> {
  const filter =
    "[0:v]scale=1080:1440:force_original_aspect_ratio=increase:flags=lanczos,crop=1080:1440,split=3[m][t][d];" +
    fadeBand("t", "0", "239-Y", "top") +
    fadeBand("d", "ih-12", "Y", "bot") +
    "[m]format=gbrp[mid];[top][mid][bot]vstack=inputs=3,format=yuv444p,unsharp=5:5:0.55:5:5:0.0,eq=contrast=1.03:saturation=1.02";
  await new Promise<void>((resolve, reject) =>
    execFile(ffmpegBin(), ["-hide_banner", "-loglevel", "error", "-y", "-i", source, "-filter_complex", filter, "-frames:v", "1", out], (e) => (e ? reject(e) : resolve())),
  );
  return out;
}

/** The 3:4 centre of a 9:16 cover — what the Instagram grid shows. */
async function gridCrop(image: string, out: string): Promise<string> {
  await new Promise<void>((resolve, reject) =>
    execFile(ffmpegBin(), ["-hide_banner", "-loglevel", "error", "-y", "-i", image, "-vf", "crop=iw:iw*4/3:0:(ih-iw*4/3)/2", out], (e) => (e ? reject(e) : resolve())),
  );
  return out;
}

/** The grid cell with Instagram's view counter painted over its bottom-left corner: is the headline still all there? */
async function counterCrop(grid: string, out: string): Promise<string> {
  await new Promise<void>((resolve, reject) =>
    execFile(ffmpegBin(), ["-hide_banner", "-loglevel", "error", "-y", "-i", grid, "-vf", "drawbox=x=0:y=ih*0.89:w=iw*0.5:h=ih*0.11:color=black:t=fill", out], (e) => (e ? reject(e) : resolve())),
  );
  return out;
}

/** GPT reads the drawn headline back: image models misspell Russian («СДАСЯ» for «СДАЛСЯ» on the first try, 29.10). */
async function readDrawnText(image: string): Promise<string | null> {
  try {
    const base64 = (await fs.promises.readFile(image)).toString("base64");
    const answer = await mediaVision({
      system: "Ты читаешь текст на картинке. Ответ — только JSON.",
      user: 'Перепиши дословно, буква в букву, крупный заголовок на этой обложке — как он написан, даже с ошибками. Ответ: {"text":"…"}',
      images: [{ base64, mediaType: "image/png" }],
    });
    const text = (JSON.parse(answer.slice(answer.indexOf("{"), answer.lastIndexOf("}") + 1)) as { text?: unknown }).text;
    return typeof text === "string" ? text : null;
  } catch {
    return null;
  }
}

function ownerFaces(): string[] {
  const dir = path.join(newsRoot(), "owner-faces");
  try {
    return fs.readdirSync(dir).filter((f) => /\.(jpe?g)$/i.test(f)).sort().slice(0, 4).map((f) => path.join(dir, f));
  } catch {
    return [];
  }
}

const liveDeps: CoverDepsNews = {
  grabFrame,
  concept: (topic, script, title, strictNote) => generateCoverConcept(topic, script, title, strictNote, STYLE_HINT),
  generateImage: generateFromFrame,
  finish: finishNewsCover,
  encodeFinal: encodeFinalCover,
  spend: (_id, topic, fn) => siteSpend(topic, "Обложка (Новости)", fn),
  readText: readDrawnText,
  gridCrop,
  counterCrop,
  compose: composeNewsCover,
  composeHero: composeHeroCover,
  faces: ownerFaces,
  blocked: () =>
    !fullAiCoverEnabled()
      ? "обложки выключены настройкой FULL_AI_COVER=false"
      : !imageBridgeUrl() || !process.env.CODEX_BRIDGE_TOKEN
        ? "не настроен мост картинок GPT (CODEX_IMAGE_BRIDGE_URL)"
        : null,
};

/** Covers being drawn, shared by the automatic one after a video and the owner's button: one per project. */
const BUSY = Symbol.for("gudini.news.coverBusy");
export function coverBusy(): Set<string> {
  const g = globalThis as unknown as Record<symbol, Set<string> | undefined>;
  return (g[BUSY] ??= new Set());
}

export function checkHeadline(raw: unknown): string | undefined {
  if (raw === undefined || raw === null || raw === "") return undefined;
  if (typeof raw !== "string") throw new NewsError("Заголовок должен быть строкой", 400);
  const headline = raw.replace(/\s+/g, " ").trim();
  if (!headline) return undefined;
  if (headline.length > HEADLINE_MAX) throw new NewsError(`Заголовок обложки — не длиннее ${HEADLINE_MAX} знаков`, 400);
  return headline;
}

function reasonOf(e: unknown): string {
  const m = String((e as Error)?.message ?? e);
  if (m.includes("NO_IMAGE_BRIDGE")) return "не настроен мост картинок GPT (CODEX_IMAGE_BRIDGE_URL)";
  if (m.includes("ECONNREFUSED") || m.includes("ECONNRESET")) return "мост картинок GPT не отвечает (127.0.0.1:43129)";
  if (m.startsWith("IMAGE_PROVIDER_ERROR")) return `GPT ответил ошибкой (${m.replace(/^IMAGE_PROVIDER_ERROR:\s*/, "").slice(0, 160)})`;
  return m.slice(0, 200);
}

/** Windows briefly refuses to replace a file that a reader (the cover route) still holds. */
async function replaceFile(from: string, to: string) {
  for (let i = 0; ; i++) {
    try {
      await fs.promises.rename(from, to);
      return;
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code ?? "";
      if (i >= 20 || !["EPERM", "EBUSY", "EACCES"].includes(code)) throw e;
      await new Promise((r) => setTimeout(r, 25));
    }
  }
}

type Outcome = { status: NewsCover["status"]; reason?: string; headline?: string; style?: CoverStyle };

export type CoverResult = {
  project: NewsProject;
  ok: boolean;
  /** The new one failed and the previous cover stayed in place. */
  kept?: boolean;
  /** onlyIfMissing found a cover already there: nothing was drawn or paid. */
  skipped?: boolean;
  error?: string;
};

/**
 * Draws a new cover: one paid image. On failure the previous cover is restored (cover-prev.jpg) and stays,
 * like the main cover route; without a previous one the failure and its reason are stored for the page.
 * onlyIfMissing (the automatic cover after a video) draws nothing when the project already has a cover:
 * checked while holding the project's cover slot, so a cover the owner drew a moment ago is never paid twice.
 */
export async function makeNewsCover(
  id: string,
  opts: { headline?: string; onlyIfMissing?: boolean; style?: CoverStyle } = {},
  deps: Partial<CoverDepsNews> = {},
): Promise<CoverResult> {
  const p = getProject(id);
  if (!p) throw new NewsError("Ролик не найден", 404);
  if (!p.video) throw new NewsError("Сначала нужен готовый ролик", 409);
  const script = storyText(p.story);
  if (!p.story || !script) throw new NewsError("Сначала нужна история", 409);
  const busy = coverBusy();
  if (busy.has(id)) throw new NewsError("Обложка уже создаётся — подождите минуту", 409);
  busy.add(id);
  try {
    // p was read just above with nothing awaited since, so it is the state under the slot
    // a failed try (GPT answered 502) is not a cover: the automatic one draws again (1.11, Heidi Klum had none)
    if (opts.onlyIfMissing && p.cover?.status === "ok") return { project: p, ok: true, skipped: true };
    const d: CoverDepsNews = { ...liveDeps, ...deps };
    const video = p.video;
    const story = p.story;
    const dir = projectDir(id);
    const work = path.join(dir, WORK_DIR);
    await fs.promises.mkdir(work, { recursive: true });
    const coverFile = path.join(dir, COVER_FILE);
    const prevFile = path.join(dir, PREV_COVER_FILE);
    const hadCover = p.cover?.status === "ok" && fs.existsSync(coverFile);
    if (hadCover) await fs.promises.copyFile(coverFile, prevFile);
    const override = opts.headline?.trim() || undefined;

    const draw = async (): Promise<Outcome> => {
      // the clean frame from the PC (the hero's first shot, no subtitles); without it — a frame of the finished video
      const clean = path.join(dir, COVER_FRAME_FILE);
      const frame = fs.existsSync(clean) ? { file: clean, at: 0 } : await d.grabFrame(videoPath(id), work, video.duration);
      // the same text-only gate as the main covers: a headline that lost the topic never costs an image
      const resolved = await resolveHeadline(
        async (_attempt, strictNote) => {
          const concept = await d.concept(story.title, script, story.title, strictNote);
          if (concept && override) concept.headlineCandidates = [override];
          return concept;
        },
        work,
        { ignoreAnchor: Boolean(override) },
      );
      if (!resolved.concept) return { status: "failed", reason: "не удалось придумать заголовок — попробуйте ещё раз" };
      const headline = resolved.concept.headlineLines.map((l) => l.text).join(" ");
      if (!resolved.ok) return { status: "headline_failed", reason: "заголовок потерял тему ролика — картинка не заказывалась", headline };
      const style = opts.style ?? DEFAULT_COVER_STYLE;
      // the Vaseline cover is the hero's alone: the owner's photos are not sent
      const faces = style === "hero" ? [] : d.faces();
      const prompt = buildNewsCoverPrompt(resolved.concept, style, faces.length ? { outfit: OUTFITS[Math.floor(Math.random() * OUTFITS.length)] } : undefined);
      await fs.promises.writeFile(path.join(work, "cover-prompt.txt"), prompt, "utf8");
      const raw = path.join(work, "cover-attempt.png");
      if (style === "hero") {
        // the Vaseline picture without text and its headline laid by us — always above the grid's view counter
        await d.generateImage(prompt, frame.file, raw, faces);
        const picture = await d.finish(work, raw, path.join(work, "cover-picture.png"));
        const composed = path.join(work, COVER_FILE);
        await d.composeHero(picture, resolved.concept.headlineLines.map((l) => l.text), keyWord(resolved.concept), composed);
        if (!((await fs.promises.stat(composed)).size > 0)) throw new Error("обложка получилась пустой");
        await replaceFile(composed, coverFile);
        return { status: "ok", headline, style };
      }
      if (style === "news") {
        // the picture without text and our headline on it (the style of 3.11, only when asked for by name)
        await d.generateImage(prompt, frame.file, raw, faces);
        const picture = await d.finish(work, raw, path.join(work, "cover-picture.png"));
        const composed = path.join(work, COVER_FILE);
        await d.compose(picture, headline, composed);
        if (!((await fs.promises.stat(composed)).size > 0)) throw new Error("обложка получилась пустой");
        await replaceFile(composed, coverFile);
        return { status: "ok", headline, style };
      }
      // a misspelt headline is drawn once more; twice wrong — no cover rather than a cover with a mistake.
      // A headline cut off in the Instagram grid (the 3:4 centre) or under its view counter is drawn once more too; a
      // headline only touched by the counter keeps the first picture if the second is no better — better that than no cover
      const same = (text: string | null) => text === null || lettersOf(text) === lettersOf(headline);
      let note = "";
      let finished = "";
      let fallback = "";
      for (let attempt = 0; attempt < 2; attempt++) {
        await d.generateImage(note ? `${prompt} ${note}` : prompt, frame.file, raw, faces);
        const drawn = await d.readText(raw);
        if (!same(drawn)) {
          if (fallback) break;
          if (attempt === 1) return { status: "failed", reason: `GPT дважды ошибся в заголовке: «${drawn!.slice(0, 60)}» вместо «${headline}» — нажмите ещё раз`, headline, style };
          note = "";
          continue;
        }
        finished = await d.finish(work, raw, path.join(work, `cover-final-${attempt}.png`));
        const grid = await d.gridCrop(finished, path.join(work, "cover-grid.png")).catch(() => null);
        const inGrid = grid ? await d.readText(grid) : null;
        if (!same(inGrid)) {
          if (fallback) break;
          if (attempt === 1) return { status: "failed", reason: `в сетке Инстаграма заголовок обрезается («${inGrid!.slice(0, 60)}» вместо «${headline}») — нажмите ещё раз`, headline, style };
          note = "The previous attempt had the headline cut off at the edge of the picture: keep all of it inside, with margin from every edge.";
          continue;
        }
        const corner = grid ? await d.counterCrop(grid, path.join(work, "cover-counter.png")).catch(() => null) : null;
        if (same(corner ? await d.readText(corner) : null) || attempt === 1) {
          fallback = "";
          break;
        }
        fallback = finished;
        note = "The previous attempt had the headline too low: the view counter in the bottom corner of the thumbnail covered it. Move the headline higher, its bottom about 15% above the bottom edge of the picture.";
      }
      if (fallback) finished = fallback;
      const out = path.join(work, COVER_FILE);
      await d.encodeFinal(work, finished, out);
      if (!((await fs.promises.stat(out)).size > 0)) throw new Error("обложка получилась пустой");
      await replaceFile(out, coverFile);
      return { status: "ok", headline, style };
    };

    const blocked = d.blocked();
    const outcome: Outcome = blocked
      ? { status: "failed", reason: blocked }
      : await d.spend(id, projectTitle(p), draw).catch((e): Outcome => ({ status: "failed", reason: reasonOf(e) }));
    const at = new Date().toISOString();

    if (outcome.status === "ok") {
      await fs.promises.rm(prevFile, { force: true });
      const { project } = await mutate(id, (q) => {
        q.cover = { file: COVER_FILE, at, status: "ok", ...(outcome.headline ? { headline: outcome.headline } : {}), ...(outcome.style ? { style: outcome.style } : {}), videoAt: video.at };
        q.updatedAt = at;
      });
      return { project, ok: true };
    }
    const reason = outcome.reason ?? "обложка не получилась";
    if (hadCover) {
      // the money for the previous one is spent: it stays the cover
      await fs.promises.copyFile(prevFile, coverFile);
      await fs.promises.rm(prevFile, { force: true });
      return { project: getProject(id) ?? p, ok: false, kept: true, error: `Новую обложку создать не удалось: ${reason} — оставлена прежняя` };
    }
    const { project } = await mutate(id, (q) => {
      q.cover = { file: COVER_FILE, at, status: outcome.status, reason, ...(outcome.headline ? { headline: outcome.headline } : {}), videoAt: video.at };
      q.updatedAt = at;
    });
    return { project, ok: false, error: `Обложку создать не удалось: ${reason}` };
  } finally {
    busy.delete(id);
  }
}

/** The stored cover file, only when the cover is a good one (a failed attempt leaves no picture). */
export function coverFile(p: NewsProject): string | null {
  if (p.cover?.status !== "ok") return null;
  const file = path.join(projectDir(p.id), COVER_FILE);
  return fs.existsSync(file) ? file : null;
}
