// Публикация поста, который написал Claude: один пост на одну площадку.
// Вход — JSON-файл { platform, text, sourceUrls, note, key }; "force": true снимает только проверку темпа.
// Второй аргумент — картинка JPEG: run.sh publish post.json picture.jpg
import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { publicMediaUrl } from "/app/dist/src/api/routes/media.js";
import { loadSettings } from "/app/dist/src/config/settings.js";
import { query } from "/app/dist/src/db/pool.js";
import { insertDraft, updateDraft } from "/app/dist/src/db/repos/drafts.js";
import { enqueue } from "/app/dist/src/queue/queues.js";
import { platform as adapter } from "/app/dist/src/platforms/index.js";

const PUBLISHERS = { threads: "owner.threads", x: "OwnerX" };
const TZ = { threads: "Asia/Qyzylorda", x: "Asia/Qyzylorda" };
const PER_DAY = 5;
const MIN_GAP_MIN = 90;

const fail = (msg) => { console.log(`СТОП: ${msg}`); process.exit(2); };
const input = JSON.parse(await fs.readFile(process.argv[2], "utf8"));
const p = input.platform;
if (p !== "threads" && p !== "x") fail("platform должен быть threads или x");
const text = String(input.text ?? "").trim();
const key = String(input.key ?? "").trim();
if (!text) fail("пустой текст");
if (!key) fail("нет key");

const imageArg = process.argv[3];
if (imageArg) {
  const head = await fs.readFile(imageArg).then((b) => b.subarray(0, 3)).catch(() => null);
  if (!head || head[0] !== 0xff || head[1] !== 0xd8) fail(`картинка ${imageArg} не JPEG или не найдена`);
}

const chars = Array.from(text).length;
if (p === "threads") {
  if (chars > 500) fail(`Threads: ${chars} символов, максимум 500`);
  if (/(^|\s)#[\p{L}\p{N}_]+/u.test(text)) fail("в Threads хештеги не ставим");
} else {
  if (chars > 280) fail(`X: ${chars} символов, максимум 280`);
}

// Пауза дашборда глушит серверную автоматику, а не посты Claude; их останавливает строка settings 'claude_sessions'.
const [own] = await query(`SELECT value FROM settings WHERE key = 'claude_sessions'`);
if (own?.value?.paused) fail("посты Claude поставлены на паузу (settings.claude_sessions.paused)");
await loadSettings(true);
const me = await adapter(p).me();
if (me.username.replace(/^@/, "").toLowerCase() !== PUBLISHERS[p].toLowerCase()) fail(`издатель ${p} сейчас @${me.username}, ждали @${PUBLISHERS[p]}`);

const dup = await query(`SELECT id, status FROM drafts WHERE validation_json->'claudeSession'->>'key' = $1 OR (text = $2 AND $3 = ANY(platforms))`, [key, text, p]);
if (dup.length) fail(`такой пост уже есть: ${JSON.stringify(dup)}`);

const [cadence] = await query(`SELECT
    count(*) FILTER (WHERE (published_at AT TIME ZONE $2)::date = (now() AT TIME ZONE $2)::date)::int AS today,
    max(published_at) AS last
  FROM publications WHERE platform = $1 AND NOT dry_run`, [p, TZ[p]]);
const gap = cadence.last ? (Date.now() - new Date(cadence.last).getTime()) / 60000 : Infinity;
if (!input.force && cadence.today >= PER_DAY) fail(`сегодня уже ${cadence.today} постов в ${p}`);
// Небольшая случайная задержка, чтобы посты не выходили минута в минуту по расписанию.
// Если до паузы между постами не хватает до 40 минут (владелец выложил свой пост незадолго до слота), пост ждёт, а не пропадает.
let delayMin = Math.max(0, Math.min(40, Number(input.delayMinutes ?? 0) || 0));
if (!input.force && gap + delayMin < MIN_GAP_MIN) {
  const wait = Math.ceil(MIN_GAP_MIN - gap);
  if (wait > 40) fail(`прошлый пост в ${p} был ${Math.round(gap)} мин назад, ждём ${MIN_GAP_MIN}`);
  delayMin = wait;
}
if (input.dryRun) { console.log(`ПРОВЕРКА ПРОЙДЕНА ${p}: издатель @${me.username}, сегодня ${cadence.today}, ${chars} символов, задержка ${delayMin} мин${imageArg ? ", с картинкой" : ""} — не опубликовано (dryRun)`); process.exit(0); }

// Картинку Threads скачивает сам по публичной ссылке, поэтому кладём её в общий том и проверяем ссылку до публикации:
// без картинки такой пост уходить не должен.
let imageAssetId = null;
if (imageArg) {
  imageAssetId = randomUUID();
  const finalPath = `/app/data/media/${imageAssetId}/final.jpg`;
  await fs.mkdir(`/app/data/media/${imageAssetId}`, { recursive: true });
  await fs.copyFile(imageArg, finalPath);
  await query(`INSERT INTO media_assets (id, original_url, local_path, final_path, media_type, status) VALUES ($1, 'claude-session', $2, $2, 'image', 'QA_PASSED')`, [imageAssetId, finalPath]);
  const res = await fetch(publicMediaUrl(imageAssetId)).catch((e) => ({ ok: false, status: e.message }));
  if (!res.ok) fail(`публичная ссылка на картинку не открывается (${res.status}) — Threads её не скачает`);
}

const draft = await insertDraft({
  candidateId: null, kind: "TOPIC", type: "DISCUSSION", text, textX: p === "x" ? text : null, platforms: [p],
  hook: null, body: null, sourceSummary: String(input.note ?? "").slice(0, 1500), sourceUrls: Array.isArray(input.sourceUrls) ? input.sourceUrls : [],
  confidence: 100, riskScore: 0, status: "APPROVED", reviewReason: null, priority: "P2",
  promptVersion: "claude-session-v1", model: "claude-opus-5-5",
  validation: { blocking: false, violations: [], claudeSession: { key, checkedAt: new Date().toISOString(), cadence } },
  variants: [], expiresAt: new Date(Date.now() + 2 * 3600_000), imageAssetId,
});
if (imageAssetId) await query(`UPDATE media_assets SET draft_id = $1 WHERE id = $2`, [draft.id, imageAssetId]);
// Одобренный APPROVED публикатор забирает сразу, поэтому отложенный пост стоит SCHEDULED до своей минуты.
await updateDraft(draft.id, { approved_by_user: true, ...(delayMin ? { status: "SCHEDULED", scheduled_at: new Date(Date.now() + delayMin * 60_000) } : {}) });
await enqueue("publisher", "publisher:publish", { draftId: draft.id, manual: true }, { jobId: `claude-${key}`, attempts: 1, ...(delayMin ? { delay: delayMin * 60_000 } : {}) });
if (delayMin) {
  const at = new Date(Date.now() + delayMin * 60_000).toLocaleString("ru-RU", { timeZone: TZ[p], hour: "2-digit", minute: "2-digit" });
  console.log(`ЗАПЛАНИРОВАНО ${p} на ${at} (${TZ[p]}), черновик ${draft.id}`);
  process.exit(0);
}

for (let i = 0; i < 40; i++) {
  await new Promise((r) => setTimeout(r, 3000));
  const [pub] = await query(`SELECT permalink, platform_post_id FROM publications WHERE draft_id = $1 AND platform = $2`, [draft.id, p]);
  if (pub) { console.log(`ОПУБЛИКОВАНО ${p}: ${pub.permalink ?? pub.platform_post_id}`); process.exit(0); }
  const [d] = await query(`SELECT status, error, review_reason FROM drafts WHERE id = $1`, [draft.id]);
  if (["FAILED", "NEEDS_REVIEW", "REJECTED"].includes(d.status)) fail(`публикация не прошла: ${d.status} ${d.error ?? d.review_reason ?? ""}`);
}
console.log(`ЖДЁТ: черновик ${draft.id} поставлен в очередь, публикация ещё не подтвердилась — проверь stats через пару минут`);
process.exit(0);
