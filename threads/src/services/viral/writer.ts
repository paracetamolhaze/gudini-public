import { llm } from "../../llm/index.js";
import { loadSettings, type Settings } from "../../config/settings.js";
import { withTransaction } from "../../db/pool.js";
import { insertDraft, recentPublishedTexts, updateDraft } from "../../db/repos/drafts.js";
import { recentlyUsedAuthors, skipViralPost, useViralPost, viralCandidates, viralDayStats, viewsByHour, type ViralPostRow } from "../../db/repos/viral.js";
import { textSimilarity } from "../dedup/similarity.js";
import { linkProblems } from "../writer/validate.js";
import { xVariantProblems } from "../writer/xVariant.js";
import { prepareThreadsPost } from "../../shared/threadsTopic.js";
import { audit } from "../audit.js";
import { VIRAL_TYPE, detectLang, hourWeights, passesFloor, planViral, publishDelayMinutes, publishingWindow, strength, teenTopic, viralScore, type PlanStep, type ViralMetrics, type ViralUse } from "./plan.js";
import { VIRAL_PROMPT_VERSION, viralPostSchema, viralSystemPrompt } from "./prompts.js";

/** Столько сильнейших кандидатов видит модель за раз: выбор есть, а промпт не раздувается. */
const POOL = 12;
const PER_AUTHOR = 2;

const metricsOf = (r: ViralPostRow): ViralMetrics => ({ platform: r.platform, likes: r.likes, replies: r.replies, reposts: r.reposts, views: r.views, postedAt: r.posted_at });

/**
 * Сильнейшие свежие посты, не больше двух от одного автора и без авторов, которых мы брали за
 * последнюю неделю. strongOnly — для постов сверх минимума: туда идут только настоящие хиты.
 */
export function rankCandidates(rows: ViralPostRow[], opts: { strongOnly: boolean; settings: Pick<Settings, "viral">; usedAuthors: Set<string>; now: Date }): ViralPostRow[] {
  const t = opts.settings.viral.thresholds;
  const scored = rows
    .map((r) => ({ r, m: metricsOf(r) }))
    .filter(({ r, m }) => !teenTopic(r.text) && passesFloor(m, t) && (!opts.strongOnly || strength(m, t) >= 1) && !opts.usedAuthors.has(`${r.platform}:${r.username.toLowerCase()}`))
    .map(({ r, m }) => ({ r, score: viralScore(m, t, opts.now) }))
    .sort((a, b) => b.score - a.score);
  const perAuthor = new Map<string, number>();
  const out: ViralPostRow[] = [];
  for (const { r } of scored) {
    const key = `${r.platform}:${r.username.toLowerCase()}`;
    if ((perAuthor.get(key) ?? 0) >= PER_AUTHOR) continue;
    perAuthor.set(key, (perAuthor.get(key) ?? 0) + 1);
    out.push(r);
    if (out.length >= POOL) break;
  }
  return out;
}

/** Что мешает посту выйти без человека. Пустой список — пост готов. */
export function viralProblems(use: ViralUse, text: string, source: string, recent: string[], maxChars: number): string[] {
  const problems: string[] = [];
  if (text.length < 8) problems.push("пустой текст");
  if (text.length > maxChars * 2) problems.push(`длиннее ${maxChars * 2} символов`);
  if (detectLang(text) !== "ru") problems.push("текст не на русском");
  if (teenTopic(text)) problems.push("школьная или студенческая тема");
  if (use === "remake" && textSimilarity(text, source) >= 0.6) problems.push("почти дословно повторяет оригинал");
  if (recent.some((r) => textSimilarity(text, r) >= 0.5)) problems.push("повторяет недавний пост");
  if (/(^|\s)@[\w.]{2,}/u.test(text)) problems.push("упоминание чужого аккаунта");
  problems.push(...linkProblems(text, "none").map(() => "ссылка в тексте"));
  return problems;
}

/** Английская версия переделки для X: годится — уходит в X, нет — пост выходит только в Threads. */
export function viralXText(raw: string, mainText: string, x: Pick<Settings["platforms"]["x"], "maxChars">): { text: string | null; problem: string | null } {
  const t = raw.trim();
  if (!t) return { text: null, problem: "модель не написала версию для X" };
  const problems = xVariantProblems(t, mainText, { maxChars: x.maxChars, language: "en" });
  return problems.length ? { text: null, problem: problems.join("; ") } : { text: t, problem: null };
}

function label(r: ViralPostRow): string {
  return r.platform === "x" ? `${Math.round((r.views ?? 0) / 1000)} тыс. просмотров в X` : `${r.likes} лайков, ${r.replies} ответов в Threads`;
}

export type ViralWriteResult =
  | { kind: "written"; use: ViralUse; draftId: string; source: string }
  | { kind: "none"; use: ViralUse; reason: string };

export async function writeViral(step: PlanStep, settings: Settings, now = new Date()): Promise<ViralWriteResult> {
  const { use, strongOnly } = step;
  const maxChars = settings.platforms.threads.maxChars;
  // Переводу в X места нет: английский оригинал там уже есть, повтор был бы копией.
  const withX = use === "remake" && settings.viral.xRemakes && settings.platforms.x.enabled;
  const all = await viralCandidates(use === "translate" ? "en" : "ru", settings.viral.maxAgeHours);
  // Собранное до фильтра школьных тем уходит из пула навсегда, чтобы не всплывать снова.
  for (const r of all.filter((r) => teenTopic(r.text))) await skipViralPost(r.id, "школа или учёба — не тема взрослого автора");
  const rows = all.filter((r) => !teenTopic(r.text));
  const pool = rankCandidates(rows, { strongOnly, settings, usedAuthors: await recentlyUsedAuthors(), now });
  if (!pool.length) return { kind: "none", use, reason: strongOnly ? "нет сильных кандидатов сверх минимума" : "нет кандидатов выше порога" };

  const recent = (await recentPublishedTexts(12)).slice(0, 12);
  // Короткие id вместо uuid: модель не путает их и не тратит на них внимание.
  const byId = new Map<string, ViralPostRow>(pool.map((r, i) => [`c${i + 1}`, r]));
  const candidates = [...byId].map(([id, r]) => ({
    id, text: r.text, platform: r.platform, media: r.media,
    likes: r.likes, replies: r.replies, reposts: r.reposts, views: r.views,
    ageHours: r.posted_at ? Math.round((now.getTime() - r.posted_at.getTime()) / 3_600_000) : null,
  }));
  const { data, response } = await llm().structured({
    task: "writer",
    operation: `viral:${use}`,
    schemaName: "ViralPost",
    schema: viralPostSchema(maxChars, settings.platforms.x.maxChars),
    system: viralSystemPrompt(use, settings, { withX }),
    messages: [{ role: "user", content: JSON.stringify({ candidates, recentPosts: recent.map((t) => t.slice(0, 280)) }) }],
    temperature: 0.8,
    maxTokens: 2000,
    repairRetry: true,
  });

  for (const s of data.skip) {
    const r = byId.get(s.id);
    if (r && s.id !== data.sourceId) await skipViralPost(r.id, s.reason);
  }
  const source = byId.get(data.sourceId);
  if (!source || !data.text.trim()) return { kind: "none", use, reason: `модель не выбрала ни одного из ${pool.length}` };

  const text = prepareThreadsPost(data.text).text;
  const problems = viralProblems(use, text, source.text, recent, maxChars);
  if (problems.length) {
    await skipViralPost(source.id, `пост не прошёл проверку: ${problems.join("; ")}`);
    await audit("POST_VALIDATION_FAILED", `Пост по залетевшему @${source.username} не вышел: ${problems.join("; ")}`, {}, { permalink: source.permalink, text });
    return { kind: "none", use, reason: problems.join("; ") };
  }
  const x = withX ? viralXText(data.textX, text, settings.platforms.x) : { text: null, problem: null };
  const draft = await insertDraft({
    candidateId: null,
    kind: "VIRAL",
    type: VIRAL_TYPE[use],
    // Хештегов в Threads нет совсем (владелец 25.10); случайная решётка снимается при публикации.
    text,
    textX: x.text,
    platforms: x.text ? ["threads", "x"] : ["threads"],
    hook: null,
    body: null,
    sourceSummary: source.text.slice(0, 2000),
    sourceUrls: [source.permalink],
    // Уверенность здесь не угадывается моделью: за пост ручается выдача, где оригинал уже залетел.
    confidence: 90,
    riskScore: data.risk,
    status: "DRAFT",
    reviewReason: null,
    priority: "P2",
    promptVersion: VIRAL_PROMPT_VERSION[use],
    model: response.model,
    validation: { viral: { use, why: data.why, xProblem: x.problem, source: { platform: source.platform, username: source.username, permalink: source.permalink, likes: source.likes, replies: source.replies, reposts: source.reposts, views: source.views, postedAt: source.posted_at } } },
    variants: null,
    expiresAt: new Date(now.getTime() + settings.viral.expiryHours * 3_600_000),
  });
  // Пост выходит не ровно на тике, а через случайные 1–18 минут: минуты публикаций не повторяются.
  await updateDraft(draft.id, { scheduled_at: new Date(now.getTime() + publishDelayMinutes(draft.id) * 60_000) });
  await useViralPost(source.id, draft.id, data.why);
  await audit("POST_GENERATED", `${use === "translate" ? "Перевод" : "Переделка"} залетевшего поста @${source.username} (${label(source)})${x.problem ? `, в X не пойдёт: ${x.problem}` : x.text ? ", с английской версией для X" : ""}: ${text.slice(0, 120)}`, { draftId: draft.id }, { permalink: source.permalink, why: data.why });
  return { kind: "written", use, draftId: draft.id, source: source.permalink };
}

/**
 * viral:write — каждые десять минут решает, пора ли писать следующий пост, и какой. Пишет не
 * больше одного: равномерный выпуск по окну публикаций важнее пачки с утра.
 */
export async function viralTick(now = new Date()): Promise<Record<string, unknown>> {
  const settings = await loadSettings(true);
  if (!settings.viral.enabled) return { skipped: "поток залетевших постов выключен" };
  if (settings.killSwitch || settings.mode !== "AUTO" || !settings.flags.autoPost) return { skipped: "автопубликация выключена" };
  // Два тика подряд не должны написать два поста: блокировка держится, пока пишется этот.
  return withTransaction(async (client) => {
    const lock = await client.query<{ ok: boolean }>("SELECT pg_try_advisory_xact_lock(hashtext('viral-write')) AS ok");
    if (!lock.rows[0]?.ok) return { skipped: "уже пишется" };
    const win = publishingWindow(now, settings.schedule.preferredHours, settings.schedule.timezone);
    const stats = await viralDayStats(win.dayStart);
    const plan = planViral({
      now,
      timezone: settings.schedule.timezone,
      preferredHours: settings.schedule.preferredHours,
      minimumMinutesBetweenPosts: settings.schedule.minimumMinutesBetweenPosts,
      quotas: { translate: settings.viral.translate, remake: settings.viral.remake },
      done: stats.done,
      pending: stats.pending,
      lastCreatedAt: stats.lastCreatedAt,
      hourWeights: hourWeights(await viewsByHour(settings.schedule.timezone)),
    });
    if (plan.kind === "wait") return { waiting: plan.reason, done: stats.done };
    const tried: ViralWriteResult[] = [];
    for (const step of plan.steps) {
      const result = await writeViral(step, settings, now);
      tried.push(result);
      if (result.kind === "written") break;
    }
    return { done: stats.done, tried };
  });
}
