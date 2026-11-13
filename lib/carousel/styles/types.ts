import type { SidFact, SidSource } from "../sid/types";
import type { StyleId } from "./catalog";

/**
 * Содержимое шести новых стилей. В текстах слайдов цвет ставит разметка: [r]красное[/r], [g]зелёное[/g],
 * [b]синее[/b], [y]жёлтое[/y]; **жирное** — в абзацах «Разбора». Сцены картинок (scene) пишутся по-английски.
 */

export type Card = { icon: string; title: string; text: string };

export type UrgentContent = {
  topic: string; topicKey: string;
  slides: { text: string; sub: string; scene: string }[];
  caption: string; sources: SidSource[];
};

export type ToolkitContent = {
  topic: string; topicKey: string;
  cover: { l1: string; l2: string; l3: string; sub: string; scene: string };
  story: { head: [string, string]; url: string; cards: Card[]; punch: string };
  items: { name: string; url: string; head: [string, string]; cards: Card[]; punch: string }[];
  checklist: { head: [string, string]; cards: Card[]; punch: string };
  caption: string; sources: SidSource[];
};

export type MarketContent = {
  topic: string; topicKey: string;
  cover: { title: string; rows: [string, string, string][]; cta: string; scene: string };
  slides: { text: string; scene: string }[];
  caption: string; sources: SidSource[];
};

export type CartoonContent = {
  topic: string; topicKey: string;
  slides: { big?: string; text: string; scene: string }[];
  caption: string; sources: SidSource[];
};

export type HeatPeriod = "24h" | "7d" | "30d";
export type CinemaContent = {
  topic: string; topicKey: string;
  cover: { lines: string[]; scene: string };
  heatmap: { title: string; period: HeatPeriod; subtitle: string };
  caption: string; sources: SidSource[];
};

/**
 * Слайд-схема «Разбора» (по методу Anatomy): идею объясняет придуманный предмет, чья работа и есть эта идея.
 * object — название предмета по-русски, scene — он же по-английски для художника, parts — 3–4 части по порядку:
 * [что это в крипте, что делает эта часть предмета]. Номер части на рисунке = номер строки под рисунком;
 * слова на слайд ставит вёрстка, художник рисует только цифры в кружках.
 */
export type SchemeContent = { head: string; lead: string; object: string; scene: string; parts: [string, string][] };

export type DisputeContent = {
  topic: string; topicKey: string;
  cover: { head: string; sub: string; scene: string };
  posts: { head: string; paras: string[]; tweetId: string }[];
  /** «как это устроено» между постами и итогом; у старых каруселей и там, где устройство ни при чём, его нет */
  scheme?: SchemeContent;
  final: { head: string; intro: string; facts: [string, string][] };
  caption: string; sources: SidSource[];
};

export type StyledContent = UrgentContent | ToolkitContent | MarketContent | CartoonContent | CinemaContent | DisputeContent;

export type StyledResearch = {
  topic: string; topicKey: string; angle: string;
  facts: SidFact[];
  pages: { url: string; publisher: string; headline: string }[];
  /** то, что нужно стилю сверх фактов: сервисы «Подборки», посты «Разбора» */
  extra?: Record<string, unknown>;
};

export type HeatTile = { sym: string; name: string; pct: number; cap: number };

export type StyledData = {
  style: Exclude<StyleId, "investigation">;
  stage: "research" | "write" | "verify" | "media" | "render" | "done";
  research?: StyledResearch;
  content?: StyledContent;
  verified?: boolean;
  verifyNotes?: string[];
  /** готовые картинки и скриншоты: слот → файл в папке sid/ */
  media?: Record<string, string>;
  /** тепловая карта «Кино», снятая один раз */
  heat?: HeatTile[];
  notes?: string[];
};
