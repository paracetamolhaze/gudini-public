import React, { useLayoutEffect } from "react";
import * as THREE from "three";
import { useThree } from "@react-three/fiber";
import { useCurrentFrame, useVideoConfig } from "remotion";
import { useInput } from "../input";
import { BLOCKY_EYE } from "./Blocky";
import { HUMAN_EYE } from "./Human";
import { actorPlace, faceSide, soloAzimuth, useTimeline, type ShotKind, type ShotProps, type Timeline } from "./timeline";
import { clamp, easeInOut, easeOut, lerp, wobble, type Vec3 } from "./util";

export type Framing = { eye: Vec3; aim: Vec3; fov: number };
export type CastKinds = Record<string, { kind: "human" | "blocky" }>;

const eyeHeight = (kind: "human" | "blocky") => (kind === "human" ? HUMAN_EYE : BLOCKY_EYE);

/** What a single shot shows: its size and, for Claude, his backdrop ("face": head-on against the PC, "": his chat). */
export type Picture = { on: string; kind: ShotKind; side: "face" | "" };

/**
 * The picture a shot draws once the kit's remapping is applied: the owner has one camera side, so his side is
 * ignored and an over-the-shoulder is his close-up; Claude has his chat and, from his face side, the PC, and an
 * over is that PC close-up. Director/validate.ts teaches the same pictures.
 */
const ownPicture = (shot: ShotProps, timeline: Timeline, cast: CastKinds): Picture => {
  const single = cast[shot.on];
  if (!single) return { on: shot.on, kind: shot.kind, side: "" };
  const over = shot.kind === "over";
  const kind = over ? "close" : shot.kind;
  if (single.kind === "human") return { on: shot.on, kind, side: "" };
  return { on: shot.on, kind, side: over || shot.side === faceSide(timeline, shot.on, shot.from) ? "face" : "" };
};

/** The other size of the same angle, for a shot that repeats the picture of the one before it. */
const NEXT_SIZE: Partial<Record<ShotKind, ShotKind>> = { close: "medium", medium: "close", wide: "medium", low: "close", high: "close" };

/**
 * The picture of a shot within its scene. Two shots in a row on one hero with the same picture are one picture
 * cut in two: the camera jumps a few per cent at the cut (old scenes have such pairs since the owner's sides and
 * the over-the-shoulder were redrawn). The second one then takes the other size of the same angle.
 */
export const shotPicture = (shot: ShotProps, timeline: Timeline, cast: CastKinds): Picture => {
  let prev: Picture | null = null;
  for (const s of timeline.shots) {
    const pic = ownPicture(s, timeline, cast);
    if (prev && cast[pic.on] && prev.on === pic.on && prev.kind === pic.kind && prev.side === pic.side) pic.kind = NEXT_SIZE[pic.kind] ?? pic.kind;
    if (s === shot) return pic;
    prev = pic;
  }
  return ownPicture(shot, timeline, cast);
};

/**
 * The owner sits off centre, on the side away from his backdrop, the vertical screen, so the screen fills the
 * background instead of the bare wall beside it (degrees of the camera's turn off his body, measured in
 * director/shots.test.ts). His right hand is on that side of the frame: the medium, the shot for a gesture or a
 * held prop, stands farther and less off centre, so the whole arm with the prop stays in the picture.
 */
const OWNER_THIRD: Partial<Record<ShotKind, number>> = { close: 5, medium: 3, wide: 5, low: 5, high: 5 };

/** The opening shot of the whole desk: what it looks at, from how far and how high (radians), and its lens. */
export const DESK_VIEW = { focus: [-5, 3, -8] as Vec3, distance: 46, elevation: 0.66, fov: 68 };

/**
 * Where the camera stands and looks for a shot at time t. Shots are cut, never blended:
 * the move inside a shot (push, orbit…) is what keeps the picture alive, like in the reference.
 * Actors' rest turn (not their walking turn) places the camera, so a step never swings the shot.
 */
export const frameShot = (shot: ShotProps, timeline: Timeline, cast: CastKinds, t: number): Framing => {
  const p = clamp((t - shot.from) / Math.max(0.1, shot.to - shot.from));
  const ids = timeline.actors.map((a) => a.id);
  const target = shot.on === "both" || shot.on === "world" || !cast[shot.on] ? null : shot.on;
  const kindOf = (id: string) => cast[id]?.kind ?? "human";
  const mid = (() => {
    const pts = ids.map((id) => actorPlace(timeline, id, t));
    const x = pts.reduce((s, q) => s + q[0], 0) / Math.max(1, pts.length);
    const z = pts.reduce((s, q) => s + q[1], 0) / Math.max(1, pts.length);
    return [x, z] as [number, number];
  })();

  let focus: Vec3;
  let azimuth: number;
  let dist: number;
  let height: number;
  let fov = 42;
  let aimShift: [number, number] = [0, 0];
  if (target) {
    const [x, z] = actorPlace(timeline, target, t);
    const kind = kindOf(target);
    const eye = eyeHeight(kind);
    focus = [x, eye, z];
    // The side is a backdrop that keeps the face readable (soloAzimuth). An over-the-shoulder looks along the
    // line between the heroes, at the bare left wall or the room's open side, so it is drawn as a close-up:
    // the owner's from his one side, Claude's from his face side against the PC, where the old over looked.
    const pic = shotPicture(shot, timeline, cast);
    azimuth = soloAzimuth(timeline, target, t, kind, pic.side === "face" ? faceSide(timeline, target, t) : undefined);
    const human = kind === "human";
    switch (pic.kind) {
      case "close":
        dist = human ? 2.7 : 3.4;
        height = eye + (human ? 0.02 : 0.12);
        break;
      case "medium":
        // the owner's medium keeps his whole right arm with a held prop in the frame (OWNER_THIRD)
        dist = human ? 4.4 : 4.1;
        height = eye - (human ? 0.12 : -0.1);
        break;
      case "low":
        dist = human ? 3.1 : 2.8;
        height = human ? 0.45 : 0.15;
        fov = 46;
        break;
      case "high":
        dist = human ? 3.4 : 3.0;
        height = eye + 2.2;
        break;
      default:
        dist = human ? 5.6 : 5.2;
        height = eye + 0.5;
    }
    if (human) {
      // the owner on the third of the frame away from his backdrop (OWNER_THIRD); his reaction icon has the open side
      const k = Math.sign(azimuth) * dist * Math.tan(((OWNER_THIRD[pic.kind] ?? 5) * Math.PI) / 180);
      aimShift = [Math.cos(azimuth) * k, -Math.sin(azimuth) * k];
    }
  } else {
    const kinds = ids.map(kindOf);
    const top = kinds.includes("human") ? HUMAN_EYE : BLOCKY_EYE;
    focus = [mid[0], top * 0.62, mid[1]];
    // the two-shot is taken from the front: from a side one of the heroes, looking at the other, turns his back
    azimuth = 0;
    const spread = ids.length > 1 ? Math.abs(actorPlace(timeline, ids[0], t)[0] - actorPlace(timeline, ids[1], t)[0]) : 1;
    switch (shot.on === "world" ? "tiny" : shot.kind) {
      case "desk":
        // the opening (the owner, 2026-10-23): from the chair, high, the whole desk — both heroes on the keyboard,
        // both monitors on their arm — so every close-up after it is understood as this room
        focus = [DESK_VIEW.focus[0], DESK_VIEW.focus[1], DESK_VIEW.focus[2]];
        azimuth = 0;
        dist = DESK_VIEW.distance * Math.cos(DESK_VIEW.elevation);
        height = DESK_VIEW.focus[1] + DESK_VIEW.distance * Math.sin(DESK_VIEW.elevation);
        fov = DESK_VIEW.fov;
        break;
      case "tiny":
        focus = [0, 24, -12];
        azimuth = 0.16;
        dist = 150;
        height = 55;
        fov = 60;
        break;
      case "high":
        dist = 8 + spread;
        height = 6;
        break;
      case "low":
        // as far as the two-shot: both heroes with their arms fit the narrow portrait frame
        dist = 5.2 + spread * 1.9;
        height = 0.4;
        fov = 46;
        break;
      default:
        // Portrait video needs enough horizontal field of view for both
        // miniatures, including their arms, at the fixed keyboard positions.
        dist = 5.2 + spread * 1.9;
        // a camera at the monitor's lower edge looking almost level: the heroes stand on the lower third, the key tops
        // reach the bottom edge of the frame instead of the case and the dark desk, the monitor fills the top
        height = 4.2;
        focus = [focus[0], 3.85, focus[2]];
    }
  }

  // ---- the move inside the shot
  const e = easeInOut(p);
  switch (shot.move) {
    case "push":
      dist *= lerp(1.06, 0.95, e);
      break;
    case "pull":
      dist *= lerp(0.95, 1.07, e);
      break;
    case "orbit":
      // on one hero a gentle arc: a wider one leaves the face cone or the backdrop
      azimuth += lerp(-1, 1, e) * (target ? 0.05 : 0.12);
      break;
    case "rise":
      height += lerp(-0.18, 0.15, e);
      break;
    case "whip": {
      const snap = 1 - easeOut(Math.min(1, (t - shot.from) / 0.35));
      // on one hero a snap zoom: a swing would pass his profile or the bare wall
      if (target) dist *= 1 + 0.35 * snap;
      else azimuth += 0.9 * snap;
      break;
    }
    default:
      dist *= lerp(1.02, 0.98, e);
  }
  // the key tops are at y = 0: a low shot that rises must start above them
  height = Math.max(0.14, height);
  const shake = shot.move === "shake" ? Math.max(0, 1 - (t - shot.from) / 0.5) * 0.03 : 0;
  const hand = 0.004;
  const eye: Vec3 = [
    focus[0] + Math.sin(azimuth) * dist + wobble(t * 0.8, 11) * hand + wobble(t * 30, 3) * shake,
    height + wobble(t * 0.7, 12) * hand + wobble(t * 29, 4) * shake,
    focus[2] + Math.cos(azimuth) * dist,
  ];
  // look a bit above the face so the actor sits low and the screens behind stay in the shot
  const aim: Vec3 = [focus[0] + aimShift[0], focus[1] + (target ? 0.16 : 0.25), focus[2] + aimShift[1]];
  return { eye, aim, fov };
};

/** The shot in force at time t: the latest started one, or the nearest before a gap. */
export const currentShot = (timeline: Timeline, t: number): ShotProps =>
  timeline.shots.filter((s) => t >= s.from && t < s.to).pop() ??
  [...timeline.shots].reverse().find((s) => s.from <= t) ??
  timeline.shots[0] ?? { from: 0, to: 1, on: "both", kind: "wide" };

/** The camera of the current frame, for anything that has to face it or stay inside the picture. */
export const useFraming = (): Framing => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const timeline = useTimeline();
  const input = useInput();
  const t = frame / fps;
  const cast: CastKinds = Object.fromEntries(Object.entries(input.cast).map(([id, m]) => [id, { kind: m.kind }]));
  return frameShot(currentShot(timeline, t), timeline, cast, t);
};

/** Drives the default camera from the director's shots every frame. */
export const CameraRig: React.FC = () => {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const f = useFraming();
  useLayoutEffect(() => {
    camera.position.set(...f.eye);
    camera.fov = f.fov;
    camera.near = Math.max(0.05, Math.min(0.8, Math.hypot(f.eye[0] - f.aim[0], f.eye[1] - f.aim[1], f.eye[2] - f.aim[2]) * 0.005));
    camera.far = 800;
    camera.updateProjectionMatrix();
    camera.lookAt(...f.aim);
  });
  // A soft light riding with the camera, slightly above it: whoever the shot is on, the face reads.
  return <pointLight position={[f.eye[0], f.eye[1] + 0.8, f.eye[2]]} color="#ffe9d6" intensity={0.9} decay={0} />;
};
