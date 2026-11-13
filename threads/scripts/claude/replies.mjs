// Собрать новые комментарии под своими постами (без серверной генерации ответов) и показать, кому ответить.
import { loadSettings } from "/app/dist/src/config/settings.js";
import { query } from "/app/dist/src/db/pool.js";
import { platform as adapter } from "/app/dist/src/platforms/index.js";
import { pollPlatformInbox } from "/app/dist/src/services/replies/pipeline.js";
import { conversationChain } from "/app/dist/src/db/repos/interactions.js";
import { INVENTED_BALANCE_DRAFT } from "/app/dist/src/services/replies/editorial.js";

const p = process.argv[2] === "x" ? "x" : "threads";
const s = await loadSettings(true);
try {
  const r = await pollPlatformInbox(adapter(p), s.replies);
  console.log(`${p}: новых комментариев ${r.found}${r.notice ? ` · ${r.notice}` : ""}`);
} catch (err) {
  console.log(`${p}: комментарии не прочитаны — ${err instanceof Error ? err.message : err}`);
}

const rows = await query(`SELECT i.id, i.type, i.status, i.delivery, i.target_username, i.target_text, i.root_post_id, i.target_reply_id, i.created_at,
    p.published_text, p.draft_id
  FROM interactions i LEFT JOIN publications p ON p.id = i.publication_id
  WHERE i.platform = $1 AND i.type IN ('OWN_POST_REPLY','NESTED_REPLY') AND i.status IN ('PENDING','DRAFT','NEEDS_REVIEW','FAILED')
    AND i.created_at > now() - interval '72 hours'
  ORDER BY i.created_at ASC LIMIT 30`, [p]);
console.log(`ждут ответа: ${rows.length}`);
for (const r of rows) {
  const chain = r.root_post_id && r.target_reply_id ? await conversationChain(p, r.root_post_id, r.target_reply_id) : [];
  const before = chain.filter((m) => m.message_id !== r.target_reply_id).slice(-4)
    .map((m) => `${m.is_ours ? "МЫ" : "@" + m.username}: ${m.text.replace(/\s+/g, " ").slice(0, 160)}`);
  console.log(`\nid ${r.id} · ${r.type} · ${r.status}${r.delivery !== "api" ? ` · доставка ${r.delivery}` : ""}`);
  if (r.draft_id === INVENTED_BALANCE_DRAFT) console.log("ВНИМАНИЕ: пост-сюжет про 45 000 USDT выдуман — не подтверждать баланс, вывод и личный результат");
  console.log(`наш пост: ${(r.published_text ?? "?").replace(/\s+/g, " ").slice(0, 200)}`);
  for (const line of before) console.log(`  ${line}`);
  console.log(`@${r.target_username}: ${r.target_text.replace(/\s+/g, " ").slice(0, 400)}`);
}
// Ответ, упёршийся в часовой лимит, сервер сам не досылает (автоопрос выключен), поэтому его досылает слот.
const waiting = await query(`SELECT id, our_text FROM interactions
  WHERE platform = $1 AND status = 'APPROVED' AND our_text IS NOT NULL AND reason LIKE 'лимит ответов%' AND created_at > now() - interval '5 days'
  ORDER BY created_at ASC`, [p]);
if (waiting.length) {
  console.log(`\nждут лимита (уже написаны — добавь их в файл reply как есть): ${waiting.length}`);
  for (const w of waiting) console.log(JSON.stringify({ id: w.id, text: w.our_text }));
}
process.exit(0);
