// Проверка готового ролика (по motion-video-kit, 31.10; владелец: «без проверок… добавляй»): замершие и чёрные места,
// громкость, лист кадров — и свежий критик, который ролик не монтировал («кто монтирует, тот не судит»): смотрит лист
// кадров и текст и ставит оценку. Ничего не останавливает и ролик не меняет: пишет в журнал и в qc/ папки задания —
// чтобы брак был виден до того, как его увидит владелец.
// 11.11 (по motionmaxxing slop.md и video-talkcraft): вставки проверяются по плану ролика — стоит ли каждая на своём
// слове, не висит ли без движения, не обрезана ли, не легла ли на другую, — а критик видит крупные кадры вставок и
// судит, событие в кадре или слайд.
import fs from "node:fs";
import path from "node:path";
import { FPS, layout } from "../../engine/src/layout";
import type { NewsPlan } from "../../engine/src/plan";
import { on } from "./features";
import { claudeJson } from "./llm";
import { duration, ffmpeg, loudness, run, writeJson, type Hooks } from "./util";
import { isNumeric } from "./words";

/** Замерший кадр дольше этого — брак: у стоп-кадров движка идёт наезд, они не замирают. */
const FROZEN_SECONDS = 1.0;
/** Картинка стоит дольше этого — уже читается как слайд (motionmaxxing: держать неподвижно можно до 0,6 с, дольше — только развязку). */
const STILL_SECONDS = 0.6;
/** Средняя разница соседних кадров (0–255, кадр 320 px), ниже которой картинка стоит. */
const STILL_DIFF = 0.15;
const SHEET_STEP = 1.5;

/** Отрезки, где картинка стоит не меньше min секунд. */
async function still(file: string, min: number, signal?: AbortSignal): Promise<[number, number][]> {
  const { stderr } = await run("ffmpeg", ["-hide_banner", "-i", file, "-vf", "fps=10,scale=320:-1,format=gray,tblend=all_mode=difference,signalstats,metadata=print:key=lavfi.signalstats.YAVG", "-an", "-f", "null", "-"], { signal });
  const diffs = [...stderr.matchAll(/YAVG=([\d.]+)/g)].map((m) => Number(m[1]));
  const out: [number, number][] = [];
  let from = -1;
  diffs.forEach((d, i) => {
    if (d < STILL_DIFF && from < 0) from = i;
    if ((d >= STILL_DIFF || i === diffs.length - 1) && from >= 0) {
      if ((i - from) / 10 >= min) out.push([from / 10, i / 10]);
      from = -1;
    }
  });
  return out;
}

async function black(file: string, signal?: AbortSignal): Promise<[number, number][]> {
  const { stderr } = await run("ffmpeg", ["-hide_banner", "-i", file, "-vf", "blackdetect=d=0.25:pix_th=0.08", "-an", "-f", "null", "-"], { signal });
  return [...stderr.matchAll(/black_start:([\d.]+) black_end:([\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
}

async function truePeak(file: string): Promise<number> {
  const { stderr } = await run("ffmpeg", ["-hide_banner", "-nostats", "-i", file, "-vn", "-af", "ebur128=peak=true:framelog=quiet", "-f", "null", "-"]);
  const m = [...stderr.matchAll(/Peak:\s+(-?[\d.]+) dBFS/g)].pop();
  return m ? Number(m[1]) : 0;
}

/** Текст ролика по порядку: что говорит автор, где звучит герой, перевод. */
function script(plan: NewsPlan): string {
  const said = (id: string) => plan.lines[id]?.words.map((w) => w.w).join(" ") ?? "";
  return plan.segments
    .map((s, i) => ("narr" in s ? `${i}. АВТОР: «${said(s.narr)}»` : "dub" in s ? `${i}. ГЕРОЙ, перевод: «${s.lines.map((l) => said(l.id)).join(" ")}»` : s.orig.startsWith("vm_") ? `${i}. ВИДЕОМЕМ ${s.orig.slice(3)}` : `${i}. ГЕРОЙ своим голосом, ${(s.to - s.from).toFixed(1)} с`))
    .join("\n");
}

// ---- вставки по плану ролика

const KIND: Record<string, string> = { sticker: "наклейка", meme: "мем", photo: "фото", logo: "логотип", mark: "обводка", chat: "переписка", number: "число", map: "карта", mapfly: "карта с подлётом" };
/** Вставка стоит неподвижно дольше — кадр под ней читается как слайд, если в ней самой ничего не живёт. */
const HOLD_STILL = 1.2;
/** Дольше этого вставка висит, даже если чуть движется (владелец 1.11 о логотипах: «долго висели»). */
const HOLD_LONG = 3;
/** Итог числа и сообщение переписки должны простоять столько, чтобы их прочли. */
const READ_NUMBER = 0.45;
const READ_MESSAGE = 0.8;

export type InsertFact = { at: number; kind: string; what: string };
/** build — сколько секунд от прихода вставка ещё строится; parts — из скольких частей (сообщения переписки). */
type Placed = { kind: string; t: number; dur: number; word: number; asked: number; line: string; w: number; label: string; build: number; parts: number };

/**
 * Что видно по плану, не глядя в ролик: время каждой вставки считается той же раскладкой, что у движка
 * (engine/src/layout.ts). Хорошая вставка стоит на слове, которое её называет, приходит и уходит движением, пока стоит —
 * живёт, держится столько, сколько нужно, чтобы прочитать, и в кадре она одна.
 */
export function checkInserts(plan: NewsPlan): { count: number; facts: InsertFact[] } {
  const L = layout(plan);
  const motion = plan.fx?.motion === true;
  const facts: InsertFact[] = [];
  const said = (line: string, w: number) => plan.lines[line].words.slice(w, w + 3).map((x) => x.w).join(" ");
  const list: Placed[] = [
    ...L.inserts.map((x) => ({ kind: x.kind ?? "sticker", t: x.t, dur: x.dur, word: x.word, asked: x.asked, line: x.line, w: x.w, label: path.basename(x.file).replace(/\.\w+$/, ""), build: 0, parts: 1 })),
    ...L.overlays.map((x) => {
      const frames = Math.round(x.dur * FPS);
      // сколько вставка ещё строится после прихода: отсчёт числа, сообщения переписки, наезд карты
      const build = x.kind === "number" ? (motion ? Math.max(6, Math.min(16, Math.round(frames * 0.4))) : Math.max(10, Math.round(frames * 0.65))) / FPS
        : x.kind === "chat" ? (4 + (x.messages.length - 1) * Math.max(8, Math.floor((frames - 12) / Math.max(1, x.messages.length)))) / FPS
        : x.kind === "map" ? (Math.round(frames * 0.55) + 8) / FPS
        : x.kind === "mapfly" ? x.dur : 0.3;
      const label = x.kind === "number" ? `${x.prefix ?? ""}${x.value}${x.suffix ?? ""}` : x.kind === "chat" ? `${x.messages.length} сообщ.` : x.kind === "mark" ? x.shape : x.name;
      return { kind: x.kind as string, t: x.t, dur: x.dur, word: x.word, asked: x.asked, line: x.line, w: x.w, label, build, parts: x.kind === "chat" ? x.messages.length : 1 };
    }),
  ].sort((a, b) => a.t - b.t);
  const name = (e: Placed) => `${KIND[e.kind] ?? e.kind} «${e.label}»`;
  const add = (e: Placed, what: string) => facts.push({ at: Number(e.t.toFixed(2)), kind: e.kind, what: `${name(e)}: ${what}` });

  const lost = (plan.inserts?.length ?? 0) + (plan.overlays?.length ?? 0) - list.length;
  if (lost > 0) facts.push({ at: 0, kind: "plan", what: `${lost} из вставок плана в ролик не встали: нет слова, попали на заставку или на видеомем` });
  // приход и уход, кадры: прежние прыжки — около 8 и 4, по измеренным числам — 12 и 10
  const [tin, tout] = motion ? [12 / FPS, 10 / FPS] : [8 / FPS, 4 / FPS];
  // пока стоит, живёт: с fx.motion карточки, знаки и числа чуть подрастают; карта с подлётом — видео
  const alive = (e: Placed) => e.kind === "mapfly" || (motion && ["sticker", "meme", "photo", "logo", "number"].includes(e.kind));
  for (const e of list) {
    if (e.t - e.word > 0.15) add(e, `сдвинута на ${(e.t - e.word).toFixed(2)} с позже своего слова «${said(e.line, e.w)}» — её слово звучит под заставкой`);
    if (e.dur < e.asked * 0.6) add(e, `обрезана до ${e.dur.toFixed(2)} с из ${e.asked.toFixed(2)} — её не успеть разглядеть`);
    if (e.kind === "number" && !isNumeric(plan.lines[e.line].words[e.w].w)) add(e, `стоит на слове «${said(e.line, e.w)}», а число звучит на другом`);
    // сколько вставка стоит готовой: без прихода, ухода и того, что она ещё строится (отсчёт, сообщения, наезд карты)
    const hold = e.kind === "mapfly" ? 0 : e.dur - tout - Math.max(tin, e.build);
    if (hold > HOLD_STILL && !alive(e)) add(e, `после прихода стоит ${hold.toFixed(1)} с без движения`);
    else if (hold > HOLD_LONG) add(e, `висит ${hold.toFixed(1)} с — дольше, чем её читают`);
    if (e.kind === "number" && hold < READ_NUMBER) add(e, `итог после отсчёта виден ${Math.max(0, hold).toFixed(2)} с — не прочитать`);
    if (e.kind === "chat" && e.dur / e.parts < READ_MESSAGE) add(e, `на сообщение меньше ${READ_MESSAGE} с — не прочитать`);
    if (!motion && (e.kind === "mark" || e.kind === "number")) add(e, "уходит одной прозрачностью, без движения");
    if (e.kind === "mark" && !plan.fx?.wordLead) {
      // обводка нарисована по кадру своего плана; после смены плана она обводит чужой кадр
      const p = L.placed.find((q) => "narr" in q.seg && q.seg.narr === e.line);
      const next = p && "narr" in p.seg ? p.seg.shots.find((s) => s.w > e.w) : undefined;
      const over = p ? e.t + e.dur - (next ? p.start + plan.lines[e.line].words[next.w].s - 0.05 : p.start + p.dur) : 0;
      if (over > 0.1) add(e, `${over.toFixed(2)} с висит на следующем плане, где этой детали нет`);
    }
  }
  // одна главная вещь в кадре: стопка логотипов — одна вещь, обводка с числом или мем с числом — уже две
  list.forEach((a, i) => {
    for (const b of list.slice(i + 1)) {
      if (a.kind === "logo" && b.kind === "logo") continue;
      const both = Math.min(a.t + a.dur, b.t + b.dur) - b.t;
      if (both > 0.3) facts.push({ at: Number(b.t.toFixed(2)), kind: "pair", what: `${name(a)} и ${name(b)} в кадре вместе ${both.toFixed(1)} с — взгляду некуда встать` });
      else if (b.t - a.t < 0.3) facts.push({ at: Number(b.t.toFixed(2)), kind: "pair", what: `${name(a)} и ${name(b)} приходят подряд через ${(b.t - a.t).toFixed(2)} с — сливаются в одно мелькание` });
    }
  });
  return { count: list.length, facts: facts.sort((a, b) => a.at - b.at) };
}

/** Крупные кадры вставок в момент, когда они уже встали (до 8, по порядку): лист 4×2 и подписи к нему для критика. */
async function insertSheet(dir: string, file: string, plan: NewsPlan, length: number, signal?: AbortSignal): Promise<{ sheet: string; notes: string[] } | null> {
  const L = layout(plan);
  const said = (line: string, w: number) => plan.lines[line].words.slice(w, w + 3).map((x) => x.w).join(" ");
  const all = [
    ...L.inserts.map((x) => ({ t: x.t, dur: x.dur, what: `${KIND[x.kind ?? "sticker"]} (${path.basename(x.file).replace(/\.\w+$/, "")}) на словах «${said(x.line, x.w)}»` })),
    ...L.overlays.map((x) => ({ t: x.t, dur: x.dur, what: `${KIND[x.kind]}${x.kind === "number" ? ` ${x.prefix ?? ""}${x.value}${x.suffix ?? ""}` : x.kind === "mark" ? ` (${x.shape})` : ""} на словах «${said(x.line, x.w)}»` })),
  ].sort((a, b) => a.t - b.t).slice(0, 8);
  if (!all.length) return null;
  const frames = path.join(dir, "inserts");
  fs.rmSync(frames, { recursive: true, force: true });
  fs.mkdirSync(frames, { recursive: true });
  for (const [i, e] of all.entries()) {
    // кадр, где вставка уже встала и ещё не уходит
    const at = Math.min(length - 0.1, e.t + Math.min(0.6, e.dur * 0.6));
    await ffmpeg(["-ss", at.toFixed(3), "-i", file, "-frames:v", "1", "-vf", "scale=270:480", "-q:v", "3", path.join(frames, `${String(i).padStart(2, "0")}.jpg`)], signal);
  }
  const sheet = path.join(dir, "inserts.jpg");
  await ffmpeg(["-framerate", "1", "-i", path.join(frames, "%02d.jpg"), "-vf", `tile=4x${Math.ceil(all.length / 4)}`, "-frames:v", "1", "-q:v", "3", sheet], signal);
  return { sheet, notes: all.map((e, i) => `${i + 1}) ${e.t.toFixed(1)} с — ${e.what}`) };
}

const ANSWER = `Оцени ролик от 1 до 10, как зритель, который листает ленту. Ответ — только JSON: {"score":7,"good":["что сильное"],"problems":[{"at":"примерно секунда","what":"что видно","fix":"как поправить точечно"}]} — до 5 проблем, самые заметные первыми; если брака нет — "problems":[].`;

const CRITIC_SYSTEM = `Ты независимый и строгий редактор ленты коротких вертикальных роликов. Этот ролик монтировал не ты — суди только то, что видно на кадрах и написано в тексте, а не намерения. Перед тобой лист кадров готового ролика (по порядку слева направо, сверху вниз, через ${SHEET_STEP} с) и его текст. Хороший ролик канала: с первого кадра виден герой в момент события, картинка меняется каждые 2–4 секунды, субтитры читаются и не лежат на лицах и вставках, вставки (мемы, логотипы, обводки, карты, переписка) не закрывают лицо говорящего и держатся в середине кадра, нет пустых, тёмных и смазанных кадров, конец — на сильной реплике героя или развязке. ${ANSWER}`;

// Тот же редактор, но с глазами на вставках: образец — ролик-событие, а не ролик-слайды (признаки из motionmaxxing
// slop.md, переложенные на наш формат: настоящие кадры героя, вставки поверх, вертикаль). Требования — описанием хорошего.
const CRITIC_SLIDES = `Ты независимый и строгий редактор ленты коротких вертикальных роликов. Этот ролик монтировал не ты — суди только то, что видно на кадрах и написано в тексте, а не намерения. Перед тобой два листа кадров и текст ролика. Первый лист — весь ролик по порядку слева направо, сверху вниз, через ${SHEET_STEP} с. Второй лист (если он есть) — крупные кадры вставок в ту секунду, когда каждая уже встала; под листами список: какая вставка на каком кадре и на каких словах голоса она стоит.

Хороший ролик канала — это событие в кадре. Вот как он выглядит:
- С первого кадра виден герой в момент события. Если мысленно убрать субтитры и вставки, каждый кадр всё равно показывает происходящее: человека, место, вещь, страницу, о которой говорит голос. Зритель смотрит историю, а графика ему только подсказывает, куда глядеть.
- Картинка меняется каждые 2–4 секунды, и планы разной длины: короткие — на перечислении и развороте, самый долгий — на развязке. Кадр, который держится дольше двух секунд, живёт сам: в нём движется человек, камера или предмет.
- В кадре одна главная вещь. Вставка крупная, её понимают за секунду без подписи, она стоит рядом с тем, что называет голос, а лицо говорящего и строка субтитров остаются открытыми.
- Вставка появляется на слове, которое её называет, — по списку под листами видно, совпадает ли она со словами, — и уходит до следующей мысли. Число показывает ровно ту величину, что звучит, и подписано, что это; обводка стоит на самой детали, о которой речь; логотип — знак того бренда, который назван.
- Страница сайта или пост заполняет кадр так, что строку, о которой говорит голос, можно прочитать с телефона, не останавливая ролик.
- Субтитры читаются, конец — на сильной реплике героя или развязке, пустых, тёмных и смазанных кадров нет.

Ролик, в котором всё это есть, получает 8–10; каждое место, где этого не хватает, снижает оценку. В проблемах называй секунду, что на ней видно и что показать в этом месте, чтобы кадр стал событием. ${ANSWER}`;

/** partial — перемонтирован отрезок (точечная правка): критик не зовётся, цифры считаются. */
export async function checkRender(workDir: string, file: string, plan: NewsPlan, hooks: Hooks, partial = false): Promise<void> {
  if (!on("qc")) return;
  const dir = path.join(workDir, "qc");
  fs.mkdirSync(dir, { recursive: true });
  const [stood, dark, lufs, peak, length] = await Promise.all([still(file, STILL_SECONDS, hooks.signal), black(file, hooks.signal), loudness(file), truePeak(file), duration(file)]);
  const stuck = stood.filter(([a, b]) => b - a >= FROZEN_SECONDS);
  // стоит 0,6–1 с: ещё не брак, но уже слайд; в спокойном монтаже (посты и сайты) кадр стоит по решению владельца
  const slides = plan.fx?.calm ? [] : stood.filter(([a, b]) => b - a < FROZEN_SECONDS);
  const sheet = path.join(dir, "sheet.jpg");
  const cells = Math.ceil(length / SHEET_STEP);
  await ffmpeg(["-i", file, "-vf", `fps=${(1 / SHEET_STEP).toFixed(4)},scale=180:320,tile=6x${Math.max(1, Math.ceil(cells / 6))}`, "-frames:v", "1", "-q:v", "4", sheet], hooks.signal);
  const span = (r: [number, number][]) => r.map(([a, b]) => `${a.toFixed(1)}–${b.toFixed(1)}`).join(", ");
  const report: Record<string, unknown> = { at: new Date().toISOString(), duration: Number(length.toFixed(2)), lufs: Number(lufs.toFixed(1)), truePeak: peak, frozen: stuck, black: dark };
  hooks.log(`проверка ролика: ${length.toFixed(1)} с, ${lufs.toFixed(1)} LUFS, пик ${peak.toFixed(1)} dBFS${stuck.length ? `, замершие места ${span(stuck)} с` : ""}${dark.length ? `, чёрные места ${span(dark)} с` : ""}`);
  let inserts: ReturnType<typeof checkInserts> | null = null;
  if (on("qcInserts")) {
    try {
      inserts = checkInserts(plan);
      report.inserts = { ...inserts, motion: plan.fx?.motion === true, wordLead: plan.fx?.wordLead === true };
      report.slides = slides;
      hooks.log(`вставки по плану: ${inserts.count}${inserts.facts.length ? ` — ${inserts.facts.map((f) => `${f.at.toFixed(1)} с ${f.what}`).join("; ")}` : ", каждая на своём слове и в кадре одна"}${slides.length ? `; картинка стоит 0,6–1 с: ${span(slides)} с` : ""}`);
    } catch (error) {
      hooks.log(`проверка вставок не вышла: ${(error as Error).message}`);
    }
  }
  if (!partial && on("critic")) {
    try {
      const eyes = on("qcSlides") ? await insertSheet(dir, file, plan, length, hooks.signal).catch(() => null) : null;
      const facts = [stuck.length ? `замершая картинка: ${span(stuck)} с` : "", dark.length ? `чёрный кадр: ${span(dark)} с` : "", on("qcSlides") && slides.length ? `картинка стоит 0,6–1 с: ${span(slides)} с` : "", on("qcSlides") && inserts?.facts.length ? `по плану: ${inserts.facts.map((f) => `${f.at.toFixed(1)} с ${f.what}`).join("; ")}` : ""].filter(Boolean).join("; ");
      const images = [sheet, ...(eyes ? [eyes.sheet] : [])].map((f) => ({ base64: fs.readFileSync(f).toString("base64"), mediaType: "image/jpeg" }));
      const user = `Ролик ${length.toFixed(1)} с.${facts ? ` Замеры: ${facts}.` : ""}${eyes ? `\n\nВставки на втором листе:\n${eyes.notes.join("\n")}` : ""}\n\nТекст ролика:\n${script(plan)}`;
      const verdict = await claudeJson<{ score?: number; good?: string[]; problems?: { at?: string; what?: string; fix?: string }[] }>(on("qcSlides") ? CRITIC_SLIDES : CRITIC_SYSTEM, user, { images, task: "news-critic", effort: "medium" });
      report.critic = verdict;
      const problems = (verdict.problems ?? []).map((p) => `${p.at ?? "?"} с: ${p.what ?? ""}`).join("; ");
      hooks.log(`критик: ${verdict.score ?? "?"}/10${problems ? ` — ${problems}` : " — брака не видит"}`);
    } catch (error) {
      hooks.log(`критик не ответил: ${(error as Error).message}`);
    }
  }
  writeJson(path.join(dir, "qc.json"), report);
}
