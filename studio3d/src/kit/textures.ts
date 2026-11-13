import * as THREE from "three";
import { hash } from "./util";
import type { HumanLook } from "../input";
import type { Mood } from "./timeline";

const cache = new Map<string, THREE.Texture>();

const make = (key: string, w: number, h: number, pixel: boolean, draw: (ctx: CanvasRenderingContext2D) => void) => {
  const hit = cache.get(key);
  if (hit) return hit;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  draw(ctx);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  if (pixel) {
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
  } else {
    tex.anisotropy = 4;
  }
  cache.set(key, tex);
  return tex;
};

const rgb = (hex: string): [number, number, number] => {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h.slice(0, 6);
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

/** Lighter (k > 1) or darker (k < 1) version of an sRGB colour, in canvas space. */
export const shade = (hex: string, k: number) => {
  const [r, g, b] = rgb(hex).map((v) => Math.max(0, Math.min(255, Math.round(k > 1 ? v + (255 - v) * (k - 1) * 0.6 + v * (k - 1) * 0.4 : v * k))));
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
};

const noiseCache = new Map<string, ImageData>();

/** Fine noise like baked clay, so flat colours read as material and not as plastic. */
const noise = (ctx: CanvasRenderingContext2D, w: number, h: number, color: string, seed: number, amount = 0.07) => {
  const key = `${color}|${w}|${h}|${seed}|${amount}`;
  let data = noiseCache.get(key);
  if (!data) {
    data = ctx.createImageData(w, h);
    const levels = Array.from({ length: 9 }, (_, i) => rgb(shade(color, 1 + ((i - 4) / 4) * amount)));
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const n = hash(x, y, seed) - (((y >> 2) + (x >> 3)) % 7 === 0 ? 0.3 : 0);
        const c = levels[Math.max(0, Math.min(8, Math.round(n * 8)))];
        const o = (y * w + x) * 4;
        data.data[o] = c[0];
        data.data[o + 1] = c[1];
        data.data[o + 2] = c[2];
        data.data[o + 3] = 255;
      }
    }
    noiseCache.set(key, data);
  }
  ctx.putImageData(data, 0, 0);
};

// ---------------------------------------------------------------- Claude, the orange block

export type BlockyFace = { mood: Mood; open: number; blink: boolean; blush: boolean; sweat: boolean };

const U = 4; // canvas pixels per face pixel
const FACE_W = 36;
const FACE_H = 22;

const px = (ctx: CanvasRenderingContext2D, x: number, y: number, w = 1, h = 1) => ctx.fillRect(x * U, y * U, w * U, h * U);

const blockyEyes = (ctx: CanvasRenderingContext2D, mood: Mood, blink: boolean) => {
  ctx.fillStyle = "#14100e";
  // eye centres; every shape is drawn for the left eye and mirrored for the right one
  const both = (draw: (cx: number, mirror: number) => void) => {
    draw(10, 1);
    draw(26, -1);
  };
  if (blink && mood !== "happy" && mood !== "laugh" && mood !== "dizzy" && mood !== "love") {
    both((cx) => px(ctx, cx - 2, 9, 4, 1));
    return;
  }
  switch (mood) {
    case "happy":
    case "laugh":
      both((cx) => {
        px(ctx, cx - 2, 10);
        px(ctx, cx - 1, 9);
        px(ctx, cx, 8, 1, 1);
        px(ctx, cx + 1, 9);
        px(ctx, cx + 2, 10);
      });
      return;
    case "sleepy":
      both((cx) => px(ctx, cx - 2, 10, 4, 1));
      return;
    case "shocked":
      both((cx) => px(ctx, cx - 2, 6, 4, 5));
      return;
    case "worried":
      // squeezed eyes like ">.<" softened: short thick dashes
      both((cx) => px(ctx, cx - 2, 9, 4, 2));
      return;
    case "angry":
      // brows slide down toward the middle and sit right on the eyes
      both((cx, m) => {
        px(ctx, cx - 2, 9, 4, 2);
        px(ctx, m > 0 ? cx - 2 : cx, 7, 2, 1);
        px(ctx, m > 0 ? cx : cx - 2, 8, 2, 1);
      });
      return;
    case "sad":
      both((cx, m) => {
        px(ctx, cx - 2, 8, 4, 3);
        px(ctx, m > 0 ? cx - 2 : cx + 1, 8, 1, 1);
        ctx.fillStyle = "#14100e";
      });
      return;
    case "dizzy":
      both((cx) => {
        for (let i = -2; i <= 2; i++) {
          px(ctx, cx + i, 9 + i);
          px(ctx, cx + i, 9 - i);
        }
      });
      return;
    case "love":
      ctx.fillStyle = "#e8435a";
      both((cx) => {
        px(ctx, cx - 2, 7, 2, 2);
        px(ctx, cx + 1, 7, 2, 2);
        px(ctx, cx - 2, 8, 5, 2);
        px(ctx, cx - 1, 10, 3, 1);
        px(ctx, cx, 11);
      });
      return;
    case "smug":
      both((cx) => px(ctx, cx - 2, 9, 4, 2));
      return;
    case "wink":
      px(ctx, 8, 7, 4, 4);
      px(ctx, 24, 9, 4, 1);
      px(ctx, 23, 8);
      return;
    case "thinking":
      both((cx) => px(ctx, cx - 1, 6, 4, 4));
      return;
    default:
      both((cx) => px(ctx, cx - 2, 7, 4, 4));
  }
};

const blockyMouth = (ctx: CanvasRenderingContext2D, mood: Mood, open: number) => {
  ctx.fillStyle = "#14100e";
  if (open > 0) {
    const w = open === 1 ? 2 : open === 2 ? 3 : 4;
    const h = open === 1 ? 2 : open === 2 ? 3 : 4;
    px(ctx, 18 - Math.ceil(w / 2), 14, w, h);
    return;
  }
  switch (mood) {
    case "happy":
    case "love":
    case "smug":
      px(ctx, 15, 14);
      px(ctx, 16, 15, 4, 1);
      px(ctx, 20, 14);
      return;
    case "laugh":
      px(ctx, 15, 14, 6, 1);
      px(ctx, 16, 15, 4, 1);
      px(ctx, 17, 16, 2, 1);
      return;
    case "sad":
      px(ctx, 15, 15);
      px(ctx, 16, 14, 4, 1);
      px(ctx, 20, 15);
      return;
    case "worried":
      px(ctx, 15, 15);
      px(ctx, 16, 14);
      px(ctx, 17, 15);
      px(ctx, 18, 14);
      px(ctx, 19, 15);
      return;
    case "shocked":
      px(ctx, 17, 14, 2, 3);
      return;
    case "angry":
    case "thinking":
    case "sleepy":
      px(ctx, 16, 15, 4, 1);
      return;
    case "dizzy":
      px(ctx, 16, 15, 1, 1);
      px(ctx, 17, 14, 2, 1);
      px(ctx, 19, 15, 1, 1);
      return;
    default:
      px(ctx, 17, 14, 2, 2);
  }
};

export const blockyFront = (color: string, face: BlockyFace) =>
  make(`blocky-front|${color}|${face.mood}|${face.open}|${face.blink}|${face.blush}|${face.sweat}`, FACE_W * U, FACE_H * U, true, (ctx) => {
    noise(ctx, FACE_W * U, FACE_H * U, color, 11);
    if (face.blush || face.mood === "love" || face.mood === "happy" || face.mood === "laugh") {
      ctx.fillStyle = "rgba(255, 110, 130, 0.55)";
      px(ctx, 5, 12, 4, 2);
      px(ctx, 27, 12, 4, 2);
    }
    blockyEyes(ctx, face.mood, face.blink);
    blockyMouth(ctx, face.mood, face.open);
    if (face.sweat || face.mood === "worried") {
      ctx.fillStyle = "#9fd4ff";
      px(ctx, 32, 2, 1, 1);
      px(ctx, 31, 3, 3, 3);
      ctx.fillStyle = "#e9f6ff";
      px(ctx, 31, 3, 1, 1);
    }
  });

export const blockySide = (color: string, seed: number) =>
  make(`blocky-side|${color}|${seed}`, 96, 64, true, (ctx) => noise(ctx, 96, 64, color, seed));

// ---------------------------------------------------------------- the human (the channel owner)

export type HumanFace = { mood: Mood; open: number; blink: boolean; look: number; blush?: boolean; sweat?: boolean };

const HU = 4;
const hpx = (ctx: CanvasRenderingContext2D, x: number, y: number, w = 1, h = 1) => ctx.fillRect(x * HU, y * HU, w * HU, h * HU);

const lookKey = (look: HumanLook) => JSON.stringify(look);
/** Canvas pixels per face pixel of the 24×24 human face. */
const FU = 4;

export const humanFront = (look: HumanLook, face: HumanFace) =>
  make(`human-front24|${lookKey(look)}|${face.mood}|${face.open}|${face.blink}|${face.look}|${Boolean(face.blush)}|${Boolean(face.sweat)}`, 24 * FU, 24 * FU, true, (ctx) => {
    // 24×24 face pixels: enough room for the owner's features — thick dark brows, almond eyes, a straight nose,
    // lips with a lighter lower one and a long jaw — while staying pixel art like the reference's voxel guy
    const p = (x: number, y: number, w = 1, h = 1) => ctx.fillRect(x * FU, y * FU, w * FU, h * FU);
    const skin = look.skin;
    const shadeSkin = shade(skin, 0.88);
    const deepSkin = shade(skin, 0.74);
    const brow = look.brows ?? shade(look.hair, 0.6);
    noise(ctx, 24 * FU, 24 * FU, skin, 3, 0.035);

    // jaw and cheek contour: the face reads long and narrow, not as a flat square
    // light shading only: the owner is clean-shaven, dark corners would read as a beard
    ctx.fillStyle = shadeSkin;
    p(1, 14, 1, 9);
    p(22, 14, 1, 9);
    p(2, 22, 3, 2);
    p(19, 22, 3, 2);
    p(7, 23, 10, 1);

    // hair: the top, the temples and the fringe of the chosen style
    if (look.hairStyle !== "bald") {
      noise(ctx, 24 * FU, 5 * FU, look.hair, 8, 0.12);
      ctx.fillStyle = look.hairSides ?? look.hair;
      p(0, 4, 2, 9);
      p(22, 4, 2, 9);
      ctx.fillStyle = look.hair;
      if (look.hairStyle === "swept") {
        // the bleached fringe combed to one side, ragged at the edge
        p(11, 5, 12, 1);
        p(14, 6, 8, 1);
        p(18, 7, 3, 1);
        p(2, 5, 4, 1);
      } else if (look.hairStyle === "fringe") {
        p(2, 5, 18, 2);
      } else if (look.hairStyle === "long") {
        p(0, 5, 2, 14);
        p(22, 5, 2, 14);
      }
    }

    // brows: dark and thick, heavier at the inner ends
    ctx.fillStyle = brow;
    // straight and thick, heavier toward the nose and thinning outward, one skin row above the eyelid;
    // moods tilt the inner and outer ends
    const browsAt = (dy: number, inner: number, outer: number) => {
      p(4, 8 + outer + dy, 2, 1);
      p(6, 8 + dy, 2, 1);
      p(8, 8 + inner + dy, 2, 1);
      p(6, 9 + dy, 2, 1);
      p(8, 9 + inner + dy, 2, 1);
      p(14, 8 + inner + dy, 2, 1);
      p(16, 8 + dy, 2, 1);
      p(18, 8 + outer + dy, 2, 1);
      p(14, 9 + inner + dy, 2, 1);
      p(16, 9 + dy, 2, 1);
    };
    if (face.mood === "worried" || face.mood === "sad") browsAt(0, -1, 1);
    else if (face.mood === "angry") browsAt(0, 1, -1);
    else if (face.mood === "shocked") browsAt(-1, 0, 0);
    else browsAt(0, 0, 0);

    // eyes
    const eyeY = 12;
    const lx = 5;
    const rx = 14;
    const shift = face.look;
    const closedEye = (x: number) => {
      ctx.fillStyle = "#3a2a24";
      p(x, eyeY + 1, 5, 1);
    };
    if (face.mood === "love" && !face.blink) {
      ctx.fillStyle = "#e8435a";
      for (const x of [lx, rx]) {
        p(x, eyeY, 2, 1);
        p(x + 3, eyeY, 2, 1);
        p(x, eyeY + 1, 5, 1);
        p(x + 1, eyeY + 2, 3, 1);
        p(x + 2, eyeY + 3, 1, 1);
      }
    } else if (face.mood === "dizzy") {
      ctx.fillStyle = "#1a1a1a";
      for (const x of [lx, rx]) {
        p(x, eyeY);
        p(x + 4, eyeY);
        p(x + 1, eyeY + 1, 3, 1);
        p(x, eyeY + 2);
        p(x + 4, eyeY + 2);
      }
    } else if (face.blink || face.mood === "laugh" || face.mood === "sleepy") {
      closedEye(lx);
      closedEye(rx);
    } else {
      const tall = face.mood === "shocked" ? 3 : 2;
      const top = face.mood === "shocked" ? eyeY - 1 : eyeY;
      for (const x of [lx, rx]) {
        // the upper lid is a darker line: almond eyes, not dots
        ctx.fillStyle = "#3a2a24";
        p(x, top - 1, 5, 1);
        ctx.fillStyle = "#f3efe8";
        p(x, top, 5, tall);
        const up = face.mood === "thinking" ? -1 : 0;
        const ix = x + 1 + shift + (up ? 1 : 0);
        ctx.fillStyle = look.eyes;
        p(ix, top + up, 3, tall);
        ctx.fillStyle = "#120d0b";
        p(ix + 1, top + up, 1, tall);
        ctx.fillStyle = "rgba(255,255,255,0.85)";
        p(ix + 2, top + up, 1, 1);
      }
      if (face.mood === "wink") {
        ctx.fillStyle = skin;
        p(rx, top - 1, 5, tall + 1);
        closedEye(rx);
      }
    }

    // nose: a straight bridge, a lit tip, nostrils
    ctx.fillStyle = shadeSkin;
    p(12, 12, 1, 5);
    ctx.fillStyle = deepSkin;
    p(10, 17, 1, 1);
    p(13, 17, 1, 1);
    p(11, 18, 2, 1);

    // beard and stubble
    if (look.beard === "stubble") {
      ctx.fillStyle = shade(skin, 0.85);
      for (let y = 18; y < 24; y++) for (let x = 3; x < 21; x++) if (hash(x, y, 9) > 0.45 && !(y >= 19 && y <= 21 && x >= 8 && x <= 15)) p(x, y);
    } else if (look.beard === "short" || look.beard === "full") {
      ctx.fillStyle = look.beardColor ?? shade(look.hair, 0.95);
      const top = look.beard === "full" ? 16 : 19;
      p(2, top, 20, 24 - top);
      p(8, 19, 8, 1);
    }

    // mouth: lips with a darker upper line and a lighter lower lip
    const my = 20;
    const lipLine = "#7a3d35";
    const lip = shade(look.lips ?? "#c07d6e", 1);
    if (face.open > 0) {
      ctx.fillStyle = "#3b1612";
      p(9, my, 6, face.open + 1);
      if (face.open >= 2) {
        ctx.fillStyle = "#f2efe8";
        p(9, my, 6, 1);
      }
      ctx.fillStyle = lip;
      p(10, my + face.open + 1, 4, 1);
    } else {
      ctx.fillStyle = lipLine;
      switch (face.mood) {
        case "happy":
        case "love":
        case "laugh":
          p(8, my - 1);
          p(9, my, 6, 1);
          p(15, my - 1);
          break;
        case "smug":
          p(9, my, 5, 1);
          p(14, my - 1, 2, 1);
          break;
        case "sad":
        case "worried":
          p(8, my + 1);
          p(9, my, 6, 1);
          p(15, my + 1);
          break;
        case "shocked":
          ctx.fillStyle = "#3b1612";
          p(10, my, 4, 2);
          break;
        default:
          p(9, my, 6, 1);
      }
      if (face.mood !== "shocked") {
        ctx.fillStyle = lip;
        p(10, my + 1, 4, 1);
      }
    }

    if (face.blush || face.mood === "love") {
      ctx.fillStyle = "rgba(240, 110, 120, 0.5)";
      p(3, 15, 3, 2);
      p(18, 15, 3, 2);
    }
    if (face.sweat) {
      ctx.fillStyle = "#9fd4ff";
      p(20, 6, 1, 1);
      p(19, 7, 3, 2);
      ctx.fillStyle = "#e9f6ff";
      p(19, 7, 1, 1);
    }
    if (look.glasses !== "none") {
      ctx.fillStyle = look.glasses === "shades" ? "#0d0d10" : "#1b1b1f";
      if (look.glasses === "shades") {
        p(4, 10, 7, 4);
        p(13, 10, 7, 4);
        p(11, 11, 2, 1);
      } else {
        for (const x0 of [4, 13]) {
          p(x0, 10, 7, 1);
          p(x0, 14, 7, 1);
          p(x0, 10, 1, 5);
          p(x0 + 6, 10, 1, 5);
        }
        p(11, 11, 2, 1);
        p(0, 11, 4, 1);
        p(20, 11, 4, 1);
      }
    }
  });

/** Sides, back and top of the head: skin with the hair cap of the chosen style. */
export const humanHeadPart = (look: HumanLook, part: "side" | "back" | "top") =>
  make(`human-${part}|${lookKey(look)}`, 16 * HU, 16 * HU, true, (ctx) => {
    noise(ctx, 16 * HU, 16 * HU, look.skin, part === "side" ? 5 : 6, 0.04);
    if (look.hairStyle === "bald") {
      if (part === "top") noise(ctx, 16 * HU, 16 * HU, shade(look.skin, 1.04), 7, 0.03);
      return;
    }
    const rows = part === "top" ? 16 : part === "back" ? (look.hairStyle === "long" ? 15 : look.hairStyle === "crop" ? 8 : 11) : 5;
    noise(ctx, 16 * HU, rows * HU, part === "back" && look.hairSides ? look.hairSides : look.hair, 8, 0.1);
    if (part === "back" && look.hairSides) {
      ctx.fillStyle = look.hair;
      hpx(ctx, 0, 0, 16, 3);
    }
    if (part === "side") {
      ctx.fillStyle = look.hair;
      hpx(ctx, 0, 0, 16, 3);
      // short darker temples above and behind the ear, under the bleached top
      ctx.fillStyle = look.hairSides ?? look.hair;
      hpx(ctx, 4, 3, 12, 1);
      hpx(ctx, 9, 4, 7, look.hairStyle === "long" ? 10 : 3);
      ctx.fillStyle = shade(look.skin, 0.86); // ear
      hpx(ctx, 6, 7, 2, 3);
      if (look.beard === "short" || look.beard === "full") {
        ctx.fillStyle = look.beardColor ?? shade(look.hair, 0.95);
        hpx(ctx, 0, 9, 5, 7);
      }
    }
  });

/** Cloth with the print on the chest (front of the torso). */
export const clothFront = (look: HumanLook) =>
  make(`cloth-front|${lookKey(look)}`, 128, 160, false, (ctx) => {
    noise(ctx, 128, 160, look.top, 21, 0.03);
    if (look.stripes) {
      ctx.fillStyle = look.stripes;
      for (let x = 5; x < 128; x += 11) ctx.fillRect(x, 0, 2, 160);
    }
    if (look.topKind === "jersey") {
      // baseball jersey: dark V collar, dark placket with buttons, team word across the chest
      ctx.fillStyle = "#16171c";
      ctx.beginPath();
      ctx.moveTo(34, 0);
      ctx.lineTo(64, 30);
      ctx.lineTo(94, 0);
      ctx.lineTo(84, 0);
      ctx.lineTo(64, 20);
      ctx.lineTo(44, 0);
      ctx.fill();
      ctx.fillRect(61, 28, 6, 132);
      ctx.fillStyle = "#e8e8ea";
      for (let y = 44; y < 160; y += 26) ctx.fillRect(62, y, 4, 4);
    }
    if (look.topKind === "shirt" || look.topKind === "jacket") {
      ctx.fillStyle = shade(look.top, 0.75);
      ctx.fillRect(61, 0, 6, 160);
      ctx.fillStyle = look.topKind === "jacket" ? "#f1efe9" : shade(look.top, 1.15);
      ctx.beginPath();
      ctx.moveTo(40, 0);
      ctx.lineTo(64, 34);
      ctx.lineTo(88, 0);
      ctx.fill();
    } else {
      ctx.fillStyle = shade(look.top, 0.85);
      ctx.fillRect(44, 0, 40, 8);
    }
    if (look.chain) {
      ctx.strokeStyle = "#e3b341";
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(34, 2);
      ctx.quadraticCurveTo(64, 56, 94, 2);
      ctx.stroke();
    }
    if (look.topPrint) {
      const [r, g, bl] = rgb(look.top);
      ctx.fillStyle = look.topKind === "jersey" ? "#1b2340" : r * 0.3 + g * 0.59 + bl * 0.11 > 140 ? shade(look.top, 0.35) : shade(look.top, 1.9);
      ctx.font = look.topKind === "jersey" ? "italic 800 30px Inter" : "800 22px Inter";
      ctx.textAlign = "center";
      ctx.fillText(look.topPrint.slice(0, 12), 64, look.topKind === "jersey" ? 104 : 92, 120);
    }
    if (look.topKind === "hoodie") {
      ctx.fillStyle = shade(look.top, 0.82);
      ctx.fillRect(30, 104, 68, 36);
      ctx.fillStyle = "#e8e6e0";
      ctx.fillRect(54, 6, 3, 36);
      ctx.fillRect(71, 6, 3, 36);
    }
  });

/** Plain cloth of sleeves, sides and back: the top colour with its stripes. */
export const clothPlain = (look: HumanLook) =>
  make(`cloth-plain|${look.top}|${look.stripes ?? ""}`, 64, 64, false, (ctx) => {
    noise(ctx, 64, 64, look.top, 22, 0.03);
    if (look.stripes) {
      ctx.fillStyle = look.stripes;
      for (let x = 3; x < 64; x += 11) ctx.fillRect(x, 0, 2, 64);
    }
  });

export const capFront = (color: string, text?: string, textColor?: string) =>
  make(`cap|${color}|${text ?? ""}|${textColor ?? ""}`, 128, 48, false, (ctx) => {
    noise(ctx, 128, 48, color, 31, 0.04);
    if (text) {
      ctx.fillStyle = textColor ?? "#ffffff";
      ctx.font = "italic 800 26px Inter";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(text.slice(0, 10), 64, 26);
    }
  });

// ---------------------------------------------------------------- the set

export const glowSprite = () =>
  make("glow", 128, 128, false, (ctx) => {
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.25, "rgba(255,255,255,0.45)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
  });

export const blobShadow = () =>
  make("blob", 128, 128, false, (ctx) => {
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, "rgba(0,0,0,0.75)");
    g.addColorStop(0.55, "rgba(0,0,0,0.35)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
  });

export const skyGradient = (top: string, mid: string, horizon: string) =>
  make(`sky|${top}|${mid}|${horizon}`, 8, 512, false, (ctx) => {
    // A sphere maps the canvas top to the zenith and the middle row to the horizon.
    const g = ctx.createLinearGradient(0, 0, 0, 512);
    g.addColorStop(0, top);
    g.addColorStop(0.36, mid);
    g.addColorStop(0.485, horizon);
    g.addColorStop(0.53, mid);
    g.addColorStop(1, top);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 8, 512);
  });

export const keyCap = (label: string, base: string, ink: string) =>
  make(`key|${label}|${base}|${ink}`, 128, 128, false, (ctx) => {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, 128, 128);
    const g = ctx.createLinearGradient(0, 0, 0, 128);
    g.addColorStop(0, "rgba(255,255,255,0.07)");
    g.addColorStop(1, "rgba(0,0,0,0.18)");
    ctx.fillStyle = g;
    ctx.fillRect(6, 6, 116, 116);
    if (label) {
      ctx.fillStyle = ink;
      ctx.font = "800 40px Inter";
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.fillText(label, 18, 16);
    }
  });

/** Text on a phone or laptop screen: a dark app screen with the label as big lines. */
export const screenTexture = (label: string, shape: "tall" | "wide") =>
  make(`screen|${label}|${shape}`, shape === "tall" ? 160 : 384, shape === "tall" ? 300 : 256, false, (ctx) => {
    const w = shape === "tall" ? 160 : 384;
    const h = shape === "tall" ? 300 : 256;
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, "#151a3a");
    g.addColorStop(1, "#0a0d1f");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    const lines = label.split(" / ").filter(Boolean).slice(0, 4);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    lines.forEach((line, i) => {
      const accent = /^[+▲]|\+\d|x\d/i.test(line) ? "#6ee7a8" : /^[−-]|▼|-\d/.test(line) ? "#ff6b6b" : "#ffffff";
      ctx.fillStyle = accent;
      ctx.font = `800 ${i === 0 ? (shape === "tall" ? 34 : 54) : shape === "tall" ? 22 : 30}px Inter`;
      ctx.fillText(line, w / 2, h / 2 + (i - (lines.length - 1) / 2) * (shape === "tall" ? 44 : 60), w - 16);
    });
  });

/** Writing on a sign board, a sheet of paper (lines split by " / ") or a coin emblem. */
export const labelTexture = (text: string, kind: "sign" | "paper" | "coin") =>
  make(`label|${text}|${kind}`, kind === "coin" ? 128 : 256, kind === "coin" ? 128 : kind === "paper" ? 356 : 144, false, (ctx) => {
    if (kind === "coin") {
      ctx.fillStyle = "#e8b53a";
      ctx.fillRect(0, 0, 128, 128);
      ctx.strokeStyle = "#b8862a";
      ctx.lineWidth = 8;
      ctx.beginPath();
      ctx.arc(64, 64, 52, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = "#9a6c18";
      ctx.font = "800 72px Inter";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(text, 66, 68);
      if (text === "B") {
        ctx.fillRect(52, 18, 7, 16);
        ctx.fillRect(66, 18, 7, 16);
        ctx.fillRect(52, 100, 7, 14);
        ctx.fillRect(66, 100, 7, 14);
      }
      return;
    }
    if (kind === "paper") {
      ctx.fillStyle = "#f4f1e8";
      ctx.fillRect(0, 0, 256, 356);
      ctx.fillStyle = "#3a3a44";
      ctx.font = "600 19px 'JetBrains Mono'";
      ctx.textBaseline = "top";
      const words = text.split(" / ").filter(Boolean).slice(0, 12);
      words.forEach((wd, i) => ctx.fillText(`${i + 1}. ${wd}`, 18, 16 + i * 27, 220));
      return;
    }
    ctx.fillStyle = "#f4ead2";
    ctx.fillRect(0, 0, 256, 144);
    ctx.strokeStyle = "#7a5230";
    ctx.lineWidth = 8;
    ctx.strokeRect(4, 4, 248, 136);
    ctx.fillStyle = /scam|скам|стоп|нет|!/i.test(text) ? "#c62828" : "#2a2420";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const size = text.length > 12 ? 30 : text.length > 7 ? 40 : 56;
    ctx.font = `800 ${size}px Inter`;
    ctx.fillText(text, 128, 74, 236);
  });

export type PopIcon = "!" | "?" | "?!" | "heart" | "dollar" | "skull" | "idea" | "sweat" | "anger" | "zzz" | "fire" | "star";

const POP_ART: Record<PopIcon, { color: string; rows: string[] }> = {
  "!": { color: "#ffd23f", rows: ["..##..", "..##..", "..##..", "..##..", "..##..", "......", "..##..", "..##.."] },
  "?": { color: "#ffffff", rows: [".####.", "##..##", "....##", "...##.", "..##..", "......", "..##..", "..##.."] },
  "?!": { color: "#ffd23f", rows: [".###..##", "##.##.##", "...##.##", "..##..##", "..##..##", "........", "..##..##", "..##..##"] },
  heart: { color: "#ff4d6d", rows: [".##.##.", "#######", "#######", "#######", ".#####.", "..###..", "...#..."] },
  dollar: { color: "#4ade80", rows: ["...#...", ".#####.", "##.#...", ".####..", "...#.##", "#####..", "...#..."] },
  skull: { color: "#f1f1f1", rows: [".#####.", "#######", "#..#..#", "#######", ".##.##.", ".#####.", ".#.#.#."] },
  idea: { color: "#ffe066", rows: ["..###..", ".#####.", "#######", "#######", ".#####.", "..###..", "..#.#..", "..###.."] },
  sweat: { color: "#8fd3ff", rows: ["...#...", "..###..", ".#####.", "#######", "#######", ".#####.", "..###.."] },
  anger: { color: "#ff3b3b", rows: ["##...##", "#.....#", "...#...", "..###..", "...#...", "#.....#", "##...##"] },
  zzz: { color: "#c9d4ff", rows: ["#####...", "...#....", "..#.....", ".#..###.", "#####.#.", "....#...", "...####."] },
  fire: { color: "#ff8a1f", rows: ["...#...", "..##...", "..###.#", ".######", "#######", "###.###", ".#####."] },
  star: { color: "#ffd23f", rows: ["...#...", "..###..", "#######", ".#####.", "..###..", ".##.##.", "##...##"] },
};

/**
 * Half the width of an icon's drawing (with its outline) as a share of its square sprite: a narrow «!» is a seventh
 * of it, a heart nearly half. The icon is placed by its drawing, so a narrow one stands as close to the head as a wide.
 */
export const popInk = (icon: PopIcon) => {
  const art = POP_ART[icon];
  const w = Math.max(...art.rows.map((r) => r.length));
  const cell = Math.floor(130 / Math.max(w, art.rows.length));
  const cols = art.rows.flatMap((row) => row.split("").map((c, x) => (c === "#" ? x : -1))).filter((x) => x >= 0);
  const ink = (Math.max(...cols) - Math.min(...cols) + 1) * cell + 12;
  return ink / 2 / 160;
};

/** A pixel icon that pops over an actor's head: the cartoon reaction of the reference style. */
export const popTexture = (icon: PopIcon) =>
  make(`pop|${icon}`, 160, 160, true, (ctx) => {
    const art = POP_ART[icon];
    const w = Math.max(...art.rows.map((r) => r.length));
    const cell = Math.floor(130 / Math.max(w, art.rows.length));
    const ox = Math.round((160 - w * cell) / 2);
    const oy = Math.round((160 - art.rows.length * cell) / 2);
    // dark outline first, then the colour: reads on any background
    for (const [dx, dy, color] of [[-1, 0, "#111"], [1, 0, "#111"], [0, -1, "#111"], [0, 1, "#111"], [0, 0, art.color]] as const) {
      ctx.fillStyle = color;
      art.rows.forEach((row, y) =>
        row.split("").forEach((c, x) => {
          if (c === "#") ctx.fillRect(ox + x * cell + dx * 6, oy + y * cell + dy * 6, cell, cell);
        }),
      );
    }
  });

export type PanelTone = "terminal" | "alert" | "chart" | "wallet";

/**
 * A floating window behind the actors. `blur` bakes the depth of field into the texture,
 * so the software renderer does not pay for a blur pass every frame.
 */
export const panelTexture = (title: string, lines: string[], tone: PanelTone, blur: number) =>
  make(`panel|${title}|${lines.join("\n")}|${tone}|${blur}`, 640, 480, false, (ctx) => {
    ctx.filter = blur > 0 ? `blur(${blur}px)` : "none";
    const r = 22;
    ctx.fillStyle = tone === "alert" ? "rgba(36,8,14,0.92)" : "rgba(7,10,24,0.9)";
    ctx.beginPath();
    ctx.roundRect(8, 8, 624, 464, r);
    ctx.fill();
    ctx.strokeStyle = tone === "alert" ? "rgba(255,90,90,0.45)" : "rgba(120,140,220,0.22)";
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.font = "700 30px 'JetBrains Mono'";
    ctx.textBaseline = "top";
    ctx.fillStyle = "#e9ecff";
    ctx.fillText(title, 40, 36);
    ctx.font = "400 26px 'JetBrains Mono'";
    lines.slice(0, 9).forEach((line, i) => {
      // red first: a falling or failing line stays red even if it also contains a plus
      const accent = /▼|−|-\s?[\d$€₽]|\bfail|\berror\b|ошибка|скам/i.test(line)
        ? "#ff7a7a"
        : /^\s*[▲+]|\+\d|\bpassed\b|\bok\b|готово/i.test(line)
          ? "#6ee7a8"
          : null;
      ctx.fillStyle = accent ?? (i % 2 ? "rgba(200,208,240,0.55)" : "rgba(220,226,250,0.8)");
      ctx.fillText(line, 40, 88 + i * 40);
    });
    if (tone === "chart") {
      // the curve lives under the text rows and follows the story: down and red when the lines say it fell
      const falling = lines.some((l) => /▼|−|-\s?\d/.test(l));
      const floor = Math.min(448, 88 + Math.min(lines.length, 9) * 40 + 70);
      ctx.strokeStyle = falling ? "#ff6b6b" : "#6ee7a8";
      ctx.lineWidth = 5;
      ctx.beginPath();
      for (let i = 0; i <= 20; i++) {
        const x = 40 + i * 28;
        const swing = Math.sin(i * 1.3) * 10;
        const y = falling ? floor - 60 + i * 3 - swing : floor - i * 3 - swing;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.fillStyle = "#ff3b3b";
    ctx.beginPath();
    ctx.arc(600, 440, 9, 0, Math.PI * 2);
    ctx.fill();
  });
