import { claudeBridgeComplete } from "../claudeBridgeClient";
import { mediaComplete, parseJson } from "../mediaLlm";
import { assertProvider } from "../providerPolicy";
import { CAPTION_MAX, TITLE_MAX, VISIBLE_CHARS, captionIssues, normalizeMeta, type SocialMeta } from "./text";

/**
 * Промпт учит приёму на образцах, а не перечисляет запреты: так просил автор, и так модель
 * пишет живее. Подпись по просьбе автора — одна мысль (мораль ролика) и вопрос, без хэштегов.
 */
export const META_SYSTEM = `Ты пишешь текст к публикации короткого вертикального ролика: заголовок для YouTube и подпись для Instagram и TikTok. Пишешь голосом автора ролика, от первого лица, как он сам сказал бы это другу.

Зритель читает подпись, когда ролик уже посмотрел. Пересказ ему не нужен: он только что всё видел. Подпись даёт то, что остаётся после ролика.

Хорошая подпись состоит из двух фраз:
1. Одна мысль: мораль ролика, вывод, который зритель унесёт с собой. Сказана своими словами, коротко и прямо, как правило из жизни. Целиком помещается в первые ${VISIBLE_CHARS} знаков: столько лента показывает до «ещё».
2. Один вопрос, который продолжает эту мысль и на который зритель ответит из своего опыта.

Текст держится на словах: без эмодзи и хэштегов. Вся подпись до ${CAPTION_MAX} знаков. Части фразы связаны запятой или двоеточием, а отдельная мысль идёт новой фразой: «Глазам уже мало верить: смотри, кто выложил».

Заголовок для YouTube до ${TITLE_MAX} знаков: суть ролика и поисковая фраза, как назвал бы ролик человек, который ищет эту тему. Обещает ровно то, что в ролике есть.

Образцы.

Ролик объясняет биткоин через робуксы в Роблоксе:
{"title": "Что такое биткоин: объяснение на робуксах", "description": "Деньги стоят чего-то, пока их нельзя напечатать по желанию. Какую игровую валюту ты бы сравнил с криптой?"}

Ролик про мошенника, который просит сид-фразу «для проверки кошелька»:
{"title": "Сид-фраза: схема, на которой теряют кошелёк", "description": "Кто просит сид-фразу, тот уже забирает кошелёк, как бы он ни назывался. Тебе писали такие «поддержки»?"}

Ролик про то, как автор попробовал стримить с нуля:
{"title": "Первый стрим с нуля: что пошло не так", "description": "Первый стрим нужен не для зрителей, а чтобы перестать бояться второго. С чего начинал ты?"}

Точность: сценарий - речь автора, проверенная справка - твоя опора по фактам. Если они расходятся, пиши по справке. Мораль вырастает из того, что в ролике есть, и не добавляет новых фактов.

Ответ: один JSON такого вида: {"title": "...", "description": "..."}`;

export type MetaInput = { topic: string; script: string; facts?: string[]; today: string };
type Complete = (system: string, user: string) => Promise<string>;
type RawMeta = { title?: unknown; description?: unknown; hashtags?: unknown };

export function metaUser({ topic, script, facts = [], today }: MetaInput): string {
  return [
    today,
    `Тема: ${topic}`,
    `Сценарий (речь автора в ролике):\n${script.trim() || "Сценария нет: опирайся на тему."}`,
    `Проверенная справка:\n${facts.length ? facts.join("\n") : "Не предоставлена: пиши только то, что есть в сценарии."}`,
  ].join("\n\n");
}

/**
 * Текст публикации пишет тот же Claude, что и сценарии (SCRIPT_LLM_TRANSPORT=claude); без моста —
 * общий транспорт конвейера. Настройка читается здесь, а не через mediaLlm: воркер собран раньше
 * и своего переключателя сценариев не знает, а подпись к его монтажу тоже пишет Claude.
 */
export function claudeWritesMeta(): boolean {
  return String(process.env.SCRIPT_LLM_TRANSPORT ?? "").toLowerCase() === "claude";
}

async function complete(system: string, user: string): Promise<string> {
  if (claudeWritesMeta()) {
    assertProvider("Metadata", "anthropic");
    const model = process.env.CLAUDE_SCRIPT_MODEL || "claude-opus-5";
    return claudeBridgeComplete({ stage: "Metadata", model, system, user, task: "caption" });
  }
  return mediaComplete({ model: "claude-sonnet-5", maxTokens: 16000, stage: "Metadata", system, user });
}

async function draft(ask: Complete, user: string, topic: string): Promise<SocialMeta> {
  const raw = await ask(META_SYSTEM, user);
  try {
    return normalizeMeta(parseJson<RawMeta>(raw, "Metadata"), topic);
  } catch {
    // один повтор: ответ, который не разобрать, не должен стать подписью
    return normalizeMeta(parseJson<RawMeta>(await ask(META_SYSTEM, `${user}\n\nОтветь одним JSON по образцу.`), "Metadata"), topic);
  }
}

/**
 * Заголовок, подпись и хэштеги к ролику. Чистка и проверка после модели; если подпись
 * расходится с образцом, второй проход получает свой вариант и поручения, что поправить,
 * и остаётся вариант с меньшим числом замечаний.
 */
export async function writeMeta(input: MetaInput, ask: Complete = complete): Promise<SocialMeta> {
  const user = metaUser(input);
  const first = await draft(ask, user, input.topic);
  const issues = captionIssues(first);
  if (!issues.length) return first;
  const revisionUser = `${user}\n\nТвой вариант:\n${JSON.stringify(first)}\n\nДоведи его до образца:\n${issues.map((issue) => `- ${issue}`).join("\n")}`;
  try {
    const second = await draft(ask, revisionUser, input.topic);
    return captionIssues(second).length <= issues.length ? second : first;
  } catch {
    return first;
  }
}
