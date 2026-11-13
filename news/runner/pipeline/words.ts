// Слова-числа в речи: по ним число на экране встаёт на то слово, где оно звучит (режиссёр часто промахивается номером
// слова на одно-два), а итог графика «Опуса» — на слово с суммой. Идея привязки каждого появления к слову голоса — из
// video-talkcraft (там время любого движения берётся из разметки слов, а не на глаз); код свой.
import type { Word } from "../../engine/src/plan";

// слова целиком, с окончаниями: «сто», но не «стоил»; «семь», но не «семья»
const NUMERAL = new RegExp(
  "^(ноль|нуля|один|одна|одно|одного|одной|одну|два|две|двух|двумя|три|тр[её]х|тремя|четыре|четыр[её]х|пять|пяти|шесть|шести|семь|семи|восемь|восьми|девять|девяти|десять|десяти" +
    "|(один|две|три|четыр|пят|шест|сем|восем|девят)надцат[ьи]|двадцат[ьи]|тридцат[ьи]|сорок|сорока|(пять|шесть|семь|восемь)десят|(пяти|шести|семи|восьми)десяти|девяност[оа]" +
    "|сто|ста|двести|двухсот|триста|тр[её]хсот|четыреста|(пять|шесть|семь|восемь|девять)сот|полтора|полторы|полутора" +
    "|тысяч(а|и|у|е|ей|ью|ам|ами|ах)?|миллион(а|ов|ы|у|е|ам|ами|ах)?|миллиард(а|ов|ы|у|е|ам|ами|ах)?|триллион(а|ов|ы)?|млн|млрд|тыс)$",
);
const SCALE: [RegExp, number][] = [[/^(тысяч|тыс)/, 1e3], [/^(миллион|млн)/, 1e6], [/^(миллиард|млрд)/, 1e9], [/^триллион/, 1e12]];

const bare = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{N}.,]/gu, "").replace(/^[.,]+|[.,]+$/g, "");

/** Слово — часть числа: цифры («105», «7,5», «$80») или числительное («сто», «тысяч», «миллионов»). */
export function isNumeric(word: string): boolean {
  const b = bare(word);
  return /\d/.test(b) || NUMERAL.test(b);
}

/** Числа в речи: подряд идущие слова-числа, [первое, последнее] по номерам слов. */
export function numberRuns(words: Word[]): [number, number][] {
  const runs: [number, number][] = [];
  words.forEach((w, i) => {
    if (!isNumeric(w.w)) return;
    const last = runs[runs.length - 1];
    if (last && last[1] === i - 1) last[1] = i;
    else runs.push([i, i]);
  });
  return runs;
}

/** Величина числа, если оно сказано цифрами («105 миллионов», «7 200»); числительные словами — NaN. */
export function runValue(words: Word[], [a, b]: [number, number]): number {
  let total = 0;
  let cur = NaN;
  let seen = false;
  for (let i = a; i <= b; i++) {
    const w = bare(words[i].w);
    if (/\d/.test(w)) {
      const d = w.replace(/[^\d.,]/g, "");
      // «7,5» и «7.5» — дробь; «7.200» и «7,200» с тремя знаками после знака — разряды
      const n = Number(/[.,]\d{3}$/.test(d) ? d.replace(/[.,]/g, "") : d.replace(",", "."));
      // «7 200» двумя словами — одно число; «8 тыс. 900» — девятьсот прибавляются к тысячам
      cur = Number.isFinite(cur) && /^\d{3}$/.test(d) ? cur * 1000 + n : n;
      seen = true;
    } else {
      const k = SCALE.find(([re]) => re.test(w))?.[1];
      // числительное словом («сто», «пять») величины не даёт
      if (!k) return NaN;
      total += (Number.isFinite(cur) ? cur : 1) * k;
      cur = NaN;
    }
  }
  return seen ? total + (Number.isFinite(cur) ? cur : 0) : NaN;
}

/**
 * Номер слова, с которого звучит число value: сначала ищем рядом (±reach слов) число той же величины, потом ближайшее
 * слово-число; не нашлось — номер режиссёра как есть. Возвращает начало числа: «сто пять миллионов» — слово «сто».
 */
export function snapToNumber(words: Word[], w: number, value: number, reach = 4): number {
  const near = numberRuns(words).filter(([a, b]) => a <= w + reach && b >= w - reach);
  if (!near.length) return w;
  const dist = ([a, b]: [number, number]) => (w < a ? a - w : w > b ? w - b : 0);
  const same = near.filter((r) => {
    const v = runValue(words, r);
    return Number.isFinite(v) && v > 0 && Math.abs(Math.log10(v / Math.max(1e-9, Math.abs(value)))) < 0.03;
  });
  const pick = [...(same.length ? same : near)].sort((x, y) => dist(x) - dist(y))[0];
  // без совпадения по величине доверяем режиссёру, пока он сам стоит на числе или в двух словах от него
  if (!same.length && dist(pick) > 2) return w;
  return pick[0];
}
