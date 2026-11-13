import React from "react";
import { interpolate } from "remotion";
import { alpha, fonts } from "../design";
import { BlockSfx, type SfxRole } from "./audio";
import { Board, boardLayout, useBoard, type AuthorLayout } from "./board";
import { DisplayLines, SerifLine, useAppear, useSince } from "./boardParts";
import { Icon } from "./icons";

/** Twelve words of the BIP39 list for the screen: a demo phrase that opens no wallet. */
export const DEMO_WORDS = ["ocean", "mirror", "velvet", "rocket", "anchor", "summer", "pencil", "orbit", "castle", "lemon", "puzzle", "canyon"];

type Props = {
  from: number;
  to: number;
  /** 12 words of the BIP39 list; the demo phrase by default. Never a real wallet's phrase. */
  words?: string[];
  title?: string;
  /** The line after the words appear, in the warning color: "Потерял — не восстановить". */
  warning?: string;
  author?: AuthorLayout;
  sfx?: SfxRole | false;
};

const Chip: React.FC<{ index: number; word: string; delay: number; width: number; height: number }> = ({ index, word, delay, width, height }) => {
  const { palette } = useBoard();
  const since = useSince(undefined, delay);
  const p = interpolate(since, [0, 0.35], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <div style={{ width, height, borderRadius: 20, background: palette.surface, border: `2px solid ${palette.line}`, display: "flex", alignItems: "center", gap: 14, padding: "0 20px",
      boxSizing: "border-box", opacity: 0.25 + 0.75 * p, translate: `0 ${(1 - p) * 14}px` }}>
      <span style={{ fontFamily: fonts.mono, fontSize: 26, color: palette.muted, width: 38 }}>{String(index + 1).padStart(2, "0")}</span>
      <span style={{ fontFamily: fonts.mono, fontWeight: 700, fontSize: 38, color: palette.text, filter: `blur(${(1 - p) * 12}px)` }}>{word}</span>
    </div>
  );
};

const Body: React.FC<Omit<Props, "from" | "to" | "author" | "sfx">> = ({ words = DEMO_WORDS, title = "Сид-фраза · 12 слов", warning = "Потерял — не восстановить" }) => {
  const { palette, area } = useBoard();
  const list = words.slice(0, 12);
  const gap = 18;
  const width = Math.floor((Math.min(area.w, 960) - gap * 2) / 3);
  const lastAt = 0.6 + (list.length - 1) * 0.14;
  const lock = useAppear(undefined, lastAt + 0.5, 0.4);
  const compact = area.h < 700;
  const chipH = compact ? 84 : 92;
  const warningPill = (
    <div style={{ display: "flex", alignItems: "center", gap: 16, padding: "12px 28px", borderRadius: 40,
      background: alpha(palette.bad, 0.12), border: `2px solid ${alpha(palette.bad, 0.5)}` }}>
      <Icon name="lock" size={40} color={palette.bad} stroke={2} />
      <SerifLine text={warning} color={palette.bad} size={46} delay={lastAt + 0.5} />
    </div>
  );
  const titleRow = (
    <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
      <Icon name="key-round" size={compact ? 54 : 64} color={palette.accent} stroke={1.8} />
      <DisplayLines lines={[title]} width={area.w - 90} max={compact ? 66 : 80} color={palette.text} delay={0.1} />
    </div>
  );
  return (
    <div style={{ position: "absolute", left: area.x, top: area.y, width: area.w, height: area.h, display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", gap: compact ? 22 : 34 }}>
      {compact ? (
        // Half a screen has room for one line above the words: the title, then the warning in its place.
        <div style={{ position: "relative", height: 80, width: area.w, display: "flex", justifyContent: "center", alignItems: "center" }}>
          <div style={{ position: "absolute", opacity: 1 - lock, translate: `0 ${-lock * 20}px` }}>{titleRow}</div>
          <div style={{ position: "absolute", opacity: lock, translate: `0 ${(1 - lock) * 20}px` }}>{warningPill}</div>
        </div>
      ) : titleRow}
      <div style={{ display: "grid", gridTemplateColumns: `repeat(3, ${width}px)`, gap: compact ? 14 : gap }}>
        {list.map((word, i) => <Chip key={i} index={i} word={word} delay={0.6 + i * 0.14} width={width} height={chipH} />)}
      </div>
      {compact ? null : <div style={{ opacity: lock, translate: `0 ${(1 - lock) * 16}px` }}>{warningPill}</div>}
    </div>
  );
};

/** A wallet's secret phrase: twelve words revealed one by one, then the warning that nobody can restore it. */
export const SeedPhrase: React.FC<Props> & { layoutOf: (p: Props) => ReturnType<typeof boardLayout> } = ({ from, to, author = "split", sfx, ...rest }) => (
  <>
    <Board from={from} to={to} author={author} name="SeedPhrase"><Body {...rest} /></Board>
    <BlockSfx at={from} sfx={sfx} fallback="whoosh" />
  </>
);
SeedPhrase.layoutOf = ({ from, to, author = "split" }) => boardLayout(from, to, author);
