import { test } from "node:test";
import assert from "node:assert/strict";
import { parseResearch, researchDate } from "../lib/carousel/research";
import { codexArguments, codexPrompt, type CodexRequest } from "../lib/codexLlm";
const now = new Date("2026-09-14T22:00:00Z");
const evidence = () => ({ sources: [{ id: "s1", url: "https://example.org/a", title: "A", publishedAt: "2026-09-14" }, { id: "s2", url: "https://example.org/b", title: "B", publishedAt: null }], facts: [1, 2, 3].map(n => ({ claim: `fact ${n}`, period: "2026-09-14", sourceIds: ["s1"] })), analysis: ["inference"], limitations: [] });
test("research keeps observed periods separate from generation date in author's timezone", () => {
  assert.equal(researchDate(now), "2026-09-15");
  const r = parseResearch(evidence(), "ETH", now);
  assert.equal(r.asOf, now.toISOString());
  assert.equal(r.facts[0].period, "2026-09-14");
});
test("missing sources, orphan evidence and future publication dates stop the writer", () => {
  assert.throws(() => parseResearch({ sources: [], facts: [] }, "ETH", now));
  const r = evidence(); r.facts[0].sourceIds = ["invented"];
  assert.throws(() => parseResearch(r, "ETH", now));
  const future = evidence(); future.sources[0].publishedAt = "2026-09-16";
  assert.throws(() => parseResearch(future, "ETH", now));
});
test("only explicit research enables live web; local command execution stays disabled", () => {
  const r: CodexRequest = { system: "Research", user: "ETH", stage: "Carousel Text", model: "gpt-6-astra", effort: "high" };
  assert.ok(codexArguments(r, "tmp", []).includes('web_search="disabled"'));
  r.webSearch = "live";
  const args = codexArguments(r, "tmp", []);
  assert.ok(args.includes('web_search="live"'));
  assert.ok(args.includes('features.shell_tool=false'));
  assert.ok(!codexPrompt(r).includes("Не используй инструменты"));
  assert.ok(codexPrompt(r).includes("открой первоисточники"));
});
