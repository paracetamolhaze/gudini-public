import fs from "fs";
import path from "path";
import crypto from "crypto";
import sharp from "sharp";
import type { CarouselJob, Slide } from "../types";
import { cleanupSlideFiles, getCarousel, listCarousels, newId, notFound, slideFilePath, updateCarousel, writeFileAtomic } from "../store";
import { instagramImageProblems } from "../jpeg";
import type { SidContent, SidData, SidResearch, SidShot } from "./types";
import { dedupeSteps, extractJson, hostOf, leftoverFragments, parseContent, parseResearch, ruleProblems, windowUrl } from "./content";
import { fixTask, researchTask, verifyTask, writeTask } from "./prompts";
import { sidClaude } from "./claude";
import { captureSource } from "./shots";
import { makeCover } from "./cover";
import { holdSidBrowser, renderSid, sidBrowser } from "./render";
import { addTopic, readTopics } from "./topics";
import { sidSlideHash } from "./hash";
import { sidDir } from "./paths";

/**
 * Карусель по кнопке «Создать», целиком без участия владельца:
 * тема и факты (Claude с поиском) → тексты → скриншоты источников → проверка фактов по страницам →
 * обложка (GPT через мост Codex) → сборка слайдов. Видео не делается (владелец 28.10: «видео не нужно, только карусель»).
 * Каждый шаг сохраняет свой результат в карусель или в папку sid/: прерванное задание продолжается
 * с места остановки, а повтор после ошибки не заказывает готовое заново.
 */

type Step = (text: string, progress: number) => void;

export const SID_HANDLE = () => (process.env.CAROUSEL_SID_HANDLE || "@owner.threads").toUpperCase();

const sidFile = (id: string, name: string) => path.join(sidDir(id), name);

function today(): string {
  return new Intl.DateTimeFormat("ru-RU", { timeZone: process.env.CAROUSEL_TIME_ZONE || "Asia/Qyzylorda", day: "numeric", month: "long", year: "numeric" }).format(new Date());
}

function saveSid(id: string, patch: Partial<SidData>, extra?: (c: NonNullable<ReturnType<typeof getCarousel>>) => void) {
  updateCarousel(id, (c) => {
    if (!c.sid) throw new Error("Карусель не в формате раздела");
    Object.assign(c.sid, patch);
    extra?.(c);
  });
}

async function research(id: string, step: Step): Promise<SidResearch> {
  const file = sidFile(id, "research.json");
  if (fs.existsSync(file)) return parseResearch(JSON.parse(fs.readFileSync(file, "utf8")));
  step("Ищу свежую историю и источники — это 5–15 минут", 4);
  saveSid(id, { stage: "research" });
  const task = researchTask(today(), readTopics());
  let last: unknown;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const text = await sidClaude({ label: "карусель: тема и факты", ...task, tools: "web", effort: "high" });
      const r = parseResearch(extractJson(text));
      const done = new Set(readTopics().map((t) => t.key));
      if (done.has(r.topicKey)) throw new Error(`тема «${r.topic}» уже была`);
      fs.mkdirSync(sidDir(id), { recursive: true });
      writeFileAtomic(file, JSON.stringify(r, null, 2));
      return r;
    } catch (e) {
      last = e;
      step(`Исследование не подошло (${String((e as Error).message).slice(0, 80)}) — ищу ещё раз`, 6);
    }
  }
  throw new Error(`Не удалось найти и проверить историю: ${String((last as Error)?.message ?? last)}`);
}

async function write(id: string, r: SidResearch, step: Step): Promise<SidContent> {
  const c = getCarousel(id);
  if (c?.sid?.content) return c.sid.content;
  step("Пишу тексты слайдов", 30);
  saveSid(id, { stage: "write" });
  let last: unknown;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const written = parseContent(extractJson(await sidClaude({ label: "карусель: тексты", ...writeTask(r, recentCovers(id)), effort: "high" })));
      written.topicKey = written.topicKey || r.topicKey;
      // у каждого шага своё окно: повтор страницы заменяется другой из исследования
      const content = dedupeSteps(written, r).content;
      saveSid(id, { content }, (x) => {
        x.title = content.topic;
      });
      return content;
    } catch (e) {
      last = e;
    }
  }
  throw new Error(`Тексты не собрались: ${String((last as Error)?.message ?? last)}`);
}

function stepUrl(content: SidContent, i: number): string {
  return content.sources[content.steps[i].source]?.url ?? "";
}

async function shots(id: string, content: SidContent, r: SidResearch, step: Step, from: number, to: number): Promise<SidShot[]> {
  const current = getCarousel(id)?.sid?.shots ?? [];
  const out: SidShot[] = [];
  const browser = await sidBrowser();
  for (let i = 0; i < content.steps.length; i++) {
    const url = stepUrl(content, i);
    const have = current[i];
    if (have && have.url === url && fs.existsSync(sidFile(id, have.file))) {
      out.push(have);
      continue;
    }
    step(`Снимаю страницы источников: ${i + 1} из ${content.steps.length}`, from + ((to - from) * i) / content.steps.length);
    saveSid(id, { stage: "shots" });
    const page = r.pages.find((p) => p.url === url);
    const src = content.sources[content.steps[i].source];
    const shot = await captureSource(browser, url, { title: page?.headline || src?.title || "", publisher: src?.publisher || hostOf(url) });
    const file = `shot-${i + 1}.png`;
    writeFileAtomic(sidFile(id, file), shot.png);
    writeFileAtomic(sidFile(id, `page-${i + 1}.txt`), shot.text);
    const meta: SidShot = { kind: shot.kind, file, dark: shot.dark, host: hostOf(url), url, note: shot.note };
    out.push(meta);
    updateCarousel(id, (x) => {
      if (!x.sid) return;
      const list = x.sid.shots ?? [];
      list[i] = meta;
      x.sid.shots = list;
    });
  }
  return out;
}

/** Правка точечных замечаний Claude; поле source у шагов остаётся прежним — окна уже сняты под них. */
async function fixContent(content: SidContent, problems: string[], label: string): Promise<SidContent> {
  const answer = extractJson(await sidClaude({ label, ...fixTask(content, problems), effort: "medium" })) as any;
  const next = parseContent(answer?.content ?? answer, content.sources);
  next.topicKey = next.topicKey || content.topicKey;
  next.sources = content.sources;
  next.steps.forEach((s, i) => {
    s.source = content.steps[i].source;
    s.facts = content.steps[i].facts;
  });
  return next;
}

async function verify(id: string, content: SidContent, r: SidResearch, list: SidShot[], step: Step): Promise<SidContent> {
  const c = getCarousel(id);
  if (c?.sid?.verified && c.sid.content) return c.sid.content;
  step("Проверяю факты по страницам источников", 62);
  saveSid(id, { stage: "verify" });
  const pages = list.map((s, i) => ({ step: i + 1, url: s.url, text: fs.existsSync(sidFile(id, `page-${i + 1}.txt`)) ? fs.readFileSync(sidFile(id, `page-${i + 1}.txt`), "utf8") : "" }));
  const answer = extractJson(await sidClaude({ label: "карусель: проверка фактов", ...verifyTask(content, r, pages), effort: "high" })) as any;
  let fixed = parseContent(answer?.content ?? answer, content.sources);
  fixed.topicKey = fixed.topicKey || content.topicKey;
  fixed.steps.forEach((s, i) => (s.facts = s.facts ?? content.steps[i].facts));
  const unsupported = (Array.isArray(answer?.unsupported) ? answer.unsupported : []).map((u: any) => ({
    claim: String(typeof u === "string" ? u : u?.claim ?? "").slice(0, 300),
    fragments: (Array.isArray(u?.fragments) ? u.fragments : []).map((f: unknown) => String(f ?? "").slice(0, 120)).filter(Boolean) as string[],
  }));
  // неподтверждённое не доходит до слайдов: что осталось в тексте, плашках, карточках или подписи — переписывается
  const fragments = unsupported.flatMap((u: { fragments: string[] }) => u.fragments);
  for (let round = 1; ; round++) {
    const left = leftoverFragments(fixed, fragments);
    if (!left.length) break;
    if (round > 3) throw new Error(`Неподтверждённое не уходит из карусели: ${left.join(", ")}`);
    step(`Убираю неподтверждённое (${round})`, 64);
    fixed = await fixContent(fixed, left.map((f) => `неподтверждённый кусок «${f}» — убери или перепиши везде, где он стоит`), "карусель: неподтверждённое");
  }
  const deduped = dedupeSteps(fixed, r);
  fixed = deduped.content;
  const notes = [
    ...(Array.isArray(answer?.changes) ? answer.changes : []),
    ...unsupported.map((u: { claim: string; fragments: string[] }) => `не подтверждено и убрано со слайдов: ${u.claim}${u.fragments.length ? ` (${u.fragments.join(", ")})` : ""}`),
    ...deduped.changes,
  ].map((x) => String(x).slice(0, 300)).slice(0, 24);
  saveSid(id, { content: fixed, verified: true, verifyNotes: notes }, (x) => {
    x.title = fixed.topic;
  });
  return fixed;
}

/** Сцены обложек последних каруселей: сценарист берёт другой предмет и место, чтобы обложки не были на одно лицо. */
export function recentCovers(id: string, limit = 8): string[] {
  return listCarousels()
    .filter((c) => c.id !== id && c.sid)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((c) => (c.sid?.content?.cover?.scene ?? (c.sid?.styled?.content as any)?.cover?.scene) as unknown)
    .filter((x): x is string => typeof x === "string" && x.length > 10)
    .slice(0, limit)
    .map((x) => x.slice(0, 160));
}

async function cover(id: string, content: SidContent, step: Step): Promise<string> {
  const c = getCarousel(id);
  if (c?.sid?.coverFile && fs.existsSync(sidFile(id, c.sid.coverFile))) return c.sid.coverFile;
  saveSid(id, { stage: "cover" });
  const made = await makeCover(content.cover.scene, (text) => step(text, 72));
  writeFileAtomic(sidFile(id, "cover.png"), made.png);
  writeFileAtomic(sidFile(id, "cover-prompt.txt"), made.prompt);
  saveSid(id, { coverFile: "cover.png" });
  return "cover.png";
}

const dataUrl = (buf: Buffer, type = "image/png") => `data:${type};base64,${buf.toString("base64")}`;

async function render(id: string, start: SidContent, step: Step): Promise<{ content: SidContent; notes: string[] }> {
  saveSid(id, { stage: "render" });
  let content = start;
  const notes: string[] = [];
  for (let round = 0; ; round++) {
    step(round ? `Правлю тексты, которые не поместились или без значения (${round})` : "Собираю слайды", 80 + round * 2);
    const c = getCarousel(id);
    if (!c?.sid) throw notFound();
    const sid = c.sid;
    const list = sid.shots ?? [];
    const shotsIn = content.steps.map((s, i) => {
      const shot = list[i];
      if (!shot) throw new Error(`Нет скриншота для шага ${i + 1}`);
      return { dataUrl: dataUrl(fs.readFileSync(sidFile(id, shot.file))), dark: shot.dark, url: windowUrl(shot.url) };
    });
    const coverData = dataUrl(await sharp(fs.readFileSync(sidFile(id, sid.coverFile!))).jpeg({ quality: 92 }).toBuffer(), "image/jpeg");
    const out = await renderSid(content, { accent: sid.accent, coverAccent: sid.coverAccent, handle: SID_HANDLE() }, coverData, shotsIn);
    const rules = ruleProblems(content);
    const problems = [...out.problems, ...rules];
    if (!problems.length) {
      await saveSlides(id, content, out.slides.map((s) => s.png));
      return { content, notes };
    }
    if (round >= 3) throw new Error(`Слайды не собрались после трёх правок: ${problems.slice(0, 4).join("; ")}`);
    content = await fixContent(content, problems, "карусель: правка слайдов");
    notes.push(`поправлено при сборке: ${problems.length} мест`);
    saveSid(id, { content });
  }
}

async function saveSlides(id: string, content: SidContent, pngs: Buffer[]) {
  const c = getCarousel(id);
  if (!c) throw notFound();
  const kinds: Slide["kind"][] = ["cover", ...content.steps.map(() => "content" as const), "final"];
  const now = new Date().toISOString();
  const slides: Slide[] = [];
  for (let i = 0; i < pngs.length; i++) {
    const old = c.slides[i];
    const sid = old?.id ?? newId("s");
    const jpeg = await sharp(pngs[i]).jpeg({ quality: 92, chromaSubsampling: "4:4:4" }).toBuffer();
    const bad = instagramImageProblems(jpeg);
    if (bad.length) throw new Error(`Слайд ${i + 1}: ${bad.join(", ")}`);
    const file = `slide-${sid}-${crypto.createHash("sha1").update(jpeg).digest("hex").slice(0, 12)}.jpg`;
    writeFileAtomic(slideFilePath(id, file), jpeg);
    const step = i > 0 && i <= content.steps.length ? content.steps[i - 1] : null;
    slides.push({
      id: sid,
      kind: kinds[i],
      kicker: step?.label ?? "",
      title: i === 0 ? [...content.cover.title, content.cover.accentLine].join(" ") : step ? step.title : [...content.final.black, ...content.final.accent].join(" "),
      body: step?.body.replace(/\*\*/g, "") ?? (i === 0 ? content.cover.hook : content.final.body),
      bullets: [],
      cta: "",
      render: { hash: sidSlideHash(sid), file, width: 1080, height: 1350, bytes: jpeg.length, at: now },
    });
  }
  updateCarousel(id, (x) => {
    x.slides = slides;
    x.caption = content.caption;
    x.hashtags = [];
    x.title = content.topic;
  }, { content: true });
  cleanupSlideFiles(id);
}

export async function runSid(id: string, job: CarouselJob, step: Step): Promise<string | undefined> {
  if (!getCarousel(id)?.sid) throw new Error("Карусель не в формате раздела");
  const release = holdSidBrowser();
  try {
    fs.mkdirSync(sidDir(id), { recursive: true });
    const r = await research(id, step);
    let content = await write(id, r, step);
    // обложке нужна только сцена из написанного текста: она рисуется, пока снимаются страницы и проверяются факты
    const coverDone = cover(id, content, step);
    coverDone.catch(() => {});
    const list = await shots(id, content, r, step, 40, 60);
    content = await verify(id, content, r, list, step);
    // проверка могла сменить страницу шага — снимаем недостающие
    const finalShots = await shots(id, content, r, step, 66, 70);
    await coverDone;
    const c = getCarousel(id)!;
    const rendered = c.slides.length === 9 && c.sid?.stage !== "render" && c.slides.every((s) => s.render?.file && fs.existsSync(slideFilePath(id, s.render.file)));
    let notes: string[] = [];
    if (!rendered) {
      const out = await render(id, content, step);
      content = out.content;
      notes = out.notes;
    }
    addTopic({ key: content.topicKey, title: content.topic, at: new Date().toISOString(), carouselId: id });
    saveSid(id, { stage: "done" });
    const cards = finalShots.filter((s) => s.kind === "card").length;
    const verified = getCarousel(id)?.sid?.verifyNotes ?? [];
    return [
      "Карусель готова",
      cards ? `окон-карточек вместо снимка страницы: ${cards}` : "",
      verified.length ? `проверка фактов поправила: ${verified.length}` : "",
      ...notes,
    ].filter(Boolean).join(". ");
  } finally {
    await release();
    void job;
  }
}
