// Запас историй ПК на странице «Новости» (владелец 29.10: «да выбор нужен, это хорошо»). Исполнитель присылает запас
// с каждым запросом задания (runner/claim); владелец выбирает историю для ролика («Монтировать»), отклоняет («Не то»)
// или убирает без выводов («Убрать»), или просит поискать ещё. Просьбы уходят ПК в ответах на claim, пока присланный запас не покажет, что они сделаны:
// отклонённой истории в нём нет, поиск идёт.
import fs from "fs";
import path from "path";
import { isLive, NewsError, listProjects, newsRoot, withLock, writeJson } from "./store";
import { cleanText, CRYPTO_LANES } from "./rules";
import type { NewsPick, StockOrders, StockReport } from "./types";

const STOCK_FILE = "stock.json";
const ORDERS_FILE = "stock-orders.json";
const MAX_STORIES = 40;
const TEXT_MAX = 1200;

/** The page's view: the stories still to choose from, the search, and an «ещё» the PC has not taken up yet. */
export type StockView = {
  stories: NewsPick[];
  searching: { startedAt: string } | null;
  /** «Найти ещё» is pressed and the PC has not started searching yet (it only searches while idle). */
  morePending: boolean;
  /** When the PC last sent a different stock; null — never. */
  at: string | null;
};

type Saved = { report: StockReport; at: string | null };

const stockPath = () => path.join(newsRoot(), STOCK_FILE);
const ordersPath = () => path.join(newsRoot(), ORDERS_FILE);
const lockKey = () => `${newsRoot()}#stock`;

function readSaved(): Saved {
  try {
    const raw = JSON.parse(fs.readFileSync(stockPath(), "utf8")) as Partial<Saved>;
    return { report: checkReport(raw.report), at: typeof raw.at === "string" ? raw.at : null };
  } catch {
    return { report: { stories: [], searching: null }, at: null };
  }
}

export function readOrders(): StockOrders {
  try {
    const raw = JSON.parse(fs.readFileSync(ordersPath(), "utf8")) as Partial<StockOrders>;
    const ids = (v: unknown) => (Array.isArray(v) ? v.filter((id): id is string => typeof id === "string") : []);
    return { reject: ids(raw.reject), drop: ids(raw.drop), more: raw.more === true };
  } catch {
    return { reject: [], drop: [], more: false };
  }
}

const text = (v: unknown, max = TEXT_MAX) => (typeof v === "string" ? cleanText(v).slice(0, max) : "");
const orNull = (v: unknown, max?: number) => text(v, max) || null;

/** The runner's report, normalized: broken stories are dropped, texts are cut to fit the page. */
export function checkReport(raw: unknown): StockReport {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const stories = (Array.isArray(r.stories) ? r.stories : []).flatMap((x): NewsPick[] => {
    const s = x && typeof x === "object" ? (x as Record<string, unknown>) : {};
    const id = text(s.id, 60);
    const title = text(s.title, 160);
    if (!/^[a-z0-9-]{6,60}$/.test(id) || !title) return [];
    const score = typeof s.score === "number" && Number.isFinite(s.score) ? Math.max(1, Math.min(10, Math.round(s.score))) : null;
    const sources = (Array.isArray(s.sources) ? s.sources : []).filter((u): u is string => typeof u === "string" && /^https?:\/\//.test(u) && u.length <= 2000).slice(0, 3);
    // крипта — два ролика из шести: метка на странице и «следующая по очереди» (news/runner/pipeline/stock.ts cryptoDue)
    const lane = typeof s.lane === "string" && CRYPTO_LANES.includes(s.lane) ? s.lane : null;
    return [{ id, title, summary: text(s.summary), why: text(s.why), hero: text(s.hero, 120), anchor: orNull(s.anchor, 80), hook: orNull(s.hook, 300), score, verdict: orNull(s.verdict, 400), ...(orNull(s.share, 200) ? { share: orNull(s.share, 200) } : {}), sources, at: text(s.at, 40), sequelOf: orNull(s.sequelOf, 160), ...(lane ? { lane, due: s.due === true } : {}) }];
  });
  const searching = r.searching && typeof r.searching === "object" && typeof (r.searching as Record<string, unknown>).startedAt === "string" ? { startedAt: (r.searching as { startedAt: string }).startedAt } : null;
  return { stories: stories.slice(0, MAX_STORIES), searching };
}

/**
 * The stock from a claim: written only when it changed (the runner claims every few seconds). The owner's requests
 * that it shows done are cleared: a rejected or dropped story is gone from it, a search is going on.
 */
export async function saveStock(raw: unknown): Promise<void> {
  const report = checkReport(raw);
  await withLock(lockKey(), async () => {
    await fs.promises.mkdir(newsRoot(), { recursive: true });
    const current = readSaved();
    if (JSON.stringify(current.report) !== JSON.stringify(report)) await writeJson(stockPath(), { report, at: new Date().toISOString() });
    const orders = readOrders();
    const still = (id: string) => report.stories.some((s) => s.id === id);
    const next: StockOrders = { reject: orders.reject.filter(still), drop: orders.drop.filter(still), more: orders.more && !report.searching };
    if (JSON.stringify(next) !== JSON.stringify(orders)) await writeJson(ordersPath(), next);
  });
}

/** What the claim answer carries to the runner; null when the owner asked for nothing. */
export function ordersForRunner(): StockOrders | null {
  const orders = readOrders();
  return orders.reject.length || orders.drop.length || orders.more ? orders : null;
}

/** Stories a queued or running video already took: the list must not offer them twice. */
function takenPicks(): Set<string> {
  return new Set(listProjects().flatMap((p) => (p.job?.pick && isLive(p.job) ? [p.job.pick] : [])));
}

export function stockView(): StockView {
  const { report, at } = readSaved();
  const orders = readOrders();
  const hidden = new Set([...orders.reject, ...orders.drop, ...takenPicks()]);
  return { stories: report.stories.filter((s) => !hidden.has(s.id)), searching: report.searching, morePending: orders.more && !report.searching, at };
}

/** The story the owner chose, if the list still offers it: then a video is made of exactly it. */
export function choosePick(id: unknown): NewsPick {
  const pick = typeof id === "string" ? stockView().stories.find((s) => s.id === id) : undefined;
  if (!pick) throw new NewsError("Этой истории уже нет в запасе — обновите страницу и выберите другую", 409);
  return pick;
}

/**
 * «Не то» (learn: true): the list hides it at once, the PC drops it on its next claim and learns from it. «Убрать»
 * (learn: false): the same, but nothing is learned — the story is outdated or just not for today.
 */
export async function removePick(id: unknown, learn: boolean): Promise<void> {
  if (typeof id !== "string" || !readSaved().report.stories.some((s) => s.id === id)) throw new NewsError("Такой истории в запасе нет", 404);
  const list = learn ? "reject" : "drop";
  await withLock(lockKey(), async () => {
    const orders = readOrders();
    if (orders[list].includes(id)) return;
    await fs.promises.mkdir(newsRoot(), { recursive: true });
    await writeJson(ordersPath(), { ...orders, [list]: [...orders[list], id] });
  });
}

/** «Найти ещё»: the PC searches as soon as it is free, whatever the stock and the pause between rounds. */
export async function askMore(): Promise<void> {
  await withLock(lockKey(), async () => {
    const orders = readOrders();
    if (orders.more) return;
    await fs.promises.mkdir(newsRoot(), { recursive: true });
    await writeJson(ordersPath(), { ...orders, more: true });
  });
}
