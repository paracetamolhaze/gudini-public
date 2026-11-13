import React, { useMemo } from "react";
import { interpolate } from "remotion";
import { alpha, fonts } from "../design";
import { BlockSfx, type SfxRole } from "./audio";
import { Board, boardLayout, useBoard, type AuthorLayout } from "./board";
import { DisplayLines, SerifLine, useAppear, useSince } from "./boardParts";
import { Icon } from "./icons";

type Props = {
  from: number;
  to: number;
  /** The big count under the network: "10 000+". */
  count?: string;
  /** The italic line next to it: "копий у людей по всему миру". */
  label?: string;
  title?: string;
  /** Icon in the center node: the one copy the story follows. */
  icon?: string;
  /** A new record spreads from the center to every node at this second. */
  pulseAt?: number;
  author?: AuthorLayout;
  sfx?: SfxRole | false;
};

/** Deterministic pseudo-random numbers: the same network in every frame and every render. */
function random(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type NodeAt = { x: number; y: number; r: number; d: number };

function layout(width: number, height: number): { nodes: NodeAt[]; links: [number, number][] } {
  const rnd = random(20260929);
  const cx = width / 2, cy = height / 2;
  const nodes: NodeAt[] = [{ x: cx, y: cy, r: 34, d: 0 }];
  const cols = 8, rows = 7;
  for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
    const x = ((i + 0.5) / cols) * width + (rnd() - 0.5) * (width / cols) * 0.7;
    const y = ((j + 0.5) / rows) * height + (rnd() - 0.5) * (height / rows) * 0.7;
    const d = Math.hypot(x - cx, y - cy);
    if (d < 120) continue;
    nodes.push({ x, y, r: 7 + rnd() * 6, d });
  }
  const links: [number, number][] = [];
  nodes.forEach((a, i) => {
    const near = nodes.map((b, j) => ({ j, dist: Math.hypot(a.x - b.x, a.y - b.y) })).filter(n => n.j !== i).sort((p, q) => p.dist - q.dist).slice(0, i === 0 ? 6 : 2);
    near.forEach(n => { if (!links.some(([p, q]) => (p === i && q === n.j) || (p === n.j && q === i))) links.push([i, n.j]); });
  });
  return { nodes, links };
}

const Body: React.FC<Omit<Props, "from" | "to" | "author" | "sfx">> = ({ count, label, title, icon = "notebook", pulseAt }) => {
  const { palette, area } = useBoard();
  const compact = area.h < 700;
  const footer = count ? (compact ? 170 : 220) : 0;
  const top = title && !compact ? 150 : 0;
  const w = area.w, h = Math.max(300, area.h - footer - top);
  const { nodes, links } = useMemo(() => layout(w, h), [w, h]);
  const maxD = Math.max(...nodes.map(n => n.d));
  const grow = useSince(undefined, 0.2);
  const pulse = useSince(pulseAt, 1e9);
  const countIn = useAppear(undefined, 1.2, 0.5);
  const reachAt = (d: number) => (d / maxD) * 1.1;
  const shown = (d: number) => interpolate(grow - reachAt(d), [0, 0.25], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const lit = (d: number) => (pulseAt === undefined ? 0 : interpolate(pulse - (d / maxD) * 0.9, [0, 0.12, 0.7], [0, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }));
  return (
    <div style={{ position: "absolute", left: area.x, top: area.y, width: area.w, height: area.h, display: "flex", flexDirection: "column", alignItems: "center" }}>
      {title ? <div style={{ height: top, display: "flex", alignItems: "center" }}><DisplayLines lines={[title]} width={w} max={110} color={palette.text} align="center" delay={0.1} /></div> : null}
      <svg width={w} height={h} style={{ overflow: "visible" }}>
        {links.map(([i, j], k) => {
          const a = nodes[i], b = nodes[j];
          const s = Math.min(shown(a.d), shown(b.d));
          const glow = Math.max(lit(a.d), lit(b.d));
          return <line key={k} x1={a.x} y1={a.y} x2={a.x + (b.x - a.x) * s} y2={a.y + (b.y - a.y) * s}
            stroke={glow > 0.05 ? palette.accent : palette.line} strokeOpacity={glow > 0.05 ? 0.4 + 0.6 * glow : 1} strokeWidth={2 + glow * 2} />;
        })}
        {nodes.map((n, i) => {
          if (i === 0) return null;
          const s = shown(n.d), g = lit(n.d);
          return <circle key={i} cx={n.x} cy={n.y} r={n.r * (0.4 + 0.6 * s) * (1 + 0.5 * g)} fill={g > 0.05 ? palette.accent : palette.text} fillOpacity={(0.35 + 0.65 * Math.max(g, 0.4)) * s} />;
        })}
      </svg>
      <div style={{ position: "absolute", left: w / 2 - 60, top: top + h / 2 - 60, width: 120, height: 120, borderRadius: 60, background: palette.accent,
        display: "flex", alignItems: "center", justifyContent: "center", boxShadow: `0 0 0 ${10 + 16 * lit(0)}px ${alpha(palette.accent, 0.18)}`, scale: String(shown(0)) }}>
        <Icon name={icon} size={58} color={palette.onAccent} stroke={1.8} picture />
      </div>
      {count ? (
        <div style={{ height: footer, display: "flex", flexDirection: "column", justifyContent: "center", gap: 8, opacity: countIn, translate: `0 ${(1 - countIn) * 24}px` }}>
          <span style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: compact ? 96 : 118, lineHeight: 1, color: palette.text }}>{count}</span>
          {label ? <SerifLine text={label} color={palette.text} size={60} delay={1.4} maxWidth={w} /> : null}
        </div>
      ) : null}
    </div>
  );
};

/** A network of copies: nodes spread from the center, a new record ripples through all of them. */
export const Network: React.FC<Props> & { layoutOf: (p: Props) => ReturnType<typeof boardLayout> } = ({ from, to, author = "split", sfx, ...rest }) => (
  <>
    <Board from={from} to={to} author={author} name="Network"><Body {...rest} /></Board>
    <BlockSfx at={from} sfx={sfx} fallback="whoosh" />
  </>
);
Network.layoutOf = ({ from, to, author = "split", count, label }) => boardLayout(from, to, author, [count, label].filter(Boolean).join(" "));
