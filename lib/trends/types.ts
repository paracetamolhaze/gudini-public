/**
 * Раздел «Тренды»: залетевшие англоязычные рилсы и Shorts → наши сценарии для 3Д и видеостудии.
 * Метод — ig-viral из instagram-agent-skill: не голые просмотры, а кратность к медиане своего аккаунта.
 *
 * Кто что пишет в data/trends/ (один писатель на файл):
 * - accounts.json и made.json — сайт (список аккаунтов владельца и созданные из карточек проекты);
 * - state.json, cards/<id>/ и browser/ — контейнер gudini-ig-browser (прогоны, карточки, вход в Instagram).
 */

/** global — гиганты всех ниш: формат хита перекладывается в наш 3Д или ролик про ИИ, тема остаётся наша. */
export const THEMES = ["global", "ai_tech", "sketch"] as const;
export type Theme = (typeof THEMES)[number];
export const THEME_LABEL: Record<Theme, string> = { global: "Глобально", ai_tech: "ИИ и технологии", sketch: "Скетчи и юмор" };

/** Наши форматы: сюжет 3Д (скетч) или ролик видеостудии про ИИ и технологии. */
export type IdeaKind = "sketch" | "video";

/** Состав списка по ig-viral: прямые конкуренты, соседняя ниша с той же аудиторией, крупные — только ради формата. */
export const ROLES = ["direct", "adjacent", "outsized"] as const;
export type Role = (typeof ROLES)[number];
export const ROLE_LABEL: Record<Role, string> = { direct: "прямой", adjacent: "соседний", outsized: "крупный" };

export type TrendAccount = {
  id: string;
  theme: Theme;
  role: Role;
  /** ник в Instagram без @ */
  instagram?: string;
  /** ник канала YouTube без @: там же те же авторы часто выкладывают Shorts */
  youtube?: string;
  note?: string;
  /** proposed — стартовый набор ждёт решения владельца; в прогон идут только active */
  status: "proposed" | "active";
  addedAt: string;
};

export type Source = "instagram" | "youtube";
export const SOURCE_LABEL: Record<Source, string> = { instagram: "Instagram", youtube: "YouTube Shorts" };

/** Один ролик в ленте аккаунта. */
export type ReelStat = {
  /** source:код — ключ карточки, повторный прогон не плодит дубли */
  key: string;
  code: string;
  url: string;
  views: number;
  /** закреплённые — старые хиты автора, в медиану и в выдачу не идут */
  pinned?: boolean;
  duration?: number;
  caption?: string;
  postedAt?: string;
};

/** Что прочитано с одного аккаунта на одной площадке за прогон. */
export type AccountRead = {
  accountId: string;
  source: Source;
  handle: string;
  followers: number | null;
  median: number | null;
  reels: ReelStat[];
  at: string;
  error?: string;
};

export type RunState = "running" | "done" | "stopped" | "error";

export type TrendRun = {
  id: string;
  theme: Theme;
  state: RunState;
  step: string;
  /** 0..100 */
  progress: number;
  startedAt: string;
  finishedAt?: string;
  reads: AccountRead[];
  /** ключи карточек этого прогона, сильнейшие первыми */
  cards: string[];
  error?: string;
};

/** Разбор залетевшего ролика: формула, строение, почему сработало. Копируем формулу, а не ролик. */
export type TrendAnalysis = {
  /** номер формулы из HOOKS; null — ни одна не подходит (такие строки читают руками) */
  formulaId: number | null;
  formulaName: string;
  /** сказанная зацепка как есть, по-английски */
  hookSpoken: string;
  /** она же по-русски */
  hookRu: string;
  /** первая надпись на экране */
  hookScreen: string;
  /** ход ролика по секундам */
  structure: string[];
  seconds: number | null;
  /** о чём просят в конце */
  ask: string;
  why: string;
  /** у неразмеченной зацепки — как устроена её форма */
  shape?: string;
  /** что происходит в ролике; у сценки — посылка, шутка и разворот, по которым её переносят к нашим героям */
  story?: string;
  /** sketch — ролик сам сценка с героями и шуткой; video — трюк, челлендж, обзор и прочее. Решает выбор для «Глобально» */
  fit?: IdeaKind;
};

/** Скетч → сюжет 3Д: посылка и один разворот в 2–3 предложения. */
export type SketchIdea = { kind: "sketch"; title: string; plot: string; opening: string; formulaUse: string };

export type HookOption = { formulaId: number; formulaName: string; spoken: string; screen: string };
export type Beat = { from: number; to: number; say: string; screen: string; shot: string };

/** ИИ и технологии → ролик видеостудии: три зацепки разных формул, сценарий, раскадровка. */
export type VideoIdea = {
  kind: "video";
  title: string;
  /** тема проекта видеостудии одной строкой */
  topic: string;
  hooks: HookOption[];
  /** номер зацепки, с которой начинается сценарий */
  chosen: number;
  /** текст, который автор читает вслух; абзацы — паузы телесуфлёра */
  script: string;
  beats: Beat[];
  seconds: number;
  /** чем концовка перекликается с первой фразой */
  loop: string;
};

export type Idea = SketchIdea | VideoIdea;

/**
 * Ритм оригинала, измеренный по файлу (lib/trends/rhythm.ts): склейки и наплывы — по кадрам ffmpeg, темп речи —
 * по словам расшифровки. Секунды. Ритм залетевшего ролика переносится цифрами, а не на глаз.
 */
export type ReelRhythm = {
  duration: number;
  /** моменты смены плана: резкие склейки и наплывы */
  cuts: number[];
  shots: number;
  /** обычная (медианная) длина плана */
  shotMedian: number;
  shotMin: number;
  /** планов, начавшихся в первые 3 секунды */
  shotsFirst3s: number;
  /** null — ролик одним планом */
  firstCut: number | null;
  /** склеек в секунду: в первой и во второй половине ролика */
  cutRate: [number, number];
  /** движение внутри планов: камера и герои */
  motion: "calm" | "medium" | "high";
  /** слов в секунду; нет — речи мало или её не распознали */
  wordsPerSec?: number;
  /** когда звучит первое слово */
  speechStart?: number;
  /** пауз в речи дольше секунды */
  pauses?: number;
};

/** found — выброс найден, но в разбор прогона не вошёл: разбирается кнопкой «Разобрать». */
export type CardState = "found" | "queued" | "working" | "ready" | "error";

export type TrendCard = {
  key: string;
  runId: string;
  theme: Theme;
  source: Source;
  handle: string;
  url: string;
  views: number;
  median: number;
  /** просмотры / медиана своего аккаунта */
  multiple: number;
  followers: number | null;
  caption?: string;
  duration?: number;
  postedAt?: string;
  /** сказанное в первые 3 секунды — зацепка, как её произнесли */
  spokenHook?: string;
  transcript?: string;
  /** текст с кадров по порядку */
  screenText?: string[];
  /** имена кадров в cards/<папка>/ */
  frames: string[];
  /** ритм по файлу; нет — карточка разобрана до замера или ffmpeg не справился */
  rhythm?: ReelRhythm;
  analysis?: TrendAnalysis;
  idea?: Idea;
  state: CardState;
  step?: string;
  error?: string;
  /** у идеи ошибка, а разбор в порядке */
  ideaError?: string;
  at: string;
};

export type BrowserState = { connected: boolean; account?: string; accountLabel?: string };

/** state.json контейнера. */
export type TrendsState = { runs: TrendRun[]; cards: TrendCard[]; browser: BrowserState };

/** made.json сайта: что владелец уже сделал из карточки. */
export type MadeProject = { kind: "3d" | "video"; projectId: string; at: string };
export type MadeIndex = Record<string, MadeProject[]>;

/** Запрос прогона от сайта к контейнеру: аккаунты уже отобраны сайтом. */
export type RunRequest = { theme: Theme; accounts: TrendAccount[] };

/**
 * До 100 аккаунтов за прогон (решение владельца 25.10: «12 мало, рассчитываю на 100–1000»). Больший список
 * читается по очереди: каждый прогон берёт сотню, которую дольше всего не читали. Темп человеческий.
 */
export const MAX_ACCOUNTS_PER_RUN = 100;

/**
 * Какой наш формат пишет Claude по карточке. В 3Д идут только ролики-сценки (разбор ставит fit sketch):
 * трюк или клип даже у автора скетчей становится роликом про ИИ. «ИИ и технологии» — всегда ролик.
 */
export function ideaKindOf(theme: Theme, fit?: IdeaKind): IdeaKind {
  if (theme === "ai_tech") return "video";
  return fit ?? (theme === "sketch" ? "sketch" : "video");
}
/** Порог выброса из ig-viral: ролик в 3 и больше раз выше медианы своего аккаунта. */
export const OUTLIER_MULTIPLE = 3;
