// Раскладка плана на общую ленту — без React: её считает и движок (Main.tsx), и проверка готового ролика на ПК
// (runner/pipeline/qc.ts), поэтому время каждой вставки у них одно и то же.
import type { Look, NewsPlan, Segment, Word } from "./plan";

export const FPS = 30;
// прежняя высота: план без поля subLow (ролик до 7.11) при перемонтаже остаётся как был
const SUB_LOW_BEFORE = 1190;
export const FX_FRAMES = 33;
// петля (владелец 29.10: «петля круто, если сможешь»): в последние LOOP_FRAMES кадров зелёная вспышка собирается обратно и
// к последнему кадру закрывает экран целиком — как первый кадр ролика, поэтому на повторе склейки не видно
export const LOOP_FRAMES = 16;
export const HERO_COLOR = "#FFE14D";
// владелец 28.10: «в конце кусочек на 1 сек лишний» — ролик кончается через END_AIR после последнего слова
const END_AIR = 0.25;
/**
 * Вставка начинает приход за два кадра до своего слова (fx.wordLead): приход замедляется и большую часть пути проходит
 * за первые 4 кадра, поэтому к началу слова она уже почти на месте. Вставка, которая только трогается на слове, читается
 * как опоздавшая; на два кадра раньше — как одновременно со словом (motionmaxxing sound-sync, разбор 50 роликов).
 */
export const WORD_LEAD = 2 / FPS;

export const fr = (s: number) => Math.round(s * FPS);

export type Placed = { seg: Segment; start: number; dur: number };
export type Sub = { text: string; from: number; to: number; y: number; color: string };

/** Раскладка плана на общую ленту: где начинается каждый кусок, когда звучит каждое слово. */
export function layout(plan: NewsPlan) {
  const len = (id: string) => plan.lines[id].end + 0.12;
  // last — последний кусок ролика: без запаса в конце, ролик кончается, когда договорил последний (to героя исполнитель ставит в паузу после её фразы)
  const segDur = (seg: Segment, last: boolean) => {
    if ("narr" in seg) return plan.lines[seg.narr].end + (last ? END_AIR : 0.12);
    if ("orig" in seg) return seg.to - seg.from;
    const spoken = Math.max(...seg.lines.map((l) => l.at + plan.lines[l.id].end));
    return Math.max(seg.to - seg.from, spoken + (last ? END_AIR : 0.37));
  };
  const placed: Placed[] = [];
  let t = 0;
  for (const [i, seg] of plan.segments.entries()) {
    const dur = segDur(seg, i === plan.segments.length - 1);
    placed.push({ seg, start: t, dur });
    t += dur;
  }
  const total = fr(t) + LOOP_FRAMES;
  const lineStart = (id: string) => {
    for (const p of placed) {
      if ("narr" in p.seg && p.seg.narr === id) return p.start;
      if ("dub" in p.seg) for (const l of p.seg.lines) if (l.id === id) return p.start + l.at;
    }
    return 0;
  };
  const words = (id: string) => plan.lines[id].words as Word[];
  const hits = plan.hits.filter((h) => plan.lines[h.line] && words(h.line)[h.w]).map((h) => ({ ...h, t: lineStart(h.line) + words(h.line)[h.w].s }));
  // владелец появляется на своём слове, но не раньше, чем кончится зелёная вспышка первой секунды (владелец 29.10: «я
  // выхожу раньше, чем уходит зелёная заставка, нужно после неё прям»; runner/pipeline/peek.ts берёт те же кадры)
  const peeks = (plan.peeks ?? (plan.peek ? [plan.peek] : []))
    .filter((p) => plan.lines[p.line] && words(p.line)[p.w])
    .map((p) => ({ ...p, t: Math.max(FX_FRAMES / FPS, lineStart(p.line) + words(p.line)[p.w].s) }));
  // субтитры по слову: рассказчик белым, перевод героя жёлтым; пока владелец снизу — над его головой
  const subs: Sub[] = [];
  const push = (id: string, at: number, yOf: (i: number) => number) => {
    const list = words(id);
    const color = plan.lines[id].speaker === "hero" ? HERO_COLOR : "#fff";
    list.forEach((w, i) => {
      // точка и запятая между цифрами остаются: «Opus 5.5» не превращается в «55»; латинские названия пишутся как есть
      // («Claude Opus 5.5», «ZeniMax», «X» — владелец 4.11 о Fallout: «нужно же OPUS 5.5»), русские сокращения тоже
      // («МВД», «ФСБ», «США» — не «мвд»), остальные русские слова — строчными
      const bare = w.w.replace(/[«»"“”„:;!?…()]|(?<!\d)[.,]|[.,](?!\d)/g, "");
      const text = /[A-Za-z]/.test(bare) || /^[А-ЯЁ]{2,5}(-[а-яё]+)?$/.test(bare) ? bare : bare.toLowerCase();
      if (!text || text === "—") return;
      const next = list[i + 1];
      const from = at + w.s;
      const under = peeks.find((p) => !p.arrow && from < p.t + p.dur && from + 0.3 > p.t);
      subs.push({ text, from, to: at + (next ? next.s : w.e + 0.12), y: under ? Math.min(yOf(i), under.fig.y - 140) : yOf(i), color });
    });
  };
  const subLow = plan.subLow ?? SUB_LOW_BEFORE;
  for (const p of placed) {
    const seg = p.seg;
    if ("narr" in seg) push(seg.narr, p.start, (i) => ([...seg.shots].reverse().find((s) => s.w <= i) ?? seg.shots[0])?.subY ?? subLow);
    if ("dub" in seg) seg.lines.forEach((l) => push(l.id, p.start + l.at, () => l.subY ?? subLow));
  }
  // вставка не раньше, чем уйдёт зелёная заставка: конец остаётся на месте (владелец 31.10: «тикток вышел раньше, чем
  // закончилась начальная заставка»); и не на видеомеме — кончается, где он начинается (владелец 1.11 о «Зондбе»: «следом
  // видео мем, а лого перекрывает»)
  const memes = placed.filter((p) => "orig" in p.seg && p.seg.orig.startsWith("vm_")).map((p) => [p.start, p.start + p.dur]);
  const fit = (t: number, dur: number) => {
    if (memes.some(([a, b]) => t >= a - 0.05 && t < b)) return 0;
    const next = memes.find(([a]) => a > t);
    return next ? Math.min(dur, next[0] - t) : dur;
  };
  // word — секунда самого слова, asked — длина, которую просил план: по ним проверка видит, что вставку сдвинула заставка
  // или обрезал видеомем. Конец вставки от опережения не меняется
  const lead = plan.fx?.wordLead ? WORD_LEAD : 0;
  const inserts = (plan.inserts ?? []).filter((x) => plan.lines[x.line] && words(x.line)[x.w]).flatMap((x) => {
    const at = lineStart(x.line) + words(x.line)[x.w].s;
    const t = Math.max(FX_FRAMES / FPS, at - lead);
    const dur = fit(t, x.dur - (t - at));
    return dur > 0.2 ? [{ ...x, t, dur, word: at, asked: x.dur }] : [];
  });
  // обводка нарисована по месту детали на своём плане: когда план сменился, она обводила бы пустое место чужого кадра
  // (ролик про SLINK: овал вокруг суммы секунду висел на следующем посте) — кончается за кадр до смены плана
  const shotEnd = (line: string, w: number) => {
    const p = placed.find((q) => "narr" in q.seg && q.seg.narr === line);
    if (!p || !("narr" in p.seg)) return Infinity;
    const next = p.seg.shots.find((s) => s.w > w);
    return next ? p.start + words(line)[next.w].s - 0.05 : p.start + p.dur;
  };
  // в кадрах, как считает движок: обводка кончается за кадр до смены плана, округление секунд её на чужой план не вынесет
  const framesTill = (end: number, t: number) => (fr(end) - fr(t) - 0.6) / FPS;
  const overlays = (plan.overlays ?? []).filter((x) => plan.lines[x.line] && words(x.line)[x.w]).flatMap((x) => {
    const at = lineStart(x.line) + words(x.line)[x.w].s;
    const t = Math.max(FX_FRAMES / FPS, at - lead);
    const room = x.kind === "mark" && plan.fx?.wordLead ? framesTill(shotEnd(x.line, x.w), t) : Infinity;
    const dur = Math.min(room, fit(t, x.dur - (t - at)));
    return dur > 0.3 ? [{ ...x, t, dur, word: at, asked: x.dur }] : [];
  });
  // чем кончается каждый кусок — тот кадр продолжается под видеомемом, который идёт поверх ролика
  const tails = placed.map((p): Look => {
    const seg = p.seg;
    if ("orig" in seg) return { clip: seg.orig, at: seg.to };
    if ("dub" in seg) return { clip: seg.dub, at: seg.from + p.dur };
    const list = words(seg.narr);
    const sh = seg.shots[seg.shots.length - 1];
    const start = sh.w === 0 ? 0 : list[sh.w].s - 0.05;
    const length = p.dur - start;
    const at = sh.endAt !== undefined ? Math.max(0, sh.endAt - length) : sh.maxAt !== undefined ? Math.max(0, Math.min(sh.at ?? 0, sh.maxAt - length)) : (sh.at ?? 0);
    return sh.still ? { still: sh.still } : { clip: sh.clip, at: at + length };
  });
  return { placed, total, len, words, hits, subs, peeks, inserts, overlays, tails, cuts: placed.slice(1).map((p) => p.start) };
}
