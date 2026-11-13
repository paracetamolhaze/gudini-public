"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type TextareaHTMLAttributes } from "react";
import { ISO_IN_TEXT, type Status } from "@/lib/news/rules";
import s from "./news.module.css";

/** Общие мелочи страниц «Новостей», как у «3Д». Свои, а не из app/components: их API в проде и в ветке расходится. */

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function api<T>(url: string, init: { method?: string; json?: unknown } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: init.method ?? "GET",
      headers: init.json !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: init.json !== undefined ? JSON.stringify(init.json) : undefined,
      cache: "no-store",
    });
  } catch {
    throw new ApiError("Сервер не отвечает — проверьте соединение и повторите", 0);
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(data?.error ?? `Ошибка ${res.status}`, res.status);
  return data as T;
}

/** Any moment on the pages of the section, in one manner: «сегодня в 21:40», «14 ноября в 18:30». */
export function formatDate(iso: string): string {
  return formatWhen(iso);
}

const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/** «сегодня в 21:40», «завтра в 10:00», «14 ноября в 18:30» — the moment in the owner's own time. */
export function formatWhen(iso: string, now = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const time = d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  const days = Math.round((dayStart(d) - dayStart(now)) / 86_400_000);
  const day = days === 0 ? "сегодня" : days === 1 ? "завтра" : days === -1 ? "вчера" : d.toLocaleDateString("ru-RU", { day: "numeric", month: "long", ...(d.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }) });
  return `${day} в ${time}`;
}

/** A publication's note with its machine time («на 2026-11-11T16:40:00.000Z») rewritten in the owner's own time. */
export function humanTimes(text: string): string {
  return text.replace(new RegExp(ISO_IN_TEXT, "g"), (iso) => formatWhen(iso));
}

export function StatusChip({ status }: { status: Status }) {
  const cls = ["status", status.tone === "neutral" ? "" : status.tone, status.busy ? "busy" : ""].filter(Boolean).join(" ");
  return <span className={`${cls} ${s.chip}`}>{status.text}</span>;
}

/**
 * Повтор запроса, пока идёт задача; на скрытой вкладке не дёргаем сервер. Следующий запрос — только
 * после ответа на предыдущий: на медленной мобильной сети запросы не копятся и не обгоняют друг друга.
 */
export function usePolling(active: boolean, ms: number, tick: () => Promise<void>) {
  const fn = useRef(tick);
  fn.current = tick;
  useEffect(() => {
    if (!active) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const loop = async () => {
      if (!document.hidden) await fn.current().catch(() => {});
      if (!stopped) timer = setTimeout(loop, ms);
    };
    timer = setTimeout(loop, ms);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [active, ms]);
}

/** Поле растёт под текст: на телефоне описание видно целиком, без прокрутки внутри поля. */
export function AutoTextarea(props: TextareaHTMLAttributes<HTMLTextAreaElement> & { value: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const fit = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight + el.offsetHeight - el.clientHeight}px`;
  }, []);
  useLayoutEffect(fit, [props.value, fit]);
  useEffect(() => {
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [fit]);
  return <textarea ref={ref} {...props} />;
}

type Ask = { title: string; text: ReactNode; action: string; danger?: boolean };

/** Подтверждение в своём окне вместо confirm(): то выглядит чужеродно на телефоне. */
export function useConfirm() {
  const ref = useRef<HTMLDialogElement>(null);
  const [ask, setAsk] = useState<(Ask & { resolve: (ok: boolean) => void }) | null>(null);
  useEffect(() => {
    const d = ref.current;
    if (ask && d && !d.open) d.showModal();
  }, [ask]);
  const close = useCallback(
    (ok: boolean) => {
      ask?.resolve(ok);
      ref.current?.close();
      setAsk(null);
    },
    [ask],
  );
  const confirm = useCallback((a: Ask) => new Promise<boolean>((resolve) => setAsk({ ...a, resolve })), []);
  const modal = (
    <dialog
      ref={ref}
      className={s.dialog}
      aria-labelledby="news-confirm-title"
      onCancel={(e) => {
        e.preventDefault();
        close(false);
      }}
    >
      {ask && (
        <>
          <h2 id="news-confirm-title">{ask.title}</h2>
          <p>{ask.text}</p>
          <div className={s.dialogActions}>
            <button type="button" className="btn btn-secondary" onClick={() => close(false)}>
              Отмена
            </button>
            <button type="button" className={`btn ${ask.danger ? "btn-danger" : ""}`} onClick={() => close(true)} autoFocus>
              {ask.action}
            </button>
          </div>
        </>
      )}
    </dialog>
  );
  return { confirm, modal };
}
