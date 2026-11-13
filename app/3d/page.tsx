"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { jobActive, statusOf, type ProjectSummary, type PublishedMark } from "@/lib/studio3d/rules";
import { api, ApiError, formatDate, StatusChip, usePolling, useConfirm } from "./ui";
import s from "./studio3d.module.css";

const NETWORK: Record<PublishedMark["platform"], string> = { tiktok: "TikTok", youtube: "YouTube", instagram: "Instagram" };
const STATE_LABEL: Record<PublishedMark["state"], string> = { published: "Опубликовано", scheduled: "Запланировано", sending: "Публикуется", login: "Нужен вход" };

/** «Опубликовано: TikTok, YouTube» — one line per state, in the order of STATE_LABEL. */
function PublishedMarks({ marks }: { marks: PublishedMark[] }) {
  return (Object.keys(STATE_LABEL) as PublishedMark["state"][]).map((state) => {
    const nets = marks.filter((m) => m.state === state).map((m) => (m.trial ? `${NETWORK[m.platform]} (пробный)` : NETWORK[m.platform]));
    return nets.length ? (
      <span key={state} className={s.posted} data-state={state}>
        {STATE_LABEL[state]}: {nets.join(", ")}
      </span>
    ) : null;
  });
}

const TrashIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6" />
  </svg>
);

/**
 * Вкладка «3Д»: одна кнопка «Создать видео» — ПК сам выбирает идею из трендов, пишет сценарий и монтирует, — и под ней
 * все скетчи. Каждое нажатие ставит в очередь ещё один ролик, даже пока первый делается.
 */
export default function Studio3DPage() {
  const [list, setList] = useState<ProjectSummary[] | null>(null);
  const [loadError, setLoadError] = useState<ApiError | null>(null);
  const [creating, setCreating] = useState(false);
  const [queued, setQueued] = useState(0);
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState("");
  /** A refused delete: its reason stands in that sketch's card, where the owner pressed. */
  const [rowError, setRowError] = useState<{ id: string; text: string } | null>(null);
  const { confirm, modal } = useConfirm();

  const load = useCallback(async () => {
    try {
      setList((await api<{ projects: ProjectSummary[] }>("/api/3d")).projects);
      setLoadError(null);
    } catch (e) {
      setLoadError(e as ApiError);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  usePolling(Boolean(list?.some((p) => jobActive(p.job))), 3000, load);

  async function create() {
    if (creating) return;
    setCreating(true);
    setError("");
    try {
      await api<{ id: string }>("/api/3d", { method: "POST", json: { auto: true } });
      setQueued((n) => n + 1);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCreating(false);
    }
  }

  async function remove(p: ProjectSummary) {
    // the networks keep what they have: a YouTube schedule goes out too (only TikTok and Instagram sends block the delete)
    const text = p.published.some((m) => m.platform === "youtube" && m.state === "scheduled")
      ? "Сценарий и видео удалятся с сайта насовсем. Запланированный ролик в YouTube всё равно выйдет — отменить его можно в YouTube Studio."
      : p.published.some((m) => m.state === "published")
        ? "Сценарий и видео удалятся с сайта насовсем. В соцсетях ролик останется."
        : "Сценарий и видео удалятся насовсем.";
    if (!(await confirm({ title: `Удалить «${p.title}»?`, text, action: "Удалить", danger: true }))) return;
    setDeleting(p.id);
    setRowError(null);
    try {
      await api(`/api/3d/${p.id}`, { method: "DELETE" });
      setList((l) => l?.filter((x) => x.id !== p.id) ?? l);
    } catch (e) {
      setRowError({ id: p.id, text: (e as Error).message });
    } finally {
      setDeleting("");
    }
  }

  return (
    <main className={s.page}>
      <div className="page-head">
        <h1 className="page-title">3Д</h1>
      </div>

      {loadError?.status === 401 ? (
        <div className="warn-box" role="alert">
          Нужен вход на сайт.{" "}
          <a className="link-btn" href="/login?next=/3d">
            Войти
          </a>
        </div>
      ) : (
        <>
          <section className={`card ${s.create}`} aria-label="Новый ролик">
            <button type="button" className={`btn ${s.createBtn}`} disabled={creating} onClick={() => void create()}>
              {creating && <span className="spin" aria-hidden="true" />}
              {creating ? "Ставим в очередь…" : "Создать видео"}
            </button>
            {queued > 0 && (
              <div className={s.created} role="status">
                {queued > 1 ? `В очередь поставлено роликов: ${queued}` : "Ролик поставлен в очередь"}
              </div>
            )}
            {error && (
              <div className="error-box" role="alert">
                {error}
              </div>
            )}
          </section>

          {loadError && (
            <div className="error-box plain" role="alert">
              <strong>Не удалось загрузить скетчи.</strong> {loadError.message}{" "}
              <button type="button" className="link-btn" onClick={() => void load()}>
                Повторить
              </button>
            </div>
          )}
          {!list && !loadError && <div className="skeleton" style={{ height: 96 }} />}
          {list && list.length > 0 && (
            <section className={s.list} aria-label="Скетчи">
              {list.map((p) => (
                <div key={p.id} className={s.item}>
                  <Link href={`/3d/${p.id}`} className={s.itemLink}>
                    <span className={s.thumb} aria-hidden="true">
                      {p.cover ? (
                        // the cover is a ready JPEG of the right shape: nothing for next/image to do
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={`/api/3d/${p.id}/cover?v=${encodeURIComponent(p.cover.at)}`} alt="" loading="lazy" />
                      ) : p.video ? (
                        <video src={`/api/3d/${p.id}/video?v=${encodeURIComponent(p.video.at)}#t=0.1`} preload="metadata" muted playsInline tabIndex={-1} />
                      ) : (
                        <span className={s.thumbMark}>3Д</span>
                      )}
                    </span>
                    <span className={s.itemMain}>
                      <span className={s.itemTitle}>{p.title}</span>
                      <span className={s.itemMeta}>
                        <StatusChip status={statusOf(p)} />
                        <PublishedMarks marks={p.published} />
                        <span>{formatDate(p.updatedAt)}</span>
                        {p.video?.ownVoice ? (
                          <span>мой голос</span>
                        ) : (
                          p.dub?.total > 0 &&
                          (p.dubbed ?? 0) > 0 && (
                            <span>
                              озвучено {p.dubbed} из {p.dub.total}
                            </span>
                          )
                        )}
                      </span>
                    </span>
                  </Link>
                  <button
                    type="button"
                    className={s.itemDelete}
                    aria-label={`Удалить «${p.title}»`}
                    title="Удалить"
                    disabled={Boolean(deleting) || (p.job?.state === "running" && !p.job.lost)}
                    onClick={() => void remove(p)}
                  >
                    {deleting === p.id ? <span className="spin" aria-hidden="true" /> : <TrashIcon />}
                  </button>
                  {rowError?.id === p.id && (
                    <div className={`error-box ${s.itemError}`} role="alert">
                      {rowError.text}
                    </div>
                  )}
                </div>
              ))}
            </section>
          )}
        </>
      )}
      {modal}
    </main>
  );
}
