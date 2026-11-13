import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { Hooks } from "./api";
import type { CastFile } from "./cast";
import { DUB_KEEP_AFTER, DUB_KEEP_BEFORE, DUB_SPEECH_AIR } from "../runner/protocol";
import { buildDubVoice, clipsOf, DUB_DIR, EXACT_KEEP_AFTER, EXACT_KEEP_BEFORE, findLineWindows, limit, lineSpeech, lineWindows, makeDub, NO_SOURCES, scriptIndexes, SPEECH_AIR, type DubLine, type DubRequest, type DubTakeAudio } from "./dub";
import { aligned, FAKE_CLIPS, fakeMontage, N, sound } from "./dubFixture";
import { wordsLoudness } from "./lineVoice";
import { MARK_FILE, writeMark } from "./montageMark";
import type { VoicedLine } from "./mouth";
import { decodeMono, encodeFlac, RATE, type Recording } from "./recorded";
import { lineSounds, SOUND_LINES, strayWindows, type Span } from "./soundLines";
import { voiceScript } from "./voice";

const run = promisify(execFile);
// no test may reach the real key, and every request below goes to a stub
process.env.ELEVENLABS_API_KEY = "test-key";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "studio3d-dub-"));
const CEILING = 10 ** (-1 / 20);

const peak = (x: Float32Array) => x.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
const rmsDb = (x: Float32Array) => 10 * Math.log10(x.reduce((s, v) => s + v * v, 0) / Math.max(1, x.length) + 1e-12);

/** Replaces fetch for one test; every request is recorded with its URL and body. */
function stubFetch(answer: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const original = globalThis.fetch;
  const calls: { url: string; init: RequestInit }[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input instanceof Request ? input.url : input);
    calls.push({ url, init });
    return answer(url, init);
  }) as typeof fetch;
  return { calls, restore: () => (globalThis.fetch = original) };
}

const hooksFor = (steps: string[] = [], logs: string[] = []): Hooks => ({ stage: (step) => steps.push(step), log: (m) => logs.push(m), signal: new AbortController().signal });

const cast = {
  me: { kind: "human", name: "Ты", voice: "voice-me", look: {}, tts: { model: "eleven_v3", loudness: -18 } },
  claude: { kind: "blocky", name: "Клод", color: "#d97757", voice: "voice-claude", tts: { model: "eleven_v4", loudness: -22 } },
} satisfies CastFile;

test("a take lands at exactly the video time it was recorded at; Claude's lines around it keep every sample", async () => {
  // Claude 1.0–2.0, the owner's synthesized line 2.6–4.0, Claude again right after it at 4.2
  const lines = [
    { start: 1.0, end: 2.0 },
    { start: 2.6, end: 4.0 },
    { start: 4.2, end: 5.5 },
  ];
  const base = sound(8, [1.0, 2.0, 300, 0.2], [2.6, 4.0, 500, 0.2], [4.2, 5.5, 300, 0.2]);
  // recorded from 0.9 s of the video: Claude's line leaked into the mic before his words at 2.8–3.6
  const audio = sound(6, [0.1, 1.0, 700, 0.5], [1.9, 2.7, 220, 0.3]);
  const take: DubTakeAudio = { slot: 1, index: 4, videoStart: 0.9, window: [2.6, 4.0], audio };
  const { track, parts, gainDb } = await buildDubVoice(base, lines, [take], null);
  assert.equal(gainDb, 0);
  const [part] = parts;
  assert.equal(part.offset, N(0.9));
  assert.equal(part.from, N(2.35), "запись берётся с 0.25 с до окна");
  assert.equal(part.to, N(4.2), "и не заходит на следующую реплику Клода");
  const fade = N(0.015);
  for (let n = part.from + fade; n < part.to - fade; n++) if (track[n] !== audio[n - N(0.9)]) assert.fail(`сэмпл ${n} не на своём месте`);
  assert.equal(track[N(3.0)], audio[N(3.0) - N(0.9)], "секунда 3.0 ролика — это секунда 2.1 записи");
  // the synthesized line is gone where he did not speak, Claude's lines are exactly as they were
  assert.ok(peak(track.subarray(N(2.6), N(2.78))) < 1e-9, "синтезированная реплика заглушена");
  for (const [from, to] of [[0, 2.35], [4.2, 8]]) for (let n = N(from); n < N(to); n++) if (track[n] !== base[n]) assert.fail(`голос Клода изменён на ${n / RATE} с`);
});

test("his synthesized line goes from its real onset to its last sound; with its clip's bounds the whole clip goes; Claude's tail stays", async () => {
  // Claude 0.5–1.5, his tail to 1.62; the owner's clip: a breath 1.88–2.02, his first sound 70 ms before the
  // aligner's window 2.2–3.4, a tail to 3.55; Claude again from 4.0
  const lines = [
    { start: 0.5, end: 1.5 },
    { start: 2.2, end: 3.4 },
    { start: 4.0, end: 5.0 },
  ];
  const base = sound(6, [0.5, 1.62, 300, 0.2], [1.88, 2.02, 700, 0.05], [2.13, 3.4, 500, 0.2], [3.4, 3.55, 500, 0.03], [4.0, 5.0, 300, 0.2]);
  const take: DubTakeAudio = { slot: 1, index: 2, videoStart: 0, window: [2.2, 3.4], audio: sound(6, [2.3, 3.2, 220, 0.2]) };
  const unchanged = (track: Float32Array, voice: Float32Array, spans: [number, number][]) => {
    for (const [from, to] of spans) for (let n = N(from); n < N(to); n++) if (track[n] !== voice[n]) assert.fail(`голос Клода изменён на ${n / RATE} с`);
  };
  const heard = await buildDubVoice(base, lines, [take], null);
  assert.ok(peak(heard.track.subarray(N(1.87), N(2.3))) < 1e-6, `вдох и начало синтезированной реплики заглушены (${peak(heard.track.subarray(N(1.87), N(2.3)))})`);
  assert.ok(peak(heard.track.subarray(N(3.2), N(4.0))) < 1e-6, "и её хвост");
  unchanged(heard.track, base, [[0, 1.86], [4.0, 6]]);

  // the voiced take's timings know the clip: a breath 0.35 s before the words goes too, too far to hear as one with them
  const far = sound(6, [0.5, 1.62, 300, 0.2], [1.75, 1.85, 700, 0.05], [2.2, 3.4, 500, 0.2], [4.0, 5.0, 300, 0.2]);
  const clipped = await buildDubVoice(far, [lines[0], { ...lines[1], clip: [1.7, 3.6] }, lines[2]], [take], null);
  assert.ok(peak(clipped.track.subarray(N(1.7), N(2.3))) < 1e-6, "весь клип синтезированной реплики заглушён");
  unchanged(clipped.track, far, [[0, 1.68], [4.0, 6]]);
});

test("the clips of a montage's lines come from its voiced take's timings next to the voice; another voice or none tells nothing", async () => {
  const workDir = tmp();
  try {
    const lines = await fakeMontage(workDir, { clips: true });
    const voice = path.join(workDir, "public", "voice.mp3");
    assert.deepEqual(clipsOf(workDir, voice, lines), FAKE_CLIPS);
    assert.deepEqual(clipsOf(workDir, voice, lines.map(({ index: _index, ...l }) => l)), FAKE_CLIPS, "старые реплики без индекса — по клипу, в котором их окно");
    assert.deepEqual(clipsOf(workDir, voice, [{ ...lines[0], start: 0.5 }]), [null], "клип, не вмещающий окно, не её");
    const take = path.join(workDir, "voice", "0123456789abcdef.mp3");
    const bytes = fs.readFileSync(take);
    bytes[bytes.length - 1] ^= 1;
    fs.writeFileSync(take, bytes);
    assert.deepEqual(clipsOf(workDir, voice, lines), [null, null, null], "голос не из этой озвучки");
    fs.rmSync(path.join(workDir, "voice"), { recursive: true });
    assert.deepEqual(clipsOf(workDir, voice, lines), [null, null, null]);
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
});

test("two dubbed lines in a row meet halfway; a take that misses its line or has no speech there fails with its number", async () => {
  const lines = [
    { start: 1.0, end: 2.0 },
    { start: 2.4, end: 3.4 },
  ];
  // the first synthesized line dies out into the gap, past the halfway point
  const base = sound(5, [1.0, 2.0, 500, 0.2], [2.0, 2.25, 500, 0.05], [2.4, 3.4, 500, 0.2]);
  // his first take also caught him starting the second line: it stays out
  const takeA: DubTakeAudio = { slot: 0, index: 0, videoStart: 0, window: [1.0, 2.0], audio: sound(5, [1.1, 1.9, 220, 0.2], [2.5, 3.3, 900, 0.2]) };
  const takeB: DubTakeAudio = { slot: 1, index: 2, videoStart: 0, window: [2.4, 3.4], audio: sound(5, [2.5, 3.3, 220, 0.2]) };
  const { parts, track } = await buildDubVoice(base, lines, [takeA, takeB], null);
  assert.deepEqual(parts.map((p) => [p.from, p.to]), [[N(0.75), N(2.2)], [N(2.2), N(4.0)]], "его записи встречаются посередине");
  assert.ok(peak(track.subarray(N(2.0), N(2.45))) < 1e-9, "промежуток чистый: хвост синтезированной реплики заглушён весь");
  for (let n = N(2.6); n < N(3.2); n++) if (track[n] !== takeB.audio[n]) assert.fail(`на ${n / RATE} с слышно не только вторую запись`);
  await assert.rejects(buildDubVoice(base, lines, [{ ...takeB, videoStart: 6 }], null), /Запись реплики 3 не попадает на её место/);
  await assert.rejects(buildDubVoice(base, lines, [{ ...takeB, audio: sound(5, [0.2, 0.9, 220, 0.2]) }], null), /В записи реплики 3 не слышно речи там, где идёт реплика/);
});

test("all his parts get one gain to his loudness: a one-word reply is levelled like a long line, alone too, and peaks stay under -1 dBFS", async () => {
  const lines = [
    { start: 1.0, end: 2.5 },
    { start: 2.9, end: 3.2 },
    { start: 3.5, end: 3.7 },
  ];
  const base = new Float32Array(N(5));
  // the same quiet mic for both: a 1.5 s line and a 0.2 s reply
  const long: DubTakeAudio = { slot: 0, index: 0, videoStart: 0, window: [1.0, 2.5], audio: sound(5, [1.0, 2.5, 220, 0.03]) };
  const short: DubTakeAudio = { slot: 2, index: 2, videoStart: 0, window: [3.5, 3.7], audio: sound(5, [3.5, 3.7, 220, 0.03]) };
  const both = await buildDubVoice(base, lines, [long, short], -18);
  assert.ok(both.gainDb > 10, `тихие записи подняты (${both.gainDb} дБ)`);
  const levels = await Promise.all([[1.05, 2.45], [3.52, 3.68]].map(([a, b]) => wordsLoudness(both.track.subarray(N(a), N(b)))));
  for (const level of levels) assert.ok(Math.abs(level - -18) < 1.5, `громкость владельца: ${levels.map((l) => l.toFixed(1)).join(" и ")}`);

  const alone = await buildDubVoice(base, lines, [short], -18);
  assert.ok(Math.abs(alone.gainDb - both.gainDb) < 1, `короткая реплика одна тоже выровнена (${alone.gainDb} против ${both.gainDb} дБ)`);

  const loud: DubTakeAudio = { ...long, audio: sound(5, [1.0, 2.5, 220, 0.5]) };
  const pushed = await buildDubVoice(base, lines, [loud], -3);
  assert.ok(pushed.gainDb > 3);
  assert.ok(peak(pushed.track) <= CEILING + 1e-6, `пики не выше -1 дБFS (${peak(pushed.track)})`);

  const x = new Float32Array(N(1)).fill(0.1);
  x[N(0.5)] = 2;
  limit(x);
  assert.ok(peak(x) <= CEILING + 1e-6);
  assert.equal(x[N(0.2)], Math.fround(0.1), "вдали от пика ограничитель ничего не трогает");
  assert.equal(x[N(0.8)], Math.fround(0.1));
});

test("line windows: the script index goes with every voiced line; older montages are matched by speaker and words", async () => {
  const script = {
    title: "Т",
    lines: [
      { who: "me", text: "[curious] Что такое сид-фраза?" },
      { who: "claude", text: "[sighs]" },
      { who: "claude", text: "Двенадцать слов. Ещё вопросы?" },
      { who: "me", text: "Нет!" },
    ],
  };
  const line = (who: string, text: string, start: number, index?: number): VoicedLine => ({ who, text, start, end: start + 1, words: [], mouth: [], ...(index === undefined ? {} : { index }) });
  const indexed = [line("me", "Что такое сид-фраза?", 0.2, 0), line("claude", "Двенадцать слов. Ещё вопросы?", 1.5, 2), line("me", "Нет!", 3, 3)];
  assert.deepEqual(lineWindows(indexed, null), [
    { index: 0, who: "me", start: 0.2, end: 1.2 },
    { index: 2, who: "claude", start: 1.5, end: 2.5 },
    { index: 3, who: "me", start: 3, end: 4 },
  ]);
  const old = indexed.map(({ index: _index, ...l }) => l);
  assert.deepEqual(scriptIndexes(old, script), [0, 2, 3], "по словам, без тегов, с ё как е");
  assert.deepEqual(scriptIndexes([{ ...old[0], text: "Что-то другое" }, old[1], old[2]], script), [0, 2, 3], "по порядку, когда говорящие совпали");
  assert.equal(scriptIndexes([old[1], old[0], old[2]], script), null, "не сопоставилось — окон нет");
  assert.equal(scriptIndexes(old, null), null);

  // the voicing itself: a line of tags only is not in the track, and the indexes skip it
  const synth = path.join(tmp(), "synth.mp3");
  await run("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=300:duration=0.6:sample_rate=44100", "-c:a", "libmp3lame", synth]);
  const stub = stubFetch(async (_url, init) => {
    const chars = [...(JSON.parse(String(init.body)) as { text: string }).text];
    const alignment = { characters: chars, character_start_times_seconds: chars.map((_, i) => i * 0.02), character_end_times_seconds: chars.map((_, i) => (i + 1) * 0.02) };
    return Response.json({ audio_base64: fs.readFileSync(synth).toString("base64"), alignment });
  });
  const dir = tmp();
  try {
    const voiced = await voiceScript(script, cast, dir);
    assert.deepEqual(voiced.lines.map((l) => [l.index, l.who]), [[0, "me"], [2, "claude"], [3, "me"]]);
  } finally {
    stub.restore();
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(path.dirname(synth), { recursive: true, force: true });
  }
});

const sha = (n: number) => createHash("sha256").update(String(n)).digest("hex");

test("dub: the same scene is rendered again with his takes and lips; Claude's lines and the montage itself stay as they were", async () => {
  const workDir = tmp();
  const script = { title: "Сид", lines: [{ who: "me", text: "Что такое сид-фраза?" }, { who: "claude", text: "Двенадцать слов." }, { who: "me", text: "[laughs]" }, { who: "me", text: "[sighs] И всё?" }] };
  const stub = stubFetch(async (url, init) => {
    assert.equal(url, "https://api.elevenlabs.io/v1/forced-alignment");
    return Response.json(aligned(String((init.body as FormData).get("text")), 0.3, 0.8));
  });
  try {
    const base = await fakeMontage(workDir);
    const before = ["input.json", "final.mp4", "public/voice.mp3", "Scene.tsx"].map((f) => fs.readFileSync(path.join(workDir, f)));
    // two takes recorded over the video from 2 s before each line, at a quiet mic
    const takes = [
      { index: 0, file: path.join(workDir, "take0.flac"), videoStart: -1.0, audio: sound(4, [2.1, 2.9, 220, 0.03]) },
      { index: 3, file: path.join(workDir, "take3.flac"), videoStart: 2.0, audio: sound(4, [2.2, 2.8, 220, 0.03]) },
    ];
    for (const t of takes) await encodeFlac(t.audio, t.file);
    let downloads = 0;
    const request: DubRequest = {
      videoDuration: 6.2,
      videoScript: script,
      takes: [
        { index: 0, text: script.lines[0].text, sha256: sha(1), videoStart: -1.0, lineStart: 1.0, lineEnd: 2.0 },
        { index: 3, text: script.lines[3].text, sha256: sha(3), videoStart: 2.0, lineStart: 4.0, lineEnd: 5.0 },
      ],
      download: async () => {
        downloads++;
        return takes.map((t): Recording => ({ index: t.index, file: t.file, sha256: sha(t.index) }));
      },
    };
    const renders: { code: string; input: Record<string, unknown>; publicDir: string; out: string }[] = [];
    const render = async (code: string, input: Record<string, unknown>, publicDir: string, out: string, _name: string, onProgress: (f: number) => void) => {
      renders.push({ code, input, publicDir, out });
      onProgress(0.5);
      fs.writeFileSync(out, "видео");
    };
    const steps: string[] = [];
    const result = await makeDub({ id: "p1", topic: "сид", script, scriptVersion: 2 }, workDir, hooksFor(steps), request, { cast, render });

    assert.equal(downloads, 1);
    assert.equal(result.video, path.join(workDir, DUB_DIR, "final.mp4"));
    assert.equal(result.duration, 6.2);
    // the montage's windows: the page records into the same places next time, and the site keeps the takes valid
    assert.deepEqual(result.lines, [
      { index: 0, who: "me", start: 1, end: 2 },
      { index: 1, who: "claude", start: 2.5, end: 3.5 },
      { index: 3, who: "me", start: 4, end: 5 },
    ]);
    assert.equal(result.linesVersion, undefined, "без таймингов озвучки рядом с голосом окна по буквам, как раньше");
    assert.ok(["Собираю звук", "Разметка губ: 1 из 2", "Разметка губ: 2 из 2", "Рендер 3D", "Рендер 3D: 50%"].every((s) => steps.includes(s)), steps.join(" | "));

    const [{ code, input, publicDir }] = renders;
    assert.equal(code, before[3].toString("utf8"), "та же сцена");
    assert.equal(publicDir, path.join(workDir, DUB_DIR, "public"));
    assert.equal(fs.readFileSync(path.join(publicDir, "fonts", "font.txt"), "utf8"), "шрифт");
    const lines = input.lines as VoicedLine[];
    assert.deepEqual(lines[1], base[1], "реплика Клода не тронута");
    assert.equal(input.voice, "voice.mp3");
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(workDir, DUB_DIR, "input.json"), "utf8")), input);
    // his words where he said them: the part starts 0.25 s before the window, the aligner put the text 0.3 s into it
    assert.deepEqual(lines[0].words.map((w) => w.text), ["Что", "такое", "сид-фраза?"]);
    assert.ok(Math.abs(lines[0].words[0].start - (0.75 + 0.3)) < 0.01, `первое слово на ${lines[0].words[0].start}`);
    assert.deepEqual(lines[2].words.map((w) => w.text), ["И", "всё?"], "теги не попадают в слова");
    assert.ok(Math.abs(lines[2].words[0].start - (3.75 + 0.3)) < 0.01);
    assert.deepEqual([lines[0].index, lines[2].index], [0, 3]);
    assert.ok(lines[0].mouth.length > 3 && lines[0].mouth.every(([t]) => t >= 0.75 && t <= 2.5));
    assert.equal(stub.calls.length, 2);
    assert.equal(String((stub.calls[1].init.body as FormData).get("text")), "И всё?");

    // the voice: his takes at the owner's loudness where his lines were, Claude's line as it was
    const dubbed = await decodeMono(path.join(publicDir, "voice.mp3"));
    const original = await decodeMono(path.join(workDir, "public", "voice.mp3"));
    const level = await wordsLoudness(dubbed.subarray(N(1.15), N(1.85)));
    assert.ok(Math.abs(level - -18) < 1.5, `его реплика на -18 LUFS (${level})`);
    const claude = [dubbed.subarray(N(2.6), N(3.4)), original.subarray(N(2.6), N(3.4))].map(rmsDb);
    assert.ok(Math.abs(claude[0] - claude[1]) < 0.3, `Клод как был: ${claude.join(" и ")}`);
    assert.ok(rmsDb(dubbed.subarray(N(0.97), N(1.05))) < -50, "синтезированный голос владельца заглушён до его слов");

    // the montage is untouched: the next dub starts from it again
    ["input.json", "final.mp4", "public/voice.mp3", "Scene.tsx"].forEach((f, i) => assert.deepEqual(fs.readFileSync(path.join(workDir, f)), before[i], f));
    await makeDub({ id: "p1", topic: "сид", script, scriptVersion: 2 }, workDir, hooksFor(), request, { cast, render });
    assert.equal(stub.calls.length, 2, "разметка губ из кеша");
    assert.deepEqual(renders[1].input, renders[0].input);
  } finally {
    stub.restore();
    fs.rmSync(workDir, { recursive: true, force: true });
  }
});

test("dub without the montage of this very video fails before downloading anything; findLineWindows backfills only a matching one", async () => {
  const workDir = tmp();
  const script = { title: "Сид", lines: [{ who: "me", text: "Что такое сид-фраза?" }, { who: "claude", text: "Двенадцать слов." }, { who: "me", text: "Ну." }, { who: "me", text: "И всё?" }] };
  let downloads = 0;
  const request: DubRequest = {
    videoDuration: 6.2,
    videoScript: script,
    takes: [{ index: 0, text: "Что такое сид-фраза?", sha256: sha(1), videoStart: 0, lineStart: 1, lineEnd: 2 }],
    download: async () => {
      downloads++;
      return [];
    },
  };
  const render = async () => assert.fail("рендер не должен начаться");
  const dub = (req = request) => makeDub({ id: "p1", topic: "т", script, scriptVersion: 1 }, workDir, hooksFor(), req, { cast, render });
  try {
    await assert.rejects(dub(), (error: Error) => error.message === NO_SOURCES);
    await fakeMontage(workDir, { indexed: false });
    await assert.rejects(dub({ ...request, videoDuration: 9 }), (error: Error) => error.message === NO_SOURCES, "другой длины");
    const logs: string[] = [];
    assert.equal(await findLineWindows(workDir, { duration: 9 }, script, (m) => logs.push(m)), null);
    assert.match(logs[0], /final\.mp4 длиной|монтаж в папке/);

    // the older montage's lines have no index: matched to the script by words
    assert.deepEqual(await findLineWindows(workDir, { duration: 6.25 }, script), {
      videoDuration: 6.2,
      lines: [
        { index: 0, who: "me", start: 1, end: 2 },
        { index: 1, who: "claude", start: 2.5, end: 3.5 },
        { index: 3, who: "me", start: 4, end: 5 },
      ],
    });

    // a folder marked with a site video is that video's only; "pending" or a half-written mark is a montage the site never took
    const at = "2026-10-22T10:00:00.000Z";
    const other = "2026-10-22T11:00:00.000Z";
    const windows = await findLineWindows(workDir, { duration: 6.2, at }, script);
    assert.ok(windows, "без метки — по длине, как раньше");
    writeMark(workDir, { state: "shown", videoAt: at, jobId: "j1" });
    assert.deepEqual(await findLineWindows(workDir, { duration: 6.2, at }, script), windows);
    assert.deepEqual(await findLineWindows(workDir, { duration: 6.2 }, script), windows, "время ролика неизвестно — по длине");
    logs.length = 0;
    assert.equal(await findLineWindows(workDir, { duration: 6.2, at: other }, script, (m) => logs.push(m)), null);
    assert.equal(logs[0], `Окна реплик ролика не найдены: монтаж в папке — ролик от ${at}, а на сайте ролик от ${other}`);
    await assert.rejects(dub({ ...request, videoAt: other }), (error: Error) => error.message === NO_SOURCES, "ролик другого монтажа той же длины");
    // re-rendered here and put on the site by hand: a new time there, but the site's file is this very final.mp4
    const size = fs.statSync(path.join(workDir, "final.mp4")).size;
    assert.deepEqual(await findLineWindows(workDir, { duration: 6.2, at: other, bytes: async () => size }, script), windows, "тот же файл на сайте — этот монтаж");
    assert.equal(await findLineWindows(workDir, { duration: 6.2, at: other, bytes: async () => size + 1 }, script), null, "другой файл той же длины — не этот");
    writeMark(workDir, { state: "pending" });
    await assert.rejects(dub({ ...request, videoAt: at }), (error: Error) => error.message === NO_SOURCES, "монтаж, не дошедший до сайта");
    fs.writeFileSync(path.join(workDir, MARK_FILE), "{");
    assert.equal(await findLineWindows(workDir, { duration: 6.2, at }, script), null, "недописанная метка");
    writeMark(workDir, null);

    // a montage that failed after writing a new input.json left the old final.mp4: not its sources
    const later = new Date(Date.now() + 60_000);
    fs.utimesSync(path.join(workDir, "input.json"), later, later);
    await assert.rejects(dub(), (error: Error) => error.message === NO_SOURCES);
    assert.equal(await findLineWindows(workDir, { duration: 6.2 }, script), null);
    assert.equal(downloads, 0, "без исходников записи не скачиваются");
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
});

test("an exact window: his synthesized line goes from 0.02 s before to 0.05 s after it, his take from 0.15 s before to 0.3 s after and over all his speech", async () => {
  // Claude 0.5–1.5; the owner's clip 1.7–3.25 starts with a click, his synthesized gasp and words sound 2.03–3.17;
  // Claude again from 3.63. Every window is its sound with 0.03 s of air (soundLines.ts)
  const lines: DubLine[] = [
    { start: 0.47, end: 1.53, clip: [0.4, 1.6], exact: true },
    { start: 2.0, end: 3.2, clip: [1.7, 3.25], exact: true },
    { start: 3.6, end: 4.6, clip: [3.55, 4.7], exact: true },
  ];
  const base = sound(6, [0.5, 1.5, 300, 0.2], [1.7, 1.705, 900, 0.3], [2.03, 3.17, 500, 0.2], [3.63, 4.57, 300, 0.2]);
  // recorded from the video's start: his gasp 1.88–1.97, his words and their tail to 3.45, then Claude's next line
  // heard by his mic from 3.63
  const audio = sound(6, [1.88, 1.97, 700, 0.05], [2.05, 3.1, 220, 0.2], [3.1, 3.45, 220, 0.02], [3.63, 4.57, 300, 0.05]);
  const take: DubTakeAudio = { slot: 1, index: 2, videoStart: 0, window: [2.0, 3.2], audio };
  const fade = N(0.015);
  const same = (track: Float32Array, voice: Float32Array, from: number, to: number, what: string) => {
    for (let n = from; n < to; n++) if (track[n] !== voice[n]) assert.fail(`${what}: сэмпл на ${(n / RATE).toFixed(3)} с не тот`);
  };

  const { track, parts } = await buildDubVoice(base, lines, [take], null);
  // 0.15 s before the window would leave 0.03 s before his gasp, 0.3 s after it 0.05 s after his tail: his speech
  // gets its 0.08 s of air instead
  assert.deepEqual([parts[0].from, parts[0].to], [N(1.8), N(3.53)], "запись — его речь целиком с воздухом, не меньше окна с 0.15 с до и 0.3 с после");
  same(track, audio, N(1.8) + fade, N(3.53) - fade, "его вдох, слова и хвост целиком, синтезированного голоса нет");
  same(track, base, 0, N(1.685), "Клод до него как был");
  same(track, base, N(3.53), track.length, "Клод после него как был, его микрофон Клода не добавил");
  assert.ok(peak(track.subarray(N(1.7), N(1.8))) < 1e-9, "щелчок на стыке его клипа заглушён вместе с клипом");

  // without its clip's bounds exactly the window's surroundings go: 0.02 s before, 0.05 s after
  const bare = await buildDubVoice(base, lines.map((l) => ({ ...l, clip: null })), [take], null);
  same(bare.track, base, 0, N(1.8), "до его записи голос монтажа не тронут");
  for (let n = N(1.995); n < N(3.235); n++) if (bare.track[n] !== audio[n]) assert.fail(`на ${(n / RATE).toFixed(3)} с слышен синтезированный голос`);
});

test("dub over windows measured from the sound: his synthesized clip goes whole, breath and all, his take around its window and all of his speech", async () => {
  const workDir = tmp();
  const script = { title: "Сид", lines: [{ who: "me", text: "Что такое сид-фраза?" }, { who: "claude", text: "Двенадцать слов." }, { who: "me", text: "[laughs]" }, { who: "me", text: "И всё?" }] };
  const stub = stubFetch(async (_url, init) => Response.json(aligned(String((init.body as FormData).get("text")), 0.3, 0.8)));
  try {
    // the owner's first clip has a breath at 0.62 before his words at 1.0: his window starts at the breath. He breathes
    // in at 0.5 himself; he says the last line late, on to 5.58 s, past the 0.3 s after his window
    await fakeMontage(workDir, { clips: true });
    const takes = [
      { index: 0, file: path.join(workDir, "take0.flac"), videoStart: -1.0, audio: sound(4, [1.5, 1.58, 700, 0.05], [2.1, 2.9, 220, 0.1]) },
      { index: 3, file: path.join(workDir, "take3.flac"), videoStart: 2.0, audio: sound(4.2, [2.3, 3.58, 220, 0.1]) },
    ];
    for (const t of takes) await encodeFlac(t.audio, t.file);
    const request: DubRequest = {
      videoDuration: 6.2,
      videoScript: script,
      linesVersion: SOUND_LINES,
      takes: [
        { index: 0, text: script.lines[0].text, sha256: sha(1), videoStart: -1.0, lineStart: 1.0, lineEnd: 2.0 },
        { index: 3, text: script.lines[3].text, sha256: sha(3), videoStart: 2.0, lineStart: 4.0, lineEnd: 5.0 },
      ],
      download: async () => takes.map((t): Recording => ({ index: t.index, file: t.file, sha256: sha(t.index) })),
    };
    const render = async (_code: string, _input: Record<string, unknown>, _publicDir: string, out: string) => fs.writeFileSync(out, "видео");
    const logs: string[] = [];
    const result = await makeDub({ id: "p1", topic: "сид", script, scriptVersion: 2 }, workDir, hooksFor([], logs), request, { cast, render });

    // the windows are the sound of each clip, the same that the montage and the voice job's backfill report
    assert.equal(result.linesVersion, SOUND_LINES);
    const expected = [
      [0, "me", 0.59, 2.03],
      [1, "claude", 2.47, 3.53],
      [3, "me", 3.97, 5.03],
    ] as const;
    assert.deepEqual(result.lines?.map((l) => [l.index, l.who]), expected.map(([index, who]) => [index, who]));
    result.lines!.forEach((l, k) => assert.ok(Math.abs(l.start - expected[k][2]) <= 0.015 && Math.abs(l.end - expected[k][3]) <= 0.015, `окно ${l.index}: ${l.start}–${l.end}`));
    assert.deepEqual(await findLineWindows(workDir, { duration: 6.2 }, script), { videoDuration: 6.2, lines: result.lines, version: SOUND_LINES });

    const dubbed = await decodeMono(path.join(workDir, DUB_DIR, "public", "voice.mp3"));
    const level = (from: number, to: number) => rmsDb(dubbed.subarray(N(from), N(to)));
    assert.ok(dubbed.length >= N(6.2), `голос длиной с ролик (${(dubbed.length / RATE).toFixed(2)} с)`);
    assert.ok(level(0.6, 0.74) < -60, `вдох синтезированной реплики заглушён вместе с ней (${level(0.6, 0.74)})`);
    assert.ok(level(0.5, 0.57) > -40, `его вдох перед окном на месте (${level(0.5, 0.57)})`);
    assert.ok(level(5.15, 5.29) > -30, `его слова до 0.3 с после окна на месте (${level(5.15, 5.29)})`);
    assert.ok(level(5.4, 5.56) > -30, `и дальше, до последнего слова — реплика целиком (${level(5.4, 5.56)})`);
    assert.ok(level(5.7, 6.1) < -60, `после его речи с воздухом ничего (${level(5.7, 6.1)})`);
    assert.ok(logs.some((m) => m.startsWith("Запись реплики 4: речь шире окна")), logs.join(" | "));

    // a video with windows from the letters keeps them: its takes stay valid, «Уточнить разметку» measures them anew.
    // The placement still goes by the sound: the synthesized breath before his words is gone all the same
    const letters = await makeDub({ id: "p1", topic: "сид", script, scriptVersion: 2 }, workDir, hooksFor(), { ...request, linesVersion: 1 }, { cast, render });
    assert.deepEqual(letters.lines, [
      { index: 0, who: "me", start: 1, end: 2 },
      { index: 1, who: "claude", start: 2.5, end: 3.5 },
      { index: 3, who: "me", start: 4, end: 5 },
    ]);
    assert.equal(letters.linesVersion, undefined);
    assert.ok(rmsDb((await decodeMono(path.join(workDir, DUB_DIR, "public", "voice.mp3"))).subarray(N(0.6), N(0.74))) < -60, "вдох синтезированной реплики заглушён");
    assert.deepEqual((await makeDub({ id: "p1", topic: "сид", script, scriptVersion: 2 }, workDir, hooksFor(), { ...request, linesVersion: undefined }, { cast, render })).lines, letters.lines, "без версии — по буквам");
    // windows of a kind this dub cannot tell: none go, and the site keeps its own
    const newer = await makeDub({ id: "p1", topic: "сид", script, scriptVersion: 2 }, workDir, hooksFor(), { ...request, linesVersion: SOUND_LINES + 1 }, { cast, render });
    assert.equal(newer.lines, undefined);
    fs.rmSync(path.join(workDir, "voice"), { recursive: true });
    const lost = await makeDub({ id: "p1", topic: "сид", script, scriptVersion: 2 }, workDir, hooksFor([], logs), request, { cast, render });
    assert.deepEqual([lost.lines, lost.linesVersion], [undefined, undefined], "окна по звуку не измерить заново — на сайте останутся прежние");
  } finally {
    stub.restore();
    fs.rmSync(workDir, { recursive: true, force: true });
  }
});

test("his whole speech goes in: a late start, a slower reading or an early one is kept up to the neighbours, and the log says so", async () => {
  // Claude 0.5–1.5; the owner's window 2.0–3.2; Claude again from 4.2. The page records [start − 0.5, end + 0.4]
  const lines: DubLine[] = [
    { start: 0.47, end: 1.53, clip: [0.4, 1.6], exact: true },
    { start: 2.0, end: 3.2, clip: [1.85, 3.3], exact: true },
    { start: 4.2, end: 5.0, clip: [4.1, 5.1], exact: true },
  ];
  const base = sound(6, [0.5, 1.5, 300, 0.2], [2.03, 3.17, 500, 0.2], [4.23, 4.97, 300, 0.2]);
  // he starts 0.2 s after the cue and reads slower: his last word ends at 3.55, past 0.3 s after the window
  const late: DubTakeAudio = { slot: 1, index: 2, videoStart: 1.5, window: [2.0, 3.2], audio: sound(2.1, [0.7, 2.05, 220, 0.2]) };
  const logs: string[] = [];
  const slow = await buildDubVoice(base, lines, [late], null, (m) => logs.push(m));
  assert.deepEqual([slow.parts[0].from, slow.parts[0].to], [N(1.85), N(3.6)], "до конца записи: последнее слово целиком, с воздухом");
  assert.ok(rmsDb(slow.track.subarray(N(3.5), N(3.55))) > -25, `конец последнего слова на месте (${rmsDb(slow.track.subarray(N(3.5), N(3.55)))})`);
  assert.deepEqual(logs, ["Запись реплики 3: речь шире окна, взята целиком — 1.85–3.60 с"]);

  // he starts 0.3 s early: from 1.70, before the 0.15 s ahead of the window, but after Claude's line
  const early = await buildDubVoice(base, lines, [{ ...late, audio: sound(2.1, [0.2, 1.6, 220, 0.2]) }], null);
  assert.deepEqual([early.parts[0].from, early.parts[0].to], [N(1.62), N(3.5)]);
  assert.ok(rmsDb(early.track.subarray(N(1.7), N(1.85))) > -25, "его первое слово целиком");
  for (let n = 0; n < N(1.62); n++) if (early.track[n] !== base[n]) assert.fail(`голос Клода изменён на ${n / RATE} с`);
});

test("speech that would run into a neighbour, past the video or was cut by the recorder fails the dub with what to re-record", async () => {
  const lines: DubLine[] = [
    { start: 0.47, end: 1.53, clip: [0.4, 1.6], exact: true },
    { start: 2.0, end: 3.2, clip: [1.85, 3.3], exact: true },
    { start: 3.6, end: 4.6, clip: [3.5, 4.7], exact: true },
  ];
  const base = sound(6, [0.5, 1.5, 300, 0.2], [2.03, 3.17, 500, 0.2], [3.63, 4.57, 300, 0.2]);
  const take = (slot: number, from: number, to: number, videoStart: number, seconds: number): DubTakeAudio => ({
    slot,
    index: slot * 2,
    videoStart,
    window: [lines[slot].start, lines[slot].end],
    audio: sound(seconds, [from - videoStart, to - videoStart, 220, 0.2]),
  });
  const fails = (t: DubTakeAudio, message: string) =>
    assert.rejects(buildDubVoice(base, lines, [t], null), (error: Error) => {
      assert.equal(error.message, `Запись не встанет в ролик целиком — перезапишите: ${message}`);
      return true;
    });
  await fails(take(1, 2.1, 3.8, 1.5, 2.5), "реплика 3 заходит на следующую на 0.20 с — скажите её чуть быстрее");
  await fails(take(1, 1.4, 3.0, 1.0, 2.5), "реплика 3 начинается на 0.13 с раньше, чем кончается предыдущая, — начните чуть позже");
  await fails(take(1, 2.1, 3.4, 1.5, 1.9), "в записи реплики 3 оборван конец: запись остановилась на словах");
  await fails(take(1, 1.9, 3.0, 1.9, 1.6), "в записи реплики 3 оборвано начало: запись началась, когда вы уже говорили");
  await fails(take(2, 3.7, 6.2, 3.1, 3.2), "реплика 5 выходит за конец ролика на 0.20 с — скажите её чуть быстрее");
  // within the neighbour's air, before its sound, is no cut worth a new take
  const close = await buildDubVoice(base, lines, [take(1, 2.1, 3.62, 1.5, 2.5)], null);
  assert.equal(close.parts[0].to, N(3.6));
});

test("a line without words is a clip of its own: his take never goes over it", async () => {
  // the owner's clip 0.5–2.0 sounds to its very end; Claude's «[laughs]» is a clip of its own, 2.25–2.8, which no
  // line's window marks; Claude's words from 3.05
  const base = sound(5, [0.55, 2.0, 220, 0.2], [2.25, 2.8, 700, 0.1], [3.05, 4.0, 300, 0.2]);
  const own: Span[] = [
    [0.5, 2.0],
    [3.0, 4.05],
  ];
  const clips: Span[] = [own[0], [2.25, 2.8], own[1]];
  const sounds = lineSounds(base, own, clips, own);
  const stray = strayWindows(base, own, clips);
  assert.equal(stray.length, 1);
  const lines = own.map(([c0, c1], k): DubLine => ({ start: sounds[k][0], end: sounds[k][1], clip: [c0, c1], exact: true }));
  // his words to 2.0, and the room his mic hears all along
  const take: DubTakeAudio = { slot: 0, index: 0, videoStart: 0, window: sounds[0], audio: sound(5, [0, 5, 50, 0.003], [0.6, 2.0, 220, 0.2]) };
  const blind = await buildDubVoice(base, lines, [take], null);
  assert.ok(blind.parts[0].to > N(2.25), "без окна смеха запись заходит на него");
  const { track, parts } = await buildDubVoice(base, [...lines, ...stray.map(([start, end]): DubLine => ({ start, end }))], [take], null);
  assert.ok(parts[0].to <= N(stray[0][0]) && stray[0][0] < 2.25, `запись кончается до смеха Клода (${parts[0].to / RATE} с)`);
  for (let n = parts[0].to; n < track.length; n++) if (track[n] !== base[n]) assert.fail(`смех и реплика Клода изменены на ${(n / RATE).toFixed(3)} с`);
});

test("dub: the clip of a line without words is its neighbour — a take recorded over it fails before the render, a good one leaves it as it was", async () => {
  const workDir = tmp();
  const script = { title: "Сид", lines: [{ who: "me", text: "Что такое сид-фраза?" }, { who: "claude", text: "Двенадцать слов." }, { who: "me", text: "[laughs]" }, { who: "me", text: "И всё?" }] };
  const stub = stubFetch(async (_url, init) => Response.json(aligned(String((init.body as FormData).get("text")), 0.3, 0.6)));
  try {
    await fakeMontage(workDir, { clips: true, laugh: true });
    const file = path.join(workDir, "take3.flac");
    // his laugh 3.65–3.85 is synthesized and stays; his window 3.97–5.03 is recorded from 3.47
    const request = (audio: Float32Array): DubRequest => ({
      videoDuration: 6.2,
      videoScript: script,
      linesVersion: SOUND_LINES,
      takes: [{ index: 3, text: script.lines[3].text, sha256: sha(3), videoStart: 3.47, lineStart: 3.97, lineEnd: 5.03 }],
      download: async () => {
        await encodeFlac(audio, file);
        return [{ index: 3, file, sha256: sha(3) }];
      },
    });
    let renders = 0;
    const render = async (_code: string, _input: Record<string, unknown>, _publicDir: string, out: string) => {
      renders++;
      fs.writeFileSync(out, "видео");
    };
    await assert.rejects(
      makeDub({ id: "p1", topic: "сид", script, scriptVersion: 2 }, workDir, hooksFor(), request(sound(1.9, [0.28, 1.43, 220, 0.1])), { cast, render }),
      /реплика 4 начинается на 0\.13 с раньше, чем кончается предыдущая/,
    );
    assert.equal(renders, 0, "до рендера дело не дошло");
    await makeDub({ id: "p1", topic: "сид", script, scriptVersion: 2 }, workDir, hooksFor(), request(sound(1.9, [0.53, 1.43, 220, 0.1])), { cast, render });
    assert.equal(renders, 1);
    const [dubbed, original] = await Promise.all([decodeMono(path.join(workDir, DUB_DIR, "public", "voice.mp3")), decodeMono(path.join(workDir, "public", "voice.mp3"))]);
    const laugh = [dubbed, original].map((x) => rmsDb(x.subarray(N(3.66), N(3.84))));
    assert.ok(Math.abs(laugh[0] - laugh[1]) < 0.3, `смех как был: ${laugh.join(" и ")}`);
    assert.ok(rmsDb(dubbed.subarray(N(3.9), N(3.97))) < -50, `между смехом и его словами тихо (${rmsDb(dubbed.subarray(N(3.9), N(3.97)))})`);
  } finally {
    stub.restore();
    fs.rmSync(workDir, { recursive: true, force: true });
  }
});

test("the keep range is the protocol's: the page plays his take over the same range the dub keeps", () => {
  assert.deepEqual([EXACT_KEEP_BEFORE, EXACT_KEEP_AFTER, SPEECH_AIR], [DUB_KEEP_BEFORE, DUB_KEEP_AFTER, DUB_SPEECH_AIR]);
});

test("lineSpeech: his line is the speech at its place with what is near it; other lines' places never join", () => {
  const runs: Span[] = [
    [0.2, 0.4],
    [1.0, 1.3],
    [1.5, 2.2],
    [2.45, 2.9],
    [3.5, 3.9],
  ];
  assert.deepEqual(lineSpeech(runs, 1.4, 2.0, 0.5, 3.4), [1.0, 2.9], "паузы до 0.3 с — та же реплика");
  assert.deepEqual(lineSpeech(runs, 1.4, 2.0, 0.5, 2.4), [1.0, 2.2], "за соседом — не его");
  assert.deepEqual(lineSpeech(runs, 3.0, 3.2, 2.95, 5), [3.5, 3.9], "всё сказано позже окна — ближайшая");
  assert.deepEqual(lineSpeech(runs, 1.4, 2.0, 1.1, 2.4), [1.0, 2.2], "заходит за границу — граница не режет то, что он сказал");
  assert.equal(lineSpeech(runs, 4.5, 5, 4.0, 6), null);
});
