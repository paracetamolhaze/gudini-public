import * as THREE from "three";

/** Broad material facets for the voxel collectible. Geometry supplies the
 * stepped silhouette; these maps only separate neighbouring matte planes.
 * Standard PBR maps are embedded unchanged by GLTFExporter. */
export type VoxelSurfaceOptions = {
  columns?: number;
  rows?: number;
  seed?: number;
  /** Relative colour change. Keep this below .06 to avoid a checkerboard. */
  variation?: number;
  /** Slope of the broad normal facets, not displacement of the silhouette. */
  normalStrength?: number;
  roughness?: number;
};

type Surface = { map: THREE.DataTexture; normalMap: THREE.DataTexture; roughnessMap: THREE.DataTexture };
type Settings = Required<VoxelSurfaceOptions>;
const surfaces = new Map<string, Surface>();
const clothMaps = new WeakMap<THREE.Texture, Map<string, THREE.Texture>>();
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const random = (x: number, y: number, seed: number) => {
  const n = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453;
  return n - Math.floor(n);
};

const settings = (kind: "skin" | "cloth", options: VoxelSurfaceOptions): Settings => ({
  columns: Math.max(2, Math.round(options.columns ?? (kind === "skin" ? 6 : 8))),
  rows: Math.max(2, Math.round(options.rows ?? (kind === "skin" ? 9 : 10))),
  seed: options.seed ?? (kind === "skin" ? 41 : 67),
  variation: clamp(options.variation ?? (kind === "skin" ? .035 : .030), 0, .10),
  normalStrength: clamp(options.normalStrength ?? (kind === "skin" ? .045 : .060), 0, .20),
  roughness: clamp(options.roughness ?? (kind === "skin" ? .78 : .91), .35, 1),
});

/** Joined two-to-three-cell patches and small residual tile variation avoid
 * alternating light/dark squares. There is no pixel noise or baked lighting. */
function tile(x: number, y: number, s: Settings) {
  const band = Math.floor(y / 2), shift = Math.floor(random(band, 0, s.seed) * 3);
  const regionX = Math.floor((x + shift) / 2.6), regionY = Math.floor(y / 2.4);
  const region = random(regionX, regionY, s.seed) * 2 - 1;
  const local = random(x, y, s.seed + 17) * 2 - 1;
  const shade = 1 + s.variation * (region * .80 + local * .20);
  return {
    shade,
    warm: (random(regionX, regionY, s.seed + 7) - .5) * s.variation * .20,
    nx: (random(regionX, regionY, s.seed + 23) * 2 - 1) * s.normalStrength,
    ny: (random(regionX, regionY, s.seed + 31) * 2 - 1) * s.normalStrength,
    rough: .94 + random(x, y, s.seed + 47) * .06,
  };
}

function texture(bytes: Uint8Array, size: number, name: string, colour = false) {
  const t = new THREE.DataTexture(bytes, size, size, THREE.RGBAFormat);
  t.name = name;
  if (colour) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

function surface(colour: string, s: Settings): Surface {
  const key = JSON.stringify([colour, s]), cached = surfaces.get(key);
  if (cached) return cached;
  const size = 256, albedo = new Uint8Array(size * size * 4);
  const normals = new Uint8Array(albedo.length), roughness = new Uint8Array(albedo.length);
  const base = new THREE.Color(colour).convertLinearToSRGB();
  const planes = Array.from({ length: s.rows }, (_, y) =>
    Array.from({ length: s.columns }, (_, x) => tile(x, y, s)));
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const plane = planes[Math.floor(y / size * s.rows)][Math.floor(x / size * s.columns)];
    const i = (y * size + x) * 4;
    const channels = [base.r * plane.shade * (1 + plane.warm), base.g * plane.shade, base.b * plane.shade * (1 - plane.warm)];
    for (let k = 0; k < 3; k++) albedo[i + k] = Math.round(clamp(channels[k], 0, 1) * 255);
    albedo[i + 3] = 255;
    const n = new THREE.Vector3(plane.nx, plane.ny, 1).normalize();
    normals[i] = Math.round((n.x * .5 + .5) * 255);
    normals[i + 1] = Math.round((n.y * .5 + .5) * 255);
    normals[i + 2] = Math.round((n.z * .5 + .5) * 255);
    normals[i + 3] = 255;
    roughness[i] = roughness[i + 1] = roughness[i + 2] = Math.round(plane.rough * 255);
    roughness[i + 3] = 255;
  }
  const result = {
    map: texture(albedo, size, "Voxel broad colour facets", true),
    normalMap: texture(normals, size, "Voxel broad plane normals"),
    roughnessMap: texture(roughness, size, "Voxel matte plane roughness"),
  };
  surfaces.set(key, result);
  return result;
}

/** Shared palette for head, ears, neck, forearms and hands. The colour is
 * baked once in the albedo, so do not multiply it by look.skin again. */
export function voxelSkinMaterial(skin: string, options: VoxelSurfaceOptions = {}) {
  const s = settings("skin", options), maps = surface(skin, s);
  const material = new THREE.MeshStandardMaterial({
    color: "#ffffff", ...maps, roughness: s.roughness, metalness: 0,
  });
  material.name = "Warm matte voxel skin";
  return material;
}

/** Preserve an existing jersey print/stripes exactly while softly separating
 * broad cloth planes. There are no new seams, borders or fine pixel speckles. */
export function voxelClothMap(source: THREE.Texture, options: VoxelSurfaceOptions = {}): THREE.Texture {
  const s = settings("cloth", options), key = JSON.stringify(s);
  let variants = clothMaps.get(source);
  if (!variants) { variants = new Map(); clothMaps.set(source, variants); }
  const cached = variants.get(key);
  if (cached) return cached;
  const image = source.image as HTMLCanvasElement | HTMLImageElement | undefined;
  if (typeof document === "undefined" || !image || !("width" in image)) return source;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1024;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return source;
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  const planes = Array.from({ length: s.rows }, (_, y) =>
    Array.from({ length: s.columns }, (_, x) => tile(x, y, s)));
  for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
    const plane = planes[Math.floor(y / canvas.height * s.rows)][Math.floor(x / canvas.width * s.columns)];
    const i = (y * canvas.width + x) * 4;
    // Keep dark logos and pinstripes readable; mostly shade the pale fabric.
    const light = Math.max(pixels.data[i], pixels.data[i + 1], pixels.data[i + 2]) / 255;
    const factor = 1 + (plane.shade - 1) * (.30 + .70 * light);
    for (let k = 0; k < 3; k++) pixels.data[i + k] = clamp(Math.round(pixels.data[i + k] * factor), 0, 255);
  }
  context.putImageData(pixels, 0, 0);
  const result = new THREE.CanvasTexture(canvas);
  result.name = "Jersey print with broad cloth facets";
  result.colorSpace = THREE.SRGBColorSpace;
  result.wrapS = source.wrapS; result.wrapT = source.wrapT;
  result.repeat.copy(source.repeat); result.offset.copy(source.offset);
  result.rotation = source.rotation; result.center.copy(source.center);
  result.anisotropy = 4;
  variants.set(key, result);
  return result;
}

export function voxelClothMaterial(source: THREE.Texture, options: VoxelSurfaceOptions = {}) {
  const s = settings("cloth", options), maps = surface("#ffffff", s);
  const material = new THREE.MeshStandardMaterial({
    map: voxelClothMap(source, options), normalMap: maps.normalMap,
    roughnessMap: maps.roughnessMap, roughness: s.roughness, metalness: 0,
  });
  material.name = "Matte voxel cloth retaining wardrobe print";
  return material;
}
