import React, { useMemo } from "react";
import * as THREE from "three";
import { useCurrentFrame, useVideoConfig } from "remotion";
import { useInput } from "../input";
import { feet, KEY_COLS, KEY_PITCH, KEY_ROWS, KEY_TRAVEL, keyPress, keysUnder } from "./ground";
import { keyboardCapGeometry, keyPlastic } from "./StageSurface";
import { actorPlace, useTimeline, type Timeline } from "./timeline";
import { hash } from "./util";

const LABELS = [
  ["ESC", "F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8", "F9", "F10", "F11", "F12", "DEL", "⌽"],
  ["`", "1", "2", "3", "4", "5", "6", "7", "8", "9", "0", "-", "+", "←", "HOME"],
  ["TAB", "Q", "W", "E", "R", "T", "Y", "U", "I", "O", "P", "[", "]", "\\", "PG"],
  ["CAP", "A", "S", "D", "F", "G", "H", "J", "K", "L", ";", "'", "↵", "↑", "PG"],
  ["SHF", "Z", "X", "C", "V", "B", "N", "M", ",", ".", "/", "SHF", "←", "↓", "→"],
  ["CTL", "⌘", "ALT", "FN", "", "", "", "SPACE", "", "", "", "ALT", "FN", "CTL", "END"],
];
// the space bar is one long cap of the static keyboard; these sockets stay empty
const spaceRow = (row: number, col: number) => row === 5 && col >= 4 && col <= 10;
const index = (row: number, col: number) => row * KEY_COLS + col;
const keyX = (col: number) => (col - 7) * KEY_PITCH;
const keyZ = (row: number) => (row - 2.5) * KEY_PITCH;

/** Every key a hero stands on at some moment of the video: these move, all the others never do. */
const touchedKeys = (timeline: Timeline) => {
  const found = new Map<number, { row: number; col: number }>();
  const mark = (id: string, t: number) => {
    const [x, z] = actorPlace(timeline, id, t);
    for (const k of keysUnder(x, z)) if (!spaceRow(k.row, k.col)) found.set(index(k.row, k.col), k);
  };
  for (const actor of timeline.actors) {
    mark(actor.id, 0);
    for (const m of timeline.moves) if (m.who === actor.id) for (let t = m.from; t <= m.to + 0.05; t += 0.05) mark(actor.id, t);
  }
  return [...found.values()];
};

/** Printed legends: one decal for the keys that never move, a decal of its own on each key a hero stands on. */
const legendCanvas = (w: number, h: number, draw: (c: CanvasRenderingContext2D) => void) => {
  const canvas = document.createElement("canvas"); canvas.width = w; canvas.height = h;
  const c = canvas.getContext("2d")!;
  c.fillStyle = "#28313f"; c.font = "600 38px monospace"; c.textAlign = "center"; c.textBaseline = "middle";
  draw(c);
  const map = new THREE.CanvasTexture(canvas); map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = 8;
  return new THREE.MeshBasicMaterial({ map, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 });
};

/** Soft bands of the backlight that drift across the board, like a keyboard's lighting effect. */
const backlightBands = () => {
  const canvas = document.createElement("canvas"); canvas.width = 256; canvas.height = 4;
  const c = canvas.getContext("2d")!;
  for (let x = 0; x < 256; x++) {
    const v = Math.round(255 * (0.62 + 0.38 * (0.5 + 0.5 * Math.cos((x / 256) * Math.PI * 2))));
    c.fillStyle = `rgb(${v},${v},${v})`; c.fillRect(x, 0, 1, 4);
  }
  const map = new THREE.CanvasTexture(canvas); map.wrapS = THREE.RepeatWrapping; map.colorSpace = THREE.SRGBColorSpace;
  return map;
};

/**
 * The keys of the miniature keyboard and its backlight. A hero's key is down while he stands on it and springs
 * back while he is in the air (ground.ts); the backlight takes the colour of the room's light.
 */
export const Keys: React.FC<{ glow: string; glowI: number }> = ({ glow, glowI }) => {
  const timeline = useTimeline();
  const input = useInput();
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const cap = useMemo(keyboardCapGeometry, []);
  const touched = useMemo(() => touchedKeys(timeline), [timeline]);
  const keys = useMemo(() => {
    const material = [keyPlastic("#afb6c4"), keyPlastic("#afb6c4", "", true)];
    const mesh = new THREE.InstancedMesh(cap, material, KEY_COLS * KEY_ROWS);
    const matrix = new THREE.Matrix4(); const color = new THREE.Color();
    for (let row = 0; row < KEY_ROWS; row++) for (let col = 0; col < KEY_COLS; col++) {
      if (spaceRow(row, col)) matrix.makeScale(0, 0, 0);
      else matrix.makeTranslation(keyX(col), 0, keyZ(row));
      mesh.setMatrixAt(index(row, col), matrix);
      color.set(row === 0 && col === 0 ? "#57a7a2" : row === 5 ? "#5d687b" : hash(row, col) > 0.8 ? "#838f9f" : "#c1c6cf");
      mesh.setColorAt(index(row, col), color);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.castShadow = mesh.receiveShadow = true;
    return mesh;
  }, [cap]);
  const fixedLegends = useMemo(() => legendCanvas(2048, 768, (c) => {
    for (let row = 0; row < KEY_ROWS; row++) for (let col = 0; col < KEY_COLS; col++) {
      if (touched.some((k) => k.row === row && k.col === col)) continue;
      c.fillText(LABELS[row][col] ?? "", (col + 0.5) * 2048 / KEY_COLS, (row + 0.44) * 768 / KEY_ROWS);
    }
  }), [touched]);
  const ownLegends = useMemo(() => touched.map((k) => legendCanvas(137, 128, (c) => c.fillText(LABELS[k.row][k.col] ?? "", 68.5, 128 * 0.44))), [touched]);
  const bands = useMemo(backlightBands, []);
  const backlight = useMemo(() => new THREE.MeshLambertMaterial({ color: "#526d70", emissive: "#6ab7a5", emissiveIntensity: 0.5, emissiveMap: bands }), [bands]);
  const leds = useMemo(() => new THREE.MeshBasicMaterial({ color: "#90c8b8" }), []);

  // how deep each touched key is at this frame: the deepest press of anyone standing on it
  const depth = touched.map(() => 0);
  for (const actor of timeline.actors) {
    const kind = input.cast[actor.id]?.kind ?? "human";
    const [x, z] = actorPlace(timeline, actor.id, t);
    const press = KEY_TRAVEL * keyPress(feet(timeline, actor.id, kind, t).lift);
    for (const k of keysUnder(x, z)) {
      const i = touched.findIndex((q) => q.row === k.row && q.col === k.col);
      if (i >= 0) depth[i] = Math.max(depth[i], press * k.weight);
    }
  }
  const matrix = new THREE.Matrix4();
  touched.forEach((k, i) => keys.setMatrixAt(index(k.row, k.col), matrix.makeTranslation(keyX(k.col), -depth[i], keyZ(k.row))));
  keys.instanceMatrix.needsUpdate = true;
  backlight.emissive.set(glow);
  backlight.emissiveIntensity = glowI * (0.9 + 0.1 * Math.sin(t * 1.3));
  bands.offset.x = t * 0.045;
  leds.color.set(glow).lerp(new THREE.Color("#ffffff"), 0.35);

  return <group name="Live keys and backlight">
    <mesh position={[0, -0.278, 0]} rotation={[-Math.PI / 2, 0, 0]} material={backlight}><planeGeometry args={[16.9, 6.75]} /></mesh>
    <primitive object={keys} />
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.002, 0]} material={fixedLegends}><planeGeometry args={[16.8, 6.72]} /></mesh>
    {touched.map((k, i) => (
      <mesh key={index(k.row, k.col)} rotation={[-Math.PI / 2, 0, 0]} position={[keyX(k.col), 0.002 - depth[i], keyZ(k.row)]} material={ownLegends[i]}>
        <planeGeometry args={[16.8 / KEY_COLS, 6.72 / KEY_ROWS]} />
      </mesh>
    ))}
    {[-5, 0, 5].map((x) => <mesh key={x} position={[x, -0.32, 3.71]} material={leds}><boxGeometry args={[0.7, 0.04, 0.015]} /></mesh>)}
  </group>;
};
