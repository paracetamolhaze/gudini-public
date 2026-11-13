import crypto from "node:crypto";
import { chromium, type BrowserContext, type Page, type Response } from "playwright";
import { PROFILE_DIR } from "./state";
import { codeFromHref, followersFromJson, followersFromOg, mediaFromJson, mergeReels, type Tile } from "./parse";
import type { ReelStat } from "./types";

/**
 * Чтение Instagram своим браузером, как TikTok и X: отдельный постоянный профиль на Xvfb,
 * вход делает владелец сам через поток кадров. Только чтение страниц, которые открыл бы человек.
 */

export const HOME_URL = "https://www.instagram.com/";
export const LOGIN_URL = "https://www.instagram.com/accounts/login/";
export class LoginRequired extends Error {}

export async function openIgBrowser(): Promise<BrowserContext> {
  return chromium.launchPersistentContext(PROFILE_DIR, {
    headless: process.env.IG_BROWSER_HEADLESS !== "false",
    viewport: { width: 1280, height: 900 },
    // урок X: без предела кэш профиля дорастает до гигабайтов и холодный запуск висит на заставке;
    // без Service Worker страница сама ходит за JSON, и его видно в ответах
    args: [`--disk-cache-size=${256 * 1024 * 1024}`],
    serviceWorkers: "block",
    locale: "en-US",
    ...(process.env.IG_BROWSER_CHANNEL ? { channel: process.env.IG_BROWSER_CHANNEL } : {}),
  });
}

/** Чей вход: хеш ds_user_id, сам номер не храним. undefined — не вошли. */
export async function identity(context: BrowserContext): Promise<string | undefined> {
  const cookies = await context.cookies(HOME_URL);
  const uid = cookies.find((c) => c.name === "ds_user_id")?.value;
  const session = cookies.find((c) => c.name === "sessionid")?.value;
  return uid && session ? crypto.createHash("sha256").update(uid).digest("hex") : undefined;
}

export function needsLogin(page: Page): boolean {
  return /\/accounts\/login|\/challenge\/|\/accounts\/suspended|\/auth_platform\//.test(page.url());
}

/** Ник вошедшего аккаунта — по подписи его аватарки в меню; не нашли — без ника. */
export async function accountLabel(page: Page): Promise<string | undefined> {
  const alt = await page.locator('img[alt$="profile picture"]').first().getAttribute("alt", { timeout: 5000 }).catch(() => null);
  const name = alt?.match(/^(.+?)'s profile picture$/)?.[1];
  return name && /^[A-Za-z0-9._]{1,40}$/.test(name) ? name : undefined;
}

/** Человеческий темп: пауза 3–8 секунд перед каждой новой страницей. */
export const humanPause = (page: Page, min = 3000, max = 8000) => page.waitForTimeout(min + Math.random() * (max - min));

/** JSON, который страница загружает сама, пока её читают. */
function collectJson(page: Page) {
  const bodies: unknown[] = [];
  const pending: Promise<void>[] = [];
  const onResponse = (res: Response) => {
    const url = res.url();
    if (!/instagram\.com\/(?:api\/|graphql)/.test(url) || res.status() !== 200) return;
    if (!(res.headers()["content-type"] ?? "").includes("json")) return;
    pending.push(res.json().then((b) => { bodies.push(b); }, () => {}));
  };
  page.on("response", onResponse);
  return {
    bodies,
    async stop() {
      page.off("response", onResponse);
      await Promise.all(pending);
    },
  };
}

/**
 * Данные, которые Instagram кладёт прямо в HTML (script type="application/json"): первая порция роликов
 * и сам рилс часто приходят так, а не отдельным запросом. Берём только блоки с нужными полями.
 */
async function embeddedJson(page: Page): Promise<unknown[]> {
  const texts = await page.locator('script[type="application/json"]').evaluateAll((els) =>
    els.map((e) => e.textContent ?? "").filter((t) => t.length < 5_000_000 && /play_count|follower_count|video_versions|video_duration/.test(t)),
  ).catch(() => [] as string[]);
  const out: unknown[] = [];
  for (const t of texts) {
    try {
      out.push(JSON.parse(t));
    } catch {}
  }
  return out;
}

async function failIfLoggedOut(page: Page) {
  if (needsLogin(page)) throw new LoginRequired("Instagram просит вход. Войдите в браузер Instagram на странице «Тренды».");
  const wall = await page.getByText(/^(Log in|Log In)$/).first().isVisible().catch(() => false);
  const signup = await page.getByText(/^Sign up$/i).first().isVisible().catch(() => false);
  if (wall && signup) throw new LoginRequired("Instagram показал страницу входа. Войдите в браузер Instagram на странице «Тренды».");
}

/** Профиль: подписчики и последние 12–15 рилсов с просмотрами, по порядку ленты. */
export async function readProfile(page: Page, handle: string): Promise<{ followers: number | null; reels: ReelStat[] }> {
  const json = collectJson(page);
  try {
    await page.goto(`${HOME_URL}${handle}/reels/`, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await failIfLoggedOut(page);
    const missing = page.getByText(/Sorry, this page isn't available|Profile isn't available/i).first();
    const tiles = page.locator('a[href*="/reel/"]');
    await Promise.race([tiles.first().waitFor({ state: "attached", timeout: 25_000 }), missing.waitFor({ timeout: 25_000 })]).catch(() => {});
    if (await missing.isVisible().catch(() => false)) throw new Error(`Аккаунт @${handle} не найден в Instagram`);
    await failIfLoggedOut(page);
    // две неспешные прокрутки дают 15 плиток и подгружают их числа, как у человека, листающего ленту
    for (let i = 0; i < 2 && (await tiles.count()) < 15; i++) {
      await page.mouse.wheel(0, 700 + Math.random() * 400);
      await page.waitForTimeout(1800 + Math.random() * 1700);
    }
    const found: Tile[] = await tiles.evaluateAll((links) =>
      links.slice(0, 30).map((a) => ({
        href: a.getAttribute("href") ?? "",
        text: (a as HTMLElement).innerText ?? "",
        pinned: Boolean(a.querySelector('svg[aria-label*="inned"]')),
      })),
    );
    await json.stop();
    const bodies = [...(await embeddedJson(page)), ...json.bodies];
    const media = new Map();
    for (const body of bodies) mediaFromJson(body, media);
    let followers: number | null = null;
    for (const body of bodies) followers ??= followersFromJson(body, handle);
    followers ??= followersFromOg(await page.locator('meta[property="og:description"]').getAttribute("content", { timeout: 3000 }).catch(() => null));
    followers ??= await page.locator('a[href$="/followers/"] span[title]').first().getAttribute("title", { timeout: 3000 })
      .then((t) => (t ? Number(t.replace(/[^\d]/g, "")) || null : null)).catch(() => null);
    return { followers, reels: mergeReels(found, media) };
  } finally {
    await json.stop();
  }
}

/** Один рилс: подпись, длительность и ссылка на файл, которую страница отдала своему плееру. */
export async function readReel(page: Page, url: string): Promise<{ caption?: string; duration?: number; postedAt?: string; videoUrl?: string }> {
  const code = codeFromHref(new URL(url).pathname);
  const json = collectJson(page);
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await failIfLoggedOut(page);
    await page.locator("video").first().waitFor({ state: "attached", timeout: 20_000 }).catch(() => {});
    await page.waitForTimeout(1500 + Math.random() * 1500);
    await json.stop();
    const media = new Map();
    for (const body of [...(await embeddedJson(page)), ...json.bodies]) mediaFromJson(body, media);
    const m = code ? media.get(code) : undefined;
    const duration = m?.duration ?? (await page.locator("video").first().evaluate((v: HTMLVideoElement) => (Number.isFinite(v.duration) ? v.duration : null)).catch(() => null)) ?? undefined;
    const caption = m?.caption ?? (await page.locator('meta[property="og:title"]').getAttribute("content", { timeout: 3000 }).catch(() => null)) ?? undefined;
    return { caption: caption || undefined, duration: duration || undefined, postedAt: m?.postedAt, videoUrl: m?.videoUrl };
  } finally {
    await json.stop();
  }
}
