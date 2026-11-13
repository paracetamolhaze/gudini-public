import { drawActionIcon, drawAppIcon, drawAvatar, drawCoin, drawEye, drawPromo, drawStatus, drawThumb, type ActionIcon, type AppIcon } from "./ScreenIcons";
import { hash, smooth } from "./util";

/** What a screen of the room can show: the director's apps and the room's own idle pictures. */
export type ScreenApp = "chat" | "chart" | "feed" | "wallet" | "news" | "position";
export type Trend = "up" | "down" | "pump" | "dump" | "flat";
export type ScreenContent = {
  app: ScreenApp | "home";
  title: string;
  lines: string[];
  trend?: Trend;
  /** Seconds since this picture opened on the screen: typing, new posts and new candles count from it. */
  since: number;
};
export type Surface = "monitor" | "vertical";

type Ctx = CanvasRenderingContext2D;

const GREEN = "#2ebd85";
const RED = "#f6465d";
const MONO = "'JetBrains Mono', monospace";
const SANS = "Inter, sans-serif";

/** Red for a falling or failing line, green for a rising one — the same rule as the floating windows. */
const accentOf = (line: string) =>
  /▼|−|-\s?[\d$€₽]|\bfail|\berror\b|ошибка|скам|ликвид/i.test(line) ? RED : /^\s*[▲+]|\+\d|\bok\b|готово|зачисл/i.test(line) ? GREEN : null;

const seedOf = (text: string) => [...text].slice(0, 16).reduce((s, ch, i) => s + ch.charCodeAt(0) * (i + 1), 0);

const font = (c: Ctx, size: number, weight = 600, family = SANS) => { c.font = `${weight} ${size}px ${family}`; };

const box = (c: Ctx, x: number, y: number, w: number, h: number, r: number, fill: string) => {
  c.fillStyle = fill; c.beginPath(); c.roundRect(x, y, w, h, r); c.fill();
};

/** Words into lines no wider than `width` at the current font. */
const wrap = (c: Ctx, text: string, width: number) => {
  const out: string[] = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (c.measureText(next).width > width && line) { out.push(line); line = word; } else line = next;
    }
    out.push(line);
  }
  return out;
};

const fit = (c: Ctx, text: string, width: number) => {
  if (c.measureText(text).width <= width) return text;
  let s = text;
  while (s.length > 1 && c.measureText(`${s}…`).width > width) s = s.slice(0, -1);
  return `${s}…`;
};

/** How far a list has come: item i shows `gap` seconds after the one before, sliding in over 0.35 s. */
const appear = (since: number, i: number, gap: number, lead = 0.25) => smooth((since - lead - i * gap) / 0.35);

// ---------------------------------------------------------------- price series

/** A candle series that tells the trend of the story: deterministic, so every render tab draws the same. */
const series = (seed: number, trend: Trend, count: number) => {
  const out: { o: number; c: number; h: number; l: number; v: number }[] = [];
  let v = 100;
  for (let i = 0; i < count; i++) {
    const p = i / count;
    const drift = trend === "up" ? 0.55 : trend === "down" ? -0.55 : trend === "pump" ? (p > 0.72 ? 3.2 : 0.05) : trend === "dump" ? (p > 0.62 ? -3.6 : 0.45) : 0;
    const o = v;
    v += drift + (hash(seed, i, 3) - 0.5) * 2.6;
    const c = v;
    const big = Math.abs(drift) > 2 ? 1.6 : 1;
    out.push({ o, c, h: Math.max(o, c) + hash(seed, i, 5) * 1.1 * big, l: Math.min(o, c) - hash(seed, i, 7) * 1.1 * big, v: 0.3 + hash(seed, i, 9) * 0.7 * big });
  }
  return out;
};

const priceOf = (text: string | undefined) => {
  const n = Number((text ?? "").replace(/[^\d.,-]/g, "").replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : 100;
};

/**
 * Candles in a rectangle: the window slides one candle every 2.2 s and the last one is live,
 * its close wandering as trades come in.
 */
const candles = (c: Ctx, x: number, y: number, w: number, h: number, volH: number, content: ScreenContent, t: number) => {
  const shown = 42;
  const steps = Math.floor(content.since / 2.2);
  const seed = seedOf(content.title);
  const all = series(seed, content.trend ?? "flat", shown + 12);
  const end = Math.min(all.length, shown + Math.min(12, steps));
  const view = all.slice(end - shown, end).map((k) => ({ ...k }));
  const live = view[view.length - 1];
  const wander = Math.sin(t * 2.3) * 0.5 + Math.sin(t * 5.1 + seed) * 0.3;
  live.c += wander; live.h = Math.max(live.h, live.c); live.l = Math.min(live.l, live.c);
  const hi = Math.max(...view.map((k) => k.h)); const lo = Math.min(...view.map((k) => k.l));
  const yOf = (v: number) => y + (1 - (v - lo) / Math.max(0.001, hi - lo)) * h;
  // grid
  c.strokeStyle = "rgba(160,170,190,0.09)"; c.lineWidth = 1;
  for (let i = 0; i <= 5; i++) { c.beginPath(); c.moveTo(x, y + (h * i) / 5); c.lineTo(x + w, y + (h * i) / 5); c.stroke(); }
  for (let i = 0; i <= 6; i++) { c.beginPath(); c.moveTo(x + (w * i) / 6, y); c.lineTo(x + (w * i) / 6, y + h + volH); c.stroke(); }
  const step = w / shown;
  view.forEach((k, i) => {
    const up = k.c >= k.o;
    const color = up ? GREEN : RED;
    const cx = x + step * (i + 0.5);
    c.strokeStyle = color; c.lineWidth = Math.max(1.5, step * 0.1);
    c.beginPath(); c.moveTo(cx, yOf(k.h)); c.lineTo(cx, yOf(k.l)); c.stroke();
    const top = yOf(Math.max(k.o, k.c)); const bottom = yOf(Math.min(k.o, k.c));
    c.fillStyle = color; c.fillRect(cx - step * 0.32, top, step * 0.64, Math.max(2, bottom - top));
    c.globalAlpha = 0.45; c.fillRect(cx - step * 0.32, y + h + volH - k.v * volH * 0.9, step * 0.64, k.v * volH * 0.9); c.globalAlpha = 1;
  });
  // the live price line with its tag
  const ly = yOf(live.c);
  const color = live.c >= live.o ? GREEN : RED;
  c.setLineDash([6, 6]); c.strokeStyle = color; c.lineWidth = 1.5;
  c.beginPath(); c.moveTo(x, ly); c.lineTo(x + w, ly); c.stroke(); c.setLineDash([]);
  return { color, last: live.c, first: view[0].o, lo, hi };
};

/** Bids and asks around the price, amounts shuffling a few times a second. */
const orderBook = (c: Ctx, x: number, y: number, w: number, rows: number, rowH: number, price: number, t: number, seed: number) => {
  const tick = Math.floor(t * 3);
  const unit = price > 1000 ? 0.5 : price > 10 ? 0.05 : 0.001;
  const digits = price > 1000 ? 1 : price > 10 ? 2 : 3;
  const fmt = (v: number) => v.toLocaleString("ru-RU", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  font(c, rowH * 0.56, 400, MONO);
  for (let side = 0; side < 2; side++) {
    for (let i = 0; i < rows; i++) {
      const k = side === 0 ? rows - i : i + 1;
      const amount = 0.05 + hash(seed, k, side, tick + (k % 3)) * 2.4;
      const ry = y + (side === 0 ? i : rows + 1.4 + i) * rowH;
      c.fillStyle = side === 0 ? "rgba(246,70,93,0.13)" : "rgba(46,189,133,0.13)";
      c.fillRect(x + w * (1 - amount / 2.5), ry, w * (amount / 2.5), rowH * 0.9);
      c.fillStyle = side === 0 ? RED : GREEN; c.textAlign = "left";
      c.fillText(fmt(price + (side === 0 ? k : -k) * unit), x + 8, ry + rowH * 0.66);
      c.fillStyle = "rgba(220,226,240,0.75)"; c.textAlign = "right";
      c.fillText(amount.toFixed(3), x + w - 8, ry + rowH * 0.66);
    }
  }
  c.textAlign = "left";
  return y + rows * rowH;
};

// ---------------------------------------------------------------- apps


const MARKET: [string, number, number][] = [
  ["BTC/USDT", 67412.5, 1.24], ["ETH/USDT", 3248.1, -0.62], ["XAU/USD", 2386.4, 0.38], ["SOL/USDT", 148.32, 3.1],
  ["TON/USDT", 6.842, -1.9], ["BNB/USDT", 588.7, 0.52], ["XAG/USD", 28.41, 0.9],
];

const sparkline = (c: Ctx, x: number, y: number, w: number, h: number, seed: number, rising: boolean, t: number) => {
  c.strokeStyle = rising ? GREEN : RED; c.lineWidth = 2.5; c.beginPath();
  const n = 24;
  for (let i = 0; i <= n; i++) {
    const trend = rising ? i / n : 1 - i / n;
    const v = trend * 0.6 + hash(seed, i) * 0.4 + (i === n ? Math.sin(t * 2 + seed) * 0.06 : 0);
    const px = x + (w * i) / n; const py = y + h - v * h;
    if (i === 0) c.moveTo(px, py); else c.lineTo(px, py);
  }
  c.stroke();
};

/** The vertical screen at rest: a market watch list, prices ticking. Crypto and gold, the owner's two markets. */
const homeVertical = (c: Ctx, w: number, h: number, t: number) => {
  c.fillStyle = "#0b0e11"; c.fillRect(0, 0, w, h);
  font(c, 54, 800); c.fillStyle = "#eaecef"; c.fillText("Рынок", 34, 150);
  font(c, 28, 600);
  ["Избранное", "Крипто", "Металлы"].forEach((tab, i) => {
    const x = 34 + i * 200;
    c.fillStyle = i === 0 ? "#eaecef" : "#6b7385"; c.fillText(tab, x, 220);
    if (i === 0) box(c, x, 236, 150, 5, 2, "#f0b90b");
  });
  const tick = Math.floor(t * 1.5);
  MARKET.forEach(([pair, price, change], i) => {
    const y = 290 + i * 150;
    drawCoin(c, pair, 74, y + 56, 34);
    font(c, 32, 800); c.fillStyle = "#eaecef"; c.fillText(pair.split("/")[0], 128, y + 50);
    font(c, 22, 600); c.fillStyle = "#6b7385"; c.fillText(pair, 128, y + 86);
    const jitter = (hash(tick, i) - 0.5) * price * 0.0004;
    const now = price + jitter;
    const up = change + jitter / price * 100 >= 0;
    sparkline(c, 300, y + 22, 140, 60, i * 17 + 3, change >= 0, t);
    font(c, 30, 700, MONO); c.textAlign = "right"; c.fillStyle = hash(tick, i, 2) > 0.7 ? (up ? GREEN : RED) : "#eaecef";
    c.fillText(now.toLocaleString("ru-RU", { maximumFractionDigits: price > 100 ? 1 : 3, minimumFractionDigits: price > 100 ? 1 : 3 }), w - 34, y + 50);
    box(c, w - 164, y + 66, 130, 42, 8, up ? "rgba(46,189,133,0.18)" : "rgba(246,70,93,0.18)");
    font(c, 24, 700, MONO); c.fillStyle = up ? GREEN : RED; c.fillText(`${change >= 0 ? "+" : ""}${change.toFixed(2)}%`, w - 46, y + 96);
    c.textAlign = "left";
    c.fillStyle = "rgba(255,255,255,0.05)"; c.fillRect(34, y + 132, w - 68, 2);
  });
  c.fillStyle = "#151a21"; c.fillRect(0, h - 110, w, 110);
  ["Главная", "Рынки", "Трейд", "Кошелёк"].forEach((tab, i) => {
    font(c, 22, 600); c.fillStyle = i === 1 ? "#f0b90b" : "#6b7385"; c.textAlign = "center"; c.fillText(tab, (w / 4) * (i + 0.5), h - 42);
  });
  c.textAlign = "left";
};

/** The monitor at rest: Claude's start page, the owner's greeting (approved 2026-10-22). */
const homeMonitor = (c: Ctx, w: number, h: number) => {
  chatFrame(c, w, h, "3D студия");
  c.save(); c.translate(w / 2 - 130, 190);
  box(c, 0, 0, 260, 160, 25, "#d48761");
  c.fillRect(36, 146, 25, 31); c.fillRect(197, 146, 25, 31);
  c.fillStyle = "#221914"; c.beginPath(); c.roundRect(63, 43, 18, 28, 5); c.roundRect(181, 43, 18, 28, 5); c.fill();
  c.lineWidth = 7; c.strokeStyle = "#221914"; c.beginPath(); c.moveTo(113, 103); c.quadraticCurveTo(131, 119, 150, 103); c.stroke();
  c.restore();
  const mid = 270 + (w - 270) / 2;
  c.fillStyle = "#eee7dc"; c.font = "54px Georgia, serif"; c.textAlign = "center"; c.fillText("Привет, Gudini_younger.", mid, 450);
  font(c, 25, 600); c.fillStyle = "#9d958a"; c.fillText("Давай создадим что-нибудь интересное.", mid, 500);
  c.textAlign = "left";
  chatInput(c, w, h, "О чём поговорим?");
};

const CHATS = ["Сид-фраза и кошелёк", "Скам-каналы в Телеграме", "Плечо x50: как не слиться", "Золото или биткоин", "Как работает блокчейн"];

/** Claude's window: the sidebar with recent chats, the current one on top. */
const chatFrame = (c: Ctx, w: number, h: number, current: string) => {
  c.fillStyle = "#1f1e1d"; c.fillRect(0, 0, w, h);
  c.fillStyle = "#171615"; c.fillRect(0, 0, 270, h);
  c.fillStyle = "#eee9e0"; c.font = "600 42px Georgia, serif"; c.fillText("Claude", 36, 72);
  box(c, 24, 108, 222, 54, 12, "#2c2925");
  font(c, 23, 600); c.fillStyle = "#ddd5c9"; c.fillText("+  Новый чат", 44, 143);
  font(c, 19, 600); c.fillStyle = "#7d7871"; c.fillText("Недавние", 30, 218);
  [current, ...CHATS.filter((t) => t !== current)].slice(0, 9).forEach((title, i) => {
    if (i === 0) box(c, 18, 238, 236, 46, 10, "#2f2d2a");
    font(c, 20, 600); c.fillStyle = i === 0 ? "#ece4d8" : "#8e8983"; c.fillText(fit(c, title, 200), 32, 269 + i * 50);
  });
};

const chatInput = (c: Ctx, w: number, h: number, placeholder: string) => {
  const x = 330; const width = w - 390;
  box(c, x, h - 150, width, 108, 22, "#2b2825");
  c.strokeStyle = "#4a433a"; c.lineWidth = 2; c.beginPath(); c.roundRect(x, h - 150, width, 108, 22); c.stroke();
  font(c, 26, 600); c.fillStyle = "#8f877c"; c.fillText(placeholder, x + 32, h - 92);
  box(c, x + width - 66, h - 116, 46, 44, 11, "#d48761");
  font(c, 30, 800); c.fillStyle = "#211a16"; c.fillText("↑", x + width - 53, h - 82);
};

const claudeMark = (c: Ctx, x: number, y: number, s: number) => {
  box(c, x, y, s, s * 0.62, s * 0.12, "#d48761");
  c.fillStyle = "#221914"; c.fillRect(x + s * 0.26, y + s * 0.18, s * 0.08, s * 0.13); c.fillRect(x + s * 0.66, y + s * 0.18, s * 0.08, s * 0.13);
};

/** The owner's question to Claude, sent; then Claude thinking for a moment and typing the answer. */
const chat = (c: Ctx, w: number, h: number, content: ScreenContent, surface: Surface) => {
  const vertical = surface === "vertical";
  const left = vertical ? 30 : 330;
  const right = vertical ? w - 30 : w - 60;
  if (vertical) {
    c.fillStyle = "#1f1e1d"; c.fillRect(0, 0, w, h);
    c.fillStyle = "#171615"; c.fillRect(0, 0, w, 120);
    c.fillStyle = "#eee9e0"; c.font = "600 40px Georgia, serif"; c.textAlign = "center"; c.fillText("Claude", w / 2, 78); c.textAlign = "left";
  } else chatFrame(c, w, h, content.title);
  const size = vertical ? 32 : 30;
  const lineH = size * 1.45;
  // the question
  font(c, size, 600);
  const asked = wrap(c, content.title, (right - left) * 0.7);
  const bubbleW = Math.min((right - left) * 0.75, Math.max(...asked.map((l) => c.measureText(l).width)) + 48);
  const blocks: { h: number; draw: (y: number) => void }[] = [];
  blocks.push({
    h: asked.length * lineH + 36,
    draw: (y) => {
      box(c, right - bubbleW, y, bubbleW, asked.length * lineH + 36, 20, "#393734");
      font(c, size, 600); c.fillStyle = "#eeeae4";
      asked.forEach((l, i) => c.fillText(l, right - bubbleW + 24, y + 18 + size + i * lineH));
    },
  });
  // the answer, typed after a short think
  const answer = content.lines.join("\n");
  const typed = Math.max(0, Math.floor((content.since - 1.1) * 42));
  const text = answer.slice(0, typed);
  font(c, size, 600);
  const said = wrap(c, text, right - left - 60);
  blocks.push({
    h: Math.max(1, said.length) * lineH + 60,
    draw: (y) => {
      claudeMark(c, left, y + 8, 46);
      if (content.since < 1.1 || !answer) {
        for (let i = 0; i < 3; i++) {
          c.globalAlpha = 0.35 + 0.65 * Math.max(0, Math.sin(content.since * 7 - i * 0.9));
          c.fillStyle = "#c9c1b5"; c.beginPath(); c.arc(left + 80 + i * 22, y + 26, 6, 0, Math.PI * 2); c.fill();
        }
        c.globalAlpha = 1;
        return;
      }
      font(c, size, 600);
      said.forEach((l, i) => {
        c.fillStyle = accentOf(l) ?? "#e6e0d6";
        c.fillText(l, left + 60, y + size + 6 + i * lineH);
      });
      if (typed < answer.length && Math.floor(content.since * 3) % 2 === 0) {
        const last = said[said.length - 1] ?? "";
        c.fillStyle = "#d48761"; c.fillRect(left + 62 + c.measureText(last).width, y + 10 + (said.length - 1) * lineH, 3, size);
      }
    },
  });
  // the conversation sits right on the input box, where a close shot of Claude sees the monitor, and scrolls up
  const bottom = h - (vertical ? 190 : 180);
  const total = blocks.reduce((s, b) => s + b.h + 28, 0);
  let y = bottom - total;
  for (const b of blocks) { b.draw(y); y += b.h + 28; }
  if (vertical) {
    c.fillStyle = "#1f1e1d"; c.fillRect(0, h - 170, w, 170);
    box(c, 24, h - 140, w - 48, 96, 22, "#2b2825");
    font(c, 26, 600); c.fillStyle = "#8f877c"; c.fillText("Ответить Claude…", 54, h - 82);
  } else {
    c.fillStyle = "#1f1e1d"; c.fillRect(270, h - 170, w - 270, 170);
    chatInput(c, w, h, "Ответить Claude…");
  }
};

/** An exchange: the pair, its price and change, candles with volume and the order book. */
const chart = (c: Ctx, w: number, h: number, content: ScreenContent, surface: Surface, t: number) => {
  const vertical = surface === "vertical";
  c.fillStyle = "#0b0e11"; c.fillRect(0, 0, w, h);
  const price = content.lines[0] ?? "";
  const change = content.lines[1] ?? "";
  const falling = content.trend === "down" || content.trend === "dump" || accentOf(change) === RED;
  const tint = falling ? RED : GREEN;
  if (vertical) {
    drawCoin(c, content.title, 64, 84, 32);
    font(c, 36, 800); c.fillStyle = "#eaecef"; c.fillText(content.title, 112, 98);
    font(c, 66, 800, MONO); c.fillStyle = tint; c.fillText(price, 34, 210);
    box(c, 34, 236, Math.max(150, c.measureText(change).width * 0.5 + 40), 48, 10, falling ? "rgba(246,70,93,0.18)" : "rgba(46,189,133,0.18)");
    font(c, 30, 700, MONO); c.fillStyle = tint; c.fillText(change, 52, 270);
    font(c, 24, 600);
    ["15м", "1Ч", "4Ч", "1Д"].forEach((tf, i) => { c.fillStyle = i === 1 ? "#eaecef" : "#6b7385"; c.fillText(tf, 40 + i * 92, 340); });
    candles(c, 24, 380, w - 120, 520, 110, content, t);
    font(c, 22, 700); c.fillStyle = "#eaecef"; c.fillText("Стакан", 34, 1060);
    orderBook(c, 24, 1080, w - 48, 6, 38, priceOf(price), t, seedOf(content.title));
    return;
  }
  drawCoin(c, content.title, 54, 52, 26);
  font(c, 30, 800); c.fillStyle = "#eaecef"; c.fillText(content.title, 92, 64);
  font(c, 34, 800, MONO); c.fillStyle = tint; c.fillText(price, 360, 66);
  const after = 360 + c.measureText(price).width + 24;
  font(c, 24, 700, MONO); c.fillText(change, after, 64);
  font(c, 21, 600);
  ["15м", "1Ч", "4Ч", "1Д", "Индикаторы"].forEach((tf, i) => { c.fillStyle = i === 1 ? "#eaecef" : "#6b7385"; c.fillText(tf, 40 + i * 80, 122); });
  c.fillStyle = "rgba(255,255,255,0.06)"; c.fillRect(0, 140, w, 2); c.fillRect(1040, 0, 2, h);
  candles(c, 30, 170, 990, 520, 150, content, t);
  font(c, 24, 700); c.fillStyle = "#eaecef"; c.fillText("Стакан", 1070, 60);
  font(c, 18, 600); c.fillStyle = "#6b7385"; c.fillText("Цена", 1070, 100); c.textAlign = "right"; c.fillText("Кол-во", w - 30, 100); c.textAlign = "left";
  orderBook(c, 1060, 120, w - 1080, 9, 36, priceOf(price), t, seedOf(content.title));
  font(c, 30, 800, MONO); c.fillStyle = tint; c.fillText(price, 1072, 120 + 9 * 36 + 34);
};

/** Telegram's chat wallpaper: faint doodles — coins, stars, rings, sparks — over the dark background. */
const chatPattern = (c: Ctx, x: number, y: number, w: number, h: number) => {
  c.save();
  c.beginPath(); c.rect(x, y, w, h); c.clip();
  c.strokeStyle = "rgba(120,160,200,0.07)"; c.fillStyle = "rgba(120,160,200,0.06)"; c.lineWidth = 2;
  const step = 86;
  for (let gy = 0; gy < h / step + 1; gy++) for (let gx = 0; gx < w / step + 1; gx++) {
    const px = x + gx * step + (gy % 2) * step * 0.5 + (hash(gx, gy, 3) - 0.5) * 20;
    const py = y + gy * step + (hash(gx, gy, 5) - 0.5) * 20;
    const kind = Math.floor(hash(gx, gy, 7) * 4);
    c.beginPath();
    if (kind === 0) c.arc(px, py, 11, 0, Math.PI * 2);
    else if (kind === 1) { for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2 - Math.PI / 2; const r = i % 2 ? 5 : 12; if (i) c.lineTo(px + Math.cos(a) * r, py + Math.sin(a) * r); else c.moveTo(px + Math.cos(a) * r, py + Math.sin(a) * r); } c.closePath(); }
    else if (kind === 2) { c.moveTo(px - 12, py + 8); c.lineTo(px - 2, py - 4); c.lineTo(px + 4, py + 2); c.lineTo(px + 13, py - 9); }
    else { c.ellipse(px, py, 13, 6, 0.4, 0, Math.PI * 2); }
    c.stroke();
  }
  c.restore();
};

/** A Telegram channel: posts arrive one by one at the bottom and push the older ones up. */
const feed = (c: Ctx, w: number, h: number, content: ScreenContent, surface: Surface) => {
  const vertical = surface === "vertical";
  c.fillStyle = "#0e1621"; c.fillRect(0, 0, w, h);
  const left = vertical ? 0 : 380;
  chatPattern(c, left, 0, w - left, h);
  if (!vertical) {
    c.fillStyle = "#17212b"; c.fillRect(0, 0, 380, h);
    [content.title, "Bitcoin News", "Крипто Чат", "Gold Signals", "Избранное", "Мама"].forEach((name, i) => {
      const y = 30 + i * 96;
      if (i === 0) box(c, 0, y - 10, 380, 92, 0, "#2b5278");
      drawAvatar(c, name, 56, y + 36, 32, i);
      font(c, 23, 700); c.fillStyle = "#e9eef3"; c.fillText(fit(c, name, 250), 104, y + 28);
      font(c, 19, 600); c.fillStyle = i === 0 ? "#cfe2f5" : "#6d7f8f"; c.fillText(fit(c, i === 0 ? content.lines[content.lines.length - 1] ?? "" : "…", 250), 104, y + 62);
    });
  }
  // posts: bottom-aligned bubbles; the channel was there before, so all but the last two are already posted
  const size = vertical ? 34 : 28;
  const lineH = size * 1.4;
  const bubbleL = left + (vertical ? 24 : 40);
  const bubbleW = vertical ? w - 48 : Math.min(680, w - left - 80);
  font(c, size, 600);
  const fresh = Math.max(0, content.lines.length - 2);
  const banner = vertical ? 300 : 220;
  const posts = content.lines.map((text, i) => ({ text: wrap(c, text, bubbleW - 48), k: i < fresh ? 1 : appear(content.since, i - fresh, 1.4, 0.8) })).filter((p) => p.k > 0);
  let y = h - (vertical ? 60 : 50);
  for (let i = posts.length - 1; i >= 0 && y > 0; i--) {
    const p = posts[i];
    // the oldest post is the channel's promo with a picture
    const pic = i === 0 ? banner : 0;
    const bh = p.text.length * lineH + 70 + pic;
    const slide = (1 - p.k) * 40;
    y -= bh * (i === posts.length - 1 ? p.k : 1);
    c.globalAlpha = p.k;
    box(c, bubbleL, y + slide, bubbleW, bh - 18, 18, "#182533");
    if (pic) drawPromo(c, content.title, bubbleL, y + slide, bubbleW, pic);
    font(c, size, 600);
    p.text.forEach((l, j) => { c.fillStyle = accentOf(l) ?? "#e9eef3"; c.fillText(l, bubbleL + 24, y + slide + pic + 12 + size + j * lineH); });
    font(c, vertical ? 19 : 17, 600); c.fillStyle = "#6d8aa5"; c.textAlign = "right";
    const meta = `${(3 + hash(i, 5) * 40).toFixed(1)}K   21:${String(10 + i * 3).padStart(2, "0")}`;
    c.fillText(meta, bubbleL + bubbleW - 20, y + slide + bh - 32);
    drawEye(c, bubbleL + bubbleW - 30 - c.measureText(meta).width, y + slide + bh - 38, vertical ? 11 : 10, "#6d8aa5");
    c.textAlign = "left"; c.globalAlpha = 1;
    y -= 6;
  }
  // the channel header stays on top of the posts that scrolled under it, the pinned post under it
  const head = vertical ? 130 : 90;
  const pin = vertical ? 74 : 58;
  c.fillStyle = "#17212b"; c.fillRect(left, head, w - left, pin);
  c.fillStyle = "rgba(0,0,0,0.35)"; c.fillRect(left, head + pin - 2, w - left, 2);
  box(c, left + 20, head + 12, 4, pin - 24, 2, "#5eb5f7");
  font(c, vertical ? 21 : 17, 700); c.fillStyle = "#5eb5f7"; c.fillText("Закреплённое сообщение", left + 38, head + pin * 0.42);
  font(c, vertical ? 21 : 17, 600); c.fillStyle = "#8da2b5"; c.fillText(fit(c, content.lines[0] ?? "", w - left - 80), left + 38, head + pin * 0.8);
  c.fillStyle = "#17212b"; c.fillRect(left, 0, w - left, head);
  font(c, vertical ? 30 : 25, 700); c.fillStyle = "#e9eef3"; c.fillText(fit(c, content.title, w - left - 220), left + (vertical ? 126 : 92), vertical ? 60 : 40);
  font(c, vertical ? 22 : 19, 600); c.fillStyle = "#6d7f8f"; c.fillText("128 450 подписчиков", left + (vertical ? 126 : 92), vertical ? 98 : 70);
  drawAvatar(c, content.title, left + (vertical ? 70 : 50), vertical ? 66 : 45, vertical ? 38 : 28, 0);
};

/** A wallet: its balance, a balance curve, the actions and the history rows arriving in turn. */
const wallet = (c: Ctx, w: number, h: number, content: ScreenContent, surface: Surface, t: number) => {
  const vertical = surface === "vertical";
  c.fillStyle = "#101318"; c.fillRect(0, 0, w, h);
  const falling = content.trend === "down" || content.trend === "dump" || content.lines.slice(1).filter((l) => accentOf(l) === RED).length > content.lines.slice(1).filter((l) => accentOf(l) === GREEN).length;
  const colW = vertical ? w : 820;
  font(c, vertical ? 30 : 28, 700); c.fillStyle = "#8a93a6"; c.fillText(fit(c, content.title, colW - 80), 40, vertical ? 90 : 70);
  font(c, vertical ? 76 : 84, 800, MONO); c.fillStyle = "#f2f4f8"; c.fillText(content.lines[0] ?? "", 40, vertical ? 200 : 190);
  sparkline(c, 40, vertical ? 250 : 240, colW - 80, vertical ? 220 : 300, seedOf(content.title), !falling, t);
  const actions = ["Отправить", "Получить", "Обменять", "Купить"];
  actions.forEach((a, i) => {
    const x = 40 + ((colW - 80) / 4) * (i + 0.5);
    const y = vertical ? 560 : 640;
    c.fillStyle = "#1f2530"; c.beginPath(); c.arc(x, y, 40, 0, Math.PI * 2); c.fill();
    drawActionIcon(c, (["send", "receive", "swap", "buy"] as ActionIcon[])[i], x, y, 40, "#f0b90b");
    font(c, 20, 600); c.fillStyle = "#8a93a6"; c.textAlign = "center"; c.fillText(a, x, y + 78); c.textAlign = "left";
  });
  const listX = vertical ? 0 : 840;
  const listY = vertical ? 700 : 40;
  if (!vertical) { c.fillStyle = "#151a21"; c.fillRect(listX, 0, w - listX, h); }
  font(c, 26, 800); c.fillStyle = "#eaecef"; c.fillText("История", listX + 36, listY + 40);
  content.lines.slice(1).forEach((line, i) => {
    const k = appear(content.since, i, 0.55);
    if (k <= 0) return;
    const y = listY + 80 + i * 96 + (1 - k) * 24;
    c.globalAlpha = k;
    const accent = accentOf(line);
    c.fillStyle = accent === RED ? "rgba(246,70,93,0.18)" : accent === GREEN ? "rgba(46,189,133,0.18)" : "#1f2530";
    c.beginPath(); c.arc(listX + 66, y + 34, 28, 0, Math.PI * 2); c.fill();
    drawActionIcon(c, accent === RED ? "send" : accent === GREEN ? "receive" : "swap", listX + 66, y + 34, 26, accent ?? "#8a93a6");
    font(c, 24, 600, MONO); c.fillStyle = accent ?? "#d5d9e2"; c.fillText(fit(c, line, w - listX - 150), listX + 114, y + 44);
    c.fillStyle = "rgba(255,255,255,0.05)"; c.fillRect(listX + 36, y + 84, w - listX - 72, 2);
    c.globalAlpha = 1;
  });
};

/** A news site: the headlines of the story, the first one breaking. */
const LIQUIDATED = /ликвид|liquidat/i;

/**
 * A futures position, the fact the floating windows used to carry (the owner, 2026-10-23: «окошко летает просто как
 * эмоция»): the pair with its leverage, the candles of the move, the position's rows — side, entry, price, margin,
 * PnL — and a red stamp once it is liquidated. The rows arrive one by one, the stamp lands last.
 */
const position = (c: Ctx, w: number, h: number, content: ScreenContent, surface: Surface, t: number) => {
  const vertical = surface === "vertical";
  c.fillStyle = "#0b0e11"; c.fillRect(0, 0, w, h);
  const liquidated = content.lines.some((l) => LIQUIDATED.test(l));
  const falling = liquidated || content.trend === "down" || content.trend === "dump" || content.lines.some((l) => accentOf(l) === RED);
  // header: coin, pair and leverage, the perpetual tag
  drawCoin(c, content.title, vertical ? 64 : 54, vertical ? 84 : 52, vertical ? 32 : 26);
  font(c, vertical ? 34 : 30, 800); c.fillStyle = "#eaecef"; c.fillText(fit(c, content.title, vertical ? w - 250 : 560), vertical ? 112 : 92, vertical ? 96 : 64);
  const tagX = (vertical ? 112 : 92) + Math.min(c.measureText(content.title).width, vertical ? w - 250 : 560) + 18;
  box(c, tagX, vertical ? 70 : 40, 150, vertical ? 36 : 32, 8, "#1f2530");
  font(c, vertical ? 19 : 17, 700); c.fillStyle = "#8a93a6"; c.fillText("Бессрочный", tagX + 14, vertical ? 95 : 62);
  // the move that made the position
  const chartBox = vertical ? { x: 24, y: 150, w: w - 110, h: 420, vol: 80 } : { x: 30, y: 110, w: 820, h: 560, vol: 140 };
  candles(c, chartBox.x, chartBox.y, chartBox.w, chartBox.h, chartBox.vol, { ...content, trend: content.trend ?? (falling ? "dump" : "pump") }, t);
  // the position card
  const card = vertical ? { x: 24, y: 700, w: w - 48, h: h - 740 } : { x: 890, y: 110, w: w - 920, h: h - 150 };
  box(c, card.x, card.y, card.w, card.h, 16, "#151a21");
  font(c, vertical ? 26 : 24, 800); c.fillStyle = "#eaecef"; c.fillText("Позиция", card.x + 26, card.y + 46);
  const rowH = vertical ? 74 : 70;
  content.lines.forEach((line, i) => {
    const k = appear(content.since, i, 0.45, 0.2);
    if (k <= 0) return;
    const y = card.y + 92 + i * rowH + (1 - k) * 16;
    c.globalAlpha = k;
    const side = /^(long|short|лонг|шорт)/i.exec(line.trim());
    if (side) {
      const long = /^(long|лонг)/i.test(side[0]);
      box(c, card.x + 26, y - 6, 120, 46, 10, long ? "rgba(46,189,133,0.2)" : "rgba(246,70,93,0.2)");
      font(c, vertical ? 26 : 24, 800); c.fillStyle = long ? GREEN : RED; c.fillText(side[0].toUpperCase(), card.x + 42, y + 26);
      font(c, vertical ? 26 : 24, 700, MONO); c.fillStyle = "#eaecef"; c.fillText(fit(c, line.trim().slice(side[0].length).trim(), card.w - 200), card.x + 166, y + 26);
    } else {
      const pnl = /pnl|прибыл|убыт|результат/i.test(line);
      font(c, pnl ? (vertical ? 36 : 32) : vertical ? 26 : 24, pnl ? 800 : 600, MONO);
      c.fillStyle = accentOf(line) ?? (LIQUIDATED.test(line) ? RED : "#d5d9e2");
      c.fillText(fit(c, line, card.w - 52), card.x + 26, y + 26);
    }
    c.fillStyle = "rgba(255,255,255,0.05)"; c.fillRect(card.x + 26, y + rowH - 22, card.w - 52, 2);
    c.globalAlpha = 1;
  });
  if (liquidated) {
    // the stamp lands after the rows: a red seal across the card
    const k = smooth((content.since - 0.45 * content.lines.length - 0.4) / 0.25);
    if (k > 0) {
      c.save();
      c.translate(card.x + card.w / 2, card.y + card.h * 0.62);
      c.rotate(-0.18);
      c.scale(1.4 - 0.4 * k, 1.4 - 0.4 * k);
      c.globalAlpha = k * 0.92;
      const sw = Math.min(card.w * 0.86, vertical ? 560 : 440);
      c.strokeStyle = RED; c.lineWidth = 8; c.beginPath(); c.roundRect(-sw / 2, -52, sw, 104, 14); c.stroke();
      c.lineWidth = 3; c.beginPath(); c.roundRect(-sw / 2 + 12, -40, sw - 24, 80, 10); c.stroke();
      font(c, vertical ? 52 : 44, 800); c.fillStyle = RED; c.textAlign = "center"; c.fillText("ЛИКВИДАЦИЯ", 0, vertical ? 18 : 16);
      c.restore();
    }
  }
};

const news = (c: Ctx, w: number, h: number, content: ScreenContent, surface: Surface, t: number) => {
  const vertical = surface === "vertical";
  // a dark news site: the room stays at night
  c.fillStyle = "#0f1115"; c.fillRect(0, 0, w, h);
  c.fillStyle = "#16191f"; c.fillRect(0, 0, w, vertical ? 120 : 96);
  box(c, 0, (vertical ? 120 : 96) - 4, w, 4, 0, "#dc2626");
  font(c, vertical ? 38 : 36, 800); c.fillStyle = "#eef0f4"; c.fillText(fit(c, content.title.toUpperCase(), w - 80), 36, vertical ? 76 : 62);
  const cols = vertical ? 1 : 2;
  const cardW = (w - 36 * (cols + 1)) / cols;
  const cardH = vertical ? 300 : 360;
  content.lines.forEach((headline, i) => {
    const k = appear(content.since, i, 0.7);
    if (k <= 0) return;
    const col = i % cols; const row = Math.floor(i / cols);
    const x = 36 + col * (cardW + 36); const y = (vertical ? 150 : 126) + row * (cardH + 30) + (1 - k) * 20;
    if (y > h) return;
    c.globalAlpha = k;
    box(c, x, y, cardW, cardH, 14, "#1b1f26");
    drawThumb(c, headline, x, y, cardW, cardH * 0.45);
    if (i === 0) {
      const pulse = 0.75 + 0.25 * Math.sin(t * 6);
      c.globalAlpha = k * pulse; box(c, x + 18, y + 18, 150, 40, 8, "#dc2626"); c.globalAlpha = k;
      font(c, 22, 800); c.fillStyle = "#fff"; c.fillText("СРОЧНО", x + 34, y + 46);
    }
    font(c, vertical ? 30 : 30, 800); c.fillStyle = accentOf(headline) === RED ? "#ff7b7b" : "#eef0f4";
    wrap(c, headline, cardW - 44).slice(0, 3).forEach((l, j) => c.fillText(l, x + 22, y + cardH * 0.45 + 46 + j * 40));
    font(c, 20, 600); c.fillStyle = "#7b8494"; c.fillText(`${2 + i * 4} мин назад`, x + 22, y + cardH - 22);
    c.globalAlpha = 1;
  });
};

/** Paints one screen's picture: one of the director's apps, or the screen's idle picture. */
export const paintScreen = (c: Ctx, w: number, h: number, surface: Surface, content: ScreenContent, t: number) => {
  c.save();
  c.textBaseline = "alphabetic"; c.textAlign = "left";
  switch (content.app) {
    case "home": if (surface === "monitor") homeMonitor(c, w, h); else homeVertical(c, w, h, t); break;
    case "chat": chat(c, w, h, content, surface); break;
    case "chart": chart(c, w, h, content, surface, t); break;
    case "feed": feed(c, w, h, content, surface); break;
    case "wallet": wallet(c, w, h, content, surface, t); break;
    case "news": news(c, w, h, content, surface, t); break;
    case "position": position(c, w, h, content, surface, t); break;
  }
  c.restore();
};

/** The light a screen throws on whoever stands before it: its main colour and how bright it is. */
export const screenGlow = (content: ScreenContent): { color: string; power: number } => {
  switch (content.app) {
    case "chart": {
      const falling = content.trend === "down" || content.trend === "dump" || accentOf(content.lines[1] ?? "") === RED;
      return { color: falling ? "#ff4d62" : "#3ee09a", power: 0.9 };
    }
    case "feed": return { color: "#5aa0e6", power: 0.75 };
    case "wallet": return { color: "#e9c25a", power: 0.7 };
    case "news": return { color: "#c9d2e6", power: 0.7 };
    case "position": return content.lines.some((l) => LIQUIDATED.test(l) || accentOf(l) === RED) ? { color: "#ff4d62", power: 0.95 } : { color: "#3ee09a", power: 0.85 };
    case "chat": return { color: "#e8a07a", power: 0.6 };
    default: return { color: "#7f9cf0", power: 0.65 };
  }
};

// ---------------------------------------------------------------- the desktop around the app

/** Size an app is drawn at, and the size of the whole screen it sits on. */
export const APP_SIZE: Record<Surface, [number, number]> = { monitor: [1440, 900], vertical: [700, 1400] };
// the screens' own proportions (layout.ts): 27 × 16 and 11.5 × 20.5
export const DESK_SIZE: Record<Surface, [number, number]> = { monitor: [2400, 1422], vertical: [1000, 1783] };
/**
 * Where the app's window shows on its screen: the left top of its content and its scale. A real monitor shows an app as
 * a window on a desktop — wallpaper round it, a dock below, text a percent or two of the screen's height. Filling the
 * whole screen with it at phone size made the vertical screen read as a poster, not as a monitor (the owner, 2026-10-23).
 */
const WINDOW: Record<Surface, { x: number; y: number; scale: number }> = {
  monitor: { x: 372, y: 140, scale: 1.15 },
  // a little right of the middle: the owner's close-up sees the screen's left edge, and the wallpaper there
  vertical: { x: 236, y: 440, scale: 0.86 },
};
const APP_NAMES: Record<ScreenContent["app"], string> = { home: "", chat: "Claude", chart: "Биржа", feed: "Телеграм", wallet: "Кошелёк", news: "Новости", position: "Фьючерсы" };
export const appName = (content: ScreenContent, surface: Surface) => content.app === "home" ? (surface === "monitor" ? "Claude" : "Рынок") : APP_NAMES[content.app];

const wallpapers = new Map<Surface, HTMLCanvasElement>();
/** The desktop wallpaper: the vertical screen keeps the room's blue-violet waves, the monitor a dusk of Claude's colours. */
const wallpaper = (surface: Surface) => {
  const hit = wallpapers.get(surface);
  if (hit) return hit;
  const [w, h] = DESK_SIZE[surface];
  const canvas = document.createElement("canvas"); canvas.width = w; canvas.height = h;
  const c = canvas.getContext("2d")!;
  const g = c.createLinearGradient(0, 0, w, h);
  if (surface === "vertical") { g.addColorStop(0, "#213f67"); g.addColorStop(0.45, "#192744"); g.addColorStop(1, "#060b1b"); }
  else { g.addColorStop(0, "#2a1b3d"); g.addColorStop(0.5, "#16121f"); g.addColorStop(1, "#0a0910"); }
  c.fillStyle = g; c.fillRect(0, 0, w, h);
  const k = w / 700;
  for (let i = 0; i < 15; i++) {
    c.strokeStyle = surface === "vertical" ? `rgba(${i % 2 ? "117,192,221" : "182,145,255"},${0.15 + i * 0.02})` : `rgba(${i % 2 ? "217,119,87" : "150,110,230"},${0.08 + i * 0.012})`;
    c.lineWidth = (2 + i * 0.3) * k * (surface === "vertical" ? 1 : 0.4);
    c.beginPath();
    if (surface === "vertical") { c.moveTo(-100 * k, (120 + i * 75) * k); c.bezierCurveTo(650 * k, (80 + i * 55) * k, 0, (700 + i * 55) * k, 820 * k, (770 + i * 66) * k); }
    else { c.moveTo(-50, h * (0.35 + i * 0.03)); c.bezierCurveTo(w * 0.35, h * (0.1 + i * 0.035), w * 0.6, h * (0.9 - i * 0.02), w + 50, h * (0.45 + i * 0.03)); }
    c.stroke();
  }
  wallpapers.set(surface, canvas);
  return canvas;
};

/** The dock: the apps of the story first, then the ones every desktop has. */
const DOCK: AppIcon[] = ["claude", "telegram", "exchange", "wallet", "news", "browser", "notes", "folder", "settings"];
/** Which dock icon is the open app: the window's title. */
const OPEN: Record<string, AppIcon> = { Claude: "claude", "Телеграм": "telegram", "Биржа": "exchange", "Рынок": "exchange", "Кошелёк": "wallet", "Новости": "news", "Фьючерсы": "exchange" };

const canvasOf = (w: number, h: number) => {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  return canvas;
};

/** Under the app: the wallpaper, the menu bar and the window with its title bar and shadow. */
const paintUnder = (c: Ctx, surface: Surface, name: string) => {
  const [w] = DESK_SIZE[surface];
  const [aw, ah] = APP_SIZE[surface];
  const { x, y, scale } = WINDOW[surface];
  const k = surface === "monitor" ? 1.6 : 1.3;
  c.drawImage(wallpaper(surface), 0, 0);
  // menu bar
  c.fillStyle = "rgba(10,12,18,0.55)"; c.fillRect(0, 0, w, 30 * k);
  drawStatus(c, w - 24 * k, 15 * k, k, "21:47");
  font(c, 16 * k, 800); c.fillStyle = "rgba(235,238,245,0.92)"; c.textAlign = "left"; c.fillText(name, 24 * k, 21 * k);
  font(c, 16 * k, 600); c.fillStyle = "rgba(220,224,235,0.6)";
  ["Файл", "Правка", "Вид", "Окно"].reduce((mx, item) => { c.fillText(item, mx, 21 * k); return mx + c.measureText(item).width + 22 * k; }, 24 * k + c.measureText(name).width * 1.08 + 28 * k);
  // the window
  const cw = aw * scale; const ch = ah * scale; const bar = 30 * k; const r = 12 * k;
  c.shadowColor = "rgba(0,0,0,0.65)"; c.shadowBlur = 50 * k; c.shadowOffsetY = 12 * k;
  box(c, x, y - bar, cw, ch + bar, r, "#1d2027");
  c.shadowColor = "transparent";
  c.fillStyle = "#262a33"; c.beginPath(); c.roundRect(x, y - bar, cw, bar, [r, r, 0, 0]); c.fill();
  ["#ff5f57", "#febc2e", "#28c840"].forEach((color, i) => { c.fillStyle = color; c.beginPath(); c.arc(x + (18 + i * 18) * k, y - bar / 2, 5.5 * k, 0, Math.PI * 2); c.fill(); });
  font(c, 15 * k, 600); c.fillStyle = "rgba(220,224,235,0.75)"; c.textAlign = "center"; c.fillText(name, x + cw / 2, y - bar / 2 + 5 * k); c.textAlign = "left";
};

/** Over the app: the dock with the open app marked, the glass of the screen, and the dim that keeps it behind the heroes. */
const paintOver = (c: Ctx, surface: Surface, name: string, dim: number) => {
  const [w, h] = DESK_SIZE[surface];
  const k = surface === "monitor" ? 1.6 : 1.3;
  // the dock
  const size = 46 * k; const gap = 12 * k;
  const dw = DOCK.length * (size + gap) + gap;
  const dx = (w - dw) / 2; const dy = h - size - 26 * k;
  box(c, dx, dy - gap, dw, size + gap * 2, 16 * k, "rgba(28,31,40,0.72)");
  DOCK.forEach((icon, i) => {
    const ix = dx + gap + i * (size + gap);
    drawAppIcon(c, icon, ix, dy, size);
    if (icon === OPEN[name]) { c.fillStyle = "rgba(240,240,250,0.9)"; c.beginPath(); c.arc(ix + size / 2, dy + size + gap * 0.55, 3 * k, 0, Math.PI * 2); c.fill(); }
  });
  // the glass: a soft glare of the room across the top left, edges a little darker
  const glare = c.createLinearGradient(0, 0, w * 0.7, h * 0.55);
  glare.addColorStop(0, "rgba(255,255,255,0.07)"); glare.addColorStop(0.5, "rgba(255,255,255,0.025)"); glare.addColorStop(1, "rgba(255,255,255,0)");
  c.fillStyle = glare; c.fillRect(0, 0, w, h);
  const edge = c.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.hypot(w, h) * 0.6);
  edge.addColorStop(0, "rgba(0,0,0,0)"); edge.addColorStop(1, "rgba(0,0,0,0.38)");
  c.fillStyle = edge; c.fillRect(0, 0, w, h);
  if (dim > 0) { c.fillStyle = `rgba(8,8,12,${dim})`; c.fillRect(0, 0, w, h); }
};

/**
 * The still layers of a desktop by surface, app name and dim: everything under the app and everything over it. Only the
 * app inside the window moves, so a repaint needs nothing else (Screens.tsx).
 */
const layers = new Map<string, { under: HTMLCanvasElement; over: HTMLCanvasElement }>();
export const desktopLayers = (surface: Surface, name: string, dim: number) => {
  const key = `${surface}|${name}|${dim}`;
  const hit = layers.get(key);
  if (hit) return hit;
  const [w, h] = DESK_SIZE[surface];
  const under = canvasOf(w, h);
  paintUnder(under.getContext("2d")!, surface, name);
  const over = canvasOf(w, h);
  paintOver(over.getContext("2d")!, surface, name, dim);
  const made = { under, over };
  layers.set(key, made);
  return made;
};

/** The app's place on its desktop in desk pixels — left, top, width, height — and the radius of its bottom corners. */
export const windowRect = (surface: Surface) => {
  const [aw, ah] = APP_SIZE[surface];
  const { x, y, scale } = WINDOW[surface];
  return { x, y, w: aw * scale, h: ah * scale, radius: 12 * (surface === "monitor" ? 1.6 : 1.3) };
};

/**
 * The app on its desktop: wallpaper, the window with its title bar and shadow, the menu bar, the dock with the open
 * app marked, and the glass of the screen — a soft glare from the room and darker edges. dim darkens the whole screen
 * on top. The room's screens put the same layers together on the graphics card (Screens.tsx); this is the flat
 * picture for the sheet of screens (ScreenSheet.tsx).
 */
export const paintDesktop = (c: Ctx, surface: Surface, app: HTMLCanvasElement, name: string, dim = 0) => {
  const { x, y, w, h, radius } = windowRect(surface);
  const { under, over } = desktopLayers(surface, name, dim);
  c.drawImage(under, 0, 0);
  c.save(); c.beginPath(); c.roundRect(x, y, w, h, [0, 0, radius, radius]); c.clip(); c.drawImage(app, x, y, w, h); c.restore();
  c.drawImage(over, 0, 0);
};
