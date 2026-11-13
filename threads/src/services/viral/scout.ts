import { loadSettings, type Settings } from "../../config/settings.js";
import { markQueryRun, pruneViralPosts, staleQueries, upsertViralPost, type FoundViralPost } from "../../db/repos/viral.js";
import { xBrowser } from "../../x/browser/client.js";
import { errorMessage } from "../../shared/logger.js";
import { publishingWindow, detectLang, passesFloor, teenTopic, usableText, useForLang } from "./plan.js";
import { audit } from "../audit.js";

export interface ScoutResult {
  threads: { queries: number; seen: number; kept: number };
  x: { queries: number; seen: number; kept: number };
  pruned: number;
  errors: string[];
}

/**
 * В базу идёт только то, из чего может выйти пост: нужный язык, рабочий текст, порог пройден,
 * и тема — из взрослой жизни, а не школьная или студенческая.
 */
function worthKeeping(p: FoundViralPost, settings: Settings): boolean {
  if (!useForLang(p.lang) || !usableText(p.text, p.media) || teenTopic(p.text)) return false;
  return passesFloor({ platform: p.platform, likes: p.likes, replies: p.replies, reposts: p.reposts, views: p.views, postedAt: p.postedAt }, settings.viral.thresholds);
}

/**
 * viral:scout — раз в пару часов читаем «Популярное» Threads по самым давно не читанным запросам и
 * поиск X по англоязычным текстовым хитам. Чтение X идёт браузером владельца, поэтому его берём
 * только в окно публикаций: живой человек ночью поиск не листает.
 */
export async function scoutViral(): Promise<ScoutResult> {
  const settings = await loadSettings(true);
  const result: ScoutResult = { threads: { queries: 0, seen: 0, kept: 0 }, x: { queries: 0, seen: 0, kept: 0 }, pruned: 0, errors: [] };
  if (!settings.viral.enabled || settings.killSwitch) return result;
  const browser = xBrowser();
  if (!browser.configuredUrl) {
    result.errors.push("X_BROWSER_URL не задан: читать выдачу нечем");
    return result;
  }
  const cutoff = Date.now() - settings.viral.maxAgeHours * 3_600_000;
  const fresh = (d: Date | null) => !d || d.getTime() >= cutoff;

  const all = [
    ...settings.viral.queriesRu.map((q) => ({ key: `ru:${q}`, q, locale: "ru-RU" })),
    ...settings.viral.queriesEn.map((q) => ({ key: `en:${q}`, q, locale: "en-US" })),
  ];
  // Каждый прогон берёт и русские, и английские запросы: иначе английские ждали бы, пока по кругу
  // пройдут все русские, и переводы полдня жили бы на одном X.
  const perRun = settings.viral.threadsQueriesPerRun;
  const enShare = settings.viral.queriesEn.length ? Math.max(1, Math.round(perRun / 4)) : 0;
  const picked = [
    ...await staleQueries("threads", all.filter((a) => a.locale === "ru-RU").map((a) => a.key), perRun - enShare),
    ...await staleQueries("threads", all.filter((a) => a.locale === "en-US").map((a) => a.key), enShare),
  ];
  const queries = all.filter((a) => picked.includes(a.key));
  if (queries.length) {
    try {
      const { posts, errors } = await browser.threadsSearch(queries.map(({ q, locale }) => ({ q, locale })));
      result.threads.queries = queries.length;
      result.threads.seen = posts.length;
      result.errors.push(...errors);
      const keptBy = new Map<string, number>();
      for (const p of posts) {
        const found: FoundViralPost = {
          platform: "threads", externalId: p.id, username: p.username, permalink: p.permalink, text: p.text, lang: detectLang(p.text),
          media: p.media, imageUrls: p.imageUrls, likes: p.likes, replies: p.replies, reposts: p.reposts + p.quotes, views: null,
          postedAt: p.postedAt ? new Date(p.postedAt) : null, query: p.query,
        };
        if (!fresh(found.postedAt) || !worthKeeping(found, settings)) continue;
        await upsertViralPost(found);
        result.threads.kept++;
        keptBy.set(p.query, (keptBy.get(p.query) ?? 0) + 1);
      }
      for (const a of queries) await markQueryRun("threads", a.key, keptBy.get(a.q) ?? 0, errors.find((e) => e.startsWith(`${a.q}:`)) ?? null);
    } catch (err) {
      result.errors.push(`Threads: ${errorMessage(err)}`);
    }
  }

  const win = publishingWindow(new Date(), settings.schedule.preferredHours, settings.schedule.timezone);
  const xOpen = win.inWindow || win.dayStart.getTime() + 24 * 3_600_000 - Date.now() < 3_600_000;
  if (xOpen && settings.viral.xSearchesPerRun > 0) {
    const connected = await browser.status().then((s) => s.connected && !s.login && !s.busy).catch(() => false);
    const since = new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10);
    for (const q of connected ? await staleQueries("x", settings.viral.xQueries, settings.viral.xSearchesPerRun) : []) {
      try {
        const { posts } = await browser.search(`${q} since:${since}`, 30, "top");
        result.x.queries++;
        result.x.seen += posts.length;
        let kept = 0;
        for (const p of posts) {
          if (p.isReply || !p.text) continue;
          const found: FoundViralPost = {
            platform: "x", externalId: p.id, username: p.username, permalink: p.permalink, text: p.text, lang: detectLang(p.text),
            media: p.imageUrls.length ? "image" : "text", imageUrls: p.imageUrls, likes: p.likes ?? 0, replies: 0, reposts: 0,
            views: p.views ?? null, postedAt: p.timestamp ? new Date(p.timestamp) : null, query: q,
          };
          if (!fresh(found.postedAt) || !worthKeeping(found, settings)) continue;
          await upsertViralPost(found);
          kept++;
        }
        result.x.kept += kept;
        await markQueryRun("x", q, kept, null);
      } catch (err) {
        result.errors.push(`X: ${errorMessage(err)}`);
        await markQueryRun("x", q, 0, errorMessage(err).slice(0, 300));
        break;
      }
    }
  }
  result.pruned = await pruneViralPosts();
  if (result.errors.length && !result.threads.kept && !result.x.kept) {
    await audit("SOURCE_ERROR", `Поиск залетевших постов ничего не дал: ${result.errors.slice(0, 3).join("; ")}`, {}, { ...result }, "warn");
  }
  return result;
}
