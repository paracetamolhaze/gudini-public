import React, { useMemo } from "react";
import * as THREE from "three";
import { useCurrentFrame, useVideoConfig } from "remotion";
import { panelTexture, type PanelTone } from "./textures";
import { actorPlace, actorRestYaw, useTimeline, type Timeline } from "./timeline";
import { smooth, type Vec3 } from "./util";

export type PanelProps = {
  /** Centre of the window in the world; behind the actors means negative z. Not needed with `behind`. */
  at?: Vec3;
  /** Actor id: the window floats behind this actor, facing the camera of the actor's own shots. */
  behind?: string;
  /** With `behind`: metres behind the actor (default 7) and height of the centre (default 2.9). */
  depth?: number;
  height?: number;
  title: string;
  lines: string[];
  tone?: PanelTone;
  /** Width in metres; height follows 4:3. */
  size?: number;
  /** Seconds when the window appears and disappears; without them it is there all the time. */
  from?: number;
  to?: number;
  /** Baked blur in pixels: far windows are soft like out-of-focus background. */
  blur?: number;
  /** Turn around the vertical axis, degrees. */
  turn?: number;
};

/**
 * Where a window anchored to an actor stands: behind the actor along the line of the actor's single shots,
 * a little to the actor's outer side so the head covers less of it, turned to face that camera.
 */
export const panelBehind = (timeline: Timeline, id: string, t: number, depth: number, height: number): { at: Vec3; turn: number } => {
  const [x, z] = actorPlace(timeline, id, t);
  const az = actorRestYaw(timeline, id, t) * 0.55;
  const toCam: [number, number] = [Math.sin(az), Math.cos(az)];
  // the outer side: away from the partner, across the camera line
  const other = timeline.actors.find((a) => a.id !== id);
  const [ox] = other ? actorPlace(timeline, other.id, t) : [x - 1];
  const outward = Math.sign(x - ox) || 1;
  const across: [number, number] = [toCam[1] * outward, -toCam[0] * outward];
  return { at: [x - toCam[0] * depth + across[0] * 1.3, height, z - toCam[1] * depth + across[1] * 1.3], turn: (az * 180) / Math.PI };
};

/**
 * A floating terminal/app window behind the actors — the reference's screens with logs.
 * Its text tells the story's facts (prices, transactions, wallet lines), never repeats the dialogue.
 */
export const Panel: React.FC<PanelProps> = ({ at, behind, depth = 7, height = 2.9, title, lines, tone = "terminal", size = 3.2, from, to, blur, turn = 0 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const timeline = useTimeline();
  const t = frame / fps;
  // anchored windows stay where the actor stood when they appeared
  const anchored = behind ? panelBehind(timeline, behind, from ?? 0, depth, height) : null;
  const pos: Vec3 = anchored?.at ?? at ?? [0, 3, -9];
  const yaw = anchored ? anchored.turn : turn;
  const distance = behind ? depth : -pos[2];
  // background, like the reference's screens: always a little out of focus
  const soft = blur ?? (distance > 12 ? 3 : 2);
  const text = lines.join("\n");
  const mat = useMemo(
    () => new THREE.MeshBasicMaterial({ map: panelTexture(title, text.split("\n"), tone, soft), transparent: true, depthWrite: false, toneMapped: false }),
    [title, text, tone, soft],
  );
  const appear = from === undefined ? 1 : smooth((t - from) / 0.35);
  const vanish = to === undefined ? 1 : smooth((to - t) / 0.35);
  const k = Math.min(appear, vanish);
  if (k <= 0) return null;
  // dense enough that the room's screens behind do not show through the facts
  mat.opacity = 0.92 * k;
  // windows hang still: floating screens read as noise behind a dialogue
  const bob = 0;
  return (
    <mesh position={[pos[0], pos[1] + bob, pos[2]]} rotation={[0, (yaw * Math.PI) / 180, 0]} scale={[size * (0.85 + 0.15 * k), size * 0.75 * (0.85 + 0.15 * k), 1]} material={mat}>
      <planeGeometry args={[1, 1]} />
    </mesh>
  );
};
