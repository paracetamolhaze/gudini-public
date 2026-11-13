// Перенос постов владельца из его телеграм-канала в Threads @owner.threads и X @OwnerX — без правок и сразу.
// Запускается раз в пару минут из deploy/tg-mirror.ps1 (run.sh tg-mirror). Состояние — строка settings key='tg_mirror'.
// Новый пост канала уходит на обе площадки; реклама и пересланное пропускаются.
// Если на площадке больше 7 часов не было постов, днём (9–24 по Кызылорде) уходит пост из запаса вневременных постов канала.
//   run.sh tg-mirror              — обычный проход
//   run.sh tg-mirror dry          — показать, что ушло бы, ничего не публикуя
//   run.sh tg-mirror parse <html…> — только разобрать сохранённые страницы канала (без контейнера)
import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";

const CHANNEL = "owner_channel";
const PLATFORMS = ["threads", "x"];
const PUBLISHERS = { threads: "owner.threads", x: "OwnerX" };
const TZ = "Asia/Qyzylorda";
const SILENCE_HOURS = 7;
const FALLBACK_HOURS = [9, 24]; // запасной пост только днём по времени владельца
const MAX_ATTEMPTS = 6; // X бывает недоступен, пока сторож держит браузер на паузе — пробуем ещё несколько проходов
const MAX_RETRIES = 3; // черновик создан, но публикатор упал — столько раз возвращаем его в очередь
const RETRY_WAIT_MIN = [5, 15, 30]; // пауза перед каждым повтором, чтобы повторы не сгорели, пока браузер лежит
const LATE_POST_MIN = 20; // столько ждём запоздавший пост, прежде чем считать «неизвестно, ушло ли» за «не ушло»
const GIVE_UP_UNKNOWN_MIN = 720; // столько минут ждём, пока поиск X сможет ответить, потом сдаёмся

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", laquo: "«", raquo: "»", mdash: "—", ndash: "–", hellip: "…" };
const decode = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => e[0] === "#"
  ? String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10))
  : ENTITIES[e.toLowerCase()] ?? m);

/** Разбор публичной страницы t.me/s/<канал>: текст, дата, картинки и признаки рекламы. */
export function parseChannelPage(html) {
  const posts = [];
  for (const block of html.split(/(?=<div class="tgme_widget_message_wrap)/).slice(1)) {
    const id = Number(block.match(/data-post="[^"/]+\/(\d+)"/)?.[1]);
    if (!id) continue;
    const at = block.match(/<time datetime="([^"]+)"/)?.[1] ?? null;
    const raw = block.match(/<div class="tgme_widget_message_text js-message_text"[^>]*>([\s\S]*?)<\/div>/)?.[1] ?? "";
    const links = [...raw.matchAll(/<a\s[^>]*href="([^"]+)"/g)].map((m) => decode(m[1]));
    const text = decode(raw
      .replace(/<br\s*\/?>/g, "\n")
      .replace(/<i class="emoji"[^>]*><b>([\s\S]*?)<\/b><\/i>/g, "$1")
      .replace(/<[^>]+>/g, ""))
      .replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
    const photos = [...block.matchAll(/tgme_widget_message_photo_wrap[^>]*background-image:url\('([^']+)'\)/g)].map((m) => m[1]);
    posts.push({
      id, at, text, links, photos,
      forwarded: block.includes("tgme_widget_message_forwarded_from"),
      video: /tgme_widget_message_video|tgme_widget_message_roundvideo/.test(block),
      other: /tgme_widget_message_(sticker|document|poll|voice|inline_keyboard)/.test(block),
    });
  }
  return posts;
}

/** Реклама и всё, что нельзя перенести как обычный пост: причина или null. */
export function skipReason(post) {
  if (post.forwarded) return "пересланный пост";
  if (post.video) return "видео — публикатор пока выкладывает только текст и картинки";
  if (post.other) return "стикер, файл, опрос или кнопки";
  if (!post.text && !post.photos.length) return "пустой пост";
  if (/\berid\b|#реклама|(^|\s)реклама(\s|$)|промокод|по ссылке|подписывайтесь на|розыгрыш|giveaway|explore more|join us|register/iu.test(post.text)) return "похоже на рекламу";
  const latin = (post.text.match(/[a-z]/gi) ?? []).length, cyr = (post.text.match(/[а-яё]/gi) ?? []).length;
  if (latin > 40 && latin > cyr * 1.5) return "англоязычный пост — похоже на рекламу партнёров";
  // Владелец 8.11: посты со ссылкой не публикуем совсем — и наружу, и на телеграм, и спрятанную под словом.
  if (post.links.length || /https?:\/\/|\bwww\.|\bt\.me\/|\btelegram\.me\/|\b[a-z0-9-]+\.(com|org|net|io|ru|me|app|xyz|ai|co|gg|finance|exchange)\b/i.test(post.text)) return "в посте есть ссылка";
  if (post.photos.length > 4) return "больше четырёх картинок";
  return null;
}

async function fetchPage(before) {
  const url = `https://t.me/s/${CHANNEL}${before ? `?before=${before}` : ""}`;
  const res = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130 Safari/537.36", "accept-language": "ru-RU,ru" } });
  if (!res.ok) throw new Error(`t.me ответил ${res.status}`);
  return parseChannelPage(await res.text());
}

const localHour = (d = new Date()) => Number(new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", hourCycle: "h23" }).format(d));

if (process.argv[2] === "parse") {
  const out = [];
  for (const f of process.argv.slice(3)) out.push(...parseChannelPage(await fs.readFile(f, "utf8")));
  const uniq = [...new Map(out.map((p) => [p.id, p])).values()].sort((a, b) => a.id - b.id);
  console.log(JSON.stringify(uniq.map((p) => ({ ...p, skip: skipReason(p) }))));
  process.exit(0);
}

const dry = process.argv[2] === "dry";
const { loadSettings } = await import("/app/dist/src/config/settings.js");
const { query } = await import("/app/dist/src/db/pool.js");
const { insertDraft, updateDraft } = await import("/app/dist/src/db/repos/drafts.js");
const { enqueue } = await import("/app/dist/src/queue/queues.js");
const { platform: adapter } = await import("/app/dist/src/platforms/index.js");
const { publicMediaUrl } = await import("/app/dist/src/api/routes/media.js");
const { xBrowser } = await import("/app/dist/src/x/browser/client.js");
const sharp = (await import("/app/node_modules/sharp/dist/index.cjs")).default;

const log = (msg) => console.log(`${new Date().toLocaleString("ru-RU", { timeZone: TZ })} ${msg}`);
const [row] = await query(`SELECT value FROM settings WHERE key = 'tg_mirror'`);
const state = { enabled: true, lastSeenId: 0, published: {}, pool: [], ...(row?.value ?? {}) };
const save = async () => { if (!dry) await query(`INSERT INTO settings (key, value) VALUES ('tg_mirror', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`, [JSON.stringify(state)]); };

const settings = await loadSettings(true);
const [own] = await query(`SELECT value FROM settings WHERE key = 'claude_sessions'`);
if (!state.enabled || settings.killSwitch || settings.mode === "OFF" || own?.value?.paused) {
  log(`перенос на паузе (tg_mirror.enabled=${state.enabled}, killSwitch=${settings.killSwitch}, mode=${settings.mode})`);
  process.exit(0);
}

const page = await fetchPage();
if (!page.length) { log("канал не прочитан: на странице нет постов"); process.exit(1); }
const newest = Math.max(...page.map((p) => p.id));
if (!state.lastSeenId) {
  // Первый запуск: старые посты не переносим, ждём следующий.
  state.lastSeenId = newest;
  await save();
  log(`старт: последний пост канала #${newest}, переносим всё, что выйдет после него`);
  process.exit(0);
}

async function saveImage(url) {
  const id = randomUUID();
  const dir = `/app/data/media/${id}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`картинка не скачалась: ${res.status}`);
  await fs.mkdir(dir, { recursive: true });
  await sharp(Buffer.from(await res.arrayBuffer())).rotate().jpeg({ quality: 92 }).toFile(`${dir}/final.jpg`);
  await query(`INSERT INTO media_assets (id, original_url, local_path, final_path, media_type, status) VALUES ($1, $2, $3, $3, 'image', 'QA_PASSED')`, [id, `tg:${CHANNEL}`, `${dir}/final.jpg`]);
  const check = await fetch(publicMediaUrl(id)).catch((e) => ({ ok: false, status: e.message }));
  if (!check.ok) throw new Error(`публичная ссылка на картинку не открывается (${check.status})`);
  return id;
}

/** Один пост канала на одну площадку: черновик без правок, сразу в очередь публикатора. Возвращает id черновика. */
async function publish(post, p, reason) {
  const key = `tg-${CHANNEL}-${post.id}-${p}`;
  const [dup] = await query(`SELECT id FROM drafts WHERE validation_json->'claudeSession'->>'key' = $1`, [key]);
  if (dup) return { draftId: dup.id, note: "уже есть" };
  if (dry) return { draftId: null, note: `ушло бы: ${post.text.slice(0, 80).replace(/\n/g, " ")}${post.photos.length ? ` + картинок ${post.photos.length}` : ""}` };
  const images = [];
  for (const url of post.photos) images.push(await saveImage(url));
  const draft = await insertDraft({
    candidateId: null, kind: "TOPIC", type: "DISCUSSION", text: post.text, textX: p === "x" ? post.text : null, platforms: [p],
    hook: null, body: null, sourceSummary: `Пост владельца из t.me/${CHANNEL}/${post.id} (${reason}), без правок.`, sourceUrls: [`https://t.me/${CHANNEL}/${post.id}`],
    confidence: 100, riskScore: 0, status: "APPROVED", reviewReason: null, priority: "P1",
    promptVersion: "tg-mirror-v1", model: "owner-telegram",
    validation: { blocking: false, violations: [], claudeSession: { key, tgPost: post.id, reason } },
    variants: [], expiresAt: new Date(Date.now() + 6 * 3600_000), imageAssetId: images[0] ?? null,
  });
  await updateDraft(draft.id, { approved_by_user: true, ...(images.length > 1 ? { additional_image_asset_ids: images.slice(1) } : {}) });
  for (const id of images) await query(`UPDATE media_assets SET draft_id = $1 WHERE id = $2`, [draft.id, id]);
  await enqueue("publisher", "publisher:publish", { draftId: draft.id, manual: true }, { jobId: key, attempts: 3, backoff: { type: "exponential", delay: 60_000 } });
  return { draftId: draft.id, note: `в очереди, черновик ${draft.id}` };
}

// Площадка считается сделанной, только когда пост реально вышел (ok) или мы сдались после повторов (gaveUp).
// Строка — запись до 8.11, когда отметка ставилась при постановке в очередь.
const finished = (v) => typeof v === "string" || Boolean(v?.ok || v?.gaveUp);
const unfinishedEntry = (d) => !d.skipped && PLATFORMS.some((p) => !finished(d[p]));

// Браузер X отвечает прямо сейчас? Пауза сторожа сайта после загрузки ПК и перезапуск контейнера видны как таймаут.
// Отправка в такой момент зависает на минуты и навсегда остаётся «неизвестно, ушло ли», поэтому пост просто ждёт.
let xUp = null;
async function xReady() {
  if (xUp === null) {
    xUp = await xBrowser().call("status", {}, 8000).then((s) => s.connected === true).catch(() => false);
    if (!xUp && !state.xDownSince) { log("браузер X недоступен — посты в X подождут"); if (!dry) state.xDownSince = new Date().toISOString(); }
    if (xUp && state.xDownSince) { log("браузер X снова отвечает"); if (!dry) delete state.xDownSince; }
  }
  return xUp;
}

// Первые слова поста как фраза для поиска X: без знаков препинания, в нижнем регистре.
const phrase = (text, n = 6) => text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean).slice(0, n).join(" ");
async function foundInSearch(text) {
  const wanted = phrase(text);
  const { posts } = await xBrowser().search(`from:${PUBLISHERS.x} "${wanted}"`, 10, "live");
  return posts.find((m) => (m.username ?? "").toLowerCase() === PUBLISHERS.x.toLowerCase() && phrase(m.text ?? "", 500).includes(wanted)) ?? null;
}

/**
 * Защита от дублей помечает отправку «неизвестно, ушло ли» и больше не повторяет её. Запоздавший пост успеет появиться
 * за LATE_POST_MIN; потом смотрим поиском X. Верх профиля для этого не годится: лента подгружается кусками и пропускает
 * посты уже с пятого-шестого. Поиску верим, только если он находит контрольный пост, который точно вышел.
 * Ответ: "go" — можно повторять, "wait" — пока рано, "exists" — пост уже есть, "giveup" — выяснить не удалось.
 */
async function clearFalseUnknown(draftId) {
  const key = `draft:${draftId}:x`;
  const [attempt] = await query(`SELECT status, created_at, updated_at FROM publication_attempts WHERE idempotency_key = $1`, [key]);
  if (attempt?.status !== "UNKNOWN") return "go";
  const quietMin = (Date.now() - new Date(attempt.updated_at).getTime()) / 60000;
  if (quietMin < LATE_POST_MIN) return "wait";
  const [draft] = await query(`SELECT text_x FROM drafts WHERE id = $1`, [draftId]);
  const [control] = await query(`SELECT published_text FROM publications WHERE platform = 'x' AND NOT dry_run AND published_at < now() - interval '1 hour' AND published_text !~ 'https?://' ORDER BY published_at DESC LIMIT 1`);
  const verdict = await (async () => {
    if (!control || !(await foundInSearch(control.published_text))) return "wait"; // поиск сейчас не показателен
    return (await foundInSearch(draft.text_x)) ? "exists" : "absent";
  })().catch(() => "wait");
  if (verdict === "wait") return quietMin > GIVE_UP_UNKNOWN_MIN ? "giveup" : "wait";
  if (verdict === "exists") return "exists";
  log(`черновик ${draftId}: через ${Math.round(quietMin)} мин поиск X поста не находит — отправка не дошла, снимаю блокировку`);
  if (!dry) await query(`UPDATE publication_attempts SET status = 'STARTED', error = 'поиск X: поста нет', updated_at = now() WHERE idempotency_key = $1 AND status = 'UNKNOWN'`, [key]);
  return "go";
}

async function sendEverywhere(post, reason) {
  const done = state.published[post.id] ?? { attempts: 0 };
  let tried = false;
  for (const p of PLATFORMS) {
    if (done[p]) continue;
    if (p === "x" && !(await xReady())) continue;
    tried = true;
    try {
      const me = await adapter(p).me();
      if (me.username.replace(/^@/, "").toLowerCase() !== PUBLISHERS[p].toLowerCase()) throw new Error(`издатель ${p} сейчас @${me.username}`);
      const result = await publish(post, p, reason);
      if (!dry) done[p] = { draftId: result.draftId, queuedAt: new Date().toISOString(), retries: 0 };
      log(`#${post.id} → ${p}: ${result.note}`);
    } catch (err) {
      log(`#${post.id} → ${p}: не ушло (${String(err?.message ?? err).slice(0, 160)}), повторим на следующем проходе`);
    }
  }
  // Ожидание браузера попыткой не считается: сторож может держать его на паузе дольше, чем длятся все попытки.
  if (!dry) { if (tried) done.attempts += 1; state.published[post.id] = done; }
}

// 1. Новые посты канала — сразу и без правок.
const fresh = page.filter((p) => p.id > state.lastSeenId).sort((a, b) => a.id - b.id);
for (const post of fresh) {
  const why = skipReason(post);
  if (why) { log(`#${post.id} пропущен: ${why}`); if (!dry) state.published[post.id] = { skipped: why }; continue; }
  await sendEverywhere(post, "новый пост канала");
}
if (fresh.length && !dry) state.lastSeenId = Math.max(state.lastSeenId, ...fresh.map((p) => p.id));

// 2. Досылка: черновик на площадку так и не создался (например, X был на паузе).
const unfinished = Object.entries(state.published)
  .filter(([, d]) => !d.skipped && PLATFORMS.some((p) => !d[p]) && d.attempts < MAX_ATTEMPTS)
  .map(([id]) => Number(id)).filter((id) => !fresh.some((p) => p.id === id));
for (const id of unfinished) {
  const post = page.find((p) => p.id === id) ?? (await fetchPage(id + 1)).find((p) => p.id === id);
  if (post) await sendEverywhere(post, state.published[id]?.reason ?? "досылка");
}

// 3. Черновик создан, но пост не вышел: публикатор упал (браузер X не нажал кнопку) или задача потерялась —
// возвращаем черновик в очередь, до трёх повторов на площадку.
for (const [tgId, d] of Object.entries(state.published)) {
  if (d.skipped) continue;
  for (const p of PLATFORMS) {
    const t = d[p];
    if (!t || finished(t) || !t.draftId) continue;
    const [row] = await query(`SELECT d.status, d.error, pub.published_at FROM drafts d
      LEFT JOIN publications pub ON pub.draft_id = d.id AND pub.platform = $2 AND NOT pub.dry_run WHERE d.id = $1`, [t.draftId, p]);
    if (row?.published_at) { if (!dry) t.ok = new Date(row.published_at).toISOString(); continue; }
    const waitingMin = (Date.now() - new Date(t.retriedAt ?? t.queuedAt).getTime()) / 60000;
    const failed = !row || ["FAILED", "EXPIRED", "REJECTED", "NEEDS_REVIEW", "PARTIAL"].includes(row.status);
    const lost = row && ["APPROVED", "SCHEDULED"].includes(row.status) && waitingMin > 30;
    if (!failed && !lost) continue;
    const why = row ? `${row.status}${row.error ? `: ${String(row.error).split("\n")[0].slice(0, 120)}` : ""}` : "черновик пропал";
    if ((t.retries ?? 0) >= MAX_RETRIES || !row) {
      log(`#${tgId} → ${p}: не вышел после ${t.retries ?? 0} повторов (${why}) — сдаюсь, нужен ручной разбор`);
      if (!dry) t.gaveUp = new Date().toISOString();
      continue;
    }
    if (waitingMin < RETRY_WAIT_MIN[t.retries ?? 0]) continue;
    if (p === "x") {
      if (!(await xReady())) continue;
      const verdict = await clearFalseUnknown(t.draftId);
      if (verdict === "wait") continue;
      if (verdict === "exists") {
        log(`#${tgId} → x: пост уже есть в X — повторять не нужно`);
        if (!dry) t.ok = new Date().toISOString();
        continue;
      }
      if (verdict === "giveup") {
        log(`#${tgId} → x: неизвестно, вышел ли пост, и поиск X этого не прояснил — не отправляю, чтобы не создать дубль`);
        if (!dry) t.gaveUp = new Date().toISOString();
        continue;
      }
    }
    log(`#${tgId} → ${p}: не вышел (${why}) — повтор ${(t.retries ?? 0) + 1} из ${MAX_RETRIES}`);
    if (dry) continue;
    await query(`UPDATE drafts SET status = 'APPROVED', error = NULL, expires_at = greatest(expires_at, now() + interval '6 hours'), updated_at = now() WHERE id = $1`, [t.draftId]);
    t.retries = (t.retries ?? 0) + 1;
    t.retriedAt = new Date().toISOString();
    await enqueue("publisher", "publisher:publish", { draftId: t.draftId, manual: true }, { jobId: `tg-${CHANNEL}-${tgId}-${p}-r${t.retries}-${Date.now()}`, attempts: 1 });
  }
}

// 4. Тишина больше 7 часов — днём выпускаем вневременной пост из запаса.
const hour = localHour();
if (hour >= FALLBACK_HOURS[0] && hour < FALLBACK_HOURS[1]) {
  const [last] = await query(`SELECT max(published_at) AS at FROM publications WHERE platform = 'threads' AND NOT dry_run`);
  const silentHours = last?.at ? (Date.now() - new Date(last.at).getTime()) / 3_600_000 : Infinity;
  const pending = Object.values(state.published).some((d) => unfinishedEntry(d) && d.attempts < MAX_ATTEMPTS);
  // Только что поставленный в очередь пост ещё не в publications — тишина уже закончилась.
  const [queued] = await query(`SELECT count(*)::int AS n FROM drafts WHERE prompt_version = 'tg-mirror-v1' AND status IN ('APPROVED','SCHEDULED','PUBLISHING') AND created_at > now() - interval '1 hour'`);
  const sentNow = fresh.some((p) => !skipReason(p));
  if (silentHours >= SILENCE_HOURS && !pending && !sentNow && !queued.n) {
    const nextId = state.pool.find((id) => !state.published[id]);
    if (!nextId) log(`тишина ${silentHours.toFixed(1)} ч, но запас вневременных постов пуст — пополнить tg_mirror.pool`);
    else {
      const post = (await fetchPage(nextId + 1)).find((p) => p.id === nextId);
      if (!post || skipReason(post)) { log(`запасной #${nextId} недоступен (${post ? skipReason(post) : "нет на странице"}), убираю из запаса`); state.pool = state.pool.filter((id) => id !== nextId); }
      else { log(`тишина ${silentHours.toFixed(1)} ч — запасной пост #${nextId}`); await sendEverywhere(post, "запасной вневременной пост"); if (!dry) state.published[nextId].reason = "запасной вневременной пост"; }
    }
  }
}

await save();
process.exit(0);
