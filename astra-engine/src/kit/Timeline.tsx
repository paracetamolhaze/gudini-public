import React from "react";
import { interpolate } from "remotion";
import { fonts } from "../design";
import { BlockSfx, type SfxRole } from "./audio";
import { Board, boardLayout, useBoard, type AuthorLayout } from "./board";
import { DisplayLines, fitSize, useAppear } from "./boardParts";
import { EASE_OUT } from "./motion";
import { useClip } from "./time";

type Event = { year: string; text: string; at?: number };
type Props = {
  from: number;
  to: number;
  /** Two to five events in order, each appearing when said. */
  events: Event[];
  title?: string;
  author?: AuthorLayout;
  sfx?: SfxRole | false;
};

const eventDelay = (i: number) => 0.4 + i * 0.7;

type Sizes = { rowH: number; year: number; text: number; yearCol: number; textW: number; dot: number };

const Row: React.FC<{ event: Event; index: number; current: boolean; sizes: Sizes }> = ({ event, index, current, sizes }) => {
  const { palette } = useBoard();
  const p = useAppear(event.at, eventDelay(index), 0.45);
  return (
    <div style={{ position: "relative", height: sizes.rowH, display: "flex", alignItems: "flex-start", gap: 36, paddingLeft: 90, opacity: p, translate: `${(1 - p) * 40}px 0` }}>
      <div style={{ position: "absolute", left: 40 - sizes.dot / 2, top: sizes.year * 0.5 - sizes.dot / 2, width: sizes.dot, height: sizes.dot, borderRadius: sizes.dot / 2,
        background: current ? palette.accent : palette.bg, border: `${Math.max(4, sizes.dot * 0.12)}px solid ${current ? palette.accent : palette.text}`, boxSizing: "border-box" }} />
      <div style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: sizes.year, lineHeight: 1, color: current ? palette.accentInk : palette.text, width: sizes.yearCol, flexShrink: 0, whiteSpace: "nowrap" }}>{event.year}</div>
      <div style={{ fontFamily: fonts.ui, fontWeight: 500, fontSize: sizes.text, lineHeight: 1.2, color: palette.text, paddingTop: Math.max(0, (sizes.year - sizes.text) * 0.3), maxWidth: sizes.textW }}>{event.text}</div>
    </div>
  );
};

const Body: React.FC<Omit<Props, "from" | "to" | "author" | "sfx">> = ({ events, title }) => {
  const { palette, area } = useBoard();
  const list = events.slice(0, 5);
  const n = list.length;
  const compact = area.h < 700;
  const top = title ? (compact ? 86 : 140) : 0;
  // Two or three events are written big and spread over the board; five still fit.
  const yearCol = Math.round(area.w * 0.42);
  const yearMax = n <= 2 ? (compact ? 104 : 120) : n === 3 ? (compact ? 84 : 98) : (compact ? 64 : 80);
  const year = fitSize(list.map(e => e.year), yearCol - 10, yearMax, fonts.display, "700", 48);
  const text = n <= 2 ? 50 : n === 3 ? 44 : 38;
  const rowH = Math.min(n <= 2 ? 250 : n === 3 ? 200 : 170, (area.h - top) / Math.max(1, n));
  const sizes: Sizes = { rowH, year, text, yearCol, textW: area.w - 90 - yearCol - 36, dot: Math.max(30, Math.round(year * 0.42)) };
  const { absolute, elapsed } = useClip();
  let current = -1;
  list.forEach((e, i) => { if ((e.at !== undefined ? absolute - e.at : elapsed - eventDelay(i)) >= 0) current = i; });
  // The line grows down to each event as it appears.
  const grown = list.reduce((sum, e, i) => {
    if (i === 0) return sum;
    const t = e.at !== undefined ? absolute - e.at : elapsed - eventDelay(i);
    return sum + interpolate(t, [-0.2, 0.3], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE_OUT });
  }, 0);
  const head = useAppear(undefined, 0.1, 0.4);
  return (
    <div style={{ position: "absolute", left: area.x, top: area.y, width: area.w, height: area.h, display: "flex", flexDirection: "column", justifyContent: "center" }}>
      {title ? <div style={{ height: top, opacity: head }}><DisplayLines lines={[title]} width={area.w} max={compact ? 72 : 100} color={palette.text} delay={0.1} /></div> : null}
      <div style={{ position: "relative" }}>
        <div style={{ position: "absolute", left: 38, top: year * 0.5, width: 4, height: grown * rowH, background: palette.muted, opacity: 0.55, borderRadius: 2 }} />
        {list.map((e, i) => <Row key={i} event={e} index={i} current={i === current} sizes={sizes} />)}
      </div>
    </div>
  );
};

/** Years and what happened in them, one after another: the history of a coin, a story in dates. */
export const Timeline: React.FC<Props> & { layoutOf: (p: Props) => ReturnType<typeof boardLayout> } = ({ from, to, author = "split", sfx, ...rest }) => (
  <>
    <Board from={from} to={to} author={author} name="Timeline"><Body {...rest} /></Board>
    <BlockSfx at={from} sfx={sfx} fallback="whoosh" />
  </>
);
Timeline.layoutOf = ({ from, to, author = "split", events }) => boardLayout(from, to, author, events.map(e => e.year).join(" "));
