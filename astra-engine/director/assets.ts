import { execFile, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import * as simpleIcons from "simple-icons";
import sharp from "sharp";
import emojiData from "unicode-emoji-json/data-by-emoji.json";
import { askWeb, postBridge } from "./bridge";
import { captureScreen } from "./screens";
import { cutoutSubject } from "./collage";
import { cutoutKey, screenKey } from "../src/assetKeys";
import { coinKey } from "../src/kit/iconPictures";
import { cryptoMark } from "./coins";

/** One look for every generated picture of a video: a real vertical photo that fills the phone screen, the subject whole. */
export const SCENE_STYLE = "Photorealistic vertical photo for a full vertical 9:16 phone screen, as if shot on a good phone camera for a news story: " +
  "natural light, real materials and people, realistic proportions, sharp focus on the subject. " +
  "The main subject and every important person and object are large, whole and close together; nothing important touches any edge. " +
  "No text, no captions, no watermark, no logos except those that are part of real objects. Scene: ";

/** Pictures drawn at the same time; the Codex service runs up to three image jobs at once. */
const DRAW_AT_ONCE = Math.max(1, Math.min(4, Number(process.env.ASTRA_IMAGE_CONCURRENCY) || 3));

/** Runs tasks at most `limit` at a time; results keep the order of the tasks. */
export async function inPool<T>(tasks: (() => Promise<T>)[], limit = DRAW_AT_ONCE): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, async () => {
    while (next < tasks.length) { const i = next++; results[i] = await tasks[i](); }
  }));
  return results;
}

/**
 * Turns what a montage asks for into files in the bundle's public folder:
 * emoji become Microsoft Fluent 3D pictures (MIT), logos come from Simple Icons (CC0)
 * or the company's Wikipedia page, photos from Pexels / Pixabay (free licenses).
 */
export type AssetNeeds = {
  emoji: string[]; logos: string[]; photos: string[]; looks?: Record<string, string>;
  scenes?: string[]; memes?: string[]; morphs?: { from: number; into: string }[];
  /** Real photos of known things: the search query and, if known, the Wikipedia article. */
  reals?: { query: string; wiki?: string; caption?: string }[];
  /** Real footage from YouTube: the search query and, if given, the second to start from. */
  footage?: { query: string; start?: number }[];
  /** Screenshots of real web pages, scrolled to the phrase to mark. */
  screens?: { url: string; find?: string }[];
  /** Real photos cut out along their subject for paper collages. */
  cutouts?: { query: string; wiki?: string; caption?: string; color?: boolean }[];
  /** Coins and exchanges the boards' icons show by their real logo (`coin:ETH`). */
  coins?: string[];
};
export type ResolvedAssets = {
  assets: Record<string, string>; sizes: Record<string, { w: number; h: number; plate?: boolean; focus?: [number, number, number, number]; dark?: boolean }>; missing: string[]; notes: string[];
  /** Keys taken from the open web (logos) that are checked by eye before the render. */
  check: string[];
};

const FLUENT = "https://raw.githubusercontent.com/microsoft/fluentui-emoji/main/assets";
const UA = { "User-Agent": "Gudini-Astra/1.0 (video montage; contact: owner)" };

async function download(url: string, file: string, headers: Record<string, string> = {}): Promise<boolean> {
  try {
    const res = await fetch(url, { headers: { ...UA, ...headers } });
    if (!res.ok) return false;
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length < 200) return false;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, bytes);
    return true;
  } catch { return false; }
}

const slugify = (text: string) => text.toLowerCase().replace(/ё/g, "е").replace(/[^a-z0-9а-я]+/gi, "-").replace(/^-|-$/g, "").slice(0, 60);

async function fluentEmoji(glyph: string, dir: string): Promise<string | null> {
  const data = emojiData as Record<string, { name: string; slug: string }>;
  const entry = data[glyph] ?? data[glyph.replace(/️/g, "")] ?? data[`${glyph}️`];
  if (!entry) return null;
  const file = path.join(dir, `${entry.slug}.png`);
  if (fs.existsSync(file)) return file;
  const folder = entry.name.charAt(0).toUpperCase() + entry.name.slice(1);
  const base = `${FLUENT}/${encodeURIComponent(folder)}`;
  for (const url of [`${base}/3D/${entry.slug}_3d.png`, `${base}/Default/3D/${entry.slug}_3d_default.png`]) {
    if (await download(url, file)) return file;
  }
  return null;
}

function simpleIconSvg(name: string): string | null {
  const key = name.toLowerCase().replace(/[^a-z0-9]/g, "");
  const icon = Object.values(simpleIcons).find((i: any) => i && typeof i === "object" && "slug" in i && (i.slug === key || i.title.toLowerCase().replace(/[^a-z0-9]/g, "") === key)) as
    { path: string; hex: string } | undefined;
  if (!icon) return null;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#${icon.hex}" d="${icon.path}"/></svg>`;
}

async function wikipediaLogo(name: string, file: string): Promise<boolean> {
  try {
    // A logo is a drawing (svg, png): the lead picture of the brand's article when it is one, drawn as a png.
    // A jpeg there is a photo of a shop or a person, not the brand's mark.
    const res = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(name.replace(/\s+/g, "_"))}`, { headers: UA });
    const page = res.ok ? await res.json() as { originalimage?: { source: string } } : {};
    const lead = page.originalimage?.source?.split("?")[0].split("/").pop();
    const candidates = lead ? await commons({ titles: `File:${decodeURIComponent(lead)}` }) : [];
    // Commons keeps most brand marks as "<Name> logo.svg".
    if (!candidates.some(isDrawing)) candidates.push(...(await commons({ generator: "search", gsrnamespace: "6", gsrlimit: "6", gsrsearch: `${name} logo` }))
      .filter(p => /logo/i.test(p.title ?? "")));
    const mark = candidates.find(isDrawing)?.imageinfo?.[0];
    return mark?.thumburl ? download(mark.thumburl, file) : false;
  } catch { return false; }
}

const isDrawing = (p: CommonsPage) => /svg|png/.test(p.imageinfo?.[0]?.mime ?? "") && Boolean(p.imageinfo?.[0]?.thumburl);

type CommonsPage = { title?: string; imageinfo?: { thumburl?: string; url?: string; mime?: string; width?: number; height?: number }[] };

/** Commons image info with a 1600 px rendition, for a list of file titles or a search. */
async function commons(params: Record<string, string>): Promise<CommonsPage[]> {
  const query = new URLSearchParams({ action: "query", format: "json", prop: "imageinfo", iiprop: "url|size|mime", iiurlwidth: "1600", ...params });
  const res = await fetch(`https://commons.wikimedia.org/w/api.php?${query}`, { headers: UA });
  if (!res.ok) return [];
  const data = await res.json() as { query?: { pages?: Record<string, CommonsPage & { index?: number }> } };
  return Object.values(data.query?.pages ?? {}).sort((a, b) => ((a as { index?: number }).index ?? 0) - ((b as { index?: number }).index ?? 0));
}

/** Pictures that can be a real photo: raster, big enough — not a diagram (svg) or an icon. */
const usableOf = (pages: CommonsPage[]) => pages.map(p => p.imageinfo?.[0])
  .filter((i): i is NonNullable<typeof i> => Boolean(i?.thumburl && /jpeg|png/.test(i.mime ?? "") && (i.width ?? 0) >= 600));

/**
 * A real photo of a known person, place or thing: the lead picture of its Wikipedia article (English, then Russian),
 * otherwise the best Wikimedia Commons match for the query. Real things are shown as they are, never generated.
 */
export async function realPhoto(query: string, wiki: string | undefined, dir: string): Promise<string | null> {
  const file = path.join(dir, `${slugify(wiki ?? query)}.jpg`);
  if (fs.existsSync(file)) return file;
  const candidates: CommonsPage[] = [];
  try {
    if (wiki) for (const lang of ["en", "ru"]) {
      const res = await fetch(`https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(wiki.replace(/\s+/g, "_"))}`, { headers: UA });
      if (!res.ok) continue;
      const page = await res.json() as { originalimage?: { source: string } };
      const name = page.originalimage?.source?.split("?")[0].split("/").pop();
      if (name) { candidates.push(...await commons({ titles: `File:${decodeURIComponent(name)}` })); break; }
    }
    // Commons finds files by the words of their names: a long query often finds nothing, its core words do.
    const words = query.split(/\s+/).filter(Boolean);
    const searches = [...new Set([query, wiki, words.slice(0, 3).join(" "), words.slice(0, 2).join(" ")].filter((q): q is string => Boolean(q && q.trim())))];
    for (const search of searches) {
      if (usableOf(candidates).length) break;
      candidates.push(...await commons({ generator: "search", gsrnamespace: "6", gsrlimit: "8", gsrsearch: search }));
    }
  } catch { return null; }
  const usable = usableOf(candidates);
  // A photo first, a vertical one fits the phone screen best.
  const pick = usable.find(i => /jpeg/.test(i.mime ?? "") && (i.height ?? 0) >= (i.width ?? 1) * 0.9) ?? usable.find(i => /jpeg/.test(i.mime ?? "")) ?? usable[0];
  if (!pick?.thumburl || !(await download(pick.thumburl, `${file}.download`))) return null;
  await sharp(`${file}.download`).rotate().resize(1600, 1600, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 90 }).toFile(file);
  fs.rmSync(`${file}.download`, { force: true });
  return file;
}

/** Image links a page carries that can be a brand mark: its icons, images named logo, its social picture. */
function logoLinks(html: string, pageUrl: string): string[] {
  const value = (tag: string, key: string) => tag.match(new RegExp(`\\b${key}=["']([^"']+)["']`, "i"))?.[1];
  const links: string[] = [];
  for (const [tag] of html.matchAll(/<(?:link|img|meta)\b[^>]*>/gi)) {
    let href: string | undefined;
    if (/^<link/i.test(tag) && /icon/i.test(value(tag, "rel") ?? "")) href = value(tag, "href");
    else if (/^<img/i.test(tag) && /logo|brand/i.test(`${value(tag, "src")} ${value(tag, "alt")} ${value(tag, "class")}`)) href = value(tag, "src");
    else if (/^<meta/i.test(tag) && value(tag, "property") === "og:image") href = value(tag, "content");
    if (!href || /\.ico(\?|$)/i.test(href) || /^data:/i.test(href)) continue;
    try { links.push(new URL(href.replace(/&amp;/g, "&"), pageUrl).href); } catch { /* not a link */ }
  }
  return [...new Set(links)];
}

/** Logos taken from the web in this process: they are checked by eye before the render, unlike drawn ones. */
const webLogos = new Set<string>();

/**
 * A brand mark the free sources lack (a token, a game, an app): the bridge's web search names the brand's pages,
 * their icons and logo images are taken and the best one is kept — a transparent mark over a banner, a bigger one over a smaller.
 */
async function webLogo(name: string, file: string): Promise<string | null> {
  let pages: { url?: string }[] = [];
  try {
    const text = await askWeb(
      "You find where the official logo image of a brand, app, game or crypto token is published: its official website, its press or brand page, " +
        "its page on CoinGecko or CoinMarketCap, its Wikipedia article in any language, its app store page. Use web search. " +
        "Answer with JSON only: {\"pages\":[{\"url\":\"https://...\"}]} — up to 4 pages, the most official first, no image links, no other text.",
      `Brand: ${name}`);
    pages = (JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)) as { pages?: { url?: string }[] }).pages ?? [];
  } catch { return null; }
  const links: string[] = [];
  for (const page of pages.slice(0, 4)) {
    if (typeof page?.url !== "string" || !/^https?:\/\//.test(page.url)) continue;
    try {
      const res = await fetch(page.url, { headers: { ...UA, Accept: "text/html" }, signal: AbortSignal.timeout(20_000) });
      if (res.ok) links.push(...logoLinks((await res.text()).slice(0, 1_500_000), page.url));
    } catch { /* the next page */ }
  }
  let best: { buffer: Buffer; score: number; svg: boolean } | undefined;
  for (const link of [...new Set(links)].slice(0, 10)) {
    try {
      const res = await fetch(link, { headers: UA, signal: AbortSignal.timeout(20_000) });
      if (!res.ok) continue;
      const buffer = Buffer.from(await res.arrayBuffer());
      if (buffer.length < 300 || buffer.length > 8_000_000) continue;
      if (/svg/.test(res.headers.get("content-type") ?? "") || /\.svg(\?|$)/i.test(link)) {
        if (!best || best.score < 9) best = { buffer, score: 9, svg: true };
        continue;
      }
      const m = await sharp(buffer).metadata();
      if (!m.width || !m.height || m.width < 160 || m.width / m.height > 2.2 || m.height / m.width > 2.2) continue;
      const score = (m.hasAlpha ? 3 : 0) + Math.min(m.width, 1024) / 1024 - (m.width / m.height > 1.5 ? 1 : 0);
      if (!best || score > best.score) best = { buffer, score, svg: false };
    } catch { /* the next link */ }
  }
  if (!best) return null;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const out = best.svg ? file.replace(/\.png$/, ".svg") : file;
  if (best.svg) fs.writeFileSync(out, best.buffer);
  else await sharp(best.buffer).resize(800, 800, { fit: "inside", kernel: "lanczos3" }).png().toFile(out);
  webLogos.add(name.toLowerCase());
  return out;
}

/** A logo from the web that turned out wrong is removed, so the next montage searches again. */
export function discardLogo(name: string, dir: string): void {
  for (const ext of ["svg", "png"]) fs.rmSync(path.join(dir, `${slugify(name)}.${ext}`), { force: true });
  webLogos.delete(name.toLowerCase());
}

/**
 * Whether a mark needs the white tile under it: a dark, single-color mark (a black wordmark) would vanish over the room;
 * a colorful or bright one (a golden coin, a blue plane) stands on its own, bigger.
 */
async function needsPlate(file: string): Promise<boolean> {
  try {
    const { data, info } = await sharp(file).resize(64, 64, { fit: "inside" }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    let seen = 0, lum = 0, colorful = 0, dark = 0;
    for (let i = 0; i < data.length; i += info.channels) {
      if (data[i + 3] < 128) continue;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      seen++;
      const l = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      lum += l;
      if (l < 0.28) dark++;
      if (Math.max(r, g, b) - Math.min(r, g, b) > 40) colorful++;
    }
    if (!seen) return true;
    // A dark part of the mark (the navy KRAKEN wordmark beside a pink sign) vanishes over the dim room: such a mark stands on the tile.
    if (dark / seen > 0.18) return true;
    return lum / seen < 0.4 && colorful / seen < 0.3;
  } catch { return true; }
}

async function logo(name: string, dir: string): Promise<{ file: string; plate: boolean } | null> {
  // A coin or an exchange is shown by the mark it uses today, from CoinGecko: round coins and app icons stand without a tile.
  const crypto = await cryptoMark(name, path.join(dir, "crypto"));
  if (crypto) return { file: crypto.file, plate: false };
  const svg = simpleIconSvg(name);
  let file: string | null = null;
  if (svg) {
    file = path.join(dir, `${slugify(name)}.svg`);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, svg);
  }
  if (!file) for (const ext of ["svg", "png"]) {
    const cached = path.join(dir, `${slugify(name)}.${ext}`);
    if (fs.existsSync(cached)) file = cached;
  }
  if (!file) {
    const png = path.join(dir, `${slugify(name)}.png`);
    file = (await wikipediaLogo(name, png)) ? png : await webLogo(name, png);
  }
  return file ? { file, plate: await needsPlate(file) } : null;
}

type Candidate = { preview: string; full: string };

/** A photo is chosen for a query *and* what must be visible on it, so a new `look` picks again. */
function photoFile(dir: string, query: string, look?: string): string {
  const tag = look ? createHash("sha1").update(look).digest("hex").slice(0, 8) : "any";
  return path.join(dir, `${slugify(query)}-${tag}.jpg`);
}

/** Up to six vertical stock photos per query from Pexels, then Pixabay: vertical pictures fill a vertical video. */
async function photoCandidates(query: string): Promise<Candidate[]> {
  const found: Candidate[] = [];
  const pexels = process.env.PEXELS_API_KEY;
  if (pexels) {
    try {
      const res = await fetch(`https://api.pexels.com/v1/search?per_page=6&orientation=portrait&query=${encodeURIComponent(query)}`, { headers: { Authorization: pexels } });
      const data = await res.json() as { photos?: { src: { medium: string; large2x: string } }[] };
      for (const p of data.photos ?? []) found.push({ preview: p.src.medium, full: p.src.large2x });
    } catch { /* Pixabay next */ }
  }
  const pixabay = process.env.PIXABAY_API_KEY;
  if (pixabay && found.length < 6) {
    try {
      const res = await fetch(`https://pixabay.com/api/?key=${pixabay}&image_type=photo&orientation=vertical&per_page=6&safesearch=true&q=${encodeURIComponent(query)}`);
      const data = await res.json() as { hits?: { webformatURL: string; largeImageURL: string }[] };
      for (const h of data.hits ?? []) found.push({ preview: h.webformatURL, full: h.largeImageURL });
    } catch { /* nothing more */ }
  }
  return found.slice(0, 6);
}

/**
 * Photos are chosen by eye: Astra sees the candidates for every query and picks the one that
 * shows the thing clearly, or none. Without a picker the first result is taken.
 */
async function photos(queries: string[], dir: string, pick?: PhotoPicker, looks: Record<string, string> = {}): Promise<{ files: Record<string, string | null>; rejected: Set<string> }> {
  const result: Record<string, string | null> = {};
  const rejected = new Set<string>();
  const pending: { query: string; candidates: Candidate[]; previews: Buffer[] }[] = [];
  for (const query of queries) {
    const file = photoFile(dir, query, looks[query]);
    if (fs.existsSync(file)) { result[query] = file; continue; }
    const candidates = await photoCandidates(query);
    const previews: Buffer[] = [];
    for (const c of candidates) {
      try { const r = await fetch(c.preview, { headers: UA }); previews.push(Buffer.from(await r.arrayBuffer())); } catch { previews.push(Buffer.alloc(0)); }
    }
    pending.push({ query, candidates, previews });
  }
  const choices = pick && pending.some(p => p.candidates.length) ? await pick(pending.map(p => ({ query: p.query, look: looks[p.query], previews: p.previews }))) : {};
  for (const p of pending) {
    const index = pick ? choices[p.query] ?? -1 : 0;
    const chosen = index >= 0 ? p.candidates[index] : undefined;
    if (!chosen && p.candidates.length) rejected.add(p.query);
    const file = photoFile(dir, p.query, looks[p.query]);
    result[p.query] = chosen && await download(chosen.full, file) ? file : null;
  }
  return { files: result, rejected };
}

/** Given previews per query (and what must be visible), returns the chosen index per query (-1 = none fits). */
export type PhotoPicker = (sets: { query: string; look?: string; previews: Buffer[] }[]) => Promise<Record<string, number>>;

/** Last generation errors, so a failure can be explained to Astra instead of "did not work". */
export const generationErrors: string[] = [];

type Aspect = "9:16" | "4:5";
/** A Codex service that predates full-screen pictures accepts 4:5 only; after its first refusal pictures are drawn 4:5. */
let fullScreenRefused = false;

/** The asset key of a real photo, the same one the RealPhoto block reads. */
export const realKey = (real: { query: string; wiki?: string }) => `real:${real.wiki ?? real.query}`;

/** Pictures being drawn right now, by file: the same picture asked twice at once is drawn once. */
const drawing = new Map<string, Promise<{ file: string | null; error?: string }>>();

/** Draws a picture into `file` (kept if it exists). Returns the file, or null with the reason in `error`. */
function draw(prompt: string, file: string, opts: { references?: string[]; mode?: "generate" | "edit"; aspect?: Aspect } = {}): Promise<{ file: string | null; error?: string }> {
  const running = drawing.get(file);
  if (running) return running;
  const job = drawOnce(prompt, file, opts).finally(() => drawing.delete(file));
  drawing.set(file, job);
  return job;
}

async function drawOnce(prompt: string, file: string, opts: { references?: string[]; mode?: "generate" | "edit"; aspect?: Aspect }): Promise<{ file: string | null; error?: string }> {
  if (fs.existsSync(file)) return { file };
  let error: string | undefined;
  // The image tool sometimes ends a run without a picture; a second try usually succeeds.
  for (let attempt = 1; attempt <= 2; attempt++) {
    const aspect = opts.aspect === "9:16" && fullScreenRefused ? "4:5" : opts.aspect ?? "9:16";
    try {
      const result = await postBridge<{ base64: string }>("/image", { prompt, aspectRatio: aspect, references: opts.references ?? [], mode: opts.mode ?? "generate" },
        20 * 60_000, process.env.CODEX_IMAGE_BRIDGE_URL ?? process.env.CODEX_BRIDGE_URL);
      if (!result?.base64) continue;
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, Buffer.from(result.base64, "base64"));
      return { file };
    } catch (e) {
      error = String((e as Error).message).slice(0, 300);
      generationErrors.push(error);
      if (aspect === "9:16" && /некорректное задание изображения/.test(error)) { fullScreenRefused = true; attempt--; }
    }
  }
  return { file: null, error };
}

const generate = async (prompt: string, file: string, references: string[] = [], mode: "generate" | "edit" = "generate", aspect: Aspect = "9:16") =>
  (await draw(prompt, file, { references, mode, aspect })).file;

const sceneTag = (prompt: string) => createHash("sha1").update(SCENE_STYLE + prompt).digest("hex").slice(0, 8);

/**
 * A scene that was redrawn or rewritten stays attached to the prompt the montage uses,
 * so the next build takes the approved picture instead of generating the first attempt again.
 */
function aliases(dir: string): Record<string, string> {
  try { return JSON.parse(fs.readFileSync(path.join(dir, "aliases.json"), "utf8")); } catch { return {}; }
}
function remember(dir: string, prompt: string, file: string) {
  const all = aliases(dir);
  all[sceneTag(prompt)] = path.basename(file);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "aliases.json"), JSON.stringify(all, null, 2));
}

const scene = (prompt: string, dir: string): Promise<{ file: string | null; error?: string }> => {
  const approved = aliases(dir)[sceneTag(prompt)];
  if (approved && fs.existsSync(path.join(dir, approved))) return Promise.resolve({ file: path.join(dir, approved) });
  return draw(SCENE_STYLE + prompt, path.join(dir, `${slugify(prompt)}-${sceneTag(prompt)}.png`));
};

/** A generated picture again, with what was wrong in the previous attempt spelled out. */
export async function redrawScene(prompt: string, fix: string, publicDir: string, cacheSubdir: string): Promise<{ file: string; size?: { w: number; h: number } } | null> {
  const full = `${prompt}\nThe previous attempt was wrong: ${fix}. Make sure this time the picture shows exactly the scene described.`;
  const dir = path.join(publicDir, cacheSubdir, "scenes");
  const file = await generate(SCENE_STYLE + full, path.join(dir, `${slugify(prompt)}-${sceneTag(full)}.png`));
  if (!file) return null;
  remember(dir, prompt, file);
  const m = await sharp(file).metadata().catch(() => null);
  return { file: path.relative(publicDir, file).split(path.sep).join("/"), size: m?.width && m.height ? { w: m.width, h: m.height } : undefined };
}

/**
 * The author turned into something for a moment: the frame at `from` is edited around the author
 * (a 4:5 region, pose and room kept) and pasted back into the full frame with soft edges.
 */
async function morph(video: string, from: number, into: string, face: { y: number }, dir: string): Promise<string | null> {
  const tag = createHash("sha1").update(`${video}|${from.toFixed(2)}|${into}`).digest("hex").slice(0, 10);
  const out = path.join(dir, `morph-${tag}.jpg`);
  if (fs.existsSync(out)) return out;
  fs.mkdirSync(dir, { recursive: true });
  const base = path.join(dir, `morph-${tag}-base.png`);
  execFileSync("ffmpeg", ["-v", "error", "-y", "-ss", from.toFixed(3), "-i", video, "-frames:v", "1", "-vf", "scale=1080:1920", base]);
  const y0 = Math.max(0, Math.min(1920 - 1350, Math.round(face.y - 150)));
  const region = await sharp(base).extract({ left: 0, top: y0, width: 1080, height: 1350 }).jpeg({ quality: 95 }).toBuffer();
  const edited = await generate(
    `Edit this photo: transform the person into ${into}. Keep the same head position, framing, camera angle, the microphone in front, ` +
      "the chair, the room and the lighting; change the pose only where the description needs it (for example a hand raised to hold a phone to the ear). " +
      "Photorealistic, same composition and image size. No text.",
    path.join(dir, `morph-${tag}-edit.png`), [`data:image/jpeg;base64,${region.toString("base64")}`], "edit", "4:5");
  if (!edited) return null;
  // Soft top and bottom edges so the edited region melts into the untouched frame.
  const mask = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset="0.07" stop-color="#fff" stop-opacity="1"/>
    <stop offset="0.93" stop-color="#fff" stop-opacity="1"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient></defs>
    <rect width="1080" height="1350" fill="url(#g)"/></svg>`);
  const patch = await sharp(edited).resize(1080, 1350, { fit: "fill" }).ensureAlpha().composite([{ input: mask, blend: "dest-in" }]).png().toBuffer();
  await sharp(base).composite([{ input: patch, top: y0, left: 0 }]).jpeg({ quality: 92 }).toFile(out);
  return out;
}

const run = promisify(execFile);

type FootageFound = { id: string; title: string; duration: number; views: number; vertical: boolean };
export type FootageFile = { file: string; poster: string; size: { w: number; h: number }; title: string };

/** The asset keys of a cut (the same ones the Footage block reads): the clip it plays and the frame it is checked and stood on. */
export const footageKeys = (query: string, start?: number) => {
  const tail = start === undefined ? "" : `@${Math.round(start)}`;
  return { video: `footage:${query}${tail}`, poster: `footage-poster:${query}${tail}` };
};

/** yt-dlp's output even when one of the videos fails: the others are still printed. */
const ytdlp = (args: string[], timeout: number) => run("yt-dlp", ["--no-warnings", ...args], { timeout, maxBuffer: 4 << 20 })
  .then(r => r.stdout).catch((e: { stdout?: string }) => e.stdout ?? "");

/**
 * YouTube results for a query — the query itself and its Shorts — vertical recordings first: they fill a vertical video
 * and are usually the thing itself (a phone screen, a scene), not a talking head; then the title's match, then views.
 */
export async function footageSearch(query: string): Promise<FootageFound[]> {
  const words = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);
  const hits = (f: FootageFound) => words.filter(w => f.title.toLowerCase().includes(w)).length;
  const lists = await Promise.all([query, `${query} #shorts`].map(q =>
    ytdlp(["--flat-playlist", "--print", "%(id)s\t%(duration)s\t%(view_count)s\t%(title)s", `ytsearch8:${q}`], 60_000)));
  const seen = new Set<string>();
  const found: FootageFound[] = [];
  for (const parts of lists.join("\n").split(/\r?\n/).map(line => line.split("\t"))) {
    if (parts.length < 4) continue;
    const [id, duration, views, ...title] = parts;
    const f = { id, duration: Number(duration), views: Number(views) || 0, title: title.join(" "), vertical: false };
    if (!f.id || seen.has(f.id) || !(f.duration >= 10 && f.duration <= 900) || /\b(live|stream|24\/7|podcast|подкаст)\b/i.test(f.title)) continue;
    seen.add(f.id);
    found.push(f);
  }
  const top = found.sort((a, b) => hits(b) - hits(a) || b.views - a.views).slice(0, 8);
  const shapes = await ytdlp(["--ignore-errors", "--print", "%(id)s\t%(width)s\t%(height)s", ...top.map(f => `https://www.youtube.com/watch?v=${f.id}`)], 120_000);
  for (const [id, w, h] of shapes.split(/\r?\n/).map(line => line.split("\t"))) {
    const f = top.find(x => x.id === id);
    if (f && Number(h) > Number(w)) f.vertical = true;
  }
  // Vertical first, then clips of a few minutes (a long video is a guide or a stream), then the title's match, then views.
  const short = (f: FootageFound) => Number(f.duration <= 240);
  return top.sort((a, b) => Number(b.vertical) - Number(a.vertical) || short(b) - short(a) || hits(b) - hits(a) || b.views - a.views);
}

const footageBase = (dir: string, query: string, start?: number) => path.join(dir, `${slugify(query)}-${start === undefined ? "auto" : Math.round(start)}`);

/** Why candidates could not be cut, newest last: for the log when a query ends with nothing. */
export const footageErrors: string[] = [];

/** Videos already cut for a query and turned down: the next fetch takes another one. */
function triedFootage(base: string): Set<string> {
  try { return new Set(JSON.parse(fs.readFileSync(`${base}.tried.json`, "utf8")) as string[]); } catch { return new Set(); }
}

/** The cut for a query is turned down: it is remembered as tried and removed with its windows, so the next fetch takes another video. */
export function discardFootage(query: string, start: number | undefined, dir: string): void {
  const base = footageBase(dir, query, start);
  try {
    const current = JSON.parse(fs.readFileSync(`${base}.json`, "utf8")) as { id: string };
    fs.writeFileSync(`${base}.tried.json`, JSON.stringify([...triedFootage(base), current.id]));
  } catch { /* nothing was cut */ }
  const name = path.basename(base);
  for (const file of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
    if (file.startsWith(`${name}.`) && !file.endsWith(".tried.json")) fs.rmSync(path.join(dir, file), { force: true });
  }
}

/** The part of a cut Astra chose for what is said under it: `length` seconds from `start`, with a poster from its first seconds. */
export async function windowFootage(file: string, start: number, length: number): Promise<{ file: string; poster: string }> {
  const out = file.replace(/\.mp4$/, `.w${Math.round(start)}-${Math.round(length)}.mp4`);
  const poster = out.replace(/\.mp4$/, ".jpg");
  if (!fs.existsSync(out) || !fs.existsSync(poster)) {
    await run("ffmpeg", ["-v", "error", "-y", "-ss", String(start), "-i", file, "-t", String(length), "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
      "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", out], { timeout: 120_000 });
    await run("ffmpeg", ["-v", "error", "-y", "-ss", String(Math.min(1.5, length / 2)), "-i", out, "-frames:v", "1", "-q:v", "3", poster], { timeout: 60_000 });
  }
  return { file: out, poster };
}

/** How far apart the frames shown for choosing a window are, in seconds. */
export const FRAME_STEP = 2.5;

/** Frames of a cut every FRAME_STEP seconds, small, as JPEG buffers: what Astra looks at to choose the window. */
export async function footageFrames(file: string, max = 12): Promise<{ at: number; jpeg: Buffer }[]> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "astra-frames-"));
  try {
    await run("ffmpeg", ["-v", "error", "-y", "-i", file, "-vf", `fps=1/${FRAME_STEP},scale=360:-2`, "-frames:v", String(max), "-q:v", "5", path.join(dir, "%02d.jpg")], { timeout: 120_000 });
    return fs.readdirSync(dir).sort().map((name, i) => ({ at: i * FRAME_STEP, jpeg: fs.readFileSync(path.join(dir, name)) }));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** How long a cut is: Astra chooses a window of a few seconds inside it for what is said. */
const CUT_SECONDS = 30;

/**
 * Real footage for a query: the best YouTube match is cut to half a minute (past its intro, or from `start`),
 * brought to the screen's size and given a poster frame; Astra then chooses the window that shows what is said.
 */
export async function footage(query: string, start: number | undefined, dir: string): Promise<FootageFile | null> {
  fs.mkdirSync(dir, { recursive: true });
  const base = footageBase(dir, query, start);
  const meta = `${base}.json`;
  if (fs.existsSync(meta) && fs.existsSync(`${base}.mp4`) && fs.existsSync(`${base}.jpg`)) {
    const saved = JSON.parse(fs.readFileSync(meta, "utf8")) as { title: string; w: number; h: number };
    return { file: `${base}.mp4`, poster: `${base}.jpg`, size: { w: saved.w, h: saved.h }, title: saved.title };
  }
  const tried = triedFootage(base);
  let found: FootageFound[] = [];
  try { found = await footageSearch(query); } catch { return null; }
  for (const video of found.filter(f => !tried.has(f.id)).slice(0, 3)) {
    // Past the intro and the title card: a quarter in, between 20 and 60 seconds; a Short a third in (its first seconds open the app).
    const from = start ?? (video.duration <= 60 ? Math.max(3, Math.round(video.duration * 0.3)) : Math.min(60, Math.max(20, Math.round(video.duration * 0.25))));
    const source = `${base}.src.mp4`;
    // A video of a few minutes is taken whole and cut here: a section download of YouTube's video stream often arrives
    // with the sound only. Longer videos are downloaded in a section and checked for a picture.
    const whole = video.duration <= 240;
    try {
      await run("yt-dlp", ["-f", "bv*[height<=1080][ext=mp4]+ba[ext=m4a]/b[ext=mp4]/b", "--no-playlist", "--no-warnings", "--merge-output-format", "mp4", "--max-filesize", "200M",
        ...(whole ? [] : ["--download-sections", `*${from}-${from + CUT_SECONDS + 1}`, "--force-keyframes-at-cuts"]),
        "-o", source, `https://www.youtube.com/watch?v=${video.id}`], { timeout: 300_000, maxBuffer: 16 << 20 });
      if (!fs.existsSync(source)) throw new Error("no file");
      const streams = (await run("ffprobe", ["-v", "error", "-select_streams", "v", "-show_entries", "stream=codec_type", "-of", "csv=p=0", source])).stdout;
      if (!/video/.test(streams)) throw new Error("the download has no video stream");
      // The screen is 1080 wide: a wide clip is scaled to the width, a tall one to the height.
      await run("ffmpeg", ["-v", "error", "-y", ...(whole ? ["-ss", String(from)] : []), "-i", source, "-t", String(CUT_SECONDS), "-vf", "scale='if(gte(iw/ih,0.5625),1080,-2)':'if(gte(iw/ih,0.5625),-2,1920)',fps=30",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", `${base}.mp4`], { timeout: 240_000 });
      // The frame that is checked by eye comes from where the block usually shows the clip, past its first second.
      await run("ffmpeg", ["-v", "error", "-y", "-ss", "3", "-i", `${base}.mp4`, "-frames:v", "1", "-q:v", "3", `${base}.jpg`], { timeout: 60_000 });
      const m = await sharp(`${base}.jpg`).metadata();
      const size = { w: m.width ?? 1080, h: m.height ?? 1920 };
      fs.writeFileSync(meta, JSON.stringify({ id: video.id, title: video.title, from, ...size }));
      return { file: `${base}.mp4`, poster: `${base}.jpg`, size, title: video.title };
    } catch (error) {
      footageErrors.push(`${video.id} (${video.title.slice(0, 40)}): ${String((error as { stderr?: string; message?: string }).stderr || (error as Error).message).slice(-300)}`);
      tried.add(video.id);
      fs.writeFileSync(`${base}.tried.json`, JSON.stringify([...tried]));
      for (const ext of [".mp4", ".jpg", ".json"]) fs.rmSync(base + ext, { force: true });
    } finally {
      fs.rmSync(source, { force: true });
    }
  }
  return null;
}

/** Meme clips the owner put into the library (assets/astra/memes), by file name without extension. */
export function listMemes(memesDir: string | undefined): Record<string, string> {
  if (!memesDir || !fs.existsSync(memesDir)) return {};
  return Object.fromEntries(fs.readdirSync(memesDir).filter(f => /\.(mp4|webm|mov)$/i.test(f)).map(f => [f.replace(/\.[^.]+$/, ""), path.join(memesDir, f)]));
}

/** Resolves every need into `assets` keys the kit reads: emoji:, logo:, photo:, scene:, meme:, morph:. */
export async function resolveAssets(needs: AssetNeeds, publicDir: string, cacheSubdir: string, options: {
  pick?: PhotoPicker; memesDir?: string; drawMissingPhotos?: boolean; video?: string; face?: { y: number };
  /** Rewrites a scene the generator refused, keeping who, what and where; the result replaces it under the same key. */
  rescue?: (prompt: string, error: string) => Promise<string | null>;
} = {}): Promise<ResolvedAssets> {
  const assets: Record<string, string> = {};
  const sizes: ResolvedAssets["sizes"] = {};
  const missing: string[] = [];
  const notes: string[] = [];
  const rel = (file: string) => path.relative(publicDir, file).split(path.sep).join("/");
  const cache = path.join(publicDir, cacheSubdir);
  const put = async (key: string, file: string) => {
    assets[key] = rel(file);
    try { const m = await sharp(file).metadata(); if (m.width && m.height) sizes[key] = { w: m.width, h: m.height }; } catch { /* svg or broken: shown by its box */ }
  };
  for (const glyph of needs.emoji) {
    const file = await fluentEmoji(glyph, path.join(cache, "emoji"));
    if (file) await put(`emoji:${glyph}`, file);
  }
  const check: string[] = [];
  for (const coin of needs.coins ?? []) {
    const found = await cryptoMark(coin, path.join(cache, "logos", "crypto"));
    if (found) await put(coinKey(coin), found.file);
    else missing.push(`Значок «${coin}» (icon="coin:${coin}") не нашёлся на CoinGecko — напиши тикер точно (coin:ETH, coin:BTC, coin:TRUMP) или название биржи (coin:Binance).`);
  }
  for (const name of needs.logos) {
    const found = await logo(name, path.join(cache, "logos"));
    if (found) {
      const key = `logo:${name.toLowerCase()}`;
      await put(key, found.file);
      sizes[key] = { ...(sizes[key] ?? { w: 1, h: 1 }), plate: found.plate };
      if (webLogos.has(name.toLowerCase())) check.push(key);
    } else missing.push(`Логотип «${name}» не нашёлся — покажи название словом за спиной автора (BehindText) или сценой.`);
  }
  // Stock photos are searched only when asked (ASTRA_STOCK_PHOTOS=1); otherwise the picture is generated from `look`.
  const found = process.env.ASTRA_STOCK_PHOTOS === "1"
    ? await photos(needs.photos, path.join(cache, "photos"), options.pick, needs.looks)
    : { files: {} as Record<string, string | null>, rejected: new Set<string>() };
  // Transformations, scenes and photos are drawn a few at a time: each is about a minute of the image generator.
  // The transformation goes first, it is the longest.
  const scenes = path.join(cache, "scenes");
  const tasks: (() => Promise<void>)[] = [];
  const video = options.video;
  if (video) for (const m of needs.morphs ?? []) tasks.push(async () => {
    const file = await morph(video, m.from, m.into, options.face ?? { y: 445 }, path.join(cache, "morphs"));
    if (file) await put(`morph:${m.from.toFixed(2)}`, file);
    else missing.push(`Превращение на ${m.from.toFixed(2)} с не получилось — выбери другой момент или опиши превращение проще.`);
  });
  for (const prompt of needs.scenes ?? []) tasks.push(async () => {
    let { file, error } = await scene(prompt, scenes);
    // On the last round a refused scene gets a second life: Astra rewrites it so it can be generated.
    if (!file && options.drawMissingPhotos && options.rescue) {
      const rewritten = await options.rescue(prompt, error ?? "the generator returned no picture");
      if (rewritten) ({ file, error } = await scene(rewritten, scenes));
      if (file) remember(scenes, prompt, file);
    }
    if (file) await put(`scene:${prompt}`, file);
    else missing.push(`Сцену «${prompt.slice(0, 80)}…» сгенерировать не удалось (${error ?? "генератор не вернул картинку"}) — опиши её иначе: например, покажи действие со стороны, без крупных лиц, или покажи иначе.`);
  });
  for (const real of needs.reals ?? []) tasks.push(async () => {
    const file = await realPhoto(real.query, real.wiki, path.join(cache, "real"));
    if (file) await put(realKey(real), file);
    else missing.push(`Настоящее фото «${real.wiki ?? real.query}» не нашлось в Википедии и Commons: дай точное название статьи (wiki, по-английски) или другой английский запрос, либо покажи это иначе.`);
  });
  for (const f of needs.footage ?? []) tasks.push(async () => {
    const clip = await footage(f.query, f.start, path.join(cache, "footage"));
    if (clip) {
      const keys = footageKeys(f.query, f.start);
      assets[keys.video] = rel(clip.file);
      assets[keys.poster] = rel(clip.poster);
      sizes[keys.video] = clip.size;
      sizes[keys.poster] = clip.size;
      notes.push(`Кадры «${f.query}»: ${clip.title}`);
    } else {
      if (footageErrors.length) notes.push(`Кадры «${f.query}» не вырезались: ${footageErrors[footageErrors.length - 1].replace(/\s+/g, " ").slice(0, 200)}`);
      missing.push(`Настоящие кадры «${f.query}» не нашлись на YouTube — дай другой запрос по-английски (название + gameplay, footage, trailer, interview) или покажи иначе.`);
    }
  });
  // Real pages are opened one after another in their own browser; each is a few seconds.
  for (const shot of needs.screens ?? []) tasks.push(async () => {
    const result = await captureScreen(shot.url, shot.find, path.join(cache, "screens"));
    const key = screenKey(shot);
    if ("error" in result) {
      missing.push(`Страница ${shot.url}${shot.find ? ` (фраза «${shot.find}»)` : ""}: ${result.error}. Дай другой адрес этой же вещи (Википедия, GitHub, mempool.space, официальный сайт) или фразу, которая точно есть на странице, — либо покажи это иначе.`);
      return;
    }
    assets[key] = rel(result.file);
    sizes[key] = result.size;
    check.push(key);
    notes.push(`Страница ${shot.url}: «${result.title.slice(0, 60)}»${result.size.focus ? "" : " (без отметки)"}`);
    if (result.missed) missing.push(`На странице ${shot.url} («${result.title.slice(0, 60)}») нет фразы «${shot.find}» — страница покажется без отметки. Дай в find короткую фразу, которая есть на этой странице слово в слово (заголовок, имя, сумма, дата), или убери find и at.`);
  });
  // A collage piece is the real photo of its subject, cut out along its edge with a paper margin.
  for (const piece of needs.cutouts ?? []) tasks.push(async () => {
    const photo = await realPhoto(piece.query, piece.wiki, path.join(cache, "real"));
    const name = piece.wiki ?? piece.query;
    if (!photo) {
      missing.push(`Фото для коллажа «${name}» не нашлось в Википедии и Commons: дай точное название статьи (wiki) или другие английские слова — либо покажи это иначе.`);
      return;
    }
    const cut = await cutoutSubject(photo, path.join(cache, "cutouts", `${path.basename(photo, path.extname(photo))}${piece.color ? "-color" : ""}.png`), { color: piece.color });
    if ("error" in cut) {
      missing.push(`Фото «${name}» для коллажа не вырезалось (${cut.error}): возьми другой снимок (другие слова query) или покажи это иначе.`);
      return;
    }
    const key = cutoutKey(piece);
    assets[key] = rel(cut.file);
    sizes[key] = cut.size;
    check.push(key);
  });
  for (const query of needs.photos) tasks.push(async () => {
    let file = found.files[query] ?? null;
    // No stock photo shows it: a realistic picture is generated from what must be visible.
    if (!file && options.drawMissingPhotos) file = (await scene(needs.looks?.[query] ?? query, scenes)).file;
    if (file) await put(`photo:${query}`, file);
    else if (found.rejected.has(query)) missing.push(`Фото по запросу «${query}» нашлись, но ни одно не показывает «${needs.looks?.[query] ?? query}». Попробуй другие слова запроса или покажи это сценой (Scene).`);
    else missing.push(`Фото по запросу «${query}» не нашлось: на фотостоках ищут 2–4 словами («water beads», «police dog»). Дай другой запрос или покажи сценой (Scene).`);
  });
  await inPool(tasks);
  const library = listMemes(options.memesDir);
  for (const name of needs.memes ?? []) {
    const source = library[name];
    if (!source) { missing.push(`Мема «${name}» нет в библиотеке — выбери из списка в задании или покажи иначе.`); continue; }
    const target = path.join(cache, "memes", path.basename(source));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    if (!fs.existsSync(target)) fs.copyFileSync(source, target);
    assets[`meme:${name}`] = rel(target);
  }
  return { assets, sizes, missing, notes, check };
}
