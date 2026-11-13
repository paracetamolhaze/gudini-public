import type { TrendAccount } from "./types";

/**
 * Стартовый набор по ig-viral: 4 прямых, 4 соседних, 2–4 крупных на тему. Подобран веб-поиском
 * 24.10.2026 (профили открыты, рилсы выходили в октябре), ждёт решения владельца. YouTube — канал
 * того же автора, совпадение по имени.
 */
type Starter = Omit<TrendAccount, "id" | "status" | "addedAt">;

export const STARTER: Starter[] = [
  { theme: "ai_tech", role: "direct", instagram: "mr.eflow", youtube: "mreflow", note: "Мэтт Вулф: новости ИИ на камеру, почти каждый день · ≈52 тыс." },
  { theme: "ai_tech", role: "direct", instagram: "mattfarmerai", youtube: "mattfarmerai", note: "Новые ИИ-сервисы и роботы, рилс в день · ≈92 тыс." },
  { theme: "ai_tech", role: "direct", instagram: "drcintas", note: "Профессор информатики объясняет ИИ и технологии · ≈163 тыс." },
  { theme: "ai_tech", role: "direct", instagram: "harpercarrollai", youtube: "harpercarrollai", note: "Как ИИ устроен внутри, на камеру · ≈661 тыс." },
  { theme: "ai_tech", role: "adjacent", instagram: "humphreytalks", youtube: "humphreytalks", note: "Деньги простыми словами для молодых · ≈908 тыс." },
  { theme: "ai_tech", role: "adjacent", instagram: "aliabdaal", youtube: "aliabdaal", note: "Продуктивность, говорящая голова · ≈1,1 млн" },
  { theme: "ai_tech", role: "adjacent", instagram: "networkchuck", youtube: "NetworkChuck", note: "Кибербезопасность и IT на пальцах · ≈792 тыс." },
  { theme: "ai_tech", role: "adjacent", instagram: "hankgreen", youtube: "hankschannel", note: "Наука, зацепка голосом · ≈2,2 млн" },
  { theme: "ai_tech", role: "outsized", instagram: "mkbhd", youtube: "mkbhd", note: "Обзоры техники, около 4 рилсов в месяц · ≈5,3 млн" },
  { theme: "ai_tech", role: "outsized", instagram: "cleoabram", youtube: "CleoAbram", note: "«Как это работает» про науку и технологии · ≈3,2 млн" },
  { theme: "ai_tech", role: "outsized", instagram: "zackdfilms", youtube: "zackdfilms", note: "3D-анимация «как это работает» с голосом · ≈11,4 млн" },

  { theme: "sketch", role: "direct", instagram: "alberta.tech", youtube: "albertatech", note: "Юмор про технологии и ИИ от бывшего инженера Google · ≈325 тыс." },
  { theme: "sketch", role: "direct", instagram: "austinnasso", youtube: "austinnasso", note: "Скетчи «исправившегося техбро», каждый день · ≈1 млн" },
  { theme: "sketch", role: "direct", instagram: "corporatenatalie", youtube: "corporatenatalie", note: "Офис и удалёнка, шутки про деньги · ≈1,4 млн" },
  { theme: "sketch", role: "direct", instagram: "krumbletv", youtube: "krumbletv", note: "3D-скетчи-диалоги на Unreal Engine; юмор бывает резким — глянуть пару роликов · ≈1,1 млн" },
  { theme: "sketch", role: "adjacent", instagram: "brodyanimates", youtube: "BrodyAnimates", note: "2D-анимация, истории взросления голосом · ≈284 тыс." },
  { theme: "sketch", role: "adjacent", instagram: "thelandofboggs", youtube: "TheLandofBoggs", note: "Мультики про узнаваемые ситуации · ≈1,9 млн" },
  { theme: "sketch", role: "adjacent", instagram: "danielthrasher", youtube: "danielthrasher", note: "Скетчи с несколькими персонажами · ≈801 тыс." },
  { theme: "sketch", role: "adjacent", instagram: "sydandolivia", youtube: "sydandolivia", note: "Дуэт скетчей, близко к нашему размеру; юмор бывает резким · ≈94 тыс." },
  { theme: "sketch", role: "outsized", instagram: "duolingo", youtube: "duolingo", note: "Маскот и человек — ближе всего к «владелец + Клод» · ≈5,3 млн" },
  { theme: "sketch", role: "outsized", instagram: "trevorwallace", youtube: "trevorwallace", note: "Персонажные скетчи · ≈5,8 млн" },
  { theme: "sketch", role: "outsized", instagram: "zackdfilms", youtube: "zackdfilms", note: "3D-анимация — образец формы · ≈11,4 млн" },
];
