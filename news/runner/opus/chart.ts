/**
 * График вложения для «Опус 5.5»: история цены монеты с CoinMarketCap (без ключа, с 2013 года; у новых монет — с их
 * старта), пересчитанная в стоимость вложения, и клип движка OpusChart. Точку покупки раньше истории CoinMarketCap
 * (биткоин 2009–2013) режиссёр даёт сам из сценария — ценой первого дня.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { NEWS_ROOT, type Hooks } from "../pipeline/util";

const UA = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36" };
const CMC = "https://api.coinmarketcap.com/data-api/v3";
/** Сколько точек на линии: больше — линия дрожит, меньше — пропадают обвалы. */
const POINTS = 160;

export type ChartAsk = { coin: string; slug: string; date: string; amount: number; price: number };

async function json(url: string): Promise<any> {
  for (let i = 0; i < 3; i++) {
    const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(30_000) }).catch(() => null);
    if (res?.ok) return res.json();
    await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
  }
  throw new Error(`CoinMarketCap не ответил: ${url}`);
}

/** Цена монеты по дням от from до сегодня: [секунды Unix, цена $]. */
async function history(slug: string, from: number): Promise<[number, number][]> {
  const id = (await json(`${CMC}/cryptocurrency/detail?slug=${encodeURIComponent(slug)}`))?.data?.id;
  if (!id) throw new Error(`на CoinMarketCap нет монеты «${slug}»`);
  const now = Math.floor(Date.now() / 1000);
  const out: [number, number][] = [];
  // CoinMarketCap отдаёт длинный срок прореженным, поэтому — кусками по году
  for (let a = Math.max(from, 1367107200); a < now; a += 365 * 86400) {
    const b = Math.min(now, a + 365 * 86400);
    const q = (await json(`${CMC}/cryptocurrency/historical?id=${id}&convertId=2781&timeStart=${a}&timeEnd=${b}`))?.data?.quotes ?? [];
    for (const x of q) {
      const t = Math.floor(Date.parse(x.timeOpen) / 1000);
      const p = Number(x.quote?.close);
      if (t >= from && p > 0 && (!out.length || t > out[out.length - 1][0])) out.push([t, p]);
    }
  }
  return out;
}

/** Клип графика длиной seconds; null — истории нет. */
/**
 * landAt — на какой секунде клипа линия должна дойти до конца и встать итог: её считает монтаж по слову, на котором автор
 * называет сумму (получает итог графика, чтобы найти это число в речи). Нет её — итог встаёт на 70% клипа, как раньше.
 */
export async function chartClip(ask: ChartAsk, seconds: number, pub: string, out: string, hooks: Hooks, landAt?: (total: number) => number | undefined): Promise<string | null> {
  const from = Math.floor(Date.parse(`${ask.date}T00:00:00Z`) / 1000);
  if (!Number.isFinite(from) || !(ask.amount > 0)) return null;
  const prices = await history(ask.slug, from);
  if (!prices.length) return null;
  // цена дня покупки: из сценария, если история начинается позже (биткоин 2009–2013), иначе первая из истории
  // цена дня покупки — та, что звучит в речи автора (у TRUMP цена первых сделок 1,21 $, а закрытие дня в десятки раз
  // выше — график расходился бы с текстом); нет её — первая из истории
  const start = ask.price > 0 ? ask.price : prices[0][1];
  const coins = ask.amount / start;
  const all: [number, number][] = prices[0][0] - from > 7 * 86400 ? [[from, start], ...prices] : prices;
  const step = Math.max(1, Math.floor(all.length / POINTS));
  const points = all.filter((_, i) => i % step === 0 || i === all.length - 1).map(([t, p]) => ({ t, v: coins * p }));
  const d = new Date(from * 1000);
  const months = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
  const invested = `${ask.amount.toLocaleString("ru-RU").replace(/ /g, " ")} $ · ${d.getUTCDate()} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  const require = createRequire(path.join(NEWS_ROOT, "node_modules", "x.js"));
  const { bundle } = require("@remotion/bundler") as typeof import("@remotion/bundler");
  const { renderMedia, selectComposition } = require("@remotion/renderer") as typeof import("@remotion/renderer");
  const serveUrl = await bundle({ entryPoint: path.join(NEWS_ROOT, "engine", "src", "index.ts"), publicDir: pub });
  const port = process.env.NEWS_RENDER_PORT ? Number(process.env.NEWS_RENDER_PORT) + 1 : undefined;
  const frames = Math.round(seconds * 30);
  const said = landAt?.(points[points.length - 1].v);
  // линии нужно хотя бы 0,8 с, итогу после неё — хотя бы 1,2 с неподвижно, чтобы сумму прочитали (video-shotcraft
  // chart-live-moves: график без паузы в конце читается как недоигранный)
  const land = said !== undefined && frames >= 70 ? Math.max(24, Math.min(frames - 36, Math.round(said * 30))) : undefined;
  const inputProps = { coin: ask.coin, invested, points, frames, ...(land !== undefined ? { land } : {}) };
  const composition = await selectComposition({ serveUrl, id: "OpusChart", inputProps, ...(port ? { port } : {}) });
  await renderMedia({ serveUrl, composition, inputProps, codec: "h264", outputLocation: out, muted: true, crf: 17, ...(port ? { port } : {}) });
  hooks.log(`график ${ask.coin}: ${points.length} точек, ${invested} → ${Math.round(points[points.length - 1].v).toLocaleString("ru-RU")} $${land !== undefined ? `, итог на ${(land / 30).toFixed(2)} с клипа — на слове с суммой` : ""}`);
  return fs.existsSync(out) ? out : null;
}
