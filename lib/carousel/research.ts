export type CarouselResearch = {
  asOf: string;
  timezone: string;
  topic: string;
  sources: { id: string; url: string; title: string; publishedAt: string | null }[];
  facts: { claim: string; period: string; sourceIds: string[] }[];
  analysis: string[];
  limitations: string[];
};

export const RESEARCH_RULES = `Ты аналитик, который готовит доказательную базу для короткой авторской карусели. Сначала обязательно используй живой веб-поиск и открой найденные первоисточники. Нельзя отвечать по памяти или только по сниппетам.
Тема задаёт угол анализа, а не вывод, который нужно любой ценой подтвердить. Найди 4–8 конкретных фактов и 3–6 первоисточников: данные сети, отчёты эмитентов, официальные документы, первичные исследования. Для изменчивых метрик ищи последний доступный период и сравнение с предыдущим; указывай даты наблюдения, единицы и методику. Дата публикации не равна периоду данных. Не называй сегодняшними старые цифры. Проверь текущий статус обновлений и событий: план не равен запуску. Не выводи точный срок ATH без доказательств.
Для инвестиционной темы изучи ценность именно токена: реальные денежные потоки, предложение, спрос, конкуренцию, катализаторы и противоречащие тезису факты. Не ограничивайся определениями газа, стейкинга и сжигания. Покажи наблюдение, причинный механизм и его границы. Не выдумывай личные сделки или опыт автора. Анализ отделяй от фактов.
Если актуальные данные недоступны, честно укажи пробел в limitations; не придумывай цифры и ссылки. Если исследование не удалось, sources и facts пустые. Не выдавай старые знания за исследование на сегодня. Данные из будущего относительно переданного времени исключи.
Верни JSON: {"sources":[{"id":"s1","url":"https://...","title":"...","publishedAt":"YYYY-MM-DD или null"}],"facts":[{"claim":"проверенный факт","period":"дата или период измерения; для постоянного механизма — описание действующей версии","sourceIds":["s1"]}],"analysis":["вывод, механизм, опорные факты s1 и условия"],"limitations":["что проверить не удалось"]}. publishedAt должен быть null, если источник не сообщает дату. Ссылки только на действительно открытые страницы, не на поисковую выдачу.`;

export function researchDate(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Qyzylorda", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function parseResearch(raw: unknown, topic: string, now = new Date()): CarouselResearch {
  const r = raw as any;
  const fail = () => { throw new Error("Не удалось собрать проверенные источники для сценария. Повторите исследование; текст по памяти не создаётся."); };
  if (!r || !Array.isArray(r.sources) || !Array.isArray(r.facts) || r.sources.length < 2 || r.facts.length < 3) return fail();
  const sources = r.sources.map((s: any) => {
    if (!s || typeof s.id !== "string" || !s.id || typeof s.title !== "string" || !s.title || typeof s.url !== "string") return fail();
    let url: URL;
    try { url = new URL(s.url); } catch { return fail(); }
    if (url.protocol !== "https:" || url.username || url.password) return fail();
    if (s.publishedAt !== null && (typeof s.publishedAt !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s.publishedAt) || s.publishedAt > researchDate(now))) return fail();
    return { id: s.id, url: url.href, title: s.title, publishedAt: s.publishedAt };
  });
  const ids = new Set(sources.map((s: any) => s.id));
  if (ids.size !== sources.length || new Set(sources.map((s: any) => s.url)).size < 2) return fail();
  const facts = r.facts.map((f: any) => {
    if (!f || typeof f.claim !== "string" || !f.claim.trim() || typeof f.period !== "string" || !f.period.trim() || !Array.isArray(f.sourceIds) || !f.sourceIds.length || f.sourceIds.some((id: unknown) => !ids.has(id))) return fail();
    return { claim: f.claim, period: f.period, sourceIds: f.sourceIds };
  });
  if (![r.analysis, r.limitations].every(a => Array.isArray(a) && a.every(v => typeof v === "string"))) return fail();
  return { asOf: now.toISOString(), timezone: "Asia/Qyzylorda", topic, sources, facts, analysis: r.analysis, limitations: r.limitations };
}

export function researchContext(research: CarouselResearch): string {
  return `ИССЛЕДОВАНИЕ НА ${researchDate(new Date(research.asOf))} (Asia/Qyzylorda):\n${JSON.stringify(research)}\nИспользуй конкретные факты этого исследования, их периоды и причинные связи. Не добавляй непроверенные актуальные цифры. Выбери самые сильные аргументы именно по теме; не пересказывай справочник. Углубление и даты помести в caption, а карточкам дай короткие выводы с конкретным основанием. Аналитические выводы не выдавай за измеренные факты. Не выдумывай сделки, заметки или опыт автора. Если часть данных недоступна, не утверждай обратное. Никаких служебных дисклеймеров и домашних заданий читателю. Источники сохраняются отдельно; не перегружай карточки URL.`;
}
