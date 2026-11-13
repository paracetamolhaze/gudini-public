/**
 * A near-whisper delivery of a cloned voice that keeps its timbre and every sample of its timing.
 *
 * Port of out/voices/asmr/dsp/whisperize.py, the method that ranked first on 2026-10-21 against speech-to-speech
 * from a real ASMR whisper and against synthesis settings alone: STS drifted off the owner's timbre and needs one
 * paid call per line plus re-timing; the clone cannot be talked below ~0.66 voiced by tags and settings. Here the
 * voice is analysed frame by frame with LPC; the excitation of every frame is swapped for noise of the same energy
 * and pushed through the same (slightly widened) filter — a whisper with his formants and his exact length. It is
 * blended with the dry voice per time and frequency (low harmonics stay his, the top turns to breath), then given a
 * close-mic colour. Takes differ, so the breath brightness and the whisper share are steered on every span until
 * the span lands on the level's voiced share and tilt — the voiced share first where both cannot be had.
 *
 * Pure TypeScript (no numpy in the container); the numeric helpers mirror the scipy calls of the original so the
 * port was checked sample by sample against it with the same noise. The work is stepped (generators) so a caller
 * in the container can keep its event loop alive while it runs.
 */

export const SR = 44100;

export type WhisperLevel = "light" | "medium" | "strong";

export type WhisperParams = {
  /** targets in the voice-style terms of scripts/voice-style.py: share of voiced frames, 4–8 kHz against 0.3–2 kHz */
  voiced: number;
  tilt: number;
  /** whisper share (power) on the loudest syllables; soft adds more on frames softStart..softStart+softSpan dB below them */
  amount: number;
  soft: number;
  softStart: number;
  softSpan: number;
  /** × amount below 300 Hz on loud syllables (the pitch he keeps), extra share above 2 kHz (breath on top) */
  lo: number;
  hi: number;
  /** flat noise source instead of a glottal one on vowels (0..0.97) */
  flat: number;
  /** high shelf on the whisper's vowels (dB at brightF Hz) and its cut back above 6.5 kHz */
  bright: number;
  brightF: number;
  topCut: number;
  /** close-mic colour: chest band cut at 700 Hz, dry voice's 3 kHz shelf cut, proximity warmth at 180 Hz, air at 9 kHz */
  thin: number;
  dryCut: number;
  warm: number;
  air: number;
  /** breath pulsed by the voice's own glottal envelope, 0..1: it fuses with the voice instead of sitting on top */
  pulse: number;
  gamma: number;
  lagwin: number;
  deessThr: number;
  deessMax: number;
  compThr: number;
  compRatio: number;
  /**
   * At most this many dB the peak limiter may take off the body of a span brought to the dry voice's loudness (see
   * bodyPeakDb: the two loudest 5 ms bursts, a whispered «т» or «к», are limited regardless). A whisper has ~20 dB of
   * crest against ~13 dB of plain speech (Whisper Soul itself sits ~20 dB under its peaks), so at the dry loudness its
   * peaks would land ~7 dB over the ceiling and a limiter would flatten the breath; the rest of the gap is left as a
   * quieter span, which is also closer to the other whispering voice. 0 since the body-peak rule: it keeps the owner's
   * lines where the old rule (1.5 dB on the single loudest peak) put them on average, without one burst taking a
   * whole line 4–5 dB down.
   */
  limitDb: number;
};

const COMMON = { brightF: 1200, flat: 0.97, warm: 4, air: 1.5, pulse: 0.35, gamma: 0.993, lagwin: 100, deessThr: -3, deessMax: 8, compThr: -10, compRatio: 2, limitDb: 0 };
export const WHISPER_LEVELS: Record<WhisperLevel, WhisperParams> = {
  light: { ...COMMON, voiced: 0.58, tilt: -15.5, amount: 0.12, soft: 0.7, softStart: 5, softSpan: 12, lo: 0.35, hi: 0.7, bright: 15, topCut: 7, thin: 2, dryCut: 3 },
  medium: { ...COMMON, voiced: 0.47, tilt: -14, amount: 0.22, soft: 0.85, softStart: 4, softSpan: 10, lo: 0.3, hi: 0.8, bright: 16, topCut: 8, thin: 3, dryCut: 4 },
  strong: { ...COMMON, voiced: 0.38, tilt: -12.5, amount: 0.3, soft: 0.9, softStart: 4, softSpan: 10, lo: 0.3, hi: 0.85, bright: 17, topCut: 8, thin: 4, dryCut: 5 },
};

/** cast.json "delivery": a level, any knob of it overridden by number. */
export type WhisperRecipe = { kind: "whisper"; level?: WhisperLevel; seed?: number } & Partial<WhisperParams>;

/**
 * What each knob may be set to in cast.json: the span the method was tried over, with room around it. Outside it the
 * result is no longer a near-whisper of his voice (voiced 0.95 is the dry take, gamma 0.8 smears the formants, an
 * unstable filter or a +30 dB shelf is noise), and a run would pay for a take only to deliver that.
 */
export const WHISPER_RANGES: Record<keyof WhisperParams | "seed", readonly [number, number]> = {
  voiced: [0.2, 0.9],
  tilt: [-25, -5],
  amount: [0, 0.9],
  soft: [0, 1],
  softStart: [0, 20],
  softSpan: [1, 30],
  lo: [0, 1],
  hi: [0, 1],
  flat: [0, 0.97],
  bright: [6, 24],
  brightF: [300, 6000],
  topCut: [0, 12],
  thin: [-12, 12],
  dryCut: [-12, 12],
  warm: [-12, 12],
  air: [-12, 12],
  pulse: [0, 1],
  gamma: [0.95, 1],
  lagwin: [0, 300],
  deessThr: [-12, 12],
  deessMax: [0, 12],
  compThr: [-30, 0],
  compRatio: [1, 8],
  limitDb: [0, 6],
  seed: [0, 2 ** 31 - 1],
};

/** The full parameter set of a recipe; a typo or an out-of-range number in cast.json stops the run before a paid take. */
export const resolveWhisper = (recipe: WhisperRecipe, who = "?"): WhisperParams & { seed: number } => {
  if (recipe.kind !== "whisper") throw new Error(`У персонажа ${who} неизвестная подача голоса «${String(recipe.kind)}» (cast.json, delivery.kind)`);
  const level = recipe.level ?? "medium";
  const base = Object.hasOwn(WHISPER_LEVELS, level) ? WHISPER_LEVELS[level] : undefined;
  if (!base) throw new Error(`У персонажа ${who} неизвестный уровень шёпота «${level}» (cast.json, delivery.level): есть light, medium, strong`);
  const out: WhisperParams & { seed: number } = { ...base, seed: 1 };
  for (const [k, v] of Object.entries(recipe)) {
    if (k === "kind" || k === "level") continue;
    if (!Object.hasOwn(WHISPER_RANGES, k) || typeof v !== "number" || !Number.isFinite(v)) throw new Error(`У персонажа ${who} непонятная настройка подачи «${k}» (cast.json, delivery)`);
    const [lo, hi] = WHISPER_RANGES[k as keyof typeof WHISPER_RANGES];
    if (v < lo || v > hi) throw new Error(`У персонажа ${who} настройка подачи «${k}» = ${v} вне допустимого: от ${lo} до ${hi} (cast.json, delivery)`);
    if (k === "seed" && !Number.isInteger(v)) throw new Error(`У персонажа ${who} настройка подачи «seed» должна быть целым числом, а не ${v} (cast.json, delivery)`);
    (out as Record<string, number>)[k] = v;
  }
  return out;
};

// ---------------------------------------------------------------- numeric helpers (scipy / numpy equivalents)

type Vec = Float64Array;

/** scipy.signal.lfilter with zero initial state, transposed direct form II. */
export function lfilter(b: ArrayLike<number>, a: ArrayLike<number>, x: Vec): Vec {
  const n = Math.max(b.length, a.length);
  const B = new Float64Array(n);
  const A = new Float64Array(n);
  for (let i = 0; i < b.length; i++) B[i] = b[i] / a[0];
  for (let i = 0; i < a.length; i++) A[i] = a[i] / a[0];
  const y = new Float64Array(x.length);
  if (n === 1) {
    for (let i = 0; i < x.length; i++) y[i] = B[0] * x[i];
    return y;
  }
  if (n === 3) {
    // biquads are most of the calls: the same recursion unrolled
    let z0 = 0;
    let z1 = 0;
    const [b0, b1, b2] = B;
    const [, a1, a2] = A;
    for (let i = 0; i < x.length; i++) {
      const xi = x[i];
      const yi = b0 * xi + z0;
      z0 = b1 * xi + z1 - a1 * yi;
      z1 = b2 * xi - a2 * yi;
      y[i] = yi;
    }
    return y;
  }
  const z = new Float64Array(n);
  for (let i = 0; i < x.length; i++) {
    const xi = x[i];
    const yi = B[0] * xi + z[0];
    for (let k = 1; k < n - 1; k++) z[k - 1] = B[k] * xi + z[k] - A[k] * yi;
    z[n - 2] = B[n - 1] * xi - A[n - 1] * yi;
    y[i] = yi;
  }
  return y;
}

type Kind = "hp" | "lowshelf" | "highshelf";

/** RBJ cookbook biquad, normalised. */
const biquad = (kind: Kind, f0: number, gainDb: number, q: number): [number[], number[]] => {
  const A = 10 ** (gainDb / 40);
  const w0 = (2 * Math.PI * f0) / SR;
  const cw = Math.cos(w0);
  const sw = Math.sin(w0);
  const al = sw / (2 * q);
  const sA = Math.sqrt(A);
  let b: number[];
  let a: number[];
  if (kind === "hp") {
    b = [(1 + cw) / 2, -(1 + cw), (1 + cw) / 2];
    a = [1 + al, -2 * cw, 1 - al];
  } else if (kind === "lowshelf") {
    b = [A * (A + 1 - (A - 1) * cw + 2 * sA * al), 2 * A * (A - 1 - (A + 1) * cw), A * (A + 1 - (A - 1) * cw - 2 * sA * al)];
    a = [A + 1 + (A - 1) * cw + 2 * sA * al, -2 * (A - 1 + (A + 1) * cw), A + 1 + (A - 1) * cw - 2 * sA * al];
  } else {
    b = [A * (A + 1 + (A - 1) * cw + 2 * sA * al), -2 * A * (A - 1 + (A + 1) * cw), A * (A + 1 + (A - 1) * cw - 2 * sA * al)];
    a = [A + 1 - (A - 1) * cw + 2 * sA * al, 2 * (A - 1 - (A + 1) * cw), A + 1 - (A - 1) * cw - 2 * sA * al];
  }
  return [b.map((v) => v / a[0]), a.map((v) => v / a[0])];
};

/** the original passes q 0.7071, not 1/sqrt(2): kept, so the port matches it sample for sample */
const Q = 0.7071;

export const filt = (x: Vec, kind: Kind, f0: number, gainDb = 0, q = Q): Vec => {
  if (kind !== "hp" && Math.abs(gainDb) < 1e-6) return x;
  const [b, a] = biquad(kind, f0, gainDb, q);
  return lfilter(b, a, x);
};

/** scipy.ndimage reflect mode: d c b a | a b c d | d c b a */
const reflect = (i: number, n: number) => {
  const p = 2 * n;
  const k = ((i % p) + p) % p;
  return k < n ? k : p - 1 - k;
};

/** scipy.ndimage.uniform_filter1d, mode reflect: the window of i is [i - size/2, i + size - size/2 - 1]. */
export function uniformFilter(x: Vec, size: number): Vec {
  const n = x.length;
  const out = new Float64Array(n);
  if (!n) return out;
  const s1 = Math.floor(size / 2);
  let tmp = 0;
  for (let k = 0; k < size; k++) tmp += x[reflect(k - s1, n)];
  out[0] = tmp / size;
  for (let i = 1; i < n; i++) {
    tmp += x[reflect(i - s1 + size - 1, n)] - x[reflect(i - s1 - 1, n)];
    out[i] = tmp / size;
  }
  return out;
}

/** scipy.ndimage.maximum_filter1d, mode reflect (monotonic deque over the reflected line). */
export function maximumFilter(x: Vec, size: number): Vec {
  const n = x.length;
  const out = new Float64Array(n);
  if (!n) return out;
  const s1 = Math.floor(size / 2);
  const ext = new Float64Array(n + size - 1);
  for (let j = 0; j < ext.length; j++) ext[j] = x[reflect(j - s1, n)];
  const dq = new Int32Array(ext.length);
  let head = 0;
  let tail = 0;
  for (let j = 0; j < ext.length; j++) {
    while (tail > head && ext[dq[tail - 1]] <= ext[j]) tail--;
    dq[tail++] = j;
    const i = j - size + 1;
    if (i >= 0) {
      while (dq[head] < i) head++;
      out[i] = ext[dq[head]];
    }
  }
  return out;
}

const minimumFilter = (x: Vec, size: number) => maximumFilter(x.map((v) => -v), size).map((v) => -v);

/** numpy.percentile, linear interpolation. */
const percentile = (values: ArrayLike<number>, q: number) => {
  const s = Float64Array.from(values).sort();
  if (!s.length) return 0;
  const pos = (q / 100) * (s.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.min(s.length - 1, lo + 1);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
};

/** numpy.interp of evenly spaced points xp = i·step (step > 0) at every integer 0..n-1. */
const interpGrid = (fp: ArrayLike<number>, step: number, n: number): Vec => {
  const out = new Float64Array(n);
  const last = fp.length - 1;
  for (let i = 0; i < n; i++) {
    const p = i / step;
    if (p <= 0) out[i] = fp[0];
    else if (p >= last) out[i] = fp[last];
    else {
      const k = Math.floor(p);
      out[i] = fp[k] + (fp[k + 1] - fp[k]) * (p - k);
    }
  }
  return out;
};

const clip = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const log10 = Math.log10;
const sumSq = (x: ArrayLike<number>, from = 0, to = x.length) => {
  let s = 0;
  for (let i = from; i < to; i++) s += x[i] * x[i];
  return s;
};

// ---------------------------------------------------------------- FFT, STFT (scipy.signal.stft / istft conventions)

const fftTables = new Map<number, { cos: Vec; sin: Vec; rev: Uint32Array }>();
const tablesOf = (n: number) => {
  let t = fftTables.get(n);
  if (!t) {
    const bits = Math.round(Math.log2(n));
    const rev = new Uint32Array(n);
    for (let i = 0; i < n; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
      rev[i] = r;
    }
    const cos = new Float64Array(n / 2);
    const sin = new Float64Array(n / 2);
    for (let i = 0; i < n / 2; i++) {
      cos[i] = Math.cos((2 * Math.PI * i) / n);
      sin[i] = Math.sin((2 * Math.PI * i) / n);
    }
    t = { cos, sin, rev };
    fftTables.set(n, t);
  }
  return t;
};

/** In-place radix-2 FFT (forward: e^-i), n a power of two; inverse without the 1/n. */
function fft(re: Vec, im: Vec, inverse = false) {
  const n = re.length;
  const { cos, sin, rev } = tablesOf(n);
  for (let i = 0; i < n; i++) {
    const j = rev[i];
    if (j > i) {
      let t = re[i];
      re[i] = re[j];
      re[j] = t;
      t = im[i];
      im[i] = im[j];
      im[j] = t;
    }
  }
  const sign = inverse ? 1 : -1;
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1;
    const step = n / size;
    // one twiddle per k, applied to every block of the stage
    for (let k = 0; k < half; k++) {
      const wr = cos[k * step];
      const wi = sign * sin[k * step];
      for (let a = k; a < n; a += size) {
        const b = a + half;
        const xr = re[b] * wr - im[b] * wi;
        const xi = re[b] * wi + im[b] * wr;
        re[b] = re[a] - xr;
        im[b] = im[a] - xi;
        re[a] += xr;
        im[a] += xi;
      }
    }
  }
}

const NSEG = 1024;
const NSTEP = 256;
const NBIN = NSEG / 2 + 1;
const HANN_P = Float64Array.from({ length: NSEG }, (_, k) => 0.5 - 0.5 * Math.cos((2 * Math.PI * k) / NSEG));
const HANN_SUM = HANN_P.reduce((a, b) => a + b, 0);
const FREQS = Float64Array.from({ length: NBIN }, (_, k) => (k * SR) / NSEG);

type Spec = { re: Vec; im: Vec; frames: number; length: number };

/** scipy.signal.stft(x, SR, "hann", 1024, 768): zero boundary, padded, scaled by 1/sum(window); frame j centred at sample 256·j. */
function stft(x: Vec): Spec {
  const half = NSEG / 2;
  const len = x.length + 2 * half;
  const nadd = (((-(len - NSEG)) % NSTEP) + NSTEP) % NSTEP;
  const xp = new Float64Array(len + nadd);
  xp.set(x, half);
  const frames = (xp.length - NSEG) / NSTEP + 1;
  const re = new Float64Array(frames * NBIN);
  const im = new Float64Array(frames * NBIN);
  const fr = new Float64Array(NSEG);
  const fi = new Float64Array(NSEG);
  // two real frames per complex FFT (frame j in the real part, j + 1 in the imaginary), split by symmetry
  for (let j = 0; j < frames; j += 2) {
    const pair = j + 1 < frames;
    for (let k = 0; k < NSEG; k++) {
      fr[k] = xp[j * NSTEP + k] * HANN_P[k];
      fi[k] = pair ? xp[(j + 1) * NSTEP + k] * HANN_P[k] : 0;
    }
    fft(fr, fi);
    for (let k = 0; k < NBIN; k++) {
      const m = (NSEG - k) % NSEG;
      const zr = fr[k];
      const zi = fi[k];
      const wr = fr[m];
      const wi = fi[m];
      re[j * NBIN + k] = (zr + wr) / 2 / HANN_SUM;
      im[j * NBIN + k] = (zi - wi) / 2 / HANN_SUM;
      if (pair) {
        re[(j + 1) * NBIN + k] = (zi + wi) / 2 / HANN_SUM;
        im[(j + 1) * NBIN + k] = (wr - zr) / 2 / HANN_SUM;
      }
    }
  }
  return { re, im, frames, length: x.length };
}

/** scipy.signal.istft of the spec above (window-power normalised overlap-add), cut or zero-padded to the input length. */
function istft(s: Spec): Vec {
  const total = NSEG + (s.frames - 1) * NSTEP;
  const acc = new Float64Array(total);
  const norm = new Float64Array(total);
  const fr = new Float64Array(NSEG);
  const fi = new Float64Array(NSEG);
  // two frames per inverse FFT: X + iY of two real signals comes back as x + iy
  for (let j = 0; j < s.frames; j += 2) {
    const pair = j + 1 < s.frames;
    for (let k = 0; k < NBIN; k++) {
      // irfft ignores the imaginary part of the DC and Nyquist bins
      const edge = k === 0 || k === NSEG / 2;
      const xr = s.re[j * NBIN + k];
      const xi = edge ? 0 : s.im[j * NBIN + k];
      const yr = pair ? s.re[(j + 1) * NBIN + k] : 0;
      const yi = pair && !edge ? s.im[(j + 1) * NBIN + k] : 0;
      fr[k] = xr - yi;
      fi[k] = xi + yr;
      if (!edge) {
        fr[NSEG - k] = xr + yi;
        fi[NSEG - k] = yr - xi;
      }
    }
    fft(fr, fi, true);
    for (let k = 0; k < NSEG; k++) {
      const w = HANN_P[k];
      acc[j * NSTEP + k] += (fr[k] / NSEG) * HANN_SUM * w;
      norm[j * NSTEP + k] += w * w;
      if (pair) {
        acc[(j + 1) * NSTEP + k] += (fi[k] / NSEG) * HANN_SUM * w;
        norm[(j + 1) * NSTEP + k] += w * w;
      }
    }
  }
  const half = NSEG / 2;
  const out = new Float64Array(s.length);
  for (let i = 0; i < s.length && i + half < total - half; i++) {
    const nv = norm[i + half];
    out[i] = acc[i + half] / (nv > 1e-10 ? nv : 1);
  }
  return out;
}

// ---------------------------------------------------------------- resampling (scipy.signal.resample_poly, Kaiser 5)

const besselI0 = (x: number) => {
  let sum = 1;
  let term = 1;
  for (let k = 1; k < 60; k++) {
    term *= (x / (2 * k)) ** 2;
    sum += term;
    if (term < 1e-17 * sum) break;
  }
  return sum;
};

const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
const resampleFilters = new Map<string, Vec>();

export function resamplePoly(x: Vec, upIn: number, downIn: number): Vec {
  const g = gcd(upIn, downIn);
  const up = upIn / g;
  const down = downIn / g;
  const nIn = x.length;
  const nOut = Math.ceil((nIn * up) / down);
  const maxRate = Math.max(up, down);
  const halfLen = 10 * maxRate;
  let h = resampleFilters.get(`${up}/${down}`);
  if (!h) {
    // firwin(2·halfLen+1, 1/maxRate, kaiser 5) normalised to unit DC gain, × up
    const taps = 2 * halfLen + 1;
    const fc = 1 / maxRate;
    const alpha = (taps - 1) / 2;
    const raw = new Float64Array(taps);
    const i0b = besselI0(5);
    let sum = 0;
    for (let i = 0; i < taps; i++) {
      const m = i - alpha;
      const arg = Math.PI * fc * m;
      const sinc = m === 0 ? 1 : Math.sin(arg) / arg;
      const r = (2 * i) / (taps - 1) - 1;
      const win = besselI0(5 * Math.sqrt(Math.max(0, 1 - r * r))) / i0b;
      raw[i] = fc * sinc * win;
      sum += raw[i];
    }
    const prePad = down - (halfLen % down);
    h = new Float64Array(prePad + taps);
    for (let i = 0; i < taps; i++) h[prePad + i] = (raw[i] / sum) * up;
    resampleFilters.set(`${up}/${down}`, h);
  }
  const preRemove = Math.floor((halfLen + (down - (halfLen % down))) / down);
  const y = new Float64Array(nOut);
  for (let o = 0; o < nOut; o++) {
    const t = (o + preRemove) * down; // index in the upsampled stream
    let acc = 0;
    // taps j with (t - j) divisible by up and 0 <= (t - j)/up < nIn
    let j = t % up;
    let src = (t - j) / up;
    if (src >= nIn) {
      const skip = src - (nIn - 1);
      j += skip * up;
      src = nIn - 1;
    }
    for (; j < h.length && src >= 0; j += up, src--) acc += h[j] * x[src];
    y[o] = acc;
  }
  return y;
}

// ---------------------------------------------------------------- loudness (BS.1770-4 style, mono)

export function lufs(x: Vec): number {
  let y = filt(x, "highshelf", 1500, 4, Q);
  y = filt(y, "hp", 38, 0, 0.5);
  const blk = Math.trunc(0.4 * SR);
  const step = Math.trunc(0.1 * SR);
  let z: number[];
  if (y.length < blk) z = [y.length ? sumSq(y) / y.length : 0];
  else {
    z = [];
    for (let i = 0; i + blk <= y.length; i += step) z.push(sumSq(y, i, i + blk) / blk);
  }
  z = z.filter((v) => -0.691 + 10 * log10(v + 1e-20) > -70);
  if (!z.length) return -70;
  const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
  const rel = -0.691 + 10 * log10(mean(z)) - 10;
  const z2 = z.filter((v) => -0.691 + 10 * log10(v) > rel);
  return -0.691 + 10 * log10(mean(z2.length ? z2 : z));
}

export function truePeakDb(x: Vec): number {
  const up = resamplePoly(x, 4, 1);
  let m = 0;
  for (let i = 0; i < up.length; i++) m = Math.max(m, Math.abs(up[i]));
  return 20 * log10(m + 1e-12);
}

// ---------------------------------------------------------------- the whisper layer (LPC, noise excitation)

/** Standard normal numbers from a seed (mulberry32 + Box–Muller): the same take always gets the same breath. */
export const gaussian = (seed: number) => {
  let s = (Math.imul(seed | 0, 0x9e3779b9) ^ 0x5bd1e995) >>> 0;
  const uniform = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  let spare = NaN;
  return (n: number): Vec => {
    const out = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      if (!Number.isNaN(spare)) {
        out[i] = spare;
        spare = NaN;
        continue;
      }
      const r = Math.sqrt(-2 * Math.log(1 - uniform()));
      const a = 2 * Math.PI * uniform();
      out[i] = r * Math.cos(a);
      spare = r * Math.sin(a);
    }
    return out;
  };
};

/** Levinson–Durbin: the predictor A(z) = 1 + Σ a_k z^-k of an autocorrelation r[0..order]. */
const levinson = (r: Vec, order: number): Vec => {
  const a = new Float64Array(order + 1);
  const tmp = new Float64Array(order + 1);
  a[0] = 1;
  let err = r[0];
  for (let i = 1; i <= order; i++) {
    let acc = r[i];
    for (let j = 1; j < i; j++) acc += a[j] * r[i - j];
    const k = -acc / err;
    tmp.set(a);
    for (let j = 1; j < i; j++) a[j] = tmp[j] + k * tmp[i - j];
    a[i] = k;
    err *= 1 - k * k;
    if (err <= 0) break;
  }
  return a;
};

// ---------------------------------------------------------------- stepped work: the event loop gets a turn between steps

/**
 * The delivery is seconds of pure arithmetic per span. Written as generators that yield between steps (each well
 * under half a second), it can run at once (runSteps: tests, scripts) or hand the event loop back after every step
 * (runStepsAsync: the container's heartbeats, SIGTERM and the job's abort keep working meanwhile).
 */
export type Steps<T> = Generator<void, T, void>;

export const runSteps = <T>(steps: Steps<T>): T => {
  for (;;) {
    const r = steps.next();
    if (r.done) return r.value;
  }
};

export async function runStepsAsync<T>(steps: Steps<T>, signal?: AbortSignal): Promise<T> {
  try {
    for (;;) {
      signal?.throwIfAborted();
      const r = steps.next();
      if (r.done) return r.value;
      // setImmediate, not a resolved promise: timers and I/O callbacks run before the next step
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  } finally {
    steps.return(undefined as never);
  }
}

/** LPC frames analysed and resynthesised between two yields (~50 ms of work). */
const LPC_FRAMES_PER_STEP = 96;

/** Same length as x: the LPC envelope of x on every 27 ms frame, excited by noise of the frame's residual energy. */
export const whisperLayer = (x: Vec, gamma: number, pulse: number, normal: (n: number) => Vec, lagwin: number, pre = 0.97): Vec =>
  runSteps(whisperLayerSteps(x, gamma, pulse, normal, lagwin, pre));

function* whisperLayerSteps(x: Vec, gamma: number, pulse: number, normal: (n: number) => Vec, lagwin: number, pre = 0.97): Steps<Vec> {
  const order = Math.trunc(SR / 1000) + 4;
  const N = 1200;
  const hop = 300;
  const w = Float64Array.from({ length: N }, (_, k) => 0.5 - 0.5 * Math.cos((2 * Math.PI * k) / N)); // periodic Hann: Σw² = 1.5·hop-normalised at hop N/4
  const w2 = sumSq(w);
  const lag = Float64Array.from({ length: order + 1 }, (_, k) => Math.exp(-0.5 * ((2 * Math.PI * lagwin * k) / SR) ** 2)); // smooths the envelope over harmonics
  const widen = Float64Array.from({ length: order + 1 }, (_, k) => gamma ** k); // formants a little wider: breath, not a ringing voice

  const xp = lfilter([1, -pre], [1], x);
  const pad = N;
  const xpp = new Float64Array(x.length + 2 * pad);
  xpp.set(xp, pad);
  const L = xpp.length;
  const E = new Float64Array(L);
  const frames: { t: number; a: Vec; g: number }[] = [];
  const sw = new Float64Array(N);
  const r = new Float64Array(order + 1);
  for (let t = 0, f = 1; t + N <= L; t += hop, f++) {
    if (f % LPC_FRAMES_PER_STEP === 0) yield;
    for (let i = 0; i < N; i++) sw[i] = xpp[t + i] * w[i];
    for (let k = 0; k <= order; k++) {
      let s = 0;
      for (let i = 0; i < N - k; i++) s += sw[i] * sw[i + k];
      r[k] = s;
    }
    if (r[0] < 1e-10) continue;
    for (let k = 0; k <= order; k++) r[k] *= lag[k];
    r[0] *= 1 + 1e-4; // a -40 dB white floor keeps the filter tame
    const a = levinson(r, order);
    const from = Math.max(0, t - order);
    let ew = 0;
    for (let i = 0; i < N; i++) {
      let e = 0;
      for (let k = 0; k <= order; k++) {
        const idx = t + i - k;
        if (idx >= from) e += a[k] * xpp[idx];
      }
      E[t + i] += e * w[i];
      ew += w[i] * w[i] * e * e;
    }
    frames.push({ t, a, g: Math.sqrt(ew / w2) });
  }
  for (let i = 0; i < L; i++) E[i] /= 2;

  // glottal-pulse envelope of the residual, mean 1 over ~20 ms: breath that comes in bursts with the voice
  const env = uniformFilter(E.map(Math.abs), Math.max(3, Math.trunc(0.0007 * SR)));
  const envSlow = uniformFilter(env, Math.trunc(0.02 * SR));
  const mod = env.map((v, i) => 1 - pulse + pulse * clip(v / (envSlow[i] + 1e-12), 0, 3));

  yield;
  const warm = 600;
  const W = new Float64Array(L);
  let done = 0;
  for (const { t, a, g } of frames) {
    if (++done % LPC_FRAMES_PER_STEP === 0) yield;
    if (g <= 0) continue;
    const n = normal(N + warm);
    let bw = 0;
    for (let i = 0; i < N; i++) {
      n[warm + i] *= mod[t + i];
      bw += w[i] * w[i] * n[warm + i] * n[warm + i];
    }
    const norm = Math.sqrt(bw / w2 + 1e-20);
    for (let i = 0; i < N; i++) n[warm + i] /= norm;
    for (let i = 0; i < n.length; i++) n[i] *= g;
    const y = lfilter([1], a.map((v, k) => v * widen[k]), n);
    for (let i = 0; i < N; i++) W[t + i] += y[warm + i] * w[i];
  }
  const cropped = new Float64Array(x.length);
  for (let i = 0; i < x.length; i++) cropped[i] = W[pad + i] / Math.sqrt(1.5);
  const out = lfilter([1], [1, -pre], cropped); // back from the pre-emphasised domain: the dry voice's envelope
  // power match to the dry voice on 10 ms: no breath before onsets, the voice's own level
  const px = uniformFilter(x.map((v) => v * v), Math.trunc(0.01 * SR));
  const pw = uniformFilter(out.map((v) => v * v), Math.trunc(0.01 * SR));
  for (let i = 0; i < out.length; i++) out[i] *= clip(Math.sqrt((px[i] + 1e-14) / (pw[i] + 1e-14)), 0, 8);
  return out;
}

// ---------------------------------------------------------------- what the dry voice is doing, per sample

const R16 = 16000;
const HANN_640 = Float64Array.from({ length: 640 }, (_, k) => 0.5 - 0.5 * Math.cos((2 * Math.PI * k) / 639)); // numpy.hanning: symmetric

/** Linear autocorrelation of a windowed 640-sample frame (lags 0..639) via a 2048-point FFT. */
const autocorr640 = (frame: Vec, re: Vec, im: Vec, out: Vec) => {
  re.fill(0);
  im.fill(0);
  for (let k = 0; k < 640; k++) re[k] = frame[k];
  fft(re, im);
  for (let k = 0; k < re.length; k++) {
    re[k] = re[k] * re[k] + im[k] * im[k];
    im[k] = 0;
  }
  fft(re, im, true);
  for (let k = 0; k < 640; k++) out[k] = re[k] / re.length;
};

/** 0..1 per sample: how periodic the dry voice is (autocorrelation peak 60–400 Hz, 40 ms frames at 16 kHz). */
function voicing(x: Vec): Vec {
  const z = resamplePoly(x, 160, 441);
  const n = 640;
  const hop = 160;
  const lo = Math.trunc(R16 / 400);
  const hi = Math.trunc(R16 / 60);
  const zp = new Float64Array(n / 2 + z.length + n);
  zp.set(z, n / 2);
  const vals: number[] = [];
  const energy: number[] = [];
  const fr = new Float64Array(n);
  const re = new Float64Array(2048);
  const im = new Float64Array(2048);
  const ac = new Float64Array(n);
  for (let i = 0; i < z.length; i += hop) {
    for (let k = 0; k < n; k++) fr[k] = zp[i + k] * HANN_640[k];
    autocorr640(fr, re, im, ac);
    let peak = -Infinity;
    for (let k = lo; k < hi; k++) peak = Math.max(peak, ac[k]);
    vals.push(ac[0] <= 1e-12 ? 0 : peak / ac[0]);
    energy.push(ac[0]);
  }
  const lev = energy.map((e) => 10 * log10(e + 1e-14));
  const top = Math.max(...lev);
  const act = lev.filter((v) => v > top - 50);
  const ref = act.length ? percentile(act, 95) : top;
  // pauses are not voice: hum or codec noise there can look periodic, and brightening it would put ticks in silence
  const v = vals.map((r, i) => clip((r - 0.3) / 0.45, 0, 1) * clip((lev[i] - (ref - 35)) / 10, 0, 1));
  return uniformFilter(interpGrid(v, (hop * SR) / R16, x.length), Math.trunc(0.025 * SR));
}

/** 0..1 per sample, fast: how much the dry frame is a hiss (s, sh, ch, a t release) rather than a vowel. */
function fricative(x: Vec): Vec {
  const hf = filt(x, "hp", 3000);
  const hp1500 = filt(x, "hp", 1500);
  const lf = filt(
    x.map((v, i) => v - hp1500[i]),
    "hp",
    100,
  );
  const k = Math.trunc(0.005 * SR);
  const h = uniformFilter(hf.map((v) => v * v), k);
  const l = uniformFilter(lf.map((v) => v * v), k);
  const fr = h.map((v, i) => clip((10 * log10((v + 1e-14) / (l[i] + 1e-14)) + 20) / 12, 0, 1));
  return maximumFilter(fr, Math.trunc(0.032 * SR)); // reach 16 ms around the hiss (half an LPC frame)
}

/** Per-sample first-order tilt W[n] − c[n]·W[n−1], level kept at fRef: c = 0.97 gives a flat (whisper) source instead of a glottal one. */
function flattenSource(W: Vec, c: Vec, fRef = 500): Vec {
  const w0 = (2 * Math.PI * fRef) / SR;
  const out = new Float64Array(W.length);
  for (let i = 0; i < W.length; i++) {
    const k = 1 / Math.hypot(1 - c[i] * Math.cos(w0), c[i] * Math.sin(w0));
    out[i] = k * (W[i] - c[i] * (i ? W[i - 1] : 0));
  }
  return out;
}

/** Level of the dry voice on 20 ms and its loud level (95th percentile of the active part): the same for every render. */
function levelOf(x: Vec) {
  const lev = uniformFilter(x.map((v) => v * v), Math.trunc(0.02 * SR)).map((v) => 10 * log10(v + 1e-14));
  let top = -Infinity;
  for (const v of lev) top = Math.max(top, v);
  const act = lev.filter((v) => v > top - 45);
  return { lev, ref: act.length ? percentile(act, 95) : top };
}

/** Whisper share per sample: amount on the loudest frames, rising on frames start..start+span dB below them. */
function amountCurve({ lev, ref }: ReturnType<typeof levelOf>, amount: number, soft: number, start: number, span: number): Vec {
  const m = lev.map((v) => amount + soft * (1 - amount) * clip((ref - start - v) / span, 0, 1));
  return uniformFilter(m, Math.trunc(0.015 * SR)).map((v) => clip(v, 0, 0.97));
}

// ---------------------------------------------------------------- the colour chain

/** Soft de-ess: when 4.5–11 kHz rises above the 0.3–3.5 kHz body by more than thr, pull 3.5 kHz+ down. */
function deess(y: Vec, thrDb: number, maxCut: number, ratio = 3): Vec {
  const s = stft(y);
  const S = new Float64Array(s.frames);
  const V = new Float64Array(s.frames);
  for (let j = 0; j < s.frames; j++) {
    for (let k = 0; k < NBIN; k++) {
      const p = s.re[j * NBIN + k] ** 2 + s.im[j * NBIN + k] ** 2;
      if (FREQS[k] >= 4500 && FREQS[k] < 11000) S[j] += p;
      if (FREQS[k] >= 300 && FREQS[k] < 3500) V[j] += p;
    }
  }
  let smax = 0;
  for (const v of S) smax = Math.max(smax, v);
  const floor = 10 * log10(smax + 1e-14) - 40;
  const raw = Float64Array.from(S, (sv, j) => (10 * log10(sv + 1e-14) > floor ? Math.min(maxCut, Math.max(0, 10 * log10((sv + 1e-14) / (V[j] + 1e-14)) - thrDb) * (1 - 1 / ratio)) : 0));
  const cut = uniformFilter(maximumFilter(raw, 3), 3);
  for (let j = 0; j < s.frames; j++) {
    for (let k = 0; k < NBIN; k++) {
      const weight = clip((FREQS[k] - 3500) / 1500, 0, 1);
      if (!weight) continue;
      const g = 10 ** ((-cut[j] * weight) / 20);
      s.re[j * NBIN + k] *= g;
      s.im[j * NBIN + k] *= g;
    }
  }
  return istft(s);
}

/** Light compression on 1 ms blocks (10 ms RMS), soft knee, attack/release smoothing both ways (offline, no lag). */
function compress(y: Vec, thrRelDb: number, ratio: number, knee = 8, attMs = 4, relMs = 90): Vec {
  const blk = Math.trunc(SR / 1000); // 44 samples, as SR // 1000 in the original
  const nb = Math.ceil(y.length / blk);
  const ms0 = new Float64Array(nb);
  for (let b = 0; b < nb; b++) {
    let s = 0;
    for (let i = b * blk; i < (b + 1) * blk; i++) s += i < y.length ? y[i] * y[i] : 0;
    ms0[b] = s / blk;
  }
  const lev = uniformFilter(ms0, 10).map((v) => 10 * log10(v + 1e-14));
  let top = -Infinity;
  for (const v of lev) top = Math.max(top, v);
  const act = lev.filter((v) => v > top - 45);
  const thr = (act.length ? percentile(act, 95) : top) + thrRelDb;
  const k = 1 - 1 / ratio;
  const gr = lev.map((v) => {
    const over = v - thr;
    return over <= -knee / 2 ? 0 : over >= knee / 2 ? over * k : (k * (over + knee / 2) ** 2) / (2 * knee);
  });
  const aa = Math.exp(-1 / attMs);
  const ar = Math.exp(-1 / relMs);
  const smooth = (v: Vec) => {
    const out = new Float64Array(v.length);
    let s = 0;
    for (let i = 0; i < v.length; i++) {
      const c = v[i] > s ? aa : ar;
      s = c * s + (1 - c) * v[i];
      out[i] = s;
    }
    return out;
  };
  const fwd = smooth(gr);
  const back = smooth(gr.slice().reverse()).reverse();
  const g = fwd.map((v, i) => Math.max(v, back[i]));
  // numpy.interp at block centres b·blk + blk/2
  const out = new Float64Array(y.length);
  for (let i = 0; i < y.length; i++) {
    const p = (i - blk / 2) / blk;
    let gi: number;
    if (p <= 0) gi = g[0];
    else if (p >= nb - 1) gi = g[nb - 1];
    else {
      const b = Math.floor(p);
      gi = g[b] + (g[b + 1] - g[b]) * (p - b);
    }
    out[i] = y[i] * 10 ** (-gi / 20);
  }
  return out;
}

/**
 * Power blend of the dry voice and the whisper layer per time and frequency: whisper share m(t) below 500 Hz rising
 * to m + hi·(1−m) above 2 kHz — a breathy voice keeps its low harmonics (pitch, identity) while the top turns to
 * breath; under 300 Hz the share is mLow (ramping to m at 600 Hz), so the pitch he keeps reads as his pitch.
 */
function blend(Dz: Spec, W: Vec, m: Vec, mLow: Vec, hi: number, fLo = 500, fHi = 2000): Vec {
  const Wz = stft(W);
  const re = new Float64Array(Dz.re.length);
  const im = new Float64Array(Dz.im.length);
  const ramp = Float64Array.from(FREQS, (f) => clip(Math.log2(Math.max(f, 1) / fLo) / Math.log2(fHi / fLo), 0, 1));
  const up = Float64Array.from(FREQS, (f) => clip(Math.log2(Math.max(f, 1) / 300), 0, 1));
  const at = (v: Vec, s: number) => {
    if (s <= 0) return v[0];
    if (s >= v.length - 1) return v[v.length - 1];
    const k = Math.floor(s);
    return v[k] + (v[k + 1] - v[k]) * (s - k);
  };
  for (let j = 0; j < Dz.frames; j++) {
    const s = j * NSTEP;
    const mt = at(m, s);
    const ml = at(mLow, s);
    for (let k = 0; k < NBIN; k++) {
      const mb = ml + (mt - ml) * up[k];
      const mf = clip(mb + hi * (1 - mb) * ramp[k], 0, 1);
      const a = Math.sqrt(1 - mf);
      const b = Math.sqrt(mf);
      const i = j * NBIN + k;
      re[i] = a * Dz.re[i] + b * Wz.re[i];
      im[i] = a * Dz.im[i] + b * Wz.im[i];
    }
  }
  return istft({ re, im, frames: Dz.frames, length: Dz.length });
}

/** Cosine kernels of the 640-point DFT bands 0.3–2 kHz and 4–8 kHz: band power straight from the circular autocorrelation. */
const BAND_KERNELS = (() => {
  const make = (f0: number, f1: number) => {
    const g = new Float64Array(640);
    for (let k = 0; k <= 320; k++) {
      const f = (k * R16) / 640;
      if (f < f0 || f >= f1) continue;
      for (let m = 0; m < 640; m++) g[m] += Math.cos((2 * Math.PI * k * m) / 640);
    }
    return g;
  };
  return { low: make(300, 2000), top: make(4000, 8000) };
})();

/** The voice-style numbers that steer the levels — voiced share and tilt on speech frames at 16 kHz, measured at −20 LUFS. */
export function style(y: Vec): { voiced: number; tilt: number } {
  const gain = 10 ** ((-20 - lufs(y)) / 20);
  const z = resamplePoly(
    y.map((v) => v * gain),
    160,
    441,
  );
  const n = 640;
  const hop = 160;
  if (z.length < n + hop) return { voiced: 0, tilt: 0 };
  const starts: number[] = [];
  const rms: number[] = [];
  for (let i = 0; i + n <= z.length; i += hop) {
    starts.push(i);
    rms.push(Math.sqrt(sumSq(z, i, i + n) / n));
  }
  const gate = Math.max(0.01, percentile(rms, 50) * 0.5);
  const fr = new Float64Array(n);
  const re = new Float64Array(2048);
  const im = new Float64Array(2048);
  const ac = new Float64Array(n);
  const circ = new Float64Array(n);
  let speech = 0;
  let voiced = 0;
  let low = 0;
  let top = 0;
  const lo = Math.trunc(R16 / 400);
  const hi = Math.trunc(R16 / 60);
  starts.forEach((s, f) => {
    if (!(rms[f] > gate)) return;
    speech++;
    for (let k = 0; k < n; k++) fr[k] = z[s + k] * HANN_640[k];
    autocorr640(fr, re, im, ac);
    if (ac[0] > 0) {
      let peak = -Infinity;
      for (let k = lo; k < hi; k++) peak = Math.max(peak, ac[k]);
      if (peak / ac[0] > 0.45) voiced++;
    }
    // |DFT_640|² is the DFT of the circular autocorrelation r[m] + r[640 − m]
    circ[0] = ac[0];
    for (let m = 1; m < n; m++) circ[m] = ac[m] + ac[n - m];
    for (let m = 0; m < n; m++) {
      low += circ[m] * BAND_KERNELS.low[m];
      top += circ[m] * BAND_KERNELS.top[m];
    }
  });
  if (!speech) return { voiced: 0, tilt: 0 };
  return { voiced: voiced / speech, tilt: 10 * log10(top / (low + 1e-20) + 1e-20) };
}

/**
 * The knobs the steering turns per span: breath brightness (dB at brightF), whisper share offset, whisper share above
 * 2 kHz, and lift — the same breath brightened from LIFT_F up instead, which raises the tilt about as much per dB
 * while costing ~5× less voicing (measured on the trade2 take: −0.005 against −0.02…−0.04 voiced per dB).
 */
export type Knobs = { bright: number; delta: number; hi: number; lift: number };
const LIFT_F = 3000;
/** What the steering settled on for one span, and what that measured. */
export type Steered = Knobs & { voiced: number; tilt: number };

/** The slow analysis of one stretch, done once; the render it hands back is what every steering try runs. */
function* prepareSteps(x: Vec, p: WhisperParams, normal: (n: number) => Vec): Steps<(k: Knobs) => Steps<Vec>> {
  const W = yield* whisperLayerSteps(x, p.gamma, p.pulse, normal, p.lagwin);
  // a whisper is excited by flat noise, a voice by steep glottal pulses: the whisper layer gets the brighter source
  // on vowels and sonorants (a hiss already is noise and keeps its own spectrum)
  const vo = voicing(x);
  yield;
  const fr = fricative(x);
  const v = vo.map((val, i) => val * (1 - fr[i]));
  let Wf = flattenSource(
    W,
    v.map((val) => p.flat * val),
  );
  Wf = filt(Wf, "hp", 180); // a whisper has no fundamental
  yield;
  const Dz = stft(filt(x, "highshelf", 3000, -p.dryCut, 0.6)); // breathy phonation: weaker high harmonics
  const level = levelOf(x);
  yield;
  return function* render({ bright, delta, hi, lift }: Knobs): Steps<Vec> {
    const amount = clip(p.amount + delta, 0, 0.9);
    const soft = clip(p.soft + delta, 0, 1);
    const m = amountCurve(level, amount, soft, p.softStart, p.softSpan);
    // low band: only `lo` of the share on the loud (voiced) syllables, the soft ones still fully whispered
    const mLow = amountCurve(level, p.lo * amount, soft, p.softStart, p.softSpan);
    // breath air on the vowels only; a whisper's energy sits in the F2–F3 band and falls above ~6 kHz
    const Wv = filt(filt(filt(Wf, "highshelf", p.brightF, bright, 0.6), "highshelf", LIFT_F, lift, 0.6), "highshelf", 6500, -p.topCut, 0.6);
    let y = blend(
      Dz,
      Wf.map((val, i) => (1 - v[i]) * val + v[i] * Wv[i]),
      m,
      mLow,
      hi,
    );
    yield;
    // close mic: no rumble, proximity warmth, a lighter chest band, a little air
    y = filt(y, "hp", 70);
    y = filt(y, "lowshelf", 180, p.warm);
    y = filt(y, "lowshelf", 700, -p.thin, 0.6);
    y = filt(y, "highshelf", 9000, p.air);
    yield;
    y = deess(y, p.deessThr, p.deessMax);
    yield;
    return compress(y, p.compThr, p.compRatio);
  };
}

/** A stretch rendered at fixed knobs, without steering: for tuning scripts and tests. */
export const renderWhisper = (x: Vec, p: WhisperParams, normal: (n: number) => Vec) => {
  const render = runSteps(prepareSteps(x, p, normal));
  return (k: Knobs) => runSteps(render(k));
};

/** Steering limits: the whisper share offset, the 1.2 kHz breath (dB), the 3 kHz lift (dB), the least share above 2 kHz. */
export const STEER = { tries: 8, delta: [-0.3, 0.4], bright: [6, 24], lift: [0, 24], hiFloor: 0.3, voicedTol: 0.025, tiltTol: 0.5, short: 0.05 } as const;

type Style = { voiced: number; tilt: number };
type Target = Pick<WhisperParams, "voiced" | "tilt">;

export const firstKnobs = (p: WhisperParams): Knobs => ({ bright: clip(p.bright, STEER.bright[0], STEER.bright[1]), delta: 0, hi: p.hi, lift: 0 });

/** How far a try is from the target: a voiced miss weighs as much as 2.5 dB of tilt per 0.05. */
export const steerMiss = (m: Style, p: Target) =>
  (2 * Math.max(0, Math.abs(m.voiced - p.voiced) - STEER.voicedTol)) / STEER.voicedTol + Math.max(0, Math.abs(m.tilt - p.tilt) - STEER.tiltTol);

/**
 * One steering move from what the last try measured (null: both on target). Takes differ (a dialogue take is often
 * darker and more voiced than a single line, and darker on some lines than on others), so every span is steered to
 * the level's voiced share and tilt. When the two pull apart the voiced share wins — it is what keeps his voice his:
 * the whisper share moves first; once voicing is more than 0.05 short with the share at its floor, breath moves from
 * 1.2 kHz up to 3 kHz (about the same tilt for less noise on the vowels) and the share above 2 kHz comes down, and
 * while voicing is short no brightness is added. A span that cannot reach both keeps the voiced share and the
 * brightest tilt that allows.
 */
export function nextKnobs(k: Knobs, now: Style, p: Target): Knobs | null {
  const dv = now.voiced - p.voiced;
  const dt = p.tilt - now.tilt;
  if (Math.abs(dv) < STEER.voicedTol && Math.abs(dt) < STEER.tiltTol) return null;
  const next = { ...k };
  // voiced: the whisper share; what it cannot give at its floor is left over
  const want = k.delta + 0.8 * dv;
  next.delta = clip(want, STEER.delta[0], STEER.delta[1]);
  const stuck = want < STEER.delta[0] - 1e-9;
  // tilt: ~0.7 dB per dB of either shelf; brighter fills the 1.2 kHz breath up to its cap and then the lift,
  // darker takes the lift away first
  const step = (0.8 * dt) / 0.7;
  if (-dv > STEER.short && stuck) {
    // ~0.015 voiced back per dB moved up to 3 kHz; with nothing left to move, the share above 2 kHz comes down faster
    const move = Math.min(k.bright - STEER.bright[0], clip(-dv / 0.015, 2, 8));
    next.bright = k.bright - move;
    next.lift = clip(k.lift + move + Math.max(0, step), STEER.lift[0], STEER.lift[1]);
    next.hi = Math.max(STEER.hiFloor, k.hi + (move < 2 ? 2 : 1) * dv);
  } else if (-dv <= STEER.short || step < 0) {
    if (step > 0) {
      next.bright = clip(k.bright + step, STEER.bright[0], STEER.bright[1]);
      next.lift = clip(k.lift + (k.bright + step - next.bright), STEER.lift[0], STEER.lift[1]);
    } else {
      next.lift = clip(k.lift + step, STEER.lift[0], STEER.lift[1]);
      next.bright = clip(k.bright + step + (k.lift - next.lift), STEER.bright[0], STEER.bright[1]);
    }
  }
  return next;
}

/** Up to STEER.tries renders of a span, every one kept; the one closest to the target is the span's sound. */
function* steerSteps(render: (k: Knobs) => Steps<Vec>, p: WhisperParams, core: [number, number], info?: Steered[]): Steps<Vec> {
  let k: Knobs | null = firstKnobs(p);
  let best: { y: Vec; k: Knobs; now: Style; miss: number } | null = null;
  for (let i = 0; i < STEER.tries && k; i++) {
    const y = yield* render(k);
    yield;
    const now = style(y.subarray(core[0], core[1]));
    yield;
    const miss = steerMiss(now, p);
    if (!best || miss < best.miss) best = { y, k, now, miss };
    k = nextKnobs(k, now, p);
  }
  const r = (v: number, d: number) => Math.round(v * d) / d;
  const { y, k: kb, now } = best!;
  info?.push({ bright: r(kb.bright, 10), delta: r(kb.delta, 1000), hi: r(kb.hi, 100), lift: r(kb.lift, 10), voiced: r(now.voiced, 100), tilt: r(now.tilt, 10) });
  return y;
}

/** One stretch of the voice (with context around it) turned near-whisper; core is the part the steering measures. */
export const whisperize = (x: Vec, p: WhisperParams, normal: (n: number) => Vec, core: [number, number] = [0, x.length], info?: Steered[]): Vec =>
  runSteps(whisperizeSteps(x, p, normal, core, info));

function* whisperizeSteps(x: Vec, p: WhisperParams, normal: (n: number) => Vec, core: [number, number], info?: Steered[]): Steps<Vec> {
  const render = yield* prepareSteps(x, p, normal);
  return yield* steerSteps(render, p, core, info);
}

/**
 * The peaks a span's level is held to: the third-loudest 5 ms block's true peak. A whispered plosive can throw one
 * burst ~7 dB over everything around it (measured: +5 dB against a −10 dB 20 ms level at a «т» onset), and holding the
 * whole line to that burst left it 4–5 dB quieter than the line next to it; the limiter takes such a burst instead.
 */
export function bodyPeakDb(y: Vec): number {
  const up = resamplePoly(y, 4, 1);
  const blk = 4 * Math.trunc(0.005 * SR);
  const peaks: number[] = [];
  for (let b = 0; b < up.length; b += blk) {
    let m = 0;
    for (let i = b; i < Math.min(up.length, b + blk); i++) m = Math.max(m, Math.abs(up[i]));
    peaks.push(m);
  }
  peaks.sort((a, b) => b - a);
  return 20 * log10((peaks[Math.min(2, peaks.length - 1)] ?? 0) + 1e-12);
}

/** Transparent peak limiter: the needed gain's minimum over 3 ms, then a 3 ms box smooth (never above the need). */
export function limit(y: Vec, ceilingDb: number): Vec {
  const c = 10 ** (ceilingDb / 20);
  const w = Math.trunc(0.003 * SR);
  const peak = maximumFilter(y.map(Math.abs), 3);
  const need = peak.map((v) => Math.min(1, c / (v + 1e-12)));
  const g = uniformFilter(minimumFilter(need, 2 * w + 1), 2 * w + 1);
  return y.map((v, i) => v * Math.min(g[i], need[i]));
}

// ---------------------------------------------------------------- spans of a whole track

/** Where span edges go and how they are crossed. */
const EDGE = {
  /** s: how far from t the edge looks for the quietest point of the pause it goes into (and, with no pause, of the speech) */
  near: 0.12,
  /** s: how far from the segment edge a pause may be (a speaker's tail often runs ~0.2 s past it) */
  wide: 0.3,
  /** s: how long a stretch must stay under the gate to count as a pause there (a stop's closure is shorter) */
  pause: 0.04,
  /** dBFS of the 10 ms level, or this many dB under the span's loud level if that is lower: a pause */
  gateDb: -45,
  below: 40,
  /** an edge may move into its span by at most this share of the span */
  inward: 0.35,
  /** s: crossfade in a pause */
  fade: 0.01,
  /** s: crossfade where no pause is near (speech runs across the edge), level-matched to the dry side */
  xfade: 0.06,
  /** s: past such a crossfade the processed side eases from the dry's level into its own over this */
  ease: 0.2,
};

/** One edge of a delivered span: where it ended up (s), how far it moved (ms), in a pause or not, the level match there (dB). */
export type SpanEdge = { at: number; moved: number; quiet: boolean; matchDb: number };
export type SpanReport = Steered & { levelDb: number; edges: [SpanEdge, SpanEdge] };

/**
 * Where a span edge at t goes, between samples lo..hi (env: 10 ms level in dB, gate: the level of a pause). Into the
 * pause t is in; else into the nearest real pause within EDGE.wide, at its quietest point near its side facing t;
 * else (speech runs across, no pause near) onto the quietest point within EDGE.near, to be crossed slowly.
 */
export function edgeOf(env: Vec, t: number, lo: number, hi: number, gate: number, near = EDGE.near): { i: number; quiet: boolean } {
  const c = Math.round(clip(t * SR, lo, hi));
  if (near <= 0) return { i: c, quiet: env[c] < gate };
  const reach = Math.round(near * SR);
  const from = Math.max(lo, c - Math.round(Math.max(near, EDGE.wide) * SR));
  const to = Math.min(hi, c + Math.round(Math.max(near, EDGE.wide) * SR));
  let best = { i: -1, score: Infinity };
  for (let j = from; j <= to; ) {
    if (env[j] >= gate) {
      j++;
      continue;
    }
    let k = j;
    while (k <= to && env[k] < gate) k++;
    // a quiet run [j, k): the one t is in takes the edge; else the nearest real pause (a stop's closure is shorter),
    // a longer one counting as nearer, since the pause between two voices is longer than a gap inside a word
    const inside = c >= j && c < k;
    const len = (k - j) / SR;
    if (inside || len >= EDGE.pause) {
      const dist = inside ? 0 : (c < j ? j - c : c - (k - 1)) / SR;
      const score = inside ? -Infinity : dist - 0.5 * Math.min(len, 0.2);
      if (score < best.score) {
        // its quietest point near t, or in the first stretch of it seen from t
        const [qa, qb] = inside ? [Math.max(j, c - reach), Math.min(k - 1, c + reach)] : c < j ? [j, Math.min(k - 1, j + reach)] : [Math.max(j, k - 1 - reach), k - 1];
        let q = qa;
        for (let m = qa; m <= qb; m++) if (env[m] < env[q]) q = m;
        best = { i: q, score };
      }
    }
    j = k;
  }
  if (best.i >= 0) return { i: best.i, quiet: true };
  // speech runs across: the quietest point near t, to be crossed slowly
  let q = c;
  for (let m = Math.max(lo, c - reach); m <= Math.min(hi, c + reach); m++) if (env[m] < env[q]) q = m;
  return { i: q, quiet: false };
}

export type SpanOptions = {
  /** s: how far around a segment edge its quietest point is looked for (0: edges stay exactly where given) */
  snap?: number;
  /** dB on top of the dry span's loudness */
  spanGain?: number;
  normal?: (i: number) => (n: number) => Vec;
  /** called before each span with its number and the count: progress for a log */
  onSpan?: (i: number, n: number) => void;
};

/**
 * Only the given spans of a whole dialogue track (seconds) turn near-whisper: each is cut with context, processed,
 * brought to the dry span's loudness as far as its peaks allow (see limitDb), and pasted back. Its edges go into the
 * pause nearest to the segment edge (10 ms crossfade); where speech runs across with no pause near, the processed
 * side meets the dry one at the dry's level over a 60 ms crossfade. Same length, nothing shifted: the take's
 * timestamps stay valid. The one deliberate difference from whisperize.py: it matched the dry loudness fully, under
 * up to ~8 dB of limiting.
 */
export const whisperSpans = (x: Vec, spans: [number, number][], p: WhisperParams & { seed: number }, opts: SpanOptions = {}) => runSteps(whisperSpansSteps(x, spans, p, opts));

/** The same, handing the event loop back between steps; rejects with the signal's reason as soon as it aborts. */
export const whisperSpansAsync = (x: Vec, spans: [number, number][], p: WhisperParams & { seed: number }, opts: SpanOptions & { signal?: AbortSignal } = {}) =>
  runStepsAsync(whisperSpansSteps(x, spans, p, opts), opts.signal);

export function* whisperSpansSteps(x: Vec, spans: [number, number][], p: WhisperParams & { seed: number }, opts: SpanOptions = {}): Steps<{ y: Vec; steered: SpanReport[] }> {
  const y = Float64Array.from(x);
  const margin = Math.trunc(0.12 * SR);
  yield;
  const env = uniformFilter(
    x.map((v) => v * v),
    Math.trunc(0.01 * SR),
  ).map((v) => 10 * log10(v + 1e-14));
  const steered: SpanReport[] = [];
  const order = spans.map((_, i) => i).sort((a, b) => spans[a][0] - spans[b][0]);
  let prevEnd = 0;
  for (const [n, i] of order.entries()) {
    yield;
    opts.onSpan?.(n, spans.length);
    const [s, e] = spans[i];
    const len = Math.max(0, e - s);
    // the gate of a pause: absolute, or relative to this span's loud level for a quiet take
    const levels: number[] = [];
    for (let j = Math.max(0, Math.round(s * SR)); j < Math.min(x.length, Math.round(e * SR)); j += 441) levels.push(env[j]);
    const gate = Math.min(EDGE.gateDb, (levels.length ? percentile(levels, 95) : EDGE.gateDb + EDGE.below) - EDGE.below);
    const inward = Math.min(EDGE.wide, EDGE.inward * len);
    const near = opts.snap ?? EDGE.near;
    const wide = Math.max(near, EDGE.wide);
    const last = x.length - 1;
    const a = edgeOf(env, s, Math.max(prevEnd, Math.round((s - wide) * SR), 0), Math.min(last, Math.round((s + inward) * SR)), gate, near);
    const b = edgeOf(env, e, Math.max(a.i + Math.round(0.05 * SR), Math.round((e - inward) * SR)), Math.min(last, Math.round((e + wide) * SR)), gate, near);
    const s0 = a.i;
    const e0 = Math.min(x.length, Math.max(b.i, s0 + 1));
    const fs = Math.trunc((a.quiet ? EDGE.fade : EDGE.xfade) * SR);
    const fe = Math.trunc((b.quiet ? EDGE.fade : EDGE.xfade) * SR);
    const c0 = Math.max(0, s0 - margin);
    const c1 = Math.min(x.length, e0 + margin);
    const seg = x.slice(c0, c1);
    const core: [number, number] = [s0 - c0, e0 - c0];
    const info: Steered[] = [];
    let proc = yield* whisperizeSteps(seg, p, (opts.normal ?? gaussian)(p.seed + i), core, info);
    yield;
    // the dry span's loudness as far as the whisper's peaks allow (limitDb), peaks no higher than the dry span had
    const coreOf = (v: Vec) => v.subarray(core[0], core[1]);
    const dryLufs = lufs(coreOf(seg));
    const ceiling = Math.max(-1, truePeakDb(coreOf(seg)));
    const gainDb = Math.min(dryLufs + (opts.spanGain ?? 0) - lufs(coreOf(proc)), ceiling + p.limitDb - bodyPeakDb(coreOf(proc)));
    proc = proc.map((v) => v * 10 ** (gainDb / 20));
    // an edge in speech: the processed side starts at the dry's level across the crossfade and eases into its own
    const match = (at: number, half: number, dir: 1 | -1) => {
      const from = Math.max(0, at - c0 - half);
      const to = Math.min(seg.length, at - c0 + half);
      const db = clip(10 * log10((sumSq(seg, from, to) + 1e-12) / (sumSq(proc, from, to) + 1e-12)), -6, 12);
      const ease = Math.trunc(EDGE.ease * SR);
      // weight 1 up to the inner end of the crossfade, then a raised-cosine fall over `ease` into the span
      const w = (j: number) => {
        const inside = dir * (j - (at - c0)) - half;
        return inside <= 0 ? 1 : inside >= ease ? 0 : 0.5 + 0.5 * Math.cos((Math.PI * inside) / ease);
      };
      return { db, w };
    };
    const ms = [a.quiet ? null : match(s0, fs >> 1, 1), b.quiet ? null : match(e0, fe >> 1, -1)];
    if (ms[0] || ms[1]) {
      proc = proc.map((v, j) => {
        let sum = 0;
        let wsum = 0;
        for (const m of ms) {
          if (!m) continue;
          const w = m.w(j);
          sum += m.db * w;
          wsum += w;
        }
        return v * 10 ** (sum / Math.max(1, wsum) / 20);
      });
    }
    yield;
    if (truePeakDb(coreOf(proc)) > ceiling) proc = limit(proc, ceiling - 0.5);
    const over = truePeakDb(coreOf(proc)) - ceiling; // what got between the samples past the limiter
    if (over > 0) proc = proc.map((v) => v * 10 ** (-over / 20));
    yield;
    // raised-cosine ramps centred on the span edges; blended into the track as it is now, so a span right after
    // another one keeps its neighbour's processed tail
    for (let j = c0; j < c1; j++) {
      const up = clip((j - (s0 - fs / 2)) / fs, 0, 1);
      const dn = clip((e0 + fe / 2 - j) / fe, 0, 1);
      const m = Math.min(0.5 - 0.5 * Math.cos(Math.PI * up), 0.5 - 0.5 * Math.cos(Math.PI * dn));
      y[j] = y[j] * (1 - m) + proc[j - c0] * m;
    }
    prevEnd = e0 + (fe >> 1);
    const r1 = (v: number) => Math.round(v * 10) / 10;
    const edge = (at: number, t: number, quiet: boolean, m: { db: number } | null): SpanEdge => ({ at: Math.round((at / SR) * 1000) / 1000, moved: Math.round((at / SR - t) * 1000), quiet, matchDb: m ? r1(m.db) : 0 });
    steered[i] = { ...info[0], levelDb: r1(lufs(coreOf(proc)) - dryLufs), edges: [edge(s0, s, a.quiet, ms[0]), edge(e0, e, b.quiet, ms[1])] };
  }
  yield;
  let peak = 0;
  for (const v of y) peak = Math.max(peak, Math.abs(v));
  // never clip; touches only the samples around such a peak
  return { y: peak > 0.98 ? limit(y, -0.3) : y, steered };
}
