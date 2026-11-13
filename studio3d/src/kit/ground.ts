import { activeFor, type Timeline } from "./timeline";
import { clamp, smooth } from "./util";

/** How far a key goes down under a hero standing on it: a key is ≈ 18 mm, this is ≈ 3 mm of its travel. */
export const KEY_TRAVEL = 0.17;

/** Key pitch and the size of the key grid: x = (col − 7) · 1.12, z = (row − 2.5) · 1.12. */
export const KEY_PITCH = 1.12;
export const KEY_COLS = 15;
export const KEY_ROWS = 6;

export type BodyKind = "human" | "blocky";

/**
 * A jump in three beats: a crouch, the flight, a landing that gives in the knees. `lift` is the height of the feet,
 * `crouch` how much the legs bend (0..1). One curve for the body and for the key under it.
 */
export const jumpCurve = (p: number) => {
  const up = 0.16;
  const down = 0.84;
  if (p < up) return { lift: 0, crouch: Math.sin((Math.PI / 2) * (p / up)) };
  if (p > down) return { lift: 0, crouch: Math.sin(Math.PI * ((p - down) / (1 - down))) * 0.8 };
  const q = (p - up) / (down - up);
  return { lift: Math.sin(Math.PI * q), crouch: Math.max(0, 1 - q * 6) * 0.6 };
};

/** Hops of hop/bounce/cheer: the feet leave the key between the beats, the legs give at each touch. */
const hopCurve = (local: number, rate: number) => {
  const s = Math.abs(Math.sin(Math.PI * local * rate));
  return { lift: s, crouch: Math.pow(1 - s, 6) };
};

/** Peak heights of the airborne gestures per body, in key units. */
const HEIGHTS: Record<BodyKind, Partial<Record<string, number>>> = {
  blocky: { jump: 0.5, hop: 0.14, bounce: 0.09, cheer: 0.09, panic: 0.05 },
  human: { jump: 0.42, hop: 0.1, bounce: 0.1, cheer: 0.05 },
};
const RATES: Record<BodyKind, Partial<Record<string, number>>> = {
  blocky: { hop: 2.6, bounce: 2.2, cheer: 2.2, panic: 2.86 },
  human: { hop: 2.55, bounce: 2.55, cheer: 2.55 },
};

/**
 * Where an actor's feet are at time t: `lift` above the key tops (only while he is in the air — a jump and the
 * hops of hop/bounce/cheer) and how much his legs bend (`crouch`, 0..1, the push-off and the landing). The body
 * draws exactly this lift and the keyboard lets the key under him spring up for exactly that time: the key is down
 * while he stands on it, comes back when he takes off and goes down again when he lands.
 */
export const feet = (timeline: Timeline, id: string, kind: BodyKind, t: number) => {
  let lift = 0;
  let crouch = 0;
  for (const { event, weight: w, local } of activeFor(timeline.acts, id, t)) {
    const h = HEIGHTS[kind][event.do];
    if (!h) continue;
    const jump = event.do === "jump";
    const c = jump ? jumpCurve(clamp(local / Math.min(0.75, event.to - event.from))) : hopCurve(local, RATES[kind][event.do] ?? 2.5);
    // a jump starts and ends on the key by itself: its crouch must not fade in with the gesture
    const k = jump ? 1 : w;
    lift += k * h * c.lift;
    crouch = Math.max(crouch, k * c.crouch);
  }
  return { lift, crouch };
};

/** How far the key under a hero is down: all the way while he stands, back up as soon as his feet are in the air. */
export const keyPress = (lift: number) => 1 - smooth(lift / 0.05);

/** How far a hero standing at [x, z] sinks with the pressed key under him. */
export const restSink = (x: number, z: number) => KEY_TRAVEL * Math.max(0, ...keysUnder(x, z).map((k) => k.weight));

/** The key under a floor point and how squarely the point stands on it (1 in the middle, 0 at the gap). */
export const keysUnder = (x: number, z: number): { col: number; row: number; weight: number }[] => {
  const fc = x / KEY_PITCH + 7;
  const fr = z / KEY_PITCH + 2.5;
  const out: { col: number; row: number; weight: number }[] = [];
  for (const col of [Math.floor(fc), Math.ceil(fc)]) {
    for (const row of [Math.floor(fr), Math.ceil(fr)]) {
      if (col < 0 || col >= KEY_COLS || row < 0 || row >= KEY_ROWS) continue;
      // full while the point is over the cap's top, gone past the cap's edge
      const wx = 1 - smooth((Math.abs(fc - col) - 0.3) / 0.35);
      const wz = 1 - smooth((Math.abs(fr - row) - 0.3) / 0.35);
      const weight = wx * wz;
      if (weight > 0.001 && !out.some((k) => k.col === col && k.row === row)) out.push({ col, row, weight });
    }
  }
  return out;
};
