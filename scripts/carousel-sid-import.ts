/**
 * Перенос готовых каруселей формата @siddhantt.ai в раздел: npx tsx scripts/carousel-sid-import.ts <папка> [<папка> …]
 * В каждой папке — 01.png … 09.png, caption.txt и meta.json (см. lib/carousel/sid/importReady.ts).
 * Повторный запуск ту же карусель второй раз не создаёт.
 */
import { importReady } from "../lib/carousel/sid/importReady";

(async () => {
  const dirs = process.argv.slice(2);
  if (!dirs.length) throw new Error("Укажите папки с готовыми каруселями");
  for (const dir of dirs) {
    const r = await importReady(dir);
    console.log(`${dir}: ${r.created ? "добавлена" : "уже была"} ${r.id}`);
  }
})().catch((e) => {
  console.error(String(e?.message ?? e));
  process.exit(1);
});
