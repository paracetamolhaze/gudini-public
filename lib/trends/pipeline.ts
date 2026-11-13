import fs from "node:fs";
import path from "node:path";
import type { Page } from "playwright";
import { claudeBridgeComplete } from "../claudeBridgeClient";
import { mediaVision, parseJson } from "../mediaLlm";
import { classifyHook } from "./hooks";
import { humanPause, LoginRequired, readProfile, readReel } from "./instagram";
import { downloadVideo, extractFrames, fetchVideo, probeDuration, readCuts, readShorts, shortsWords, speech, transcribeVideo } from "./media";
import { ANALYSIS_SYSTEM, analysisUser, ideaIssues, ideaUser, normalizeAnalysis, normalizeSketch, normalizeVideo, SCREEN_SYSTEM, SKETCH_SYSTEM, VIDEO_SYSTEM } from "./prompts";
import { accountMedian, MAX_CARDS_PER_RUN, pickOutliers, type Outlier } from "./rank";
import { rhythmOf, type CutScan } from "./rhythm";
import { cardDir } from "./state";
import { ideaKindOf, type AccountRead, type Idea, type Source, type TrendAccount, type TrendCard, type TrendRun, type TrendsState } from "./types";

/**
 * Прогон «Трендов» по кнопке: прочитать ленты аккаунтов, найти ролики в 3 и больше раз выше медианы
 * своего аккаунта, разобрать каждый и написать наш вариант. Работает в контейнере gudini-ig-browser.
 */

export type PipelineDeps = {
  state: TrendsState;
  persist: () => void;
  /** страница вошедшего браузера Instagram; null — входа нет, читаем только Shorts */
  page: () => Promise<Page | null>;
  /** вход пропал посреди прогона */
  lostLogin: () => void;
  /** куки браузера для yt-dlp */
  cookies: () => Promise<string | undefined>;
  stopped: () => boolean;
};

const MAX_CARDS = 600;
const MAX_RUNS = 20;
/** Перерыв на минуту-полторы после каждых 20 профилей Instagram. */
const BREAK_EVERY = 20;
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

class Stopped extends Error {}

export async function runTrends(run: TrendRun, accounts: TrendAccount[], deps: PipelineDeps): Promise<void> {
  const { state, persist } = deps;
  const step = (text: string, progress: number) => {
    if (deps.stopped()) throw new Stopped();
    run.step = text;
    run.progress = Math.round(progress);
    persist();
  };
  try {
    let page: Page | null = await deps.page();
    let profiles = 0;
    for (const [i, account] of accounts.entries()) {
      const sources: [Source, string][] = [];
      if (account.instagram) sources.push(["instagram", account.instagram]);
      if (account.youtube) sources.push(["youtube", account.youtube]);
      for (const [source, handle] of sources) {
        const progress = (i / accounts.length) * 40;
        step(`Читаем @${handle} в ${source === "instagram" ? "Instagram" : "YouTube"} (${i + 1} из ${accounts.length})`, progress);
        const read: AccountRead = { accountId: account.id, source, handle, followers: null, median: null, reels: [], at: new Date().toISOString() };
        try {
          if (source === "instagram") {
            if (!page) throw new LoginRequired("Нужен вход в браузер Instagram — прочитаны только Shorts.");
            // человек не листает сотню профилей подряд: каждые 20 — перерыв на минуту-полторы
            if (profiles > 0 && profiles % BREAK_EVERY === 0) {
              step(`Перерыв после ${profiles} профилей, как у человека`, progress);
              await page.waitForTimeout(45_000 + Math.random() * 45_000);
              step(`Читаем @${handle} в Instagram (${i + 1} из ${accounts.length})`, progress);
            } else if (profiles > 0) await humanPause(page);
            profiles++;
            Object.assign(read, await readProfile(page, handle));
          } else Object.assign(read, await readShorts(handle));
          read.median = accountMedian(read.reels);
          if (!read.median) read.error = `Мало роликов для медианы: ${read.reels.filter((r) => !r.pinned && r.views > 0).length}`;
        } catch (e) {
          if (e instanceof LoginRequired && page) {
            deps.lostLogin();
            page = null;
          }
          read.error = message(e);
        }
        run.reads.push(read);
        persist();
      }
    }

    // сильнейшие разбираются сразу, остальные ждут кнопки «Разобрать»: разбор — несколько минут Claude на ролик
    const outliers = pickOutliers(run.reads);
    for (const [i, o] of outliers.entries()) run.cards.push(upsertCard(state, run, o, i < MAX_CARDS_PER_RUN).key);
    persist();

    const todo = run.cards.map((key) => state.cards.find((c) => c.key === key)!).filter((c) => c.state === "queued");
    for (const [i, card] of todo.entries()) {
      step(`Разбираем ролик @${card.handle} ×${card.multiple.toFixed(1)} (${i + 1} из ${todo.length})`, 40 + (i / Math.max(1, todo.length)) * 60);
      page = await analyzeCard(card, page, deps);
    }
    const waiting = run.cards.filter((key) => state.cards.find((c) => c.key === key)?.state === "found").length;
    run.state = "done";
    run.step = !outliers.length
      ? "Готово: выбросов нет — у всех аккаунтов обычные дни."
      : `Готово: ${outliers.length} ${plural(outliers.length, "ролик", "ролика", "роликов")} выше медианы в 3 и больше раз` +
        (waiting ? `, ${waiting} ждут кнопки «Разобрать».` : ".");
    run.progress = 100;
  } catch (e) {
    if (e instanceof Stopped) {
      run.state = "stopped";
      run.step = "Остановлено владельцем.";
    } else {
      run.state = "error";
      run.error = message(e);
      run.step = "Прогон прервался.";
    }
    for (const card of state.cards) if (card.runId === run.id && (card.state === "working" || card.state === "queued")) {
      card.state = "error";
      card.error = run.state === "stopped" ? "Разбор остановлен." : "Прогон прервался до разбора.";
    }
  } finally {
    run.finishedAt = new Date().toISOString();
    prune(state);
    persist();
  }
}

function upsertCard(state: TrendsState, run: TrendRun, o: Outlier, analyze: boolean): TrendCard {
  const existing = state.cards.find((c) => c.key === o.reel.key);
  const numbers = { views: o.reel.views, median: o.read.median!, multiple: Math.round(o.multiple * 10) / 10, followers: o.read.followers };
  if (existing) {
    // разобранный ролик не разбираем снова: обновляем цифры и привязываем к свежему прогону
    Object.assign(existing, numbers, { runId: run.id });
    if (existing.state === "error" || existing.state === "found") Object.assign(existing, { state: analyze ? "queued" : "found", error: undefined });
    return existing;
  }
  const card: TrendCard = {
    key: o.reel.key, runId: run.id, theme: run.theme, source: o.read.source, handle: o.read.handle, url: o.reel.url, ...numbers,
    ...(o.reel.caption ? { caption: o.reel.caption } : {}),
    ...(o.reel.duration ? { duration: o.reel.duration } : {}),
    ...(o.reel.postedAt ? { postedAt: o.reel.postedAt } : {}),
    frames: [], state: analyze ? "queued" : "found", at: new Date().toISOString(),
  };
  state.cards.unshift(card);
  return card;
}

/** Кнопка «Разобрать»: один найденный выброс разбирается так же, как в прогоне. */
export async function analyzeOne(card: TrendCard, deps: PipelineDeps): Promise<void> {
  try {
    await analyzeCard(card, card.source === "instagram" ? await deps.page() : null, deps);
  } catch (e) {
    card.state = "error";
    card.error = e instanceof Stopped ? "Разбор остановлен." : message(e);
    card.step = undefined;
    deps.persist();
  }
}

/** Один выброс: видео → кадры и речь → разбор формулы → наш вариант. Ошибка карточки не роняет прогон. */
async function analyzeCard(card: TrendCard, page: Page | null, deps: PipelineDeps): Promise<Page | null> {
  const dir = cardDir(card.key);
  fs.mkdirSync(dir, { recursive: true });
  const say = (text: string) => {
    if (deps.stopped()) throw new Stopped();
    card.step = text;
    deps.persist();
  };
  card.state = "working";
  card.error = undefined;
  try {
    // кадры и речь уже есть с прошлого разбора — переразбираем без нового захода на страницу и скачивания
    if (!(card.frames.length > 0 && card.spokenHook !== undefined)) page = await gatherMedia(card, page, deps, dir, say);
    say("Claude называет формулу");
    const hint = classifyHook(card.spokenHook || card.caption?.split("\n")[0] || "");
    const raw = await claude("trend-analysis", ANALYSIS_SYSTEM(), analysisUser(card, hint ? `#${hint.id} ${hint.name}` : null));
    card.analysis = normalizeAnalysis(parseJson(raw, "Тренды: разбор"));
    say(ideaKindOf(card.theme, card.analysis.fit) === "sketch" ? "Claude пишет сюжет 3Д" : "Claude пишет сценарий");
    try {
      card.idea = await writeIdea(card);
      card.ideaError = undefined;
    } catch (e) {
      card.ideaError = message(e);
    }
    card.state = "ready";
  } catch (e) {
    if (e instanceof Stopped) throw e;
    card.state = "error";
    card.error = message(e);
  } finally {
    card.step = undefined;
    card.at = new Date().toISOString();
    deps.persist();
  }
  return page;
}

/** Видео выброса → кадры, речь и текст на кадрах; само видео после этого удаляется. */
async function gatherMedia(card: TrendCard, page: Page | null, deps: PipelineDeps, dir: string, say: (text: string) => void): Promise<Page | null> {
  let videoUrl: string | undefined;
  if (card.source === "instagram") {
    if (!page) throw new LoginRequired("Нужен вход в браузер Instagram, чтобы открыть рилс.");
    say("Открываем рилс");
    await humanPause(page);
    try {
      const reel = await readReel(page, card.url);
      card.caption ??= reel.caption;
      card.duration ??= reel.duration;
      card.postedAt ??= reel.postedAt;
      videoUrl = reel.videoUrl;
    } catch (e) {
      if (e instanceof LoginRequired) {
        deps.lostLogin();
        page = null;
      }
      throw e;
    }
  }
  say("Скачиваем видео");
  const words = card.source === "youtube" ? await shortsWords(card.url, dir) : [];
  // рилс — по ссылке, которую отдала страница; не вышло — yt-dlp с куки браузера
  const video = videoUrl
    ? await fetchVideo(videoUrl, dir).catch(async () => downloadVideo(card.url, dir, await deps.cookies()))
    : await downloadVideo(card.url, dir, card.source === "instagram" ? await deps.cookies() : undefined);
  let duration = card.duration ?? 30;
  // ритм — подсказка к варианту: без него (ffmpeg не справился) разбор идёт как раньше
  let cuts: CutScan | null = null;
  try {
    duration = (await probeDuration(video)) ?? duration;
    card.duration = Math.round(duration * 10) / 10;
    say("Кадры для текста на экране");
    card.frames = await extractFrames(video, dir, duration);
    say("Считаем склейки");
    cuts = await readCuts(video).catch(() => null);
    if (!words.length) {
      say("Расшифровываем речь");
      words.push(...(await transcribeVideo(video, dir).catch(() => [])));
    }
  } finally {
    fs.rmSync(video, { force: true });
  }
  Object.assign(card, speech(words));
  card.rhythm = cuts ? rhythmOf(cuts, duration, words) : undefined;
  if (card.frames.length) {
    say("Читаем текст на кадрах");
    card.screenText = await readScreens(dir, card.frames).catch(() => undefined);
  }
  return page;
}

async function readScreens(dir: string, frames: string[]): Promise<string[]> {
  const images = frames.map((f) => ({ base64: fs.readFileSync(path.join(dir, f)).toString("base64"), mediaType: "image/jpeg" }));
  const raw = await mediaVision({ system: SCREEN_SYSTEM, user: `Кадров: ${frames.length}.`, images, maxTokens: 1500, stage: "Vision Verification", imageTokensEach: 600 });
  const parsed = parseJson<{ frames?: unknown[] }>(raw, "Тренды: кадры");
  return (Array.isArray(parsed.frames) ? parsed.frames : []).slice(0, frames.length).map((t) => (typeof t === "string" ? t.trim().slice(0, 400) : ""));
}

function claude(task: string, system: string, user: string, tools?: "web"): Promise<string> {
  const model = process.env.CLAUDE_SCRIPT_MODEL || "claude-opus-5";
  return claudeBridgeComplete({ stage: "Script Generation", model, system, user, task, ...(tools ? { tools } : {}) }, { timeoutMs: tools ? 600_000 : 420_000 });
}

const today = () => new Date().toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Qyzylorda" });

/** Наш вариант по формуле: скетч → сюжет 3Д, ИИ и технологии → ролик. Расхождение с образцом — один проход правки. */
export async function writeIdea(card: TrendCard, previous?: Idea): Promise<Idea> {
  if (!card.analysis) throw new Error("Сначала нужен разбор ролика");
  const sketch = ideaKindOf(card.theme, card.analysis.fit) === "sketch";
  const system = sketch ? SKETCH_SYSTEM : VIDEO_SYSTEM();
  const task = sketch ? "trend-sketch" : "trend-video";
  const tools = sketch ? undefined : ("web" as const);
  const normalize = (raw: string): Idea => {
    const json = parseJson(raw, "Тренды: идея");
    return sketch ? normalizeSketch(json) : normalizeVideo(json);
  };
  let user = ideaUser(card, today(), sketch ? "sketch" : "video");
  if (previous) user += `\n\nПрошлый вариант владелец не взял — дай другой ход на ту же формулу:\n${JSON.stringify(previous)}`;
  const first = normalize(await claude(task, system, user, tools));
  const issues = ideaIssues(first);
  if (!issues.length) return first;
  try {
    const second = normalize(await claude(task, system, `${user}\n\nТвой вариант:\n${JSON.stringify(first)}\n\nДоведи его до образца:\n${issues.map((i) => `- ${i}`).join("\n")}`, tools));
    return ideaIssues(second).length <= issues.length ? second : first;
  } catch {
    return first;
  }
}

/** Старые прогоны и карточки уходят, когда их больше предела, вместе с кадрами на диске. */
function prune(state: TrendsState) {
  state.runs = state.runs.slice(-MAX_RUNS);
  if (state.cards.length <= MAX_CARDS) return;
  const keep = new Set(state.runs.flatMap((r) => r.cards));
  const sorted = [...state.cards].sort((a, b) => Number(keep.has(b.key)) - Number(keep.has(a.key)) || b.at.localeCompare(a.at));
  for (const card of sorted.slice(MAX_CARDS)) fs.rmSync(cardDir(card.key), { recursive: true, force: true });
  const left = new Set(sorted.slice(0, MAX_CARDS).map((c) => c.key));
  state.cards = state.cards.filter((c) => left.has(c.key));
}

function plural(n: number, one: string, few: string, many: string) {
  const m10 = n % 10, m100 = n % 100;
  return m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many;
}
