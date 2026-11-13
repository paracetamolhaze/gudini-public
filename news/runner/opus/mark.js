// Выполняется в странице (assets.ts screen): находит фразу и обводит её маркером прямо в тексте — span вокруг каждого
// куска фразы, поэтому маркер едет вместе со строкой, когда подгружаются картинки. Из нескольких совпадений берётся
// видимое в теле статьи: заголовок лучше абзаца, абзац лучше «хлебных крошек», меню и подвала. Пробелы и кавычки
// сравниваются без разницы в написании, но каждый символ сравнения помнит своё место в узле текста.
(phrase) => {
  const fold = (c) => (/[\s ]/.test(c) ? " " : /[«»"“”„]/.test(c) ? '"' : /[‘’]/.test(c) ? "'" : /[–—]/.test(c) ? "-" : c.toLowerCase());
  const want = [...phrase.trim()].map(fold).join("").replace(/ +/g, " ");
  if (!want) return false;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const nodes = [];
  const map = [];
  let all = "";
  let space = true;
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const el = n.parentElement;
    if (!el || el.closest("script,style,noscript")) continue;
    const k = nodes.push(n) - 1;
    const text = n.textContent || "";
    for (let i = 0; i < text.length; i++) {
      const c = fold(text[i]);
      if (c === " ") {
        if (space) continue;
        space = true;
      } else space = false;
      all += c;
      map.push([k, i]);
    }
  }
  // меню, крошки, бегущая строка, подвал — не тело статьи; классы body и html не в счёт (у Википедии там «menu»), шапка
  // статьи внутри article — в счёт (заголовок часто лежит в ней)
  const outside = (el) => {
    for (let x = el; x && x !== document.body && x !== document.documentElement; x = x.parentElement) {
      if (x.matches("nav,aside,[aria-hidden=true]") || (x.matches("header,footer") && !x.closest("article,main"))) return true;
      const c = typeof x.className === "string" ? x.className.toLowerCase() : "";
      if (/breadcrumb|ticker|(^|[\s_-])menu([\s_-]|$)/.test(c)) return true;
    }
    return false;
  };
  let best = null;
  for (let at = all.indexOf(want); at >= 0; at = all.indexOf(want, at + 1)) {
    const [k0, s] = map[at];
    const [k1, e] = map[at + want.length - 1];
    const el = nodes[k0].parentElement;
    if (el.checkVisibility && !el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    if (outside(el)) continue;
    const score = (el.closest("h1,h2") ? 3 : 0) + (el.closest("article,main,[role=main],[class*=content i],[class*=article i]") ? 1 : 0);
    if (!best || score > best.score) best = { k0, s, k1, e: e + 1, score };
  }
  if (!best) return false;
  // с конца: обёртка куска не сдвигает начало следующих узлов
  for (let k = best.k1; k >= best.k0; k--) {
    const n = nodes[k];
    const len = (n.textContent || "").length;
    const s = k === best.k0 ? best.s : 0;
    const e = k === best.k1 ? best.e : len;
    if (e <= s || !(n.textContent || "").slice(s, e).trim()) continue;
    const r = document.createRange();
    r.setStart(n, s);
    r.setEnd(n, e);
    const span = document.createElement("span");
    span.className = "opus-mark";
    r.surroundContents(span);
  }
  return document.querySelectorAll(".opus-mark").length > 0;
}
