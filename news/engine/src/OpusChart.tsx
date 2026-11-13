// График «Опус 5.5»: во что превращалось вложение — линия идёт от дня покупки до сегодня, сумма над ней растёт вместе с
// линией, в конце — итог. Вид — газетный, светлый: страница, чёрная линия, жёлтая заливка (как маркер на снимках сайтов),
// без неона (владелец 01.11: «иишный» вид режет глаза). Рисуется отдельным клипом и встаёт в монтаж как план.
import React from "react";
import { AbsoluteFill, Easing, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { loadFont } from "@remotion/fonts";

loadFont({ family: "MontserratBlack", url: staticFile("fonts/Montserrat-Black.ttf"), weight: "900" });

export type ChartProps = {
  /** Название монеты, как в ролике: «Биткоин». */
  coin: string;
  /** Подпись вложения: «1 $ · 12 января 2009». */
  invested: string;
  /** Точки: t — секунды Unix, v — сколько стоило вложение в этот день, $. */
  points: { t: number; v: number }[];
  /** Кадр, на котором линия доходит до конца и встаёт итог: слово, где автор называет сумму. Нет — 70% клипа. */
  land?: number;
};

const W = 1080;
const H = 1920;
const BOX = { x: 90, y: 640, w: 900, h: 820 };
const INK = "#111111";
const PAPER = "#F6F3EC";
const MARK = "#FFE14D";

/** Деньги так, как их читают: «105 млн $», «8 300 $», «2,9 $». */
function money(v: number): string {
  const sp = (n: number) => n.toLocaleString("ru-RU", { maximumFractionDigits: 0 }).replace(/ /g, " ");
  if (v >= 1e9) return `${(v / 1e9).toLocaleString("ru-RU", { maximumFractionDigits: v >= 1e10 ? 0 : 1 })} млрд $`;
  if (v >= 1e6) return `${(v / 1e6).toLocaleString("ru-RU", { maximumFractionDigits: v >= 1e7 ? 0 : 1 })} млн $`;
  if (v >= 100) return `${sp(v)} $`;
  return `${v.toLocaleString("ru-RU", { maximumFractionDigits: v >= 10 ? 0 : 1 })} $`;
}

export const OpusChart: React.FC<ChartProps> = ({ coin, invested, points, land }) => {
  const f = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const pts = points.length >= 2 ? points : [{ t: 0, v: 1 }, { t: 1, v: 1 }];
  const t0 = pts[0].t;
  const t1 = pts[pts.length - 1].t;
  const vs = pts.map((p) => Math.max(p.v, 1e-9));
  const lo = Math.min(...vs);
  const hi = Math.max(...vs);
  // рост в сотни раз — шкала по порядкам, иначе вся история до последнего года лежит на нуле
  const log = hi / lo > 100;
  const y = (v: number) => {
    const a = log ? Math.log10(Math.max(v, 1e-9)) : v;
    const [a0, a1] = log ? [Math.log10(lo), Math.log10(hi)] : [Math.min(0, lo), hi];
    return BOX.y + BOX.h - ((a - a0) / Math.max(1e-9, a1 - a0)) * BOX.h;
  };
  const x = (t: number) => BOX.x + ((t - t0) / Math.max(1, t1 - t0)) * BOX.w;
  // линия рисуется за первые 70% плана, дальше держится итог
  const end = land !== undefined && land > 12 ? land : durationInFrames * 0.7;
  const drawn = interpolate(f, [6, end], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.inOut(Easing.cubic) });
  const tNow = t0 + (t1 - t0) * drawn;
  const shown = pts.filter((p) => p.t <= tNow);
  const k = pts.findIndex((p) => p.t > tNow);
  const head = k > 0 ? (() => {
    const [a, b] = [pts[k - 1], pts[k]];
    const r = (tNow - a.t) / Math.max(1, b.t - a.t);
    return { t: tNow, v: log ? Math.pow(10, Math.log10(a.v) + (Math.log10(b.v) - Math.log10(a.v)) * r) : a.v + (b.v - a.v) * r };
  })() : pts[pts.length - 1];
  const line = [...shown, head].map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join("");
  const area = `${line}L${x(head.t).toFixed(1)},${BOX.y + BOX.h}L${BOX.x},${BOX.y + BOX.h}Z`;
  const enter = spring({ frame: f, fps, config: { damping: 16, stiffness: 180 } });
  const done = f > end;
  const pop = spring({ frame: f - Math.round(end), fps, config: { damping: 9, stiffness: 220 } });
  const years: number[] = [];
  const y0 = new Date(t0 * 1000).getUTCFullYear();
  const y1 = new Date(t1 * 1000).getUTCFullYear();
  const stepY = Math.max(1, Math.ceil((y1 - y0) / 5));
  for (let yr = y0 + 1; yr <= y1; yr += stepY) years.push(yr);
  const font = "MontserratBlack, Arial, sans-serif";
  return (
    <AbsoluteFill style={{ background: PAPER, fontFamily: font, color: INK }}>
      <div style={{ position: "absolute", left: 90, top: 210, opacity: enter, transform: `translateY(${(1 - enter) * 30}px)` }}>
        <div style={{ fontSize: 46, letterSpacing: 2, textTransform: "uppercase", opacity: 0.55 }}>{coin}</div>
        <div style={{ fontSize: 40, marginTop: 10 }}>вложил {invested}</div>
      </div>
      {/* сумма над линией растёт вместе с ней; в конце — итог крупно на жёлтом */}
      <div style={{ position: "absolute", left: 90, top: 400, fontSize: 112, lineHeight: 1, transform: `scale(${done ? 1 + 0.08 * pop : 1})`, transformOrigin: "0 50%" }}>
        <span style={{ background: done ? MARK : "transparent", padding: "0 14px", borderRadius: 8 }}>{money(head.v)}</span>
      </div>
      <svg width={W} height={H} style={{ position: "absolute", left: 0, top: 0 }}>
        {[0.25, 0.5, 0.75].map((g) => (
          <line key={g} x1={BOX.x} x2={BOX.x + BOX.w} y1={BOX.y + BOX.h * g} y2={BOX.y + BOX.h * g} stroke={INK} strokeOpacity={0.08} strokeWidth={3} />
        ))}
        <line x1={BOX.x} x2={BOX.x + BOX.w} y1={BOX.y + BOX.h} y2={BOX.y + BOX.h} stroke={INK} strokeOpacity={0.35} strokeWidth={4} />
        <path d={area} fill={MARK} fillOpacity={0.45} />
        <path d={line} fill="none" stroke={INK} strokeWidth={9} strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={x(head.t)} cy={y(head.v)} r={20} fill={MARK} stroke={INK} strokeWidth={7} />
        {years.map((yr) => {
          const tx = x(Date.UTC(yr, 0, 1) / 1000);
          return tx > BOX.x + 40 && tx < BOX.x + BOX.w - 20 ? (
            <text key={yr} x={tx} y={BOX.y + BOX.h + 62} fontSize={36} fontFamily={font} textAnchor="middle" fill={INK} fillOpacity={0.55}>{yr}</text>
          ) : null;
        })}
      </svg>
    </AbsoluteFill>
  );
};
