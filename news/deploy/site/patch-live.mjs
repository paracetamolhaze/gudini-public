// Правки «Новостей» в ОБЩИХ файлах сайта. Здесь их единственное место, как у «3Д» (studio3d/deploy/site/patch-live.mjs):
// живые версии этих файлов — в запущенном образе (там уже правки «3Д»), а копия в git отстаёт, и коммит её правленой
// копии затёр бы чужую работу. Поэтому prepare.sh берёт файлы из контейнера сайта, а этот скрипт их правит.
//
// Каждая правка — точная замена строк, которые должны найтись ровно count раз (по умолчанию один). Иначе не пишется
// ничего и сборка останавливается: строку в живом файле поменяли — правку надо пересмотреть, а не накладывать вслепую.
// Повторный запуск узнаёт уже наложенную правку и ничего не меняет. Правки не трогают строк, которые правит «3Д»:
// оба скрипта ложатся на файл в любом порядке и узнают свои правки после чужих.
//
//   node patch-live.mjs <корень>          — правит файлы под <корнем> (слой сборки, worktree или основная папка)
//   node patch-live.mjs --check <корень>  — только проверяет, что все правки на месте (код 1, если нет)
//   node patch-live.mjs --list            — пути файлов, которые нужны правкам (они же в live-files.txt)
//   node patch-live.mjs --stdin <путь>    — правит текст файла <путь> из stdin и пишет результат в stdout
//
// lib/stats/formats.ts не правится: «формат» поста там — тип PostFormat из lib/stats/types.ts, и новый формат "news"
// потянул бы за собой POST_FORMATS, срезы статистики (slices.ts), проверку маршрута формата и выбор на странице.
// Пока зеркала «Новостей» в статистике считаются обычными роликами ("video").
import fs from "node:fs";
import path from "node:path";

// записи зеркал на странице публикаций ведут на /news/<id>, а не в главный редактор скрытого зеркала
const PUBLICATIONS = "публикации зеркал «Новостей» ведут на /news/<id>";
const PROJECTS = "зеркала «Новостей» скрыты из списка проектов";

/**
 * from/to — строки, которые заменяются целиком. remove — строка, которая уходит из файла вместе с переводом строки.
 * probe — кусок, который есть только в результате правки (или только в удаляемой строке): по нему правка, которой
 * ещё нет, отличается от изменившегося файла, где похожая строка уже стоит в другом виде.
 */
export const PATCHES = [
  {
    file: "app/api/projects/route.ts",
    what: `${PROJECTS} (импорт)`,
    from: ['import { createProject, listProjects, updateProject } from "@/lib/store";'],
    to: ['import { createProject, listProjects as listAllProjects, updateProject } from "@/lib/store";'],
  },
  {
    file: "app/api/projects/route.ts",
    what: `${PROJECTS} (список без них)`,
    from: ['import { buildStoryResearchPack } from "@/lib/storyResearch";'],
    to: [
      'import { buildStoryResearchPack } from "@/lib/storyResearch";',
      "",
      "// «Новости» (news/deploy/site/patch-live.mjs): their hidden mirrors only carry the publications of /news videos",
      "const listProjects = () => listAllProjects().filter((p) => !(p as { newsId?: string }).newsId);",
    ],
    probe: "listAllProjects().filter(",
  },
  {
    file: "lib/publications.ts",
    what: `${PUBLICATIONS} (импорт)`,
    from: ['import { readPublicationHistory } from "./publicationHistory";'],
    to: ['import { readPublicationHistory } from "./publicationHistory";', 'import { relinkNews } from "./news/links";'],
    probe: 'from "./news/links"',
  },
  {
    file: "lib/publications.ts",
    what: `${PUBLICATIONS} (ссылки готового списка)`,
    from: ["  return entries;"],
    to: [
      "  // «Новости» (news/deploy/site/patch-live.mjs): a hidden news mirror's entries lead to /news/<id>, not to its main editor",
      "  return relinkNews(entries, projects);",
    ],
  },
  {
    file: "app/components/Nav.tsx",
    what: "«Новости» в меню сразу после «Проектов»",
    from: ['  { href: "/", label: "Проекты", external: false, match: (p: string) => p === "/" || p.startsWith("/project/") },'],
    to: [
      '  { href: "/", label: "Проекты", external: false, match: (p: string) => p === "/" || p.startsWith("/project/") },',
      '  { href: "/news", label: "Новости", external: false, match: (p: string) => p.startsWith("/news") },',
    ],
    probe: 'href: "/news"',
  },
  {
    file: "lib/publish.ts",
    what: "заголовок — первой строкой подписи Instagram",
    from: ["  const caption = (description || title).slice(0, 2200);"],
    to: [
      "  // «Новости» (news/deploy/site/patch-live.mjs): the title goes first — Instagram has no title field, the owner typed it",
      "  // into every caption by hand (1.11); a caption that already starts with it is left as it is",
      "  const caption = (description && title && !description.trim().startsWith(title.trim()) ? `${title}\\n\\n${description}` : description || title).slice(0, 2200);",
    ],
    probe: "the title goes first — Instagram has no title field",
  },
  {
    file: "app/components/Nav.tsx",
    what: "«Мемы» убраны из меню",
    remove: '  { href: "/memes", label: "Мемы", external: false, match: (p: string) => p.startsWith("/memes") },',
    probe: 'href: "/memes"',
  },
  {
    file: "app/components/Nav.tsx",
    what: "«Расходы» убраны из меню",
    remove: '  { href: "/balances", label: "Расходы", external: false, match: (p: string) => p.startsWith("/balances") },',
    probe: 'href: "/balances"',
  },
];

export const FILES = [...new Set(PATCHES.map((p) => p.file))];

const count = (text, part) => (part ? text.split(part).length - 1 : 0);

const changed = (what) => `для правки «${what}» строка в живом файле не та, что ожидалась. Живой файл изменился — пересмотрите правку в news/deploy/site/patch-live.mjs.`;

/** One patch on the text: { text, applied } or { error }. */
function applyOne(text, patch, eol) {
  if (patch.remove !== undefined) {
    const line = patch.remove + eol;
    const n = count(text, line);
    if (n === 1) return { text: text.split(line).join(""), applied: true };
    // gone already — unless a line like it is still there in another shape
    if (n === 0 && !(patch.probe && text.includes(patch.probe))) return { text, applied: false };
    return { error: n > 1 ? `для правки «${patch.what}» удаляемая строка нашлась ${n} раз` : changed(patch.what) };
  }
  const n = patch.count ?? 1;
  const from = patch.from.join(eol);
  const to = patch.to.join(eol);
  // an insertion keeps its line, so after applying that line is still there n times (inside `to`)
  const fromLeft = to.includes(from) ? n : 0;
  if (count(text, to) === n && count(text, from) === fromLeft && (!patch.probe || count(text, patch.probe) === n)) return { text, applied: false };
  const found = count(text, from);
  if (found !== n) return { error: `для правки «${patch.what}» ожидалось совпадений: ${n}, найдено: ${found}. ${changed(patch.what)}` };
  // the result's own mark already elsewhere: the file got a similar change by hand, applying would double it
  if (patch.probe && text.includes(patch.probe)) return { error: `правка «${patch.what}»: в файле уже есть «${patch.probe}» в другом виде — пересмотрите правку` };
  return { text: text.split(from).join(to), applied: true };
}

/**
 * The patches of one file applied to its text: { text, notes } or { error }. A patch that does not fit fails the
 * whole file, so a file is never half-patched.
 */
export function patchText(text, patches) {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const notes = [];
  for (const patch of patches) {
    const r = applyOne(text, patch, eol);
    if (r.error) return { error: r.error };
    text = r.text;
    notes.push({ applied: r.applied, what: patch.what });
  }
  return { text, notes };
}

/** The live text of one shared file (path as in FILES) with the news patches; throws with the reason. */
export function patchFile(file, text) {
  const patches = PATCHES.filter((p) => p.file === file.replace(/\\/g, "/"));
  if (!patches.length) throw new Error(`для ${file} у «Новостей» правок нет`);
  const r = patchText(text, patches);
  if (r.error) throw new Error(`${file}: ${r.error}`);
  return r.text;
}

function main(argv) {
  if (argv[0] === "--list") {
    for (const f of FILES) console.log(f);
    return 0;
  }
  if (argv[0] === "--stdin") {
    if (!argv[1]) {
      console.error("Нужен путь файла: node patch-live.mjs --stdin <путь> < живой-файл");
      return 2;
    }
    try {
      process.stdout.write(patchFile(argv[1], fs.readFileSync(0, "utf8")));
      return 0;
    } catch (e) {
      console.error(`✖ ${e.message}`);
      return 1;
    }
  }
  const check = argv[0] === "--check";
  const root = check ? argv[1] : argv[0];
  if (!root) {
    console.error("Нужен корень: node patch-live.mjs [--check] <папка>");
    return 2;
  }
  const results = [];
  let failed = false;
  for (const file of FILES) {
    const full = path.join(root, file);
    let text;
    try {
      text = fs.readFileSync(full, "utf8");
    } catch {
      console.error(`✖ ${file}: файла нет — правки «Новостей» к нему не наложены`);
      failed = true;
      continue;
    }
    const r = patchText(text, PATCHES.filter((p) => p.file === file));
    if (r.error) {
      console.error(`✖ ${file}: ${r.error}`);
      failed = true;
      continue;
    }
    if (check) {
      for (const n of r.notes.filter((x) => x.applied)) {
        console.error(`✖ ${file}: нет правки «${n.what}»`);
        failed = true;
      }
      continue;
    }
    results.push({ file, full, text: r.text, notes: r.notes, changed: r.text !== text });
  }
  // all or nothing: when one file does not take its patches, no file is written
  if (failed) return 1;
  if (check) {
    console.log(`= все правки «Новостей» на месте в ${root}`);
    return 0;
  }
  for (const r of results) {
    if (r.changed) fs.writeFileSync(r.full, r.text);
    for (const n of r.notes) console.log(n.applied ? `✔ ${r.file}: ${n.what}` : `= ${r.file}: уже с правкой «${n.what}»`);
  }
  return 0;
}

// run as a script (prepare.sh, the tests); importing it only gives PATCHES, patchText and patchFile
if (path.basename(process.argv[1] ?? "") === "patch-live.mjs") process.exit(main(process.argv.slice(2)));
