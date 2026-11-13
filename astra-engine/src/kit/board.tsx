import React, { createContext, useContext } from "react";
import { AbsoluteFill, interpolate } from "remotion";
import { alpha, useBackdrop, useDesign, type Palette } from "../design";
import { faceOf, useInput } from "../input";
import { Img } from "remotion";
import { useAsset } from "./assets";
import { coinKey } from "./iconPictures";
import { AuthorShot } from "./AuthorShot";
import { useOccupied } from "./layout";
import type { LayoutDeclaration } from "./AstraVideo";
import { useCameraState } from "./camera";
import { EASE_IN_OUT, EASE_OUT } from "./motion";
import { Clip, useClip } from "./time";

/**
 * Where the author goes while a graphic is on screen:
 * split — the graphic fills the upper part, the author the lower part edge to edge (the default: nothing on screen is empty,
 *   the graphic stays clear of TikTok's description and the face stays above it);
 * top — the author in the upper half, the graphic below it;
 * card — a rounded card on top, the graphic below; circle — a circle at the bottom, a big graphic above;
 * circle-top — a small circle top right, a title beside it and the graphic below; none — the graphic alone, the voice goes on.
 */
export type AuthorLayout = "split" | "top" | "card" | "circle" | "circle-top" | "none";

type Rect = { x: number; y: number; w: number; h: number };

/** The split lines: `split` has the graphic above SPLIT_LINE; `top` has the author above SPLIT_H. */
const SPLIT_LINE = 930;
const SPLIT_H = 960;
const CARD = { x: 60, y: 150, w: 960, h: 800, radius: 44 };
const CIRCLE_BOTTOM = { x: 380, y: 1100, size: 320 };
const CIRCLE_TOP = { x: 744, y: 176, size: 256 };

/** Free area for the graphic and the band where captions stand, per layout. Kept above TikTok's description. */
export function boardArea(author: AuthorLayout): { area: Rect; title?: Rect; captionY: number } {
  switch (author) {
    // The lower half down to TikTok's description line; captions stand on the author, just under the chin.
    case "split": return { area: { x: 48, y: 196, w: 984, h: SPLIT_LINE - 196 - 96 }, captionY: SPLIT_LINE - 52 };
    case "top": return { area: { x: 48, y: SPLIT_H + 36, w: 984, h: 500 }, captionY: SPLIT_H - 70 };
    case "card": return { area: { x: 60, y: 1000, w: 960, h: 470 }, captionY: CARD.y + CARD.h - 84 };
    case "circle": return { area: { x: 60, y: 190, w: 960, h: 880 }, captionY: 1488 };
    case "circle-top": return { area: { x: 60, y: 470, w: 960, h: 930 }, title: { x: 60, y: 186, w: 650, h: 250 }, captionY: 1470 };
    default: return { area: { x: 60, y: 190, w: 960, h: 1200 }, captionY: 1470 };
  }
}

export type BoardState = {
  palette: Palette;
  author: AuthorLayout;
  area: Rect;
  title?: Rect;
  /** Seconds since the board opened, and its length. */
  elapsed: number;
  length: number;
  /** 0→1 while the board opens, 1→0 while it closes. */
  presence: number;
  fps: number;
  frame: number;
};

const BoardContext = createContext<BoardState | null>(null);
export function useBoard(): BoardState {
  const state = useContext(BoardContext);
  if (!state) throw new Error("board blocks render inside <Board>");
  return state;
}

/** 0→1 over `dur` seconds starting `at` seconds into the board, eased. */
export function useReveal(at: number, dur = 0.45): number {
  const { elapsed } = useBoard();
  return interpolate(elapsed, [at, at + dur], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE_OUT });
}

/** Thin grid of the design: hairlines every 108 px and small marks at some crossings. */
export const BoardGrid: React.FC<{ palette: Palette }> = ({ palette }) => (
  <AbsoluteFill style={{
    backgroundImage: `linear-gradient(${palette.grid} 1px, transparent 1px), linear-gradient(90deg, ${palette.grid} 1px, transparent 1px)`,
    backgroundSize: "108px 108px", backgroundPosition: "-1px -1px",
  }}>
    <AbsoluteFill style={{ background: `radial-gradient(ellipse at 50% 42%, transparent 55%, ${alpha(palette.mode === "dark" ? "#000000" : "#6B6255", palette.mode === "dark" ? 0.35 : 0.12)} 100%)` }} />
  </AbsoluteFill>
);

/** The live author, from the full frame into its card or circle and back. */
const AuthorFrame: React.FC<{ author: AuthorLayout; p: number; palette: Palette }> = ({ author, p, palette }) => {
  const input = useInput();
  const face = faceOf(input);
  if (author === "none" && p >= 1) return null;
  const full = { x: 0, y: 0, w: 1080, h: 1920, r: 0 };
  let target: { x: number; y: number; w: number; h: number; r: number };
  let zoom: number;
  let focus: { x: number; y: number };
  if (author === "split") {
    // Edge to edge in the lower part: the top of the head a little under the split line, the face above TikTok's description.
    const h = 1920 - SPLIT_LINE;
    target = { x: 0, y: SPLIT_LINE, w: 1080, h, r: 0 };
    // A head off the middle of the recording is drawn toward it with a slight zoom; the width stays filled edge to edge.
    const cx = face.x + face.w / 2;
    zoom = Math.min(1.15, Math.max(1, 1080 / (1080 - 2 * Math.abs(cx - 540))));
    const halfW = 540 / zoom, halfH = h / 2 / zoom;
    focus = { x: Math.max(halfW, Math.min(1080 - halfW, cx)), y: Math.max(halfH, Math.min(1920 - halfH, face.y - 40 / zoom + halfH)) };
  } else if (author === "top") {
    // Edge to edge, full width: no empty sides. The top of the head sits just under TikTok's top bar.
    target = { x: 0, y: 0, w: 1080, h: SPLIT_H, r: 0 };
    zoom = 1;
    focus = { x: 540, y: Math.max(SPLIT_H / 2, Math.min(1920 - SPLIT_H / 2, face.y + SPLIT_H / 2 - 190)) };
  } else if (author === "card") {
    target = { x: CARD.x, y: CARD.y, w: CARD.w, h: CARD.h, r: CARD.radius };
    zoom = CARD.w / 1080;
    // Some air above the head: the top of the head sits at about 12% of the card height.
    focus = { x: face.x + face.w / 2, y: face.y + (CARD.h / zoom) * 0.38 };
  } else if (author === "circle" || author === "circle-top") {
    const c = author === "circle" ? CIRCLE_BOTTOM : CIRCLE_TOP;
    target = { x: c.x, y: c.y, w: c.size, h: c.size, r: c.size / 2 };
    zoom = c.size / (face.w * 1.55);
    focus = { x: face.x + face.w / 2, y: face.y + face.h * 0.5 };
  } else {
    // No author: the shot shrinks into the middle and fades while the board opens.
    target = { x: 390, y: 700, w: 300, h: 300, r: 150 };
    zoom = 300 / (face.w * 1.55);
    focus = { x: face.x + face.w / 2, y: face.y + face.h * 0.5 };
  }
  const lerp = (a: number, b: number) => a + (b - a) * p;
  const box = { x: lerp(full.x, target.x), y: lerp(full.y, target.y), w: lerp(full.w, target.w), h: lerp(full.h, target.h), r: lerp(full.r, target.r) };
  // The full-frame end of the move is where the camera is now (its punch or push included): when the board leaves,
  // the author lands exactly on the camera's shot, with no jump of zoom after the panel is gone.
  const cam = useCameraState();
  const camFx = (540 - cam.origin.x * (1 - cam.zoom) - cam.x) / cam.zoom;
  const camFy = (960 - cam.origin.y * (1 - cam.zoom) - cam.y) / cam.zoom;
  const z = lerp(cam.zoom, zoom);
  // The focus point of the source frame stays at the center of the window as it shrinks.
  const fx = lerp(camFx, focus.x), fy = lerp(camFy, focus.y);
  const left = box.w / 2 - fx * z, top = box.h / 2 - fy * z;
  const ring = author === "circle" || author === "circle-top";
  // In the soft look the author's window under the graphic has rounded upper corners, like a card laid on the page.
  const softTop = palette.soft && author === "split" ? SOFT_RADIUS * p : 0;
  return (
    <div style={{
      position: "absolute", left: box.x, top: box.y, width: box.w, height: box.h, overflow: "hidden",
      borderRadius: softTop ? `${softTop}px ${softTop}px 0 0` : box.r,
      boxShadow: softTop ? `0 ${-18 * p}px ${50 * p}px ${alpha("#000000", (palette.mode === "dark" ? 0.5 : 0.16) * p)}`
        : p > 0.05 ? `0 ${24 * p}px ${60 * p}px ${alpha("#000000", 0.35 * p)}${ring ? `, 0 0 0 ${6 * p}px ${palette.bg}, 0 0 0 ${8 * p}px ${alpha(palette.text, 0.35)}` : ""}` : undefined,
      opacity: author === "none" ? 1 - p : 1,
    }}>
      <div style={{ position: "absolute", left, top, width: 1080, height: 1920, transformOrigin: "0 0", scale: String(z) }}>
        <AuthorShot style={{ width: 1080, height: 1920 }} />
      </div>
    </div>
  );
};

type BoardProps = {
  from: number;
  to: number;
  author?: AuthorLayout;
  name?: string;
  children: React.ReactNode;
};

const Body: React.FC<Omit<BoardProps, "from" | "to" | "name">> = ({ author = "split", children }) => {
  const palette = useDesign();
  const input = useInput();
  const face = faceOf(input);
  const { frame, fps, lengthFrames, absolute, elapsed, length } = useClip();
  // A board right after another one (or a bridge between them) finds the panel already open and leaves it open:
  // only the graphic inside changes. The owner found a panel leaving and coming back a second later clumsy.
  const start = absolute - elapsed, end = start + length;
  const boards = useOccupied().filter(o => o.zone === "board");
  const joinedBefore = boards.some(o => o.from < start - 0.05 && o.to >= start - JOIN_GAP && o.to <= start + CROSS + 0.05);
  const joinedAfter = boards.some(o => o.to > end + 0.05 && o.from >= end - CROSS - 0.05 && o.from <= end + JOIN_GAP);
  const open = joinedBefore ? 1 : interpolate(frame, [0, 0.5 * fps], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE_OUT });
  const close = joinedAfter ? 1 : interpolate(frame, [lengthFrames - 0.42 * fps, lengthFrames], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE_IN_OUT });
  const presence = Math.min(open, close);
  const fadeIn = joinedBefore ? interpolate(frame, [0, CROSS * fps], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) : 1;
  const fadeOut = joinedAfter ? interpolate(frame, [lengthFrames - CROSS * fps, lengthFrames], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) : 1;
  // A panel that takes over from another comes in transparent, so the old graphic is still seen fading under it.
  const panelIn = joinedBefore ? fadeIn : 1;
  const { area, title } = boardArea(author);
  // The board opens as a circle growing from the author's face and closes back into it.
  const cx = face.x + face.w / 2, cy = face.y + face.h / 2;
  const radius = 2300 * presence;
  const state: BoardState = { palette, author, area, title, elapsed: frame / fps, length: lengthFrames / fps, presence, fps, frame };
  // The graphic lives inside its panel: it comes in and leaves together with it, clipped by its edge,
  // so nothing half-transparent is left hanging over the author while the panel moves away.
  const content = <div style={{ opacity: fadeIn * fadeOut }}><BoardContext.Provider value={state}>{children}</BoardContext.Provider></div>;
  const frameOf = (top: number) => <div style={{ position: "absolute", left: 0, top, width: 1080, height: 1920 }}>{content}</div>;
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      {author === "split" ? (
        // The upper panel slides down from the top edge, the graphic in it.
        // The upper panel slides down from the top edge, the graphic in it. In the soft look it reaches under the rounded
        // corners of the author's window, so the page shows behind them.
        <div style={{ position: "absolute", left: 0, right: 0, top: -(1 - presence) * SPLIT_LINE, height: SPLIT_LINE + (palette.soft ? SOFT_RADIUS : 0), overflow: "hidden" }}>
          <AbsoluteFill style={{ backgroundColor: palette.bg, opacity: panelIn }}>
            {palette.soft ? <SoftLight palette={palette} drift={absolute} /> : (
              <>
                <Backdrop palette={palette} drift={elapsed / Math.max(1, length)} />
                <BoardGrid palette={palette} />
              </>
            )}
          </AbsoluteFill>
          {palette.soft ? null : <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 3, background: palette.accent, opacity: 0.9 }} />}
          {frameOf(0)}
        </div>
      ) : author === "top" ? (
        // The lower panel slides up from the bottom edge, the graphic in it.
        <div style={{ position: "absolute", left: 0, right: 0, top: SPLIT_H + (1 - presence) * (1920 - SPLIT_H), height: 1920 - SPLIT_H, backgroundColor: palette.bg, overflow: "hidden" }}>
          {palette.soft ? <SoftLight palette={palette} drift={absolute} /> : <BoardGrid palette={palette} />}
          {palette.soft ? null : <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: 3, background: palette.accent, opacity: 0.9 }} />}
          {frameOf(-SPLIT_H)}
        </div>
      ) : (
        <AbsoluteFill style={{ backgroundColor: palette.bg, clipPath: `circle(${radius}px at ${cx}px ${cy}px)` }}>
          {palette.soft ? <SoftLight palette={palette} drift={absolute} /> : <BoardGrid palette={palette} />}
        </AbsoluteFill>
      )}
      <AuthorFrame author={author} p={presence} palette={palette} />
      {author === "split" || author === "top" ? null : (
        <AbsoluteFill style={{ clipPath: `circle(${radius}px at ${cx}px ${cy}px)` }}>{content}</AbsoluteFill>
      )}
    </AbsoluteFill>
  );
};

/** How round the top of the author's window is in the soft look. */
export const SOFT_RADIUS = 56;

/**
 * The soft look's page: light falling from above onto the paper, and a few large blurred shapes drifting slowly behind
 * the cards, the way the creator videos place floating objects out of focus. Gradients only: no blur filter per frame.
 */
export const SoftLight: React.FC<{ palette: Palette; drift: number }> = ({ palette, drift }) => {
  const dark = palette.mode === "dark";
  const shapes = [
    { x: 120, y: 260, r: 220, color: alpha(palette.accent, dark ? 0.22 : 0.16), speed: 0.11, phase: 0 },
    { x: 930, y: 180, r: 260, color: alpha(dark ? "#8C93A8" : "#C9B9A2", dark ? 0.16 : 0.32), speed: 0.08, phase: 2 },
    { x: 860, y: 760, r: 200, color: alpha(palette.accent, dark ? 0.14 : 0.1), speed: 0.13, phase: 4 },
  ];
  return (
    <AbsoluteFill style={{ background: dark
      ? `radial-gradient(ellipse 95% 62% at 50% 0%, #262833 0%, ${palette.bg} 72%)`
      : `radial-gradient(ellipse 95% 70% at 50% 0%, #FFFFFF 0%, ${palette.bg} 74%)` }}>
      {shapes.map((s, i) => (
        <div key={i} style={{
          position: "absolute", left: s.x - s.r + Math.sin(drift * s.speed * 6.28 + s.phase) * 30, top: s.y - s.r + Math.cos(drift * s.speed * 6.28 + s.phase) * 24,
          width: 2 * s.r, height: 2 * s.r, borderRadius: "50%", background: `radial-gradient(circle, ${s.color} 0%, transparent 70%)`,
        }} />
      ))}
    </AbsoluteFill>
  );
};

/**
 * What the board stands on: the video's backdrop scene, dimmed and slowly drifting, or a soft glow of the accent —
 * never a flat black field (the owner: «фон нужно какой-то сделать, связанный с темой»).
 */
const Backdrop: React.FC<{ palette: Palette; drift: number }> = ({ palette, drift }) => {
  const prompt = useBackdrop();
  const input = useInput();
  const asset = useAsset();
  // `footage:<query>` stands on a frame of the real footage found for that query; `coin:<name>` on the coin's own art
  // (the TRUMP token's picture of Trump); anything else is a drawn scene.
  const real = Boolean(prompt?.startsWith("footage:"));
  const coin = prompt?.startsWith("coin:") ? prompt.slice(5).trim() : undefined;
  const key = !prompt ? undefined : real ? `footage-poster:${prompt.slice(8).trim()}` : coin ? coinKey(coin) : `scene:${prompt}`;
  const dark = palette.mode === "dark";
  // A frame of real footage is a screenshot with text and buttons: it melts into colors and shapes, a drawn scene stays readable.
  // The subject still shows through (the owner, 07.11: «фон не подбирается» — the Ethereum crystal had vanished under the paper).
  const blur = real || coin ? "blur(16px) saturate(1.3)" : "blur(3px) saturate(1.1)";
  const dim = real || coin ? (dark ? 0.6 : 0.7) : dark ? 0.62 : 0.8;
  return (
    <AbsoluteFill>
      {key && input.assets[key] ? (
        <>
          <Img src={asset(key)} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", filter: blur, scale: String((real ? 1.18 : 1.08) + 0.05 * drift) }} />
          <AbsoluteFill style={{ backgroundColor: alpha(palette.bg, dim) }} />
        </>

      ) : (
        <AbsoluteFill style={{ backgroundImage: `radial-gradient(ellipse 80% 70% at 50% 35%, ${alpha(palette.accent, dark ? 0.2 : 0.14)} 0%, transparent 70%)` }} />
      )}
    </AbsoluteFill>
  );
};

/** Boards closer than this keep the panel open between them. */
export const JOIN_GAP = 1.5;
/** How long two boards in a row cross-fade their graphics. */
export const CROSS = 0.35;

/** A full-screen designed background with the author in a card or circle; graphic blocks draw inside it. */
export const Board: React.FC<BoardProps> = ({ from, to, name, ...rest }) => (
  <Clip from={from} to={to} name={name ?? "Board"}><Body {...rest} /></Clip>
);

/** Layout declaration shared by every board block: captions move into the board's caption band. */
export const boardLayout = (from: number, to: number, author: AuthorLayout = "split", text?: string): LayoutDeclaration => ({
  occupied: { from, to, zone: "board", captionY: boardArea(author).captionY, onCard: author === "card" || author === "top", text },
});
