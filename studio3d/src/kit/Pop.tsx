import React, { useMemo } from "react";
import * as THREE from "three";
import { useCurrentFrame, useVideoConfig } from "remotion";
import { useInput } from "../input";
import { BLOCKY_EYE, BLOCKY_TOP } from "./Blocky";
import { currentShot, frameShot, type CastKinds, type Framing } from "./Camera";
import { HUMAN_EYE, HUMAN_TOP } from "./Human";
import { feet, keyPress, restSink } from "./ground";
import { popInk, popTexture, type PopIcon } from "./textures";
import { activeFor, actorPlace, actorYaw, type PopProps, type ShotProps, type Timeline, useTimeline } from "./timeline";
import { clamp, easeOut, smooth } from "./util";

/**
 * What the icon sits beside: the human's head with its hair, or the whole block, which is Claude's head. The icon's
 * centre is level with the temple, a little above the eyes (the owner, 2026-10-23: «должен быть в районе виска»);
 */
const HEAD = {
  human: { bottom: HUMAN_TOP - 0.56, top: HUMAN_TOP, temple: HUMAN_EYE + 0.07, width: 0.46, depth: 0.46 },
  blocky: { bottom: BLOCKY_TOP - 0.56, top: BLOCKY_TOP, temple: BLOCKY_EYE + 0.05, width: 0.9, depth: 0.5 },
};
/** World size of the icon; in the frame it stays between 7% and 15% of the width. */
const SIZE = 0.24;
const OVERSHOOT = 1.15;
/** How long a Pop shows by default, seconds. */
export const POP_SECONDS = 1.8;

/**
 * How high the head is above its resting place at time t: the feet's lift of a jump or a hop (ground.ts) with the key
 * springing back under them, and the lifts Human.tsx and Blocky.tsx draw for a shrug or a laugh — so a jump never
 * carries the head into its own icon. A block's tilt raises its top corner too.
 */
export const gestureLift = (timeline: Timeline, id: string, blocky: boolean, t: number): number => {
  const air = feet(timeline, id, blocky ? "blocky" : "human", t).lift;
  const [px, pz] = actorPlace(timeline, id, t);
  let y = air + restSink(px, pz) * (1 - keyPress(air));
  for (const { event, weight: w } of activeFor(timeline.acts, id, t)) {
    switch (event.do) {
      case "shrug":
        y += w * (blocky ? 0.03 : 0.025);
        break;
      case "laugh":
        y += w * (blocky ? 0.03 : 0.02);
        break;
      case "tilt":
      case "think":
        if (blocky) y += w * 0.45 * Math.sin(0.2);
        break;
      default:
        break;
    }
  }
  if (timeline.moves.some((m) => m.who === id && t >= m.from && t <= m.to)) y += 0.03;
  return Math.max(0, y);
};

/** The head on the screen (-1..1 both ways) for one camera: its box with the lift, its resting top, the projection. */
type Head = {
  x0: number;
  x1: number;
  /** the resting head's top */
  top: number;
  /** the resting temple's height */
  temple: number;
  /** the top at the highest lift */
  peak: number;
  u: number;
  depth: number;
  tanH: number;
  tanV: number;
  towardPartner: number;
  toWorld: (sx: number, sy: number) => THREE.Vector3;
};

const headOnScreen = (timeline: Timeline, framing: Framing, aspect: number, who: string, blocky: boolean, t: number, lift: number, round: boolean): Head | null => {
  const eye = new THREE.Vector3(...framing.eye);
  const forward = new THREE.Vector3(...framing.aim).sub(eye).normalize();
  const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
  const up = new THREE.Vector3().crossVectors(right, forward);
  const tanV = Math.tan((framing.fov * Math.PI) / 360);
  const tanH = tanV * aspect;
  const head = blocky ? HEAD.blocky : HEAD.human;
  const [x, z] = actorPlace(timeline, who, t);
  // the hero stands on his pressed key, a little lower than the key tops
  const ground = -restSink(x, z);
  const depth = new THREE.Vector3(x, ground + (head.top + head.bottom) / 2, z).sub(eye).dot(forward);
  if (depth < 0.5) return null;
  // A human's head turns on its own (Look), so it counts as the circle it can turn in; the block's face is its body,
  // a circle too while it turns away, shakes or spins during the icon.
  const yaw = actorYaw(timeline, who, t);
  const radius = Math.hypot(head.width, head.depth) / 2;
  const ring =
    blocky && !round
      ? [-1, 1].flatMap((sx) => [-1, 1].map((sz) => [(sx * head.width) / 2, (sz * head.depth) / 2]))
      : Array.from({ length: 24 }, (_, i) => [Math.cos((i * Math.PI) / 12) * radius, Math.sin((i * Math.PI) / 12) * radius]);
  const box = { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity, top: -Infinity };
  const heights: [number, boolean][] = [[ground + head.bottom, true], [ground + head.top, true], [ground + head.top + lift, false]];
  for (const [lx, lz] of ring) {
    for (const [y, resting] of heights) {
      const p = new THREE.Vector3(x + lx * Math.cos(yaw) + lz * Math.sin(yaw), y, z - lx * Math.sin(yaw) + lz * Math.cos(yaw)).sub(eye);
      const d = Math.max(0.05, p.dot(forward));
      const sx = p.dot(right) / (d * tanH);
      const sy = p.dot(up) / (d * tanV);
      box.x0 = Math.min(box.x0, sx);
      box.x1 = Math.max(box.x1, sx);
      box.y0 = Math.min(box.y0, sy);
      box.y1 = Math.max(box.y1, sy);
      if (resting) box.top = Math.max(box.top, sy);
    }
  }
  if (box.x1 < -1 || box.x0 > 1 || box.y1 < -1 || box.y0 > 1) return null;
  const templePoint = new THREE.Vector3(x, ground + head.temple, z).sub(eye);
  const temple = templePoint.dot(up) / (Math.max(0.05, templePoint.dot(forward)) * tanV);
  const partner = timeline.actors.find((a) => a.id !== who);
  const [px, pz] = partner ? actorPlace(timeline, partner.id, t) : [x + 1, z];
  return {
    x0: box.x0,
    x1: box.x1,
    top: box.top,
    temple,
    peak: box.y1,
    u: (box.x0 + box.x1) / 2,
    depth,
    tanH,
    tanV,
    towardPartner: new THREE.Vector3(px - x, 0, pz - z).dot(right) >= 0 ? 1 : -1,
    toWorld: (sx, sy) => eye.clone().addScaledVector(forward, depth).addScaledVector(right, sx * depth * tanH).addScaledVector(up, sy * depth * tanV),
  };
};

// Gaps are measured from the drawing's edge (popInk: a «!» is far narrower than its sprite), the frame edge from the sprite's.
const art = (h: Head, s: number, ink: number) => (ink * s * OVERSHOOT) / (h.depth * h.tanH);
const sprite = (h: Head, s: number) => (0.5 * s * OVERSHOOT) / (h.depth * h.tanH);
const spriteV = (h: Head, s: number) => (0.5 * s * OVERSHOOT) / (h.depth * h.tanV);
const gap = (h: Head, s: number) => (0.05 * s) / (h.depth * h.tanH);
const besideX = (h: Head, side: number, s: number, ink: number) => (side > 0 ? h.x1 + gap(h, s) + art(h, s, ink) : h.x0 - gap(h, s) - art(h, s, ink));
const besideY = (h: Head) => h.temple;

/** Beside the head on one side, or above its top corner when the actor fills the frame; the size in world units. */
type Plan = { beside: boolean; side: number; size: number; lift: number; round: boolean };

/**
 * Where an icon goes for the part of a pop that falls into one shot. It is chosen once, from every moment of that
 * part, so it never jumps across the frame while the camera pushes or orbits, and clear of the head's highest lift.
 * Beside the head, never on it (the owner: a skull sat on his head and looked pasted in), at the temple, on the side of
 * the frame centre; if the frame edge leaves no room there it shrinks, then tries the
 * other side, and only then sits above the head's corner.
 */
const planPop = (timeline: Timeline, cast: CastKinds, aspect: number, who: string, shot: ShotProps, from: number, to: number, ink: number): Plan | null => {
  const blocky = cast[who]?.kind === "blocky";
  const span = Math.max(0, to - from);
  let lift = 0;
  for (let k = 0; k <= Math.ceil(span * 60); k++) lift = Math.max(lift, gestureLift(timeline, who, blocky, Math.min(to, from + k / 60)));
  const during = (e: { who: string; from: number; to: number }) => e.who === who && e.from < to + 0.01 && e.to > from;
  const round =
    blocky &&
    (timeline.looks.some((l) => during(l) && (l.at === "away" || l.at === "camera")) || timeline.acts.some((a) => during(a) && (a.do === "shake" || a.do === "spin")));
  const heads: Head[] = [];
  for (let k = 0; k <= 8; k++) {
    const time = from + (span * k) / 8;
    const h = headOnScreen(timeline, frameShot(shot, timeline, cast, time), aspect, who, blocky, time, lift, round);
    if (h) heads.push(h);
  }
  if (!heads.length) return null;
  const first = heads[0];
  // sized at the shot's middle distance: a push or a pull changes it on the screen by a few per cent
  const hw = heads.map((h) => h.depth * h.tanH).sort((a, b) => a - b)[Math.floor(heads.length / 2)];
  const size = clamp(SIZE, 0.14 * hw, 0.3 * hw);
  // beside, it may shrink to a tenth of the frame width; smaller it is a speck at the frame edge
  const smallest = Math.min(size, 0.2 * hw);
  const centreSide = Math.abs(first.u) > 0.12 ? (first.u > 0 ? -1 : 1) : first.towardPartner;
  for (const side of [centreSide, -centreSide]) {
    for (let s = size; s >= smallest - 1e-6; s *= 0.92) {
      const fits = heads.every((h) => Math.abs(besideX(h, side, s, ink)) + sprite(h, s) <= 0.94 && Math.abs(besideY(h)) + spriteV(h, s) <= 0.97);
      if (fits) return { beside: true, side, size: s, lift, round };
    }
  }
  // Claude filling a close-up: above his top corner on the open side, clear of the block and of the face
  return { beside: false, side: Math.abs(first.u) > 0.12 ? -Math.sign(first.u) : centreSide, size: Math.min(size, 0.24 * hw), lift, round };
};

/**
 * Where the reaction icon `pop` stands at time t, and its world size; null when it is not showing or the actor is
 * out of the frame. The place is planned for the pop's part in the current shot and only re-projected per frame.
 */
export const placePop = (timeline: Timeline, cast: CastKinds, aspect: number, pop: PopProps, t: number): { pos: THREE.Vector3; size: number } | null => {
  const end = pop.at + (pop.for ?? POP_SECONDS);
  if (t < pop.at || t > end) return null;
  const shot = currentShot(timeline, t);
  const next = timeline.shots.find((s) => s.from > shot.from);
  const from = Math.max(pop.at, shot.from);
  const ink = popInk(pop.icon);
  const plan = planPop(timeline, cast, aspect, pop.who, shot, from, Math.max(from, Math.min(end, next ? next.from : end)), ink);
  if (!plan) return null;
  const blocky = cast[pop.who]?.kind === "blocky";
  const h = headOnScreen(timeline, frameShot(shot, timeline, cast, t), aspect, pop.who, blocky, t, plan.lift, plan.round);
  if (!h) return null;
  const s = plan.size;
  if (plan.beside) return { pos: h.toWorld(besideX(h, plan.side, s, ink), besideY(h)), size: s };
  const sx = clamp(plan.side > 0 ? h.x1 - sprite(h, s) : h.x0 + sprite(h, s), -0.94 + sprite(h, s), 0.94 - sprite(h, s));
  return { pos: h.toWorld(sx, h.peak + (0.12 * s + 0.4 * s * OVERSHOOT) / (h.depth * h.tanV)), size: s };
};

/** Draws every active Pop of the timeline; lives inside the 3D canvas. */
export const Pops: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const t = frame / fps;
  const timeline = useTimeline();
  const input = useInput();
  const cast: CastKinds = useMemo(() => Object.fromEntries(Object.entries(input.cast).map(([id, m]) => [id, { kind: m.kind }])), [input.cast]);
  const mats = useMemo(() => new Map<PopIcon, THREE.SpriteMaterial>(), []);
  return (
    <>
      {timeline.pops.map((p, i) => {
        const dur = p.for ?? POP_SECONDS;
        const local = t - p.at;
        if (local < 0 || local > dur) return null;
        const placed = placePop(timeline, cast, width / height, p, t);
        if (!placed) return null;
        let mat = mats.get(p.icon);
        if (!mat) {
          // drawn over everything: the reaction must never hide behind the block it belongs to
          mat = new THREE.SpriteMaterial({ map: popTexture(p.icon), transparent: true, depthWrite: false, depthTest: false, toneMapped: false });
          mats.set(p.icon, mat);
        }
        const grow = easeOut(local / 0.22);
        const overshoot = 1 + (OVERSHOOT - 1) * Math.sin(Math.min(1, local / 0.35) * Math.PI);
        const fade = smooth((dur - local) / 0.2);
        const s = placed.size * grow * overshoot * fade;
        const { x, y, z } = placed.pos;
        return <sprite key={i} material={mat} renderOrder={10} position={[x, y + 0.06 * placed.size * Math.sin(local * 6), z]} scale={[s, s, s]} />;
      })}
    </>
  );
};
