import type { AstraInput } from "../src/input";
import { loadExamples, loadGuide, loadLessons } from "./knowledge";
import { designGuide, designProfile, v2Kit, type DesignProfile } from "./design";

export type Task = {
  designProfile?: DesignProfile;
  topic: string;
  input: AstraInput;
  /** Owner's feedback on earlier videos, newest last. */
  lessons: string[];
  /** Meme clips available in the owner's library, by name. */
  memes?: string[];
  /** Checked facts of the story. */
  facts?: string[];
};

const OUTPUT = `## Ответ

Ответ — полный текст файла Montage.tsx и больше ничего: без markdown-ограждений и без пояснений. Файл начинается с import и экспортирует Montage.`;

const PATCH_OUTPUT = `## Ответ: точечные правки

Ответ — только JSON {"edits":[{"before":"точный уникальный фрагмент исходного файла","after":"новый фрагмент или пустая строка для удаления","reason":"зачем нужна эта правка"}]}.
Не возвращай весь Montage.tsx. Каждая before встречается в исходном файле ровно один раз; добавь соседний код, если нужно различить одинаковые строки. Все замены применяются к исходному файлу одновременно: фрагменты не пересекаются. До 32 замен, до 12000 знаков на фрагмент. Если всё хорошо — {"edits":[]}.
Сохрани все места без замечаний, включая тайминги и оформление. Материалы уже подготовлены и проверены: prompt, query, wiki, look, into, start оставляй слово в слово, если сама картинка не требует замены по смыслу. Для смены материала укажи конкретный видимый недостаток в reason. Для исправления звуков, текста, расположения или ритма не переписывай запросы картинок.
Используй существующие кубики и свойства из набора. Не добавляй зависимости или произвольный исполняемый код.`;

/** System prompt: how Astra edits, the kit, and worked examples. */
export function systemPrompt(mode: "file" | "patch" = "file", profile: DesignProfile = designProfile()): string {
  const guide = loadGuide();
  const examples = loadExamples(profile === "legacy" ? "examples" : "examples-v2").map(e => e.text).join("\n\n---\n\n");
  return [guide.director, guide.kit, "# Образцы монтажа\n\n" + examples, designGuide(profile), mode === "patch" ? PATCH_OUTPUT : OUTPUT].filter(Boolean).join("\n\n---\n\n");
}

/** Repairs need the component contract; the initial creative brief and examples have already been applied. */
export function repairSystemPrompt(profile: DesignProfile = "legacy"): string {
  // v2 repairs need the contract of its own blocks (pages, collages, the ending) too.
  return ["Ты — Астра. Исправь только перечисленные проблемы сборки в готовом монтаже, сохранив остальное.", loadGuide().kit,
    profile === "legacy" ? "" : v2Kit(), PATCH_OUTPUT].filter(Boolean).join("\n\n");
}

function transcript(input: AstraInput): string {
  return input.words.map((w, i) => `${i}:${w.word}@${w.start.toFixed(2)}-${w.end.toFixed(2)}`).join(" ");
}

/** The concrete video: its speech with timings, the frame, and what the libraries hold. */
export function taskPrompt(task: Task): string {
  const { input } = task;
  const sounds = Object.entries(input.sounds).filter(([, files]) => files.length).map(([role]) => role);
  const music = Object.entries(input.music).filter(([, files]) => files.length).map(([mood]) => mood);
  const face = input.face;
  return [
    `# Ролик`,
    `Тема: ${task.topic}`,
    `Длительность: ${input.duration.toFixed(2)} с. Кадр 1080×1920.`,
    face ? `Голова автора в обычном кадре: x ${face.x}–${face.x + face.w}, y ${face.y}–${face.y + face.h}.` : "",
    input.sceneColor
      ? `Цвет кадра автора: ${input.sceneColor} — так светится комната (подсветка, лампа, стена). Акцент из кадра делает графику частью ролика: <AstraVideo accent="scene">.`
      : `В кадре автора нет своего яркого цвета: акцент — из палитры.`,
    `Звуки в библиотеке: ${sounds.length ? sounds.join(", ") : "пока пусто (встроенные звуки кубиков прозвучат, когда библиотеку наполнят)"}.`,
    `Музыка: трек подбирается под этот ролик отдельно и звучит под любым настроением — поставь <Music mood="…" /> по характеру истории.`,
    (process.env.ASTRA_DRAW === "0"
      ? `Картинки в этом ролике не рисуются — только настоящие: кадры видео из интернета (<Footage query="...">: игра, приложение, событие, продукт, место; ты выберешь в клипе момент под слова автора), фото людей, мест и событий из Википедии (<RealPhoto query="..." wiki="...">), фото предметов с фотостоков (<Photo query="..." look="...">: query — 2–4 слова по-английски, как на фотостоке, look — что должно быть видно; ты выберешь снимок глазами), логотипы (<Logo name="...">). Сцен (Scene) и превращений (Morph) нет; фон досок — backdrop="footage:<запрос>". Где настоящего нет — доска, график, слово за спиной автора, панч камеры.`
      : `Картинки: настоящие кадры видео из интернета (<Footage query="...">: игра, приложение, событие, продукт, место — 14 секунд настоящего ролика по запросу по-английски), настоящие фото людей, мест и событий из Википедии (<RealPhoto query="..." wiki="...">), реалистичные картинки предметов (<Photo query="..." look="...">), логотипы (<Logo name="...">), сцены истории (<Scene prompt="...">) и превращения автора (<Morph into="...">) готовятся по твоему запросу перед рендером.`) +
      ` Мемы в библиотеке: ${task.memes?.length ? task.memes.join(", ") : "пока нет"}.` +
      (Object.keys(input.assets).length ? ` Готовые материалы автора: ${Object.keys(input.assets).join(", ")}.` : ""),
    ``,
    task.facts?.length ? [
      "## Факты истории",
      "Факты нужны, чтобы картинки были точными: кто участвует и сколько их, что у них в руках, где это было.",
      "Сюжет ролика — речь автора: монтаж иллюстрирует его рассказ и на экране с ним не спорит. Если факты в чём-то расходятся с речью, опиши расхождение в комментарии первой строкой файла — его прочитает владелец.",
      ...task.facts.map(f => `- ${f}`), "",
    ].join("\n") : "",
    `## Расшифровка`,
    `индекс:слово@начало-конец`,
    transcript(input),
    ``,
    `## Уроки`,
    [...loadLessons(task.designProfile ?? designProfile()), ...task.lessons].map(l => `- ${l}`).join("\n"),
    ``,
    `Смонтируй этот ролик.`,
  ].filter(line => line !== undefined).join("\n");
}

/** Astra names the music of this video: tracks that fit its story and that TikTok edits use now. */
export function musicPrompt(task: Task, mood: string | undefined, recent: string[] = []): string {
  return [
    `# Музыка для ролика`,
    `Тема: ${task.topic}`,
    `Длительность: ${task.input.duration.toFixed(0)} с.${mood ? ` Настроение монтажа: ${mood}.` : ""}`,
    `Речь автора: ${task.input.words.map(w => w.word).join(" ").slice(0, 1500)}`,
    ``,
    `Подбери музыку, под которую этот ролик смотрится как сильный монтаж в TikTok: трек, который сейчас звучит в трендовых роликах и подходит к теме, темпу и настроению этой истории.`,
    `Музыка идёт под голосом автора, поэтому нужна версия без слов: инструментал, бит, phonk, cinematic, lo-fi — что подходит по смыслу.`,
    recent.length ? `Эти треки уже звучали в прошлых роликах автора — у этого ролика свой: ${recent.join("; ")}.` : "",
    `Дай 3 варианта по убыванию уверенности, каждый — точный запрос для поиска на YouTube: исполнитель и название, при необходимости со словом instrumental.`,
    `Ответ — только JSON: {"tracks": [{"query": "…", "why": "почему подходит, коротко по-русски"}]}`,
  ].join("\n");
}

/** The owner's remarks on a finished montage: the places named are redone, everything else stays as it was. */
export function remarksPrompt(task: Task, code: string, remarks: string[]): string {
  return [
    taskPrompt(task),
    ``,
    `## Твой готовый монтаж`,
    code,
    ``,
    `## Замечания владельца после просмотра`,
    remarks.map((r, i) => `${i + 1}. ${r}`).join("\n"),
    ``,
    `Переделай ровно те места, о которых замечания: подбери другой кубик, запрос или картинку так, чтобы владелец увидел то, о чём просил.`,
    `Остальное оставь как есть — тайминги, кубики, картинки и звуки, к которым замечаний нет, не трогай. Верни файл целиком.`,
  ].join("\n");
}

export function fixPrompt(task: Task, code: string, problems: string[]): string {
  return [
    taskPrompt(task),
    ``,
    `## Твой файл`,
    code,
    ``,
    `## Что мешает собрать ролик`,
    problems.map(p => `- ${p}`).join("\n"),
    ``,
    `Исправь перечисленные проблемы точечными заменами по формату JSON edits. Остальной монтаж уже готов: сохрани его.`,
  ].join("\n");
}

export function reviewPrompt(task: Task, code: string, frames: { label: string }[], notes: string[]): string {
  return [
    taskPrompt(task),
    ``,
    `## Твой черновик`,
    code,
    ``,
    `## Как он выглядит`,
    ...(task.designProfile === "legacy" ? [] : [designGuide(task.designProfile ?? designProfile())]),
    `К заданию приложены кадры черновика в таком порядке:`,
    frames.map((f, i) => `${i + 1}. ${f.label}`).join("\n"),
    notes.length ? `\nЗамечания автоматической проверки:\n${notes.map(n => `- ${n}`).join("\n")}` : "",
    ``,
    `Посмотри на кадры глазами зрителя и сравни с образцом ритма. Что читается плохо, что закрывает лицо, где пусто или перегружено, где событие не совпадает со словом — поправь.`,
    `Картинки в черновике уже проверены: у блоков, картинка которых на кадрах смотрится хорошо, оставь prompt, query, look и into слово в слово — тогда они не будут делаться заново. Меняй описание только той картинки, что на кадрах видна плохо.`,
    `Верни точечные улучшения по формату JSON edits. Если черновик уже хорош — {"edits":[]}.`,
  ].join("\n");
}
