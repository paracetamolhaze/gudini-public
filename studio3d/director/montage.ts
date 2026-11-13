import fs from "node:fs";
import path from "node:path";
import type { Hooks, LineWindow, MontageVoice, ProjectSpec, Script3D, VoicedClip } from "./api";
import { askClaude, fenced, type BridgeImage } from "./bridge";
import { castForScene, ENGINE_ROOT, loadCast } from "./cast";
import { DREAM_GOOD, dreamOn, dreamRounds, DreamRun, type Gap } from "./dream";
import { applyPatch } from "./patch";
import { directorSystem, directorTask, fixTask, reviewTask } from "./prompt";
import { lineWindows, montageWindows } from "./dub";
import type { MadeVideo } from "./soundLines";
import { writeMark } from "./montageMark";
import { bundleWorkspace, DEFAULT_DPR, DEFAULT_POST, renderScene, renderStills } from "./render";
import { analyzeScene, sceneShots, type SceneFacts } from "./validate";
import { voiceClips, voiceScript } from "./voice";
import { prepareWorkspace, removeWorkspace, typecheck } from "./workspace";

const TAIL = 0.7; // the last picture holds a moment after the last word

/** Every problem of a scene: AST rules first (cheap), then TypeScript. */
const problemsOf = async (code: string, facts: SceneFacts, name: string) => {
  const ast = analyzeScene(code, facts);
  if (ast.length) return ast;
  const ws = prepareWorkspace(code, name);
  try {
    return await typecheck(ws);
  } finally {
    removeWorkspace(ws);
  }
};

/** Up to three rounds of «here is what is wrong — fix it» until the scene passes every check. */
const settle = async (code: string, facts: SceneFacts, system: string, hooks: Hooks, tag: string, save: (code: string, note: string) => void) => {
  for (let round = 0; round < 3; round++) {
    const problems = await problemsOf(code, facts, `${tag}-check`);
    if (!problems.length) return code;
    hooks.log(`Проверка сцены: ${problems.slice(0, 6).join("; ")}`);
    save(code, `rejected-${round + 1}`);
    code = fenced(await askClaude(system, fixTask(code, problems), { label: "3Д правка сцены", effort: "medium", signal: hooks.signal }), "tsx");
  }
  const left = await problemsOf(code, facts, `${tag}-check`);
  if (left.length) throw new Error(`Сцена не прошла проверку: ${left.slice(0, 4).join("; ")}`);
  return code;
};

/** Seconds worth looking at in the draft: the middle of every shot, at most 16. */
const draftMoments = (code: string, duration: number) => {
  const shots = sceneShots(code);
  const picks = shots.length > 16 ? shots.filter((_, i) => i % Math.ceil(shots.length / 16) === 0) : shots;
  return picks.map((s) => {
    const t = Math.min(duration - 0.05, (s.from + s.to) / 2);
    return { t, label: `${t.toFixed(1)} с — план ${s.kind} на ${s.on}, ${s.move} (${s.from}–${s.to})` };
  });
};

export type DraftJob = {
  id: string;
  topic: string;
  title: string;
  code: string;
  facts: SceneFacts;
  system: string;
  input: Record<string, unknown>;
  publicDir: string;
  workDir: string;
  duration: number;
  hooks: Hooks;
  save: (code: string, note: string) => void;
};

/**
 * The second round against the target: the corrected scene's frames of the target moments go to the critic again,
 * and what the kit can still close goes to the director once more. Any failure keeps the scene as it came in.
 */
const secondDreamRound = async (job: DraftJob, code: string, dream: DreamRun): Promise<string> => {
  const { id, facts, system, input, publicDir, workDir, hooks, save } = job;
  hooks.stage("Второй круг по целевому кадру", 51);
  const ws = prepareWorkspace(code, `${id}-dream`);
  const bundleDir = path.join(workDir, "bundle-dream");
  try {
    const serveUrl = await bundleWorkspace(ws, publicDir, bundleDir);
    const stills = await renderStills(serveUrl, input, dream.targets.map((t) => t.t), path.join(workDir, "dream", "round-2"), hooks.signal);
    const verdict = await dream.judge(stills, code);
    if (!verdict) return code;
    // a gap the critic names again after the edits is not edited again: the scene already asks for it
    const { fresh: gaps, again } = dream.lastKitGaps();
    if (again.length) hooks.log(`После правок критик назвал те же отличия — сцена просит, кадр не показывает: ${again.map((g) => g.how || g.gap).join("; ").slice(0, 500)}`);
    if (!gaps.length || verdict.total >= DREAM_GOOD) return code;
    const answer = await askClaude(system, dream.fixTask(code, gaps), { label: "3Д правка по цели", effort: "high", images: dream.pairs(stills), signal: hooks.signal });
    if (/"ok"\s*:\s*true/.test(answer)) return code;
    const settled = await settle(applyPatch(code, answer), facts, system, hooks, `${id}-dream`, save);
    save(settled, "dreamed");
    hooks.log("Клод подтянул монтаж к целевому кадру, круг 2");
    return settled;
  } catch (error) {
    if (hooks.signal.aborted) throw error;
    hooks.log(`Второй круг по целевому кадру не прошёл (${(error as Error).message.slice(0, 200)}) — оставляю сцену после черновика`);
    return code;
  } finally {
    removeWorkspace(ws);
    fs.rmSync(bundleDir, { recursive: true, force: true });
  }
};

/**
 * The draft: Claude looks at its own frames and corrects what reads badly. With the dream step on (dream.ts), GPT
 * draws the target frame of the key moment meanwhile, an independent critic compares the scene's frame with it, and
 * the gaps the kit can close ride on the same review; a second round checks the corrected scene against the target.
 * Everything here is optional: a failure (subscription limit, bridge restart, no picture) falls back to the scene
 * that already passed every check, and a failure of the dream step alone leaves the review as it was before it.
 */
export async function reviewDraft(job: DraftJob): Promise<string> {
  const { id, facts, system, input, publicDir, workDir, duration, hooks, save } = job;
  let code = job.code;
  hooks.stage("Черновые кадры", 38);
  const ws = prepareWorkspace(code, `${id}-draft`);
  const bundleDir = path.join(workDir, "bundle-draft");
  try {
    const moments = draftMoments(code, duration);
    // the target's brief needs no pictures: it is written while the draft is bundled and rendered
    let dream: DreamRun | null = null;
    let planned: Promise<boolean> = Promise.resolve(false);
    if (dreamOn()) {
      try {
        dream = new DreamRun(workDir, hooks);
        planned = dream.plan({ topic: job.topic, title: job.title, lines: facts.lines, code, moments });
        // an abort is thrown by the awaits below first; this one must not be left unhandled
        planned.catch(() => {});
      } catch (error) {
        hooks.log(`Целевой кадр не начат (${(error as Error).message.slice(0, 200)}) — монтаж идёт как раньше`);
        dream = null;
      }
    }
    const serveUrl = await bundleWorkspace(ws, publicDir, bundleDir);
    const stills = await renderStills(serveUrl, input, moments.map((m) => m.t), path.join(workDir, "draft"), hooks.signal);
    const images: BridgeImage[] = stills.map((f) => ({ base64: fs.readFileSync(f).toString("base64"), mediaType: "image/jpeg" }));

    let gaps: Gap[] = [];
    let total = 0;
    if (dream && (await planned)) {
      hooks.stage("Целевой кадр: рисует GPT", 42);
      if (await dream.draw(stills)) {
        hooks.stage("Критик сравнивает черновик с целью", 45);
        const verdict = await dream.judge(dream.targets.map((t) => stills[t.shot]), code);
        gaps = verdict?.gaps.filter((g) => g.fix === "kit") ?? [];
        total = verdict?.total ?? 0;
      }
    }
    const target = dream && gaps.length ? dream : null;

    hooks.stage("Клод смотрит черновик", 48);
    const answer = await askClaude(system, reviewTask(code, moments.map((m) => m.label), target?.notes(gaps, images.length)), {
      label: "3Д черновик",
      effort: "high",
      images: target ? [...images, ...target.targetImages()] : images,
      signal: hooks.signal,
    });
    let patched = false;
    if (!/"ok"\s*:\s*true/.test(answer)) {
      try {
        code = await settle(applyPatch(code, answer), facts, system, hooks, `${id}-review`, save);
        save(code, "reviewed");
        patched = true;
        hooks.log(target ? "Клод поправил монтаж по черновику и целевому кадру" : "Клод поправил монтаж по черновику");
      } catch (error) {
        if (hooks.signal.aborted) throw error;
        hooks.log(`Правки по черновику не применились (${(error as Error).message}) — оставляю проверенную сцену`);
      }
    } else hooks.log("Черновик Клоду понравился без правок");

    if (target && patched && total < DREAM_GOOD && dreamRounds() >= 2) code = await secondDreamRound(job, code, target);
  } catch (error) {
    if (hooks.signal.aborted) throw error;
    hooks.log(`Проверка черновика не прошла (${(error as Error).message.slice(0, 200)}) — рендерю проверенную сцену`);
  } finally {
    removeWorkspace(ws);
    fs.rmSync(bundleDir, { recursive: true, force: true });
  }
  return code;
}

/**
 * The "voice" job: every line synthesized on its own, as the montage would voice it and into the same cache,
 * so the owner can hear Claude's cue before recording his answer, and the montage after it pays nothing.
 */
export async function voiceLines(p: ProjectSpec & { script: Script3D }, workDir: string, hooks: Hooks): Promise<VoicedClip[]> {
  fs.mkdirSync(workDir, { recursive: true });
  const cast = loadCast();
  hooks.stage("Озвучка реплик: ElevenLabs", 5);
  const clips = await voiceClips(p.script, cast, workDir, hooks.signal, hooks.log, (done, total) => {
    hooks.stage(`Озвучка реплик: ${done} из ${total}`, 5 + Math.round((80 * done) / Math.max(1, total)));
  });
  return clips.map((c) => ({ index: c.index, who: c.who, file: c.file, duration: Math.round(c.duration * 1000) / 1000 }));
}

/**
 * One video: the dialogue is voiced, Claude stages it as Scene.tsx, the scene is checked, Claude looks at
 * draft stills and corrects them, then the final render. Every step's files stay in workDir for re-renders.
 * With `voice.recordings` the owner's own takes play instead of his synthesized lines.
 */
export async function makeMontage(p: ProjectSpec & { script: Script3D }, workDir: string, hooks: Hooks, voice: MontageVoice = {}): Promise<MadeVideo> {
  fs.mkdirSync(workDir, { recursive: true });
  const cast = loadCast();
  const save = (code: string, note: string) => fs.writeFileSync(path.join(workDir, `Scene.${note}.tsx`), code);
  const recordings = voice.recordings ?? [];

  hooks.stage(recordings.length ? "Озвучка: записи владельца и ElevenLabs" : "Озвучка: ElevenLabs", 5);
  const voiced = await voiceScript(p.script, cast, workDir, hooks.signal, hooks.log, recordings);
  const duration = Math.round((voiced.duration + TAIL) * 100) / 100;

  const publicDir = path.join(workDir, "public");
  // the previous video's sources change from here on: a montage that stops half-way must not leave its voice and
  // input next to the previous final.mp4, where a dub would take them for that video's (the copy keeps old mtimes);
  // the folder is no video of the site's until the runner hears the site took this one (montageMark.ts)
  writeMark(workDir, { state: "pending" });
  fs.rmSync(path.join(workDir, "final.mp4"), { force: true });
  fs.rmSync(publicDir, { recursive: true, force: true });
  fs.mkdirSync(publicDir, { recursive: true });
  fs.cpSync(path.join(ENGINE_ROOT, "public/fonts"), path.join(publicDir, "fonts"), { recursive: true });
  fs.copyFileSync(voiced.file, path.join(publicDir, "voice.mp3"));
  hooks.signal.throwIfAborted();
  // the owner (2026-10-22): no music in the 3D sketches - only the two voices

  const input = {
    fps: 30,
    duration,
    voice: "voice.mp3",
    lines: voiced.lines,
    cast: castForScene(cast),
    dpr: DEFAULT_DPR,
    post: DEFAULT_POST,
  };
  fs.writeFileSync(path.join(workDir, "input.json"), JSON.stringify(input));
  const facts: SceneFacts = { duration, cast: Object.keys(cast), lines: voiced.lines };

  hooks.signal.throwIfAborted();
  hooks.stage("Клод ставит сцену", 18);
  const system = directorSystem();
  const task = directorTask({ topic: p.topic, title: p.script.title, duration, lines: voiced.lines, cast });
  let code = fenced(await askClaude(system, task, { label: "3Д режиссура", effort: "high", signal: hooks.signal }), "tsx");
  save(code, "first");
  hooks.stage("Проверка сцены", 32);
  code = await settle(code, facts, system, hooks, p.id, save);
  save(code, "checked");

  if (process.env.STUDIO3D_REVIEW !== "0") {
    hooks.signal.throwIfAborted();
    code = await reviewDraft({ id: p.id, topic: p.topic, title: p.script.title, code, facts, system, input, publicDir, workDir, duration, hooks, save });
  }

  hooks.signal.throwIfAborted();
  // the scene the final render uses: a dub later renders exactly this file again
  fs.writeFileSync(path.join(workDir, "Scene.tsx"), code);
  hooks.stage("Рендер 3D", 55);
  const out = path.join(workDir, "final.mp4");
  let shown = -1;
  await renderScene(
    code,
    input,
    publicDir,
    out,
    `${p.id}-final`,
    (f) => {
      const pct = Math.round(f * 100);
      if (pct !== shown && pct % 5 === 0) {
        shown = pct;
        hooks.stage(`Рендер 3D: ${pct}%`, 55 + Math.round(f * 40));
      }
    },
    hooks.signal,
  );
  hooks.stage("Готово", 100);
  // every voiced line's window goes to the site: the dubbing page plays and records exactly these. They are measured
  // from the sound of each line's clip; words and lips keep the letter timings. A failure to measure costs the video
  // nothing: the letters' windows go instead
  let windows: { lines: LineWindow[]; version?: number } | null;
  try {
    windows = await montageWindows(workDir, path.join(publicDir, "voice.mp3"), voiced.lines, p.script, hooks.signal);
  } catch (error) {
    if (hooks.signal.aborted) throw error;
    hooks.log(`Окна реплик по звуку не измерены (${(error as Error).message.slice(0, 200)}) — беру окна по буквам`);
    const lines = lineWindows(voiced.lines, p.script);
    windows = lines ? { lines } : null;
  }
  if (!windows) hooks.log("Окна реплик не сопоставились со сценарием — ролик уйдёт без них");
  else if (!windows.version) hooks.log("Окна реплик — по буквам: таймингов озвучки рядом с голосом нет");
  return { video: out, duration, ...(windows ? { lines: windows.lines, ...(windows.version ? { linesVersion: windows.version } : {}) } : {}) };
}
