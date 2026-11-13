import React, { useMemo } from "react";
import * as THREE from "three";
import { glowSprite } from "./textures";
import { hash, wobble } from "./util";

const COUNT = 150;
/** The air between the heroes and the screens: x, y, z ranges in key units. */
const BOX: [number, number][] = [[-22, 24], [-0.5, 20], [-15, -2.5]];

/**
 * Dust in the light of the screens: soft specks drifting slowly behind the heroes. Out of focus they read as the
 * bokeh of the room; never in front of the heroes.
 */
export const Dust: React.FC<{ t: number; color: string }> = ({ t, color }) => {
  const { geometry, material } = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(COUNT * 3), 3));
    const m = new THREE.PointsMaterial({ map: glowSprite(), size: 0.22, sizeAttenuation: true, transparent: true, opacity: 0.32, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
    return { geometry: g, material: m };
  }, []);
  const position = geometry.getAttribute("position") as THREE.BufferAttribute;
  for (let i = 0; i < COUNT; i++) {
    // each speck sinks slowly and sways; it wraps from the floor of the box back to its top
    const [x0, x1] = BOX[0]; const [y0, y1] = BOX[1]; const [z0, z1] = BOX[2];
    const span = y1 - y0;
    const y = y1 - (((hash(i, 2) * span + t * (0.15 + hash(i, 4) * 0.25)) % span) + span) % span;
    position.setXYZ(i, x0 + hash(i, 1) * (x1 - x0) + wobble(t * 0.2 + i, 7) * 0.8, y, z0 + hash(i, 3) * (z1 - z0) + wobble(t * 0.17 + i, 9) * 0.6);
  }
  position.needsUpdate = true;
  material.color.set(color);
  return <points geometry={geometry} material={material} frustumCulled={false} />;
};
