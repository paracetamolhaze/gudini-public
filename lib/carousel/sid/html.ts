import fs from "fs";
import path from "path";
import type { SidContent, SidIcon, SidStep } from "./types";
import { esc, rich, tx } from "./content";

/**
 * Вёрстка слайдов — та же, что у одобренных владельцем каруселей 1–4 (собирались вручную, 27.10).
 * Счётчика «NN / 09» нет ни на одном слайде: вместе с крупными номерами шагов он сбивает (владелец, 27.10).
 * Шрифты — те, что уже есть в образе сайта: Montserrat Black (обложка и финал), Liberation Sans
 * (заголовки шагов и текст), Liberation Serif (номера шагов), Liberation Mono (ярлыки и плашки).
 */

export const SID_W = 1080;
export const SID_H = 1350;
/** окно со скриншотом: 956×378 видимой страницы */
export const SHOT_W = 956;
export const SHOT_H = 378;

const FONT_FILES: [family: string, weight: number, file: string][] = [
  ["Head", 900, "Montserrat-Black.ttf"],
  ["Serif", 700, "LiberationSerif-Bold.ttf"],
  ["Mono", 400, "LiberationMono-Regular.ttf"],
  ["Mono", 700, "LiberationMono-Bold.ttf"],
  ["Body", 400, "LiberationSans-Regular.ttf"],
  ["Body", 700, "LiberationSans-Bold.ttf"],
];

function fontPath(file: string): string {
  const dirs = [process.env.CAROUSEL_SID_FONT_DIR, path.join(process.cwd(), "fonts"), "/usr/share/fonts/truetype/liberation"].filter(Boolean) as string[];
  for (const d of dirs) {
    const p = path.join(d, file);
    if (fs.existsSync(p)) return p;
  }
  throw new Error(`Нет шрифта ${file} — вёрстка каруселей не соберётся`);
}

let fontCss: string | null = null;
export function fontFaces(): string {
  if (!fontCss) fontCss = FONT_FILES.map(([fam, w, file]) => `@font-face{font-family:${fam};font-weight:${w};src:url(data:font/ttf;base64,${fs.readFileSync(fontPath(file)).toString("base64")})}`).join("");
  return fontCss;
}

const ICONS: Record<SidIcon, string> = {
  cube: '<path d="M12 2.5l8.5 4.7v9.6L12 21.5l-8.5-4.7V7.2z"/><path d="M12 12l8.5-4.8M12 12v9.5M12 12L3.5 7.2"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5.2l3.5 2"/>',
  gavel: '<path d="M13.5 3.5l7 7-2.5 2.5-7-7z"/><path d="M8.5 8.5l7 7"/><path d="M11 11l-7.5 7.5"/><path d="M3 21h9"/>',
  mail: '<rect x="3" y="5.5" width="18" height="13" rx="2"/><path d="M3.5 6.5l8.5 6.5 8.5-6.5"/>',
  pause: '<rect x="6.5" y="5" width="3.5" height="14" rx="1"/><rect x="14" y="5" width="3.5" height="14" rx="1"/>',
  atom: '<circle cx="12" cy="12" r="1.6"/><ellipse cx="12" cy="12" rx="9" ry="3.6"/><ellipse cx="12" cy="12" rx="9" ry="3.6" transform="rotate(60 12 12)"/><ellipse cx="12" cy="12" rx="9" ry="3.6" transform="rotate(120 12 12)"/>',
  code: '<path d="M8.5 7l-5 5 5 5M15.5 7l5 5-5 5M13.5 4.5l-3 15"/>',
  shield: '<path d="M12 3l8 3v6c0 4.6-3.4 8-8 9-4.6-1-8-4.4-8-9V6z"/><path d="M8.5 12l2.5 2.5 4.5-5"/>',
  flag: '<path d="M5 21V4"/><path d="M5 4.5h11l-2.2 4 2.2 4H5"/>',
  doc: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M9 12h6M9 15.5h6M9 9h3"/>',
  snow: '<path d="M12 2.5v19M3.8 7.2l16.4 9.6M3.8 16.8l16.4-9.6"/><path d="M9.5 4.5L12 7l2.5-2.5M9.5 19.5L12 17l2.5 2.5"/>',
  chip: '<rect x="6.5" y="6.5" width="11" height="11" rx="1.5"/><rect x="9.5" y="9.5" width="5" height="5" rx=".5"/><path d="M9.5 3v3.5M14.5 3v3.5M9.5 17.5V21M14.5 17.5V21M3 9.5h3.5M3 14.5h3.5M17.5 9.5H21M17.5 14.5H21"/>',
  globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.6 2.4 3.8 5.2 3.8 8.5s-1.2 6.1-3.8 8.5c-2.6-2.4-3.8-5.2-3.8-8.5S9.4 5.9 12 3.5z"/>',
  search: '<circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5.5 5.5"/>',
  phone: '<rect x="7" y="2.5" width="10" height="19" rx="2"/><path d="M10.5 18.5h3"/>',
  chart: '<path d="M3.5 20.5h17"/><path d="M4.5 16l4-6 3 3 3.5-8 4.5 14"/>',
  coin: '<ellipse cx="12" cy="7" rx="7" ry="3"/><path d="M5 7v5c0 1.7 3.1 3 7 3s7-1.3 7-3V7"/><path d="M5 12v5c0 1.7 3.1 3 7 3s7-1.3 7-3v-5"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/><path d="M12 14.5v2.5"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1.2 1.2"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1.2-1.2"/>',
};
const icon = (k: SidIcon) => `<svg viewBox="0 0 24 24" width="25" height="25" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[k] ?? ICONS.doc}</svg>`;
const asterisk = (c: string) => `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="${c}" stroke-width="2.6" stroke-linecap="round"><path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9"/></svg>`;

export type SidLook = { accent: string; coverAccent: string; handle: string };

const base = (a: string) => `${fontFaces()}
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:1080px;height:1350px;overflow:hidden}
body{font-family:Body;-webkit-font-smoothing:antialiased;position:relative}
.paper{position:absolute;inset:0;background:#F3F1EC;background-image:radial-gradient(ellipse 80% 45% at 50% 0%,rgba(255,255,255,.85),rgba(255,255,255,0) 70%),linear-gradient(rgba(60,50,40,.07) 1px,transparent 1px),linear-gradient(90deg,rgba(60,50,40,.07) 1px,transparent 1px);background-size:100% 100%,54px 54px,54px 54px;background-position:0 0,-1px -1px,-1px -1px}
.bar{position:absolute;left:81px;top:90px;width:73px;height:6px;background:${a};border-radius:1px}
.foot{position:absolute;left:81px;right:81px;top:1241px;border-top:1.5px solid rgba(40,30,20,.13);display:flex;justify-content:space-between;padding-top:22px;font-family:Body;font-size:24px;letter-spacing:.24em;color:#3B3B3B}
`;

const doc = (style: string, body: string) => `<!doctype html><html lang="ru"><head><meta charset="utf-8"><style>${style}</style></head><body>${body}</body></html>`;

/**
 * Обложка громкая (владелец 30.10 про Binance: «я хотел прям чтобы было ВЗЛОМАЛИ БИНАНС ААААА»): 2–3 строки по 1–2 слова
 * на всю ширину, последняя — акцентным цветом, под ними строка с главной цифрой. Размер подбирает вёрстка (FIT_COVER).
 */
export function coverHtml(c: SidContent, look: SidLook, imageDataUrl: string): string {
  const lines = c.cover.title;
  const style = `${fontFaces()}
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:1080px;height:1350px;overflow:hidden;background:#090909}
body{font-family:Body;-webkit-font-smoothing:antialiased;position:relative}
.ph{position:absolute;left:0;top:0;width:1080px;height:1350px;object-fit:cover;object-position:50% 0%;transform:scale(1.08);transform-origin:50% 0%}
.fade{position:absolute;inset:0;background:linear-gradient(180deg,rgba(9,9,9,0) 0%,rgba(9,9,9,0) 44%,rgba(9,9,9,.78) 58%,#090909 66%,#090909 100%)}
.wrap{position:absolute;left:66px;right:66px;bottom:132px;text-align:center}
.brk{display:inline-block;background:#E5484D;color:#fff;font-family:Mono;font-weight:700;font-size:23px;letter-spacing:.22em;padding:9px 20px 9px 18px;border-radius:7px}
.t{margin-top:22px;font-family:Head;font-weight:900;color:#fff;text-transform:uppercase}
.hx{white-space:nowrap;font-size:${lines.length >= 3 ? 136 : 168}px;line-height:.98;letter-spacing:-.02em}
.hx.a{color:${look.coverAccent}}
.ac{margin-top:18px;font-size:70px;line-height:1.1;white-space:nowrap}
.hk{margin-top:26px;font-weight:700;font-size:34px;color:#fff}
.ft{position:absolute;left:74px;right:74px;bottom:62px;display:flex;justify-content:space-between;font-weight:700;font-size:22px;letter-spacing:.24em;color:#EDEDED}`;
  const title = lines.map((t, i) => `<div class="hx${lines.length > 1 && i === lines.length - 1 ? " a" : ""}">${tx(t, true)}</div>`).join("");
  return doc(style, `<img class="ph" src="${imageDataUrl}"><div class="fade"></div>
<div class="wrap" id="wrap"><span class="brk">• ${esc(c.cover.pill)}</span><div class="t" id="t">${title}<div class="ac" id="ac">${tx(c.cover.accentLine, true)}</div></div><div class="hk">${tx(c.cover.hook)}</div></div>
<div class="ft"><span>${esc(look.handle)}</span><span>ПЕРЕШЛИ ДРУГУ</span></div>`);
}

export type StepShot = { dataUrl: string; dark: boolean; url: string };

export function stepHtml(s: SidStep, index: number, look: SidLook, shot: StepShot): string {
  const a = look.accent;
  const n = String(index + 1).padStart(2, "0");
  const pills = s.pills.map(([k, v]) => `<div class="pill"><span class="pk">${esc(k)}</span><span class="pv">${tx(v)}</span></div>`).join("");
  const style = `${base(a)}
.num{position:absolute;left:81px;top:226px;font-family:Serif;font-weight:700;font-size:118px;line-height:1;color:${a};letter-spacing:-.02em}
.head{position:absolute;left:290px;right:70px;top:236px}
.lab{display:flex;align-items:center;gap:16px;font-family:Mono;font-size:25.5px;color:#3A3A3A;white-space:nowrap;overflow:hidden}
.ic{flex:none;width:46px;height:46px;border-radius:50%;background:#141414;display:flex;align-items:center;justify-content:center}
.ttl{margin-top:18px;font-family:Body;font-weight:700;font-size:72px;line-height:1.03;letter-spacing:-.032em;color:#141414;-webkit-text-stroke:1px #141414;text-wrap:balance}
.body{position:absolute;left:81px;right:81px;top:488px;font-size:31.5px;line-height:1.42;color:#262626;text-wrap:pretty}
.body b{font-weight:700;color:#0E0E0E}
.win{position:absolute;left:62px;right:62px;top:672px;height:432px;border-radius:20px;overflow:hidden;background:${shot.dark ? "#141414" : "#fff"};box-shadow:0 22px 48px rgba(30,20,10,.14),0 2px 6px rgba(30,20,10,.06);border:1px solid rgba(0,0,0,.07)}
.tb{height:54px;display:flex;align-items:center;gap:10px;padding:0 22px;background:${shot.dark ? "#1F1F1F" : "#F6F4F1"};border-bottom:1px solid ${shot.dark ? "#2A2A2A" : "#E9E5E0"};font-family:Body;font-size:21px;color:${shot.dark ? "#C9C9C9" : "#555"}}
.dot{width:14px;height:14px;border-radius:50%}
.tb .u{display:flex;align-items:center;gap:8px;margin-left:12px;white-space:nowrap}
.shot{display:block;width:100%;height:378px;object-fit:cover;object-position:50% 0%}
.row{position:absolute;left:81px;right:81px;top:1156px;height:74px;display:flex;align-items:center;justify-content:space-between;gap:24px}
.pills{display:flex;gap:18px}
.pill{flex:none;white-space:nowrap;height:74px;display:flex;align-items:center;gap:16px;padding:0 28px;border-radius:16px;background:rgba(60,50,40,.075)}
.pk{font-family:Mono;font-size:17px;letter-spacing:.2em;color:${a}}
.pv{font-family:Body;font-weight:700;font-size:30px;color:#141414}
.next{font-size:23px;color:#777;white-space:nowrap}
.next b{color:${a}}`;
  return doc(style, `<div class="paper"></div><div class="bar"></div>
<div class="num">${n}</div>
<div class="head"><div class="lab" id="lab"><span class="ic">${icon(s.icon)}</span><span>${tx(s.label)}</span></div><div class="ttl" id="ttl">${rich(s.title, true)}</div></div>
<div class="body" id="body">${rich(s.body)}</div>
<div class="win"><div class="tb"><span class="dot" style="background:#FF5F57"></span><span class="dot" style="background:#FEBC2E"></span><span class="dot" style="background:#28C840"></span><span class="u">${asterisk(a)}${esc(shot.url)}</span></div><img class="shot" src="${shot.dataUrl}"></div>
<div class="row" id="row"><div class="pills" id="pills">${pills}</div><div class="next" id="next">Далее: <b>${tx(s.next)} →</b></div></div>
<div class="foot"><span>${esc(look.handle)}</span><span>СОХРАНИ →</span></div>`);
}

export function finalHtml(c: SidContent, look: SidLook): string {
  const a = look.accent;
  const f = c.final;
  const cards = f.cards.map(([k, t, sub], i) => `<div class="card${i === 2 ? " hot" : ""}"><div class="bd">${esc(k)}</div><div class="cx"><div class="ct">${tx(t)}</div><div class="cs">${tx(sub)}</div></div></div>`).join("");
  const style = `${base(a)}
.mark{position:absolute;left:81px;top:66px;width:32px;height:46px;background:${a};clip-path:polygon(0 0,100% 0,100% 100%,50% 76%,0 100%)}
.big{position:absolute;left:80px;right:80px;top:290px;text-align:center;font-family:Head;font-weight:900;font-size:94px;line-height:1.0;letter-spacing:-.04em;color:#141414;text-transform:uppercase}
.big .a{color:${a}}
.cards{position:absolute;left:62px;right:62px;top:740px;display:flex;gap:26px}
.card{flex:1;min-width:0;height:136px;border-radius:22px;background:#fff;box-shadow:0 14px 34px rgba(30,20,10,.1);display:flex;align-items:center;gap:20px;padding:0 24px;border:1.5px solid transparent}
.card.hot{border-color:${a}}
.bd{flex:none;min-width:66px;height:66px;padding:0 10px;border-radius:13px;background:rgba(60,50,40,.08);color:${a};font-family:Mono;font-weight:700;font-size:20px;display:flex;align-items:center;justify-content:center}
.card.hot .bd{background:${a};color:#fff}
.cx{min-width:0}
.ct{font-weight:700;font-size:28px;color:#141414;white-space:nowrap}
.cs{margin-top:6px;font-family:Mono;font-size:18px;color:#7A7A7A;white-space:nowrap}
.fb{position:absolute;left:120px;right:120px;top:960px;text-align:center;font-size:31px;line-height:1.42;color:#222;text-wrap:balance}`;
  return doc(style, `<div class="paper"></div><div class="mark"></div>
<div class="big" id="big">${f.black.map((x) => tx(x, true)).join("<br>")}<br><span class="a">${f.accent.map((x) => tx(x, true)).join("<br>")}</span></div>
<div class="cards" id="cards">${cards}</div>
<div class="fb" id="fb">${tx(f.body)}</div>
<div class="foot"><span>${esc(look.handle)}</span><span>СОХРАНИ →</span></div>`);
}

/** Карточка статьи для окна шага, когда страницу не удалось снять (Cloudflare, пустая, вход): заголовок, описание, картинка. */
export function articleCardHtml(card: { host: string; title: string; description: string; date?: string; imageDataUrl?: string }): string {
  const style = `${fontFaces()}
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:956px;height:378px;overflow:hidden;background:#fff}
body{font-family:Body;-webkit-font-smoothing:antialiased;display:flex;gap:30px;padding:34px 38px}
.tx{flex:1;min-width:0;display:flex;flex-direction:column}
.src{font-family:Mono;font-size:15px;letter-spacing:.14em;color:#8A8A8A;text-transform:uppercase}
.h{margin-top:14px;font-weight:700;font-size:var(--hs,34px);line-height:1.18;color:#111;display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden}
.d{margin-top:14px;font-size:19px;line-height:1.45;color:#555;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.im{flex:none;width:300px;height:310px;border-radius:12px;object-fit:cover;background:#eee}`;
  const date = card.date ? ` · ${esc(card.date)}` : "";
  return doc(style, `<div class="tx"><div class="src">${esc(card.host)}${date}</div><div class="h" id="h">${esc(card.title)}</div>${card.description ? `<div class="d">${esc(card.description)}</div>` : ""}</div>${card.imageDataUrl ? `<img class="im" src="${card.imageDataUrl}">` : ""}`);
}
