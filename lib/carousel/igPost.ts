import fs from "fs";
import path from "path";
import type { Carousel } from "./types";

/**
 * Карусели владелец заливает в Instagram сам, с телефона. Статистика раздела «Публикации» собирает все посты
 * аккаунта (data/stats/posts-instagram.json, заголовок — первая строка подписи): карусель узнаёт свой пост по
 * началу подписи и показывает его просмотры и охват. Найден пост — карусель опубликована без всякой кнопки;
 * нет — владелец ставит отметку «Опубликована» сам (manualPublishedAt).
 */

export type IgPost = { url: string; title: string; publishedAt: string; carousel: boolean; views: number | null; reach: number | null };
export type Publication = { at: string; source: "post" | "manual"; url?: string; views?: number | null; reach?: number | null };

const statsFile = () => path.join(process.env.CAROUSEL_STATS_DIR || path.join(process.cwd(), "data", "stats"), "posts-instagram.json");
/** сравниваются столько первых знаков подписи: владелец может поправить хвост на телефоне */
const PREFIX = 60;
const MIN = 24;

/** Начало подписи без регистра, «ё», знаков и лишних пробелов — так подпись с сайта и из Instagram совпадают. */
export function captionKey(caption: string): string {
  const first = String(caption ?? "").split("\n").find((l) => l.trim()) ?? "";
  return first.toLowerCase().replace(/ё/g, "е").replace(/[^\p{L}\p{N}]+/gu, " ").trim().slice(0, PREFIX).trim();
}

let cache: { mtime: number; posts: IgPost[] } | null = null;

/** Посты Instagram из статистики; файла нет или он битый — пустой список, карусели это не мешает. */
export function readIgPosts(): IgPost[] {
  try {
    const file = statsFile();
    const mtime = fs.statSync(file).mtimeMs;
    if (cache?.mtime === mtime) return cache.posts;
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    const posts: IgPost[] = Object.values(raw?.posts ?? {}).flatMap((p: any) => typeof p?.url === "string" && typeof p?.title === "string" ? [{
      url: p.url, title: p.title, publishedAt: String(p.publishedAt ?? ""), carousel: p.mediaType === "CAROUSEL_ALBUM",
      views: typeof p.metrics?.views === "number" ? p.metrics.views : null, reach: typeof p.metrics?.reach === "number" ? p.metrics.reach : null,
    }] : []);
    cache = { mtime, posts };
    return posts;
  } catch {
    return [];
  }
}

/** Пост с той же подписью: сначала карусели, из них самая свежая. */
export function findPost(caption: string, posts: IgPost[]): IgPost | null {
  const key = captionKey(caption);
  if (key.length < MIN) return null;
  const same = posts.filter((p) => {
    const k = captionKey(p.title);
    const n = Math.min(key.length, k.length);
    return n >= MIN && key.slice(0, n) === k.slice(0, n);
  });
  same.sort((a, b) => Number(b.carousel) - Number(a.carousel) || b.publishedAt.localeCompare(a.publishedAt));
  return same[0] ?? null;
}

/** Опубликована ли карусель: найденный пост важнее ручной отметки. */
export function publicationOf(c: Pick<Carousel, "caption" | "manualPublishedAt">, posts = readIgPosts()): Publication | null {
  const post = findPost(c.caption, posts);
  if (post) return { at: post.publishedAt, source: "post", url: post.url, views: post.views, reach: post.reach };
  return c.manualPublishedAt ? { at: c.manualPublishedAt, source: "manual" } : null;
}
