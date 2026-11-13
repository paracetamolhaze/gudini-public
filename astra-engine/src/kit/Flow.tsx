import React from "react";
import { interpolate } from "remotion";
import { fonts } from "../design";
import { BlockSfx, type SfxRole } from "./audio";
import { Board, boardLayout, useBoard, type AuthorLayout } from "./board";
import { DisplayLines, SerifLine, useAppear, useSince } from "./boardParts";
import { Icon, usePicture } from "./icons";
import { EASE_OUT } from "./motion";
import { useClip } from "./time";

/** `via` — what goes along the arrow into this step: a sum, a token, a thing ("10 000 BTC", "$25", "2 пиццы"). */
type Step = { icon: string; label: string; at?: number; via?: string };
type Props = {
  from: number;
  to: number;
  /** Two to five steps of a process, each appearing when said; arrows draw between them. */
  steps: Step[];
  title?: string;
  subtitle?: string;
  author?: AuthorLayout;
  sfx?: SfxRole | false;
};

const stepDelay = (i: number) => 0.35 + i * 0.55;

const Node: React.FC<{ step: Step; index: number; active: boolean; box: number; labelSize: number; pad: number }> = ({ step, index, active, box, labelSize, pad }) => {
  const { palette } = useBoard();
  const p = useAppear(step.at, stepDelay(index), 0.4);
  // A real thing (a coin's logo, a banknote) keeps its own colors: the lit step gets an accent ring, not an accent fill.
  const picture = Boolean(usePicture(step.icon));
  const fill = active && !picture;
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 18, opacity: p, scale: String(0.8 + 0.2 * p), width: box + pad }}>
      <div style={{ width: box, height: box, borderRadius: box * 0.24, background: fill ? palette.accent : palette.surface,
        border: fill ? "none" : active ? `5px solid ${palette.accent}` : `2px solid ${palette.line}`,
        display: "flex", alignItems: "center", justifyContent: "center", boxShadow: active ? `0 16px 40px ${palette.accent}55` : "none" }}>
        <Icon name={step.icon} size={box * 0.48} color={fill ? palette.onAccent : palette.text} stroke={1.7} picture />
      </div>
      <div style={{ fontFamily: fonts.ui, fontWeight: 600, fontSize: labelSize, lineHeight: 1.15, color: palette.text, textAlign: "center" }}>{step.label}</div>
    </div>
  );
};

const Arrow: React.FC<{ index: number; step: Step; vertical: boolean; length: number; top?: number }> = ({ index, step, vertical, length, top = 55 }) => {
  const { palette } = useBoard();
  const since = useSince(step.at, stepDelay(index)) + 0.3;
  const k = interpolate(since, [0, 0.3], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE_OUT });
  const w = vertical ? 40 : length, h = vertical ? length : 40;
  // What moves along the arrow rides above it in the accent, as the money in a payment scheme.
  const label = step.via && !vertical ? (
    <div style={{ position: "absolute", left: "50%", bottom: 46, translate: "-50% 0", whiteSpace: "nowrap", opacity: k,
      fontFamily: fonts.mono, fontWeight: 700, fontSize: 27, color: palette.onAccent, background: palette.accent, borderRadius: 12, padding: "4px 10px" }}>{step.via}</div>
  ) : null;
  const [x1, y1, x2, y2] = vertical ? [20, 4, 20, length - 8] : [4, 20, length - 8, 20];
  const path = `M ${x1} ${y1} L ${x2} ${y2}`;
  const head = vertical ? `M 8 ${length - 22} L 20 ${length - 8} L 32 ${length - 22}` : `M ${length - 22} 8 L ${length - 8} 20 L ${length - 22} 32`;
  return (
    <div style={{ position: "relative", flexShrink: 0, alignSelf: vertical ? "center" : undefined, marginTop: vertical ? 0 : top }}>
    {label}
    <svg width={w} height={h} style={{ overflow: "visible", display: "block" }}>
      <path d={path} stroke={palette.muted} strokeWidth={4} strokeLinecap="round" fill="none" strokeDasharray={length} strokeDashoffset={length * (1 - k)} />
      <path d={head} stroke={palette.muted} strokeWidth={4} strokeLinecap="round" strokeLinejoin="round" fill="none" opacity={k > 0.9 ? 1 : 0} />
    </svg>
    </div>
  );
};

const Body: React.FC<Omit<Props, "from" | "to" | "author" | "sfx">> = ({ steps, title, subtitle }) => {
  const { palette, area } = useBoard();
  const list = steps.slice(0, 5);
  const n = list.length;
  // An arrow that carries a sum is as long as the sum is wide.
  const vias = list.slice(1).map(st => st.via ?? "");
  const viaW = Math.max(0, ...vias.map(v => (v ? v.length * 16.5 + 28 : 0)));
  const arrow = Math.max(n <= 2 ? 110 : n === 3 ? 76 : n === 4 ? 54 : 40, Math.min(230, viaW));
  const labelSize = n <= 2 ? 50 : n === 3 ? 44 : n === 4 ? 36 : 30;
  // Labels under the tiles wrap, so three or more steps sit closer and their tiles grow.
  const pad = n >= 3 ? 24 : 56;
  const byWidth = Math.floor((area.w - (n - 1) * (arrow + 2)) / n - pad);
  const byHeight = Math.floor(area.h - (title ? 160 : 0) - (subtitle ? 90 : 0) - labelSize * 2.4 - 60);
  const box = Math.max(90, Math.min(260, byWidth, byHeight));
  // The step said last is the one lit.
  const { absolute, elapsed } = useClip();
  let active = -1;
  list.forEach((s, i) => { if ((s.at !== undefined ? absolute - s.at : elapsed - stepDelay(i)) >= 0) active = i; });
  const body = (
    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "center", gap: 2 }}>
      {list.map((step, i) => (
        <React.Fragment key={i}>
          {i > 0 ? <Arrow index={i} step={step} vertical={false} length={arrow} top={box / 2 - 20} /> : null}
          <Node step={step} index={i} active={i === active} box={box} labelSize={labelSize} pad={pad} />
        </React.Fragment>
      ))}
    </div>
  );
  return (
    <div style={{ position: "absolute", left: area.x, top: area.y, width: area.w, height: area.h, display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", gap: 44 }}>
      {title ? <DisplayLines lines={[title]} width={area.w} max={110} color={palette.text} align="center" delay={0.1} /> : null}
      {body}
      {subtitle ? <SerifLine text={subtitle} color={palette.accent} size={54} delay={stepDelay(list.length)} align="center" maxWidth={area.w} /> : null}
    </div>
  );
};

/** A process as steps with arrows: who sends, what happens, where it ends up. */
export const Flow: React.FC<Props> & { layoutOf: (p: Props) => ReturnType<typeof boardLayout> } = ({ from, to, author = "split", sfx, ...rest }) => (
  <>
    <Board from={from} to={to} author={author} name="Flow"><Body {...rest} /></Board>
    <BlockSfx at={from} sfx={sfx} fallback="whoosh" />
  </>
);
Flow.layoutOf = ({ from, to, author = "split", steps }) => boardLayout(from, to, author, steps.map(s => s.label).join(" "));
