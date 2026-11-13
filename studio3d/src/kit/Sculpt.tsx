import React, { useMemo } from "react";
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import type { Vec3 } from "./util";

const surfaces = new Map<string, THREE.DataTexture>();

/** Construct from a unit box: r178's corner normals assume unit coordinates.
 * One segment (a 2-step arc with smooth normals, 108 instead of 300 triangles) reads the same
 * when the bevel spans only a few pixels: small voxel blocks, far room parts. */
export const roundedShape = (w: number, h: number, d: number, radius: number, segments = 2) => {
  const r = Math.min(radius, w / 3, h / 3, d / 3);
  const geometry = new RoundedBoxGeometry(1, 1, 1, segments, r);
  const p = geometry.attributes.position, n = geometry.attributes.normal, uv = geometry.attributes.uv;
  const perFace = p.count / 6;
  for (let i = 0; i < p.count; i++) {
    const x = (w / 2 - r) * Math.sign(p.getX(i)) + n.getX(i) * r;
    const y = (h / 2 - r) * Math.sign(p.getY(i)) + n.getY(i) * r;
    const z = (d / 2 - r) * Math.sign(p.getZ(i)) + n.getZ(i) * r;
    p.setXYZ(i, x, y, z);
    switch (Math.floor(i / perFace)) {
      case 0: uv.setXY(i, 0.5 - z / d, y / h + 0.5); break;
      case 1: uv.setXY(i, z / d + 0.5, y / h + 0.5); break;
      case 2: uv.setXY(i, x / w + 0.5, 0.5 - z / d); break;
      case 3: uv.setXY(i, x / w + 0.5, z / d + 0.5); break;
      case 4: uv.setXY(i, x / w + 0.5, y / h + 0.5); break;
      case 5: uv.setXY(i, 0.5 - x / w, y / h + 0.5); break;
    }
  }
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
};

/** A small, seamless height map: actual shading detail, independent of the colour/print. */
export const surfaceRelief = (kind: "cotton" | "denim" | "rubber") => {
  const hit = surfaces.get(kind);
  if (hit) return hit;
  const size = 128;
  const pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const grain = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
    const n = grain - Math.floor(grain);
    const weave = kind === "cotton"
      ? Math.sin(x * Math.PI / 2) * Math.cos(y * Math.PI / 2) * 35
      : kind === "denim" ? Math.sin((x + y) * Math.PI / 3.2) * 28 : 0;
    const v = Math.round(128 + weave + (n - 0.5) * (kind === "rubber" ? 60 : 20));
    const i = (y * size + x) * 4;
    pixels[i] = pixels[i + 1] = pixels[i + 2] = v;
    pixels[i + 3] = 255;
  }
  const texture = new THREE.DataTexture(pixels, size, size, THREE.RGBAFormat);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.repeat.set(kind === "rubber" ? 2 : 3, kind === "rubber" ? 2 : 3);
  texture.needsUpdate = true;
  surfaces.set(kind, texture);
  return texture;
};

/** Part of one flat face that another solid always hides: `axis` 0/1/2 is the face normal x/y/z,
 * `side` its sign, `holes` are [a0, a1, b0, b1] rectangles in the face's other two axes (x before z). */
export type Covered = { axis: 0 | 1 | 2; side: 1 | -1; holes: [number, number, number, number][] };

/** Cuts the hidden rectangles out of one flat face. The software renderer has no early depth
 * rejection, so a face under a mat or behind a screen is shaded pixel for pixel like a visible one;
 * what remains of the face keeps its position, normal and uv exactly. */
export const withHoles = (source: THREE.BufferGeometry, { axis, side, holes }: Covered) => {
  const g = source.index ? source.toNonIndexed() : source;
  const p = g.getAttribute("position"), n = g.getAttribute("normal"), uv = g.getAttribute("uv");
  const [ua, ub] = axis === 0 ? [1, 2] : axis === 1 ? [0, 2] : [0, 1];
  const kept: number[] = [], flat: number[] = [];
  for (let i = 0; i < p.count; i += 3) ([0, 1, 2].every((j) => n.getComponent(i + j, axis) * side > 0.9999) ? flat : kept).push(i);
  if (!flat.length) return g;
  // The flat face is one rectangle; uv is affine across it, so three corners give the map.
  let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
  for (const i of flat) for (let j = 0; j < 3; j++) {
    const a = p.getComponent(i + j, ua), b = p.getComponent(i + j, ub);
    a0 = Math.min(a0, a); a1 = Math.max(a1, a); b0 = Math.min(b0, b); b1 = Math.max(b1, b);
  }
  const depth = p.getComponent(flat[0], axis);
  const t = flat[0], m = new THREE.Matrix3().set(
    1, p.getComponent(t, ua), p.getComponent(t, ub),
    1, p.getComponent(t + 1, ua), p.getComponent(t + 1, ub),
    1, p.getComponent(t + 2, ua), p.getComponent(t + 2, ub)).invert();
  const fit = (k: 0 | 1) => new THREE.Vector3(uv.getComponent(t, k), uv.getComponent(t + 1, k), uv.getComponent(t + 2, k)).applyMatrix3(m);
  const fu = fit(0), fv = fit(1);
  let pieces: [number, number, number, number][] = [[a0, a1, b0, b1]];
  for (const [h0, h1, k0, k1] of holes) pieces = pieces.flatMap(([x0, x1, y0, y1]): [number, number, number, number][] => {
    const c0 = Math.max(x0, h0), c1 = Math.min(x1, h1), d0 = Math.max(y0, k0), d1 = Math.min(y1, k1);
    if (c0 >= c1 || d0 >= d1) return [[x0, x1, y0, y1]];
    return ([[x0, c0, y0, y1], [c1, x1, y0, y1], [c0, c1, y0, d0], [c0, c1, d1, y1]] as [number, number, number, number][]).filter(([q0, q1, r0, r1]) => q1 > q0 && r1 > r0);
  });
  const pos: number[] = [], nor: number[] = [], tex: number[] = [];
  const push = (a: number, b: number) => {
    const v = [0, 0, 0]; v[axis] = depth; v[ua] = a; v[ub] = b; pos.push(v[0], v[1], v[2]);
    const nn = [0, 0, 0]; nn[axis] = side; nor.push(nn[0], nn[1], nn[2]);
    tex.push(fu.x + fu.y * a + fu.z * b, fv.x + fv.y * a + fv.z * b);
  };
  for (const i of kept) for (let j = 0; j < 3; j++) {
    pos.push(p.getX(i + j), p.getY(i + j), p.getZ(i + j)); nor.push(n.getX(i + j), n.getY(i + j), n.getZ(i + j)); tex.push(uv.getX(i + j), uv.getY(i + j));
  }
  // Front faces wind counter-clockwise seen from outside; (a, b) turn that way around +x and +z, the other way around +y.
  const ccw = (axis === 1 ? -1 : 1) * side > 0;
  for (const [x0, x1, y0, y1] of pieces) {
    const quad: [number, number][] = ccw ? [[x0, y0], [x1, y0], [x1, y1], [x0, y1]] : [[x0, y0], [x0, y1], [x1, y1], [x1, y0]];
    for (const k of [0, 1, 2, 0, 2, 3]) push(...quad[k]);
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute("uv", new THREE.Float32BufferAttribute(tex, 2));
  out.computeBoundingBox(); out.computeBoundingSphere();
  if (g !== source) g.dispose();
  return out;
};

/** Bevels catch the set lights, while the silhouette and joints stay compatible with the director. */
export const Sculpt: React.FC<{
  size: Vec3;
  radius?: number;
  position?: Vec3;
  rotation?: Vec3;
  material: THREE.Material | THREE.Material[];
  taper?: number;
  segments?: number;
  covered?: Covered;
}> = ({ size, radius = 0.025, position, rotation, material, taper = 0, segments = 2, covered }) => {
  const [w, h, d] = size;
  const coverKey = covered ? JSON.stringify(covered) : "";
  const geometry = useMemo(() => {
    const g = roundedShape(w, h, d, radius, segments);
    if (covered) return withHoles(g, covered);
    if (taper) {
      const p = g.attributes.position, n = g.attributes.normal;
      for (let i = 0; i < p.count; i++) {
        const k = 1 - taper * (0.5 - p.getY(i) / h);
        const normal = new THREE.Vector3(n.getX(i) / k, n.getY(i) - n.getX(i) * p.getX(i) * taper / (h * k), n.getZ(i)).normalize();
        n.setXYZ(i, normal.x, normal.y, normal.z);
        p.setX(i, p.getX(i) * k);
      }
      g.computeBoundingBox();
      g.computeBoundingSphere();
    }
    return g;
  }, [w, h, d, radius, taper, segments, coverKey]);
  return <mesh geometry={geometry} material={material} position={position} rotation={rotation} castShadow receiveShadow dispose={null} />;
};

/** A raised seam, lace or chain with a physically round cross-section. */
export const Seam: React.FC<{ points: Vec3[]; radius?: number; material: THREE.Material }> = ({ points, radius = 0.004, material }) => {
  const key = JSON.stringify(points);
  const geometry = useMemo(() => new THREE.TubeGeometry(
    new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p))),
    Math.max(8, points.length * 4), radius, 5, false,
  ), [key, radius]);
  return <mesh geometry={geometry} material={material} castShadow dispose={null} />;
};
