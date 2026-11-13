/**
 * 26 формул зацепки для коротких роликов — перевод hooks.json из instagram-agent-skill
 * (https://github.com/Jakeschincariol/instagram-agent-skill, skills/ig-reel/hooks.json).
 *
 * Copyright (c) 2026 Jake Schincariol
 * Permission is hereby granted, free of charge, to any person obtaining a copy of this software and
 * associated documentation files (the "Software"), to deal in the Software without restriction,
 * including without limitation the rights to use, copy, modify, merge, publish, distribute,
 * sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions: The above copyright notice and this
 * permission notice shall be included in all copies or substantial portions of the Software.
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT
 * NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
 * NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
 * DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 *
 * Описания переведены для Claude, а `match` оставлен английским: им размечаются зацепки
 * англоязычных роликов, на русском те же регулярки не работают.
 */

export type HookFormula = {
  id: number;
  /** русское имя формулы, его видит владелец */
  name: string;
  /** имя в hooks.json — по нему проще сверяться с репо */
  en: string;
  template: string;
  example: string;
  /** надпись на экране — короче и резче сказанного */
  screen: string;
  use: string;
  trap: string;
  match: RegExp;
};

export const HOOK_RULES = [
  "У ролика две зацепки, и это разные фразы: первое, что звучит, и первое, что видно на экране. Сказанной хватает двух секунд, надписи — одной: её читают раньше, чем слышат.",
  "Надпись на экране короче и прямее сказанного: до шести слов, без лишних знаков.",
  "Ролик начинается с фразы, до которой обычно добираются к шестой секунде.",
  "Число вместо «много»: «4200 рублей», а не «кучу денег».",
  "Первый кадр — тоже зацепка: в нём движение или надпись.",
  "Зацепка, которую мог бы сказать любой в нише, — чужая. В неё входит то, что можешь сказать только ты.",
  "Обещание зацепки выполняется до середины ролика.",
];

export const HOOKS: HookFormula[] = [
  {
    id: 1, name: "Цена ошибки", en: "Cost Confession",
    template: "{Конкретная сумма} — столько мне стоила {одна ошибка}.",
    example: "18 000 долларов — столько мне стоил один пропущенный пункт в договоре.",
    screen: "ОШИБКА НА $18 000",
    use: "Быстрое доверие: досматривают ролики, где плохо выглядит сам автор.",
    trap: "Ненастоящая цена: «это стоило мне спокойствия» — не число, и это слышно.",
    match: /\$\s?\d[\d,]*\s+(?:is|was) what\b|\bcost (?:me|us|him|her|them)\b|\blost\b[^.!?]{0,20}\$\s?\d/i,
  },
  {
    id: 2, name: "Перестань", en: "Negative Command",
    template: "Перестань {привычное действие}. Делай {другое}.",
    example: "Перестань постить три раза в день. Пости дважды и час отвечай на каждый комментарий.",
    screen: "ХВАТИТ ПОСТИТЬ КАЖДЫЙ ДЕНЬ",
    use: "Сохранения и споры: повелительное наклонение цепляет сильнее утверждения.",
    trap: "Отучать от того, чего никто не делает. Зритель должен узнать привычку в себе.",
    match: /^\s*(?:stop|quit|never|don'?t|dont|please)\b[^.!?]{0,30}\b(?:do|be|make|buy|use|start|say|post|send|take|charge)?\b|\b(?:do not|don'?t|dont|never) (?:do|be|make|buy|use|start|say|post|take)\b|\bquit your\b/i,
  },
  {
    id: 3, name: "Никто не говорит", en: "Nobody Tells You",
    template: "Никто не говорит, что {неудобная правда о том, чего зритель хочет}.",
    example: "Никто не говорит, что первые 30 роликов и должны провалиться.",
    screen: "ПЕРВЫЕ 30 ПРОВАЛЯТСЯ",
    use: "Новая аудитория: автор — тот, кто говорит вслух то, о чём молчат.",
    trap: "Правда, которую и так все повторяют. Если с тобой соглашаются раньше, чем ты договорил, это не секрет.",
    match: /\b(?:nobody|no one|nobody ever)\s+(?:ever\s+)?(?:tells|told|talks|talked|says|said|mentions|teaches)\b|\bwhat (?:nobody|no one) (?:tells|says)\b/i,
  },
  {
    id: 4, name: "Замена", en: "The Replacement",
    template: "{Вот это} заменило мне {дорогую вещь} за {цену}.",
    example: "Сервис за 12 долларов заменил монтажёра, которому я платил 2000 в месяц.",
    screen: "$2000 → $12",
    use: "Обзоры и демонстрации: всю работу делает разница в цене.",
    trap: "Преувеличенная замена. Заменило на 60% — скажи «на 60%», иначе это скажут в комментариях.",
    match: /\breplaced?\b[^.!?]*\$\s?\d|\$\s?\d[^.!?]*\breplaced?\b|\binstead of (?:paying|hiring)\b/i,
  },
  {
    id: 5, name: "Было долго — стало быстро", en: "Time Collapse",
    template: "Раньше это занимало у меня {много времени}. Теперь — {мало}.",
    example: "Раньше сценарий занимал у меня пять часов. Теперь двадцать минут.",
    screen: "5 ЧАСОВ → 20 МИНУТ",
    use: "Ролики про процесс, где выигрыш — скорость. Читается на экране мгновенно.",
    trap: "Соотношение, в которое не верят: «сорок часов за четыре секунды» примут за враньё, даже если это правда.",
    match: /\bused to take\b|\bnow (?:it )?(?:only )?takes?\b|\btakes? (?:me )?\d+\s*(?:sec|second|min|minute|hour|hr)/i,
  },
  {
    id: 6, name: "Отчёт с цифрами", en: "The Receipt",
    template: "Я {делал что-то} {N дней}. Вот настоящие цифры.",
    example: "Я выкладывал по ролику в день 60 дней. Вот что стало с сообщениями.",
    screen: "60 ДНЕЙ. НАСТОЯЩИЕ ЦИФРЫ",
    use: "Эксперименты. Вся ценность — в записи экрана с настоящими цифрами.",
    trap: "Не показать экран. Ролик про цифры без записи экрана — просто слова о цифрах.",
    match: /\bi\s+\w+(?:ed)?\s+[^.!?]{0,30}\bfor\s+\d+\s+(?:days?|weeks?|months?|years?)\b|\bhere (?:are|is) (?:the|my)\b[^.!?]*\bnumbers\b|\bwe(?:'ll| will)? do \$\s?\d/i,
  },
  {
    id: 7, name: "Делаешь не так, и это не твоя вина", en: "Wrong Way, Right Way",
    template: "Ты делаешь {это} неправильно, и ты не виноват. {Как надо}.",
    example: "Ты пишешь подписи неправильно, и ты не виноват: Instagram прячет всё после первой строки.",
    screen: "ТВОИ ПОДПИСИ ОБРЕЗАНЫ",
    use: "Обучение. «Ты не виноват» убирает обиду, которая и губит эту формулу.",
    trap: "Пропустить оправдание: одно «ты делаешь неправильно» заставляет уйти, а не учиться.",
    match: /\b(?:big(?:gest)?|common|the) mistake\b|\bmistake (?:that|people|i)\b|\byou'?(?:re| are) doing\b[^.!?]*\bwrong\b|\bdoing (?:it|this) wrong\b/i,
  },
  {
    id: 8, name: "Взгляд изнутри", en: "Insider Leak",
    template: "Я {N лет} провёл {внутри этого}. Вот о чём мы никогда не говорили вслух.",
    example: "Шесть лет я продавал услуги агентства. Вот чего мы никогда не писали в предложении.",
    screen: "6 ЛЕТ ВНУТРИ",
    use: "Авторитет без слайда с регалиями. Работает, только если годы настоящие.",
    trap: "Пообещать секрет и выдать рекламный буклет. Комментарии такого не прощают.",
    match: /\bi (?:spent|worked|ran|was|have been)\b[^.!?]*\b\d+\s*\+?\s*years?\b|\bwe never (?:told|said|showed)\b|\bnobody (?:puts|tells you about)\b|\bi (?:sell|sold|run)\b[^.!?]*\$\s?\d/i,
  },
  {
    id: 9, name: "Забирай", en: "The Steal",
    template: "Забирай {готовую вещь}. Я доводил её {столько-то}.",
    example: "Забирай это письмо из четырёх строк. Я доводил его два года и потерял кучу клиентов.",
    screen: "ЗАБИРАЙ",
    use: "Сохранения и пересылки — две метрики, которые сильнее всего двигают охват.",
    trap: "Вещи нет на экране. Если её нельзя заскриншотить, забирать нечего.",
    match: /^\s*steal\b|\bsteal (?:this|these|my)\b|^\s*(?:here'?s|this is) (?:the|my) (?:exact|literal)\b/i,
  },
  {
    id: 10, name: "Если у тебя так — смотри", en: "If This, Then Watch",
    template: "Если у тебя {конкретная ситуация}, следующие {N секунд} это исправят.",
    example: "Если у роликов есть просмотры, а подписчиков нет, следующие 40 секунд это исправят.",
    screen: "ПРОСМОТРЫ ЕСТЬ, ПОДПИСОК НЕТ?",
    use: "Жёсткий отбор: остаётся меньше людей, зато именно те, кому это нужно.",
    trap: "Ситуация настолько общая, что не отбирает никого. «Если хочешь расти» — не ситуация.",
    match: /^\s*if (?:you|i|we|your|my|they)\b/i,
  },
  {
    id: 11, name: "Список с любимым пунктом", en: "Numbered With A Favourite",
    template: "{N} {вещей}, которые {результат}. Номер {k} — тот, которым никто не пользуется.",
    example: "Пять правок подписи, которые удваивают сохранения. Четвёртую не делает никто.",
    screen: "5 ПРАВОК. №4 — ГЛАВНАЯ",
    use: "Удержание в середине: любимый пункт — причина досмотреть дальше третьего.",
    trap: "N больше семи. В девять хороших пунктов никто не верит, и их у тебя нет.",
    match: /^\s*(?:here are\s+)?\d+\s+\w+|\bnumber \d+\b|\b(?:three|four|five|seven|ten)\s+\w+\s+(?:every|that|you)\b/i,
  },
  {
    id: 12, name: "Возражение", en: "The Objection",
    template: "«{Возражение, которое говорят на самом деле}». Ладно. Вот как это работает всё равно.",
    example: "«Я не хочу сниматься на камеру». Ладно. Вот вариант без лица, который всё равно продаёт.",
    screen: "«НЕНАВИЖУ КАМЕРУ»",
    use: "Для тех, кто уже однажды отказался.",
    trap: "Выдуманное возражение. Бери слово в слово из сообщения или комментария, с ошибками.",
    match: /^\s*["“'][^"”']{5,120}["”'][,.]?\s*(?:fine|ok|okay|sure|right|here)/i,
  },
  {
    id: 13, name: "До и после на экране", en: "Before And After, On Screen",
    template: "{Показать старое}. {Показать новое}. {Одна фраза о том, что изменилось}.",
    example: "Это мой профиль в марте. Это сейчас. Я поменял только имя.",
    screen: "МАРТ / СЕЙЧАС",
    use: "Всё, что видно глазами. Зацепка — склейка двух кадров, слова вторичны.",
    trap: "Три причины перемены. Назови одну, иначе в превращение не верят.",
    match: /\b(?:this|that) was\b[^.!?]*[.!?]\s*(?:this|that) is\b|\bbefore\b[^.!?]*\bafter\b|\bi (?:look|looked) back at\b/i,
  },
  {
    id: 14, name: "Обращение к своим", en: "The Callout",
    template: "{Конкретная группа}, это то, что вы всё время откладываете.",
    example: "Фотографы, которые берут меньше 2000 долларов: вот страница с ценами, которую вы избегаете.",
    screen: "ФОТОГРАФЫ ДО $2000",
    use: "Сузить широкую аудиторию до тех, кто действует. Пересылают чаще: люди отмечают друг друга.",
    trap: "Группа настолько большая, что это не обращение. «Предприниматели» — не группа.",
    match: /^\s*(?:every|all|any)\s+\w+|^\s*[a-z][\w ]{2,28}(?:ers|ists|ors|ants)\b\s*[,:]|^\s*for (?:viewers|people|anyone|those|everyone)\b|^\s*(?:attention|listen up)\b/i,
  },
  {
    id: 15, name: "Счёт провалов", en: "The Flop Record",
    template: "Мои первые {N} {попыток} не дали ничего. Вот что изменилось на {N+1}-й.",
    example: "Первые 47 роликов набирали по 300 просмотров. 48-й набрал 400 тысяч. Изменилось одно.",
    screen: "47 ПРОВАЛОВ, ПОТОМ ЭТО",
    use: "Для тех, кто в начале пути, а это большая часть аудитории. Много комментариев.",
    trap: "Перемена звучит как везение. Если ответ «повезло», ролика нет.",
    match: /\bmy first\s+\d+\b|\bfirst\s+\d+\s+(?:reels?|videos?|posts?|clients?|months?)\b/i,
  },
  {
    id: 16, name: "Вопрос слово в слово", en: "The Verbatim Question",
    template: "«{Вопрос ровно так, как его задали}» — мне задают его каждую неделю.",
    example: "«Как выкладывать регулярно и не возненавидеть это?» — спрашивают каждую неделю.",
    screen: "СПРАШИВАЮТ КАЖДУЮ НЕДЕЛЮ",
    use: "Поиск: вопрос в том виде, как его набирают, и есть то, что ищет Instagram.",
    trap: "Причесать вопрос. Ценность — в словах зрителя, с опечатками.",
    match: /^\s*["“']?(?:how|what|what'?s|why|when|where|who|which|can|should|do|does|did|is|are|have you|would you)\b[^?]{3,110}\?/i,
  },
  {
    id: 17, name: "Лоб в лоб", en: "Head To Head",
    template: "{А} против {Б}. Я пробовал оба {столько-то}, и это было даже не близко.",
    example: "Карусели против рилсов. 90 дней пробовал оба — и это даже не близко.",
    screen: "КАРУСЕЛИ vs РИЛСЫ",
    use: "Комментарии: зрители приходят уже со своим мнением.",
    trap: "Не выбрать победителя. Сравнение с дипломатичным концом — ролик без конца.",
    match: /\b(?:vs\.?|versus)\b|\bdifferences? between\b|\b(?:a|the) or (?:b|the)\b/i,
  },
  {
    id: 18, name: "Сразу к делу", en: "Cold Open Demo",
    template: "{Начать посреди действия.} Смотри, что это делает.",
    example: "Смотри, что будет, если вставить сюда подпись конкурента.",
    screen: "СМОТРИ",
    use: "Записи экрана и всё, где виден результат. Никакой подготовки: рука уже в движении.",
    trap: "Результат приходит через двенадцать секунд. Медленную развязку покажи сразу, ожидание — потом.",
    match: /^\s*watch (?:what|this|me)\b|^\s*(?:let me|lemme) show you\b|^\s*repeat after me\b/i,
  },
  {
    id: 19, name: "Срок", en: "The Deadline",
    template: "{Это} меняется {тогда-то}. Успей {сделать} до этого.",
    example: "Обложки в сетке профиля обрежутся, как только выложишь рилс. Сначала поправь их.",
    screen: "ДО СЛЕДУЮЩЕГО ПОСТА",
    use: "Настоящая срочность: изменения площадки, сезон, новые правила.",
    trap: "Выдуманная срочность. Один фальшивый срок — и следующим не верят.",
    match: /\bbefore (?:you|it|they|the)\b[^.!?]*\b(?:change|changes|end|ends|close|closes|expires|goes)\b|\bchanges on\b|\bby 20\d\d\b/i,
  },
  {
    id: 20, name: "Разрешение", en: "Permission",
    template: "Тебе не нужно {то, что все считают обязательным}.",
    example: "Тебе не нужна ниша. Тебе нужен один человек, которого ты можешь назвать по имени.",
    screen: "НИША НЕ НУЖНА",
    use: "Облегчение. Очень много сохранений: формула убирает препятствие, а не добавляет задачу.",
    trap: "Убрать препятствие и ничего не дать взамен. Вторая половина — и есть ролик.",
    match: /\byou (?:do not|don'?t|dont) need\b|\bstop (?:trying to|worrying about)\b/i,
  },
  {
    id: 21, name: "С середины фразы", en: "Mid-Sentence Start",
    template: "{…и вот тогда {поворот}.}",
    example: "…и вот тогда клиент попросил деньги назад. Через три дня после того, как всё одобрил.",
    screen: "ОН ПОТРЕБОВАЛ ВОЗВРАТ",
    use: "Истории. Старт с середины сцены создаёт ощущение, что ты опоздал, — и хочется остаться.",
    trap: "Так и не вернуться к началу. Завязку нужно дать к восьмой секунде, иначе это похоже на ошибку.",
    match: /^\s*(?:\.\.\.|…)|^\s*(?:and (?:that'?s|that is|then) when|so (?:he|she|they) (?:said|asked))\b|^\s*(?:uh|um)\b/i,
  },
  {
    id: 22, name: "Перевёрнутая поговорка", en: "Contrarian Flip",
    template: "{Известная фраза наоборот.}",
    example: "Хорошие парни приходят первыми.",
    screen: "ХОРОШИЕ ПРИХОДЯТ ПЕРВЫМИ",
    use: "Комментарии: зритель останавливается проверить, не ослышался ли.",
    trap: "Перевернуть фразу, которую никто не говорит. Оригинал должен быть на автомате, иначе переворот — просто предложение.",
    match: /^\s*[A-Za-z][\w' ]{2,34}\b(?:finish|finishes|win|wins|lose|loses|beats?|is|are)\s+(?:first|last|dead|wrong|right|better|overrated|underrated)\b/i,
  },
  {
    id: 23, name: "Цифра", en: "The Statistic",
    template: "{N}% {людей} {неожиданный факт}.",
    example: "33% выпускников школ больше никогда не читают книг.",
    screen: "33% НЕ ЧИТАЮТ",
    use: "Пересылки: число, которое можно повторить за ужином, отправляют другу.",
    trap: "Цифра без источника. Назови в ролике, откуда она, или не бери её.",
    match: /^\s*\d[\d,.]*\s?%|\b\d[\d,.]*\s?%\s+of\b/i,
  },
  {
    id: 24, name: "Новинка", en: "The Reveal",
    template: "Это новый {предмет}.",
    example: "Это новая мыльница Sony, и в ней исправили то, что я ненавидел.",
    screen: "НОВИНКА",
    use: "Всё вещественное и видимое. Зацепка — сам предмет, слова — подписи к нему.",
    trap: "Показать вещь и не сказать, что она меняет. Новинка без ставки — реклама.",
    match: /^\s*(?:so,?\s+)?(?:this|these|here) (?:is|are)\s+(?:the\s+)?(?:new|my new)\b|^\s*(?:so,?\s+)?this (?:new|tiny|little)\b|^\s*this \w+ has (?:the|a)\b/i,
  },
  {
    id: 25, name: "Чужой результат", en: "Someone Else's Result",
    template: "Был один {человек}, который {результат} за {срок}.",
    example: "Был один автор, который набрал миллион подписчиков за месяц.",
    screen: "1 МЛН ЗА МЕСЯЦ",
    use: "Доказательство, когда своей цифры ещё нет. Третье лицо можно, если это правда.",
    trap: "Без имени и ссылки. Безымянное чудо — слух.",
    match: /\bthere (?:was|is) (?:one|a|this)\b|\b(?:one|a) (?:guy|girl|creator|student|founder|kid|client|friend) (?:i know |who |that )(?:\w+ed|grew|made|built|went|took|got|hit)\b|\bwe had a new\b/i,
  },
  {
    id: 26, name: "Превосходная степень", en: "The Superlative",
    template: "Самый {быстрый / большой / единственный} {способ} — это {ответ}.",
    example: "Самый быстрый способ стать уверенным — собрать доказательства, с которыми не поспоришь.",
    screen: "САМЫЙ БЫСТРЫЙ СПОСОБ",
    use: "Ролик из одного утверждения, без истории. Самая частая форма в ленте и самая лёгкая, чтобы написать плохо.",
    trap: "Громкое начало и мягкий ответ. Если вторая половина — «регулярность», ты ничего не сказал.",
    match: /^\s*(?:the\s+)?(?:fastest|quickest|best|worst|biggest|greatest|easiest|hardest|only|number one|#1|most important)\s+\w+|\bthe (?:fastest|best|worst|biggest|greatest|only) way to\b/i,
  },
];

/** Порядок разметки из hooks.json: самые узкие формулы раньше общих. */
const CLASSIFY_ORDER = [1, 23, 5, 4, 3, 15, 20, 7, 9, 26, 25, 24, 18, 17, 8, 6, 16, 12, 10, 2, 13, 19, 21, 22, 11, 14];

export const hookById = (id: unknown): HookFormula | undefined => HOOKS.find((h) => h.id === id);

/** Формула англоязычной зацепки по регуляркам репо; null — не размечена (такие строки самые ценные). */
export function classifyHook(text: string): HookFormula | null {
  const line = text.trim();
  if (!line) return null;
  for (const id of CLASSIFY_ORDER) {
    const hook = hookById(id)!;
    if (hook.match.test(line)) return hook;
  }
  return null;
}

/** Формулы для промпта: шаблон, пример, надпись, для чего и где ломается. */
export function hooksForPrompt(): string {
  return HOOKS.map((h) =>
    [`#${h.id} ${h.name} (${h.en})`, `  шаблон: ${h.template}`, `  пример: ${h.example}`, `  на экране: ${h.screen}`, `  для чего: ${h.use}`, `  где ломается: ${h.trap}`].join("\n"),
  ).join("\n");
}
