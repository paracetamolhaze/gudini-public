import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync, spawnSync } from "child_process";

/**
 * The build-time patches of live shared files (studio3d/deploy/site/patch-live.mjs): exact, all or nothing,
 * idempotent, and loud when a live file changed. The script is run as prepare.sh runs it. It is not part of the
 * site image, so there this file is skipped; the image build checks the patched files themselves instead
 * (tests/studio3dPublish.test.ts).
 */

const SCRIPT = path.join(process.cwd(), "studio3d", "deploy", "site", "patch-live.mjs");
const skip = fs.existsSync(SCRIPT) ? false : "patch-live.mjs is not in the site image";

const ROUTE = [
  'import { NextRequest, NextResponse } from "next/server";',
  'import { createProject, listProjects, updateProject } from "@/lib/store";',
  "",
  "export async function GET() {",
  "  return NextResponse.json(listProjects());",
  "}",
  "",
].join("\r\n");

const PUBLICATIONS = [
  'import { listProjects } from "./store";',
  'import { listInstagramSchedules } from "./publicationSchedule";',
  "export function localPublications(): Entry[] {",
  "  const entries: Entry[] = []; const projects = listProjects(); const history = readPublicationHistory();",
  "  const schedules = listInstagramSchedules();",
  "  for (const h of history) entries.push({ ...h, href: `/project/${h.projectId}` });",
  "  for (const p of projects) for (const pub of p.publications) entries.push({ ...pub, href: `/project/${p.id}` });",
  "  for (const j of tik) entries.push({ id: `tiktok:${j.id}`, href: `/project/${j.projectId}` });",
  "  for (const j of schedules) entries.push({ ...j, href: `/project/${j.projectId}`, cancel: { url: `/api/projects/${j.projectId}/publish` } });",
  "  return entries;",
  "}",
  "",
].join("\n");

function tree(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gudini-3d-patch-"));
  for (const [file, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), text);
  }
  return root;
}

const run = (...args: string[]) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8" });
const read = (root: string, file: string) => fs.readFileSync(path.join(root, file), "utf8");

test("правки живых файлов: ложатся точно, второй раз ничего не меняют, --check их видит", { skip }, () => {
  const root = tree({ "app/api/projects/route.ts": ROUTE, "lib/publications.ts": PUBLICATIONS });
  try {
    assert.deepEqual(run("--list").stdout.trim().split(/\r?\n/), ["app/api/projects/route.ts", "lib/publications.ts"]);
    assert.equal(run("--check", root).status, 1, "nothing applied yet");

    const first = run(root);
    assert.equal(first.status, 0, first.stderr);
    const route = read(root, "app/api/projects/route.ts");
    assert.match(route, /listProjects\(\)\.filter\(\(p\) => !\(p as \{ studio3dId\?: string \}\)\.studio3dId\)/);
    assert.ok(!/[^\r]\n/.test(route), "a CRLF file stays CRLF, the inserted lines too");
    const pubs = read(root, "lib/publications.ts");
    assert.match(pubs, /^import \{ listProjects \} from "\.\/store";\nimport \{ projectLinks \} from "\.\/studio3d\/links";\n/);
    assert.match(pubs, /  const schedules = listInstagramSchedules\(\);\n  \/\/ «3Д».*\n  const hrefOf = projectLinks\(projects\);\n/);
    assert.equal(pubs.split("hrefOf(").length - 1, 4, "history, project publications, TikTok jobs, Instagram schedules");
    assert.ok(!pubs.includes("href: `/project/"), "no editor link is left");
    assert.ok(pubs.includes("url: `/api/projects/${j.projectId}/publish`"), "the cancel API link is not a page link and stays");

    const second = run(root);
    assert.equal(second.status, 0, second.stderr);
    assert.match(second.stdout, /уже с правкой/);
    assert.equal(read(root, "lib/publications.ts"), pubs, "idempotent");
    assert.equal(read(root, "app/api/projects/route.ts"), route);
    assert.equal(run("--check", root).status, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("правки живых файлов: изменившийся живой файл останавливает всё, ничего не записав", { skip }, () => {
  // the Instagram schedules row was rewritten: only one TikTok-style link is left where two are expected
  const changed = PUBLICATIONS.replace("  for (const j of schedules) entries.push({ ...j, href: `/project/${j.projectId}`,", "  for (const s of schedules) entries.push({ ...s, href: `/project/${s.projectId}`,");
  const root = tree({ "app/api/projects/route.ts": ROUTE, "lib/publications.ts": changed });
  try {
    const r = run(root);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /lib\/publications\.ts: .*ожидалось совпадений: 2, найдено: 1/);
    assert.equal(read(root, "lib/publications.ts"), changed, "the file is not half-patched");
    assert.equal(read(root, "app/api/projects/route.ts"), ROUTE, "nor any other file");

    fs.rmSync(path.join(root, "lib/publications.ts"));
    const missing = run(root);
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /lib\/publications\.ts: файла нет/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

/** The main folder this worktree belongs to, where the live shared files are; null when there is none. */
function mainFolder(): string | null {
  try {
    const common = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { encoding: "utf8" }).trim();
    const main = path.dirname(common);
    return path.resolve(main) !== path.resolve(process.cwd()) && fs.existsSync(path.join(main, "lib", "publications.ts")) ? main : null;
  } catch {
    return null;
  }
}

test("правки ложатся на сегодняшние живые файлы основной папки", { skip: skip || (mainFolder() ? false : "no main folder with the live files") }, () => {
  const main = mainFolder()!;
  const files = run("--list").stdout.trim().split(/\r?\n/);
  const root = tree(Object.fromEntries(files.map((f) => [f, fs.readFileSync(path.join(main, f), "utf8")])));
  try {
    const r = run(root);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(run("--check", root).status, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
