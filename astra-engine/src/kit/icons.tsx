import React from "react";
import { Img } from "remotion";
import { useInput } from "../input";
import { useAsset } from "./assets";
import { coinKey, coinOf, emojiOf, OWN_PICTURES } from "./iconPictures";
import {
  Anchor, ArrowLeftRight, ArrowRight, AtSign, BadgeAlert, BadgeCheck, Ban, Banknote, Bell, Binary, Bitcoin, Blocks, BookOpen, Bot, Box, Boxes,
  Brain, Briefcase, Bug, Calculator, Calendar, Camera, Car, ChartCandlestick, ChartColumn, ChartLine, Check, CircleCheck, CircleHelp, CircleX,
  Clock, Cloud, Code, Coins, Copy, Cpu, CreditCard, Crosshair, Crown, Database, Dices, DollarSign, Eraser, Euro, JapaneseYen, PoundSterling, Eye, EyeOff, Factory, FileText,
  Fingerprint, Fish, Flame, Gamepad2, Gem, Ghost, Gift, Globe, GraduationCap, Hand, HandCoins, Handshake, HardDrive, Hash, Heart, Hourglass,
  House, Info, Key, KeyRound, Landmark, Laptop, Layers, Lightbulb, Link, Lock, LockOpen, Mail, MapPin, Megaphone, MessageCircle, MessagesSquare,
  Minus, Monitor, Moon, Music, Network, NotebookPen, PenLine, Percent, Phone, Pickaxe, PiggyBank, Pizza, Plus, Printer, Puzzle, QrCode, Receipt,
  RefreshCw, Repeat, Rocket, RussianRuble, Scale, Scissors, ScrollText, Search, Send, Server, Shield, ShieldAlert, ShieldCheck, Signal, Siren,
  Skull, Smartphone, Snowflake, Sparkles, Sprout, Stamp, Star, Sun, Target, Terminal, ThumbsDown, ThumbsUp, Ticket, Timer, TrendingDown,
  TrendingUp, TriangleAlert, Trophy, Undo2, Unplug, User, UserCheck, UserRound, UserX, Users, Video, Wallet, Wifi, X, Zap, type LucideIcon,
} from "lucide-react";

/** Line icons Astra names in blocks (`icon="wallet"`). Lucide, ISC license. */
export const ICONS: Record<string, LucideIcon> = {
  // money and crypto
  bitcoin: Bitcoin, coins: Coins, wallet: Wallet, card: CreditCard, cash: Banknote, bank: Landmark, "piggy-bank": PiggyBank, dollar: DollarSign,
  ruble: RussianRuble, rub: RussianRuble, usd: DollarSign, euro: Euro, yen: JapaneseYen, pound: PoundSterling, coin: Coins,
  "money-bag": HandCoins, "trend-up": TrendingUp, "trend-down": TrendingDown, "chart-line": ChartLine, "chart-bar": ChartColumn,
  candles: ChartCandlestick, percent: Percent, receipt: Receipt, "hand-coins": HandCoins, gem: Gem, scale: Scale, calculator: Calculator,
  printer: Printer, factory: Factory,
  // security
  key: Key, "key-round": KeyRound, lock: Lock, unlock: LockOpen, shield: Shield, "shield-check": ShieldCheck, "shield-alert": ShieldAlert,
  fingerprint: Fingerprint, eye: Eye, "eye-off": EyeOff, siren: Siren, warning: TriangleAlert, ban: Ban, skull: Skull, bug: Bug,
  "user-x": UserX, phishing: Fish, ghost: Ghost, scissors: Scissors,
  // people
  user: User, person: UserRound, users: Users, "user-check": UserCheck, crown: Crown, boss: Briefcase, student: GraduationCap,
  handshake: Handshake, hand: Hand, brain: Brain,
  // technology
  server: Server, database: Database, globe: Globe, network: Network, link: Link, chip: Cpu, disk: HardDrive, phone: Smartphone,
  laptop: Laptop, monitor: Monitor, wifi: Wifi, cloud: Cloud, code: Code, terminal: Terminal, blocks: Blocks, box: Box, boxes: Boxes,
  hash: Hash, binary: Binary, qr: QrCode, mining: Pickaxe, zap: Zap, bot: Bot, layers: Layers, signal: Signal, unplug: Unplug,
  // messages
  chat: MessageCircle, chats: MessagesSquare, send: Send, mail: Mail, bell: Bell, call: Phone, at: AtSign, megaphone: Megaphone,
  // actions and marks
  "arrow-right": ArrowRight, swap: ArrowLeftRight, repeat: Repeat, refresh: RefreshCw, undo: Undo2, check: Check, "check-circle": CircleCheck,
  x: X, "x-circle": CircleX, plus: Plus, minus: Minus, copy: Copy, search: Search, stamp: Stamp, eraser: Eraser, pen: PenLine,
  // time, life, misc
  clock: Clock, hourglass: Hourglass, calendar: Calendar, timer: Timer, flame: Flame, rocket: Rocket, star: Star, heart: Heart,
  like: ThumbsUp, dislike: ThumbsDown, gift: Gift, trophy: Trophy, target: Target, idea: Lightbulb, book: BookOpen, notebook: NotebookPen,
  document: FileText, scroll: ScrollText, pizza: Pizza, game: Gamepad2, home: House, car: Car, pin: MapPin, sprout: Sprout, moon: Moon,
  sun: Sun, anchor: Anchor, puzzle: Puzzle, dice: Dices, ticket: Ticket, camera: Camera, video: Video, music: Music, sparkles: Sparkles,
  verified: BadgeCheck, alert: BadgeAlert, question: CircleHelp, info: Info, snowflake: Snowflake, crosshair: Crosshair,
};

export const iconNames = () => Object.keys(ICONS);

/** The picture an icon is drawn with on a board — a real coin logo, a currency, a 3D object — or undefined for a line icon. */
export function usePicture(name: string | undefined): string | undefined {
  const input = useInput();
  const asset = useAsset();
  if (!name) return undefined;
  const coin = coinOf(name);
  if (coin) return input.assets[coinKey(coin)] ? asset(coinKey(coin)) : undefined;
  if (OWN_PICTURES[name]) return asset(OWN_PICTURES[name]);
  const glyph = emojiOf(name);
  return glyph && input.assets[`emoji:${glyph}`] ? asset(`emoji:${glyph}`) : undefined;
}

/**
 * An icon by name. On boards (`picture`) it is a real thing — the coin's logo, a banknote, a 3D object —
 * and falls back to the line icon; an unknown name draws a quiet question mark instead of failing the render.
 */
export const Icon: React.FC<{ name: string; size?: number; color?: string; stroke?: number; style?: React.CSSProperties; picture?: boolean }> = ({
  name, size = 72, color = "currentColor", stroke = 1.6, style, picture = false,
}) => {
  const src = usePicture(picture ? name : undefined);
  if (src) {
    // A coin or exchange logo fills its circle; a 3D object has its own air around it, so it is drawn a little bigger.
    const coin = Boolean(coinOf(name));
    const box = Math.round(size * (coin ? 1.5 : 1.55));
    return <Img src={src} style={{ width: box, height: box, objectFit: "contain", filter: "drop-shadow(0 8px 14px rgba(0,0,0,0.22))", ...style }} />;
  }
  const Glyph = ICONS[coinOf(name) ? "coins" : name] ?? CircleHelp;
  return <Glyph size={size} color={color} strokeWidth={stroke} absoluteStrokeWidth={false} style={style} />;
};
