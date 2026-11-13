"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { DUB_KEEP_AFTER, DUB_KEEP_BEFORE, DUB_PRE_ROLL, type DubTake, type JobTask } from "@/lib/studio3d/types";
import {
  CAST_LABEL,
  clipFor,
  dubSpan,
  jobActive,
  letterWindows,
  median,
  montageWarning,
  placeTake,
  projectTitle,
  refineTried,
  retimed,
  SYNC_FRAMES,
  takeSlip,
  TASK_LABEL,
  voiceOverLines,
  voiceOverProgress,
  type ProjectView,
  type VoiceOverLine,
  type VoiceOverStatus,
} from "@/lib/studio3d/rules";
import { api, ApiError, usePolling, useConfirm } from "../../ui";
import s from "../../studio3d.module.css";
import d from "../../dub.module.css";

/**
 * «Озвучить самому» поверх готового ролика, как на сайтах дубляжа: сверху ролик, под ним реплика крупно, звук её
 * окна, «Оригинал», «Моя озвучка» и «Записать». Записывается только своя реплика, целиком: «3» и «2» на кадре её
 * начала, на «1» ролик уже идёт без звука (полсекунды до реплики), на её начале — «Говорите!», и после хвоста запись
 * останавливается сама. Дубль сохраняется с отметкой, где он лёг на ролик; остановленный раньше конца реплики не
 * сохраняется. «Собрать с моим голосом» отдаёт записи исполнителю.
 */

/**
 * opening: the microphone is being opened (the permission prompt may be up) and the window downloaded; a second
 * press must wait for it. count: the 3-2-1 over the line's first frame, nothing is recorded yet.
 */
type Phase = "idle" | "opening" | "count" | "recording" | "saving";
/** Where a running take is: the muted run-up before the line, the line itself, the tail after it. */
type RecStage = "pre" | "speak" | "tail";
type Playing = "orig" | "mine" | null;
type PlayEnd = "ended" | "stopped" | "failed";
type Prefs = { deviceId: string; noise: boolean; agc: boolean; gain: number; latencyMs: number };
type Meta = { videoStart: number; latencyMs: number; lineStart: number; lineEnd: number; videoAt: string };
type Retry = { key: string; blob: Blob; meta: Meta };
/** The loudest sample per bucket, `rate` buckets per second from time 0 of its source. */
type Peaks = { rate: number; data: Float32Array };
type Wave = { status: "loading" } | { status: "ready"; peaks: Peaks } | { status: "failed" };
type Hooks = {
  /** A take: the video stands on the line's first frame; the page keeps it on screen while the video seeks back. */
  still?: (v: HTMLVideoElement) => void;
  /** A take: the count-in, once the window is downloaded; false calls the whole thing off. */
  countIn?: () => Promise<boolean>;
  /** Right before the video starts; false calls the whole thing off (the take was cancelled meanwhile). */
  beforePlay?: () => boolean;
  /** Each shown frame: its media time and when it is on screen (performance.now clock). */
  onFrame?: (mediaTime: number, shownAt: number) => void;
  /** The video time, also the virtual one below 0 while a take holds the first frame before a line at the start. */
  onTime?: (t: number) => void;
  /** «Моя озвучка»: the take and the video time of its first sample. */
  take?: { buffer: AudioBuffer; videoStart: number };
  /** A take waits for the window to download before the recorder starts. */
  onLoading?: (on: boolean) => void;
  /** The video paused for data after it started: the picture stopped, the recorder did not. */
  onStall?: () => void;
};
type Session = { stop: () => void; done: Promise<PlayEnd> };

const PREFS_KEY = "gudini:3d:dub";
const DEFAULT_PREFS: Prefs = { deviceId: "", noise: true, agc: true, gain: 1, latencyMs: 0 };
/** «Моя озвучка» opens his take over the same range the dub keeps, so the preview is what the video will sound like. */
const DUCK_BEFORE = DUB_KEEP_BEFORE;
const DUCK_AFTER = DUB_KEEP_AFTER;
/**
 * The count-in before a take: «3» and «2» over the line's first frame, then «1» is the run-up itself (the muted video
 * DUB_PRE_ROLL before the line, recorder on), so the beat after «1» — «Говорите!» — is exactly where the line starts.
 */
const COUNT_FROM = 3;
const COUNT_STEP_MS = DUB_PRE_ROLL * 1000;
/**
 * Speaking in the run-up loses the line's start: a dub keeps his take from 0.15 s before the line. The mic's loudest
 * before that, against the loudest over the line, tells a take started too early from a breath or room noise.
 */
const EARLY_GAP = 0.15;
const EARLY_MIN = 0.1;
const EARLY_SHARE = 0.5;
/** «Моя озвучка» restarts the take when it drifts from the video by more than this, seconds. */
const MAX_DRIFT = 0.06;
/** A take's first and last frames may disagree this much (takeSlip); more means the video paused under the recorder. */
const MAX_TAKE_SLIP = 0.045;
/** Before a take the window gets this long to download, and gives up sooner when nothing arrives for BUFFER_IDLE_MS. */
const BUFFER_WAIT_MS = 6000;
const BUFFER_IDLE_MS = 1500;
const PEAKS_RATE = 200;
const LATENCY_MAX = 400;
const GAIN_MIN = 0.5;
const GAIN_MAX = 3;

const STATUS_LABEL: Record<VoiceOverStatus, string> = { recorded: "записано", missing: "нет", stale: "устарело", optional: "по желанию" };

/** Text fields keep their keys; a switch or a button does not: Space there records. */
function inField(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  if (t.closest("dialog")) return true;
  if (t instanceof HTMLInputElement) return !["checkbox", "radio", "button", "submit", "reset", "range"].includes(t.type);
  return Boolean(t.closest("textarea, select, [contenteditable='true']"));
}

type WebkitWindow = { webkitAudioContext?: typeof AudioContext; webkitOfflineAudioContext?: typeof OfflineAudioContext };
const audioCtor = () => (typeof window === "undefined" ? undefined : (window.AudioContext ?? (window as unknown as WebkitWindow).webkitAudioContext));
const offlineCtor = () => (typeof window === "undefined" ? undefined : (window.OfflineAudioContext ?? (window as unknown as WebkitWindow).webkitOfflineAudioContext));

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

function readPrefs(): Prefs {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "null");
    if (p && typeof p === "object") {
      const num = (v: unknown, lo: number, hi: number, def: number) => (typeof v === "number" && Number.isFinite(v) ? clamp(v, lo, hi) : def);
      return {
        deviceId: typeof p.deviceId === "string" ? p.deviceId : "",
        noise: typeof p.noise === "boolean" ? p.noise : DEFAULT_PREFS.noise,
        agc: typeof p.agc === "boolean" ? p.agc : DEFAULT_PREFS.agc,
        gain: num(p.gain, GAIN_MIN, GAIN_MAX, 1),
        latencyMs: num(p.latencyMs, -LATENCY_MAX, LATENCY_MAX, 0),
      };
    }
  } catch {}
  return DEFAULT_PREFS;
}

/** The first format this browser records: Chrome and Firefox take webm/opus, Safari takes mp4. */
function pickMime(): string {
  const all = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus", "audio/ogg"];
  return all.find((m) => typeof MediaRecorder.isTypeSupported === "function" && MediaRecorder.isTypeSupported(m)) ?? "";
}

/** What the browser said, in words the owner can act on. */
function micError(e: unknown): string {
  const name = e instanceof DOMException || e instanceof Error ? e.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "Доступ к микрофону запрещён. Разрешите его в настройках сайта (значок слева от адреса) и обновите страницу.";
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") return "Микрофон не найден — подключите его или выберите другой.";
  if (name === "NotReadableError" || name === "AbortError") return "Микрофон занят другой программой или недоступен — закройте её и попробуйте снова.";
  return `Не удалось включить микрофон: ${e instanceof Error ? e.message : String(e)}`;
}

/** Moves the video to t and waits for the frame; a video already there (and not seeking) is left as it is. */
async function seekTo(v: HTMLMediaElement, t: number): Promise<void> {
  if (!v.seeking && v.readyState >= 2 && Math.abs(v.currentTime - t) < 0.002) return;
  v.currentTime = t;
  // some browsers skip "seeked" for a seek to where the video already is
  await once(v, "seeked", 4000).catch((e) => {
    if (v.seeking) throw e;
  });
}

/** A short soft tick of the count-in, straight to the speakers: the recorder is not running yet. */
function tick(ctx: AudioContext | null) {
  if (!ctx || ctx.state !== "running") return;
  try {
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.05, t + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.11);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.12);
    osc.onended = () => gain.disconnect();
  } catch {}
}

/** Resolves on the event, rejects on an error event or after ms. */
function once(el: HTMLMediaElement, event: string, ms: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const done = (fn: () => void) => () => {
      clearTimeout(timer);
      el.removeEventListener(event, ok);
      el.removeEventListener("error", bad);
      fn();
    };
    const ok = done(resolve);
    const bad = done(() => reject(new Error("media error")));
    const timer = setTimeout(done(() => reject(new Error(`no ${event}`))), ms);
    el.addEventListener(event, ok, { once: true });
    el.addEventListener("error", bad, { once: true });
  });
}

// ---- decoded audio and the downloaded video, kept while the page is open

/** An encoded file as PCM at `rate` (resampled by the browser). */
function decodeData(data: ArrayBuffer, rate: number): Promise<AudioBuffer> {
  const OAC = offlineCtor();
  if (!OAC) return Promise.reject(new Error("no WebAudio"));
  const ctx = new OAC(1, 1, rate);
  // the callback form as well: older Safari returns nothing from decodeAudioData
  return new Promise<AudioBuffer>((resolve, reject) => {
    const r = ctx.decodeAudioData(data, resolve, reject) as Promise<AudioBuffer> | undefined;
    r?.catch(reject);
  });
}

/** Takes and synthesized clips by `${rate}|${url}`; a re-recorded take's predecessor is dropped (see takeUrls). */
const DECODED = new Map<string, Promise<AudioBuffer>>();

/** The file at url as PCM at `rate`. A failure is forgotten, so it can be tried again. */
function decode(url: string, rate: number): Promise<AudioBuffer> {
  const key = `${rate}|${url}`;
  let p = DECODED.get(key);
  if (!p) {
    p = (async () => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return decodeData(await res.arrayBuffer(), rate);
    })();
    DECODED.set(key, p);
    p.catch(() => DECODED.delete(key));
  }
  return p;
}

/**
 * The whole video, downloaded once: the waveform decodes it, the cards take their frames from it and the player
 * switches to it, so a take never waits for the network in the middle of a line. Only the current video is kept.
 */
const BLOBS = new Map<string, Promise<Blob>>();

function videoBlob(url: string): Promise<Blob> {
  const cached = BLOBS.get(url);
  if (cached) return cached;
  BLOBS.clear();
  const p = fetch(url).then((res) => {
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.blob();
  });
  BLOBS.set(url, p);
  p.catch(() => {
    if (BLOBS.get(url) === p) BLOBS.delete(url);
  });
  return p;
}

function peaksOf(buf: AudioBuffer, rate = PEAKS_RATE): Peaks {
  const data = new Float32Array(Math.ceil(buf.duration * rate) + 1);
  const per = buf.sampleRate / rate;
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const ch = buf.getChannelData(c);
    for (let i = 0; i < ch.length; i++) {
      const a = ch[i] < 0 ? -ch[i] : ch[i];
      const b = (i / per) | 0;
      if (a > data[b]) data[b] = a;
    }
  }
  return { rate, data };
}

const PEAKS = new Map<string, Promise<Peaks>>();

/** The video's own sound as peaks; the whole PCM is not kept, only what the waveform needs. */
function videoPeaks(url: string): Promise<Peaks> {
  let p = PEAKS.get(url);
  if (!p) {
    // Response.arrayBuffer: Blob.arrayBuffer is missing in older Safari
    p = videoBlob(url).then(async (blob) => peaksOf(await decodeData(await new Response(blob).arrayBuffer(), 22050)));
    PEAKS.set(url, p);
    p.catch(() => PEAKS.delete(url));
  }
  return p;
}

/** Is [a, b] of the video downloaded, or does the browser expect to play through it without a pause? */
function readyFor(v: HTMLMediaElement, a: number, b: number): boolean {
  if (v.readyState >= 4) return true;
  const end = Math.min(b, Number.isFinite(v.duration) ? v.duration : b) - 0.1;
  const r = v.buffered;
  for (let i = 0; i < r.length; i++) if (r.start(i) <= a + 0.1 && r.end(i) >= end) return true;
  return false;
}

/**
 * Waits for [a, b] to download, so a take does not run into a buffering pause. Gives up after BUFFER_WAIT_MS, or
 * sooner when nothing arrives (some phones load nothing while paused): the take then checks its sync by itself.
 */
async function whenReady(v: HTMLMediaElement, a: number, b: number, cancelled: () => boolean): Promise<void> {
  const started = performance.now();
  let got = -1;
  let grew = started;
  while (!cancelled() && !readyFor(v, a, b)) {
    const now = performance.now();
    let sum = 0;
    for (let i = 0; i < v.buffered.length; i++) sum += v.buffered.end(i) - v.buffered.start(i);
    if (sum > got) {
      got = sum;
      grew = now;
    }
    if (now - started > BUFFER_WAIT_MS || now - grew > BUFFER_IDLE_MS) return;
    await new Promise((r) => setTimeout(r, 150));
  }
}

const msText = (ms: number) => (ms === 0 ? "0 мс" : `${ms > 0 ? "+" : "−"}${Math.abs(ms)} мс`);
const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

/** Voice tags ([sighs]) are shown as quiet hints: they say how, not what. */
function LineText({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\[[^\]]*\])/).map((part, i) =>
        /^\[[^\]]*\]$/.test(part) ? (
          <span key={i} className={d.tag}>
            {part}
          </span>
        ) : (
          part
        ),
      )}
    </>
  );
}

// icons as SVG: phones draw ▶ and ⏱ as colour emoji
const PlayIcon = ({ stop }: { stop?: boolean }) => (
  <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
    {stop ? <rect x="2" y="2" width="8" height="8" rx="1" fill="currentColor" /> : <path d="M3 1.5v9l7.5-4.5z" fill="currentColor" />}
  </svg>
);
const ClockIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <circle cx="12" cy="13" r="8" />
    <path d="M12 9v4l2.5 2.5M9 2h6" />
  </svg>
);
const Arrow = ({ left }: { left?: boolean }) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={left ? "M19 12H5M12 19l-7-7 7-7" : "M5 12h14M12 5l7 7-7 7"} />
  </svg>
);

export default function Studio3DVoicePage() {
  const { id } = useParams<{ id: string }>();
  const [project, setProject] = useState<ProjectView | null>(null);
  const [loadError, setLoadError] = useState<ApiError | null>(null);
  /** The selected line, by its script index. */
  const [sel, setSel] = useState(-1);
  const [phase, setPhaseState] = useState<Phase>("idle");
  const [stage, setStage] = useState<RecStage>("pre");
  const [playing, setPlaying] = useState<Playing>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [retry, setRetry] = useState<Retry | null>(null);
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [micOn, setMicOn] = useState(false);
  const [micMessage, setMicMessage] = useState("");
  /** peakDb null: the level meter was not running (iPhone kept audio asleep), so the level is unknown. */
  const [latencyOpen, setLatencyOpen] = useState(false);
  const [wave, setWave] = useState<Wave>({ status: "loading" });
  const [takePeaks, setTakePeaks] = useState<Record<string, Peaks>>({});
  const [thumbs, setThumbs] = useState<Record<number, string>>({});
  const [starting, setStarting] = useState<"" | JobTask>("");
  const [waveWidth, setWaveWidth] = useState(0);
  /** The count-in number over the video (3, 2, 1); 0 when there is none. */
  const [count, setCount] = useState(0);
  /** The line's first frame is held over the video (stillRef) while the take counts in. */
  const [still, setStill] = useState(false);
  /** A take is waiting for its window of the video to download. */
  const [loadingVideo, setLoadingVideo] = useState(false);
  /** The downloaded video as an object URL, with the server URL it was made from. */
  const [local, setLocal] = useState<{ of: string; url: string } | null>(null);
  /** The object URL the player switched to: it switches only between takes and playbacks, never under one. */
  const [switched, setSwitched] = useState("");
  const { confirm, modal } = useConfirm();

  const phaseRef = useRef<Phase>("idle");
  const setPhase = (p: Phase) => {
    phaseRef.current = p;
    setPhaseState(p);
  };
  /** Read through a call: after an await TypeScript would keep the phase it checked before it. */
  const phaseNow = (): Phase => phaseRef.current;
  const videoRef = useRef<HTMLVideoElement>(null);
  const stillRef = useRef<HTMLCanvasElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  /** A state, not a ref: the box appears only once a line is chosen, and its size is observed from then on. */
  const [waveBox, setWaveBox] = useState<HTMLDivElement | null>(null);
  const playheadRef = useRef<HTMLDivElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const latencyRef = useRef<HTMLDivElement>(null);
  const meterRef = useRef<HTMLDivElement>(null);
  /** One AudioContext for the page's life: created or woken inside a click (iPhone Safari), closed on leaving. */
  const ctxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  /** mic → gain («Усиление») → destination for the recorder, and the meter after the gain: it shows what is recorded. */
  const graphRef = useRef<{ source: MediaStreamAudioSourceNode; gain: GainNode; dest: MediaStreamAudioDestinationNode } | null>(null);
  /** The getUserMedia under way: a second press shares it instead of opening a second stream. */
  const openingRef = useRef<Promise<MediaStream> | null>(null);
  /** The page is gone (client navigation): late callbacks must not open, record or play anything. */
  const disposedRef = useRef(false);
  /** Each press that opens the mic gets a number: after Esc and a new press, only the newest one goes on. */
  const attemptRef = useRef(0);
  const meterRaf = useRef(0);
  /** Loudest sample since the last reset, as a 0..1 amplitude. */
  const peakRef = useRef(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const discardRef = useRef(false);
  const sessionRef = useRef<Session | null>(null);
  /**
   * A muted play() inside a click lets later plays with sound start outside of one (iPhone Safari). It holds for that
   * element and source only: a new video mounts a new element, so the next click unlocks again.
   */
  const unlockedRef = useRef<{ el: HTMLVideoElement; src: string } | null>(null);
  const takeBuffers = useRef(new Map<string, AudioBuffer>());
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;

  // ---- data

  const load = useCallback(async () => {
    try {
      setProject(await api<ProjectView>(`/api/3d/${id}`));
      setLoadError(null);
    } catch (e) {
      setLoadError(e as ApiError);
    }
  }, [id]);
  useEffect(() => void load(), [load]);

  const job = project?.job ?? null;
  const live = Boolean(job && jobActive(job) && !job.lost);
  usePolling(live, 2000, load);

  const video = project?.video ?? null;
  const lines = useMemo<VoiceOverLine[]>(() => (project ? voiceOverLines(project) : []), [project]);
  const progress = useMemo(() => (project ? voiceOverProgress(project) : null), [project]);
  // windows from the letter timings: a performed sigh before the words and the last word's tail fall outside them
  const oldWindows = Boolean(project && letterWindows(project));
  /** A "voice" job ran and the windows are still the letters': recording over them is the way left (or a new montage). */
  const refineFailed = oldWindows && Boolean(project && refineTried(project));
  /** Takes wait for the windows measured from the sound: one recorded before would be for the old ones. */
  const waitRefine = oldWindows && !refineFailed;
  const takesLocked = live && (job?.task === "montage" || job?.task === "dub" || (job?.task === "voice" && oldWindows));
  const recordClosed = takesLocked || waitRefine;
  const line = lines[sel] ?? null;
  const own = line?.who === "me";
  const fitted = own && line?.status === "recorded" && line.take && line.window ? placeTake(line.take, line.window) : null;
  const videoSrc = video ? `/api/3d/${id}/video?v=${encodeURIComponent(video.at)}` : "";
  const takeUrl = useCallback((t: DubTake) => `/api/3d/${id}/dub/${t.key}?v=${encodeURIComponent(t.at)}`, [id]);
  /** Lines the owner can record, in order: «Следующий» and the arrows go through them. */
  const ownOrder = useMemo(() => lines.filter((l) => l.who === "me" && l.window).map((l) => l.index), [lines]);
  const hasWindows = lines.some((l) => l.window);
  const videoStale = Boolean(video && project && video.scriptVersion !== project.scriptVersion);

  // the latest values for callbacks that outlive a render (keyboard, the take's end)
  const lineRef = useRef(line);
  lineRef.current = line;
  const videoInfoRef = useRef(video);
  videoInfoRef.current = video;
  const lockedRef = useRef(recordClosed);
  lockedRef.current = recordClosed;

  // the first line still to dub, once: later reloads must not move the owner away from his line
  const placed = useRef(false);
  useEffect(() => {
    if (placed.current || !lines.length) return;
    placed.current = true;
    const todo = lines.find((l) => l.who === "me" && l.window && (l.status === "missing" || l.status === "stale"));
    const first = lines.find((l) => l.who === "me" && l.window) ?? lines.find((l) => l.who === "me");
    setSel((todo ?? first ?? lines[0]).index);
  }, [lines]);
  useEffect(() => {
    if (lines.length && sel >= lines.length) setSel(lines.length - 1);
  }, [sel, lines.length]);

  // ---- preferences survive a reload (they are about this device, not the project)

  useEffect(() => setPrefs(readPrefs()), []);
  const updatePrefs = useCallback((change: Partial<Prefs>) => {
    setPrefs((p) => {
      const next = { ...p, ...change };
      try {
        localStorage.setItem(PREFS_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });
  }, []);

  // ---- audio context and the video's permission to play with sound

  /**
   * Creates or wakes the page's AudioContext. Called synchronously at the start of a click, before any await:
   * iPhone Safari lets audio run only inside the gesture, and a context started later stays asleep.
   */
  const primeAudio = useCallback((): AudioContext | null => {
    try {
      let ctx = ctxRef.current;
      if (!ctx || ctx.state === "closed") {
        const AC = audioCtor();
        if (!AC) return null;
        ctx = new AC();
        ctxRef.current = ctx;
      }
      if (ctx.state !== "running") void ctx.resume().catch(() => {});
      return ctx;
    } catch {
      return null;
    }
  }, []);

  const unlockVideo = useCallback(() => {
    const v = videoRef.current;
    const u = unlockedRef.current;
    if (!v || (u && u.el === v && u.src === v.src)) return;
    const mark = { el: v, src: v.src };
    unlockedRef.current = mark;
    v.muted = true;
    void v
      .play()
      .then(() => {
        // a window that started meanwhile keeps playing
        if (!sessionRef.current) v.pause();
      })
      .catch(() => {
        if (unlockedRef.current === mark) unlockedRef.current = null;
      });
  }, []);

  // ---- playing a line's window on the video

  const movePlayhead = useCallback((t: number, from: number, to: number) => {
    const el = playheadRef.current;
    if (!el) return;
    el.style.opacity = "1";
    el.style.left = `${clamp((t - from) / (to - from), 0, 1) * 100}%`;
  }, []);

  /**
   * Plays [start − DUB_PRE_ROLL, end + DUB_POST_ROLL] of a line on the video. orig: as it is, with sound; mine: the
   * video's sound ducked around the line and the take scheduled against the video clock; rec: muted all the way, so
   * his synthesized line never leaks into the microphone — after the line's first frame was held under the count-in.
   */
  const runWindow = useCallback(
    (l: VoiceOverLine, mode: "orig" | "mine" | "rec", hooks: Hooks = {}): Session | null => {
      const v = videoRef.current;
      const info = videoInfoRef.current;
      if (!v || !l.window || !info) return null;
      sessionRef.current?.stop();
      const w = l.window;
      const span = dubSpan(w, info.duration);
      const { from, play, to } = span;
      // listening starts at once; only a take needs the whole run-up before a line at the start
      const lead = mode === "rec" ? span.lead : 0;
      const duckFrom = w.start - DUCK_BEFORE;
      const duckTo = w.end + DUCK_AFTER;
      const ctx = ctxRef.current;
      const take = mode === "mine" && ctx ? hooks.take : undefined;
      const gate = take && ctx ? ctx.createGain() : null;
      if (gate && ctx) {
        gate.gain.value = 0;
        gate.connect(ctx.destination);
      }
      let gateOpen = false;
      let src: AudioBufferSourceNode | null = null;
      /** ctx time at which the take's position 0 plays. */
      let srcZero = 0;
      let finished = false;
      let raf = 0;
      let frameHandle = 0;
      let backup = 0;
      let lastT = -1;
      /** Ends the lead-in hold early: the session finished during it. */
      let wake: (() => void) | null = null;
      let resolve!: (e: PlayEnd) => void;
      const done = new Promise<PlayEnd>((r) => (resolve = r));
      const onWaiting = () => {
        // a pause for data once the video runs: the picture stops, the recorder goes on, the take slips
        if (!finished && !v.ended && v.currentTime < to - 0.1) hooks.onStall?.();
      };

      const stopSrc = () => {
        if (!src) return;
        try {
          src.stop();
        } catch {}
        src.disconnect();
        src = null;
      };
      const startSrc = (t: number) => {
        if (!ctx || !gate || !take) return;
        stopSrc();
        const pos = t - take.videoStart;
        const now = ctx.currentTime;
        const node = ctx.createBufferSource();
        node.buffer = take.buffer;
        node.connect(gate);
        if (pos >= 0) node.start(now, pos);
        else node.start(now - pos);
        srcZero = now - pos;
        src = node;
      };
      const finish = (how: PlayEnd) => {
        if (finished) return;
        finished = true;
        cancelAnimationFrame(raf);
        window.clearInterval(backup);
        wake?.();
        v.removeEventListener("waiting", onWaiting);
        if (frameHandle && typeof v.cancelVideoFrameCallback === "function") v.cancelVideoFrameCallback(frameHandle);
        stopSrc();
        gate?.disconnect();
        v.pause();
        v.muted = false;
        if (playheadRef.current) playheadRef.current.style.opacity = "0";
        if (sessionRef.current === session) sessionRef.current = null;
        resolve(how);
      };
      const session: Session = { stop: () => finish("stopped"), done };
      sessionRef.current = session;

      const hasFrames = typeof v.requestVideoFrameCallback === "function";
      /** Sound, take and end of the window; rAF drives it, a timer backs it up where frames are throttled. */
      const step = () => {
        if (finished) return;
        const t = v.currentTime;
        const mute = mode === "rec" || (mode === "mine" && t >= duckFrom && t <= duckTo);
        if (v.muted !== mute) v.muted = mute;
        if (take && ctx && gate) {
          const inside = t >= duckFrom && t <= duckTo;
          if (inside !== gateOpen) {
            gateOpen = inside;
            gate.gain.setTargetAtTime(inside ? 1 : 0, ctx.currentTime, 0.008);
          }
          const moving = !v.paused && !v.seeking && v.readyState >= 3;
          const expected = t - take.videoStart;
          if (!moving) stopSrc();
          else if (expected < take.buffer.duration && (!src || Math.abs(ctx.currentTime - srcZero - expected) > MAX_DRIFT)) startSrc(t);
        }
        // without frame callbacks the clock is read here, only when it moved
        if (hooks.onFrame && !hasFrames && t !== lastT && !v.paused) hooks.onFrame(t, performance.now());
        lastT = t;
        hooks.onTime?.(t);
        if (t >= to - 0.005 || v.ended) finish("ended");
      };
      const tick = () => {
        if (finished) return;
        movePlayhead(v.currentTime, from, to);
        step();
        if (!finished) raf = requestAnimationFrame(tick);
      };

      void (async () => {
        v.pause();
        v.muted = mode === "rec";
        if (v.readyState < 1) await once(v, "loadedmetadata", 15_000);
        if (finished) return;
        if (hooks.still) {
          // the frame the line starts on: the owner sees which moment he dubs while the count-in runs
          await seekTo(v, Math.min(w.start + 0.04, Math.max(0, info.duration - 0.05)));
          if (finished) return;
          hooks.still(v);
        }
        await seekTo(v, play);
        if (finished) return;
        if (mode === "rec" && !readyFor(v, play, to)) {
          hooks.onLoading?.(true);
          await whenReady(v, play, to, () => finished);
          hooks.onLoading?.(false);
          if (finished) return;
        }
        if (hooks.countIn && !(await hooks.countIn())) return finish("stopped");
        if (finished) return;
        if (hooks.beforePlay && !hooks.beforePlay()) return finish("stopped");
        if (lead > 0) {
          // the line starts with the video: its first frame holds while the preparation runs out
          const held = performance.now();
          const hold = () => {
            if (finished) return;
            const t = play - Math.max(0, lead - (performance.now() - held) / 1000);
            movePlayhead(t, from, to);
            hooks.onTime?.(t);
            if (t < play) raf = requestAnimationFrame(hold);
          };
          hold();
          await new Promise<void>((r) => {
            const timer = window.setTimeout(r, lead * 1000);
            wake = () => {
              window.clearTimeout(timer);
              r();
            };
          });
          wake = null;
          cancelAnimationFrame(raf);
          if (finished) return;
        }
        await v.play();
        if (finished) {
          v.pause();
          return;
        }
        v.addEventListener("waiting", onWaiting);
        if (hooks.onFrame && hasFrames) {
          const onFrame = (now: number, meta: VideoFrameCallbackMetadata) => {
            if (finished) return;
            hooks.onFrame!(meta.mediaTime, Number.isFinite(meta.expectedDisplayTime) ? meta.expectedDisplayTime : now);
            frameHandle = v.requestVideoFrameCallback(onFrame);
          };
          frameHandle = v.requestVideoFrameCallback(onFrame);
        }
        raf = requestAnimationFrame(tick);
        backup = window.setInterval(step, 25);
      })().catch(() => finish("failed"));
      return session;
    },
    [movePlayhead],
  );

  const stopPlayback = useCallback(() => {
    sessionRef.current?.stop();
  }, []);

  // ---- microphone

  const meterLoop = useCallback((analyser: AnalyserNode) => {
    cancelAnimationFrame(meterRaf.current);
    const buf = new Float32Array(analyser.fftSize);
    const tick = () => {
      analyser.getFloatTimeDomainData(buf);
      let sum = 0;
      let peak = 0;
      for (let i = 0; i < buf.length; i++) {
        const x = buf[i];
        sum += x * x;
        const a = x < 0 ? -x : x;
        if (a > peak) peak = a;
      }
      if (peak > peakRef.current) peakRef.current = peak;
      const el = meterRef.current;
      if (el) {
        const db = 20 * Math.log10(Math.sqrt(sum / buf.length) || 1e-6);
        // −60…0 дБ на всю ширину: речь у рта ложится на середину шкалы
        el.style.width = `${clamp(((db + 60) / 60) * 100, 0, 100)}%`;
        el.dataset.hot = String(peak > 0.97);
      }
      meterRaf.current = requestAnimationFrame(tick);
    };
    meterRaf.current = requestAnimationFrame(tick);
  }, []);

  /** Stops the stream, the graph and the meter; the AudioContext stays for the next opening. */
  const closeMic = useCallback(() => {
    cancelAnimationFrame(meterRaf.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    const g = graphRef.current;
    graphRef.current = null;
    if (g) {
      for (const node of [g.source, g.gain]) {
        try {
          node.disconnect();
        } catch {}
      }
    }
    if (meterRef.current) meterRef.current.style.width = "0";
    setMicOn(false);
  }, []);

  const refreshDevices = useCallback(async () => {
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      setDevices(all.filter((x) => x.kind === "audioinput" && x.deviceId));
    } catch {}
  }, []);

  /**
   * The open microphone, opening it if needed. Call from a click: the AudioContext is woken synchronously here,
   * before the first await. Calls made while getUserMedia is pending share it, so there is never a second stream.
   */
  const openMic = useCallback((): Promise<MediaStream> => {
    const current = streamRef.current;
    if (current && current.getAudioTracks().some((t) => t.readyState === "live")) {
      primeAudio();
      return Promise.resolve(current);
    }
    if (openingRef.current) return openingRef.current;
    primeAudio();
    const opening = (async () => {
      closeMic();
      if (!window.isSecureContext) throw new Error("Микрофон работает только по HTTPS — откройте сайт по адресу, который начинается с https://");
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
        throw new Error("Этот браузер не умеет записывать звук — откройте сайт в Chrome или Safari.");
      }
      const { deviceId, noise, agc } = prefsRef.current;
      // echoCancellation off: it fights the video's sound and makes Safari's mic much quieter; headphones do it better
      const audio: MediaTrackConstraints = { echoCancellation: false, noiseSuppression: noise, autoGainControl: agc, channelCount: 1 };
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: deviceId ? { ...audio, deviceId: { exact: deviceId } } : audio });
      } catch (e) {
        const name = (e as Error)?.name;
        if (!deviceId || (name !== "OverconstrainedError" && name !== "NotFoundError")) throw new Error(micError(e));
        // the chosen microphone was unplugged: the default one is better than nothing
        try {
          stream = await navigator.mediaDevices.getUserMedia({ audio });
        } catch (e2) {
          throw new Error(micError(e2));
        }
        updatePrefs({ deviceId: "" });
      }
      if (disposedRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        throw new Error("Страница закрыта");
      }
      streamRef.current = stream;
      stream.getAudioTracks().forEach((t) =>
        t.addEventListener("ended", () => {
          if (streamRef.current !== stream) return;
          closeMic();
          setMicMessage("Микрофон отключился — включите его снова.");
        }),
      );
      try {
        const ctx = ctxRef.current && ctxRef.current.state !== "closed" ? ctxRef.current : primeAudio();
        if (ctx) {
          const source = ctx.createMediaStreamSource(stream);
          const gain = ctx.createGain();
          gain.gain.value = prefsRef.current.gain;
          const analyser = ctx.createAnalyser();
          analyser.fftSize = 1024;
          const dest = ctx.createMediaStreamDestination();
          dest.channelCount = 1;
          source.connect(gain);
          gain.connect(analyser);
          gain.connect(dest);
          graphRef.current = { source, gain, dest };
          void ctx.resume().catch(() => {});
          meterLoop(analyser);
        }
      } catch {
        // no graph: the take is recorded straight from the mic, without «Усиление»
        graphRef.current = null;
      }
      setMicOn(true);
      setMicMessage("");
      void refreshDevices();
      return stream;
    })();
    openingRef.current = opening;
    const settle = () => {
      if (openingRef.current === opening) openingRef.current = null;
    };
    opening.then(settle, settle);
    return opening;
  }, [closeMic, meterLoop, primeAudio, refreshDevices, updatePrefs]);

  useEffect(() => {
    // with the microphone allowed before, the list has names at once; otherwise the first press on it opens one
    void refreshDevices();
    if (!navigator.mediaDevices?.addEventListener) return;
    const onChange = () => void refreshDevices();
    navigator.mediaDevices.addEventListener("devicechange", onChange);
    return () => navigator.mediaDevices.removeEventListener("devicechange", onChange);
  }, [refreshDevices]);

  // another microphone or its processing: reopen with it, but never under a running take
  const micKey = `${prefs.deviceId}|${prefs.noise}|${prefs.agc}`;
  const lastMicKey = useRef(micKey);
  useEffect(() => {
    if (lastMicKey.current === micKey) return;
    lastMicKey.current = micKey;
    if (!streamRef.current || phaseRef.current !== "idle") return;
    closeMic();
    openMic().catch((e) => setMicMessage((e as Error).message));
  }, [micKey, closeMic, openMic]);

  // «Усиление» applies at once, also during a take
  useEffect(() => {
    const g = graphRef.current?.gain;
    const ctx = ctxRef.current;
    if (g && ctx) g.gain.setTargetAtTime(prefs.gain, ctx.currentTime, 0.02);
  }, [prefs.gain, micOn]);

  // ---- recording over the video

  const upload = useCallback(
    async (key: string, blob: Blob, meta: Meta) => {
      setPhase("saving");
      setError("");
      try {
        const q = new URLSearchParams({
          videoStart: meta.videoStart.toFixed(3),
          latencyMs: String(meta.latencyMs),
          lineStart: String(meta.lineStart),
          lineEnd: String(meta.lineEnd),
          videoAt: meta.videoAt,
        });
        let res: Response;
        try {
          res = await fetch(`/api/3d/${id}/dub/${key}?${q}`, { method: "PUT", body: blob, headers: { "Content-Type": blob.type || "application/octet-stream" } });
        } catch {
          throw new ApiError("Сервер не отвечает — запись не сохранилась", 0);
        }
        const data = await res.json().catch(() => null);
        if (!res.ok) throw new ApiError(data?.error ?? `Ошибка ${res.status}`, res.status);
        setProject(data as ProjectView);
        setRetry(null);
      } catch (e) {
        const err = e as ApiError;
        setError(err.message);
        // the network or the server failed, not the take: it can be sent again as is
        setRetry(err.status === 0 || err.status >= 500 ? { key, blob, meta } : null);
        if (err.status === 409) void load();
      } finally {
        setPhase("idle");
      }
    },
    [id, load],
  );

  /** Draws the frame the video stands on into the still over it, at the size it is shown (not the full 1080×1920). */
  const showStill = useCallback((v: HTMLVideoElement) => {
    const c = stillRef.current;
    if (!c || !v.videoWidth || !v.videoHeight) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const scale = Math.min(1, ((v.clientHeight || v.videoHeight) * dpr) / v.videoHeight);
    c.width = Math.max(1, Math.round(v.videoWidth * scale));
    c.height = Math.max(1, Math.round(v.videoHeight * scale));
    try {
      c.getContext("2d")?.drawImage(v, 0, 0, c.width, c.height);
      setStill(true);
    } catch {
      // no still: the video itself shows where the take starts, which is fine too
    }
  }, []);

  /**
   * 3 and 2 over the held frame, COUNT_STEP_MS each, with a soft tick; «1» is the run-up, shown once the recorder runs
   * (no tick there: it would be recorded). False when the take was called off meanwhile; a take of another press
   * (alive() false) is left alone, its numbers are not ours to clear.
   */
  const countIn = useCallback(async (alive: () => boolean): Promise<boolean> => {
    if (!alive() || phaseNow() !== "opening") return false;
    setPhase("count");
    for (let n = COUNT_FROM; n >= 2; n--) {
      if (!alive()) return false;
      if (phaseNow() !== "count") {
        setCount(0);
        return false;
      }
      setCount(n);
      tick(ctxRef.current);
      await new Promise((r) => setTimeout(r, COUNT_STEP_MS));
    }
    if (!alive()) return false;
    if (phaseNow() === "count") return true;
    setCount(0);
    return false;
  }, []);

  const record = useCallback(async () => {
    const l = lineRef.current;
    const info = videoInfoRef.current;
    const v = videoRef.current;
    if (phaseRef.current !== "idle" || !l || l.who !== "me" || !l.window || !info || !v || lockedRef.current) return;
    // busy before the first await: a second press (Space, a double click) while the mic opens does nothing
    setPhase("opening");
    const attempt = ++attemptRef.current;
    setError("");
    setNotice("");
    setRetry(null);
    setLatencyOpen(false);
    stopPlayback();
    unlockVideo();
    // the owner speaks watching the video: a page scrolled down to the button brings it back into view
    const r = v.getBoundingClientRect();
    if (r.top < 0 || r.bottom > window.innerHeight) v.scrollIntoView({ block: "start" });
    let stream: MediaStream;
    try {
      stream = await openMic();
    } catch (e) {
      if (disposedRef.current) return;
      setMicMessage((e as Error).message);
      if (attemptRef.current === attempt && phaseNow() === "opening") setPhase("idle");
      return;
    }
    const current = () => !disposedRef.current && attemptRef.current === attempt;
    if (!current() || phaseNow() !== "opening") return;

    const mime = pickMime();
    let rec: MediaRecorder;
    try {
      rec = new MediaRecorder(graphRef.current?.dest.stream ?? stream, mime ? { mimeType: mime, audioBitsPerSecond: 128_000 } : undefined);
    } catch (e) {
      setPhase("idle");
      setError(`Браузер не смог начать запись: ${(e as Error).message}`);
      return;
    }
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data);
    };
    rec.onerror = () => {
      discardRef.current = true;
      setError("Браузер прервал запись — запишите ещё раз.");
      sessionRef.current?.stop();
    };
    const stopped = new Promise<void>((r) => rec.addEventListener("stop", () => r(), { once: true }));

    const w = l.window;
    let recAt = 0;
    let reached = 0;
    let lastStage: RecStage = "pre";
    let stalled = false;
    /** The mic's loudest in the run-up before the part a dub keeps, and over the line (amplitudes, see EARLY_GAP). */
    let early = 0;
    let loud = 0;
    /**
     * Each frame's estimate of the video time at the take's first sample. The median of the first frames is the
     * answer; the last ones must agree with it (takeSlip), or the video paused under the recorder somewhere.
     */
    const estimates: number[] = [];
    discardRef.current = false;
    const session = runWindow(l, "rec", {
      still: showStill,
      countIn: () => countIn(current),
      beforePlay: () => {
        if (!current() || phaseRef.current !== "count") return false;
        // the recorder starts only now: the count-in and its ticks stay out of the take
        rec.start(250);
        recAt = performance.now();
        recorderRef.current = rec;
        peakRef.current = 0;
        setStill(false);
        setPhase("recording");
        setStage("pre");
        // «1» over the run-up: the video moves towards the line, the next beat is the line itself
        setCount(1);
        return true;
      },
      onFrame: (mediaTime, shownAt) => {
        estimates.push(mediaTime + (recAt - shownAt) / 1000);
      },
      onTime: (t) => {
        reached = t;
        const peak = peakRef.current;
        peakRef.current = 0;
        if (t < w.start - EARLY_GAP) early = Math.max(early, peak);
        else if (t <= w.end) loud = Math.max(loud, peak);
        const next: RecStage = t < w.start ? "pre" : t <= w.end ? "speak" : "tail";
        if (next !== lastStage) {
          if (lastStage === "pre") setCount(0);
          lastStage = next;
          setStage(next);
        }
      },
      onLoading: setLoadingVideo,
      onStall: () => {
        // the take is lost already: stop at once instead of letting the owner finish it for nothing
        stalled = true;
        sessionRef.current?.stop();
      },
    });
    if (!session) {
      setPhase("idle");
      return;
    }
    const end = await session.done;
    if (current()) {
      setStill(false);
      setCount(0);
    }
    recorderRef.current = null;
    if (rec.state !== "inactive") {
      rec.stop();
      await stopped;
    }
    if (disposedRef.current) return;
    if (discardRef.current || !recAt) {
      if (phaseNow() !== "saving") setPhase("idle");
      return;
    }
    if (end === "failed") {
      setPhase("idle");
      setError("Ролик не проигрался — запишите ещё раз.");
      return;
    }
    const slip = takeSlip(estimates);
    if (stalled || slip > MAX_TAKE_SLIP) {
      setPhase("idle");
      setError("Ролик подтормозил во время записи — дубль не совпал бы с видео и не сохранён. Запишите ещё раз.");
      return;
    }
    // only the whole line is a take: stopped by hand before its end, the rest of it would be silent in the dub
    if (end === "stopped" && reached < w.end) {
      setPhase("idle");
      setNotice(
        reached < w.start
          ? "Остановлено до начала реплики — дубль не сохранён."
          : "Остановлено до конца реплики — дубль не сохранён.",
      );
      return;
    }
    const at = median(estimates.slice(0, SYNC_FRAMES));
    const blob = new Blob(chunks, { type: rec.mimeType || mime || "audio/webm" });
    if (!Number.isFinite(at) || !blob.size) {
      setPhase("idle");
      setError("Браузер не сохранил звук или кадры ролика — запишите ещё раз.");
      return;
    }
    // kept, but the owner should hear it: a dub would cut what he said before the line
    if (early >= EARLY_MIN && early >= loud * EARLY_SHARE) {
      setNotice("Начало могло обрезаться — послушайте «Моя озвучка».");
    }
    const latencyMs = prefsRef.current.latencyMs;
    await upload(l.key, blob, { videoStart: at - latencyMs / 1000, latencyMs, lineStart: w.start, lineEnd: w.end, videoAt: info.at });
  }, [countIn, openMic, runWindow, showStill, stopPlayback, unlockVideo, upload]);

  /** Nothing was recorded yet: the take just stops, the frame and the numbers go away. */
  const callOff = useCallback(() => {
    setPhase("idle");
    sessionRef.current?.stop();
    setStill(false);
    setCount(0);
  }, []);

  /** Space and the big button: start, stop and save — or, during the count-in, call the take off. */
  const toggle = useCallback(() => {
    const p = phaseRef.current;
    if (p === "idle") void record();
    else if (p === "count") callOff();
    else if (p === "recording") sessionRef.current?.stop();
  }, [callOff, record]);

  const cancel = useCallback(() => {
    const p = phaseRef.current;
    // the mic keeps opening (its prompt may be up), but no take starts after it; a wait for the video ends now
    if (p === "opening" || p === "count") callOff();
    else if (p === "recording") {
      discardRef.current = true;
      sessionRef.current?.stop();
      setPhase("idle");
    } else {
      stopPlayback();
      setLatencyOpen(false);
    }
  }, [callOff, stopPlayback]);

  // a take cut by a call or a tab switch is not one to keep
  useEffect(() => {
    const onHidden = () => {
      if (!document.hidden) return;
      if (phaseRef.current === "opening" || phaseRef.current === "count") callOff();
      else if (phaseRef.current === "recording") {
        discardRef.current = true;
        sessionRef.current?.stop();
        setPhase("idle");
        setError("Запись остановлена: страница ушла в фон. Запишите дубль ещё раз.");
      } else stopPlayback();
    };
    document.addEventListener("visibilitychange", onHidden);
    return () => document.removeEventListener("visibilitychange", onHidden);
  }, [callOff, stopPlayback]);

  useEffect(() => {
    if (phase !== "recording" && phase !== "saving") return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [phase]);

  // leaving the page (also by client navigation) stops and releases everything
  useEffect(() => {
    disposedRef.current = false;
    return () => {
      disposedRef.current = true;
      discardRef.current = true;
      sessionRef.current?.stop();
      const rec = recorderRef.current;
      if (rec && rec.state !== "inactive") rec.stop();
      closeMic();
      void ctxRef.current?.close().catch(() => {});
      ctxRef.current = null;
      // the downloaded video and decoded takes are worth keeping only while the page is open
      BLOBS.clear();
      DECODED.clear();
    };
  }, [closeMic]);

  // ---- moving between lines

  const go = useCallback(
    (to: number | undefined) => {
      if (to === undefined || phaseRef.current !== "idle") return;
      if (to < 0 || to >= lines.length) return;
      stopPlayback();
      setSel(to);
      setError("");
      setNotice("");
      setRetry(null);
    },
    [lines.length, stopPlayback],
  );
  const nextOwn = ownOrder.find((i) => i > sel);
  const prevOwn = [...ownOrder].reverse().find((i) => i < sel);

  // ---- the video downloaded once (see videoBlob): the player moves to it between takes

  useEffect(() => {
    if (!videoSrc) return;
    let off = false;
    let url = "";
    videoBlob(videoSrc)
      .then((blob) => {
        if (off) return;
        url = URL.createObjectURL(blob);
        setLocal({ of: videoSrc, url });
      })
      .catch(() => {});
    return () => {
      off = true;
      // a new video comes with a new player element: nothing plays this URL any more
      if (url) URL.revokeObjectURL(url);
    };
  }, [videoSrc]);
  const localUrl = local && local.of === videoSrc ? local.url : "";
  useEffect(() => {
    if (!localUrl || switched === localUrl || phase !== "idle" || playing || sessionRef.current) return;
    setSwitched(localUrl);
  }, [localUrl, switched, phase, playing]);
  const playerSrc = localUrl && switched === localUrl ? localUrl : videoSrc;

  // the video shows the frame where the line starts (a number, not the window object: polls bring new objects)
  const lineStart = line?.window?.start;
  useEffect(() => {
    const v = videoRef.current;
    if (!v || lineStart === undefined || sessionRef.current || phaseRef.current !== "idle") return;
    v.currentTime = Math.min(lineStart + 0.04, Math.max(0, (video?.duration ?? 0) - 0.05));
  }, [lineStart, video?.duration, video?.at, playerSrc]);

  // the current card stays in view; only the strip scrolls, never the page
  useEffect(() => {
    const strip = stripRef.current;
    const card = strip?.querySelector<HTMLElement>(`[data-index="${sel}"]`);
    if (!strip || !card) return;
    const left = card.offsetLeft - (strip.clientWidth - card.offsetWidth) / 2;
    strip.scrollTo({ left: Math.max(0, left), behavior: "smooth" });
  }, [sel, lines.length]);

  // ---- listening

  const listen = useCallback(
    async (which: "orig" | "mine") => {
      const l = lineRef.current;
      if (phaseRef.current !== "idle" || !l?.window) return;
      if (playing === which) return stopPlayback();
      unlockVideo();
      const ctx = which === "mine" ? primeAudio() : null;
      setError("");
      let take: Hooks["take"];
      if (which === "mine") {
        const t = l.take;
        if (!t || l.status !== "recorded" || !ctx) return;
        const url = takeUrl(t);
        try {
          let buffer = takeBuffers.current.get(url);
          if (!buffer) {
            buffer = await decode(url, 48000);
            takeBuffers.current.set(url, buffer);
          }
          take = { buffer, videoStart: placeTake(t, l.window).videoStart };
        } catch {
          setError("Запись не проигрывается в этом браузере");
          return;
        }
        if (phaseRef.current !== "idle" || lineRef.current !== l) return;
      }
      stopPlayback();
      const session = runWindow(l, which, { take });
      if (!session) return;
      setPlaying(which);
      const end = await session.done;
      setPlaying((p) => (p === which ? null : p));
      if (end === "failed") setError("Ролик не проигрывается — обновите страницу");
    },
    [playing, primeAudio, runWindow, stopPlayback, takeUrl, unlockVideo],
  );

  const keys = useRef({ toggle, cancel, go, listen, sel, nextOwn, prevOwn });
  keys.current = { toggle, cancel, go, listen, sel, nextOwn, prevOwn };
  useEffect(() => {
    const isSpace = (e: KeyboardEvent) => e.code === "Space" || e.key === " ";
    const down = (e: KeyboardEvent) => {
      if (inField(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      const k = keys.current;
      // a focused slider keeps its arrows
      const slider = e.target instanceof HTMLInputElement && e.target.type === "range";
      if (isSpace(e)) {
        // also on a focused button or switch: Space must record, not press or flip it (keyup is held back below)
        e.preventDefault();
        if (!e.repeat) k.toggle();
      } else if (e.key === "Escape") k.cancel();
      else if ((e.key === "Enter" && !(e.target instanceof HTMLButtonElement || e.target instanceof HTMLAnchorElement)) || (e.key === "ArrowRight" && !slider)) {
        e.preventDefault();
        k.go(k.nextOwn);
      } else if (e.key === "ArrowLeft" && !slider) {
        e.preventDefault();
        k.go(k.prevOwn);
      } else if (e.code === "KeyP" && !e.repeat) void k.listen("orig");
      else if (e.code === "KeyM" && !e.repeat) void k.listen("mine");
    };
    const up = (e: KeyboardEvent) => {
      if (isSpace(e) && !inField(e.target)) e.preventDefault();
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  // the latency popover closes on a click elsewhere
  useEffect(() => {
    if (!latencyOpen) return;
    const away = (e: PointerEvent) => {
      if (!latencyRef.current?.contains(e.target as Node)) setLatencyOpen(false);
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [latencyOpen]);

  // ---- jobs from this page

  /** The project with the new job, or null when it did not start (the reason is on the page). */
  async function start(task: JobTask): Promise<ProjectView | null> {
    if (starting || live) return null;
    // «Пересобрать ролик» makes new timing: his dubbed video and his takes over it would be gone without a word
    const warning = task === "montage" && project ? montageWarning(project) : null;
    if (warning && !(await confirm({ title: "Пересобрать ролик?", text: warning, action: "Пересобрать", danger: true }))) return null;
    // only after a failed refine: the dub may measure the windows from the sound itself, and his takes then stay behind
    if (task === "dub" && project && letterWindows(project)) {
      const text =
        `Реплики размечены по буквам. Сборка может уточнить разметку по звуку — тогда записанное (${progress?.recorded ?? 0}) ` +
        "не подойдёт к новому ролику, и чтобы потом поправить одну реплику, придётся перезаписать все.";
      if (!(await confirm({ title: "Собрать по старой разметке?", text, action: "Собрать" }))) return null;
    }
    setStarting(task);
    setError("");
    try {
      const view = await api<ProjectView>(`/api/3d/${id}/run`, { method: "POST", json: { task } });
      setProject(view);
      return view;
    } catch (e) {
      setError((e as Error).message);
      void load();
      return null;
    } finally {
      setStarting("");
    }
  }

  /**
   * Windows from the letter timings miss a performed [gasps] before the words and the tail of the last word: the
   * runner measures them anew from the sound of the montage (a "voice" job, the video stays as it is). Takes over the
   * old windows go stale, so the owner is asked first when he has any. Its outcome is told by the refine card
   * (refineFailed), from the project itself, so a reload keeps it.
   */
  async function refine() {
    const fitting = progress?.recorded ?? 0;
    const text = `Окна реплик станут точнее, а записанное по старой разметке (${fitting}) придётся перезаписать — старые дубли не удалятся, будут помечены «устарело».`;
    if (fitting && !(await confirm({ title: "Уточнить разметку?", text, action: "Уточнить" }))) return;
    await start("voice");
  }

  /** «Повторить» in the job panel: a "voice" job here is the windows' measurement, its outcome is told the same way. */
  const retryJob = (task: JobTask) => void (task === "voice" ? refine() : start(task));

  async function cancelQueued() {
    try {
      setProject(await api<ProjectView>(`/api/3d/${id}/run`, { method: "DELETE" }));
    } catch (e) {
      setError((e as Error).message);
      void load();
    }
  }

  // ---- the waveform: the video's own sound of the window, the take under it

  useEffect(() => {
    if (!videoSrc || !video) return;
    let off = false;
    setWave({ status: "loading" });
    videoPeaks(videoSrc)
      .then((peaks) => !off && setWave({ status: "ready", peaks }))
      .catch(async () => {
        // the video did not decode here: the synthesized lines at their places say enough about the sound
        const clips = lines.flatMap((l) => {
          const c = l.window && l.spoken ? clipFor(project?.clips, l) : null;
          return c && l.window ? [{ at: l.window.start, url: `/api/3d/${id}/clip/${c.key}?v=${encodeURIComponent(c.at)}` }] : [];
        });
        const data = new Float32Array(Math.ceil(video.duration * PEAKS_RATE) + 1);
        let any = false;
        for (const c of clips) {
          try {
            const p = peaksOf(await decode(c.url, 22050));
            const at = Math.round(c.at * PEAKS_RATE);
            for (let i = 0; i < p.data.length && at + i < data.length; i++) data[at + i] = Math.max(data[at + i], p.data[i]);
            any = true;
          } catch {}
        }
        if (!off) setWave(any ? { status: "ready", peaks: { rate: PEAKS_RATE, data } } : { status: "failed" });
      });
    return () => {
      off = true;
    };
    // the clips matter only for the fallback, which runs once per video
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoSrc]);

  // a re-recorded take replaces the one before it: the old one's decoded sound goes too (phones keep little memory)
  const takeUrls = lines.flatMap((l) => (l.who === "me" && l.take ? [takeUrl(l.take)] : [])).join("\n");
  useEffect(() => {
    const keep = new Set(takeUrls.split("\n").filter(Boolean));
    const prefix = "48000|";
    for (const k of [...DECODED.keys()]) if (k.startsWith(prefix) && !keep.has(k.slice(prefix.length))) DECODED.delete(k);
    for (const k of [...takeBuffers.current.keys()]) if (!keep.has(k)) takeBuffers.current.delete(k);
    setTakePeaks((m) => (Object.keys(m).every((k) => keep.has(k)) ? m : Object.fromEntries(Object.entries(m).filter(([k]) => keep.has(k)))));
  }, [takeUrls]);

  // the current take's waveform, once per take
  const take = own ? (line?.take ?? null) : null;
  const takeKey = take && fitted ? takeUrl(take) : "";
  useEffect(() => {
    if (!takeKey || takePeaks[takeKey]) return;
    let off = false;
    decode(takeKey, 48000)
      .then((buf) => {
        takeBuffers.current.set(takeKey, buf);
        if (!off) setTakePeaks((m) => ({ ...m, [takeKey]: peaksOf(buf) }));
      })
      .catch(() => {});
    return () => {
      off = true;
    };
  }, [takeKey, takePeaks]);

  useEffect(() => {
    if (!waveBox) return;
    setWaveWidth(waveBox.clientWidth);
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setWaveWidth(waveBox.clientWidth));
    ro.observe(waveBox);
    return () => ro.disconnect();
  }, [waveBox]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !line?.window || !video || !waveWidth) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const cssH = canvas.clientHeight || 96;
    canvas.width = Math.round(waveWidth * dpr);
    canvas.height = Math.round(cssH * dpr);
    const g = canvas.getContext("2d");
    if (!g) return;
    const W = canvas.width;
    const H = canvas.height;
    g.clearRect(0, 0, W, H);
    const css = getComputedStyle(canvas);
    const color = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
    const dim = color("--wave-dim", "#6b6d78");
    // the selected line in its speaker's colour: Claude's lines are only listened to here
    const lineColor = line.who === "me" ? color("--accent", "#c0b4ff") : color("--claude", "#e39a62");
    const takeColor = color("--success", "#7fd8a4");
    const lw = line.window;
    const { from, to } = dubSpan(lw, video.duration);
    const spanS = to - from;
    const takeP = takeKey ? takePeaks[takeKey] : undefined;
    const split = Boolean(takeP && fitted);
    const mid = split ? H * 0.5 : H / 2;
    // the line itself is bright (that is what goes into the video), the run-up before it and the tail after it are shaded
    const inLine = (t: number) => t >= lw.start && t <= lw.end;
    const column = (p: Peaks, t0: number, t1: number) => {
      // before the video starts (the lead-in of a line at the start) there is no sound
      if (t1 <= 0) return 0;
      const a = Math.max(0, Math.floor(t0 * p.rate));
      const b = Math.min(p.data.length, Math.max(a + 1, Math.ceil(t1 * p.rate)));
      let m = 0;
      for (let i = a; i < b; i++) if (p.data[i] > m) m = p.data[i];
      return m;
    };
    const step = Math.max(1, Math.round(2 * dpr));
    const bar = Math.max(1, step - Math.round(dpr));
    if (wave.status === "ready") {
      let top = 0.05;
      for (let x = 0; x < W; x += step) top = Math.max(top, column(wave.peaks, from + (x / W) * spanS, from + ((x + step) / W) * spanS));
      for (let x = 0; x < W; x += step) {
        const t0 = from + (x / W) * spanS;
        const amp = column(wave.peaks, t0, from + ((x + step) / W) * spanS) / top;
        const h = Math.max(dpr, amp * (split ? mid - 2 * dpr : H / 2 - 2 * dpr));
        const inside = inLine(t0 + spanS / W);
        g.fillStyle = inside ? lineColor : dim;
        g.globalAlpha = inside ? 0.95 : 0.4;
        if (split) g.fillRect(x, mid - h, bar, h);
        else g.fillRect(x, mid - h, bar, h * 2);
      }
    }
    if (split && takeP && fitted) {
      let top = 0.05;
      for (const v of takeP.data) if (v > top) top = v;
      g.fillStyle = takeColor;
      // his take at its place on the video: under the line bright, the run-up and the tail it caught shaded
      for (let x = 0; x < W; x += step) {
        const t0 = from + (x / W) * spanS - fitted.videoStart;
        const t1 = from + ((x + step) / W) * spanS - fitted.videoStart;
        if (t1 <= 0 || t0 >= takeP.data.length / takeP.rate) continue;
        const h = Math.max(dpr, (column(takeP, Math.max(0, t0), t1) / top) * (H - mid - 2 * dpr));
        g.globalAlpha = inLine(from + ((x + step / 2) / W) * spanS) ? 0.95 : 0.4;
        g.fillRect(x, mid, bar, h);
      }
    }
    g.globalAlpha = 1;
  }, [line, video, wave, takePeaks, takeKey, fitted, waveWidth]);

  // ---- frames for the cards: a hidden video over the downloaded file (no second download), seeked to each line

  const windowsKey = lines.map((l) => (l.window ? `${l.index}:${l.window.start}` : "")).join(",");
  useEffect(() => {
    if (!localUrl || !video || !windowsKey.replace(/,/g, "")) return;
    let off = false;
    setThumbs({});
    const v = document.createElement("video");
    v.muted = true;
    v.playsInline = true;
    v.preload = "auto";
    // Safari decodes frames only for an element in the document
    v.style.cssText = "position:fixed;left:-10000px;top:0;width:4px;height:4px;opacity:0;pointer-events:none";
    v.setAttribute("aria-hidden", "true");
    v.src = localUrl;
    document.body.appendChild(v);
    const targets = lines.filter((l) => l.window).map((l) => ({ index: l.index, at: Math.min(l.window!.start + 0.1, Math.max(0, video.duration - 0.05)) }));
    void (async () => {
      // a muted play lets iPhone load the video at all; it stops at once
      await v.play().catch(() => {});
      v.pause();
      if (v.readyState < 2) await once(v, "loadeddata", 15_000);
      const c = document.createElement("canvas");
      c.width = 108;
      c.height = Math.round(108 * ((v.videoHeight || 16) / (v.videoWidth || 9)));
      const g = c.getContext("2d");
      if (!g) return;
      for (const t of targets) {
        if (off) return;
        v.currentTime = t.at;
        await once(v, "seeked", 6000);
        if (off) return;
        g.drawImage(v, 0, 0, c.width, c.height);
        const url = c.toDataURL("image/jpeg", 0.72);
        setThumbs((m) => ({ ...m, [t.index]: url }));
      }
    })()
      .catch(() => {})
      .finally(() => {
        v.removeAttribute("src");
        v.load();
        v.remove();
      });
    return () => {
      off = true;
    };
    // windowsKey stands for the lines' places
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localUrl, windowsKey]);

  // ---- render

  if (loadError && !project) {
    return (
      <main className={s.page}>
        <Link href={`/3d/${id}`} className="back-link">
          ← К скетчу
        </Link>
        {loadError.status === 401 ? (
          <div className="warn-box" role="alert">
            Нужен вход на сайт.{" "}
            <a className="link-btn" href={`/login?next=/3d/${id}/voice`}>
              Войти
            </a>
          </div>
        ) : (
          <div className="error-box plain" role="alert">
            <strong>{loadError.status === 404 || loadError.status === 400 ? "Скетч не найден." : "Не удалось загрузить скетч."}</strong>{" "}
            {loadError.status !== 404 && loadError.status !== 400 && (
              <button type="button" className="link-btn" onClick={() => void load()}>
                Повторить
              </button>
            )}
          </div>
        )}
      </main>
    );
  }
  if (!project) {
    return (
      <main className={s.page}>
        <Link href={`/3d/${id}`} className="back-link">
          ← К скетчу
        </Link>
        <div className="skeleton" style={{ height: 420 }} />
      </main>
    );
  }

  const busyPhase = phase !== "idle";
  const canAssemble = !live && !busyPhase && !starting && progress !== null && !progress.problem;
  const canRecord = Boolean(own && line?.window && video && !recordClosed) && (phase === "idle" || phase === "count" || phase === "recording");
  const ownTotal = lines.filter((l) => l.who === "me").length;
  const w = line?.window ?? null;
  const geo = w && video ? dubSpan(w, video.duration) : null;
  const pct = (t: number) => (geo ? clamp((t - geo.from) / (geo.to - geo.from), 0, 1) * 100 : 0);

  // only what keeps a take from being right: the count, «Говорите!» and the button say the rest
  let warn = "";
  if (takesLocked)
    warn =
      job?.task === "dub"
        ? "Идёт сборка с твоим голосом — записывать можно после неё."
        : job?.task === "voice"
          ? "Уточняем разметку реплик — записывать можно после неё."
          : "Идёт монтаж — записывать можно после него.";
  else if (line && own && !w) warn = "Этой реплики нет в разметке ролика — пересоберите ролик.";
  else if (phase === "idle" && waitRefine) warn = "Сначала уточните разметку реплик (выше).";
  else if (phase === "idle" && line && own && retimed(line, video)) warn = "Разметка ролика уточнена после записи — перезапишите реплику.";
  else if (phase === "idle" && line && own && line.status === "stale") warn = "Запись сделана для прежнего ролика или прежних слов — перезапишите реплику.";

  const recLabel =
    phase === "opening"
      ? loadingVideo
        ? "Загрузка…"
        : "Микрофон…"
      : phase === "count"
        ? "Отмена"
        : phase === "recording"
          ? "Стоп"
          : phase === "saving"
            ? "Сохраняем…"
            : line?.take && own
              ? "Перезаписать"
              : "Записать";

  // what stands between the owner and dubbing
  let blocker: ReactNode = null;
  if (!project.script || !ownTotal) {
    blocker = (
      <div className="warn-box">
        В сценарии нет твоих реплик — озвучивать нечего.{" "}
        <Link className="link-btn" href={`/3d/${id}`}>
          Вернуться к скетчу
        </Link>
      </div>
    );
  } else if (!video) {
    blocker = (
      <div className="warn-box">
        Сначала нужен ролик: смонтируйте его на{" "}
        <Link className="link-btn" href={`/3d/${id}`}>
          странице скетча
        </Link>
        , потом озвучивайте свои реплики поверх него.
      </div>
    );
  } else if (videoStale) {
    blocker = (
      <section className={`card ${d.panel}`}>
        <h2>Сценарий изменён после монтажа</h2>
        <p className="hint">Озвучивать можно только ролик по текущему сценарию. Пересоберите его — потом запишите свои реплики поверх.</p>
        <button type="button" className="btn" disabled={live || Boolean(starting)} onClick={() => void start("montage")}>
          {starting === "montage" && <span className="spin" aria-hidden="true" />}
          Пересобрать ролик
        </button>
      </section>
    );
  } else if (!hasWindows) {
    const triedVoice = job?.task === "voice" && job.state === "done" && Date.parse(job.finishedAt ?? "") > Date.parse(video.at);
    blocker = (
      <section className={`card ${d.panel}`}>
        <h2>Нужна разметка реплик</h2>
        {triedVoice ? (
          <>
            <p className="hint">Исполнитель не нашёл монтаж этого ролика. Пересоберите ролик — разметка появится вместе с ним.</p>
            <button type="button" className="btn" disabled={live || Boolean(starting)} onClick={() => void start("montage")}>
              {starting === "montage" && <span className="spin" aria-hidden="true" />}
              Пересобрать ролик
            </button>
          </>
        ) : (
          <>
            <p className="hint">
              Ролик смонтирован до того, как сайт стал запоминать, где звучит каждая реплика. Исполнитель возьмёт разметку из папки монтажа, если она ещё там.
            </p>
            <div className="row">
              <button type="button" className="btn" disabled={live || Boolean(starting)} onClick={() => void start("voice")}>
                {starting === "voice" && <span className="spin" aria-hidden="true" />}
                Разметить реплики
              </button>
              <button type="button" className="btn btn-secondary" disabled={live || Boolean(starting)} onClick={() => void start("montage")}>
                {starting === "montage" && <span className="spin" aria-hidden="true" />}
                Пересобрать ролик
              </button>
            </div>
          </>
        )}
      </section>
    );
  }

  // here a "voice" job only brings the line windows: once they are in (and new), its cue errors belong to the sketch page
  const voiceMatters = !videoStale && (!hasWindows || refineFailed);
  const showJob = job && (live || job.lost || (job.state === "error" && (job.task === "dub" || job.task === "montage" || (job.task === "voice" && voiceMatters))));
  const dubDone = job?.task === "dub" && job.state === "done" && video?.ownVoice && video.dubVersion === project.dub?.version;

  return (
    <main className={`${s.page} ${d.dubPage}`}>
      <div className={d.top}>
        <Link href={`/3d/${id}`} className="back-link">
          ← К скетчу
        </Link>
        <div className={d.titleBox}>
          <h1 className="page-title">Озвучка</h1>
          <div className={d.sub}>{projectTitle(project)}</div>
        </div>
        <button
          type="button"
          className={`btn ${d.assembleTop}`}
          disabled={!canAssemble}
          title={progress?.problem ? cap(progress.problem) : undefined}
          onClick={() => void start("dub")}
        >
          {starting === "dub" && <span className="spin" aria-hidden="true" />}
          Собрать с моим голосом
        </button>
      </div>

      {showJob && job && (
        <section className={`card ${s.jobPanel}`} aria-live="polite">
          {job.lost ? (
            <div className="warn-box">
              Исполнитель 3Д не отвечал больше 10 минут — задача «{TASK_LABEL[job.task]}» не закончена.
              <div className="actions">
                <button type="button" className="btn btn-sm" disabled={Boolean(starting)} onClick={() => retryJob(job.task)}>
                  Повторить
                </button>
              </div>
            </div>
          ) : job.state === "error" ? (
            <div className="error-box">
              {job.error || "Задача не удалась"}
              <div className="actions">
                <button type="button" className="btn btn-sm" disabled={Boolean(starting)} onClick={() => retryJob(job.task)}>
                  Повторить
                </button>
              </div>
            </div>
          ) : job.state === "queued" ? (
            <div className={s.jobRow}>
              <span className="spin" aria-hidden="true" />
              <span className={s.jobText}>В очереди: {job.task === "voice" ? "разметка реплик" : TASK_LABEL[job.task]}</span>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => void cancelQueued()}>
                Отменить
              </button>
            </div>
          ) : (
            <>
              <div className={s.jobRow}>
                <strong className={s.jobText}>
                  {job.task === "dub" ? "Собираем ролик с твоим голосом" : job.task === "montage" ? "Монтаж ролика" : job.task === "voice" ? "Размечаем реплики" : cap(TASK_LABEL[job.task])}
                </strong>
                <span className={s.percent}>{job.progress}%</span>
              </div>
              <div className="progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={job.progress} aria-label="Готовность задачи">
                <div className="progress-fill" style={{ width: `${Math.max(2, job.progress)}%` }} />
              </div>
              <div className="hint">{job.step}</div>
            </>
          )}
        </section>
      )}
      {dubDone && !live && (
        <div className={d.doneBox} role="status">
          Ролик собран с твоим голосом.{" "}
          <Link className="link-btn" href={`/3d/${id}`}>
            Посмотреть и опубликовать
          </Link>
        </div>
      )}

      {blocker}

      {!blocker && oldWindows && !(live && job?.task === "voice") && (
        <section className={`card ${d.panel} ${d.refine}`} aria-labelledby="dub-refine">
          <h2 id="dub-refine">Уточните разметку реплик</h2>
          {refineFailed ? (
            <>
              <p className="hint">
                {job?.state === "error"
                  ? "Разметка осталась по буквам: задача не удалась — повторите её выше. Если не поможет, пересоберите ролик."
                  : "Разметка осталась по буквам: исполнитель не смог найти реплики по звуку в монтаже этого ролика. Точно разметит пересборка — сцена соберётся заново."}{" "}
                Записывать можно и так, но вздох перед словами может обрезаться.
              </p>
              <button type="button" className="btn" disabled={live || Boolean(starting)} onClick={() => void start("montage")}>
                {starting === "montage" && <span className="spin" aria-hidden="true" />}
                Пересобрать ролик
              </button>
            </>
          ) : (
            <>
              <p className="hint">
                Реплики размечены по буквам: вздох перед словами и конец последнего слова в окно не попадают и обрезались бы. Исполнитель найдёт реплики по звуку —
                ролик останется тем же, а запись и сборка откроются после этого.
              </p>
              <p className="hint">
                Обычно это бесплатно: реплики уже озвучены при монтаже. Если с тех пор сменились голоса, исполнитель сначала озвучит реплики заново в ElevenLabs — это
                платно.
              </p>
              <button type="button" className="btn" disabled={live || Boolean(starting)} onClick={() => void refine()}>
                {starting === "voice" && <span className="spin" aria-hidden="true" />}
                Уточнить разметку
              </button>
            </>
          )}
        </section>
      )}

      {!blocker && line && video && (
        <section className={`card ${d.studio}`} aria-label="Озвучка реплики">
          <div className={d.videoBox}>
            <div className={d.screen} data-phase={phase}>
              <video
                key={video.at}
                ref={videoRef}
                className={d.video}
                src={playerSrc}
                playsInline
                preload="auto"
                onClick={() => void listen("orig")}
                aria-label="Ролик: нажмите, чтобы послушать оригинал реплики"
              />
              {/* the line's first frame, held while the count-in runs and the video waits at the run-up */}
              <canvas ref={stillRef} className={d.still} hidden={!still} aria-hidden="true" />
              {(phase === "count" || phase === "recording") && count > 0 && (
                // «1» comes over the moving run-up: the picture stays undimmed, the owner watches the lips
                <div className={d.countIn} data-run={phase === "recording"} aria-hidden="true">
                  <span key={count}>{count}</span>
                </div>
              )}
              {phase === "recording" && stage === "speak" && (
                <div className={d.go} aria-hidden="true">
                  <span>Говорите!</span>
                </div>
              )}
              {phase === "recording" && (
                <div className={d.recBadge} data-stage={stage} aria-hidden="true">
                  <i /> {stage === "speak" ? "Говорите" : "Запись"}
                </div>
              )}
            </div>
          </div>

          <div className={d.lineRow}>
            <div className={d.lineMain}>
              <div className={d.lineNo} data-who={line.who}>
                #{line.index + 1} {CAST_LABEL[line.who].toUpperCase()}
                {line.status && (
                  <span className={d.badge} data-status={line.status}>
                    {STATUS_LABEL[line.status]}
                  </span>
                )}
              </div>
              <p className={d.lineText} id="dub-line">
                <LineText text={line.text} />
              </p>
            </div>
            <div className={d.nav}>
              <button type="button" className="btn btn-secondary" aria-label="Предыдущая реплика" disabled={prevOwn === undefined || busyPhase} onClick={() => go(prevOwn)}>
                <Arrow left />
              </button>
              <button type="button" className={`btn ${line.status === "recorded" ? "" : "btn-secondary"}`} disabled={nextOwn === undefined || busyPhase} onClick={() => go(nextOwn)}>
                Следующий <Arrow />
              </button>
            </div>
          </div>

          <div className={d.wave} ref={setWaveBox} aria-hidden="true">
            <canvas ref={canvasRef} className={d.waveCanvas} />
            {geo && w && (
              <>
                {w.start > geo.from + 0.01 && <div className={`${d.zone} ${d.zonePre}`} style={{ left: 0, width: `${pct(w.start)}%` }} />}
                {geo.to > w.end + 0.01 && <div className={`${d.zone} ${d.zonePost}`} style={{ left: `${pct(w.end)}%`, right: 0 }} />}
              </>
            )}
            <div ref={playheadRef} className={d.playhead} />
            {wave.status === "loading" && <div className={d.waveNote}>Загружаем звук ролика…</div>}
            {wave.status === "failed" && <div className={d.waveNote}>Звук ролика не показать — слушайте «Оригинал»</div>}
          </div>
          {warn && (
            <div className={d.hintBar} role="status">
              {warn}
            </div>
          )}

          <div className={d.controls}>
            <div className={d.listenGroup}>
              <button type="button" className={d.ctl} aria-pressed={playing === "orig"} disabled={!w || busyPhase} onClick={() => void listen("orig")} aria-keyshortcuts="P">
                <PlayIcon stop={playing === "orig"} /> Оригинал
              </button>
              <button type="button" className={d.ctl} aria-pressed={playing === "mine"} disabled={!fitted || busyPhase} onClick={() => void listen("mine")} aria-keyshortcuts="M">
                <PlayIcon stop={playing === "mine"} /> Моя озвучка
              </button>
              <div className={d.latencyBox} ref={latencyRef}>
                <button type="button" className={d.ctl} aria-expanded={latencyOpen} aria-controls="dub-latency" disabled={busyPhase} onClick={() => setLatencyOpen((o) => !o)}>
                  <ClockIcon /> Задержка записи{prefs.latencyMs ? ` ${msText(prefs.latencyMs)}` : ""}
                </button>
                {latencyOpen && (
                  <div className={d.pop} id="dub-latency" role="dialog" aria-label="Задержка записи">
                    <label className={d.popRow}>
                      <input
                        type="range"
                        min={-LATENCY_MAX}
                        max={LATENCY_MAX}
                        step={10}
                        value={prefs.latencyMs}
                        onChange={(e) => updatePrefs({ latencyMs: Number(e.target.value) })}
                        aria-label="Задержка записи, мс"
                      />
                      <span className={d.popValue}>{msText(prefs.latencyMs)}</span>
                    </label>
                    {prefs.latencyMs !== 0 && (
                      <button type="button" className="link-btn" onClick={() => updatePrefs({ latencyMs: 0 })}>
                        Сбросить
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
            <div className={d.recBox}>
              <button type="button" className={d.rec} data-phase={phase} disabled={!canRecord} onClick={toggle} aria-keyshortcuts="Space" aria-describedby="dub-line">
                {phase === "saving" || phase === "opening" ? <span className="spin" aria-hidden="true" /> : <span className={d.recDot} aria-hidden="true" />}
                {recLabel}
              </button>
            </div>
          </div>

          {notice && !error && (
            <div className="hint" role="status">
              {notice}
            </div>
          )}
          {error && (
            <div className="error-box" role="alert">
              {error}
              {retry && (
                <>
                  {" "}
                  <button type="button" className="link-btn" disabled={busyPhase} onClick={() => void upload(retry.key, retry.blob, retry.meta)}>
                    Отправить ещё раз
                  </button>
                </>
              )}
            </div>
          )}

          <div className={d.micBar} aria-label="Микрофон" role="group">
            <select
              className={d.device}
              aria-label="Микрофон"
              value={devices.some((dev) => dev.deviceId === prefs.deviceId) ? prefs.deviceId : ""}
              disabled={busyPhase}
              onPointerDown={() => {
                // the browser shows no microphones until one is allowed: the press asks for it, the list fills in
                if (!devices.length) void openMic().catch((e) => setMicMessage((e as Error).message));
              }}
              onChange={(e) => {
                updatePrefs({ deviceId: e.target.value });
                e.currentTarget.blur();
              }}
            >
              <option value="">Микрофон по умолчанию</option>
              {devices.map((dev, i) => (
                <option key={dev.deviceId} value={dev.deviceId}>
                  {dev.label || `Микрофон ${i + 1}`}
                </option>
              ))}
            </select>
            <label className={`${d.switch} ${d.switchSmall}`}>
              <input
                type="checkbox"
                checked={prefs.noise}
                disabled={busyPhase}
                onChange={(e) => {
                  updatePrefs({ noise: e.target.checked });
                  e.currentTarget.blur();
                }}
              />
              <span className={d.track} aria-hidden="true" />
              Шумоподавление
            </label>
            <label className={`${d.switch} ${d.switchSmall}`} title="Автоматическая громкость микрофона">
              <input
                type="checkbox"
                checked={prefs.agc}
                disabled={busyPhase}
                onChange={(e) => {
                  updatePrefs({ agc: e.target.checked });
                  e.currentTarget.blur();
                }}
              />
              <span className={d.track} aria-hidden="true" />
              Авто
            </label>
            <label className={d.gain}>
              <span>Усиление</span>
              <input type="range" min={GAIN_MIN} max={GAIN_MAX} step={0.1} value={prefs.gain} onChange={(e) => updatePrefs({ gain: Number(e.target.value) })} aria-label="Усиление микрофона" />
              <span className={d.gainValue}>{prefs.gain.toFixed(1).replace(".", ",")}×</span>
            </label>
            <div className={d.meter} aria-hidden="true">
              <div ref={meterRef} className={d.meterFill} />
            </div>
          </div>
          {micMessage && (
            <div className="error-box" role="alert">
              {micMessage}
            </div>
          )}
        </section>
      )}

      {lines.length > 0 && (
        <section className={d.stripSection} aria-labelledby="dub-lines">
          <div className={d.stripHead}>
            <h2 id="dub-lines">Реплики</h2>
            {progress && progress.total > 0 && (
              <span className={`${d.count} ${progress.recorded === progress.total ? d.countDone : ""}`}>
                озвучено {progress.recorded} из {progress.total}
              </span>
            )}
          </div>
          <div className={d.strip} ref={stripRef}>
            {lines.map((l) => (
              <button
                key={`${l.index}-${l.key}`}
                type="button"
                className={d.lineCard}
                data-index={l.index}
                data-who={l.who}
                aria-current={l.index === sel}
                disabled={busyPhase}
                onClick={() => go(l.index)}
              >
                <span className={d.thumb}>
                  {thumbs[l.index] ? (
                    // a data: URL captured from the video, nothing to optimize
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={thumbs[l.index]} alt="" />
                  ) : (
                    <span className={d.thumbNo}>{l.index + 1}</span>
                  )}
                </span>
                <span className={d.cardHead}>
                  <span className={d.cardWho} data-who={l.who}>
                    #{l.index + 1} {CAST_LABEL[l.who]}
                  </span>
                  {l.status && (
                    <span className={d.badge} data-status={l.status}>
                      {STATUS_LABEL[l.status]}
                    </span>
                  )}
                </span>
                <span className={d.cardText}>
                  <LineText text={l.text} />
                </span>
              </button>
            ))}
          </div>
        </section>
      )}
      {modal}
    </main>
  );
}
