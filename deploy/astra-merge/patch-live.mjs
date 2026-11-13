// «Астра» и «Астра v2» — один стиль (владелец 11.11: «астру 1 и 2 объедини»). v2 была надстройкой над первой: те же
// кубики и учебник плюс живые экраны, настоящие страницы, коллажи, концовка и графика через HyperFrames. Теперь так
// монтирует сама «Астра», отдельной карточки v2 в выборе стиля нет.
//
// Живые версии общих файлов лежат в запущенных образах (там правки других разделов, которых нет в git), поэтому
// prepare.sh берёт файлы из контейнеров, а этот скрипт правит их точной заменой строк — как opus/site/patch-live.mjs.
// Каждая правка: from должна найтись ровно count раз (по умолчанию 1), иначе не пишется ничего и сборка останавливается.
// Повторный запуск узнаёт наложенную правку по probe. Переводы строк в from/to — "\n", в файле с CRLF они "\r\n".
//
// Откат без пересборки: переменная окружения ASTRA_SPLIT=1 у воркера — «Астра» снова монтирует по-старому (legacy,
// без HyperFrames); проекты со стилем astra_v2 продолжают идти как v2.
//
//   node patch-live.mjs site <корень> | worker <корень> | --list site|worker
import fs from "node:fs";
import path from "node:path";

const PAGE = "app/project/[id]/page.tsx";

const version = {
  what: "«Астра» монтирует как v2",
  file: "lib/montageStyles.ts",
  from: 'style === "astra_v2" ? "craft-v1" : "legacy";',
  to: 'style !== "astra_v2" && process.env.ASTRA_SPLIT === "1" ? "legacy" : "craft-v1";',
  probe: "ASTRA_SPLIT",
};

export const PATCHES = {
  site: [
    version,
    {
      what: "выбор стиля: одна карточка «Астра»",
      file: PAGE,
      from: '{(["cards", "ai_film", "astra", "astra_v2", "opus"] as const).map((s) => (\n        <button key={s} type="button" className="style-card" aria-pressed={value === s} onClick={() => onChange(s)} disabled={disabled}>',
      to: '{(["cards", "ai_film", "astra", "opus"] as const).map((s) => (\n        <button key={s} type="button" className="style-card" aria-pressed={value === s || (s === "astra" && value === "astra_v2")} onClick={() => { if (!(s === "astra" && value === "astra_v2")) onChange(s); }} disabled={disabled}>',
      probe: 's === "astra" && value === "astra_v2"',
    },
    {
      what: "выбор стиля: сохранённая версия прежней v2 видна на карточке «Астра»",
      file: PAGE,
      from: "{outputs[s] && <div className=\"style-sub\" style={{ color: \"var(--success)\" }}>Есть сохранённая версия</div>}",
      to: "{(outputs[s] || (s === \"astra\" && outputs.astra_v2)) && <div className=\"style-sub\" style={{ color: \"var(--success)\" }}>Есть сохранённая версия</div>}",
      probe: 's === "astra" && outputs.astra_v2',
    },
    { what: "название прежней v2", file: PAGE, from: 'astra_v2: "Астра v2"', to: 'astra_v2: "Астра"', probe: 'astra_v2: "Астра"' },
    {
      what: "подпись карточки «Астра»",
      file: PAGE,
      from: 'astra: "Сцены, списки и звуки от Астры"',
      to: 'astra: "Живые экраны, настоящие страницы, графика и звуки от Астры"',
      probe: "Живые экраны, настоящие страницы",
    },
  ],
  worker: [
    version,
    {
      what: "графика «Астры» идёт через HyperFrames",
      file: "lib/astraEngine.ts",
      from: 'hyperframes: opts.variant === "astra_v2",',
      to: 'hyperframes: astraVersion(opts.variant) === "craft-v1",',
      probe: 'hyperframes: astraVersion(opts.variant) === "craft-v1",',
    },
  ],
};

const count = (text, needle) => text.split(needle).length - 1;

function main() {
  const [mode, arg] = process.argv.slice(2);
  if (mode === "--list") {
    console.log([...new Set(PATCHES[arg].map((p) => p.file))].join("\n"));
    return;
  }
  const patches = PATCHES[mode];
  if (!patches || !arg) throw new Error("node patch-live.mjs site|worker <корень> | --list site|worker");
  const texts = new Map();
  for (const p of patches) {
    const file = path.join(arg, p.file);
    if (!texts.has(file)) texts.set(file, fs.readFileSync(file, "utf8"));
    const text = texts.get(file);
    const eol = text.includes("\r\n") ? "\r\n" : "\n";
    const from = p.from.replaceAll("\n", eol), to = p.to.replaceAll("\n", eol);
    if (text.includes(p.probe) && count(text, from) === 0) { console.log(`= уже наложено: ${p.what}`); continue; }
    const found = count(text, from);
    if (found !== (p.count ?? 1)) throw new Error(`✖ ${p.what}: в ${p.file} строка найдена ${found} раз, нужно ${p.count ?? 1}`);
    texts.set(file, text.replaceAll(from, to));
    console.log(`+ ${p.what}`);
  }
  for (const [file, text] of texts) fs.writeFileSync(file, text);
}

main();
