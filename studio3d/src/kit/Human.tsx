import React, { useMemo } from "react";
import * as THREE from "three";
import type { HumanLook } from "../input";
import { useActing } from "./acting";
import { Prop } from "./Props";
import { useFraming } from "./Camera";
import { feet } from "./ground";
import { actorPlace, actorYaw, type Gesture } from "./timeline";
import { clothFront, clothPlain } from "./textures";
import { PortraitHead } from "./VoxelHead";
import { Sculpt, Seam, surfaceRelief } from "./Sculpt";
import { voxelSkinMaterial, voxelClothMaterial } from "./VoxelSurfaces";
import { clamp, easeInOut, wobble, type Vec3 } from "./util";

type Joint = "torso" | "head" | "shoulderR" | "shoulderL" | "elbowR" | "elbowL" | "hipR" | "hipL";
type Pose = Record<Joint, Vec3> & { lift: number; sway: number; spin: number };

const zero = (): Pose => ({
  torso: [0, 0, 0],
  head: [0, 0, 0],
  shoulderR: [0, 0, -0.07],
  shoulderL: [0, 0, 0.07],
  elbowR: [-0.12, 0, 0],
  elbowL: [-0.12, 0, 0],
  hipR: [0, 0, 0],
  hipL: [0, 0, 0],
  lift: 0,
  sway: 0,
  spin: 0,
});

/** Target pose of a gesture at `local` seconds into it; joints it does not name keep the idle pose. */
const gesturePose = (g: Gesture, local: number, dur: number): Partial<Pose> => {
  const s = (k: number, p = 0) => Math.sin(local * k + p);
  switch (g) {
    case "wave":
      return { shoulderR: [-0.25, 0, -2.45], elbowR: [0, 0, -0.5 + 0.45 * s(11)], head: [0, 0, 0.08] };
    case "shrug":
      return { shoulderR: [-0.3, 0, -0.5], shoulderL: [-0.3, 0, 0.5], elbowR: [-1.3, 0, -0.35], elbowL: [-1.3, 0, 0.35], head: [0, 0, 0.13], lift: 0.025 };
    case "facepalm":
      return { shoulderR: [-2.0, 0, 0.4], elbowR: [-1.15, 0, 0], head: [0.22, 0, 0], torso: [0.06, 0, 0] };
    case "scratch":
      return { shoulderR: [-0.2, 0, -2.2], elbowR: [0, 0, -1.9 + 0.14 * s(14)], head: [0.05, 0, -0.12] };
    case "panic":
      return { shoulderR: [-0.2, 0, -2.2], elbowR: [0, 0, -1.9], shoulderL: [-0.2, 0, 2.2], elbowL: [0, 0, 1.9], sway: 0.012 * s(70), head: [0, 0, 0.04 * s(23)] };
    case "point":
      return { shoulderR: [-1.45, 0, 0.12], elbowR: [-0.08, 0, 0], torso: [0, 0.1, 0] };
    case "cross":
      // forearms across the chest, the left one a little lower so the two never cut into each other
      return { shoulderR: [-0.5, 0, 0.3], shoulderL: [-0.5, 0, -0.3], elbowR: [-1.3, 0.2, 1.2], elbowL: [-1.4, -0.2, -1.2], head: [-0.06, 0, 0] };
    case "hips":
      return { shoulderR: [0.1, 0, -0.75], shoulderL: [0.1, 0, 0.75], elbowR: [0, 0, 1.7], elbowL: [0, 0, -1.7] };
    case "cheer":
      return { shoulderR: [0, 0, -2.7 + 0.15 * s(13)], shoulderL: [0, 0, 2.7 - 0.15 * s(13, 1)], elbowR: [0, 0, -0.2], elbowL: [0, 0, 0.2], head: [-0.15, 0, 0] };
    case "think":
      return { shoulderR: [-0.7, 0, 0.35], elbowR: [-2.2, 0, 0], head: [-0.1, 0.12, 0.1] };
    case "phone":
      return { shoulderR: [-0.5, 0, 0.25], elbowR: [-1.35, 0, 0], shoulderL: [-0.45, 0, -0.25], elbowL: [-1.25, 0, 0], head: [0.38, 0, 0] };
    case "nod":
      return { head: [0.2 * s(9), 0, 0] };
    case "shake":
      return { head: [0, 0.35 * s(11), 0] };
    case "laugh":
      return { torso: [-0.1, 0, 0], head: [-0.25, 0, 0.05 * s(7)], lift: 0.02 * Math.abs(s(14)), shoulderR: [-0.2, 0, -0.2], shoulderL: [-0.2, 0, 0.2] };
    case "lean":
      return { torso: [0.18, 0, 0], head: [-0.08, 0, 0] };
    case "slump":
    case "sink":
      return { torso: [0.12, 0, 0], head: [0.35, 0, 0], shoulderR: [-0.15, 0, -0.03], shoulderL: [-0.15, 0, 0.03], lift: -0.02 };
    case "jump": {
      const p = clamp(local / Math.min(0.75, dur));
      return { shoulderR: [0, 0, -1.2], shoulderL: [0, 0, 1.2], hipR: [-0.3 * Math.sin(Math.PI * p), 0, 0], hipL: [-0.3 * Math.sin(Math.PI * p), 0, 0] };
    }
    case "hop":
    case "bounce":
      // the hops themselves are the feet lift of ground.ts
      return {};
    case "shiver":
      return { sway: 0.012 * s(80), shoulderR: [-0.3, 0, 0.2], shoulderL: [-0.3, 0, -0.2], elbowR: [-1.6, 0, 0], elbowL: [-1.6, 0, 0] };
    case "tilt":
      return { head: [0, 0, 0.25] };
    case "spin":
      return { spin: Math.PI * 2 * easeInOut(clamp(local / Math.min(dur, 1.1))) };
    case "step":
      return {};
  }
};

const JOINTS: Joint[] = ["torso", "head", "shoulderR", "shoulderL", "elbowR", "elbowL", "hipR", "hipL"];

/** Joints move toward the gesture by its weight; lift, sway and spin add up. */
const blend = (base: Pose, target: Partial<Pose>, w: number) => {
  for (const j of JOINTS) {
    const v = target[j];
    if (!v) continue;
    const b = base[j];
    base[j] = [b[0] + (v[0] - b[0]) * w, b[1] + (v[1] - b[1]) * w, b[2] + (v[2] - b[2]) * w];
  }
  base.lift += (target.lift ?? 0) * w;
  base.sway += (target.sway ?? 0) * w;
  // a turn is not faded: weighting it would unwind the whole circle in the last 0.2 s
  base.spin += target.spin ?? 0;
};

const HIP = 0.86;
const TORSO_H = 0.6;
const HEAD = 0.4; // width and depth
 // a little taller than wide: the owner's long face

/**
 * The channel owner as a sculpted miniature. The look comes from cast.json; the director only moves him.
 * Body faces +z; the group is turned by the timeline toward the partner.
 */
export const Human: React.FC<{ id: string; look: HumanLook }> = ({ id, look }) => {
  const a = useActing(id);
  const framing = useFraming();
  const mats = useMemo(() => {
    const cloth = voxelClothMaterial(clothPlain(look));
    const skin = voxelSkinMaterial(look.skin);
    const pants = new THREE.MeshStandardMaterial({ color: look.pants, roughness: 0.94, bumpMap: surfaceRelief("denim"), bumpScale: 0.004 });
    const shoes = new THREE.MeshStandardMaterial({ color: look.shoes, roughness: 0.72, bumpMap: surfaceRelief("rubber"), bumpScale: 0.002 });
    const sole = new THREE.MeshStandardMaterial({ color: "#d8d6cc", roughness: 0.95, bumpMap: surfaceRelief("rubber"), bumpScale: 0.002 });
    const chest = voxelClothMaterial(clothFront({ ...look, chain: false }));
    const trim = new THREE.MeshStandardMaterial({ color: look.stripes ?? "#b9b6b0", roughness: 0.9 });
    const gold = new THREE.MeshStandardMaterial({ color: "#d9b75d", metalness: 0.7, roughness: 0.29 });
    const stitch = new THREE.MeshStandardMaterial({ color: new THREE.Color(look.pants).lerp(new THREE.Color("#9da2b3"), 0.3), roughness: 0.97 });
    return {
      cloth,
      skin,
      pants,
      shoes,
      sole, trim, gold, stitch,
      torso: [cloth, cloth, cloth, cloth, chest, cloth],
      sleeve: look.topKind === "tee" || look.topKind === "jersey" ? skin : cloth,
    };
  }, [look]);

  const lookShift = (() => {
    const l = a.looks[a.looks.length - 1];
    if (!l) return 0;
    return l.event.at === "away" ? -1 : 0;
  })();

  // ---- pose: idle → talk beats → gestures
  const pose = zero();
  // standing still with only breath and a slow look around: motion is for gestures that mean something
  pose.torso = [0.006 * Math.sin(a.t * 1.7), 0.015 * wobble(a.t * 0.3, 1), 0];
  pose.head = [0.012 * wobble(a.t * 0.4, 2), 0.035 * wobble(a.t * 0.25, 4), 0.008 * wobble(a.t * 0.35, 5)];
  const armsBusy = a.acts.some(({ event, weight }) => weight > 0.3 && ["wave", "shrug", "facepalm", "scratch", "panic", "point", "cross", "hips", "cheer", "think", "phone", "shiver"].includes(event.do));
  if (a.talking && !armsBusy) {
    // a calm speaking hand: the forearm rises a little and moves slowly, the other arm rests
    pose.shoulderR = [-0.2, 0, -0.1];
    pose.elbowR = [-0.55 - 0.1 * wobble(a.t * 1.6, 7), 0, 0];
    pose.shoulderL = [-0.06, 0, 0.08];
    pose.elbowL = [-0.2, 0, 0];
    pose.head[0] += 0.015 * wobble(a.t * 2.2, 8);
  }
  for (const { event, weight, local } of a.acts) blend(pose, gesturePose(event.do, local, event.to - event.from), weight);
  // head turns toward whoever it looks at
  for (const { event, weight } of a.looks) {
    const target: Vec3 =
      event.at === "down" ? [0.35, 0, 0] : event.at === "up" ? [-0.35, 0, 0] : event.at === "away" ? [0, -0.7, 0] : event.at === "camera" ? (() => {
            // toward the lens of this shot, not toward the world front
            const [x, z] = actorPlace(a.timeline, id, a.t);
            const rel = Math.atan2(framing.eye[0] - x, framing.eye[2] - z) - actorYaw(a.timeline, id, a.t);
            return [0.02, Math.max(-1, Math.min(1, Math.atan2(Math.sin(rel), Math.cos(rel)))), 0] as Vec3;
          })() : (() => {
        const [x, z] = actorPlace(a.timeline, id, a.t);
        const [ox, oz] = actorPlace(a.timeline, event.at, a.t);
        const rel = Math.atan2(ox - x, oz - z) - actorYaw(a.timeline, id, a.t);
        return [0.05, Math.max(-1, Math.min(1, rel)), 0] as Vec3;
      })();
    blend(pose, { head: target }, weight);
  }
  const walk = a.timeline.moves.some((m) => m.who === id && a.t >= m.from && a.t <= m.to);
  if (walk) {
    const sw = Math.sin(a.t * 9);
    pose.hipR = [0.5 * sw, 0, 0];
    pose.hipL = [-0.5 * sw, 0, 0];
    if (!armsBusy) {
      pose.shoulderR = [-0.4 * sw, 0, -0.08];
      pose.shoulderL = [0.4 * sw, 0, 0.08];
    }
    pose.lift += 0.025 * Math.abs(sw);
  }
  // a jump and the hops leave the key (ground.ts); the push-off and the landing give in the knees
  const air = feet(a.timeline, id, "human", a.t);
  pose.lift += air.lift;
  const ks = look.height ? look.height / 1.9 : 1;
  const sleeve = mats.sleeve;

  const inHand = a.timeline.held.filter((p) => p.held === id && (p.from === undefined || a.t >= p.from) && (p.to === undefined || a.t <= p.to + 0.3));
  const arm = (sideSign: -1 | 1, shoulder: Vec3, elbow: Vec3, hold?: React.ReactNode) => (
    <group position={[sideSign * 0.33, TORSO_H - 0.05, 0]} rotation={shoulder}>
      <Sculpt position={[0, -0.12, 0]} size={[0.17, 0.27, 0.19]} radius={0.018} material={mats.cloth} taper={0.1} />
      {look.topKind === "tee" || look.topKind === "jersey" ? <Sculpt position={[0, -0.245, 0]} size={[0.173, 0.025, 0.194]} radius={0.008} material={mats.trim} /> : null}
      <group position={[0, -0.3, 0]} rotation={elbow}>
        <Sculpt position={[0, -0.12, 0]} size={[0.13, 0.28, 0.145]} radius={0.016} material={sleeve} taper={-0.12} />
        <Sculpt position={[0, -0.29, 0.005]} size={[0.13, 0.13, 0.15]} radius={0.015} material={mats.skin} />
        <Sculpt position={[-sideSign * 0.064, -0.273, 0.04]} rotation={[0.25, 0, sideSign * 0.35]} size={[0.044, 0.075, 0.055]} radius={0.008} material={mats.skin} />
        {/* a held prop stands upright when the forearm points forward */}
        {hold ? <group position={[0, -0.36, 0.05]} rotation={[Math.PI / 2, 0, 0]}>{hold}</group> : null}
      </group>
    </group>
  );

  const leg = (sideSign: -1 | 1, hip: Vec3) => (
    <group position={[sideSign * 0.12, HIP, 0]} rotation={hip}>
      <Sculpt position={[0, -0.38, 0]} size={[0.215, 0.77, 0.235]} radius={0.018} material={mats.pants} taper={-0.12} />
      <Seam points={[[sideSign * 0.103, -0.06, 0.035], [sideSign * 0.108, -0.37, 0.04], [sideSign * 0.116, -0.71, 0.035]]} radius={0.002} material={mats.stitch} />
      <Sculpt position={[0, -0.72, 0]} size={[0.226, 0.05, 0.24]} radius={0.012} material={mats.pants} />
      <Sculpt position={[0, -0.795, 0.039]} size={[0.23, 0.12, 0.32]} radius={0.018} material={mats.shoes} />
      <Sculpt position={[0, -0.844, 0.042]} size={[0.235, 0.032, 0.329]} radius={0.012} material={mats.sole} />
      {[0, 1, 2].map((i) => <Seam key={i} points={[[-0.058, -0.737, 0.025 + i * 0.036], [0, -0.73, 0.034 + i * 0.036], [0.058, -0.737, 0.025 + i * 0.036]]} radius={0.0045} material={mats.sole} />)}
    </group>
  );

  return (
    <group scale={[ks, ks * (1 - 0.06 * air.crouch), ks]} position={[pose.sway, Math.max(-0.03, pose.lift), 0]} rotation={[0, pose.spin, 0]}>
      {leg(-1, pose.hipR)}
      {leg(1, pose.hipL)}
      <group position={[0, HIP, 0]} rotation={pose.torso}>
        <Sculpt position={[0, TORSO_H / 2, 0]} size={[0.54, TORSO_H, 0.3]} radius={0.022} material={mats.torso} taper={0.15} />
        <Sculpt position={[0, 0.035, 0]} size={[0.473, 0.035, 0.307]} radius={0.012} material={mats.cloth} />
        <Seam points={[[-0.19, 0.55, 0.151], [-0.24, 0.48, 0.151], [-0.237, 0.19, 0.15]]} radius={0.002} material={mats.trim} />
        <Seam points={[[0.19, 0.55, 0.151], [0.24, 0.48, 0.151], [0.237, 0.19, 0.15]]} radius={0.002} material={mats.trim} />
        {look.topKind === "jersey" || look.topKind === "shirt" ? [0.10, 0.20, 0.30, 0.40].map((y) => <Sculpt key={y} position={[0, y, 0.155]} size={[0.013, 0.013, 0.006]} radius={0.004} material={mats.sole} />) : null}
        {look.chain ? <Seam points={[[-0.108, 0.59, 0.04], [-0.12, 0.54, 0.14], [-0.075, 0.465, 0.16], [0, 0.44, 0.164], [0.075, 0.465, 0.16], [0.12, 0.54, 0.14], [0.108, 0.59, 0.04]]} radius={0.006} material={mats.gold} /> : null}
        {look.topKind === "hoodie" ? (
          <Sculpt position={[0, TORSO_H - 0.02, -0.16]} size={[0.42, 0.16, 0.14]} radius={0.06} material={mats.cloth} />
        ) : null}
        {arm(-1, pose.shoulderR, pose.elbowR, inHand.map((p, i) => <Prop key={i} {...p} inHand />))}
        {arm(1, pose.shoulderL, pose.elbowL)}
        <group position={[0, TORSO_H, 0]} rotation={pose.head}>
          <PortraitHead look={look} mood={a.mood} open={a.open} blink={a.blink} lookShift={lookShift} blush={a.blush} sweat={a.sweat} />
        </group>
      </group>
    </group>
  );
};

/** Height of the eyes and of the head top, used to frame shots. */
export const HUMAN_EYE = HIP + TORSO_H + 0.309;
export const HUMAN_TOP = HIP + TORSO_H + 0.54;
