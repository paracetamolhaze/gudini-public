import fs from "fs";
import path from "path";
import type { Carousel, Slide } from "./types";
import { carouselsRoot, writeFileAtomic } from "./store";
import { memeSlideTexts } from "./limits";

export { memeSlideTexts };

/**
 * Вкус автора мемов: шутки, которые он отметил 👍 или 👎 на слайдах. Хранится отдельно от
 * карусель — удалённая карусель не стирает то, чему научился сценарист. Одобренные шутки
 * становятся образцом для новых подборок, отвергнутые — примером «так не надо».
 */

export type TasteEntry = { key: string; value: "up" | "down"; texts: string; category?: string; style?: "lukashenko" | "classic"; at: string };

const tasteFile = () => path.join(carouselsRoot(), "meme-taste.json");

export function readTaste(): TasteEntry[] {
  try {
    const raw = JSON.parse(fs.readFileSync(tasteFile(), "utf8"));
    return Array.isArray(raw?.entries) ? raw.entries.filter((e: any) => e && (e.value === "up" || e.value === "down") && typeof e.texts === "string") : [];
  } catch {
    return [];
  }
}

/** Оценка слайда: запись во вкус автора; value=null снимает оценку этой шутки. */
export function rememberRating(c: Pick<Carousel, "id" | "request">, slide: Slide, value: "up" | "down" | null, at = new Date().toISOString()): void {
  const texts = memeSlideTexts(slide);
  const key = `${c.id}:${slide.id}:${texts}`;
  const entries = readTaste().filter((e) => e.key !== key);
  if (value) entries.push({ key, value, texts, category: c.request.memeCategory, style: c.request.memeStyle ?? "classic", at });
  fs.mkdirSync(carouselsRoot(), { recursive: true });
  writeFileAtomic(tasteFile(), JSON.stringify({ entries: entries.slice(-400) }, null, 2));
}

/** Последние оценки автора для сценариста и редактора: свежие важнее старых. */
export function memeTaste(entries: TasteEntry[] = readTaste(), style?: "lukashenko" | "classic"): { liked: string[]; disliked: string[] } {
  const latest = entries.filter(e => e.category !== "streams" && (!style || e.style === style)).sort((a, b) => b.at.localeCompare(a.at));
  const pick = (value: "up" | "down", n: number) => [...new Set(latest.filter((e) => e.value === value).map((e) => e.texts))].slice(0, n);
  return { liked: pick("up", 20), disliked: pick("down", 12) };
}
