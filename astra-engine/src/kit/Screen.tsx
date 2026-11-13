import React from "react";
import { Img, interpolate } from "remotion";
import { alpha, fonts } from "../design";
import { useInput, type AstraInput } from "../input";
import type { LayoutDeclaration } from "./AstraVideo";
import { screenKey } from "../assetKeys";
import { useAsset } from "./assets";
import { BlockSfx, Sfx, type SfxRole } from "./audio";
import { Board, boardLayout, useBoard, type AuthorLayout } from "./board";
import { EASE_IN_OUT, EASE_OUT } from "./motion";
import { useClip } from "./time";

type Props = {
  from: number;
  to: number;
  /** The real page: "https://github.com/bitcoin/bitcoin", "https://en.wikipedia.org/wiki/Bitcoin_Pizza_Day". */
  url: string;
  /** A phrase that is on the page, word for word: the camera flies to it, a marker runs over it and a ring circles it. */
  find?: string;
  /** Second of the video when the phrase is marked — the word the author names it with. */
  at?: number;
  author?: AuthorLayout;
  sfx?: SfxRole | false;
};

const BAR = 58;
/** The page starts a little closer than its full width: the top of the site reads at once. */
const Z0 = 1.12;
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

/** The browser window with the page, the camera that drifts down it and flies to the phrase, the marker and the ring. */
const Page: React.FC<Props> = ({ from, url, find, at }) => {
  const { area, palette } = useBoard();
  const { elapsed, length } = useClip();
  const input = useInput();
  const asset = useAsset();
  const key = screenKey({ url, find });
  const size = input.sizes[key];
  if (!input.assets[key] || !size) return null;
  let host = url;
  try { host = new URL(url).hostname.replace(/^www\./, ""); } catch { /* shown as written */ }

  // The page as a window a bit narrower than the board; its own pixels map to the window by k.
  const W = area.w * 0.94, k = W / size.w, H = size.h * k + BAR;
  const cx = area.w / 2, cy = area.h / 2;
  const focus = size.focus;
  const mark = (at ?? from + 1.2) - from;
  // Where the camera looks (window coordinates) and how close: the top of the page first, then the phrase.
  const startY = Math.min(H / 2, (area.h * 0.52) / Z0);
  const enter = interpolate(elapsed, [0, 0.75], [0, 1], { ...clamp, easing: EASE_OUT });
  let lx = W / 2, ly = startY, z = Z0;
  let tilt = 1;
  if (focus) {
    const fx = focus[0] * k + (focus[2] * k) / 2, fy = BAR + focus[1] * k + (focus[3] * k) / 2;
    const drift = interpolate(elapsed, [0.4, Math.max(0.5, mark - 0.2)], [0, 0.3], { ...clamp, easing: EASE_IN_OUT });
    const fly = interpolate(elapsed, [mark - 0.25, mark + 0.65], [0, 1], { ...clamp, easing: EASE_IN_OUT });
    // Close enough that the phrase reads big, never so close that it fills the board edge to edge.
    const z1 = Math.max(1.25, Math.min(2.6, (area.w * 0.6) / Math.max(40, focus[2] * k)));
    const hold = interpolate(elapsed, [mark + 0.65, length], [0, 1], clamp);
    const yDrift = startY + (fy - startY) * drift;
    lx = W / 2 + (Math.max(W * 0.3, Math.min(W * 0.7, fx)) - W / 2) * fly;
    ly = yDrift + (fy - yDrift) * fly;
    z = Z0 + (z1 - Z0) * fly + 0.04 * hold;
    tilt = 1 - 0.6 * fly;
  } else {
    // No phrase: the page scrolls slowly under the camera, as if read.
    ly = startY + interpolate(elapsed, [0.5, length], [0, Math.max(0, Math.min(H - area.h * 0.9, H * 0.35))], { ...clamp, easing: EASE_IN_OUT });
    z = Z0 + 0.06 * interpolate(elapsed, [0, length], [0, 1], clamp);
  }
  const rise = (1 - enter) * 260;
  const rotX = (12 + 18 * (1 - enter)) * tilt, rotY = -8 * tilt, rotZ = 1.6 * tilt;
  const markP = interpolate(elapsed, [mark + 0.35, mark + 0.8], [0, 1], { ...clamp, easing: EASE_OUT });
  const ringP = interpolate(elapsed, [mark + 0.5, mark + 1.05], [0, 1], { ...clamp, easing: EASE_OUT });
  const dark = Boolean(size.dark);
  const box = focus ? { x: focus[0] * k - 6, y: BAR + focus[1] * k - 4, w: focus[2] * k + 12, h: focus[3] * k + 8 } : null;
  const pad = 26;
  const ring = box ? { x: box.x - pad, y: box.y - pad * 0.8, w: box.w + pad * 2, h: box.h + pad * 1.6 } : null;
  const perimeter = ring ? Math.PI * (3 * (ring.w / 2 + ring.h / 2) - Math.sqrt((3 * ring.w / 2 + ring.h / 2) * (ring.w / 2 + 3 * ring.h / 2))) : 0;

  return (
    <div style={{ position: "absolute", left: area.x, top: area.y, width: area.w, height: area.h, overflow: "hidden", perspective: 1700, perspectiveOrigin: "50% 38%" }}>
      <div style={{
        position: "absolute", left: cx - lx, top: cy - ly + rise, width: W, height: H, transformOrigin: `${lx}px ${ly}px`,
        transform: `scale(${z}) rotateX(${rotX}deg) rotateY(${rotY}deg) rotateZ(${rotZ}deg)`, opacity: enter,
        borderRadius: 22, overflow: "hidden", background: dark ? "#16171B" : "#FFFFFF",
        boxShadow: `0 40px 90px ${alpha("#000000", palette.mode === "dark" ? 0.6 : 0.22)}, 0 0 0 1.5px ${alpha(dark ? "#FFFFFF" : "#000000", 0.08)}`,
      }}>
        <div style={{ height: BAR, display: "flex", alignItems: "center", gap: 12, padding: "0 20px", background: dark ? "#202126" : "#F1F1F3",
          borderBottom: `1px solid ${alpha(dark ? "#FFFFFF" : "#000000", 0.08)}` }}>
          {["#FF5F57", "#FEBC2E", "#28C840"].map(c => <div key={c} style={{ width: 14, height: 14, borderRadius: 7, background: c }} />)}
          <div style={{ flex: 1, margin: "0 70px 0 24px", height: 34, borderRadius: 17, background: dark ? "#2C2D33" : "#FFFFFF",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 8, fontFamily: fonts.ui, fontWeight: 500, fontSize: 19,
            color: dark ? "rgba(255,255,255,0.75)" : "rgba(0,0,0,0.62)" }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round"><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>
            {host}
          </div>
        </div>
        <Img src={asset(key)} style={{ position: "absolute", left: 0, top: BAR, width: W, height: size.h * k }} />
        {box ? (
          <div style={{ position: "absolute", left: box.x, top: box.y, width: box.w * markP, height: box.h, borderRadius: 6,
            background: dark ? "rgba(255,212,59,0.38)" : "#FFD43B", mixBlendMode: dark ? "normal" : "multiply" }} />
        ) : null}
        {ring ? (
          <svg style={{ position: "absolute", left: ring.x - 10, top: ring.y - 10, overflow: "visible" }} width={ring.w + 20} height={ring.h + 20}>
            <ellipse cx={ring.w / 2 + 10} cy={ring.h / 2 + 10} rx={ring.w / 2} ry={ring.h / 2} fill="none" stroke="#FFD43B" strokeWidth={7 / Math.max(1, z * 0.8)}
              strokeLinecap="round" strokeDasharray={perimeter} strokeDashoffset={perimeter * (1 - ringP)}
              transform={`rotate(-8 ${ring.w / 2 + 10} ${ring.h / 2 + 10})`} style={{ filter: "drop-shadow(0 0 10px rgba(255,212,59,0.55))" }} />
          </svg>
        ) : null}
      </div>
    </div>
  );
};

/**
 * A real page of the web on the board: a repository, a news story, a forum post, a transaction in a block explorer.
 * The window comes in tilted, the camera drifts down the page and flies to the phrase the author names, a highlighter
 * runs over it and a ring circles it — proof on screen instead of a drawing.
 */
export const Screen: React.FC<Props> & { layoutOf: (p: Props, input?: AstraInput) => LayoutDeclaration } = props => {
  const { from, to, author = "split", sfx, find, at } = props;
  // A page that could not be taken is not shown as an empty window: the author stays on screen.
  if (!useInput().assets[screenKey(props)]) return null;
  return (
    <>
      <Board from={from} to={to} author={author} name="Screen"><Page {...props} /></Board>
      <BlockSfx at={from} sfx={sfx} fallback="whoosh" />
      {find ? <Sfx at={(at ?? from + 1.2) + 0.35} role="pop" volume={0.8} /> : null}
    </>
  );
};
Screen.layoutOf = ({ from, to, author = "split", url, find }, input) =>
  input && !input.assets[screenKey({ url, find })] ? {} : boardLayout(from, to, author);
