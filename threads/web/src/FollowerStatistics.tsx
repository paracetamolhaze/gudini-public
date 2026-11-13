import type { FollowerStats, FollowerStatsReport } from "../../src/shared/followerStats";
import { post } from "./api";
import { fmtDate, fmtNum, useAction, useFetch } from "./hooks";
import { Icon, PlatformMark } from "./kit";
import { Button, Card, ErrorBox, Notice } from "./ui";

const PERIODS = [
  { key: "day", label: "За 24 часа" },
  { key: "week", label: "За 7 дней" },
  { key: "month", label: "За 30 дней" },
  { key: "sinceStart", label: "С начала наблюдения" },
] as const;

function FollowerCard({ label, data, platform }: { label: string; data: FollowerStats; platform?: "threads" | "x" }) {
  return <section className="publication-total follower-total" aria-label={`Подписчики: ${label}`}>
    <div className="publication-total-heading">{platform && <PlatformMark id={platform} size={22} />}<h3>{label}</h3></div>
    {data.username && <div className="muted small follower-username">@{data.username}</div>}
    <div className="follower-count">{data.approximate && data.followers !== null ? "≈ " : ""}{fmtNum(data.followers)}</div>
    <span className="muted small">Подписчиков сейчас</span>
    <dl className="follower-changes">{PERIODS.map(period => {
      const change = data.changes[period.key];
      return <div key={period.key}><dt>{period.label}</dt><dd className={change === null || change === 0 ? "" : change > 0 ? "follower-up" : "follower-down"}>{change !== null && change > 0 ? "+" : ""}{fmtNum(change)}</dd></div>;
    })}</dl>
    <div className="follower-dates muted small">
      {data.trackingSince && <span>Наблюдение с {fmtDate(data.trackingSince)}</span>}
      <span>{data.updatedAt ? `Обновлено ${fmtDate(data.updatedAt)}` : "Ожидаем первый замер"}</span>
    </div>
    {data.error && <p className="follower-error small" role="status">{data.error}</p>}
  </section>;
}

export default function FollowerStatistics() {
  const stats = useFetch<FollowerStatsReport>("/analytics/followers", { intervalMs: 30_000 });
  const act = useAction();
  return <Card title="Подписчики" actions={<Button size="sm" busy={act.busy !== null} onClick={() => void act.run("Обновить подписчиков", () => post("/analytics/followers/refresh"), stats.reload, { done: "Обновление подписчиков запущено. Данные появятся автоматически." })}><Icon name="refresh" size={16} /> Обновить подписчиков</Button>}>
    <ErrorBox text={stats.error} /><ErrorBox text={act.error} /><Notice text={act.notice} />
    {!stats.data && !stats.error && <div className="muted" aria-busy="true">Загружаем подписчиков…</div>}
    {!stats.data && stats.error && <Button size="sm" onClick={() => void stats.reload()}>Повторить</Button>}
    {stats.data && <>
      <div className="publication-totals follower-totals">
        <FollowerCard label="Threads + X" data={stats.data.total} />
        <FollowerCard label="Threads" platform="threads" data={stats.data.platforms.threads} />
        <FollowerCard label="X" platform="x" data={stats.data.platforms.x} />
      </div>
      <p className="publication-stat-note muted small">Прирост учитывает отписки. Значения за период появятся, когда накопится история. «—» означает, что данных пока недостаточно; «≈» — округлённое число.</p>
      <p className="publication-stat-note muted small">Общий итог — сумма подписчиков Threads и X. Один человек может быть подписан на обе площадки.</p>
    </>}
  </Card>;
}
