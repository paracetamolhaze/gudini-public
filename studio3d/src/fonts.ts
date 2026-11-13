import { loadFont } from "@remotion/fonts";
import { staticFile } from "remotion";

const CYRILLIC = "U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116";
const LATIN = "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD";

const subsets = (family: string, file: string, weight: string) =>
  [["cyrillic", CYRILLIC], ["latin", LATIN]].map(([subset, unicodeRange]) =>
    loadFont({ family, url: staticFile(`fonts/${file}-${subset}-${weight}-normal.woff2`), weight, unicodeRange, display: "block" }));

/** Obelix Pro for subtitles, Inter for labels, JetBrains Mono for the screens behind the actors. */
export const fontsReady = Promise.all([
  // the owner's caption font (free for personal use; it lives in the image, not in the repository)
  loadFont({ family: "Obelix Pro", url: staticFile("fonts/ObelixProB-cyr.ttf"), weight: "700", display: "block" }),
  ...subsets("Inter", "inter", "600"),
  ...subsets("Inter", "inter", "800"),
  ...subsets("JetBrains Mono", "jetbrains-mono", "400"),
  ...subsets("JetBrains Mono", "jetbrains-mono", "700"),
]);
