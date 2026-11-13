import React from "react";
import { interpolate } from "remotion";
import { alpha, fonts } from "../design";
import { BlockSfx, type SfxRole } from "./audio";
import { Board, boardLayout, useBoard, type AuthorLayout } from "./board";
import { DisplayLines, SerifLine, useAppear, useSince } from "./boardParts";
import { EASE_IN_OUT, EASE_OUT } from "./motion";

type Props = {
  from: number;
  to: number;
  /** line — a trend over time, area — the same with the space below filled, bar — amounts side by side. */
  kind?: "line" | "area" | "bar";
  /** The values in order, 3 to 24 of them. */
  values: number[];
  /** Labels under the x axis: one per value, or fewer (shown evenly). */
  labels?: string[];
  title?: string;
  subtitle?: string;
  /** Unit after the numbers: "$", "₽", "%", "BTC". */
  unit?: string;
  decimals?: number;
  /** Which value gets the dot and its number: the last one by default. */
  highlight?: "last" | "max" | "min" | "none" | number;
  author?: AuthorLayout;
  sfx?: SfxRole | false;
};

const fmt = (n: number, decimals: number) => n.toLocaleString("ru-RU", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });

/** A round step for about `ticks` gridlines: 1, 2, 2.5 or 5 times a power of ten. */
function niceStep(range: number, ticks: number): number {
  const raw = range / Math.max(1, ticks);
  const power = Math.pow(10, Math.floor(Math.log10(raw)));
  const unit = raw / power;
  return (unit <= 1 ? 1 : unit <= 2 ? 2 : unit <= 2.5 ? 2.5 : unit <= 5 ? 5 : 10) * power;
}

/** The colors of a move: every price chart reads them without a legend. */
const DOWN = "#FF5A5A";
const UP = "#3DDC84";
const BADGE_H = 76;

const Body: React.FC<Omit<Props, "from" | "to" | "author" | "sfx">> = ({ kind = "line", values, labels = [], title, subtitle, unit = "", decimals = 0, highlight = "last" }) => {
  const { palette, area, title: titleRect, author } = useBoard();
  const data = values.slice(0, 24);
  const head = author === "circle-top" && titleRect ? titleRect : null;
  const compact = area.h < 700;
  const headH = head ? 0 : (title ? (compact ? 84 : 130) : 0) + (subtitle ? (compact ? 52 : 80) : 0);
  // A trend without dates and units is schematic: the shape and the size of the move speak, the axis numbers stay hidden.
  const schematic = kind !== "bar" && !labels.some(Boolean) && !unit;
  const first = data[0] ?? 0;
  const last = data[data.length - 1] ?? 0;
  const swing = first ? (last - first) / Math.abs(first) : 0;
  const trend = kind !== "bar" && data.length >= 3 && Math.abs(swing) >= 0.15 ? (swing < 0 ? "down" : "up") : null;
  const ink = trend === "down" ? DOWN : trend === "up" ? UP : palette.accent;
  const W = area.w, H = area.h - headH - (compact ? 16 : 70);
  const pad = { l: 10, r: schematic ? 30 : 120, t: compact ? 24 : 40, b: 52 };
  const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
  const ticks = 4;
  const lo = Math.min(0, ...data);
  const step = niceStep((Math.max(...data) - lo) || 1, ticks);
  const hi = lo + Math.ceil((((Math.max(...data) - lo) || 1) * 1.04) / step) * step;
  // Gridline numbers show as many decimals as the step needs: a step of 0.25 rounded to integers read 0, 0, 1, 1.
  const tickDecimals = Math.max(decimals, step < 1 ? Math.ceil(-Math.log10(step)) : 0);
  const X = (i: number) => pad.l + (data.length === 1 ? iw / 2 : (i / (data.length - 1)) * iw);
  const Y = (v: number) => pad.t + ih - ((v - lo) / (hi - lo)) * ih;
  const since = useSince(undefined, 0.45);
  const draw = interpolate(since, [0, 1.6], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE_IN_OUT });
  const gridIn = useAppear(undefined, 0.2, 0.5);
  const idx = highlight === "none" ? -1 : highlight === "max" ? data.indexOf(Math.max(...data)) : highlight === "min" ? data.indexOf(Math.min(...data))
    : highlight === "last" ? data.length - 1 : Math.max(0, Math.min(data.length - 1, highlight));
  // A schematic trend ends in a dot even without a number to show.
  const dotIdx = idx >= 0 ? idx : schematic && trend ? data.length - 1 : -1;
  const markIn = interpolate(since, [1.5, 1.9], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE_OUT });
  const pts = data.map((v, i) => [X(i), Y(v)] as const);
  // A schematic move looks like a market, not a ruler: between the values the line gets small fixed wiggles.
  const hash = (n: number) => { const v = Math.sin(n * 12.9898) * 43758.5453; return v - Math.floor(v); };
  const dense = schematic && trend
    ? pts.flatMap(([x, y], i) => {
        if (i === pts.length - 1) return [[x, y] as const];
        const [nx, ny] = pts[i + 1];
        const steps = 8;
        return Array.from({ length: steps }, (_, s) => {
          const t = s / steps;
          const wiggle = s === 0 ? 0 : (hash(i * steps + s) - 0.5) * 0.07 * ih;
          return [x + (nx - x) * t, y + (ny - y) * t + wiggle] as const;
        });
      })
    : pts;
  const path = dense.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const areaPath = `${path} L${X(data.length - 1)} ${Y(lo)} L${X(0)} ${Y(lo)} Z`;
  const length = dense.reduce((sum, p, i) => (i ? sum + Math.hypot(p[0] - dense[i - 1][0], p[1] - dense[i - 1][1]) : 0), 0);
  const every = labels.length >= data.length ? 1 : Math.max(1, Math.ceil(data.length / Math.max(1, labels.length)));
  const barW = Math.min(90, (iw / data.length) * 0.62);
  const gradient = `chart-fill-${data.length}-${Math.round(hi)}-${ink.slice(1)}`;
  // The size of the move sits in a corner the line leaves free: the height of the line is checked under the badge.
  const badge = trend ? `${swing < 0 ? "−" : "+"}${Math.round(Math.abs(swing) * 100)} %` : "";
  const badgeW = 70 + badge.length * 30;
  const yAt = (x: number) => {
    const i = Math.min(pts.length - 2, Math.max(0, Math.floor(((x - pad.l) / iw) * (pts.length - 1))));
    const [x0, y0] = pts[i], [x1, y1] = pts[i + 1];
    return x1 === x0 ? y0 : y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
  };
  const badgeAt = (() => {
    let best = { x: pad.l + iw - badgeW, y: pad.t, room: -1 };
    for (const x of [pad.l + iw - badgeW, pad.l]) {
      const ys = [yAt(x), yAt(x + badgeW), ...pts.filter(([px]) => px >= x && px <= x + badgeW).map(([, py]) => py)];
      const top = Math.min(...ys) - pad.t - 12;
      const bottom = pad.t + ih - Math.max(...ys) - 12;
      const room = Math.max(top, bottom);
      if (room > best.room) best = { x, y: top >= bottom ? pad.t : pad.t + ih - BADGE_H, room };
    }
    return best;
  })();
  return (
    <div style={{ position: "absolute", left: area.x, top: area.y, width: area.w, height: area.h, display: "flex", flexDirection: "column", justifyContent: "center" }}>
      {head ? (
        <div style={{ position: "absolute", left: head.x - area.x, top: head.y - area.y, width: head.w, height: head.h, display: "flex", flexDirection: "column", justifyContent: "center", gap: 10 }}>
          {title ? <DisplayLines lines={[title]} width={head.w} max={96} color={palette.text} delay={0.1} /> : null}
          {subtitle ? <SerifLine text={subtitle} color={palette.accent} size={46} delay={0.4} maxWidth={head.w} /> : null}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 10 }}>
          {title ? <DisplayLines lines={[title]} width={W} max={compact ? 76 : 110} color={palette.text} delay={0.1} /> : null}
          {subtitle ? <SerifLine text={subtitle} color={palette.accent} size={compact ? 42 : 50} delay={0.4} maxWidth={W} /> : null}
        </div>
      )}
      <svg width={W} height={H} style={{ overflow: "visible" }}>
        <defs>
          <linearGradient id={gradient} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor={ink} stopOpacity={kind === "area" ? 0.32 : 0.22} />
            <stop offset="1" stopColor={ink} stopOpacity={0} />
          </linearGradient>
          <clipPath id={`${gradient}-reveal`}><rect x={0} y={0} width={pad.l + iw * draw + 2} height={H} /></clipPath>
          <filter id={`${gradient}-glow`} x="-20%" y="-30%" width="140%" height="160%"><feGaussianBlur stdDeviation={10} /></filter>
        </defs>
        {Array.from({ length: Math.round((hi - lo) / step) + 1 }, (_, i) => {
          const v = lo + step * i;
          const y = Y(v);
          return (
            <g key={i} opacity={gridIn}>
              <line x1={pad.l} x2={pad.l + iw} y1={y} y2={y} stroke={palette.line} strokeWidth={2} strokeDasharray={i ? "6 10" : undefined} />
              {schematic ? null : <text x={pad.l + iw + 18} y={y + 9} fontFamily={fonts.mono} fontSize={24} fill={palette.muted}>{fmt(v, tickDecimals)}</text>}
            </g>
          );
        })}
        {kind === "bar" ? data.map((v, i) => {
          const g = interpolate(since - i * 0.08, [0, 0.6], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE_OUT });
          const h = (Y(lo) - Y(v)) * g;
          return <rect key={i} x={X(i) - barW / 2} y={Y(lo) - h} width={barW} height={h} rx={10} fill={i === idx ? palette.accent : palette.text} fillOpacity={i === idx ? 1 : 0.85} />;
        }) : (
          <>
            {/* A move is filled under the line and glows, like a price chart on a screen; a flat curve stays a thin line. */}
            {kind === "area" || trend ? <path d={areaPath} fill={`url(#${gradient})`} clipPath={`url(#${gradient}-reveal)`} /> : null}
            {trend ? <path d={path} fill="none" stroke={ink} strokeOpacity={0.4} strokeWidth={26} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={length} strokeDashoffset={length * (1 - draw)} filter={`url(#${gradient}-glow)`} /> : null}
            <path d={path} fill="none" stroke={ink} strokeWidth={trend ? 10 : 7} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={length} strokeDashoffset={length * (1 - draw)} />
          </>
        )}
        {labels.length ? data.map((_, i) => (i % every === 0 || i === data.length - 1) && labels[labels.length >= data.length ? i : Math.round(i / every)] ? (
          <text key={i} x={X(i)} y={pad.t + ih + 46} textAnchor={i === 0 ? "start" : i === data.length - 1 ? "end" : "middle"} fontFamily={fonts.mono} fontSize={24} fill={palette.muted} opacity={gridIn}>
            {labels[labels.length >= data.length ? i : Math.round(i / every)]}
          </text>
        ) : null) : null}
        {dotIdx >= 0 ? (
          <g opacity={markIn}>
            <circle cx={X(dotIdx)} cy={Y(data[dotIdx])} r={16 * markIn} fill={ink} />
            <circle cx={X(dotIdx)} cy={Y(data[dotIdx])} r={30 * markIn} fill="none" stroke={ink} strokeOpacity={0.35} strokeWidth={4} />
            {/* The value sits beside its dot, on the side with room, clear of the axis labels. */}
            {idx >= 0 && !schematic ? (
              <g transform={`translate(${X(idx) > pad.l + iw * 0.6 ? X(idx) - 176 : X(idx) + 176}, ${Math.max(pad.t + 40, Math.min(pad.t + ih - 40, Y(data[idx])))})`}>
                <rect x={-130} y={-34} width={260} height={64} rx={32} fill={palette.surface} stroke={palette.line} strokeWidth={2} />
                <text x={0} y={10} textAnchor="middle" fontFamily={fonts.mono} fontWeight={700} fontSize={32} fill={palette.text}>{fmt(data[idx], decimals)}{unit ? ` ${unit}` : ""}</text>
              </g>
            ) : null}
          </g>
        ) : null}
        {trend ? (
          <g opacity={markIn} transform={`translate(${badgeAt.x}, ${badgeAt.y})`}>
            <rect x={0} y={0} width={badgeW} height={BADGE_H} rx={BADGE_H / 2} fill={ink} />
            <text x={badgeW / 2} y={55} textAnchor="middle" fontFamily={fonts.display} fontWeight={700} fontSize={52} fill="#101014">{badge}</text>
          </g>
        ) : null}
      </svg>
      <div style={{ height: 0, background: alpha(palette.text, 0) }} />
    </div>
  );
};

/** A chart that draws itself: a trend, a curve of supply, amounts side by side; the key value gets a dot and its number. */
export const Chart: React.FC<Props> & { layoutOf: (p: Props) => ReturnType<typeof boardLayout> } = ({ from, to, author = "split", sfx, ...rest }) => (
  <>
    <Board from={from} to={to} author={author} name={`Chart ${rest.title ?? ""}`}><Body {...rest} /></Board>
    <BlockSfx at={from} sfx={sfx} fallback="whoosh" />
  </>
);
Chart.layoutOf = ({ from, to, author = "split", title }) => boardLayout(from, to, author, title);
