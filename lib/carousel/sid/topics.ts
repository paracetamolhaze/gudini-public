import fs from "fs";
import path from "path";
import { carouselsRoot, withFileLock, writeFileAtomic } from "../store";

/**
 * Список уже сделанных историй: Claude видит его при поиске темы и берёт другую. Первые четыре —
 * одобренные владельцем карусели, собранные вручную до раздела; они в списке всегда.
 */

export type SidTopic = { key: string; title: string; at: string; carouselId?: string };

export const SEED_TOPICS: SidTopic[] = [
  { key: "satoshi-era-coins-noah-doe-lawsuit", title: "Монеты эпохи Сатоши проснулись, на них подали в суд (Noah Doe, 39 069 кошельков, BIP-361)", at: "2026-10-26" },
  { key: "usdt-freeze-blacklist", title: "У USDT есть кнопка «заморозить»: чёрный список Tether, Иран, THORChain, CoinDCX", at: "2026-10-26" },
  { key: "ledger-spy-chip-cryptobilis", title: "Чип-шпион в кошельках Ledger от реселлера CryptoBilis", at: "2026-10-27" },
  { key: "libra-milei-case-dismissed", title: "Дело о токене $LIBRA президента Милея закрыли без допросов", at: "2026-10-27" },
];

const file = () => path.join(carouselsRoot(), "sid-topics.json");

function readSaved(): SidTopic[] {
  try {
    const raw = JSON.parse(fs.readFileSync(file(), "utf8"));
    return Array.isArray(raw) ? raw.filter((t) => t && typeof t.key === "string" && typeof t.title === "string" && typeof t.at === "string") : [];
  } catch {
    return [];
  }
}

/** Все сделанные темы, новые первыми. */
export function readTopics(): SidTopic[] {
  const saved = readSaved();
  const keys = new Set(saved.map((t) => t.key));
  return [...saved, ...SEED_TOPICS.filter((t) => !keys.has(t.key))].sort((a, b) => b.at.localeCompare(a.at));
}

export function addTopic(topic: SidTopic): void {
  fs.mkdirSync(carouselsRoot(), { recursive: true });
  if (!fs.existsSync(file())) writeFileAtomic(file(), "[]");
  withFileLock(file(), () => {
    const list = readSaved().filter((t) => t.key !== topic.key && (!topic.carouselId || t.carouselId !== topic.carouselId));
    list.unshift(topic);
    writeFileAtomic(file(), JSON.stringify(list.slice(0, 500), null, 2));
  });
}
