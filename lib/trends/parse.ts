import { parseCount } from "./rank";
import type { ReelStat } from "./types";

/**
 * Разбор того, что показывают страницы Instagram и yt-dlp. Чистые функции: живую страницу
 * не проверить без входа, а эти — тестами на образцах ответов.
 */

const CODE_RE = /^[A-Za-z0-9_-]{5,40}$/;
const VIEW_FIELDS = ["play_count", "ig_play_count", "view_count", "video_view_count", "video_play_count"] as const;

export const reelUrl = (code: string) => `https://www.instagram.com/reel/${code}/`;
export const shortsUrl = (id: string) => `https://www.youtube.com/shorts/${id}`;
export const isHandle = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9._-]{1,40}$/.test(v);

/** «@Some.One », ссылка на профиль или канал → ник без @; мусор → null. */
export function cleanHandle(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  let v = raw.trim();
  const url = v.match(/(?:instagram\.com|youtube\.com)\/(?:@)?([A-Za-z0-9._-]+)/i);
  if (url) v = url[1];
  v = v.replace(/^@/, "").replace(/\/+$/, "");
  return isHandle(v) ? v : null;
}

type Media = { code: string; views: number | null; pinned: boolean; duration?: number; caption?: string; postedAt?: string; videoUrl?: string };

/** Ссылка на файл ролика, которую страница сама отдаёт плееру: самый узкий вариант не уже 480 px. */
function videoUrlOf(o: Record<string, any>): string | undefined {
  const versions = (Array.isArray(o.video_versions) ? o.video_versions : []).filter((v: any) => typeof v?.url === "string" && /^https:\/\/[^/]+\.(cdninstagram\.com|fbcdn\.net)\//.test(v.url));
  if (!versions.length) return undefined;
  const fit = versions.filter((v: any) => (v.width ?? 0) >= 480).sort((a: any, b: any) => (a.width ?? 0) - (b.width ?? 0));
  return (fit[0] ?? versions[0]).url;
}

function captionOf(node: any): string | undefined {
  const text = node?.caption?.text ?? node?.edge_media_to_caption?.edges?.[0]?.node?.text;
  return typeof text === "string" && text.trim() ? text.trim().slice(0, 2200) : undefined;
}

/**
 * Ролики из JSON, который страница Instagram сама загружает (GraphQL и api/v1). Схема меняется,
 * поэтому не идём по известному пути, а ищем по всему дереву объекты с кодом ролика и счётчиком.
 */
export function mediaFromJson(root: unknown, into = new Map<string, Media>()): Map<string, Media> {
  const stack: unknown[] = [root];
  let guard = 0;
  while (stack.length && guard++ < 200_000) {
    const node = stack.pop();
    if (!node || typeof node !== "object") continue;
    if (Array.isArray(node)) {
      for (const item of node) stack.push(item);
      continue;
    }
    const o = node as Record<string, any>;
    if (typeof o.code === "string" && CODE_RE.test(o.code)) {
      const field = VIEW_FIELDS.find((f) => typeof o[f] === "number");
      const isVideo = o.media_type === 2 || o.product_type === "clips" || o.is_video === true || field !== undefined || Array.isArray(o.video_versions);
      if (isVideo) {
        const prev = into.get(o.code);
        const pinned = [o.clips_tab_pinned_user_ids, o.timeline_pinned_user_ids].some((ids) => Array.isArray(ids) && ids.length > 0);
        const taken = typeof o.taken_at === "number" ? new Date(o.taken_at * 1000).toISOString() : undefined;
        into.set(o.code, {
          code: o.code,
          views: field ? Math.round(o[field]) : prev?.views ?? null,
          pinned: pinned || Boolean(prev?.pinned),
          duration: typeof o.video_duration === "number" ? o.video_duration : prev?.duration,
          caption: captionOf(o) ?? prev?.caption,
          postedAt: taken ?? prev?.postedAt,
          videoUrl: videoUrlOf(o) ?? prev?.videoUrl,
        });
      }
    }
    for (const value of Object.values(o)) if (value && typeof value === "object") stack.push(value);
  }
  return into;
}

/** Подписчики аккаунта из того же JSON: объект пользователя с этим ником. */
export function followersFromJson(root: unknown, handle: string): number | null {
  const want = handle.toLowerCase();
  const stack: unknown[] = [root];
  let guard = 0;
  while (stack.length && guard++ < 200_000) {
    const node = stack.pop();
    if (!node || typeof node !== "object") continue;
    if (Array.isArray(node)) {
      for (const item of node) stack.push(item);
      continue;
    }
    const o = node as Record<string, any>;
    if (typeof o.username === "string" && o.username.toLowerCase() === want) {
      if (typeof o.follower_count === "number") return o.follower_count;
      if (typeof o.edge_followed_by?.count === "number") return o.edge_followed_by.count;
    }
    for (const value of Object.values(o)) if (value && typeof value === "object") stack.push(value);
  }
  return null;
}

/** «1.2M Followers, 300 Following, 1,234 Posts - See Instagram photos…» → 1 200 000. */
export function followersFromOg(text: string | null | undefined): number | null {
  const m = (text ?? "").match(/([\d.,]+\s*[KMB]?)\s+Followers/i);
  return m ? parseCount(m[1]) : null;
}

/** Счётчик на плитке ролика: первая строка, похожая на число («12.3K»). */
export function tileViews(text: string): number | null {
  for (const line of text.split(/\n+/).map((l) => l.trim())) {
    if (/^\d[\d.,]*\s*[KMB]?$/i.test(line)) return parseCount(line);
  }
  return null;
}

export const codeFromHref = (href: string | null | undefined): string | null => href?.match(/\/reels?\/([A-Za-z0-9_-]{5,40})/)?.[1] ?? null;

export type Tile = { href: string; text: string; pinned: boolean };

/**
 * Лента профиля по порядку плиток (свежие сверху, закреплённые первыми); числа — из JSON страницы,
 * а где его нет — с самой плитки.
 */
export function mergeReels(tiles: Tile[], media: Map<string, Media>, limit = 15): ReelStat[] {
  const out: ReelStat[] = [];
  const seen = new Set<string>();
  for (const tile of tiles) {
    const code = codeFromHref(tile.href);
    if (!code || seen.has(code)) continue;
    seen.add(code);
    const m = media.get(code);
    const views = m?.views ?? tileViews(tile.text);
    out.push({
      key: `instagram:${code}`, code, url: reelUrl(code), views: views ?? 0,
      ...(tile.pinned || m?.pinned ? { pinned: true } : {}),
      ...(m?.duration ? { duration: Math.round(m.duration * 10) / 10 } : {}),
      ...(m?.caption ? { caption: m.caption } : {}),
      ...(m?.postedAt ? { postedAt: m.postedAt } : {}),
    });
    if (out.length >= limit) break;
  }
  return out;
}

/** Shorts канала из `yt-dlp -J --flat-playlist`: подписчики и ролики. */
export function shortsFromPlaylist(json: any, limit = 15): { followers: number | null; reels: ReelStat[] } {
  const followers = typeof json?.channel_follower_count === "number" ? json.channel_follower_count : null;
  const entries: any[] = Array.isArray(json?.entries) ? json.entries : [];
  const reels: ReelStat[] = [];
  for (const e of entries) {
    if (typeof e?.id !== "string" || !/^[A-Za-z0-9_-]{6,20}$/.test(e.id)) continue;
    reels.push({
      key: `youtube:${e.id}`, code: e.id, url: shortsUrl(e.id),
      views: typeof e.view_count === "number" ? e.view_count : 0,
      ...(typeof e.duration === "number" ? { duration: e.duration } : {}),
      ...(typeof e.title === "string" && e.title.trim() ? { caption: e.title.trim() } : {}),
    });
    if (reels.length >= limit) break;
  }
  return { followers, reels };
}

export type TimedWord = { word: string; start: number; end: number };

/** Автосубтитры YouTube (json3) → слова со временем. */
export function wordsFromJson3(json: any): TimedWord[] {
  const words: TimedWord[] = [];
  for (const ev of Array.isArray(json?.events) ? json.events : []) {
    if (!Array.isArray(ev?.segs) || typeof ev.tStartMs !== "number") continue;
    const end = (ev.tStartMs + (ev.dDurationMs ?? 0)) / 1000;
    for (const seg of ev.segs) {
      const text = typeof seg?.utf8 === "string" ? seg.utf8.trim() : "";
      if (!text) continue;
      const start = (ev.tStartMs + (seg.tOffsetMs ?? 0)) / 1000;
      for (const word of text.split(/\s+/)) words.push({ word, start, end });
    }
  }
  return words.sort((a, b) => a.start - b.start);
}

/** Зацепка, как её сказали: слова первых трёх секунд (правило ig-viral). */
export const spokenHook = (words: TimedWord[], seconds = 3) => words.filter((w) => w.start < seconds).map((w) => w.word).join(" ").trim();
export const wordsText = (words: TimedWord[], maxChars = 4000) => words.map((w) => w.word).join(" ").replace(/\s+([,.!?])/g, "$1").trim().slice(0, maxChars);

type Cookie = { name: string; value: string; domain: string; path: string; expires: number; secure: boolean };

/** Куки браузера в формате Netscape для `yt-dlp --cookies`: видео Instagram отдаёт только вошедшим. */
export function netscapeCookies(cookies: Cookie[]): string {
  const lines = ["# Netscape HTTP Cookie File"];
  for (const c of cookies) {
    if (/[\t\r\n]/.test(c.name + c.value)) continue;
    const domain = c.domain;
    lines.push([domain, domain.startsWith(".") ? "TRUE" : "FALSE", c.path || "/", c.secure ? "TRUE" : "FALSE", String(c.expires > 0 ? Math.floor(c.expires) : 0), c.name, c.value].join("\t"));
  }
  return lines.join("\n") + "\n";
}
