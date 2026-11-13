import fs from "fs";
import type { Browser, Page } from "playwright";
import type { SidContent } from "./types";
import { coverHtml, finalHtml, SID_H, SID_W, stepHtml, type SidLook, type StepShot } from "./html";

/**
 * Сборка слайдов в Chromium: каждый слайд — PNG 1080×1350. Перед снимком
 * вёрстка подгоняется (кегль обложки и финала, отступ текста шага, плотность плашек), а всё,
 * что не поместилось, возвращается списком: такой текст Claude сокращает и слайды собираются заново.
 */

let browser: Browser | null = null;
let launching: Promise<Browser> | null = null;
let holders = 0;

/** Задания идут параллельно и делят один браузер: два одновременных запроса не запускают два Chromium. */
export async function sidBrowser(): Promise<Browser> {
  if (browser?.isConnected()) return browser;
  if (!launching) launching = launchSidBrowser().finally(() => (launching = null));
  return launching;
}

/**
 * Задание держит общий браузер, пока работает, и отпускает его в конце: закрывается он, когда отпустило
 * последнее задание, — иначе закончившаяся карусель закрыла бы браузер посреди соседней.
 */
export function holdSidBrowser(): () => Promise<void> {
  holders++;
  let released = false;
  return async () => {
    if (released) return;
    released = true;
    holders--;
    if (holders === 0) await closeSidBrowser();
  };
}

async function launchSidBrowser(): Promise<Browser> {
  const { chromium } = await import("playwright");
  const args = ["--disable-gpu", "--disable-dev-shm-usage", "--no-first-run", "--no-default-browser-check", "--disable-extensions", "--mute-audio"];
  if (process.platform === "linux") args.push("--no-sandbox");
  const explicit = process.env.CAROUSEL_BROWSER;
  const fallbacks = process.platform === "win32" ? ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"] : [];
  const candidates: (string | undefined)[] = explicit ? [explicit] : [undefined, ...fallbacks.filter((p) => fs.existsSync(p))];
  let last: unknown;
  for (const executablePath of candidates) {
    try {
      browser = await chromium.launch({ headless: true, executablePath, args, timeout: 60_000 });
      return browser;
    } catch (e) {
      last = e;
    }
  }
  throw new Error(`Не удалось запустить браузер: ${String((last as any)?.message ?? last).split("\n")[0].slice(0, 240)}`);
}

export async function closeSidBrowser(): Promise<void> {
  const b = browser;
  browser = null;
  try {
    await b?.close();
  } catch {}
}

/*
 * Подгонка выполняется в странице. Это строки, а не функции: обработчик заданий идёт через tsx, а его
 * сборщик дописывает в тела функций свои помощники (__name), которых в странице нет.
 */

const FIT_COVER = `(() => {
  const p = [];
  const t = document.getElementById("t");
  const room = t.clientWidth;
  const lines = [...t.querySelectorAll(".hx")];
  let fs = parseFloat(getComputedStyle(lines[0]).fontSize);
  const widest = () => Math.max(0, ...lines.map((l) => l.scrollWidth));
  while (fs > 96 && widest() > room) { fs -= 2; lines.forEach((l) => (l.style.fontSize = fs + "px")); }
  lines.forEach((l) => { if (l.scrollWidth > room) p.push("cover.title: строка «" + l.textContent + "» не помещается крупным шрифтом; оставь 1–2 коротких слова"); });
  const ac = document.getElementById("ac");
  let as = 70;
  while (as > 46 && ac.scrollWidth > room) { as -= 2; ac.style.fontSize = as + "px"; }
  if (ac.scrollWidth > room) p.push("cover.accentLine: не помещается в одну строку; оставь главную цифру");
  if (document.getElementById("wrap").getBoundingClientRect().top < 560) p.push("cover: текста на обложке слишком много");
  return { problems: p, info: "обложка " + fs + "/" + as + "px" };
})()`;

const FIT_STEP = `(() => {
  const p = [];
  const t = document.getElementById("ttl");
  let tf = 72;
  while (t.scrollWidth > t.clientWidth + 1 && tf > 60) { tf -= 2; t.style.fontSize = tf + "px"; }
  const r = t.getBoundingClientRect();
  const lines = Math.round(r.height / (tf * 1.03));
  if (lines > 2) p.push("title: " + lines + " строки вместо двух");
  const body = document.getElementById("body");
  body.style.top = Math.max(r.bottom + 46, 488) + "px";
  if (body.getBoundingClientRect().bottom > 640) p.push("body: текст не помещается над окном");
  const lab = document.getElementById("lab");
  if (lab.scrollWidth > lab.clientWidth + 1) p.push("label: ярлык длиннее строки");
  const nx = document.getElementById("next");
  const pads = ["0 28px", "0 22px", "0 18px", "0 16px"];
  const spacing = [".2em", ".12em", ".06em", ".04em"];
  for (let k = 0; k < 4 && nx.getBoundingClientRect().right > 999.5; k++) {
    document.querySelectorAll(".pill").forEach((e) => { e.style.padding = pads[k]; });
    document.querySelectorAll(".pk").forEach((e) => { e.style.letterSpacing = spacing[k]; });
  }
  if (nx.getBoundingClientRect().right > 999.5) p.push("pills/next: плашки и «Далее» не помещаются в строку");
  return { problems: p, info: "заголовок " + tf + "px, " + lines + " стр." };
})()`;

const FIT_FINAL = `(() => {
  const p = [];
  const big = document.getElementById("big");
  const want = big.querySelectorAll("br").length + 1;
  let fs = 94;
  const tall = () => big.getBoundingClientRect().height > want * fs * 1.02;
  while (fs > 60 && (big.clientWidth < big.scrollWidth || tall())) { fs -= 2; big.style.fontSize = fs + "px"; }
  if (tall()) p.push("final: строки заголовка не помещаются");
  const cards = document.getElementById("cards");
  cards.style.top = (big.getBoundingClientRect().bottom + 70) + "px";
  document.querySelectorAll(".cx").forEach((x, i) => { if (x.scrollWidth > x.clientWidth + 1) p.push("final.cards[" + i + "]: текст карточки не помещается"); });
  const fb = document.getElementById("fb");
  fb.style.top = (cards.getBoundingClientRect().bottom + 64) + "px";
  if (fb.getBoundingClientRect().bottom > 1215) p.push("final.body: текст не помещается над подвалом");
  return { problems: p, info: "финал " + fs + "px" };
})()`;

type Fit = { problems: string[]; info: string };

export type RenderedSlide = { png: Buffer; problems: string[]; info: string };

async function shoot(page: Page, html: string, fit: string): Promise<RenderedSlide> {
  await page.setViewportSize({ width: SID_W, height: SID_H });
  await page.setContent(html, { waitUntil: "load", timeout: 60_000 });
  await page.evaluate("document.fonts.ready.then(() => true)");
  const result = (await page.evaluate(fit)) as Fit;
  const png = await page.screenshot({ type: "png", animations: "disabled", caret: "hide" });
  return { png, problems: result.problems, info: result.info };
}

/** Все девять слайдов по порядку: обложка, семь шагов, финал. Проблемы помечены номером слайда и полем. */
export async function renderSid(content: SidContent, look: SidLook, coverDataUrl: string, shots: StepShot[]): Promise<{ slides: RenderedSlide[]; problems: string[] }> {
  const b = await sidBrowser();
  const page = await b.newPage({ viewport: { width: SID_W, height: SID_H }, deviceScaleFactor: 1 });
  try {
    const slides: RenderedSlide[] = [];
    slides.push(await shoot(page, coverHtml(content, look, coverDataUrl), FIT_COVER));
    for (let i = 0; i < content.steps.length; i++) {
      const r = await shoot(page, stepHtml(content.steps[i], i, look, shots[i]), FIT_STEP);
      r.problems = r.problems.map((x) => `steps[${i}].${x}`);
      slides.push(r);
    }
    slides.push(await shoot(page, finalHtml(content, look), FIT_FINAL));
    return { slides, problems: slides.flatMap((s) => s.problems) };
  } finally {
    await page.close().catch(() => {});
  }
}
