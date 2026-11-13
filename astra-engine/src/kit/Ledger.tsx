import React from "react";
import { interpolate } from "remotion";
import { alpha, fonts } from "../design";
import { BlockSfx, Sfx, type SfxRole } from "./audio";
import { Board, boardLayout, useBoard, type AuthorLayout } from "./board";
import { fitSize, useAppear, useSince } from "./boardParts";
import { Icon } from "./icons";
import { EASE_OUT } from "./motion";

type Row = { who: string; whom: string; amount: string; at?: number };
type Props = {
  from: number;
  to: number;
  /** Records of the shared notebook, each appearing when said: who, to whom, how much. */
  rows: Row[];
  title?: string;
  /** A forged record: it appears at `at` in red, and at `rejectAt` (when the author says it is rejected) is crossed out and stamped. */
  forged?: Row & { stamp?: string; rejectAt?: number };
  /** The notebook multiplies into copies at `at`: `{ at: 12.4, label: "копий у людей", count: "10 000+" }`. */
  copies?: { at?: number; count: string; label?: string };
  author?: AuthorLayout;
  sfx?: SfxRole | false;
};

/** The row height the fonts are drawn for; rows grow up to ROW_MAX to fill the page. */
const ROW_H = 92;
const ROW_MAX = 130;
const HEAD_H = 176;

const Record: React.FC<{ row: Row; delay: number; h: number; nameSize: number; forged?: boolean; stamp?: string; rejectAt?: number }> = ({ row, delay, h, nameSize, forged, stamp, rejectAt }) => {
  const { palette } = useBoard();
  const k = Math.min(1.2, h / ROW_H);
  const p = useAppear(row.at, delay, 0.4);
  const since = useSince(row.at, delay);
  // Without its own moment the rejection follows the forged line by half a second.
  const reject = useSince(rejectAt ?? row.at, rejectAt !== undefined ? 0 : delay + 0.55);
  const flash = interpolate(since, [0.2, 0.9], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const strike = interpolate(reject, [0, 0.3], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE_OUT });
  const stampIn = interpolate(reject, [0.3, 0.5], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE_OUT });
  const ink = forged ? palette.bad : palette.text;
  // The line of the page is there from the start; the record is written into it when the author says it.
  return (
    <div style={{ position: "relative", height: h, borderTop: `1px solid ${palette.line}`, overflow: "visible" }}>
      <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", padding: "0 34px", gap: 18 * k, opacity: p, translate: `${(1 - p) * -24}px 0`,
        background: forged ? alpha(palette.bad, 0.1 * p) : alpha(palette.accent, 0.18 * flash * p) }}>
        <span style={{ flex: 1.05, fontFamily: fonts.ui, fontWeight: 600, fontSize: nameSize, color: ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{row.who}</span>
        <Icon name="arrow-right" size={40 * k} color={palette.muted} />
        <span style={{ flex: 1.05, fontFamily: fonts.ui, fontWeight: 600, fontSize: nameSize, color: ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{row.whom}</span>
        <span style={{ flex: 0.9, fontFamily: fonts.mono, fontWeight: 700, fontSize: 44 * k, color: ink, textAlign: "right", whiteSpace: "nowrap" }}>{row.amount}</span>
        {forged ? <div style={{ position: "absolute", left: 24, right: 24, top: h / 2 - 2, height: 4, background: palette.bad, scale: `${strike} 1`, transformOrigin: "left center" }} /> : null}
      </div>
      {forged ? (
        <div style={{ position: "absolute", left: "50%", top: h - 30, translate: "-50% 0", rotate: "-5deg", zIndex: 2, opacity: stampIn, scale: String(1.5 - 0.5 * stampIn),
          border: `5px solid ${palette.bad}`, borderRadius: 14, padding: "6px 20px", fontFamily: fonts.mono, fontWeight: 700, fontSize: 36 * k, color: palette.bad,
          letterSpacing: 2, background: alpha(palette.surface, 0.92) }}>{stamp ?? "НЕ ПРИНЯТО"}</div>
      ) : null}
    </div>
  );
};

const Sheet: React.FC<{ title: string; rows: Row[]; forged?: Props["forged"]; width: number; height: number; badge?: { text: string; p: number } }> = ({ title, rows, forged, width, height, badge }) => {
  const { palette } = useBoard();
  const head = useAppear(undefined, 0.15, 0.45);
  const list = rows.slice(0, 5);
  const filled = list.length + (forged ? 1 : 0);
  const pad = forged ? 52 : 16;
  // A page of the notebook: as many lines as fill the board, the records written into the first of them.
  const room = Math.max(ROW_H, height - HEAD_H - pad);
  const lines = Math.max(filled, Math.min(7, Math.floor(room / ROW_MAX)));
  const h = Math.max(ROW_H * 0.85, Math.min(ROW_MAX, room / Math.max(lines, 1)));
  const titleSize = fitSize([title.toUpperCase()], width - 300, 64, fonts.display, "700", 40);
  // Names are written whole: the longest of them sets the size for all, so the columns stay even.
  const k = Math.min(1.2, h / ROW_H);
  const colW = ((width - 68 - 94 * k) * 1.05) / 3;
  const nameSize = fitSize([...list, ...(forged ? [forged] : [])].flatMap(r => [r.who, r.whom]), colW, 46 * k, fonts.ui, "600", 30);
  return (
    <div style={{ width, borderRadius: 30, background: palette.surface, border: `2px solid ${palette.line}`, overflow: "hidden",
      boxShadow: `0 30px 70px ${alpha("#000000", palette.mode === "dark" ? 0.45 : 0.14)}`, opacity: head, translate: `0 ${(1 - head) * 40}px` }}>
      <div style={{ display: "flex", alignItems: "center", gap: 18, padding: "26px 34px 18px", height: 110 }}>
        <Icon name="notebook" size={56} color={palette.accent} stroke={1.8} />
        <span style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: titleSize, color: palette.text, textTransform: "uppercase", flex: 1, whiteSpace: "nowrap" }}>{title}</span>
        {badge && badge.p > 0 ? (
          <span style={{ padding: "8px 20px", borderRadius: 30, background: palette.accent, color: palette.onAccent, fontFamily: fonts.mono, fontWeight: 700, fontSize: 30,
            whiteSpace: "nowrap", opacity: badge.p, scale: String(0.8 + 0.2 * badge.p) }}>{badge.text}</span>
        ) : <span style={{ fontFamily: fonts.mono, fontSize: 26, color: palette.muted }}>стр. 1</span>}
      </div>
      <div style={{ display: "flex", alignItems: "center", padding: "0 34px", height: HEAD_H - 110, gap: 18, fontFamily: fonts.mono, fontSize: 28, color: palette.muted, letterSpacing: 2 }}>
        <span style={{ flex: 1.05 }}>КТО</span><span style={{ width: 40 }} /><span style={{ flex: 1.05 }}>КОМУ</span><span style={{ flex: 0.9, textAlign: "right" }}>СКОЛЬКО</span>
      </div>
      {list.map((row, i) => <Record key={i} row={row} h={h} nameSize={nameSize} delay={0.5 + i * 0.45} />)}
      {forged ? <Record row={forged} h={h} nameSize={nameSize} delay={0.5 + list.length * 0.45 + 0.6} forged stamp={forged.stamp} rejectAt={forged.rejectAt} /> : null}
      {Array.from({ length: lines - filled }, (_, i) => <div key={`empty${i}`} style={{ height: h, borderTop: `1px solid ${palette.line}` }} />)}
      <div style={{ height: pad }} />
    </div>
  );
};

const Body: React.FC<Omit<Props, "from" | "to" | "author" | "sfx">> = ({ rows, title = "Общая тетрадь", forged, copies }) => {
  const { palette, area } = useBoard();
  const width = Math.min(area.w, 960);
  const compact = area.h < 700;
  const copiesSince = useSince(copies?.at, 1.6);
  const copiesCount = useAppear(copies?.at, 1.8, 0.5);
  const spread = copies ? interpolate(copiesSince, [0, 0.8], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE_OUT }) : 0;
  const countIn = copies ? copiesCount : 0;
  const n = 4;
  // The copies fan out above the page and the big count stands under it: the page leaves them room.
  const fan = copies ? 64 : 0;
  const under = copies && !compact ? 170 : 0;
  const sheetH = area.h - fan - under;
  return (
    <div style={{ position: "absolute", left: area.x + (area.w - width) / 2, top: area.y + fan, width, height: area.h - fan, display: "flex", flexDirection: "column", justifyContent: "center", gap: 40 }}>
      <div style={{ position: "relative" }}>
        {/* Copies of the same notebook fan out behind it: the same records at thousands of people. */}
        {copies ? Array.from({ length: n }, (_, i) => (
          <div key={i} style={{ position: "absolute", inset: 0, borderRadius: 30, background: palette.surface, border: `2px solid ${palette.line}`,
            translate: `${(n - i) * 22 * spread}px ${-(n - i) * 16 * spread}px`, rotate: `${(n - i) * 1.2 * spread}deg`, opacity: (0.35 + i * 0.16) * Math.min(1, spread * 3) }} />
        )) : null}
        <div style={{ position: "relative" }}><Sheet title={title} rows={rows} forged={forged} width={width - (copies ? 100 : 0)} height={sheetH}
          badge={copies && compact ? { text: `× ${copies.count}`, p: countIn } : undefined} /></div>
      </div>
      {copies && !compact ? (
        <div style={{ display: "flex", alignItems: "baseline", flexWrap: "wrap", columnGap: 22, rowGap: 6, opacity: countIn, translate: `0 ${(1 - countIn) * 20}px` }}>
          <span style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 120, color: palette.accentInk, lineHeight: 1, whiteSpace: "nowrap" }}>× {copies.count}</span>
          <span style={{ fontFamily: fonts.ui, fontWeight: 700, fontSize: 46, color: palette.text }}>{copies.label ?? "копий у людей"}</span>
        </div>
      ) : null}
    </div>
  );
};

/** The shared notebook of a blockchain: records appear as they are said, copies multiply, a forged line is rejected. */
export const Ledger: React.FC<Props> & { layoutOf: (p: Props) => ReturnType<typeof boardLayout> } = ({ from, to, author = "split", sfx, ...rest }) => (
  <>
    <Board from={from} to={to} author={author} name="Ledger"><Body {...rest} /></Board>
    <BlockSfx at={from} sfx={sfx} fallback="whoosh" />
    {rest.forged?.at !== undefined ? <Sfx at={(rest.forged.rejectAt ?? rest.forged.at + 0.55) + 0.3} role="error" volume={0.8} /> : null}
  </>
);
Ledger.layoutOf = ({ from, to, author = "split" }) => boardLayout(from, to, author);
