import type { Page } from "playwright";
import { XLayoutChanged } from "./pages.js";

export interface ProfileFollowers {
  followers: number;
  approximate: boolean;
}

const LABEL = "(?:followers?|подписчик[а-яё]*|читател[а-яё]*)";
const EXACT_COUNT = new RegExp(`^(\\d+|\\d{1,3}(?:[, .\\u00a0\\u202f]\\d{3})+)(?:\\s*${LABEL})?$`, "iu");
const COMPACT_COUNT = new RegExp(`^(\\d+(?:[.,]\\d+)?)\\s*(k|m|b|тыс\\.?|млн\\.?|млрд\\.?)(?:\\s*${LABEL})?$`, "iu");

/** Exact displayed integers remain exact; rounded locale abbreviations are explicitly marked. */
export function parseFollowerCount(text: string): ProfileFollowers | null {
  const value = text.trim();
  const exact = value.match(EXACT_COUNT);
  if (exact) {
    const followers = Number(exact[1]!.replace(/[, .\u00a0\u202f]/g, ""));
    return Number.isSafeInteger(followers) ? { followers, approximate: false } : null;
  }
  const compact = value.match(COMPACT_COUNT);
  if (!compact) return null;
  const suffix = compact[2]!.toLowerCase();
  const multiplier = /^(b|млрд)/u.test(suffix) ? 1_000_000_000 : /^(m|млн)/u.test(suffix) ? 1_000_000 : 1_000;
  const followers = Math.round(Number(compact[1]!.replace(",", ".")) * multiplier);
  return Number.isSafeInteger(followers) && followers >= 0 ? { followers, approximate: true } : null;
}

/** Read only the verified owner's profile header, never timeline cards or sidebar recommendations. */
export async function readProfileFollowers(page: Page, username: string, opts: { timeoutMs?: number } = {}): Promise<ProfileFollowers> {
  if (!/^[A-Za-z0-9_]{1,15}$/.test(username)) throw new XLayoutChanged("Некорректное имя профиля X: подписчики не прочитаны");
  const profile = new URL(page.url());
  if (profile.protocol !== "https:" || profile.hostname !== "x.com" || profile.pathname.replace(/\/$/, "").toLowerCase() !== `/${username.toLowerCase()}`) {
    throw new XLayoutChanged("X открыл другой профиль: подписчики не прочитаны");
  }
  const candidates = await page.waitForFunction(({ owner }) => {
    if (location.protocol !== "https:" || location.hostname !== "x.com" || location.pathname.replace(/\/$/, "").toLowerCase() !== `/${owner}`) return null;
    const scope = document.querySelector('[data-testid="primaryColumn"]') ?? document.querySelector("main");
    if (!scope) return null;
    const links = Array.from(scope.querySelectorAll<HTMLAnchorElement>("a[href]")).filter(link => {
      if (link.closest('article, aside, [role="complementary"], [data-testid="sidebarColumn"], [data-testid="UserCell"]')) return false;
      if (!link.getClientRects().length || getComputedStyle(link).visibility === "hidden") return false;
      const target = new URL(link.href, location.href);
      return target.hostname === "x.com" && [`/${owner}/followers`, `/${owner}/verified_followers`].includes(target.pathname.replace(/\/$/, "").toLowerCase());
    });
    const rows = links.map(link => ({
      text: link.innerText,
      titles: [link.getAttribute("title"), ...Array.from(link.querySelectorAll("[title]"), element => element.getAttribute("title"))].filter((title): title is string => title !== null),
    }));
    // The link can mount before its profile data; give the counter the same bounded paint window.
    return rows.some(row => /\d/.test(row.text) || row.titles.some(title => /\d/.test(title))) ? rows : null;
  }, { owner: username.toLowerCase() }, { timeout: opts.timeoutMs ?? 10_000 }).catch(() => {
    throw new XLayoutChanged("X не показал счётчик подписчиков нашего профиля");
  });
  const rows = await candidates.jsonValue();
  await candidates.dispose();
  if (!rows) throw new XLayoutChanged("X не показал счётчик подписчиков нашего профиля");
  // A tooltip can contain the full integer while the visible label is rounded (e.g. 1.2K).
  const titles = rows.flatMap(row => row.titles).map(parseFollowerCount).filter((count): count is ProfileFollowers => count !== null);
  const text = rows.map(row => parseFollowerCount(row.text)).filter((count): count is ProfileFollowers => count !== null);
  const choices = titles.filter(count => !count.approximate);
  if (!choices.length) choices.push(...text.filter(count => !count.approximate));
  if (!choices.length) choices.push(...titles, ...text);
  const chosen = choices[0];
  if (!chosen || choices.some(count => count.followers !== chosen.followers)) throw new XLayoutChanged("X не показал однозначное число подписчиков нашего профиля");
  return chosen;
}
