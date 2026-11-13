/**
 * The small pictures of the screens, drawn as real vector icons: the dock's apps, the coins of the market, the wallet's
 * buttons, the menu bar's status and the news photos. The owner (2026-10-23): «что за иконки надуманные? … даже если
 * будут смотреть покадрово, чтобы выглядело идеально» — no letters in squares, each icon is what it shows.
 */
type Ctx = CanvasRenderingContext2D;

const squircle = (c: Ctx, x: number, y: number, s: number) => { c.beginPath(); c.roundRect(x, y, s, s, s * 0.225); };

const vertical = (c: Ctx, y: number, h: number, top: string, bottom: string) => {
  const g = c.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, top); g.addColorStop(1, bottom);
  return g;
};

/** The glass of an app icon: a soft light across its top and a thin dark rim. */
const iconGloss = (c: Ctx, x: number, y: number, s: number) => {
  c.save();
  squircle(c, x, y, s); c.clip();
  const g = c.createLinearGradient(0, y, 0, y + s * 0.55);
  g.addColorStop(0, "rgba(255,255,255,0.22)"); g.addColorStop(1, "rgba(255,255,255,0)");
  c.fillStyle = g; c.fillRect(x, y, s, s * 0.55);
  c.restore();
  c.strokeStyle = "rgba(0,0,0,0.35)"; c.lineWidth = Math.max(1, s * 0.02); squircle(c, x, y, s); c.stroke();
};

const poly = (c: Ctx, pts: [number, number][], fill: string | CanvasGradient) => {
  c.beginPath(); pts.forEach(([px, py], i) => (i ? c.lineTo(px, py) : c.moveTo(px, py))); c.closePath(); c.fillStyle = fill; c.fill();
};

export type AppIcon = "claude" | "telegram" | "exchange" | "wallet" | "browser" | "news" | "notes" | "settings" | "folder";

/** One app icon of the dock, `s` wide, its top left at x, y. */
export const drawAppIcon = (c: Ctx, icon: AppIcon, x: number, y: number, s: number) => {
  c.save();
  const u = s / 100;
  const P = (px: number, py: number): [number, number] => [x + px * u, y + py * u];
  switch (icon) {
    case "claude": {
      // our Claude on a warm dark tile: the orange block with its eyes and short legs
      c.fillStyle = vertical(c, y, s, "#3a2a22", "#1c1411"); squircle(c, x, y, s); c.fill();
      c.fillStyle = "#d97757";
      c.beginPath(); c.roundRect(x + 20 * u, y + 30 * u, 60 * u, 38 * u, 7 * u); c.fill();
      for (const lx of [26, 38, 56, 68]) c.fillRect(x + lx * u, y + 66 * u, 7 * u, 12 * u);
      c.fillRect(x + 13 * u, y + 40 * u, 8 * u, 12 * u); c.fillRect(x + 79 * u, y + 40 * u, 8 * u, 12 * u);
      c.fillStyle = "#1d1512";
      c.beginPath(); c.roundRect(x + 35 * u, y + 40 * u, 7 * u, 10 * u, 2 * u); c.roundRect(x + 58 * u, y + 40 * u, 7 * u, 10 * u, 2 * u); c.fill();
      break;
    }
    case "telegram": {
      c.fillStyle = vertical(c, y, s, "#41b8ec", "#1d93d2"); squircle(c, x, y, s); c.fill();
      // the paper plane: a white wing and the folded shadow under it
      poly(c, [P(18, 48), P(80, 24), P(70, 76), P(48, 62)], "#ffffff");
      poly(c, [P(48, 62), P(40, 76), P(41, 58), P(72, 32)], "#c8daea");
      poly(c, [P(40, 76), P(48, 62), P(54, 66)], "#a9c9e0");
      break;
    }
    case "exchange": {
      c.fillStyle = vertical(c, y, s, "#1b2129", "#0b0e11"); squircle(c, x, y, s); c.fill();
      c.strokeStyle = "rgba(255,255,255,0.08)"; c.lineWidth = u;
      for (const gy of [30, 50, 70]) { c.beginPath(); c.moveTo(x + 14 * u, y + gy * u); c.lineTo(x + 86 * u, y + gy * u); c.stroke(); }
      const candles: [number, number, number, number, number, string][] = [[24, 34, 62, 40, 56, "#2ebd85"], [42, 28, 70, 46, 64, "#f6465d"], [60, 22, 58, 28, 48, "#2ebd85"], [77, 14, 44, 18, 36, "#2ebd85"]];
      for (const [cx, hi, lo, top, bottom, color] of candles) {
        c.fillStyle = color; c.fillRect(x + (cx - 1) * u, y + hi * u, 2 * u, (lo - hi) * u);
        c.beginPath(); c.roundRect(x + (cx - 5) * u, y + top * u, 10 * u, (bottom - top) * u, 1.5 * u); c.fill();
      }
      c.strokeStyle = "#f0b90b"; c.lineWidth = 2.5 * u; c.beginPath(); c.moveTo(x + 16 * u, y + 76 * u);
      c.bezierCurveTo(x + 40 * u, y + 70 * u, x + 55 * u, y + 52 * u, x + 86 * u, y + 30 * u); c.stroke();
      break;
    }
    case "wallet": {
      c.fillStyle = vertical(c, y, s, "#2fd3a8", "#0f8f73"); squircle(c, x, y, s); c.fill();
      c.fillStyle = "#7a4a2a"; c.beginPath(); c.roundRect(x + 18 * u, y + 30 * u, 64 * u, 46 * u, 8 * u); c.fill();
      c.fillStyle = "#9b6238"; c.beginPath(); c.roundRect(x + 18 * u, y + 30 * u, 64 * u, 14 * u, [8 * u, 8 * u, 0, 0]); c.fill();
      c.fillStyle = "#5e3820"; c.beginPath(); c.roundRect(x + 52 * u, y + 46 * u, 32 * u, 18 * u, 5 * u); c.fill();
      c.fillStyle = "#f2c94c"; c.beginPath(); c.arc(x + 63 * u, y + 55 * u, 4.5 * u, 0, Math.PI * 2); c.fill();
      c.strokeStyle = "rgba(255,230,190,0.35)"; c.setLineDash([3 * u, 3 * u]); c.lineWidth = 1.2 * u;
      c.beginPath(); c.roundRect(x + 22 * u, y + 34 * u, 56 * u, 38 * u, 6 * u); c.stroke(); c.setLineDash([]);
      break;
    }
    case "browser": {
      c.fillStyle = vertical(c, y, s, "#ffffff", "#e3e8ef"); squircle(c, x, y, s); c.fill();
      const cx = x + 50 * u; const cy = y + 50 * u; const r = 32 * u;
      const g = c.createRadialGradient(cx - r * 0.4, cy - r * 0.4, r * 0.1, cx, cy, r);
      g.addColorStop(0, "#5fb2ff"); g.addColorStop(1, "#1565d8");
      c.fillStyle = g; c.beginPath(); c.arc(cx, cy, r, 0, Math.PI * 2); c.fill();
      c.strokeStyle = "rgba(255,255,255,0.75)"; c.lineWidth = 2 * u;
      c.beginPath(); c.ellipse(cx, cy, r * 0.45, r, 0, 0, Math.PI * 2); c.stroke();
      c.beginPath(); c.moveTo(cx, cy - r); c.lineTo(cx, cy + r); c.stroke();
      for (const k of [-0.5, 0, 0.5]) { const w = Math.sqrt(1 - k * k) * r; c.beginPath(); c.moveTo(cx - w, cy + k * r); c.lineTo(cx + w, cy + k * r); c.stroke(); }
      break;
    }
    case "news": {
      c.fillStyle = vertical(c, y, s, "#ffffff", "#eceef2"); squircle(c, x, y, s); c.fill();
      c.fillStyle = "#e3342f"; c.beginPath(); c.roundRect(x + 16 * u, y + 18 * u, 68 * u, 16 * u, 3 * u); c.fill();
      c.fillStyle = "#c7cdd6"; c.beginPath(); c.roundRect(x + 16 * u, y + 40 * u, 30 * u, 24 * u, 3 * u); c.fill();
      c.fillStyle = "#8b95a5";
      for (const ly of [42, 50, 58]) c.fillRect(x + 52 * u, y + ly * u, 32 * u, 3.5 * u);
      for (const ly of [70, 78]) c.fillRect(x + 16 * u, y + ly * u, 68 * u, 3.5 * u);
      break;
    }
    case "notes": {
      c.fillStyle = vertical(c, y, s, "#ffffff", "#f1efe8"); squircle(c, x, y, s); c.fill();
      c.save(); squircle(c, x, y, s); c.clip();
      c.fillStyle = vertical(c, y, 26 * u, "#ffd84d", "#f5b800"); c.fillRect(x, y, s, 26 * u); c.restore();
      c.strokeStyle = "#d9d4c4"; c.lineWidth = 1.5 * u;
      for (const ly of [42, 54, 66, 78]) { c.beginPath(); c.moveTo(x + 14 * u, y + ly * u); c.lineTo(x + 86 * u, y + ly * u); c.stroke(); }
      c.strokeStyle = "#3b3b3b"; c.lineWidth = 2 * u; c.beginPath(); c.moveTo(x + 16 * u, y + 40 * u); c.lineTo(x + 58 * u, y + 40 * u); c.stroke();
      break;
    }
    case "settings": {
      c.fillStyle = vertical(c, y, s, "#9aa3ae", "#5e6670"); squircle(c, x, y, s); c.fill();
      const cx = x + 50 * u; const cy = y + 50 * u;
      c.fillStyle = vertical(c, y + 15 * u, 70 * u, "#f3f5f7", "#b9c0c8");
      c.beginPath();
      for (let i = 0; i < 24; i++) {
        const a = (i / 24) * Math.PI * 2;
        const r = (i % 2 ? 26 : 33) * u;
        const px = cx + Math.cos(a) * r; const py = cy + Math.sin(a) * r;
        if (i) c.lineTo(px, py); else c.moveTo(px, py);
      }
      c.closePath(); c.fill();
      c.fillStyle = "#6b737d"; c.beginPath(); c.arc(cx, cy, 14 * u, 0, Math.PI * 2); c.fill();
      c.fillStyle = "#d8dde3"; c.beginPath(); c.arc(cx, cy, 8 * u, 0, Math.PI * 2); c.fill();
      break;
    }
    case "folder": {
      c.fillStyle = vertical(c, y, s, "#e8f2ff", "#cfe3fb"); squircle(c, x, y, s); c.fill();
      c.fillStyle = "#3d8be8"; c.beginPath(); c.roundRect(x + 14 * u, y + 28 * u, 32 * u, 14 * u, 4 * u); c.fill();
      c.fillStyle = vertical(c, y + 34 * u, 42 * u, "#69aaf5", "#2f7ee0"); c.beginPath(); c.roundRect(x + 14 * u, y + 34 * u, 72 * u, 42 * u, 6 * u); c.fill();
      c.fillStyle = "rgba(255,255,255,0.25)"; c.fillRect(x + 14 * u, y + 40 * u, 72 * u, 2 * u);
      break;
    }
  }
  iconGloss(c, x, y, s);
  c.restore();
};

/** The coin logo of a pair, a circle of radius r: bitcoin, ether, gold, silver, Solana, Toncoin, BNB, tether. */
export const drawCoin = (c: Ctx, pair: string, x: number, y: number, r: number) => {
  const key = pair.toUpperCase();
  c.save();
  const disc = (fill: string | CanvasGradient) => { c.fillStyle = fill; c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill(); };
  const radial = (a: string, b: string) => { const g = c.createRadialGradient(x - r * 0.35, y - r * 0.35, r * 0.1, x, y, r); g.addColorStop(0, a); g.addColorStop(1, b); return g; };
  if (key.startsWith("BTC")) {
    disc(radial("#ffb547", "#f2900f"));
    c.save(); c.translate(x, y); c.rotate(0.24);
    c.fillStyle = "#ffffff"; c.font = `800 ${r * 1.25}px Inter, sans-serif`; c.textAlign = "center"; c.textBaseline = "middle";
    c.fillText("B", 0, r * 0.06);
    for (const dx of [-0.16, 0.12]) { c.fillRect(dx * r, -r * 0.72, r * 0.11, r * 0.2); c.fillRect(dx * r, r * 0.5, r * 0.11, r * 0.2); }
    c.restore();
  } else if (key.startsWith("ETH")) {
    disc(radial("#8aa2f5", "#5b73e2"));
    const t = r * 0.62;
    poly(c, [[x, y - t], [x + t * 0.6, y + t * 0.05], [x, y + t * 0.35], [x - t * 0.6, y + t * 0.05]], "rgba(255,255,255,0.95)");
    poly(c, [[x, y - t], [x + t * 0.6, y + t * 0.05], [x, y + t * 0.35]], "rgba(255,255,255,0.7)");
    poly(c, [[x, y + t * 0.48], [x + t * 0.6, y + t * 0.18], [x, y + t], [x - t * 0.6, y + t * 0.18]], "rgba(255,255,255,0.9)");
  } else if (key.startsWith("XAU") || key.startsWith("XAG")) {
    const gold = key.startsWith("XAU");
    disc(radial(gold ? "#fff1b8" : "#f4f6f9", gold ? "#c9962b" : "#8d95a1"));
    // a bar of the metal with its bevel
    const w = r * 1.15; const h = r * 0.55;
    poly(c, [[x - w / 2, y + h / 2], [x - w / 2 + h * 0.45, y - h / 2], [x + w / 2 - h * 0.45, y - h / 2], [x + w / 2, y + h / 2]], gold ? "#a8761b" : "#6b737d");
    poly(c, [[x - w / 2 + h * 0.45, y - h / 2], [x + w / 2 - h * 0.45, y - h / 2], [x + w / 2 - h * 0.7, y - h * 0.1], [x - w / 2 + h * 0.7, y - h * 0.1]], gold ? "#ffe08a" : "#e6eaef");
  } else if (key.startsWith("SOL")) {
    disc("#111318");
    const bar = (dy: number, flip: boolean) => {
      const g = c.createLinearGradient(x - r * 0.55, 0, x + r * 0.55, 0);
      g.addColorStop(0, "#00ffa3"); g.addColorStop(1, "#dc1fff");
      const k = r * 0.18;
      poly(c, flip
        ? [[x - r * 0.55, y + dy - k / 2], [x + r * 0.4, y + dy - k / 2], [x + r * 0.55, y + dy + k / 2], [x - r * 0.4, y + dy + k / 2]]
        : [[x - r * 0.4, y + dy - k / 2], [x + r * 0.55, y + dy - k / 2], [x + r * 0.4, y + dy + k / 2], [x - r * 0.55, y + dy + k / 2]], g);
    };
    bar(-r * 0.32, false); bar(0, true); bar(r * 0.32, false);
  } else if (key.startsWith("TON")) {
    disc(radial("#3ab4f5", "#0088cc"));
    poly(c, [[x - r * 0.48, y - r * 0.38], [x + r * 0.48, y - r * 0.38], [x, y + r * 0.55]], "#ffffff");
    poly(c, [[x - r * 0.3, y - r * 0.24], [x - r * 0.05, y - r * 0.24], [x - r * 0.05, y + r * 0.25]], "#0088cc");
    poly(c, [[x + r * 0.3, y - r * 0.24], [x + r * 0.05, y - r * 0.24], [x + r * 0.05, y + r * 0.25]], "#0088cc");
  } else if (key.startsWith("BNB")) {
    disc(radial("#ffd65c", "#f0b90b"));
    const sq = (cx: number, cy: number, h: number) => poly(c, [[cx, cy - h], [cx + h, cy], [cx, cy + h], [cx - h, cy]], "#ffffff");
    sq(x, y, r * 0.17);
    for (const [dx, dy] of [[0, -0.42], [0.42, 0], [0, 0.42], [-0.42, 0]]) sq(x + dx * r, y + dy * r, r * 0.13);
  } else {
    disc(radial("#3bc49b", "#1a9471"));
    c.strokeStyle = "#ffffff"; c.lineWidth = r * 0.11;
    c.beginPath(); c.ellipse(x, y + r * 0.05, r * 0.52, r * 0.17, 0, 0, Math.PI * 2); c.stroke();
    c.fillStyle = "#ffffff"; c.fillRect(x - r * 0.5, y - r * 0.52, r, r * 0.2); c.fillRect(x - r * 0.1, y - r * 0.52, r * 0.2, r * 1.05);
  }
  // a thin rim and a highlight: a coin, not a flat sticker
  c.strokeStyle = "rgba(0,0,0,0.25)"; c.lineWidth = Math.max(1, r * 0.05); c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.stroke();
  c.restore();
};

export type ActionIcon = "send" | "receive" | "swap" | "buy";

/** The wallet's round buttons: an arrow out, an arrow in, two arrows that swap, a plus. */
export const drawActionIcon = (c: Ctx, icon: ActionIcon, x: number, y: number, r: number, color: string) => {
  c.save();
  c.strokeStyle = color; c.lineWidth = r * 0.16; c.lineCap = "round"; c.lineJoin = "round";
  const arrow = (x0: number, y0: number, x1: number, y1: number) => {
    const a = Math.atan2(y1 - y0, x1 - x0); const h = r * 0.32;
    c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke();
    c.beginPath(); c.moveTo(x1 - h * Math.cos(a - 0.6), y1 - h * Math.sin(a - 0.6)); c.lineTo(x1, y1); c.lineTo(x1 - h * Math.cos(a + 0.6), y1 - h * Math.sin(a + 0.6)); c.stroke();
  };
  if (icon === "send") arrow(x - r * 0.3, y + r * 0.3, x + r * 0.32, y - r * 0.32);
  else if (icon === "receive") arrow(x + r * 0.3, y - r * 0.3, x - r * 0.32, y + r * 0.32);
  else if (icon === "swap") { arrow(x - r * 0.42, y - r * 0.18, x + r * 0.42, y - r * 0.18); arrow(x + r * 0.42, y + r * 0.2, x - r * 0.42, y + r * 0.2); }
  else { c.beginPath(); c.moveTo(x - r * 0.38, y); c.lineTo(x + r * 0.38, y); c.moveTo(x, y - r * 0.38); c.lineTo(x, y + r * 0.38); c.stroke(); }
  c.restore();
};

/** The menu bar's right corner: Wi-Fi, battery, clock. Right-aligned at x. */
export const drawStatus = (c: Ctx, x: number, y: number, k: number, time: string) => {
  c.save();
  c.font = `600 ${16 * k}px Inter, sans-serif`; c.textAlign = "right"; c.textBaseline = "middle"; c.fillStyle = "rgba(235,238,245,0.9)";
  c.fillText(time, x, y);
  const tw = c.measureText(time).width;
  // battery
  const bx = x - tw - 44 * k;
  c.strokeStyle = "rgba(235,238,245,0.85)"; c.lineWidth = 1.5 * k;
  c.beginPath(); c.roundRect(bx, y - 6 * k, 26 * k, 12 * k, 3 * k); c.stroke();
  c.fillStyle = "rgba(235,238,245,0.85)"; c.fillRect(bx + 26.5 * k, y - 2.5 * k, 2 * k, 5 * k); c.fillRect(bx + 2.5 * k, y - 3.5 * k, 17 * k, 7 * k);
  // wifi
  const wx = bx - 22 * k; const wy = y + 6 * k;
  c.lineCap = "round";
  for (const rr of [5, 10, 15]) { c.beginPath(); c.arc(wx, wy, rr * k, Math.PI * 1.25, Math.PI * 1.75); c.stroke(); }
  c.restore();
};

/** A news photo for a headline: a falling or rising chart, a coin, or the columns of a regulator. */
export const drawThumb = (c: Ctx, headline: string, x: number, y: number, w: number, h: number) => {
  c.save();
  c.beginPath(); c.roundRect(x, y, w, h, [14, 14, 0, 0]); c.clip();
  const text = headline.toLowerCase();
  const falling = /упал|обвал|ликвид|потер|теря|минус|крах|▼/.test(text);
  const rising = /вырос|рост|рекорд|▲|\+/.test(text);
  const bg = c.createLinearGradient(x, y, x + w, y + h);
  if (falling) { bg.addColorStop(0, "#3a0d14"); bg.addColorStop(1, "#120509"); }
  else if (rising) { bg.addColorStop(0, "#0b3325"); bg.addColorStop(1, "#04130d"); }
  else { bg.addColorStop(0, "#1b2340"); bg.addColorStop(1, "#0b0f1d"); }
  c.fillStyle = bg; c.fillRect(x, y, w, h);
  c.strokeStyle = "rgba(255,255,255,0.06)"; c.lineWidth = 1;
  for (let i = 1; i < 6; i++) { c.beginPath(); c.moveTo(x, y + (h * i) / 6); c.lineTo(x + w, y + (h * i) / 6); c.stroke(); }
  if (/регулятор|закон|суд|цб|банк|пирамид/.test(text)) {
    // a facade with columns
    const cx = x + w / 2; const base = y + h * 0.82; const bw = Math.min(w * 0.5, h * 0.9);
    c.fillStyle = "#c9cfdb";
    poly(c, [[cx - bw / 2, y + h * 0.36], [cx, y + h * 0.16], [cx + bw / 2, y + h * 0.36]], "#c9cfdb");
    c.fillRect(cx - bw / 2, y + h * 0.38, bw, h * 0.06);
    for (let i = 0; i < 5; i++) c.fillRect(cx - bw / 2 + bw * 0.06 + i * (bw * 0.88 / 4) - bw * 0.03, y + h * 0.46, bw * 0.06, h * 0.3);
    c.fillRect(cx - bw / 2 - bw * 0.04, base - h * 0.04, bw * 1.08, h * 0.06);
  } else if (falling || rising) {
    c.strokeStyle = falling ? "#ff4d62" : "#2ee59d"; c.lineWidth = Math.max(3, h * 0.025); c.lineJoin = "round";
    c.beginPath();
    for (let i = 0; i <= 14; i++) {
      const p = i / 14;
      const trend = falling ? (p < 0.7 ? 0.35 + Math.sin(i * 1.7) * 0.05 : 0.35 + (p - 0.7) * 1.8) : 0.75 - p * 0.5 + Math.sin(i * 1.9) * 0.05;
      const px = x + w * 0.06 + p * w * 0.88; const py = y + h * trend;
      if (i) c.lineTo(px, py); else c.moveTo(px, py);
    }
    c.stroke();
  }
  if (/биткоин|btc|bitcoin|крипт/.test(text)) drawCoin(c, "BTC", x + w * 0.82, y + h * 0.3, Math.min(w, h) * 0.16);
  c.restore();
};

/** Telegram's own avatar for a chat without a photo: a two-tone gradient circle with the initials. */
const AVATAR_TONES: [string, string][] = [["#ff885e", "#ff516a"], ["#a0de7e", "#54cb68"], ["#72d5fd", "#2a9ef1"], ["#ffcd6a", "#ffa85c"], ["#e0a2f3", "#d669ed"], ["#ffa3bd", "#ff6aa0"]];
export const drawAvatar = (c: Ctx, name: string, x: number, y: number, r: number, tone: number) => {
  const [a, b] = AVATAR_TONES[tone % AVATAR_TONES.length];
  const g = c.createLinearGradient(0, y - r, 0, y + r);
  g.addColorStop(0, a); g.addColorStop(1, b);
  c.save();
  c.fillStyle = g; c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill();
  const words = name.split(/\s+/).filter((w) => /^[\p{L}\d]/u.test(w));
  const initials = (words[0]?.[0] ?? "") + (words.length > 1 ? words[1][0] : "");
  c.fillStyle = "#ffffff"; c.font = `700 ${r * 0.78}px Inter, sans-serif`; c.textAlign = "center"; c.textBaseline = "middle";
  c.fillText(initials.toUpperCase(), x, y + r * 0.04);
  c.restore();
};

/** The views eye of a channel post. */
export const drawEye = (c: Ctx, x: number, y: number, r: number, color: string) => {
  c.save();
  c.strokeStyle = color; c.fillStyle = color; c.lineWidth = r * 0.22;
  c.beginPath(); c.moveTo(x - r, y); c.quadraticCurveTo(x, y - r * 0.95, x + r, y); c.quadraticCurveTo(x, y + r * 0.95, x - r, y); c.stroke();
  c.beginPath(); c.arc(x, y, r * 0.32, 0, Math.PI * 2); c.fill();
  c.restore();
};

/** A promo picture for a channel's pinned post: a rising chart, a stack of coins and a glow, under the channel's name. */
export const drawPromo = (c: Ctx, title: string, x: number, y: number, w: number, h: number) => {
  c.save();
  c.beginPath(); c.roundRect(x, y, w, h, [18, 18, 0, 0]); c.clip();
  const g = c.createLinearGradient(x, y, x + w, y + h);
  g.addColorStop(0, "#f0b90b"); g.addColorStop(0.55, "#d9480f"); g.addColorStop(1, "#5f1a37");
  c.fillStyle = g; c.fillRect(x, y, w, h);
  const glow = c.createRadialGradient(x + w * 0.78, y + h * 0.45, 0, x + w * 0.78, y + h * 0.45, h * 0.7);
  glow.addColorStop(0, "rgba(255,240,180,0.55)"); glow.addColorStop(1, "rgba(255,240,180,0)");
  c.fillStyle = glow; c.fillRect(x, y, w, h);
  // the chart going up to the right, with its arrowhead
  c.strokeStyle = "rgba(255,255,255,0.9)"; c.lineWidth = h * 0.035; c.lineJoin = "round"; c.lineCap = "round";
  const pts: [number, number][] = [[0.52, 0.86], [0.6, 0.7], [0.66, 0.76], [0.75, 0.52], [0.81, 0.58], [0.93, 0.22]];
  c.beginPath(); pts.forEach(([px, py], i) => (i ? c.lineTo(x + px * w, y + py * h) : c.moveTo(x + px * w, y + py * h))); c.stroke();
  poly(c, [[x + 0.93 * w, y + 0.12 * h], [x + 0.955 * w + h * 0.02, y + 0.3 * h], [x + 0.885 * w, y + 0.26 * h]], "rgba(255,255,255,0.9)");
  for (let i = 0; i < 4; i++) {
    const cy = y + h * (0.84 - i * 0.07);
    c.fillStyle = "#b8860b"; c.beginPath(); c.ellipse(x + w * 0.66, cy + h * 0.015, h * 0.11, h * 0.035, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = "#ffd75a"; c.beginPath(); c.ellipse(x + w * 0.66, cy, h * 0.11, h * 0.035, 0, 0, Math.PI * 2); c.fill();
  }
  c.fillStyle = "rgba(255,255,255,0.95)"; c.font = `800 ${h * 0.14}px Inter, sans-serif`; c.textBaseline = "alphabetic";
  const words = title.toUpperCase().split(/\s+/);
  const lines: string[] = [];
  for (const word of words) {
    const last = lines[lines.length - 1];
    if (last && c.measureText(`${last} ${word}`).width < w * 0.46) lines[lines.length - 1] = `${last} ${word}`; else lines.push(word);
  }
  lines.slice(0, 3).forEach((l, i) => c.fillText(l, x + w * 0.06, y + h * (0.32 + i * 0.17)));
  c.restore();
};
