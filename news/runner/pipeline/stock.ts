// Запас историй: поиск с проверкой фактов идёт минут пятнадцать, поэтому ПК ищет истории заранее, пока свободен, а
// «Создать» сразу берёт готовую. Владелец 28.10: «я нажал создать и очень долго стоит на этапе ищем историю».
// С 29.10 владелец выбирает сам («да выбор нужен, это хорошо»): запас уходит на сайт с каждым запросом задания, там
// истории видны с оценкой, «Монтировать» ставит ролик по выбранной, «Не то» убирает её и учит поиск его вкусу.
import crypto from "node:crypto";
import fs from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { searchStatus } from "./llm";
import { CRYPTO_LANES, cryptoName, findCandidates, isCrypto, LANES, MIN_SCORE, rateCandidates, verifyCandidates, type Candidate, type Lane, type Taste } from "./story";
import { mapLimit, readJson, writeJson, type Hooks } from "./util";
import type { NewsPick, StockReport } from "../protocol";

type Stocked = { id: string; candidate: Candidate; at: string };
type Mark = { title: string; hero: string; at: string };
type StockFile = { stories: Stocked[]; skipped: Mark[]; rejected: Mark[]; chosen: Mark[] };

/** Громкие истории живут дольше мелких, но и они стареют: старше трёх суток из запаса уходят. */
const FRESH_MS = 72 * 3600_000;
/** Владелец выбирает из нескольких: меньше четырёх в запасе — ПК ищет ещё. */
const LOW = 4;
/** Фоновый поиск не чаще раза в час: круг, где до MIN_SCORE дотянули немногие, не запускает следующий сразу. */
const ROUND_GAP_MS = 60 * 60_000;
/** После неудачного поиска (лимит подписки, мост недоступен) — следующий не раньше чем через полчаса. */
const RETRY_MS = 30 * 60_000;
const SKIPPED_MAX = 40;
/** Сколько последних выборов и отказов владельца видят поиск и редактор. */
const TASTE_MAX = 12;
/** Направления поиска идут по два: третье место моста Claude остаётся ролику, если владелец нажмёт «Создать». */
const LANES_AT_ONCE = 2;

const PLATFORM: Record<Candidate["hero"]["platform"], string> = { tiktok: "TikTok", instagram: "Instagram", youtube: "YouTube" };
const label = (c: { title: string; hero: { handle: string } }) => `${c.title} (@${c.hero.handle})`;
const markLabel = (m: Mark) => `${m.title} (@${m.hero})`;
const mark = (c: Candidate): Mark => ({ title: c.title, hero: c.hero.handle, at: new Date().toISOString() });
const same = (a: Candidate, b: Candidate) => a.hero.handle.toLowerCase() === b.hero.handle.toLowerCase() || a.title === b.title;
/**
 * Взятая или нескачавшаяся история уходит из запаса одна: другие истории того же героя остаются — владелец мог выбрать
 * обе (31.10: скачанный «Супермаркет MrBeast» унёс из запаса выбранный «MrBeast в Узбекистане», и задание упало).
 */
const sameStory = (a: Candidate, b: Candidate) => a.title === b.title;
/** Продолжение прошлого ролика оценку не проходит: его тянет то, как зашла первая часть. */
const scoreOf = (c: Candidate) => c.rating?.score ?? (c.sequelOf ? MIN_SCORE : 0);
const byScore = (a: { candidate: Candidate; at: string }, b: { candidate: Candidate; at: string }) => scoreOf(b.candidate) - scoreOf(a.candidate) || b.at.localeCompare(a.at);
const newId = () => Date.now().toString(36) + crypto.randomBytes(4).toString("hex");

/** Крипта — два ролика из шести (story.ts CRYPTO_LANES): смешной и новостной, каждый раз в шесть роликов. */
const CRYPTO_EVERY = 6;

/**
 * Какое направление крипты идёт следующим роликом (владелец 3.11: «2 из 6 роликов нужно делать про криптовалюту, 1
 * прикольный смешной, другой новостной формат»): то, которого нет среди последних пяти роликов канала, — и не раньше
 * чем через два ролика после другого крипто-ролика, так крипта идёт каждым третьим. lanes — направления сделанных роликов
 * по порядку, у старых и продолжений его нет.
 */
export function cryptoDue(lanes: (string | undefined)[]): string[] {
  const recent = lanes.slice(-(CRYPTO_EVERY - 1));
  if (recent.slice(-(CRYPTO_EVERY / CRYPTO_LANES.length - 1)).some(isCrypto)) return [];
  return CRYPTO_LANES.map((l) => l.id).filter((id) => !recent.includes(id));
}

/** Порядок «Создать» и страницы: крипта по очереди — первой, остальные по оценке, крипта не по очереди — после них. */
export function quotaOrder<T extends { candidate: Candidate; at: string }>(stories: T[], due: string[]): T[] {
  const tier = (c: Candidate) => (c.lane && due.includes(c.lane) ? 0 : isCrypto(c.lane) ? 2 : 1);
  return [...stories].sort((a, b) => tier(a.candidate) - tier(b.candidate) || byScore(a, b));
}

export type Stock = ReturnType<typeof createStock>;

export function createStock(file: string, historyFile: string, log: (line: string) => void) {
  let searching: Promise<void> | null = null;
  let searchStarted = 0;
  let lastRound = 0;
  let failedAt = 0;

  const read = (): StockFile => {
    const raw = fs.existsSync(file) ? readJson<Partial<StockFile>>(file) : {};
    const now = Date.now();
    // без оценки — находки прежнего поиска, ещё до мерок масштаба (продолжения оценки не ждут)
    const stories = (raw.stories ?? []).filter((s) => now - Date.parse(s.at) < FRESH_MS && (s.candidate.rating || s.candidate.sequelOf));
    const next = { stories: stories.map((s) => (s.id ? s : { ...s, id: newId() })), skipped: raw.skipped ?? [], rejected: raw.rejected ?? [], chosen: raw.chosen ?? [] };
    // номер истории выдаётся один раз: по нему сайт просит именно её
    if (stories.some((s) => !s.id)) writeJson(file, next);
    return next;
  };
  const history = (): string[] => (fs.existsSync(historyFile) ? readJson<{ title: string; hero: string }[]>(historyFile).map((h) => `${h.title} (@${h.hero})`) : []);
  /** Направления сделанных роликов по порядку; «Создать заново» пишет ту же историю ещё раз — она считается одним роликом. */
  const madeLanes = (): (string | undefined)[] => {
    const made = fs.existsSync(historyFile) ? readJson<{ title: string; lane?: string }[]>(historyFile) : [];
    return made.filter((h, i) => !made.slice(i + 1).some((later) => later.title === h.title)).map((h) => h.lane);
  };
  const due = () => cryptoDue(madeLanes());
  /** Направления крипты, у которых в запасе нет ни одной истории: их ищет следующий круг. */
  const cryptoMissing = (f: StockFile) => CRYPTO_LANES.filter((l) => !f.stories.some((s) => s.candidate.lane === l.id));
  const tasteOf = (f: StockFile): Taste => ({ chosen: f.chosen.slice(-TASTE_MAX).map(markLabel), rejected: f.rejected.slice(-TASTE_MAX).map(markLabel) });

  /** Сильные истории одного направления — в запас сразу, не дожидаясь остальных: «Создать» может их ждать. */
  function put(found: Candidate[]) {
    const next = read();
    const at = new Date().toISOString();
    for (const c of found) if (!next.stories.some((s) => same(s.candidate, c))) next.stories.push({ id: newId(), candidate: c, at });
    writeJson(file, next);
    log(`в запасе историй: ${next.stories.length}`);
  }

  /** only — только эти направления (запас полон, не хватает крипты); иначе все, и недостающая крипта первой. */
  async function search(onTick?: (text: string) => void, only?: Lane[]) {
    const known = read();
    const lanes: Lane[] = only ?? [...cryptoMissing(known), ...LANES];
    const exclude = [...history(), ...known.stories.map((s) => label(s.candidate)), ...known.skipped.map(markLabel), ...known.rejected.map(markLabel)];
    const taste = tasteOf(known);
    const started = Date.now();
    const timer = onTick ? setInterval(() => void searchStatus(started).then(onTick).catch(() => {}), 15_000) : null;
    try {
      const strong = await mapLimit(lanes, LANES_AT_ONCE, async (lane) => {
        try {
          const rated = await rateCandidates(await findCandidates(lane, exclude, taste, log), taste, log);
          // сильные — ещё и на правду: два независимых источника и видео события (1.11: поиск выдумал Гарри Стайлза крысой)
          const good = await verifyCandidates(rated.filter((c) => scoreOf(c) >= MIN_SCORE), log);
          put(good);
          return good.length;
        } catch (error) {
          log(`поиск «${lane.name}» не удался: ${(error as Error).message}`);
          return -1;
        }
      });
      if (strong.every((n) => n < 0)) throw new Error("Поиск историй не удался ни по одному направлению");
      log(`круг поиска: сильных историй ${strong.filter((n) => n > 0).reduce((a, n) => a + n, 0)} (от ${MIN_SCORE} из 10)`);
    } finally {
      if (timer) clearInterval(timer);
    }
  }

  /** Поиск, который ждёт задание: на странице ролика видно, сколько он идёт и что Claude ищет сейчас. */
  function ticker(hooks: Hooks, started: number) {
    const timer = setInterval(() => void searchStatus(started).then((text) => hooks.step(text, 3)).catch(() => {}), 15_000);
    return () => clearInterval(timer);
  }

  function note(list: "chosen" | "rejected", c: Candidate) {
    const next = read();
    next[list] = [...next[list], mark(c)].slice(-SKIPPED_MAX);
    writeJson(file, next);
  }

  /**
   * Истории, оценённые до вопроса «кому перешлют» (10.11.2026), оцениваются заново все вместе: слабые по новой мерке из
   * запаса уходят и больше не предлагаются. Сбой оценки запас не трогает.
   */
  async function rerate() {
    const known = read();
    const stale = known.stories.filter((s) => s.candidate.rating && !s.candidate.rating.share && !s.candidate.sequelOf);
    if (!stale.length) return;
    try {
      const rated = await rateCandidates(stale.map((s) => s.candidate), tasteOf(known), log);
      const next = read();
      for (const [i, s] of stale.entries()) {
        const rating = rated[i]?.rating;
        const at = next.stories.findIndex((x) => x.id === s.id);
        if (at < 0 || !rating?.share) continue;
        if (rating.score >= MIN_SCORE) next.stories[at] = { ...next.stories[at], candidate: { ...next.stories[at].candidate, rating } };
        else {
          log(`по новой оценке из запаса уходит: ${label(s.candidate)} — ${rating.score} (перешлют: ${rating.share})`);
          next.stories.splice(at, 1);
          next.skipped = [...next.skipped, mark(s.candidate)].slice(-SKIPPED_MAX);
        }
      }
      writeJson(file, next);
    } catch (error) {
      log(`переоценка запаса не удалась: ${(error as Error).message}`);
    }
  }

  return {
    count: () => read().stories.length,

    /**
     * Пока ПК свободен: запас пополняется в фоне, не мешая брать задания. force — владелец нажал «Найти ещё»:
     * без оглядки на запас и паузу между кругами.
     */
    refill(force = false) {
      if (searching) return;
      const now = Date.now();
      const known = read();
      const low = known.stories.length < LOW;
      const missing = cryptoMissing(known);
      if (!force && ((!low && !missing.length) || now - lastRound < ROUND_GAP_MS || now - failedAt < RETRY_MS)) return;
      log(force ? "ищем ещё истории: попросил владелец" : low ? "ищем истории про запас" : `ищем крипту про запас: ${missing.map((l) => l.name).join(", ")}`);
      searchStarted = lastRound = now;
      searching = rerate()
        .then(() => search(undefined, force || low ? undefined : missing))
        .catch((error) => {
          failedAt = Date.now();
          log(`поиск историй про запас не удался: ${(error as Error).message}`);
        })
        .finally(() => {
          searching = null;
        });
    },

    /**
     * Истории для «Создать». pick — выбранная владельцем на сайте: только она. Иначе лучшие по оценке: из запаса сразу;
     * если идёт поиск про запас — до первой сильной находки (направления кладут их по мере готовности); если запас
     * пуст — поиск сейчас. Из запаса истории уходят через used и skip.
     */
    async take(hooks: Hooks, pick?: string): Promise<Candidate[]> {
      if (pick) {
        const chosen = read().stories.find((s) => s.id === pick);
        if (!chosen) throw new Error("Выбранной истории уже нет в запасе ПК — выберите на сайте другую");
        note("chosen", chosen.candidate);
        await hooks.step(`Берём выбранную историю: ${chosen.candidate.title}`.slice(0, 160), 5);
        return [chosen.candidate];
      }
      if (!read().stories.length && searching) {
        await hooks.step("Ищем громкую историю — поиск про запас уже идёт", 3);
        const stop = ticker(hooks, searchStarted);
        try {
          // searching обнуляет сам поиск, когда кончится: читать его заново на каждом круге
          const current = (): Promise<void> | null => searching;
          for (let s = current(); s && !read().stories.length; s = current()) await Promise.race([s, sleep(15_000)]);
        } finally {
          stop();
        }
      }
      const ready = read().stories.length > 0;
      if (!ready) {
        await hooks.step("Ищем громкую историю", 3);
        await search((text) => void hooks.step(text, 3).catch(() => {}));
      }
      const queue = due();
      const stories = quotaOrder(read().stories, queue);
      if (!stories.length) throw new Error(`Поиск не нашёл ни одной громкой истории (от ${MIN_SCORE} из 10) — нажмите «Найти ещё» позже`);
      const first = stories[0].candidate;
      const what = first.lane && queue.includes(first.lane) ? `Крипта по очереди (${cryptoName(first.lane)})` : ready ? "Берём лучшую историю из запаса" : "Нашли историю";
      await hooks.step(`${what}: ${first.title}`.slice(0, 160), 5);
      return stories.map((s) => s.candidate);
    },

    /** История запаса по номеру (заготовка, prep.ts), из запаса не уходит. */
    get(id: string): Candidate | null {
      return read().stories.find((s) => s.id === id)?.candidate ?? null;
    },

    /** История не из поиска (продолжение, sequels.ts) — в запас, если такой там ещё нет. */
    offer(c: Candidate) {
      const next = read();
      if (next.stories.some((s) => same(s.candidate, c))) return;
      next.stories.push({ id: newId(), candidate: c, at: new Date().toISOString() });
      writeJson(file, next);
    },

    /** История стала роликом: из запаса уходит (в историю канала её пишет createVideo). */
    used(c: Candidate) {
      const next = read();
      next.stories = next.stories.filter((s) => !sameStory(s.candidate, c));
      writeJson(file, next);
    },

    /** Роликов героя не скачать: из запаса уходит и в следующих поисках не предлагается. */
    skip(c: Candidate) {
      const next = read();
      next.stories = next.stories.filter((s) => !sameStory(s.candidate, c));
      next.skipped = [...next.skipped, mark(c)].slice(-SKIPPED_MAX);
      writeJson(file, next);
    },

    /** «Не то» на сайте: из запаса уходит, больше не предлагается, а поиск и редактор видят её как отказ владельца. */
    reject(id: string) {
      const next = read();
      const gone = next.stories.find((s) => s.id === id);
      if (!gone) return;
      next.stories = next.stories.filter((s) => s !== gone);
      writeJson(file, next);
      note("rejected", gone.candidate);
      log(`владелец отклонил: ${label(gone.candidate)}`);
    },

    /**
     * «Убрать» на сайте: из запаса уходит и больше не предлагается, но вкусом не считается — тема устарела или просто
     * не сейчас (владелец 29.10: «нужно ещё просто убрать без ущерба»).
     */
    drop(id: string) {
      const next = read();
      const gone = next.stories.find((s) => s.id === id);
      if (!gone) return;
      next.stories = next.stories.filter((s) => s !== gone);
      next.skipped = [...next.skipped, mark(gone.candidate)].slice(-SKIPPED_MAX);
      writeJson(file, next);
      log(`владелец убрал: ${label(gone.candidate)}`);
    },

    /** Запас для страницы «Новости»: лучшие сверху, и идёт ли сейчас поиск. */
    report(): StockReport {
      const queue = due();
      const stories: NewsPick[] = quotaOrder(read().stories, queue).map(({ id, candidate: c, at }) => ({
        id,
        title: c.title,
        summary: c.summary,
        why: c.why,
        hero: `@${c.hero.handle} (${PLATFORM[c.hero.platform] ?? c.hero.platform})`,
        anchor: c.rating?.anchor || null,
        hook: c.rating?.hook || null,
        score: c.rating?.score ?? null,
        verdict: c.rating?.verdict || null,
        share: c.rating?.share || null,
        sources: [...new Set(c.facts.map((f) => f.source).filter((u) => /^https?:\/\//.test(u)))].slice(0, 3),
        at,
        sequelOf: c.sequelOf?.title ?? null,
        lane: c.lane && isCrypto(c.lane) ? c.lane : null,
        due: Boolean(c.lane && queue.includes(c.lane)),
      }));
      return { stories, searching: searching ? { startedAt: new Date(searchStarted).toISOString() } : null };
    },
  };
}
