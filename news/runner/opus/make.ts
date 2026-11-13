/**
 * Монтаж «Опус 5.5» одной записи владельца с главной: голос и лицо — из его записи (сайт уже вырезал паузы и дубли),
 * картинка — как в «Новостях»: настоящие кадры, страницы сайтов под маркером, числа, логотипы, фото, мемы, субтитры
 * движка «Новостей». Владелец в кадре там, где говорит от себя; губы совпадают со звуком — кадр записи берётся с той же
 * секунды, где звучит слово.
 */
import fs from "node:fs";
import path from "node:path";
import { makeInserts } from "../pipeline/inserts";
import { makeOverlays } from "../pipeline/overlays";
import { render } from "../pipeline/montage";
import { listTracks, prepareBed } from "../pipeline/sounds";
import { ffmpeg, duration, mapLimit, run, writeJson, type Hooks } from "../pipeline/util";
import type { Hit, Look, NewsPlan } from "../../engine/src/plan";
import { on } from "../pipeline/features";
import { numberRuns, runValue } from "../pipeline/words";
import { closeBrowser, footage, screen, type Shot } from "./assets";
import { pickMoment } from "./moment";
import { chartClip } from "./chart";
import { confirm, direct, type OpusDraft, type OpusShot, type OpusWord } from "./director";

export type OpusInput = { topic: string; script: string; words: OpusWord[] };

const LINE = "own";
/** Кадр короче этого не успевают разглядеть — он сливается с соседним. */
const MIN_SHOT = 1.2;
const MUSIC_VOLUME = 0.039;
const ACCENT: Record<NonNullable<OpusDraft["accents"]>[number]["kind"], Omit<Hit, "line" | "w">> = {
  kick: { kick: 0.06 },
  glitch: { kick: 0.07, sfx: "glitch" },
  boom: { kick: 0.09, shake: true, sfx: "boom" },
  cash: { kick: 0.05, sfx: "cash" },
};

/** Раскладка режиссёра, приведённая в порядок: по возрастанию, с первого слова, без коротких вспышек. */
function tidy(shots: OpusShot[], words: OpusWord[], end: number): OpusShot[] {
  const valid = shots
    .filter((s) => Number.isInteger(s.word) && s.word >= 0 && s.word < words.length)
    .sort((a, b) => a.word - b.word)
    .filter((s, i, all) => i === 0 || s.word !== all[i - 1].word);
  if (!valid.length || valid[0].word !== 0) valid.unshift({ word: 0, show: "owner" });
  const start = (s: OpusShot) => (s.word === 0 ? 0 : words[s.word].s);
  const out: OpusShot[] = [];
  for (let i = 0; i < valid.length; i++) {
    const next = i + 1 < valid.length ? start(valid[i + 1]) : end;
    if (next - start(valid[i]) < MIN_SHOT && out.length) continue;
    // два плана автора подряд — один план
    if (valid[i].show === "owner" && out.at(-1)?.show === "owner") continue;
    out.push(valid[i]);
  }
  return out;
}

export async function makeOpus(workDir: string, source: string, input: OpusInput, hooks: Hooks): Promise<{ file: string; duration: number }> {
  const pub = path.join(workDir, "public");
  for (const d of ["clips", "vo", "sfx", "stills", "src"]) fs.mkdirSync(path.join(pub, d), { recursive: true });
  // шрифт и вспышка движка — сразу: график рисуется раньше монтажа и без шрифта падал (проба 5.11)
  const engineAssets = path.join(import.meta.dirname, "..", "..", "engine", "assets");
  for (const d of ["fx", "fonts"]) fs.cpSync(path.join(engineAssets, d), path.join(pub, d), { recursive: true });
  const words = input.words.filter((w) => w.w.trim() && w.e >= w.s);
  if (words.length < 5) throw new Error("В записи слишком мало распознанных слов для монтажа");

  await hooks.step("Готовим запись автора", 3);
  // запись автора: картинка — 1080×1920 30 к/с без звука, голос — отдельной дорожкой (её ведёт движок как реплику)
  await ffmpeg(["-i", source, "-vf", "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=30", "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "17", "-pix_fmt", "yuv420p", path.join(pub, "clips", "owner.mp4")], hooks.signal);
  await ffmpeg(["-i", source, "-vn", "-ac", "2", "-ar", "48000", "-c:a", "pcm_s16le", path.join(pub, "vo", `${LINE}.wav`)], hooks.signal);
  const end = Math.max(words.at(-1)!.e, await duration(path.join(pub, "vo", `${LINE}.wav`)));

  await hooks.step("Claude подбирает кадры к словам", 8);
  const draft = await direct(words, input.topic, input.script);
  writeJson(path.join(workDir, "draft.json"), draft);
  const seen = new Set<string>();
  // одна и та же страница или тот же кусок видео — один раз: повторы читались как нехватка материала (проба 5.11)
  const shots = tidy(draft.shots.map((s) => {
    const key = s.show === "screen" ? s.url : s.show === "footage" ? `${s.url}@${Math.round(Number(s.at) || 0)}` : "";
    if (!key) return s;
    if (seen.has(key)) return { word: s.word, show: "owner" as const };
    seen.add(key);
    return s;
  }), words, end);
  const startOf = (i: number) => (shots[i].word === 0 ? 0 : words[shots[i].word].s);
  const endOf = (i: number) => (i + 1 < shots.length ? startOf(i + 1) : end);

  await hooks.step(`Добываем кадры: ${shots.filter((s) => s.show !== "owner").length}`, 35);
  type Got = { key: string; kind: "clip" | "still"; file: string; what: string; markY?: number; ours?: boolean; sweep?: Shot["sweep"] };
  const got = new Map<number, Got>();
  const taken: { url: string; at: number }[] = [];
  await mapLimit(shots.map((s, i) => [s, i] as const), 3, async ([s, i]) => {
    try {
      if (s.show === "footage" && s.url) {
        const key = `f${i}`;
        const len = endOf(i) - startOf(i);
        // секунда — по кадрам самого ролика, секунда режиссёра — только подсказка, где искать
        const moment = await pickMoment(s.url, Math.max(0, Number(s.at) || 0), len, s.what, path.join(workDir, "moments", key), hooks.signal);
        // тот же момент того же ролика уже стоит в монтаже — повтор читался как нехватка материала
        if (moment && taken.some((x) => x.url === s.url && Math.abs(x.at - moment.at) < len + 1)) {
          hooks.log(`видео ${i}: этот момент уже в ролике — ${s.url} с ${moment.at} с`);
          return;
        }
        if (moment) taken.push({ url: s.url, at: moment.at });
        const at = moment?.at ?? null;
        if (at === null) {
          hooks.log(`видео ${i}: в ролике нет «${s.what}» или он не открылся — ${s.url}`);
          return;
        }
        const file = await footage(s.url, at, at + len + 1.5, path.join(pub, "clips", `${key}.mp4`), hooks.signal, moment!);
        if (file) got.set(i, { key, kind: "clip", file, what: s.what });
        hooks.log(`видео ${i}: ${file ? "есть" : "не скачалось"} — ${s.url} с ${at} с (режиссёр называл ${s.at})`);
      } else if (s.show === "chart" && s.slug) {
        const key = `g${i}`;
        // итог графика встаёт на слове, где автор называет сумму: из чисел, что звучат на этом плане, берётся то, что ближе
        // всего к итогу графика, а если числа сказаны словами — последнее. Линия дорисовывается к этому слову
        const said = (total: number) => {
          if (!on("wordSync")) return undefined;
          const from = startOf(i);
          const runs = numberRuns(words).filter(([a]) => words[a].s >= from + 0.8 && words[a].s < endOf(i) - 0.3);
          if (!runs.length) return undefined;
          const off = (r: [number, number]) => Math.abs(Math.log10(runValue(words, r) / Math.max(1e-9, total)));
          const close = runs.filter((r) => off(r) < 0.5).sort((x, y) => off(x) - off(y))[0];
          // клип начинается на 0,05 с раньше слова плана (смена плана в движке)
          return words[(close ?? runs[runs.length - 1])[0]].s - (shots[i].word === 0 ? 0 : from - 0.05);
        };
        const file = await chartClip({ coin: s.coin, slug: s.slug, date: s.date, amount: Number(s.amount), price: Number(s.price) }, endOf(i) - startOf(i) + 0.4, pub, path.join(pub, "clips", `${key}.mp4`), hooks, said);
        if (file) got.set(i, { key, kind: "clip", file, what: "график", ours: true });
        hooks.log(`график ${i}: ${file ? "есть" : "нет истории цены"} — ${s.slug} с ${s.date}`);
      } else if (s.show === "screen" && s.url && s.phrase) {
        const shot = await screen(s.url, s.phrase, path.join(pub, "stills", `s${i}.png`));
        if (shot) got.set(i, { key: `s${i}`, kind: "still", file: shot.file, what: `${s.what} (фраза «${s.phrase}» выделена маркером)`, markY: shot.markY, sweep: shot.sweep });
        hooks.log(`страница ${i}: ${shot ? "есть" : "нет фразы или не открылась"} — ${s.url}`);
      }
    } catch (error) {
      hooks.log(`кадр ${i} не добыт: ${(error as Error).message}`);
    }
  });
  await closeBrowser();

  // глазами: на кадре то, что обещано (не заглушка, не капча, не чужое видео)
  if ([...got.values()].some((g) => !g.ours)) {
    await hooks.step("Проверяем кадры", 52);
    // свой график проверять незачем — его рисуем мы
    const list = [...got.entries()].filter(([, g]) => !g.ours);
    const frames = await Promise.all(list.map(async ([i, g]) => {
      if (g.kind === "still") return fs.readFileSync(g.file);
      // три кадра куска — начало, середина, конец: по одному кадру проверка не видела, что план сменился на заставку
      const jpg = path.join(workDir, `check_${i}.jpg`);
      const len = Math.max(1, endOf(i) - startOf(i));
      const frames = [18, Math.round(len * 15), Math.max(19, Math.round(len * 30) - 6)];
      await ffmpeg(["-i", g.file, "-vf", `select='${frames.map((n) => `eq(n\\,${n})`).join("+")}',scale=360:-2,tile=3x1`, "-frames:v", "1", "-vsync", "vfr", jpg], hooks.signal);
      return fs.readFileSync(jpg);
    }));
    const ok = await confirm(list.map(([, g], k) => ({ what: g.what, image: frames[k].toString("base64"), mediaType: g.kind === "still" ? "image/png" : "image/jpeg" }))).catch((error: Error) => {
      hooks.log(`проверка кадров не вышла: ${error.message} — оставляем как есть`);
      return list.map(() => true);
    });
    list.forEach(([i, g], k) => {
      if (ok[k]) return;
      hooks.log(`кадр ${i} не прошёл проверку (${g.what}) — там будет автор`);
      got.delete(i);
    });
  }

  // план движка «Новостей»: одна реплика — запись автора целиком, планы сменяются на словах
  const clips: NewsPlan["clips"] = { owner: { file: "clips/owner.mp4", gain: 0 } };
  const looks: (Look & { w: number })[] = [];
  shots.forEach((s, i) => {
    const g = got.get(i);
    const w = s.word;
    const at = w === 0 ? 0 : Math.max(0, words[w].s - 0.05);
    let look: Look & { w: number };
    if (g?.kind === "clip") {
      clips[g.key] = { file: `clips/${g.key}.mp4`, gain: 0 };
      // на графике субтитры — внизу, под осью лет: на обычной высоте они легли бы на линию
      look = { w, clip: g.key, at: 0, maxAt: Math.max(0, endOf(i) - startOf(i) + 1.4), ...(g.ours ? { subY: 1720 } : {}), ...(looks.length ? { sfx: "pop" } : {}) };
    } else if (g?.kind === "still") {
      // субтитры — у нижнего края страницы, мимо выделенной фразы (она в верхней части снимка): на обычной высоте они
      // ложились на строки статьи (проба 5.11)
      // маркер проводится по строке, когда страница уже в кадре: взгляд приходит к фразе на словах автора о ней
      const sweep = g.sweep && looks.length && on("screenSweep") ? { sweep: { base: `stills/${path.basename(g.sweep.base)}`, rects: g.sweep.rects } } : {};
      look = { w, still: `stills/${path.basename(g.file)}`, subY: g.markY !== undefined && g.markY > 1350 ? 560 : 1700, ...sweep, ...(looks.length ? { sfx: "pop" } : {}) };
    } else {
      look = { w, clip: "owner", at };
    }
    // план автора после планов автора — один (проверка кадров могла убрать вставку между ними)
    const prev = looks.at(-1);
    if (look.clip === "owner" && prev?.clip === "owner") return;
    looks.push(look);
  });
  if (looks[0]) looks[0] = { ...looks[0], zoomFrom: 1.25, focusY: 760 };
  const plan: NewsPlan = {
    clips,
    lines: { [LINE]: { file: `vo/${LINE}.wav`, words, end, speaker: "narrator" } },
    segments: [{ narr: LINE, shots: looks }],
    hits: (draft.accents ?? []).filter((a) => words[a.word] && ACCENT[a.kind]).map((a) => ({ line: LINE, w: a.word, ...ACCENT[a.kind] })),
    music: null,
  };
  const at = (x: { word: number }) => ({ line: LINE, word: x.word });
  await hooks.step("Фото, логотипы и мемы", 58);
  await makeInserts(workDir, pub, plan, {
    inserts: [],
    memes: (draft.memes ?? []).map((m) => ({ ...at(m), meme: m.meme, why: m.why })),
    people: (draft.people ?? []).map((p) => ({ ...at(p), name: p.name })),
    logos: (draft.logos ?? []).map((l) => ({ ...at(l), brand: l.brand, domain: l.domain })),
  }, hooks);
  // наклейки — только поверх самого автора: на странице сайта они закрывали выделенную фразу, на чужом видео — его кадр;
  // логотипы — ниже его лица и субтитров (по умолчанию они стоят на высоте лица — пробный ролик 5.11: значок Telegram на лбу)
  const shotAt = (w: number) => [...looks].reverse().find((l) => l.w <= w) ?? looks[0];
  if (plan.inserts) {
    // и не на последних трёх секундах: там звучит и стоит итог (проба 5.11 — мем с котом закрыл «сто пять миллионов»)
    plan.inserts = plan.inserts.filter((x) => shotAt(x.w)?.clip === "owner" && words[x.w].s < end - 3).map((x) => (x.kind === "logo" ? { ...x, cy: (x.cy ?? 900) + 650 } : x));
    if (!plan.inserts.length) delete plan.inserts;
  }
  await makeOverlays(workDir, pub, plan, {
    marks: [],
    chats: [],
    numbers: (draft.numbers ?? []).map((n) => ({ ...at(n), value: n.value, prefix: n.prefix, suffix: n.suffix, label: n.label })),
    places: (draft.places ?? []).map((p) => ({ ...at(p), country: p.country, name: p.name })),
  }, hooks);

  const made = await render(workDir, plan, hooks, 62);

  // музыка — первый трек «Новостей» под голосом, как сайт кладёт её под ролики «Новостей»
  await hooks.step("Музыка", 97);
  const track = (await listTracks())[0];
  if (!track) return made;
  const bed = await prepareBed(track);
  const final = path.join(workDir, "final.mp4");
  const fadeOut = Math.max(0, made.duration - 0.5).toFixed(3);
  await run("ffmpeg", ["-y", "-v", "error", "-i", made.file, "-stream_loop", "-1", "-i", bed, "-filter_complex",
    `[1:a]volume=${MUSIC_VOLUME},afade=t=in:d=0.33,afade=t=out:st=${fadeOut}:d=0.5[m];[0:a][m]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.93:level=disabled[a]`,
    "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", final], { signal: hooks.signal });
  hooks.log(`музыка: ${track.title}`);
  return { file: final, duration: await duration(final) };
}
