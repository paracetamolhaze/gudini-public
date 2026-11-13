import fs from "node:fs";
import path from "node:path";
import { ENGINE_ROOT, type CastFile } from "./cast";
import type { VoicedLine } from "./mouth";
import { ACTOR_PLACES } from "./validate";

const read = (file: string) => fs.readFileSync(path.join(ENGINE_ROOT, "knowledge", file), "utf8");

/** The director's handbook: craft, the kit reference and the worked examples. */
export const directorSystem = () => {
  const dir = path.join(ENGINE_ROOT, "knowledge/examples");
  const examples = fs.existsSync(dir)
    ? fs
        .readdirSync(dir)
        .filter((f) => f.endsWith(".md"))
        .sort()
        .map((f) => fs.readFileSync(path.join(dir, f), "utf8"))
    : [];
  return [read("director.md"), read("kit.md"), ...examples].join("\n\n---\n\n");
};

const fmt = (s: number) => s.toFixed(2);

/** The voiced dialogue as the director sees it: who, when, what — and the silences between lines. */
export const directorTask = (opts: { topic: string; title: string; duration: number; lines: VoicedLine[]; cast: CastFile }) => {
  // the places are the permanent room's; saying them here keeps the Actor lines exact
  const people = Object.entries(opts.cast)
    .map(([id, m]) => {
      const place = ACTOR_PLACES[id];
      return `- ${id} — ${m.name} (${m.kind === "human" ? "человек, владелец канала" : "оранжевый кубик Клод"})${place ? `, его место — at={[${place.join(", ")}]}` : ""}`;
    })
    .join("\n");
  const rows = opts.lines.map((l, i) => {
    const pause = i > 0 ? l.start - opts.lines[i - 1].end : l.start;
    return `${i + 1}. [${fmt(l.start)}–${fmt(l.end)}] ${l.who}: ${l.text}${pause > 0.6 ? `   (перед репликой пауза ${pause.toFixed(1)} с)` : ""}`;
  });
  return [
    `Скетч «${opts.title}». Идея владельца: ${opts.topic.trim()}`,
    `Длительность ролика: ${fmt(opts.duration)} с. Планы покрывают 0–${fmt(opts.duration)} встык.`,
    `Персонажи:\n${people}`,
    `Озвученные реплики (время в секундах по готовой дорожке):\n${rows.join("\n")}`,
    `Напиши src/scene/Scene.tsx.`,
  ].join("\n\n");
};

export const fixTask = (code: string, problems: string[]) =>
  [
    "Проверка нашла в Scene.tsx проблемы:",
    problems.map((p) => `- ${p}`).join("\n"),
    "Исправь их и пришли файл целиком в одном блоке ```tsx.",
    "Текущий файл:",
    "```tsx\n" + code + "\n```",
  ].join("\n\n");

/** How the director answers with edits instead of the whole file: the draft review and the target rounds (dream.ts). */
export const PATCH_FORMAT = [
  "Этот ответ — не файл целиком (правило учебника про ```tsx здесь не действует), а только JSON в одном блоке ```json:",
  '- всё хорошо — {"ok": true};',
  '- есть что поправить — {"edits": [{"before": "точный фрагмент файла", "after": "замена", "reason": "что исправляет"}]}.',
  "Каждая правка ищется в исходном файле: фрагмент before встречается в нём ровно один раз, фрагменты разных правок не пересекаются (одну строку правь одной правкой). Время и планы после правок по-прежнему покрывают весь ролик встык.",
].join("\n");

/**
 * The draft review: stills in time order with their labels, the code, and the format of the answer.
 * `target` — the critic's gaps against the target frames attached after the stills (dream.ts), when there are any.
 */
export const reviewTask = (code: string, labels: string[], target?: string) =>
  [
    "Это черновые кадры твоего монтажа (половина размера), по порядку:",
    labels.map((l, i) => `${i + 1}. ${l}`).join("\n"),
    [
      "Посмотри на каждый кадр как зритель TikTok и найди то, что надо поправить:",
      "- лицо говорящего не видно (профиль, затылок), обрезано или его закрывает предмет, окно или второй персонаж;",
      "- за героем голая стена, а не экран, монитор с чатом или компьютер комнаты;",
      "- в плане не тот персонаж или непонятно, кто говорит;",
      "- значок лежит на голове или лице героя, а не сбоку от неё; значок или предмет залез на субтитр (белая строка в нижней части кадра, на трёх четвертях высоты);",
      "- окно позади пустое по смыслу, нечитаемое, стоит на строке субтитров, обрезано краем кадра или спряталось за героем;",
      "- окно повторяет слово-итог или множитель («x100») вместо фактов истории — это звучит в реплике и видно в субтитрах;",
      "- карточка канала с QR вверху кадра (интеграция, так и задумано) стоит не на разговоре о канале владельца или закрывает голову героя;",
      "- в плане на двоих герой обрезан краем кадра; рука с предметом обрезана краем кадра;",
      "- жест или лицо не совпадают со смыслом реплики;",
      "- пока говорит один, в кадре другой; одна реплика разрезана на несколько коротких планов (владелец: «кадры очень быстро меняются») — правка держит в кадре говорящего, а реакцию слушателя ставит в паузу или на общий план;",
      "- кадр скучный: подряд одинаковые планы (на склейке тот же кадр, только чуть ближе), панчлайн прошёл без реакции на лице.",
    ].join("\n"),
    ...(target ? [target] : []),
    PATCH_FORMAT,
    "Файл:",
    "```tsx\n" + code + "\n```",
  ].join("\n\n");
