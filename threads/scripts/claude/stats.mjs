// Что уже вышло на площадке: счёт за местный день, последний пост и реакция на посты за неделю.
import { query } from "/app/dist/src/db/pool.js";

const platform = process.argv[2] === "x" ? "x" : "threads";
// С 4.11 обе площадки работают на СНГ: день считается по времени владельца.
const tz = "Asia/Qyzylorda";

const [day] = await query(`SELECT
    count(*) FILTER (WHERE (published_at AT TIME ZONE $2)::date = (now() AT TIME ZONE $2)::date)::int AS today,
    max(published_at) AS last
  FROM publications WHERE platform = $1 AND NOT dry_run`, [platform, tz]);
const local = new Date().toLocaleString("ru-RU", { timeZone: tz });
const gap = day.last ? Math.round((Date.now() - new Date(day.last).getTime()) / 60000) : null;
console.log(`${platform}: сейчас ${local} (${tz}); сегодня вышло ${day.today} из 5; прошлый пост ${gap == null ? "—" : `${gap} мин назад`}`);

const rows = await query(`WITH last AS (
    SELECT DISTINCT ON (publication_id) publication_id, views, likes, replies, reposts
    FROM insight_snapshots ORDER BY publication_id, captured_at DESC)
  SELECT p.published_at, p.model, l.views, l.likes, l.replies, l.reposts, p.published_text
  FROM publications p LEFT JOIN last l ON l.publication_id = p.id
  WHERE p.platform = $1 AND NOT p.dry_run AND p.published_at > now() - interval '7 days'
  ORDER BY p.published_at DESC LIMIT 40`, [platform]);
const views = rows.map((r) => r.views).filter((v) => v != null).sort((a, b) => a - b);
const median = views.length ? views[Math.floor(views.length / 2)] : null;
console.log(`за 7 дней: ${rows.length} постов, медиана просмотров ${median ?? "нет данных"}`);
for (const r of rows) {
  const at = new Date(r.published_at).toLocaleString("ru-RU", { timeZone: tz, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  console.log(`${at} · ${r.model ?? "?"} · просм ${r.views ?? "?"} лайк ${r.likes ?? 0} отв ${r.replies ?? 0} · ${r.published_text.replace(/\s*\n+\s*/g, " / ").slice(0, 150)}`);
}
process.exit(0);
