import fs from "node:fs";
import path from "node:path";
import type { Hooks, ProjectSpec, Script3D } from "./api";
import { askClaude, jsonOf } from "./bridge";
import { ENGINE_ROOT } from "./cast";

const IDS = ["me", "claude"];
export const MAX_SCRIPT_CHARS = 1800;
/** The writer's own sketch (10.11.2026, the audit of 23 sketches: a minute on one joke is watched to 40-50%): 30-40 seconds. */
export const WRITER_MAX_LINES = 14;
export const WRITER_MAX_CHARS = 640;
/** The first line is on screen before the viewer decides to stay: it is said in about two seconds. */
export const HOOK_MAX_CHARS = 60;
const spoken = (text: string) => text.replace(/\[[^\]]*\]/g, "").replace(/\s+/g, " ").trim();

/** Problems of a script in words the writer understands; empty when it can be voiced. */
export const scriptProblems = (s: Script3D): string[] => {
  const out: string[] = [];
  if (!s.title?.trim()) out.push("нет title");
  if (!Array.isArray(s.lines) || s.lines.length < 6) out.push("меньше шести реплик");
  if (s.lines?.length > WRITER_MAX_LINES) out.push(`реплик ${s.lines.length}, нужно 10–${WRITER_MAX_LINES}: скетч идёт 30–40 секунд, одна шутка без растяжки — оставь самые смешные обмены`);
  const hook = spoken(s.lines?.[0]?.text ?? "");
  if (hook.length > HOOK_MAX_CHARS) out.push(`первая реплика ${hook.length} знаков, нужно до ${HOOK_MAX_CHARS}: её говорят за две секунды, и в ней уже вся беда героя`);
  let total = 0;
  s.lines?.forEach((l, i) => {
    if (!IDS.includes(l.who)) out.push(`реплика ${i + 1}: who должен быть "me" или "claude"`);
    if (!l.text?.trim()) out.push(`реплика ${i + 1}: пустой текст`);
    if (l.text?.length > 220) out.push(`реплика ${i + 1}: длиннее 220 знаков`);
    for (const tag of l.text?.match(/\[[^\]]*\]/g) ?? []) if (/[а-яё]/i.test(tag)) out.push(`реплика ${i + 1}: тег ${tag} должен быть английским, например [sighs]`);
    total += l.text?.length ?? 0;
  });
  if (total > WRITER_MAX_CHARS) out.push(`всего ${total} знаков, нужно 450–${WRITER_MAX_CHARS}: это 30–40 секунд речи`);
  if (s.lines?.length && !s.lines.some((l) => l.who === "me")) out.push("человек ни разу не говорит");
  if (s.lines?.length && !s.lines.some((l) => l.who === "claude")) out.push("Клод ни разу не говорит");
  return out;
};

const clean = (s: Script3D): Script3D => ({
  title: s.title.trim().slice(0, 120),
  lines: s.lines.map((l) => ({ who: l.who, text: l.text.replace(/\s+/g, " ").trim() })),
});

/** Claude writes the dialogue for the owner's idea; one repair round when the answer breaks the format. */
export async function writeScript(p: ProjectSpec, hooks: Hooks): Promise<Script3D> {
  const system = fs.readFileSync(path.join(ENGINE_ROOT, "knowledge/writer.md"), "utf8");
  const previous = p.script?.lines?.length ? `\n\nПрошлая версия сценария (напиши новую, сильнее):\n${JSON.stringify(p.script, null, 1)}` : "";
  const user = `Идея ролика от владельца:\n${p.topic.trim()}${p.notes?.trim() ? `\n\nПожелания владельца:\n${p.notes.trim()}` : ""}${previous}\n\nНапиши скетч.`;
  hooks.stage("Клод пишет сценарий", 20);
  let answer = await askClaude(system, user, { label: "3Д сценарий", effort: "high", signal: hooks.signal });
  for (let round = 0; round < 2; round++) {
    let script: Script3D | null = null;
    let problems: string[];
    try {
      script = jsonOf<Script3D>(answer);
      problems = scriptProblems(script);
    } catch (error) {
      problems = [(error as Error).message];
    }
    if (script && !problems.length) return clean(script);
    hooks.log(`Сценарий не по формату: ${problems.join("; ")}`);
    hooks.stage("Клод поправляет сценарий", 60);
    answer = await askClaude(system, `${user}\n\nТвой ответ:\n${answer}\n\nИсправь: ${problems.join("; ")}. Ответь только JSON.`, {
      label: "3Д сценарий, правка",
      effort: "medium",
      signal: hooks.signal,
    });
  }
  const script = jsonOf<Script3D>(answer);
  const problems = scriptProblems(script);
  if (problems.length) throw new Error(`Сценарий не получился: ${problems.join("; ")}`);
  return clean(script);
}
