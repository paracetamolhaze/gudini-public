import { createContext, useContext } from "react";

/**
 * The look of one video: a palette of a few colors and fixed type roles. Astra picks one palette per video
 * (`<AstraVideo palette="graphite">`); every graphic block takes its colors from it, so the video reads as designed.
 * The accent is a spice: one accented thing per scene, not a default fill.
 */
export type Palette = {
  mode: "dark" | "light";
  /** Background of full-screen graphics. */
  bg: string;
  /** Cards and windows on the background. */
  surface: string;
  /** Hairlines, dividers, outlines. */
  line: string;
  text: string;
  muted: string;
  /** Very soft fills: empty chart area, inactive chips. */
  faint: string;
  accent: string;
  /** Text on an accent fill. */
  onAccent: string;
  /**
   * Accent-colored text on the background. A light accent (lime) cannot be read as text on a light background:
   * there the text stays dark and the accent goes under it as a marker (see `marker`).
   */
  accentInk: string;
  /** The accent is laid under accent text as a highlighter stroke instead of coloring it. */
  marker: boolean;
  good: string;
  bad: string;
  /** The thin background grid. */
  grid: string;
  /** A soft look: no grid, light from above and slow blurred shapes behind the boards, the author's window rounded. */
  soft?: boolean;
};

export const PALETTES = {
  /** Dark graphite, cream text, red accent — editorial, serious topics, explanations. */
  graphite: {
    mode: "dark", bg: "#1B1D21", surface: "#25282E", line: "#3A3E46", text: "#F1EDE4", muted: "rgba(241,237,228,0.62)",
    faint: "rgba(241,237,228,0.1)", accent: "#E5493A", onAccent: "#FFFFFF", accentInk: "#EF5A4B", marker: false, good: "#46C08A", bad: "#E5493A", grid: "rgba(241,237,228,0.055)",
  },
  /** Cream paper, black text, red accent — history, calm explanations, myths. */
  paper: {
    mode: "light", bg: "#ECE6DA", surface: "#F7F3EB", line: "#D5CDBE", text: "#1C1E21", muted: "rgba(28,30,33,0.58)",
    faint: "rgba(28,30,33,0.08)", accent: "#D6402E", onAccent: "#FFFFFF", accentInk: "#C23A29", marker: false, good: "#2E8A58", bad: "#D6402E", grid: "rgba(28,30,33,0.05)",
  },
  /** Light gray and white, black text, lime accent — apps, first steps, practical how-to. */
  lime: {
    mode: "light", bg: "#EDEEEE", surface: "#FFFFFF", line: "#D6D9D9", text: "#121314", muted: "rgba(18,19,20,0.55)",
    faint: "rgba(18,19,20,0.07)", accent: "#D2F01E", onAccent: "#121314", accentInk: "#121314", marker: true, good: "#2F9E68", bad: "#E04A3C", grid: "rgba(18,19,20,0.06)",
  },
  /** Deep navy, mint accent — technology, blockchain, networks. */
  ocean: {
    mode: "dark", bg: "#0B1322", surface: "#132036", line: "#27365A", text: "#E9EFF9", muted: "rgba(233,239,249,0.6)",
    faint: "rgba(233,239,249,0.09)", accent: "#45DBB0", onAccent: "#06121E", accentInk: "#45DBB0", marker: false, good: "#45DBB0", bad: "#FF5E6E", grid: "rgba(233,239,249,0.05)",
  },
  /** Near-black, violet accent — scams, warnings, night, mystery. */
  violet: {
    mode: "dark", bg: "#0F0E13", surface: "#1B1924", line: "#312C40", text: "#F4F2FA", muted: "rgba(244,242,250,0.6)",
    faint: "rgba(244,242,250,0.09)", accent: "#8B6CFF", onAccent: "#FFFFFF", accentInk: "#A48BFF", marker: false, good: "#43D18B", bad: "#FF5C63", grid: "rgba(244,242,250,0.05)",
  },
  /**
   * Warm cream with white cards in soft shadows, orange accent — the clean look of creator videos about apps and tools:
   * no grid, light falls from above, the author's window has rounded corners.
   */
  cream: {
    mode: "light", bg: "#F3EEE6", surface: "#FFFFFF", line: "#E4DCCF", text: "#17181B", muted: "rgba(23,24,27,0.56)",
    faint: "rgba(23,24,27,0.06)", accent: "#F2661B", onAccent: "#FFFFFF", accentInk: "#D9540C", marker: false, good: "#1FA36A", bad: "#E5484D", grid: "transparent", soft: true,
  },
  /** Near black with a soft spotlight and the same orange accent — the dark twin of cream for night, risk and big numbers. */
  night: {
    mode: "dark", bg: "#0D0E12", surface: "#17191F", line: "#2A2D35", text: "#F5F3EF", muted: "rgba(245,243,239,0.6)",
    faint: "rgba(245,243,239,0.08)", accent: "#FF7A1A", onAccent: "#140A02", accentInk: "#FF8A33", marker: false, good: "#3DD68C", bad: "#FF5A5F", grid: "transparent", soft: true,
  },
} satisfies Record<string, Palette>;

export type PaletteName = keyof typeof PALETTES;

/** Type roles: every block uses these instead of naming fonts. */
export const fonts = {
  /** Condensed heavy titles and big numbers. */
  display: "Oswald",
  /** The italic serif accent line under a title, quotes, one emphasized word. */
  serif: "Playfair Display",
  /** Numbers, addresses, keys, labels, code. */
  mono: "JetBrains Mono",
  /** Interface text: app screens, chats, cards. */
  ui: "Inter",
} as const;

export type Design = { palette: Palette; name: PaletteName; backdrop?: string };

export const DEFAULT_PALETTE: PaletteName = "graphite";

export function designOf(name?: string, accent?: string): Design {
  const key = (name && name in PALETTES ? name : DEFAULT_PALETTE) as PaletteName;
  const base: Palette = PALETTES[key];
  if (!accent || !/^#[0-9a-f]{6}$/i.test(accent)) return { name: key, palette: base };
  // An accent of its own (the color of the author's frame, a brand): text on it and text in it stay readable.
  const [h, s, l] = toHsl(accent);
  const onAccent = luminance(accent) > 0.45 ? "#121314" : "#FFFFFF";
  const accentInk = base.marker ? base.accentInk
    : base.mode === "dark" ? (l < 0.55 ? fromHsl(h, s, 0.6) : accent)
    : (l > 0.42 ? fromHsl(h, Math.min(1, s + 0.1), 0.36) : accent);
  return { name: key, palette: { ...base, accent, onAccent, accentInk } };
}

function toHsl(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min, l = (max + min) / 2;
  if (d === 0) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = (max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4) * 60;
  return [(h + 360) % 360, s, l];
}

function fromHsl(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return "#" + [r, g, b].map(v => Math.round((v + m) * 255).toString(16).padStart(2, "0")).join("").toUpperCase();
}

function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const lin = (v: number) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
}

export const DesignContext = createContext<Design>(designOf());
export const useDesign = () => useContext(DesignContext).palette;
/** The prompt of the scene behind the boards of this video, if it has one. */
export const useBackdrop = () => useContext(DesignContext).backdrop;

// The palette of the video being rendered, for the older blocks that read colors through `theme` outside React context.
let active: Palette = designOf().palette;
export const setActivePalette = (palette: Palette) => { active = palette; };
export const activePalette = () => active;

/** Style of accent text: its color, or dark text over a highlighter stroke of the accent on light palettes. */
export function accentText(p: Palette): { color: string; backgroundImage?: string; paddingInline?: number } {
  return p.marker
    ? { color: p.accentInk, backgroundImage: `linear-gradient(transparent 56%, ${p.accent} 56%, ${p.accent} 94%, transparent 94%)`, paddingInline: 6 }
    : { color: p.accentInk };
}

/** A hex color with alpha: `alpha("#E5493A", 0.3)`. */
export function alpha(hex: string, a: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
