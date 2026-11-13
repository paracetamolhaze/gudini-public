import ts from "typescript";
import channel from "../src/channel.json";

const BLOCKS = new Set(["Sketch", "Actor", "Panel", "Prop", "Shot", "Act", "Face", "Look", "Move", "Light", "Pop", "Channel", "Screen", "React.Fragment"]);
/** The two screens of the room a Screen draws on, and what they show (src/kit/ScreenApps.ts). */
export const SURFACES: Record<string, string> = { monitor: "главном мониторе", vertical: "вертикальном экране" };
export const SCREEN_APPS = ["chat", "chart", "feed", "wallet", "news", "position"];
/**
 * How long things last so the viewer reads them (the owner, 2026-10-23: «зачем эмоция у Клода на долю секунды»):
 * any shot, a reaction shot with an icon, the icon itself, a mood on a face.
 */
export const MIN_SHOT = 1.5;
export const MIN_REACTION_SHOT = 1.8;
export const POP_SECONDS_RANGE: [number, number] = [1.6, 2.5];
export const MIN_MOOD = 1.2;
/**
 * The cut follows the voice (the owner, 2026-10-23: «иногда кадры очень быстро меняются, либо когда говорит один —
 * кадр на другом»): a line up to LONG_LINE seconds is one shot, and a single shot shows whoever speaks in it.
 */
export const LONG_LINE = 6;
/** Seconds of the other hero's voice a single shot may carry: the cut 0.1 s ahead of a line and a word's tail. */
export const LISTENER_SLACK = 0.4;
/** How far inside a line a cut counts as cutting it rather than landing on its edge. */
const CUT_MARGIN = 0.3;
const TRENDS = ["up", "down", "pump", "dump", "flat"];
/**
 * The opening of every sketch (10.11.2026): the face of whoever says the first line. The audit of 23 sketches: the dark
 * desk shot with the heroes a few pixels tall was the first frame of each, and 59% of YouTube viewers swiped away.
 */
export const FACE_OPENING = `<Shot from={0} to={…} on="…" kind="close" move="push" /> на того, кто говорит первую реплику, с его лицом (<Face from={0} …>) — зритель с первого кадра видит героя и его чувство и остаётся смотреть`;
/** The whole desk, both heroes on the keyboard, both monitors on their arm: once at most, after the opening. */
export const DESK_SECONDS: [number, number] = [1.5, 2.6];
/** Seconds the channel card stays: long enough to scan the QR, short enough not to hide the room. */
export const CHANNEL_SECONDS: [number, number] = [4, 12];
const FORBIDDEN = new Set(["fetch", "eval", "Function", "require", "XMLHttpRequest", "WebSocket", "window", "document", "globalThis", "process", "navigator", "localStorage", "sessionStorage", "setTimeout", "setInterval", "Date"]);
const TIME_PROPS = new Set(["from", "to", "at", "for"]);

/** The permanent room (scene-layout.json): cameras, windows and props are measured from these places. */
export const ACTOR_PLACES: Record<string, [number, number]> = { me: [-2.24, 0.56], claude: [2.24, 0.56] };
/**
 * Camera sides of each hero's single shots that keep the face readable and a screen of the room behind him
 * (measured in shots.test.ts). The owner turns his head to Claude, so only his one side sees the face against
 * the vertical screen; Claude has his chat (no side) and the glass PC ("right").
 */
export const SOLO_SIDES: Record<string, string[]> = { me: [], claude: ["right"] };
/**
 * How far a hero steps along his own row of keys (the kit's STEP_RANGE in src/kit/timeline.tsx): z stays at his
 * place. Within it every single shot still sees his face against a screen of the room (shots.test.ts).
 */
export const STEP_X: Record<string, [number, number]> = { me: [-3, -1], claude: [1, 8] };
const ru = (n: number) => String(n).replace("-", "−").replace(".", ",");
/** A line that is only a multiplier, like «x100» or «100x!»: the punchline callout the owner refused. */
const CALLOUT = /^[\s"«»]*(?:[xх×]\s?\d[\d\s.,]*|\d[\d\s.,]*\s?[xх×])[!?.]*[\s"«»]*$/i;
const SIDE_HINT: Record<string, string> = {
  me: "у владельца одна сторона камеры — без side: он смотрит на Клода, и его лицо читается в три четверти на фоне вертикального экрана; его планы разнообразит крупность (close, medium, wide, low, high)",
  claude: "у Клода две стороны: без side он перед своим чатом на мониторе, с side=\"right\" — лицом к камере на фоне стеклянного компьютера",
};
/**
 * What a shot shows once the kit draws it (shotPicture in src/kit/Camera.tsx): the owner has one camera side and his
 * over-the-shoulder is his close-up; Claude has his chat and, from his allowed side, the PC, and his over is that PC
 * close-up. Two shots in a row with the same picture are one picture cut in two.
 */
export const shotPicture = (on: string, kind: string, side?: string): string => {
  const sides = SOLO_SIDES[on];
  if (!sides) return `${on}|${kind}|`;
  const over = kind === "over";
  const face = over ? sides.length > 0 : !!side && sides.includes(side);
  return `${on}|${over ? "close" : kind}|${face ? "face" : ""}`;
};
/** Anchored windows measured against the room's cameras: above the subtitle line in the actor's own shots. */
export const WINDOW_PLACES: Record<string, string> = { me: "depth={8} height={5.5} size={2}", claude: "depth={9} height={4.2} size={2.4}" };
// key tops (y = 0) reach this far from the keyboard centre; past them the desk is 1.1 lower
const KEYS = { x: 8.3, z: 3.3 };
const onKeys = (x: number, z: number) => Math.abs(x) <= KEYS.x && Math.abs(z) <= KEYS.z;
const isNums = (v: unknown, n: number): v is number[] => Array.isArray(v) && v.length === n && v.every((x) => typeof x === "number");

export type SceneFacts = { duration: number; cast: string[]; lines: { who: string; start: number; end: number; text?: string }[] };

type Attr = { name: string; value: unknown; literal: boolean };
type Element = { tag: string; attrs: Map<string, Attr>; line: number };

/** Value of a literal expression: numbers, strings, booleans, arrays of them; `literal` false otherwise. */
const literalOf = (node: ts.Expression): { value: unknown; literal: boolean } => {
  if (ts.isNumericLiteral(node)) return { value: Number(node.text), literal: true };
  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(node.operand)) return { value: -Number(node.operand.text), literal: true };
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return { value: node.text, literal: true };
  if (node.kind === ts.SyntaxKind.TrueKeyword) return { value: true, literal: true };
  if (node.kind === ts.SyntaxKind.FalseKeyword) return { value: false, literal: true };
  if (ts.isArrayLiteralExpression(node)) {
    const items = node.elements.map((e) => literalOf(e));
    return { value: items.map((i) => i.value), literal: items.every((i) => i.literal) };
  }
  if (ts.isParenthesizedExpression(node)) return literalOf(node.expression);
  return { value: undefined, literal: false };
};

/** The shots of a scene in time order, read from the code's JSX. */
export function sceneShots(code: string): { from: number; to: number; on: string; kind: string; move: string }[] {
  const sf = ts.createSourceFile("Scene.tsx", code, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
  const out: { from: number; to: number; on: string; kind: string; move: string }[] = [];
  const visit = (node: ts.Node) => {
    if ((ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) && node.tagName.getText() === "Shot") {
      const v: Record<string, unknown> = {};
      for (const prop of node.attributes.properties) {
        if (!ts.isJsxAttribute(prop) || !prop.initializer) continue;
        const init = prop.initializer;
        v[prop.name.getText()] = ts.isStringLiteral(init) ? init.text : ts.isJsxExpression(init) && init.expression ? literalOf(init.expression).value : undefined;
      }
      if (typeof v.from === "number" && typeof v.to === "number") out.push({ from: v.from, to: v.to, on: String(v.on ?? ""), kind: String(v.kind ?? ""), move: String(v.move ?? "still") });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out.sort((a, b) => a.from - b.from);
}

/**
 * Checks the director's Scene.tsx before it is typechecked and rendered. Every problem is a sentence
 * the director can act on; an empty list means the scene may go to the draft.
 */
export function analyzeScene(code: string, facts: SceneFacts): string[] {
  const problems: string[] = [];
  const sf = ts.createSourceFile("Scene.tsx", code, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
  const elements: Element[] = [];
  let exported = false;
  const lineOf = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart()).line + 1;

  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node)) {
      const from = (node.moduleSpecifier as ts.StringLiteral).text;
      if (from !== "react" && from !== "../kit") problems.push(`строка ${lineOf(node)}: импорт только из "react" и "../kit", а не из "${from}"`);
    }
    if (ts.isVariableStatement(node) && node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) {
      if (node.declarationList.declarations.some((d) => ts.isIdentifier(d.name) && d.name.text === "Scene")) exported = true;
    }
    if (ts.isIdentifier(node) && FORBIDDEN.has(node.text) && !(ts.isPropertyAccessExpression(node.parent) && node.parent.name === node)) {
      problems.push(`строка ${lineOf(node)}: ${node.text} в сцене не нужен — сцена только описывает кадр`);
    }
    if (ts.isPropertyAccessExpression(node) && node.getText() === "Math.random") problems.push(`строка ${lineOf(node)}: Math.random даёт разные кадры в разных вкладках рендера`);
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) problems.push(`строка ${lineOf(node)}: динамический import не нужен`);
    if (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) {
      const tag = node.tagName.getText();
      if (!BLOCKS.has(tag)) problems.push(`строка ${lineOf(node)}: <${tag}> нет в наборе 3Д`);
      const attrs = new Map<string, Attr>();
      for (const prop of node.attributes.properties) {
        if (!ts.isJsxAttribute(prop)) {
          problems.push(`строка ${lineOf(prop)}: пропсы пишутся явно, без {...spread}`);
          continue;
        }
        const name = prop.name.getText();
        const init = prop.initializer;
        if (!init) attrs.set(name, { name, value: true, literal: true });
        else if (ts.isStringLiteral(init)) attrs.set(name, { name, value: init.text, literal: true });
        else if (ts.isJsxExpression(init) && init.expression) attrs.set(name, { name, ...literalOf(init.expression) });
      }
      elements.push({ tag, attrs, line: lineOf(node) });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);

  if (!exported) problems.push("нужен export const Scene = () => (<Sketch>…</Sketch>)");
  if (!elements.some((e) => e.tag === "Sketch")) problems.push("всё внутри одного <Sketch>");
  const num = (e: Element, name: string) => (typeof e.attrs.get(name)?.value === "number" ? (e.attrs.get(name)!.value as number) : undefined);
  const str = (e: Element, name: string) => (typeof e.attrs.get(name)?.value === "string" ? (e.attrs.get(name)!.value as string) : undefined);
  const D = facts.duration;

  for (const e of elements) {
    // the owner (2026-10-23): «окошко вышло отдельно, летает просто как эмоция»
    if (e.tag === "Panel") {
      problems.push(`строка ${e.line}: окон в воздухе в ролике нет — без рамки и подставки окно летает как значок эмоции. Факт истории покажи на экране за тем, кто о нём говорит: <Screen on="vertical" …> за владельцем или <Screen on="monitor" …> за Клодом — позиция (app="position"), курс (chart), кошелёк (wallet), пост (feed), заголовок (news)`);
      continue;
    }
    for (const [name, a] of e.attrs) {
      if ((TIME_PROPS.has(name) || ["size", "turn"].includes(name)) && (!a.literal || (name !== "at" && typeof a.value !== "number"))) {
        problems.push(`строка ${e.line}: ${e.tag} ${name} — число прямо в коде`);
      }
    }
    const from = num(e, "from");
    const to = num(e, "to");
    if (from !== undefined && to !== undefined && to <= from) problems.push(`строка ${e.line}: ${e.tag} — to должен быть больше from`);
    if (from !== undefined && (from < 0 || from > D)) problems.push(`строка ${e.line}: ${e.tag} from=${from} вне ролика 0–${D.toFixed(2)}`);
    if (to !== undefined && to > D + 0.05) problems.push(`строка ${e.line}: ${e.tag} to=${to} позже конца ролика ${D.toFixed(2)}`);
    for (const key of ["who", "held", "id", "behind", "near"]) {
      const v = str(e, key);
      if (v !== undefined && !facts.cast.includes(v)) problems.push(`строка ${e.line}: ${e.tag} ${key}="${v}" — такого персонажа нет (${facts.cast.join(", ")})`);
    }
    if (e.tag === "Shot") {
      const on = str(e, "on");
      // the owner (2026-10-22): no shot of the whole room - the heroes are always the picture
      const kind = str(e, "kind");
      if (on === "world" || kind === "tiny") problems.push(`строка ${e.line}: плана всей комнаты в ролике нет — комната видна за героями; для двоих бери on="both" kind="wide"`);
      else if (on !== undefined && on !== "both" && !facts.cast.includes(on)) problems.push(`строка ${e.line}: Shot on="${on}" — нужен ${facts.cast.join(", ")} или both`);
      if (on === "both" && kind && !["wide", "low", "high", "tiny", "desk"].includes(kind)) problems.push(`строка ${e.line}: Shot on="both" бывает только wide, low или high — для ${kind} выбери одного персонажа`);
      if (kind === "desk" && on !== "both") problems.push(`строка ${e.line}: общий план стола показывает обоих: on="both" kind="desk"`);
      // the owner (2026-10-22): no profile shots, no bare pink wall behind him (shots.test.ts measures each side)
      const side = str(e, "side");
      if (kind === "over") {
        problems.push(`строка ${e.line}: план из-за плеча смотрит вдоль героев на голую стену комнаты или пустоту её открытой стороны — вопрос в лоб снимай close на того, кто его слышит, с move="push": за владельцем вертикальный экран, за Клодом его чат`);
      } else if (side && on === "both") {
        problems.push(`строка ${e.line}: общий план на двоих снимается спереди, без side — сбоку один из героев отворачивается затылком`);
      } else if (side && on && SOLO_SIDES[on] && !SOLO_SIDES[on].includes(side)) {
        problems.push(`строка ${e.line}: Shot on="${on}" side="${side}" показывает лицо в профиль или голую стену за спиной — ${SIDE_HINT[on]}`);
      }
    }
    if (e.tag === "Prop" && str(e, "kind") === "sign") {
      problems.push(`строка ${e.line}: табличек со словами в кадре нет (владелец: «не нужно ничего так показывать») — слово-итог и громкие цифры звучат в реплике и видны в субтитрах, а в кадре остаются лица, жесты и вещи истории`);
    }
    // the owner (2026-10-22): «снова посередине что-то вставил … ни табличку, ни графики, ничего такого»
    if (e.tag === "Prop" && (e.attrs.has("at") || e.attrs.has("near"))) {
      problems.push(`строка ${e.line}: Prop стоит на клавиатуре — между героями и рядом с ними ничего не ставим (владелец: «ни табличку, ни графики, ничего такого»); вещь истории живёт только в руке: held="me" или held="claude"`);
    }
    if (e.tag === "Prop" && str(e, "kind") === "chart") {
      problems.push(`строка ${e.line}: графиков в кадре нет (владелец: «ни графики») — рост и падение звучат в реплике, видны на лицах и в строках окна`);
    }
    if (e.tag === "Panel" && str(e, "tone") === "chart") {
      problems.push(`строка ${e.line}: окно с графиком — тоже график (владелец: «ни графики»): окно несёт строки с цифрами, tone "terminal", "alert" или "wallet"`);
    }
    if (e.tag === "Panel" && e.attrs.has("at") && !e.attrs.has("behind")) {
      problems.push(`строка ${e.line}: окно посередине между героями — то, что владелец просил не вставлять; окно висит за спиной героя: behind="me" или behind="claude"`);
    }
    if (e.tag === "Panel") {
      const lines = e.attrs.get("lines")?.value;
      const texts = [str(e, "title"), ...(Array.isArray(lines) ? lines : [])].filter((x): x is string => typeof x === "string");
      const callout = texts.find((x) => CALLOUT.test(x));
      if (callout !== undefined) {
        problems.push(`строка ${e.line}: окно Panel со строкой «${callout.trim()}» — та же табличка со словом-итогом (владелец: «не нужно ничего так показывать»). Окна несут рабочие факты истории: курс, транзакции, строки кошелька; множитель и панчлайн звучат в реплике и видны в субтитрах`);
      }
    }
    if (e.tag === "Channel") {
      const len = from !== undefined && to !== undefined ? to - from : undefined;
      if (len === undefined) {
        problems.push(`строка ${e.line}: Channel — нужны from и to: карточка канала висит от начала реплики владельца про его канал до конца ответа на неё`);
      } else if (len < CHANNEL_SECONDS[0]) {
        problems.push(`строка ${e.line}: карточка канала на экране ${len.toFixed(1)} с — QR не успеют отсканировать; держи её 5–8 с: от начала реплики владельца про канал до конца ответа на неё`);
      } else if (len > CHANNEL_SECONDS[1]) {
        problems.push(`строка ${e.line}: карточка канала на экране ${len.toFixed(1)} с и надолго закрывает верх кадра — 5–8 с хватает, чтобы отсканировать QR`);
      }
    }
    if (e.tag === "Screen") {
      const on = str(e, "on");
      const app = str(e, "app");
      const title = str(e, "title");
      const lines = e.attrs.get("lines")?.value;
      const texts = Array.isArray(lines) && lines.every((x) => typeof x === "string") ? (lines as string[]) : null;
      if (!on || !SURFACES[on]) problems.push(`строка ${e.line}: Screen on — "monitor" (монитор с чатом за героями) или "vertical" (вертикальный экран за владельцем)`);
      if (!app || !SCREEN_APPS.includes(app)) problems.push(`строка ${e.line}: Screen app — одно из ${SCREEN_APPS.join(", ")}`);
      if (from === undefined || to === undefined) problems.push(`строка ${e.line}: Screen — нужны from и to: картинка стоит на экране, пока о ней идёт речь`);
      if (!title) problems.push(`строка ${e.line}: Screen title — заголовок картинки: вопрос в чате, пара на бирже, имя канала, кошелька или сайта`);
      else if (title.length > 80) problems.push(`строка ${e.line}: Screen title длиной ${title.length} знаков — до 80, как настоящий заголовок`);
      if (lines !== undefined && !texts) problems.push(`строка ${e.line}: Screen lines — массив строк в кавычках`);
      const long = texts?.find((x) => x.length > 90);
      if (long) problems.push(`строка ${e.line}: строка экрана «${long.slice(0, 30)}…» длиннее 90 знаков — экран фоновый, строки короткие`);
      if (app === "chart") {
        if (!TRENDS.includes(str(e, "trend") ?? "")) problems.push(`строка ${e.line}: Screen app="chart" — нужен trend: ${TRENDS.join(", ")} (куда идёт цена в истории)`);
        if (!texts || texts.length < 2) problems.push(`строка ${e.line}: Screen app="chart" — lines={["цена", "изменение"]}, например lines={["64 210", "−8,4%"]}`);
      }
      if (app === "chat" && (!texts || !texts.length)) problems.push(`строка ${e.line}: Screen app="chat" — title: вопрос владельца Клоду, lines: ответ Клода в 1–3 строки`);
      if ((app === "feed" || app === "news" || app === "wallet" || app === "position") && (!texts || texts.length < 2)) problems.push(`строка ${e.line}: Screen app="${app}" — нужно 2–6 строк в lines`);
      // the owner's real deals are in his channel; a feed on the screen would put invented ones in his name
      if (app === "feed" && title && [channel.tag, channel.name].some((x) => title.toLowerCase().includes(x.toLowerCase()))) {
        problems.push(`строка ${e.line}: лента «${title}» — это канал владельца, и его настоящие сделки зритель увидит в самом канале; в ролике его канал — карточка <Channel>. Лента на экране — канал из истории: курс-продавец, «сигналы», новости`);
      }
    }
    if (e.tag === "Pop") {
      const at = num(e, "at");
      if (at === undefined || at < 0 || at > D) problems.push(`строка ${e.line}: Pop at — секунда внутри ролика`);
      const len = num(e, "for");
      if (len !== undefined && (len < POP_SECONDS_RANGE[0] || len > POP_SECONDS_RANGE[1])) problems.push(`строка ${e.line}: значок на ${ru(len)} с — ему нужно ${ru(POP_SECONDS_RANGE[0])}–${ru(POP_SECONDS_RANGE[1])} с: зритель успевает увидеть его и лицо героя`);
    }
    if (e.tag === "Face" && from !== undefined && to !== undefined && str(e, "mood") !== "neutral" && to - from < MIN_MOOD) {
      problems.push(`строка ${e.line}: настроение ${str(e, "mood")} на ${ru(Math.round((to - from) * 100) / 100)} с — эмоция на долю секунды не читается; держи её от ${ru(MIN_MOOD)} с, лучше весь план`);
    }
    if (e.tag === "Actor") {
      const at = e.attrs.get("at")?.value;
      const id = str(e, "id");
      const place = id ? ACTOR_PLACES[id] : undefined;
      if (!isNums(at, 2)) problems.push(`строка ${e.line}: Actor at={[x, z]} — два числа`);
      else if (place && (Math.abs(at[0] - place[0]) > 0.01 || Math.abs(at[1] - place[1]) > 0.01)) {
        problems.push(`строка ${e.line}: Actor id="${id}" стоит на своём постоянном месте комнаты at={[${place.join(", ")}]} — от него отмерены камеры, окна и предметы`);
      }
      // the owner (2026-10-22): another turn shows his profile against the bare wall
      if (e.attrs.has("facing")) {
        problems.push(`строка ${e.line}: Actor facing не нужен — герои сами стоят друг к другу в три четверти, от этого поворота отмерены камеры и экраны за спиной; куда повернуть голову — Look`);
      }
    }
    if (e.tag === "Move") {
      // actors stand at y = 0: off the key tops they would hang 1.1 above the desk
      const place = e.attrs.get("place")?.value;
      const who = str(e, "who");
      const home = who ? ACTOR_PLACES[who] : undefined;
      const reach = who ? STEP_X[who] : undefined;
      if (isNums(place, 2) && !onKeys(place[0], place[1])) {
        problems.push(`строка ${e.line}: Move place={[${place.join(", ")}]} уводит героя с клавиш, и он повиснет над столом — место на клавишах: x от −8 до 8, z от −3 до 3`);
      } else if (isNums(place, 2) && home && reach && (Math.abs(place[1] - home[1]) > 0.05 || place[0] < reach[0] - 0.01 || place[0] > reach[1] + 0.01)) {
        // measured in shots.test.ts: off his row the camera sees the owner in profile or the bare wall behind him
        problems.push(`строка ${e.line}: Move place={[${place.join(", ")}]} уводит героя с его ряда клавиш — оттуда камера видит лицо в профиль или голую стену за спиной. Шаг идёт вдоль ряда: z остаётся ${ru(home[1])}, x от ${ru(reach[0])} до ${ru(reach[1])}`);
      }
    }
    if (e.tag === "Panel") {
      // the kit's default height puts an anchored window right on the subtitle line in every shot of its actor
      const behind = str(e, "behind");
      if (behind && WINDOW_PLACES[behind] && !e.attrs.has("height")) {
        problems.push(`строка ${e.line}: Panel behind="${behind}" без height встаёт на строку субтитров — место над ней: behind="${behind}" ${WINDOW_PLACES[behind]}`);
      }
    }
    if (e.tag === "Prop" && !e.attrs.has("held") && !e.attrs.has("near") && !e.attrs.has("at")) problems.push(`строка ${e.line}: Prop — нужен held="me" или held="claude": вещь живёт в руке героя`);
    if (e.tag === "Panel" && !e.attrs.has("behind") && !e.attrs.has("at")) problems.push(`строка ${e.line}: Panel — нужен behind="me" или behind="claude": окно висит за спиной героя`);
  }

  // cast on stage
  for (const id of facts.cast) {
    const n = elements.filter((e) => e.tag === "Actor" && str(e, "id") === id).length;
    if (n !== 1) problems.push(`<Actor id="${id}"> должен быть ровно один раз (сейчас ${n})`);
  }

  // shots cover the whole video, one after another
  const shots = elements
    .filter((e) => e.tag === "Shot")
    .map((e) => ({
      from: num(e, "from") ?? NaN,
      to: num(e, "to") ?? NaN,
      line: e.line,
      on: str(e, "on") ?? "",
      picture: shotPicture(str(e, "on") ?? "", str(e, "kind") ?? "", str(e, "side")),
      room: str(e, "on") === "world" || str(e, "kind") === "tiny",
    }))
    .sort((a, b) => a.from - b.from);
  // the same picture twice in a row is one shot cut in two: the camera only twitches at the cut
  for (let i = 1; i < shots.length; i++) {
    const [a, b] = [shots[i - 1], shots[i]];
    if (a.room || b.room || a.picture !== b.picture || !(b.on === "both" || SOLO_SIDES[b.on])) continue;
    if (b.on === "both") {
      problems.push(`строка ${b.line}: общий план на двоих сразу после такого же на строке ${a.line} — это один кадр, разрезанный склейкой, картинка на ней только дёрнется: сделай их одним планом или поставь между ними план героя`);
    } else {
      const backdrop = SOLO_SIDES[b.on].length ? `; у Клода сменой считается и фон: без side — его чат, side="${SOLO_SIDES[b.on][0]}" — компьютер` : "";
      problems.push(`строка ${b.line}: Shot on="${b.on}" сразу после плана на строке ${a.line} показывает тот же кадр — на склейке картинка только дёрнется. Два плана подряд на одного героя меняют крупность (close, medium, wide, low, high)${backdrop}; или сделай их одним планом`);
    }
  }
  // the room shot sees the actors a few pixels tall: a reaction icon there is lost
  for (const e of elements.filter((x) => x.tag === "Pop")) {
    const at = num(e, "at");
    const shot = at === undefined ? undefined : shots.filter((s) => s.from <= at && at < s.to).pop();
    if (shot?.room) problems.push(`строка ${e.line}: Pop at=${at} приходится на план всей комнаты (строка ${shot.line}), там значок в несколько пикселей — его место на плане героя`);
  }
  if (!shots.length) problems.push("нет ни одного <Shot>");
  else {
    // the first frame decides whether the viewer stays: the speaker's face, never the far desk
    const first = shots[0];
    const desks = elements.filter((e) => e.tag === "Shot" && str(e, "kind") === "desk");
    const opener = facts.lines.filter((l) => facts.cast.includes(l.who))[0];
    const firstKind = first.picture.split("|")[1];
    if (first.room || first.on === "both" || !["close", "medium"].includes(firstKind) || (opener && first.on !== opener.who))
      problems.push(`строка ${first.line}: ролик открывается лицом говорящего${opener ? ` (${opener.who})` : ""} — ${FACE_OPENING}`);
    const openingFace = elements.some((e) => e.tag === "Face" && str(e, "who") === first.on && (num(e, "from") ?? 0) <= 0.3);
    if (!first.room && first.on !== "both" && !openingFace) problems.push(`строка ${first.line}: на первом кадре у ${first.on} спокойное лицо — поставь ему <Face who="${first.on}" from={0} …> с чувством первой реплики: первый кадр ролика — это лицо с эмоцией`);
    if (desks.length > 1) problems.push(`общий план стола — не больше одного раза за ролик (сейчас ${desks.length})`);
    for (const d of desks) {
      const [df, dt] = [num(d, "from") ?? 0, num(d, "to") ?? 0];
      if (dt - df < DESK_SECONDS[0] || dt - df > DESK_SECONDS[1]) problems.push(`строка ${d.line}: общий план стола идёт ${(dt - df).toFixed(1)} с — ему нужно ${DESK_SECONDS[0]}–${DESK_SECONDS[1]} с`);
    }
    if (shots[0].from > 0.01) problems.push(`первый Shot начинается с ${shots[0].from}, нужен с 0`);
    for (let i = 1; i < shots.length; i++) {
      const gap = shots[i].from - shots[i - 1].to;
      if (gap > 0.05) problems.push(`между Shot на строках ${shots[i - 1].line} и ${shots[i].line} дыра ${gap.toFixed(2)} с`);
      if (gap < -0.05) problems.push(`Shot на строках ${shots[i - 1].line} и ${shots[i].line} перекрываются`);
    }
    const last = shots[shots.length - 1];
    if (Math.abs(last.to - D) > 0.1) problems.push(`последний Shot должен кончаться на ${D.toFixed(2)} (конец ролика), а не на ${last.to}`);
    for (const s of shots) if (s.to - s.from < MIN_SHOT - 1e-6 && s !== last) problems.push(`Shot на строке ${s.line} идёт ${ru(Math.round((s.to - s.from) * 100) / 100)} с — план не короче ${ru(MIN_SHOT)} с, иначе глаз не успевает; быстрый обмен короткими репликами снимай одним общим планом на двоих`);
    // the camera follows the voice: one line, one shot, on whoever is speaking
    const speech = facts.lines.filter((l) => facts.cast.includes(l.who));
    const quote = (l: SceneFacts["lines"][number]) => (l.text ? ` «${l.text.length > 40 ? `${l.text.slice(0, 40)}…` : l.text}»` : "");
    const round = (n: number) => Math.round(n * 100) / 100;
    for (const s of shots) {
      if (s.room || !SOLO_SIDES[s.on]) continue;
      const heard = speech
        .filter((l) => l.who !== s.on)
        .map((l) => ({ l, over: Math.min(s.to, l.end) - Math.max(s.from, l.start) }))
        .filter((x) => x.over > 0)
        .sort((a, b) => b.over - a.over);
      const total = heard.reduce((n, x) => n + x.over, 0);
      if (total > LISTENER_SLACK) {
        const main = heard[0].l;
        problems.push(`строка ${s.line}: план на ${s.on} (${ru(s.from)}–${ru(s.to)}), а ${ru(Math.round(total * 10) / 10)} с из него говорит ${main.who}${quote(main)} — владелец: «когда говорит один, кадр на другом». В кадре тот, кто говорит: план ${main.who} с ${ru(round(main.start - 0.1))} или общий план на двоих; реакцию слушателя покажи в паузе перед его ответом или на общем плане`);
      }
    }
    // the opening desk shot ends within its fixed seconds, wherever the first line is
    const opening = undefined as (typeof shots)[number] | undefined;
    for (const l of speech) {
      const cuts = shots.slice(1).filter((s) => s !== opening && s.from > l.start + CUT_MARGIN && s.from < l.end - CUT_MARGIN);
      const allowed = l.end - l.start > LONG_LINE ? 1 : 0;
      if (cuts.length > allowed) {
        problems.push(`строка ${cuts[allowed].line}: склейка на ${ru(cuts[allowed].from)} с режет реплику ${l.who}${quote(l)} (${ru(round(l.start))}–${ru(round(l.end))}) — владелец: «кадры очень быстро меняются». Одна реплика — один план: склейка ставится за 0,1 с до первого слова следующего говорящего, а реплику держи одним планом с push или pull${allowed ? "; реплика дольше 6 с может один раз сменить крупность того же героя" : ""}`);
      }
    }
    // a reaction with an icon is read on the hero's face: the shot holds it long enough
    for (const pop of elements.filter((x) => x.tag === "Pop")) {
      const at = num(pop, "at");
      const shot = at === undefined ? undefined : shots.filter((s) => s.from <= at + 1e-6 && at < s.to).pop();
      if (shot && shot.to - shot.from < MIN_REACTION_SHOT - 1e-6) problems.push(`строка ${pop.line}: значок стоит на плане ${ru(Math.round((shot.to - shot.from) * 100) / 100)} с (строка ${shot.line}) — реакцию показывай планом не короче 2 с, чтобы зритель увидел лицо и понял, что случилось`);
    }
  }
  // the channel card takes the upper part of the frame, the same place the windows behind the heroes use
  const cards = elements.filter((e) => e.tag === "Channel");
  if (cards.length > 1) problems.push(`карточка канала — один раз за ролик, на реплике владельца про его канал (сейчас ${cards.length})`);
  for (const card of cards) {
    const [cf, ct] = [num(card, "from"), num(card, "to")];
    if (cf === undefined || ct === undefined) continue;
    for (const panel of elements.filter((e) => e.tag === "Panel")) {
      const [pf, pt] = [num(panel, "from") ?? 0, num(panel, "to") ?? D];
      if (pf < ct && cf < pt) {
        problems.push(`строка ${panel.line}: окно Panel висит в то же время, что карточка канала (строка ${card.line}, ${cf}–${ct}) — карточка закрывает верх кадра, где висят окна; покажи окно до или после неё`);
      }
    }
  }
  // one picture at a time on each screen of the room
  for (const surface of Object.keys(SURFACES)) {
    const list = elements
      .filter((e) => e.tag === "Screen" && str(e, "on") === surface)
      .map((e) => ({ from: num(e, "from") ?? NaN, to: num(e, "to") ?? NaN, line: e.line }))
      .sort((a, b) => a.from - b.from);
    for (let i = 1; i < list.length; i++) {
      const [a, b] = [list[i - 1], list[i]];
      if (b.from < a.to - 0.05) problems.push(`строка ${b.line}: на ${SURFACES[surface]} ещё идёт картинка со строки ${a.line} (до ${a.to}) — на одном экране одна картинка за раз: следующая начинается, когда кончилась прежняя`);
    }
  }
  // a calm sketch (the owner: «по минимуму»): a few things on screen, each one meaning something
  const counts = { Prop: 5, Pop: 2, Light: 3, Screen: 10 } as const;
  for (const [tag, max] of Object.entries(counts)) {
    const n = elements.filter((e) => e.tag === tag).length;
    if (n > max) problems.push(`${tag}: ${n} — больше ${max} перегружает кадр, оставь самые важные`);
  }
  return [...new Set(problems)];
}
