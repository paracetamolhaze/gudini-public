import React, { useLayoutEffect, useRef } from "react";
import { gsap } from "gsap";
import { DrawSVGPlugin } from "gsap/DrawSVGPlugin";
import { MorphSVGPlugin } from "gsap/MorphSVGPlugin";
import { SplitText } from "gsap/SplitText";
import { TextPlugin } from "gsap/TextPlugin";
import { BlockSfx, Sfx, type SfxRole } from "./audio";
import { Board, boardLayout, useBoard, type AuthorLayout } from "./board";
import { useClip } from "./time";
import { OffthreadVideo, staticFile } from "remotion";
import { useInput } from "../input";
import { graphicKey } from "../graphicKey";
import { uiCss } from "./ui";

gsap.registerPlugin(DrawSVGPlugin, MorphSVGPlugin, SplitText, TextPlugin);

type Vars = Record<string, string | number | boolean>;

/** One move of the graphic, at its second of the video: what moves, from where, to where, how. */
export type GraphicStep = {
  /** Second of the video when the move starts — the start of the word it shows. */
  at: number;
  /** CSS selector inside the graphic: ".coin", "#arrow", ".row span". */
  sel: string;
  /** Seconds the move lasts (0.6 by default). */
  dur?: number;
  /** Where it comes from (GSAP vars): { y: 80, opacity: 0 }, { drawSVG: "0%" }, { scale: 0 }. */
  from?: Vars;
  /** Where it goes (GSAP vars): { x: 300 }, { rotation: 360 }, { morphSVG: "#lock-closed" }, { text: "ПОДТВЕРЖДЕНО" }. */
  to?: Vars;
  /** GSAP ease: "power3.out" (default), "back.out(1.7)", "elastic.out(1,0.5)", "expo.inOut", "none". */
  ease?: string;
  /** Several matched elements one after another, this many seconds apart. */
  stagger?: number;
  /** Text of the matched element splits into letters or words, which move one by one. */
  split?: "chars" | "words";
  /** The number in the element rolls from one value to another: { from: 0, to: 21000000, prefix: "$", suffix: "", decimals: 0 }. */
  count?: { from: number; to: number; prefix?: string; suffix?: string; decimals?: number };
  /** The sound of this move at `at`: a click of the pointer, keys while text types itself, a pop, a notification. */
  sfx?: SfxRole;
};

type Props = {
  from: number;
  to: number;
  /** Markup of the graphic: HTML and inline SVG, laid out in the board's free area (984×638 under `split`). */
  html: string;
  /** Its styles. Colors and fonts come as variables: var(--accent), var(--text), var(--display)… */
  css?: string;
  /** The moves, each on its word. */
  motion: GraphicStep[];
  author?: AuthorLayout;
  sfx?: SfxRole | false;
};

/** Base of every graphic: the video's palette and fonts as variables, centered content, nothing spilling out. */
const base = (p: ReturnType<typeof useBoard>["palette"]) => `
:host { all: initial; position: absolute; inset: 0; overflow: hidden; display: block;
  --bg: ${p.bg}; --surface: ${p.surface}; --line: ${p.line}; --text: ${p.text}; --muted: ${p.muted}; --faint: ${p.faint};
  --accent: ${p.accent}; --accent-ink: ${p.accentInk}; --on-accent: ${p.onAccent}; --good: ${p.good}; --bad: ${p.bad};
  --display: "Oswald", "Anton", sans-serif; --heavy: "Montserrat", sans-serif; --sans: "Inter", sans-serif;
  --serif: "Playfair Display", serif; --mono: "JetBrains Mono", monospace; --hand: "Caveat", cursive;
  color: var(--text); font-family: var(--sans); font-size: 44px; line-height: 1.15; }
* { box-sizing: border-box; }
.stage { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; }
`;

const number = (v: number, c: NonNullable<GraphicStep["count"]>) =>
  `${c.prefix ?? ""}${v.toLocaleString("ru-RU", { minimumFractionDigits: c.decimals ?? 0, maximumFractionDigits: c.decimals ?? 0 })}${c.suffix ?? ""}`;

/** The graphic itself: its markup in a closed-off root, one paused GSAP timeline, sought to the board's current second. */
const Stage: React.FC<{ html: string; css?: string; motion: GraphicStep[]; from: number }> = ({ html, css, motion, from }) => {
  const { palette, area } = useBoard();
  const { elapsed, fps } = useClip();
  // The board starts on a whole frame: steps count from there, as the playhead does.
  const start = Math.round(from * fps) / fps;
  const host = useRef<HTMLDivElement>(null);
  const timeline = useRef<gsap.core.Timeline | null>(null);

  useLayoutEffect(() => {
    const el = host.current;
    if (!el) return;
    const root = el.shadowRoot ?? el.attachShadow({ mode: "open" });
    root.innerHTML = `<style>${base(palette)}${uiCss(palette, staticFile)}${css ?? ""}</style><div class="stage">${html}</div>`;
    const splits: SplitText[] = [];
    const tl = gsap.timeline({ paused: true });
    // Selectors and morph targets resolve inside the graphic's own root, never in the page around it.
    const find = (sel: string) => Array.from(root.querySelectorAll(sel));
    const resolve = (vars: Vars | undefined) => {
      if (!vars) return {};
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(vars)) {
        if (/^on/i.test(k)) continue;
        out[k] = k === "morphSVG" && typeof v === "string" ? root.querySelector(v) ?? v : v;
      }
      return out;
    };
    for (const step of motion) {
      let targets: Element[] = find(step.sel);
      if (!targets.length) continue;
      const at = Math.max(0, step.at - start);
      const timing = { duration: step.dur ?? 0.6, ease: step.ease ?? "power3.out" };
      if (step.count) {
        const c = step.count;
        targets.forEach((t, i) => {
          const proxy = { v: c.from };
          t.textContent = number(c.from, c);
          tl.to(proxy, { v: c.to, ...timing, onUpdate: () => { t.textContent = number(proxy.v, c); } }, at + i * (step.stagger ?? 0));
        });
        continue;
      }
      if (step.split) {
        const s = new SplitText(targets, { type: step.split });
        splits.push(s);
        targets = step.split === "chars" ? s.chars : s.words;
      }
      const stagger = step.stagger ?? (step.split ? 0.04 : 0);
      const from = resolve(step.from), to = resolve(step.to);
      if (step.from && step.to) tl.fromTo(targets, from, { ...to, ...timing, stagger }, at);
      else if (step.from) tl.from(targets, { ...from, ...timing, stagger }, at);
      else tl.to(targets, { ...to, ...timing, stagger }, at);
    }
    timeline.current = tl;
    tl.seek(elapsed, false);
    return () => { tl.kill(); splits.forEach(s => s.revert()); timeline.current = null; };
    // The graphic is built once per mount; every frame only moves the playhead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [html, css, palette, start]);

  useLayoutEffect(() => { timeline.current?.seek(elapsed, false); }, [elapsed]);

  return <div ref={host} style={{ position: "absolute", left: area.x, top: area.y, width: area.w, height: area.h }} />;
};

const PreparedStage: React.FC<Props> = props => {
  const { area } = useBoard();
  const { assets } = useInput();
  const file = assets[graphicKey(props)];
  return file ? <OffthreadVideo src={staticFile(file)} transparent muted style={{ position: "absolute", left: area.x, top: area.y, width: area.w, height: area.h }} />
    : <Stage html={props.html} css={props.css} motion={props.motion} from={props.from} />;
};

/**
 * A graphic Astra draws herself when no block of the kit shows the idea: her own HTML and SVG on the board,
 * moved by GSAP on the words — a coin that splits, a lock that closes, a path that draws itself, a number that rolls.
 */
export const Graphic: React.FC<Props> & { layoutOf: (p: Props) => ReturnType<typeof boardLayout> } = ({ from, to, author = "split", sfx, html, css, motion }) => (
  <>
    <Board from={from} to={to} author={author} name="Graphic"><PreparedStage from={from} to={to} author={author} html={html} css={css} motion={motion} /></Board>
    <BlockSfx at={from} sfx={sfx} fallback="whoosh" />
    {/* A click sounds when the pointer clicks, keys while text types itself: the sound of each move at its second. */}
    {motion.filter(step => step.sfx).map((step, i) => (
      <Sfx key={i} at={step.at} role={step.sfx!} duration={step.sfx === "typing" ? Math.max(0.3, step.dur ?? 0.6) : undefined} />
    ))}
  </>
);
Graphic.layoutOf = ({ from, to, author = "split" }) => boardLayout(from, to, author);
