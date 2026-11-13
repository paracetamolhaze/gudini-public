import type { Meta3D, Project3D, Script3D } from "./types";
import { CAST_LABEL, cleanText, projectTitle } from "./rules";
import { getProject, mutate, Studio3DError } from "./store";
import { generateMeta } from "../ai";
import { recordSiteSpend } from "../spendLog";

/**
 * Caption of a «3Д» video for the networks: the main site's caption writer (lib/ai generateMeta) gets
 * the dialogue as its script, the owner edits the result on the page. Limits are the strictest network's:
 * YouTube cuts titles at 100 characters, TikTok refuses captions over 2200.
 */

export const META_TITLE_MAX = 100;
export const META_DESCRIPTION_MAX = 2000;
export const META_HASHTAGS_MAX = 30;
const HASHTAG_MAX = 60;
export const CAPTION_MAX = 2200;

/** A line is spoken when letters or digits are left once its [..] tags are gone (the rule of the voice jobs too). */
const SPOKEN = /[\p{L}\p{N}]/u;

/** Voice tags like [laughs] are performed, not said: the caption writer gets only the words. */
export function dialogueText(script: Script3D | null): string {
  return (script?.lines ?? [])
    .map((l) => ({ who: CAST_LABEL[l.who] ?? l.who, text: cleanText(l.text.replace(/\[[^\]]*\]/g, " ")) }))
    .filter((l) => SPOKEN.test(l.text))
    .map((l) => `${l.who}: ${l.text}`)
    .join("\n");
}

/** Exactly what the networks get: the same joining as the main publish code and the TikTok worker. */
export const captionOf = (m: Meta3D) => [m.title, m.description, m.hashtags.join(" ")].filter(Boolean).join("\n\n");

const TAG_RE = /^#[\p{L}\p{N}_]+$/u;

/** "#a #b", "a, b" or ["a", "#b"] → ["#a", "#b"], without repeats. Returns the tags that are not tags apart. */
function splitHashtags(raw: unknown): { tags: string[]; bad: string[] } {
  const items = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(/[\s,]+/) : [];
  const tags: string[] = [];
  const bad: string[] = [];
  for (const item of items) {
    if (typeof item !== "string") {
      bad.push(String(item));
      continue;
    }
    const word = item.trim().replace(/^#+/, "");
    if (!word) continue;
    const tag = `#${word}`;
    if (!TAG_RE.test(tag) || tag.length > HASHTAG_MAX) bad.push(item.trim());
    else if (!tags.some((t) => t.toLowerCase() === tag.toLowerCase())) tags.push(tag);
  }
  return { tags, bad };
}

/** Description keeps its line breaks (the networks show them), only the edges and Windows line ends are cleaned. */
const cleanDescription = (s: string) => s.replace(/\r\n?/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();

/** The owner's edit from the page: rejected whole with a Russian reason, never cut to fit. */
export function checkMeta(raw: Record<string, unknown>): Meta3D {
  if (typeof raw.title !== "string") throw new Studio3DError("Заголовок должен быть строкой", 400);
  if (typeof raw.description !== "string") throw new Studio3DError("Описание должно быть строкой", 400);
  if (!Array.isArray(raw.hashtags) && typeof raw.hashtags !== "string") throw new Studio3DError("Хэштеги — список или строка через пробел", 400);
  const title = cleanText(raw.title);
  if (!title) throw new Studio3DError("Нужен заголовок", 400);
  if (title.length > META_TITLE_MAX) throw new Studio3DError(`Заголовок — не длиннее ${META_TITLE_MAX} знаков (сейчас ${title.length})`, 400);
  const description = cleanDescription(raw.description);
  if (description.length > META_DESCRIPTION_MAX) {
    throw new Studio3DError(`Описание — не длиннее ${META_DESCRIPTION_MAX} знаков (сейчас ${description.length})`, 400);
  }
  const { tags, bad } = splitHashtags(raw.hashtags);
  if (bad.length) throw new Studio3DError(`Хэштег «${bad[0].slice(0, 40)}»: только буквы, цифры и _, без пробелов`, 400);
  if (tags.length > META_HASHTAGS_MAX) throw new Studio3DError(`Хэштегов — не больше ${META_HASHTAGS_MAX}`, 400);
  const meta = { title, description, hashtags: tags };
  const length = captionOf(meta).length;
  if (length > CAPTION_MAX) throw new Studio3DError(`Подпись целиком длиннее ${CAPTION_MAX} знаков (${length}) — TikTok её не примет`, 400);
  return meta;
}

/** Cuts at a word boundary: a generated title one word too long should lose that word, not half of it. */
function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max + 1);
  const space = cut.lastIndexOf(" ");
  return (space > max * 0.6 ? cut.slice(0, space) : cut.slice(0, max)).replace(/[\s,;:.-]+$/, "");
}

/** A generated caption is fitted into the limits instead of failing: the owner sees and edits it anyway. */
export function tidyMeta(raw: { title?: unknown; description?: unknown; hashtags?: unknown }, fallbackTitle: string): Meta3D {
  const title = clip(cleanText(typeof raw.title === "string" ? raw.title : "") || cleanText(fallbackTitle), META_TITLE_MAX);
  let description = clip(cleanDescription(typeof raw.description === "string" ? raw.description : ""), META_DESCRIPTION_MAX);
  const hashtags = splitHashtags(raw.hashtags).tags.slice(0, META_HASHTAGS_MAX);
  while (captionOf({ title, description, hashtags }).length > CAPTION_MAX && hashtags.length) hashtags.pop();
  const over = captionOf({ title, description, hashtags }).length - CAPTION_MAX;
  if (over > 0) description = clip(description, Math.max(0, description.length - over - 1));
  return { title, description, hashtags };
}

export async function saveMeta(id: string, meta: Meta3D): Promise<Project3D> {
  const { project } = await mutate(id, (p) => {
    p.meta = meta;
    p.updatedAt = new Date().toISOString();
  });
  return project;
}

/**
 * A paid action of «3Д» in the site's spend log (the «Расходы» page). Recorded without a main projectId on
 * purpose: that page links every row with one to /project/<projectId>, the main editor. A 3D id there opens
 * «Проект не найден», and the mirror's id would open the main editor of the hidden mirror (where its cover
 * could be redrawn and its caption edited past the 3D page) — and before the first publication there is no
 * mirror at all. Without a projectId the row shows the video's title as plain text; the label says «3Д».
 */
export function siteSpend<T>(topic: string, label: string, fn: () => Promise<T>): Promise<T> {
  return recordSiteSpend({ projectId: null, topic, label }, fn);
}

export type MetaDeps = {
  /** The paid caption call; tests replace it. title names the video in the spend log. */
  generate: (topic: string, script: string, title: string) => Promise<{ meta: { title?: unknown; description?: unknown; hashtags?: unknown } }>;
};

const liveGenerate: MetaDeps["generate"] = (topic, script, title) => siteSpend(title, "Описание (3Д)", () => generateMeta(topic, script));

/**
 * A new caption from the dialogue. onlyIfMissing (the automatic one after a montage) keeps a caption
 * the owner typed while the model was thinking.
 */
export async function regenerateMeta(id: string, opts: { onlyIfMissing?: boolean } = {}, deps: Partial<MetaDeps> = {}): Promise<Project3D> {
  const p = getProject(id);
  if (!p) throw new Studio3DError("Проект не найден", 404);
  const script = dialogueText(p.script);
  if (!script) throw new Studio3DError("Сначала нужен сценарий", 409);
  if (opts.onlyIfMissing && p.meta) return p;
  const fallback = p.script?.title || p.topic;
  const { meta } = await (deps.generate ?? liveGenerate)(p.topic, script, projectTitle(p));
  const next = tidyMeta(meta ?? {}, fallback);
  const { project } = await mutate(id, (q) => {
    if (opts.onlyIfMissing && q.meta) return;
    q.meta = next;
    q.updatedAt = new Date().toISOString();
  });
  return project;
}
