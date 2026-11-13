import React, { useMemo } from "react";
import { AbsoluteFill, Audio, Easing, Img, OffthreadVideo, Sequence, interpolate, spring, staticFile, useCurrentFrame } from "remotion";
import { loadFont } from "@remotion/fonts";
import type { Cover, Look, NewsPlan, OwnerPeek, Segment, Word } from "./plan";

loadFont({ family: "MontserratBlack", url: staticFile("fonts/Montserrat-Black.ttf"), weight: "900" });

import { FPS, FX_FRAMES, HERO_COLOR, LOOP_FRAMES, fr, layout, type Sub } from "./layout";
import { glide, snapSettle, softLand, stage } from "./motion";

export { FPS, layout } from "./layout";
// вставки двигаются по измеренным числам (plan.fx.motion, выключатель «motion» в news/features.json); без него — как раньше
const Motion = React.createContext(false);
const useMotion = () => React.useContext(Motion);
const W = 1080;
const H = 1920;
// верх строки субтитров: ближе к центру, но ниже него (владелец 7.11: «субтитры в новостях нужно чуть поднять, ближе к
// центру но чуть ниже»; до этого 1190). Наклейки, фото, логотип и телефон — над ней
const SUB_LOW = 1040;
// герой на чужом языке слышен тихо под переводом — как в одобренной пробе v4 (0,12); владелец 28.10: «когда озвучивают
// автора, его чуть приглушать нужно, забыл?»
const UNDER_DUB = 0.12;

// плавный вход и выход звука, чтобы на склейках не щёлкало
const fade = (f: number, n: number, v: number) => v * Math.max(0, Math.min(1, f / 2, (n - f) / 2));

// heard — сколько кадров плана звучит: под петлёй в конце звук героя молчит, чтобы не проскочили его следующие слова
// стоп-кадр и наезд внутри куска героя продолжают его кадр: основа куска идёт от 1 до 1,04 за весь кусок
const CLIP_ZOOM = 0.04;
const Covers: React.FC<{ covers?: Cover[]; clip: string; segLen: number; plan: NewsPlan; keepRu?: boolean }> = ({ covers, clip, segLen, plan, keepRu }) => (
  <>
    {(covers ?? []).map((c, k) => {
      const n = Math.max(1, fr(c.to) - fr(c.from));
      const base = (x: number) => 1 + CLIP_ZOOM * Math.min(1, x / segLen);
      const own = c.still !== undefined || c.punch !== undefined;
      // перебивка длиннее остатка клипа замирала на последнем кадре (5.11, верблюды 7–10 с): начинаем её раньше
      const src = c.still ? undefined : c.clip ?? clip;
      const len = src ? plan.clips[src]?.duration : undefined;
      const at = len ? Math.max(0, Math.min(c.at, len - (c.to - c.from) - 0.05)) : c.at;
      const look: Look = own
        ? { clip: src, still: c.still, at, zoomRange: [base(fr(c.from)) * (c.punch ?? 1), base(fr(c.to)) * (c.punch ?? 1)], focusX: c.focusX, focusY: c.focusY }
        : { clip: src, at };
      return (
        <Sequence key={k} from={fr(c.from)} durationInFrames={n}>
          <Visual plan={plan} look={look} frames={n} keepRu={keepRu} />
        </Sequence>
      );
    })}
  </>
);

// keepRu — кусок героя со своим звуком: его русские титры не размываются
const Visual: React.FC<{ look: Look; frames: number; volume?: number; plan: NewsPlan; heard?: number; keepRu?: boolean }> = ({ look, frames, volume = 0, plan, heard = frames, keepRu }) => {
  const f = useCurrentFrame();
  const from = look.zoomRange?.[0] ?? look.zoomFrom ?? 1;
  // скриншот поста или сайта стоит: наезд на него читался как «посты постоянно двигаются вперёд» (владелец 3.11)
  const to = look.zoomRange?.[1] ?? (look.zoomFrom || look.still ? 1 : 1.04);
  // первый кадр начинается крупно и отъезжает к обычному за первую фразу; в спокойном монтаже кадр стоит
  const s = plan.fx?.calm ? 1 : interpolate(f, [0, frames], [from, to], { extrapolateRight: "clamp", easing: look.zoomFrom ? Easing.out(Easing.cubic) : undefined });
  const fy = look.focusY ?? H / 2;
  const ty = Math.min(0, Math.max(H - H * s, fy - fy * s));
  const tx = look.focusX === undefined ? (W - W * s) / 2 : Math.min(0, Math.max(W - W * s, look.focusX - look.focusX * s));
  if (look.phone && look.clip) return <Phone src={plan.clips[look.clip].file} at={look.at ?? 0} badge={plan.badge} />;
  if (look.still && look.sweep?.rects.length && !look.zoomFrom && !look.zoomRange) return <Swept still={look.still} sweep={look.sweep} />;
  // чужие титры героя в эту секунду исходника — размыты вместе с кадром (наезд их не сдвигает)
  const t = (look.at ?? 0) + f / FPS;
  const bands = look.still || !look.clip ? [] : (plan.clips[look.clip].captions ?? []).filter((c) => t >= c.from - 0.1 && t <= c.to + 0.1 && !(keepRu && c.ru));
  return (
    <AbsoluteFill style={{ overflow: "hidden", background: "#000" }}>
      <div style={{ position: "absolute", width: W, height: H, transformOrigin: "0 0", transform: `translate(${tx}px, ${ty}px) scale(${s})` }}>
        {look.still ? (
          <Img src={staticFile(look.still)} style={{ width: W, height: H, objectFit: "cover" }} />
        ) : (
          <OffthreadVideo src={staticFile(plan.clips[look.clip!].file)} trimBefore={fr(look.at ?? 0)} volume={(x) => fade(x, heard, volume)} style={{ width: W, height: H, objectFit: "cover" }} />
        )}
        {/* fill — плашка поверх однотонного поля (заголовок IGN на чёрном): закрашивается цветом поля, размытие оставляло
            красное пятно (владелец 3.11 о GTA: «слишком много шума») */}
        {bands.map((b, i) => {
          const mask = b.fill ? "linear-gradient(transparent, #000 8%, #000 92%, transparent)" : "linear-gradient(transparent, #000 22%, #000 78%, transparent)";
          const look = b.fill ? { background: b.fill } : { backdropFilter: "blur(24px)", WebkitBackdropFilter: "blur(24px)" };
          return <div key={i} style={{ position: "absolute", left: 0, width: W, top: b.y0 * H, height: (b.y1 - b.y0) * H, ...look, maskImage: mask, WebkitMaskImage: mask }} />;
        })}
      </div>
    </AbsoluteFill>
  );
};

/**
 * Страница сайта, по которой на глазах проводят маркером (приём «маркер по слову» из video-shotcraft
 * marker-underline-title: черта идёт 8–12 кадров слева направо, быстро трогается и чуть придерживает конец, начинается
 * через несколько кадров после смены плана — когда страницу уже увидели). Страница стоит (владелец 3.11: снимки не
 * едут), движется только маркер: глаз приходит к строке в ту секунду, когда автор её называет. Кончается план тем же
 * снимком с готовым маркером, что и раньше.
 */
const SWEEP_START = 5;
const SWEEP_LINE = 10;
const Swept: React.FC<{ still: string; sweep: NonNullable<Look["sweep"]> }> = ({ still, sweep }) => {
  const f = useCurrentFrame();
  // строки идут одна за другой; короткая строка проводится быстрее длинной, но не быстрее 4 кадров
  const widest = Math.max(...sweep.rects.map((r) => r.w), 1);
  let at = SWEEP_START;
  const lines = sweep.rects.map((r) => {
    const n = Math.max(4, Math.round((SWEEP_LINE * r.w) / widest));
    const from = at;
    at += n - 1;
    return { r, from, n };
  });
  const done = f >= at + 1;
  return (
    <AbsoluteFill style={{ overflow: "hidden", background: "#000" }}>
      <Img src={staticFile(done ? still : sweep.base)} style={{ position: "absolute", width: W, height: H, objectFit: "cover" }} />
      {!done &&
        lines.map(({ r, from, n }, i) => {
          const k = glide((f - from) / n);
          if (f < from || k <= 0) return null;
          return (
            <div key={i} style={{ position: "absolute", left: r.x, top: r.y, width: r.w * k, height: r.h, overflow: "hidden" }}>
              <Img src={staticFile(still)} style={{ position: "absolute", left: -r.x, top: -r.y, width: W, height: H, maxWidth: "none", objectFit: "cover" }} />
            </div>
          );
        })}
    </AbsoluteFill>
  );
};

// карточка ролика героя на фоне того же ролика, размытого и притемнённого
const Phone: React.FC<{ src: string; at: number; badge?: string }> = ({ src, at, badge }) => {
  const f = useCurrentFrame();
  const motion = useMotion();
  const bounce = spring({ frame: f, fps: FPS, config: { damping: 11, stiffness: 170 } });
  // карточка прилетает чуть увеличенной и садится без отскока
  const land = softLand(f / 12);
  const pose = motion ? `scale(${1.14 - 0.14 * land}) rotate(${(1 - land) * -3}deg)` : `scale(${0.7 + 0.3 * bounce}) rotate(${(1 - bounce) * -6}deg)`;
  return (
    <AbsoluteFill style={{ background: "#000", overflow: "hidden" }}>
      <AbsoluteFill style={{ transform: `scale(${1.25 + f * 0.0015})`, filter: "blur(40px) brightness(0.6) saturate(1.3)" }}>
        <OffthreadVideo src={staticFile(src)} trimBefore={fr(at)} muted style={{ width: W, height: H, objectFit: "cover" }} />
      </AbsoluteFill>
      <AbsoluteFill style={{ background: "radial-gradient(ellipse at 50% 40%, rgba(0,0,0,0) 0%, rgba(0,0,0,0.55) 75%)" }} />
      <div
        style={{
          position: "absolute", left: (W - 500) / 2, top: 130, width: 500, height: 888, borderRadius: 42, overflow: "hidden",
          border: "7px solid #fff", boxShadow: "0 30px 90px rgba(0,0,0,0.6), 0 0 50px rgba(255,255,255,0.25)",
          transform: pose,
        }}
      >
        <OffthreadVideo src={staticFile(src)} trimBefore={fr(at)} muted style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        {badge && <div style={{ position: "absolute", left: 24, bottom: 22, color: "#fff", fontFamily: "Arial", fontWeight: 700, fontSize: 52, textShadow: "0 2px 8px rgba(0,0,0,0.8)" }}>▷ {badge}</div>}
      </div>
    </AbsoluteFill>
  );
};

// зелёная вспышка первой секунды — кадры assets/fx (своя, news/engine/fx.py)
const Burst: React.FC<{ reverse?: boolean }> = ({ reverse }) => {
  const f = useCurrentFrame();
  // обратная — для петли: кадры вспышки от середины к первому, полностью закрытому
  const k = reverse ? LOOP_FRAMES - 1 - f : f;
  if (k < 0 || k >= FX_FRAMES) return null;
  return <Img src={staticFile(`fx/fx_${String(k).padStart(2, "0")}.webp`)} style={{ position: "absolute", inset: 0, width: W, height: H }} />;
};

// «камера» поверх всех планов: толчок на склейке и на акцентных словах, тряска на ударе
const Camera: React.FC<{ cuts: number[]; hits: { t: number; kick?: number; shake?: boolean }[]; calm?: boolean; children: React.ReactNode }> = ({ cuts, hits, calm, children }) => {
  const f = useCurrentFrame();
  let s = 1;
  let x = 0;
  let y = 0;
  let flash = 0;
  for (const c of calm ? [] : cuts) {
    const d = f - fr(c);
    if (d >= 0 && d < 8) {
      s *= 1 + 0.12 * Math.pow(1 - d / 8, 2);
      flash = Math.max(flash, 0.45 * (1 - d / 3));
    }
  }
  for (const h of calm ? [] : hits) {
    const d = f - fr(h.t);
    if (d >= 0 && d < 9 && h.kick) s *= 1 + h.kick * Math.pow(1 - d / 9, 2);
    if (h.shake && d >= 0 && d < 12) {
      const a = 14 * (1 - d / 12);
      x += Math.sin(d * 2.7) * a;
      y += Math.cos(d * 3.3) * a;
    }
  }
  return (
    <AbsoluteFill style={{ overflow: "hidden", background: "#000" }}>
      <AbsoluteFill style={{ transform: `translate(${x}px, ${y}px) scale(${s})` }}>{children}</AbsoluteFill>
      {flash > 0 && <AbsoluteFill style={{ background: "#fff", opacity: flash }} />}
    </AbsoluteFill>
  );
};

const Subtitle: React.FC<{ subs: Sub[] }> = ({ subs }) => {
  const f = useCurrentFrame();
  const t = f / FPS;
  const sub = subs.find((x) => x.from <= t + 0.02 && t < x.to);
  if (!sub) return null;
  const local = f - fr(sub.from);
  const scale = interpolate(local, [0, 2, 5], [0.7, 1.15, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const size = Math.min(100, Math.floor(960 / (sub.text.length * 0.68)));
  const base: React.CSSProperties = { position: "absolute", left: 0, right: 0, top: sub.y, textAlign: "center", fontFamily: "MontserratBlack", fontWeight: 900, fontSize: size, lineHeight: 1, letterSpacing: -1 };
  return (
    <div style={{ position: "absolute", inset: 0, transform: `scale(${scale})`, transformOrigin: `540px ${sub.y + size / 2}px` }}>
      <div style={{ ...base, color: "#000", WebkitTextStroke: "18px #000", filter: "drop-shadow(0 6px 10px rgba(0,0,0,0.5))" }}>{sub.text}</div>
      <div style={{ ...base, color: sub.color }}>{sub.text}</div>
    </div>
  );
};

/**
 * Владелец поднимается снизу по центру по пояс, будто говорит эти слова (владелец 29.10: «без стрелки, снизу выходил
 * вначале с фразой начальной», «без указательной руки, без обрезанных плеч, по пояс»): выезжает за треть секунды, в конце
 * уходит вниз. Старые планы — в углу (side) или сбоку со стрелкой (arrow); их кадр остаётся прежним.
 */
const Peek: React.FC<{ peek: OwnerPeek }> = ({ peek }) => {
  const f = useCurrentFrame();
  const n = fr(peek.dur);
  const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
  const enter = spring({ frame: f, fps: FPS, config: { damping: 15, stiffness: 240 } });
  const leave = interpolate(f, [n - 6, n], [0, 1], clamp);
  // без перелёта вверх: иначе над краем кадра показался бы срез его груди
  const shown = Math.min(1, enter) * (1 - leave);
  const flip = peek.flip ?? peek.side === "right" ? "scaleX(-1)" : undefined;
  if (!peek.arrow)
    return (
      <AbsoluteFill>
        <Img src={staticFile(peek.file ?? "peek/owner.png")} style={{ position: "absolute", left: peek.fig.x, top: peek.fig.y + (1 - shown) * (peek.fig.h + 40), width: peek.fig.w, height: peek.fig.h, transform: flip }} />
      </AbsoluteFill>
    );
  const dx = (1 - shown) * (peek.fig.w + 40) * (peek.side === "left" ? -1 : 1);
  const draw = interpolate(f, [5, 11], [0, 1], clamp) * (1 - leave);
  const [x0, y0] = peek.arrow.from;
  const [x1, y1] = peek.arrow.to;
  const L = Math.hypot(x1 - x0, y1 - y0);
  const cx = (x0 + x1) / 2 + (-(y1 - y0) / L) * L * peek.arrow.bend;
  const cy = (y0 + y1) / 2 + ((x1 - x0) / L) * L * peek.arrow.bend;
  // наконечник смотрит по касательной в конце кривой
  const a = Math.atan2(y1 - cy, x1 - cx);
  const head = (s: number) => `M ${x1} ${y1} L ${x1 - 95 * Math.cos(a + s * 0.62)} ${y1 - 95 * Math.sin(a + s * 0.62)}`;
  const length = L * 1.08;
  return (
    <AbsoluteFill>
      <Img
        src={staticFile("peek/owner.png")}
        style={{ position: "absolute", left: peek.fig.x + dx, top: peek.fig.y, width: peek.fig.w, height: peek.fig.h, transform: flip }}
      />
      {draw > 0 && (
        <svg width={W} height={H} style={{ position: "absolute", inset: 0, filter: "drop-shadow(4px 6px 6px rgba(0,0,0,0.45))" }}>
          <path d={`M ${x0} ${y0} Q ${cx} ${cy} ${x1} ${y1}`} fill="none" stroke="#fff" strokeWidth={24} strokeLinecap="round" strokeDasharray={length} strokeDashoffset={length * (1 - draw)} />
          {draw > 0.85 && [-1, 1].map((s) => <path key={s} d={head(s)} fill="none" stroke="#fff" strokeWidth={24} strokeLinecap="round" />)}
        </svg>
      )}
    </AbsoluteFill>
  );
};

// вставка-наклейка поверх ролика, меньше экрана: вырезанная вещь выпрыгивает с поворотом и тенью, в конце ныряет обратно
// (владелец 28.10: «обрезать и накладывать поверх, чуть уменьшить, не во весь экран, со звуком»)
const STICKER = { w: 720, h: 820, cy: 580 };
// мем — готовая картинка с фоном: карточкой в белой рамке со скруглением, тоже поверх ролика и меньше экрана
const MEME = { w: 700, h: 620, cy: 680 };
// фото знаменитости — та же карточка, но выше (портреты вертикальные, человека надо узнать); низ — над субтитрами.
// Надписей под фото нет (владелец 29.10: «под фото есть надписи, на след роликах такого не должно быть»)
const PHOTO = { w: 660, h: 880, cy: 590 };
const MemeCard: React.FC<{ file: string; frames: number; i: number; iw?: number; ih?: number; photo?: boolean; cx?: number; cy?: number; scale?: number }> = ({ file, frames, i, iw, ih, photo, cx, cy, scale = 1 }) => {
  // картинка растягивается до карточки по своим пропорциям; без размера — квадратная
  const f = useCurrentFrame();
  const pop = spring({ frame: f, fps: FPS, config: { damping: 11, stiffness: 230 } });
  const out = interpolate(f, [frames - 4, frames], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const tilt = (i % 2 ? -1 : 1) * 2.5;
  const box = photo ? PHOTO : MEME;
  const k = Math.min(box.w / (iw ?? 1), box.h / (ih ?? 1));
  const size = { w: Math.round((iw ?? 1) * k), h: Math.round((ih ?? 1) * k) };
  // карточка поднимается из-под своего места и садится рывком с мягким хвостом; уходит, сжимаясь к середине с разгоном
  const motion = useMotion();
  const st = stage(f, frames);
  const land = snapSettle(st.p);
  const pose = motion
    ? { transform: `translateY(${(1 - land) * 170}px) scale(${(1 + 0.02 * st.live) * (1 - 0.7 * st.leave) * scale}) rotate(${tilt + (1 - land) * 4}deg)`, opacity: st.alpha }
    : { transform: `scale(${(0.5 + 0.5 * pop) * out * scale}) rotate(${tilt + (1 - pop) * 7}deg)` };
  return (
    <AbsoluteFill>
      <div style={{ position: "absolute", left: (cx ?? W / 2) - box.w / 2, top: (cy ?? box.cy) - box.h / 2, width: box.w, height: box.h, display: "flex", alignItems: "center", justifyContent: "center", ...pose }}>
        <Img src={staticFile(file)} style={{ width: size.w, height: size.h, objectFit: "cover", border: "8px solid #fff", borderRadius: 26, boxShadow: "0 22px 50px rgba(0,0,0,0.6)" }} />
      </div>
    </AbsoluteFill>
  );
};

// логотип бренда — сам знак, без карточки и фона (владелец 1.11: «убрать у логотипов белую обводку и даже фон»;
// фон значка вырезает runner/pipeline/inserts.ts clearBackground), с тенью, чтобы читался на любом кадре; выскакивает
// с поворотом и лежит в стопке до конца реплики. reveal (по pixel2motion, 31.10) — знак раскрывается кругом из центра
const LOGO = 280;
// знак-надпись (SpaceX — слово во всю ширину) — шире квадрата, чтобы буквы читались
const LOGO_WIDE = 560;
const LogoCard: React.FC<{ file: string; frames: number; cx?: number; cy?: number; rot?: number; reveal?: boolean; iw?: number; ih?: number }> = ({ file, frames, cx, cy, rot = 0, reveal, iw, ih }) => {
  const f = useCurrentFrame();
  const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
  const pop = spring({ frame: f, fps: FPS, config: { damping: 12, stiffness: 240 } });
  const out = interpolate(f, [frames - 4, frames], [1, 0], clamp);
  const open = reveal ? interpolate(f, [0, 9], [0, 75], { ...clamp, easing: Easing.out(Easing.cubic) }) : 75;
  const ratio = iw && ih ? iw / ih : 1;
  const bw = ratio > 1.4 ? Math.min(LOGO_WIDE, LOGO * ratio) : LOGO;
  const bh = ratio > 1.4 ? bw / ratio : LOGO;
  const shadow = "drop-shadow(0 12px 18px rgba(0,0,0,0.65)) drop-shadow(0 0 3px rgba(0,0,0,0.5))";
  const motion = useMotion();
  if (motion) {
    // знак прилетает «от камеры»: с первого кадра непрозрачный, в 1,7 раза крупнее места, и садится рывком с мягким
    // хвостом за 14 кадров — не растёт из точки; с logoReveal круг раскрытия начинается не с нуля и открывается за 6 кадров
    const st = stage(f, frames, 14);
    const land = snapSettle(st.p);
    const openNow = reveal ? 38 + 37 * softLand(f / 6) : 75;
    return (
      <AbsoluteFill>
        <div style={{ position: "absolute", left: (cx ?? W / 2) - bw / 2, top: (cy ?? 700) - bh / 2, width: bw, height: bh, display: "flex", alignItems: "center", justifyContent: "center", transform: `scale(${(1.7 - 0.7 * land) * (1 + 0.03 * st.live) * (1 - 0.7 * st.leave)}) rotate(${rot + (1 - land) * 8}deg)`, filter: shadow }}>
          <Img src={staticFile(file)} style={{ width: bw, height: bh, objectFit: "contain", clipPath: `circle(${openNow}% at 50% 50%)` }} />
        </div>
      </AbsoluteFill>
    );
  }
  return (
    <AbsoluteFill>
      <div style={{ position: "absolute", left: (cx ?? W / 2) - bw / 2, top: (cy ?? 700) - bh / 2, width: bw, height: bh, display: "flex", alignItems: "center", justifyContent: "center", transform: `scale(${(0.4 + 0.6 * pop) * out}) rotate(${rot + (1 - pop) * 12}deg)`, filter: shadow }}>
        <Img src={staticFile(file)} style={{ width: bw, height: bh, objectFit: "contain", clipPath: `circle(${open}% at 50% 50%)`, transform: `scale(${reveal ? 0.85 + 0.15 * (open / 75) : 1})` }} />
      </div>
    </AbsoluteFill>
  );
};

// графика поверх кадра (runner/pipeline/overlays.ts, каталог видео-скиллов 31.10)
type Over = NonNullable<NewsPlan["overlays"]>[number];
const MARK_COLOR = "#FF3B30";

/** Обводка, стрелка или подчёркивание от руки вокруг детали в кадре (по графике agent-video-editor): рисуется за 9 кадров. */
const Mark: React.FC<{ o: Extract<Over, { kind: "mark" }>; frames: number; focus?: boolean }> = ({ o, frames, focus }) => {
  const f = useCurrentFrame();
  const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
  const draw = interpolate(f, [0, 9], [0, 1], { ...clamp, easing: Easing.out(Easing.quad) });
  const out = interpolate(f, [frames - 5, frames], [1, 0], clamp);
  const { x, y, w, h } = o.box;
  const [cx, cy] = [x + w / 2, y + h / 2];
  let d = "";
  let head = "";
  if (o.shape === "underline") {
    const y0 = y + h + 16;
    const pts = Array.from({ length: 13 }, (_, i) => `${(x - 14 + ((w + 28) * i) / 12).toFixed(1)} ${(y0 + Math.sin(i * 1.3) * 6).toFixed(1)}`);
    d = `M ${pts.join(" L ")}`;
  } else if (o.shape === "arrow") {
    // хвост — с той стороны, где больше места; кончик не доходит до детали 24 px
    const sx = cx < W / 2 ? Math.min(W - 70, x + w + 260) : Math.max(70, x - 260);
    const sy = Math.min(H - 300, y + h + 240);
    const ang = Math.atan2(cy - sy, cx - sx);
    const ex = cx - Math.cos(ang) * (Math.max(w, h) / 2 + 24);
    const ey = cy - Math.sin(ang) * (Math.max(w, h) / 2 + 24);
    const bend = cx < W / 2 ? -0.25 : 0.25;
    const qx = (sx + ex) / 2 - (ey - sy) * bend;
    const qy = (sy + ey) / 2 + (ex - sx) * bend;
    d = `M ${sx} ${sy} Q ${qx} ${qy} ${ex} ${ey}`;
    const a = Math.atan2(ey - qy, ex - qx);
    head = [-1, 1].map((s) => `M ${ex} ${ey} L ${ex - 64 * Math.cos(a + s * 0.6)} ${ey - 64 * Math.sin(a + s * 0.6)}`).join(" ");
  } else {
    // овал чуть шире детали, с заходом за начало, как обводят маркером; за край кадра не выходит
    const rx = Math.min(w / 2 + Math.max(26, w * 0.16), (Math.min(cx, W - cx) - 14) / 1.09);
    const ry = Math.min(h / 2 + Math.max(22, h * 0.16), (Math.min(cy, H - cy) - 14) / 1.09);
    const pts = Array.from({ length: 49 }, (_, i) => {
      const a = -1.9 + (i / 48) * (Math.PI * 2 + 0.5);
      const k = 1 + 0.035 * Math.sin(a * 3 + 0.7) + (i / 48) * 0.05;
      return `${(cx + Math.cos(a) * rx * k).toFixed(1)} ${(cy + Math.sin(a) * ry * k).toFixed(1)}`;
    });
    d = `M ${pts.join(" L ")}`;
  }
  const stroke = { fill: "none", stroke: MARK_COLOR, strokeWidth: 13, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  const motion = useMotion();
  if (motion) {
    // уходит черта новым движением, а не растворяется: её стирают с того конца, с которого начали, с разгоном за 7 кадров — к последнему кадру черты уже нет
    // (обратная прокрутка читалась бы как отмена, растворение оставляет призрак — motionmaxxing R3.4–3.5)
    const nOut = Math.max(3, Math.min(7, Math.floor(frames * 0.3)));
    const gone = Math.pow(Math.max(0, Math.min(1, (f - (frames - nOut) + 1) / nOut)), 1.5);
    const seen = Math.max(0, draw - gone);
    // пока деталь обведена, остальной кадр чуть темнее — взгляд идёт к ней (приём «свет на главном» из video-shotcraft:
    // spotlight-sweep, scroll-brake — «остальное притемнено»); только у овала: у него есть середина
    const dim = focus && o.shape === "circle" ? 0.3 * glide(f / 6) * (1 - gone) : 0;
    const id = `focus-${Math.round(x)}-${Math.round(y)}`;
    return (
      <AbsoluteFill>
        <svg width={W} height={H} style={{ position: "absolute", inset: 0 }}>
          {dim > 0 && (
            <>
              <defs>
                <filter id={`${id}-soft`} x="-50%" y="-50%" width="200%" height="200%">
                  <feGaussianBlur stdDeviation="46" />
                </filter>
                <mask id={id}>
                  <rect width={W} height={H} fill="#fff" />
                  <ellipse cx={cx} cy={cy} rx={w / 2 + 90} ry={h / 2 + 90} fill="#000" filter={`url(#${id}-soft)`} />
                </mask>
              </defs>
              <rect width={W} height={H} fill="#000" opacity={dim} mask={`url(#${id})`} />
            </>
          )}
          <g style={{ filter: "drop-shadow(0 4px 6px rgba(0,0,0,0.5))" }}>
            {seen > 0.001 && <path d={d} {...stroke} pathLength={1} strokeDasharray={`${seen} 2`} strokeDashoffset={-gone} />}
            {head && draw > 0.9 && gone < 0.85 && <path d={head} {...stroke} />}
          </g>
        </svg>
      </AbsoluteFill>
    );
  }
  return (
    <AbsoluteFill style={{ opacity: out }}>
      <svg width={W} height={H} style={{ position: "absolute", inset: 0, filter: "drop-shadow(0 4px 6px rgba(0,0,0,0.5))" }}>
        <path d={d} {...stroke} pathLength={1} strokeDasharray={1} strokeDashoffset={1 - draw} />
        {head && draw > 0.9 && <path d={head} {...stroke} />}
      </svg>
    </AbsoluteFill>
  );
};

/** Переписка пузырями по-русски (по text-message-video-skills): сообщения появляются по одному, перед чужим — точки набора. */
const Chat: React.FC<{ o: Extract<Over, { kind: "chat" }>; frames: number }> = ({ o, frames }) => {
  const f = useCurrentFrame();
  const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
  const pop = spring({ frame: f, fps: FPS, config: { damping: 14, stiffness: 220 } });
  const out = interpolate(f, [frames - 5, frames], [1, 0], clamp);
  const n = o.messages.length;
  const step = Math.max(8, Math.floor((frames - 12) / Math.max(1, n)));
  // карточка поднимается снизу и садится; сообщение приходит чуть уменьшенным из-под своего места за 8 кадров, без отскока
  const motion = useMotion();
  const st = stage(f, frames);
  return (
    <AbsoluteFill>
      <div style={{ position: "absolute", left: 90, width: W - 180, top: 230, borderRadius: 44, background: "rgba(255,255,255,0.97)", boxShadow: "0 26px 60px rgba(0,0,0,0.55)", padding: "26px 26px 30px", ...(motion ? { transform: `translateY(${(1 - snapSettle(st.p)) * 150}px) scale(${1 - 0.7 * st.leave})`, opacity: st.alpha } : { transform: `scale(${(0.85 + 0.15 * pop) * out})`, opacity: Math.min(1, pop * 1.5) * out }), fontFamily: "Arial, sans-serif" }}>
        {o.title && <div style={{ textAlign: "center", fontWeight: 700, fontSize: 34, color: "#555", paddingBottom: 18, borderBottom: "2px solid #eee", marginBottom: 18 }}>{o.title}</div>}
        {o.messages.map((m, i) => {
          const at = 4 + i * step;
          const typing = m.side === "left" && f >= at - 7 && f < at;
          if (f < at && !typing) return null;
          const k = spring({ frame: f - at, fps: FPS, config: { damping: 12, stiffness: 260 } });
          const right = m.side === "right";
          return (
            <div key={i} style={{ display: "flex", justifyContent: right ? "flex-end" : "flex-start", marginTop: i ? 14 : 0 }}>
              <div style={{ maxWidth: "78%", background: right ? "#0A84FF" : "#E9E9EB", color: right ? "#fff" : "#111", borderRadius: 34, padding: "16px 26px", fontSize: 40, fontWeight: 600, lineHeight: 1.2, transform: typing ? undefined : motion ? `translateY(${(1 - softLand((f - at) / 8)) * 16}px) scale(${0.84 + 0.16 * softLand((f - at) / 8)})` : `scale(${0.6 + 0.4 * k})`, transformOrigin: right ? "100% 100%" : "0 100%" }}>
                {typing ? <span style={{ letterSpacing: 6, color: "#888" }}>{"•••".slice(0, 1 + (Math.floor(f / 3) % 3))}</span> : (
                  <>
                    {m.name && !right && <div style={{ fontSize: 28, fontWeight: 700, color: "#0A84FF", marginBottom: 4 }}>{m.name}</div>}
                    {m.text}
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

/** Крупное число отсчётом от нуля (по data-animation-skills): цифры точные, разряды через пробел. */
// русское согласование подписи с числом: режиссёр даёт три формы через | — «удаление|удаления|удалений», и отсчёт идёт
// «33 удаления … 51 удаление» (5.11, Бразилия: стояло «51 удалений»). Одна форма — как есть
const agree = (n: number, label: string) => {
  const forms = label.split("|").map((s) => s.trim());
  if (forms.length < 3) return label;
  const a = Math.abs(n) % 100;
  const b = a % 10;
  return a > 10 && a < 20 ? forms[2] : b === 1 ? forms[0] : b >= 2 && b <= 4 ? forms[1] : forms[2];
};
const NumberCard: React.FC<{ o: Extract<Over, { kind: "number" }>; frames: number }> = ({ o, frames }) => {
  const f = useCurrentFrame();
  const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
  const run = interpolate(f, [0, Math.max(10, Math.round(frames * 0.65))], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
  const out = interpolate(f, [frames - 5, frames], [1, 0], clamp);
  const pop = spring({ frame: f, fps: FPS, config: { damping: 12, stiffness: 230 } });
  const value = Math.round(o.value * run);
  const text = `${o.prefix ?? ""}${String(value).replace(/\B(?=(\d{3})+(?!\d))/g, " ")}${o.suffix ?? ""}`;
  const size = Math.min(170, Math.floor(980 / (text.length * 0.66)));
  const base: React.CSSProperties = { position: "absolute", left: 0, right: 0, textAlign: "center", fontFamily: "MontserratBlack", fontWeight: 900, letterSpacing: -2 };
  const label = o.label && agree(value, o.label);
  const motion = useMotion();
  if (motion) {
    // Число прилетает «от камеры» — на треть крупнее места — и садится рывком с мягким хвостом за 11 кадров.
    // Отсчёт короткий, до 16 кадров, и шаги его уменьшаются: когда голос договаривает число, на экране уже итог, и его
    // успевают прочитать (отсчёт дольше слова расходится с голосом — motionmaxxing sound-sync 5). Размер шрифта — сразу
    // под итоговое число: пока шёл отсчёт, цифры меняли размер с каждым разрядом. Подпись садится на 3 кадра позже цифр —
    // второе приземление (video-shotcraft slam-entrance: «текст карточки садится на 3 кадра позже»).
    const st = stage(f, frames, 11, 8);
    const land = snapSettle(st.p);
    const roll = Math.max(6, Math.min(16, Math.round(frames * 0.4)));
    const now = Math.round(o.value * softLand((f + 1) / roll));
    const show = (n: number) => `${o.prefix ?? ""}${String(n).replace(/\B(?=(\d{3})+(?!\d))/g, " ")}${o.suffix ?? ""}`;
    const fixed = Math.min(170, Math.floor(980 / (show(o.value).length * 0.66)));
    const late = softLand((f - 3) / 8);
    // подпись — сразу в форме итогового числа: пока шёл отсчёт, она мигала «доллар — доллара — долларов»
    const name = o.label && agree(o.value, o.label);
    return (
      <AbsoluteFill style={{ opacity: st.alpha, transform: `scale(${(1.36 - 0.36 * land) * (1 + 0.02 * st.live) * (1 - 0.7 * st.leave)})`, transformOrigin: "540px 700px" }}>
        <div style={{ ...base, top: 700 - fixed / 2, fontSize: fixed, color: "#000", WebkitTextStroke: "22px #000", filter: "drop-shadow(0 8px 14px rgba(0,0,0,0.55))" }}>{show(now)}</div>
        <div style={{ ...base, top: 700 - fixed / 2, fontSize: fixed, color: "#fff" }}>{show(now)}</div>
        {name && f >= 3 && (
          <div style={{ position: "absolute", inset: 0, transform: `translateY(${(1 - late) * 34}px)`, opacity: Math.min(1, 0.3 + (f - 3) / 4) }}>
            <div style={{ ...base, top: 700 + fixed / 2 + 12, fontSize: 76, color: "#000", WebkitTextStroke: "16px #000" }}>{name}</div>
            <div style={{ ...base, top: 700 + fixed / 2 + 12, fontSize: 76, color: HERO_COLOR }}>{name}</div>
          </div>
        )}
      </AbsoluteFill>
    );
  }
  return (
    <AbsoluteFill style={{ opacity: out, transform: `scale(${0.7 + 0.3 * pop})`, transformOrigin: "540px 700px" }}>
      <div style={{ ...base, top: 700 - size / 2, fontSize: size, color: "#000", WebkitTextStroke: "22px #000", filter: "drop-shadow(0 8px 14px rgba(0,0,0,0.55))" }}>{text}</div>
      <div style={{ ...base, top: 700 - size / 2, fontSize: size, color: "#fff" }}>{text}</div>
      {label && (
        <>
          <div style={{ ...base, top: 700 + size / 2 + 12, fontSize: 76, color: "#000", WebkitTextStroke: "16px #000" }}>{label}</div>
          <div style={{ ...base, top: 700 + size / 2 + 12, fontSize: 76, color: HERO_COLOR }}>{label}</div>
        </>
      )}
    </AbsoluteFill>
  );
};

/** Карта: весь мир, затем наезд на страну события, она подсвечена, на ней булавка и подпись (по map-animation-skills). */
const MAP_CARD = 880;
const MapCard: React.FC<{ o: Extract<Over, { kind: "map" }>; frames: number }> = ({ o, frames }) => {
  const f = useCurrentFrame();
  const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
  const pop = spring({ frame: f, fps: FPS, config: { damping: 14, stiffness: 220 } });
  const out = interpolate(f, [frames - 5, frames], [1, 0], clamp);
  const k = interpolate(f, [4, Math.max(14, Math.round(frames * 0.55))], [0, 1], { ...clamp, easing: Easing.inOut(Easing.cubic) });
  // вид: от всего мира к рамке страны с запасом (маленькая страна — не крупнее четверти карты)
  const side = Math.max(o.focus.w, o.focus.h, o.size * 0.06) * 2.6;
  const view = { x: k * (o.focus.x + o.focus.w / 2 - side / 2), y: k * (o.focus.y + o.focus.h / 2 - side / 2), s: (1 - k) * o.size + k * side };
  const scale = MAP_CARD / view.s;
  const pin = spring({ frame: f - Math.round(frames * 0.55), fps: FPS, config: { damping: 9, stiffness: 200 } });
  const [px, py] = [(o.focus.x + o.focus.w / 2 - view.x) * scale, (o.focus.y + o.focus.h / 2 - view.y) * scale];
  // карточка поднимается снизу и садится, уходит сжимаясь с разгоном; булавка — единственная вещь ролика с отскоком
  const motion = useMotion();
  const st = stage(f, frames);
  return (
    <AbsoluteFill>
      <div style={{ position: "absolute", left: (W - MAP_CARD) / 2, top: 140, width: MAP_CARD, height: MAP_CARD, borderRadius: 48, overflow: "hidden", background: "#0E1A2B", boxShadow: "0 26px 60px rgba(0,0,0,0.6)", border: "7px solid #fff", ...(motion ? { transform: `translateY(${(1 - snapSettle(st.p)) * 150}px) scale(${1 - 0.7 * st.leave})`, opacity: st.alpha } : { transform: `scale(${(0.8 + 0.2 * pop) * out})`, opacity: Math.min(1, pop * 1.5) * out }) }}>
        <Img src={staticFile(o.file)} style={{ position: "absolute", left: -view.x * scale, top: -view.y * scale, width: o.size * scale, height: o.size * scale }} />
        {pin > 0.02 && (
          <>
            <div style={{ position: "absolute", left: px - 26, top: py - 70 * pin, width: 52, height: 52, borderRadius: "50% 50% 50% 0", background: MARK_COLOR, transform: "rotate(-45deg)", boxShadow: "0 6px 12px rgba(0,0,0,0.5)", opacity: Math.min(1, pin) }} />
            <div style={{ position: "absolute", left: 0, right: 0, top: Math.min(MAP_CARD - 110, py + 30), textAlign: "center", opacity: Math.min(1, pin) }}>
              <span style={{ background: "#fff", color: "#111", borderRadius: 22, padding: "10px 26px", fontFamily: "MontserratBlack", fontWeight: 900, fontSize: 46 }}>{o.name}</span>
            </div>
          </>
        )}
      </div>
    </AbsoluteFill>
  );
};

/**
 * Видеомем поверх ролика: человек без фона поднимается снизу (cut), мультфильм и сцена без людей — карточкой по центру;
 * звук мема — свой. Под ним продолжается последний план ролика, чуть притемнённый.
 */
const MemeOver: React.FC<{ clip: NonNullable<NewsPlan["clips"][string]>; frames: number; heard: number }> = ({ clip, frames, heard }) => {
  const f = useCurrentFrame();
  const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
  const o = clip.overlay!;
  const enter = spring({ frame: f, fps: FPS, config: { damping: 14, stiffness: 200 } });
  const leave = interpolate(f, [frames - 5, frames], [0, 1], clamp);
  const shown = Math.min(1, enter) * (1 - leave);
  const sound = <Audio src={staticFile(clip.file)} volume={(x) => fade(x, heard, clip.gain)} />;
  if (o.transition) {
    // мем-переход во весь экран: сам кадр целиком по ширине поверх своего же кадра, растянутого и притемнённого, с лёгким наездом
    const zoom = interpolate(f, [0, frames], [1, 1.06], clamp);
    const h = (W * o.h) / o.w;
    return (
      <AbsoluteFill style={{ background: "#000" }}>
        {sound}
        <OffthreadVideo src={staticFile(clip.file)} muted style={{ position: "absolute", width: W, height: H, objectFit: "cover", transform: `scale(${1.1 * zoom})`, filter: "brightness(0.32)" }} />
        <OffthreadVideo src={staticFile(clip.file)} muted style={{ position: "absolute", left: 0, top: (H - h) / 2, width: W, height: h, transform: `scale(${zoom})` }} />
      </AbsoluteFill>
    );
  }
  if (o.cut) {
    // не крупнее своего кадра и не выше 860 px: человек внизу, лицо героя на плане выше открыто (владелец 1.11:
    // Доктор Зло вышел огромным)
    const s = Math.min(1, 860 / o.h);
    const [w, h] = [W * s, o.h * s];
    return (
      <AbsoluteFill>
        {sound}
        <div style={{ position: "absolute", left: (W - w) / 2, top: H - h + (1 - shown) * h * 0.7, width: w, height: h, filter: "drop-shadow(0 -6px 24px rgba(0,0,0,0.55))" }}>
          <OffthreadVideo src={staticFile(o.cut)} transparent muted style={{ width: w, height: h }} />
        </div>
      </AbsoluteFill>
    );
  }
  // карточка — в нижней половине кадра: лицо героя на последнем плане обычно выше, субтитров во время мема нет
  const cw = 960;
  const ch = Math.min(1100, (cw * o.h) / W);
  const top = Math.min(H - 80 - ch, 1300 - ch / 2);
  return (
    <AbsoluteFill>
      {sound}
      <div style={{ position: "absolute", left: (W - cw) / 2, top, width: cw, height: ch, borderRadius: 36, overflow: "hidden", border: "8px solid #fff", boxShadow: "0 26px 60px rgba(0,0,0,0.6)", transform: `scale(${0.6 + 0.4 * shown})`, opacity: Math.min(1, shown * 1.6) }}>
        <OffthreadVideo src={staticFile(clip.file)} muted style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      </div>
    </AbsoluteFill>
  );
};

// карта с подлётом — готовый клип во весь экран поверх кадра (субтитры остаются сверху)
const MapFly: React.FC<{ o: Extract<Over, { kind: "mapfly" }> }> = ({ o }) => (
  <AbsoluteFill>
    <OffthreadVideo src={staticFile(o.file)} muted style={{ width: "100%", height: "100%", objectFit: "cover" }} />
  </AbsoluteFill>
);

const OverlayView: React.FC<{ o: Over; frames: number; focus?: boolean }> = ({ o, frames, focus }) =>
  o.kind === "mark" ? <Mark o={o} frames={frames} focus={focus} /> : o.kind === "chat" ? <Chat o={o} frames={frames} /> : o.kind === "number" ? <NumberCard o={o} frames={frames} /> : o.kind === "mapfly" ? <MapFly o={o} /> : <MapCard o={o} frames={frames} />;

const Insert: React.FC<{ file: string; frames: number; i: number; cx?: number; cy?: number; scale?: number }> = ({ file, frames, i, cx, cy, scale = 1 }) => {
  const f = useCurrentFrame();
  const pop = spring({ frame: f, fps: FPS, config: { damping: 10, stiffness: 230 } });
  const out = interpolate(f, [frames - 4, frames], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const tilt = (i % 2 ? 1 : -1) * 3;
  // вещь прилетает «от камеры» — на треть крупнее места — и садится с замедлением; в конце ныряет вниз с разгоном
  const motion = useMotion();
  const st = stage(f, frames);
  const land = softLand(st.p);
  const pose = motion
    ? { transform: `translateY(${st.leave * 260}px) scale(${(1.36 - 0.36 * land) * (1 + 0.02 * st.live) * (1 - 0.6 * st.leave) * scale}) rotate(${tilt + (1 - land) * 6}deg)`, opacity: st.alpha }
    : { transform: `scale(${(0.45 + 0.55 * pop) * out * scale}) rotate(${tilt + (1 - pop) * 8}deg)` };
  return (
    <AbsoluteFill>
      <Img
        src={staticFile(file)}
        style={{
          position: "absolute", left: (cx ?? W / 2) - STICKER.w / 2, top: (cy ?? STICKER.cy) - STICKER.h / 2, width: STICKER.w, height: STICKER.h, objectFit: "contain",
          ...pose, filter: "drop-shadow(0 18px 28px rgba(0,0,0,0.55))",
        }}
      />
    </AbsoluteFill>
  );
};

// звуки уже подготовлены по роли и стоят за голосом (runner/pipeline/sounds.ts); звука, которого нет, не будет
const Sfx: React.FC<{ name: string; at: number; have?: string[] }> = ({ name, at, have }) =>
  have && !have.includes(name) ? null : (
    <Sequence from={Math.max(0, fr(at))} durationInFrames={fr(1.8)}>
      <Audio src={staticFile(`sfx/${name}.wav`)} />
    </Sequence>
  );

/**
 * Все звуки появлений по времени. Звук одной роли идёт по очереди своими вариантами — pop, pop~1, pop~2… (их готовит
 * runner/pipeline/sounds.ts): иначе каждый поп в ролике звучал одним и тем же файлом.
 */
function soundEvents(plan: NewsPlan, L: ReturnType<typeof layout>): { name: string; at: number }[] {
  const list: { name: string; at: number }[] = [{ name: "intro", at: 0 }];
  // звук вставки — на самом слове, как и был: вставка трогается на два кадра раньше (fx.wordLead) и к звуку уже почти села,
  // удар звука приходится на её приземление, а не на первый кадр пути
  for (const x of L.inserts) list.push({ name: "pop", at: Math.max(x.t, x.word) });
  for (const p of L.placed) {
    const seg = p.seg;
    if ("narr" in seg) for (const s of seg.shots) if (s.sfx) list.push({ name: s.sfx, at: p.start + (s.w === 0 ? 0 : L.words(seg.narr)[s.w].s - 0.05) });
  }
  for (const h of L.hits) if (h.sfx) list.push({ name: h.sfx, at: h.t - 0.03 });
  for (const o of L.overlays) list.push({ name: o.kind === "chat" ? "ding" : "pop", at: Math.max(o.t, o.word) });
  const count = new Map<string, number>();
  return list.sort((a, b) => a.at - b.at).map((e) => {
    const options = [e.name, ...(plan.sounds ?? []).filter((s) => s.startsWith(`${e.name}~`))];
    const n = count.get(e.name) ?? 0;
    count.set(e.name, n + 1);
    return { ...e, name: options[n % options.length] };
  });
}

export const Main: React.FC<{ plan: NewsPlan }> = ({ plan }) => {
  const L = useMemo(() => layout(plan), [plan]);
  const { placed, total, len, words, subs, peeks, inserts, cuts, hits, tails } = L;
  const sounds = useMemo(() => soundEvents(plan, L), [plan, L]);
  return (
    <Motion.Provider value={plan.fx?.motion === true}>
    <AbsoluteFill style={{ background: "#000" }}>
      <Camera cuts={cuts} hits={hits} calm={plan.fx?.calm}>
        {placed.map((p, i) => {
          const segFrom = fr(p.start);
          const segLen = (i + 1 < placed.length ? fr(placed[i + 1].start) : total) - segFrom;
          const seg = p.seg;
          if ("orig" in seg && plan.clips[seg.orig].overlay && i > 0)
            return (
              <Sequence key={i} from={segFrom} durationInFrames={segLen}>
                <Visual plan={plan} look={tails[i - 1]} frames={segLen} />
                <AbsoluteFill style={{ background: "rgba(0,0,0,0.25)" }} />
                <MemeOver clip={plan.clips[seg.orig]} frames={segLen} heard={i === placed.length - 1 ? segLen - LOOP_FRAMES : segLen} />
              </Sequence>
            );
          if ("orig" in seg)
            return (
              <Sequence key={i} from={segFrom} durationInFrames={segLen}>
                <Visual plan={plan} look={{ clip: seg.orig, at: seg.from }} frames={segLen} volume={plan.clips[seg.orig].gain} heard={i === placed.length - 1 ? segLen - LOOP_FRAMES : segLen} keepRu />
                <Covers covers={seg.covers} clip={seg.orig} segLen={segLen} plan={plan} keepRu />
              </Sequence>
            );
          if ("dub" in seg)
            return (
              <Sequence key={i} from={segFrom} durationInFrames={segLen}>
                <Visual plan={plan} look={{ clip: seg.dub, at: seg.from }} frames={segLen} volume={plan.clips[seg.dub].gain * UNDER_DUB} heard={i === placed.length - 1 ? segLen - LOOP_FRAMES : segLen} />
                <Covers covers={seg.covers} clip={seg.dub} segLen={segLen} plan={plan} />
              </Sequence>
            );
          const list = words(seg.narr);
          return (
            <React.Fragment key={i}>
              {seg.shots.map((sh, k) => {
                const from = segFrom + (sh.w === 0 ? 0 : fr(list[sh.w].s - 0.05));
                const to = k + 1 < seg.shots.length ? segFrom + fr(list[seg.shots[k + 1].w].s - 0.05) : segFrom + segLen;
                const dur = (to - from) / FPS;
                // план, который должен упереться в нужный момент исходника, сдвигаем назад
                const at = sh.endAt !== undefined ? Math.max(0, sh.endAt - dur) : sh.maxAt !== undefined ? Math.max(0, Math.min(sh.at ?? 0, sh.maxAt - dur)) : sh.at;
                return (
                  <Sequence key={k} from={from} durationInFrames={Math.max(1, to - from)}>
                    <Visual plan={plan} look={{ ...sh, at }} frames={Math.max(1, to - from)} />
                  </Sequence>
                );
              })}
            </React.Fragment>
          );
        })}
      </Camera>
      {/* в спокойном монтаже (только посты и сайты) первый кадр — сразу заголовок, без вспышки (владелец 3.11: «начало очень слабое») */}
      {!plan.fx?.calm && <Burst />}
      {/* вставки-картинки и владелец — над кадром, под субтитрами */}
      {inserts.map((x, i) => (
        <Sequence key={`ins${i}`} from={fr(x.t)} durationInFrames={fr(x.dur)}>
          {x.kind === "logo" ? <LogoCard file={x.file} frames={fr(x.dur)} cx={x.cx} cy={x.cy} rot={x.rot} reveal={plan.fx?.logoReveal} iw={x.iw} ih={x.ih} /> : x.kind === "meme" || x.kind === "photo" ? <MemeCard file={x.file} frames={fr(x.dur)} i={i} iw={x.iw} ih={x.ih} photo={x.kind === "photo"} cx={x.cx} cy={x.cy} scale={x.scale} /> : <Insert file={x.file} frames={fr(x.dur)} i={i} cx={x.cx} cy={x.cy} scale={x.scale} />}
        </Sequence>
      ))}
      {L.overlays.map((o, i) => (
        <Sequence key={`ov${i}`} from={fr(o.t)} durationInFrames={fr(o.dur)}>
          <OverlayView o={o} frames={fr(o.dur)} focus={plan.fx?.focus} />
        </Sequence>
      ))}
      {peeks.map((p, i) => (
        <Sequence key={`peek${i}`} from={fr(p.t)} durationInFrames={fr(p.dur)}>
          <Peek peek={p} />
        </Sequence>
      ))}
      {/* владелец 29.10: «звук входа тоже нужен и выхода». Вжух входа громче всего через 0,25 с — когда он поднялся;
          вжух выхода — через 0,35 с, а уходит он за последние 6 кадров (Peek): звук начинается раньше ухода */}
      {peeks.map((p, i) => <Sfx key={`peekin${i}`} name="ownerIn" at={p.t} have={plan.sounds} />)}
      {peeks.map((p, i) => <Sfx key={`peekout${i}`} name="ownerOut" at={p.t + p.dur - 0.45} have={plan.sounds} />)}
      {/* петля: вспышка собирается и закрывает последний кадр, как первый */}
      {!plan.fx?.calm && (
        <Sequence from={total - LOOP_FRAMES} durationInFrames={LOOP_FRAMES}>
          <Burst reverse />
        </Sequence>
      )}
      {/* голоса */}
      {placed.map((p, i) => {
        const seg = p.seg;
        if ("narr" in seg)
          return (
            <Sequence key={`v${i}`} from={fr(p.start)} durationInFrames={fr(len(seg.narr))}>
              <Audio src={staticFile(plan.lines[seg.narr].file)} volume={(x) => fade(x, fr(len(seg.narr)) + 2, 1)} />
            </Sequence>
          );
        if ("dub" in seg)
          return seg.lines.map((l) => (
            <Sequence key={`v${i}${l.id}`} from={fr(p.start + l.at)} durationInFrames={fr(len(l.id))}>
              <Audio src={staticFile(plan.lines[l.id].file)} volume={(x) => fade(x, fr(len(l.id)) + 2, 1)} />
            </Sequence>
          ));
        return null;
      })}
      {/* звуки — только когда в кадре что-то появляется (владелец 28.10: «много вушей хотя ничего не выходит»): вспышка
          первой секунды, поп на карточке просмотров, стоп-кадре и вставках, акценты на словах; склейки и смены планов — без звука */}
      {sounds.map((s, i) => <Sfx key={`sfx${i}`} name={s.name} at={s.at} have={plan.sounds} />)}
      {/* фоновая музыка */}
      {plan.music && <Audio src={staticFile(plan.music.file)} loop volume={(x) => plan.music!.volume * Math.min(1, x / 10, (total - x) / 15)} />}
      <Subtitle subs={subs} />
    </AbsoluteFill>
    </Motion.Provider>
  );
};
