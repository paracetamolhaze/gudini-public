"use client";
import { useEffect, useRef, useState } from "react";
import { Button } from "../components/ui";
import s from "./trends.module.css";

/**
 * Окно входа в браузер Instagram — как у TikTok: кадры страницы приходят картинкой, клики и текст уходят
 * обратно в отдельный браузер контейнера. Пароль попадает только в Instagram, сайт его не хранит.
 */
export default function IgLogin({ send, onDone }: { send: (action: string, body?: unknown) => Promise<any>; onDone: () => void }) {
  const [image, setImage] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const queue = useRef<Promise<unknown>>(Promise.resolve());

  function request(action: string, body?: unknown): Promise<any> {
    const next = queue.current.catch(() => {}).then(() => send(action, body));
    queue.current = next;
    return next;
  }

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        if (!busy) {
          const frame = await request("frame");
          if (!stopped) setImage(`data:image/jpeg;base64,${frame.image}`);
        }
      } catch (e) {
        if (!stopped) setError((e as Error).message);
      }
      if (!stopped) timer = setTimeout(poll, 2000);
    };
    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [busy]);

  async function act(action: string, body: unknown = {}) {
    setBusy(true);
    setError("");
    try {
      await request(action, body);
      if (action === "finish" || action === "close") onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={s.login}>
      <p className="hint">Войдите в Instagram в окне ниже. После входа нажмите «Я вошёл».</p>
      {error && <p role="alert" className="error-box">{error}</p>}
      {image && (
        // кадр живого браузера, не картинка сайта
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={image}
          draggable={false}
          alt="Окно входа в отдельный браузер Instagram"
          className={s.loginFrame}
          onClick={(e) => {
            if (busy) return;
            const r = e.currentTarget.getBoundingClientRect();
            void act("input", { type: "click", x: ((e.clientX - r.left) * 1280) / r.width, y: ((e.clientY - r.top) * 900) / r.height });
          }}
        />
      )}
      <details>
        <summary>Ввод с клавиатуры и прокрутка</summary>
        <p className="hint">Сначала нажмите нужное поле в окне выше, затем введите текст здесь и отправьте его в поле.</p>
        <input aria-label="Текст для выбранного поля Instagram" type="password" value={text} onChange={(e) => setText(e.target.value)} autoComplete="off" />
        <div className="actions">
          <Button size="sm" disabled={busy || !text} onClick={() => { void act("input", { type: "text", text }); setText(""); }}>Ввести</Button>
          {["Tab", "Enter", "Backspace", "Escape"].map((key) => (
            <Button key={key} size="sm" variant="secondary" disabled={busy} onClick={() => void act("input", { type: "key", key })}>{key}</Button>
          ))}
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => void act("input", { type: "scroll", dy: 500 })}>Вниз</Button>
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => void act("input", { type: "scroll", dy: -500 })}>Вверх</Button>
        </div>
      </details>
      <div className="actions">
        <Button disabled={busy} onClick={() => void act("finish")}>Я вошёл — проверить</Button>
        <Button variant="secondary" disabled={busy} onClick={() => void act("close")}>Закрыть окно</Button>
      </div>
    </div>
  );
}
