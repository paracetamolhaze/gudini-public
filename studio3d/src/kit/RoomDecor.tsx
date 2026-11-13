import React, { useMemo } from "react";
import * as THREE from "three";
import { Sculpt } from "./Sculpt";
import { roomLightFalloff } from "./RoomTextures";
import { hash, type Vec3 } from "./util";

/**
 * The lived-in details of the owner's room, all background: a lit bookcase in the corner (the owner's shots see it
 * left of the vertical screen) with books, headphones, gold and a tiny Claude; a plant on the desk behind Claude;
 * gold bars by the mouse; bias light behind the screens. Nothing stands on the desk between a hero and his screen:
 * the cameras of the set look past the heroes there, and the middle between them stays the room's own.
 * Dimensions are key units (≈ 18 mm), like the rest of the set.
 */

const DESK = -1.1;

const createDecorMaterials = () => {
  const m = {
    shelfWood: new THREE.MeshStandardMaterial({ color: "#3b2a24", roughness: 0.6 }),
    black: new THREE.MeshStandardMaterial({ color: "#16191f", roughness: 0.5, metalness: 0.2 }),
    cushion: new THREE.MeshStandardMaterial({ color: "#22252d", roughness: 0.95 }),
    steel: new THREE.MeshStandardMaterial({ color: "#8d95a1", roughness: 0.32, metalness: 0.6 }),
    // without an environment to reflect, a true metal renders black: warm gold as a glossy dielectric
    gold: new THREE.MeshStandardMaterial({ color: "#e4b64c", roughness: 0.3, metalness: 0.3, emissive: "#3a2604", emissiveIntensity: 0.6 }),
    pot: new THREE.MeshStandardMaterial({ color: "#d9d2c7", roughness: 0.8 }),
    soil: new THREE.MeshLambertMaterial({ color: "#2a1d16" }),
    leaf: new THREE.MeshStandardMaterial({ color: "#3f8a4a", roughness: 0.7 }),
    leafDark: new THREE.MeshStandardMaterial({ color: "#2c6b3a", roughness: 0.75 }),
    claude: new THREE.MeshStandardMaterial({ color: "#d97757", roughness: 0.85 }),
    ink: new THREE.MeshStandardMaterial({ color: "#1d1512", roughness: 0.4 }),
    strip: new THREE.MeshBasicMaterial({ color: "#b07cff", toneMapped: false }),
    books: ["#7d3b45", "#2f4a6b", "#c9a46a", "#3e5c4a", "#5b4a7a", "#a85a3a", "#1f2a38", "#d8d0c0"].map((color) => new THREE.MeshStandardMaterial({ color, roughness: 0.85 })),
  };
  for (const [name, material] of Object.entries(m)) if (material instanceof THREE.Material) material.name = `decor ${name}`;
  return m;
};
type Decor = ReturnType<typeof createDecorMaterials>;

const Books: React.FC<{ m: Decor; at: Vec3; count: number; seed: number }> = ({ m, at, count, seed }) => {
  let z = 0;
  return <group position={at}>
    {Array.from({ length: count }, (_, i) => {
      const thick = 0.7 + hash(seed, i) * 0.5;
      const tall = 4 + hash(seed, i, 2) * 1.8;
      const tilt = i === count - 1 ? 0.22 : 0;
      const book = <Sculpt key={i} size={[3.4, tall, thick]} radius={0.08} position={[0, tall / 2, z + thick / 2]} rotation={[tilt, 0, 0]} material={m.books[Math.floor(hash(seed, i, 3) * m.books.length)]} />;
      z += thick + 0.06;
      return book;
    })}
  </group>;
};

const Plant: React.FC<{ m: Decor; at: Vec3; scale?: number; seed?: number }> = ({ m, at, scale = 1, seed = 1 }) => <group position={at} scale={scale}>
  <mesh position={[0, 1.5, 0]} material={m.pot} castShadow><cylinderGeometry args={[1.55, 1.2, 3, 24]} /></mesh>
  <mesh position={[0, 2.95, 0]} material={m.soil}><cylinderGeometry args={[1.42, 1.42, 0.1, 20]} /></mesh>
  {Array.from({ length: 9 }, (_, i) => {
    const a = (i / 9) * Math.PI * 2 + hash(seed, i) * 0.5;
    const lean = 0.35 + hash(seed, i, 2) * 0.5;
    const len = 2.6 + hash(seed, i, 3) * 1.6;
    return <group key={i} position={[0, 3, 0]} rotation={[0, a, 0]}>
      <group rotation={[0, 0, -lean]}>
        <mesh position={[0, len * 0.5, 0]} scale={[0.9, len * 0.5, 0.18]} material={i % 2 ? m.leaf : m.leafDark} castShadow><sphereGeometry args={[1, 12, 8]} /></mesh>
      </group>
    </group>;
  })}
</group>;

/** A small orange Claude on the shelf: the owner's desk toy of his co-host. */
const MiniClaude: React.FC<{ m: Decor; at: Vec3; turn: number }> = ({ m, at, turn }) => <group position={at} rotation={[0, turn, 0]}>
  {[[-0.5, -0.25], [0.5, -0.25], [-0.5, 0.25], [0.5, 0.25]].map(([x, z]) => <Sculpt key={`${x}${z}`} size={[0.2, 0.5, 0.2]} radius={0.05} position={[x, 0.25, z]} material={m.claude} />)}
  <Sculpt size={[1.5, 0.95, 0.85]} radius={0.1} position={[0, 0.97, 0]} material={m.claude} />
  {[-0.32, 0.32].map((x) => <Sculpt key={x} size={[0.15, 0.2, 0.04]} radius={0.03} position={[x, 1.12, 0.43]} material={m.ink} />)}
</group>;

const GoldBars: React.FC<{ m: Decor; at: Vec3; turn?: number }> = ({ m, at, turn = 0 }) => <group position={at} rotation={[0, turn, 0]}>
  {[[-1.5, 0], [1.5, 0], [0, 1]].map(([x, level], i) => (
    <Sculpt key={i} size={[2.8, 1.4, 5.6]} radius={0.12} taper={0.18} position={[x, 0.7 + level * 1.4, 0]} material={m.gold} />
  ))}
</group>;

/** Bookcase in the corner behind the owner: violet strips under its shelves, books, headphones, a plant, gold and a tiny Claude. */
const Bookcase: React.FC<{ m: Decor }> = ({ m }) => {
  const shelves = [-30, -18, -6, 4, 14, 24];
  return <group name="Corner bookcase" position={[-42.4, 0, -29.6]}>
    <Sculpt size={[5, 67, 0.6]} position={[0, -9, -5.2]} radius={0.1} material={m.shelfWood} />
    <Sculpt size={[5, 67, 0.6]} position={[0, -9, 5.2]} radius={0.1} material={m.shelfWood} />
    <Sculpt size={[0.4, 67, 10.8]} position={[-2.3, -9, 0]} radius={0.05} material={m.black} />
    {shelves.map((y) => <React.Fragment key={y}>
      <Sculpt size={[5, 0.6, 10.2]} position={[0, y, 0]} radius={0.08} material={m.shelfWood} />
      <mesh position={[2.35, y - 0.4, 0]} material={m.strip}><boxGeometry args={[0.12, 0.12, 9.8]} /></mesh>
    </React.Fragment>)}
    <Books m={m} at={[-0.3, 4.3, -4.8]} count={6} seed={3} />
    <MiniClaude m={m} at={[0.3, 4.3, 2.8]} turn={Math.PI / 2 + 0.35} />
    <group position={[0, 14.3, 0]} scale={0.6}><Headphones m={m} at={[0, 0, 0]} turn={Math.PI / 2} /></group>
    <Plant m={m} at={[0, 24.3, 2.6]} scale={0.8} seed={4} />
    <Books m={m} at={[-0.3, 24.3, -4.6]} count={4} seed={9} />
    <GoldBars m={m} at={[0, -5.7, 2.2]} />
    <Books m={m} at={[-0.3, -5.7, -4.8]} count={5} seed={12} />
  </group>;
};

const Headphones: React.FC<{ m: Decor; at: Vec3; turn: number }> = ({ m, at, turn }) => <group name="Headphones on a stand" position={at} rotation={[0, turn, 0]}>
  <mesh position={[0, 0.2, 0]} material={m.black} castShadow><cylinderGeometry args={[2, 2.2, 0.4, 28]} /></mesh>
  <mesh position={[0, 6.2, 0]} material={m.steel} castShadow><cylinderGeometry args={[0.28, 0.28, 12, 12]} /></mesh>
  <Sculpt size={[3.4, 0.6, 1.4]} radius={0.25} position={[0, 12.2, 0]} material={m.black} />
  <mesh position={[0, 9.1, 0]} material={m.black} castShadow><torusGeometry args={[3.7, 0.42, 10, 32, Math.PI]} /></mesh>
  <mesh position={[0, 9.1, 0]} material={m.cushion}><torusGeometry args={[3.35, 0.3, 8, 28, Math.PI]} /></mesh>
  {[-1, 1].map((s) => <group key={s} position={[s * 3.75, 7.6, 0]}>
    <mesh rotation={[0, 0, Math.PI / 2]} material={m.black} castShadow><cylinderGeometry args={[2, 2, 1.1, 28]} /></mesh>
    <mesh position={[-s * 0.65, 0, 0]} rotation={[0, 0, Math.PI / 2]} material={m.cushion}><cylinderGeometry args={[1.75, 1.8, 0.5, 28]} /></mesh>
    <mesh position={[s * 0.58, 0, 0]} rotation={[0, 0, Math.PI / 2]} material={m.strip}><torusGeometry args={[1.25, 0.08, 6, 28]} /></mesh>
  </group>)}
</group>;

/** Glow on the back wall behind a screen and along the desk's back edge. */
const Halo: React.FC<{ at: Vec3; size: [number, number]; color: string; opacity: number }> = ({ at, size, color, opacity }) => {
  const map = useMemo(roomLightFalloff, []);
  return <mesh position={at} userData={{ exportEffect: true }}>
    <planeGeometry args={size} />
    <meshBasicMaterial color={color} map={map} transparent opacity={opacity} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
  </mesh>;
};

export const RoomDecor: React.FC = () => {
  const m = useMemo(createDecorMaterials, []);
  return <group name="Room details">
    <Bookcase m={m} />
    <Plant m={m} at={[11.5, DESK, -10]} seed={7} />
    <GoldBars m={m} at={[19.5, DESK, -2.5]} turn={-0.4} />
    {/* a violet LED strip on the desk's back edge; bias light behind the monitor and the vertical screen */}
    <mesh position={[0, -1.02, -25.2]} material={m.strip}><boxGeometry args={[62, 0.16, 0.16]} /></mesh>
    {/* in front of the blinds: the glow falls on the slats */}
    <Halo at={[5, 9, -34.2]} size={[46, 30]} color="#5a3bdc" opacity={0.42} />
    <Halo at={[-27, 12, -34.15]} size={[24, 34]} color="#2f6fd6" opacity={0.32} />
    <Halo at={[-20, -1, -34.1]} size={[60, 10]} color="#9a5cff" opacity={0.3} />
  </group>;
};
