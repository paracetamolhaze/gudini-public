import React from "react";
import { alpha, fonts } from "../design";
import { BlockSfx, type SfxRole } from "./audio";
import { Board, boardLayout, useBoard, type AuthorLayout } from "./board";
import { fitSize, useAppear, useSince } from "./boardParts";
import { Icon } from "./icons";

type Props = {
  from: number;
  to: number;
  /** The forum or site: "bitcointalk.org", "Reddit", "X". */
  site: string;
  /** The section path shown over the post: "Bitcoin Forum › Marketplace". */
  section?: string;
  /** Who posted, as the nick is written: "laszlo". */
  user: string;
  /** When: "18 мая 2010". */
  date?: string;
  /** The post title: "Pizza for bitcoins?". */
  title: string;
  /** The post text as the author retells it; it is typed when he says it. */
  text: string;
  /** The second the text starts typing: when the author quotes the post. */
  at?: number;
  /** Icon name or one letter in the avatar. */
  avatar?: string;
  author?: AuthorLayout;
  sfx?: SfxRole | false;
};

/** An old-school forum header: a flat colored bar, as forums and message boards look, not a messenger. */
const BAR = "#46628A";

const Body: React.FC<Omit<Props, "from" | "to" | "author" | "sfx">> = ({ site, section, user, date, title, text, at, avatar }) => {
  const { palette, area } = useBoard();
  const win = useAppear(undefined, 0.15, 0.45);
  const since = useSince(at, 0.9);
  const shown = Math.max(0, Math.min(text.length, Math.floor(since * 34)));
  const typing = shown < text.length && since > 0;
  // A short post is written big: the card fills the board with the words themselves.
  const titleSize = fitSize([title], area.w - 290, 64, fonts.ui, "700", 36);
  const textSize = text.length <= 60 ? 58 : text.length <= 120 ? 48 : 40;
  const letter = avatar && avatar.length <= 2 ? avatar : undefined;
  return (
    <div style={{ position: "absolute", left: area.x, top: area.y, width: area.w, height: area.h, display: "flex", flexDirection: "column",
      borderRadius: 18, overflow: "hidden", background: palette.surface, border: `2px solid ${palette.line}`,
      boxShadow: `0 30px 70px ${alpha("#000000", palette.mode === "dark" ? 0.45 : 0.14)}`, opacity: win, translate: `0 ${(1 - win) * 40}px` }}>
      <div style={{ display: "flex", alignItems: "center", gap: 16, padding: "18px 28px", background: BAR, color: "#FFFFFF" }}>
        <Icon name="chats" size={36} color="#FFFFFF" stroke={2} />
        <span style={{ fontFamily: fonts.ui, fontWeight: 700, fontSize: 34 }}>{site}</span>
        {section ? <span style={{ fontFamily: fonts.ui, fontSize: 26, opacity: 0.8, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{section}</span> : null}
      </div>
      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        <div style={{ width: 210, flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: 12, padding: "26px 12px", borderRight: `2px solid ${palette.line}`,
          background: alpha(BAR, 0.06) }}>
          <div style={{ width: 118, height: 118, borderRadius: 14, background: alpha(BAR, 0.18), display: "flex", alignItems: "center", justifyContent: "center",
            fontFamily: fonts.ui, fontWeight: 800, fontSize: 56, color: BAR }}>
            {letter ?? <Icon name={avatar ?? "user"} size={64} color={BAR} stroke={1.8} />}
          </div>
          <div style={{ fontFamily: fonts.ui, fontWeight: 700, fontSize: 34, color: BAR, textAlign: "center", wordBreak: "break-word" }}>{user}</div>
          <div style={{ fontFamily: fonts.ui, fontSize: 24, color: palette.muted }}>участник</div>
        </div>
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", padding: "24px 30px" }}>
          <div style={{ fontFamily: fonts.ui, fontWeight: 700, fontSize: titleSize, color: palette.text, lineHeight: 1.15 }}>{title}</div>
          {date ? <div style={{ fontFamily: fonts.ui, fontSize: 26, color: palette.muted, marginTop: 8 }}>{date}</div> : null}
          <div style={{ height: 2, background: palette.line, margin: "18px 0 22px" }} />
          <div style={{ fontFamily: fonts.ui, fontWeight: 500, fontSize: textSize, lineHeight: 1.3, color: palette.text }}>
            {text.slice(0, shown)}
            {typing ? <span style={{ display: "inline-block", width: 4, height: textSize, marginLeft: 3, background: palette.text, verticalAlign: "text-bottom" }} /> : null}
          </div>
        </div>
      </div>
    </div>
  );
};

/** A post on a forum or a site, quoted by the author: who wrote it, when, the title, the words. For "wrote on the forum". */
export const Post: React.FC<Props> & { layoutOf: (p: Props) => ReturnType<typeof boardLayout> } = ({ from, to, author = "split", sfx, ...rest }) => (
  <>
    <Board from={from} to={to} author={author} name={`Post ${rest.site}`}><Body {...rest} /></Board>
    <BlockSfx at={from} sfx={sfx} fallback="swipe" />
  </>
);
Post.layoutOf = ({ from, to, author = "split", title }) => boardLayout(from, to, author, title);
