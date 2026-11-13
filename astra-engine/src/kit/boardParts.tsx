import React from "react";
import { fitText } from "@remotion/layout-utils";
import { interpolate } from "remotion";
import { fonts } from "../design";
import { useBoard } from "./board";
import { EASE_OUT } from "./motion";
import { useClip } from "./time";

/**
 * 0→1 as an element enters: at `at` seconds of the video if given, otherwise `delay` seconds after the board opened.
 * Things appear when the author says them.
 */
export function useAppear(at: number | undefined, delay = 0, dur = 0.5): number {
  const { absolute, elapsed } = useClip();
  const t = at !== undefined ? absolute - at : elapsed - delay;
  return interpolate(t, [0, dur], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE_OUT });
}

/** Seconds since `at` (or since the board opened plus `delay`); negative before. */
export function useSince(at: number | undefined, delay = 0): number {
  const { absolute, elapsed } = useClip();
  return at !== undefined ? absolute - at : elapsed - delay;
}

/** The largest font size up to `max` at which the longest line fits `width`. */
export function fitSize(lines: string[], width: number, max: number, fontFamily: string, fontWeight: string, min = 40): number {
  const longest = lines.reduce((a, b) => (b.length > a.length ? b : a), "");
  if (!longest) return max;
  const size = fitText({ text: longest, withinWidth: width, fontFamily, fontWeight, validateFontIsLoaded: false }).fontSize;
  return Math.max(min, Math.min(max, Math.floor(size)));
}

/** Condensed heavy title lines; each slides up out of a mask. */
export const DisplayLines: React.FC<{
  lines: string[]; width: number; max?: number; color: string; accentLine?: number; accent?: string; align?: "left" | "center";
  delay?: number; at?: number;
}> = ({ lines, width, max = 210, color, accentLine, accent, align = "left", delay = 0, at }) => {
  const upper = lines.map(l => l.toUpperCase());
  const size = fitSize(upper, width, max, fonts.display, "700", 60);
  const since = useSince(at, delay);
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: align === "center" ? "center" : "flex-start" }}>
      {upper.map((line, i) => {
        const p = interpolate(since - i * 0.08, [0, 0.55], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE_OUT });
        return (
          <div key={i} style={{ overflow: "hidden", paddingBottom: size * 0.04, marginBottom: -size * 0.1 }}>
            <div style={{
              fontFamily: fonts.display, fontWeight: 700, fontSize: size, lineHeight: 1.02, letterSpacing: size * 0.005,
              color: i === accentLine && accent ? accent : color, whiteSpace: "nowrap",
              translate: `0 ${(1 - p) * 105}%`,
            }}>{line}</div>
          </div>
        );
      })}
    </div>
  );
};

/**
 * The line under a title or a number: what it means, in a few plain words. Bold and in the text color, so it reads at a glance;
 * the owner found a thin italic accent line hard to read.
 */
export const SerifLine: React.FC<{ text: string; color: string; size?: number; delay?: number; at?: number; align?: "left" | "center"; maxWidth?: number }> = ({
  text, size = 62, delay = 0.3, at, align = "left", maxWidth = 960,
}) => {
  const p = useAppear(at, delay, 0.6);
  const { palette } = useBoard();
  return (
    <div style={{
      fontFamily: fonts.ui, fontWeight: 700, fontSize: Math.round(size * 0.78), lineHeight: 1.18, maxWidth, color: palette.text,
      textAlign: align, opacity: p, translate: `0 ${(1 - p) * 24}px`, letterSpacing: -0.2,
    }}>{text}</div>
  );
};

/** A small monospace line that types itself: a label, a comment, a note in the margin. */
export const MonoLine: React.FC<{ text: string; color: string; size?: number; delay?: number; at?: number; cursor?: string; align?: "left" | "center" }> = ({
  text, color, size = 30, delay = 0, at, cursor, align = "left",
}) => {
  const since = useSince(at, delay);
  const shown = Math.max(0, Math.min(text.length, Math.floor(since * 38)));
  const typing = shown < text.length;
  return (
    <div style={{ fontFamily: fonts.mono, fontWeight: 400, fontSize: size, color, letterSpacing: 0.5, whiteSpace: "pre", textAlign: align, minHeight: size * 1.3 }}>
      {text.slice(0, shown)}
      {cursor && (typing || Math.floor(since * 2) % 2 === 0) ? <span style={{ display: "inline-block", width: size * 0.55, height: size * 1.05, marginLeft: 4, background: cursor, verticalAlign: "text-bottom" }} /> : null}
    </div>
  );
};

/** Board-local helpers for layouts that place things inside the free area. */
export function useArea() {
  const { area, title, author, palette } = useBoard();
  return { area, title, author, palette };
}
