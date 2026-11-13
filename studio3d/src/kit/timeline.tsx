import React, { createContext, useContext } from "react";
import { easeInOut, clamp } from "./util";
import { Prop, type PropProps } from "./Props";
import type { PopIcon } from "./textures";
import type { ScreenApp, Surface, Trend } from "./ScreenApps";

export type ShotKind = "close" | "medium" | "wide" | "over" | "low" | "high" | "tiny" | "desk";
export type ShotMove = "still" | "push" | "pull" | "orbit" | "rise" | "shake" | "whip";
export type Gesture =
  | "wave" | "shrug" | "facepalm" | "scratch" | "point" | "cross" | "hips" | "cheer" | "panic"
  | "think" | "phone" | "nod" | "shake" | "laugh" | "lean" | "slump" | "jump" | "hop" | "shiver"
  | "tilt" | "spin" | "sink" | "bounce" | "step";
export type Mood =
  | "neutral" | "happy" | "laugh" | "worried" | "shocked" | "angry" | "sad" | "smug" | "sleepy"
  | "love" | "dizzy" | "wink" | "thinking";
export type LookAt = string; // actor id, "camera", "away", "down", "up"
export type LightMood = "night" | "warm" | "alarm" | "money" | "spot" | "dark";

export type ShotProps = { from: number; to: number; on: string; kind: ShotKind; move?: ShotMove; side?: "left" | "right" | "front" };
export type ActProps = { who: string; from: number; to: number; do: Gesture };
export type FaceProps = { who: string; from: number; to: number; mood: Mood; blush?: boolean; sweat?: boolean };
export type LookProps = { who: string; from: number; to: number; at: LookAt };
export type MoveProps = { who: string; from: number; to: number; place: [number, number] };
export type LightProps = { from: number; to: number; mood: LightMood };
/** `facing` stays for old scenes: an id is the partner anyway, a turn in degrees is ignored (actorRestYaw). */
export type ActorProps = { id: string; at: [number, number]; facing?: string | number };
export type PopProps = { who: string; at: number; icon: PopIcon; for?: number };
export type ChannelProps = { from: number; to: number };
export type ScreenProps = { on: Surface; from: number; to: number; app: ScreenApp; title: string; lines?: string[]; trend?: Trend };

/** A camera shot: where the camera looks from `from` to `to` seconds. Cuts happen between shots. */
export const Shot: React.FC<ShotProps> = () => null;
/** A gesture of one actor over a time window. */
export const Act: React.FC<ActProps> = () => null;
/** A facial mood of one actor over a time window; the mouth still follows the voice. */
export const Face: React.FC<FaceProps> = () => null;
/** Where an actor turns the head. */
export const Look: React.FC<LookProps> = () => null;
/** An actor walks to a new place on the floor [x, z] during the window and stays there. */
export const Move: React.FC<MoveProps> = () => null;
/** Lighting mood of the whole set over a time window. */
export const Light: React.FC<LightProps> = () => null;
/** A small pixel reaction icon beside an actor's head for a moment (default 1.2 s): "!", "?", heart, skull… */
export const Pop: React.FC<PopProps> = () => null;
/** The owner's Telegram channel card with its QR code, flat on top of the frame (channel.json). */
export const Channel: React.FC<ChannelProps> = () => null;
/** What a screen of the room shows for a while: the monitor or the vertical screen, as background of the story. */
export const Screen: React.FC<ScreenProps> = () => null;

export type Timeline = {
  shots: ShotProps[];
  acts: ActProps[];
  faces: FaceProps[];
  looks: LookProps[];
  moves: MoveProps[];
  lights: LightProps[];
  pops: PopProps[];
  channels: ChannelProps[];
  screens: ScreenProps[];
  actors: ActorProps[];
  /** Props held in a hand: the actor draws them, not the world. */
  held: PropProps[];
};

const MARKERS = new Map<unknown, keyof Omit<Timeline, "actors" | "held">>([
  [Shot, "shots"],
  [Act, "acts"],
  [Face, "faces"],
  [Look, "looks"],
  [Move, "moves"],
  [Light, "lights"],
  [Pop, "pops"],
  [Channel, "channels"],
  [Screen, "screens"],
]);

/**
 * Splits the director's children into the timeline (markers) and the things drawn in 3D.
 * Pure: the same children always give the same timeline, so every render tab agrees.
 */
export const collectTimeline = (children: React.ReactNode, actorType: unknown) => {
  const timeline: Timeline = { shots: [], acts: [], faces: [], looks: [], moves: [], lights: [], pops: [], channels: [], screens: [], actors: [], held: [] };
  const drawn: React.ReactNode[] = [];
  const walk = (node: React.ReactNode) => {
    React.Children.forEach(node, (child) => {
      if (!React.isValidElement(child)) return;
      if (child.type === React.Fragment) {
        walk((child.props as { children?: React.ReactNode }).children);
        return;
      }
      const key = MARKERS.get(child.type);
      if (key) {
        (timeline[key] as unknown[]).push(child.props);
        return;
      }
      if (child.type === actorType) timeline.actors.push(child.props as ActorProps);
      if (child.type === Prop && (child.props as PropProps).held) {
        timeline.held.push(child.props as PropProps);
        return;
      }
      drawn.push(child);
    });
  };
  walk(children);
  for (const list of [timeline.shots, timeline.acts, timeline.faces, timeline.looks, timeline.moves, timeline.lights, timeline.channels, timeline.screens]) {
    (list as { from: number }[]).sort((a, b) => a.from - b.from);
  }
  timeline.pops.sort((a, b) => a.at - b.at);
  return { timeline, drawn };
};

export const TimelineContext = createContext<Timeline | null>(null);
export const useTimeline = () => {
  const t = useContext(TimelineContext);
  if (!t) throw new Error("Таймлайн доступен только внутри Sketch");
  return t;
};

/**
 * How far a hero steps along his own row of keys (x; z stays at his place): within it every single shot still sees
 * his face against a screen of the room (measured, director/shots.test.ts; director/validate.ts teaches the same).
 * The hero left of the keyboard centre is the owner, the right one Claude.
 */
export const STEP_RANGE = { left: [-3, -1], right: [1, 8] } as const;

/** Where a Move really takes an actor: along his row, within STEP_RANGE, so old scenes keep their faces and screens. */
const stepTarget = (home: [number, number], place: [number, number]): [number, number] => {
  const [lo, hi] = home[0] < 0 ? STEP_RANGE.left : STEP_RANGE.right;
  return [clamp(place[0], lo, hi), home[1]];
};

/** Floor position [x, z] of an actor at time t: the start place, then every Move in order. */
export const actorPlace = (timeline: Timeline, id: string, t: number): [number, number] => {
  const actor = timeline.actors.find((a) => a.id === id);
  const home: [number, number] = actor ? [...actor.at] : [0, 0];
  let place = home;
  for (const m of timeline.moves) {
    if (m.who !== id || t < m.from) continue;
    const to = stepTarget(home, m.place);
    const k = easeInOut(clamp((t - m.from) / Math.max(0.01, m.to - m.from)));
    place = [place[0] + (to[0] - place[0]) * k, place[1] + (to[1] - place[1]) * k];
  }
  return place;
};

/** Whether the actor is walking right now (legs swing). */
export const walking = (timeline: Timeline, id: string, t: number) =>
  timeline.moves.some((m) => m.who === id && t >= m.from && t <= m.to);

/** Yaw (radians, 0 = facing +z, toward the camera side) the actor faces when standing: toward the partner. */
export const actorRestYaw = (timeline: Timeline, id: string, t: number): number => {
  const actor = timeline.actors.find((a) => a.id === id);
  const [x, z] = actorPlace(timeline, id, t);
  // A turn in degrees is ignored: the cameras and their backdrops are measured from the turn toward the partner,
  // and another one shows the owner's profile against the bare wall. Where the head looks is Look's job.
  const otherId = typeof actor?.facing === "string" ? actor.facing : timeline.actors.find((a) => a.id !== id)?.id;
  if (!otherId) return 0;
  const [ox, oz] = actorPlace(timeline, otherId, t);
  // Face the partner but stay open to the camera (three-quarter view), like actors on a stage.
  const toward = Math.atan2(ox - x, oz - z);
  return toward * 0.62;
};

/** The side of a single shot that frames a block's face head-on (the side its face looks to). */
export const faceSide = (timeline: Timeline, id: string, t: number): "left" | "right" =>
  actorRestYaw(timeline, id, t) < 0 ? "right" : "left";

/**
 * Camera azimuth (radians, 0 = the world front) of an actor's single shots. The room is permanent, so the
 * azimuth is also the backdrop, measured from the fixed places (director/shots.test.ts):
 * - a human turns his head up to 1 rad past the body toward whoever he looks at — in a dialogue, the partner,
 *   square to the camera's front. His camera therefore stands near the partner's line (0.84 of the rest turn,
 *   47° for the owner): the turned face still reads at ~43°, the resting one almost frontal, and the vertical
 *   screen is behind him. Further toward his face only the bare left wall is left, further toward the front
 *   the face turns into a profile — so a human has this one side;
 * - a block's face is its body and never turns to an id: the three-quarter default (0.55) puts Claude in front
 *   of his chat on the monitor, the side his face looks to (Claude's "right") frames him head-on against the
 *   glass PC. The other side and the world front show the block in profile, so they keep the default.
 */
export const soloAzimuth = (timeline: Timeline, id: string, t: number, kind: "human" | "blocky", side?: ShotProps["side"]): number => {
  const rest = actorRestYaw(timeline, id, t);
  if (kind === "human") return rest * 0.84;
  return rest * 0.55 + (side && side === faceSide(timeline, id, t) ? Math.sign(rest) * 0.5 : 0);
};

const TURN = 0.3;

/**
 * Yaw the body faces at time t: the rest yaw, turning smoothly (over 0.3 s, the short way round)
 * into the walking direction of a Move and back after it.
 */
export const actorYaw = (timeline: Timeline, id: string, t: number): number => {
  const rest = actorRestYaw(timeline, id, t);
  const move = timeline.moves.find((m) => m.who === id && t >= m.from - TURN && t <= m.to + TURN);
  if (!move) return rest;
  const [sx, sz] = actorPlace(timeline, id, move.from);
  const dx = move.place[0] - sx;
  const dz = move.place[1] - sz;
  if (Math.hypot(dx, dz) < 0.05) return rest;
  const walk = Math.atan2(dx, dz);
  const diff = Math.atan2(Math.sin(walk - rest), Math.cos(walk - rest));
  const w = smoothWindow(t, move.from - TURN, move.to + TURN, TURN);
  return rest + diff * w;
};

const smoothWindow = (t: number, from: number, to: number, fade: number) => {
  const f = Math.min(fade, (to - from) / 2);
  const x = clamp(Math.min((t - from) / f, (to - t) / f));
  return x * x * (3 - 2 * x);
};

/** Events of one actor active at time t with their blend weight. */
export const activeFor = <T extends { who: string; from: number; to: number }>(list: T[], id: string, t: number, fade = 0.22) =>
  list
    .filter((e) => e.who === id && t >= e.from && t <= e.to)
    .map((e) => {
      const f = Math.min(fade, (e.to - e.from) / 2);
      const w = f <= 0 ? 1 : clamp(Math.min((t - e.from) / f, (e.to - t) / f));
      return { event: e, weight: w * w * (3 - 2 * w), local: t - e.from };
    });
