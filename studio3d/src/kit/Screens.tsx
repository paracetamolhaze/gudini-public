import React from "react";
import * as THREE from "three";
import { useCurrentFrame, useVideoConfig } from "remotion";
import { useInput } from "../input";
import { APP_SIZE, appName, DESK_SIZE, desktopLayers, paintDesktop, paintScreen, screenGlow, windowRect, type ScreenContent, type Surface } from "./ScreenApps";
import { useTimeline, type ScreenProps, type Timeline } from "./timeline";

/** A new picture fades in over the old one, like switching windows. */
const FADE = 0.3;
/** Screens repaint at 15 pictures a second: plenty for typing and ticking prices in the background. */
const RATE = 15;

/**
 * A screen of the room is three pictures put together on the graphics card: the desktop under the app (wallpaper, menu
 * bar, the window), the app inside the window's frame, and the desktop over it (the dock, the glass, the dim). Only the
 * app moves, so a repaint sends only the app to the card: sending the whole desktop, 2400 × 1422 every other frame, made
 * a montage render at half speed (scripts/render-bench.ts, 2026-10-23). The layers are mixed in sRGB values, as the
 * 2D canvas mixed them, so the screens look as before. Without the post pass (software WebGL) the whole desktop is still
 * painted on a canvas and blurred there, as it always was: the blur belongs to the whole picture, frame and all.
 */
const VERTEX = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const FRAGMENT = `
uniform sampler2D under;
uniform sampler2D app;
uniform sampler2D over;
uniform vec2 desk;
uniform vec4 window;
uniform float radius;
/** 1: under, app and over are mixed here; 0: under is the whole picture already. */
uniform float layered;
varying vec2 vUv;
vec3 toSRGB(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c)); }
vec3 toLinear(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c)); }
void main() {
  // desk pixels, y down as the canvas draws them
  vec2 p = vec2(vUv.x, 1.0 - vUv.y) * desk;
  vec2 hs = window.zw * 0.5;
  vec2 q = p - window.xy - hs;
  // the window's bottom corners are round, the top ones meet its title bar
  float r = q.y > 0.0 ? radius : 0.0;
  vec2 e = abs(q) - hs + r;
  float d = min(max(e.x, e.y), 0.0) + length(max(e, 0.0)) - r;
  float inside = clamp(0.5 - d / max(fwidth(d), 1e-3), 0.0, 1.0) * layered;
  vec2 a = (p - window.xy) / window.zw;
  vec3 col = toSRGB(texture2D(under, vUv).rgb);
  col = mix(col, toSRGB(texture2D(app, vec2(a.x, 1.0 - a.y)).rgb), inside);
  vec4 o = texture2D(over, vUv);
  col = mix(col, toSRGB(o.rgb), o.a * layered);
  gl_FragColor = vec4(toLinear(col), 1.0);
  #include <colorspace_fragment>
}`;

const make = ([w, h]: [number, number]) => { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; };

const screenTexture = (canvas: HTMLCanvasElement) => {
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
};

/** The desktops' still layers as textures: each is sent to the card once, when its app first shows. */
const layerTextures = new Map<HTMLCanvasElement, THREE.CanvasTexture>();
const layerTexture = (canvas: HTMLCanvasElement) => {
  let texture = layerTextures.get(canvas);
  if (!texture) layerTextures.set(canvas, (texture = screenTexture(canvas)));
  return texture;
};

/**
 * The app drawn at its own size (app, its texture) and the app fading out under it (scratch); without the post pass,
 * the whole desktop too (whole), made on its first use.
 */
type Paint = {
  app: HTMLCanvasElement;
  scratch: HTMLCanvasElement;
  texture: THREE.CanvasTexture;
  material: THREE.ShaderMaterial;
  key: string;
  whole?: { canvas: HTMLCanvasElement; texture: THREE.CanvasTexture };
};
const paints = new Map<Surface, Paint>();

/**
 * The picture of the room's monitor or vertical screen: RoomSet puts this material on the screen,
 * ScreenPainter draws the app on its canvas and picks the desktop's layers. One per render tab — each tab is a page of its own.
 */
export const screenSurface = (surface: Surface): Paint => {
  const hit = paints.get(surface);
  if (hit) return hit;
  const app = make(APP_SIZE[surface]);
  const texture = screenTexture(app);
  const { x, y, w, h, radius } = windowRect(surface);
  const material = new THREE.ShaderMaterial({
    uniforms: {
      under: { value: null },
      app: { value: texture },
      over: { value: null },
      desk: { value: new THREE.Vector2(...DESK_SIZE[surface]) },
      window: { value: new THREE.Vector4(x, y, w, h) },
      radius: { value: radius },
      layered: { value: 1 },
    },
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
  });
  material.name = `${surface} screen`;
  const paint = { app, scratch: make(APP_SIZE[surface]), texture, material, key: "" };
  paints.set(surface, paint);
  return paint;
};

const home = (since: number): ScreenContent => ({ app: "home", title: "", lines: [], since });

const contentOf = (s: ScreenProps | undefined, t: number): ScreenContent =>
  s ? { app: s.app, title: s.title, lines: s.lines ?? [], trend: s.trend, since: t - s.from } : home(t);

/** The director's picture on a screen at time t: the latest one that has started and not ended. */
const pictureAt = (timeline: Timeline, surface: Surface, t: number) =>
  [...timeline.screens].reverse().find((s) => s.on === surface && t >= s.from && t < s.to);

/**
 * What a screen shows at time t, and while a new picture fades in, the one under it.
 * Without a Screen the monitor shows Claude's start page and the vertical screen the market.
 */
export const screenAt = (timeline: Timeline, surface: Surface, t: number) => {
  const current = pictureAt(timeline, surface, t);
  // when the current picture came up: its start, or the end of the last one before the idle picture returned
  const ended = timeline.screens.filter((s) => s.on === surface && s.to <= t).map((s) => s.to);
  const since = current ? current.from : Math.max(0, ...ended);
  const fade = since > 0 ? Math.min(1, (t - since) / FADE) : 1;
  return {
    now: contentOf(current, t),
    before: fade < 1 ? contentOf(pictureAt(timeline, surface, since - 1e-3), t) : null,
    fade,
    id: current ? timeline.screens.indexOf(current) : -1,
  };
};

/** The light a screen throws into the room at time t, blended through a change of picture. */
export const screenLight = (timeline: Timeline, surface: Surface, t: number) => {
  const { now, before, fade } = screenAt(timeline, surface, t);
  const a = screenGlow(now);
  if (!before) return a;
  const b = screenGlow(before);
  return { color: `#${new THREE.Color(b.color).lerp(new THREE.Color(a.color), fade).getHexString()}`, power: b.power + (a.power - b.power) * fade };
};

/** Without the post pass the screens are softened and dimmed on the canvas, so their text never competes with the subtitles. */
const soften = (c: CanvasRenderingContext2D, dim: number) => {
  c.save(); c.filter = "blur(3px)"; c.drawImage(c.canvas, 0, 0); c.restore();
  c.fillStyle = `rgba(8,8,12,${dim})`;
  c.fillRect(0, 0, c.canvas.width, c.canvas.height);
};

/** Draws both screens of the room for the current frame. */
export const ScreenPainter: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const timeline = useTimeline();
  const input = useInput();
  const t = Math.floor((frame / fps) * RATE) / RATE;
  for (const surface of ["monitor", "vertical"] as Surface[]) {
    const paint = screenSurface(surface);
    const { now, before, fade, id } = screenAt(timeline, surface, t);
    const key = `${id}|${t}`;
    if (paint.key === key) continue;
    paint.key = key;
    const a = paint.app.getContext("2d")!;
    const [w, h] = APP_SIZE[surface];
    if (before) {
      paintScreen(a, w, h, surface, before, t);
      const s = paint.scratch.getContext("2d")!;
      paintScreen(s, w, h, surface, now, t);
      a.save(); a.globalAlpha = fade; a.drawImage(paint.scratch, 0, 0); a.restore();
    } else paintScreen(a, w, h, surface, now, t);
    // screens are background: dimmed (the vertical one, filling the owner's close-ups, a touch more) and without the
    // post pass softened, so their text never competes with the subtitles
    const name = appName(fade < 0.5 && before ? before : now, surface);
    const dim = surface === "vertical" ? 0.3 : 0.22;
    const u = paint.material.uniforms;
    if (input.post) {
      paint.texture.needsUpdate = true;
      const layers = desktopLayers(surface, name, dim);
      u.under.value = layerTexture(layers.under);
      u.over.value = layerTexture(layers.over);
      u.layered.value = 1;
    } else {
      if (!paint.whole) {
        const canvas = make(DESK_SIZE[surface]);
        paint.whole = { canvas, texture: screenTexture(canvas) };
      }
      const c = paint.whole.canvas.getContext("2d")!;
      paintDesktop(c, surface, paint.app, name);
      soften(c, dim);
      paint.whole.texture.needsUpdate = true;
      u.under.value = paint.whole.texture;
      u.over.value = paint.whole.texture;
      u.layered.value = 0;
    }
  }
  return null;
};
