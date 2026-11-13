import { useCurrentFrame, useVideoConfig } from "remotion";
import { useInput, type Line } from "../input";
import { activeFor, useTimeline, type Mood } from "./timeline";
import { sampleKeys, hash } from "./util";

/** The line an actor speaks at time t, if any. */
export const speakingLine = (lines: Line[], id: string, t: number) => lines.find((l) => l.who === id && t >= l.start && t <= l.end + 0.05);

/**
 * Mouth openness 0..3 from the letter curve, sampled at 15 per second and held,
 * so the mouth snaps like stop-motion instead of flickering every frame.
 */
export const mouthLevel = (lines: Line[], id: string, t: number) => {
  const line = speakingLine(lines, id, t);
  if (!line) return 0;
  const held = Math.floor(t * 15) / 15;
  const v = sampleKeys(line.mouth, held);
  return v > 0.66 ? 3 : v > 0.38 ? 2 : v > 0.12 ? 1 : 0;
};

/** Blinks every ~3–4.5 s, at moments that differ between actors. */
export const blinking = (id: string, t: number) => {
  const seed = id.split("").reduce((s, c) => s + c.charCodeAt(0), 0);
  const period = 3 + hash(seed) * 1.5;
  const phase = (t + hash(seed, 7) * period) % period;
  return phase < 0.11;
};

/** Everything an actor needs at the current frame. */
export const useActing = (id: string) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const input = useInput();
  const timeline = useTimeline();
  // pixel faces switch, they do not fade: the last face whose window holds t, so chained moods never flash neutral
  const face = [...timeline.faces].reverse().find((f) => f.who === id && t >= f.from && t < f.to) ?? null;
  const mood: Mood = face ? face.mood : "neutral";
  const line = speakingLine(input.lines, id, t);
  return {
    t,
    frame,
    fps,
    timeline,
    mood,
    blush: Boolean(face?.blush),
    sweat: Boolean(face?.sweat),
    open: mouthLevel(input.lines, id, t),
    talking: Boolean(line),
    line,
    blink: blinking(id, t),
    acts: activeFor(timeline.acts, id, t),
    looks: activeFor(timeline.looks, id, t, 0.3),
  };
};
