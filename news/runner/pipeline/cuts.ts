// Стыки планов: обрывки чужих планов на краях кусков и длинные планы без смены картинки.
// Владелец 30.10 о Копатыче: «с 5 по 6 сек есть лишний кадр какой то который резко меняется» — край перебивки лёг рядом
// со склейкой выпуска, и между ними мелькнули 2–6 кадров другого человека. И там же: «показывают 3 других людей а не
// того кто говорит» — перебивки ради смены картинки закрывали говорящего; длинный план теперь оживляет наезд на него.
import fs from "node:fs";
import path from "node:path";
import type { Cover, NewsPlan } from "../../engine/src/plan";
import type { ClipInfo } from "./analyze";
import { ffmpeg, python, run, type Hooks } from "./util";

/** Обрывок плана короче этого на краю куска видно как вспышку. */
const SLIVER = 0.5;
/** План героя дольше этого без склеек оживляет наезд. */
const LONG_SHOT = 5.5;
/** Части длинного плана: обычный → наезд → обычный…, каждая около 3,5 с, не короче 1,8 с. */
const PART = 3.5;
const MIN_PART = 1.8;
const PUNCH = 1.14;
const END_AIR = 0.25;

/** Все склейки ролика по кадрам, без прореживания (sceneCuts в разборе выкидывает близкие — как раз обрывки). */
const cutCache = new Map<string, number[]>();
export async function frameCuts(file: string, signal?: AbortSignal): Promise<number[]> {
  const known = cutCache.get(file);
  if (known) return known;
  const { stderr } = await run("ffmpeg", ["-hide_banner", "-nostats", "-i", file, "-vf", "scale=160:-2,select='gt(scene,0.3)',showinfo", "-an", "-f", "null", "-"], { signal });
  const out: number[] = [];
  for (const m of stderr.matchAll(/pts_time:([\d.]+)/g)) {
    const t = Number(Number(m[1]).toFixed(3));
    if (!out.length || t - out[out.length - 1] >= 0.06) out.push(t);
  }
  cutCache.set(file, out);
  return out;
}

const inside = (cuts: number[], a: number, b: number) => cuts.filter((t) => t > a + 0.04 && t < b - 0.04);
/** Обрывки на краях окна исходника [a, b]: сколько секунд чужого плана в начале и в конце. */
function slivers(cuts: number[], a: number, b: number): { head: number; tail: number; first?: number; last?: number } {
  const c = inside(cuts, a, b);
  if (!c.length) return { head: Infinity, tail: Infinity };
  return { head: c[0] - a, tail: b - c[c.length - 1], first: c[0], last: c[c.length - 1] };
}
const clean = (cuts: number[], a: number, b: number) => {
  const s = slivers(cuts, a, b);
  return s.head >= SLIVER && s.tail >= SLIVER;
};

/** Окно исходника без обрывков на краях, ближе к исходному; null — сдвигом не выходит. */
function shiftWindow(cuts: number[], at: number, dur: number, max: number): number | null {
  if (clean(cuts, at, at + dur)) return at;
  const s = slivers(cuts, at, at + dur);
  const options = [
    ...(s.head < SLIVER && s.first !== undefined ? [s.first + 0.01] : []),
    ...(s.tail < SLIVER && s.last !== undefined ? [s.last - dur - 0.01] : []),
    // целиком внутри одного плана: от ближайших склеек вокруг
    ...cuts.flatMap((t) => [t + 0.01, t - dur - 0.01]).filter((x) => Math.abs(x - at) <= 3),
  ].filter((x) => x >= 0 && x <= max);
  const ok = options.filter((x) => clean(cuts, x, x + dur)).sort((x, y) => Math.abs(x - at) - Math.abs(y - at));
  return ok.length ? Number(ok[0].toFixed(3)) : null;
}

/** Стоп-кадр ролика в секунду t — в stills/ задания (1080×1920, как сам ролик: кадр не прыгает). */
async function freeze(pub: string, plan: NewsPlan, clip: string, t: number, signal?: AbortSignal): Promise<string> {
  const name = `stills/${clip}_f${Math.round(t * 1000)}.png`;
  const target = path.join(pub, name);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  if (!fs.existsSync(target)) await ffmpeg(["-ss", Math.max(0, t).toFixed(3), "-i", path.join(pub, plan.clips[clip].file), "-frames:v", "1", target], signal);
  return name;
}

/** Видимые места куска героя (секунды от его начала) между перекрытиями. */
function visible(len: number, covers: Cover[]): { a: number; b: number; after?: Cover; before?: Cover }[] {
  const sorted = [...covers].sort((x, y) => x.from - y.from);
  const out: { a: number; b: number; after?: Cover; before?: Cover }[] = [];
  let t = 0;
  let prev: Cover | undefined;
  for (const c of sorted) {
    if (c.from > t) out.push({ a: t, b: c.from, after: prev, before: c });
    t = Math.max(t, c.to);
    prev = c;
  }
  if (t < len) out.push({ a: t, b: len, after: prev });
  return out;
}

/**
 * Края планов без обрывков: планы автора сдвигаются внутри своего ролика, перекрытия — к склейке; что не сдвинуть
 * (начало и конец куска героя держит его звук), закрывает стоп-кадр соседнего плана на эти доли секунды.
 */
export async function tidyEdges(pub: string, plan: NewsPlan, clips: ClipInfo[], hooks: Hooks): Promise<void> {
  const byKey = new Map(clips.map((c) => [c.key, c]));
  const cutsOf = (key: string) => (plan.clips[key] ? frameCuts(path.join(pub, plan.clips[key].file), hooks.signal) : Promise.resolve([]));
  const fixed: string[] = [];
  for (const [i, seg] of plan.segments.entries()) {
    const last = i === plan.segments.length - 1;
    if ("narr" in seg) {
      const line = plan.lines[seg.narr];
      if (!line) continue;
      const segLen = line.end + (last ? END_AIR : 0.12);
      for (const [k, sh] of seg.shots.entries()) {
        if (!sh.clip || sh.still || sh.phone || sh.endAt !== undefined) continue;
        const from = sh.w === 0 ? 0 : line.words[sh.w].s - 0.05;
        const to = k + 1 < seg.shots.length ? line.words[seg.shots[k + 1].w].s - 0.05 : segLen;
        const dur = to - from;
        const max = Math.max(0, (sh.maxAt ?? (byKey.get(sh.clip)?.duration ?? 0) - 0.1) - dur);
        const at = Math.min(sh.at ?? 0, max);
        const moved = shiftWindow(await cutsOf(sh.clip), at, dur, max);
        if (moved !== null && Math.abs(moved - at) > 0.001) {
          fixed.push(`${seg.narr}:${sh.w} ${sh.clip} ${at.toFixed(2)}→${moved.toFixed(2)}`);
          sh.at = moved;
        }
      }
      continue;
    }
    const key = "orig" in seg ? seg.orig : seg.dub;
    if (!plan.clips[key] || key.startsWith("vm_")) continue;
    const covers: Cover[] = [...(seg.covers ?? [])];
    const cuts = await cutsOf(key);
    const len = seg.to - seg.from;
    for (const v of visible(len, covers)) {
      // весь видимый промежуток короче обрывка — перекрытие тянется на него
      if (v.b - v.a < SLIVER) {
        if (v.before && !v.before.still) {
          const d = v.before.from - v.a;
          v.before.from = v.a;
          v.before.at = Math.max(0, v.before.at - d);
          fixed.push(`перекрытие ${key} с ${v.a.toFixed(2)}`);
          continue;
        }
        if (v.after && !v.after.still) {
          v.after.to = v.b;
          fixed.push(`перекрытие ${key} до ${v.b.toFixed(2)}`);
          continue;
        }
      }
      const s = slivers(cuts, seg.from + v.a, seg.from + v.b);
      if (s.head < SLIVER && s.first !== undefined) {
        const end = s.first - seg.from;
        if (v.after && !v.after.still && !v.after.punch && end - v.after.from <= 4) {
          v.after.to = Number(end.toFixed(3));
          fixed.push(`перекрытие ${key} до склейки ${end.toFixed(2)}`);
        } else {
          covers.push({ from: v.a, to: Number(end.toFixed(3)), at: 0, still: await freeze(pub, plan, key, s.first + 0.04, hooks.signal) });
          fixed.push(`стоп-кадр ${key} ${v.a.toFixed(2)}–${end.toFixed(2)}`);
        }
      }
      if (s.tail < SLIVER && s.last !== undefined && s.last - seg.from > v.a + 0.05) {
        const start = s.last - seg.from;
        if (v.before && !v.before.still && !v.before.punch && v.before.to - start <= 4) {
          const d = v.before.from - start;
          v.before.from = Number(start.toFixed(3));
          v.before.at = Math.max(0, v.before.at - d);
          fixed.push(`перекрытие ${key} от склейки ${start.toFixed(2)}`);
        } else {
          covers.push({ from: Number(start.toFixed(3)), to: v.b, at: 0, still: await freeze(pub, plan, key, s.last - 0.05, hooks.signal) });
          fixed.push(`стоп-кадр ${key} ${start.toFixed(2)}–${v.b.toFixed(2)}`);
        }
      }
    }
    // свои планы перекрытий — без обрывков на краях; после того как края перекрытий подвинуты к склейкам основы
    // (продлённое перекрытие ловило чужой план своего ролика на 0,2 с — проба Копатыча 31.10, 38 с)
    for (const c of covers) {
      if (c.still || c.punch) continue;
      const ck = c.clip ?? key;
      const len = c.to - c.from;
      const max = Math.max(0, (byKey.get(ck)?.duration ?? 0) - len - 0.05);
      const moved = shiftWindow(await cutsOf(ck), c.at, len, max);
      if (moved !== null && Math.abs(moved - c.at) > 0.001) {
        fixed.push(`перекрытие ${ck} ${c.at.toFixed(2)}→${moved.toFixed(2)}`);
        c.at = moved;
      }
    }
    if (covers.length) seg.covers = covers.sort((x, y) => x.from - y.from);
  }
  if (fixed.length) hooks.log(`стыки без обрывков: ${fixed.join("; ")}`);
}

/** Лицо на кадре ролика в секунду t (самое крупное), центр в пикселях 1080×1920; null — лица нет. */
async function faceAt(pub: string, plan: NewsPlan, clip: string, t: number, signal?: AbortSignal): Promise<{ x: number; y: number } | null> {
  const frame = path.join(pub, "stills", `${clip}_face${Math.round(t * 1000)}.jpg`);
  fs.mkdirSync(path.dirname(frame), { recursive: true });
  try {
    if (!fs.existsSync(frame)) await ffmpeg(["-ss", t.toFixed(3), "-i", path.join(pub, plan.clips[clip].file), "-frames:v", "1", "-q:v", "3", frame], signal);
    const boxes = JSON.parse((await python("faces.py", [frame], signal)).trim().split("\n").pop() || "[]") as number[][];
    const big = boxes.sort((a, b) => b[2] * b[3] - a[2] * a[3])[0];
    return big ? { x: big[0] + big[2] / 2, y: big[1] + big[3] / 2 } : null;
  } catch {
    return null;
  }
}

/**
 * Длинный план героя без склеек (больше 5,5 с) — наезд на говорящего на паузах между его словами: обычный → ближе →
 * обычный. Кадр тот же и в ту же секунду, звук не прерывается; чужих людей вместо говорящего не показываем.
 */
export async function punchIns(pub: string, plan: NewsPlan, clips: ClipInfo[], hooks: Hooks): Promise<void> {
  const byKey = new Map(clips.map((c) => [c.key, c]));
  const made: string[] = [];
  for (const seg of plan.segments) {
    if ("narr" in seg) continue;
    const key = "orig" in seg ? seg.orig : seg.dub;
    const clip = byKey.get(key);
    if (!clip || !plan.clips[key]) continue;
    const cuts = await frameCuts(path.join(pub, plan.clips[key].file), hooks.signal);
    const covers = seg.covers ?? [];
    const gaps = clip.transcript.words.slice(1).map((w, k) => (clip.transcript.words[k].e + w.s) / 2);
    for (const v of visible(seg.to - seg.from, covers)) {
      // планы внутри видимого места — между склейками ролика
      const marks = [seg.from + v.a, ...inside(cuts, seg.from + v.a, seg.from + v.b), seg.from + v.b];
      for (let k = 0; k + 1 < marks.length; k++) {
        const [a, b] = [marks[k], marks[k + 1]];
        if (b - a <= LONG_SHOT) continue;
        const n = Math.max(2, Math.round((b - a) / PART));
        const points: number[] = [];
        for (let j = 1; j < n; j++) {
          const target = a + ((b - a) * j) / n;
          const near = gaps.filter((g) => Math.abs(g - target) <= 1).sort((x, y) => Math.abs(x - target) - Math.abs(y - target))[0];
          const t = near ?? target;
          if (t - (points[points.length - 1] ?? a) >= MIN_PART && b - t >= MIN_PART) points.push(t);
        }
        const parts = [a, ...points, b];
        for (let j = 1; j + 1 < parts.length; j += 2) {
          const [pa, pb] = [parts[j], parts[j + 1]];
          const face = await faceAt(pub, plan, key, (pa + pb) / 2, hooks.signal);
          covers.push({ from: Number((pa - seg.from).toFixed(3)), to: Number((pb - seg.from).toFixed(3)), at: Number(pa.toFixed(3)), punch: PUNCH, ...(face ? { focusX: Math.round(face.x), focusY: Math.round(face.y) } : { focusY: 700 }) });
          made.push(`${key} ${pa.toFixed(1)}–${pb.toFixed(1)}`);
        }
      }
    }
    if (covers.length) seg.covers = covers.sort((x, y) => x.from - y.from);
  }
  if (made.length) hooks.log(`наезды на говорящего: ${made.join("; ")}`);
}

/** Короткие планы в готовом ролике (вспышки чужих кадров) — секунды; заставку и петлю не считаем. */
export async function flashes(file: string, total: number, signal?: AbortSignal): Promise<number[]> {
  const cuts = await frameCuts(file, signal);
  return cuts.filter((t, k) => k + 1 < cuts.length && cuts[k + 1] - t < 0.3 && t > 1.2 && t < total - 0.7);
}
