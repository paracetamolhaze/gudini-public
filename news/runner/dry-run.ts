// Пробный «Создать» без сайта: node --import tsx runner/dry-run.ts <папка задания> [rerender]
// Ключи — из .env основного проекта, мосты — на этом ПК, как у сторожа start-runner.ps1.
import fs from "node:fs";
import path from "node:path";
import { createVideo } from "./pipeline/create";
import { createStock } from "./pipeline/stock";
import { rerender } from "./pipeline/montage";
import { NEWS_ROOT, type Hooks } from "./pipeline/util";

const env = fs.readFileSync(process.env.NEWS_ENV_FILE || "C:/Users/user/Desktop/gudini/.env", "utf8");
for (const line of env.split(/\r?\n/)) {
  const m = line.match(/^\s*(ELEVENLABS_API_KEY|CLAUDE_BRIDGE_TOKEN|CODEX_BRIDGE_TOKEN|CLAUDE_SCRIPT_MODEL|CODEX_MODEL|CODEX_SCRIPT_MODEL|CODEX_REASONING_EFFORT|CODEX_TIMEOUT_MS)\s*=\s*(.*)$/);
  if (m) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}
process.env.CLAUDE_BRIDGE_URL = "http://127.0.0.1:43131";
process.env.CODEX_BRIDGE_URL = "http://127.0.0.1:43127";

const workDir = path.resolve(process.argv[2] || path.join(NEWS_ROOT, ".work", `dry-${Date.now()}`));
const hooks: Hooks = {
  step: async (text, p) => console.log(`${new Date().toISOString()} [${p}%] ${text}`),
  log: (line) => console.log(`${new Date().toISOString()}   ${line}`),
};
const t0 = Date.now();
const made = process.argv[3] === "rerender"
  ? await rerender(workDir, hooks)
  : await createVideo(workDir, path.join(NEWS_ROOT, ".work", "history-dry.json"), createStock(path.join(NEWS_ROOT, ".work", "stock-dry.json"), path.join(NEWS_ROOT, ".work", "history-dry.json"), console.log), async (story) => console.log("ИСТОРИЯ:", JSON.stringify(story).slice(0, 600)), hooks);
console.log(`ГОТОВО за ${Math.round((Date.now() - t0) / 1000)} с:`, made);
