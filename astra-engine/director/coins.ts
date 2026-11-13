import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

/**
 * Real, current marks of coins and exchanges from CoinGecko — the owner (07.11): «лого неверное у кракена»
 * (Commons gave the 2013 octopus), «THE WHITE HOUSE» instead of the TRUMP token (a web search took the wrong site).
 * CoinGecko keeps the mark each project uses today, by ticker or name; its images are served from assets.coingecko.com.
 */

const UA = { "User-Agent": "Gudini-Astra/1.0 (video montage; contact: owner)" };
const API = "https://api.coingecko.com/api/v3/search";

type SearchCoin = { id: string; name: string; symbol: string; market_cap_rank: number | null; large?: string };
type Chosen = { kind: "coin" | "exchange"; name: string; image: string; symbol?: string };
type SearchExchange = { id: string; name: string; large?: string };

export type CryptoMark = { file: string; kind: "coin" | "exchange"; name: string };

const slug = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
const norm = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, "");

async function search(query: string): Promise<{ coins: SearchCoin[]; exchanges: SearchExchange[] } | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`${API}?query=${encodeURIComponent(query)}`, { headers: UA, signal: AbortSignal.timeout(15_000) });
      // The free API allows a few calls a minute: a busy minute is waited out.
      if (res.status === 429) { await new Promise(r => setTimeout(r, 4_000 * (attempt + 1))); continue; }
      if (!res.ok) return null;
      return await res.json() as { coins: SearchCoin[]; exchanges: SearchExchange[] };
    } catch { await new Promise(r => setTimeout(r, 1_500)); }
  }
  return null;
}

/**
 * Which coin or exchange a name means. "Official Trump (TRUMP)" → the ticker in brackets; "ETH" → the biggest coin with that ticker;
 * "Kraken" → the exchange. A coin far down the list (rank over 1500 or none) is someone's namesake, not the thing the author says.
 */
function pick(query: string, found: { coins: SearchCoin[]; exchanges: SearchExchange[] }): Chosen | null {
  const ticker = query.match(/\(([A-Za-z0-9$]{2,12})\)/)?.[1];
  const bare = query.replace(/\([^)]*\)/g, "").trim();
  const wanted = [ticker, bare, query].filter((v): v is string => Boolean(v)).map(norm);
  const rank = (c: SearchCoin) => c.market_cap_rank ?? Infinity;
  const coins = found.coins
    .filter(c => c.large && rank(c) <= 1500 && (wanted.includes(norm(c.symbol)) || wanted.includes(norm(c.name)) || wanted.includes(norm(c.id))))
    .sort((a, b) => rank(a) - rank(b));
  const exchange = found.exchanges.find(e => e.large && (wanted.includes(norm(e.name)) || wanted.includes(norm(e.id))));
  const coin = coins[0];
  // An exchange named exactly so wins over a small coin of the same name (Kraken the exchange, not a token called KRAKEN).
  if (exchange && (!coin || rank(coin) > 50)) return { kind: "exchange", name: exchange.name, image: exchange.large! };
  return coin ? { kind: "coin", name: coin.name, image: coin.large!, symbol: coin.symbol.toLowerCase() } : null;
}

/**
 * Big coins whose mark never changed are drawn from the open set cryptocurrency-icons (CC0, vector): the blue ETH circle,
 * the orange BTC — the colored coin every exchange shows. CoinGecko's ETH is a pale diamond that melts into a light tile.
 */
const CLASSIC = new Set(["btc", "eth", "usdt", "usdc", "bnb", "xrp", "ada", "doge", "sol", "ltc", "trx", "dot", "link", "xmr", "bch", "xlm", "atom", "etc", "dash", "zec", "avax", "matic", "shib", "dai", "uni"]);
const classicUrl = (symbol: string) => `https://cdn.jsdelivr.net/npm/cryptocurrency-icons@0.18.1/svg/color/${symbol}.svg`;

/** The biggest version of a CoinGecko image the CDN that answers from here serves: original first, then large. */
function imageUrls(image: string): string[] {
  const clean = image.split("?")[0].replace("coin-images.coingecko.com", "assets.coingecko.com");
  return [clean.replace("/large/", "/original/"), clean];
}

async function download(url: string): Promise<Buffer | null> {
  try {
    const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(20_000) });
    if (!res.ok) return null;
    const bytes = Buffer.from(await res.arrayBuffer());
    return bytes.length > 300 ? bytes : null;
  } catch { return null; }
}

/**
 * A coin is a round mark: a square picture without transparency (the TRUMP token's art) is cut into a circle.
 * An exchange is an app icon: a rounded square. Both are saved 512 px for a crisp tile.
 */
async function shape(bytes: Buffer, kind: "coin" | "exchange", file: string): Promise<void> {
  const size = 512;
  // A vector mark is drawn straight at the tile's size, not blown up from 32 px.
  const svg = bytes.subarray(0, 400).toString("utf8").includes("<svg");
  const base = sharp(bytes, svg ? { density: 1600 } : {}).resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 }, kernel: "lanczos3" }).ensureAlpha();
  const meta = await sharp(bytes).metadata();
  const radius = kind === "coin" ? size / 2 : size * 0.22;
  const mask = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${radius}" ry="${radius}" fill="#fff"/></svg>`);
  // A coin logo that already has its own transparent edge keeps it; an opaque square gets the circle or the rounded corners.
  const cut = kind === "exchange" || !meta.hasAlpha;
  const out = cut ? base.composite([{ input: mask, blend: "dest-in" }]) : base;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await out.png().toFile(file);
}

/** The real mark of a coin or exchange by its ticker or name, cached in `dir`; null when CoinGecko knows no such thing. */
export async function cryptoMark(query: string, dir: string): Promise<CryptoMark | null> {
  const file = path.join(dir, `${slug(query) || "mark"}.png`);
  const info = `${file}.json`;
  if (fs.existsSync(file) && fs.existsSync(info)) {
    try { return { file, ...JSON.parse(fs.readFileSync(info, "utf8")) as Omit<CryptoMark, "file"> }; } catch { /* searched again */ }
  }
  const ticker = query.match(/\(([A-Za-z0-9$]{2,12})\)/)?.[1];
  const found = await search(ticker ?? query.trim());
  const chosen = found ? pick(query, found) : null;
  if (!chosen) return null;
  const urls = [...(chosen.symbol && CLASSIC.has(chosen.symbol) ? [classicUrl(chosen.symbol)] : []), ...imageUrls(chosen.image)];
  for (const url of urls) {
    const bytes = await download(url);
    if (!bytes) continue;
    try {
      await shape(bytes, chosen.kind, file);
      fs.writeFileSync(info, JSON.stringify({ kind: chosen.kind, name: chosen.name }));
      return { file, kind: chosen.kind, name: chosen.name };
    } catch { /* the next size */ }
  }
  return null;
}
