import React from "react";
import { AbsoluteFill, Img, OffthreadVideo, staticFile } from "remotion";
import { faceOf, useInput } from "../input";
import { theme } from "../theme";
import { useAsset } from "./assets";
import type { LayoutDeclaration } from "./AstraVideo";
import { BlockSfx, type SfxRole } from "./audio";
import { CameraLayer, useHighestTop } from "./camera";
import { enter, leave, pop } from "./motion";
import { Clip, useClip, useClipOffset } from "./time";

type Props = {
  from: number;
  to: number;
  /** Brand or project name as it is written: "OpenAI", "Bitcoin", "Waymo", "Telegram". */
  name: string;
  /** above: over the head; behind: big, behind the author's head like a word behind the author. */
  pos?: "above" | "behind";
  size?: number;
  sfx?: SfxRole | false;
};

const Body: React.FC<Omit<Props, "sfx">> = ({ from, to, name, pos = "above", size }) => {
  const { frame, fps, lengthFrames, elapsed } = useClip();
  const input = useInput();
  const asset = useAsset();
  const offset = useClipOffset();
  const highestTop = useHighestTop();
  const face = faceOf(input);
  const behind = pos === "behind";
  const s = pop(frame, fps);
  const out = leave(frame, fps, lengthFrames, 0.22);
  const shine = enter(frame, fps, 0.9, 0.15);
  const bob = behind ? 0 : Math.sin(elapsed * Math.PI * 0.9) * 5;
  // Above the head: the tile sits between the TikTok top bar and the crown, wherever the camera puts it.
  const headTop = highestTop(face, from, to);
  // The logo stands in the middle of the frame, over the author, wherever he sits.
  const cx = 540;
  // The tile takes the shape of the logo: a wordmark gets a wide plate, a sign a square tile.
  const known = input.sizes[`logo:${name.toLowerCase()}`];
  const aspect = known && known.w > 0 && known.h > 0 ? known.w / known.h : 1;
  const wide = aspect > 1.4;
  // A colorful or bright mark (a golden coin, a blue plane) stands on its own and bigger; a dark single-color mark needs the white tile.
  const plate = known?.plate !== false;
  let w = size ?? (plate ? (wide ? (behind ? 860 : 620) : behind ? 420 : 300) : wide ? (behind ? 900 : 640) : behind ? 640 : 400);
  let h = plate ? (wide ? Math.round((w * 0.84) / aspect + w * 0.16) : w) : Math.round(w / aspect);
  // Over the head, a big mark shrinks to the room between the top bar and the crown, so it never covers the face.
  if (!behind && !plate) {
    const room = Math.max(240, headTop - 30 - (theme.safe.top + 20));
    if (h > room) { w = Math.round((w * room) / h); h = room; }
  }
  // A wide plate behind the author stands over the head, the crown covering only its lower edge; a square tile hides half behind the head;
  // a free-standing mark hides its lower third behind the head, like a word.
  const cy = behind
    ? Math.max(theme.safe.top + 10 + h / 2, headTop - h / 2 + h * (plate ? 0.12 : 0.35))
    : Math.max(theme.safe.top + 20 + h / 2, headTop - 30 - h / 2);
  const cutout = behind ? input.cutouts.find(c => c.from <= from + 0.05 && c.to >= to - 0.05) : undefined;
  // A logo that was not found is simply not shown.
  if (!input.assets[`logo:${name.toLowerCase()}`]) return null;
  return (
    <>
      <AbsoluteFill style={{ pointerEvents: "none" }}>
        <div style={{
          position: "absolute", left: Math.max(24, Math.min(1080 - 24 - w, cx - w / 2)), top: cy - h / 2 + bob, width: w, height: h,
          ...(plate ? { borderRadius: Math.min(w, h) * 0.24, backgroundColor: "#ffffff", boxShadow: "0 22px 50px rgba(0,0,0,0.45), inset 0 0 0 2px rgba(255,255,255,0.6)", overflow: "hidden" } : {}),
          display: "flex", alignItems: "center", justifyContent: "center",
          scale: String(s * (0.6 + 0.4 * out)), opacity: out, rotate: `${(1 - Math.min(1, s)) * -10}deg`,
        }}>
          <Img src={asset(`logo:${name.toLowerCase()}`)} style={plate
            ? { width: wide ? "84%" : "72%", height: wide ? "84%" : "72%", objectFit: "contain" }
            : { width: "100%", height: "100%", objectFit: "contain", filter: "drop-shadow(0 20px 40px rgba(0,0,0,0.5))" }} />
          {plate ? <div style={{ position: "absolute", inset: 0, background: "linear-gradient(115deg, rgba(255,255,255,0) 35%, rgba(255,255,255,0.75) 50%, rgba(255,255,255,0) 65%)", translate: `${(shine * 2 - 1) * 140}% 0` }} /> : null}
        </div>
      </AbsoluteFill>
      {cutout ? (
        <CameraLayer>
          <OffthreadVideo src={staticFile(cutout.src)} transparent muted trimBefore={Math.max(0, offset - Math.round(cutout.from * fps))} style={{ width: "100%", height: "100%" }} />
        </CameraLayer>
      ) : null}
    </>
  );
};

/** A company or project logo on a white tile, over the head or big behind it. */
export const Logo: React.FC<Props> & { layoutOf: (p: Props) => LayoutDeclaration } = ({ from, to, sfx, ...rest }) => (
  <>
    <Clip from={from} to={to} name={`Logo ${rest.name}`}><Body from={from} to={to} {...rest} /></Clip>
    <BlockSfx at={from} sfx={sfx} fallback="pop" />
  </>
);
Logo.layoutOf = ({ from, to }) => ({ occupied: { from, to, zone: "top" } });
