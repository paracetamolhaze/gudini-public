/**
 * The «Новости» section: short videos in the format of TikTok @darvin.ya. The owner's voice (ElevenLabs clone) retells
 * a viral internet story over the hero's own videos; where the hero talks, the original plays with its own sound, in a
 * foreign language a translation in another voice goes over it, muted.
 * The owner presses «Создать» and the runner on the PC (news/runner) finds the story, writes it, voices it and renders
 * it. The site only stores projects and hands jobs to that runner; it never runs them itself.
 * Keep in sync with news/runner/protocol.ts (the runner cannot import site code).
 */

/**
 * create: find a story and make the whole video; rerender: the same video again from its montage plan (after a fix
 * of the montage). The PC always renders without music: the site lays the chosen track under it (lib/news/mix.ts).
 */
export type NewsTask = "create" | "rerender";
export type NewsJobState = "queued" | "running" | "done" | "error";

export type NewsJob = {
  id: string;
  task: NewsTask;
  state: NewsJobState;
  /** Human-readable step in Russian, shown under the progress bar. */
  step: string;
  /** 0..100 */
  progress: number;
  createdAt: string;
  startedAt?: string;
  /** Last sign of life from the runner; a running job silent for STALE_MS is shown as lost. */
  heartbeatAt?: string;
  finishedAt?: string;
  error?: string;
  /** create only: the stock story the owner chose on the list (NewsPick.id); none — the runner takes its best one. */
  pick?: string;
};

/** What the video is about, filled by the runner as soon as the story is found. */
export type NewsStory = {
  /** Short Russian title, like «Кореянка переименовала Vaseline». */
  title: string;
  /** Two or three sentences in Russian. */
  summary: string;
  /** The hero's account, e.g. «@mindaylee_ (TikTok)». */
  hero?: string;
  /** Where the facts and the footage come from. */
  sources: { url: string; note?: string }[];
  /** The whole voiced text: narration and translated lines in order, for the caption and the cover headline. */
  script: string;
  /** «crypto-fun» or «crypto-news» — a crypto video: its caption gets one line about the owner's Telegram. */
  lane?: string;
  /**
   * The YouTube experiment arm of a crypto video (news/runner/pipeline/trial.ts, lib/news/rules.ts TRIALS): «calm» — no
   * Telegram and a calm title, «no-tg» — no Telegram, «soft» — a calm title, «base» — as before.
   */
  trial?: string;
  /** The author's closing phrase about his Telegram channel, when the video ends with one: it is the caption's line too. */
  telegram?: string;
  /**
   * A second launch (owner 10.11: «подготовь все видео с новым началом для других площадок где просмотры не
   * набирались»): the same video with a new opening for the platform where the first one got stuck. of — the first
   * project, platform — where this one goes.
   */
  relaunch?: { of: string; platform: "tiktok" | "youtube" | "instagram" };
};

export type NewsVideo = {
  /** Relative to the project folder: "out.mp4" — the base with the chosen track, the file that gets published. */
  file: string;
  /** When out.mp4 last changed (a new render or another track). */
  at: string;
  duration: number;
  /** MusicTrack.file under this video, null — without music. */
  music: string | null;
  /**
   * The PC's render without music ("base.mp4"): the montage page plays it with the track in the browser, so tracks
   * switch at once; at changes only with a new render. Videos made before it have none until they are rerendered.
   */
  base?: { file: string; at: string } | null;
};

/** Caption for the networks, generated from the script and editable on the page. */
export type NewsMeta = { title: string; description: string; hashtags: string[] };

/** A frame of the video redrawn by the image model, with a big headline (same as 3Д covers). */
export type NewsCover = {
  /** Relative to the project folder: "cover.jpg". */
  file: string;
  at: string;
  status: "ok" | "failed" | "headline_failed";
  reason?: string;
  headline?: string;
  /** «post» or «poster» (lib/news/cover.ts); covers before 29.10 have none. */
  style?: "hero" | "post" | "poster" | "news";
  videoAt?: string;
};

export type NewsProject = {
  id: string;
  createdAt: string;
  updatedAt: string;
  story: NewsStory | null;
  job: NewsJob | null;
  video: NewsVideo | null;
  meta?: NewsMeta | null;
  cover?: NewsCover | null;
  /**
   * The hidden main-site project that carries this video's publications (marker newsId): publishing, drafts,
   * schedules, trial Reels and the publications page all work through the main code unchanged.
   */
  mirrorId?: string | null;
  /**
   * «Доработка» (владелец 11.11): готовый ролик, в котором надо что-то поменять, владелец откладывает в свою вкладку,
   * чтобы он не лежал среди готовых к публикации. Ставится и снимается только руками (PATCH /api/news/<id>).
   */
  rework?: boolean;
};

/**
 * A track from news/music on the PC; the runner reports the list on every claim. sig names the prepared piece of it
 * (the best part, loudness levelled) that the runner uploads once: a file replaced under the same name gets a new sig.
 */
export type MusicTrack = { file: string; title: string; duration: number; sig?: string };

/** Volume of the track under the voice (linear), the same in the browser preview and in the mixed out.mp4. */
export const MUSIC_VOLUME = 0.039;

export const STALE_MS = 10 * 60 * 1000;

/**
 * A story the PC found, rated and keeps in its stock (news/runner/pipeline/stock.ts). The owner picks one on the list
 * page to make a video of it, or rejects it («Не то»); the search learns his taste from both (owner 29.10: «да выбор
 * нужен, это хорошо»).
 */
export type NewsPick = {
  id: string;
  title: string;
  summary: string;
  /** Why it hooks, in the search's words. */
  why: string;
  /** «@handle (TikTok)». */
  hero: string;
  /** What in it every viewer already knows: «MrBeast», «Вазелин». */
  anchor: string | null;
  /** The opening line the editor suggests. */
  hook: string | null;
  /** 1–10 by the editor; null — a sequel of a video already on the channel, it goes by how the first part did. */
  score: number | null;
  verdict: string | null;
  /** Whom the viewer would send the video to and with what words; «некому» — nobody. Absent in stock rated before 10.11. */
  share?: string | null;
  sources: string[];
  /** When it was found. */
  at: string;
  /** A sequel: the title of the story it continues. */
  sequelOf: string | null;
  /**
   * Crypto — two videos of six (owner 3.11: «2 из 6 роликов про криптовалюту, 1 прикольный смешной, другой новостной»):
   * «crypto-fun» or «crypto-news»; null — any other story. Absent in stock sent before 3.11.
   */
  lane?: string | null;
  /** This crypto story is the next one by the 2-of-6 queue: the runner takes it first on «Создать». */
  due?: boolean;
};
/** The stock as the runner reports it with every claim; searching — a search has been going on since startedAt. */
export type StockReport = { stories: NewsPick[]; searching: { startedAt: string } | null };
/**
 * What the owner asked of the stock: reject — «Не то», the search learns he dislikes such stories; drop — «Убрать»,
 * just gone (an outdated story, not today's mood), nothing learned; more — search for more now.
 */
export type StockOrders = { reject: string[]; drop: string[]; more: boolean };

// ---- runner protocol (Basic auth worker:<SITE_PASSWORD>, like the worker and the 3D runner)

/**
 * POST /api/news/runner/claim { tracks, stock } → the oldest queued job, now marked running, or { job: null }; needTracks —
 * reported tracks whose prepared piece the site does not have yet: the runner uploads them (PUT …/runner/track).
 * stock — the runner's story stock for the list page; stockOrders — what the owner asked of it since (every claim
 * repeats them until the reported stock shows them done).
 */
export type ClaimBody = { tracks: MusicTrack[]; stock?: StockReport };
export type ClaimResponse = ({ project: NewsProject; job: NewsJob } | { job: null }) & { needTracks?: string[]; stockOrders?: StockOrders };
/** PUT /api/news/runner/track?file=…&sig=… — the prepared piece of a track, audio/mp4, the whole file in one body. */
/** POST /api/news/runner/progress — also the heartbeat; 409 when the job is no longer this one. */
export type ProgressBody = { id: string; jobId: string; step: string; progress: number };
/** POST /api/news/runner/story — the found story, shown on the page while the video is being made. */
export type StoryBody = { id: string; jobId: string; story: NewsStory };
/** PUT /api/news/runner/video/<id>?jobId=… — chunked like the 3D runner: x-offset, x-file-size; 409 returns { received }. */
/**
 * POST /api/news/runner/complete — finishes the job: error, or the uploaded render without music. music — the track a
 * new video starts with (a rerender keeps the one the owner chose).
 */
export type CompleteBody = { id: string; jobId: string; error?: string; video?: { duration: number; music: string | null } };
