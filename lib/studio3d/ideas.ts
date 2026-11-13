import type { Project3D } from "./types";
import { getProject, listProjects, setIdeaFromRunner, Studio3DError } from "./store";
import { addMade, isCardKey, readMade, readTrendsState } from "../trends/state";
import type { TrendCard } from "../trends/types";

/**
 * Ideas for «Создать видео». The runner's Claude picks among the trend sketches nobody has made yet (cards of /trends:
 * an outlier video already retold for the owner and Claude) or writes its own when none plays at the desk; the recent
 * sketches keep it from repeating a topic. The chosen card is marked made, like «Сделать в 3Д» on /trends.
 */

export type IdeaCandidate = {
  key: string;
  title: string;
  plot: string;
  opening: string;
  /** the original's premise, joke and twist */
  story?: string;
  handle: string;
  views: number;
  /** views over the author's own median */
  multiple: number;
};
export type IdeaPool = { cards: IdeaCandidate[]; recent: string[] };

/** The strongest outliers first, and few enough to keep the prompt short. */
const POOL_MAX = 40;
const RECENT_MAX = 20;

const stale = () => new Studio3DError("Задача больше не актуальна", 409);

/** Only the running script job of a «Создать видео» project asks for ideas. */
function checkIdeaJob(id: string, jobId: unknown): Project3D {
  const p = getProject(id);
  if (!p || !p.job || p.job.id !== jobId || p.job.state !== "running" || p.job.task !== "script") throw stale();
  if (!p.auto) throw new Studio3DError("Идею ищет только ролик, созданный кнопкой «Создать видео»", 400);
  return p;
}

export function ideaPool(id: string, jobId: unknown): IdeaPool {
  checkIdeaJob(id, jobId);
  const made = readMade();
  const cards = readTrendsState()
    .cards.filter((c) => c.state === "ready" && c.idea?.kind === "sketch" && !made[c.key]?.length)
    .sort((a, b) => b.multiple - a.multiple)
    .slice(0, POOL_MAX)
    .flatMap((c): IdeaCandidate[] =>
      c.idea?.kind === "sketch"
        ? [{ key: c.key, title: c.idea.title, plot: c.idea.plot, opening: c.idea.opening, story: c.analysis?.story, handle: c.handle, views: c.views, multiple: c.multiple }]
        : [],
    );
  const recent = listProjects()
    .filter((p) => p.id !== id && p.topic)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, RECENT_MAX)
    .map((p) => `${p.script?.title ? `${p.script.title}: ` : ""}${p.topic.slice(0, 240)}`);
  return { cards, recent };
}

/** The same wishes «Сделать в 3Д» gives the writer: how the first line opens and where the formula comes from. */
function sketchNotes(card: TrendCard): string | undefined {
  if (card.idea?.kind !== "sketch") return undefined;
  const a = card.analysis;
  const formula = a?.formulaId ? `по формуле «${a.formulaName}»` : a?.shape ? `по форме источника (${a.shape})` : "по форме источника";
  return [`Первая реплика ${formula}: ${card.idea.opening}`, `Формула взята у ролика: ${card.url}`].join("\n").slice(0, 1000);
}

/** The runner's choice: a card key and the topic (the card's plot, possibly moved to the desk) or its own topic. */
export async function chooseIdea(id: string, jobId: unknown, key: unknown, topic: unknown): Promise<Project3D> {
  const card = isCardKey(key) ? readTrendsState().cards.find((c) => c.key === key && c.idea?.kind === "sketch") : undefined;
  if (key !== undefined && key !== null && key !== "" && !card) throw new Studio3DError("Карточка тренда не найдена", 400);
  const project = await setIdeaFromRunner(id, jobId, topic, card ? sketchNotes(card) : undefined);
  // a repeated request (its answer got lost) must not mark the card twice
  if (card && !readMade()[card.key]?.some((m) => m.projectId === id)) addMade(card.key, { kind: "3d", projectId: id, at: project.updatedAt });
  return project;
}
