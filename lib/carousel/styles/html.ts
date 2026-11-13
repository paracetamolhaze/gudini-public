import fs from "fs";
import path from "path";
import { esc, glue, keepHyphens } from "../sid/content";
import type { CartoonContent, CinemaContent, DisputeContent, HeatTile, MarketContent, SchemeContent, ToolkitContent, UrgentContent } from "./types";

/**
 * Вёрстка шести стилей — та же, что у образцов, одобренных владельцем 01.11 (собирались вручную в six/).
 * Шрифты с кириллицей: Inter (гротеск обычным регистром) и Oswald (узкий капслок). Anton из fonts/ здесь не годится:
 * в нём нет кириллицы, и русский текст подменился бы чужим шрифтом.
 */

export const W = 1080;
export const H = 1350;
const NBSP = String.fromCharCode(160);

function fontPath(file: string): string {
  const dirs = [process.env.CAROUSEL_SID_FONT_DIR, path.join(process.cwd(), "fonts")].filter(Boolean) as string[];
  for (const d of dirs) {
    const p = path.join(d, file);
    if (fs.existsSync(p)) return p;
  }
  throw new Error(`Нет шрифта ${file}: вёрстка стилей не соберётся`);
}
let fontCss = "";
export function styleFonts(): string {
  if (!fontCss) {
    fontCss = ([["Inter", "100 900", "Inter.ttf"], ["Osw", "200 700", "OswaldVar.ttf"]] as const)
      .map(([fam, w, f]) => `@font-face{font-family:${fam};font-weight:${w};src:url(data:font/ttf;base64,${fs.readFileSync(fontPath(f)).toString("base64")})}`).join("");
  }
  return fontCss;
}

/** Текст с разметкой цвета: склейка коротких слов и чисел, слова с дефисом без переноса, [r]…[/r] → цвет, **…** → жирное. */
export function marks(s: string): string {
  const glued = glue(s).replace(/(\d) (?=[\dа-яёa-z$%])/gi, `$1${NBSP}`);
  return keepHyphens(esc(glued))
    .replace(/\[(r|g|b|y|w)\]([\s\S]*?)\[\/\1\]/g, (_, c, t) => `<span class="c-${c}">${t}</span>`)
    // непарные и оборванные теги («[r]», «[/b]», «[») убираются: на слайд служебная разметка не попадает никогда
    .replace(/\[\/?[rgbyw]?\]?/g, "")
    .replace(/\*\*([\s\S]+?)\*\*/g, "<b>$1</b>")
    .replace(/\n/g, "<br>");
}

const doc = (style: string, body: string) => `<!doctype html><html lang="ru"><head><meta charset="utf-8"><style>${styleFonts()}
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:${W}px;height:${H}px;overflow:hidden}
body{position:relative;-webkit-font-smoothing:antialiased;text-rendering:geometricPrecision}
${style}</style></head><body>${body}</body></html>`;

/**
 * Подгонка в странице: у элемента с data-fit кегль уменьшается до data-min, пока он не влезет по высоте
 * (data-maxh) и ширине. Что не влезло и на минимуме — проблема с путём поля для правки текста.
 */
export const FIT = `(() => {
  const p = [];
  for (const el of document.querySelectorAll("[data-fit]")) {
    const min = Number(el.dataset.min || 20), maxH = Number(el.dataset.maxh || 0);
    let fs = parseFloat(getComputedStyle(el).fontSize);
    const over = () => (maxH && el.getBoundingClientRect().height > maxH) || el.scrollWidth > el.clientWidth + 1;
    while (over() && fs > min) { fs -= 2; el.style.fontSize = fs + "px"; }
    if (over()) p.push(el.dataset.fit + ": не помещается на слайд, сократи");
  }
  // служебная разметка цвета не должна быть видна на слайде ни в одном стиле
  const left = document.body.innerText.match(/\\[\\/?[rgbyw]?\\]?|\\*\\*/g) || [];
  if (left.length) p.push("разметка видна на слайде: " + left.slice(0, 3).join(" "));
  return p;
})()`;

const initials = (handle: string) => handle.replace(/^@/, "").split(/[._-]/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "G";

// ===== «Срочно»: фото репортажа на весь кадр, красная метка, фраза обычным регистром и белая добивка =====

export function urgentHtml(c: UrgentContent, i: number, photo: string, handle: string): string {
  const s = c.slides[i];
  const style = `
body{background:#000}
.ph{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:50% 20%}
.sh{position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,0) 34%,rgba(0,0,0,.55) 52%,rgba(0,0,0,.92) 70%,#000 100%)}
.box{position:absolute;left:64px;right:64px;bottom:84px}
.tag{font-family:Inter;font-weight:800;font-size:31px;color:#FF3B30;margin-bottom:26px}
.h{font-family:Inter;font-weight:700;font-size:61px;line-height:1.16;letter-spacing:-.022em;color:#fff}
.c-r{color:#FF3B30}.c-g,.c-b,.c-y,.c-w{color:#fff}
.row{display:flex;align-items:flex-end;justify-content:space-between;gap:30px;margin-top:40px}
.sub{font-family:Inter;font-weight:700;font-size:52px;letter-spacing:-.02em;color:#fff}
.logo{flex:none;width:118px;height:118px;border-radius:50%;border:3px solid #fff;display:flex;align-items:center;justify-content:center;flex-direction:column;background:#111;font-family:Inter;font-weight:800;color:#fff;line-height:1}
.logo b{font-size:44px;letter-spacing:-.04em}.logo i{font-style:normal;font-size:14px;font-weight:600;margin-top:6px;color:#bbb}`;
  return doc(style, `<img class="ph" src="${photo}"><div class="sh"></div>
<div class="box">${i === 0 ? `<div class="tag">СРОЧНО</div>` : ""}
<div class="h" data-fit="slides[${i}].text" data-min="46" data-maxh="300">${marks(s.text)}</div>
<div class="row"><div class="sub" data-fit="slides[${i}].sub" data-min="38">${marks(s.sub)}</div><div class="logo"><b>${esc(initials(handle))}</b><i>${esc(handle.toLowerCase())}</i></div></div></div>`);
}

// ===== «Подборка»: чёрный фон, скриншот без свечения, заголовок белым и красным, карточки тёмно-серые =====

const RED = "#FF2B2B";
const ICON_PATHS: Record<string, string> = {
  key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M17 6l3 3M15 8l2 2"/>',
  shield: '<path d="M12 3l8 3v6c0 4.6-3.4 8-8 9-4.6-1-8-4.4-8-9V6z"/><path d="M8.5 12l2.5 2.5 4.5-5"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  list: '<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/>',
  coin: '<ellipse cx="12" cy="7" rx="7" ry="3"/><path d="M5 7v5c0 1.7 3.1 3 7 3s7-1.3 7-3V7M5 12v5c0 1.7 3.1 3 7 3s7-1.3 7-3v-5"/>',
  chart: '<path d="M3.5 20.5h17"/><path d="M4.5 16l4-6 3 3 3.5-8 4.5 14"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1.2 1.2"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1.2-1.2"/>',
  alert: '<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18h.01"/>',
  money: '<rect x="2.5" y="6" width="19" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 9v.01M18 15v.01"/>',
  search: '<circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5.5 5.5"/>',
  puzzle: '<path d="M10 3h4v3a2 2 0 1 0 4 0V3h3v7h-3a2 2 0 1 0 0 4h3v7h-7v-3a2 2 0 1 0-4 0v3H3v-7h3a2 2 0 1 0 0-4H3V3z"/>',
  bubble: '<circle cx="8" cy="9" r="4"/><circle cx="16.5" cy="8" r="2.5"/><circle cx="15" cy="16" r="4"/><path d="M11 11l1.5 2"/>',
  check: '<path d="M4 12.5l5 5L20 6.5"/>',
};
const icon = (k: string, color = "#E8E8E8", size = 32) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICON_PATHS[k] ?? ICON_PATHS.check}</svg>`;

const TK_BASE = `
body{background:#050505;color:#fff}
/* «Подборка»: один акцент — красный, и только во второй строке заголовка и слове панча (владелец 01.11) */
.c-r{color:${RED}}.c-g,.c-b,.c-y,.c-w{color:inherit}
.brand{position:absolute;left:0;right:0;top:26px;text-align:center;font-family:Inter;font-weight:800;font-size:22px;letter-spacing:.2em;color:#E6E6E6}
.big{font-family:Osw;font-weight:700;text-transform:uppercase;text-align:center;line-height:1.04;letter-spacing:-.005em}`;

export function toolkitCoverHtml(c: ToolkitContent, photo: string, handle: string): string {
  const style = `${TK_BASE}
.ph{position:absolute;left:0;top:0;width:100%;height:760px;object-fit:cover;object-position:50% 0%}
.sh{position:absolute;inset:0;background:linear-gradient(180deg,rgba(5,5,5,.3) 0%,rgba(5,5,5,0) 14%,rgba(5,5,5,0) 32%,rgba(5,5,5,.9) 46%,#050505 52%)}
.box{position:absolute;left:50px;right:50px;bottom:70px;text-align:center}
.l1{font-size:118px;white-space:nowrap}.l2{font-size:236px;color:${RED};margin:2px 0 4px;white-space:nowrap}.l3{font-size:118px;white-space:nowrap}
.sub{font-family:Inter;font-weight:800;font-size:31px;letter-spacing:.01em;text-transform:uppercase;margin-top:30px;line-height:1.3}
.pill{display:inline-flex;align-items:center;gap:14px;margin-top:34px;border:2px solid #E6E6E6;border-radius:999px;padding:14px 34px;font-family:Inter;font-weight:800;font-size:27px;letter-spacing:.04em;color:#fff}`;
  return doc(style, `<img class="ph" src="${photo}"><div class="sh"></div><div class="brand">${esc(handle.toUpperCase())}</div>
<div class="box"><div class="big l1" data-fit="cover.l1" data-min="80">${marks(c.cover.l1)}</div><div class="big l2" data-fit="cover.l2" data-min="150">${marks(c.cover.l2)}</div><div class="big l3" data-fit="cover.l3" data-min="80">${marks(c.cover.l3)}</div>
<div class="sub">${marks(c.cover.sub)}</div><div class="pill">ЛИСТАЙ И ПРОВЕРЬ СЕБЯ <span>→</span></div></div>`);
}

type TkBlock = { head: [string, string]; cards: { icon: string; title: string; text: string }[]; punch: string };

export function toolkitItemHtml(b: TkBlock, path: string, shots: string[], link: string, handle: string): string {
  const frame = shots.length <= 1
    ? `<div class="fr" style="left:64px;right:64px;top:78px;height:372px">${shots[0] ? `<img src="${shots[0]}">` : ""}</div>`
    : shots.slice(0, 4).map((s, i) => `<div class="fr" style="left:${64 + (i % 2) * 484}px;top:${78 + Math.floor(i / 2) * 192}px;width:468px;height:180px"><img src="${s}"></div>`).join("");
  const style = `${TK_BASE}
.fr{position:absolute;border:1.5px solid #3A3A3A;border-radius:16px;overflow:hidden;box-shadow:0 14px 36px rgba(0,0,0,.5);background:#111}
.fr img{display:block;width:100%;height:100%;object-fit:cover;object-position:50% 0}
.hd{position:absolute;left:40px;right:40px;top:486px;font-size:104px}
.hd div{white-space:nowrap}.hd .r{color:${RED}}
.pill{position:absolute;left:0;right:0;top:724px;text-align:center}
.pill span{display:inline-flex;align-items:center;gap:12px;border:2px solid #3A3A3A;background:#111;border-radius:999px;padding:9px 26px;font-family:Inter;font-weight:700;font-size:26px}
.cards{position:absolute;left:58px;right:58px;top:798px;display:flex;flex-direction:column;gap:13px}
.card{height:98px;display:flex;align-items:center;gap:22px;padding:0 24px;border:1.5px solid #2E2E2E;border-radius:16px;background:#151515}
.ic{flex:none;width:58px;height:58px;border-radius:12px;border:1px solid #333;display:flex;align-items:center;justify-content:center;background:#1F1F1F}
.ct{flex:none;width:300px;font-family:Osw;font-weight:700;font-size:33px;line-height:1.1;text-transform:uppercase;color:#fff}
.cx{flex:1;font-family:Inter;font-weight:500;font-size:23px;line-height:1.3;color:#B9B9B9;max-height:90px;overflow:hidden}
.pn{position:absolute;left:40px;right:40px;bottom:40px;font-size:36px;line-height:1.05;white-space:nowrap}`;
  const cards = b.cards.map((x, i) => `<div class="card"><div class="ic">${icon(x.icon)}</div><div class="ct" data-fit="${path}.cards[${i}].title" data-min="24" data-maxh="80">${marks(x.title)}</div><div class="cx" data-fit="${path}.cards[${i}].text" data-min="18" data-maxh="90">${marks(x.text)}</div></div>`).join("");
  return doc(style, `<div class="brand">${esc(handle.toUpperCase())}</div>${frame}
<div class="big hd"><div data-fit="${path}.head[0]" data-min="70">${marks(b.head[0])}</div><div class="r" data-fit="${path}.head[1]" data-min="70">${marks(b.head[1])}</div></div>
<div class="pill"><span>${icon("link", RED, 30)}${esc(link)}</span></div>
<div class="cards">${cards}</div>
<div class="big pn" data-fit="${path}.punch" data-min="26">${marks(b.punch)}</div>`);
}

// ===== «Рынок» и «Мульт»: картинка в верхних 2/3, внизу узкий капслок с цветными цифрами =====

const CAPS_BASE = `
body{background:#000}
.ph{position:absolute;left:0;top:0;width:1080px;height:990px;object-fit:cover;object-position:50% 30%}
.sh{position:absolute;left:0;right:0;top:740px;height:260px;background:linear-gradient(180deg,rgba(0,0,0,0),#000 90%)}
.dv{position:absolute;left:150px;right:150px;top:896px;display:flex;align-items:center;gap:20px}
.dv i{flex:1;height:2px;background:linear-gradient(90deg,rgba(255,255,255,0),rgba(255,255,255,.55),rgba(255,255,255,0))}
.dv span{font-family:Inter;font-weight:800;font-size:19px;letter-spacing:.2em;color:#fff;text-transform:uppercase}
.tx{position:absolute;left:46px;right:46px;top:918px;bottom:46px;display:flex;flex-direction:column;justify-content:center;text-align:center;font-family:Osw;font-weight:700;text-transform:uppercase;color:#fff;letter-spacing:-.005em}
.bg{font-size:150px;line-height:1;color:#FF2A2A;white-space:nowrap}
.t{font-size:72px;line-height:1.14}
.c-r{color:#FF2A2A}.c-g{color:#2BE26E}.c-b{color:#2F8CFF}.c-y{color:#FFC21A}.c-w{color:#fff}
.sw{position:absolute;left:0;right:0;bottom:30px;text-align:center;font-family:Inter;font-weight:800;font-size:22px;letter-spacing:.18em;color:#fff}
.cv .dv{top:862px}.cv .tx{top:880px;bottom:78px}.cv .ph{height:960px}`;

export function capsHtml(slide: { big?: string; text: string }, path: string, photo: string, handle: string, cover: boolean): string {
  const big = slide.big ? `<div class="bg" data-fit="${path}.big" data-min="90" style="font-size:${[...slide.big].length <= 6 ? 230 : 150}px">${marks(slide.big)}</div>` : "";
  return doc(CAPS_BASE, `<div class="${cover ? "cv" : ""}"><img class="ph" src="${photo}"><div class="sh"></div>
<div class="dv"><i></i><span>${esc(handle)}</span><i></i></div>
<div class="tx">${big}<div class="t" data-fit="${path}.text" data-min="48" data-maxh="${cover ? 200 : 360}">${marks(slide.text)}</div></div>
${cover ? `<div class="sw">ЛИСТАЙ ДАЛЬШЕ</div>` : ""}</div>`);
}

/** Обложка-сводка «Рынка»: все герои карусели со своими цифрами — чтобы каждый нашёл своё и листал. */
export function marketCoverHtml(c: MarketContent, photo: string): string {
  const rows = c.cover.rows;
  const style = `${CAPS_BASE}
.ph{height:580px}.sh{top:320px;height:280px}
.st{position:absolute;left:40px;right:40px;top:486px;text-align:center;font-family:Osw;font-weight:700;text-transform:uppercase;font-size:118px;line-height:1;color:#FF2A2A;white-space:nowrap}
.grid{position:absolute;left:52px;right:52px;top:630px;display:grid;grid-template-columns:1fr 1fr;column-gap:34px;row-gap:22px}
.it{border-top:1.5px solid #333;padding-top:14px}
.it b{display:block;font-family:Osw;font-weight:700;text-transform:uppercase;font-size:44px;line-height:1.05;color:#2F8CFF;white-space:nowrap}
.it em{display:block;font-style:normal;font-family:Osw;font-weight:700;text-transform:uppercase;font-size:62px;line-height:1.15;color:#FF2A2A;white-space:nowrap}
.it span{display:block;font-family:Inter;font-weight:600;font-size:28px;color:#A8A8A8;margin-top:10px;white-space:nowrap}
.cta{position:absolute;left:0;right:0;bottom:44px;text-align:center;font-family:Inter;font-weight:800;font-size:26px;letter-spacing:.14em;color:#fff;text-transform:uppercase}`;
  const tight = rows.length > 4 ? "" : ".grid{row-gap:40px}";
  const items = rows.map(([n, v, p], i) => `<div class="it"><b data-fit="cover.rows[${i}][0]" data-min="30">${marks(n)}</b><em data-fit="cover.rows[${i}][1]" data-min="44">${marks(v)}</em><span data-fit="cover.rows[${i}][2]" data-min="26">${marks(p)}</span></div>`).join("");
  return doc(style + tight, `<img class="ph" src="${photo}"><div class="sh"></div>
<div class="st" data-fit="cover.title" data-min="80">${marks(c.cover.title)}</div><div class="grid">${items}</div><div class="cta">${marks(c.cover.cta)}</div>`);
}

// ===== «Кино»: кадр с биржи и сумма узким капслоком; тепловая карта монет =====

export function cinemaCoverHtml(c: CinemaContent, photo: string, handle: string): string {
  const style = `
body{background:#000}
.ph{position:absolute;left:0;top:0;width:1080px;height:1020px;object-fit:cover;object-position:50% 30%}
.sh{position:absolute;left:0;right:0;top:760px;height:280px;background:linear-gradient(180deg,rgba(0,0,0,0),#000 88%)}
.tx{position:absolute;left:40px;right:40px;top:930px;text-align:center;font-family:Osw;font-weight:700;text-transform:uppercase;color:#fff;font-size:90px;line-height:1.12}
.tx div{white-space:nowrap}
.c-b{color:#2E8BFF}.c-r{color:#FF2A2A}.c-g{color:#2BE26E}.c-y{color:#FFC21A}.c-w{color:#fff}
.dv{position:absolute;left:110px;right:110px;bottom:52px;display:flex;align-items:center;gap:22px}
.dv i{flex:1;height:2.5px;background:#fff;opacity:.85}
.dv span{font-family:Inter;font-weight:800;font-size:22px;letter-spacing:.18em;color:#fff}`;
  return doc(style, `<img class="ph" src="${photo}"><div class="sh"></div>
<div class="tx">${c.cover.lines.map((l, i) => `<div data-fit="cover.lines[${i}]" data-min="60">${marks(l)}</div>`).join("")}</div>
<div class="dv"><i></i><span>${esc(handle.toUpperCase())}</span><i></i></div>`);
}

type Rect = { x: number; y: number; w: number; h: number };
/** Плитки «квадратами»: строка набирается, пока соотношение сторон улучшается. */
export function squarify(values: number[], r: Rect): Rect[] {
  const out: Rect[] = [];
  let rest = values.slice(), box = { ...r };
  const total = (a: number[]) => a.reduce((s, v) => s + v, 0);
  while (rest.length) {
    const sum = total(rest), short = Math.min(box.w, box.h);
    let row: number[] = [], best = Infinity;
    for (const v of rest) {
      const next = [...row, v];
      const side = ((total(next) / sum) * box.w * box.h) / short;
      const worst = Math.max(...next.map((x) => { const o = ((x / sum) * box.w * box.h) / side; return Math.max(o / side, side / o); }));
      if (worst > best) break;
      best = worst; row = next;
    }
    const thick = ((total(row) / sum) * box.w * box.h) / short;
    let off = 0;
    for (const v of row) {
      const len = (v / total(row)) * short;
      out.push(box.w >= box.h ? { x: box.x, y: box.y + off, w: thick, h: len } : { x: box.x + off, y: box.y, w: len, h: thick });
      off += len;
    }
    box = box.w >= box.h ? { x: box.x + thick, y: box.y, w: box.w - thick, h: box.h } : { x: box.x, y: box.y + thick, w: box.w, h: box.h - thick };
    rest = rest.slice(row.length);
  }
  return out;
}

export function heatmapHtml(c: CinemaContent, tiles: HeatTile[], logos: Record<string, string>, handle: string): string {
  const sorted = [...tiles].sort((a, b) => b.cap - a.cap);
  // размер по капитализации со сглаживанием: иначе биткоин занял бы три четверти карты;
  // блоки занимают всю картинку под заголовком — от края до края и до низа слайда
  const rects = squarify(sorted.map((t) => Math.pow(t.cap, 0.55)), { x: 0, y: 206, w: W, h: H - 206 });
  const color = (p: number) => {
    if (p >= 0) { const k = Math.min(1, p / 15); return `linear-gradient(160deg,rgb(${Math.round(40 - 10 * k)},${Math.round(150 + 20 * k)},${Math.round(80 - 10 * k)}),rgb(12,${Math.round(90 + 20 * k)},44))`; }
    const k = Math.min(1, -p / 20);
    return `linear-gradient(160deg,rgb(${Math.round(176 - 70 * k)},${Math.round(46 - 30 * k)},${Math.round(46 - 30 * k)}),rgb(${Math.round(120 - 60 * k)},${Math.round(20 - 12 * k)},${Math.round(22 - 12 * k)}))`;
  };
  const cells = sorted.map((t, i) => {
    const r = rects[i], s = Math.min(r.w, r.h);
    const logo = Math.round(Math.max(40, Math.min(150, s * 0.34)));
    const f1 = Math.round(Math.max(24, Math.min(86, s * 0.2))), f2 = Math.round(Math.max(22, Math.min(64, s * 0.15)));
    const pct = `${t.pct >= 0 ? "+" : "−"}${Math.abs(t.pct).toFixed(1).replace(".", ",")}%`;
    const img = logos[t.sym] ? `<img src="${logos[t.sym]}" style="width:${logo}px;height:${logo}px">` : `<div class="nl" style="width:${logo}px;height:${logo}px;font-size:${Math.round(logo * 0.28)}px">${esc(t.sym.toUpperCase())}</div>`;
    return `<div class="tile" style="left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.h}px;background:${color(t.pct)}">${img}<b style="font-size:${f1}px">${esc(t.sym.toUpperCase())}</b><span style="font-size:${f2}px">${pct}</span></div>`;
  }).join("");
  const style = `
body{background:#07080b}
.hd{position:absolute;left:40px;right:40px;top:58px;font-family:Osw;font-weight:700;text-transform:uppercase;color:#fff;font-size:70px;line-height:1;white-space:nowrap}
.c-b{color:#2E8BFF}.c-r{color:#FF2A2A}.c-g{color:#2BE26E}.c-y{color:#FFC21A}
.sub{position:absolute;left:40px;top:150px;font-family:Inter;font-weight:600;font-size:28px;color:#9AA3B2}
.tile{position:absolute;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;border:3px solid #07080b;border-radius:10px;overflow:hidden;color:#fff;font-family:Inter;text-align:center}
.tile img{border-radius:50%;margin-bottom:4px}
.tile b{font-family:Osw;font-weight:700;line-height:1}
.tile span{font-weight:800;line-height:1}
.nl{border-radius:50%;background:#0b0b0b;display:flex;align-items:center;justify-content:center;font-family:Osw;font-weight:700;color:#E6E6E6}
.hn{position:absolute;right:40px;top:155px;font-family:Inter;font-weight:500;font-size:21px;color:#7C8494}`;
  return doc(style, `<div class="hd" data-fit="heatmap.title" data-min="44">${marks(c.heatmap.title)}</div>
<div class="sub">${marks(c.heatmap.subtitle)}</div>${cells}<div class="hn">${esc(handle.toLowerCase())}</div>`);
}

// ===== «Разбор»: светлые слайды, настоящие посты в белых карточках =====

const DS_BASE = (handle: string) => ({
  css: `
.plate{display:inline-flex;align-items:center;gap:10px;background:#111;color:#fff;border-radius:999px;padding:9px 20px 9px 14px;font-family:Inter;font-weight:800;font-size:18px;letter-spacing:.14em}
.plate i{width:14px;height:14px;border-radius:50%;background:linear-gradient(135deg,#F7B500,#FF6A00)}
b{font-weight:800;color:#0E0E10}`,
  plate: `<div class="plate"><i></i>${esc(handle.toUpperCase())}</div>`,
});

export function disputeCoverHtml(c: DisputeContent, photo: string, handle: string): string {
  const b = DS_BASE(handle);
  const style = `${b.css}
body{background:#ECECEF}
.ph{position:absolute;left:0;top:0;width:1080px;height:1050px;object-fit:cover;object-position:50% 20%}
.fog{position:absolute;left:0;right:0;top:640px;bottom:0;background:linear-gradient(180deg,rgba(236,236,239,0) 0%,rgba(236,236,239,.75) 34%,#ECECEF 56%)}
.box{position:absolute;left:60px;right:60px;bottom:96px;text-align:center}
.h{margin-top:22px;font-family:Inter;font-weight:800;font-size:62px;line-height:1.08;letter-spacing:-.03em;color:#0E0E10}
.s{margin-top:12px;font-family:Inter;font-weight:500;font-size:48px;line-height:1.14;letter-spacing:-.02em;color:#1d1d22}`;
  return doc(style, `<img class="ph" src="${photo}"><div class="fog"></div>
<div class="box">${b.plate}<div class="h" data-fit="cover.head" data-min="46" data-maxh="210">${marks(c.cover.head)}</div><div class="s" data-fit="cover.sub" data-min="34" data-maxh="120">${marks(c.cover.sub)}</div></div>`);
}

export function disputeInnerHtml(head: string, paras: string[], path: string, media: { tweet?: string; facts?: [string, string][] }, handle: string): string {
  const b = DS_BASE(handle);
  const style = `${b.css}
body{background:linear-gradient(180deg,#F4F4F6 0%,#E3E4E8 100%)}
.col{position:absolute;left:70px;right:70px;top:82px;bottom:118px;display:flex;flex-direction:column;align-items:center;justify-content:center}
.hd{text-align:center;font-family:Inter;font-weight:800;font-size:56px;line-height:1.1;letter-spacing:-.03em;color:#0E0E10}
.ps{margin-top:26px;text-align:center;font-family:Inter;font-weight:400;font-size:31px;line-height:1.4;color:#2a2a30;padding:0 20px}
.ps p+p{margin-top:14px}
.card{margin-top:34px;flex:0 1 auto;min-height:0;width:840px;background:#fff;border-radius:30px;box-shadow:0 26px 60px rgba(20,20,40,.16),0 2px 8px rgba(20,20,40,.06);padding:24px;display:flex}
.card img{display:block;max-width:100%;max-height:100%;object-fit:contain;margin:0 auto}
.facts{margin-top:30px;width:100%;display:flex;flex-direction:column;gap:16px}
.fact{background:#fff;border-radius:24px;box-shadow:0 18px 40px rgba(20,20,40,.12);padding:20px 28px;display:flex;align-items:center;gap:26px}
.fact>b{flex:none;width:230px;font-family:Inter;font-weight:900;font-size:46px;letter-spacing:-.03em;color:#0E0E10}
.fact>span{font-family:Inter;font-weight:500;font-size:27px;line-height:1.3;color:#33333a}
.ft{position:absolute;left:0;right:0;bottom:46px;text-align:center}`;
  const body = media.tweet ? `<div class="card"><img src="${media.tweet}"></div>` : media.facts ? `<div class="facts">${media.facts.map(([k, v]) => `<div class="fact"><b>${marks(k)}</b><span>${marks(v)}</span></div>`).join("")}</div>` : "";
  return doc(style, `<div class="col"><div class="hd" data-fit="${path}.head" data-min="40" data-maxh="200">${marks(head)}</div>
<div class="ps">${paras.map((p) => `<p>${marks(p)}</p>`).join("")}</div>${body}</div>
<div class="ft">${b.plate}</div>`);
}

/**
 * Слайд-схема «Разбора»: рисунок-предмет в белой карточке, как посты на соседних слайдах. В шапке карточки
 * «Схема» и название предмета, под ней части по номерам: цифра в кружке та же, что на рисунке, а слова набраны
 * вёрсткой — генератор рисует только цифры.
 */
export function disputeSchemeHtml(sc: SchemeContent, picture: string, handle: string): string {
  const b = DS_BASE(handle);
  const style = `${b.css}
body{background:linear-gradient(180deg,#F4F4F6 0%,#E3E4E8 100%)}
.col{position:absolute;left:60px;right:60px;top:70px;bottom:112px;display:flex;flex-direction:column;align-items:center;justify-content:center}
.hd{flex:none;text-align:center;font-family:Inter;font-weight:800;font-size:56px;line-height:1.1;letter-spacing:-.03em;color:#0E0E10}
.ps{flex:none;margin-top:18px;text-align:center;font-family:Inter;font-weight:400;font-size:30px;line-height:1.36;color:#2a2a30;padding:0 30px}
.card{margin-top:26px;flex:0 1 auto;min-height:0;background:#fff;border-radius:30px;box-shadow:0 26px 60px rgba(20,20,40,.16),0 2px 8px rgba(20,20,40,.06);padding:18px 22px 22px;display:flex;flex-direction:column}
.cap{display:flex;justify-content:space-between;align-items:baseline;gap:20px;padding:0 6px 12px;font-family:Inter;font-weight:700;font-size:19px;letter-spacing:.14em;text-transform:uppercase;color:#8A8B93}
.cap span:last-child{color:#33333a;text-align:right;white-space:nowrap}
.card img{display:block;flex:0 1 660px;min-height:0;height:660px;width:auto;aspect-ratio:1/1;align-self:center;object-fit:cover;border-radius:16px}
.parts{flex:none;margin-top:24px;width:100%;display:grid;grid-template-columns:1fr 1fr;gap:14px 18px}
.part{background:#fff;border-radius:22px;box-shadow:0 14px 32px rgba(20,20,40,.10);padding:14px 20px 16px 16px;display:flex;align-items:flex-start;gap:14px;min-width:0}
.part i{flex:none;width:44px;height:44px;border-radius:50%;background:#33333a;color:#fff;font-style:normal;font-family:Inter;font-weight:800;font-size:25px;line-height:44px;text-align:center}
.part div{min-width:0}
.part b{display:block;font-family:Inter;font-weight:800;font-size:28px;line-height:1.16;letter-spacing:-.02em;color:#0E0E10}
.part span{display:block;margin-top:3px;font-family:Inter;font-weight:500;font-size:23px;line-height:1.26;color:#44444c}
.parts.odd .part:last-child{grid-column:1 / -1}
.ft{position:absolute;left:0;right:0;bottom:44px;text-align:center}`;
  const parts = sc.parts.map(([k, v], i) => `<div class="part"><i>${i + 1}</i><div><b data-fit="scheme.parts[${i}][0]" data-min="22" data-maxh="34">${marks(k)}</b><span data-fit="scheme.parts[${i}][1]" data-min="19" data-maxh="${sc.parts.length % 2 && i === sc.parts.length - 1 ? 32 : 62}">${marks(v)}</span></div></div>`).join("");
  return doc(style, `<div class="col"><div class="hd" data-fit="scheme.head" data-min="40" data-maxh="130">${marks(sc.head)}</div>
<div class="ps" data-fit="scheme.lead" data-min="24" data-maxh="86">${marks(sc.lead)}</div>
<div class="card"><div class="cap"><span>Схема</span><span>${esc(sc.object)}</span></div><img src="${picture}"></div>
<div class="parts${sc.parts.length % 2 ? " odd" : ""}">${parts}</div></div>
<div class="ft">${b.plate}</div>`);
}

export type { CartoonContent };
