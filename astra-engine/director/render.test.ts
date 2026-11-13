import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import { withMemoryTemp } from "./render";

test("overlapping renders share one temporary folder in memory and leave TMPDIR as it was", async (t) => {
  if (!fs.existsSync("/dev/shm")) return t.skip("no /dev/shm on this system");
  const before = process.env.TMPDIR;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const seen: string[] = [];
  const first = withMemoryTemp(async () => { seen.push(os.tmpdir()); await gate; seen.push(os.tmpdir()); });
  const second = withMemoryTemp(async () => { seen.push(os.tmpdir()); });
  await second;
  // The first render is still running: its folder must not have gone with the second one.
  assert.ok(fs.existsSync(seen[0]), "the folder outlives the render that finished first");
  release();
  await first;
  assert.ok(seen.every(dir => dir === seen[0] && dir.startsWith("/dev/shm/")), seen.join(", "));
  assert.equal(fs.existsSync(seen[0]), false, "the last render out removes the folder");
  assert.equal(process.env.TMPDIR, before);
});
