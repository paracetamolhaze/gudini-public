// Точечная правка готового ролика без нового сценария (владелец 31.10: «чтобы можно было тебе написать ошибки и ты мог
// быстро и точечно поменять что-то, вплоть до вырезания 1 миллисекунды»). Работает с plan.json готового ролика — тем,
// по которому он смонтирован: кадры, куски героя, реплики, вставки остаются, меняется только названное. Монтаж идёт с
// точностью до кадра (30 в секунду, 33 мс): время в плане — в секундах, движок округляет его до кадра.
//   node --import tsx runner/edit.ts <id> show              таймлайн ролика: куски, планы, вставки — со временем в ролике
//   node --import tsx runner/edit.ts <id> at 23.4           что в кадре и что звучит на 23,4 с
//   node --import tsx runner/edit.ts <id> get segments.5    кусок плана как есть
//   node --import tsx runner/edit.ts <id> set segments.5.to 12.34     поменять значение (JSON)
//   node --import tsx runner/edit.ts <id> drop inserts.2    убрать элемент
//   node --import tsx runner/edit.ts <id> say n3 "новый текст"        переозвучить одну реплику автора
//   node --import tsx runner/edit.ts <id> undo              вернуть план до последней правки
//   node --import tsx runner/edit.ts <id> journal           журнал правок ролика: что и когда меняли
//   node --import tsx runner/edit.ts <id> render            перемонтировать по плану и выложить на сайт (ждёт конца);
//                                                         render local — смонтировать здесь же, без сайта;
//                                                         render 0 10.4 — этот отрезок, даже если план тот же
//                                                         (заменили картинку или логотип в public/)
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { NewsPlan, Segment } from "../engine/src/plan";
import { rerender } from "./pipeline/montage";
import { loudness, readJson, writeJson, type Hooks } from "./pipeline/util";
import { voiceHeroLine, voiceNarration } from "./pipeline/voice";

const [id, cmd, ...args] = process.argv.slice(2);
if (!id || !cmd) throw new Error("edit.ts <id> show|at|get|set|drop|say|undo|render …");
const workDir = path.join(process.env.NEWS_WORK_DIR || path.join(os.homedir(), "gudini-news-data", "work"), id);
const planFile = path.join(workDir, "plan.json");
if (!fs.existsSync(planFile)) throw new Error(`Нет ${planFile} — у ролика нет плана монтажа на этом ПК`);
const plan = readJson<NewsPlan>(planFile);
const current = plan;
const backups = path.join(workDir, "edits");

// ---- таймлайн как в движке (engine/src/Main.tsx layout): где начинается каждый кусок и когда звучит каждое слово
const END_AIR = 0.25;
const text = (line: string) => plan.lines[line]?.words.map((w) => w.w).join(" ") ?? "";
function layout(plan: NewsPlan = current) {
  const placed: { seg: Segment; i: number; start: number; end: number }[] = [];
  let t = 0;
  plan.segments.forEach((seg, i) => {
    const last = i === plan.segments.length - 1;
    const dur = "narr" in seg
      ? plan.lines[seg.narr].end + (last ? END_AIR : 0.12)
      : "orig" in seg
        ? seg.to - seg.from
        : Math.max(seg.to - seg.from, Math.max(...seg.lines.map((l) => l.at + plan.lines[l.id].end)) + (last ? END_AIR : 0.37));
    placed.push({ seg, i, start: t, end: t + dur });
    t += dur;
  });
  const lineStart = (line: string) => {
    for (const p of placed) {
      if ("narr" in p.seg && p.seg.narr === line) return p.start;
      if ("dub" in p.seg) for (const l of p.seg.lines) if (l.id === line) return p.start + l.at;
    }
    return NaN;
  };
  return { placed, lineStart, total: t };
}
const f2 = (x: number) => x.toFixed(2);

function show(at?: number) {
  const { placed, lineStart, total } = layout();
  for (const p of placed) {
    if (at !== undefined && !(at >= p.start && at < p.end)) continue;
    const s = p.seg;
    if ("narr" in s) {
      console.log(`${f2(p.start)}–${f2(p.end)}  segments.${p.i}  автор ${s.narr}: «${text(s.narr)}»`);
      const words = plan.lines[s.narr].words;
      s.shots.forEach((sh, k) => {
        const from = p.start + (sh.w === 0 ? 0 : words[sh.w].s - 0.05);
        const to = k + 1 < s.shots.length ? p.start + words[s.shots[k + 1].w].s - 0.05 : p.end;
        if (at !== undefined && !(at >= from && at < to)) return;
        const what = sh.still ? `стоп-кадр ${sh.still}` : `${sh.clip}${sh.phone ? " в телефоне" : ""} с ${f2(sh.at ?? 0)} с${sh.endAt !== undefined ? ` (до ${f2(sh.endAt)})` : ""}`;
        console.log(`   ${f2(from)}–${f2(to)}  segments.${p.i}.shots.${k}  со слова ${sh.w} «${words[sh.w]?.w}» — ${what}`);
      });
      if (at !== undefined) console.log(`   слова: ${words.map((w) => `${w.w}@${f2(p.start + w.s)}`).join(" ")}`);
    } else if ("orig" in s) {
      const kind = s.orig.startsWith("vm_") ? `видеомем ${s.orig.slice(3)}` : `герой ${s.orig}`;
      console.log(`${f2(p.start)}–${f2(p.end)}  segments.${p.i}  ${kind}: исходник ${f2(s.from)}–${f2(s.to)} с`);
      (s.covers ?? []).forEach((c, k) => {
        const what = c.still ? `стоп-кадр` : c.punch ? `наезд ×${c.punch}` : `перебивка ${c.clip ?? s.orig} с ${f2(c.at)}`;
        if (at === undefined || (at >= p.start + c.from && at < p.start + c.to)) console.log(`   ${f2(p.start + c.from)}–${f2(p.start + c.to)}  segments.${p.i}.covers.${k}  ${what}`);
      });
    } else {
      console.log(`${f2(p.start)}–${f2(p.end)}  segments.${p.i}  герой ${s.dub} с переводом: исходник ${f2(s.from)}–${f2(s.to)} с`);
      s.lines.forEach((l, k) => console.log(`   ${f2(p.start + l.at)}  segments.${p.i}.lines.${k}  ${l.id}: «${text(l.id)}»`));
    }
  }
  (plan.inserts ?? []).forEach((x, k) => {
    const t = lineStart(x.line) + (plan.lines[x.line]?.words[x.w]?.s ?? 0);
    if (at === undefined || (at >= t && at < t + x.dur)) console.log(`вставка inserts.${k}  ${f2(t)}–${f2(t + x.dur)}  ${x.kind ?? "наклейка"} ${x.file} (на ${x.line}:${x.w} «${plan.lines[x.line]?.words[x.w]?.w}»)`);
  });
  if (at === undefined) console.log(`всего ${f2(total)} с`);
}

// ---- путь вида segments.5.shots.2.at
function walk(p: string): { parent: Record<string, unknown> | unknown[]; key: string | number } {
  const keys = p.split(".").map((k) => (/^\d+$/.test(k) ? Number(k) : k));
  let node: unknown = plan;
  for (const k of keys.slice(0, -1)) {
    node = (node as Record<string | number, unknown>)?.[k];
    if (node === undefined) throw new Error(`в плане нет ${p}`);
  }
  return { parent: node as Record<string, unknown>, key: keys[keys.length - 1] };
}
function backup(what: string) {
  fs.mkdirSync(backups, { recursive: true });
  fs.copyFileSync(planFile, path.join(backups, `plan-${new Date().toISOString().replace(/[:.]/g, "-")}.json`));
  console.log(`план до правки сохранён (${what}); вернуть — undo`);
  note(what);
}

/**
 * Журнал правок ролика (по video-recap-skills, 31.10): что и когда поменяли — команда journal показывает его, чтобы
 * следующая правка видела, что уже сделано и что владелец одобрил.
 */
const journalFile = path.join(backups, "journal.json");
function note(what: string) {
  const list = fs.existsSync(journalFile) ? readJson<{ at: string; what: string }[]>(journalFile) : [];
  writeJson(journalFile, [...list, { at: new Date().toISOString(), what }]);
}

async function say(line: string, words: string) {
  if (!plan.lines[line]) throw new Error(`${line} — такой реплики нет`);
  const hero = plan.lines[line].speaker !== "narrator";
  const env = fs.readFileSync(process.env.NEWS_ENV_FILE || "C:/Users/user/Desktop/gudini/.env", "utf8");
  for (const l of env.split(/\r?\n/)) {
    const m = l.match(/^\s*(ELEVENLABS_API_KEY)\s*=\s*(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
  const pub = path.join(workDir, "public");
  const target = await loudness(path.join(pub, plan.lines[line].file));
  const hooks: Hooks = { step: async (t) => console.log(t), log: (l) => console.log("  " + l) };
  const takes = path.join(workDir, "edits", `takes-${line}`);
  fs.rmSync(takes, { recursive: true, force: true });
  // реплика героя — голосом перевода: say h3 "текст" [male|female], по умолчанию женский; длина — как у прежней
  const gender = /\s(male|female)$/.exec(words)?.[1] as "male" | "female" | undefined;
  if (hero) words = words.replace(/\s(male|female)$/, "");
  const lines = hero
    ? { [line]: await voiceHeroLine(line, words, gender ?? "female", plan.lines[line].end, takes, path.join(pub, "vo"), target) }
    : (await voiceNarration([{ id: line, text: words }], takes, path.join(pub, "vo"), hooks, target)).lines;
  backup(`say ${line}`);
  // знак ударения (U+0301) — подсказка голосу: в субтитрах его быть не должно (12.11: «мо́гну» вышло на экран со знаком)
  const stress = String.fromCharCode(0x301);
  lines[line].words = lines[line].words.map((w) => ({ ...w, w: w.w.split(stress).join("") }));
  plan.lines[line] = lines[line];
  writeJson(planFile, plan);
  // слова, к которым привязаны планы, вставки и акценты, — по номеру: при другом числе слов их надо проверить
  const n = lines[line].words.length;
  const loose = [
    ...plan.segments.flatMap((s, i) => ("narr" in s && s.narr === line ? s.shots.flatMap((sh, k) => (sh.w >= n ? [`segments.${i}.shots.${k}`] : [])) : [])),
    ...(plan.inserts ?? []).flatMap((x, k) => (x.line === line && x.w >= n ? [`inserts.${k}`] : [])),
    ...(plan.overlays ?? []).flatMap((x, k) => (x.line === line && x.w >= n ? [`overlays.${k}`] : [])),
    ...plan.hits.flatMap((h, k) => (h.line === line && h.w >= n ? [`hits.${k}`] : [])),
  ];
  console.log(`${line} переозвучена: «${words}», ${n} слов, ${lines[line].end.toFixed(2)} с`);
  if (loose.length) console.log(`эти места привязаны к словам дальше ${n - 1}-го — поправь их: ${loose.join(", ")}`);
}

// ---- какой отрезок изменился с прошлого монтажа: куски, вставки и акценты старого и нового плана по времени
function changed(): { from: number; to: number | null } | "all" | null {
  const renderedFile = path.join(backups, "rendered.json");
  if (!fs.existsSync(renderedFile)) return "all";
  const old = readJson<NewsPlan>(renderedFile);
  // общее для всего ролика (звуки, ролики героя, подпись просмотров) — монтируется целиком
  const global = (p: NewsPlan) => JSON.stringify([p.clips, p.sounds ?? null, p.badge ?? null]);
  if (global(old) !== global(plan)) return "all";
  const events = (p: NewsPlan) => {
    const { placed, lineStart, total } = layout(p);
    const lineOf = (id: string) => JSON.stringify(p.lines[id]);
    const out: { key: string; from: number; to: number }[] = placed.map((x) => ({
      key: JSON.stringify(x.seg) + ("narr" in x.seg ? lineOf(x.seg.narr) : "dub" in x.seg ? x.seg.lines.map((l) => lineOf(l.id)).join("") : ""),
      from: x.start,
      to: x.end,
    }));
    for (const x of [...(p.inserts ?? []), ...(p.overlays ?? [])]) {
      const t = lineStart(x.line) + (p.lines[x.line]?.words[x.w]?.s ?? 0);
      out.push({ key: JSON.stringify(x), from: t, to: t + x.dur });
    }
    for (const h of p.hits) {
      const t = lineStart(h.line) + (p.lines[h.line]?.words[h.w]?.s ?? 0);
      out.push({ key: JSON.stringify(h), from: t - 0.05, to: t + 1.8 });
    }
    return { list: out.map((e) => ({ ...e, id: `${e.key}@${e.from.toFixed(3)}` })), total };
  };
  const a = events(old);
  const b = events(plan);
  const was = new Set(a.list.map((e) => e.id));
  const now = new Set(b.list.map((e) => e.id));
  const diff = [...a.list.filter((e) => !now.has(e.id)), ...b.list.filter((e) => !was.has(e.id))];
  if (!diff.length) return null;
  const from = Math.max(0, Math.min(...diff.map((e) => e.from)) - 0.2);
  // длина ролика поменялась — всё после правки сдвинулось
  if (Math.abs(a.total - b.total) > 0.001) return { from, to: null };
  return { from, to: Math.max(...diff.map((e) => e.to)) + 0.2 };
}

// ---- перемонтаж: задание rerender на сайте, исполнитель монтирует по plan.json и выкладывает ролик
function site(code: string): string {
  return execFileSync("docker", ["exec", "-w", "/app", "gudini-site", "npx", "tsx", "-e", code], { encoding: "utf8" }).trim();
}
async function render() {
  const range = args.filter((a) => a !== "local").map(Number);
  const w = range.length === 2 && range.every(Number.isFinite) ? { from: range[0], to: range[1] } : changed();
  if (w === null) return console.log("план не менялся с прошлого монтажа — монтировать нечего");
  if (w !== "all") {
    writeJson(path.join(backups, "window.json"), w);
    console.log(`перемонтирую только ${w.from.toFixed(2)}–${w.to === null ? "конец" : w.to.toFixed(2)} с`);
  } else fs.rmSync(path.join(backups, "window.json"), { force: true });
  // local — смонтировать здесь же, без сайта (пробные папки работы)
  if (args.includes("local")) {
    const t0 = Date.now();
    const made = await rerender(workDir, { step: async (t) => void process.stdout.write(`\r${t}`.padEnd(60)), log: (l) => console.log(`\n  ${l}`) });
    return console.log(`\nготово за ${Math.round((Date.now() - t0) / 1000)} с: ${made.file}, ${made.duration.toFixed(2)} с`);
  }
  site(`import { enqueueRerender } from "./lib/news/store"; enqueueRerender(${JSON.stringify(id)}).then(() => console.log("ok"));`);
  console.log("перемонтаж в очереди — исполнитель монтирует по плану");
  const t0 = Date.now();
  for (;;) {
    await new Promise((r) => setTimeout(r, 5000));
    const job = JSON.parse(site(`import { getProject } from "./lib/news/store"; console.log(JSON.stringify(getProject(${JSON.stringify(id)})?.job ?? null));`)) as { state: string; step: string; error?: string } | null;
    if (!job) throw new Error("у ролика нет задания");
    if (job.state === "done") return console.log(`готово за ${Math.round((Date.now() - t0) / 1000)} с — ролик на сайте`);
    if (job.state === "error") throw new Error(`перемонтаж не вышел: ${job.error ?? job.step}`);
    process.stdout.write(`\r${job.step}`.padEnd(60));
  }
}

if (cmd === "show") show();
else if (cmd === "at") show(Number(args[0]));
else if (cmd === "get") {
  const { parent, key } = walk(args[0]);
  console.log(JSON.stringify((parent as Record<string | number, unknown>)[key], null, 1));
} else if (cmd === "set") {
  const { parent, key } = walk(args[0]);
  const value = JSON.parse(args.slice(1).join(" "));
  backup(`set ${args[0]}`);
  console.log(`${args[0]}: ${JSON.stringify((parent as Record<string | number, unknown>)[key])} → ${JSON.stringify(value)}`);
  (parent as Record<string | number, unknown>)[key] = value;
  writeJson(planFile, plan);
} else if (cmd === "drop") {
  const { parent, key } = walk(args[0]);
  const list = Array.isArray(parent) && typeof key === "number";
  if (!list && (typeof parent !== "object" || parent === null || !(key in parent))) throw new Error("drop убирает элемент списка или ключ: segments.5, inserts.2, clips.vm_free-real-estate");
  backup(`drop ${args[0]}`);
  console.log(`убрано: ${JSON.stringify((parent as Record<string | number, unknown>)[key]).slice(0, 200)}`);
  if (list) parent.splice(key, 1);
  else delete (parent as Record<string, unknown>)[key];
  writeJson(planFile, plan);
} else if (cmd === "say") await say(args[0], args.slice(1).join(" "));
else if (cmd === "undo") {
  const list = fs.existsSync(backups) ? fs.readdirSync(backups).filter((f) => f.startsWith("plan-")).sort() : [];
  if (!list.length) throw new Error("правок не было — возвращать нечего");
  fs.copyFileSync(path.join(backups, list[list.length - 1]), planFile);
  fs.rmSync(path.join(backups, list[list.length - 1]));
  console.log(`план возвращён к ${list[list.length - 1]}`);
  note(`undo → ${list[list.length - 1]}`);
} else if (cmd === "render") {
  note(`render ${args.join(" ")}`.trim());
  await render();
} else if (cmd === "journal") {
  const list = fs.existsSync(journalFile) ? readJson<{ at: string; what: string }[]>(journalFile) : [];
  console.log(list.length ? list.map((e) => `${e.at.slice(0, 16).replace("T", " ")}  ${e.what}`).join("\n") : "правок не было");
} else throw new Error(`неизвестная команда ${cmd}`);
