/**
 * What the runner calls. Everything Claude, ElevenLabs and Remotion do for one job happens behind
 * these functions; the runner only moves data between them and the site.
 */
import type { Recording } from "./recorded";

export type ScriptLine = { who: string; text: string };
export type Script3D = { title: string; lines: ScriptLine[] };

export type ProjectSpec = {
  id: string;
  topic: string;
  notes?: string;
  script: Script3D | null;
  scriptVersion: number;
};

export type Hooks = {
  /** Russian step label and overall progress 0..100 for the site. */
  stage: (step: string, progress: number) => void;
  log: (message: string) => void;
  signal: AbortSignal;
};

/** Where a voiced line sits in the video, seconds; index is the script line. */
export type LineWindow = { index: number; who: string; start: number; end: number };
/** lines: every voiced line's window, when the lines could be tied to the script. */
export type MontageResult = { video: string; duration: number; lines?: LineWindow[] };

/** The owner's recorded take of script line `index` (a downloaded file, checked against its sha256). */
export type { Recording };
/** How the montage voices the owner: his recordings replace his synthesized lines when given (all of them). */
export type MontageVoice = { recordings?: Recording[] };
/** One synthesized line from the "voice" job: the per-line cache file, as ElevenLabs returned it. */
export type VoicedClip = { index: number; who: string; file: string; duration: number };

/** The "dub" job's request: the owner's takes recorded over the video, and how to fetch them. */
export type { DubRequest, DubTakePlan, SiteVideo } from "./dub";

export type { IdeaChoice, IdeaPick } from "./idea";
export { findIdea } from "./idea";
export { writeScript } from "./script";
export { makeMontage, voiceLines } from "./montage";
export { findLineWindows, makeDub } from "./dub";
