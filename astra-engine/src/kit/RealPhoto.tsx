import React from "react";
import { AbsoluteFill, Img, interpolate } from "remotion";
import { alpha, fonts } from "../design";
import { useInput, type AstraInput } from "../input";
import { useAsset } from "./assets";
import type { LayoutDeclaration } from "./AstraVideo";
import { BlockSfx, type SfxRole } from "./audio";
import { Board, boardLayout, useBoard, type AuthorLayout } from "./board";
import { fitSize, useAppear } from "./boardParts";
import { ImageCard } from "./ImageCard";
import { Clip, useClip } from "./time";

type Props = {
  from: number;
  to: number;
  /** English search words for Wikimedia Commons: "Satoshi Nakamoto bust Budapest". */
  query: string;
  /** The Wikipedia article whose lead photo is wanted, if there is one: "Satoshi Nakamoto". */
  wiki?: string;
  /** top — the photo on a board above the author (the face stays clear); full — the whole screen; lower — a card over the lower part of the shot. */
  pos?: "full" | "top" | "lower";
  caption?: string;
  /** The author's place while the photo is on the board (pos="top"). */
  author?: AuthorLayout;
  sfx?: SfxRole | false;
};

const key = (p: { query: string; wiki?: string }) => `real:${p.wiki ?? p.query}`;

const Credit: React.FC<{ src: string }> = ({ src }) => {
  const { assets } = useInput();
  const { frame, fps, lengthFrames } = useClip();
  if (!assets[src]) return null;
  const o = Math.min(1, frame / (0.4 * fps), (lengthFrames - frame) / (0.3 * fps));
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <div style={{ position: "absolute", right: 170, bottom: 440, fontFamily: fonts.mono, fontSize: 20, color: "rgba(255,255,255,0.7)", opacity: Math.max(0, o),
        textShadow: "0 1px 4px rgba(0,0,0,0.8)" }}>фото: Wikimedia Commons</div>
    </AbsoluteFill>
  );
};

/**
 * The photo as a print on the board, as big as the board allows and slowly drifting closer. A wide photo takes the
 * width with its name under it; an upright one stands on the left with its name beside it, so the board stays full.
 */
const PhotoOnBoard: React.FC<{ src: string; caption?: string }> = ({ src, caption }) => {
  const { palette, area, elapsed, length } = useBoard();
  const input = useInput();
  const asset = useAsset();
  const p = useAppear(undefined, 0.15, 0.55);
  const label = useAppear(undefined, 0.5, 0.5);
  if (!input.assets[src]) return null;
  const size = input.sizes[src];
  const aspect = size && size.w > 0 && size.h > 0 ? size.w / size.h : 0.8;
  const upright = aspect < 1.1;
  let w: number, h: number;
  if (upright) {
    h = area.h - 16;
    w = Math.min(h * aspect, area.w * 0.58);
    h = w / aspect;
  } else {
    h = area.h - (caption ? 76 : 0) - 58;
    w = h * aspect;
    if (w > area.w) { w = area.w; h = w / aspect; }
  }
  const drift = interpolate(elapsed, [0, Math.max(1, length)], [1, 1.06], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const print = (
    <div style={{
      width: w, height: h, flexShrink: 0, borderRadius: 22, overflow: "hidden", border: `8px solid ${palette.surface}`,
      boxShadow: `0 30px 70px ${alpha("#000000", palette.mode === "dark" ? 0.5 : 0.18)}`,
      opacity: p, scale: String(0.9 + 0.1 * p), rotate: `${(1 - p) * -2.5}deg`,
    }}>
      <Img src={asset(src)} style={{ width: "100%", height: "100%", objectFit: "cover", scale: String(drift) }} />
    </div>
  );
  const credit = <div style={{ fontFamily: fonts.mono, fontSize: 22, color: palette.muted, opacity: label }}>фото: Wikimedia Commons</div>;
  if (upright) {
    const textW = area.w - w - 44;
    const words = (caption ?? "").toUpperCase().split(/\s+/).filter(Boolean);
    const nameSize = caption ? fitSize(words, textW, 96, fonts.display, "700", 44) : 0;
    return (
      <div style={{ position: "absolute", left: area.x, top: area.y, width: area.w, height: area.h, display: "flex", alignItems: "center", gap: 44 }}>
        {print}
        <div style={{ display: "flex", flexDirection: "column", gap: 18, width: textW, opacity: label, translate: `${(1 - label) * 30}px 0` }}>
          {caption ? <div style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: nameSize, lineHeight: 1.02, color: palette.text, textTransform: "uppercase" }}>{caption}</div> : null}
          <div style={{ width: 90, height: 6, borderRadius: 3, background: palette.accent }} />
          {credit}
        </div>
      </div>
    );
  }
  return (
    <div style={{ position: "absolute", left: area.x, top: area.y, width: area.w, height: area.h, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12 }}>
      {print}
      {caption ? (
        <div style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 60, lineHeight: 1.1, color: palette.text, textTransform: "uppercase", letterSpacing: 0.5,
          opacity: label, translate: `0 ${(1 - label) * 16}px`, whiteSpace: "nowrap" }}>{caption}</div>
      ) : null}
      {credit}
    </div>
  );
};

/** A real photo of a known person, place or thing from Wikipedia: never a generated look-alike. */
export const RealPhoto: React.FC<Props> & { layoutOf: (p: Props, input?: AstraInput) => LayoutDeclaration } = ({ from, to, pos = "full", caption, author = "split", sfx, ...rest }) =>
  pos === "top" ? (
    <>
      <Board from={from} to={to} author={author} name="RealPhoto"><PhotoOnBoard src={key(rest)} caption={caption} /></Board>
      <BlockSfx at={from} sfx={sfx} fallback="shutter" />
    </>
  ) : (
    <>
      <ImageCard from={from} to={to} src={key(rest)} pos={pos} caption={caption} sfx={sfx} />
      <Clip from={from} to={to} name="Photo credit"><Credit src={key(rest)} /></Clip>
    </>
  );
RealPhoto.layoutOf = ({ from, to, pos = "full", author = "split", caption, ...rest }, input) =>
  pos === "top" ? boardLayout(from, to, author, caption) : ImageCard.layoutOf({ from, to, pos, src: key(rest) }, input);
