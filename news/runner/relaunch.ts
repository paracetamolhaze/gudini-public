// Второй запуск ролика на площадке, где он не набрал (владелец 10.11: «подготовь все видео с новым началом для других
// площадок где просмотры не набирались»). Ролик, который залетел на одной площадке и застрял на другой, выходит там ещё
// раз с другим началом: история та же и уже проверена, меняются первые секунды, заголовок и подпись. Папка ролика
// копируется под новым номером, начало правится точечно (runner/edit.ts), на сайте появляется отдельный ролик с пометкой
// «Новое начало · для …» — первый ролик и его публикации не трогаются.
//   node --import tsx runner/relaunch.ts start <id> <instagram|youtube|tiktok> [вариант опыта]   копия папки, печатает новый id
//   node --import tsx runner/relaunch.ts brief <id>              история, текст и ролики героя с описанием кадров
//   … новое начало: runner/edit.ts <новый id> say n1 "…", set segments.0.shots […], drop …, render local
//   node --import tsx runner/relaunch.ts frames <id> [сек]       лист кадров первых секунд (по умолчанию 8) — смотреть глазами
//   node --import tsx runner/relaunch.ts publish <id>            ролик на сайт отдельным проектом: музыка и обложка первого
//                                                                ролика, новая подпись
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { NewsPlan } from "../engine/src/plan";
import { duration, readJson, writeJson } from "./pipeline/util";

const WORK = process.env.NEWS_WORK_DIR || path.join(os.homedir(), "gudini-news-data", "work");
/** Папки старых роликов уезжают с диска C сюда — второй запуск берёт их и отсюда. */
const ARCHIVE = process.env.NEWS_ARCHIVE_DIR || "D:/gudini-news-archive/work";
const SITE = process.env.GUDINI_SITE_CONTAINER || "gudini-site";
const PLATFORMS = ["instagram", "youtube", "tiktok"] as const;
type Platform = (typeof PLATFORMS)[number];
type Mark = { of: string; platform: Platform; trial?: string; at: string };

const [cmd, id, ...args] = process.argv.slice(2);
if (!cmd || !id) throw new Error("relaunch.ts start|brief|frames|publish <id> …");

const dirOf = (x: string) => [path.join(WORK, x), path.join(ARCHIVE, x)].find((d) => fs.existsSync(path.join(d, "plan.json")));
const textOf = (plan: NewsPlan, line: string) => plan.lines[line]?.words.map((w) => w.w).join(" ") ?? "";

function start() {
  const platform = PLATFORMS.find((p) => p === args[0]);
  if (!platform) throw new Error(`площадка — одна из: ${PLATFORMS.join(", ")}`);
  const from = dirOf(id);
  if (!from) throw new Error(`папки ролика ${id} с планом монтажа нет ни в ${WORK}, ни в ${ARCHIVE}`);
  const next = Date.now().toString(36) + crypto.randomBytes(5).toString("hex");
  const to = path.join(WORK, next);
  fs.mkdirSync(path.join(to, "edits"), { recursive: true });
  // только то, из чего монтируется ролик: исходники, разбор и дубли голоса второму запуску не нужны
  for (const name of ["plan.json", "draft.json", "clips.json", "story.json", "voices.json", "cover-frame.jpg", "render.mp4"]) {
    if (fs.existsSync(path.join(from, name))) fs.copyFileSync(path.join(from, name), path.join(to, name));
  }
  fs.cpSync(path.join(from, "public"), path.join(to, "public"), { recursive: true });
  // по этому снимку плана edit.ts узнаёт, что изменилось с прошлого монтажа
  const rendered = path.join(from, "edits", "rendered.json");
  fs.copyFileSync(fs.existsSync(rendered) ? rendered : path.join(from, "plan.json"), path.join(to, "edits", "rendered.json"));
  writeJson(path.join(to, "relaunch.json"), { of: id, platform, ...(args[1] ? { trial: args[1] } : {}), at: new Date().toISOString() } satisfies Mark);
  console.log(next);
}

type Clip = { key: string; duration: number; shows: string; still?: boolean; transcript?: { language?: string; phrases?: { s: number; e: number; text: string }[] }; moments?: { from: number; to: number; shows: string; text?: string; speaking?: boolean; empty?: boolean }[] };

function brief() {
  const dir = dirOf(id);
  if (!dir) throw new Error(`нет папки ролика ${id}`);
  const plan = readJson<NewsPlan>(path.join(dir, "plan.json"));
  const storyFile = path.join(dir, "story.json");
  if (fs.existsSync(storyFile)) {
    const { candidate: c } = readJson<{ candidate: { title: string; summary: string; facts: { text: string }[] } }>(storyFile);
    console.log(`ИСТОРИЯ: ${c.title}\n${c.summary}\nФакты:\n${c.facts.map((f) => `- ${f.text}`).join("\n")}\n`);
  }
  console.log("РЕПЛИКИ:");
  for (const [key, line] of Object.entries(plan.lines)) console.log(`  ${key} (${line.speaker}, ${line.end.toFixed(1)} с): «${textOf(plan, key)}»`);
  console.log("\nТАЙМЛАЙН:");
  console.log(execFileSync(process.execPath, ["--import", "tsx", path.join(import.meta.dirname, "edit.ts"), id, "show"], { encoding: "utf8", env: { ...process.env, NEWS_WORK_DIR: path.dirname(dir) } }));
  const clipsFile = path.join(dir, "clips.json");
  if (!fs.existsSync(clipsFile)) return;
  console.log("РОЛИКИ ГЕРОЯ:");
  for (const c of readJson<Clip[]>(clipsFile)) {
    console.log(`\n${c.key}${c.still ? " (картинка)" : ""}: ${c.duration.toFixed(1)} с — ${c.shows}`);
    for (const m of c.moments ?? []) console.log(`   [${m.from}–${m.to}] ${m.shows}${m.text ? ` | надпись «${m.text}»` : ""}${m.speaking ? " | говорит" : ""}${m.empty ? " | пусто" : ""}`);
    const said = (c.transcript?.phrases ?? []).map((p) => `[${p.s}–${p.e}] ${p.text}`).join(" ");
    if (said) console.log(`   речь (${c.transcript?.language ?? "?"}): ${said.slice(0, 1500)}`);
  }
}

function frames() {
  const dir = dirOf(id);
  if (!dir) throw new Error(`нет папки ролика ${id}`);
  const seconds = Number(args[0]) || 8;
  const out = path.join(dir, "edits", "opening.jpg");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  // по 3 кадра в секунду, 8 в ряд: первые секунды видны одним листом
  const rows = Math.ceil((seconds * 3) / 8);
  execFileSync("ffmpeg", ["-y", "-v", "error", "-t", String(seconds), "-i", path.join(dir, "render.mp4"), "-vf", `fps=3,scale=270:-2,tile=8x${rows}`, "-frames:v", "1", "-q:v", "3", out]);
  console.log(out);
}

/** Весь озвученный текст по порядку кусков — как его собирает createVideo. */
function scriptOf(plan: NewsPlan): { script: string; last: string } {
  const parts: string[] = [];
  let last = "";
  for (const seg of plan.segments) {
    if ("narr" in seg) parts.push((last = textOf(plan, seg.narr)));
    else if ("dub" in seg) {
      parts.push(...seg.lines.map((l) => textOf(plan, l.id)));
      last = "";
    } else last = "";
  }
  return { script: parts.filter(Boolean).join(" "), last };
}

async function publish() {
  const dir = path.join(WORK, id);
  const mark = readJson<Mark>(path.join(dir, "relaunch.json"));
  const plan = readJson<NewsPlan>(path.join(dir, "plan.json"));
  // out.mp4 — монтаж с выровненной громкостью (−14 LUFS), его же исполнитель отдаёт сайту; render.mp4 — сырой
  const video = [path.join(dir, "out.mp4"), path.join(dir, "render.mp4")].find((f) => fs.existsSync(f))!;
  const { script, last } = scriptOf(plan);
  const input = { id, of: mark.of, platform: mark.platform, trial: mark.trial ?? null, script, telegram: /телеграм/i.test(last) ? last : null, duration: Number((await duration(video)).toFixed(2)) };
  const remote = `/app/data/news/${id}`;
  const docker = (list: string[]) => execFileSync("docker", list, { encoding: "utf8", env: { ...process.env, MSYS_NO_PATHCONV: "1" } }).trim();
  docker(["exec", SITE, "mkdir", "-p", remote]);
  docker(["cp", video, `${SITE}:${remote}/base.mp4`]);
  const tmp = path.join(dir, "edits", "site-input.json");
  writeJson(tmp, input);
  docker(["cp", tmp, `${SITE}:${remote}/relaunch-input.json`]);
  const code = path.join(dir, "edits", "site-import.ts");
  fs.writeFileSync(code, SITE_IMPORT);
  docker(["cp", code, `${SITE}:${remote}/relaunch-import.ts`]);
  try {
    console.log(docker(["exec", "-w", "/app", SITE, "npx", "tsx", `${remote}/relaunch-import.ts`, id]));
  } finally {
    docker(["exec", SITE, "rm", "-f", `${remote}/relaunch-import.ts`, `${remote}/relaunch-input.json`]);
  }
}

/**
 * Выполняется внутри сайта: проект второго запуска рядом с первым. История, музыка и обложка — первого ролика (кадры
 * те же), текст — с новым началом, подпись пишется заново и другая (lib/news/meta.ts знает про второй запуск).
 */
const SITE_IMPORT = `
import fs from "fs";
import path from "path";
import { getProject, mutate, projectDir, setMusic, writeJson } from "/app/lib/news/store";
import { regenerateMeta } from "/app/lib/news/meta";

const id = process.argv[2];
(async () => {
  const dir = projectDir(id);
  const input = JSON.parse(fs.readFileSync(path.join(dir, "relaunch-input.json"), "utf8"));
  const first = getProject(input.of);
  if (!first?.story || !first.video) throw new Error("первого ролика на сайте нет");
  const at = new Date().toISOString();
  const { trial: _t, telegram: _g, relaunch: _r, ...base } = first.story as Record<string, unknown>;
  const story = { ...base, script: input.script, relaunch: { of: input.of, platform: input.platform }, ...(input.trial && first.story.lane ? { trial: input.trial } : {}), ...(input.telegram && first.story.lane ? { telegram: input.telegram } : {}) };
  fs.copyFileSync(path.join(dir, "base.mp4"), path.join(dir, "out.mp4"));
  const cover = first.cover?.status === "ok" && fs.existsSync(path.join(projectDir(input.of), "cover.jpg"));
  for (const f of ["cover.jpg", "cover-frame.jpg"]) {
    const from = path.join(projectDir(input.of), f);
    if (fs.existsSync(from)) fs.copyFileSync(from, path.join(dir, f));
  }
  await writeJson(path.join(dir, "project.json"), {
    id, createdAt: at, updatedAt: at, story, job: null,
    video: { file: "out.mp4", at, duration: input.duration, music: null, base: { file: "base.mp4", at } },
    meta: null, cover: cover ? { ...first.cover, at, videoAt: at } : null, mirrorId: null,
  });
  if (first.video.music) await setMusic(id, first.video.music).catch((e) => console.log("музыка первого ролика не легла:", e.message));
  await regenerateMeta(id).catch((e) => console.log("подпись не написалась:", e.message));
  const p = getProject(id);
  console.log(JSON.stringify({ id, title: p?.story?.title, music: p?.video?.music ?? null, meta: p?.meta ?? null, cover: p?.cover?.status ?? null }));
})().catch((e) => { console.error(e); process.exit(1); });
`;

if (cmd === "start") start();
else if (cmd === "brief") brief();
else if (cmd === "frames") frames();
else if (cmd === "publish") await publish();
else throw new Error(`неизвестная команда ${cmd}`);
