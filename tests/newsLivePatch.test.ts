import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync, spawnSync } from "child_process";

/**
 * The build-time patches of live shared files (news/deploy/site/patch-live.mjs): exact, all or nothing, idempotent,
 * loud when a live file changed, and independent of the 3D patches of the same files (either script may run first).
 * The script is run as prepare.sh runs it. It is not part of the site image, so there this file is skipped; the
 * image build checks the patched files themselves instead (tests/newsPublish.test.ts).
 */

const SCRIPT = path.join(process.cwd(), "news", "deploy", "site", "patch-live.mjs");
const SCRIPT_3D = path.join(process.cwd(), "studio3d", "deploy", "site", "patch-live.mjs");
const skip = fs.existsSync(SCRIPT) ? false : "patch-live.mjs is not in the site image";

// the lines of the live files the patches look at, as they are on the site (the 3D patches already in)
const ROUTE = [
  'import { NextRequest, NextResponse } from "next/server";',
  'import { recordSiteSpend } from "@/lib/spendLog";',
  'import { createProject, listProjects, updateProject } from "@/lib/store";',
  'import { generateScript } from "@/lib/ai";',
  'import { buildStoryResearchPack } from "@/lib/storyResearch";',
  "",
  "export async function GET() {",
  "  // 3D mirrors only carry the publications of /3d videos: they are listed in that section, not here",
  "  return NextResponse.json(listProjects().filter((p) => !(p as { studio3dId?: string }).studio3dId));",
  "}",
  "",
].join("\r\n");

const PUBLICATIONS = [
  'import { schedulesOf } from "./carousel/scheduleState";',
  'import { listProjects } from "./store";',
  'import { projectLinks } from "./studio3d/links";',
  'import { listInstagramSchedules } from "./publicationSchedule";',
  'import { readPublicationHistory } from "./publicationHistory";',
  "export function localPublications(): Entry[] {",
  "  const entries: Entry[] = []; const projects = listProjects(); const history = readPublicationHistory();",
  "  const schedules = listInstagramSchedules();",
  "  // «3Д» (studio3d/deploy/site/patch-live.mjs): a hidden 3D mirror's entries lead to /3d/<id>, the rest to /project/<id>",
  "  const hrefOf = projectLinks(projects);",
  "  for (const h of history) entries.push({ ...h, href: hrefOf(h.projectId) });",
  "  for (const p of projects) for (const pub of p.publications) entries.push({ ...pub, href: hrefOf(p.id) });",
  "  for (const j of tik) entries.push({ id: `tiktok:${j.id}`, href: hrefOf(j.projectId) });",
  "  for (const j of schedules) entries.push({ ...j, href: hrefOf(j.projectId), cancel: { url: `/api/projects/${j.projectId}/publish` } });",
  "  return entries;",
  "}",
  "export async function publicationsOverview() {",
  "  return { entries: localPublications().sort((a,b) => b.at.localeCompare(a.at)), warnings: [], updatedAt: new Date().toISOString() };",
  "}",
  "",
].join("\r\n");

const NAV = [
  "const LINKS = [",
  '  { href: "/", label: "Проекты", external: false, match: (p: string) => p === "/" || p.startsWith("/project/") },',
  '  { href: "/carousel", label: "Карусели", external: false, match: (p: string) => p.startsWith("/carousel") },',
  '  { href: "/memes", label: "Мемы", external: false, match: (p: string) => p.startsWith("/memes") },',
  '  { href: "/3d", label: "3Д", external: false, match: (p: string) => p.startsWith("/3d") },',
  '  { href: "/publications", label: "Публикации", external: false, match: (p: string) => p.startsWith("/publications") },',
  '  { href: "/balances", label: "Расходы", external: false, match: (p: string) => p.startsWith("/balances") },',
  '  { href: "/settings", label: "Настройки", external: false, match: (p: string) => p.startsWith("/settings") },',
  "];",
  "",
].join("\n");

const PUBLISH = [
  "export async function publishInstagram(id: string, title: string, description: string) {",
  "  const caption = (description || title).slice(0, 2200);",
  "  return caption;",
  "}",
  "",
].join(String.fromCharCode(10));

const FILES = { "app/api/projects/route.ts": ROUTE, "lib/publications.ts": PUBLICATIONS, "app/components/Nav.tsx": NAV, "lib/publish.ts": PUBLISH };

function tree(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gudini-news-patch-"));
  for (const [file, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), text);
  }
  return root;
}

const run = (...args: string[]) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8" });
const run3d = (...args: string[]) => spawnSync(process.execPath, [SCRIPT_3D, ...args], { encoding: "utf8" });
const read = (root: string, file: string) => fs.readFileSync(path.join(root, file), "utf8");
const hrefs = (nav: string) => [...nav.matchAll(/href: "([^"]+)"/g)].map((m) => m[1]);

test("правки живых файлов: ложатся точно, второй раз ничего не меняют, --check их видит", { skip }, () => {
  const root = tree(FILES);
  try {
    assert.deepEqual(run("--list").stdout.trim().split(/\r?\n/), ["app/api/projects/route.ts", "lib/publications.ts", "app/components/Nav.tsx", "lib/publish.ts"]);
    assert.deepEqual(
      fs
        .readFileSync(path.join(path.dirname(SCRIPT), "live-files.txt"), "utf8")
        .split(/\r?\n/)
        .map((l) => l.replace(/#.*/, "").trim())
        .filter(Boolean),
      run("--list").stdout.trim().split(/\r?\n/),
      "live-files.txt lists the same files",
    );
    assert.equal(run("--check", root).status, 1, "nothing applied yet");

    const first = run(root);
    assert.equal(first.status, 0, first.stderr);
    const route = read(root, "app/api/projects/route.ts");
    assert.match(route, /import \{ createProject, listProjects as listAllProjects, updateProject \} from "@\/lib\/store";/);
    assert.match(route, /const listProjects = \(\) => listAllProjects\(\)\.filter\(\(p\) => !\(p as \{ newsId\?: string \}\)\.newsId\);/);
    assert.ok(route.indexOf("const listProjects") > route.indexOf('from "@/lib/storyResearch"'), "after every import");
    assert.ok(route.includes("listProjects().filter((p) => !(p as { studio3dId?: string }).studio3dId)"), "the 3D line stays as it is");
    assert.ok(!/[^\r]\n/.test(route), "a CRLF file stays CRLF, the inserted lines too");

    const pubs = read(root, "lib/publications.ts");
    assert.match(pubs, /import \{ readPublicationHistory \} from "\.\/publicationHistory";\r\nimport \{ relinkNews \} from "\.\/news\/links";\r\n/);
    assert.match(pubs, /  return relinkNews\(entries, projects\);\r\n\}/);
    assert.equal(pubs.split("return entries;").length - 1, 0);
    assert.ok(pubs.includes("  const hrefOf = projectLinks(projects);"), "the 3D links stay as they are");

    const nav = read(root, "app/components/Nav.tsx");
    assert.deepEqual(hrefs(nav), ["/", "/news", "/carousel", "/3d", "/publications", "/settings"], "«Новости» after «Проекты», no «Мемы» and «Расходы»");
    assert.match(nav, /label: "Новости"/);

    const publish = read(root, "lib/publish.ts");
    assert.ok(publish.includes("!description.trim().startsWith(title.trim()) ? `${title}" + String.fromCharCode(92) + "n" + String.fromCharCode(92) + "n${description}`"), "the title goes first in the Instagram caption");

    const second = run(root);
    assert.equal(second.status, 0, second.stderr);
    assert.match(second.stdout, /уже с правкой/);
    assert.doesNotMatch(second.stdout, /✔/);
    assert.equal(read(root, "lib/publications.ts"), pubs, "idempotent");
    assert.equal(read(root, "app/api/projects/route.ts"), route);
    assert.equal(read(root, "app/components/Nav.tsx"), nav);
    assert.equal(run("--check", root).status, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("правки «Новостей» и «3Д» ложатся в любом порядке и узнают друг друга", { skip: skip || (fs.existsSync(SCRIPT_3D) ? false : "no 3D patch script") }, () => {
  // the main folder's files: without the 3D patches
  const plain = {
    ...FILES,
    "app/api/projects/route.ts": ROUTE.replace(
      "  // 3D mirrors only carry the publications of /3d videos: they are listed in that section, not here\r\n  return NextResponse.json(listProjects().filter((p) => !(p as { studio3dId?: string }).studio3dId));",
      "  return NextResponse.json(listProjects());",
    ),
    "lib/publications.ts": PUBLICATIONS.replace('import { projectLinks } from "./studio3d/links";\r\n', "")
      .replace("  // «3Д» (studio3d/deploy/site/patch-live.mjs): a hidden 3D mirror's entries lead to /3d/<id>, the rest to /project/<id>\r\n  const hrefOf = projectLinks(projects);\r\n", "")
      .replace("href: hrefOf(h.projectId)", "href: `/project/${h.projectId}`")
      .replace("href: hrefOf(p.id)", "href: `/project/${p.id}`")
      .replaceAll("href: hrefOf(j.projectId)", "href: `/project/${j.projectId}`"),
  };
  const a = tree(plain);
  const b = tree(plain);
  try {
    assert.equal(run3d(a).status, 0);
    assert.equal(run(a).status, 0);
    assert.equal(run(b).status, 0);
    assert.equal(run3d(b).status, 0);
    for (const file of Object.keys(FILES)) assert.equal(read(a, file), read(b, file), file);
    assert.equal(read(a, "lib/publications.ts"), (() => {
      const live = tree(FILES);
      try {
        run(live);
        return read(live, "lib/publications.ts");
      } finally {
        fs.rmSync(live, { recursive: true, force: true });
      }
    })(), "the same as the live file (3D in) with the news patches");
    for (const root of [a, b]) {
      assert.equal(run("--check", root).status, 0);
      assert.equal(run3d("--check", root).status, 0);
    }
  } finally {
    fs.rmSync(a, { recursive: true, force: true });
    fs.rmSync(b, { recursive: true, force: true });
  }
});

test("правки живых файлов: изменившийся живой файл останавливает всё, ничего не записав", { skip }, () => {
  // the «Мемы» link got another shape: it cannot be removed blindly
  const changed = NAV.replace('label: "Мемы", external: false', 'label: "Мемы", external: true');
  const root = tree({ ...FILES, "app/components/Nav.tsx": changed });
  try {
    const r = run(root);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /app\/components\/Nav\.tsx: .*«Мемы»/);
    assert.equal(read(root, "app/components/Nav.tsx"), changed, "the file is not half-patched");
    assert.equal(read(root, "app/api/projects/route.ts"), ROUTE, "nor any other file");
    assert.equal(read(root, "lib/publications.ts"), PUBLICATIONS);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }

  // somebody already added a «Новости» link by hand: a second one is not added
  const twice = NAV.replace("];", '  { href: "/news", label: "Новости", external: false, match: (p: string) => p.startsWith("/news") },\n];');
  const r2 = tree({ ...FILES, "app/components/Nav.tsx": twice });
  try {
    const r = run(r2);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /href: "\/news"/);
  } finally {
    fs.rmSync(r2, { recursive: true, force: true });
  }

  // the anchor is gone
  const r3 = tree({ ...FILES, "lib/publications.ts": PUBLICATIONS.replace("  return entries;", "  return entries.slice();") });
  try {
    const r = run(r3);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /lib\/publications\.ts: .*ожидалось совпадений: 1, найдено: 0/);
    fs.rmSync(path.join(r3, "lib/publications.ts"));
    assert.match(run(r3).stderr, /lib\/publications\.ts: файла нет/);
  } finally {
    fs.rmSync(r3, { recursive: true, force: true });
  }
});

test("--stdin: живой текст одного файла в правленый", { skip }, () => {
  const r = spawnSync(process.execPath, [SCRIPT, "--stdin", "app/components/Nav.tsx"], { input: NAV, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(hrefs(r.stdout), ["/", "/news", "/carousel", "/3d", "/publications", "/settings"]);
  const bad = spawnSync(process.execPath, [SCRIPT, "--stdin", "lib/store.ts"], { input: "x", encoding: "utf8" });
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /правок нет/);
});

/** The main folder this worktree belongs to, where the shared files live; null when there is none. */
function mainFolder(): string | null {
  try {
    const common = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { encoding: "utf8" }).trim();
    const main = path.dirname(common);
    return path.resolve(main) !== path.resolve(process.cwd()) && fs.existsSync(path.join(main, "app", "components", "Nav.tsx")) ? main : null;
  } catch {
    return null;
  }
}

test("правки ложатся на сегодняшние файлы основной папки", { skip: skip || (mainFolder() ? false : "no main folder with the shared files") }, () => {
  const main = mainFolder()!;
  const files = run("--list").stdout.trim().split(/\r?\n/);
  const missing = files.filter((f) => !fs.existsSync(path.join(main, f)));
  if (missing.length) return void console.warn(`в основной папке нет ${missing.join(", ")} — проверка пропущена`);
  const root = tree(Object.fromEntries(files.map((f) => [f, fs.readFileSync(path.join(main, f), "utf8")])));
  try {
    const r = run(root);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(run("--check", root).status, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
