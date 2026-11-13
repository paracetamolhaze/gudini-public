import React, { useMemo } from "react";
import QRCode from "qrcode";
import { interpolate } from "remotion";
import { accentText, alpha, fonts } from "../design";
import { BlockSfx, Sfx, type SfxRole } from "./audio";
import { Board, boardLayout, useBoard, type AuthorLayout } from "./board";
import { SerifLine, useAppear, useSince } from "./boardParts";
import { Icon } from "./icons";

/** The address of the genesis block, mined by Satoshi Nakamoto in 2009: real and public. */
export const GENESIS_ADDRESS = "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa";

type Props = {
  from: number;
  to: number;
  /** A real public address; the genesis address by default. Never a viewer's or the author's own. */
  address?: string;
  /** Shown first and replaced by the address: "@nickname". */
  nick?: string;
  /** Network name on the chip: "Bitcoin", "TON", "Ethereum". */
  network?: string;
  /** The italic line under the card: "как ник — только для денег". */
  label?: string;
  author?: AuthorLayout;
  sfx?: SfxRole | false;
};

const QR: React.FC<{ text: string; size: number; color: string; background: string }> = ({ text, size, color, background }) => {
  const path = useMemo(() => {
    const qr = QRCode.create(text, { errorCorrectionLevel: "M" });
    const n = qr.modules.size;
    let d = "";
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (qr.modules.data[y * n + x]) d += `M${x} ${y}h1v1h-1z`;
    return { d, n };
  }, [text]);
  return (
    <svg width={size} height={size} viewBox={`-2 -2 ${path.n + 4} ${path.n + 4}`} style={{ background, borderRadius: 18 }} shapeRendering="crispEdges">
      <path d={path.d} fill={color} />
    </svg>
  );
};

const Body: React.FC<Omit<Props, "from" | "to" | "author" | "sfx">> = ({ address = GENESIS_ADDRESS, nick, network = "Bitcoin", label }) => {
  const { palette, area } = useBoard();
  const card = useAppear(undefined, 0.15, 0.45);
  // The nickname shows first, then the address types over it.
  const typeFrom = nick ? 1.25 : 0.5;
  const since = useSince(undefined, typeFrom);
  const typed = Math.max(0, Math.min(address.length, Math.floor(since * 26)));
  const nickSince = useSince(undefined, typeFrom - 0.25);
  const nickOut = nick ? interpolate(nickSince, [0, 0.25], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) : 0;
  const qrIn = useAppear(undefined, typeFrom + 0.3, 0.5);
  const groups = address.slice(0, typed).match(/.{1,4}/g) ?? [];
  const w = Math.min(area.w, 960);
  const cardH = Math.min(area.h - (label ? 90 : 0), 420);
  const qrSize = Math.min(250, cardH - 150);
  return (
    <div style={{ position: "absolute", left: area.x + (area.w - w) / 2, top: area.y, width: w, height: area.h, display: "flex", flexDirection: "column", justifyContent: "center", gap: 26 }}>
      <div style={{ width: w, height: cardH, borderRadius: 34, background: palette.surface, border: `2px solid ${palette.line}`, padding: "28px 34px", boxSizing: "border-box",
        boxShadow: `0 30px 70px ${alpha("#000000", palette.mode === "dark" ? 0.45 : 0.14)}`, opacity: card, translate: `0 ${(1 - card) * 40}px`, display: "flex", flexDirection: "column", gap: 22 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <Icon name="wallet" size={44} color={palette.text} stroke={1.8} />
          <span style={{ fontFamily: fonts.ui, fontWeight: 600, fontSize: 38, color: palette.text, flex: 1 }}>Кошелёк</span>
          <span style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 18px", borderRadius: 30, background: palette.faint, fontFamily: fonts.mono, fontSize: 26, color: palette.text }}>
            <Icon name="bitcoin" size={28} color={palette.accent} stroke={2} />{network}
          </span>
        </div>
        <div style={{ display: "flex", gap: 30, flex: 1, alignItems: "center" }}>
          <div style={{ opacity: qrIn, scale: String(0.9 + 0.1 * qrIn), flexShrink: 0 }}>
            <QR text={address} size={qrSize} color={palette.mode === "dark" ? "#0E1012" : palette.text} background="#FFFFFF" />
          </div>
          <div style={{ position: "relative", flex: 1, display: "flex", flexDirection: "column", gap: 14 }}>
            <span style={{ fontFamily: fonts.mono, fontSize: 24, letterSpacing: 3, color: palette.muted }}>АДРЕС</span>
            <div style={{ position: "relative", minHeight: 150 }}>
              {nick ? (
                <div style={{ position: "absolute", left: 0, top: 10, opacity: nickOut, fontFamily: fonts.ui, fontWeight: 800, fontSize: 60, color: palette.text }}>{nick}</div>
              ) : null}
              <div style={{ fontFamily: fonts.mono, fontWeight: 700, fontSize: 40, lineHeight: 1.35, color: palette.text, display: "flex", flexWrap: "wrap", columnGap: 16, maxWidth: 560 }}>
                {groups.map((g, i) => (
                  <span key={i} style={i === 0 || (typed === address.length && i === groups.length - 1) ? { ...accentText(palette), borderRadius: 4 } : { color: palette.text }}>{g}</span>
                ))}
                {typed < address.length && since > 0 ? <span style={{ display: "inline-block", width: 22, height: 44, background: palette.accent, alignSelf: "center" }} /> : null}
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, alignSelf: "flex-start", padding: "10px 22px", borderRadius: 30, border: `2px solid ${palette.line}`,
              fontFamily: fonts.ui, fontWeight: 600, fontSize: 28, color: palette.text, opacity: qrIn }}>
              <Icon name="copy" size={28} color={palette.text} />Скопировать
            </div>
          </div>
        </div>
      </div>
      {label ? <SerifLine text={label} color={palette.accent} size={54} delay={typeFrom + 0.9} align="center" maxWidth={w} /> : null}
    </div>
  );
};

/** A wallet card with a real address and its QR code: "an address is like a nickname". */
export const Address: React.FC<Props> & { layoutOf: (p: Props) => ReturnType<typeof boardLayout> } = ({ from, to, author = "split", sfx, ...rest }) => (
  <>
    <Board from={from} to={to} author={author} name="Address"><Body {...rest} /></Board>
    <BlockSfx at={from} sfx={sfx} fallback="swipe" />
    <Sfx at={from + (rest.nick ? 1.25 : 0.5)} role="typing" volume={0.6} />
  </>
);
Address.layoutOf = ({ from, to, author = "split", nick }) => boardLayout(from, to, author, nick);
