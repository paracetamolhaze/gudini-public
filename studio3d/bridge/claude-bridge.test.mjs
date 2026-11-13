// The bridge on a spare port with a stand-in for claude.exe: no real Claude Code runs and no subscription is spent.
// Run (Windows or Linux): node --test studio3d/bridge/claude-bridge.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Answers one stream-json task like the CLI does; "SLOW <mark>" makes it take 5 s and leave its pid in <tmp>/<mark>.pid. */
const FAKE_CLI = `
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", c => { input += c; });
process.stdin.on("end", () => {
  const text = JSON.parse(input.trim()).message.content[0].text;
  if (text.startsWith("SLOW ")) require("fs").writeFileSync(require("path").join(require("os").tmpdir(), text.slice(5) + ".pid"), String(process.pid));
  setTimeout(() => process.stdout.write(JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "ответ: " + text,
    usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 2 }, modelUsage: { "claude-opus-5-5": {} } }) + "\\n"), text.includes("SLOW") ? 5000 : 30);
});`;

/** Preloaded into the bridge: every spawn of the CLI runs FAKE_CLI under this node instead. */
const MOCK = `
const cp = process.getBuiltinModule("node:child_process");
const real = cp.spawn;
cp.spawn = (_cli, args, opts) => real(process.execPath, ["-e", ${JSON.stringify(FAKE_CLI)}, "--", ...args], opts);
process.getBuiltinModule("node:module").syncBuiltinESMExports();`;

const token = "test-token-".padEnd(40, "x");
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function startBridge() {
  const port = String(40000 + Math.floor(Math.random() * 20000));
  const child = spawn(process.execPath, ["--import", "data:text/javascript," + encodeURIComponent(MOCK), fileURLToPath(new URL("./claude-bridge.mjs", import.meta.url))], {
    env: { ...process.env, CLAUDE_BRIDGE_TOKEN: token, STUDIO3D_CLAUDE_ENV: "/nonexistent/.env", STUDIO3D_CLAUDE_PORT: port, STUDIO3D_CLAUDE_EXE: "/nonexistent/claude.exe", STUDIO3D_CLAUDE_CONCURRENCY: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let out = "";
  child.stdout.on("data", chunk => (out += chunk));
  child.stderr.on("data", chunk => (out += chunk));
  for (let i = 0; i < 100 && !out.includes("Мост 3Д"); i++) await sleep(50);
  assert.match(out, /Мост 3Д к Claude: 127\.0\.0\.1:/);
  return { port, child, log: () => out, stop: () => child.kill() };
}

function request(port, method, path, { body, auth = token, hangUpAfterMs } = {}) {
  return new Promise(resolve => {
    const req = http.request({ host: "127.0.0.1", port, path, method, agent: false, headers: { Authorization: `Bearer ${auth}`, "Content-Type": "application/json" } }, res => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", chunk => (text += chunk));
      res.on("end", () => resolve({ status: res.statusCode, json: text ? JSON.parse(text) : null }));
    });
    req.on("error", error => resolve({ status: 0, error: error.message }));
    if (hangUpAfterMs) setTimeout(() => req.destroy(), hangUpAfterMs);
    req.end(body === undefined ? undefined : JSON.stringify(body));
  });
}

const alive = pid => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

test("token, health and one answer in the shape the director reads", async () => {
  const bridge = await startBridge();
  try {
    assert.equal((await request(bridge.port, "GET", "/health", { auth: "wrong" })).status, 401);
    const health = await request(bridge.port, "GET", "/health");
    assert.equal(health.json.service, "studio3d-claude-bridge");
    const answer = await request(bridge.port, "POST", "/complete", { body: { system: "s", user: "привет", label: "тест" } });
    assert.deepEqual(answer, { status: 200, json: { text: "ответ: привет", usage: { inputTokens: 12, outputTokens: 5, cacheReadTokens: 2 }, model: "claude-opus-5-5" } });
    assert.equal((await request(bridge.port, "POST", "/complete", { body: { system: "s", user: "x", tools: "all" } })).status, 400);
  } finally {
    bridge.stop();
  }
});

test("a container that hangs up frees the only slot: its CLI run is killed, the next task does not wait", async () => {
  const bridge = await startBridge();
  try {
    const mark = `studio3d-bridge-test-${process.pid}-${bridge.port}`;
    const pidFile = path.join(os.tmpdir(), `${mark}.pid`);
    const left = request(bridge.port, "POST", "/complete", { body: { system: "s", user: `SLOW ${mark}`, label: "брошенный" }, hangUpAfterMs: 400 });
    await sleep(150);
    const began = Date.now();
    const next = await request(bridge.port, "POST", "/complete", { body: { system: "s", user: "следующий", label: "следующий" } });
    assert.equal(next.status, 200);
    assert.ok(Date.now() - began < 3000, `следующее задание ждало ${Date.now() - began} мс`);
    assert.equal((await left).status, 0);
    const pid = Number(fs.readFileSync(pidFile, "utf8"));
    fs.rmSync(pidFile, { force: true });
    assert.ok(pid > 0 && !alive(pid), "запуск брошенного задания остановлен");
    assert.match(bridge.log(), /брошенный: Задание отменено/);
  } finally {
    bridge.stop();
  }
});

test("a client cut off in the middle of its body does not take the bridge down", async () => {
  const bridge = await startBridge();
  try {
    await new Promise(resolve => {
      const req = http.request({ host: "127.0.0.1", port: bridge.port, path: "/complete", method: "POST", agent: false,
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "Content-Length": 100_000 } });
      req.on("error", () => resolve());
      req.write(`{"system":"${"x".repeat(20_000)}`);
      setTimeout(() => {
        req.destroy();
        resolve();
      }, 200);
    });
    await sleep(300);
    assert.equal(bridge.child.exitCode, null, "мост жив");
    assert.equal((await request(bridge.port, "GET", "/health")).status, 200);
  } finally {
    bridge.stop();
  }
});
