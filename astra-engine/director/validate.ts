import ts from "typescript";
import { PALETTES } from "../src/design";
import { ICONS } from "../src/kit/icons";
import { coinOf, emojiOf } from "../src/kit/iconPictures";

/** Blocks Astra may use, with the time props each one takes. */
const BLOCKS: Record<string, { time: "range" | "at" | "none" }> = {
  AstraVideo: { time: "none" },
  Captions: { time: "none" },
  BehindText: { time: "range" },
  Title: { time: "range" },
  Tag: { time: "range" },
  SidePanel: { time: "range" },
  FocusCard: { time: "range" },
  IconPop: { time: "range" },
  ImageCard: { time: "range" },
  Arrow: { time: "range" },
  Flash: { time: "at" },
  Sfx: { time: "at" },
  Music: { time: "none" },
  Logo: { time: "range" },
  Photo: { time: "range" },
  MapFocus: { time: "range" },
  Notification: { time: "range" },
  CameraView: { time: "range" },
  Scene: { time: "range" },
  Morph: { time: "range" },
  Meme: { time: "range" },
  Footage: { time: "range" },
  Headline: { time: "range" },
  BigNumber: { time: "range" },
  IconRow: { time: "range" },
  Compare: { time: "range" },
  Flow: { time: "range" },
  Ledger: { time: "range" },
  Network: { time: "range" },
  Address: { time: "range" },
  SeedPhrase: { time: "range" },
  Chart: { time: "range" },
  Chat: { time: "range" },
  Post: { time: "range" },
  PieSplit: { time: "range" },
  Timeline: { time: "range" },
  RealPhoto: { time: "range" },
  Graphic: { time: "range" },
  Screen: { time: "range" },
  Collage: { time: "range" },
  Outro: { time: "range" },
};
/** Full-screen designed graphics: they need time to open, be read and close. */
const BOARDS = new Set(["Headline", "BigNumber", "IconRow", "Compare", "Flow", "Ledger", "Network", "Address", "SeedPhrase", "Chart", "Chat", "Post", "PieSplit", "Timeline", "Graphic", "Screen", "Collage"]);
const HEAVY = new Set(["SidePanel", "FocusCard", "ImageCard", "Photo", "MapFocus", "Scene", "Meme", "Morph", "RealPhoto", "Footage", "Outro", ...BOARDS]);
const VISUAL = new Set(["BehindText", "Title", "Tag", "SidePanel", "FocusCard", "IconPop", "ImageCard", "Arrow", "Flash",
  "Logo", "Photo", "MapFocus", "Notification", "CameraView", "Scene", "Meme", "Morph", "RealPhoto", "Footage", "Outro", ...BOARDS]);
/** Sounds a move of a Graphic may make on its own second. */
const STEP_SOUNDS = new Set(["click", "typing", "pop", "whoosh", "swipe", "ding", "notification", "cash", "error", "impact", "shutter"]);
const EMOJI = /\p{Extended_Pictographic}/u;

/** Emoji and logos to fetch, photos to find, scenes to generate, morphs to make, memes to take from the library. */
export function assetNeeds(blocks: Block[]) {
  const emoji = new Set<string>(), logos = new Set<string>(), photos = new Set<string>(), scenes = new Set<string>(), memes = new Set<string>();
  const looks: Record<string, string> = {};
  const morphs: { from: number; into: string }[] = [];
  const reals: { query: string; wiki?: string; caption?: string }[] = [];
  const footage: { query: string; start?: number }[] = [];
  const screens: { url: string; find?: string }[] = [];
  const cutouts: { query: string; wiki?: string; caption?: string; color?: boolean }[] = [];
  const coins = new Set<string>();
  const icon = (value: unknown) => {
    if (typeof value !== "string" || !value) return;
    if (EMOJI.test(value)) emoji.add(value);
    else if (!/[./:]/.test(value)) logos.add(value);
  };
  for (const b of blocks) {
    if (b.type === "IconPop") icon(b.props.emoji);
    if (b.type === "Notification") icon(b.props.icon);
    if (b.type === "Logo" && typeof b.props.name === "string") logos.add(b.props.name);
    if (b.type === "Photo" && typeof b.props.query === "string") {
      photos.add(b.props.query);
      if (typeof b.props.look === "string") looks[b.props.query] = b.props.look;
    }
    if (b.type === "Scene" && typeof b.props.prompt === "string") scenes.add(b.props.prompt);
    // The boards' backdrop is a drawn scene, or `footage:<query>` — a frame of real footage found for that query.
    if (b.type === "Backdrop" && typeof b.props.prompt === "string") {
      const query = b.props.prompt.startsWith("footage:") ? b.props.prompt.slice(8).trim() : "";
      const coin = b.props.prompt.startsWith("coin:") ? b.props.prompt.slice(5).trim() : "";
      if (query) { if (!footage.some(f => f.query === query)) footage.push({ query }); }
      else if (coin) coins.add(coin);
      else scenes.add(b.props.prompt);
    }
    if (b.type === "Footage" && typeof b.props.query === "string") {
      // Another start of the same video is another cut: each place in the montage shows its own part.
      const start = typeof b.props.start === "number" ? Math.round(b.props.start) : undefined;
      if (!footage.some(f => f.query === b.props.query && f.start === start)) footage.push({ query: b.props.query, start });
    }
    if (b.type === "Morph" && typeof b.props.into === "string") morphs.push({ from: b.from, into: b.props.into });
    if (b.type === "Meme" && typeof b.props.name === "string") memes.add(b.props.name);
    if (b.type === "RealPhoto" && typeof b.props.query === "string" && !reals.some(r => r.query === b.props.query && r.wiki === b.props.wiki)) {
      reals.push({ query: b.props.query, wiki: typeof b.props.wiki === "string" ? b.props.wiki : undefined, caption: typeof b.props.caption === "string" ? b.props.caption : undefined });
    }
    if (b.type === "Screen" && typeof b.props.url === "string" && b.props.url.trim()) {
      const find = typeof b.props.find === "string" && b.props.find.trim() ? b.props.find.trim() : undefined;
      if (!screens.some(s => s.url === b.props.url && s.find === find)) screens.push({ url: b.props.url.trim(), find });
    }
    // Every piece of a collage is a real photo cut out along its subject.
    if (b.type === "Collage") for (const item of (Array.isArray(b.props.items) ? b.props.items : []) as { query?: unknown; wiki?: unknown; label?: unknown; color?: unknown }[]) {
      if (typeof item?.query !== "string" || !item.query.trim()) continue;
      const wiki = typeof item.wiki === "string" && item.wiki.trim() ? item.wiki : undefined;
      if (!cutouts.some(c => c.query === item.query && c.wiki === wiki)) {
        cutouts.push({ query: item.query, wiki, caption: typeof item.label === "string" ? item.label : undefined, color: item.color === true });
      }
    }
    // Board icons are drawn as real things: a coin's logo is fetched, an object is its 3D emoji.
    for (const name of iconsOf(b)) {
      const coin = coinOf(name);
      if (coin) coins.add(coin);
      const glyph = emojiOf(name);
      if (glyph) emoji.add(glyph);
    }
    // Older list blocks take emoji or logos per item; the new graphics name line icons, which are drawn, not fetched.
    if (["SidePanel", "FocusCard", "List"].includes(b.type)) for (const item of (Array.isArray(b.props.items) ? b.props.items : []) as { icon?: unknown }[]) icon(item?.icon);
  }
  return { emoji: [...emoji], logos: [...logos], photos: [...photos], looks, scenes: [...scenes], morphs, memes: [...memes], reals, footage, screens, cutouts, coins: [...coins] };
}
const FORBIDDEN = new Set(["fetch", "eval", "Function", "require", "XMLHttpRequest", "WebSocket", "window", "document",
  "globalThis", "process", "navigator", "localStorage", "sessionStorage", "setTimeout", "setInterval", "Date"]);

export type Block = { type: string; from: number; to: number; props: Record<string, unknown> };
export type CameraMove = { kind: string; args: number[] };
export type Analysis = { blocks: Block[]; camera: CameraMove[]; captions: number; problems: string[]; notes: string[] };

function literal(node: ts.Expression | undefined): unknown {
  if (!node) return undefined;
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(node.operand)) return -Number(node.operand.text);
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (ts.isArrayLiteralExpression(node)) return node.elements.map(e => literal(e));
  if (ts.isObjectLiteralExpression(node)) {
    const out: Record<string, unknown> = {};
    for (const p of node.properties) if (ts.isPropertyAssignment(p)) out[p.name.getText()] = literal(p.initializer);
    return out;
  }
  if (ts.isParenthesizedExpression(node)) return literal(node.expression);
  return undefined;
}

/** Static checks of a montage file: allowed imports and APIs, literal timings, a sane timeline. */
export function analyzeMontage(code: string, duration: number): Analysis {
  const source = ts.createSourceFile("Montage.tsx", code, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
  const problems: string[] = [];
  const notes: string[] = [];
  const blocks: Block[] = [];
  const camera: CameraMove[] = [];
  let captions = 0;
  let exportsMontage = false;

  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node)) {
      const from = (node.moduleSpecifier as ts.StringLiteral).text;
      if (from !== "react" && from !== "../kit") problems.push(`Импорт из «${from}»: монтаж импортирует только react и ../kit.`);
    }
    if (ts.isVariableStatement(node) && node.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)) {
      if (node.declarationList.declarations.some(d => d.name.getText() === "Montage")) exportsMontage = true;
    }
    if (ts.isIdentifier(node) && FORBIDDEN.has(node.text)) problems.push(`«${node.text}» недоступен в монтаже: время и данные приходят только из расшифровки.`);
    if (ts.isPropertyAccessExpression(node) && node.getText() === "Math.random") problems.push("Math.random делает кадры разными при каждом рендере; используй конкретные числа.");
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) problems.push("Динамический import недоступен.");
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.expression.getText() === "cam") {
      const args = node.arguments.map(a => literal(a));
      const numbers = args.filter((a): a is number => typeof a === "number");
      camera.push({ kind: node.expression.name.text, args: numbers });
    }
    if (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) {
      const tag = node.tagName.getText();
      if (tag === "React.Fragment" || tag === "Fragment") { /* grouping only */ }
      else if (!(tag in BLOCKS)) problems.push(`<${tag}> — такого кубика нет. Доступны: ${Object.keys(BLOCKS).join(", ")}.`);
      else {
        const props: Record<string, unknown> = {};
        for (const attr of node.attributes.properties) {
          if (!ts.isJsxAttribute(attr)) { problems.push(`<${tag}>: разворот {...props} недоступен, пиши свойства явно.`); continue; }
          const name = attr.name.getText();
          const init = attr.initializer;
          props[name] = !init ? true : ts.isStringLiteral(init) ? init.text : ts.isJsxExpression(init) ? literal(init.expression) : undefined;
        }
        if (tag === "Captions") captions++;
        // The backdrop of the boards is a scene drawn before the render, like the ones in the montage.
        if (tag === "AstraVideo" && typeof props.backdrop === "string" && props.backdrop.trim()) blocks.push({ type: "Backdrop", from: 0, to: 0, props: { prompt: props.backdrop } });
        if (tag === "AstraVideo" && props.palette !== undefined && !(typeof props.palette === "string" && props.palette in PALETTES)) {
          problems.push(`<AstraVideo palette="${String(props.palette)}">: такой палитры нет. Есть: ${Object.keys(PALETTES).join(", ")}.`);
        }
        // The soft palettes have their own page behind the boards: a backdrop scene would only be fetched and never shown.
        if (tag === "AstraVideo" && typeof props.palette === "string" && (PALETTES as Record<string, { soft?: boolean }>)[props.palette]?.soft && typeof props.backdrop === "string" && props.backdrop.trim()) {
          problems.push(`<AstraVideo palette="${props.palette}">: у этой палитры свой мягкий фон досок — backdrop убери.`);
        }
        if (tag === "AstraVideo" && props.accent !== undefined && !(typeof props.accent === "string" && (props.accent === "scene" || /^#[0-9a-f]{6}$/i.test(props.accent)))) {
          problems.push(`<AstraVideo accent="${String(props.accent)}">: акцент — "scene" (цвет кадра автора) или цвет вида #3FB27F.`);
        }
        const kind = BLOCKS[tag].time;
        if (kind === "range") {
          const from = props.from, to = props.to;
          if (typeof from !== "number" || typeof to !== "number") problems.push(`<${tag}>: from и to — числа секунд прямо в разметке.`);
          else blocks.push({ type: tag, from, to, props });
        } else if (kind === "at") {
          const at = props.at;
          if (typeof at !== "number") problems.push(`<${tag}>: at — число секунд прямо в разметке.`);
          else blocks.push({ type: tag, from: at, to: at + (tag === "Flash" ? 0.25 : 0.5), props });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);

  if (!exportsMontage) problems.push("Файл экспортирует `export const Montage`.");
  if (captions !== 1) problems.push(`Нужен ровно один <Captions>, сейчас ${captions}.`);

  for (const b of blocks) {
    if (b.to <= b.from && b.type !== "Backdrop") problems.push(`<${b.type}> ${b.from}–${b.to}: конец раньше начала.`);
    if (b.from < -0.01 || b.to > duration + 0.3) problems.push(`<${b.type}> ${b.from}–${b.to}: за пределами ролика 0–${duration.toFixed(2)} с.`);
    if (b.type === "BehindText" && typeof b.props.text === "string" && b.props.text.replace(/\s/g, "").length > 14) problems.push(`<BehindText text="${b.props.text}">: до 14 букв, иначе слово станет мелким.`);
    for (const item of timedParts(b)) {
      if (typeof item?.at === "number" && (item.at < b.from - 0.05 || item.at > b.to - 0.3)) problems.push(`<${b.type}> ${b.from}–${b.to}: появление с at=${item.at} вне сцены (или в последние 0.3 с, когда графика уже закрывается).`);
    }
    for (const name of iconsOf(b)) {
      if (!(name in ICONS) && !coinOf(name)) problems.push(`<${b.type}>: иконки «${name}» нет. Монета или биржа — icon="coin:<тикер или название>" (coin:ETH, coin:TRUMP, coin:Kraken); остальное — из списка иконок учебника (например ${Object.keys(ICONS).slice(0, 12).join(", ")}).`);
    }
    if (BOARDS.has(b.type) && b.to - b.from < 3) problems.push(`<${b.type}> ${b.from}–${b.to}: доска держится, пока автор договаривает мысль, — хотя бы 3 секунды; зритель успевает её прочесть.`);
    // The owner wants the author big: on the board he stands large at the bottom, never in a small window.
    if ((BOARDS.has(b.type) || b.type === "RealPhoto") && ["circle", "circle-top", "card"].includes(String(b.props.author ?? ""))) {
      problems.push(`<${b.type}> ${b.from}–${b.to}: author="${String(b.props.author)}" делает автора мелким окошком. Автор крупно: author="split" (или "none" на 1.5–2.5 с).`);
    }
    if (b.type === "Graphic") problems.push(...graphicProblems(b));
    if (b.type === "Screen" || b.type === "Collage" || b.type === "Outro") problems.push(...v2Problems(b, duration));
    if (b.type === "SeedPhrase" && Array.isArray(b.props.words) && b.props.words.length !== 12) problems.push(`<SeedPhrase>: слов ${b.props.words.length}, а фраза из 12 слов.`);
  }
  // Without a picture generator (ASTRA_DRAW=0) nothing is drawn: the video is made of real footage, real photos and graphics.
  if (process.env.ASTRA_DRAW === "0") for (const b of blocks) {
    if (b.type === "Scene") problems.push(`<Scene> ${b.from}–${b.to}: в этом ролике картинки не рисуются. Покажи этот момент настоящими кадрами (Footage), настоящим фото (RealPhoto, Photo), доской или словом за спиной автора.`);
    if (b.type === "Morph") problems.push(`<Morph> ${b.from}–${b.to}: в этом ролике превращений нет — генератора картинок нет. Покажи этот момент настоящими кадрами или словом за спиной автора.`);
    if (b.type === "Backdrop" && !/^(footage|coin):/.test(String(b.props.prompt ?? ""))) problems.push(`<AstraVideo backdrop>: в этом ролике фон досок не рисуется — возьми кадр настоящих кадров: backdrop="footage:<запрос>" (или значок героя: backdrop="coin:TRUMP").`);
  }
  // The boards stand on the hero of the video: its real footage or its own mark. A drawn backdrop came out generic —
  // «macro view of plain metallic coins» behind the TRUMP token (the owner, 07.11: «на фоне вышло вообще другое»).
  if (process.env.ASTRA_DRAW !== "0") for (const b of blocks) {
    if (b.type === "Backdrop" && !/^(footage|coin):/.test(String(b.props.prompt ?? ""))) {
      problems.push(`<AstraVideo backdrop="${String(b.props.prompt).slice(0, 60)}">: фон досок — сам герой ролика, а не нарисованная сцена: его настоящие кадры backdrop="footage:<запрос по-английски>" (Ethereum logo animation, Donald Trump speech crypto) или его значок backdrop="coin:<тикер>", если это монета или биржа.`);
    }
  }
  const morphs = blocks.filter(b => b.type === "Morph");
  if (morphs.length > 1) problems.push(`Превращений ${morphs.length}: превращение звучит один раз за ролик — в момент, где действие ИИ можно показать (звонит в полицию — робот с телефоном у уха). Оставь одно.`);
  const banners = blocks.filter(b => b.type === "Notification").sort((a, b) => a.from - b.from);
  banners.forEach((n, i) => {
    const next = banners[i + 1];
    if (next && next.from - n.to < 1.5) problems.push(`Уведомления ${n.from}–${n.to} и ${next.from}–${next.to} идут подряд: одно сообщение — одно уведомление, оно держится, пока автор его пересказывает. Объедини их в одно.`);
  });
  for (const m of morphs) {
    if (m.to - m.from > 2.5) problems.push(`<Morph> ${m.from}–${m.to}: превращение держится 1–2.5 секунды, иначе застывший кадр заметен.`);
  }
  const heavy = blocks.filter(b => HEAVY.has(b.type)).sort((a, b) => a.from - b.from);
  heavy.forEach((b, i) => {
    const next = heavy[i + 1];
    if (next && next.from < b.to - 0.05 && !(b.type === "ImageCard" && b.props.pos === "full")) problems.push(`<${b.type}> ${b.from}–${b.to} и <${next.type}> ${next.from}–${next.to} идут одновременно: крупные сцены — по очереди.`);
  });
  const moves = camera.map(m => ({ ...m, start: m.args[0] ?? 0, end: m.kind === "punch" || m.kind === "reset" ? m.args[0] ?? 0 : m.args[1] ?? m.args[0] ?? 0 })).sort((a, b) => a.start - b.start);
  moves.forEach((m, i) => { const n = moves[i + 1]; if (n && n.start < m.end - 0.01) problems.push(`Камера: cam.${m.kind} до ${m.end} с и cam.${n.kind} с ${n.start} с пересекаются.`); });

  // A sound voices something the viewer sees appear: a picture, a list, a banner, a punch-in of the camera.
  const appearances = [...blocks.filter(b => VISUAL.has(b.type)).flatMap(b => [b.from,
    ...timedParts(b).flatMap(part => typeof part.at === "number" ? [part.at] : [])]),
    ...moves.filter(m => m.kind === "punch").map(m => m.start)];
  for (const s of blocks.filter(b => b.type === "Sfx")) {
    const role = String(s.props.role ?? "");
    if (["riser", "typing", "tick", "click", "glitch"].includes(role)) {
      problems.push(`Звук ${role} на ${s.from} с: эти звуки кубики ставят сами, когда на экране есть их событие (печать, часы, превращение). Здесь такого события нет — убери этот <Sfx>.`);
    } else if (!appearances.some(t => Math.abs(t - s.from) <= 0.35)) {
      problems.push(`Звук ${role} на ${s.from} с звучит, когда на экране ничего не появляется: зритель слышит звук без причины. Поставь его точно на появление картинки или убери.`);
    }
  }

  // Rhythm notes guide the review; they are not hard errors.
  // On a board every part that appears on its word is an event too: a row, a step, a side, a pulse, a rejection.
  const visual = blocks.filter(b => VISUAL.has(b.type)).flatMap(b => [b.from,
    ...timedParts(b).flatMap(part => (typeof part?.at === "number" ? [part.at] : [])),
    ...(typeof (b.props.forged as { rejectAt?: unknown } | undefined)?.rejectAt === "number" ? [(b.props.forged as { rejectAt: number }).rejectAt] : [])]);
  const cuts = moves.map(m => m.start);
  const events = [...visual, ...cuts].sort((a, b) => a - b);
  // The hook is a picture, a word or a board: a camera move alone is not one.
  const firstVisual = visual.length ? Math.min(...visual) : Infinity;
  if (firstVisual > 1.2) problems.push(`Первая секунда пустая (первая картинка на ${Number.isFinite(firstVisual) ? firstVisual.toFixed(1) : "—"} с): на первом смысловом слове уже нужен крючок — картинка на весь кадр, главное число за спиной или значки по словам.`);
  let prev = 0;
  for (const t of [...events, duration]) {
    if (t - prev > 5) notes.push(`${prev.toFixed(1)}–${t.toFixed(1)} с: ${(t - prev).toFixed(1)} с без нового визуального события.`);
    prev = Math.max(prev, t);
  }
  return { blocks, camera, captions, problems, notes };
}

/** Time ranges that need the author cut out (text behind the author), padded and merged. */
export function cutoutRanges(blocks: Block[], duration: number): { from: number; to: number }[] {
  const ranges = blocks.filter(b => b.type === "BehindText" || (b.type === "Logo" && b.props.pos === "behind"))
    .map(b => ({ from: Math.max(0, b.from - 0.1), to: Math.min(duration, b.to + 0.1) }))
    .sort((a, b) => a.from - b.from);
  const merged: { from: number; to: number }[] = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r.from <= last.to + 0.5) last.to = Math.max(last.to, r.to);
    else merged.push({ ...r });
  }
  return merged;
}

/** Everything inside a block that appears at its own second: list items, steps, rows, events, messages, sides. */
function timedParts(b: Block): { at?: unknown }[] {
  const out: { at?: unknown }[] = [];
  for (const key of ["items", "steps", "rows", "events", "messages", "motion"]) {
    const list = b.props[key];
    if (Array.isArray(list)) out.push(...(list as { at?: unknown }[]));
  }
  for (const key of ["left", "right", "forged", "copies"]) {
    const part = b.props[key] as { at?: unknown; items?: unknown } | undefined;
    if (part && typeof part === "object") {
      out.push(part);
      if (Array.isArray(part.items)) out.push(...(part.items as { at?: unknown }[]));
    }
  }
  if (typeof b.props.pulseAt === "number") out.push({ at: b.props.pulseAt });
  // A page is marked on its word; a collage's plaque is glued on its own.
  if (b.type === "Screen" && typeof b.props.at === "number") out.push({ at: b.props.at });
  if (b.type === "Collage" && typeof b.props.titleAt === "number") out.push({ at: b.props.titleAt });
  return out;
}

/** Icon names a block asks for. */
function iconsOf(b: Block): string[] {
  const names: string[] = [];
  const add = (v: unknown) => { if (typeof v === "string" && v.length > 2) names.push(v); };
  if (["IconRow", "Flow", "Compare", "Network", "Chat"].includes(b.type)) {
    for (const key of ["items", "steps"]) for (const it of (Array.isArray(b.props[key]) ? b.props[key] : []) as { icon?: unknown }[]) add(it?.icon);
    for (const key of ["left", "right"]) add((b.props[key] as { icon?: unknown } | undefined)?.icon);
    add(b.props.icon);
    if (b.type === "Chat") add(b.props.avatar);
  }
  return names;
}

/** A graphic Astra draws herself stays inside the frame: plain markup and styles, moves that find their elements. */
function graphicProblems(b: Block): string[] {
  const out: string[] = [];
  const name = `<Graphic> ${b.from}–${b.to}`;
  const html = b.props.html, css = b.props.css ?? "";
  if (typeof html !== "string" || !html.trim()) return [`${name}: html — разметка графики строкой прямо в свойстве (обычные кавычки или \`...\` без \${}).`];
  if (typeof css !== "string") return [`${name}: css — стили строкой прямо в свойстве.`];
  const markup = html + css;
  if (markup.length > 8000) out.push(`${name}: разметка и стили ${markup.length} знаков — графика читается за 3 секунды, хватит до 8000.`);
  if (/<\s*(script|iframe|object|embed|link|meta|img|image|video|audio|foreignObject|base|form|input)\b/i.test(markup)) out.push(`${name}: графика рисуется своими элементами — div, span, svg, path, circle, rect, text, g. Фото и видео ставятся кубиками Photo, RealPhoto, Footage.`);
  if (/\son[a-z]+\s*=|javascript:|@import|https?:|\burl\(\s*['"]?(?!#)/i.test(markup)) out.push(`${name}: графика целиком внутри себя — без адресов, url() только на свои #градиенты и без обработчиков on…=.`);
  // The fonts of the video carry Latin, Cyrillic and the usual signs; any other symbol comes out as an empty box.
  const missing = [...new Set(html.replace(/<[^>]*>/g, "").match(/[^ -ɏЀ-џҐґ -⁯€№™↑↓−∕s]/gu) ?? [])].filter(c => !EMOJI.test(c));
  if (missing.length) out.push(`${name}: знаков «${missing.join(" ")}» нет в шрифтах видео — они выйдут пустым квадратом. Нарисуй знак фигурой svg или напиши словом (BTC, руб.).`);
  const motion = b.props.motion;
  if (!Array.isArray(motion) || !motion.length) return [...out, `${name}: motion — список движений, каждое на своё слово: [{ at, sel, from | to }].`];
  const classes = new Set<string>(), ids = new Set<string>();
  for (const m of html.matchAll(/class\s*=\s*["']([^"']+)["']/gi)) m[1].split(/\s+/).forEach(c => c && classes.add(c));
  for (const m of html.matchAll(/id\s*=\s*["']([^"']+)["']/gi)) ids.add(m[1]);
  for (const step of motion as Record<string, unknown>[]) {
    const sel = step?.sel;
    if (typeof sel !== "string" || !sel.trim()) { out.push(`${name}: у движения нет sel — какой элемент двигается (".coin", "#arrow").`); continue; }
    for (const c of sel.match(/\.[\w-]+/g) ?? []) if (!classes.has(c.slice(1))) out.push(`${name}: движение «${sel}» — в разметке нет class="${c.slice(1)}".`);
    for (const i of sel.match(/#[\w-]+/g) ?? []) if (!ids.has(i.slice(1))) out.push(`${name}: движение «${sel}» — в разметке нет id="${i.slice(1)}".`);
    if (typeof step.at !== "number") out.push(`${name}: движение «${sel}» без at — секунды слова, на котором оно начинается.`);
    if (!step.from && !step.to && !step.count) out.push(`${name}: движение «${sel}» ничего не меняет — нужно from, to или count.`);
    if (step.split !== undefined && step.split !== "chars" && step.split !== "words") out.push(`${name}: split — "chars" (по буквам) или "words" (по словам).`);
    if (step.sfx !== undefined && !(typeof step.sfx === "string" && STEP_SOUNDS.has(step.sfx))) out.push(`${name}: sfx у «${sel}» — один из звуков: ${[...STEP_SOUNDS].join(", ")}.`);
    for (const key of ["from", "to"]) {
      const vars = step[key];
      if (vars === undefined) continue;
      if (!vars || typeof vars !== "object" || Array.isArray(vars)) { out.push(`${name}: ${key} у «${sel}» — объект вида { y: 80, opacity: 0 }.`); continue; }
      for (const [k, v] of Object.entries(vars as Record<string, unknown>)) {
        if (/^on/i.test(k)) out.push(`${name}: ${key}.${k} — обработчики не нужны, движение задаётся значениями.`);
        if (v === undefined) out.push(`${name}: ${key}.${k} у «${sel}» — значение пишется числом или строкой прямо в разметке.`);
        if (typeof v === "string" && /random\(/i.test(v)) out.push(`${name}: ${key}.${k} — random() даёт разные кадры при каждом рендере; поставь конкретные числа.`);
      }
    }
  }
  return out;
}

const MASCOT = new Set(["hi", "point", "think", "shock", "happy", "sad", "key", "phone"]);

/** Real pages, paper collages and the ending: what each needs to come out right. */
function v2Problems(b: Block, duration: number): string[] {
  const out: string[] = [];
  const name = `<${b.type}> ${b.from}–${b.to}`;
  const text = (key: string) => (typeof b.props[key] === "string" ? (b.props[key] as string).trim() : "");
  if (b.type === "Screen") {
    const url = text("url");
    if (!/^https?:\/\/[^\s/]+\.[^\s]+$/i.test(url)) out.push(`${name}: url — полный адрес настоящей страницы: "https://github.com/bitcoin/bitcoin".`);
    const find = text("find");
    if (find.length > 80) out.push(`${name}: find — короткая фраза со страницы, слово в слово, до 80 знаков; сейчас ${find.length}.`);
    if (b.props.at !== undefined && !find) out.push(`${name}: at без find — отмечается фраза; добавь find или убери at.`);
    const at = b.props.at;
    if (typeof at === "number" && at > b.to - 1.2) out.push(`${name}: at=${at} — маркер и кольцо рисуются около секунды: фраза отмечается хотя бы за 1.2 с до конца страницы.`);
  }
  if (b.type === "Collage") {
    const items = Array.isArray(b.props.items) ? b.props.items as Record<string, unknown>[] : [];
    if (!items.length || items.length > 3) out.push(`${name}: items — 1–3 вырезанных фото, сейчас ${items.length}.`);
    items.forEach((item, i) => {
      if (typeof item?.query !== "string" || !item.query.trim()) out.push(`${name}: у куска ${i + 1} нет query — английских слов для поиска фото.`);
      if (typeof item?.at !== "number") out.push(`${name}: у куска ${i + 1} нет at — секунды слова, на котором он ложится на бумагу.`);
      if (typeof item?.label === "string" && item.label.length > 18) out.push(`${name}: подпись «${item.label}» длиннее 18 знаков — на полоске бумаги одно-два слова.`);
    });
    if (text("title").length > 28) out.push(`${name}: title — до 28 знаков, это плашка над историей.`);
    if (b.props.color !== undefined && !/^#[0-9a-f]{6}$/i.test(text("color"))) out.push(`${name}: color — цвет вида #E8623A.`);
  }
  if (b.type === "Outro") {
    // The ending stands on the author's ask near the end; a question after it may follow as a choice on screen to the last frame.
    if (b.from < duration - 12) out.push(`${name}: концовка — в последних 12 секундах ролика, на просьбе автора подписаться или написать.`);
    if (b.to - b.from < 1.5 || b.to - b.from > 7) out.push(`${name}: концовка держится 1.5–7 секунд — пока автор произносит просьбу.`);
    if (text("title").length > 22) out.push(`${name}: title — одна просьба до 22 знаков: «ПОДПИШИСЬ».`);
    if (text("text").length > 48) out.push(`${name}: text — до 48 знаков: что будет дальше.`);
    if (b.props.pose !== undefined && !MASCOT.has(text("pose"))) out.push(`${name}: pose — одна из поз персонажа: ${[...MASCOT].join(", ")}.`);
    // The follow button sits in a different place on every platform: in the ending the mascot waves or rejoices, it points nowhere.
    if (text("pose") === "point") out.push(`${name}: в концовке персонаж машет (hi) или радуется (happy) и ни на что не показывает: кнопка подписки на каждой площадке в своём месте.`);
  }
  return out;
}
