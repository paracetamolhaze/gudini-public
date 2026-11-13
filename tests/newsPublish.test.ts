import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { NextRequest } from "next/server";

/**
 * Publishing «Новости» through the hidden main-site mirror, the caption, the cover, the list and the delete —
 * without the network and without paid calls: the main site's data folder is a temp folder (the main store reads
 * cwd/data), no account is connected (the main publish answers "demo"), and the models are replaced by fakes.
 *
 * The mirror runs on the LIVE main publishing code (lib/store.ts, lib/publish.ts, lib/publicationSchedule.ts…): the
 * site image has it, this git branch does not (lib/publicationSchedule.ts is not even in git). Without it the whole
 * file is skipped; the image build (news/deploy/site/Dockerfile) runs it against the code it ships.
 */

const startDir = process.cwd();
const LIVE = fs.existsSync(path.join(startDir, "lib", "publicationSchedule.ts"));
const skip = LIVE ? false : "нет живого кода публикаций (lib/publicationSchedule.ts) — проверяется при сборке образа";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "gudini-news-publish-"));

let store: typeof import("../lib/news/store");
let site: typeof import("../lib/store");
let pub: typeof import("../lib/news/publish");
let meta: typeof import("../lib/news/meta");
let cover: typeof import("../lib/news/cover");
let costLedger: typeof import("../lib/costLedger");
let spendLog: typeof import("../lib/spendLog");
let publishRoute: typeof import("../app/api/news/[id]/publish/route");
let metaRoute: typeof import("../app/api/news/[id]/meta/route");
let coverRoute: typeof import("../app/api/news/[id]/cover/route");
let listRoute: typeof import("../app/api/news/route");
let projectRoute: typeof import("../app/api/news/[id]/route");
let projectsRoute: typeof import("../app/api/projects/route");

before(async () => {
  if (!LIVE) return;
  // the headline layout measures with the site's fonts, found by cwd like on the server
  fs.cpSync(path.join(startDir, "fonts"), path.join(root, "fonts"), { recursive: true });
  process.chdir(root);
  process.env.NEWS_DATA_DIR = path.join(root, "data", "news");
  // TikTok goes the API way and, without tokens, to demo; the browser worker is never called
  delete process.env.TIKTOK_TRANSPORT;
  delete process.env.TIKTOK_DIRECT_POST;
  process.env.NEWS_AUTO_PREP = "off";
  store = await import("../lib/news/store");
  site = await import("../lib/store");
  pub = await import("../lib/news/publish");
  meta = await import("../lib/news/meta");
  cover = await import("../lib/news/cover");
  costLedger = await import("../lib/costLedger");
  spendLog = await import("../lib/spendLog");
  publishRoute = await import("../app/api/news/[id]/publish/route");
  metaRoute = await import("../app/api/news/[id]/meta/route");
  coverRoute = await import("../app/api/news/[id]/cover/route");
  listRoute = await import("../app/api/news/route");
  projectRoute = await import("../app/api/news/[id]/route");
  projectsRoute = await import("../app/api/projects/route");
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

let clock = Date.parse("2026-10-28T10:00:00Z");
const tick = () => new Date((clock += 1000)).toISOString();

const STORY = {
  title: "Кореянка переименовала Vaseline",
  summary: "Блогерша из Сеула запустила свой бренд.",
  hero: "@mindaylee_ (TikTok)",
  sources: [{ url: "https://www.tiktok.com/@mindaylee_/video/1" }],
  script: "Эта девушка переименовала вазелин.\nИ вот что вышло.",
};

/** A ready video as the runner would leave it, without the runner. */
async function setVideo(id: string, content: string, music: string | null = null) {
  fs.writeFileSync(store.videoPath(id), content);
  const at = tick();
  await store.mutate(id, (q) => {
    q.video = { file: "out.mp4", at, duration: 30, music };
  });
  return store.getProject(id)!;
}

async function videoProject(content = "video-1") {
  const p = await store.createProject();
  await store.mutate(p.id, (q) => {
    q.job = null;
    q.story = STORY;
  });
  return setVideo(p.id, content);
}

const mirrorsOf = (id: string) => site.listProjects().filter((m) => (m as { newsId?: string }).newsId === id);

test("зеркало: одно на ролик, скрытое, «готово»; новая музыка кладётся заново, тот же файл — нет", { skip }, async () => {
  const p = await videoProject("video-1");
  const m = (await pub.ensureMirror(p.id))!;
  assert.equal(m.newsId, p.id);
  assert.equal(m.processing.state, "done");
  assert.equal(m.processedVideo, "out.mp4");
  assert.equal(m.topic, STORY.title);
  assert.equal(m.script, STORY.script);
  assert.equal(store.getProject(p.id)!.mirrorId, m.id);
  const mirrorVideo = path.join(site.projectDir(m.id), "out.mp4");
  assert.equal(fs.readFileSync(mirrorVideo, "utf8"), "video-1");

  // the same video is not placed again: a marker file of the same size survives the next sync
  fs.rmSync(mirrorVideo);
  fs.writeFileSync(mirrorVideo, "VIDEO-1");
  assert.equal((await pub.ensureMirror(p.id))!.id, m.id);
  assert.equal(fs.readFileSync(mirrorVideo, "utf8"), "VIDEO-1");

  // a music change is a new video: placed, still one mirror
  await setVideo(p.id, "video-1 with music", "calm.mp3");
  await pub.ensureMirror(p.id, { create: false });
  assert.equal(fs.readFileSync(mirrorVideo, "utf8"), "video-1 with music");
  assert.equal(mirrorsOf(p.id).length, 1);

  // the mark lost from project.json: found again by the scan, never a second mirror
  await store.mutate(p.id, (q) => {
    q.mirrorId = null;
  });
  assert.equal((await pub.ensureMirror(p.id))!.id, m.id);
  const fresh = await videoProject();
  assert.equal(await pub.ensureMirror(fresh.id, { create: false }), null, "refreshing never creates one");
});

test("список проектов сайта не показывает зеркала «Новостей» (правка patch-live.mjs)", { skip }, async (t) => {
  if (!fs.readFileSync(path.join(startDir, "app", "api", "projects", "route.ts"), "utf8").includes("newsId")) {
    t.skip("app/api/projects/route.ts без правки «Новостей» — её проверяет сборка слоя");
    return;
  }
  const p = await videoProject();
  const m = (await pub.ensureMirror(p.id))!;
  const normal = site.createProject("Обычный ролик");
  const listed = (await (await projectsRoute.GET()).json()) as { id: string }[];
  assert.ok(listed.some((x) => x.id === normal.id));
  assert.ok(!listed.some((x) => x.id === m.id));
});

test("публикация: проверки как у основного маршрута, отправка через зеркало, старая версия после смены музыки", { skip }, async () => {
  const p = await videoProject();
  const post = (id: string, body: unknown) => publishRoute.POST(json(`/api/news/${id}/publish`, "POST", body), ctx(id));
  const del = (id: string, body: unknown) => publishRoute.DELETE(json(`/api/news/${id}/publish`, "DELETE", body), ctx(id));

  assert.equal((await post("../db", { platform: "youtube" })).status, 400);
  assert.equal((await post(p.id, "{не json")).status, 400);
  assert.equal((await post(p.id, { platform: "vk" })).status, 400);
  assert.equal((await post(p.id, { platform: "instagram", instagramTrial: true, mode: "draft" })).status, 400);
  assert.equal((await post("zzzzzzzzzz", { platform: "youtube" })).status, 404);
  const bare = await store.createProject();
  assert.equal((await post(bare.id, { platform: "youtube" })).status, 409);
  assert.equal(mirrorsOf(bare.id).length, 0);

  // the caption is set first: publishing without one would call the caption model
  const put = await metaRoute.PUT(json(`/api/news/${p.id}/meta`, "PUT", { title: "Вазелин по-корейски", description: "Что вышло", hashtags: "#новости вазелин" }), ctx(p.id));
  assert.equal(put.status, 200);

  const sent = await post(p.id, { platform: "youtube" });
  assert.equal(sent.status, 200, await sent.clone().text());
  const { publication, view } = await sent.json();
  assert.equal(publication.status, "demo");
  const mirror = site.getProject(view.mirrorId)!;
  assert.equal(mirror.meta?.title, "Вазелин по-корейски");
  assert.deepEqual(mirror.meta?.hashtags, ["#новости", "#вазелин"]);
  assert.equal(view.sent.youtube.videoAt, p.video!.at);

  // the owner put another track after the post: the page is told which networks carry the old version
  site.updateProject(view.mirrorId, { publications: [{ platform: "youtube", status: "published", at: tick(), url: "https://youtube.com/shorts/x" }] });
  await setVideo(p.id, "video-2", "calm.mp3");
  const viewNow = await (await publishRoute.GET(new NextRequest(url(`/api/news/${p.id}/publish`)), ctx(p.id))).json();
  assert.deepEqual(viewNow.stale, ["youtube"]);

  assert.equal((await del(p.id, { platform: "youtube" })).status, 400);
  assert.equal((await del(p.id, { platform: "instagram" })).status, 200);
  assert.equal((await del(bare.id, { platform: "instagram" })).status, 409);
});

test("список: обложка, куда ушёл ролик, музыка с ПК; удаление забирает зеркало", { skip }, async () => {
  await store.saveTracks([{ file: "calm.mp3", title: "Calm", duration: 95 }]);
  const p = await videoProject("video-list");
  const mirror = (await pub.ensureMirror(p.id))!;
  site.updateProject(mirror.id, {
    publications: [
      { platform: "youtube", status: "published", at: tick() },
      { platform: "instagram", status: "published", instagramTrial: true, at: tick() },
    ],
  });
  const coverAt = tick();
  await store.mutate(p.id, (q) => {
    q.cover = { file: cover.COVER_FILE, at: coverAt, status: "ok" };
  });
  fs.writeFileSync(path.join(store.projectDir(p.id), cover.COVER_FILE), "jpeg");

  const answer = (await (await listRoute.GET()).json()) as {
    projects: { id: string; title: string | null; cover: unknown; published: unknown[] }[];
    tracks: unknown[];
    runner: { seenAt: string | null; quiet: boolean };
  };
  const row = answer.projects.find((x) => x.id === p.id)!;
  assert.equal(row.title, STORY.title);
  assert.deepEqual(row.cover, { at: coverAt });
  assert.deepEqual(row.published, [
    { platform: "youtube", state: "published" },
    { platform: "instagram", state: "published", trial: true },
  ]);
  assert.deepEqual(answer.tracks, [{ file: "calm.mp3", title: "Calm", duration: 95, ready: false }], "куска трека с ПК ещё нет — играть нечем");
  assert.equal(typeof answer.runner.quiet, "boolean");

  const created = await listRoute.POST(new NextRequest(url("/api/news"), { method: "POST" }));
  assert.equal(created.status, 201);
  const { id: newId } = await created.json();
  assert.equal(store.getProject(newId)!.job?.task, "create");

  const item = await (await projectRoute.GET(new NextRequest(url(`/api/news/${p.id}`)), ctx(p.id))).json();
  assert.equal(item.story.title, STORY.title);
  assert.deepEqual(item.tracks, answer.tracks);

  const del = () => projectRoute.DELETE(new NextRequest(url(`/api/news/${p.id}`), { method: "DELETE" }), ctx(p.id));
  const done = await del();
  assert.equal(done.status, 200, await done.clone().text());
  assert.equal(store.getProject(p.id), null);
  assert.equal(site.getProject(mirror.id), null, "the mirror goes with the video");
  assert.equal(fs.existsSync(path.join(site.UPLOADS_DIR, mirror.id)), false);
  assert.equal((await del()).status, 404);
});

test("страница публикаций: записи зеркала ведут на /news/<id> (правка patch-live.mjs)", { skip }, async (t) => {
  if (!fs.readFileSync(path.join(startDir, "lib", "publications.ts"), "utf8").includes("news/links")) {
    t.skip("lib/publications.ts без правки «Новостей» — её проверяет сборка слоя");
    return;
  }
  const spec = "../lib/publications";
  const { localPublications } = (await import(spec)) as { localPublications: () => { id: string; href: string }[] };
  const p = await videoProject();
  await meta.saveMeta(p.id, { title: "Вазелин", description: "", hashtags: [] });
  const { publication, view } = await pub.publishNews(p.id, { platform: "youtube", mode: "live", instagramTrial: false });
  assert.equal(publication.status, "demo");
  const normal = site.createProject("Обычный ролик с публикацией");
  site.updateProject(normal.id, { publications: [{ platform: "youtube", status: "published", at: tick() }] });
  const entries = localPublications();
  assert.ok(entries.some((e) => e.href === `/news/${p.id}`), "the entry of the news video");
  assert.ok(!entries.some((e) => e.href === `/project/${view.mirrorId}`), "never the hidden mirror's main editor");
  assert.ok(entries.some((e) => e.href === `/project/${normal.id}`), "an ordinary project keeps its editor link");
});

// ---- caption and cover

test("описание: из текста истории; правка проверяется целиком; ручное не затирается автоматическим", { skip }, async () => {
  const p = await videoProject();
  const put = (body: unknown) => metaRoute.PUT(json(`/api/news/${p.id}/meta`, "PUT", body), ctx(p.id));
  assert.equal((await put({ title: "Без остального" })).status, 400);
  assert.equal((await put({ title: "Ок", description: "", hashtags: "#тег!" })).status, 400);
  const ok = await put({ title: "  Вазелин   по-корейски ", description: "Строка 1\r\nСтрока 2", hashtags: ["новости", "#Новости"] });
  assert.deepEqual((await ok.json()).meta, { title: "Вазелин по-корейски", description: "Строка 1\nСтрока 2", hashtags: ["#новости"] });

  let calls = 0;
  const generate = async (topic: string, script: string, title: string) => {
    calls++;
    assert.equal(topic, STORY.title);
    assert.equal(script, STORY.script);
    assert.equal(title, STORY.title);
    return { meta: { title: "Очень ".repeat(40), description: "Описание", hashtags: ["новости", "плохой тег!"] } };
  };
  const q = await videoProject();
  const made = await meta.regenerateMeta(q.id, {}, { generate });
  assert.ok(made.meta!.title.length <= meta.META_TITLE_MAX);
  assert.deepEqual(made.meta!.hashtags, ["#новости"]);
  assert.equal(made.meta!.description, "Описание", "подпись без строки «Оригинал: @ник» (владелец 10.11)");
  await meta.regenerateMeta(q.id, { onlyIfMissing: true }, { generate });
  assert.equal(calls, 1, "an existing caption is not regenerated automatically");
  const noStory = await store.createProject();
  await assert.rejects(meta.regenerateMeta(noStory.id, {}, { generate }), (e: { status?: number }) => e.status === 409);
});

function fakeCover(opts: { fail?: boolean; image?: string; read?: (string | null)[] } = {}) {
  const calls = { concept: 0, image: 0, compose: 0, composed: [] as { frame: string; headline: string }[], hero: [] as { picture: string; lines: string[]; key: string }[], refs: [] as string[], prompts: [] as string[] };
  const reads = [...(opts.read ?? [])];
  const deps: Partial<import("../lib/news/cover").CoverDepsNews> = {
    blocked: () => null,
    spend: (_id, _topic, fn) => fn(),
    grabFrame: async (_video, work) => {
      const file = path.join(work, "frame.jpg");
      fs.writeFileSync(file, "frame");
      return { file, at: 9 };
    },
    concept: async (topic) => {
      calls.concept++;
      assert.equal(topic, STORY.title);
      return {
        headline: "ВАЗЕЛИН ПО-КОРЕЙСКИ",
        headlineLines: [{ text: "ВАЗЕЛИН ПО-КОРЕЙСКИ" }] as never,
        headlineCandidates: ["ВАЗЕЛИН ПО-КОРЕЙСКИ"],
        headlineAnchor: ["вазелин"],
        emotion: "smug surprise",
        scene: { mainSubject: "", storyObject: "jar", environment: "bathroom" },
        composition: { facePosition: "center", faceScale: "large", headlineArea: "lower", allowHands: false },
        design_notes: [],
      };
    },
    generateImage: async (prompt, frame, out) => {
      calls.image++;
      calls.prompts.push(prompt);
      // the frame is the reference for the story's hero and scene
      calls.refs.push(fs.readFileSync(frame, "utf8"));
      if (opts.fail) throw new Error("IMAGE_PROVIDER_ERROR: 500 {}");
      fs.writeFileSync(out, opts.image ?? "picture");
      return { cost: 0 };
    },
    finish: async (_dir, src, out) => {
      fs.copyFileSync(src, out);
      return out;
    },
    encodeFinal: async (_dir, base, out) => {
      fs.copyFileSync(base, out);
      return out;
    },
    // what GPT reads back from the drawn cover: the right headline unless the test says otherwise
    readText: async () => (reads.length ? reads.shift()! : "ВАЗЕЛИН ПО-КОРЕЙСКИ"),
    compose: async (frame, headline, out) => {
      calls.compose++;
      calls.composed.push({ frame: fs.readFileSync(frame, "utf8"), headline });
      if (opts.fail) throw new Error("compose failed");
      fs.writeFileSync(out, opts.image ?? "picture");
    },
    composeHero: async (picture, lines, key, out) => {
      calls.hero.push({ picture: fs.readFileSync(picture, "utf8"), lines, key });
      fs.writeFileSync(out, opts.image ?? "picture");
    },
  };
  return { deps, calls };
}

test("обложка «Вазелин» по имени — герой истории с кадра, без владельца; прежняя остаётся при неудаче; в зеркало", { skip }, async () => {
  const p = await videoProject();
  const first = fakeCover({ image: "first" });
  const made = await cover.makeNewsCover(p.id, { style: "hero" }, first.deps);
  assert.equal(made.ok, true, made.error ?? "");
  assert.equal(made.project.cover?.headline, "ВАЗЕЛИН ПО-КОРЕЙСКИ");
  assert.equal(made.project.cover?.videoAt, p.video!.at);
  assert.equal(made.project.cover?.style, "hero", "the Vaseline cover (owner 4.11: «вернемся к старым обложкам как у вазелина»)");
  assert.equal(first.calls.image, 1, "GPT draws the picture");
  assert.deepEqual(first.calls.refs, ["frame"], "the video frame is the only reference — no owner photos");
  const prompt = first.calls.prompts[0];
  assert.match(prompt, /punchy photographic viral news cover picture/);
  assert.match(prompt, /Vertical 4:5/, "drawn for the Instagram grid cell");
  assert.match(prompt, /Absolutely no text/, "the headline is ours: GPT kept putting it under the view counter");
  assert.doesNotMatch(prompt, /ВАЗЕЛИН|channel's host|Deep blue gradient/);
  assert.equal(first.calls.compose, 0);
  assert.deepEqual(first.calls.hero, [{ picture: "first", lines: ["ВАЗЕЛИН", "ПО-КОРЕЙСКИ"], key: "ВАЗЕЛИН" }], "the Vaseline headline is laid over GPT's picture, the anchor word in the yellow box");

  const got = await coverRoute.GET(new NextRequest(url(`/api/news/${p.id}/cover`)), ctx(p.id));
  assert.equal(await got.text(), "first");
  const m = (await pub.ensureMirror(p.id))!;
  assert.equal(m.cover, "cover.jpg");
  assert.equal(fs.readFileSync(path.join(site.projectDir(m.id), "cover.jpg"), "utf8"), "first");

  const failed = await cover.makeNewsCover(p.id, { style: "hero" }, fakeCover({ fail: true }).deps);
  assert.equal(failed.kept, true);
  assert.equal(fs.readFileSync(path.join(store.projectDir(p.id), "cover.jpg"), "utf8"), "first");

  const long = await coverRoute.POST(json(`/api/news/${p.id}/cover`, "POST", { headline: "x".repeat(61) }), ctx(p.id));
  assert.equal(long.status, 400);
  const bare = await store.createProject();
  assert.equal((await coverRoute.POST(json(`/api/news/${bare.id}/cover`, "POST", {}), ctx(bare.id))).status, 409);
});

test("обложка: чистый кадр с ПК важнее кадра ролика; другой стиль — по имени; ошибка в заголовке — ещё одна попытка", { skip }, async () => {
  const p = await videoProject();
  fs.writeFileSync(path.join(store.projectDir(p.id), cover.COVER_FRAME_FILE), "clean");
  const a = fakeCover();
  // по умолчанию — «постер», как у «МУЖИК СТАЛ МЕМОМ» (владелец 5.11: «черный фон и я держал песок»)
  const made = await cover.makeNewsCover(p.id, {}, a.deps);
  assert.equal(made.ok, true, made.error ?? "");
  assert.equal(made.project.cover?.style, "poster");
  assert.match(a.calls.prompts[0], /Cinematic movie-poster look/);
  assert.equal(a.calls.refs[0], "clean", "the PC's frame without subtitles is GPT's reference");
  const picture = fakeCover();
  assert.equal((await cover.makeNewsCover(p.id, { style: "news" }, picture.deps)).project.cover?.style, "news");
  assert.equal(picture.calls.compose, 1, "«news»: a picture without text and our headline");

  // GPT's own headline (the blue post) is read back: a misspelt one is drawn once more
  const typo = fakeCover({ read: ["ВАЗЕЛИН ПО-КОРЕСКИ", "ВАЗЕЛИН ПО-КОРЕЙСКИ"] });
  const fixed = await cover.makeNewsCover(p.id, { style: "post" }, typo.deps);
  assert.equal(fixed.ok, true);
  assert.equal(typo.calls.image, 2, "a misspelt headline is drawn once more");
  const twice = fakeCover({ read: ["ВАЗЕЛИН ПО-КОРЕСКИ", "ВАЗЕЛЕН ПО-КОРЕЙСКИ"] });
  const r = await cover.makeNewsCover(p.id, { style: "post" }, twice.deps);
  assert.equal(r.kept, true, "twice wrong — the previous cover stays");
  assert.equal(twice.calls.image, 2);
  assert.equal((await coverRoute.POST(json(`/api/news/${p.id}/cover`, "POST", { style: "comic" }), ctx(p.id))).status, 400);
});

test("расходы обложки и описания — с пометкой «(Новости)» и без projectId", { skip }, async () => {
  const p = await videoProject();
  const paid = fakeCover({ image: "paid" });
  const { spend: _testSpend, ...live } = paid.deps;
  const r = await cover.makeNewsCover(p.id, {}, {
    ...live,
    concept: async (topic, script, title, strict) => {
      const done = await paid.deps.concept!(topic, script, title, strict);
      costLedger.recordFlat({ stage: "Cover Concept", provider: "anthropic", model: "test-text", cost: 0.01 });
      return done;
    },
  });
  assert.equal(r.ok, true);
  await meta.siteSpend(STORY.title, "Описание (Новости)", async () => {
    costLedger.recordFlat({ stage: "Metadata", provider: "anthropic", model: "test-text", cost: 0.01 });
  });
  const rows = spendLog.readSpendLog().filter((row) => row.label?.endsWith("(Новости)"));
  assert.deepEqual(rows.map((row) => [row.label, row.topic, row.projectId]).sort(), [
    ["Обложка (Новости)", STORY.title, null],
    ["Описание (Новости)", STORY.title, null],
  ]);
});

// ---- after a video

test("после ролика и после смены музыки: описание и обложка один раз, зеркало получает новый файл", { skip }, async () => {
  const p = await videoProject("video-1");
  const m = (await pub.ensureMirror(p.id))!;
  let metaCalls = 0;
  const generate = async () => {
    metaCalls++;
    return { meta: { title: "Вазелин по-корейски", description: "", hashtags: ["#новости"] } };
  };
  const art = fakeCover();
  const a = pub.afterMontage(p.id, { meta: { generate }, cover: art.deps });
  assert.equal(pub.afterMontage(p.id, { meta: { generate }, cover: art.deps }), a, "a second call joins the running one");
  assert.equal(pub.isPreparing(p.id), true);
  await a;
  assert.equal(pub.isPreparing(p.id), false);
  assert.equal(metaCalls, 1);
  assert.equal(art.calls.image, 1);
  assert.equal(site.getProject(m.id)!.meta?.title, "Вазелин по-корейски");

  // a rerender through the store: the caption and the cover stay, the mirror gets the new file
  // (create jobs queued by the tests above would be claimed first: they go)
  for (const q of store.listProjects()) if (q.job?.state === "queued") await store.cancelQueued(q.id);
  await store.saveTracks([{ file: "calm.mp3", title: "Calm", duration: 95 }]);
  await store.enqueueRerender(p.id);
  const { job } = (await store.claimNext())!;
  await store.receiveVideoChunk(p.id, job.id, 0, 10, Buffer.from("rerendered"));
  const done = await store.completeJob(p.id, job.id, { video: { duration: 30, music: null } });
  assert.equal(done.cover?.videoAt, done.video?.at);
  await pub.afterMontage(p.id, { meta: { generate }, cover: art.deps });
  assert.equal(metaCalls, 1);
  assert.equal(art.calls.image, 1);
  assert.equal(fs.readFileSync(path.join(site.projectDir(m.id), "out.mp4"), "utf8"), "rerendered");
  const view = pub.publishView(p.id);
  assert.equal(view.videoAt, done.video?.at);
  assert.equal(view.cover?.videoAt, done.video?.at, "the page shows no «по прошлой версии» on the cover");
});
