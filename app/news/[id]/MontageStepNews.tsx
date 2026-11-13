"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { MUSIC_VOLUME } from "@/lib/news/types";
import { musicLabel, TASK_LABEL, trackLabel, type ProjectView, type Status, type TrackView } from "@/lib/news/rules";
import { formatDate, StatusChip } from "../ui";
import s from "../news.module.css";

/**
 * Этап «Монтаж» и общие куски этапов: панель задачи, история, музыка и превью ролика справа — как превью
 * основных проектов (глобальные preview-box и video-preview).
 */

type Job = NonNullable<ProjectView["job"]>;

const JOB_TITLE: Record<Job["task"], string> = {
  create: "Ищем историю и делаем ролик",
  rerender: "Перемонтируем ролик",
};

/** Что делает задача прямо сейчас: очередь, прогресс, ошибка или пропавший исполнитель. */
export function JobPanelNews({ job, disabled, onRetry, onCancel }: { job: Job; disabled: boolean; onRetry: () => void; onCancel: () => void }) {
  // a failed create starts over on the same video; a failed rerender is asked for again
  const retryLabel = job.task === "create" ? "Создать заново" : "Повторить";
  return (
    <section className={`card ${s.jobPanel}`} aria-live="polite">
      {job.lost ? (
        <div className="warn-box">
          <strong>ПК не отвечает больше 10 минут.</strong> Задача «{TASK_LABEL[job.task]}» остановилась на шаге «{job.step}». Её можно запустить заново.
          <div className="actions">
            <button type="button" className="btn btn-sm" disabled={disabled} onClick={onRetry}>
              {retryLabel}
            </button>
          </div>
        </div>
      ) : job.state === "error" ? (
        <div className="error-box">
          {job.task === "rerender" ? "Перемонтировать не удалось — ролик остался прежним. " : ""}
          {job.error || "Задача не удалась"}
          <div className="actions">
            <button type="button" className="btn btn-sm" disabled={disabled} onClick={onRetry}>
              {retryLabel}
            </button>
          </div>
        </div>
      ) : job.state === "queued" ? (
        <div className={s.jobRow}>
          <span className="spin" aria-hidden="true" />
          <span className={s.jobText}>{job.task === "rerender" ? "Перемонтаж в очереди — ждём ПК" : "В очереди — ждём ПК"}</span>
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

/**
 * Ролик без музыки и трек под ним — в браузере, двумя плеерами: трек идёт за роликом (пуск, пауза, перемотка,
 * громкость) на той же громкости, что сайт склеит в out.mp4, поэтому смена трека слышна сразу, без перемонтажа.
 * play меняется по нажатию на трек: ролик пускается, если стоял.
 */
function MixPlayer({ src, track, play }: { src: string; track: string | null; play: number }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    const audio = audioRef.current;
    if (!video || !audio) return;
    // кусок трека короче ролика идёт по кругу, как в склейке
    const at = () => (audio.duration > 0 ? video.currentTime % audio.duration : video.currentTime);
    const align = (always: boolean) => {
      if (!track || !(audio.readyState > 0)) return;
      if (always || Math.abs(audio.currentTime - at()) > 0.15) audio.currentTime = at();
    };
    const level = () => {
      audio.volume = Math.min(1, MUSIC_VOLUME * video.volume);
      audio.muted = video.muted;
      audio.playbackRate = video.playbackRate;
    };
    const start = () => {
      if (!track || video.paused) return;
      level();
      align(true);
      void audio.play().catch(() => {});
    };
    const stop = () => audio.pause();
    const seek = () => align(true);
    const tick = () => !video.paused && align(false);
    const on: [EventTarget, string, () => void][] = [
      [video, "playing", start],
      [video, "pause", stop],
      [video, "waiting", stop],
      [video, "ended", stop],
      [video, "seeked", seek],
      [video, "timeupdate", tick],
      [video, "volumechange", level],
      [video, "ratechange", level],
      [audio, "loadedmetadata", start],
    ];
    for (const [el, name, fn] of on) el.addEventListener(name, fn);
    level();
    if (track) start();
    else stop();
    return () => {
      for (const [el, name, fn] of on) el.removeEventListener(name, fn);
    };
  }, [track]);

  useEffect(() => {
    if (play && videoRef.current?.paused) void videoRef.current.play().catch(() => {});
  }, [play]);

  return (
    <>
      <video ref={videoRef} className={`video-preview ${s.preview}`} src={src} controls playsInline preload="metadata" />
      <audio ref={audioRef} src={track ?? undefined} preload="auto" loop />
    </>
  );
}

/** Где трек для плеера: подготовленный кусок на сайте; без него трек не играет. */
const trackSrc = (file: string | null, tracks: readonly TrackView[]) => {
  const t = file ? tracks.find((x) => x.file === file) : undefined;
  return t?.ready && t.sig ? `/api/news/track/${t.sig}` : null;
};

/**
 * Ролик справа. На «Монтаже» (mix) — ролик без музыки с выбранным треком в браузере, трек меняется сразу; на
 * «Публикации» — склеенный out.mp4, который уйдёт в соцсети. Ролик, смонтированный до этого, играет как есть.
 */
export function VideoPreviewNews({
  project,
  tracks,
  title,
  empty,
  mix,
}: {
  project: ProjectView;
  tracks: TrackView[];
  title: ReactNode;
  empty: string;
  mix?: { music: string | null; play: number };
}) {
  const video = project.video;
  // ?v= is the file's time: a new render (or, for out.mp4, another track) gives a new one, so the player loads it
  const src = video ? `/api/news/${project.id}/video?v=${encodeURIComponent(video.at)}` : "";
  const base = video?.base ? `/api/news/${project.id}/video?base=1&v=${encodeURIComponent(video.base.at)}` : "";
  const music = mix && base ? mix.music : (video?.music ?? null);
  return (
    <div className="preview-box">
      <div className="preview-title">{title}</div>
      {!video ? (
        <div className="preview-empty">{empty}</div>
      ) : mix && base ? (
        <MixPlayer key={base} src={base} track={trackSrc(mix.music, tracks)} play={mix.play} />
      ) : (
        <video key={video.at} className={`video-preview ${s.preview}`} src={src} controls playsInline preload="metadata" />
      )}
      {video && (
        <>
          <div className={s.videoMeta}>
            <span>
              {Math.round(video.duration)} с · {musicLabel(music, tracks)}
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

/** Host of a source link, for the list of sources: «tiktok.com». */
function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** Что нашёл ПК: заголовок, пересказ, герой, источники и весь текст озвучки. */
function StoryCard({ project, searching }: { project: ProjectView; searching: boolean }) {
  const story = project.story;
  return (
    <section className="card" aria-labelledby="story-title">
      <div className="card-head">
        <h2 id="story-title">История</h2>
      </div>
      {story ? (
        <>
          <h3 className={s.storyTitle}>{story.title}</h3>
          {story.hero && <div className={s.hero}>{story.hero}</div>}
          {story.summary && <p className={s.summary}>{story.summary}</p>}
          {story.sources.length > 0 && (
            <ul className={s.sources} aria-label="Источники">
              {story.sources.map((src, i) => (
                <li key={`${i}:${src.url}`}>
                  <a href={src.url} target="_blank" rel="noreferrer noopener">
                    {src.note || hostOf(src.url)}
                  </a>
                  {src.note && <span className={s.dim}> · {hostOf(src.url)}</span>}
                </li>
              ))}
            </ul>
          )}
          {story.script && (
            <details className={s.script}>
              <summary>Текст озвучки</summary>
              <p>{story.script}</p>
            </details>
          )}
        </>
      ) : searching ? (
        <div className={s.searching}>
          <span className="spin" aria-hidden="true" />
          Ищем историю…
        </div>
      ) : (
        <div className="state-box">История ещё не найдена.</div>
      )}
    </section>
  );
}

/**
 * Музыка под роликом: «Без музыки» и все треки из папки news/music на ПК. Нажатие на трек сразу пускает ролик с ним
 * в превью и делает его выбранным — сайт за секунду склеивает с ним ролик для публикации. Ролик, смонтированный до
 * мгновенной смены музыки, сначала один раз перемонтируется на ПК.
 */
function MusicCard({
  project,
  tracks,
  choice,
  saving,
  live,
  busy,
  onPick,
  onRerender,
}: {
  project: ProjectView;
  tracks: TrackView[];
  choice: string | null;
  saving: boolean;
  live: boolean;
  busy: boolean;
  onPick: (music: string | null) => void;
  onRerender: () => void;
}) {
  const video = project.video;
  const current = video?.music ?? null;
  const job = project.job;
  const rerendering = Boolean(job && job.task === "rerender" && live);
  const missing = current !== null && !tracks.some((t) => t.file === current);
  const options: { file: string | null; label: string; ready: boolean }[] = [
    { file: null, label: "Без музыки", ready: true },
    ...tracks.map((t) => ({ file: t.file, label: trackLabel(t), ready: t.ready })),
    ...(missing ? [{ file: current, label: `${musicLabel(current, tracks)} — на ПК его больше нет`, ready: false }] : []),
  ];

  return (
    <section className="card" aria-labelledby="music-title">
      <div className="card-head">
        <h2 id="music-title">Музыка</h2>
        {video?.base && <span className={s.dim}>{saving ? "Сохраняю…" : `В ролике: ${musicLabel(current, tracks)}`}</span>}
      </div>
      {!video ? (
        <p className={`hint ${s.lead}`}>Музыку можно будет выбрать, когда ролик будет готов.</p>
      ) : !video.base ? (
        <div className="state-box">
          Сейчас: <strong>{musicLabel(current, tracks)}</strong>. Этот ролик смонтирован до мгновенной смены музыки — один раз перемонтируйте его на
          ПК, дальше треки будут переключаться сразу.
          <div className="actions">
            <button type="button" className="btn btn-sm" disabled={live || busy} onClick={onRerender}>
              {rerendering && <span className="spin" aria-hidden="true" />}
              {rerendering ? "Перемонтируется…" : "Перемонтировать"}
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className={s.tracks} role="radiogroup" aria-label="Музыка под роликом">
            {options.map((o) => {
              const on = o.file === choice;
              return (
                <button
                  key={o.file ?? ""}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  className={`${s.track} ${on ? s.trackOn : ""}`}
                  disabled={!o.ready}
                  onClick={() => onPick(o.file)}
                >
                  <span className={s.trackDot} aria-hidden="true" />
                  <span className={s.trackName}>{o.label}</span>
                  {!o.ready && o.file !== current && <span className={s.dim}>идёт с ПК…</span>}
                </button>
              );
            })}
          </div>
          <div className={`hint ${s.musicNote}`}>
            {tracks.length === 0
              ? "Положите треки в папку news/music на ПК — список появится через несколько секунд."
              : "Нажмите трек — ролик справа сразу заиграет с ним. Выбранный трек уйдёт в публикацию."}
          </div>
        </>
      )}
    </section>
  );
}

/** Этап «Монтаж»: всё делает ПК; здесь видно, что он нашёл и сделал, и меняется музыка. */
export function MontageStepNews({
  project,
  tracks,
  previewStatus,
  live,
  busy,
  savingMusic,
  onMusic,
  onRerender,
  onPublish,
}: {
  project: ProjectView;
  tracks: TrackView[];
  previewStatus: Status;
  live: boolean;
  busy: boolean;
  savingMusic: boolean;
  onMusic: (music: string | null) => void;
  onRerender: () => void;
  onPublish: () => void;
}) {
  const job = project.job;
  const searching = Boolean(job && job.task === "create" && live);
  // what plays in the preview: the last pick at once; once saving is over, what the server has (a refused pick goes back)
  const saved = project.video?.music ?? null;
  const [choice, setChoice] = useState(saved);
  const [play, setPlay] = useState(0);
  useEffect(() => {
    if (!savingMusic) setChoice(saved);
  }, [saved, savingMusic]);
  const pick = (music: string | null) => {
    setChoice(music);
    setPlay((n) => n + 1);
    onMusic(music);
  };
  return (
    <div className="workspace">
      <div className={s.stack}>
        <StoryCard project={project} searching={searching} />
        <MusicCard project={project} tracks={tracks} choice={choice} saving={savingMusic} live={live} busy={busy} onPick={pick} onRerender={onRerender} />
        {project.video && (
          <div className="actions">
            <button type="button" className="btn" onClick={onPublish}>
              К публикации
            </button>
          </div>
        )}
      </div>

      <div className="preview-col">
        <VideoPreviewNews
          project={project}
          tracks={tracks}
          title={<StatusChip status={previewStatus} />}
          empty={live ? "Ролик появится, когда ПК его смонтирует" : "Здесь появится ролик"}
          mix={{ music: choice, play }}
        />
      </div>
    </div>
  );
}
