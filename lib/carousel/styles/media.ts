import sharp from "sharp";
import type { Browser } from "playwright";
import { nativeImageBridge } from "../../codexImageClient";
import { sidClaude } from "../sid/claude";
import { REAL_PHOTO } from "../sid/cover";
import { extractJson } from "../sid/content";
import type { HeatPeriod, HeatTile } from "./types";

/**
 * Картинки и снимки для шести стилей. Правило владельца (01.11): картинка — снимок фоторепортёра,
 * естественный свет, приглушённые цвета, без неона, свечения, огня, дыма и красного перекраса кадра;
 * мульт — мультяшный, но тоже без зарева. Готовую картинку смотрит Claude и отправляет на новую попытку,
 * если с первого взгляда видно ИИ.
 */

export type ImageKind = "photo" | "cartoon" | "scheme";

export const PHOTO_RULES =
  REAL_PHOTO + " Real skin and fabric with small imperfections, a candid moment nobody posed for. No glow, no neon, no smoke, no fog, no fire, no light rays, no color grading, " +
  "no red tint over the frame. Vertical 4:5. No readable text, letters or logos anywhere; screens show only small unreadable figures. " +
  "Nobody in the frame is a recognizable public figure. Only objects that belong to the story are in the frame: no holiday decorations or random props.";

export const CARTOON_RULES =
  "Cartoon illustration in the comic style of the reference image: thick clean outlines, glossy shading, expressive characters with big cartoon eyes and white gloves. " +
  "Calm blue night palette with soft, even cartoon lighting, like the reference: no neon glow, no glowing outlines, no red sky or red background; red appears only as thin flat chart lines. " +
  "Vertical 4:5. Absolutely no text, letters or numbers anywhere.";

/**
 * Схема «Разбора» по методу Anatomy (MIT): придуманный предмет в изометрии, собранный из множества мелких точных
 * деталей, четыре тона затенения, светлая бумага, один спокойный акцент. Слова на рисунок ставит вёрстка: художник
 * рисует только цифры в кружках у частей, и проверка сверяет их набор.
 */
export const SCHEME_RULES =
  "Isometric technical illustration of this one object, the kind of figure printed in a well-made product manual or a science magazine: " +
  "a real, precisely built thing seen from above at a true isometric angle (about 30 degrees), whole and centered, filling about 60 percent of the frame with clean air around it, standing on a plain white paper background with one soft small contact shadow under it. " +
  "Drawn with thin even dark-grey outlines and flat matte fills in four tones of warm grey: the lightest tone on every top face and three darker tones on the sides by the way they face, the same on every part, so the volume reads at a glance. " +
  "One calm accent color, a muted orange, marks the single part the reader should watch; everything else stays grey. " +
  "The object is assembled from dozens of small purposeful parts that sit on one another: a heavy base plate on four short feet, bevelled edges, corner screws drawn as tiny dots, grooves, hinges, axles, knurled knobs, coil springs, ruler strips with fine tick marks, blank label plates with three thin rule lines. Every line ends on a part. " +
  "Even, shadowless studio light, print-like crisp edges, calm and quiet, like a drawing made by a patient draughtsman. Square 1:1.";

export const schemeMarkers = (n: number) =>
  `Callouts: exactly ${n} small round markers numbered ${Array.from({ length: n }, (_, i) => i + 1).join(", ")}, each a solid dark-grey circle with a white digit, each standing in the clear air beside its part and joined to it by one short thin straight line that ends in a dot on the part. The digits in these ${n} circles are the only characters in the whole picture: dials, plates, screens and labels on the object are blank or carry plain tick marks.`;

const SCHEME_CHECK =
  "You inspect a generated isometric technical illustration for a magazine-style explainer slide. It must look like a calm figure from a product manual: one object in isometric view on a plain light background, thin outlines, flat grey tones, one muted accent, numbered round callout markers. " +
  'Answer with JSON only: {"markers": number[], "letters": boolean, "glow": boolean, "busy": boolean, "note": string}. ' +
  "markers: every number you can read inside a round callout marker, in reading order, with repeats if a number appears twice. letters: any words or letters anywhere, or digits outside the callout markers that read as text (plain tick marks do not count). " +
  "glow: neon, glowing edges, light rays, dark or saturated background, glossy 3D-render or cinematic look instead of a flat print-like drawing. busy: more than one main object, a cluttered scene, or the object is cropped by the frame. note: one short sentence in Russian.";

/** Схема годится, если цифры в кружках ровно 1…n, других букв нет и вид спокойный, как у рисунка из инструкции. */
export async function checkScheme(png: Buffer, n: number): Promise<ImageCheck> {
  const small = await sharp(png).resize(1024).jpeg({ quality: 88 }).toBuffer();
  const answer = await sidClaude({ label: "карусель: проверка картинки", system: SCHEME_CHECK, user: `На схеме должны быть кружки с цифрами от 1 до ${n}, каждая по одному разу. Проверь картинку.`, images: [{ base64: small.toString("base64"), mediaType: "image/jpeg" }], effort: "medium", timeoutMs: 6 * 60_000 });
  const r = extractJson(answer) as any;
  const seen = (Array.isArray(r?.markers) ? r.markers : []).map(Number).sort((a: number, b: number) => a - b).join(",");
  const want = Array.from({ length: n }, (_, i) => i + 1).join(",");
  const problems = [seen !== want && `цифры в кружках ${seen || "не найдены"}, а нужны ${want}`, r?.letters && "есть буквы или лишние цифры", r?.glow && "свечение или вид 3D-рендера вместо спокойного рисунка", r?.busy && "предмет не один или обрезан"].filter(Boolean);
  return { ok: problems.length === 0, note: problems.length ? `${problems.join(", ")}${r?.note ? `: ${String(r.note).slice(0, 160)}` : ""}` : String(r?.note ?? "") };
}

const CHECK: Record<Exclude<ImageKind, "scheme">, string> = {
  photo:
    "You inspect a generated image that must pass as a real documentary press photo. Look at the whole picture, including faces, hands, screens and signs. " +
    'Answer with JSON only: {"aiLook": boolean, "text": boolean, "realPerson": boolean, "offTopic": boolean, "note": string}. ' +
    "aiLook: at first glance it looks AI-generated rather than a plain phone photo: waxy or plastic skin, neon or glowing outlines, red glow or a red tint flooding the frame, fire, smoke, fog or light rays, cinematic grading, creamy blurred background with a glossy too-clean subject, melted or extra fingers, warped faces; or it is a stock-image cliche: an anonymous hooded figure from behind with a laptop, a posed 'hacker', symbolic props such as chains, padlocks, piles of coins or glass boxes with money. " +
    "text: readable letters, words or logos (small unreadable figures on screens are fine). realPerson: looks like a specific recognizable public figure. offTopic: the frame contains props unrelated to the story named by the user, such as holiday decorations. note: one short sentence in Russian.",
  cartoon:
    "You inspect a generated cartoon illustration. " +
    'Answer with JSON only: {"glow": boolean, "redScene": boolean, "text": boolean, "note": string}. ' +
    "glow: neon glow or glowing outlines. redScene: the background or most of the scene is saturated red (red sky, red canyon, red room) instead of a calm blue night. text: any letters, words or numbers. note: one short sentence in Russian.",
};

export type ImageCheck = { ok: boolean; note: string };

export async function checkImage(png: Buffer, kind: Exclude<ImageKind, "scheme">, topic = ""): Promise<ImageCheck> {
  const small = await sharp(png).resize(768).jpeg({ quality: 85 }).toBuffer();
  const answer = await sidClaude({ label: "карусель: проверка картинки", system: CHECK[kind], user: topic ? `История карусели: ${topic}. Проверь картинку.` : "Проверь картинку.", images: [{ base64: small.toString("base64"), mediaType: "image/jpeg" }], effort: "medium", timeoutMs: 6 * 60_000 });
  const r = extractJson(answer) as any;
  const bad = kind === "photo"
    ? [r?.aiLook && "с первого взгляда видно ИИ", r?.text && "есть буквы или логотипы", r?.realPerson && "похоже на реального человека", r?.offTopic && "случайный реквизит не из истории"]
    : [r?.glow && "неоновое зарево", r?.redScene && "красный фон вместо спокойной синей ночи", r?.text && "есть буквы или цифры"];
  const problems = bad.filter(Boolean);
  return { ok: problems.length === 0, note: problems.length ? `${problems.join(", ")}${r?.note ? `: ${String(r.note).slice(0, 160)}` : ""}` : String(r?.note ?? "") };
}

const asRef = async (b: Buffer) => `data:image/jpeg;base64,${(await sharp(b).resize({ width: 1024, withoutEnlargement: true }).jpeg({ quality: 88 }).toBuffer()).toString("base64")}`;

/**
 * До трёх попыток с проверкой. Если все три не прошли, остаётся последняя: карусель важнее одной картинки,
 * а замечание проверки уходит в итог задания.
 */
export async function makeImage(scene: string, kind: ImageKind, opts: { refs?: Buffer[]; tail?: string; label: string; topic?: string; markers?: number; onStep: (t: string) => void }): Promise<{ png: Buffer; note?: string }> {
  const markers = opts.markers ?? 3;
  const rules = kind === "photo" ? PHOTO_RULES : kind === "cartoon" ? CARTOON_RULES : `${SCHEME_RULES} ${schemeMarkers(markers)}`;
  const retry = kind === "scheme" ? "Draw it again as a flat, calm, print-like isometric figure on white paper, with each numbered marker exactly once." : "Make it a plain phone photo of the real thing in ordinary light, nothing staged or symbolic.";
  const prompt = `${scene.trim()}\n\n${rules}${opts.tail ? ` ${opts.tail}` : ""}`;
  const references = await Promise.all((opts.refs ?? []).slice(0, 4).map(asRef));
  let last: Buffer | null = null;
  const notes: string[] = [];
  for (let attempt = 1; attempt <= 3; attempt++) {
    opts.onStep(attempt === 1 ? `Рисую ${opts.label}` : `Перерисовываю ${opts.label} (попытка ${attempt})`);
    const extra = notes.length ? `\n\nThe previous attempt was rejected because: ${notes[notes.length - 1]}. ${retry}` : "";
    const r = await nativeImageBridge({ prompt: prompt + extra, aspectRatio: kind === "scheme" ? "1:1" : "4:5", references, mode: "generate" });
    last = await sharp(r.buffer).png().toBuffer();
    const check = kind === "scheme" ? await checkScheme(last, markers) : await checkImage(last, kind, opts.topic);
    if (check.ok) return { png: last };
    notes.push(check.note);
  }
  return { png: last!, note: `${opts.label}: ${notes[notes.length - 1]}` };
}

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36";
const BLOCKED = /just a moment|attention required|access denied|verify you are human|cloudflare/i;
const HIDE = `[id*="cookie" i],[class*="cookie" i],[id*="consent" i],[class*="consent" i],[class*="intercom" i],#onetrust-banner-sdk,.cky-consent-container{display:none!important}`;

/** Верх главной страницы сервиса как есть; null — страница закрыта проверкой или не открылась. */
export async function siteShot(browser: Browser, url: string): Promise<Buffer | null> {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: "en-US", userAgent: UA, ignoreHTTPSErrors: true });
  try {
    const page = await context.newPage();
    const res = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 }).catch(() => null);
    if (!res || res.status() >= 400) return null;
    await page.waitForTimeout(6000);
    const title = await page.title().catch(() => "");
    const body = ((await page.evaluate("document.body ? document.body.innerText.slice(0, 1500) : ''").catch(() => "")) as string) || "";
    if (BLOCKED.test(title) || BLOCKED.test(body)) return null;
    await page.addStyleTag({ content: HIDE }).catch(() => {});
    await page.waitForTimeout(600);
    return await page.screenshot({ type: "png" });
  } finally {
    await context.close().catch(() => {});
  }
}

/** Пост X через публичный embed — без входа; null, если пост не загрузился. */
export async function tweetShot(browser: Browser, id: string): Promise<Buffer | null> {
  const context = await browser.newContext({ viewport: { width: 620, height: 1400 }, deviceScaleFactor: 2, locale: "en-US" });
  try {
    const page = await context.newPage();
    await page.goto(`https://platform.twitter.com/embed/Tweet.html?id=${encodeURIComponent(id)}&theme=light&lang=en&dnt=true`, { waitUntil: "networkidle", timeout: 45_000 }).catch(() => null);
    const card = page.locator("article").first();
    if (!(await card.isVisible({ timeout: 15_000 }).catch(() => false))) return null;
    await page.waitForTimeout(1500);
    return await card.screenshot();
  } finally {
    await context.close().catch(() => {});
  }
}

/**
 * Монеты, которые знает новичок (владелец 01.11: на карте не должно быть FIGR_HELOC и WBT). Карта всегда
 * начинается с биткоина и эфира, дальше крупнейшие из этого списка; стейблкоины, обёрнутые и стейкинговые
 * токены, RWA и малоизвестные биржевые токены сюда не входят.
 */
export const KNOWN_COINS = [
  "bitcoin", "ethereum", "ripple", "binancecoin", "solana", "dogecoin", "cardano", "tron", "the-open-network", "avalanche-2",
  "chainlink", "sui", "stellar", "polkadot", "litecoin", "bitcoin-cash", "shiba-inu", "hyperliquid", "near", "aptos",
  "uniswap", "monero", "pepe", "internet-computer", "cosmos", "ethereum-classic", "arbitrum", "optimism", "polygon-ecosystem-token", "filecoin",
];

/** 10 знакомых монет с изменением цены за период по CoinGecko: BTC и ETH первыми, дальше по капитализации. */
export async function heatData(period: HeatPeriod): Promise<HeatTile[]> {
  const url = `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${KNOWN_COINS.join(",")}&order=market_cap_desc&per_page=100&page=1&price_change_percentage=24h,7d,30d`;
  const res = await fetch(url, { headers: { accept: "application/json", "user-agent": UA }, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`CoinGecko ответил ${res.status}`);
  return pickHeat(await res.json(), period);
}

export function pickHeat(list: any[], period: HeatPeriod): HeatTile[] {
  const field = `price_change_percentage_${period}_in_currency`;
  const tiles = list
    .filter((c) => KNOWN_COINS.includes(String(c?.id)))
    .map((c) => ({ id: String(c.id), sym: String(c.symbol).toLowerCase(), name: String(c.name), pct: Number(c[field]), cap: Number(c.market_cap) }))
    .filter((c) => Number.isFinite(c.pct) && c.cap > 0);
  const head = ["bitcoin", "ethereum"].map((id) => tiles.find((t) => t.id === id)).filter((t): t is NonNullable<typeof t> => Boolean(t));
  if (head.length < 2) throw new Error("CoinGecko не отдал биткоин и эфир для тепловой карты");
  const rest = tiles.filter((t) => t.id !== "bitcoin" && t.id !== "ethereum").sort((a, b) => b.cap - a.cap);
  const out = [...head, ...rest].slice(0, 10).map(({ sym, name, pct, cap }) => ({ sym, name, pct, cap }));
  if (out.length < 6) throw new Error("CoinGecko отдал слишком мало монет для тепловой карты");
  return out;
}

/** Логотип монеты из открытого набора иконок; null — нет такой иконки. */
export async function coinLogo(sym: string): Promise<Buffer | null> {
  try {
    const res = await fetch(`https://cdn.jsdelivr.net/gh/spothq/cryptocurrency-icons@master/128/color/${encodeURIComponent(sym)}.png`, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  }
}
