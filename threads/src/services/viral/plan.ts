import { hourInZone, nextHourInZone } from "../publishing/schedule.js";

/**
 * Главный поток постов — чужие залетевшие посты. Английские переводим по смыслу (translate),
 * русские переписываем своими словами (remake). Здесь всё, что решается без базы и модели:
 * язык, сила поста, годится ли он в образец и когда писать следующий.
 */
export type ViralUse = "translate" | "remake";
export const VIRAL_TYPE: Record<ViralUse, "TRANSLATION" | "REMAKE"> = { translate: "TRANSLATION", remake: "REMAKE" };
export type ViralLang = "ru" | "en" | "other";

const EN_WORDS = new Set("the a an and or but you your i i'm im my me we to of in on at for with is are was be it it's this that what when why how just so not no if do don't can all they he she her his".split(" "));

/**
 * Язык по буквам. Казахские, украинские и белорусские буквы уводят пост в other: такие посты
 * не наша аудитория. Латиница без английских служебных слов — малайский, тагальский, испанский —
 * тоже other: выдача Threads без входа щедро их подмешивает.
 */
export function detectLang(text: string): ViralLang {
  const letters = text.replace(/[^\p{L}]/gu, "");
  if (letters.length < 6) return "other";
  const cyr = (letters.match(/[Ѐ-ӿ]/g) ?? []).length;
  const lat = (letters.match(/[A-Za-z]/g) ?? []).length;
  if (cyr / letters.length > 0.6) return /[їєґўәғқңөұүһЇЄҐЎӘҒҚҢӨҰҮҺ]/.test(text) ? "other" : "ru";
  if (lat / letters.length > 0.85) {
    const words = text.toLowerCase().match(/[a-z']+/g) ?? [];
    const hits = words.filter((w) => EN_WORDS.has(w)).length;
    return hits >= 2 || (words.length <= 6 && hits >= 1) ? "en" : "other";
  }
  return "other";
}

export interface ViralThresholds {
  threads: { minEngagement: number; strongEngagement: number };
  x: { minViews: number; strongViews: number };
}

export interface ViralMetrics {
  platform: "threads" | "x";
  likes: number;
  replies: number;
  reposts: number;
  views: number | null;
  postedAt: Date | null;
}

/** Ответ стоит двух лайков, репост — трёх: Threads сильнее всего разгоняет то, что обсуждают и пересылают. */
export function engagement(p: Pick<ViralMetrics, "likes" | "replies" | "reposts">): number {
  return p.likes + 2 * p.replies + 3 * p.reposts;
}

/**
 * Сила поста в долях «сильного» порога своей площадки: 1 — уровень, ради которого стоит писать
 * пост сверх минимума. Просмотры X и вовлечение Threads так становятся сравнимыми.
 */
export function strength(p: ViralMetrics, t: ViralThresholds): number {
  if (p.platform === "x") return p.views === null ? 0 : p.views / t.x.strongViews;
  return engagement(p) / t.threads.strongEngagement;
}

export function passesFloor(p: ViralMetrics, t: ViralThresholds): boolean {
  if (p.platform === "x") return (p.views ?? 0) >= t.x.minViews;
  return engagement(p) >= t.threads.minEngagement;
}

/** Быть в тренде: сутки — полный вес, дальше пост остывает. */
export function freshness(postedAt: Date | null, now: Date): number {
  const ageH = postedAt ? (now.getTime() - postedAt.getTime()) / 3_600_000 : 48;
  if (ageH <= 24) return 1;
  if (ageH <= 72) return 0.75;
  if (ageH <= 168) return 0.45;
  return 0.2;
}

export function viralScore(p: ViralMetrics, t: ViralThresholds, now: Date): number {
  return strength(p, t) * freshness(p.postedAt, now);
}

/**
 * Годится ли текст в образец. Короткий текстовый пост — да: «i hope 2027 will be better» набрал
 * полмиллиона просмотров. Пост с картинкой или видео — только если смысл несёт сам текст.
 */
export function usableText(text: string, media: string): boolean {
  const t = text.trim();
  if (t.length < 20 || t.length > 1500) return false;
  if (media !== "text" && t.length < 80) return false;
  // Пост из одних упоминаний и хештегов — это не мысль, а подпись.
  const words = t.split(/\s+/).filter((w) => !/^[@#]/.test(w));
  return words.length >= 4;
}

export function useForLang(lang: ViralLang): ViralUse | null {
  return lang === "en" ? "translate" : lang === "ru" ? "remake" : null;
}

export interface WindowInfo {
  /** Начало сегодняшнего «дня публикаций» — первый час окна после самой длинной паузы. */
  dayStart: Date;
  windowEnd: Date;
  inWindow: boolean;
}

/**
 * Окно 10:00–02:00 переходит через полночь, поэтому «сегодня» считается от его начала, а не от
 * календарной даты: пост в 01:30 относится к вечеру, а не к новому дню.
 */
export function publishingWindow(now: Date, preferredHours: number[], timezone: string): WindowInfo {
  const hours = [...new Set(preferredHours.length ? preferredHours : Array.from({ length: 24 }, (_, i) => i))].sort((a, b) => a - b);
  let start = hours[0]!;
  let longestGap = -1;
  for (let i = 0; i < hours.length; i++) {
    const cur = hours[i]!;
    const prev = hours[(i - 1 + hours.length) % hours.length]!;
    const gap = (cur - prev + 24) % 24 || (hours.length === 1 ? 24 : 0);
    if (gap > longestGap) {
      longestGap = gap;
      start = cur;
    }
  }
  let dayStart = nextHourInZone(new Date(now.getTime() - 24 * 3_600_000), start, timezone);
  if (dayStart.getTime() > now.getTime()) dayStart = new Date(dayStart.getTime() - 24 * 3_600_000);
  const set = new Set(hours);
  let span = 0;
  while (span < 24 && set.has((start + span) % 24)) span++;
  const windowEnd = new Date(dayStart.getTime() + span * 3_600_000);
  return { dayStart, windowEnd, inWindow: set.has(hourInZone(now, timezone)) && now < windowEnd };
}


/**
 * Школа, универ, экзамены, жизнь под контролем родителей — голос подростка. Аккаунт ведёт взрослый
 * работающий мужчина, и от него такие посты звучат фальшиво (владелец 26.10: «я не школьник и не
 * студент»). Ловим и в чужом образце, и в нашем готовом тексте.
 */
// Русское — по началу слова («школ» ловит и «школьник»), английское — словом целиком: иначе «uni»
// поймал бы «unique». «Универсальный» и «преподнёс» сюда не попадают.
const TEEN_RU = /(?<![\p{L}])(школ|студент|студенч|университет|универ(?!сал|сам)|первокурс|однокурс|одноклассн|экзамен|егэ|огэ|домашк|домашнее задание|учител|училк|преподават|препод(?:ы|а|у|ом|ам|ов)?(?![\p{L}])|колледж|выпускн|учёб|учеб|лекци)/iu;
const TEEN_EN = /(?<![\p{L}])(schools?|students?|college|university|uni|exams?|finals|homework|classmates?|teachers?|professors?|semester|dorm|campus|gpa|studying)(?![\p{L}])/iu;

export function teenTopic(text: string): boolean {
  return TEEN_RU.test(text) || TEEN_EN.test(text);
}

/**
 * Псевдослучайное число 0…1, одинаковое для одного и того же ключа. Промежуток до следующего поста
 * выбирается случайно, но один раз: тики каждые десять минут не перебрасывают кубик заново.
 */
export function seededUnit(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100_000) / 100_000;
}

/**
 * Вес часа по нашей же истории: медиана просмотров постов, вышедших в этот час, относительно общей.
 * Мало постов в часе — вес тянется к единице (сжатие к общей медиане), а редкий хит срезается до
 * уровня 90-го процентиля: два случайных залёта не перекраивают расписание, а устойчивая разница со
 * временем проявляется. Вес ограничен 0,6–1,6.
 */
export function hourWeights(samples: Array<{ hour: number; views: number }>, shrink = 6): Record<number, number> {
  const median = (xs: number[]) => {
    const a = [...xs].sort((x, y) => x - y);
    if (!a.length) return 0;
    const m = Math.floor(a.length / 2);
    return a.length % 2 ? a[m]! : (a[m - 1]! + a[m]!) / 2;
  };
  const sorted = samples.map((s) => s.views).sort((x, y) => x - y);
  const cap = sorted[Math.floor(sorted.length * 0.9)] ?? 0;
  const global = median(sorted);
  const out: Record<number, number> = {};
  if (global <= 0) return out;
  for (let h = 0; h < 24; h++) {
    const views = samples.filter((s) => s.hour === h).map((s) => Math.min(s.views, cap));
    const shrunk = (views.length * median(views) + shrink * global) / (views.length + shrink);
    out[h] = Math.min(1.6, Math.max(0.6, shrunk / global));
  }
  return out;
}

export interface PlanInput {
  now: Date;
  timezone: string;
  preferredHours: number[];
  minimumMinutesBetweenPosts: number;
  quotas: Record<ViralUse, { min: number; max: number }>;
  /** Посты, написанные за сегодняшний день публикаций (без отклонённых и упавших). */
  done: Record<ViralUse, number>;
  /** Написаны и ещё не вышли — пока такой есть, новый не пишем, чтобы не копить очередь. */
  pending: number;
  lastCreatedAt: Date | null;
  /** Вес часа по истории просмотров; нет данных — все часы равны. */
  hourWeights?: Record<number, number>;
}

export type PlanStep = { use: ViralUse; strongOnly: boolean };
export type PlanDecision = { kind: "write"; steps: PlanStep[] } | { kind: "wait"; reason: string };

/**
 * Когда пора следующий пост. Первый пост дня выходит в случайную минуту первого часа окна, а не
 * ровно в его начало. Дальше промежуток = остаток окна / остаток квот × случайный множитель
 * 0,55–1,6 и делится на вес текущего часа: в сильные часы посты идут чаще, в слабые — реже.
 */
export function nextDueAt(input: PlanInput): Date | null {
  const win = publishingWindow(input.now, input.preferredHours, input.timezone);
  const uses: ViralUse[] = ["translate", "remake"];
  const left = uses.reduce((n, u) => n + Math.max(0, input.quotas[u].max - input.done[u]), 0);
  if (left === 0) return null;
  if (!input.lastCreatedAt || input.lastCreatedAt < win.dayStart) {
    return new Date(win.dayStart.getTime() + (5 + seededUnit(`day:${win.dayStart.toISOString()}`) * 65) * 60_000);
  }
  const minutesLeft = Math.max(0, (win.windowEnd.getTime() - input.now.getTime()) / 60_000);
  const base = minutesLeft / left;
  const factor = 0.55 + 1.05 * seededUnit(`gap:${input.lastCreatedAt.toISOString()}`);
  const weight = input.hourWeights?.[hourInZone(input.now, input.timezone)] ?? 1;
  const gap = Math.min(240, Math.max(input.minimumMinutesBetweenPosts, (base * factor) / weight));
  return new Date(input.lastCreatedAt.getTime() + gap * 60_000);
}

/**
 * Квоты — диапазоны: минимум выполняется любым постом выше порога, всё сверх минимума — только
 * сильными (strongOnly). Промежутки случайные, а не «раз в час».
 */
export function planViral(input: PlanInput): PlanDecision {
  if (input.pending > 0) return { kind: "wait", reason: "предыдущий пост ещё ждёт публикации" };
  const win = publishingWindow(input.now, input.preferredHours, input.timezone);
  if (!win.inWindow) return { kind: "wait", reason: "вне окна публикаций" };
  const due = nextDueAt(input);
  if (!due) return { kind: "wait", reason: "дневные квоты выполнены" };
  if (input.now < due) return { kind: "wait", reason: `следующий пост через ${Math.ceil((due.getTime() - input.now.getTime()) / 60_000)} мин` };
  const uses: ViralUse[] = ["translate", "remake"];
  const ratio = (u: ViralUse, of: "min" | "max") => (input.quotas[u][of] ? input.done[u] / input.quotas[u][of] : 1);
  const behind = uses.filter((u) => input.done[u] < input.quotas[u].min).sort((a, b) => ratio(a, "min") - ratio(b, "min"));
  const extra = uses.filter((u) => input.done[u] >= input.quotas[u].min && input.done[u] < input.quotas[u].max).sort((a, b) => ratio(a, "max") - ratio(b, "max"));
  const steps: PlanStep[] = [...behind.map((use) => ({ use, strongOnly: false })), ...extra.map((use) => ({ use, strongOnly: true }))];
  return steps.length ? { kind: "write", steps } : { kind: "wait", reason: "дневные квоты выполнены" };
}

/** Минута публикации внутри тика: пост не выходит в одни и те же «:04» каждый раз. */
export function publishDelayMinutes(key: string): number {
  return 1 + Math.floor(seededUnit(`delay:${key}`) * 18);
}
