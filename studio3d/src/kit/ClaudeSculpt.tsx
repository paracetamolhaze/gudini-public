import React from "react";
import * as THREE from "three";
import { roundedShape } from "./Sculpt";
import type { BlockyFace } from "./textures";
import { hash } from "./util";

type V3 = [number, number, number];
type Point = [number, number];
const bevels = new Map<string, THREE.BufferGeometry>();
export const ClaudeSolid: React.FC<{ size: V3; at?: V3; turn?: V3; radius?: number; material: THREE.Material }> = ({ size, at, turn, radius = 0.015, material }) => {
  const key = `${size.join("/")}/${radius}`;
  let geometry = bevels.get(key);
  if (!geometry) { geometry = roundedShape(...size, radius); bevels.set(key, geometry); }
  return <mesh geometry={geometry} position={at} rotation={turn} material={material} castShadow receiveShadow />;
};
const strokes = new Map<string, THREE.BufferGeometry>();
const Stroke: React.FC<{ points: Point[]; material: THREE.Material; width?: number }> = ({ points, material, width = 0.009 }) => {
  const key = `${points.flat().join("/")}/${width}`;
  let geometry = strokes.get(key);
  if (!geometry) {
    const curve = new THREE.CatmullRomCurve3(points.map(([x, y]) => new THREE.Vector3(x, y, 0)));
    geometry = new THREE.TubeGeometry(curve, Math.max(6, points.length * 3), width, 6, false);
    strokes.set(key, geometry);
  }
  return <mesh geometry={geometry} position={[0, 0, 0.272]} material={material} />;
};
const makeGrain = () => {
  const size = 96, data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const pore = hash(x, y, 51), wave = Math.sin(x * 0.47 + Math.sin(y * 0.25)) * 4;
    const v = Math.round(153 + wave + (pore - 0.5) * 34 - (pore > 0.955 ? 48 : 0));
    const i = (y * size + x) * 4;
    data[i] = data[i + 1] = data[i + 2] = v; data[i + 3] = 255;
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter; texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true; texture.repeat.set(3, 3); texture.needsUpdate = true;
  return texture;
};
const grain = makeGrain();
export const claudeMaterials = (color: string) => {
  const base = new THREE.Color(color);
  const material = (c: THREE.Color, roughness: number) => new THREE.MeshStandardMaterial({ color: c, roughness, metalness: 0, bumpMap: grain, bumpScale: 0.0032 });
  return { side: material(base, 0.88), leg: material(base.clone().multiplyScalar(0.92), 0.92), socket: material(base.clone().multiplyScalar(0.59), 0.95), lip: material(base.clone().multiplyScalar(0.74), 0.9) };
};
const ink = new THREE.MeshStandardMaterial({ name: "Polished dark eye inserts", color: "#1d1512", roughness: 0.38, metalness: 0.02 });
const glint = new THREE.MeshStandardMaterial({ color: "#fff1da", roughness: 0.25 });
const heartInk = new THREE.MeshStandardMaterial({ color: "#d84660", roughness: 0.42 });
const inside = new THREE.MeshStandardMaterial({ color: "#29100e", roughness: 0.95 });
const tongue = new THREE.MeshStandardMaterial({ color: "#df7d79", roughness: 0.6 });
const cheek = new THREE.MeshStandardMaterial({ color: "#df7b6a", roughness: 0.85 });
const drop = new THREE.MeshStandardMaterial({ color: "#9adbea", roughness: 0.18, metalness: 0.08 });
const heart = new THREE.Shape();
heart.moveTo(0, -0.046);
heart.bezierCurveTo(-0.018, -0.03, -0.052, 0.001, -0.052, 0.022);
heart.bezierCurveTo(-0.052, 0.058, -0.014, 0.061, 0, 0.031);
heart.bezierCurveTo(0.014, 0.061, 0.052, 0.058, 0.052, 0.022);
heart.bezierCurveTo(0.052, 0.001, 0.018, -0.03, 0, -0.046);
const heartGeo = new THREE.ExtrudeGeometry(heart, { depth: 0.012, bevelEnabled: true, bevelSegments: 2, steps: 1, bevelSize: 0.003, bevelThickness: 0.003, curveSegments: 5 });
const sphere = new THREE.SphereGeometry(1, 12, 8);

/** Actual facial relief: eye wells, polished ink, sculpted mouth, teeth and tongue. */
export const ClaudeFace: React.FC<BlockyFace & { socket: THREE.Material; lip: THREE.Material }> = ({ mood, open, blink, blush, sweat, socket, lip }) => {
  const eyeY = 0.336, my = 0.1596;
  const smiles = mood === "happy" || mood === "laugh";
  const isOpen = open > 0 || mood === "shocked" || mood === "laugh";
  const mw = open > 0 ? 0.06 + open * 0.023 : mood === "laugh" ? 0.132 : 0.061;
  const mh = open > 0 ? 0.026 + open * 0.021 : mood === "laugh" ? 0.071 : 0.077;
  return <group name="Claude sculpted face">
    {[-1, 1].map((mirror) => {
      const ex = mirror * 0.2, ey = eyeY + (mood === "thinking" ? 0.025 : 0);
      const sleepy = mood === "sleepy" || mood === "smug" || mood === "worried";
      const closed = (blink && !smiles && mood !== "dizzy" && mood !== "love") || mood === "sleepy" || (mood === "wink" && mirror === 1);
      const brow = ["worried", "sad", "angry", "thinking", "shocked", "smug"].includes(mood);
      const angle = mood === "angry" ? -mirror * 0.28 : mood === "sad" || mood === "worried" ? mirror * 0.23 : mood === "thinking" ? mirror * 0.1 : 0;
      return <group key={mirror} name={mirror === -1 ? "Left facial details" : "Right facial details"}>
        {mood === "love" ? <mesh geometry={heartGeo} material={heartInk} position={[ex, ey, 0.259]} /> : mood === "dizzy" ? <>
          <Stroke material={ink} width={0.01} points={[[ex - 0.04, ey - 0.043], [ex + 0.04, ey + 0.043]]} />
          <Stroke material={ink} width={0.01} points={[[ex - 0.04, ey + 0.043], [ex + 0.04, ey - 0.043]]} />
        </> : smiles ? <Stroke material={ink} width={0.01} points={[[ex - 0.052, ey - 0.011], [ex, ey + 0.026], [ex + 0.052, ey - 0.011]]} />
        : closed ? <Stroke material={ink} points={[[ex - 0.05, ey - 0.005], [ex, ey - 0.012], [ex + 0.05, ey - 0.005]]} /> : <>
          <ClaudeSolid material={socket} size={[0.113, sleepy ? 0.065 : mood === "shocked" ? 0.143 : 0.116, 0.022]} at={[ex, ey, 0.249]} radius={0.016} />
          <ClaudeSolid material={ink} size={[0.087, sleepy ? 0.039 : mood === "shocked" ? 0.115 : 0.087, 0.026]} at={[ex, ey, 0.256]} radius={0.011} />
          {!sleepy && <ClaudeSolid material={glint} size={[0.013, 0.015, 0.005]} at={[ex - 0.024, ey + (mood === "shocked" ? 0.034 : 0.023), 0.271]} radius={0.002} />}
        </>}
        {brow && <ClaudeSolid material={ink} size={[0.105, 0.015, 0.018]} at={[ex, eyeY + (mood === "shocked" ? 0.118 : 0.091), 0.263]} turn={[0, 0, angle]} radius={0.006} />}
        {(blush || smiles || mood === "love") && <mesh geometry={sphere} material={cheek} position={[mirror * 0.305, 0.2016, 0.249]} scale={[0.05, 0.024, 0.011]} />}
      </group>;
    })}
    {isOpen ? <>
      <ClaudeSolid material={lip} size={[mw + 0.022, mh + 0.02, 0.024]} at={[0, my, 0.251]} radius={0.014} />
      <ClaudeSolid material={inside} size={[mw, mh, 0.019]} at={[0, my, 0.259]} radius={0.012} />
      {(open >= 2 || mood === "laugh") && <ClaudeSolid material={glint} size={[mw * 0.7, 0.014, 0.007]} at={[0, my + mh / 2 - 0.012, 0.27]} radius={0.004} />}
      {(open >= 3 || mood === "laugh") && <ClaudeSolid material={tongue} size={[mw * 0.58, 0.019, 0.007]} at={[0, my - mh / 2 + 0.014, 0.27]} radius={0.008} />}
    </> : ["happy", "love", "smug", "wink"].includes(mood) ? <Stroke material={ink} points={[[-0.065, my + 0.016], [-0.038, my - 0.01], [0.028, my - 0.012], [0.065, my + (mood === "smug" ? 0.027 : 0.016)]]} />
    : mood === "sad" ? <Stroke material={ink} points={[[-0.061, my - 0.017], [0, my + 0.014], [0.061, my - 0.017]]} />
    : mood === "worried" || mood === "dizzy" ? <Stroke material={ink} points={[[-0.058, my - 0.006], [-0.027, my + 0.009], [0.004, my - 0.009], [0.035, my + 0.008], [0.058, my - 0.005]]} />
    : mood === "neutral" ? <ClaudeSolid material={ink} size={[0.041, 0.027, 0.018]} at={[0, my, 0.258]} radius={0.01} />
    : <Stroke material={ink} points={[[-0.046, my], [0.046, my]]} />}
    {(sweat || mood === "worried") && <group position={[0.351, 0.4536, 0.238]} rotation={[0, 0, -0.12]}>
      <mesh geometry={sphere} material={drop} scale={[0.024, 0.037, 0.016]} />
      <ClaudeSolid material={glint} size={[0.006, 0.016, 0.004]} at={[-0.007, 0.008, 0.015]} radius={0.002} />
    </group>}
  </group>;
};
