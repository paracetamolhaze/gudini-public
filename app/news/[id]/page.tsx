"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { jobActive, shownTitle, statusOf, storyNote, type ProjectView, type Status, type TrackView } from "@/lib/news/rules";
import { api, ApiError, StatusChip, usePolling, useConfirm } from "../ui";
import { PublishPanelNews } from "./PublishPanelNews";
import { JobPanelNews, MontageStepNews, VideoPreviewNews } from "./MontageStepNews";
import s from "../news.module.css";

/**
 * Ролик «Новостей» по этапам, как скетч «3Д»: «Монтаж · Публикация», на экране один этап. Монтаж делает ПК сам —
 * здесь видно, что он нашёл и сделал, и меняется музыка; публикация — как у «3Д», через скрытое зеркало.
 */

/** What GET /api/news/<id> and the music route answer: the project plus the music list from the PC. */
type Loaded = ProjectView & { tracks?: TrackView[] };
type Busy = "" | "recreate" | "rerender" | "cancel" | "delete";

const STEPS = ["Монтаж", "Публикация"] as const;
type Step = 0 | 1;

/** Этап при открытии: готовый ролик ведёт к публикации, остальное — к монтажу. */
const firstStep = (p: ProjectView): Step => (p.video ? 1 : 0);

export default function NewsProjectPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [project, setProject] = useState<ProjectView | null>(null);
  const [tracks, setTracks] = useState<TrackView[]>([]);
  const [savingMusic, setSavingMusic] = useState(false);
  const [loadError, setLoadError] = useState<ApiError | null>(null);
  const [step, setStep] = useState<Step | null>(null);
  const [busy, setBusy] = useState<Busy>("");
  const [error, setError] = useState("");
  const stepsNav = useRef<HTMLElement>(null);
  const { confirm, modal } = useConfirm();

  /** Numbers the loads: an answer older than the last load or our own action is dropped, not applied. */
  const seq = useRef(0);

  const apply = useCallback((next: Loaded, own = false) => {
    if (own) seq.current++;
    const { tracks: list, ...view } = next;
    if (list) setTracks(list);
    setProject(view);
    setStep((current) => current ?? firstStep(view));
  }, []);

  const load = useCallback(async () => {
    const mine = ++seq.current;
    try {
      const next = await api<Loaded>(`/api/news/${id}`);
      if (mine !== seq.current) return;
      apply(next);
      setLoadError(null);
    } catch (e) {
      if (mine === seq.current) setLoadError(e as ApiError);
    }
  }, [id, apply]);

  useEffect(() => void load(), [load]);

  const job = project?.job ?? null;
  usePolling(jobActive(job), 2000, load);

  const live = Boolean(job && jobActive(job) && !job.lost);

  // ошибка одного этапа не тянется на следующий
  const goStep = (next: Step) => {
    setError("");
    setStep(next);
    stepsNav.current?.scrollIntoView({ block: "nearest" });
  };

  async function act(kind: Busy, fn: () => Promise<void>) {
    if (busy) return;
    setBusy(kind);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
      // the server may know better (a job started elsewhere, a project deleted)
      void load();
    } finally {
      setBusy("");
    }
  }

  const recreate = () => act("recreate", async () => apply(await api<Loaded>(`/api/news/${id}/run`, { method: "POST" }), true));

  const rerender = () => act("rerender", async () => apply(await api<Loaded>(`/api/news/${id}/run`, { method: "POST", json: { task: "rerender" } }), true));

  /**
   * A track pick is saved at once (the site mixes out.mp4 in a second or two) and never blocks the page: picks made
   * while one is saved wait, and only the last of them goes next.
   */
  const wantedMusic = useRef<{ music: string | null } | null>(null);
  const savingRef = useRef(false);
  async function saveMusic(music: string | null) {
    wantedMusic.current = { music };
    if (savingRef.current) return;
    savingRef.current = true;
    setSavingMusic(true);
    setError("");
    try {
      for (let next: { music: string | null } | null = wantedMusic.current; next; next = wantedMusic.current) {
        wantedMusic.current = null;
        apply(await api<Loaded>(`/api/news/${id}/music`, { method: "POST", json: { music: next.music } }), true);
      }
    } catch (e) {
      wantedMusic.current = null;
      setError((e as Error).message);
      void load();
    } finally {
      savingRef.current = false;
      setSavingMusic(false);
    }
  }

  /** A failed or lost create starts over on this video; a failed rerender is asked for again. */
  const retry = () => (job?.task === "rerender" ? rerender() : recreate());

  const cancel = () => act("cancel", async () => apply(await api<Loaded>(`/api/news/${id}/run`, { method: "DELETE" }), true));

  async function remove() {
    if (!(await confirm({ title: "Удалить ролик?", text: "История и видео удалятся с сайта насовсем. Опубликованное останется в соцсетях.", action: "Удалить", danger: true }))) return;
    await act("delete", async () => {
      await api(`/api/news/${id}`, { method: "DELETE" });
      router.push("/news");
    });
  }

  if (loadError && !project) {
    return (
      <main className={`${s.page} ${s.wide}`}>
        <Link href="/news" className="back-link">
          ← Все новости
        </Link>
        {loadError.status === 401 ? (
          <div className="warn-box" role="alert">
            Нужен вход на сайт.{" "}
            <a className="link-btn" href={`/login?next=/news/${id}`}>
              Войти
            </a>
          </div>
        ) : (
          <div className="error-box plain" role="alert">
            <strong>{loadError.status === 404 || loadError.status === 400 ? "Ролик не найден." : "Не удалось загрузить ролик."}</strong> {loadError.status === 404 || loadError.status === 400 ? "" : loadError.message}{" "}
            {loadError.status !== 404 && loadError.status !== 400 && (
              <button type="button" className="link-btn" onClick={() => void load()}>
                Повторить
              </button>
            )}
          </div>
        )}
      </main>
    );
  }
  if (!project || step === null) {
    return (
      <main className={`${s.page} ${s.wide}`}>
        <Link href="/news" className="back-link">
          ← Все новости
        </Link>
        <div className="skeleton" style={{ height: 320 }} />
      </main>
    );
  }

  const video = project.video;
  const status = statusOf({ job, video, title: project.story?.title ?? null });
  // галочка — сделанная работа этапа: готовый ролик
  const stepsDone = [Boolean(video), false];
  const making = Boolean(job && job.task === "create" && live);
  const rerendering = Boolean(job && job.task === "rerender" && live);
  const previewStatus: Status = live && job?.state === "queued"
    ? { text: "Ждёт ПК", tone: "neutral", busy: true }
    : making
    ? { text: "Монтируется", tone: "accent", busy: true }
    : rerendering
      ? { text: "Перемонтируется", tone: "accent", busy: true }
      : video
        ? { text: "Видео готово", tone: "success", busy: false }
        : { text: "Ещё не смонтировано", tone: "neutral", busy: false };

  return (
    <main className={`${s.page} ${s.wide}`}>
      <Link href="/news" className="back-link">
        ← Все новости
      </Link>
      <div className={s.head}>
        <h1 className="page-title">{shownTitle(project.story?.title, job)}</h1>
        <StatusChip status={status} />
        {storyNote(project.story) && (
          <span className={s.lane} data-due="true">
            {storyNote(project.story)}
          </span>
        )}
        <button type="button" className={`btn btn-ghost btn-sm ${s.remove}`} disabled={Boolean(busy) || (live && job?.state === "running")} onClick={() => void remove()}>
          {busy === "delete" && <span className="spin" aria-hidden="true" />}
          Удалить ролик
        </button>
      </div>

      <nav ref={stepsNav} className={`steps ${s.steps}`} aria-label="Этапы ролика">
        {STEPS.map((label, i) => (
          <button
            key={label}
            type="button"
            className={`step ${step === i ? "active" : ""} ${stepsDone[i] ? "done" : ""}`}
            aria-current={step === i ? "step" : undefined}
            onClick={() => goStep(i as Step)}
          >
            <span className="step-n" aria-hidden>
              {stepsDone[i] && step !== i ? "✓" : i + 1}
            </span>
            <span>{label}</span>
          </button>
        ))}
      </nav>

      {job && job.state !== "done" && <JobPanelNews job={job} disabled={Boolean(busy)} onRetry={() => void retry()} onCancel={() => void cancel()} />}

      {error && (
        <div className="error-box" role="alert">
          {error}
        </div>
      )}

      {step === 0 && (
        <MontageStepNews
          project={project}
          tracks={tracks}
          previewStatus={previewStatus}
          live={live}
          busy={Boolean(busy)}
          savingMusic={savingMusic}
          onMusic={(music) => void saveMusic(music)}
          onRerender={() => void rerender()}
          onPublish={() => goStep(1)}
        />
      )}

      {step === 1 &&
        (video ? (
          <div className="workspace">
            <PublishPanelNews project={project} onChange={load} />
            <div className="preview-col">
              <VideoPreviewNews project={project} tracks={tracks} title={<StatusChip status={{ text: "Для публикации", tone: "accent", busy: false }} />} empty="" />
            </div>
          </div>
        ) : (
          <section className="card">
            <h2>Публикация</h2>
            <div className="state-box">
              Ролик ещё не готов: публиковать пока нечего.
              <div className="actions">
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => goStep(0)}>
                  К монтажу
                </button>
              </div>
            </div>
          </section>
        ))}
      {modal}
    </main>
  );
}
