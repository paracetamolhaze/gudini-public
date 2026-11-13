import React, { useMemo } from "react";
import type {} from "@react-three/fiber";
import * as THREE from "three";
import type { HumanLook } from "../input";
import type { Mood } from "./timeline";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { roundedShape } from "./Sculpt";

type V3 = [number, number, number];
type HeadProps = { look: HumanLook; mood: Mood; open: number; blink: boolean; lookShift: number; blush: boolean; sweat: boolean };
type Hole = { x0: number; x1: number; y0: number; y1: number };
const clamp = (n: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, n));
const hash = (x: number, y: number, seed: number) => { const v = Math.sin(x * 127.1 + y * 311.7 + seed * 71.17) * 43758.5453; return v - Math.floor(v); };
const FACE = .151;
const EYE_X = .091;
const EYE_Y = .307;
const EYE_W = .091;
const EYE_H = .062;
const HEAD_CENTER: V3 = [0, .264, -.005];
const eyeHoles: Hole[] = [-1, 1].map((side) => ({ x0: side * EYE_X - .048, x1: side * EYE_X + .048, y0: EYE_Y - .034 - HEAD_CENTER[1], y1: EYE_Y + .034 - HEAD_CENTER[1] }));

/** One portable mesh combines broad planar colour tiles with small true
 * chamfers. The colour variation is procedural; no reference pixels or map. */
function tiledBlock(w: number, h: number, d: number, radius: number, base: THREE.Color, seed: number, holes: Hole[] = []) {
  // Chamfers here span 1-4 px even in a close-up, so a one-segment arc keeps them at a third of the triangles.
  const source = roundedShape(w, h, d, radius, 1);
  const bevel = source.index ? source.toNonIndexed() : source;
  if (bevel !== source) source.dispose();
  const bp = bevel.getAttribute("position"), bn = bevel.getAttribute("normal"), buv = bevel.getAttribute("uv");
  const p: number[] = [], n: number[] = [], c: number[] = [], uv: number[] = [];
  const color = (x: number, y: number, face: number) => base.clone().multiplyScalar(.94 + hash(Math.floor(x * 38), Math.floor(y * 38), seed + face * 17) * .12);
  const vertex = (pt: THREE.Vector3, normal: THREE.Vector3, rgb: THREE.Color, u = 0, v = 0) => { p.push(pt.x, pt.y, pt.z); n.push(normal.x, normal.y, normal.z); c.push(rgb.r, rgb.g, rgb.b); uv.push(u, v); };
  // Preserve the small rounded bevels, replace each broad plane with tiles.
  for (let i = 0; i < bp.count; i += 3) {
    const flat = [0, 1, 2].some((axis) => [0, 1, 2].every((j) => Math.abs(bn.getComponent(i + j, axis)) > .9999));
    if (flat) continue;
    for (let j = 0; j < 3; j++) vertex(new THREE.Vector3().fromBufferAttribute(bp, i + j), new THREE.Vector3().fromBufferAttribute(bn, i + j), base, buv.getX(i + j), buv.getY(i + j));
  }
  const faces: { normal: V3; s: V3; t: V3; width: number; height: number; depth: number; holes?: Hole[] }[] = [
    { normal: [0, 0, 1], s: [1, 0, 0], t: [0, 1, 0], width: w, height: h, depth: d, holes },
    { normal: [0, 0, -1], s: [-1, 0, 0], t: [0, 1, 0], width: w, height: h, depth: d },
    { normal: [1, 0, 0], s: [0, 0, -1], t: [0, 1, 0], width: d, height: h, depth: w },
    { normal: [-1, 0, 0], s: [0, 0, 1], t: [0, 1, 0], width: d, height: h, depth: w },
    { normal: [0, 1, 0], s: [1, 0, 0], t: [0, 0, -1], width: w, height: d, depth: h },
    { normal: [0, -1, 0], s: [1, 0, 0], t: [0, 0, 1], width: w, height: d, depth: h },
  ];
  faces.forEach((face, f) => {
    const normal = new THREE.Vector3(...face.normal), s = new THREE.Vector3(...face.s), t = new THREE.Vector3(...face.t), center = normal.clone().multiplyScalar(face.depth / 2);
    const ww = face.width - radius * 2, hh = face.height - radius * 2;
    const nx = Math.max(1, Math.round(ww / .026)), ny = Math.max(1, Math.round(hh / .026));
    const xx = Array.from({ length: nx + 1 }, (_, i) => -ww / 2 + ww * i / nx);
    const yy = Array.from({ length: ny + 1 }, (_, i) => -hh / 2 + hh * i / ny);
    for (const hole of face.holes ?? []) { xx.push(hole.x0, hole.x1); yy.push(hole.y0, hole.y1); }
    const xs = [...new Set(xx)].filter((x) => x >= -ww / 2 && x <= ww / 2).sort((a, b) => a - b), ys = [...new Set(yy)].filter((y) => y >= -hh / 2 && y <= hh / 2).sort((a, b) => a - b);
    for (let iy = 0; iy < ys.length - 1; iy++) for (let ix = 0; ix < xs.length - 1; ix++) {
      const x0 = xs[ix], x1 = xs[ix + 1], y0 = ys[iy], y1 = ys[iy + 1], mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
      if ((face.holes ?? []).some((hole) => mx > hole.x0 && mx < hole.x1 && my > hole.y0 && my < hole.y1)) continue;
      const rgb = color(mx, my, f), corners = [[x0, y0], [x1, y0], [x0, y1], [x1, y1]];
      for (const k of [0, 1, 2, 2, 1, 3]) {
        const [x, y] = corners[k], pt = center.clone().addScaledVector(s, x).addScaledVector(t, y);
        vertex(pt, normal, rgb, x / face.width + .5, y / face.height + .5);
      }
    }
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(p, 3)); geometry.setAttribute("normal", new THREE.Float32BufferAttribute(n, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(c, 3)); geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  geometry.computeBoundingBox(); geometry.computeBoundingSphere(); bevel.dispose(); return geometry;
}

const colorMaterial = new THREE.MeshStandardMaterial({ color: "#ffffff", vertexColors: true, roughness: .78, metalness: 0 });
// Shared by every frame and both heads: a blink or a mood swaps between a few cached blocks
// instead of uploading a new geometry to the GPU each time and never freeing the old one.
const blocks = new Map<string, THREE.BufferGeometry>();
const cached = (key: string, make: () => THREE.BufferGeometry) => {
  let geometry = blocks.get(key);
  if (!geometry) blocks.set(key, geometry = make());
  return geometry;
};
const Voxel: React.FC<{ size: V3; at: V3; color: THREE.Color; bevel?: number; seed?: number; rotation?: V3; holes?: Hole[]; name?: string }> = ({ size, at, color, bevel = .0016, seed = 0, rotation, holes, name }) => {
  const geometry = cached(`v/${size.join("/")}/${bevel}/${color.getHexString()}/${seed}/${holes === eyeHoles ? "eyes" : JSON.stringify(holes ?? [])}`, () => tiledBlock(...size, bevel, color, seed, holes));
  return <mesh name={name} geometry={geometry} position={at} rotation={rotation} material={colorMaterial} castShadow receiveShadow />;
};
const Solid: React.FC<{ size: V3; at: V3; material: THREE.Material; bevel?: number; rotation?: V3; name?: string; scale?: V3 }> = ({ size, at, material, bevel = .001, rotation, name, scale }) => {
  const geometry = cached(`s/${size.join("/")}/${bevel}`, () => roundedShape(...size, bevel, 1));
  return <mesh name={name} geometry={geometry} position={at} rotation={rotation} scale={scale} material={material} castShadow receiveShadow />;
};

type Part = { size: V3; at: V3; color: THREE.Color; bevel: number; seed: number; holes?: Hole[] };
const partKey = (p: Part) => `${p.size.join("/")}@${p.at.join("/")}/${p.bevel}/${p.color.getHexString()}/${p.seed}/${p.holes === eyeHoles ? "eyes" : JSON.stringify(p.holes ?? [])}`;
/** Blocks that never move against each other are one mesh: the haircut alone is ~80 blocks,
 * and each separate block costs the software renderer a draw call in two passes. */
const Merged: React.FC<{ parts: Part[]; name?: string }> = ({ parts, name }) => {
  const key = useMemo(() => parts.map(partKey).join("|"), [parts]);
  const geometry = cached(`m/${key}`, () => {
    const pieces = parts.map((p) => tiledBlock(...p.size, p.bevel, p.color, p.seed, p.holes).translate(...p.at));
    const merged = mergeGeometries(pieces) ?? new THREE.BufferGeometry();
    pieces.forEach((piece) => piece.dispose());
    merged.computeBoundingSphere();
    return merged;
  });
  return <mesh name={name} geometry={geometry} material={colorMaterial} castShadow receiveShadow />;
};

/** Thick, overlapping cuboids reproduce the raised, irregular blond crop.
 * Crown, forward fringe and temple rows have independent stepped silhouettes. */
const hairParts = (look: HumanLook): Part[] => {
  const blond = new THREE.Color(look.hair).lerp(new THREE.Color("#e4bd88"), .24);
  const root = new THREE.Color(look.hairSides ?? "#756149").lerp(new THREE.Color(look.hair), .40);
  const result: Part[] = ([-1, 1] as const).map((side) => ({ size: [.021, .104, .277], at: [side * .190, .381, -.014], color: root, bevel: .0016, seed: 130 + side }));
  const lock = (size: V3, at: V3, color: THREE.Color, seed: number) => result.push({ size, at, color, bevel: .0020, seed });
  // A modest inset foundation unifies the overlapping locks, not a visible cap.
  lock([.390, .052, .321], [0, .448, -.005], blond.clone().multiplyScalar(.88), 140);
  for (let z = 0; z < 5; z++) for (let x = 0; x < 7; x++) {
    const xx = (x - 3) * .056, zz = (z - 2) * .064 - .005, r = hash(x, z, 31);
    const raised = .021 * (1 - Math.min(1, Math.abs(xx) / .20)) + .008 * (1 - Math.abs(z - 2) / 2);
    const h = .036 + r * .019;
    lock([.060 + hash(x, z, 7) * .012, h, .070 + hash(x, z, 8) * .014], [xx + (hash(x, z, 9) - .5) * .010, .480 + raised + h * .15, zz], blond.clone().multiplyScalar(.92 + hash(x, z, 3) * .15), 200 + z * 7 + x);
  }
  // Forward overhang: seven chunky stepped bangs cast the reference shadow.
  for (let x = 0; x < 7; x++) {
    const h = .047 + hash(x, 0, 63) * .023, xx = (x - 3) * .057;
    lock([.061 + hash(x, 1, 61) * .010, h, .054], [xx, .440 + (hash(x, 0, 64) - .5) * .015, .157 + hash(x, 2, 65) * .008], blond.clone().multiplyScalar(.93 + hash(x, 0, 66) * .12), 300 + x);
    lock([.065, .028, .060], [xx + .008, .477 + (hash(x, 0, 67) - .5) * .008, .151], blond.clone().multiplyScalar(.98 + hash(x, 0, 68) * .10), 320 + x);
  }
  // Blond stepped side rows descend toward the small dark root layer.
  for (const side of [-1, 1]) for (let z = 0; z < 5; z++) for (let row = 0; row < 3; row++) {
    const front = z === 4, y = .439 - row * .037 + (hash(z, row, 76) - .5) * .010;
    if (front && row === 2) continue;
    lock([.042, .044 + hash(z, row, 78) * .009, .065], [side * (.190 + (row === 0 ? .004 : .002)), y, (z - 2) * .061 - .007], blond.clone().multiplyScalar(.84 + hash(z, row, 82 + side) * .17), 400 + (side > 0 ? 40 : 0) + row * 5 + z);
  }
  return result;
};

const VoxelEye: React.FC<{ side: -1 | 1; mood: Mood; blink: boolean; lookShift: number; skin: THREE.Color; materials: Record<string, THREE.Material> }> = ({ side, mood, blink, lookShift, skin, materials }) => {
  const x = side * EYE_X, closed = blink || (mood === "wink" && side > 0), sleepy = mood === "sleepy" || mood === "smug";
  const lid = closed ? EYE_H + .005 : sleepy ? .027 : mood === "shocked" ? .004 : .011;
  const browRaise = mood === "shocked" ? .012 : mood === "worried" || mood === "sad" ? .005 : 0;
  const browAngle = mood === "angry" ? side * .12 : mood === "worried" || mood === "sad" ? -side * .09 : mood === "thinking" ? -side * .035 : 0;
  return <group name={side < 0 ? "Left square eye well" : "Right square eye well"}>
    <Solid size={[.096, .068, .018]} at={[x, EYE_Y, FACE - .018]} material={materials.socket} bevel={.0005} />
    <Solid size={[EYE_W, EYE_H, .005]} at={[x, EYE_Y, FACE - .008]} material={materials.white} bevel={.0006} />
    {!closed && <Solid size={[.041, .056, .003]} at={[x + clamp(lookShift, -1, 1) * .016, EYE_Y - .001, FACE - .004]} material={materials.pupil} bevel={.0003} />}
    {/* Physical skin blocks occlude the pupil, so it never escapes its well. */}
    <Voxel size={[.096, lid, .019]} at={[x, EYE_Y + EYE_H / 2 - lid / 2 + .001, FACE - .002]} color={skin} seed={70 + side} bevel={.001} />
    <Solid size={[.095, .0025, .003]} at={[x, EYE_Y + EYE_H / 2 - lid, FACE + .008]} material={materials.lidLine} bevel={.0003} />
    <Voxel size={[.096, .004, .014]} at={[x, EYE_Y - EYE_H / 2 - .001, FACE - .002]} color={skin} seed={77 + side} bevel={.0008} />
    <Solid name="Straight dark block eyebrow" size={[.112, .028, .023]} at={[x, .367 + browRaise, FACE + .008]} material={materials.brow} bevel={.0011} rotation={[0, 0, browAngle]} />
  </group>;
};

/** The reference is interpreted as a real block collectible: a cuboid head,
 * stepped jaw, square eye wells and a layered cuboid haircut. No portrait map. */
export const PortraitHead: React.FC<HeadProps> = ({ look, mood, open, blink, lookShift, blush, sweat }) => {
  const talk = Math.max(clamp(open / 3), mood === "laugh" ? .70 : mood === "shocked" ? .62 : 0);
  const skin = useMemo(() => new THREE.Color(look.skin), [look.skin]);
  const materials = useMemo(() => ({
    socket: new THREE.MeshStandardMaterial({ color: "#725244", roughness: .91 }),
    white: new THREE.MeshStandardMaterial({ color: "#eee7de", roughness: .70 }),
    pupil: new THREE.MeshStandardMaterial({ color: look.eyes, roughness: .36 }),
    lidLine: new THREE.MeshStandardMaterial({ color: skin.clone().multiplyScalar(.49), roughness: .83 }),
    brow: new THREE.MeshStandardMaterial({ color: look.brows ?? "#4d392b", roughness: .79 }),
    mouth: new THREE.MeshStandardMaterial({ color: "#563227", roughness: .86 }),
    teeth: new THREE.MeshStandardMaterial({ color: "#eee1cc", roughness: .70 }),
    sweat: new THREE.MeshPhysicalMaterial({ color: "#afd7e1", roughness: .19, clearcoat: .6 }),
  }), [look.eyes, look.brows, skin]);
  const cheek = useMemo(() => skin.clone().multiplyScalar(.95), [skin]);
  const upperLip = useMemo(() => skin.clone().lerp(new THREE.Color(look.lips ?? "#b77961"), .24).multiplyScalar(.88), [look.lips, skin]);
  const lowerLip = useMemo(() => new THREE.Color(look.lips ?? "#b77961").lerp(skin, .13).multiplyScalar(.88), [look.lips, skin]);
  // Cuboid head with real square eye openings, short neck, block ears, slim bevelled nose,
  // broad restrained upper lip and the haircut: fixed against each other, so one mesh.
  const head = useMemo<Part[]>(() => [
    { size: [.388, .366, .312], at: HEAD_CENTER, color: skin, bevel: .0034, seed: 11, holes: eyeHoles },
    { size: [.145, .118, .126], at: [0, .010, -.023], color: skin, bevel: .0024, seed: 42 },
    ...([-1, 1] as const).flatMap((side): Part[] => [
      { size: [.055, .112, .072], at: [side * .217, .267, -.002], color: skin, bevel: .0024, seed: 50 + side },
      { size: [.024, .068, .032], at: [side * .229, .267, .026], color: skin.clone().multiplyScalar(.91), bevel: .0012, seed: 54 + side },
    ]),
    { size: [.047, .076, .043], at: [0, .268, FACE + .017], color: skin, bevel: .0044, seed: 60 },
    { size: [.152, .021, .014], at: [0, .185, FACE + .010], color: upperLip, bevel: .0013, seed: 62 },
    ...(look.hairStyle !== "bald" && !look.cap ? hairParts(look) : []),
  ], [skin, upperLip, look.hair, look.hairSides, look.hairStyle, look.cap]);
  const jaw = useMemo<Part[]>(() => [
    { size: [.354, .064, .292], at: [0, .073, -.006], color: cheek, bevel: .0022, seed: 21 },
    ...([-1, 1] as const).flatMap((side): Part[] => [
      { size: [.043, .168, .082], at: [side * .187, .150, .105], color: skin, bevel: .0018, seed: 30 + side },
      { size: [.034, .093, .123], at: [side * .193, .100, .022], color: cheek, bevel: .0016, seed: 34 + side },
    ]),
  ], [skin, cheek]);
  return <group name="Voxel reference portrait">
    <Merged name="Cuboid head, ears, nose and layered volumetric blond voxel crop" parts={head} />
    <group position={[0, -talk * .014, 0]} name="Stepped jaw and cheek planes">
      <Merged parts={jaw} />
    </group>
    {([-1, 1] as const).map((side) => <VoxelEye key={side} side={side} mood={mood} blink={blink} lookShift={lookShift} skin={skin} materials={materials} />)}
    {/* One cavity block, stretched: its 1 px bevel does not care about the stretch. */}
    <Solid name="Speech cavity" size={[.124, .02, .010]} scale={[1, (.006 + talk * .031) / .02, 1]} at={[0, .169 - talk * .014, FACE + .001]} material={materials.mouth} bevel={.001} />
    <Voxel name="Lower block lip" size={[.101, .014, .012]} at={[0, .155 - talk * .027, FACE + .010]} color={lowerLip} bevel={.0011} seed={64} />
    {talk > .18 && <Solid size={[.093, .006, .004]} at={[0, .173, FACE + .008]} material={materials.teeth} bevel={.0005} />}
    {blush && ([-1, 1] as const).map((side) => <Voxel key={side} size={[.052, .026, .002]} at={[side * .132, .242, FACE + .0012]} color={skin.clone().lerp(new THREE.Color("#c27b6b"), .42)} bevel={.0003} seed={80 + side} />)}
    {/* On the temple below the fringe, where the bangs no longer hide it. */}
    {sweat && <Solid size={[.026, .05, .02]} at={[.19, .30, FACE + .012]} material={materials.sweat} bevel={.003} />}
  </group>;
};
