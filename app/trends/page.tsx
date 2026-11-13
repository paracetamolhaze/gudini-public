"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Button, StatusBadge } from "../components/ui";
import type { FormulaCount } from "@/lib/trends/rank";
import { MAX_ACCOUNTS_PER_RUN, ROLE_LABEL, ROLES, SOURCE_LABEL, THEME_LABEL, THEMES, type MadeProject, type Role, type Theme, type TrendAccount, type TrendCard, type TrendRun } from "@/lib/trends/types";
import IgLogin from "./IgLogin";
import s from "./trends.module.css";

type Card = TrendCard & { made: MadeProject[] };
type Latest = TrendRun & { summary: { reels: number; accounts: number; outliers: number; analyzed: number; formulas: FormulaCount[]; confidence: string } };
type Browser = {
  available: boolean; error?: string; connected?: boolean; account?: string | null; login?: boolean; busy?: boolean; working?: string | null;
  run?: { id: string; theme: Theme; state: string; step: string; progress: number } | null;
};
type Overview = { accounts: TrendAccount[]; cards: Card[]; latest: Record<Theme, Latest | null>; browser: Browser };

const THEME_KEY = "gudini:trends:theme";
const fmt = new Intl.NumberFormat("ru-RU");
const short = (n: number | null | undefined) =>
  n === null || n === undefined ? "—" : n >= 1e6 ? `${(n / 1e6).toFixed(1).replace(".0", "")} млн` : n >= 1e4 ? `${Math.round(n / 1e3)} тыс.` : fmt.format(n);
const when = (iso?: string) => (iso ? new Date(iso).toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "");

async function call(action: string, body?: unknown) {
  const r = await fetch(`/api/trends/${action}`, body === undefined ? { cache: "no-store" } : {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || "Раздел трендов не ответил");
  return data;
}

export default function TrendsPage() {
  const [data, setData] = useState<Overview | null>(null);
  const [theme, setTheme] = useState<Theme>("global");
  const [error, setError] = useState("");
  const [pending, setPending] = useState("");
  const [loggingIn, setLoggingIn] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/trends", { cache: "no-store" });
      if (r.status === 401) throw new Error("Нужен вход на сайт.");
      setData(await r.json());
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(THEME_KEY);
      if (THEMES.includes(saved as Theme)) setTheme(saved as Theme);
    } catch {}
    void load();
  }, [load]);

  const browser = data?.browser;
  const live = Boolean(browser?.busy || browser?.login || data?.cards.some((c) => c.state === "working"));
  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => void load(), 3000);
    return () => clearInterval(timer);
  }, [live, load]);

  async function act(name: string, action: string, body?: unknown) {
    setPending(name);
    setError("");
    try {
      const result = await call(action, body ?? {});
      await load();
      return result;
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPending("");
    }
  }

  function pickTheme(t: Theme) {
    setTheme(t);
    try {
      localStorage.setItem(THEME_KEY, t);
    } catch {}
  }

  const accounts = data?.accounts.filter((a) => a.theme === theme) ?? [];
  const active = accounts.filter((a) => a.status === "active");
  const latest = data?.latest[theme] ?? null;
  const running = browser?.run?.state === "running" ? browser.run : null;
  const order = new Map((latest?.cards ?? []).map((k, i) => [k, i]));
  // разобранные с готовыми сценариями сверху, найденные без разбора — под ними
  const cards = (data?.cards ?? [])
    .filter((c) => c.theme === theme)
    .sort((a, b) => Number(a.state === "found") - Number(b.state === "found") || (order.get(a.key) ?? 1e6) - (order.get(b.key) ?? 1e6) || b.multiple - a.multiple);
  const perRun = Math.min(active.length, MAX_ACCOUNTS_PER_RUN);

  return (
    <main className={s.page}>
      <div className="page-head">
        <div>
          <h1 className="page-title">Тренды</h1>
          <p className="page-sub">
            Англоязычные ролики, которые набрали в 3 и больше раз больше обычного для своего аккаунта. Берём формулу, а не ролик: зацепку, ход и длину.
          </p>
        </div>
      </div>

      <div className={s.tabs} role="tablist" aria-label="Тема">
        {THEMES.map((t) => (
          <button key={t} type="button" role="tab" aria-selected={t === theme} className={s.tab} onClick={() => pickTheme(t)}>
            {THEME_LABEL[t]}
          </button>
        ))}
      </div>

      {error && <div className="error-box" role="alert">{error}</div>}
      {!data && !error && <div className="skeleton" style={{ height: 160 }} />}

      {data && (
        <>
          <section className={`card ${s.panel}`} aria-label="Прогон">
            <div className={s.browserRow}>
              <span className={s.browserText}>
                {!browser?.available ? (
                  <>{browser?.error}</>
                ) : browser.connected ? (
                  <>Instagram: вход выполнен{browser.account ? ` (${browser.account})` : ""}.</>
                ) : (
                  <>Instagram: нет входа — прогон прочитает только YouTube Shorts. Советуем войти запасным аккаунтом.</>
                )}
              </span>
              {browser?.available && !browser.login && (
                <span className="actions">
                  <Button size="sm" variant="secondary" disabled={Boolean(browser.busy) || Boolean(pending)} busy={pending === "login"}
                    onClick={async () => { if (await act("login", "login")) setLoggingIn(true); }}>
                    {browser.connected ? "Войти заново" : "Войти в Instagram"}
                  </Button>
                  {browser.connected && (
                    <Button size="sm" variant="ghost" disabled={Boolean(browser.busy) || Boolean(pending)} onClick={() => void act("disconnect", "disconnect")}>Отключить</Button>
                  )}
                </span>
              )}
            </div>
            {(loggingIn || browser?.login) && browser?.available && (
              <IgLogin send={call} onDone={() => { setLoggingIn(false); void load(); }} />
            )}

            {running ? (
              <div className={s.progress}>
                <div className="progress-track"><div className="progress-fill" style={{ width: `${Math.max(3, running.progress)}%` }} /></div>
                <div className={s.progressRow}>
                  <span><span className="spin" aria-hidden="true" /> {running.step}</span>
                  <Button size="sm" variant="secondary" busy={pending === "stop"} disabled={Boolean(pending)} onClick={() => void act("stop", "stop")}>Остановить</Button>
                </div>
                {running.theme !== theme && <p className="hint">Идёт прогон темы «{THEME_LABEL[running.theme]}».</p>}
              </div>
            ) : (
              <div className={s.runRow}>
                <Button busy={pending === "run"} disabled={!browser?.available || Boolean(browser?.busy) || Boolean(browser?.login) || !active.length || Boolean(pending)}
                  onClick={() => void act("run", "run", { theme })}>
                  Найти залетевшие
                </Button>
                <span className="hint">
                  {!active.length
                    ? "Сначала оставьте предложенные аккаунты или добавьте свои."
                    : `${perRun} из ${active.length} аккаунтов${active.length > perRun ? " — следующие в очереди, кого дольше не читали" : ""}. Чтение ≈ ${Math.max(5, Math.round(perRun * 0.4))} мин в человеческом темпе, потом Claude разбирает до 20 сильнейших роликов (по 2–3 мин).`}
                </span>
              </div>
            )}

            {latest && <RunSummary run={latest} />}
          </section>

          <Accounts key={theme} accounts={accounts} theme={theme} pending={pending} act={act} />

          {cards.length > 0 ? (
            <section className={s.cards} aria-label="Залетевшие ролики">
              {cards.map((c) => <TrendCardView key={c.key} card={c} pending={pending} act={act} busy={Boolean(browser?.busy)} />)}
            </section>
          ) : (
            latest?.state === "done" && <p className="hint">В этом прогоне выбросов нет — у всех аккаунтов обычные дни.</p>
          )}
        </>
      )}
    </main>
  );
}

function RunSummary({ run }: { run: Latest }) {
  const { summary } = run;
  return (
    <div className={s.summary}>
      <p>
        <b>{run.state === "running" ? "Идёт прогон" : `Прогон ${when(run.finishedAt ?? run.startedAt)}`}</b>
        {run.state !== "running" && <> · {run.step}</>}
      </p>
      <p className="hint">
        Прочитано {summary.reels} роликов у {summary.accounts} аккаунтов, выбросов {summary.outliers}, разобрано {summary.analyzed}. {summary.confidence}
      </p>
      {run.error && <p className="error-box">{run.error}</p>}
      {summary.formulas.length > 0 && (
        <div className={s.formulas}>
          {summary.formulas.map((f) => (
            <span key={String(f.formulaId)} className="chip">{f.formulaId ? `#${f.formulaId} ` : ""}{f.name} ×{f.count}</span>
          ))}
        </div>
      )}
      <details>
        <summary>Медианы по аккаунтам</summary>
        <div className={s.tableWrap}>
          <table className={s.table}>
            <thead><tr><th>Аккаунт</th><th>Площадка</th><th>Подписчики</th><th>Медиана</th><th>Роликов</th><th /></tr></thead>
            <tbody>
              {run.reads.map((r) => (
                <tr key={`${r.source}:${r.handle}`}>
                  <td>@{r.handle}</td><td>{SOURCE_LABEL[r.source]}</td><td>{short(r.followers)}</td><td>{short(r.median)}</td>
                  <td>{r.reels.filter((x) => !x.pinned).length}</td><td className={s.readError}>{r.error ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

type Act = (name: string, action: string, body?: unknown) => Promise<any>;

function Accounts({ accounts, theme, pending, act }: { accounts: TrendAccount[]; theme: Theme; pending: string; act: Act }) {
  const [instagram, setInstagram] = useState("");
  const [youtube, setYoutube] = useState("");
  const [role, setRole] = useState<Role>(theme === "global" ? "outsized" : "direct");
  const [all, setAll] = useState(false);
  const proposed = accounts.filter((a) => a.status === "proposed").length;
  // сотни аккаунтов не разворачиваются сразу: сверху ждущие решения, остальные — по кнопке
  const sorted = [...accounts].sort((a, b) => Number(b.status === "proposed") - Number(a.status === "proposed"));
  const shown = all ? sorted : sorted.slice(0, 12);
  return (
    <section className={`card ${s.panel}`} aria-label="Аккаунты">
      <div className="card-head">
        <h2>Аккаунты</h2>
        {proposed > 0 && <StatusBadge tone="warn">Ждут решения: {proposed}</StatusBadge>}
      </div>
      <p className="hint">
        {theme === "global"
          ? `Крупнейшие авторы всех ниш — ради формы, тема остаётся наша. ${accounts.length} в списке, за прогон читаем до ${MAX_ACCOUNTS_PER_RUN} по очереди.`
          : `Прямые конкуренты, соседняя ниша с той же аудиторией и крупные — только ради формы. За прогон читаем до ${MAX_ACCOUNTS_PER_RUN} утверждённых.`}
      </p>
      <ul className={s.accounts}>
        {shown.map((a) => (
          <li key={a.id} className={s.account} data-proposed={a.status === "proposed" || undefined}>
            <span className={s.accountMain}>
              <span className={s.accountName}>
                {a.instagram ? <a href={`https://www.instagram.com/${a.instagram}/`} target="_blank" rel="noreferrer">@{a.instagram}</a> : <span className="muted">без Instagram</span>}
                {a.youtube && <a className={s.yt} href={`https://www.youtube.com/@${a.youtube}/shorts`} target="_blank" rel="noreferrer">YT @{a.youtube}</a>}
                <span className="chip">{ROLE_LABEL[a.role]}</span>
              </span>
              {a.note && <span className="hint">{a.note}</span>}
            </span>
            <span className="actions">
              {a.status === "proposed" && (
                <Button size="sm" variant="secondary" disabled={Boolean(pending)} onClick={() => void act(`approve:${a.id}`, "accounts", { action: "approve", id: a.id })}>Оставить</Button>
              )}
              <Button size="sm" variant="ghost" disabled={Boolean(pending)} onClick={() => void act(`remove:${a.id}`, "accounts", { action: "remove", id: a.id })}>Убрать</Button>
            </span>
          </li>
        ))}
      </ul>
      {sorted.length > shown.length && (
        <button type="button" className="link-btn" onClick={() => setAll(true)}>Показать все ({sorted.length})</button>
      )}
      <form
        className={s.addForm}
        onSubmit={async (e) => {
          e.preventDefault();
          const done = await act("add", "accounts", { action: "add", theme, role, instagram, youtube });
          if (done) { setInstagram(""); setYoutube(""); }
        }}
      >
        <label className="field"><span>Instagram</span><input value={instagram} onChange={(e) => setInstagram(e.target.value)} placeholder="@ник" autoComplete="off" /></label>
        <label className="field"><span>YouTube (по желанию)</span><input value={youtube} onChange={(e) => setYoutube(e.target.value)} placeholder="@канал" autoComplete="off" /></label>
        <label className="field">
          <span>Роль</span>
          <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
            {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
          </select>
        </label>
        <Button type="submit" busy={pending === "add"} disabled={Boolean(pending) || (!instagram.trim() && !youtube.trim())}>Добавить</Button>
      </form>
    </section>
  );
}

function TrendCardView({ card, pending, act, busy }: { card: Card; pending: string; act: Act; busy: boolean }) {
  const a = card.analysis;
  const idea = card.idea;
  const [made, setMade] = useState<{ href: string } | null>(null);
  const make = async () => {
    const r = await act(`make:${card.key}`, "make", { key: card.key });
    if (r?.href) setMade(r);
  };
  const madeKind = idea?.kind === "sketch" ? "3d" : "video";
  const links = card.made.filter((m) => m.kind === madeKind);
  return (
    <article className={`card ${s.trend}`}>
      <header className={s.trendHead}>
        <span className={s.multiple}>×{card.multiple.toFixed(1)}</span>
        <span className={s.trendMeta}>
          <b>@{card.handle}</b> · {SOURCE_LABEL[card.source]}
          <span className="hint">
            {short(card.views)} просмотров при медиане {short(card.median)}
            {card.duration ? ` · ${Math.round(card.duration)} с` : ""}
            {card.followers ? ` · ${short(card.followers)} подписчиков` : ""}
          </span>
        </span>
        <span className="spacer" />
        <a className="link-btn" href={card.url} target="_blank" rel="noreferrer">Источник ↗</a>
        <Button size="sm" variant="ghost" disabled={busy || Boolean(pending)} onClick={() => { if (confirm("Скрыть карточку? Разбор и кадры удалятся.")) void act(`hide:${card.key}`, "hide", { key: card.key }); }}>Скрыть</Button>
      </header>

      {card.frames.length > 0 && (
        <div className={s.frames}>
          {card.frames.map((f) => {
            const n = f.match(/\d/)?.[0];
            // кадры — готовые маленькие JPEG
            // eslint-disable-next-line @next/next/no-img-element
            return <img key={f} src={`/api/trends/image?key=${encodeURIComponent(card.key)}&n=${n}`} alt={`Кадр ${n}`} loading="lazy" />;
          })}
        </div>
      )}

      {card.state === "working" && <p className="hint"><span className="spin" aria-hidden="true" /> {card.step ?? "Разбираем"}</p>}
      {card.state === "queued" && <p className="hint">В очереди на разбор.</p>}
      {card.state === "found" && (
        <div className="actions">
          <span className="hint">Найден, ещё не разобран: в прогон вошли 20 сильнейших.</span>
          <Button size="sm" variant="secondary" busy={pending === `analyze:${card.key}`} disabled={busy || Boolean(pending)}
            onClick={() => void act(`analyze:${card.key}`, "analyze", { key: card.key })}>
            Разобрать
          </Button>
        </div>
      )}
      {card.state === "error" && (
        <>
          <p className="error-box">{card.error}</p>
          <div className="actions">
            <Button size="sm" variant="secondary" busy={pending === `analyze:${card.key}`} disabled={busy || Boolean(pending)}
              onClick={() => void act(`analyze:${card.key}`, "analyze", { key: card.key })}>
              Разобрать снова
            </Button>
          </div>
        </>
      )}

      {a && (
        <div className={s.analysis}>
          <p><span className="chip">{a.formulaId ? `#${a.formulaId} ${a.formulaName}` : "Не размечена"}</span>{!a.formulaId && a.shape ? ` ${a.shape}` : ""}</p>
          {a.hookSpoken && <p className={s.hook}>«{a.hookSpoken}»{a.hookRu && <span className="hint"> — {a.hookRu}</span>}</p>}
          {a.hookScreen && <p className="hint">На экране: {a.hookScreen}</p>}
          {a.story && <p><b>Что в ролике.</b> {a.story}</p>}
          {a.structure.length > 0 && <ol className={s.structure}>{a.structure.map((x, i) => <li key={i}>{x}</li>)}</ol>}
          <p><b>Почему сработало.</b> {a.why}</p>
          {a.ask && <p className="hint">В конце просят: {a.ask}</p>}
        </div>
      )}

      {card.ideaError && <p className="error-box">Наш вариант не написан: {card.ideaError}</p>}
      {idea?.kind === "sketch" && (
        <div className={s.idea}>
          <h3>Наш скетч 3Д{idea.title ? `: ${idea.title}` : ""}</h3>
          <p>{idea.plot}</p>
          <p className="hint">Первая реплика: «{idea.opening}»</p>
          {idea.formulaUse && <p className="hint">{idea.formulaUse}</p>}
        </div>
      )}
      {idea?.kind === "video" && (
        <div className={s.idea}>
          <h3>Наш ролик{idea.title ? `: ${idea.title}` : ""}</h3>
          <ol className={s.hooks}>
            {idea.hooks.map((h, i) => (
              <li key={i} data-chosen={i === idea.chosen || undefined}>
                <span className="chip">#{h.formulaId} {h.formulaName}</span> «{h.spoken}»
                <span className={s.screen}>{h.screen}</span>
              </li>
            ))}
          </ol>
          <details>
            <summary>Сценарий · {Math.round(idea.seconds)} с</summary>
            <p className={s.script}>{idea.script}</p>
          </details>
          <details>
            <summary>Раскадровка по секундам</summary>
            <div className={s.tableWrap}>
              <table className={s.table}>
                <thead><tr><th>Время</th><th>Звучит</th><th>На экране</th><th>В кадре</th></tr></thead>
                <tbody>
                  {idea.beats.map((b, i) => (
                    <tr key={i}><td className={s.nowrap}>{b.from}–{b.to} с</td><td>{b.say}</td><td>{b.screen}</td><td>{b.shot}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
          {idea.loop && <p className="hint">Петля: {idea.loop}</p>}
        </div>
      )}
      {(idea || (a && card.state === "ready")) && (
        <div className="actions">
          {idea && (
            <Button busy={pending === `make:${card.key}`} disabled={Boolean(pending)} onClick={() => void make()}>
              {idea.kind === "sketch" ? "Сделать в 3Д" : "Сделать ролик"}
            </Button>
          )}
          <Button variant="secondary" busy={pending === `rewrite:${card.key}` || Boolean(card.step && card.state === "ready")} disabled={busy || Boolean(pending)}
            onClick={() => void act(`rewrite:${card.key}`, "rewrite", { key: card.key })}>
            {idea ? "Другой вариант" : "Написать наш вариант"}
          </Button>
          {made && <Link className="link-btn" href={made.href}>Открыть проект</Link>}
          {!made && links.length > 0 && (
            <Link className="link-btn" href={links.at(-1)!.kind === "3d" ? `/3d/${links.at(-1)!.projectId}` : `/project/${links.at(-1)!.projectId}`}>
              Уже сделано {links.length > 1 ? `(${links.length})` : ""} — открыть
            </Link>
          )}
        </div>
      )}
      {card.state === "ready" && card.step && <p className="hint"><span className="spin" aria-hidden="true" /> {card.step}</p>}
    </article>
  );
}
