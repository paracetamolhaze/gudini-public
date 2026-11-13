import type { CarouselFormat, CarouselGenre, CarouselLanguage, MemeCategory, SlideKind } from "./types";

/**
 * Ограничения Instagram Content Publishing API. Сверено с документацией Meta 2026-09-13:
 * developers.facebook.com/docs/instagram-platform/content-publishing
 * developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media
 *
 * Карусель — до 10 элементов; картинки только JPEG до 8 МБ, ширина 320–1440, соотношение
 * от 4:5 до 1.91:1, sRGB; подпись до 2200 символов, 30 хэштегов и 20 упоминаний; не больше
 * 100 публикаций через API за скользящие 24 часа; неопубликованный контейнер живёт 24 часа.
 */
export const IG_LIMITS = {
  minItems: 2,
  maxItems: 10,
  imageMime: "image/jpeg",
  imageMaxBytes: 8 * 1024 * 1024,
  minWidth: 320,
  maxWidth: 1440,
  minAspect: 4 / 5,
  maxAspect: 1.91,
  captionMaxChars: 2200,
  maxHashtags: 30,
  maxMentions: 20,
  postsPer24h: 100,
  containerTtlHours: 24,
  docsCheckedAt: "2026-09-13",
} as const;

/** Версия Graph API для публикации каруселей (Reels живут на своей версии в lib/publish.ts). */
export const IG_API_VERSION = "v25.0";

export const CAROUSEL_LIMITS = {
  minSlides: 3,
  maxSlides: IG_LIMITS.maxItems,
  defaultSlides: 7,
  ideaMin: 3,
  ideaMax: 1500,
  wishesMax: 1500,
  instructionMax: 800,
  hintMax: 400,
  footerMax: 40,
  titleMax: 90,
  claimsMax: 12,
  /** очередь заданий на весь раздел: генерация не должна копиться без предела */
  maxQueuedJobs: 20,
} as const;

/**
 * Карусель по скиллу ig-carousel: 6–10 слайдов. Меньше шести — обложка, ставка, итог и финал
 * съедают всё место мыслей; больше десяти Instagram не принимает. Мемы собираются по 5 и живут
 * по CAROUSEL_LIMITS.
 */
export const DECK_LIMITS = { minSlides: 6, maxSlides: IG_LIMITS.maxItems, defaultSlides: 8 } as const;

export const FORMATS: Record<CarouselFormat, { width: number; height: number; label: string }> = {
  portrait: { width: 1080, height: 1350, label: "4:5 · 1080×1350" },
  square: { width: 1080, height: 1080, label: "1:1 · 1080×1080" },
};

export const LANGUAGES: Record<CarouselLanguage, { label: string; prompt: string; swipe: string }> = {
  ru: { label: "Русский", prompt: "на русском языке", swipe: "Листай" },
  uk: { label: "Українська", prompt: "українською мовою", swipe: "Гортай" },
  en: { label: "English", prompt: "in English", swipe: "Swipe" },
};

/**
 * Пределы длины полей карточки в символах. Это ориентир для Claude и счётчики редактора;
 * окончательно помещается ли текст, решает рендер (он проверяет переполнение).
 */
export const TEXT_LIMITS: Record<SlideKind, { kicker: number; title: number; body: number; bodyWithBullets: number; bullet: number; bullets: number; cta: number }> = {
  cover: { kicker: 32, title: 80, body: 100, bodyWithBullets: 0, bullet: 0, bullets: 0, cta: 0 },
  stake: { kicker: 0, title: 150, body: 0, bodyWithBullets: 0, bullet: 0, bullets: 0, cta: 0 },
  content: { kicker: 28, title: 70, body: 200, bodyWithBullets: 90, bullet: 70, bullets: 4, cta: 0 },
  recap: { kicker: 0, title: 40, body: 0, bodyWithBullets: 0, bullet: 64, bullets: 6, cta: 0 },
  final: { kicker: 28, title: 70, body: 160, bodyWithBullets: 0, bullet: 0, bullets: 0, cta: 50 },
};

/**
 * Карточки по скиллу считаются словами: обложка — до 6 слов, мысль — заголовок 3–7 слов и до 25
 * слов под ним. Символы — потолок, чтобы длинные слова не разорвали строку.
 */
export const DECK_TEXT = {
  coverWords: 6,
  coverTitleChars: 48,
  promiseChars: 80,
  stakeWords: 22,
  stakeChars: 150,
  ideaTitleWords: [3, 7] as const,
  ideaTitleChars: 56,
  ideaWords: 25,
  ideaBullets: 4,
  recapTitleWords: 5,
  recapBullets: [3, 5] as const,
  recapBulletWords: 6,
  recapBulletChars: 64,
  /** итог в карточке поста: около 30 знаков в строке и не больше 7 строк списка */
  recapLineChars: 30,
  recapLines: 7,
  finalTitleWords: 8,
  /** подпись: первая строка видна до «ещё» */
  captionHookChars: 125,
  captionMaxChars: 700,
  hashtags: [3, 5] as const,
} as const;

/** Жёсткий потолок ручного ввода: защищает хранилище, а не вёрстку. */
export const HARD_FIELD_MAX = 600;

export function isFormat(v: unknown): v is CarouselFormat {
  return v === "portrait" || v === "square";
}

export function isLanguage(v: unknown): v is CarouselLanguage {
  return v === "ru" || v === "uk" || v === "en";
}

/** Стили карусели в форме создания: экспертный разбор или подборка мемов (lib/carousel/meme.ts). */
export const GENRES: Record<CarouselGenre, { label: string; hint: string }> = {
  expert: { label: "Экспертная", hint: "Разбор темы по шагам: обложка, аргументы, вывод" },
  meme: { label: "Мемы", hint: "Каждый слайд — отдельный смешной мем про заработок, крипту или трейдинг. Тему можно не писать — придумает сам" },
};

export const isGenre = (v: unknown): v is CarouselGenre => typeof v === "string" && Object.prototype.hasOwnProperty.call(GENRES, v);

/**
 * Категории мем-карусель: вся подборка из одного мира. topic — «мемы про …», about — ситуации
 * этого мира для сценариста. Порядок — очередь кнопки «Сделать мемы» без выбранной категории.
 */
export const MEME_CATEGORIES: Record<MemeCategory, { label: string; topic: string; about: string; words: string }> = {
  trading: { label: "Трейдинг", topic: "трейдинг", about: "сделки, плечи и стопы, ликвидации, графики и свечи, сигналы из чатов, демосчёт, «последняя сделка на сегодня», скрины профита", words: "свечи, красный и зелёный, позиция, сигналы, пробой, дно, минус и плюс, слив, стоп, шорт и лонг, ликвидация, плечо, отскок, профит" },
  crypto: { label: "Крипта", topic: "крипту", about: "поведение толпы, вера в иксы, киты и хомяки, холд, биржи, кошельки, комиссии и переводы, биткоин, мемкоины и другие активы; разные ситуации без обязательной темы, актуальные события только с проверенным источником", words: "кошелёк, ключи, комиссия, сеть, перевод, газ, ликвидность, холодное хранение, стейкинг, биткоин, холд, кит, хомяк" },
  streams: { label: "Стримы", topic: "стримы", about: "донаты, чат, ночные эфиры, стример, который учит зарабатывать, розыгрыши, первые зрители", words: "донат, чат, стрим, эфир, бан, модератор, подписка, клип, рейд, фоловер, микрофон, камера, алерт, заставка" },
  earning: { label: "Заработок", topic: "заработок в интернете", about: "первый заработок, «пассивный доход», курсы успеха, фриланс, работа против свободы, мотивация, копить на мечту", words: "пассивный доход, кэшбэк, фриланс, дедлайн, заказчик, правки, инфоцыган, курс, наставник, воронка, реферал, выплата, зарплата, аванс" },
  money: { label: "Трейдинг, крипта и заработок", topic: "трейдинг, крипту и заработок", about: "деньги героя: сделки и плечи, ликвидации, графики и свечи, монеты и мемкоины, эйрдропы, холд, курсы успеха, «пассивный доход», первый заработок, работа против свободы", words: "свечи, красный и зелёный, позиция, сигналы, пробой, дно, минус и плюс, слив, стоп, плечо, холд, кошелёк, иксы, памп, дамп, хомяк, кит, курс, наставник, пассивный доход" },
};

/** Active meme topics. The streams registry entry exists only to read historical data. */
export const MEME_CATEGORY_ORDER: MemeCategory[] = ["trading", "crypto", "earning"];

export const isMemeCategory = (v: unknown): v is MemeCategory => typeof v === "string" && v !== "streams" && Object.prototype.hasOwnProperty.call(MEME_CATEGORIES, v);

/** Тексты мем-слайда одной строкой: так они хранятся в оценке автора и во вкусе сценариста. */
export function memeSlideTexts(s: { title: string; body: string; bullets?: string[] }): string {
  return [s.title, s.body, ...(s.bullets ?? [])].filter(Boolean).join(" / ");
}
