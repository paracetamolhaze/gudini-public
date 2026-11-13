import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { consumeRepair, loadRepair, stageRepair } from "./repair";

test("an explicit repair survives run cleanup, refuses changed inputs and is consumed only after success", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "astra-repair-"));
  try {
    const recording = path.join(root, "raw.mp4");
    fs.writeFileSync(recording, "recording");
    const source = { duration: 5, words: [{ word: "support", start: 1, end: 2 }], recording };
    assert.equal(loadRepair(root, source), undefined);
    stageRepair(root, source, "fixed montage");
    const saved = loadRepair(root, source)!;
    assert.equal(saved.code, "fixed montage");
    assert.equal(loadRepair(root, { ...source, duration: 5.001, words: [{ word: "support", start: 1.001, end: 2.001 }] })?.code, "fixed montage");
    assert.throws(() => loadRepair(root, { ...source, words: [{ word: "support", start: 1.004, end: 2.004 }] }), /изменилась/);
    assert.throws(() => loadRepair(root, { ...source, duration: 6 }), /изменилась/);
    assert.throws(() => loadRepair(root, { ...source, words: [{ word: "scammer", start: 1, end: 2 }] }), /изменилась/);
    fs.writeFileSync(recording, "different");
    assert.throws(() => loadRepair(root, source), /изменилась/);
    fs.writeFileSync(recording, "recording");
    stageRepair(root, source, "newer montage");
    consumeRepair(root, saved.token);
    const newer = loadRepair(root, source)!;
    assert.equal(newer.code, "newer montage");
    consumeRepair(root, newer.token);
    assert.equal(loadRepair(root, source), undefined);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
