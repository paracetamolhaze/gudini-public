"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { jobActive, shownTitle, statusOf, type ProjectSummary, type PublishedMark } from "@/lib/news/rules";
import type { StockView } from "@/lib/news/stock";
import type { NewsPick } from "@/lib/news/types";
import { api, ApiError, formatDate, formatWhen, StatusChip, usePolling, useConfirm } from "./ui";
import s from "./news.module.css";

type ListAnswer = { projects: ProjectSummary[]; runner: { seenAt: string | null; quiet: boolean }; stock: StockView };

const NETWORK: Record<PublishedMark["platform"], string> = { tiktok: "TikTok", youtube: "YouTube", instagram: "Instagram" };
const STATE_LABEL: Record<PublishedMark["state"], string> = { published: "Опубликовано", scheduled: "Запланировано", sending: "Публикуется", login: "Нужен вход" };

/** «Опубликовано: TikTok, YouTube» — one line per state, in the order of STATE_LABEL. */
function PublishedMarks({ marks }: { marks: PublishedMark[] }) {
  const net = (m: PublishedMark) => (m.trial ? `${NETWORK[m.platform]} (пробный)` : NETWORK[m.platform]);
  return (Object.keys(STATE_LABEL) as PublishedMark["state"][]).flatMap((state) => {
    const mine = marks.filter((m) => m.state === state);
    if (!mine.length) return [];
    // a schedule says when: networks that go out at the same minute share one line
    if (state === "scheduled") {
      const times = [...new Set(mine.map((m) => m.at ?? ""))].sort();
      return times.map((at) => (
        <span key={`scheduled-${at}`} className={s.posted} data-state={state}>
          {at ? `Выйдет ${formatWhen(at)}` : STATE_LABEL[state]}: {mine.filter((m) => (m.at ?? "") === at).map(net).join(", ")}
        </span>
      ));
    }
    return [
      <span key={state} className={s.posted} data-state={state}>
        {STATE_LABEL[state]}: {mine.map(net).join(", ")}
      </span>,
    ];
  });
}

/**
 * Разделы страницы (владелец 31.10: «разделил, опубликованные, готовые, истории на выбор» — полосой как «Монтаж ·
 * Публикация»). Владелец 11.11: «запланированные должны быть в отдельной колонке» — ролик, который ещё ждёт своего
 * времени хоть в одной сети, стоит в «Запланированных» (ближайший сверху) и переходит в «Опубликованные», когда вышел
 * везде. Опубликованный — вышел или уходит хоть в одну сеть; «Нужен вход» ещё не вышел. В «Готовых» всё остальное:
 * и готовые к публикации, и те, что в очереди или монтируются. Владелец 11.11: «ещё одну колонку между готовые и
 * запланированные — „доработка“»: ролик из «Готовых», в котором надо что-то поменять, он откладывает туда кнопкой и
 * возвращает обратно сам; вышедший или запланированный ролик стоит в своей вкладке, отметка ему не мешает.
 */
type Tab = "published" | "scheduled" | "rework" | "ready" | "stock";
const TABS: { id: Tab; label: string }[] = [
  { id: "published", label: "Опубликованные" },
  { id: "scheduled", label: "Запланированные" },
  { id: "rework", label: "Доработка" },
  { id: "ready", label: "Готовые" },
  { id: "stock", label: "Истории на выбор" },
];
const isTab = (v: unknown): v is Tab => TABS.some((t) => t.id === v);
const tabOf = (p: ProjectSummary): Exclude<Tab, "stock"> =>
  p.published.some((m) => m.state === "scheduled") ? "scheduled" : p.published.some((m) => m.state !== "login") ? "published" : p.rework ? "rework" : "ready";
/** The nearest time a scheduled video goes out; one without a known time sinks to the end. */
const nextOut = (p: ProjectSummary) =>
  p.published.reduce((min, m) => (m.state === "scheduled" && m.at ? Math.min(min, Date.parse(m.at)) : min), Number.MAX_SAFE_INTEGER);
const EMPTY: Record<Exclude<Tab, "stock">, string> = {
  published: "Опубликованных роликов пока нет — они появятся здесь, как только ролик уйдёт в сеть.",
  scheduled: "Запланированных роликов нет. Время выхода назначается на странице ролика кнопкой «Запланировать».",
  rework: "На доработке ничего нет. Ролик, в котором надо что-то поменять, откладывается сюда кнопкой «На доработку» во вкладке «Готовые».",
  ready: "Готовых роликов нет. Нажмите «Создать» или выберите историю во вкладке «Истории на выбор».",
};
const LIST_LABEL: Record<Exclude<Tab, "stock">, string> = { published: "Опубликованные ролики", scheduled: "Запланированные ролики", rework: "Ролики на доработке", ready: "Готовые ролики" };

/** Minutes since the PC started searching, by the phone's clock — close enough for «ищет N мин». */
const minutesSince = (iso: string) => Math.max(1, Math.round((Date.now() - Date.parse(iso)) / 60_000));

/**
 * Истории на выбор: запас ПК с оценкой редактора (владелец 29.10: «да выбор нужен, это хорошо»). «Монтировать» ставит
 * ролик именно по этой истории, «Не то» убирает её — ПК учится на отказах, «Убрать» — просто убирает (тема устарела,
 * не сегодня), «Найти ещё» — ПК ищет, как освободится.
 */
/** Крипто-истории запаса (news/runner/pipeline/story.ts CRYPTO_LANES): два ролика из шести, смешной и новостной. */
const LANE_LABEL: Record<string, string> = { "crypto-fun": "Крипта · смешное", "crypto-news": "Крипта · новость" };

function StockSection({ stock, busy, picked, error, onPick, onReject, onDrop, onMore }: {
  stock: StockView;
  busy: string;
  picked: string;
  error: string;
  onPick: (p: NewsPick) => void;
  onReject: (p: NewsPick) => void;
  onDrop: (p: NewsPick) => void;
  onMore: () => void;
}) {
  const state = stock.searching ? (
    <span className={s.stockState} role="status">
      <span className="spin" aria-hidden="true" />
      ПК ищет истории · {minutesSince(stock.searching.startedAt)} мин
    </span>
  ) : stock.morePending ? (
    <span className={s.stockState} role="status">
      ПК начнёт искать, как только освободится
    </span>
  ) : (
    <button type="button" className="btn btn-secondary btn-sm" disabled={Boolean(busy)} onClick={onMore}>
      {busy === "more" && <span className="spin" aria-hidden="true" />}
      Найти ещё
    </button>
  );
  return (
    <section className={`card ${s.stock}`} aria-label="Истории на выбор">
      <div className={s.stockHead}>
        <h2 className={s.stockTitle}>Истории на выбор</h2>
        {state}
      </div>
      {picked && (
        <div className={s.created} role="status">
          «{picked}» — в очереди на монтаж, ролик появится во вкладке «Готовые»
        </div>
      )}
      {error && (
        <div className="error-box" role="alert">
          {error}
        </div>
      )}
      {stock.stories.length === 0 ? (
        <p className="hint">
          {stock.searching
            ? "ПК ищет громкие истории по нескольким направлениям, крипту тоже — первые появятся здесь минут через 10–15."
            : "Историй в запасе нет. Нажмите «Найти ещё» — ПК поищет, как только освободится."}
        </p>
      ) : (
        <ul className={s.picks}>
          {stock.stories.map((p) => (
            <li key={p.id} className={s.pick}>
              {p.lane && (
                <span className={s.lane} data-due={Boolean(p.due)} title={p.due ? "Два ролика из шести — про крипту: «Создать» возьмёт эту историю следующей" : "Два ролика из шести — про крипту"}>
                  {LANE_LABEL[p.lane] ?? "Крипта"}
                  {p.due && " · следующая по очереди"}
                </span>
              )}
              <div className={s.pickTop}>
                <span className={s.score} data-top={(p.score ?? 0) >= 9} title={p.score === null ? "Продолжение ролика с канала" : "Оценка редактора"}>
                  {p.score === null ? "ещё" : `${p.score}/10`}
                </span>
                <strong className={s.pickTitle}>{p.title}</strong>
              </div>
              <div className={s.pickMeta}>
                {[p.sequelOf ? `Продолжение «${p.sequelOf}»` : p.anchor ? `Знакомо всем: ${p.anchor}` : "", p.hero].filter(Boolean).join(" · ")}
                {p.sources[0] && (
                  <>
                    {" · "}
                    <a className="link-btn" href={p.sources[0]} target="_blank" rel="noreferrer">
                      источник
                    </a>
                  </>
                )}
              </div>
              {p.hook && <p className={s.pickHook}>«{p.hook}»</p>}
              <p className={s.pickText}>{p.summary}</p>
              {p.verdict && <p className={s.pickVerdict}>{p.verdict}</p>}
              {p.share && <p className={s.pickVerdict}>Перешлют: {p.share}</p>}
              <div className={s.pickActions}>
                <button type="button" className="btn btn-sm" disabled={Boolean(busy)} onClick={() => onPick(p)}>
                  {busy === p.id && <span className="spin" aria-hidden="true" />}
                  Монтировать
                </button>
                <button type="button" className="btn btn-ghost btn-sm" disabled={Boolean(busy)} onClick={() => onReject(p)} aria-label={`Не то: «${p.title}»`} title="Убрать, и ПК учтёт, что такие темы не нравятся">
                  Не то
                </button>
                <button type="button" className="btn btn-ghost btn-sm" disabled={Boolean(busy)} onClick={() => onDrop(p)} aria-label={`Убрать: «${p.title}»`} title="Просто убрать — тема устарела или не сегодня, ПК выводов не делает">
                  Убрать
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const TrashIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6" />
  </svg>
);

/**
 * Вкладка «Новости»: одна кнопка «Создать» — ПК сам находит вирусную историю и делает ролик, — и под ней все ролики.
 * Каждое нажатие ставит в очередь ещё один ролик, даже пока первый делается.
 */
export default function NewsPage() {
  const [data, setData] = useState<ListAnswer | null>(null);
  const [loadError, setLoadError] = useState<ApiError | null>(null);
  const [creating, setCreating] = useState(false);
  /** How many videos this visit queued: the note under the button counts them. */
  const [queued, setQueued] = useState(0);
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState("");
  /** A refused delete: its reason stands in that video's card, where the owner pressed. */
  const [rowError, setRowError] = useState<{ id: string; text: string } | null>(null);
  /** The story being sent (its id, or "more" for «Найти ещё»), the last one queued, and a refused action. */
  const [stockBusy, setStockBusy] = useState("");
  const [picked, setPicked] = useState("");
  const [stockError, setStockError] = useState("");
  const { confirm, modal } = useConfirm();
  /** The open section; it stays in the address (?tab=…), so a reload or the back button returns to it. */
  const [tab, setTab] = useState<Tab>("ready");
  useEffect(() => {
    const asked = new URLSearchParams(window.location.search).get("tab");
    if (isTab(asked)) setTab(asked);
  }, []);
  function goTab(next: Tab) {
    setTab(next);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", next);
    window.history.replaceState(null, "", url);
  }

  const load = useCallback(async () => {
    try {
      setData(await api<ListAnswer>("/api/news"));
      setLoadError(null);
    } catch (e) {
      setLoadError(e as ApiError);
    }
  }, []);

  useEffect(() => void load(), [load]);

  const list = data?.projects ?? null;
  const shown = list && tab !== "stock" ? list.filter((p) => tabOf(p) === tab) : null;
  if (shown && tab === "scheduled") shown.sort((a, b) => nextOut(a) - nextOut(b));
  const count = (t: Tab) => (list ? list.filter((p) => tabOf(p) === t).length : null);
  const counts: Record<Tab, number | null> = {
    published: count("published"),
    scheduled: count("scheduled"),
    rework: count("rework"),
    ready: count("ready"),
    stock: data?.stock ? data.stock.stories.length : null,
  };
  usePolling(Boolean(list?.some((p) => jobActive(p.job)) || data?.stock.searching || data?.stock.morePending), 3000, load);

  async function create() {
    if (creating) return;
    setCreating(true);
    setError("");
    try {
      await api<{ id: string }>("/api/news", { method: "POST" });
      setQueued((n) => n + 1);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCreating(false);
    }
  }

  /** Stock actions share one busy mark: a second press waits for the first answer. */
  async function stockAction(key: string, fn: () => Promise<void>) {
    if (stockBusy) return;
    setStockBusy(key);
    setStockError("");
    try {
      await fn();
    } catch (e) {
      setStockError((e as Error).message);
    } finally {
      setStockBusy("");
      await load();
    }
  }

  const pick = (p: NewsPick) =>
    stockAction(p.id, async () => {
      await api<{ id: string }>("/api/news", { method: "POST", json: { pick: p.id } });
      setPicked(p.title);
    });
  const reject = (p: NewsPick) => stockAction(p.id, () => api("/api/news/stock", { method: "POST", json: { reject: p.id } }).then(() => {}));
  const drop = (p: NewsPick) => stockAction(p.id, () => api("/api/news/stock", { method: "POST", json: { drop: p.id } }).then(() => {}));
  const more = () => stockAction("more", () => api("/api/news/stock", { method: "POST", json: { more: true } }).then(() => {}));

  async function remove(p: ProjectSummary) {
    const title = shownTitle(p.title, p.job);
    // the networks keep what they have: a YouTube schedule goes out too (only TikTok and Instagram sends block the delete)
    const text = p.published.some((m) => m.platform === "youtube" && m.state === "scheduled")
      ? "История и видео удалятся с сайта насовсем. Запланированный ролик в YouTube всё равно выйдет — отменить его можно в YouTube Studio."
      : p.published.some((m) => m.state === "published")
        ? "История и видео удалятся с сайта насовсем. В соцсетях ролик останется."
        : p.job?.state === "queued"
          ? "Ролик ещё в очереди — он не будет сделан и удалится насовсем."
          : "История и видео удалятся насовсем.";
    if (!(await confirm({ title: `Удалить «${title}»?`, text, action: "Удалить", danger: true }))) return;
    setDeleting(p.id);
    setRowError(null);
    try {
      await api(`/api/news/${p.id}`, { method: "DELETE" });
      setData((d) => (d ? { ...d, projects: d.projects.filter((x) => x.id !== p.id) } : d));
    } catch (e) {
      setRowError({ id: p.id, text: (e as Error).message });
    } finally {
      setDeleting("");
    }
  }

  /** «На доработку» и обратно: the row moves at once, a refusal puts it back with the reason in its card. */
  async function setRework(p: ProjectSummary, rework: boolean) {
    const flip = (value: boolean) => setData((d) => (d ? { ...d, projects: d.projects.map((x) => (x.id === p.id ? { ...x, rework: value } : x)) } : d));
    setRowError(null);
    flip(rework);
    try {
      await api(`/api/news/${p.id}`, { method: "PATCH", json: { rework } });
    } catch (e) {
      flip(!rework);
      setRowError({ id: p.id, text: (e as Error).message });
    }
  }

  return (
    <main className={s.page}>
      <div className={`page-head ${s.top}`}>
        <h1 className="page-title">Новости</h1>
        {loadError?.status !== 401 && (
          <button type="button" className={`btn ${s.createBtn}`} disabled={creating} onClick={() => void create()} title="ПК возьмёт лучшую историю из запаса или найдёт новую и смонтирует ролик">
            {creating && <span className="spin" aria-hidden="true" />}
            {creating ? "Ставим в очередь…" : "Создать"}
          </button>
        )}
      </div>

      {loadError?.status === 401 ? (
        <div className="warn-box" role="alert">
          Нужен вход на сайт.{" "}
          <a className="link-btn" href="/login?next=/news">
            Войти
          </a>
        </div>
      ) : (
        <>
          {/* владелец 11.11: «текст под создать не нужен» — кнопка стоит в шапке, здесь только то, что случилось */}
          {(queued > 0 || data?.runner.quiet || error) && (
            <div className={s.createNotes}>
              {queued > 0 && (
                <div className={s.created} role="status">
                  {queued > 1 ? `В очередь поставлено роликов: ${queued}` : "Ролик поставлен в очередь — появится во вкладке «Готовые»"}
                </div>
              )}
              {data?.runner.quiet && (
                <div className="warn-box" role="status">
                  ПК не забирает задачи{data.runner.seenAt ? ` — последний раз спрашивал ${formatDate(data.runner.seenAt)}` : ""}. Проверьте, что исполнитель «Новостей» запущен: ролики подождут в очереди.
                </div>
              )}
              {error && (
                <div className="error-box" role="alert">
                  {error}
                </div>
              )}
            </div>
          )}

          <nav className={`steps ${s.tabs}`} aria-label="Разделы">
            {TABS.map((t) => (
              <button key={t.id} type="button" className={`step ${tab === t.id ? "active" : ""}`} aria-current={tab === t.id ? "page" : undefined} onClick={() => goTab(t.id)}>
                <span className={`step-n ${s.tabCount}`} aria-hidden>
                  {counts[t.id] ?? "·"}
                </span>
                <span>{t.label}</span>
              </button>
            ))}
          </nav>

          {tab === "stock" && data?.stock && <StockSection stock={data.stock} busy={stockBusy} picked={picked} error={stockError} onPick={(p) => void pick(p)} onReject={(p) => void reject(p)} onDrop={(p) => void drop(p)} onMore={() => void more()} />}
          {tab === "stock" && !data && !loadError && <div className="skeleton" style={{ height: 96 }} />}

          {loadError && (
            <div className="error-box plain" role="alert">
              <strong>Не удалось загрузить ролики.</strong> {loadError.message}{" "}
              <button type="button" className="link-btn" onClick={() => void load()}>
                Повторить
              </button>
            </div>
          )}
          {tab !== "stock" && !shown && !loadError && <div className="skeleton" style={{ height: 96 }} />}
          {tab !== "stock" && shown && shown.length === 0 && <div className={s.empty}>{EMPTY[tab]}</div>}
          {tab !== "stock" && shown && shown.length > 0 && (
            <section className={s.list} aria-label={LIST_LABEL[tab]}>
              {shown.map((p) => {
                const title = shownTitle(p.title, p.job);
                return (
                  <div key={p.id} className={s.item}>
                    <Link href={`/news/${p.id}`} className={s.itemLink}>
                      <span className={s.thumb} aria-hidden="true">
                        {p.cover ? (
                          // the cover is a ready JPEG of the right shape: nothing for next/image to do
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={`/api/news/${p.id}/cover?v=${encodeURIComponent(p.cover.at)}`} alt="" loading="lazy" />
                        ) : p.video ? (
                          <video src={`/api/news/${p.id}/video?v=${encodeURIComponent(p.video.at)}#t=2`} preload="metadata" muted playsInline tabIndex={-1} />
                        ) : (
                          <span className={s.thumbMark}>NEWS</span>
                        )}
                      </span>
                      <span className={s.itemMain}>
                        <span className={s.itemTitle} data-pending={!p.title}>
                          {title}
                        </span>
                        <span className={s.itemMeta}>
                          <StatusChip status={statusOf(p)} />
                          <PublishedMarks marks={p.published} />
                          {p.note && (
                            <span className={s.lane} data-due="true">
                              {p.note}
                            </span>
                          )}
                          {p.hero && <span>{p.hero}</span>}
                          <span>Создан {formatWhen(p.createdAt)}</span>
                        </span>
                      </span>
                    </Link>
                    <button
                      type="button"
                      className={s.itemDelete}
                      aria-label={`Удалить «${title}»`}
                      title="Удалить"
                      disabled={Boolean(deleting) || (p.job?.state === "running" && !p.job.lost)}
                      onClick={() => void remove(p)}
                    >
                      {deleting === p.id ? <span className="spin" aria-hidden="true" /> : <TrashIcon />}
                    </button>
                    {(tab === "rework" || (tab === "ready" && p.video && !jobActive(p.job))) && (
                      <div className={s.itemActions}>
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => void setRework(p, tab !== "rework")}>
                          {tab === "rework" ? "Вернуть в готовые" : "На доработку"}
                        </button>
                      </div>
                    )}
                    {rowError?.id === p.id && (
                      <div className={`error-box ${s.itemError}`} role="alert">
                        {rowError.text}
                      </div>
                    )}
                  </div>
                );
              })}
            </section>
          )}
        </>
      )}
      {modal}
    </main>
  );
}
