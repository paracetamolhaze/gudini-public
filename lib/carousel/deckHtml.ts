import crypto from "crypto";
import type { CarouselFormat, CarouselLanguage, DesignSettings, Slide } from "./types";
import { FORMATS, LANGUAGES } from "./limits";
import { emphasisParts, escapeHtml, stripEmphasis, typograph } from "./text";
import { FONT_FAMILY } from "./templates";
import { hexToRgba, isLightColor } from "./designShared";
import { channelTitle, type TelegramChannel } from "./channel";

/**
 * Карточка карусели по скиллу ig-carousel в стиле «пост» — его выбрал владелец из самых
 * просматриваемых оформлений (карточки-посты, как у Sahil Bloom и Hormozi): белая карточка поста
 * с аватаркой и ником аккаунта Instagram, куда выходит карусель, на фоне цвета аккаунта. Telegram —
 * только на финале: строка про канал и крупный QR со ссылкой-приглашением (канал закрытый).
 * HTML 1080×1350, текст ставит сайт, генератор картинок не участвует. Поля 120 px со всех сторон —
 * сетка профиля обрезает края. Кегль не мельче 32 px: карточку читают на телефоне втрое мельче.
 * Один акцентный цвет, номер «3/8» на каждой карточке. Тексты модели экранируются, скрипты и внешние
 * загрузки запрещены CSP, аватарка встраивается data:URL.
 */

export const DECK_TEMPLATE_VERSION = 3;

/** Меньше 32 px кегль не опускается ни при какой подгонке. */
const MIN_FONT = 32;
const PAD = 120;
/** QR: светлое поле в 4 модуля по стандарту, модуль — целое число пикселей, чтобы края не размывались. */
const QR_QUIET = 4;
const QR_MODULE = 14;

type SlideContent = Pick<Slide, "kind" | "kicker" | "title" | "body" | "bullets" | "cta">;
export type DeckCarousel = { format: CarouselFormat; language: CarouselLanguage; design: DesignSettings };

const designKey = (d: DesignSettings) => [d.scrimColor, d.textColor, d.accent, d.titleFont, d.igHandle ?? null, d.avatarFile ?? null];

export function deckHash(c: DeckCarousel, slide: SlideContent, index: number, total: number, channel: TelegramChannel | null = null): string {
  const qr = slide.kind === "final" && channel ? [channel.url, channelTitle(channel)] : null;
  const payload = JSON.stringify(["deck", DECK_TEMPLATE_VERSION, c.format, c.language, designKey(c.design), slide.kind, slide.title, slide.body, slide.bullets, slide.cta, index, total, qr]);
  return crypto.createHash("sha1").update(payload).digest("hex");
}

/** QR из готовой матрицы: квадраты модулей на белом поле, без сглаживания краёв. */
export function qrSvg(rows: string[], modulePx: number): string {
  const size = rows.length + 2 * QR_QUIET;
  let d = "";
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) if (row[x] === "1") d += `M${x + QR_QUIET} ${y + QR_QUIET}h1v1h-1z`;
  });
  const px = size * modulePx;
  return `<svg class="qr" width="${px}" height="${px}" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges" aria-hidden="true"><rect width="${size}" height="${size}" fill="#FFFFFF"/><path d="${d}" fill="#000000"/></svg>`;
}

export function buildDeckHtml(args: DeckCarousel & { slide: SlideContent; index: number; total: number; scale: number; fontCss: string; avatarDataUrl?: string | null; channel?: TelegramChannel | null }): string {
  const { format, language: lang, design: d, slide, index, total, scale, fontCss } = args;
  const { width: W, height: H } = FORMATS[format];
  const k = format === "square" ? 0.86 : 1;
  // t — кегль (не мельче 32 px), g — размеры, которые сжимаются вместе с текстом, px — постоянные
  const t = (n: number) => Math.max(MIN_FONT, Math.round(n * k * scale));
  const g = (n: number) => Math.round(n * k * scale);
  const px = (n: number) => Math.round(n * k);
  const light = isLightColor(d.scrimColor);
  // пост читается на белой карточке в светлом оформлении и на приглушённой — в тёмном
  const ink = light ? (isLightColor(d.textColor) ? "#1D1A17" : d.textColor) : isLightColor(d.textColor) ? d.textColor : "#F5F2EC";
  const card = light ? "#FFFFFF" : hexToRgba("#FFFFFF", 0.07);
  const accent = d.accent;
  const accentInk = isLightColor(accent) ? "#15120F" : "#FFFFFF";
  const dim = hexToRgba(ink, 0.58);
  const soft = hexToRgba(ink, 0.88);
  const channel = slide.kind === "final" ? args.channel ?? null : null;

  const plain = (s: string) => escapeHtml(typograph(stripEmphasis(s), lang));
  // типографика по частям: предлог в начале выделения («**за 5 минут**») тоже не отрывается от слова
  const rich = (s: string) =>
    emphasisParts(s)
      .map((p) => (p.hl ? `<span class="hl">${escapeHtml(typograph(p.text, lang))}</span>` : escapeHtml(typograph(p.text, lang))))
      .join("");

  // шапка поста — аккаунт Instagram: без подключённого аккаунта аватарки нет, без ника нет и шапки
  const avatar = args.avatarDataUrl ? `<img class="ava" src="${args.avatarDataUrl}" alt="">` : "";
  const who = d.igHandle && !channel ? `<div class="who">${avatar}<div class="nm" data-fit="footer">${escapeHtml(d.igHandle)}</div></div>` : "";
  const body = (cls = "tx") => (slide.body ? `<p class="${cls}" data-fit="body">${plain(slide.body)}</p>` : "");
  const meta = (left: string, right = "") => `<div class="meta"><span>${left}</span><span>${right}</span></div>`;

  let inner: string;
  switch (slide.kind) {
    case "cover":
      inner = `<h1 class="title" data-fit="title">${rich(slide.title)}</h1>${body("lead")}${meta("", `${escapeHtml(LANGUAGES[lang].swipe)} →`)}`;
      break;
    case "stake":
      inner = `<h2 class="title" data-fit="title">${rich(slide.title)}</h2>`;
      break;
    case "recap":
      // итог — карточка для скриншота: только заголовок и список, без служебных строк
      inner = `<h2 class="title" data-fit="title">${rich(slide.title)}</h2><ul class="recap" data-fit="bullets">${slide.bullets.map((b) => `<li>${plain(b)}</li>`).join("")}</ul>`;
      break;
    case "final":
      // финал — только про Telegram: строка про канал и QR, по которому заходят в закрытый канал
      inner = channel
        ? `<h2 class="title" data-fit="title">${rich(slide.title)}</h2>${qrSvg(channel.qr, px(QR_MODULE))}<div class="chan" data-fit="cta"><div class="pl">Telegram-канал</div><div>${escapeHtml(channelTitle(channel))}</div></div>`
        : `<h2 class="title" data-fit="title">${rich(slide.title)}</h2>${body()}`;
      break;
    default: {
      const bullets = slide.bullets.length ? `<ul class="bullets" data-fit="bullets">${slide.bullets.map((b) => `<li>${plain(b)}</li>`).join("")}</ul>` : "";
      inner = `<h2 class="title" data-fit="title">${rich(slide.title)}</h2>${body()}${bullets}`;
    }
  }

  const titleSize = { cover: 84, stake: 64, content: 62, recap: 58, final: 64 }[slide.kind];
  const css =
    `*{box-sizing:border-box;margin:0;padding:0}` +
    `html,body{width:${W}px;height:${H}px;overflow:hidden;background:${d.scrimColor}}` +
    `body{font-family:"${FONT_FAMILY.text}";color:${ink};-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility;font-kerning:normal;font-synthesis:none}` +
    `.slide{position:relative;width:${W}px;height:${H}px;padding:${PAD}px;display:flex;flex-direction:column;background:${d.scrimColor};overflow:hidden}` +
    `.head{flex:none;display:flex;justify-content:flex-end;align-items:center;min-height:${px(48)}px}` +
    `.count{font-weight:700;font-size:${MIN_FONT}px;letter-spacing:.02em;color:${hexToRgba(light ? d.textColor : ink, 0.62)}}` +
    `.content{flex:1 1 auto;min-height:0;display:flex;flex-direction:column;justify-content:safe center;overflow:hidden;padding:${px(24)}px 0}` +
    `.card{background:${card};border-radius:${px(44)}px;padding:${px(64)}px ${px(64)}px ${px(56)}px;display:flex;flex-direction:column;gap:${g(34)}px;` +
    (light ? `box-shadow:0 ${px(18)}px ${px(50)}px ${hexToRgba(d.textColor, 0.13)}}` : `border:2px solid ${hexToRgba("#FFFFFF", 0.08)}}`) +
    `.kind-final .card{align-items:center;text-align:center}` +
    `.who{display:flex;align-items:center;gap:${px(26)}px}` +
    `.ava{flex:none;width:${px(104)}px;height:${px(104)}px;border-radius:50%;object-fit:cover}` +
    `.nm{min-width:0;font-weight:700;font-size:${px(40)}px;line-height:1.15;white-space:nowrap;overflow:hidden}` +
    `.title{font-weight:700;font-size:${t(titleSize)}px;line-height:1.14;letter-spacing:-.005em;text-wrap:balance;overflow-wrap:normal;word-break:normal;hyphens:manual}` +
    `.kind-stake .title{line-height:1.2;text-wrap:pretty}` +
    `.hl{color:${accent}}` +
    `.lead{font-size:${t(46)}px;line-height:1.36;color:${soft};text-wrap:pretty}` +
    `.tx{font-size:${t(44)}px;line-height:1.42;color:${soft};text-wrap:pretty}` +
    `.bullets,.recap{list-style:none;display:flex;flex-direction:column;gap:${g(22)}px}` +
    `.bullets li{position:relative;padding-left:${g(44)}px;font-size:${t(42)}px;line-height:1.34;color:${soft};text-wrap:pretty}` +
    `.bullets li::before{content:"";position:absolute;left:0;top:.66em;transform:translateY(-50%);width:${g(16)}px;height:${g(16)}px;border-radius:50%;background:${accent}}` +
    `.recap li{position:relative;padding-left:${g(64)}px;font-size:${t(42)}px;line-height:1.32;text-wrap:pretty}` +
    `.recap li::before{content:"";position:absolute;left:0;top:${g(5)}px;width:${g(44)}px;height:${g(44)}px;border-radius:50%;background:${accent}}` +
    `.recap li::after{content:"";position:absolute;left:${g(13)}px;top:${g(17)}px;width:${g(18)}px;height:${g(9)}px;border-left:${px(5)}px solid ${accentInk};border-bottom:${px(5)}px solid ${accentInk};transform:rotate(-45deg)}` +
    `.meta{display:flex;justify-content:space-between;gap:${px(20)}px;font-size:${MIN_FONT}px;color:${dim};border-top:2px solid ${hexToRgba(ink, 0.1)};padding-top:${px(26)}px}` +
    `.qr{flex:none;display:block;border-radius:${px(12)}px}` +
    `.chan{max-width:100%;white-space:nowrap;overflow:hidden;font-weight:700;font-size:${t(38)}px;line-height:1.2;color:${soft}}` +
    `.pl{font-weight:400;font-size:${MIN_FONT}px;color:${dim};margin-bottom:${px(6)}px}`;

  return (
    `<!doctype html><html lang="${lang}"><head><meta charset="utf-8">` +
    `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; font-src data:; img-src data:">` +
    `<style>${fontCss}${css}</style></head><body>` +
    `<main class="slide kind-${slide.kind}">` +
    `<header class="head"><div class="count">${index + 1}/${total}</div></header>` +
    `<section class="content"><article class="card">${who}${inner}</article></section>` +
    `</main></body></html>`
  );
}
