import * as THREE from "three";
import { hash } from "./util";

/** A molded keycap: tapered walls, a rounded shoulder and a shallow scooped top. */
export const keyboardCapGeometry = () => {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const rings = [
    { y: -0.32, half: 0.475, radius: 0.075 },
    { y: -0.29, half: 0.5, radius: 0.085 },
    { y: -0.065, half: 0.465, radius: 0.085 },
    { y: 0, half: 0.425, radius: 0.095 },
    { y: -0.008, half: 0.32, radius: 0.09 },
  ];
  const corners = 4;
  const subdivisions = 3;
  const perimeter = corners * (subdivisions + 1);
  rings.forEach(({ y, half, radius }) => {
    for (let corner = 0; corner < corners; corner++) {
      const a = corner * Math.PI / 2;
      const cx = corner === 0 || corner === 3 ? half - radius : -half + radius;
      const cz = corner < 2 ? half - radius : -half + radius;
      for (let step = 0; step <= subdivisions; step++) {
        const angle = a + step / subdivisions * Math.PI / 2;
        const x = cx + Math.cos(angle) * radius;
        const z = cz + Math.sin(angle) * radius;
        positions.push(x, y, z);
        uvs.push(x + 0.5, 0.5 - z);
      }
    }
  });
  // The first three rings are the sides, including the curved shoulder.
  for (let ring = 0; ring < rings.length - 1; ring++) {
    for (let vertex = 0; vertex < perimeter; vertex++) {
      const next = (vertex + 1) % perimeter;
      const lo = ring * perimeter + vertex;
      const lon = ring * perimeter + next;
      const hi = (ring + 1) * perimeter + vertex;
      const hin = (ring + 1) * perimeter + next;
      indices.push(lo, hi, lon, lon, hi, hin);
    }
  }
  const center = positions.length / 3;
  positions.push(0, -0.014, 0);
  uvs.push(0.5, 0.5);
  const topRing = (rings.length - 1) * perimeter;
  for (let vertex = 0; vertex < perimeter; vertex++) {
    indices.push(center, topRing + (vertex + 1) % perimeter, topRing + vertex);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  const sideIndices = 3 * perimeter * 6;
  geometry.addGroup(0, sideIndices, 0);
  geometry.addGroup(sideIndices, indices.length - sideIndices, 1);
  geometry.computeVertexNormals();
  return geometry;
};

const grainCache = new Map<string, THREE.CanvasTexture>();

/** Filtered fine-grain ABS; the same seed is used on every rendered frame. */
export const stageGrain = (label = "", top = false, color = "#ffffff") => {
  const key = `${label}|${top}|${color}`;
  const existing = grainCache.get(key);
  if (existing) return existing;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 256;
  const ctx = canvas.getContext("2d")!;
  const data = ctx.createImageData(256, 256);
  for (let y = 0; y < 256; y++) {
    for (let x = 0; x < 256; x++) {
      const n = Math.round(236 + hash(x, y, 97) * 19);
      const i = (y * 256 + x) * 4;
      data.data[i] = data.data[i + 1] = data.data[i + 2] = n;
      data.data[i + 3] = 255;
    }
  }
  ctx.putImageData(data, 0, 0);
  ctx.globalCompositeOperation = "multiply";
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 256, 256);
  ctx.globalCompositeOperation = "source-over";
  if (top) {
    const dish = ctx.createRadialGradient(128, 120, 30, 128, 128, 136);
    dish.addColorStop(0, "rgba(0,0,0,0.11)");
    dish.addColorStop(0.62, "rgba(0,0,0,0.02)");
    dish.addColorStop(1, "rgba(255,255,255,0.03)");
    ctx.fillStyle = dish;
    ctx.fillRect(0, 0, 256, 256);
  }
  if (label) {
    ctx.font = "600 62px 'JetBrains Mono', monospace";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillStyle = "rgba(2,5,18,0.7)";
    ctx.fillText(label, 50, 46);
    ctx.fillStyle = "#b5c6ee";
    ctx.fillText(label, 49, 44);
    // A tiny secondary legend makes these read as manufactured keycaps in close shots.
    ctx.fillStyle = "rgba(150,172,220,0.36)";
    ctx.fillRect(52, 184, 21, 3);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  grainCache.set(key, texture);
  return texture;
};

export const keyPlastic = (color: string, label?: string, top = false) => new THREE.MeshStandardMaterial({
  color: label ? "#ffffff" : color,
  map: stageGrain(label, top, label ? color : "#ffffff"),
  roughness: 0.68,
  metalness: 0.08,
  bumpMap: stageGrain(),
  bumpScale: 0.003,
});
