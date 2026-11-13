import { useState } from "react";
import type { MetricTotals, PublicationStats, PublicationStatsReport } from "../../src/shared/publicationStats";
import { post } from "./api";
import { fmtDate, fmtNum, useAction, useFetch } from "./hooks";
import { Icon, PlatformMark } from "./kit";
import { Button, Card, Empty, ErrorBox, Notice } from "./ui";

const PAGE_SIZE = 10;
const PLATFORMS = ["threads", "x"] as const;
const LABELS = { threads: "Threads", x: "X" };

function TotalsCard({ label, totals, platform }: { label: string; totals: MetricTotals; platform?: "threads" | "x" }) {
  return <section className="publication-total" aria-label={label}>
    <div className="publication-total-heading">{platform && <PlatformMark id={platform} size={22} />}<h3>{label}</h3><span>{fmtNum(totals.posts)} постов</span></div>
    <dl className="publication-total-numbers">
      <div><dt>Просмотры</dt><dd>{fmtNum(totals.views)}</dd></div>
      <div><dt>Лайки</dt><dd>{fmtNum(totals.likes)}</dd></div>
      <div><dt>Комментарии</dt><dd>{fmtNum(totals.replies)}</dd></div>
    </dl>
    <div className="muted small">{totals.posts === 0 ? "Публикаций пока нет" : `Метрики: ${fmtNum(totals.measuredPosts)} из ${fmtNum(totals.posts)} постов`}</div>
  </section>;
}

function PostStatistics({ item }: { item: PublicationStats }) {
  return <article className="publication-stat-post">
    <div className="publication-stat-post-heading"><p title={item.text}>{item.text || "Публикация без текста"}</p><time dateTime={item.publishedAt}>{fmtDate(item.publishedAt)}</time></div>
    <table className="publication-stat-table">
      <caption className="sr-only">Статистика публикации от {fmtDate(item.publishedAt)}</caption>
      <thead><tr><th scope="col">Площадка</th><th scope="col">Просмотры</th><th scope="col">Лайки</th><th scope="col">Комментарии</th></tr></thead>
      <tbody>
        <tr className="publication-stat-combined"><th scope="row">Вместе</th><td>{fmtNum(item.totals.views)}</td><td>{fmtNum(item.totals.likes)}</td><td>{fmtNum(item.totals.replies)}</td></tr>
        {PLATFORMS.map(id => {
          const values = item.platforms[id];
          return <tr key={id}>
            <th scope="row">{values?.permalink ? <a href={values.permalink} target="_blank" rel="noreferrer">{LABELS[id]} ↗</a> : LABELS[id]}</th>
            <td>{fmtNum(values?.views)}</td><td>{fmtNum(values?.likes)}</td><td>{fmtNum(values?.replies)}</td>
          </tr>;
        })}
      </tbody>
    </table>
    <div className="publication-stat-updated muted small">{PLATFORMS.filter(id => item.platforms[id]).map(id => <span key={id}>{LABELS[id]}: {item.platforms[id]?.updatedAt ? `обновлено ${fmtDate(item.platforms[id]?.updatedAt)}` : "метрики ещё не получены"}</span>)}</div>
  </article>;
}

function StatisticsPage({ offset, onPage }: { offset: number; onPage: (offset: number) => void }) {
  const stats = useFetch<PublicationStatsReport>(`/analytics/publications?limit=${PAGE_SIZE}&offset=${offset}`, { intervalMs: 30_000 });
  const act = useAction();
  const data = stats.data;
  return <div className="publication-statistics">
    <Card title="Статистика публикаций" actions={<Button size="sm" busy={act.busy !== null} onClick={() => void act.run("Обновить статистику", () => post("/analytics/publications/refresh"), stats.reload, { done: "Сбор статистики запущен. Данные обновятся автоматически." })}><Icon name="refresh" size={16} /> Обновить статистику</Button>}>
      <ErrorBox text={stats.error} /><ErrorBox text={act.error} /><Notice text={act.notice} />
      {!data && !stats.error && <div className="muted" aria-busy="true">Загружаем статистику…</div>}
      {!data && stats.error && <Button size="sm" onClick={() => void stats.reload()}>Повторить</Button>}
      {data && <>
        <p className="publication-stat-note muted small">За всё время · сумма последних доступных счётчиков</p>
        <div className="publication-totals">
          <TotalsCard label="Threads + X" totals={data.totals} />
          {PLATFORMS.map(id => <TotalsCard key={id} label={LABELS[id]} platform={id} totals={data.platforms[id]} />)}
        </div>
        <p className="publication-stat-note muted small">Один пост в двух соцсетях считается одним постом в общем итоге. Просмотры, лайки и комментарии суммируются. «—» означает, что счётчик ещё недоступен.</p>
      </>}
    </Card>
    {data && <Card title="Каждый пост отдельно">
      {data.totalPosts === 0 ? <Empty title="Опубликованных постов пока нет" text="Здесь появятся просмотры, лайки и комментарии для каждой публикации." /> : <>
        <div className="publication-stat-list" aria-live="polite">{data.posts.map(item => <PostStatistics key={item.id} item={item} />)}</div>
        <div className="publication-stat-pagination">
          <span className="muted small">{offset + 1}–{Math.min(offset + PAGE_SIZE, data.totalPosts)} из {fmtNum(data.totalPosts)} постов</span>
          <div className="row"><Button size="sm" disabled={offset === 0} onClick={() => onPage(Math.max(0, offset - PAGE_SIZE))}>Назад</Button><Button size="sm" disabled={offset + PAGE_SIZE >= data.totalPosts} onClick={() => onPage(offset + PAGE_SIZE)}>Далее</Button></div>
        </div>
      </>}
    </Card>}
  </div>;
}

export default function PublicationStatistics() {
  const [offset, setOffset] = useState(0);
  return <StatisticsPage key={offset} offset={offset} onPage={setOffset} />;
}
