"use client";

import { CAST_IDS, MAX_LINE_CHARS, MAX_LINES, MAX_SCRIPT_CHARS, type CastId } from "@/lib/studio3d/types";
import { CAST_LABEL, cleanText, TOPIC_MAX, type Status } from "@/lib/studio3d/rules";
import { AutoTextarea, StatusChip } from "../ui";
import s from "../studio3d.module.css";

/**
 * Этап «Сценарий»: идея ролика и диалог по репликам. Черновик живёт на странице, а не здесь: при переходе
 * между этапами правки не теряются, а монтаж сохраняет их перед запуском.
 */

export type Line = { key: number; who: CastId; text: string };

/** Реплика переходит к другому герою: в скетче их двое. */
const otherCast = (who: CastId): CastId => CAST_IDS[(CAST_IDS.indexOf(who) + 1) % CAST_IDS.length];

/** Стрелки как SVG: символы ↑↓ телефоны рисуют цветными эмодзи. */
const Icon = ({ d }: { d: string }) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
);

export function ScriptStep3D({
  topic,
  onTopic,
  lines,
  onLine,
  onMove,
  onDelete,
  onAdd,
  locked,
  busy,
  writing,
  hasScript,
  saveStatus,
  problems,
  total,
  onRewrite,
  onSaveNext,
  saving,
  rewriting,
}: {
  topic: string;
  onTopic: (v: string) => void;
  lines: Line[];
  onLine: (key: number, change: Partial<Line>) => void;
  onMove: (index: number, by: -1 | 1) => void;
  onDelete: (key: number) => void;
  onAdd: () => void;
  /** Идёт задача 3Д: сценарий не правится, пока её не закончат или не отменят. */
  locked: boolean;
  busy: boolean;
  writing: boolean;
  hasScript: boolean;
  saveStatus: Status | null;
  problems: string[];
  total: number;
  onRewrite: () => void;
  onSaveNext: () => void;
  saving: boolean;
  rewriting: boolean;
}) {
  return (
    <section className="card" aria-labelledby="script-title">
      <div className="card-head">
        <h2 id="script-title">Сценарий</h2>
        <span className="spacer" />
        {saveStatus && <StatusChip status={saveStatus} />}
      </div>

      <label className={`field ${s.idea}`}>
        <span>Идея ролика</span>
        <AutoTextarea rows={2} maxLength={TOPIC_MAX} value={topic} onChange={(e) => onTopic(e.target.value)} disabled={locked || busy} />
      </label>

      <h3 className={s.dialogTitle}>Диалог</h3>
      {writing && !hasScript ? (
        <div className={s.writing}>
          <span className="spin" aria-hidden="true" /> Клод пишет диалог…
        </div>
      ) : (
        <>
          <ol className={s.lines}>
            {lines.map((line, i) => {
              const len = cleanText(line.text).length;
              const next = otherCast(line.who);
              return (
                <li key={line.key} className={s.line} data-who={line.who}>
                  <button
                    type="button"
                    className={s.who}
                    data-who={line.who}
                    disabled={locked}
                    title={`Отдать реплику: ${CAST_LABEL[next]}`}
                    aria-label={`Реплика ${i + 1}: ${CAST_LABEL[line.who]}. Отдать её: ${CAST_LABEL[next]}`}
                    onClick={() => onLine(line.key, { who: next })}
                  >
                    {CAST_LABEL[line.who]}
                  </button>
                  <AutoTextarea className={s.lineText} rows={1} aria-label={`Реплика ${i + 1}: ${CAST_LABEL[line.who]}`} value={line.text} onChange={(e) => onLine(line.key, { text: e.target.value })} disabled={locked} />
                  <span className={s.lineTools}>
                    <button type="button" className={s.iconBtn} aria-label={`Реплику ${i + 1} выше`} disabled={locked || i === 0} onClick={() => onMove(i, -1)}>
                      <Icon d="M12 19V5M5 12l7-7 7 7" />
                    </button>
                    <button type="button" className={s.iconBtn} aria-label={`Реплику ${i + 1} ниже`} disabled={locked || i === lines.length - 1} onClick={() => onMove(i, 1)}>
                      <Icon d="M12 5v14M5 12l7 7 7-7" />
                    </button>
                    <button type="button" className={s.iconBtn} aria-label={`Удалить реплику ${i + 1}`} disabled={locked} onClick={() => onDelete(line.key)}>
                      <Icon d="M6 6l12 12M18 6L6 18" />
                    </button>
                  </span>
                  {len > MAX_LINE_CHARS && (
                    <span className={`${s.counter} ${s.over}`}>
                      {len}/{MAX_LINE_CHARS}
                    </span>
                  )}
                </li>
              );
            })}
          </ol>
          <button type="button" className={`btn btn-ghost btn-sm ${s.addLine}`} disabled={locked || lines.length >= MAX_LINES} onClick={onAdd}>
            + Добавить реплику
          </button>
          {total > MAX_SCRIPT_CHARS && (
            <div className={s.totals}>
              <span className={s.over}>
                Знаков: {total} из {MAX_SCRIPT_CHARS}
              </span>
            </div>
          )}
          {problems.length > 0 && (
            <ul className={`warn-box ${s.problems}`}>
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}
        </>
      )}

      <div className="actions">
        {hasScript ? (
          <>
            <button type="button" className="btn" disabled={locked || busy || problems.length > 0} onClick={onSaveNext}>
              {saving && <span className="spin" aria-hidden="true" />}
              {saveStatus?.tone === "warn" ? "Сохранить и продолжить" : "К монтажу"}
            </button>
            <button type="button" className="btn btn-secondary" disabled={locked || busy} onClick={onRewrite}>
              {rewriting && <span className="spin" aria-hidden="true" />}
              Переписать сценарий
            </button>
          </>
        ) : (
          <button type="button" className="btn" disabled={locked || busy} onClick={onRewrite}>
            {rewriting && <span className="spin" aria-hidden="true" />}
            Написать сценарий
          </button>
        )}
      </div>
    </section>
  );
}
