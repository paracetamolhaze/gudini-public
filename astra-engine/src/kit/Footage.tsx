import React from "react";
import { Video } from "@remotion/media";
import { AbsoluteFill, Img, interpolate } from "remotion";
import { useInput, type AstraInput } from "../input";
import { theme } from "../theme";
import type { LayoutDeclaration } from "./AstraVideo";
import { useAsset } from "./assets";
import { BlockSfx, type SfxRole } from "./audio";
import { EASE_OUT, glide, leave } from "./motion";
import { Clip, useClip } from "./time";

type Props = {
  from: number;
  to: number;
  /** What the footage shows, in English, as for a YouTube search: "Hamster Kombat gameplay", "Waymo robotaxi driving in San Francisco". */
  query: string;
  /** Second of the found video to start from; without it the cut skips the intro. */
  start?: number;
  /** full (default): the whole screen; lower: a card over the lower part of the shot. */
  pos?: "full" | "lower";
  /** 0 = silent (default); up to 0.3 lets the clip's own sound peek through under the voice. */
  volume?: number;
  sfx?: SfxRole | false;
};

// The part of the frame TikTok does not cover: below the top bar, above the description.
const SAFE = { top: 175, height: 1330 };
const LOWER = { x: 90, y: 1000, w: 900, h: 506 };

/** The asset key of a cut: a query, and the second it starts from when one is given — another part of the same video is another cut. */
export const footageKey = (query: string, start?: number) => `footage:${query}${start === undefined ? "" : `@${Math.round(start)}`}`;

/** Real footage found for the query before the render: a tall clip fills the screen, a wide one is brought up around what matters. */
const Body: React.FC<Omit<Props, "from" | "to" | "sfx">> = ({ query, start, pos = "full", volume = 0 }) => {
  const { assets, sizes } = useInput();
  const asset = useAsset();
  const { frame, fps, lengthFrames } = useClip();
  const key = footageKey(query, start);
  if (!assets[key]) return null;
  const size = sizes[key];
  const aspect = size ? size.w / size.h : 16 / 9;
  const out = leave(frame, fps, lengthFrames, 0.3);
  const video = <Video src={asset(key)} loop volume={volume} muted={volume === 0} objectFit="cover" style={{ width: "100%", height: "100%" }} />;
  if (pos === "full") {
    const fade = Math.min(interpolate(frame, [0, 0.22 * fps], [0, 1], { extrapolateRight: "clamp", easing: EASE_OUT }), out);
    if (aspect <= 0.85) return <AbsoluteFill style={{ opacity: fade, backgroundColor: theme.color.ink }}>{video}</AbsoluteFill>;
    // A wide clip is brought up around what matters (Astra marks it when she chooses the moment): a phone in a hand,
    // an app window or a table fills the screen; only a clip whose whole width matters stays whole over its blur.
    // A strip across a dark screen read as small and dark (the owner, Hamster 0:10 and 0:20).
    const w = size?.w ?? 1080, h = size?.h ?? 1080 / aspect;
    const span = size?.span ?? [0.25, 0.75];
    const contain = Math.min(1080 / w, 1920 / h);
    const cover = Math.max(1080 / w, 1920 / h);
    const k = Math.min(cover, Math.max(contain, (1080 * 0.92) / Math.max(1, (span[1] - span[0]) * w)));
    const vw = w * k, vh = h * k;
    const focus = ((span[0] + span[1]) / 2) * vw;
    const left = vw <= 1080 ? (1080 - vw) / 2 : Math.min(0, Math.max(1080 - vw, 540 - focus));
    const filled = vh >= 1919;
    const top = filled ? (1920 - vh) / 2 : Math.max(0, SAFE.top + SAFE.height / 2 - vh / 2);
    const feather = filled ? undefined : "linear-gradient(180deg, transparent 0%, #000 7%, #000 93%, transparent 100%)";
    const drift = interpolate(frame, [0, lengthFrames], [1, 1.04]);
    const poster = key.replace(/^footage:/, "footage-poster:");
    return (
      <AbsoluteFill style={{ opacity: fade, backgroundColor: theme.color.ink, overflow: "hidden" }}>
        {!filled && assets[poster] ? (
          <Img src={asset(poster)} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", scale: "1.3", filter: "blur(50px) brightness(0.38) saturate(1.3)" }} />
        ) : null}
        <div style={{ position: "absolute", left, top, width: vw, height: vh, WebkitMaskImage: feather, maskImage: feather,
          scale: String(drift), transformOrigin: `${focus}px 50%` }}>{video}</div>
      </AbsoluteFill>
    );
  }
  const inP = glide(frame, fps);
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <div style={{
        position: "absolute", left: LOWER.x, top: LOWER.y, width: LOWER.w, height: LOWER.h, borderRadius: theme.radius, overflow: "hidden",
        boxShadow: `${theme.shadow}, 0 0 0 5px rgba(255,255,255,0.92)`, backgroundColor: theme.color.ink,
        opacity: Math.min(1, inP * 1.4) * out, scale: String(0.85 + 0.15 * inP), rotate: `${-1.5 * inP}deg`,
      }}>
        {video}
      </div>
    </AbsoluteFill>
  );
};

/** Real video of what is being talked about: found on YouTube for the query and cut before the render. */
export const Footage: React.FC<Props> & { layoutOf: (p: Props, input?: AstraInput) => LayoutDeclaration } = ({ from, to, sfx, ...rest }) => (
  <>
    <Clip from={from} to={to} name={`Footage ${rest.query}`}><Body {...rest} /></Clip>
    <BlockSfx at={from} sfx={sfx} fallback="whoosh" />
  </>
);
Footage.layoutOf = ({ from, to, pos = "full", query, start }, input) =>
  input && !input.assets[footageKey(query, start)] ? {} : pos === "full" ? { occupied: { from, to, zone: "full" } } : { occupied: { from, to, zone: "bottom" } };
