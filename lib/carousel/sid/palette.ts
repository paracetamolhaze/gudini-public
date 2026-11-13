/**
 * Акцентный цвет у каждой карусели свой и идёт по кругу. accent — для кремовых слайдов (цифры, черта,
 * ярлыки), cover — светлее, для акцентной строки на тёмной обложке. Первые четыре — у одобренных
 * владельцем каруселей 1–4, в том же порядке.
 */
export const SID_PALETTE = [
  { name: "терракота", accent: "#D9734F", cover: "#F2A27E" },
  { name: "бирюза", accent: "#1F9E89", cover: "#3EDBA8" },
  { name: "синий", accent: "#4B5FD6", cover: "#8EA2FF" },
  { name: "золото", accent: "#B98110", cover: "#F4C542" },
  { name: "малина", accent: "#C2387A", cover: "#FF8CC6" },
  { name: "зелёный", accent: "#3F8A3A", cover: "#8EDB7A" },
  { name: "фиолетовый", accent: "#7B4FD0", cover: "#B9A0FF" },
] as const;

/** Следующий цвет после последнего использованного; recent — индексы от новой карусели к старой. */
export function nextPaletteIndex(recent: number[]): number {
  const last = recent.find((i) => Number.isInteger(i) && i >= 0 && i < SID_PALETTE.length);
  return last === undefined ? 0 : (last + 1) % SID_PALETTE.length;
}
