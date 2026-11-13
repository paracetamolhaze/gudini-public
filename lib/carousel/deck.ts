import type { Carousel, DesignSettings, Slide, SlideKind } from "./types";
import { DECK_TEXT } from "./limits";
import { stripEmphasis, visibleLength } from "./text";
import { channelTitle, TELEGRAM_CHANNEL, type TelegramChannel } from "./channel";

/**
 * Карусель по скиллу ig-carousel (schema 3): обложка → ставка → мысли → итог → финал.
 * Роли стоят по местам, а не по ответу модели: модель пишет тексты, порядок держит код.
 * Здесь чистые функции структуры и проверки — без сети, проверяются тестами.
 */

type DeckSlide = Pick<Slide, "kind" | "kicker" | "title" | "body" | "bullets" | "cta">;

export const isDeck = (c: Pick<Carousel, "schema" | "mode">) => c.schema === 3 && c.mode === "text_cards";

/**
 * Копия оформления для карточек по скиллу: цвета и шрифт — без настроек рисования. Ник и аватарку
 * Instagram для шапки задание сборки дописывает из профиля подключённого аккаунта (igProfile.ts).
 */
export const deckDesign = (d: DesignSettings): DesignSettings => ({
  accent: d.accent,
  textColor: d.textColor,
  scrimColor: d.scrimColor,
  titleFont: d.titleFont,
  author: d.author,
  illustrationStyle: "",
  ...(d.updatedAt ? { updatedAt: d.updatedAt } : {}),
});

/** Закрытый Telegram-канал владельца: в финале карусели — QR со ссылкой-приглашением. */
export type DeckContext = { channel: TelegramChannel | null };
export const deckContext = (): DeckContext => ({ channel: TELEGRAM_CHANNEL });

/** Роль по месту: первая — обложка, вторая — ставка, предпоследняя — итог, последняя — финал. */
export function deckKindAt(index: number, total: number): SlideKind {
  if (index === 0) return "cover";
  if (index === total - 1) return "final";
  if (index === total - 2) return "recap";
  if (index === 1) return "stake";
  return "content";
}

/** Слова считаются по буквам и цифрам: тире и «/» словами не считаются. */
export function wordCount(s: string): number {
  return stripEmphasis(s).split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

/**
 * Alt text карточки — её же текст: Instagram и экранные дикторы читают то, что на слайде.
 * На финале — ещё и QR канала, который голосом не прочитать.
 */
export function deckAltText(slide: DeckSlide, channel: TelegramChannel | null = null): string {
  const parts = [slide.title, slide.body, ...slide.bullets, slide.cta].map((x) => stripEmphasis(x).trim()).filter(Boolean);
  if (slide.kind === "final" && channel) parts.push(`QR-код для входа в Telegram-канал «${channelTitle(channel)}»`);
  const text = parts.map((p) => (/[.!?…:]$/.test(p) ? p : `${p}.`)).join(" ");
  return text.length > 1000 ? `${text.slice(0, 999).trimEnd()}…` : text;
}

/** Замечания к карточке по правилам скилла — для повторного запроса к модели. */
export function deckSlideProblems(s: DeckSlide, n: number): string[] {
  const p: string[] = [];
  const at = `карточка ${n}`;
  const words = (field: string, value: string, max: number) => {
    const count = wordCount(value);
    if (count > max) p.push(`${at}: ${field} ${count} слов, нужно до ${max}`);
  };
  const chars = (field: string, value: string, max: number) => {
    const len = visibleLength(value);
    if (len > max) p.push(`${at}: ${field} ${len} символов при пределе ${max}`);
  };
  if (!s.title) p.push(`${at}: пустой заголовок`);
  switch (s.kind) {
    case "cover":
      words("зацепка обложки", s.title, DECK_TEXT.coverWords);
      chars("зацепка обложки", s.title, DECK_TEXT.coverTitleChars);
      if (!s.body) p.push(`${at}: под зацепкой нужна одна строка обещания в body`);
      chars("строка обещания", s.body, DECK_TEXT.promiseChars);
      break;
    case "stake":
      words("ставка", s.title, DECK_TEXT.stakeWords);
      chars("ставка", s.title, DECK_TEXT.stakeChars);
      if (s.body || s.bullets.length) p.push(`${at}: ставка — одно предложение в title, body и bullets пустые`);
      break;
    case "content": {
      const count = wordCount(s.title);
      const [min, max] = DECK_TEXT.ideaTitleWords;
      if (count < min || count > max) p.push(`${at}: заголовок мысли ${count} слов, нужно ${min}–${max}`);
      chars("заголовок", s.title, DECK_TEXT.ideaTitleChars);
      words("текст под заголовком", [s.body, ...s.bullets].join(" "), DECK_TEXT.ideaWords);
      if (!s.body && !s.bullets.length) p.push(`${at}: под заголовком нужна мысль в body`);
      if (s.bullets.length === 1) p.push(`${at}: список из одного пункта — перенесите его в body`);
      if (s.bullets.length > DECK_TEXT.ideaBullets) p.push(`${at}: пунктов ${s.bullets.length}, максимум ${DECK_TEXT.ideaBullets}`);
      break;
    }
    case "recap": {
      words("заголовок итога", s.title, DECK_TEXT.recapTitleWords);
      const [min, max] = DECK_TEXT.recapBullets;
      if (s.bullets.length < min || s.bullets.length > max) p.push(`${at}: в итоге ${s.bullets.length} пунктов, нужно ${min}–${max}`);
      s.bullets.forEach((b, i) => {
        words(`пункт итога ${i + 1}`, b, DECK_TEXT.recapBulletWords);
        chars(`пункт итога ${i + 1}`, b, DECK_TEXT.recapBulletChars);
      });
      const lines = s.bullets.reduce((n, b) => n + Math.ceil(visibleLength(b) / DECK_TEXT.recapLineChars), 0);
      if (lines > DECK_TEXT.recapLines) p.push(`${at}: итог займёт около ${lines} строк, крупно помещается ${DECK_TEXT.recapLines} — сократи пункты`);
      if (s.body) p.push(`${at}: итог — только список в bullets, body пустой`);
      break;
    }
    case "final":
      // финал — одна строка про канал; QR со ссылкой-приглашением ставит сайт
      words("строка про канал", s.title, DECK_TEXT.finalTitleWords);
      break;
  }
  if (s.kind !== "final" && /telegram|телеграм|(?<![\p{L}])(?:тг|tg)(?![\p{L}])/iu.test(`${s.title} ${s.body} ${s.bullets.join(" ")}`)) p.push(`${at}: Telegram упоминается только в финале — здесь только тема`);
  if (/(^|\s)#[\p{L}\p{N}_]/u.test(`${s.title} ${s.body} ${s.bullets.join(" ")}`)) p.push(`${at}: хэштеги на карточке — перенесите в hashtags`);
  if ([s.body, ...s.bullets, s.cta].some((x) => x.includes("**"))) p.push(`${at}: звёздочки выделения допустимы только в заголовке`);
  return p;
}

/**
 * Подпись по правилу «Job B» из ig-caption: подпись — сама содержание, первая строка — зацепка
 * в пределах 125 видимых символов, несколько коротких строк, одно действие — Telegram, 3–5 тегов.
 */
export function deckCaptionProblems(caption: string, hashtags: string[], channel: TelegramChannel | null): string[] {
  const p: string[] = [];
  const lines = caption.split("\n").map((l) => l.trim()).filter(Boolean);
  const hook = lines[0] ?? "";
  if ([...hook].length > DECK_TEXT.captionHookChars) p.push(`первая строка ${[...hook].length} символов — зацепка должна уместиться в ${DECK_TEXT.captionHookChars} видимых символов до «ещё»`);
  if (/^[#@]|^\p{Extended_Pictographic}/u.test(hook)) p.push("первая строка начинается с хэштега, упоминания или эмодзи — начни с сути");
  if (lines.length > 6) p.push(`строк ${lines.length} — оставь зацепку, 2–4 короткие строки и одно действие`);
  if ([...caption].length > DECK_TEXT.captionMaxChars) p.push(`подпись ${[...caption].length} символов — сократи до ${DECK_TEXT.captionMaxChars}`);
  if (/https?:\/\/|www\.|t\.me\//i.test(caption)) p.push("ссылки в подписи не кликаются — назови канал словами");
  if (/(?:^|\s)#[\p{L}\p{N}_]/u.test(caption)) p.push("хэштеги в тексте подписи — перенеси их в hashtags");
  if (channel && !/telegram|телеграм/i.test(caption)) p.push("нет действия: последней строкой позови в Telegram-канал — QR на последнем слайде");
  if (/@[A-Za-z0-9_.]{3,}/.test(caption)) p.push("ник с @ в подписи: канал закрытый, вход по QR на последнем слайде — ник не нужен");
  const [min, max] = DECK_TEXT.hashtags;
  if (hashtags.length < min || hashtags.length > max) p.push(`хэштегов ${hashtags.length}, нужно ${min}–${max} точных по теме`);
  return p;
}
