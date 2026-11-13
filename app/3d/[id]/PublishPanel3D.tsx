"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { ProjectView, Status, StatusTone } from "@/lib/studio3d/rules";
import type { Meta3D } from "@/lib/studio3d/types";
import type { PublishView } from "@/lib/studio3d/publish";
import { api, AutoTextarea, formatDate, StatusChip, usePolling } from "../ui";
import s from "./publish3d.module.css";

/**
 * Publishing of a 3D video: the cover, the caption and one row per network — the same choices as the main
 * videos' publishing step (now, drafts, schedule, trial Reel, cancel). The sending itself is the main code's,
 * through the hidden mirror project (lib/studio3d/publish.ts).
 */

type Platform = "tiktok" | "youtube" | "instagram";
type Publication = PublishView["publications"][number];

const NETWORKS: { key: Platform; name: string }[] = [
  { key: "tiktok", name: "TikTok" },
  { key: "youtube", name: "YouTube Shorts" },
  { key: "instagram", name: "Instagram Reels" },
];

/** Waiting for a worker, a schedule or the owner's check: no second send meanwhile. */
const PENDING = ["queued", "running", "needs_login", "unknown", "scheduled"];
/** States that change by themselves: the panel polls while one of them is shown. */
const MOVING = ["queued", "running", "needs_login", "scheduled"];
const CANCELLABLE = ["queued", "needs_login", "scheduled"];
/** Reached the network with this video: "publish everywhere" does not send it there again. */
const DELIVERED = ["published", "draft"];

// the same limits as lib/studio3d/meta.ts and cover.ts (server modules, not importable here)
const TITLE_MAX = 100;
const DESCRIPTION_MAX = 2000;
const HEADLINE_MAX = 60;

const status = (text: string, tone: StatusTone, busy = false): Status => ({ text, tone, busy });

/** The publication in words, as on the main publishing step: success, draft, demo, skip and error differ. */
function publicationStatus(pub: Publication): Status {
  switch (pub.status) {
    case "draft":
      return status("В черновиках", "accent");
    case "scheduled":
      return status("Запланировано", "accent");
    case "queued":
      return status("В очереди", "accent", true);
    case "running":
      return status("Публикуется", "accent", true);
    case "needs_login":
      return status("Нужен вход в TikTok", "error");
    case "unknown":
      return status("Нужно проверить результат", "error");
    case "cancelled":
      return status("Отменено", "neutral");
    case "published":
      if (pub.instagramTrial) return status("Опубликован пробный Reel", "success");
      return /черновик|private/i.test(pub.message ?? "") ? status("Черновик", "accent") : status("Опубликовано", "success");
    case "demo":
      return status("Демо-режим", "neutral");
    case "skipped":
      return status("Пропущено", "neutral");
    case "error":
      return status("Ошибка", "error");
    default:
      return status(pub.status, "neutral");
  }
}

/** datetime-local wants the local time without a zone. */
function localInput(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function PublishPanel3D({ project, onChange }: { project: ProjectView; onChange: () => void | Promise<void> }) {
  const id = project.id;
  const [view, setView] = useState<PublishView | null>(null);
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  /** The network a request is on the way to (one at a time, also during "publish everywhere"). */
  const [sending, setSending] = useState<Platform | null>(null);
  /** Each card shows its own failure next to the button that caused it. */
  const [errors, setErrors] = useState<Partial<Record<"cover" | "meta" | "publish", string>>>({});
  const setError = (area: "cover" | "meta" | "publish", text: string) => setErrors((x) => ({ ...x, [area]: text }));
  const [platformErrors, setPlatformErrors] = useState<Partial<Record<Platform, string>>>({});
  const [notes, setNotes] = useState<string[]>([]);
  const [trial, setTrial] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState<Platform | null>(null);
  const [scheduleAt, setScheduleAt] = useState<Partial<Record<Platform, string>>>({});
  const [headlineOpen, setHeadlineOpen] = useState(false);
  const [headline, setHeadline] = useState("");

  const load = useCallback(async () => {
    try {
      setView(await api<PublishView>(`/api/3d/${id}/publish`));
      setLoadError("");
    } catch (e) {
      setLoadError(message(e));
    }
  }, [id]);

  // a new montage, cover or caption on the page: the panel follows
  const metaKey = JSON.stringify(project.meta ?? null);
  useEffect(() => {
    void load();
  }, [load, project.video?.at, project.cover?.at, metaKey]);

  const preparing = Boolean(view?.preparing);
  const coverWorking = busy === "cover" || Boolean(view?.coverBusy);
  const waitPrep = preparing || coverWorking;
  const polled = Boolean(view && (view.preparing || view.coverBusy || view.publications.some((p) => MOVING.includes(p.status))));
  usePolling(polled, 3000, load);

  // the cover and caption made in the background after the montage: the page reloads the project when they land
  const wasPreparing = useRef(false);
  useEffect(() => {
    const now = Boolean(view?.preparing || view?.coverBusy);
    if (wasPreparing.current && view && !now) void onChange();
    wasPreparing.current = now;
  }, [view, onChange]);

  // ---- caption: saved on leaving a field; what is typed while a save is on the way is not lost

  const serverMeta: Meta3D | null = view ? view.meta : (project.meta ?? null);
  const serverMetaKey = JSON.stringify(serverMeta);
  const [title, setTitle] = useState(serverMeta?.title ?? "");
  const [description, setDescription] = useState(serverMeta?.description ?? "");
  const [tags, setTags] = useState((serverMeta?.hashtags ?? []).join(" "));
  const [metaState, setMetaState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const edits = useRef(0);
  const savedEdits = useRef(0);
  const edit = (set: (v: string) => void) => (v: string) => {
    edits.current++;
    set(v);
    setMetaState("idle");
  };

  useEffect(() => {
    if (edits.current !== savedEdits.current) return;
    const m = JSON.parse(serverMetaKey) as Meta3D | null;
    setTitle(m?.title ?? "");
    setDescription(m?.description ?? "");
    setTags((m?.hashtags ?? []).join(" "));
  }, [serverMetaKey]);

  async function saveMeta(): Promise<boolean> {
    if (edits.current === savedEdits.current) return true;
    const mark = edits.current;
    setMetaState("saving");
    try {
      const next = await api<ProjectView>(`/api/3d/${id}/meta`, { method: "PUT", json: { title, description, hashtags: tags } });
      savedEdits.current = mark;
      setMetaState("saved");
      // the fields take the server's cleaned version (tags with #) through the effect above
      setView((v) => (v ? { ...v, meta: next.meta ?? null } : v));
      void onChange();
      return true;
    } catch (e) {
      setMetaState("error");
      setError("meta", message(e));
      return false;
    }
  }

  async function regenMeta() {
    setBusy("meta");
    setError("meta", "");
    try {
      const next = await api<ProjectView>(`/api/3d/${id}/meta`, { method: "POST" });
      savedEdits.current = edits.current;
      setTitle(next.meta?.title ?? "");
      setDescription(next.meta?.description ?? "");
      setTags((next.meta?.hashtags ?? []).join(" "));
      setMetaState("saved");
      setView((v) => (v ? { ...v, meta: next.meta ?? null } : v));
      void onChange();
    } catch (e) {
      setError("meta", message(e));
    } finally {
      setBusy(null);
    }
  }

  // ---- cover

  async function newCover(withHeadline?: string) {
    setBusy("cover");
    setError("cover", "");
    try {
      await api<ProjectView>(`/api/3d/${id}/cover`, { method: "POST", json: withHeadline ? { headline: withHeadline } : {} });
      setHeadlineOpen(false);
    } catch (e) {
      setError("cover", message(e));
    } finally {
      setBusy(null);
      await load();
      void onChange();
    }
  }

  // ---- publishing

  /** One request; the caller handles busy. Returns the publication, or null after showing the error. */
  async function send(platform: Platform, extra: { mode?: "draft"; scheduledAt?: string } = {}): Promise<{ publication: Publication; view: PublishView } | null> {
    setSending(platform);
    setPlatformErrors((x) => ({ ...x, [platform]: "" }));
    try {
      const r = await api<{ publication: Publication; view: PublishView }>(`/api/3d/${id}/publish`, {
        method: "POST",
        json: { platform, ...(platform === "instagram" && !extra.mode ? { instagramTrial: trial } : {}), ...extra },
      });
      setView(r.view);
      return r;
    } catch (e) {
      setPlatformErrors((x) => ({ ...x, [platform]: message(e) }));
      return null;
    } finally {
      setSending(null);
    }
  }

  async function publishTo(platform: Platform, extra: { mode?: "draft"; scheduledAt?: string } = {}) {
    setBusy(platform);
    setError("publish", "");
    setNotes([]);
    try {
      if (await saveMeta()) await send(platform, extra);
    } finally {
      setBusy(null);
    }
  }

  /** Every connected network in turn, skipping the ones that wait for something or already have this video. */
  async function publishAll() {
    if (!view) return;
    setBusy("all");
    setError("publish", "");
    setPlatformErrors({});
    const out: string[] = [];
    setNotes(out);
    try {
      if (!(await saveMeta())) return;
      let current = view;
      for (const { key, name } of NETWORKS) {
        const pub = current.publications.find((p) => p.platform === key);
        if (!current.connected[key]) out.push(`${name}: не подключён — пропущен`);
        else if (pub && PENDING.includes(pub.status)) out.push(`${name}: уже ждёт отправки или проверки — пропущен`);
        else if (pub && DELIVERED.includes(pub.status) && !current.stale.includes(key)) out.push(`${name}: этот ролик уже там — пропущен`);
        else if (key === "tiktok" && current.tiktok.direct) out.push(`${name}: прямой публикации нужен экран выбора видимости — пропущен`);
        else {
          const r = await send(key);
          if (r) {
            current = r.view;
            const text = publicationStatus(r.publication).text;
            out.push(`${name}: ${text.toLowerCase()}${r.publication.message ? ` — ${r.publication.message}` : ""}`);
          } else out.push(`${name}: не отправлено — причина в строке площадки`);
        }
        setNotes([...out]);
      }
    } finally {
      setBusy(null);
    }
  }

  function saveSchedule(platform: Platform) {
    const time = new Date(scheduleAt[platform] ?? "").getTime();
    if (!Number.isFinite(time) || time < Date.now() + 120_000) {
      setError("publish", "Выберите время минимум через 2 минуты.");
      return;
    }
    setScheduleOpen(null);
    void publishTo(platform, { scheduledAt: new Date(time).toISOString() });
  }

  async function cancel(platform: Platform) {
    setBusy(`cancel-${platform}`);
    setError("publish", "");
    try {
      const r = await api<{ view: PublishView }>(`/api/3d/${id}/publish`, { method: "DELETE", json: { platform } });
      setView(r.view);
    } catch (e) {
      setError("publish", message(e));
    } finally {
      setBusy(null);
    }
  }

  if (!project.video) return null;

  const cover = view ? view.cover : (project.cover ?? null);
  const coverChip: Status = coverWorking
    ? status("Рисуется", "accent", true)
    : preparing && !cover
      ? status("Скоро будет", "accent", true)
      : cover?.status === "ok"
        ? status("Готова", "success")
        : cover?.status === "headline_failed"
          ? status("Слабый заголовок", "warn")
          : cover?.status === "failed"
            ? status("Не получилась", "error")
            : status("Нет обложки", "neutral");
  const metaChip: Status | null =
    metaState === "saving"
      ? status("Сохраняем", "accent", true)
      : metaState === "saved"
        ? status("Сохранено", "success")
        : metaState === "error"
          ? status("Не сохранено", "error")
          : !serverMeta && preparing
            ? status("Пишется", "accent", true)
            : null;
  const anyConnected = Boolean(view && NETWORKS.some((n) => view.connected[n.key]));
  const staleNames = NETWORKS.filter((n) => view?.stale.includes(n.key)).map((n) => n.name);

  return (
    <div className={s.panel}>
      <section className="card" aria-labelledby="pub3d-cover">
        <div className={s.head}>
          <h2 id="pub3d-cover">Обложка</h2>
          <StatusChip status={coverChip} />
        </div>
        <div className={s.cover}>
          {cover?.status === "ok" ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img className={s.coverImg} src={`/api/3d/${id}/cover?v=${encodeURIComponent(cover.at)}`} alt="Обложка ролика" />
          ) : (
            <div className={s.coverEmpty}>{waitPrep ? "Рисуется…" : "Нет обложки"}</div>
          )}
          <div className={s.coverInfo}>
            {cover?.headline && <div className={s.headline}>«{cover.headline}»</div>}
            {cover?.status === "ok" && cover.videoAt && cover.videoAt !== project.video.at && <div className={s.warn}>Сделана по прошлой версии ролика</div>}
            <div className={s.buttons}>
              <button type="button" className="btn btn-secondary btn-sm" disabled={busy !== null || waitPrep} onClick={() => void newCover()}>
                {busy === "cover" ? <span className="spin" aria-label="Рисуется" /> : cover ? "Создать заново" : "Создать"}
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                aria-expanded={headlineOpen}
                disabled={busy !== null || waitPrep}
                onClick={() => {
                  setHeadline(cover?.headline ?? "");
                  setHeadlineOpen((o) => !o);
                }}
              >
                Изменить заголовок
              </button>
            </div>
          </div>
        </div>
        {/* во всю ширину карточки: ответ генератора бывает длинным, полностью — в подсказке */}
        {cover && cover.status !== "ok" && cover.reason && (
          <div className={`${s.dim} ${s.reason}`} title={cover.reason}>
            {cover.reason}
          </div>
        )}
        {headlineOpen && (
          <form
            className={s.headlineForm}
            onSubmit={(e) => {
              e.preventDefault();
              if (headline.trim()) void newCover(headline.trim());
            }}
          >
            <label className="field">
              <span>Заголовок обложки</span>
              <input type="text" value={headline} maxLength={HEADLINE_MAX} autoFocus onChange={(e) => setHeadline(e.target.value)} />
            </label>
            <div className={s.buttons}>
              <button type="submit" className="btn btn-sm" disabled={!headline.trim() || busy !== null || waitPrep}>
                Нарисовать с этим заголовком
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setHeadlineOpen(false)}>
                Отмена
              </button>
            </div>
          </form>
        )}
        {errors.cover && (
          <div className="error-box" role="alert" style={{ marginTop: 12 }}>
            {errors.cover}
          </div>
        )}
        <p className={`${s.dim} ${s.note}`}>Кадр ролика, перерисованный нейросетью. Каждое нажатие — платная картинка; неудачная прежнюю не стирает.</p>
      </section>

      <section className="card" aria-labelledby="pub3d-meta">
        <div className={s.head}>
          <h2 id="pub3d-meta">Описание</h2>
          {metaChip && <StatusChip status={metaChip} />}
        </div>
        <div className={s.fields}>
          <label className="field">
            <span className={s.label}>
              Заголовок
              <span className={`${s.counter} ${title.length >= TITLE_MAX ? s.over : ""}`}>
                {title.length}/{TITLE_MAX}
              </span>
            </span>
            <input type="text" value={title} maxLength={TITLE_MAX} onChange={(e) => edit(setTitle)(e.target.value)} onBlur={() => void saveMeta()} />
          </label>
          <label className="field">
            <span className={s.label}>
              Описание
              <span className={`${s.counter} ${description.length > DESCRIPTION_MAX ? s.over : ""}`}>
                {description.length}/{DESCRIPTION_MAX}
              </span>
            </span>
            <AutoTextarea rows={3} value={description} onChange={(e) => edit(setDescription)(e.target.value)} onBlur={() => void saveMeta()} />
          </label>
          <label className="field">
            <span>Хэштеги</span>
            <input type="text" value={tags} placeholder="#крипта #биткоин" onChange={(e) => edit(setTags)(e.target.value)} onBlur={() => void saveMeta()} />
          </label>
        </div>
        <div className={s.buttons} style={{ marginTop: 12 }}>
          <button type="button" className="btn btn-secondary btn-sm" disabled={busy !== null || (!serverMeta && preparing)} onClick={() => void regenMeta()}>
            {busy === "meta" ? <span className="spin" aria-label="Пишем" /> : serverMeta ? "Другой вариант описания" : "Создать описание"}
          </button>
        </div>
        {errors.meta && (
          <div className="error-box" role="alert" style={{ marginTop: 12 }}>
            {errors.meta}
          </div>
        )}
      </section>

      <section className="card" aria-labelledby="pub3d-networks">
        <div className={s.head}>
          <h2 id="pub3d-networks">Публикация</h2>
        </div>
        {loadError && !view && (
          <div className="error-box" role="alert" style={{ marginBottom: 12 }}>
            {loadError}{" "}
            <button type="button" className="link-btn" onClick={() => void load()}>
              Повторить
            </button>
          </div>
        )}
        {errors.publish && (
          <div className="error-box" role="alert" style={{ marginBottom: 12 }}>
            {errors.publish}
          </div>
        )}
        {staleNames.length > 0 && (
          <div className="warn-box" style={{ marginBottom: 12 }}>
            Новый монтаж ещё не опубликован: {staleNames.join(", ")} — там прошлая версия ролика.
          </div>
        )}
        {waitPrep && <p className="hint">Обложка и описание ещё создаются — отправка подождёт их.</p>}

        <div className={s.platforms}>
          {NETWORKS.map(({ key, name }) => {
            const pub = view?.publications.find((p) => p.platform === key);
            const connected = view?.connected[key] ?? false;
            const pending = PENDING.includes(pub?.status ?? "");
            const blocked = busy !== null || pending || waitPrep;
            const direct = key === "tiktok" && Boolean(view?.tiktok.direct);
            const failure = platformErrors[key];
            // одна плашка на площадку: что с роликом там, а без подключения — «Не подключён»
            const chip =
              view === null
                ? status("Проверяем", "neutral", true)
                : sending === key
                  ? status("Отправляем", "accent", true)
                  : failure
                    ? status("Ошибка отправки", "error")
                    : pub
                      ? publicationStatus(pub)
                      : connected
                        ? status("Ещё не отправлено", "neutral")
                        : status("Не подключён", "neutral");
            return (
              <div className={s.platform} key={key}>
                <div className={s.platformHead}>
                  <span className={s.platformName}>{name}</span>
                  <StatusChip status={chip} />
                </div>
                {(connected || pub) && (
                  <div className={s.result}>
                    <span className={s.dim}>{connected ? view?.accounts[key] : "Не подключён"}</span>
                    {pub && !failure && sending !== key && <span className={s.dim}>· {formatDate(pub.at)}</span>}
                    {pub?.url && !failure && (
                      <a href={pub.url} target="_blank" rel="noreferrer" className="link-btn">
                        Открыть
                      </a>
                    )}
                  </div>
                )}
                {failure ? <div className={s.dim}>{failure}</div> : pub?.message ? <div className={s.dim}>{pub.message}</div> : null}
                {view?.stale.includes(key) && <div className={s.warn}>Здесь прошлая версия ролика — новую сюда ещё не отправляли.</div>}

                {connected ? (
                  <>
                    {key === "instagram" && (
                      <>
                        <label className={s.check}>
                          <input type="checkbox" checked={trial} disabled={busy !== null || pending} onChange={(e) => setTrial(e.target.checked)} />
                          Пробный Reel
                        </label>
                        {trial && <div className={s.dim}>Сначала показывается неподписчикам; поделиться со всеми — вручную в Instagram. Работает и по расписанию.</div>}
                      </>
                    )}
                    <div className={s.buttons}>
                      <button
                        type="button"
                        className="btn btn-sm"
                        disabled={blocked || direct}
                        title={direct ? "Прямой публикации TikTok нужен экран выбора видимости — сохраните черновик" : undefined}
                        onClick={() => void publishTo(key)}
                      >
                        {busy === key ? <span className="spin" aria-label="Отправляем" /> : key === "instagram" && trial ? "Опубликовать пробный Reel" : "Опубликовать"}
                      </button>
                      {key !== "instagram" && (
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          disabled={blocked}
                          title={key === "youtube" ? "Загрузить приватное видео в YouTube Studio" : "Сохранить черновик в TikTok Studio"}
                          onClick={() => void publishTo(key, { mode: "draft" })}
                        >
                          В черновики
                        </button>
                      )}
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        aria-expanded={scheduleOpen === key}
                        disabled={blocked || (key === "tiktok" && !view?.tiktok.browser)}
                        onClick={() => {
                          setScheduleAt((v) => ({ ...v, [key]: v[key] || localInput(new Date(Date.now() + 60 * 60_000)) }));
                          setScheduleOpen((o) => (o === key ? null : key));
                        }}
                      >
                        Запланировать
                      </button>
                      {key !== "youtube" && CANCELLABLE.includes(pub?.status ?? "") && (
                        <button type="button" className="btn btn-ghost btn-sm" disabled={busy !== null} onClick={() => void cancel(key)}>
                          {busy === `cancel-${key}` ? <span className="spin" aria-label="Отменяем" /> : "Отменить"}
                        </button>
                      )}
                      {pub?.status === "unknown" && (
                        <Link href="/settings" className="link-btn">
                          Проверить результат
                        </Link>
                      )}
                    </div>
                    {key === "instagram" && <div className={s.dim}>Черновики в Instagram недоступны через текущее подключение.</div>}
                    {scheduleOpen === key && (
                      <div className={s.schedule}>
                        <label className={s.dim}>
                          Дата и время · {Intl.DateTimeFormat().resolvedOptions().timeZone}
                          <input
                            type="datetime-local"
                            aria-label={`Время публикации ${name}`}
                            value={scheduleAt[key] ?? ""}
                            min={localInput(new Date(Date.now() + 3 * 60_000))}
                            onChange={(e) => setScheduleAt((v) => ({ ...v, [key]: e.target.value }))}
                          />
                        </label>
                        <div className={s.buttons}>
                          <button type="button" className="btn btn-sm" disabled={busy !== null || !scheduleAt[key]} onClick={() => saveSchedule(key)}>
                            Сохранить расписание
                          </button>
                        </div>
                        <div className={s.dim}>
                          {key === "youtube" ? "Ролик загрузится сейчас, YouTube опубликует его в указанное время." : "Для отправки в указанное время сервер должен работать."}
                        </div>
                      </div>
                    )}
                  </>
                ) : view ? (
                  <div className={s.buttons}>
                    <Link href="/settings" className="btn btn-secondary btn-sm">
                      Подключить
                    </Link>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>

        <div className={s.all}>
          <button type="button" className="btn btn-secondary btn-block" disabled={busy !== null || !anyConnected || waitPrep} onClick={() => void publishAll()}>
            {busy === "all" ? <span className="spin" aria-label="Отправляем" /> : "Опубликовать во все подключённые"}
          </button>
          {notes.length > 0 && (
            <ul className={s.notes} role="status">
              {notes.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          )}
          {view && !anyConnected && <p className="hint">Ни один аккаунт не подключён. Подключите площадки в «Настройках».</p>}
        </div>
      </section>
    </div>
  );
}
