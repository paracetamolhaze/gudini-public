// Copy of lib/studio3d/types.ts: the container image holds only studio3d/ and cannot import site code.
// It must stay in sync with that file; change both together.

/**
 * The «3Д» section: faceless 3D sketches — the owner's voxel double and Claude talk about crypto.
 * Claude writes the dialogue and directs, ElevenLabs voices it, the gudini-3d container renders.
 * The site only stores projects and hands jobs to that container; it never runs them itself.
 * Keep in sync with studio3d/runner/protocol.ts (the container cannot import site code).
 */

/** Cast ids; the look and voice of each live in studio3d/cast.json inside the container. */
export const CAST_IDS = ["me", "claude"] as const;
export type CastId = (typeof CAST_IDS)[number];

export type ScriptLine = {
  who: CastId;
  /** What is said. Voice tags like [sighs] or [laughs] are allowed: the voice performs them, subtitles drop them. */
  text: string;
};

export type Script3D = {
  title: string;
  lines: ScriptLine[];
};

/**
 * script: Claude writes the dialogue; voice: the lines are voiced one by one as cues; montage: the video;
 * dub: the same video (same scene, same cuts) re-rendered with the owner's recordings in place of his synthesized lines.
 */
export type JobTask = "script" | "voice" | "montage" | "dub";
export type JobState = "queued" | "running" | "done" | "error";

export type Job3D = {
  id: string;
  task: JobTask;
  state: JobState;
  /** Human-readable step in Russian, shown under the progress bar. */
  step: string;
  /** 0..100 */
  progress: number;
  createdAt: string;
  startedAt?: string;
  /** Last sign of life from the container; a running job silent for STALE_MS is shown as lost. */
  heartbeatAt?: string;
  finishedAt?: string;
  error?: string;
};

export type Video3D = {
  file: string;
  at: string;
  duration: number;
  /** The script version the video was made from: the page warns when the script changed after it. */
  scriptVersion: number;
  /** Made with the owner's own recordings for his lines, and which set of them (Dub3D.version). */
  ownVoice?: boolean;
  dubVersion?: number;
  /** Where every voiced line sits in this video: the dubbing page plays and records exactly these windows. */
  lines?: VideoLine[];
  /** How the windows were found: missing/1 = from the letter timings (miss performed sighs and word tails), 2 = from the sound. */
  linesVersion?: number;
};

/** A line's place on the video timeline, seconds. index is the script line. */
export type VideoLine = { index: number; who: CastId; start: number; end: number };

/**
 * Line windows measured from the sound of each line (performed [gasps] included, the whole tail of the last word):
 * a window of this version replaces older windows of the same video.
 */
export const LINES_VERSION = 2;

/** Dubbing over the video: the page plays this much before the owner's line (no cue: only his own line matters) and after it. */
export const DUB_PRE_ROLL = 0.5;
export const DUB_POST_ROLL = 0.4;

/**
 * Over windows of LINES_VERSION the dub keeps the owner's take from DUB_KEEP_BEFORE before to DUB_KEEP_AFTER after
 * his line's window, and over all of his speech there with DUB_SPEECH_AIR around it, never over another line's
 * window. «Моя озвучка» plays his take over the same range, so what he hears is what the video gets.
 */
export const DUB_KEEP_BEFORE = 0.15;
export const DUB_KEEP_AFTER = 0.3;
export const DUB_SPEECH_AIR = 0.08;

/**
 * One recorded take of an owner line («озвучить самому»), stored as FLAC under dub/.
 * A take belongs to the words of the line (key = lineKey(text)), not to its index or script version:
 * moving lines or editing Claude's lines keeps it, changing the owner's words makes it stale.
 */
export type DubTake = {
  key: string;
  /** Grows on every re-record of the same line. */
  take: number;
  text: string;
  /** Relative to the project folder: "dub/<key>.<take>.flac". */
  file: string;
  bytes: number;
  sha256: string;
  duration: number;
  peakDb: number;
  at: string;
  scriptVersion: number;
  /**
   * Dubbed over the video: the video time at the take's first sample (already corrected by latencyMs), and the
   * line's window it was recorded for. The dub job uses only the window (plus small margins) at exactly this place.
   */
  videoStart?: number;
  latencyMs?: number;
  lineStart?: number;
  lineEnd?: number;
  /** Video3D.at of the video it was recorded over: a new montage moves lines, so older takes are flagged. */
  videoAt?: string;
};

export type Dub3D = {
  /** +1 on every upload or delete, so a video knows which set of takes it was made from. */
  version: number;
  takes: Record<string, DubTake>;
};

/** A synthesized line from a "voice" job: Claude's cue before the owner records, and the owner's synthesized version to compare. */
export type LineClip = {
  key: string;
  who: CastId;
  text: string;
  /** Relative to the project folder: "clips/<key>.mp3". */
  file: string;
  duration: number;
  at: string;
};

/** Caption for the networks, generated from the dialogue and editable on the page. */
export type Meta3D = { title: string; description: string; hashtags: string[] };

/** The cover in the 3D style: a frame of the video redrawn by the image model, with a big headline. */
export type Cover3D = {
  /** Relative to the project folder: "cover.jpg". */
  file: string;
  at: string;
  status: "ok" | "failed" | "headline_failed";
  reason?: string;
  headline?: string;
  /** Video3D.at it was made from: a new montage keeps the cover until the owner asks for another. */
  videoAt?: string;
};

export type Project3D = {
  id: string;
  createdAt: string;
  updatedAt: string;
  /** The owner's idea in their own words. */
  topic: string;
  /** Optional wishes for this video (tone, facts to mention, ending). */
  notes?: string;
  /** Made by «Создать видео»: the script job finds the idea first (topic is empty until then), the montage follows. */
  auto?: boolean;
  script: Script3D | null;
  /** Grows on every script change (generated or edited). */
  scriptVersion: number;
  job: Job3D | null;
  video: Video3D | null;
  /** The montage uses the owner's recordings for his lines (all of them must be recorded). */
  ownVoice?: boolean;
  dub?: Dub3D;
  /** Synthesized lines by key, from the last "voice" job. */
  clips?: Record<string, LineClip>;
  meta?: Meta3D | null;
  cover?: Cover3D | null;
  /**
   * The hidden main-site project that carries this video's publications: publishing, drafts, schedules,
   * trial Reels and the publications page all work through the main code unchanged.
   */
  mirrorId?: string | null;
};

export const STALE_MS = 10 * 60 * 1000;
export const MAX_LINE_CHARS = 220;
export const MAX_LINES = 24;
/** ElevenLabs dialogue takes up to ~2000 characters per request; one video stays well under it. */
export const MAX_SCRIPT_CHARS = 1800;

// ---- container protocol (Basic auth with the site password, like the worker)

/** One recorded owner line the montage must use instead of synthesis. */
export type DubPlanLine = {
  index: number;
  key: string;
  take: number;
  bytes: number;
  sha256: string;
  text: string;
  /** From the take (dubbing over the video): where its first sample sits on the video and the line's window. */
  videoStart?: number;
  lineStart?: number;
  lineEnd?: number;
};

/**
 * What the runner needs about voices, resolved by the site at claim time so the runner never computes keys:
 * keys[i] is the line key of script line i (for uploading clips), lines are the takes to use when ownVoice.
 */
export type VoicePlan = { keys: string[]; ownVoice: boolean; dubVersion: number; lines: DubPlanLine[] };

/** POST /api/3d/runner/claim → the oldest queued job, now marked running, or { job: null }. voice comes with voice, montage and dub jobs. */
export type ClaimResponse = { project: Project3D; job: Job3D; voice?: VoicePlan } | { job: null };
/** POST /api/3d/runner/progress — also the heartbeat; 409 when the job is no longer this one. */
export type ProgressBody = { id: string; jobId: string; step: string; progress: number };
/** POST /api/3d/runner/script — the written dialogue for a "script" job. */
export type ScriptBody = { id: string; jobId: string; script: Script3D };
/** POST /api/3d/runner/ideas { id, jobId } — what a «Создать видео» script job picks from: unmade trend sketches, recent topics. */
export type IdeaCard = { key: string; title: string; plot: string; opening: string; story?: string; handle: string; views: number; multiple: number };
export type IdeaPool = { cards: IdeaCard[]; recent: string[] };
/** POST /api/3d/runner/idea — the chosen card (null: an idea of its own) and topic; the site answers with what it stored. */
export type IdeaBody = { id: string; jobId: string; key: string | null; topic: string };
export type IdeaStored = { topic: string; notes: string | null };
/** PUT /api/3d/runner/video/<id>?jobId=… — chunked like the worker result: x-offset, x-file-size; 409 returns { received }. */
/** GET /api/3d/runner/dub/<id>/<key>?jobId=…&take=… — a recorded take (audio/flac, header x-sha256); 409 unless this montage is running. */
/** PUT /api/3d/runner/clip/<id>/<key>?jobId=…&duration=… — one synthesized line (audio/mpeg, whole file) during a "voice" job. */
/** POST /api/3d/runner/complete — finishes the job: error, or the uploaded video's duration. */
export type CompleteBody = {
  id: string;
  jobId: string;
  error?: string;
  video?: { duration: number; scriptVersion: number; ownVoice?: boolean; dubVersion?: number; lines?: VideoLine[]; linesVersion?: number };
  /**
   * A voice job that found this video's montage in its work folder sends its line windows: for videos made before
   * windows were stored, or when it measures them better (a higher version replaces the stored ones).
   */
  videoLines?: { videoDuration: number; lines: VideoLine[]; version?: number };
};

export const MAX_DUB_BYTES = 10 * 1024 * 1024;
export const MAX_DUB_SECONDS = 60;
export const MIN_DUB_SECONDS = 0.3;
export const MAX_CLIP_BYTES = 5 * 1024 * 1024;
