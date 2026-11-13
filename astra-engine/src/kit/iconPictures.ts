/**
 * What an icon on a board looks like. The owner (07.11): line icons are «стандартные, шаблонные» —
 * a dollar, a coin, a person must look like real things. So every board icon that has a picture is drawn as one:
 * a crypto coin or exchange as its real current logo (CoinGecko), a currency as its banknote or coin,
 * an object as a Microsoft Fluent 3D emoji (MIT). The line icon stays only where no picture exists.
 */

/** `coin:<ticker or name>` — a real coin or exchange logo: coin:ETH, coin:BTC, coin:TRUMP, coin:Kraken. */
export const COIN_PREFIX = "coin:";

/** Icon names that are coins without the prefix: Astra writes `bitcoin`, the board shows the real BTC logo. */
export const COIN_ALIASES: Record<string, string> = { bitcoin: "BTC" };

/** Pictures drawn by the kit itself (no emoji exists): files in public/astra-ui/icons. */
export const OWN_PICTURES: Record<string, string> = {
  ruble: "astra-ui/icons/ruble.png",
  rub: "astra-ui/icons/ruble.png",
};

/** Line icon name → Fluent 3D emoji that shows the same thing as a real object. */
export const EMOJI_PICTURES: Record<string, string> = {
  // money
  cash: "💵", dollar: "💵", usd: "💵", euro: "💶", yen: "💴", pound: "💷", coins: "🪙", coin: "🪙", wallet: "👛", card: "💳",
  bank: "🏦", "piggy-bank": "🐷", "hand-coins": "💰", "money-bag": "💰", gem: "💎", "trend-up": "📈", "trend-down": "📉",
  "chart-line": "📈", "chart-bar": "📊", receipt: "🧾", calculator: "🧮", printer: "🖨️", factory: "🏭", scale: "⚖️",
  // security
  key: "🔑", "key-round": "🗝️", lock: "🔒", unlock: "🔓", shield: "🛡️", "shield-check": "🛡️", "shield-alert": "🛡️",
  eye: "👁️", siren: "🚨", warning: "⚠️", ban: "🚫", skull: "💀", bug: "🐛", phishing: "🎣", ghost: "👻", scissors: "✂️",
  // people
  user: "🧑", person: "🧑", users: "👥", crown: "👑", boss: "💼", student: "🎓", handshake: "🤝", hand: "✋", brain: "🧠",
  // technology
  server: "🗄️", database: "🗄️", globe: "🌐", link: "🔗", disk: "💾", phone: "📱", laptop: "💻", monitor: "🖥️", cloud: "☁️",
  box: "📦", boxes: "📦", mining: "⛏️", zap: "⚡", bot: "🤖", signal: "📶",
  // messages
  chat: "💬", chats: "💬", send: "📨", mail: "✉️", bell: "🔔", call: "📞", megaphone: "📣",
  // marks
  check: "✅", "check-circle": "✅", x: "❌", "x-circle": "❌", search: "🔍", stamp: "📮", pen: "🖊️",
  // time, life
  clock: "⏰", hourglass: "⏳", calendar: "📅", timer: "⏱️", flame: "🔥", rocket: "🚀", star: "⭐", heart: "❤️", like: "👍",
  dislike: "👎", gift: "🎁", trophy: "🏆", target: "🎯", idea: "💡", book: "📖", notebook: "📓", document: "📄", scroll: "📜",
  pizza: "🍕", game: "🎮", home: "🏠", car: "🚗", pin: "📍", sprout: "🌱", moon: "🌙", sun: "☀️", anchor: "⚓", puzzle: "🧩",
  dice: "🎲", ticket: "🎟️", camera: "📷", video: "🎥", music: "🎵", sparkles: "✨", question: "❓", info: "ℹ️", snowflake: "❄️",
};

/** The coin a name asks for (`coin:ETH` → "ETH"), or undefined for an ordinary icon. */
export function coinOf(name: string): string | undefined {
  if (name.toLowerCase().startsWith(COIN_PREFIX)) return name.slice(COIN_PREFIX.length).trim() || undefined;
  return COIN_ALIASES[name];
}

/** The asset key a coin logo is stored under. */
export const coinKey = (coin: string) => `coin:${coin.toLowerCase()}`;

/** Emoji glyphs the boards' icons need fetched as pictures. */
export function emojiOf(name: string): string | undefined {
  return coinOf(name) || OWN_PICTURES[name] ? undefined : EMOJI_PICTURES[name];
}
