import crypto from "node:crypto";
import { cleanHandle } from "./parse";
import { GLOBAL } from "./global";
import { lastReadAt, readAccountsFile, readSeeded, writeAccountsFile, writeSeeded } from "./state";
import { STARTER } from "./starter";
import { MAX_ACCOUNTS_PER_RUN, ROLES, THEMES, type Role, type Theme, type TrendAccount } from "./types";

/** Список аккаунтов владельца — data/trends/accounts.json, пишет только сайт. */

export class AccountError extends Error {}

const newId = () => Date.now().toString(36) + crypto.randomBytes(3).toString("hex");
const seedId = (prefix: string, i: number) => `${prefix}${i.toString(36)}-${crypto.randomBytes(3).toString("hex")}`;

/**
 * Первый запуск: стартовый набор тем ждёт решения владельца («Оставить» или «Убрать»).
 * Гиганты всех ниш («Глобально») добавляются один раз сразу утверждёнными — так решил владелец 25.10;
 * лишних он убирает сам, и убранные не возвращаются.
 */
export function listAccounts(): TrendAccount[] {
  const at = new Date().toISOString();
  let list = readAccountsFile();
  if (!list) {
    list = STARTER.map((a, i) => ({ ...a, id: seedId("s", i), status: "proposed" as const, addedAt: at }));
    writeAccountsFile(list);
  }
  const seeded = readSeeded();
  if (!seeded.includes("global")) {
    list = [...list, ...GLOBAL.map((a, i) => ({ ...a, id: seedId("g", i), status: "active" as const, addedAt: at }))];
    writeAccountsFile(list);
    writeSeeded([...seeded, "global"]);
  }
  return list;
}

const theme = (v: unknown): Theme => {
  if (!THEMES.includes(v as Theme)) throw new AccountError("Неизвестная тема");
  return v as Theme;
};
const role = (v: unknown): Role => (ROLES.includes(v as Role) ? (v as Role) : "direct");

function handles(body: any) {
  const instagram = body.instagram ? cleanHandle(body.instagram) : null;
  const youtube = body.youtube ? cleanHandle(body.youtube) : null;
  if (body.instagram && !instagram) throw new AccountError("Не похоже на ник Instagram");
  if (body.youtube && !youtube) throw new AccountError("Не похоже на ник канала YouTube");
  if (!instagram && !youtube) throw new AccountError("Укажите ник в Instagram или канал YouTube");
  return { ...(instagram ? { instagram } : {}), ...(youtube ? { youtube } : {}) };
}

const same = (a: TrendAccount, b: { instagram?: string; youtube?: string }) =>
  Boolean((b.instagram && a.instagram?.toLowerCase() === b.instagram.toLowerCase()) || (b.youtube && a.youtube?.toLowerCase() === b.youtube.toLowerCase()));

export function changeAccounts(body: any): TrendAccount[] {
  const list = listAccounts();
  const find = () => {
    const i = list.findIndex((a) => a.id === body?.id);
    if (i < 0) throw new AccountError("Аккаунт не найден");
    return i;
  };
  if (body?.action === "add") {
    const t = theme(body.theme);
    const h = handles(body);
    if (list.some((a) => a.theme === t && same(a, h))) throw new AccountError("Этот аккаунт уже в списке");
    list.push({ id: newId(), theme: t, role: role(body.role), ...h, status: "active", addedAt: new Date().toISOString() });
  } else if (body?.action === "approve") list[find()].status = "active";
  else if (body?.action === "remove") list.splice(find(), 1);
  else throw new AccountError("Неизвестное действие");
  writeAccountsFile(list);
  return list;
}

/**
 * Кого читать в прогоне темы: утверждённые, не больше 100 — сначала ни разу не прочитанные, потом те,
 * кого читали давнее всех. Так список в сотни аккаунтов проходится по очереди, прогон за прогоном.
 */
export function runAccounts(t: Theme, lastRead: Map<string, string> = lastReadAt()): TrendAccount[] {
  const order: Record<Role, number> = { direct: 0, adjacent: 1, outsized: 2 };
  return listAccounts()
    .filter((a) => a.theme === t && a.status === "active")
    .sort((a, b) => (lastRead.get(a.id) ?? "").localeCompare(lastRead.get(b.id) ?? "") || order[a.role] - order[b.role])
    .slice(0, MAX_ACCOUNTS_PER_RUN);
}
