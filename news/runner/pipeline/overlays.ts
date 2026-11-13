// Графика поверх кадра — из каталога видео-скиллов (владелец 31.10: «без проверок… добавляй»): обводка от руки на детали
// (графика agent-video-editor), переписка пузырями по-русски (text-message-video-skills), крупное число отсчётом
// (data-animation-skills), карта со страной события (map-animation-skills). Режиссёр отмечает их в раскладке; что не
// сошлось (детали на кадре нет, страны нет в данных), просто не ставится — ролик выходит всё равно.
import fs from "node:fs";
import path from "node:path";
import type { NewsPlan, Overlay } from "../../engine/src/plan";
import { on } from "./features";
import { claudeJson } from "./llm";
import type { Draft } from "./plan";
import { MAP_FLY_SECONDS, renderMapFly } from "./mapfly";
import { ffmpeg, NEWS_ROOT, type Hooks } from "./util";
import { snapToNumber } from "./words";

const W = 1080;
const H = 1920;
const FPS = 30;
const MARK_SECONDS = 1.4;
const NUMBER_SECONDS = 1.6;
const MAP_SECONDS = 2.2;
/** Между двумя картинками поверх кадра на одной реплике — хотя бы столько секунд (вставки, мемы, логотипы тоже). */
const GAP = 1.5;
const MAP_SIZE = 2000;

const FIND_SYSTEM = "Ты смотришь на кадр вертикального ролика 1080×1920 и отмечаешь на нём то, что попросили. Ответ — только JSON.";

/** Где на экране окажется точка кадра ролика: тот же наезд и сдвиг, что у плана в движке (engine/src/Main.tsx, Visual). */
function view(shot: { zoomFrom?: number; still?: string; focusY?: number }, elapsed: number, length: number) {
  const from = shot.zoomFrom ?? 1;
  const to = shot.zoomFrom ? 1 : shot.still ? 1.08 : 1.04;
  const p = Math.min(1, Math.round(elapsed * FPS) / Math.max(1, Math.round(length * FPS)));
  const s = from + (to - from) * (shot.zoomFrom ? 1 - Math.pow(1 - p, 3) : p);
  const fy = shot.focusY ?? H / 2;
  return { s, tx: (W - W * s) / 2, ty: Math.min(0, Math.max(H - H * s, fy - fy * s)) };
}

/** Кадр под словом автора через dt секунд: файл и секунда исходника (или стоп-кадр) и как план показан на экране. */
async function frameUnder(dir: string, pub: string, plan: NewsPlan, line: string, word: number, dt: number, hooks: Hooks) {
  const words = plan.lines[line]?.words;
  const seg = plan.segments.find((s) => "narr" in s && s.narr === line);
  if (!words?.[word] || !seg || !("narr" in seg)) return null;
  const k = [...seg.shots.keys()].reverse().find((i) => seg.shots[i].w <= word) ?? 0;
  const shot = seg.shots[k];
  if (shot.phone) return null;
  const start = shot.w === 0 ? 0 : words[shot.w].s - 0.05;
  const next = k + 1 < seg.shots.length ? words[seg.shots[k + 1].w].s - 0.05 : plan.lines[line].end + 0.12;
  const length = next - start;
  const elapsed = Math.min(length - 0.05, words[word].s - start + dt);
  const frame = path.join(dir, `under_${line}_${word}.jpg`);
  const fit = `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H}`;
  if (shot.still) await ffmpeg(["-i", path.join(pub, shot.still), "-frames:v", "1", "-vf", fit, "-q:v", "3", frame], hooks.signal);
  else if (shot.clip) {
    const at = shot.endAt !== undefined ? Math.max(0, shot.endAt - length) : shot.maxAt !== undefined ? Math.max(0, Math.min(shot.at ?? 0, shot.maxAt - length)) : (shot.at ?? 0);
    await ffmpeg(["-ss", (at + elapsed).toFixed(3), "-i", path.join(pub, plan.clips[shot.clip].file), "-frames:v", "1", "-vf", fit, "-q:v", "3", frame], hooks.signal);
  } else return null;
  return { frame, view: view(shot, elapsed, length), room: next - words[word].s, subY: shot.subY ?? SUB_LOW };
}

/** Строка субтитров обычно здесь (engine/src/Main.tsx SUB_LOW), у снимка — своя (Look.subY); высота строки — до 110 px. */
const SUB_LOW = 1040;

/** Под словом автора идёт пост, скриншот или карточка телефона — их читают, карта и число их не закрывают. */
function readingUnder(plan: NewsPlan, line: string, word: number): boolean {
  const seg = plan.segments.find((s) => "narr" in s && s.narr === line);
  if (!seg || !("narr" in seg)) return false;
  const shot = [...seg.shots].reverse().find((s) => s.w <= word) ?? seg.shots[0];
  return !!(shot?.still || shot?.phone);
}

/**
 * Форма обводки, которая влезает: овал вокруг широкой карточки выходил за край кадра и ложился на субтитры (31.10, проба
 * на стажёрах — «Папа Джонс»), тогда вместо него — подчёркивание под деталью. Размеры — как рисует движок (Mark).
 */
function fitShape(shape: "circle" | "arrow" | "underline", box: { x: number; y: number; w: number; h: number }, subY: number): "circle" | "arrow" | "underline" {
  const onSubs = (a: number, b: number) => a < subY + 110 && b > subY - 15;
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  if (shape === "circle") {
    const rx = (box.w / 2 + Math.max(26, box.w * 0.16)) * 1.09;
    const ry = (box.h / 2 + Math.max(22, box.h * 0.16)) * 1.09;
    if (cx - rx < 12 || cx + rx > W - 12 || cy - ry < 60 || (onSubs(cy - ry, cy + ry) && !onSubs(box.y, box.y + box.h))) return "underline";
  }
  return shape;
}

/** Обводка детали: Claude находит её на кадре под словом, рамка переводится в экран с наездом плана. */
async function markOf(dir: string, pub: string, plan: NewsPlan, m: NonNullable<Draft["marks"]>[number], hooks: Hooks): Promise<Overlay | null> {
  const under = await frameUnder(dir, pub, plan, m.line, m.word, MARK_SECONDS / 2, hooks);
  if (!under) return null;
  const image = { base64: fs.readFileSync(under.frame).toString("base64"), mediaType: "image/jpeg" };
  const found = await claudeJson<{ box: [number, number, number, number] | null }>(FIND_SYSTEM, `Найди на кадре: «${m.target}». Ответ: {"box":[x,y,w,h]} — рамка ровно этой детали в пикселях кадра (x, y — левый верхний угол). Если её на кадре не видно или она закрыта — {"box":null}.`, { images: [image], task: "news-mark-find", effort: "low" });
  const b = found.box;
  if (!b || b.length !== 4 || !b.every(Number.isFinite)) return null;
  const v = under.view;
  const box = { x: Math.round(v.tx + b[0] * v.s), y: Math.round(v.ty + b[1] * v.s), w: Math.round(b[2] * v.s), h: Math.round(b[3] * v.s) };
  // деталь, а не весь кадр: обводка вокруг половины экрана ничего не показывает
  if (box.w < 40 || box.h < 30 || box.w * box.h > W * H * 0.35 || box.x < 0 || box.y < 80 || box.x + box.w > W || box.y + box.h > H - 200) return null;
  return { kind: "mark", line: m.line, w: m.word, dur: Math.min(MARK_SECONDS, Math.max(0.8, under.room + 0.6)), shape: fitShape(m.shape, box, under.subY), box };
}

type Country = { iso: string; name: string; ru?: string; type: "Polygon" | "MultiPolygon"; coords: number[][][] | number[][][][] };
let countries: Country[] | null = null;
const geo = () => (countries ??= (JSON.parse(fs.readFileSync(path.join(NEWS_ROOT, "engine", "assets", "geo", "countries-110m.json"), "utf8")) as { countries: Country[] }).countries);

/** Меркатор в квадрат MAP_SIZE×MAP_SIZE: долгота — по ширине, широта ±82° — по высоте. */
const project = ([lon, lat]: number[]) => {
  const phi = (Math.max(-82, Math.min(82, lat)) * Math.PI) / 180;
  return [((lon + 180) / 360) * MAP_SIZE, ((1 - Math.log(Math.tan(Math.PI / 4 + phi / 2)) / Math.PI) / 2) * MAP_SIZE];
};
const polygons = (c: Country) => (c.type === "Polygon" ? [c.coords as number[][][]] : (c.coords as number[][][][]));
const pathOf = (c: Country) => polygons(c).map((poly) => poly.map((ring) => `M${ring.map((p) => project(p).map((n) => n.toFixed(1)).join(" ")).join("L")}Z`).join("")).join("");

/** Карта мира со страной события: svg в public/maps и рамка страны (по её главной части — без далёких островов и анклавов). */
function mapOf(pub: string, p: NonNullable<Draft["places"]>[number]): Overlay | null {
  const iso = p.country?.trim().toUpperCase();
  const target = geo().find((c) => c.iso === iso);
  if (!target) return null;
  const parts = polygons(target).map((poly) => {
    const pts = poly[0].map(project);
    const xs = pts.map((q) => q[0]);
    const ys = pts.map((q) => q[1]);
    return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
  });
  const main = [...parts].sort((a, b) => (b.x1 - b.x0) * (b.y1 - b.y0) - (a.x1 - a.x0) * (a.y1 - a.y0))[0];
  const near = parts.filter((q) => Math.abs((q.x0 + q.x1) / 2 - (main.x0 + main.x1) / 2) < MAP_SIZE / 12);
  const focus = { x: Math.min(...near.map((q) => q.x0)), y: Math.min(...near.map((q) => q.y0)), w: 0, h: 0 };
  focus.w = Math.max(...near.map((q) => q.x1)) - focus.x;
  focus.h = Math.max(...near.map((q) => q.y1)) - focus.y;
  const land = geo().filter((c) => c.iso !== iso && c.iso !== "AQ").map(pathOf).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${MAP_SIZE} ${MAP_SIZE}"><path d="${land}" fill="#2C3E57" stroke="#0E1A2B" stroke-width="1.5"/><path d="${pathOf(target)}" fill="#FFE14D" stroke="#ffffff" stroke-width="2.5"/></svg>`;
  fs.mkdirSync(path.join(pub, "maps"), { recursive: true });
  fs.writeFileSync(path.join(pub, "maps", `${iso}.svg`), svg);
  const name = (p.name?.trim() || target.ru || target.name).slice(0, 24);
  return { kind: "map", line: p.line, w: p.word, dur: MAP_SECONDS, file: `maps/${iso}.svg`, size: MAP_SIZE, focus: { x: Math.round(focus.x), y: Math.round(focus.y), w: Math.round(focus.w), h: Math.round(focus.h) }, name };
}

/** Переписка: 2–5 коротких сообщений; держится до конца реплики, на которой её показывают (2–5 с). */
function chatOf(plan: NewsPlan, c: NonNullable<Draft["chats"]>[number]): Overlay | null {
  const line = plan.lines[c.line];
  const messages = (c.messages ?? [])
    .filter((m) => m?.text?.trim())
    .slice(0, 5)
    .map((m) => ({ side: m.side === "right" ? ("right" as const) : ("left" as const), text: m.text.trim().slice(0, 90), ...(m.name?.trim() ? { name: m.name.trim().slice(0, 24) } : {}) }));
  if (!line?.words[c.word] || messages.length < 2) return null;
  const dur = Math.min(5, Math.max(2, line.end - line.words[c.word].s + 0.2, messages.length * 0.8 + 0.6));
  return { kind: "chat", line: c.line, w: c.word, dur, messages, ...(c.title?.trim() ? { title: c.title.trim().slice(0, 30) } : {}) };
}

function numberOf(plan: NewsPlan, n: NonNullable<Draft["numbers"]>[number]): Overlay | null {
  const value = Math.round(Number(n.value));
  if (!plan.lines[n.line]?.words[n.word] || !Number.isFinite(value) || value < 10 || value > 1e12) return null;
  // число встаёт на слово, с которого оно звучит: режиссёр нередко называет соседнее слово («заработал» перед «80
  // миллионов») или конец числа («миллионов»), и цифры выходили раньше или позже голоса
  const word = on("wordSync") ? snapToNumber(plan.lines[n.line].words, n.word, value) : n.word;
  return { kind: "number", line: n.line, w: word, dur: NUMBER_SECONDS, value, ...(n.prefix ? { prefix: n.prefix.slice(0, 3) } : {}), ...(n.suffix ? { suffix: n.suffix.slice(0, 3) } : {}), ...(n.label?.trim() ? { label: n.label.split("|").map((s) => s.trim().slice(0, 22)).filter(Boolean).slice(0, 3).join("|") } : {}) };
}

/** Секунда слова от начала его реплики — для сравнения мест на одной реплике. */
const wordAt = (plan: NewsPlan, line: string, w: number) => plan.lines[line]?.words[w]?.s ?? -99;

export async function makeOverlays(workDir: string, pub: string, plan: NewsPlan, draft: Pick<Draft, "marks" | "chats" | "numbers" | "places">, hooks: Hooks): Promise<void> {
  delete plan.overlays;
  const dir = path.join(workDir, "overlays");
  fs.mkdirSync(dir, { recursive: true });
  const made: Overlay[] = [];
  const busy = (line: string, w: number) =>
    [...(plan.inserts ?? []), ...made].some((x) => x.line === line && Math.abs(wordAt(plan, line, x.w) - wordAt(plan, line, w)) < GAP) ||
    (plan.peeks ?? []).some((p) => p.line === line && Math.abs(wordAt(plan, line, p.w) - wordAt(plan, line, w)) < p.dur + 0.2);
  const add = (o: Overlay | null, what: string) => {
    if (!o) return hooks.log(`${what} — не ставим`);
    if (busy(o.line, o.w)) return hooks.log(`${what} — рядом другая картинка, не ставим`);
    made.push(o);
    hooks.log(`${what} — ${o.line}:${o.w}`);
  };
  if (on("chats")) for (const c of (draft.chats ?? []).slice(0, 1)) add(chatOf(plan, c), `переписка (${c.messages?.length ?? 0} сообщ.)`);
  // карта и число встают поверх кадра героя, а не поверх поста, который автор в эту секунду читает (31.10, проба: карта
  // закрыла комментарий Баварии)
  if (on("numbers")) for (const n of (draft.numbers ?? []).slice(0, 2)) add(readingUnder(plan, n.line, n.word) ? null : numberOf(plan, n), `число ${n.value}`);
  if (on("maps"))
    for (const p of (draft.places ?? []).slice(0, 1)) {
      try {
        if (!plan.lines[p.line]?.words[p.word] || readingUnder(plan, p.line, p.word)) {
          add(null, `карта ${p.country}`);
          continue;
        }
        // настоящая карта с подлётом к городу и подписью (владелец 5.11: «почему карта старая? мы же делали новую»)
        const lat = Number(p.lat);
        const lon = Number(p.lon);
        const label = (p.name?.trim() || p.country).slice(0, 24);
        const clip = Number.isFinite(lat) && Number.isFinite(lon) ? await renderMapFly(pub, { lat, lon, label }, hooks.signal) : null;
        if (clip) add({ kind: "mapfly", line: p.line, w: p.word, dur: MAP_FLY_SECONDS, file: clip, name: label }, `карта ${label}`);
        else add(mapOf(pub, p), `карта ${p.country} (контур страны: браузер сайта недоступен)`);
      } catch (error) {
        hooks.log(`карта ${p.country} не вышла: ${(error as Error).message}`);
      }
    }
  // обводки ищутся на кадрах разом (каждая — свой вопрос Claude), ставятся по порядку
  if (on("marks")) {
    const marks = (draft.marks ?? []).slice(0, 2);
    const found = await Promise.all(
      marks.map((m) =>
        markOf(dir, pub, plan, m, hooks).catch((error: Error) => {
          hooks.log(`обводка «${m.target}» не вышла: ${error.message}`);
          return null;
        }),
      ),
    );
    marks.forEach((m, i) => add(found[i], `обводка «${m.target}»`));
  }
  if (made.length) plan.overlays = made;
}
