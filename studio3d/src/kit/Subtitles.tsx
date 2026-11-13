import React, { useMemo } from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { useInput, type Line } from "../input";

// The same word captions as the main videos (lib/subtitles.ts buildWordAss): one word on screen at a time,
// shown from its first sound to its end plus a short hold, never overlapping the next one.
const GAP = 0.01;
const WORD_HOLD = 0.1;
const WORD_MIN_DUR = 0.08;

const EDGE = /^[.,!?:;…"'«»“”„()\[\]<>*+=|`~^@\-–—]+|[.,!?:;…"'«»“”„()\[\]<>*+=|`~^@\-–—]+$/g;

/** A word as the main videos show it: no punctuation around it (no full stop at the end), numbers kept whole. */
export const displayWord = (word: string) => {
  let w = word.trim().replace(EDGE, "").trim();
  if (!w) return "";
  // anything with a digit may be a number to read as written («1/8», «$5000», «50%»)
  if (!/\d/.test(w)) w = w.replace(/[.,!?:;…"'«»“”„()\[\]<>*+=/|№#%&@^~`]/g, "").trim();
  return w;
};

export type CaptionWord = { start: number; end: number; text: string };

/** Every spoken word of the video in time order with its on-screen interval. */
export const captionWords = (lines: Line[]): CaptionWord[] => {
  const items = lines
    .flatMap((l) => l.words)
    .map((w) => ({ start: w.start, end: w.end, text: displayWord(w.text) }))
    .filter((w) => w.text)
    .sort((a, b) => a.start - b.start);
  const out: CaptionWord[] = [];
  let prevEnd = -Infinity;
  for (let i = 0; i < items.length; i++) {
    const w = items[i];
    const next = items[i + 1];
    const start = Math.max(w.start, prevEnd + GAP);
    let end = Math.min(w.end + WORD_HOLD, next ? next.start - GAP : Infinity);
    if (end < start + WORD_MIN_DUR) end = start + WORD_MIN_DUR;
    out.push({ start, end, text: w.text });
    prevEnd = end;
  }
  return out;
};

/**
 * One white word in the lower part of the frame (the owner, 2026-10-28: «субтитры ещё ниже»), under the mouth of
 * a hero in close-up and above the platforms' caption at the bottom — the owner's Obelix Pro capitals with a thick
 * black outline.
 */
export const SUBTITLE_TOP = 1440;

export const Subtitles: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const input = useInput();
  const words = useMemo(() => captionWords(input.lines), [input.lines]);
  const word = words.find((w) => t >= w.start && t < w.end);
  if (!word) return null;
  return (
    <AbsoluteFill style={{ alignItems: "center" }}>
      <div
        style={{
          position: "absolute",
          top: SUBTITLE_TOP,
          width: 960,
          textAlign: "center",
          fontFamily: "Obelix Pro",
          fontWeight: 700,
          fontSize: 76,
          lineHeight: 1.2,
          textTransform: "uppercase",
          letterSpacing: 0.5,
          color: "#ffffff",
          WebkitTextStroke: "11px #000000",
          paintOrder: "stroke fill",
          textShadow: "0 6px 18px rgba(0,0,0,0.45)",
        }}
      >
        {word.text}
      </div>
    </AbsoluteFill>
  );
};
