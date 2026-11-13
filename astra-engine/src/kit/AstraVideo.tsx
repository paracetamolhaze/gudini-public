import React, { useMemo } from "react";
import { Audio } from "@remotion/media";
import { AbsoluteFill, staticFile } from "remotion";
import { DesignContext, designOf, setActivePalette, type PaletteName } from "../design";
import { faceOf, useInput, type AstraInput } from "../input";
import { theme } from "../theme";
import { AuthorShot } from "./AuthorShot";
import { CROSS, JOIN_GAP } from "./board";
import { buildKeys, CameraContext, CameraLayer, type CamMove, type PanelWindow } from "./camera";
import { LayoutContext, type Occupied } from "./layout";
import { Clip } from "./time";

/** Blocks that take screen space declare it, so the camera and captions can make room. */
export type LayoutDeclaration = { occupied?: Occupied; panel?: PanelWindow };
type WithLayout = { layoutOf?: (props: any, input?: AstraInput) => LayoutDeclaration };

/**
 * A board followed within JOIN_GAP by another one lasts until the next one comes: the window never stands empty,
 * the graphic simply changes. Returns the children with such boards lengthened.
 */
function joinBoards(children: React.ReactNode, input: AstraInput): React.ReactNode[] {
  const list = React.Children.toArray(children);
  const boards = list.flatMap((child, index) => {
    if (!React.isValidElement(child)) return [];
    const layoutOf = (child.type as WithLayout).layoutOf;
    const occupied = layoutOf?.(child.props, input).occupied;
    return occupied?.zone === "board" ? [{ index, from: occupied.from, to: occupied.to }] : [];
  }).sort((a, b) => a.from - b.from);
  const until = new Map<number, number>();
  for (let i = 1; i < boards.length; i++) {
    const gap = boards[i].from - boards[i - 1].to;
    // The earlier board stays a little past the start of the next one: the two graphics cross-fade.
    if (gap > -0.05 && gap <= JOIN_GAP) until.set(boards[i - 1].index, boards[i].from + CROSS);
  }
  // Full-screen pictures one after another: the first stays until the next has come in over it, the author does not flash between them.
  const full = list.flatMap((child, index) => {
    if (!React.isValidElement(child)) return [];
    const occupied = (child.type as WithLayout).layoutOf?.(child.props, input).occupied;
    return occupied?.zone === "full" ? [{ index, from: occupied.from, to: occupied.to }] : [];
  }).sort((a, b) => a.from - b.from);
  for (let i = 1; i < full.length; i++) {
    const gap = full[i].from - full[i - 1].to;
    if (gap > -0.3 && gap <= 0.5) until.set(full[i - 1].index, full[i].from + 0.3);
  }
  // A block that ends at the very end of the video holds to its last frame: no half-faded picture on the final frame.
  list.forEach((child, index) => {
    if (!React.isValidElement(child)) return;
    const to = (child.props as { to?: unknown }).to;
    if (typeof to === "number" && to >= input.duration - 0.6 && to < input.duration + 1) until.set(index, input.duration + 1);
  });
  return list.map((child, index) => (until.has(index) && React.isValidElement(child) ? React.cloneElement(child as React.ReactElement<{ to: number }>, { to: until.get(index)! }) : child));
}

function collect(children: React.ReactNode, out: LayoutDeclaration[], input: AstraInput) {
  React.Children.forEach(children, child => {
    if (!React.isValidElement(child)) return;
    if (child.type === React.Fragment) return collect((child.props as { children?: React.ReactNode }).children, out, input);
    const layoutOf = (child.type as WithLayout).layoutOf;
    if (layoutOf) out.push(layoutOf(child.props, input));
  });
}

const BlurredFill: React.FC = () => (
  <AbsoluteFill>
    <AuthorShot blurred style={{ scale: "1.3" }} />
  </AbsoluteFill>
);

/** Back-to-back panels that move the author the same way become one move: the author stays up between them. */
function mergePanels(panels: PanelWindow[]): PanelWindow[] {
  const merged: PanelWindow[] = [];
  for (const p of [...panels].sort((a, b) => a.from - b.from)) {
    const last = merged[merged.length - 1];
    if (last && p.from - last.to < 0.8 && last.dx === p.dx && last.dy === p.dy && last.zoom === p.zoom) last.to = Math.max(last.to, p.to);
    else merged.push({ ...p });
  }
  return merged;
}

/**
 * The montage root: the author shot with its camera, the voice, and every block above it.
 * Blocks render in order: later children are drawn on top.
 */
export const AstraVideo: React.FC<{
  camera?: CamMove[];
  /** The palette of this video (graphite, paper, lime, ocean, violet): colors of every graphic and accent. */
  palette?: PaletteName;
  /** Replaces the palette's accent: "scene" takes the color the author's frame is lit with, a hex color a brand's own. */
  accent?: string;
  children?: React.ReactNode;
  /**
   * The scene behind every board, about the topic of the video: an English prompt, drawn once before the render
   * ("glowing bitcoin coins and trading charts in the dark, bokeh"). Without it the boards glow in the accent.
   */
  backdrop?: string;
}> = ({ camera = [], palette, accent, backdrop, children }) => {
  const input = useInput();
  const face = faceOf(input);
  const accentColor = accent === "scene" ? input.sceneColor : accent;
  const design = useMemo(() => ({ ...designOf(palette, accentColor), backdrop }), [palette, accentColor, backdrop]);
  // Older blocks read the accent through `theme`: the palette of this video is set before any of them renders.
  setActivePalette(design.palette);
  const joined = useMemo(() => joinBoards(children, input), [children, input]);
  const declarations = useMemo(() => {
    const out: LayoutDeclaration[] = [];
    collect(joined, out, input);
    return out;
  }, [joined, input]);
  const setup = useMemo(() => ({
    keys: buildKeys(camera),
    panels: mergePanels(declarations.flatMap(d => (d.panel ? [d.panel] : []))),
    origin: { x: face.x + face.w / 2, y: face.y + face.h * 0.42 },
  }), [camera, declarations, face.x, face.y, face.w, face.h]);
  const occupied = useMemo(() => declarations.flatMap(d => (d.occupied ? [d.occupied] : [])), [declarations]);

  return (
    <DesignContext.Provider value={design}>
    <CameraContext.Provider value={setup}>
      <LayoutContext.Provider value={occupied}>
        <AbsoluteFill style={{ backgroundColor: theme.color.ink }}>
          {/* When the author moves aside, the space left behind shows the same shot blurred, not black. */}
          {setup.panels.map((p, i) => (
            <Clip key={i} from={Math.max(0, p.from - 0.1)} to={p.to + 0.1} name="Blurred fill">
              <BlurredFill />
            </Clip>
          ))}
          <CameraLayer>
            <AuthorShot muted={Boolean(input.voice)} />
          </CameraLayer>
          {joined}
          {/* Frames carry no sound: without a prepared voice the recording's own audio plays. */}
          {input.voice ? <Audio src={staticFile(input.voice)} /> : input.frames ? <Audio src={staticFile(input.video)} /> : null}
        </AbsoluteFill>
      </LayoutContext.Provider>
    </CameraContext.Provider>
    </DesignContext.Provider>
  );
};
