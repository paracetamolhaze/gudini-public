// Отправить ответы, которые написал Claude: JSON-файл [{ id, text } | { id, skip: "причина" }].
import fs from "node:fs/promises";
import { getInteraction } from "/app/dist/src/db/repos/interactions.js";

const items = JSON.parse(await fs.readFile(process.argv[2], "utf8"));
const base = `http://127.0.0.1:${process.env.PORT ?? 8600}/threads/api`;
const auth = process.env.SITE_PASSWORD ? { authorization: `Basic ${Buffer.from(`claude:${process.env.SITE_PASSWORD}`).toString("base64")}` } : {};

async function call(method, path, body) {
  const res = await fetch(`${base}${path}`, { method, headers: { "content-type": "application/json", ...auth }, body: JSON.stringify(body ?? {}) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${res.status} ${data.error ?? data.message ?? JSON.stringify(data)}`);
  return data;
}

for (const item of items) {
  try {
    if (item.skip) {
      await call("POST", `/replies/${item.id}/skip`, { reason: `Claude: ${item.skip}` });
      console.log(`${item.id}: пропущен (${item.skip})`);
      continue;
    }
    const put = await call("PUT", `/replies/${item.id}`, { text: item.text });
    const blocking = (put.violations ?? []).filter((v) => v.severity === "block" && v.code !== "NOT_RUSSIAN" && v.code !== "WRONG_LANGUAGE");
    if (blocking.length) { console.log(`${item.id}: НЕ отправлен — ${blocking.map((v) => v.message).join("; ")}`); continue; }
    await call("POST", `/replies/${item.id}/send`);
    let status = "APPROVED";
    for (let i = 0; i < 20 && !["SENT", "FAILED", "NEEDS_REVIEW", "SKIPPED"].includes(status); i++) {
      await new Promise((r) => setTimeout(r, 3000));
      const row = await getInteraction(item.id);
      status = row?.status ?? "?";
      if (status === "SENT") console.log(`${item.id}: отправлен ${row.permalink ?? ""}`);
      else if (["FAILED", "NEEDS_REVIEW", "SKIPPED"].includes(status)) console.log(`${item.id}: ${status} — ${row.error ?? row.reason ?? ""}`);
    }
    if (status === "APPROVED" || status === "SENDING") console.log(`${item.id}: в очереди на отправку (лимит или пауза между ответами)`);
  } catch (err) {
    console.log(`${item.id}: ошибка — ${err instanceof Error ? err.message : err}`);
  }
}
process.exit(0);
