import React from "react";
import * as THREE from "three";
import { useCurrentFrame, useVideoConfig } from "remotion";
import { useTimeline, type LightMood } from "./timeline";
import { window01 } from "./util";
import { Keys } from "./Keys";
import { PcFans, RoomSet } from "./RoomSet";
import { Dust } from "./Dust";
import { ScreenPainter, screenLight } from "./Screens";

/** Lighting remains driven by the existing director timeline. The room itself is portable geometry. */
const MOODS: Record<LightMood, { key: string; keyI: number; rim: string; rimI: number; hemi: number; glow: string; keys: string; keysI: number }> = {
  night: { key: "#b5bddc", keyI: 0.72, rim: "#9c77ff", rimI: 0.72, hemi: 0.16, glow: "#983dff", keys: "#6ab7a5", keysI: 0.5 },
  warm: { key: "#ffd6ab", keyI: 2.5, rim: "#f9ad8a", rimI: 1.3, hemi: 0.85, glow: "#ff924e", keys: "#ffa257", keysI: 0.55 },
  alarm: { key: "#ff8c8c", keyI: 2.4, rim: "#ff404b", rimI: 1.8, hemi: 0.6, glow: "#ff325e", keys: "#ff2f45", keysI: 0.85 },
  money: { key: "#fff1c8", keyI: 2.4, rim: "#88eab9", rimI: 1.6, hemi: 0.85, glow: "#42dfa0", keys: "#38e08c", keysI: 0.8 },
  spot: { key: "#fff4e0", keyI: 2.8, rim: "#9daaff", rimI: 1.2, hemi: 0.5, glow: "#8461f7", keys: "#8f9fd6", keysI: 0.22 },
  dark: { key: "#a6b0ea", keyI: 1.1, rim: "#7b67d6", rimI: 0.9, hemi: 0.4, glow: "#713fd1", keys: "#4b5fb3", keysI: 0.22 },
};
const mix = (a: string, b: string, k: number) => `#${new THREE.Color(a).lerp(new THREE.Color(b), k).getHexString()}`;
const useMood = (t: number) => {
  const { lights } = useTimeline();
  let m = { ...MOODS.night };
  for (const light of lights) {
    const w = window01(t, light.from, light.to, 0.35);
    if (w <= 0) continue;
    const target = MOODS[light.mood];
    const pulse = light.mood === "alarm" ? 0.78 + 0.22 * Math.abs(Math.sin(t * 5)) : 1;
    m = {
      key: mix(m.key, target.key, w), keyI: m.keyI + (target.keyI * pulse - m.keyI) * w,
      rim: mix(m.rim, target.rim, w), rimI: m.rimI + (target.rimI * pulse - m.rimI) * w,
      hemi: m.hemi + (target.hemi - m.hemi) * w, glow: mix(m.glow, target.glow, w),
      keys: mix(m.keys, target.keys, w), keysI: m.keysI + (target.keysI * pulse - m.keysI) * w,
    };
  }
  return m;
};

/** A finite miniature keyboard on User's desk, inside a complete cutaway room. */
export const World: React.FC = () => {
  const frame = useCurrentFrame(); const { fps } = useVideoConfig();
  const t = frame / fps;
  const mood = useMood(t);
  const timeline = useTimeline();
  // the screens light whoever stands before them in their own colour: the vertical one the owner, the monitor Claude
  const vertical = screenLight(timeline, "vertical", t);
  const monitor = screenLight(timeline, "monitor", t);
  return <group name="User room stage">
    <color attach="background" args={["#080811"]} />
    <hemisphereLight args={["#9c9bbd", "#241d2c", mood.hemi]} />
    <directionalLight position={[7, 42, 32]} color={mood.key} intensity={mood.keyI} castShadow
      shadow-mapSize-width={1536} shadow-mapSize-height={1536}
      shadow-camera-left={-43} shadow-camera-right={43} shadow-camera-top={43} shadow-camera-bottom={-43}
      shadow-camera-near={0.5} shadow-camera-far={170} shadow-bias={-0.0001} shadow-normalBias={0.025} />
    <directionalLight position={[-33, 20, 9]} color="#8f9ab7" intensity={mood.keyI * 0.23} />
    <directionalLight position={[20, 27, -30]} color={mood.rim} intensity={mood.rimI} />
    <pointLight position={[24, 10, -5]} color={mood.glow} intensity={190} distance={48} decay={2} />
    <pointLight position={[24, 31, -28]} color={mood.glow} intensity={70} distance={36} decay={2} />
    <pointLight position={[1, 10, -12]} color={mix("#a9c1ff", monitor.color, 0.55)} intensity={50 + 45 * monitor.power} distance={35} decay={2} />
    <pointLight position={[-16, 9, -9]} color={vertical.color} intensity={230 * vertical.power} distance={30} decay={2} />
    <pointLight position={[-1, 4, 6]} color="#e7d9ce" intensity={70} distance={15} decay={2} />
    <ScreenPainter />
    <RoomSet />
    <PcFans spin={t * Math.PI * 2 * 0.55} />
    <Keys glow={mood.keys} glowI={mood.keysI} />
    <Dust t={t} color={mix("#c8b6ff", mood.glow, 0.3)} />
  </group>;
};

export const FLOOR_Y = 0;
