import React from "react";
import { interpolate } from "remotion";
import { fonts } from "../design";
import { BlockSfx, type SfxRole } from "./audio";
import { Board, boardLayout, useBoard, type AuthorLayout } from "./board";
import { fitSize, MonoLine, SerifLine, useAppear, useSince } from "./boardParts";
import { EASE_IN_OUT } from "./motion";

type Props = {
  from: number;
  to: number;
  /** The number itself: 21000000, 2009, 0.5. */
  value: number;
  /** The count starts here; the same as `value` shows it at once (a year). */
  countFrom?: number;
  decimals?: number;
  /** Thousands separated by spaces (21 000 000); off for a year, which is written 2009. */
  group?: boolean;
  /** Small text right after the number: "BTC", "₽", "%", "лет". */
  suffix?: string;
  prefix?: string;
  /** The italic line under the number, in the accent color. */
  label?: string;
  /** A small monospace note above: "// предел, записанный в правилах". */
  note?: string;
  /** A bar of how much of a limit is reached: `{ value: 19.9, of: 21, label: "добыто, млн" }`. */
  bar?: { value: number; of: number; label?: string };
  author?: AuthorLayout;
  sfx?: SfxRole | false;
};

const format = (n: number, decimals: number, group = true) => n.toLocaleString("ru-RU", { minimumFractionDigits: decimals, maximumFractionDigits: decimals, useGrouping: group });

const Body: React.FC<Omit<Props, "from" | "to" | "author" | "sfx">> = ({ value, countFrom = 0, decimals = 0, group, suffix, prefix, label, note, bar }) => {
  // A four-digit year shown as it is is written without a space.
  const grouped = group ?? !(countFrom === value && Number.isInteger(value) && value >= 1000 && value <= 2999);
  const { palette, area } = useBoard();
  const since = useSince(undefined, 0.3);
  const k = interpolate(since, [0, 1.3], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE_IN_OUT });
  const shown = countFrom === value ? value : countFrom + (value - countFrom) * k;
  const text = `${prefix ?? ""}${format(shown, decimals, grouped)}`;
  // Sized for the final number so the width does not jump while counting.
  const size = fitSize([`${prefix ?? ""}${format(value, decimals, grouped)}${suffix ? "  " + suffix.slice(0, Math.ceil(suffix.length * 0.45)) : ""}`], area.w, 300, fonts.display, "700", 90);
  const appear = useAppear(undefined, 0.25, 0.45);
  const barIn = useAppear(undefined, 0.9, 1.1);
  return (
    <div style={{ position: "absolute", left: area.x, top: area.y, width: area.w, height: area.h, display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", gap: 18 }}>
      {note ? <MonoLine text={note} color={palette.muted} size={30} delay={0.1} align="center" /> : null}
      <div style={{ display: "flex", alignItems: "baseline", gap: size * 0.08, opacity: appear, scale: String(0.92 + 0.08 * appear) }}>
        <span style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: size, lineHeight: 1, color: palette.text, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{text}</span>
        {suffix ? <span style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: size * 0.34, color: palette.accentInk, whiteSpace: "nowrap" }}>{suffix}</span> : null}
      </div>
      {label ? <SerifLine text={label} color={palette.accent} size={60} delay={0.8} align="center" maxWidth={area.w} /> : null}
      {bar ? (
        <div style={{ width: Math.min(820, area.w), marginTop: 26, opacity: Math.min(1, barIn * 2) }}>
          <div style={{ height: 14, borderRadius: 7, background: palette.faint, overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${Math.min(1, bar.value / bar.of) * barIn * 100}%`, background: palette.accent, borderRadius: 7 }} />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 14, fontFamily: fonts.mono, fontSize: 28, color: palette.muted }}>
            <span>{format(bar.value * barIn, bar.value % 1 ? 1 : 0)}{bar.label ? ` ${bar.label}` : ""}</span>
            <span>из {format(bar.of, 0)}</span>
          </div>
        </div>
      ) : null}
    </div>
  );
};

/** A big number that counts up, with its meaning in an italic line: a limit, a year, a price, a percent. */
export const BigNumber: React.FC<Props> & { layoutOf: (p: Props) => ReturnType<typeof boardLayout> } = ({ from, to, author = "split", sfx, ...rest }) => (
  <>
    <Board from={from} to={to} author={author} name={`BigNumber ${rest.value}`}><Body {...rest} /></Board>
    <BlockSfx at={from} sfx={sfx} fallback="whoosh" />
  </>
);
BigNumber.layoutOf = ({ from, to, author = "split", label }) => boardLayout(from, to, author, label);
