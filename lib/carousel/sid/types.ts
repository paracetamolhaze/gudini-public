import type { StyleId } from "../styles/catalog";
import type { StyledData } from "../styles/types";
/**
 * Карусели в формате @siddhantt.ai (schema 4): обложка-кинокадр, семь шагов на кремовой клетке
 * с настоящим скриншотом источника и финал «сохрани» с вопросом. Тему, тексты, обложку,
 * скриншоты и 9 слайдов раздел делает сам по кнопке «Создать».
 */

export const SID_ICONS = ["cube", "clock", "gavel", "mail", "pause", "atom", "code", "shield", "flag", "doc", "snow", "chip", "globe", "search", "phone", "chart", "coin", "lock", "link"] as const;
export type SidIcon = (typeof SID_ICONS)[number];

export type SidPill = [label: string, value: string];

export type SidStep = {
  icon: SidIcon;
  /** ярлык над заголовком: «Источник · уточнение» */
  label: string;
  title: string;
  /** 2–3 строки, **жирные** фрагменты */
  body: string;
  pills: [SidPill, SidPill];
  /** «Далее: …» — строчными, коротко */
  next: string;
  /** номер страницы-источника из sources: её скриншот стоит в окне шага */
  source: number;
  /** id фактов исследования, на которых стоит шаг: по ним подбирается другая страница, если окна повторяются */
  facts?: string[];
};

export type SidCover = { pill: string; title: string[]; accentLine: string; hook: string; scene: string };

export type SidFinal = { black: string[]; accent: string[]; cards: [badge: string, title: string, sub: string][]; body: string };

export type SidSource = { url: string; title: string; publisher: string; date?: string };

export type SidContent = {
  topic: string;
  /** короткий ключ темы латиницей: по нему раздел не повторяет истории */
  topicKey: string;
  cover: SidCover;
  steps: SidStep[];
  final: SidFinal;
  caption: string;
  sources: SidSource[];
};

/** Факт из исследования: утверждение, точная цитата и откуда она. */
export type SidFact = { id: string; claim: string; quote: string; url: string; publisher: string; date?: string };

export type SidResearch = {
  topic: string;
  topicKey: string;
  angle: string;
  facts: SidFact[];
  /** страницы для скриншотов: по одной на шаг */
  pages: { step: number; url: string; publisher: string; headline: string }[];
};

/** Окно шага: снимок страницы или, если страница не отдалась, карточка статьи из её заголовка и описания. */
export type SidShot = { kind: "page" | "card"; file: string; dark: boolean; host: string; url: string; note?: string };

export type SidStage = "research" | "write" | "shots" | "verify" | "cover" | "render" | "done";

export type SidData = {
  v: 1;
  accent: string;
  coverAccent: string;
  palette: number;
  stage: SidStage;
  content?: SidContent;
  shots?: (SidShot | null)[];
  verified?: boolean;
  /** что поправила проверка фактов */
  verifyNotes?: string[];
  coverFile?: string;
  /** источники для страницы карусели; у созданных разделом они в content.sources */
  sources?: SidSource[];
  /** ролик ранних каруселей (до 28.10): файл остаётся в папке, сайт его не показывает */
  video?: { file: string; bytes: number; seconds: number };
  /** готовая карусель, перенесённая в раздел из ручной сборки */
  imported?: boolean;
  /** стиль кнопки «Создать» (01.11); без него — «Расследование», прежний формат */
  style?: StyleId;
  /** данные шести новых стилей (lib/carousel/styles) */
  styled?: StyledData;
};
