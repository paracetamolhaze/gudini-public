import React from "react";
import { fitText } from "@remotion/layout-utils";
import { AbsoluteFill, Easing, interpolate, OffthreadVideo, staticFile } from "remotion";
import { faceOf, useInput } from "../input";
import { color as themeColor, theme } from "../theme";
import type { LayoutDeclaration } from "./AstraVideo";
import { BlockSfx, type SfxRole } from "./audio";
import { CameraLayer, useHighestTop } from "./camera";
import { EASE_OUT, leave } from "./motion";
import { Clip, useClip, useClipOffset } from "./time";

type Props = {
  from: number;
  to: number;
  /** A word, a name, a year or a sum, said right now: "JERCOS", "2010", "$840 000 000". Written in heavy capitals. */
  text: string;
  /** The number rolls up from this value to the one in `text` as it appears: `text="$840 000 000" countFrom={40}`. */
  countFrom?: number;
  /** Vertical center of the text; by default a word stands at the crown, a number whole above the head. */
  y?: number;
  /** Face color of the letters; white by default, it reads over any room. */
  color?: string;
  sfx?: SfxRole | false;
};

// The owner's choice for words and numbers behind the author: a rounded, heavy comic face with volume of its own.
const FONT = "Obelix Pro";

/** Brands the viewer knows by color: the word behind the author wears it. */
const BRAND: Record<string, string> = {
  BITCOIN: "#F7931A", BTC: "#F7931A", ETHEREUM: "#8C8CF7", ETH: "#8C8CF7", TELEGRAM: "#2AABEE", TON: "#0098EA", TONCOIN: "#0098EA",
  BINANCE: "#F3BA2F", BNB: "#F3BA2F", TETHER: "#26A17B", USDT: "#26A17B", SOLANA: "#14F195", DOGECOIN: "#C2A633", DOGE: "#C2A633",
  HAMSTER: "#F2A93B", "HAMSTER KOMBAT": "#F2A93B", HMSTR: "#F2A93B", NOTCOIN: "#FFD447", BYBIT: "#F7A600", OKX: "#FFFFFF",
};

/** A hex color darkened by `k` (0..1). */
function darker(hex: string, k: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return "#" + [16, 8, 0].map(shift => Math.round(((n >> shift) & 255) * (1 - k)).toString(16).padStart(2, "0")).join("");
}
const WEIGHT = 700;

/** "$840 000 000" → { prefix: "$", value: 840000000, decimals: 0, suffix: "" }; null when the text is not a number. */
function parseNumber(text: string): { prefix: string; value: number; decimals: number; suffix: string } | null {
  const m = /^([^\d]*?)(\d[\d\s.,]*\d|\d)([^\d]*)$/.exec(text.trim());
  if (!m) return null;
  const digits = m[2].replace(/[\s,]/g, "");
  const value = Number(digits);
  if (!Number.isFinite(value)) return null;
  const decimals = digits.includes(".") ? digits.split(".")[1].length : 0;
  return { prefix: m[1], value, decimals, suffix: m[3] };
}

const group = (n: number, decimals: number) => {
  const [int, frac] = n.toFixed(decimals).split(".");
  return int.replace(/\B(?=(\d{3})+(?!\d))/g, " ") + (frac ? `,${frac}` : "");
};

/**
 * Letters with volume: a lit white face over a darker extruded side and one soft shadow on the wall behind.
 * The side is a few copies of the word stepped down in darkening grey — plain text, cheap to draw on every frame;
 * a stack of shadows or a wide blur made each frame several times slower and starved the render.
 */
const Volume: React.FC<{ text: string; size: number; face: string }> = ({ text, size, face }) => {
  const depth = Math.max(5, Math.round(size * 0.06));
  const steps = 4;
  const white = face.toUpperCase() === "#FFFFFF";
  // The line is taller than the letters: the face gradient paints only inside the line box, and the tall glyphs
  // of Obelix Pro reached above it — their tops showed the grey side instead of the white face.
  const common: React.CSSProperties = { fontFamily: FONT, fontWeight: WEIGHT, fontSize: size, lineHeight: 1.45, letterSpacing: size * 0.01, whiteSpace: "nowrap" };
  return (
    <div style={{ position: "relative", display: "inline-block" }}>
      {/* The shadow on the wall: one copy, one blur. */}
      <div style={{ ...common, position: "absolute", left: 0, top: depth + 8, color: "rgba(0,0,0,0.38)", filter: `blur(${Math.round(size * 0.06)}px)` }}>{text}</div>
      {Array.from({ length: steps }, (_, i) => {
        const k = (steps - i) / steps;
        const shade = Math.round(96 + 70 * (1 - k));
        // The side of a colored word is the same color, darker toward the back.
        const side = white ? `rgb(${shade},${shade + 4},${shade + 8})` : darker(face, 0.35 + 0.3 * k);
        return <div key={i} style={{ ...common, position: "absolute", left: 0, top: Math.round(depth * k), color: side }}>{text}</div>;
      })}
      <div style={{
        ...common, position: "relative", color: "transparent",
        backgroundImage: white
          ? `linear-gradient(180deg, ${face} 0%, ${face} 45%, #E3E7EA 78%, #C9CFD4 100%)`
          : `linear-gradient(180deg, ${face} 0%, ${face} 50%, ${darker(face, 0.12)} 80%, ${darker(face, 0.22)} 100%)`,
        WebkitBackgroundClip: "text", backgroundClip: "text",
      }}>{text}</div>
    </div>
  );
};

const Body: React.FC<Omit<Props, "sfx">> = ({ from, to, text, countFrom, y, color: tint }) => {
  const input = useInput();
  const face = faceOf(input);
  const { frame, fps, lengthFrames } = useClip();
  const offset = useClipOffset();
  const highestTop = useHighestTop();
  const cutout = input.cutouts.find(c => c.from <= from + 0.05 && c.to >= to - 0.05);
  const upper = text.toUpperCase();
  const number = parseNumber(upper);
  const headTop = highestTop(face, from, to);
  const { fontSize } = fitText({ text: upper, withinWidth: 960, fontFamily: FONT, fontWeight: String(WEIGHT) });
  // A number is read digit by digit: it stands whole above the head. A word may hide its lower part behind the head.
  const room = headTop - (theme.safe.top + 20);
  const size = number ? Math.max(90, Math.min(300, fontSize, room / 1.15)) : Math.max(110, Math.min(330, fontSize));
  const center = y ?? (number ? headTop - size * 0.62 : cutout ? headTop + size * 0.1 : headTop - size * 0.45);
  const appear = interpolate(frame, [0, 0.45 * fps], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE_OUT });
  const out = leave(frame, fps, lengthFrames, 0.3);
  // A counted number rolls fast at first and settles on its value, as a counter does.
  let shown = upper;
  if (number && countFrom !== undefined) {
    const k = interpolate(frame, [0.1 * fps, Math.min(1.4 * fps, lengthFrames * 0.7)], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) });
    // Big ranges are counted on a logarithmic scale, so every order of magnitude gets its moment.
    const a = Math.max(countFrom, 0.0001), b = Math.max(number.value, 0.0001);
    const current = b / a > 50 ? Math.exp(Math.log(a) + (Math.log(b) - Math.log(a)) * k) : countFrom + (number.value - countFrom) * k;
    shown = `${number.prefix}${group(k >= 1 ? number.value : current, number.decimals)}${number.suffix}`;
  }
  return (
    <>
      <AbsoluteFill style={{ pointerEvents: "none" }}>
        <div style={{
          position: "absolute", left: 0, right: 0, top: center, translate: `0 ${-50 + (1 - appear) * 10}%`,
          display: "flex", justifyContent: "center",
          opacity: appear * out, scale: String(0.86 + 0.14 * appear),
          filter: `blur(${(1 - appear) * 10 + (1 - out) * 8}px)`,
        }}>
          <Volume text={shown} size={size} face={faceColor(tint, upper)} />
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

/** The face color: a named color of the palette or a hex one; without it a known brand wears its own color, the rest white. */
function faceColor(tint: string | undefined, upper: string): string {
  const resolved = tint ? themeColor(tint, "text") : BRAND[upper] ?? "#FFFFFF";
  return /^#[0-9a-f]{6}$/i.test(resolved) ? resolved : "#FFFFFF";
}

/** A huge word or number behind the author, with volume; a word hides behind the head, a number stands whole above it. */
export const BehindText: React.FC<Props> & { layoutOf: (p: Props) => LayoutDeclaration } = ({ from, to, sfx, ...rest }) => (
  <>
    <Clip from={from} to={to} name={`Behind ${rest.text}`}><Body from={from} to={to} {...rest} /></Clip>
    <BlockSfx at={from} sfx={sfx} fallback="whoosh" />
  </>
);
BehindText.layoutOf = ({ from, to, text }) => ({ occupied: { from, to, zone: "word", text } });
