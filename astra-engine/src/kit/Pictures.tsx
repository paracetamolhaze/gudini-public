import React from "react";
import { AbsoluteFill, Img, interpolate } from "remotion";
import { faceOf, useInput, type AstraInput } from "../input";
import { theme } from "../theme";
import { useAsset } from "./assets";
import { AuthorShot } from "./AuthorShot";
import type { LayoutDeclaration } from "./AstraVideo";
import { useCameraState } from "./camera";
import { EASE_IN, EASE_IN_OUT, EASE_OUT, lerp } from "./motion";
import { Clip, useClip } from "./time";

/**
 * The picture montage («С картинками»): real photos of the story and drawn scenes, one after another on the author's words.
 * The montage is not written by Astra: the site plans the shots and the engine writes them into these two blocks.
 *
 * PictureRun — the upper panel with pictures changing inside it, the author edge to edge below it;
 * FullPicture — one tall picture over the whole screen.
 */

/** How the picture moves while it is on screen: a slow push in or out, or a pan across a wide picture. */
export type PictureMotion = "in" | "out" | "left" | "right";
/** How the next picture of a run comes in: a punch-in, a whip from the side, a zoom through, a flash, a soft dissolve. */
export type PictureCut = "pop" | "slide" | "zoom" | "flash" | "fade";
export type PictureShot = { from: number; to: number; src: string; motion?: PictureMotion; cut?: PictureCut };

/** The split line of the board's split layout: the panel above it, the author below. */
const LINE = 930;
const PANEL = { w: 1080, h: LINE };
const SCREEN = { w: 1080, h: 1920 };
/** Length of each cut in seconds. */
const CUT: Record<PictureCut, number> = { pop: 0.26, slide: 0.34, zoom: 0.32, flash: 0.2, fade: 0.32 };

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const ease = (t: number, from: number, to: number, easing = EASE_OUT) =>
  interpolate(t, [from, to], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing });

type Size = { w: number; h: number; span?: [number, number] };
type Box = { w: number; h: number };

/** The motion a picture gets when the plan names none: a pan for a picture much wider than the window, a push otherwise. */
export function defaultMotion(size: Size | undefined, box: Box, index: number): PictureMotion {
  const aspect = size ? size.w / size.h : box.w / box.h;
  if (aspect > (box.w / box.h) * 1.3) return index % 2 ? "left" : "right";
  return index % 2 ? "out" : "in";
}

/**
 * Where the picture stands in the window at progress `p` of its shot: it always covers the window, centered on what
 * matters (the span the checker marked, or the middle and a little above it, where faces usually are).
 */
export function framing(size: Size | undefined, box: Box, motion: PictureMotion, p: number) {
  const aspect = size ? size.w / size.h : box.w / box.h;
  const cover = aspect > box.w / box.h ? { w: box.h * aspect, h: box.h } : { w: box.w, h: box.w / aspect };
  const fx = size?.span ? (size.span[0] + size.span[1]) / 2 : 0.5;
  const fy = aspect < box.w / box.h ? 0.42 : 0.5;
  const at = (scale: number, shiftX = 0) => {
    const w = cover.w * scale, h = cover.h * scale;
    const x = clamp(box.w / 2 - fx * w + shiftX, box.w - w, 0);
    const y = clamp(box.h / 2 - fy * h, box.h - h, 0);
    return { x, y, scale, w: cover.w, h: cover.h };
  };
  if (motion === "in") return at(lerp(1, 1.1, p));
  if (motion === "out") return at(lerp(1.12, 1.02, p));
  // A pan travels across the picture at a slight zoom; a narrow picture still drifts a little.
  const scale = 1.06;
  const room = cover.w * scale - box.w;
  const travel = Math.min(box.w * 0.16, Math.max(box.w * 0.04, room * 0.8));
  const dir = motion === "right" ? -1 : 1;
  return at(scale, dir * lerp(-travel / 2, travel / 2, p));
}

/** One picture filling its window, moving through its shot. */
const Picture: React.FC<{ src: string; box: Box; motion: PictureMotion; p: number; style?: React.CSSProperties }> = ({ src, box, motion, p, style }) => {
  const { sizes } = useInput();
  const asset = useAsset();
  const f = framing(sizes[src], box, motion, p);
  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden", ...style }}>
      <Img src={asset(src)} style={{
        position: "absolute", left: 0, top: 0, width: f.w, height: f.h, maxWidth: "none",
        transformOrigin: "0 0", transform: `translate(${f.x}px, ${f.y}px) scale(${f.scale})`,
      }} />
    </div>
  );
};

/** How the incoming and the outgoing picture look `q` (0→1) of the way through a cut. */
function cutLook(cut: PictureCut, q: number, side: number): { incoming: React.CSSProperties; outgoing: React.CSSProperties | null; flash: number } {
  const e = EASE_OUT(q);
  switch (cut) {
    case "slide":
      return {
        incoming: { transform: `translateX(${(1 - e) * 100 * side}%)`, filter: `blur(${(1 - e) * 7}px)` },
        outgoing: { transform: `translateX(${-e * 35 * side}%)`, filter: `brightness(${1 - 0.45 * e}) blur(${e * 4}px)` },
        flash: 0,
      };
    case "zoom":
      return {
        incoming: { transform: `scale(${lerp(1.28, 1, e)})`, opacity: Math.min(1, q * 2.2), filter: `blur(${(1 - e) * 6}px)` },
        outgoing: { transform: `scale(${lerp(1, 1.35, EASE_IN(q))})`, opacity: 1 - q, filter: `blur(${q * 6}px)` },
        flash: 0,
      };
    case "flash":
      return { incoming: {}, outgoing: null, flash: 0.85 * (1 - q) };
    case "fade":
      return { incoming: { opacity: EASE_IN_OUT(q) }, outgoing: {}, flash: 0 };
    default:
      // A punch-in: the new picture lands a little too close and settles, the way a jump cut does.
      return { incoming: { transform: `scale(${lerp(1.13, 1, e)})`, opacity: Math.min(1, q * 5) }, outgoing: q < 0.25 ? {} : null, flash: 0 };
  }
}

/** The pictures of a run in one window, cutting from one to the next on their times. */
const Stack: React.FC<{ shots: PictureShot[]; box: Box; t: number }> = ({ shots, box, t }) => {
  const { sizes } = useInput();
  let index = 0;
  shots.forEach((s, i) => { if (t >= s.from) index = i; });
  const layer = (i: number, style?: React.CSSProperties) => {
    const s = shots[i];
    const motion = s.motion ?? defaultMotion(sizes[s.src], box, i);
    // A picture keeps moving a little past its end, while the next one comes in over it.
    const p = clamp((t - s.from) / Math.max(0.5, s.to - s.from), 0, 1.08);
    return <Picture key={`${i}-${s.src}`} src={s.src} box={box} motion={motion} p={p} style={{ transformOrigin: "50% 50%", ...style }} />;
  };
  const current = shots[index];
  const cut = current.cut ?? "pop";
  const q = index > 0 ? clamp((t - current.from) / CUT[cut], 0, 1) : 1;
  if (q >= 1) return <>{layer(index)}</>;
  const look = cutLook(cut, q, index % 2 ? -1 : 1);
  return (
    <>
      {look.outgoing ? layer(index - 1, look.outgoing) : null}
      {layer(index, look.incoming)}
      {look.flash > 0 ? <AbsoluteFill style={{ backgroundColor: "#FFFFFF", opacity: look.flash }} /> : null}
    </>
  );
};

/** The author edge to edge under the panel, moving there from the full frame as the panel opens (as on a split board). */
const AuthorWindow: React.FC<{ p: number }> = ({ p }) => {
  const input = useInput();
  const face = faceOf(input);
  const cam = useCameraState();
  const h = SCREEN.h - LINE;
  // A head off the middle of the recording is drawn toward it with a slight zoom; the width stays filled edge to edge.
  const cx = face.x + face.w / 2;
  const zoom = Math.min(1.15, Math.max(1, SCREEN.w / (SCREEN.w - 2 * Math.abs(cx - SCREEN.w / 2))));
  const halfW = SCREEN.w / 2 / zoom, halfH = h / 2 / zoom;
  const focus = { x: clamp(cx, halfW, SCREEN.w - halfW), y: clamp(face.y - 40 / zoom + halfH, halfH, SCREEN.h - halfH) };
  // The full-frame end of the move is the camera's current shot: no jump when the panel goes away.
  const camFx = (SCREEN.w / 2 - cam.origin.x * (1 - cam.zoom) - cam.x) / cam.zoom;
  const camFy = (SCREEN.h / 2 - cam.origin.y * (1 - cam.zoom) - cam.y) / cam.zoom;
  const box = { y: lerp(0, LINE, p), h: lerp(SCREEN.h, h, p) };
  const z = lerp(cam.zoom, zoom, p);
  const fx = lerp(camFx, focus.x, p), fy = lerp(camFy, focus.y, p);
  return (
    <div style={{ position: "absolute", left: 0, top: box.y, width: SCREEN.w, height: box.h, overflow: "hidden" }}>
      <div style={{ position: "absolute", left: SCREEN.w / 2 - fx * z, top: box.h / 2 - fy * z, width: SCREEN.w, height: SCREEN.h, transformOrigin: "0 0", scale: String(z) }}>
        <AuthorShot style={{ width: SCREEN.w, height: SCREEN.h }} />
      </div>
    </div>
  );
};

type RunProps = {
  from: number;
  to: number;
  shots: PictureShot[];
  /** The panel is already open on the first frame: the video starts on a picture, not on a sliding panel. */
  open?: boolean;
};

const RunBody: React.FC<Omit<RunProps, "from" | "to">> = ({ shots, open }) => {
  const { frame, fps, lengthFrames, absolute } = useClip();
  const input = useInput();
  const opening = open ? 1 : ease(frame, 0, 0.45 * fps);
  // A run that lasts to the end of the video stays open on its last frame.
  const endsVideo = absolute - frame / fps + lengthFrames / fps >= input.duration - 0.05;
  const closing = endsVideo ? 1 : 1 - ease(frame, lengthFrames - 0.4 * fps, lengthFrames, EASE_IN_OUT);
  const presence = Math.min(opening, closing);
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <div style={{ position: "absolute", left: 0, top: -(1 - presence) * LINE, width: PANEL.w, height: PANEL.h, overflow: "hidden", backgroundColor: theme.color.ink }}>
        <Stack shots={shots} box={PANEL} t={absolute} />
        {/* A soft shade at the lower edge sets the panel off the author; the caption stands on this line. */}
        <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 140, background: "linear-gradient(180deg, transparent, rgba(0,0,0,0.35))" }} />
        <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 4, background: theme.color.accent, opacity: 0.95 }} />
      </div>
      <AuthorWindow p={presence} />
    </AbsoluteFill>
  );
};

/** Pictures in the upper panel, changing on their times; the author edge to edge below, captions on the line between. */
export const PictureRun: React.FC<RunProps> & { layoutOf: (p: RunProps, input?: AstraInput) => LayoutDeclaration } = ({ from, to, ...rest }) => (
  <Clip from={from} to={to} name="Pictures"><RunBody {...rest} /></Clip>
);
// Captions stand on the split line, just above the author's head, as on a split board.
PictureRun.layoutOf = ({ from, to }) => ({ occupied: { from, to, zone: "board", captionY: LINE - 52 } });

type FullProps = { from: number; to: number; src: string; motion?: PictureMotion; cut?: PictureCut };

const FullBody: React.FC<Omit<FullProps, "from" | "to">> = ({ src, motion = "in", cut = "pop" }) => {
  const { frame, fps, lengthFrames } = useClip();
  const { sizes } = useInput();
  const asset = useAsset();
  const size = sizes[src];
  const aspect = size ? size.w / size.h : 9 / 16;
  const p = clamp(frame / Math.max(1, lengthFrames), 0, 1);
  const q = clamp(frame / (CUT[cut] * fps), 0, 1);
  const look = cutLook(cut, q, 1).incoming;
  const out = 1 - ease(frame, lengthFrames - 0.22 * fps, lengthFrames, EASE_IN);
  // A picture wider than a tall one stands whole across the screen on its own dark blur instead of being cut to a strip.
  const tall = aspect <= 0.8;
  const band = { w: SCREEN.w, h: Math.min(SCREEN.h * 0.62, SCREEN.w / Math.max(aspect, 0.8)) };
  return (
    <AbsoluteFill style={{ opacity: out, backgroundColor: theme.color.ink }}>
      {tall ? <Picture src={src} box={SCREEN} motion={motion} p={p} style={{ transformOrigin: "50% 50%", ...look }} /> : (
        <>
          <Img src={asset(src)} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", scale: "1.3", filter: "blur(50px) brightness(0.4) saturate(1.3)" }} />
          <div style={{ position: "absolute", left: 0, top: (SCREEN.h - band.h) / 2, width: band.w, height: band.h, transformOrigin: "50% 50%", ...look }}>
            <Picture src={src} box={band} motion={motion} p={p} />
          </div>
        </>
      )}
      {/* Over the whole screen a full-strength flash blinds: it is softer here than in the panel. */}
      {cut === "flash" && q < 1 ? <AbsoluteFill style={{ backgroundColor: "#FFFFFF", opacity: cutLook("flash", q, 1).flash * 0.7 }} /> : null}
    </AbsoluteFill>
  );
};

/** One picture over the whole screen; captions step aside while it stands. */
export const FullPicture: React.FC<FullProps> & { layoutOf: (p: FullProps, input?: AstraInput) => LayoutDeclaration } = ({ from, to, ...rest }) => (
  <Clip from={from} to={to} name={`Full ${rest.src}`}><FullBody {...rest} /></Clip>
);
FullPicture.layoutOf = ({ from, to }) => ({ occupied: { from, to, zone: "full" } });
