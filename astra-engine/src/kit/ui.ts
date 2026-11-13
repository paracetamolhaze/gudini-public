import type { Palette } from "../design";
import { ICONS } from "./icons";

/**
 * Poses of the channel's mascot, drawn once and kept in public/astra-ui/mascot/<pose>.png:
 * the same character in every video, like a creator's recurring sticker.
 */
export const MASCOT_POSES = ["hi", "point", "think", "shock", "happy", "sad", "key", "phone"] as const;
export type MascotPose = (typeof MASCOT_POSES)[number];
export const mascotFile = (pose: MascotPose) => `astra-ui/mascot/${pose}.png`;
/** The asset key under which a job lists the mascot pictures it has. */
export const mascotKey = (pose: MascotPose) => `mascot:${pose}`;

const svgUrl = (svg: string) => `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;

/** Line icons of the kit as CSS masks: `<i class="ui-i i-wallet"></i>` takes the color of its text. */
let iconRules: string | null = null;
function icons(): string {
  if (iconRules) return iconRules;
  iconRules = Object.entries(ICONS).flatMap(([name, Icon]) => {
    // A Lucide component renders its own outline list: read it without rendering the component.
    const node = (Icon as unknown as { render?: (props: object, ref: null) => { props?: { iconNode?: [string, Record<string, string>][] } } })
      .render?.({}, null)?.props?.iconNode;
    if (!node) return [];
    const shapes = node.map(([tag, attrs]) => `<${tag} ${Object.entries(attrs).filter(([k]) => k !== "key").map(([k, v]) => `${k}="${v}"`).join(" ")}/>`).join("");
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${shapes}</svg>`;
    return [`.i-${name}{--i:${svgUrl(svg)}}`];
  }).join("");
  return iconRules;
}

/** The pointer of a desktop: black arrow with a white edge; its tip is the top left corner of the element. */
const CURSOR = svgUrl(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 34"><path d="M2 2 L2 27.5 L8.3 21.4 L12.6 31.2 L16.8 29.4 L12.6 19.9 L21 19.9 Z" fill="#111" stroke="#fff" stroke-width="2.2" stroke-linejoin="round"/></svg>`);
const ARROW_UP = svgUrl(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>`);
const CHECK = svgUrl(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>`);
const ALERT = svgUrl(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="3.4" stroke-linecap="round"><path d="M12 5v9M12 19.2v.1"/></svg>`);

/**
 * Ready interface parts for Graphic: windows, a phone, a chat input with a caret, a pointer that clicks, switches,
 * pop-ups, a terminal, a highlighter and a focus ring — the vocabulary of a screen being used on camera.
 * Colors come from the video's palette variables, so every part sits in the video's look.
 * `file` turns a public-folder path into a URL the renderer can load (the mascot pictures).
 */
export function uiCss(p: Palette, file: (path: string) => string): string {
  const dark = p.mode === "dark";
  const shadow = dark ? "0 30px 70px rgba(0,0,0,.55),0 2px 0 rgba(255,255,255,.04) inset" : "0 28px 60px rgba(60,48,30,.16),0 6px 16px rgba(60,48,30,.08)";
  const shadowSm = dark ? "0 14px 34px rgba(0,0,0,.45)" : "0 12px 28px rgba(60,48,30,.12)";
  const mascot = MASCOT_POSES.map(pose => `.ui-mascot.${pose}{background-image:url("${file(mascotFile(pose))}")}`).join("");
  return `
.ui-window{position:relative;background:var(--surface);border:1.5px solid var(--line);border-radius:34px;box-shadow:${shadow};overflow:hidden;min-width:760px;max-width:960px;text-align:left}
.ui-bar{display:flex;align-items:center;height:74px;padding:0 28px;border-bottom:1.5px solid var(--line);font:600 28px var(--sans);color:var(--muted);gap:14px}
.ui-bar::before{content:"";flex:none;width:18px;height:18px;border-radius:50%;background:#FF5F57;box-shadow:30px 0 0 #FEBC2E,60px 0 0 #28C840;margin-right:66px}
.ui-url{flex:1;text-align:center;margin-right:84px;padding:10px 24px;border-radius:999px;background:var(--faint);font:500 27px var(--sans);color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ui-body{padding:34px 40px;display:flex;flex-direction:column;gap:24px;font:500 36px var(--sans)}
.ui-card{position:relative;background:var(--surface);border:1.5px solid var(--line);border-radius:34px;box-shadow:${shadow};padding:32px 40px;text-align:left}
.ui-phone{position:relative;width:330px;height:620px;border-radius:56px;background:#0B0B0D;padding:12px;box-shadow:${shadow};flex:none}
.ui-phone::before{content:"";position:absolute;top:24px;left:50%;width:96px;height:28px;margin-left:-48px;border-radius:14px;background:#000;z-index:3}
.ui-screen{position:relative;width:100%;height:100%;border-radius:46px;background:var(--bg);overflow:hidden;display:flex;flex-direction:column;gap:14px;padding:68px 20px 22px;font:600 28px var(--sans);color:var(--text)}
.ui-app{display:flex;align-items:center;gap:14px;font:700 32px var(--sans)}
.ui-avatar{flex:none;width:68px;height:68px;border-radius:50%;background:var(--accent);color:var(--on-accent);display:grid;place-items:center;font:700 32px var(--sans)}
.ui-msg{max-width:84%;padding:16px 22px;border-radius:28px;background:var(--surface);border:1.5px solid var(--line);font:500 28px var(--sans);line-height:1.25}
.ui-msg.out{align-self:flex-end;background:var(--accent);border-color:transparent;color:var(--on-accent)}
.ui-input{display:flex;align-items:center;gap:18px;min-width:760px;padding:20px 20px 20px 36px;border-radius:999px;background:var(--surface);border:1.5px solid var(--line);box-shadow:${shadowSm};font:500 40px var(--sans);text-align:left}
.ui-body .ui-input,.ui-card .ui-input,.ui-screen .ui-input,.ui-body .ui-terminal,.ui-card .ui-terminal{min-width:0;max-width:100%}
.ui-text{flex:1;min-width:0;white-space:nowrap;overflow:hidden;color:var(--text)}
.ui-hint{color:var(--muted)}
.ui-caret{display:inline-block;width:4px;height:1.05em;margin-left:3px;vertical-align:-.14em;background:var(--accent)}
.ui-send{flex:none;width:78px;height:78px;border-radius:50%;background:var(--accent);position:relative}
.ui-send::before{content:"";position:absolute;inset:18px;background:var(--on-accent);-webkit-mask:${ARROW_UP} center/contain no-repeat;mask:${ARROW_UP} center/contain no-repeat}
.ui-btn{display:inline-flex;align-items:center;justify-content:center;gap:16px;height:96px;padding:0 52px;border-radius:28px;background:var(--accent);color:var(--on-accent);font:700 38px var(--sans);white-space:nowrap}
.ui-btn.ghost{background:transparent;color:var(--text);border:2px solid var(--line)}
.ui-btn.bad{background:var(--bad);color:#fff}
.ui-chip{display:inline-flex;align-items:center;gap:10px;height:58px;padding:0 26px;border-radius:999px;background:var(--faint);color:var(--text);font:600 28px var(--sans);white-space:nowrap}
.ui-chip.accent{background:var(--accent);color:var(--on-accent)}
.ui-chip.good{background:var(--good);color:#fff}
.ui-chip.bad{background:var(--bad);color:#fff}
.ui-cursor{position:absolute;z-index:30;width:66px;height:94px;background:${CURSOR} 0 0/contain no-repeat;filter:drop-shadow(0 6px 8px rgba(0,0,0,.35));transform-origin:6px 6px}
.ui-click{position:absolute;left:-44px;top:-44px;width:100px;height:100px;border-radius:50%;border:7px solid var(--accent);opacity:0}
.ui-toggle{position:relative;flex:none;width:140px;height:80px;border-radius:40px;background:${dark ? "#3A3D45" : "#D9DCE1"}}
.ui-knob{position:absolute;top:8px;left:8px;width:64px;height:64px;border-radius:50%;background:#fff;box-shadow:0 3px 9px rgba(0,0,0,.28)}
.ui-setting{display:flex;align-items:center;justify-content:space-between;gap:34px;font:600 38px var(--sans)}
.ui-toast{display:grid;grid-template-columns:72px auto;column-gap:24px;align-items:center;padding:24px 38px 24px 24px;border-radius:32px;background:var(--surface);border:1.5px solid var(--line);box-shadow:${shadow};font:700 36px var(--sans);line-height:1.2;text-align:left;max-width:940px}
.ui-toast small{grid-column:2;margin-top:4px;font:500 28px var(--sans);color:var(--muted)}
.ui-toast::before{content:"";grid-row:1 / span 2;width:72px;height:72px;border-radius:50%;background:var(--bad) ${ALERT} center/34px no-repeat}
.ui-toast.bad{border-color:${dark ? "rgba(255,90,95,.45)" : "rgba(229,72,77,.35)"};background:${dark ? "#2A1517" : "#FFF1F1"}}
.ui-toast.good::before{background:var(--good) ${CHECK} center/36px no-repeat}
.ui-toast.info::before{background:var(--accent) ${ALERT} center/34px no-repeat}
.ui-terminal{position:relative;background:#111215;color:#E9E7E2;border:1.5px solid #2A2C32;border-radius:30px;padding:30px 38px;font:500 32px var(--mono);line-height:1.45;box-shadow:${shadow};min-width:760px;text-align:left}
.ui-terminal .ui-line{white-space:pre}
.ui-prompt{color:var(--accent)}
.ui-ok{color:#3DD68C}
.ui-err{color:#FF6B6B}
.ui-mark{background:linear-gradient(transparent 52%,#FFD43B 52%,#FFD43B 92%,transparent 92%) no-repeat 0 0/0% 100%;padding:0 .1em;margin:0 -.1em}
.ui-ring{position:absolute;z-index:25;border:9px solid #FFD43B;border-radius:50%;box-shadow:0 0 36px rgba(255,212,59,.45)}
.ui-row{display:flex;align-items:center;gap:22px;font:600 38px var(--sans);text-align:left}
.ui-box{position:relative;flex:none;width:54px;height:54px;border-radius:50%;border:3px solid var(--line)}
.ui-tick{position:absolute;inset:-3px;border-radius:50%;background:var(--good) ${CHECK} center/32px no-repeat}
.ui-track{position:relative;width:720px;height:24px;border-radius:12px;background:var(--faint);overflow:hidden}
.ui-fill{position:absolute;inset:0;background:var(--accent);transform-origin:0 50%}
.ui-big{font:700 190px var(--display);line-height:.92;color:var(--text);letter-spacing:-1px}
.ui-label{font:600 34px var(--sans);color:var(--muted)}
.ui-i{display:inline-block;flex:none;width:1em;height:1em;background:currentColor;-webkit-mask:var(--i) center/contain no-repeat;mask:var(--i) center/contain no-repeat;vertical-align:-.14em}
.ui-mascot{flex:none;width:260px;height:260px;background:url("${file(mascotFile("hi"))}") center bottom/contain no-repeat;filter:drop-shadow(0 18px 22px rgba(0,0,0,${dark ? ".5" : ".18"}))}
.ui-iso{position:relative;flex:none;width:calc(var(--size,520)*1px);height:calc(var(--size,520)*1px);transform:rotateX(55deg) rotateZ(45deg);transform-style:preserve-3d}
.ui-iso *{--x:0;--y:0;--z:0}
.iso-box .ui-i{font-size:64px}
.ui-iso .iso-box,.ui-iso .iso-disc,.ui-iso .iso-group{position:absolute;left:calc(var(--x,0)*1px);top:calc(var(--y,0)*1px);transform-style:preserve-3d}
.iso-group{width:0;height:0;transform:translateZ(calc(var(--z,0)*1px))}
.iso-box{--c:var(--surface);--side:color-mix(in srgb,var(--c) 80%,#1B1F2A);--dark:color-mix(in srgb,var(--c) 60%,#1B1F2A);--edge:color-mix(in srgb,var(--c) 42%,#1B1F2A);width:calc(var(--w,120)*1px);height:calc(var(--d,120)*1px);transform:translateZ(calc((var(--z,0) + var(--h,40))*1px));background:var(--c);box-shadow:0 0 0 1.5px var(--edge) inset;display:grid;place-items:center;font:700 30px var(--sans);color:var(--edge)}
.iso-box::before{content:"";position:absolute;left:0;top:100%;width:100%;height:calc(var(--h,40)*1px);background:var(--side);box-shadow:0 0 0 1.5px var(--edge) inset;transform-origin:50% 0;transform:rotateX(-90deg)}
.iso-box::after{content:"";position:absolute;left:100%;top:0;width:calc(var(--h,40)*1px);height:100%;background:var(--dark);box-shadow:0 0 0 1.5px var(--edge) inset;transform-origin:0 50%;transform:rotateY(90deg)}
.iso-box.accent{--c:var(--accent);color:var(--on-accent)}
.iso-box.good{--c:var(--good);color:#fff}
.iso-box.bad{--c:var(--bad);color:#fff}
.iso-box.dim{--c:${dark ? "#2B2E36" : "#E7E2D8"}}
.iso-box.floor{--h:6;--c:${dark ? "#1D1F25" : "#EFEAE0"}}
.iso-disc{--c:#F2B544;--edge:color-mix(in srgb,var(--c) 50%,#1B1F2A);width:calc(var(--r,36)*2px);height:calc(var(--r,36)*2px);border-radius:50%;transform:translateZ(calc((var(--z,0) + var(--h,10))*1px));background:var(--c);box-shadow:0 0 0 1.5px var(--edge) inset,0 0 0 7px color-mix(in srgb,var(--c) 86%,#fff) inset,0 0 0 8.5px var(--edge) inset}
.iso-disc::before,.iso-disc::after{content:"";position:absolute;inset:0;border-radius:50%;background:color-mix(in srgb,var(--c) 66%,#1B1F2A);transform:translateZ(calc(var(--h,10)*-1px))}
.iso-disc::after{transform:translateZ(calc(var(--h,10)*-.5px))}
.iso-tag{position:absolute;display:flex;align-items:center;gap:12px;font:600 30px var(--sans);color:var(--text);white-space:nowrap}
.iso-tag::before{content:"";flex:none;width:54px;height:2.5px;background:var(--muted)}
.iso-tag.left{flex-direction:row-reverse}
${mascot}${icons()}`;
}
