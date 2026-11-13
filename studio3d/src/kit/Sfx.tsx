import React from "react";
import { Audio } from "@remotion/media";
import { Sequence, staticFile, useVideoConfig } from "remotion";
import { useInput } from "../input";
import { feet, keysUnder, type BodyKind } from "./ground";
import { actorPlace, useTimeline, type Timeline } from "./timeline";

export type SfxSound = "key" | "land" | "pop" | "whoosh" | "coin" | "alarm";
export type SfxCue = { at: number; sound: SfxSound; volume: number };

/** Length of each sound file in public/sfx (scripts/sfx.py), so a cue holds its sound to the end. */
const LENGTH: Record<SfxSound, number> = { key: 0.09, land: 0.22, pop: 0.12, whoosh: 0.42, coin: 0.7, alarm: 0.5 };
const STEP = 1 / 120;

/**
 * The room's sounds under the two voices, read off the scene: a key clacks when a hero takes off it, lands on it or
 * steps onto the next one; an icon pops; the money light dings, the alarm light beeps; a whip or a shake whooshes.
 */
export const sfxCues = (timeline: Timeline, kinds: Record<string, BodyKind>): SfxCue[] => {
  const cues: SfxCue[] = [];
  for (const pop of timeline.pops) cues.push({ at: pop.at, sound: "pop", volume: 0.5 });
  for (const light of timeline.lights) {
    if (light.mood === "money") cues.push({ at: light.from, sound: "coin", volume: 0.45 });
    if (light.mood === "alarm") cues.push({ at: light.from, sound: "alarm", volume: 0.45 });
  }
  for (const shot of timeline.shots) if (shot.move === "whip" || shot.move === "shake") cues.push({ at: shot.from, sound: "whoosh", volume: 0.55 });
  for (const actor of timeline.actors) {
    const kind = kinds[actor.id] ?? "human";
    // take-offs and landings inside every gesture that leaves the key
    for (const act of timeline.acts.filter((a) => a.who === actor.id && ["jump", "hop", "bounce", "cheer", "panic"].includes(a.do))) {
      let air = false;
      for (let t = act.from; t <= act.to + 0.2; t += STEP) {
        const up = feet(timeline, actor.id, kind, t).lift > 0.004;
        if (up && !air) cues.push({ at: t, sound: "key", volume: 0.3 });
        if (!up && air) cues.push({ at: t, sound: act.do === "jump" ? "land" : "key", volume: act.do === "jump" ? 0.6 : 0.35 });
        air = up;
      }
    }
    // a walk clacks on each new key under the hero
    for (const move of timeline.moves.filter((m) => m.who === actor.id)) {
      let last = "";
      for (let t = move.from; t <= move.to; t += STEP * 4) {
        const [x, z] = actorPlace(timeline, actor.id, t);
        const top = keysUnder(x, z).sort((a, b) => b.weight - a.weight)[0];
        const key = top ? `${top.col},${top.row}` : "";
        if (last && key && key !== last) cues.push({ at: t, sound: "key", volume: 0.3 });
        last = key || last;
      }
    }
  }
  return cues.filter((c) => c.at >= 0).sort((a, b) => a.at - b.at);
};

/** The cues, when the input asks for sound effects. No room tone: the owner (2026-10-23) «звук вентилятора убери вообще». */
export const Sfx: React.FC = () => {
  const input = useInput();
  const timeline = useTimeline();
  const { fps, durationInFrames } = useVideoConfig();
  if (!input.sfx) return null;
  const kinds = Object.fromEntries(Object.entries(input.cast).map(([id, m]) => [id, m.kind]));
  return <>
    {sfxCues(timeline, kinds).map((cue, i) => {
      const from = Math.round(cue.at * fps);
      if (from >= durationInFrames) return null;
      return (
        <Sequence key={i} from={from} durationInFrames={Math.max(1, Math.ceil(LENGTH[cue.sound] * fps) + 1)} layout="none">
          <Audio src={staticFile(`sfx/${cue.sound}.wav`)} volume={cue.volume} />
        </Sequence>
      );
    })}
  </>;
};
