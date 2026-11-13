// «Создать»: история → ролики героя → разбор → текст и раскладка → голоса → монтаж. Каждый шаг кладёт результат
// в папку задания, поэтому повтор после сбоя продолжает с того же места.
import fs from "node:fs";
import path from "node:path";
import type { NewsStory } from "../protocol";
import { analyzeClips } from "./analyze";
import { punchIns, tidyEdges } from "./cuts";
import { buildPlan, preparePublic, render, rerender } from "./montage";
import { makeInserts, warmStickers } from "./inserts";
import { makeOverlays } from "./overlays";
import { writePlan } from "./plan";
import { pastOf, type Prep } from "./prep";
import { listTracks } from "./sounds";
import type { Stock } from "./stock";
import { findStory, isCrypto } from "./story";
import { trialFor } from "./trial";
import { MEDIA_ROOT, readJson, writeJson, type Hooks } from "./util";
import { voice } from "./voice";

/** music — трек, с которым ролик появится на сайте (под настроение истории); сам ролик всегда без музыки. */
export type Made = { file: string; duration: number; music: string | null };

/**
 * Трек под настроение истории (владелец 29.10: «подбирать по настроению было бы круто»): news/music/moods.json даёт
 * настроение каждому треку; из подходящих — тот, что дольше не звучал в роликах канала. Трек без записи подходит к любому.
 */
async function pickTrack(mood: string | undefined, recent: string[]): Promise<string | null> {
  const tracks = (await listTracks()).map((t) => t.file);
  if (!tracks.length) return null;
  const file = path.join(MEDIA_ROOT, "music", "moods.json");
  const moods = fs.existsSync(file) ? readJson<{ tracks?: Record<string, string> }>(file).tracks ?? {} : {};
  const fits = tracks.filter((t) => !mood || !moods[t] || moods[t] === mood);
  const pool = fits.length ? fits : tracks;
  // давно не звучавший: позже всех в последних роликах (или вовсе не было)
  const last = (t: string) => recent.lastIndexOf(t);
  return [...pool].sort((a, b) => last(a) - last(b))[0];
}

/**
 * Готовый ролик, собранный вне конвейера (первый тест про Vaseline): в папке задания лежат ready.json { story },
 * plan.json и public/ движка. Его история уходит на сайт, ролик монтируется заново — дальше он такой же, как
 * сделанный кнопкой.
 */
export async function importReady(workDir: string, onStory: (story: NewsStory) => Promise<void>, hooks: Hooks): Promise<Made | null> {
  const readyFile = path.join(workDir, "ready.json");
  if (!fs.existsSync(readyFile)) return null;
  const { story } = readJson<{ story: NewsStory }>(readyFile);
  await onStory(story);
  const made = await rerender(workDir, hooks);
  return { ...made, music: (await listTracks())[0]?.file ?? null };
}

export async function createVideo(workDir: string, historyFile: string, stock: Stock, onStory: (story: NewsStory) => Promise<void>, hooks: Hooks, pick?: string, prep?: Prep): Promise<Made> {
  fs.mkdirSync(workDir, { recursive: true });
  // заготовка этой истории (prep.ts): ролики, разбор и сценарий уже сделаны в фоне — её папка переезжает в папку ролика,
  // и шаги ниже берут готовое (владелец 1.11: «больше 30 минут на 1 ролик неприемлемо»)
  // только для нового ролика: у «Создать заново» в папке уже есть его история (candidates.json), и чужая заготовка
  // затёрла бы её (1.11: повтор «Жениха» без pick взял заготовку истории про Кардашьян)
  const fresh = !fs.existsSync(path.join(workDir, "story.json")) && !fs.existsSync(path.join(workDir, "candidates.json"));
  const prepped = prep && fresh ? await prep.claim(pick) : null;
  if (prepped) {
    if (pick) await stock.take(hooks, pick);
    for (const name of fs.readdirSync(prepped.dir)) fs.renameSync(path.join(prepped.dir, name), path.join(workDir, name));
    fs.rmSync(prepped.dir, { recursive: true, force: true });
    hooks.log(`берём заготовку истории ${prepped.id}${fs.existsSync(path.join(workDir, "draft.json")) ? " со сценарием" : " (сценарий допишем)"}`);
  }
  const found = await findStory(workDir, stock, hooks, pick);
  const { candidate: c } = found;
  // из запаса уходит и история из заготовки (её findStory не берёт из запаса)
  stock.used(c);
  const platform = c.hero.platform === "tiktok" ? "TikTok" : c.hero.platform === "instagram" ? "Instagram" : "YouTube";
  // крипто-ролик выходит одним из вариантов опыта на YouTube (trial.ts): с телеграмом или без, со спокойным названием
  const trial = isCrypto(c.lane) ? trialFor(path.dirname(historyFile), workDir, c.title) : undefined;
  // сайт принимает историю целиком или не принимает: заголовок до 120 знаков, до 12 источников, текст обязателен
  // telegram — последняя фраза автора о его канале: она же становится строкой подписи (lib/news/rules.ts withTelegram)
  const story = (title: string, script: string, telegram?: string): NewsStory => ({
    title: title.slice(0, 120),
    summary: c.summary.slice(0, 1200),
    hero: `@${c.hero.handle} (${platform})`.slice(0, 120),
    sources: [...found.clips.map((k) => ({ url: k.url, note: k.shows })), ...c.facts.map((f) => ({ url: f.source, note: f.text }))]
      .filter((s) => /^https?:\/\//.test(s.url) && s.url.length <= 2000)
      .slice(0, 12)
      .map((s) => ({ url: s.url, note: (s.note ?? "").slice(0, 300) })),
    script: script.slice(0, 8000),
    // крипто-ролик: подпись на сайте получит строку про телеграм владельца (lib/news/rules.ts withTelegram)
    ...(isCrypto(c.lane) ? { lane: c.lane } : {}),
    ...(trial ? { trial } : {}),
    ...(telegram ? { telegram: telegram.slice(0, 300) } : {}),
  });
  // история видна на странице сразу (вместо текста пока пересказ), текст — когда написан
  await onStory(story(c.title, c.summary));
  const clips = await analyzeClips(workDir, found.clips, hooks);
  // первые фразы последних роликов: новое начало на них не похоже
  // и мемы последних роликов: зритель их уже видел (владелец 29.10: «я уже их видел, те мемы, нужно разнообразить»)
  const past = pastOf(historyFile);
  const draft = await writePlan(workDir, c, clips, hooks, past.hooks, past.memes, { trial });
  // сценарий из заготовки писался раньше: картинки-мемы, которые с тех пор уже были в роликах канала, не ставим
  if (draft.memes?.some((m) => past.memes.includes(m.meme))) draft.memes = draft.memes.filter((m) => !past.memes.includes(m.meme));
  // вещи-наклейки рисуются, пока озвучивается текст (в заготовке они уже нарисованы)
  const warm = warmStickers(workDir, draft, hooks).catch(() => {});
  const voices = await voice(workDir, draft, c.hero.gender === "male" ? "male" : "female", hooks, clips);
  const text = new Map([...draft.narration, ...draft.heroLines].map((l) => [l.id, l.text]));
  const script = draft.segments.flatMap((s) => (s.type === "narr" ? [text.get(s.line)] : s.type === "dub" ? s.lines.map((l) => text.get(l.line)) : [])).filter(Boolean).join(" ");
  // фраза автора о телеграм-канале, если ролик ею кончается: сайт ставит её же в подпись вместо общей строки
  const lastSeg = draft.segments[draft.segments.length - 1];
  const lastText = lastSeg?.type === "narr" ? text.get(lastSeg.line) ?? "" : "";
  await onStory(story(draft.title || c.title, script, /телеграм/i.test(lastText) ? lastText : undefined));
  const pub = await preparePublic(workDir, clips);
  const plan = await buildPlan(pub, draft, voices, clips);
  // стыки без вспышек чужих кадров, длинные планы — наездом на говорящего (владелец 30.10, Копатыч и Болото)
  await tidyEdges(pub, plan, clips, hooks);
  await punchIns(pub, plan, clips, hooks);
  // владелец в кадре убран совсем (владелец 30.10: «моё всплытие нужно убрать вообще»); peek.ts остаётся, но не зовётся
  await warm;
  await makeInserts(workDir, pub, plan, draft, hooks);
  // обводки, переписка, число, карта (каталог видео-скиллов, 31.10) — после вставок, чтобы не лечь на них
  await makeOverlays(workDir, pub, plan, draft, hooks);
  const made = await render(workDir, plan, hooks);
  const music = await pickTrack(draft.mood, past.music);
  // история больше не предлагается; направление — для очереди крипты (stock.ts cryptoDue)
  const history = fs.existsSync(historyFile) ? readJson<{ title: string; hero: string; at: string }[]>(historyFile) : [];
  const hook = draft.narration.find((l) => l.id === (draft.segments.find((x) => x.type === "narr") as { line?: string } | undefined)?.line)?.text ?? "";
  writeJson(historyFile, [...history, { title: c.title, hero: c.hero.handle, at: new Date().toISOString(), hook, memes: [...(draft.memes ?? []).map((m) => m.meme), ...draft.segments.flatMap((s) => (s.type === "vmeme" ? [s.meme] : []))], ...(music ? { music } : {}), ...(c.lane ? { lane: c.lane } : {}), ...(trial ? { trial } : {}) }]);
  return { ...made, music };
}
