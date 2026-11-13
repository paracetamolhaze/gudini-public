import { STALE_MS } from "./types";
import type { MusicTrack, NewsJob, NewsProject, NewsStory, NewsVideo } from "./types";

/**
 * Rules of the «Новости» section that both the store and the pages need: limits, the checks of what the runner
 * sends (the story, the music list), job liveness and the status chip. No Node imports here — the pages bundle this file.
 */

export const STORY_TITLE_MAX = 120;
export const STORY_SUMMARY_MAX = 1200;
export const STORY_HERO_MAX = 120;
export const STORY_SOURCES_MAX = 12;
export const SOURCE_URL_MAX = 2000;
export const SOURCE_NOTE_MAX = 300;
/** The whole voiced text of a video under a minute and a half, translated lines included, with room to spare. */
export const STORY_SCRIPT_MAX = 8000;

export const MAX_TRACKS = 300;
export const TRACK_FILE_MAX = 200;
export const TRACK_TITLE_MAX = 200;
export const TRACK_MAX_SECONDS = 60 * 60;

/** Crypto stories — two videos of six (news/runner/pipeline/story.ts CRYPTO_LANES); any other lane is not kept. */
export const CRYPTO_LANES = ["crypto-fun", "crypto-news"];

/**
 * The owner's Telegram only in the captions of crypto videos (owner 3.11: «в шапке профиля инсты и ютуба есть ссылка на
 * тг, нужно сделать, чтобы люди по ним переходили, но нативно, а не тыкать»): one line after the moral and the question,
 * in the owner's words (3.11: «Сделки по золоту в моем телеграмм канале, ссылка в шапке профиля — вот такой текст»).
 * The channel behind the link is «Алексей Гудов | FX GOLD». The other four videos of six do not mention it.
 */
export const TELEGRAM_LINE = "Сделки по золоту в моём телеграм-канале, ссылка в шапке профиля.";
const MENTIONS_TELEGRAM = /(^|[^а-яё])тг([^а-яё]|$)|телеграм|telegram/i;
export const TELEGRAM_MAX = 300;

/**
 * The YouTube experiment (10.11.2026): since the evening of 6.11 the channel's crypto news get no Shorts feed (7–23
 * views, public, no visible restriction) and the cause is not known. Crypto videos go out in turn as one of these
 * arms (news/runner/pipeline/trial.ts), and «Статистика» compares their feed views.
 */
export const TRIALS = ["calm", "no-tg", "soft", "base"] as const;
export type Trial = (typeof TRIALS)[number];
export const isTrial = (v: unknown): v is Trial => typeof v === "string" && (TRIALS as readonly string[]).includes(v);
export const TRIAL_LABEL: Record<Trial, string> = {
  calm: "без телеграма, спокойное название",
  "no-tg": "без телеграма",
  soft: "спокойное название",
  base: "как раньше",
};
/** The arms whose video and caption do not mention Telegram at all. */
export const trialSkipsTelegram = (story: NewsStory | null | undefined) => story?.trial === "calm" || story?.trial === "no-tg";
/** The arms whose YouTube title and caption name the event without the alarm words. */
export const trialCalmTitle = (story: NewsStory | null | undefined) => story?.trial === "calm" || story?.trial === "soft";
/** Words of the alarm kind: hacks, viruses, theft, forgery. Checked in the calm arms only. */
export const ALARM_WORDS = /взлом|взлам|хакер|вирус|украл|украд|краж|поддельн|мошенн|фишинг|ограб/i;

/**
 * The caption's Telegram line. When the video ends with the author's own phrase about the channel (story.telegram —
 * a reason to come that grows out of this story), the caption repeats that phrase: one sentence under every video gave
 * 32 link taps for 965 thousand Instagram views in two weeks (review of 10.11.2026). Otherwise the owner's line.
 */
export function withTelegram(description: string, story: NewsStory | null | undefined): string {
  if (!story?.lane || !CRYPTO_LANES.includes(story.lane) || trialSkipsTelegram(story) || MENTIONS_TELEGRAM.test(description)) return description;
  return [description.trim(), story.telegram?.trim() || TELEGRAM_LINE].filter(Boolean).join("\n\n");
}

/** Line breaks and double spaces mean nothing in a title or a note. */
export const cleanText = (s: string) => s.replace(/\s+/g, " ").trim();

/** The voiced text keeps its line breaks (narration and translated lines in order); only edges and Windows line ends are cleaned. */
const cleanBlock = (s: string) => s.replace(/\r\n?/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();

/** Only web links: the page renders sources as links, and a javascript: or file: one must never get there. */
function webUrl(raw: string): string | null {
  const s = raw.trim();
  if (!s || s.length > SOURCE_URL_MAX) return null;
  try {
    const u = new URL(s);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}

/**
 * Normalizes the story from the runner. Problems come back as Russian sentences instead of an exception: the store
 * rejects the story whole with them, nothing is cut to fit.
 */
export function checkStory(raw: unknown): { story: NewsStory | null; problems: string[] } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { story: null, problems: ["История не распознана"] };
  const r = raw as { title?: unknown; summary?: unknown; hero?: unknown; sources?: unknown; script?: unknown; lane?: unknown; trial?: unknown; telegram?: unknown; relaunch?: unknown };
  const problems: string[] = [];

  const title = typeof r.title === "string" ? cleanText(r.title) : "";
  if (!title) problems.push("У истории нет заголовка");
  else if (title.length > STORY_TITLE_MAX) problems.push(`Заголовок истории длиннее ${STORY_TITLE_MAX} знаков (${title.length})`);

  if (r.summary !== undefined && typeof r.summary !== "string") problems.push("Пересказ истории должен быть строкой");
  const summary = typeof r.summary === "string" ? cleanText(r.summary) : "";
  if (summary.length > STORY_SUMMARY_MAX) problems.push(`Пересказ истории длиннее ${STORY_SUMMARY_MAX} знаков (${summary.length})`);

  if (r.hero !== undefined && r.hero !== null && typeof r.hero !== "string") problems.push("Герой должен быть строкой");
  const hero = typeof r.hero === "string" ? cleanText(r.hero) : "";
  if (hero.length > STORY_HERO_MAX) problems.push(`Герой длиннее ${STORY_HERO_MAX} знаков`);

  const sources: NewsStory["sources"] = [];
  if (r.sources !== undefined && !Array.isArray(r.sources)) problems.push("Источники должны быть списком");
  const rawSources = Array.isArray(r.sources) ? r.sources : [];
  if (rawSources.length > STORY_SOURCES_MAX) problems.push(`Источников больше ${STORY_SOURCES_MAX}`);
  rawSources.forEach((item: unknown, i: number) => {
    const s = (item && typeof item === "object" ? item : {}) as { url?: unknown; note?: unknown };
    const url = typeof s.url === "string" ? webUrl(s.url) : null;
    if (!url) return void problems.push(`Источник ${i + 1}: нужна ссылка http(s)`);
    if (s.note !== undefined && s.note !== null && typeof s.note !== "string") return void problems.push(`Источник ${i + 1}: пометка должна быть строкой`);
    const note = typeof s.note === "string" ? cleanText(s.note) : "";
    if (note.length > SOURCE_NOTE_MAX) return void problems.push(`Источник ${i + 1}: пометка длиннее ${SOURCE_NOTE_MAX} знаков`);
    sources.push(note ? { url, note } : { url });
  });

  const script = typeof r.script === "string" ? cleanBlock(r.script) : "";
  if (!script) problems.push("В истории нет текста озвучки");
  else if (script.length > STORY_SCRIPT_MAX) problems.push(`Текст озвучки длиннее ${STORY_SCRIPT_MAX} знаков (${script.length})`);

  if (problems.length) return { story: null, problems };
  const lane = typeof r.lane === "string" && CRYPTO_LANES.includes(r.lane) ? r.lane : null;
  // the experiment arm and the closing Telegram phrase belong to crypto videos only; anything odd is simply not kept
  const trial = lane && isTrial(r.trial) ? r.trial : null;
  const telegram = lane && typeof r.telegram === "string" && MENTIONS_TELEGRAM.test(r.telegram) ? cleanText(r.telegram).slice(0, TELEGRAM_MAX) : "";
  const relaunch = checkRelaunch(r.relaunch);
  return {
    story: { title, summary, ...(hero ? { hero } : {}), sources, script, ...(lane ? { lane } : {}), ...(trial ? { trial } : {}), ...(telegram ? { telegram } : {}), ...(relaunch ? { relaunch } : {}) },
    problems,
  };
}

const RELAUNCH_PLATFORMS = ["tiktok", "youtube", "instagram"] as const;
/** «Новое начало»: which video it repeats and for which platform; a broken mark is not kept. */
function checkRelaunch(raw: unknown): NewsStory["relaunch"] | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as { of?: unknown; platform?: unknown };
  const platform = RELAUNCH_PLATFORMS.find((p) => p === r.platform);
  return typeof r.of === "string" && /^[a-z0-9]{8,40}$/.test(r.of) && platform ? { of: r.of, platform } : null;
}
export const PLATFORM_NAME: Record<(typeof RELAUNCH_PLATFORMS)[number], string> = { tiktok: "TikTok", youtube: "YouTube", instagram: "Instagram" };

export const sameStory = (a: NewsStory | null, b: NewsStory | null) => JSON.stringify(a) === JSON.stringify(b);

/** A file name from the PC's news/music folder: no folders, no way out of it. */
const isTrackFile = (s: string) => s.length <= TRACK_FILE_MAX && !/[\\/\u0000-\u001f]/.test(s) && s !== "." && s !== "..";

/**
 * The music list the runner reports on every claim. A broken entry is dropped, not the whole list: one odd file in
 * the folder must not take the others off the page. Repeats of a file keep the first.
 */
export function checkTracks(raw: unknown): { tracks: MusicTrack[]; dropped: number } {
  if (!Array.isArray(raw)) return { tracks: [], dropped: 0 };
  const tracks: MusicTrack[] = [];
  let dropped = 0;
  for (const item of raw.slice(0, MAX_TRACKS)) {
    const t = (item && typeof item === "object" ? item : {}) as { file?: unknown; title?: unknown; duration?: unknown; sig?: unknown };
    const file = typeof t.file === "string" ? t.file.trim() : "";
    const duration = typeof t.duration === "number" ? t.duration : NaN;
    if (!file || !isTrackFile(file) || !(duration > 0 && duration <= TRACK_MAX_SECONDS) || tracks.some((x) => x.file === file)) {
      dropped++;
      continue;
    }
    // without a title the file name without its extension is one
    const title = (typeof t.title === "string" ? cleanText(t.title) : "") || file.replace(/\.[^.]+$/, "") || file;
    const sig = typeof t.sig === "string" && /^[a-f0-9]{8,40}$/.test(t.sig) ? t.sig : undefined;
    tracks.push({ file, title: title.slice(0, TRACK_TITLE_MAX), duration: Math.round(duration * 10) / 10, ...(sig ? { sig } : {}) });
  }
  return { tracks, dropped: dropped + Math.max(0, raw.length - MAX_TRACKS) };
}

/** «2:05» */
export function formatDuration(sec: number): string {
  const s = Math.max(0, Math.round(Number.isFinite(sec) ? sec : 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** A track as the page gets it: ready — its piece is on the site, so it plays and mixes at once. */
export type TrackView = MusicTrack & { ready: boolean };

export const trackLabel = (t: MusicTrack) => `${t.title} · ${formatDuration(t.duration)}`;

/** What is under the video in words: the track's title, «без музыки», or the file of a track no longer on the PC. */
export function musicLabel(music: string | null | undefined, tracks: readonly MusicTrack[]): string {
  if (!music) return "без музыки";
  return tracks.find((t) => t.file === music)?.title ?? music.replace(/\.[^.]+$/, "");
}

/** A running job silent for STALE_MS: the PC runner died or lost the site. It may be replaced. */
export function isLost(job: NewsJob | null | undefined, now = Date.now()): boolean {
  if (!job || job.state !== "running") return false;
  const seen = Date.parse(job.heartbeatAt ?? job.startedAt ?? job.createdAt);
  return !Number.isFinite(seen) || now - seen > STALE_MS;
}

/** Queued or running and not lost: while it lives, no other job of this project starts. */
export function isLive(job: NewsJob | null | undefined, now = Date.now()): boolean {
  if (!job) return false;
  return job.state === "queued" || (job.state === "running" && !isLost(job, now));
}

// ---- what the pages get: the stored project plus the server's verdict on the job

export type JobView = NewsJob & { lost: boolean };
export type ProjectView = Omit<NewsProject, "job"> & { job: JobView | null };
/**
 * Where the video went, for the list: posted, scheduled, being sent now, or a TikTok send that stopped until the
 * owner logs in again (the worker does not go on by itself).
 */
export type PublishedMark = {
  platform: "tiktok" | "youtube" | "instagram";
  state: "published" | "scheduled" | "sending" | "login";
  trial?: boolean;
  /** When a scheduled send goes out (ISO); the list shows it in the owner's own time. */
  at?: string;
};

/** The moment written inside a publication's note («Запланировано на 2026-11-11T16:40:00.000Z.»), if there is one. */
export const ISO_IN_TEXT = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?Z/;
export type ProjectSummary = {
  id: string;
  /** The story's title; null until the runner has found one. */
  title: string | null;
  hero: string | null;
  createdAt: string;
  updatedAt: string;
  job: JobView | null;
  video: NewsVideo | null;
  /** The cover when there is one: the list shows it instead of a frame of the video. */
  cover: { at: string } | null;
  published: PublishedMark[];
  /** The owner put the video aside to be fixed: it stands in «Доработка», not among the ready ones. */
  rework?: boolean;
  /** What the list says about the video in a few words: «Новое начало · для Instagram», «Опыт YouTube: без телеграма». */
  note?: string;
};

/** The list's note about a video: a second launch names its platform, a crypto video — its experiment arm. */
export function storyNote(story: NewsStory | null | undefined): string | undefined {
  if (story?.relaunch) return `Новое начало · для ${PLATFORM_NAME[story.relaunch.platform]}`;
  if (isTrial(story?.trial) && story?.trial !== "base") return `Опыт YouTube: ${TRIAL_LABEL[story.trial]}`;
  return undefined;
}

/** The server decides "lost" by its own clock: the phone's clock may be off. */
export function toView(p: NewsProject, now = Date.now()): ProjectView {
  return { ...p, job: p.job ? { ...p.job, lost: isLost(p.job, now) } : null };
}

/** The video's name where a string is needed (the mirror's topic, the spend log, the download): the story's title. */
export const projectTitle = (p: { story: NewsStory | null }) => p.story?.title || "Новости";

/** The title the pages show: the story's, or what is going on while there is none yet. */
export function shownTitle(title: string | null | undefined, job: JobView | null): string {
  if (title) return title;
  return job && jobActive(job) && !job.lost && job.task === "create" ? "Ищем историю…" : "История не найдена";
}

/** marks come from the server: the cover file and the mirror's publications are not in the project itself. */
export function toSummary(p: NewsProject, now = Date.now(), marks: Pick<ProjectSummary, "cover" | "published"> = { cover: null, published: [] }): ProjectSummary {
  return {
    id: p.id,
    title: p.story?.title || null,
    hero: p.story?.hero || null,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    job: toView(p, now).job,
    video: p.video,
    cover: marks.cover,
    published: marks.published,
    ...(p.rework ? { rework: true } : {}),
    ...(storyNote(p.story) ? { note: storyNote(p.story) } : {}),
  };
}

export type StatusTone = "neutral" | "accent" | "success" | "warn" | "error";
export type Status = { text: string; tone: StatusTone; busy: boolean };

export function statusOf(p: { job: JobView | null; video: NewsVideo | null; title: string | null }): Status {
  const job = p.job;
  if (job?.lost) return { text: "ПК не отвечает", tone: "warn", busy: false };
  if (job?.state === "queued") return { text: job.task === "rerender" ? "Перемонтаж в очереди" : "В очереди", tone: "neutral", busy: true };
  if (job?.state === "running") {
    if (job.task === "rerender") return { text: `Перемонтируем · ${job.progress}%`, tone: "accent", busy: true };
    if (!p.title) return { text: "Ищем историю", tone: "accent", busy: true };
    return { text: `Делаем ролик · ${job.progress}%`, tone: "accent", busy: true };
  }
  // a failed rerender leaves the video as it was: it is still ready
  if (job?.state === "error" && !(job.task === "rerender" && p.video)) return { text: "Ошибка", tone: "error", busy: false };
  if (p.video) return { text: "Готово", tone: "success", busy: false };
  return { text: "Без ролика", tone: "neutral", busy: false };
}

export const jobActive = (job: JobView | null) => Boolean(job && (job.state === "queued" || job.state === "running"));

/** How long a job may wait, and the PC stay silent, before the list says the PC does not take jobs. */
export const RUNNER_QUIET_MS = 90_000;

/**
 * Jobs wait and nobody takes them: a job has been queued for a while, no job is being worked on (a busy runner does
 * not ask for more) and the runner has not asked for work lately. seenAt is its last claim, kept in the site's memory.
 */
export function runnerQuiet(jobs: readonly (NewsJob | null)[], seenAt: string | null, now = Date.now()): boolean {
  const waiting = jobs.some((j) => j?.state === "queued" && now - Date.parse(j.createdAt) > RUNNER_QUIET_MS);
  if (!waiting) return false;
  if (jobs.some((j) => j?.state === "running" && !isLost(j, now))) return false;
  const seen = seenAt ? Date.parse(seenAt) : NaN;
  return !(now - seen <= RUNNER_QUIET_MS);
}

/** What a task is called in Russian, for the job panel. */
export const TASK_LABEL: Record<NewsJob["task"], string> = { create: "ролик", rerender: "перемонтаж" };
