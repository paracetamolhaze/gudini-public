import { test } from "node:test";
import assert from "node:assert/strict";
import { detectLang, engagement, freshness, hourWeights, nextDueAt, passesFloor, planViral, publishDelayMinutes, publishingWindow, strength, teenTopic, usableText, type PlanInput } from "../../src/services/viral/plan.js";
import { rankCandidates, viralProblems, viralXText } from "../../src/services/viral/writer.js";
import { viralSystemPrompt } from "../../src/services/viral/prompts.js";
import { collectThreadsPosts, type ThreadsWebPost } from "../../src/threadsWeb/search.js";
import type { ViralPostRow } from "../../src/db/repos/viral.js";

const TZ = "Asia/Qyzylorda"; // UTC+5, без перехода на летнее время
const HOURS = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 0, 1];
const at = (iso: string) => new Date(iso);
const thresholds = { threads: { minEngagement: 250, strongEngagement: 800 }, x: { minViews: 150_000, strongViews: 1_000_000 } };

test("язык: русский, английский и всё остальное", () => {
  assert.equal(detectLang("У меня плохие новости для всех, кто рассказывает GPT всю свою жизнь"), "ru");
  assert.equal(detectLang("i hope 2027 will be better."), "en");
  assert.equal(detectLang("Craving a relationship but I actually cannot see myself dating anyone rn"), "en");
  assert.equal(detectLang("absen yg bangun subuh di hari minggu, mau ku kasi uang buat beli sarapan"), "other");
  assert.equal(detectLang("Їжак і ґанок — це українська"), "other");
  assert.equal(detectLang("淡江大學平日去海底撈吃終於有優惠了"), "other");
});

test("сила поста: ответы и репосты весят больше лайков, площадки сравнимы по своему порогу", () => {
  const p = { platform: "threads" as const, likes: 921, replies: 247, reposts: 64, views: null, postedAt: null };
  assert.equal(engagement(p), 921 + 494 + 192);
  assert.ok(strength(p, thresholds) > 1);
  assert.ok(passesFloor({ ...p, likes: 200, replies: 30, reposts: 0 }, thresholds));
  assert.ok(!passesFloor({ ...p, likes: 100, replies: 10, reposts: 0 }, thresholds));
  const x = { platform: "x" as const, likes: 0, replies: 0, reposts: 0, views: 2_000_000, postedAt: null };
  assert.equal(strength(x, thresholds), 2);
  assert.ok(!passesFloor({ ...x, views: null }, thresholds));
  const now = at("2026-10-25T12:00:00Z");
  assert.equal(freshness(at("2026-10-25T02:00:00Z"), now), 1);
  assert.ok(freshness(at("2026-10-20T12:00:00Z"), now) < freshness(at("2026-10-23T12:00:00Z"), now));
});

test("текст-образец: короткий текстовый пост годится, подпись к картинке — нет", () => {
  assert.ok(usableText("i hope 2027 will be better.", "text"));
  assert.ok(!usableText("This goes HARD", "text"));
  assert.ok(!usableText("Luffy in Fortnite, finally here", "image"));
  assert.ok(usableText("Мы с мужем этой зимой уехали зимовать во Вьетнам, выбрали маленький город в двух часах от Хошимина, и вот что поняли", "carousel"));
  assert.ok(!usableText("#москва #осень #настроение #love", "text"));
});

test("день публикаций начинается в 10:00 и заканчивается в 02:00 по Кызылорде", () => {
  const evening = publishingWindow(at("2026-10-25T20:30:00Z"), HOURS, TZ); // 01:30 26.10 местного
  assert.equal(evening.dayStart.toISOString(), "2026-10-25T05:00:00.000Z"); // 10:00 25.10 местного
  assert.equal(evening.windowEnd.toISOString(), "2026-10-25T21:00:00.000Z"); // 02:00 26.10 местного
  assert.ok(evening.inWindow);
  const night = publishingWindow(at("2026-10-25T23:00:00Z"), HOURS, TZ); // 04:00 местного
  assert.ok(!night.inWindow);
  const morning = publishingWindow(at("2026-10-26T05:10:00Z"), HOURS, TZ); // 10:10 местного
  assert.equal(morning.dayStart.toISOString(), "2026-10-26T05:00:00.000Z");
  assert.ok(morning.inWindow);
});

const base = (over: Partial<PlanInput> = {}): PlanInput => ({
  now: at("2026-10-25T07:00:00Z"), // 12:00 местного, до конца окна 14 часов
  timezone: TZ,
  preferredHours: HOURS,
  minimumMinutesBetweenPosts: 30,
  quotas: { translate: { min: 2, max: 5 }, remake: { min: 5, max: 10 } },
  done: { translate: 0, remake: 0 },
  pending: 0,
  lastCreatedAt: null,
  ...over,
});

test("план: пока висит неопубликованный пост, новый не пишется; ночью — тоже", () => {
  assert.equal(planViral(base({ pending: 1 })).kind, "wait");
  assert.equal(planViral(base({ now: at("2026-10-25T23:00:00Z") })).kind, "wait");
});

test("план: сначала добирается минимум любым постом, сверх минимума — только сильными", () => {
  const first = planViral(base());
  assert.equal(first.kind, "write");
  if (first.kind !== "write") return;
  assert.deepEqual(first.steps.map((s) => s.strongOnly), [false, false]);
  const afterMin = planViral(base({ done: { translate: 2, remake: 5 } }));
  assert.equal(afterMin.kind, "write");
  if (afterMin.kind !== "write") return;
  assert.ok(afterMin.steps.every((s) => s.strongOnly));
  const remakeBehind = planViral(base({ done: { translate: 2, remake: 1 } }));
  assert.equal(remakeBehind.kind === "write" && remakeBehind.steps[0]!.use, "remake");
  assert.equal(planViral(base({ done: { translate: 5, remake: 10 } })).kind, "wait");
});

test("план: промежутки случайные, но в рамках, и тики не перебрасывают кубик", () => {
  // С 12:00 до 02:00 — 14 часов на 15 постов: база около 56 минут, множитель 0,55–1,6.
  const start = at("2026-10-25T06:30:00Z");
  const gaps: number[] = [];
  for (let i = 0; i < 40; i++) {
    const last = new Date(start.getTime() + i * 61_000);
    gaps.push((nextDueAt(base({ lastCreatedAt: last }))!.getTime() - last.getTime()) / 60_000);
  }
  assert.ok(Math.min(...gaps) >= 30, `минимум ${Math.min(...gaps)}`);
  assert.ok(Math.max(...gaps) <= 56 * 1.6 + 1, `максимум ${Math.max(...gaps)}`);
  assert.ok(Math.max(...gaps) - Math.min(...gaps) > 25, "промежутки действительно разные");
  // Десять минут спустя срок почти тот же: остаток окна чуть сжался, но случайность не новая.
  const a = nextDueAt(base({ lastCreatedAt: start }))!.getTime();
  const b = nextDueAt(base({ lastCreatedAt: start, now: at("2026-10-25T07:10:00Z") }))!.getTime();
  assert.ok(Math.abs(a - b) < 3 * 60_000);
});

test("план: в сильный час посты идут чаще, первый пост дня — в случайную минуту первого часа", () => {
  const last = at("2026-10-25T06:30:00Z");
  const plain = nextDueAt(base({ lastCreatedAt: last }))!.getTime();
  const hot = nextDueAt(base({ lastCreatedAt: last, hourWeights: { 12: 1.6 } }))!.getTime();
  assert.ok(hot < plain);
  const day1 = nextDueAt(base({ now: at("2026-10-25T05:01:00Z"), lastCreatedAt: at("2026-10-24T20:50:00Z") }))!;
  const day2 = nextDueAt(base({ now: at("2026-10-26T05:01:00Z"), lastCreatedAt: at("2026-10-25T20:50:00Z") }))!;
  const off1 = (day1.getTime() - at("2026-10-25T05:00:00Z").getTime()) / 60_000;
  const off2 = (day2.getTime() - at("2026-10-26T05:00:00Z").getTime()) / 60_000;
  for (const off of [off1, off2]) assert.ok(off >= 5 && off <= 70, `смещение ${off}`);
  assert.notEqual(Math.round(off1), Math.round(off2));
  for (const key of ["a", "b", "c", "d"]) {
    const d = publishDelayMinutes(key);
    assert.ok(d >= 1 && d <= 18);
  }
});

test("план: вечером, когда отстаём, промежуток сжимается, но не короче минимального", () => {
  const late = planViral(base({ now: at("2026-10-25T19:00:00Z"), done: { translate: 0, remake: 0 }, lastCreatedAt: at("2026-10-25T18:35:00Z") }));
  assert.equal(late.kind, "wait");
  const lateDue = planViral(base({ now: at("2026-10-25T19:00:00Z"), lastCreatedAt: at("2026-10-25T18:29:00Z") }));
  assert.equal(lateDue.kind, "write");
});

const row = (over: Partial<ViralPostRow>): ViralPostRow => ({
  id: "id", platform: "threads", external_id: "1", username: "a", permalink: "p", text: "текст поста про жизнь и работу", lang: "ru", media: "text", image_urls: [],
  likes: 300, replies: 10, reposts: 0, views: null, posted_at: at("2026-10-25T06:00:00Z"), query: "жизнь", first_seen_at: at("2026-10-25T06:00:00Z"),
  last_seen_at: at("2026-10-25T06:00:00Z"), status: "NEW", reason: null, draft_id: null, ...over,
});

test("кандидаты: сильнейшие первыми, не больше двух от автора, недавно взятые авторы — мимо", () => {
  const settings = { viral: { thresholds } } as Parameters<typeof rankCandidates>[1]["settings"];
  const now = at("2026-10-25T07:00:00Z");
  const rows = [
    row({ id: "weak", likes: 100 }),
    row({ id: "a1", username: "anna", likes: 2000 }),
    row({ id: "a2", username: "anna", likes: 1900 }),
    row({ id: "a3", username: "anna", likes: 1800 }),
    row({ id: "mid", username: "bob", likes: 400 }),
    row({ id: "used", username: "olga", likes: 5000 }),
  ];
  const picked = rankCandidates(rows, { strongOnly: false, settings, usedAuthors: new Set(["threads:olga"]), now }).map((r) => r.id);
  assert.deepEqual(picked, ["a1", "a2", "mid"]);
  const strong = rankCandidates(rows, { strongOnly: true, settings, usedAuthors: new Set(), now }).map((r) => r.id);
  assert.deepEqual(strong, ["used", "a1", "a2"]);
});

test("проверка поста: дословная копия, чужой язык и ссылки не уходят сами", () => {
  const source = "Сижу, жду, когда жизнь сама предложит что-нибудь интересное, а она молчит третий год подряд";
  assert.deepEqual(viralProblems("remake", "Жду, когда работа сама предложит повышение. Пятый год жду, честно.", source, [], 500), []);
  assert.ok(viralProblems("remake", source, source, [], 500).some((p) => p.includes("дословно")));
  assert.ok(viralProblems("translate", "i hope 2027 will be better", "i hope 2027 will be better", [], 500).some((p) => p.includes("русском")));
  assert.ok(viralProblems("translate", "Надеюсь, 2027-й будет лучше. Подробнее: https://example.com", "x", [], 500).some((p) => p.includes("ссылка")));
  assert.ok(viralProblems("translate", "Надеюсь, 2027-й будет лучше, чем этот", "x", ["Надеюсь, 2027-й будет лучше, чем этот"], 500).some((p) => p.includes("недавний")));
});

test("промпт не просит ни тему, ни хештеги", () => {
  const settings = { persona: { name: "Алексей", bio: "", tone: "", rules: "" }, platforms: { threads: { enabled: true, maxChars: 500 }, x: { maxChars: 280 } } } as unknown as Parameters<typeof viralSystemPrompt>[1];
  for (const use of ["translate", "remake"] as const) {
    const prompt = viralSystemPrompt(use, settings, { withX: true });
    assert.doesNotMatch(prompt, /поле topic/);
    assert.match(prompt, /без хештегов/);
  }
});

test("выдача Threads: посты находятся в любом месте JSON, ответы, репосты и ссылки отсеиваются", () => {
  const post = (pk: string, over: Record<string, unknown> = {}, info: Record<string, unknown> = {}) => ({
    pk, code: `C${pk}`, like_count: 900, taken_at: 1792876442, media_type: 19,
    user: { username: `u${pk}` }, caption: { text: `Пост номер ${pk} про жизнь` },
    text_post_app_info: { is_reply: false, direct_reply_count: 50, repost_count: 7, quote_count: 1, reshare_count: 3, share_info: { quoted_post: null, reposted_post: null }, link_preview_attachment: null, ...info },
    ...over,
  });
  const json = { data: { searchResults: { edges: [
    { node: { thread: { thread_items: [{ post: post("1") }] } } },
    { node: { thread: { thread_items: [{ post: post("2", {}, { is_reply: true }) }] } } },
    { node: { thread: { thread_items: [{ post: post("3", {}, { link_preview_attachment: { url: "https://shop" } }) }] } } },
    { node: { thread: { thread_items: [{ post: post("4", { caption: null }) }] } } },
    { node: { thread: { thread_items: [{ post: post("1", { like_count: 950 }) }] } } },
  ] } } };
  const found = new Map<string, ThreadsWebPost>();
  collectThreadsPosts(json, "жизнь", found);
  assert.deepEqual([...found.keys()], ["1"]);
  const p = found.get("1")!;
  assert.equal(p.likes, 950);
  assert.equal(p.replies, 50);
  assert.equal(p.media, "text");
  assert.equal(p.permalink, "https://www.threads.com/@u1/post/C1");
  assert.equal(p.postedAt, new Date(1792876442 * 1000).toISOString());
});

test("X: у переделки своя английская версия, у перевода её нет", () => {
  const settings = { persona: { name: "Алексей", bio: "", tone: "", rules: "" }, platforms: { threads: { enabled: true, maxChars: 500 }, x: { maxChars: 280 } } } as unknown as Parameters<typeof viralSystemPrompt>[1];
  assert.match(viralSystemPrompt("remake", settings, { withX: true }), /textX напиши этот же пост/);
  assert.match(viralSystemPrompt("remake", settings), /textX оставь пустой/);
  assert.match(viralSystemPrompt("translate", settings, { withX: true }), /textX оставь пустой/);
  const main = "в детстве думал, что взрослые по вечерам решают что-то важное";
  assert.deepEqual(viralXText("as a kid i thought adults spent their evenings deciding important stuff", main, { maxChars: 280 }), { text: "as a kid i thought adults spent their evenings deciding important stuff", problem: null });
  assert.equal(viralXText("", main, { maxChars: 280 }).text, null);
  assert.equal(viralXText("в детстве думал по-русски", main, { maxChars: 280 }).text, null);
  assert.equal(viralXText("as a kid i thought adults decided stuff https://example.com", main, { maxChars: 280 }).text, null);
});

test("темы: школа и учёба — мимо, взрослая жизнь — да, похожие слова не путаются", () => {
  for (const t of ["настоящее давление в учёбе - это когда родители не давят", "учёба дома: плюсы и минусы", "в школе нам говорили", "studying at home: pros and cons", "my teacher said", "Студенты, признавайтесь"]) {
    assert.ok(teenTopic(t), t);
  }
  for (const t of ["универсальный совет для всех", "он преподнёс сюрприз", "unique take on work", "фотосессия в парке", "мама скинула несмешной мем", "начальник опять пишет в выходной", "сессия с психологом помогла"]) {
    assert.ok(!teenTopic(t), t);
  }
});

test("веса часов: устойчивая разница проявляется, один случайный хит — нет", () => {
  const samples = [
    ...Array.from({ length: 20 }, () => ({ hour: 21, views: 300 })),
    ...Array.from({ length: 20 }, () => ({ hour: 13, views: 100 })),
    ...Array.from({ length: 20 }, () => ({ hour: 15, views: 150 })),
    { hour: 17, views: 7000 },
  ];
  const w = hourWeights(samples);
  assert.ok(w[21]! > 1.2);
  assert.ok(w[13]! < 0.8);
  assert.ok(w[17]! < 1.6 && w[17]! >= 1);
  assert.equal(w[5], 1);
  assert.deepEqual(hourWeights([]), {});
});
