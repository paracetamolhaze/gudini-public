import React from "react";
import { interpolate } from "remotion";
import { fonts } from "../design";
import { BlockSfx, Sfx, type SfxRole } from "./audio";
import { Board, boardLayout, useBoard, type AuthorLayout } from "./board";
import { DisplayLines, SerifLine, useAppear, useSince } from "./boardParts";
import { Icon } from "./icons";
import { EASE_OUT } from "./motion";

type Item = { icon: string; label: string; at?: number; crossed?: boolean };
type Props = {
  from: number;
  to: number;
  /** Two to four things, each an icon with a short label, appearing when said. */
  items: Item[];
  /** Cross out every item: "без банка, без директора, без отмены". */
  crossed?: boolean;
  title?: string;
  subtitle?: string;
  author?: AuthorLayout;
  sfx?: SfxRole | false;
};

const Cell: React.FC<{ item: Item; index: number; crossed: boolean; size: number }> = ({ item, index, crossed, size }) => {
  const { palette } = useBoard();
  const p = useAppear(item.at, 0.35 + index * 0.35, 0.45);
  const strikeSince = useSince(item.at, 0.35 + index * 0.35) - 0.35;
  const strike = interpolate(strikeSince, [0, 0.3], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE_OUT });
  const isCrossed = crossed || item.crossed;
  const r = size / 2;
  const len = Math.SQRT2 * size * 0.62;
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 26, width: size + 60, opacity: p, translate: `0 ${(1 - p) * 40}px`, scale: String(0.85 + 0.15 * p) }}>
      <div style={{ position: "relative", width: size, height: size }}>
        <div style={{ position: "absolute", inset: 0, borderRadius: "50%", border: `3px solid ${isCrossed ? palette.line : palette.text}`, background: palette.surface }} />
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", opacity: isCrossed ? 1 - 0.55 * strike : 1 }}>
          <Icon name={item.icon} size={size * 0.46} color={palette.text} stroke={1.5} picture />
        </div>
        {isCrossed ? (
          <svg width={size} height={size} style={{ position: "absolute", inset: 0, overflow: "visible" }}>
            <line x1={r - size * 0.31} y1={r - size * 0.31} x2={r + size * 0.31} y2={r + size * 0.31} stroke={palette.bad} strokeWidth={9} strokeLinecap="round"
              strokeDasharray={len} strokeDashoffset={len * (1 - strike)} />
          </svg>
        ) : null}
      </div>
      <div style={{ fontFamily: fonts.ui, fontWeight: 600, fontSize: size >= 300 ? 52 : 46, lineHeight: 1.15, color: palette.text, textAlign: "center", opacity: isCrossed ? 1 - 0.3 * strike : 1 }}>{item.label}</div>
    </div>
  );
};

const Body: React.FC<Omit<Props, "from" | "to" | "author" | "sfx">> = ({ items, crossed = false, title, subtitle }) => {
  const { palette, area } = useBoard();
  const few = items.slice(0, 4);
  const size = few.length >= 4 ? 230 : few.length === 3 ? 270 : 320;
  const grid = few.length === 4;
  const head = useAppear(undefined, 0.2, 0.4);
  return (
    <div style={{ position: "absolute", left: area.x, top: area.y, width: area.w, height: area.h, display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", gap: 56 }}>
      {title ? <div style={{ opacity: head }}><DisplayLines lines={[title]} width={area.w} max={120} color={palette.text} align="center" delay={0.15} /></div> : null}
      <div style={{ display: "flex", flexWrap: grid ? "wrap" : "nowrap", justifyContent: "center", columnGap: grid ? 90 : 10, rowGap: 50, width: grid ? 2 * (size + 60) + 90 : undefined }}>
        {few.map((item, i) => <Cell key={i} item={item} index={i} crossed={crossed} size={size} />)}
      </div>
      {subtitle ? <SerifLine text={subtitle} color={palette.accent} size={56} delay={0.4 + few.length * 0.35} align="center" maxWidth={area.w} /> : null}
    </div>
  );
};

/** Things as icons with short labels, appearing as they are named; crossed out for "without...". */
export const IconRow: React.FC<Props> & { layoutOf: (p: Props) => ReturnType<typeof boardLayout> } = ({ from, to, author = "split", sfx, ...rest }) => (
  <>
    <Board from={from} to={to} author={author} name="IconRow"><Body {...rest} /></Board>
    <BlockSfx at={from} sfx={sfx} fallback="whoosh" />
    {rest.items.slice(0, 4).map((item, i) => (item.at !== undefined && item.at > from + 0.2 ? <Sfx key={i} at={item.at} role="pop" volume={0.7} /> : null))}
  </>
);
IconRow.layoutOf = ({ from, to, author = "split", items }) => boardLayout(from, to, author, items.map(i => i.label).join(" "));
