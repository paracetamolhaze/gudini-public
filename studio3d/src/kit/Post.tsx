import React, { useEffect, useMemo } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { BokehPass } from "three/examples/jsm/postprocessing/BokehPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { useFraming } from "./Camera";

/**
 * Depth of field of a miniature and a soft glow, as passes after the 3D render (graphics card only):
 * the hero in focus is sharp, the room behind him melts softly, the screens and LED strips glow a little.
 *
 * The blur grows with the distance from the focus and is tuned so a window behind a hero stays readable
 * (≈ 4 px at 8 keys behind him on a close-up) while the screens of the room go ≈ 9 px soft, like a monitor
 * behind someone filmed up close. A wide shot focuses farther and its background blurs less, as with a real lens.
 */
const APERTURE = 0.00045;
const CLOSE_FOCUS = 2.7;
const MAX_BLUR = 0.009;

export const Post: React.FC = () => {
  const { gl, scene, camera, size, viewport } = useThree();
  const framing = useFraming();
  const passes = useMemo(() => {
    const w = Math.round(size.width * viewport.dpr);
    const h = Math.round(size.height * viewport.dpr);
    // half floats keep the screens' highlights above 1 for the glow; 4 samples keep the edges as smooth as without passes
    const target = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples: 4 });
    const composer = new EffectComposer(gl, target);
    composer.setPixelRatio(viewport.dpr);
    composer.setSize(size.width, size.height);
    composer.addPass(new RenderPass(scene, camera));
    const bokeh = new BokehPass(scene, camera, { focus: CLOSE_FOCUS, aperture: APERTURE, maxblur: MAX_BLUR });
    composer.addPass(bokeh);
    composer.addPass(new UnrealBloomPass(new THREE.Vector2(w, h), 0.32, 0.45, 0.9));
    composer.addPass(new OutputPass());
    return { composer, bokeh };
  }, [gl, scene, camera, size.width, size.height, viewport.dpr]);
  useEffect(() => () => passes.composer.dispose(), [passes]);
  const focus = Math.hypot(framing.eye[0] - framing.aim[0], framing.eye[1] - framing.aim[1], framing.eye[2] - framing.aim[2]);
  // priority 1: R3F leaves the frame to this pass chain instead of rendering it itself
  useFrame(() => {
    const u = passes.bokeh.uniforms as Record<string, THREE.IUniform<number>>;
    u.focus.value = focus;
    u.aperture.value = APERTURE * Math.sqrt(CLOSE_FOCUS / Math.max(CLOSE_FOCUS, focus));
    passes.composer.render();
  }, 1);
  return null;
};
