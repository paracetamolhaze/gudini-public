// Заготовка роликов в фоне (владелец 1.11: «больше 30 минут на 1 ролик неприемлемо… можно и за 1 минуту»): пока ПК
// свободен, лучшие истории запаса проходят всё, что не тратит кредиты, — ролики героя качаются и разбираются, Claude
// выбирает зацепку и пишет сценарий с раскладкой, GPT рисует вставки. По «Монтировать» остаются голос (кредиты
// ElevenLabs — их на месяц ~15 роликов, заранее не тратим) и монтаж. Папка заготовки — work/prep/<номер истории>;
// по кнопке она переезжает в папку ролика, и конвейер берёт готовые шаги из неё.
import fs from "node:fs";
import path from "node:path";
import { analyzeClips } from "./analyze";
import { on } from "./features";
import { warmStickers } from "./inserts";
import { writePlan } from "./plan";
import type { Stock } from "./stock";
import { findStory, isCrypto } from "./story";
import { trialFor } from "./trial";
import { readJson, writeJson, type Hooks } from "./util";

/** Сколько лучших историй запаса держать заготовленными. */
const AHEAD = 2;
/** Не вышла заготовка (ролики не скачались) — следующая попытка не раньше чем через час. */
const RETRY_MS = 60 * 60_000;

export type Prep = ReturnType<typeof createPrep>;

/** Начала и мемы последних роликов канала: новый сценарий на них не похож (как в createVideo). */
export function pastOf(historyFile: string) {
  const past = fs.existsSync(historyFile) ? readJson<{ hook?: string; memes?: string[]; music?: string }[]>(historyFile) : [];
  return {
    hooks: past.flatMap((h) => (h.hook ? [h.hook] : [])).slice(-6),
    memes: [...new Set(past.slice(-8).flatMap((h) => h.memes ?? []))],
    music: past.flatMap((h) => (h.music ? [h.music] : [])),
  };
}

export function createPrep(work: string, historyFile: string, stock: Stock, log: (line: string) => void) {
  const root = path.join(work, "prep");
  const failed = new Map<string, number>();
  let running: { id: string; done: Promise<void>; abort: AbortController } | null = null;
  const dirOf = (id: string) => path.join(root, id);
  const ready = (id: string) => fs.existsSync(path.join(dirOf(id), "prep.json"));
  const started = (id: string) => fs.existsSync(path.join(dirOf(id), "story.json"));

  async function prepare(id: string, signal: AbortSignal) {
    const candidate = stock.get(id);
    if (!candidate) return;
    const dir = dirOf(id);
    fs.mkdirSync(dir, { recursive: true });
    // кандидат — сразу этот: findStory не берёт из запаса и не убирает историю оттуда (она уйдёт по кнопке)
    if (!fs.existsSync(path.join(dir, "candidates.json"))) writeJson(path.join(dir, "candidates.json"), [candidate]);
    const hooks: Hooks = { signal, step: async () => {}, log: (line) => log(`[заготовка ${id}] ${line}`) };
    const t0 = Date.now();
    const keep: Stock = { ...stock, used() {}, skip() {} };
    const found = await findStory(dir, keep, hooks, undefined, true);
    if (signal.aborted) return;
    const clips = await analyzeClips(dir, found.clips, hooks);
    if (signal.aborted) return;
    const past = pastOf(historyFile);
    // вариант опыта на YouTube решается здесь же: от него зависит, кончается ли сценарий фразой о телеграме (trial.ts)
    const trial = isCrypto(found.candidate.lane) ? trialFor(work, dir, found.candidate.title) : undefined;
    const draft = await writePlan(dir, found.candidate, clips, hooks, past.hooks, past.memes, { rounds: 4, ending: true, trial });
    if (signal.aborted) return;
    await warmStickers(dir, draft, hooks);
    writeJson(path.join(dir, "prep.json"), { id, title: candidate.title, at: new Date().toISOString() });
    log(`заготовка готова за ${Math.round((Date.now() - t0) / 60_000)} мин: ${candidate.title}`);
  }

  /** Заготовки историй, которых в запасе больше нет (ролик сделан, «Не то», «Убрать», устарела), — удаляются. */
  function sweep(ids: Set<string>) {
    if (!fs.existsSync(root)) return;
    for (const name of fs.readdirSync(root)) if (!ids.has(name) && running?.id !== name) fs.rmSync(path.join(root, name), { recursive: true, force: true });
  }

  return {
    /** ПК свободен: следующая из лучших историй запаса, у которой нет заготовки, — в работу (по одной). */
    maybe() {
      if (!on("prep") || running) return;
      const stories = stock.report().stories;
      sweep(new Set(stories.map((s) => s.id)));
      // лучшие из тех, что качаются: не скачались ролики у первых двух (Tesla, «Жених», 1.11) — заготавливаются следующие
      const next = stories
        .filter((s) => Date.now() - (failed.get(s.id) ?? 0) > RETRY_MS)
        .slice(0, AHEAD)
        .find((s) => !ready(s.id));
      if (!next) return;
      const abort = new AbortController();
      log(`заготовка: ${next.title}`);
      const done = prepare(next.id, abort.signal)
        .catch((error) => {
          failed.set(next.id, Date.now());
          if (!abort.signal.aborted) log(`заготовка «${next.title}» не вышла: ${(error as Error).message}`);
        })
        .finally(() => {
          if (running?.id === next.id) running = null;
        });
      running = { id: next.id, done, abort };
    },

    /**
     * Пришло задание: заготовка этой истории (готовая или начатая) — её; идущая заготовка той же истории дожидается,
     * чужая останавливается между шагами. Без выбора («Создать») берётся заготовленная история из лучших.
     */
    async claim(pick: string | undefined): Promise<{ id: string; dir: string } | null> {
      const best = stock.report().stories.find((s) => ready(s.id) || running?.id === s.id)?.id;
      const id = pick ?? best;
      // заготовка останавливается после текущего шага (сценарий — после переписывания, что уже идёт); своя дожидается
      // этого шага, и ролик продолжает с него — четыре круга правок заготовки владелец не ждёт
      if (running) {
        const own = running.id === id;
        running.abort.abort();
        if (own) await running.done;
      }
      return id && started(id) ? { id, dir: dirOf(id) } : null;
    },
  };
}
