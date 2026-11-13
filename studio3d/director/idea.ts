import fs from "node:fs";
import path from "node:path";
import type { Hooks } from "./api";
import { askClaude, jsonOf } from "./bridge";
import { ENGINE_ROOT } from "./cast";

/** A trend sketch the site still sends with the recent topics (POST /api/3d/runner/ideas); not offered since 29.10. */
export type IdeaPick = { key: string; title: string; plot: string; opening: string; story?: string; handle: string; views: number; multiple: number };
/** key: the chosen trend card; null — an idea of Claude's own, which is every idea since the owner asked for news. */
export type IdeaChoice = { key: string | null; topic: string; why?: string };

/** The site's own limit for an idea (lib/studio3d/rules.ts TOPIC_MAX). */
const TOPIC_MAX = 600;
const TOPIC_MIN = 40;

/** Problems of an answer in words Claude understands; empty when the site will take it. */
export const ideaProblems = (c: { topic?: unknown }): string[] => {
  const length = typeof c.topic === "string" ? c.topic.trim().length : 0;
  if (length < TOPIC_MIN) return ["topic пустой или слишком короткий: нужна сцена в 2–3 предложения"];
  if (length > TOPIC_MAX) return [`topic длиннее ${TOPIC_MAX} знаков`];
  return [];
};

const read = (answer: string): { choice: { topic: string; why?: string } | null; problems: string[] } => {
  try {
    const raw = jsonOf<{ topic?: unknown; why?: unknown }>(answer);
    const problems = ideaProblems(raw);
    return { choice: problems.length ? null : { topic: String(raw.topic), ...(raw.why ? { why: String(raw.why) } : {}) }, problems };
  } catch (error) {
    return { choice: null, problems: [(error as Error).message] };
  }
};

/**
 * «Создать видео»: Claude searches the web for the news of the last days everyone is talking about and makes the next
 * sketch of it (the owner, 29.10: «нужны инфоповоды, что-то новое интересное»). The recent sketches keep it from
 * repeating a topic. One repair round when the answer breaks the format.
 */
export async function findIdea(pool: { cards: IdeaPick[]; recent: string[] }, hooks: Hooks, today = new Date()): Promise<IdeaChoice> {
  const system = fs.readFileSync(path.join(ENGINE_ROOT, "knowledge/idea.md"), "utf8");
  const date = today.toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Qyzylorda" });
  const user = [
    `Сегодня ${date}.`,
    pool.recent.length ? `Последние скетчи:\n${pool.recent.map((r) => `- ${r}`).join("\n")}` : "",
    "Предложи идею следующего скетча.",
  ]
    .filter(Boolean)
    .join("\n\n");
  hooks.stage("Клод ищет идею", 8);
  let answer = await askClaude(system, user, { label: "3Д идея", effort: "high", tools: "web", signal: hooks.signal });
  let { choice, problems } = read(answer);
  if (problems.length) {
    hooks.log(`Идея не по формату: ${problems.join("; ")}`);
    answer = await askClaude(system, `${user}\n\nТвой ответ:\n${answer}\n\nИсправь: ${problems.join("; ")}. Ответь только JSON.`, {
      label: "3Д идея, правка",
      effort: "medium",
      signal: hooks.signal,
    });
    ({ choice, problems } = read(answer));
  }
  if (!choice) throw new Error(`Идея не получилась: ${problems.join("; ")}`);
  if (choice.why) hooks.log(`почему: ${choice.why.slice(0, 200)}`);
  return { key: null, topic: choice.topic.replace(/\s+/g, " ").trim(), ...(choice.why ? { why: choice.why } : {}) };
}
