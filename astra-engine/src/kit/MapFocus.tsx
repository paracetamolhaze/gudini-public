import React, { useMemo } from "react";
import { geoAlbersUsa, geoNaturalEarth1, geoPath, type GeoProjection } from "d3-geo";
import { feature, neighbors } from "topojson-client";
import { AbsoluteFill, interpolate, spring } from "remotion";
import countriesTopo from "world-atlas/countries-110m.json";
import statesTopo from "us-atlas/states-10m.json";
import { alpha, fonts, useDesign } from "../design";
import type { LayoutDeclaration } from "./AstraVideo";
import { BlockSfx, type SfxRole } from "./audio";
import { EASE_IN_OUT } from "./motion";
import { Clip, useClip } from "./time";

type Props = {
  from: number;
  to: number;
  /** usa: states map; world: countries map. */
  region: "usa" | "world";
  /** The place to fly to. */
  lat: number;
  lon: number;
  /** Short name on the pin, e.g. «Калифорния». */
  label: string;
  /** English name of the state or country to light up: "California", "Russia". */
  highlight?: string;
  /** How close the camera flies in; 2.5–4 for a state, 3–6 for a country. */
  zoom?: number;
  sfx?: SfxRole | false;
};

type Feature = { type: string; properties: { name?: string }; geometry: unknown };
const BOX = { x: 40, y: 520, w: 1000, h: 820 };

/** Five soft colors of a political map: neighbours never share one, so every border reads. */
const LAND = ["#F4D98C", "#A7DCC3", "#F2B3B3", "#ADC9EA", "#D3BFE6"];

function useMap(region: Props["region"]) {
  return useMemo(() => {
    const topo = (region === "usa" ? statesTopo : countriesTopo) as any;
    const object = region === "usa" ? topo.objects.states : topo.objects.countries;
    const collection = feature(topo, object) as unknown as { features: Feature[] };
    const projection: GeoProjection = (region === "usa" ? geoAlbersUsa() : geoNaturalEarth1()) as GeoProjection;
    projection.fitExtent([[BOX.x, BOX.y], [BOX.x + BOX.w, BOX.y + BOX.h]], collection as any);
    const path = geoPath(projection);
    // Greedy coloring over the borders: each place takes the first color none of its neighbours has.
    const adjacent = neighbors(object.geometries) as number[][];
    const color: number[] = [];
    collection.features.forEach((_, i) => {
      const used = new Set((adjacent[i] ?? []).map(j => color[j]).filter(c => c !== undefined));
      let c = 0;
      while (used.has(c)) c++;
      color[i] = c % LAND.length;
    });
    return {
      features: collection.features.map((f, i) => ({ name: f.properties.name ?? "", d: path(f as any) ?? "", center: path.centroid(f as any), area: path.area(f as any), color: color[i] })),
      projection,
    };
  }, [region]);
}

const Body: React.FC<Omit<Props, "from" | "to" | "sfx">> = ({ region, lat, lon, label, highlight, zoom = region === "usa" ? 3 : 4 }) => {
  const { frame, fps, lengthFrames } = useClip();
  const { features, projection } = useMap(region);
  const point = projection([lon, lat]) ?? [BOX.x + BOX.w / 2, BOX.y + BOX.h / 2];
  const fly = interpolate(frame, [0.35 * fps, 1.9 * fps], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE_IN_OUT });
  // The place glides to the center of the frame while the map grows around it.
  const scale = 1 + (zoom - 1) * fly;
  const target = { x: 540, y: 930 };
  const screen = { x: point[0] + (target.x - point[0]) * fly, y: point[1] + (target.y - point[1]) * fly };
  const tx = screen.x - point[0] * scale, ty = screen.y - point[1] * scale;
  const fade = Math.min(
    interpolate(frame, [0, 0.25 * fps], [0, 1], { extrapolateRight: "clamp" }),
    interpolate(frame, [lengthFrames - 0.25 * fps, lengthFrames], [1, 0], { extrapolateLeft: "clamp" }),
  );
  const pinDrop = spring({ frame: frame - 1.5 * fps, fps, config: { damping: 10, stiffness: 160, mass: 0.7 } });
  const ring = ((frame - 1.7 * fps) / fps) % 1.2;
  const lit = interpolate(frame, [0.9 * fps, 1.6 * fps], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const palette = useDesign();
  const dark = palette.mode === "dark";
  // A political map: states in soft colors, deeper on a dark video; as the place lights up, the rest step back a little.
  const edge = dark ? mix(palette.bg, "#FFFFFF", 0.35) : "#FFFFFF";
  const land = (i: number) => (dark ? mix(LAND[i], palette.bg, 0.45) : LAND[i]);
  // Names are printed on the map in English, as on a real map: they sit on their states and grow with the map.
  // One fixed size in map units — a size that changes every frame made the map five times slower to draw.
  const nameSize = region === "usa" ? 11 : 9;
  const minArea = region === "usa" ? 260 : 420;
  return (
    <AbsoluteFill style={{ opacity: fade, backgroundColor: palette.bg, backgroundImage: `radial-gradient(circle at 50% 45%, ${alpha(dark ? "#FFFFFF" : "#000000", 0.05)} 0%, transparent 70%)` }}>
      <AbsoluteFill style={{ backgroundImage: `linear-gradient(${palette.grid} 1px, transparent 1px), linear-gradient(90deg, ${palette.grid} 1px, transparent 1px)`, backgroundSize: "60px 60px" }} />
      <svg width={1080} height={1920} style={{ position: "absolute" }}>
        <defs>
          <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="10" result="b" />
            <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>
        <g transform={`translate(${tx} ${ty}) scale(${scale})`}>
          {features.map((f, i) => {
            const on = highlight !== undefined && f.name.toLowerCase() === highlight.toLowerCase();
            return (
              <path key={i} d={f.d} vectorEffect="non-scaling-stroke"
                fill={on ? palette.accent : land(f.color)} opacity={on ? 0.35 + 0.65 * lit : 1 - 0.25 * lit} stroke={on ? mix(palette.accent, "#000000", 0.25) : edge}
                strokeWidth={on ? 4 : 1.6} filter={on && lit > 0.5 ? "url(#glow)" : undefined} />
            );
          })}
          {features.map((f, i) => {
            const on = highlight !== undefined && f.name.toLowerCase() === highlight.toLowerCase();
            if (on || !Number.isFinite(f.center[0]) || f.area < minArea) return null;
            return (
              <text key={`n${i}`} x={f.center[0]} y={f.center[1]} textAnchor="middle" dominantBaseline="middle"
                fontFamily={fonts.display} fontWeight={700} fontSize={nameSize} letterSpacing={0.3}
                fill="#1B1D21" stroke="#FFFFFF" strokeWidth={nameSize * 0.18} paintOrder="stroke" strokeLinejoin="round">
                {f.name.toUpperCase()}
              </text>
            );
          })}
        </g>
        {pinDrop > 0.01 ? (
          <g transform={`translate(${screen.x} ${screen.y - (1 - Math.min(1, pinDrop)) * 120})`} opacity={Math.min(1, pinDrop * 2)}>
            {frame > 1.7 * fps ? <circle r={30 + ring * 90} fill="none" stroke={palette.accent} strokeWidth={5} opacity={Math.max(0, 1 - ring / 1.2)} /> : null}
            <path d="M0 0 C -26 -34 -40 -52 -40 -74 A 40 40 0 1 1 40 -74 C 40 -52 26 -34 0 0 Z" fill={palette.accent} stroke={palette.surface} strokeWidth={5} />
            <circle cy={-74} r={15} fill={palette.surface} />
          </g>
        ) : null}
      </svg>
      <div style={{
        position: "absolute", left: 0, right: 0, top: screen.y + 40, display: "flex", justifyContent: "center",
        opacity: interpolate(frame, [1.8 * fps, 2.2 * fps], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
      }}>
        <span style={{
          fontFamily: fonts.display, fontWeight: 700, fontSize: 64, letterSpacing: 1, textTransform: "uppercase", color: palette.text, padding: "10px 32px", borderRadius: 20,
          background: alpha(palette.surface, 0.94), boxShadow: `inset 0 0 0 2px ${palette.line}, 0 16px 40px ${alpha("#000000", dark ? 0.4 : 0.12)}`,
        }}>
          {label}
        </span>
      </div>
    </AbsoluteFill>
  );
};

/** Full-frame map: flies from the whole country or world to a place and drops a pin. For "where". */
export const MapFocus: React.FC<Props> & { layoutOf: (p: Props) => LayoutDeclaration } = ({ from, to, sfx, ...rest }) => (
  <>
    <Clip from={from} to={to} name={`Map ${rest.label}`}><Body {...rest} /></Clip>
    <BlockSfx at={from} sfx={sfx} fallback="whoosh" />
  </>
);
MapFocus.layoutOf = ({ from, to }) => ({ occupied: { from, to, zone: "full" } });

/** Two hex colors mixed: `t` of the way from `a` to `b`. */
function mix(a: string, b: string, t: number): string {
  const pa = /^#([0-9a-f]{6})$/i.exec(a), pb = /^#([0-9a-f]{6})$/i.exec(b);
  if (!pa || !pb) return a;
  const na = parseInt(pa[1], 16), nb = parseInt(pb[1], 16);
  const ch = (n: number, shift: number) => (n >> shift) & 255;
  const out = [16, 8, 0].map(shift => Math.round(ch(na, shift) + (ch(nb, shift) - ch(na, shift)) * t));
  return "#" + out.map(v => v.toString(16).padStart(2, "0")).join("");
}
