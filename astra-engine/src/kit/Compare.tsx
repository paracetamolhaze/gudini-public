import React from "react";
import { interpolate } from "remotion";
import { fonts } from "../design";
import { BlockSfx, type SfxRole } from "./audio";
import { Board, boardLayout, useBoard, type AuthorLayout } from "./board";
import { DisplayLines, fitSize, useAppear, useSince } from "./boardParts";
import { Icon, usePicture } from "./icons";
import { EASE_OUT } from "./motion";

type Point = { text: string; at?: number };
type Side = { title: string; icon?: string; items?: Point[]; at?: number };
type Props = {
  from: number;
  to: number;
  left: Side;
  right: Side;
  /** A title over both sides, if the comparison needs one. */
  title?: string;
  /** The side the story leans to gets the accent, and the other side steps back once it is shown: "right" by default. */
  winner?: "left" | "right" | "none";
  author?: AuthorLayout;
  sfx?: SfxRole | false;
};

/** A side comes in when the author starts talking about it: its own `at`, or just before its first point. */
const sideAt = (side: Side) => side.at ?? (side.items?.[0]?.at !== undefined ? side.items[0].at - 0.45 : undefined);

type Sizes = { tile: number; title: number; item: number };

const Band: React.FC<{ side: Side; delay: number; lead: boolean; dim: number; sizes: Sizes }> = ({ side, delay, lead, dim, sizes }) => {
  const { palette } = useBoard();
  const at = sideAt(side);
  const p = useAppear(at, delay, 0.55);
  // A real thing (a coin's logo, a banknote) keeps its own colors: the leading side gets an accent ring, not an accent fill.
  const picture = Boolean(usePicture(side.icon));
  const fill = lead && !picture;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 36, opacity: p * dim, translate: `${(1 - p) * -70}px 0` }}>
      {side.icon ? (
        <div style={{
          width: sizes.tile, height: sizes.tile, borderRadius: sizes.tile * 0.26, flexShrink: 0,
          background: fill ? palette.accent : palette.surface, border: fill ? "none" : lead ? `5px solid ${palette.accent}` : `2px solid ${palette.line}`,
          display: "flex", alignItems: "center", justifyContent: "center", scale: String(0.6 + 0.4 * p),
        }}>
          <Icon name={side.icon} size={sizes.tile * 0.5} color={fill ? palette.onAccent : palette.text} stroke={1.7} picture />
        </div>
      ) : (
        <div style={{ width: 10, alignSelf: "stretch", borderRadius: 5, background: lead ? palette.accent : palette.line, flexShrink: 0 }} />
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: sizes.item * 0.2, minWidth: 0 }}>
        <div style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: sizes.title, lineHeight: 1, color: palette.text, textTransform: "uppercase", whiteSpace: "nowrap" }}>
          {side.title}
        </div>
        {(side.items ?? []).slice(0, 4).map((item, i) => <Item key={i} item={item} delay={delay + 0.35 + i * 0.3} lead={lead} size={sizes.item} />)}
      </div>
    </div>
  );
};

const Item: React.FC<{ item: Point; delay: number; lead: boolean; size: number }> = ({ item, delay, lead, size }) => {
  const { palette } = useBoard();
  const p = useAppear(item.at, delay, 0.45);
  return (
    <div style={{
      fontFamily: fonts.ui, fontWeight: 500, fontSize: size, lineHeight: 1.18, color: lead ? palette.text : palette.muted,
      opacity: p, translate: `0 ${(1 - p) * 18}px`, clipPath: `inset(0 ${(1 - p) * 100}% 0 0)`,
    }}>{item.text}</div>
  );
};

const Body: React.FC<Omit<Props, "from" | "to" | "author" | "sfx">> = ({ left, right, title, winner = "right" }) => {
  const { palette, area } = useBoard();
  const most = Math.max(left.items?.length ?? 0, right.items?.length ?? 0, 1);
  // Two wide bands one above the other: long words fit, the titles can be big.
  const room = area.h - (title ? 150 : 0) - 70;
  const band = room / 2;
  // A tall board (the author in a circle) gets bigger tiles and points.
  const tall = area.h > 800;
  const tile = Math.min(tall ? 220 : 190, band * 0.7);
  const item = (tall ? 8 : 0) + (most >= 4 ? 36 : most === 3 ? 40 : 46);
  const titleMax = Math.min(130, band - most * item * 1.3 - 10);
  const titleSize = fitSize([left.title.toUpperCase(), right.title.toUpperCase()], area.w - tile - 60, titleMax, fonts.display, "700", 52);
  const sizes = { tile, title: titleSize, item };

  // Once the leading side is on screen, the other one steps back.
  const leadAt = winner === "left" ? sideAt(left) : winner === "right" ? sideAt(right) : undefined;
  const sinceLead = useSince(leadAt, winner === "left" ? 0.25 : 0.6);
  const back = winner === "none" ? 1 : interpolate(sinceLead, [0.4, 1.0], [1, 0.42], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE_OUT });
  const line = useAppear(undefined, 0.35, 0.6);

  return (
    <div style={{ position: "absolute", left: area.x, top: area.y, width: area.w, height: area.h, display: "flex", flexDirection: "column", justifyContent: "center", gap: 34 }}>
      {title ? <DisplayLines lines={[title]} width={area.w} max={110} color={palette.text} delay={0.1} /> : null}
      <Band side={left} delay={0.25} lead={winner === "left"} dim={winner === "right" ? back : 1} sizes={sizes} />
      <div style={{ position: "relative", height: 2 }}>
        <div style={{ position: "absolute", inset: 0, background: palette.line, transformOrigin: "left", scale: `${line} 1` }} />
        <div style={{
          position: "absolute", left: tile / 2 - 38, top: -30, width: 76, height: 60, borderRadius: 30, background: palette.bg,
          display: "flex", alignItems: "center", justifyContent: "center", opacity: line,
          fontFamily: fonts.ui, fontWeight: 700, fontSize: 30, letterSpacing: 1, textTransform: "uppercase", color: palette.muted,
        }}>vs</div>
      </div>
      <Band side={right} delay={0.6} lead={winner === "right"} dim={winner === "left" ? back : 1} sizes={sizes} />
    </div>
  );
};

/** Two sides of a comparison, point by point: the bank and bitcoin, a myth and the fact, before and after. */
export const Compare: React.FC<Props> & { layoutOf: (p: Props) => ReturnType<typeof boardLayout> } = ({ from, to, author = "split", sfx, ...rest }) => (
  <>
    <Board from={from} to={to} author={author} name="Compare"><Body {...rest} /></Board>
    <BlockSfx at={from} sfx={sfx} fallback="whoosh" />
  </>
);
Compare.layoutOf = ({ from, to, author = "split", left, right }) =>
  boardLayout(from, to, author, [left.title, right.title, ...(left.items ?? []).map(i => i.text), ...(right.items ?? []).map(i => i.text)].join(" "));
