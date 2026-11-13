import type { SidSource } from "../sid/types";
import { isHttpUrl } from "../sid/content";
import type { StyleId } from "./catalog";
import type { Card, CartoonContent, CinemaContent, DisputeContent, MarketContent, SchemeContent, StyledContent, StyledResearch, ToolkitContent, UrgentContent } from "./types";

type Styled = Exclude<StyleId, "investigation">;

/** Длина текста так, как его видит читатель: без разметки цвета и жирного. */
export const shown = (s: string) => [...String(s ?? "").replace(/\[\/?[rgbyw]\]/g, "").replace(/\*\*/g, "")].length;

const str = (v: unknown, max = 600) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
export const ICONS = ["key", "shield", "eye", "list", "coin", "chart", "link", "alert", "money", "search", "puzzle", "bubble", "check"];

function sources(v: unknown): SidSource[] {
  return arr(v).map((s: any) => ({ url: str(s?.url, 500), title: str(s?.title, 200), publisher: str(s?.publisher, 80), date: str(s?.date, 20) || undefined })).filter((s) => isHttpUrl(s.url));
}
const card = (c: any): Card => ({ icon: ICONS.includes(c?.icon) ? c.icon : "check", title: str(c?.title, 60), text: str(c?.text, 200) });
// пределы длины проверяет styledProblems: здесь обрезка только от явного мусора, иначе текст рвётся посреди тега
const pair = (v: unknown): [string, string] => { const a = arr(v); return [str(a[0], 120), str(a[1], 400)]; };
const key = (v: unknown) => str(v, 80).toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");

/**
 * «Срочно» — новость сегодняшнего или вчерашнего дня по часовому поясу аккаунта. Возвращает, что не так с датой
 * события, или null. Запас в день вперёд: в Америке ещё вчера, а по Кызылорде уже сегодня, и наоборот.
 */
export function urgentStaleness(eventDate: unknown, now = new Date(), timeZone = process.env.CAROUSEL_TIME_ZONE || "Asia/Qyzylorda"): string | null {
  const date = typeof eventDate === "string" ? eventDate.trim() : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) return "в исследовании нет даты события (extra.eventDate)";
  const today = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const days = (Date.parse(today) - Date.parse(date)) / 86_400_000;
  if (days > 1) return `событие от ${date}, а нужно сегодня или вчера (сегодня ${today})`;
  if (days < -1) return `дата события ${date} ещё не наступила (сегодня ${today})`;
  return null;
}

export function parseStyledResearch(raw: unknown): StyledResearch {
  const r = raw as any;
  const topic = str(r?.topic, 200), topicKey = key(r?.topicKey);
  if (!topic || !topicKey) throw new Error("В исследовании нет темы");
  const facts = arr(r?.facts).map((f: any, i) => ({ id: str(f?.id, 20) || `f${i + 1}`, claim: str(f?.claim, 500), quote: str(f?.quote, 600), url: str(f?.url, 500), publisher: str(f?.publisher, 80), date: str(f?.date, 20) || undefined })).filter((f) => f.claim && isHttpUrl(f.url));
  if (facts.length < 4) throw new Error(`В исследовании мало фактов: ${facts.length}`);
  const pages = arr(r?.pages).map((p: any) => ({ url: str(p?.url, 500), publisher: str(p?.publisher, 80), headline: str(p?.headline, 300) })).filter((p) => isHttpUrl(p.url));
  return { topic, topicKey, angle: str(r?.angle, 800), facts, pages, extra: r?.extra && typeof r.extra === "object" ? r.extra : {} };
}

/** Содержимое в форме стиля; явно сломанное (нет слайдов) — ошибка, мелочи ловит styledProblems. */
export function parseStyled(style: Styled, raw: unknown): StyledContent {
  const r = raw as any;
  const base = { topic: str(r?.topic, 200), topicKey: key(r?.topicKey), caption: str(r?.caption, 1200), sources: sources(r?.sources) };
  if (!base.topic) throw new Error("В тексте карусели нет темы");
  switch (style) {
    case "urgent": {
      const slides = arr(r?.slides).map((s: any) => ({ text: str(s?.text, 400), sub: str(s?.sub, 120), scene: str(s?.scene, 1200) })).filter((s) => s.text);
      if (slides.length !== 3) throw new Error(`Нужно 3 слайда, пришло ${slides.length}`);
      return { ...base, slides } satisfies UrgentContent;
    }
    case "toolkit": {
      const block = (b: any) => ({ head: pair(b?.head), cards: arr(b?.cards).map(card), punch: str(b?.punch, 160) });
      const items = arr(r?.items).map((it: any) => ({ name: str(it?.name, 60), url: str(it?.url, 500), ...block(it) })).filter((it) => it.name && isHttpUrl(it.url));
      if (items.length < 3) throw new Error(`Сервисов меньше трёх: ${items.length}`);
      return { ...base, cover: { l1: str(r?.cover?.l1, 60), l2: str(r?.cover?.l2, 40), l3: str(r?.cover?.l3, 60), sub: str(r?.cover?.sub, 200), scene: str(r?.cover?.scene, 1200) }, story: { ...block(r?.story), url: str(r?.story?.url, 500) }, items: items.slice(0, 7), checklist: block(r?.checklist) } satisfies ToolkitContent;
    }
    case "market": {
      const rows = arr(r?.cover?.rows).map((x) => { const a = arr(x); return [str(a[0], 40), str(a[1], 30), str(a[2], 60)] as [string, string, string]; }).filter((x) => x[0] && x[1]);
      const slides = arr(r?.slides).map((s: any) => ({ text: str(s?.text, 400), scene: str(s?.scene, 1200) })).filter((s) => s.text);
      if (slides.length < 3) throw new Error(`Слайдов участников меньше трёх: ${slides.length}`);
      return { ...base, cover: { title: str(r?.cover?.title, 60), rows: rows.slice(0, 6), cta: str(r?.cover?.cta, 60) || "Листай: что с каждой →", scene: str(r?.cover?.scene, 1200) }, slides: slides.slice(0, 7) } satisfies MarketContent;
    }
    case "cartoon": {
      const slides = arr(r?.slides).map((s: any, i) => ({ ...(i === 0 && str(s?.big, 40) ? { big: str(s?.big, 40) } : {}), text: str(s?.text, 400), scene: str(s?.scene, 1200) })).filter((s) => s.text);
      if (slides.length !== 4) throw new Error(`Нужно 4 слайда, пришло ${slides.length}`);
      return { ...base, slides } satisfies CartoonContent;
    }
    case "cinema": {
      const lines = arr(r?.cover?.lines).map((l) => str(l, 80)).filter(Boolean);
      if (!lines.length) throw new Error("На обложке нет строк");
      const period = ["24h", "7d", "30d"].includes(r?.heatmap?.period) ? r.heatmap.period : "7d";
      return { ...base, cover: { lines: lines.slice(0, 4), scene: str(r?.cover?.scene, 1200) }, heatmap: { title: str(r?.heatmap?.title, 80), period, subtitle: str(r?.heatmap?.subtitle, 80) } } satisfies CinemaContent;
    }
    case "dispute": {
      const posts = arr(r?.posts).map((p: any) => ({ head: str(p?.head, 120), paras: arr(p?.paras).map((x) => str(x, 400)).filter(Boolean).slice(0, 2), tweetId: str(p?.tweetId, 30).replace(/\D/g, "") })).filter((p) => p.head && p.tweetId);
      if (posts.length < 2) throw new Error(`Постов меньше двух: ${posts.length}`);
      const facts = arr(r?.final?.facts).map(pair).filter((f) => f[0] && f[1]);
      // схема необязательна: без предмета или с одной-двумя частями рисовать нечего, карусель выходит без неё
      const parts = arr(r?.scheme?.parts).map(pair).filter((x) => x[0] && x[1]).slice(0, 4);
      const scene = str(r?.scheme?.scene, 1600);
      const scheme: SchemeContent | undefined = scene && parts.length >= 3 ? { head: str(r?.scheme?.head, 120), lead: str(r?.scheme?.lead, 300), object: str(r?.scheme?.object, 80), scene, parts } : undefined;
      return { ...base, cover: { head: str(r?.cover?.head, 120), sub: str(r?.cover?.sub, 120), scene: str(r?.cover?.scene, 1200) }, posts: posts.slice(0, 3), ...(scheme ? { scheme } : {}), final: { head: str(r?.final?.head, 80), intro: str(r?.final?.intro, 300), facts: facts.slice(0, 4) } } satisfies DisputeContent;
    }
  }
}

/** Все текстовые поля с путями — для пунктуации и пределов. */
export function styledFields(style: Styled, c: StyledContent): [string, string, number][] {
  const f: [string, string, number][] = [["caption", c.caption, 600]];
  const cards = (p: string, cs: Card[]) => cs.forEach((x, i) => { f.push([`${p}.cards[${i}].title`, x.title, 20], [`${p}.cards[${i}].text`, x.text, 84]); });
  switch (style) {
    case "urgent": (c as UrgentContent).slides.forEach((s, i) => f.push([`slides[${i}].text`, s.text, 125], [`slides[${i}].sub`, s.sub, 32])); break;
    case "toolkit": {
      const t = c as ToolkitContent;
      f.push(["cover.l1", t.cover.l1, 16], ["cover.l2", t.cover.l2, 10], ["cover.l3", t.cover.l3, 18], ["cover.sub", t.cover.sub, 90]);
      const block = (p: string, b: { head: [string, string]; cards: Card[]; punch: string }) => { f.push([`${p}.head[0]`, b.head[0], 18], [`${p}.head[1]`, b.head[1], 18], [`${p}.punch`, b.punch, 46]); cards(p, b.cards); };
      block("story", t.story); t.items.forEach((it, i) => block(`items[${i}]`, it)); block("checklist", t.checklist);
      break;
    }
    case "market": {
      const m = c as MarketContent;
      f.push(["cover.title", m.cover.title, 18]);
      m.cover.rows.forEach((r, i) => f.push([`cover.rows[${i}][0]`, r[0], 12], [`cover.rows[${i}][1]`, r[1], 9], [`cover.rows[${i}][2]`, r[2], 24]));
      m.slides.forEach((s, i) => f.push([`slides[${i}].text`, s.text, 112]));
      break;
    }
    case "cartoon": (c as CartoonContent).slides.forEach((s, i) => { if (s.big) f.push([`slides[${i}].big`, s.big, 16]); f.push([`slides[${i}].text`, s.text, 104]); }); break;
    case "cinema": (c as CinemaContent).cover.lines.forEach((l, i) => f.push([`cover.lines[${i}]`, l, 21])); f.push(["heatmap.title", (c as CinemaContent).heatmap.title, 30]); break;
    case "dispute": {
      const d = c as DisputeContent;
      f.push(["cover.head", d.cover.head, 40], ["cover.sub", d.cover.sub, 36], ["final.head", d.final.head, 40], ["final.intro", d.final.intro, 170]);
      d.posts.forEach((p, i) => { f.push([`posts[${i}].head`, p.head, 40]); p.paras.forEach((x, j) => f.push([`posts[${i}].paras[${j}]`, x, 175])); });
      d.final.facts.forEach(([k, v], i) => f.push([`final.facts[${i}][0]`, k, 9], [`final.facts[${i}][1]`, v, 95]));
      if (d.scheme) {
        f.push(["scheme.head", d.scheme.head, 40], ["scheme.lead", d.scheme.lead, 110], ["scheme.object", d.scheme.object, 28]);
        d.scheme.parts.forEach(([k, v], i) => f.push([`scheme.parts[${i}][0]`, k, 22], [`scheme.parts[${i}][1]`, v, 56]));
      }
      break;
    }
  }
  return f;
}

/** Предложения подписи: точка, ! или ? и пробел перед заглавной буквой, цифрой или кавычкой. */
export const captionSentences = (s: string) => s.trim().split(/(?<=[.!?])\s+(?=[«"$\p{Lu}\d])/u).filter(Boolean);

/** Что нарушает правила аккаунта: длина, длинное тире, «экс-», подпись, число слайдов и карточек. */
export function styledProblems(style: Styled, c: StyledContent): string[] {
  const p: string[] = [];
  for (const [path, text, max] of styledFields(style, c)) {
    if (path !== "caption" && !text) p.push(`${path}: пусто`);
    if (shown(text) > max) p.push(`${path}: ${shown(text)} знаков при пределе ${max}: «${text}»`);
    if (/—|\s–\s/.test(text)) p.push(`${path}: длинное тире; перепиши через двоеточие, точку или другими словами: «${text}»`);
    if (/(^|[^\p{L}])экс-/iu.test(text)) p.push(`${path}: вместо «экс-» пиши «бывший»: «${text}»`);
  }
  if (/#/.test(c.caption)) p.push("caption: без хэштегов");
  if (/\p{Extended_Pictographic}/u.test(c.caption)) p.push("caption: без эмодзи");
  if (!/\?/.test(c.caption)) p.push("caption: нужен вопрос к читателю");
  const told = captionSentences(c.caption).filter((s) => !s.endsWith("?") && !/^Пиши в комментариях/.test(s));
  if (told.length > 2) p.push(`caption: до вопроса ${told.length} предложения, а подпись держится на двух с главными фактами: объедини или убери лишнее: «${c.caption}»`);
  if (style === "toolkit") {
    const t = c as ToolkitContent;
    for (const [path, b] of [["story", t.story], ...t.items.map((it, i) => [`items[${i}]`, it] as const), ["checklist", t.checklist]] as const) if (b.cards.length !== 4) p.push(`${path}: нужно ровно 4 карточки, сейчас ${b.cards.length}`);
  }
  if (style === "market" && (c as MarketContent).cover.rows.length < 4) p.push("cover.rows: на обложке-сводке нужно 4–6 участников со своими цифрами");
  return p;
}
