import { execFile } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { promisify } from "node:util";
import type { Hooks } from "./api";
import { askClaude, jsonOf, type BridgeImage } from "./bridge";
import { ENGINE_ROOT } from "./cast";
import { PATCH_FORMAT } from "./prompt";

/**
 * The «dream loop» of the 3D montage (after the dream-loop skill, MIT): before the draft is corrected, GPT draws the
 * target frame of the video's key moment; a critic that did not build the scene compares the scene's own frame with
 * the target and lists the gaps; the ones the kit can close go to the director as edits, the ones it cannot are kept
 * as a report of what the kit lacks. With pictures in studio3d/style-ref the target is drawn in the owner's reference
 * style, and that report becomes the list of what stands between the kit and the reference.
 *
 * Every step is optional: a failure is said in the log and the montage goes on as it did before.
 */

const run = promisify(execFile);
const knowledge = (file: string) => fs.readFileSync(path.join(ENGINE_ROOT, "knowledge", file), "utf8");
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const envInt = (name: string, fallback: number, lo: number, hi: number) => {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && process.env[name] ? clamp(Math.round(v), lo, hi) : fallback;
};

/**
 * The step runs when the owner has put a style reference into style-ref/ (it then shows what the kit lacks to
 * reach that look), or when STUDIO3D_DREAM=1 asks for it. Without a reference a live trial (11.11) gave true
 * notes but no visible gain per video for 4–6 extra minutes, so it stays a diagnostic. STUDIO3D_DREAM=0 is always off.
 */
export const dreamOn = () => process.env.STUDIO3D_DREAM === "1" || (process.env.STUDIO3D_DREAM !== "0" && styleRefs().length > 0);
/** Critic rounds: the first rides on the draft review, the second re-renders the target moments. */
export const dreamRounds = () => envInt("STUDIO3D_DREAM_ROUNDS", 2, 1, 2);
const maxFrames = () => envInt("STUDIO3D_DREAM_FRAMES", 2, 1, 2);
/** From this score on the frame is close enough to the target: no further round. */
export const DREAM_GOOD = 8;

export const STYLE_DIR = path.join(ENGINE_ROOT, "style-ref");
const MAX_STYLE = 3;

export type DraftMoment = { t: number; label: string };
/** shot — index of the draft moment the target is drawn for. */
export type DreamFrame = { shot: number; t: number; label: string; why: string; picture: string };
export type DreamTarget = DreamFrame & { file: string };
export type Gap = { frame: number; gap: string; fix: "kit" | "missing"; how: string };
export type Scores = { composition: number; light: number; materials: number; details: number };
export type Verdict = { round: number; scores: Scores; total: number; gaps: Gap[] };

// ---- reading the answers

const text = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

/** The art director's answer: which draft moments get a target and what the picture shows. */
export function readBrief(answer: string, moments: DraftMoment[], max = 2): DreamFrame[] {
  const raw = jsonOf<{ frames?: unknown }>(answer);
  if (!raw || !Array.isArray(raw.frames)) throw new Error("в ответе нет frames");
  const frames: DreamFrame[] = [];
  for (const item of raw.frames) {
    const f = item as { shot?: unknown; why?: unknown; picture?: unknown } | null;
    const shot = Number(f?.shot) - 1;
    const picture = text(f?.picture, 1800);
    if (!Number.isInteger(shot) || shot < 0 || shot >= moments.length || picture.length < 60) continue;
    if (frames.some((x) => x.shot === shot)) continue;
    frames.push({ shot, t: moments[shot].t, label: moments[shot].label, why: text(f?.why, 300), picture });
    if (frames.length >= max) break;
  }
  if (!frames.length) throw new Error("ни один кадр цели не описан: нужен номер кадра из списка и описание картинки");
  return frames;
}

const FIX_KIT = /^(kit|fixable|набор|исправимо(\s+набором)?)$/i;
const FIX_MISSING = /^(missing|нет\s+в\s+наборе|набору\s+не\s+хватает|не\s+хватает)$/i;
const SCORE_MAX: Scores = { composition: 3, light: 3, materials: 3, details: 1 };

/**
 * The critic's answer: scores of the rubric and the gaps in the order it gave them (most noticeable first), each
 * marked as closable by the kit or as something the kit lacks. Entries it did not mark either way are dropped:
 * an unmarked gap is neither an edit for the director nor a finding about the kit.
 */
export function readCritic(answer: string, frames: number): Omit<Verdict, "round"> {
  const raw = jsonOf<{ scores?: Record<string, unknown>; gaps?: unknown }>(answer);
  if (!raw || !Array.isArray(raw.gaps)) throw new Error("в ответе критика нет списка gaps");
  const scores = { ...SCORE_MAX };
  for (const key of Object.keys(SCORE_MAX) as (keyof Scores)[]) {
    const v = Number(raw.scores?.[key]);
    if (!raw.scores || !Number.isFinite(v)) throw new Error(`в ответе критика нет оценки ${key}`);
    scores[key] = clamp(v, 0, SCORE_MAX[key]);
  }
  const gaps: Gap[] = [];
  for (const item of raw.gaps) {
    const g = item as { frame?: unknown; gap?: unknown; fix?: unknown; how?: unknown; need?: unknown } | null;
    const gap = text(g?.gap, 400);
    const mark = text(g?.fix, 40);
    const fix = FIX_KIT.test(mark) ? "kit" : FIX_MISSING.test(mark) ? "missing" : null;
    if (!gap || !fix) continue;
    const frame = Number(g?.frame);
    gaps.push({ frame: Number.isInteger(frame) && frame >= 1 && frame <= frames ? frame : 1, gap, fix, how: text(g?.how, 300) || text(g?.need, 300) });
    if (gaps.length >= 14) break;
  }
  const total = Math.round((scores.composition + scores.light + scores.materials + scores.details) * 10) / 10;
  return { scores, total, gaps };
}

// ---- the style reference

/** The owner's style reference: up to three pictures of studio3d/style-ref, by name. */
export function styleRefs(dir = STYLE_DIR): { name: string; dataUrl: string }[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => /\.(jpe?g|png|webp)$/i.test(f) && fs.statSync(path.join(dir, f)).size < 10_000_000)
    .sort()
    .slice(0, MAX_STYLE)
    .map((name) => {
      const ext = path.extname(name).toLowerCase();
      const type = ext === ".png" ? "png" : ext === ".webp" ? "webp" : "jpeg";
      return { name, dataUrl: `data:image/${type};base64,${fs.readFileSync(path.join(dir, name)).toString("base64")}` };
    });
}

// ---- the prompts

/** What the engine can draw, for the image model: a target inside these means is one the director can reach. */
const KIT_FOR_PAINTER =
  "What the engine draws. Two miniature characters stand on the keys of a giant keyboard on a wooden desk in a night " +
  "room lit soft purple. The channel owner is a blocky voxel man built from cubes, about two keys tall: platinum-blond " +
  "stepped crop, light stubble, warm tan skin, a white jersey with thin navy pinstripes and the word YORK, a thin gold " +
  "chain, black trousers. Claude is a small orange (#d97757) cube on four stubby legs, less than half the man's height; " +
  "its face is a simple pixel face on the front of the cube. Behind the man stands a vertical monitor with an app " +
  "window (a chat, an exchange chart, a Telegram feed, a wallet, a news site or a trading position) on a wavy " +
  "wallpaper; behind Claude a wide monitor with the Claude chat, or a glass PC with purple cooling. Camera framings: " +
  "close (the man's head and shoulders, or Claude whole and large), medium (the man waist-up with his hand and the " +
  "item in it inside the frame), wide on both (the man near the left edge, Claude near the right, the wide monitor " +
  "above them), low angle, high angle. Faces are flat pixel-style moods: neutral, happy, laughing, worried, shocked, " +
  "angry, sad, smug, sleepy, heart eyes, dizzy, wink, thinking, with an optional blush or a sweat drop. Gestures: " +
  "shrug, facepalm, scratching the head, pointing, crossed arms, hands on hips, arms up, grabbing the head, hand at " +
  "the chin, looking at a phone held at the chest. One item in the man's right hand: a coin, a phone, a laptop, a " +
  "wallet, a key, a sheet of paper, a lock or cash. Room light moods: night purple, warm, pulsing red alarm, " +
  "gold-green money, a spotlight with the room darker around, dark.";

/** One prompt for one target frame. References go in this order: the draft frame first, the style pictures last. */
export function painterPrompt(picture: string, styleCount: number): string {
  const what =
    "Draw one frame of a vertical 9:16 3D animated sketch for TikTok: an exact in-engine screenshot of the finished " +
    "video at its key moment, the best version of this moment.";
  const clean =
    "The frame is the clean video picture: the only words in it are the short ones on the room's screens and on the " +
    "item in the hand, exactly as the brief gives them. The lower third stays calm and free of small details: the " +
    "subtitle line is laid over it later.";
  if (styleCount > 0) {
    return [
      what,
      "The first attached image is the current draft of this moment from our engine: it gives the content only — who " +
        "is in the scene, what they wear and hold, where they stand and what the room has.",
      `The last ${styleCount === 1 ? "attached image is" : `${styleCount} attached images are`} the style reference chosen by the channel owner: take from ` +
        "it the manner of drawing — shapes and proportions of characters, materials, line, light, palette and level of " +
        "detail — and draw our moment as a frame of a video made entirely in that manner. The content of the style " +
        "reference (its characters, places and words) stays in the reference.",
      `Brief of the frame: ${picture}`,
      clean,
    ].join("\n\n");
  }
  return [
    what,
    "The attached image is the current draft of this moment from our engine. Keep the engine's look exactly as it " +
      "is there: the same voxel character designs, materials, room, screens and palette, the same real-time render " +
      "quality. What changes is the staging — framing, how large the characters are, pose, face, the item in the " +
      "hand, what the screen behind shows, the light mood — as the brief says.",
    KIT_FOR_PAINTER,
    `Brief of the frame: ${picture}`,
    clean,
  ].join("\n\n");
}

const fmt = (s: number) => s.toFixed(2);

const briefTask = (o: { topic: string; title: string; lines: { who: string; start: number; end: number; text?: string }[]; code: string; moments: DraftMoment[]; style: boolean; max: number }) =>
  [
    `Скетч «${o.title}». Идея владельца: ${o.topic.trim()}`,
    `Реплики (время в секундах):\n${o.lines.map((l, i) => `${i + 1}. [${fmt(l.start)}–${fmt(l.end)}] ${l.who}: ${l.text ?? ""}`).join("\n")}`,
    `Черновые кадры сцены — середины планов:\n${o.moments.map((m, i) => `${i + 1}. ${m.label}`).join("\n")}`,
    o.style
      ? "Генератору приложен образец стиля от владельца: рисовка придёт из образца, ты описываешь содержание кадра — кто, где, как крупно, что делает и чувствует, что на экране за спиной, какой свет."
      : "Образца стиля нет: цель рисуется в возможностях набора из учебника ниже — ракурс из таблицы планов, лицо из списка настроений, жест, вещь в руке, приложение на экране и свет из его списков. Такую цель режиссёр достаёт правками сцены.",
    `Выбери ${o.max > 1 ? "один-два кадра" : "один кадр"} и опиши целевую картинку. Ответ — только JSON в блоке \`\`\`json.`,
    "Сцена режиссёра:",
    "```tsx\n" + o.code + "\n```",
  ].join("\n\n");

const criticTask = (targets: DreamTarget[], previous: Verdict | null, style: boolean, code: string) =>
  [
    `Приложено ${targets.length * 2} картинок, парами: цель, затем кадр сцены того же момента.`,
    targets.map((t, i) => `Пара ${i + 1} (frame ${i + 1}): картинки ${i * 2 + 1} и ${i * 2 + 2} — момент ${t.label}.`).join("\n"),
    style
      ? "Цель нарисована по образцу стиля от владельца: отличия в рисовке, материалах и свете, которые набор не воспроизводит, — главная находка, называй каждое отдельно и предметно."
      : "Цель нарисована в возможностях набора по кадру сцены. Внешность героев и постоянная комната заданы набором, в сцене они верны: где художник их упростил (джерси без надписи, клавиши без букв, сглаженное растение), это его вольность, и в список она не входит. В список идёт постановка: камера и крупность, место героя в кадре, поза, лицо, вещь в руке, что открыто на экране за героем, свет.",
    previous
      ? `Это второй круг: режиссёр уже правил сцену по твоему прошлому списку. Прошлый вердикт (${previous.total} из 10):\n${JSON.stringify({ scores: previous.scores, gaps: previous.gaps })}\nСмотри на новые кадры заново и держи ту же шкалу: стало ближе к цели — оценка выше, стало дальше — ниже. Отличие, которое осталось в кадре, называй теми же словами, что в прошлый раз; закрытое в список не идёт.`
      : "",
    "Сцена, из которой сняты кадры (что режиссёр уже попросил у набора):",
    "```tsx\n" + code + "\n```",
    "Ответ — только JSON в блоке ```json.",
  ]
    .filter(Boolean)
    .join("\n\n");

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
/** The same gap named again: same pair and the same remedy or the same opening words. */
export const sameGap = (a: Gap, b: Gap) => a.frame === b.frame && ((!!a.how && norm(a.how) === norm(b.how)) || norm(a.gap).slice(0, 60) === norm(b.gap).slice(0, 60));

const gapLine = (g: Gap) => `- кадр цели ${g.frame}: ${g.gap}${g.how ? ` Как закрыть: ${g.how}` : ""}`;

// ---- the image bridge

/** GPT on the ChatGPT subscription, the bridge the covers are drawn through (lib/studio3d/cover.ts): $0. */
const imageBridge = () => process.env.CODEX_IMAGE_BRIDGE_URL || "http://127.0.0.1:43129";

async function drawImage(prompt: string, references: string[], signal: AbortSignal): Promise<Buffer> {
  const token = process.env.CODEX_BRIDGE_TOKEN;
  if (!token) throw new Error("нет CODEX_BRIDGE_TOKEN для моста картинок GPT");
  const body = JSON.stringify({ prompt, aspectRatio: "9:16", mode: "generate", references });
  const url = new URL("/image", imageBridge());
  // the bridge keeps one queue for every picture of the site: past this wait the target is not worth the montage's time
  const timeout = envInt("STUDIO3D_DREAM_IMAGE_TIMEOUT_MS", 8 * 60_000, 30_000, 30 * 60_000);
  const answer = await new Promise<{ status: number; text: string }>((resolve, reject) => {
    // node:http, not fetch: the bridge answers only when the picture is ready
    const req = (url.protocol === "https:" ? https : http).request(
      url,
      { method: "POST", agent: false, timeout, headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body), Authorization: `Bearer ${token}` } },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString("utf8") }));
        res.on("error", reject);
      },
    );
    req.on("timeout", () => req.destroy(new Error(`GPT не нарисовал за ${Math.round(timeout / 60_000)} мин`)));
    req.on("error", (e) => reject(/ECONNREFUSED|ECONNRESET/.test(e.message) ? new Error(`мост картинок GPT не отвечает (${url.host})`) : e));
    signal.addEventListener("abort", () => req.destroy(new Error("Задача остановлена")), { once: true });
    req.end(body);
  });
  let json: { base64?: unknown; error?: unknown } = {};
  try {
    json = JSON.parse(answer.text);
  } catch {
    // the status below says what went wrong
  }
  if (answer.status !== 200 || typeof json.base64 !== "string" || !json.base64) {
    throw new Error(`мост картинок GPT: ${answer.status} ${String(json.error ?? "картинка не вернулась").slice(0, 200)}`);
  }
  return Buffer.from(json.base64, "base64");
}

const jpeg = (file: string): BridgeImage => ({ base64: fs.readFileSync(file).toString("base64"), mediaType: "image/jpeg" });

// ---- one montage's run

export class DreamRun {
  frames: DreamFrame[] = [];
  targets: DreamTarget[] = [];
  verdicts: Verdict[] = [];
  private readonly dir: string;
  private readonly styles = styleRefs();

  constructor(
    private readonly workDir: string,
    private readonly hooks: Hooks,
  ) {
    this.dir = path.join(workDir, "dream");
    // a montage made again in the same folder starts its targets and verdicts anew
    fs.rmSync(this.dir, { recursive: true, force: true });
    for (const f of fs.existsSync(workDir) ? fs.readdirSync(workDir) : []) if (/^dream-\d+\.jpg$/.test(f)) fs.rmSync(path.join(workDir, f), { force: true });
    fs.mkdirSync(this.dir, { recursive: true });
  }

  /** A step that may fail without costing the montage anything; null says it did. */
  private async quiet<T>(what: string, work: () => Promise<T>): Promise<T | null> {
    try {
      return await work();
    } catch (error) {
      if (this.hooks.signal.aborted) throw error;
      this.hooks.log(`${what} (${(error as Error).message.slice(0, 200)}) — монтаж идёт как раньше`);
      return null;
    }
  }

  /** Claude as the art director picks the key moments and describes the target pictures. No images: runs beside the bundling. */
  plan(o: { topic: string; title: string; lines: { who: string; start: number; end: number; text?: string }[]; code: string; moments: DraftMoment[] }): Promise<boolean> {
    return this.quiet("Целевой кадр не описан", async () => {
      const system = [knowledge("dream.md"), knowledge("kit.md")].join("\n\n---\n\n");
      const answer = await askClaude(system, briefTask({ ...o, style: this.styles.length > 0, max: maxFrames() }), { label: "3Д целевой кадр", effort: "medium", signal: this.hooks.signal });
      this.frames = readBrief(answer, o.moments, maxFrames());
      fs.writeFileSync(path.join(this.dir, "brief.json"), JSON.stringify({ style: this.styles.map((s) => s.name), frames: this.frames }, null, 2));
      return true;
    }).then((ok) => !!ok);
  }

  /** GPT draws every planned target from the draft frame of its moment; true when at least one came out. */
  async draw(stills: string[]): Promise<boolean> {
    for (const frame of this.frames) {
      const n = this.targets.length + 1;
      const started = Date.now();
      this.hooks.log(`Целевой кадр ${n}: ${frame.label}; ${this.styles.length ? `по образцу стиля (${this.styles.map((s) => s.name).join(", ")})` : "в возможностях набора, образца стиля нет"}`);
      const file = await this.quiet(`Целевой кадр ${n} не нарисован`, async () => {
        const draft = `data:image/jpeg;base64,${fs.readFileSync(stills[frame.shot]).toString("base64")}`;
        const image = await drawImage(painterPrompt(frame.picture, this.styles.length), [draft, ...this.styles.map((s) => s.dataUrl)], this.hooks.signal);
        const raw = path.join(this.dir, `target-${n}.raw`);
        fs.writeFileSync(raw, image);
        const out = path.join(this.workDir, `dream-${n}.jpg`);
        // the critic sees the target near the size of the draft frames
        await run("ffmpeg", ["-v", "error", "-y", "-i", raw, "-vf", "scale=720:-2", "-q:v", "3", "-frames:v", "1", out], { timeout: 60_000 });
        fs.rmSync(raw, { force: true });
        return out;
      });
      if (!file) continue;
      this.targets.push({ ...frame, file });
      this.hooks.log(`Целевой кадр ${n} готов за ${Math.round((Date.now() - started) / 1000)} с: dream-${n}.jpg`);
    }
    this.report();
    return this.targets.length > 0;
  }

  /** Target, scene frame, target, scene frame… — the order both the critic and the director are told. */
  pairs(stills: string[]): BridgeImage[] {
    return this.targets.flatMap((t, i) => [jpeg(t.file), jpeg(stills[i])]);
  }

  targetImages(): BridgeImage[] {
    return this.targets.map((t) => jpeg(t.file));
  }

  /**
   * The critic: a fresh Claude call that knows the kit, sees the pictures and reads what the scene asks of the kit, not the
   * director's reasoning («кто собирал, тот не судит»). `stills` — the scene's frame for each target, in their order.
   */
  judge(stills: string[], code: string): Promise<Verdict | null> {
    const round = this.verdicts.length + 1;
    return this.quiet(`Критик цели, круг ${round}, не ответил`, async () => {
      const system = [knowledge("critic.md"), knowledge("kit.md")].join("\n\n---\n\n");
      const previous = this.verdicts[this.verdicts.length - 1] ?? null;
      const answer = await askClaude(system, criticTask(this.targets, previous, this.styles.length > 0, code), { label: `3Д критик цели, круг ${round}`, effort: "high", images: this.pairs(stills), signal: this.hooks.signal });
      const verdict: Verdict = { round, ...readCritic(answer, this.targets.length) };
      this.verdicts.push(verdict);
      fs.writeFileSync(path.join(this.dir, `critic-${round}.json`), JSON.stringify({ ...verdict, stills: stills.map((s) => path.relative(this.workDir, s).replace(/\\/g, "/")) }, null, 2));
      const missing = verdict.gaps.filter((g) => g.fix === "missing");
      this.hooks.log(`Критик цели, круг ${round}: ${verdict.total} из 10; исправимо набором ${verdict.gaps.length - missing.length}, набору не хватает ${missing.length}`);
      if (missing.length) this.hooks.log(`Набору не хватает: ${missing.map((g) => g.how || g.gap).join("; ").slice(0, 600)}`);
      this.report();
      return verdict;
    });
  }

  /**
   * The last round's kit gaps split by the round before it: the ones named again after the director's edits are
   * not worth another edit — the scene asks for it and the frame does not show it (dream-loop's «same gap twice»).
   */
  lastKitGaps(): { fresh: Gap[]; again: Gap[] } {
    const last = this.verdicts[this.verdicts.length - 1];
    const before = this.verdicts[this.verdicts.length - 2];
    const kit = last?.gaps.filter((g) => g.fix === "kit") ?? [];
    const old = before?.gaps.filter((g) => g.fix === "kit") ?? [];
    return { fresh: kit.filter((g) => !old.some((o) => sameGap(o, g))), again: kit.filter((g) => old.some((o) => sameGap(o, g))) };
  }

  /** The section the draft review gets: the targets are attached after the draft frames. */
  notes(gaps: Gap[], draftFrames: number): string {
    return [
      `После черновых кадров приложены целевые кадры — как выглядит лучший вариант ключевого момента: ${this.targets.map((t, i) => `картинка ${draftFrames + i + 1} — цель ${i + 1} для кадра ${t.shot + 1}`).join("; ")}.`,
      "Независимый критик сравнил твой кадр с целью и назвал отличия, которые закрывает набор, в порядке заметности:",
      gaps.map(gapLine).join("\n"),
      "Подтяни эти планы к цели теми же правками edits: цель показывает композицию, крупность, позу, лицо, вещь в руке, экран за героем и свет. Закрой правкой каждое отличие из списка — значения бери из учебника, проверка сцены действует как прежде; отличие, которое уже закрыла другая твоя правка, второй раз править не нужно.",
    ].join("\n");
  }

  /** The second round's own request to the director: pairs of pictures and the gaps left. */
  fixTask(code: string, gaps: Gap[]): string {
    return [
      "Независимый критик ещё раз сравнил кадры твоей сцены с целевыми. Картинки приложены парами: цель, затем твой кадр того же момента.",
      this.targets.map((t, i) => `Пара ${i + 1}: цель ${i + 1} и твой кадр на ${t.t.toFixed(1)} с.`).join("\n"),
      "Отличия, которые закрывает набор, в порядке заметности:",
      gaps.map(gapLine).join("\n"),
      "Подтяни сцену к цели: цель показывает композицию, крупность, позу, лицо, вещь в руке, экран за героем и свет. Закрой правкой каждое отличие из списка — значения бери из учебника, проверка сцены действует как прежде.",
      PATCH_FORMAT,
      "Файл:",
      "```tsx\n" + code + "\n```",
    ].join("\n\n");
  }

  /** dream/report.json: the targets, every round's score and what the kit lacks — rewritten after each step. */
  report(): void {
    const seen = new Set<string>();
    const missing = this.verdicts
      .flatMap((v) => v.gaps.filter((g) => g.fix === "missing").map((g) => ({ round: v.round, frame: g.frame, gap: g.gap, need: g.how })))
      .filter((m) => {
        const key = (m.need || m.gap).toLowerCase();
        return seen.has(key) ? false : (seen.add(key), true);
      });
    fs.writeFileSync(
      path.join(this.dir, "report.json"),
      JSON.stringify(
        {
          style: this.styles.length ? this.styles.map((s) => s.name) : "набор (образца стиля нет)",
          targets: this.targets.map((t, i) => ({ file: `dream-${i + 1}.jpg`, second: t.t, shot: t.label, why: t.why, picture: t.picture })),
          rounds: this.verdicts.map((v) => ({ round: v.round, total: v.total, scores: v.scores, fixable: v.gaps.filter((g) => g.fix === "kit").length, missing: v.gaps.filter((g) => g.fix === "missing").length })),
          missing,
          // named by the critic again after the director's edits: the kit has the value, the frame does not show it
          unread: this.verdicts.length > 1 ? this.lastKitGaps().again.map((g) => ({ frame: g.frame, gap: g.gap, asked: g.how })) : [],
        },
        null,
        2,
      ),
    );
  }
}
