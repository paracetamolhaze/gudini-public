import type { NewsMeta, NewsProject, NewsStory } from "./types";
import { ALARM_WORDS, cleanText, projectTitle, trialCalmTitle, withTelegram } from "./rules";
import { getProject, mutate, NewsError } from "./store";
import { generateMeta } from "../ai";
import { recordSiteSpend } from "../spendLog";

/**
 * Caption of a «Новости» video for the networks: the main site's caption writer (lib/ai generateMeta) gets the
 * story's voiced text as its script and the story's title as its topic, the owner edits the result on the page.
 * Limits are the strictest network's: YouTube cuts titles at 100 characters, TikTok refuses captions over 2200.
 */

export const META_TITLE_MAX = 100;
export const META_DESCRIPTION_MAX = 2000;
export const META_HASHTAGS_MAX = 30;
const HASHTAG_MAX = 60;
export const CAPTION_MAX = 2200;

/** What was voiced: the narration and the translated lines in order, without empty lines. */
export function storyText(story: NewsStory | null | undefined): string {
  return (story?.script ?? "")
    .split("\n")
    .map(cleanText)
    .filter(Boolean)
    .join("\n");
}

/** Exactly what the networks get: the same joining as the main publish code and the TikTok worker. */
export const captionOf = (m: NewsMeta) => [m.title, m.description, m.hashtags.join(" ")].filter(Boolean).join("\n\n");

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
export function checkMeta(raw: Record<string, unknown>): NewsMeta {
  if (typeof raw.title !== "string") throw new NewsError("Заголовок должен быть строкой", 400);
  if (typeof raw.description !== "string") throw new NewsError("Описание должно быть строкой", 400);
  if (!Array.isArray(raw.hashtags) && typeof raw.hashtags !== "string") throw new NewsError("Хэштеги — список или строка через пробел", 400);
  const title = cleanText(raw.title);
  if (!title) throw new NewsError("Нужен заголовок", 400);
  if (title.length > META_TITLE_MAX) throw new NewsError(`Заголовок — не длиннее ${META_TITLE_MAX} знаков (сейчас ${title.length})`, 400);
  const description = cleanDescription(raw.description);
  if (description.length > META_DESCRIPTION_MAX) {
    throw new NewsError(`Описание — не длиннее ${META_DESCRIPTION_MAX} знаков (сейчас ${description.length})`, 400);
  }
  const { tags, bad } = splitHashtags(raw.hashtags);
  if (bad.length) throw new NewsError(`Хэштег «${bad[0].slice(0, 40)}»: только буквы, цифры и _, без пробелов`, 400);
  if (tags.length > META_HASHTAGS_MAX) throw new NewsError(`Хэштегов — не больше ${META_HASHTAGS_MAX}`, 400);
  const meta = { title, description, hashtags: tags };
  const length = captionOf(meta).length;
  if (length > CAPTION_MAX) throw new NewsError(`Подпись целиком длиннее ${CAPTION_MAX} знаков (${length}) — TikTok её не примет`, 400);
  return meta;
}

/** Cuts at a word boundary: a generated title one word too long should lose that word, not half of it. */
function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max + 1);
  const space = cut.lastIndexOf(" ");
  return (space > max * 0.6 ? cut.slice(0, space) : cut.slice(0, max)).replace(/[\s,;:.-]+$/, "");
}

/**
 * Тире между словами в созданной подписи — двоеточием (владелец 12.11: «длинные тире запрещаю»; дефис с пробелами
 * читается тем же тире: «обновления - это не мелочь»). Дефис внутри слова («сид-фраза») не трогается.
 */
export const noDash = (s: string) => s.replace(/\s+[-–—]+\s+/g, ": ").replace(/[–—]/g, "-");

/** A generated caption is fitted into the limits instead of failing: the owner sees and edits it anyway. */
export function tidyMeta(raw: { title?: unknown; description?: unknown; hashtags?: unknown }, fallbackTitle: string): NewsMeta {
  const title = clip(noDash(cleanText(typeof raw.title === "string" ? raw.title : "") || cleanText(fallbackTitle)), META_TITLE_MAX);
  let description = clip(noDash(cleanDescription(typeof raw.description === "string" ? raw.description : "")), META_DESCRIPTION_MAX);
  const hashtags = splitHashtags(raw.hashtags).tags.slice(0, META_HASHTAGS_MAX);
  while (captionOf({ title, description, hashtags }).length > CAPTION_MAX && hashtags.length) hashtags.pop();
  const over = captionOf({ title, description, hashtags }).length - CAPTION_MAX;
  if (over > 0) description = clip(description, Math.max(0, description.length - over - 1));
  return { title, description, hashtags };
}

export async function saveMeta(id: string, meta: NewsMeta): Promise<NewsProject> {
  const { project } = await mutate(id, (p) => {
    p.meta = meta;
    p.updatedAt = new Date().toISOString();
  });
  return project;
}

/**
 * A paid action of «Новости» in the site's spend log (the «Расходы» page). Recorded without a main projectId on
 * purpose, like «3Д»: that page links every row with one to /project/<projectId>, the main editor, where neither a
 * news id nor the hidden mirror belongs. Without a projectId the row shows the video's title; the label says «Новости».
 */
export function siteSpend<T>(topic: string, label: string, fn: () => Promise<T>): Promise<T> {
  return recordSiteSpend({ projectId: null, topic, label }, fn);
}

export type MetaDeps = {
  /** The paid caption call; tests replace it. title names the video in the spend log. */
  generate: (topic: string, script: string, title: string) => Promise<{ meta: { title?: unknown; description?: unknown; hashtags?: unknown } }>;
};

const liveGenerate: MetaDeps["generate"] = (topic, script, title) => siteSpend(title, "Описание (Новости)", () => generateMeta(topic, script));

/**
 * The hero's username at the end of the description (owner 29.10: «в описании можно добавить юзернем»): the video is
 * built on their clips, and the networks read a credited source as commentary rather than a reupload.
 */
export function withHero(description: string, story: NewsStory | null | undefined): string {
  const handle = story?.hero?.match(/@[\w.]+/)?.[0];
  if (!handle || description.includes(handle)) return description;
  return [description.trim(), `Оригинал: ${handle}`].filter(Boolean).join("\n\n");
}

/**
 * What the caption writer is told in the calm arms of the YouTube experiment (lib/news/rules.ts TRIALS): the same event
 * by the same facts, named without the alarm words. It goes with the topic: the writer's own prompt is the main site's.
 */
export const CALM_NOTE =
  "Заголовок и подпись называют событие спокойно: те же факты без слов «взлом», «хакеры», «вирус», «украли», «поддельный», «мошенники». Так: «Binance: клиентам пишут „Выручи, братан“», «Liquid вернула клиентам 85% биткоинов», «DarkSword: как сайт добрался до кошелька на айфоне».";

/** A second launch gets its own title and caption: the networks have already seen the first ones. */
const relaunchNote = (first: string) => `Этот ролик уже выходил с заголовком «${first}». Сейчас он выходит второй раз с новым началом: напиши другой заголовок и другую подпись, другими словами и с другой стороны той же истории.`;

/** A note travels inside the topic; a writer that failed returns the topic as the title — such a title is not one. */
const ownTitle = (raw: { title?: unknown }) => (typeof raw.title === "string" && !raw.title.includes("\n") && !/Заголовок и подпись называют|уже выходил с заголовком/.test(raw.title) ? raw.title : "");

/**
 * A new caption from the story. onlyIfMissing (the automatic one after a video) keeps a caption the owner typed
 * while the model was thinking.
 */
export async function regenerateMeta(id: string, opts: { onlyIfMissing?: boolean } = {}, deps: Partial<MetaDeps> = {}): Promise<NewsProject> {
  const p = getProject(id);
  if (!p) throw new NewsError("Ролик не найден", 404);
  const script = storyText(p.story);
  if (!p.story || !script) throw new NewsError("Сначала нужна история", 409);
  if (opts.onlyIfMissing && p.meta) return p;
  const title = projectTitle(p);
  const generate = deps.generate ?? liveGenerate;
  const calm = trialCalmTitle(p.story);
  const first = p.story.relaunch ? getProject(p.story.relaunch.of)?.meta?.title : undefined;
  const notes = [calm ? CALM_NOTE : "", first ? relaunchNote(first) : ""].filter(Boolean);
  const topic = [p.story.title, ...notes].join("\n\n");
  let { meta } = await generate(topic, script, title);
  // a calm arm whose caption still names a hack or a theft gets one more try; the calmer of the two stays
  const alarms = (m: typeof meta) => (ALARM_WORDS.test(`${ownTitle(m ?? {})} ${typeof m?.description === "string" ? m.description : ""}`) ? 1 : 0);
  if (calm && alarms(meta)) {
    const again = await generate(`${topic}\n\nВ прошлом варианте остались тревожные слова — назови событие без них.`, script, title).catch(() => null);
    if (again && alarms(again.meta) < alarms(meta)) meta = again.meta;
  }
  const raw = { ...(meta ?? {}), title: ownTitle(meta ?? {}) };
  const next = tidyMeta({ ...raw, // «Оригинал: @ник» в подписи больше нет (владелец 10.11: «убери в описании текст оригинал @…»)
    description: withTelegram(typeof raw.description === "string" ? raw.description : "", p.story) }, title);
  const { project } = await mutate(id, (q) => {
    if (opts.onlyIfMissing && q.meta) return;
    q.meta = next;
    q.updatedAt = new Date().toISOString();
  });
  return project;
}
