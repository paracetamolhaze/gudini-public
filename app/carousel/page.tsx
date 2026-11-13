"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, EmptyState, ErrorState, StatusBadge, type StatusTone } from "../components/ui";
import { useConfirmDialog } from "../components/ConfirmDialog";
import { AccessNotice, api, ApiError, formatDate, isAccessError, PublicationMark } from "./shared";
import type { Publication } from "@/lib/carousel/igPost";
import { DEFAULT_STYLE, STYLES, type StyleId } from "@/lib/carousel/styles/catalog";
import s from "./carousel.module.css";

type Summary = { id: string; title: string; createdAt: string; slideCount: number; cover: string | null; status: { text: string; tone: StatusTone; busy?: boolean }; schedule: { status: string; when: string } | null; job: { step: string; progress: number } | null; error: string | null; publication: Publication | null };

/**
 * Карусели: выбор стиля таблетками и кнопка «Создать» — раздел сам находит свежую историю под стиль, пишет, рисует
 * картинки, снимает источники и собирает слайды. Ниже — все карусели с обложками и ходом работы.
 */
export default function CarouselsPage() {
  const router = useRouter();
  const [list, setList] = useState<Summary[] | null>(null);
  const [loadError, setLoadError] = useState<ApiError | null>(null);
  const [creating, setCreating] = useState(false);
  const [style, setStyle] = useState<StyleId>(DEFAULT_STYLE);
  const [error, setError] = useState("");
  const { ask, modal } = useConfirmDialog();
  const chosen = STYLES.find(st => st.id === style) ?? STYLES[0];
  const load = useCallback(async () => {
    try { setList((await api<{ carousels: Summary[] }>("/api/carousel")).carousels); setLoadError(null); }
    catch (e) { setLoadError(e as ApiError); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const pending = list?.some(c => c.status.busy);
  useEffect(() => { if (!pending) return; const timer = setInterval(() => void load(), 3000); return () => clearInterval(timer); }, [pending, load]);
  async function create() {
    if (creating) return;
    setCreating(true); setError("");
    try {
      const r = await api<{ id: string }>("/api/carousel", { method: "POST", json: { style } });
      router.push(`/carousel/${r.id}`);
    } catch (e) { setError((e as Error).message); setCreating(false); }
  }
  async function remove(c: Summary) {
    if (!await ask({ title: "Удалить карусель?", message: `«${c.title}» будет удалена со всеми слайдами. Отменить это действие нельзя.`, action: "Удалить" })) return;
    try { await api(`/api/carousel/${c.id}`, { method: "DELETE" }); await load(); }
    catch (e) { setError((e as Error).message); }
  }
  return <main className={s.simpleHome}>
    <div className="page-head"><h1 className="page-title">Карусели</h1></div>
    {loadError && isAccessError(loadError) ? <AccessNotice error={loadError} /> : <>
      <section className={`card ${s.createCard} ${s.createCompact}`} aria-label="Новая карусель">
        <div className={s.stylePills} role="radiogroup" aria-label="Стиль карусели">{STYLES.map(st => <button type="button" role="radio" aria-checked={style === st.id} key={st.id} className={s.stylePill} onClick={e => { setStyle(st.id); e.currentTarget.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" }); }} disabled={creating} title={st.blurb}>
          <img src={`/api/carousel/styles/${st.id}`} alt="" width={30} height={30} loading="lazy" />{st.name}
        </button>)}</div>
        <div className={s.styleGo}>
          <p className={s.styleBlurb}><b>{chosen.name}</b> · {chosen.blurb}.<span className={s.styleBlurbMore}> Свежая история с источниками, делается сама за 10–25 минут.</span></p>
          <Button busy={creating} onClick={() => void create()}>{creating ? "Создаём…" : "Создать"}</Button>
        </div>
        {error && <div className="error-box" role="alert">{error}</div>}
      </section>
      {loadError && <ErrorState title="Не удалось загрузить карусели" text={loadError.message} onRetry={() => void load()} />}
      {!list && !loadError && <div className="skeleton" style={{ height: 90 }} />}
      {list?.length === 0 && <EmptyState title="Здесь появятся ваши карусели" />}
      <section className={s.list} aria-label="Ваши карусели">{list?.map(c => <div className={s.row} key={c.id}>
        <Link href={`/carousel/${c.id}`} className={s.thumb} tabIndex={-1} aria-hidden="true">{c.cover && <img src={`/api/carousel/${c.id}/image/${c.cover}`} alt="" width={60} height={75} loading="lazy" />}</Link>
        <div className={s.rowMain}>
          <Link className={s.rowTitle} href={`/carousel/${c.id}`}>{c.title}</Link>
          <div className={s.rowMeta}><span>{formatDate(c.createdAt)}</span><StatusBadge tone={c.status.tone} busy={c.status.busy}>{c.status.text}</StatusBadge>{c.schedule?.status === "scheduled" && <span>{c.schedule.when}</span>}{c.publication && <PublicationMark p={c.publication} />}</div>
          {c.job && <div className={s.rowJob}><span>{c.job.step}</span><progress max={100} value={c.job.progress || 2} aria-label="Готовность" /></div>}
          {!c.job && c.error && <div className={s.rowError}>{c.error}</div>}
        </div>
        <div className={s.rowActions}>
          <Link href={`/carousel/${c.id}`} className="btn btn-secondary btn-sm">Открыть</Link>
          <Button variant="ghost" size="sm" aria-label={`Удалить карусель «${c.title}»`} disabled={c.status.busy} onClick={() => void remove(c)}>×</Button>
        </div>
      </div>)}</section>
    </>}
    {modal}
  </main>;
}
