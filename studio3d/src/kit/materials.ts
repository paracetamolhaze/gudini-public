import * as THREE from "three";

/**
 * Matte clay for every voxel surface. The software renderer pays per pixel for each light,
 * and a physically based material costs much more than Lambert while the matte voxel look is the same.
 */
export const clay = (p: { color?: THREE.ColorRepresentation; map?: THREE.Texture | null }) =>
  new THREE.MeshLambertMaterial({ color: p.color ?? "#ffffff", map: p.map ?? null });
