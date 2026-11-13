import { createContext, useContext } from "react";
import { z } from "zod";

/** One spoken word with its time in the voice track, seconds. */
export const wordSchema = z.object({ text: z.string(), start: z.number(), end: z.number() });

/**
 * One line of the dialogue as it was voiced: who says it, the text without voice tags,
 * its time in the track and the mouth curve — [time, openness 0..1] keys built from the letters.
 */
export const lineSchema = z.object({
  who: z.string(),
  text: z.string(),
  start: z.number(),
  end: z.number(),
  words: z.array(wordSchema),
  mouth: z.array(z.tuple([z.number(), z.number()])),
});

/** Look of the voxel human: the owner of the channel, set once in cast.json, never by the director. */
export const humanLookSchema = z.object({
  skin: z.string(),
  hair: z.string(),
  hairStyle: z.enum(["short", "crop", "fringe", "long", "bald", "curly", "swept"]),
  /** Darker roots and temples under bleached hair. */
  hairSides: z.string().optional(),
  beard: z.enum(["none", "stubble", "short", "full"]),
  beardColor: z.string().optional(),
  eyes: z.string(),
  /** Lower lip colour. */
  lips: z.string().optional(),
  brows: z.string().optional(),
  glasses: z.enum(["none", "round", "square", "shades"]),
  top: z.string(),
  topKind: z.enum(["tee", "hoodie", "shirt", "jacket", "jersey"]),
  /** Pinstripes of a baseball jersey. */
  stripes: z.string().optional(),
  topPrint: z.string().optional(),
  pants: z.string(),
  shoes: z.string(),
  cap: z.object({ color: z.string(), text: z.string().optional(), textColor: z.string().optional() }).optional(),
  chain: z.boolean().optional(),
  height: z.number().optional(),
});

export const castMemberSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("human"), name: z.string(), look: humanLookSchema }),
  z.object({ kind: z.literal("blocky"), name: z.string(), color: z.string() }),
]);

export const sketchInputSchema = z.object({
  fps: z.number(),
  duration: z.number(),
  /** Voice track, path inside public/ (one mixed dialogue). */
  voice: z.string().optional(),
  /** Music bed, path inside public/. */
  lines: z.array(lineSchema),
  cast: z.record(z.string(), castMemberSchema),
  /** Interior resolution of the 3D layer relative to 1080×1920; subtitles stay sharp. */
  dpr: z.number().optional(),
  /** Multisampling of the 3D layer; off renders faster in software and is hidden by a lower dpr. */
  aa: z.boolean().optional(),
  /** Depth of field and glow as a post pass (on a graphics card); off, the screens bake a soft blur instead. */
  post: z.boolean().optional(),
  /** The room's sounds under the voices (Sfx.tsx): key clacks, pops, the money ding, the alarm beep, a whoosh. */
  sfx: z.boolean().optional(),
});

export type Word = z.infer<typeof wordSchema>;
export type Line = z.infer<typeof lineSchema>;
export type HumanLook = z.infer<typeof humanLookSchema>;
export type CastMember = z.infer<typeof castMemberSchema>;
export type SketchInput = z.infer<typeof sketchInputSchema>;

export const InputContext = createContext<SketchInput | null>(null);

export const useInput = (): SketchInput => {
  const input = useContext(InputContext);
  if (!input) throw new Error("Кубики 3Д работают только внутри Sketch");
  return input;
};
