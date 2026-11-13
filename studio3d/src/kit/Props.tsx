import React, { useMemo } from "react";
import * as THREE from "three";
import { useCurrentFrame, useVideoConfig } from "remotion";
import { clay } from "./materials";
import { labelTexture, screenTexture } from "./textures";
import { useInput } from "../input";
import { actorPlace, soloAzimuth, useTimeline } from "./timeline";
import { easeOut, smooth, type Vec3 } from "./util";

export type PropKind =
  | "coin" | "phone" | "laptop" | "wallet" | "key" | "paper" | "chart" | "rocket" | "lock" | "cash" | "chest"
  /** Not drawn: the owner (2026-10-22) wants no word signs in the frame; old scenes keep compiling. */
  | "sign";

export type PropProps = {
  kind: PropKind;
  /** World position of the prop's base; ignored when an actor holds it. */
  at?: Vec3;
  /** Actor id whose hand holds it ("me" holds in the right hand, "claude" on top of the right arm). */
  held?: string;
  /** Actor id: the prop stands on the floor beside this actor, on the outer side, toward the camera. */
  near?: string;
  from?: number;
  to?: number;
  /** Text on the prop: phone/laptop screen, paper lines (separated by " / "). */
  label?: string;
  /** chart: "up" or "down" (default up); coin: "btc" | "eth" | "usdt" emblem. */
  variant?: string;
  /** Size multiplier; world props default to a size that reads next to the actors. */
  size?: number;
  /** Slow turn around the vertical axis (coins, rockets on display). */
  spin?: boolean;
  /** Gentle floating in the air. */
  float?: boolean;
  /** Turn around the vertical axis, degrees. */
  turn?: number;
};

const GOLD = "#e8b53a";
const DARK = "#161b38";

/** The geometry of each prop at its natural size, base on y = 0, facing +z. */
const PropBody: React.FC<{ kind: PropKind; label?: string; variant?: string }> = ({ kind, label, variant }) => {
  const m = useMemo(
    () => ({
      gold: clay({ color: GOLD }),
      goldDark: clay({ color: "#b8862a" }),
      dark: clay({ color: DARK }),
      white: clay({ color: "#f1efe9" }),
      red: clay({ color: "#e0453a" }),
      green: clay({ color: "#2fbf71" }),
      brown: clay({ color: "#8a5a35" }),
      steel: clay({ color: "#9aa3b5" }),
      cash: clay({ color: "#6dbf6a" }),
      wood: clay({ color: "#a06b3c" }),
    }),
    [],
  );
  const screen = useMemo(() => clay({ map: screenTexture(label ?? "", kind === "laptop" ? "wide" : "tall") }), [label, kind]);
  const board = useMemo(() => clay({ map: labelTexture(label ?? "", "paper") }), [label]);
  const emblem = useMemo(() => clay({ map: labelTexture(variant === "eth" ? "Ξ" : variant === "usdt" ? "₮" : "B", "coin") }), [variant]);

  switch (kind) {
    case "coin":
      return (
        <group position={[0, 0.32, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <mesh material={[m.goldDark, emblem, emblem]}>
            <cylinderGeometry args={[0.32, 0.32, 0.08, 12]} />
          </mesh>
        </group>
      );
    case "phone":
      return (
        <group position={[0, 0.16, 0]}>
          <mesh material={[m.dark, m.dark, m.dark, m.dark, screen, m.dark]}>
            <boxGeometry args={[0.17, 0.32, 0.025]} />
          </mesh>
        </group>
      );
    case "laptop":
      return (
        <group>
          <mesh position={[0, 0.015, 0]} material={m.steel}>
            <boxGeometry args={[0.6, 0.03, 0.42]} />
          </mesh>
          <mesh position={[0, 0.22, -0.2]} rotation={[-0.25, 0, 0]} material={[m.steel, m.steel, m.steel, m.steel, screen, m.steel]}>
            <boxGeometry args={[0.6, 0.4, 0.025]} />
          </mesh>
        </group>
      );
    case "wallet":
      return (
        <group position={[0, 0.12, 0]}>
          <mesh material={m.brown}>
            <boxGeometry args={[0.42, 0.24, 0.1]} />
          </mesh>
          <mesh position={[0, 0.05, 0.055]} material={m.wood}>
            <boxGeometry args={[0.42, 0.12, 0.02]} />
          </mesh>
          <mesh position={[0.12, 0.05, 0.07]} material={m.gold}>
            <boxGeometry args={[0.06, 0.05, 0.02]} />
          </mesh>
        </group>
      );
    case "key":
      return (
        <group position={[0, 0.2, 0]} rotation={[0, 0, -0.3]}>
          <mesh position={[0, 0.12, 0]} material={m.gold}>
            <boxGeometry args={[0.2, 0.2, 0.05]} />
          </mesh>
          <mesh position={[0, 0.12, 0]} material={m.dark}>
            <boxGeometry args={[0.08, 0.08, 0.06]} />
          </mesh>
          <mesh position={[0, -0.12, 0]} material={m.gold}>
            <boxGeometry args={[0.05, 0.3, 0.05]} />
          </mesh>
          <mesh position={[0.05, -0.2, 0]} material={m.gold}>
            <boxGeometry args={[0.07, 0.04, 0.05]} />
          </mesh>
          <mesh position={[0.05, -0.12, 0]} material={m.gold}>
            <boxGeometry args={[0.06, 0.04, 0.05]} />
          </mesh>
        </group>
      );
    case "paper":
      return (
        <group position={[0, 0.25, 0]}>
          <mesh material={[m.white, m.white, m.white, m.white, board, m.white]}>
            <boxGeometry args={[0.36, 0.5, 0.01]} />
          </mesh>
        </group>
      );
    case "chart": {
      const up = variant !== "down";
      const heights = up ? [0.2, 0.32, 0.26, 0.45, 0.4, 0.62, 0.78] : [0.78, 0.6, 0.66, 0.4, 0.46, 0.22, 0.12];
      return (
        <group>
          <mesh position={[0, 0.5, -0.06]} material={m.dark}>
            <boxGeometry args={[1.2, 1.0, 0.05]} />
          </mesh>
          {heights.map((h, i) => {
            const green = up ? i === 0 || heights[i] >= heights[i - 1] : i > 0 && heights[i] >= heights[i - 1];
            return (
              <mesh key={i} position={[-0.45 + i * 0.15, 0.08 + h / 2, 0]} material={green ? m.green : m.red}>
                <boxGeometry args={[0.09, h * 0.8, 0.07]} />
              </mesh>
            );
          })}
        </group>
      );
    }
    case "rocket":
      return (
        <group>
          <mesh position={[0, 0.55, 0]} material={m.white}>
            <boxGeometry args={[0.3, 0.7, 0.3]} />
          </mesh>
          <mesh position={[0, 0.98, 0]} material={m.red}>
            <boxGeometry args={[0.2, 0.18, 0.2]} />
          </mesh>
          <mesh position={[0, 1.1, 0]} material={m.red}>
            <boxGeometry args={[0.1, 0.08, 0.1]} />
          </mesh>
          <mesh position={[0, 0.66, 0.16]} material={m.steel}>
            <boxGeometry args={[0.12, 0.12, 0.03]} />
          </mesh>
          {[-1, 1].map((s) => (
            <mesh key={s} position={[s * 0.2, 0.22, 0]} material={m.red}>
              <boxGeometry args={[0.1, 0.26, 0.2]} />
            </mesh>
          ))}
        </group>
      );
    case "lock":
      return (
        <group position={[0, 0.02, 0]}>
          <mesh position={[0, 0.17, 0]} material={m.gold}>
            <boxGeometry args={[0.34, 0.3, 0.12]} />
          </mesh>
          <mesh position={[-0.1, 0.42, 0]} material={m.steel}>
            <boxGeometry args={[0.05, 0.22, 0.05]} />
          </mesh>
          <mesh position={[0.1, 0.42, 0]} material={m.steel}>
            <boxGeometry args={[0.05, 0.22, 0.05]} />
          </mesh>
          <mesh position={[0, 0.52, 0]} material={m.steel}>
            <boxGeometry args={[0.25, 0.05, 0.05]} />
          </mesh>
          <mesh position={[0, 0.15, 0.065]} material={m.dark}>
            <boxGeometry args={[0.05, 0.1, 0.01]} />
          </mesh>
        </group>
      );
    case "cash":
      return (
        <group>
          {[0, 1, 2, 3].map((i) => (
            <mesh key={i} position={[0, 0.03 + i * 0.06, 0]} rotation={[0, i * 0.12, 0]} material={m.cash}>
              <boxGeometry args={[0.46, 0.055, 0.24]} />
            </mesh>
          ))}
          <mesh position={[0, 0.12, 0]} material={m.white}>
            <boxGeometry args={[0.08, 0.25, 0.25]} />
          </mesh>
        </group>
      );
    case "chest":
      return (
        <group>
          <mesh position={[0, 0.2, 0]} material={m.wood}>
            <boxGeometry args={[0.7, 0.4, 0.45]} />
          </mesh>
          <mesh position={[0, 0.47, 0]} material={m.brown}>
            <boxGeometry args={[0.72, 0.14, 0.47]} />
          </mesh>
          <mesh position={[0, 0.36, 0.235]} material={m.gold}>
            <boxGeometry args={[0.1, 0.14, 0.02]} />
          </mesh>
        </group>
      );
    case "sign":
      return null;
  }
};

/** Size of the prop in an actor's hand relative to its world size. */
const HELD_SCALE: Partial<Record<PropKind, number>> = { coin: 0.45, laptop: 0.6, chart: 0.35, rocket: 0.35, chest: 0.4, cash: 0.6, wallet: 0.7 };

/**
 * A voxel object of the crypto story. It pops in at `from` and shrinks away at `to`.
 * World props stand where `at` says; held props are drawn by the actor in its hand.
 */
export const Prop: React.FC<PropProps & { inHand?: boolean }> = ({ kind, at = [0, 0, 0], near, from, to, label, variant, size = 1, spin, float, turn = 0, inHand }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const timeline = useTimeline();
  const input = useInput();
  const t = frame / fps;
  if (near && !inHand) {
    // beside the actor where the actor's own medium and wide shots see it, across the line of those shots
    const human = input.cast[near]?.kind === "human";
    const [x, z] = actorPlace(timeline, near, from ?? 0);
    const az = soloAzimuth(timeline, near, from ?? 0, human ? "human" : "blocky");
    const other = timeline.actors.find((a) => a.id !== near);
    const [ox] = other ? actorPlace(timeline, other.id, from ?? 0) : [x - 1];
    // a block stands in the middle of its shots: the outer side, so the two-shot keeps the middle free;
    // the owner sits on the outer third of his: the frame edge is there, the prop goes to the open side
    const across = human ? Math.sign(az) || 1 : Math.sign(x - ox) || 1;
    at = [x + Math.cos(az) * 0.85 * across + Math.sin(az) * 0.2, at[1], z - Math.sin(az) * 0.85 * across + Math.cos(az) * 0.2];
  }
  const appear = from === undefined ? 1 : easeOut((t - from) / 0.3);
  const vanish = to === undefined ? 1 : smooth((to - t) / 0.25);
  const k = Math.max(0, Math.min(appear, vanish));
  if (k <= 0.001) return null;
  const pop = from !== undefined && t - from < 0.45 ? 1 + 0.18 * Math.sin(Math.min(1, (t - from) / 0.45) * Math.PI) : 1;
  const s = size * k * pop * (inHand ? HELD_SCALE[kind] ?? 1 : 1);
  const bob = float ? 0.08 * Math.sin(t * 2.2) + 0.15 : 0;
  const yaw = (turn * Math.PI) / 180 + (spin ? t * 1.6 : 0);
  return (
    <group position={inHand ? [0, 0, 0] : [at[0], at[1] + bob, at[2]]} rotation={[0, yaw, 0]} scale={s}>
      <PropBody kind={kind} label={label} variant={variant} />
    </group>
  );
};
