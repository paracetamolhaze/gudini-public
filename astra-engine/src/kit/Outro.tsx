import React from "react";
import { AbsoluteFill, Img, interpolate, spring, staticFile } from "remotion";
import { useInput } from "../input";
import { alpha, fonts, useDesign } from "../design";
import { BlockSfx, type SfxRole } from "./audio";
import { SoftLight } from "./board";
import type { LayoutDeclaration } from "./AstraVideo";
import { fitSize } from "./boardParts";
import { EASE_OUT } from "./motion";
import { Clip, useClip } from "./time";
import { mascotKey, type MascotPose } from "./ui";

type Props = {
  from: number;
  /** The very end of the video. */
  to: number;
  /** One big ask: «ПОДПИШИСЬ», «ПИШИ В КОММЕНТАРИЯХ» (up to 22 letters). */
  title?: string;
  /** What the viewer gets: «дальше — как не потерять ключ» (up to 40 letters). */
  text?: string;
  /** The mascot's pose: waving by default. It points nowhere: the follow button sits in a different place on every platform. */
  pose?: MascotPose;
  sfx?: SfxRole | false;
};

const Card: React.FC<Required<Pick<Props, "title" | "pose">> & { text?: string }> = ({ title, text, pose }) => {
  const palette = useDesign();
  const { assets } = useInput();
  const { frame, fps, elapsed } = useClip();
  // The mascot is drawn once for the channel; a video made before it exists ends without it.
  const mascot = assets[mascotKey(pose)];
  const dark = palette.mode === "dark";
  const enter = interpolate(elapsed, [0, 0.4], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE_OUT });
  const jump = spring({ frame: frame - 0.15 * fps, fps, config: { damping: 9, stiffness: 160, mass: 0.7 } });
  const bob = Math.sin(elapsed * 4.2) * 8;
  const words = title.toUpperCase();
  const size = fitSize([words], 900, 150, fonts.display, "700", 76);
  const line = interpolate(elapsed, [0.35, 0.8], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE_OUT });
  // A friendly sway from the feet instead of an arrow: the follow button is in a different place on every platform.
  const sway = Math.sin(elapsed * 5.5) * 3.5 * jump;
  return (
    <AbsoluteFill style={{ clipPath: `inset(${(1 - enter) * 100}% 0 0 0 round 0)` }}>
      <AbsoluteFill style={{ backgroundColor: dark ? palette.bg : palette.bg }}>
        {palette.soft ? <SoftLight palette={palette} drift={elapsed} /> : (
          <AbsoluteFill style={{ background: `radial-gradient(ellipse 90% 60% at 50% 30%, ${alpha(palette.accent, 0.22)} 0%, transparent 70%)` }} />
        )}
      </AbsoluteFill>
      {mascot ? <Img src={staticFile(mascot)} style={{ position: "absolute", left: 270, top: 430 + (1 - jump) * 260 + bob, width: 540, height: 540, objectFit: "contain",
        scale: String(0.7 + 0.3 * jump), rotate: `${sway}deg`, transformOrigin: "50% 92%",
        filter: `drop-shadow(0 30px 40px ${alpha("#000000", dark ? 0.55 : 0.2)})` }} /> : null}
      <div style={{ position: "absolute", left: 60, right: 60, top: 1010, display: "flex", flexDirection: "column", alignItems: "center", gap: 22 }}>
        <div style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: size, lineHeight: 1, color: palette.text, letterSpacing: 1, whiteSpace: "nowrap",
          opacity: line, translate: `0 ${(1 - line) * 40}px` }}>{words}</div>
        {text ? (
          <div style={{ fontFamily: fonts.ui, fontWeight: 800, fontSize: 46, color: palette.accentInk, textAlign: "center", maxWidth: 900, lineHeight: 1.2,
            opacity: line, translate: `0 ${(1 - line) * 30}px` }}>{text}</div>
        ) : null}
      </div>
    </AbsoluteFill>
  );
};

/**
 * The same ending in every video: the channel's mascot jumps in and waves, one big ask and what comes next.
 * It covers the last seconds while the author says the call to action. Nothing points at a button: the owner
 * (2026-10-09) did not like the arrow, and the follow button sits in a different place on every platform.
 */
export const Outro: React.FC<Props> & { layoutOf: (p: Props) => LayoutDeclaration } = ({ from, to, title = "ПОДПИШИСЬ", text, pose = "hi", sfx }) => (
  <>
    <Clip from={from} to={to} name="Outro"><Card title={title} text={text} pose={pose} /></Clip>
    <BlockSfx at={from} sfx={sfx} fallback="swipe" />
  </>
);
Outro.layoutOf = ({ from, to }) => ({ occupied: { from, to, zone: "full" } });
