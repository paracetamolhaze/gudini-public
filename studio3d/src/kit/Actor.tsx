import React, { useMemo } from "react";
import * as THREE from "three";
import { useCurrentFrame, useVideoConfig } from "remotion";
import { useInput } from "../input";
import { Blocky } from "./Blocky";
import { Human } from "./Human";
import { feet, keyPress, restSink } from "./ground";
import { blobShadow } from "./textures";
import { actorPlace, actorYaw, useTimeline, type ActorProps } from "./timeline";

/**
 * Places one cast member on the floor: position and turn come from the timeline, the body from cast.json.
 * A soft blob shadow grounds it. No glow behind the speaker (the owner, 2026-10-23: «убери свечение голубое,
 * когда кто-то говорит»): who speaks is told by the shot and the mouth.
 */
export const Actor: React.FC<ActorProps> = ({ id }) => {
  const input = useInput();
  const timeline = useTimeline();
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const member = input.cast[id];
  const shadow = useMemo(() => new THREE.MeshBasicMaterial({ map: blobShadow(), transparent: true, depthWrite: false, opacity: 0.85 }), []);
  if (!member) return null;
  const [x, z] = actorPlace(timeline, id, t);
  const yaw = actorYaw(timeline, id, t);
  const human = member.kind === "human";
  // he stands on a pressed key: down with it, up with it when he takes off (the keyboard draws the same key)
  const sink = restSink(x, z) * keyPress(feet(timeline, id, member.kind, t).lift);
  return (
    <group position={[x, -sink, z]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.004, 0]} material={shadow}>
        <planeGeometry args={[human ? 1.1 : 1.4, human ? 1.1 : 1.0]} />
      </mesh>
      <group rotation={[0, yaw, 0]}>{member.kind === "human" ? <Human id={id} look={member.look} /> : <Blocky id={id} color={member.color} />}</group>
    </group>
  );
};
