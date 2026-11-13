import fs from "fs";
import path from "path";
import crypto from "crypto";
import { brandDir, isBrandFile } from "./design";
import { accountAccessToken, findInstagramAccount, toPublishAccount } from "./account";
import { extensionFor, sniffImage } from "./imageFile";
import { IG_API_VERSION } from "./limits";
import { redact } from "./instagram";
import { writeFileAtomic } from "./store";

/**
 * Шапка слайда — ник и настоящая аватарка аккаунта Instagram, куда выходит карусель (активный в
 * Настройках). Берутся через API подключённого аккаунта (username, profile_picture_url — scope
 * instagram_business_basic) и хранятся в data/carousels/brand: аватарка — по отпечатку содержимого,
 * поэтому сменилась картинка — новый файл, и слайды пересобираются. Проверка не чаще раза в 6 часов.
 * Нет аккаунта — нет и аватарки; сеть подвела — остаётся последняя сохранённая.
 */

export type IgProfile = { accountId: string; username: string; avatarFile: string | null; checkedAt: string };

const REFRESH_MS = 6 * 3600_000;
const profileFile = () => path.join(brandDir(), "instagram-profile.json");

export function readIgProfile(): IgProfile | null {
  try {
    const p = JSON.parse(fs.readFileSync(profileFile(), "utf8"));
    if (typeof p?.accountId !== "string" || typeof p?.username !== "string" || !p.username) return null;
    return { accountId: p.accountId, username: p.username, avatarFile: isBrandFile(p.avatarFile) ? p.avatarFile : null, checkedAt: String(p.checkedAt ?? "") };
  } catch {
    return null;
  }
}

type Deps = { fetch?: typeof fetch; now?: () => number; force?: boolean };

/** Профиль активного аккаунта: свежий из API или сохранённый. Ошибки сети не мешают сборке слайдов. */
export async function refreshIgProfile(deps: Deps = {}): Promise<IgProfile | null> {
  const now = deps.now ?? Date.now;
  const doFetch = deps.fetch ?? fetch;
  const account = findInstagramAccount(null, now());
  if (!account) return null;
  const saved = readIgProfile();
  const same = saved?.accountId === account.id ? saved : null;
  if (same && !deps.force && now() - Date.parse(same.checkedAt) < REFRESH_MS && (!same.avatarFile || fs.existsSync(path.join(brandDir(), same.avatarFile)))) return same;
  try {
    const token = await accountAccessToken(toPublishAccount(account), { fetch: doFetch, now });
    const base = account.via === "ig" ? `https://graph.instagram.com/${IG_API_VERSION}/me` : `https://graph.facebook.com/${IG_API_VERSION}/${account.igUserId}`;
    const res = await doFetch(`${base}?fields=username,profile_picture_url&access_token=${encodeURIComponent(token)}`, { signal: AbortSignal.timeout(20_000) });
    const json: any = await res.json().catch(() => null);
    if (!res.ok || typeof json?.username !== "string" || !json.username) throw new Error(redact(JSON.stringify(json?.error ?? json ?? res.status)).slice(0, 200));
    let avatarFile: string | null = null;
    if (typeof json.profile_picture_url === "string" && /^https:\/\//.test(json.profile_picture_url)) {
      const pic = await doFetch(json.profile_picture_url, { signal: AbortSignal.timeout(20_000) });
      const buffer = Buffer.from(await pic.arrayBuffer());
      const mime = pic.ok ? sniffImage(buffer) : null;
      if (mime && buffer.length < 4 * 1024 * 1024) {
        avatarFile = `avatar-${crypto.createHash("sha256").update(buffer).digest("hex").slice(0, 16)}.${extensionFor(mime)}`;
        fs.mkdirSync(brandDir(), { recursive: true });
        const full = path.join(brandDir(), avatarFile);
        if (!fs.existsSync(full)) writeFileAtomic(full, buffer);
      }
    }
    const profile: IgProfile = { accountId: account.id, username: json.username, avatarFile: avatarFile ?? same?.avatarFile ?? null, checkedAt: new Date(now()).toISOString() };
    fs.mkdirSync(brandDir(), { recursive: true });
    writeFileAtomic(profileFile(), JSON.stringify(profile, null, 2));
    return profile;
  } catch (e) {
    console.warn(`Карусели: профиль Instagram не обновлён — ${String((e as Error)?.message ?? e).slice(0, 200)}`);
    return same;
  }
}
