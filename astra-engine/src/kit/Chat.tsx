import React from "react";
import { interpolate } from "remotion";
import { alpha, fonts } from "../design";
import { BlockSfx, Sfx, type SfxRole } from "./audio";
import { Board, boardLayout, useBoard, type AuthorLayout } from "./board";
import { useAppear, useSince } from "./boardParts";
import { Icon } from "./icons";

type Message = { text: string; side?: "in" | "out"; at?: number };
type Props = {
  from: number;
  to: number;
  /** Who writes: "Поддержка Binance", "Мама", "Hamster Kombat". */
  name: string;
  /** Icon name or one letter in the avatar. */
  avatar?: string;
  /** A blue check next to the name (fake support accounts wear one). */
  verified?: boolean;
  status?: string;
  /** Messages as they are retold: `in` — to the viewer, `out` — the viewer's answer. */
  messages: Message[];
  author?: AuthorLayout;
  sfx?: SfxRole | false;
};

const Bubble: React.FC<{ message: Message; delay: number; width: number; size: number }> = ({ message, delay, width, size }) => {
  const { palette } = useBoard();
  const out = message.side === "out";
  const since = useSince(message.at, delay);
  const typing = !out && since > -0.9 && since < 0;
  const p = interpolate(since, [0, 0.3], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  if (since < -0.9) return null;
  const bg = out ? palette.accent : palette.surface;
  const fg = out ? palette.onAccent : palette.text;
  const dot = size * 0.36;
  return (
    <div style={{ display: "flex", justifyContent: out ? "flex-end" : "flex-start" }}>
      {typing ? (
        <div style={{ display: "flex", gap: dot * 0.7, padding: `${size * 0.6}px ${size * 0.7}px`, borderRadius: size * 0.8, background: bg, boxShadow: `0 6px 18px ${alpha("#000000", 0.08)}` }}>
          {[0, 1, 2].map(i => <span key={i} style={{ width: dot, height: dot, borderRadius: dot / 2, background: palette.muted, opacity: 0.4 + 0.6 * Math.abs(Math.sin((since * 6) + i)) }} />)}
        </div>
      ) : (
        <div style={{ maxWidth: width * 0.8, padding: `${size * 0.5}px ${size * 0.7}px ${size * 0.4}px`, borderRadius: size * 0.8,
          borderBottomLeftRadius: out ? size * 0.8 : 10, borderBottomRightRadius: out ? 10 : size * 0.8,
          background: bg, boxShadow: `0 6px 18px ${alpha("#000000", 0.08)}`,
          opacity: p, translate: `${(1 - p) * (out ? 40 : -40)}px ${(1 - p) * 20}px`, scale: String(0.94 + 0.06 * p) }}>
          <div style={{ fontFamily: fonts.ui, fontWeight: 400, fontSize: size, lineHeight: 1.28, color: fg }}>{message.text}</div>
          <div style={{ fontFamily: fonts.mono, fontSize: size * 0.5, color: out ? alpha(palette.onAccent, 0.7) : palette.muted, textAlign: "right", marginTop: 6 }}>12:4{Math.round(delay * 3) % 10}</div>
        </div>
      )}
    </div>
  );
};

const Body: React.FC<Omit<Props, "from" | "to" | "author" | "sfx">> = ({ name, avatar, verified, status = "в сети", messages }) => {
  const { palette, area } = useBoard();
  const win = useAppear(undefined, 0.15, 0.45);
  const w = Math.min(area.w, 960);
  const letter = avatar && avatar.length <= 2 ? avatar : undefined;
  const shown = messages.slice(0, area.h < 700 ? 3 : 6);
  // The messenger screen fills the board; a few messages are written big.
  const size = shown.length <= 1 ? 50 : shown.length === 2 ? 44 : 38;
  return (
    <div style={{ position: "absolute", left: area.x + (area.w - w) / 2, top: area.y, width: w, height: area.h, display: "flex", flexDirection: "column",
      borderRadius: 36, background: palette.surface, border: `2px solid ${palette.line}`, overflow: "hidden",
      boxShadow: `0 30px 70px ${alpha("#000000", palette.mode === "dark" ? 0.45 : 0.14)}`, opacity: win, translate: `0 ${(1 - win) * 40}px` }}>
      <div style={{ display: "flex", alignItems: "center", gap: 22, padding: "22px 30px", borderBottom: `2px solid ${palette.line}` }}>
        <Icon name="arrow-right" size={38} color={palette.muted} style={{ rotate: "180deg" }} />
        <div style={{ width: 88, height: 88, borderRadius: 44, background: palette.accent, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
          fontFamily: fonts.ui, fontWeight: 800, fontSize: 40, color: palette.onAccent }}>
          {letter ?? <Icon name={avatar ?? "user"} size={46} color={palette.onAccent} stroke={2} />}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, fontFamily: fonts.ui, fontWeight: 600, fontSize: 42, color: palette.text, whiteSpace: "nowrap" }}>
            {name}{verified ? <Icon name="verified" size={38} color="#3B9DFF" stroke={2.2} /> : null}
          </div>
          <div style={{ fontFamily: fonts.ui, fontSize: 28, color: palette.muted }}>{status}</div>
        </div>
        <Icon name="call" size={40} color={palette.muted} />
      </div>
      {/* The chat wallpaper: messages come in at the bottom, as in a messenger. */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "flex-end", gap: 20, padding: "24px 26px",
        backgroundColor: palette.bg, backgroundImage: `radial-gradient(${palette.grid} 2.5px, transparent 2.5px)`, backgroundSize: "34px 34px" }}>
        {shown.map((m, i) => <Bubble key={i} message={m} delay={0.9 + i * 1.1} width={w} size={size} />)}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 18, padding: "16px 22px", borderTop: `2px solid ${palette.line}` }}>
        <div style={{ flex: 1, height: 68, borderRadius: 34, background: palette.bg, display: "flex", alignItems: "center", padding: "0 30px",
          fontFamily: fonts.ui, fontSize: 30, color: palette.muted }}>Сообщение</div>
        <div style={{ width: 68, height: 68, borderRadius: 34, background: palette.accent, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Icon name="send" size={34} color={palette.onAccent} stroke={2} />
        </div>
      </div>
    </div>
  );
};

/** A messenger conversation retold on screen: a scam message, a fake support account, a friend's invite. */
export const Chat: React.FC<Props> & { layoutOf: (p: Props) => ReturnType<typeof boardLayout> } = ({ from, to, author = "split", sfx, ...rest }) => (
  <>
    <Board from={from} to={to} author={author} name={`Chat ${rest.name}`}><Body {...rest} /></Board>
    <BlockSfx at={from} sfx={sfx} fallback="swipe" />
    {rest.messages.slice(0, 6).map((m, i) => (m.side !== "out" ? <Sfx key={i} at={m.at ?? from + 0.9 + i * 1.1} role="notification" volume={0.55} /> : null))}
  </>
);
Chat.layoutOf = ({ from, to, author = "split", name }) => boardLayout(from, to, author, name);
