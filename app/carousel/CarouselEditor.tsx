"use client";
import { Select } from "@/shared/appearance";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BackLink, Button, ErrorState, Field, StatusBadge, type StatusTone } from "../components/ui";
import { useConfirmDialog } from "../components/ConfirmDialog";
import type { Carousel, CarouselJob, Slide } from "@/lib/carousel/types";
import { CAROUSEL_LIMITS } from "@/lib/carousel/limits";
import { COMMON_TIME_ZONES, DEFAULT_TIME_ZONE, offsetLabel, utcToZonedLocal, zonedLocalToUtc } from "@/lib/carousel/timezone";
import { composeCaption, composeThreadsCaption, normalizeHashtags, splitThreadsCaption } from "@/lib/carousel/text";
import { shareSlides } from "@/lib/carousel/share";
import { publishedToAccount } from "@/lib/carousel/publicationHistory";
import { api, ApiError, isPending, PublicationMark, type SectionStatus } from "./shared";
import type { Publication } from "@/lib/carousel/igPost";
import { useInstagramShare } from "./useInstagramShare";
import s from "./carousel.module.css";

type ScheduleView = { id: string; account: { via: string }; status: string; when: string; stale: boolean; error: string | null };
type View = { schedules?: ScheduleView[]; publication?: Publication | null; carousel: Carousel; status: { text: string; tone: StatusTone }; readiness: string[]; staleSlideIds: string[]; schedule: { status: string; when: string; stale: boolean; error: string | null } | null };
function slideUrl(id: string, slide: Slide) {
  if (slide.render?.file && !slide.render.error) return `/api/carousel/${id}/image/${slide.render.file}`;
  const version = slide.image?.versions.find(v => v.id === slide.image?.currentId);
  return version ? `/api/carousel/${id}/illustration/${version.file}` : null;
}
/**
 * Карусель: слайды, правка и публикация. Обычные карусели открываются во вкладке «Карусель»,
 * собранные из мемов — во вкладке «Мемы» (memes); чужая вкладка перенаправляет в свою.
 */
export default function CarouselEditor({ id, memes = false }: { id: string; memes?: boolean }) {
  const router = useRouter();
  const home = memes ? { href: "/memes", label: "Мемы" } : { href: "/carousel", label: "Карусели" };
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [section, setSection] = useState<SectionStatus | null>(null);
  const [selected, setSelected] = useState("");
  const [instructions, setInstructions] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [platform, setPlatform] = useState<"instagram" | "threads" | "both">("instagram");
  const [threadsCaption, setThreadsCaption] = useState<string | null>(null);
  const [captionDraft, setCaptionDraft] = useState<string | null>(null);
  const [tagsDraft, setTagsDraft] = useState<string | null>(null);
  const [accountId, setAccountId] = useState("");
  const [publishMode, setPublishMode] = useState("now");
  const [localTime, setLocalTime] = useState("");
  const [timeZone, setTimeZone] = useState(DEFAULT_TIME_ZONE);
  const previous = useRef<CarouselJob | null>(null);
  const restored = useRef(false);
  const actionLock = useRef(false);
  const editInput = useRef<HTMLTextAreaElement>(null);
  const { ask, modal } = useConfirmDialog();
  const key = `gudini:carousel:${id}:instructions`;
  const accept = useCallback((v: View) => {
    const old = previous.current;
    if (old && isPending(old) && v.carousel.job?.id === old.id && v.carousel.job.state === "done") setNotice(old.type === "image" ? "Слайд обновлён" : "Готово");
    previous.current = v.carousel.job;
    setView(v);
    setSelected(sid => v.carousel.slides.some(sl => sl.id === sid) ? sid : v.carousel.slides[0]?.id ?? "");
  }, []);
  const load = useCallback(async () => {
    try { accept(await api<View>(`/api/carousel/${id}`)); setLoadError(""); }
    catch (e) { setLoadError((e as Error).message); }
  }, [id, accept]);
  useEffect(() => {
    void load();
    api<SectionStatus>("/api/carousel/status").then(st => {
      setSection(st); setTimeZone(st.timeZone || DEFAULT_TIME_ZONE);
      setLocalTime(utcToZonedLocal(Date.now() + 3600000, st.timeZone || DEFAULT_TIME_ZONE));
      setAccountId((st.instagram.accounts.find(a => a.active) ?? st.instagram.accounts[0])?.id ?? "");
    }).catch(e => setError((e as Error).message));
    try { const raw = localStorage.getItem(key); if (raw) setInstructions(JSON.parse(raw)); } catch {}
    restored.current = true;
  }, [load, key]);
  useEffect(() => { if (restored.current) try { localStorage.setItem(key, JSON.stringify(instructions)); } catch {} }, [instructions, key]);
  const c = view?.carousel;
  const meme = Boolean(c && (c.request.genre === "meme" || c.design?.genre === "meme"));
  useEffect(() => { if (c && meme !== memes) router.replace(meme ? `/memes/carousel/${id}` : `/carousel/${id}`); }, [c, meme, memes, id, router]);
  const accounts = platform === "threads" ? (section?.threads?.account ? [{ ...section.threads.account, problems: section.threads.problems }] : []) : section?.instagram.accounts ?? [];
  useEffect(() => {
    if (!c || !section) return;
    setAccountId(current => {
      const selected = accounts.find(a => a.id === current);
      if (selected && !publishedToAccount(c, selected.igUserId, platform === "threads" ? "threads" : "instagram")) return current;
      return accounts.find(a => !publishedToAccount(c, a.igUserId, platform === "threads" ? "threads" : "instagram"))?.id ?? accounts[0]?.id ?? "";
    });
  }, [c, section, platform]);
  const pending = isPending(c?.job) || c?.publish.status === "queued" || c?.publish.status === "running" || c?.schedule?.status === "queued" || c?.schedule?.status === "publishing";
  useEffect(() => { if (!pending) return; const timer = setInterval(() => void load(), 2000); return () => clearInterval(timer); }, [pending, load]);
  useEffect(() => { const visible = () => { if (document.visibilityState === "visible") void load(); }; document.addEventListener("visibilitychange", visible); return () => document.removeEventListener("visibilitychange", visible); }, [load]);
  async function run(name: string, path: string, json?: Record<string, unknown>, method = "POST") {
    if (actionLock.current) return false;
    actionLock.current = true; setBusy(name); setError(""); setNotice("");
    try { accept(await api<View>(`/api/carousel/${id}${path}`, { method, json })); return true; }
    catch (e) { setError((e as Error).message); if ((e as ApiError).status === 409) void load(); return false; }
    finally { setBusy(""); actionLock.current = false; }
  }
  // «В Instagram» на телефоне — у каруселей формата раздела, когда все слайды готовы (музыку добавляет сам Instagram)
  const igShare = useInstagramShare(c?.schema === 4 && view && !pending ? shareSlides(id, c.slides, view.staleSlideIds) : null);
  if (!c || !view) return <main><BackLink href={home.href}>{home.label}</BackLink>{loadError ? <ErrorState title="Не удалось открыть карусель" text={loadError} onRetry={() => void load()} /> : <div className="skeleton" style={{ height: 400 }} />}</main>;
  const current = c.slides.find(sl => sl.id === selected) ?? c.slides[0];
  const index = current ? c.slides.indexOf(current) : 0;
  const text = current ? instructions[current.id] ?? "" : "";
  const locked = pending || Boolean(busy);
  const selectedAccount = accounts.find(a => a.id === accountId);
  const platformLabel = platform === "both" ? "Instagram и Threads" : platform === "threads" ? "Threads" : "Instagram";
  const captionForThreads = threadsCaption ?? composeThreadsCaption((c.schedules ?? (c.schedule ? [c.schedule] : [])).find(sc => sc.account.via === "threads" && sc.status === "scheduled")?.snapshot.caption ?? c.caption);
  // подпись и хэштеги Instagram видны и правятся здесь: хэштеги уходят отдельной строкой после подписи
  const caption = captionDraft ?? c.caption;
  const tags = tagsDraft ?? c.hashtags.join(" ");
  const tagCount = tags.split(/[\s,]+/).filter(Boolean).length;
  const textChanged = (captionDraft !== null && captionDraft !== c.caption) || (tagsDraft !== null && tagsDraft !== c.hashtags.join(" "));
  const alreadyPublished = Boolean(selectedAccount && publishedToAccount(c, selectedAccount.igUserId, platform === "threads" ? "threads" : "instagram"));
  const blockers = [...(platform === "threads" ? section?.threads?.problems ?? ["Проверяем подключение Threads…"] : selectedAccount?.problems ?? section?.instagram.problems ?? []), ...view.readiness.filter(problem => platform !== "threads" || !problem.startsWith("Подпись:")), ...(platform === "both" ? [...(section?.threads?.problems ?? ["Проверяем Threads…"]), ...(!section?.threads?.account ? ["Подключите Threads"] : publishedToAccount(c, section.threads.account.igUserId, "threads") ? ["В Threads уже опубликовано. Выберите Instagram."] : [])] : []), ...(alreadyPublished ? ["В этом аккаунте карусель уже опубликована. Выберите другой аккаунт."] : [])];
  const canPublish = Boolean(section && selectedAccount && !blockers.length && !locked);
  const scheduledTime = zonedLocalToUtc(localTime, timeZone);
  const scheduleValid = scheduledTime !== null && scheduledTime >= Date.now() + 120000;
  const zoneNames: Record<string, string> = { "Asia/Qyzylorda": "Кызылорда", "Asia/Almaty": "Алматы", "Asia/Tashkent": "Ташкент", "Asia/Yekaterinburg": "Екатеринбург", "Europe/Moscow": "Москва", "Europe/Kyiv": "Киев", "Europe/Berlin": "Берлин", UTC: "UTC" };
  const src = current ? slideUrl(id, current) : null;
  // формат @siddhantt.ai (schema 4): слайды собраны целиком — вместо правки слайда скачивание архивом и источники
  const sid = c.schema === 4 ? c.sid : undefined;
  const sources = sid?.content?.sources ?? sid?.sources ?? [];
  const archive = <a className="btn btn-secondary btn-sm" href={`/api/carousel/${id}/archive`}>Слайды архивом</a>;
  // у шести новых стилей свои шаги: снимки и картинки идут после проверки фактов одним шагом
  const styledFlow = Boolean(sid?.style && sid.style !== "investigation");
  const stageOrder = styledFlow ? ["research", "write", "verify", "cover", "render", "done"] : ["research", "write", "shots", "verify", "cover", "render", "done"];
  const stageNames = styledFlow ? ["Тема и факты", "Тексты", "Проверка фактов", "Картинки и скриншоты", "Слайды"] : ["Тема и факты", "Тексты", "Скриншоты источников", "Проверка фактов", "Обложка", "Слайды"];
  async function edit() {
    if (!current || locked) return;
    if (text.trim().length < 3) { setError(meme ? "Напишите, что поправить на картинке." : "Напишите, что изменить на выбранном слайде."); editInput.current?.focus(); return; }
    const sid = current.id;
    const payload = c!.mode === "illustrated" ? { type: "image", slideId: sid, mode: current.image?.currentId ? "edit" : "regenerate", instruction: text, hint: text } : { type: "regenerate_slide", slideId: sid, hint: text };
    if (await run("edit", "/jobs", { ...payload, revision: c!.revision })) setInstructions(values => values[sid] === text ? { ...values, [sid]: "" } : values);
  }
  async function publish() {
    if (!canPublish) return;
    let revision = c!.revision;
    const label = selectedAccount?.label ?? platformLabel;
    if (!await ask({ title: publishMode === "now" ? "Опубликовать карусель?" : "Запланировать публикацию?", message: `${platformLabel} · ${c!.slides.length} слайдов · ${label}${publishMode === "later" ? ` · ${localTime.replace("T", " ")} (${timeZone})` : ""}`, action: publishMode === "now" ? "Опубликовать" : "Запланировать" })) return;
    if (textChanged) {
      try {
        const saved = await api<View>(`/api/carousel/${id}`, {method:"PATCH",json:{revision,caption,hashtags:tags}});
        accept(saved); revision = saved.carousel.revision; setCaptionDraft(null); setTagsDraft(null);
      } catch(e) { setError((e as Error).message); return; }
    }
    await run("publish", publishMode === "now" && platform !== "both" ? "/publish" : "/schedule", { revision, accountId, platform, ...(platform === "both" ? { threadsAccountId: section?.threads?.account?.id, immediate: publishMode === "now" } : {}), ...(platform !== "instagram" ? { caption: captionForThreads } : {}), ...(publishMode === "later" ? { localTime, timeZone } : {}) });
  }
  async function retry() {
    const job = c!.job;
    if (!job) return;
    if (job.type === "publish" || job.type === "verify_publish") { await run("verify", "/publish", { action: "verify" }); return; }
    if (await ask({ title: "Повторить попытку?", message: "Сайт повторит незавершённое действие.", action: "Повторить" })) await run("retry", "/jobs", { ...job.params, type: job.type, revision: c!.revision });
  }
  return <main className={s.simpleEditor}>
    <BackLink href={home.href}>{home.label}</BackLink>
    <div className={s.simpleHeading}><h1>{c.title}</h1><StatusBadge tone={view.status.tone} busy={pending}>{view.status.text}</StatusBadge></div>
    {c.slides.length > 0 && <div className={s.pubBar}>
      {/* пост найден в статистике — отметка стоит сама; иначе владелец ставит её кнопкой, повторное нажатие снимает */}
      {view.publication?.source === "post" ? <PublicationMark p={view.publication} /> : <>
        <Button variant="secondary" size="sm" className={s.pubToggle} aria-pressed={Boolean(view.publication)} title={view.publication ? "Нажми ещё раз, чтобы снять отметку" : undefined} busy={busy === "published"} disabled={Boolean(busy)} onClick={() => void run("published", "/published", { published: !view.publication })}>{view.publication ? `✓ Опубликована ${new Date(view.publication.at).toLocaleDateString("ru-RU", { day: "numeric", month: "short" })}` : "Опубликована"}</Button>
        {!view.publication && <span className="hint">Залил с телефона? Отметь. Пост с этой подписью сайт сам найдёт в статистике и покажет просмотры.</span>}
      </>}
    </div>}
    {error && <div className="error-box" role="alert">{error}</div>}
    {loadError && <div className="error-box" role="alert">{loadError}</div>}
    {notice && !pending && <div className={s.simpleNotice} role="status">{notice}</div>}
    {pending && <div className={s.simpleProgress} role="status"><span className="spin" aria-hidden="true" />{c.job?.step || "Подготавливаем…"}<progress max={100} value={c.job?.progress ?? 5} aria-label="Готовность" /></div>}
    {sid && (pending || c.job?.state === "error") && c.job?.type === "generate" && <ol className={s.sidStages} aria-label="Шаги создания">{stageNames.map((name, i) => { const at = stageOrder.indexOf(sid.stage); return <li key={name} data-state={i < at ? "done" : i === at ? (c.job?.state === "error" ? "error" : "now") : "next"}>{name}</li>; })}</ol>}
    {c.job?.state === "error" && !pending && <div className="error-box" role="alert">{c.job.error}<div className="actions"><Button variant="secondary" size="sm" onClick={() => void retry()} disabled={locked}>Повторить</Button></div></div>}
    {current && <div className={s.simpleWorkspace}>
      <section className={s.simpleCanvas} aria-label="Выбранный слайд">
        {src ? <img src={src} alt={`Слайд ${index + 1}: ${current.title}`} width={1080} height={c.format === "square" ? 1080 : 1350} /> : <div className="skeleton" style={{ aspectRatio: "4 / 5" }} />}
        <div className={s.simpleNavigation}><Button variant="ghost" aria-label="Предыдущий слайд" disabled={!index} onClick={() => setSelected(c.slides[index - 1].id)}>←</Button><span>{index + 1} / {c.slides.length}</span><Button variant="ghost" aria-label="Следующий слайд" disabled={index === c.slides.length - 1} onClick={() => setSelected(c.slides[index + 1].id)}>→</Button></div>
      </section>
      <div className={s.simpleControls}>
        <section className={s.simpleFilmstrip} aria-label="Выберите слайд">{c.slides.map((sl, i) => { const image = slideUrl(id, sl); return <button type="button" className={s.simpleThumb} key={sl.id} aria-label={`Выбрать слайд ${i + 1}`} aria-pressed={sl.id === current.id} onClick={() => { setSelected(sl.id); setError(""); }}>
          {image ? <img src={image} alt="" width={108} height={135} /> : <span>{i + 1}</span>}<span>{i + 1}</span>
        </button>; })}</section>
        {sid ? <section className={s.sidPanel} aria-label="Файлы и источники">
          {igShare.state === "desktop" ? <><h2>Скачать</h2><div className={s.sidDownloads}>{archive}</div></> : <>
            <h2>В Instagram с музыкой</h2>
            <p className={s.sidShareNote}>Слайды откроются в меню «Поделиться»: выбери Instagram → Лента, добавь музыку и вставь подпись — она скопируется сама.</p>
            {igShare.state === "failed" ? <><p className={s.sidShareNote}>Этот телефон не принял слайды для «Поделиться» — скачай их архивом.</p><div className={s.sidDownloads}>{archive}</div></>
              : <div className={s.sidDownloads}><Button busy={igShare.state === "loading"} onClick={() => igShare.share(composeCaption(caption, normalizeHashtags(tags)))}>{igShare.state === "loading" ? "Готовим слайды…" : "В Instagram"}</Button></div>}
            {igShare.hint && <p className={s.sidShareHint} role="status">{igShare.hint}</p>}
            {igShare.error && <div className="error-box" role="alert">{igShare.error}</div>}
          </>}
          {sources.length > 0 && <><h2>Источники</h2><ol className={s.sidSources}>{sources.map(x => <li key={x.url}><a href={x.url} target="_blank" rel="noreferrer noopener">{x.title || x.url}</a> <span>· {x.publisher}{x.date ? `, ${x.date}` : ""}</span></li>)}</ol></>}
        </section> : <form className={s.simpleEditForm} onSubmit={e => { e.preventDefault(); void edit(); }}>
          <label className="field"><span>{meme ? `Что поправить на картинке слайда ${index + 1}?` : `Что изменить на слайде ${index + 1}?`}</span><textarea ref={editInput} name="slide-instruction" autoComplete="off" rows={4} maxLength={CAROUSEL_LIMITS.instructionMax} value={text} onChange={e => setInstructions(values => ({ ...values, [current.id]: e.target.value }))} placeholder={meme ? "Что изменить на картинке" : "Что изменить на слайде"} disabled={locked} /></label>
          <Button type="submit" busy={busy === "edit"} disabled={locked}>{meme ? "Поправить картинку" : "Изменить слайд"}</Button>
          {(current.image?.error || current.render?.error) && <div className="error-box" role="alert">{current.image?.error || current.render?.error}</div>}
        </form>}
        <section className={s.simplePublish} aria-label="Публикация">
          <h2>Публикация</h2>
          <div className={s.segmented} role="group" aria-label="Площадка публикации"><button type="button" aria-pressed={platform === "instagram"} disabled={locked} onClick={() => setPlatform("instagram")}>Instagram</button><button type="button" aria-pressed={platform === "threads"} disabled={locked} onClick={() => setPlatform("threads")}>Threads</button><button type="button" aria-pressed={platform === "both"} disabled={locked} onClick={() => setPlatform("both")}>Обе</button></div>
          {c.publish.status === "uncertain" || view.schedule?.status === "uncertain" ? <><p>Проверяем, опубликована ли карусель.</p><Button variant="secondary" disabled={locked} onClick={() => void run("verify", "/publish", { action: "verify" })}>Проверить статус</Button></> : <>
            {(view.schedules ?? []).filter(sc => !["canceled", "published"].includes(sc.status)).map(sc => <div className="state-box" key={sc.id}><p><strong>{sc.account.via === "threads" ? "Threads" : "Instagram"}</strong> · {sc.status === "scheduled" ? "Запланировано" : sc.status === "queued" || sc.status === "publishing" ? "Отправляется" : "Требует внимания"}: {sc.when}</p>{sc.error && <p>{sc.error}</p>}{sc.stale && <><p>В расписании сохранена предыдущая версия.</p><Button size="sm" disabled={locked} onClick={() => void run("snapshot", "/schedule", { action: "refresh", revision: c.revision, scheduleId: sc.id })}>Обновить версию</Button></>}<Button variant="ghost" size="sm" disabled={locked} onClick={async () => { if (await ask({title: "Отменить расписание?", message: `${sc.account.via === "threads" ? "Threads" : "Instagram"} · ${sc.when}`, action: "Отменить публикацию"})) await run("unschedule", `/schedule?scheduleId=${sc.id}`, undefined, "DELETE"); }}>Снять с расписания</Button></div>)}
            {section && accounts.length > 1 && <Field label={`Аккаунт ${platformLabel}`}><span className={s.accountSelect}><Select aria-label={`Аккаунт ${platformLabel}`} value={accountId} onChange={e => setAccountId(e.target.value)} disabled={locked}>{accounts.map(a => <option key={a.id} value={a.id} disabled={publishedToAccount(c, a.igUserId, platform === "threads" ? "threads" : "instagram")}>{a.label ?? a.igUserId}{publishedToAccount(c, a.igUserId, platform === "threads" ? "threads" : "instagram") ? " · опубликовано" : ""}</option>)}</Select><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m7 10 5 5 5-5" /></svg></span></Field>}
            {accounts.length === 1 && <p className={s.singleAccount}>{platform === "both" ? "Instagram" : platformLabel} <strong>{accounts[0].label ?? accounts[0].igUserId}</strong></p>}
            {platform === "both" && section?.threads?.account && <p className={s.singleAccount}>Threads <strong>{section.threads.account.label ?? section.threads.account.igUserId}</strong></p>}
            {platform !== "threads" && <>
              <Field label={`Подпись Instagram · ${[...caption].length} символов`}><textarea rows={3} value={caption} onChange={e => setCaptionDraft(e.target.value)} disabled={locked} /></Field>
              <Field label={`Хэштеги Instagram · ${tagCount}`}><input type="text" name="hashtags" autoComplete="off" value={tags} onChange={e => setTagsDraft(e.target.value)} placeholder="#тема #ещё_тема" disabled={locked} /></Field>
              <div className="actions"><Button variant="secondary" size="sm" disabled={locked || !textChanged} onClick={async () => { if (await run("caption-save", "", { revision: c.revision, caption, hashtags: tags }, "PATCH")) { setCaptionDraft(null); setTagsDraft(null); } }}>Сохранить подпись</Button></div>
            </>}
            {platform !== "instagram" && <Field label={`Подпись Threads · ${[...captionForThreads].length} символов`}><textarea rows={3} value={captionForThreads} onChange={e => setThreadsCaption(e.target.value)} disabled={locked} /></Field>}
            {platform !== "instagram" && splitThreadsCaption(captionForThreads).length > 1 && <p className="hint">В Threads: текст к карусели и {splitThreadsCaption(captionForThreads).length - 1} комментария-продолжения, до 500 символов каждый.</p>}
            <div className={s.segmented} role="group" aria-label="Когда публиковать"><button type="button" aria-pressed={publishMode === "now"} onClick={() => setPublishMode("now")} disabled={locked}>Сейчас</button><button type="button" aria-pressed={publishMode === "later"} onClick={() => setPublishMode("later")} disabled={locked}>По расписанию</button></div>
            {publishMode === "later" && <>
              <div className={s.publishScheduleFields}>
                <Field label="Дата"><input aria-label="Дата публикации" name="publish-date" type="date" min={utcToZonedLocal(Date.now(), timeZone).slice(0, 10)} value={localTime.split("T")[0] ?? ""} onChange={e => setLocalTime(e.target.value ? e.target.value + "T" + (localTime.split("T")[1] || "12:00") : "")} disabled={locked} /></Field>
                <Field label="Время"><input aria-label="Время публикации" name="publish-time" type="time" step={60} value={localTime.split("T")[1] ?? ""} onChange={e => setLocalTime((localTime.split("T")[0] || utcToZonedLocal(Date.now(), timeZone).slice(0, 10)) + "T" + e.target.value)} disabled={locked} /></Field>
                <Field label="Часовой пояс"><span className={s.scheduleZone}><Select aria-label="Часовой пояс" name="timezone" value={timeZone} onChange={e => setTimeZone(e.target.value)} disabled={locked}>{(section?.timeZones ?? COMMON_TIME_ZONES).map(zone => <option key={zone} value={zone}>{zoneNames[zone] ?? zone} · {offsetLabel(scheduledTime ?? Date.now(), zone)}</option>)}</Select><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m7 10 5 5 5-5" /></svg></span></Field>
              </div>
              {!scheduleValid && <p className="hint">Выберите дату и время хотя бы на две минуты позже текущего.</p>}
            </>}
            {blockers.length > 0 && !pending && <p className="hint">{blockers[0]}</p>}
            {c.publish.error && <p className="error-box" role="alert">{c.publish.error}</p>}
            <Button className={s.publishButton} block busy={busy === "publish"} disabled={!canPublish || (publishMode === "later" && !scheduleValid)} onClick={() => void publish()}>{publishMode === "now" ? "Опубликовать" : "Запланировать"}<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14m-6-6 6 6-6 6" /></svg></Button>
          </>}
        </section>
      </div>
    </div>}
    {modal}
  </main>;
}
