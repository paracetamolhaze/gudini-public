import fs from "node:fs";
import path from "node:path";
import type { AstraInput } from "../src/input";
import { askAstra, extractCode, type BridgeImage } from "./bridge";
import { draftStills, keyMoments } from "./frames";
import { makeCutouts } from "./matting";
import { fixPrompt, musicPrompt, remarksPrompt, repairSystemPrompt, reviewPrompt, systemPrompt, taskPrompt, type Task } from "./prompt";
import { applyMontagePatch } from "./patch";
import { fileSignature, footageContext, PreparedAssets } from "./reuse";
import { ownerTrack, prepareMusic, recentTracks, type TrackWish } from "./music";
import { renderVideo } from "./render";
import { removeFrames, type AuthorFrames } from "./sequence";
import sharp from "sharp";
import { discardFootage, discardLogo, footage, footageFrames, footageKeys, FRAME_STEP, inPool, listMemes, realKey, redrawScene, resolveAssets, windowFootage, type PhotoPicker } from "./assets";
import { analyzeMontage, assetNeeds, cutoutRanges, type Analysis } from "./validate";
import { prepareWorkspace, typecheck } from "./workspace";
import { designProfile, type DesignProfile } from "./design";
import { prepareHyperGraphics } from "./hyperframes";
import { discardScreen } from "./screens";
import { cutoutKey, screenKey } from "../src/assetKeys";

export type MontageJob = {
  /** A/B comparison without changing the profile of other concurrent jobs. */
  designProfile?: DesignProfile;
  /** Render custom graphics with HyperFrames, only for Astra v2. */
  hyperframes?: boolean;
  input: AstraInput;
  topic: string;
  lessons: string[];
  /** Bundle public folder: fonts, the author video, sounds; cutouts are written here too. */
  publicDir: string;
  /** Subfolder of publicDir for this job's cutouts. */
  mediaSubdir: string;
  /** Where prompts, answers, versions of the montage and renders are kept. */
  outDir: string;
  /** Subfolder of publicDir where fetched emoji, logos and photos are cached between jobs. */
  assetCache?: string;
  /** Tracks of earlier videos, so every video gets its own. */
  musicHistory?: string;
  /** The owner's meme library (video clips by file name). */
  memesDir?: string;
  /** Checked facts of the story (who, what, where), so pictures show what really happened. */
  facts?: string[];
  /** Resolves when the recording is in the public folder: the site may still be cutting it while Astra writes. */
  videoReady?: Promise<void>;
  /** The prepared voice track; it is made in parallel with Astra's writing and awaited before the first frame is drawn. */
  voice?: Promise<string | undefined>;
  /** Frames of the recording for the final render, cut in parallel with Astra's writing; without them the video file is drawn. */
  frames?: Promise<AuthorFrames | undefined>;
  /** Waits for the turn to render: the site renders one video at a time while the next one is written. */
  beforeRender?: () => Promise<void>;
  /** Continue from a montage Astra already wrote (and reviewed), without asking her again. */
  startCode?: string;
  /** The owner's remarks on `startCode`: Astra changes those places and keeps the rest. */
  remarks?: string[];
  skipReview?: boolean;
  log?: (line: string) => void;
  onStage?: (stage: "write" | "assets" | "check" | "cutout" | "draft" | "review" | "final", fraction?: number) => void;
};

export type MontageResult = { code: string; input: AstraInput; final: string };

/**
 * Astra edits one video end to end: writes the montage, fixes what does not build,
 * cuts the author out for text-behind shots, renders a draft, looks at it, renders the final.
 */
export async function directMontage(job: MontageJob): Promise<MontageResult> {
  const { outDir, publicDir } = job;
  fs.mkdirSync(outDir, { recursive: true });
  const log = (line: string) => { job.log?.(line); fs.appendFileSync(path.join(outDir, "log.txt"), `${new Date().toISOString()} ${line}\n`); };
  let input: AstraInput = { ...job.input, cutouts: [] };
  const profile = designProfile(job.designProfile);
  const task: Task = { topic: job.topic, input, lessons: job.lessons, memes: Object.keys(listMemes(job.memesDir)), facts: job.facts, designProfile: profile };
  const system = systemPrompt("file", profile);
  const patchSystem = systemPrompt("patch", profile);
  const repairSystem = repairSystemPrompt(profile);
  const prepared = new PreparedAssets(publicDir);
  fs.writeFileSync(path.join(outDir, "system.md"), system);
  fs.writeFileSync(path.join(outDir, "design-profile.json"), JSON.stringify({ profile, hyperframes: job.hyperframes === true && profile === "craft-v1" }, null, 2));

  const responseTiming = (result: Awaited<ReturnType<typeof askAstra>>, started: number) =>
    `Астра ответила за ${((Date.now() - started) / 1000).toFixed(0)} с (модель ${(result.durationMs / 1000).toFixed(0)} с, очередь ${((result.queueWaitMs ?? 0) / 1000).toFixed(0)} с; вход ${result.usage.inputTokens}, выход ${result.usage.outputTokens} токенов)`;

  const ask = async (label: string, user: string, images: BridgeImage[] = []) => {
    fs.writeFileSync(path.join(outDir, `${label}.prompt.md`), user);
    log(`Астра: ${label}${images.length ? ` (кадров: ${images.length})` : ""}...`);
    const started = Date.now();
    const result = await askAstra(system, user, images);
    log(responseTiming(result, started));
    const code = extractCode(result.text);
    fs.writeFileSync(path.join(outDir, `${label}.tsx`), code);
    return code;
  };

  const askPatch = async (label: string, user: string, code: string, images: BridgeImage[] = [], review = false) => {
    fs.writeFileSync(path.join(outDir, `${label}.prompt.md`), user);
    log(`Астра: ${label} (точечные правки${images.length ? `, кадров: ${images.length}` : ""})...`);
    const started = Date.now();
    const result = await askAstra(review ? patchSystem : repairSystem, user, images);
    log(responseTiming(result, started));
    fs.writeFileSync(path.join(outDir, `${label}.patch.json`), result.text);
    let patched: string;
    try { patched = applyMontagePatch(code, result.text); }
    catch (error) {
      // A malformed patch must not damage a good montage. Keep the former full-file path as a fallback.
      log(`Точечные правки не применились: ${(error as Error).message}; Астра вернёт файл целиком`);
      return ask(`${label}-full`, user + "\nНа этом запуске формат edits отменён: верни исправленный Montage.tsx целиком без пояснений. Сохрани материалы и места без замечаний.", images);
    }
    fs.writeFileSync(path.join(outDir, `${label}.tsx`), patched);
    return patched;
  };

  const settle = async (code: string, label: string) => {
    let assetRounds = 0;
    for (let attempt = 1; ; attempt++) {
      const analysis = analyzeMontage(code, input.duration);
      const errors = typecheck(prepareWorkspace(code, `${path.basename(outDir)}-check-${label}-${attempt}`));
      const problems = [...analysis.problems, ...errors];
      let missing: string[] = [];
      if (!problems.length) {
        // Transformations and cutouts read the recording; it is usually cut long before Astra finishes writing.
        await job.videoReady;
        void cutouts(analysis);
        // Emoji, logos and photos the montage asks for are fetched now; what cannot be found goes back to Astra once.
        job.onStage?.("assets");
        const needs = assetNeeds(analysis.blocks);
        // Photos no stock photo shows are drawn from what should be visible on them — unless nothing is drawn in this video.
        const pending = prepared.pending(needs, input);
        const resolved = await resolveAssets(pending, publicDir, job.assetCache ?? "asset-cache", {
          pick: pickPhotos, memesDir: job.memesDir, drawMissingPhotos: canDraw, rescue: rescueScene,
          video: path.join(publicDir, input.video), face: input.face,
        });
        input = { ...input, assets: { ...input.assets, ...resolved.assets }, sizes: { ...input.sizes, ...resolved.sizes } };
        missing = resolved.missing;
        for (const note of resolved.notes) log(`  ${note}`);
        // Every found clip gets the moment that shows what the author says under it; a clip without one is replaced or sent back.
        missing.push(...await pickFootageWindows(analysis));
        prepared.remember(needs, input);
        for (const real of needs.reals ?? []) {
          const why = rejectedReals.get(realKey(real));
          if (why) missing.push(`Настоящее фото для «${real.caption ?? real.wiki ?? real.query}» показывает не того, о ком речь (${why}). Покажи этот момент иначе: имя огромным словом за спиной автора (BehindText) или сценой.`);
        }
        for (const shot of needs.screens ?? []) {
          const why = rejectedScreens.get(screenKey(shot));
          if (why) missing.push(`Страница ${shot.url} не годится для ролика (${why}). Дай другой адрес этой же вещи или покажи этот момент иначе.`);
        }
        for (const piece of needs.cutouts ?? []) {
          const why = rejectedCutouts.get(cutoutKey(piece));
          if (why) missing.push(`Вырезанное фото «${piece.wiki ?? piece.query}» для коллажа не годится (${why}). Возьми другие слова query (другой снимок) или покажи это иначе.`);
        }
        for (const name of needs.logos) {
          const why = rejectedLogos.get(name.toLowerCase());
          if (why) missing.push(`Логотип «${name}» из интернета оказался не тем (${why}) — покажи название словом за спиной автора (BehindText).`);
        }
        for (const query of needs.photos) {
          const why = rejectedPhotos.get(query);
          if (why) missing.push(`Фото по запросу «${query}» не подходит (${why}). Дай другой запрос — 2–4 слова по-английски, как на фотостоке, — или покажи этот момент иначе.`);
        }
        for (const key of resolved.check) toCheck.add(key);
        log(`Материалы: кадры ${needs.footage.length}, логотипы ${needs.logos.length}, фото ${needs.photos.length}, сцены ${needs.scenes.length}, превращения ${needs.morphs.length}, мемы ${needs.memes.length}, страницы ${needs.screens.length}, вырезки ${needs.cutouts.length}; не нашлось ${missing.length}`);
      }
      fs.writeFileSync(path.join(outDir, `${label}-analysis-${attempt}.json`), JSON.stringify({ ...analysis, errors, problems, missing }, null, 2));
      // A photo that still cannot be found is shown by its fallback emoji (or skipped): the montage goes on.
      if (!problems.length && (!missing.length || assetRounds >= 1)) {
        if (missing.length) log(`Без картинки остались: ${missing.length} — эти места пропущены`);
        return { code, analysis };
      }
      if (!problems.length) assetRounds++;
      const blocking = problems.length;
      problems.push(...missing);
      log(`Проверка: ${problems.length} проблем(ы): ${problems.slice(0, 3).join(" | ")}`);
      if (attempt >= 3) {
        // The montage builds and only some pictures are still missing: those places are skipped, the video is made.
        // Before, a clip that was never found after the repairs had used up the rounds threw the whole video away (pizza, 2026-10-09).
        if (!blocking) {
          log(`Без картинки остались: ${missing.length} — эти места пропущены`);
          return { code, analysis };
        }
        throw new Error(`Астра: монтаж не собирается после ${attempt} попыток: ${problems.slice(0, 5).join("; ")}`);
      }
      code = await askPatch(`${label}-fix-${attempt}`, fixPrompt({ ...task, input }, code, problems), code);
    }
  };

  /** A scene the image generator refused is rewritten by Astra so it can be generated, keeping its meaning. */
  const rescueScene = async (prompt: string, error: string): Promise<string | null> => {
    const user = [
      "Генератор картинок не сделал сцену для ролика.", `Ошибка: ${error}`, "", "Сцена:", prompt, "",
      "Перепиши описание так, чтобы генератор его принял, и сохрани смысл истории: кто участвует и сколько их, что у них в руках, что происходит, где.",
      "Что обычно помогает: несовершеннолетних показывать со спины, в профиль или издалека, без крупных лиц; у игрушечного оружия подчеркнуть, что это игрушка (яркий оранжевый наконечник, прозрачный магазин с цветными шариками); действие показать через его результат (шарики летят из окна).",
      "Ответ — только новое описание сцены по-английски, одним абзацем.",
    ].join("\n");
    log(`Астра переписывает сцену для генератора: ${prompt.slice(0, 60)}...`);
    try {
      const result = await askAstra("Ты — Астра, монтажёр. Помогаешь генератору картинок сделать сцену для ролика.", user);
      return result.text.trim().replace(/^```\w*\n?|```$/g, "").trim() || null;
    } catch { return null; }
  };

  /** Astra looks at stock photo candidates and picks the one that shows the thing clearly. */
  const pickPhotos: PhotoPicker = async (sets) => {
    const images: BridgeImage[] = [];
    const lines: string[] = [];
    for (const set of sets) set.previews.forEach((buffer, index) => {
      if (!buffer.length || images.length >= 24) return;
      images.push({ base64: buffer.toString("base64"), mediaType: buffer[0] === 0x89 ? "image/png" : "image/jpeg" });
      lines.push(`${images.length}. запрос «${set.query}»${set.look ? ` (должно быть видно: ${set.look})` : ""}, вариант ${index}`);
    });
    const user = [
      "Для монтажа нужны фото. К заданию приложены варианты в таком порядке:", lines.join("\n"), "",
      "Для каждого запроса выбери вариант, на котором видно всё, что указано в «должно быть видно». Если чего-то из этого на фото нет (например, шариков рядом с бластером) — вариант не подходит, выбери -1: тогда эту сцену нарисуют.",
      "Надписи на самих предметах — нормально (POLICE на форме, марка на бутылке). Не подходят водяные знаки, коллажи, другой предмет, тёмные и размытые фото.",
      `Ответ — только JSON вида {"запрос": номер варианта}.`,
    ].join("\n");
    log(`Астра выбирает фото: ${sets.length} запрос(ов), ${images.length} вариантов...`);
    const result = await askAstra("Ты — Астра, монтажёр. Выбираешь фото для вставок в ролик.", user, images);
    try { return JSON.parse(result.text.slice(result.text.indexOf("{"), result.text.lastIndexOf("}") + 1)); } catch { return {}; }
  };

  /**
   * Astra looks at every prepared picture next to what it must show. What is wrong is drawn again
   * with the problem spelled out; a photo that fails is replaced by a generated scene.
   */
  const verified = new Map<string, string>();
  // Real photos that show someone else than the one named: the moment is shown another way.
  const rejectedReals = new Map<string, string>();
  // Footage whose second cut still shows something else: the moment is shown another way.
  const rejectedFootage = new Map<string, string>();
  const footageDir = path.join(publicDir, job.assetCache ?? "asset-cache", "footage");
  const relOf = (file: string) => path.relative(publicDir, file).split(path.sep).join("/");
  // Choices belong to logical footage requests and speech, so shared source files can have different windows.
  type Window = { file: string; poster: string; master: string; masterPoster: string; purpose: string };
  const windowed = new Map<string, Window & { signature: string }>();
  const windowSignature = (w: Window) => JSON.stringify([w.file, w.poster, w.master].map(file => fileSignature(publicDir, file)));
  const rememberWindow = (key: string, w: Window) => windowed.set(key, { ...w, signature: windowSignature(w) });

  /**
   * Astra chooses the moment of each found clip that shows what the author says under it: she sees frames of the cut
   * and the words spoken while the block is on screen, and names the second the window starts at. A clip without such
   * a moment is turned down and the next video for the query is cut; after three misses the place goes back to Astra.
   */
  const pickFootageWindows = async (analysis: Analysis): Promise<string[]> => {
    const problems: string[] = [];
    const needs = assetNeeds(analysis.blocks);
    const misses = new Map<string, number>();
    const keysOf = (f: { query: string; start?: number }) => footageKeys(f.query, f.start);
    // Every look settles at least one cut for good (a window, a replacement or a refusal); the cap only guards against a slip.
    for (let round = 0; round < needs.footage.length * 4 + 2; round++) {
      // Clips that already have a window keep it; the rest are looked at two at a time (one look takes 24 pictures).
      for (const f of needs.footage) {
        const keys = keysOf(f);
        const chosen = windowed.get(keys.video);
        if (!chosen) continue;
        const current = input.assets[keys.video];
        const sameSource = current === chosen.file || current === chosen.master;
        if (sameSource && chosen.purpose === footageContext(analysis, input.words, f).purpose
          && windowSignature(chosen) === chosen.signature
          && fs.existsSync(path.join(publicDir, chosen.file)) && fs.existsSync(path.join(publicDir, chosen.poster))) {
          input = { ...input, assets: { ...input.assets, [keys.video]: chosen.file, [keys.poster]: chosen.poster } };
        } else {
          // A changed story is checked against the original cut, not a previously cropped window.
          if (current === chosen.file && fs.existsSync(path.join(publicDir, chosen.master))) {
            input = { ...input, assets: { ...input.assets, [keys.video]: chosen.master, [keys.poster]: chosen.masterPoster } };
          }
          const size = input.sizes[keys.video];
          if (size?.span) {
            const { span: _span, ...rest } = size;
            input = { ...input, sizes: { ...input.sizes, [keys.video]: rest } };
          }
          windowed.delete(keys.video);
        }
      }
      const pending = needs.footage.filter(f => input.assets[keysOf(f).video] && !windowed.has(keysOf(f).video)).slice(0, 2);
      if (!pending.length) break;
      const sets: { f: (typeof pending)[number]; master: string; said: string; length: number; purpose: string; frames: { at: number; jpeg: Buffer }[]; first: number }[] = [];
      for (const f of pending) {
        const { said, length, purpose } = footageContext(analysis, input.words, f);
        const master = input.assets[keysOf(f).video];
        const frames = await footageFrames(path.join(publicDir, master)).catch(() => []);
        const first = sets.reduce((n, s) => n + s.frames.length, 0);
        if (frames.length) sets.push({ f, master, said, length, purpose, frames, first });
        else rememberWindow(keysOf(f).video, { file: master, poster: input.assets[keysOf(f).poster], master, masterPoster: input.assets[keysOf(f).poster], purpose });
      }
      if (!sets.length) continue;
      const user = [
        "Для вставок в ролик найдены настоящие клипы. К заданию приложены их кадры по порядку:",
        ...sets.map((s, i) => `Клип ${i + 1} «${s.f.query}»: кадры ${s.first + 1}–${s.first + s.frames.length}, через ${FRAME_STEP} с (кадр ${s.first + 1} — 0 с клипа). ` +
          (s.said ? `Автор в это время говорит: «${s.said}». ` : "Эти кадры пойдут фоном под графику доски: нужен спокойный кадр без текста и кнопок. ") + `Нужно окно длиной ${s.length} с.`),
        "Окно — там, где на экране именно то, о чём говорит автор: то действие, тот экран, тот предмет — спокойно, без быстрой прокрутки и переключений, крупно и чисто, без чужих надписей, водяных знаков, говорящих людей и слайдов. Если такого окна в клипе нет — так и скажи.",
        "span — левая и правая граница главного в этом окне (телефон в руке, окно игры, экран приложения, предмет) в долях ширины кадра клипа, от 0 до 1: вертикальный экран покажет его крупно, остальное уйдёт за края.",
        "Лучшее окно — то, где главное занимает узкую часть кадра и встанет на вертикальный экран крупно: запись экрана телефона, окно игры, телефон, снятый стоя. Телефон, снятый лёжа поперёк всего кадра, на вертикальном экране останется мелкой полосой — такое окно бери, только если другого нет.",
        `Ответ — только JSON по клипам: {"1": {"start": секунда начала окна, "span": [0.3, 0.7]}, "2": {"ok": false, "problem": "что не так, одной фразой по-английски"}}.`,
      ].join("\n");
      log(`Астра выбирает момент в кадрах: ${sets.map(s => `«${s.f.query.slice(0, 40)}»`).join(", ")}...`);
      let verdicts: Record<string, { start?: number; span?: [number, number]; ok?: boolean; problem?: string }> = {};
      try {
        const result = await askAstra("Ты — Астра, монтажёр. Выбираешь момент в настоящих кадрах для вставки в ролик.", user,
          sets.flatMap(s => s.frames.map(fr => ({ base64: fr.jpeg.toString("base64"), mediaType: "image/jpeg" }))));
        verdicts = JSON.parse(result.text.slice(result.text.indexOf("{"), result.text.lastIndexOf("}") + 1));
      } catch (error) {
        // Without her look the cuts go in from their start: a montage is still better than none.
        log(`Момент в кадрах не выбран: ${String((error as Error).message).slice(0, 120)}`);
        for (const s of sets) rememberWindow(keysOf(s.f).video, { file: s.master, poster: input.assets[keysOf(s.f).poster], master: s.master, masterPoster: input.assets[keysOf(s.f).poster], purpose: s.purpose });
        continue;
      }
      for (const [i, s] of sets.entries()) {
        const verdict = verdicts[String(i + 1)] ?? {};
        const keys = keysOf(s.f);
        if (verdict.ok !== false && typeof verdict.start === "number") {
          const start = Math.max(0, Math.min(Math.max(0, s.frames.length * FRAME_STEP - s.length), verdict.start));
          const w = await windowFootage(path.join(publicDir, s.master), start, s.length);
          const window = { file: relOf(w.file), poster: relOf(w.poster), master: s.master, masterPoster: input.assets[keys.poster], purpose: s.purpose };
          rememberWindow(keys.video, window);
          input = { ...input, assets: { ...input.assets, [keys.video]: window.file, [keys.poster]: window.poster } };
          // What matters in a wide clip is brought up to fill the vertical screen (the Footage block reads the span).
          const span = verdict.span;
          const size = input.sizes[keys.video];
          if (size && Array.isArray(span) && span.length === 2 && span.every(n => typeof n === "number" && n >= 0 && n <= 1) && span[0] < span[1]) {
            input = { ...input, sizes: { ...input.sizes, [keys.video]: { ...size, span: [span[0], span[1]] } } };
          }
          log(`  кадры «${s.f.query.slice(0, 50)}»: с ${start} с, ${s.length} с`);
          continue;
        }
        const why = verdict.problem ?? "no moment shows what is said";
        log(`Кадры не те: ${s.f.query.slice(0, 60)}: ${why}`);
        discardFootage(s.f.query, s.f.start, footageDir);
        const miss = (misses.get(keys.video) ?? 0) + 1;
        misses.set(keys.video, miss);
        const next = miss < 3 ? await footage(s.f.query, s.f.start, footageDir) : null;
        if (next) {
          input = { ...input, assets: { ...input.assets, [keys.video]: relOf(next.file), [keys.poster]: relOf(next.poster) }, sizes: { ...input.sizes, [keys.video]: next.size, [keys.poster]: next.size } };
          log(`  другие кадры «${s.f.query.slice(0, 50)}»: ${next.title}`);
          continue;
        }
        rejectedFootage.set(s.f.query, why);
        const { [keys.video]: _video, [keys.poster]: _poster, ...rest } = input.assets;
        input = { ...input, assets: rest };
        problems.push(`Настоящие кадры «${s.f.query}» не показывают того, что говорит автор (${why}). Дай запрос точнее к действию, по-английски («Hamster Kombat tap coins», «Hamster Kombat airdrop screen»), или покажи этот момент иначе.`);
      }
    }
    return problems;
  };
  // Logos taken from the open web are looked at before the render; a wrong one is dropped and the name goes behind the author.
  const toCheck = new Set<string>();
  const rejectedLogos = new Map<string, string>();
  // Someone with no photo at all is known by a monument: the bust of Satoshi Nakamoto in Budapest is how he is shown.
  const NO_PHOTO = "У кого настоящих фото нет вовсе (Сатоши Накамото), тот показывается своим памятником или бюстом — это верная картинка.";
  // Screenshots of the wrong page (a bot check, an error) and cut-outs that came out dirty go back to Astra with the reason.
  const rejectedScreens = new Map<string, string>();
  const rejectedCutouts = new Map<string, string>();
  // Without a picture generator a photo that does not fit cannot be redrawn: it goes back to Astra with the reason.
  const canDraw = process.env.ASTRA_DRAW !== "0";
  const rejectedPhotos = new Map<string, string>();
  const pictureVersion = (w: { key: string; need: string }) => JSON.stringify([input.assets[w.key], w.need, fileSignature(publicDir, input.assets[w.key])]);
  const verifyPictures = async (analysis: ReturnType<typeof analyzeMontage>, only?: Set<string>) => {
    const needs = assetNeeds(analysis.blocks);
    // Footage is not here: its window was chosen by eye against the words said, in pickFootageWindows.
    const wanted: { key: string; need: string; redraw: string; real?: boolean; logo?: string; screen?: { url: string; find?: string }; cutout?: boolean }[] = [
      ...(needs.screens ?? []).filter(sh => toCheck.has(screenKey(sh))).map(sh => ({ key: screenKey(sh), screen: sh, redraw: "",
        need: `скриншот настоящей страницы ${sh.url}${sh.find ? `, на ней видна фраза «${sh.find}»` : ""}. Проверка «я не робот», страница ошибки, пустая страница, окно cookies или подписки поверх половины страницы — ошибка` })),
      ...(needs.cutouts ?? []).filter(c => toCheck.has(cutoutKey(c))).map(c => ({ key: cutoutKey(c), cutout: true, redraw: "",
        need: `вырезанное по контуру фото для бумажного коллажа: ${c.caption ?? c.wiki ?? c.query} — целиком, узнаваемо, с белой бумажной каймой по краю. Куски чужого фона, обрезанная голова, другой человек или предмет, бесформенный обрывок — ошибка. ${NO_PHOTO}` })),
      ...needs.logos.filter(n => toCheck.has(`logo:${n.toLowerCase()}`)).map(n => ({ key: `logo:${n.toLowerCase()}`, logo: n, redraw: "",
        need: `логотип «${n}»: сам знак или эмблема бренда, крупно и чётко, на прозрачном или ровном фоне; фото, баннер сайта с текстом, скриншот или коллаж — ошибка` })),
      ...(needs.reals ?? []).map(r => ({ key: realKey(r), real: true, redraw: "",
        need: `настоящее фото, на котором сам ${r.caption ?? r.wiki ?? r.query}: он виден и узнаваем. Табличка, книга, здание или другой человек вместо него — ошибка. ${NO_PHOTO}` })),
      ...needs.scenes.map(prompt => ({ key: `scene:${prompt}`, need: prompt, redraw: prompt })),
      ...needs.photos.map(query => ({ key: `photo:${query}`, need: needs.looks[query] ?? query, redraw: needs.looks[query] ?? query })),
      ...needs.morphs.map(m => ({ key: `morph:${m.from.toFixed(2)}`, need: `автор в той же позе и комнате превращён в ${m.into}`, redraw: "" })),
    ].filter(w => input.assets[w.key] && (only ? only.has(w.key) : verified.get(w.key) !== pictureVersion(w))).slice(0, 20);
    if (!wanted.length) return;
    job.onStage?.("check");
    const images: BridgeImage[] = [];
    for (const w of wanted) {
      // A transparent mark is laid on white: on the default black a dark logo would vanish.
      const buffer = await sharp(path.join(publicDir, input.assets[w.key])).flatten({ background: "#ffffff" }).resize(640, 800, { fit: "inside" }).jpeg({ quality: 82 }).toBuffer();
      images.push({ base64: buffer.toString("base64"), mediaType: "image/jpeg" });
    }
    const user = [
      "Перед рендером проверь картинки, которые войдут в ролик. Картинка займёт весь вертикальный экран телефона; если она шире экрана, экран кадрируется по важной части.",
      "Для каждой ответь, показывает ли она требуемое: нужные участники и их число, нужные предметы (пистолет — это пистолет, а не автомат), действие, место.",
      "Хорошая картинка похожа на настоящее фото и читается с первого взгляда.",
      "Ошибка — это то, что зритель заметит: другой предмет (автомат вместо пистолета), не те участники (девочка вместо парня), нет главного действия, мультяшность, главный объект обрезан краем картинки.",
      "Мелочи — не ошибка: чуть другое число людей в толпе, другой ракурс, другой цвет фона. Такие картинки принимай.",
      "Отметь span — левую и правую границу всего важного на картинке в долях ширины (от 0 до 1): людей, машину, предмет целиком.",
      "", ...wanted.map((w, i) => `${i + 1}. должно быть: ${w.need}`), "",
      `Ответ — только JSON: {"1": {"ok": true, "span": [0.2, 0.75]}, "2": {"ok": false, "problem": "что не так, одной фразой по-английски", "span": [0.1, 0.9]}}`,
    ].join("\n");
    log(`Астра проверяет картинки: ${wanted.length}...`);
    const result = await askAstra("Ты — Астра, монтажёр. Проверяешь картинки для ролика перед рендером.", user, images);
    let verdicts: Record<string, { ok?: boolean; problem?: string; span?: [number, number] }> = {};
    try { verdicts = JSON.parse(result.text.slice(result.text.indexOf("{"), result.text.lastIndexOf("}") + 1)); } catch { return; }
    fs.writeFileSync(path.join(outDir, `pictures-check-${Date.now()}.json`), JSON.stringify({ wanted, verdicts }, null, 2));
    const redrawn = new Set<string>();
    const redraws: { w: (typeof wanted)[number]; problem: string }[] = [];
    for (const [index, w] of wanted.entries()) {
      const verdict = verdicts[String(index + 1)];
      const span = verdict?.span;
      const size = input.sizes[w.key];
      let problem = verdict?.ok === false ? verdict.problem ?? "it did not show the described scene" : undefined;
      if (Array.isArray(span) && span.length === 2 && span.every(n => typeof n === "number" && n >= 0 && n <= 1) && span[0] < span[1] && size) {
        input = { ...input, sizes: { ...input.sizes, [w.key]: { ...size, span: [span[0], span[1]] } } };
        // A vertical screen shows only part of the width: the important part has to fit into it.
        const visible = Math.min(1, (1080 / 1920) / (size.w / size.h));
        // Only a drawn picture can be reframed; a real photo is framed by the kit on its important part.
        if (canDraw && !problem && !only && size.w / size.h <= 0.85 && span[1] - span[0] > visible + 0.12) {
          problem = `everything important spans ${Math.round((span[1] - span[0]) * 100)}% of the width, but a vertical phone screen shows only the central ${Math.round(visible * 100)}%: reframe closer so the subject is large and fits in the central part`;
        }
      }
      if (w.logo) {
        const wrong = verdict?.ok === false ? verdict.problem ?? "it is not the brand's mark" : undefined;
        if (!wrong) { verified.set(w.key, pictureVersion(w)); continue; }
        log(`Логотип не тот: ${w.logo}: ${wrong}`);
        rejectedLogos.set(w.logo.toLowerCase(), wrong);
        discardLogo(w.logo, path.join(publicDir, job.assetCache ?? "asset-cache", "logos"));
        const { [w.key]: _logo, ...rest } = input.assets;
        input = { ...input, assets: rest };
        continue;
      }
      if (w.screen || w.cutout) {
        const wrong = verdict?.ok === false ? verdict.problem ?? "it does not show what is needed" : undefined;
        if (!wrong) { verified.set(w.key, pictureVersion(w)); continue; }
        log(`${w.screen ? "Страница" : "Вырезка"} не годится: ${w.key.slice(0, 70)}: ${wrong}`);
        (w.screen ? rejectedScreens : rejectedCutouts).set(w.key, wrong);
        if (w.screen) discardScreen(w.screen.url, w.screen.find, path.join(publicDir, job.assetCache ?? "asset-cache", "screens"));
        const { [w.key]: _gone, ...rest } = input.assets;
        input = { ...input, assets: rest };
        continue;
      }
      if (w.real) {
        const wrong = verdict?.ok === false ? verdict.problem ?? "it shows someone else" : undefined;
        if (wrong) {
          rejectedReals.set(w.key, wrong);
          log(`Настоящее фото не того: ${w.key.slice(0, 60)}: ${wrong}`);
        } else verified.set(w.key, pictureVersion(w));
        continue;
      }
      if (problem && !canDraw && w.key.startsWith("photo:")) {
        log(`Фото не подходит: ${w.key.slice(6, 66)}: ${problem}`);
        rejectedPhotos.set(w.key.slice(6), problem);
        const { [w.key]: _photo, ...rest } = input.assets;
        input = { ...input, assets: rest };
        continue;
      }
      if (!problem || !w.redraw || only || !canDraw) {
        if (!problem) verified.set(w.key, pictureVersion(w));
        continue;
      }
      redraws.push({ w, problem });
    }
    // Pictures to redraw are drawn at the same time, like the first ones.
    await inPool(redraws.map(({ w, problem }) => async () => {
      log(`Перерисовка ${w.key.slice(0, 60)}: ${problem}`);
      const result = await redrawScene(w.redraw, problem, publicDir, job.assetCache ?? "asset-cache");
      if (result) {
        input = { ...input, assets: { ...input.assets, [w.key]: result.file }, sizes: result.size ? { ...input.sizes, [w.key]: result.size } : input.sizes };
        redrawn.add(w.key);
      }
    }));
    // Redrawn pictures are looked at once more, to frame them; they are not redrawn again.
    if (redrawn.size && !only) {
      await verifyPictures(analysis, redrawn);
      for (const key of redrawn) {
        const w = wanted.find(w => w.key === key)!;
        verified.set(key, pictureVersion(w));
      }
    }
    prepared.remember(needs, input);
  };

  /**
   * The author is cut out for text-behind shots as soon as a montage builds, while its pictures are drawn:
   * both need only its timing. The same ranges asked again share one cut.
   */
  const cutting = new Map<string, Promise<AstraInput["cutouts"]>>();
  const cutouts = (analysis: ReturnType<typeof analyzeMontage>) => {
    const ranges = cutoutRanges(analysis.blocks, input.duration);
    const key = JSON.stringify(ranges);
    let started = cutting.get(key);
    if (!started) {
      log(`Вырезка автора: ${ranges.map(r => `${r.from.toFixed(1)}–${r.to.toFixed(1)}`).join(", ") || "не нужна"}`);
      started = makeCutouts({ video: path.join(publicDir, input.video), publicDir, subdir: `${job.mediaSubdir}/cutouts`, ranges });
      started.catch(() => { /* reported where it is awaited */ });
      cutting.set(key, started);
    }
    return started;
  };

  /** Astra names tracks for this video; the first YouTube has is cut and prepared. Without it the video has no music. */
  const pickMusic = async (analysis: ReturnType<typeof analyzeMontage>) => {
    if (process.env.ASTRA_MUSIC === "0") return null;
    try {
      const pinned = ownerTrack();
      if (pinned) {
        const track = await prepareMusic({ wishes: [], pinned, duration: input.duration, publicDir, subdir: job.mediaSubdir, log });
        if (!track) log("Музыка: трек владельца не скачался — ролик без музыки");
        return track;
      }
      const mood = analysis.blocks.find(b => b.type === "Music")?.props.mood;
      const recent = recentTracks(job.musicHistory).map(t => t.title);
      const result = await askAstra("Ты — Астра, монтажёр. Подбираешь музыку к ролику.", musicPrompt(task, typeof mood === "string" ? mood : undefined, recent));
      const wishes = (JSON.parse(result.text.slice(result.text.indexOf("{"), result.text.lastIndexOf("}") + 1)) as { tracks?: TrackWish[] }).tracks ?? [];
      fs.writeFileSync(path.join(outDir, "music-wishes.json"), JSON.stringify(wishes, null, 2));
      const track = await prepareMusic({ wishes: wishes.filter(w => typeof w?.query === "string"), duration: input.duration, publicDir, subdir: job.mediaSubdir, log, historyFile: job.musicHistory });
      if (!track) log("Музыка: ни один из треков не нашёлся — ролик без музыки");
      return track;
    } catch (error) {
      log(`Музыка не подобрана: ${String((error as Error)?.message ?? error).slice(0, 160)}`);
      return null;
    }
  };

  job.onStage?.("write");
  let { code, analysis } = await settle(job.startCode ?? await ask("montage-v1", taskPrompt(task)), "v1");
  // The owner's remarks on the previous montage: Astra changes those places and keeps everything else.
  if (job.startCode && job.remarks?.length) {
    ({ code, analysis } = await settle(await ask("montage-remarks", remarksPrompt(task, code, job.remarks)), "remarks"));
  }
  // The music is chosen for this video and fetched while its pictures are checked and its draft is reviewed.
  const music = pickMusic(analysis);
  await verifyPictures(analysis);
  // A real photo of someone else, or footage of something else, goes back to Astra: she shows that moment another way.
  if (rejectedReals.size || rejectedFootage.size || rejectedLogos.size || rejectedPhotos.size || rejectedScreens.size || rejectedCutouts.size) {
    ({ code, analysis } = await settle(code, "v1-real"));
    await verifyPictures(analysis);
  }
  job.onStage?.("cutout");
  input = { ...input, cutouts: await cutouts(analysis) };

  const voice = await job.voice;
  if (voice) input = { ...input, voice };
  if (job.hyperframes && profile === "craft-v1") input = await prepareHyperGraphics({ blocks: analysis.blocks, code, input, publicDir, workDir: outDir, log });
  if (!job.skipReview) {
    log("Кадры черновика...");
    job.onStage?.("draft", 0);
    const { images, labels } = await draftStills({ workspace: prepareWorkspace(code, `${path.basename(outDir)}-draft`), publicDir, input,
      workDir: path.join(outDir, "draft-frames"), moments: keyMoments(analysis.blocks, input.duration, profile) });
    job.onStage?.("review");
    const rejectedBefore = rejectedReals.size + rejectedFootage.size + rejectedLogos.size + rejectedPhotos.size + rejectedScreens.size + rejectedCutouts.size;
    ({ code, analysis } = await settle(await askPatch("montage-review", reviewPrompt({ ...task, input }, code, labels, analysis.notes), code, images, true), "review"));
    await verifyPictures(analysis);
    // A picture the review brought in and the check turned down goes back to Astra once more: otherwise its place stays empty.
    if (rejectedReals.size + rejectedFootage.size + rejectedLogos.size + rejectedPhotos.size + rejectedScreens.size + rejectedCutouts.size > rejectedBefore) {
      ({ code, analysis } = await settle(code, "review-real"));
      await verifyPictures(analysis);
    }
    input = { ...input, cutouts: await cutouts(analysis) };
    if (job.hyperframes && profile === "craft-v1") input = await prepareHyperGraphics({ blocks: analysis.blocks, code, input, publicDir, workDir: outDir, log });
  }
  const track = await music;
  // The track found for this video plays whatever mood the montage asks for.
  if (track) input = { ...input, music: Object.fromEntries(["calm", "curious", "upbeat", "tense", "dramatic", "playful"].map(mood => [mood, [track.file]])) };
  fs.writeFileSync(path.join(outDir, "Montage.tsx"), code);
  fs.writeFileSync(path.join(outDir, "input.json"), JSON.stringify(input));

  log("Финальный рендер...");
  const final = path.join(outDir, "final.mp4");
  let last = -1;
  job.onStage?.("final", 0);
  const frames = await job.frames;
  if (!frames) log("Кадры записи не готовы: рендер по видеофайлу, он медленнее");
  const queueStarted = Date.now();
  await job.beforeRender?.();
  const renderStarted = Date.now();
  const renderQueueWaitMs = renderStarted - queueStarted;
  try {
    await renderVideo({
      workspace: prepareWorkspace(code, `${path.basename(outDir)}-final`), publicDir, input: frames ? { ...input, frames } : input, out: final,
      onProgress: f => {
        job.onStage?.("final", f);
        const p = Math.floor(f * 10) * 10;
        if (p !== last) { last = p; log(`рендер ${p}%`); }
      },
    });
    const renderMs = Date.now() - renderStarted;
    fs.writeFileSync(path.join(outDir, "render-timing.json"), JSON.stringify({ renderMs, renderQueueWaitMs, framesPrepared: Boolean(frames), duration: input.duration, fps: input.fps }, null, 2));
    log(`Рендер: ${(renderMs / 1000).toFixed(0)} с; ожидание рендера: ${(renderQueueWaitMs / 1000).toFixed(0)} с`);
  } finally {
    removeFrames(publicDir, frames);
  }
  log(`Готово: ${final}`);
  return { code, input, final };
}
