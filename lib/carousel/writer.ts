import { DECK_SCENARIO_REVIEW_RULES, DECK_SCENARIO_RULES, SCENARIO_RULES, SCENARIO_REVIEW_RULES, parseScenarioReview } from "./scenarioIntent";
import { deckContext, isDeck } from "./deck";
import { claudeBridgeComplete } from "../claudeBridgeClient";
import { assertProvider } from "../providerPolicy";
import { AUTHOR_EDIT_RULES, isPaintedStory, paintedStoryProblems } from "./storyDirection";
import { applyDirector, isMemeDesign, memeCategoryLine, memeDirectorUser, MEME_DIRECTOR_RULES, MEME_IDEAS_RULES, MEME_PICK_RULES, MEME_TRENDS_RULES, normalizeMemeCandidates, normalizeMemePicks, normalizeMemeTrends, type MemeJoke, type MemeTrends } from "./meme";
import { memeTaste } from "./memeTaste";
import { RESEARCH_RULES, parseResearch, researchContext, researchDate, type CarouselResearch } from "./research";
import type { Carousel } from "./types";
import { claudeWritesCarousels, textModel, textConfigProblems, writerConfigProblems, writerModel } from "./config";
import { codexComplete, codexEffort } from "../codexLlm";
import { chatText, OpenRouterError } from "./openrouter";
import { textEstimate } from "./models";
import { reserveSpend, settleSpend } from "./spend";
import { CarouselError, carouselDir, carouselsRoot, listCarousels, updateCarousel, writeFileAtomic } from "./store";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  editProblems,
  editSystem,
  extractJson,
  fitSlideCount,
  generationSystem,
  generationUser,
  memeIdeasUser,
  memePickUser,
  MEME_SINGLE_CANDIDATES,
  instructUser,
  normalizeDraft,
  normalizeRegenerated,
  regenerateSystem,
  regenerateUser,
  repairUser,
  type Draft,
  type Parsed,
  type MemeTaste,
} from "./prompt";

/**
 * Обычные карусели пишет Claude через мост сценариев (SCRIPT_LLM_TRANSPORT=claude), мемы — Codex.
 * Оба по подписке; платного запасного перехода нет.
 */
type Ctx = { carousel: Carousel; jobId: string; runLabel: string };

async function ask(ctx: Ctx, label: string, system: string, user: string, webSearch = false): Promise<string> {
  const claude = claudeWritesCarousels() && !isMemeDesign(ctx.carousel.design);
  const problems = claude ? writerConfigProblems() : textConfigProblems();
  if (problems.length) throw new CarouselError(problems.join(" "), 503, "config");
  const model = claude ? writerModel().id : textModel().id;
  const entry = reserveSpend({ carouselId: ctx.carousel.id, title: ctx.carousel.title,
    kind: "text", label, runLabel: ctx.runLabel, model, estimate: 0, jobId: ctx.jobId, billing: "subscription" });
  try {
    let r: { text: string; runId?: string };
    if (claude) {
      assertProvider("Carousel Text", "anthropic");
      r = { text: await claudeBridgeComplete({ stage: "Carousel Text", model, system, user, task: "carousel", tools: webSearch ? "web" : undefined }) };
    } else {
      r = await codexComplete({ system, user, stage: "Carousel Text", model, effort: codexEffort("Carousel Text"), webSearch: webSearch ? "live" : undefined });
    }
    // Keep the actual prompt and answer even if the subsequent validator rejects the draft.
    const traceDir = path.join(carouselDir(ctx.carousel.id), "writer-trace");
    fs.mkdirSync(traceDir, { recursive: true });
    writeFileAtomic(path.join(traceDir, `${Date.now()}-${randomUUID()}.json`), JSON.stringify({ jobId: ctx.jobId, label, model, system, user, response: r.text, runId: r.runId }, null, 2));
    settleSpend(entry.id, { status: "done", cost: 0, note: claude ? "Подписка Claude через мост сценариев" : "Подписка ChatGPT; расходует лимиты Codex" });
    return r.text;
  } catch (e) {
    settleSpend(entry.id, { status: "failed", cost: 0, note: String((e as Error).message).slice(0, 200) });
    throw e;
  }
}

/** Из двух разборов лучший: меньше непоправимого, затем меньше замечаний. */
const better = (a: Parsed, b: Parsed): Parsed =>
  b.fatal.length < a.fatal.length || (b.fatal.length === a.fatal.length && b.problems.length <= a.problems.length) ? b : a;

/** Замечания, которые стоит показать автору: длину окончательно проверяет рендер. */
const visibleNotes = (problems: string[]) => problems.filter((p) => !/символов при пределе/.test(p));

async function researchFor(ctx: Ctx, topic: string): Promise<CarouselResearch> {
  const now = new Date();
  const checkpointFile = path.join(carouselDir(ctx.carousel.id), "research-checkpoint.json");
  if (ctx.runLabel === "Карусель: генерация") {
    try {
      const saved = JSON.parse(fs.readFileSync(checkpointFile, "utf8"));
      const age = now.getTime() - Date.parse(saved.at);
      if (saved.topic === topic && age >= 0 && age < 30 * 60_000) {
        return parseResearch(saved.research, topic, new Date(saved.at));
      }
    } catch { /* Missing, stale or invalid research is collected again. */ }
  }
  const raw = await ask(ctx, "Исследование актуальных фактов", RESEARCH_RULES + "\n\n" + scenarioRules(ctx.carousel),
    `Сегодня ${researchDate(now)}, Asia/Qyzylorda. Точное время: ${now.toISOString()}. Тема: ${topic}`, true);
  const research = parseResearch(extractJson(raw), topic, now);
  writeFileAtomic(checkpointFile, JSON.stringify({ topic, at: now.toISOString(), research }, null, 2));
  updateCarousel(ctx.carousel.id, c => { c.research = research; });
  return research;
}

async function reviewScenario(ctx: Ctx, user: string, draft: unknown): Promise<string[]> {
  const rules = isDeck(ctx.carousel) ? DECK_SCENARIO_REVIEW_RULES : SCENARIO_REVIEW_RULES;
  const raw = await ask(ctx, "Проверка соответствия сценарию", rules, `${user}\n\nПроверяемый результат:\n${JSON.stringify(draft)}`);
  return parseScenarioReview(extractJson(raw));
}

/** Правила выбора содержания: у карусели по скиллу свои места для пунктов и нет иллюстраций. */
const scenarioRules = (c: Carousel) => (isDeck(c) ? DECK_SCENARIO_RULES : SCENARIO_RULES);
async function alignScenario(ctx: Ctx, user: string, system: string, parsed: Parsed, parse: (raw: string) => Parsed): Promise<Parsed> {
  const issues = await reviewScenario(ctx, user, parsed.draft);
  if (!issues.length) return parsed;
  // Semantic failures are not merely notes and cannot lose to a shorter invalid plan.
  const repaired = parse(await ask(ctx, "Исправление замысла сценария", system, `${user}\n\n${repairUser(parsed.draft, issues)}`));
  if (repaired.fatal.length) throw new Error(`Сценарий не готов к рисованию: ${repaired.fatal.join("; ")}`);
  const remaining = await reviewScenario(ctx, user, repaired.draft);
  if (remaining.length) throw new Error(`Сценарий не соответствует запросу. Рисование не начато: ${remaining.join("; ")}`);
  return repaired;
}

/** Шутки прошлых мем-подборок: новая подборка по той же кнопке берёт другие ситуации. */
export function usedMemeJokes(excludeId: string, list: Carousel[] = listCarousels()): string[] {
  return list
    .filter((x) => x.id !== excludeId && isMemeDesign(x.design))
    .slice(0, 12)
    .flatMap((x) => x.slides.map((s) => [s.title, s.body, ...(s.bullets ?? [])].filter(Boolean).join(" / ")))
    .filter(Boolean)
    .slice(0, 60);
}

/**
 * Мемы отбираются, а не пишутся с первой попытки: сначала вчетверо больше кандидатов от лица
 * зрителя, потом строгий редактор оставляет те, что перешлют друзьям. Без достаточного
 * числа одобренных мемов сценарий не передаётся художнику.
 */
async function chooseMemes(ctx: Ctx, req: Carousel["request"], usedJokes: string[], count?: number, extra: { taste?: MemeTaste; trends?: MemeTrends } = {}): Promise<MemeJoke[]> {
  const pool = normalizeMemeCandidates(extractJson(await ask(ctx, "Идеи мемов", MEME_IDEAS_RULES, memeIdeasUser(req, { usedJokes, count, ...extra }))));
  if (!pool.length) throw new Error("Отбор мемов: сценарист не предложил кандидатов");
  const chosen = normalizeMemePicks(extractJson(await ask(ctx, "Отбор мемов", MEME_PICK_RULES, memePickUser(req, pool, undefined, extra.taste))), pool, req.slideCount);
  if (chosen.length < req.slideCount) throw new Error(`Редактор одобрил ${chosen.length} из ${req.slideCount} нужных мемов. Нужны новые идеи; рисование не начато.`);
  return chosen;
}

const TRENDS_TTL_MS = 12 * 3600_000;

/**
 * Мемолог: поводы недели и форматы из живого интернета. Находки хранятся 12 часов на
 * категорию — следующие подборки дня не ищут заново. Сорвался поиск — мемы пишутся без поводов.
 */
async function memeTrends(ctx: Ctx, req: Carousel["request"], now = new Date()): Promise<MemeTrends | undefined> {
  const file = path.join(carouselsRoot(), "meme-trends.json");
  // v2: мемолог приносит залетевшие мемы; находки прежней версии (новости) не используются
  const key = `v2:${req.memeCategory ?? "topic"}`;
  let cache: Record<string, { at: string; trends: MemeTrends }> = {};
  try {
    cache = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch { /* кэша ещё нет */ }
  const hit = cache[key];
  if (hit && now.getTime() - Date.parse(hit.at) < TRENDS_TTL_MS) return hit.trends;
  try {
    const user = [`Сегодня ${researchDate(now)}, Asia/Qyzylorda.`, memeCategoryLine(req.memeCategory), `Тема подборки: «${req.idea}»`].join("\n");
    const trends = normalizeMemeTrends(extractJson(await ask(ctx, "Мемолог: залетевшие мемы", MEME_TRENDS_RULES, user, true)));
    if (!trends.memes.length) return undefined;
    cache[key] = { at: now.toISOString(), trends };
    writeFileAtomic(file, JSON.stringify(cache, null, 2));
    return trends;
  } catch (e) {
    if (e instanceof CarouselError) throw e;
    return undefined;
  }
}

/** Режиссёр перечитывает сцены до рисования; сорвался — остаётся постановка сценариста. */
async function directScenes<T extends Parameters<typeof applyDirector>[0][number]>(ctx: Ctx, slides: T[]): Promise<T[]> {
  try {
    return applyDirector(slides, extractJson(await ask(ctx, "Режиссёр: постановка сцен", MEME_DIRECTOR_RULES, memeDirectorUser(slides))));
  } catch (e) {
    if (e instanceof CarouselError) throw e;
    return slides;
  }
}

export async function writePlan(c: Carousel, jobId: string): Promise<{ draft: Draft; notes: string[]; research?: CarouselResearch }> {
  const ctx: Ctx = { carousel: c, jobId, runLabel: "Карусель: генерация" };
  const illustrated = c.mode === "illustrated";
  const meme = illustrated && isMemeDesign(c.design);
  const deck = isDeck(c) ? deckContext() : undefined;
  const req = c.request;
  // мемам нужны узнаваемые ситуации, а не свежие цифры: исследование и проверка экспертного сценария пропускаются
  const research = meme ? undefined : await researchFor(ctx, `${req.idea}\n${req.wishes || ""}`);
  const usedJokes = meme ? usedMemeJokes(c.id) : undefined;
  // мем-оркестр: мемолог приносит поводы недели, сценарист придумывает с запасом, редактор
  // отбирает по вкусу автора (его 👍/👎), режиссёр ниже проверяет постановку до рисования
  const trends = meme ? await memeTrends(ctx, req) : undefined;
  const chosenJokes = meme ? await chooseMemes(ctx, req, usedJokes ?? [], undefined, { taste: memeTaste(undefined, req.memeStyle ?? "classic"), trends }) : undefined;
  const user = generationUser(req, { illustrated, deck: Boolean(deck), illustrationStyle: c.design?.illustrationStyle, design: c.design, usedJokes, chosenJokes }) + (research ? "\n\n" + researchContext(research) : "");
  const system = generationSystem(illustrated, c.design, Boolean(deck)) + (meme ? "" : "\n\n" + scenarioRules(c));
  const parse = (raw: string) => {
    const parsed = normalizeDraft(extractJson(raw), { expectedCount: req.slideCount, illustrated, meme, deck });
    if (!meme && !deck) parsed.fatal.push(...paintedStoryProblems(parsed.draft, c.design));
    return parsed;
  };
  let parsed = parse(await ask(ctx, "План карусели", system, user));
  if (parsed.problems.length || parsed.fatal.length) {
    const raw = await ask(ctx, "Исправление плана", system, `${user}\n\n${repairUser(parsed.draft, [...parsed.fatal, ...parsed.problems])}`);
    try {
      parsed = better(parsed, parse(raw));
    } catch {}
  }
  if (parsed.fatal.length) throw new Error(`GPT вернул негодную карусель: ${parsed.fatal.join("; ")}`);
  if (isPaintedStory(c.design) && !meme && !deck) {
    const reviewed = await ask(ctx, "Редактура авторской подачи", system, `${user}\n\n${AUTHOR_EDIT_RULES}\n\n${JSON.stringify(parsed.draft)}`);
    try { parsed = better(parsed, parse(reviewed)); } catch {}
  }
  parsed = { ...parsed, draft: fitSlideCount(parsed.draft, req.slideCount, meme, deck) };
  if (!meme) parsed = await alignScenario(ctx, user, system, parsed, parse);
  if (meme) parsed = { ...parsed, draft: { ...parsed.draft, slides: await directScenes(ctx, parsed.draft.slides) } };
  return { draft: parsed.draft, notes: visibleNotes(parsed.problems), research };
}

export async function writeEdit(c: Carousel, instruction: string, jobId: string): Promise<{ draft: Draft; notes: string[]; research?: CarouselResearch }> {
  const ctx: Ctx = { carousel: c, jobId, runLabel: "Карусель: правка" };
  const illustrated = c.mode === "illustrated";
  const meme = illustrated && isMemeDesign(c.design);
  const deck = isDeck(c) ? deckContext() : undefined;
  const research = meme ? undefined : await researchFor(ctx, `${c.request.idea}\nПравка: ${instruction}`);
  const user = instructUser(c, instruction) + (research ? "\n\n" + researchContext(research) : "");
  const system = editSystem(illustrated, c.design, Boolean(deck)) + (meme ? "" : "\n\n" + scenarioRules(c));
  // замечания только к тому, что правка изменила: нетронутые карточки остаются как были
  const parse = (raw: string): Parsed => {
    const p = normalizeDraft(extractJson(raw), { existing: c.slides, illustrated, meme, deck });
    return { ...p, problems: editProblems(p, c) };
  };
  let parsed = parse(await ask(ctx, "Правка по поручению", system, user));
  if (parsed.problems.length || parsed.fatal.length) {
    const raw = await ask(ctx, "Исправление правки", system, `${user}\n\n${repairUser(parsed.draft, [...parsed.fatal, ...parsed.problems])}`);
    try {
      parsed = better(parsed, parse(raw));
    } catch {}
  }
  if (parsed.fatal.length) throw new Error(`GPT вернул негодную правку: ${parsed.fatal.join("; ")}`);
  if (!meme) parsed = await alignScenario(ctx, user, system, parsed, parse);
  return { draft: parsed.draft, notes: visibleNotes(parsed.problems), research };
}

export async function writeSlide(c: Carousel, index: number, hint: string, jobId: string) {
  const ctx: Ctx = { carousel: c, jobId, runLabel: "Карусель: слайд" };
  const illustrated = c.mode === "illustrated";
  const meme = illustrated && isMemeDesign(c.design);
  const deck = isDeck(c) ? deckContext() : undefined;
  const research = meme ? undefined : await researchFor(ctx, `${c.request.idea}\nСлайд: ${c.slides[index]?.title}\nПравка: ${hint}`);
  // новая шутка для мема выбирается так же, как для всей карусели: кандидаты и строгий редактор;
  // шутки этой карусели, включая отвергнутую, и прошлых подборок не повторяются
  let chosen: MemeJoke | undefined;
  if (meme) {
    const here = c.slides.map((s) => [s.title, s.body, ...(s.bullets ?? [])].filter(Boolean).join(" / "));
    const req = { ...c.request, slideCount: 1, wishes: hint ? `Пожелание автора к этому слайду: ${hint}` : "" };
    chosen = (await chooseMemes(ctx, req, [...here, ...usedMemeJokes(c.id)], MEME_SINGLE_CANDIDATES, { taste: memeTaste(undefined, req.memeStyle ?? "classic"), trends: await memeTrends(ctx, req) }))?.[0];
  }
  const user = regenerateUser(c, index, hint, new Date(), chosen, Boolean(deck)) + (research ? "\n\n" + researchContext(research) : "");
  const system = regenerateSystem(illustrated, c.design, Boolean(deck)) + (meme ? "" : "\n\n" + scenarioRules(c));
  let r = normalizeRegenerated(extractJson(await ask(ctx, `Текст слайда ${index + 1}`, system, user)), c, index, illustrated, meme, deck);
  if (r.problems.length || r.fatal.length) {
    const raw = await ask(ctx, `Исправление слайда ${index + 1}`, system, `${user}\n\n${repairUser({ slide: r.slide }, [...r.fatal, ...r.problems])}`);
    try {
      const again = normalizeRegenerated(extractJson(raw), c, index, illustrated, meme, deck);
      if (again.fatal.length < r.fatal.length || (again.fatal.length === r.fatal.length && again.problems.length <= r.problems.length)) r = again;
    } catch {}
  }
  if (r.fatal.length) throw new Error("GPT вернул карточку без заголовка");
  if (meme) return { ...r, slide: (await directScenes(ctx, [r.slide]))[0], research };
  const issues = await reviewScenario(ctx, user, { slideNumber: index + 1, slide: r.slide });
  if (issues.length) {
    r = normalizeRegenerated(extractJson(await ask(ctx, "Исправление замысла карточки", system, `${user}\n\n${repairUser({ slide: r.slide }, issues)}`)), c, index, illustrated, false, deck);
    if (r.fatal.length) throw new Error("Правка карточки не прошла проверку структуры.");
    const remaining = await reviewScenario(ctx, user, { slideNumber: index + 1, slide: r.slide });
    if (remaining.length) throw new Error(`Карточка не соответствует поручению: ${remaining.join("; ")}`);
  }
  return { ...r, research };
}

/** A resumed plan is also checked; old saved text must not bypass the new gate. */
export async function verifySavedScenario(c: Carousel, jobId: string): Promise<void> {
  if (isMemeDesign(c.design)) return;
  const issues = await reviewScenario({ carousel: c, jobId, runLabel: "Карусель: проверка сохранённого сценария" },
    `Запрос автора: ${c.request.idea}\nПожелания: ${c.request.wishes || ""}\nПроверяется сохранённый сценарий перед продолжением рисования.`,
    { title: c.title, story: c.story, caption: c.caption, hashtags: c.hashtags, research: c.research, slides: c.slides.map(s => ({ kind: s.kind, title: s.title, body: s.body, bullets: s.bullets, cta: s.cta, image: { brief: s.image?.brief } })) });
  if (issues.length) throw new Error(`Сохранённый сценарий нужно исправить до рисования: ${issues.join("; ")}`);
}
