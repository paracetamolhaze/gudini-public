// Как зашли наши ролики (сайт, GET runner/results — lib/news/results.ts): поиск историй ищет похожие на лучшие,
// режиссёр видит их зачины, продолжения сначала ищутся у героев, которые зашли (владелец 29.10: «да нужно добавить, ролик
// с вазелином набрал 89к просмотров!»). Результаты берутся раз в полчаса; сайт недоступен — подсказки просто нет.

export type ChannelResult = { title: string; hook: string; hero: string | null; at: string; views: number; avgWatchSec: number | null; duration: number | null };

const FRESH_MS = 30 * 60_000;
let source: (() => Promise<ChannelResult[]>) | null = null;
let cached: { at: number; list: ChannelResult[] } | null = null;

/** Откуда брать результаты: исполнитель подключает сайт при старте. */
export function useResults(fn: () => Promise<ChannelResult[]>) {
  source = fn;
  cached = null;
}

export async function channelResults(): Promise<ChannelResult[]> {
  if (cached && Date.now() - cached.at < FRESH_MS) return cached.list;
  if (!source) return [];
  try {
    cached = { at: Date.now(), list: await source() };
  } catch {
    cached = { at: Date.now(), list: cached?.list ?? [] };
  }
  return cached.list;
}

const thousands = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)} тыс.` : String(n));

/** Строки для задания: «заголовок» — просмотры, сколько смотрят из длины, зачин. Лучшие сверху. */
export function resultsBrief(list: ChannelResult[], n = 6): string {
  return list
    .slice(0, n)
    .map((r) => {
      const watch = r.avgWatchSec !== null && r.duration ? `, смотрят в среднем ${Math.round(r.avgWatchSec)} с из ${Math.round(r.duration)}` : "";
      return `- «${r.title}» — ${thousands(r.views)} просмотров${watch}; зачин: «${r.hook.slice(0, 120)}»`;
    })
    .join("\n");
}
