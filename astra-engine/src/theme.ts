import { activePalette, fonts } from "./design";

// Design tokens of the Astra style for the blocks that sit over the author shot. The accent colors come from
// the palette of the video (src/design.ts), so no color is fixed for every video; the dark panels and white
// text stay, they are read over any footage.
export const theme = {
  color: {
    /** The palette accent of this video. */
    get accent() { return activePalette().accent; },
    accent2: "#4C9DFF",
    /** Emphasis over the author shot: the same accent. */
    get highlight() { return activePalette().accent; },
    ink: "#0D1115",
    panel: "rgba(13, 17, 21, 0.96)",
    text: "#FFFFFF",
    muted: "rgba(255, 255, 255, 0.72)",
    good: "#35D07F",
    bad: "#FF4D4D",
  },
  font: {
    display: "Oswald",
    text: "Montserrat",
    hand: "Caveat",
    serif: fonts.serif,
    mono: fonts.mono,
    ui: fonts.ui,
  },
  // TikTok interface zones on a 1080x1920 frame: status bar and tabs on top,
  // description and music line at the bottom, action buttons on the right.
  safe: { top: 170, bottom: 420, left: 60, right: 150 },
  radius: 38,
  shadow: "0 18px 48px rgba(0, 0, 0, 0.45)",
};

export type ColorName = keyof typeof theme.color;

/** Accepts a token name or any CSS color. */
export const color = (value: string | undefined, fallback: ColorName = "text"): string =>
  value === undefined ? theme.color[fallback] : value in theme.color ? theme.color[value as ColorName] : value;
