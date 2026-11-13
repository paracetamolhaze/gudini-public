/**
 * Материалы «Опус 5.5»: кусок видео с YouTube (yt-dlp, в вертикаль по человеку) и снимок страницы сайта, где нужная
 * фраза выделена жёлтым маркером. Страница снимается целиком сверху, вместе с шапкой и логотипом сайта, если фраза
 * помещается на первый экран; ниже — экран прокручен так, чтобы фраза стояла в верхней трети (субтитры — ниже).
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { ffmpeg, python, run } from "../pipeline/util";

/** Кусок ролика [from, to] в вертикали 1080×1920; band — полоса кадра по высоте без плашек телеканала; null — не скачался. */
export async function footage(url: string, from: number, to: number, out: string, signal?: AbortSignal, band?: { top: number; bottom: number }): Promise<string | null> {
  const raw = out.replace(/\.mp4$/, ".src.mp4");
  fs.rmSync(raw, { force: true });
  try {
    await run("yt-dlp", ["--no-warnings", "-q", "--no-playlist", "-f", "bv*[height<=1080]+ba/b", "--merge-output-format", "mp4", "--max-filesize", "300M",
      "--download-sections", `*${from.toFixed(1)}-${to.toFixed(1)}`, "--force-keyframes-at-cuts", "-o", raw, url], { timeoutMs: 300_000, signal });
  } catch {
    return null;
  }
  if (!fs.existsSync(raw)) return null;
  const { stdout } = await run("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", raw]);
  const [w, h] = stdout.trim().split(",").map(Number);
  if (!(w > 0 && h > 0)) return null;
  // плашки телеканала (бегущая строка, подписи, курсы) — за краем: остаётся полоса чистой картинки
  let src = raw;
  let [cw, ch] = [w, h];
  if (band && band.bottom - band.top < 0.97) {
    const cut = out.replace(/.mp4$/, ".band.mp4");
    ch = Math.round((h * (band.bottom - band.top)) / 2) * 2;
    await ffmpeg(["-i", raw, "-vf", `crop=${w}:${ch}:0:${Math.round(h * band.top)}`, "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "16", cut], signal);
    src = cut;
  }
  // горизонтальный — рамка на человеке на каждом плане (как у роликов героя в «Новостях»), потом в 1080×1920
  if (cw > ch * 1.05) {
    const vert = out.replace(/\.mp4$/, ".v.mp4");
    try {
      await python("vertical.py", [src, vert], signal);
      src = vert;
    } catch {
      // рамка не нашлась — середина кадра
    }
  }
  await ffmpeg(["-i", src, "-vf", "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=30", "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p", out], signal);
  return fs.existsSync(out) ? out : null;
}

const VW = 400;
const VH = 711;
const DPR = 2.7;
// реклама, cookie-окна, всплывашки и панель Wayback Machine — не часть страницы, которую показываем
const HIDE = `iframe,[id^="google_ads"],[id*="adfox" i],[class*="adfox" i],[id*="yandex_rtb" i],[class*="yandex_rtb" i],[class*="advert" i],[class*="ad-slot" i],[id*="cookie" i],[class*="cookie" i],[id*="consent" i],[class*="consent" i],#onetrust-banner-sdk,[class*="popup" i],[class*="modal" i],[class*="push-subscr" i],#wm-ipp-base,#wm-ipp,#donato,[id*="privacy-banner" i],[class*="privacy-banner" i],[id*="fides" i],[class*="fides-" i],[id*="didomi" i],[id^="sp_message" i],[class*="cmp-" i],[id*="gdpr" i],[class*="gdpr" i]{display:none!important}html,body{overflow:auto!important;overflow-y:auto!important;height:auto!important;position:static!important}`;

/** Поиск фразы и маркер в тексте страницы (mark.js выполняется в самой странице). */
const MARK = fs.readFileSync(path.join(import.meta.dirname, "mark.js"), "utf8").replace(/^\/\/.*$/gm, "").trim();
// маркер под текстом фразы; свёрнутые разделы мобильной Википедии раскрыты — фраза бывает в них
const MARK_CSS = `.opus-mark{background:linear-gradient(transparent 8%,rgba(255,225,77,.85) 8%,rgba(255,225,77,.85) 92%,transparent 92%)!important;color:inherit!important;border-radius:3px;box-decoration-break:clone;-webkit-box-decoration-break:clone}.collapsible-block{display:block!important}`;

type Browser = { newContext: (o: object) => Promise<{ newPage: () => Promise<Page>; close: () => Promise<void> }>; close: () => Promise<void> };
type Page = {
  goto: (u: string, o: object) => Promise<unknown>;
  addStyleTag: (o: object) => Promise<unknown>;
  evaluate: <T>(fn: string, arg?: unknown) => Promise<T>;
  waitForTimeout: (ms: number) => Promise<void>;
  screenshot: (o: object) => Promise<Buffer>;
  title: () => Promise<string>;
};

let browser: Promise<Browser> | null = null;
function chromium(): Promise<Browser> {
  if (!browser) {
    // playwright с установленным Chromium — в node_modules основной папки gudini
    const root = process.env.OPUS_PLAYWRIGHT_ROOT || "C:/Users/user/Desktop/gudini";
    const req = createRequire(path.join(root, "node_modules", "x.js"));
    const { chromium } = req("playwright") as { chromium: { launch: (o: object) => Promise<Browser> } };
    browser = chromium.launch({ headless: true });
    browser.catch(() => (browser = null));
  }
  return browser;
}

export async function closeBrowser() {
  const b = browser;
  browser = null;
  if (b) await (await b).close().catch(() => {});
}

/** Снимок страницы 1080×1920 с фразой под маркером; null — страница не открылась или фразы на ней нет. */
/**
 * sweep — для маркера, который проводится на глазах (engine Swept): тот же снимок без маркера и строки маркера в
 * пикселях снимка, по порядку чтения. Нет его — маркер уже нарисован на снимке, как раньше.
 */
export type Shot = { file: string; markY: number; sweep?: { base: string; rects: { x: number; y: number; w: number; h: number }[] } };

export async function screen(url: string, phrase: string, out: string): Promise<Shot | null> {
  // мобильная версия сайта; не нашлась фраза — та же узкая страница с обычным браузером (у мобильной Википедии разделы
  // приходят не целиком)
  return (await shoot(url, phrase, out, true)) ?? (await shoot(url, phrase, out, false));
}

async function shoot(url: string, phrase: string, out: string, mobile: boolean): Promise<Shot | null> {
  const b = await chromium();
  const ctx = await b.newContext({
    viewport: { width: VW, height: VH }, deviceScaleFactor: DPR, isMobile: mobile, hasTouch: mobile, locale: "ru-RU", ignoreHTTPSErrors: true,
    ...(mobile ? { userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36" } : {}),
  });
  try {
    const page = await ctx.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.waitForTimeout(3500);
    await page.addStyleTag({ content: HIDE + MARK_CSS });
    // прилипшие окна про cookie и приватность без узнаваемых классов (The Defiant, 5.11) — по тексту
    await page.evaluate(`[...document.querySelectorAll("body *")].filter((e) => /^(fixed|sticky)$/.test(getComputedStyle(e).position) && /cookie|privacy|consent|куки|конфиденциальн|datenschutz/i.test(e.textContent || "") && (e.textContent || "").length < 2000).forEach((e) => e.remove())`);
    // ленивые картинки подгружаются до разметки, чтобы строки потом не съезжали
    await page.evaluate("window.scrollTo(0, 2500)");
    await page.waitForTimeout(800);
    await page.evaluate("window.scrollTo(0, 0)");
    await page.waitForTimeout(500);
    if (!(await page.evaluate<boolean>(`(${MARK})(${JSON.stringify(phrase)})`))) return null;
    await page.waitForTimeout(300);
    const top = await page.evaluate<number>(`Math.min(...[...document.querySelectorAll(".opus-mark")].map((m) => m.getBoundingClientRect().top + scrollY))`);
    // фраза на первом экране — снимок сверху, с шапкой сайта; ниже — фраза в верхней трети экрана. Прокручивается то, что
    // прокручивается у этой страницы: у части сайтов это не окно, а внутренний блок (BTC-ECHO)
    if (top >= VH * 0.62)
      await page.evaluate(`(() => {
        const m = document.querySelector(".opus-mark");
        m.scrollIntoView({ block: "start" });
        for (let x = m.parentElement; x && x !== document.body; x = x.parentElement) {
          const s = getComputedStyle(x);
          if (/(auto|scroll)/.test(s.overflowY) && x.scrollHeight > x.clientHeight) { x.scrollTop -= ${Math.round(VH * 0.3)}; return; }
        }
        window.scrollBy(0, -${Math.round(VH * 0.3)});
      })()`);
    await page.waitForTimeout(900);
    // место маркера — после прокрутки, по самой странице (шапка-липучка и подгрузка двигают строки)
    const y = await page.evaluate<number>(`Math.min(...[...document.querySelectorAll(".opus-mark")].map((m) => m.getBoundingClientRect().top))`);
    if (!(y >= 0 && y < VH)) return null;
    const png = await page.screenshot({ type: "png" });
    fs.writeFileSync(out, png);
    // строки маркера и тот же снимок без него — чтобы маркер провели по строке, когда план уже в кадре. Куски одной
    // строки (ссылка внутри фразы — отдельный узел) склеиваются; что-то не сошлось — снимок остаётся с готовым маркером
    let sweep: Shot["sweep"];
    try {
      const raw = await page.evaluate<{ x: number; y: number; w: number; h: number }[]>(`[...document.querySelectorAll(".opus-mark")].flatMap((m) => [...m.getClientRects()]).map((r) => ({ x: r.left, y: r.top, w: r.width, h: r.height })).filter((r) => r.w > 2 && r.h > 2 && r.y >= 0 && r.y + r.h <= ${VH} && r.x >= 0 && r.x + r.w <= ${VW})`);
      const rows: typeof raw = [];
      for (const r of [...raw].sort((a, b) => a.y - b.y || a.x - b.x)) {
        const row = rows.find((q) => Math.abs(q.y + q.h / 2 - (r.y + r.h / 2)) < Math.min(q.h, r.h) / 2);
        if (!row) rows.push({ ...r });
        else {
          const [x0, x1, y0, y1] = [Math.min(row.x, r.x), Math.max(row.x + row.w, r.x + r.w), Math.min(row.y, r.y), Math.max(row.y + row.h, r.y + r.h)];
          Object.assign(row, { x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
        }
      }
      if (rows.length >= 1 && rows.length <= 6) {
        await page.addStyleTag({ content: ".opus-mark{background:none!important}" });
        await page.waitForTimeout(120);
        const base = out.replace(/.png$/, ".base.png");
        fs.writeFileSync(base, await page.screenshot({ type: "png" }));
        sweep = { base, rects: rows.sort((a, b) => a.y - b.y).map((r) => ({ x: Math.floor(r.x * DPR) - 2, y: Math.floor(r.y * DPR) - 2, w: Math.ceil(r.w * DPR) + 4, h: Math.ceil(r.h * DPR) + 4 })) };
      }
    } catch {
      sweep = undefined;
    }
    return { file: out, markY: Math.round(y * DPR), ...(sweep ? { sweep } : {}) };
  } catch (error) {
    if (process.env.OPUS_DEBUG) console.error(`снимок ${url}:`, error);
    return null;
  } finally {
    await ctx.close().catch(() => {});
  }
}
