import React, { useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { mergeGeometries, mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { Sculpt, Seam, roundedShape, surfaceRelief, withHoles, type Covered } from "./Sculpt";
import { blobShadow } from "./textures";
import { roomLed, roomWood, roomPlaster, roomLightFalloff } from "./RoomTextures";
import { RoomDecor } from "./RoomDecor";
import { ARM_HEIGHT, ARM_POLE, MONITORS, onMonitor, SCREEN_DEPTH, type MonitorPlace } from "./layout";
import { screenSurface } from "./Screens";
import type { Surface } from "./ScreenApps";
import { type Vec3 } from "./util";

/** Dimensions are keyboard-key units: 1 unit is approximately 18 mm. */
export const ROOM_COORDINATES = {
  keyboard: [0, 0, 0], desktopTop: -1.1, floor: -42,
  mainMonitor: MONITORS.monitor.centre, portraitMonitor: MONITORS.vertical.centre,
  computer: [25, 10.4, -14], rearWall: -35, ceiling: 105,
} as const;

const standard = (color: string, roughness = 0.65, metalness = 0.05) => new THREE.MeshStandardMaterial({ color, roughness, metalness });
// Rough dielectrics shade like Lambert (same diffuse term, the GGX lobe is a percent or two),
// and Lambert costs the software renderer a fraction per pixel and per light.
const matte = (color: string, extra: THREE.MeshLambertMaterialParameters = {}) => new THREE.MeshLambertMaterial({ color, ...extra });
// Named materials make the baked meshes readable in a scene dump.
const named = <T extends Record<string, THREE.Material>>(materials: T) => { for (const [name, material] of Object.entries(materials)) material.name = name; return materials; };
const createMaterials = () => named({
  walnut: new THREE.MeshStandardMaterial({ color: "#c3a89c", map: roomWood(), roughness: 0.53, bumpMap: roomWood(), bumpScale: 0.045 }),
  floor: matte("#ffffff", { map: roomWood(true), bumpMap: roomWood(true), bumpScale: 0.025 }),
  plaster: matte("#bdb8bc", { map: roomPlaster(), bumpMap: roomPlaster(), bumpScale: 0.012 }),
  ceiling: matte("#c6c0c5"),
  black: standard("#15191f", 0.48, 0.18), dark: standard("#090d14", 0.72),
  frame: standard("#262b35", 0.35, 0.48), steel: standard("#89929d", 0.3, 0.75),
  case: standard("#d0d3d8", 0.38, 0.38), blind: matte("#655047"),
  // The desk mat is seen at a grazing angle in wide shots, where its soft sheen is part of the look.
  blindEdge: matte("#3a2c29"), rubber: new THREE.MeshStandardMaterial({ color: "#181c27", roughness: 0.93, bumpMap: surfaceRelief("rubber"), bumpScale: 0.022 }),
  fabric: matte("#222634", { bumpMap: surfaceRelief("cotton"), bumpScale: 0.04 }),
  glass: new THREE.MeshStandardMaterial({ color: "#a7b3c5", transparent: true, opacity: 0.075, roughness: 0.08, metalness: 0.15, depthWrite: false, side: THREE.DoubleSide }),
  violet: new THREE.MeshStandardMaterial({ color: "#9139d4", emissive: "#8000ff", emissiveIntensity: 1.1, roughness: 0.3 }),
  fan: new THREE.MeshStandardMaterial({ color: "#6f4b9f", emissive: "#562087", emissiveIntensity: 0.2, roughness: 0.32, metalness: 0.22 }),
  cable: matte("#0a0c12"), blue: standard("#285991", 0.32, 0.6),
  shadow: new THREE.MeshBasicMaterial({ map: blobShadow(), transparent: true, depthWrite: false, opacity: 0.65 }),
});
type Mats = ReturnType<typeof createMaterials>;

/** The covered part of a top face, in the Sculpt's own coordinates: [x0, x1, z0, z1]. */
const top = (hole: [number, number, number, number]): Covered => ({ axis: 1, side: 1, holes: [hole] });

const Contact: React.FC<{ at: Vec3; size: [number, number]; material: THREE.Material }> = ({ at, size, material }) => <mesh position={at} rotation={[-Math.PI / 2, 0, 0]} material={material}><planeGeometry args={size} /></mesh>;

/** Case, plate, space bar and volume knob of the compact keyboard; its keys and backlight live in Keys.tsx. */
const Keyboard: React.FC<{ m: Mats }> = ({ m }) => <group name="Compact mechanical keyboard">
  {/* Case, plate and glow plane are stacked: each top face is cut where the layer above
      always covers it, an inset wide enough for the most grazing camera. */}
  <Sculpt size={[17.9, 0.65, 7.8]} radius={0.22} position={[0, -0.68, 0]} material={m.case} covered={top([-8.5, 8.5, -3.475, 3.475])} />
  <Sculpt size={[17.5, 0.22, 7.45]} radius={0.12} position={[0, -0.405, 0]} material={m.dark} covered={top([-8.25, 8.25, -3.175, 3.175])} />
  <Sculpt size={[7.72, 0.3, 0.97]} radius={0.09} position={[0, -0.15, 2.8]} material={m.case} />
  <mesh position={[7.85, -0.1, -3.42]} material={m.steel}><cylinderGeometry args={[0.37, 0.37, 0.48, 20]} /></mesh>
  <mesh position={[7.85, 0.146, -3.42]} material={m.fan}><cylinderGeometry args={[0.28, 0.28, 0.012, 20]} /></mesh>
</group>;

/** Where an arm holds a monitor: the tilt joint behind the VESA plate, in the monitor's own frame. */
const MOUNT: Vec3 = [0, 0, -1.9];

/** A monitor on the arm: body, screen, chin, power light and the VESA plate with its tilt joint at the back. */
const Monitor: React.FC<{ m: Mats; surface: Surface }> = ({ m, surface }) => {
  const place: MonitorPlace = MONITORS[surface];
  const { width, height } = place;
  // ScreenPainter draws the picture on this material every frame (Screens.tsx)
  const screen = screenSurface(surface).material;
  return <group name={surface === "vertical" ? "Portrait monitor" : "Main Claude monitor"} position={place.centre} rotation={[0, place.yaw, 0]}>
    {/* The screen hides the body's front face; 0.15 of overlap holds up to a 68 degree view. */}
    <Sculpt size={[width + 0.66, height + 0.66, 0.9]} radius={0.22} material={m.black} covered={{ axis: 2, side: 1, holes: [[-(width / 2 - 0.15), width / 2 - 0.15, -(height / 2 - 0.15), height / 2 - 0.15]] }} />
    <mesh position={[0, 0, SCREEN_DEPTH]} material={screen}><planeGeometry args={[width, height]} /></mesh>
    <Sculpt size={[width * 0.93, 0.23, 0.16]} position={[0, -height / 2 - 0.12, 0.48]} radius={0.06} material={m.frame} />
    <mesh position={[width / 2 - 0.6, -height / 2 - 0.12, 0.579]}><sphereGeometry args={[0.055, 8, 6]} /><meshBasicMaterial color="#b9e0d4" /></mesh>
    <Sculpt size={[5.4, 5.4, 0.5]} position={[0, 0, -0.68]} radius={0.3} material={m.frame} />
    <Sculpt size={[1.6, 1.6, 1.1]} position={[0, 0, -1.4]} radius={0.25} material={m.black} />
    <Seam points={[[0.9, -2.2, -0.6], [1.6, -height / 2 + 1, -1.6], [2.2, -height / 2 - 0.4, -2.6]]} radius={0.095} material={m.cable} />
  </group>;
};

/** A straight piece of the arm between two points: a rounded bar of the given cross-section. */
const Strut: React.FC<{ from: Vec3; to: Vec3; size: [number, number]; material: THREE.Material }> = ({ from, to, size, material }) => {
  const a = new THREE.Vector3(...from); const b = new THREE.Vector3(...to);
  const length = a.distanceTo(b);
  const turn = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  return <group position={a.clone().add(b).multiplyScalar(0.5)} quaternion={turn}>
    <Sculpt size={[size[0], length + size[0] * 0.6, size[1]]} radius={Math.min(size[0], size[1]) * 0.45} material={material} />
  </group>;
};

const Joint: React.FC<{ at: Vec3; m: Mats }> = ({ at, m }) => <mesh position={at} material={m.steel} castShadow><cylinderGeometry args={[0.62, 0.62, 1.05, 20]} /></mesh>;

/**
 * The dual monitor arm: a pole clamped to the desk's back edge between the monitors and, for each monitor, two
 * gas-spring links with an elbow, ending at the tilt joint behind the screen. In the gap between the monitors it
 * is what tells the viewer these are two monitors on an arm, not a wall of light.
 */
const DualArm: React.FC<{ m: Mats }> = ({ m }) => {
  const [px, pz] = ARM_POLE;
  const top: Vec3 = [px, ARM_HEIGHT, pz];
  const links = (Object.keys(MONITORS) as Surface[]).map((surface) => {
    const end = onMonitor(MONITORS[surface], MOUNT);
    // the elbow sits a little behind and above the straight line, like a spring arm holding weight
    const elbow: Vec3 = [(top[0] + end[0]) / 2, Math.max(top[1], end[1]) + 1.4, Math.min(top[2], end[2]) - 1.2];
    return { surface, end, elbow };
  });
  return <group name="Dual monitor arm">
    <Sculpt size={[3.2, 2.6, 4.6]} radius={0.25} position={[px, -2.2, -24.6]} material={m.frame} />
    <Sculpt size={[3.2, 0.5, 2.6]} radius={0.15} position={[px, -0.85, pz]} material={m.frame} />
    <mesh position={[px, (ARM_HEIGHT - 1.1) / 2, pz]} material={m.steel} castShadow><cylinderGeometry args={[0.55, 0.55, ARM_HEIGHT + 1.1, 20]} /></mesh>
    <Joint at={top} m={m} />
    {links.map(({ surface, end, elbow }) => <React.Fragment key={surface}>
      <Strut from={top} to={elbow} size={[1, 0.75]} material={m.black} />
      <Strut from={elbow} to={end} size={[0.9, 0.7]} material={m.black} />
      <Joint at={elbow} m={m} />
      <Seam points={[[top[0] + 0.5, top[1] - 0.6, top[2] - 0.5], [elbow[0], elbow[1] - 0.6, elbow[2] - 0.5], [end[0], end[1] - 0.8, end[2] - 0.4]]} radius={0.09} material={m.cable} />
    </React.Fragment>)}
  </group>;
};

/** The blades of the PC fans at a turn of `spin` radians. */
const spinFans = (mesh: THREE.InstancedMesh, spin: number) => {
  const matrix = new THREE.Matrix4(); const position = new THREE.Vector3(); const rotation = new THREE.Quaternion(); const scale = new THREE.Vector3(1, 1, 1);
  for (let fan = 0; fan < 3; fan++) for (let i = 0; i < 9; i++) {
    // neighbours turn the other way, like a push-pull stack
    const a = i / 9 * Math.PI * 2 + spin * (fan === 1 ? -1 : 1);
    position.set(Math.cos(a) * 1.18, (fan - 1) * 6.4 + Math.sin(a) * 1.18, 7.35);
    rotation.setFromEuler(new THREE.Euler(0, 0, a + 0.55)); matrix.compose(position, rotation, scale); mesh.setMatrixAt(fan * 9 + i, matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
};

/** The three PC fans turning behind the glass: live, outside the baked set, so World turns them every frame. */
export const PcFans: React.FC<{ spin: number }> = ({ spin }) => {
  const blades = useMemo(() => {
    const fan = new THREE.MeshStandardMaterial({ color: "#6f4b9f", emissive: "#562087", emissiveIntensity: 0.2, roughness: 0.32, metalness: 0.22 });
    // Blades sit behind tinted glass; a 3 px bevel needs no more than one arc segment.
    const mesh = new THREE.InstancedMesh(roundedShape(1.75, 0.55, 0.14, 0.06, 1), fan, 27);
    mesh.castShadow = mesh.receiveShadow = true;
    return mesh;
  }, []);
  spinFans(blades, spin);
  return <group position={[25, 10.4, -14]}><primitive object={blades} /></group>;
};

const Computer: React.FC<{ m: Mats }> = ({ m }) => {
  return <group name="Glass gaming PC with visible cooling" position={[25, 10.4, -14]}>
    <Contact at={[0, -11.475, 0]} size={[15, 20]} material={m.shadow} />
    <Sculpt size={[11.2, 1.15, 15.5]} radius={0.23} position={[0, -10.65, 0]} material={m.case} />
    <Sculpt size={[11.2, 0.55, 15.5]} radius={0.2} position={[0, 10.75, 0]} material={m.case} />
    <Sculpt size={[10.6, 20.9, 0.45]} radius={0.15} position={[0, 0, -7.4]} material={m.case} />
    <Sculpt size={[0.38, 20.8, 15.1]} radius={0.1} position={[5.38, 0, 0]} material={m.case} />
    {[-5.33, 5.33].flatMap((x) => [-7.42, 7.42].map((z) => <Sculpt key={`${x},${z}`} size={[0.25, 21.1, 0.25]} radius={0.06} position={[x, 0, z]} material={m.steel} />))}
    <mesh position={[0, 0, 7.67]} material={m.glass}><planeGeometry args={[10.8, 20.9]} /></mesh>
    <mesh position={[-5.57, 0, 0]} rotation={[0, -Math.PI / 2, 0]} material={m.glass}><planeGeometry args={[15.1, 20.9]} /></mesh>
    <Sculpt size={[0.3, 16.8, 12.5]} radius={0.08} position={[4.75, 1.1, -0.3]} material={m.dark} />
    <Sculpt size={[8.8, 1.45, 11.6]} radius={0.18} position={[-0.3, -3, -0.6]} material={m.case} />
    <Sculpt size={[8.9, 0.22, 10.9]} radius={0.08} position={[-0.3, -2.22, -0.6]} material={m.frame} />
    <Sculpt size={[8.5, 0.13, 0.11]} radius={0.03} position={[-0.3, -2.14, 5.01]} material={m.violet} />
    <Sculpt size={[9.7, 4.3, 13.7]} radius={0.18} position={[0, -8.1, -0.5]} material={m.case} />
    <Sculpt size={[9.6, 1.2, 12.8]} radius={0.14} position={[0, 9.7, -0.5]} material={m.dark} />
    {[-2.8, 0, 2.8].map((x) => <Sculpt key={x} size={[0.27, 4.8, 0.55]} radius={0.05} position={[x + 1, 2.6, -1.3]} material={m.violet} />)}
    <mesh rotation={[0, 0, Math.PI / 2]} position={[-0.5, 3, -1.2]} material={m.frame}><cylinderGeometry args={[1.9, 1.9, 1, 32]} /></mesh>
    <mesh rotation={[0, -Math.PI / 2, 0]} position={[-1.04, 3, -1.2]} material={m.violet}><torusGeometry args={[1.5, 0.12, 6, 32]} /></mesh>
    <mesh rotation={[0, -Math.PI / 2, 0]} position={[-1.06, 3, -1.2]} material={m.black}><circleGeometry args={[1.24, 24]} /></mesh>
    <Seam points={[[-1.5, 3.4, -0.5], [-3.5, 5, 1], [-3.8, 7.5, 0.3], [-1.8, 8.9, -3.8]]} radius={0.27} material={m.frame} />
    <Seam points={[[-1.5, 2.8, -2], [-3.6, 3.9, -3.1], [-3.5, 6.9, -4], [-1.7, 8.9, -5.5]]} radius={0.27} material={m.frame} />
    <Seam points={[[-1.8, 3.4, -0.5], [-3.8, 5, 1], [-4.1, 7.5, 0.3], [-2.1, 8.9, -3.8]]} radius={0.085} material={m.violet} />
    {[-6.4, 0, 6.4].map((y) => <group key={y} position={[0, y, 7.25]}>
      <mesh material={m.frame}><ringGeometry args={[2.44, 2.75, 32]} /></mesh>
      <mesh position={[0, 0, 0.14]} material={m.violet}><torusGeometry args={[2.25, 0.13, 7, 40]} /></mesh>
      <mesh position={[0, 0, 0.17]} material={m.violet}><torusGeometry args={[0.7, 0.08, 6, 24]} /></mesh>
      <mesh position={[0, 0, 0.24]} rotation={[Math.PI / 2, 0, 0]} material={m.frame}><cylinderGeometry args={[0.64, 0.64, 0.25, 24]} /></mesh>
    </group>)}
    {[-4.3, 4.3].flatMap((x) => [-5.7, 5.7].map((z) => <Sculpt key={`${x}-${z}`} size={[1.2, 0.45, 1.7]} radius={0.11} position={[x, -11.25, z]} material={m.rubber} />))}
    <mesh position={[3.9, 11.04, 4.3]} material={m.frame}><cylinderGeometry args={[0.3, 0.3, 0.04, 20]} /></mesh>
  </group>;
};

const Architecture: React.FC<{ m: Mats }> = ({ m }) => {
  const blindSlats = useMemo(() => {
    const mesh = new THREE.InstancedMesh(roundedShape(54.5, 0.84, 0.27, 0.08, 1), m.blind, 55);
    const matrix = new THREE.Matrix4();
    for (let i = 0; i < 55; i++) { matrix.makeRotationX(-0.13); matrix.setPosition(-14, 7 + i * 1.02, -34.45); mesh.setMatrixAt(i, matrix); }
    mesh.instanceMatrix.needsUpdate = true; mesh.castShadow = mesh.receiveShadow = true; return mesh;
  }, [m]);
  const acDisplay = useMemo(() => new THREE.MeshBasicMaterial({ map: roomLed(), transparent: true, toneMapped: false }), []);
  // The blind frame and the AC unit are sunk into the back wall, so the plaster behind them never shows.
  const backWall = useMemo(() => withHoles(new THREE.BoxGeometry(91.4, 147, 1.4), { axis: 2, side: 1, holes: [[-41.8, 13.8, -26.4, 31.4], [-25.4, 3.4, 41.5, 48.5]] }), []);
  return <group name="Room architecture - open front and right for camera access">
    <mesh position={[0, -42.4, 10]} material={m.floor} receiveShadow><boxGeometry args={[90, 0.8, 90]} /></mesh>
    <mesh position={[0, 31.5, -35.7]} material={m.plaster} receiveShadow geometry={backWall} />
    <mesh position={[-45.7, 31.5, 10]} material={m.plaster} receiveShadow><boxGeometry args={[1.4, 147, 90]} /></mesh>
    <mesh position={[0, 105.5, 10]} material={m.ceiling}><boxGeometry args={[91.4, 1, 90]} /></mesh>
    <mesh name="PC violet indirect wall wash" userData={{ exportEffect: true }} position={[25, 16, -34.88]}>
      <planeGeometry args={[39, 58]} />
      <meshBasicMaterial color="#7521d5" map={roomLightFalloff()} transparent opacity={0.43} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
    </mesh>
    <mesh name="Shelf violet indirect wall wash" userData={{ exportEffect: true }} position={[25, 30, -34.85]}>
      <planeGeometry args={[25, 14]} />
      <meshBasicMaterial color="#8930e0" map={roomLightFalloff()} transparent opacity={0.4} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
    </mesh>
    <mesh name="Faint reflected light on left wall" userData={{ exportEffect: true }} position={[-44.88, 17, -9]} rotation={[0, Math.PI / 2, 0]}>
      <planeGeometry args={[47, 67]} />
      <meshBasicMaterial color="#40216d" map={roomLightFalloff()} transparent opacity={0.3} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
    </mesh>
    <Sculpt size={[89, 1.6, 0.55]} radius={0.1} position={[0, -41, -34.7]} material={m.ceiling} />
    <Sculpt size={[0.55, 1.6, 89]} radius={0.1} position={[-44.7, -41, 10]} material={m.ceiling} />
    <Sculpt size={[56.2, 58.4, 0.8]} radius={0.2} position={[-14, 34, -34.95]} material={m.blindEdge} />
    <primitive object={blindSlats} />
    {[-34, -14, 6].map((x) => <mesh key={x} position={[x, 34.1, -34.24]} material={m.blindEdge}><boxGeometry args={[0.22, 56.7, 0.08]} /></mesh>)}
    <Sculpt size={[56.5, 1.5, 1.8]} radius={0.12} position={[-14, 63.3, -34]} material={m.blind} />
    <Seam points={[[14, 61, -33.8], [14, 37, -33.8], [14, 26, -33.8]]} radius={0.07} material={m.blindEdge} />
    <Sculpt size={[30, 8.1, 5.2]} radius={0.28} position={[-11, 76.5, -32.8]} material={m.case} />
    <Sculpt size={[25.5, 0.85, 0.4]} radius={0.12} position={[-11, 73.35, -29.98]} material={m.dark} />
    <Sculpt size={[25.2, 0.13, 0.65]} radius={0.04} position={[-11, 73.45, -29.63]} material={m.steel} />
    <mesh position={[-0.5, 76.1, -30.13]} material={acDisplay}><planeGeometry args={[2.3, 1.15]} /></mesh>
    <Sculpt size={[18.8, 0.85, 6.1]} radius={0.16} position={[25, 34, -31.65]} material={m.walnut} />
    <Sculpt size={[16.7, 0.2, 0.15]} radius={0.04} position={[25, 33.52, -29]} material={m.violet} />
    <Sculpt size={[1, 5.7, 1]} radius={0.13} position={[20, 37.3, -32]} material={m.black} />
    <mesh position={[20, 40.8, -32]} material={m.frame}><cylinderGeometry args={[0.19, 0.19, 1.3, 8]} /></mesh>
    <Sculpt size={[2.3, 3, 2]} radius={0.2} position={[27, 35.95, -31.2]} material={m.case} />
    {[0, 1, 2].map((i) => <Sculpt key={i} size={[0.55, 3.8 + i * 0.6, 2.7]} radius={0.04} position={[29.6 + i * 0.65, 36.3 + i * 0.3, -31.6]} rotation={[0, 0, i === 2 ? -0.15 : 0]} material={i === 1 ? m.blind : m.frame} />)}
  </group>;
};

const Chair: React.FC<{ m: Mats }> = ({ m }) => <group name="Desk chair" position={[4, 0, 28]} rotation={[0, -0.12, 0]}>
  <Contact at={[0, -41.97, 0]} size={[24, 24]} material={m.shadow} />
  <Sculpt size={[13, 2.2, 12]} radius={0.3} position={[0, -21, 0]} material={m.rubber} />
  <Sculpt size={[11.8, 1.3, 11]} radius={0.27} position={[0, -19.8, 0]} material={m.fabric} />
  <Sculpt size={[12.4, 23.5, 1.5]} radius={0.3} position={[0, -7.7, 5.4]} rotation={[-0.13, 0, 0]} material={m.rubber} />
  <Sculpt size={[10.8, 18.6, 0.55]} radius={0.23} position={[0, -7, 4.48]} rotation={[-0.13, 0, 0]} material={m.fabric} />
  <Sculpt size={[7.7, 3.1, 1.7]} radius={0.3} position={[0, 1.8, 4]} material={m.black} />
  <mesh position={[0, -31, 0]} material={m.steel}><cylinderGeometry args={[0.58, 0.8, 18, 16]} /></mesh>
  {[-1, 1].map((side) => <group key={side}>
    <Sculpt size={[0.65, 7, 0.8]} radius={0.14} position={[side * 7, -17.5, 0]} material={m.frame} />
    <Sculpt size={[1.6, 0.8, 6.7]} radius={0.2} position={[side * 7, -13.8, -0.6]} material={m.rubber} />
  </group>)}
  {[0, 1, 2, 3, 4].map((i) => { const a = i * Math.PI * 2 / 5; const x = Math.cos(a) * 8; const z = Math.sin(a) * 8; return <group key={i}>
    <Seam points={[[0, -38.9, 0], [x * 0.6, -39.3, z * 0.6], [x, -40.2, z]]} radius={0.38} material={m.frame} />
    <mesh position={[x, -40.95, z]} rotation={[0, 0, Math.PI / 2]} material={m.rubber}><cylinderGeometry args={[0.95, 0.95, 0.9, 14]} /></mesh>
  </group>; })}
</group>;

const BAKED_ATTRIBUTES = ["position", "normal", "uv"] as const;

/** The room never moves, so after its first commit every opaque single-material mesh is baked
 * into one mesh per piece of furniture, material and shadow role. The software renderer then
 * issues a few dozen draw calls for the set instead of ~250, in the colour pass and in the
 * shadow pass alike. Each baked mesh sits at its own centre, so the renderer still draws near
 * furniture before the far walls and skips the hidden pixels instead of shading them twice.
 * Transparent decals and the per-key coloured caps stay live; the source meshes stay mounted
 * but hidden, so the declarative room above remains the single description of the set. */
const Baked: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const source = useRef<THREE.Group>(null);
  const baked = useMemo(() => new THREE.Group(), []);
  useLayoutEffect(() => {
    const root = source.current;
    if (!root) return;
    root.updateWorldMatrix(true, true);
    const toRoot = root.matrixWorld.clone().invert();
    const buckets = new Map<string, { material: THREE.Material; cast: boolean; receive: boolean; parts: THREE.BufferGeometry[] }>();
    const local = new THREE.Matrix4(), instance = new THREE.Matrix4();
    const hidden: THREE.Mesh[] = [];
    // A piece of furniture is a group directly inside the set; loose desk items share one piece.
    const pieceOf = (object: THREE.Object3D) => {
      let piece = object;
      while (piece.parent && piece.parent.parent && piece.parent.parent !== root) piece = piece.parent;
      return piece === object ? "Desk items" : `${piece.name || "Piece"}#${piece.id}`;
    };
    root.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh || Array.isArray(mesh.material) || mesh.material.transparent) return;
      const instanced = (mesh as THREE.InstancedMesh).isInstancedMesh ? mesh as THREE.InstancedMesh : null;
      if (instanced?.instanceColor) return;
      const key = `${pieceOf(mesh)}|${mesh.material.uuid}|${mesh.castShadow}|${mesh.receiveShadow}`;
      let bucket = buckets.get(key);
      if (!bucket) buckets.set(key, bucket = { material: mesh.material, cast: mesh.castShadow, receive: mesh.receiveShadow, parts: [] });
      // Same attribute set for every part, as mergeGeometries requires.
      const clean = new THREE.BufferGeometry();
      for (const name of BAKED_ATTRIBUTES) {
        const attribute = mesh.geometry.getAttribute(name);
        clean.setAttribute(name, attribute ? attribute.clone() : new THREE.Float32BufferAttribute(new Float32Array(mesh.geometry.getAttribute("position").count * 2), 2));
      }
      if (mesh.geometry.index) clean.setIndex(mesh.geometry.index.clone());
      const shape = clean.index ? clean : mergeVertices(clean);
      local.multiplyMatrices(toRoot, mesh.matrixWorld);
      for (let i = 0; i < (instanced ? instanced.count : 1); i++) {
        const part = shape.clone();
        if (instanced) { instanced.getMatrixAt(i, instance); part.applyMatrix4(instance.premultiply(local)); } else part.applyMatrix4(local);
        bucket.parts.push(part);
      }
      hidden.push(mesh);
    });
    const meshes: THREE.Mesh[] = [];
    for (const [key, { material, cast, receive, parts }] of buckets) {
      const geometry = mergeGeometries(parts);
      parts.forEach((part) => part.dispose());
      if (!geometry) continue;
      geometry.computeBoundingSphere();
      const centre = geometry.boundingSphere!.center.clone();
      geometry.translate(-centre.x, -centre.y, -centre.z);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = `${key.split("|")[0]} - ${material.name || material.type}`;
      mesh.position.copy(centre); mesh.updateMatrix();
      mesh.castShadow = cast; mesh.receiveShadow = receive;
      mesh.matrixAutoUpdate = false;
      meshes.push(mesh);
    }
    hidden.forEach((mesh) => { mesh.visible = false; });
    baked.add(...meshes);
    return () => {
      baked.remove(...meshes);
      meshes.forEach((mesh) => mesh.geometry.dispose());
      hidden.forEach((mesh) => { mesh.visible = true; });
    };
  }, [baked]);
  return <>
    <group ref={source}>{children}</group>
    <primitive object={baked} />
  </>;
};

/** Memoised: the set has no props and no frame dependence, so the per-frame re-render of the
 * lights above it never walks these few hundred elements again. */
export const RoomSet: React.FC = React.memo(() => {
  const m = useMemo(createMaterials, []);
  return <Baked><group name="User room - reusable physical set">
    <Architecture m={m} />
    <Contact at={[0, -41.97, -6]} size={[78, 59]} material={m.shadow} />
    <Sculpt size={[66, 1.65, 39]} radius={0.25} position={[0, -1.925, -6]} material={m.walnut} covered={top([-10.5, 16.5, -0.5, 12.5])} />
    {[-29.5, 29.5].flatMap((x) => [-19.5, 7].map((z) => <Sculpt key={`${x}-${z}`} size={[1.5, 39.2, 1.5]} radius={0.15} position={[x, -22.4, z]} material={m.frame} />))}
    <Sculpt size={[59.8, 2, 1.4]} radius={0.15} position={[0, -6, -19.5]} material={m.frame} />
    <Sculpt size={[29, 0.12, 15]} radius={0.035} position={[3, -1.025, 0]} material={m.rubber} covered={top([-11.6, 5.6, -3.55, 3.55])} />
    <Sculpt size={[30, 2, 4]} radius={0.12} position={[-1, -5.6, -20]} material={m.black} />
    <Keyboard m={m} />
    <Monitor m={m} surface="monitor" />
    <Monitor m={m} surface="vertical" />
    <DualArm m={m} />
    <Computer m={m} />
    <mesh position={[13.6, -0.25, 1.8]} scale={[1.65, 0.9, 2.45]} material={m.black}><sphereGeometry args={[1, 28, 16]} /></mesh>
    <Seam points={[[13.6, 0.62, 1.2], [13.6, 0.59, 0.4], [13.6, 0.2, -0.35]]} radius={0.035} material={m.frame} />
    <mesh position={[13.6, 0.65, 0.45]} rotation={[0, 0, Math.PI / 2]} material={m.rubber}><cylinderGeometry args={[0.19, 0.19, 0.36, 12]} /></mesh>
    <Seam points={[[13.5, -0.3, -0.4], [14, -0.9, -3.5], [16, -1, -6.5], [17, -1, -15], [20, -1, -21]]} radius={0.08} material={m.cable} />
    <Seam points={[[0, -0.65, -3.9], [-1.5, -0.9, -6.2], [-4, -0.9, -7.4], [-3, -0.9, -17], [3, -1, -21]]} radius={0.1} material={m.cable} />
    <Seam points={[[27, -1, -21], [30, -2, -26], [29, -15, -28], [29, -40.8, -29], [34, -41.8, -32]]} radius={0.13} material={m.cable} />
    <Contact at={[15, -1.08, 7.7]} size={[4.4, 4.4]} material={m.shadow} />
    <mesh position={[15, 1.55, 7.7]} material={m.steel}><cylinderGeometry args={[1.03, 1.03, 5.2, 32]} /></mesh>
    <mesh position={[15, 1.45, 7.7]} material={m.blue}><cylinderGeometry args={[1.045, 1.045, 2.5, 32]} /></mesh>
    <mesh position={[15, 4.17, 7.7]} rotation={[-Math.PI / 2, 0, 0]} material={m.frame}><torusGeometry args={[0.9, 0.06, 6, 32]} /></mesh>
    <mesh position={[15, 4.19, 7.7]} rotation={[-Math.PI / 2, 0, 0]} material={m.steel}><ringGeometry args={[0.25, 0.48, 16]} /></mesh>
    <Chair m={m} />
    <RoomDecor />
  </group></Baked>;
});
RoomSet.displayName = "RoomSet";
