import { after, test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import type { TrendCard } from "../lib/trends/types";

// trends live in <cwd>/data/trends and the sketches in STUDIO3D_DATA_DIR: both in a temp folder, the site's data stays untouched
const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "gudini-3d-auto-"));
process.chdir(cwd);
process.env.STUDIO3D_DATA_DIR = path.join(cwd, "studio3d");
after(() => {
  process.chdir(os.tmpdir());
  fs.rmSync(cwd, { recursive: true, force: true });
});

const card = (key: string, multiple: number, plot: string): TrendCard => ({
  key,
  runId: "r1",
  theme: "sketch",
  source: key.startsWith("youtube") ? "youtube" : "instagram",
  handle: "author",
  url: `https://example.com/${key}`,
  views: 1_000_000,
  median: 100_000,
  multiple,
  followers: null,
  frames: [],
  state: "ready",
  at: new Date().toISOString(),
  analysis: { formulaId: null, formulaName: "Не размечена", shape: "открывается бытовой репликой", story: "Сценка с разворотом" } as TrendCard["analysis"],
  idea: { kind: "sketch", title: "Сценка", plot, opening: "Клод, смотри", formulaUse: "разворот оригинала" },
});

const dialog = {
  title: "Вернись домой",
  lines: [
    { who: "me" as const, text: "Клод, пиши ей: вернись домой." },
    { who: "claude" as const, text: "Отправил. Она ответила." },
  ],
};

test("«Создать видео»: идея из трендов, сценарий и сразу монтаж — без кнопок", async () => {
  const store = await import("../lib/studio3d/store");
  const ideas = await import("../lib/studio3d/ideas");
  const trends = await import("../lib/trends/state");
  const { projectTitle, statusOf, toSummary } = await import("../lib/studio3d/rules");
  fs.mkdirSync(trends.TRENDS_DIR, { recursive: true });
  trends.writeTrendsState({
    runs: [],
    cards: [card("instagram:AAAAA1", 5, "Я пролил сок на Клода."), card("youtube:BBBBB2", 20, "Я диктую Клоду сообщение девушке.")],
    browser: { connected: false },
  });
  const older = await store.createProject("Пранк с лимитом", undefined);
  await store.cancelQueued(older.id);

  const p = await store.createAutoProject();
  assert.equal(p.topic, "");
  assert.equal(p.auto, true);
  assert.equal(p.job?.task, "script");
  assert.equal(projectTitle(p), "Новый ролик");
  assert.equal(statusOf(toSummary(p)).text, "В очереди");

  const claimed = await store.claimNext();
  assert.equal(claimed?.project.id, p.id);
  const jobId = claimed!.job.id;
  assert.equal(statusOf(toSummary(store.getProject(p.id)!)).text, "Ищет идею");

  // only this job asks, the strongest card first, the recent sketches without this one
  assert.throws(() => ideas.ideaPool(p.id, "other"), (e: any) => e.status === 409);
  const pool = ideas.ideaPool(p.id, jobId);
  assert.deepEqual(
    pool.cards.map((c) => c.key),
    ["youtube:BBBBB2", "instagram:AAAAA1"],
  );
  assert.deepEqual(pool.recent, ["Пранк с лимитом"]);

  await assert.rejects(ideas.chooseIdea(p.id, jobId, "youtube:ZZZZZ9", "Я диктую Клоду сообщение девушке."), (e: any) => e.status === 400);
  const chosen = await ideas.chooseIdea(p.id, jobId, "youtube:BBBBB2", "  Я диктую Клоду слёзное сообщение девушке, а она уже дома.  ");
  assert.equal(chosen.topic, "Я диктую Клоду слёзное сообщение девушке, а она уже дома.");
  assert.match(chosen.notes ?? "", /Первая реплика по форме источника \(открывается бытовой репликой\): Клод, смотри/);
  assert.match(chosen.notes ?? "", /Формула взята у ролика: https:\/\/example\.com\/youtube:BBBBB2/);
  // a repeated request (its answer got lost) marks the card once
  await ideas.chooseIdea(p.id, jobId, "youtube:BBBBB2", "Я диктую Клоду слёзное сообщение девушке, а она уже дома.");
  assert.deepEqual(trends.readMade()["youtube:BBBBB2"].map((m) => m.projectId), [p.id]);
  assert.deepEqual(
    ideas.ideaPool(p.id, jobId).cards.map((c) => c.key),
    ["instagram:AAAAA1"],
    "снятая карточка больше не предлагается",
  );

  // the script done: the montage is queued at once
  await store.setScriptFromRunner(p.id, jobId, dialog);
  const done = await store.completeJob(p.id, jobId, {});
  assert.equal(done.job?.task, "montage");
  assert.equal(done.job?.state, "queued");
  assert.equal(projectTitle(done), "Вернись домой");
  await store.cancelQueued(p.id);
});

test("идею выбирает только ролик «Создать видео»; своя идея — без карточки", async () => {
  const store = await import("../lib/studio3d/store");
  const ideas = await import("../lib/studio3d/ideas");
  const manual = await store.createProject("Как я покупал крипту", undefined);
  const claimed = await store.claimNext();
  assert.equal(claimed?.project.id, manual.id);
  assert.throws(() => ideas.ideaPool(manual.id, claimed!.job.id), (e: any) => e.status === 400);
  await assert.rejects(ideas.chooseIdea(manual.id, claimed!.job.id, null, "Своя идея про крипту и маму."), (e: any) => e.status === 400);
  // a manual script still waits for the owner
  await store.setScriptFromRunner(manual.id, claimed!.job.id, dialog);
  assert.equal((await store.completeJob(manual.id, claimed!.job.id, {})).job?.state, "done");

  const auto = await store.createAutoProject();
  const job = (await store.claimNext())!.job;
  const own = await ideas.chooseIdea(auto.id, job.id, null, "Я учу Клода играть в шахматы, а он ставит мат за два хода.");
  assert.equal(own.topic, "Я учу Клода играть в шахматы, а он ставит мат за два хода.");
  assert.equal(own.notes, undefined);
});
