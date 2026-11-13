import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { NextRequest } from "next/server";

/**
 * Publishing «3Д» through the hidden main-site mirror, the caption and the 3D cover — without the network and
 * without paid calls: the main site's data folder is a temp folder (the main store reads cwd/data), no account
 * is connected (the main publish answers "demo"), and the cover and caption models are replaced by fakes.
 */

const root = fs.mkdtempSync(path.join(os.tmpdir(), "gudini-3d-publish-"));
const startDir = process.cwd();
// the headline layout measures with the site's fonts, found by cwd like on the server
fs.cpSync(path.join(startDir, "fonts"), path.join(root, "fonts"), { recursive: true });
process.chdir(root);
process.env.STUDIO3D_DATA_DIR = path.join(root, "data", "studio3d");
// TikTok goes the API way and, without tokens, to demo; the browser worker is never called
delete process.env.TIKTOK_TRANSPORT;
delete process.env.TIKTOK_DIRECT_POST;
process.env.STUDIO3D_AUTO_PREP = "off";

let store3d: typeof import("../lib/studio3d/store");
let site: typeof import("../lib/store");
let pub: typeof import("../lib/studio3d/publish");
let meta: typeof import("../lib/studio3d/meta");
let cover: typeof import("../lib/studio3d/cover");
let links: typeof import("../lib/studio3d/links");
let costLedger: typeof import("../lib/costLedger");
let spendLog: typeof import("../lib/spendLog");
let publishRoute: typeof import("../app/api/3d/[id]/publish/route");
let metaRoute: typeof import("../app/api/3d/[id]/meta/route");
let coverRoute: typeof import("../app/api/3d/[id]/cover/route");
let projectsRoute: typeof import("../app/api/projects/route");
let listRoute: typeof import("../app/api/3d/route");
let projectRoute: typeof import("../app/api/3d/[id]/route");
let workerJobsRoute: typeof import("../app/api/worker/jobs/route");

before(async () => {
  store3d = await import("../lib/studio3d/store");
  site = await import("../lib/store");
  pub = await import("../lib/studio3d/publish");
  meta = await import("../lib/studio3d/meta");
  cover = await import("../lib/studio3d/cover");
  links = await import("../lib/studio3d/links");
  costLedger = await import("../lib/costLedger");
  spendLog = await import("../lib/spendLog");
  publishRoute = await import("../app/api/3d/[id]/publish/route");
  metaRoute = await import("../app/api/3d/[id]/meta/route");
  coverRoute = await import("../app/api/3d/[id]/cover/route");
  projectsRoute = await import("../app/api/projects/route");
  listRoute = await import("../app/api/3d/route");
  projectRoute = await import("../app/api/3d/[id]/route");
  workerJobsRoute = await import("../app/api/worker/jobs/route");
});
after(async () => {
  process.chdir(startDir);
  // Windows may still hold a file of the temp folder for a moment; a leftover temp folder is not a failure
  await fs.promises.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }).catch((e) => console.warn("temp folder left:", e.message));
});

const url = (p: string) => `http://localhost${p}`;
const json = (p: string, method: string, body: unknown) =>
  new NextRequest(url(p), { method, body: typeof body === "string" ? body : JSON.stringify(body), headers: { "Content-Type": "application/json" } });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

let clock = Date.parse("2026-10-22T10:00:00Z");
const tick = () => new Date((clock += 1000)).toISOString();

const SCRIPT = {
  title: "Всё на биткоин",
  lines: [
    { who: "me" as const, text: "[excited] Клод, я всё вложу в биткоин." },
    { who: "claude" as const, text: "[laughs] А на еду что останется?" },
  ],
};

async function setVideo(id: string, content: string) {
  fs.writeFileSync(store3d.videoPath(id), content);
  const at = tick();
  await store3d.mutate(id, (q) => {
    q.video = { file: "out.mp4", at, duration: 12, scriptVersion: 1 };
  });
  return store3d.getProject(id)!;
}

async function videoProject(content = "video-1") {
  const p = await store3d.createProject("Почему не надо всё в биткоин");
  await store3d.mutate(p.id, (q) => {
    q.job = null;
    q.script = SCRIPT;
    q.scriptVersion = 1;
  });
  return setVideo(p.id, content);
}

const mirrorsOf = (id: string) => site.listProjects().filter((m) => (m as { studio3dId?: string }).studio3dId === id);

// ---- the mirror

test("зеркало: одно на проект, скрытое, «готово»; видео кладётся заново только после нового монтажа", async () => {
  const p = await videoProject("video-1");
  const m = (await pub.ensureMirror(p.id))!;
  assert.ok(m);
  assert.equal(m.studio3dId, p.id);
  assert.equal(m.processing.state, "done");
  assert.equal(m.processedVideo, "out.mp4");
  assert.equal(m.rawVideo, null);
  assert.equal(m.topic, "Всё на биткоин");
  assert.match(m.script ?? "", /^Ты: Клод, я всё вложу в биткоин\.\nКлод: А на еду что останется\?$/, "voice tags never reach the caption writer");
  assert.equal(store3d.getProject(p.id)!.mirrorId, m.id);
  const mirrorVideo = path.join(site.projectDir(m.id), "out.mp4");
  assert.equal(fs.readFileSync(mirrorVideo, "utf8"), "video-1");

  // the same video is not placed again: a marker file of the same size survives the next sync
  fs.rmSync(mirrorVideo);
  fs.writeFileSync(mirrorVideo, "VIDEO-1");
  const again = (await pub.ensureMirror(p.id))!;
  assert.equal(again.id, m.id);
  assert.equal(fs.readFileSync(mirrorVideo, "utf8"), "VIDEO-1");

  // a new montage is placed
  await setVideo(p.id, "video-2, longer");
  await pub.ensureMirror(p.id);
  assert.equal(fs.readFileSync(mirrorVideo, "utf8"), "video-2, longer");
  assert.equal(mirrorsOf(p.id).length, 1);

  // hidden from the main projects list (and so from the montage worker's orphan check); no worker job for it
  const normal = site.createProject("Обычный ролик");
  const listed = (await (await projectsRoute.GET()).json()) as { id: string }[];
  assert.ok(listed.some((x) => x.id === normal.id));
  assert.ok(!listed.some((x) => x.id === m.id));
  const { jobs } = (await (await workerJobsRoute.GET()).json()) as { jobs: string[] };
  assert.ok(!jobs.includes(m.id));
});

test("зеркало: параллельные вызовы, потерянный mirrorId и чужой проект в mirrorId не плодят зеркал", async () => {
  const p = await videoProject();
  const made = await Promise.all([pub.ensureMirror(p.id), pub.ensureMirror(p.id), pub.ensureMirror(p.id)]);
  assert.equal(new Set(made.map((m) => m!.id)).size, 1);
  assert.equal(mirrorsOf(p.id).length, 1);
  const mirrorId = made[0]!.id;

  // the site stopped between creating the mirror and storing its id: found again by the mark
  await store3d.mutate(p.id, (q) => {
    q.mirrorId = null;
  });
  assert.equal((await pub.ensureMirror(p.id))!.id, mirrorId);
  assert.equal(store3d.getProject(p.id)!.mirrorId, mirrorId);

  // an id of a real main project is never taken over
  const normal = site.createProject("Чужой проект");
  await store3d.mutate(p.id, (q) => {
    q.mirrorId = normal.id;
  });
  assert.equal((await pub.ensureMirror(p.id))!.id, mirrorId);
  assert.equal((site.getProject(normal.id) as { studio3dId?: string }).studio3dId, undefined);
  assert.equal(mirrorsOf(p.id).length, 1);

  // only refreshing (after a montage) never creates one
  const fresh = await videoProject();
  assert.equal(await pub.ensureMirror(fresh.id, { create: false }), null);
  assert.equal(mirrorsOf(fresh.id).length, 0);
});

// ---- publishing routes

test("публикация: проверки как у основного маршрута, отправка через зеркало, отмена", async () => {
  const p = await videoProject();
  const post = (id: string, body: unknown) => publishRoute.POST(json(`/api/3d/${id}/publish`, "POST", body), ctx(id));
  const del = (id: string, body: unknown) => publishRoute.DELETE(json(`/api/3d/${id}/publish`, "DELETE", body), ctx(id));

  assert.equal((await post("../db", { platform: "youtube" })).status, 400);
  assert.equal((await post(p.id, "{не json")).status, 400);
  assert.equal((await post(p.id, { platform: "vk" })).status, 400);
  assert.equal((await post(p.id, { platform: "youtube", mode: "later" })).status, 400);
  assert.equal((await post(p.id, { platform: "instagram", instagramTrial: "yes" })).status, 400);
  assert.equal((await post(p.id, { platform: "youtube", instagramTrial: true })).status, 400);
  assert.equal((await post(p.id, { platform: "instagram", instagramTrial: true, mode: "draft" })).status, 400);
  assert.equal((await post(p.id, { platform: "youtube", scheduledAt: "завтра" })).status, 400);
  assert.equal((await post("zzzzzzzzzz", { platform: "youtube" })).status, 404);

  const bare = await store3d.createProject("Ролика ещё нет");
  assert.equal((await post(bare.id, { platform: "youtube" })).status, 409);
  assert.equal(mirrorsOf(bare.id).length, 0);

  // the caption is set first: publishing without one would call the caption model
  const put = await metaRoute.PUT(json(`/api/3d/${p.id}/meta`, "PUT", { title: "Всё на биткоин?", description: "Клод против", hashtags: "#крипта биткоин" }), ctx(p.id));
  assert.equal(put.status, 200);

  // the main publish refuses a schedule too close and a scheduled draft — its words come through as 400
  const soon = await post(p.id, { platform: "youtube", scheduledAt: new Date(Date.now() + 30_000).toISOString() });
  assert.equal(soon.status, 400);
  assert.match((await soon.json()).error, /минимум через 2 минуты/);
  const draftLater = await post(p.id, { platform: "youtube", mode: "draft", scheduledAt: new Date(Date.now() + 3_600_000).toISOString() });
  assert.equal(draftLater.status, 400);
  const igLater = await post(p.id, { platform: "instagram", scheduledAt: new Date(Date.now() + 3_600_000).toISOString() });
  assert.equal(igLater.status, 400, "no Instagram account: the main scheduler refuses");

  // no account connected: the main code answers with a demo publication, stored on the mirror
  const sent = await post(p.id, { platform: "youtube" });
  assert.equal(sent.status, 200, await sent.clone().text());
  const { publication, view } = await sent.json();
  assert.equal(publication.status, "demo");
  assert.equal(view.publications.find((x: { platform: string }) => x.platform === "youtube")?.status, "demo");
  const mirror = site.getProject(view.mirrorId)!;
  assert.equal(mirror.meta?.title, "Всё на биткоин?");
  assert.deepEqual(mirror.meta?.hashtags, ["#крипта", "#биткоин"]);
  assert.equal(view.sent.youtube.videoAt, p.video!.at);
  assert.deepEqual(view.connected, { youtube: false, tiktok: false, instagram: false });
  assert.deepEqual(view.accounts, { youtube: null, tiktok: null, instagram: null });
  assert.ok(fs.readFileSync(path.join(root, "data", "publication-history.jsonl"), "utf8").includes(view.mirrorId));

  // a newer montage than the one that went out: the page is told which networks carry the old one
  site.updateProject(view.mirrorId, { publications: [{ platform: "youtube", status: "published", at: tick(), url: "https://youtube.com/shorts/x" }] });
  await setVideo(p.id, "video-2");
  const viewNow = await (await publishRoute.GET(new NextRequest(url(`/api/3d/${p.id}/publish`)), ctx(p.id))).json();
  assert.deepEqual(viewNow.stale, ["youtube"]);

  // cancel: YouTube schedules live in YouTube Studio; Instagram has nothing scheduled — fine
  assert.equal((await del(p.id, { platform: "vk" })).status, 400);
  assert.equal((await del(p.id, { platform: "youtube" })).status, 400);
  assert.equal((await del(p.id, { platform: "instagram" })).status, 200);
  assert.equal((await del(bare.id, { platform: "instagram" })).status, 409);
});

// ---- the list and the delete

test("список: обложка и куда ушёл ролик; удаление забирает зеркало, но не пока ролик отправляется", async () => {
  const p = await videoProject("video-list");
  const marksOf = (id: string) => pub.listMarks([store3d.getProject(id)!]).get(id)!;
  assert.deepEqual(marksOf(p.id), { cover: null, published: [] }, "no mirror, no cover: nothing to mark");

  const mirror = (await pub.ensureMirror(p.id))!;
  site.updateProject(mirror.id, {
    publications: [
      { platform: "youtube", status: "published", at: tick(), url: "https://youtube.com/shorts/x" },
      { platform: "instagram", status: "published", instagramTrial: true, at: tick() },
      { platform: "tiktok", status: "draft", at: tick() },
    ],
  });
  // a cover that failed or whose file is gone is not shown
  const coverAt = tick();
  await store3d.mutate(p.id, (q) => {
    q.cover = { file: cover.COVER_FILE, at: coverAt, status: "ok" };
  });
  assert.equal(marksOf(p.id).cover, null, "the file is not there yet");
  fs.writeFileSync(path.join(store3d.projectDir(p.id), cover.COVER_FILE), "jpeg");
  assert.deepEqual(marksOf(p.id), {
    cover: { at: coverAt },
    published: [
      { platform: "youtube", state: "published" },
      { platform: "instagram", state: "published", trial: true },
    ],
  });
  const listed = ((await (await listRoute.GET()).json()) as { projects: { id: string; cover: unknown; published: unknown[] }[] }).projects;
  const row = listed.find((x) => x.id === p.id)!;
  assert.deepEqual(row.cover, { at: coverAt });
  assert.equal(row.published.length, 2);
  assert.ok(listed.every((x) => Array.isArray(x.published)), "every row has its marks, even without a mirror");

  // sends on their way are marked by state; whether they hold the delete is read from the queues themselves
  // (the next test): the stored statuses only show the newest send per network
  for (const [status, state] of [["scheduled", "scheduled"], ["queued", "sending"], ["running", "sending"], ["needs_login", "login"], ["error", null], ["cancelled", null], ["demo", null]] as const) {
    site.updateProject(mirror.id, { publications: [{ platform: "instagram", status, at: tick() }] });
    assert.deepEqual(marksOf(p.id).published, state ? [{ platform: "instagram", state }] : [], status);
  }

  // a YouTube schedule lives in YouTube Studio: it does not hold the mirror
  const del = () => projectRoute.DELETE(new NextRequest(url(`/api/3d/${p.id}`), { method: "DELETE" }), ctx(p.id));
  site.updateProject(mirror.id, { publications: [{ platform: "youtube", status: "scheduled", at: tick() }] });
  const done = await del();
  assert.equal(done.status, 200, await done.clone().text());
  assert.equal(store3d.getProject(p.id), null);
  assert.equal(site.getProject(mirror.id), null, "the mirror goes with the sketch");
  // site.projectDir would make the folder again: the path is checked as it is
  assert.equal(fs.existsSync(path.join(site.UPLOADS_DIR, mirror.id)), false, "and the copy of the video with it");
  assert.equal((await del()).status, 404);

  // a sketch that never had a mirror is deleted as before
  const bare = await store3d.createProject("Без публикаций");
  await store3d.mutate(bare.id, (q) => {
    q.job = null;
  });
  assert.equal((await projectRoute.DELETE(new NextRequest(url(`/api/3d/${bare.id}`), { method: "DELETE" }), ctx(bare.id))).status, 200);
  assert.equal(store3d.getProject(bare.id), null);
});

const TIKTOK_STATE_DIR = path.join(root, "data", "tiktok-browser");

/** TikTok through the browser worker for the duration of fn, with its state file; the worker itself is never called. */
async function withBrowserTikTok<T>(state: object, fn: () => Promise<T> | T): Promise<T> {
  process.env.TIKTOK_TRANSPORT = "browser";
  fs.mkdirSync(TIKTOK_STATE_DIR, { recursive: true });
  fs.writeFileSync(path.join(TIKTOK_STATE_DIR, "state.json"), JSON.stringify({ connected: true, autoPublish: true, seen: [], jobs: [], ...state }));
  try {
    return await fn();
  } finally {
    delete process.env.TIKTOK_TRANSPORT;
    delete process.env.TIKTOK_DIRECT_POST;
    fs.rmSync(TIKTOK_STATE_DIR, { recursive: true, force: true });
  }
}

test("TikTok через браузер публикуется сразу и с TIKTOK_DIRECT_POST=1, как на основной странице", async () => {
  // production: compose gives TIKTOK_TRANSPORT=browser, .env gives TIKTOK_DIRECT_POST=1
  process.env.TIKTOK_DIRECT_POST = "1";
  await withBrowserTikTok({ accountLabel: "@gudini" }, () => {
    const s = pub.accountsSummary();
    assert.deepEqual(s.tiktok, { browser: true, direct: false }, "the panel and «во все подключённые» do not hold TikTok back");
    assert.equal(s.connected.tiktok, true);
    assert.equal(s.accounts.tiktok, "@gudini");
  });
  // the API way's direct post needs the main TikTok form (privacy choice): only there the 3D page offers drafts
  process.env.TIKTOK_DIRECT_POST = "1";
  try {
    assert.deepEqual(pub.accountsSummary().tiktok, { browser: false, direct: true });
  } finally {
    delete process.env.TIKTOK_DIRECT_POST;
  }
  assert.deepEqual(pub.accountsSummary().tiktok, { browser: false, direct: false });
});

test("ссылки зеркал: /3d/<id> вместо главного редактора, обычные проекты — /project/<id>", () => {
  const hrefOf = links.projectLinks([{ id: "m1", studio3dId: "abc123" } as { id: string }, { id: "n1" }, { id: "x1", studio3dId: "" } as { id: string }]);
  assert.equal(hrefOf("m1"), "/3d/abc123");
  assert.equal(hrefOf("n1"), "/project/n1");
  assert.equal(hrefOf("x1"), "/project/x1", "an empty mark is not a mirror");
  assert.equal(hrefOf("gone"), "/project/gone", "a project that is not there any more keeps its old link");
  assert.equal(links.mirrorOf({ studio3dId: "abc123" }), "abc123");
  assert.equal(links.mirrorOf({ studio3dId: 5 }), null);
  assert.equal(links.mirrorOf(null), null);
  assert.equal(pub.MIRROR_MARK, links.MIRROR_MARK);
});

// lib/publications.ts is a live file of the main folder (not in git): the worktree has no copy, the image build has
// the copy that prepare.sh took and patch-live.mjs patched, and this test checks that patched file there
const LIVE_PUBLICATIONS = path.join(startDir, "lib", "publications.ts");

test(
  "страница публикаций: история, публикации и задачи TikTok зеркала ведут на /3d/<id>",
  { skip: fs.existsSync(LIVE_PUBLICATIONS) ? false : "lib/publications.ts — живой файл основной папки; проверяется при сборке образа" },
  async () => {
    const spec = "../lib/publications";
    const { localPublications } = (await import(spec)) as { localPublications: () => { id: string; href: string }[] };
    const p = await videoProject();
    await meta.saveMeta(p.id, { title: "Всё на биткоин?", description: "", hashtags: [] });
    const { publication, view } = await pub.publish3D(p.id, { platform: "youtube", mode: "live", instagramTrial: false });
    assert.equal(publication.status, "demo");
    const mirrorId = view.mirrorId!;
    const normal = site.createProject("Обычный ролик с публикацией");
    site.updateProject(normal.id, { publications: [{ platform: "youtube", status: "published", at: tick(), url: "https://youtube.com/shorts/n" }] });
    const job = { id: "job-3d", key: "k", projectId: mirrorId, account: "a", caption: "Всё на биткоин?", video: "out.mp4", scheduledAt: tick(), status: "queued", message: "", at: tick() };
    const entries = await withBrowserTikTok({ jobs: [job] }, () => localPublications());
    const to3d = entries.filter((e) => e.href === `/3d/${p.id}`);
    assert.ok(to3d.some((e) => e.id.startsWith("history:")), "the history entry of the 3D video");
    assert.ok(to3d.some((e) => e.id === "tiktok:job-3d"), "the TikTok job of the mirror");
    assert.ok(entries.some((e) => e.href === `/project/${normal.id}`), "an ordinary project keeps its editor link");
    const mirrorIds = new Set(site.listProjects().filter((m) => links.mirrorOf(m)).map((m) => m.id));
    assert.deepEqual(
      entries.filter((e) => mirrorIds.has(e.href.replace(/^\/project\//, ""))).map((e) => e.href),
      [],
      "no entry leads into a hidden mirror's main editor",
    );
  },
);

// ---- caption

test("описание: правка проверяется целиком, модельное — подгоняется, ручное не затирается автоматическим", async () => {
  const p = await videoProject();
  const put = (body: unknown) => metaRoute.PUT(json(`/api/3d/${p.id}/meta`, "PUT", body), ctx(p.id));
  assert.equal((await put({ title: "Без остального" })).status, 400);
  assert.equal((await put({ title: "", description: "", hashtags: [] })).status, 400);
  assert.equal((await put({ title: "x".repeat(101), description: "", hashtags: [] })).status, 400);
  assert.equal((await put({ title: "Ок", description: "", hashtags: "#крипта!" })).status, 400);
  assert.equal((await put({ title: "Ок", description: "y".repeat(2001), hashtags: [] })).status, 400);
  assert.equal((await put({ title: "Ок", description: "", hashtags: Array.from({ length: 31 }, (_, i) => `t${i}`) })).status, 400);
  const ok = await put({ title: "  Всё   на биткоин ", description: "Строка 1\r\nСтрока 2", hashtags: ["крипта", "#Крипта", "#btc"] });
  assert.equal(ok.status, 200);
  const saved = (await ok.json()).meta;
  assert.deepEqual(saved, { title: "Всё на биткоин", description: "Строка 1\nСтрока 2", hashtags: ["#крипта", "#btc"] });

  assert.equal(meta.dialogueText(SCRIPT), "Ты: Клод, я всё вложу в биткоин.\nКлод: А на еду что останется?");
  // a line with no letters or digits once its tags are gone is not said (the voice jobs' rule too)
  const silent = {
    title: "т",
    lines: [...SCRIPT.lines, { who: "claude" as const, text: "[laughs]" }, { who: "me" as const, text: "[pause] …" }, { who: "claude" as const, text: "[sighs] 100%" }],
  };
  assert.equal(meta.dialogueText(silent), "Ты: Клод, я всё вложу в биткоин.\nКлод: А на еду что останется?\nКлод: 100%");

  // the generated caption is fitted, never rejected
  const q = await videoProject();
  let calls = 0;
  const generate = async (_topic: string, script: string) => {
    calls++;
    assert.match(script, /^Ты: /);
    return { meta: { title: "Очень ".repeat(40), description: "Описание", hashtags: ["крипта", "#крипта", "плохой тег!"] } };
  };
  const made = await meta.regenerateMeta(q.id, {}, { generate });
  assert.ok(made.meta!.title.length <= meta.META_TITLE_MAX);
  assert.ok(!made.meta!.title.endsWith(" "));
  assert.deepEqual(made.meta!.hashtags, ["#крипта"]);

  // the automatic one keeps what the owner typed while the model was writing
  const r = await videoProject();
  const slow = async () => {
    await meta.saveMeta(r.id, { title: "Моё", description: "", hashtags: [] });
    return { meta: { title: "Модельное", description: "", hashtags: [] } };
  };
  await meta.regenerateMeta(r.id, { onlyIfMissing: true }, { generate: slow });
  assert.equal(store3d.getProject(r.id)!.meta!.title, "Моё");
  await meta.regenerateMeta(r.id, { onlyIfMissing: true }, { generate });
  assert.equal(calls, 1, "an existing caption is not regenerated automatically");
});

// ---- cover

function fakeCover(opts: { candidates?: string[]; anchors?: string[]; fail?: boolean; image?: string } = {}) {
  const calls = { concept: 0, image: 0, prompts: [] as string[] };
  const deps: Partial<import("../lib/studio3d/cover").CoverDeps3D> = {
    blocked: () => null,
    spend: (_id, _topic, fn) => fn(),
    grabFrame: async (_video, work) => {
      const file = path.join(work, "frame.jpg");
      fs.writeFileSync(file, "frame");
      return { file, at: 4.2 };
    },
    concept: async () => {
      calls.concept++;
      const head = (opts.candidates ?? ["БИТКОИН НА ЕДУ"])[0];
      return {
        headline: head,
        headlineLines: [{ text: head }] as never,
        headlineCandidates: opts.candidates ?? ["БИТКОИН НА ЕДУ"],
        headlineAnchor: opts.anchors ?? ["биткоин"],
        emotion: "tense realization",
        scene: { mainSubject: "", storyObject: "coin", environment: "desk" },
        composition: { facePosition: "center", faceScale: "large", headlineArea: "lower", allowHands: false },
        design_notes: [],
      };
    },
    generateImage: async (prompt, frame, out) => {
      calls.image++;
      calls.prompts.push(prompt);
      assert.equal(fs.readFileSync(frame, "utf8"), "frame", "the video frame is the reference image");
      if (opts.fail) throw new Error("IMAGE_PROVIDER_ERROR: 500 {}");
      fs.writeFileSync(out, opts.image ?? "picture");
      return { cost: 0.07 };
    },
    finish: async (_dir, src, out) => {
      fs.copyFileSync(src, out);
      return out;
    },
    encodeFinal: async (_dir, base, out) => {
      fs.copyFileSync(base, out);
      return out;
    },
  };
  return { deps, calls };
}

test("обложка: кадр как образец, заголовок через шлюз, прежняя возвращается при неудаче", async () => {
  const p = await videoProject();
  const first = fakeCover({ image: "first" });
  const made = await cover.makeCover3D(p.id, {}, first.deps);
  assert.equal(made.ok, true);
  assert.equal(made.project.cover?.status, "ok");
  assert.equal(made.project.cover?.headline, "БИТКОИН НА ЕДУ");
  assert.equal(made.project.cover?.videoAt, p.video!.at);
  assert.equal(first.calls.image, 1);
  const prompt = first.calls.prompts[0];
  assert.match(prompt, /"БИТКОИН\sНА ЕДУ"/, "the exact headline, broken into lines like the main covers");
  assert.match(prompt, /YORK/);
  assert.match(prompt, /#d97757/);
  assert.match(prompt, /Not photorealistic/);
  const file = path.join(store3d.projectDir(p.id), "cover.jpg");
  assert.equal(fs.readFileSync(file, "utf8"), "first");

  const got = await coverRoute.GET(new NextRequest(url(`/api/3d/${p.id}/cover`)), ctx(p.id));
  assert.equal(got.status, 200);
  assert.equal(got.headers.get("content-type"), "image/jpeg");
  assert.equal(await got.text(), "first");

  // the mirror takes the cover with it
  const m = (await pub.ensureMirror(p.id))!;
  assert.equal(m.cover, "cover.jpg");
  assert.equal(fs.readFileSync(path.join(site.projectDir(m.id), "cover.jpg"), "utf8"), "first");

  // the next one fails: the previous cover stays, nothing else changes
  const broken = fakeCover({ fail: true });
  const failed = await cover.makeCover3D(p.id, {}, broken.deps);
  assert.equal(failed.ok, false);
  assert.equal(failed.kept, true);
  assert.match(failed.error ?? "", /оставлена прежняя/);
  assert.equal(fs.readFileSync(file, "utf8"), "first");
  assert.equal(fs.existsSync(path.join(store3d.projectDir(p.id), "cover-prev.jpg")), false);
  assert.equal(store3d.getProject(p.id)!.cover?.headline, "БИТКОИН НА ЕДУ");

  // the owner's headline skips the topic gate
  const own = fakeCover({ anchors: ["эфир"] });
  const mine = await cover.makeCover3D(p.id, { headline: "плечо сгорело" }, own.deps);
  assert.equal(mine.ok, true);
  assert.equal(mine.project.cover?.headline, "ПЛЕЧО СГОРЕЛО");
});

test("обложка: слабый заголовок не стоит картинки, без ключа — без вызовов, одна за раз", async () => {
  const p = await videoProject();
  const weak = fakeCover({ candidates: ["ВСЁ ПРОПАЛО"], anchors: ["биткоин"] });
  const r = await cover.makeCover3D(p.id, {}, weak.deps);
  assert.equal(r.ok, false);
  assert.equal(r.project.cover?.status, "headline_failed");
  assert.equal(weak.calls.image, 0);
  assert.equal(weak.calls.concept, 2, "one more text attempt, then stop");
  assert.equal(cover.coverFile(r.project), null);
  assert.equal((await coverRoute.GET(new NextRequest(url(`/api/3d/${p.id}/cover`)), ctx(p.id))).status, 404);

  const off = fakeCover();
  const blocked = await cover.makeCover3D(p.id, {}, { ...off.deps, blocked: () => "нет ключа OpenRouter" });
  assert.equal(blocked.project.cover?.status, "failed");
  assert.equal(blocked.project.cover?.reason, "нет ключа OpenRouter");
  assert.equal(off.calls.concept + off.calls.image, 0);

  // one cover per project at a time: the second press waits for the first
  const slow = fakeCover();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const first = cover.makeCover3D(p.id, {}, { ...slow.deps, grabFrame: async (v, w, d) => (await gate, slow.deps.grabFrame!(v, w, d)) });
  await assert.rejects(cover.makeCover3D(p.id, {}, slow.deps), (e: { status?: number }) => e.status === 409);
  release();
  assert.equal((await first).ok, true);

  // the route checks the headline before anything is paid
  const long = await coverRoute.POST(json(`/api/3d/${p.id}/cover`, "POST", { headline: "x".repeat(61) }), ctx(p.id));
  assert.equal(long.status, 400);
  const bare = await store3d.createProject("Ролика нет");
  assert.equal((await coverRoute.POST(json(`/api/3d/${bare.id}/cover`, "POST", {}), ctx(bare.id))).status, 409);
});

test("расходы обложки и описания пишутся без projectId: на «Расходах» нет ссылки /project/<id 3Д>", async () => {
  const p = await videoProject();
  const paid = fakeCover({ image: "paid" });
  // the live spend wrapper stays; the "image" reports its price into the ledger like the real call does
  const { spend: _testSpend, ...live } = paid.deps;
  const r = await cover.makeCover3D(p.id, {}, {
    ...live,
    generateImage: async (prompt, frame, out) => {
      const done = await paid.deps.generateImage!(prompt, frame, out);
      costLedger.recordFlat({ stage: "Cover Generation", provider: "openrouter", model: "test-image", cost: 0.07 });
      return done;
    },
  });
  assert.equal(r.ok, true);
  await meta.siteSpend("Всё на биткоин", "Описание (3Д)", async () => {
    costLedger.recordFlat({ stage: "Metadata", provider: "anthropic", model: "test-text", cost: 0.01 });
  });
  const rows = spendLog.readSpendLog().filter((row) => row.label?.endsWith("(3Д)"));
  assert.deepEqual(rows.map((row) => [row.label, row.topic, row.projectId]).sort(), [
    ["Обложка (3Д)", "Всё на биткоин", null],
    ["Описание (3Д)", "Всё на биткоин", null],
  ]);
});

test("обложка onlyIfMissing: при уже готовой обложке ничего не рисуется и не оплачивается", async () => {
  const p = await videoProject();
  const first = fakeCover({ image: "owner" });
  assert.equal((await cover.makeCover3D(p.id, {}, first.deps)).ok, true);
  const again = fakeCover({ image: "auto" });
  const r = await cover.makeCover3D(p.id, { onlyIfMissing: true }, again.deps);
  assert.equal(r.skipped, true);
  assert.equal(r.ok, true);
  assert.equal(again.calls.concept + again.calls.image, 0);
  assert.equal(fs.readFileSync(path.join(store3d.projectDir(p.id), "cover.jpg"), "utf8"), "owner");
  assert.equal(cover.coverBusy().has(p.id), false, "the slot is free again");
});

test("кадр: выбирается тот, где видно обоих героев, иначе 35%", () => {
  const frame = (claude: number, owner: number, n = 100) => {
    const px = new Uint8Array(n * 3);
    for (let i = 0; i < n; i++) {
      const c = i < claude ? [217, 119, 87] : i < claude + owner ? [211, 160, 122] : [40, 40, 70];
      px.set(c, i * 3);
    }
    return px;
  };
  const both = cover.scoreFrame(frame(20, 10));
  assert.ok(Math.abs(both.claude - 0.2) < 1e-9 && Math.abs(both.owner - 0.1) < 1e-9);
  assert.deepEqual(cover.scoreFrame(frame(0, 0)), { claude: 0, owner: 0 });
  const scores = [
    { at: 3.5, ...cover.scoreFrame(frame(30, 0)) },
    { at: 3, ...cover.scoreFrame(frame(5, 5)) },
    { at: 4.5, ...cover.scoreFrame(frame(12, 9)) },
  ];
  assert.equal(cover.pickFrame(scores, 10), 4.5);
  assert.equal(cover.pickFrame([{ at: 3, claude: 0.3, owner: 0 }], 10), 3.5);
});

// ---- after a montage

test("после монтажа: описание и обложка один раз, существующее зеркало получает новое видео", async () => {
  const p = await videoProject("video-1");
  const m = (await pub.ensureMirror(p.id))!;
  await setVideo(p.id, "video-new");
  let metaCalls = 0;
  const generate = async () => {
    metaCalls++;
    return { meta: { title: "Всё на биткоин", description: "Клод против", hashtags: ["#крипта"] } };
  };
  const art = fakeCover();
  const a = pub.afterMontage(p.id, { meta: { generate }, cover: art.deps });
  const b = pub.afterMontage(p.id, { meta: { generate }, cover: art.deps });
  assert.equal(a, b, "a second call joins the running one");
  assert.equal(pub.isPreparing(p.id), true);
  await a;
  assert.equal(pub.isPreparing(p.id), false);
  assert.equal(metaCalls, 1);
  assert.equal(art.calls.image, 1);
  const done = store3d.getProject(p.id)!;
  assert.equal(done.meta?.title, "Всё на биткоин");
  assert.equal(done.cover?.status, "ok");
  const mirror = site.getProject(m.id)!;
  assert.equal(fs.readFileSync(path.join(site.projectDir(m.id), "out.mp4"), "utf8"), "video-new");
  assert.equal(mirror.meta?.title, "Всё на биткоин");
  assert.equal(mirror.cover, "cover.jpg");

  // the next montage keeps the cover and caption the owner has
  await setVideo(p.id, "video-3");
  await pub.afterMontage(p.id, { meta: { generate }, cover: art.deps });
  assert.equal(metaCalls, 1);
  assert.equal(art.calls.image, 1);
  assert.equal(fs.readFileSync(path.join(site.projectDir(m.id), "out.mp4"), "utf8"), "video-3");
});

test("после монтажа: обложку, нарисованную владельцем пока писалось описание, второй раз не оплачивают", async () => {
  const p = await videoProject();
  const owner = fakeCover({ image: "owner" });
  const auto = fakeCover({ image: "auto" });
  const generate = async () => {
    // the owner presses «Создать» on the cover while the caption model is still writing
    assert.equal((await cover.makeCover3D(p.id, {}, owner.deps)).ok, true);
    return { meta: { title: "Всё на биткоин", description: "", hashtags: [] } };
  };
  await pub.afterMontage(p.id, { meta: { generate }, cover: auto.deps });
  assert.equal(owner.calls.image, 1);
  assert.equal(auto.calls.concept + auto.calls.image, 0, "the automatic cover saw the owner's and paid nothing");
  assert.equal(fs.readFileSync(path.join(store3d.projectDir(p.id), "cover.jpg"), "utf8"), "owner");
  assert.equal(store3d.getProject(p.id)!.meta?.title, "Всё на биткоин");
});

test("список и удаление видят каждую отправку зеркала, а не только последнюю на сеть", async () => {
  const p = await videoProject("video-queue");
  const mirror = (await pub.ensureMirror(p.id))!;
  const del = () => projectRoute.DELETE(new NextRequest(url(`/api/3d/${p.id}`), { method: "DELETE" }), ctx(p.id));
  const marksOf = () => pub.listMarks([store3d.getProject(p.id)!]).get(p.id)!.published;
  const job = (id: string, status: string, scheduledAt: string, mode = "live") => ({
    id, key: id, projectId: mirror.id, account: "a", mode, caption: "", video: "video.mp4", scheduledAt, status, message: "", at: tick(),
  });
  const later = new Date(Date.now() + 86_400_000).toISOString();
  const now = new Date().toISOString();

  // a TikTok schedule for tomorrow, then a draft of the same video that already went: the overlay shows the draft
  await withBrowserTikTok({ jobs: [job("j1", "queued", later), job("j2", "draft", now, "draft")] }, async () => {
    assert.deepEqual(marksOf(), [], "a draft is not a publication");
    const refused = await del();
    assert.equal(refused.status, 409, "the older queued job still needs the sketch to be cancelled from");
    assert.match((await refused.json()).error, /TikTok/);
  });
  // the newest job is the schedule: «Запланировано», not «Публикуется»; one stopped at the login: «Нужен вход»
  await withBrowserTikTok({ jobs: [job("j3", "queued", later)] }, () => assert.deepEqual(marksOf(), [{ platform: "tiktok", state: "scheduled" }]));
  await withBrowserTikTok({ jobs: [job("j4", "queued", now)] }, () => assert.deepEqual(marksOf(), [{ platform: "tiktok", state: "sending" }]));
  await withBrowserTikTok({ jobs: [job("j5", "needs_login", now)] }, () => assert.deepEqual(marksOf(), [{ platform: "tiktok", state: "login" }]));

  // an Instagram schedule on another account behind a newer finished one: the folder is read, not the overlay
  const schedules = path.join(root, "data", "publication-schedule");
  const writeJob = (id: string, status: string, at: string) => {
    fs.mkdirSync(path.join(schedules, id), { recursive: true });
    fs.writeFileSync(path.join(schedules, id, "job.json"), JSON.stringify({ id, projectId: mirror.id, account: id, title: "", description: "", video: "video.mp4", coverMs: 1000, scheduledAt: later, status, at, message: "" }));
  };
  writeJob("00000000-0000-4000-8000-000000000001", "scheduled", tick());
  writeJob("00000000-0000-4000-8000-000000000002", "published", tick());
  try {
    assert.deepEqual(marksOf(), [{ platform: "instagram", state: "published" }], "the overlay shows the newest one");
    const refused = await del();
    assert.equal(refused.status, 409);
    assert.match((await refused.json()).error, /Instagram/);
  } finally {
    fs.rmSync(schedules, { recursive: true, force: true });
  }

  // nothing on its way any more: the sketch and its mirror go
  assert.equal((await del()).status, 200);
  assert.equal(site.getProject(mirror.id), null);
});
