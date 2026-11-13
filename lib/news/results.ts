// Как зашли ролики «Новостей»: просмотры и среднее время просмотра с площадок (раздел «Статистика» кладёт их в
// data/stats), чтобы исполнитель учился на своих лучших роликах — искал похожие истории и зачины (владелец 29.10: «да
// нужно добавить, ролик с вазелином набрал 89к просмотров!»). Пост узнаётся по ссылке из журнала публикаций зеркала,
// а выложенный вручную — по заголовку подписи.
import fs from "node:fs";
import path from "node:path";
import { listProjects } from "./store";

type Post = { platform: string; url: string; title?: string; publishedAt?: string; metrics?: { views?: number | null; avgWatchSec?: number | null } };
type Published = { projectId?: string; status?: string; url?: string };

export type NewsResult = {
  id: string;
  title: string;
  /** The first voiced phrase. */
  hook: string;
  hero: string | null;
  /** When it went out, the earliest platform. */
  at: string;
  /** All platforms together. */
  views: number;
  /** The best platform's average watch time, seconds. */
  avgWatchSec: number | null;
  duration: number | null;
  platforms: Record<string, number>;
};

const dataDir = () => path.resolve(process.env.NEWS_SITE_DATA_DIR ?? path.join(process.cwd(), "data"));
const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
/** shorts/<id>, reel/<code>, video/<id> — one key for the publication log and the stats. */
const postKey = (url: string) => url.match(/(?:shorts|reel|video)\/([\w-]+)/)?.[1] ?? url;

function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

function readLog(file: string): Published[] {
  try {
    return fs.readFileSync(file, "utf8").split("\n").filter(Boolean).flatMap((l) => {
      try {
        return [JSON.parse(l) as Published];
      } catch {
        return [];
      }
    });
  } catch {
    return [];
  }
}

/** Every published news video with its numbers, most viewed first. */
export function newsResults(): NewsResult[] {
  const dir = dataDir();
  const posts = ["youtube", "instagram", "tiktok"].flatMap((pl) => Object.values(readJson<{ posts?: Record<string, Post> }>(path.join(dir, "stats", `posts-${pl}.json`), {}).posts ?? {}));
  const byKey = new Map(posts.map((p) => [postKey(p.url), p]));
  const log = readLog(path.join(dir, "publication-history.jsonl"));
  const out: NewsResult[] = [];
  for (const p of listProjects()) {
    if (!p.video || !p.story) continue;
    const title = p.meta?.title ?? p.story.title;
    const mine = new Set<Post>();
    for (const h of log) {
      const post = p.mirrorId && h.projectId === p.mirrorId && h.status === "published" && h.url ? byKey.get(postKey(h.url)) : undefined;
      if (post) mine.add(post);
    }
    // a second launch counts only its own publications: by title it would also pick up the posts of the first launch
    if (!p.story.relaunch) for (const post of posts) if (post.title && norm(title) && norm(post.title).startsWith(norm(title))) mine.add(post);
    if (!mine.size) continue;
    const platforms: Record<string, number> = {};
    for (const post of mine) platforms[post.platform] = (platforms[post.platform] ?? 0) + (post.metrics?.views ?? 0);
    const watched = [...mine].map((m) => m.metrics?.avgWatchSec).filter((v): v is number => typeof v === "number");
    out.push({
      id: p.id,
      title,
      hook: p.story.script.split("\n")[0] ?? "",
      hero: p.story.hero ?? null,
      at: [...mine].map((m) => m.publishedAt ?? "").filter(Boolean).sort()[0] ?? p.createdAt,
      views: Object.values(platforms).reduce((a, b) => a + b, 0),
      avgWatchSec: watched.length ? Math.max(...watched) : null,
      duration: p.video.duration ?? null,
      platforms,
    });
  }
  return out.sort((a, b) => b.views - a.views);
}
