import sharp from "sharp";
import type { Browser } from "playwright";
import { articleCardHtml, SHOT_H, SHOT_W } from "./html";
import { hostOf } from "./content";

/**
 * Окно шага — настоящая страница источника. Chromium открывает её в узком окне (900 px — заголовок
 * крупнее), прячет баннеры, рекламу и закреплённые шапки, находит заголовок статьи и снимает кусок
 * страницы с ним в пропорции окна. Края кадра двигаются так, чтобы не резать строку пополам.
 * Если страница не отдалась (Cloudflare, вход, пустая), рисуется карточка статьи из её заголовка,
 * описания и картинки: пустых окон не бывает.
 */

export const SHOT_OUT_W = SHOT_W * 2;
export const SHOT_OUT_H = SHOT_H * 2;
const VIEW_W = 900;
const VIEW_H = 1400;
const ASPECT = SHOT_W / SHOT_H;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

const HIDE_CSS = `#onetrust-banner-sdk,#onetrust-consent-sdk,.fc-consent-root,[id*="cookie" i],[class*="cookie-banner" i],[class*="CookieBanner" i],[class*="consent" i],[id*="consent" i],[aria-label*="cookie" i],[class*="newsletter-modal" i],[class*="Modal_overlay" i],iframe,[id^="google_ads"],[id*="-ad-" i],[class*="ad-slot" i],[class*="adslot" i],[class*="advert" i],[class*="paywall" i],[class*="countdown" i],[data-testid*="banner" i],[class*="promo-banner" i],[class*="piano" i],[id*="piano" i]{display:none!important} html,body{overflow:auto!important}`;
/** Всплывашки, у которых нет узнаваемого класса: прячем по тексту. */
const HIDE_TEXTS = ["articles remaining", "Countdown to Consensus", "Accept all cookies", "We use cookies", "Subscribe to our newsletter", "Sign up for our newsletter"];

const BLOCKED = /just a moment|attention required|access denied|are you a robot|verify you are human|captcha|enable javascript and cookies|403 forbidden|404 not found|page not found|subscribe to continue|please log ?in to/i;

export type PageMeta = { title: string; description: string; image: string; site: string; date: string };
export type ShotResult = { kind: "page" | "card"; png: Buffer; dark: boolean; text: string; note?: string };

const PAGE_SCRIPT = `(() => {
  const meta = (k) => (document.querySelector('meta[property="' + k + '"],meta[name="' + k + '"]') || {}).content || "";
  const m = { title: meta("og:title") || document.title || "", description: meta("og:description") || meta("description"), image: meta("og:image") || meta("twitter:image"), site: meta("og:site_name"), date: meta("article:published_time") || meta("datePublished") };
  // текст статьи для проверки фактов: самый длинный из article/main, а если он короткий — вся страница
  const blocks = [...document.querySelectorAll("article, main, [role=main]")].map((e) => e.innerText || "").sort((x, y) => y.length - x.length);
  const longest = blocks[0] || "";
  const text = (longest.length > 1500 ? longest : (document.body && document.body.innerText) || longest).replace(/\\s+\\n/g, "\\n").slice(0, 16000);
  const norm = (s) => s.toLowerCase().replace(/[^\\p{L}\\p{N}]+/gu, " ").trim();
  const og = norm(m.title);
  const visible = (e) => { const r = e.getBoundingClientRect(); const st = getComputedStyle(e); return r.width > 200 && r.height > 20 && st.visibility !== "hidden" && st.display !== "none"; };
  const inChrome = (e) => Boolean(e.closest("nav,footer,aside,[role=navigation]"));
  let best = null, bestScore = -1;
  const cands = [...document.querySelectorAll("h1,h2,[class*=headline i],[class*=title i]")].slice(0, 400);
  for (const e of cands) {
    const t = (e.innerText || "").trim();
    if (t.length < 12 || t.length > 320 || !visible(e) || inChrome(e)) continue;
    const r = e.getBoundingClientRect();
    const top = r.top + scrollY;
    if (top > 3000) continue;
    const size = parseFloat(getComputedStyle(e).fontSize) || 0;
    if (size < 20) continue;
    const n = norm(t);
    const match = og && (og.includes(n.slice(0, 40)) || n.includes(og.slice(0, 40))) ? 40 : 0;
    const score = size + match + (e.tagName === "H1" ? 20 : 0) - top / 200;
    if (score > bestScore) { bestScore = score; best = { left: r.left, top, width: r.width, height: r.height, size }; }
  }
  return { meta: m, text, headline: best, title: document.title || "", bodyLength: (document.body && document.body.innerText || "").length, docHeight: document.documentElement.scrollHeight };
})()`;

// Плавающие шапки, меню и окна прячутся без сдвига вёрстки: если убрать их из потока (display: none),
// на части сайтов (360.ru) съезжает вся страница и подвал встаёт на заголовок. Прогоняется и после
// прокрутки к заголовку: многие сайты показывают свои плашки только при прокрутке.
const HIDE_FIXED = `(() => {
  for (const e of document.querySelectorAll("body *")) {
    const st = getComputedStyle(e);
    if (st.position === "fixed" || st.position === "sticky" || (e.tagName === "DIALOG" && e.open)) e.style.setProperty("visibility", "hidden", "important");
  }
  return true;
})()`;

const hideByText = (needle: string) => `(() => {
  const needle = ${JSON.stringify(needle)};
  for (const e of [...document.querySelectorAll("body *")].filter((x) => x.children.length < 6 && (x.textContent || "").includes(needle))) {
    let n = e;
    while (n && n !== document.body) { const st = getComputedStyle(n); if (st.position === "fixed" || st.position === "sticky") break; n = n.parentElement; }
    (n && n !== document.body ? n : e).style.setProperty("display", "none", "important");
  }
  return true;
})()`;

/** Кадр вокруг заголовка в координатах страницы (CSS-пиксели). */
export function cropAround(h: { left: number; top: number; width: number }, viewW = VIEW_W): { x: number; y: number; w: number; h: number } {
  const pad = 24;
  const w = Math.round(Math.min(viewW, Math.max(600, h.width + 2 * pad)));
  const x = Math.round(Math.max(0, Math.min(viewW - w, h.left - pad)));
  const hh = Math.round(w / ASPECT);
  const y = Math.round(Math.max(0, h.top - 0.16 * hh));
  return { x, y, w, h: hh };
}

/**
 * Сдвиг кадра по вертикали внутри снятой полосы так, чтобы верхний и нижний края шли по пустому
 * месту, а не по строке. gray — яркость, по строке на пиксель; slack — запас полосы сверху и снизу.
 */
export function cleanOffset(gray: Uint8Array, width: number, rows: number, height: number, slack: number): number {
  const blankRow = (y: number) => {
    let sum = 0;
    let sq = 0;
    for (let x = 0; x < width; x++) {
      const v = gray[y * width + x];
      sum += v;
      sq += v * v;
    }
    const mean = sum / width;
    return sq / width - mean * mean < 16;
  };
  const blank = (y: number) => [0, 1, 2, 3].every((k) => y + k < rows && blankRow(y + k));
  const options = Array.from({ length: 2 * slack + 1 }, (_, i) => i).sort((a, b) => Math.abs(a - slack) - Math.abs(b - slack));
  for (const dy of options) {
    if (dy + height > rows) continue;
    if (blank(dy) && blank(dy + height - 4)) return dy;
  }
  return slack;
}

async function finish(png: Buffer): Promise<{ png: Buffer; dark: boolean; flat: boolean }> {
  const img = sharp(png).resize(SHOT_OUT_W, SHOT_OUT_H, { fit: "cover", position: "top" });
  const out = await img.png().toBuffer();
  const stats = await sharp(out).greyscale().stats();
  const ch = stats.channels[0];
  return { png: out, dark: ch.mean < 95, flat: ch.stdev < 9 };
}

async function fetchMeta(url: string): Promise<PageMeta | null> {
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "text/html" }, redirect: "follow", signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return null;
    const html = (await res.text()).slice(0, 600_000);
    const pick = (k: string) => {
      const m = new RegExp(`<meta[^>]+(?:property|name)=["']${k}["'][^>]*content=["']([^"']*)["']`, "i").exec(html) ?? new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${k}["']`, "i").exec(html);
      return m ? m[1].replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim() : "";
    };
    const title = pick("og:title") || (/<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1] ?? "").trim();
    if (!title || BLOCKED.test(title)) return null;
    return { title, description: pick("og:description") || pick("description"), image: pick("og:image") || pick("twitter:image"), site: pick("og:site_name"), date: pick("article:published_time") };
  } catch {
    return null;
  }
}

async function fetchImageDataUrl(url: string): Promise<string | undefined> {
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(15_000) });
    const type = res.headers.get("content-type") ?? "";
    if (!res.ok || !/^image\//.test(type)) return undefined;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > 8_000_000) return undefined;
    const jpg = await sharp(buf).resize(600, 620, { fit: "cover" }).jpeg({ quality: 85 }).toBuffer();
    return `data:image/jpeg;base64,${jpg.toString("base64")}`;
  } catch {
    return undefined;
  }
}

/** Карточка статьи 956×378 (снимается вдвое крупнее). */
export async function renderArticleCard(browser: Browser, card: { url: string; title: string; description: string; date?: string; image?: string }): Promise<Buffer> {
  const page = await browser.newPage({ viewport: { width: SHOT_W, height: SHOT_H }, deviceScaleFactor: 2 });
  try {
    const imageDataUrl = card.image ? await fetchImageDataUrl(card.image) : undefined;
    const date = card.date && /^\d{4}-\d{2}-\d{2}/.test(card.date) ? card.date.slice(0, 10) : card.date;
    await page.setContent(articleCardHtml({ host: hostOf(card.url), title: card.title, description: card.description, date, imageDataUrl }), { waitUntil: "load" });
    await page.evaluate(`(() => { const h = document.getElementById("h"); let s = 34; while (s > 22 && h.scrollHeight > h.clientHeight + 1) { s -= 2; h.style.setProperty("--hs", s + "px"); h.style.fontSize = s + "px"; } return true; })()`);
    return await page.screenshot({ type: "png" });
  } finally {
    await page.close().catch(() => {});
  }
}

/**
 * Снимок страницы источника. fallback — заголовок и издатель из исследования: из них карточка
 * собирается, даже когда страница и её метаданные недоступны.
 */
export async function captureSource(browser: Browser, url: string, fallback: { title: string; publisher: string }): Promise<ShotResult> {
  const context = await browser.newContext({ viewport: { width: VIEW_W, height: VIEW_H }, deviceScaleFactor: 2, locale: "en-US", timezoneId: "UTC", userAgent: UA, ignoreHTTPSErrors: true });
  let meta: PageMeta | null = null;
  let text = "";
  let note = "";
  try {
    const page = await context.newPage();
    await page.route(/\.(mp4|webm|m3u8)(\?|$)/i, (r) => r.abort());
    const res = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 }).catch((e) => {
      note = `страница не открылась: ${String(e?.message ?? e).split("\n")[0].slice(0, 120)}`;
      return null;
    });
    if (res && res.status() >= 400) note = `страница ответила ${res.status()}`;
    if (res && !note) {
      await page.waitForTimeout(3500);
      await page.addStyleTag({ content: HIDE_CSS }).catch(() => {});
      for (const t of HIDE_TEXTS) await page.evaluate(hideByText(t)).catch(() => {});
      await page.evaluate(HIDE_FIXED).catch(() => {});
      const info = (await page.evaluate(PAGE_SCRIPT)) as { meta: PageMeta; text: string; headline: { left: number; top: number; width: number; height: number } | null; title: string; bodyLength: number };
      meta = info.meta;
      text = info.text;
      const blocked = BLOCKED.test(info.title) || BLOCKED.test(info.text.slice(0, 1500)) || info.bodyLength < 300;
      if (blocked) note = "страница закрыта проверкой или пустая";
      else if (!info.headline) note = "на странице не найден заголовок";
      else {
        const crop = cropAround(info.headline);
        const slack = 36;
        await page.evaluate(`window.scrollTo(0, ${Math.max(0, crop.y - slack - 80)})`);
        await page.waitForTimeout(1500);
        await page.evaluate(HIDE_FIXED).catch(() => {});
        const scrollY = (await page.evaluate("window.scrollY")) as number;
        const top = crop.y - slack - scrollY;
        const band = await page.screenshot({ type: "png", clip: { x: crop.x, y: Math.max(0, top), width: crop.w, height: crop.h + 2 * slack } });
        const raw = await sharp(band).greyscale().raw().toBuffer({ resolveWithObject: true });
        const scale = raw.info.width / crop.w;
        const dy = cleanOffset(new Uint8Array(raw.data), raw.info.width, raw.info.height, Math.round(crop.h * scale), Math.round(slack * scale));
        const cut = await sharp(band).extract({ left: 0, top: dy, width: raw.info.width, height: Math.min(raw.info.height - dy, Math.round(crop.h * scale)) }).png().toBuffer();
        const done = await finish(cut);
        if (!done.flat) return { kind: "page", png: done.png, dark: done.dark, text };
        note = "снимок страницы получился пустым";
      }
    }
  } catch (e: any) {
    note = `сбой съёмки: ${String(e?.message ?? e).split("\n")[0].slice(0, 120)}`;
  } finally {
    await context.close().catch(() => {});
  }
  // запасной путь: карточка статьи из метаданных страницы или, если их нет, из исследования
  const m = meta?.title && !BLOCKED.test(meta.title) ? meta : await fetchMeta(url);
  const card = await renderArticleCard(browser, {
    url,
    title: m?.title || fallback.title || fallback.publisher || hostOf(url),
    description: m?.description ?? "",
    date: m?.date,
    image: m?.image ? new URL(m.image, url).toString() : undefined,
  });
  const done = await finish(card);
  return { kind: "card", png: done.png, dark: false, text: [m?.title, m?.description, text].filter(Boolean).join("\n").slice(0, 16000), note: note || "карточка статьи" };
}
