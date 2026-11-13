// Лента «Для вас» для поиска тем: Threads читается под @offtamatov, X — под @OwnerX.
// Печатает коротко: сначала самые обсуждаемые, потом остальные свежие.
import { xBrowser } from "/app/dist/src/x/browser/client.js";

const platform = process.argv[2] === "x" ? "x" : "threads";
const account = platform === "x" ? "OwnerX" : "offtamatov";
const max = Math.min(60, Math.max(1, Number(process.argv[3] ?? 60)));

/** Threads не отдаёт счётчики полем: берём числа из текста карточки (лайки / ответы / репосты / пересылки; нули Threads не показывает). */
function cardNumbers(rendered) {
  return (rendered ?? "").split("\n").map((l) => l.trim())
    .filter((l) => /^\d[\d\s ,.]*(тыс\.|млн)?$/.test(l))
    .map((l) => {
      const n = Number(l.replace(/[\s ]/g, "").replace(",", ".").replace(/(тыс\.|млн)$/, ""));
      return /тыс\.$/.test(l) ? n * 1000 : /млн$/.test(l) ? n * 1e6 : n;
    });
}

const snap = await xBrowser().recommendations(platform, account, max);
const now = Date.now();
const rows = snap.posts.map((p) => {
  const m = p.metrics ?? {};
  const nums = platform === "threads" ? cardNumbers(p.renderedText) : [];
  const likes = platform === "x" ? m.likes ?? 0 : nums[0] ?? 0;
  const replies = platform === "x" ? m.replies ?? 0 : nums[1] ?? 0;
  const reposts = platform === "x" ? m.reposts ?? 0 : nums[2] ?? 0;
  const ageH = p.postedAt ? (now - Date.parse(p.postedAt)) / 3.6e6 : null;
  const reach = platform === "x" ? `просм ${m.views ?? "?"} лайк ${likes} отв ${replies} рп ${reposts}` : (nums.length ? `реакции ${nums.join("/")}` : "реакций нет");
  return { p, score: likes + 2 * replies + 3 * reposts, ageH, reach };
});
rows.sort((a, b) => b.score - a.score);
console.log(`${platform} @${snap.sourceAccount} прочитано ${snap.checkedAt}, постов ${rows.length}`);
for (const r of rows) {
  const age = r.ageH == null ? "?" : r.ageH < 1 ? `${Math.round(r.ageH * 60)} мин` : `${r.ageH.toFixed(1)} ч`;
  console.log(`\n[${age}] @${r.p.username} · ${r.reach} · ${r.p.media} · ${r.p.url}\n${r.p.text.replace(/\s*\n+\s*/g, " / ").slice(0, 420)}`);
}
process.exit(0);
