/**
 * Стили кнопки «Создать» (владелец 01.11: «оставить все стили и дать выбор»). «Расследование» — прежний формат
 * раздела (9 слайдов со скриншотами статей), остальные шесть собраны по образцам владельца. Файл без серверных
 * зависимостей: его читает и страница, и сервер.
 */
export const STYLE_IDS = ["investigation", "urgent", "toolkit", "market", "cartoon", "cinema", "dispute"] as const;
export type StyleId = (typeof STYLE_IDS)[number];

export type StyleInfo = { id: StyleId; name: string; blurb: string };

export const STYLES: StyleInfo[] = [
  { id: "investigation", name: "Расследование", blurb: "9 слайдов: история по шагам, у каждого шага скриншот статьи и цифры" },
  { id: "urgent", name: "Срочно", blurb: "Новость дня на 3 репортажных фото с короткими фразами" },
  { id: "toolkit", name: "Подборка", blurb: "Полезные сайты и сервисы к свежему случаю, со скриншотами" },
  { id: "market", name: "Рынок", blurb: "8 слайдов: сводка на обложке, дальше по одной компании или монете с цифрой" },
  { id: "cartoon", name: "Мульт", blurb: "4 слайда: монетки-персонажи в мультяшных сценах и цифры" },
  { id: "cinema", name: "Кино", blurb: "Одна большая сумма на кадре с биржи и тепловая карта рынка" },
  { id: "dispute", name: "Разбор", blurb: "Спор двух сторон через их настоящие посты и схема, как это устроено, 5–6 слайдов" },
];

export const DEFAULT_STYLE: StyleId = "investigation";
export const isStyleId = (v: unknown): v is StyleId => typeof v === "string" && (STYLE_IDS as readonly string[]).includes(v);
export const styleName = (id: StyleId | undefined) => STYLES.find((s) => s.id === (id ?? DEFAULT_STYLE))?.name ?? "Расследование";
