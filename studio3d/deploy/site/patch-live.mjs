// Правки «3Д» в ОБЩИХ файлах сайта. Здесь их единственное место: в репозиторий (ни в эту ветку, ни в master)
// они не коммитятся, потому что сами эти файлы — живая незакоммиченная работа основной папки
// C:\Users\user\Desktop\gudini (lib/publications.ts в git даже не добавлен), и коммит их копии из ветки
// «3Д» затёр бы чужие правки. Поэтому prepare.sh в момент сборки берёт файлы из основной папки и правит их
// здесь, а слой сайта несёт уже исправленные копии.
//
// Каждая правка — точная замена строки, которая должна найтись ровно count раз (по умолчанию один). Иначе
// не пишется ничего и сборка останавливается: если строку в живом файле поменяли, правку надо пересмотреть,
// а не накладывать вслепую. Повторный запуск узнаёт уже наложенную правку и ничего не меняет.
//
//   node patch-live.mjs <корень>          — правит файлы под <корнем> (слой сборки, worktree или основная папка)
//   node patch-live.mjs --check <корень>  — только проверяет, что все правки на месте (код 1, если нет)
//   node patch-live.mjs --list            — пути файлов, которые нужны правкам
//
// Когда ветку «3Д» сольют в master и сайт начнут собирать из основной папки целиком, правки надо один раз
// наложить на неё: node studio3d/deploy/site/patch-live.mjs <основная папка>, затем --check. Иначе зеркала
// публикаций «3Д» появятся в списке проектов, а их публикации поведут в главный редактор скрытого зеркала.
import fs from "node:fs";
import path from "node:path";

// записи зеркал на странице публикаций ведут на /3d/<id>, а не в главный редактор скрытого зеркала
const PUBLICATIONS = "публикации зеркал «3Д» ведут на /3d/<id>";

export const PATCHES = [
  {
    file: "app/api/projects/route.ts",
    // их публикации видны в разделе «3Д» и на странице публикаций
    what: "зеркала «3Д» скрыты из списка проектов",
    from: ["  return NextResponse.json(listProjects());"],
    to: [
      "  // 3D mirrors only carry the publications of /3d videos: they are listed in that section, not here",
      "  return NextResponse.json(listProjects().filter((p) => !(p as { studio3dId?: string }).studio3dId));",
    ],
  },
  {
    file: "lib/publications.ts",
    what: `${PUBLICATIONS} (импорт)`,
    from: ['import { listProjects } from "./store";'],
    to: ['import { listProjects } from "./store";', 'import { projectLinks } from "./studio3d/links";'],
  },
  {
    file: "lib/publications.ts",
    what: `${PUBLICATIONS} (ссылки по уже прочитанным проектам)`,
    from: ["  const schedules = listInstagramSchedules();"],
    to: [
      "  const schedules = listInstagramSchedules();",
      "  // «3Д» (studio3d/deploy/site/patch-live.mjs): a hidden 3D mirror's entries lead to /3d/<id>, the rest to /project/<id>",
      "  const hrefOf = projectLinks(projects);",
    ],
  },
  { file: "lib/publications.ts", what: `${PUBLICATIONS} (история)`, from: ["href: `/project/${h.projectId}`"], to: ["href: hrefOf(h.projectId)"] },
  { file: "lib/publications.ts", what: `${PUBLICATIONS} (публикации проектов)`, from: ["href: `/project/${p.id}`"], to: ["href: hrefOf(p.id)"] },
  {
    file: "lib/publications.ts",
    what: `${PUBLICATIONS} (задачи TikTok и расписания Instagram)`,
    from: ["href: `/project/${j.projectId}`"],
    to: ["href: hrefOf(j.projectId)"],
    count: 2,
  },
];

const count = (text, part) => text.split(part).length - 1;

/**
 * The patches of one file applied to its text: { text, notes } or { error }. A patch whose line is not found
 * exactly `count` times fails the whole file, so a file is never half-patched.
 */
export function patchText(text, patches) {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const notes = [];
  for (const patch of patches) {
    const n = patch.count ?? 1;
    const from = patch.from.join(eol);
    const to = patch.to.join(eol);
    // an insertion keeps its line, so after applying that line is still there n times (inside `to`)
    const fromLeft = to.includes(from) ? n : 0;
    if (count(text, to) === n && count(text, from) === fromLeft) {
      notes.push({ applied: false, what: patch.what });
      continue;
    }
    const found = count(text, from);
    if (found !== n) {
      return { error: `для правки «${patch.what}» ожидалось совпадений: ${n}, найдено: ${found}. Живой файл изменился — пересмотрите правку в patch-live.mjs.` };
    }
    text = text.split(from).join(to);
    notes.push({ applied: true, what: patch.what });
  }
  return { text, notes };
}

function main(argv) {
  if (argv[0] === "--list") {
    for (const f of new Set(PATCHES.map((p) => p.file))) console.log(f);
    return 0;
  }
  const check = argv[0] === "--check";
  const root = check ? argv[1] : argv[0];
  if (!root) {
    console.error("Нужен корень: node patch-live.mjs [--check] <папка>");
    return 2;
  }
  const results = [];
  let failed = false;
  for (const file of new Set(PATCHES.map((p) => p.file))) {
    const full = path.join(root, file);
    let text;
    try {
      text = fs.readFileSync(full, "utf8");
    } catch {
      console.error(`✖ ${file}: файла нет — правки «3Д» к нему не наложены`);
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
    console.log(`= все правки «3Д» на месте в ${root}`);
    return 0;
  }
  for (const r of results) {
    if (r.changed) fs.writeFileSync(r.full, r.text);
    for (const n of r.notes) console.log(n.applied ? `✔ ${r.file}: ${n.what}` : `= ${r.file}: уже с правкой «${n.what}»`);
  }
  return 0;
}

// run as a script (prepare.sh, the tests); importing it only gives PATCHES and patchText
if (path.basename(process.argv[1] ?? "") === "patch-live.mjs") process.exit(main(process.argv.slice(2)));
