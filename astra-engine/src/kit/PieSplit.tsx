import React from "react";
import { Easing, interpolate } from "remotion";
import { fonts } from "../design";
import { BlockSfx, type SfxRole } from "./audio";
import { Board, boardLayout, useBoard, type AuthorLayout } from "./board";
import { fitSize, useAppear, useSince } from "./boardParts";

type Props = {
  from: number;
  to: number;
  /** How many share it, as said: "300 000 000", "10 000". */
  total: string;
  /** What they share it as: "игроков делят один пул". */
  label?: string;
  /** The name of the highlighted slice: "твой кусок". */
  yours?: string;
  /** What stands in place of the count while the pie is still whole: "один пул на всех". */
  whole?: string;
  /** The second the cutting starts: when the author says «делят на всех». */
  at?: number;
  /** The pie is already cut when the board opens: a return to it later in the video, the cutting is not shown twice. */
  cut?: boolean;
  author?: AuthorLayout;
  sfx?: SfxRole | false;
};

const CRUST = "#F9D77A";
const CRUST_EDGE = "#DCA63A";
const CUT = "#7A5414";
/** Cuts drawn on screen stop multiplying here: thinner lines would blur into a plain disc. */
const MAX_CUTS = 72;
/** The viewer's slice never gets thinner than this: a sliver that is still seen. */
const MIN_WEDGE = (3 * Math.PI) / 180;

const group = (n: number) => Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");

/**
 * One pie shared by everyone: it is cut into more and more slices while the count of those who share it rolls up,
 * and the viewer's own slice shrinks to a crumb. For an airdrop, a pool, a limited prize — «делят на всех».
 */
const Body: React.FC<Omit<Props, "from" | "to" | "author" | "sfx">> = ({ total, label, yours = "твой кусок", whole = "один пул на всех", at, cut }) => {
  const { palette, area } = useBoard();
  const appear = useAppear(undefined, 0.1, 0.5);
  const since = useSince(at, 0.8);
  const k = cut ? 1 : interpolate(since, [0, 2.6], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.inOut(Easing.cubic) });
  // Slices double up to 256; the count reads on a logarithmic scale up to the real number.
  const slices = Math.max(1, Math.round(Math.pow(2, 8 * k)));
  const cuts = Math.min(slices, MAX_CUTS);
  const target = Number(total.replace(/[^\d]/g, "")) || 1000;
  // The count starts from a crowd, not from «1»: a hundredth of the total, at most a thousand, and rolls up on a log scale.
  const floor = Math.max(1, Math.min(1000, Math.round(target / 100)));
  const count = k >= 1 ? target : Math.exp(Math.log(floor) + (Math.log(target) - Math.log(floor)) * k);
  const size = Math.min(area.h - 30, area.w * 0.52);
  const r = size / 2;
  const angle = (2 * Math.PI) / Math.max(slices, 1);
  const wedgeAngle = Math.max(angle, MIN_WEDGE);
  const cutAngle = (2 * Math.PI) / cuts;
  // The highlighted slice: from the top, one slice wide; while the pie is whole it is the whole pie.
  const wedge = slices <= 1
    ? `M ${r} ${r} m -${r} 0 a ${r} ${r} 0 1 0 ${2 * r} 0 a ${r} ${r} 0 1 0 -${2 * r} 0`
    : `M ${r} ${r} L ${r} 0 A ${r} ${r} 0 ${wedgeAngle > Math.PI ? 1 : 0} 1 ${r + r * Math.sin(wedgeAngle)} ${r - r * Math.cos(wedgeAngle)} Z`;
  const textW = area.w - size - 44;
  // Before the first cut there is nothing to count: the whole pie is named instead of a lonely «1».
  const cutting = k > 0;
  const countText = cutting ? group(count) : whole;
  const countSize = fitSize([countText], textW, cutting ? 110 : 84, fonts.display, "700", 40);
  const textIn = useAppear(undefined, 0.5, 0.5);
  return (
    <div style={{ position: "absolute", left: area.x, top: area.y, width: area.w, height: area.h, display: "flex", alignItems: "center", gap: 44 }}>
      <svg width={size} height={size} style={{ flexShrink: 0, overflow: "visible", opacity: appear, scale: String(0.85 + 0.15 * appear) }}>
        <defs>
          <radialGradient id="piesplit-crust" cx="50%" cy="42%" r="62%">
            <stop offset="0" stopColor={CRUST} />
            <stop offset="1" stopColor={CRUST_EDGE} />
          </radialGradient>
          <filter id="piesplit-glow" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation={7} /></filter>
        </defs>
        <circle cx={r} cy={r} r={r} fill="url(#piesplit-crust)" />
        <circle cx={r} cy={r} r={r * 0.9} fill="none" stroke={CUT} strokeOpacity={0.3} strokeWidth={r * 0.04} />
        {cuts > 1 ? Array.from({ length: cuts }, (_, i) => {
          const a = i * cutAngle;
          return <line key={i} x1={r} y1={r} x2={r + r * Math.sin(a)} y2={r - r * Math.cos(a)} stroke={CUT} strokeWidth={Math.max(1.8, 5 - cuts / 24)} strokeOpacity={0.85} />;
        }) : null}
        {slices > 1 ? (
          <>
            {/* The viewer's slice glows so it is found even when it is a sliver among dozens of cuts. */}
            <path d={wedge} fill={palette.accent} opacity={0.9} filter="url(#piesplit-glow)" />
            <path d={wedge} fill={palette.accent} stroke="#FFFFFF" strokeWidth={2} />
          </>
        ) : null}
        <circle cx={r} cy={r} r={r} fill="none" stroke={CUT} strokeWidth={6} />
      </svg>
      <div style={{ width: textW, display: "flex", flexDirection: "column", gap: 10, opacity: textIn, translate: `${(1 - textIn) * 30}px 0` }}>
        <div style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: countSize, lineHeight: 1, color: palette.text, whiteSpace: "nowrap" }}>{countText}</div>
        {/* The label reads together with the count («300 000 000 игроков делят один пул»); the whole pie is named alone. */}
        {label && cutting ? <div style={{ fontFamily: fonts.ui, fontWeight: 700, fontSize: 42, lineHeight: 1.15, color: palette.text }}>{label}</div> : null}
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 12, opacity: interpolate(k, [0.15, 0.4], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) }}>
          <span style={{ width: 34, height: 34, borderRadius: 8, background: palette.accent, flexShrink: 0 }} />
          <span style={{ fontFamily: fonts.ui, fontWeight: 700, fontSize: 38, color: palette.text }}>{yours}</span>
        </div>
      </div>
    </div>
  );
};

export const PieSplit: React.FC<Props> & { layoutOf: (p: Props) => ReturnType<typeof boardLayout> } = ({ from, to, author = "split", sfx, ...rest }) => (
  <>
    <Board from={from} to={to} author={author} name="PieSplit"><Body {...rest} /></Board>
    <BlockSfx at={from} sfx={sfx} fallback="whoosh" />
  </>
);
PieSplit.layoutOf = ({ from, to, author = "split", total, label }) => boardLayout(from, to, author, [total, label].filter(Boolean).join(" "));
