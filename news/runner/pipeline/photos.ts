// Настоящие фото знаменитостей, которых нет в роликах героя (владелец 29.10: «почему не показали Оливию Родриго?» —
// генератор живых людей не рисует, а нарисованная знаменитость была бы поддельным фото; владелец выбрал настоящее фото).
// Берётся главное фото статьи английской Википедии, только с Викисклада (свободные лицензии). Подписи автора на видео нет:
// владелец 29.10 — «под фото есть надписи, на след роликах такого не должно быть», а на предупреждение, что CC BY требует
// указать автора, — «просто не вставляй их и бери и все». credit остаётся в плане ролика.
import { execFile } from "node:child_process";
import fs from "node:fs";
import { claudeJson } from "./llm";

const UA = "gudini-news-runner/1.0 (short news videos)";
/** Свободные лицензии Викисклада. */
const FREE = /^(CC BY|CC0|Public domain|PD)/i;

type Summary = { title?: string; originalimage?: { source: string } };
type Info = { query: { pages: Record<string, { imageinfo?: { thumburl?: string; thumbwidth?: number; thumbheight?: number; extmetadata?: Record<string, { value?: string }> }[] }> } };

async function get<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { headers: { "User-Agent": UA }, signal });
  if (!res.ok) throw new Error(`Википедия ${res.status}`);
  return (await res.json()) as T;
}

const summary = (title: string, signal?: AbortSignal) => get<Summary>(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, "_"))}`, signal);
const strip = (html?: string) => (html ?? "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();

const BROWSER = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36", "Accept-Language": "ru,en" };

/** Аватар по нику: YouTube (og:image канала) и TikTok (avatarLarger на странице профиля). */
async function avatars(handle: string, signal?: AbortSignal): Promise<{ src: string; where: string }[]> {
  const out: { src: string; where: string }[] = [];
  const yt = await fetch(`https://www.youtube.com/@${handle}`, { headers: BROWSER, signal }).catch(() => null);
  const ytSrc = yt?.ok ? (await yt.text()).match(/<meta property="og:image" content="([^"]+)"/)?.[1] : undefined;
  if (ytSrc) out.push({ src: ytSrc, where: "YouTube" });
  const tt = await fetch(`https://www.tiktok.com/@${handle}`, { headers: BROWSER, signal }).catch(() => null);
  const ttSrc = tt?.ok ? (await tt.text()).match(/"avatarLarger":"([^"]+)"/)?.[1]?.split(String.fromCharCode(92) + "u002F").join("/") : undefined;
  if (ttSrc) out.push({ src: ttSrc, where: "TikTok" });
  return out;
}

/**
 * Блогер без статьи в Википедии — аватар его канала по нику (владелец 1.11 о «Зондбе»: «блогера новки нужно было добавить
 * фото»), но только если на нём он сам: рисунок или логотип вместо лица фото не ставит (владелец 1.11: «нужно реально фото,
 * а не аватарка странная, это человек же!»). Чужое фото «похожего» человека не берётся.
 */
async function channelAvatar(nick: string, out: string, signal?: AbortSignal): Promise<{ w: number; h: number; credit: string }> {
  const handle = nick.trim().replace(/^@/, "");
  if (!/^[\w.-]{2,40}$/.test(handle)) throw new Error(`«${nick}» — не ник канала`);
  const found = await avatars(handle, signal);
  if (!found.length) throw new Error(`у @${handle} нет канала на YouTube и в TikTok`);
  for (const a of found) {
    const res = await fetch(a.src, { signal });
    if (!res.ok) continue;
    const buf = Buffer.from(await res.arrayBuffer());
    const looks = await claudeJson<{ real?: boolean }>(
      "Перед тобой аватар канала. Ответь, настоящая ли это фотография живого человека, где видно его лицо (не рисунок, не аниме, не 3D-персонаж, не логотип, не мем). Ответ — только JSON: {\"real\":true}",
      `Аватар @${handle} (${a.where})`,
      { task: "news-avatar", effort: "low", images: [{ base64: buf.toString("base64"), mediaType: res.headers.get("content-type")?.includes("png") ? "image/png" : "image/jpeg" }] },
    ).catch(() => ({ real: false }));
    if (!looks.real) continue;
    fs.writeFileSync(out, buf);
    const size = Number(a.src.match(/=s(\d+)/)?.[1]) || 720;
    return { w: size, h: size, credit: `Аватар @${handle} (${a.where})` };
  }
  throw new Error(`на аватарах @${handle} не фото человека (${found.map((a) => a.where).join(", ")})`);
}

const WEB_PHOTO_SYSTEM = `Ты фоторедактор. Найди в интернете настоящую фотографию человека — его лицо хорошо видно: из статьи о нём, интервью, его собственного профиля в соцсетях или с мероприятия. Страница, где лежит фото, называет его по имени или нику прямо рядом с фото (подпись, заголовок, профиль). Похожий человек, фанарт, рисунок, мем — не он. Ответ — только JSON: {"url":"прямая ссылка на картинку jpg/png/webp","page":"страница, где она лежит","why":"чем страница подтверждает, что это он"}; не нашёл — {"url":""}.`;

/**
 * Фото блогера из интернета, когда статьи в Википедии нет, а на аватаре не лицо (владелец 2.11 о nowkie: «ты не мог
 * загуглить? я скинул фото»): Claude ищет фото на странице, где человек назван по имени, и смотрит, что это живой человек.
 */
async function webPortrait(name: string, about: string, out: string, signal?: AbortSignal): Promise<{ w: number; h: number; credit: string }> {
  const found = await claudeJson<{ url?: string; page?: string; why?: string }>(WEB_PHOTO_SYSTEM, `Человек: ${name}${about ? ` — ${about}` : ""}`, { web: true, task: "news-photo", effort: "medium" });
  if (!found.url || !/^https?:\/\//.test(found.url)) throw new Error(`в интернете фото «${name}» не нашлось`);
  const res = await fetch(found.url, { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36" }, signal });
  if (!res.ok) throw new Error(`фото «${name}» не скачалось: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const looks = await claudeJson<{ real?: boolean }>(
    "Перед тобой картинка. Ответь, настоящая ли это фотография живого человека, где хорошо видно его лицо (не рисунок, не коллаж, не скриншот с текстом, не логотип). Ответ — только JSON: {\"real\":true}",
    `Фото ${name}`,
    { task: "news-avatar", effort: "low", images: [{ base64: buf.toString("base64"), mediaType: res.headers.get("content-type")?.includes("png") ? "image/png" : "image/jpeg" }] },
  ).catch(() => ({ real: false }));
  if (!looks.real) throw new Error(`найденная картинка «${name}» — не фото человека`);
  const tmp = `${out}.src`;
  fs.writeFileSync(tmp, buf);
  // любой формат (webp, png) — в jpg 900×900 по центру, как фото из Википедии
  await new Promise<void>((resolve, reject) => execFile("ffmpeg", ["-v", "error", "-y", "-i", tmp, "-vf", "scale=900:900:force_original_aspect_ratio=increase,crop=900:900", "-q:v", "2", out], { windowsHide: true }, (e) => (e ? reject(e) : resolve())));
  fs.rmSync(tmp, { force: true });
  return { w: 900, h: 900, credit: `Фото: ${found.page ?? found.url}` };
}

/**
 * Фото человека: из английской Википедии (размер и подпись «Фото: автор, лицензия»), без статьи — аватар его канала, если
 * там лицо, иначе — найденное в интернете. about — кто он, для поиска («блогер, накладывал трек на клипы»).
 */
export async function portrait(name: string, out: string, signal?: AbortSignal, about = ""): Promise<{ w: number; h: number; credit: string }> {
  try {
    return await wikiPortrait(name, out, signal);
  } catch (error) {
    try {
      return await channelAvatar(name, out, signal);
    } catch {
      return webPortrait(name, about, out, signal).catch(() => {
        throw error;
      });
    }
  }
}

async function wikiPortrait(name: string, out: string, signal?: AbortSignal): Promise<{ w: number; h: number; credit: string }> {
  let page = await summary(name, signal).catch(() => null);
  if (!page?.originalimage) {
    // статья названа иначе — первая по поиску
    const found = await get<{ query?: { search?: { title: string }[] } }>(`https://en.wikipedia.org/w/api.php?action=query&list=search&format=json&srlimit=1&srsearch=${encodeURIComponent(name)}`, signal);
    const title = found.query?.search?.[0]?.title;
    if (!title) throw new Error(`в Википедии нет статьи «${name}»`);
    page = await summary(title, signal);
  }
  const src = page.originalimage?.source;
  // фото не с Викисклада — это «добросовестное использование» английской Википедии, в ролик его не берём
  if (!src?.includes("/wikipedia/commons/")) throw new Error(`у статьи «${page.title ?? name}» нет свободного фото`);
  const file = decodeURIComponent(new URL(src).pathname.split("/").pop()!);
  const info = await get<Info>(`https://commons.wikimedia.org/w/api.php?action=query&format=json&prop=imageinfo&iiprop=url|size|extmetadata&iiurlwidth=900&titles=${encodeURIComponent(`File:${file}`)}`, signal);
  const ii = Object.values(info.query.pages)[0]?.imageinfo?.[0];
  const license = strip(ii?.extmetadata?.LicenseShortName?.value);
  if (!ii?.thumburl || !FREE.test(license)) throw new Error(`фото «${file}» не со свободной лицензией (${license || "лицензии нет"})`);
  const res = await fetch(ii.thumburl, { headers: { "User-Agent": UA }, signal });
  if (!res.ok) throw new Error(`фото не скачалось: ${res.status}`);
  fs.writeFileSync(out, Buffer.from(await res.arrayBuffer()));
  const artist = strip(ii.extmetadata?.Artist?.value).slice(0, 60) || "Wikimedia Commons";
  return { w: ii.thumbwidth ?? 0, h: ii.thumbheight ?? 0, credit: `Фото: ${artist}, ${license}` };
}
