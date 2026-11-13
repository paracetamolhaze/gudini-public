import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { designProfile } from "./design";
import { systemPrompt, reviewPrompt, repairSystemPrompt, type Task } from "./prompt";
import { keyMoments } from "./frames";
import { analyzeMontage } from "./validate";
import { ENGINE_ROOT } from "./workspace";

test("legacy generation omits the new guide and craft keeps patch contract", () => {
  const guide = (name: string) => fs.readFileSync(path.join(ENGINE_ROOT, "knowledge", name), "utf8");
  const before = systemPrompt("file", "legacy");
  assert.ok(before.startsWith(guide("director.md")));
  assert.equal(before.includes("Астра craft-v1"), false);
  const craft = systemPrompt("patch", "craft-v1");
  assert.ok(craft.includes("Астра craft-v1"));
  assert.ok(craft.endsWith('Не добавляй зависимости или произвольный исполняемый код.'));
  assert.equal(repairSystemPrompt().includes("Астра craft-v1"), false);
  assert.equal(designProfile(undefined), process.env.ASTRA_DESIGN_PROFILE === "legacy" ? "legacy" : "craft-v1");
  assert.throws(() => designProfile("typo"), /Unknown/);
});

test("review follows the job profile and limits motion claims to available evidence", () => {
  const task = { topic: "test", lessons: [], input: { duration: 10, words: [], sounds: {}, music: {}, assets: {} } } as unknown as Task;
  const legacy = reviewPrompt({ ...task, designProfile: "legacy" }, "code", [], []);
  const craft = reviewPrompt({ ...task, designProfile: "craft-v1" }, "code", [], []);
  assert.equal(legacy.includes("Астра craft-v1"), false);
  assert.ok(craft.includes("По одному неподвижному кадру нельзя подтвердить плавность"));
  assert.ok(craft.includes('Если черновик уже хорош — {"edits":[]}'));
});

test("craft review includes ordered motion phases without exceeding bridge image budget", () => {
  const code = 'export const Montage = () => <AstraVideo>' + Array.from({ length: 15 }, (_, i) => `<Title from={${i * 2}} to={${i * 2 + 2}} text="test"/>`).join("") + '</AstraVideo>';
  const blocks = analyzeMontage(code, 30).blocks;
  const moments = keyMoments(blocks, 30, "craft-v1");
  assert.ok(moments.length <= 22);
  assert.equal(moments.filter(m => m.label.includes("фаза")).length, 12);
  assert.ok(moments.every((m, i) => m.at >= 0 && m.at < 30 && (i === 0 || m.at >= moments[i - 1].at)));
  assert.ok(keyMoments([], 0.2, "craft-v1").every(m => m.at >= 0 && m.at < 0.2));
  assert.equal(keyMoments(blocks, 30, "legacy").some(m => m.label.includes("фаза")), false);
});
