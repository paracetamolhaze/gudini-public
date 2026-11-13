"use client";
import { useCallback, useEffect, useState } from "react";
import type { ShareSlide } from "@/lib/carousel/share";

export type InstagramShareState = "desktop" | "loading" | "ready" | "failed";

/** Телефон с «Поделиться» файлами: экран под палец и canShare принимает картинку. На компьютере — архив. */
function phoneCanShareFiles(): boolean {
  if (typeof navigator === "undefined" || typeof navigator.canShare !== "function" || typeof navigator.share !== "function") return false;
  if (!window.matchMedia?.("(pointer: coarse)").matches) return false;
  try { return navigator.canShare({ files: [new File([new Uint8Array([0xff, 0xd8, 0xff])], "probe.jpg", { type: "image/jpeg" })] }); }
  catch { return false; }
}

/**
 * Копирует подпись в буфер прямо в обработчике нажатия. Сначала синхронно (выделение во временном поле и
 * execCommand): так копирование заканчивается до вызова share() и не съедает нажатие. Не вышло — Clipboard API.
 */
function copyNow(text: string): Promise<boolean> {
  const focused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const field = document.createElement("textarea");
  field.value = text;
  field.setAttribute("readonly", "");
  field.setAttribute("aria-hidden", "true");
  // 16px — чтобы iOS не приближал страницу при выделении
  field.style.cssText = "position:fixed;top:0;left:0;width:1px;height:1px;padding:0;border:0;opacity:0;font-size:16px";
  document.body.appendChild(field);
  let copied = false;
  try {
    field.focus({ preventScroll: true });
    field.select();
    field.setSelectionRange(0, text.length);
    copied = document.execCommand("copy");
  } catch { copied = false; }
  field.remove();
  focused?.focus({ preventScroll: true });
  if (copied) return Promise.resolve(true);
  if (!navigator.clipboard?.writeText) return Promise.resolve(false);
  return navigator.clipboard.writeText(text).then(() => true, () => false);
}

/**
 * Кнопка «В Instagram» для телефона: слайды заранее скачиваются в файлы, нажатие копирует подпись и сразу
 * открывает системное «Поделиться» со всеми слайдами — там владелец выбирает Instagram, добавляет музыку и
 * вставляет подпись. share() вызывается синхронно в самом нажатии: иначе Safari на iOS его отклонит.
 */
export function useInstagramShare(slides: ShareSlide[] | null) {
  const [phone, setPhone] = useState(false);
  const [files, setFiles] = useState<File[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [hint, setHint] = useState("");
  const [error, setError] = useState("");
  useEffect(() => { setPhone(phoneCanShareFiles()); }, []);
  const key = slides?.map((x) => x.url).join("|") ?? "";
  useEffect(() => {
    setFiles(null); setFailed(false);
    if (!phone || !slides) return;
    const abort = new AbortController();
    Promise.all(slides.map(async (x) => {
      const r = await fetch(x.url, { signal: abort.signal });
      if (!r.ok) throw new Error(`слайд ${x.name}: ${r.status}`);
      return new File([await r.blob()], x.name, { type: "image/jpeg" });
    })).then((ready) => {
      if (abort.signal.aborted) return;
      if (navigator.canShare({ files: ready })) setFiles(ready); else setFailed(true);
    }, () => { if (!abort.signal.aborted) setFailed(true); });
    return () => abort.abort();
    // слайды меняются вместе с адресами файлов
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phone, key]);
  const share = useCallback((caption: string) => {
    if (!files) return;
    setError("");
    const copied = copyNow(caption);
    navigator.share({ files }).catch((e: unknown) => {
      if ((e as Error)?.name !== "AbortError") setError(`Не открылось меню «Поделиться»: ${(e as Error)?.message || e}`);
    });
    void copied.then((ok) => setHint(ok ? "Подпись скопирована — вставь её в Instagram" : "Подпись не скопировалась — скопируй её из поля «Подпись Instagram» ниже"));
  }, [files]);
  const state: InstagramShareState = !phone ? "desktop" : failed ? "failed" : files ? "ready" : "loading";
  return { state, share, hint, error };
}
