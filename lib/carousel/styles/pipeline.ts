import fs from "fs";
import path from "path";
import crypto from "crypto";
import sharp from "sharp";
import type { Page } from "playwright";
import type { CarouselJob, Slide } from "../types";
import { cleanupSlideFiles, getCarousel, listCarousels, newId, notFound, slideFilePath, updateCarousel, writeFileAtomic } from "../store";
import { instagramImageProblems } from "../jpeg";
import { sidClaude } from "../sid/claude";
import { extractJson, hostOf } from "../sid/content";
import { captureSource } from "../sid/shots";
import { holdSidBrowser, sidBrowser } from "../sid/render";
import { addTopic, readTopics } from "../sid/topics";
import { sidSlideHash } from "../sid/hash";
import { sidDir } from "../sid/paths";
import type { SidStage } from "../sid/types";
import { styleName, type StyleId } from "./catalog";
import { styledFixTask, styledResearchTask, styledVerifyTask, styledWriteTask } from "./prompts";
import { parseStyled, parseStyledResearch, styledProblems, urgentStaleness } from "./validate";
import { coinLogo, heatData, makeImage, siteShot, tweetShot } from "./media";
import { capsHtml, cinemaCoverHtml, disputeCoverHtml, disputeInnerHtml, disputeSchemeHtml, FIT, H, heatmapHtml, marketCoverHtml, toolkitCoverHtml, toolkitItemHtml, urgentHtml, W } from "./html";
import type { CartoonContent, CinemaContent, DisputeContent, HeatTile, MarketContent, StyledContent, StyledData, StyledResearch, ToolkitContent, UrgentContent } from "./types";

/**
 * «Создать» в шести новых стилях (владелец 01.11): тема под стиль (Claude с поиском) → тексты → проверка фактов →
 * картинки и снимки → сборка слайдов. Каждый шаг сохраняет результат в карусель или в папку sid/, поэтому
 * «Повторить» после ошибки продолжает с места остановки и не заказывает готовое заново.
 */

type Styled = Exclude<StyleId, "investigation">;
type Step = (text: string, progress: number) => void;

const handle = () => process.env.CAROUSEL_SID_HANDLE || "@owner.threads";
const file = (id: string, name: string) => path.join(sidDir(id), name);
const STAGE: Record<StyledData["stage"], SidStage> = { research: "research", write: "write", verify: "verify", media: "cover", render: "render", done: "done" };

function today(): string {
  return new Intl.DateTimeFormat("ru-RU", { timeZone: process.env.CAROUSEL_TIME_ZONE || "Asia/Qyzylorda", day: "numeric", month: "long", year: "numeric" }).format(new Date());
}

function styled(id: string): StyledData {
  const c = getCarousel(id);
  if (!c?.sid?.styled) throw new Error("Карусель не в стиле раздела");
  return c.sid.styled;
}

function save(id: string, patch: Partial<StyledData>) {
  updateCarousel(id, (c) => {
    if (!c.sid?.styled) throw new Error("Карусель не в стиле раздела");
    Object.assign(c.sid.styled, patch);
    if (patch.stage) c.sid.stage = STAGE[patch.stage];
  });
}

/** Сцены последних каруселей: генератор их не повторяет, чтобы три карусели подряд не начинались одной картинкой. */
export function recentScenes(id: string, limit = 14): string[] {
  const out: string[] = [];
  const list = listCarousels().filter((c) => c.id !== id && c.schema === 4 && c.sid).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  for (const c of list) {
    const content = c.sid?.styled?.content as any;
    const scenes: string[] = [content?.cover?.scene, ...(content?.slides ?? []).map((s: any) => s?.scene), c.sid?.content?.cover?.scene].filter((x): x is string => typeof x === "string" && x.length > 10);
    for (const s of scenes) if (out.length < limit) out.push(s.slice(0, 140));
    if (out.length >= limit) break;
  }
  return out;
}

async function research(id: string, style: Styled, step: Step): Promise<StyledResearch> {
  const s = styled(id);
  if (s.research) return s.research;
  step("Ищу свежую историю под стиль: это 5–15 минут", 4);
  save(id, { stage: "research" });
  let last: unknown;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const rejected = last ? String((last as Error).message ?? last).slice(0, 200) : undefined;
      const text = await sidClaude({ label: `карусель «${styleName(style)}»: тема и факты`, ...styledResearchTask(style, today(), readTopics(), rejected), tools: "web", effort: "high" });
      const r = parseStyledResearch(extractJson(text));
      if (readTopics().some((t) => t.key === r.topicKey)) throw new Error(`тема «${r.topic}» уже была`);
      const extra = r.extra as any;
      if (style === "urgent") {
        const stale = urgentStaleness(extra?.eventDate);
        if (stale) throw new Error(stale);
      }
      if (style === "toolkit" && (!Array.isArray(extra?.services) || extra.services.length < 3)) throw new Error("в исследовании меньше трёх сервисов");
      if (style === "dispute" && (!Array.isArray(extra?.posts) || extra.posts.filter((p: any) => /^\d{8,}$/.test(String(p?.tweetId ?? ""))).length < 2)) throw new Error("в исследовании меньше двух постов с номерами");
      writeFileAtomic(file(id, "research.json"), JSON.stringify(r, null, 2));
      save(id, { research: r });
      return r;
    } catch (e) {
      last = e;
      step(`Исследование не подошло (${String((e as Error).message).slice(0, 80)}), ищу ещё раз`, 6);
    }
  }
  throw new Error(`Не удалось найти и проверить историю: ${String((last as Error)?.message ?? last)}`);
}

/** Правка по списку проблем, до двух кругов; то, что осталось, уходит в итог. */
async function fixUntilClean(style: Styled, content: StyledContent, label: string): Promise<{ content: StyledContent; left: string[] }> {
  let c = content;
  for (let round = 0; round < 2; round++) {
    const problems = styledProblems(style, c);
    if (!problems.length) return { content: c, left: [] };
    const answer = extractJson(await sidClaude({ label, ...styledFixTask(c, problems), effort: "medium" })) as any;
    c = parseStyled(style, answer?.content ?? answer);
  }
  return { content: c, left: styledProblems(style, c) };
}

async function write(id: string, style: Styled, r: StyledResearch, step: Step): Promise<StyledContent> {
  const s = styled(id);
  if (s.content) return s.content;
  step("Пишу тексты слайдов", 30);
  save(id, { stage: "write" });
  let last: unknown;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const text = await sidClaude({ label: `карусель «${styleName(style)}»: тексты`, ...styledWriteTask(style, r, recentScenes(id)), effort: "high" });
      let content = parseStyled(style, extractJson(text));
      if (style === "dispute") {
        const known = new Set(((r.extra as any)?.posts ?? []).map((p: any) => String(p?.tweetId ?? "")));
        (content as DisputeContent).posts = (content as DisputeContent).posts.filter((p) => known.has(p.tweetId));
        if ((content as DisputeContent).posts.length < 2) throw new Error("в тексте меньше двух постов из исследования");
      }
      content = (await fixUntilClean(style, content, "карусель: правка текстов")).content;
      save(id, { content });
      return content;
    } catch (e) {
      last = e;
      step(`Тексты не подошли (${String((e as Error).message).slice(0, 80)}), пишу заново`, 32);
    }
  }
  throw new Error(`Не удалось написать тексты: ${String((last as Error)?.message ?? last)}`);
}

/**
 * Схема «Разбора» рисуется, пока идёт проверка фактов: цифры на рисунке уже стоят по частям. Поэтому правки
 * текста меняют только слова частей; число частей, их порядок на рисунке и сцена остаются прежними.
 */
export function keepScheme<T extends StyledContent>(before: StyledContent, after: T): T {
  const was = (before as DisputeContent).scheme;
  if (!was) return after;
  const now = (after as DisputeContent).scheme;
  (after as DisputeContent).scheme = now && now.parts.length === was.parts.length ? { ...now, scene: was.scene } : was;
  return after;
}

async function verify(id: string, style: Styled, content: StyledContent, r: StyledResearch, step: Step): Promise<StyledContent> {
  const s = styled(id);
  if (s.verified && s.content) return s.content;
  step("Проверяю факты", 45);
  save(id, { stage: "verify" });
  let checked = content;
  let notes: string[] = [];
  try {
    const answer = extractJson(await sidClaude({ label: "карусель: проверка фактов", ...styledVerifyTask(content, r), effort: "high" })) as any;
    checked = parseStyled(style, answer?.content ?? answer);
    notes = Array.isArray(answer?.changes) ? answer.changes.map(String).slice(0, 30) : [];
    if (style === "dispute") (checked as DisputeContent).posts = (content as DisputeContent).posts.map((p, i) => ({ ...((checked as DisputeContent).posts[i] ?? p), tweetId: p.tweetId }));
  } catch (e) {
    notes = [`проверка вернула не тот формат, тексты оставлены как были: ${String((e as Error).message).slice(0, 120)}`];
  }
  const fixed = await fixUntilClean(style, checked, "карусель: правка после проверки");
  const kept = keepScheme(content, fixed.content);
  save(id, { content: kept, verified: true, verifyNotes: notes });
  return kept;
}

const LOWER = "The lower third of the frame is calm and simple because a caption will be placed there.";
// светлый переход под заголовок делает вёрстка (.fog); художнику нужна только светлая спокойная поверхность внизу
const FOG = "The object lies on a light plain surface; the bottom third of the frame is just more of this light surface, calm and empty, for a title added later. No faces.";
const CARTOON_REF = () => path.join(process.cwd(), "lib", "carousel", "styles", "refs", "cartoon.jpg");

/** Картинки и снимки слайдов; готовые файлы не переделываются. */
async function media(id: string, style: Styled, content: StyledContent, step: Step): Promise<Record<string, string>> {
  const s = styled(id);
  const have: Record<string, string> = { ...(s.media ?? {}) };
  const notes: string[] = [...(s.notes ?? [])];
  save(id, { stage: "media" });
  const put = (slot: string, name: string, buf: Buffer) => { writeFileAtomic(file(id, name), buf); have[slot] = name; save(id, { media: { ...have }, notes: [...notes] }); };
  const exists = (slot: string) => have[slot] && fs.existsSync(file(id, have[slot]));
  const image = async (slot: string, scene: string, kind: "photo" | "cartoon" | "scheme", label: string, progress: number, refs: Buffer[] = [], tail = LOWER, markers?: number) => {
    if (exists(slot)) return;
    const r = await makeImage(scene, kind, { refs, tail, label, topic: content.topic, markers, onStep: (t) => step(t, progress) });
    if (r.note) notes.push(r.note);
    put(slot, `${slot}.png`, r.png);
  };
  const read = (slot: string) => fs.readFileSync(file(id, have[slot]));
  switch (style) {
    case "urgent": {
      const c = content as UrgentContent;
      await image("img-0", c.slides[0].scene, "photo", "первое фото", 55);
      // первое фото — образец для остальных, их мост рисует одновременно
      await Promise.all([
        image("img-1", `${c.slides[1].scene} Another frame from the same photo report as the reference image: same place, same light, same colors.`, "photo", "второе фото", 62, [read("img-0")]),
        image("img-2", `${c.slides[2].scene} Another frame from the same photo report as the reference image: same place, same light, same colors.`, "photo", "третье фото", 69, [read("img-0")]),
      ]);
      break;
    }
    case "toolkit": {
      const c = content as ToolkitContent;
      // обложка рисуется, пока браузер снимает статью и сайты
      await Promise.all([image("img-cover", c.cover.scene, "photo", "обложку", 55, [], "No faces. The object of the story is large in the upper part of the frame; the lower part is more of the same plain surface."), (async () => {
        const browser = await sidBrowser();
        if (!exists("shot-story")) {
          step("Снимаю статью о случае", 64);
          const shot = await captureSource(browser, c.story.url, { title: c.story.head.join(" "), publisher: hostOf(c.story.url) });
          put("shot-story", "shot-story.png", shot.png);
        }
        for (let i = 0; i < c.items.length; i++) {
          if (exists(`shot-item-${i}`)) continue;
          step(`Снимаю сайт ${c.items[i].name}`, 66 + i);
          const png = (await siteShot(browser, c.items[i].url)) ?? (await captureSource(browser, c.items[i].url, { title: c.items[i].name, publisher: hostOf(c.items[i].url) })).png;
          put(`shot-item-${i}`, `shot-item-${i}.png`, png);
        }
      })()]);
      break;
    }
    case "market": {
      const c = content as MarketContent;
      // фото не зависят друг от друга — все сразу; мост рисует по несколько одновременно
      await Promise.all([
        image("img-cover", c.cover.scene, "photo", "обложку", 52, [], "The upper half of the frame holds the scene; the lower half is calm."),
        ...c.slides.map((sl, i) => image(`img-${i}`, sl.scene, "photo", `фото ${i + 2} из ${c.slides.length + 1}`, 54 + i * 3)),
      ]);
      break;
    }
    case "cartoon": {
      const c = content as CartoonContent;
      const ref = fs.existsSync(CARTOON_REF()) ? [fs.readFileSync(CARTOON_REF())] : [];
      await image("img-0", c.slides[0].scene, "cartoon", "первую сцену", 55, ref, "Keep the lower third dark and empty for text.");
      // первая сцена — образец героев для остальных, их мост рисует одновременно
      await Promise.all(c.slides.slice(1).map((sl, k) => image(`img-${k + 1}`, `${sl.scene} The same coin characters as in the second reference image.`, "cartoon", `сцену ${k + 2}`, 58 + (k + 1) * 4, [...ref, read("img-0")], "Keep the lower third dark and empty for text.")));
      break;
    }
    case "cinema": {
      const c = content as CinemaContent;
      // обложка рисуется, пока снимаются цены и логотипы
      await Promise.all([image("img-cover", c.cover.scene, "photo", "обложку", 55), (async () => {
        if (exists("heat")) return;
        step("Снимаю цены 10 крупных монет", 66);
        const tiles = await heatData(c.heatmap.period);
        for (const t of tiles) {
          const logo = await coinLogo(t.sym);
          if (logo) { writeFileAtomic(file(id, `logo-${t.sym}.png`), logo); have[`logo-${t.sym}`] = `logo-${t.sym}.png`; }
        }
        put("heat", "heat.json", Buffer.from(JSON.stringify(tiles)));
        save(id, { heat: tiles });
      })()]);
      break;
    }
    case "dispute": {
      const c = content as DisputeContent;
      // обложка и схема рисуются, пока браузер снимает посты
      await Promise.all([image("img-cover", c.cover.scene, "photo", "обложку", 55, [], FOG), c.scheme ? image("img-scheme", c.scheme.scene, "scheme", "схему", 60, [], "", c.scheme.parts.length) : null, (async () => {
        const browser = await sidBrowser();
        for (let i = 0; i < c.posts.length; i++) {
          if (exists(`tweet-${i}`)) continue;
          step(`Снимаю пост ${i + 1}`, 64 + i * 2);
          const png = await tweetShot(browser, c.posts[i].tweetId);
          if (!png) throw new Error(`Пост ${c.posts[i].tweetId} не загрузился через embed X`);
          put(`tweet-${i}`, `tweet-${i}.png`, png);
        }
      })()]);
      break;
    }
  }
  return have;
}

async function asUrl(buf: Buffer, width = 1300): Promise<string> {
  const jpg = await sharp(buf).resize({ width, withoutEnlargement: true }).jpeg({ quality: 90 }).toBuffer();
  return `data:image/jpeg;base64,${jpg.toString("base64")}`;
}
const pngUrl = (buf: Buffer) => `data:image/png;base64,${buf.toString("base64")}`;

/** HTML всех слайдов стиля по порядку. */
async function pages(id: string, style: Styled, content: StyledContent, m: Record<string, string>): Promise<string[]> {
  const get = (slot: string) => fs.readFileSync(file(id, m[slot]));
  const h = handle();
  switch (style) {
    case "urgent": {
      const c = content as UrgentContent;
      return Promise.all(c.slides.map(async (_, i) => urgentHtml(c, i, await asUrl(get(`img-${i}`)), h)));
    }
    case "toolkit": {
      const c = content as ToolkitContent;
      const top = async (buf: Buffer) => { const meta = await sharp(buf).metadata(); const w = meta.width ?? 1440; const hh = Math.min(meta.height ?? 900, Math.round(w * 372 / 952)); return asUrl(await sharp(buf).extract({ left: 0, top: 0, width: w, height: hh }).toBuffer(), 1904); };
      const itemShots = await Promise.all(c.items.map((_, i) => top(get(`shot-item-${i}`))));
      return [
        toolkitCoverHtml(c, await asUrl(get("img-cover")), h),
        toolkitItemHtml(c.story, "story", [await asUrl(get("shot-story"), 1904)], hostOf(c.story.url), h),
        ...c.items.map((it, i) => toolkitItemHtml(it, `items[${i}]`, [itemShots[i]], hostOf(it.url), h)),
        toolkitItemHtml(c.checklist, "checklist", itemShots.slice(0, 4), "сохрани, чтобы не потерять", h),
      ];
    }
    case "market": {
      const c = content as MarketContent;
      return [marketCoverHtml(c, await asUrl(get("img-cover"))), ...(await Promise.all(c.slides.map(async (s, i) => capsHtml(s, `slides[${i}]`, await asUrl(get(`img-${i}`)), h, false))))];
    }
    case "cartoon": {
      const c = content as CartoonContent;
      return Promise.all(c.slides.map(async (s, i) => capsHtml(s, `slides[${i}]`, await asUrl(get(`img-${i}`)), h, i === 0)));
    }
    case "cinema": {
      const c = content as CinemaContent;
      const tiles: HeatTile[] = JSON.parse(get("heat").toString("utf8"));
      const logos: Record<string, string> = {};
      for (const t of tiles) if (fs.existsSync(file(id, `logo-${t.sym}.png`))) logos[t.sym] = pngUrl(fs.readFileSync(file(id, `logo-${t.sym}.png`)));
      return [cinemaCoverHtml(c, await asUrl(get("img-cover")), h), heatmapHtml(c, tiles, logos, h)];
    }
    case "dispute": {
      const c = content as DisputeContent;
      return [
        disputeCoverHtml(c, await asUrl(get("img-cover")), h),
        ...c.posts.map((p, i) => disputeInnerHtml(p.head, p.paras, `posts[${i}]`, { tweet: pngUrl(get(`tweet-${i}`)) }, h)),
        ...(c.scheme && m["img-scheme"] ? [disputeSchemeHtml(c.scheme, await asUrl(get("img-scheme"), 1100), h)] : []),
        disputeInnerHtml(c.final.head, [c.final.intro], "final", { facts: c.final.facts }, h),
      ];
    }
  }
}

async function shoot(page: Page, html: string): Promise<{ png: Buffer; problems: string[] }> {
  await page.setContent(html, { waitUntil: "load", timeout: 60_000 });
  await page.evaluate("document.fonts.ready.then(() => true)");
  const problems = (await page.evaluate(FIT)) as string[];
  const png = await page.screenshot({ type: "png", animations: "disabled", caret: "hide" });
  return { png, problems };
}

async function render(id: string, style: Styled, start: StyledContent, m: Record<string, string>, step: Step): Promise<{ content: StyledContent; notes: string[] }> {
  save(id, { stage: "render" });
  let content = start;
  const notes: string[] = [];
  const browser = await sidBrowser();
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  try {
    for (let round = 0; ; round++) {
      step(round ? `Сокращаю тексты, которые не поместились (${round})` : "Собираю слайды", 84 + round * 3);
      const shots = [];
      for (const html of await pages(id, style, content, m)) shots.push(await shoot(page, html));
      const problems = shots.flatMap((s) => s.problems);
      if (!problems.length || round >= 2) {
        if (problems.length) notes.push(`не уместилось после двух правок: ${problems.slice(0, 3).join("; ")}`);
        await saveSlides(id, content, shots.map((s) => s.png));
        return { content, notes };
      }
      const answer = extractJson(await sidClaude({ label: "карусель: правка слайдов", ...styledFixTask(content, problems), effort: "medium" })) as any;
      content = keepScheme(content, parseStyled(style, answer?.content ?? answer));
      notes.push(`поправлено при сборке: ${problems.length} мест`);
      save(id, { content });
    }
  } finally {
    await page.close().catch(() => {});
  }
}

async function saveSlides(id: string, content: StyledContent, pngs: Buffer[]) {
  const c = getCarousel(id);
  if (!c) throw notFound();
  const now = new Date().toISOString();
  const slides: Slide[] = [];
  for (let i = 0; i < pngs.length; i++) {
    const old = c.slides[i];
    const sid = old?.id ?? newId("s");
    const jpeg = await sharp(pngs[i]).jpeg({ quality: 92, chromaSubsampling: "4:4:4" }).toBuffer();
    const bad = instagramImageProblems(jpeg);
    if (bad.length) throw new Error(`Слайд ${i + 1}: ${bad.join(", ")}`);
    const name = `slide-${sid}-${crypto.createHash("sha1").update(jpeg).digest("hex").slice(0, 12)}.jpg`;
    writeFileAtomic(slideFilePath(id, name), jpeg);
    slides.push({ id: sid, kind: i === 0 ? "cover" : i === pngs.length - 1 ? "final" : "content", kicker: "", title: i === 0 ? content.topic : `Слайд ${i + 1}`, body: "", bullets: [], cta: "", render: { hash: sidSlideHash(sid), file: name, width: W, height: H, bytes: jpeg.length, at: now } });
  }
  updateCarousel(id, (x) => {
    x.slides = slides;
    x.caption = content.caption;
    x.hashtags = [];
    x.title = content.topic;
    if (x.sid) x.sid.sources = content.sources;
  }, { content: true });
  cleanupSlideFiles(id);
}

export async function runStyled(id: string, job: CarouselJob, step: Step): Promise<string | undefined> {
  const c = getCarousel(id);
  const style = c?.sid?.style;
  if (!c?.sid || !style || style === "investigation") throw new Error("Карусель не в стиле раздела");
  if (!c.sid.styled) updateCarousel(id, (x) => { x.sid!.styled = { style, stage: "research" }; });
  const release = holdSidBrowser();
  try {
    fs.mkdirSync(sidDir(id), { recursive: true });
    const r = await research(id, style, step);
    let content = await write(id, style, r, step);
    // картинкам нужны только сцены из написанного текста: они рисуются, пока Claude проверяет факты
    const [checked, m] = await Promise.all([verify(id, style, content, r, step), media(id, style, content, step)]);
    content = checked;
    const out = await render(id, style, content, m, step);
    addTopic({ key: out.content.topicKey || r.topicKey, title: out.content.topic, at: new Date().toISOString(), carouselId: id });
    save(id, { stage: "done" });
    const s = styled(id);
    return ["Карусель готова", (s.verifyNotes ?? []).length ? `проверка фактов поправила: ${s.verifyNotes!.length}` : "", ...(s.notes ?? []), ...out.notes].filter(Boolean).join(". ");
  } finally {
    await release();
    void job;
  }
}
