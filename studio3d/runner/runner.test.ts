import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { promisify } from "node:util";
import type { Hooks, MontageVoice, VoicedClip } from "../director/api";
import type { CastFile } from "../director/cast";
import { findLineWindows, makeDub, NO_SOURCES } from "../director/dub";
import { aligned, fakeMontage, sound } from "../director/dubFixture";
import { readMark, writeMark } from "../director/montageMark";
import { encodeFlac } from "../director/recorded";
import type { FoundWindows, MadeVideo } from "../director/soundLines";
import { voiceClips } from "../director/voice";
import { fakeSite, waitFor } from "./fakeSite";
import { checkPlan, clipsToUpload, errorText, hasWords, runJob, startRunner, type Director } from "./index";
import { LINES_VERSION, type Job3D, type Project3D, type VoicePlan } from "./protocol";
import { createSite } from "./site";

const silent = () => {};

function claimed(task: Job3D["task"], extra: Partial<Project3D> = {}, voice?: VoicePlan): { project: Project3D; job: Job3D; voice?: VoicePlan } {
  const now = new Date().toISOString();
  return {
    project: { id: "p1", createdAt: now, updatedAt: now, topic: "Что такое сид-фраза", script: null, scriptVersion: 0, job: null, video: null, ...extra },
    job: { id: "j1", task, state: "running", step: "Взято", progress: 0, createdAt: now, startedAt: now },
    ...(voice ? { voice } : {}),
  };
}

const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
/** Owner, Claude, owner, a tag-only owner line, Claude repeating the first owner line's words. */
const dubScript = {
  title: "Сид",
  lines: [
    { who: "me" as const, text: "Что такое сид-фраза?" },
    { who: "claude" as const, text: "Двенадцать слов." },
    { who: "me" as const, text: "[sighs] И всё?" },
    { who: "me" as const, text: "[laughs]" },
    { who: "claude" as const, text: "Что такое сид-фраза?" },
  ],
};
const dubKeys = ["k-what", "k-twelve", "k-all", "k-laugh", "k-what"];

const notCalled = (name: string) => async (): Promise<never> => {
  throw new Error(`${name} не должен вызываться`);
};
/** The director's idea and dub steps, for tests of the other jobs. */
const unused = { findIdea: notCalled("findIdea"), makeDub: notCalled("makeDub"), findLineWindows: notCalled("findLineWindows") };

/** Waits until the director's signal aborts, as a well-behaved long step does. */
const untilAbort = (hooks: Hooks) =>
  new Promise<never>((_, reject) => hooks.signal.addEventListener("abort", () => reject(new Error("остановлено")), { once: true }));

const ok = { status: 200, body: { ok: true } };

test("claim → script: the runner writes the dialogue, sends it and completes the job", async () => {
  const job = claimed("script", { notes: "покороче" });
  let claims = 0;
  const site = await fakeSite(req => {
    if (req.path === "/api/3d/runner/claim") return { status: 200, body: ++claims === 1 ? job : { job: null } };
    return ok;
  });
  const seenSpecs: unknown[] = [];
  const director: Director = {
    ...unused,
    writeScript: async (spec, hooks) => {
      seenSpecs.push(spec);
      hooks.stage("Claude пишет диалог", 40);
      await sleep(80);
      return { title: "Сид-фраза", lines: [{ who: "me", text: "Что это за слова?" }, { who: "claude", text: "[laughs] Ключ от всего." }] };
    },
    makeMontage: notCalled("makeMontage"),
    voiceLines: notCalled("voiceLines"),
  };
  const runner = startRunner({ site: createSite({ url: site.url, password: "pw", retryDelaysMs: [5] }), director, pollMs: 20, heartbeatMs: 10, log: silent });
  try {
    await waitFor(() => site.calls("/api/3d/runner/complete").length === 1);
    await sleep(60);
    assert.equal(site.calls("/api/3d/runner/complete").length, 1, "одно задание — одно завершение");
    assert.deepEqual(seenSpecs, [{ id: "p1", topic: "Что такое сид-фраза", notes: "покороче", script: null, scriptVersion: 0 }]);
    const [script] = site.calls("/api/3d/runner/script");
    assert.deepEqual(script.json, {
      id: "p1",
      jobId: "j1",
      script: { title: "Сид-фраза", lines: [{ who: "me", text: "Что это за слова?" }, { who: "claude", text: "[laughs] Ключ от всего." }] },
    });
    assert.deepEqual(site.calls("/api/3d/runner/complete")[0].json, { id: "p1", jobId: "j1" });
    const progress = site.calls("/api/3d/runner/progress").map(req => req.json);
    assert.ok(progress.some(body => body.step === "Claude пишет диалог" && body.progress === 40 && body.jobId === "j1"), "пульс несёт последний шаг");
    const order = site.seen.map(req => req.path).filter(p => p !== "/api/3d/runner/progress" && p !== "/api/3d/runner/claim");
    assert.deepEqual(order, ["/api/3d/runner/script", "/api/3d/runner/complete"]);
    assert.ok(site.seen.every(req => req.headers.authorization === "Basic " + Buffer.from("worker:pw").toString("base64")));
  } finally {
    await runner.stop();
    await site.close();
  }
});

test("«Создать видео»: the script job first picks an idea, the site stores it, the script is written from what it stored", async () => {
  const job = claimed("script", { topic: "", auto: true });
  let claims = 0;
  const card = { key: "youtube:NyOSBMuh8IY", title: "Вернись домой", plot: "Я диктую Клоду сообщение девушке…", opening: "Клод, помоги", handle: "MrMacaroni", views: 188000, multiple: 11.4 };
  const site = await fakeSite(req => {
    if (req.path === "/api/3d/runner/claim") return { status: 200, body: ++claims === 1 ? job : { job: null } };
    if (req.path === "/api/3d/runner/ideas") return { status: 200, body: { cards: [card], recent: ["Пранк с лимитом: снимаю пранк"] } };
    if (req.path === "/api/3d/runner/idea") return { status: 200, body: { ok: true, topic: "Я диктую Клоду слёзное сообщение девушке.", notes: "Формула взята у ролика" } };
    return ok;
  });
  const pools: unknown[] = [];
  const specs: unknown[] = [];
  const director: Director = {
    ...unused,
    findIdea: async (pool, hooks) => {
      pools.push(pool);
      hooks.stage("Клод выбирает идею", 8);
      return { key: card.key, topic: "Я диктую Клоду слёзное сообщение девушке.", why: "узнаваемо" };
    },
    writeScript: async spec => {
      specs.push({ ...spec });
      return { title: "Вернись домой", lines: [{ who: "me", text: "Клод, пиши ей." }, { who: "claude", text: "Что именно?" }] };
    },
    makeMontage: notCalled("makeMontage"),
    voiceLines: notCalled("voiceLines"),
  };
  const runner = startRunner({ site: createSite({ url: site.url, password: "pw", retryDelaysMs: [5] }), director, pollMs: 20, heartbeatMs: 10, log: silent });
  try {
    await waitFor(() => site.calls("/api/3d/runner/complete").length === 1);
    assert.deepEqual(pools, [{ cards: [card], recent: ["Пранк с лимитом: снимаю пранк"] }]);
    assert.deepEqual(site.calls("/api/3d/runner/idea")[0].json, { id: "p1", jobId: "j1", key: card.key, topic: "Я диктую Клоду слёзное сообщение девушке." });
    assert.deepEqual(specs, [{ id: "p1", topic: "Я диктую Клоду слёзное сообщение девушке.", notes: "Формула взята у ролика", script: null, scriptVersion: 0 }]);
    const order = site.seen.map(req => req.path).filter(p => p !== "/api/3d/runner/progress" && p !== "/api/3d/runner/claim");
    assert.deepEqual(order, ["/api/3d/runner/ideas", "/api/3d/runner/idea", "/api/3d/runner/script", "/api/3d/runner/complete"]);
  } finally {
    await runner.stop();
    await site.close();
  }
});

test("montage: the video goes up and the job completes with its duration and script version", async () => {
  const workRoot = await fs.mkdtemp(path.join(os.tmpdir(), "studio3d-runner-"));
  const job = claimed("montage", { script: { title: "Т", lines: [{ who: "me", text: "Привет" }] }, scriptVersion: 3 });
  let uploaded = Buffer.alloc(0);
  const site = await fakeSite(req => {
    if (req.method === "PUT") {
      uploaded = Buffer.concat([uploaded, req.raw]);
      return { status: 200, body: uploaded.length >= Number(req.headers["x-file-size"]) ? { done: true } : { ok: true, received: uploaded.length } };
    }
    return ok;
  });
  let workDirSeen = "";
  const director: Director = {
    ...unused,
    writeScript: notCalled("writeScript"),
    makeMontage: async (spec, workDir, hooks) => {
      workDirSeen = workDir;
      assert.equal(spec.script.lines[0].text, "Привет");
      hooks.stage("Рендер", 70);
      await fs.writeFile(path.join(workDir, "final.mp4"), Buffer.alloc(3000, 7));
      return { video: "final.mp4", duration: 12.5 };
    },
    voiceLines: notCalled("voiceLines"),
  };
  try {
    await runJob(job, { site: createSite({ url: site.url, password: "pw", retryDelaysMs: [5], chunkBytes: 1024 }), director, workRoot, heartbeatMs: 10, log: silent });
    assert.equal(workDirSeen, path.join(workRoot, "p1"));
    assert.deepEqual(uploaded, Buffer.alloc(3000, 7));
    assert.deepEqual(site.calls("/api/3d/runner/complete").map(req => req.json), [{ id: "p1", jobId: "j1", video: { duration: 12.5, scriptVersion: 3 } }]);
  } finally {
    await site.close();
    await fs.rm(workRoot, { recursive: true, force: true });
  }
});

test("a 409 on progress aborts the job and nothing more goes to the site", async () => {
  let beats = 0;
  const site = await fakeSite(req => {
    if (req.path === "/api/3d/runner/progress") return ++beats === 1 ? ok : { status: 409, body: { error: "задание у другого" } };
    return ok;
  });
  let aborted = false;
  const director: Director = {
    ...unused,
    writeScript: async (_spec, hooks) => {
      hooks.signal.addEventListener("abort", () => (aborted = true));
      return untilAbort(hooks);
    },
    makeMontage: notCalled("makeMontage"),
    voiceLines: notCalled("voiceLines"),
  };
  try {
    await runJob(claimed("script"), { site: createSite({ url: site.url, password: "pw", retryDelaysMs: [5] }), director, heartbeatMs: 10, log: silent });
    assert.ok(aborted, "сигнал режиссёра прерван");
    assert.equal(site.calls("/api/3d/runner/script").length, 0);
    assert.equal(site.calls("/api/3d/runner/complete").length, 0);
  } finally {
    await site.close();
  }
});

test("a failure completes the job with a short Russian message that keeps the cause", async () => {
  const site = await fakeSite(() => ok);
  const director: Director = {
    ...unused,
    writeScript: async () => {
      throw new Error("Мост Claude не ответил", { cause: new Error("connect ECONNREFUSED 127.0.0.1:43135") });
    },
    makeMontage: notCalled("makeMontage"),
    voiceLines: notCalled("voiceLines"),
  };
  try {
    await runJob(claimed("script"), { site: createSite({ url: site.url, password: "pw", retryDelaysMs: [5] }), director, heartbeatMs: 10, log: silent });
    const [complete] = site.calls("/api/3d/runner/complete");
    assert.equal(complete.json.error, "Мост Claude не ответил — connect ECONNREFUSED 127.0.0.1:43135");
  } finally {
    await site.close();
  }
  assert.equal(errorText(new Error("x".repeat(2000)), "montage").length, 600);
  assert.match(errorText(new Error("ENOENT: no such file"), "montage"), /^Монтаж не сделан: ENOENT/);
});

test("a montage without a script fails before the director is called", async () => {
  const site = await fakeSite(() => ok);
  try {
    await runJob(claimed("montage"), { site: createSite({ url: site.url, password: "pw", retryDelaysMs: [5] }), director: { writeScript: notCalled("writeScript"), makeMontage: notCalled("makeMontage"), voiceLines: notCalled("voiceLines"), ...unused }, heartbeatMs: 10, log: silent });
    assert.match(site.calls("/api/3d/runner/complete")[0].json.error, /Сначала нужен сценарий/);
  } finally {
    await site.close();
  }
});

test("stop() aborts the running job and tells the site it was stopped", async () => {
  let claims = 0;
  const site = await fakeSite(req => {
    if (req.path === "/api/3d/runner/claim") return { status: 200, body: ++claims === 1 ? claimed("script") : { job: null } };
    return ok;
  });
  let started = false;
  const director: Director = {
    ...unused,
    writeScript: async (_spec, hooks) => {
      started = true;
      return untilAbort(hooks);
    },
    makeMontage: notCalled("makeMontage"),
    voiceLines: notCalled("voiceLines"),
  };
  const runner = startRunner({ site: createSite({ url: site.url, password: "pw", retryDelaysMs: [5] }), director, pollMs: 20, heartbeatMs: 10, log: silent });
  try {
    await waitFor(() => started);
    const began = Date.now();
    await runner.stop(2000);
    assert.ok(Date.now() - began < 1500, "остановка укладывается в секунды");
    assert.equal(runner.busy, false);
    assert.match(site.calls("/api/3d/runner/complete")[0].json.error, /остановили/);
  } finally {
    await site.close();
  }
});

test("voice: every line's own clip goes up under its plan key, and the job completes without a video", async () => {
  const workRoot = await fs.mkdtemp(path.join(os.tmpdir(), "studio3d-runner-"));
  const job = claimed("voice", { script: dubScript, scriptVersion: 2 }, { keys: dubKeys, ownVoice: false, dubVersion: 0, lines: [] });
  const site = await fakeSite(() => ok);
  let workDirSeen = "";
  const director: Director = {
    ...unused,
    writeScript: notCalled("writeScript"),
    makeMontage: notCalled("makeMontage"),
    voiceLines: async (spec, workDir, hooks) => {
      workDirSeen = workDir;
      assert.equal(spec.script.lines.length, 5);
      hooks.stage("Озвучка реплик: 2 из 4", 45);
      const dir = path.join(workDir, "voice", "lines");
      await fs.mkdir(dir, { recursive: true });
      const clips = [0, 1, 2, 3, 4].map(index => ({ index, who: dubScript.lines[index].who, file: path.join(dir, `line${index}.mp3`), duration: 1 + index / 10 }));
      for (const clip of clips) await fs.writeFile(clip.file, Buffer.alloc(200 + clip.index, clip.index));
      return clips;
    },
  };
  try {
    await runJob(job, { site: createSite({ url: site.url, password: "pw", retryDelaysMs: [5] }), director, workRoot, heartbeatMs: 10, log: silent });
    assert.equal(workDirSeen, path.join(workRoot, "p1"), "та же папка, что у монтажа: кеш реплик общий");
    const puts = site.seen.filter(req => req.method === "PUT");
    // the fifth line shares its words (and key) with the first: one clip per key
    assert.deepEqual(
      puts.map(req => [req.path, req.query.get("jobId"), req.query.get("duration"), req.headers["content-type"], req.raw.length]),
      [
        ["/api/3d/runner/clip/p1/k-what", "j1", "1.000", "audio/mpeg", 200],
        ["/api/3d/runner/clip/p1/k-twelve", "j1", "1.100", "audio/mpeg", 201],
        ["/api/3d/runner/clip/p1/k-all", "j1", "1.200", "audio/mpeg", 202],
        ["/api/3d/runner/clip/p1/k-laugh", "j1", "1.300", "audio/mpeg", 203],
      ],
    );
    assert.deepEqual(puts[1].raw, Buffer.alloc(201, 1));
    assert.deepEqual(site.calls("/api/3d/runner/complete").map(req => req.json), [{ id: "p1", jobId: "j1" }]);
    const order = site.seen.map(req => req.path).filter(p => p !== "/api/3d/runner/progress");
    assert.equal(order[order.length - 1], "/api/3d/runner/complete", "завершение — после всех реплик");
  } finally {
    await site.close();
    await fs.rm(workRoot, { recursive: true, force: true });
  }
});

test("voice with the real line voicing: tag-only lines need no clip, every line with words gets one, and the job completes", async () => {
  // the director's own per-line voicing (what montage.voiceLines calls) with ElevenLabs stubbed: no paid request
  process.env.ELEVENLABS_API_KEY = "test-key";
  const workRoot = await fs.mkdtemp(path.join(os.tmpdir(), "studio3d-runner-"));
  const synth = path.join(workRoot, "synth.mp3");
  await promisify(execFile)("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=300:duration=0.5:sample_rate=44100", "-c:a", "libmp3lame", synth]);
  const audio = (await fs.readFile(synth)).toString("base64");
  const original = globalThis.fetch;
  const asked: { voice: string; text: string }[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (!url.startsWith("https://api.elevenlabs.io/")) return original(input, init);
    const text = String(JSON.parse(String(init?.body)).text);
    asked.push({ voice: url.split("/text-to-speech/")[1].split("/")[0], text });
    const chars = [...text];
    return Response.json({ audio_base64: audio, alignment: { characters: chars, character_start_times_seconds: chars.map((_, i) => i * 0.02), character_end_times_seconds: chars.map((_, i) => (i + 1) * 0.02) } });
  }) as typeof fetch;
  const cast = {
    me: { kind: "human", name: "Ты", voice: "voice-me", look: {}, tts: { model: "eleven_v3", loudness: -18 } },
    claude: { kind: "blocky", name: "Клод", color: "#d97757", voice: "voice-claude", tts: { model: "eleven_v4", loudness: -22 } },
  } satisfies CastFile;
  const script = {
    title: "Мем-коин",
    lines: [
      { who: "me" as const, text: "Клод, я купил мем-коин!" },
      { who: "claude" as const, text: "[sighs]" },
      { who: "me" as const, text: "Что не так?" },
      { who: "me" as const, text: "[pause]" },
      { who: "claude" as const, text: "[laughs]" },
      { who: "me" as const, text: "[laughs]" },
      { who: "claude" as const, text: "[softly] Что не так?" },
    ],
  };
  const keys = ["k-coin", "k-sigh", "k-wrong", "k-pause", "k-laugh", "k-laugh", "k-wrong"];
  const site = await fakeSite(() => ok);
  const director: Director = {
    ...unused,
    writeScript: notCalled("writeScript"),
    makeMontage: notCalled("makeMontage"),
    voiceLines: async (spec, workDir, hooks) =>
      (await voiceClips(spec.script, cast, workDir, hooks.signal, hooks.log)).map(c => ({ index: c.index, who: c.who, file: c.file, duration: Math.round(c.duration * 1000) / 1000 })),
  };
  try {
    await runJob(claimed("voice", { script, scriptVersion: 1 }, { keys, ownVoice: false, dubVersion: 0, lines: [] }), {
      site: createSite({ url: site.url, password: "pw", retryDelaysMs: [5] }),
      director,
      workRoot,
      heartbeatMs: 10,
      log: silent,
    });
    // Claude's line model drops his tags, so «[sighs]» and «[laughs]» are never voiced; the owner's v3 plays «[laughs]»
    assert.deepEqual(asked.map(a => `${a.voice}: ${a.text}`), ["voice-me: Клод, я купил мем-коин!", "voice-me: Что не так?", "voice-me: [laughs]", "voice-claude: Что не так?"]);
    const [complete] = site.calls("/api/3d/runner/complete").map(req => req.json);
    assert.deepEqual(complete, { id: "p1", jobId: "j1" }, "задание завершено без ошибки");
    const uploaded = site.seen.filter(req => req.method === "PUT").map(req => req.path.split("/").pop());
    // one clip per key, from the first line that has it: Claude's equal words never stand in for the owner's line
    assert.deepEqual(uploaded, ["k-coin", "k-wrong"]);
    // what the site requires: a clip for every line with words
    assert.deepEqual(script.lines.flatMap((line, i) => (hasWords(line.text) && !uploaded.includes(keys[i]) ? [i] : [])), []);
  } finally {
    globalThis.fetch = original;
    await site.close();
    await fs.rm(workRoot, { recursive: true, force: true });
  }
});

test("clipsToUpload: one clip per key from its first line; a line with words and no clip fails the job by its number", () => {
  const script = {
    title: "Т",
    lines: [
      { who: "claude" as const, text: "[laughs]" },
      { who: "me" as const, text: "[laughs]" },
      { who: "me" as const, text: "Да." },
      { who: "claude" as const, text: "Да!" },
    ],
  };
  const keys = ["k-laugh", "k-laugh", "k-da", "k-da"];
  const plan: VoicePlan = { keys, ownVoice: false, dubVersion: 0, lines: [] };
  const clip = (index: number): VoicedClip => ({ index, who: script.lines[index]?.who ?? "me", file: `l${index}.mp3`, duration: 1 });
  // the owner's laugh is voiced, but the site files key k-laugh under Claude's earlier line: it stays home
  assert.deepEqual(clipsToUpload([clip(1), clip(2), clip(3)], plan, script).map(c => c.index), [2]);
  assert.throws(() => clipsToUpload([clip(1), clip(3)], plan, script), /Не озвучены реплики 3, 4$/);
  assert.throws(() => clipsToUpload([clip(2), clip(9)], plan, script), /Озвучена реплика 10, которой нет в сценарии/);
  assert.deepEqual(clipsToUpload([], { ...plan, keys: ["a", "b"] }, { title: "Т", lines: [script.lines[0], { who: "me", text: "[pause]" }] }), [], "одни теги — озвучивать нечего, и это не ошибка");
});

test("voice: a claim without the plan or with keys that do not fit the script fails before anything is voiced", async () => {
  const site = await fakeSite(() => ok);
  const director: Director = { writeScript: notCalled("writeScript"), makeMontage: notCalled("makeMontage"), voiceLines: notCalled("voiceLines"), ...unused };
  const options = { site: createSite({ url: site.url, password: "pw", retryDelaysMs: [5] }), director, heartbeatMs: 10, log: silent };
  try {
    await runJob(claimed("voice", { script: dubScript }), options);
    await runJob(claimed("voice", { script: dubScript }, { keys: ["k1"], ownVoice: false, dubVersion: 0, lines: [] }), options);
    const errors = site.calls("/api/3d/runner/complete").map(req => req.json.error);
    assert.match(errors[0], /не прислал ключи реплик/);
    assert.match(errors[1], /ключи реплик не совпадают со сценарием/);
    assert.equal(site.seen.filter(req => req.method === "PUT").length, 0);
  } finally {
    await site.close();
  }
});

test("montage in the owner's voice: the planned takes are downloaded once, handed to the montage, and the video says so", async () => {
  const workRoot = await fs.mkdtemp(path.join(os.tmpdir(), "studio3d-runner-"));
  const takes: Record<string, Buffer> = { "k-what": Buffer.from("fLaC-what-take-3"), "k-all": Buffer.from("fLaC-all-take-1") };
  const plan: VoicePlan = {
    keys: dubKeys,
    ownVoice: true,
    dubVersion: 7,
    lines: [
      { index: 0, key: "k-what", take: 3, bytes: takes["k-what"].length, sha256: sha(takes["k-what"]), text: "Что такое сид-фраза?" },
      { index: 2, key: "k-all", take: 1, bytes: takes["k-all"].length, sha256: sha(takes["k-all"]), text: "[sighs] И всё?" },
    ],
  };
  const site = await fakeSite(req => {
    const dub = req.path.match(/^\/api\/3d\/runner\/dub\/p1\/(.+)$/);
    if (dub) return { status: 200, raw: takes[decodeURIComponent(dub[1])], headers: { "x-sha256": sha(takes[decodeURIComponent(dub[1])]), "Content-Type": "audio/flac" } };
    if (req.method === "PUT") return { status: 200, body: { done: true } };
    return ok;
  });
  const seenVoices: MontageVoice[] = [];
  const director: Director = {
    ...unused,
    writeScript: notCalled("writeScript"),
    voiceLines: notCalled("voiceLines"),
    makeMontage: async (_spec, workDir, _hooks, voice) => {
      seenVoices.push(voice ?? {});
      for (const rec of voice?.recordings ?? []) assert.deepEqual(await fs.readFile(rec.file), takes[plan.lines.find(line => line.index === rec.index)!.key]);
      await fs.writeFile(path.join(workDir, "final.mp4"), Buffer.alloc(100, 1));
      return { video: "final.mp4", duration: 9 };
    },
  };
  const options = { site: createSite({ url: site.url, password: "pw", retryDelaysMs: [5] }), director, workRoot, heartbeatMs: 10, log: silent };
  try {
    await runJob(claimed("montage", { script: dubScript, scriptVersion: 4 }, plan), options);
    const gets = site.seen.filter(req => req.method === "GET");
    assert.deepEqual(gets.map(req => [req.path, req.query.get("jobId"), req.query.get("take")]), [
      ["/api/3d/runner/dub/p1/k-what", "j1", "3"],
      ["/api/3d/runner/dub/p1/k-all", "j1", "1"],
    ]);
    assert.deepEqual(seenVoices[0].recordings?.map(rec => [rec.index, rec.sha256, path.dirname(rec.file)]), [
      [0, plan.lines[0].sha256, path.join(workRoot, "p1", "dub")],
      [2, plan.lines[1].sha256, path.join(workRoot, "p1", "dub")],
    ]);
    assert.deepEqual(site.calls("/api/3d/runner/complete").map(req => req.json), [{ id: "p1", jobId: "j1", video: { duration: 9, scriptVersion: 4, ownVoice: true, dubVersion: 7 } }]);

    // a re-run finds the takes in its folder and fetches nothing
    await runJob(claimed("montage", { script: dubScript, scriptVersion: 4 }, plan), options);
    assert.equal(site.seen.filter(req => req.method === "GET").length, 2);
    assert.equal(seenVoices[1].recordings?.length, 2);
  } finally {
    await site.close();
    await fs.rm(workRoot, { recursive: true, force: true });
  }
});

test("montage with a plan: synthesized voice reports ownVoice false; a missing owner take fails before anything is fetched", async () => {
  const workRoot = await fs.mkdtemp(path.join(os.tmpdir(), "studio3d-runner-"));
  const site = await fakeSite(req => (req.method === "PUT" ? { status: 200, body: { done: true } } : ok));
  const seenVoices: (MontageVoice | undefined)[] = [];
  const director: Director = {
    ...unused,
    writeScript: notCalled("writeScript"),
    voiceLines: notCalled("voiceLines"),
    makeMontage: async (_spec, workDir, _hooks, voice) => {
      seenVoices.push(voice);
      await fs.writeFile(path.join(workDir, "final.mp4"), Buffer.alloc(10, 1));
      return { video: "final.mp4", duration: 5 };
    },
  };
  const options = { site: createSite({ url: site.url, password: "pw", retryDelaysMs: [5] }), director, workRoot, heartbeatMs: 10, log: silent };
  const take = { index: 0, key: "k-what", take: 1, bytes: 10, sha256: "a".repeat(64), text: "Что такое сид-фраза?" };
  try {
    await runJob(claimed("montage", { script: dubScript, scriptVersion: 1 }, { keys: dubKeys, ownVoice: false, dubVersion: 3, lines: [take] }), options);
    assert.deepEqual(seenVoices, [{}]);
    await runJob(claimed("montage", { script: dubScript, scriptVersion: 1 }, { keys: dubKeys, ownVoice: true, dubVersion: 3, lines: [take] }), options);
    assert.equal(seenVoices.length, 1, "без всех записей монтаж не начинается");
    const completes = site.calls("/api/3d/runner/complete").map(req => req.json);
    assert.deepEqual(completes[0].video, { duration: 5, scriptVersion: 1, ownVoice: false });
    // line 3 has words and no take; line 4 is only [laughs] and may stay synthesized
    assert.match(completes[1].error, /записаны все ваши реплики: нет записи реплики 3$/);
    assert.equal(site.seen.filter(req => req.method === "GET").length, 0);
  } finally {
    await site.close();
    await fs.rm(workRoot, { recursive: true, force: true });
  }
});

test("checkPlan refuses takes for lines that do not exist or are not the owner's, and bad checksums", () => {
  const base = { keys: dubKeys, ownVoice: true, dubVersion: 1 };
  const line = (index: number, extra = {}) => ({ index, key: "k", take: 1, bytes: 10, sha256: "b".repeat(64), text: "x", ...extra });
  const all = [line(0), line(2)];
  assert.doesNotThrow(() => checkPlan({ ...base, lines: all }, dubScript, true));
  assert.throws(() => checkPlan({ ...base, lines: [...all, line(9)] }, dubScript, false), /реплики 10, а в сценарии их 5/);
  assert.throws(() => checkPlan({ ...base, lines: [...all, line(1)] }, dubScript, false), /говорит не владелец/);
  assert.throws(() => checkPlan({ ...base, lines: [line(0, { sha256: "nothex" }), line(2)] }, dubScript, false), /контрольной суммы/);
  assert.throws(() => checkPlan({ ...base, lines: [line(0), line(0), line(2)] }, dubScript, false), /две записи реплики 1/);
  assert.throws(() => checkPlan({ ...base, lines: [] }, dubScript, false), /нет записи реплик 1, 3/);
  // keys matter only to the "voice" job
  assert.doesNotThrow(() => checkPlan({ ...base, keys: [], lines: all }, dubScript, false));
  assert.throws(() => checkPlan({ ...base, keys: [], lines: all }, dubScript, true), /ключи реплик/);
  assert.equal(errorText(new Error("ENOENT"), "voice"), "Реплики не озвучены: ENOENT");
});

test("montage: the video's line windows go to the site with it, with how they were found; windows that break the protocol are left out", async () => {
  const workRoot = await fs.mkdtemp(path.join(os.tmpdir(), "studio3d-runner-"));
  const site = await fakeSite(req => (req.method === "PUT" ? { status: 200, body: { done: true } } : ok));
  const windows = [{ index: 0, who: "me", start: 0.4, end: 1.6 }, { index: 2, who: "claude", start: 2, end: 3.5 }];
  const results: MadeVideo[] = [
    { video: "final.mp4", duration: 8, lines: windows },
    { video: "final.mp4", duration: 8, lines: [{ index: 0, who: "robot", start: 0.4, end: 1.6 }], linesVersion: LINES_VERSION },
    { video: "final.mp4", duration: 8, lines: windows, linesVersion: LINES_VERSION },
    // a version this runner's protocol does not know goes as letter windows
    { video: "final.mp4", duration: 8, lines: windows, linesVersion: LINES_VERSION + 1 },
  ];
  const director: Director = {
    ...unused,
    writeScript: notCalled("writeScript"),
    voiceLines: notCalled("voiceLines"),
    makeMontage: async (_spec, workDir) => {
      await fs.writeFile(path.join(workDir, "final.mp4"), Buffer.alloc(10, 1));
      return results.shift()!;
    },
  };
  const options = { site: createSite({ url: site.url, password: "pw", retryDelaysMs: [5] }), director, workRoot, heartbeatMs: 10, log: silent };
  try {
    for (let n = 0; n < 4; n++) await runJob(claimed("montage", { script: dubScript, scriptVersion: 2 }), options);
    assert.deepEqual(site.calls("/api/3d/runner/complete").map(req => req.json.video), [
      { duration: 8, scriptVersion: 2, lines: windows },
      { duration: 8, scriptVersion: 2 },
      { duration: 8, scriptVersion: 2, lines: windows, linesVersion: LINES_VERSION },
      { duration: 8, scriptVersion: 2, lines: windows },
    ]);
  } finally {
    await site.close();
    await fs.rm(workRoot, { recursive: true, force: true });
  }
});

test("montage: the work folder is marked with the video's time once the site took it; a refused upload or a failed job leaves it pending", async () => {
  const workRoot = await fs.mkdtemp(path.join(os.tmpdir(), "studio3d-runner-"));
  const workDir = path.join(workRoot, "p1");
  let refuseUpload = false;
  let answer: unknown = null;
  const site = await fakeSite(req => {
    if (req.method === "PUT") return refuseUpload ? { status: 400, body: { error: "Видео не принято" } } : { status: 200, body: { done: true } };
    if (req.path === "/api/3d/runner/complete") return { status: 200, body: answer };
    return ok;
  });
  const director: Director = {
    ...unused,
    writeScript: notCalled("writeScript"),
    voiceLines: notCalled("voiceLines"),
    // as the real montage does once it starts replacing the previous one's files
    makeMontage: async (_spec, dir) => {
      writeMark(dir, { state: "pending" });
      await fs.writeFile(path.join(dir, "final.mp4"), Buffer.alloc(10, 1));
      return { video: "final.mp4", duration: 8 };
    },
  };
  const options = { site: createSite({ url: site.url, password: "pw", retryDelaysMs: [5] }), director, workRoot, heartbeatMs: 10, log: silent };
  const montage = () => runJob(claimed("montage", { script: dubScript, scriptVersion: 2 }), options);
  try {
    answer = { ok: true, job: { id: "j1", task: "montage", state: "done", finishedAt: "2026-10-22T12:00:00.000Z" } };
    await montage();
    assert.deepEqual(readMark(workDir), { state: "shown", videoAt: "2026-10-22T12:00:00.000Z", jobId: "j1" });
    refuseUpload = true;
    await montage();
    assert.match(site.calls("/api/3d/runner/complete").at(-1)!.json.error, /Видео не принято/);
    assert.deepEqual(readMark(workDir), { state: "pending" }, "ролик не дошёл до сайта");
    refuseUpload = false;
    answer = { ok: true, job: { id: "j1", task: "montage", state: "error", error: "Видео не загрузилось на сайт" } };
    await montage();
    assert.deepEqual(readMark(workDir), { state: "pending" }, "сайт не принял ролик");
    // a site that does not answer with the job: the folder is told by length, as before marks
    answer = { ok: true };
    await montage();
    assert.equal(readMark(workDir), null);
  } finally {
    await site.close();
    await fs.rm(workRoot, { recursive: true, force: true });
  }
});

test("voice: a video without windows gets them from its montage in the work folder; with windows or after a script edit nobody looks", async () => {
  const workRoot = await fs.mkdtemp(path.join(os.tmpdir(), "studio3d-runner-"));
  const site = await fakeSite(() => ok);
  const asked: unknown[][] = [];
  let answer: () => Promise<FoundWindows | null> = async () => ({ videoDuration: 9.4, lines: [{ index: 0, who: "me", start: 1, end: 2 }] });
  const director: Director = {
    ...unused,
    writeScript: notCalled("writeScript"),
    makeMontage: notCalled("makeMontage"),
    voiceLines: async (spec, workDir) => {
      const dir = path.join(workDir, "voice", "lines");
      await fs.mkdir(dir, { recursive: true });
      const clips = [0, 1, 2, 4].map(index => ({ index, who: spec.script.lines[index].who, file: path.join(dir, `line${index}.mp3`), duration: 1 }));
      for (const clip of clips) await fs.writeFile(clip.file, Buffer.alloc(100, clip.index));
      return clips;
    },
    findLineWindows: async (...args) => {
      asked.push(args.slice(0, 3));
      return answer();
    },
  };
  const options = { site: createSite({ url: site.url, password: "pw", retryDelaysMs: [5] }), director, workRoot, heartbeatMs: 10, log: silent };
  const plan: VoicePlan = { keys: dubKeys, ownVoice: false, dubVersion: 0, lines: [] };
  const video = { file: "video.mp4", at: "2026-10-22T10:00:00.000Z", duration: 9.4, scriptVersion: 3 };
  try {
    await runJob(claimed("voice", { script: dubScript, scriptVersion: 3, video }, plan), options);
    assert.deepEqual(asked, [[path.join(workRoot, "p1"), { duration: 9.4, at: video.at }, dubScript]]);
    // already has windows from the sound; made from an older script; a failure on the way does not cost the job
    const measured = { ...video, lines: [{ index: 0, who: "me" as const, start: 1, end: 2 }], linesVersion: LINES_VERSION };
    await runJob(claimed("voice", { script: dubScript, scriptVersion: 3, video: measured }, plan), options);
    await runJob(claimed("voice", { script: dubScript, scriptVersion: 4, video }, plan), options);
    answer = async () => {
      throw new Error("ffprobe не найден");
    };
    await runJob(claimed("voice", { script: dubScript, scriptVersion: 3, video }, plan), options);
    assert.equal(asked.length, 2);
    assert.deepEqual(site.calls("/api/3d/runner/complete").map(req => req.json), [
      { id: "p1", jobId: "j1", videoLines: { videoDuration: 9.4, lines: [{ index: 0, who: "me", start: 1, end: 2 }] } },
      { id: "p1", jobId: "j1" },
      { id: "p1", jobId: "j1" },
      { id: "p1", jobId: "j1" },
    ]);
  } finally {
    await site.close();
    await fs.rm(workRoot, { recursive: true, force: true });
  }
});

test("voice: a video with windows from the letters gets windows measured from the sound (version 2); the same kind is not sent again", async () => {
  const workRoot = await fs.mkdtemp(path.join(os.tmpdir(), "studio3d-runner-"));
  const site = await fakeSite(() => ok);
  const letters = [{ index: 0, who: "me" as const, start: 1, end: 2 }];
  const heard = [{ index: 0, who: "me", start: 0.62, end: 2.13 }];
  let answer: FoundWindows | null = { videoDuration: 9.4, lines: heard, version: LINES_VERSION };
  let asked = 0;
  const director: Director = {
    ...unused,
    writeScript: notCalled("writeScript"),
    makeMontage: notCalled("makeMontage"),
    voiceLines: async (spec, workDir) => {
      const dir = path.join(workDir, "voice", "lines");
      await fs.mkdir(dir, { recursive: true });
      const clips = [0, 1, 2, 4].map(index => ({ index, who: spec.script.lines[index].who, file: path.join(dir, `line${index}.mp3`), duration: 1 }));
      for (const clip of clips) await fs.writeFile(clip.file, Buffer.alloc(100, clip.index));
      return clips;
    },
    findLineWindows: async () => {
      asked++;
      return answer;
    },
  };
  const options = { site: createSite({ url: site.url, password: "pw", retryDelaysMs: [5] }), director, workRoot, heartbeatMs: 10, log: silent };
  const plan: VoicePlan = { keys: dubKeys, ownVoice: false, dubVersion: 0, lines: [] };
  const video = { file: "video.mp4", at: "2026-10-22T10:00:00.000Z", duration: 9.4, scriptVersion: 3, lines: letters };
  try {
    // windows stored before they were measured (no version, or 1): the montage's are measured from the sound now
    await runJob(claimed("voice", { script: dubScript, scriptVersion: 3, video }, plan), options);
    await runJob(claimed("voice", { script: dubScript, scriptVersion: 3, video: { ...video, linesVersion: 1 } }, plan), options);
    // the montage has no voice timings next to it: its windows are the letters' again, nothing better to send
    answer = { videoDuration: 9.4, lines: letters };
    await runJob(claimed("voice", { script: dubScript, scriptVersion: 3, video }, plan), options);
    assert.equal(asked, 3);
    assert.deepEqual(site.calls("/api/3d/runner/complete").map(req => req.json), [
      { id: "p1", jobId: "j1", videoLines: { videoDuration: 9.4, lines: heard, version: LINES_VERSION } },
      { id: "p1", jobId: "j1", videoLines: { videoDuration: 9.4, lines: heard, version: LINES_VERSION } },
      { id: "p1", jobId: "j1" },
    ]);
  } finally {
    await site.close();
    await fs.rm(workRoot, { recursive: true, force: true });
  }
});

/** The dub's script: the owner's line 1, Claude's line 2, the owner's laugh, the owner's line 4 (fakeMontage's lines). */
const dubOverScript = {
  title: "Сид",
  lines: [
    { who: "me" as const, text: "Что такое сид-фраза?" },
    { who: "claude" as const, text: "Двенадцать слов." },
    { who: "me" as const, text: "[laughs]" },
    { who: "me" as const, text: "[sighs] И всё?" },
  ],
};
const dubCast = {
  me: { kind: "human", name: "Ты", voice: "voice-me", look: {}, tts: { model: "eleven_v3", loudness: -18 } },
  claude: { kind: "blocky", name: "Клод", color: "#d97757", voice: "voice-claude", tts: { model: "eleven_v4", loudness: -22 } },
} satisfies CastFile;
const overVideo = {
  file: "video.mp4",
  at: "2026-10-22T10:00:00.000Z",
  duration: 6.2,
  scriptVersion: 2,
  lines: [
    { index: 0, who: "me" as const, start: 1, end: 2 },
    { index: 1, who: "claude" as const, start: 2.5, end: 3.5 },
    { index: 3, who: "me" as const, start: 4, end: 5 },
  ],
};

test("dub: the takes recorded over the video are fetched, the same montage is rendered with them, and the video goes up as his voice", async () => {
  process.env.ELEVENLABS_API_KEY = "test-key";
  const workRoot = await fs.mkdtemp(path.join(os.tmpdir(), "studio3d-runner-"));
  await fakeMontage(path.join(workRoot, "p1"));
  // two takes recorded from 2 s before their lines (FLAC, as the site stores them)
  const takes: Record<string, Buffer> = {};
  for (const [key, from] of [["k-what", 2.1], ["k-all", 2.2]] as const) {
    const file = path.join(workRoot, `${key}.flac`);
    await encodeFlac(sound(4, [from, from + 0.7, 220, 0.03]), file);
    takes[key] = await fs.readFile(file);
  }
  const plan: VoicePlan = {
    keys: ["k-what", "k-twelve", "k-laugh", "k-all"],
    ownVoice: true,
    dubVersion: 6,
    lines: [
      { index: 0, key: "k-what", take: 2, bytes: takes["k-what"].length, sha256: sha(takes["k-what"]), text: dubOverScript.lines[0].text, videoStart: -1, lineStart: 1, lineEnd: 2 },
      { index: 3, key: "k-all", take: 1, bytes: takes["k-all"].length, sha256: sha(takes["k-all"]), text: dubOverScript.lines[3].text, videoStart: 2, lineStart: 4, lineEnd: 5 },
    ],
  };
  let uploaded = Buffer.alloc(0);
  const site = await fakeSite(req => {
    const dub = req.path.match(/^\/api\/3d\/runner\/dub\/p1\/(.+)$/);
    if (dub) {
      const bytes = takes[decodeURIComponent(dub[1])];
      return { status: 200, raw: bytes, headers: { "x-sha256": sha(bytes), "Content-Type": "audio/flac" } };
    }
    if (req.method === "PUT") {
      uploaded = Buffer.concat([uploaded, req.raw]);
      return { status: 200, body: { done: true } };
    }
    if (req.path === "/api/3d/runner/complete") return { status: 200, body: { ok: true, job: { id: "j1", task: "dub", state: "done", finishedAt: "2026-10-22T12:00:00.000Z" } } };
    return ok;
  });
  const original = globalThis.fetch;
  const alignments: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (!url.startsWith("https://api.elevenlabs.io/")) return original(input, init);
    const text = String((init?.body as FormData).get("text"));
    alignments.push(text);
    return Response.json(aligned(text, 0.3, 0.6));
  }) as typeof fetch;
  const rendered: Record<string, unknown>[] = [];
  const director: Director = {
    ...unused,
    writeScript: notCalled("writeScript"),
    makeMontage: notCalled("makeMontage"),
    voiceLines: notCalled("voiceLines"),
    makeDub: (spec, workDir, hooks, dub) =>
      makeDub(spec, workDir, hooks, dub, {
        cast: dubCast,
        render: async (_code, input, _publicDir, out) => {
          rendered.push(input);
          await fs.writeFile(out, "ролик с его голосом");
        },
      }),
  };
  const logs: string[] = [];
  try {
    await runJob(claimed("dub", { script: dubOverScript, scriptVersion: 2, video: overVideo }, plan), {
      site: createSite({ url: site.url, password: "pw", retryDelaysMs: [5] }),
      director,
      workRoot,
      heartbeatMs: 10,
      log: line => logs.push(line),
    });
    const [complete] = site.calls("/api/3d/runner/complete").map(req => req.json);
    assert.deepEqual(complete, { id: "p1", jobId: "j1", video: { duration: 6.2, scriptVersion: 2, ownVoice: true, dubVersion: 6, lines: overVideo.lines } });
    assert.deepEqual(site.seen.filter(req => req.method === "GET").map(req => [req.path, req.query.get("take")]), [
      ["/api/3d/runner/dub/p1/k-what", "2"],
      ["/api/3d/runner/dub/p1/k-all", "1"],
    ]);
    assert.equal(uploaded.toString("utf8"), "ролик с его голосом");
    assert.deepEqual(alignments, ["Что такое сид-фраза?", "И всё?"]);
    const lines = rendered[0].lines as { who: string; words: { text: string; start: number }[] }[];
    assert.deepEqual(lines.map(l => l.words.map(w => w.text).join(" ")), ["Что такое сид-фраза?", "Двенадцать", "И всё?"]);
    assert.ok(Math.abs(lines[0].words[0].start - 1.05) < 0.01, `его слово там, где он его сказал (${lines[0].words[0].start})`);
    for (const step of ["Ищу исходники ролика", "Скачиваю твои записи: 1 из 2", "Скачиваю твои записи: 2 из 2", "Собираю звук", "Разметка губ: 1 из 2", "Рендер 3D", "Загружаю ролик"])
      assert.ok(logs.some(line => line.includes(`${step} (`)), `шаг «${step}» в журнале`);
    // the montage is the site's video of the dub's time now: the next dub over that video finds it
    assert.deepEqual(readMark(path.join(workRoot, "p1")), { state: "shown", videoAt: "2026-10-22T12:00:00.000Z", jobId: "j1" });
  } finally {
    globalThis.fetch = original;
    await site.close();
    await fs.rm(workRoot, { recursive: true, force: true });
  }
});

test("dub: no video, a take not recorded over it, or no montage of it on this computer fails with a reason and fetches nothing", async () => {
  const workRoot = await fs.mkdtemp(path.join(os.tmpdir(), "studio3d-runner-"));
  const site = await fakeSite(() => ok);
  const director: Director = {
    ...unused,
    writeScript: notCalled("writeScript"),
    makeMontage: notCalled("makeMontage"),
    voiceLines: notCalled("voiceLines"),
    makeDub: (spec, workDir, hooks, dub) => makeDub(spec, workDir, hooks, dub, { cast: dubCast, render: notCalled("render") }),
  };
  const options = { site: createSite({ url: site.url, password: "pw", retryDelaysMs: [5] }), director, workRoot, heartbeatMs: 10, log: silent };
  const take = { index: 0, key: "k-what", take: 1, bytes: 10, sha256: "c".repeat(64), text: "Что такое сид-фраза?", videoStart: -1, lineStart: 1, lineEnd: 2 };
  const plan = (lines: VoicePlan["lines"]): VoicePlan => ({ keys: [], ownVoice: true, dubVersion: 2, lines });
  try {
    await runJob(claimed("dub", { script: dubOverScript, scriptVersion: 2 }, plan([take])), options);
    const { videoStart: _videoStart, ...unplaced } = take;
    await runJob(claimed("dub", { script: dubOverScript, scriptVersion: 2, video: overVideo }, plan([unplaced])), options);
    await runJob(claimed("dub", { script: dubOverScript, scriptVersion: 2, video: overVideo }, plan([])), options);
    await runJob(claimed("dub", { script: dubOverScript, scriptVersion: 2, video: overVideo }, plan([take])), options);
    const errors = site.calls("/api/3d/runner/complete").map(req => req.json.error);
    assert.match(errors[0], /^Сначала нужен ролик/);
    assert.equal(errors[1], "Реплика 1 записана не поверх ролика — озвучьте её заново на странице озвучки");
    assert.match(errors[2], /^Нет ни одной записи поверх ролика/);
    assert.equal(errors[3], NO_SOURCES);
    assert.equal(site.seen.filter(req => req.method === "GET" || req.method === "PUT").length, 0);
    assert.match(errorText(new Error("ENOENT"), "dub"), /^Ролик с твоим голосом не собран: ENOENT/);
  } finally {
    await site.close();
    await fs.rm(workRoot, { recursive: true, force: true });
  }
});

test("voice backfill end to end: a montage with its voice timings sends windows from the sound of each clip", async () => {
  const workRoot = await fs.mkdtemp(path.join(os.tmpdir(), "studio3d-runner-"));
  const workDir = path.join(workRoot, "p1");
  await fakeMontage(workDir, { clips: true });
  const site = await fakeSite(() => ok);
  const director: Director = {
    ...unused,
    writeScript: notCalled("writeScript"),
    makeMontage: notCalled("makeMontage"),
    voiceLines: async (spec, dir) => {
      const lines = path.join(dir, "voice", "lines");
      await fs.mkdir(lines, { recursive: true });
      const clips = [0, 1, 3].map(index => ({ index, who: spec.script.lines[index].who, file: path.join(lines, `line${index}.mp3`), duration: 1 }));
      for (const clip of clips) await fs.writeFile(clip.file, Buffer.alloc(100, clip.index));
      return clips;
    },
    findLineWindows,
  };
  try {
    const plan: VoicePlan = { keys: ["k-what", "k-twelve", "k-laugh", "k-all"], ownVoice: false, dubVersion: 0, lines: [] };
    await runJob(claimed("voice", { script: dubOverScript, scriptVersion: 2, video: overVideo }, plan), {
      site: createSite({ url: site.url, password: "pw", retryDelaysMs: [5] }),
      director,
      workRoot,
      heartbeatMs: 10,
      log: silent,
    });
    const [complete] = site.calls("/api/3d/runner/complete").map(req => req.json);
    assert.equal(complete.videoLines.version, LINES_VERSION);
    assert.equal(complete.videoLines.videoDuration, 6.2);
    // the owner's first clip has a breath at 0.62 before his words at 1.0: his window starts with it
    const expected = [
      [0, "me", 0.59, 2.03],
      [1, "claude", 2.47, 3.53],
      [3, "me", 3.97, 5.03],
    ];
    const got = complete.videoLines.lines as { index: number; who: string; start: number; end: number }[];
    assert.deepEqual(got.map(l => [l.index, l.who]), expected.map(([index, who]) => [index, who]));
    got.forEach((l, k) => assert.ok(Math.abs(l.start - Number(expected[k][2])) <= 0.015 && Math.abs(l.end - Number(expected[k][3])) <= 0.015, `окно ${l.index}: ${l.start}–${l.end}`));
  } finally {
    await site.close();
    await fs.rm(workRoot, { recursive: true, force: true });
  }
});

test("dub: the video goes up with the windows of its montage and how they were found; the director hears how the site's were", async () => {
  const workRoot = await fs.mkdtemp(path.join(os.tmpdir(), "studio3d-runner-"));
  const site = await fakeSite(req => (req.method === "PUT" ? { status: 200, body: { done: true } } : ok));
  const measured = [{ index: 0, who: "me", start: 0.59, end: 2.03 }, { index: 1, who: "claude", start: 2.47, end: 3.53 }, { index: 3, who: "me", start: 3.97, end: 5.03 }];
  const asked: (number | undefined)[] = [];
  const director: Director = {
    ...unused,
    writeScript: notCalled("writeScript"),
    makeMontage: notCalled("makeMontage"),
    voiceLines: notCalled("voiceLines"),
    makeDub: async (_spec, workDir, _hooks, dub) => {
      asked.push(dub.linesVersion);
      await fs.writeFile(path.join(workDir, "dubbed.mp4"), "ролик");
      return { video: "dubbed.mp4", duration: 6.2, lines: measured, linesVersion: LINES_VERSION };
    },
  };
  const take = { index: 0, key: "k-what", take: 1, bytes: 10, sha256: "c".repeat(64), text: "Что такое сид-фраза?", videoStart: 0.4, lineStart: 0.59, lineEnd: 2.03 };
  const options = { site: createSite({ url: site.url, password: "pw", retryDelaysMs: [5] }), director, workRoot, heartbeatMs: 10, log: silent };
  try {
    await runJob(claimed("dub", { script: dubOverScript, scriptVersion: 2, video: { ...overVideo, linesVersion: LINES_VERSION } }, { keys: [], ownVoice: true, dubVersion: 4, lines: [take] }), options);
    const [complete] = site.calls("/api/3d/runner/complete").map(req => req.json);
    assert.deepEqual(complete.video, { duration: 6.2, scriptVersion: 2, ownVoice: true, dubVersion: 4, lines: measured, linesVersion: LINES_VERSION });
    // windows from the letters (no version said) and from the sound: the dub reports its windows the same way
    await runJob(claimed("dub", { script: dubOverScript, scriptVersion: 2, video: overVideo }, { keys: [], ownVoice: true, dubVersion: 4, lines: [take] }), options);
    assert.deepEqual(asked, [LINES_VERSION, 1]);
  } finally {
    await site.close();
    await fs.rm(workRoot, { recursive: true, force: true });
  }
});
