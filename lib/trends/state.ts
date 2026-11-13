import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { MadeIndex, MadeProject, TrendAccount, TrendsState } from "./types";

export const TRENDS_DIR = path.join(process.cwd(), "data", "trends");
export const BROWSER_DIR = path.join(TRENDS_DIR, "browser");
export const PROFILE_DIR = path.join(BROWSER_DIR, "profile");
export const CARDS_DIR = path.join(TRENDS_DIR, "cards");

const STATE_FILE = path.join(TRENDS_DIR, "state.json");
const ACCOUNTS_FILE = path.join(TRENDS_DIR, "accounts.json");
const MADE_FILE = path.join(TRENDS_DIR, "made.json");

const empty = (): TrendsState => ({ runs: [], cards: [], browser: { connected: false } });

/** Атомарная запись: читатель в другом процессе видит либо старый файл, либо новый целиком. */
function writeJson(file: string, data: unknown) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${crypto.randomBytes(4).toString("hex")}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 1), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

function readJson<T>(file: string, fallback: () => T): T {
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    return fallback();
  }
  // испорченный файл — ошибка, а не пустой список: иначе следующая запись стёрла бы всё накопленное
  return JSON.parse(raw) as T;
}

/** Прогоны и карточки. Пишет только контейнер gudini-ig-browser, сайт читает. */
export const readTrendsState = (): TrendsState => ({ ...empty(), ...readJson(STATE_FILE, empty) });
export const writeTrendsState = (state: TrendsState) => writeJson(STATE_FILE, state);

/** Список аккаунтов владельца. Пишет только сайт. null — файла ещё нет. */
export const readAccountsFile = (): TrendAccount[] | null => readJson<TrendAccount[] | null>(ACCOUNTS_FILE, () => null);
export const writeAccountsFile = (accounts: TrendAccount[]) => writeJson(ACCOUNTS_FILE, accounts);

/** Какие встроенные наборы аккаунтов уже добавлены: убранный владельцем аккаунт не возвращается. Пишет сайт. */
const SEEDED_FILE = path.join(TRENDS_DIR, "seeded.json");
export const readSeeded = (): string[] => readJson<string[]>(SEEDED_FILE, () => []);
export const writeSeeded = (sets: string[]) => writeJson(SEEDED_FILE, sets);

/** Когда каждый аккаунт читали последний раз — по прогонам контейнера; очередь чтения берёт самых давних. */
export function lastReadAt(state = readTrendsState()): Map<string, string> {
  const at = new Map<string, string>();
  for (const run of state.runs) for (const read of run.reads) if ((at.get(read.accountId) ?? "") < read.at) at.set(read.accountId, read.at);
  return at;
}

/** Проекты, созданные из карточек. Пишет только сайт. */
export const readMade = (): MadeIndex => readJson<MadeIndex>(MADE_FILE, () => ({}));
export function addMade(cardKey: string, made: MadeProject) {
  const index = readMade();
  (index[cardKey] ??= []).push(made);
  writeJson(MADE_FILE, index);
}

const KEY_RE = /^(instagram|youtube):([A-Za-z0-9_-]{5,40})$/;
export const isCardKey = (v: unknown): v is string => typeof v === "string" && KEY_RE.test(v);

/** Папка карточки: «instagram:ABC» → cards/instagram-ABC; ключ проверяется до обращения к диску. */
export function cardDir(key: string): string {
  if (!isCardKey(key)) throw new Error("Недопустимый ключ карточки");
  const dir = path.resolve(CARDS_DIR, key.replace(":", "-"));
  if (path.dirname(dir) !== path.resolve(CARDS_DIR)) throw new Error("Недопустимый ключ карточки");
  return dir;
}

export const FRAME_RE = /^frame-[1-4]\.jpg$/;
