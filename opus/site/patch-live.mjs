// Правки «Опус 5.5» в ОБЩИХ файлах сайта и воркера — как у «Новостей» и «3Д» (news/deploy/site/patch-live.mjs): живые
// версии этих файлов лежат в запущенных образах (там правки других разделов, которых нет в git), поэтому prepare.sh берёт
// файлы из контейнеров, а этот скрипт правит их точной заменой строк.
//
// Каждая правка: from должна найтись ровно count раз (по умолчанию 1), иначе не пишется ничего и сборка останавливается.
// Повторный запуск узнаёт наложенную правку по probe и ничего не меняет. Переводы строк в from/to — "\n", в файле с CRLF
// они становятся "\r\n".
//
//   node patch-live.mjs site <корень>      — правит файлы сайта под <корнем>
//   node patch-live.mjs worker <корень>    — правит файлы воркера
//   node patch-live.mjs --list site|worker — пути файлов, которые нужны правкам
import fs from "node:fs";
import path from "node:path";

const UNION = '"cards" | "ai_film" | "astra" | "astra_v2"';
const UNION_OPUS = '"cards" | "ai_film" | "astra" | "astra_v2" | "opus"';
const STYLES = '["cards", "ai_film", "astra", "astra_v2"] as const';
const STYLES_OPUS = '["cards", "ai_film", "astra", "astra_v2", "opus"] as const';

const styles = { what: "стиль opus в списке стилей", file: "lib/montageStyles.ts", from: STYLES, to: STYLES_OPUS, probe: STYLES_OPUS };
const store = { what: "стиль opus в проекте", file: "lib/store.ts", from: UNION, to: UNION_OPUS, count: 2, probe: UNION_OPUS };

const HOME_RUBRIC = (target) => `    // главная пишет сценарии рубрики «Сколько бы у тебя было» (lib/opusScript.ts, владелец 5.11);
    // HOME_SCRIPTS=classic возвращает прежнего сценариста с исследованием
    if (process.env.HOME_SCRIPTS !== "classic") {
      const { script, demo } = await recordSiteSpend({ projectId: ${target}.id, topic: ${target}.topic, label: "Сценарий" }, () =>
        generateRubricScript(${target}.topic),
      );
      return NextResponse.json(updateProject(${target}.id, { script, scriptDemo: demo, scriptError: undefined }));
    }
`;

export const PATCHES = {
  site: [
    styles,
    store,
    { what: "публикация версии opus", file: "lib/publish.ts", from: UNION, to: UNION_OPUS, count: 2, probe: UNION_OPUS },
    { what: "расписание версии opus", file: "lib/publicationSchedule.ts", from: UNION, to: UNION_OPUS, probe: UNION_OPUS },
    { what: "список проектов знает opus", file: "app/components/ProjectsHome.tsx", from: UNION, to: UNION_OPUS, count: 2, probe: UNION_OPUS },
    { what: "подсказка темы — рубрика (подсказка Опуса 5.11)", file: "app/components/ProjectsHome.tsx", from: 'placeholder="Тема: айфон X в 2017, доллар в биткоин в первый день, TRUMP на старте…"', to: 'placeholder="Сколько, во что и когда: 1 доллар в биткоин 12 января 2009…"', optional: true, probe: "Сколько, во что и когда" },
    { what: "подсказка темы — рубрика (прежняя подсказка Опуса)", file: "app/components/ProjectsHome.tsx", from: 'placeholder="Что сравниваем с криптой: айфон X в 2017, PS5 на старте продаж…"', to: 'placeholder="Сколько, во что и когда: 1 доллар в биткоин 12 января 2009…"', optional: true, probe: "Сколько, во что и когда" },
    { what: "подсказка темы — рубрика", file: "app/components/ProjectsHome.tsx", optional: true, from: 'placeholder="Тема видео"', to: 'placeholder="Сколько, во что и когда: 1 доллар в биткоин 12 января 2009…"', probe: "Сколько, во что и когда" },
    { what: "выбор стиля opus", file: "app/api/projects/[id]/route.ts", from: '(body.montageStyle === "astra" || body.montageStyle === "astra_v2")', to: '(body.montageStyle === "astra" || body.montageStyle === "astra_v2" || body.montageStyle === "opus")', count: 2, probe: 'body.montageStyle === "opus"' },
    { what: "публикация выбранной версии opus", file: "app/api/projects/[id]/publish/route.ts", from: '(style === "astra" || style === "astra_v2") ? { style }', to: '(style === "astra" || style === "astra_v2" || style === "opus") ? { style }', probe: 'style === "opus"' },
    { what: "видео версии opus", file: "app/api/projects/[id]/video/route.ts", from: '(styleParam === "astra" || styleParam === "astra_v2")) ? project.outputs', to: '(styleParam === "astra" || styleParam === "astra_v2" || styleParam === "opus")) ? project.outputs', probe: 'styleParam === "opus"' },
    { what: "воркер сдаёт версию opus (тип)", file: "app/api/worker/complete/[id]/route.ts", from: UNION, to: UNION_OPUS, probe: UNION_OPUS },
    { what: "воркер сдаёт версию opus", file: "app/api/worker/complete/[id]/route.ts", from: '(body.montageStyle === "astra" || body.montageStyle === "astra_v2") ? body.montageStyle', to: '(body.montageStyle === "astra" || body.montageStyle === "astra_v2" || body.montageStyle === "opus") ? body.montageStyle', probe: 'body.montageStyle === "opus"' },
    { what: "страница: тип стиля", file: "app/project/[id]/page.tsx", from: `type MontageStyle = ${UNION};`, to: `type MontageStyle = ${UNION_OPUS};`, probe: `type MontageStyle = ${UNION_OPUS};` },
    { what: "страница: название", file: "app/project/[id]/page.tsx", from: 'astra_v2: "Астра v2" };', to: 'astra_v2: "Астра v2", opus: "Опус 5.5" };', probe: 'opus: "Опус 5.5"' },
    { what: "страница: подпись", file: "app/project/[id]/page.tsx", from: 'astra_v2: "Новая версия: движение, композиция и графика" };', to: 'astra_v2: "Новая версия: движение, композиция и графика", opus: "Как в «Новостях»: настоящие кадры, сайты, числа" };', probe: 'opus: "Как в «Новостях»' },
    { what: "страница: списки стилей", file: "app/project/[id]/page.tsx", from: STYLES, to: STYLES_OPUS, count: 3, probe: STYLES_OPUS },
    { what: "страница: есть видео", file: "app/project/[id]/page.tsx", from: "|| p.outputs?.astra_v2);", to: "|| p.outputs?.astra_v2 || p.outputs?.opus);", probe: "p.outputs?.opus" },
    { what: "страница: сохранённые версии", file: "app/project/[id]/page.tsx", from: 'astra_v2: Boolean(styleOutput(project, "astra_v2")) }}', to: 'astra_v2: Boolean(styleOutput(project, "astra_v2")), opus: Boolean(styleOutput(project, "opus")) }}', probe: 'styleOutput(project, "opus")' },
    { what: "страница: запуск монтажа", file: "app/project/[id]/page.tsx", from: '(style === "astra" || style === "astra_v2") && <AstraPanel', to: '(style === "astra" || style === "astra_v2" || style === "opus") && <AstraPanel', probe: 'style === "opus") && <AstraPanel' },
    { what: "страница: превью исходной записи", file: "app/project/[id]/page.tsx", from: '((style === "astra" || style === "astra_v2") ?', to: '((style === "astra" || style === "astra_v2" || style === "opus") ?', count: 2, probe: '((style === "astra" || style === "astra_v2" || style === "opus") ?' },
    { what: "главная: импорт рубрики", file: "app/api/projects/route.ts", from: 'import { generateScript } from "@/lib/ai";', to: 'import { generateScript } from "@/lib/ai";\nimport { generateRubricScript } from "@/lib/opusScript";', probe: "@/lib/opusScript" },
    { what: "главная: сценарий рубрики", file: "app/api/projects/route.ts", from: '    if (process.env.STORY_RESEARCH_SCRIPT !== "off") {\n', to: `${HOME_RUBRIC("project")}    if (process.env.STORY_RESEARCH_SCRIPT !== "off") {\n`, probe: "generateRubricScript(project.topic)" },
    { what: "перегенерация: импорт рубрики", file: "app/api/projects/[id]/generate/route.ts", from: 'import { generateMeta, generateScript } from "@/lib/ai";', to: 'import { generateMeta, generateScript } from "@/lib/ai";\nimport { generateRubricScript } from "@/lib/opusScript";', probe: "@/lib/opusScript" },
    { what: "перегенерация: сценарий рубрики", file: "app/api/projects/[id]/generate/route.ts", from: '    if (process.env.STORY_RESEARCH_SCRIPT !== "off") {\n', to: `${HOME_RUBRIC("project").replaceAll("project.id", "id")}    if (process.env.STORY_RESEARCH_SCRIPT !== "off") {\n`, probe: "generateRubricScript(project.topic)" },
  ],
  worker: [
    styles,
    store,
    { what: "конвейер: импорт", file: "lib/pipeline.ts", from: 'import { astraEngineEnabled, astraEngineState, deferred, runAstraEngine } from "./astraEngine";', to: 'import { astraEngineEnabled, astraEngineState, deferred, runAstraEngine } from "./astraEngine";\nimport { runOpusEngine } from "./opusEngine";', probe: "./opusEngine" },
    { what: "конвейер: стиль opus", file: "lib/pipeline.ts", from: '    const astraStyle = project.montageStyle === "astra" || astraV2;\n', to: '    const astraStyle = project.montageStyle === "astra" || astraV2;\n    // Опус 5.5 монтирует на ПК движком «Новостей» (lib/opusEngine.ts): исследование и медиатека карточек ему не нужны\n    const opusStyle = project.montageStyle === "opus";\n', probe: 'const opusStyle = project.montageStyle === "opus";' },
    { what: "конвейер: без исследования", file: "lib/pipeline.ts", from: "const researchPromise: Promise<StoryResearchPack | null> = astraStyle ?", to: "const researchPromise: Promise<StoryResearchPack | null> = astraStyle || opusStyle ?", probe: "= astraStyle || opusStyle ?" },
    { what: "конвейер: без медиатеки", file: "lib/pipeline.ts", from: "montageV3() && !aiFilmStyle && !astraStyle && !recordingOnly", to: "montageV3() && !aiFilmStyle && !astraStyle && !opusStyle && !recordingOnly", probe: "!astraStyle && !opusStyle && !recordingOnly" },
    { what: "конвейер: без медиатеки (запись)", file: "lib/pipeline.ts", from: "if (montageV3() && !aiFilmStyle && !astraStyle) {", to: "if (montageV3() && !aiFilmStyle && !astraStyle && !opusStyle) {", probe: "!astraStyle && !opusStyle) {" },
    { what: "конвейер: кадр на голове автора", file: "lib/pipeline.ts", from: "const fitForAuthor = astraEngineOn\n", to: "const fitForAuthor = astraEngineOn || opusStyle\n", probe: "const fitForAuthor = astraEngineOn || opusStyle" },
    { what: "конвейер: план не нужен", file: "lib/pipeline.ts", from: "    if (astraStyle && (astraV2 || astraEngineEnabled())) {\n      // Новая Астра пишет и собирает монтаж сама", to: '    if (opusStyle) {\n      // Опус 5.5 раскладывает кадры сам на ПК: план карточек не нужен.\n      plan = { version: 1, duration: effDur, events: [], captionStyle: { ...DEFAULT_CAPTION_STYLE } };\n      fs.writeFileSync(path.join(dir, "edit-plan.json"), JSON.stringify(plan, null, 2), "utf8");\n    } else if (astraStyle && (astraV2 || astraEngineEnabled())) {\n      // Новая Астра пишет и собирает монтаж сама', probe: "Опус 5.5 раскладывает кадры сам на ПК" },
    { what: "конвейер: монтаж на ПК", file: "lib/pipeline.ts", from: "    } else if (astraStyle && (astraV2 || astraEngineEnabled())) {\n      // Астра начала монтаж ещё до нарезки записи", to: '    } else if (opusStyle) {\n      await runOpusEngine({\n        dir, source, words, topic: project.topic, script: project.script ?? "",\n        signal: astraAbort.signal,\n        setStep: (step, progress) => setStep(id, step, progress),\n      });\n    } else if (astraStyle && (astraV2 || astraEngineEnabled())) {\n      // Астра начала монтаж ещё до нарезки записи', probe: "await runOpusEngine(" },
    { what: "конвейер: проверка", file: "lib/pipeline.ts", from: "    } else if (astraStyle && (astraV2 || astraEngineEnabled())) {\n      // Картинки Астра проверила сама до рендера", to: "    } else if (opusStyle) {\n      // Кадры Опус 5.5 проверил на ПК до рендера; целостность файла проверена selfCheck выше.\n    } else if (astraStyle && (astraV2 || astraEngineEnabled())) {\n      // Картинки Астра проверила сама до рендера", probe: "Кадры Опус 5.5 проверил на ПК" },
    { what: "конвейер: версия opus", file: "lib/pipeline.ts", from: 'const completedStyle = astraV2 ? "astra_v2"', to: 'const completedStyle = opusStyle ? "opus" : astraV2 ? "astra_v2"', probe: 'opusStyle ? "opus"' },
  ],
};

const [a, b] = process.argv.slice(2);
if (a === "--list") {
  for (const f of [...new Set(PATCHES[b].map((p) => p.file))]) console.log(f);
  process.exit(0);
}
const list = PATCHES[a];
if (!list || !b) {
  console.error("node patch-live.mjs site|worker <корень>");
  process.exit(2);
}
const texts = new Map();
const read = (f) => texts.get(f) ?? fs.readFileSync(path.join(b, f), "utf8");
let failed = 0;
for (const p of list) {
  let text = read(p.file);
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const from = p.from.replaceAll("\n", eol);
  const to = p.to.replaceAll("\n", eol);
  if (text.includes(p.probe.replaceAll("\n", eol))) {
    console.log(`  уже есть: ${p.what}`);
    texts.set(p.file, text);
    continue;
  }
  const n = text.split(from).length - 1;
  if (n === 0 && p.optional) {
    texts.set(p.file, text);
    continue;
  }
  if (n !== (p.count ?? 1)) {
    console.error(`✖ ${p.file}: «${p.what}» — строка найдена ${n} раз вместо ${p.count ?? 1}`);
    failed++;
    continue;
  }
  text = text.replaceAll(from, to);
  texts.set(p.file, text);
  console.log(`  ✓ ${p.what}`);
}
if (failed) process.exit(1);
for (const [f, t] of texts) fs.writeFileSync(path.join(b, f), t);
