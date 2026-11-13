// Как двигаются вставки (fx.motion). Числа — из разбора motionmaxxing (Apache-2.0: 50 роликов, 3 573 движения по кадрам,
// references/motion.md): приход — 12 кадров и замедляется (60–85% пути за первые 4–6 кадров), уход — 10 кадров и
// ускоряется, вещь прилетает из увеличенного или от края и не растёт из нуля, прозрачность — только помощник на 3–4
// кадра, перелёта нет (в образцах он реже 9% движений). Код свой, под наш движок.

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/** Приход карточки и наклейки: 30 / 59 / 85 / 95% пути на 10 / 25 / 50 / 75% времени. */
export const softLand = (p: number) => 1 - Math.pow(1 - clamp01(p), 3);
/** Приход главной вещи (число, логотип): рывок и мягкий хвост — 54 / 84 / 96 / 98%. */
export const snapSettle = (p: number) => (1 - Math.exp(-7.5 * clamp01(p))) / (1 - Math.exp(-7.5));
/** Спокойный приход помощников (затемнение, маркер): 16 / 39 / 69 / 91%. */
export const glide = (p: number) => 1 - Math.pow(1 - clamp01(p), 1.7);
/** Уход: медленно трогается и разгоняется, наибольшая скорость — в самом конце: 0 / 3 / 16 / 47%. */
export const accelExit = (p: number) => Math.pow(clamp01(p), 2.6);

/** Приход за 12 кадров, уход за 10; прозрачность помогает первые 4 кадра прихода. */
export const IN = 12;
export const OUT = 10;

/**
 * Где вставка на своём пути в кадре f из frames: enter 0→1 — приход (кривую выбирает вставка), leave 0→1 — уход,
 * alpha — прозрачность-помощник на входе (уходит вещь без растворения: оно оставляет призрак), live 0→1 — доля прожитого: по ней вставка, пока стоит, чуть подрастает (на 2%), чтобы
 * кадр под ней не выглядел слайдом. Короткая вставка (после обрезки видеомемом) приходит и уходит быстрее.
 */
export function stage(f: number, frames: number, enterFrames = IN, leaveFrames = OUT) {
  const nIn = Math.max(3, Math.min(enterFrames, Math.floor(frames * 0.45)));
  const nOut = Math.max(3, Math.min(leaveFrames, Math.floor(frames * 0.35)));
  const leave = accelExit((f - (frames - nOut)) / nOut);
  const alpha = Math.min(1, 0.25 + (0.75 * (f + 1)) / Math.min(4, nIn));
  return { p: f / nIn, leave, alpha, live: clamp01(f / Math.max(1, frames)), nIn, nOut };
}
