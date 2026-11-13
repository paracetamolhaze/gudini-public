import data from "./telegramChannel.json";

/**
 * Закрытый Telegram-канал владельца для финала карусели: вход только по приглашению, поэтому на
 * последнем слайде — QR со ссылкой-приглашением, а не ник. Файл — копия studio3d/src/channel.json:
 * матрицу QR там пишет studio3d/scripts/channel-qr.py и сам проверяет декодером. Сменилась ссылка —
 * перегенерировать там и скопировать файл сюда; тест сверяет копию с источником, если тот рядом.
 */
export type TelegramChannel = { name: string; tag: string; about: string; url: string; qr: string[] };

function valid(c: any): c is TelegramChannel {
  const rows: unknown = c?.qr;
  return (
    typeof c?.name === "string" &&
    typeof c?.url === "string" &&
    /^https:\/\/t\.me\//.test(c.url) &&
    Array.isArray(rows) &&
    rows.length >= 21 &&
    rows.every((r) => typeof r === "string" && r.length === rows.length && /^[01]+$/.test(r))
  );
}

export const TELEGRAM_CHANNEL: TelegramChannel | null = valid(data) ? { name: data.name, tag: data.tag ?? "", about: data.about ?? "", url: data.url, qr: data.qr } : null;

/** «Алексей Гудов | FX GOLD» — как канал называется в Telegram. */
export const channelTitle = (c: Pick<TelegramChannel, "name" | "tag">) => [c.name, c.tag].filter(Boolean).join(" | ");
