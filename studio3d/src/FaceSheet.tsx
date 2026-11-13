import React from "react";
import { AbsoluteFill } from "remotion";
import type { SketchInput } from "./input";
import { blockyFront, humanFront, popTexture, type PopIcon } from "./kit/textures";
import type { Mood } from "./kit/timeline";

const MOODS: Mood[] = ["neutral", "happy", "laugh", "worried", "shocked", "angry", "sad", "smug", "sleepy", "love", "dizzy", "wink", "thinking"];
const POPS: PopIcon[] = ["!", "?", "?!", "heart", "dollar", "skull", "idea", "sweat", "anger", "zzz", "fire", "star"];

const img = (canvas: unknown) => (canvas as HTMLCanvasElement).toDataURL();

/** Every face and reaction icon on one page, to tune the pixel art by eye (dev only). */
export const FaceSheet: React.FC<SketchInput> = (input) => {
  const claude = Object.values(input.cast).find((m) => m.kind === "blocky");
  const me = Object.values(input.cast).find((m) => m.kind === "human");
  const label: React.CSSProperties = { color: "#fff", fontFamily: "Inter", fontSize: 22, textAlign: "center" };
  return (
    <AbsoluteFill style={{ background: "#141833", padding: 24, display: "flex", flexWrap: "wrap", gap: 14, alignContent: "flex-start" }}>
      {MOODS.map((mood) => (
        <div key={mood} style={{ width: 240 }}>
          {claude && claude.kind === "blocky" ? (
            <img src={img(blockyFront(claude.color, { mood, open: 0, blink: false, blush: false, sweat: false }).image)} style={{ width: 240, imageRendering: "pixelated" }} />
          ) : null}
          {me && me.kind === "human" ? (
            <img src={img(humanFront(me.look, { mood, open: 0, blink: false, look: 0 }).image)} style={{ width: 110, imageRendering: "pixelated" }} />
          ) : null}
          <div style={label}>{mood}</div>
        </div>
      ))}
      {[1, 2, 3].map((open) => (
        <div key={open} style={{ width: 240 }}>
          {claude && claude.kind === "blocky" ? (
            <img src={img(blockyFront(claude.color, { mood: "neutral", open, blink: false, blush: false, sweat: false }).image)} style={{ width: 240, imageRendering: "pixelated" }} />
          ) : null}
          {me && me.kind === "human" ? <img src={img(humanFront(me.look, { mood: "neutral", open, blink: false, look: 0 }).image)} style={{ width: 110, imageRendering: "pixelated" }} /> : null}
          <div style={label}>open {open}</div>
        </div>
      ))}
      {POPS.map((p) => (
        <div key={p} style={{ width: 120 }}>
          <img src={img(popTexture(p).image)} style={{ width: 120, imageRendering: "pixelated" }} />
          <div style={label}>{p}</div>
        </div>
      ))}
    </AbsoluteFill>
  );
};
