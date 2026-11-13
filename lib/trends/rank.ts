import { hookById } from "./hooks";
import { OUTLIER_MULTIPLE, type AccountRead, type ReelStat, type TrendCard } from "./types";

/** Медиана нужна по последним роликам: по 12 и больше, как в ig-viral; меньше 6 — уже гадание. */
export const MEDIAN_MIN_REELS = 6;
/** Сколько выбросов за прогон разбираем целиком: каждый — скачивание, расшифровка и два-три запроса Claude. */
export const MAX_CARDS_PER_RUN = 20;
/** Сколько выбросов прогон сохраняет вообще: сверх разобранных — карточки с кнопкой «Разобрать». */
export const MAX_FOUND_PER_RUN = 80;

/** «1.2M», «12,345», «980K», «1.5 тыс.» → число; не число → null. */
export function parseCount(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) && raw >= 0 ? Math.round(raw) : null;
  if (typeof raw !== "string") return null;
  const text = raw.replace(/\s+/g, " ").trim().toLowerCase();
  const m = text.match(/(\d[\d,. ]*)\s*(k|m|b|тыс\.?|млн|млрд)?/);
  if (!m) return null;
  const unit = m[2] ?? "";
  let digits = m[1].trim().replace(/ /g, "");
  if (unit) {
    // с множителем запятая — десятичная («1,2 тыс.»), без него — разделитель тысяч («12,345»)
    digits = digits.replace(",", ".");
    if ((digits.match(/\./g) ?? []).length > 1) return null;
  } else digits = digits.replace(/[,.](?=\d{3}\b)/g, "");
  const value = Number(digits);
  if (!Number.isFinite(value)) return null;
  const mult = unit === "k" || unit.startsWith("тыс") ? 1e3 : unit === "m" || unit === "млн" ? 1e6 : unit === "b" || unit === "млрд" ? 1e9 : 1;
  return Math.round(value * mult);
}

export function median(values: number[]): number | null {
  const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

/** Ролики, по которым считается медиана: без закреплённых и без нулей, когда счётчик не прочитался. */
export const countedReels = (reels: ReelStat[]) => reels.filter((r) => !r.pinned && r.views > 0);

export function accountMedian(reels: ReelStat[]): number | null {
  const counted = countedReels(reels);
  return counted.length >= MEDIAN_MIN_REELS ? median(counted.map((r) => r.views)) : null;
}

export type Outlier = { read: AccountRead; reel: ReelStat; multiple: number };

/** Выбросы одного аккаунта: просмотры не меньше трёх медиан своего же аккаунта. */
export function outliersOf(read: AccountRead, min = OUTLIER_MULTIPLE): Outlier[] {
  if (!read.median) return [];
  return countedReels(read.reels)
    .map((reel) => ({ read, reel, multiple: reel.views / read.median! }))
    .filter((o) => o.multiple >= min)
    .sort((a, b) => b.multiple - a.multiple);
}

/**
 * Что разбирать за прогон: сильнейшие выбросы всех аккаунтов, но не больше трёх с одного автора на обеих
 * площадках вместе — иначе один удачный автор (и его же ролик, выложенный и в Instagram, и в YouTube)
 * займёт всю выдачу, и формулы перестанут быть сравнимы.
 */
export function pickOutliers(reads: AccountRead[], limit = MAX_FOUND_PER_RUN, perAccount = 3): Outlier[] {
  const byAuthor = new Map<string, Outlier[]>();
  for (const r of reads) byAuthor.set(r.accountId, [...(byAuthor.get(r.accountId) ?? []), ...outliersOf(r)]);
  const all = [...byAuthor.values()].flatMap((list) => list.sort((a, b) => b.multiple - a.multiple).slice(0, perAccount));
  const seen = new Set<string>();
  return all
    .sort((a, b) => b.multiple - a.multiple)
    .filter((o) => !seen.has(o.reel.key) && seen.add(o.reel.key))
    .slice(0, limit);
}

export type FormulaCount = { formulaId: number | null; name: string; count: number };

/** Шаг 4 ig-viral: какие формулы повторяются среди выбросов, сколько неразмеченных и насколько этому верить. */
export function runSummary(reads: AccountRead[], cards: TrendCard[]) {
  const reels = reads.reduce((n, r) => n + countedReels(r.reels).length, 0);
  const accounts = new Set(reads.filter((r) => r.median).map((r) => `${r.source}:${r.handle}`)).size;
  const analyzed = cards.filter((c) => c.analysis);
  const counts = new Map<number | null, number>();
  for (const c of analyzed) counts.set(c.analysis!.formulaId, (counts.get(c.analysis!.formulaId) ?? 0) + 1);
  const formulas: FormulaCount[] = [...counts.entries()]
    .map(([formulaId, count]) => ({ formulaId, count, name: formulaId === null ? "Не размечена" : hookById(formulaId)?.name ?? `#${formulaId}` }))
    .sort((a, b) => b.count - a.count || Number(a.formulaId === null) - Number(b.formulaId === null));
  return { reels, accounts, outliers: cards.length, analyzed: analyzed.length, formulas, confidence: confidence(reels, accounts, analyzed.length) };
}

/** Сорок роликов у шести аккаунтов уже говорят о чём-то, двенадцать — нет; так и пишем. */
export function confidence(reels: number, accounts: number, outliers: number): string {
  if (!outliers) return "Выбросов нет: у всех аккаунтов обычные дни.";
  if (reels >= 40 && accounts >= 6) return "Выборки хватает, чтобы говорить о повторяющихся формулах.";
  if (reels >= 20 && accounts >= 3) return "Выборка небольшая: повтор формулы — подсказка, а не закон.";
  return "Выборка слишком мала для выводов: смотрите на отдельные ролики, а не на счёт формул.";
}
