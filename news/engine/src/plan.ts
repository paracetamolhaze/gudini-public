// План ролика «Новости»: что звучит и что видно, по порядку. Пишет его конвейер (lib/news), монтаж только исполняет.
// Все пути — внутри public-папки задания.

export type Word = { w: string; s: number; e: number };

/** Одна реплика: файл озвучки и тайминги слов от его начала. */
export type Line = { file: string; words: Word[]; end: number; speaker: "narrator" | "hero" };

/** Исходный ролик героя. gain — громкость его звука, выровненная по голосу рассказчика. */
/**
 * captions — чужие титры, наложенные на ролик (секунды исходника и полоса по высоте кадра, доли 0–1): движок их размывает,
 * чтобы под русскими субтитрами не висел второй, английский слой (владелец 29.10 согласился: «делаем»).
 */
/** ru — русские титры: размываются под словами автора и переводом, а в куске героя (orig) остаются — это его субтитры. */
/**
 * overlay — видеомем поверх ролика, а не во весь экран (владелец 1.11: «видео мемы… убрать фоны и накладывать на видео»):
 * file — мем без размытых полей (со звуком), cut — он же без фона (WebM с прозрачностью; нет — мем идёт карточкой),
 * w и h — размер его кадра. Под ним продолжается последний план ролика (runner/py/vmeme_prep.py готовит файлы).
 */
export type Clip = { file: string; gain: number; /** длина файла, с; перебивка, которой не хватает клипа, начинается раньше */ duration?: number; captions?: { from: number; to: number; y0: number; y1: number; ru?: boolean; fill?: string }[]; overlay?: {
    cut?: string;
    w: number;
    h: number;
    /**
     * Мем-переход («A few moments later», концовка «Ералаша»): целиком по ширине поверх своего же кадра во весь экран
     * (владелец 2.11: «такой мем нужно на весь экран»; остальные мемы — карточкой).
     */
    transition?: boolean;
  } };

/** Как показан план. at — с какой секунды исходника; endAt / maxAt — план упирается в нужный момент исходника. */
export type Look = {
  clip?: string;
  at?: number;
  still?: string;
  phone?: boolean;
  subY?: number;
  focusY?: number;
  zoomFrom?: number;
  endAt?: number;
  maxAt?: number;
  sfx?: string;
  /** Масштаб в начале и в конце плана — вместо обычного наезда (стоп-кадр и наезд внутри куска героя продолжают его кадр). */
  zoomRange?: [number, number];
  /** Куда смотрит наезд по ширине кадра (лицо говорящего); без него — середина. */
  focusX?: number;
  /**
   * Снимок страницы с фразой под маркером: маркер проводится по строкам слева направо, когда план начался (runner/opus).
   * base — тот же снимок без маркера, rects — строки маркера в пикселях снимка 1080×1920, по порядку чтения. Сам still —
   * снимок с готовым маркером: им план и заканчивается.
   */
  sweep?: { base: string; rects: { x: number; y: number; w: number; h: number }[] };
};

/**
 * Место куска героя (секунды от его начала) под другой картинкой, звук куска идёт дальше. clip/at — план ролика (без clip —
 * того же); still — стоп-кадр вместо обрывка чужого плана на стыке; punch — наезд на говорящего в том же ролике и в ту же
 * секунду (длинный план без склеек), focusX/focusY — его лицо.
 */
export type Cover = { from: number; to: number; at: number; clip?: string; still?: string; punch?: number; focusX?: number; focusY?: number };

export type Segment =
  /** Рассказчик; планы сменяются на словах с номером w. */
  | { narr: string; shots: (Look & { w: number })[] }
  /**
   * Герой своим голосом; covers — места куска (секунды от его начала) под другим планом без звука: ролика clip (без него —
   * того же) с секунды at. Пустой кадр или не тот человек на словах о ком-то.
   */
  | { orig: string; from: number; to: number; covers?: Cover[] }
  /** Герой на чужом языке: его звук приглушён, поверх — перевод другим голосом. */
  | { dub: string; from: number; to: number; lines: { id: string; at: number; subY?: number }[]; covers?: Cover[] };

/** Акцент на слове: толчок кадра, тряска, звук. */
export type Hit = { line: string; w: number; kick?: number; shake?: boolean; sfx?: string };

export type NewsPlan = {
  clips: Record<string, Clip>;
  lines: Record<string, Line>;
  segments: Segment[];
  hits: Hit[];
  /** Музыка под всем роликом, уже −14 LUFS; volume — доля под голосом. */
  music: { file: string; volume: number } | null;
  /** Подпись на карточке ролика героя, например «26,5M». */
  badge?: string;
  /** Верх строки субтитров, px; нет поля — 1190, как в роликах до 7.11 (их карточки стоят ниже и с новой высотой не сходятся). */
  subLow?: number;
  /** Звуки, которые есть в sfx/ задания; остальные не звучат (владелец убрал их папку). Нет поля — звучат все. */
  sounds?: string[];
  /** Владелец в кадре: на зачине «Вот этот…» и там, где автор говорит от себя (runner/pipeline/peek.ts). */
  peeks?: OwnerPeek[];
  /** Старые планы: одно появление владельца (сбоку со стрелкой или снизу в углу). */
  peek?: OwnerPeek;
  /**
   * Вставка-наклейка поверх ролика на dur секунд со слова w реплики line: вырезанная вещь, которую называют слова. cx, cy,
   * scale — центр и размер карточки, когда на обычном месте лицо (runner/pipeline/inserts.ts cardSpot).
   */
  inserts?: { line: string; w: number; file: string; dur: number; kind?: "sticker" | "meme" | "photo" | "logo"; iw?: number; ih?: number; credit?: string; cx?: number; cy?: number; scale?: number; rot?: number }[];
  /** Графика поверх кадра со слова w реплики line (runner/pipeline/overlays.ts). */
  overlays?: Overlay[];
  /** Как движок показывает вставки: logoReveal — логотип собирается на карточке, а не выскакивает целиком. */
  /**
   * calm — кадр стоит: без наезда на план, без толчка и вспышки на склейках и акцентных словах (владелец 3.11 о ролике про
   * уход бирж: «без движения кадров», только посты и сайты).
   */
  /**
   * motion — вставки двигаются по измеренным числам (engine/src/motion.ts): приход из увеличенного или от края с
   * замедлением, уход с ускорением, без перелёта; нет поля — прежние прыжки. wordLead — вставка трогается за два кадра
   * до своего слова и к слову уже стоит. focus — пока деталь обведена, остальной кадр чуть притемнён.
   */
  fx?: { logoReveal?: boolean; calm?: boolean; motion?: boolean; wordLead?: boolean; focus?: boolean };
};

/**
 * Графика поверх кадра (каталог видео-скиллов, 31.10): mark — обводка, стрелка или подчёркивание от руки вокруг box
 * (пиксели экрана 1080×1920); chat — переписка пузырями по-русски; number — крупное число отсчётом; map — карта со
 * страной события (file — svg мира в public, focus — рамка страны в его единицах).
 */
export type Overlay = { line: string; w: number; dur: number } & (
  | { kind: "mark"; shape: "circle" | "arrow" | "underline"; box: { x: number; y: number; w: number; h: number } }
  | { kind: "chat"; title?: string; messages: { side: "left" | "right"; text: string; name?: string }[] }
  | { kind: "number"; value: number; prefix?: string; suffix?: string; label?: string }
  | { kind: "map"; file: string; size: number; focus: { x: number; y: number; w: number; h: number }; name: string }
  /** Карта с подлётом к месту (MapLibre, runner/pipeline/mapfly.ts): клип во весь экран. */
  | { kind: "mapfly"; file: string; name: string }
);

/**
 * Владелец поднимается снизу по центру по пояс — со слова w реплики line, dur секунд, будто говорит эти слова. file —
 * его картинка в задании, fig — где она на экране, flip — отражена (у позы с пальцем палец смотрел к герою).
 * Старые планы: side "left"/"right" — в углу (справа отражена), arrow — выглядывал сбоку со стрелкой (peek/owner.png).
 */
export type OwnerPeek = {
  line: string;
  w: number;
  dur: number;
  side: "left" | "right" | "center";
  fig: { x: number; y: number; w: number; h: number };
  flip?: boolean;
  file?: string;
  arrow?: { from: [number, number]; to: [number, number]; bend: number };
};
