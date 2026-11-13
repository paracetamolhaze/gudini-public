/**
 * Карусели — отдельный раздел сайта: идея → Claude готовит содержание и описания иллюстраций →
 * генератор рисует иллюстрации → сайт собирает карточки → правки → публикация в Instagram
 * сразу или по расписанию. С видеопроектами не пересекается ни хранилищем, ни очередью,
 * ни ключами: всё лежит в data/carousels/, запросы идут через отдельный ключ OpenRouter.
 */

/**
 * stake и recap — роли карусели по скиллу ig-carousel (schema 3): ставка сразу после обложки
 * и итог списком перед финалом. Старые карусели и мемы собраны из cover/content/final.
 */
export type SlideKind = "cover" | "stake" | "content" | "recap" | "final";

export type SlideRender = {
  /** отпечаток содержимого и оформления, по которому сделан файл */
  hash: string;
  file?: string;
  width?: number;
  height?: number;
  bytes?: number;
  /** коэффициент кегля после подгонки: 1 — без уменьшения */
  scale?: number;
  at: string;
  /** текст не поместился, шрифт не покрыл символы или нет иллюстрации: файла нет */
  error?: string;
};

export type ImageModelId = "codex/imagegen" | "google/gemini-3.1-flash-image" | "google/gemini-3-pro-image" | "openai/gpt-image-2";
export type TextPlacement = "top" | "bottom";

export type ImageReference = { kind: "account" | "anchor" | "source" | "portrait"; file: string };

/** Одна сгенерированная иллюстрация. Версии не удаляются: к любой можно вернуться. */
export type ImageVersion = {
  /** For painted lettering, detect edits which require a new image. */
  paintedTextKey?: string;
  id: string;
  file: string;
  mediaType: string;
  width: number;
  height: number;
  bytes: number;
  model: ImageModelId;
  resolution: string | null;
  kind: "generate" | "edit";
  /** промпт, ушедший в генератор целиком */
  prompt: string;
  instruction?: string;
  references: ImageReference[];
  cost: number;
  estimated: boolean;
  at: string;
};

export type SlideImageStatus = "none" | "generating" | "ready" | "error" | "uncertain";

export type SlideImage = {
  /** что изображено именно на этом слайде (от Claude, по-английски) */
  brief: string;
  /** кадр, ракурс, где главный объект */
  composition: string;
  /** где на карточке текст — там иллюстрация должна быть спокойной */
  textPlacement: TextPlacement;
  versions: ImageVersion[];
  currentId?: string;
  /**
   * Растёт при выборе версии и правке описания. Задание запоминает значение при старте:
   * если за время генерации пользователь что-то поменял, новая версия сохраняется, но не
   * становится текущей — поздний ответ не перезаписывает более новую правку.
   */
  rev: number;
  status: SlideImageStatus;
  error?: string;
  /** запрос к генератору отправлен, результат ещё не записан — после перезапуска исход неизвестен */
  inFlight?: { at: string; jobId: string; spendId: string };
  attempts: number;
};

export type Slide = {
  id: string;
  kind: SlideKind;
  /** короткая метка над заголовком: «Ошибка №2», «Шаг 3» */
  kicker: string;
  title: string;
  body: string;
  bullets: string[];
  /** призыв на заключительной карточке */
  cta: string;
  image?: SlideImage;
  render?: SlideRender;
  /** оценка мема автором; texts — тексты на момент оценки: сменилась шутка — оценка к ней не относится */
  rating?: { value: "up" | "down"; texts: string; at: string };
};

export type CarouselStyleId = "graphite" | "paper" | "sunset" | "ocean" | "contrast";
export type CarouselFormat = "portrait" | "square";
export type CarouselLanguage = "ru" | "uk" | "en";
export type CarouselMode = "text_cards" | "illustrated";
/** expert — разбор темы по шагам; meme — каждый слайд отдельный мем (плашки поверх иллюстрации) */
export type CarouselGenre = "expert" | "meme";
/** одна мем-карусель — одна категория: все мемы из одного мира */
/** money — общая тема сценок с Лукашенко: трейдинг, крипта и заработок вместе, без стримов. */
export type MemeCategory = "trading" | "crypto" | "streams" | "earning" | "money";

export type CarouselRequest = {
  idea: string;
  /** старые карусели: отдельное поле пожеланий; в новом сценарии пожелания пишутся в идее */
  wishes: string;
  slideCount: number;
  language: CarouselLanguage;
  /** цветовой шаблон старых текстовых карточек */
  style: CarouselStyleId;
  format: CarouselFormat;
  imageModel?: ImageModelId;
  /** стиль карусели; у старых нет — экспертная */
  genre?: CarouselGenre;
  /** категория мемов; нет — вся карусель в категории своей темы */
  memeCategory?: MemeCategory;
  /** карусель собрана из мемов этого стиля раздела «Мемы» */
  memeStyle?: "lukashenko" | "classic";
};

/** Оформление аккаунта: задаётся один раз, карусель при создании сохраняет свою копию. */
export type DesignSettings = {
  /** только в копии оформления карусели: мем-карусель пишется, рисуется и вёрстается по своим правилам */
  genre?: CarouselGenre;
  artworkMode?: "overlay" | "painted";
  portraitFile?: string;
  characterDescription?: string;
  accent: string;
  textColor: string;
  scrimColor: string;
  titleFont: "display" | "condensed";
  /** подпись автора внизу карточек, например @аккаунт */
  author: string;
  logoFile?: string;
  /** только в копии оформления карусели по скиллу: ник и аватарка аккаунта Instagram для шапки слайдов */
  igHandle?: string;
  avatarFile?: string;
  /** предпочтительный стиль иллюстраций своими словами */
  illustrationStyle: string;
  /** необязательный визуальный референс стиля */
  referenceFile?: string;
  updatedAt?: string;
};

/** Общая визуальная концепция серии от Claude. */
export type VisualConcept = {
  idea: string;
  style: string;
  palette: string;
  lighting: string;
  characters: { name: string; look: string }[];
  objects: string[];
};

export type JobType = "generate" | "render" | "regenerate_slide" | "instruct" | "images" | "image" | "publish" | "verify_publish";
export type JobState = "queued" | "running" | "done" | "error";

export type JobParams = {
  slideId?: string;
  slideIds?: string[];
  hint?: string;
  instruction?: string;
  /** image: новая иллюстрация или правка текущей поручением */
  mode?: "regenerate" | "edit";
  /** regenerate_slide: вместе с текстом нарисовать и новую иллюстрацию */
  withImage?: boolean;
  /** images: повторить в том числе слайды с неизвестным исходом (явное решение пользователя) */
  includeUncertain?: boolean;
  /** generate: «planned» — содержание уже записано, при возобновлении остаются иллюстрации и сборка */
  stage?: "planned";
  /** publish: публикация по расписанию */
  scheduleId?: string;
};

export type CarouselJob = {
  id: string;
  type: JobType;
  state: JobState;
  step: string;
  progress: number;
  params: JobParams;
  error?: string;
  /** итог для пользователя: что изменено, какие слайды требуют правки */
  note?: string;
  attempts: number;
  queuedAt: string;
  startedAt?: string;
  finishedAt?: string;
  heartbeatAt?: string;
  runnerPid?: number;
  /** ошибка лимита подписки Claude: когда планировщик сам поставит задание на повтор */
  retryAt?: string;
};

export type PublishStage = "prepare" | "children" | "container" | "publish_sent" | "verifying" | "done";
export type PublishStatus = "idle" | "queued" | "running" | "published" | "failed" | "uncertain";

export type PublishItem = { slideId: string; file: string; containerId?: string; createdAt?: string };

/** Аккаунт Instagram, выбранный для конкретной публикации: переключение активного его не меняет. */
export type PublishAccount = { id: string; igUserId: string; label: string | null; via: "ig" | "fb" | "threads" };

export type ThreadsReply = { text: string; containerId?: string; sentAt?: string; mediaId?: string };

export type PublishState = {
  replies?: ThreadsReply[];
  status: PublishStatus;
  stage?: PublishStage;
  /** ревизия карусели, которую пользователь просмотрел и отправил */
  revision?: number;
  items: PublishItem[];
  caption?: string;
  account?: PublishAccount;
  scheduleId?: string;
  igUserId?: string;
  accountLabel?: string;
  containerId?: string;
  containerCreatedAt?: string;
  publishSentAt?: string;
  publishAttempts: number;
  mediaId?: string;
  permalink?: string;
  publishedAt?: string;
  /** пояснение к итогу, не ошибка: например, пост вышел, но ссылку Instagram не вернул */
  note?: string;
  error?: string;
  /** можно ли просто повторить: в Instagram ничего не ушло или проверка это подтвердила */
  retryable?: boolean;
  log: { at: string; text: string }[];
};

export type ScheduleStatus = "scheduled" | "queued" | "publishing" | "published" | "failed" | "uncertain" | "canceled" | "missed";

export type ScheduleSnapshot = {
  revision: number;
  items: { slideId: string; file: string }[];
  caption: string;
  approvedAt: string;
};

export type ScheduleState = {
  id: string;
  status: ScheduleStatus;
  /** момент публикации в UTC */
  runAt: string;
  timeZone: string;
  /** время, которое выбрал пользователь, в его часовом поясе: 2026-09-14T10:00 */
  localTime: string;
  account: PublishAccount;
  snapshot: ScheduleSnapshot;
  createdAt: string;
  updatedAt: string;
  permalink?: string;
  error?: string;
  history: { at: string; text: string }[];
};

export type CarouselCost = {
  /** итог по карусели, $ */
  usd: number;
  calls: number;
  text?: number;
  images?: number;
  /** запросы с неизвестным исходом, учтённые по оценке */
  uncertain?: number;
  /** расход старых карусель, созданных до журнала раздела */
  legacyUsd?: number;
};

export type Carousel = {
  /** Отложена автором без оценки качества мемов. */
  archivedAt?: string;
  id: string;
  /**
   * 3 — карточки по скиллу ig-carousel: обложка → ставка → мысли → итог → финал в Telegram,
   * текст ставит сайт в цветах оформления аккаунта. 1 и 2 — прежние карусели.
   * 4 — формат @siddhantt.ai (lib/carousel/sid): раздел сам находит тему, пишет, рисует обложку,
   * снимает источники и собирает готовые слайды и ролик; данные формата — в sid.
   */
  schema: 1 | 2 | 3 | 4;
  createdAt: string;
  updatedAt: string;
  /** растёт при каждом изменении содержимого; публикация сверяет её с просмотренной */
  revision: number;
  title: string;
  request: CarouselRequest;
  style: CarouselStyleId;
  format: CarouselFormat;
  language: CarouselLanguage;
  /** подпись внизу старых текстовых карточек */
  footer: string;
  story: string[];
  slides: Slide[];
  caption: string;
  hashtags: string[];
  /** утверждения, которые Claude советует проверить перед публикацией */
  claimsToCheck: string[];
  research?: import("./research").CarouselResearch;
  /** text_cards — карточки без иллюстраций (с schema 3 — по скиллу ig-carousel); illustrated — с генерацией картинок */
  mode: CarouselMode;
  imageModel?: ImageModelId;
  imageResolution?: string | null;
  design?: DesignSettings;
  visual?: VisualConcept;
  /** опора серии: иллюстрация, которую получают как референс следующие слайды */
  anchor?: { slideId: string; versionId: string; file: string };
  job: CarouselJob | null;
  publish: PublishState;
  publishHistory?: PublishState[];
  /** отметка «Опубликована», когда владелец залил карусель сам, а пост ещё не нашёлся в статистике (lib/carousel/igPost) */
  manualPublishedAt?: string;
  schedule?: ScheduleState;
  schedules?: ScheduleState[];
  cost: CarouselCost;
  sid?: import("./sid/types").SidData;
};
