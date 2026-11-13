export type Vec3 = [number, number, number];

export const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const smooth = (t: number) => {
  const x = clamp(t);
  return x * x * (3 - 2 * x);
};
export const easeInOut = (t: number) => {
  const x = clamp(t);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
};
export const easeOut = (t: number) => 1 - Math.pow(1 - clamp(t), 3);

/** Deterministic 0..1 noise from integers: renders must not depend on Math.random. */
export const hash = (...n: number[]) => {
  let h = 2166136261;
  for (const v of n) {
    h ^= Math.floor(v * 1000) | 0;
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 13;
  h = Math.imul(h, 0x5bd1e995);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967295;
};

/** Smooth value noise in -1..1 for drift and idle motion. */
export const wobble = (t: number, seed: number) => {
  const i = Math.floor(t);
  const f = t - i;
  const a = hash(i, seed) * 2 - 1;
  const b = hash(i + 1, seed) * 2 - 1;
  return lerp(a, b, smooth(f));
};

/** Value of [time, value] keys at time t, linear between keys. */
export const sampleKeys = (keys: readonly (readonly [number, number])[], t: number) => {
  if (!keys.length) return 0;
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    if (t <= keys[i][0]) {
      const [t0, v0] = keys[i - 1];
      const [t1, v1] = keys[i];
      return t1 === t0 ? v1 : lerp(v0, v1, (t - t0) / (t1 - t0));
    }
  }
  return keys[keys.length - 1][1];
};

/** Weight of a timed event: rises over `fade` seconds after `from`, falls before `to`. */
export const window01 = (t: number, from: number, to: number, fade = 0.25) => {
  if (t < from || t > to) return 0;
  const f = Math.min(fade, (to - from) / 2);
  if (f <= 0) return 1;
  return smooth(Math.min((t - from) / f, (to - t) / f));
};

export const addVec = (a: Vec3, b: Vec3, k = 1): Vec3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
