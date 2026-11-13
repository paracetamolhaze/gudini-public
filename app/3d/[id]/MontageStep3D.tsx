"use client";

import type { ReactNode } from "react";
import { lineNumbers, TASK_LABEL, type ProjectView, type Status, type VoiceOverProgress } from "@/lib/studio3d/rules";
import { formatDate, StatusChip } from "../ui";
import s from "../studio3d.module.css";
import dub from "../dub.module.css";

/**
 * Этап «Монтаж» и общие куски этапов: панель задачи 3Д и превью ролика справа — как превью основных
 * проектов (глобальные preview-box и video-preview).
 */

type Job = NonNullable<ProjectView["job"]>;

const JOB_TITLE: Record<Job["task"], string> = {
  script: "Клод пишет сценарий",
  voice: "Озвучка реплик по одной",
  montage: "Озвучка и монтаж",
  dub: "Сборка с твоим голосом",
};

/** Что делает задача 3Д прямо сейчас: очередь, прогресс, ошибка или пропавший исполнитель. */
export function JobPanel3D({ job, disabled, onRetry, onCancel }: { job: Job; disabled: boolean; onRetry: () => void; onCancel: () => void }) {
  return (
    <section className={`card ${s.jobPanel}`} aria-live="polite">
      {job.lost ? (
        <div className="warn-box">
          <strong>Контейнер 3Д не отвечает больше 10 минут.</strong> Задача «{TASK_LABEL[job.task]}» остановилась на шаге «{job.step}». Её можно запустить заново.
          <div className="actions">
            <button type="button" className="btn btn-sm" disabled={disabled} onClick={onRetry}>
              Повторить
            </button>
          </div>
        </div>
      ) : job.state === "error" ? (
        <div className="error-box">
          {job.error || "Задача не удалась"}
          <div className="actions">
            <button type="button" className="btn btn-sm" disabled={disabled} onClick={onRetry}>
              Повторить
            </button>
          </div>
        </div>
      ) : job.state === "queued" ? (
        <div className={s.jobRow}>
          <span className="spin" aria-hidden="true" />
          <span className={s.jobText}>В очереди</span>
          <button type="button" className="btn btn-secondary btn-sm" disabled={disabled} onClick={onCancel}>
            Отменить
          </button>
        </div>
      ) : (
        <>
          <div className={s.jobRow}>
            <strong className={s.jobText}>{JOB_TITLE[job.task]}</strong>
            <span className={s.percent}>{job.progress}%</span>
          </div>
          <div className="progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={job.progress} aria-label="Готовность задачи">
            <div className="progress-fill" style={{ width: `${Math.max(2, job.progress)}%` }} />
          </div>
          <div className="hint">{job.step}</div>
        </>
      )}
    </section>
  );
}

/** Ролик справа на этапах «Монтаж» и «Публикация»: с длительностью, датой и скачиванием. */
export function VideoPreview3D({ project, title, empty }: { project: ProjectView; title: ReactNode; empty: string }) {
  const video = project.video;
  const src = video ? `/api/3d/${project.id}/video?v=${encodeURIComponent(video.at)}` : "";
  return (
    <div className="preview-box">
      <div className="preview-title">{title}</div>
      {video ? <video key={video.at} className={`video-preview ${s.preview}`} src={src} controls playsInline preload="metadata" /> : <div className="preview-empty">{empty}</div>}
      {video && (
        <>
          <div className={s.videoMeta}>
            <span>
              {Math.round(video.duration)} с{video.ownVoice ? " · мой голос" : ""}
            </span>
            <span>{formatDate(video.at)}</span>
          </div>
          <a className="btn btn-secondary btn-sm btn-block" href={`${src}&download=1`} download>
            Скачать
          </a>
        </>
      )}
    </div>
  );
}

/**
 * Монтаж и свой голос. Ролик монтируется с ИИ-голосами; свой голос владелец добавляет поверх готового ролика
 * («Озвучить самому», страница /voice) и собирает ролик с ним (задача "dub"). Старый переключатель — записи без
 * ролика для каждого монтажа — виден, только пока он включён, чтобы его можно было выключить.
 */
export function MontageStep3D({
  project,
  previewStatus,
  scriptReady,
  scriptDirty,
  live,
  busy,
  canMontage,
  montaging,
  ownVoice,
  dubbed,
  ownMissing,
  ownOver,
  over,
  canAssemble,
  overHint,
  assembling,
  onOwnVoice,
  onOpenVoice,
  onAssemble,
  onMontage,
  onScript,
  onPublish,
}: {
  project: ProjectView;
  previewStatus: Status;
  /** Хотя бы две реплики и ни одной ошибки в черновике. */
  scriptReady: boolean;
  scriptDirty: boolean;
  live: boolean;
  busy: boolean;
  canMontage: boolean;
  montaging: boolean;
  ownVoice: boolean;
  dubbed: { total: number; recorded: number; missing: number[] };
  ownMissing: boolean;
  /** Реплики, записанные поверх ролика: они идут только в «Собрать с моим голосом». */
  ownOver: number[];
  over: VoiceOverProgress;
  canAssemble: boolean;
  overHint: string;
  assembling: boolean;
  onOwnVoice: (on: boolean) => void;
  onOpenVoice: () => void;
  onAssemble: () => void;
  onMontage: () => void;
  onScript: () => void;
  onPublish: () => void;
}) {
  const video = project.video;
  const montageLabel = ownVoice ? "Смонтировать с моим голосом" : "Озвучить и смонтировать";
  const montageHint = ownMissing || ownOver.length ? "own-missing" : undefined;
  return (
    <div className="workspace">
      <section className="card" aria-labelledby="montage-title">
        <div className="card-head">
          <h2 id="montage-title">Монтаж</h2>
        </div>
        <p className={`hint ${s.lead}`}>Клод озвучит реплики голосами героев, поставит сцены в комнате и смонтирует ролик с субтитрами. Страницу можно закрыть: монтаж идёт без неё.</p>

        {!scriptReady && (
          <div className="state-box">
            Сценарий не готов: нужны хотя бы две реплики без ошибок.
            <div className="actions">
              <button type="button" className="btn btn-secondary btn-sm" onClick={onScript}>
                К сценарию
              </button>
            </div>
          </div>
        )}
        {scriptReady && scriptDirty && <div className="state-box">В сценарии есть несохранённые правки — монтаж сначала сохранит их.</div>}
        {video && video.scriptVersion !== project.scriptVersion && <div className="warn-box">Сценарий изменён после монтажа: в ролике прошлая версия. Смонтируйте заново.</div>}
        {video?.ownVoice && video.dubVersion !== undefined && video.dubVersion !== project.dub?.version && <div className="warn-box">Записи твоих реплик изменены после монтажа.</div>}

        {over.total > 0 && (
          <>
            <h3 className={s.dialogTitle}>Свой голос</h3>
            <p className={`hint ${s.lead}`}>Озвучь свои реплики поверх готового ролика, потом собери ролик с твоим голосом — сцены и Клод останутся как есть.</p>
            <div className={dub.ownRow}>
              <button type="button" className="btn btn-secondary btn-sm" disabled={!video || busy} onClick={onOpenVoice}>
                Озвучить самому
              </button>
              <span className={dub.ownCount}>
                озвучено {over.recorded} из {over.total}
              </span>
              <button type="button" className={`btn btn-sm ${dub.assemble}`} disabled={!canAssemble} onClick={onAssemble} aria-describedby={overHint ? "own-hint" : undefined}>
                {assembling && <span className="spin" aria-hidden="true" />}
                Собрать с моим голосом
              </button>
            </div>
            {overHint && (
              <div id="own-hint" className={`hint ${dub.ownHint}`}>
                {overHint}
              </div>
            )}
          </>
        )}

        {/* the old way (takes recorded without the video, used by every montage) — only to switch it off */}
        {ownVoice && (
          <>
            <div className={dub.ownRow}>
              <label className={dub.switch}>
                <input type="checkbox" role="switch" checked={ownVoice} disabled={live || busy} onChange={(e) => onOwnVoice(e.target.checked)} />
                <span className={dub.track} aria-hidden="true" />
                Монтаж с моими записями
              </label>
              <span className={dub.ownCount}>
                записано {dubbed.recorded} из {dubbed.total}
              </span>
            </div>
            {ownMissing ? (
              <div id="own-missing" className={`hint ${dub.ownHint}`}>
                Для монтажа с записями {dubbed.missing.length > 1 ? "не записаны реплики" : "не записана реплика"} {lineNumbers(dubbed.missing)}. Выключите переключатель — ролик соберётся с синтезом, а свой голос
                добавите через «Озвучить самому».
              </div>
            ) : (
              ownOver.length > 0 && (
                <div id="own-missing" className={`hint ${dub.ownHint}`}>
                  {ownOver.length > 1 ? "Реплики" : "Реплика"} {lineNumbers(ownOver)} {ownOver.length > 1 ? "записаны" : "записана"} поверх ролика — такие записи идут только в «Собрать с моим голосом».
                  Выключите переключатель: ролик смонтируется с синтезом, а свой голос соберёте кнопкой выше.
                </div>
              )
            )}
          </>
        )}

        <div className="actions">
          {video && !live ? (
            <>
              <button type="button" className="btn" onClick={onPublish}>
                К публикации
              </button>
              <button type="button" className="btn btn-secondary" disabled={!canMontage} onClick={onMontage} aria-describedby={montageHint}>
                {montaging && <span className="spin" aria-hidden="true" />}
                Смонтировать заново
              </button>
            </>
          ) : (
            <button type="button" className="btn" disabled={!canMontage} onClick={onMontage} aria-describedby={montageHint}>
              {montaging && <span className="spin" aria-hidden="true" />}
              {montageLabel}
            </button>
          )}
        </div>
      </section>

      <div className="preview-col">
        <VideoPreview3D project={project} title={<StatusChip status={previewStatus} />} empty={live ? "Ролик появится после монтажа" : "Здесь появится ролик"} />
      </div>
    </div>
  );
}
