import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawn, execFileSync } from "node:child_process";
import ts from "typescript";
import type { AstraInput } from "../src/input";
import { designOf, type Palette } from "../src/design";
import { boardArea, type AuthorLayout } from "../src/kit/board";
import type { GraphicStep } from "../src/kit/Graphic";
import { graphicKey } from "../src/graphicKey";
import { MASCOT_POSES, mascotFile, uiCss } from "../src/kit/ui";
import type { Block } from "./validate";
import { ENGINE_ROOT } from "./workspace";

export type HyperGraphic = { from: number; to: number; html: string; css?: string; motion: GraphicStep[]; author?: AuthorLayout };
const json = (value: unknown) => JSON.stringify(value).replace(/</g, "\\u003c");

/** Palette attributes are literal by the montage contract; read them without executing generated code. */
export function montagePalette(code: string, input: AstraInput): Palette {
  const source = ts.createSourceFile("Montage.tsx", code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const attrs: Record<string, string> = {};
  const visit = (node: ts.Node) => {
    if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && node.tagName.getText(source) === "AstraVideo") {
      for (const a of node.attributes.properties) if (ts.isJsxAttribute(a) && a.initializer) {
        const v = ts.isJsxExpression(a.initializer) ? a.initializer.expression : a.initializer;
        if (v && ts.isStringLiteral(v)) attrs[a.name.getText(source)] = v.text;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return designOf(attrs.palette, attrs.accent === "scene" ? input.sceneColor : attrs.accent).palette;
}

/** Offline, seekable HyperFrames composition. Generated text never becomes executable JS. */
export function graphicDocument(g: HyperGraphic, palette: Palette, fps: number, fonts: string, ui = ""): string {
  const { area } = boardArea(g.author ?? "split");
  const duration = (Math.round(g.to * fps) - Math.round(g.from * fps)) / fps;
  const vars = Object.entries(palette).filter(([, v]) => typeof v === "string").map(([k, v]) => `--${k.replace(/[A-Z]/g, c => '-' + c.toLowerCase())}:${v};`).join("");
  const css = (g.css ?? "").replace(/:host/g, "#graphic");
  if (/<\/(?:style|script)/i.test(css) || /<script\b/i.test(g.html)) throw new Error("Unsafe HyperFrames graphic markup");
  return `<!doctype html><html><head><meta charset="utf-8"><style>${fonts}
html,body{margin:0;width:${area.w}px;height:${area.h}px;background:transparent;overflow:hidden}
*{box-sizing:border-box}#graphic{position:absolute;inset:0;overflow:hidden;${vars}--display:"Oswald","Anton",sans-serif;--heavy:"Montserrat",sans-serif;--sans:"Inter",sans-serif;--serif:"Playfair Display",serif;--mono:"JetBrains Mono",monospace;--hand:"Caveat",cursive;color:var(--text);font-family:var(--sans);font-size:44px;line-height:1.15}
.stage{position:absolute;inset:0;display:flex;align-items:center;justify-content:center}${ui}${css}</style></head><body>
<div id="graphic" data-composition-id="main" data-start="0" data-duration="${duration}" data-width="${area.w}" data-height="${area.h}" data-fps="${fps}"><div class="stage">${g.html}</div></div>
${["gsap", "DrawSVGPlugin", "MorphSVGPlugin", "SplitText", "TextPlugin"].map(name => `<script src="${name}.min.js"></script>`).join("")}
<script>
gsap.registerPlugin(DrawSVGPlugin,MorphSVGPlugin,SplitText,TextPlugin);
const root=document.getElementById('graphic'),tl=gsap.timeline({paused:true});
const steps=${json(g.motion)},start=${Math.round(g.from * fps) / fps};
const resolve=v=>Object.fromEntries(Object.entries(v||{}).filter(([k])=>!/^on/i.test(k)).map(([k,v])=>[k,k==='morphSVG'&&typeof v==='string'?(root.querySelector(v)||v):v]));
for(const s of steps){let targets=Array.from(root.querySelectorAll(s.sel));if(!targets.length)continue;
const at=Math.max(0,s.at-start),timing={duration:s.dur??0.6,ease:s.ease??'power3.out'};
if(s.count){const c=s.count,format=v=>(c.prefix||'')+v.toLocaleString('ru-RU',{minimumFractionDigits:c.decimals||0,maximumFractionDigits:c.decimals||0})+(c.suffix||'');
targets.forEach((el,i)=>{const proxy={v:c.from};el.textContent=format(c.from);tl.to(proxy,{v:c.to,...timing,onUpdate:()=>el.textContent=format(proxy.v)},at+i*(s.stagger||0));});continue;}
if(s.split){const split=new SplitText(targets,{type:s.split});targets=s.split==='chars'?split.chars:split.words;}
const stagger=s.stagger??(s.split?0.04:0),from=resolve(s.from),to=resolve(s.to);
if(s.from&&s.to)tl.fromTo(targets,from,{...to,...timing,stagger},at);else if(s.from)tl.from(targets,{...from,...timing,stagger},at);else tl.to(targets,{...to,...timing,stagger},at);}
tl.to({}, {duration:${duration}}, 0);window.__timelines={main:tl};
</script></body></html>`;
}

function fontCss(publicDir: string): string {
  return fs.readdirSync(path.join(publicDir, "fonts")).filter(f => /\.(ttf|woff2)$/.test(f)).flatMap(file => {
    let family: string | undefined, weight = "400", style = "normal";
    if (/Oswald/.test(file)) { family = "Oswald"; weight = "700"; }
    else if (/Anton/.test(file)) family = "Anton";
    else if (/Montserrat-Black/.test(file)) { family = "Montserrat"; weight = "900"; }
    else {
      const m = /^(inter|montserrat|playfair-display|jetbrains-mono|caveat)-(cyrillic|latin)-(\d+)-(normal|italic)/.exec(file);
      if (m) { family = ({ inter: "Inter", montserrat: "Montserrat", "playfair-display": "Playfair Display", "jetbrains-mono": "JetBrains Mono", caveat: "Caveat" } as Record<string, string>)[m[1]]; weight = m[3]; style = m[4]; }
    }
    if (!family) return [];
    const subset = file.includes("-cyrillic-") ? "unicode-range:U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116;" : file.includes("-latin-") ? "unicode-range:U+0000-00FF,U+2000-206F,U+20AC;" : "";
    const data = fs.readFileSync(path.join(publicDir, "fonts", file)).toString("base64");
    return [`@font-face{font-family:"${family}";font-weight:${weight};font-style:${style};${subset}src:url(data:font/${file.endsWith(".ttf") ? "ttf" : "woff2"};base64,${data})}`];
  }).join("\n");
}

export async function prepareHyperGraphics(opts: { blocks: Block[]; code: string; input: AstraInput; publicDir: string; workDir: string; log: (line: string) => void }): Promise<AstraInput> {
  const graphics = opts.blocks.filter(b => b.type === "Graphic");
  if (!graphics.length) return opts.input;
  const palette = montagePalette(opts.code, opts.input);
  const fonts = fontCss(opts.publicDir);
  // Interface parts load the mascot pictures from the composition's own folder.
  const ui = uiCss(palette, file => path.basename(file));
  const mascots = MASCOT_POSES.map(pose => path.join(opts.publicDir, mascotFile(pose))).filter(file => fs.existsSync(file));
  const assets = { ...opts.input.assets };
  for (const b of graphics) {
    const g = { ...b.props, from: b.from, to: b.to } as HyperGraphic;
    const html = graphicDocument(g, palette, opts.input.fps, fonts, ui);
    const digest = crypto.createHash("sha256").update("hyperframes-0.8.114\n" + html).digest("hex").slice(0, 24);
    const dir = path.join(opts.workDir, "hyperframes", digest);
    const rel = `hyperframes/${digest}.webm`, out = path.join(opts.publicDir, rel);
    fs.mkdirSync(dir, { recursive: true }); fs.mkdirSync(path.dirname(out), { recursive: true });
    if (!fs.existsSync(out)) {
      fs.writeFileSync(path.join(dir, "index.html"), html);
      for (const name of ["gsap", "DrawSVGPlugin", "MorphSVGPlugin", "SplitText", "TextPlugin"]) fs.copyFileSync(path.join(ENGINE_ROOT, "node_modules", "gsap", "dist", `${name}.min.js`), path.join(dir, `${name}.min.js`));
      if (g.html.includes("ui-mascot")) for (const file of mascots) fs.copyFileSync(file, path.join(dir, path.basename(file)));
      opts.log(`HyperFrames: графика ${b.from.toFixed(1)}–${b.to.toFixed(1)} с`);
      const part = out.replace(/\.webm$/, ".part.webm");
      await new Promise<void>((resolve, reject) => {
        const child = spawn(process.execPath, [path.join(ENGINE_ROOT, "node_modules/hyperframes/bin/hyperframes.mjs"), "render", dir,
          "--format", "webm", "--output", part, "--fps", String(opts.input.fps), "--workers", "1", "--no-browser-gpu"],
          { cwd: ENGINE_ROOT, env: { ...process.env, DO_NOT_TRACK: "1" }, stdio: ["ignore", "pipe", "pipe"] });
        let tail = "";
        const collect = (data: Buffer) => { tail = (tail + data.toString()).slice(-4000); };
        child.stdout.on("data", collect); child.stderr.on("data", collect);
        const timer = setTimeout(() => child.kill(), 10 * 60_000);
        child.on("error", error => { clearTimeout(timer); reject(error); });
        child.on("close", code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(`HyperFrames failed (${code}): ${tail}`)); });
      });
      const probe = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", part], { encoding: "utf8" }));
      const stream = probe.streams.find((s: any) => s.codec_type === "video");
      const { area } = boardArea(g.author ?? "split");
      const expected = (Math.round(g.to * opts.input.fps) - Math.round(g.from * opts.input.fps)) / opts.input.fps;
      if (!stream || stream.width !== area.w || stream.height !== area.h || (stream.tags?.alpha_mode ?? stream.tags?.ALPHA_MODE) !== "1" || Math.abs(Number(probe.format.duration) - expected) > 0.1) throw new Error("HyperFrames output size, alpha or duration did not match the graphic");
      fs.renameSync(part, out);
    }
    assets[graphicKey(g)] = rel;
  }
  return { ...opts.input, assets };
}

