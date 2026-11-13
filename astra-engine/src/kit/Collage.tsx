import React from "react";
import { AbsoluteFill, Img, interpolate } from "remotion";
import { alpha } from "../design";
import { useInput, type AstraInput } from "../input";
import type { LayoutDeclaration } from "./AstraVideo";
import { cutoutKey } from "../assetKeys";
import { useAsset } from "./assets";
import { BlockSfx, Sfx, type SfxRole } from "./audio";
import { Board, boardLayout, useBoard, type AuthorLayout } from "./board";
import { EASE_OUT } from "./motion";
import { useClip } from "./time";

export type CollageItem = {
  /** English words for Wikimedia Commons: "Laszlo Hanyecz", "Papa John's pizza box". */
  query: string;
  /** The Wikipedia article whose lead photo it is, if there is one. */
  wiki?: string;
  /** Second of the video when this piece is laid on the paper: the word that names it. */
  at: number;
  /** A word on a torn strip of paper under the piece: a name, a place, a year (up to 18 letters). */
  label?: string;
  /** Keep the photo's own colors (a pizza, a red car); people and archive shots stay black and white. */
  color?: boolean;
};

type Props = {
  from: number;
  to: number;
  /** One to three pieces; the first is the main one and stands biggest. */
  items: CollageItem[];
  /** A plaque over the story: «История пиццы», «10 000 BTC» (up to 28 letters). */
  title?: string;
  /** Second the plaque is glued on; by default with the first piece. */
  titleAt?: number;
  /** The paper shape behind the main piece: a sun, a circle of color. A hex color; orange by default. */
  color?: string;
  author?: AuthorLayout;
  sfx?: SfxRole | false;
};

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
/** Cut-paper animation moves on twos: 12 drawings a second, like stop motion. */
const ON_TWOS = 12;
const hash = (n: number) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

/** Fine paper grain: drawn once by the browser as an image, multiplied into everything under it. */
const GRAIN = `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="360" height="360"><filter id="n"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="3" stitchTiles="stitch"/><feColorMatrix values="0 0 0 0 0.35  0 0 0 0 0.3  0 0 0 0 0.24  0 0 0 0.55 0"/></filter><rect width="360" height="360" filter="url(#n)"/></svg>`)}")`;

/** A torn edge: the strip's outline with small random bites along its top and bottom. */
function tornPath(w: number, h: number, seed: number): string {
  const top: string[] = [], bottom: string[] = [];
  const steps = Math.max(6, Math.round(w / 26));
  for (let i = 0; i <= steps; i++) {
    const x = (w * i) / steps;
    top.push(`${x.toFixed(1)}px ${(hash(seed + i) * 7).toFixed(1)}px`);
    bottom.push(`${(w - x).toFixed(1)}px ${(h - hash(seed + 50 + i) * 7).toFixed(1)}px`);
  }
  return `polygon(${[...top, ...bottom].join(",")})`;
}

const Strip: React.FC<{ text: string; size: number; seed: number; paper?: string; ink?: string; serif?: boolean }> = ({ text, size, seed, paper = "#F7F3EA", ink = "#141414", serif = true }) => {
  const w = Math.round(text.length * size * 0.62 + size * 1.2), h = Math.round(size * 1.55);
  return (
    <div style={{ width: w, height: h, background: paper, clipPath: tornPath(w, h, seed), display: "flex", alignItems: "center", justifyContent: "center",
      fontFamily: serif ? "Playfair Display" : "Inter", fontWeight: 900, fontSize: size, color: ink, letterSpacing: -0.5, whiteSpace: "nowrap",
      filter: "drop-shadow(0 6px 10px rgba(0,0,0,0.25))", backgroundImage: GRAIN }}>{text}</div>
  );
};

/** Where each piece stands on the paper and how big, for one, two or three pieces. */
function layout(n: number) {
  if (n <= 1) return [{ cx: 0.55, h: 0.98, rot: -1.5, z: 3 }];
  if (n === 2) return [{ cx: 0.34, h: 0.96, rot: -2, z: 3 }, { cx: 0.72, h: 0.84, rot: 2.5, z: 2 }];
  return [{ cx: 0.5, h: 0.98, rot: -1, z: 3 }, { cx: 0.2, h: 0.72, rot: -4, z: 1 }, { cx: 0.8, h: 0.74, rot: 3.5, z: 2 }];
}

/**
 * One piece: its photo, or (in the upper layer, so a neighbour never covers it) its label strip.
 * Both stand in the same place, so the label is glued over the lower part of its own piece.
 */
const Piece: React.FC<{ item: CollageItem; slot: { cx: number; h: number; rot: number; z: number }; index: number; layer: "photo" | "label" }> = ({ item, slot, index, layer }) => {
  const { area } = useBoard();
  const { absolute } = useClip();
  const input = useInput();
  const asset = useAsset();
  const key = cutoutKey(item);
  const size = input.sizes[key];
  if (!input.assets[key] || !size) return null;
  // Stop motion: time advances in steps of 1/12 s, the piece jumps into place with a little wobble.
  const t = Math.floor((absolute - item.at) * ON_TWOS) / ON_TWOS;
  const p = interpolate(t, [0, 0.5], [0, 1], { ...clamp, easing: EASE_OUT });
  if (t < 0) return null;
  const aspect = size.w / size.h;
  let h = area.h * slot.h, w = h * aspect;
  const maxW = area.w * (slot.z === 3 ? 0.78 : 0.5);
  if (w > maxW) { w = maxW; h = w / aspect; }
  const boil = (hash(Math.floor(absolute * 6) + index * 13) - 0.5) * 0.7;
  const rot = slot.rot + (1 - p) * (index % 2 ? 9 : -9) + boil;
  const x = area.w * slot.cx - w / 2, y = area.h - h + area.h * 0.04 + (1 - p) * 160;
  const place: React.CSSProperties = { position: "absolute", left: x, top: y, width: w, height: h, rotate: `${rot}deg`, scale: String(0.9 + 0.1 * p) };
  if (layer === "photo") {
    return (
      <div style={{ ...place, zIndex: slot.z, opacity: Math.min(1, p * 3) }}>
        <Img src={asset(key)} style={{ width: "100%", height: "100%", filter: "drop-shadow(0 18px 22px rgba(0,0,0,0.32))" }} />
      </div>
    );
  }
  if (!item.label) return null;
  const label = interpolate(Math.floor((absolute - item.at - 0.3) * ON_TWOS) / ON_TWOS, [0, 0.35], [0, 1], { ...clamp, easing: EASE_OUT });
  const text = item.label.toUpperCase();
  return (
    <div style={{ ...place, zIndex: 4, pointerEvents: "none" }}>
      <div style={{ position: "absolute", left: "50%", bottom: h * 0.06, translate: `-50% ${(1 - label) * 40}px`, rotate: `${index % 2 ? 3 : -3}deg`, opacity: label > 0 ? 1 : 0 }}>
        <Strip text={text} size={Math.max(40, Math.min(70, (Math.max(w, 300) * 0.9) / Math.max(4, text.length) / 0.62))} seed={index * 31 + 7} />
      </div>
    </div>
  );
};

const Paper: React.FC<Props> = ({ items, title, titleAt, color = "#E8623A", from }) => {
  const { area, palette, author } = useBoard();
  const { absolute, elapsed, length } = useClip();
  const slots = layout(items.length);
  const first = items[0]?.at ?? from;
  const sun = interpolate(Math.floor((absolute - first + 0.15) * ON_TWOS) / ON_TWOS, [0, 0.45], [0, 1], { ...clamp, easing: EASE_OUT });
  const plaqueAt = titleAt ?? first;
  const plaque = interpolate(Math.floor((absolute - plaqueAt - 0.2) * ON_TWOS) / ON_TWOS, [0, 0.35], [0, 1], { ...clamp, easing: EASE_OUT });
  const push = 1 + 0.045 * interpolate(elapsed, [0, length], [0, 1], clamp);
  const r = Math.min(area.w, area.h) * 0.46;
  // The paper covers the whole panel (edge to edge, under TikTok's bars too); the pieces keep inside the free area.
  const panelH = author === "split" ? 930 : 1920;
  return (
    <div style={{ position: "absolute", left: 0, top: 0, width: 1080, height: panelH, overflow: "hidden", background: "#ECE4D3" }}>
      <AbsoluteFill style={{ backgroundImage: GRAIN, opacity: 0.9 }} />
      {/* A torn band of a second paper across the back gives depth. */}
      <div style={{ position: "absolute", left: -40, top: area.y + area.h * 0.62, width: 1160, height: panelH, background: "#D9CDB4",
        clipPath: tornPath(1160, panelH, 3), rotate: "-3deg" }} />
      <div style={{ position: "absolute", left: area.x, top: area.y, width: area.w, height: area.h, scale: String(push) }}>
        <div style={{ position: "absolute", left: area.w * (slots[0]?.cx ?? 0.55) - r, top: area.h * 0.42 - r, width: 2 * r, height: 2 * r, borderRadius: "50%",
          background: color, scale: String(sun), backgroundImage: GRAIN }} />
        {items.slice(0, 3).map((item, i) => <Piece key={i} item={item} slot={slots[i]} index={i} layer="photo" />)}
        {items.slice(0, 3).map((item, i) => <Piece key={`l${i}`} item={item} slot={slots[i]} index={i} layer="label" />)}
        {title ? (
          <div style={{ position: "absolute", left: area.w * 0.05, top: area.h * 0.07, zIndex: 5, rotate: "-3deg", translate: `0 ${(1 - plaque) * -30}px`, opacity: plaque > 0 ? 1 : 0 }}>
            <div style={{ padding: "14px 28px", background: "#B8322A", color: "#FFD43B", fontFamily: "Playfair Display", fontWeight: 900,
              fontSize: Math.max(44, Math.min(78, (area.w * 0.7) / Math.max(6, title.length) / 0.58)), lineHeight: 1.05, maxWidth: area.w * 0.8,
              boxShadow: `0 14px 24px ${alpha("#000000", 0.3)}`, backgroundImage: GRAIN }}>{title}</div>
          </div>
        ) : null}
      </div>
      <AbsoluteFill style={{ backgroundImage: GRAIN, mixBlendMode: "multiply", opacity: 0.35, pointerEvents: "none" }} />
      <AbsoluteFill style={{ boxShadow: `inset 0 0 90px ${alpha("#3B2A12", palette.mode === "dark" ? 0.35 : 0.18)}` }} />
    </div>
  );
};

/**
 * A paper collage in the manner of Vox documentaries: real archive photos cut out with scissors, a white paper margin,
 * a sun of colored paper behind, torn strips with names, a plaque over the story. Pieces jump in on their words on twos,
 * like stop motion. For stories of real people, places and things: Satoshi, Laszlo and his pizzas, Mt. Gox.
 */
/**
 * Only the pieces that were found and cut out are laid. The paper opens just before the first of them, so it never
 * stands empty waiting for a piece that is not there; when too little time is left for them, it does not come in at all.
 */
function laid(props: Props, input: AstraInput): { items: CollageItem[]; from: number } | null {
  const items = props.items.filter(item => input.assets[cutoutKey(item)]);
  if (!items.length) return null;
  const from = Math.max(props.from, Math.min(...items.map(item => item.at)) - 0.35);
  return props.to - from < 1.6 ? null : { items, from };
}

export const Collage: React.FC<Props> & { layoutOf: (p: Props, input?: AstraInput) => LayoutDeclaration } = props => {
  const { to, author = "split", sfx, titleAt } = props;
  const shown = laid(props, useInput());
  if (!shown) return null;
  const { items, from } = shown;
  return (
    <>
      <Board from={from} to={to} author={author} name="Collage">
        <Paper {...props} from={from} items={items} titleAt={titleAt === undefined ? undefined : Math.max(from, titleAt)} />
      </Board>
      <BlockSfx at={from} sfx={sfx} fallback="swipe" />
      {items.slice(0, 3).map((item, i) => <Sfx key={i} at={item.at} role="pop" volume={0.9} />)}
    </>
  );
};
Collage.layoutOf = (props, input) => {
  const shown = input ? laid(props, input) : { from: props.from };
  return shown ? boardLayout(shown.from, props.to, props.author ?? "split", props.title) : {};
};
