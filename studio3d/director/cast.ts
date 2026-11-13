import fs from "node:fs";
import path from "node:path";
import type { LineSettings } from "./elevenlabs";
import { resolveWhisper, type WhisperRecipe } from "./whisper";

export const ENGINE_ROOT = path.resolve(import.meta.dirname, "..");

/** How a voice is delivered after the take, e.g. the owner's clone as a near-whisper (director/whisper.ts). */
export type Delivery = WhisperRecipe;

export type CastFile = Record<
  string,
  | { kind: "human"; name: string; voice: string; style?: string; delivery?: Delivery; tts?: LineSettings; look: Record<string, unknown> }
  | { kind: "blocky"; name: string; voice: string; style?: string; delivery?: Delivery; tts?: LineSettings; color: string }
>;

/** Ranges ElevenLabs accepts, checked before any paid request: a slip in cast.json stops the run with its name. */
const LIMITS: Partial<Record<keyof LineSettings, [number, number]>> = { speed: [0.7, 1.2], stability: [0, 1], similarity: [0, 1], style: [0, 1], seed: [0, 4294967295], loudness: [-40, -8], tempo: [0.8, 1.3] };

const checkLine = (s: LineSettings, id: string) => {
  if (!s.model) throw new Error(`У персонажа ${id} в "tts" не указана модель (cast.json)`);
  for (const [k, [lo, hi]] of Object.entries(LIMITS) as [keyof LineSettings, [number, number]][]) {
    const v = s[k];
    if (v !== undefined && (typeof v !== "number" || !(v >= lo && v <= hi))) throw new Error(`У персонажа ${id} "tts.${k}" = ${v}: нужно число от ${lo} до ${hi} (cast.json)`);
  }
  if (s.sts && !s.sts.model) throw new Error(`У персонажа ${id} в "tts.sts" не указана модель «речи в речь» (cast.json)`);
};

/** The cast with looks and voices; STUDIO3D_CAST points at another file (the data volume) when set. */
export const loadCast = (): CastFile => {
  const file = process.env.STUDIO3D_CAST || path.join(ENGINE_ROOT, "cast.json");
  const cast = JSON.parse(fs.readFileSync(file, "utf8")) as CastFile;
  for (const [id, member] of Object.entries(cast)) {
    if (!member.voice) throw new Error(`У персонажа ${id} не выбран голос (cast.json)`);
    // a typo in the delivery stops the run here, before a paid take
    if (member.delivery) resolveWhisper(member.delivery, id);
    if (member.tts) checkLine(member.tts, id);
  }
  // line-by-line voicing joins every line itself, so either the whole cast has "tts" or nobody does
  const lined = Object.values(cast).filter((m) => m.tts).length;
  if (lined && lined !== Object.keys(cast).length) throw new Error(`"tts" задан не у всех персонажей (cast.json): построчная озвучка нужна всем или никому`);
  return cast;
};

/** What the cast looks like, for the 3D layer: voices are not its business. */
export const castForScene = (cast: CastFile) =>
  Object.fromEntries(Object.entries(cast).map(([id, m]) => [id, m.kind === "human" ? { kind: m.kind, name: m.name, look: m.look } : { kind: m.kind, name: m.name, color: m.color }]));
