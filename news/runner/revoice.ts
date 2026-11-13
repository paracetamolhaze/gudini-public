// Переозвучка готового ролика новым голосом автора: node --import tsx runner/revoice.ts <папка задания>
// Кадры, перевод героя и раскладка остаются; реплики автора озвучиваются заново тем же способом, что в «Создать»
// (весь текст одним запросом, лучший из дублей по образцу), встают на громкость прежних и пишутся в plan.json.
// Затем ролик перемонтируется заданием смены музыки на сайте (оно монтирует по plan.json).
import fs from "node:fs";
import path from "node:path";
import type { NewsPlan } from "../engine/src/plan";
import { loudness, readJson, writeJson, type Hooks } from "./pipeline/util";
import { voiceNarration } from "./pipeline/voice";

const env = fs.readFileSync(process.env.NEWS_ENV_FILE || "C:/Users/user/Desktop/gudini/.env", "utf8");
for (const line of env.split(/\r?\n/)) {
  const m = line.match(/^\s*(ELEVENLABS_API_KEY)\s*=\s*(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}

const workDir = path.resolve(process.argv[2] ?? "");
const planFile = path.join(workDir, "plan.json");
if (!fs.existsSync(planFile)) throw new Error(`Нет ${planFile}`);
const plan = readJson<NewsPlan>(planFile);
const pub = path.join(workDir, "public");
const ids = plan.segments.flatMap((s) => ("narr" in s ? [s.narr] : [])).filter((id, i, a) => a.indexOf(id) === i);
const blocks = ids.map((id) => ({ id, text: plan.lines[id].words.map((w) => w.w).join(" ") }));
const old = await Promise.all(ids.map((id) => loudness(path.join(pub, plan.lines[id].file))));
const target = old.reduce((a, b) => a + b, 0) / old.length;
const hooks: Hooks = { step: async (t) => console.log(t), log: (l) => console.log("  " + l) };
const takes = path.join(workDir, "revoice-takes");
fs.rmSync(takes, { recursive: true, force: true });
const { lines } = await voiceNarration(blocks, takes, path.join(pub, "vo"), hooks, target);
for (const id of ids) plan.lines[id] = lines[id];
fs.copyFileSync(planFile, path.join(workDir, `plan.before-revoice.json`));
writeJson(planFile, plan);
console.log(`переозвучено: ${ids.join(", ")}; громкость как была, ${target.toFixed(1)} LUFS`);
