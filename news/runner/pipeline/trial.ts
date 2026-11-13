// Опыт на YouTube (10.11.2026). С вечера 6.11 крипто-новости канала перестали попадать в ленту Shorts: 7–23 просмотра
// при открытом статусе и без видимых ограничений, обычные ролики рядом идут как раньше. Причина не установлена, поэтому
// следующие крипто-ролики выходят вариантами по кругу — в каждом меняется один признак, а «Статистика» на сайте
// показывает у каждого варианта, сколько просмотров пришло из ленты.
import fs from "node:fs";
import path from "node:path";
import { on } from "./features";
import { readJson, writeJson } from "./util";

/**
 * calm — без телеграма (ни голосом, ни в подписи) и со спокойным названием; no-tg — только без телеграма; soft — только
 * спокойное название (событие без слов «взлом», «хакеры», «вирус», «украли», «поддельный»); base — как раньше.
 * Спокойное название и строку в подписи делает сайт (lib/news/rules.ts, lib/news/meta.ts), голос — раскладка (plan.ts).
 */
export const TRIALS = ["calm", "no-tg", "soft", "base"] as const;
export type Trial = (typeof TRIALS)[number];
export const isTrial = (v: unknown): v is Trial => typeof v === "string" && (TRIALS as readonly string[]).includes(v);
/** В этом варианте ролик кончается фразой автора о его телеграм-канале. */
export const speaksTelegram = (t: Trial | undefined) => t !== "calm" && t !== "no-tg";

type Given = { dir: string; trial: Trial; title: string; at: string };
type Log = { n: number; given: Given[] };

/**
 * Вариант крипто-ролика выдаётся один раз на папку ролика или заготовки (trial.json переезжает вместе с ней), следующий
 * ролик получает следующий по кругу. Выключатель — "ytTrial": false в news/features.json: все ролики идут как раньше.
 */
export function trialFor(work: string, dir: string, title: string): Trial {
  if (!on("ytTrial")) return "base";
  const own = path.join(dir, "trial.json");
  if (fs.existsSync(own)) {
    const kept = readJson<{ trial?: unknown }>(own).trial;
    if (isTrial(kept)) return kept;
  }
  const file = path.join(work, "trials.json");
  const log: Log = fs.existsSync(file) ? readJson<Log>(file) : { n: 0, given: [] };
  const trial = TRIALS[log.n % TRIALS.length];
  const at = new Date().toISOString();
  fs.mkdirSync(dir, { recursive: true });
  writeJson(own, { trial, at });
  writeJson(file, { n: log.n + 1, given: [...log.given, { dir: path.basename(dir), trial, title, at }].slice(-60) });
  return trial;
}
