import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DreamRun, painterPrompt, readBrief, readCritic, sameGap, styleRefs } from "./dream";
import { reviewTask } from "./prompt";

const moments = [
  { t: 1.0, label: "1.0 с — план medium на me, push (0–2.05)" },
  { t: 3.0, label: "3.0 с — план close на claude, push (2.05–3.91)" },
  { t: 29.3, label: "29.3 с — план medium на claude, push (27.41–31.23)" },
];
const picture = "Medium shot of the voxel man, waist-up, in the left-centre of the frame, filling about 60% of its height, a phone in his right hand.";

test("критик: оценки, порядок отличий и пометки «набор» / «нет в наборе»", () => {
  const answer = [
    "Сравнил пары. Камера в сцене дальше: `kind={\"wide\"}`.",
    "```json",
    JSON.stringify({
      scores: { composition: 1.5, light: 2, materials: 2.5, details: 0.5 },
      gaps: [
        { frame: 1, gap: "В цели герой занимает 60% высоты кадра, в сцене — 35%.", fix: "набор", how: 'kind="medium" вместо wide' },
        { frame: 2, gap: "В цели лицо подсвечено экраном снизу.", fix: "нет в наборе", need: "свет экрана на лице героя" },
        { frame: 1, gap: "В цели телефон экраном к зрителю.", fix: "исправимо набором", how: '<Act do="phone">' },
        { frame: 1, gap: "В цели формы скруглённые.", fix: "набору не хватает", need: "скруглённые формы" },
      ],
    }),
    "```",
  ].join("\n");
  const v = readCritic(answer, 2);
  assert.equal(v.total, 6.5);
  assert.deepEqual(
    v.gaps.map((g) => [g.frame, g.fix]),
    [
      [1, "kit"],
      [2, "missing"],
      [1, "kit"],
      [1, "missing"],
    ],
  );
  assert.equal(v.gaps[0].how, 'kind="medium" вместо wide');
  assert.equal(v.gaps[1].how, "свет экрана на лице героя");
});

test("критик: английские пометки, оценки в границах рубрики, непомеченное отличие выпадает", () => {
  const v = readCritic(
    JSON.stringify({
      scores: { composition: 7, light: -1, materials: "2", details: 1 },
      gaps: [
        { frame: 9, gap: "Герой у левого края.", fix: "kit", how: "Move" },
        { frame: 1, gap: "Нет пометки." },
        { frame: 1, gap: "Странная пометка.", fix: "может быть" },
        { frame: 1, gap: "", fix: "kit" },
        { frame: 1, gap: "Другой материал.", fix: "missing" },
      ],
    }),
    1,
  );
  assert.deepEqual(v.scores, { composition: 3, light: 0, materials: 2, details: 1 });
  assert.equal(v.total, 6);
  assert.equal(v.gaps.length, 2);
  // a pair the answer invented is the first pair: the gap still reaches the director
  assert.equal(v.gaps[0].frame, 1);
  assert.equal(v.gaps[1].fix, "missing");
});

test("критик: совпавший кадр — пустой список; ответ без оценок или без списка — ошибка", () => {
  const same = readCritic('{"scores":{"composition":3,"light":3,"materials":3,"details":1},"gaps":[]}', 1);
  assert.equal(same.total, 10);
  assert.deepEqual(same.gaps, []);
  assert.throws(() => readCritic('{"gaps":[]}', 1), /оценки/);
  assert.throws(() => readCritic('{"scores":{"composition":3,"light":3,"materials":3,"details":1}}', 1), /gaps/);
  assert.throws(() => readCritic("Кадры почти совпали.", 1), /JSON/);
});

test("повтор отличия: та же пара и то же лекарство или те же первые слова", () => {
  const a = { frame: 1, gap: "В цели лицо тревожное: брови домиком, рот приоткрыт. В сцене лицо нейтральное, рот сжат.", fix: "kit" as const, how: '<Face who="me" mood="worried" />' };
  assert.ok(sameGap(a, { ...a, gap: "Лицо всё ещё нейтральное." }));
  assert.ok(sameGap(a, { ...a, how: "", gap: "В цели лицо тревожное: брови  домиком, рот приоткрыт. В сцене лицо нейтральное, брови ровные." }));
  assert.ok(!sameGap(a, { ...a, frame: 2 }));
  assert.ok(!sameGap(a, { frame: 1, gap: "В цели комната тёмная.", fix: "kit", how: '<Light mood="spot" />' }));
  assert.ok(!sameGap({ ...a, how: "" }, { frame: 1, gap: "В цели комната тёмная.", fix: "kit", how: "" }));
});

test("цель: кадр берётся по номеру из списка черновых, лишние и повторы отбрасываются", () => {
  const answer = "```json\n" + JSON.stringify({ frames: [{ shot: 3, why: "разворот", picture }, { shot: 3, why: "повтор", picture }, { shot: 7, why: "нет такого", picture }, { shot: 1, why: "открытие", picture }] }) + "\n```";
  const frames = readBrief(answer, moments, 2);
  assert.deepEqual(
    frames.map((f) => [f.shot, f.t, f.why]),
    [
      [2, 29.3, "разворот"],
      [0, 1.0, "открытие"],
    ],
  );
  assert.equal(readBrief(answer, moments, 1).length, 1);
  assert.throws(() => readBrief('{"frames":[{"shot":2,"picture":"коротко"}]}', moments), /не описан/);
  assert.throws(() => readBrief('{"ok":true}', moments), /frames/);
});

test("художник: без образца стиля цель держит вид набора, с образцом — стиль из последних картинок", () => {
  const kit = painterPrompt(picture, 0);
  assert.match(kit, /Keep the engine's look/);
  assert.match(kit, /voxel man/);
  assert.ok(kit.includes(picture));
  const styled = painterPrompt(picture, 2);
  assert.match(styled, /last 2 attached images are the style reference/);
  assert.doesNotMatch(styled, /Keep the engine's look/);
  assert.ok(styled.includes(picture));
});

test("образец стиля: только картинки папки, первые три по имени", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "style-ref-"));
  try {
    assert.deepEqual(styleRefs(path.join(dir, "нет")), []);
    for (const name of ["README.md", "d.png", "b.jpg", "a.webp", "c.JPEG"]) fs.writeFileSync(path.join(dir, name), "x");
    const refs = styleRefs(dir);
    assert.deepEqual(
      refs.map((r) => r.name),
      ["a.webp", "b.jpg", "c.JPEG"],
    );
    assert.ok(refs[0].dataUrl.startsWith("data:image/webp;base64,"));
    assert.ok(refs[2].dataUrl.startsWith("data:image/jpeg;base64,"));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("черновик: замечания по цели встают перед форматом ответа, без них задание прежнее", () => {
  const plain = reviewTask("CODE", ["1.0 с — план"]);
  const withTarget = reviewTask("CODE", ["1.0 с — план"], "ЗАМЕЧАНИЯ ПО ЦЕЛИ");
  assert.ok(!plain.includes("ЗАМЕЧАНИЯ"));
  assert.ok(withTarget.indexOf("ЗАМЕЧАНИЯ ПО ЦЕЛИ") < withTarget.indexOf('{"ok": true}'));
  assert.equal(withTarget.replace("ЗАМЕЧАНИЯ ПО ЦЕЛИ\n\n", ""), plain);
});

test("сбой шага не роняет монтаж: мост картинок молчит, критик без моста — в журнале причина, наружу ничего", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dream-run-"));
  const env = { ...process.env };
  const log: string[] = [];
  try {
    process.env.CODEX_IMAGE_BRIDGE_URL = "http://127.0.0.1:9";
    process.env.CODEX_BRIDGE_TOKEN = "test";
    delete process.env.CLAUDE_BRIDGE_TOKEN;
    fs.writeFileSync(path.join(dir, "dream-1.jpg"), "старая цель");
    const still = path.join(dir, "still.jpg");
    fs.writeFileSync(still, "jpeg");
    const run = new DreamRun(dir, { stage: () => {}, log: (m) => log.push(m), signal: new AbortController().signal });
    assert.ok(!fs.existsSync(path.join(dir, "dream-1.jpg")), "цель прошлого монтажа убрана");
    run.frames = [{ shot: 0, ...moments[0], why: "", picture }];
    assert.equal(await run.draw([still]), false);
    assert.match(log.join("\n"), /Целевой кадр 1 не нарисован .*монтаж идёт как раньше/);
    run.targets = [{ shot: 0, ...moments[0], why: "", picture, file: still }];
    assert.equal(await run.judge([still], ""), null);
    assert.match(log.join("\n"), /Критик цели, круг 1, не ответил \(Нет CLAUDE_BRIDGE_TOKEN/);
    assert.equal(await run.plan({ topic: "", title: "", lines: [], code: "", moments }), false);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, "dream/report.json"), "utf8")).rounds, []);
  } finally {
    process.env = env;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
