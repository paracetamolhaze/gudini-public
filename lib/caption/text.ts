/**
 * Текст публикации ролика: подпись для Instagram и TikTok, заголовок и описание YouTube.
 * По просьбе автора подпись — одна мысль (мораль ролика) и вопрос, без хэштегов: зритель читает
 * её, когда ролик уже посмотрел, и пересказ ему не нужен. Чистка — по идеям ig-human
 * (github.com/Jakeschincariol/instagram-agent-skill). Модуль без серверных зависимостей — его берёт и страница.
 */

/** Столько знаков подписи лента показывает до «ещё». */
export const VISIBLE_CHARS = 125;
/** Мораль и вопрос: две фразы. */
export const CAPTION_MAX = 200;
export const CAPTION_SENTENCES = 2;
/** Заголовок YouTube виден целиком в выдаче и под роликом. */
export const TITLE_MAX = 60;

export type SocialMeta = { title: string; description: string; hashtags: string[] };

const chars = (...points: number[]) => String.fromCharCode(...points);
// управляющие и невидимые символы: с клавиатуры их не набрать, а копирование их сохраняет
const INVISIBLE = new RegExp(
  `[${chars(0)}-${chars(8)}${chars(0x0b, 0x0c)}${chars(0x0e)}-${chars(0x1f)}${chars(0x7f, 0xad, 0x200b, 0x200c, 0x200e, 0x200f, 0x2060, 0x2061, 0x2062, 0x2063, 0x2064, 0xfeff)}]`,
  "g",
);
const ODD_SPACES = new RegExp(`[${chars(0xa0, 0x2002, 0x2003, 0x2004, 0x2005, 0x2007, 0x2009, 0x200a, 0x202f)}]`, "g");
const DASHES = new RegExp(`[${chars(0x2010, 0x2011, 0x2012, 0x2013, 0x2014, 0x2015, 0x2212)}]`, "g");
const DOUBLE_QUOTES = new RegExp(`[${chars(0x201c, 0x201d, 0x201e, 0x201f)}]`, "g");
const SINGLE_QUOTES = new RegExp(`[${chars(0x2018, 0x2019)}]`, "g");
const ELLIPSIS = chars(0x2026);
const PICTOGRAPHIC = /\p{Extended_Pictographic}/u;
const HASHTAG_IN_TEXT = /(^|[^\p{L}\p{N}_&])#([\p{L}\p{N}_]+)/gu;

/**
 * Типографика как у автора: дефис вместо длинного тире, «ёлочки», три точки,
 * обычные пробелы и ни одного невидимого символа.
 */
export function cleanSocialText(value: unknown, opts: { multiline?: boolean } = {}): string {
  let s = typeof value === "string" ? value : value == null ? "" : String(value);
  s = s.normalize("NFC").replace(/\r\n?/g, "\n").replace(INVISIBLE, "").replace(ODD_SPACES, " ");
  s = s.replace(DASHES, "-").replace(SINGLE_QUOTES, "'").split(ELLIPSIS).join("...");
  s = s.replace(DOUBLE_QUOTES, "\"").replace(/(^|[\s(\[{])"/g, "$1«").replace(/"/g, "»");
  if (!opts.multiline) return s.replace(/\s+/g, " ").trim();
  return s
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Оставляет первые `max` эмодзи; по умолчанию ни одного — подпись держится на словах. */
export function limitEmoji(text: string, max = 0): string {
  let seen = 0;
  let out = "";
  for (const { segment } of new Intl.Segmenter("ru", { granularity: "grapheme" }).segment(text)) {
    if (PICTOGRAPHIC.test(segment) && ++seen > max) continue;
    out += segment;
  }
  return out.replace(/ {2,}/g, " ").replace(/ +([.,!?])/g, "$1").replace(/ +\n/g, "\n").trim();
}

/** Хэштеги, которые модель всё же вставила в текст, убираются: у роликов их нет. */
export function stripHashtags(text: string): string {
  return cleanSocialText(text.replace(HASHTAG_IN_TEXT, "$1"), { multiline: true });
}

/** Заголовок не длиннее `max`: обрезка по границе слова, без висящих знаков в конце. */
export function fitTitle(title: string, max = 100): string {
  if (title.length <= max) return title;
  const cut = title.slice(0, max + 1);
  const space = cut.lastIndexOf(" ");
  return (space > max / 2 ? cut.slice(0, space) : title.slice(0, max)).replace(/[\s,.:;!?-]+$/, "");
}

/** Ответ модели → чистые поля: заголовок одной строкой, подпись без эмодзи и хэштегов. */
export function normalizeMeta(raw: { title?: unknown; description?: unknown } | null | undefined, topic: string): SocialMeta {
  const title = fitTitle(cleanSocialText(raw?.title) || cleanSocialText(topic));
  const description = limitEmoji(stripHashtags(cleanSocialText(raw?.description, { multiline: true }))).slice(0, 2200).trim();
  return { title, description, hashtags: [] };
}

/** Фразы подписи по знакам конца предложения. */
export function sentences(text: string): string[] {
  return (text.replace(/\s+/g, " ").match(/[^.!?…]+(?:[.!?…]+|$)/gu) ?? []).map((s) => s.trim()).filter(Boolean);
}

/** Первая фраза подписи: лента обрезает текст на 125 знаках, и мысль должна закончиться раньше. */
export function firstSentence(text: string): string {
  return sentences(text)[0] ?? "";
}

// Обороты, по которым подпись сразу читается как шаблон: просьбы подписаться, анонсы
// «в этом видео», обещания «всей правды». Проверка ищет их целыми словами.
const STOCK_PHRASES = [
  "подпис(?:ывайся|ывайтесь|ись|итесь)",
  "ставь(?:те)? лайк",
  "лайк,? если",
  "сохрани(?:те)?,? чтобы не потерять",
  "дальше\\s*(?:-\\s*)?больше",
  "будет (?:ещё|еще) (?:круче|интереснее|больше)",
  "в (?:этом|сегодняшнем) (?:видео|ролике)",
  "сегодня (?:я )?(?:расскажу|разбер[её]м|поговорим)",
  "давай(?:те)? разбер[её]мся",
  "вся правда",
  "(?:тебе|вам) не (?:рассказывали|расскажут|говорили)",
  "(?:ты|вы) (?:точно )?не знали?",
  "(?:ты не поверишь|вы не поверите)",
  "(?:до)?смотри(?:те)? до конца",
  "погнали",
  "залетай(?:те)?",
  "отметь(?:те)? друга",
  "поделись с (?:другом|друзьями)",
  "в современном мире",
  "раскры(?:ть|вает|вают) (?:свой |весь )?потенциал",
].map((source) => new RegExp(`(?<![\\p{L}\\p{N}])(?:${source})(?![\\p{L}\\p{N}])`, "iu"));
const LINK = /(?:https?:\/\/|www\.|t\.me\/)\S+/i;

/**
 * Что поправить, чтобы подпись стала как образец. Формулировки — поручения редактору:
 * их получает модель на втором проходе.
 */
export function captionIssues(meta: SocialMeta): string[] {
  const issues: string[] = [];
  const text = meta.description;
  if (!meta.title) issues.push("Добавь заголовок для YouTube: суть ролика и поисковая фраза, до 60 знаков.");
  else if (meta.title.length > TITLE_MAX) issues.push(`Заголовок ${meta.title.length} знаков: оставь суть и поисковую фразу, чтобы вышло до ${TITLE_MAX}.`);
  if (!text) {
    issues.push("Напиши подпись: мораль ролика одной фразой и вопрос зрителю.");
  } else {
    const parts = sentences(text);
    if (parts.length > CAPTION_SENTENCES) issues.push(`В подписи ${parts.length} фраз: оставь одну мысль - мораль ролика - и вопрос. Что было в ролике, зритель уже видел.`);
    const head = parts[0] ?? "";
    if (head.length > VISIBLE_CHARS) issues.push(`Первая фраза ${head.length} знаков: скажи мораль короче, чтобы она целиком помещалась в ленте до «ещё» (${VISIBLE_CHARS} знаков).`);
    if (text.length > CAPTION_MAX) issues.push(`Подпись ${text.length} знаков: мораль и вопрос укладываются в ${CAPTION_MAX}.`);
    if (!/\?\s*$/.test(text)) issues.push("Закончи подпись одним вопросом зрителю, который продолжает мораль.");
    if (LINK.test(text)) issues.push("Ссылки в подписи не нажимаются: скажи мысль словами, без адреса.");
    for (const re of STOCK_PHRASES) {
      const m = text.match(re);
      if (m) issues.push(`«${m[0]}» звучит как шаблон: скажи мораль своими словами или замени вопросом зрителю.`);
    }
  }
  return issues;
}

/**
 * Подпись для Instagram и TikTok: зацепку несёт видео, поэтому заголовок YouTube сюда не идёт.
 * Хэштеги — только если автор вписал их сам. Пустая подпись — тогда заголовок или тема, чтобы пост не вышел немым.
 */
export function socialCaption(meta: Partial<SocialMeta> | null | undefined, topic: string): string {
  const text = meta?.description?.trim() || meta?.title?.trim() || topic.trim();
  return [text, (meta?.hashtags ?? []).join(" ").trim()].filter(Boolean).join("\n\n");
}
