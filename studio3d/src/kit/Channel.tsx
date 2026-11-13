import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import channel from "../channel.json";
import { useTimeline, type ChannelProps } from "./timeline";
import { window01 } from "./util";

const BLUE = "#2aabee";
/** Light modules around the code: a scanner needs them, and the card around it is dark. */
export const QR_QUIET = 3;
/** Whole pixels per module, so every square of the code has the same sharp edges in the video. */
const MODULE_PX = 8;
const FADE = 0.3;

/** How much of the card is on screen at t: 0 hidden … 1 in place. */
export const channelShown = (channels: ChannelProps[], t: number) => channels.reduce((k, c) => Math.max(k, window01(t, c.from, c.to, FADE)), 0);

/** The dark modules as one SVG path, a horizontal run per rectangle, offset by the quiet zone. */
export const qrPath = (rows: string[]) =>
  rows
    .flatMap((row, y) => [...row.matchAll(/1+/g)].map((m) => `M${m.index + QR_QUIET} ${y + QR_QUIET}h${m[0].length}v1h-${m[0].length}z`))
    .join("");

const Plane: React.FC = () => (
  <svg width={40} height={40} viewBox="0 0 40 40" style={{ flex: "none" }}>
    <circle cx={20} cy={20} r={20} fill={BLUE} />
    <path d="M9 19.5 29.5 11.5 26 29 19.5 24.5 16.5 27.8 16.8 22.6 26 14.6 14.4 21.6Z" fill="#ffffff" />
  </svg>
);

/**
 * The owner's Telegram channel with its QR code: flat and sharp on top of the 3D frame, in its upper part —
 * above the subtitle line and the heroes' heads in every shot — while the heroes talk about the channel.
 */
export const ChannelCard: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const timeline = useTimeline();
  const k = channelShown(timeline.channels, frame / fps);
  if (k <= 0 || !channel.qr.length) return null;
  const modules = channel.qr.length + QR_QUIET * 2;
  return (
    <AbsoluteFill style={{ alignItems: "center" }}>
      <div
        style={{
          position: "absolute",
          top: 176,
          width: 900,
          boxSizing: "border-box",
          display: "flex",
          alignItems: "center",
          gap: 32,
          padding: "26px 34px 26px 26px",
          borderRadius: 40,
          background: "rgba(9, 12, 34, 0.9)",
          border: `4px solid ${BLUE}`,
          boxShadow: "0 0 0 8px rgba(42, 171, 238, 0.16), 0 18px 48px rgba(0, 0, 0, 0.55)",
          opacity: k,
          transform: `translateY(${(1 - k) * -28}px) scale(${0.94 + 0.06 * k})`,
        }}
      >
        <svg
          width={modules * MODULE_PX}
          height={modules * MODULE_PX}
          viewBox={`0 0 ${modules} ${modules}`}
          shapeRendering="crispEdges"
          style={{ flex: "none", borderRadius: 18, background: "#ffffff" }}
        >
          <path d={qrPath(channel.qr)} fill="#0b0d22" />
        </svg>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14, fontFamily: "Inter", fontWeight: 800, fontSize: 30, letterSpacing: 3, textTransform: "uppercase", color: BLUE }}>
            <Plane />
            {channel.platform}
          </div>
          <div style={{ fontFamily: "Inter", fontWeight: 800, fontSize: 50, lineHeight: 1.05, color: "#ffffff" }}>{channel.name}</div>
          <div style={{ fontFamily: "Obelix Pro", fontWeight: 700, fontSize: 44, color: "#f5c542", WebkitTextStroke: "6px #000000", paintOrder: "stroke fill" }}>{channel.tag}</div>
          <div style={{ fontFamily: "Inter", fontWeight: 600, fontSize: 27, lineHeight: 1.25, color: "#c9cbe6", textWrap: "balance" }}>{channel.about}</div>
        </div>
      </div>
    </AbsoluteFill>
  );
};
