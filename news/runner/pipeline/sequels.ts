// Продолжения историй (владелец 29.10: «да, отлично»): герои прошлых роликов выкладывают, что было дальше. Пока ПК
// свободен, раз в 6 часов исполнитель смотрит их страницы — сначала тех, чьи ролики зашли лучше (insights.ts); новый
// ролик после нашего — Claude решает, продолжение ли это; да — история уходит в запас с пометкой sequelOf, и режиссёр
// начинает её с нового поворота, напоминая прошлое одной фразой следом (plan.ts).
import fs from "node:fs";
import path from "node:path";
import { channelResults } from "./insights";
import { claudeJson } from "./llm";
import type { Stock } from "./stock";
import { listProfile, type Candidate, type FoundStory } from "./story";
import { readJson, writeJson } from "./util";

const EVERY_MS = 6 * 3600_000;
/** Героев за один обход: страница читается около минуты, ПК не занят надолго. */
const PER_ROUND = 4;
/** Продолжение ищется у историй не старше двух месяцев. */
const MAX_AGE_MS = 60 * 24 * 3600_000;

type History = { title: string; hero: string; at: string; hook?: string }[];
type State = Record<string, { checkedAt: string; seen: string[] }>;
type Sequel = Omit<Candidate, "hero" | "sequelOf">;

const SEQUEL_SYSTEM = `Ты редактор канала коротких роликов. Перед тобой история, которая уже была на канале, и новые ролики её героя, вышедшие после неё (id, дата, просмотры, длительность, подпись). Есть ли среди них продолжение этой истории — что случилось дальше (ответ бренда, новый поворот, итог, реакция людей)? Обычные ролики героя на другие темы продолжением не считаются.
Ответ — только JSON. Продолжения нет: {"sequel":null}. Есть: {"sequel":{"title":"короткий заголовок по-русски","summary":"2–3 предложения: что было и что случилось дальше","why":"чем цепляет","facts":[{"text":"факт по-русски","source":"ссылка на ролик героя"}],"videos":[{"url":"ссылка на ролик","shows":"что в нём"}],"searchTerms":["слова из подписей"]}} — в videos ролики продолжения и один прошлый ролик для напоминания.`;

/** Истории канала с их папками: герой, когда вышел наш ролик, его зачин и что было найдено. */
function pastStories(work: string, historyFile: string) {
  const history = fs.existsSync(historyFile) ? readJson<History>(historyFile) : [];
  const stories = new Map<string, FoundStory>();
  for (const dir of fs.readdirSync(work, { withFileTypes: true })) {
    const file = path.join(work, dir.name, "story.json");
    if (!dir.isDirectory() || !fs.existsSync(file)) continue;
    try {
      const s = readJson<FoundStory>(file);
      if (s.candidate?.hero?.handle) stories.set(s.candidate.hero.handle.toLowerCase(), s);
    } catch {
      /* битая папка — без неё */
    }
  }
  const latest = new Map<string, History[number]>();
  for (const h of history) if (Date.now() - Date.parse(h.at) < MAX_AGE_MS) latest.set(h.hero.toLowerCase(), h);
  return [...latest.values()].flatMap((h) => {
    const story = stories.get(h.hero.toLowerCase());
    return story ? [{ ...h, story }] : [];
  });
}

export function createSequels(work: string, historyFile: string, stock: Stock, log: (line: string) => void) {
  const stateFile = path.join(work, "sequels.json");
  let running = false;
  let lastRound = 0;

  async function round() {
    const state: State = fs.existsSync(stateFile) ? readJson<State>(stateFile) : {};
    const results = await channelResults();
    const views = (handle: string) => results.find((r) => r.hero?.toLowerCase().includes(`@${handle.toLowerCase()}`))?.views;
    // сначала герои, чьи ролики зашли, потом те, кого дольше не смотрели
    const past = pastStories(work, historyFile)
      .sort((a, b) => (views(b.hero) ?? 0) - (views(a.hero) ?? 0) || (state[a.hero]?.checkedAt ?? "").localeCompare(state[b.hero]?.checkedAt ?? ""))
      .slice(0, PER_ROUND);
    for (const p of past) {
      const seen = new Set(state[p.hero]?.seen ?? []);
      const ourDate = p.at.slice(0, 10);
      const used = new Set(p.story.clips.map((c) => c.url));
      const listed = await listProfile(p.story.candidate).catch(() => []);
      const fresh = listed.filter((v) => v.date && v.date >= ourDate && !seen.has(v.id) && !used.has(v.url));
      state[p.hero] = { checkedAt: new Date().toISOString(), seen: [...seen, ...fresh.map((v) => v.id)].slice(-200) };
      writeJson(stateFile, state);
      if (!fresh.length) continue;
      const list = fresh.map((v) => `${v.id} | ${v.date} | ${v.views ?? "?"} просмотров | ${v.duration ?? "?"} с | ${v.url} | ${v.title}`).join("\n");
      const old = p.story.clips.map((c) => `${c.url} — ${c.shows}`).join("\n");
      const user = `История на канале: ${p.story.candidate.title}\n${p.story.candidate.summary}\nЗачин ролика: «${p.hook ?? ""}»\nПрошлые ролики героя в нашем ролике:\n${old}\n\nНовые ролики героя:\n${list}`;
      const res = await claudeJson<{ sequel: Sequel | null }>(SEQUEL_SYSTEM, user, { task: "news-sequel", effort: "medium" }).catch(() => ({ sequel: null }));
      if (!res.sequel?.title || !res.sequel.videos?.length) continue;
      const c: Candidate = { ...res.sequel, hero: p.story.candidate.hero, sequelOf: { title: p.story.candidate.title, hook: p.hook ?? "", ...(views(p.hero) ? { views: views(p.hero) } : {}) } };
      stock.offer(c);
      log(`продолжение в запасе: ${c.title} (@${c.hero.handle})`);
    }
  }

  return {
    /** Пока ПК свободен: не чаще раза в EVERY_MS, в фоне. */
    maybeCheck() {
      if (running || Date.now() - lastRound < EVERY_MS) return;
      lastRound = Date.now();
      running = true;
      round()
        .catch((error) => log(`поиск продолжений не удался: ${(error as Error).message}`))
        .finally(() => {
          running = false;
        });
    },
  };
}
