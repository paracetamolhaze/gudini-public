import type { TimedWord } from "./parse";
import type { ReelRhythm } from "./types";

/**
 * Ритм залетевшего ролика числами, как в reelmimic и viral-video-decomposer: где склейки, сколько длится план,
 * как быстро говорят. Цифры переносят темп оригинала в наш вариант точнее, чем «динамичный монтаж» на глаз.
 *
 * Кадры отдаёт ffmpeg (media.ts → readCuts): 15 в секунду, 36×64 RGB. В таком размере шум и мелкое движение
 * сглаживаются, а смена плана остаётся скачком. Пороги подобраны 31.10.2026 на девяти Shorts: говорящие головы
 * с перебивками, сплит-экран (меняется только верхняя половина), скетчи, ролик одним планом с движением камеры
 * и 3D-анимация на наплывах.
 */

export const RHYTHM_FPS = 15;
export const RHYTHM_WIDTH = 36;
export const RHYTHM_HEIGHT = 64;
const FRAME_BYTES = RHYTHM_WIDTH * RHYTHM_HEIGHT * 3;

/**
 * Резкая склейка: средняя разница соседних кадров подскочила на 15 из 255 и больше. Это оценка scene у ffmpeg
 * (порог 0,15), но только на рост: кадр после склейки, где разница падает, второй склейкой не считается.
 * Ниже 0,15 на образцах были рука у камеры и бег в кадре, выше — смена кадра в половине сплит-экрана (0,16–0,22).
 */
const HARD_CUT = 15;
/**
 * Наплыв: кадр за 0,27–1 с сменился на 25 из 255 и больше, а каждый промежуточный — смесь двух крайних
 * (остаток меньше 0,3 от смены). Движение камеры смесью крайних кадров не бывает: у него остаток 0,45 и выше.
 */
const DISSOLVE_CHANGE = 25;
const DISSOLVE_RESIDUAL = 0.3;
const DISSOLVE_WINDOWS = [4, 6, 9, 12, 15];
/** Смены ближе 0,5 с — один переход: затемнение, вспышка, размытие. */
const MERGE_GAP = 0.5;
/** У самых краёв — проявление из чёрного и затухание, а не смена плана. */
const EDGE = 0.3;
/** Обычная разница соседних кадров внутри планов: до 2,5 — кадр спокоен, от 4,5 — всё в движении. */
const MOTION_MEDIUM = 2.5;
const MOTION_HIGH = 4.5;

export type CutScan = { cuts: number[]; duration: number; motion: ReelRhythm["motion"] };

const tenth = (x: number) => Math.round(x * 10) / 10;

function meanDiff(a: Uint8Array, b: Uint8Array): number {
  let sum = 0;
  for (let k = 0; k < a.length; k++) sum += Math.abs(a[k] - b[k]);
  return sum / a.length;
}

function medianOf(values: number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((x, y) => x - y);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Склейки и наплывы по сырым кадрам RGB одного размера; время — в секундах от начала. */
export function findCuts(raw: Uint8Array, fps = RHYTHM_FPS, frameBytes = FRAME_BYTES): CutScan {
  const n = Math.floor(raw.length / frameBytes);
  const frame = (i: number) => raw.subarray(i * frameBytes, (i + 1) * frameBytes);
  const duration = n / fps;
  const diff = new Float64Array(n);
  for (let i = 1; i < n; i++) diff[i] = meanDiff(frame(i), frame(i - 1));
  const hard = Array.from(diff, (d, i) => i > 0 && Math.min(d, d - diff[i - 1]) >= HARD_CUT);
  // hardBefore[i] — сколько резких склеек в кадрах 0..i-1: есть ли склейка внутри окна, видно за одно вычитание
  const hardBefore = [0];
  for (const h of hard) hardBefore.push(hardBefore[hardBefore.length - 1] + (h ? 1 : 0));

  const events: number[] = [];
  hard.forEach((h, i) => h && events.push(i / fps));
  const delta = new Float64Array(frameBytes);
  for (let end = 4; end < n; end++) {
    for (const length of DISSOLVE_WINDOWS) {
      const start = end - length;
      if (start < 0) break;
      if (hardBefore[end + 1] - hardBefore[start + 1] > 0) continue;
      const at = dissolveMiddle(frame, start, end, delta);
      if (at !== null) {
        events.push(at / fps);
        break;
      }
    }
  }

  const cuts: number[] = [];
  for (const t of events.sort((a, b) => a - b)) {
    if (t < EDGE || t > duration - EDGE) continue;
    if (cuts.length && t - cuts[cuts.length - 1] < MERGE_GAP) continue;
    cuts.push(Number(t.toFixed(2)));
  }
  const inside = Array.from(diff).filter((d, i) => i > 0 && !hard[i]);
  const motion = medianOf(inside);
  return { cuts, duration, motion: motion >= MOTION_HIGH ? "high" : motion >= MOTION_MEDIUM ? "medium" : "calm" };
}

/**
 * Кадры start..end — наплыв, если каждый промежуточный ложится на смесь крайних и доля второго кадра растёт
 * плавно. Ответ — номер кадра, где второй план берёт верх; null — не наплыв.
 */
function dissolveMiddle(frame: (i: number) => Uint8Array, start: number, end: number, delta: Float64Array): number | null {
  const a = frame(start), b = frame(end);
  let change = 0, norm = 0;
  for (let k = 0; k < a.length; k++) {
    const x = b[k] - a[k];
    delta[k] = x;
    change += Math.abs(x);
    norm += x * x;
  }
  change /= a.length;
  if (change < DISSOLVE_CHANGE) return null;
  let prev = 0, middle = -1;
  for (let j = start + 1; j <= end; j++) {
    let share = 1;
    if (j < end) {
      const m = frame(j);
      let dot = 0;
      for (let k = 0; k < a.length; k++) dot += (m[k] - a[k]) * delta[k];
      share = dot / norm;
      let residual = 0;
      for (let k = 0; k < a.length; k++) residual += Math.abs(m[k] - a[k] - share * delta[k]);
      if (residual / a.length >= DISSOLVE_RESIDUAL * change) return null;
    }
    // доля второго кадра растёт без откатов и без скачка: скачок — это резкая склейка, её ловит другой счёт
    if (share < prev - 0.1 || share - prev >= 0.5) return null;
    if (middle < 0 && share >= 0.5) middle = j;
    prev = share;
  }
  return middle;
}

/**
 * Цифры ритма по найденным склейкам и словам расшифровки. duration — длина файла по ffprobe: замер кадров
 * обрезан на 5 минутах, и последний план считается до настоящего конца.
 */
export function rhythmOf(scan: CutScan, duration: number, words: TimedWord[] = []): ReelRhythm {
  const total = duration > 0 ? duration : scan.duration;
  const cuts = scan.cuts.filter((t) => t > 0 && t < total);
  const bounds = [0, ...cuts, total];
  const shots = bounds.slice(1).map((b, i) => b - bounds[i]);
  const half = total / 2;
  const rate = (from: number, to: number) => (half > 0 ? Number((cuts.filter((t) => t >= from && t < to).length / half).toFixed(2)) : 0);
  return {
    duration: tenth(total),
    cuts: cuts.map(tenth),
    shots: shots.length,
    shotMedian: tenth(medianOf(shots)),
    shotMin: tenth(Math.min(...shots)),
    shotsFirst3s: 1 + cuts.filter((t) => t < 3).length,
    firstCut: cuts.length ? tenth(cuts[0]) : null,
    cutRate: [rate(0, half), rate(half, total + 1)],
    motion: scan.motion,
    ...speechPace(words),
  };
}

/** Самое короткое, о чём стоит говорить «темп речи»: меньше восьми слов — это реплика, а не речь. */
const MIN_WORDS = 8;
/** Тишина дольше секунды — пауза. Конец слова у автосубтитров YouTube — конец строки, поэтому слово не длиннее 0,6 с. */
const PAUSE = 1;
const WORD_MAX = 0.6;

function speechPace(words: TimedWord[]): Pick<ReelRhythm, "wordsPerSec" | "speechStart" | "pauses"> {
  const timed = words.filter((w) => Number.isFinite(w.start) && w.start >= 0).sort((a, b) => a.start - b.start);
  if (timed.length < MIN_WORDS) return {};
  let talk = 0.4, pauses = 0;
  for (let i = 1; i < timed.length; i++) {
    const prev = timed[i - 1];
    const gap = timed[i].start - prev.start;
    // в темп идёт время речи: пауза добавляет не больше секунды
    talk += Math.min(gap, 1);
    const wordEnd = prev.end > prev.start ? Math.min(prev.end, prev.start + WORD_MAX) : prev.start + 0.4;
    if (timed[i].start - wordEnd >= PAUSE) pauses++;
  }
  return { wordsPerSec: tenth(timed.length / talk), speechStart: tenth(timed[0].start), pauses };
}
