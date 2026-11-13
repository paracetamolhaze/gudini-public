"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import type { Script3D } from "@/lib/studio3d/types";
import {
  checkScript,
  cleanText,
  dubProgress,
  jobActive,
  montageWarning,
  overVideoLines,
  projectTitle,
  sameScript,
  scriptChars,
  statusOf,
  voiceOverProgress,
  type ProjectView,
  type Status,
} from "@/lib/studio3d/rules";
import { api, ApiError, StatusChip, usePolling, useConfirm } from "../ui";
import { PublishPanel3D } from "./PublishPanel3D";
import { ScriptStep3D, type Line } from "./ScriptStep3D";
import { JobPanel3D, MontageStep3D, VideoPreview3D } from "./MontageStep3D";
import s from "../studio3d.module.css";

/**
 * Скетч «3Д» по этапам, как основной проект: «Сценарий · Монтаж · Публикация», на экране один этап.
 * Состояние и действия — здесь, этапы только показывают их: черновик сценария переживает переход между этапами.
 */

type Draft = { title: string; lines: Line[] };
type Busy = "" | "save" | "script" | "voice" | "montage" | "dub" | "own" | "cancel" | "delete";

const STEPS = ["Сценарий", "Монтаж", "Публикация"] as const;
type Step = 0 | 1 | 2;

/** Этап при открытии: готовый ролик ведёт к публикации, начатый монтаж — к монтажу, остальное — к сценарию. */
const firstStep = (p: ProjectView): Step => (p.video ? 2 : p.job && p.job.task !== "script" && p.job.state !== "done" ? 1 : 0);

const EMPTY: Script3D = { title: "", lines: [] };

/** What the server would store from this draft: the same cleanup, so stray spaces are not "edits". */
const fromDraft = (d: Draft): Script3D => ({ title: cleanText(d.title), lines: d.lines.map((l) => ({ who: l.who, text: cleanText(l.text) })) });

export default function Studio3DProjectPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [project, setProject] = useState<ProjectView | null>(null);
  const [loadError, setLoadError] = useState<ApiError | null>(null);
  const [step, setStep] = useState<Step | null>(null);
  const [topic, setTopic] = useState("");
  const [draft, setDraft] = useState<Draft>({ title: "", lines: [] });
  const [busy, setBusy] = useState<Busy>("");
  const [error, setError] = useState("");
  const keys = useRef(0);
  const stepsNav = useRef<HTMLElement>(null);
  const { confirm, modal } = useConfirm();

  const toDraft = useCallback((sc: Script3D | null): Draft => ({ title: sc?.title ?? "", lines: (sc?.lines ?? []).map((l) => ({ key: ++keys.current, who: l.who, text: l.text })) }), []);

  // the latest values for load(), which polling calls from a stale closure
  const state = useRef({ project, topic, draft });
  state.current = { project, topic, draft };

  /** Numbers the loads: an answer older than the last load or our own save/run is dropped, not applied. */
  const seq = useRef(0);

  /** Takes the server's project; local edits survive unless `reset` (after our own save or run). */
  const apply = useCallback(
    (next: ProjectView, reset = false) => {
      if (reset) seq.current++;
      const { project: prev, topic: t, draft: d } = state.current;
      const scriptEdited = prev ? !sameScript(fromDraft(d), prev.script ?? EMPTY) : false;
      if (reset || !prev || (!scriptEdited && next.scriptVersion !== prev.scriptVersion)) setDraft(toDraft(next.script));
      if (reset || !prev || t.trim() === prev.topic) setTopic(next.topic);
      setProject(next);
      setStep((current) => current ?? firstStep(next));
    },
    [toDraft],
  );

  const load = useCallback(async () => {
    const mine = ++seq.current;
    try {
      const next = await api<ProjectView>(`/api/3d/${id}`);
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
  const clean = fromDraft(draft);
  const scriptDirty = Boolean(project) && !sameScript(clean, project?.script ?? EMPTY);
  const topicDirty = Boolean(project) && topic.trim() !== project?.topic;
  const dirty = scriptDirty || topicDirty;
  const problems = scriptDirty ? checkScript(clean, 1).problems : [];
  const total = scriptChars(clean.lines);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  // ошибка одного этапа не тянется на следующий; из низа длинного сценария новый этап открывается с начала
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

  /** Sends only what changed; with `withScript` false the script draft is left out. */
  async function saveChanges(withScript = true) {
    const body: Record<string, unknown> = {};
    if (topicDirty) body.topic = topic;
    if (withScript && scriptDirty) body.script = clean;
    if (Object.keys(body).length) apply(await api<ProjectView>(`/api/3d/${id}`, { method: "PATCH", json: body }), true);
  }

  async function run(task: "script" | "voice" | "montage" | "dub") {
    apply(await api<ProjectView>(`/api/3d/${id}/run`, { method: "POST", json: { task } }), true);
  }

  async function rewrite() {
    if (scriptDirty && !(await confirm({ title: "Переписать сценарий?", text: "Несохранённые правки сценария пропадут: Клод напишет новый по идее.", action: "Переписать" }))) return;
    await act("script", async () => {
      // идея — то, по чему Клод пишет: её правки сохраняем
      await saveChanges(false);
      await run("script");
    });
  }

  async function montage() {
    // a new montage makes new timing: his dubbed video and his takes over it would be gone without a word
    const warning = project ? montageWarning(project) : null;
    if (warning && !(await confirm({ title: "Смонтировать заново?", text: warning, action: "Смонтировать", danger: true }))) return;
    await act("montage", async () => {
      await saveChanges();
      await run("montage");
    });
  }

  const prepareCues = () => act("voice", () => run("voice"));

  /** «Собрать с моим голосом»: the saved video and script as they are, so unsaved edits stay in the editor. */
  const assemble = () =>
    act("dub", async () => {
      const next = await api<ProjectView>(`/api/3d/${id}/run`, { method: "POST", json: { task: "dub" } });
      seq.current++; // an older poll answer must not bring the old job back
      apply(next);
    });

  const retry = () => (job?.task === "montage" ? montage() : job?.task === "voice" ? prepareCues() : job?.task === "dub" ? assemble() : rewrite());

  /** «Мой голос»: only this flag is sent, so unsaved script edits stay in the editor. */
  const setOwnVoice = (on: boolean) =>
    act("own", async () => {
      const next = await api<ProjectView>(`/api/3d/${id}`, { method: "PATCH", json: { ownVoice: on } });
      seq.current++; // an older poll answer must not bring the old flag back
      apply(next);
    });

  /**
   * The dubbing page plays the finished video: saving a script edit now would make that video outdated, so
   * unsaved edits are left behind (after asking) instead of saved.
   */
  async function openVoice() {
    if (dirty && !(await confirm({ title: "Перейти к озвучке?", text: "Озвучка идёт поверх готового ролика. Несохранённые правки пропадут.", action: "Перейти" }))) return;
    router.push(`/3d/${id}/voice`);
  }

  const saveAndNext = () =>
    act("save", async () => {
      await saveChanges();
      goStep(1);
    });

  const cancel = () =>
    act("cancel", async () => {
      apply(await api<ProjectView>(`/api/3d/${id}/run`, { method: "DELETE" }), true);
    });

  async function remove() {
    if (!(await confirm({ title: "Удалить скетч?", text: "Сценарий и видео удалятся насовсем.", action: "Удалить", danger: true }))) return;
    await act("delete", async () => {
      await api(`/api/3d/${id}`, { method: "DELETE" });
      router.push("/3d");
    });
  }

  const setLine = (key: number, change: Partial<Line>) => setDraft((d) => ({ ...d, lines: d.lines.map((l) => (l.key === key ? { ...l, ...change } : l)) }));
  const moveLine = (i: number, by: -1 | 1) =>
    setDraft((d) => {
      const lines = [...d.lines];
      const j = i + by;
      if (j < 0 || j >= lines.length) return d;
      [lines[i], lines[j]] = [lines[j], lines[i]];
      return { ...d, lines };
    });
  const deleteLine = (key: number) => setDraft((d) => ({ ...d, lines: d.lines.filter((l) => l.key !== key) }));
  const addLine = () =>
    setDraft((d) => {
      // реплики чередуются: новая — за того, кто молчал последним
      const last = d.lines[d.lines.length - 1]?.who;
      return { ...d, lines: [...d.lines, { key: ++keys.current, who: last === "me" ? "claude" : "me", text: "" }] };
    });

  if (loadError && !project) {
    return (
      <main className={`${s.page} ${s.wide}`}>
        <Link href="/3d" className="back-link">
          ← Все 3Д
        </Link>
        {loadError.status === 401 ? (
          <div className="warn-box" role="alert">
            Нужен вход на сайт.{" "}
            <a className="link-btn" href={`/login?next=/3d/${id}`}>
              Войти
            </a>
          </div>
        ) : (
          <div className="error-box plain" role="alert">
            <strong>{loadError.status === 404 || loadError.status === 400 ? "Скетч не найден." : "Не удалось загрузить скетч."}</strong> {loadError.status === 404 || loadError.status === 400 ? "" : loadError.message}{" "}
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
        <Link href="/3d" className="back-link">
          ← Все 3Д
        </Link>
        <div className="skeleton" style={{ height: 320 }} />
      </main>
    );
  }

  const status = statusOf({ job, lines: project.script?.lines.length ?? 0, video: project.video, topic: project.topic });
  const video = project.video;
  const writing = Boolean(job && job.task === "script" && jobActive(job) && !job.lost);
  // counted on the draft: the montage saves it first, and the server checks the saved one the same way
  const dubbed = dubProgress(clean, project.dub);
  const ownVoice = project.ownVoice === true;
  const ownMissing = ownVoice && dubbed.missing.length > 0;
  // takes dubbed over the video go only into «Собрать с моим голосом» (the server refuses them for this montage too)
  const ownOver = ownVoice ? overVideoLines(clean, project.dub) : [];
  const scriptReady = clean.lines.length >= 2 && !problems.length;
  const canMontage = !live && !busy && scriptReady && !ownMissing && !ownOver.length;
  // dubbing over the video works with what is saved: the video and the script it was made from
  const over = voiceOverProgress(project);
  const canAssemble = !live && !busy && !over.problem;
  const overHint = !video
    ? "Озвучить самому можно поверх готового ролика — сначала смонтируйте его."
    : over.problem && (over.recorded > 0 || !over.missing.length)
      ? `Собрать пока нельзя: ${over.problem}.`
      : "";

  // галочка — сделанная работа этапа: сохранённый диалог, готовый ролик
  const stepsDone = [Boolean(project.script && project.script.lines.length >= 2), Boolean(video), false];

  const saveStatus: Status | null =
    busy === "save" ? { text: "Сохраняем", tone: "accent", busy: true } : dirty ? { text: "Не сохранено", tone: "warn", busy: false } : project.script ? { text: "Сохранено", tone: "success", busy: false } : null;
  const montaging = Boolean(job && job.task === "montage" && live);
  const assembling = Boolean(job && job.task === "dub" && live);
  const previewStatus: Status = montaging
    ? { text: "Монтируется", tone: "accent", busy: true }
    : assembling
      ? { text: "Собирается с твоим голосом", tone: "accent", busy: true }
    : video && video.scriptVersion !== project.scriptVersion
      ? { text: "Прошлая версия сценария", tone: "warn", busy: false }
      : video
        ? { text: "Видео готово", tone: "success", busy: false }
        : { text: "Ещё не смонтировано", tone: "neutral", busy: false };

  return (
    <main className={`${s.page} ${s.wide}`}>
      <Link href="/3d" className="back-link">
        ← Все 3Д
      </Link>
      <div className={s.head}>
        <h1 className="page-title">{projectTitle(project)}</h1>
        <StatusChip status={status} />
        <button type="button" className={`btn btn-ghost btn-sm ${s.remove}`} disabled={Boolean(busy) || (live && job?.state === "running")} onClick={() => void remove()}>
          {busy === "delete" && <span className="spin" aria-hidden="true" />}
          Удалить скетч
        </button>
      </div>

      <nav ref={stepsNav} className={`steps ${s.steps}`} aria-label="Этапы скетча">
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

      {job && job.state !== "done" && <JobPanel3D job={job} disabled={Boolean(busy)} onRetry={() => void retry()} onCancel={() => void cancel()} />}

      {error && (
        <div className="error-box" role="alert">
          {error}
        </div>
      )}

      {step === 0 && (
        <ScriptStep3D
          topic={topic}
          onTopic={setTopic}
          lines={draft.lines}
          onLine={setLine}
          onMove={moveLine}
          onDelete={deleteLine}
          onAdd={addLine}
          locked={live}
          busy={Boolean(busy)}
          writing={writing}
          hasScript={Boolean(project.script)}
          saveStatus={saveStatus}
          problems={problems}
          total={total}
          onRewrite={() => void rewrite()}
          onSaveNext={() => void saveAndNext()}
          saving={busy === "save"}
          rewriting={busy === "script"}
        />
      )}

      {step === 1 && (
        <MontageStep3D
          project={project}
          previewStatus={previewStatus}
          scriptReady={scriptReady}
          scriptDirty={dirty}
          live={live}
          busy={Boolean(busy)}
          canMontage={canMontage}
          montaging={busy === "montage"}
          ownVoice={ownVoice}
          dubbed={dubbed}
          ownMissing={ownMissing}
          ownOver={ownOver}
          over={over}
          canAssemble={canAssemble}
          overHint={overHint}
          assembling={busy === "dub"}
          onOwnVoice={(on) => void setOwnVoice(on)}
          onOpenVoice={() => void openVoice()}
          onAssemble={() => void assemble()}
          onMontage={() => void montage()}
          onScript={() => goStep(0)}
          onPublish={() => goStep(2)}
        />
      )}

      {step === 2 &&
        (video ? (
          <div className="workspace">
            <PublishPanel3D project={project} onChange={load} />
            <div className="preview-col">
              <VideoPreview3D project={project} title={<StatusChip status={{ text: "Для публикации", tone: "accent", busy: false }} />} empty="" />
            </div>
          </div>
        ) : (
          <section className="card">
            <h2>Публикация</h2>
            <div className="state-box">
              Сначала смонтируйте ролик: публиковать пока нечего.
              <div className="actions">
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => goStep(1)}>
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
