import React, { useMemo } from "react";
import * as THREE from "three";
import { ClaudeSolid as Solid, ClaudeFace, claudeMaterials } from "./ClaudeSculpt";
import { useActing } from "./acting";
import { useFraming } from "./Camera";
import { feet } from "./ground";
import { actorPlace, actorYaw, walking } from "./timeline";
import { Prop } from "./Props";
import { clamp, easeInOut, hash, smooth, wobble } from "./util";

const W = 0.9;
const H = 0.56;
const D = 0.5;
const LEG = 0.3;
/** A leg reaches 0.03 up into the block, so the joint never opens when it tips. */
const LEG_REST = LEG + 0.03;

/** Where the legs meet the block, under its four corners: [x, z]. */
const HIPS: [number, number][] = [[-0.32, 0.15], [0.32, 0.15], [-0.32, -0.15], [0.32, -0.15]];
/** Diagonal legs step together, like a trot. */
const PAIR = [0, 1, 1, 0];
const STEP_RATE = 16;
const DOWN = new THREE.Vector3(0, -1, 0);

/**
 * Now and then, while nothing else goes on, one front foot lifts and sets down again a little further:
 * a block shifting its weight. One every ~6.5 s, at moments that differ between videos.
 */
const fidget = (t: number) => {
  const period = 6.5;
  const k = Math.floor(t / period);
  const start = k * period + 1 + hash(k, 41) * (period - 2.5);
  const u = (t - start) / 0.5;
  if (u < 0 || u > 1) return null;
  return { leg: hash(k, 43) < 0.5 ? 0 : 1, lift: 0.045 * Math.sin(Math.PI * u), shift: 0.03 * smooth(u) };
};

/**
 * Claude: a sculpted orange clay block on four short legs with two stubby arms and a relief face.
 * Its body is its head — every emotion lives in the face and in how the block squashes and hops.
 * The feet stand on the key and the clay legs stretch between them and the block: they give under it before
 * a jump and on landing, trail behind in the air, step in pairs on a walk and spread when it sinks.
 */
export const Blocky: React.FC<{ id: string; color: string }> = ({ id, color }) => {
  const a = useActing(id);
  const framing = useFraming();
  const { side, leg, socket, lip } = useMemo(() => claudeMaterials(color), [color]);

  // ---- body motion: idle breathing and weight shift, talking squash, gestures on top
  let bob = 0.006 * Math.sin(a.t * Math.PI * 2 * 0.6);
  const shift = wobble(a.t * 0.25, 3);
  let x = 0.012 * shift;
  let pitch = 0;
  let roll = 0.016 * shift;
  let yaw = 0;
  let spin = 0;
  let squash = 1 + (a.talking ? 0.02 * a.open : 0);
  let armR = -0.15;
  let armL = 0.15;
  let legSpread = 0;
  const air = feet(a.timeline, id, "blocky", a.t);
  for (const { event, weight: w, local } of a.acts) {
    const dur = event.to - event.from;
    switch (event.do) {
      case "jump": {
        const p = clamp(local / Math.min(0.75, dur));
        squash *= 1 - 0.14 * w * air.crouch;
        legSpread += w * 0.4 * Math.sin(Math.PI * p);
        break;
      }
      case "hop":
      case "bounce":
      case "cheer": {
        const s = Math.abs(Math.sin(Math.PI * local * (event.do === "hop" ? 2.6 : 2.2)));
        squash *= 1 + w * 0.05 * (s - 0.5);
        if (event.do === "cheer") {
          armR = THREE.MathUtils.lerp(armR, -2.6 - 0.25 * Math.sin(local * 14), w);
          armL = THREE.MathUtils.lerp(armL, 2.6 + 0.25 * Math.sin(local * 14 + 1), w);
        }
        break;
      }
      case "shiver":
      case "panic":
        x += w * 0.018 * Math.sin(local * 85);
        roll += w * 0.03 * Math.sin(local * 61);
        if (event.do === "panic") {
          armR = THREE.MathUtils.lerp(armR, -2.3 - 0.4 * Math.sin(local * 20), w);
          armL = THREE.MathUtils.lerp(armL, 2.3 + 0.4 * Math.sin(local * 20 + 2), w);
        }
        break;
      case "wave":
      case "point":
        armR = THREE.MathUtils.lerp(armR, event.do === "wave" ? -2.3 - 0.45 * Math.sin(local * 11) : -1.55, w);
        break;
      case "nod":
        pitch += w * 0.16 * Math.sin(local * 10);
        break;
      case "shake":
        yaw += w * 0.28 * Math.sin(local * 12);
        break;
      case "tilt":
      case "think":
        roll += w * 0.2;
        break;
      case "spin":
        spin += Math.PI * 2 * easeInOut(clamp(local / Math.min(dur, 1.1)));
        break;
      case "sink":
      case "slump":
        squash *= 1 - 0.16 * w;
        pitch += 0.08 * w;
        bob -= 0.07 * w;
        legSpread += 0.3 * w;
        break;
      case "lean":
        pitch += 0.18 * w;
        break;
      case "shrug":
        armR = THREE.MathUtils.lerp(armR, -1.1, w);
        armL = THREE.MathUtils.lerp(armL, 1.1, w);
        bob += 0.03 * w;
        break;
      case "facepalm":
        armR = THREE.MathUtils.lerp(armR, -2.0, w);
        pitch += 0.12 * w;
        break;
      case "laugh":
        bob += w * 0.025 * Math.abs(Math.sin(local * 16));
        roll += w * 0.04 * Math.sin(local * 8);
        break;
      case "step":
        break;
      default:
        break;
    }
  }
  // the block is its own head: a Look turns and tips the whole body a little
  for (const { event, weight: w } of a.looks) {
    if (event.at === "down") pitch += 0.16 * w;
    else if (event.at === "up") pitch -= 0.14 * w;
    else if (event.at === "away") yaw += 0.65 * w * (actorYaw(a.timeline, id, a.t) > 0 ? -1 : 1);
    else if (event.at === "camera") {
      const [x, z] = actorPlace(a.timeline, id, a.t);
      const rel = Math.atan2(framing.eye[0] - x, framing.eye[2] - z) - actorYaw(a.timeline, id, a.t);
      yaw += 0.8 * w * Math.atan2(Math.sin(rel), Math.cos(rel));
    }
  }
  if (a.talking && !a.acts.length) bob += 0.006 * (a.open / 3);
  const walk = walking(a.timeline, id, a.t);
  const phase = a.t * STEP_RATE;
  if (walk) {
    bob += 0.02 * Math.abs(Math.sin(phase));
    pitch += 0.05;
  }
  const tap = !walk && !a.acts.length ? fidget(a.t) : null;

  // ---- legs: the feet stand on the key, the clay legs reach from the block's corners down to them
  // The block rests on its legs: lower when they give (crouch), higher by the lift while it is in the air.
  const bodyY = air.lift + LEG * (1 - 0.38 * air.crouch) + bob;
  const turn = new THREE.Euler(pitch, yaw, roll, "YXZ");
  const flying = smooth(air.lift / 0.06);
  // rising legs trail behind and spread, falling ones reach down for the key
  const rise = (feet(a.timeline, id, "blocky", a.t + 1 / 60).lift - feet(a.timeline, id, "blocky", a.t - 1 / 60).lift) * 30;
  const trail = clamp(rise * 0.12, -0.15, 0.35) * flying;
  const legs = HIPS.map(([hx, hz], i) => {
    const sq = 1 / Math.sqrt(squash);
    const hip = new THREE.Vector3(hx * sq, 0.03, hz * sq).applyEuler(turn).add(new THREE.Vector3(x, bodyY, 0));
    const step = walk ? Math.sin(phase + Math.PI * PAIR[i]) : 0;
    const out = 1 + legSpread * 0.25;
    const ground = new THREE.Vector3(
      hx * out,
      walk ? 0.05 * Math.max(0, step) : tap && tap.leg === i ? tap.lift : 0,
      hz + (walk ? 0.07 * Math.cos(phase + Math.PI * PAIR[i]) : tap && tap.leg === i ? tap.shift : 0),
    );
    // in the air a leg hangs at its own length from the hip, swung back while the block rises
    const hang = new THREE.Vector3(Math.sign(hx) * 0.03 * (1 + legSpread), -LEG_REST, 0).applyAxisAngle(new THREE.Vector3(1, 0, 0), trail).add(hip);
    const foot = ground.lerp(hang, flying);
    const span = foot.clone().sub(hip);
    const length = Math.max(0.05, span.length());
    const k = length / LEG_REST;
    // squeezed clay gets fatter, stretched clay thinner
    const fat = clamp(1 / Math.sqrt(k), 0.85, 1.25);
    const toeOut = Math.sign(hx) * 0.12;
    return { hip, foot, k, fat, aim: new THREE.Quaternion().setFromUnitVectors(DOWN, span.normalize()), toePitch: (trail + 0.25) * flying, toeOut };
  });

  return (
    <group rotation={[0, spin, 0]}>
      {legs.map((l, i) => (
        <React.Fragment key={i}>
          <group position={l.hip} quaternion={l.aim}>
            <group scale={[l.fat, l.k, l.fat]}>
              <Solid size={[0.116, LEG_REST, 0.118]} at={[0, -LEG_REST / 2, 0]} material={leg} radius={0.03} />
            </group>
          </group>
          <group position={l.foot} rotation={[l.toePitch, l.toeOut, 0]}>
            <Solid size={[0.138, 0.07, 0.166]} at={[0, 0.035, 0.023]} material={side} radius={0.024} />
            <Solid size={[0.13, 0.016, 0.158]} at={[0, 0.006, 0.023]} material={socket} radius={0.006} />
          </group>
        </React.Fragment>
      ))}
      <group position={[x, bodyY, 0]} rotation={[pitch, yaw, roll, "YXZ"]} scale={[1 / Math.sqrt(squash), squash, 1 / Math.sqrt(squash)]}>
        <Solid size={[W, H, D]} at={[0, H / 2, 0]} material={side} radius={0.052} />
        <ClaudeFace mood={a.mood} open={a.open} blink={a.blink} blush={a.blush} sweat={a.sweat} socket={socket} lip={lip} />
        {a.timeline.held
          .filter((p) => p.held === id && (p.from === undefined || a.t >= p.from) && (p.to === undefined || a.t <= p.to + 0.3))
          .map((p, i) => (
            <group key={i} position={[-(W / 2 + 0.2), H * 0.3, 0.12]}>
              <Prop {...p} inHand />
            </group>
          ))}
        {/* arms hang from the upper sides of the block */}
        <group position={[-W / 2 - 0.02, H * 0.62, 0.02]} rotation={[0, 0, armR]}>
          <Solid size={[0.119, 0.19, 0.146]} at={[-0.05, -0.08, 0]} material={side} radius={0.027} />
          {[-0.02, 0.016].map((f) => <Solid key={f} size={[0.005, 0.029, 0.003]} at={[-0.05 + f, -0.145, 0.073]} material={lip} radius={0.001} />)}
        </group>
        <group position={[W / 2 + 0.02, H * 0.62, 0.02]} rotation={[0, 0, armL]}>
          <Solid size={[0.119, 0.19, 0.146]} at={[0.05, -0.08, 0]} material={side} radius={0.027} />
          {[-0.016, 0.02].map((f) => <Solid key={f} size={[0.005, 0.029, 0.003]} at={[0.05 + f, -0.145, 0.073]} material={lip} radius={0.001} />)}
        </group>
      </group>
    </group>
  );
};

/** Height of the point the camera frames for a close shot of the block. */
export const BLOCKY_EYE = LEG + H * 0.55;
export const BLOCKY_TOP = LEG + H;
