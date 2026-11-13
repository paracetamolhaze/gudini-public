import type { Slide } from "./types";

export type ShareSlide = { url: string; name: string };

/** Имя файла слайда для «Поделиться»: номер по порядку, как в архиве и при скачивании одного слайда. */
export function shareFileName(index: number): string {
  return `slide-${String(index + 1).padStart(2, "0")}.jpg`;
}

/**
 * Слайды для системного меню «Поделиться» на телефоне (кнопка «В Instagram»): строго по порядку карусели,
 * 01→09, имена с номером. Пока хоть один слайд не отрисован или устарел — null: делиться неполной каруселью нельзя.
 */
export function shareSlides(id: string, slides: Pick<Slide, "id" | "render">[], staleSlideIds: string[] = []): ShareSlide[] | null {
  if (!slides.length) return null;
  const stale = new Set(staleSlideIds);
  if (slides.some((s) => !s.render?.file || s.render.error || stale.has(s.id))) return null;
  return slides.map((s, i) => ({ url: `/api/carousel/${id}/image/${s.render!.file}`, name: shareFileName(i) }));
}
