import { chromium, type Browser } from "playwright";

/**
 * Поиск Threads без входа. Официальный keyword_search без Advanced Access отдаёт только наши же
 * посты, а сайт threads.com показывает выдачу «Популярное» и без аккаунта — вместе со счётчиками
 * лайков, ответов и репостов. Читаем её отдельным безголовым браузером с чистым профилем: вход
 * владельца в X этот браузер не видит, и аккаунт Threads здесь ничем не рискует.
 *
 * Данные приходят не в разметке, а в JSON: часть выдачи вшита в страницу, остальное догружается
 * запросами /graphql при прокрутке. Оба источника разбираются одним обходом — ищем объекты поста
 * по их собственным полям (pk, code, like_count, user), не завися от того, где они лежат.
 */

export type ThreadsWebMedia = "text" | "image" | "video" | "carousel" | "other";

export interface ThreadsWebPost {
  id: string;
  code: string;
  username: string;
  text: string;
  likes: number;
  replies: number;
  reposts: number;
  quotes: number;
  shares: number;
  media: ThreadsWebMedia;
  imageUrls: string[];
  postedAt: string | null;
  permalink: string;
  query: string;
}

export interface ThreadsSearchQuery {
  q: string;
  /** ru-RU, en-US… Выдача без входа зависит от языка браузера. */
  locale: string;
}

const MEDIA: Record<number, ThreadsWebMedia> = { 19: "text", 1: "image", 2: "video", 8: "carousel" };
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

type Raw = Record<string, unknown>;
const obj = (v: unknown): Raw | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Raw) : null);

function imageUrl(item: Raw | null): string | null {
  const candidates = obj(item?.image_versions2)?.candidates;
  const first = Array.isArray(candidates) ? obj(candidates[0]) : null;
  return typeof first?.url === "string" ? first.url : null;
}

/**
 * Пост, который можно взять за образец: свой текст, не ответ, не репост и не цитата чужого поста
 * (смысл цитаты живёт в процитированном), без ссылки — ссылка почти всегда означает рекламу.
 */
export function toThreadsWebPost(o: Raw, query: string): ThreadsWebPost | null {
  const user = obj(o.user);
  const info = obj(o.text_post_app_info);
  const share = obj(info?.share_info);
  if (typeof o.pk !== "string" || typeof o.code !== "string" || typeof user?.username !== "string") return null;
  if (typeof o.like_count !== "number") return null;
  if (info?.is_reply === true || share?.reposted_post || share?.quoted_post || info?.link_preview_attachment) return null;
  const text = typeof obj(o.caption)?.text === "string" ? (obj(o.caption)!.text as string).trim() : "";
  if (!text) return null;
  const images: string[] = [];
  const own = imageUrl(o);
  if (own) images.push(own);
  if (Array.isArray(o.carousel_media)) for (const c of o.carousel_media.slice(0, 4)) {
    const u = imageUrl(obj(c));
    if (u) images.push(u);
  }
  const takenAt = num(o.taken_at);
  return {
    id: o.pk,
    code: o.code,
    username: user.username,
    text: text.slice(0, 3000),
    likes: num(o.like_count),
    replies: num(info?.direct_reply_count),
    reposts: num(info?.repost_count),
    quotes: num(info?.quote_count),
    shares: num(info?.reshare_count),
    media: MEDIA[num(o.media_type)] ?? "other",
    imageUrls: images,
    postedAt: takenAt ? new Date(takenAt * 1000).toISOString() : null,
    permalink: `https://www.threads.com/@${user.username}/post/${o.code}`,
    query,
  };
}

/** Обходит любой JSON выдачи и складывает найденные посты; повтор по id не дублируется. */
export function collectThreadsPosts(root: unknown, query: string, into: Map<string, ThreadsWebPost>, depth = 0): void {
  if (!root || typeof root !== "object" || depth > 60) return;
  if (Array.isArray(root)) {
    for (const item of root) collectThreadsPosts(item, query, into, depth + 1);
    return;
  }
  const o = root as Raw;
  if (typeof o.pk === "string" && typeof o.code === "string" && "like_count" in o) {
    const post = toThreadsWebPost(o, query);
    if (post) {
      const seen = into.get(post.id);
      // Один пост встречается в выдаче несколько раз; счётчики берём самые свежие (наибольшие).
      if (!seen || post.likes > seen.likes) into.set(post.id, post);
    }
  }
  for (const v of Object.values(o)) if (v && typeof v === "object") collectThreadsPosts(v, query, into, depth + 1);
}

const EMBEDDED = /<script type="application\/json"[^>]*>([\s\S]*?)<\/script>/g;

export function threadsSearchUrl(q: string): string {
  return `https://www.threads.com/search?q=${encodeURIComponent(q)}&serp_type=default`;
}

let browser: Browser | null = null;

async function headless(): Promise<Browser> {
  if (browser?.isConnected()) return browser;
  browser = await chromium.launch({ headless: true, args: ["--disable-dev-shm-usage", "--no-first-run"] });
  return browser;
}

export async function closeThreadsBrowser(): Promise<void> {
  const b = browser;
  browser = null;
  await b?.close().catch(() => undefined);
}

/**
 * Каждый запрос — в своём контексте с нужным языком: так выдача не смешивает русскую и английскую
 * ленты. Ошибка одного запроса не роняет остальные — она уходит в errors.
 */
export async function searchThreadsWeb(
  queries: ThreadsSearchQuery[],
  opts: { scrolls?: number; deadline?: number; stopped?: () => boolean } = {},
): Promise<{ posts: ThreadsWebPost[]; errors: string[] }> {
  const found = new Map<string, ThreadsWebPost>();
  const errors: string[] = [];
  const scrolls = Math.max(0, Math.min(opts.scrolls ?? 3, 8));
  const b = await headless();
  try {
    for (const { q, locale } of queries) {
      if (opts.stopped?.() || (opts.deadline && Date.now() > opts.deadline)) break;
      const ctx = await b.newContext({
        locale,
        extraHTTPHeaders: { "Accept-Language": `${locale},${locale.slice(0, 2)};q=0.9,en;q=0.5` },
        viewport: { width: 1280, height: 1000 },
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
      });
      const page = await ctx.newPage();
      page.on("response", async (r) => {
        if (!/\/graphql/.test(r.url())) return;
        try {
          collectThreadsPosts(JSON.parse(await r.text()), q, found);
        } catch {
          // Не JSON или ответ уже недоступен — следующий кусок выдачи придёт своим запросом.
        }
      });
      try {
        await page.goto(threadsSearchUrl(q), { waitUntil: "domcontentloaded", timeout: 30_000 });
        await page.waitForTimeout(3_500);
        const html = await page.content();
        for (const m of html.matchAll(EMBEDDED)) {
          try {
            collectThreadsPosts(JSON.parse(m[1]!), q, found);
          } catch {
            // Вшитые скрипты бывают не только с данными выдачи.
          }
        }
        for (let i = 0; i < scrolls; i++) {
          await page.mouse.wheel(0, 2500);
          await page.waitForTimeout(1_800);
        }
      } catch (err) {
        errors.push(`${q}: ${err instanceof Error ? err.message.split("\n")[0] : "ошибка"}`);
      } finally {
        await ctx.close().catch(() => undefined);
      }
    }
  } finally {
    await closeThreadsBrowser();
  }
  return { posts: [...found.values()], errors };
}
