import type { Carousel } from "./types";
import { attachJob, listCarousels, updateCarousel } from "./store";

/**
 * Лимит подписки Claude («You've hit your session limit · resets 8pm (Asia/Qyzylorda)», владелец 01.11: задания
 * простояли с 17:23 до 21:44): такое задание само встаёт на повтор через пару минут после сброса, а карточка
 * пишет, когда продолжит. Остальные ошибки по-прежнему ждут кнопку «Повторить».
 */

export const LIMIT_RETRY_DELAY_MS = 2 * 60_000;
const DEFAULT_TZ = () => process.env.CAROUSEL_TIME_ZONE || "Asia/Qyzylorda";

/** Сдвиг пояса в минутах для момента t (сколько минут местное время опережает UTC). */
function offsetMinutes(t: number, tz: string): number {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date(t)).map((p) => [p.type, p.value]));
  const local = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return Math.round((local - t) / 60_000);
}

/** Момент сброса лимита из текста ошибки; null — это не ошибка лимита или время не указано. */
export function parseLimitReset(message: string, now = Date.now()): Date | null {
  if (!/limit/i.test(message)) return null;
  const m = message.match(/resets?\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:\(([^)]+)\))?/i);
  if (!m) return null;
  let hour = Number(m[1]);
  const minute = Number(m[2] ?? 0);
  const ampm = m[3]?.toLowerCase();
  if (ampm === "pm" && hour < 12) hour += 12;
  if (ampm === "am" && hour === 12) hour = 0;
  if (hour > 23 || minute > 59) return null;
  let tz = m[4]?.trim() || DEFAULT_TZ();
  try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); } catch { tz = DEFAULT_TZ(); }
  const offset = offsetMinutes(now, tz);
  const local = new Date(now + offset * 60_000);
  let at = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), hour, minute) - offset * 60_000;
  if (at <= now) at += 24 * 3600_000;
  return new Date(at);
}

/** «лимит Claude, продолжу в 20:02» — время по поясу раздела. */
export function limitNote(retryAt: Date): string {
  const hhmm = new Intl.DateTimeFormat("ru-RU", { timeZone: DEFAULT_TZ(), hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(retryAt);
  return `лимит Claude, продолжу в ${hhmm}`;
}

/** Задание с наступившим временем повтора — его пора поставить в очередь заново. */
export const dueForRetry = (c: Carousel, now = Date.now()) => Boolean(c.job && c.job.state === "error" && c.job.retryAt && Date.parse(c.job.retryAt) <= now);

/** Проход планировщика: задания, у которых наступило время повтора после лимита, встают в очередь заново. */
export function requeueLimited(now = Date.now()): number {
  let n = 0;
  for (const c of listCarousels()) {
    if (!dueForRetry(c, now)) continue;
    try {
      updateCarousel(c.id, (x) => {
        if (!dueForRetry(x, now)) return;
        const old = x.job!;
        attachJob(x, old.type, old.params);
        n++;
      });
    } catch {}
  }
  return n;
}
