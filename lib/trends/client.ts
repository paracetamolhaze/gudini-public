/** Сайт → контейнер gudini-ig-browser по сети Docker, как у TikTok. */
export async function igTrendsRequest(action: string, body?: unknown): Promise<any> {
  // в Docker адрес известен и без переменной: чужая выкатка сайта другой цепочкой compose не отрежет раздел
  const base = process.env.IG_BROWSER_URL || (process.env.NODE_ENV === "production" ? "http://ig-browser:43137" : "http://127.0.0.1:43137");
  const response = await fetch(`${base}/${action}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.IG_BROWSER_TOKEN ?? ""}` },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(60_000), cache: "no-store",
  }).catch(() => { throw new Error("Браузер Instagram для трендов недоступен. Проверьте, что контейнер gudini-ig-browser запущен."); });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "Ошибка браузера Instagram");
  return result;
}
