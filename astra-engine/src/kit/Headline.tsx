import React from "react";
import { BlockSfx, type SfxRole } from "./audio";
import { Board, boardLayout, useBoard, type AuthorLayout } from "./board";
import { DisplayLines, MonoLine, SerifLine } from "./boardParts";

type Props = {
  from: number;
  to: number;
  /** One to three short lines of the big title; `|` breaks lines: "ДЕНЬГИ|БЕЗ БАНКА". */
  title: string;
  /** The italic line under it, in the accent color: what the title means, in human words. */
  subtitle?: string;
  /** A small monospace note above the title, typed: "// что такое биткоин". */
  note?: string;
  author?: AuthorLayout;
  sfx?: SfxRole | false;
};

const Body: React.FC<Omit<Props, "from" | "to" | "author" | "sfx">> = ({ title, subtitle, note }) => {
  const { palette, area, title: titleRect, author } = useBoard();
  const lines = title.split("|").map(s => s.trim()).filter(Boolean);
  const box = author === "circle-top" && titleRect ? { x: titleRect.x, y: titleRect.y, w: titleRect.w, h: area.y + area.h * 0.5 - titleRect.y } : area;
  const align = author === "circle-top" ? "left" : "center";
  return (
    <div style={{
      position: "absolute", left: box.x, top: box.y, width: box.w, height: box.h,
      display: "flex", flexDirection: "column", justifyContent: "center", alignItems: align === "center" ? "center" : "flex-start", gap: 22,
    }}>
      {note ? <MonoLine text={note} color={palette.muted} size={30} delay={0.15} align={align} /> : null}
      <DisplayLines lines={lines} width={box.w} max={author === "card" || author === "split" ? (lines.length > 1 ? 170 : 210) : 230} color={palette.text} align={align} delay={0.25} />
      {subtitle ? <SerifLine text={subtitle} color={palette.accent} size={author === "card" || author === "split" ? 58 : 64} delay={0.6} align={align} maxWidth={box.w} /> : null}
    </div>
  );
};

/** An editorial title card: a big condensed word, the meaning in an italic line, the author in a circle beside it. */
export const Headline: React.FC<Props> & { layoutOf: (p: Props) => ReturnType<typeof boardLayout> } = ({ from, to, author = "split", sfx, ...rest }) => (
  <>
    <Board from={from} to={to} author={author} name={`Headline ${rest.title}`}><Body {...rest} /></Board>
    <BlockSfx at={from} sfx={sfx} fallback="whoosh" />
  </>
);
Headline.layoutOf = ({ from, to, author = "split", title }) => boardLayout(from, to, author, title.replace(/\|/g, " "));
